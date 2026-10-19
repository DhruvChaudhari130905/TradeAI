'use client'

import Link from 'next/link'
import { TradeForm } from '@/components/journal/TradeForm'
import type { Trade } from '@/lib/types/trade'

interface EditTradeClientProps {
  trade: Trade
}

export function EditTradeClient({ trade }: EditTradeClientProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href={`/journal/${trade.id}`}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {trade.pair}
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl text-foreground">
          Edit trade
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update trade details for <span className="font-mono text-foreground">{trade.pair}</span>.
        </p>
      </div>
      <TradeForm trade={trade} mode="edit" />
    </div>
  )
}
