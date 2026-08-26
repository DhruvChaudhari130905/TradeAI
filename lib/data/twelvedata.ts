import type { Candle } from '@/lib/types/replay'
import { TF_TO_TWELVE_DATA, type Timeframe } from '@/lib/types/replay'

// ── Rate Limiter (8 credits/min, 800/day) ────────────────────────────────────
// Rolling 60s window matching Twelve Data's own counting: a fresh burst of
// requests goes out immediately (fast first paint), further requests wait for
// oldest-window slots to free up. One slot held back as margin against
// boundary-straddle 429s.

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 7 // 8 credits minus safety margin
const DAILY_LIMIT = 800

let requestTimes: number[] = []
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

  for (;;) {
    const now = Date.now()
    requestTimes = requestTimes.filter((t) => now - t < WINDOW_MS)
    if (requestTimes.length < MAX_PER_WINDOW) break
    // Sleep until the oldest request leaves the window
    await sleep(requestTimes[0] + WINDOW_MS - now + 100)
  }
  requestTimes.push(Date.now())
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
    const message = data.message ?? 'Unknown error'
    // TD answers HTTP 400 "no data" for ranges containing zero trading days
    // (weekend/holiday-only windows, e.g. a short delta fetch) — empty result,
    // not a failure.
    if (/no data/i.test(message)) return []
    throw new Error(`Twelve Data API error: ${message}`)
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

  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T23:59:59Z`)

  const ranges: Array<{ start: Date; end: Date }> = []
  let chunkStart = new Date(start)
  while (chunkStart < end) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, end.getTime()))
    ranges.push({ start: chunkStart, end: chunkEnd })
    chunkStart = new Date(chunkEnd.getTime() + 1) // advance without gaps; dedupe below
  }

  // Chunks fire in parallel; the shared rate limiter paces them (burst of 7
  // immediately, later ones wait for window slots), so wall-clock time tracks
  // credits instead of sequential round-trips.
  const chunks = await Promise.all(
    ranges.map((r) =>
      fetchTimeSeries({
        symbol,
        interval: tdInterval,
        start_date: r.start.toISOString().split('T')[0],
        end_date: r.end.toISOString().split('T')[0],
      }),
    ),
  )

  const allCandles: Candle[] = chunks.flat()

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
