import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getNimClient, NIM_MODEL, NIM_FALLBACK_MODEL } from '@/lib/nim/client'
import { REPLAY_COACH_SYSTEM_PROMPT } from '@/lib/prompts/replay-coach-prompts'
import { buildReplayContext, type ReplayContextSnapshot } from '@/lib/nim/build-replay-context'

export const dynamic = 'force-dynamic'

const historySchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(6000),
  }),
).max(24)

const snapshotSchema = z.object({
  pair: z.string().min(2).max(12),
  market: z.enum(['forex', 'crypto']),
  activeTimeframe: z.string().min(1),
  currentTime: z.string(),
  balance: z.number(),
  equity: z.number(),
  marginUsed: z.number(),
  freeMargin: z.number(),
  leverage: z.number(),
  spreadPips: z.number(),
  recentCandles: z.array(z.object({
    time: z.string(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number().optional(),
  })).max(120),
  indicators: z.array(z.object({ label: z.string(), value: z.number().nullable() })),
  positions: z.array(z.unknown()).default([]),
  pendingOrders: z.array(z.unknown()).default([]),
  closedTradeCount: z.number().int(),
  recentClosedTrades: z.array(z.object({
    direction: z.enum(['long', 'short']),
    pnlUsd: z.number(),
    pnlPips: z.number(),
    exitReason: z.string(),
  })).max(10),
  drawingsSummary: z.array(z.string()).max(40),
})

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: historySchema,
  snapshot: snapshotSchema,
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ownership check — the chat endpoint itself is stateless (client autosaves)
    const { data: session, error: sessionError } = await supabase
      .from('replay_sessions')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { message, history, snapshot } = parsed.data

    // Fresh context travels with the current message so the model always sees
    // the live chart state; history stays plain conversation.
    const userContent = `${message}\n\n${buildReplayContext(snapshot as ReplayContextSnapshot)}`

    let reply: string | null = null
    for (const model of [NIM_MODEL, NIM_FALLBACK_MODEL]) {
      try {
        const completion = await getNimClient().chat.completions.create({
          model,
          messages: [
            { role: 'system', content: REPLAY_COACH_SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: userContent },
          ],
          max_tokens: 1024,
          temperature: 0.5,
        })
        reply = completion.choices[0]?.message?.content?.trim() ?? null
        if (reply) break
      } catch (err) {
        console.error(`[api/replay/chat] ${model} failed:`, err)
      }
    }

    if (!reply) {
      return NextResponse.json({ error: 'AI coach unavailable. Try again.' }, { status: 502 })
    }

    return NextResponse.json({ reply })
  } catch (error) {
    console.error('[api/replay/chat]', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
