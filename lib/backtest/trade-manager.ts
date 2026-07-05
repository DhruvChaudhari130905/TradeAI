import type { Candle, Position, TradeManagementRule, CompletedTrade, PartialExit, ExecutionConfig } from '@/lib/types/backtest'
import type { IndicatorSeries } from './indicators'
import { resolveIndicator } from './indicators'
import { calculatePnL, calculateSwap } from './execution-simulator'

/**
 * Apply trade management rules to an open position on each new bar.
 * Returns true if the position was partially or fully closed.
 */
export function applyTradeManagement(
  position: Position,
  candle: Candle,
  rules: TradeManagementRule[],
  indicators: Map<string, number[] | IndicatorSeries>,
  barIndex: number,
  config: { swap_long_per_day: number; swap_short_per_day: number },
): { closed: boolean; reason?: string; partialClose?: PartialExit } {
  if (!position.isOpen || !position.direction || position.entryPrice === null) {
    return { closed: false }
  }

  for (const rule of rules) {
    switch (rule.type) {
      case 'trailing_stop': {
        const moved = applyTrailingStop(position, candle, rule.params)
        if (moved) continue
        break
      }
      case 'break_even': {
        applyBreakEven(position, candle, rule.params)
        break
      }
      case 'partial_exit': {
        const partial = checkPartialExit(position, candle, rule.params)
        if (partial) {
          return { closed: false, partialClose: partial }
        }
        break
      }
      case 'move_sl_to_entry': {
        applyMoveSlToEntry(position, candle, rule.params)
        break
      }
    }
  }

  // Check if SL or TP was hit after management rules moved SL
  return { closed: false }
}

// ── Trailing Stop ────────────────────────────────────────────────────────────

/**
 * Trailing stop: moves SL in the favorable direction when price has moved
 * activation_r R-multiples in profit. Trail is a percentage of the favorable move.
 */
function applyTrailingStop(
  position: Position,
  candle: Candle,
  params: Record<string, number>,
): boolean {
  if (!position.isOpen || !position.direction || position.entryPrice === null || position.initialRisk === 0) {
    return false
  }

  const activationR = params.activation_r ?? 1.0
  const trailPct = params.trail_pct ?? 0.5

  const unrealizedR = getUnrealizedR(position, candle)

  // Only activate after reaching activation R-multiple
  if (unrealizedR < activationR) return false

  if (position.direction === 'long') {
    const newSL = candle.high - trailPct * (candle.high - position.entryPrice)
    // SL only moves up, never down
    if (position.stopLoss === null || newSL > position.stopLoss) {
      position.stopLoss = newSL
      return true
    }
  } else {
    const newSL = candle.low + trailPct * (position.entryPrice - candle.low)
    // SL only moves down for shorts, never up
    if (position.stopLoss === null || newSL < position.stopLoss) {
      position.stopLoss = newSL
      return true
    }
  }

  return false
}

// ── Break Even ───────────────────────────────────────────────────────────────

/**
 * Move SL to entry price when unrealized R-multiple reaches activation_r.
 */
function applyBreakEven(
  position: Position,
  candle: Candle,
  params: Record<string, number>,
): void {
  if (!position.isOpen || !position.direction || position.entryPrice === null || position.initialRisk === 0) {
    return
  }

  const activationR = params.activation_r ?? 1.0
  const unrealizedR = getUnrealizedR(position, candle)

  if (unrealizedR >= activationR) {
    // Move SL to entry (plus a tiny buffer for spread)
    position.stopLoss = position.entryPrice
  }
}

// ── Move SL to Entry ────────────────────────────────────────────────────────

/**
 * Similar to break_even but with a specific activation R.
 */
function applyMoveSlToEntry(
  position: Position,
  candle: Candle,
  params: Record<string, number>,
): void {
  applyBreakEven(position, candle, {
    activation_r: params.activation_r ?? 1.0,
  })
}

// ── Partial Exit ─────────────────────────────────────────────────────────────

/**
 * Check if price has reached the R-multiple target for partial exit.
 * Returns a PartialExit record if triggered.
 */
function checkPartialExit(
  position: Position,
  candle: Candle,
  params: Record<string, number>,
): PartialExit | null {
  if (!position.isOpen || !position.direction || position.entryPrice === null || position.initialRisk === 0) {
    return null
  }

  const targetR = params.r_multiple ?? 2.0
  const closePct = params.close_pct ?? 50
  const unrealizedR = getUnrealizedR(position, candle)

  if (unrealizedR < targetR) return null

  // Calculate partial exit PnL
  const exitPrice = position.direction === 'long' ? candle.high : candle.low
  const { pnlUsd } = calculatePnL(
    position.direction,
    position.entryPrice,
    exitPrice,
    position.lotSize * (closePct / 100),
  )

  // Record the partial exit
  const partial: PartialExit = {
    r_multiple: targetR,
    close_pct: closePct,
    pnl: Math.round(pnlUsd * 100) / 100,
  }

  // Reduce lot size
  position.lotSize *= (1 - closePct / 100)
  position.partialExits = [...(position.partialExits ?? []), partial]

  return partial
}

// ── Check SL/TP hit ──────────────────────────────────────────────────────────

/**
 * Check if an open position's SL or TP was hit by candle price action.
 * Returns the exit details if hit, null otherwise.
 */
export function checkSLTPHit(
  position: Position,
  candle: Candle,
): { price: number; reason: string } | null {
  if (!position.isOpen || !position.direction) return null

  if (position.direction === 'long') {
    if (position.stopLoss !== null && candle.low <= position.stopLoss) {
      return { price: position.stopLoss, reason: 'Stop loss hit' }
    }
    if (position.takeProfit !== null && candle.high >= position.takeProfit) {
      return { price: position.takeProfit, reason: 'Take profit hit' }
    }
  } else {
    if (position.stopLoss !== null && candle.high >= position.stopLoss) {
      return { price: position.stopLoss, reason: 'Stop loss hit' }
    }
    if (position.takeProfit !== null && candle.low <= position.takeProfit) {
      return { price: position.takeProfit, reason: 'Take profit hit' }
    }
  }

  return null
}

/**
 * Close a position and return a CompletedTrade record.
 */
export function closePosition(
  position: Position,
  exitPrice: number,
  exitReason: string,
  exitTime: string,
  config: ExecutionConfig,
  pair: string,
): CompletedTrade {
  if (!position.direction || position.entryPrice === null) {
    // Shouldn't happen — return a zero trade
    return {
      direction: 'long',
      entryPrice: 0,
      entryTime: '',
      exitPrice: 0,
      exitTime,
      stopLoss: null,
      takeProfit: null,
      pnlUsd: 0,
      pnlPips: 0,
      exitReason,
      lotSize: 0,
      commission: 0,
      swap: 0,
      slippage_cost: 0,
      initial_risk: 0,
      r_multiple: 0,
      entryType: 'market',
      partial_exits: [],
    }
  }

  const { pnlUsd, pnlPips } = calculatePnL(
    position.direction,
    position.entryPrice,
    exitPrice,
    position.lotSize,
  )

  const swap = calculateSwap(
    position.direction,
    position.lotSize,
    position.entryTime ?? exitTime,
    exitTime,
    config,
  )

  const commission = config.commission_per_lot * position.lotSize
  const slippageCost = config.slippage_pips * 0.0001 * position.lotSize * 100000

  const totalPnl = pnlUsd - commission - swap - slippageCost

  const initialRisk = position.initialRisk
  const rMultiple = initialRisk > 0 ? totalPnl / initialRisk : 0

  return {
    direction: position.direction,
    entryPrice: position.entryPrice,
    entryTime: position.entryTime ?? '',
    exitPrice,
    exitTime,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    pnlUsd: Math.round(totalPnl * 100) / 100,
    pnlPips,
    exitReason,
    lotSize: Math.round(position.lotSize * 10000) / 10000,
    commission: Math.round(commission * 100) / 100,
    swap: Math.round(swap * 100) / 100,
    slippage_cost: Math.round(slippageCost * 100) / 100,
    initial_risk: Math.round(initialRisk * 100) / 100,
    r_multiple: Math.round(rMultiple * 100) / 100,
    entryType: 'market',
    partial_exits: position.partialExits ?? [],
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate unrealized R-multiple for a position at the current candle.
 */
function getUnrealizedR(position: Position, candle: Candle): number {
  if (!position.direction || position.entryPrice === null || position.initialRisk === 0) return 0

  const unrealizedPnl = position.direction === 'long'
    ? candle.close - position.entryPrice
    : position.entryPrice - candle.close

  const unrealizedUsd = unrealizedPnl * position.lotSize * 100000
  return unrealizedUsd / position.initialRisk
}
