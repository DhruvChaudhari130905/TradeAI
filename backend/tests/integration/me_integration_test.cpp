#include <gtest/gtest.h>

#include <nlohmann/json.hpp>
#include <pqxx/pqxx>

#include "db/pg_pool.h"
#include "routes/system.h"
#include "support/db_fixture.h"

using namespace tradeai;
using namespace tradeai::testing;

TEST(MeIntegration, ReturnsAuthUidFromDatabase) {
  auto url = testDatabaseUrl();
  if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
  db::PgPool pool(*url, 1);
  pool.withServiceTx([](pqxx::work& tx) { tx.exec(readFixtureSql()); });

  auto res = routes::me(pool, testUser(kUserA));
  EXPECT_EQ(res.code, 200);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("data").at("id"), kUserA);
}

TEST(MeIntegration, ReadyzIsOkWithDatabase) {
  auto url = testDatabaseUrl();
  if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
  db::PgPool pool(*url, 1);
  EXPECT_EQ(routes::readyz(pool).code, 200);
}
