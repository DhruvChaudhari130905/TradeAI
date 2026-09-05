import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  getNimClient,
  NIM_MODEL_FAST,
  NIM_NO_THINKING,
  NIM_FALLBACK_MODEL,
  NIM_REQUEST_TIMEOUT_MS,
} from '@/lib/nim/client'
import type { Stream } from 'openai/streaming'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
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

    const messages = [
      { role: 'system' as const, content: REPLAY_COACH_SYSTEM_PROMPT },
      ...history,
      { role: 'user' as const, content: userContent },
    ]

    // Fast non-reasoning model first, thinking disabled; stream tokens through
    // to the client as SSE so the coach feels responsive. On primary failure
    // (timeout included) fall back to the non-reasoning nano.
    let upstream: Stream<ChatCompletionChunk> | null = null
    for (const model of [NIM_MODEL_FAST, NIM_FALLBACK_MODEL]) {
      try {
        upstream = await getNimClient().chat.completions.create(
          {
            model,
            messages,
            max_tokens: 1024,
            temperature: 0.5,
            stream: true,
            ...NIM_NO_THINKING,
          },
          { timeout: NIM_REQUEST_TIMEOUT_MS },
        )
        break
      } catch (err) {
        console.error(`[api/replay/chat] ${model} failed:`, err)
      }
    }

    if (!upstream) {
      return NextResponse.json({ error: 'AI coach unavailable. Try again.' }, { status: 502 })
    }

    // Bridge the OpenAI SDK stream into our own SSE: {delta} frames + [DONE]
    const encoder = new TextEncoder()
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of upstream!) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err) {
          console.error('[api/replay/chat] stream failed:', err)
          // Client sees a short answer; nothing else to do mid-stream
        } finally {
          controller.close()
        }
      },
    })

    return new Response(sse, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[api/replay/chat]', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
