import type { Candle, ExecutionConfig, CompletedTrade, Position, OrderType } from '@/lib/types/backtest'

// ── Pip value helpers ─────────────────────────────────────────────────────────

/** Rough pip size: 0.0001 for forex (4-decimal), 0.01 for JPY pairs and crypto */
function pipSize(pair: string): number {
  if (pair.includes('JPY')) return 0.01
  if (pair.startsWith('XAU') || pair.startsWith('XAG')) return 0.01
  // Crypto pairs: 0.01 for most, 0.0001 for some stablecoins
  if (pair.includes('USD') && !pair.startsWith('EUR') && !pair.startsWith('GBP') && !pair.startsWith('AUD') && !pair.startsWith('NZD') && !pair.startsWith('CHF') && !pair.startsWith('CAD')) return 0.01
  return 0.0001
}

/** Calculate the pip value for 1 standard lot (100,000 units) */
function pipValuePerLot(pair: string): number {
  const ps = pipSize(pair)
  // For XXX/USD pairs, pip value = ps * 100,000
  // For USD/XXX pairs, pip value ≈ ps * 100,000 / rate (approximation)
  if (pair.startsWith('USD/')) {
    // Approximation: will be adjusted at execution time
    return ps * 100000
  }
  return ps * 100000
}

// ── Execution cost calculation ────────────────────────────────────────────────

export interface ExecutionCost {
  spread_cost: number
  slippage_cost: number
  commission: number
  swap: number
  effective_entry: number
}

/**
 * Calculate execution costs applied at trade entry.
 * Returns the effective entry price and all cost components.
 */
export function calculateEntryCosts(
  entryPrice: number,
  direction: 'long' | 'short',
  lotSize: number,
  config: ExecutionConfig,
  pair: string,
): ExecutionCost {
  const ps = pipSize(pair)

  // Spread: long gets ask (close + spread/2), short gets bid (close - spread/2)
  const spreadPriceShift = (config.spread_pips * ps) / 2
  const slippagePriceShift = config.slippage_pips * ps

  let effectiveEntry: number
  if (direction === 'long') {
    effectiveEntry = entryPrice + spreadPriceShift + slippagePriceShift
  } else {
    effectiveEntry = entryPrice - spreadPriceShift - slippagePriceShift
  }

  const spreadCost = config.spread_pips * ps * lotSize
  const slippageCost = config.slippage_pips * ps * lotSize
  const commission = config.commission_per_lot * lotSize

  return {
    spread_cost: spreadCost,
    slippage_cost: slippageCost,
    commission,
    swap: 0, // Swap is calculated at close based on holding duration
    effective_entry: effectiveEntry,
  }
}

/**
 * Calculate swap (overnight financing) cost.
 * Assumes holding period in days from entry to exit.
 */
export function calculateSwap(
  direction: 'long' | 'short',
  lotSize: number,
  entryDate: string,
  exitDate: string,
  config: ExecutionConfig,
): number {
  const entry = new Date(entryDate)
  const exit = new Date(exitDate)
  const daysHeld = Math.max(1, Math.ceil((exit.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24)))

  const swapRate = direction === 'long' ? config.swap_long_per_day : config.swap_short_per_day
  return swapRate * lotSize * daysHeld
}

// ── Margin calculation ────────────────────────────────────────────────────────

export function marginRequirement(
  entryPrice: number,
  lotSize: number,
  leverage: number,
): number {
  // Margin = (lotSize * 100000 * entryPrice) / leverage
  return (lotSize * 100000 * entryPrice) / leverage
}

export function canOpenPosition(
  equity: number,
  entryPrice: number,
  lotSize: number,
  leverage: number,
): boolean {
  const margin = marginRequirement(entryPrice, lotSize, leverage)
  return equity > margin * 1.1 // 10% margin buffer
}

// ── Position sizing ──────────────────────────────────────────────────────────

export interface PositionSizingParams {
  method: 'fixed_lot' | 'risk_based' | 'percent_equity'
  value?: number
  riskPct: number
  equity: number
  entryPrice: number
  stopLoss: number | null
  pair: string
}

/**
 * Calculate lot size based on the position sizing method.
 */
export function calculateLotSize(params: PositionSizingParams): number {
  const { method, value, riskPct, equity, entryPrice, stopLoss, pair } = params

  switch (method) {
    case 'fixed_lot':
      return value ?? 0.1

    case 'percent_equity': {
      const pct = (value ?? 2) / 100
      const notional = equity * pct
      // lot = notional / (contract_size * price)
      return notional / (100000 * entryPrice)
    }

    case 'risk_based': {
      const riskAmount = equity * (riskPct / 100)
      if (stopLoss === null) {
        // No SL — default to 1% of price as risk distance
        const riskDistance = entryPrice * 0.01
        return riskDistance > 0 ? riskAmount / (riskDistance * 100000) : 0.01
      }
      const riskDistance = Math.abs(entryPrice - stopLoss)
      return riskDistance > 0 ? riskAmount / (riskDistance * 100000) : 0.01
    }

    default:
      return 0.01
  }
}

// ── SL/TP price calculation ──────────────────────────────────────────────────

export interface SlTpParams {
  method: string
  value?: number
  rr_ratio?: number
  atr_multiplier?: number
  entryPrice: number
  direction: 'long' | 'short'
  atrValue: number | null
  pair: string
  candles?: Candle[]      // needed for swing_low_high
  barIndex?: number       // needed for swing_low_high
}

export function calculateStopLoss(params: SlTpParams): number | null {
  const { method, value, atr_multiplier, entryPrice, direction, atrValue, pair, candles, barIndex } = params
  const ps = pipSize(pair)

  switch (method) {
    case 'fixed_pips': {
      const pips = value ?? 50
      return direction === 'long'
        ? entryPrice - pips * ps
        : entryPrice + pips * ps
    }
    case 'atr_based': {
      if (atrValue === null || isNaN(atrValue)) return null
      const mult = atr_multiplier ?? 1.5
      return direction === 'long'
        ? entryPrice - atrValue * mult
        : entryPrice + atrValue * mult
    }
    case 'swing_low_high': {
      if (!candles || barIndex === undefined || barIndex < 0) return null
      const lookback = value ?? 20 // value = number of bars to look back for swing points
      const startIdx = Math.max(0, barIndex - lookback)
      const endIdx = barIndex

      if (direction === 'long') {
        // Find the lowest low in the lookback window (swing low)
        let swingLow = Infinity
        for (let i = startIdx; i <= endIdx; i++) {
          if (candles[i].low < swingLow) swingLow = candles[i].low
        }
        return swingLow === Infinity ? null : swingLow
      } else {
        // Find the highest high in the lookback window (swing high)
        let swingHigh = -Infinity
        for (let i = startIdx; i <= endIdx; i++) {
          if (candles[i].high > swingHigh) swingHigh = candles[i].high
        }
        return swingHigh === -Infinity ? null : swingHigh
      }
    }
    case 'indicator':
      return null // SL from indicator value set externally
    default:
      return null
  }
}

export function calculateTakeProfit(
  slParams: SlTpParams & { stopLoss: number | null },
): number | null {
  const { method, value, rr_ratio, atr_multiplier, entryPrice, direction, atrValue, pair, stopLoss } = slParams
  const ps = pipSize(pair)

  switch (method) {
    case 'fixed_pips': {
      const pips = value ?? 100
      return direction === 'long'
        ? entryPrice + pips * ps
        : entryPrice - pips * ps
    }
    case 'risk_reward': {
      if (stopLoss === null) return null
      const rr = rr_ratio ?? 2
      const riskDistance = Math.abs(entryPrice - stopLoss)
      return direction === 'long'
        ? entryPrice + riskDistance * rr
        : entryPrice - riskDistance * rr
    }
    case 'atr_based': {
      if (atrValue === null || isNaN(atrValue)) return null
      const mult = atr_multiplier ?? 2
      return direction === 'long'
        ? entryPrice + atrValue * mult
        : entryPrice - atrValue * mult
    }
    default:
      return null
  }
}

// ── PnL calculation ──────────────────────────────────────────────────────────

export function calculatePnL(
  direction: 'long' | 'short',
  effectiveEntry: number,
  exitPrice: number,
  lotSize: number,
): { pnlUsd: number; pnlPips: number } {
  const priceDiff = direction === 'long'
    ? exitPrice - effectiveEntry
    : effectiveEntry - exitPrice

  const pnlUsd = priceDiff * lotSize * 100000
  const ps = 0.0001 // approximate
  const pnlPips = priceDiff / ps

  return {
    pnlUsd: Math.round(pnlUsd * 100) / 100,
    pnlPips: Math.round(pnlPips * 10) / 10,
  }
}
