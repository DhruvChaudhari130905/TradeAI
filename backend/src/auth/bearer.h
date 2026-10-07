#pragma once

#include <optional>
#include <string_view>

namespace tradeai::auth {

// Extracts the token from an `Authorization: Bearer <token>` header value.
// The scheme match is case-insensitive and surrounding whitespace is ignored.
std::optional<std::string_view> bearerToken(std::string_view header);

}  // namespace tradeai::auth
