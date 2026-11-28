#pragma once
// The rainbow petal's shots, drawn without their SVG document.
//
// Shared by the world renderer and the test that holds it to the document.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <string>

#include "shared/game/config.h"

namespace flix {

/// Rainbow's artwork, whitespace dropped: one circle filling its box, its fill
/// cycling through seven colours every four seconds. A volley of its shots is
/// a lot of these, and drawing each through the SVG document is a save, a
/// transform, an animation evaluation and a restore around one fill -- so a
/// shot is drawn as that fill, in the colour the document would give it.
/// Only while the art is exactly this (a recoloured tier or edited art goes
/// back through the document).
inline constexpr const char* kRainbowArt =
    "<svgwidth=\"32\"height=\"32\"viewBox=\"003232\"xmlns=\"http://www.w3.org/2000/svg\">"
    "<circlecx=\"16\"cy=\"16\"r=\"16\"><animateattributeName=\"fill\"values=\"#ff0000;"
    "#ff7f00;#ffff00;#00ff00;#0000ff;#4b0082;#9400d3;#ff0000\"dur=\"4s\"repeatCount="
    "\"indefinite\"/></circle></svg>";

inline bool isPlainRainbowArt(const PetalConfig& config) {
    if (!config.rarityFills.empty()) return false;
    std::string compact;
    compact.reserve(config.image.size());
    for (const char c : config.image) {
        if (!std::isspace(static_cast<unsigned char>(c))) compact += c;
    }
    return compact == kRainbowArt;
}

/// The rainbow's fill at `timeSeconds`, worked exactly as the SVG library
/// works an <animate> on fill (cpp_canvas svg.cpp animPhase + mixColor): in
/// float, evenly spaced key times, linear in RGB, each channel rounded.
inline std::uint32_t rainbowFill(double timeSeconds) {
    static constexpr std::uint8_t kKeys[8][3] = {
        {0xff, 0x00, 0x00}, {0xff, 0x7f, 0x00}, {0xff, 0xff, 0x00}, {0x00, 0xff, 0x00},
        {0x00, 0x00, 0xff}, {0x4b, 0x00, 0x82}, {0x94, 0x00, 0xd3}, {0xff, 0x00, 0x00},
    };
    constexpr int n = 8;
    const float dur = 4.0f;
    const float t = static_cast<float>(timeSeconds);
    if (t < 0) return 0x000000u;   // before the timeline, the circle's own fill: black
    const float f = std::fmod(t, dur) / dur;
    const auto keyTime = [](int i) { return static_cast<float>(i) / (n - 1); };
    int key = 0;
    while (key + 2 < n && f >= keyTime(key + 1)) ++key;
    const float t0 = keyTime(key), t1 = keyTime(key + 1);
    float u = t1 > t0 ? (f - t0) / (t1 - t0) : 0.f;
    u = std::min(1.f, std::max(0.f, u));
    std::uint32_t rgb = 0;
    for (int c = 0; c < 3; ++c) {
        const int x = kKeys[key][c], y = kKeys[key + 1][c];
        const auto mixed = static_cast<std::uint8_t>(std::lround(x + (y - x) * u));
        rgb = (rgb << 8) | mixed;
    }
    return rgb;
}

} // namespace flix
