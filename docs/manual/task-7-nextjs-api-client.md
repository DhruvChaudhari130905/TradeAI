# Task 7 — Next.js client helper and rewrite (type-it-yourself guide)

**Goal:** give the Next.js app one way to call the C++ API, from both sides:

- **Browser** (Client Components): `apiFetch('/me')` → calls `/cpp-api/me` on the *same* origin → Next.js rewrites it to the C++ server. Same origin means no CORS setup.
- **Server** (Server Components, Server Actions, Route Handlers): `apiFetchServer('/me')` → calls `CPP_API_URL/me` directly.

Both attach the user's Supabase access token as `Authorization: Bearer …`, and both **always** return the same envelope as the C++ server — `{ success: true, data }` or `{ success: false, error }` — even if the network fails or the server returns HTML. Calling code never needs a `try/catch`; it does `if (!result.success) toast.error(result.error)` like every Server Action in the app already does.

This task is TypeScript — back on familiar ground. All paths are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/`. The `lib/api/` files already exist (empty).

| #   | File                       | What it is                                                         |
| --- | -------------------------- | ------------------------------------------------------------------ |
| 1   | `lib/api/core.test.ts`     | vitest tests for the shared request logic                          |
| 2   | `lib/api/core.ts`          | `requestApi()` — fetch + token + envelope normalisation            |
| 3   | `lib/api/client.ts`        | `apiFetch()` — browser version (token from the browser session)    |
| 4   | `lib/api/server.ts`        | `apiFetchServer()` — server version (token from cookies)           |
| 5   | `next.config.ts` (edit)    | The `/cpp-api/*` rewrite                                           |
| 6   | `CLAUDE.md` (edit)         | Document `CPP_API_URL`                                             |

**Why three files instead of one?** `lib/supabase/server.ts` imports `next/headers` (cookies), which only works on the server. If one module imported both the browser and server Supabase clients, importing it into a Client Component would break the build. So: shared logic in `core.ts` (imports nothing from Supabase), and one thin wrapper per side.

---

## File 1 — `lib/api/core.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERIC_API_ERROR, requestApi } from './core'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('requestApi', () => {
  it('passes through a success envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: 'u1' } }))
    await expect(requestApi<{ id: string }>('/cpp-api/me', 'tok')).resolves.toEqual({
      success: true,
      data: { id: 'u1' },
    })
  })

  it('passes through an error envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Not authenticated' }, 401))
    await expect(requestApi('/cpp-api/me', null)).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    })
  })

  it('sends the bearer token when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/me', 'tok')
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })

  it('omits Authorization without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/me', null)
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.has('Authorization')).toBe(false)
  })

  it('defaults Content-Type to JSON when sending a body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/x', 'tok', { method: 'POST', body: '{}' })
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('maps a non-JSON response to the generic error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })

  it('maps an unexpected JSON shape to the generic error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ foo: 1 }))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })

  it('maps a network failure to the generic error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })
})
```

**How to read it**

- `vi.stubGlobal('fetch', fetchMock)` — replaces the global `fetch` with a mock for each test, so no real HTTP happens. `afterEach` puts everything back.
- `vi.spyOn(console, 'error').mockImplementation(() => {})` — `requestApi` logs failures; this keeps test output quiet.
- `fetchMock.mock.calls[0][1]` — the second argument (`init`) of the first `fetch` call, so we can inspect the headers that were sent.
- `.resolves.toEqual(...)` — note every test uses `resolves`, never `rejects`: `requestApi` must **never throw**. The last three tests cover the ugly cases — Fly returning an HTML 502 page, a JSON body of the wrong shape, and the network being down.

### ✋ Checkpoint — see it fail

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
npx vitest run lib/api/core.test.ts
```

Expected: **FAIL** — `core.ts` is empty, so `requestApi` and `GENERIC_API_ERROR` aren't exported (vitest reports them as not a function / undefined). Correct. Now write the code.

---

## File 2 — `lib/api/core.ts`

```ts
export type ApiResult<T> = { success: true; data: T } | { success: false; error: string }

export const GENERIC_API_ERROR = 'Something went wrong. Please try again.'

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  if (typeof value !== 'object' || value === null || !('success' in value)) return false
  if (value.success === true) return 'data' in value
  return value.success === false && 'error' in value && typeof value.error === 'string'
}

/** Calls the C++ API and normalizes every failure into the `{ success: false }` envelope. */
export async function requestApi<T>(
  url: string,
  token: string | null,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const res = await fetch(url, { ...init, headers, cache: 'no-store' })
    const body: unknown = await res.json()
    if (!isApiResult<T>(body)) return { success: false, error: GENERIC_API_ERROR }
    return body
  } catch (error) {
    console.error('[requestApi]', error)
    return { success: false, error: GENERIC_API_ERROR }
  }
}
```

**How to read it**

- `ApiResult<T>` — a **discriminated union**: check `result.success` and TypeScript knows whether `data` or `error` exists. It matches the C++ envelope exactly, and the `{ success, data } | { success: false, error }` shape the CLAUDE.md error-handling pattern already uses.
- `isApiResult` — a **type guard** (`value is ApiResult<T>`). We never trust a network response's shape; `in` checks narrow `unknown` safely without `any` (CLAUDE.md: no `any`).
- `new Headers(init.headers)` — accepts whatever form the caller passed (object, array, `Headers`) and normalises it.
- Content-Type defaults to JSON only when there's a body and the caller didn't set one — so a future file upload can still send its own type.
- `cache: 'no-store'` — Next.js extends `fetch` with caching on the server; user-specific API data must never be cached and shared.
- `res.json()` throws on non-JSON (the HTML 502 case) → caught → generic error. We deliberately don't look at `res.status`: the C++ server always puts the status meaning in the envelope.
- `GENERIC_API_ERROR` is the exact same string the C++ server and the rest of the app use, so users see one consistent message.

---

## File 3 — `lib/api/client.ts`

```ts
import { createClient } from '@/lib/supabase/client'
import { requestApi, type ApiResult } from './core'

export type { ApiResult } from './core'

/** Browser-side call to the C++ API through the same-origin `/cpp-api` rewrite. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const { data } = await createClient().auth.getSession()
  return requestApi<T>(`/cpp-api${path}`, data.session?.access_token ?? null, init)
}
```

**How to read it**

- `getSession()` — reads the session the Supabase browser client already keeps (and refreshes). `access_token` is the JWT the C++ server verifies in Task 3.
- `?? null` — no session (logged out) → send no token → the C++ server answers 401 → you get `{ success: false, error: 'Not authenticated' }`.
- `export type { ApiResult }` — re-exported so components import everything from `@/lib/api/client` alone.

---

## File 4 — `lib/api/server.ts`

```ts
import { createClient } from '@/lib/supabase/server'
import { GENERIC_API_ERROR, requestApi, type ApiResult } from './core'

export type { ApiResult } from './core'

/**
 * Server-side (Server Components, Server Actions, Route Handlers) call straight to
 * the C++ API. The token is forwarded unverified; the C++ service verifies it.
 */
export async function apiFetchServer<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const baseUrl = process.env.CPP_API_URL
  if (!baseUrl) {
    console.error('[apiFetchServer] CPP_API_URL is not set')
    return { success: false, error: GENERIC_API_ERROR }
  }
  const supabase = await createClient()
  const { data } = await supabase.auth.getSession()
  return requestApi<T>(`${baseUrl}${path}`, data.session?.access_token ?? null, init)
}
```

**How to read it**

- On the server there's no "same origin" to go through, so it calls `CPP_API_URL` directly (e.g. `https://tradeai-api.fly.dev`). That's one hop less than going via the rewrite.
- `getSession()` on the server reads the session from cookies **without verifying it**. Normally Supabase warns against trusting that — but here we don't trust it: we just forward the token, and the C++ server verifies the signature. That's what the doc comment means.
- Missing env var → log it (for you) and return the generic error (for the user), instead of crashing the page.

---

## File 5 — add the rewrite to `next.config.ts`

Open `/Users/dhruvchaudhari/Codes/Trade-AI/next.config.ts`. Inside `nextConfig`, directly after the `serverExternalPackages: [...]` line, add:

```ts
  // Browser calls to the C++ API go through the same origin (no CORS); see lib/api/client.ts.
  async rewrites() {
    const cppApiUrl = process.env.CPP_API_URL
    return cppApiUrl ? [{ source: '/cpp-api/:path*', destination: `${cppApiUrl}/:path*` }] : []
  },
```

So that section reads:

```ts
  serverExternalPackages: ['pdfjs-dist', 'pdf-parse-fork'],
  // Browser calls to the C++ API go through the same origin (no CORS); see lib/api/client.ts.
  async rewrites() {
    const cppApiUrl = process.env.CPP_API_URL
    return cppApiUrl ? [{ source: '/cpp-api/:path*', destination: `${cppApiUrl}/:path*` }] : []
  },
  async headers() {
```

**How to read it**

- A **rewrite** is a server-side proxy: the browser requests `yoursite.com/cpp-api/me`, Next.js (on Vercel) fetches `CPP_API_URL/me` and returns the answer. The URL in the browser never changes, and the browser never talks to Fly directly.
- `:path*` — matches the rest of the path, including slashes: `/cpp-api/replay/abc` → `${cppApiUrl}/replay/abc`.
- No `CPP_API_URL` → no rewrite → `/cpp-api/*` is a 404, which `requestApi` turns into the generic error. The app keeps building and running without the C++ service.
- The CSP's `connect-src 'self'` already allows it — it's the same origin. No CSP change needed.
- Rewrites are read when Next starts: after changing `CPP_API_URL` in `.env.local`, restart `npm run dev`.

---

## File 6 — document the env var in `CLAUDE.md`

In `CLAUDE.md`, find the `## Env Variables (.env.local)` code block and add `CPP_API_URL=` after `TWELVE_DATA_API_KEY=`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NVIDIA_NIM_API_KEY=
TWELVE_DATA_API_KEY=
CPP_API_URL=
```

Note it is **not** `NEXT_PUBLIC_…` — the browser never needs it (it uses the rewrite), so it stays server-only.

---

## ✅ Run the tests

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
npx vitest run lib/api/core.test.ts
```

Expected: all **8** tests pass.

## ✅ Run the full Next checks

```bash
npm test && npm run lint && npm run build
```

Expected: all three succeed, and no existing test regresses.

## ✅ Verify end to end, locally

1. Add this line to your `.env.local`:
   ```
   CPP_API_URL=http://localhost:8080
   ```
2. Terminal 1: `npm run dev:api` (from Task 6). Terminal 2: `npm run dev`.
3. Get an access token for a test account and call `/me` **through Next.js** (port 3000, not 8080). In a third terminal, from the project root:
   ```bash
   set -a && . ./.env.local && set +a
   read -s "PW?Test account password: "; echo
   TOKEN=$(curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
     -d "{\"email\":\"<test email>\",\"password\":\"$PW\"}" | jq -r .access_token)
   unset PW
   curl -s localhost:3000/cpp-api/me -H "Authorization: Bearer $TOKEN"
   ```
   - `read -s` asks for the password without echoing it, so it doesn't land in your shell history.
   - Needs `jq` (`brew install jq` if missing).

Expected: `{"data":{"id":"<that user's uuid>"},"success":true}` — and the uuid matches the user in Supabase → Authentication → Users. That's the full chain: browser-style request → Next rewrite → C++ → JWT verified → Postgres `auth.uid()`.

Without the header (`curl -s localhost:3000/cpp-api/me`) you should get `{"error":"Not authenticated","success":false}`.

**If you get 401 with a token**, look at the C++ terminal:
- `[auth] rejected: unknown signing key` or `signing keys unavailable` → your project still signs with the legacy HS256 secret. Put it in `SUPABASE_JWT_SECRET` in `backend/.env` (Supabase → Project Settings → JWT Keys), restart `npm run dev:api`, try again.
- `[auth] rejected: invalid token` → usually an expired token (they last 1 hour) — fetch a new one.

Keep `TOKEN` around in that terminal — Task 8 uses it again.

If something fails, paste the error (without the token or password) and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="lib/api next.config.ts CLAUDE.md"
git add $FILES
git commit -m "feat: apiFetch helpers and /cpp-api rewrite for the C++ backend" -- $FILES
```

(`.env.local` is git-ignored, so your `CPP_API_URL` line stays local.)
