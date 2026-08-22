import type { Candle } from '@/lib/types/replay'
import { TF_TO_TWELVE_DATA, type Timeframe } from '@/lib/types/replay'

// ── Rate Limiter (token bucket: 8 credits/min, 800/day) ──────────────────────

const RATE_LIMIT_TOKENS = 8
const RATE_LIMIT_INTERVAL_MS = 60_000
const DAILY_LIMIT = 800

let tokens = RATE_LIMIT_TOKENS
let lastRefill = Date.now()
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

  // Refill tokens based on elapsed time
  const now = Date.now()
  const elapsed = now - lastRefill
  tokens = Math.min(RATE_LIMIT_TOKENS, tokens + (elapsed / RATE_LIMIT_INTERVAL_MS) * RATE_LIMIT_TOKENS)
  lastRefill = now

  if (tokens < 1) {
    const waitMs = Math.ceil((1 - tokens) * (RATE_LIMIT_INTERVAL_MS / RATE_LIMIT_TOKENS))
    await sleep(Math.max(waitMs, 500))
    tokens = Math.min(RATE_LIMIT_TOKENS, tokens + 1)
  }

  tokens -= 1
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

  const response = await fetchWithRetry(url.toString())

  const data = await response.json()

  if (data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message ?? 'Unknown error'}`)
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
 * Splits into chunks with a 1-second delay between paginated requests.
 */
export async function fetchTimeSeriesPaginated(
  symbol: string,
  interval: Timeframe,
  startDate: string,
  endDate: string,
): Promise<Candle[]> {
  const tdInterval = TF_TO_TWELVE_DATA[interval]

  // First attempt — try the full range
  const candles = await fetchTimeSeries({
    symbol,
    interval: tdInterval,
    start_date: startDate,
    end_date: endDate,
  })

  // If the response seems complete, return it
  // Twelve Data returns up to 5000 rows per request on free tier
  if (candles.length < 5000) return candles

  // For very large ranges, paginate by splitting into ~90-day chunks
  const allCandles: Candle[] = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  const chunkMs = 90 * 24 * 60 * 60 * 1000 // 90 days per chunk

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

    // Move to next chunk (add 1 day to avoid overlap)
    chunkStart = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000)

    // 1-second delay between paginated requests
    if (chunkStart < end) {
      await sleep(1000)
    }
  }

  // Deduplicate by time (pagination overlaps possible)
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

    if (!response.ok) {
      throw new Error(`Twelve Data request failed: ${response.status} ${response.statusText}`)
    }

    return response
  }

  throw new Error('Twelve Data request failed after retries')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
