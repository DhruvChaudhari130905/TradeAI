import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Direction, Outcome } from '@/lib/types/trade'

/** Direction isn't P&L — shown neutral, distinguished by arrow and word */
export function DirectionTag({ direction, className }: { direction: Direction; className?: string }) {
  const long = direction === 'long'
  const Icon = long ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground', className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {long ? 'Long' : 'Short'}
    </span>
  )
}

const OUTCOME_STYLES: Record<Outcome, { label: string; className: string }> = {
  win: { label: 'Win', className: 'border-gain/30 bg-gain/10 text-gain' },
  loss: { label: 'Loss', className: 'border-loss/30 bg-loss/10 text-loss' },
  breakeven: { label: 'Breakeven', className: 'border-line-strong bg-muted text-foreground' },
  open: { label: 'Open', className: 'border-info/30 bg-info/10 text-info' },
}

export function OutcomeBadge({ outcome, className }: { outcome: Outcome | null | undefined; className?: string }) {
  if (!outcome) return null
  const s = OUTCOME_STYLES[outcome]
  return (
    <span className={cn('inline-flex h-5 items-center rounded border px-1.5 text-xs font-medium', s.className, className)}>
      {s.label}
    </span>
  )
}
