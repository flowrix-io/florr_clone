#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/game/components.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 400;
constexpr Vec2 kAt{1000.0, 1000.0};
/// How many pixels across the cloud's radius is drawn, whatever the zoom.
constexpr double kRadiusPixels = 150.0;

struct Shot {
    std::vector<std::uint8_t> rgba;
    Camera camera;
};

/// The frame with nothing in it, or with one uranium cloud on kAt, sent at
/// its reach as the server sends it.
Shot radiationFrame(bool withCloud) {
    Shot shot{{}, testsupport::frameCamera(kFrameSize, kAt)};
    WorldView view;
    view.setRealm(Realm::Overworld);
    if (withCloud) {
        RemoteEntity cloud;
        cloud.netId = 9;
        cloud.kind = net::EntityKind::Effect;
        cloud.typeIndex = static_cast<std::uint16_t>(GroundEffectKind::Radiation);
        cloud.position = cloud.targetPosition = kAt;
        cloud.needsSnap = false;
        cloud.radius = kRadiusPixels / shot.camera.zoom();
        view.seedForTest(cloud);
    }

    WorldRenderer renderer;
    renderer.setContent(&testsupport::shippedContent());
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, shot.camera, kAt, 0.0);
    shot.rgba = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_RADIATION_PPM=<path> keeps the frame, for a look by eye.
    if (const char* path = std::getenv("FLIX_RADIATION_PPM"); path != nullptr && withCloud) {
        if (std::FILE* out = std::fopen(path, "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < shot.rgba.size(); i += 4) {
                std::fwrite(&shot.rgba[i], 1, 3, out);
            }
            std::fclose(out);
        }
    }
    return shot;
}

/// How far the cloud moved the pixel `fraction` of its radius east of its
/// centre: the largest change in any colour channel.
int tintAt(const Shot& bare, const Shot& clouded, double fraction) {
    const Vec2 screen = clouded.camera.worldToScreen(
        kAt + Vec2{fraction * kRadiusPixels / clouded.camera.zoom(), 0.0});
    const int x = std::clamp(static_cast<int>(std::lround(screen.x)), 0, kFrameSize - 1);
    const int y = std::clamp(static_cast<int>(std::lround(screen.y)), 0, kFrameSize - 1);
    const std::size_t at = (static_cast<std::size_t>(y) * kFrameSize + x) * 4;
    int most = 0;
    for (std::size_t c = 0; c < 3; ++c) {
        most = std::max(most, std::abs(static_cast<int>(clouded.rgba[at + c]) -
                                       static_cast<int>(bare.rgba[at + c])));
    }
    return most;
}

} // namespace

TEST(a_uranium_cloud_fades_from_its_petal_to_nothing_at_its_rim) {
    // The pulse is strongest on the petal and nothing at the rim, and the
    // cloud is drawn the same way: a tint that thins out with distance and
    // no edge to show where it stops.
    const Shot bare = radiationFrame(false);
    const Shot clouded = radiationFrame(true);
    const int centre = tintAt(bare, clouded, 0.0);
    const int near = tintAt(bare, clouded, 0.15);
    const int third = tintAt(bare, clouded, 0.3);
    const int half = tintAt(bare, clouded, 0.5);
    const int rim = tintAt(bare, clouded, 0.98);
    const int beyond = tintAt(bare, clouded, 1.2);

    CHECK(centre > 20);
    CHECK(centre > near);
    CHECK(near > third);
    CHECK(third > half);
    // Concentrated on the petal, as the damage is: half way out is far less
    // than half as strong.
    CHECK(half * 4 < centre);
    CHECK(rim <= 1);
    CHECK_EQ(beyond, 0);
}
