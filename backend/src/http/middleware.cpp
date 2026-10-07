#include "http/middleware.h"

#include <algorithm>
#include <cctype>
#include <random>
#include <sstream>
#include <stdexcept>

#include "auth/bearer.h"
#include "http/response.h"

namespace tradeai::http {
namespace {

std::string newRequestId() {
  thread_local std::mt19937_64 rng{std::random_device{}()};
  std::ostringstream out;
  out << std::hex << rng();
  return out.str();
}

bool isSafeRequestId(const std::string& id) {
  return !id.empty() && id.size() <= 128 && std::ranges::all_of(id, [](unsigned char c) {
    return std::isalnum(c) || c == '-' || c == '_';
  });
}

bool isPublic(const std::string& url) { return url == "/healthz" || url == "/readyz"; }

}  // namespace

void RequestIdMiddleware::before_handle(crow::request& req, crow::response&, context& ctx) {
  ctx.start = std::chrono::steady_clock::now();
  auto incoming = req.get_header_value("X-Request-Id");
  ctx.id = isSafeRequestId(incoming) ? std::move(incoming) : newRequestId();
}

void RequestIdMiddleware::after_handle(crow::request& req, crow::response& res, context& ctx) {
  res.set_header("X-Request-Id", ctx.id);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - ctx.start)
                      .count();
  CROW_LOG_INFO << "[http] " << crow::method_name(req.method) << ' ' << req.url << ' ' << res.code
                << ' ' << ms << "ms " << ctx.id;
}

void AuthMiddleware::before_handle(crow::request& req, crow::response& res, context& ctx) {
  if (isPublic(req.url)) return;

  auth::AuthError error = auth::AuthError::MissingToken;
  if (const auto token = auth::bearerToken(req.get_header_value("Authorization"))) {
    auto user = verifier->verify(*token);
    if (user) {
      ctx.user = std::move(*user);
      return;
    }
    error = user.error();
  }
  CROW_LOG_INFO << "[auth] rejected: " << auth::toString(error);
  res = fail(401, "Not authenticated");
  res.end();
}

const auth::AuthUser& currentUser(App& app, const crow::request& req) {
  auto& ctx = app.get_context<AuthMiddleware>(req);
  if (!ctx.user) throw std::logic_error("currentUser called on an unauthenticated route");
  return *ctx.user;
}

}  // namespace tradeai::http
