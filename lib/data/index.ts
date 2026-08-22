import type { Candle, Timeframe } from '@/lib/types/replay'
import { fetchTimeSeriesPaginated } from './twelvedata'

/**
 * Fetch OHLCV data from Twelve Data (no caching).
 * Downloads data fresh each time.
 */
export async function fetchOHLCV(params: {
  pair: string
  market: 'forex' | 'crypto'
  timeframe: Timeframe
  dateFrom: string
  dateTo: string
}): Promise<Candle[]> {
  const { pair, timeframe, dateFrom, dateTo } = params

  // Convert pair format for Twelve Data:
  // Forex: "EUR/USD" → "EUR/USD" (Twelve Data accepts this natively)
  // Crypto: "BTC/USD" → "BTC/USD"
  const symbol = pair.replace('/', '/')

  return fetchTimeSeriesPaginated(symbol, timeframe, dateFrom, dateTo)
}
