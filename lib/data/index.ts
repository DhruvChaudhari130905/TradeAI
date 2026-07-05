import type { Candle, BacktestTimeframe, TF_TO_TWELVE_DATA } from '@/lib/types/backtest'
import { fetchTimeSeriesPaginated } from './twelvedata'

/**
 * Fetch OHLCV data from Twelve Data (no caching).
 * Downloads data fresh each time, discards after simulation.
 */
export async function fetchOHLCV(params: {
  pair: string
  market: 'forex' | 'crypto'
  timeframe: BacktestTimeframe
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
