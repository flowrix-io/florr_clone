#pragma once
// The few pieces every test that renders a frame and reads its pixels back
// was carrying a copy of: the font, a camera on one spot, and a pixel diff.
//
// A claim about what is on the screen is a claim about pixels, so these tests
// draw through the real renderer onto a virtual canvas and look. What they
// share is only the rig; each says for itself what it looks for.

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "client/camera.h"
#include "client/ui/text.h"
#include "shared/core/types.h"
#include "test_data.h"

namespace flix::testsupport {

/// The font the game ships, loaded once for the process. Text needs it:
/// without it every label, number and plate line paints nothing at all, and a
/// check that one is absent passes for the wrong reason. A failure is printed
/// once; ui::Fonts::init is a no-op once it has succeeded.
inline bool fontsReady() {
    static const bool ok = [] {
        std::string error;
        const bool loaded = ui::Fonts::init(dataDir(), error);
        if (!loaded) std::printf("  fonts did not load: %s\n", error.c_str());
        return loaded;
    }();
    return ok;
}

/// A camera on `at` over a `size`-pixel square frame, at the player's own
/// zoom of one, already settled there rather than easing in.
inline Camera frameCamera(int size, Vec2 at) {
    Camera camera;
    camera.setViewport(size, size);
    camera.userZoom = 1.0;
    camera.snapTo(at);
    return camera;
}

/// The pixels of two same-sized RGBA frames that differ by more than
/// `tolerance` in any colour channel (alpha is not compared), or -1 when the
/// frames are not the same size.
inline int differingPixels(const std::vector<std::uint8_t>& a, const std::vector<std::uint8_t>& b,
                           int tolerance = 0) {
    if (a.size() != b.size()) return -1;
    int differing = 0;
    for (std::size_t i = 0; i + 3 < a.size(); i += 4) {
        for (std::size_t c = 0; c < 3; ++c) {
            if (std::abs(static_cast<int>(a[i + c]) - static_cast<int>(b[i + c])) > tolerance) {
                ++differing;
                break;
            }
        }
    }
    return differing;
}

} // namespace flix::testsupport
