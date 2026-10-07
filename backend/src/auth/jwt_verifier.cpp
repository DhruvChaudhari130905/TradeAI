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
