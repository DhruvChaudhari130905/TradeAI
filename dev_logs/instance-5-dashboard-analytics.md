# Session Log — Instance 5: Dashboard & Analytics

**Date:** 2026-06-30
**Status:** ✅ Complete

---

## Objective

Build the main dashboard as a command centre showing trading performance at a glance, AI-powered performance insights, settings page for profile/password/account management, and thoughtful empty states across all pages.

---

## Tasks Completed

### 5.1 — Dashboard Page

| File | Purpose |
|---|---|
| `lib/actions/dashboard.ts` | `getDashboardData()` server action — fetches trades+reviews and backtests, computes stats |
| `components/dashboard/StatsCards.tsx` | 4 stat cards: Total Trades, Win Rate %, Net PnL, Avg AI Score |
| `components/dashboard/PnlChart.tsx` | Cumulative PnL AreaChart (Recharts) with gradient fill, green/red based on profit |
| `components/dashboard/WinLossChart.tsx` | Win/Loss/Breakeven/Open PieChart (Recharts) with legend |
| `components/dashboard/AiScoreChart.tsx` | AI Score Trend LineChart (Recharts) with average reference line |
| `components/dashboard/RecentTrades.tsx` | Last 5 trades with pair, outcome, PnL, AI score — links to detail |
| `components/dashboard/RecentBacktests.tsx` | Last 3 completed backtests with strategy name, pair/TF, win rate, PnL — links to report |
| `app/dashboard/page.tsx` | Server Component — fetches data, renders all components or empty state |

**Dashboard layout:**
- Top: Welcome header with username
- Stats row: 4 cards (Total Trades, Win Rate, Net PnL, Avg AI Score)
- Charts row: Cumulative PnL (2-col span) + Win/Loss Pie (1-col) — responsive grid
- AI Score Trend: Full-width LineChart with average reference line
- Bottom row: Recent Trades + Recent Backtests + AI Insights

**Data flow:**
- `getDashboardData()` server action fetches trades with `trade_reviews(composite_score)` join + backtest_runs
- Computes totalTrades, winRate, netPnl, avgAiScore
- Returns chronological `trades` (for charts) and `recentTrades` (newest-first, limit 5)

### 5.2 — Performance Insights

| File | Purpose |
|---|---|
| `app/api/insights/route.ts` | POST handler — NIM call for 3 personalised insights with 24h Supabase cache |
| `components/dashboard/InsightsPanel.tsx` | Client component — fetches insights, displays with type-colored cards |
| `supabase/migrations/004_dashboard_insights.sql` | `dashboard_insights` table with RLS |

**Insights generation:**
- Fetches last 20 trades (pair, market, direction, outcome, PnL, session, times, R:R)
- Calls NIM with structured extraction prompt asking for 3 insights
- Focus: best session, most profitable pair, recurring losing-trade patterns
- Each insight has: title (≤6 words), description (1-2 sentences with data), type (positive/neutral/warning)
- Caches result in `dashboard_insights` table with 24h TTL — upsert on user_id
- Uses `parseNimJson` to strip markdown code fences from NIM responses
- Requires ≥5 trades; shows "unlock" placeholder below that threshold

### 5.3 — Settings Page

| File | Purpose |
|---|---|
| `app/dashboard/settings/page.tsx` | Profile update, password change, danger zone (delete account) |
| `supabase/migrations/005_avatars_bucket.sql` | `avatars` storage bucket (public read, user-scoped upload) |

**Settings sections:**
- **Profile**: Avatar upload (click-to-upload, max 2MB, stored in `avatars` bucket), username edit
- **Security**: New password + confirm (min 6 chars, match check), calls `supabase.auth.updateUser`
- **Danger Zone**: Delete account with confirmation dialog (type "DELETE"), cascade-deletes all user data

**Note on account deletion:** Full auth.users deletion requires a Supabase admin function with service role key. Current implementation deletes user data (reviews, insights, backtests, trades, profile) and signs out — the auth.users row remains. A Supabase Edge Function or admin API should be added for true account deletion.

### 5.4 — Empty States

All pages now have thoughtful empty states:

| Page | Empty State |
|---|---|
| `/dashboard` | Icon + "Your command centre awaits" + Log a Trade / Run a Backtest CTAs |
| `/journal` | Icon + "No trades yet" + "Log your first trade" CTA |
| `/backtest/history` | Icon + "No backtests yet" + "Test your first strategy" CTA |
| `/dashboard/settings` | Always shows (no data dependency) |
| Insights panel | "Log at least 5 trades to unlock AI-powered performance insights" |

---

## Build Artifacts

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/backtest
├ ƒ /api/insights          ← NEW
├ ƒ /api/review
├ ƒ /auth/callback
├ ○ /auth/login
├ ○ /auth/signup
├ ○ /backtest
├ ƒ /backtest/[id]
├ ○ /backtest/history
├ ƒ /dashboard
├ ƒ /dashboard/settings    ← NEW
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
| `DialogTrigger asChild` doesn't exist on base-ui Dialog | Base UI uses `render` prop: `<DialogTrigger render={<Button …/>}>text</DialogTrigger>` |
| `trade_reviews.delete().eq('trade_id', user.id)` — wrong column | Fixed to `.eq('user_id', user.id)` — trade_reviews has user_id, not trade_id matching auth uid |
| Recharts `Tooltip formatter` type: `(value: number)` incompatible with `ValueType \| undefined` | Remove explicit type annotation, use `Number(value)` inside: `(value) => [`${Number(value).toFixed(1)}/10`]` — matches pattern from Instance 4 |
| `let insights` has implicit `any[]` type | Typed as `let insights: unknown[]`, then cast inside `.map` with `ins as Record<string, unknown>` |
| Insights API uses raw `JSON.parse` instead of shared `parseNimJson` | Refactored to use `parseNimJson<unknown[]>` from `lib/nim/parse-nim-json` — handles NIM's markdown code fence wrapping |
| Win rate denominator includes open/unresolved trades | Fixed: winRate now computed over closed trades only (`win` + `loss`), not all trades — avoids artificially deflating the percentage |
| Inline `INSIGHTS_PROMPT` in API route violates CLAUDE.md | Extracted to `lib/prompts/insights-system-prompt.ts` — imported as `INSIGHTS_SYSTEM_PROMPT` |
| Backtest history uses redundant inline type assertions | Simplified: `(run.result as { total_pnl_usd?: number })?.total_pnl_usd` → `run.result?.total_pnl_usd` — BacktestResult already has the fields |
| Missing DELETE RLS policy on avatars storage bucket | Added `CREATE POLICY "Users can delete their own avatar"` for full CRUD coverage |

---

## New Files Created

| File | Type | Lines |
|---|---|---|
| `lib/actions/dashboard.ts` | Server action (data fetcher) | ~88 |
| `components/dashboard/StatsCards.tsx` | Stats card row | ~65 |
| `components/dashboard/PnlChart.tsx` | Cumulative PnL AreaChart | ~110 |
| `components/dashboard/WinLossChart.tsx` | Win/Loss PieChart | ~111 |
| `components/dashboard/AiScoreChart.tsx` | AI Score LineChart | ~108 |
| `components/dashboard/RecentTrades.tsx` | Recent trades list | ~89 |
| `components/dashboard/RecentBacktests.tsx` | Recent backtests list | ~81 |
| `components/dashboard/InsightsPanel.tsx` | AI insights client component | ~120 |
| `app/api/insights/route.ts` | Insights API route (POST) | ~146 |
| `lib/prompts/insights-system-prompt.ts` | System prompt for insights NIM call | ~14 |
| `app/dashboard/settings/page.tsx` | Settings page | ~361 |
| `supabase/migrations/004_dashboard_insights.sql` | Insights cache table | ~29 |
| `supabase/migrations/005_avatars_bucket.sql` | Avatars storage bucket | ~18 |

## Modified Files

| File | Change |
|---|---|
| `app/dashboard/page.tsx` | Replaced placeholder (3 link cards) with full dashboard — stats, charts, recent activity, insights, empty state |
| `app/backtest/history/page.tsx` | Enhanced empty state with icon card + descriptive text + CTA |

---

## Remaining Work (Future Instances)

1. **Supabase Edge Function** for true account deletion (service role required to delete from auth.users)
2. **Instance 6** — Polish: loading skeletons, animation transitions, mobile responsiveness
3. **Real Supabase project** — Run migrations 001-005, create storage buckets (trade-screenshots, strategy-docs, avatars), configure auth providers
