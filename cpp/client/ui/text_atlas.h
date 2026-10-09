#pragma once
// The browser build's text cache.
//
// The page's text engine keeps a glyph cache, but each fillText still pays for
// shaping, the glyph lookups and a text blob, and each strokeText strokes
// every glyph outline afresh. Measured in a game frame, text was 33-47% of
// the canvas work on the page thread for a hundred or two calls. Copying a
// run's pixels out of a bitmap was about a sixth of that.
//
// So a run drawn often enough is baked once into ONE shared atlas and copied
// from there. The baking happens in a pre-pass at the start of a frame and
// never mid-frame: an offscreen canvas that is drawn into after the page has
// read from it in the same frame costs Chrome a whole-surface copy or a split
// raster flush, and one per bake would cost more than the text it replaced.
// A run that misses draws live that frame.
//
// The native build has its own cache with the same key (text_cache.h).
#include <cstddef>
#include <string>

#include "canvas.h"
#include "client/ui/draw.h"

#ifdef __EMSCRIPTEN__

namespace flix::ui {

/// Draws a run with the page's text engine: stroke then fill (or the reverse),
/// with the pen already resolved. What a cache miss does, and what the atlas
/// bakes with.
void paintRunLive(Canvas& canvas, const std::string& s, double penX, double baseline,
                  const TextStyle& style, double strokeWidth, double strokeAlpha, double fillAlpha,
                  bool fillFirst);

/// Draws a run by copying it out of the atlas. False when the atlas does not
/// hold it, in which case the caller must draw it live -- and the run is
/// remembered, so that one drawn again soon is baked by the next pre-pass.
///
/// Turns down anything a copied bitmap would not reproduce exactly: a
/// transform that is not a similarity, a blend mode, a filter or a shadow, a
/// size outside the range worth baking. globalAlpha is baked into the run, so
/// a steady fade (the chat panel) is cached and a moving one (a damage number)
/// never repeats a key and draws live.
bool paintRunFromAtlas(Canvas& canvas, const std::string& s, double penX, double baseline,
                       const TextStyle& style, double strokeWidth, double strokeAlpha,
                       double fillAlpha, bool fillFirst);

/// Bakes the runs that have been waiting. Call once a frame, before anything
/// is drawn; it is also what advances the atlas's clock.
void prepareTextAtlas();

/// What the debug panel's Profiling tab shows of the atlas.
struct TextAtlasStats {
    std::size_t runs = 0;       // baked and held
    int bakedLastFrame = 0;
};
TextAtlasStats textAtlasStats();

} // namespace flix::ui

#endif   // __EMSCRIPTEN__
