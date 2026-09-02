#pragma once
// The pieces every menu is assembled from.
//
// Eight panels share one card, one close button, one scrollbar, one item cell
// and one tooltip. They live here once because the alternative -- each panel
// drawing its own -- is how the browser build ended up with five copies of the
// same rounded rectangle that had all drifted a pixel apart.
//
// Nothing here holds state. Layout is the caller's business, and hover and
// press are passed in rather than tracked, so hit-testing stays with the panel
// that owns the geometry.

#include <cstdint>
#include <string>
#include <vector>

#include "canvas.h"

#include "client/render/sprites.h"
#include "client/ui/draw.h"
#include "client/ui/menu_theme.h"
#include "shared/core/types.h"
#include "shared/game/rarity.h"

namespace flr::ui {

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/// The panel card: a border-coloured rounded rect with the fill inset by the
/// border width. Two fills rather than a stroke, because a stroke centres on
/// the path and would put the outer corner at radius + border/2.
void panelCard(Canvas&, Rect, const PanelSkin&, double borderWidth = kMenuBorder,
               double radius = kMenuRadius);

/// The same two-fill treatment at an arbitrary size, for slots and buttons.
void inlaid(Canvas&, Rect, std::uint32_t fill, std::uint32_t border, double borderWidth,
            double radius, double alpha = 1.0);

/// The panel's centred title, and the instruction line under it. The tall list
/// panels use this one.
void panelTitle(Canvas&, Rect panel, const std::string& title, const std::string& subtitle = {});

/// The overlay panels put their heading in the top-left corner instead, at
/// 20px with a thin outline. Both live here so the two families of panel
/// cannot drift into three.
void panelHeading(Canvas&, Rect panel, const std::string& title);

/// Where the close button sits in a panel of these bounds.
Rect closeButtonRect(Rect panel);
/// The overlay panels' close button is bigger and hangs off the header row:
/// 30px square, 50px in from the right edge, 10px down.
Rect overlayCloseRect(Rect panel);
/// `radius` is the outer corner, `innerRadius` the face inside the 2px rim.
/// The two are NOT related by a constant: the browser spells both out per
/// panel and picks 4/3 for the inventory but 3/1 for the forge. A negative
/// `innerRadius` takes the inventory's relationship, `radius - 1`.
void closeButton(Canvas&, Rect, bool hovered, const PanelSkin&, double radius = 4.0,
                 double innerRadius = -1.0);

/// A flat rounded header button with a centred, unstroked label -- the pill
/// the overlay panels put in their top-right corner ("Refresh", "Mark All
/// Read"). No border and no outline on the text: it sits on a known panel
/// colour and an outline there reads as a second, heavier control.
void pillButton(Canvas&, Rect, const std::string& label, std::uint32_t fill,
                double textSize = 14.0);

/// A small labelled button: the panel chrome's Switch, Craft, Reset, Refresh.
struct ChipStyle {
    std::uint32_t fill = kControlMid;
    std::uint32_t border = kControlDark;
    std::uint32_t hoverFill = 0xFFFFFFFFu;   ///< sentinel: lighten `fill` by 15%
    double radius = 5.0;
    double textSize = 13.0;
    bool enabled = true;
};
void chip(Canvas&, Rect, const std::string& label, bool hovered, const ChipStyle& = {});

/// The gardn toggle: a dark square whose inner rect lerps to light when on.
/// `lerp` is 0..1 and is the caller's to animate, so the widget stays pure.
void toggleBox(Canvas&, Rect, double lerp);

/// A text field's chrome plus its contents, with a blinking caret when focused.
/// The panels type into a plain std::string; there is no IME to hand off to.
void inputField(Canvas&, Rect, const std::string& value, const std::string& placeholder,
                bool focused, double timeSeconds);

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
    /// The browser tooltip is regular weight at every size, including its 20px
    /// name row; `bold` is here for the panels that still ask for it.
    bool bold = false;
    /// Stat rows are white at 0.56 -- gardn's 0xffffff90 -- rather than a
    /// pre-mixed grey, so they dim consistently over whatever they land on.
    double alpha = 1.0;
    /// Greedily word-wraps the row at this content width. Zero never wraps.
    double maxWidth = 0.0;
    /// Rendered instead of `text` while ALT is held: the exact value behind an
    /// abbreviated one. Empty means the row has no alternate.
    std::string altText;

    TooltipLine(std::string body = {}, double size = 12.0, std::uint32_t color = kPaper,
                double gapBefore = 0.0, bool bold = false)
        : text(std::move(body)), size(size), color(color), gapBefore(gapBefore), bold(bold) {}
};

/// Box size for these lines, without drawing. `alt` must match the value the
/// paint pass is given, or the box and its contents disagree.
Vec2 measureTooltip(const std::vector<TooltipLine>&, double minWidth = 0, double extraHeight = 0,
                    bool alt = false);

/// Paints the box with its top-left at (x, y) and returns the content rect, so
/// a caller can draw a drop table into the space `extraHeight` reserved.
Rect paintTooltip(Canvas&, double x, double y, const std::vector<TooltipLine>&,
                  double minWidth = 0, double extraHeight = 0, bool alt = false);

/// Places a tooltip near the cursor and keeps it inside the viewport. The
/// usual case: a box that would run off the right edge flips to the left of
/// the cursor rather than being clamped into it.
Vec2 tooltipAnchor(Vec2 cursor, Vec2 size, double viewWidth, double viewHeight);

/// Places a tooltip beside the CELL it describes, which is what the browser
/// does: right of the anchor, flipped to its left when that would overflow,
/// top-aligned with it and clamped into the viewport. Preferred over the
/// cursor-anchored form -- a box that follows the pointer slides around under
/// it and covers the thing being read.
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

/// Trims `text` to fit `width` at `size`, appending an ellipsis when it must.
std::string ellipsize(const std::string& text, double size, bool bold, double width);

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

/// The scroll state every list panel keeps. Clamping lives here because the
/// content height changes under the offset -- an inventory that shrinks while
/// scrolled to the bottom must not leave the view past the end.
struct Scroller {
    double offset = 0;
    double contentHeight = 0;
    double viewHeight = 0;

    double maxOffset() const {
        const double slack = contentHeight - viewHeight;
        return slack > 0 ? slack : 0;
    }
    /// Applies a wheel delta and re-clamps. `wheel` is the window's raw
    /// delta: positive is a scroll up, which moves the content down.
    void update(double wheel, bool hovering) {
        if (hovering) offset -= wheel * 42.0;
        offset = clamp(offset, 0.0, maxOffset());
    }
};

} // namespace flr::ui
