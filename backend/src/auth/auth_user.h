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
