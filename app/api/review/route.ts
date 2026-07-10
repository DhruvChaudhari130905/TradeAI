import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service-client'
import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { parseNimJson } from '@/lib/nim/parse-nim-json'
import { buildTradeContext } from '@/lib/nim/build-trade-context'
import {
  PROP_FIRM_EVALUATOR_PROMPT,
  TRADING_PSYCHOLOGIST_PROMPT,
  INSTITUTIONAL_TRADER_PROMPT,
  QUANTITATIVE_ANALYST_PROMPT,
  RISK_MANAGER_PROMPT,
  buildReviewSystemPrompt,
} from '@/lib/prompts/reviewer-system-prompts'
import type { PersonalityReview, TradeReview } from '@/lib/types/review'

export async function POST(request: Request) {
  try {
    // ── Auth verification ──────────────────────────────────────────────────
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { tradeId } = body

    if (!tradeId || typeof tradeId !== 'string') {
      return NextResponse.json(
        { error: 'tradeId is required' },
        { status: 400 },
      )
    }

    // ── Owner verification via RLS-enforced client ────────────────────────
    // Use the regular (RLS-enforced) client to verify the trade belongs to this user.
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .eq('user_id', user.id)   // ← owner check: RLS + explicit filter
      .single()

    if (tradeError || !trade) {
      console.error('[api/review] trade fetch failed:', tradeError)
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    // Check if review already exists
    const { data: existing } = await supabase
      .from('trade_reviews')
      .select('*')
      .eq('trade_id', tradeId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ review: existing })
    }

    const tradeContext = buildTradeContext(trade)

    const personalities = [
      { key: 'prop_firm_evaluator', prompt: PROP_FIRM_EVALUATOR_PROMPT },
      { key: 'trading_psychologist', prompt: TRADING_PSYCHOLOGIST_PROMPT },
      { key: 'institutional_trader', prompt: INSTITUTIONAL_TRADER_PROMPT },
      { key: 'quantitative_analyst', prompt: QUANTITATIVE_ANALYST_PROMPT },
      { key: 'risk_manager', prompt: RISK_MANAGER_PROMPT },
    ] as const

    // Call all 5 personalities in parallel (with one retry on failure)
    const results = await Promise.all(
      personalities.map(async ({ key, prompt }, index) => {
        // Stagger requests slightly to avoid rate limits
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, index * 200))
        }
        const systemPrompt = buildReviewSystemPrompt(prompt)
        try {
          return { key, review: await callNim(systemPrompt, tradeContext) }
        } catch {
          // Retry once with fallback model
          try {
            return { key, review: await callNim(systemPrompt, tradeContext, NIM_FALLBACK_MODEL) }
          } catch (error) {
            console.error(`[api/review] ${key} failed after retry:`, error)
            return { key, review: null }
          }
        }
      }),
    )

    // Build review object
    const reviewData: Record<string, PersonalityReview | null> = {}
    let scoreSum = 0
    let scoreCount = 0

    for (const { key, review } of results) {
      reviewData[key] = review
      if (review) {
        scoreSum += review.overall
        scoreCount++
      }
    }

    const compositeScore = scoreCount > 0
      ? Math.round((scoreSum / scoreCount) * 10) / 10
      : null

    // Store in trade_reviews using the regular client (RLS-enforced, correct user_id)
    const { data: inserted, error: insertError } = await supabase
      .from('trade_reviews')
      .insert({
        trade_id: tradeId,
        user_id: user.id,
        prop_firm_evaluator: reviewData.prop_firm_evaluator,
        trading_psychologist: reviewData.trading_psychologist,
        institutional_trader: reviewData.institutional_trader,
        quantitative_analyst: reviewData.quantitative_analyst,
        risk_manager: reviewData.risk_manager,
        composite_score: compositeScore,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[api/review] insert failed:', insertError)
      return NextResponse.json(
        { error: 'Failed to store review' },
        { status: 500 },
      )
    }

    return NextResponse.json({ review: inserted })
  } catch (error) {
    console.error('[api/review]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}

async function callNim(
  systemPrompt: string,
  tradeContext: string,
  model: string = NIM_MODEL,
): Promise<PersonalityReview> {
  const completion = await getNimClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: tradeContext },
    ],
    max_tokens: 2048,
    temperature: 0.3,
  })

  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('Empty response from NIM')

  const parsed = parseNimJson<PersonalityReview>(raw)

  // Validate shape
  const requiredKeys: (keyof PersonalityReview)[] = [
    'entry_quality', 'risk_management', 'trade_psychology',
    'execution', 'strategy_adherence', 'overall', 'grade',
    'verdict', 'strengths', 'improvements',
  ]
  for (const k of requiredKeys) {
    if (parsed[k] === undefined || parsed[k] === null) {
      throw new Error(`Missing key: ${k}`)
    }
  }

  // Clamp scores to 1–10
  const scoreKeys: (keyof PersonalityReview)[] = [
    'entry_quality', 'risk_management', 'trade_psychology',
    'execution', 'strategy_adherence', 'overall',
  ]
  for (const k of scoreKeys) {
    if (typeof parsed[k] === 'number') {
      ;(parsed as unknown as Record<string, unknown>)[k] = Math.max(1, Math.min(10, parsed[k] as number))
    }
  }

  return parsed
}
