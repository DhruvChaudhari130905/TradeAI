# Task 2 — HTTP primitives (type-it-yourself guide)

**Goal:** every response from the C++ server has the same JSON shape, internal error details (like a database password inside an exception message) never reach the browser, and we can read the token out of an `Authorization: Bearer …` header.

All paths below are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/backend/`. The files already exist (empty) — open each one and type the code in.

| #   | File                           | What it is                                 |
| --- | ------------------------------ | ------------------------------------------ |
| 1   | `tests/unit/response_test.cpp` | Tests for the JSON envelope + error guard  |
| 2   | `tests/unit/bearer_test.cpp`   | Tests for reading the Bearer token         |
| 3   | `src/db/pool_timeout.h`        | The "no free DB connection" exception      |
| 4   | `src/http/response.h`          | `ok()`, `fail()`, `guarded()` declarations |
| 5   | `src/http/response.cpp`        | `ok()` / `fail()` implementation           |
| 6   | `src/auth/bearer.h`            | `bearerToken()` declaration                |
| 7   | `src/auth/bearer.cpp`          | `bearerToken()` implementation             |

Order matters: tests first (files 1–2), see the build fail, then the code (files 3–7), see it pass. That's TDD — the test describes what you want before the code exists.

---

## File 1 — `tests/unit/response_test.cpp`

These tests pin two rules:

1. Every response looks like `{"success": true, "data": ...}` or `{"success": false, "error": "..."}`.
2. When code crashes, the browser only ever sees a generic message — the `hunter2` test proves a secret inside an error message never leaks.

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

**How to read it**

- `TEST(Group, Name) { ... }` — one GoogleTest test case.
- `EXPECT_EQ(a, b)` — checks `a == b`; on failure the test fails but keeps running.
- `[] { ... }` — a lambda (inline function), like `() => { ... }` in JS.
- `-> crow::response` — states the lambda's return type. Needed because these lambdas only `throw`, so the compiler can't infer what they'd return.
- `std::string::npos` — means "not found". The last check asserts `hunter2` is nowhere in the body.
- Extra parentheses in `(nlohmann::json{...})` — the commas inside `{}` would otherwise confuse the `EXPECT_EQ` macro into thinking it got more than two arguments.

---

## File 2 — `tests/unit/bearer_test.cpp`

Every odd way a client might send the header, and what we expect back. `bearerToken()` returns an _optional_: the token, or nothing.

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

**How to read it**

- `EXPECT_FALSE(bearerToken(...))` — an empty optional converts to `false`, so this means "no token found".
- `EXPECT_EQ(bearerToken(...), "abc")` — an optional can be compared directly with a value; it's equal only if it holds that value.

### ✋ Checkpoint — see it fail

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --preset debug          # first time in this folder: reinstalls libraries (vcpkg cache makes it faster)
cmake --build --preset debug
```

Expected: **compile errors** — `http/response.h`, `db/pool_timeout.h`, `auth/bearer.h` have no declarations yet (they're empty). That's correct. Now write the code.

---

## File 3 — `src/db/pool_timeout.h`

A custom exception meaning "every database connection is busy and none freed up in time". It lives in its own tiny header so the HTTP code can catch it without pulling in the whole Postgres library (that comes in Task 4).

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

**How to read it**

- `#pragma once` — include this header at most once per compile, even if several files `#include` it.
- `struct PoolTimeout : std::runtime_error` — inherits from the standard exception, so anything catching `std::exception` also catches this.
- `using std::runtime_error::runtime_error;` — "inherit the parent's constructors", so `PoolTimeout("message")` works without writing a constructor yourself.
- `namespace tradeai::db { ... }` — groups names to avoid clashes; full name is `tradeai::db::PoolTimeout`.

---

## File 4 — `src/http/response.h`

The three helpers every route will use: `ok()` for success, `fail()` for errors, and `guarded()` which wraps a route so no exception can escape with its details.

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

**How to read it**

- `inline constexpr std::string_view` — a compile-time constant defined in a header. `inline` lets many `.cpp` files include it without "multiple definition" link errors. These exact strings match what the Next.js frontend already shows users.
- `int status = 200` — a default argument: `ok(data)` means `ok(data, 200)`.
- `template <class F>` — `guarded` works with _any_ callable (lambda, function). Templates must be fully defined in the header because the compiler generates a version per callable type.
- `F&& handler` + `std::forward<F>(handler)()` — "perfect forwarding": accepts the lambda without copying it, then calls it.
- **Catch order matters.** `PoolTimeout` is caught first because it is _also_ a `std::exception` — reversed, the 503 branch would never run. `catch (...)` catches things that aren't exceptions at all (like `throw 42`).
- The real error is **logged** on the server (`CROW_LOG_ERROR`) for you to debug; the client only gets the generic message.

---

## File 5 — `src/http/response.cpp`

The bodies of `ok()` and `fail()`. Both build a JSON object, turn it into a string, and set the `Content-Type` header.

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

**How to read it**

- `namespace { ... }` (no name) — makes `json()` private to this file, like not exporting a function in TS.
- `{{"success", true}, {"data", data}}` — nlohmann's syntax for a JSON object: a list of `{key, value}` pairs.
- `body.dump()` — serialize JSON to a string.
- `std::string(message)` — copies the `string_view` into a real string for the JSON library.
- Notice the default `= 200` is **not** repeated here — defaults go only in the header declaration.

---

## File 6 — `src/auth/bearer.h`

Declares the function that pulls the token out of the `Authorization` header.

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

**How to read it**

- `std::optional<T>` — "a `T`, or nothing". Like `string | null` in TypeScript, but checked by the type system.
- `std::string_view` — a read-only _window_ onto existing text, no copy. The returned token points into the header string you passed in, so it's only valid while that header string is alive (fine here — we use it immediately).

---

## File 7 — `src/auth/bearer.cpp`

The parsing logic, step by step:

1. trim whitespace,
2. check the first 6 characters spell `bearer` (any case),
3. require a space/tab right after (rejects `Bearerabc`),
4. trim what's left,
5. reject it if empty or if it has a space inside.

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

**How to read it**

- `find_first_not_of` / `find_last_not_of` — index of the first/last character that is _not_ whitespace; `npos` if none (string was all spaces → return empty `{}`).
- `substr(start, length)` — on a `string_view` this makes a smaller view, still no copy.
- `std::nullopt` — the "nothing" value of an optional.
- `static_cast<unsigned char>(...)` — classic C++ trap: `tolower()` on a negative `char` (non-ASCII byte) is undefined behaviour, so we convert to unsigned first.
- `header.size() <= scheme.size()` — if the header is just `"Bearer"` (or shorter) there's no room for a token; it also keeps `header[scheme.size()]` from reading past the end.

---

## ✅ Build and test

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug && ctest --preset debug
```

Expected: all tests pass — 9 `Config.*` (from Task 1) + 3 `Response.*` + 4 `Guarded.*` + 8 `BearerToken.*`.

If something fails, paste the error and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="backend/src/db/pool_timeout.h backend/src/http/response.h backend/src/http/response.cpp backend/src/auth/bearer.h backend/src/auth/bearer.cpp backend/tests/unit/response_test.cpp backend/tests/unit/bearer_test.cpp"
git add $FILES
git commit -m "feat(backend): response envelope, guarded handlers, bearer parsing" -- $FILES
```

(The `-- $FILES` part commits only these 7 files, so your staged deletions and the empty files for later tasks stay out of this commit.)
