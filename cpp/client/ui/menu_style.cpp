#include "client/ui/menu_style.h"

#include <algorithm>
#include <cmath>

#include "client/ui/text.h"

namespace flr::ui {

namespace {

/// Body text on a panel: white, outlined hard enough to read over a saturated
/// fill or a mob sprite, and never over-stroked at small sizes.
TextStyle labelStyle(double size, bool bold, std::uint32_t fill, double stroke) {
    TextStyle style;
    style.size = size;
    style.bold = bold;
    style.fill = fill;
    style.stroke = kInk;
    style.strokeWidth = stroke;
    return style;
}

/// The close button's cross is inset by this fraction of the button's width on
/// every side. 0.27 of the overlay panels' 30px box is the reference's literal
/// 8px pad, and expressing it as a ratio is what lets the 26px button in the
/// tall list panels wear the same cross.
constexpr double kCrossPadRatio = 0.27;

/// The hover face of every close button in the game. A literal swatch, not a
/// tint of the skin: both reference panels hover to the same light rose
/// regardless of the button's own pink, and deriving it from #bb5b61 lands on
/// a desaturated brown instead.
constexpr std::uint32_t kCloseHover = 0xE8A0B0u;

} // namespace

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

void roundPath(Canvas& canvas, Rect r, double radius) {
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h), static_cast<float>(radius));
}

void fillRound(Canvas& canvas, Rect r, double radius, std::uint32_t rgb, double alpha) {
    if (r.w <= 0 || r.h <= 0) return;
    setFill(canvas, rgb, alpha);
    roundPath(canvas, r, radius);
    canvas.fill();
}

void strokeRound(Canvas& canvas, Rect r, double radius, std::uint32_t rgb, double width) {
    if (r.w <= 0 || r.h <= 0) return;
    canvas.save();
    setStroke(canvas, rgb);
    canvas.setLineWidth(static_cast<float>(width));
    roundPath(canvas, r, radius);
    canvas.stroke();
    canvas.restore();
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

void overlayCard(Canvas& canvas, Rect r, std::uint32_t fill, std::uint32_t border) {
    if (r.w <= 0 || r.h <= 0) return;
    fillRound(canvas, r, kOverlayRadius, border);
    fillRound(canvas, overlayBody(r), kOverlayInnerRadius, fill);
}

void overlayCard(Canvas& canvas, Rect r, const PanelSkin& skin) {
    overlayCard(canvas, r, skin.fill, skin.border);
}

void inlaid(Canvas& canvas, Rect r, std::uint32_t fill, std::uint32_t border, double borderWidth,
            double radius, double alpha) {
    if (r.w <= 0 || r.h <= 0) return;
    canvas.setGlobalAlpha(static_cast<float>(clamp(alpha, 0.0, 1.0)));
    setFill(canvas, border);
    roundPath(canvas, r, radius);
    canvas.fill();

    const double inset = std::min(borderWidth, std::min(r.w, r.h) * 0.5);
    setFill(canvas, fill);
    roundPath(canvas, Rect{r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2},
              std::max(0.0, radius - 2.0));
    canvas.fill();
    canvas.setGlobalAlpha(1.0f);
}

void panelCard(Canvas& canvas, Rect r, const PanelSkin& skin, double borderWidth, double radius) {
    inlaid(canvas, r, skin.fill, skin.border, borderWidth, radius);
}

void panelTitle(Canvas& canvas, Rect panel, const std::string& title,
                const std::string& subtitle) {
    // Round-joined: every panel sets ctx.lineJoin = 'round' before its title
    // and drawText inherits it. At a 4px stroke a miter grows spikes off the
    // sharp corners of 'v' and 'y'.
    TextStyle heading = labelStyle(kMenuTitleSize, true, kPaper, 4.0);
    heading.align = Align::Centre;
    heading.baseline = Baseline::Top;
    heading.roundJoin = true;
    text(canvas, title, panel.x + panel.w * 0.5, panel.y + kMenuPadding, heading);

    if (subtitle.empty()) return;
    TextStyle sub = labelStyle(kMenuSubtitleSize, true, kPaper, 3.0);
    sub.align = Align::Centre;
    sub.baseline = Baseline::Top;
    sub.roundJoin = true;
    text(canvas, subtitle, panel.x + panel.w * 0.5, panel.y + kMenuPadding + 28.0, sub);
}

void panelHeading(Canvas& canvas, Rect panel, const std::string& title) {
    TextStyle heading = labelStyle(20.0, true, kPaper, 2.0);
    heading.baseline = Baseline::Top;
    text(canvas, title, panel.x + kMenuPadding + 6.0, panel.y + kMenuPadding + 6.0, heading);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

Rect closeButtonRect(Rect panel) {
    return {panel.right() - kMenuPadding - kCloseSize, panel.y + kMenuPadding - 4.0, kCloseSize,
            kCloseSize};
}

Rect overlayCloseRect(Rect panel) {
    return {panel.right() - 50.0, panel.y + 10.0, 30.0, 30.0};
}

void closeCross(Canvas& canvas, Rect r, double arm, double width, bool roundCap) {
    const double cx = r.x + r.w * 0.5;
    const double cy = r.y + r.h * 0.5;
    canvas.save();
    setStroke(canvas, kPaper);
    canvas.setLineWidth(static_cast<float>(width));
    canvas.setLineCap(roundCap ? "round" : "butt");
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(cx - arm), static_cast<float>(cy - arm));
    canvas.lineTo(static_cast<float>(cx + arm), static_cast<float>(cy + arm));
    canvas.moveTo(static_cast<float>(cx + arm), static_cast<float>(cy - arm));
    canvas.lineTo(static_cast<float>(cx - arm), static_cast<float>(cy + arm));
    canvas.stroke();
    canvas.restore();
}

void closeButton(Canvas& canvas, Rect r, bool hovered, const PanelSkin& skin, double radius,
                 double innerRadius) {
    // Not inlaid(): that derives the inner corner as radius - 2, and neither
    // reference panel uses that relationship (inventory 4/3, forge 3/1).
    const double inner = innerRadius < 0 ? std::max(0.0, radius - 1.0) : innerRadius;
    fillRound(canvas, r, radius, skin.closeBorder);
    fillRound(canvas, Rect{r.x + 2.0, r.y + 2.0, r.w - 4.0, r.h - 4.0}, inner,
              hovered ? kCloseHover : skin.close);
    closeCross(canvas, r, r.w * (0.5 - kCrossPadRatio), 2.5, true);
}

void pillButton(Canvas& canvas, Rect r, const std::string& label, std::uint32_t fill,
                double textSize) {
    fillRound(canvas, r, 5.0, fill);

    TextStyle caption = labelStyle(textSize, false, kPaper, 0.0);
    caption.align = Align::Centre;
    text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5, caption);
}

void closeCrossPill(Canvas& canvas, Rect r, std::uint32_t fill) {
    fillRound(canvas, r, 5.0, fill);
    // The cross is sized to the 11px span the browser's fallback face produces
    // for U+2715 at 16px; only the ink is solved for, never the arm length.
    closeCross(canvas, r, 5.5, 1.6, true);
}

void framedButton(Canvas& canvas, Rect r, const std::string& label, std::uint32_t labelColor,
                  std::uint32_t frame, bool hovered) {
    fillRound(canvas, r, 4.0, frame);
    // The interior is a wash rather than a colour, so the frame stays the only
    // thing that says what the button is.
    fillRound(canvas, Rect{r.x + 2.0, r.y + 2.0, r.w - 4.0, r.h - 4.0}, 3.0,
              hovered ? kPaper : kInk, hovered ? 0.22 : 0.25);

    TextStyle caption = labelStyle(13.0, true, labelColor, 3.0);
    caption.align = Align::Centre;
    caption.roundJoin = true;
    // The label sits a pixel below the button's middle: at 13px bold the
    // stroked cap height reads high without it.
    text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5 + 1.0, caption);
}

void framedCloseButton(Canvas& canvas, Rect r, bool hovered, const PanelSkin& skin) {
    closeButton(canvas, r, hovered, skin, 4.0, 3.0);
}

void chip(Canvas& canvas, Rect r, const std::string& label, bool hovered, const ChipStyle& style) {
    const std::uint32_t hoverFill =
        style.hoverFill == 0xFFFFFFFFu ? lighten(style.fill, 0.15) : style.hoverFill;
    const std::uint32_t fill = style.enabled ? (hovered ? hoverFill : style.fill) : 0x8A8A8Au;
    const std::uint32_t border = style.enabled ? style.border : 0x5A5A5Au;
    inlaid(canvas, r, fill, border, 2.0, style.radius, style.enabled ? 1.0 : 0.45);

    TextStyle caption = labelStyle(style.textSize, true, kPaper, 3.0);
    caption.align = Align::Centre;
    text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5, caption);
}

} // namespace flr::ui
