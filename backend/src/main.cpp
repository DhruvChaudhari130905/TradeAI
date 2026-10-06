#include <iostream>

#include "config/config.h"

int main() {
  auto cfg = tradeai::config::Config::fromEnv();
  if (!cfg) {
    std::cerr << "[config] " << cfg.error() << '\n';
    return 1;
  }
  std::cout << "[config] loaded, port " << cfg->port << '\n';
  return 0;
}
