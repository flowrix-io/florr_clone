// An explosion as the client draws it: grey and white smoke thrown out from
// the blast's centre, with small red, orange and yellow sparks flying out
// past it. Drawn through the real renderer from the event the server sends,
// and read back as pixels.

#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 600;
constexpr Vec2 kAt{1000.0, 1000.0};
constexpr double kReach = 240.0;
constexpr double kFrameSeconds = 1.0 / 60.0;

struct Shot {
    std::vector<std::uint8_t> rgba;
    Camera camera;
};

/// The frame `seconds` after a blast reaching `kReach` went off at kAt, or
/// with no blast at all for `seconds` < 0.
Shot explosionFrame(double seconds) {
    Shot shot{{}, testsupport::frameCamera(kFrameSize, kAt)};
    WorldView view;
    view.setRealm(Realm::Overworld);
    WorldRenderer renderer;
    renderer.setContent(&testsupport::shippedContent());
    if (seconds >= 0.0) {
        ViewEvent blast;
        blast.kind = net::EventKind::Explosion;
        blast.position = kAt;
        blast.radius = kReach;
        view.events().push_back(blast);
        renderer.ingestEvents(view);
        for (double t = 0.0; t < seconds; t += kFrameSeconds) renderer.update(kFrameSeconds);
    }
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, shot.camera, kAt, 0.0);
    shot.rgba = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_EXPLOSION_PPM=<prefix> keeps each frame, for a look by eye.
    if (const char* prefix = std::getenv("FLIX_EXPLOSION_PPM"); prefix != nullptr) {
        const std::string path =
            std::string(prefix) + "_" + std::to_string(static_cast<int>(seconds * 1000)) + ".ppm";
        if (std::FILE* out = std::fopen(path.c_str(), "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < shot.rgba.size(); i += 4) {
                std::fwrite(&shot.rgba[i], 1, 3, out);
            }
            std::fclose(out);
        }
    }
    return shot;
}

struct Census {
    int smoke = 0;   ///< changed pixels gone grey or white
    int sparks = 0;  ///< changed pixels gone red, orange or yellow
    int changed = 0;
    double farthest = 0;   ///< world distance of the farthest changed pixel
};

Census census(const Shot& bare, const Shot& blast) {
    Census out;
    const double zoom = blast.camera.zoom();
    const Vec2 centre = blast.camera.worldToScreen(kAt);
    for (int y = 0; y < kFrameSize; ++y) {
        for (int x = 0; x < kFrameSize; ++x) {
            const std::size_t i = (static_cast<std::size_t>(y) * kFrameSize + x) * 4;
            const int r = blast.rgba[i], g = blast.rgba[i + 1], b = blast.rgba[i + 2];
            const int moved = std::max({std::abs(r - bare.rgba[i]), std::abs(g - bare.rgba[i + 1]),
                                        std::abs(b - bare.rgba[i + 2])});
            if (moved < 24) continue;
            ++out.changed;
            out.farthest = std::max(out.farthest, std::hypot(x - centre.x, y - centre.y) / zoom);
            const int spread = std::max({r, g, b}) - std::min({r, g, b});
            if (std::min({r, g, b}) >= 110 && spread <= 48) ++out.smoke;
            if (r >= 200 && b <= 110 && r > g) ++out.sparks;
        }
    }
    return out;
}

} // namespace

TEST(an_explosion_throws_grey_smoke_and_hot_sparks_out_from_its_centre) {
    const Shot bare = explosionFrame(-1.0);
    const Census early = census(bare, explosionFrame(0.1));
    const Census late = census(bare, explosionFrame(0.6));

    // Both halves of the look are there.
    CHECK(early.smoke > 500);
    CHECK(early.sparks > 20);

    // And they travel outward: by 0.6 s the blast has spread to most of its
    // reach, well past where it was at 0.1 s, and not wildly beyond it.
    CHECK(late.farthest > early.farthest);
    CHECK(late.farthest > kReach * 0.6);
    CHECK(late.farthest < kReach * 1.6);

    // Gone once its second is up.
    CHECK_EQ(census(bare, explosionFrame(1.05)).changed, 0);
}
