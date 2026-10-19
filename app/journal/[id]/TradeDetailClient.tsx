'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { deleteTrade } from '@/lib/actions/trades'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Trash2, Loader2, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { StatStrip } from '@/components/ui/stat-strip'
import { ReviewPanel } from '@/components/journal/ReviewPanel'
import { DirectionTag, OutcomeBadge } from '@/components/journal/TradeBadges'
import { formatPrice, formatRR, formatSigned, formatUsd, pnlTone } from '@/lib/format'
import { pipSize } from '@/lib/replay/execution'
import type { Trade } from '@/lib/types/trade'

interface TradeDetailClientProps {
  trade: Trade & {
    trade_reviews?: Record<string, unknown>[]
  }
}

export function TradeDetailClient({ trade }: TradeDetailClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expandedImg, setExpandedImg] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const pnl = trade.pnl_usd != null ? Number(trade.pnl_usd) : null
  const isBacktest = trade.source === 'backtest'
  const ps = pipSize(trade.pair, trade.market)
  const distPips = (a: number | null | undefined) =>
    a != null && trade.entry_price != null ? Math.abs(Number(a) - Number(trade.entry_price)) / ps : null

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteTrade(trade.id)
      if (result.success) {
        toast.success('Trade deleted')
        router.push('/journal')
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

  const duration = (() => {
    if (!trade.entry_time || !trade.exit_time) return null
    const mins = Math.round((new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / 60000)
    if (mins < 0) return null
    if (mins < 60) return `${mins}m`
    const h = Math.floor(mins / 60)
    return h < 48 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
  })()

  const stopPips = distPips(trade.stop_loss)
  const targetPips = distPips(trade.take_profit)

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/journal"
          className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Journal
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">{trade.pair}</h1>
            <DirectionTag direction={trade.direction} className="text-sm" />
            <OutcomeBadge outcome={trade.outcome} />
            {isBacktest && (
              <span className="inline-flex h-5 items-center rounded border border-border px-1.5 text-xs text-muted-foreground">Replay</span>
            )}
          </div>
          <div className="flex gap-2">
            <Link href={`/journal/${trade.id}/edit`} className={buttonVariants({ variant: 'outline', className: 'gap-1.5' })}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </Link>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger render={<Button variant="destructive" className="gap-1.5" />}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete
              </DialogTrigger>
              <DialogContent className="border-border bg-card text-foreground">
                <DialogHeader>
                  <DialogTitle>Delete this trade?</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    The {trade.pair} trade, its screenshots and its AI review will be permanently deleted.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    Keep trade
                  </Button>
                  <Button onClick={handleDelete} disabled={isPending} className="bg-loss text-white hover:bg-loss/90">
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Delete trade
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Key figures */}
      <StatStrip
        items={[
          { label: 'P&L', value: trade.outcome === 'open' ? 'Open' : formatUsd(pnl, { signed: true }), tone: pnlTone(pnl) },
          { label: 'Pips', value: formatSigned(trade.pnl_pips != null ? Number(trade.pnl_pips) : null), tone: pnlTone(pnl) },
          { label: 'Planned R:R', value: formatRR(trade.risk_reward_ratio) },
          { label: 'Lot size', value: trade.lot_size != null ? Number(trade.lot_size).toFixed(2) : '—' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Levels */}
        <section className="rounded-lg border border-border bg-card" aria-labelledby="levels-heading">
          <h2 id="levels-heading" className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground sm:px-5">Levels</h2>
          <dl className="divide-y divide-border">
            <LevelRow label="Entry" value={formatPrice(trade.entry_price, trade.pair, trade.market)} />
            <LevelRow label="Exit" value={formatPrice(trade.exit_price, trade.pair, trade.market)} />
            <LevelRow
              label="Stop loss"
              value={formatPrice(trade.stop_loss, trade.pair, trade.market)}
              note={stopPips != null ? `${stopPips.toFixed(1)} pips risk` : 'No stop set'}
              warn={trade.stop_loss == null}
            />
            <LevelRow
              label="Take profit"
              value={formatPrice(trade.take_profit, trade.pair, trade.market)}
              note={targetPips != null ? `${targetPips.toFixed(1)} pips target` : undefined}
            />
          </dl>
        </section>

        {/* Timing & context */}
        <section className="rounded-lg border border-border bg-card" aria-labelledby="context-heading">
          <h2 id="context-heading" className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground sm:px-5">Timing &amp; context</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
            <Field label={isBacktest ? 'Entry (replay time)' : 'Entry'} value={formatDate(trade.entry_time)} />
            <Field label={isBacktest ? 'Exit (replay time)' : 'Exit'} value={formatDate(trade.exit_time)} />
            <Field label="Duration" value={duration ?? '—'} mono />
            <Field label="Session" value={trade.session ? SESSION_LABELS[trade.session] : '—'} />
            <Field label="Market" value={trade.market === 'forex' ? 'Forex' : 'Crypto'} />
            <Field label={isBacktest ? 'Logged' : 'Created'} value={formatDate(trade.created_at)} />
          </dl>
          {trade.tags && trade.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3 sm:px-5">
              <span className="sr-only">Tags:</span>
              {trade.tags.map((tag) => (
                <span key={tag} className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Notes */}
      {trade.notes && (
        <section className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5" aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="text-sm font-semibold text-foreground">Notes</h2>
          <p className="mt-2 max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed text-foreground text-pretty">{trade.notes}</p>
        </section>
      )}

      {/* Screenshots */}
      {trade.screenshot_urls && trade.screenshot_urls.length > 0 && (
        <section className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5" aria-labelledby="shots-heading">
          <h2 id="shots-heading" className="mb-3 text-sm font-semibold text-foreground">Screenshots</h2>
          <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {trade.screenshot_urls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setExpandedImg(url)}
                  className="overflow-hidden rounded-md border border-border transition-colors hover:border-line-strong"
                >
                  <img src={url} alt={`${trade.pair} chart screenshot`} className="aspect-video w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* AI Review — full-width bottom section */}
      <ReviewPanel tradeId={trade.id} existingReview={trade.trade_reviews?.[0] ?? null} />

      {/* Expanded screenshot overlay */}
      {expandedImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
          onClick={() => setExpandedImg(null)}
        >
          <button
            type="button"
            onClick={() => setExpandedImg(null)}
            aria-label="Close screenshot"
            className="absolute right-4 top-4 rounded-full bg-card p-2 text-foreground transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={expandedImg}
            alt="Expanded screenshot"
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

const SESSION_LABELS: Record<NonNullable<Trade['session']>, string> = {
  london: 'London',
  new_york: 'New York',
  asian: 'Asian',
  overlap: 'London/NY overlap',
  other: 'Other',
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

function LevelRow({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 sm:px-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-3 text-right">
        {note && <span className={`text-xs ${warn ? 'text-warn' : 'text-muted-foreground'}`}>{note}</span>}
        <span className="w-28 font-mono text-sm text-foreground">{value}</span>
      </dd>
    </div>
  )
}
