# C++ Canvas

A drawing library shaped like the browser's Canvas 2D: `Canvas` and `Path2D`
with the context's state stack, transforms, paths, fills, strokes, clips, hit
tests, text, image data and offscreen canvases, plus an SVG compiler, a
TrueType reader and a window with input. It was vendored as a small demo
project and has been changed heavily for the game since
(`git log -- cpp/third_party/cpp_canvas`), so this copy is the one that
matters: the game builds it from these sources and changes are made here. The
demo's own build — its `CMakeLists.txt`, its `shell.html` and the instructions
this file used to carry — is gone.

## One API, two backends

- **Native** draws with a software rasterizer into its own pixels. A large fill
  is split into scanline bands across a thread pool that is created once (one
  thread per core, at most eight); the result is bit-identical to filling it on
  one thread. `Window` puts the frame on screen through SDL2, uploading the
  pixels into an SDL texture, and takes keyboard, text, mouse, wheel, touch and
  clipboard input from SDL. The software backend has no blend modes, filters or
  shadows (those setters are ignored), and `setFillStyle` / `setStrokeStyle`
  with a CSS string only reach a browser: natively, colour goes through the
  `Color` overloads.
- **Web** (emscripten) has no SDL at all. Each `Canvas` is a real
  `CanvasRenderingContext2D` — the page's `<canvas>`, or an `OffscreenCanvas`
  for `Canvas::createVirtual()` — but the drawing calls do not cross into the
  page one at a time. They are written into a buffer in wasm memory and handed
  over in batches: at the end of the frame (`Window::present()`), when the
  buffer fills, when drawing moves to another canvas, and before anything that
  has to see the result (a read-back, a canvas-to-canvas blit, a destroy).
  Style strings are interned once, and the drawing state, save/restore
  included, is kept in wasm. Input comes from DOM events. Images the page
  fetches by URL (`canvasRequestRemoteImage`, for pictures posted in chat)
  exist only here.

## The files

- `canvas.h` / `canvas.cpp` — `Canvas`, `Path2D` and both backends.
- `font.h` / `font.cpp` — a TrueType reader that turns glyphs into `Path2D`
  outlines. The native `fillText` draws with it (a system face per generic
  family, or a built-in 5×7 bitmap when none is found), and the client's text
  module (`cpp/client/ui/text.cpp`) loads the staged Ubuntu Bold through it to
  measure text and build glyph paths.
- `svg.h` / `svg.cpp` — the SVG compiler, below.
- `window.h` / `window.cpp` — `Window`: the caller runs the loop, pumps events,
  draws into the window's `Canvas` and presents. SDL does not appear in the
  header.
- `touch_gesture.h` / `touch_gesture.cpp` — the pure rules for a finger that
  lands on a scrollable list: a pan, a drag, a hold that presses, or a tap.

## The SVG compiler

`SvgDocument::fromString()` and `fromFile()` parse a document once into a
retained tree of baked `Path2D` geometry. `render()`, and `renderFitted()`,
which maps the viewBox into any box and honours `preserveAspectRatio`,
evaluate the document's animations at the time they are given and emit only
`Canvas` calls; the browser's SVG engine is never asked to draw anything.
`svgPathData()` parses one path `d` on its own. `animated()` says whether a
document has a timeline at all; one that does not draws the same picture at
every time, so rasterising it once and reusing the pixels is safe.

What it draws:

- `rect` (with `rx`/`ry`), `circle`, `ellipse`, `line`, `polyline`, `polygon`,
  and `path` with every command, absolute and relative (`M L H V C S Q T A Z`).
  An elliptical arc is converted to centre form (SVG's F.6.5) and drawn as a
  real canvas ellipse arc.
- `g`, `svg`, `a` and `switch`; `use` pointing at a `#fragment`; `clip-path`
  as `url(#…)` to a `clipPath`; `transform` and `transform-origin`; the
  presentation attributes, inline `style`, and `<style>` rules that select by
  element, class or id. Paint is a solid colour: hex, `rgb()`/`rgba()` or a
  named colour.
- `image`, when its `href` is a base64 PNG `data:` URI of a non-interlaced
  image. The decoder is the library's own, so nothing new has to be linked.
- SMIL `animate`, `animateTransform` and `set`, with `dur`, `begin`,
  `repeatCount`, `fill="freeze"`, `values`/`from`/`to`/`by`, `keyTimes`,
  `calcMode` (including `spline` with `keySplines`) and `additive="sum"`. What
  can move: the transform, a path's `d`, `fill` and `stroke` colour, the
  opacities, `stroke-width`, and the geometry of a `rect`, `circle`, `ellipse`
  or `line`.

What it reports in `warnings()` and skips: `linearGradient`, `radialGradient`,
`text`, `foreignObject` and any other element it does not know;
`animateMotion`; a paint that is not a colour, a gradient `url(#…)` among
them; an `image` that is not an embedded PNG; an attribute it cannot animate.
`defs`, `clipPath`, `symbol`, `mask`, `marker`, `filter`, `pattern`, `script`
and the `title`/`desc`/`metadata` elements are not drawn where they stand, and
nothing is said about them: what `defs` holds is still reachable through `use`,
and a `clipPath` through `clip-path`, but a `mask` or `filter` is simply not
applied.

## How it is built

`cpp/CMakeLists.txt` compiles `canvas.cpp`, `svg.cpp`, `font.cpp`,
`window.cpp` and `touch_gesture.cpp` into the static library `cpp_canvas`,
with warnings off as third-party code, for the client and the render tools to
link. Natively it links SDL2 (found through `pkg-config`) and Threads; the web
build links neither.
