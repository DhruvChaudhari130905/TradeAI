import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, BookOpen } from 'lucide-react'
import type { TradeWithScore } from '@/lib/actions/dashboard'

interface RecentTradesProps {
  trades: TradeWithScore[]
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <Card className="border-zinc-800 bg-[#12141A]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent Trades</h3>
          <Link
            href="/journal"
            className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-[#00FF9C]"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <BookOpen className="h-8 w-8 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">No trades yet</p>
            <Link
              href="/journal/new"
              className="mt-2 text-xs text-[#00FF9C] transition-opacity hover:opacity-80"
            >
              Log your first trade →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {trades.map((trade) => {
              const pnl = Number(trade.pnl_usd) || 0
              const score = trade.trade_reviews?.[0]?.composite_score
              return (
                <Link
                  key={trade.id}
                  href={`/journal/${trade.id}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-[#0A0B0E] px-3 py-2.5 transition-colors hover:border-zinc-700"
                >
                  <span className="w-20 font-mono text-xs font-semibold text-white">
                    {trade.pair}
                  </span>
                  <Badge
                    variant="outline"
                    className={`w-16 justify-center text-[10px] ${
                      trade.outcome === 'win'
                        ? 'border-[#00FF9C]/30 text-[#00FF9C]'
                        : trade.outcome === 'loss'
                          ? 'border-[#FF4D4D]/30 text-[#FF4D4D]'
                          : 'border-zinc-700 text-zinc-500'
                    }`}
                  >
                    {trade.outcome
                      ? trade.outcome.charAt(0).toUpperCase() + trade.outcome.slice(1)
                      : '—'}
                  </Badge>
                  <span
                    className={`ml-auto font-mono text-xs font-semibold ${
                      pnl > 0
                        ? 'text-[#00FF9C]'
                        : pnl < 0
                          ? 'text-[#FF4D4D]'
                          : 'text-zinc-500'
                    }`}
                  >
                    {pnl !== 0 ? `$${pnl.toFixed(2)}` : '—'}
                  </span>
                  {score != null && (
                    <Badge className="bg-[#8B5CF6]/10 text-[#8B5CF6] border-0 text-[10px]">
                      {score}/10
                    </Badge>
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
