#include <cstdint>
#include <iostream>
#include <memory>

#include "app_setup.h"
#include "auth/jwks.h"
#include "auth/jwt_verifier.h"
#include "config/config.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

int main() {
  using namespace tradeai;

  auto cfg = config::Config::fromEnv();
  if (!cfg) {
    std::cerr << "[config] " << cfg.error() << '\n';
    return 1;
  }

  auth::JwtVerifier verifier(
      {.issuer = cfg->issuer(), .audience = cfg->allowedAudience, .hs256Secret = cfg->supabaseJwtSecret},
      std::make_shared<auth::HttpJwksFetcher>(cfg->jwksUrl()));
  db::PgPool pool(cfg->databaseUrl, cfg->dbPoolSize);

  http::App app;
  setupApp(app, verifier, pool);
  app.port(static_cast<std::uint16_t>(cfg->port))
      .concurrency(static_cast<std::uint16_t>(cfg->httpThreads))
      .run();
  return 0;
}
