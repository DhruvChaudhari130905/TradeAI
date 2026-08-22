import type { Candle } from '@/lib/types/replay'

// ── Indicator input config ───────────────────────────────────────────────────

export interface IndicatorInput {
  type: 'EMA' | 'SMA' | 'RSI' | 'MACD' | 'BBANDS' | 'ATR' | 'STOCH' | 'VWAP' | 'ADX'
  params: Record<string, number>  // e.g. { period: 14 }, { fast: 12, slow: 26, signal: 9 }
}

// ── Multi-series indicator return type ────────────────────────────────────────

export interface IndicatorSeries {
  macd?: number[]
  signal?: number[]
  histogram?: number[]
  upper?: number[]
  middle?: number[]
  lower?: number[]
  k?: number[]
  d?: number[]
}

// ── Main entry: compute all indicators ─────────────────────────────────────────

/**
 * Compute indicators from configs.
 * Returns a Map keyed by canonical name: e.g. "ema_9", "rsi_14", "macd", "bbands"
 */
export function computeIndicators(
  candles: Candle[],
  configs: IndicatorInput[],
): Map<string, number[] | IndicatorSeries> {
  const map = new Map<string, number[] | IndicatorSeries>()

  for (const config of configs) {
    switch (config.type) {
      case 'SMA': {
        const period = config.params.period ?? 20
        const key = `sma_${period}`
        if (!map.has(key)) map.set(key, computeSMA(candles, period))
        break
      }
      case 'EMA': {
        const period = config.params.period ?? 20
        const key = `ema_${period}`
        if (!map.has(key)) map.set(key, computeEMA(candles, period))
        break
      }
      case 'RSI': {
        const period = config.params.period ?? 14
        const key = `rsi_${period}`
        if (!map.has(key)) map.set(key, computeRSI(candles, period))
        break
      }
      case 'MACD': {
        const fast = config.params.fast ?? 12
        const slow = config.params.slow ?? 26
        const sig = config.params.signal ?? 9
        const key = `macd`
        if (!map.has(key)) map.set(key, computeMACD(candles, fast, slow, sig))
        break
      }
      case 'BBANDS': {
        const period = config.params.period ?? 20
        const stdDev = config.params.std_dev ?? 2
        const key = `bbands`
        if (!map.has(key)) map.set(key, computeBBands(candles, period, stdDev))
        break
      }
      case 'ATR': {
        const period = config.params.period ?? 14
        const key = `atr_${period}`
        if (!map.has(key)) map.set(key, computeATR(candles, period))
        break
      }
      case 'STOCH': {
        const kPeriod = config.params.k_period ?? 14
        const dPeriod = config.params.d_period ?? 3
        const key = `stoch`
        if (!map.has(key)) map.set(key, computeStoch(candles, kPeriod, dPeriod))
        break
      }
      case 'ADX': {
        const period = config.params.period ?? 14
        const key = `adx_${period}`
        if (!map.has(key)) map.set(key, computeADX(candles, period))
        break
      }
      case 'VWAP': {
        const key = `vwap`
        if (!map.has(key)) map.set(key, computeVWAP(candles))
        break
      }
    }
  }

  return map
}

/** Get a single numeric series from the indicator map by canonical key,
 *  including compound keys like "macd_histogram" or "bbands_upper". */
export function getIndicatorSeries(
  indicators: Map<string, number[] | IndicatorSeries>,
  key: string,
): number[] | undefined {
  return resolveIndicator(indicators, key)
}

/**
 * Resolve a named indicator reference (e.g. "ema_9", "rsi_14", "macd_histogram",
 * "bbands_upper", "stoch_k") to its numeric series from the indicator map.
 */
export function resolveIndicator(
  indicators: Map<string, number[] | IndicatorSeries>,
  name: string,
): number[] | undefined {
  // Direct match (e.g. "ema_9", "rsi_14", "atr_14")
  const direct = indicators.get(name)
  if (Array.isArray(direct)) return direct

  // Multi-series compound keys
  if (name.startsWith('macd_')) {
    const series = indicators.get('macd') as IndicatorSeries | undefined
    if (!series) return undefined
    const subkey = name.replace('macd_', '') as keyof IndicatorSeries
    return series[subkey] as number[] | undefined
  }

  if (name.startsWith('bbands_')) {
    const series = indicators.get('bbands') as IndicatorSeries | undefined
    if (!series) return undefined
    const subkey = name.replace('bbands_', '') as keyof IndicatorSeries
    return series[subkey] as number[] | undefined
  }

  if (name.startsWith('stoch_')) {
    const series = indicators.get('stoch') as IndicatorSeries | undefined
    if (!series) return undefined
    const subkey = name.replace('stoch_', '') as keyof IndicatorSeries
    return series[subkey] as number[] | undefined
  }

  return undefined
}

// ── Individual indicator computations ─────────────────────────────────────────

function computeSMA(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close
    }
    result[i] = sum / period
  }
  return result
}

function computeEMA(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)
  if (candles.length < period) return result
  const multiplier = 2 / (period + 1)

  // Start with SMA for the first value
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += candles[i].close
  }
  result[period - 1] = sum / period

  // Compute EMA for remaining values
  for (let i = period; i < candles.length; i++) {
    result[i] = (candles[i].close - result[i - 1]) * multiplier + result[i - 1]
  }

  return result
}

function computeRSI(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)

  if (candles.length < period + 1) return result

  let avgGain = 0
  let avgLoss = 0

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= period
  avgLoss /= period

  // First RSI value
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // Subsequent values use smoothed averages
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }

  return result
}

function computeMACD(
  candles: Candle[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): IndicatorSeries {
  const fastEMA = computeEMA(candles, fastPeriod)
  const slowEMA = computeEMA(candles, slowPeriod)

  const macdLine: number[] = new Array(candles.length).fill(NaN)
  for (let i = 0; i < candles.length; i++) {
    if (!isNaN(fastEMA[i]) && !isNaN(slowEMA[i])) {
      macdLine[i] = fastEMA[i] - slowEMA[i]
    }
  }

  // Signal line: EMA of MACD line (using available values)
  const signalLine: number[] = new Array(candles.length).fill(NaN)
  const multiplier = 2 / (signalPeriod + 1)
  let signalStart = -1

  // Find the first valid MACD value
  for (let i = 0; i < candles.length; i++) {
    if (!isNaN(macdLine[i])) {
      if (signalStart === -1) {
        signalStart = i
      }
      const count = i - signalStart + 1
      if (count === signalPeriod) {
        let sum = 0
        for (let j = signalStart; j <= i; j++) sum += macdLine[j]
        signalLine[i] = sum / signalPeriod
      } else if (count > signalPeriod) {
        signalLine[i] = (macdLine[i] - signalLine[i - 1]) * multiplier + signalLine[i - 1]
      }
    }
  }

  // Histogram = MACD - Signal
  const histogram: number[] = new Array(candles.length).fill(NaN)
  for (let i = 0; i < candles.length; i++) {
    if (!isNaN(macdLine[i]) && !isNaN(signalLine[i])) {
      histogram[i] = macdLine[i] - signalLine[i]
    }
  }

  return { macd: macdLine, signal: signalLine, histogram }
}

function computeBBands(candles: Candle[], period: number, stdDev: number): IndicatorSeries {
  const sma = computeSMA(candles, period)
  const upper: number[] = new Array(candles.length).fill(NaN)
  const lower: number[] = new Array(candles.length).fill(NaN)

  for (let i = period - 1; i < candles.length; i++) {
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(candles[j].close - sma[i], 2)
    }
    const sd = Math.sqrt(sumSq / period)
    upper[i] = sma[i] + stdDev * sd
    lower[i] = sma[i] - stdDev * sd
  }

  return { upper, middle: sma, lower }
}

function computeATR(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)

  if (candles.length < 2) return result

  // True range series
  const tr: number[] = new Array(candles.length).fill(0)
  tr[0] = candles[0].high - candles[0].low
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low
    const hc = Math.abs(candles[i].high - candles[i - 1].close)
    const lc = Math.abs(candles[i].low - candles[i - 1].close)
    tr[i] = Math.max(hl, hc, lc)
  }

  // First ATR = simple average of first `period` true ranges
  let sum = 0
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i]
  result[period - 1] = sum / period

  // Subsequent ATR values use smoothing
  for (let i = period; i < candles.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period
  }

  return result
}

function computeStoch(candles: Candle[], kPeriod: number, dPeriod: number): IndicatorSeries {
  const k: number[] = new Array(candles.length).fill(NaN)
  const d: number[] = new Array(candles.length).fill(NaN)

  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highestHigh = -Infinity
    let lowestLow = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      highestHigh = Math.max(highestHigh, candles[j].high)
      lowestLow = Math.min(lowestLow, candles[j].low)
    }
    const range = highestHigh - lowestLow
    k[i] = range === 0 ? 50 : ((candles[i].close - lowestLow) / range) * 100
  }

  // %D = SMA of %K
  for (let i = kPeriod - 1 + dPeriod - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) {
      sum += k[j]
    }
    d[i] = sum / dPeriod
  }

  return { k, d }
}

function computeADX(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)

  if (candles.length < period * 2) return result

  // +DM and -DM
  const plusDM: number[] = new Array(candles.length).fill(0)
  const minusDM: number[] = new Array(candles.length).fill(0)

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high
    const downMove = candles[i - 1].low - candles[i].low

    if (upMove > downMove && upMove > 0) plusDM[i] = upMove
    if (downMove > upMove && downMove > 0) minusDM[i] = downMove
  }

  // True range
  const tr: number[] = new Array(candles.length).fill(0)
  tr[0] = candles[0].high - candles[0].low
  for (let i = 1; i < candles.length; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    )
  }

  // Smoothed averages
  let smoothTR = 0
  let smoothPlusDM = 0
  let smoothMinusDM = 0

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i]
    smoothPlusDM += plusDM[i]
    smoothMinusDM += minusDM[i]
  }

  const plusDI: number[] = new Array(candles.length).fill(NaN)
  const minusDI: number[] = new Array(candles.length).fill(NaN)
  const dx: number[] = new Array(candles.length).fill(NaN)

  plusDI[period] = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
  minusDI[period] = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100
  const dxSum = plusDI[period] + minusDI[period]
  dx[period] = dxSum === 0 ? 0 : (Math.abs(plusDI[period] - minusDI[period]) / dxSum) * 100

  for (let i = period + 1; i < candles.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i]
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i]
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i]

    plusDI[i] = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100
    minusDI[i] = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100
    const diSum = plusDI[i] + minusDI[i]
    dx[i] = diSum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / diSum) * 100
  }

  // ADX = smoothed average of DX
  let adxSum = 0
  for (let i = period; i < period * 2; i++) {
    if (!isNaN(dx[i])) adxSum += dx[i]
  }
  result[period * 2 - 1] = adxSum / period

  for (let i = period * 2; i < candles.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + dx[i]) / period
  }

  return result
}

function computeVWAP(candles: Candle[]): number[] {
  const result: number[] = new Array(candles.length).fill(NaN)

  let cumVolume = 0
  let cumTPV = 0

  for (let i = 0; i < candles.length; i++) {
    const volume = candles[i].volume ?? 0
    if (volume === 0) {
      result[i] = i > 0 && !isNaN(result[i - 1]) ? result[i - 1] : NaN
      continue
    }

    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3
    cumTPV += typicalPrice * volume
    cumVolume += volume

    result[i] = cumVolume === 0 ? NaN : cumTPV / cumVolume
  }

  return result
}
