#pragma once
// Draws a user-created skin's shape list.
//
// Shared deliberately. A skin is drawn in two places -- on the flower in the
// world, and in the Skin Studio's preview and browse cards -- and those two
// must be the SAME painter. A panel-only copy is exactly how a skin comes to
// look one way while you author it and another way once you wear it.

#include <cstdint>
#include <string>
#include <vector>

#include "canvas.h"

#include "shared/game/skin_format.h"

namespace flix {

/// Parses "#rrggbb" into 0xRRGGBB, or returns `fallback` for anything else.
/// A skin's colours are player-authored strings; sanitizeSkin() has already
/// rejected the ones that are not colours, but a catalog written by an older
/// build is still read through here rather than trusted.
std::uint32_t skinHexColor(const std::string& text, std::uint32_t fallback);

/// Draws `shapes` about the current origin, in the caller's own space.
///
/// The editor authors against a body radius of 25 -- the flower's art radius
/// -- so `radius` is what scales an authored skin onto whatever circle it is
/// being shown in. Everything is clipped to a disc of 100 authored units so
/// no skin can paint past its own flower.
void renderSkinShapes(Canvas& canvas, const std::vector<SkinShape>& shapes, double radius);

} // namespace flix
