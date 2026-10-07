#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "auth/jwks.h"
#include "support/test_tokens.h"

using namespace tradeai;

TEST(ParseJwks, ParsesEcP256Key) {
  auto key = tradeai::testing::makeEcKey("k1");
  auto keys = auth::parseJwks(tradeai::testing::jwksJson({key}));
  ASSERT_EQ(keys.size(), 1u);
  EXPECT_EQ(keys.at("k1").alg, "ES256");
  EXPECT_EQ(keys.at("k1").pem.rfind("-----BEGIN PUBLIC KEY-----", 0), 0u);
}

TEST(ParseJwks, SkipsUnsupportedAndKidlessKeys) {
  auto keys = auth::parseJwks(R"({"keys":[
    {"kty":"oct","kid":"sym","k":"c2VjcmV0"},
    {"kty":"EC","crv":"P-384","kid":"p384","x":"AA","y":"AA"},
    {"kty":"EC","crv":"P-256","x":"AA","y":"AA"}
  ]})");
  EXPECT_TRUE(keys.empty());
}

TEST(ParseJwks, EmptyKeySet) { EXPECT_TRUE(auth::parseJwks(R"({"keys":[]})").empty()); }

TEST(ParseJwks, ThrowsOnMalformedJson) {
  EXPECT_ANY_THROW(auth::parseJwks("not json"));
  EXPECT_ANY_THROW(auth::parseJwks(R"({"nokeys":true})"));
}

TEST(ParseJwks, SkipsMalformedKeysButKeepsValidOnes) {
  auto doc = nlohmann::json::parse(tradeai::testing::jwksJson({tradeai::testing::makeEcKey("good")}));
  doc["keys"].push_back({{"kty", "EC"}, {"crv", "P-256"}, {"kid", 5}, {"x", "AA"}, {"y", "AA"}});
  doc["keys"].push_back({{"kty", "EC"}, {"crv", "P-256"}, {"kid", "no-y"}, {"x", "AA"}});
  doc["keys"].push_back({{"kty", "RSA"}, {"kid", "bad-n"}, {"n", 1}, {"e", "AQAB"}});
  auto keys = auth::parseJwks(doc.dump());
  ASSERT_EQ(keys.size(), 1u);
  EXPECT_TRUE(keys.contains("good"));
}
