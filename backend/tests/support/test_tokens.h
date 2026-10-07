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
