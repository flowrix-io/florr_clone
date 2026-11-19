#pragma once

// The petal tooltip, on every surface that draws a petal.
//
// The inventory used to be the only place a petal said what it was. Now every
// tile drawItemTile paints onto the screen reports where it landed, and the one
// under the pointer gets the inventory's own tooltip -- at once, fading in as
// the pointer arrives and out as it leaves, and hidden by a press -- in the
// shop, the loadout bar, the crafting card,
// the oracle, the trader, the titan, the assembler, the run's loot, all alike.
//
// On a touchscreen, where nothing hovers, a tap reads a petal instead: its card
// stays up after the finger lifts, and a petal being dragged shows its card
// beside the finger.
//
// One tooltip a frame: the LAST tile under the pointer wins, because it is the
// one painted on top. Something opaque painted over a tile afterwards (an open
// panel over the loadout bar) says so through coverPetalHover, so a petal the
// player cannot see does not answer for the pointer.
//
// File-wide state, set once a frame by the menu system, in the same spirit as
// setViewerSkills: no surface has to remember to opt in, so none can be the
// one that forgot.

#include <cstdint>
#include <vector>

#include "client/ui/menu_widgets.h"
#include "shared/core/types.h"
#include "shared/game/rarity.h"

class Canvas;
class Window;

namespace flix {
struct Profile;
struct DragState;
struct SkillSet;
}  // namespace flix

namespace flix::ui {

/// The inventory's petal tooltip rows: name, tier, description and stats,
/// with HP and damage at the account's talents and the reload at
/// `reloadScale` (defined in menu_inventory.cpp, beside the rows it builds).
/// `flowerHealth` is the viewer's own max health before petals -- what a
/// health multiplier is shown as a number of.
std::vector<TooltipLine> petalTooltip(std::uint16_t petalIndex, Rarity rarity,
                                      const SkillSet& skills, double reloadScale,
                                      double flowerHealth);

/// Starts a frame's collection. `screen` is the canvas the frame is shown on,
/// at its base transform -- design units, which is what the pointer is in.
/// Tiles drawn on any other canvas (a cached picture, a scratch layer) are
/// not on the screen where they were drawn, and are ignored.
void beginPetalHover(const Canvas& screen, double mouseX, double mouseY);

/// A tile drawn on `canvas` into `rect`, under the canvas's current transform.
/// drawItemTile calls this for every filled tile; nothing else needs to.
void notePetalHover(const Canvas& canvas, Rect rect, std::uint16_t petalIndex, Rarity rarity);

/// The same, for a caller that knows the tile's box in design units already --
/// one painted through a scratch layer, which notePetalHover cannot place.
void notePetalHoverAt(Rect designRect, std::uint16_t petalIndex, Rarity rarity);

/// Something opaque was painted over `designRect`: a tile noted before it,
/// under the pointer, is hidden and no longer answers.
void coverPetalHover(Rect designRect);

/// Limits what is noted to `rect` (on `canvas`, under its current transform)
/// for as long as it lives: a scrolled list's tiles are clipped to its view,
/// and a tile scrolled half out of sight must not answer for the part of it
/// that is not drawn.
class PetalHoverClip {
public:
    PetalHoverClip(const Canvas& canvas, Rect rect);
    ~PetalHoverClip();
    PetalHoverClip(const PetalHoverClip&) = delete;
    PetalHoverClip& operator=(const PetalHoverClip&) = delete;

private:
    bool hadClip_ = false;
    Rect previous_{};
};

/// Paints the tooltip for the petal under the pointer, fading it in, and
/// fading out the last one shown once nothing is. Last thing in the frame's
/// menu layer, over everything a tile could have been drawn on.
void paintPetalHover(Canvas& canvas, Window& window, const DragState& drag,
                     const Profile& profile, double timeSeconds);

}  // namespace flix::ui
