# Task 4 — Postgres pool with RLS-scoped transactions (type-it-yourself guide)

**Goal:** the C++ server talks to Supabase Postgres directly, **as the logged-in user**. Each request's SQL runs inside one transaction that first switches to role `authenticated` and sets `request.jwt.claims` — exactly what Supabase does for you behind its REST API. That makes your existing RLS policies (`user_id = auth.uid()`) work unchanged. We also keep a small pool of open connections, so we don't pay a fresh Postgres connect on every request.

All paths below are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/backend/`. The files already exist (empty) — open each one and type the code in.

| #   | File                                           | What it is                                                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------ |
| 1   | `docker-compose.yml`                           | A throwaway local Postgres for the integration tests        |
| 2   | `tests/integration/fixture.sql`                | Fake "mini-Supabase": `authenticated` role, `auth.uid()`, a test table with RLS |
| 3   | `tests/support/db_fixture.h`                   | Test helpers: DB URL from env, load fixture, make a test user |
| 4   | `tests/unit/pg_pool_test.cpp`                  | Tests that need **no** database                              |
| 5   | `tests/integration/pg_pool_integration_test.cpp` | Tests against a real Postgres (skipped if none configured) |
| 6   | `src/db/pg_pool.h`                             | `PgPool` with `withUserTx()` / `withServiceTx()`             |
| 7   | `src/db/pg_pool.cpp`                           | Acquire / release logic                                      |

Order: test infrastructure (1–3), tests (4–5), see the build fail, then the code (6–7), see it pass — first without a database, then with one.

**Two kinds of tests from now on.**
- `tests/unit/` — always run, no outside services.
- `tests/integration/` — need a real Postgres. They read `TEST_DATABASE_URL`; if it's not set they call `GTEST_SKIP()` and are reported as *skipped*, not failed. So `ctest` stays green on a machine without Docker.

---

## File 1 — `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
    ports:
      - "54329:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 3s
      retries: 15
```

**How to read it**

- `ports: "54329:5432"` — your Mac's port 54329 → the container's 5432. An unusual port so it never clashes with any Postgres you already run.
- `healthcheck` — lets `docker compose up --wait` block until Postgres actually accepts connections, instead of returning while it's still booting.
- This is **only** for tests. Never point it at real data.

---

## File 2 — `tests/integration/fixture.sql`

A plain Postgres has no `authenticated` role and no `auth.uid()` — those are Supabase things. This script recreates just the pieces RLS needs, plus a tiny table `rls_probe` with rows owned by two users (A has `a1`, `a2`; B has `b1`).

```sql
do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated;

drop table if exists public.rls_probe;
create table public.rls_probe (
  id serial primary key,
  user_id uuid not null,
  note text not null
);
alter table public.rls_probe enable row level security;
create policy rls_probe_owner on public.rls_probe for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.rls_probe to authenticated;
grant usage on sequence public.rls_probe_id_seq to authenticated;

insert into public.rls_probe (user_id, note) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1');
```

**How to read it**

- `do $$ ... $$` — an anonymous PL/pgSQL block. Postgres has no `create role if not exists`, so we check `pg_roles` first. Makes the script safe to run many times.
- `auth.uid()` — reads the setting `request.jwt.claims` (a JSON string), takes `->> 'sub'`, casts it to `uuid`. `current_setting(..., true)` returns NULL instead of erroring when the setting doesn't exist; the `nullif(…, '')` calls turn empty strings into NULL too. This mirrors Supabase's real definition.
- `using (...)` — which rows you can **see/update/delete**. `with check (...)` — which rows you're allowed to **write**. Both say "only your own".
- `drop table if exists` then `create` — every test run starts from the same 3 rows.

---

## File 3 — `tests/support/db_fixture.h`

```cpp
#pragma once

#include <cstdlib>
#include <fstream>
#include <nlohmann/json.hpp>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>

#include "auth/auth_user.h"

namespace tradeai::testing {

inline const std::string kUserA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
inline const std::string kUserB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

inline std::optional<std::string> testDatabaseUrl() {
  const char* url = std::getenv("TEST_DATABASE_URL");
  if (url == nullptr || *url == '\0') return std::nullopt;
  return std::string(url);
}

inline std::string readFixtureSql() {
  std::ifstream file(std::string(TRADEAI_FIXTURE_DIR) + "/fixture.sql");
  if (!file) throw std::runtime_error("cannot open fixture.sql");
  std::stringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

inline auth::AuthUser testUser(const std::string& sub, nlohmann::json extraClaims = nlohmann::json::object()) {
  extraClaims["sub"] = sub;
  extraClaims["role"] = "authenticated";
  return {sub, "authenticated", std::move(extraClaims)};
}

}  // namespace tradeai::testing
```

**How to read it**

- `inline` functions in a header — allowed to be defined in a header included by many `.cpp` files without "multiple definition" link errors.
- `std::getenv` returns a C string pointer, or `nullptr` if unset. `*url == '\0'` also treats `TEST_DATABASE_URL=` (empty) as unset.
- `TRADEAI_FIXTURE_DIR` — not defined anywhere in C++. It comes from `CMakeLists.txt` (Task 1): `target_compile_definitions(... TRADEAI_FIXTURE_DIR=".../tests/integration")`. So the tests find `fixture.sql` no matter which directory you run them from.
- `buffer << file.rdbuf();` — the idiomatic "read whole file into a string".
- `testUser(...)` — builds an `AuthUser` the same shape the JWT verifier (Task 3) produces, without needing a token. `extraClaims` lets a test inject nasty values.

---

## File 4 — `tests/unit/pg_pool_test.cpp`

These run on every build — no database needed.

```cpp
#include <gtest/gtest.h>

#include <pqxx/pqxx>

#include "db/pg_pool.h"

using namespace std::chrono_literals;
using tradeai::db::PgPool;
using tradeai::db::PoolTimeout;

// Port 1 refuses connections immediately.
constexpr const char* kUnreachable = "host=127.0.0.1 port=1 connect_timeout=1";

TEST(PgPool, FailedConnectDoesNotLeakSlot) {
  PgPool pool(kUnreachable, 1, 200ms);
  auto noop = [](pqxx::work&) {};
  // If the first failure leaked the only slot, the second call would time out instead.
  EXPECT_THROW(pool.withServiceTx(noop), pqxx::broken_connection);
  EXPECT_THROW(pool.withServiceTx(noop), pqxx::broken_connection);
}

TEST(PgPool, PoolTimeoutIsARuntimeError) {
  EXPECT_TRUE((std::is_base_of_v<std::runtime_error, PoolTimeout>));
}
```

**How to read it**

- `FailedConnectDoesNotLeakSlot` — a pool of size **1** pointed at a dead address. Each call must fail with "couldn't connect" (`broken_connection`). If the pool forgot to give the slot back after the first failure, the second call would wait for a free slot and fail with `PoolTimeout` instead. This pins Review Focus #3: *database unreachable must not leak pool slots*.
- `EXPECT_THROW(expr, Type)` — passes only if `expr` throws exactly that type (or a subclass).
- `std::is_base_of_v<A, B>` — a compile-time check "is B derived from A?". Extra parentheses again keep the comma away from the macro.

---

## File 5 — `tests/integration/pg_pool_integration_test.cpp`

The tests that prove RLS really works through our pool.

```cpp
#include <gtest/gtest.h>

#include <future>
#include <pqxx/pqxx>
#include <string>
#include <vector>

#include "db/pg_pool.h"
#include "support/db_fixture.h"

using namespace std::chrono_literals;
using namespace tradeai::testing;
using tradeai::db::PgPool;
using tradeai::db::PoolTimeout;

namespace {

std::vector<std::string> notesVisibleTo(PgPool& pool, const tradeai::auth::AuthUser& user) {
  return pool.withUserTx(user, [](pqxx::work& tx) {
    std::vector<std::string> notes;
    for (auto row : tx.exec("select note from public.rls_probe order by note")) {
      notes.push_back(row[0].as<std::string>());
    }
    return notes;
  });
}

class PgPoolIntegration : public ::testing::Test {
 protected:
  void SetUp() override {
    url = testDatabaseUrl();
    if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
    pool = std::make_unique<PgPool>(*url, 2, 500ms);
    pool->withServiceTx([](pqxx::work& tx) { tx.exec(readFixtureSql()); });
  }

  std::optional<std::string> url;
  std::unique_ptr<PgPool> pool;
};

}  // namespace

TEST_F(PgPoolIntegration, UserTxSeesOnlyOwnRows) {
  EXPECT_EQ(notesVisibleTo(*pool, testUser(kUserA)), (std::vector<std::string>{"a1", "a2"}));
  EXPECT_EQ(notesVisibleTo(*pool, testUser(kUserB)), (std::vector<std::string>{"b1"}));
}

TEST_F(PgPoolIntegration, UnknownUserSeesNothing) {
  EXPECT_TRUE(notesVisibleTo(*pool, testUser("cccccccc-cccc-cccc-cccc-cccccccccccc")).empty());
}

TEST_F(PgPoolIntegration, AuthUidMatchesSub) {
  auto uid = pool->withUserTx(testUser(kUserA), [](pqxx::work& tx) {
    return tx.query_value<std::string>("select auth.uid()::text");
  });
  EXPECT_EQ(uid, kUserA);
}

TEST_F(PgPoolIntegration, InsertForAnotherUserIsRejected) {
  EXPECT_THROW(pool->withUserTx(testUser(kUserA),
                                [](pqxx::work& tx) {
                                  tx.exec("insert into public.rls_probe (user_id, note) values ($1, 'x')",
                                          pqxx::params{kUserB});
                                }),
               pqxx::sql_error);
}

TEST_F(PgPoolIntegration, ClaimsWithSqlMetacharactersAreSafe) {
  auto user = testUser(kUserA, {{"name", "O'Brien\"; drop table public.rls_probe; --"}});
  EXPECT_EQ(notesVisibleTo(*pool, user), (std::vector<std::string>{"a1", "a2"}));
  auto count = pool->withServiceTx(
      [](pqxx::work& tx) { return tx.query_value<int>("select count(*) from public.rls_probe"); });
  EXPECT_EQ(count, 3);
}

TEST_F(PgPoolIntegration, RoleIsResetAfterUserTx) {
  PgPool single(*url, 1, 500ms);  // one connection, so both calls reuse it
  single.withUserTx(testUser(kUserA), [](pqxx::work&) {});
  auto [role, claims] = single.withServiceTx([](pqxx::work& tx) {
    auto row = tx.exec("select current_user::text, coalesce(current_setting('request.jwt.claims', true), '')")
                   .one_row();
    return std::pair{row[0].as<std::string>(), row[1].as<std::string>()};
  });
  EXPECT_NE(role, "authenticated");
  EXPECT_EQ(claims, "");
}

TEST_F(PgPoolIntegration, ExhaustedPoolTimesOut) {
  PgPool single(*url, 1, 200ms);
  std::promise<void> holding;
  std::promise<void> release;
  auto releaseSignal = release.get_future();
  auto holder = std::async(std::launch::async, [&] {
    single.withServiceTx([&](pqxx::work&) {
      holding.set_value();
      releaseSignal.wait();
    });
  });
  holding.get_future().wait();
  EXPECT_THROW(single.withServiceTx([](pqxx::work&) {}), PoolTimeout);
  release.set_value();
  holder.get();
}
```

**How to read it**

- `SetUp()` — runs before every `TEST_F`. If there's no DB URL, `GTEST_SKIP()` skips the test. Otherwise it reloads `fixture.sql` so each test starts from the same data.
- `std::unique_ptr<PgPool>` — the pool is created inside `SetUp()` (we need the URL first), so the fixture holds it through a pointer.
- `tx.exec(sql)` returns rows; `row[0].as<std::string>()` reads column 0 as a string. `tx.query_value<T>(sql)` is the shortcut for "exactly one row, one column".
- `pqxx::params{kUserB}` — a **bound parameter** (`$1`). The value is sent separately from the SQL text, so it can never be interpreted as SQL. We always do this — never string-concatenate values into SQL.
- What each test proves:
  - `UserTxSeesOnlyOwnRows` / `UnknownUserSeesNothing` / `AuthUidMatchesSub` — RLS sees the right user.
  - `InsertForAnotherUserIsRejected` — the `with check` clause blocks writing someone else's row; Postgres raises an error → `pqxx::sql_error`.
  - `ClaimsWithSqlMetacharactersAreSafe` — Review Focus #4: a claim containing `'`, `"`, `;` and `drop table` is harmless; afterwards the table still has 3 rows.
  - `RoleIsResetAfterUserTx` — Review Focus #5: with a pool of **one** connection, a user transaction followed by a service transaction must not inherit the user's role or claims.
  - `ExhaustedPoolTimesOut` — one background task holds the only connection; a second call must give up after 200 ms with `PoolTimeout` (which becomes a 503 thanks to Task 2's `guarded()`).
- `auto [role, claims] = ...` — **structured binding**: unpacks a pair, like `const [role, claims] = ...` in JS.
- `std::promise` / `future` — one-shot signals between threads. `holding` says "I've got the connection"; `release` says "you can let go now". This makes the test deterministic instead of relying on `sleep`.

### ✋ Checkpoint — see it fail

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug
```

Expected: **compile errors** — `db/pg_pool.h` is empty, so `PgPool` doesn't exist. Correct. Now write the code.

---

## File 6 — `src/db/pg_pool.h`

Most of the logic lives in the header because `withUserTx`, `withServiceTx` and `run` are **templates** (they accept any lambda), and templates must be visible where they're used.

```cpp
#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <memory>
#include <mutex>
#include <pqxx/pqxx>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "auth/auth_user.h"
#include "db/pool_timeout.h"

namespace tradeai::db {

// Fixed-size libpqxx connection pool. Connections open lazily; broken ones are
// dropped and reopened on demand.
class PgPool {
 public:
  PgPool(std::string connectionString, std::size_t size,
         std::chrono::milliseconds acquireTimeout = std::chrono::seconds{5});
  PgPool(const PgPool&) = delete;
  PgPool& operator=(const PgPool&) = delete;

  // Runs fn(pqxx::work&) as role `authenticated` with the user's verified JWT
  // claims set, so RLS policies using auth.uid() apply. Both settings are
  // transaction-local and reset when the transaction ends.
  template <class F>
  auto withUserTx(const auth::AuthUser& user, F&& fn) {
    return run([&](pqxx::work& tx) {
      tx.exec("SET LOCAL ROLE authenticated");
      tx.exec("SELECT set_config('request.jwt.claims', $1, true)", pqxx::params{user.claims.dump()});
      return fn(tx);
    });
  }

  // Runs fn(pqxx::work&) as the connection's own role. Bypasses RLS: only use
  // where the TypeScript code used the Supabase service-role client.
  template <class F>
  auto withServiceTx(F&& fn) {
    return run(std::forward<F>(fn));
  }

 private:
  struct Lease {
    Lease(PgPool& pool, std::unique_ptr<pqxx::connection> conn) : pool(pool), conn(std::move(conn)) {}
    ~Lease() { pool.release(std::move(conn), broken); }
    Lease(const Lease&) = delete;
    Lease& operator=(const Lease&) = delete;

    PgPool& pool;
    std::unique_ptr<pqxx::connection> conn;
    bool broken = false;
  };

  template <class F>
  auto run(F&& fn) {
    using Result = std::invoke_result_t<F&, pqxx::work&>;
    Lease lease(*this, acquire());
    try {
      pqxx::work tx(*lease.conn);
      if constexpr (std::is_void_v<Result>) {
        fn(tx);
        tx.commit();
      } else {
        Result result = fn(tx);
        tx.commit();
        return result;
      }
    } catch (const pqxx::broken_connection&) {
      lease.broken = true;
      throw;
    }
  }

  std::unique_ptr<pqxx::connection> acquire();
  void release(std::unique_ptr<pqxx::connection> conn, bool broken) noexcept;

  std::string connectionString_;
  std::size_t size_;
  std::chrono::milliseconds acquireTimeout_;

  std::mutex mutex_;
  std::condition_variable available_;
  std::vector<std::unique_ptr<pqxx::connection>> idle_;
  std::size_t open_ = 0;  // idle + leased + currently connecting
};

}  // namespace tradeai::db
```

**How to read it**

- **The RLS trick, in two lines** (`withUserTx`):
  - `SET LOCAL ROLE authenticated` — for the rest of this transaction, act as the `authenticated` role, so RLS policies `to authenticated` apply.
  - `set_config('request.jwt.claims', $1, true)` — store the user's claims JSON where `auth.uid()` reads it. The claims go in as **bound parameter `$1`**, never pasted into SQL (that's the metacharacter test). The final `true` means "local to this transaction".
  - `LOCAL` is the key word: when the transaction commits or rolls back, Postgres undoes both. The connection goes back to the pool clean — that's the `RoleIsResetAfterUserTx` test.
- `withServiceTx` — no role switch, so it runs as the connection's own (powerful) user and **bypasses RLS**. Only for things the TypeScript code did with the service-role key.
- **`Lease` = RAII.** Its destructor always returns the connection to the pool — on success, on exception, on early return. You can't forget to release. (Same idea as `lock_guard` for mutexes.)
- `run()` line by line:
  - `std::invoke_result_t<F&, pqxx::work&>` — "what type does `fn(tx)` return?", computed at compile time.
  - `if constexpr (std::is_void_v<Result>)` — a compile-time `if`: if the lambda returns nothing, don't try to store its result in a variable (you can't have a `void` variable).
  - `pqxx::work tx(...)` — starts a transaction. If `fn` throws, `tx` is destroyed without `commit()`, which means **rollback**.
  - `catch (const pqxx::broken_connection&) { lease.broken = true; throw; }` — if the connection died, mark it so the pool throws it away instead of reusing it, then re-throw the same exception (`throw;` with nothing after it).
- `std::condition_variable available_` — lets a thread sleep until "a connection was returned", instead of busy-looping.
- `open_` counts **every** connection we're responsible for — idle, in use, or still connecting. It's what stops us opening more than `size_`.

---

## File 7 — `src/db/pg_pool.cpp`

```cpp
#include "db/pg_pool.h"

namespace tradeai::db {

PgPool::PgPool(std::string connectionString, std::size_t size,
               std::chrono::milliseconds acquireTimeout)
    : connectionString_(std::move(connectionString)), size_(size), acquireTimeout_(acquireTimeout) {
  idle_.reserve(size_);
}

std::unique_ptr<pqxx::connection> PgPool::acquire() {
  std::unique_lock lock(mutex_);
  const bool ready = available_.wait_for(lock, acquireTimeout_,
                                         [this] { return !idle_.empty() || open_ < size_; });
  if (!ready) throw PoolTimeout("timed out waiting for a database connection");

  if (!idle_.empty()) {
    auto conn = std::move(idle_.back());
    idle_.pop_back();
    return conn;
  }

  ++open_;
  lock.unlock();
  try {
    return std::make_unique<pqxx::connection>(connectionString_);
  } catch (...) {
    {
      std::lock_guard guard(mutex_);
      --open_;
    }
    available_.notify_one();
    throw;
  }
}

void PgPool::release(std::unique_ptr<pqxx::connection> conn, bool broken) noexcept {
  std::unique_ptr<pqxx::connection> discarded;
  {
    std::lock_guard guard(mutex_);
    if (broken || !conn || !conn->is_open()) {
      discarded = std::move(conn);
      --open_;
    } else {
      idle_.push_back(std::move(conn));
    }
  }
  available_.notify_one();
}

}  // namespace tradeai::db
```

**How to read it — `acquire()`**

1. Lock, then `wait_for(lock, timeout, condition)` — sleep until there's an idle connection **or** room to open a new one, or until the timeout. While sleeping the lock is released so other threads can return connections.
2. Timed out → `PoolTimeout` (→ 503 for the client).
3. Idle connection available → take it.
4. Otherwise reserve a slot (`++open_`), **unlock**, and connect. Connecting can take a while; holding the lock during it would block every other request.
5. If connecting fails → give the slot back (`--open_`), wake one waiter, re-throw. This `catch (...)` block is precisely what `FailedConnectDoesNotLeakSlot` tests.

**How to read it — `release()`**

- Broken or closed connections are dropped (and their slot freed); healthy ones go back to `idle_`.
- `noexcept` — promises never to throw. It's called from `Lease`'s destructor, and throwing from a destructor during another exception would terminate the program.
- `discarded` — a subtle one: we move the dead connection into a local variable so its destructor (which closes the socket, possibly slowly) runs **after** we've released the mutex.
- `notify_one()` is called after the lock is released — so the woken thread can grab the lock immediately.

---

## ✅ Build and test — without a database

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug && ctest --preset debug
```

Expected: 48 tests pass (the 46 from earlier + 2 `PgPool.*`), and the 7 `PgPoolIntegration.*` tests are reported as **skipped** ("Not Run" / "Skipped").

## ✅ Build and test — with a real Postgres

Needs Docker Desktop running.

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
docker compose up -d --wait
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres ctest --preset debug
```

Expected: **all 55 tests pass**, including the 7 `PgPoolIntegration.*` tests.

When you're done: `docker compose down` stops the database (add `-v` to also delete its data — harmless here, the fixture recreates everything).

If something fails, paste the error and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="backend/docker-compose.yml backend/src/db/pg_pool.h backend/src/db/pg_pool.cpp backend/tests/integration/fixture.sql backend/tests/integration/pg_pool_integration_test.cpp backend/tests/support/db_fixture.h backend/tests/unit/pg_pool_test.cpp"
git add $FILES
git commit -m "feat(backend): libpqxx pool with RLS-scoped user transactions" -- $FILES
```

(The `-- $FILES` part commits only these 7 files, so your staged deletions and the empty files for later tasks stay out of this commit.)
