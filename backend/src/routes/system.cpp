#include "routes/system.h"

#include "http/response.h"

namespace tradeai::routes {

crow::response healthz() { return http::ok({{"status", "ok"}}); }

crow::response readyz(db::PgPool& pool) {
  try {
    pool.withServiceTx([](pqxx::work& tx) { tx.exec("SELECT 1"); });
    return http::ok({{"status", "ready"}});
  } catch (const std::exception& e) {
    CROW_LOG_WARNING << "[readyz] " << e.what();
    return http::fail(503, http::kUnavailableError);
  }
}

crow::response me(db::PgPool& pool, const auth::AuthUser& user) {
  return http::guarded("[me]", [&] {
    const auto id = pool.withUserTx(user, [](pqxx::work& tx) {
      return tx.query_value<std::string>("select auth.uid()::text");
    });
    return http::ok({{"id", id}});
  });
}

void registerSystemRoutes(http::App& app, db::PgPool& pool) {
  CROW_ROUTE(app, "/healthz").methods(crow::HTTPMethod::GET)([] { return healthz(); });
  CROW_ROUTE(app, "/readyz").methods(crow::HTTPMethod::GET)([&pool] { return readyz(pool); });
  CROW_ROUTE(app, "/me").methods(crow::HTTPMethod::GET)([&app, &pool](const crow::request& req) {
    return me(pool, http::currentUser(app, req));
  });
}

}  // namespace tradeai::routes
