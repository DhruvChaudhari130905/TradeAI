#include <gtest/gtest.h>

#include <pqxx/pqxx>

#include "db/pg_pool.h"

using namespace std::chrono_literals;
using tradeai::db::PgPool;
using tradeai::db::PoolTimeout;

// Port 1 refuses connections immediately.
constexpr const char* kUnreachable = "host=127.0.0.1 port=1 connect_timeout=1";

TEST(PgPool, FailedConnectDoesNotLeakSlot) {
  PgPool pool(kUnreachable, 1, 200ms);
  auto noop = [](pqxx::work&) {};
  // If the first failure leaked the only slot, the second call would time out instead.
  EXPECT_THROW(pool.withServiceTx(noop), pqxx::broken_connection);
  EXPECT_THROW(pool.withServiceTx(noop), pqxx::broken_connection);
}

TEST(PgPool, PoolTimeoutIsARuntimeError) {
  EXPECT_TRUE((std::is_base_of_v<std::runtime_error, PoolTimeout>));
}
