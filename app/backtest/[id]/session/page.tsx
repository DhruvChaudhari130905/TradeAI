'use client'

// Replay session page: loads session config + candles, mounts the workspace.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { ReplayWorkspace } from '@/components/replay/ReplayWorkspace'
import type { ResumeState, ReplaySessionConfig } from '@/components/replay/use-replay-session'
import { getReplaySession, getSessionCandles, saveSessionCandles } from '@/lib/actions/replay'
import type { Candle, ReplaySessionRow, Timeframe } from '@/lib/types/replay'

interface SessionData {
  config: ReplaySessionConfig
  resume: ResumeState | null
}

export default function ReplaySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<SessionData | null>(null)
  const [candles, setCandles] = useState<Record<string, Candle[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadNote, setLoadNote] = useState('Preparing session…')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const sessionRes = await getReplaySession(id)
        if (!sessionRes.success) {
          if (!cancelled) setError(sessionRes.error)
          return
        }
        const row = sessionRes.data

        if (row.status !== 'active') {
          if (!cancelled) setError('This session is not active.')
          return
        }
        const timeframes = row.timeframes as Timeframe[]

        // Cached candles from a previous load mean zero Twelve Data calls on resume
        const cached = await getSessionCandles(id)
        if (cached.success && cached.data) {
          if (cancelled) return
          applyData(row, cached.data)
          return
        }

        // Fresh fetch, progressive: replay-clock TF first so trading can start,
        // remaining timeframes trickle in behind it.
        const primary = timeframes[0]
        setLoadNote(`Fetching ${row.pair} ${primary} history…`)
        const accumulated: Record<string, Candle[]> = {}

        async function fetchTf(tf: Timeframe): Promise<Record<string, Candle[]> | null> {
          const res = await fetch(`/api/replay/${id}/candles?tf=${tf}`)
          if (!res.ok) {
            const body = await res.json().catch(() => null)
            if (!cancelled) setError(body?.error ?? 'Failed to fetch historical data.')
            return null
          }
          const body = (await res.json()) as { candles: Record<string, Candle[]> }
          return body.candles
        }

        const firstBatch = await fetchTf(primary)
        if (!firstBatch || cancelled) return
        Object.assign(accumulated, firstBatch)
        setData(buildData(row))
        setCandles({ ...accumulated })

        for (const tf of timeframes.slice(1)) {
          const batch = await fetchTf(tf)
          if (cancelled) return
          if (!batch) return // error already surfaced
          Object.assign(accumulated, batch)
          setCandles({ ...accumulated })
        }

        // Persist once everything arrived — next resume skips the API entirely
        void saveSessionCandles({ sessionId: id, candles: accumulated })
      } catch (err) {
        console.error('[ReplaySessionPage]', err)
        if (!cancelled) setError('Failed to load session.')
      }
    }

    function buildData(row: ReplaySessionRow): SessionData {
      return {
        config: {
          id: row.id,
          pair: row.pair,
          market: row.market,
          leverage: Number(row.leverage),
          spreadPips: Number(row.spread_pips),
          startingBalance: Number(row.starting_balance),
          timeframes: row.timeframes,
        },
        resume:
          row.cursor_index > 0 ||
          row.positions.length > 0 ||
          row.orders.length > 0 ||
          row.closed_trades.length > 0 ||
          row.drawings.length > 0 ||
          row.chat_messages.length > 0
            ? {
                cursorIndex: row.cursor_index,
                balance: Number(row.balance),
                positions: row.positions,
                orders: row.orders,
                drawings: row.drawings,
                indicatorConfigs: row.indicator_configs,
                closedTrades: row.closed_trades,
                equityCurve: row.equity_curve,
                chatMessages: row.chat_messages,
              }
            : null,
      }
    }

    function applyData(row: ReplaySessionRow, candlesByTf: Record<string, Candle[]>) {
      setData(buildData(row))
      setCandles(candlesByTf)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="text-sm text-[#FF4D4D]">{error}</p>
        <Link
          href="/backtest"
          className="inline-flex h-9 items-center rounded-md border border-[#27272A] px-4 text-sm hover:bg-[#1C1E26]"
        >
          Back to sessions
        </Link>
      </div>
    )
  }

  if (!data || !candles || (candles[data.config.timeframes[0] as Timeframe]?.length ?? 0) === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <Loader2 className="h-6 w-6 animate-spin text-[#00FF9C]" />
        <p role="status" aria-live="polite" className="text-xs text-zinc-500">
          {loadNote}
        </p>
      </div>
    )
  }

  // Empty data guard for a range with no candles on the primary TF
  return <ReplayWorkspace config={data.config} candlesByTf={candles} resume={data.resume} />
}
