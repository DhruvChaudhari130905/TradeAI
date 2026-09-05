'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { deleteTrade } from '@/lib/actions/trades'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  ArrowDownRight,
  Pencil,
  Trash2,
  Loader2,
  X,
  Calendar,
  Clock,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  Tag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ReviewPanel } from '@/components/journal/ReviewPanel'
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

  const pnl = Number(trade.pnl_usd) || 0
  const isLong = trade.direction === 'long'

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

  const formatNum = (n: number | null | undefined, decimals = 2) =>
    n != null ? Number(n).toFixed(decimals) : '—'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/journal"
            className="text-sm text-zinc-500 transition-colors hover:text-white"
          >
            ← Journal
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <h1 className="text-2xl font-bold tracking-tight text-white">
            <span className="font-mono">{trade.pair}</span>
          </h1>
          <Badge
            variant="outline"
            className={`gap-1 ${isLong ? 'border-[#00FF9C]/30 text-[#00FF9C]' : 'border-[#FF4D4D]/30 text-[#FF4D4D]'}`}
          >
            {isLong ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {trade.direction.toUpperCase()}
          </Badge>
          {trade.outcome && (
            <Badge
              variant="outline"
              className={
                trade.outcome === 'win'
                  ? 'border-[#00FF9C]/30 bg-[#00FF9C]/5 text-[#00FF9C]'
                  : trade.outcome === 'loss'
                    ? 'border-[#FF4D4D]/30 bg-[#FF4D4D]/5 text-[#FF4D4D]'
                    : trade.outcome === 'breakeven'
                      ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
                      : 'border-zinc-700 text-zinc-500'
              }
            >
              {trade.outcome.charAt(0).toUpperCase() + trade.outcome.slice(1)}
            </Badge>
          )}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Link href={`/journal/${trade.id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5 border-zinc-800 text-zinc-400 hover:text-white">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </Link>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" className="gap-1.5 border-[#FF4D4D]/30 text-[#FF4D4D] hover:bg-[#FF4D4D]/10" />
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DialogTrigger>
            <DialogContent className="border-zinc-800 bg-[#12141A] text-white">
              <DialogHeader>
                <DialogTitle>Delete Trade</DialogTitle>
                <DialogDescription className="text-zinc-400">
                  This will permanently delete this trade and all associated screenshots. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDeleteOpen(false)} className="border-zinc-800 text-zinc-400">
                  Cancel
                </Button>
                <Button onClick={handleDelete} disabled={isPending} className="bg-[#FF4D4D] text-white hover:bg-[#FF4D4D]/90">
                  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Trade Data — top section, full width two-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Prices Card */}
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Prices & Levels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Entry Price" value={formatNum(trade.entry_price)} mono />
              <Field label="Exit Price" value={formatNum(trade.exit_price)} mono />
              <Field
                label="Stop Loss"
                value={formatNum(trade.stop_loss)}
                mono
                valueClass={trade.stop_loss ? 'text-[#FF4D4D]' : undefined}
              />
              <Field label="Take Profit" value={formatNum(trade.take_profit)} mono />
              <Field
                label="R:R Ratio"
                value={trade.risk_reward_ratio ? `1:${Number(trade.risk_reward_ratio).toFixed(2)}` : '—'}
                mono
                valueClass={
                  trade.risk_reward_ratio
                    ? Number(trade.risk_reward_ratio) >= 2
                      ? 'text-[#00FF9C]'
                      : Number(trade.risk_reward_ratio) >= 1
                        ? 'text-yellow-400'
                        : 'text-[#FF4D4D]'
                    : undefined
                }
              />
              <Field label="Lot Size" value={formatNum(trade.lot_size)} mono />
            </div>
          </CardContent>
        </Card>

        {/* Outcome Card */}
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Outcome</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="PnL (USD)"
                value={pnl !== 0 ? `$${pnl.toFixed(2)}` : '—'}
                mono
                valueClass={pnl > 0 ? 'text-[#00FF9C]' : pnl < 0 ? 'text-[#FF4D4D]' : undefined}
              />
              <Field label="PnL (Pips)" value={trade.pnl_pips != null ? formatNum(trade.pnl_pips, 1) : '—'} mono />
              <Field
                label={trade.source === 'backtest' ? 'Replay Entry Time' : 'Entry Time'}
                value={formatDate(trade.entry_time)}
                icon={<Clock className="h-3.5 w-3.5 text-zinc-500" />}
              />
              <Field
                label={trade.source === 'backtest' ? 'Replay Exit Time' : 'Exit Time'}
                value={formatDate(trade.exit_time)}
                icon={<Clock className="h-3.5 w-3.5 text-zinc-500" />}
              />
            </div>
            {/* Details metadata row */}
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Market" value={trade.market.toUpperCase()} />
                <Field label="Session" value={trade.session ? trade.session.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'} />
                <Field
                  label={trade.source === 'backtest' ? 'Logged (Real Time)' : 'Created'}
                  value={formatDate(trade.created_at)}
                />
                <Field label="Updated" value={formatDate(trade.updated_at)} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      {trade.notes && (
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-zinc-300">{trade.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {trade.tags && trade.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-zinc-500" />
          {trade.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="border-zinc-700 text-zinc-400">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Screenshots */}
      {trade.screenshot_urls && trade.screenshot_urls.length > 0 && (
        <Card className="border-zinc-800 bg-[#12141A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-400">Screenshots</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {trade.screenshot_urls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setExpandedImg(url)}
                  className="overflow-hidden rounded-md border border-zinc-800 transition-colors hover:border-zinc-600"
                >
                  <img src={url} alt="Trade screenshot" className="h-32 w-full object-cover" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Review — full-width bottom section */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-400">AI Review</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewPanel tradeId={trade.id} existingReview={trade.trade_reviews?.[0] ?? null} />
        </CardContent>
      </Card>

      {/* Expanded screenshot overlay */}
      {expandedImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
          onClick={() => setExpandedImg(null)}
        >
          <button
            type="button"
            onClick={() => setExpandedImg(null)}
            className="absolute right-4 top-4 rounded-full bg-[#12141A] p-2 text-white transition-colors hover:bg-[#1C1E26]"
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

function Field({
  label,
  value,
  mono,
  valueClass,
  icon,
}: {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-zinc-500">{label}</Label>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className={`text-sm ${mono ? 'font-mono' : ''} ${valueClass ?? 'text-white'}`}>
          {value}
        </span>
      </div>
    </div>
  )
}
