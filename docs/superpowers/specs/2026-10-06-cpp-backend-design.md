# C++ Backend — Design Spec

Date: 2026-10-06
Status: Draft — awaiting review

## 1. Goal and context

Rewrite TradeAI's backend (currently Next.js API routes + Server Actions in TypeScript) as a standalone C++ service. The motivation is **learning / portfolio**: a real, production-deployed C++ service, accepting extra ops complexity.

The Next.js frontend stays on Vercel. Auth UI (login, signup, `/auth/callback`) stays in Next — Supabase owns auth; the C++ service only verifies JWTs.

### Decisions made

| Decision | Choice |
|---|---|
| Rollout | **Incremental** — C++ service runs alongside Next; each sub-project migrates endpoints and deletes the TS equivalent in the same change |
| DB access | **Direct Postgres via libpqxx, RLS preserved** — per-request transaction sets `authenticated` role + JWT claims |
| Hosting | **Fly.io / Railway** from a Dockerfile; Next proxies via rewrite `/cpp-api/*` (same-origin, no CORS) |
| Framework | **Crow (synchronous, thread pool)** + libpqxx + cpr + nlohmann/json + jwt-cpp |
| Auth transport | `Authorization: Bearer <supabase access_token>` sent by a frontend `apiFetch` helper; C++ verifies via JWKS (ES256/RS256), HS256 fallback |
| Toolchain | C++23 (for `std::expected`; GCC 13+ / Clang 17+), CMake presets, vcpkg manifest, GoogleTest/ctest |

### Sub-project roadmap

Each sub-project gets its own spec → plan → implementation cycle. **This spec details sub-project 1 only**; sections 2 and 3 define conventions all later sub-projects follow.

1. **Skeleton** — server, config, JWT auth, Postgres pool with RLS, health/me routes, Docker, Fly, frontend `apiFetch` + rewrite.
2. **Compute core** — port `lib/replay/{simulation,execution,indicators,stats,drawing-geometry}.ts` and their vitest tests to C++.
3. **Data layer** — Twelve Data client (rate limiting, pagination, 429 backoff), candle cache (`lib/data/*`), `api/replay/[id]/candles`.
4. **DB CRUD** — `lib/actions/{trades,dashboard,replay}.ts` → C++ REST endpoints.
5. **AI routes** — NIM client + JSON parsing (`lib/nim/*`), `api/review`, `api/insights`, `api/replay/[id]/{chat,review,suggestions}`. Prompt strings move to `backend/src/prompts/`.

`lib/actions/auth.ts` stays in Next.

## 2. Architecture

### Repo layout

```
Trade-AI/
├── app/, lib/, components/        # Next.js — shrinks as endpoints move
├── lib/api/{core,client,server}.ts # apiFetch / apiFetchServer — attach Bearer token, return ApiResult<T>
└── backend/
    ├── CMakeLists.txt, CMakePresets.json, vcpkg.json
    ├── Dockerfile, fly.toml, docker-compose.yml, .env.example
    ├── src/
    │   ├── main.cpp               # config → JwtVerifier → PgPool → routes → app.run()
    │   ├── config/                # Config::fromEnv()
    │   ├── http/                  # Crow app type, middleware, response helpers
    │   ├── auth/                  # JwtVerifier, AuthUser
    │   ├── db/                    # PgPool, withUserTx / withServiceTx
    │   └── routes/                # one file per feature area
    └── tests/
        ├── unit/
        └── integration/           # opt-in via TEST_DATABASE_URL
```

### Request lifecycle

1. Browser or Next server code calls `apiFetch('/me')` → request to `/cpp-api/me`.
2. Next rewrite proxies to `${CPP_API_URL}/me` (`http://localhost:8080` in dev, Fly URL in prod).
3. Request-ID/logging middleware runs, then `AuthMiddleware` verifies the Bearer JWT and stores `AuthUser` in the request context. Missing/invalid → `401`.
4. Handler validates input, then calls `db.withUserTx(user, fn)`, which runs inside one transaction:
   ```sql
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims', $1, true);  -- verified claims JSON
   ```
   so existing RLS policies using `auth.uid()` apply unchanged.
5. Handler returns the existing envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": "..." }`.

### Conventions for all sub-projects

- **Validation**: hand-written `parseXRequest(const nlohmann::json&) -> std::expected<X, std::string>` per endpoint (the Zod equivalent). Invalid → `400` with the message.
- **Errors**: log `[route-name] <detail>` server-side; clients get only generic messages (`"Something went wrong. Please try again."`), matching CLAUDE.md.
- **Service role**: `withServiceTx` is used only where the TS code uses `createServiceClient` today (`api/review`, `lib/data/candle-cache.ts`), and each use carries a comment explaining why RLS is bypassed.
- **Migration discipline**: when an endpoint moves, delete its TS route/action in the same change and switch call sites to `apiFetch`.
- **Cache revalidation**: C++ cannot call `revalidatePath`. Each sub-project chooses per endpoint between client `router.refresh()` and a minimal Next revalidation route; the choice is recorded in that sub-project's spec.
- **Secrets**: only from env; never logged.

## 3. Sub-project 1 — Skeleton

### 3.1 Config (`src/config/`)

`Config::fromEnv()` reads:

| Var | Required | Default | Use |
|---|---|---|---|
| `PORT` | no | `8080` | listen port |
| `DATABASE_URL` | yes | — | Supabase Postgres (pooler) connection string |
| `SUPABASE_URL` | yes | — | JWKS URL `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; expected `iss` = `${SUPABASE_URL}/auth/v1` |
| `SUPABASE_JWT_SECRET` | no | — | enables HS256 verification (legacy projects) |
| `ALLOWED_AUDIENCE` | no | `authenticated` | expected `aud` |
| `DB_POOL_SIZE` | no | `8` | connection pool size |
| `HTTP_THREADS` | no | `32` | Crow worker threads |

Missing required var → log the var name, exit code 1. Returns `std::expected<Config, std::string>`; `main` handles the exit.

### 3.2 JwtVerifier (`src/auth/`)

- `verify(std::string_view token) -> std::expected<AuthUser, AuthError>`.
- `AuthUser { std::string id; std::string role; nlohmann::json claims; }` — `id` from `sub`.
- Asymmetric (ES256/RS256): key looked up by `kid` in a JWKS cache. Cache TTL 10 min; an unknown `kid` triggers at most one refetch per 30s (prevents refetch storms from forged tokens).
- HS256: accepted only if `SUPABASE_JWT_SECRET` is set.
- Checks: signature, `exp` (30s leeway), `iss`, `aud`, `sub` present. `alg: none` and algorithm/key-type mismatches are rejected.
- Thread-safe: `std::shared_mutex` around the key cache.
- JWKS fetch is behind an injectable `JwksFetcher` interface so unit tests supply keys without network.

### 3.3 PgPool (`src/db/`)

- Fixed pool of `DB_POOL_SIZE` `pqxx::connection`s, opened lazily; mutex + condition variable.
- Acquire timeout 5s → throws `PoolTimeout` → handler maps to `503`.
- A connection that throws `pqxx::broken_connection` is discarded and replaced on next acquire.
- `withUserTx(const AuthUser&, F&& fn)` — opens `pqxx::work`, applies the RLS preamble from §2, calls `fn(tx)`, commits; exceptions roll back.
- `withServiceTx(F&& fn)` — plain transaction with the connection's own role, no claims.
- Supabase connection: any mode works (direct, session pooler 5432, or transaction pooler 6543) because all per-request state is set inside a single transaction. To stay compatible with the transaction pooler, the service never uses server-side prepared statements — only parameterized `tx.exec(sql, pqxx::params{...})`.

### 3.4 HTTP layer (`src/http/`)

- Crow app: `crow::App<RequestIdMiddleware, AuthMiddleware>`.
- `RequestIdMiddleware`: reuse `X-Request-Id` header or generate one; echo it in the response; log `method path status duration_ms request_id` per request.
- `AuthMiddleware`: skip for `/healthz`, `/readyz`; otherwise require `Authorization: Bearer …`, verify, store `AuthUser` in context; failure → `401 {"success":false,"error":"Not authenticated"}`.
- Helpers: `ok(json, status=200)`, `fail(status, msg)`.
- `guarded("[route-name]", handler)` wrapper: catches `PoolTimeout` → 503, any other `std::exception` → log + 500 generic message.

### 3.5 Routes (`src/routes/`)

| Route | Auth | Behavior |
|---|---|---|
| `GET /healthz` | no | `200 {"success":true,"data":{"status":"ok"}}` |
| `GET /readyz` | no | `SELECT 1` via `withServiceTx`; 200 or 503 |
| `GET /me` | yes | `select auth.uid()::text` inside `withUserTx`; returns `{"id": "<uuid>"}` — proves JWT → RLS chain |

### 3.6 Frontend changes

- `lib/api/core.ts` (shared), `lib/api/client.ts` (`apiFetch`, browser) and `lib/api/server.ts` (`apiFetchServer`, server). Split so Client Components never import `next/headers`:
  - `export type ApiResult<T> = { success: true; data: T } | { success: false; error: string }`
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>>`
  - Token source: browser → `lib/supabase/client.ts` `getSession()`; server → `lib/supabase/server.ts` `getSession()`. (Session token only forwarded; the C++ service does the authoritative verification.)
  - Browser requests go to `/cpp-api${path}` (rewrite). Server-side requests go directly to `${CPP_API_URL}${path}`.
  - Network failure / non-JSON → `{ success: false, error: 'Something went wrong. Please try again.' }`.
- `next.config.ts`: add `rewrites()` mapping `/cpp-api/:path*` → `${process.env.CPP_API_URL}/:path*`.
- `middleware.ts`: no change (`/cpp-api` is not in its matcher; the C++ service enforces auth).
- New env var `CPP_API_URL` (Next, server-only).
- No existing feature is migrated in sub-project 1.

### 3.7 Build, run, deploy

- `vcpkg.json` dependencies: `crow`, `libpqxx`, `cpr`, `nlohmann-json`, `jwt-cpp`, `openssl`, `gtest`.
- `CMakePresets.json`: `debug` (with ASan/UBSan) and `release`; targets `tradeai_core` (library), `tradeai_api` (executable), `tradeai_tests`.
- `Dockerfile`: multi-stage — builder (Debian + toolchain + vcpkg, `release` preset) → runtime (`debian:bookworm-slim`, binary + CA certs, non-root user).
- `docker-compose.yml`: `postgres:16` for integration tests and local runs.
- `fly.toml`: internal port 8080, HTTP health check on `/healthz`, secrets via `fly secrets set`.
- `package.json` script `dev:api`: configure + build debug preset and run the binary with `backend/.env`.

### 3.8 Testing

- **Unit (always run)**:
  - `JwtVerifier`: valid ES256; valid HS256 with secret; HS256 rejected without secret; expired; wrong `iss`; wrong `aud`; missing `sub`; bad signature; unknown `kid` refetch then reject; `alg: none` rejected. Keys generated in-test; fake `JwksFetcher`.
  - `Config`: defaults applied; missing required var → error naming it.
  - Response helpers: envelope shape.
- **Integration (when `TEST_DATABASE_URL` set)** against compose Postgres seeded with a test fixture: `authenticated` role, `auth` schema with an `auth.uid()` shim reading `request.jwt.claims`, and one RLS-protected table.
  - `withUserTx` as user A sees only A's rows; user B sees none of A's.
  - `/me` handler returns the `sub` UUID.
  - Pool exhaustion → `PoolTimeout` after timeout.
- Run with `ctest --preset debug`.

### 3.9 Success criteria

1. `ctest` passes (unit always; integration with compose Postgres).
2. Docker image builds and `/healthz` responds in the container.
3. Deployed on Fly with secrets set; `GET https://<vercel-domain>/cpp-api/me` with a real user's access token (from Supabase's password grant) returns that user's UUID.
4. `npm run build` and `npm test` still pass for the Next app.

## 4. Out of scope (for sub-project 1)

- Migrating any existing endpoint or Server Action.
- Rate limiting of inbound requests, metrics/tracing beyond request logs.
- Removing the stale `/api/cron/daily-reset` cron from `vercel.ts` (noted; handled in sub-project 3).
- Updating `CLAUDE.md` (its `lib/backtest/` section is already stale; update once sub-project 2 lands).
