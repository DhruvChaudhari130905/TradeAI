'use client'

import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  /** Accessible name for the group */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** Single-choice toggle group (Real/Backtested, 7D/30D/All, Forex/Crypto) */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'sm', className }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5', className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[5px] font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              selected
                ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
