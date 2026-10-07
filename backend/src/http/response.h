#pragma once

#include <crow.h>

#include <exception>
#include <nlohmann/json.hpp>
#include <string_view>
#include <utility>

#include "db/pool_timeout.h"

namespace tradeai::http {

inline constexpr std::string_view kGenericError = "Something went wrong. Please try again.";
inline constexpr std::string_view kUnavailableError =
    "Service temporarily unavailable. Please try again.";

crow::response ok(const nlohmann::json& data, int status = 200);
crow::response fail(int status, std::string_view message);

// Runs a handler and converts any exception into the error envelope, so no
// exception detail ever reaches the client.
template <class F>
crow::response guarded(std::string_view routeName, F&& handler) {
  try {
    return std::forward<F>(handler)();
  } catch (const db::PoolTimeout& e) {
    CROW_LOG_WARNING << routeName << " " << e.what();
    return fail(503, kUnavailableError);
  } catch (const std::exception& e) {
    CROW_LOG_ERROR << routeName << " " << e.what();
    return fail(500, kGenericError);
  } catch (...) {
    CROW_LOG_ERROR << routeName << " unknown exception";
    return fail(500, kGenericError);
  }
}

}  // namespace tradeai::http
