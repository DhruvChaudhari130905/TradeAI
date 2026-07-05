import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, FlaskConical } from 'lucide-react'
import type { BacktestRun, BacktestResult } from '@/lib/types/backtest'

interface RecentBacktestsProps {
  backtests: BacktestRun[]
}

export function RecentBacktests({ backtests }: RecentBacktestsProps) {
  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent Backtests</h3>
          <Link
            href="/backtest/history"
            className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-[#00FF9C]"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {backtests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <FlaskConical className="h-8 w-8 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">No backtests yet</p>
            <Link
              href="/backtest"
              className="mt-2 text-xs text-[#00FF9C] transition-opacity hover:opacity-80"
            >
              Test your first strategy →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {backtests.map((run) => {
              const result = run.result as BacktestResult | null
              const pnl = result?.total_pnl_usd
              const winRate = result?.win_rate

              return (
                <Link
                  key={run.id}
                  href={`/backtest/${run.id}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-[#0A0B0E] px-3 py-2.5 transition-colors hover:border-zinc-700"
                >
                  <span className="w-32 truncate text-xs font-semibold text-white">
                    {run.strategy_name || 'Untitled'}
                  </span>
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-zinc-400 border-zinc-700"
                  >
                    {run.pair} · {run.timeframe}
                  </Badge>
                  {winRate != null && (
                    <span className="ml-auto font-mono text-xs text-zinc-400">
                      {winRate.toFixed(1)}% WR
                    </span>
                  )}
                  {pnl != null && (
                    <span
                      className={`font-mono text-xs font-semibold ${
                        pnl >= 0 ? 'text-[#00FF9C]' : 'text-[#FF4D4D]'
                      }`}
                    >
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
