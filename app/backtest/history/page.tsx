'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FlaskConical, Loader2, AlertTriangle, FileSearch, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { BacktestRun } from '@/lib/types/backtest'

export default function BacktestHistoryPage() {
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      setRuns((data as BacktestRun[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Backtest History
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Review your past strategy simulations.
          </p>
        </div>
        <Link href="/backtest">
          <Button className="gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
            <FlaskConical className="h-4 w-4" />
            New Backtest
          </Button>
        </Link>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex h-48 items-center justify-center gap-3 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading…</span>
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3B82F6]/10 mb-4">
            <FlaskConical className="h-8 w-8 text-[#3B82F6]" />
          </div>
          <h2 className="text-lg font-semibold text-white">No backtests yet</h2>
          <p className="mt-1 text-sm text-zinc-500 max-w-sm text-center">
            Upload a strategy document and let AI simulate how it would have performed on historical data.
          </p>
          <Link href="/backtest">
            <Button className="mt-4 gap-2 bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90">
              <FlaskConical className="h-4 w-4" />
              Test your first strategy
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const pnl = run.result?.total_pnl_usd
            const winRate = run.result?.win_rate
            const totalTrades = run.result?.total_trades

            return (
              <Link
                key={run.id}
                href={
                  run.status === 'complete' ? `/backtest/${run.id}`
                  : (run.status === 'extracted' || run.status === 'approved') ? `/backtest/${run.id}/review`
                  : '#'
                }
                className={`flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-[#12141A] px-4 py-3 transition-colors hover:border-zinc-700 sm:flex-nowrap sm:gap-4 ${
                  (run.status === 'extracting' || run.status === 'running' || run.status === 'error') ? 'cursor-default' : ''
                }`}
              >
                {/* Name */}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white sm:w-48 sm:flex-none">
                  {run.strategy_name || 'Untitled'}
                </span>

                {/* Pair + TF */}
                <Badge variant="outline" className="font-mono text-xs text-zinc-400 border-zinc-700">
                  {run.pair} · {run.timeframe}
                </Badge>

                {/* Market */}
                <Badge variant="outline" className="hidden text-xs text-zinc-500 border-zinc-800 sm:inline-flex">
                  {run.market === 'forex' ? 'FX' : 'CRYPTO'}
                </Badge>

                {/* Date range */}
                <span className="hidden text-xs text-zinc-500 md:inline">
                  {run.date_from} → {run.date_to}
                </span>

                {/* Status */}
                {run.status === 'complete' && pnl != null && (
                  <span className={`font-mono text-sm font-semibold ${
                    pnl >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'
                  }`}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                  </span>
                )}

                {run.status === 'complete' && winRate != null && (
                  <span className="hidden font-mono text-xs text-zinc-400 sm:inline">
                    {winRate.toFixed(1)}% WR
                  </span>
                )}

                {run.status === 'complete' && totalTrades != null && (
                  <span className="hidden font-mono text-xs text-zinc-500 lg:inline">
                    {totalTrades} trades
                  </span>
                )}

                {/* Status badges */}
                {run.status === 'extracting' && (
                  <Badge className="bg-purple-500/10 text-purple-400 border-0 gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Extracting
                  </Badge>
                )}
                {run.status === 'extracted' && (
                  <Badge className="bg-amber-500/10 text-amber-400 border-0 gap-1.5">
                    <FileSearch className="h-3 w-3" />
                    Extracted
                  </Badge>
                )}
                {run.status === 'approved' && (
                  <Badge className="bg-sky-500/10 text-sky-400 border-0 gap-1.5">
                    <ShieldCheck className="h-3 w-3" />
                    Approved
                  </Badge>
                )}
                {run.status === 'running' && (
                  <Badge className="bg-yellow-500/10 text-yellow-400 border-0 gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Running
                  </Badge>
                )}
                {run.status === 'error' && (
                  <Badge className="bg-[#FF4D4D]/10 text-[#FF4D4D] border-0 gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Error
                  </Badge>
                )}

                {/* Created date */}
                <span className="hidden ml-auto text-xs text-zinc-600 sm:inline">
                  {new Date(run.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
