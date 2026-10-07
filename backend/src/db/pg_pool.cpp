#include "db/pg_pool.h"

namespace tradeai::db {

PgPool::PgPool(std::string connectionString, std::size_t size,
               std::chrono::milliseconds acquireTimeout)
    : connectionString_(std::move(connectionString)), size_(size), acquireTimeout_(acquireTimeout) {
  idle_.reserve(size_);
}

std::unique_ptr<pqxx::connection> PgPool::acquire() {
  std::unique_lock lock(mutex_);
  const bool ready = available_.wait_for(lock, acquireTimeout_,
                                         [this] { return !idle_.empty() || open_ < size_; });
  if (!ready) throw PoolTimeout("timed out waiting for a database connection");

  if (!idle_.empty()) {
    auto conn = std::move(idle_.back());
    idle_.pop_back();
    return conn;
  }

  ++open_;
  lock.unlock();
  try {
    return std::make_unique<pqxx::connection>(connectionString_);
  } catch (...) {
    {
      std::lock_guard guard(mutex_);
      --open_;
    }
    available_.notify_one();
    throw;
  }
}

void PgPool::release(std::unique_ptr<pqxx::connection> conn, bool broken) noexcept {
  std::unique_ptr<pqxx::connection> discarded;
  {
    std::lock_guard guard(mutex_);
    if (broken || !conn || !conn->is_open()) {
      discarded = std::move(conn);
      --open_;
    } else {
      idle_.push_back(std::move(conn));
    }
  }
  available_.notify_one();
}

}  // namespace tradeai::db
