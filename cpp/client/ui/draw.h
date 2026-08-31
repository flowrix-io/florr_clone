#pragma once
// The UI drawing toolkit.
//
// Every widget in the game is built from these few primitives, so the look
// stays consistent without each screen re-deriving it. Nothing here holds
// state -- these are pure draw calls against a Canvas, and layout is the
// caller's business.

#include <cstdint>
#include <string>

#include "canvas.h"

#include "client/ui/theme.h"
#include "shared/core/types.h"

namespace flr::ui {

/// Where text sits relative to the position given.
enum class Align { Left, Centre, Right };
enum class Baseline { Top, Middle, Bottom };

struct TextStyle {
    double size = kBodySize;
    std::uint32_t fill = kPaper;
    /// The outline is what makes text legible over arbitrary game content.
    /// Setting `strokeWidth` to 0 opts out, for text on a known flat panel.
    std::uint32_t stroke = kInk;
    double strokeWidth = -1;    ///< negative means size * kTextStrokeRatio
    bool bold = false;
    Align align = Align::Left;
    Baseline baseline = Baseline::Middle;
};

/// Applies `rgb` at `alpha` to the canvas fill.
void setFill(Canvas&, std::uint32_t rgb, double alpha = 1.0);
void setStroke(Canvas&, std::uint32_t rgb, double alpha = 1.0);

/// Stroke-then-fill text, which is the whole reason this exists: doing it in
/// the other order eats the glyph with its own outline.
void text(Canvas&, const std::string& s, double x, double y, const TextStyle& style = {});
double textWidth(Canvas&, const std::string& s, double size, bool bold = false);

/// A filled, outlined, rounded rectangle -- the basis of every panel, slot and
/// button in the game.
void plate(Canvas&, Rect r, std::uint32_t fill, double radius = kPanelRadius,
           std::uint32_t outline = kInk, double outlineWidth = -1, double alpha = 1.0);

/// A panel with the standard body colour and a darker inset edge.
void panel(Canvas&, Rect r, double alpha = 1.0);

struct ButtonStyle {
    std::uint32_t fill = kAccent;
    double radius = kButtonRadius;
    double textSize = kBodySize;
    bool enabled = true;
};

/// Draws a button. Hover and press are passed in rather than tracked here so
/// that hit-testing stays with the screen that owns the layout.
void button(Canvas&, Rect r, const std::string& label, bool hovered, bool pressed,
            const ButtonStyle& style = {});

/// A horizontal bar with an outline, used for health, XP and reload sweeps.
/// `fraction` is clamped, so a caller need not sanitise it.
void bar(Canvas&, Rect r, double fraction, std::uint32_t fill,
         std::uint32_t back = kHealthBack, double radius = -1);

/// A circle with the standard outline. Flowers, petals and drops are all this.
void disc(Canvas&, Vec2 centre, double radius, std::uint32_t fill,
          std::uint32_t outline = kInk, double outlineWidth = -1, double alpha = 1.0);

/// A full-screen scrim behind a modal.
void scrim(Canvas&, double alpha = 0.45);

/// A text field's box and contents, with a blinking caret when focused.
/// `masked` renders the value as bullets, for passwords.
void textField(Canvas&, Rect r, const std::string& value, const std::string& placeholder,
               bool focused, bool masked, double timeSeconds);

/// True when `point` is inside `r`. Here so every screen hit-tests the same way.
inline bool hit(Rect r, Vec2 point) { return r.contains(point); }

} // namespace flr::ui
