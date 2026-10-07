#pragma once

#include "auth/jwt_verifier.h"
#include "db/pg_pool.h"
#include "http/middleware.h"

namespace tradeai {

// Wires middleware dependencies and registers every route. Shared by main and tests;
// later sub-projects add their register*Routes calls here.
void setupApp(http::App& app, auth::JwtVerifier& verifier, db::PgPool& pool);

}  // namespace tradeai
