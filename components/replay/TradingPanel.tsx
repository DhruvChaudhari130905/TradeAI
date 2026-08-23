'use client'

// Order entry: market buy/sell with SL/TP + sizing, close-all.
// Sizing mode and SL/TP values live in ReplayWorkspace so chart-dragging and
// position-tool execution stay in sync with these inputs.

import { toast } from 'sonner'
import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { OrderSizing } from './use-order-sizing'

interface TradingPanelProps {
  pair: string
  market: 'forex' | 'crypto'
  currentPrice: number | null
  openPositions: number
  sizing: OrderSizing
  slValue: string
  tpValue: string
  onSlChange: (v: string) => void
  onTpChange: (v: string) => void
  onMarketOrder: (side: 'buy' | 'sell', lots: number, sl: number | null, tp: number | null) => void
  onCloseAll: () => void
}

export function TradingPanel({
  pair,
  market,
  currentPrice,
  openPositions,
  sizing,
  slValue,
  tpValue,
  onSlChange,
  onTpChange,
  onMarketOrder,
  onCloseAll,
}: TradingPanelProps) {
  const { lotMode, setLotMode, lots, setLots, riskPct, setRiskPct } = sizing

  const priceDigits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5

  /** Effective lot size after applying the selected sizing mode */
  function effectiveLots(): number | null {
    const fixed = parseFloat(lots)
    if (!currentPrice) return null
    if (lotMode === 'fixed') {
      if (!Number.isFinite(fixed) || fixed <= 0) return null
      return fixed
    }
    const slNum = parseFloat(slValue)
    if (!Number.isFinite(slNum) || slNum <= 0) return null
    return sizing.effectiveLots(currentPrice, slNum)
  }

  function submitMarket(side: 'buy' | 'sell') {
    if (!currentPrice) return
    const size = effectiveLots()
    if (size === null) {
      toast.error(lotMode === 'risk_pct' && !slValue ? 'Risk-% sizing needs a stop loss.' : 'Invalid lot size.')
      return
    }
    const slNum = parseFloat(slValue)
    const tpNum = parseFloat(tpValue)

    // Sanity: SL must be on the losing side, TP on the winning side
    if (Number.isFinite(slNum) && slNum > 0) {
      if (side === 'buy' && slNum >= currentPrice) return void toast.error('Stop loss must be below price for a buy.')
      if (side === 'sell' && slNum <= currentPrice) return void toast.error('Stop loss must be above price for a sell.')
    }
    if (Number.isFinite(tpNum) && tpNum > 0) {
      if (side === 'buy' && tpNum <= currentPrice) return void toast.error('Take profit must be above price for a buy.')
      if (side === 'sell' && tpNum >= currentPrice) return void toast.error('Take profit must be below price for a sell.')
    }

    onMarketOrder(side, size, Number.isFinite(slNum) && slNum > 0 ? slNum : null, Number.isFinite(tpNum) && tpNum > 0 ? tpNum : null)
    onSlChange('')
    onTpChange('')
  }

  const shownLots = effectiveLots()

  return (
    <div className="space-y-3">
      {/* Sizing */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Lot mode</Label>
          <Tabs value={lotMode} onValueChange={(v) => v && setLotMode(v as typeof lotMode)}>
            <TabsList className="h-8 w-full bg-[#1C1E26]">
              <TabsTrigger value="fixed" className="flex-1 text-xs">Fixed</TabsTrigger>
              <TabsTrigger value="risk_pct" className="flex-1 text-xs">Risk %</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">{lotMode === 'fixed' ? 'Lot size' : 'Risk (% equity)'}</Label>
          {lotMode === 'fixed' ? (
            <Input type="number" step="any" min="0.01" value={lots} onChange={(e) => setLots(e.target.value)}
              className="h-8 border-[#27272A] font-mono" />
          ) : (
            <Input type="number" step="any" min="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)}
              className="h-8 border-[#27272A] font-mono" />
          )}
        </div>
      </div>

      {/* SL / TP — also draggable directly on the chart while this form is open */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Stop loss ◌</Label>
          <Input type="number" step="any" placeholder="none — drag on chart" value={slValue} onChange={(e) => onSlChange(e.target.value)}
            className="h-8 border-[#27272A] font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Take profit ◌</Label>
          <Input type="number" step="any" placeholder="none — drag on chart" value={tpValue} onChange={(e) => onTpChange(e.target.value)}
            className="h-8 border-[#27272A] font-mono" />
        </div>
      </div>

      {/* Buy / Sell / Close — the three primary actions */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => submitMarket('sell')}
            className="h-11 bg-[#FF4D4D] font-bold text-[#0A0B0E] hover:bg-[#FF4D4D]/90">
            SELL
          </Button>
          <Button onClick={() => submitMarket('buy')}
            className="h-11 bg-[#00FF9C] font-bold text-[#0A0B0E] hover:bg-[#00FF9C]/90">
            BUY
          </Button>
        </div>
        <Button onClick={onCloseAll} disabled={openPositions === 0} variant="outline"
          className="h-9 w-full border-[#FF4D4D]/40 text-xs text-[#FF4D4D] hover:bg-[#FF4D4D]/10 disabled:opacity-40">
          <XCircle className="mr-1 h-3.5 w-3.5" />
          Close Position{openPositions === 1 ? '' : 's'}{openPositions > 0 ? ` (${openPositions})` : ''}
        </Button>
      </div>

      <p className="font-mono text-[10px] text-zinc-500">
        {shownLots !== null ? `Size: ${shownLots} lots` : '—'} · spread applies to fills · price{' '}
        {currentPrice !== null ? currentPrice.toFixed(priceDigits) : '—'}
      </p>
    </div>
  )
}
