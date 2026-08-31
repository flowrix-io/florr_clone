cmake_minimum_required(VERSION 3.16)
project(florr_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

add_compile_options(-Wall -Wextra -Wno-unused-parameter)

find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)

# --- cpp_canvas: the vendored Canvas2D-alike renderer ------------------------
# Upstream ships it as a demo executable; built as a library here so both the
# client and the render tools can link it.
add_library(cpp_canvas STATIC
  third_party/cpp_canvas/canvas.cpp
  third_party/cpp_canvas/svg.cpp
  third_party/cpp_canvas/font.cpp
  third_party/cpp_canvas/window.cpp
)
target_include_directories(cpp_canvas PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/third_party/cpp_canvas)
target_compile_options(cpp_canvas PRIVATE -w)   # third-party: not ours to lint
target_link_libraries(cpp_canvas PUBLIC PkgConfig::SDL2)

# --- shared: engine core linked by both binaries -----------------------------
add_library(flr_shared STATIC
  shared/core/world.cpp
  shared/core/json.cpp
  shared/net/transport.cpp
  shared/game/rarity.cpp
  shared/game/config.cpp
  shared/game/terrain.cpp
  shared/game/spatial.cpp
)
target_include_directories(flr_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# --- server ------------------------------------------------------------------
add_library(flr_server STATIC
  server/game_server.cpp
  server/replication.cpp
  server/session.cpp
  server/db.cpp
  server/crypto.cpp
  server/systems/movement.cpp
  server/systems/mob_ai.cpp
  server/systems/petals.cpp
  server/systems/combat.cpp
  server/systems/spawning.cpp
  server/systems/loot.cpp
)
target_link_libraries(flr_server PUBLIC flr_shared)

add_executable(florr_server server/main.cpp)
target_link_libraries(florr_server PRIVATE flr_server)

# --- client ------------------------------------------------------------------
add_library(flr_client STATIC
  client/app.cpp
  client/net_client.cpp
  client/prediction.cpp
  client/world_view.cpp
  client/ui/draw.cpp
  client/ui/text.cpp
  client/render/sprites.cpp
  client/render/world_renderer.cpp
)
target_link_libraries(flr_client PUBLIC flr_shared cpp_canvas)

add_executable(florr_client client/main.cpp)
target_link_libraries(florr_client PRIVATE flr_client)

# --- runtime data ------------------------------------------------------------
# src/*.json stays the single source of truth; this stages it beside the
# binaries so both programs find one content directory.
add_custom_target(flr_data ALL
  COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/data
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/mobs.json
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/petals.json
          ${CMAKE_CURRENT_SOURCE_DIR}/data/mob_xp.json
          ${CMAKE_CURRENT_BINARY_DIR}/data/
  COMMENT "Staging game content")
add_dependencies(florr_server flr_data)
add_dependencies(florr_client flr_data)

# --- tools -------------------------------------------------------------------
add_executable(svg_smoke tools/svg_smoke.cpp)
target_link_libraries(svg_smoke PRIVATE flr_shared cpp_canvas)

# --- tests -------------------------------------------------------------------
enable_testing()
# Globbed deliberately: tests are added often and a stale list is a test that
# silently stops running. CONFIGURE_DEPENDS re-globs when the directory changes.
file(GLOB FLR_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)
add_executable(flr_tests ${FLR_TEST_SOURCES})
# Tests cover both halves, including the end-to-end ones that run a real
# server and real clients over loopback.
target_link_libraries(flr_tests PRIVATE flr_server flr_client)
add_test(NAME flr_tests COMMAND flr_tests)
