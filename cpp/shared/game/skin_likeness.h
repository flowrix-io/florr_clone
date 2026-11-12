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
// Those are two different strengths of "the same", on purpose. Folding erases
// rows at start-up, so it takes the narrow test (skinsLookAlike): a copy, give
// or take a hair. Refusing a publish costs the author one more edit, so it takes
// the wide one (skinsLookSimilar), which also catches a copy moved, resized,
// shaded, re-outlined or with a little added. Widening the fold's test would delete skins players
// already have the next time the server restarts.
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

/// skinsLookSimilar's allowance: how many cells may differ, as a share of what
/// the author drew (SkinLook::ownDetail) on the less detailed of the two. Measured
/// over every pair in a 96-skin catalog and checked by eye: the pairs that are one
/// design came out at 19%, 43% and 50% -- a face added to a pattern, a copy traced
/// again a size up, a flower moved off centre -- and the closest two different
/// designs (a third eye and a mouth on the starter) at 82%.
///
/// Re-measured on the 892-skin live catalog of 2026-11-11, whose 256 flagged pairs
/// were labelled by eye: counted against SkinLook::detail, every one of the 164
/// pairs that are different designs was flagged, mostly two mouths on the
/// starter, whose shared eyes were most of the detail. Against ownDetail 26 of
/// them are, and 57 of the 64 copies still are.
inline constexpr double kSkinSimilarDetailShare = 0.5;
/// How deep an outline can reach into a skin, in cells: the widest stroke
/// (kMaxSkinStrokeWidth, 14 units) is 7 cells. SkinLook::rim follows the outline
/// this far in, so a thick one is a rim and not detail.
inline constexpr int kSkinOutlineCells = 7;
/// How much of the starter's eyes a skin must still paint, within the nudge, for
/// them to be the starter's eyes and not something drawn there.
inline constexpr double kStarterEyesKept = 0.8;
/// How much of the ring just past the nudge round the starter's eyes may be
/// drawn on before they count as somebody's own eyes in a busy picture. Over the
/// live catalog faces drew on 0 to 8 of its 64 cells (a nose touching them, 14),
/// and the pictures that only happen to be dark where the eyes go 20 to 43.
inline constexpr double kStarterEyesClutter = 0.25;
/// The wide tests' colour slack, per channel. A copy with every colour one step
/// past kSkinLookColourSlack paints what looks like the same skin. Over that
/// catalog 48 joins no two skins that 24 kept apart; a real recolour is further off.
inline constexpr int kSkinSimilarColourSlack = 48;
/// How far skinsLookSimilar will resize one picture onto the other, as a ratio
/// of widths. Past this the two are different sizes on the flower's hitbox,
/// which is a different thing to wear.
inline constexpr double kSkinSimilarMaxRescale = 1.25;

/// What one skin paints, cropped to the cells it paints at all.
struct SkinLook {
    /// The crop, in grid cells. `w == 0` for a skin too small to cover a
    /// single cell's centre.
    int x0 = 0, y0 = 0, w = 0, h = 0;
    /// Row-major, `w * h`: 0 where nothing is painted, else 0x01rrggbb, so
    /// black is still a colour.
    std::vector<std::uint32_t> cells;
    /// How many cells are painted, and the middle of them in grid cells.
    int painted = 0;
    double centreX = 0, centreY = 0;
    /// The most common colour: the body.
    std::uint32_t body = 0;
    /// Row-major like `cells`: 1 where the cell is rim. The rim is every
    /// painted cell within two cells of the unpainted outside, and the outline
    /// that band is the edge of: when most of the band is one colour that is
    /// not the body's, that colour inward as far as kSkinOutlineCells. So a
    /// 14-unit outline is a rim, as the studio's 3-unit one is.
    std::vector<std::uint8_t> rim;
    /// How many painted cells are what is drawn ON the skin: not the body's
    /// colour (within kSkinLookColourSlack, so a body drawn in a few near shades
    /// is still one body), and not the rim. The starter's is its two eyes.
    int detail = 0;
    /// The detail less the starter's two eyes, when the skin still has them where
    /// the starter does: what its author drew. Most faces are a mouth on the
    /// starter, and its eyes are on every one of them, so they say nothing about
    /// which face it is. The starter's own is 0.
    int ownDetail = 0;
    /// False for a skin that is all edge, floating lines with nothing behind
    /// them: a rim only means something around a body.
    bool hasBody = false;

    /// Any cell of the grid; outside the crop is unpainted.
    std::uint32_t at(int x, int y) const {
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return 0;
        return cells[index(x, y)];
    }
    /// Whether a cell of the grid is rim; outside the crop is not.
    bool rimAt(int x, int y) const {
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
        return rim[index(x, y)] != 0;
    }

private:
    std::size_t index(int x, int y) const {
        return static_cast<std::size_t>(y - y0) * static_cast<std::size_t>(w) +
               static_cast<std::size_t>(x - x0);
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

/// skinsLookAlike's allowance, once the two pictures are lined up (the same
/// middle, and the same size up to kSkinSimilarMaxRescale) and judged as
/// skinsLookSimilar judges them. What the starter flower is refused on -- moving
/// it or redoing its rim does not make it a new skin, but adding a smile to it
/// does, since it is what every player starts drawing from.
bool skinsLookAlikeLinedUp(const SkinLook& a, const SkinLook& b);

/// True when `a` and `b` are the same kind of skin to somebody browsing for one:
/// lined up as above, no more than kSkinSimilarDetailShare of what their authors
/// drew (SkinLook::ownDetail) differs. What a publish or an edit is refused on.
///
/// Measured against the detail and not the whole picture because the body says
/// nothing. Counted in cells, a near-identical copy (27) scored worse than a new
/// face on the plain flower (20), so no cell count separates them; as a share
/// of the detail they are 43% and 91%. The rim is left out of the difference as
/// it is left out of the detail: a copy with a new outline is a copy. A recolour
/// past kSkinSimilarColourSlack differs everywhere and stays a different skin.
/// The starter's eyes are left out of the share and not out of the difference:
/// two faces that both kept them are told apart by what else is on them.
bool skinsLookSimilar(const SkinLook& a, const SkinLook& b);

/// A hash of every field `shapes` carries, so a cached look can tell that the
/// skin it was sampled from has since been edited under the same id.
std::uint64_t skinShapesHash(const std::vector<SkinShape>& shapes);

/// What the Skin Studio opens on and resets to: the plain flower body and its
/// two eyes. Shared because the server refuses it as a publish -- it is the
/// skin everybody starts from, so it is nobody's to add -- and the two must
/// agree on what it is.
std::vector<SkinShape> starterSkinShapes();

} // namespace flix
