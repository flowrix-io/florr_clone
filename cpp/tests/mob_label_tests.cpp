#include "test.h"

#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/ui/theme.h"
#include "client/world_view.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

// Who wears the name plate.
//
// A leech is one animal on one health pool, so it gets ONE bar: ten identical
// ones stacked less than a diameter apart is a wall of green over a mob whose
// health is a single number. This is a claim about pixels, so it is tested in
// pixels -- the plate is drawn by the world renderer and nothing else reports
// whether it went down.

using namespace flix;

namespace {

constexpr int kFrameSize = 320;
constexpr Vec2 kMobAt{1000.0, 1000.0};

std::string testsDir() {
    const std::string path = __FILE__;
    const std::size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string firstExisting(const std::vector<std::string>& candidates) {
    for (const std::string& candidate : candidates) {
        std::ifstream probe(candidate, std::ios::binary);
        if (probe) return candidate;
    }
    return {};
}

const ContentRegistry& shipped() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        r.loadFiles(firstExisting({testsDir() + "/../../src/mobs.json", "data/mobs.json",
                                   "../src/mobs.json", "../../src/mobs.json", "src/mobs.json"}),
                    firstExisting({testsDir() + "/../../src/petals.json", "data/petals.json",
                                   "../src/petals.json", "../../src/petals.json",
                                   "src/petals.json"}),
                    error);
        return r;
    }();
    return registry;
}

Camera frameCamera() {
    Camera camera;
    camera.setViewport(kFrameSize, kFrameSize);
    camera.userZoom = 1.0;
    camera.snapTo(kMobAt);
    return camera;
}

RemoteEntity mobOfType(const char* id) {
    RemoteEntity mob;
    mob.netId = 11;
    mob.kind = net::EntityKind::Mob;
    mob.position = kMobAt;
    mob.targetPosition = kMobAt;
    mob.needsSnap = false;
    mob.typeIndex = shipped().mobIndex(id);
    mob.rarity = Rarity::Common;
    // Half a bar, so the fill is unmistakably narrower than the plate behind
    // it and a full-health bar cannot be confused with the dark backing.
    mob.healthFraction = 0.5;
    mob.radius = shipped().mobStats(mob.typeIndex, Rarity::Common).radius;
    return mob;
}

/// Pixels of health-bar green in one frame holding a single mob of `id`.
int healthBarPixels(const char* id) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    WorldView view;
    view.setRealm(Realm::Overworld);
    view.seedForTest(mobOfType(id));

    WorldRenderer renderer;
    renderer.setContent(&shipped());
    renderer.draw(canvas, view, frameCamera(), kMobAt, 0.0);

    const std::vector<std::uint8_t> pixels = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    const std::uint8_t r = static_cast<std::uint8_t>((ui::kHealth >> 16) & 0xFF);
    const std::uint8_t g = static_cast<std::uint8_t>((ui::kHealth >> 8) & 0xFF);
    const std::uint8_t b = static_cast<std::uint8_t>(ui::kHealth & 0xFF);
    int found = 0;
    for (std::size_t i = 0; i + 2 < pixels.size(); i += 4) {
        // Exact: the fill is flat and the bar is wide enough that its middle
        // is nowhere near an antialiased edge.
        if (pixels[i] == r && pixels[i + 1] == g && pixels[i + 2] == b) ++found;
    }
    return found;
}

} // namespace

// ---------------------------------------------------------------------------

TEST(only_the_head_of_a_leech_wears_a_health_bar) {
    // The head carries the animal's plate...
    CHECK(healthBarPixels("leech") > 0);
    // ...and each of the nine bodies behind it carries none.
    CHECK_EQ(healthBarPixels("leech_body"), 0);

    // A centipede is the other family -- every bead is its own mob with its
    // own pool, so every bead states its own health.
    CHECK(healthBarPixels("centipede") > 0);
    CHECK(healthBarPixels("centipede_body") > 0);
}
