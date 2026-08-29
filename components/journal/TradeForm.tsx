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
import { Check, Plus, Trash2, Upload, X, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
    if (field === 'notes' || field === 'tags') return 'ring-2 ring-[#00FF9C]/60'
    if (fv.confidence === 'extracted') return 'ring-2 ring-[#3B82F6]/70'
    if (fv.confidence === 'guessed') {
      return confirmedFields.has(field) ? 'ring-2 ring-[#3B82F6]/70' : 'ring-2 ring-amber-400'
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
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-[#0A0B0E] p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {(
              [
                ['Verified from image', 'bg-[#3B82F6]'],
                ['Guessed — confirm below', 'bg-amber-400'],
                ['Not found', 'bg-zinc-500'],
                ['AI draft', 'bg-[#00FF9C]'],
              ] as const
            ).map(([label, cls]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
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
              className="h-6 px-2 text-[11px] text-zinc-400"
            >
              Retry
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setImportResult(null)}
              className="h-6 px-2 text-[11px] text-zinc-400"
            >
              Dismiss
            </Button>
          </div>
          {amberFields.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">Tap to confirm:</span>
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
                        ? 'border-[#3B82F6] text-[#3B82F6]'
                        : 'border-amber-400 text-amber-300',
                    )}
                  >
                    {confirmed && <Check className="h-3 w-3" />}
                    {IMPORT_FIELD_LABELS[f] ?? f}
                  </Button>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-[#00FF9C]">All extracted values confirmed.</div>
          )}
        </div>
      )}
      {/* Section 1 — Trade Details */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-white">
            Trade Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Pair */}
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-zinc-400">Pair</Label>
            <Select value={watchPair} onValueChange={(v) => v && onPairChange(v)}>
              <SelectTrigger className={cn('border-zinc-800 bg-[#0A0B0E] text-white', fieldRing('pair'))}>
                <SelectValue placeholder="Select pair" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-[#12141A]">
                <div className="px-2 py-1.5 text-xs font-medium text-zinc-500">
                  Forex
                </div>
                {FOREX_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-white">
                    {p}
                  </SelectItem>
                ))}
                <div className="px-2 py-1.5 text-xs font-medium text-zinc-500">
                  Commodities
                </div>
                {COMMODITY_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-white">
                    {p}
                  </SelectItem>
                ))}
                <div className="px-2 py-1.5 text-xs font-medium text-zinc-500">
                  Crypto
                </div>
                {CRYPTO_PAIRS.map((p) => (
                  <SelectItem key={p} value={p} className="text-white">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.pair && (
              <p className="text-xs text-[#FF4D4D]">{errors.pair.message}</p>
            )}
          </div>

          {/* Market (auto-detected) */}
          <div className="space-y-2">
            <Label className="text-zinc-400">Market</Label>
            <Input
              value={watch('market')}
              readOnly
              className="border-zinc-800 bg-[#0A0B0E] text-zinc-500"
            />
          </div>

          {/* Direction */}
          <div className="space-y-2">
            <Label className="text-zinc-400">Direction</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`flex-1 gap-1.5 ${
                  watchDirection === 'long'
                    ? 'border-[#00FF9C] bg-[#00FF9C]/10 text-[#00FF9C]'
                    : 'border-zinc-800 text-zinc-400'
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
                className={`flex-1 gap-1.5 ${
                  watchDirection === 'short'
                    ? 'border-[#FF4D4D] bg-[#FF4D4D]/10 text-[#FF4D4D]'
                    : 'border-zinc-800 text-zinc-400'
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
            <Label className="text-zinc-400">Session</Label>
            <Select
              value={watch('session') ?? '__none'}
              onValueChange={(v) => setValue('session', v === '__none' || v === null ? undefined : (v as Session))}
            >
              <SelectTrigger className={cn('border-zinc-800 bg-[#0A0B0E] text-white', fieldRing('session'))}>
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-[#12141A]">
                <SelectItem value="__none" className="text-zinc-500">
                  None
                </SelectItem>
                <SelectItem value="london" className="text-white">
                  London
                </SelectItem>
                <SelectItem value="new_york" className="text-white">
                  New York
                </SelectItem>
                <SelectItem value="asian" className="text-white">
                  Asian
                </SelectItem>
                <SelectItem value="overlap" className="text-white">
                  Overlap
                </SelectItem>
                <SelectItem value="other" className="text-white">
                  Other
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Entry Time */}
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label className="text-zinc-400">Entry Time</Label>
            <Input
              type="datetime-local"
              {...register('entry_time')}
              className={cn('border-zinc-800 bg-[#0A0B0E] text-white', fieldRing('entry_time'))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Prices */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-white">
            Prices
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-2">
            <Label className="text-zinc-400">Entry Price</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('entry_price')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('entry_price'))}
            />
            {errors.entry_price && (
              <p className="text-xs text-[#FF4D4D]">
                {errors.entry_price.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Exit Price</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('exit_price')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('exit_price'))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Stop Loss</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('stop_loss')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('stop_loss'))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Take Profit</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('take_profit')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('take_profit'))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Lot Size</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('lot_size')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('lot_size'))}
            />
          </div>
          {/* Risk:Reward display */}
          <div className="space-y-2">
            <Label className="text-zinc-400">R:R</Label>
            <div className="flex h-9 items-center rounded-md border border-zinc-800 bg-[#0A0B0E] px-3">
              {rr ? (
                <span
                  className={`font-mono text-sm font-semibold ${
                    Number(rr) >= 2 ? 'text-[#00FF9C]' : Number(rr) >= 1 ? 'text-yellow-400' : 'text-[#FF4D4D]'
                  }`}
                >
                  1:{rr}
                </span>
              ) : (
                <span className="text-sm text-zinc-600">—</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Outcome */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-white">
            Outcome
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">Result</Label>
            <Select
              value={watch('outcome') ?? '__none'}
              onValueChange={(v) => setValue('outcome', v === '__none' || v === null ? undefined : (v as Outcome))}
            >
              <SelectTrigger className={cn('border-zinc-800 bg-[#0A0B0E] text-white', fieldRing('outcome'))}>
                <SelectValue placeholder="Select outcome" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-[#12141A]">
                <SelectItem value="__none" className="text-zinc-500">
                  None
                </SelectItem>
                <SelectItem value="win" className="text-white">
                  Win
                </SelectItem>
                <SelectItem value="loss" className="text-white">
                  Loss
                </SelectItem>
                <SelectItem value="breakeven" className="text-white">
                  Breakeven
                </SelectItem>
                <SelectItem value="open" className="text-white">
                  Still Open
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">PnL (USD)</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('pnl_usd')}
              className={cn('border-zinc-800 bg-[#0A0B0E] font-mono text-white', fieldRing('pnl_usd'))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">PnL (Pips)</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.0"
              {...register('pnl_pips')}
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Exit Time</Label>
            <Input
              type="datetime-local"
              {...register('exit_time')}
              className={cn('border-zinc-800 bg-[#0A0B0E] text-white', fieldRing('exit_time'))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 4 — Notes & Screenshots */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-white">
            Notes & Screenshots
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">Notes</Label>
            <Textarea
              placeholder="Trade rationale, observations…"
              rows={4}
              {...register('notes')}
              className={cn('border-zinc-800 bg-[#0A0B0E] text-white placeholder:text-zinc-600', fieldRing('notes'))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Tags (comma-separated)</Label>
            <Input
              placeholder="trend-follow, breakout, news-trade"
              {...register('tags')}
              className={cn('border-zinc-800 bg-[#0A0B0E] text-white placeholder:text-zinc-600', fieldRing('tags'))}
            />
          </div>

          {/* Screenshot upload */}
          <div className="space-y-2">
            <Label className="text-zinc-400">Screenshots</Label>
            <div
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors',
                isDragging
                  ? 'border-[#00FF9C] bg-[#00FF9C]/10'
                  : 'border-zinc-800 bg-[#0A0B0E] hover:border-zinc-700',
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
              <Upload className="mb-2 h-6 w-6 text-zinc-500" />
              <p className="text-sm text-zinc-400">
                {uploading ? 'Uploading…' : isDragging ? 'Drop images here' : 'Click, drag, or paste screenshots'}
              </p>
              <p className="text-xs text-zinc-600">PNG, JPG up to 5MB</p>
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
                    className="group relative overflow-hidden rounded-md border border-zinc-800"
                  >
                    <img
                      src={url}
                      alt="Screenshot"
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeScreenshot(url)}
                      className="absolute right-1 top-1 rounded bg-[#0A0B0E]/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3 text-[#FF4D4D]" />
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
              className="w-full border-[#00FF9C]/40 text-[#00FF9C] hover:bg-[#00FF9C]/10"
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
          className="border-zinc-800 text-zinc-400"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-[#00FF9C] text-[#0A0B0E] hover:bg-[#00FF9C]/90"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === 'edit' ? 'Update Trade' : 'Log Trade'}
        </Button>
      </div>
    </form>
  )
}
