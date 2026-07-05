import { TradeForm } from '@/components/journal/TradeForm'

export default function NewTradePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Log Trade
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Record your trade details for journaling and AI review.
        </p>
      </div>
      <TradeForm mode="create" />
    </div>
  )
}
