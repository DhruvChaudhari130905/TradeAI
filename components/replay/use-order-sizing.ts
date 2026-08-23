'use client'

// Shared order-sizing state: lives in ReplayWorkspace so hotkeys, the trading
// panel, and position-tool execution all size orders the same way.

import { useState } from 'react'
import { pipSize, pipValuePerLot } from '@/lib/replay/execution'

export type LotMode = 'fixed' | 'risk_pct'

export interface OrderSizing {
  lotMode: LotMode
  setLotMode: (m: LotMode) => void
  lots: string
  setLots: (v: string) => void
  riskPct: string
  setRiskPct: (v: string) => void
  /** Lots for a market order at `price` with optional SL; null when invalid.
   *  Risk-% mode needs slPrice. */
  effectiveLots: (price: number, slPrice?: number | null) => number | null
}

export function useOrderSizing(
  pair: string,
  market: 'forex' | 'crypto',
  equity: number,
): OrderSizing {
  const [lotMode, setLotMode] = useState<LotMode>('fixed')
  const [lots, setLots] = useState('0.1')
  const [riskPct, setRiskPct] = useState('1')

  function effectiveLots(price: number, slPrice?: number | null): number | null {
    const fixed = parseFloat(lots)
    if (lotMode === 'fixed') {
      if (!Number.isFinite(fixed) || fixed <= 0) return null
      return fixed
    }
    const risk = parseFloat(riskPct)
    if (!Number.isFinite(risk) || risk <= 0 || !slPrice) return null

    const distancePips = Math.abs(price - slPrice) / pipSize(pair, market)
    if (distancePips <= 0) return null

    const riskUsd = equity * (risk / 100)
    const perLotPerPip = pipValuePerLot(pair, market, price)
    return Math.max(0.01, Math.floor((riskUsd / (distancePips * perLotPerPip)) * 100) / 100)
  }

  return { lotMode, setLotMode, lots, setLots, riskPct, setRiskPct, effectiveLots }
}
