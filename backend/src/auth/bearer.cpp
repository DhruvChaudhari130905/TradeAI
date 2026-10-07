#include "auth/bearer.h"

#include <cctype>

namespace tradeai::auth {
namespace {

constexpr std::string_view kWhitespace = " \t";

std::string_view trim(std::string_view s) {
  const auto begin = s.find_first_not_of(kWhitespace);
  if (begin == std::string_view::npos) return {};
  const auto end = s.find_last_not_of(kWhitespace);
  return s.substr(begin, end - begin + 1);
}

}  // namespace

std::optional<std::string_view> bearerToken(std::string_view header) {
  constexpr std::string_view scheme = "bearer";
  header = trim(header);
  if (header.size() <= scheme.size()) return std::nullopt;
  for (std::size_t i = 0; i < scheme.size(); ++i) {
    if (std::tolower(static_cast<unsigned char>(header[i])) != scheme[i]) return std::nullopt;
  }
  if (kWhitespace.find(header[scheme.size()]) == std::string_view::npos) return std::nullopt;
  const auto token = trim(header.substr(scheme.size()));
  if (token.empty() || token.find_first_of(kWhitespace) != std::string_view::npos) {
    return std::nullopt;
  }
  return token;
}

}  // namespace tradeai::auth
