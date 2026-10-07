#pragma once

#include <crow.h>

#include <chrono>
#include <optional>
#include <string>

#include "auth/auth_user.h"
#include "auth/jwt_verifier.h"

namespace tradeai::http {

// Assigns or propagates X-Request-Id and logs one line per request.
struct RequestIdMiddleware {
  struct context {
    std::string id;
    std::chrono::steady_clock::time_point start;
  };
  void before_handle(crow::request& req, crow::response& res, context& ctx);
  void after_handle(crow::request& req, crow::response& res, context& ctx);
};

// Requires a valid Supabase Bearer token on every route except /healthz and /readyz.
struct AuthMiddleware {
  struct context {
    std::optional<auth::AuthUser> user;
  };
  auth::JwtVerifier* verifier = nullptr;  // set by setupApp()

  void before_handle(crow::request& req, crow::response& res, context& ctx);
  void after_handle(crow::request&, crow::response&, context&) {}
};

using App = crow::App<RequestIdMiddleware, AuthMiddleware>;

// The authenticated user for a request that passed AuthMiddleware.
const auth::AuthUser& currentUser(App& app, const crow::request& req);

}  // namespace tradeai::http
