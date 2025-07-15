cmake_minimum_required(VERSION 3.16)
project(florr_io_server)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find threads
find_package(Threads REQUIRED)

# Find Boost
find_package(Boost REQUIRED COMPONENTS system)

# Find nlohmann/json
find_package(nlohmann_json QUIET)
if(NOT nlohmann_json_FOUND)
    find_path(NLOHMANN_JSON_INCLUDE_DIR
        NAMES nlohmann/json.hpp
        PATHS
            /usr/local/include
            /opt/homebrew/include
            /usr/include
    )
    
    if(NOT NLOHMANN_JSON_INCLUDE_DIR)
        message(FATAL_ERROR "nlohmann/json not found. Please install it with: brew install nlohmann-json")
    endif()
endif()

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/src)
if(NLOHMANN_JSON_INCLUDE_DIR)
    include_directories(${NLOHMANN_JSON_INCLUDE_DIR})
endif()

# Source files
file(GLOB_RECURSE SOURCES "src/*.cpp" "src/*.h")

# Create executable
add_executable(florr_server ${SOURCES})

# Link libraries
target_link_libraries(florr_server 
    ${CMAKE_THREAD_LIBS_INIT}
    ${Boost_LIBRARIES}
)

# Link nlohmann_json if found as a package
if(nlohmann_json_FOUND)
    target_link_libraries(florr_server nlohmann_json::nlohmann_json)
endif()

# Install
install(TARGETS florr_server DESTINATION bin) 