#pragma once

#include <crow.h>

#include "auth/auth_user.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

namespace tradeai::routes {

crow::response healthz();
crow::response readyz(db::PgPool& pool);
// Returns auth.uid() as seen by Postgres: proves the JWT → RLS chain end to end.
crow::response me(db::PgPool& pool, const auth::AuthUser& user);

void registerSystemRoutes(http::App& app, db::PgPool& pool);

}  // namespace tradeai::routes
