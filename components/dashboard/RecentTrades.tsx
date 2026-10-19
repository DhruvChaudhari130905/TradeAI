import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatUsd, pnlTone } from '@/lib/format'
import type { TradeWithScore } from '@/lib/actions/dashboard'

interface RecentTradesProps {
  trades: TradeWithScore[]
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Recent trades</h3>
          <Link
            href="/journal"
            className="flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View journal <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>

        {trades.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No trades in this period.</p>
            <Link href="/journal/new" className="mt-1 inline-block text-sm text-primary hover:underline">
              Log a trade
            </Link>
          </div>
        ) : (
          <ul className="-mx-2 divide-y divide-border">
            {trades.map((trade) => {
              const pnl = trade.pnl_usd != null ? Number(trade.pnl_usd) : null
              const score = trade.trade_reviews?.[0]?.composite_score
              const long = trade.direction === 'long'
              const DirIcon = long ? ArrowUpRight : ArrowDownRight
              return (
                <li key={trade.id}>
                  <Link
                    href={`/journal/${trade.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_3.5rem]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">{trade.pair}</span>
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <DirIcon className="h-3 w-3" aria-hidden />
                        {long ? 'Long' : 'Short'}
                      </span>
                    </span>
                    <span className={`text-right font-mono text-sm font-semibold sm:order-last ${pnlTone(pnl)}`}>
                      {trade.outcome === 'open' ? 'Open' : formatUsd(pnl, { signed: true })}
                    </span>
                    <span className="text-xs text-muted-foreground sm:text-right">
                      {trade.entry_time
                        ? new Date(trade.entry_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '—'}
                    </span>
                    <span className="text-right font-mono text-xs text-muted-foreground">
                      {score != null ? `${Number(score).toFixed(1)}/10` : '—'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
