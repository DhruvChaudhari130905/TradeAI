'use client'

import { useState, useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { tradeSchema, type TradeFormData, type Session, type Outcome, FOREX_PAIRS, CRYPTO_PAIRS, detectMarket } from '@/lib/types/trade'
import { createTrade, updateTrade, uploadScreenshot } from '@/lib/actions/trades'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Upload, X, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
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

export function TradeForm({ trade, mode = 'create' }: TradeFormProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [screenshots, setScreenshots] = useState<string[]>(trade?.screenshot_urls ?? [])
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    const files = e.target.files
    if (!files?.length) return

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeScreenshot = (url: string) => {
    setScreenshots((prev) => prev.filter((s) => s !== url))
  }

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Section 1 — Trade Details */}
      <Card className="border-zinc-800 bg-[#12141A]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-white">
            Trade Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4">
          {/* Pair */}
          <div className="col-span-2 space-y-2">
            <Label className="text-zinc-400">Pair</Label>
            <Select value={watchPair} onValueChange={(v) => v && onPairChange(v)}>
              <SelectTrigger className="border-zinc-800 bg-[#0A0B0E] text-white">
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
                }`}
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
                }`}
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
              <SelectTrigger className="border-zinc-800 bg-[#0A0B0E] text-white">
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
          <div className="col-span-3 space-y-2">
            <Label className="text-zinc-400">Entry Time</Label>
            <Input
              type="datetime-local"
              {...register('entry_time')}
              className="border-zinc-800 bg-[#0A0B0E] text-white"
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
        <CardContent className="grid grid-cols-6 gap-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">Entry Price</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('entry_price')}
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
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
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Stop Loss</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('stop_loss')}
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Take Profit</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('take_profit')}
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Lot Size</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              {...register('lot_size')}
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
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
        <CardContent className="grid grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">Result</Label>
            <Select
              value={watch('outcome') ?? '__none'}
              onValueChange={(v) => setValue('outcome', v === '__none' || v === null ? undefined : (v as Outcome))}
            >
              <SelectTrigger className="border-zinc-800 bg-[#0A0B0E] text-white">
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
              className="border-zinc-800 bg-[#0A0B0E] font-mono text-white"
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
              className="border-zinc-800 bg-[#0A0B0E] text-white"
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
              className="border-zinc-800 bg-[#0A0B0E] text-white placeholder:text-zinc-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Tags (comma-separated)</Label>
            <Input
              placeholder="trend-follow, breakout, news-trade"
              {...register('tags')}
              className="border-zinc-800 bg-[#0A0B0E] text-white placeholder:text-zinc-600"
            />
          </div>

          {/* Screenshot upload */}
          <div className="space-y-2">
            <Label className="text-zinc-400">Screenshots</Label>
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 bg-[#0A0B0E] px-6 py-8 transition-colors hover:border-zinc-700"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mb-2 h-6 w-6 text-zinc-500" />
              <p className="text-sm text-zinc-400">
                {uploading ? 'Uploading…' : 'Click or drag to upload screenshots'}
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
              <div className="mt-3 grid grid-cols-4 gap-3">
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
