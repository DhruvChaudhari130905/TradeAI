# Task 3 — JWKS parsing and JwtVerifier (type-it-yourself guide)

**Goal:** the C++ server can decide, on its own, whether a Supabase access token is real. It downloads Supabase's public signing keys (the **JWKS** — "JSON Web Key Set"), caches them, checks the token's signature and its claims (issuer, audience, expiry, subject), and hands back an `AuthUser`. A JWKS outage must give "not authenticated" (never a crash), and verification must recover once the keys are reachable again.

All paths below are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/backend/`. The files already exist (empty) — open each one and type the code in.

| #   | File                                | What it is                                                  |
| --- | ----------------------------------- | ----------------------------------------------------------- |
| 1   | `tests/support/fake_jwks.h`         | A pretend key server for tests (can simulate an outage)     |
| 2   | `tests/support/test_tokens.h`       | Declarations: make test keys and sign test tokens           |
| 3   | `tests/support/test_tokens.cpp`     | Implementation of the above, using OpenSSL + jwt-cpp        |
| 4   | `tests/unit/jwks_test.cpp`          | Tests for reading a JWKS document                           |
| 5   | `tests/unit/jwt_verifier_test.cpp`  | Tests for token verification, caching, outages, threads     |
| 6   | `src/auth/auth_user.h`              | `AuthUser` — who the request belongs to                     |
| 7   | `src/auth/jwks.h`                   | `parseJwks()`, `JwksFetcher`, `HttpJwksFetcher` declarations |
| 8   | `src/auth/jwks.cpp`                 | JWKS parsing + the real HTTP fetch                          |
| 9   | `src/auth/jwt_verifier.h`           | `JwtVerifier` class, `AuthError` enum                       |
| 10  | `src/auth/jwt_verifier.cpp`         | The verification logic + key cache                          |

Order: test helpers (1–3), tests (4–5), see the build fail, then the code (6–10), see it pass.

**Background in one paragraph.** A JWT is three base64url chunks: `header.payload.signature`. The header says which algorithm signed it (`alg`) and which key (`kid`, "key id"). Supabase signs with a private key only it has; anyone can check the signature with the matching **public** key, published at `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. Older Supabase projects instead sign with a shared secret (HS256) — we support that too, but only if you configure the secret.

---

## File 1 — `tests/support/fake_jwks.h`

The verifier gets its keys from a `JwksFetcher` (defined in File 7). In tests we don't want real HTTP, so this fake returns a string we choose, counts how many times it was called (to prove caching works), and can be switched into "failing" mode to simulate Supabase being down.

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

**How to read it**

- `class FakeJwksFetcher final : public auth::JwksFetcher` — inherits the interface; `final` means nobody can inherit from *this* class.
- `override` — tells the compiler "this replaces a virtual function from the parent". If the signature doesn't match exactly, you get a compile error instead of a silent bug.
- `explicit` on the constructor — stops C++ from silently converting a plain `std::string` into a `FakeJwksFetcher`.
- `std::mutex` + `std::lock_guard lock(mutex_);` — a lock that is held until the end of the `{}` block, then released automatically. Needed because one test calls `fetch()` from 8 threads at once.
- `std::atomic<int>` — an integer that's safe to `++` from many threads without a lock.
- `std::move(body)` — hands over the string's memory instead of copying it.

---

## File 2 — `tests/support/test_tokens.h`

Helpers that let tests create real, correctly signed tokens — and deliberately broken ones.

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

**How to read it**

- `EcTestKey` — an elliptic-curve key pair (the kind Supabase uses, "ES256"). `x` and `y` are the public key's coordinates; that's how a JWKS document describes an EC key.
- PEM — the `-----BEGIN PUBLIC KEY-----` text format for keys.
- `TokenSpec` with default values — every field has a sensible "valid token" default. A test overrides just the one thing it wants to break, e.g. `{.expiresIn = -600s}` (already expired 10 minutes ago).
- `const TokenSpec& spec = {}` — "if you don't pass one, use a default-constructed spec".

---

## File 3 — `tests/support/test_tokens.cpp`

The OpenSSL code that generates keys, plus jwt-cpp code that signs tokens. This is the most "C-library" file in the whole task — you don't need to memorise it, it's test plumbing.

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

**How to read it**

- `#include <jwt-cpp/traits/nlohmann-json/defaults.h>` — jwt-cpp can use different JSON libraries; this include picks nlohmann (the one we use everywhere). CMake also defines `JWT_DISABLE_PICOJSON` so the other one never sneaks in.
- `b64url` — base64url-encode and strip the `=` padding (JWTs use the unpadded form).
- **Manual memory management.** OpenSSL is a C library: every `..._new` / `EVP_EC_gen` must be paired with a `..._free`. In normal app code we'd wrap these in smart pointers; in test helpers the explicit frees are fine.
- `BIO` — OpenSSL's "in-memory file". We write the PEM text into it, then copy it out as a `std::string`.
- `BN_bn2binpad(..., 32)` — a P-256 coordinate is exactly 32 bytes; padding keeps leading zero bytes so the encoding is always correct.
- `auto baseBuilder(...)` — returns jwt-cpp's builder object; `auto` saves us from spelling its long template type.
- `rawToken` — builds a token by hand with **any** header we want (e.g. `"alg":"none"`) and a fake signature `c2ln` ("sig" in base64). Used to prove the verifier rejects attack-shaped tokens.

---

## File 4 — `tests/unit/jwks_test.cpp`

Reading the JWKS document: keep the keys we can use, skip the rest, throw on garbage.

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

**How to read it**

- `ASSERT_EQ` vs `EXPECT_EQ` — `ASSERT_*` stops the test immediately on failure. Used before `keys.at("k1")`, which would throw if the map were empty.
- `1u` / `0u` — unsigned literals, so they compare cleanly with `size()` (which is unsigned) without a warning.
- `pem.rfind("-----BEGIN PUBLIC KEY-----", 0) == 0` — the classic C++ "starts with" idiom (search backwards starting at index 0).
- `R"( ... )"` — a **raw string**: quotes and newlines inside need no escaping. Perfect for inline JSON.
- `EXPECT_ANY_THROW(expr)` — passes only if `expr` throws something.

---

## File 5 — `tests/unit/jwt_verifier_test.cpp`

The big one. Each test is one rule of token verification. Read the test names — together they are the spec.

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


// this is the line i ended at oct 7 12:53am
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

**How to read it**

- `class JwtVerifierTest : public ::testing::Test` + `TEST_F(JwtVerifierTest, ...)` — a **fixture**: every `TEST_F` gets a fresh copy of the class (new key, new fake fetcher). `F` = fixture.
- **Fake clock.** `make()` passes `[this] { return now; }` as the verifier's clock. Tests then "travel in time" with `now += 11min;` instead of actually sleeping. `11min`, `31s`, `-600s` come from `std::chrono_literals`.
- `{.issuer = kIssuer, .hs256Secret = ...}` — **designated initializers** (C++20): set fields by name, like a JS object literal. Fields you skip keep their defaults.
- `std::expected<AuthUser, AuthError>` — "either a user, or an error" (like a `Result` type). `ASSERT_TRUE(user)` checks it holds a user; `user->id` reads it; `user.error()` reads the error.
- `<< "message"` after an assertion — extra text printed only if it fails. Very handy when debugging.
- Interesting tests:
  - `RejectsSignatureFromAnotherKey` — a token *claiming* to be signed by key-1 but actually signed by key-2 must fail. This is the core security property.
  - `RejectsAlgNone` — the famous JWT attack where `alg: none` means "no signature needed". We must refuse it.
  - `UnknownKidRefetchIsRateLimited` — a token with an unknown `kid` triggers at most one refetch per 30 s, so an attacker can't make us hammer Supabase.
  - `ConcurrentVerificationIsSafe` — 8 threads × 25 verifications = 200 accepted, and the keys were fetched exactly once.

### ✋ Checkpoint — see it fail

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug
```

Expected: **compile errors** — `auth/jwks.h` and `auth/jwt_verifier.h` are empty, so `JwksFetcher`, `JwtVerifier`, `AuthError` etc. don't exist yet. Correct. Now write the code.

---

## File 6 — `src/auth/auth_user.h`

The result of a successful verification. Every authenticated route receives one of these.

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

**How to read it**

- `claims` keeps the **whole** token payload. In Task 4 we hand it to Postgres as `request.jwt.claims`, which is exactly what Supabase's own `auth.uid()` reads. That's how your existing RLS policies keep working unchanged.

---

## File 7 — `src/auth/jwks.h`

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

**How to read it**

- `using KeySet = std::unordered_map<...>` — a type alias, like `type KeySet = Record<string, PublicKey>` in TS.
- `virtual std::string fetch() = 0;` — a **pure virtual** function: `JwksFetcher` is an interface. The real server uses `HttpJwksFetcher`; tests use `FakeJwksFetcher`. This is dependency injection, C++ style.
- `virtual ~JwksFetcher() = default;` — any class meant to be used through a base pointer needs a virtual destructor, otherwise deleting a `FakeJwksFetcher` via a `JwksFetcher*` wouldn't run the child's cleanup.

---

## File 8 — `src/auth/jwks.cpp`

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

**How to read it**

- `doc.at("keys")` — throws if the key is missing (that's the `{"nokeys":true}` test). `doc["keys"]` would silently create it instead — avoid `[]` when reading.
- `k.value("kid", std::string{})` — "the `kid` field, or an empty string if absent". Safe read with a default.
- `create_public_key_from_ec_components` — jwt-cpp turns the JWKS `x`/`y` (or RSA `n`/`e`) numbers into the PEM text its verifier wants. (Already checked: these helper names exist in the jwt-cpp version vcpkg installed.)
- `cpr::Get(...)` — cpr is the C++ equivalent of `fetch()`/axios. `cpr::Timeout{5000}` = 5 seconds, so a hung Supabase can't hang our server.
- On failure we **throw** — the verifier (File 10) catches it and falls back to cached keys.

---

## File 9 — `src/auth/jwt_verifier.h`

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

**How to read it**

- `enum class AuthError` — a scoped enum: you must write `AuthError::Malformed`, and it won't silently convert to an int. The client always just sees "Not authenticated"; these values are for our logs.
- `JwtVerifierOptions` defaults — keys cached 10 minutes (`keyCacheTtl`), at most one refetch per 30 s (`unknownKidCooldown`), and 30 s of clock-skew tolerance on expiry (`leeway`).
- `using Clock = std::function<...>` — the clock is injectable. Production passes the real `steady_clock::now`; tests pass a lambda returning their fake `now`. `steady_clock` never jumps backwards (unlike wall-clock time), which is what you want for "how long ago".
- `std::shared_ptr<JwksFetcher>` — shared ownership. The test keeps a pointer to the same fake so it can flip it to "failing" after building the verifier.
- `= delete` on copy — the class holds a mutex, which can't be copied. Deleting copy makes misuse a compile error. (Because of this the fixture's `make()` relies on C++17 *guaranteed copy elision*: returning a freshly constructed object never copies it.)
- `std::shared_mutex` — a reader/writer lock. Many threads can read the cache at once (`shared_lock`); only a refresh needs exclusive access (`unique_lock`).

---

## File 10 — `src/auth/jwt_verifier.cpp`

Two parts: `keyFor()` (find the public key for a `kid`, refreshing the cache when needed) and `verify()` (the checks).

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

**How to read it — `keyFor()`**

1. **Fast path (shared lock):** if the cache is fresh and has the `kid`, return it. Many threads can be here at once.
2. **Slow path (unique lock):** check again — while we waited for the exclusive lock, another thread may already have refreshed (this is "double-checked locking").
3. Refresh **only if** we haven't tried in the last 30 s. A failed fetch is logged, not thrown.
4. Look up again. Even if the refresh failed we may still have *stale* keys from before — use them (that's what keeps the site up during a short JWKS blip).
5. Nothing found → `UnknownKey` if we've ever fetched successfully, otherwise `KeysUnavailable`.

- `[&]() -> std::optional<PublicKey> {...}` — a lambda capturing local variables by reference (`&`), with an explicit return type.
- `std::unexpected(err)` — how you return the *error* side of a `std::expected`.

**How to read it — `verify()`**

- **We choose the algorithm, not the token.** We read `alg` from the header, but only allow it if it's one we support *and* (for ES256/RS256) it matches the key's type. That's what blocks `alg: none` and "key confusion" attacks.
- `verifier.verify(decoded, ec)` — jwt-cpp checks signature, issuer, audience and expiry (with leeway). The `std::error_code` overload reports failure through `ec` instead of throwing.
- We additionally require `exp` and a non-empty `sub` — a token without either is never acceptable.
- The whole thing sits in `try { } catch (const std::exception&)` because `jwt::decode` throws on garbage input → `Malformed`.
- `CROW_LOG_WARNING` from `<crow/logging.h>` — just the logger, without pulling all of Crow into this file. Notice we log `e.what()` for the fetch error only — never the token itself.

---

## ✅ Build and test

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
export VCPKG_ROOT=$HOME/vcpkg
cmake --build --preset debug && ctest --preset debug
```

Expected: all tests pass — the 24 from Tasks 1–2, plus 4 `ParseJwks.*` + 18 `JwtVerifierTest.*` = **46**.

`ConcurrentVerificationIsSafe` runs under AddressSanitizer/UBSan in the debug preset, so if you mistyped a lock it may show up there as a sanitizer report rather than a plain test failure. If something fails, paste the error and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="backend/src/auth/auth_user.h backend/src/auth/jwks.h backend/src/auth/jwks.cpp backend/src/auth/jwt_verifier.h backend/src/auth/jwt_verifier.cpp backend/tests/support/fake_jwks.h backend/tests/support/test_tokens.h backend/tests/support/test_tokens.cpp backend/tests/unit/jwks_test.cpp backend/tests/unit/jwt_verifier_test.cpp"
git add $FILES
git commit -m "feat(backend): Supabase JWT verification with cached JWKS" -- $FILES
```

(The `-- $FILES` part commits only these 10 files, so your staged deletions and the empty files for later tasks stay out of this commit.)
