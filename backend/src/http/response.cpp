#include "http/response.h"

#include <string>

namespace tradeai::http {
namespace {

crow::response json(int status, const nlohmann::json& body) {
  crow::response res(status, body.dump());
  res.set_header("Content-Type", "application/json");
  return res;
}

}  // namespace

crow::response ok(const nlohmann::json& data, int status) {
  return json(status, {{"success", true}, {"data", data}});
}

crow::response fail(int status, std::string_view message) {
  return json(status, {{"success", false}, {"error", std::string(message)}});
}

}  // namespace tradeai::http
