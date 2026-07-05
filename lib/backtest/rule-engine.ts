import type { Candle, Condition, ConditionType } from '@/lib/types/backtest'
import type { IndicatorSeries } from './indicators'
import { resolveIndicator } from './indicators'

// ── Main entry: evaluate all conditions (AND logic) ───────────────────────────

/**
 * Instantaneous trigger conditions: only meaningful on a single bar (a crossover
 * happens once, a candle pattern is one candle). These are evaluated strictly on
 * the current bar.
 */
const TRIGGER_CONDITION_TYPES: Set<ConditionType> = new Set<ConditionType>([
  'candle_pattern',
  'indicator_cross_above',
  'indicator_cross_below',
])

/** Single source of truth for which legacy condition types are instant triggers
 *  (evaluated only on the current bar) vs. state conditions (may hold over a
 *  window). Shared by this engine and the expression DSL engine (expr-engine.ts). */
export { TRIGGER_CONDITION_TYPES }

/**
 * How many recent bars a "setup" (state) condition may have been satisfied within
 * before a trigger fires on the current bar. Realistic entries are setup+trigger:
 * e.g. an uptrend + RSI pullback (state, develops over bars) followed by a bullish
 * engulfing (trigger, one bar). Requiring the setup to hold on the exact trigger
 * bar makes such strategies never fire, so state conditions get this lookback
 * window while triggers stay strict. Applies to entry evaluation only.
 */
export const ENTRY_SETUP_LOOKBACK = 4

/**
 * Evaluate all conditions for a given bar. Returns true only if ALL conditions are met.
 *
 * With `opts.entryLookback`, state conditions (every type except the triggers in
 * TRIGGER_CONDITION_TYPES) pass if they held at any point within the preceding
 * `entryLookback` bars ending at `barIndex`; trigger conditions must fire on
 * `barIndex` itself. This models setup+trigger entry semantics. Without opts
 * (exits, invalidation) every condition is strict on `barIndex` — unchanged.
 */
export function evaluateAllConditions(
  conditions: Condition[],
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
  opts?: { entryLookback?: number },
): boolean {
  if (conditions.length === 0) return false
  return conditions.every((c) => {
    if (opts?.entryLookback && !TRIGGER_CONDITION_TYPES.has(c.type)) {
      for (let j = Math.max(0, barIndex - opts.entryLookback + 1); j <= barIndex; j++) {
        if (evaluateCondition(c, j, indicators, candles)) return true
      }
      return false
    }
    return evaluateCondition(c, barIndex, indicators, candles)
  })
}

/**
 * Evaluate a single condition at a specific bar index.
 */
export function evaluateCondition(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
): boolean {
  switch (condition.type) {
    case 'indicator_cross_above':
      return evalIndicatorCrossAbove(condition, barIndex, indicators)
    case 'indicator_cross_below':
      return evalIndicatorCrossBelow(condition, barIndex, indicators)
    case 'indicator_above':
      return evalIndicatorAbove(condition, barIndex, indicators)
    case 'indicator_below':
      return evalIndicatorBelow(condition, barIndex, indicators)
    case 'price_above':
      return evalPriceAbove(condition, barIndex, indicators, candles)
    case 'price_below':
      return evalPriceBelow(condition, barIndex, indicators, candles)
    case 'rsi_oversold':
      return evalRsiOversold(condition, barIndex, indicators)
    case 'rsi_overbought':
      return evalRsiOverbought(condition, barIndex, indicators)
    case 'macd_histogram_positive':
      return evalMacdHistogramPositive(barIndex, indicators)
    case 'macd_histogram_negative':
      return evalMacdHistogramNegative(barIndex, indicators)
    case 'bb_lower_touch':
      return evalBBLowerTouch(condition, barIndex, indicators, candles)
    case 'bb_upper_touch':
      return evalBBUpperTouch(condition, barIndex, indicators, candles)
    case 'stoch_oversold':
      return evalStochOversold(condition, barIndex, indicators)
    case 'stoch_overbought':
      return evalStochOverbought(condition, barIndex, indicators)
    case 'atr_above':
      return evalAtrAbove(condition, barIndex, indicators)
    case 'atr_below':
      return evalAtrBelow(condition, barIndex, indicators)
    case 'adx_above':
      return evalAdxAbove(condition, barIndex, indicators)
    case 'adx_below':
      return evalAdxBelow(condition, barIndex, indicators)
    case 'candle_pattern':
      return evalCandlePattern(condition, barIndex, candles)
    default:
      return false
  }
}

// ── Individual condition evaluators ──────────────────────────────────────────

function evalIndicatorCrossAbove(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  if (barIndex < 1) return false
  const series1 = resolveIndicator(indicators, condition.indicator1 ?? '')
  const series2 = resolveIndicator(indicators, condition.indicator2 ?? '')
  if (!series1 || !series2) return false

  const prev1 = series1[barIndex - 1]
  const prev2 = series2[barIndex - 1]
  const curr1 = series1[barIndex]
  const curr2 = series2[barIndex]

  if (isNaN(prev1) || isNaN(prev2) || isNaN(curr1) || isNaN(curr2)) return false

  // Cross above: prev1 <= prev2 AND curr1 > curr2
  return prev1 <= prev2 && curr1 > curr2
}

function evalIndicatorCrossBelow(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  if (barIndex < 1) return false
  const series1 = resolveIndicator(indicators, condition.indicator1 ?? '')
  const series2 = resolveIndicator(indicators, condition.indicator2 ?? '')
  if (!series1 || !series2) return false

  const prev1 = series1[barIndex - 1]
  const prev2 = series2[barIndex - 1]
  const curr1 = series1[barIndex]
  const curr2 = series2[barIndex]

  if (isNaN(prev1) || isNaN(prev2) || isNaN(curr1) || isNaN(curr2)) return false

  // Cross below: prev1 >= prev2 AND curr1 < curr2
  return prev1 >= prev2 && curr1 < curr2
}

function evalIndicatorAbove(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series1 = resolveIndicator(indicators, condition.indicator1 ?? '')
  const series2 = resolveIndicator(indicators, condition.indicator2 ?? '')
  if (!series1 || !series2) return false

  const val1 = series1[barIndex]
  const val2 = series2[barIndex]
  if (isNaN(val1) || isNaN(val2)) return false

  return compare(val1, val2, condition.operator ?? 'gt')
}

function evalIndicatorBelow(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series1 = resolveIndicator(indicators, condition.indicator1 ?? '')
  const series2 = resolveIndicator(indicators, condition.indicator2 ?? '')
  if (!series1 || !series2) return false

  const val1 = series1[barIndex]
  const val2 = series2[barIndex]
  if (isNaN(val1) || isNaN(val2)) return false

  return compare(val1, val2, condition.operator ?? 'lt')
}

function evalPriceAbove(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
): boolean {
  const series = resolveIndicator(indicators, condition.indicator1 ?? '')
  if (!series) return false

  const price = candles[barIndex].close
  const indicatorVal = series[barIndex]
  if (isNaN(indicatorVal)) return false

  const threshold = condition.value ?? indicatorVal
  return compare(price, threshold, condition.operator ?? 'gt')
}

function evalPriceBelow(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
): boolean {
  const series = resolveIndicator(indicators, condition.indicator1 ?? '')
  if (!series) return false

  const price = candles[barIndex].close
  const indicatorVal = series[barIndex]
  if (isNaN(indicatorVal)) return false

  const threshold = condition.value ?? indicatorVal
  return compare(price, threshold, condition.operator ?? 'lt')
}

function evalRsiOversold(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  // Find any RSI series
  const rsiKey = condition.indicator1 ?? 'rsi_14'
  const series = resolveIndicator(indicators, rsiKey)
  if (!series) return false

  const rsiVal = series[barIndex]
  if (isNaN(rsiVal)) return false

  const threshold = condition.value ?? 30
  return rsiVal < threshold
}

function evalRsiOverbought(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const rsiKey = condition.indicator1 ?? 'rsi_14'
  const series = resolveIndicator(indicators, rsiKey)
  if (!series) return false

  const rsiVal = series[barIndex]
  if (isNaN(rsiVal)) return false

  const threshold = condition.value ?? 70
  return rsiVal > threshold
}

function evalMacdHistogramPositive(
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series = indicators.get('macd') as IndicatorSeries | undefined
  if (!series?.histogram) return false

  const val = series.histogram[barIndex]
  return !isNaN(val) && val > 0
}

function evalMacdHistogramNegative(
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series = indicators.get('macd') as IndicatorSeries | undefined
  if (!series?.histogram) return false

  const val = series.histogram[barIndex]
  return !isNaN(val) && val < 0
}

function evalBBLowerTouch(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
): boolean {
  const series = indicators.get('bbands') as IndicatorSeries | undefined
  if (!series?.lower) return false

  const lower = series.lower[barIndex]
  if (isNaN(lower)) return false

  const close = candles[barIndex].close
  const tolerance = lower * 0.005 // within 0.5% of the lower band

  return close <= lower + tolerance && close >= lower - tolerance
}

function evalBBUpperTouch(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
  candles: Candle[],
): boolean {
  const series = indicators.get('bbands') as IndicatorSeries | undefined
  if (!series?.upper) return false

  const upper = series.upper[barIndex]
  if (isNaN(upper)) return false

  const close = candles[barIndex].close
  const tolerance = upper * 0.005

  return close >= upper - tolerance && close <= upper + tolerance
}

function evalStochOversold(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series = indicators.get('stoch') as IndicatorSeries | undefined
  if (!series?.k) return false

  const kVal = series.k[barIndex]
  if (isNaN(kVal)) return false

  const threshold = condition.value ?? 20
  return kVal < threshold
}

function evalStochOverbought(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const series = indicators.get('stoch') as IndicatorSeries | undefined
  if (!series?.k) return false

  const kVal = series.k[barIndex]
  if (isNaN(kVal)) return false

  const threshold = condition.value ?? 80
  return kVal > threshold
}

function evalAtrAbove(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const atrKey = condition.indicator1 ?? 'atr_14'
  const series = resolveIndicator(indicators, atrKey)
  if (!series) return false

  const atrVal = series[barIndex]
  if (isNaN(atrVal) || condition.value === undefined) return false

  return compare(atrVal, condition.value, condition.operator ?? 'gt')
}

function evalAtrBelow(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const atrKey = condition.indicator1 ?? 'atr_14'
  const series = resolveIndicator(indicators, atrKey)
  if (!series) return false

  const atrVal = series[barIndex]
  if (isNaN(atrVal) || condition.value === undefined) return false

  return compare(atrVal, condition.value, condition.operator ?? 'lt')
}

function evalAdxAbove(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const adxKey = condition.indicator1 ?? 'adx_14'
  const series = resolveIndicator(indicators, adxKey)
  if (!series) return false

  const adxVal = series[barIndex]
  if (isNaN(adxVal) || condition.value === undefined) return false

  return compare(adxVal, condition.value, condition.operator ?? 'gt')
}

function evalAdxBelow(
  condition: Condition,
  barIndex: number,
  indicators: Map<string, number[] | IndicatorSeries>,
): boolean {
  const adxKey = condition.indicator1 ?? 'adx_14'
  const series = resolveIndicator(indicators, adxKey)
  if (!series) return false

  const adxVal = series[barIndex]
  if (isNaN(adxVal) || condition.value === undefined) return false

  return compare(adxVal, condition.value, condition.operator ?? 'lt')
}

function evalCandlePattern(
  condition: Condition,
  barIndex: number,
  candles: Candle[],
): boolean {
  if (barIndex < 1) return false
  const pattern = condition.pattern ?? ''
  const curr = candles[barIndex]
  const prev = candles[barIndex - 1]

  switch (pattern) {
    case 'bullish_engulfing':
      return evalBullishEngulfing(prev, curr)
    case 'bearish_engulfing':
      return evalBearishEngulfing(prev, curr)
    case 'pin_bar':
      return evalPinBar(curr)
    case 'doji':
      return evalDoji(curr)
    case 'hammer':
      return evalHammer(curr)
    case 'fvg_bullish':
      return evalFvgBullish(candles, barIndex)
    case 'fvg_bearish':
      return evalFvgBearish(candles, barIndex)
    default:
      return false
  }
}

// ── Candle pattern detectors ─────────────────────────────────────────────────

function evalBullishEngulfing(prev: Candle, curr: Candle): boolean {
  // Previous candle bearish, current candle bullish, current body engulfs previous
  const prevBody = prev.close - prev.open
  const currBody = curr.close - curr.open
  return prevBody < 0 && currBody > 0 && curr.open <= prev.close && curr.close >= prev.open
}

function evalBearishEngulfing(prev: Candle, curr: Candle): boolean {
  const prevBody = prev.close - prev.open
  const currBody = curr.close - curr.open
  return prevBody > 0 && currBody < 0 && curr.open >= prev.close && curr.close <= prev.open
}

function evalPinBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open)
  const range = candle.high - candle.low
  if (range === 0) return false

  const upperWick = candle.high - Math.max(candle.open, candle.close)
  const lowerWick = Math.min(candle.open, candle.close) - candle.low

  // Pin bar: body is < 30% of range, and one wick is > 60% of range
  return body / range < 0.3 && (upperWick / range > 0.6 || lowerWick / range > 0.6)
}

function evalDoji(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open)
  const range = candle.high - candle.low
  if (range === 0) return false
  return body / range < 0.05
}

function evalHammer(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open)
  const range = candle.high - candle.low
  if (range === 0) return false

  const lowerWick = Math.min(candle.open, candle.close) - candle.low
  const upperWick = candle.high - Math.max(candle.open, candle.close)

  // Hammer: small body at top, long lower wick (2x body), small upper wick
  return body / range < 0.35 && lowerWick >= body * 2 && upperWick < body
}

function evalFvgBullish(candles: Candle[], barIndex: number): boolean {
  if (barIndex < 2) return false
  // Bullish FVG: 3-candle pattern where price gaps up
  // Candle[i]'s low > Candle[i-2]'s high — gap between candle[i-1] bodies leaves an imbalance
  // The gap is between candle[i-2]'s high and candle[i]'s low (wicks don't overlap)
  const twoBack = candles[barIndex - 2]
  const curr = candles[barIndex]
  return curr.low > twoBack.high
}

function evalFvgBearish(candles: Candle[], barIndex: number): boolean {
  if (barIndex < 2) return false
  // Bearish FVG: 3-candle pattern where price gaps down
  // Candle[i]'s high < Candle[i-2]'s low — gap between candle[i-1] bodies leaves an imbalance
  const twoBack = candles[barIndex - 2]
  const curr = candles[barIndex]
  return curr.high < twoBack.low
}

// ── Comparison helper ────────────────────────────────────────────────────────

function compare(a: number, b: number, op: string): boolean {
  switch (op) {
    case 'gt': return a > b
    case 'lt': return a < b
    case 'gte': return a >= b
    case 'lte': return a <= b
    case 'eq': return Math.abs(a - b) < 0.0001
    default: return false
  }
}

// ── Session filter ───────────────────────────────────────────────────────────

const SESSION_HOURS: Record<string, { start: number; end: number }> = {
  asian: { start: 0, end: 9 },      // UTC 00:00 - 09:00
  london: { start: 7, end: 16 },     // UTC 07:00 - 16:00
  new_york: { start: 12, end: 21 }, // UTC 12:00 - 21:00
  overlap: { start: 12, end: 16 },   // UTC 12:00 - 16:00 (London+NY overlap)
}

/**
 * Check if a candle falls within any allowed session.
 * Only meaningful for intraday timeframes — daily+ always passes.
 */
export function isInSession(
  candle: Candle,
  allowedSessions: string[],
  timeframe: string,
): boolean {
  // Daily and above — no session filter
  if (['1D', '1W', '1M'].includes(timeframe)) return true

  if (allowedSessions.length === 0) return true

  const date = new Date(candle.time)
  const hour = date.getUTCHours()

  return allowedSessions.some((session) => {
    const range = SESSION_HOURS[session]
    if (!range) return false
    if (range.start < range.end) {
      return hour >= range.start && hour < range.end
    }
    // Overnight sessions: e.g. 22:00 - 06:00
    return hour >= range.start || hour < range.end
  })
}
