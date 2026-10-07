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
