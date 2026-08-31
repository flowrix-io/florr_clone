#include "client/ui/draw.h"

#include "client/ui/text.h"

#include <algorithm>
#include <cmath>

namespace flr::ui {

namespace {

Color toColor(std::uint32_t rgb, double alpha) {
    return Color{
        static_cast<std::uint8_t>((rgb >> 16) & 0xFF),
        static_cast<std::uint8_t>((rgb >> 8) & 0xFF),
        static_cast<std::uint8_t>(rgb & 0xFF),
        static_cast<std::uint8_t>(clamp(alpha, 0.0, 1.0) * 255.0 + 0.5),
    };
}

/// Where the pen starts, given an alignment and the text's measured width.
double originX(double x, double width, Align align) {
    switch (align) {
        case Align::Centre: return x - width * 0.5;
        case Align::Right: return x - width;
        default: return x;
    }
}

/// The baseline for a requested vertical anchor. Canvas names these after the
/// em box; ascent is positive and descent is negative, as the font stores them.
double baselineY(double y, double size, Baseline baseline, bool bold) {
    switch (baseline) {
        case Baseline::Top: return y + ascent(size, bold);
        case Baseline::Bottom: return y + descent(size, bold);
        default: return y + (ascent(size, bold) + descent(size, bold)) * 0.5;
    }
}

} // namespace

void setFill(Canvas& canvas, std::uint32_t rgb, double alpha) {
    canvas.setFillStyle(toColor(rgb, alpha));
}

void setStroke(Canvas& canvas, std::uint32_t rgb, double alpha) {
    canvas.setStrokeStyle(toColor(rgb, alpha));
}

void text(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style) {
    if (s.empty() || !Fonts::ready()) return;

    Path2D glyphs;
    appendGlyphs(glyphs, s, originX(x, measure(s, style.size, style.bold), style.align),
                 baselineY(y, style.size, style.baseline, style.bold), style.size,
                 style.bold);
    if (glyphs.empty()) return;

    const double strokeWidth =
        style.strokeWidth < 0 ? style.size * kTextStrokeRatio : style.strokeWidth;

    // Stroke first, then fill. The other order eats the glyph with its own
    // outline, which is what every hand-rolled attempt at this gets wrong.
    if (strokeWidth > 0) {
        canvas.setLineJoin("miter");
        canvas.setLineCap("butt");
        canvas.setLineWidth(static_cast<float>(strokeWidth));
        setStroke(canvas, style.stroke);
        canvas.stroke(glyphs);
    }

    setFill(canvas, style.fill);
    canvas.fill(glyphs, "nonzero");

}

double textWidth(Canvas&, const std::string& s, double size, bool bold) {
    return measure(s, size, bold);
}

void plate(Canvas& canvas, Rect r, std::uint32_t fill, double radius,
           std::uint32_t outline, double outlineWidth, double alpha) {
    if (r.w <= 0 || r.h <= 0) return;
    const double width = outlineWidth < 0 ? outlineFor(std::min(r.w, r.h)) : outlineWidth;
    // Inset by half the stroke so the outline sits inside the requested
    // rectangle; a centred stroke would make every panel silently larger than
    // the layout that positioned it.
    const double inset = width * 0.5;
    const double clampedRadius = std::min(radius, std::min(r.w, r.h) * 0.5);

    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x + inset), static_cast<float>(r.y + inset),
                     static_cast<float>(std::max(0.0, r.w - width)),
                     static_cast<float>(std::max(0.0, r.h - width)),
                     static_cast<float>(std::max(0.0, clampedRadius - inset)));
    setFill(canvas, fill, alpha);
    canvas.fill();
    if (width > 0) {
        setStroke(canvas, outline, alpha);
        canvas.setLineWidth(static_cast<float>(width));
        canvas.setLineJoin("round");
        canvas.stroke();
    }
}

void panel(Canvas& canvas, Rect r, double alpha) {
    plate(canvas, r, kPanel, kPanelRadius, kPanelDark, 4.0, alpha);
}

void button(Canvas& canvas, Rect r, const std::string& label, bool hovered, bool pressed,
            const ButtonStyle& style) {
    std::uint32_t fill = style.fill;
    if (!style.enabled) fill = shade(fill, 0.45);
    else if (pressed) fill = shade(fill, 0.9);
    else if (hovered) fill = shade(fill, 1.1);

    const Rect box = r;
    const std::uint32_t outline = style.outline == 0xFFFFFFFFu
        ? shade(style.fill, 0.8)
        : style.outline;
    plate(canvas, box, fill, style.radius, outline, style.outlineWidth);

    TextStyle ts;
    ts.size = style.textSize;
    ts.bold = true;
    ts.strokeWidth = style.textStrokeWidth;
    ts.align = Align::Centre;
    ts.baseline = Baseline::Middle;
    ts.fill = style.enabled ? kPaper : shade(kPaper, 0.65);
    text(canvas, label, box.x + box.w * 0.5, box.y + box.h * 0.5, ts);
}

void bar(Canvas& canvas, Rect r, double fraction, std::uint32_t fill,
         std::uint32_t back, double radius) {
    if (r.w <= 0 || r.h <= 0) return;
    const double rad = radius < 0 ? r.h * 0.5 : radius;
    plate(canvas, r, back, rad);

    const double clamped = clamp(fraction, 0.0, 1.0);
    if (clamped <= 0) return;

    const double outline = outlineFor(r.h);
    const double innerH = std::max(0.0, r.h - outline * 2);
    const double innerW = std::max(0.0, r.w - outline * 2) * clamped;
    // Below the corner radius the fill would render as a sliver of the wrong
    // shape; drawing nothing reads better than a stray dot.
    if (innerW < 1.0 || innerH < 1.0) return;

    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x + outline), static_cast<float>(r.y + outline),
                     static_cast<float>(innerW), static_cast<float>(innerH),
                     static_cast<float>(std::min(rad, innerH * 0.5)));
    setFill(canvas, fill);
    canvas.fill();
}

void disc(Canvas& canvas, Vec2 centre, double radius, std::uint32_t fill,
          std::uint32_t outline, double outlineWidth, double alpha) {
    if (radius <= 0) return;
    const double width = outlineWidth < 0 ? outlineFor(radius * 2) : outlineWidth;
    setFill(canvas, fill, alpha);
    canvas.fillCircle(static_cast<float>(centre.x), static_cast<float>(centre.y),
                      static_cast<float>(radius));
    if (width > 0) {
        setStroke(canvas, outline, alpha);
        canvas.setLineWidth(static_cast<float>(width));
        canvas.strokeCircle(static_cast<float>(centre.x), static_cast<float>(centre.y),
                            static_cast<float>(radius));
    }
}

void scrim(Canvas& canvas, double alpha) {
    setFill(canvas, kShade, alpha);
    canvas.fillRect(0, 0, static_cast<float>(canvas.width()), static_cast<float>(canvas.height()));
}

void textField(Canvas& canvas, Rect r, const std::string& value, const std::string& placeholder,
               bool focused, bool masked, double timeSeconds,
               const TextFieldStyle& style) {
    const double width = focused ? style.focusedOutlineWidth : style.outlineWidth;
    plate(canvas, r, style.fill, style.radius,
          focused ? style.focusedOutline : style.outline, width);

    const double padding = 10.0;
    const double textSize = std::min(kBodySize + 2.0, r.h * 0.5);

    std::string shown = value;
    if (masked) shown.assign(value.size(), '*');

    TextStyle ts;
    ts.size = textSize;
    ts.baseline = Baseline::Middle;
    ts.strokeWidth = style.textStrokeWidth;

    if (shown.empty() && !focused) {
        ts.fill = style.textStrokeWidth > 0 ? kPaper : shade(kPaper, 0.55);
        text(canvas, placeholder, r.x + padding, r.y + r.h * 0.5, ts);
        return;
    }

    ts.fill = kPaper;
    text(canvas, shown, r.x + padding, r.y + r.h * 0.5, ts);

    if (focused) {
        // A caret that blinks on a wall-clock cycle, so it keeps a steady
        // rhythm regardless of frame rate.
        const bool visible = std::fmod(timeSeconds, 1.0) < 0.5;
        if (visible) {
            const double caretX = r.x + padding + textWidth(canvas, shown, textSize);
            setStroke(canvas, kPaper);
            canvas.setLineWidth(2.0f);
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(caretX + 1), static_cast<float>(r.y + 8));
            canvas.lineTo(static_cast<float>(caretX + 1), static_cast<float>(r.bottom() - 8));
            canvas.stroke();
        }
    }
}

} // namespace flr::ui
