#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/game/components.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 200;
constexpr Vec2 kAt{1000.0, 1000.0};

/// One opened tomb in the middle of the frame, as the server streams it.
std::vector<std::uint8_t> openTombFrame() {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity shell;
    shell.netId = 9;
    shell.kind = net::EntityKind::Effect;
    shell.typeIndex = static_cast<std::uint16_t>(GroundEffectKind::OpenTomb);
    shell.position = shell.targetPosition = kAt;
    shell.needsSnap = false;
    shell.radius = 60.0;
    shell.angle = shell.targetAngle = 0.4;
    view.seedForTest(shell);

    WorldRenderer renderer;
    renderer.setContent(&testsupport::shippedContent());
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
    std::vector<std::uint8_t> frame = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_TOMB_PPM=<path> keeps the frame, for a look by eye.
    if (const char* path = std::getenv("FLIX_TOMB_PPM")) {
        if (std::FILE* out = std::fopen(path, "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < frame.size(); i += 4) std::fwrite(&frame[i], 1, 3, out);
            std::fclose(out);
        }
    }
    return frame;
}

int pixelsNear(const std::vector<std::uint8_t>& rgba, std::uint32_t rgb, int tolerance = 2) {
    const int want[3] = {static_cast<int>((rgb >> 16) & 0xFF), static_cast<int>((rgb >> 8) & 0xFF),
                         static_cast<int>(rgb & 0xFF)};
    int count = 0;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        bool match = true;
        for (int c = 0; c < 3; ++c) match = match && std::abs(rgba[i + c] - want[c]) <= tolerance;
        if (match) ++count;
    }
    return count;
}

} // namespace

TEST(an_opened_tomb_lies_on_the_ground_empty) {
    // What a broken tomb leaves (GroundEffectKind::OpenTomb): florr's opened
    // sarcophagus, its wood round a dark inside, at the radius it was sent.
    const std::vector<std::uint8_t> frame = openTombFrame();
    CHECK(pixelsNear(frame, 0x655027u) > 1000);
    CHECK(pixelsNear(frame, 0xA88642u) > 300);
}
