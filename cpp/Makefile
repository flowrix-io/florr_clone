# Makefile for compiling SVG renderer to WebAssembly

EMCC = emcc
EMCC_FLAGS = -O2 -s WASM=1 -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
             -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME="createSVGRendererModule" \
             -s EXPORT_ES6=1 \
             --bind -std=c++17 -s NO_EXIT_RUNTIME=1

SRC = svg_renderer.cpp
OUTPUT = ../dist/svg_renderer.js

all: $(OUTPUT)

$(OUTPUT): $(SRC)
	$(EMCC) $(EMCC_FLAGS) $(SRC) -o $(OUTPUT)

clean:
	rm -f $(OUTPUT) ../dist/svg_renderer.wasm

.PHONY: all clean

