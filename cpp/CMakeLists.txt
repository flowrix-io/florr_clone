cmake_minimum_required(VERSION 3.16)
project(flowrix_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

add_compile_options(-Wall -Wextra -Wno-unused-parameter)

# --- what the web build is ---------------------------------------------------
# `emcmake cmake ..` sets EMSCRIPTEN and builds ONE target: the client, as a
# page. The server is not portable to it and is not meant to be -- a browser
# tab cannot listen on a port -- so the server, the tools and the test binary
# are all native-only below.
#
# FLIX_WEB_BUILD is what the client compiles differently: the chat tags that
# need a document to mean anything are honoured only where there is one. See
# client/ui/markup.h.
if(EMSCRIPTEN)
  # SDL comes from emscripten's own port rather than the host's pkg-config.
  # It has to be on the compile line as well as the link line: SDL.h is the
  # port's header, not the system one.
  add_compile_options("-sUSE_SDL=2")
  add_link_options("-sUSE_SDL=2")
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
endif()

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
if(NOT EMSCRIPTEN)
  target_link_libraries(cpp_canvas PUBLIC PkgConfig::SDL2)
endif()

# --- shared: engine core linked by both binaries -----------------------------
add_library(flix_shared STATIC
  shared/core/world.cpp
  shared/core/json.cpp
  shared/core/process_stats.cpp
  shared/net/transport.cpp
  shared/net/web_channel.cpp
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
  server/account_limits.cpp
  server/chat_commands.cpp
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
  client/world_view.cpp
  client/ui/draw.cpp
  client/ui/text.cpp
  client/ui/markup.cpp
  client/ui/menu_style.cpp
  client/ui/menu_widgets.cpp
  client/ui/item_tile.cpp
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
add_dependencies(flowrix_client flix_data)
add_dependencies(flowrix_server flix_data)

# --- the web build's link step -----------------------------------------------
if(EMSCRIPTEN)
  # Content goes INSIDE the wasm, not beside it. --embed-file rather than
  # --preload-file, for three reasons: the client reads mobs.json, petals.json,
  # the map bundle, the biome SVGs and the fonts synchronously during start(),
  # so there is nothing to gain from a separate fetch it would have to wait for
  # anyway; a single artifact cannot half-deploy, which a .wasm and a stale
  # .data next to it can; and the server build has no page to run a preload
  # from at all. The whole set is ~1MB, which is smaller than the wasm.
  set(FLIX_EMBED_DATA "--embed-file" "${FLIX_DATA_DIR}@data")

  # Shared by both web targets. Memory grows because the rasterizer allocates
  # per frame and the world is not a fixed size; a heap sized for the worst
  # case would be wasted on every other.
  set(FLIX_WEB_LINK_OPTIONS "-sEXIT_RUNTIME=0" "-sALLOW_MEMORY_GROWTH=1")

  target_compile_definitions(flix_shared PUBLIC FLIX_WEB_BUILD)
  set_target_properties(flowrix_client PROPERTIES SUFFIX ".html")
  target_link_options(flowrix_client PRIVATE
    ${FLIX_WEB_LINK_OPTIONS}
    # Every draw goes through the page's own 2D context, so the 2D canvas
    # backend is all SDL is asked for.
    "-sMIN_WEBGL_VERSION=1"
    ${FLIX_EMBED_DATA}
    "--shell-file" "${CMAKE_CURRENT_SOURCE_DIR}/client/web/shell.html")
  set_property(TARGET flowrix_client APPEND PROPERTY LINK_DEPENDS
               "${CMAKE_CURRENT_SOURCE_DIR}/client/web/shell.html")

  # The server runs under Node, where it can listen. It is the same program as
  # the native one -- the same tick, the same systems, the same database -- and
  # differs only in what carries the bytes: net/web_channel.cpp accepts
  # WebSocket and, when a certificate is configured, WebTransport sessions.
  # .js, not .mjs: the emitted module has to be CommonJS, because the transport
  # reaches for `ws` and Node's `http` with require() from inside EM_JS, and
  # Node's own resolution finds them by walking up from the emitted file --
  # which is inside this repository, where they are installed.
  target_link_options(flowrix_server PRIVATE
    ${FLIX_WEB_LINK_OPTIONS}
    "-sENVIRONMENT=node"
    # The database is a real file that has to survive a restart, so the one
    # directory it lives in is mounted from the host filesystem. Everything
    # else -- all of the embedded content above -- stays in memory.
    "-sFORCE_FILESYSTEM=1"
    "-lnodefs.js"
    "-sEXPORTED_RUNTIME_METHODS=['FS']"
    ${FLIX_EMBED_DATA})
endif()

# --- tools -------------------------------------------------------------------
# Native only: one writes a PPM from a headless rasterizer, the other runs the
# server's own systems.
if(NOT EMSCRIPTEN)
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
endif()
