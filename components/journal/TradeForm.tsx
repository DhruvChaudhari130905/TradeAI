'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { tradeSchema, type TradeFormData, type Session, type Outcome, FOREX_PAIRS, CRYPTO_PAIRS, COMMODITY_PAIRS, detectMarket } from '@/lib/types/trade'
import { createTrade, updateTrade, uploadScreenshot, extractTradeFromScreenshot } from '@/lib/actions/trades'
import type { TradeImageExtraction, ExtractField, ExtractedFieldValue } from '@/lib/nim/trade-extract-types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Check, Upload, X, ArrowUpRight, ArrowDownRight, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pipSize, priceDigits } from '@/lib/replay/execution'
import type { Trade } from '@/lib/types/trade'

interface TradeFormProps {
  trade?: Trade
  mode?: 'create' | 'edit'
}

/** Short labels for extracted fields shown in the review strip chips. */
const IMPORT_FIELD_LABELS: Partial<Record<ExtractField, string>> = {
  pair: 'Pair',
  direction: 'Direction',
  entry_price: 'Entry',
  exit_price: 'Exit',
  stop_loss: 'Stop Loss',
  take_profit: 'Take Profit',
  lot_size: 'Lot Size',
  outcome: 'Outcome',
  pnl_usd: 'PnL',
  session: 'Session',
  entry_time: 'Entry Time',
  exit_time: 'Exit Time',
}

export function TradeForm({ trade, mode = 'create' }: TradeFormProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [screenshots, setScreenshots] = useState<string[]>(trade?.screenshot_urls ?? [])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<TradeImageExtraction | null>(null)
  const [confirmedFields, setConfirmedFields] = useState<Set<ExtractField>>(new Set())
  const [isDragging, setIsDragging] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(tradeSchema),
    defaultValues: trade
      ? {
          pair: trade.pair,
          market: trade.market,
          direction: trade.direction,
          entry_price: trade.entry_price,
          exit_price: trade.exit_price ?? '',
          stop_loss: trade.stop_loss ?? '',
          take_profit: trade.take_profit ?? '',
          lot_size: trade.lot_size ?? '',
          risk_reward_ratio: trade.risk_reward_ratio ?? '',
          outcome: trade.outcome ?? '',
          pnl_usd: trade.pnl_usd ?? '',
          pnl_pips: trade.pnl_pips ?? '',
          entry_time: trade.entry_time ? trade.entry_time.slice(0, 16) : '',
          exit_time: trade.exit_time ? trade.exit_time.slice(0, 16) : '',
          session: trade.session ?? '',
          notes: trade.notes ?? '',
          tags: trade.tags?.join(', ') ?? '',
          screenshot_urls: trade.screenshot_urls ?? [],
        }
      : {
          pair: '',
          market: 'forex',
          direction: 'long',
          entry_price: '' as unknown as number,
          outcome: '',
          session: '',
          screenshot_urls: [],
        },
  })

  const watchPair = watch('pair')
  const watchDirection = watch('direction')
  const watchEntryPrice = watch('entry_price')
  const watchStopLoss = watch('stop_loss')
  const watchTakeProfit = watch('take_profit')

  // Auto-detect market when pair changes
  const onPairChange = useCallback(
    (value: string) => {
      setValue('pair', value)
      setValue('market', detectMarket(value))
    },
    [setValue],
  )

  // Compute risk:reward live
  const computeRR = (): string | null => {
    const entry = Number(watchEntryPrice)
    const sl = Number(watchStopLoss)
    const tp = Number(watchTakeProfit)
    if (!entry || !sl || !tp || entry <= 0) return null

    const isLong = watchDirection === 'long'
    const risk = isLong ? entry - sl : sl - entry
    const reward = isLong ? tp - entry : entry - tp
    if (risk <= 0 || reward <= 0) return null

    const rr = reward / risk
    return rr.toFixed(2)
  }

  const rr = computeRR()

  // Risk readout in pips — visible before the trade is logged
  const watchMarket = watch('market')
  const ps = watchPair ? pipSize(watchPair, watchMarket) : null
  const pipsFrom = (level: unknown) => {
    const entry = Number(watchEntryPrice)
    const v = Number(level)
    if (!ps || !entry || !v) return null
    return Math.abs(entry - v) / ps
  }
  const stopPips = pipsFrom(watchStopLoss)
  const targetPips = pipsFrom(watchTakeProfit)
  const hasEntry = Number(watchEntryPrice) > 0
  const pricePlaceholder = watchPair ? (0).toFixed(priceDigits(watchPair, watchMarket)) : '0.00000'

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await uploadFiles(e.target.files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeScreenshot = (url: string) => {
    setScreenshots((prev) => prev.filter((s) => s !== url))
  }

  const runExtraction = async (url: string) => {
    setImporting(true)
    setImportResult(null)
    setConfirmedFields(new Set())
    try {
      const result = await extractTradeFromScreenshot(url)
      if (result.success) {
        setImportResult(result.data)
        applyExtraction(result.data.fields)
      } else {
        toast.error(result.error)
      }
    } finally {
      setImporting(false)
    }
  }

  const applyExtraction = (fields: Partial<Record<ExtractField, ExtractedFieldValue>>) => {
    const str = (f: ExtractField) => {
      const v = fields[f]?.value
      return v === null || v === undefined ? undefined : String(v)
    }
    const num = (f: ExtractField) => {
      const v = fields[f]?.value
      return typeof v === 'number' ? v : undefined
    }

    if (str('pair')) onPairChange(str('pair')!)
    if (str('direction') && (str('direction') === 'long' || str('direction') === 'short')) {
      setValue('direction', str('direction') as 'long' | 'short')
    }
    if (num('entry_price') !== undefined) setValue('entry_price', num('entry_price')!)
    if (num('exit_price') !== undefined) setValue('exit_price', num('exit_price')!)
    if (num('stop_loss') !== undefined) setValue('stop_loss', num('stop_loss')!)
    if (num('take_profit') !== undefined) setValue('take_profit', num('take_profit')!)
    if (num('lot_size') !== undefined) setValue('lot_size', num('lot_size')!)
    if (num('risk_reward_ratio') !== undefined) setValue('risk_reward_ratio', num('risk_reward_ratio')!)
    if (num('pnl_usd') !== undefined) setValue('pnl_usd', num('pnl_usd')!)
    if (str('session') && (str('session') === 'london' || str('session') === 'new_york' || str('session') === 'asian' || str('session') === 'overlap' || str('session') === 'other')) {
      setValue('session', str('session') as Session)
    }
    if (str('entry_time')) setValue('entry_time', str('entry_time')!)
    if (str('exit_time')) setValue('exit_time', str('exit_time')!)
    if (str('notes')) setValue('notes', str('notes')!)
    const tagArr = fields.tags?.value
    if (Array.isArray(tagArr) && tagArr.length > 0) setValue('tags', tagArr.join(', '))
    else if (typeof tagArr === 'string' && tagArr.length > 0) setValue('tags', tagArr)

    toast.success('Extracted details applied — review the highlighted fields')
  }

  // Amber fields that the user must confirm and that map to a visible form input
  const amberFields = useMemo(() => {
    if (!importResult) return [] as ExtractField[]
    return (Object.keys(importResult.fields) as ExtractField[]).filter((f) => {
      const fv = importResult.fields[f]
      if (!fv || fv.confidence !== 'guessed') return false
      if (f === 'notes' || f === 'tags' || f === 'market' || f === 'risk_reward_ratio') return false
      return fv.value !== null && !(Array.isArray(fv.value) && fv.value.length === 0)
    })
  }, [importResult])

  const toggleConfirmField = (field: ExtractField) => {
    setConfirmedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  // Border/ring class applied to the existing form inputs when a field was
  // extracted: blue = verified, amber = needs confirmation, green = AI draft.
  const fieldRing = (field: ExtractField): string => {
    if (!importResult) return ''
    const fv = importResult.fields[field]
    if (!fv || fv.value === null || (Array.isArray(fv.value) && fv.value.length === 0)) return ''
    if (field === 'notes' || field === 'tags') return 'ring-2 ring-primary/60'
    if (fv.confidence === 'extracted') return 'ring-2 ring-info/70'
    if (fv.confidence === 'guessed') {
      return confirmedFields.has(field) ? 'ring-2 ring-info/70' : 'ring-2 ring-warn'
    }
    return ''
  }

  const uploadFiles = useCallback(async (files: Iterable<File>) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setUploading(true)
    try {
      for (const file of arr) {
        const fd = new FormData()
        fd.append('file', file)
        const result = await uploadScreenshot(fd)
        if (result.success) {
          setScreenshots((prev) => [...prev, result.data.url])
        } else {
          toast.error(result.error)
        }
      }
    } finally {
      setUploading(false)
    }
  }, [])

  const onSubmit = async (data: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      // Convert comma-separated tags string to array
      const tagsStr = (data.tags as string | undefined)?.trim()
      const parsedTags = tagsStr
        ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
        : undefined
      const payload: TradeFormData = {
        pair: data.pair as string,
        market: data.market as 'forex' | 'crypto',
        direction: data.direction as 'long' | 'short',
        entry_price: data.entry_price as number,
        exit_price: data.exit_price as number | undefined,
        stop_loss: data.stop_loss as number | undefined,
        take_profit: data.take_profit as number | undefined,
        lot_size: data.lot_size as number | undefined,
        risk_reward_ratio: data.risk_reward_ratio as number | undefined,
        outcome: data.outcome as 'win' | 'loss' | 'breakeven' | 'open' | undefined,
        pnl_usd: data.pnl_usd as number | undefined,
        pnl_pips: data.pnl_pips as number | undefined,
        entry_time: data.entry_time as string | undefined,
        exit_time: data.exit_time as string | undefined,
        session: data.session as 'london' | 'new_york' | 'asian' | 'overlap' | 'other' | undefined,
        notes: data.notes as string | undefined,
        tags: parsedTags,
        screenshot_urls: screenshots,
      }
      let result

      if (mode === 'edit' && trade) {
        result = await updateTrade(trade.id, payload)
      } else {
        result = await createTrade(payload)
      }

      if (result.success) {
        toast.success(mode === 'edit' ? 'Trade updated' : 'Trade logged')
        router.push(`/journal/${result.data.id}`)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6"
      onPaste={(e) => {
        const files = e.clipboardData?.files
        if (files && files.length) {
          e.preventDefault()
          void uploadFiles(files)
        }
      }}
    >
      {/* Extraction review strip — legend + confirm guessed values */}
      {importResult && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {(
              [
                ['Verified from image', 'bg-info'],
                ['Guessed — confirm below', 'bg-warn'],
                ['Not found', 'bg-muted-foreground'],
                ['AI draft', 'bg-primary'],
              ] as const
            ).map(([label, cls]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('h-2.5 w-2.5 rounded-full', cls)} />
                {label}
              </span>
            ))}
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={importing || screenshots.length === 0}
              onClick={() => runExtraction(screenshots[0])}
              className="h-6 px-2 text-[11px] text-muted-foreground"
            >
              Retry
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setImportResult(null)}
              className="h-6 px-2 text-[11px] text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
          {amberFields.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Tap to confirm:</span>
              {amberFields.map((f) => {
                const confirmed = confirmedFields.has(f)
                return (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => toggleConfirmField(f)}
                    className={cn(
                      'h-6 gap-1 px-2 text-[11px]',
                      confirmed
                        ? 'border-info text-info'
                        : 'border-warn text-warn',
                    )}
                  >
                    {confirmed && <Check className="h-3 w-3" />}
                    {IMPORT_FIELD_LABELS[f] ?? f}
                  </Button>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-primary">All extracted values confirmed.</div>
          )}
        </div>
      )}
      {/* Section 1 — Trade details */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-foreground">
            Trade details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Pair */}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pair-select" className="text-muted-foreground">Pair</Label>
            <Select value={watchPair} onValueChange={(v) => v && onPairChange(v)}>
              <SelectTrigger id="pair-select" className={cn('border-border bg-background text-foreground', fieldRing('pair'))}>
                <SelectValue placeholder="Select pair" />
              </SelectTrigger>
              <SelectContent className="border-border bg-card">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Forex
                </div>
                {FOREX_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-foreground">
                    {p}
                  </SelectItem>
                ))}
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Commodities
                </div>
                {COMMODITY_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-foreground">
                    {p}
                  </SelectItem>
                ))}
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Crypto
                </div>
                {CRYPTO_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-foreground">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.pair && (
              <p className="text-xs text-loss">{errors.pair.message}</p>
            )}
          </div>

          {/* Market (auto-detected) */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Market</span>
            <p className="flex h-8 items-center text-sm text-foreground">
              {watchPair ? (watchMarket === 'crypto' ? 'Crypto' : 'Forex') : <span className="text-muted-foreground">Set by pair</span>}
            </p>
          </div>

          {/* Direction */}
          <div className="space-y-2">
            <span id="direction-label" className="text-sm font-medium text-muted-foreground">Direction</span>
            <div className="flex gap-2" role="group" aria-labelledby="direction-label">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={watchDirection === 'long'}
                className={`h-8 flex-1 gap-1.5 ${
                  watchDirection === 'long'
                    ? 'border-line-strong bg-muted text-foreground'
                    : 'border-border text-muted-foreground'
                } ${fieldRing('direction')}`}
                onClick={() => setValue('direction', 'long')}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Long
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={watchDirection === 'short'}
                className={`h-8 flex-1 gap-1.5 ${
                  watchDirection === 'short'
                    ? 'border-line-strong bg-muted text-foreground'
                    : 'border-border text-muted-foreground'
                } ${fieldRing('direction')}`}
                onClick={() => setValue('direction', 'short')}
              >
                <ArrowDownRight className="h-3.5 w-3.5" />
                Short
              </Button>
            </div>
          </div>

          {/* Session */}
          <div className="space-y-2">
            <Label htmlFor="session-select" className="text-muted-foreground">Session</Label>
            <Select
              value={watch('session') ?? '__none'}
              onValueChange={(v) => setValue('session', v === '__none' || v === null ? undefined : (v as Session))}
              items={{ __none: 'None', london: 'London', new_york: 'New York', asian: 'Asian', overlap: 'London/NY overlap', other: 'Other' }}
            >
              <SelectTrigger id="session-select" className={cn('border-border bg-background text-foreground', fieldRing('session'))}>
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent className="border-border bg-card">
                <SelectItem value="__none" className="text-muted-foreground">
                  None
                </SelectItem>
                <SelectItem value="london" className="text-foreground">
                  London
                </SelectItem>
                <SelectItem value="new_york" className="text-foreground">
                  New York
                </SelectItem>
                <SelectItem value="asian" className="text-foreground">
                  Asian
                </SelectItem>
                <SelectItem value="overlap" className="text-foreground">
                  London/NY overlap
                </SelectItem>
                <SelectItem value="other" className="text-foreground">
                  Other
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Entry Time */}
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="entry_time" className="text-muted-foreground">Entry time</Label>
            <Input
              type="datetime-local"
              id="entry_time"
              {...register('entry_time')}
              className={cn('border-border bg-background text-foreground', fieldRing('entry_time'))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Prices */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-foreground">
            Prices
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="entry_price" className="text-muted-foreground">Entry price</Label>
            <Input
              type="number"
              step="any"
              placeholder={pricePlaceholder}
              id="entry_price"
              {...register('entry_price')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('entry_price'))}
            />
            {errors.entry_price && (
              <p className="text-xs text-loss">
                {errors.entry_price.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="exit_price" className="text-muted-foreground">Exit price</Label>
            <Input
              type="number"
              step="any"
              placeholder={pricePlaceholder}
              id="exit_price"
              {...register('exit_price')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('exit_price'))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop_loss" className="text-muted-foreground">Stop loss</Label>
            <Input
              type="number"
              step="any"
              placeholder={pricePlaceholder}
              id="stop_loss"
              {...register('stop_loss')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('stop_loss'))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="take_profit" className="text-muted-foreground">Take profit</Label>
            <Input
              type="number"
              step="any"
              placeholder={pricePlaceholder}
              id="take_profit"
              {...register('take_profit')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('take_profit'))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lot_size" className="text-muted-foreground">Lot size</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              id="lot_size"
              {...register('lot_size')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('lot_size'))}
            />
          </div>
          {/* Risk readout — distances in pips and planned R:R, before the trade is logged */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-5" aria-live="polite">
            {hasEntry && !watchStopLoss ? (
              <p className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
                No stop loss set. Reviewers treat an unprotected trade as a risk-management failure.
              </p>
            ) : (
              <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
                <div className="flex gap-2"><dt className="text-muted-foreground">Stop</dt><dd className="font-mono text-foreground">{stopPips != null ? `${stopPips.toFixed(1)} pips` : '—'}</dd></div>
                <div className="flex gap-2"><dt className="text-muted-foreground">Target</dt><dd className="font-mono text-foreground">{targetPips != null ? `${targetPips.toFixed(1)} pips` : '—'}</dd></div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Planned R:R</dt>
                  <dd className={cn('font-mono', rr && Number(rr) < 1 ? 'text-warn' : 'text-foreground')}>{rr ? `1:${rr}` : '—'}</dd>
                </div>
              </dl>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Outcome */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-foreground">
            Outcome
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="outcome-select" className="text-muted-foreground">Result</Label>
            <Select
              value={watch('outcome') ?? '__none'}
              onValueChange={(v) => setValue('outcome', v === '__none' || v === null ? undefined : (v as Outcome))}
              items={{ __none: 'None', win: 'Win', loss: 'Loss', breakeven: 'Breakeven', open: 'Still open' }}
            >
              <SelectTrigger id="outcome-select" className={cn('border-border bg-background text-foreground', fieldRing('outcome'))}>
                <SelectValue placeholder="Select outcome" />
              </SelectTrigger>
              <SelectContent className="border-border bg-card">
                <SelectItem value="__none" className="text-muted-foreground">
                  None
                </SelectItem>
                <SelectItem value="win" className="text-foreground">
                  Win
                </SelectItem>
                <SelectItem value="loss" className="text-foreground">
                  Loss
                </SelectItem>
                <SelectItem value="breakeven" className="text-foreground">
                  Breakeven
                </SelectItem>
                <SelectItem value="open" className="text-foreground">
                  Still open
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pnl_usd" className="text-muted-foreground">P&amp;L (USD)</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              id="pnl_usd"
              {...register('pnl_usd')}
              className={cn('border-border bg-background font-mono text-foreground', fieldRing('pnl_usd'))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pnl_pips" className="text-muted-foreground">P&amp;L (pips)</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.0"
              id="pnl_pips"
              {...register('pnl_pips')}
              className="border-border bg-background font-mono text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exit_time" className="text-muted-foreground">Exit time</Label>
            <Input
              type="datetime-local"
              id="exit_time"
              {...register('exit_time')}
              className={cn('border-border bg-background text-foreground', fieldRing('exit_time'))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 4 — Notes &amp; screenshots */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-foreground">
            Notes &amp; screenshots
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-muted-foreground">Notes</Label>
            <Textarea
              placeholder="Trade rationale, observations…"
              rows={4}
              id="notes"
              {...register('notes')}
              className={cn('border-border bg-background text-foreground placeholder:text-muted-foreground', fieldRing('notes'))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags" className="text-muted-foreground">Tags (comma-separated)</Label>
            <Input
              placeholder="trend-follow, breakout, news-trade"
              id="tags"
              {...register('tags')}
              className={cn('border-border bg-background text-foreground placeholder:text-muted-foreground', fieldRing('tags'))}
            />
          </div>

          {/* Screenshot upload */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Screenshots</Label>
            <div
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors',
                isDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:border-line-strong',
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault() }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                void uploadFiles(e.dataTransfer.files)
              }}
            >
              <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {uploading ? 'Uploading…' : isDragging ? 'Drop images here' : 'Click, drag, or paste screenshots'}
              </p>
              <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onFileUpload}
              disabled={uploading}
            />

            {/* Screenshot previews */}
            {screenshots.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {screenshots.map((url) => (
                  <div
                    key={url}
                    className="group relative overflow-hidden rounded-md border border-border"
                  >
                    <img
                      src={url}
                      alt="Uploaded trade screenshot"
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeScreenshot(url)}
                      aria-label="Remove screenshot"
                      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded bg-background/85 text-foreground transition-colors hover:text-loss"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

          {/* Extract trade details */}
          {screenshots.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => runExtraction(screenshots[0])}
              disabled={importing}
              className="w-full border-primary/40 text-primary hover:bg-primary/10"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading screenshot…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" /> Extract trade details
                </>
              )}
            </Button>
          )}


      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          className="border-border text-muted-foreground"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === 'edit' ? 'Save changes' : 'Log trade'}
        </Button>
      </div>
    </form>
  )
}
