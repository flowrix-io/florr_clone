#pragma once
// Whether two skins LOOK the same.
//
// The catalog is one shared list, and left to itself it fills with copies: one
// payload published fourteen times in half a minute, the studio's starter
// flower published untouched, somebody else's skin with its nose a unit wider.
// None of those is a different skin to anybody browsing for one. So the server
// refuses a publish that looks like something already there -- or like the
// starter -- and folds the copies an older catalog holds into their originals.
//
// "Looks like" is judged on the picture, never the shape list. Two lists can
// differ everywhere -- reordered, a shape hidden under another, a colour one
// step off -- and paint the same flower, while two lists one number apart can
// be different faces. So a skin is sampled on a grid the way renderSkinShapes
// paints it, and two samplings are compared cell by cell. Nothing here draws:
// the server links it, and the server has no canvas.

#include <cstdint>
#include <vector>

#include "shared/game/skin_format.h"

namespace flix {

/// The grid: cells of 2 authored units over the disc of 100 that
/// renderSkinShapes clips to. A starter eye (3.2 x 6.5) is about 16 cells.
inline constexpr double kSkinLookCell = 2.0;
inline constexpr int kSkinLookGrid = 100;

/// How far a cell may move and still be the same cell. One cell, two units: a
/// shape nudged that far is a skin re-saved, not a skin redrawn.
inline constexpr int kSkinLookNudgeCells = 1;
/// How far apart two colours may be, per channel, and still be one colour.
inline constexpr int kSkinLookColourSlack = 24;
/// How many cells may still differ, after the nudge and the slack, for two
/// skins to be the same skin: 9 cells, 36 square units, about half a starter
/// eye. Measured on the live catalog before this existed, its copies differed
/// by 0 to 8 cells -- the worst a face traced again a few units off -- and the
/// smallest change anybody made on purpose (a new face on the starter) by 20.
/// The smallest change a player could plausibly mean, a thin smile drawn on
/// the starter, is 10: a change.
inline constexpr int kSkinLookAlikeCells = 9;

/// What one skin paints, cropped to the cells it paints at all.
struct SkinLook {
    /// The crop, in grid cells. `w == 0` for a skin too small to cover a
    /// single cell's centre.
    int x0 = 0, y0 = 0, w = 0, h = 0;
    /// Row-major, `w * h`: 0 where nothing is painted, else 0x01rrggbb, so
    /// black is still a colour.
    std::vector<std::uint32_t> cells;

    /// Any cell of the grid; outside the crop is unpainted.
    std::uint32_t at(int x, int y) const {
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return 0;
        return cells[static_cast<std::size_t>(y - y0) * static_cast<std::size_t>(w) +
                     static_cast<std::size_t>(x - x0)];
    }
};

/// Samples `shapes` (sanitized ones) as renderSkinShapes paints them: in
/// order, fill then outline, round joins and caps, clipped to the disc.
SkinLook sampleSkinLook(const std::vector<SkinShape>& shapes);

/// How many cells differ: a cell differs when either skin's colour there has
/// no match in the other within kSkinLookNudgeCells. Symmetric. Stops counting
/// once past `stopAfter`, which is what keeps two different skins cheap.
int skinLookDifference(const SkinLook& a, const SkinLook& b, int stopAfter = 1 << 30);

/// True when no more than kSkinLookAlikeCells cells differ.
inline bool skinsLookAlike(const SkinLook& a, const SkinLook& b) {
    return skinLookDifference(a, b, kSkinLookAlikeCells) <= kSkinLookAlikeCells;
}

/// A hash of every field `shapes` carries, so a cached look can tell that the
/// skin it was sampled from has since been edited under the same id.
std::uint64_t skinShapesHash(const std::vector<SkinShape>& shapes);

/// What the Skin Studio opens on and resets to: the plain flower body and its
/// two eyes. Shared because the server refuses it as a publish -- it is the
/// skin everybody starts from, so it is nobody's to add -- and the two must
/// agree on what it is.
std::vector<SkinShape> starterSkinShapes();

} // namespace flix
