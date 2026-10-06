# C++ Backend Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable C++ API service (`backend/`) that verifies Supabase JWTs and runs Postgres queries under the user's RLS identity, plus the Next.js helper and rewrite that call it. This is sub-project 1 of the C++ backend migration.

**Architecture:** Crow (synchronous, thread pool) HTTP server. A `RequestIdMiddleware` and an `AuthMiddleware` (Bearer JWT → `AuthUser`) run before route handlers. Handlers call `PgPool::withUserTx`, which runs each request's SQL in one transaction as role `authenticated` with `request.jwt.claims` set, so the existing RLS policies and `auth.uid()` work unchanged. Next.js calls the service through `/cpp-api/*` (browser, via rewrite) or `CPP_API_URL` directly (server).

**Tech Stack:** C++23, CMake ≥ 3.25 + presets, vcpkg manifest, Crow, libpqxx ≥ 7.9, cpr, nlohmann/json, jwt-cpp, OpenSSL 3, GoogleTest; Docker (debian trixie), Fly.io; TypeScript + vitest on the Next side.

**Spec:** `docs/superpowers/specs/2026-10-06-cpp-backend-design.md` (sections 2 and 3)

**Deviations from the spec (intentional, spec updated alongside this plan):**
- §3.6 named one file `lib/api/cpp-client.ts`. It is split into `lib/api/core.ts`, `lib/api/client.ts` and `lib/api/server.ts`, because a single module that imports `lib/supabase/server.ts` (which uses `next/headers`) cannot be imported from Client Components.
- §3.9 criterion 3 is verified with `curl`, using an access token from Supabase's password grant, against the deployed Vercel `/cpp-api/me`. No UI is added just to exercise `/me`.

## Global Constraints

- Language: C++23 (`std::expected`). Compilers: Apple clang 17+ / GCC 13+ (Docker uses GCC 14 from debian trixie).
- C++ dependencies only via `backend/vcpkg.json`: `crow`, `libpqxx`, `cpr`, `nlohmann-json`, `jwt-cpp`, `openssl`, `gtest`. libpqxx must be ≥ 7.9 (`tx.exec(sql, pqxx::params{...})`).
- Response envelope, exactly: `{"success":true,"data":...}` or `{"success":false,"error":"..."}`.
- Client-facing error strings, exactly: `Something went wrong. Please try again.` (500), `Service temporarily unavailable. Please try again.` (503), `Not authenticated` (401).
- Env var names, exactly: `PORT`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `ALLOWED_AUDIENCE`, `DB_POOL_SIZE`, `HTTP_THREADS` (C++); `CPP_API_URL` (Next).
- Never use server-side prepared statements (transaction-pooler compatibility). Use only `tx.exec(sql)` / `tx.exec(sql, pqxx::params{...})` / `tx.query_value<T>(sql)`.
- Never log secrets, tokens, or the database URL.
- Log lines are prefixed `[area]`, e.g. `[auth]`, `[me]`, `[jwks]`.
- **Git:** the repo has unrelated *staged deletions* the user has not committed. Never commit them: always `git add <paths>` then `git commit -m "..." -- <paths>` (pathspec-limited commit). Do not run `git commit -a` or plain `git commit`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- All C++ commands run from `backend/` unless stated otherwise.

## Review Focus

1. **Authorization header with lowercase `bearer` or extra whitespace** should be accepted like `Bearer <token>`. Pinned in Task 2 (`BearerToken.*`).
2. **JWKS endpoint temporarily down** should make requests fail with 401 (not crash or 500), and verification should recover once JWKS is back. Pinned in Task 3 (`RecoversAfterJwksOutage`).
3. **Database unreachable** should not leak pool slots. Later requests should retry connecting instead of hanging until a 503. Pinned in Task 4 (`FailedConnectDoesNotLeakSlot`).
4. **JWT claims containing quotes or SQL metacharacters** must be passed as a bound parameter, with no injection and no failure. Pinned in Task 4 (`ClaimsWithSqlMetacharactersAreSafe`).
5. **Role or claims leaking to the next request on a reused connection** must not happen: `SET LOCAL` must reset at the end of the transaction. Pinned in Task 4 (`RoleIsResetAfterUserTx`).

---

## File Structure

```
backend/
├── CMakeLists.txt              # globbed src/*.cpp → tradeai_core lib; main.cpp → tradeai_api; tests/*.cpp → tradeai_tests
├── CMakePresets.json           # debug (ASan/UBSan) / release
├── vcpkg.json
├── .env.example  .dockerignore  Dockerfile  docker-compose.yml  fly.toml
├── src/
│   ├── main.cpp                # wiring only
│   ├── app_setup.{h,cpp}       # setupApp(): middleware deps + route registration (shared by main and tests)
│   ├── config/config.{h,cpp}   # Config::fromEnv
│   ├── auth/auth_user.h        # AuthUser
│   ├── auth/bearer.{h,cpp}     # bearerToken(header)
│   ├── auth/jwks.{h,cpp}       # parseJwks, JwksFetcher, HttpJwksFetcher
│   ├── auth/jwt_verifier.{h,cpp}
│   ├── db/pool_timeout.h       # PoolTimeout (kept separate so http/ needn't include pqxx)
│   ├── db/pg_pool.{h,cpp}
│   ├── http/response.{h,cpp}   # ok, fail, guarded
│   ├── http/middleware.{h,cpp} # RequestIdMiddleware, AuthMiddleware, App, currentUser
│   └── routes/system.{h,cpp}   # /healthz /readyz /me
└── tests/
    ├── support/                # test_tokens, fake_jwks, db_fixture
    ├── unit/                   # always run
    └── integration/            # fixture.sql + tests that GTEST_SKIP without TEST_DATABASE_URL
lib/api/core.ts  client.ts  server.ts  core.test.ts   # Next side
```

---

### Task 1: Toolchain, project scaffold, and Config

**Files:**
- Create: `backend/vcpkg.json`, `backend/CMakeLists.txt`, `backend/CMakePresets.json`, `backend/src/config/config.h`, `backend/src/config/config.cpp`, `backend/src/main.cpp` (temporary), `backend/tests/unit/config_test.cpp`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `tradeai::config::Config` with fields `int port; std::string databaseUrl; std::string supabaseUrl; std::optional<std::string> supabaseJwtSecret; std::string allowedAudience; std::size_t dbPoolSize; std::size_t httpThreads;` and methods `std::string jwksUrl() const`, `std::string issuer() const`, `static std::expected<Config, std::string> fromEnv(const EnvLookup&)`, `static std::expected<Config, std::string> fromEnv()`. `using EnvLookup = std::function<std::optional<std::string>(std::string_view)>;`

- [ ] **Step 1: Install the toolchain (one-time, macOS)**

```bash
brew install cmake ninja pkg-config autoconf autoconf-archive automake libtool
git clone https://github.com/microsoft/vcpkg ~/vcpkg
~/vcpkg/bootstrap-vcpkg.sh -disableMetrics
echo 'export VCPKG_ROOT="$HOME/vcpkg"' >> ~/.zshrc
export VCPKG_ROOT="$HOME/vcpkg"
cmake --version   # expect >= 3.25
```

Ask the user before editing `~/.zshrc`. If they decline, export `VCPKG_ROOT` in each shell instead. If a vcpkg port build later complains about a missing system tool, install it with `brew install <tool>` and re-run the same command.

- [ ] **Step 2: Create `backend/vcpkg.json`, then pin the baseline**

```json
{
  "name": "tradeai-api",
  "version-string": "0.1.0",
  "dependencies": [
    "crow",
    "libpqxx",
    "cpr",
    "nlohmann-json",
    "jwt-cpp",
    "openssl",
    "gtest"
  ]
}
```

Run: `cd backend && "$VCPKG_ROOT/vcpkg" x-update-baseline --add-initial-baseline`
Expected: `vcpkg.json` gains a `"builtin-baseline": "<40-char sha>"` line.

- [ ] **Step 3: Create `backend/CMakePresets.json`**

```json
{
  "version": 6,
  "configurePresets": [
    {
      "name": "base",
      "hidden": true,
      "generator": "Ninja",
      "binaryDir": "${sourceDir}/build/${presetName}",
      "toolchainFile": "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    },
    {
      "name": "debug",
      "inherits": "base",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Debug", "TRADEAI_SANITIZE": "ON" }
    },
    {
      "name": "release",
      "inherits": "base",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Release" }
    }
  ],
  "buildPresets": [
    { "name": "debug", "configurePreset": "debug" },
    { "name": "release", "configurePreset": "release" }
  ],
  "testPresets": [
    { "name": "debug", "configurePreset": "debug", "output": { "outputOnFailure": true } }
  ]
}
```

- [ ] **Step 4: Create `backend/CMakeLists.txt`**

```cmake
cmake_minimum_required(VERSION 3.25)
project(tradeai_api LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(TRADEAI_SANITIZE "Build with ASan/UBSan" OFF)
option(TRADEAI_BUILD_TESTS "Build the test suite" ON)

if(TRADEAI_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

find_package(Crow CONFIG REQUIRED)
find_package(libpqxx CONFIG REQUIRED)
find_package(cpr CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(jwt-cpp CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

# Every .cpp under src/ except main.cpp is library code shared by the server and the tests.
file(GLOB_RECURSE TRADEAI_CORE_SOURCES CONFIGURE_DEPENDS src/*.cpp)
list(REMOVE_ITEM TRADEAI_CORE_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp)

add_library(tradeai_core STATIC ${TRADEAI_CORE_SOURCES})
target_include_directories(tradeai_core PUBLIC src)
target_compile_definitions(tradeai_core PUBLIC JWT_DISABLE_PICOJSON)
target_compile_options(tradeai_core PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(tradeai_core PUBLIC
  Crow::Crow libpqxx::pqxx cpr::cpr nlohmann_json::nlohmann_json jwt-cpp::jwt-cpp
  OpenSSL::SSL OpenSSL::Crypto)

add_executable(tradeai_api src/main.cpp)
target_link_libraries(tradeai_api PRIVATE tradeai_core)

if(TRADEAI_BUILD_TESTS)
  enable_testing()
  find_package(GTest CONFIG REQUIRED)
  file(GLOB_RECURSE TRADEAI_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
  add_executable(tradeai_tests ${TRADEAI_TEST_SOURCES})
  target_include_directories(tradeai_tests PRIVATE tests)
  target_compile_definitions(tradeai_tests PRIVATE
    TRADEAI_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/integration")
  target_link_libraries(tradeai_tests PRIVATE tradeai_core GTest::gtest_main)
  include(GoogleTest)
  gtest_discover_tests(tradeai_tests DISCOVERY_TIMEOUT 30)
endif()
```

- [ ] **Step 5: Update the root `.gitignore`**

Append:

```gitignore

# C++ backend
backend/build/
backend/vcpkg_installed/
!backend/.env.example
```

(The existing `.env*` rule already ignores `backend/.env`. The negation keeps the example file trackable.)

- [ ] **Step 6: Write the failing test `backend/tests/unit/config_test.cpp`**

```cpp
#include <gtest/gtest.h>

#include <map>
#include <string>

#include "config/config.h"

using tradeai::config::Config;
using tradeai::config::EnvLookup;

namespace {

EnvLookup envOf(std::map<std::string, std::string> vars) {
  return [vars = std::move(vars)](std::string_view name) -> std::optional<std::string> {
    auto it = vars.find(std::string(name));
    if (it == vars.end()) return std::nullopt;
    return it->second;
  };
}

std::map<std::string, std::string> required() {
  return {{"DATABASE_URL", "postgresql://u:p@localhost/db"},
          {"SUPABASE_URL", "https://abc.supabase.co/"}};
}

}  // namespace

TEST(Config, AppliesDefaults) {
  auto cfg = Config::fromEnv(envOf(required()));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->port, 8080);
  EXPECT_EQ(cfg->dbPoolSize, 8u);
  EXPECT_EQ(cfg->httpThreads, 32u);
  EXPECT_EQ(cfg->allowedAudience, "authenticated");
  EXPECT_FALSE(cfg->supabaseJwtSecret.has_value());
  EXPECT_EQ(cfg->databaseUrl, "postgresql://u:p@localhost/db");
}

TEST(Config, StripsTrailingSlashAndDerivesUrls) {
  auto cfg = Config::fromEnv(envOf(required()));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->supabaseUrl, "https://abc.supabase.co");
  EXPECT_EQ(cfg->issuer(), "https://abc.supabase.co/auth/v1");
  EXPECT_EQ(cfg->jwksUrl(), "https://abc.supabase.co/auth/v1/.well-known/jwks.json");
}

TEST(Config, MissingDatabaseUrlNamesTheVar) {
  auto vars = required();
  vars.erase("DATABASE_URL");
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DATABASE_URL"), std::string::npos);
}

TEST(Config, MissingSupabaseUrlNamesTheVar) {
  auto vars = required();
  vars.erase("SUPABASE_URL");
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("SUPABASE_URL"), std::string::npos);
}

TEST(Config, EmptyValueCountsAsMissing) {
  auto vars = required();
  vars["DATABASE_URL"] = "";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DATABASE_URL"), std::string::npos);
}

TEST(Config, ReadsOverrides) {
  auto vars = required();
  vars["PORT"] = "9000";
  vars["DB_POOL_SIZE"] = "3";
  vars["HTTP_THREADS"] = "4";
  vars["SUPABASE_JWT_SECRET"] = "s3cret";
  vars["ALLOWED_AUDIENCE"] = "custom";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->port, 9000);
  EXPECT_EQ(cfg->dbPoolSize, 3u);
  EXPECT_EQ(cfg->httpThreads, 4u);
  EXPECT_EQ(cfg->supabaseJwtSecret, "s3cret");
  EXPECT_EQ(cfg->allowedAudience, "custom");
}

TEST(Config, RejectsNonNumericPort) {
  auto vars = required();
  vars["PORT"] = "80a";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("PORT"), std::string::npos);
}

TEST(Config, RejectsPortAboveRange) {
  auto vars = required();
  vars["PORT"] = "70000";
  ASSERT_FALSE(Config::fromEnv(envOf(vars)));
}

TEST(Config, RejectsZeroPoolSize) {
  auto vars = required();
  vars["DB_POOL_SIZE"] = "0";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DB_POOL_SIZE"), std::string::npos);
}
```

- [ ] **Step 7: Run the build to verify it fails**

Run: `cd backend && cmake --preset debug && cmake --build --preset debug`
Expected: FAIL. The first configure also builds every vcpkg dependency, which takes 10–20 minutes. Then CMake reports `No SOURCES given to target: tradeai_core`, or the compile fails on `config/config.h` not found.

- [ ] **Step 8: Write `backend/src/config/config.h`**

```cpp
#pragma once

#include <cstddef>
#include <expected>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace tradeai::config {

using EnvLookup = std::function<std::optional<std::string>(std::string_view)>;

struct Config {
  int port = 8080;
  std::string databaseUrl;
  std::string supabaseUrl;  // without trailing slash
  std::optional<std::string> supabaseJwtSecret;
  std::string allowedAudience = "authenticated";
  std::size_t dbPoolSize = 8;
  std::size_t httpThreads = 32;

  std::string jwksUrl() const { return supabaseUrl + "/auth/v1/.well-known/jwks.json"; }
  std::string issuer() const { return supabaseUrl + "/auth/v1"; }

  static std::expected<Config, std::string> fromEnv(const EnvLookup& lookup);
  static std::expected<Config, std::string> fromEnv();
};

}  // namespace tradeai::config
```

- [ ] **Step 9: Write `backend/src/config/config.cpp`**

```cpp
#include "config/config.h"

#include <charconv>
#include <cstdlib>

namespace tradeai::config {
namespace {

std::optional<std::string> nonEmpty(const EnvLookup& lookup, std::string_view name) {
  auto value = lookup(name);
  if (!value || value->empty()) return std::nullopt;
  return value;
}

std::expected<long, std::string> positiveInt(const EnvLookup& lookup, std::string_view name,
                                             long fallback) {
  auto raw = nonEmpty(lookup, name);
  if (!raw) return fallback;
  long value = 0;
  const char* end = raw->data() + raw->size();
  auto [ptr, ec] = std::from_chars(raw->data(), end, value);
  if (ec != std::errc{} || ptr != end || value <= 0) {
    return std::unexpected(std::string(name) + " must be a positive integer");
  }
  return value;
}

}  // namespace

std::expected<Config, std::string> Config::fromEnv(const EnvLookup& lookup) {
  Config cfg;

  auto databaseUrl = nonEmpty(lookup, "DATABASE_URL");
  if (!databaseUrl) return std::unexpected("missing required env var DATABASE_URL");
  auto supabaseUrl = nonEmpty(lookup, "SUPABASE_URL");
  if (!supabaseUrl) return std::unexpected("missing required env var SUPABASE_URL");

  cfg.databaseUrl = *databaseUrl;
  cfg.supabaseUrl = *supabaseUrl;
  while (!cfg.supabaseUrl.empty() && cfg.supabaseUrl.back() == '/') cfg.supabaseUrl.pop_back();
  cfg.supabaseJwtSecret = nonEmpty(lookup, "SUPABASE_JWT_SECRET");
  if (auto audience = nonEmpty(lookup, "ALLOWED_AUDIENCE")) cfg.allowedAudience = *audience;

  auto port = positiveInt(lookup, "PORT", 8080);
  if (!port) return std::unexpected(port.error());
  if (*port > 65535) return std::unexpected("PORT must be <= 65535");
  cfg.port = static_cast<int>(*port);

  auto poolSize = positiveInt(lookup, "DB_POOL_SIZE", 8);
  if (!poolSize) return std::unexpected(poolSize.error());
  cfg.dbPoolSize = static_cast<std::size_t>(*poolSize);

  auto threads = positiveInt(lookup, "HTTP_THREADS", 32);
  if (!threads) return std::unexpected(threads.error());
  cfg.httpThreads = static_cast<std::size_t>(*threads);

  return cfg;
}

std::expected<Config, std::string> Config::fromEnv() {
  return fromEnv([](std::string_view name) -> std::optional<std::string> {
    const char* value = std::getenv(std::string(name).c_str());
    if (value == nullptr) return std::nullopt;
    return std::string(value);
  });
}

}  // namespace tradeai::config
```

- [ ] **Step 10: Write the temporary `backend/src/main.cpp`** (Task 5 replaces it)

```cpp
#include <iostream>

#include "config/config.h"

int main() {
  auto cfg = tradeai::config::Config::fromEnv();
  if (!cfg) {
    std::cerr << "[config] " << cfg.error() << '\n';
    return 1;
  }
  std::cout << "[config] loaded, port " << cfg->port << '\n';
  return 0;
}
```

- [ ] **Step 11: Build and run the tests**

Run: `cmake --preset debug && cmake --build --preset debug && ctest --preset debug`
Expected: all 9 `Config.*` tests PASS.

- [ ] **Step 12: Commit**

```bash
cd .. && git add .gitignore backend
git commit -m "feat(backend): C++ project scaffold and env config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- .gitignore backend
```

---

### Task 2: HTTP primitives (response envelope, guarded handlers, Bearer parsing)

**Files:**
- Create: `backend/src/db/pool_timeout.h`, `backend/src/http/response.h`, `backend/src/http/response.cpp`, `backend/src/auth/bearer.h`, `backend/src/auth/bearer.cpp`
- Test: `backend/tests/unit/response_test.cpp`, `backend/tests/unit/bearer_test.cpp`

**Interfaces:**
- Produces:
  - `struct tradeai::db::PoolTimeout : std::runtime_error`
  - `tradeai::http::kGenericError`, `tradeai::http::kUnavailableError` (`std::string_view` constants)
  - `crow::response tradeai::http::ok(const nlohmann::json& data, int status = 200)`
  - `crow::response tradeai::http::fail(int status, std::string_view message)`
  - `template <class F> crow::response tradeai::http::guarded(std::string_view routeName, F&& handler)`
  - `std::optional<std::string_view> tradeai::auth::bearerToken(std::string_view header)`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/response_test.cpp`:

```cpp
#include <gtest/gtest.h>

#include <nlohmann/json.hpp>
#include <stdexcept>

#include "db/pool_timeout.h"
#include "http/response.h"

using namespace tradeai;

TEST(Response, OkWrapsDataInEnvelope) {
  auto res = http::ok({{"id", "abc"}});
  EXPECT_EQ(res.code, 200);
  EXPECT_EQ(res.get_header_value("Content-Type"), "application/json");
  auto body = nlohmann::json::parse(res.body);
  EXPECT_EQ(body, (nlohmann::json{{"success", true}, {"data", {{"id", "abc"}}}}));
}

TEST(Response, OkAcceptsCustomStatus) {
  EXPECT_EQ(http::ok(nullptr, 201).code, 201);
}

TEST(Response, FailWrapsErrorInEnvelope) {
  auto res = http::fail(400, "bad input");
  EXPECT_EQ(res.code, 400);
  auto body = nlohmann::json::parse(res.body);
  EXPECT_EQ(body, (nlohmann::json{{"success", false}, {"error", "bad input"}}));
}

TEST(Guarded, ReturnsHandlerResponse) {
  auto res = http::guarded("[test]", [] { return http::ok({{"x", 1}}, 202); });
  EXPECT_EQ(res.code, 202);
}

TEST(Guarded, PoolTimeoutBecomes503) {
  auto res = http::guarded("[test]", []() -> crow::response { throw db::PoolTimeout("timeout"); });
  EXPECT_EQ(res.code, 503);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("error"), http::kUnavailableError);
}

TEST(Guarded, StdExceptionBecomesGeneric500WithoutLeakingDetail) {
  auto res = http::guarded("[test]", []() -> crow::response {
    throw std::runtime_error("password=hunter2 in connection string");
  });
  EXPECT_EQ(res.code, 500);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("error"), http::kGenericError);
  EXPECT_EQ(res.body.find("hunter2"), std::string::npos);
}

TEST(Guarded, NonStdExceptionBecomes500) {
  auto res = http::guarded("[test]", []() -> crow::response { throw 42; });
  EXPECT_EQ(res.code, 500);
}
```

`backend/tests/unit/bearer_test.cpp`:

```cpp
#include <gtest/gtest.h>

#include "auth/bearer.h"

using tradeai::auth::bearerToken;

TEST(BearerToken, ParsesStandardHeader) { EXPECT_EQ(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi"); }
TEST(BearerToken, SchemeIsCaseInsensitive) { EXPECT_EQ(bearerToken("bearer abc"), "abc"); }
TEST(BearerToken, IgnoresSurroundingWhitespace) { EXPECT_EQ(bearerToken("  BEARER   abc  "), "abc"); }
TEST(BearerToken, RejectsOtherSchemes) { EXPECT_FALSE(bearerToken("Basic abc")); }
TEST(BearerToken, RejectsMissingToken) {
  EXPECT_FALSE(bearerToken("Bearer"));
  EXPECT_FALSE(bearerToken("Bearer   "));
}
TEST(BearerToken, RejectsSchemeWithoutSeparator) { EXPECT_FALSE(bearerToken("Bearerabc")); }
TEST(BearerToken, RejectsTokenWithInnerSpace) { EXPECT_FALSE(bearerToken("Bearer a b")); }
TEST(BearerToken, RejectsEmptyHeader) { EXPECT_FALSE(bearerToken("")); }
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `cmake --build --preset debug`
Expected: FAIL. The compiler reports `http/response.h`, `db/pool_timeout.h` and `auth/bearer.h` as not found.

- [ ] **Step 3: Write `backend/src/db/pool_timeout.h`**

```cpp
#pragma once

#include <stdexcept>

namespace tradeai::db {

// Thrown when no database connection becomes free within the acquire timeout.
struct PoolTimeout : std::runtime_error {
  using std::runtime_error::runtime_error;
};

}  // namespace tradeai::db
```

- [ ] **Step 4: Write `backend/src/http/response.h`**

```cpp
#pragma once

#include <crow.h>

#include <exception>
#include <nlohmann/json.hpp>
#include <string_view>
#include <utility>

#include "db/pool_timeout.h"

namespace tradeai::http {

inline constexpr std::string_view kGenericError = "Something went wrong. Please try again.";
inline constexpr std::string_view kUnavailableError =
    "Service temporarily unavailable. Please try again.";

crow::response ok(const nlohmann::json& data, int status = 200);
crow::response fail(int status, std::string_view message);

// Runs a handler and converts any exception into the error envelope, so no
// exception detail ever reaches the client.
template <class F>
crow::response guarded(std::string_view routeName, F&& handler) {
  try {
    return std::forward<F>(handler)();
  } catch (const db::PoolTimeout& e) {
    CROW_LOG_WARNING << routeName << " " << e.what();
    return fail(503, kUnavailableError);
  } catch (const std::exception& e) {
    CROW_LOG_ERROR << routeName << " " << e.what();
    return fail(500, kGenericError);
  } catch (...) {
    CROW_LOG_ERROR << routeName << " unknown exception";
    return fail(500, kGenericError);
  }
}

}  // namespace tradeai::http
```

- [ ] **Step 5: Write `backend/src/http/response.cpp`**

```cpp
#include "http/response.h"

#include <string>

namespace tradeai::http {
namespace {

crow::response json(int status, const nlohmann::json& body) {
  crow::response res(status, body.dump());
  res.set_header("Content-Type", "application/json");
  return res;
}

}  // namespace

crow::response ok(const nlohmann::json& data, int status) {
  return json(status, {{"success", true}, {"data", data}});
}

crow::response fail(int status, std::string_view message) {
  return json(status, {{"success", false}, {"error", std::string(message)}});
}

}  // namespace tradeai::http
```

- [ ] **Step 6: Write `backend/src/auth/bearer.h`**

```cpp
#pragma once

#include <optional>
#include <string_view>

namespace tradeai::auth {

// Extracts the token from an `Authorization: Bearer <token>` header value.
// The scheme match is case-insensitive and surrounding whitespace is ignored.
std::optional<std::string_view> bearerToken(std::string_view header);

}  // namespace tradeai::auth
```

- [ ] **Step 7: Write `backend/src/auth/bearer.cpp`**

```cpp
#include "auth/bearer.h"

#include <cctype>

namespace tradeai::auth {
namespace {

constexpr std::string_view kWhitespace = " \t";

std::string_view trim(std::string_view s) {
  const auto begin = s.find_first_not_of(kWhitespace);
  if (begin == std::string_view::npos) return {};
  const auto end = s.find_last_not_of(kWhitespace);
  return s.substr(begin, end - begin + 1);
}

}  // namespace

std::optional<std::string_view> bearerToken(std::string_view header) {
  constexpr std::string_view scheme = "bearer";
  header = trim(header);
  if (header.size() <= scheme.size()) return std::nullopt;
  for (std::size_t i = 0; i < scheme.size(); ++i) {
    if (std::tolower(static_cast<unsigned char>(header[i])) != scheme[i]) return std::nullopt;
  }
  if (kWhitespace.find(header[scheme.size()]) == std::string_view::npos) return std::nullopt;
  const auto token = trim(header.substr(scheme.size()));
  if (token.empty() || token.find_first_of(kWhitespace) != std::string_view::npos) {
    return std::nullopt;
  }
  return token;
}

}  // namespace tradeai::auth
```

- [ ] **Step 8: Build and run the tests**

Run: `cmake --build --preset debug && ctest --preset debug`
Expected: all `Config.*`, `Response.*`, `Guarded.*` and `BearerToken.*` tests PASS.

- [ ] **Step 9: Commit**

```bash
cd .. && git add backend
git commit -m "feat(backend): response envelope, guarded handlers, bearer parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend
```

---

### Task 3: JWKS parsing and JwtVerifier

**Files:**
- Create: `backend/src/auth/auth_user.h`, `backend/src/auth/jwks.h`, `backend/src/auth/jwks.cpp`, `backend/src/auth/jwt_verifier.h`, `backend/src/auth/jwt_verifier.cpp`
- Create test support: `backend/tests/support/test_tokens.h`, `backend/tests/support/test_tokens.cpp`, `backend/tests/support/fake_jwks.h`
- Test: `backend/tests/unit/jwks_test.cpp`, `backend/tests/unit/jwt_verifier_test.cpp`

**Interfaces:**
- Produces:
  - `struct tradeai::auth::AuthUser { std::string id; std::string role; nlohmann::json claims; };`
  - `struct PublicKey { std::string alg; std::string pem; };` and `using KeySet = std::unordered_map<std::string, PublicKey>;` (keyed by `kid`)
  - `KeySet parseJwks(std::string_view body)`, which throws on malformed JSON
  - `class JwksFetcher { virtual std::string fetch() = 0; }` and `class HttpJwksFetcher(std::string url)`
  - `enum class AuthError { MissingToken, Malformed, UnsupportedAlgorithm, UnknownKey, KeysUnavailable, InvalidToken };` and `std::string_view toString(AuthError)`
  - `struct JwtVerifierOptions { std::string issuer; std::string audience = "authenticated"; std::optional<std::string> hs256Secret; std::chrono::seconds keyCacheTtl{600}; std::chrono::seconds unknownKidCooldown{30}; std::chrono::seconds leeway{30}; };`
  - `class JwtVerifier(JwtVerifierOptions, std::shared_ptr<JwksFetcher>, Clock = std::chrono::steady_clock::now)` with `std::expected<AuthUser, AuthError> verify(std::string_view token)`. It is not copyable or movable, because it holds a mutex.
  - Test support (used again in Task 5): `kIssuer`, `kSubject`, `EcTestKey`, `makeEcKey`, `jwksJson`, `TokenSpec`, `signEs256`, `signHs256`, `rawToken`, `FakeJwksFetcher`

- [ ] **Step 1: Write the test support files**

`backend/tests/support/fake_jwks.h`:

```cpp
#pragma once

#include <atomic>
#include <mutex>
#include <stdexcept>
#include <string>

#include "auth/jwks.h"

namespace tradeai::testing {

// In-memory JwksFetcher: counts calls and can simulate an outage.
class FakeJwksFetcher final : public auth::JwksFetcher {
 public:
  explicit FakeJwksFetcher(std::string body) : body_(std::move(body)) {}

  std::string fetch() override {
    ++calls_;
    std::lock_guard lock(mutex_);
    if (failing_) throw std::runtime_error("jwks unavailable");
    return body_;
  }

  void setBody(std::string body) {
    std::lock_guard lock(mutex_);
    body_ = std::move(body);
  }
  void setFailing(bool failing) {
    std::lock_guard lock(mutex_);
    failing_ = failing;
  }
  int calls() const { return calls_.load(); }

 private:
  std::mutex mutex_;
  std::string body_;
  bool failing_ = false;
  std::atomic<int> calls_{0};
};

}  // namespace tradeai::testing
```

`backend/tests/support/test_tokens.h`:

```cpp
#pragma once

#include <chrono>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace tradeai::testing {

inline const std::string kIssuer = "https://test.supabase.co/auth/v1";
inline const std::string kSubject = "11111111-1111-1111-1111-111111111111";

struct EcTestKey {
  std::string kid;
  std::string privatePem;
  std::string publicPem;
  std::string x;  // base64url, unpadded
  std::string y;
};

// Generates a fresh P-256 key pair.
EcTestKey makeEcKey(std::string kid);

// A JWKS document advertising the given keys.
std::string jwksJson(const std::vector<EcTestKey>& keys);

struct TokenSpec {
  std::string issuer = kIssuer;
  std::string audience = "authenticated";
  std::string subject = kSubject;
  std::string role = "authenticated";
  std::chrono::seconds expiresIn{3600};
};

std::string signEs256(const EcTestKey& key, const TokenSpec& spec = {});
std::string signHs256(const std::string& secret, const TokenSpec& spec = {});
// Builds a token with an arbitrary header and a junk signature.
std::string rawToken(const nlohmann::json& header, const TokenSpec& spec = {});

}  // namespace tradeai::testing
```

`backend/tests/support/test_tokens.cpp`:

```cpp
#include "support/test_tokens.h"

#include <openssl/bn.h>
#include <openssl/core_names.h>
#include <openssl/evp.h>
#include <openssl/pem.h>

#include <jwt-cpp/traits/nlohmann-json/defaults.h>
#include <stdexcept>

namespace tradeai::testing {
namespace {

std::string b64url(const std::string& raw) {
  return jwt::base::trim<jwt::alphabet::base64url>(
      jwt::base::encode<jwt::alphabet::base64url>(raw));
}

std::string bioToString(BIO* bio) {
  BUF_MEM* mem = nullptr;
  BIO_get_mem_ptr(bio, &mem);
  return {mem->data, mem->length};
}

std::string coordinate(EVP_PKEY* key, const char* param) {
  BIGNUM* bn = nullptr;
  if (EVP_PKEY_get_bn_param(key, param, &bn) != 1) throw std::runtime_error("EVP_PKEY_get_bn_param");
  std::string out(32, '\0');
  BN_bn2binpad(bn, reinterpret_cast<unsigned char*>(out.data()), 32);
  BN_free(bn);
  return b64url(out);
}

auto baseBuilder(const TokenSpec& spec) {
  const auto now = std::chrono::system_clock::now();
  return jwt::create()
      .set_type("JWT")
      .set_issuer(spec.issuer)
      .set_audience(spec.audience)
      .set_subject(spec.subject)
      .set_issued_at(now)
      .set_expires_at(now + spec.expiresIn)
      .set_payload_claim("role", jwt::claim(spec.role));
}

}  // namespace

EcTestKey makeEcKey(std::string kid) {
  EVP_PKEY* key = EVP_EC_gen("P-256");
  if (key == nullptr) throw std::runtime_error("EVP_EC_gen");
  BIO* priv = BIO_new(BIO_s_mem());
  BIO* pub = BIO_new(BIO_s_mem());
  PEM_write_bio_PrivateKey(priv, key, nullptr, nullptr, 0, nullptr, nullptr);
  PEM_write_bio_PUBKEY(pub, key);
  EcTestKey out{std::move(kid), bioToString(priv), bioToString(pub),
                coordinate(key, OSSL_PKEY_PARAM_EC_PUB_X), coordinate(key, OSSL_PKEY_PARAM_EC_PUB_Y)};
  BIO_free(priv);
  BIO_free(pub);
  EVP_PKEY_free(key);
  return out;
}

std::string jwksJson(const std::vector<EcTestKey>& keys) {
  nlohmann::json doc{{"keys", nlohmann::json::array()}};
  for (const auto& k : keys) {
    doc["keys"].push_back({{"kty", "EC"}, {"crv", "P-256"}, {"kid", k.kid}, {"x", k.x},
                           {"y", k.y}, {"alg", "ES256"}, {"use", "sig"}});
  }
  return doc.dump();
}

std::string signEs256(const EcTestKey& key, const TokenSpec& spec) {
  return baseBuilder(spec).set_key_id(key.kid).sign(
      jwt::algorithm::es256(key.publicPem, key.privatePem, "", ""));
}

std::string signHs256(const std::string& secret, const TokenSpec& spec) {
  return baseBuilder(spec).sign(jwt::algorithm::hs256{secret});
}

std::string rawToken(const nlohmann::json& header, const TokenSpec& spec) {
  const auto exp = std::chrono::duration_cast<std::chrono::seconds>(
                       (std::chrono::system_clock::now() + spec.expiresIn).time_since_epoch())
                       .count();
  const nlohmann::json payload{{"iss", spec.issuer}, {"aud", spec.audience}, {"sub", spec.subject},
                               {"role", spec.role},  {"exp", exp}};
  return b64url(header.dump()) + "." + b64url(payload.dump()) + ".c2ln";
}

}  // namespace tradeai::testing
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/jwks_test.cpp`:

```cpp
#include <gtest/gtest.h>

#include "auth/jwks.h"
#include "support/test_tokens.h"

using namespace tradeai;

TEST(ParseJwks, ParsesEcP256Key) {
  auto key = testing::makeEcKey("k1");
  auto keys = auth::parseJwks(testing::jwksJson({key}));
  ASSERT_EQ(keys.size(), 1u);
  EXPECT_EQ(keys.at("k1").alg, "ES256");
  EXPECT_EQ(keys.at("k1").pem.rfind("-----BEGIN PUBLIC KEY-----", 0), 0u);
}

TEST(ParseJwks, SkipsUnsupportedAndKidlessKeys) {
  auto keys = auth::parseJwks(R"({"keys":[
    {"kty":"oct","kid":"sym","k":"c2VjcmV0"},
    {"kty":"EC","crv":"P-384","kid":"p384","x":"AA","y":"AA"},
    {"kty":"EC","crv":"P-256","x":"AA","y":"AA"}
  ]})");
  EXPECT_TRUE(keys.empty());
}

TEST(ParseJwks, EmptyKeySet) { EXPECT_TRUE(auth::parseJwks(R"({"keys":[]})").empty()); }

TEST(ParseJwks, ThrowsOnMalformedJson) {
  EXPECT_ANY_THROW(auth::parseJwks("not json"));
  EXPECT_ANY_THROW(auth::parseJwks(R"({"nokeys":true})"));
}
```

`backend/tests/unit/jwt_verifier_test.cpp`:

```cpp
#include <gtest/gtest.h>

#include <atomic>
#include <thread>
#include <vector>

#include "auth/jwt_verifier.h"
#include "support/fake_jwks.h"
#include "support/test_tokens.h"

using namespace tradeai;
using namespace tradeai::testing;
using auth::AuthError;
using auth::JwtVerifier;
using namespace std::chrono_literals;

namespace {

void expectError(const std::expected<auth::AuthUser, AuthError>& result, AuthError expected) {
  ASSERT_FALSE(result) << "expected failure, got user " << result->id;
  EXPECT_EQ(result.error(), expected) << "got " << auth::toString(result.error());
}

class JwtVerifierTest : public ::testing::Test {
 protected:
  JwtVerifierTest()
      : key(makeEcKey("key-1")), fetcher(std::make_shared<FakeJwksFetcher>(jwksJson({key}))) {}

  JwtVerifier make(std::optional<std::string> secret = std::nullopt) {
    return JwtVerifier({.issuer = kIssuer, .hs256Secret = std::move(secret)}, fetcher,
                       [this] { return now; });
  }

  EcTestKey key;
  std::shared_ptr<FakeJwksFetcher> fetcher;
  std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
};

}  // namespace

TEST_F(JwtVerifierTest, AcceptsValidEs256Token) {
  auto verifier = make();
  auto user = verifier.verify(signEs256(key));
  ASSERT_TRUE(user) << auth::toString(user.error());
  EXPECT_EQ(user->id, kSubject);
  EXPECT_EQ(user->role, "authenticated");
  EXPECT_EQ(user->claims.at("sub"), kSubject);
}

TEST_F(JwtVerifierTest, AcceptsHs256WhenSecretConfigured) {
  auto verifier = make("test-secret");
  auto user = verifier.verify(signHs256("test-secret"));
  ASSERT_TRUE(user) << auth::toString(user.error());
  EXPECT_EQ(user->id, kSubject);
}

TEST_F(JwtVerifierTest, RejectsHs256WithoutSecret) {
  auto verifier = make();
  expectError(verifier.verify(signHs256("test-secret")), AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsHs256WithWrongSecret) {
  auto verifier = make("test-secret");
  expectError(verifier.verify(signHs256("other-secret")), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsExpiredToken) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.expiresIn = -600s})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, AcceptsRecentlyExpiredTokenWithinLeeway) {
  auto verifier = make();
  EXPECT_TRUE(verifier.verify(signEs256(key, {.expiresIn = -10s})));
}

TEST_F(JwtVerifierTest, RejectsWrongIssuer) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.issuer = "https://evil.example/auth/v1"})),
              AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsWrongAudience) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.audience = "anon"})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsEmptySubject) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.subject = ""})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsSignatureFromAnotherKey) {
  auto other = makeEcKey("key-2");
  fetcher->setBody(jwksJson({key, other}));
  auto verifier = make();
  auto forged = other;
  forged.kid = "key-1";  // signed by key-2's private key, claims to be key-1
  expectError(verifier.verify(signEs256(forged)), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsAlgNone) {
  auto verifier = make();
  expectError(verifier.verify(rawToken({{"alg", "none"}, {"typ", "JWT"}})),
              AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsAlgorithmKeyTypeMismatch) {
  auto verifier = make();
  expectError(verifier.verify(rawToken({{"alg", "RS256"}, {"kid", "key-1"}})),
              AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsMalformedAndEmptyTokens) {
  auto verifier = make();
  expectError(verifier.verify("not.a.jwt"), AuthError::Malformed);
  expectError(verifier.verify(""), AuthError::MissingToken);
}

TEST_F(JwtVerifierTest, CachesKeysWithinTtl) {
  auto verifier = make();
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  EXPECT_EQ(fetcher->calls(), 1);
}

TEST_F(JwtVerifierTest, RefetchesAfterTtl) {
  auto verifier = make();
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  now += 11min;
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  EXPECT_EQ(fetcher->calls(), 2);
}

TEST_F(JwtVerifierTest, UnknownKidRefetchIsRateLimited) {
  auto verifier = make();
  auto rotated = makeEcKey("key-2");
  expectError(verifier.verify(signEs256(rotated)), AuthError::UnknownKey);
  expectError(verifier.verify(signEs256(rotated)), AuthError::UnknownKey);
  EXPECT_EQ(fetcher->calls(), 1);

  fetcher->setBody(jwksJson({key, rotated}));
  now += 31s;
  EXPECT_TRUE(verifier.verify(signEs256(rotated)));
  EXPECT_EQ(fetcher->calls(), 2);
}

TEST_F(JwtVerifierTest, RecoversAfterJwksOutage) {
  auto verifier = make();
  fetcher->setFailing(true);
  expectError(verifier.verify(signEs256(key)), AuthError::KeysUnavailable);

  fetcher->setFailing(false);
  now += 31s;
  EXPECT_TRUE(verifier.verify(signEs256(key)));
}

TEST_F(JwtVerifierTest, ConcurrentVerificationIsSafe) {
  auto verifier = make();
  const auto token = signEs256(key);
  std::atomic<int> accepted{0};
  std::vector<std::thread> threads;
  for (int t = 0; t < 8; ++t) {
    threads.emplace_back([&] {
      for (int i = 0; i < 25; ++i) {
        if (verifier.verify(token)) ++accepted;
      }
    });
  }
  for (auto& thread : threads) thread.join();
  EXPECT_EQ(accepted.load(), 200);
  EXPECT_EQ(fetcher->calls(), 1);
}
```

- [ ] **Step 3: Run the build to verify it fails**

Run: `cmake --build --preset debug`
Expected: FAIL. The compiler reports `auth/jwks.h` and `auth/jwt_verifier.h` as not found.

- [ ] **Step 4: Write `backend/src/auth/auth_user.h`**

```cpp
#pragma once

#include <nlohmann/json.hpp>
#include <string>

namespace tradeai::auth {

// Identity from a verified Supabase access token.
struct AuthUser {
  std::string id;         // `sub` claim (auth.users.id)
  std::string role;       // `role` claim, normally "authenticated"
  nlohmann::json claims;  // full verified payload, forwarded to Postgres for RLS
};

}  // namespace tradeai::auth
```

- [ ] **Step 5: Write `backend/src/auth/jwks.h`**

```cpp
#pragma once

#include <string>
#include <string_view>
#include <unordered_map>

namespace tradeai::auth {

struct PublicKey {
  std::string alg;  // "ES256" or "RS256"
  std::string pem;
};

using KeySet = std::unordered_map<std::string, PublicKey>;  // by `kid`

// Parses a JWKS document. Keys without a kid or of an unsupported type/curve
// are skipped. Throws on malformed JSON or a missing "keys" array.
KeySet parseJwks(std::string_view body);

class JwksFetcher {
 public:
  virtual ~JwksFetcher() = default;
  // Returns the raw JWKS JSON. Throws on any failure.
  virtual std::string fetch() = 0;
};

class HttpJwksFetcher final : public JwksFetcher {
 public:
  explicit HttpJwksFetcher(std::string url) : url_(std::move(url)) {}
  std::string fetch() override;

 private:
  std::string url_;
};

}  // namespace tradeai::auth
```

- [ ] **Step 6: Write `backend/src/auth/jwks.cpp`**

```cpp
#include "auth/jwks.h"

#include <cpr/cpr.h>

#include <jwt-cpp/traits/nlohmann-json/defaults.h>
#include <nlohmann/json.hpp>
#include <stdexcept>

namespace tradeai::auth {

KeySet parseJwks(std::string_view body) {
  const auto doc = nlohmann::json::parse(body);
  KeySet keys;
  for (const auto& k : doc.at("keys")) {
    const auto kid = k.value("kid", std::string{});
    if (kid.empty()) continue;
    const auto kty = k.value("kty", std::string{});
    if (kty == "EC" && k.value("crv", std::string{}) == "P-256") {
      keys[kid] = {"ES256", jwt::helper::create_public_key_from_ec_components(
                                "P-256", k.at("x").get<std::string>(), k.at("y").get<std::string>())};
    } else if (kty == "RSA") {
      keys[kid] = {"RS256", jwt::helper::create_public_key_from_rsa_components(
                                k.at("n").get<std::string>(), k.at("e").get<std::string>())};
    }
  }
  return keys;
}

std::string HttpJwksFetcher::fetch() {
  const auto res = cpr::Get(cpr::Url{url_}, cpr::Timeout{5000});
  if (res.error || res.status_code != 200) {
    throw std::runtime_error("JWKS fetch failed: status " + std::to_string(res.status_code) +
                             " " + res.error.message);
  }
  return res.text;
}

}  // namespace tradeai::auth
```

(If the installed jwt-cpp version names these helpers differently, look in `vcpkg_installed/*/include/jwt-cpp/jwt.h`, namespace `jwt::helper`, for the `create_public_key_from_ec_components(curve, x, y)` / `create_public_key_from_rsa_components(n, e)` overloads that take base64url strings, and use those.)

- [ ] **Step 7: Write `backend/src/auth/jwt_verifier.h`**

```cpp
#pragma once

#include <chrono>
#include <expected>
#include <functional>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>

#include "auth/auth_user.h"
#include "auth/jwks.h"

namespace tradeai::auth {

enum class AuthError {
  MissingToken,
  Malformed,
  UnsupportedAlgorithm,
  UnknownKey,
  KeysUnavailable,
  InvalidToken,  // bad signature or failed exp/iss/aud/sub checks
};

std::string_view toString(AuthError error);

struct JwtVerifierOptions {
  std::string issuer;
  std::string audience = "authenticated";
  std::optional<std::string> hs256Secret;
  std::chrono::seconds keyCacheTtl{600};
  std::chrono::seconds unknownKidCooldown{30};
  std::chrono::seconds leeway{30};
};

// Verifies Supabase access tokens: ES256/RS256 against the project's JWKS
// (cached), or HS256 against the legacy secret when configured. Thread-safe.
class JwtVerifier {
 public:
  using Clock = std::function<std::chrono::steady_clock::time_point()>;

  JwtVerifier(JwtVerifierOptions options, std::shared_ptr<JwksFetcher> fetcher,
              Clock clock = std::chrono::steady_clock::now);
  JwtVerifier(const JwtVerifier&) = delete;
  JwtVerifier& operator=(const JwtVerifier&) = delete;

  std::expected<AuthUser, AuthError> verify(std::string_view token);

 private:
  std::expected<PublicKey, AuthError> keyFor(const std::string& kid);

  JwtVerifierOptions options_;
  std::shared_ptr<JwksFetcher> fetcher_;
  Clock clock_;

  std::shared_mutex mutex_;
  KeySet keys_;
  std::optional<std::chrono::steady_clock::time_point> fetchedAt_;    // last successful fetch
  std::optional<std::chrono::steady_clock::time_point> lastAttempt_;  // last fetch attempt
};

}  // namespace tradeai::auth
```

- [ ] **Step 8: Write `backend/src/auth/jwt_verifier.cpp`**

```cpp
#include "auth/jwt_verifier.h"

#include <crow/logging.h>

#include <jwt-cpp/traits/nlohmann-json/defaults.h>
#include <mutex>

namespace tradeai::auth {

std::string_view toString(AuthError error) {
  switch (error) {
    case AuthError::MissingToken: return "missing token";
    case AuthError::Malformed: return "malformed token";
    case AuthError::UnsupportedAlgorithm: return "unsupported algorithm";
    case AuthError::UnknownKey: return "unknown signing key";
    case AuthError::KeysUnavailable: return "signing keys unavailable";
    case AuthError::InvalidToken: return "invalid token";
  }
  return "unknown";
}

JwtVerifier::JwtVerifier(JwtVerifierOptions options, std::shared_ptr<JwksFetcher> fetcher,
                         Clock clock)
    : options_(std::move(options)), fetcher_(std::move(fetcher)), clock_(std::move(clock)) {}

std::expected<PublicKey, AuthError> JwtVerifier::keyFor(const std::string& kid) {
  const auto now = clock_();
  const auto lookup = [&]() -> std::optional<PublicKey> {
    auto it = keys_.find(kid);
    if (it == keys_.end()) return std::nullopt;
    return it->second;
  };
  const auto isFresh = [&] { return fetchedAt_ && now - *fetchedAt_ < options_.keyCacheTtl; };

  {
    std::shared_lock lock(mutex_);
    if (isFresh()) {
      if (auto key = lookup()) return *key;
    }
  }

  std::unique_lock lock(mutex_);
  // Another thread may have refreshed the keys while we waited for the lock.
  if (isFresh()) {
    if (auto key = lookup()) return *key;
  }
  const bool coolingDown = lastAttempt_ && now - *lastAttempt_ < options_.unknownKidCooldown;
  if (!coolingDown) {
    lastAttempt_ = now;
    try {
      keys_ = parseJwks(fetcher_->fetch());
      fetchedAt_ = now;
    } catch (const std::exception& e) {
      CROW_LOG_WARNING << "[jwks] refresh failed: " << e.what();
    }
  }
  // Falls back to stale keys if a refresh failed or is rate-limited.
  if (auto key = lookup()) return *key;
  return std::unexpected(fetchedAt_ ? AuthError::UnknownKey : AuthError::KeysUnavailable);
}

std::expected<AuthUser, AuthError> JwtVerifier::verify(std::string_view token) {
  if (token.empty()) return std::unexpected(AuthError::MissingToken);
  try {
    const auto decoded = jwt::decode(std::string(token));
    auto verifier = jwt::verify();
    verifier.with_issuer(options_.issuer)
        .with_audience(options_.audience)
        .leeway(static_cast<std::size_t>(options_.leeway.count()));

    const auto alg = decoded.get_algorithm();
    if (alg == "HS256") {
      if (!options_.hs256Secret) return std::unexpected(AuthError::UnsupportedAlgorithm);
      verifier.allow_algorithm(jwt::algorithm::hs256{*options_.hs256Secret});
    } else if (alg == "ES256" || alg == "RS256") {
      if (!decoded.has_key_id()) return std::unexpected(AuthError::UnknownKey);
      const auto key = keyFor(decoded.get_key_id());
      if (!key) return std::unexpected(key.error());
      if (key->alg != alg) return std::unexpected(AuthError::UnsupportedAlgorithm);
      if (alg == "ES256") {
        verifier.allow_algorithm(jwt::algorithm::es256(key->pem, "", "", ""));
      } else {
        verifier.allow_algorithm(jwt::algorithm::rs256(key->pem, "", "", ""));
      }
    } else {
      return std::unexpected(AuthError::UnsupportedAlgorithm);
    }

    std::error_code ec;
    verifier.verify(decoded, ec);
    if (ec) return std::unexpected(AuthError::InvalidToken);
    if (!decoded.has_expires_at() || !decoded.has_subject() || decoded.get_subject().empty()) {
      return std::unexpected(AuthError::InvalidToken);
    }

    nlohmann::json claims = decoded.get_payload_json();
    return AuthUser{decoded.get_subject(), claims.value("role", std::string{}), std::move(claims)};
  } catch (const std::exception&) {
    return std::unexpected(AuthError::Malformed);
  }
}

}  // namespace tradeai::auth
```

- [ ] **Step 9: Build and run the tests**

Run: `cmake --build --preset debug && ctest --preset debug`
Expected: all `ParseJwks.*` and `JwtVerifierTest.*` tests PASS, along with the earlier tests.

- [ ] **Step 10: Commit**

```bash
cd .. && git add backend
git commit -m "feat(backend): Supabase JWT verification with cached JWKS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend
```

---

### Task 4: Postgres pool with RLS-scoped transactions

**Files:**
- Create: `backend/src/db/pg_pool.h`, `backend/src/db/pg_pool.cpp`, `backend/docker-compose.yml`, `backend/tests/integration/fixture.sql`, `backend/tests/support/db_fixture.h`
- Test: `backend/tests/unit/pg_pool_test.cpp`, `backend/tests/integration/pg_pool_integration_test.cpp`

**Interfaces:**
- Consumes: `auth::AuthUser` (Task 3), `db::PoolTimeout` (Task 2)
- Produces:
  - `class tradeai::db::PgPool(std::string connectionString, std::size_t size, std::chrono::milliseconds acquireTimeout = 5s)`, which is not copyable
  - `template <class F> auto withUserTx(const auth::AuthUser&, F&& fn)`, where `fn(pqxx::work&)` runs as role `authenticated` with `request.jwt.claims` set
  - `template <class F> auto withServiceTx(F&& fn)`, which runs as the connection's own role
  - Both return `fn`'s result, commit on success, and roll back and rethrow on exception
  - Test support: `std::optional<std::string> testDatabaseUrl()`, `std::string readFixtureSql()`, `auth::AuthUser testUser(const std::string& sub, nlohmann::json extraClaims = {})`, `kUserA`, `kUserB`

- [ ] **Step 1: Create `backend/docker-compose.yml`**

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

- [ ] **Step 2: Create `backend/tests/integration/fixture.sql`**

It mirrors the Supabase pieces that RLS relies on: the `authenticated` role, plus an `auth.uid()` that reads `request.jwt.claims`.

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

- [ ] **Step 3: Create `backend/tests/support/db_fixture.h`**

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

- [ ] **Step 4: Write the failing tests**

`backend/tests/unit/pg_pool_test.cpp` (no database needed):

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

`backend/tests/integration/pg_pool_integration_test.cpp`:

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

- [ ] **Step 5: Run the build to verify it fails**

Run: `cmake --build --preset debug`
Expected: FAIL. The compiler reports `db/pg_pool.h` as not found.

- [ ] **Step 6: Write `backend/src/db/pg_pool.h`**

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

- [ ] **Step 7: Write `backend/src/db/pg_pool.cpp`**

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

- [ ] **Step 8: Build and run the unit tests (integration tests skip)**

Run: `cmake --build --preset debug && ctest --preset debug`
Expected: the `PgPool.*` tests PASS, and the `PgPoolIntegration.*` tests are reported as skipped.

- [ ] **Step 9: Run the integration tests against Postgres**

```bash
docker compose up -d --wait
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres ctest --preset debug
```

Expected: all tests PASS, including the 7 `PgPoolIntegration.*` tests.

- [ ] **Step 10: Commit**

```bash
cd .. && git add backend
git commit -m "feat(backend): libpqxx pool with RLS-scoped user transactions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend
```

---

### Task 5: Middleware, system routes, and the server binary

**Files:**
- Create: `backend/src/http/middleware.h`, `backend/src/http/middleware.cpp`, `backend/src/routes/system.h`, `backend/src/routes/system.cpp`, `backend/src/app_setup.h`, `backend/src/app_setup.cpp`
- Replace: `backend/src/main.cpp`
- Test: `backend/tests/unit/server_test.cpp`, `backend/tests/integration/me_integration_test.cpp`

**Interfaces:**
- Consumes: `http::ok/fail/guarded`, `auth::bearerToken`, `auth::JwtVerifier`, `db::PgPool`, `config::Config`, plus the test support from Tasks 3 and 4
- Produces:
  - `struct tradeai::http::RequestIdMiddleware`, `struct tradeai::http::AuthMiddleware { auth::JwtVerifier* verifier; }`
  - `using tradeai::http::App = crow::App<RequestIdMiddleware, AuthMiddleware>;`
  - `const auth::AuthUser& tradeai::http::currentUser(App&, const crow::request&)`
  - `crow::response tradeai::routes::healthz()`, `readyz(db::PgPool&)`, `me(db::PgPool&, const auth::AuthUser&)`, `void registerSystemRoutes(http::App&, db::PgPool&)`
  - `void tradeai::setupApp(http::App&, auth::JwtVerifier&, db::PgPool&)`. Every later sub-project registers its routes here.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/server_test.cpp` (starts a real server on a fixed port; the database is deliberately unreachable):

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

`backend/tests/integration/me_integration_test.cpp`:

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

- [ ] **Step 2: Run the build to verify it fails**

Run: `cmake --build --preset debug`
Expected: FAIL. The compiler reports `app_setup.h`, `http/middleware.h` and `routes/system.h` as not found.

- [ ] **Step 3: Write `backend/src/http/middleware.h`**

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

- [ ] **Step 4: Write `backend/src/http/middleware.cpp`**

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

- [ ] **Step 5: Write `backend/src/routes/system.h`**

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

- [ ] **Step 6: Write `backend/src/routes/system.cpp`**

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

- [ ] **Step 7: Write `backend/src/app_setup.h` and `backend/src/app_setup.cpp`**

```cpp
// app_setup.h
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

```cpp
// app_setup.cpp
#include "app_setup.h"

#include "routes/system.h"

namespace tradeai {

void setupApp(http::App& app, auth::JwtVerifier& verifier, db::PgPool& pool) {
  app.get_middleware<http::AuthMiddleware>().verifier = &verifier;
  routes::registerSystemRoutes(app, pool);
}

}  // namespace tradeai
```

- [ ] **Step 8: Replace `backend/src/main.cpp`**

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

- [ ] **Step 9: Build and run all tests**

```bash
cmake --build --preset debug && ctest --preset debug
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres ctest --preset debug
```

Expected: all `ServerTest.*` tests PASS in both runs. The `MeIntegration.*` tests are skipped in the first run and PASS in the second.

- [ ] **Step 10: Smoke-test the binary**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres SUPABASE_URL=https://example.supabase.co ./build/debug/tradeai_api &
curl -s localhost:8080/healthz    # {"data":{"status":"ok"},"success":true}
curl -s localhost:8080/readyz     # {"data":{"status":"ready"},"success":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/me   # 401
kill %1
```

Also confirm that a missing env var exits with code 1: `./build/debug/tradeai_api; echo $?` should print `[config] missing required env var DATABASE_URL` and then `1`.

- [ ] **Step 11: Commit**

```bash
cd .. && git add backend
git commit -m "feat(backend): auth middleware, /healthz /readyz /me, server binary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend
```

---

### Task 6: Docker image, Fly config, and the local dev script

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `backend/fly.toml`, `backend/.env.example`
- Modify: `package.json` (add a `dev:api` script)

**Interfaces:**
- Consumes: the `release` preset and the `TRADEAI_BUILD_TESTS` option (Task 1), and the `tradeai_api` binary (Task 5)
- Produces: the image `tradeai-api` listening on 8080, and `npm run dev:api`

- [ ] **Step 1: Create `backend/.dockerignore`**

```
build/
vcpkg_installed/
.env
```

- [ ] **Step 2: Create `backend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM debian:trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake ninja-build git curl zip unzip tar pkg-config \
      autoconf autoconf-archive automake libtool bison flex perl python3 linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/microsoft/vcpkg /opt/vcpkg \
    && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics
ENV VCPKG_ROOT=/opt/vcpkg
# Needed on arm64 Linux hosts; harmless on x86_64.
ENV VCPKG_FORCE_SYSTEM_BINARIES=1

WORKDIR /src
# Dependencies first so they stay cached across source-only changes.
COPY vcpkg.json ./
RUN /opt/vcpkg/vcpkg install --x-install-root=/src/vcpkg_installed
COPY . .
RUN cmake --preset release -DVCPKG_INSTALLED_DIR=/src/vcpkg_installed -DTRADEAI_BUILD_TESTS=OFF \
    && cmake --build --preset release

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home app
COPY --from=builder /src/build/release/tradeai_api /usr/local/bin/tradeai_api
USER app
EXPOSE 8080
CMD ["/usr/local/bin/tradeai_api"]
```

- [ ] **Step 3: Build the image and smoke-test it**

```bash
docker build -t tradeai-api .
docker run --rm -d --name tradeai-api-smoke -p 8080:8080 \
  -e DATABASE_URL="host=127.0.0.1 port=1" -e SUPABASE_URL=https://example.supabase.co tradeai-api
curl -s localhost:8080/healthz                                 # {"data":{"status":"ok"},"success":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/me     # 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/readyz # 503 (no DB inside container)
docker stop tradeai-api-smoke
```

Expected: the outputs match the comments. The first build compiles every dependency and takes about 20 minutes.

- [ ] **Step 4: Create `backend/fly.toml`**

```toml
app = "tradeai-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/healthz"
    timeout = "5s"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

- [ ] **Step 5: Create `backend/.env.example`**

```bash
PORT=8080
# Supabase → Connect → Session pooler (port 5432). The transaction pooler (6543) also works.
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<project-ref>.supabase.co
# Only for projects still signing with the legacy HS256 secret (Supabase → Project Settings → JWT Keys).
SUPABASE_JWT_SECRET=
ALLOWED_AUDIENCE=authenticated
DB_POOL_SIZE=8
HTTP_THREADS=32
```

- [ ] **Step 6: Add the `dev:api` script to the root `package.json`**

In `"scripts"`, after `"dev"`, add:

```json
    "dev:api": "cd backend && cmake --preset debug && cmake --build --preset debug && set -a && . ./.env && set +a && ./build/debug/tradeai_api",
```

Verify: `cp backend/.env.example backend/.env`, fill in real values (ask the user for them), then run `npm run dev:api` and check that `curl localhost:8080/readyz` returns `{"data":{"status":"ready"},"success":true}`.

- [ ] **Step 7: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/fly.toml backend/.env.example package.json
git commit -m "build(backend): Dockerfile, Fly config, dev:api script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/Dockerfile backend/.dockerignore backend/fly.toml backend/.env.example package.json
```

---

### Task 7: Next.js client helper and rewrite

**Files:**
- Create: `lib/api/core.ts`, `lib/api/client.ts`, `lib/api/server.ts`
- Modify: `next.config.ts` (add `rewrites()` to `nextConfig`), and `CLAUDE.md` (add `CPP_API_URL=` to the env block)
- Test: `lib/api/core.test.ts`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (server); the C++ envelope (Task 2)
- Produces (used by sub-projects 2–5):
  - `type ApiResult<T> = { success: true; data: T } | { success: false; error: string }`
  - `GENERIC_API_ERROR`
  - `requestApi<T>(url: string, token: string | null, init?: RequestInit): Promise<ApiResult<T>>`
  - `apiFetch<T>(path, init?)` (browser, via `/cpp-api`), and `apiFetchServer<T>(path, init?)` (server, via `CPP_API_URL`)

- [ ] **Step 1: Write the failing test `lib/api/core.test.ts`**

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/api/core.test.ts`
Expected: FAIL with `Failed to resolve import "./core"`.

- [ ] **Step 3: Write `lib/api/core.ts`**

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

- [ ] **Step 4: Write `lib/api/client.ts`**

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

- [ ] **Step 5: Write `lib/api/server.ts`**

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

- [ ] **Step 6: Run the tests**

Run: `npx vitest run lib/api/core.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 7: Add the rewrite in `next.config.ts`**

In `nextConfig`, directly after the `serverExternalPackages` line, add:

```ts
  // Browser calls to the C++ API go through the same origin (no CORS); see lib/api/client.ts.
  async rewrites() {
    const cppApiUrl = process.env.CPP_API_URL
    return cppApiUrl ? [{ source: '/cpp-api/:path*', destination: `${cppApiUrl}/:path*` }] : []
  },
```

- [ ] **Step 8: Document the env var in `CLAUDE.md`**

In the `## Env Variables (.env.local)` code block, add the line `CPP_API_URL=` after `TWELVE_DATA_API_KEY=`.

- [ ] **Step 9: Run the full Next checks**

Run: `npm test && npm run lint && npm run build`
Expected: all three succeed, and no existing test regresses.

- [ ] **Step 10: Verify locally end to end**

1. Add `CPP_API_URL=http://localhost:8080` to `.env.local` (ask the user, since this edits their env file).
2. In one terminal run `npm run dev:api`, and in another run `npm run dev`.
3. Get an access token for a real test account. Ask the user for the credentials, and don't echo the password into logs:
   ```bash
   TOKEN=$(curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
     -d '{"email":"<test email>","password":"<test password>"}' | jq -r .access_token)
   curl -s localhost:3000/cpp-api/me -H "Authorization: Bearer $TOKEN"
   ```
Expected: `{"data":{"id":"<that user's uuid>"},"success":true}`, which matches the user's id in Supabase → Authentication → Users. Without the header, the result is a 401 envelope.

If the result is 401 and the C++ log shows `[auth] rejected: unknown signing key` or `signing keys unavailable`, the project still uses the legacy HS256 secret. Set `SUPABASE_JWT_SECRET` in `backend/.env` and try again.

- [ ] **Step 11: Commit**

```bash
git add lib/api next.config.ts CLAUDE.md
git commit -m "feat: apiFetch helpers and /cpp-api rewrite for the C++ backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- lib/api next.config.ts CLAUDE.md
```

---

### Task 8: Deploy to Fly and verify from Vercel

**Outward-facing:** every command in this task publishes something or changes production config. **Stop and get the user's explicit go-ahead before Step 2**, and let the user run any command that needs their account login or secrets. Never paste secrets into the chat or into a commit.

**Files:**
- Modify: `backend/fly.toml` (only if `fly launch` assigns a different app name)

- [ ] **Step 1: Install flyctl and log in (user)**

```bash
brew install flyctl
fly auth login
```

- [ ] **Step 2: Create the app and set secrets (user confirms)**

```bash
cd backend
fly launch --no-deploy --copy-config --name tradeai-api   # pick another name if taken; keep fly.toml in sync
fly secrets set DATABASE_URL='<session pooler URL>' SUPABASE_URL='https://<ref>.supabase.co'
# only if the project uses the legacy HS256 secret:
fly secrets set SUPABASE_JWT_SECRET='<secret>'
```

- [ ] **Step 3: Deploy and check health**

```bash
fly deploy
curl -s https://<app>.fly.dev/healthz   # {"data":{"status":"ok"},"success":true}
curl -s https://<app>.fly.dev/readyz    # {"data":{"status":"ready"},"success":true}
```

- [ ] **Step 4: Point Vercel at it (user confirms)**

Add `CPP_API_URL=https://<app>.fly.dev` to the Vercel project's Production (and Preview) env vars, using the dashboard or `vercel env add CPP_API_URL production`, then redeploy.

- [ ] **Step 5: Verify success criterion 3**

Using `TOKEN` from Task 7 Step 10:

```bash
curl -s https://<vercel-domain>/cpp-api/me -H "Authorization: Bearer $TOKEN"
```

Expected: `{"data":{"id":"<that user's uuid>"},"success":true}`.

- [ ] **Step 6: Commit any fly.toml change**

```bash
git add backend/fly.toml
git commit -m "chore(backend): set Fly app name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- backend/fly.toml
```

(Skip this step if `fly.toml` is unchanged.)
