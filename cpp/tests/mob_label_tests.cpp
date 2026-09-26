#include "test.h"

#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/ui/text.h"
#include "client/ui/theme.h"
#include "client/world_view.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
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

RemoteEntity mobOfType(const char* id, Rarity rarity = Rarity::Common) {
    RemoteEntity mob;
    mob.netId = 11;
    mob.kind = net::EntityKind::Mob;
    mob.position = kMobAt;
    mob.targetPosition = kMobAt;
    mob.needsSnap = false;
    mob.typeIndex = shipped().mobIndex(id);
    mob.rarity = rarity;
    // Half a bar, so the fill is unmistakably narrower than the plate behind
    // it and a full-health bar cannot be confused with the dark backing.
    mob.healthFraction = 0.5;
    // The common body at every tier: the narrowest a plate for this animal
    // gets, which is the case that has to fit.
    mob.radius = shipped().mobStats(mob.typeIndex, Rarity::Common).radius;
    return mob;
}

/// One frame holding a single mob of `id`, as RGBA.
std::vector<std::uint8_t> frameOf(const char* id, bool pet,
                                  const WorldRenderer::Options* options,
                                  Rarity rarity = Rarity::Common) {
    // The plate's lines are TEXT, and text needs the font the game ships.
    // Without it the renderer paints no line at all, and a check that a line
    // is absent would pass for the wrong reason.
    static const bool fontsReady = [] {
        std::string error;
        const bool ok = ui::Fonts::init(std::string(FLIX_TEST_DATA_DIR), error);
        if (!ok) std::printf("  fonts did not load: %s\n", error.c_str());
        return ok;
    }();
    CHECK(fontsReady);

    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity mob = mobOfType(id, rarity);
    if (pet) mob.spawnFlags |= net::SpawnIsPet;
    view.seedForTest(mob);

    WorldRenderer renderer;
    renderer.setContent(&shipped());
    if (options != nullptr) renderer.options = *options;
    renderer.draw(canvas, view, frameCamera(), kMobAt, 0.0);

    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

/// Pixels of exactly `color` in one frame holding a single mob of `id`.
int pixelsOf(std::uint32_t color, const char* id, bool pet = false,
             const WorldRenderer::Options* options = nullptr) {
    const std::vector<std::uint8_t> pixels = frameOf(id, pet, options);
    const std::uint8_t r = static_cast<std::uint8_t>((color >> 16) & 0xFF);
    const std::uint8_t g = static_cast<std::uint8_t>((color >> 8) & 0xFF);
    const std::uint8_t b = static_cast<std::uint8_t>(color & 0xFF);
    int found = 0;
    for (std::size_t i = 0; i + 2 < pixels.size(); i += 4) {
        // Exact: the fill is flat and the bar is wide enough that its middle
        // is nowhere near an antialiased edge.
        if (pixels[i] == r && pixels[i + 1] == g && pixels[i + 2] == b) ++found;
    }
    return found;
}

/// Pixels of health-bar green in one frame holding a single mob of `id`.
int healthBarPixels(const char* id) { return pixelsOf(ui::kHealth, id); }

/// Pixels of `color` laid over the black ground at any real coverage. Text at
/// ten units is antialiased right through -- no pixel of a glyph is ever the
/// exact fill -- but over black every one of them is that fill scaled down,
/// so the HUE survives where the value does not.
int inkOf(std::uint32_t color, const char* id, bool pet = false,
          const WorldRenderer::Options* options = nullptr) {
    const std::vector<std::uint8_t> pixels = frameOf(id, pet, options);
    const double want[3] = {static_cast<double>((color >> 16) & 0xFF),
                            static_cast<double>((color >> 8) & 0xFF),
                            static_cast<double>(color & 0xFF)};
    const double peak = std::max(want[0], std::max(want[1], want[2]));
    const int brightest = want[0] == peak ? 0 : (want[1] == peak ? 1 : 2);
    int found = 0;
    for (std::size_t i = 0; i + 2 < pixels.size(); i += 4) {
        const double coverage = pixels[i + static_cast<std::size_t>(brightest)] / peak;
        // Faint edges are mostly the black outline and say little about hue.
        if (coverage < 0.4) continue;
        bool match = true;
        for (std::size_t c = 0; c < 3; ++c) {
            if (std::abs(pixels[i + c] - want[c] * coverage) > 12.0) match = false;
        }
        if (match) ++found;
    }
    return found;
}

/// Whether the row under a summon's bar reads as two words rather than one
/// smear: some run of at least three empty columns between its first and
/// last inked ones. Found by position rather than by colour, because the
/// uncommon tier is a yellow a few steps from "Summon"'s own. Both words are
/// outlined in black on a black ground, so any lit pixel is a glyph's fill,
/// and no letter of either word sits three columns from its neighbour.
bool tierRowSplits(const char* id, Rarity rarity) {
    const std::vector<std::uint8_t> pixels = frameOf(id, /*pet=*/true, nullptr, rarity);
    const auto at = [&](int x, int y) {
        return &pixels[(static_cast<std::size_t>(y) * kFrameSize + static_cast<std::size_t>(x)) * 4];
    };
    // The bar's bottom edge, off the one exact colour on the plate.
    const std::uint8_t health[3] = {static_cast<std::uint8_t>((ui::kHealth >> 16) & 0xFF),
                                    static_cast<std::uint8_t>((ui::kHealth >> 8) & 0xFF),
                                    static_cast<std::uint8_t>(ui::kHealth & 0xFF)};
    int barBottom = -1;
    for (int y = 0; y < kFrameSize; ++y) {
        for (int x = 0; x < kFrameSize; ++x) {
            const std::uint8_t* p = at(x, y);
            if (p[0] == health[0] && p[1] == health[1] && p[2] == health[2]) barBottom = y;
        }
    }
    CHECK(barBottom >= 0);
    if (barBottom < 0) return false;

    std::vector<bool> inked(kFrameSize, false);
    for (int y = barBottom + 1; y < std::min(kFrameSize, barBottom + 20); ++y) {
        for (int x = 0; x < kFrameSize; ++x) {
            const std::uint8_t* p = at(x, y);
            if (std::max(p[0], std::max(p[1], p[2])) > 80) inked[static_cast<std::size_t>(x)] = true;
        }
    }
    int first = -1;
    int last = -1;
    for (int x = 0; x < kFrameSize; ++x) {
        if (!inked[static_cast<std::size_t>(x)]) continue;
        if (first < 0) first = x;
        last = x;
    }
    int run = 0;
    for (int x = first; x >= 0 && x <= last; ++x) {
        run = inked[static_cast<std::size_t>(x)] ? 0 : run + 1;
        if (run >= 3) return true;
    }
    return false;
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

TEST(a_pets_summon_label_never_runs_into_its_tier) {
    // The narrowest plates there are: a 60-unit bar (spider) and a 72-unit
    // one (ladybug), under the two longest tier names a low egg hatches.
    // "Summon" and "Common" side by side are wider than either bar, so this
    // only holds because a pet's bar makes room for its own row.
    for (const char* id : {"spider", "ladybug"}) {
        for (const Rarity rarity : {Rarity::Common, Rarity::Uncommon}) {
            CHECK(tierRowSplits(id, rarity));
        }
    }
}

TEST(a_summoned_pet_says_so_under_its_bar) {
    // A pet is drawn as the very animal it was hatched from, so the plate is
    // the only thing on screen that tells it from the wild one beside it.
    CHECK(inkOf(kPetLabelColor, "ladybug", /*pet=*/true) > 0);
    // The wild ladybug carries no such line.
    CHECK_EQ(inkOf(kPetLabelColor, "ladybug"), 0);
    // And the pet still wears the ordinary bar the label captions.
    CHECK(pixelsOf(ui::kHealth, "ladybug", /*pet=*/true) > 0);

    // It captions the bar AND names the mob, so either half of the plate is
    // enough to keep it; only with both turned off does it go.
    WorldRenderer::Options barsOnly;
    barsOnly.names = false;
    CHECK(inkOf(kPetLabelColor, "ladybug", true, &barsOnly) > 0);
    WorldRenderer::Options namesOnly;
    namesOnly.healthBars = false;
    CHECK(inkOf(kPetLabelColor, "ladybug", true, &namesOnly) > 0);
    WorldRenderer::Options neither;
    neither.names = false;
    neither.healthBars = false;
    CHECK_EQ(inkOf(kPetLabelColor, "ladybug", true, &neither), 0);
}
