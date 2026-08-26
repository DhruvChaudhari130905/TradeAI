import type { Candle, Timeframe } from '@/lib/types/replay'
import { fetchTimeSeriesPaginated } from './twelvedata'
import { candleDate, getCachedCandles, saveCachedCandles } from './candle-cache'

/**
 * Fetch OHLCV data, served from the shared Postgres candle cache whenever it
 * covers the requested range. Historical candles are immutable, so only the
 * tail past the newest cached bar ever needs Twelve Data — a delta of a day
 * or two once a pair/timeframe has been loaded before. Cache failures never
 * block loading: fall through to a direct fetch.
 */
export async function fetchOHLCV(params: {
  pair: string
  market: 'forex' | 'crypto'
  timeframe: Timeframe
  dateFrom: string
  dateTo: string
}): Promise<Candle[]> {
  const { pair, market, timeframe, dateFrom, dateTo } = params

  let cached: Awaited<ReturnType<typeof getCachedCandles>> = null
  try {
    cached = await getCachedCandles(pair, market, timeframe)
  } catch (error) {
    console.error('[candle-cache] read failed', error)
  }

  if (cached && dateFrom >= cached.rangeFrom && cached.newestCandleAt) {
    if (dateTo <= cached.newestCandleAt) {
      return sliceByDate(cached.candles, dateFrom, dateTo)
    }
    // Tail delta: head of the range is already covered by the cache.
    const deltaStart = nextDay(cached.newestCandleAt)
    if (deltaStart > dateTo) {
      return sliceByDate(cached.candles, dateFrom, dateTo)
    }
    const fresh = await fetchTimeSeriesPaginated(pair, timeframe, deltaStart, dateTo)
    const merged = [...cached.candles, ...fresh]
    // Awaited, not fire-and-forget: serverless kills orphaned promises after
    // the response returns, and a dropped write means refetching tomorrow.
    await persist(pair, market, timeframe, merged, cached.rangeFrom, dateTo)
    return sliceByDate(merged, dateFrom, dateTo)
  }

  const candles = await fetchTimeSeriesPaginated(pair, timeframe, dateFrom, dateTo)
  await persist(pair, market, timeframe, candles, dateFrom, dateTo)
  return candles
}

/** Cache write runs in the background — never fail or delay the response. */
function persist(
  pair: string,
  market: string,
  timeframe: Timeframe,
  candles: Candle[],
  rangeFrom: string,
  rangeTo: string,
): Promise<void> {
  return saveCachedCandles(pair, market, timeframe, candles, rangeFrom, rangeTo).catch((error) =>
    console.error('[candle-cache] write failed', error),
  )
}

function sliceByDate(candles: Candle[], dateFrom: string, dateTo: string): Candle[] {
  return candles.filter((c) => {
    const d = candleDate(c.time)
    return d !== null && d >= dateFrom && d <= dateTo
  })
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split('T')[0]
}
