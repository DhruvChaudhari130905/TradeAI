// Pure execution math for manual replay trading.
// Conventions:
// - Quotes are treated as mid prices; spread is applied half per side.
//   Buy fills at ask (mid + halfSpread), sell fills at bid (mid - halfSpread).
// - Forex PnL uses the standard-lot convention (100k units); USD-quoted pairs
//   convert exactly, JPY-quoted pairs divide by price, non-USD crosses fall back
//   to the USD-quote approximation (no cross rate data available in replay).
// - Crypto "lots" are whole coins: PnL = (exit − entry) × lots, margin = notional / leverage.

import type { ReplayPosition } from '@/lib/types/replay'

export function isCrypto(market: 'forex' | 'crypto'): boolean {
  return market === 'crypto'
}

/** Smallest quoted increment used as a "pip" for the pair */
export function pipSize(pair: string, market: 'forex' | 'crypto'): number {
  if (market === 'crypto') return 1
  if (pair.includes('JPY')) return 0.01
  return 0.0001
}

/** Half-spread expressed as an absolute price offset */
export function halfSpreadPrice(pair: string, market: 'forex' | 'crypto', spreadPips: number): number {
  return (spreadPips * pipSize(pair, market)) / 2
}

/** Fill price for a market order at the given mid quote */
export function fillPrice(
  side: 'buy' | 'sell',
  mid: number,
  pair: string,
  market: 'forex' | 'crypto',
  spreadPips: number,
): number {
  const hs = halfSpreadPrice(pair, market, spreadPips)
  return side === 'buy' ? mid + hs : mid - hs
}

/** USD value of one pip for one standard lot (approximate for non-USD crosses) */
export function pipValuePerLot(pair: string, market: 'forex' | 'crypto', price: number): number {
  if (market === 'crypto') return 1 // unused for crypto PnL path
  const ps = pipSize(pair, market)
  const raw = ps * 100000 // e.g. $10/pip/lot for EUR/USD
  if (pair.includes('JPY')) return raw / price // JPY quote → USD at pair rate
  return raw
}

/**
 * PnL between two FILL prices (both already spread-applied).
 * Returns rounded USD and pip values.
 */
export function tradePnl(
  direction: 'long' | 'short',
  pair: string,
  market: 'forex' | 'crypto',
  entryFill: number,
  exitFill: number,
  lotSize: number,
): { pnlUsd: number; pnlPips: number } {
  const diff = direction === 'long' ? exitFill - entryFill : entryFill - exitFill
  const ps = pipSize(pair, market)

  let pnlUsd: number
  if (market === 'crypto') {
    pnlUsd = diff * lotSize
  } else {
    pnlUsd = (diff / ps) * pipValuePerLot(pair, market, entryFill) * lotSize
  }

  return {
    pnlUsd: Math.round(pnlUsd * 100) / 100,
    pnlPips: Math.round((diff / ps) * 10) / 10,
  }
}

/** Floating PnL of an open position at the current mid quote (display only —
 *  assumes a close at mid, ignoring exit-side spread). */
export function floatingPnl(
  position: Pick<ReplayPosition, 'direction' | 'entryPrice' | 'lotSize'>,
  mid: number,
  pair: string,
  market: 'forex' | 'crypto',
): number {
  const diff = position.direction === 'long' ? mid - position.entryPrice : position.entryPrice - mid
  if (market === 'crypto') return diff * position.lotSize
  const ps = pipSize(pair, market)
  return (diff / ps) * pipValuePerLot(pair, market, position.entryPrice) * position.lotSize
}

/** Initial margin required for a position */
export function marginFor(
  entryPrice: number,
  lotSize: number,
  leverage: number,
  market: 'forex' | 'crypto',
): number {
  const contract = market === 'crypto' ? 1 : 100000
  return (lotSize * contract * entryPrice) / leverage
}

/** Total margin locked by all open positions */
export function usedMargin(positions: ReplayPosition[], leverage: number, market: 'forex' | 'crypto'): number {
  return positions.reduce(
    (sum, p) => sum + marginFor(p.entryPrice, p.lotSize, leverage, market),
    0,
  )
}

export const STOP_OUT_MARGIN_LEVEL = 0.5

/** True when equity has fallen to 50% of used margin — broker stop-out */
export function isStopOut(equity: number, used: number): boolean {
  return used > 0 && equity <= used * STOP_OUT_MARGIN_LEVEL
}

/** Round lot size to a sane precision (min 0.01) */
export function roundLots(lots: number): number {
  return Math.max(0.01, Math.round(lots * 100) / 100)
}
