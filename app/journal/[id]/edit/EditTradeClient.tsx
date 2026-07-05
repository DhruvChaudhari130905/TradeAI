'use client'

import Link from 'next/link'
import { TradeForm } from '@/components/journal/TradeForm'
import type { Trade } from '@/lib/types/trade'

interface EditTradeClientProps {
  trade: Trade
}

export function EditTradeClient({ trade }: EditTradeClientProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/journal/${trade.id}`}
          className="text-sm text-zinc-500 transition-colors hover:text-white"
        >
          ← Trade Detail
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Edit Trade
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Update trade details for <span className="font-mono text-white">{trade.pair}</span>.
        </p>
      </div>
      <TradeForm trade={trade} mode="edit" />
    </div>
  )
}
