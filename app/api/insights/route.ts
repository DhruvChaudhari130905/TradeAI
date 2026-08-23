import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { parseNimJson } from '@/lib/nim/parse-nim-json'
import { INSIGHTS_SYSTEM_PROMPT } from '@/lib/prompts/insights-system-prompt'

export async function POST(request: Request) {
  try {
    // `{ refresh: true }` in the body skips the 24h cache and regenerates
    let refresh = false
    try {
      const body = (await request.json()) as { refresh?: boolean }
      refresh = body?.refresh === true
    } catch {
      // no body — cache path
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Check cache first (24h TTL)
    let cached: { insights: unknown[]; created_at: string } | null = null
    if (!refresh) {
      const { data } = await supabase
        .from('dashboard_insights')
        .select('insights, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      cached = data
    }

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime()
      const twentyFourHours = 24 * 60 * 60 * 1000
      if (cacheAge < twentyFourHours) {
        return NextResponse.json({ insights: cached.insights })
      }
    }

    // Fetch last 20 trades
    const { data: trades } = await supabase
      .from('trades')
      .select('pair, market, direction, outcome, pnl_usd, session, entry_time, exit_time, risk_reward_ratio')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (!trades || trades.length < 5) {
      return NextResponse.json({
        insights: [
          {
            title: 'Getting started',
            description: 'Log more trades to unlock personalized AI insights about your trading patterns.',
            type: 'neutral',
          },
        ],
      })
    }

    // Build trade context for NIM
    const tradeContext = trades
      .map(
        (t) =>
          `${t.pair} | ${t.direction} | ${t.outcome ?? 'open'} | $${t.pnl_usd ?? 0} | session:${t.session ?? 'unknown'} | RR:${t.risk_reward_ratio ?? 'N/A'} | ${t.entry_time ?? 'N/A'}`,
      )
      .join('\n')

    const nim = getNimClient()
    let insights: unknown[]

    try {
      const response = await nim.chat.completions.create({
        model: NIM_MODEL,
        messages: [
          { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
          { role: 'user', content: `Here are my recent trades:\n${tradeContext}` },
        ],
        temperature: 0.4,
        max_tokens: 2048,
      })

      const content = response.choices[0]?.message?.content?.trim() ?? '[]'
      insights = parseNimJson<unknown[]>(content)
    } catch {
      // Retry with fallback model
      try {
        const response = await nim.chat.completions.create({
          model: NIM_FALLBACK_MODEL,
          messages: [
            { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
            { role: 'user', content: `Here are my recent trades:\n${tradeContext}` },
          ],
          temperature: 0.4,
          max_tokens: 2048,
        })

        const content = response.choices[0]?.message?.content?.trim() ?? '[]'
        insights = parseNimJson<unknown[]>(content)
      } catch (retryErr) {
        console.error('[insights] Fallback model also failed:', retryErr)
        return NextResponse.json(
          { error: 'AI service unavailable' },
          { status: 503 },
        )
      }
    }

    // Validate shape — ensure we have an array of insight objects
    if (!Array.isArray(insights)) {
      insights = []
    }
    insights = insights.slice(0, 3).map((ins) => {
      const rec = ins as Record<string, unknown>
      return {
        title: String(rec.title ?? 'Insight'),
        description: String(rec.description ?? ''),
        type: ['positive', 'neutral', 'warning'].includes(rec.type as string)
          ? rec.type
          : 'neutral',
      }
    })

    // Cache result (upsert)
    await supabase.from('dashboard_insights').upsert(
      {
        user_id: user.id,
        insights,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.json({ insights })
  } catch (error) {
    console.error('[insights]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
