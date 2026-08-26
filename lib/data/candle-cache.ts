import type { Candle } from '@/lib/types/replay'
import { createServiceClient } from '@/lib/supabase/service-client'

// Shared OHLCV cache: historical candles never change, so fetch them from
// Twelve Data once and serve every later request from Postgres. One row per
// (pair, market, timeframe) covering the widest range fetched so far. Writes
// go through the service-role client — the table's RLS is read-only for users.

export interface CachedCandles {
  candles: Candle[]
  rangeFrom: string
  rangeTo: string
  newestCandleAt: string | null
}

export async function getCachedCandles(
  pair: string,
  market: string,
  timeframe: string,
): Promise<CachedCandles | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('candle_cache')
    .select('candles, range_from, range_to, newest_candle_at')
    .eq('pair', pair)
    .eq('market', market)
    .eq('timeframe', timeframe)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    candles: data.candles as Candle[],
    rangeFrom: data.range_from,
    rangeTo: data.range_to,
    newestCandleAt: data.newest_candle_at,
  }
}

/** Merge fetched candles into the cache row, widening its covered range. */
export async function saveCachedCandles(
  pair: string,
  market: string,
  timeframe: string,
  incoming: Candle[],
  rangeFrom: string,
  rangeTo: string,
): Promise<void> {
  const existing = await getCachedCandles(pair, market, timeframe)
  const merged = existing ? mergeCandles(existing.candles, incoming) : dedupeSorted(incoming)

  const supabase = createServiceClient()
  const { error } = await supabase.from('candle_cache').upsert(
    {
      pair,
      market,
      timeframe,
      candles: merged,
      range_from: existing && existing.rangeFrom < rangeFrom ? existing.rangeFrom : rangeFrom,
      range_to: existing && existing.rangeTo > rangeTo ? existing.rangeTo : rangeTo,
      newest_candle_at: candleDate(merged.at(-1)?.time),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'pair,market,timeframe' },
  )
  if (error) throw error
}

export function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  return dedupeSorted([...a, ...b])
}

function dedupeSorted(candles: Candle[]): Candle[] {
  const seen = new Set<string>()
  return [...candles]
    .sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0))
    .filter((c) => {
      if (seen.has(c.time)) return false
      seen.add(c.time)
      return true
    })
}

/** 'YYYY-MM-DD' portion of a Twelve Data datetime string ('YYYY-MM-DD HH:mm:ss'). */
export function candleDate(time: string | undefined): string | null {
  return time ? time.slice(0, 10) : null
}
