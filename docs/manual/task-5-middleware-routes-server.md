# Task 5 — Middleware, system routes, and the server binary (type-it-yourself guide)

**Goal:** turn the pieces from Tasks 2–4 into a real HTTP server. Every request gets a request ID and one log line; every route except `/healthz` and `/readyz` requires a valid Supabase Bearer token; and three routes exist:

| Route          | Auth? | What it proves                                                                 |
| -------------- | ----- | ------------------------------------------------------------------------------ |
| `GET /healthz` | no    | the process is alive (Fly's health check hits this)                            |
| `GET /readyz`  | no    | the process can reach Postgres (503 if not)                                    |
| `GET /me`      | yes   | the whole chain works: token → `AuthUser` → Postgres `auth.uid()` → your user id |

All paths below are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/backend/`. The files already exist (empty, except `main.cpp`) — open each one and type the code in.

| #   | File                                         | What it is                                                     |
| --- | -------------------------------------------- | -------------------------------------------------------------- |
| 1   | `tests/unit/server_test.cpp`                 | Starts a real server and calls it over HTTP                    |
| 2   | `tests/integration/me_integration_test.cpp`  | `/me` and `/readyz` against a real Postgres                    |
| 3   | `src/http/middleware.h`                      | `RequestIdMiddleware`, `AuthMiddleware`, `App`, `currentUser()` |
| 4   | `src/http/middleware.cpp`                    | Their implementation                                           |
| 5   | `src/routes/system.h`                        | `healthz()`, `readyz()`, `me()`, `registerSystemRoutes()`      |
| 6   | `src/routes/system.cpp`                      | Route handlers + URL registration                              |
| 7   | `src/app_setup.h`                            | `setupApp()` declaration                                       |
| 8   | `src/app_setup.cpp`                          | Wires middleware + routes (shared by `main` and tests)         |
| 9   | `src/main.cpp`                               | **Replace** the Task 1 version: real server startup            |

Order: tests (1–2), see the build fail, then the code (3–9), see it pass.

**Crow middleware in one paragraph.** A Crow app is declared with a list of middleware types: `crow::App<RequestIdMiddleware, AuthMiddleware>`. For every request Crow calls each middleware's `before_handle` in order, then the route handler, then each `after_handle` in reverse order. Each middleware has its own little `context` struct per request, where it can stash data (the request ID, the logged-in user). If a `before_handle` calls `res.end()`, the request stops there — that's how auth rejects with a 401 before your handler runs.

---

## File 1 — `tests/unit/server_test.cpp`

This is a unit test even though it starts a real server: the database is **deliberately unreachable** (port 1), so it needs no outside services. That's useful — it proves the server fails *gracefully* when the DB is down.

```cpp
#include <gtest/gtest.h>

#include <cpr/cpr.h>

#include <future>
#include <nlohmann/json.hpp>

#include "app_setup.h"
#include "auth/jwt_verifier.h"
#include "db/pg_pool.h"
#include "http/middleware.h"
#include "support/fake_jwks.h"
#include "support/test_tokens.h"

using namespace std::chrono_literals;
using namespace tradeai;

namespace {

class ServerTest : public ::testing::Test {
 protected:
  static constexpr std::uint16_t kPort = 18089;

  void SetUp() override {
    setupApp(app, verifier, pool);
    app.loglevel(crow::LogLevel::Warning);
    server = app.port(kPort).concurrency(2).run_async();
    app.wait_for_server_start();
  }

  void TearDown() override {
    app.stop();
    server.wait();
  }

  static std::string url(const std::string& path) {
    return "http://127.0.0.1:" + std::to_string(kPort) + path;
  }

  auth::JwtVerifier verifier{{.issuer = testing::kIssuer, .hs256Secret = "test-secret"},
                             std::make_shared<testing::FakeJwksFetcher>(R"({"keys":[]})")};
  db::PgPool pool{"host=127.0.0.1 port=1 connect_timeout=1", 1, 200ms};
  http::App app;
  std::future<void> server;
};

}  // namespace

TEST_F(ServerTest, HealthzNeedsNoAuth) {
  auto res = cpr::Get(cpr::Url{url("/healthz")});
  EXPECT_EQ(res.status_code, 200);
  EXPECT_EQ(nlohmann::json::parse(res.text).at("data").at("status"), "ok");
  EXPECT_FALSE(res.header["X-Request-Id"].empty());
}

TEST_F(ServerTest, EchoesValidRequestId) {
  auto res = cpr::Get(cpr::Url{url("/healthz")}, cpr::Header{{"X-Request-Id", "abc-123"}});
  EXPECT_EQ(res.header["X-Request-Id"], "abc-123");
}

TEST_F(ServerTest, ReplacesUnsafeRequestId) {
  auto res = cpr::Get(cpr::Url{url("/healthz")}, cpr::Header{{"X-Request-Id", "bad id;<>"}});
  EXPECT_NE(res.header["X-Request-Id"], "bad id;<>");
  EXPECT_FALSE(res.header["X-Request-Id"].empty());
}

TEST_F(ServerTest, MeWithoutTokenIs401) {
  auto res = cpr::Get(cpr::Url{url("/me")});
  EXPECT_EQ(res.status_code, 401);
  EXPECT_EQ(nlohmann::json::parse(res.text),
            (nlohmann::json{{"success", false}, {"error", "Not authenticated"}}));
}

TEST_F(ServerTest, MeWithInvalidTokenIs401) {
  auto res = cpr::Get(cpr::Url{url("/me")}, cpr::Bearer{"not.a.jwt"});
  EXPECT_EQ(res.status_code, 401);
}

TEST_F(ServerTest, MeWithValidTokenButDatabaseDownIsGeneric500) {
  auto res = cpr::Get(cpr::Url{url("/me")}, cpr::Bearer{testing::signHs256("test-secret")});
  EXPECT_EQ(res.status_code, 500);
  EXPECT_EQ(nlohmann::json::parse(res.text).at("error"), "Something went wrong. Please try again.");
}

TEST_F(ServerTest, ReadyzWhenDatabaseDownIs503) {
  auto res = cpr::Get(cpr::Url{url("/readyz")});
  EXPECT_EQ(res.status_code, 503);
}
```

**How to read it**

- **Member order matters.** C++ constructs members top to bottom and destroys them bottom to top. `verifier` and `pool` are declared *before* `app`, so they outlive it — the running server holds pointers/references to them.
- `run_async()` — starts the server on background threads and returns a `std::future`. `wait_for_server_start()` blocks until it's actually listening, so the first request can't race the startup. `TearDown()` stops it and waits for it to finish.
- `app.loglevel(crow::LogLevel::Warning)` — hides the per-request INFO lines so test output stays readable.
- The verifier uses HS256 with `"test-secret"` — the simplest way to mint a valid token in a test (`signHs256` from Task 3). The fake JWKS is empty on purpose.
- `cpr::Bearer{...}` — cpr sets `Authorization: Bearer ...` for you.
- `MeWithValidTokenButDatabaseDownIsGeneric500` — auth passes, then Postgres fails. The client must get the generic message, never the libpq error text (which can contain host names).
- Port `18089` is fixed. If a test fails with "address already in use", something else on your Mac is using that port.

---

## File 2 — `tests/integration/me_integration_test.cpp`

The same handlers, called directly (no HTTP) against a real database. Skipped without `TEST_DATABASE_URL`, like Task 4.

```cpp
#include <gtest/gtest.h>

#include <nlohmann/json.hpp>
#include <pqxx/pqxx>

#include "db/pg_pool.h"
#include "routes/system.h"
#include "support/db_fixture.h"

using namespace tradeai;
using namespace tradeai::testing;

TEST(MeIntegration, ReturnsAuthUidFromDatabase) {
  auto url = testDatabaseUrl();
  if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
  db::PgPool pool(*url, 1);
  pool.withServiceTx([](pqxx::work& tx) { tx.exec(readFixtureSql()); });

  auto res = routes::me(pool, testUser(kUserA));
  EXPECT_EQ(res.code, 200);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("data").at("id"), kUserA);
}

TEST(MeIntegration, ReadyzIsOkWithDatabase) {
  auto url = testDatabaseUrl();
  if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
  db::PgPool pool(*url, 1);
  EXPECT_EQ(routes::readyz(pool).code, 200);
}
```

**How to read it**

- Route handlers are plain functions returning `crow::response`, so tests can call them without any HTTP. That's a deliberate design choice: handler logic is testable on its own; File 6's `registerSystemRoutes` only connects URLs to these functions.
- `routes::me` returns whatever `auth.uid()` says inside Postgres. Getting back `kUserA` proves the token's `sub` really reached RLS.

### ✋ Checkpoint — see it fail

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug
```

Expected: **compile errors** — `app_setup.h`, `http/middleware.h` and `routes/system.h` are empty. Correct. Now write the code.

---

## File 3 — `src/http/middleware.h`

```cpp
#pragma once

#include <crow.h>

#include <chrono>
#include <optional>
#include <string>

#include "auth/auth_user.h"
#include "auth/jwt_verifier.h"

namespace tradeai::http {

// Assigns or propagates X-Request-Id and logs one line per request.
struct RequestIdMiddleware {
  struct context {
    std::string id;
    std::chrono::steady_clock::time_point start;
  };
  void before_handle(crow::request& req, crow::response& res, context& ctx);
  void after_handle(crow::request& req, crow::response& res, context& ctx);
};

// Requires a valid Supabase Bearer token on every route except /healthz and /readyz.
struct AuthMiddleware {
  struct context {
    std::optional<auth::AuthUser> user;
  };
  auth::JwtVerifier* verifier = nullptr;  // set by setupApp()

  void before_handle(crow::request& req, crow::response& res, context& ctx);
  void after_handle(crow::request&, crow::response&, context&) {}
};

using App = crow::App<RequestIdMiddleware, AuthMiddleware>;

// The authenticated user for a request that passed AuthMiddleware.
const auth::AuthUser& currentUser(App& app, const crow::request& req);

}  // namespace tradeai::http
```

**How to read it**

- Crow finds middleware methods **by name**: it requires a nested type called exactly `context` (lowercase) and methods called exactly `before_handle` / `after_handle`. There's no base class to inherit; misspell one and you get a long template error.
- `AuthMiddleware` has an empty `after_handle` because Crow requires both methods to exist. Unnamed parameters (`crow::request&`) avoid "unused parameter" warnings.
- `auth::JwtVerifier* verifier` — a raw pointer, set once at startup. Crow default-constructs middleware, so we can't pass the verifier through a constructor.
- `using App = ...` — every other file says `http::App` instead of repeating the middleware list.

---

## File 4 — `src/http/middleware.cpp`

```cpp
#include "http/middleware.h"

#include <algorithm>
#include <cctype>
#include <random>
#include <sstream>
#include <stdexcept>

#include "auth/bearer.h"
#include "http/response.h"

namespace tradeai::http {
namespace {

std::string newRequestId() {
  thread_local std::mt19937_64 rng{std::random_device{}()};
  std::ostringstream out;
  out << std::hex << rng();
  return out.str();
}

bool isSafeRequestId(const std::string& id) {
  return !id.empty() && id.size() <= 128 && std::ranges::all_of(id, [](unsigned char c) {
    return std::isalnum(c) || c == '-' || c == '_';
  });
}

bool isPublic(const std::string& url) { return url == "/healthz" || url == "/readyz"; }

}  // namespace

void RequestIdMiddleware::before_handle(crow::request& req, crow::response&, context& ctx) {
  ctx.start = std::chrono::steady_clock::now();
  auto incoming = req.get_header_value("X-Request-Id");
  ctx.id = isSafeRequestId(incoming) ? std::move(incoming) : newRequestId();
}

void RequestIdMiddleware::after_handle(crow::request& req, crow::response& res, context& ctx) {
  res.set_header("X-Request-Id", ctx.id);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - ctx.start)
                      .count();
  CROW_LOG_INFO << "[http] " << crow::method_name(req.method) << ' ' << req.url << ' ' << res.code
                << ' ' << ms << "ms " << ctx.id;
}

void AuthMiddleware::before_handle(crow::request& req, crow::response& res, context& ctx) {
  if (isPublic(req.url)) return;

  auth::AuthError error = auth::AuthError::MissingToken;
  if (const auto token = auth::bearerToken(req.get_header_value("Authorization"))) {
    auto user = verifier->verify(*token);
    if (user) {
      ctx.user = std::move(*user);
      return;
    }
    error = user.error();
  }
  CROW_LOG_INFO << "[auth] rejected: " << auth::toString(error);
  res = fail(401, "Not authenticated");
  res.end();
}

const auth::AuthUser& currentUser(App& app, const crow::request& req) {
  auto& ctx = app.get_context<AuthMiddleware>(req);
  if (!ctx.user) throw std::logic_error("currentUser called on an unauthenticated route");
  return *ctx.user;
}

}  // namespace tradeai::http
```

**How to read it**

- **Request IDs.** If the caller (e.g. Next.js) sends an `X-Request-Id`, we reuse it, so one ID can be traced across both services. But only if it's "safe" — letters, digits, `-`, `_`, ≤ 128 chars — because it ends up in our logs and a response header; we don't want someone injecting newlines or junk. Otherwise we make a random hex ID.
- `thread_local std::mt19937_64 rng{std::random_device{}()};` — one random generator **per thread**, seeded once. Crow runs many threads; a shared generator would need a lock.
- `std::ranges::all_of(id, pred)` — like JS `[...id].every(pred)`. `unsigned char c` avoids the same `isalnum` negative-char trap as in Task 2.
- One log line per request: method, path, status, duration, request ID. Never the token, never the body.
- **Auth flow:**
  1. Public route → let it through.
  2. Parse the Bearer token (Task 2). No token → `MissingToken`.
  3. Verify it (Task 3). Valid → store the user in this request's context and continue.
  4. Anything else → log the *reason* for us (`[auth] rejected: invalid token`), but send the client only `401 {"success":false,"error":"Not authenticated"}`. `res.end()` stops the request right here — the route handler never runs.
- `if (const auto token = ...)` — declare-and-test in one: the block runs only if the optional has a value.
- `currentUser()` — how a handler reads the logged-in user. Calling it on a public route is a programming bug, so it throws `std::logic_error` (and `guarded()` would turn that into a generic 500).

---

## File 5 — `src/routes/system.h`

```cpp
#pragma once

#include <crow.h>

#include "auth/auth_user.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

namespace tradeai::routes {

crow::response healthz();
crow::response readyz(db::PgPool& pool);
// Returns auth.uid() as seen by Postgres: proves the JWT → RLS chain end to end.
crow::response me(db::PgPool& pool, const auth::AuthUser& user);

void registerSystemRoutes(http::App& app, db::PgPool& pool);

}  // namespace tradeai::routes
```

**How to read it**

- This is the pattern every future route file (sub-projects 2–5) will follow: plain handler functions that take exactly what they need (pool, user, parsed input) plus one `register…Routes(app, …)` function.

---

## File 6 — `src/routes/system.cpp`

```cpp
#include "routes/system.h"

#include "http/response.h"

namespace tradeai::routes {

crow::response healthz() { return http::ok({{"status", "ok"}}); }

crow::response readyz(db::PgPool& pool) {
  try {
    pool.withServiceTx([](pqxx::work& tx) { tx.exec("SELECT 1"); });
    return http::ok({{"status", "ready"}});
  } catch (const std::exception& e) {
    CROW_LOG_WARNING << "[readyz] " << e.what();
    return http::fail(503, http::kUnavailableError);
  }
}

crow::response me(db::PgPool& pool, const auth::AuthUser& user) {
  return http::guarded("[me]", [&] {
    const auto id = pool.withUserTx(user, [](pqxx::work& tx) {
      return tx.query_value<std::string>("select auth.uid()::text");
    });
    return http::ok({{"id", id}});
  });
}

void registerSystemRoutes(http::App& app, db::PgPool& pool) {
  CROW_ROUTE(app, "/healthz").methods(crow::HTTPMethod::GET)([] { return healthz(); });
  CROW_ROUTE(app, "/readyz").methods(crow::HTTPMethod::GET)([&pool] { return readyz(pool); });
  CROW_ROUTE(app, "/me").methods(crow::HTTPMethod::GET)([&app, &pool](const crow::request& req) {
    return me(pool, http::currentUser(app, req));
  });
}

}  // namespace tradeai::routes
```

**How to read it**

- `healthz` touches nothing — if the process can answer, it's healthy. Fly restarts the machine if this fails, so it must **not** depend on the database (a DB blip shouldn't cause restart loops).
- `readyz` does its own try/catch rather than `guarded()` because *any* failure here means "not ready" → 503, not 500.
- `me` uses `guarded("[me]", ...)` from Task 2 — the standard wrapper every real route will use. DB down → generic 500 (or 503 for `PoolTimeout`), details only in the log.
- `CROW_ROUTE(app, "/path").methods(...)(handler)` — Crow's macro for "register this URL". The handler can take nothing, or `const crow::request&` if it needs the request.
- `[&pool]`, `[&app, &pool]` — lambdas capture by reference. Safe because `app` and `pool` live for the whole program (they're created in `main`).

---

## File 7 — `src/app_setup.h`

```cpp
#pragma once

#include "auth/jwt_verifier.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

namespace tradeai {

// Wires middleware dependencies and registers every route. Shared by main and tests;
// later sub-projects add their register*Routes calls here.
void setupApp(http::App& app, auth::JwtVerifier& verifier, db::PgPool& pool);

}  // namespace tradeai
```

---

## File 8 — `src/app_setup.cpp`

```cpp
#include "app_setup.h"

#include "routes/system.h"

namespace tradeai {

void setupApp(http::App& app, auth::JwtVerifier& verifier, db::PgPool& pool) {
  app.get_middleware<http::AuthMiddleware>().verifier = &verifier;
  routes::registerSystemRoutes(app, pool);
}

}  // namespace tradeai
```

**How to read Files 7–8**

- Why a separate `setupApp` instead of doing this in `main`? Because `server_test.cpp` needs the **exact same** wiring with a fake verifier and a dead DB. Putting it in one function means tests exercise the real route table, not a copy.
- `app.get_middleware<http::AuthMiddleware>()` — gives you the app's single `AuthMiddleware` instance so we can hand it the verifier.
- When sub-project 2 adds replay routes, it adds one line here: `routes::registerReplayRoutes(app, pool);`.

---

## File 9 — `src/main.cpp` (replace the whole file)

The Task 1 version only loaded the config and printed the port. Delete its contents and type this instead:

```cpp
#include <cstdint>
#include <iostream>
#include <memory>

#include "app_setup.h"
#include "auth/jwks.h"
#include "auth/jwt_verifier.h"
#include "config/config.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

int main() {
  using namespace tradeai;

  auto cfg = config::Config::fromEnv();
  if (!cfg) {
    std::cerr << "[config] " << cfg.error() << '\n';
    return 1;
  }

  auth::JwtVerifier verifier(
      {.issuer = cfg->issuer(), .audience = cfg->allowedAudience, .hs256Secret = cfg->supabaseJwtSecret},
      std::make_shared<auth::HttpJwksFetcher>(cfg->jwksUrl()));
  db::PgPool pool(cfg->databaseUrl, cfg->dbPoolSize);

  http::App app;
  setupApp(app, verifier, pool);
  app.port(static_cast<std::uint16_t>(cfg->port))
      .concurrency(static_cast<std::uint16_t>(cfg->httpThreads))
      .run();
  return 0;
}
```

**How to read it**

- `main` is **wiring only**: read config → build the verifier (real HTTP JWKS fetcher) → build the pool → set up the app → run. No logic lives here, so there's nothing in it that needs a test.
- Bad config → print the reason and exit with code 1, before opening any port. Fly shows that line in its logs.
- Designated initializers must follow the struct's field order (`issuer`, `audience`, `hs256Secret`) — skipping fields is fine, reordering is a compile error.
- `static_cast<std::uint16_t>` — Crow wants 16-bit numbers for port and thread count; config stores them as `int` / `size_t`. Config already rejects a `PORT` above 65535.
- `.run()` blocks forever (until the process is killed), handling requests on `httpThreads` threads.

---

## ✅ Build and test

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug && ctest --preset debug
```

Expected: 55 tests pass (48 from before + 7 `ServerTest.*`); the 7 `PgPoolIntegration.*` and 2 `MeIntegration.*` tests are skipped.

Then with the database (start it with `docker compose up -d --wait` if it isn't running):

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres ctest --preset debug
```

Expected: **all 64 tests pass**, nothing skipped.

## ✅ Smoke-test the real binary

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres SUPABASE_URL=https://example.supabase.co ./build/debug/tradeai_api &
curl -s localhost:8080/healthz                                 # {"data":{"status":"ok"},"success":true}
curl -s localhost:8080/readyz                                  # {"data":{"status":"ready"},"success":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/me     # 401
kill %1
```

- The `&` runs the server in the background of your terminal; `kill %1` stops it.
- `SUPABASE_URL` is a dummy here — `/me` would fail anyway without a token, which is what we're checking.

Also confirm a missing env var stops the server cleanly:

```bash
./build/debug/tradeai_api; echo $?
```

Expected: `[config] missing required env var DATABASE_URL` then `1`.

If something fails, paste the error and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="backend/src/http/middleware.h backend/src/http/middleware.cpp backend/src/routes/system.h backend/src/routes/system.cpp backend/src/app_setup.h backend/src/app_setup.cpp backend/src/main.cpp backend/tests/unit/server_test.cpp backend/tests/integration/me_integration_test.cpp"
git add $FILES
git commit -m "feat(backend): auth middleware, /healthz /readyz /me, server binary" -- $FILES
```

(The `-- $FILES` part commits only these 9 files, so your staged deletions and the empty files for later tasks stay out of this commit.)
