#pragma once
// The stateful pieces every menu is assembled from.
//
// The card, its headings and every button are in client/ui/menu_style.h --
// pure shape, no state -- and the text inputs are draw.h's. What is left here
// is the chrome a panel has to feed something to: a toggle's animation, a
// scrollbar's offset, a tooltip's contents. Included from there rather than
// beside it, so a panel that wants the whole toolkit still only names this
// file.
//
// Nothing here holds state either. Layout is the caller's business, and hover
// and press are passed in rather than tracked, so hit-testing stays with the
// panel that owns the geometry.

#include <cstdint>
#include <string>
#include <vector>

#include "canvas.h"

#include "client/ui/draw.h"
#include "client/ui/menu_style.h"
#include "client/ui/menu_theme.h"
#include "shared/core/types.h"

namespace flix::ui {

// ---------------------------------------------------------------------------
// Interactive chrome
// ---------------------------------------------------------------------------

/// The gardn toggle: a dark square whose inner rect lerps to light when on.
/// `lerp` is 0..1 and is the caller's to animate, so the widget stays pure.
void toggleBox(Canvas&, Rect, double lerp);

// Text inputs are client/ui/draw.h's inputField: one look for every field.

/// A vertical scrollbar down the right of `view`. Draws nothing when the
/// content fits, so callers need not test first.
void scrollbar(Canvas&, Rect view, double contentHeight, double scroll, std::uint32_t thumb,
               double width = 10.0);

// ---------------------------------------------------------------------------
// Item cells
// ---------------------------------------------------------------------------
//
// There is exactly one, and it lives in client/ui/item_tile.h. Every grid,
// slot, card and ground drop draws `ui::drawItemTile`. This file used to carry
// a second one (`itemCell`, a rounded plate with a fitted icon) that the
// inventory and the crafting grid used while the loadout bar drew gardn's; the
// two were visibly different objects for the same petal.

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

/// One row of a tooltip.
///
/// Constructed rather than aggregate-initialised: the fields the browser grew
/// later -- the dim alpha, the wrap width and the ALT variant -- are set by
/// name after the fact, so no existing brace-init has to spell them out and
/// none can silently shift meaning when another is added.
struct TooltipLine {
    std::string text;
    double size = 12.0;
    std::uint32_t color = kPaper;
    double gapBefore = 0.0;
    /// Stat rows are white at 0.56 -- gardn's 0xffffff90 -- rather than a
    /// pre-mixed grey, so they dim consistently over whatever they land on.
    double alpha = 1.0;
    /// Greedily word-wraps the row at this content width. Zero never wraps.
    double maxWidth = 0.0;
    /// Rendered instead of `text` while ALT is held: the exact value behind an
    /// abbreviated one. Empty means the row has no alternate.
    std::string altText;

    TooltipLine(std::string body = {}, double size = 12.0, std::uint32_t color = kPaper,
                double gapBefore = 0.0)
        : text(std::move(body)), size(size), color(color), gapBefore(gapBefore) {}
};

/// Box size for these lines, without drawing. `alt` must match the value the
/// paint pass is given, or the box and its contents disagree.
Vec2 measureTooltip(const std::vector<TooltipLine>&, double minWidth = 0, double extraHeight = 0,
                    bool alt = false);

/// Paints the box with its top-left at (x, y) and returns the content rect, so
/// a caller can draw a drop table into the space `extraHeight` reserved.
Rect paintTooltip(Canvas&, double x, double y, const std::vector<TooltipLine>&,
                  double minWidth = 0, double extraHeight = 0, bool alt = false);

/// Places a tooltip beside the CELL it describes, which is what the browser
/// does: right of the anchor, flipped to its left when that would overflow,
/// top-aligned with it and clamped into the viewport. Never anchored to the
/// cursor: a box that follows the pointer slides around under it and covers
/// the thing being read.
Vec2 tooltipAnchor(Rect anchor, Vec2 size, double viewWidth, double viewHeight);

/// The 200 ms the browser waits before a tooltip appears, and the mouse-down
/// that cancels it. One per hoverable grid; `update` is called every frame
/// with whatever is under the pointer.
struct TooltipDelay {
    static constexpr double kDelaySeconds = 0.2;
    int hovered = -1;
    double since = 0;
    bool suppressed = false;

    /// True once `index` has been hovered long enough to paint. `index` is -1
    /// for "nothing hovered"; `pointerDown` suppresses the tooltip until the
    /// pointer leaves the cell, exactly as a mousedown does in the browser.
    bool update(int index, double timeSeconds, bool pointerDown);
    void reset() { *this = TooltipDelay{}; }
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/// "poison_cactus" -> "Poison Cactus". The one place ids become prose.
std::string titleCase(const std::string& id);

/// 19725 -> "19.7K". Used wherever a stat would otherwise overflow its cell.
/// Uppercase suffix, as `abbreviateNumber` produces.
std::string abbreviate(double value);

/// A count with thousands separators, for prices and XP totals.
std::string withSeparators(double value);

/// `value` to exactly `decimals` places, as printf's `%.*f` writes it: a
/// readout that keeps its trailing zero, where `abbreviate` drops it.
std::string fixedDecimals(double value, int decimals);

/// The reference's formatNumber: one decimal and a magnitude letter past a
/// thousand (1e3 K, 1e6 M, 1e9 B, 1e12 T, as "%.1f%s"), the rounded whole
/// number below it. Unlike `abbreviate` it keeps the ".0", and it has no
/// tier past T. The target dummy's DPS readout is written this way.
std::string formatCompact(double value);

/// Trims `text` to fit `width` at `size`, appending an ellipsis when it must.
/// Trimmed a whole UTF-8 character at a time, never a byte.
std::string ellipsize(const std::string& text, double size, double width);

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

/// The scroll state every list panel keeps. The bound lives here because the
/// content height changes under the offset -- an inventory that shrinks while
/// scrolled to the bottom must not leave the view past the end -- so a panel
/// applies its own wheel step and clamps against maxOffset() every frame.
struct Scroller {
    double offset = 0;
    double contentHeight = 0;
    double viewHeight = 0;

    double maxOffset() const {
        const double slack = contentHeight - viewHeight;
        return slack > 0 ? slack : 0;
    }
};

} // namespace flix::ui
