# Plan: Replace Market Data with Twelve Data + Professional Backtesting Engine

## Context

The current backtesting system uses AI (NIM) to **decide trades** bar-by-bar — this is non-deterministic. The same strategy + same data can produce different results every run. The requirement is to replace this with a deterministic Rule Engine where AI only extracts rules, and a TypeScript engine executes them identically every time. Additionally, Alpha Vantage + CoinGecko must be replaced with Twelve Data as the sole market data provider.

### Key Decisions
- **Strategy input**: Both document upload (AI extraction) AND manual rule builder — both produce same `StrategyRuleSet` JSON
- **Twelve Data plan**: Free tier (8 API credits/min, 800/day) — requires aggressive rate limiting, request queuing, and pagination delays
- **Existing backtest data**: Delete and start fresh — old runs with AI-simulated results are incompatible with new deterministic engine

---

## 1. Replace Market Data Layer with Twelve Data

### Delete
- `lib/data/alphavantage.ts`
- `lib/data/coingecko.ts`
- Remove `ALPHA_VANTAGE_API_KEY` from `.env.local`

### Create: `lib/data/twelvedata.ts`
- Env var: `TWELVE_DATA_API_KEY` (server-side only, never exposed to frontend)
- **Endpoint**: `https://api.twelvedata.com/time_series`
- **Supported intervals**: `1min`, `5min`, `15min`, `30min`, `1h`, `4h`, `1day`, `1week`, `1month`
- Map our timeframe labels to Twelve Data intervals:
  - `1m` → `1min`, `5m` → `5min`, `15m` → `15min`, `30m` → `30min`
  - `1H` → `1h`, `4H` → `4h`, `1D` → `1day`, `1W` → `1week`, `1M` → `1month`
- Function: `fetchTimeSeries(params: { symbol: string, interval: string, start_date: string, end_date: string, outputsize?: number }): Promise<Candle[]>`
- Parse Twelve Data response `values[]` → `Candle[]` (convert string values to numbers, map `datetime` → `time`)
- Use `order=asc` for oldest-first sorting
- **Free tier rate limiting**: 8 credits/min, 800/day
  - Rate limiter: token-bucket with 8 tokens/min capacity, 500ms minimum between requests
  - Daily counter: track usage in memory, reject if approaching 800/day limit
  - For date ranges > 5000 candles: paginate by splitting into chunks with `start_date`/`end_date`, 1-second delay between paginated requests (stricter than the 500ms inter-request to stay well within 8/min)
  - On 429 response: exponential backoff (2s, 4s, 8s, max 3 retries)
  - On 429, log warning so admin knows daily limit is being hit

### Modify: `lib/data/index.ts`
- Replace `fetchForexOHLCV` and `fetchCryptoOHLCV` calls with `fetchTimeSeries`
- **Remove ohlcv_cache dependency** — download data fresh each time, discard after simulation
- Simplify to: `fetchOHLCV(params)` → calls Twelve Data directly → returns Candle[]
- Remove service-client import (no more cache upserts)

### Modify: `lib/types/backtest.ts`
- Remove `COINGECKO_IDS`, `AV_FUNCTION_MAP` constants
- Expand `BACKTEST_TIMEFRAMES` to: `['1m','5m','15m','30m','1H','4H','1D','1W','1M']`

---

## 2. Enhanced Strategy Extraction (AI → Structured JSON)

### Modify: `lib/types/backtest.ts` — New `StrategyRuleSet` type

Replace the old `StrategyRules` (free-text arrays) with a rich structured schema:

```typescript
export interface IndicatorConfig {
  type: 'EMA' | 'SMA' | 'RSI' | 'MACD' | 'BBANDS' | 'ATR' | 'STOCH' | 'VWAP' | 'ADX'
  params: Record<string, number>  // e.g. { period: 14 }, { fast: 12, slow: 26, signal: 9 }
}

export interface Condition {
  type: 'indicator_cross_above' | 'indicator_cross_below' | 'indicator_above' | 'indicator_below'
       | 'price_above' | 'price_below' | 'rsi_oversold' | 'rsi_overbought'
       | 'macd_histogram_positive' | 'macd_histogram_negative'
       | 'bb_lower_touch' | 'bb_upper_touch'
       | 'stoch_oversold' | 'stoch_overbought'
       | 'atr_above' | 'atr_below' | 'adx_above' | 'adx_below'
       | 'candle_pattern'
  indicator1?: string  // e.g. "ema_9"
  indicator2?: string  // e.g. "ema_21" (for crossover conditions)
  value?: number       // threshold for RSI/ATR/ADX comparisons
  operator?: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'
  pattern?: string     // for candle_pattern: e.g. "bullish_engulfing", "pin_bar"
}

export interface TradeManagementRule {
  type: 'trailing_stop' | 'break_even' | 'partial_exit' | 'move_sl_to_entry'
  params: Record<string, number>
  // trailing_stop: { activation_pct: 1.0, trail_pct: 0.5 } (activation in R-multiples, trail in %)
  // break_even: { activation_r: 1.0 } (move SL to entry after N R)
  // partial_exit: { r_multiple: 2.0, close_pct: 50 } (close 50% at 2R)
  // move_sl_to_entry: { activation_r: 1.0 }
}

export interface SessionFilter {
  sessions: ('london' | 'new_york' | 'asian' | 'overlap')[]
  alignment: 'entry_only' | 'exit_only' | 'both'  // when to enforce
}

export interface StrategyRuleSet {
  name: string
  indicators: IndicatorConfig[]
  entry_long: Condition[]
  entry_short: Condition[]
  exit_long: Condition[]
  exit_short: Condition[]
  stop_loss: { method: 'fixed_pips' | 'atr_based' | 'swing_low_high' | 'indicator'; value?: number; atr_multiplier?: number }
  take_profit: { method: 'fixed_pips' | 'risk_reward' | 'atr_based' | 'indicator'; value?: number; rr_ratio?: number; atr_multiplier?: number }
  risk_per_trade_pct: number
  position_sizing: { method: 'fixed_lot' | 'risk_based' | 'percent_equity'; value?: number }
  session_filter: SessionFilter | null
  invalidation: Condition[]
  trade_management: TradeManagementRule[]
  order_type: 'market' | 'limit' | 'stop'
  timeframe: string
  notes: string
}
```

### Modify: `lib/prompts/backtest-system-prompts.ts`

**Replace** `STRATEGY_EXTRACTOR_PROMPT` — instruct NIM to output the full `StrategyRuleSet` JSON schema with:
- List of indicators to compute (type + params)
- Entry conditions as typed `Condition[]` objects (not free text)
- Exit conditions as typed `Condition[]` objects
- Structured SL/TP configuration
- Session filter, invalidation, trade management rules
- Position sizing method
- Include all condition types in the prompt as examples
- Anti-prompt-injection instructions preserved

**Delete** `buildSimulationPrompt()` — no longer needed. AI does not decide trades.

**Replace** `BACKTEST_ANALYST_PROMPT` — update to reference the richer StrategyRuleSet structure.

### Modify: `lib/nim/extract-strategy-rules.ts`
- Return type changes: `StrategyRules` → `StrategyRuleSet`
- Validation: ensure `indicators`, `entry_long`, `entry_short`, `exit_long`, `exit_short` are arrays
- Default `risk_per_trade_pct = 1` if missing/invalid
- Default `position_sizing = { method: 'risk_based' }` if missing
- Retry logic unchanged

---

## 3. Indicator Computation Module

### Create: `lib/backtest/indicators.ts`

Compute indicator values from `Candle[]` arrays. Each function takes candles + params, returns a `number[]` aligned with candle indices.

| Indicator | Key | Params | Returns |
|-----------|-----|--------|---------|
| SMA | `sma_{period}` | `{ period }` | `number[]` |
| EMA | `ema_{period}` | `{ period }` | `number[]` |
| RSI | `rsi_{period}` | `{ period }` | `number[]` |
| MACD | `macd` | `{ fast, slow, signal }` | `{ macd: number[], signal: number[], histogram: number[] }` |
| Bollinger Bands | `bbands` | `{ period, std_dev }` | `{ upper: number[], middle: number[], lower: number[] }` |
| ATR | `atr_{period}` | `{ period }` | `number[]` |
| Stochastic | `stoch` | `{ k_period, d_period }` | `{ k: number[], d: number[] }` |
| ADX | `adx_{period}` | `{ period }` | `number[]` |
| VWAP | `vwap` | none | `number[]` (requires volume — skip if no volume, use 0) |

**Key function**: `computeIndicators(candles: Candle[], configs: IndicatorConfig[]): Map<string, number[] | IndicatorSeries>`

The function processes all `IndicatorConfig[]` from the strategy and returns a map keyed by a canonical name (e.g. `ema_9`, `rsi_14`, `macd_histogram`, `bbands_upper`).

---

## 4. Deterministic Rule Engine

### Create: `lib/backtest/rule-engine.ts`

**`evaluateCondition(condition: Condition, barIndex: number, indicators: Map, candle: Candle): boolean`**

Each condition type evaluates programmatically:
- `indicator_cross_above` — `indicators.get(key1)[i] > indicators.get(key2)[i]` AND `indicators.get(key1)[i-1] <= indicators.get(key2)[i-1]`
- `indicator_cross_below` — inverse
- `indicator_above` / `indicator_below` — direct comparison
- `price_above` / `price_below` — compare close to indicator value
- `rsi_oversold` — RSI < value (default 30)
- `rsi_overbought` — RSI > value (default 70)
- `macd_histogram_positive` / `macd_histogram_negative` — sign check
- `bb_lower_touch` / `bb_upper_touch` — close near band (within 0.5%)
- `stoch_oversold` / `stoch_overbought` — K < 20 / K > 80
- `atr_above` / `atr_below` — ATR compared to value
- `adx_above` / `adx_below` — ADX compared to value
- `candle_pattern` — detect patterns from OHLC (pin_bar, bullish_engulfing, bearish_engulfing, doji, hammer)

**`evaluateAllConditions(conditions: Condition[], barIndex, indicators, candle): boolean`** — returns true if ALL conditions are met (AND logic).

---

## 5. Trade Execution Simulator

### Create: `lib/backtest/execution-simulator.ts`

**`ExecutionConfig`**:
```typescript
export interface ExecutionConfig {
  spread_pips: number          // default: 1.0 for forex, variable for crypto
  slippage_pips: number        // default: 0.5
  commission_per_lot: number   // default: 7.0 round turn
  swap_long_per_day: number   // default: 0 (user can set)
  swap_short_per_day: number  // default: 0
  leverage: number             // default: 100
  margin_requirement_pct: number  // derived from leverage
}
```

**Applied on every trade**:
- Entry price adjusted: long = ask (close + spread/2), short = bid (close - spread/2)
- Slippage: additional adverse shift on entry (0.5 pips default)
- Commission deducted from PnL per trade (round-turn)
- Swap: accrued per day for positions held overnight
- Margin check: equity must cover margin requirement to open position
- Position sizing based on `StrategyRuleSet.position_sizing`

### Create: `lib/backtest/trade-manager.ts`

Manages the lifecycle of open positions, tracks active trades, applies trade management rules:

**Trailing Stop**: On each new bar, if position is profitable by `activation_pct`, move SL to `high - trail_pct * (high - entry)` (long) or inverse (short). SL only moves in the favorable direction — never backward.

**Break-even**: When unrealized R-multiple reaches `activation_r`, move SL to entry price.

**Partial Exit**: When price reaches `r_multiple * risk`, close `close_pct%` of position at current price, keep rest running with adjusted lot size.

**Move SL to Entry**: Similar to break_even but triggered at specified R.

---

## 6. Professional Performance Calculator

### Create: `lib/backtest/performance-calculator.ts`

Takes the raw trade list + equity curve and computes all metrics:

| Metric | Computation |
|--------|-------------|
| Win rate | wins / total × 100 |
| Total PnL | sum of all trade PnLs |
| Max drawdown % | peak-to-trough from equity curve |
| Profit factor | gross profit / gross loss |
| Expectancy | (avg_win × win_rate) - (avg_loss × loss_rate) per trade |
| Avg R:R | avg_win / avg_loss |
| Sharpe ratio | (mean_return - risk_free_rate) / std_dev_returns (annualized) |
| Max consecutive wins/losses | streak tracker through trade list |
| Avg R-multiple | mean of (pnl / initial_risk) across trades |
| Balance curve | cumulative PnL + starting capital |
| Monthly returns | aggregate PnL by calendar month |
| Drawdown curve | drawdown at each equity point |
| Trade distribution | PnL histogram buckets |
| Win/loss ratio | wins:losses count |

**Update `BacktestResult` type** to include all new fields:
```typescript
export interface BacktestResult {
  // existing
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_pnl_usd: number
  total_pnl_pct: number
  max_drawdown_pct: number
  avg_rr: number
  profit_factor: number
  expectancy: number
  equity_curve: EquityPoint[]
  trade_log: CompletedTrade[]

  // new
  balance_curve: EquityPoint[]
  monthly_returns: { month: string; pnl: number; pct: number }[]
  drawdown_curve: { time: string; drawdown_pct: number }[]
  trade_distribution: { range: string; count: number }[]
  win_loss_ratio: string           // "45:55"
  max_consecutive_wins: number
  max_consecutive_losses: number
  avg_r_multiple: number
  sharpe_ratio: number | null      // null if < 12 trades
  margin_used_pct: number
  total_commission: number
  total_swap: number
  total_slippage_cost: number
}
```

**Update `CompletedTrade` type** with execution details:
```typescript
export interface CompletedTrade {
  // existing
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: string
  exitPrice: number
  exitTime: string
  stopLoss: number | null
  takeProfit: number | null
  pnlUsd: number
  pnlPips: number
  exitReason: string

  // new
  lotSize: number
  commission: number
  swap: number
  slippage_cost: number
  initial_risk: number          // equity × risk_pct
  r_multiple: number            // pnlUsd / initial_risk
  entryType: 'market' | 'limit' | 'stop'
  partial_exits: { r_multiple: number; close_pct: number; pnl: number }[]
}
```

---

## 7. Backtest Engine Orchestrator

### Create: `lib/backtest/engine.ts`

The core bar-by-bar simulation loop:

```typescript
export async function runBacktestEngine(params: {
  candles: Candle[]
  rules: StrategyRuleSet
  executionConfig: ExecutionConfig
  startingCapital: number
}): Promise<BacktestResult>
```

**Algorithm**:
1. Compute all indicators from `rules.indicators` → `Map<string, number[]>`
2. Initialize state: equity, position (null), trades[], equityCurve[], balanceCurve[]
3. For each bar (starting from max lookback index):
   a. Check session filter — skip if outside allowed sessions
   b. If position open:
      - Check SL/TP hit (use candle high/low with spread)
      - Apply trade management rules (trailing stop, break-even, partial exits)
      - Evaluate exit conditions → close if met
      - If closed, record trade in trade log
   c. If no position:
      - Evaluate entry_long conditions → open long if met
      - Evaluate entry_short conditions → open short if met
      - Calculate position size from rules
      - Apply execution costs (spread, slippage, commission)
   d. Record equity/balance at this bar
4. Close any remaining position at last bar's close
5. Pass trades + curves to `performanceCalculator()`
6. Return `BacktestResult`

**This is 100% deterministic** — no AI calls during execution. Same candles + same rules = identical result every run.

---

## 8. AI Backtest Reviews (5 Personalities)

### Create: `lib/prompts/backtest-review-prompts.ts`

Five personality prompts adapted for backtest review (reuse the same personalities from trade reviews, but focused on strategy + backtest results instead of individual trades). Each evaluates:
- Rule quality (are the rules well-defined, consistent, edge-based)
- Risk management (position sizing, SL placement, drawdown exposure)
- Strategy consistency (does the strategy behave as intended)
- Weaknesses (what market conditions will break this strategy)
- Strengths (what the strategy does well)
- Suggested improvements (concrete rule changes)
- Expected robustness (will this survive live trading?)
- Prop firm suitability (would this pass a funded challenge?)

Each returns structured JSON:
```typescript
export interface BacktestPersonalityReview {
  rule_quality: number         // 1-10
  risk_management: number      // 1-10
  strategy_consistency: number // 1-10
  robustness: number           // 1-10
  overall: number              // 1-10
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  verdict: string
  strengths: string[]
  weaknesses: string[]
  improvements: string[]
  prop_firm_suitable: boolean
}
```

### Create: `lib/nim/backtest-reviews.ts`

```typescript
export async function generateBacktestReviews(
  rules: StrategyRuleSet,
  result: BacktestResult,
  params: BacktestParams,
): Promise<BacktestPersonalityReview[]>
```

Calls NIM with each of the 5 personality prompts **in parallel**, then returns the reviews. Retry logic with fallback model per personality.

---

## 9. Modified Backtest Report (single AI narrative + 5 personality reviews)

### Modify: `lib/nim/run-backtest.ts`

- **Delete** the old `runBacktest()` function (AI-simulated, non-deterministic)
- **Keep** `generateBacktestReport()` — update to accept `StrategyRuleSet` instead of `StrategyRules`
- Rename file or keep — it still generates a narrative via NIM

---

## 10. Multi-Step Workflow: Extract → Review/Edit → Run

### Current flow: Upload → POST /api/backtest → fire-and-forget → poll

### New flow: Extract → Review → Approve → Run

**Step A**: Upload + Extract
- User fills form (same as current), submits
- API route: extract rules, store in `backtest_runs` as `status: 'extracted'`, store `extracted_rules` JSONB
- Return `backtestId` to client, redirect to review page

**Step B**: Review/Edit extracted rules
- New page: `/backtest/[id]/review`
- Display the extracted `StrategyRuleSet` as readable, editable form
- User can modify conditions, add/remove indicators, adjust risk settings
- User clicks "Approve & Run"
- POST to `/api/backtest/[id]/run` — saves approved rules, starts execution

**Step C**: Run (same polling pattern as current)
- Status moves from `approved` → `running` → `complete`
- Download candles, run deterministic engine, compute metrics, generate AI report + 5 personality reviews

### API Route Changes

**Modify: `app/api/backtest/route.ts`** — POST now only does:
1. Auth check
2. Insert `backtest_runs` row (status: `extracting`)
3. Fire-and-forget: download doc, extract rules via NIM
4. Update row with `extracted_rules` JSONB, status: `extracted`
5. Return `backtestId` (202)

**Create: `app/api/backtest/[id]/route.ts`** — POST endpoint:
1. Auth + ownership check
2. Accept approved `StrategyRuleSet` + `ExecutionConfig` from client
3. Update row with `approved_rules` JSONB, status: `running`
4. Fire-and-forget: fetch candles → run engine → compute metrics → generate reports → update row

**Create: `app/api/backtest/[id]/rules/route.ts`** — PATCH endpoint:
1. Auth + ownership check
2. Accept edited `StrategyRuleSet` (Zod validated)
3. Update `extracted_rules` JSONB on the run row

---

## 11. Database Migration

### Create: `supabase/migrations/007_backtest_engine_overhaul.sql`

**Clean break — delete old AI-simulated data, add new columns**:
```sql
-- Delete all existing backtest_runs (incompatible with new deterministic engine)
DELETE FROM backtest_runs;

-- Add new columns to backtest_runs
ALTER TABLE backtest_runs
  ADD COLUMN IF NOT EXISTS extracted_rules jsonb,     -- AI-extracted StrategyRuleSet
  ADD COLUMN IF NOT EXISTS approved_rules jsonb,       -- user-approved StrategyRuleSet
  ADD COLUMN IF NOT EXISTS execution_config jsonb,     -- ExecutionConfig
  ADD COLUMN IF NOT EXISTS personality_reviews jsonb;  -- 5 personality reviews array

-- Update status check constraint to include new statuses
ALTER TABLE backtest_runs DROP CONSTRAINT IF EXISTS backtest_runs_status_check;
ALTER TABLE backtest_runs ADD CONSTRAINT backtest_runs_status_check
  CHECK (status IN ('extracting', 'extracted', 'approved', 'running', 'complete', 'error'));

-- No additional RLS needed — existing CRUD policies on backtest_runs cover these columns
```

---

## 12. UI Changes

### Modify: `/backtest` page (form)
- Update `BACKTEST_TIMEFRAMES` to include all new intervals: `1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M`
- Add `ExecutionConfig` fields (collapsible advanced section):
  - Spread (pips): default 1.0
  - Slippage (pips): default 0.5
  - Commission (per lot round-turn): default $7.00
  - Swap Long / Swap Short (per day): default $0
  - Leverage: default 100
- **Two input modes** (tabbed or toggle):
  - **Upload mode** (current): upload strategy doc → AI extracts rules → redirect to review page
  - **Manual mode**: structured rule builder form — add indicators, conditions, SL/TP, risk settings directly
    - Both modes produce the same `StrategyRuleSet` JSON
    - Manual mode skips the `extracting` → `extracted` steps and goes straight to `review` page with the user-built rules
- Submit now redirects to `/backtest/[id]/review` instead of `/backtest/[id]`

### Create: `/backtest/rule-builder` components (within `/backtest/page.tsx` or separate client component)
- **Indicator selector**: dropdown of indicator types + param inputs, add/remove indicators
- **Condition builder**: for each condition group (entry_long, entry_short, exit_long, exit_short):
  - Add condition → dropdown of condition types → fill in indicator1/indicator2/value
  - Remove condition
  - All conditions are AND logic (display label: "All conditions must be met")
- **SL/TP configuration**: dropdown for method + value input
- **Trade management rules**: add trailing stop, break-even, partial exit rules
- **Session filter**: checkboxes for london/new_york/asian/overlap
- **Risk settings**: risk %, position sizing method

### Create: `/backtest/[id]/review` page
- Shows extracted rules in a readable form:
  - Indicators section (list each with params)
  - Entry Long conditions (human-readable: "EMA 9 crosses above EMA 21")
  - Entry Short conditions
  - Exit Long conditions
  - Exit Short conditions
  - SL/TP configuration
  - Risk per trade, position sizing
  - Session filter
  - Invalidation conditions
  - Trade management rules
- Editable fields — user can modify before approving
- "Approve & Run Backtest" button
- "Cancel" link back to /backtest
- Loading state while extraction is in progress (poll for `extracted` status)

### Modify: `/backtest/[id]` report page
- **Stats grid**: expand from 6 to 8 cards (add max consecutive wins/losses, avg R-multiple)
- **New charts** (using Recharts):
  - Balance Curve (alongside equity curve)
  - Drawdown Chart (area chart, inverted)
  - Monthly Returns (bar chart)
  - Trade Distribution (histogram bar chart)
- **5 Personality Reviews section**: cards for each reviewer showing scores, verdict, strengths, weaknesses
- **Export button**: download results as JSON
- Updated `BacktestResult` type rendered

### Modify: `/backtest/history` page
- Minor: show new status badges for `extracting`, `extracted`, `approved`

---

## 13. Update CLAUDE.md

- Replace Alpha Vantage + CoinGecko references with Twelve Data
- Replace `ALPHA_VANTAGE_API_KEY` with `TWELVE_DATA_API_KEY`
- Document the new architecture: separation of AI extraction from deterministic execution
- Document the new backtest flow: upload → extract → review → approve → run
- Document the new rule engine and execution simulator

---

## 14. File Summary

### New Files
| File | Purpose |
|------|---------|
| `lib/data/twelvedata.ts` | Twelve Data API client |
| `lib/backtest/indicators.ts` | Technical indicator computations |
| `lib/backtest/rule-engine.ts` | Condition evaluation engine |
| `lib/backtest/execution-simulator.ts` | Spread, slippage, commission, swap, margin |
| `lib/backtest/trade-manager.ts` | Position lifecycle, trailing stop, break-even, partial exits |
| `lib/backtest/performance-calculator.ts` | All metrics computation |
| `lib/backtest/engine.ts` | Bar-by-bar orchestrator |
| `lib/prompts/backtest-review-prompts.ts` | 5 personality prompts for backtest reviews |
| `lib/nim/backtest-reviews.ts` | Parallel NIM calls for backtest personality reviews |
| `app/backtest/[id]/review/page.tsx` | Review/edit extracted rules or manual rules |
| `app/api/backtest/[id]/route.ts` | Start backtest execution |
| `app/api/backtest/[id]/rules/route.ts` | Update extracted rules |
| `supabase/migrations/007_backtest_engine_overhaul.sql` | Schema changes |
| `components/backtest/rule-builder.tsx` | Manual strategy rule builder form (client component) |
| `components/backtest/condition-editor.tsx` | Condition row editor (add/remove conditions) |
| `components/backtest/indicator-config.tsx` | Indicator selector with parameter inputs |

### Modified Files
| File | Change |
|------|--------|
| `lib/data/index.ts` | Replace Alpha Vantage/CoinGecko with Twelve Data, remove caching |
| `lib/types/backtest.ts` | New StrategyRuleSet, Condition, IndicatorConfig, ExecutionConfig, updated BacktestResult/CompletedTrade, expanded timeframes |
| `lib/prompts/backtest-system-prompts.ts` | New structured extraction prompt, delete simulation prompt, update analyst prompt |
| `lib/nim/extract-strategy-rules.ts` | Return StrategyRuleSet, updated validation |
| `lib/nim/run-backtest.ts` | Delete old runBacktest(), keep update generateBacktestReport() |
| `app/api/backtest/route.ts` | Extract-only flow, store extracted_rules |
| `app/backtest/page.tsx` | Add execution config fields, new timeframes, redirect to review |
| `app/backtest/[id]/page.tsx` | Enhanced dashboard with new charts + personality reviews + export |
| `app/backtest/history/page.tsx` | New status badges |
| `lib/types/trade.ts` | No changes needed (pair lists remain) |
| `CLAUDE.md` | Document new architecture |

### Deleted Files
| File | Reason |
|------|--------|
| `lib/data/alphavantage.ts` | Replaced by Twelve Data |
| `lib/data/coingecko.ts` | Replaced by Twelve Data |

---

## 15. Data Flow (End-to-End)

```
User uploads strategy doc + params
  → POST /api/backtest
  → Insert backtest_runs (status: extracting)
  → Return 202 { backtestId }

Background: download doc → NIM extractStrategyRules() → store extracted_rules → status: extracted

Client redirects to /backtest/{id}/review
  → Polls until status == extracted
  → Displays StrategyRuleSet in editable form
  → User reviews/edits rules
  → PATCH /api/backtest/{id}/rules (save edits, optional)
  → User clicks "Approve & Run"
  → POST /api/backtest/{id}/run (sends approved rules + execution config)

Background:
  → Fetch candles from Twelve Data (server-side only, TWELVE_DATA_API_KEY)
  → Compute indicators from candles
  → Run deterministic bar-by-bar engine:
      For each bar:
        Check session filter
        If position open: check SL/TP, apply trade management, evaluate exit conditions
        If no position: evaluate entry conditions
        Apply execution costs (spread, slippage, commission)
  → Compute performance metrics
  → Generate AI narrative report (NIM)
  → Generate 5 personality reviews (NIM, parallel)
  → Store result + personality_reviews → status: complete
  → Discard candle data (not stored)

Client polls /backtest/{id} → displays full dashboard when complete
```

---

## 16. Env Variable Changes

**Add**: `TWELVE_DATA_API_KEY`
**Remove**: `ALPHA_VANTAGE_API_KEY`

---

## 17. Verification

1. Run `npm run build` — ensure no TypeScript errors
2. Run `npm run dev` — test the full flow:
   - Upload a strategy document -> verify extraction produces structured rules
   - Review page shows all extracted conditions in readable form
   - Edit a condition and save -> verify PATCH endpoint works
   - Approve and run -> verify deterministic execution (run twice, same results)
   - Report page shows all charts, metrics, and 5 personality reviews
3. Run `npm run lint` — no new warnings
4. Verify existing journal functionality still works (no regressions)
5. Verify Twelve Data API key never appears in client bundle (check network tab — only server-side calls)
6. Verify ohlcv_cache table is no longer written to during backtest
