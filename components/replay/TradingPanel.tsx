'use client'

// Order entry: market buy/sell with SL/TP + sizing, pending limit/stop orders.

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pipSize, pipValuePerLot } from '@/lib/replay/execution'

interface TradingPanelProps {
  pair: string
  market: 'forex' | 'crypto'
  currentPrice: number | null
  equity: number
  onMarketOrder: (side: 'buy' | 'sell', lots: number, sl: number | null, tp: number | null) => void
  onPendingOrder: (order: {
    type: 'limit' | 'stop'
    side: 'buy' | 'sell'
    price: number
    lotSize: number
    stopLoss: number | null
    takeProfit: number | null
  }) => void
}

type LotMode = 'fixed' | 'risk_pct'

export function TradingPanel({
  pair,
  market,
  currentPrice,
  equity,
  onMarketOrder,
  onPendingOrder,
}: TradingPanelProps) {
  const [lotMode, setLotMode] = useState<LotMode>('fixed')
  const [lots, setLots] = useState('0.1')
  const [riskPct, setRiskPct] = useState('1')
  const [slPrice, setSlPrice] = useState('')
  const [tpPrice, setTpPrice] = useState('')

  // Pending order state
  const [orderType, setOrderType] = useState<'limit' | 'stop'>('limit')
  const [trigger, setTrigger] = useState('')

  const priceDigits = market === 'crypto' ? 2 : pair.includes('JPY') ? 3 : 5

  /** Effective lot size after applying the selected sizing mode */
  function effectiveLots(): number | null {
    const fixed = parseFloat(lots)
    if (lotMode === 'fixed') {
      if (!Number.isFinite(fixed) || fixed <= 0) return null
      return fixed
    }
    // risk % of equity over the SL distance in pips
    const risk = parseFloat(riskPct)
    if (!Number.isFinite(risk) || risk <= 0) return null
    if (!currentPrice) return null

    const slNum = parseFloat(slPrice)
    let slDistance: number
    if (Number.isFinite(slNum) && slNum > 0) {
      slDistance = Math.abs(currentPrice - slNum)
    } else {
      return null
    }
    const ps = pipSize(pair, market)
    const distancePips = slDistance / ps
    if (distancePips <= 0) return null

    const riskUsd = equity * (risk / 100)
    const perLotPerPip = pipValuePerLot(pair, market, currentPrice)
    return Math.max(0.01, Math.floor((riskUsd / (distancePips * perLotPerPip)) * 100) / 100)
  }

  function submitMarket(side: 'buy' | 'sell') {
    if (!currentPrice) return
    const size = effectiveLots()
    if (size === null) {
      toast.error(lotMode === 'risk_pct' && !slPrice ? 'Risk-% sizing needs a stop loss.' : 'Invalid lot size.')
      return
    }
    const slNum = parseFloat(slPrice)
    const tpNum = parseFloat(tpPrice)

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
    setSlPrice('')
    setTpPrice('')
  }

  function submitPending(side: 'buy' | 'sell') {
    if (!currentPrice) return
    const size = effectiveLots()
    const triggerNum = parseFloat(trigger)
    if (size === null || !Number.isFinite(triggerNum) || triggerNum <= 0) {
      toast.error('Enter a valid trigger price and lot size.')
      return
    }

    // Limit buys below / sells above; stop buys above / sells below
    if (orderType === 'limit') {
      if (side === 'buy' && triggerNum >= currentPrice) return void toast.error('Buy limit must be below current price.')
      if (side === 'sell' && triggerNum <= currentPrice) return void toast.error('Sell limit must be above current price.')
    } else {
      if (side === 'buy' && triggerNum <= currentPrice) return void toast.error('Buy stop must be above current price.')
      if (side === 'sell' && triggerNum >= currentPrice) return void toast.error('Sell stop must be below current price.')
    }

    const slNum = parseFloat(slPrice)
    const tpNum = parseFloat(tpPrice)
    onPendingOrder({
      type: orderType,
      side,
      price: triggerNum,
      lotSize: size,
      stopLoss: Number.isFinite(slNum) && slNum > 0 ? slNum : null,
      takeProfit: Number.isFinite(tpNum) && tpNum > 0 ? tpNum : null,
    })
    setTrigger('')
    setSlPrice('')
    setTpPrice('')
  }

  const shownLots = effectiveLots()

  return (
    <div className="space-y-3">
      {/* Sizing */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Lot mode</Label>
          <Tabs value={lotMode} onValueChange={(v) => v && setLotMode(v as LotMode)}>
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

      {/* SL / TP */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Stop loss</Label>
          <Input type="number" step="any" placeholder="none" value={slPrice} onChange={(e) => setSlPrice(e.target.value)}
            className="h-8 border-[#27272A] font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Take profit</Label>
          <Input type="number" step="any" placeholder="none" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)}
            className="h-8 border-[#27272A] font-mono" />
        </div>
      </div>

      {/* Pending order controls */}
      <div className="rounded-md border border-[#27272A] p-2.5">
        <Tabs value={orderType} onValueChange={(v) => v && setOrderType(v as 'limit' | 'stop')}>
          <TabsList className="mb-2 h-7 w-full bg-[#1C1E26]">
            <TabsTrigger value="limit" className="flex-1 text-xs">Limit</TabsTrigger>
            <TabsTrigger value="stop" className="flex-1 text-xs">Stop</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input type="number" step="any" placeholder={`Trigger price (${orderType})`} value={trigger}
          onChange={(e) => setTrigger(e.target.value)} className="h-8 border-[#27272A] font-mono" />
      </div>

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => submitPending('sell')} variant="outline"
          className="h-9 border-[#FF4D4D]/40 text-xs text-[#FF4D4D] hover:bg-[#FF4D4D]/10">
          <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Pending Sell
        </Button>
        <Button onClick={() => submitPending('buy')} variant="outline"
          className="h-9 border-[#00FF9C]/40 text-xs text-[#00FF9C] hover:bg-[#00FF9C]/10">
          <ArrowUpToLine className="mr-1 h-3.5 w-3.5" /> Pending Buy
        </Button>
        <Button onClick={() => submitMarket('sell')}
          className="h-11 bg-[#FF4D4D] font-bold text-[#0A0B0E] hover:bg-[#FF4D4D]/90">
          SELL
        </Button>
        <Button onClick={() => submitMarket('buy')}
          className="h-11 bg-[#00FF9C] font-bold text-[#0A0B0E] hover:bg-[#00FF9C]/90">
          BUY
        </Button>
      </div>

      <p className="font-mono text-[10px] text-zinc-500">
        {shownLots !== null ? `Size: ${shownLots} lots` : '—'} · spread applies to fills · price{' '}
        {currentPrice !== null ? currentPrice.toFixed(priceDigits) : '—'}
      </p>
    </div>
  )
}
