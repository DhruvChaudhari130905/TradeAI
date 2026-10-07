#include "auth/jwks.h"

#include <cpr/cpr.h>
#include <crow/logging.h>

#include <jwt-cpp/traits/nlohmann-json/defaults.h>
#include <nlohmann/json.hpp>
#include <stdexcept>

namespace tradeai::auth {

KeySet parseJwks(std::string_view body) {
  const auto doc = nlohmann::json::parse(body);
  KeySet keys;
  for (const auto& k : doc.at("keys")) {
    // One malformed key must not discard the rest of the set.
    try {
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
    } catch (const std::exception& e) {
      CROW_LOG_WARNING << "[jwks] skipping malformed key: " << e.what();
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
