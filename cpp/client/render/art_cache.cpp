#include "client/render/art_cache.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <unordered_map>
#include <utility>

namespace flix {

#ifdef __EMSCRIPTEN__

namespace {

/// A tile smaller than this is not worth a texture: the path work it saves is
/// less than the blit costs to set up.
constexpr int kMinSide = 8;
/// One bitmap's limit. The ground tile is 400 units at up to a 2x display
/// scale and a 1.6x zoom, so ~1300 is the real ceiling; this leaves room and
/// refuses anything that would be a surprise allocation.
constexpr int kMaxSide = 4096;

/// Total texture budget. The live set is one bitmap per biome section plus one
/// per textured tile kind at one size each -- a couple of dozen at ~2.5MB
/// apiece in the worst case. The cap is what stops a window being dragged
/// slowly across a display boundary from keeping every intermediate size.
constexpr std::size_t kMaxBytes = 96u << 20;

/// How finely the sub-pixel phase is bucketed. Two per pixel on each axis is
/// four bitmaps per picture per size, which is the most the texture budget
/// will carry for something as large as a skin; the picture can then be a
/// quarter of a device pixel from where the direct draw would have put it.
constexpr int kPhaseBuckets = 2;

struct Key {
    const void* owner = nullptr;
    /// Which picture this owner is asking for. Zero for an SvgDocument, whose
    /// address is identity enough; a caller that bakes several pictures under
    /// one owner -- or whose owner pointer could be reused for different
    /// content -- distinguishes them here.
    std::uint64_t variant = 0;
    int width = 0, height = 0;
    int phaseX = 0, phaseY = 0;
    bool operator==(const Key& o) const {
        return owner == o.owner && variant == o.variant && width == o.width &&
               height == o.height && phaseX == o.phaseX && phaseY == o.phaseY;
    }
};

struct KeyHash {
    std::size_t operator()(const Key& k) const {
        std::size_t h = std::hash<const void*>{}(k.owner);
        h ^= std::hash<std::uint64_t>{}(k.variant) + 0x9e3779b9u + (h << 6) + (h >> 2);
        h ^= static_cast<std::size_t>(k.width) * 0x9e3779b9u + (h << 6) + (h >> 2);
        h ^= static_cast<std::size_t>(k.height) * 0x85ebca6bu + (h << 6) + (h >> 2);
        h ^= static_cast<std::size_t>(k.phaseX * kPhaseBuckets + k.phaseY) * 0xc2b2ae35u +
             (h << 6) + (h >> 2);
        return h;
    }
};

struct Entry {
    Canvas bitmap;
    std::size_t bytes = 0;
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
    // Least recently used, one at a time. The live set is tiny and every
    // member of it was touched this frame, so this only ever reaches sizes
    // nothing is drawing at any more.
    while (c.bytes > kMaxBytes && c.entries.size() > 1) {
        auto oldest = c.entries.begin();
        for (auto it = c.entries.begin(); it != c.entries.end(); ++it) {
            if (it->second.lastUsed < oldest->second.lastUsed) oldest = it;
        }
        c.bytes -= oldest->second.bytes;
        c.entries.erase(oldest);
    }
}

} // namespace

namespace {

/// The shared half: size the bitmap from the REAL transform, bake it once
/// through `paint`, blit it.
bool drawCached(Canvas& canvas, const void* owner, std::uint64_t variant, double x, double y,
                double w, double h, bool snapToDevice,
                const std::function<void(Canvas&, int, int)>& paint) {
    if (!(w > 0.0) || !(h > 0.0)) return false;

    // How many device pixels one user unit is worth, HERE -- not at the
    // frame's base transform. A caller inside a scale of its own (a flower's
    // artwork space, a tile plate) would otherwise bake at the wrong size and
    // have the browser stretch the result, which is visible as a soft edge on
    // every shape in it.
    const std::array<float, 6> m = canvas.currentTransform();
    const double scaleX = std::hypot(m[0], m[1]);
    const double scaleY = std::hypot(m[2], m[3]);
    if (!(scaleX > 0.0) || !(scaleY > 0.0)) return false;
    // A rotated, skewed or mirrored blit resamples the bake. Refused rather
    // than accepted with a quality loss: the whole point of baking at device
    // resolution is that the picture does not change.
    if (std::abs(m[1]) > 1e-4 * scaleX || std::abs(m[2]) > 1e-4 * scaleY) return false;
    if (!(m[0] > 0.0) || !(m[3] > 0.0)) return false;

    const int bakeW = static_cast<int>(std::lround(w * scaleX));
    const int bakeH = static_cast<int>(std::lround(h * scaleY));

    // Where the box lands on the device grid, and the fraction of a pixel it
    // sits past the last whole one. Baking always puts the picture at the same
    // phase inside its bitmap, so a bitmap blitted to a whole pixel draws the
    // picture at phase zero however the caller was placed -- every edge in it
    // lands its antialiasing somewhere slightly different from the direct
    // draw. Carrying the phase in the KEY and baking it into the bitmap is
    // what makes the two agree; it is the same trick the native text cache
    // plays on glyph runs, at the same sort of bucket size.
    const double deviceX = m[0] * x + m[4];
    const double deviceY = m[3] * y + m[5];
    int phaseX = 0;
    int phaseY = 0;
    if (snapToDevice) {
        phaseX = static_cast<int>(std::floor((deviceX - std::floor(deviceX)) * kPhaseBuckets));
        phaseY = static_cast<int>(std::floor((deviceY - std::floor(deviceY)) * kPhaseBuckets));
        phaseX = std::min(std::max(phaseX, 0), kPhaseBuckets - 1);
        phaseY = std::min(std::max(phaseY, 0), kPhaseBuckets - 1);
    }
    if (bakeW < kMinSide || bakeH < kMinSide || bakeW > kMaxSide || bakeH > kMaxSide) {
        return false;
    }

    Cache& c = cache();
    const Key key{owner, variant, bakeW, bakeH, phaseX, phaseY};
    auto found = c.entries.find(key);
    if (found == c.entries.end()) {
        // Baked at DEVICE resolution and drawn back into a user-space box of
        // exactly w x h, so the browser samples it one texel to one pixel.
        // A pixel wider and taller than the box, because the picture is shifted
        // into it by up to a whole pixel and the shift must not push its far
        // edge out of the bitmap.
        Canvas bitmap = Canvas::createVirtual(bakeW + 1, bakeH + 1);
        if (phaseX != 0 || phaseY != 0) {
            bitmap.translate(static_cast<float>(static_cast<double>(phaseX) / kPhaseBuckets),
                             static_cast<float>(static_cast<double>(phaseY) / kPhaseBuckets));
        }
        paint(bitmap, bakeW, bakeH);
        Entry entry{std::move(bitmap),
                    static_cast<std::size_t>(bakeW + 1) * (bakeH + 1) * 4, 0};
        c.bytes += entry.bytes;
        found = c.entries.emplace(key, std::move(entry)).first;
        evictIfNeeded();
        // evictIfNeeded cannot have dropped what was just inserted: it stops at
        // one entry, and this one is stamped as the most recent below.
        found = c.entries.find(key);
        if (found == c.entries.end()) return false;
    }
    found->second.lastUsed = ++c.clock;

    if (snapToDevice) {
        // Onto whole device pixels, so the blit is a texel-for-pixel copy
        // rather than a resample. The bitmap is already the right SIZE -- the
        // scale above came from the live transform -- but the box it lands in
        // is wherever the caller happens to be, a fraction of a pixel off, and
        // the browser filters the bitmap on the way down to meet it. That
        // shows up as a soft edge on every shape in the picture.
        //
        // The whole picture can therefore sit up to half a device pixel from
        // where the vector version would have. At a 2x backing store that is a
        // quarter of a CSS pixel, for the entire picture at once -- a shift,
        // not a distortion.
        //
        // The transform has already been checked to be axis-aligned and
        // unmirrored, so a device position is just m[0]*x + m[4].
        x = (std::floor(deviceX) - m[4]) / m[0];
        y = (std::floor(deviceY) - m[5]) / m[3];
        w = (bakeW + 1) / scaleX;
        h = (bakeH + 1) / scaleY;
    }
    canvas.drawCanvas(found->second.bitmap, static_cast<float>(x), static_cast<float>(y),
                      static_cast<float>(w), static_cast<float>(h));
    return true;
}

} // namespace

bool drawCachedArt(Canvas& canvas, const SvgDocument& art, double x, double y, double w,
                   double h) {
    // Time-dependent ink cannot be baked.
    if (art.animated()) return false;
    bool rendered = true;
    const bool drawn = drawCached(canvas, &art, 0, x, y, w, h, /*snapToDevice=*/false,
                                  [&](Canvas& bitmap, int bw, int bh) {
                                      rendered = art.renderFitted(bitmap, 0.0f, 0.0f,
                                                                  static_cast<float>(bw),
                                                                  static_cast<float>(bh), 0.0f);
                                  });
    return drawn && rendered;
}

bool drawCachedPicture(Canvas& canvas, const void* owner, std::uint64_t variant, double x,
                       double y, double w, double h,
                       const std::function<void(Canvas&)>& paint) {
    return drawCached(canvas, owner, variant, x, y, w, h, /*snapToDevice=*/true,
                      [&](Canvas& bitmap, int bw, int bh) {
        // The callback draws in the BOX's user space, so the device scale the
        // bake was sized at goes on first.
        bitmap.save();
        bitmap.scale(static_cast<float>(bw / w), static_cast<float>(bh / h));
        paint(bitmap);
        bitmap.restore();
    });
}

void artCacheStats(std::size_t& entries, std::size_t& bytes) {
    entries = cache().entries.size();
    bytes = cache().bytes;
}

void clearArtCache() {
    cache().entries.clear();
    cache().bytes = 0;
}

#else

bool drawCachedArt(Canvas&, const SvgDocument&, double, double, double, double) { return false; }

bool drawCachedPicture(Canvas&, const void*, std::uint64_t, double, double, double, double,
                       const std::function<void(Canvas&)>&) {
    return false;
}

void artCacheStats(std::size_t& entries, std::size_t& bytes) { entries = 0; bytes = 0; }

void clearArtCache() {}

#endif   // __EMSCRIPTEN__

} // namespace flix
