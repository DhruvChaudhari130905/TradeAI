cmake_minimum_required(VERSION 3.25)
project(tradeai_api LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(TRADEAI_SANITIZE "Build with ASan/UBSan" OFF)
option(TRADEAI_BUILD_TESTS "Build the test suite" ON)

if(TRADEAI_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

find_package(Crow CONFIG REQUIRED)
find_package(libpqxx CONFIG REQUIRED)
find_package(cpr CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(jwt-cpp CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

# Every .cpp under src/ except main.cpp is library code shared by the server and the tests.
file(GLOB_RECURSE TRADEAI_CORE_SOURCES CONFIGURE_DEPENDS src/*.cpp)
list(REMOVE_ITEM TRADEAI_CORE_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp)

add_library(tradeai_core STATIC ${TRADEAI_CORE_SOURCES})
target_include_directories(tradeai_core PUBLIC src)
target_compile_definitions(tradeai_core PUBLIC JWT_DISABLE_PICOJSON)
target_compile_options(tradeai_core PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(tradeai_core PUBLIC
  Crow::Crow libpqxx::pqxx cpr::cpr nlohmann_json::nlohmann_json jwt-cpp::jwt-cpp
  OpenSSL::SSL OpenSSL::Crypto)

add_executable(tradeai_api src/main.cpp)
target_link_libraries(tradeai_api PRIVATE tradeai_core)

if(TRADEAI_BUILD_TESTS)
  enable_testing()
  find_package(GTest CONFIG REQUIRED)
  file(GLOB_RECURSE TRADEAI_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
  add_executable(tradeai_tests ${TRADEAI_TEST_SOURCES})
  target_include_directories(tradeai_tests PRIVATE tests)
  target_compile_definitions(tradeai_tests PRIVATE
    TRADEAI_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/integration")
  target_link_libraries(tradeai_tests PRIVATE tradeai_core GTest::gtest_main)
  include(GoogleTest)
  gtest_discover_tests(tradeai_tests DISCOVERY_TIMEOUT 30)
endif()
