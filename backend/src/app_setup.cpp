#include "app_setup.h"

#include "routes/system.h"

namespace tradeai {

void setupApp(http::App& app, auth::JwtVerifier& verifier, db::PgPool& pool) {
  app.get_middleware<http::AuthMiddleware>().verifier = &verifier;
  routes::registerSystemRoutes(app, pool);
}

}  // namespace tradeai
