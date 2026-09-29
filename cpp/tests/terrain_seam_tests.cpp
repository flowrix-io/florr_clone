// "There is a black grid over the map" is a claim about pixels, so this renders
// the shipped overworld through the real WorldRenderer and reads them back.
//
// A seam between two map tiles is the black the frame is cleared to showing
// through where neither tile reached. It runs the whole length of the frame, so
// it is caught as a row or column that is almost entirely black -- which no
// tile artwork ever paints.

#include "test.h"

#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "server_harness.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

using namespace flix;

namespace {

/// A 1280x720 window on a 1x display: two thirds of a device pixel per design
/// unit, the scale the seams opened widest at.
constexpr int kPixelWidth = 1280;
constexpr int kPixelHeight = 720;
constexpr int kDesignWidth = 1920;
constexpr int kDesignHeight = 1080;

/// The longest run of rows (or columns) of the frame that are at least 90%
/// near-black, counted along `columns`.
int blackLines(const std::vector<std::uint8_t>& pixels, bool columns) {
    const int lines = columns ? kPixelWidth : kPixelHeight;
    const int length = columns ? kPixelHeight : kPixelWidth;
    int found = 0;
    for (int line = 0; line < lines; ++line) {
        int dark = 0;
        for (int along = 0; along < length; ++along) {
            const int x = columns ? line : along;
            const int y = columns ? along : line;
            const std::size_t i = (static_cast<std::size_t>(y) * kPixelWidth + x) * 4;
            if (pixels[i] < 16 && pixels[i + 1] < 16 && pixels[i + 2] < 16) ++dark;
        }
        if (dark * 10 >= length * 9) ++found;
    }
    return found;
}

} // namespace

TEST(map_tiles_leave_no_seam_when_antennae_zoom_the_camera_far_out) {
    // High-tier antennae take the camera to 0.1, where the 1.5-unit overlap
    // every tile is drawn with is a fifth of a device pixel. Two neighbouring
    // tile corners, each snapped to a whole pixel on its own, used to land a
    // pixel further apart than the tile reached, at every boundary where the
    // rounding fell that way -- a black line every dozen tiles, across the
    // whole map. These zooms each opened one at this scale.
    std::string error;
    CHECK(loadContent(testsupport::dataDir(), error));
    WorldMaps maps;
    CHECK(maps.load(testsupport::dataDir(), nullptr, error));
    // The tile artwork comes out of the sprite cache; without it every cell
    // draws nothing and the whole frame is the black this is looking for.
    SpriteCache sprites;
    sprites.build(content(), testsupport::dataDir());
    WorldRenderer renderer;
    renderer.setSprites(&sprites);
    renderer.setWorldMaps(&maps);
    WorldView view;
    view.setRealm(Realm::Overworld);

    // The middle of the garden: at 0.1 the view is 19200 x 10800 units, and
    // all of it has to be map for a black line to mean a seam.
    const Vec2 centre{16384.3, 16384.7};
    for (const double zoom : {0.100, 0.106, 0.112, 0.130}) {
        Canvas canvas = Canvas::createVirtual(kPixelWidth, kPixelHeight);
        canvas.setLogicalSize(kDesignWidth, kDesignHeight);
        canvas.resetTransform();
        const float scale = static_cast<float>(kPixelWidth) / kDesignWidth;
        canvas.scale(scale, scale);
        Camera camera;
        camera.setViewport(kDesignWidth, kDesignHeight);
        camera.userZoom = zoom;
        camera.snapTo(centre);
        renderer.draw(canvas, view, camera, centre, 0.0);

        const std::vector<std::uint8_t> pixels =
            canvas.getImageData(0, 0, kPixelWidth, kPixelHeight);
        CHECK(pixels.size() == static_cast<std::size_t>(kPixelWidth) * kPixelHeight * 4);
        CHECK(blackLines(pixels, true) == 0);
        CHECK(blackLines(pixels, false) == 0);
    }
}
