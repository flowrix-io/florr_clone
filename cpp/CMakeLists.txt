cmake_minimum_required(VERSION 3.16)
project(flowrix_cpp LANGUAGES CXX)

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
add_library(flix_shared STATIC
  shared/core/world.cpp
  shared/core/json.cpp
  shared/core/process_stats.cpp
  shared/net/transport.cpp
  shared/game/rarity.cpp
  shared/game/config.cpp
  shared/game/skin_format.cpp
  shared/game/map_elements.cpp
  shared/game/terrain.cpp
  shared/game/spatial.cpp
)
target_include_directories(flix_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# --- server ------------------------------------------------------------------
add_library(flix_server STATIC
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
target_link_libraries(flix_server PUBLIC flix_shared)

add_executable(flowrix_server server/main.cpp)
target_link_libraries(flowrix_server PRIVATE flix_server)

# --- client ------------------------------------------------------------------
add_library(flix_client STATIC
  client/app.cpp
  client/net_client.cpp
  client/prediction.cpp
  client/world_view.cpp
  client/ui/draw.cpp
  client/ui/text.cpp
  client/ui/menu_widgets.cpp
  client/ui/menus.cpp
  client/ui/menu_inventory.cpp
  client/ui/menu_crafting.cpp
  client/ui/menu_gallery.cpp
  client/ui/menu_guild.cpp
  client/ui/menu_talents.cpp
  client/ui/menu_shop.cpp
  client/ui/menu_skins.cpp
  client/ui/menu_leaderboard.cpp
  client/ui/menu_notifications.cpp
  client/ui/menu_changelog.cpp
  client/ui/menu_settings.cpp
  client/ui/tutorial.cpp
  client/render/sprites.cpp
  client/render/world_renderer.cpp
)
target_link_libraries(flix_client PUBLIC flix_shared cpp_canvas)

add_executable(flowrix_client client/main.cpp)
target_link_libraries(flowrix_client PRIVATE flix_client)

# --- runtime data ------------------------------------------------------------
# The browser build loads these exact faces from Google Fonts. Stage pinned
# copies for the native client so its typography does not depend on whatever
# sans-serif happens to be installed on the host OS.
set(FLIX_DATA_DIR ${CMAKE_CURRENT_BINARY_DIR}/data)
file(MAKE_DIRECTORY ${FLIX_DATA_DIR})
set(FLIX_GOOGLE_FONTS_REV ade3d1533e06b2b1462ffcde8e08b129627ca360)
set(FLIX_GOOGLE_FONTS_ROOT
    "https://raw.githubusercontent.com/google/fonts/${FLIX_GOOGLE_FONTS_REV}/ufl/ubuntu")

function(flix_stage_font filename sha256)
  set(destination "${FLIX_DATA_DIR}/${filename}")
  if(EXISTS "${destination}")
    file(SHA256 "${destination}" existing_hash)
    if(existing_hash STREQUAL sha256)
      return()
    endif()
  endif()
  file(DOWNLOAD "${FLIX_GOOGLE_FONTS_ROOT}/${filename}" "${destination}"
       EXPECTED_HASH "SHA256=${sha256}" TLS_VERIFY ON STATUS download_status)
  list(GET download_status 0 download_code)
  list(GET download_status 1 download_message)
  if(NOT download_code EQUAL 0)
    message(FATAL_ERROR "Could not stage ${filename}: ${download_message}")
  endif()
endfunction()

flix_stage_font(Ubuntu-Regular.ttf
               3128df86a31805618436d0ae5651ba4285d0c9de0a39057d025f64ee33bceb64)
flix_stage_font(Ubuntu-Bold.ttf
               679b5c1e09cab3156bb8ef529735f9382bf31ca7ac737382ab959297f8d82ad4)

# The src data stays the single source of truth; stage it beside the binaries
# so both programs find one content directory.
add_custom_target(flix_data ALL
  COMMAND ${CMAKE_COMMAND} -E make_directory ${FLIX_DATA_DIR}
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/mobs.json
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/petals.json
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/mob_drops.json
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/map_bundle.ts
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/land.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/desert.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/ocean.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/hel.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/ant_hell.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/sewers.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/../src/jungle.svg
          ${CMAKE_CURRENT_SOURCE_DIR}/data/mob_xp.json
          ${FLIX_DATA_DIR}/
  COMMENT "Staging game content")
add_dependencies(flowrix_server flix_data)
add_dependencies(flowrix_client flix_data)

# --- tools -------------------------------------------------------------------
add_executable(svg_smoke tools/svg_smoke.cpp)
target_link_libraries(svg_smoke PRIVATE flix_shared cpp_canvas)

add_executable(behavior_oracle tools/behavior_oracle.cpp)
target_link_libraries(behavior_oracle PRIVATE flix_server)

# --- tests -------------------------------------------------------------------
enable_testing()
# Globbed deliberately: tests are added often and a stale list is a test that
# silently stops running. CONFIGURE_DEPENDS re-globs when the directory changes.
file(GLOB FLIX_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)
add_executable(flix_tests ${FLIX_TEST_SOURCES})
# Tests cover both halves, including the end-to-end ones that run a real
# server and real clients over loopback.
target_link_libraries(flix_tests PRIVATE flix_server flix_client)
target_compile_definitions(flix_tests PRIVATE FLIX_TEST_DATA_DIR="${FLIX_DATA_DIR}")
add_dependencies(flix_tests flix_data)
add_test(NAME flix_tests COMMAND flix_tests)
