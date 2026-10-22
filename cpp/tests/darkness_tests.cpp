#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/darkness.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <cmath>
#include <cstdint>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 200;
constexpr Vec2 kAt{1000.0, 1000.0};

RemoteEntity entityOf(net::EntityKind kind, double radius) {
    RemoteEntity entity;
    entity.netId = 5;
    entity.kind = kind;
    entity.radius = radius;
    entity.position = entity.targetPosition = kAt;
    return entity;
}

RemoteEntity mobOf(const char* id, double radius) {
    RemoteEntity mob = entityOf(net::EntityKind::Mob, radius);
    mob.typeIndex = testsupport::shippedContent().mobIndex(id);
    return mob;
}

RemoteEntity petalOf(net::EntityKind kind, const char* id, Rarity rarity, double radius) {
    RemoteEntity petal = entityOf(kind, radius);
    petal.typeIndex = testsupport::shippedContent().petalIndex(id);
    petal.rarity = rarity;
    return petal;
}

/// The colour at (`x`, `y`) of an RGBA frame `kFrameSize` across.
Color pixelAt(const std::vector<std::uint8_t>& rgba, int x, int y) {
    const std::size_t at = (static_cast<std::size_t>(y) * kFrameSize + x) * 4;
    return Color{rgba[at], rgba[at + 1], rgba[at + 2]};
}

bool near(Color a, Color b, int tolerance = 1) {
    return std::abs(a.r - b.r) <= tolerance && std::abs(a.g - b.g) <= tolerance &&
           std::abs(a.b - b.b) <= tolerance;
}

/// A white frame with the pyramid's dark multiplied over it.
std::vector<std::uint8_t> shadedFrame(DarkMap& dark, double timeSeconds) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    canvas.clear(Color{255, 255, 255});
    std::vector<LightDisc> discs;
    dark.discs(timeSeconds, discs);
    dark.shade(canvas, testsupport::frameCamera(kFrameSize, kAt), discs,
               darknessFloor(0x120D00u));
    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

/// One mob at `at` drawn on a dark map lit by `discs`, as a frame.
std::vector<std::uint8_t> mobInTheDark(Vec2 at, const std::vector<LightDisc>& discs) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity mob = mobOf("ladybug", 30);
    mob.netId = 9;
    mob.position = mob.targetPosition = at;
    mob.needsSnap = false;
    view.seedForTest(mob);
    WorldRenderer renderer;
    renderer.setContent(&testsupport::shippedContent());
    renderer.setLightClip(&discs);
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    canvas.clear(Color{255, 255, 255});
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

} // namespace

TEST(a_dark_map_lights_what_florr_lights_and_how_far) {
    const ContentRegistry& content = testsupport::shippedContent();
    // florr: a flower 200 past its body, a pet 150, nothing else that lives.
    CHECK_NEAR(lightReach(entityOf(net::EntityKind::Player, 25), &content), 225.0, 1e-9);
    RemoteEntity corpse = entityOf(net::EntityKind::Player, 25);
    corpse.healthFraction = 0.0;
    CHECK_NEAR(lightReach(corpse, &content), 0.0, 1e-9);
    CHECK_NEAR(lightReach(mobOf("ladybug", 30), &content), 0.0, 1e-9);
    RemoteEntity pet = mobOf("ladybug", 30);
    pet.spawnFlags |= net::SpawnIsPet;
    CHECK_NEAR(lightReach(pet, &content), 180.0, 1e-9);
    // florr: a dropped bulb, 200 and 100 more a rarity, 2000 from Unique up.
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Drop, "bulb", Rarity::Common, 10), &content),
               210.0, 1e-9);
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Drop, "bulb", Rarity::Ultra, 10), &content),
               810.0, 1e-9);
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Drop, "bulb", Rarity::Unique, 10), &content),
               2010.0, 1e-9);
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Drop, "basic", Rarity::Ultra, 10), &content),
               0.0, 1e-9);
    // Ours: every emissive petal, worn too, and the emissive mobs.
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Petal, "bulb", Rarity::Rare, 10), &content),
               410.0, 1e-9);
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Petal, "uranium", Rarity::Epic, 10), &content),
               510.0, 1e-9);
    CHECK_NEAR(lightReach(petalOf(net::EntityKind::Petal, "basic", Rarity::Epic, 10), &content),
               0.0, 1e-9);
    CHECK_NEAR(lightReach(mobOf("sun", 100), &content), 2100.0, 1e-9);
    RemoteEntity sunPet = mobOf("sun_pet", 20);
    sunPet.spawnFlags |= net::SpawnIsPet;
    CHECK_NEAR(lightReach(sunPet, &content), 220.0, 1e-9);
}

TEST(a_light_eases_in_and_out_where_it_last_was_then_is_forgotten) {
    DarkMap dark;
    const std::vector<LightSource> one{{5, kAt, 100.0}};
    dark.step(one, 1.0 / 60.0);
    CHECK(dark.lights().count(5) == 1);
    const double first = dark.lights().at(5).fade;
    // florr's expm1(-0.006322 dt): a tenth of the way in one 60 Hz frame.
    CHECK_NEAR(first, -std::expm1(-0.006322 * 1000.0 / 60.0), 1e-9);
    for (int i = 0; i < 120; ++i) dark.step(one, 1.0 / 60.0);
    CHECK(dark.lights().at(5).fade > 0.999);

    // Gone: it stays where it was and dims, and is dropped once all but out.
    const std::vector<LightSource> none;
    dark.step(none, 1.0 / 60.0);
    CHECK(dark.lights().count(5) == 1);
    CHECK(!dark.lights().at(5).present);
    CHECK(dark.lights().at(5).position.x == kAt.x);
    for (int i = 0; i < 90 && dark.lights().count(5) != 0; ++i) dark.step(none, 1.0 / 60.0);
    CHECK(dark.lights().count(5) == 0);
}

TEST(the_dark_is_the_maps_colour_multiplied_in_lifted_by_half_white_discs) {
    // florr: the pyramid's #120D00 lifted a tenth toward white.
    CHECK(near(darknessFloor(0x120D00u), Color{41, 37, 25}, 0));

    DarkMap dark;
    // Reach 25 at zoom 1, at rest: discs 25 and 50 across the centre.
    dark.step({{5, kAt, 25.0}}, 0.0, true);
    const std::vector<std::uint8_t> one = shadedFrame(dark, 0.0);
    const int c = kFrameSize / 2;
    // Out in the dark: white keeps the floor colour's share of itself.
    CHECK(near(pixelAt(one, 2, 2), Color{41, 37, 25}));
    CHECK(near(pixelAt(one, c + 55, c), Color{41, 37, 25}));
    // The 25-unit rim: one half-white disc, half-way back.
    CHECK(near(pixelAt(one, c + 37, c), Color{148, 146, 140}));
    // Inside: both discs, three quarters back.
    CHECK(near(pixelAt(one, c, c), Color{201, 200, 197}));

    // The breathe: a tenth wider half a cycle on.
    CHECK_NEAR(DarkMap::breathe(kPi), 1.1, 1e-9);
    const std::vector<std::uint8_t> swollen = shadedFrame(dark, kPi);
    CHECK(near(pixelAt(swollen, c + 52, c), Color{148, 146, 140}));

    // Overlapping lights stack toward whole.
    dark.step({{5, kAt, 25.0}, {6, kAt + Vec2{20.0, 0.0}, 25.0}}, 0.0, true);
    const std::vector<std::uint8_t> two = shadedFrame(dark, 0.0);
    CHECK(pixelAt(two, c + 10, c).r > 235);
    CHECK(near(pixelAt(two, 2, 2), Color{41, 37, 25}));
}

TEST(on_a_dark_map_nothing_on_the_ground_is_drawn_out_of_the_light) {
    const std::vector<std::uint8_t> blank = mobInTheDark(kAt + Vec2{5000.0, 0.0}, {});
    // A light far off: the mob in the middle of the frame is not drawn.
    const std::vector<LightDisc> elsewhere{{kAt + Vec2{400.0, 0.0}, 200.0, 225.0}};
    CHECK_EQ(testsupport::differingPixels(mobInTheDark(kAt, elsewhere), blank), 0);
    // No light at all: nor is it.
    CHECK_EQ(testsupport::differingPixels(mobInTheDark(kAt, {}), blank), 0);
    // Its own light round it: it is.
    const std::vector<LightDisc> over{{kAt, 200.0, 225.0}};
    CHECK(testsupport::differingPixels(mobInTheDark(kAt, over), blank) > 500);
}
