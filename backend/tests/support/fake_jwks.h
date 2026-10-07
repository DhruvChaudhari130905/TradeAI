#pragma once

#include <atomic>
#include <mutex>
#include <stdexcept>
#include <string>

#include "auth/jwks.h"

namespace tradeai::testing {

// In-memory JwksFetcher: counts calls and can simulate an outage.
class FakeJwksFetcher final : public auth::JwksFetcher {
 public:
  explicit FakeJwksFetcher(std::string body) : body_(std::move(body)) {}

  std::string fetch() override {
    ++calls_;
    std::lock_guard lock(mutex_);
    if (failing_) throw std::runtime_error("jwks unavailable");
    return body_;
  }

  void setBody(std::string body) {
    std::lock_guard lock(mutex_);
    body_ = std::move(body);
  }
  void setFailing(bool failing) {
    std::lock_guard lock(mutex_);
    failing_ = failing;
  }
  int calls() const { return calls_.load(); }

 private:
  std::mutex mutex_;
  std::string body_;
  bool failing_ = false;
  std::atomic<int> calls_{0};
};

}  // namespace tradeai::testing
