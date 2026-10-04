#include "client/ui/text_cache.h"

// Native only. The whole file is about caching what the SOFTWARE rasterizer
// produces; the browser build draws text through the page's own text engine,
// which keeps a glyph cache of its own, and none of the device-pixel API this
// leans on exists there.
#ifndef __EMSCRIPTEN__

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "client/ui/text.h"
#include "client/ui/text_run_key.h"

namespace flix::ui {
namespace {

using textrun::glyphBounds;
using textrun::Key;
using textrun::KeyHash;
using textrun::kSubpixel;
using textrun::quantise16;
using textrun::quantiseAlpha;

// A single run wider or taller than this is drawn directly rather than baked.
constexpr int kMaxEntryPixels = 1 << 20;

// Total bitmap budget. Chat, labels, HUD and menu text together sit far under
// this; the cap is what stops a screen full of unique strings growing without
// bound.
constexpr std::size_t kMaxBytes = 24u << 20;

// Frames an entry may go untouched before a sweep may drop it.
constexpr std::uint64_t kStaleFrames = 240;

struct Entry {
    std::vector<std::uint8_t> rgba;
    int width = 0, height = 0;
    // Where the run's pen sits inside the bitmap, in whole pixels. The blit
    // subtracts these from the pen's own pixel to place the top-left corner.
    int padLeft = 0, padTop = 0;
    std::uint64_t lastUsed = 0;
};

struct Cache {
    std::unordered_map<Key, Entry, KeyHash> entries;
    std::size_t bytes = 0;
    std::uint64_t clock = 0;
};

Cache& cache() {
    static Cache instance;
    return instance;
}

void evictIfNeeded() {
    Cache& c = cache();
    if (c.bytes <= kMaxBytes) return;
    // Stale entries first, which on a normal screen is already enough: the
    // runs actually on it were all touched this frame.
    for (auto it = c.entries.begin(); it != c.entries.end();) {
        if (c.bytes <= kMaxBytes) break;
        if (c.clock - it->second.lastUsed > kStaleFrames) {
            c.bytes -= it->second.rgba.size();
            it = c.entries.erase(it);
        } else {
            ++it;
        }
    }
    // Still over: drop whatever was used longest ago until it fits. Rare, and
    // a full clear here would throw away the runs currently on screen.
    while (c.bytes > kMaxBytes && !c.entries.empty()) {
        auto oldest = c.entries.begin();
        for (auto it = c.entries.begin(); it != c.entries.end(); ++it) {
            if (it->second.lastUsed < oldest->second.lastUsed) oldest = it;
        }
        c.bytes -= oldest->second.rgba.size();
        c.entries.erase(oldest);
    }
}

} // namespace

void paintRunDirect(Canvas& canvas, const std::string& s, double penX, double baseline,
                    const TextStyle& style, double strokeWidth, double strokeAlpha,
                    double fillAlpha, bool fillFirst) {
    Path2D glyphs;
    appendGlyphs(glyphs, s, penX, baseline, style.size);
    if (glyphs.empty()) return;

    const auto strokePass = [&] {
        if (strokeWidth <= 0) return;
        canvas.save();
        canvas.setLineJoin(style.roundJoin ? "round" : "miter");
        canvas.setLineCap("butt");
        canvas.setLineWidth(static_cast<float>(strokeWidth));
        setStroke(canvas, style.stroke, strokeAlpha);
        canvas.stroke(glyphs);
        canvas.restore();
    };
    const auto fillPass = [&] {
        setFill(canvas, style.fill, fillAlpha);
        canvas.fill(glyphs, "nonzero");
    };
    // Stroke first, then fill. The other order eats the glyph with its own
    // outline, which is what every hand-rolled attempt at this gets wrong.
    if (fillFirst) { fillPass(); strokePass(); } else { strokePass(); fillPass(); }
}

bool paintRunCached(Canvas& canvas, const std::string& s, double penX, double baseline,
                    const TextStyle& style, double strokeWidth, double strokeAlpha,
                    double fillAlpha, bool fillFirst) {
    const std::array<float, 6> m = canvas.currentTransform();
    textrun::Placement at;
    if (!textrun::place(m, penX, baseline, style.size, at)) return false;
    const double scale = at.scale, angle = at.angle, deviceSize = at.deviceSize;
    const std::int32_t angleQ = at.angleQ;
    const double originX = at.originX, originY = at.originY;
    const int bucketX = at.bucketX, bucketY = at.bucketY;

    Key key;
    key.text = s;
    key.sizeQ = quantise16(deviceSize);
    key.strokeQ = quantise16(std::max(0.0, strokeWidth) * scale);
    key.angleQ = angleQ;
    key.fill = style.fill;
    key.stroke = style.stroke;
    key.fillAlphaQ = quantiseAlpha(fillAlpha);
    key.strokeAlphaQ = quantiseAlpha(strokeAlpha);
    key.bucketX = static_cast<std::uint8_t>(bucketX);
    key.bucketY = static_cast<std::uint8_t>(bucketY);
    key.roundJoin = style.roundJoin;
    key.fillFirst = fillFirst;

    Cache& c = cache();
    auto found = c.entries.find(key);
    if (found == c.entries.end()) {
        // --- bake -----------------------------------------------------------
        // Built at the DEVICE size against an identity transform, so the bitmap
        // is what the rasterizer would have put on the surface.
        const double bakedSize = deviceSize;
        const double bakedStroke = std::max(0.0, strokeWidth) * scale;
        const double subX = static_cast<double>(bucketX) / kSubpixel;
        const double subY = static_cast<double>(bucketY) / kSubpixel;

        Path2D measured;
        appendGlyphs(measured, s, 0.0, 0.0, bakedSize);
        if (measured.empty()) return true;   // nothing to draw, and nothing to fall back to
        double minX = 0, minY = 0, maxX = 0, maxY = 0;
        if (!glyphBounds(measured, minX, minY, maxX, maxY)) return false;
        if (angleQ != 0) textrun::rotateBounds(angle, minX, minY, maxX, maxY);

        // Half the outline reaches outside the glyph, and a miter join reaches
        // further than half; the join limit is what bounds it, so the margin
        // carries a whole stroke width rather than half of one.
        const double margin = bakedStroke + 2.0;
        const int padLeft = static_cast<int>(std::ceil(margin - std::min(0.0, minX)));
        const int padTop = static_cast<int>(std::ceil(margin - std::min(0.0, minY)));
        const int width =
            padLeft + static_cast<int>(std::ceil(std::max(0.0, maxX) + margin + 1.0));
        const int height =
            padTop + static_cast<int>(std::ceil(std::max(0.0, maxY) + margin + 1.0));
        if (width <= 0 || height <= 0) return true;
        if (static_cast<long long>(width) * height > kMaxEntryPixels) return false;

        Canvas bake = Canvas::createVirtual(width, height);
        TextStyle baked = style;
        baked.size = bakedSize;
        if (angleQ != 0) {
            // Turned about the PEN, which is where the live transform turns it
            // too: translate to the pen first, and the subpixel part of the pen
            // goes into the bitmap ahead of the rotation, exactly as it does on
            // the unrotated path.
            bake.translate(static_cast<float>(padLeft + subX), static_cast<float>(padTop + subY));
            bake.rotate(static_cast<float>(angle));
            paintRunDirect(bake, s, 0.0, 0.0, baked, bakedStroke, strokeAlpha, fillAlpha,
                           fillFirst);
        } else {
            paintRunDirect(bake, s, padLeft + subX, padTop + subY, baked, bakedStroke, strokeAlpha,
                           fillAlpha, fillFirst);
        }

        Entry entry;
        entry.rgba = bake.getImageData(0, 0, width, height);
        entry.width = width;
        entry.height = height;
        entry.padLeft = padLeft;
        entry.padTop = padTop;
        if (entry.rgba.size() != static_cast<std::size_t>(width) * height * 4) return false;

        // Room is made BEFORE the insert, and that order is the whole point.
        // An entry is stamped with the clock below, not here, so between the
        // emplace and that stamp its lastUsed is 0 -- which makes it the
        // LEAST recently used thing in the map and the first candidate both
        // loops in evictIfNeeded pick. Evicting afterwards therefore freed the
        // very node `found` points at, and the stamp and the blit below then
        // wrote to and read from it. c.bytes already counts this entry, so
        // eviction frees enough room for it while it is still safely out of
        // the map.
        c.bytes += entry.rgba.size();
        evictIfNeeded();
        found = c.entries.emplace(std::move(key), std::move(entry)).first;
    }

    Entry& entry = found->second;
    entry.lastUsed = ++c.clock;

    // Straight onto the device pixels the run was baked for. The subpixel part
    // of the pen is already in the bitmap -- that is what the bucket in the key
    // is -- so what is left is a whole-pixel offset and a one-to-one copy.
    canvas.blitDevice(entry.rgba.data(), entry.width, entry.height,
                      static_cast<int>(originX) - entry.padLeft,
                      static_cast<int>(originY) - entry.padTop);
    return true;
}

void clearTextCache() {
    cache().entries.clear();
    cache().bytes = 0;
}

void textCacheStats(std::size_t& entries, std::size_t& bytes) {
    entries = cache().entries.size();
    bytes = cache().bytes;
}

} // namespace flix::ui

#endif   // __EMSCRIPTEN__
