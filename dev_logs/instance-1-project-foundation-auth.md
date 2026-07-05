# Session Log — Instance 1: Project Foundation & Auth

**Date:** 2026-06-17
**Duration:** ~2 hours (with network interruptions)
**Status:** ✅ Complete

---

## Objective

Scaffold the full Next.js project, configure Supabase auth, and create the authenticated shell. After this instance, a user can sign up, log in, and land on a protected dashboard page.

---

## Tasks Completed

### 1.1 — Project Init

- Scaffolded Next.js 16.2.9 with TypeScript, Tailwind CSS v4, App Router, no `src/` dir
- Initialized shadcn/ui (`base-nova` style, neutral base color)
- Installed dependencies: `@supabase/ssr`, `@supabase/supabase-js`, `openai`, `zod`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `lucide-react`, `clsx`, `tailwind-merge`, `sonner`
- Added shadcn components: `card`, `input`, `label`, `button`, `avatar`, `dropdown-menu`, `separator`, `sheet`, `tooltip`
- Had to work around `create-next-app` refusing to scaffold into a non-empty directory — created in a sibling `tradeai/` dir then moved files in
- `node_modules` were corrupted by the move — deleted and ran clean `npm install`

### 1.2 — Supabase Config Files

| File | Purpose |
|---|---|
| `lib/supabase/client.ts` | `createBrowserClient()` for Client Components |
| `lib/supabase/server.ts` | `createServerClient()` with cookie handling for Server Components / Server Actions |
| `middleware.ts` | Refreshes session on every request; redirects unauthenticated users away from `/dashboard`, `/journal`, `/backtest`; redirects authenticated users away from auth pages |

Middleware matcher covers: `/dashboard/:path*`, `/journal/:path*`, `/backtest/:path*`, `/auth/login`, `/auth/signup`

### 1.3 — Database Schema

Created `supabase/migrations/001_initial_schema.sql` with:

| Table | RLS | Notes |
|---|---|---|
| `profiles` | ✅ | Extends `auth.users`, unique username |
| `trades` | ✅ | Forex/crypto, long/short, win/loss/breakeven/open, sessions, tags, screenshots |
| `trade_reviews` | ✅ | 5 JSONB personality columns + composite score |
| `backtest_runs` | ✅ | Strategy doc URL, market/pair/timeframe, status enum, result JSONB, AI report |
| `ohlcv_cache` | ✅ | Dedup for historical data, 24h freshness pattern |

Added `handle_updated_at()` trigger function on `trades.updated_at`.

### 1.4 — Storage Buckets

Documented for manual creation in Supabase dashboard:
- `trade-screenshots` — public read, authenticated write
- `strategy-docs` — private, authenticated read/write only

### 1.5 — Auth Pages

| Route | Type | Description |
|---|---|---|
| `/auth/login` | Client Component | Email + password form, link to signup, server action `login` |
| `/auth/signup` | Client Component | Email + password + username form, creates profile row on signup, server action `signup` |
| `/auth/callback` | Route Handler (GET) | Supabase OAuth code exchange, redirects to `/dashboard` on success |

Auth server actions live in `lib/actions/auth.ts` — `login`, `signup`, `signOut`. All use `useActionState` pattern with typed `AuthResponse` return.

### 1.6 — Authenticated Shell

| File | Description |
|---|---|
| `app/dashboard/layout.tsx` | Server Component — fetches session + profile, renders Sidebar + Navbar + children |
| `components/layout/Sidebar.tsx` | Client Component — nav links: Dashboard, Journal, Backtest, Settings; highlights active route via `usePathname` |
| `components/layout/Navbar.tsx` | Client Component — user avatar, username/email display, sign out form |
| `app/dashboard/page.tsx` | Server Component — "Welcome back, {username}" with 3 quick-action cards |

### 1.7 — Design System

- Updated `app/globals.css` with TradeAI dark trading-terminal palette:
  - Background: `#0A0B0E`, Cards: `#12141A`
  - Primary/accent: `#00FF9C` (electric green)
  - Destructive: `#FF4D4D`
  - All shadcn CSS variables mapped to dark theme under `.dark` selector
  - Custom tokens: `--color-gain`, `--color-loss`
- Root layout applies `dark` class to `<html>`, includes `Toaster` from sonner
- Landing page (`/`) redesigned with TradeAI branding — sign in / sign up CTAs

---

## Build Artifacts

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /auth/callback
├ ○ /auth/login
├ ○ /auth/signup
└ ƒ /dashboard

○  Static (prerendered)
ƒ  Dynamic (server-rendered on demand)
```

Build compiles cleanly with zero TypeScript errors.

---

## Issues & Resolutions

| Issue | Resolution |
|---|---|
| `create-next-app` refused non-empty dir | Scaffolded to sibling `tradeai/`, then moved files into workspace |
| `node_modules` corrupted after move | Deleted and ran clean `npm install` |
| `Sidebar.tsx` used `usePathname` in Server Component | Added `"use client"` directive |
| `Navbar.tsx` uses `form action` — needs client interactivity | Added `"use client"` directive |
| Next.js 16 deprecation: `middleware.ts` → `proxy` | Noted for future migration; works fine currently |

---

## Remaining Work (Future Instances)

1. Fill `.env.local` with real Supabase credentials
2. Run `001_initial_schema.sql` migration against Supabase
3. Create storage buckets in Supabase dashboard
4. Trade Journal pages (CRUD, AI review trigger)
5. AI Backtest pages (strategy upload, simulation runner)
6. NVIDIA NIM integration (`lib/nim/client.ts`, prompt templates, review/backtest API routes)
7. Dashboard analytics (stats cards, charts with recharts)
8. Settings page (profile edit, avatar upload)

---

## Key Decisions

1. **`useActionState` pattern** for auth forms instead of `react-hook-form` — simpler for 2-field forms, server-side validation is sufficient
2. **Defense-in-depth auth check** — middleware protects routes, but dashboard layout also checks session before rendering
3. **Direct CSS values in components** (e.g., `bg-[#0A0B0E]`) instead of utility aliases — keeps it explicit and avoids Tailwind config complexity. CSS variables handle the design system tokens.
4. **`signOut` as a server action** with `redirect` — clean, no client-side auth state management needed
