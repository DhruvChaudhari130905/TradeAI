#include <gtest/gtest.h>

#include <future>
#include <pqxx/pqxx>
#include <string>
#include <vector>

#include "db/pg_pool.h"
#include "support/db_fixture.h"

using namespace std::chrono_literals;
using namespace tradeai::testing;
using tradeai::db::PgPool;
using tradeai::db::PoolTimeout;

namespace {

std::vector<std::string> notesVisibleTo(PgPool& pool, const tradeai::auth::AuthUser& user) {
  return pool.withUserTx(user, [](pqxx::work& tx) {
    std::vector<std::string> notes;
    for (auto row : tx.exec("select note from public.rls_probe order by note")) {
      notes.push_back(row[0].as<std::string>());
    }
    return notes;
  });
}

class PgPoolIntegration : public ::testing::Test {
 protected:
  void SetUp() override {
    url = testDatabaseUrl();
    if (!url) GTEST_SKIP() << "TEST_DATABASE_URL not set";
    pool = std::make_unique<PgPool>(*url, 2, 500ms);
    pool->withServiceTx([](pqxx::work& tx) { tx.exec(readFixtureSql()); });
  }

  std::optional<std::string> url;
  std::unique_ptr<PgPool> pool;
};

}  // namespace

TEST_F(PgPoolIntegration, UserTxSeesOnlyOwnRows) {
  EXPECT_EQ(notesVisibleTo(*pool, testUser(kUserA)), (std::vector<std::string>{"a1", "a2"}));
  EXPECT_EQ(notesVisibleTo(*pool, testUser(kUserB)), (std::vector<std::string>{"b1"}));
}

TEST_F(PgPoolIntegration, UnknownUserSeesNothing) {
  EXPECT_TRUE(notesVisibleTo(*pool, testUser("cccccccc-cccc-cccc-cccc-cccccccccccc")).empty());
}

TEST_F(PgPoolIntegration, AuthUidMatchesSub) {
  auto uid = pool->withUserTx(testUser(kUserA), [](pqxx::work& tx) {
    return tx.query_value<std::string>("select auth.uid()::text");
  });
  EXPECT_EQ(uid, kUserA);
}

TEST_F(PgPoolIntegration, InsertForAnotherUserIsRejected) {
  EXPECT_THROW(pool->withUserTx(testUser(kUserA),
                                [](pqxx::work& tx) {
                                  tx.exec("insert into public.rls_probe (user_id, note) values ($1, 'x')",
                                          pqxx::params{kUserB});
                                }),
               pqxx::sql_error);
}

TEST_F(PgPoolIntegration, ClaimsWithSqlMetacharactersAreSafe) {
  auto user = testUser(kUserA, {{"name", "O'Brien\"; drop table public.rls_probe; --"}});
  EXPECT_EQ(notesVisibleTo(*pool, user), (std::vector<std::string>{"a1", "a2"}));
  auto count = pool->withServiceTx(
      [](pqxx::work& tx) { return tx.query_value<int>("select count(*) from public.rls_probe"); });
  EXPECT_EQ(count, 3);
}

TEST_F(PgPoolIntegration, RoleIsResetAfterUserTx) {
  PgPool single(*url, 1, 500ms);  // one connection, so both calls reuse it
  single.withUserTx(testUser(kUserA), [](pqxx::work&) {});
  auto [role, claims] = single.withServiceTx([](pqxx::work& tx) {
    auto row = tx.exec("select current_user::text, coalesce(current_setting('request.jwt.claims', true), '')")
                   .one_row();
    return std::pair{row[0].as<std::string>(), row[1].as<std::string>()};
  });
  EXPECT_NE(role, "authenticated");
  EXPECT_EQ(claims, "");
}

TEST_F(PgPoolIntegration, ExhaustedPoolTimesOut) {
  PgPool single(*url, 1, 200ms);
  std::promise<void> holding;
  std::promise<void> release;
  auto releaseSignal = release.get_future();
  auto holder = std::async(std::launch::async, [&] {
    single.withServiceTx([&](pqxx::work&) {
      holding.set_value();
      releaseSignal.wait();
    });
  });
  holding.get_future().wait();
  EXPECT_THROW(single.withServiceTx([](pqxx::work&) {}), PoolTimeout);
  release.set_value();
  holder.get();
}
