# Session Log — Instance 2: Trade Journal Module

**Date:** 2026-06-30
**Status:** ✅ Complete

---

## Objective

Build the full trade logging experience. Users can add, view, edit, and delete trades. Screenshots can be uploaded. The journal shows a filterable list of all past trades with key stats. AI review is wired up in Instance 3 — placeholder button is in place.

---

## Tasks Completed

### 2.1 — Type Definitions

| File | Purpose |
|---|---|
| `lib/types/trade.ts` | All TypeScript types (Trade, TradeWithReview, Market, Direction, Outcome, Session), Zod schemas, pair constants, `detectMarket()` |

**Zod Schema Design:**
- `tradeSchema` — form-facing schema using `z.preprocess` for empty-string-to-undefined coercion on optional fields. Accepts `tags` as a plain string (comma-separated input from form).
- `tradeSubmitSchema` — extends `tradeSchema` with `tags: z.array(z.string()).optional()` and `entry_price: z.coerce.number().positive()` for server action validation after the client has already parsed tags to an array.

**Why two schemas:** Zod v4's `.transform()` and `z.preprocess` create input/output type mismatches with react-hook-form's `Resolver` type. The form uses the `tradeSchema` for validation (tags as string), and the server actions use `tradeSubmitSchema` (tags as string[]). The client converts comma-separated tags to an array before sending to the server.

**Pair Constants:**
- `FOREX_PAIRS` — 20 major/minor FX pairs
- `CRYPTO_PAIRS` — 20 top crypto pairs  
- `ALL_PAIRS` — combined list
- `detectMarket(pair)` — auto-detects forex/crypto from pair name

### 2.2 — Trade Form

`components/journal/TradeForm.tsx` — multi-section form using react-hook-form + Zod:

| Section | Fields |
|---|---|
| Trade Details | Pair (dropdown grouped by Forex/Crypto), Market (auto-detected, read-only), Direction (Long/Short toggle buttons), Session (dropdown), Entry Time (datetime-local) |
| Prices | Entry Price, Exit Price, Stop Loss, Take Profit, Lot Size, R:R (live computed display) |
| Outcome | Result (Win/Loss/Breakeven/Still Open dropdown), PnL USD, PnL Pips, Exit Time |
| Notes & Screenshots | Notes textarea, Tags (comma-separated input), Screenshot upload (click-to-upload, preview grid with delete) |

**Key behaviors:**
- Market auto-detects when pair is selected via `detectMarket()`
- R:R auto-calculates live based on Direction, Entry Price, Stop Loss, and Take Profit
  - Green (`#00FF9C`) when R:R ≥ 2, yellow when ≥ 1, red when < 1
- Direction toggle: Long = green border/accent, Short = red border/accent
- Screenshot upload: calls `uploadScreenshot` server action per file, stores URLs in local state, shows thumbnail previews with hover-to-reveal delete button
- Works in both `create` and `edit` modes, pre-filling from `trade` prop when editing

### 2.3 — Journal List Page

`app/journal/page.tsx` — client component:

**Summary Stats Row (4 cards):**
- Total Trades
- Win Rate %
- Total PnL (green/red conditional)
- Avg R:R

**Filter Bar:**
- Market dropdown (All/Forex/Crypto) — uses `__all__` sentinel for "no filter"
- Outcome dropdown (All/Win/Loss/Breakeven/Open)
- Direction dropdown (All/Long/Short)
- Pair search input
- Date From / Date To
- "Clear filters" button (appears when any filter is active)

**Trade List:**
- Each row is a clickable `<Link>` to `/journal/[id]`
- Shows: Pair (mono), Direction badge (green/red), Outcome badge (color-coded), Entry Time, PnL (mono, conditional color), R:R ratio, AI Score badge or "Not reviewed"
- Empty state with "Log your first trade" CTA

**Data fetching:** calls `getTrades()` server action with filter params on every filter change via `useEffect`.

### 2.4 — Trade Detail Page

`app/journal/[id]/page.tsx` — server component that fetches trade via `getTrade()`

`app/journal/[id]/TradeDetailClient.tsx` — client component with interactivity:

**Layout:** Two-column (2/3 + 1/3)
- **Left column:** Prices & Levels card, Outcome card, Notes card, Tags badges, Screenshots gallery (click-to-expand overlay)
- **Right column:** AI Review card (disabled "Get AI Review" button with "Coming in next update" tooltip), Details card (Market, Session, Created, Updated)

**Actions:**
- Edit button → navigates to `/journal/[id]/edit`
- Delete button → opens confirmation Dialog (Base UI `render` prop pattern, not `asChild`), calls `deleteTrade()` with `useTransition`

**Screenshot gallery:** 3-column grid of thumbnails, click opens full-size overlay with dark backdrop, click-backdrop-to-close, X button in top-right corner.

### 2.5 — Edit Trade Page

`app/journal/[id]/edit/page.tsx` — server component that fetches trade via `getTrade()`

`app/journal/[id]/edit/EditTradeClient.tsx` — client component wrapping `<TradeForm mode="edit" trade={trade} />`

### 2.6 — Server Actions

`lib/actions/trades.ts` — all `"use server"` functions:

| Action | Purpose |
|---|---|
| `createTrade(formData)` | Validate with `tradeSubmitSchema`, insert into `trades`, revalidate `/journal` + `/dashboard` |
| `updateTrade(id, formData)` | Validate, update by id + user_id (RLS-safe), revalidate |
| `deleteTrade(id)` | Fetch trade to get screenshot URLs, delete from storage, delete row, revalidate |
| `uploadScreenshot(formData)` | Validate file (image only, ≤5MB), upload to `trade-screenshots` bucket at `{user_id}/{timestamp}-{random}.{ext}`, return public URL |
| `getTrades(filters?)` | Select `*, trade_reviews(composite_score)`, apply dynamic filters, order by `entry_time DESC` |
| `getTrade(id)` | Select `*, trade_reviews(*)` by id + user_id |

All actions follow the CLAUDE.md error handling pattern: `console.error('[action-name]', error)` + return `{ success: false, error: '…' }`.

### 2.7 — Journal Layout

`app/journal/layout.tsx` — mirrors dashboard layout structure:
- Verifies auth (defense-in-depth behind middleware)
- Fetches profile for username
- Renders `<Sidebar />` + `<Navbar />` + scrollable `<main>`

---

## Build Artifacts

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /auth/callback
├ ○ /auth/login
├ ○ /auth/signup
├ ƒ /dashboard
├ ƒ /journal
├ ƒ /journal/[id]
├ ƒ /journal/[id]/edit
└ ƒ /journal/new

ƒ  Dynamic (server-rendered on demand)
○  Static (prerendered)
```

Build compiles cleanly with zero TypeScript errors.

---

## Issues & Resolutions

| Issue | Resolution |
|---|---|
| Base UI `DialogTrigger` doesn't support `asChild` | Used `render={<Button ... />}` prop pattern instead of wrapping children |
| Base UI `Select.onValueChange` passes `string \| null`, not just `string` | Wrapped handlers with `(v) => v ?? ''` or null checks |
| Zod v4 `.transform()` creates input/output type mismatch with react-hook-form `Resolver` | Removed transforms from schema; converted tags in submit handler instead |
| `z.preprocess()` still produces `unknown` input types that clash with RHF | Removed generic from `useForm<TradeFormData>` → `useForm({...})`, manually typed the submit handler payload |
| Server actions need `tags` as `string[]`, form produces `string` | Created `tradeSubmitSchema` extending `tradeSchema` with `tags: z.array(z.string()).optional()` and `entry_price: z.coerce.number().positive()`; client parses comma-separated string to array before sending |
| `__none` sentinel for "no selection" in optional enum Selects | `__none` maps to `undefined` in `onValueChange`, so Zod schema's `optional()` handles it cleanly |

---

## New Files Created

| File | Type | Lines |
|---|---|---|
| `lib/types/trade.ts` | Types + Zod schemas | ~100 |
| `lib/actions/trades.ts` | Server actions | ~267 |
| `app/journal/layout.tsx` | Layout | ~32 |
| `app/journal/page.tsx` | Journal list (client) | ~260 |
| `app/journal/new/page.tsx` | New trade page | ~16 |
| `components/journal/TradeForm.tsx` | Trade form (client) | ~535 |
| `app/journal/[id]/page.tsx` | Trade detail (server) | ~16 |
| `app/journal/[id]/TradeDetailClient.tsx` | Trade detail (client) | ~290 |
| `app/journal/[id]/edit/page.tsx` | Edit trade (server) | ~16 |
| `app/journal/[id]/edit/EditTradeClient.tsx` | Edit trade (client) | ~26 |

## shadcn Components Added

`select`, `textarea`, `badge`, `dialog`, `popover`

---

## Remaining Work (Future Instances)

1. **Instance 3** — Wire AI Review: NIM client, prompt templates in `lib/prompts/`, `/api/review` route, parallel 5-personality calls, store in `trade_reviews`, render reviews on detail page
2. **Instance 4** — AI Backtest: Strategy doc upload, OHLCV fetching, chunked simulation, results page
3. **Instance 5** — Dashboard analytics: Stats cards, recharts performance charts, streaks, calendar heat map
4. **Instance 6** — Settings page: Profile edit, avatar upload
5. **Real Supabase project** — Run migration SQL, create storage buckets, configure auth providers

---

## Key Decisions

1. **Two Zod schemas (form vs. submit)** — react-hook-form's Resolver type can't reconcile Zod transforms that change the type (e.g., `string → string[]`). The form validates against the "input" shape, the server validates against the "output" shape. This avoids type casting hell.

2. **No generic on `useForm()`** — Without `<TradeFormData>`, react-hook-form infers field types from `defaultValues` + the resolver, avoiding the strict `Resolver<A> ≠ Resolver<B>` mismatch that Zod v4 preprocess creates.

3. **`__all__` and `__none` sentinels in Selects** — Base UI Select doesn't have a "clear" action; using sentinel values that map to empty/undefined in the handler is the cleanest workaround.

4. **Screenshot URLs managed in local state, not in form** —screenshots are uploaded immediately on selection but only persisted to the trade row on form submit. This avoids race conditions and lets users remove screenshots before saving.

5. **Delete fetches screenshots before removing** — The `deleteTrade` action queries the trade row first to extract storage paths, then removes files from the `trade-screenshots` bucket before deleting the database row. This prevents orphaned storage objects.
