#include "support/test_tokens.h"

#include <openssl/bn.h>
#include <openssl/core_names.h>
#include <openssl/evp.h>
#include <openssl/pem.h>

#include <jwt-cpp/traits/nlohmann-json/defaults.h>
#include <stdexcept>

namespace tradeai::testing {
namespace {

std::string b64url(const std::string& raw) {
  return jwt::base::trim<jwt::alphabet::base64url>(
      jwt::base::encode<jwt::alphabet::base64url>(raw));
}

std::string bioToString(BIO* bio) {
  BUF_MEM* mem = nullptr;
  BIO_get_mem_ptr(bio, &mem);
  return {mem->data, mem->length};
}

std::string coordinate(EVP_PKEY* key, const char* param) {
  BIGNUM* bn = nullptr;
  if (EVP_PKEY_get_bn_param(key, param, &bn) != 1) throw std::runtime_error("EVP_PKEY_get_bn_param");
  std::string out(32, '\0');
  BN_bn2binpad(bn, reinterpret_cast<unsigned char*>(out.data()), 32);
  BN_free(bn);
  return b64url(out);
}

auto baseBuilder(const TokenSpec& spec) {
  const auto now = std::chrono::system_clock::now();
  return jwt::create()
      .set_type("JWT")
      .set_issuer(spec.issuer)
      .set_audience(spec.audience)
      .set_subject(spec.subject)
      .set_issued_at(now)
      .set_expires_at(now + spec.expiresIn)
      .set_payload_claim("role", jwt::claim(spec.role));
}

}  // namespace

EcTestKey makeEcKey(std::string kid) {
  EVP_PKEY* key = EVP_EC_gen("P-256");
  if (key == nullptr) throw std::runtime_error("EVP_EC_gen");
  BIO* priv = BIO_new(BIO_s_mem());
  BIO* pub = BIO_new(BIO_s_mem());
  PEM_write_bio_PrivateKey(priv, key, nullptr, nullptr, 0, nullptr, nullptr);
  PEM_write_bio_PUBKEY(pub, key);
  EcTestKey out{std::move(kid), bioToString(priv), bioToString(pub),
                coordinate(key, OSSL_PKEY_PARAM_EC_PUB_X), coordinate(key, OSSL_PKEY_PARAM_EC_PUB_Y)};
  BIO_free(priv);
  BIO_free(pub);
  EVP_PKEY_free(key);
  return out;
}

std::string jwksJson(const std::vector<EcTestKey>& keys) {
  nlohmann::json doc{{"keys", nlohmann::json::array()}};
  for (const auto& k : keys) {
    doc["keys"].push_back({{"kty", "EC"}, {"crv", "P-256"}, {"kid", k.kid}, {"x", k.x},
                           {"y", k.y}, {"alg", "ES256"}, {"use", "sig"}});
  }
  return doc.dump();
}

std::string signEs256(const EcTestKey& key, const TokenSpec& spec) {
  return baseBuilder(spec).set_key_id(key.kid).sign(
      jwt::algorithm::es256(key.publicPem, key.privatePem, "", ""));
}

std::string signHs256(const std::string& secret, const TokenSpec& spec) {
  return baseBuilder(spec).sign(jwt::algorithm::hs256{secret});
}

std::string rawToken(const nlohmann::json& header, const TokenSpec& spec) {
  const auto exp = std::chrono::duration_cast<std::chrono::seconds>(
                       (std::chrono::system_clock::now() + spec.expiresIn).time_since_epoch())
                       .count();
  const nlohmann::json payload{{"iss", spec.issuer}, {"aud", spec.audience}, {"sub", spec.subject},
                               {"role", spec.role},  {"exp", exp}};
  return b64url(header.dump()) + "." + b64url(payload.dump()) + ".c2ln";
}

}  // namespace tradeai::testing
