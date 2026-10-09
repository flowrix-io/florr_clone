#pragma once
// The one way an item is drawn, anywhere in the game.
//
// Ported from rysteria_gardn's `draw_loadout_background` and `draw_static_petal`
// (Client/Assets/Petal.cc). gardn has exactly one item renderer: the loadout
// bar, the inventory, the crafting ring, the gallery drop tables and the drops
// lying on the ground are all the same 60x60 cell drawn at different sizes, so
// a petal is instantly recognisable as the same object wherever it appears.
//
// This client used to have four of them -- the loadout bar's gardn-shaped one,
// `itemCell` for the grid panels, the shop's card and the world renderer's
// ground drop -- each with its own plate geometry, its own icon size and its
// own idea of how a multi-petal stack previews. They are all this now.
//
// Everything is laid out in gardn's 60x60 design space centred on the origin
// and scaled by `side / 60`, which is what lets one call serve a 34px crafting
// ring slot and a 70px inventory cell without either being a different design.

#include <cmath>
#include <cstdint>
#include <string>

#include "canvas.h"

#include "client/render/sprites.h"
#include "client/ui/theme.h"
#include "shared/core/types.h"
#include "shared/game/components.h"
#include "shared/game/rarity.h"
#include "shared/game/skills.h"

namespace flix::ui {

/// gardn's design cell. A tile's contents are written in these units.
inline constexpr double kItemTileDesign = 60.0;

/// World units of DIAMETER per unit of a petal's `size` stat -- a size-2 basic
/// petal is a 40-unit disc. The WORLD's scale, and the world's alone.
///
/// Ten units of radius per unit of size, which is gardn's petal `radius` and
/// the same figure kPetalIconSize states a tile's icon in: gardn draws a petal
/// at its collision radius (RenderPetal.cc scales the artwork by
/// `ent.radius / PETAL_DATA[...].radius`), so the two games agree about how
/// big a petal LOOKS even where they disagree about what it hits.
///
/// The browser build's 12 is what this was ported at, and it drew every petal
/// at 0.6x of gardn's, and a petal noticeably smaller in the world than the
/// same petal in its own inventory tile. The server's petal body was brought
/// to this same figure (kPetalRadiusPerSize), so the two now agree: a petal
/// hits what it looks like it hits. A petal that should still read small says
/// so with `visual_scale` in petals.json rather than by shrinking the whole
/// roster here -- but note that visual_scale moves the ARTWORK only, so a
/// scaled petal is once again drawn at a size it does not collide at.
inline constexpr double kPetalArtSize = 20.0;

/// Design units of icon DIAMETER per unit of `size`, for a tile whose petal
/// gardn does not have.
///
/// The same figure as kPetalArtSize, and not the same constant: a tile is
/// written in its own 60-unit design cell and the world in world units, so the
/// two are free to move apart again. This is where they HAVE moved apart --
/// see kGardnIcon in the .cpp, which sizes a tile's icon from what gardn
/// actually draws rather than from any radius. This constant is only the
/// fallback for the petals gardn has never had.
inline constexpr double kPetalIconSize = 20.0;

/// gardn lifts the icon off centre to leave room for the name along the bottom
/// edge, and draws it at 50/60 of the design size.
inline constexpr double kItemTileIconRise = 5.0;
inline constexpr double kItemTileIconScale = 0.833;

/// The plate's border is the rarity colour at 0.8 HSV value -- gardn's
/// `Renderer::HSV(RARITY_COLORS[rarity], 0.8)`.
inline constexpr double kItemTilePlateShade = 0.8;

/// Draws a petal the way gardn does: one icon at the size gardn draws it, or
/// `count` of them spaced evenly on a ring and each turned to face outward.
///
/// The size is the point. A basic petal is a small disc inside its plate and a
/// bone nearly spans it, which is how a player reads a petal at a glance;
/// fitting every petal to the same box throws that away, and so does sizing
/// one by its collision radius when gardn's picture of it is twice that.
/// gardn's measured drawing size is what kGardnIcon holds; a petal gardn does
/// not have falls back to kPetalIconSize x `sizeStat` x `visual_scale`.
///
/// `maxDiameter` is a caller's backstop for that fallback and nothing more:
/// gardn's own oversize rule (shrink a petal whose radius passes 20) is
/// applied inside, and every petal it measures already fits its plate, so the
/// tile passes 0 and lets the face clip catch the rest.
///
/// `sizeStat` and `count` are the RARITY-scaled values (`petalStats`), not the
/// base ones: a mythic light is five icons where a common one is a single icon.
///
/// `facesInward` turns each icon of a stack to point at the cluster's centre
/// instead of away from it, as the world draws a `clumpFacesInward` clump.
void drawPetalCluster(Canvas&, const SpriteCache&, std::uint16_t petalIndex, Rarity rarity,
                      double sizeStat, int count, double cx, double cy, double maxDiameter,
                      double timeSeconds, bool facesInward = false);

/// What ONE icon of a petal measures inside a tile's 60-unit cell, and the
/// tilt it is drawn at.
///
/// Exposed for the tests that guard the two rules drawPetalCluster sizes by:
/// gardn's own measurement wherever gardn has the petal, and a magic petal
/// taking the measurement of the petal it is the magic form of -- the two are
/// one picture in two colours, so one measurement serves both.
struct PetalIconMetric {
    double diameter = 0;
    double tilt = 0;
};
PetalIconMetric petalIconMetric(std::uint16_t petalIndex, double sizeStat);

/// One item, and the states a surface needs to show it in.
struct ItemTile {
    std::uint16_t petalIndex = kNoPetal;  ///< an empty slot: the plate alone
    Rarity rarity = Rarity::Common;

    /// An empty cell: the panel's own colours instead of a rarity, and no
    /// contents. How the crafting grid shows a tier the account does not own.
    bool empty = false;
    std::uint32_t emptyFill = 0x9A8B70u;
    std::uint32_t emptyBorder = 0x9A8B70u;

    /// gardn always names the petal inside the plate. Off for the surfaces
    /// that caption a tile themselves -- the shop's price bar, a tile riding
    /// the cursor.
    bool showName = true;
    /// Top-right, over the icon. gardn has no badge; the inventory needs one.
    std::string badge;
    /// Centre the badge on a point just inside the tile's corner instead of
    /// ending it there. For a label longer than a count -- the oracle's
    /// "owned/price" -- which the reference lets hang past the tile's edge
    /// rather than crowding it back over the icon.
    bool badgeCentred = false;

    /// A live number printed along the tile's TOP edge, just inside the
    /// border, mirroring the name along the bottom -- what a sponge is still
    /// holding, and nothing at all for the petals that have no such number.
    /// Only the owner's own loadout bar is told, as with `reload` and
    /// `health`; every other surface leaves this empty.
    std::string counter;

    /// gardn's cooldown wedge, swept as the petal reloads. 1.0 draws nothing.
    /// The owner's own bar is the only surface the server tells about a reload;
    /// everywhere else leaves this alone and gets no sweep.
    double reload = 1.0;

    /// How much of the petal is still standing, 1.0 for untouched. The face
    /// drains from the top as it falls, until a dead slot is nothing but the
    /// plate colour. Like `reload`, only the owner's bar is told.
    double health = 1.0;

    bool hovered = false;
    bool selected = false;
    bool disabled = false;  ///< greyed out; the caller also blocks the click
    /// The plate and rim drawn in flat grey rather than the rarity's colours;
    /// the petal, its name and the badge are drawn exactly as they would be.
    /// What the oracle shows a stack it cannot yet pay for: the tile still
    /// says what it is and how many, it just does not glow like something
    /// ready to use. Unlike `disabled`, which dims the whole tile.
    bool greyed = false;

    /// The ground drop's backdrop: a larger, softer square under the plate,
    /// which is what lifts a drop off the terrain.
    bool shadow = false;

    double alpha = 1.0;
    double timeSeconds = 0.0;
};

/// Draws `tile` centred in `rect`, scaled from the 60x60 design cell to the
/// shorter of the rect's sides.
void drawItemTile(Canvas&, const SpriteCache&, Rect rect, const ItemTile& tile);

/// The viewer's talent tree, which every item tile draws its stack by: a petal
/// shows the copies this flower would field, Duplicator's extra ones included,
/// on every surface that draws a tile -- the bar, the inventory, a drop, the
/// shop, a crafting slot. One setting rather than a field each caller fills
/// in, so no surface can be the one that forgot. The App binds it once to the
/// profile NetClient keeps; unbound (a tool, a test) a tile draws the petal's
/// own count.
void setViewerSkills(const SkillSet* skills);

/// A stack count as a badge prints it: exact up to four digits, then cut to
/// K/M/B -- "12.3K", "456K", "2.1B" -- so a stack of billions still fits on
/// the tile it labels instead of running across its neighbours. Rounded DOWN:
/// a badge never claims a petal the account does not have.
std::string stackCountText(std::uint64_t count);

// ---------------------------------------------------------------------------
// How a drop moves
// ---------------------------------------------------------------------------
//
// Loot lying on the ground is never still: it breathes, it lands with a
// flourish, and it throws a burst of its own rarity's grains when it arrives.
// The world plays all three on the ground; the oracle's slot plays the same
// three -- a guaranteed upgrade arrives the way loot does, not the way a menu
// updates -- so the numbers live here, with the tile they animate, rather than
// in either one of them.

/// The breath: 1 +- 3% off a sine at 10 rad/s, one phase for every drop.
inline constexpr double kDropPulseRate = 10.0;
inline constexpr double kDropPulseAmount = 0.03;

/// A drop's scale at `timeSeconds`, at `amount` of breath (the ground's own by
/// default).
inline double dropPulse(double timeSeconds, double amount = kDropPulseAmount) {
    return 1.0 + std::sin(timeSeconds * kDropPulseRate) * amount;
}

/// The landing: it slides in from 30-50 units off, unwinding a spin of up to
/// half a turn, easing out over 400 ms.
inline constexpr double kDropLandSeconds = 0.4;
inline constexpr double kDropLandNear = 30.0;
inline constexpr double kDropLandSpread = 20.0;

/// The burst it throws as it lands. Speeds are per 60 Hz frame, lives in
/// milliseconds, sizes in the units the drop is drawn in -- the browser build's
/// own figures, which is the form the world renderer states them in.
inline constexpr int kDropBurstCount = 7;
inline constexpr double kDropBurstSpeed = 3.0;
inline constexpr double kDropBurstSpeedSpread = 3.0;
inline constexpr double kDropBurstLifeMs = 500.0;
inline constexpr double kDropBurstLifeSpreadMs = 250.0;
inline constexpr double kDropBurstSize = 7.5;
inline constexpr double kDropBurstSizeSpread = 15.0;

} // namespace flix::ui
