# Make TradeAI mobile-responsive (Android/iOS browsers)

## Context

The app is desktop-first — CLAUDE.md explicitly says "Desktop-first (1280px+). Mobile-responsive is nice-to-have." The user now wants it usable on Android/iOS phone browsers. Decision made via AskUserQuestion: **mobile-responsive only** — no PWA, no Capacitor/native wrapper, no app store. Just make the existing site work well in phone browsers.

Two root causes make the current site unusable on phones:

1. **No `viewport` meta tag.** Root [app/layout.tsx](app/layout.tsx) exports `metadata` but no `viewport` (confirmed by grep — no `viewport` anywhere). In Next.js 16 (this is actually 16.2.9 + React 19, despite CLAUDE.md saying 14) viewport must be a separate `export const viewport`. Without it, phones render the 1280px desktop layout and zoom out — text is unreadable, taps miss.
2. **Chrome eats the screen.** [Sidebar.tsx](components/layout/Sidebar.tsx) is a `w-56` always-visible `<aside>`. On a 360px phone it eats ~60% of the width. It's duplicated identically in 3 layouts ([dashboard](app/dashboard/layout.tsx), [journal](app/journal/layout.tsx), [backtest](app/backtest/layout.tsx)).

On top of that, ~12 page/component files use desktop-only fixed-width patterns: `grid-cols-4`/`grid-cols-6` stat grids, fixed-`w-36` filter bars, fixed-column list rows, `grid-cols-5` personality cards, and a `<table>` trade log.

**Goal:** Every page readable and operable at 360px–768px, no horizontal page-scroll, no desktop regression at ≥1024px.

## Approach

Tailwind's default breakpoints: `sm 640 / md 768 / lg 1024`. Since the desktop target is 1280px+, treat **`lg` (1024px) as the desktop breakpoint** — below `lg` is mobile/tablet. This keeps the existing desktop layout byte-for-byte at ≥1024px (zero regression risk) and only adds mobile behavior below it.

### Step 1 — Viewport config (the unlock)

Add to [app/layout.tsx](app/layout.tsx), alongside the existing `metadata` export:

```ts
import type { Viewport } from "next";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",        // notch / safe-area aware
  themeColor: "#0A0B0E",
};
```

Nothing else works without this. `themeColor` matches the `#0A0B0E` background so the browser chrome blends.

### Step 2 — Centralize chrome into `AppShell` with a mobile drawer

Create **`components/layout/AppShell.tsx`** (client component) that renders the existing `<Sidebar />` + `<Navbar />` + `<main>` and owns the mobile-drawer open state. This is the simplest correct way to share drawer state between Navbar (hamburger) and Sidebar (drawer contents) — the drawer trigger and the drawer body need the same `open`/`setOpen`.

- **≥ `lg`:** render `<Sidebar />` inline as today (unchanged `w-56`).
- **< `lg`:** hide the inline `<Sidebar />` (`hidden lg:flex`). Navbar gets a hamburger `<Menu>` button (`lg:hidden`) that opens a `Sheet` (existing [components/ui/sheet.tsx](components/ui/sheet.tsx), `side="left"`) containing the same nav items.
- Refactor [Sidebar.tsx](components/layout/Sidebar.tsx) to extract the nav list + a `<NavLinks onNavigate={close}>` so the same markup renders both inline and inside the Sheet. `onNavigate` closes the drawer on tap (UX: selecting a page auto-closes the menu).
- [Navbar.tsx](components/layout/Navbar.tsx): add the `lg:hidden` Menu button on the left; keep the user/sign-out block as-is (it already hides the name/email below `sm`).
- `<main className="p-6">` → `p-4 sm:p-6` (tighter side padding on phones).

Then replace the duplicated chrome in the 3 layouts with `<AppShell username=… email=…>{children}</AppShell>`. The duplications are byte-identical, so this is a pure substitution — no behavior change at desktop sizes. (The dedup is a side-effect of needing shared drawer state, not the goal.)

### Step 3 — Page-level responsive grids & rows

Breakpoint rule throughout: mobile-first base class, then `sm:`/`lg:` to restore the desktop layout. Representative files (the pattern repeats — apply the same transformation to each):

- **[journal/page.tsx](app/journal/page.tsx)**
  - `grid grid-cols-4` stats → `grid grid-cols-2 sm:grid-cols-4`
  - Filter bar `flex flex-wrap` with fixed `w-36`/`w-44`/`w-32` → wrap to a `grid grid-cols-2 sm:grid-cols-3 lg:flex` so they stack 2-up on phones. Drop `w-36` etc. in favor of `w-full` within the mobile grid.
  - Trade list rows: the `<Link>` row uses `flex items-center gap-4` with `w-24`/`w-16`/`w-20`/`w-36`/`w-24`/`w-16` fixed columns. On mobile this overflows. Wrap the inner columns in `hidden sm:flex` for the secondary ones (entry time, R:R) and keep pair + outcome badge + PnL + AI score visible; stack to a 2-line card on `<sm` if cleaner.
- **[dashboard/StatsCards.tsx](components/dashboard/StatsCards.tsx)** — already responsive (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). ✅ No change.
- **[dashboard/page.tsx](app/dashboard/page.tsx)** — chart rows already use `grid-cols-1 lg:grid-cols-3`. ✅ Header period-toggle (`PERIOD_LABELS`) may need `flex-wrap` so it doesn't overflow on mobile — verify.
- **[dashboard/RecentTrades.tsx](components/dashboard/RecentTrades.tsx) & [RecentBacktests.tsx](components/dashboard/RecentBacktests.tsx)** — list rows are `flex items-center gap-3` with `w-20`/`w-32` fixed spans. Same treatment as journal rows: hide secondary columns `<sm`, keep pair + PnL + score.
- **[backtest/page.tsx](app/backtest/page.tsx)** — upload mode `grid grid-cols-3` → `grid-cols-1 lg:grid-cols-3`. Manual mode `grid-cols-4` parameter rows → `grid-cols-2 sm:grid-cols-4`. Mode-toggle + "Past Runs" header wraps (`flex-wrap`).
- **[backtest/[id]/page.tsx](app/backtest/[id]/page.tsx)** (report)
  - `grid grid-cols-6` stats → `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`
  - `grid grid-cols-2` charts → `grid-cols-1 lg:grid-cols-2`
  - `grid grid-cols-5` personality reviews → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`
  - Header (back link + title + 3 badges + Export) → `flex flex-wrap items-center gap-3`, Export button `ml-auto` stays.
  - Trade log `<table>`: wrap in `overflow-x-auto` (keep the table — horizontal-scroll for tabular data is standard on mobile; a card-per-trade rewrite is scope creep).
- **[backtest/[id]/review/page.tsx](app/backtest/[id]/review/page.tsx)** — `grid grid-cols-3` (rule builder + exec config) → `grid-cols-1 lg:grid-cols-3`. Header Save/Approve buttons → `flex-wrap`.
- **[backtest/history/page.tsx](app/backtest/history/page.tsx)** — same list-row pattern as journal; hide secondary fields `<sm`, keep name + status + PnL.
- **[journal/[id]/TradeDetailClient.tsx](app/journal/[id]/TradeDetailClient.tsx)**
  - Header (back link + pair + direction + outcome badges + Edit/Delete) → `flex flex-wrap items-center gap-3`, push Edit/Delete to their own row `<sm`.
  - `grid grid-cols-2` (prices/outcome cards) → `grid-cols-1 lg:grid-cols-2`. Inner `grid-cols-3` → `grid-cols-2 sm:grid-cols-3`.
  - Screenshots `grid-cols-3` → `grid-cols-2 sm:grid-cols-3`. Expanded overlay `p-8` → `p-4`.
- **[components/journal/TradeForm.tsx](components/journal/TradeForm.tsx)** — section grids `grid-cols-4` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; prices `grid-cols-6` → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`; screenshots `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`.
- **[components/backtest/rule-builder.tsx](components/backtest/rule-builder.tsx)** & child editors
  - Risk-management `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`.
  - [indicator-config.tsx](components/backtest/indicator-config.tsx) and [condition-editor.tsx](components/backtest/condition-editor.tsx): row is `flex items-center gap-2` (no wrap) with fixed `w-36` selects. Add `flex-wrap` so on a phone the type select, params, and remove button drop to a second line. The [expr-editor.tsx](components/backtest/expr-editor.tsx) `LeafShell` already has `flex-wrap` — ✅.

### Step 4 — Touch targets & inputs

shadcn inputs are `h-9`/`h-10` (36–40px) — already at Apple's 44px minimum after padding. No global change needed. Only watch: the `h-7` ghost icon buttons in rule-builder are 28px — acceptable for a dense editor on mobile but flag if a11y review wants 44px. Not in scope for this pass.

### Step 5 — Update CLAUDE.md posture

Replace `Desktop-first (1280px+). Mobile-responsive is nice-to-have.` with a line stating mobile-responsive is now a first-class target (`lg`/1024px is the desktop breakpoint; mobile must not break). Keeps the doc honest with the code.

## Files touched

- New: `components/layout/AppShell.tsx`
- Edit: `app/layout.tsx` (viewport) · `components/layout/Sidebar.tsx` · `components/layout/Navbar.tsx` · `app/dashboard/layout.tsx` · `app/journal/layout.tsx` · `app/backtest/layout.tsx` (AppShell swap)
- Edit (responsive grids/rows): `app/journal/page.tsx` · `app/journal/[id]/TradeDetailClient.tsx` · `components/journal/TradeForm.tsx` · `app/backtest/page.tsx` · `app/backtest/[id]/page.tsx` · `app/backtest/[id]/review/page.tsx` · `app/backtest/history/page.tsx` · `components/backtest/rule-builder.tsx` · `components/backtest/indicator-config.tsx` · `components/backtest/condition-editor.tsx` · `components/dashboard/RecentTrades.tsx` · `components/dashboard/RecentBacktests.tsx` · `app/dashboard/page.tsx` (verify header wrap only)
- Edit: `CLAUDE.md` (one-line posture update)

## Verification

1. `npm run dev` and `npm run build` — build must pass (Next 16 + React 19, strict TS).
2. Open the running app in Chrome DevTools device toolbar at **iPhone SE (375px)** and **iPad (768px)**, plus a 1280px desktop window. Walk every route:
   - `/` (home) — already mobile-fine, sanity-check.
   - `/auth/login`, `/auth/signup` — already `max-w-sm`, sanity-check.
   - `/dashboard` — drawer opens via hamburger, stat cards stack, charts stack, recent-trades rows don't clip.
   - `/journal` — stats 2-up, filters wrap, rows show pair+outcome+PnL+score without overflow.
   - `/journal/new` and `/journal/[id]/edit` — form grids stack, screenshot thumbnails 2-up.
   - `/journal/[id]` — header wraps, price/outcome cards stack, screenshots grid, expanded overlay fits.
   - `/backtest` — upload + manual mode grids stack, mode toggle wraps.
   - `/backtest/[id]/review` — rule builder + exec config stack, condition rows wrap.
   - `/backtest/[id]` — stats wrap, charts stack, personality cards stack, trade log scrolls horizontally inside its card.
   - `/backtest/history` — rows show name + status + PnL.
   - `/dashboard/settings` — already `max-w-2xl`, sanity-check.
3. Confirm: **no horizontal page-scroll** at 375px on any route, **no layout change at ≥1024px** vs. current behavior.
4. Optional: use the chrome-devtools MCP `resize_page` to 375×667 and `take_screenshot` per route for a visual regression baseline.

## Out of scope (per user decision)

PWA manifest / service worker, Capacitor / native wrappers, app store packaging, OAuth deep-link changes, offline support. The responsive foundation this work produces is the prerequisite if any of those are wanted later.
