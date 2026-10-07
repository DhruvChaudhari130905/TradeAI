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
