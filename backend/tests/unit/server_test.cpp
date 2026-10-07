#include <gtest/gtest.h>

#include <cpr/cpr.h>

#include <future>
#include <nlohmann/json.hpp>

#include "app_setup.h"
#include "auth/jwt_verifier.h"
#include "db/pg_pool.h"
#include "http/middleware.h"
#include "support/fake_jwks.h"
#include "support/test_tokens.h"

using namespace std::chrono_literals;
using namespace tradeai;

namespace {

class ServerTest : public ::testing::Test {
 protected:
  static constexpr std::uint16_t kPort = 18089;

  void SetUp() override {
    setupApp(app, verifier, pool);
    app.loglevel(crow::LogLevel::Warning);
    server = app.port(kPort).concurrency(2).run_async();
    app.wait_for_server_start();
  }

  void TearDown() override {
    app.stop();
    server.wait();
  }

  static std::string url(const std::string& path) {
    return "http://127.0.0.1:" + std::to_string(kPort) + path;
  }

  auth::JwtVerifier verifier{{.issuer = tradeai::testing::kIssuer, .hs256Secret = "test-secret"},
                             std::make_shared<tradeai::testing::FakeJwksFetcher>(R"({"keys":[]})")};
  db::PgPool pool{"host=127.0.0.1 port=1 connect_timeout=1", 1, 200ms};
  http::App app;
  std::future<void> server;
};

}  // namespace

TEST_F(ServerTest, HealthzNeedsNoAuth) {
  auto res = cpr::Get(cpr::Url{url("/healthz")});
  EXPECT_EQ(res.status_code, 200);
  EXPECT_EQ(nlohmann::json::parse(res.text).at("data").at("status"), "ok");
  EXPECT_FALSE(res.header["X-Request-Id"].empty());
}

TEST_F(ServerTest, EchoesValidRequestId) {
  auto res = cpr::Get(cpr::Url{url("/healthz")}, cpr::Header{{"X-Request-Id", "abc-123"}});
  EXPECT_EQ(res.header["X-Request-Id"], "abc-123");
}

TEST_F(ServerTest, ReplacesUnsafeRequestId) {
  auto res = cpr::Get(cpr::Url{url("/healthz")}, cpr::Header{{"X-Request-Id", "bad id;<>"}});
  EXPECT_NE(res.header["X-Request-Id"], "bad id;<>");
  EXPECT_FALSE(res.header["X-Request-Id"].empty());
}

TEST_F(ServerTest, MeWithoutTokenIs401) {
  auto res = cpr::Get(cpr::Url{url("/me")});
  EXPECT_EQ(res.status_code, 401);
  EXPECT_EQ(nlohmann::json::parse(res.text),
            (nlohmann::json{{"success", false}, {"error", "Not authenticated"}}));
}

TEST_F(ServerTest, MeWithInvalidTokenIs401) {
  auto res = cpr::Get(cpr::Url{url("/me")}, cpr::Bearer{"not.a.jwt"});
  EXPECT_EQ(res.status_code, 401);
}

TEST_F(ServerTest, MeWithValidTokenButDatabaseDownIsGeneric500) {
  auto res = cpr::Get(cpr::Url{url("/me")}, cpr::Bearer{tradeai::testing::signHs256("test-secret")});
  EXPECT_EQ(res.status_code, 500);
  EXPECT_EQ(nlohmann::json::parse(res.text).at("error"), "Something went wrong. Please try again.");
}

TEST_F(ServerTest, ReadyzWhenDatabaseDownIs503) {
  auto res = cpr::Get(cpr::Url{url("/readyz")});
  EXPECT_EQ(res.status_code, 503);
}
