#include "client/ui/text_atlas.h"

// Browser build only; see the header.
#ifdef __EMSCRIPTEN__

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <unordered_map>
#include <vector>

#include "client/ui/text_run_key.h"

namespace flix::ui {
namespace {

using textrun::Key;
using textrun::KeyHash;

// 4M pixels: under the ~8M at which Chrome starts rastering one canvas in
// pieces, and room for a few thousand labels.
constexpr int kAtlasSide = 2048;
// One run bigger than this is drawn live.
constexpr int kMaxCellWidth = 1024;
constexpr int kMaxCellHeight = 256;
// Shelves are cut to multiples of this, so runs of nearly the same height
// share one.
constexpr int kShelfStep = 4;
// Bakes per pre-pass. A screen of new labels is baked over a few frames
// rather than all in the one where it appeared.
constexpr int kMaxBakesPerFrame = 48;
// A run is baked once it has missed twice within this many frames. Once is
// not enough: a label drawn at a size that is animating -- a zoom -- never
// repeats, and baking it would be pure cost.
constexpr std::uint64_t kMissWindowFrames = 120;
// A full atlas is cleared and refilled, but not more often than this: a
// working set bigger than the atlas would otherwise clear it every frame and
// bake the same runs over and over. Between clears what does not fit is drawn
// live.
constexpr std::uint64_t kMinFramesBetweenResets = 120;
// Bounds on the bookkeeping, which grows with every distinct string seen.
constexpr std::size_t kMaxMisses = 8192;
constexpr std::size_t kMaxWaiting = 1024;

/// The CSS font shorthand for a run. `Ubuntu` is the face the page loads and
/// the same one `data/Ubuntu-Bold.ttf` supplies to `measure()`, so a layout
/// measured against the outlines still fits what the browser draws.
std::string fontSpec(double size) {
    char buf[64];
    std::snprintf(buf, sizeof buf, "bold %.3fpx Ubuntu, sans-serif", size);
    return buf;
}

// 0 while any font is still loading -- a bake now could capture the fallback
// face and keep showing it after the real one arrives. 2 once a font has
// finished loading since the last call, which makes every bake so far suspect.
// 1 otherwise.
EM_JS(int, text_atlas_fonts, (), {
  const fs = typeof document !== 'undefined' ? document.fonts : null;
  if (!fs) return 1;
  if (!Module.textAtlasFontWatch) {
    Module.textAtlasFontWatch = true;
    fs.addEventListener('loadingdone', () => { Module.textAtlasFontsChanged = true; });
  }
  if (fs.status !== 'loaded') return 0;
  if (Module.textAtlasFontsChanged) { Module.textAtlasFontsChanged = false; return 2; }
  return 1;
});
// Whether the faces `font` needs for `text` are loaded; asks for them if not.
EM_JS(int, text_atlas_font_ready, (const char* font, const char* text), {
  try {
    const f = UTF8ToString(font), t = UTF8ToString(text);
    if (document.fonts.check(f, t)) return 1;
    document.fonts.load(f, t).catch(() => {});
    return 0;
  } catch (e) {
    return 1;
  }
});
// The ink box the page's own engine gives a run, left-aligned on an alphabetic
// baseline: left, right, ascent, descent. Measured by the browser rather than
// from the outlines this build decodes, so kerning and fallback faces are in
// it -- it is the box of what will actually be drawn.
EM_JS(void, text_atlas_measure, (const char* font, const char* text, float* out), {
  let x = Module.textAtlasMeasure;
  if (!x) {
    const surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    x = Module.textAtlasMeasure = surface.getContext('2d');
  }
  x.font = UTF8ToString(font);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  const m = x.measureText(UTF8ToString(text));
  const o = out >> 2;
  HEAPF32[o] = m.actualBoundingBoxLeft;
  HEAPF32[o + 1] = m.actualBoundingBoxRight;
  HEAPF32[o + 2] = m.actualBoundingBoxAscent;
  HEAPF32[o + 3] = m.actualBoundingBoxDescent;
});

/// Where a baked run sits in the atlas, and where its pen pixel is inside it.
struct Cell {
    int x = 0, y = 0, w = 0, h = 0;
    int padLeft = 0, padTop = 0;
};

/// Everything a bake needs that the key does not keep in usable form.
struct Waiting {
    std::string text;
    TextStyle style;
    double strokeWidth = 0;   // as asked for, before the transform
    double scale = 1, deviceSize = 0, deviceStroke = 0, angle = 0;
    double strokeAlpha = 1, fillAlpha = 1, ambientAlpha = 1;
    int bucketX = 0, bucketY = 0;
    bool fillFirst = false;
};

struct Shelf {
    int y = 0, height = 0, x = 0;
};

struct Atlas {
    std::unique_ptr<Canvas> canvas;
    std::unordered_map<Key, Cell, KeyHash> cells;
    std::unordered_map<Key, std::uint64_t, KeyHash> misses;
    std::unordered_map<Key, Waiting, KeyHash> waiting;
    std::vector<Shelf> shelves;
    int nextShelfY = 0;
    std::uint64_t frame = 0;
    std::uint64_t lastReset = 0;
    bool everReset = false;
    int bakedLastFrame = 0;
};

Atlas& atlas() {
    static Atlas instance;
    return instance;
}

void clear(Atlas& a) {
    a.cells.clear();
    a.shelves.clear();
    a.nextShelfY = 0;
    if (a.canvas) {
        a.canvas->save();
        a.canvas->resetTransform();
        a.canvas->clearRect(0, 0, kAtlasSide, kAtlasSide);
        a.canvas->restore();
    }
}

/// A free w x h rectangle, or false when the atlas is full.
bool allocate(Atlas& a, int w, int h, int& x, int& y) {
    const int height = (h + kShelfStep - 1) / kShelfStep * kShelfStep;
    // The first shelf the run fits, no more than a quarter taller than the
    // run: a short label on a tall shelf wastes the difference all along it.
    for (Shelf& shelf : a.shelves) {
        if (shelf.height < height || shelf.height > height + height / 4 + kShelfStep) continue;
        if (shelf.x + w > kAtlasSide) continue;
        x = shelf.x;
        y = shelf.y;
        shelf.x += w;
        return true;
    }
    if (a.nextShelfY + height > kAtlasSide) return false;
    a.shelves.push_back(Shelf{a.nextShelfY, height, w});
    x = 0;
    y = a.nextShelfY;
    a.nextShelfY += height;
    return true;
}

enum class Baked { Done, Skip, Full };

Baked bake(Atlas& a, const Key& key, const Waiting& run) {
    const std::string font = fontSpec(run.deviceSize);
    if (!text_atlas_font_ready(font.c_str(), run.text.c_str())) return Baked::Skip;

    float box[4] = {0, 0, 0, 0};
    text_atlas_measure(font.c_str(), run.text.c_str(), box);
    double minX = -box[0], maxX = box[1], minY = -box[2], maxY = box[3];
    if (!(std::isfinite(minX) && std::isfinite(maxX) && std::isfinite(minY) && std::isfinite(maxY)) ||
        maxX < minX || maxY < minY) {
        return Baked::Skip;
    }
    if (key.angleQ != 0) textrun::rotateBounds(run.angle, minX, minY, maxX, maxY);

    // The same margin the native cache uses: half the outline reaches outside
    // the glyph, and a miter join reaches further than half.
    const double margin = run.deviceStroke + 2.0;
    const int padLeft = static_cast<int>(std::ceil(margin - std::min(0.0, minX)));
    const int padTop = static_cast<int>(std::ceil(margin - std::min(0.0, minY)));
    const int width = padLeft + static_cast<int>(std::ceil(std::max(0.0, maxX) + margin + 1.0));
    const int height = padTop + static_cast<int>(std::ceil(std::max(0.0, maxY) + margin + 1.0));
    if (width <= 0 || height <= 0 || width > kMaxCellWidth || height > kMaxCellHeight) {
        return Baked::Skip;
    }

    Cell cell;
    if (!allocate(a, width, height, cell.x, cell.y)) return Baked::Full;
    cell.w = width;
    cell.h = height;
    cell.padLeft = padLeft;
    cell.padTop = padTop;

    // Through the same scale and rotation the live draw would have used, at
    // the size it asked for: the browser does not draw 14px under a 2x
    // transform the way it draws 28px under none -- measured, up to 124/255 on
    // glyph edges -- while a run drawn through the same matrix and copied 1:1
    // comes out within 2/255 of drawing it in place. Only the translation is
    // the atlas's: the cell, the pad, and the pen's subpixel part.
    Canvas& canvas = *a.canvas;
    const double subX = static_cast<double>(run.bucketX) / textrun::kSubpixel;
    const double subY = static_cast<double>(run.bucketY) / textrun::kSubpixel;
    const double cs = std::cos(run.angle) * run.scale, sn = std::sin(run.angle) * run.scale;
    canvas.save();
    canvas.setTransform(static_cast<float>(cs), static_cast<float>(sn), static_cast<float>(-sn),
                        static_cast<float>(cs), static_cast<float>(cell.x + padLeft + subX),
                        static_cast<float>(cell.y + padTop + subY));
    // The caller's globalAlpha goes on each pass here, and the copy is laid
    // down at full alpha. Source-over is associative, so that composites to
    // what fading the stroke and the fill separately onto the page would
    // have; fading the finished bitmap instead would let less of the outline
    // show through the fill than the live draw does.
    canvas.setGlobalAlpha(static_cast<float>(run.ambientAlpha));
    paintRunLive(canvas, run.text, 0.0, 0.0, run.style, run.strokeWidth, run.strokeAlpha,
                 run.fillAlpha, run.fillFirst);
    canvas.restore();

    a.cells.emplace(key, cell);
    return Baked::Done;
}

/// Leaves the canvas holding what a live draw of the run would have left it
/// holding. The live path's font, alignment and fill colour outlast the call
/// -- the stroke is scoped -- and something drawn afterwards may lean on them.
/// The state is only recorded, so this costs the page nothing unless a later
/// call reads it.
void leaveLiveState(Canvas& canvas, const TextStyle& style, double fillAlpha) {
    canvas.setFont(fontSpec(style.size));
    canvas.setTextAlign("left");
    canvas.setTextBaseline("alphabetic");
    setFill(canvas, style.fill, fillAlpha);
}

} // namespace

void paintRunLive(Canvas& canvas, const std::string& s, double penX, double baseline,
                  const TextStyle& style, double strokeWidth, double strokeAlpha, double fillAlpha,
                  bool fillFirst) {
    // The pen is already resolved, so the run is anchored the same way on both
    // builds: the browser is told to put the pen exactly where the outline
    // path would have started it, not to do the alignment itself.
    canvas.setFont(fontSpec(style.size));
    canvas.setTextAlign("left");
    canvas.setTextBaseline("alphabetic");

    const auto strokePass = [&] {
        if (strokeWidth <= 0) return;
        // Scoped exactly as the outline path is: leaking a join and a cap out
        // of a text call silently restyles whatever shape is stroked next,
        // which is a bug that only ever shows up several draw calls away from
        // its cause. The fill colour still leaks, as it always has.
        canvas.save();
        canvas.setLineJoin(style.roundJoin ? "round" : "miter");
        canvas.setLineCap("butt");
        canvas.setLineWidth(static_cast<float>(strokeWidth));
        setStroke(canvas, style.stroke, strokeAlpha);
        canvas.strokeText(s, static_cast<float>(penX), static_cast<float>(baseline));
        canvas.restore();
    };
    const auto fillPass = [&] {
        setFill(canvas, style.fill, fillAlpha);
        canvas.fillText(s, static_cast<float>(penX), static_cast<float>(baseline));
    };
    if (fillFirst) { fillPass(); strokePass(); } else { strokePass(); fillPass(); }
}

bool paintRunFromAtlas(Canvas& canvas, const std::string& s, double penX, double baseline,
                       const TextStyle& style, double strokeWidth, double strokeAlpha,
                       double fillAlpha, bool fillFirst) {
    // A copy reproduces a drawing only when nothing is applied to the copy as
    // a whole that would have applied to each pass on its own. A blend mode or
    // a shadow would be; globalAlpha would be too, which is why it is baked in
    // and the copy made at full alpha.
    if (!canvas.isPlainComposite()) return false;
    const double ambient = canvas.globalAlpha();
    if (!(ambient > 0.0) || ambient > 1.0) return false;
    textrun::Placement at;
    if (!textrun::place(canvas.currentTransform(), penX, baseline, style.size, at)) return false;

    Key key;
    key.text = s;
    key.sizeQ = textrun::quantise16(at.deviceSize);
    key.userSizeQ = textrun::quantise16(style.size);
    key.strokeQ = textrun::quantise16(std::max(0.0, strokeWidth) * at.scale);
    key.angleQ = at.angleQ;
    key.fill = style.fill;
    key.stroke = style.stroke;
    key.fillAlphaQ = textrun::quantiseAlpha(fillAlpha);
    key.strokeAlphaQ = textrun::quantiseAlpha(strokeAlpha);
    key.ambientAlphaQ = textrun::quantiseAlpha(ambient);
    key.bucketX = static_cast<std::uint8_t>(at.bucketX);
    key.bucketY = static_cast<std::uint8_t>(at.bucketY);
    key.roundJoin = style.roundJoin;
    key.fillFirst = fillFirst;

    Atlas& a = atlas();
    const auto found = a.cells.find(key);
    if (found == a.cells.end()) {
        // Queued on the second miss inside the window, never the first.
        if (a.misses.size() >= kMaxMisses) a.misses.clear();
        const auto [seen, fresh] = a.misses.try_emplace(key, a.frame);
        if (!fresh) {
            if (a.frame - seen->second <= kMissWindowFrames && a.waiting.size() < kMaxWaiting &&
                a.waiting.find(key) == a.waiting.end()) {
                Waiting run;
                run.text = s;
                run.style = style;
                run.strokeWidth = std::max(0.0, strokeWidth);
                run.scale = at.scale;
                run.deviceSize = at.deviceSize;
                run.deviceStroke = std::max(0.0, strokeWidth) * at.scale;
                run.angle = at.angle;
                run.strokeAlpha = strokeAlpha;
                run.fillAlpha = fillAlpha;
                run.ambientAlpha = key.ambientAlphaQ / 255.0;
                run.bucketX = at.bucketX;
                run.bucketY = at.bucketY;
                run.fillFirst = fillFirst;
                a.waiting.emplace(key, std::move(run));
            }
            seen->second = a.frame;
        }
        return false;
    }

    const Cell& cell = found->second;
    // Straight onto the device pixels the run was baked for. The subpixel
    // part of the pen is already in the bitmap -- that is what the bucket in
    // the key is -- so what is left is a whole-pixel offset and a one-to-one
    // copy, which the browser makes exactly.
    canvas.save();
    canvas.setGlobalAlpha(1.0f);
    canvas.setTransform(1, 0, 0, 1, 0, 0);
    canvas.drawCanvas(*a.canvas, static_cast<float>(cell.x), static_cast<float>(cell.y),
                      static_cast<float>(cell.w), static_cast<float>(cell.h),
                      static_cast<float>(at.originX - cell.padLeft),
                      static_cast<float>(at.originY - cell.padTop), static_cast<float>(cell.w),
                      static_cast<float>(cell.h));
    canvas.restore();
    leaveLiveState(canvas, style, fillAlpha);
    return true;
}

void prepareTextAtlas() {
    Atlas& a = atlas();
    ++a.frame;
    a.bakedLastFrame = 0;
    if (a.cells.empty() && a.waiting.empty()) return;

    const int fonts = text_atlas_fonts();
    if (fonts == 0) return;
    if (fonts == 2) {
        // A face arrived: anything baked before it may show its fallback.
        clear(a);
    }
    if (a.waiting.empty()) return;

    if (!a.canvas) a.canvas = std::make_unique<Canvas>(Canvas::createVirtual(kAtlasSide, kAtlasSide));

    for (auto it = a.waiting.begin(); it != a.waiting.end() && a.bakedLastFrame < kMaxBakesPerFrame;) {
        if (a.cells.count(it->first)) { it = a.waiting.erase(it); continue; }
        Baked result = bake(a, it->first, it->second);
        if (result == Baked::Full) {
            if (a.everReset && a.frame - a.lastReset < kMinFramesBetweenResets) break;
            clear(a);
            a.lastReset = a.frame;
            a.everReset = true;
            result = bake(a, it->first, it->second);
            if (result == Baked::Full) result = Baked::Skip;   // too big for an empty atlas
        }
        if (result == Baked::Done) ++a.bakedLastFrame;
        it = a.waiting.erase(it);
    }
}

TextAtlasStats textAtlasStats() {
    const Atlas& a = atlas();
    TextAtlasStats stats;
    stats.runs = a.cells.size();
    stats.bakedLastFrame = a.bakedLastFrame;
    return stats;
}

} // namespace flix::ui

#endif   // __EMSCRIPTEN__
