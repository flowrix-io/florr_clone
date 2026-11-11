// The garbage pile, as pixels. Its entry in mobs.json is an empty document and
// the renderer builds the pile out of droppable petals, picked by a seed every
// client derives for itself. The seed is the mob's net id, so a pile shoved
// across the floor stays the same pile.

#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "fixture_content.h"
#include "render_rig.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 160;

/// One plain disc of a colour of its own, so piles built of different petals
/// read as different pixels.
std::string discPetal(const char* id, const char* fill) {
    return std::string("\"") + id + "\": {\"name\":\"" + id +
           "\",\"damage\":1,\"health\":1,\"size\":1,\"cooldown\":1,\"count\":1,"
           "\"image\":\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" width=\\\"32\\\" "
           "height=\\\"32\\\" viewBox=\\\"-16 -16 32 32\\\"><circle r=\\\"12\\\" fill=\\\"" +
           fill + "\\\"/></svg>\"}";
}

/// A garbage mob and eight petals for it to be built from. No egg: a
/// synthesised garbage egg would sort first and paint the empty artwork, so
/// any pile that picked it would be partly invisible.
const ContentRegistry& pileContent() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        const char* fills[] = {"#e01010", "#10e010", "#1010e0", "#e0e010",
                               "#e010e0", "#10e0e0", "#f08020", "#8020f0"};
        std::string petals = "{";
        for (int i = 0; i < 8; ++i) {
            if (i > 0) petals += ",";
            petals += discPetal(("p" + std::to_string(i)).c_str(), fills[i]);
        }
        petals += "}";
        if (!test::loadFixtureContent(r, testsupport::tempDir("flix_garbage_render"), R"({
            "garbage": {"name":"Garbage","health":250,"damage":5,"size":1,"speed":0,
                        "image":"<svg></svg>","ai_type":"passive",
                        "reversed":true,"hideRotation":true,"noEggDrop":true}
        })",
                                      petals, error)) {
            std::printf("    (the garbage fixture did not load: %s)\n", error.c_str());
        }
        return r;
    }();
    return registry;
}

const SpriteCache& pileSprites() {
    static const SpriteCache sprites = [] {
        SpriteCache cache;
        cache.build(pileContent(), testsupport::dataDir());
        return cache;
    }();
    return sprites;
}

/// The frame with the camera on a garbage pile `netId` standing at `at`.
std::vector<std::uint8_t> pileFrame(std::uint32_t netId, Vec2 at) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity mob;
    mob.netId = netId;
    mob.kind = net::EntityKind::Mob;
    mob.typeIndex = pileContent().mobIndex("garbage");
    mob.position = mob.targetPosition = at;
    mob.needsSnap = false;
    mob.radius = 30.0;
    view.seedForTest(mob);

    WorldRenderer renderer;
    renderer.setContent(&pileContent());
    renderer.setSprites(&pileSprites());
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, at), at, 0.0);
    std::vector<std::uint8_t> frame = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_GARBAGE_PPM=<dir> keeps the frames, for a look by eye.
    if (const char* dir = std::getenv("FLIX_GARBAGE_PPM")) {
        char name[96];
        std::snprintf(name, sizeof name, "/pile_%u_%.2f_%.2f.ppm", netId, at.x, at.y);
        if (std::FILE* out = std::fopen((std::string(dir) + name).c_str(), "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < frame.size(); i += 4) std::fwrite(&frame[i], 1, 3, out);
            std::fclose(out);
        }
    }
    return frame;
}

} // namespace

TEST(a_garbage_pile_stays_the_same_pile_when_it_is_pushed) {
    if (pileContent().mobIndex("garbage") == kInvalidIndex) {
        CHECK(false);
        return;
    }
    // User, 2026-11-11: "The Garbage mob should not change when getting
    // moved." Off by a fraction of a unit and by a long shove: any step at
    // all reshuffled a pile seeded on where it stood.
    const std::vector<std::uint8_t> before = pileFrame(41, {1000.0, 1000.0});
    const std::vector<std::uint8_t> nudged = pileFrame(41, {1000.37, 999.81});
    const std::vector<std::uint8_t> shoved = pileFrame(41, {1240.0, 1130.0});
    CHECK_EQ(testsupport::differingPixels(before, nudged, 2), 0);
    CHECK_EQ(testsupport::differingPixels(before, shoved, 2), 0);

    // And the pile is really there to compare, and piles still differ from
    // one another: the other mobs standing in the same spot are mostly built
    // differently. A hash can land two ids on the same pile, so not all of
    // them have to be.
    int otherPiles = 0;
    for (std::uint32_t id = 42; id < 50; ++id) {
        if (testsupport::differingPixels(before, pileFrame(id, {1000.0, 1000.0}), 2) > 100) {
            ++otherPiles;
        }
    }
    CHECK(otherPiles >= 6);
}
