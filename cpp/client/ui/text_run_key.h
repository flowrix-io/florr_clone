#pragma once
// What decides a text run's pixels, for the two caches that keep them: the
// native raster cache (text_cache.cpp) and the browser build's atlas
// (text_atlas.cpp). One definition, so the two bucket a run the same way.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <string>

#include "canvas.h"

namespace flix::ui::textrun {

// Horizontal and vertical subpixel positions kept apart. A run whose pen lands
// at a fractional device pixel is baked at the nearest quarter, which is what
// Chrome's glyph cache quantises to -- the worst case is an eighth of a pixel
// of movement, and the alternative is a cache that misses on every frame a
// label drifts across the screen.
constexpr int kSubpixel = 4;

// Buckets per radian, and rotations are bucketed the way the pen is. Half a
// bucket is under 0.0005 rad, which moves the far end of even a 200-pixel run
// by a tenth of a pixel -- inside the subpixel error the bucketing above
// already accepts. Bucketing at all is what stops a rotated run keying on a
// float that never repeats; and an angle that buckets to zero takes the
// unrotated path unchanged, so every label the client already drew still bakes
// byte for byte as it did before.
constexpr double kAngleBuckets = 1024.0;

// Sizes outside this are not worth a bitmap: below it the direct path is
// already cheap, above it one entry costs more than it saves.
constexpr double kMinDeviceSize = 5.0;
constexpr double kMaxDeviceSize = 220.0;

struct Key {
    std::string text;
    std::int32_t sizeQ = 0;         // device size, sixteenths of a pixel
    // The size the run was ASKED for, sixteenths of a unit. The browser does
    // not draw 14px under a 2x transform the way it draws 28px under none, so
    // the atlas, which bakes through the caller's own transform, keeps the two
    // apart. The native rasterizer has no such difference and leaves it 0.
    std::int32_t userSizeQ = 0;
    std::int32_t strokeQ = 0;       // device stroke width, sixteenths
    std::int32_t angleQ = 0;        // rotation, in kAngleBuckets per radian
    std::uint32_t fill = 0, stroke = 0;
    std::int16_t fillAlphaQ = 0, strokeAlphaQ = 0;
    // The canvas's globalAlpha, which the atlas bakes INTO the run: each pass
    // faded on its own, as the live draw fades them, so the outline shows
    // through the fill exactly as much. The native cache applies it at the
    // blit instead and leaves this 0.
    std::int16_t ambientAlphaQ = 0;
    std::uint8_t bucketX = 0, bucketY = 0;
    bool roundJoin = false, fillFirst = false;

    bool operator==(const Key& other) const {
        return text == other.text && sizeQ == other.sizeQ && userSizeQ == other.userSizeQ &&
               strokeQ == other.strokeQ &&
               angleQ == other.angleQ && fill == other.fill && stroke == other.stroke &&
               fillAlphaQ == other.fillAlphaQ && strokeAlphaQ == other.strokeAlphaQ &&
               ambientAlphaQ == other.ambientAlphaQ &&
               bucketX == other.bucketX && bucketY == other.bucketY &&
               roundJoin == other.roundJoin && fillFirst == other.fillFirst;
    }
};

struct KeyHash {
    std::size_t operator()(const Key& k) const {
        std::size_t h = std::hash<std::string>{}(k.text);
        const auto mix = [&h](std::uint64_t v) {
            h ^= v + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
        };
        mix(static_cast<std::uint32_t>(k.sizeQ));
        mix(static_cast<std::uint32_t>(k.userSizeQ));
        mix(static_cast<std::uint32_t>(k.strokeQ));
        mix(static_cast<std::uint32_t>(k.angleQ));
        mix(k.fill);
        mix(k.stroke);
        mix(static_cast<std::uint64_t>(static_cast<std::uint16_t>(k.fillAlphaQ)) |
            (static_cast<std::uint64_t>(static_cast<std::uint16_t>(k.strokeAlphaQ)) << 16) |
            (static_cast<std::uint64_t>(static_cast<std::uint16_t>(k.ambientAlphaQ)) << 32));
        mix(static_cast<std::uint64_t>(k.bucketX) | (static_cast<std::uint64_t>(k.bucketY) << 8) |
            (static_cast<std::uint64_t>(k.roundJoin) << 17) |
            (static_cast<std::uint64_t>(k.fillFirst) << 18));
        return h;
    }
};

inline std::int32_t quantise16(double v) {
    return static_cast<std::int32_t>(std::lround(v * 16.0));
}

inline std::int16_t quantiseAlpha(double a) {
    return static_cast<std::int16_t>(std::lround(std::clamp(a, 0.0, 1.0) * 255.0));
}

/// Where a run lands on the device, when it can be baked once and copied:
/// the transform is a similarity (uniform scale, rotation, translation), the
/// rotation and the pen are snapped to the buckets the key carries, and
/// `originX/Y` is the whole device pixel the bake's pen pixel is copied to.
struct Placement {
    double scale = 1, angle = 0, deviceSize = 0;
    std::int32_t angleQ = 0;
    double originX = 0, originY = 0;
    int bucketX = 0, bucketY = 0;
};

/// False for a transform a bake cannot stand in for, or a size outside the
/// range worth baking.
inline bool place(const std::array<float, 6>& m, double penX, double baseline, double size,
                  Placement& out) {
    // A uniform scale, a rotation and a translation -- a similarity, in other
    // words, which is exactly the family whose ink can be baked once and then
    // copied whole. `[a c; b d]` is one when a == d and c == -b: that leaves
    // no shear to smear the outlines and no reflection to flip them, so the
    // bake can carry the rotation itself and the blit stays a straight copy.
    // Anything else would have to be resampled, which is both slower and
    // softer than rasterising the outlines where they are.
    const double a = m[0], b = m[1], cc = m[2], d = m[3];
    if (std::abs(a - d) > 1e-4 || std::abs(b + cc) > 1e-4) return false;
    out.scale = std::hypot(a, b);
    if (!(out.scale > 0.0)) return false;
    // Bucketed before anything reads it, so the entry a rotated run lands in
    // is the entry it bakes: two draws a hair apart share one bitmap instead
    // of racing to overwrite each other's.
    out.angleQ = static_cast<std::int32_t>(std::lround(std::atan2(b, a) * kAngleBuckets));
    out.angle = static_cast<double>(out.angleQ) / kAngleBuckets;

    out.deviceSize = size * out.scale;
    if (out.deviceSize < kMinDeviceSize || out.deviceSize > kMaxDeviceSize) return false;

    // The pen in device pixels, snapped to the subpixel grid the bake uses.
    const double penDeviceX = a * penX + cc * baseline + m[4];
    const double penDeviceY = b * penX + d * baseline + m[5];
    const double snappedX = std::round(penDeviceX * kSubpixel) / kSubpixel;
    const double snappedY = std::round(penDeviceY * kSubpixel) / kSubpixel;
    out.originX = std::floor(snappedX);
    out.originY = std::floor(snappedY);
    out.bucketX = static_cast<int>(std::lround((snappedX - out.originX) * kSubpixel));
    out.bucketY = static_cast<int>(std::lround((snappedY - out.originY) * kSubpixel));
    return true;
}

// The tight bounds of a glyph path, in the units it was built in, relative to
// the pen. Curve control points bound their curve, so taking them straight is
// an over-estimate and never a crop. Returns false for any command the glyph
// decoder does not emit, so an unexpected path falls back to direct drawing
// rather than being baked against bounds this does not actually know.
inline bool glyphBounds(const Path2D& path, double& minX, double& minY, double& maxX,
                        double& maxY) {
    minX = minY = 1e30;
    maxX = maxY = -1e30;
    bool any = false;
    for (const Path2D::Segment& segment : path.segments()) {
        int points = 0;
        switch (segment.command) {
            case Path2D::Command::Move:
            case Path2D::Command::Line: points = 1; break;
            case Path2D::Command::Quadratic: points = 2; break;
            case Path2D::Command::Bezier: points = 3; break;
            case Path2D::Command::Close: points = 0; break;
            default: return false;
        }
        for (int i = 0; i < points; ++i) {
            const double x = segment.v[2 * i], y = segment.v[2 * i + 1];
            if (!std::isfinite(x) || !std::isfinite(y)) return false;
            minX = std::min(minX, x);
            maxX = std::max(maxX, x);
            minY = std::min(minY, y);
            maxY = std::max(maxY, y);
            any = true;
        }
    }
    return any;
}

/// The box `glyphBounds` found, turned by `angle` about the pen. Rotating the
/// four corners of an over-estimate is still an over-estimate, so this crops
/// nothing.
inline void rotateBounds(double angle, double& minX, double& minY, double& maxX, double& maxY) {
    const double cs = std::cos(angle), sn = std::sin(angle);
    const double xs[4] = {minX, maxX, minX, maxX};
    const double ys[4] = {minY, minY, maxY, maxY};
    double rMinX = 1e30, rMinY = 1e30, rMaxX = -1e30, rMaxY = -1e30;
    for (int i = 0; i < 4; ++i) {
        const double rx = xs[i] * cs - ys[i] * sn;
        const double ry = xs[i] * sn + ys[i] * cs;
        rMinX = std::min(rMinX, rx);
        rMaxX = std::max(rMaxX, rx);
        rMinY = std::min(rMinY, ry);
        rMaxY = std::max(rMaxY, ry);
    }
    minX = rMinX; maxX = rMaxX; minY = rMinY; maxY = rMaxY;
}

} // namespace flix::ui::textrun
