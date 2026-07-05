import type { Candle } from '@/lib/types/backtest'

// ── Price-action levels & market structure (computed once per backtest) ─────────
//
// The flat engine only knew numeric indicator series; it had no notion of
// tradeable *levels* (swing highs/lows, previous-day H/L) or structural *events*
// built on them. strategies reference those by name (swing_high, prev_day_low…)
// and previously resolved to nothing → silent 0 trades. computeLevels produces the
// canonical level/structure series so the expression engine can resolve them.
//
// Everything here is CAUSAL: a swing at bar k is only "known" at bar k+strength
// (needs `strength` bars on the right to confirm). No lookahead.

export interface SwingPivot {
  index: number
  price: number
  side: 'high' | 'low'
}

export interface LevelSeriesResult {
  swingPivots: SwingPivot[]
  /** Most recent confirmed swing-high price known at bar i (NaN before first). */
  swingHigh: number[]
  /** Most recent confirmed swing-low price known at bar i. */
  swingLow: number[]
  /** Second-most-recent confirmed swing-high price known at bar i. */
  prevSwingHigh: number[]
  /** Second-most-recent confirmed swing-low price known at bar i. */
  prevSwingLow: number[]
  /** Previous calendar day's high, as of bar i (NaN on the first day). */
  prevDayHigh: number[]
  /** Previous calendar day's low, as of bar i. */
  prevDayLow: number[]
  /** Previous calendar day's open, as of bar i. */
  prevDayOpen: number[]
  /** 'up' = HH+HL, 'down' = LH+LL, null = mixed or insufficient pivots. */
  structureTrend: ('up' | 'down' | null)[]
}

export interface ComputeLevelsOptions {
  /** Bars on each side a pivot must dominate to count as a swing. Default 3. */
  swingStrength?: number
}

export function computeLevels(
  candles: Candle[],
  opts: ComputeLevelsOptions = {},
): LevelSeriesResult {
  const strength = opts.swingStrength ?? 3
  const n = candles.length

  // ── 1. Detect pivots over the whole series ──────────────────────────────
  const swingPivots: SwingPivot[] = []
  for (let k = strength; k < n - strength; k++) {
    const hi = candles[k].high
    const lo = candles[k].low
    let isHigh = true
    let isLow = true
    for (let j = k - strength; j <= k + strength; j++) {
      if (j === k) continue
      if (candles[j].high >= hi) isHigh = false
      if (candles[j].low <= lo) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) swingPivots.push({ index: k, price: hi, side: 'high' })
    if (isLow) swingPivots.push({ index: k, price: lo, side: 'low' })
  }

  // ── 2. Build causal "most recent / second-most-recent confirmed" series ─
  const swingHigh = new Array<number>(n).fill(NaN)
  const swingLow = new Array<number>(n).fill(NaN)
  const prevSwingHigh = new Array<number>(n).fill(NaN)
  const prevSwingLow = new Array<number>(n).fill(NaN)
  const structureTrend: ('up' | 'down' | null)[] = new Array(n).fill(null)

  let lastHighIdx = -1
  let secondHighIdx = -1
  let lastLowIdx = -1
  let secondLowIdx = -1

  // Walk bars in order; a pivot becomes "confirmed" once bar >= pivot.index + strength.
  let pivotPtr = 0
  for (let i = 0; i < n; i++) {
    // Admit any pivots confirmed by bar i
    while (pivotPtr < swingPivots.length && swingPivots[pivotPtr].index + strength <= i) {
      const p = swingPivots[pivotPtr]
      if (p.side === 'high') {
        if (lastHighIdx === -1) {
          lastHighIdx = p.index
        } else if (p.index !== lastHighIdx) {
          secondHighIdx = lastHighIdx
          lastHighIdx = p.index
        }
      } else {
        if (lastLowIdx === -1) {
          lastLowIdx = p.index
        } else if (p.index !== lastLowIdx) {
          secondLowIdx = lastLowIdx
          lastLowIdx = p.index
        }
      }
      pivotPtr++
    }
    if (lastHighIdx !== -1) swingHigh[i] = candles[lastHighIdx].high
    if (lastLowIdx !== -1) swingLow[i] = candles[lastLowIdx].low
    if (secondHighIdx !== -1) prevSwingHigh[i] = candles[secondHighIdx].high
    if (secondLowIdx !== -1) prevSwingLow[i] = candles[secondLowIdx].low

    // Structure trend from the last two confirmed highs/lows (HH&HL → up, LH&LL → down)
    if (lastHighIdx !== -1 && secondHighIdx !== -1 && lastLowIdx !== -1 && secondLowIdx !== -1) {
      const higherHigh = swingHigh[i] > prevSwingHigh[i]
      const higherLow = swingLow[i] > prevSwingLow[i]
      const lowerHigh = swingHigh[i] < prevSwingHigh[i]
      const lowerLow = swingLow[i] < prevSwingLow[i]
      if (higherHigh && higherLow) structureTrend[i] = 'up'
      else if (lowerHigh && lowerLow) structureTrend[i] = 'down'
    }
  }

  // ── 3. Previous calendar day high/low/open (UTC) ─────────────────────────
  const prevDayHigh = new Array<number>(n).fill(NaN)
  const prevDayLow = new Array<number>(n).fill(NaN)
  const prevDayOpen = new Array<number>(n).fill(NaN)

  // Batch per UTC day, accumulating H/L/open for that day, then assign to next day.
  let curDay = ''
  let dayHigh = -Infinity
  let dayLow = Infinity
  let dayOpen = NaN
  let prevDayH = NaN
  let prevDayL = NaN
  let prevDayO = NaN

  for (let i = 0; i < n; i++) {
    const day = candles[i].time.slice(0, 10) // "YYYY-MM-DD"
    if (day !== curDay) {
      // Roll: previous day's stats become "prev" for the new day
      if (curDay !== '') {
        prevDayH = dayHigh
        prevDayL = dayLow
        prevDayO = dayOpen
      }
      curDay = day
      dayHigh = candles[i].high
      dayLow = candles[i].low
      dayOpen = candles[i].open
    } else {
      dayHigh = Math.max(dayHigh, candles[i].high)
      dayLow = Math.min(dayLow, candles[i].low)
      // First candle of the day sets the open
    }
    prevDayHigh[i] = prevDayH
    prevDayLow[i] = prevDayL
    prevDayOpen[i] = prevDayO
  }

  return {
    swingPivots,
    swingHigh,
    swingLow,
    prevSwingHigh,
    prevSwingLow,
    prevDayHigh,
    prevDayLow,
    prevDayOpen,
    structureTrend,
  }
}
