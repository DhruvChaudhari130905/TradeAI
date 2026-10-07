#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <memory>
#include <mutex>
#include <pqxx/pqxx>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "auth/auth_user.h"
#include "db/pool_timeout.h"

namespace tradeai::db {

// Fixed-size libpqxx connection pool. Connections open lazily; broken ones are
// dropped and reopened on demand.
class PgPool {
 public:
  PgPool(std::string connectionString, std::size_t size,
         std::chrono::milliseconds acquireTimeout = std::chrono::seconds{5});
  PgPool(const PgPool&) = delete;
  PgPool& operator=(const PgPool&) = delete;

  // Runs fn(pqxx::work&) as role `authenticated` with the user's verified JWT
  // claims set, so RLS policies using auth.uid() apply. Both settings are
  // transaction-local and reset when the transaction ends.
  template <class F>
  auto withUserTx(const auth::AuthUser& user, F&& fn) {
    return run([&](pqxx::work& tx) {
      tx.exec("SET LOCAL ROLE authenticated");
      tx.exec("SELECT set_config('request.jwt.claims', $1, true)", pqxx::params{user.claims.dump()});
      return fn(tx);
    });
  }

  // Runs fn(pqxx::work&) as the connection's own role. Bypasses RLS: only use
  // where the TypeScript code used the Supabase service-role client.
  template <class F>
  auto withServiceTx(F&& fn) {
    return run(std::forward<F>(fn));
  }

 private:
  struct Lease {
    Lease(PgPool& pool, std::unique_ptr<pqxx::connection> conn) : pool(pool), conn(std::move(conn)) {}
    ~Lease() { pool.release(std::move(conn), broken); }
    Lease(const Lease&) = delete;
    Lease& operator=(const Lease&) = delete;

    PgPool& pool;
    std::unique_ptr<pqxx::connection> conn;
    bool broken = false;
  };

  template <class F>
  auto run(F&& fn) {
    using Result = std::invoke_result_t<F&, pqxx::work&>;
    Lease lease(*this, acquire());
    try {
      pqxx::work tx(*lease.conn);
      if constexpr (std::is_void_v<Result>) {
        fn(tx);
        tx.commit();
      } else {
        Result result = fn(tx);
        tx.commit();
        return result;
      }
    } catch (const pqxx::broken_connection&) {
      lease.broken = true;
      throw;
    }
  }

  std::unique_ptr<pqxx::connection> acquire();
  void release(std::unique_ptr<pqxx::connection> conn, bool broken) noexcept;

  std::string connectionString_;
  std::size_t size_;
  std::chrono::milliseconds acquireTimeout_;

  std::mutex mutex_;
  std::condition_variable available_;
  std::vector<std::unique_ptr<pqxx::connection>> idle_;
  std::size_t open_ = 0;  // idle + leased + currently connecting
};

}  // namespace tradeai::db
