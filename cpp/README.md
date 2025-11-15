# C++ SVG Renderer

This directory contains the C++ implementation of the SVG renderer with animation support, compiled to WebAssembly using Emscripten.

## Prerequisites

1. **Emscripten SDK**: Install from https://emscripten.org/docs/getting_started/downloads.html

   ```bash
   # Get the emsdk repo
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   
   # Download and install the latest SDK tools
   ./emsdk install latest
   ./emsdk activate latest
   
   # Activate PATH and other environment variables
   source ./emsdk_env.sh
   ```

2. **C++ Compiler**: Ensure you have a C++17 compatible compiler (GCC, Clang, or MSVC)

## Building

To compile the C++ SVG renderer to WebAssembly:

```bash
cd cpp
make
```

This will generate:
- `../dist/svg_renderer.js` - JavaScript wrapper for the WebAssembly module
- `../dist/svg_renderer.wasm` - WebAssembly binary

## How It Works

The C++ renderer:
1. Parses SVG strings to extract animation information
2. Applies animations based on the current time
3. Renders the animated SVG to the canvas using the browser's native rendering

## Features

- **SVG Animation Support**: Handles `animateTransform` elements with rotation, translation, and scaling
- **Caching**: Caches parsed SVG elements for performance
- **Fallback Mode**: If the C++ renderer fails to load, the TypeScript wrapper falls back to browser-native SVG rendering

## Troubleshooting

If the build fails:
1. Ensure Emscripten is properly installed and activated
2. Check that `emcc` is in your PATH: `which emcc`
3. Verify C++17 support: The code uses C++17 features (regex, etc.)

If the renderer doesn't load in the browser:
1. Check the browser console for errors
2. Ensure `svg_renderer.js` and `svg_renderer.wasm` are in the `dist/` directory
3. The renderer will automatically fall back to browser-native rendering if the C++ module fails to load

