# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Guidelines

These bias toward caution over speed. For trivial tasks, use judgment.

1. **Think before coding** — State assumptions explicitly. If multiple interpretations exist, present them. If something is unclear, stop and ask.
2. **Simplicity first** — Minimum code that solves the problem. No speculative features, abstractions for single-use code, or error handling for impossible scenarios. If you write 200 lines and it could be 50, rewrite it.
3. **Surgical changes** — Touch only what you must. Match existing style. Don't refactor things that aren't broken. Remove orphans your changes create; don't remove pre-existing dead code unless asked.
4. **Goal-driven execution** — Define success criteria. Loop until verified. For multi-step tasks, state a plan with verifiable checkpoints.

## Project: TradeAI

AI-powered trade journal and backtesting platform for Forex and Crypto traders. Two core features:
- **Trade Journal** — Log trades, get scored by 5 AI reviewer personalities
- **AI Backtesting** — Upload strategy docs or define rules manually, AI simulates trades on historical OHLCV data

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 — App Router, Server Components, Server Actions |
| Styling | Tailwind CSS + shadcn/ui |
| Auth & DB | Supabase (Auth + PostgreSQL + Storage) |
| AI Inference | NVIDIA NIM API (OpenAI-compatible endpoint) |
| Historical Data | Twelve Data (Forex + Crypto) — free tier: 8 credits/min, 800/day |
| File Uploads | Supabase Storage |
| Deployment | Vercel |
| Charts | Recharts (equity curves, drawdown, monthly returns) |

## Dev Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npx shadcn@latest add <component>  # Add shadcn/ui component
```

## Architecture

### Supabase Clients (use `@supabase/ssr`, NOT legacy auth-helpers)
- `lib/supabase/client.ts` — `createBrowserClient()` for Client Components
- `lib/supabase/server.ts` — `createServerClient()` with cookies for Server Components / Server Actions
- `middleware.ts` (project root) — refreshes session on every request, protects `/dashboard`, `/journal`, `/backtest`

### NVIDIA NIM Integration
- Client: `lib/nim/client.ts` — wraps `openai` SDK pointed at `https://integrate.api.nvidia.com/v1`
- Preferred model: `nvidia/llama-3.1-nemotron-70b-instruct`, fallback: `meta/llama-3.1-70b-instruct`
- **Always call NIM from Server Actions or API Routes only — never from the client**
- `max_tokens: 2048` for review calls, `max_tokens: 4096` for backtest report calls

### NIM JSON Response Parsing
NIM sometimes wraps JSON in markdown code fences. Always strip before parsing:
```typescript
function parseNimJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()
  return JSON.parse(cleaned) as T
}
```

### Twelve Data Integration
- Client: `lib/data/twelvedata.ts` — fetches OHLCV time series with rate limiting and pagination
- Facade: `lib/data/index.ts` — `fetchOHLCV()` wraps Twelve Data client
- Rate limits: 8 credits/min, 800/day (token bucket + daily counter)
- Pagination: splits large date ranges (>5000 candles) into 90-day chunks with 1s delay
- Retries: exponential backoff on 429 (up to 3 attempts)
- Timeframe mapping: `TF_TO_TWELVE_DATA` in `lib/types/backtest.ts` maps app timeframes to Twelve Data intervals
- **Call only from API routes / server actions — never from the client**

### Backtest Engine (`lib/backtest/`)
Deterministic engine — same candles + same rules = identical result every run. Pipeline:
1. `indicators.ts` — computeIndicators(): EMA, SMA, RSI, MACD, BBANDS, ATR, STOCH, VWAP, ADX
2. `rule-engine.ts` — evaluateAllConditions(): checks entry/exit/invalidation conditions bar-by-bar
3. `execution-simulator.ts` — entry costs, lot size (fixed_lot / risk_based / percent_equity), SL/TP (fixed_pips / atr_based / risk_reward), margin check
4. `trade-manager.ts` — SL/TP hit detection, trailing stop, break-even, partial exits, move SL to entry
5. `engine.ts` — runBacktestEngine(): orchestrates the full bar-by-bar loop
6. `performance-calculator.ts` — computePerformance(): win rate, PnL, drawdown curve, Sharpe, monthly returns, trade distribution

Engine is called from `/api/backtest/[id]` POST route after the user approves rules.

### Data Flow
- **Mutations**: Server Actions (not client-side fetch). Validate with Zod, return `{ success, data }` or `{ success: false, error }`.
- **AI Reviews (Journal)**: Client POST to `/api/review` → fetches trade from Supabase → parallel NIM calls for 5 personalities → store in `trade_reviews` → return to client.
- **Backtests (2-step flow)**:
  1. Client POST to `/api/backtest` → uploads doc → inserts row (status `extracting`) → background: NIM extracts strategy → updates to `extracted` → client redirected to `/backtest/[id]/review`
  2. User reviews/edits rules → POST to `/api/backtest/[id]` → approves rules + execution config → status `running` → background: fetches OHLCV from Twelve Data → runs engine → generates AI report + 5 personality reviews → updates to `complete` → client polls and shows report
- **Manual backtest**: User defines rules directly (no doc upload) → same 2-step flow but skips extraction

### Storage Buckets
- `trade-screenshots` — public read, authenticated write. Path: `{user_id}/{filename}`
- `strategy-docs` — private, authenticated read/write only. Path: `{user_id}/{filename}`

### Database RLS
Every table has RLS enabled. Policies use `auth.uid()` — users can only read/write their own rows.

### Caching
- Trade list: `revalidatePath('/journal')` after mutations
- Dashboard stats: `revalidatePath('/dashboard')` after trade mutations

## Code Style

- TypeScript strict mode. No `any`. Types live in `/lib/types/`.
- Zod for all form and API input validation.
- Keep AI prompt strings in `/lib/prompts/` — never inline in components or routes.
- Error handling pattern:
  ```typescript
  try {
    return { success: true, data: result }
  } catch (error) {
    console.error('[action-name]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
  ```
- Client shows errors via `sonner` toast: `toast.error(result.error)`
- Never hardcode API keys. Always use `process.env.*`.

## Design System

- Dark trading-terminal aesthetic
- Backgrounds: `#0A0B0E` (near-black), cards: `#12141A`
- Accents: `#00FF9C` (electric green for gains/positive), `#FF4D4D` (red for losses/warnings)
- `font-mono` for numbers and scores; clean sans-serif for body
- Dense, information-rich layouts — traders want data, not whitespace
- Mobile-responsive is a first-class target. Use `lg` (1024px) as the desktop breakpoint; phone and tablet layouts must remain readable and operable without horizontal page scroll.

## Env Variables (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NVIDIA_NIM_API_KEY=
TWELVE_DATA_API_KEY=
```

## AI Reviewer Personalities (Trade Journal)

When implementing AI review features, each of the 5 personalities receives identical trade data but responds through a unique lens. Each returns structured JSON only (no prose outside JSON), matching the `PersonalityReview` schema (scores 1–10 across `entry_quality`, `risk_management`, `trade_psychology`, `execution`, `strategy_adherence`, plus `overall`, grade, verdict, strengths, improvements, `key_mistake`).

1. **Prop Firm Evaluator** — Would this trader pass a funded challenge? Blunt, conservative scoring.
2. **Trading Psychologist** — Emotional decision-making vs disciplined execution. Empathetic but honest.
3. **Institutional Trader** — Order flow, smart money, market structure. Dismissive of retail-trap entries.
4. **Quantitative Analyst** — R:R, expectancy, Kelly criterion, statistical edge. Beauty without edge is garbage.
5. **Risk Manager** — Position sizing, stop loss, tail risk paranoia. No SL = automatic 0 on risk management.

## AI Backtest Personality Reviews

Same 5 personalities but scored on backtest-specific dimensions (`rule_quality`, `risk_management`, `strategy_consistency`, `robustness`, `overall`, plus `grade`, `verdict`, `strengths`, `weaknesses`, `improvements`, `prop_firm_suitable`). Prompts in `lib/prompts/backtest-review-prompts.ts`.

## Rate Limits to Be Aware Of

- **Twelve Data free tier**: 8 credits/min, 800/day. Paginated + rate-limited in `twelvedata.ts`.
- **NIM calls**: add 500ms delay between personality calls to avoid rate limiting.
