#include "client/ui/draw.h"

#include "client/ui/text.h"
#include "client/ui/text_select.h"
#ifdef __EMSCRIPTEN__
#include "client/ui/text_atlas.h"
#else
#include "client/ui/text_cache.h"
#endif

#include <algorithm>
#include <cmath>

namespace flix::ui {

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
double baselineY(double y, double size, Baseline baseline) {
    switch (baseline) {
        case Baseline::Top: return y + ascent(size);
        case Baseline::Bottom: return y + descent(size);
        case Baseline::Alphabetic: return y;
        default: return y + (ascent(size) + descent(size)) * 0.5;
    }
}

/// The rounded box every gardn-style control is built from: fill the path,
/// then stroke it CENTRED, exactly as `drawGardnButton` does. The stroke sits
/// half outside `r`, which is why nothing here insets first -- a control that
/// shrank to fit its own outline would no longer line up with the browser's.
void strokedBox(Canvas& canvas, Rect r, double radius, std::uint32_t fill, double fillAlpha,
                std::uint32_t outline, double outlineWidth, double outlineAlpha) {
    if (r.w <= 0 || r.h <= 0) return;
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h),
                     static_cast<float>(std::min(radius, std::min(r.w, r.h) * 0.5)));
    setFill(canvas, fill, fillAlpha);
    canvas.fill();
    if (outlineWidth <= 0) return;
    canvas.save();
    canvas.setLineCap("round");
    canvas.setLineJoin("round");
    canvas.setLineWidth(static_cast<float>(outlineWidth));
    setStroke(canvas, outline, outlineAlpha);
    canvas.stroke();
    canvas.restore();
}

} // namespace

void setFill(Canvas& canvas, std::uint32_t rgb, double alpha) {
    canvas.setFillStyle(toColor(rgb, alpha));
}

void setStroke(Canvas& canvas, std::uint32_t rgb, double alpha) {
    canvas.setStrokeStyle(toColor(rgb, alpha));
}

void paintRun(Canvas& canvas, const std::string& s, double penX, double baseline,
              const TextStyle& style, double strokeAlpha, double fillAlpha, bool fillFirst) {
    if (s.empty() || !Fonts::ready()) return;

    const double strokeWidth =
        style.strokeWidth < 0 ? style.size * kTextStrokeRatio : style.strokeWidth;

#ifdef __EMSCRIPTEN__
    // The atlas takes the run when it holds a bake of it; everything else --
    // a miss, a fade, a skewed transform -- goes to the page's text engine,
    // which is what the atlas bakes with.
    if (paintRunFromAtlas(canvas, s, penX, baseline, style, strokeWidth, strokeAlpha, fillAlpha,
                          fillFirst)) {
        return;
    }
    paintRunLive(canvas, s, penX, baseline, style, strokeWidth, strokeAlpha, fillAlpha, fillFirst);
#else
    // The raster cache is the native build's answer to the glyph cache the
    // comment on this function's declaration describes. It takes the run when
    // it can and says so; everything it turns down -- a rotated transform, an
    // extreme size -- goes the long way, which is the same code it bakes with.
    if (paintRunCached(canvas, s, penX, baseline, style, strokeWidth, strokeAlpha, fillAlpha,
                       fillFirst)) {
        return;
    }
    paintRunDirect(canvas, s, penX, baseline, style, strokeWidth, strokeAlpha, fillAlpha,
                   fillFirst);
#endif
}

Vec2 textPen(const std::string& s, double x, double y, const TextStyle& style) {
    return {originX(x, measure(s, style.size), style.align),
            baselineY(y, style.size, style.baseline)};
}

void text(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style) {
    if (s.empty() || !Fonts::ready()) return;
    const Vec2 pen = textPen(s, x, y, style);
    // The one place a run can be recorded from: every label, heading and chat
    // token in the game is painted through here, so the selectable-text layer
    // needs no second copy of the alignment arithmetic to agree with.
    if (capturingText()) {
        TextSelect::instance().record(s, pen.x, pen.y, style.size);
    }
    paintRun(canvas, s, pen.x, pen.y, style);
}

void textAtAlpha(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style,
                 double alpha) {
    canvas.setGlobalAlpha(static_cast<float>(alpha));
    text(canvas, s, x, y, style);
    canvas.setGlobalAlpha(1.0f);
}

double textWidth(Canvas&, const std::string& s, double size) {
    return measure(s, size);
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

void button(Canvas& canvas, Rect r, const std::string& label, bool hovered, bool pressed,
            const ButtonStyle& style) {
    TextCaptureScope off(false);
    // Brightness in HSV, matching the browser build exactly: press 0.9, hover
    // 1.1, outline 0.8. A linear channel scale agrees with these everywhere
    // except a clamped brighten, which is where the two visibly diverge.
    std::uint32_t fill = style.fill;
    if (!style.enabled) fill = hsvScale(fill, 0.45);
    else if (pressed) fill = hsvScale(fill, 0.9);
    else if (hovered) fill = hsvScale(fill, 1.1);

    // The outline is derived from the BASE colour, not the hover/press shade,
    // so a button's edge holds still while its face lights up.
    const std::uint32_t outline = style.outline == 0xFFFFFFFFu
        ? hsvScale(style.fill, 0.8)
        : style.outline;
    strokedBox(canvas, r, style.radius, fill, 1.0, outline, style.outlineWidth, 1.0);

    TextStyle ts;
    ts.size = style.textSize;
    // Only when the call site asks. `drawGardnButton` has no measuring step at
    // all -- a label wider than its box simply runs out of both ends of it --
    // and shrinking by default made "Computer Lab" render at 11.4px beside a
    // row of 14px siblings, which is visible without a reference to hand.
    if (style.shrinkToFit) {
        const double available = r.w - style.outlineWidth * 2 - 6.0;
        const double measured = measure(label, ts.size);
        if (measured > available && available > 0) {
            ts.size = std::max(8.0, ts.size * available / measured);
        }
    }
    ts.align = Align::Centre;
    ts.baseline = Baseline::Middle;
    ts.fill = style.enabled ? kPaper : shade(kPaper, 0.65);
    text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5, ts);
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

void selectionHighlight(Canvas& canvas, const TextRun& run, const TextSelection& selection,
                        Rect band) {
    if (selection.empty()) return;
    const double left = std::max(xOfIndex(run, selection.begin()), band.x);
    const double right = std::min(xOfIndex(run, selection.end()), band.right());
    if (right <= left) return;
    setFill(canvas, kSelection, 0.45);
    canvas.fillRect(static_cast<float>(left), static_cast<float>(band.y),
                    static_cast<float>(right - left), static_cast<float>(band.h));
}

Rect inputFieldBand(Rect r) {
    return {r.x + kInputFrameWidth, r.y + kInputFrameWidth, r.w - kInputFrameWidth * 2,
            r.h - kInputFrameWidth * 2};
}

double inputTextSize(Rect r) { return std::max(kInputTextSize, r.h * 0.4); }

namespace {

/// Where a look lays its text out: the first glyph's x at no scroll, the width
/// the caret is kept inside, the type size, and the rect everything is clipped
/// to. The auth and overlay numbers are the browser build's plates, as they
/// were before the standard look replaced them.
struct InputLayout {
    double left;
    double span;
    double size;
    Rect clip;
};

/// The open chat line's type: the transcript's size, ink on white.
constexpr double kChatInputSize = 14.0;
/// Its edge, which is CENTRED on the box as a stroke is -- half of it lies
/// outside `r`.
constexpr double kChatInputEdge = 3.0;
constexpr double kChatInputRadius = 4.0;
/// From the box's edge to the prefix, and from the prefix to the value.
constexpr double kChatPrefixInset = 6.5;
constexpr double kChatPrefixGap = 7.0;

InputLayout inputLayout(Rect r, InputLook look, const InputPrefix* prefix) {
    switch (look) {
        case InputLook::Chat: {
            double left = r.x + kChatPrefixInset;
            if (prefix != nullptr && !prefix->text.empty()) {
                left += measure(prefix->text, kChatInputSize) + kChatPrefixGap;
            }
            const double inner = kChatInputEdge * 0.5;
            return {left, std::max(0.0, r.right() - kChatPrefixInset - left), kChatInputSize,
                    Rect{r.x + inner, r.y + inner, r.w - inner * 2, r.h - inner * 2}};
        }
        case InputLook::Auth:
            // 10px in, and never a size the box would clip against its outline.
            return {r.x + 10.0, r.w - 20.0, std::min(18.0, r.h * 0.6),
                    Rect{r.x + 5.0, r.y, r.w - 10.0, r.h}};
        case InputLook::Overlay:
            // The size a browser gives an unstyled <input>, 6px in.
            return {r.x + 6.0, r.w - 12.0, 13.333, Rect{r.x + 2.0, r.y, r.w - 4.0, r.h}};
        case InputLook::Standard:
            break;
    }
    const Rect band = inputFieldBand(r);
    return {band.x + kInputPadding, band.w - kInputPadding * 2, inputTextSize(r), band};
}

} // namespace

TextRun inputFieldRun(Rect r, const std::string& value, const TextFieldState& state,
                      InputLook look, const InputPrefix* prefix) {
    const InputLayout layout = inputLayout(r, look, prefix);
    TextRun run;
    run.text = value;
    run.size = layout.size;
    const double scroll =
        state.focused ? followCaret(state, value, run.size, layout.span) : 0.0;
    run.originX = layout.left - scroll;
    return run;
}

Rect inputPrefixBounds(Rect r, InputLook look, const InputPrefix* prefix) {
    if (look != InputLook::Chat || prefix == nullptr || prefix->text.empty()) return {};
    const double right =
        r.x + kChatPrefixInset + measure(prefix->text, kChatInputSize) + kChatPrefixGap * 0.5;
    return {r.x, r.y, right - r.x, r.h};
}

Rect inputFieldPlate(Canvas& canvas, Rect r) {
    setFill(canvas, kInputFrame);
    canvas.fillRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                    static_cast<float>(r.h));
    const Rect band = inputFieldBand(r);
    setFill(canvas, kInputFill);
    canvas.fillRect(static_cast<float>(band.x), static_cast<float>(band.y),
                    static_cast<float>(band.w), static_cast<float>(band.h));
    return band;
}

void inputField(Canvas& canvas, Rect r, const std::string& value, const std::string& placeholder,
                bool focused, double timeSeconds, const TextFieldState* state, bool masked,
                InputLook look, const InputPrefix* prefix) {
    // Only the chat line lays a prefix out; inputLayout ignores it elsewhere.
    if (look != InputLook::Chat) prefix = nullptr;
    // A field's label is its value, not page text: dragging across it selects
    // inside the field, never the run the page selection would otherwise see.
    TextCaptureScope off(false);
    // Every field painted here is one a finger can tap, focused or not -- and
    // the unfocused ones are the point: raising the on-screen keyboard is the
    // job of the touch that FOCUSES a field. See ui::TextFieldRegions.
    TextFieldRegions::instance().record(r);

    // The plate, and the type that goes on it.
    TextStyle style;
    style.strokeWidth = 0;
    std::uint32_t placeholderFill = kInputPlaceholder;
    std::uint32_t caretFill = kInk;
    double caretWidth = 1.0;
    double caretOffset = 1.0;
    Rect caretBand{};
    Rect highlightBand{};
    switch (look) {
        case InputLook::Standard: {
            const Rect band = inputFieldPlate(canvas, r);
            style.fill = kInk;
            caretBand = highlightBand =
                Rect{band.x, band.y + 2.0, band.w, std::max(2.0, band.h - 4.0)};
            break;
        }
        case InputLook::Auth:
            // The outline is CENTRED on the box, as `ctx.stroke()` draws it,
            // so the plate is half its width larger than `r` on every side --
            // and it widens rather than recolours when focused.
            strokedBox(canvas, r, 3.0, kField, 1.0, hsvScale(kField, 0.8), focused ? 5.0 : 4.0,
                       1.0);
            style.fill = kPaper;
            // The browser's drawInput leaves `lineJoin = 'round'` ambient
            // across the drawText that follows.
            style.roundJoin = true;
            placeholderFill = kPaper;
            caretFill = kPaper;
            caretWidth = 2.0;
            caretOffset = 0.0;
            caretBand = Rect{r.x, r.y + 10.0, r.w, std::max(2.0, r.h - 20.0)};
            highlightBand = Rect{r.x + 5.0, r.y + 6.0, r.w - 10.0, std::max(2.0, r.h - 12.0)};
            break;
        case InputLook::Overlay:
            // Inset by half the line so the edge lands INSIDE the box, as a
            // one-pixel border does; a centred stroke would make it wider.
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y),
                             static_cast<float>(r.w), static_cast<float>(r.h), 3.0f);
            setFill(canvas, kInk, 0.3);
            canvas.fill();
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(r.x + 0.5), static_cast<float>(r.y + 0.5),
                             static_cast<float>(r.w - 1.0), static_cast<float>(r.h - 1.0), 2.5f);
            canvas.save();
            canvas.setLineWidth(1.0f);
            setStroke(canvas, kPaper, 0.3);
            canvas.stroke();
            canvas.restore();
            style.fill = kPaper;
            placeholderFill = 0x757575u;
            caretFill = kPaper;
            caretOffset = 0.0;
            caretBand = Rect{r.x, r.y + 4.0, r.w, std::max(2.0, r.h - 8.0)};
            highlightBand = Rect{r.x + 2.0, r.y + 3.0, r.w - 4.0, std::max(2.0, r.h - 6.0)};
            break;
        case InputLook::Chat:
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y),
                             static_cast<float>(r.w), static_cast<float>(r.h),
                             static_cast<float>(kChatInputRadius));
            setFill(canvas, kPaper);
            canvas.fill();
            canvas.save();
            canvas.setLineWidth(static_cast<float>(kChatInputEdge));
            setStroke(canvas, 0x000000u);
            canvas.stroke();
            canvas.restore();
            style.fill = 0x000000u;
            caretFill = 0x000000u;
            caretOffset = 0.0;
            caretBand = Rect{r.x, r.y + 4.0, r.w, std::max(2.0, r.h - 8.0)};
            highlightBand = Rect{r.x + 2.0, r.y + 3.0, r.w - 4.0, std::max(2.0, r.h - 6.0)};
            break;
    }

    const std::string shown = masked ? std::string(value.size(), '*') : value;
    // A field with no caret of its own -- a masked one, or a caller that keeps
    // none -- has it implicitly at the end, and scrolls to keep THAT in view.
    TextFieldState atEnd;
    atEnd.focused = focused;
    atEnd.selection.collapse(shown.size());
    const bool selectable = state != nullptr && !masked;
    const TextFieldState& live = selectable ? *state : atEnd;
    const TextRun run = inputFieldRun(r, shown, live, look, prefix);
    const InputLayout layout = inputLayout(r, look, prefix);
    style.size = run.size;
    // The chat line's type sits a pixel under the box's centre line, which is
    // where centring its capitals rather than its em box puts them.
    const double middle = r.y + r.h * 0.5 + (look == InputLook::Chat ? 1.0 : 0.0);

    // Outside the clip below, which starts where the value does: the value
    // scrolls under the prefix's end rather than over it.
    if (prefix != nullptr && !prefix->text.empty()) {
        TextStyle tag;
        tag.size = layout.size;
        tag.fill = prefix->fill;
        text(canvas, prefix->text, r.x + kChatPrefixInset, middle, tag);
    }

    Rect clipBox = layout.clip;
    if (prefix != nullptr && !prefix->text.empty()) {
        // Room for the caret at the very start of the value, and no more.
        const double from = layout.left - 2.0;
        clipBox.w -= from - clipBox.x;
        clipBox.x = from;
    }
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(clipBox.x), static_cast<float>(clipBox.y),
                static_cast<float>(clipBox.w), static_cast<float>(clipBox.h));
    canvas.clip();
    if (shown.empty()) {
        // The auth form's placeholder goes while it has the caret -- the caret
        // already says where the text will go. An <input>'s stays.
        if (look != InputLook::Auth || !focused) {
            style.fill = placeholderFill;
            text(canvas, placeholder, layout.left, middle, style);
        }
    } else {
        if (focused && selectable) selectionHighlight(canvas, run, live.selection, highlightBand);
        text(canvas, shown, run.originX, middle, style);
    }
    // A field with a caret of its own phases the blink on it, so the bar stays
    // solid while it is being typed at rather than winking out mid-word.
    const bool blinkOn =
        state != nullptr ? caretVisible(*state, timeSeconds) : std::fmod(timeSeconds, 1.0) < 0.5;
    if (focused && blinkOn) {
        setFill(canvas, caretFill);
        canvas.fillRect(static_cast<float>(xOfIndex(run, live.selection.caret) + caretOffset),
                        static_cast<float>(caretBand.y), static_cast<float>(caretWidth),
                        static_cast<float>(caretBand.h));
    }
    canvas.restore();
}

} // namespace flix::ui
