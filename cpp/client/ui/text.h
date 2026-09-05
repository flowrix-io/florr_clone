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

/// The process-wide typeface. One face is enough: bold is produced by stroking
/// the glyph in its own fill colour, which matches the game's chunky look more
/// closely than a separate bold file would anyway.
class Fonts {
public:
    /// Loads a face. `preferred` names are tried in order before the platform
    /// fallbacks. Returns false only when no usable font exists at all, in
    /// which case text draws as nothing and the caller should say so.
    static bool init(const std::string& dataDir, std::string& errorOut);
    static bool ready();
    static const Font& face(bool bold = false);
    static const std::string& path();
};

/// Appends `text`'s glyph outlines to `path`, with the pen starting at the
/// text origin. `x`/`y` are the origin, not a bounding box.
void appendGlyphs(Path2D& path, const std::string& text, double x, double baselineY,
                  double size, bool bold = false);

double measure(const std::string& text, double size, bool bold = false);
double ascent(double size, bool bold = false);
double descent(double size, bool bold = false);
double lineHeight(double size, bool bold = false);

} // namespace flix::ui
