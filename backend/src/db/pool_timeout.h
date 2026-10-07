#pragma once

#include <stdexcept>

namespace tradeai::db {

// Thrown when no database connection becomes free within the acquire timeout.
struct PoolTimeout : std::runtime_error {
  using std::runtime_error::runtime_error;
};

}  // namespace tradeai::db
