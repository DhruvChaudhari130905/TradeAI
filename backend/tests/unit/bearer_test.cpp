#include <gtest/gtest.h>

#include "auth/bearer.h"

using tradeai::auth::bearerToken;

TEST(BearerToken, ParsesStandardHeader) { EXPECT_EQ(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi"); }
TEST(BearerToken, SchemeIsCaseInsensitive) { EXPECT_EQ(bearerToken("bearer abc"), "abc"); }
TEST(BearerToken, IgnoresSurroundingWhitespace) { EXPECT_EQ(bearerToken("  BEARER   abc  "), "abc"); }
TEST(BearerToken, RejectsOtherSchemes) { EXPECT_FALSE(bearerToken("Basic abc")); }
TEST(BearerToken, RejectsMissingToken) {
  EXPECT_FALSE(bearerToken("Bearer"));
  EXPECT_FALSE(bearerToken("Bearer   "));
}
TEST(BearerToken, RejectsSchemeWithoutSeparator) { EXPECT_FALSE(bearerToken("Bearerabc")); }
TEST(BearerToken, RejectsTokenWithInnerSpace) { EXPECT_FALSE(bearerToken("Bearer a b")); }
TEST(BearerToken, RejectsEmptyHeader) { EXPECT_FALSE(bearerToken("")); }
