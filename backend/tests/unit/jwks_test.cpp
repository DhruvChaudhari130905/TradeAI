#include <gtest/gtest.h>

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
