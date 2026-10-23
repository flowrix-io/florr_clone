// The Skia backend: the browser build's Canvas, drawn with Skia's GPU
// renderer (Ganesh) into the page's WebGL context instead of with the page's
// own Canvas2D. Compiled instead of canvas.cpp when CPP_CANVAS_SKIA is set.
//
// Skia is what the browser's Canvas2D is built on, so the model here is the
// one Chrome uses for a GPU canvas, without the trip through JavaScript: each
// Canvas is an SkSurface, each call is an SkCanvas call, and the drawing
// state that SkCanvas does not keep -- the styles, the line settings, the
// font -- lives beside it and is saved and restored with it. Nothing is
// batched by hand; Ganesh records the frame and the page receives it once,
// at canvasFlushOps().
//
// The page has ONE WebGL context, on the window's element, and every surface
// lives in it -- a texture can only be drawn into the context that owns it.
// The window's canvas is an offscreen surface like the rest, and presenting
// copies it to the drawing buffer. That copy is what keeps the frame around
// after it is shown, as a Canvas2D element does: the client photographs the
// last frame for its scene wipe and reads the window back as a source.
//
// What the page still does: text in a face Skia has not been given, or with
// a character that face lacks (an emoji, an arrow), is set by the page's
// Canvas2D and drawn here as a bitmap; and pictures posted in chat are
// fetched and decoded by the page, then copied in.

#include "canvas.h"

#include <emscripten.h>
#include <emscripten/html5.h>
#include <GLES3/gl3.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <iterator>
#include <list>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "include/core/SkBlurTypes.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkColorFilter.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkMaskFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkPathUtils.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTypeface.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/gpu/GpuTypes.h"
#include "include/gpu/ganesh/GrBackendSurface.h"
#include "include/gpu/ganesh/GrDirectContext.h"
#include "include/gpu/ganesh/SkSurfaceGanesh.h"
#include "include/gpu/ganesh/gl/GrGLBackendSurface.h"
#include "include/gpu/ganesh/gl/GrGLDirectContext.h"
#include "include/gpu/ganesh/gl/GrGLInterface.h"
#include "include/gpu/ganesh/gl/GrGLMakeWebGLInterface.h"
#include "include/ports/SkFontMgr_empty.h"

// --- the page's side ---------------------------------------------------------

EM_JS_DEPS(cpp_canvas_skia, "$GL");

// The WebGL context every surface lives in, on the window's element. Opaque
// and desynchronizable for the same reasons the Canvas2D backend gives its
// element those options (canvas.cpp, c2d_create). No depth, stencil or
// multisampling on the drawing buffer: nothing draws into it but the present
// copy, and Skia gives its own render targets what they need.
//
// A lost context takes every surface with it -- the window's frame, but also
// each cache, atlas and bake the client keeps in one -- and nothing here can
// rebuild them, so a restored context reloads the page. Cancelling the loss
// is what lets the browser restore it at all.
EM_JS(int, skia_gl_create, (const char* element, int desynchronized), {
  const id = UTF8ToString(element);
  let canvas = document.getElementById(id);
  if (!canvas) {
    if (typeof document === 'undefined' || !document.body) return 0;
    canvas = document.createElement('canvas');
    canvas.id = id;
    document.body.appendChild(canvas);
  }
  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault(), false);
  canvas.addEventListener('webglcontextrestored', () => location.reload(), false);
  const attributes = {
    alpha: false, depth: false, stencil: false, antialias: false,
    premultipliedAlpha: true, preserveDrawingBuffer: false,
    desynchronized: !!desynchronized, enableExtensionsByDefault: true,
    majorVersion: 2, minorVersion: 0,
  };
  let handle = 0;
  try { handle = GL.createContext(canvas, attributes); } catch (e) {}
  if (!handle) {
    attributes.majorVersion = 1;
    try { handle = GL.createContext(canvas, attributes); } catch (e) {}
  }
  return handle || 0;
});

// Without WebGL every surface is a raster one, and the window's frame reaches
// the element as an ImageData through its 2D context. Slow -- a frame's worth
// of pixels a frame -- but a page that cannot have a GPU context still plays.
EM_JS(void, skia_present_raster, (const char* element, const std::uint8_t* pixels, int w, int h), {
  const canvas = document.getElementById(UTF8ToString(element));
  if (!canvas) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) return;
  const data = new ImageData(new Uint8ClampedArray(HEAPU8.buffer, pixels, w * h * 4).slice(), w, h);
  ctx.putImageData(data, 0, 0);
});

EM_JS(void, skia_warn, (const char* text), { console.warn(UTF8ToString(text)); });

// A text run the page sets: what it measures, then its pixels. Measured and
// drawn on a scratch 2D context of its own, so neither touches anything the
// game draws on. `out` is [advance, left, right, ascent, descent].
EM_JS(void, skia_text_measure, (const char* font, const char* text, float* out), {
  let x = Module.skiaTextContext;
  if (!x) {
    const surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    x = Module.skiaTextContext = surface.getContext('2d', {willReadFrequently: true});
  }
  x.font = UTF8ToString(font);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  const m = x.measureText(UTF8ToString(text));
  const o = out >> 2;
  HEAPF32[o] = m.width;
  HEAPF32[o + 1] = m.actualBoundingBoxLeft;
  HEAPF32[o + 2] = m.actualBoundingBoxRight;
  HEAPF32[o + 3] = m.actualBoundingBoxAscent;
  HEAPF32[o + 4] = m.actualBoundingBoxDescent;
});
EM_JS(void, skia_text_raster, (const char* font, const char* text, int stroke, const char* colour,
                               float lineWidth, int join, float miterLimit, int w, int h,
                               float penX, float penY, std::uint8_t* out), {
  const x = Module.skiaTextContext;
  if (!x) return;
  const surface = x.canvas;
  surface.width = w;
  surface.height = h;
  x.font = UTF8ToString(font);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  const t = UTF8ToString(text);
  if (stroke) {
    x.lineWidth = lineWidth;
    x.lineJoin = join === 1 ? 'round' : join === 2 ? 'bevel' : 'miter';
    x.miterLimit = miterLimit;
    x.strokeStyle = UTF8ToString(colour);
    x.strokeText(t, penX, penY);
  } else {
    x.fillStyle = UTF8ToString(colour);
    x.fillText(t, penX, penY);
  }
  HEAPU8.set(x.getImageData(0, 0, w, h).data, out);
});

// Remote images: the Canvas2D backend's (canvas.cpp, c2d_remote_request), with
// two differences. The picture is fetched with CORS, because its pixels have
// to come into wasm to be drawn here -- the hosts chat allows all send the
// headers, and one that does not fails to load rather than tainting anything.
// And each entry counts the frames it has shown (`version`), so a draw knows
// when the copy it holds is stale.
EM_JS(int, skia_remote_request, (const char* url), {
  const R = Module.cppRemoteImages || (Module.cppRemoteImages = new Map());
  Module.cppRemoteImageNext = (Module.cppRemoteImageNext || 0) + 1;
  const id = Module.cppRemoteImageNext, img = new Image();
  const e = {img, state: 0, frame: null, decoder: null, timer: 0, drawnAt: 0, parked: false, dead: false, version: 0, resume: () => {}};
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    e.state = img.naturalWidth > 0 && img.naturalHeight > 0 ? 1 : -1;
    if (e.state === 1 && !e.frame) e.version++;
  };
  img.onerror = () => { e.state = -1; };
  img.src = UTF8ToString(url);
  R.set(id, e);

  // Animated pictures, a frame at a time and only while drawn; see the
  // Canvas2D backend's copy of this for why.
  Module.cppRemoteAnimate ||= async (e, src) => {
    let decoder = null;
    try {
      const response = await fetch(src, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!response.ok || e.dead) return;
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/') || !(await ImageDecoder.isTypeSupported(type))) return;
      decoder = new ImageDecoder({data: response.body, type});
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (e.dead || !track || !track.animated || track.frameCount < 2) { decoder.close(); return; }
      e.decoder = decoder;
      let index = 0;
      const step = async () => {
        e.timer = 0;
        if (e.dead) return;
        if (performance.now() - e.drawnAt > 1000) { e.parked = true; return; }
        const { image } = await decoder.decode({frameIndex: index});
        if (e.dead) { image.close(); return; }
        if (e.frame) e.frame.close();
        e.frame = image;
        e.version++;
        index = (index + 1) % track.frameCount;
        const ms = (image.duration || 0) / 1000;
        e.timer = setTimeout(() => step().catch(() => {}), ms > 10 ? ms : 100);
      };
      e.resume = () => { e.parked = false; step().catch(() => {}); };
      e.drawnAt = performance.now();
      await step();
    } catch (err) {
      if (decoder && !e.decoder) { try { decoder.close(); } catch (_) {} }
    }
  };
  if (typeof ImageDecoder !== 'undefined') Module.cppRemoteAnimate(e, img.src);
  return id;
});
// `info` is [width, height, version]. `drawn` marks the picture as on screen,
// which is what keeps an animation running.
EM_JS(int, skia_remote_poll, (int id, int* info, int drawn), {
  const e = Module.cppRemoteImages && Module.cppRemoteImages.get(id);
  if (!e) return -1;
  if (drawn) { e.drawnAt = performance.now(); if (e.parked) e.resume(); }
  if (e.state === 1) {
    const o = info >> 2;
    HEAP32[o] = e.img.naturalWidth;
    HEAP32[o + 1] = e.img.naturalHeight;
    HEAP32[o + 2] = e.version;
  }
  return e.state;
});
// The frame on show, scaled to w x h, as straight RGBA.
EM_JS(int, skia_remote_pixels, (int id, int w, int h, std::uint8_t* out), {
  const e = Module.cppRemoteImages && Module.cppRemoteImages.get(id);
  if (!e || e.state !== 1) return 0;
  const surface = Module.skiaRemoteSurface || (Module.skiaRemoteSurface =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
  surface.width = w;
  surface.height = h;
  const x = surface.getContext('2d', {willReadFrequently: true});
  try {
    x.clearRect(0, 0, w, h);
    x.drawImage(e.frame || e.img, 0, 0, w, h);
    HEAPU8.set(x.getImageData(0, 0, w, h).data, out);
    return 1;
  } catch (err) {
    e.state = -1;
    return 0;
  }
});
EM_JS(void, skia_remote_release, (int id), {
  const e = Module.cppRemoteImages && Module.cppRemoteImages.get(id);
  if (!e) return;
  e.img.onload = e.img.onerror = null;
  e.img.removeAttribute('src');
  e.dead = true;
  if (e.timer) clearTimeout(e.timer);
  if (e.frame) e.frame.close();
  if (e.decoder) { try { e.decoder.close(); } catch (_) {} }
  Module.cppRemoteImages.delete(id);
});

// --- the GPU, the face, the counters -----------------------------------------

namespace {

void warnOnce(bool& said, const char* text) {
  if (said) return;
  said = true;
  skia_warn(text);
}

struct SkiaCanvas;

/// The page's one context, and what it presents.
struct Gpu {
  bool tried = false;
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE handle = 0;
  sk_sp<GrDirectContext> context;
  std::string element = "canvas";
  // The drawing buffer, wrapped. Rebuilt when the element is resized.
  sk_sp<SkSurface> screen;
  int screenWidth = 0, screenHeight = 0;
  // The window's canvas: whichever element-bound Canvas was made last.
  SkiaCanvas* presented = nullptr;
  std::vector<std::uint8_t> rasterFrame;
};

Gpu& gpu() {
  static Gpu instance;
  return instance;
}

/// The context, made on first use. The element is the first one a Canvas
/// asks for -- the window's -- or, when an offscreen canvas comes first, the
/// "canvas" the page is built around. Null when the page has no WebGL, which
/// leaves every surface a raster one.
GrDirectContext* ensureGpu(const std::string& element, bool desynchronized) {
  Gpu& g = gpu();
  if (g.tried) return g.context.get();
  g.tried = true;
  g.element = element.empty() ? std::string("canvas") : element;
  g.handle = skia_gl_create(g.element.c_str(), desynchronized ? 1 : 0);
  if (g.handle <= 0) {
    skia_warn("cpp_canvas: no WebGL context; Skia is drawing on the CPU");
    return nullptr;
  }
  emscripten_webgl_make_context_current(g.handle);
  g.context = GrDirectContexts::MakeGL(GrGLInterfaces::MakeWebGL());
  if (!g.context) {
    skia_warn("cpp_canvas: Skia could not use the WebGL context; drawing on the CPU");
    return nullptr;
  }
  return g.context.get();
}

GrDirectContext* gpuContext() { return gpu().context.get(); }

sk_sp<SkSurface> makeSurface(int width, int height) {
  const SkImageInfo info =
      SkImageInfo::Make(width, height, kRGBA_8888_SkColorType, kPremul_SkAlphaType);
  if (GrDirectContext* context = gpuContext()) {
    // Budgeted, so that the textures of the many short-lived bakes the client
    // makes are recycled rather than allocated afresh.
    //
    // Single-sampled, with Ganesh's analytic antialiasing, as the browser's
    // canvas draws. The price is that a curved stroke or a concave fill is
    // rasterized into a mask on the CPU -- this page's main thread -- where
    // the browser does the same work in its GPU process. Dynamic MSAA, which
    // is how Chrome moves such paths onto the GPU, is one Skia turns off for
    // WebGL (GrGLCaps, skbug.com/40043172).
    sk_sp<SkSurface> surface = SkSurfaces::RenderTarget(context, skgpu::Budgeted::kYes, info, 0,
                                                        kTopLeft_GrSurfaceOrigin, nullptr);
    if (surface) return surface;
    // Bigger than the GPU takes a texture: drawn on the CPU and uploaded
    // whenever it is drawn somewhere else, which is slow but not wrong.
  }
  return SkSurfaces::Raster(info);
}

/// The one face text is set in (canvasRegisterFontFile), and what its
/// baselines are as fractions of the em.
struct Face {
  sk_sp<SkFontMgr> manager;
  sk_sp<SkTypeface> typeface;
  float ascent = 0.8f, descent = 0.2f;   // positive, per unit of size
};

Face& face() {
  static Face instance;
  return instance;
}

CanvasFrameStats gFrameStats;
int gOpTypeCounts[kCanvasOpCodes] = {};

/// Codes as canvas.cpp numbers them, so the counters read the same on either
/// backend. 55 is this backend's own: pixels drawn from the wasm heap.
constexpr int kOpDrawPixels = 55;

void countOp(int code) {
  ++gFrameStats.ops;
  if (code >= 0 && code < kCanvasOpCodes) ++gOpTypeCounts[code];
}

}  // namespace

bool canvasRegisterFontFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::vector<char> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  if (bytes.empty()) return false;
  Face& f = face();
  if (!f.manager) f.manager = SkFontMgr_New_Custom_Empty();
  sk_sp<SkTypeface> typeface =
      f.manager->makeFromData(SkData::MakeWithCopy(bytes.data(), bytes.size()));
  if (!typeface) return false;
  f.typeface = std::move(typeface);
  SkFont unit(f.typeface, 100.0f);
  SkFontMetrics metrics;
  unit.getMetrics(&metrics);
  const float ascent = -metrics.fAscent / 100.0f, descent = metrics.fDescent / 100.0f;
  if (ascent > 0 && descent >= 0) {
    // Normalised to an em, which is how the browser places 'top', 'middle'
    // and 'bottom' (Blink's NormalizedTypoAscentAndDescent).
    f.ascent = ascent / (ascent + descent);
    f.descent = descent / (ascent + descent);
  }
  return true;
}

int canvasOpsEmitted() { return gFrameStats.ops; }
const int* canvasOpTypeCounts() { return gOpTypeCounts; }

CanvasFrameStats canvasTakeFrameStats() {
  const CanvasFrameStats taken = gFrameStats;
  gFrameStats = CanvasFrameStats{};
  for (int& count : gOpTypeCounts) count = 0;
  return taken;
}

const char* canvasOpName(int code) {
  switch (code) {
    case 0: return "save";           case 1: return "restore";
    case 2: return "reset";          case 3: return "scale";
    case 4: return "rotate";         case 5: return "translate";
    case 6: return "transform";      case 7: return "setTransform";
    case 8: return "resetTransform";
    case 30: return "clearRect";     case 31: return "fillRect";
    case 32: return "strokeRect";    case 44: return "fill";
    case 45: return "stroke";        case 46: return "clip";
    case 47: return "fillText";      case 48: return "strokeText";
    case 50: return "fill(Path2D)";  case 51: return "drawImage";
    case 52: return "drawImage(sub)"; case 54: return "drawImage(remote)";
    case kOpDrawPixels: return "drawImage(pixels)";
    default: return nullptr;
  }
}

// --- the drawing state -------------------------------------------------------

namespace {

enum class Align : unsigned char { Start, End, Left, Right, Center };
enum class Baseline : unsigned char { Alphabetic, Top, Hanging, Middle, Ideographic, Bottom };

/// A CSS font shorthand as set, its size in px, and the shorthand split
/// around the size, so the page can be handed the same font at another size.
struct FontSpec {
  std::string css = "10px sans-serif";
  float size = 10;
  std::string before, after = "px sans-serif";
};

const std::shared_ptr<const FontSpec>& defaultFont() {
  static const std::shared_ptr<const FontSpec> spec = std::make_shared<FontSpec>();
  return spec;
}

/// What a Canvas2D context keeps per save() that an SkCanvas does not. The
/// transform and the clip are the SkCanvas's own. Defaults are the context's.
///
/// Copied whole by every save(), so nothing in it allocates to copy: the font
/// is shared, and the dash list is empty unless one is set.
struct State {
  SkColor fill = SK_ColorBLACK, stroke = SK_ColorBLACK;
  float alpha = 1;
  SkBlendMode blend = SkBlendMode::kSrcOver;
  bool filtered = false;
  float lineWidth = 1, miterLimit = 10, dashOffset = 0;
  SkPaint::Cap cap = SkPaint::kButt_Cap;
  SkPaint::Join join = SkPaint::kMiter_Join;
  std::vector<float> dash;
  sk_sp<SkPathEffect> dashEffect;
  SkColor shadowColour = SK_ColorTRANSPARENT;
  float shadowBlur = 0, shadowX = 0, shadowY = 0;
  std::shared_ptr<const FontSpec> font = defaultFont();
  float fontSize = 10;
  Align align = Align::Start;
  Baseline baseline = Baseline::Alphabetic;
  bool rtl = false;
  bool smoothing = true;
  int smoothingQuality = 0;   // low, medium, high
};

bool shadowVisible(const State& s) {
  return SkColorGetA(s.shadowColour) != 0 &&
         (s.shadowBlur > 0 || s.shadowX != 0 || s.shadowY != 0);
}

/// The composites whose source is the whole canvas, not just the shape: what
/// the shape does not cover is cleared (or, for copy, replaced). Skia's blend
/// modes only touch what is drawn, so these are drawn through a layer the size
/// of the clip -- what the browser does for them too.
bool unboundedBlend(SkBlendMode mode) {
  return mode == SkBlendMode::kSrc || mode == SkBlendMode::kSrcIn ||
         mode == SkBlendMode::kSrcOut || mode == SkBlendMode::kDstIn ||
         mode == SkBlendMode::kDstATop;
}

std::optional<SkBlendMode> blendFor(const std::string& op) {
  static const std::unordered_map<std::string, SkBlendMode> kModes = {
      {"source-over", SkBlendMode::kSrcOver},   {"source-in", SkBlendMode::kSrcIn},
      {"source-out", SkBlendMode::kSrcOut},     {"source-atop", SkBlendMode::kSrcATop},
      {"destination-over", SkBlendMode::kDstOver}, {"destination-in", SkBlendMode::kDstIn},
      {"destination-out", SkBlendMode::kDstOut}, {"destination-atop", SkBlendMode::kDstATop},
      {"lighter", SkBlendMode::kPlus},          {"copy", SkBlendMode::kSrc},
      {"xor", SkBlendMode::kXor},               {"multiply", SkBlendMode::kMultiply},
      {"screen", SkBlendMode::kScreen},         {"overlay", SkBlendMode::kOverlay},
      {"darken", SkBlendMode::kDarken},         {"lighten", SkBlendMode::kLighten},
      {"color-dodge", SkBlendMode::kColorDodge}, {"color-burn", SkBlendMode::kColorBurn},
      {"hard-light", SkBlendMode::kHardLight},  {"soft-light", SkBlendMode::kSoftLight},
      {"difference", SkBlendMode::kDifference}, {"exclusion", SkBlendMode::kExclusion},
      {"hue", SkBlendMode::kHue},               {"saturation", SkBlendMode::kSaturation},
      {"color", SkBlendMode::kColor},           {"luminosity", SkBlendMode::kLuminosity},
  };
  const auto found = kModes.find(op);
  if (found == kModes.end()) return std::nullopt;
  return found->second;
}

SkColor skColor(Color c) { return SkColorSetARGB(c.a, c.r, c.g, c.b); }

// --- CSS colours: what the string overloads of the styles accept ------------

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

std::optional<SkColor> parseHex(const std::string& s) {
  const std::size_t n = s.size() - 1;
  if (n != 3 && n != 4 && n != 6 && n != 8) return std::nullopt;
  int v[8] = {};
  for (std::size_t i = 0; i < n; ++i) {
    v[i] = hexDigit(s[i + 1]);
    if (v[i] < 0) return std::nullopt;
  }
  if (n <= 4) {
    const int a = n == 4 ? v[3] * 17 : 255;
    return SkColorSetARGB(a, v[0] * 17, v[1] * 17, v[2] * 17);
  }
  const int a = n == 8 ? v[6] * 16 + v[7] : 255;
  return SkColorSetARGB(a, v[0] * 16 + v[1], v[2] * 16 + v[3], v[4] * 16 + v[5]);
}

/// rgb()/rgba(), with commas or the space-and-slash syntax, numbers or
/// percentages.
std::optional<SkColor> parseRgb(const std::string& s) {
  const std::size_t open = s.find('('), close = s.rfind(')');
  if (open == std::string::npos || close == std::string::npos || close < open) return std::nullopt;
  std::vector<float> values;
  std::vector<bool> percent;
  const char* p = s.c_str() + open + 1;
  const char* end = s.c_str() + close;
  while (p < end) {
    while (p < end && (std::isspace(static_cast<unsigned char>(*p)) || *p == ',' || *p == '/')) ++p;
    if (p >= end) break;
    char* next = nullptr;
    const float value = std::strtof(p, &next);
    if (next == p) return std::nullopt;
    p = next;
    const bool isPercent = p < end && *p == '%';
    if (isPercent) ++p;
    values.push_back(value);
    percent.push_back(isPercent);
  }
  if (values.size() != 3 && values.size() != 4) return std::nullopt;
  const auto channel = [&](std::size_t i) {
    const float v = percent[i] ? values[i] * 2.55f : values[i];
    return static_cast<U8CPU>(std::lround(std::clamp(v, 0.f, 255.f)));
  };
  U8CPU a = 255;
  if (values.size() == 4) {
    const float v = percent[3] ? values[3] / 100.f : values[3];
    a = static_cast<U8CPU>(std::lround(std::clamp(v, 0.f, 1.f) * 255.f));
  }
  return SkColorSetARGB(a, channel(0), channel(1), channel(2));
}

/// A CSS colour, or nothing for a string the browser would ignore. Hex,
/// rgb()/rgba() and the common names; the client sets its colours through
/// the Color overloads, so this is for completeness rather than the hot path.
std::optional<SkColor> parseCssColour(const std::string& text) {
  static std::unordered_map<std::string, std::optional<SkColor>> cache;
  const auto found = cache.find(text);
  if (found != cache.end()) return found->second;
  std::string s;
  for (const char c : text) {
    if (!std::isspace(static_cast<unsigned char>(c)) || (!s.empty() && s.back() != ' ')) {
      s.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
  }
  while (!s.empty() && s.back() == ' ') s.pop_back();
  static const std::unordered_map<std::string, SkColor> kNames = {
      {"transparent", SK_ColorTRANSPARENT}, {"black", SK_ColorBLACK},
      {"white", SK_ColorWHITE},             {"red", SkColorSetRGB(255, 0, 0)},
      {"lime", SkColorSetRGB(0, 255, 0)},   {"green", SkColorSetRGB(0, 128, 0)},
      {"blue", SkColorSetRGB(0, 0, 255)},   {"yellow", SkColorSetRGB(255, 255, 0)},
      {"cyan", SkColorSetRGB(0, 255, 255)}, {"aqua", SkColorSetRGB(0, 255, 255)},
      {"magenta", SkColorSetRGB(255, 0, 255)}, {"fuchsia", SkColorSetRGB(255, 0, 255)},
      {"gray", SkColorSetRGB(128, 128, 128)}, {"grey", SkColorSetRGB(128, 128, 128)},
      {"silver", SkColorSetRGB(192, 192, 192)}, {"orange", SkColorSetRGB(255, 165, 0)},
      {"purple", SkColorSetRGB(128, 0, 128)}, {"pink", SkColorSetRGB(255, 192, 203)},
      {"brown", SkColorSetRGB(165, 42, 42)},  {"gold", SkColorSetRGB(255, 215, 0)},
  };
  std::optional<SkColor> result;
  if (!s.empty() && s[0] == '#') result = parseHex(s);
  else if (s.rfind("rgb", 0) == 0) result = parseRgb(s);
  else if (const auto name = kNames.find(s); name != kNames.end()) result = name->second;
  if (cache.size() >= 1024) cache.clear();
  cache.emplace(text, result);
  return result;
}

/// The CSS hex of a colour, for handing a style to the page.
std::string cssHex(SkColor c) {
  char buf[10];
  std::snprintf(buf, sizeof buf, "#%02x%02x%02x%02x", SkColorGetR(c), SkColorGetG(c),
                SkColorGetB(c), SkColorGetA(c));
  return buf;
}

// --- geometry ----------------------------------------------------------------

constexpr double kTwoPi = 6.283185307179586;

/// Appends an arc of the ellipse to `b` the way Blink's CanvasPath does: the
/// start brought into [0, 2pi), the end adjusted to run the asked-for way, a
/// line from the current point to the start, and a whole turn as two halves
/// (Skia's arcTo cannot take a sweep of 360 degrees). In double: a sweep an
/// ulp short of a whole turn in float is a whole turn here, which is the
/// half-a-disc Blink draws when its float sweep falls just short.
void appendEllipse(SkPathBuilder& b, float cx, float cy, float rx, float ry, float rotation,
                   float startAngle, float endAngle, bool ccw) {
  if (!(std::isfinite(cx) && std::isfinite(cy) && std::isfinite(rx) && std::isfinite(ry) &&
        std::isfinite(rotation) && std::isfinite(startAngle) && std::isfinite(endAngle))) {
    return;
  }
  if (rx < 0 || ry < 0) return;   // the browser throws
  double start = std::fmod(static_cast<double>(startAngle), kTwoPi);
  if (start < 0) start += kTwoPi;
  double end = static_cast<double>(endAngle) + (start - startAngle);
  if (!ccw && end - start >= kTwoPi - 1e-6) end = start + kTwoPi;
  else if (ccw && start - end >= kTwoPi - 1e-6) end = start - kTwoPi;
  else if (!ccw && start > end) end = start + (kTwoPi - std::fmod(start - end, kTwoPi));
  else if (ccw && start < end) end = start - (kTwoPi - std::fmod(end - start, kTwoPi));
  const double sweep = end - start;

  const float cr = std::cos(rotation), sr = std::sin(rotation);
  const auto pointAt = [&](double angle) {
    const float ex = rx * static_cast<float>(std::cos(angle));
    const float ey = ry * static_cast<float>(std::sin(angle));
    return SkPoint::Make(cx + ex * cr - ey * sr, cy + ex * sr + ey * cr);
  };
  if (rx == 0 || ry == 0 || sweep == 0) {
    // Degenerate: the line it collapses to, from its start to its end.
    const SkPoint first = pointAt(start);
    if (b.isEmpty()) b.moveTo(first);
    else b.lineTo(first);
    if (sweep != 0) b.lineTo(pointAt(end));
    return;
  }

  const float startDeg = static_cast<float>(start * 180.0 / 3.141592653589793);
  const float sweepDeg = static_cast<float>(sweep * 180.0 / 3.141592653589793);
  const auto addArcs = [&](SkPathBuilder& to, const SkRect& oval) {
    if (sweepDeg >= 360.f) {
      to.arcTo(oval, startDeg, 180.f, false);
      to.arcTo(oval, startDeg + 180.f, 180.f, false);
    } else if (sweepDeg <= -360.f) {
      to.arcTo(oval, startDeg, -180.f, false);
      to.arcTo(oval, startDeg - 180.f, -180.f, false);
    } else {
      to.arcTo(oval, startDeg, sweepDeg, false);
    }
  };
  if (rotation == 0) {
    addArcs(b, SkRect::MakeLTRB(cx - rx, cy - ry, cx + rx, cy + ry));
    return;
  }
  // Turned: drawn about the origin and moved into place. Appended as an
  // extension, so its opening move is the line from the current point.
  SkPathBuilder turned;
  addArcs(turned, SkRect::MakeLTRB(-rx, -ry, rx, ry));
  SkMatrix place = SkMatrix::Translate(cx, cy);
  place.preRotate(rotation * 57.29577951308232f);
  b.addPath(turned.detach(), place,
            b.isEmpty() ? SkPath::kAppend_AddPathMode : SkPath::kExtend_AddPathMode);
}

/// One Path2D segment onto `b`, with the spec's rules for a path that has no
/// subpath yet: a lineTo or a curve starts one where it would have begun, and
/// an arcTo into nothing is only its first point.
void appendSegment(SkPathBuilder& b, const Path2D::Segment& g) {
  const float* v = g.v;
  switch (g.command) {
    case Path2D::Command::Move: b.moveTo(v[0], v[1]); break;
    case Path2D::Command::Line:
      if (b.isEmpty()) b.moveTo(v[0], v[1]);
      else b.lineTo(v[0], v[1]);
      break;
    case Path2D::Command::Quadratic:
      if (b.isEmpty()) b.moveTo(v[0], v[1]);
      b.quadTo(v[0], v[1], v[2], v[3]);
      break;
    case Path2D::Command::Bezier:
      if (b.isEmpty()) b.moveTo(v[0], v[1]);
      b.cubicTo(v[0], v[1], v[2], v[3], v[4], v[5]);
      break;
    case Path2D::Command::Arc:
      appendEllipse(b, v[0], v[1], v[2], v[2], 0, v[3], v[4], g.counterClockwise);
      break;
    case Path2D::Command::ArcTo: {
      if (!(v[4] >= 0)) break;   // the browser throws on a negative radius
      if (b.isEmpty()) { b.moveTo(v[0], v[1]); break; }
      const SkPoint p1{v[0], v[1]}, p2{v[2], v[3]};
      const std::optional<SkPoint> p0 = b.getLastPt();
      if (v[4] == 0 || (p0 && *p0 == p1) || p1 == p2) b.lineTo(p1);
      else b.arcTo(p1, p2, v[4]);
      break;
    }
    case Path2D::Command::Ellipse:
      appendEllipse(b, v[0], v[1], v[2], v[3], v[4], v[5], v[6], g.counterClockwise);
      break;
    case Path2D::Command::Rect:
      // Unsorted on purpose: Skia walks the corners in the order given, which
      // is the spec's, so a negative width winds the other way as it should.
      b.addRect(SkRect::MakeLTRB(v[0], v[1], v[0] + v[2], v[1] + v[3]), SkPathDirection::kCW, 0);
      break;
    case Path2D::Command::RoundRect: {
      const SkRect box = SkRect::MakeLTRB(v[0], v[1], v[0] + v[2], v[1] + v[3]).makeSorted();
      const float radius = std::max(0.f, v[4]);
      const bool flipped = (v[2] < 0) != (v[3] < 0);
      // Start 0 is (left + r, top), where the spec starts it: the seam, and so
      // a dash pattern's phase, lands where the browser's does.
      b.addRRect(SkRRect::MakeRectXY(box, radius, radius),
                 flipped ? SkPathDirection::kCCW : SkPathDirection::kCW, 0);
      b.moveTo(v[0], v[1]);
      break;
    }
    case Path2D::Command::Close:
      if (!b.isEmpty()) b.close();
      break;
  }
}

SkPath toSkPath(const Path2D& path) {
  SkPathBuilder b;
  for (const Path2D::Segment& g : path.segments()) appendSegment(b, g);
  return b.detach();
}

/// Retained paths, as Skia paths, by the Path2D's key. A path drawn again
/// keeps its SkPath -- and so its generation id, which is what Ganesh keys
/// its own caches of a path's triangles and masks by. Bounded, oldest out
/// first, as the Canvas2D backend bounds the page's copies.
constexpr std::size_t kMaxCachedPaths = 2048;
constexpr std::size_t kMaxInlinePathSegments = 8;

struct CachedPath {
  std::uint32_t revision = 0;
  SkPath path;
};
std::unordered_map<std::uint32_t, CachedPath> gPaths;
std::deque<std::uint32_t> gPathOrder;

const SkPath& retained(const Path2D& path, SkPath& scratch) {
  if (path.segments().size() <= kMaxInlinePathSegments) {
    scratch = toSkPath(path);
    return scratch;
  }
  const std::uint32_t key = path.cacheKey();
  auto found = gPaths.find(key);
  if (found == gPaths.end()) {
    if (gPathOrder.size() >= kMaxCachedPaths) {
      gPaths.erase(gPathOrder.front());
      gPathOrder.pop_front();
    }
    gPathOrder.push_back(key);
    found = gPaths.emplace(key, CachedPath{}).first;
  } else if (found->second.revision == path.revision()) {
    return found->second.path;
  }
  found->second.revision = path.revision();
  found->second.path = toSkPath(path);
  return found->second.path;
}

// --- text ----------------------------------------------------------------------

/// Canvas2D draws every ASCII whitespace character as a space.
std::string spacedText(const std::string& text) {
  std::string out = text;
  for (char& c : out) {
    if (c == '\t' || c == '\n' || c == '\f' || c == '\r') c = ' ';
  }
  return out;
}

/// A run as Skia sets it, at one size: its glyphs, where each one sits, and
/// its advance -- or an advance of -1 when the face lacks one of its
/// characters, which leaves the run to the page.
///
/// Kept, because the client draws the same labels every frame and the UTF-8
/// would otherwise go through FreeType's character map on every call. Kept as
/// glyphs rather than as an SkTextBlob: a blob that lives is entered in
/// Ganesh's text-blob cache, and a label that moves by a fraction of a pixel
/// each frame churns that cache into costing three times what drawing it
/// afresh does (measured in a game frame).
struct SkiaRun {
  std::vector<SkGlyphID> glyphs;
  std::vector<SkPoint> positions;
  float advance = 0;
};
constexpr std::size_t kMaxSkiaRuns = 4096;
std::list<std::pair<std::string, SkiaRun>> gSkiaRunOrder;
std::unordered_map<std::string, std::list<std::pair<std::string, SkiaRun>>::iterator> gSkiaRuns;

const SkiaRun& skiaRun(const SkFont& font, const std::string& text) {
  // Keyed by the face too, so a run measured before the face was registered
  // -- the page's, then -- is not still the page's after it.
  std::string key = text;
  const float size = font.getSize();
  const SkTypefaceID typeface = face().typeface ? face().typeface->uniqueID() : 0;
  key.append(reinterpret_cast<const char*>(&size), sizeof size);
  key.append(reinterpret_cast<const char*>(&typeface), sizeof typeface);
  const auto found = gSkiaRuns.find(key);
  if (found != gSkiaRuns.end()) {
    gSkiaRunOrder.splice(gSkiaRunOrder.begin(), gSkiaRunOrder, found->second);
    return found->second->second;
  }
  SkiaRun run;
  run.advance = -1;   // the page's, unless the face has every glyph
  const std::size_t count = face().typeface
      ? static_cast<std::size_t>(font.countText(text.data(), text.size(), SkTextEncoding::kUTF8))
      : 0;
  std::vector<SkGlyphID> glyphs(count);
  if (count) font.textToGlyphs(text.data(), text.size(), SkTextEncoding::kUTF8, glyphs);
  if (count && std::find(glyphs.begin(), glyphs.end(), SkGlyphID{0}) == glyphs.end()) {
    // Each glyph at the sum of the advances before it: the face's own
    // widths, which are the ones the client lays text out by.
    std::vector<SkScalar> widths(count);
    font.getWidths(glyphs, widths);
    run.positions.resize(count);
    float x = 0;
    for (std::size_t i = 0; i < count; ++i) {
      run.positions[i] = SkPoint::Make(x, 0);
      x += widths[i];
    }
    run.glyphs = std::move(glyphs);
    run.advance = x;
  }
  if (gSkiaRunOrder.size() >= kMaxSkiaRuns) {
    gSkiaRuns.erase(gSkiaRunOrder.back().first);
    gSkiaRunOrder.pop_back();
  }
  gSkiaRunOrder.emplace_front(key, std::move(run));
  gSkiaRuns.emplace(std::move(key), gSkiaRunOrder.begin());
  return gSkiaRunOrder.front().second;
}

/// Whether Skia sets `run` (an advance of -1 is the page's).
bool skiaSets(const SkiaRun& run) { return run.advance >= 0; }

std::string cssFont(const State& s, float size) {
  char px[32];
  std::snprintf(px, sizeof px, "%.3f", size);
  return s.font->before + px + s.font->after;
}

/// A run the page set, as a bitmap at the device size it was asked for.
struct PageRun {
  sk_sp<SkImage> image;
  float penX = 0, penY = 0;   // the pen, in the bitmap's pixels
};
constexpr std::size_t kMaxPageRuns = 256;
std::list<std::pair<std::string, PageRun>> gPageRunOrder;
std::unordered_map<std::string, std::list<std::pair<std::string, PageRun>>::iterator> gPageRuns;

float pageAdvance(const State& s, const std::string& text) {
  float m[5] = {};
  skia_text_measure(cssFont(s, s.fontSize).c_str(), text.c_str(), m);
  return m[0];
}

/// The run set by the page at `deviceSize`: filled in `colour`, or stroked
/// `lineWidth` device pixels wide. Remembered, since a label is drawn the same
/// way frame after frame.
const PageRun* pageRun(const State& s, const std::string& text, float deviceSize, bool stroke,
                       SkColor colour, float lineWidth) {
  const std::string font = cssFont(s, deviceSize);
  std::string key = font;
  key += '\x1f';
  key += text;
  char style[96];
  std::snprintf(style, sizeof style, "\x1f%d|%08x|%.3f|%d|%.3f", stroke ? 1 : 0, colour,
                stroke ? lineWidth : 0.f, stroke ? static_cast<int>(s.join) : 0,
                stroke ? s.miterLimit : 0.f);
  key += style;
  const auto found = gPageRuns.find(key);
  if (found != gPageRuns.end()) {
    gPageRunOrder.splice(gPageRunOrder.begin(), gPageRunOrder, found->second);
    return &found->second->second;
  }

  float m[5] = {};
  skia_text_measure(font.c_str(), text.c_str(), m);
  const float margin = (stroke ? lineWidth * 0.5f * std::max(1.f, s.miterLimit) : 0.f) + 2.f;
  const float left = std::max(0.f, m[1]), right = std::max(m[0], m[2]);
  const float ascent = std::max(m[3], deviceSize), descent = std::max(m[4], deviceSize * 0.3f);
  const int w = static_cast<int>(std::ceil(left + right + 2 * margin));
  const int h = static_cast<int>(std::ceil(ascent + descent + 2 * margin));
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return nullptr;
  PageRun run;
  run.penX = std::ceil(margin + left);
  run.penY = std::ceil(margin + ascent);
  std::vector<std::uint8_t> pixels(static_cast<std::size_t>(w) * h * 4);
  const int join = s.join == SkPaint::kRound_Join ? 1 : s.join == SkPaint::kBevel_Join ? 2 : 0;
  skia_text_raster(font.c_str(), text.c_str(), stroke ? 1 : 0, cssHex(colour).c_str(), lineWidth,
                   join, s.miterLimit, w, h, run.penX, run.penY, pixels.data());
  const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
  run.image = SkImages::RasterFromPixmapCopy(SkPixmap(info, pixels.data(), static_cast<std::size_t>(w) * 4));
  if (!run.image) return nullptr;

  if (gPageRunOrder.size() >= kMaxPageRuns) {
    gPageRuns.erase(gPageRunOrder.back().first);
    gPageRunOrder.pop_back();
  }
  gPageRunOrder.emplace_front(key, std::move(run));
  gPageRuns.emplace(std::move(key), gPageRunOrder.begin());
  return &gPageRunOrder.front().second;
}

// --- images --------------------------------------------------------------------

/// Heap pixels as Skia images, by the caller's key for them -- and so, once
/// drawn, as textures Ganesh keeps for as long as the image lives. Bounded,
/// oldest out first, as the Canvas2D backend bounds its scratch canvases.
constexpr std::size_t kMaxCachedImages = 512;
std::unordered_map<std::uint64_t, sk_sp<SkImage>> gImages;
std::deque<std::uint64_t> gImageOrder;

sk_sp<SkImage> imageFromPixels(const std::uint8_t* rgba, int w, int h) {
  const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
  // A copy: Ganesh uploads at the flush, by which time the caller's pixels
  // may be gone.
  return SkImages::RasterFromPixmapCopy(SkPixmap(info, rgba, static_cast<std::size_t>(w) * 4));
}

sk_sp<SkImage> cachedImage(const std::uint8_t* rgba, int w, int h, std::uint64_t key) {
  if (key == 0) return imageFromPixels(rgba, w, h);
  const auto found = gImages.find(key);
  if (found != gImages.end()) return found->second;
  sk_sp<SkImage> image = imageFromPixels(rgba, w, h);
  if (!image) return nullptr;
  if (gImageOrder.size() >= kMaxCachedImages) {
    gImages.erase(gImageOrder.front());
    gImageOrder.pop_front();
  }
  gImageOrder.push_back(key);
  gImages.emplace(key, image);
  return image;
}

struct RemoteImage {
  sk_sp<SkImage> image;
  int version = -1;
};
std::unordered_map<int, RemoteImage> gRemoteImages;

/// The biggest side a remote picture is copied in at. Chat draws them small;
/// a photograph at full size would be tens of megabytes a copy.
constexpr int kMaxRemoteSide = 2048;

/// The source rectangle clipped to the image, and the destination cut down in
/// proportion, as drawImage does with a source rectangle that overhangs.
bool clipSource(SkRect& src, SkRect& dst, float imageW, float imageH) {
  SkRect clipped;
  if (!clipped.intersect(src, SkRect::MakeWH(imageW, imageH))) return false;
  if (clipped != src) {
    const float sx = dst.width() / src.width(), sy = dst.height() / src.height();
    dst = SkRect::MakeLTRB(dst.fLeft + (clipped.fLeft - src.fLeft) * sx,
                           dst.fTop + (clipped.fTop - src.fTop) * sy,
                           dst.fRight - (src.fRight - clipped.fRight) * sx,
                           dst.fBottom - (src.fBottom - clipped.fBottom) * sy);
    src = clipped;
  }
  return !src.isEmpty() && !dst.isEmpty();
}

}  // namespace

// --- Canvas ----------------------------------------------------------------------

namespace {
/// Canvas::Skia, under a name the free functions above can use too.
struct SkiaCanvas {
  sk_sp<SkSurface> surface;
  SkCanvas* canvas = nullptr;
  // Bound to the page's element: opaque, and what the window shows.
  bool element = false;
  State state;
  std::vector<State> stack;
  // The current path, in the user space of `pathMatrix` -- the transform the
  // segments were added under, which fixes them in device space as the spec
  // says. Rebased into the newer space when the transform changes mid-path.
  SkPathBuilder path;
  SkMatrix pathMatrix;
  std::optional<SkPath> pathSnapshot;
};
}  // namespace

struct Canvas::Skia : SkiaCanvas {};

namespace {

bool isGpuSurface(const SkiaCanvas& c) { return c.canvas && c.canvas->recordingContext(); }

void attachSurface(SkiaCanvas& c, int width, int height, SkColor clearTo) {
  c.surface = makeSurface(width, height);
  c.canvas = c.surface ? c.surface->getCanvas() : nullptr;
  // A new render target's contents are undefined.
  if (c.canvas) c.canvas->clear(clearTo);
}

/// The sampling drawImage asks for, as Chrome maps imageSmoothingQuality.
SkSamplingOptions samplingFor(const State& s) {
  if (!s.smoothing) return SkSamplingOptions(SkFilterMode::kNearest);
  if (s.smoothingQuality == 2) return SkSamplingOptions(SkCubicResampler::CatmullRom());
  if (s.smoothingQuality == 1) return SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNearest);
  return SkSamplingOptions(SkFilterMode::kLinear);
}

SkPaint basePaint(const State& s) {
  SkPaint p;
  p.setAntiAlias(true);
  p.setBlendMode(s.blend);
  return p;
}

SkPaint fillPaint(const State& s) {
  SkPaint p = basePaint(s);
  p.setColor(s.fill);
  p.setAlphaf(p.getAlphaf() * s.alpha);
  return p;
}

SkPaint strokePaint(const State& s) {
  SkPaint p = basePaint(s);
  p.setColor(s.stroke);
  p.setAlphaf(p.getAlphaf() * s.alpha);
  p.setStyle(SkPaint::kStroke_Style);
  p.setStrokeWidth(s.lineWidth);
  p.setStrokeCap(s.cap);
  p.setStrokeJoin(s.join);
  p.setStrokeMiter(s.miterLimit);
  if (s.dashEffect) p.setPathEffect(s.dashEffect);
  return p;
}

SkPaint imagePaint(const State& s, float alpha) {
  SkPaint p = basePaint(s);
  p.setAlphaf(std::clamp(s.alpha * alpha, 0.f, 1.f));
  return p;
}

/// Draws through `draw` with `paint` the way a Canvas2D context composites a
/// call: its shadow first, then the call itself, the whole of it through a
/// clip-sized layer when the composite is one that reaches past the shape.
///
/// The shadow is the shape in the shadow colour, blurred and moved in DEVICE
/// pixels -- neither the offset nor the blur follows the transform. Only
/// shapes and text cast one; the client sets a shadow on nothing else.
template <typename Draw>
void composite(SkiaCanvas& c, const SkPaint& paint, bool castsShadow, Draw&& draw) {
  SkCanvas* canvas = c.canvas;
  const State& s = c.state;
  if (castsShadow && shadowVisible(s)) {
    SkPaint shade = paint;
    shade.setColor(s.shadowColour);
    shade.setAlphaf(shade.getAlphaf() * paint.getAlphaf());
    if (s.shadowBlur > 0) {
      shade.setMaskFilter(SkMaskFilter::MakeBlur(kNormal_SkBlurStyle, s.shadowBlur * 0.5f, false));
    }
    canvas->save();
    canvas->setMatrix(SkMatrix::Concat(SkMatrix::Translate(s.shadowX, s.shadowY),
                                       canvas->getTotalMatrix()));
    draw(shade);
    canvas->restore();
  }
  if (unboundedBlend(paint.getBlendMode_or(SkBlendMode::kSrcOver))) {
    SkPaint layer;
    layer.setBlendMode(paint.getBlendMode_or(SkBlendMode::kSrcOver));
    canvas->saveLayer(nullptr, &layer);
    SkPaint inner = paint;
    inner.setBlendMode(SkBlendMode::kSrcOver);
    draw(inner);
    canvas->restore();
    return;
  }
  draw(paint);
}

// The current path ---------------------------------------------------------

/// Readies the current path for a segment added under the transform current
/// now. False when that transform cannot be inverted: everything added under
/// it collapses, and the segment is dropped.
bool pathSegmentAt(SkiaCanvas& c) {
  c.pathSnapshot.reset();
  const SkMatrix now = c.canvas->getTotalMatrix();
  if (c.path.isEmpty()) {
    c.pathMatrix = now;
    return now.invert().has_value();
  }
  if (now == c.pathMatrix) return true;
  // The segments so far, carried into the new user space unchanged in device
  // space: device = pathMatrix * p = now * (now^-1 * pathMatrix * p).
  const std::optional<SkMatrix> inverse = now.invert();
  if (!inverse) return false;
  c.path.transform(SkMatrix::Concat(*inverse, c.pathMatrix));
  c.pathMatrix = now;
  return true;
}

const SkPath& currentPath(SkiaCanvas& c) {
  if (!c.pathSnapshot) c.pathSnapshot = c.path.snapshot();
  return *c.pathSnapshot;
}

SkPathFillType fillRule(const std::string& rule) {
  return rule == "evenodd" ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding;
}

/// Draws (or clips by) the current path in the space it was built in, which
/// is where the transform it was built under puts it on the device.
template <typename Use>
void inPathSpace(SkiaCanvas& c, Use&& use) {
  const SkMatrix now = c.canvas->getTotalMatrix();
  if (now == c.pathMatrix) { use(); return; }
  c.canvas->setMatrix(c.pathMatrix);
  use();
  c.canvas->setMatrix(now);
}

}  // namespace

Canvas::Canvas(int w,int h,std::string id,bool desynchronized)
    : width_(std::max(1,w)),height_(std::max(1,h)),elementId_(std::move(id)),
      logicalWidth_(width_),logicalHeight_(height_),skia_(std::make_unique<Skia>()) {
  ensureGpu(elementId_, desynchronized);
  Gpu& g = gpu();
  skia_->element = true;
  if (elementId_ != g.element) {
    skia_warn("cpp_canvas: Skia presents to one element only; this canvas is offscreen");
    skia_->element = false;
  }
  if (skia_->element) {
    // The element's backing store is the window's pixels, as constructing a
    // Canvas2D canvas on it sets them; the drawing buffer follows it.
    const std::string selector = "#" + elementId_;
    emscripten_set_canvas_element_size(selector.c_str(), width_, height_);
    g.presented = skia_.get();
  }
  // An opaque canvas starts black, as the page's alpha:false element does.
  attachSurface(*skia_, width_, height_, skia_->element ? SK_ColorBLACK : SK_ColorTRANSPARENT);
}
Canvas::Canvas(int w,int h,bool virtualCanvas)
    : width_(std::max(1,w)),height_(std::max(1,h)),virtual_(virtualCanvas),
      logicalWidth_(width_),logicalHeight_(height_),skia_(std::make_unique<Skia>()) {
  ensureGpu(gpu().element, false);
  attachSurface(*skia_, width_, height_, SK_ColorTRANSPARENT);
}
Canvas Canvas::createVirtual(int w,int h) { return Canvas(w,h,true); }
void Canvas::setLogicalSize(int w,int h) {
  logicalWidth_ = w > 0 ? w : width_;
  logicalHeight_ = h > 0 ? h : height_;
}
Canvas::Canvas(Canvas&& other) noexcept
    : width_(other.width_), height_(other.height_), contextId_(other.contextId_), virtual_(other.virtual_),
      elementId_(std::move(other.elementId_)),
      logicalWidth_(other.logicalWidth_), logicalHeight_(other.logicalHeight_),
      fill_(other.fill_), stroke_(other.stroke_),
      lineWidth_(other.lineWidth_), currentPath_(std::move(other.currentPath_)), tint_(other.tint_),
      skia_(std::move(other.skia_)) {
  other.contextId_ = -1;
}
Canvas& Canvas::operator=(Canvas&& other) noexcept {
  if (this == &other) return *this;
  if (skia_ && gpu().presented == skia_.get()) gpu().presented = nullptr;
  width_=other.width_; height_=other.height_; contextId_=other.contextId_; virtual_=other.virtual_;
  elementId_=std::move(other.elementId_); fill_=other.fill_; stroke_=other.stroke_; lineWidth_=other.lineWidth_;
  currentPath_=std::move(other.currentPath_); other.contextId_=-1; tint_=other.tint_;
  logicalWidth_=other.logicalWidth_; logicalHeight_=other.logicalHeight_;
  skia_=std::move(other.skia_);
  return *this;
}
Canvas::~Canvas() {
  if (skia_ && gpu().presented == skia_.get()) gpu().presented = nullptr;
}
void Canvas::present(const std::string& id) {
  if (!skia_ || id != gpu().element) return;
  gpu().presented = skia_.get();
  canvasFlushOps();
}

void canvasFlushOps() {
  Gpu& g = gpu();
  const double started = emscripten_get_now();
  SkiaCanvas* shown = g.presented;
  if (g.context) {
    if (shown && shown->surface) {
      int w = 0, h = 0;
      emscripten_webgl_get_drawing_buffer_size(g.handle, &w, &h);
      if (!g.screen || w != g.screenWidth || h != g.screenHeight) {
        g.screen.reset();
        g.screenWidth = w;
        g.screenHeight = h;
        if (w > 0 && h > 0) {
          GrGLFramebufferInfo framebuffer{0, GL_RGBA8};
          const GrBackendRenderTarget target = GrBackendRenderTargets::MakeGL(w, h, 0, 0, framebuffer);
          g.screen = SkSurfaces::WrapBackendRenderTarget(g.context.get(), target,
                                                        kBottomLeft_GrSurfaceOrigin,
                                                        kRGBA_8888_SkColorType, nullptr, nullptr);
        }
      }
      if (g.screen) {
        // A straight copy: the frame replaces whatever the buffer held.
        SkPaint copy;
        copy.setBlendMode(SkBlendMode::kSrc);
        shown->surface->draw(g.screen->getCanvas(), 0, 0, SkSamplingOptions(), &copy);
      }
    }
    g.context->flushAndSubmit();
  } else if (shown && shown->surface) {
    const int w = shown->surface->width(), h = shown->surface->height();
    g.rasterFrame.resize(static_cast<std::size_t>(w) * h * 4);
    const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
    if (shown->surface->readPixels(info, g.rasterFrame.data(), static_cast<std::size_t>(w) * 4, 0, 0)) {
      skia_present_raster(g.element.c_str(), g.rasterFrame.data(), w, h);
    }
  }
  gFrameStats.flushMillis += emscripten_get_now() - started;
  ++gFrameStats.batches;
}

void Canvas::save() {
  countOp(0);
  skia_->stack.push_back(skia_->state);
  skia_->canvas->save();
}
void Canvas::restore() {
  countOp(1);
  if (skia_->stack.empty()) return;
  skia_->state = std::move(skia_->stack.back());
  skia_->stack.pop_back();
  skia_->canvas->restore();
}
void Canvas::reset() {
  countOp(2);
  SkiaCanvas& c = *skia_;
  c.canvas->restoreToCount(1);
  c.canvas->resetMatrix();
  c.canvas->clear(c.element ? SK_ColorBLACK : SK_ColorTRANSPARENT);
  c.state = State{};
  c.stack.clear();
  c.path.reset();
  c.pathSnapshot.reset();
}
void Canvas::scale(float a,float b) {
  countOp(3);
  if (std::isfinite(a) && std::isfinite(b)) skia_->canvas->scale(a, b);
}
void Canvas::rotate(float a) {
  countOp(4);
  if (std::isfinite(a)) skia_->canvas->concat(SkMatrix::RotateRad(a));
}
void Canvas::translate(float a,float b) {
  countOp(5);
  if (std::isfinite(a) && std::isfinite(b)) skia_->canvas->translate(a, b);
}
void Canvas::transform(float a,float b,float c,float d,float e,float f) {
  countOp(6);
  if (!(std::isfinite(a) && std::isfinite(b) && std::isfinite(c) && std::isfinite(d) &&
        std::isfinite(e) && std::isfinite(f))) return;
  skia_->canvas->concat(SkMatrix::MakeAll(a, c, e, b, d, f, 0, 0, 1));
}
void Canvas::setTransform(float a,float b,float c,float d,float e,float f) {
  countOp(7);
  if (!(std::isfinite(a) && std::isfinite(b) && std::isfinite(c) && std::isfinite(d) &&
        std::isfinite(e) && std::isfinite(f))) return;
  skia_->canvas->setMatrix(SkMatrix::MakeAll(a, c, e, b, d, f, 0, 0, 1));
}
void Canvas::resetTransform() {
  countOp(8);
  skia_->canvas->resetMatrix();
}
bool Canvas::isPlainComposite() const {
  const State& s = skia_->state;
  return s.blend == SkBlendMode::kSrcOver && !s.filtered && !shadowVisible(s);
}
float Canvas::globalAlpha() const { return skia_->state.alpha; }
std::array<float,6> Canvas::currentTransform() const {
  const SkMatrix m = skia_->canvas->getTotalMatrix();
  return {m.getScaleX(), m.getSkewY(), m.getSkewX(), m.getScaleY(), m.getTranslateX(), m.getTranslateY()};
}

// Truncating at both steps, as canvas.cpp does: the colour is scaled to
// [0,1], blended, and cut back to a byte.
Color Canvas::tinted(Color c) const {
  if (tint_.a==0) return c;
  const float keep=1.f-tint_.a/255.f;
  const auto mix=[keep](std::uint8_t base,std::uint8_t add) {
    const float v=(base/255.f*keep+add/255.f)*255.f;
    return static_cast<std::uint8_t>(std::clamp(v,0.f,255.f));
  };
  return Color{mix(c.r,tint_.r),mix(c.g,tint_.g),mix(c.b,tint_.b),c.a};
}
void Canvas::setFillStyle(Color c) { c=tinted(c); fill_=c; skia_->state.fill=skColor(c); }
void Canvas::setStrokeStyle(Color c) { c=tinted(c); stroke_=c; skia_->state.stroke=skColor(c); }
// A string the browser could not parse leaves the style as it was.
void Canvas::setFillStyle(const std::string& s) {
  if (const std::optional<SkColor> c = parseCssColour(s)) skia_->state.fill = *c;
}
void Canvas::setStrokeStyle(const std::string& s) {
  if (const std::optional<SkColor> c = parseCssColour(s)) skia_->state.stroke = *c;
}
// The setters below ignore what the browser's ignore: an alpha outside
// [0,1], a width or limit that is not positive, a dash with a negative entry.
void Canvas::setGlobalAlpha(float a) {
  if (std::isfinite(a) && a >= 0 && a <= 1) skia_->state.alpha = a;
}
void Canvas::setGlobalCompositeOperation(const std::string& s) {
  if (const std::optional<SkBlendMode> mode = blendFor(s)) skia_->state.blend = *mode;
}
void Canvas::setFilter(const std::string& s) {
  // Kept for isPlainComposite(), and otherwise not applied: the client sets
  // no filter, and this backend parses none.
  static bool said = false;
  const bool filtered = s != "none";
  if (filtered) warnOnce(said, "cpp_canvas: the Skia backend does not apply canvas filters");
  skia_->state.filtered = filtered;
}
void Canvas::setLineWidth(float a) {
  if (!(std::isfinite(a) && a > 0)) return;
  lineWidth_ = a;
  skia_->state.lineWidth = a;
}
void Canvas::setLineCap(const std::string& s) {
  if (s == "butt") skia_->state.cap = SkPaint::kButt_Cap;
  else if (s == "round") skia_->state.cap = SkPaint::kRound_Cap;
  else if (s == "square") skia_->state.cap = SkPaint::kSquare_Cap;
}
void Canvas::setLineJoin(const std::string& s) {
  if (s == "miter") skia_->state.join = SkPaint::kMiter_Join;
  else if (s == "round") skia_->state.join = SkPaint::kRound_Join;
  else if (s == "bevel") skia_->state.join = SkPaint::kBevel_Join;
}
void Canvas::setMiterLimit(float a) {
  if (std::isfinite(a) && a > 0) skia_->state.miterLimit = a;
}
void Canvas::setLineDash(const std::vector<float>& v) {
  for (const float f : v) {
    if (!std::isfinite(f) || f < 0) return;
  }
  State& s = skia_->state;
  s.dash = v;
  // An odd list is repeated to make it even, as the spec says.
  if (s.dash.size() % 2 == 1) s.dash.insert(s.dash.end(), v.begin(), v.end());
  float total = 0;
  for (const float f : s.dash) total += f;
  s.dashEffect = total > 0 ? SkDashPathEffect::Make(s.dash, s.dashOffset) : nullptr;
}
void Canvas::setLineDashOffset(float a) {
  if (!std::isfinite(a)) return;
  State& s = skia_->state;
  s.dashOffset = a;
  if (s.dashEffect) s.dashEffect = SkDashPathEffect::Make(s.dash, s.dashOffset);
}
void Canvas::setShadow(Color c,float blur,float x,float y) {
  State& s = skia_->state;
  s.shadowColour = skColor(c);
  s.shadowBlur = std::isfinite(blur) && blur >= 0 ? blur : 0;
  s.shadowX = std::isfinite(x) ? x : 0;
  s.shadowY = std::isfinite(y) ? y : 0;
}
namespace {
/// The CSS shorthand, read for its size; the family and weight are only kept
/// to hand the page, since Skia has the one face. Null for a string with no
/// size in it, which is not a font. Remembered, because the client sets the
/// same few fonts over and over.
std::shared_ptr<const FontSpec> parseFont(const std::string& f) {
  static std::unordered_map<std::string, std::shared_ptr<const FontSpec>> cache;
  const auto found = cache.find(f);
  if (found != cache.end()) return found->second;
  std::shared_ptr<const FontSpec> result;
  for (std::size_t i = 0; i < f.size() && !result; ++i) {
    const bool atToken = i == 0 || std::isspace(static_cast<unsigned char>(f[i - 1]));
    if (!atToken || !(std::isdigit(static_cast<unsigned char>(f[i])) || f[i] == '.')) continue;
    char* end = nullptr;
    const float size = std::strtof(f.c_str() + i, &end);
    const std::size_t after = static_cast<std::size_t>(end - f.c_str());
    float scale = 0;
    if (f.compare(after, 2, "px") == 0) scale = 1;
    else if (f.compare(after, 2, "pt") == 0) scale = 4.f / 3.f;
    if (!(scale > 0 && size > 0 && std::isfinite(size))) continue;
    auto spec = std::make_shared<FontSpec>();
    spec->css = f;
    spec->size = size * scale;
    spec->before = f.substr(0, i);
    spec->after = "px" + f.substr(after + 2);   // always handed back in px
    result = std::move(spec);
  }
  if (cache.size() >= 512) cache.clear();
  cache.emplace(f, result);
  return result;
}
}  // namespace

// A string that is not a font is ignored, as the browser ignores it.
void Canvas::setFont(const std::string& f) {
  State& s = skia_->state;
  if (f == s.font->css) return;
  if (std::shared_ptr<const FontSpec> spec = parseFont(f)) {
    s.fontSize = spec->size;
    s.font = std::move(spec);
  }
}
void Canvas::setTextAlign(const std::string& a) {
  State& s = skia_->state;
  if (a == "start") s.align = Align::Start;
  else if (a == "end") s.align = Align::End;
  else if (a == "left") s.align = Align::Left;
  else if (a == "right") s.align = Align::Right;
  else if (a == "center") s.align = Align::Center;
}
void Canvas::setTextBaseline(const std::string& b) {
  State& s = skia_->state;
  if (b == "alphabetic") s.baseline = Baseline::Alphabetic;
  else if (b == "top") s.baseline = Baseline::Top;
  else if (b == "hanging") s.baseline = Baseline::Hanging;
  else if (b == "middle") s.baseline = Baseline::Middle;
  else if (b == "ideographic") s.baseline = Baseline::Ideographic;
  else if (b == "bottom") s.baseline = Baseline::Bottom;
}
void Canvas::setDirection(const std::string& d) {
  if (d == "rtl") skia_->state.rtl = true;
  else if (d == "ltr" || d == "inherit") skia_->state.rtl = false;
}
void Canvas::setImageSmoothingEnabled(bool a) { skia_->state.smoothing = a; }
void Canvas::setImageSmoothingQuality(const std::string& q) {
  if (q == "low") skia_->state.smoothingQuality = 0;
  else if (q == "medium") skia_->state.smoothingQuality = 1;
  else if (q == "high") skia_->state.smoothingQuality = 2;
}

void Canvas::clear(Color c) {
  save(); resetTransform(); setFillStyle(c); fillRect(0,0,width_,height_); restore();
}
void Canvas::clearRect(float x,float y,float w,float h) {
  countOp(30);
  // The transform and the clip, and nothing else: clearRect ignores alpha,
  // compositing, shadows and filters.
  SkPaint p;
  p.setAntiAlias(true);
  p.setBlendMode(SkBlendMode::kClear);
  skia_->canvas->drawRect(SkRect::MakeXYWH(x, y, w, h).makeSorted(), p);
}
void Canvas::fillRect(float x,float y,float w,float h) {
  countOp(31);
  if (w == 0 || h == 0 || !(std::isfinite(x) && std::isfinite(y) && std::isfinite(w) && std::isfinite(h))) return;
  SkiaCanvas& c = *skia_;
  const SkRect box = SkRect::MakeXYWH(x, y, w, h).makeSorted();
  composite(c, fillPaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawRect(box, p); });
}
void Canvas::strokeRect(float x,float y,float w,float h) {
  countOp(32);
  if (!(std::isfinite(x) && std::isfinite(y) && std::isfinite(w) && std::isfinite(h))) return;
  SkiaCanvas& c = *skia_;
  SkPathBuilder box;
  box.addRect(SkRect::MakeLTRB(x, y, x + w, y + h), SkPathDirection::kCW, 0);
  const SkPath outline = box.detach();
  composite(c, strokePaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawPath(outline, p); });
}

void Canvas::beginPath() {
  skia_->path.reset();
  skia_->pathSnapshot.reset();
}
// Each segment goes through the same rules a retained Path2D's do, in the
// user space of the transform it was added under.
#define SEGMENT(kind, ...) do { \
    if (!pathSegmentAt(*skia_)) break; \
    Path2D::Segment g{}; g.command = Path2D::Command::kind; \
    const float values[] = {__VA_ARGS__}; \
    std::copy(std::begin(values), std::end(values), g.v); \
    appendSegment(skia_->path, g); \
  } while (0)
void Canvas::closePath() {
  skia_->pathSnapshot.reset();
  if (!skia_->path.isEmpty()) skia_->path.close();
}
void Canvas::moveTo(float a,float b) { SEGMENT(Move, a, b); }
void Canvas::lineTo(float a,float b) { SEGMENT(Line, a, b); }
void Canvas::quadraticCurveTo(float a,float b,float c,float d) { SEGMENT(Quadratic, a, b, c, d); }
void Canvas::bezierCurveTo(float a,float b,float c,float d,float e,float f) { SEGMENT(Bezier, a, b, c, d, e, f); }
void Canvas::arc(float a,float b,float c,float d,float e,bool f) {
  if (!pathSegmentAt(*skia_)) return;
  appendEllipse(skia_->path, a, b, c, c, 0, d, e, f);
}
void Canvas::arcTo(float a,float b,float c,float d,float e) { SEGMENT(ArcTo, a, b, c, d, e); }
void Canvas::ellipse(float a,float b,float c,float d,float e,float f,float g,bool h) {
  if (!pathSegmentAt(*skia_)) return;
  appendEllipse(skia_->path, a, b, c, d, e, f, g, h);
}
void Canvas::rect(float a,float b,float c,float d) { SEGMENT(Rect, a, b, c, d); }
void Canvas::roundRect(float a,float b,float c,float d,float e) { SEGMENT(RoundRect, a, b, c, d, e); }
#undef SEGMENT

void Canvas::fill(const std::string& rule) {
  countOp(44);
  SkiaCanvas& c = *skia_;
  if (c.path.isEmpty()) return;
  SkPath shape = currentPath(c);
  shape.setFillType(fillRule(rule));
  inPathSpace(c, [&] {
    composite(c, fillPaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawPath(shape, p); });
  });
}
void Canvas::desaturate(const std::string& rule) {
  // `saturation` with a grey source keeps each pixel's luminosity and drops
  // its colour, exactly as the Canvas2D backend does it.
  save();
  setGlobalCompositeOperation("saturation");
  setFillStyle(Color{128,128,128,255});
  fill(rule);
  restore();
}
void Canvas::stroke() {
  countOp(45);
  SkiaCanvas& c = *skia_;
  if (c.path.isEmpty()) return;
  // The line width is in the units of the transform current NOW, and the
  // path is where the transform it was built under put it: carried from that
  // space into this one when the two differ.
  const SkMatrix now = c.canvas->getTotalMatrix();
  SkPath outline;
  if (now == c.pathMatrix) {
    outline = currentPath(c);
  } else {
    const std::optional<SkMatrix> inverse = now.invert();
    if (!inverse) return;
    outline = currentPath(c).makeTransform(SkMatrix::Concat(*inverse, c.pathMatrix));
  }
  composite(c, strokePaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawPath(outline, p); });
}
void Canvas::clip(const std::string& rule) {
  countOp(46);
  SkiaCanvas& c = *skia_;
  SkPath shape = currentPath(c);
  shape.setFillType(fillRule(rule));
  inPathSpace(c, [&] { c.canvas->clipPath(shape, SkClipOp::kIntersect, true); });
}
void Canvas::fill(const Path2D& path, const std::string& rule) {
  countOp(50);
  SkiaCanvas& c = *skia_;
  SkPath scratch;
  SkPath shape = retained(path, scratch);
  shape.setFillType(fillRule(rule));
  composite(c, fillPaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawPath(shape, p); });
}
void Canvas::stroke(const Path2D& path) {
  countOp(45);
  SkiaCanvas& c = *skia_;
  SkPath scratch;
  const SkPath& shape = retained(path, scratch);
  composite(c, strokePaint(c.state), true, [&](const SkPaint& p) { c.canvas->drawPath(shape, p); });
}
void Canvas::clip(const Path2D& path, const std::string& rule) {
  countOp(46);
  SkPath scratch;
  SkPath shape = retained(path, scratch);
  shape.setFillType(fillRule(rule));
  skia_->canvas->clipPath(shape, SkClipOp::kIntersect, true);
}
// The point is in canvas pixels, unaffected by the transform; the path is
// tested where it lies on the device.
bool Canvas::isPointInPath(float x,float y,const std::string& rule) const {
  SkiaCanvas& c = *skia_;
  if (c.path.isEmpty()) return false;
  SkPath shape = c.path.snapshot(&c.pathMatrix);
  shape.setFillType(fillRule(rule));
  return shape.contains(x, y);
}
bool Canvas::isPointInStroke(float x,float y) const {
  SkiaCanvas& c = *skia_;
  if (c.path.isEmpty()) return false;
  const SkMatrix now = c.canvas->getTotalMatrix();
  const std::optional<SkMatrix> inverse = now.invert();
  if (!inverse) return false;
  // The stroke's outline in the current user space, and the point brought
  // into it.
  const SkPath line = c.path.snapshot().makeTransform(SkMatrix::Concat(*inverse, c.pathMatrix));
  const SkPath outline = skpathutils::FillPathWithPaint(line, strokePaint(c.state));
  return outline.contains(inverse->mapPoint({x, y}));
}

// --- text ------------------------------------------------------------------------

namespace {

SkFont fontFor(const State& s) {
  SkFont font(face().typeface, s.fontSize);
  // Positioned by the face's own advances, unhinted and at subpixel
  // offsets: the same widths the client's compiled-in table lays text out by.
  font.setSubpixel(true);
  font.setLinearMetrics(true);
  font.setHinting(SkFontHinting::kNone);
  font.setEdging(SkFont::Edging::kAntiAlias);
  return font;
}

/// How far the pen moves from the anchor for the alignment, given the run's
/// advance.
float alignShift(const State& s, float width) {
  Align a = s.align;
  if (a == Align::Start) a = s.rtl ? Align::Right : Align::Left;
  if (a == Align::End) a = s.rtl ? Align::Left : Align::Right;
  if (a == Align::Center) return -width * 0.5f;
  if (a == Align::Right) return -width;
  return 0;
}

/// How far the baseline is below the anchor, as Blink places each one.
float baselineShift(const State& s) {
  const Face& f = face();
  const float size = s.fontSize;
  switch (s.baseline) {
    case Baseline::Top: return f.ascent * size;
    case Baseline::Hanging: return f.ascent * size * 0.8f;
    case Baseline::Middle: return (f.ascent - f.descent) * 0.5f * size;
    case Baseline::Ideographic:
    case Baseline::Bottom: return -f.descent * size;
    case Baseline::Alphabetic: break;
  }
  return 0;
}

/// fillText and strokeText.
void drawText(SkiaCanvas& c, const std::string& raw, float x, float y, float maxWidth, bool stroke) {
  if (raw.empty() || !std::isfinite(x) || !std::isfinite(y)) return;
  // maxWidth: negative is "none"; zero or NaN draws nothing, as in the browser.
  if (maxWidth == 0 || std::isnan(maxWidth)) return;
  const State& s = c.state;
  const std::string text = spacedText(raw);
  const SkFont font = fontFor(s);
  const SkiaRun& run = skiaRun(font, text);
  const float width = skiaSets(run) ? run.advance : pageAdvance(s, text);
  const float squeeze = maxWidth > 0 && width > maxWidth ? maxWidth / width : 1.f;
  const float penX = alignShift(s, width), penY = baselineShift(s);
  SkCanvas* canvas = c.canvas;
  canvas->save();
  canvas->translate(x, y);
  if (squeeze != 1.f) canvas->scale(squeeze, 1.f);
  SkPaint paint = stroke ? strokePaint(s) : fillPaint(s);
  if (skiaSets(run)) {
    composite(c, paint, true, [&](const SkPaint& p) {
      canvas->drawGlyphs(run.glyphs, run.positions, SkPoint::Make(penX, penY), font, p);
    });
  } else {
    // Set by the page at the size it lands on the device, and laid back one
    // bitmap pixel to one device pixel. Its colour is in the bitmap, so only
    // globalAlpha is left to the paint.
    const SkMatrix m = canvas->getTotalMatrix();
    const float deviceScale = std::sqrt(std::fabs(m.getScaleX() * m.getScaleY() -
                                                  m.getSkewX() * m.getSkewY()));
    const float scale = std::clamp(std::round(deviceScale * 16.f) / 16.f, 1.f / 16.f, 16.f);
    const PageRun* run = pageRun(s, text, s.fontSize * scale, stroke, stroke ? s.stroke : s.fill,
                                 s.lineWidth * scale);
    if (run) {
      canvas->translate(penX, penY);
      canvas->scale(1.f / scale, 1.f / scale);
      composite(c, imagePaint(s, 1.f), false, [&](const SkPaint& p) {
        canvas->drawImage(run->image.get(), -run->penX, -run->penY,
                          SkSamplingOptions(SkFilterMode::kLinear), &p);
      });
    }
  }
  canvas->restore();
}

}  // namespace

void Canvas::fillText(const std::string& s,float x,float y,float maxWidth) {
  countOp(47);
  drawText(*skia_, s, x, y, maxWidth, false);
}
void Canvas::strokeText(const std::string& s,float x,float y,float maxWidth) {
  countOp(48);
  drawText(*skia_, s, x, y, maxWidth, true);
}
float Canvas::measureText(const std::string& s) const {
  const State& state = skia_->state;
  const std::string text = spacedText(s);
  const SkiaRun& run = skiaRun(fontFor(state), text);
  return skiaSets(run) ? run.advance : pageAdvance(state, text);
}

// --- images ----------------------------------------------------------------------

namespace {

/// `source`'s pixels as an image this canvas can draw: a snapshot, which
/// costs nothing unless the source is drawn into while the snapshot lives --
/// so it is never kept past the call.
sk_sp<SkImage> snapshotFor(const SkiaCanvas& source, const SkiaCanvas& target) {
  if (!source.surface) return nullptr;
  sk_sp<SkImage> image = source.surface->makeImageSnapshot();
  // A raster canvas cannot read a texture; the one place the two meet is a
  // surface too big for the GPU.
  if (image && image->isTextureBacked() && !isGpuSurface(target)) {
    image = image->makeRasterImage(gpuContext());
  }
  return image;
}

void drawImageRect(SkiaCanvas& c, const SkImage* image, SkRect src, SkRect dst, float alpha,
                   bool clipToSource) {
  if (!image) return;
  src.sort();
  dst.sort();
  if (!clipSource(src, dst, static_cast<float>(image->width()), static_cast<float>(image->height()))) return;
  composite(c, imagePaint(c.state, alpha), false, [&](const SkPaint& p) {
    c.canvas->drawImageRect(image, src, dst, samplingFor(c.state), &p,
                            clipToSource ? SkCanvas::kStrict_SrcRectConstraint
                                         : SkCanvas::kFast_SrcRectConstraint);
  });
}

}  // namespace

void Canvas::drawCanvas(const Canvas& source,float dx,float dy) {
  // At its natural size, which is its backing store's.
  drawCanvas(source, dx, dy, static_cast<float>(source.width_), static_cast<float>(source.height_));
}
void Canvas::drawCanvas(const Canvas& source,float dx,float dy,float dw,float dh) {
  countOp(51);
  if (!source.skia_ || dw == 0 || dh == 0) return;
  const sk_sp<SkImage> image = snapshotFor(*source.skia_, *skia_);
  if (!image) return;
  drawImageRect(*skia_, image.get(), SkRect::MakeIWH(image->width(), image->height()),
                SkRect::MakeXYWH(dx, dy, dw, dh), 1.f, false);
}
void Canvas::drawCanvas(const Canvas& source,float sx,float sy,float sw,float sh,float dx,float dy,float dw,float dh) {
  countOp(52);
  if (!source.skia_ || sw == 0 || sh == 0 || dw == 0 || dh == 0) return;
  const sk_sp<SkImage> image = snapshotFor(*source.skia_, *skia_);
  if (!image) return;
  // Strict: a region of an atlas must not pick up its neighbours' edges.
  drawImageRect(*skia_, image.get(), SkRect::MakeXYWH(sx, sy, sw, sh),
                SkRect::MakeXYWH(dx, dy, dw, dh), 1.f, true);
}
void Canvas::drawImage(const ImageLevel* levels,int levelCount,float dx,float dy,float dw,float dh,float alpha,std::uint32_t cacheKey) {
  if (!levels || levelCount <= 0) return;
  // The level nearest one texel per device pixel, as the native backend picks
  // it: the pyramid is already built, and starting from it is what keeps a
  // sprite drawn small from aliasing under a bilinear sample.
  const SkMatrix m = skia_->canvas->getTotalMatrix();
  const float ux = dw / std::max(1, levels[0].width), uy = dh / std::max(1, levels[0].height);
  const float stepX = std::hypot(m.getScaleX() * ux, m.getSkewY() * ux);
  const float stepY = std::hypot(m.getSkewX() * uy, m.getScaleY() * uy);
  float shrink = std::max(stepX > 1e-6f ? 1.f / stepX : 1.f, stepY > 1e-6f ? 1.f / stepY : 1.f);
  int level = 0;
  while (level + 1 < levelCount && shrink >= 2.f) { shrink *= 0.5f; ++level; }
  countOp(kOpDrawPixels);
  const ImageLevel& l = levels[level];
  if (!l.rgba || l.width <= 0 || l.height <= 0) return;
  const std::uint64_t key = cacheKey ? (static_cast<std::uint64_t>(cacheKey) << 8) | static_cast<std::uint64_t>(level) : 0;
  const sk_sp<SkImage> image = cachedImage(l.rgba, l.width, l.height, key);
  drawImageRect(*skia_, image.get(), SkRect::MakeIWH(l.width, l.height),
                SkRect::MakeXYWH(dx, dy, dw, dh), alpha, false);
}
void Canvas::drawImage(const std::uint8_t* rgba,int iw,int ih,float dx,float dy,float dw,float dh,float alpha,std::uint32_t cacheKey) {
  countOp(kOpDrawPixels);
  if (!rgba || iw <= 0 || ih <= 0 || dw == 0 || dh == 0) return;
  const std::uint64_t key = cacheKey ? static_cast<std::uint64_t>(cacheKey) << 8 : 0;
  const sk_sp<SkImage> image = cachedImage(rgba, iw, ih, key);
  drawImageRect(*skia_, image.get(), SkRect::MakeIWH(iw, ih), SkRect::MakeXYWH(dx, dy, dw, dh), alpha, false);
}

int canvasRequestRemoteImage(const std::string& url) {
  return skia_remote_request(url.c_str());
}
int canvasRemoteImageStatus(int handle, int& width, int& height) {
  int info[3] = {0, 0, 0};
  const int state = skia_remote_poll(handle, info, 0);
  width = info[0];
  height = info[1];
  return state;
}
void canvasReleaseRemoteImage(int handle) {
  gRemoteImages.erase(handle);
  skia_remote_release(handle);
}
void Canvas::drawRemoteImage(int handle,float dx,float dy,float dw,float dh) {
  countOp(54);
  if (handle <= 0 || dw <= 0 || dh <= 0) return;
  int info[3] = {0, 0, 0};
  if (skia_remote_poll(handle, info, 1) != 1 || info[0] <= 0 || info[1] <= 0) return;
  RemoteImage& entry = gRemoteImages[handle];
  if (entry.version != info[2] || !entry.image) {
    // The frame the page shows now, copied in at no more than kMaxRemoteSide.
    const float fit = std::min(1.f, static_cast<float>(kMaxRemoteSide) / std::max(info[0], info[1]));
    const int w = std::max(1, static_cast<int>(std::lround(info[0] * fit)));
    const int h = std::max(1, static_cast<int>(std::lround(info[1] * fit)));
    std::vector<std::uint8_t> pixels(static_cast<std::size_t>(w) * h * 4);
    if (!skia_remote_pixels(handle, w, h, pixels.data())) return;
    entry.image = imageFromPixels(pixels.data(), w, h);
    entry.version = info[2];
  }
  if (!entry.image) return;
  drawImageRect(*skia_, entry.image.get(), SkRect::MakeIWH(entry.image->width(), entry.image->height()),
                SkRect::MakeXYWH(dx, dy, dw, dh), 1.f, false);
}

std::vector<std::uint8_t> Canvas::getImageData(int x,int y,int w,int h) const {
  std::vector<std::uint8_t> out(static_cast<std::size_t>(std::max(0, w)) * std::max(0, h) * 4);
  if (out.empty() || !skia_->surface) return out;
  // Straight alpha, as ImageData is. What lies outside the canvas reads as
  // transparent black, which is what the zeroed buffer already holds.
  const SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
  skia_->surface->readPixels(info, out.data(), static_cast<std::size_t>(w) * 4, x, y);
  return out;
}
void Canvas::putImageData(const std::vector<std::uint8_t>& rgba,int sw,int sh,int dx,int dy) {
  if (sw <= 0 || sh <= 0 || rgba.size() < static_cast<std::size_t>(sw) * sh * 4 || !skia_->surface) return;
  // Straight onto the pixels: no transform, clip, alpha or compositing.
  const SkImageInfo info = SkImageInfo::Make(sw, sh, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
  skia_->surface->writePixels(SkPixmap(info, rgba.data(), static_cast<std::size_t>(sw) * 4), dx, dy);
}
void Canvas::fillCircle(float a,float b,float c){beginPath();arc(a,b,c,0,6.283185307f);fill();}
void Canvas::strokeCircle(float a,float b,float c){beginPath();arc(a,b,c,0,6.283185307f);stroke();}
bool Canvas::savePPM(const std::string& path) const { (void)path; return true; }
bool Canvas::showWindow(const std::string& title, const std::function<void(Canvas&, float)>& drawFrame) {
  (void)title; (void)drawFrame;
  return true;
}
