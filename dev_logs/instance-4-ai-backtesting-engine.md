# Session Log — Instance 4: AI Backtesting Engine

**Date:** 2026-06-30
**Status:** ✅ Complete

---

## Objective

Build the AI backtesting feature. User uploads a strategy document, selects a pair/timeframe/date range. The system fetches historical OHLCV data, passes candles + strategy rules to the NIM AI which decides entry/exit points bar-by-bar, tracks virtual P&L on a $10,000 paper account, and generates a full performance report with AI narrative commentary.

---

## Tasks Completed

### 4.1 — Backtest Type Definitions

| File | Purpose |
|---|---|
| `lib/types/backtest.ts` | `Candle`, `StrategyRules`, `Position`, `CompletedTrade`, `BacktestState`, `BacktestResult`, `BacktestRun`, `BACKTEST_TIMEFRAMES`, `COINGECKO_IDS`, `AV_FUNCTION_MAP` |

**Key exports:**
- `Candle` — { time, open, high, low, close } for OHLCV data
- `StrategyRules` — extracted strategy structure (entry/exit conditions, SL/TP methods, risk %)
- `BacktestResult` — complete results (win rate, PnL, drawdown, profit factor, expectancy, equity curve, trade log)
- `BacktestRun` — DB row shape (id, status, result jsonb, ai_report text)
- `COINGECKO_IDS` — maps user-facing crypto pairs (BTC/USD) → CoinGecko IDs (bitcoin)
- `AV_FUNCTION_MAP` — maps timeframes → Alpha Vantage function names

### 4.2 — Historical Data Fetchers

| File | Purpose |
|---|---|
| `lib/data/alphavantage.ts` | `fetchForexOHLCV()` — Alpha Vantage FX_DAILY/FX_WEEKLY/FX_INTRADAY |
| `lib/data/coingecko.ts` | `fetchCryptoOHLCV()` — CoinGecko /coins/{id}/ohlc |
| `lib/data/index.ts` | `fetchOHLCVWithCache()` — unified entry with 24h Supabase caching |

**Alpha Vantage:**
- Supports 1D, 1W, 1H timeframes
- Parses pair "EUR/USD" → from_symbol=EUR, to_symbol=USD
- Handles rate limit responses and error messages

**CoinGecko:**
- Free, no API key required
- Rounds requested days to nearest supported value (1, 7, 30, 90, 180, 365)
- Maps user-facing pairs via COINGECKO_IDS lookup table

**Caching:**
- Checks `ohlcv_cache` table for existing data <24h old
- Serves from cache if fresh, fetches from API otherwise
- Filters fetched candles to requested date range
- Upserts cache row (requires unique constraint on pair/market/timeframe/dates)

### 4.3 — Strategy Document Processor

| File | Purpose |
|---|---|
| `lib/nim/extract-strategy-rules.ts` | `extractStrategyRules()` — NIM call to parse strategy docs |
| `lib/prompts/backtest-system-prompts.ts` | `STRATEGY_EXTRACTOR_PROMPT`, `buildSimulationPrompt()`, `BACKTEST_ANALYST_PROMPT` |

**Strategy extraction:**
- Sends doc text to NIM with structured extraction prompt
- Returns StrategyRules (name, entry/exit conditions, SL/TP methods, risk %, notes)
- Validates minimum shape (entry_conditions and exit_conditions arrays required)
- Defaults `risk_per_trade_pct` to 1 if missing or invalid
- Retries once with fallback model on failure

### 4.4 — Backtest Simulation Engine

| File | Purpose |
|---|---|
| `lib/nim/run-backtest.ts` | `runBacktest()`, `generateBacktestReport()` |

**Simulation flow (`runBacktest`):**
1. Initialize BacktestState: $10,000 equity, empty trades, flat position
2. Split candles into chunks of 25
3. For each chunk: build prompt with current state + candles as CSV → call NIM
4. Parse NIM response as array of SimAction objects
5. Apply actions to BacktestState via `openPosition()` / `closePosition()`
6. Always check SL/TP hit by candle's high/low before applying strategy actions
7. 500ms delay between chunks (NIM rate limit handling)
8. If a chunk fails after retry, skip it (equity unchanged) and continue
9. Close any remaining open position at last candle's close
10. Compile final BacktestResult

**Position management:**
- `openPosition()`: calculates lot size from risk % and SL distance
- `closePosition()`: records CompletedTrade with PnL, updates equity
- `checkSLTP()`: checks if candle price action hit SL or TP for open positions

**Result compilation:**
- Win rate, total PnL, max drawdown (peak-to-trough), avg R:R, profit factor, expectancy
- Equity curve array with time+equity at each candle
- Full trade log

**AI narrative report (`generateBacktestReport`):**
- Sends strategy rules + full performance stats + first 20 trades to NIM
- Uses BACKTEST_ANALYST_PROMPT (senior quant analyst persona, 400-600 word markdown)
- Returns markdown string for rendering

### 4.5 — Backtest UI Pages

| File | Purpose |
|---|---|
| `app/backtest/layout.tsx` | Pass-through layout |
| `app/backtest/page.tsx` | New backtest form |
| `app/backtest/[id]/page.tsx` | Backtest report with equity curve + AI report |
| `app/backtest/history/page.tsx` | Past backtest runs list |

**Backtest Form (`/backtest`):**
- Strategy document upload (.txt/.pdf, max 5MB)
- Strategy name input
- Market selector (Forex / Crypto)
- Pair selector (filtered by market, using existing FOREX_PAIRS/CRYPTO_PAIRS constants)
- Timeframe selector (1D, 1W, 1H)
- Date range picker (defaults to last 365 days)
- Starting capital input (default $10,000)
- "Run Backtest" button → uploads doc, calls API, navigates to report page

**Backtest Report (`/backtest/[id]`):**
- Header: strategy name, pair, timeframe, date range badges
- Stats grid (6 cards): Win Rate, Total PnL, Max Drawdown, Profit Factor, Expectancy, Total Trades
- Equity curve: Recharts AreaChart with gradient fill, green when profitable, red when not
  - Reference line at starting capital
  - Downsampled to max 200 points for smooth rendering
- Trade log table: #, Time, Direction, Entry, Exit, PnL, Reason
- AI Narrative Report: custom MarkdownRenderer (headings, bold, italic, lists, paragraphs)
- Polling: auto-refreshes every 5s while status is running/pending

**Backtest History (`/backtest/history`):**
- Lists all past runs sorted by created_at desc
- Shows strategy name, pair+timeframe, market badge, date range
- Complete runs show PnL, win rate, trade count
- Running/pending/error status badges
- Links to report page for complete runs

**MarkdownRenderer** — lightweight inline markdown renderer (no external deps):
- Parses headings (h1-h3), bold (`**text**`), italic (`*text*`), unordered lists
- Avoided adding react-markdown dependency to keep bundle lean

### 4.6 — Backtest API Route

| File | Purpose |
|---|---|
| `app/api/backtest/route.ts` | POST handler — orchestrates the full backtest pipeline |

**Flow:**
1. Validates required fields (userId, strategyDocUrl, market, pair, timeframe, dates)
2. Inserts `backtest_runs` row with status='running'
3. Returns `{ backtestId }` immediately (202 Accepted)
4. Background processing via `processBacktest()`:
   a. Downloads strategy doc from Supabase Storage
   b. Extracts strategy rules via NIM
   c. Fetches OHLCV data (with caching)
   d. Runs chunked simulation
   e. Generates AI narrative report
   f. Updates row with status='complete', result, ai_report
5. On error: updates row with status='error' and error message

---

## Build Artifacts

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/backtest          ← NEW
├ ƒ /api/review
├ ƒ /auth/callback
├ ○ /auth/login
├ ○ /auth/signup
├ ○ /backtest              ← NEW
├ ƒ /backtest/[id]         ← NEW
├ ○ /backtest/history      ← NEW
├ ƒ /dashboard
├ ƒ /journal
├ ƒ /journal/[id]
├ ƒ /journal/[id]/edit
└ ƒ /journal/new
```

Build compiles cleanly with zero TypeScript errors.

---

## Issues & Resolutions

| Issue | Resolution |
|---|---|
| `createBrowserClient` not exported from `@/lib/supabase/client` | Existing codebase uses `createClient()` — changed all references in backtest pages |
| Base UI Select `onValueChange` passes `(value: string \| null, eventDetails)` but `Dispatch<SetStateAction<string>>` doesn't accept null | Wrapped handlers: `(v) => setPair(v ?? '')`, `(v) => setMarket((v ?? 'forex') as 'forex' \| 'crypto')` |
| Recharts Tooltip `formatter` type expects `ValueType \| undefined`, not explicit `number` | Removed explicit type annotation, let inference handle it |
| `Position.entryTime` is `string \| null` but `CompletedTrade.entryTime` expects `string` | Fallback to empty string: `entryTime: entryTime ?? ''` |
| `ohlcv_cache` upsert requires unique constraint | Added migration `002_ohlcv_cache_unique_constraint.sql` with composite unique on (pair, market, timeframe, date_from, date_to) |
| `strategy-docs` storage bucket needed for doc uploads | Added migration `003_strategy_docs_bucket.sql` with RLS policies |

---

## New Files Created

| File | Type | Lines |
|---|---|---|
| `lib/types/backtest.ts` | Types + constants | ~80 |
| `lib/data/alphavantage.ts` | Forex OHLCV fetcher | ~55 |
| `lib/data/coingecko.ts` | Crypto OHLCV fetcher | ~40 |
| `lib/data/index.ts` | Unified fetcher with caching | ~55 |
| `lib/prompts/backtest-system-prompts.ts` | 3 system prompts | ~65 |
| `lib/nim/extract-strategy-rules.ts` | Strategy rule extractor | ~45 |
| `lib/nim/run-backtest.ts` | Simulation engine + report generator | ~260 |
| `app/api/backtest/route.ts` | API route (POST) | ~125 |
| `app/backtest/layout.tsx` | Pass-through layout | ~6 |
| `app/backtest/page.tsx` | Backtest form page | ~210 |
| `app/backtest/[id]/page.tsx` | Report page with equity curve + AI report | ~460 |
| `app/backtest/history/page.tsx` | History page | ~120 |
| `supabase/migrations/002_ohlcv_cache_unique_constraint.sql` | DB migration | ~4 |
| `supabase/migrations/003_strategy_docs_bucket.sql` | Storage bucket + RLS | ~14 |

## Modified Files

None — all changes are new files.

---

## Remaining Work (Future Instances)

1. **Instance 5** — Dashboard analytics: Stats cards, performance charts, streaks, calendar heat map
2. **Instance 6** — Settings page: Profile edit, avatar upload
3. **Real Supabase project** — Run migration SQL (001-003), create storage buckets, configure auth providers
