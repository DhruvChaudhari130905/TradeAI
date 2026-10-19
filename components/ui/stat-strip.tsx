import { cn } from '@/lib/utils'

export interface StatItem {
  label: string
  value: string
  /** Text color class for the value — use pnlTone() for P&L */
  tone?: string
  /** Secondary line under the value (context, not decoration) */
  sub?: string
}

/** Dense key-figures panel: one surface split into cells, 2-up on phones, 4-up on desktop */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-4',
        className,
      )}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            'min-w-0 px-4 py-3.5 sm:px-5 sm:py-4',
            // inner dividers: vertical between columns, horizontal between the 2-up rows on phones
            i % 2 === 1 && 'border-l border-border',
            i >= 2 && 'border-t border-border lg:border-t-0',
            i % 4 !== 0 && 'lg:border-l',
          )}
        >
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className={cn('mt-1 truncate font-mono text-xl font-semibold text-foreground sm:text-2xl', item.tone)}>
            {item.value}
          </dd>
          {item.sub && <dd className="mt-0.5 truncate text-xs text-muted-foreground">{item.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}
