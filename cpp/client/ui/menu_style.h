#pragma once
// The card and the buttons every menu is built from.
//
// A menu in this game is two things: a frame and the controls on it. Both used
// to be re-derived per panel -- seven copies of the same rounded-rect helper,
// three close crosses that differed only in their line cap, and four different
// answers to "what does a panel's edge look like". This file is the one answer.
//
// The frame is the OVERLAY CARD: a rounded rect in the border colour with the
// body inset into it, which is the shape the settings and guild panels were
// already drawing by hand. It is not a stroke. A stroke centres on the path,
// so half of it lands outside the card and the outer corner is cut to
// radius + width/2; the two-fill form keeps the outer radius intact and the
// border reads as a frame the body sits in rather than a line drawn over it.
//
// Nothing here holds state. Layout, hover and press are the caller's business,
// so hit-testing stays with the panel that owns the geometry.

#include <cstdint>
#include <string>

#include "canvas.h"

#include "client/ui/draw.h"
#include "client/ui/menu_theme.h"
#include "shared/core/types.h"

namespace flix::ui {

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/// Begins a rounded-rect path. Everything below is built from this; call it
/// directly when you need a clip or a stroke this file has no name for.
void roundPath(Canvas&, Rect, double radius);

void fillRound(Canvas&, Rect, double radius, std::uint32_t rgb, double alpha = 1.0);
void strokeRound(Canvas&, Rect, double radius, std::uint32_t rgb, double width);

/// A filled five-point star about `centre`: its points `radius` out, its
/// notches at 0.45 of that, the first point straight up. What the shop and the
/// notifications draw where the shipped face has no star glyph to type.
void fillStar(Canvas&, Vec2 centre, double radius, std::uint32_t rgb);

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/// A CARD: a rounded rect in the border colour with a SQUARE body dropped into
/// it. The reference draws every panel this way -- one `round_rect` fill, then
/// a plain `ctx.rect()` for the body (Ui::Element::on_render) -- and that
/// square shoulder inside a soft outer corner is what makes the frame read as
/// a frame rather than as a second, smaller card.
///
/// Panels only. A button's face stays rounded (`inlaid` below): the reference
/// gives its controls one filled round_rect and a stroke, so nothing about
/// them has a square shoulder to match.
void cardFrame(Canvas&, Rect, std::uint32_t fill, std::uint32_t border, double borderWidth,
               double radius);

/// The overlay panels' frame. Thick enough to read as a border at a distance,
/// and a corner just round enough to soften it.
inline constexpr double kOverlayBorder = 4.0;
inline constexpr double kOverlayRadius = 6.0;

/// The frame the corner overlays wear: settings, changelog, notifications,
/// leaderboard, skins, gallery, shop, debug and the two admin cards -- the
/// guild's card is a `panelCard`. Use it for the panel itself; `inlaid` below
/// is the button treatment, for the controls on it.
void overlayCard(Canvas&, Rect, std::uint32_t fill, std::uint32_t border);
void overlayCard(Canvas&, Rect, const PanelSkin&);

/// The two-fill treatment at an arbitrary size, for slots and buttons. Unlike
/// `cardFrame` the inner corner is ROUNDED, derived as `radius - 2`: this is
/// the controls' shape, and a square-shouldered chip at 20px tall reads as a
/// mis-drawn panel rather than as a button.
void inlaid(Canvas&, Rect, std::uint32_t fill, std::uint32_t border, double borderWidth,
            double radius, double alpha = 1.0);

/// The tall list panels' card: `cardFrame` with the panel's own border width
/// and radius.
void panelCard(Canvas&, Rect, const PanelSkin&, double borderWidth = kMenuBorder,
               double radius = kMenuRadius);

/// The panel's centred title, and the instruction line under it. The tall list
/// panels use this one.
void panelTitle(Canvas&, Rect panel, const std::string& title, const std::string& subtitle = {});

/// The overlay panels put their heading in the top-left corner instead, at
/// 20px with a thin outline. Both live here so the two families of panel
/// cannot drift into three.
void panelHeading(Canvas&, Rect panel, const std::string& title);

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/// Where the close button sits in a panel of these bounds. Every panel that
/// hangs one off its own top-right corner uses this; the shop, whose header is
/// a plate inside the card, positions its own inside that plate.
Rect closeButtonRect(Rect panel);

/// THE close button. One size, one pair of radii, one colour, one hover.
///
/// There is deliberately no skin, no radius and no size parameter: every panel
/// that took one grew its own dialect of this button -- a flat pill here, a
/// translucent plate there, a framed square somewhere else -- and the control a
/// player reaches for without looking ended up different on every card. Draw it
/// at `closeButtonRect` unless the panel's header genuinely is not the card's
/// corner, and size that rect kCloseSize either way.
void panelClose(Canvas&, Rect, bool hovered);

/// A flat rounded header button with a centred, unstroked label -- the pill
/// the overlay panels put in their top-right corner ("Refresh", "Mark All
/// Read"). No border and no outline on the text: it sits on a known panel
/// colour and an outline there reads as a second, heavier control.
void pillButton(Canvas&, Rect, const std::string& label, std::uint32_t fill,
                double textSize = 14.0);

/// The cross inside a close control, drawn rather than typed: the reference's
/// glyph is U+2715, which the bundled Ubuntu has no coverage for. The browser
/// falls back to a system face for it and this font would paint its .notdef
/// box instead.
///
/// `arm` is the half-diagonal, `width` the ink and `roundCap` the cap. The
/// weight is set by INK rather than by the glyph's apparent stroke: over a
/// 16x16 box the browser's cross covers 50.1px of white, so two round-capped
/// arms of 15.6px overlapping once solve to 1.6.
void closeCross(Canvas&, Rect, double arm, double width, bool roundCap);

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

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/// Body text on a panel: white, outlined hard enough to read over a saturated
/// fill or a mob sprite, and never over-stroked at small sizes.
TextStyle labelStyle(double size, std::uint32_t fill);

/// Stroke-then-fill text whose OUTLINE carries an alpha -- the forge's and the
/// oracle's labels, which are stroked at 60% where every other panel strokes
/// solid black. Always round-joined; see the definition.
void outlinedText(Canvas&, const std::string& s, double x, double y, const TextStyle& style,
                  double strokeAlpha);

/// The bold, round-joined label style those two panels set every line in.
TextStyle panelLabel(double size, Align align, Baseline baseline);

} // namespace flix::ui
