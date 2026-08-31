cmake_minimum_required(VERSION 3.16)
project(cpp_canvas LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(canvas_demo main.cpp canvas.cpp svg.cpp)
target_include_directories(canvas_demo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

if(EMSCRIPTEN)
  target_link_options(canvas_demo PRIVATE
    "-sWASM=1"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sEXPORTED_RUNTIME_METHODS=['ccall']"
    "--shell-file" "${CMAKE_CURRENT_SOURCE_DIR}/shell.html")
  set_target_properties(canvas_demo PROPERTIES SUFFIX ".html")
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
  target_link_libraries(canvas_demo PRIVATE PkgConfig::SDL2)
endif()
