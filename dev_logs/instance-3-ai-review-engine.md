# Session Log — Instance 3: AI Review Engine

**Date:** 2026-06-30
**Status:** ✅ Complete

---

## Objective

Wire the "Get AI Review" button to call NVIDIA NIM API with 5 AI reviewer personalities. Each personality scores a trade across 5 dimensions (1–10), gives a grade, verdict, strengths, improvements, and key mistake. Results persist in `trade_reviews` and render in the trade detail page with a radar chart, score bars, and tabbed personality view.

---

## Tasks Completed

### 3.1 — Review Type Definitions

| File | Purpose |
|---|---|
| `lib/types/review.ts` | `PersonalityReview`, `TradeReview`, `PERSONALITY_KEYS`, `PERSONALITY_META` (icon/label/color), `DIMENSION_LABELS` |

**Key exports:**
- `PersonalityReview` — interface matching the spec: 5 dimension scores, overall, grade (A–F), verdict, strengths[], improvements[], key_mistake?
- `TradeReview` — wrapper with trade_id, 5 personality fields, composite_score
- `PERSONALITY_KEYS` — const array for iteration
- `PERSONALITY_META` — labels, emoji icons, accent colors per personality
- `DIMENSION_LABELS` — human-readable names for the 5 scored dimensions

### 3.2 — NIM API Client

| File | Purpose |
|---|---|
| `lib/nim/client.ts` | Lazy-initialised OpenAI SDK client for NIM endpoint |
| `lib/nim/parse-nim-json.ts` | `parseNimJson<T>()` — strips markdown code fences before JSON.parse |
| `lib/nim/build-trade-context.ts` | `buildTradeContext(trade)` — converts Trade to human-readable paragraph |

**Key design decision:** NIM client is lazily initialised via `getNimClient()` instead of module-level instantiation. The OpenAI SDK throws at import time during Next.js build if `apiKey` is falsy. Lazy init prevents the build from failing when env vars aren't present.

### 3.3 — Reviewer System Prompts

| File | Purpose |
|---|---|
| `lib/prompts/reviewer-system-prompts.ts` | 5 personality prompt strings + `buildReviewSystemPrompt()` |

Each personality prompt matches the spec exactly. `buildReviewSystemPrompt()` appends the JSON schema the model must follow, ensuring structured output.

### 3.4 — Supabase Service Role Client

| File | Purpose |
|---|---|
| `lib/supabase/service-client.ts` | `createServiceClient()` — bypasses RLS for API routes |

Used by `/api/review` to fetch trade data and insert reviews without user-session cookies.

### 3.5 — Review API Route

| File | Purpose |
|---|---|
| `app/api/review/route.ts` | POST handler — orchestrates the full review pipeline |

**Flow:**
1. Accepts `{ tradeId }` in request body
2. Fetches trade from Supabase via service role client
3. Checks for existing review (returns it if found — idempotent)
4. Builds trade context string
5. Calls all 5 personalities in parallel (`Promise.all`)
6. Each call: primary model → retry once with fallback model → store `null` if both fail
7. Validates JSON shape, clamps scores to 1–10
8. Computes `composite_score` (mean of non-null `overall` scores, rounded to 1 decimal)
9. Inserts into `trade_reviews`
10. Returns the full review row

### 3.6 — UI Components

| File | Purpose |
|---|---|
| `components/journal/CompositeScore.tsx` | Circular SVG gauge + personality avatar row |
| `components/journal/ScoreCard.tsx` | Radar chart + score bars + strengths/improvements/key mistake |
| `components/journal/ReviewPanel.tsx` | Orchestrator: idle → loading → done/error states + tabbed personality view |

**CompositeScore:**
- Circular SVG gauge: stroke-dasharray/offset animation based on `composite_score / 10`
- Color: ≥7 green, ≥5 amber, <5 red
- Row of 5 personality circles (emoji + individual score)

**ScoreCard:**
- Personality header with emoji, label, verdict, grade badge
- Recharts `RadarChart` with 5 dimensions
- Horizontal score bars (color-coded per threshold)
- Strengths (green), Improvements (amber), Key Mistake (red bordered box)

**ReviewPanel:**
- **Idle:** "Get AI Review" button
- **Loading:** spinner + cycling personality names (2s interval)
- **Error:** "Retry" button
- **Done:** CompositeScore → Tabs with 5 personality tabs (emoji + label + score in trigger)
- `mapDbReview()` converts raw DB row to typed `TradeReview`

### 3.7 — TradeDetailClient Update

- Removed `Sparkles` import (now used inside ReviewPanel)
- Removed `hasReview` variable
- Replaced placeholder AI Review card with `<ReviewPanel tradeId={trade.id} existingReview={trade.trade_reviews?.[0] ?? null} />`

### 3.8 — shadcn/ui Tabs Component

Added via `npx shadcn@latest add tabs`. Base UI Tabs primitive with `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.

---

## Build Artifacts

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/review          ← NEW
├ ƒ /auth/callback
├ ○ /auth/login
├ ○ /auth/signup
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
| OpenAI SDK throws at module scope during Next.js build when `apiKey` is missing | Changed from `export const nimClient = new OpenAI(...)` to lazy `getNimClient()` function — SDK only instantiated on first actual API call |
| TypeScript error: `PersonalityReview` not assignable to `Record<string, unknown>` for dynamic key assignment in score clamping | Double-cast via `as unknown as Record<string, unknown>` |
| Edit tool couldn't match indentation because the Read output inserts tabs | Used `cat -v` to inspect exact whitespace, matched the 10-space indentation |

---

## New Files Created

| File | Type | Lines |
|---|---|---|
| `lib/types/review.ts` | Types + constants | ~55 |
| `lib/nim/client.ts` | NIM client (lazy) | ~18 |
| `lib/nim/parse-nim-json.ts` | JSON parser | ~5 |
| `lib/nim/build-trade-context.ts` | Trade context builder | ~40 |
| `lib/supabase/service-client.ts` | Service role client | ~8 |
| `lib/prompts/reviewer-system-prompts.ts` | 5 system prompts | ~50 |
| `app/api/review/route.ts` | API route (POST) | ~140 |
| `components/journal/CompositeScore.tsx` | Circular gauge | ~70 |
| `components/journal/ScoreCard.tsx` | Radar + score bars + feedback | ~120 |
| `components/journal/ReviewPanel.tsx` | Review orchestrator | ~130 |
| `components/ui/tabs.tsx` | shadcn/ui Tabs | ~82 |

## Modified Files

| File | Change |
|---|---|
| `app/journal/[id]/TradeDetailClient.tsx` | Replaced placeholder with ReviewPanel, removed unused imports |

## shadcn Components Added

`tabs`

---

## Remaining Work (Future Instances)

1. **Instance 4** — AI Backtest: Strategy doc upload, OHLCV fetching, chunked simulation, results page
2. **Instance 5** — Dashboard analytics: Stats cards, recharts performance charts, streaks, calendar heat map
3. **Instance 6** — Settings page: Profile edit, avatar upload
4. **Real Supabase project** — Run migration SQL, create storage buckets, configure auth providers
