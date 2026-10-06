#include <gtest/gtest.h>

#include <map>
#include <string>

#include "config/config.h"

using tradeai::config::Config;
using tradeai::config::EnvLookup;

namespace {

EnvLookup envOf(std::map<std::string, std::string> vars) {
  return [vars = std::move(vars)](std::string_view name) -> std::optional<std::string> {
    auto it = vars.find(std::string(name));
    if (it == vars.end()) return std::nullopt;
    return it->second;
  };
}

std::map<std::string, std::string> required() {
  return {{"DATABASE_URL", "postgresql://u:p@localhost/db"},
          {"SUPABASE_URL", "https://abc.supabase.co/"}};
}

}  // namespace

TEST(Config, AppliesDefaults) {
  auto cfg = Config::fromEnv(envOf(required()));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->port, 8080);
  EXPECT_EQ(cfg->dbPoolSize, 8u);
  EXPECT_EQ(cfg->httpThreads, 32u);
  EXPECT_EQ(cfg->allowedAudience, "authenticated");
  EXPECT_FALSE(cfg->supabaseJwtSecret.has_value());
  EXPECT_EQ(cfg->databaseUrl, "postgresql://u:p@localhost/db");
}

TEST(Config, StripsTrailingSlashAndDerivesUrls) {
  auto cfg = Config::fromEnv(envOf(required()));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->supabaseUrl, "https://abc.supabase.co");
  EXPECT_EQ(cfg->issuer(), "https://abc.supabase.co/auth/v1");
  EXPECT_EQ(cfg->jwksUrl(), "https://abc.supabase.co/auth/v1/.well-known/jwks.json");
}

TEST(Config, MissingDatabaseUrlNamesTheVar) {
  auto vars = required();
  vars.erase("DATABASE_URL");
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DATABASE_URL"), std::string::npos);
}

TEST(Config, MissingSupabaseUrlNamesTheVar) {
  auto vars = required();
  vars.erase("SUPABASE_URL");
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("SUPABASE_URL"), std::string::npos);
}

TEST(Config, EmptyValueCountsAsMissing) {
  auto vars = required();
  vars["DATABASE_URL"] = "";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DATABASE_URL"), std::string::npos);
}

TEST(Config, ReadsOverrides) {
  auto vars = required();
  vars["PORT"] = "9000";
  vars["DB_POOL_SIZE"] = "3";
  vars["HTTP_THREADS"] = "4";
  vars["SUPABASE_JWT_SECRET"] = "s3cret";
  vars["ALLOWED_AUDIENCE"] = "custom";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_TRUE(cfg) << cfg.error();
  EXPECT_EQ(cfg->port, 9000);
  EXPECT_EQ(cfg->dbPoolSize, 3u);
  EXPECT_EQ(cfg->httpThreads, 4u);
  EXPECT_EQ(cfg->supabaseJwtSecret, "s3cret");
  EXPECT_EQ(cfg->allowedAudience, "custom");
}

TEST(Config, RejectsNonNumericPort) {
  auto vars = required();
  vars["PORT"] = "80a";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("PORT"), std::string::npos);
}

TEST(Config, RejectsPortAboveRange) {
  auto vars = required();
  vars["PORT"] = "70000";
  ASSERT_FALSE(Config::fromEnv(envOf(vars)));
}

TEST(Config, RejectsZeroPoolSize) {
  auto vars = required();
  vars["DB_POOL_SIZE"] = "0";
  auto cfg = Config::fromEnv(envOf(vars));
  ASSERT_FALSE(cfg);
  EXPECT_NE(cfg.error().find("DB_POOL_SIZE"), std::string::npos);
}
