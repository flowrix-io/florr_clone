# C++ Canvas

A small dependency-free Canvas 2D-like implementation.

- **Native C++:** draws with a software rasterizer and writes `canvas-demo.ppm`.
- **Emscripten:** the exact same `Canvas` calls directly invoke the browser's HTML Canvas 2D context.

## Native build

```sh
cmake -S . -B build
cmake --build build
./build/canvas_demo
```

Open an interactive, cross-platform SDL2 window with:

```sh
./build/canvas_demo --window
```

SDL2 is the native presentation backend on macOS, Windows, and Linux. Install its development package before configuring a native build (for example, `brew install sdl2`, `apt install libsdl2-dev`, or vcpkg's `sdl2`).

Open `canvas-demo.ppm` with Preview, ImageMagick, or any image viewer that supports PPM.

## Browser build

```sh
emcmake cmake -S . -B build-web
cmake --build build-web
python3 -m http.server -d build-web 8080
```

Then visit `http://localhost:8080/canvas_demo.html`.

The C++ API mirrors Canvas 2D state, transforms, compositing, shadows, filtering, line controls, text settings, paths (including curves, arcs, ellipses, rectangles, and `Path2D`), clipping, hit testing, image data, and virtual/offscreen contexts. Browser builds delegate these commands directly to `CanvasRenderingContext2D`; the native renderer provides software pixels, alpha compositing, polygon/path filling, and virtual-canvas compositing.

## SVG compiler

`SvgDocument::fromString()` and `SvgDocument::fromFile()` compile SVG shape/path elements into `Path2D` and `Canvas` calls. `render(canvas, timeSeconds)` evaluates SVG `<animate>` and `<animateTransform>` values at that moment, then emits Canvas commands. Supported geometry is `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, and SVG paths with move/line/curve commands. SVG gradients, images, text, and elliptical `A` path arcs are reported or use a simple endpoint fallback rather than being passed through to the browser SVG engine.

The demo includes an animated rounded rectangle plus SMIL `animateTransform` examples for a spinning star and a three-face spinning cube. `--window` redraws the complete scene at SDL's frame cadence with elapsed time; web builds use Emscripten's browser animation-frame loop. The SVG animations therefore play continuously on both targets.
