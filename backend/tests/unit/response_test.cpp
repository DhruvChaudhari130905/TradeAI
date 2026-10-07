#include <gtest/gtest.h>

#include <nlohmann/json.hpp>
#include <stdexcept>

#include "db/pool_timeout.h"
#include "http/response.h"

using namespace tradeai;

TEST(Response, OkWrapsDataInEnvelope) {
  auto res = http::ok({{"id", "abc"}});
  EXPECT_EQ(res.code, 200);
  EXPECT_EQ(res.get_header_value("Content-Type"), "application/json");
  auto body = nlohmann::json::parse(res.body);
  EXPECT_EQ(body, (nlohmann::json{{"success", true}, {"data", {{"id", "abc"}}}}));
}

TEST(Response, OkAcceptsCustomStatus) {
  EXPECT_EQ(http::ok(nullptr, 201).code, 201);
}

TEST(Response, FailWrapsErrorInEnvelope) {
  auto res = http::fail(400, "bad input");
  EXPECT_EQ(res.code, 400);
  auto body = nlohmann::json::parse(res.body);
  EXPECT_EQ(body, (nlohmann::json{{"success", false}, {"error", "bad input"}}));
}

TEST(Guarded, ReturnsHandlerResponse) {
  auto res = http::guarded("[test]", [] { return http::ok({{"x", 1}}, 202); });
  EXPECT_EQ(res.code, 202);
}

TEST(Guarded, PoolTimeoutBecomes503) {
  auto res = http::guarded("[test]", []() -> crow::response { throw db::PoolTimeout("timeout"); });
  EXPECT_EQ(res.code, 503);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("error"), http::kUnavailableError);
}

TEST(Guarded, StdExceptionBecomesGeneric500WithoutLeakingDetail) {
  auto res = http::guarded("[test]", []() -> crow::response {
    throw std::runtime_error("password=hunter2 in connection string");
  });
  EXPECT_EQ(res.code, 500);
  EXPECT_EQ(nlohmann::json::parse(res.body).at("error"), http::kGenericError);
  EXPECT_EQ(res.body.find("hunter2"), std::string::npos);
}

TEST(Guarded, NonStdExceptionBecomes500) {
  auto res = http::guarded("[test]", []() -> crow::response { throw 42; });
  EXPECT_EQ(res.code, 500);
}
