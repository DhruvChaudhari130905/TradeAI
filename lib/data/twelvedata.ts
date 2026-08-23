import type { Candle } from '@/lib/types/replay'
import { TF_TO_TWELVE_DATA, type Timeframe } from '@/lib/types/replay'

// ── Rate Limiter (8 credits/min, 800/day) ────────────────────────────────────
// Strict pacing instead of a token bucket: a burst of 8 requests in 2 seconds
// can straddle Twelve Data's rolling minute window and still trip the limit.
// Spacing every request ≥8s apart guarantees we stay under 8/min.

const MIN_REQUEST_GAP_MS = 8_000 // 60s / 8 credits, with margin
const DAILY_LIMIT = 800

let lastRequestAt = 0
let dailyUsage = 0
let dailyResetDay = new Date().getDate()

async function acquireToken(): Promise<void> {
  // Reset daily counter at midnight
  const today = new Date().getDate()
  if (today !== dailyResetDay) {
    dailyUsage = 0
    dailyResetDay = today
  }

  if (dailyUsage >= DAILY_LIMIT - 5) {
    throw new Error('Twelve Data daily API limit approaching. Try again tomorrow.')
  }

  const waitMs = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now()
  if (waitMs > 0) {
    await sleep(waitMs)
  }
  lastRequestAt = Date.now()
  dailyUsage += 1
}

// ── Twelve Data Client ────────────────────────────────────────────────────────

const BASE_URL = 'https://api.twelvedata.com/time_series'

export interface FetchTimeSeriesParams {
  symbol: string
  interval: string
  start_date: string
  end_date: string
  outputsize?: number
}

/**
 * Fetch OHLCV time series from Twelve Data.
 * Handles rate limiting (8 credits/min, 800/day), pagination for large ranges,
 * and exponential backoff on 429 responses.
 */
export async function fetchTimeSeries(params: FetchTimeSeriesParams): Promise<Candle[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not set')

  const { symbol, interval, start_date, end_date, outputsize } = params

  const url = new URL(BASE_URL)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('start_date', start_date)
  url.searchParams.set('end_date', end_date)
  url.searchParams.set('order', 'asc')
  url.searchParams.set('apikey', apiKey)
  if (outputsize) url.searchParams.set('outputsize', String(outputsize))

  await acquireToken()

  // Non-2xx responses still carry TD's error JSON (e.g. "No data is
  // available on the specified dates" arrives as HTTP 400) — parse first,
  // then decide.
  const response = await fetchWithRetry(url.toString())

  const data = await response.json()

  if (data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message ?? 'Unknown error'}`)
  }

  if (!response.ok) {
    throw new Error(`Twelve Data request failed: ${response.status} ${response.statusText}`)
  }

  const values = data.values as Array<Record<string, string>> | undefined
  if (!values || !Array.isArray(values)) {
    return []
  }

  return values.map((v) => ({
    time: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: v.volume ? parseFloat(v.volume) : undefined,
  }))
}

/**
 * Fetch time series with pagination for large date ranges (>5000 candles).
 * Twelve Data returns at most 5000 rows per request, so each chunk is sized
 * per-interval to stay under that cap (e.g. ~3 days of 1m bars vs 90 days of
 * 4H bars). The rate limiter spaces requests ≥8s apart.
 */
export async function fetchTimeSeriesPaginated(
  symbol: string,
  interval: Timeframe,
  startDate: string,
  endDate: string,
): Promise<Candle[]> {
  const tdInterval = TF_TO_TWELVE_DATA[interval]

  // Approximate candles per day per timeframe; keep every request under 5000 rows
  const BARS_PER_DAY: Record<Timeframe, number> = {
    '1m': 1440,
    '5m': 288,
    '15m': 96,
    '30m': 48,
    '1H': 24,
    '4H': 6,
    '1D': 1,
    '1W': 1 / 7,
    '1M': 1 / 30,
  }
  const chunkDays = Math.max(1, Math.floor(4800 / BARS_PER_DAY[interval]))
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000

  const allCandles: Candle[] = []
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T23:59:59Z`)

  let chunkStart = new Date(start)

  while (chunkStart < end) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, end.getTime()))

    const chunk = await fetchTimeSeries({
      symbol,
      interval: tdInterval,
      start_date: chunkStart.toISOString().split('T')[0],
      end_date: chunkEnd.toISOString().split('T')[0],
    })

    allCandles.push(...chunk)
    chunkStart = new Date(chunkEnd.getTime() + 1) // advance without gaps; dedupe below
  }

  // Deduplicate by time (chunk boundaries can share a bar)
  const seen = new Set<string>()
  return allCandles.filter((c) => {
    if (seen.has(c.time)) return false
    seen.add(c.time)
    return true
  })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url)

    if (response.status === 429) {
      console.warn('[twelvedata] Rate limited (429), backing off...')
      const backoffMs = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
      if (attempt < maxRetries) {
        await sleep(backoffMs)
        // Re-acquire a token after backoff
        await acquireToken()
        continue
      }
      throw new Error('Twelve Data rate limit exceeded after retries. Try again later.')
    }

    // Non-429 errors (e.g. 400 "no data on these dates") are returned as-is —
    // the caller parses TD's error JSON for the real message.
    return response
  }

  throw new Error('Twelve Data request failed after retries')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
