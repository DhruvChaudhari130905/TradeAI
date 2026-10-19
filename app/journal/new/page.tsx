import { TradeForm } from '@/components/journal/TradeForm'

export default function NewTradePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl text-foreground">
          Log trade
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Entry, stop and target are what the reviewers judge most — fill those first.
        </p>
      </div>
      <TradeForm mode="create" />
    </div>
  )
}
