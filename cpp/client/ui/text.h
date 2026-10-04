#pragma once
// Text rendering.
//
// Glyphs are decoded to outlines and drawn as ordinary paths, which is what
// makes the game's stroked-then-filled text possible: the outline is a real
// stroke of the glyph contour, at any size, with no bitmap cache to go stale
// and nothing to re-rasterize when the camera zooms.

#include <string>

#include "canvas.h"
#include "font.h"

namespace flix::ui {

/// The process-wide typeface: Ubuntu Bold, and nothing else. gardn loads only
/// the 700 weight, so every label it draws is bold whatever it asks for; one
/// face here is that same look, and measuring and painting cannot disagree
/// about which face a run is in.
class Fonts {
public:
    /// Loads the bundled face, or a platform fallback. Returns false only when
    /// no usable font exists at all, in which case text draws as nothing and
    /// the caller should say so.
    static bool init(const std::string& dataDir, std::string& errorOut);
    static bool ready();
    static const Font& face();
    static const std::string& path();
};

/// Appends `text`'s glyph outlines to `path`, with the pen starting at the
/// text origin. `x`/`y` are the origin, not a bounding box.
void appendGlyphs(Path2D& path, const std::string& text, double x, double baselineY,
                  double size);

double measure(const std::string& text, double size);
double ascent(double size);
double descent(double size);
double lineHeight(double size);

} // namespace flix::ui
