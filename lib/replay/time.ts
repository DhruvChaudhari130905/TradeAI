// Candle time helpers. Twelve Data returns naive UTC strings like
// "2024-03-15 14:00:00" which JS Date would parse as LOCAL time — always
// normalize through these helpers.

import type { Timeframe } from '@/lib/types/replay'
import { TF_SECONDS } from '@/lib/types/replay'

/** Parse a candle time string to epoch milliseconds (UTC-safe) */
export function candleTimeMs(t: string): number {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)) {
    return new Date(`${t.replace(' ', 'T')}Z`).getTime()
  }
  return new Date(t).getTime()
}

/** lightweight-charts UTCTimestamp (seconds) */
export function toChartTime(t: string): number {
  return Math.floor(candleTimeMs(t) / 1000)
}

/** Close time of a bar in epoch ms */
export function barCloseMs(t: string, tf: Timeframe): number {
  return candleTimeMs(t) + TF_SECONDS[tf] * 1000
}

/**
 * Slice a higher-timeframe series so it contains no future information
 * relative to the primary-TF bar that just opened: only bars whose CLOSE
 * happened before the primary bar's OPEN are revealed.
 */
export function visibleHigherTfCandles<T extends { time: string }>(
  candles: T[],
  tf: Timeframe,
  primaryBarOpenTime: string,
): T[] {
  const cutoff = candleTimeMs(primaryBarOpenTime)
  // Most significant bit first: scan from the end, find first bar closing before cutoff
  let end = candles.length
  while (end > 0 && barCloseMs(candles[end - 1].time, tf) > cutoff) {
    end -= 1
  }
  return candles.slice(0, end)
}
