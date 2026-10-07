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
