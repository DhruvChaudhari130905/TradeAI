'use client'

// Replay session page: loads session config + candles, mounts the workspace.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { ReplayWorkspace } from '@/components/replay/ReplayWorkspace'
import type { ResumeState, ReplaySessionConfig } from '@/components/replay/use-replay-session'
import { getReplaySession, getSessionCandles, saveSessionCandles } from '@/lib/actions/replay'
import type { Candle, Timeframe } from '@/lib/types/replay'

interface SessionData {
  config: ReplaySessionConfig
  resume: ResumeState | null
}

export default function ReplaySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<SessionData | null>(null)
  const [candles, setCandles] = useState<Record<string, Candle[]> | null>(null)
  const [error, setError] = useState<string | null>(null)

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

        // Cached candles from a previous load mean zero Twelve Data calls on resume
        const cached = await getSessionCandles(id)
        let candlesByTf: Record<string, Candle[]> | null =
          cached.success ? cached.data : null

        if (!candlesByTf) {
          const candlesRes = await fetch(`/api/replay/${id}/candles`)
          if (!candlesRes.ok) {
            const body = await candlesRes.json().catch(() => null)
            if (!cancelled) setError(body?.error ?? 'Failed to fetch historical data.')
            return
          }
          const body = (await candlesRes.json()) as {
            candles: Record<string, Candle[]>
          }
          candlesByTf = body.candles
          // Fire-and-forget: persist so the next resume skips the API entirely
          void saveSessionCandles({ sessionId: id, candles: candlesByTf })
        }

        if (cancelled) return
        setData({
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
        })
        setCandles(candlesByTf)
      } catch (err) {
        console.error('[ReplaySessionPage]', err)
        if (!cancelled) setError('Failed to load session.')
      }
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
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-[#00FF9C]" />
      </div>
    )
  }

  // Empty data guard for a range with no candles on the primary TF
  return <ReplayWorkspace config={data.config} candlesByTf={candles} resume={data.resume} />
}
