#include <gtest/gtest.h>

#include <atomic>
#include <thread>
#include <vector>

#include "auth/jwt_verifier.h"
#include "support/fake_jwks.h"
#include "support/test_tokens.h"

using namespace tradeai;
using namespace tradeai::testing;
using auth::AuthError;
using auth::JwtVerifier;
using namespace std::chrono_literals;

namespace {

void expectError(const std::expected<auth::AuthUser, AuthError>& result, AuthError expected) {
  ASSERT_FALSE(result) << "expected failure, got user " << result->id;
  EXPECT_EQ(result.error(), expected) << "got " << auth::toString(result.error());
}

class JwtVerifierTest : public ::testing::Test {
 protected:
  JwtVerifierTest()
      : key(makeEcKey("key-1")), fetcher(std::make_shared<FakeJwksFetcher>(jwksJson({key}))) {}

  JwtVerifier make(std::optional<std::string> secret = std::nullopt) {
    return JwtVerifier({.issuer = kIssuer, .hs256Secret = std::move(secret)}, fetcher,
                       [this] { return now; });
  }

  EcTestKey key;
  std::shared_ptr<FakeJwksFetcher> fetcher;
  std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
};

}  // namespace

TEST_F(JwtVerifierTest, AcceptsValidEs256Token) {
  auto verifier = make();
  auto user = verifier.verify(signEs256(key));
  ASSERT_TRUE(user) << auth::toString(user.error());
  EXPECT_EQ(user->id, kSubject);
  EXPECT_EQ(user->role, "authenticated");
  EXPECT_EQ(user->claims.at("sub"), kSubject);
}

TEST_F(JwtVerifierTest, AcceptsHs256WhenSecretConfigured) {
  auto verifier = make("test-secret");
  auto user = verifier.verify(signHs256("test-secret"));
  ASSERT_TRUE(user) << auth::toString(user.error());
  EXPECT_EQ(user->id, kSubject);
}

TEST_F(JwtVerifierTest, RejectsHs256WithoutSecret) {
  auto verifier = make();
  expectError(verifier.verify(signHs256("test-secret")), AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsHs256WithWrongSecret) {
  auto verifier = make("test-secret");
  expectError(verifier.verify(signHs256("other-secret")), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsExpiredToken) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.expiresIn = -600s})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, AcceptsRecentlyExpiredTokenWithinLeeway) {
  auto verifier = make();
  EXPECT_TRUE(verifier.verify(signEs256(key, {.expiresIn = -10s})));
}

TEST_F(JwtVerifierTest, RejectsWrongIssuer) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.issuer = "https://evil.example/auth/v1"})),
              AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsWrongAudience) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.audience = "anon"})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsEmptySubject) {
  auto verifier = make();
  expectError(verifier.verify(signEs256(key, {.subject = ""})), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsSignatureFromAnotherKey) {
  auto other = makeEcKey("key-2");
  fetcher->setBody(jwksJson({key, other}));
  auto verifier = make();
  auto forged = other;
  forged.kid = "key-1";  // signed by key-2's private key, claims to be key-1
  expectError(verifier.verify(signEs256(forged)), AuthError::InvalidToken);
}

TEST_F(JwtVerifierTest, RejectsAlgNone) {
  auto verifier = make();
  expectError(verifier.verify(rawToken({{"alg", "none"}, {"typ", "JWT"}})),
              AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsAlgorithmKeyTypeMismatch) {
  auto verifier = make();
  expectError(verifier.verify(rawToken({{"alg", "RS256"}, {"kid", "key-1"}})),
              AuthError::UnsupportedAlgorithm);
}

TEST_F(JwtVerifierTest, RejectsMalformedAndEmptyTokens) {
  auto verifier = make();
  expectError(verifier.verify("not.a.jwt"), AuthError::Malformed);
  expectError(verifier.verify(""), AuthError::MissingToken);
}

TEST_F(JwtVerifierTest, CachesKeysWithinTtl) {
  auto verifier = make();
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  EXPECT_EQ(fetcher->calls(), 1);
}

TEST_F(JwtVerifierTest, RefetchesAfterTtl) {
  auto verifier = make();
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  now += 11min;
  ASSERT_TRUE(verifier.verify(signEs256(key)));
  EXPECT_EQ(fetcher->calls(), 2);
}

TEST_F(JwtVerifierTest, UnknownKidRefetchIsRateLimited) {
  auto verifier = make();
  auto rotated = makeEcKey("key-2");
  expectError(verifier.verify(signEs256(rotated)), AuthError::UnknownKey);
  expectError(verifier.verify(signEs256(rotated)), AuthError::UnknownKey);
  EXPECT_EQ(fetcher->calls(), 1);

  fetcher->setBody(jwksJson({key, rotated}));
  now += 31s;
  EXPECT_TRUE(verifier.verify(signEs256(rotated)));
  EXPECT_EQ(fetcher->calls(), 2);
}

TEST_F(JwtVerifierTest, RecoversAfterJwksOutage) {
  auto verifier = make();
  fetcher->setFailing(true);
  expectError(verifier.verify(signEs256(key)), AuthError::KeysUnavailable);

  fetcher->setFailing(false);
  now += 31s;
  EXPECT_TRUE(verifier.verify(signEs256(key)));
}

TEST_F(JwtVerifierTest, ConcurrentVerificationIsSafe) {
  auto verifier = make();
  const auto token = signEs256(key);
  std::atomic<int> accepted{0};
  std::vector<std::thread> threads;
  for (int t = 0; t < 8; ++t) {
    threads.emplace_back([&] {
      for (int i = 0; i < 25; ++i) {
        if (verifier.verify(token)) ++accepted;
      }
    });
  }
  for (auto& thread : threads) thread.join();
  EXPECT_EQ(accepted.load(), 200);
  EXPECT_EQ(fetcher->calls(), 1);
}
