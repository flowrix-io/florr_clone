#!/bin/bash

echo "Building Florr.io Clone Server..."

# Create build directory
mkdir -p build
cd build

# Configure with cmake
cmake ..

# Build the project
if command -v nproc &> /dev/null; then
    make -j$(nproc)
elif command -v sysctl &> /dev/null; then
    make -j$(sysctl -n hw.ncpu)
else
    make -j4
fi

echo "Build complete! Server executable is in ./build/florr_server"
echo "Run with: ./florr_server" 