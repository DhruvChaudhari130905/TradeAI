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
