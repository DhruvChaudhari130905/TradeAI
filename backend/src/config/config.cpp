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
