#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/mob_art.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "shared/core/types.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

// The mobs ported from florr's client are drawn by code, and what moves them
// is part of the port: legs step on how far the body has walked, claws keep a
// clock of their own. A painter that read the wrong one would still draw a
// plausible bug -- one whose legs paddle while it stands still -- so both are
// pinned here on the one mob whose drivers were read out of the binary first.

using namespace flix;

namespace {

/// Every florr marker, by florr's own name.
const char* const kFlorrMarkers[] = {
    "scorpion", "ladybug", "ladybug_dark", "ladybug_shiny", "bee",
    "ant_baby", "ant_worker", "ant_soldier", "ant_soldier_pet", "ant_queen",
    "fire_ant_baby", "fire_ant_worker", "fire_ant_soldier", "fire_ant_soldier_pet",
    "ant_hole", "fire_ant_burrow", "beetle", "beetle_hel", "hornet", "wasp",
    "centipede", "centipede_body", "centipede_evil", "centipede_evil_body",
    "centipede_desert", "centipede_desert_body", "bubble", "bumble_bee", "shell",
    "starfish", "jellyfish", "dandelion", "fly", "leafbug", "leafbug_shiny", "mantis",
    "bush", "roach", "moth", "firefly", "firefly_magic", "dummy",
};

constexpr int kSide = 96;
constexpr std::uint8_t kBackground = 7;

/// `art` drawn at radius 30 in the middle of a 96 px canvas cleared to near
/// black, as RGBA.
std::vector<std::uint8_t> paint(MobArt art, const MobArtAttributes& base) {
    Canvas canvas = Canvas::createVirtual(kSide, kSide);
    canvas.clear(Color{kBackground, kBackground, kBackground});
    canvas.translate(kSide * 0.5f, kSide * 0.5f);
    MobArtAttributes attr = base;
    attr.radius = 30.0;
    paintMobArt(canvas, art, attr);
    return canvas.getImageData(0, 0, kSide, kSide);
}

std::string testsDir() {
    const std::string path = __FILE__;
    const std::size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

const ContentRegistry& shipped() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        r.loadFiles(testsDir() + "/../../src/mobs.json", testsDir() + "/../../src/petals.json",
                    error);
        return r;
    }();
    return registry;
}

int differingPixels(const std::vector<std::uint8_t>& a, const std::vector<std::uint8_t>& b) {
    int count = 0;
    for (std::size_t i = 0; i + 3 < a.size() && i + 3 < b.size(); i += 4) {
        if (a[i] != b[i] || a[i + 1] != b[i + 1] || a[i + 2] != b[i + 2]) ++count;
    }
    return count;
}

/// A scorpion played through the world renderer for `seconds` at 60 fps,
/// walking along +x at `unitsPerSecond` with the camera on it, then the
/// frame it is drawn in at the end -- and the very first frame, in `first`,
/// and the same view with no scorpion in it, in `empty`.
std::vector<std::uint8_t> scorpionAfter(double seconds, double unitsPerSecond,
                                        std::vector<std::uint8_t>& first,
                                        std::vector<std::uint8_t>& empty) {
    constexpr int kSize = 240;
    const std::uint16_t type = shipped().mobIndex("scorpion");
    static const SpriteCache sprites = [] {
        SpriteCache cache;
        cache.build(shipped(), FLIX_TEST_DATA_DIR);
        return cache;
    }();
    WorldRenderer renderer;
    renderer.setContent(&shipped());
    renderer.setSprites(&sprites);
    WorldView view;
    view.setRealm(Realm::Overworld);
    Canvas canvas = Canvas::createVirtual(kSize, kSize);
    {
        const Vec2 at{1000.0, 1000.0};
        Camera camera;
        camera.setViewport(kSize, kSize);
        camera.userZoom = 1.0;
        camera.snapTo(at);
        WorldView nobody;
        nobody.setRealm(Realm::Overworld);
        WorldRenderer bare;
        bare.setContent(&shipped());
        bare.setSprites(&sprites);
        canvas.clear(Color{0, 0, 0});
        bare.draw(canvas, nobody, camera, at, 0.0);
        empty = canvas.getImageData(0, 0, kSize, kSize);
    }
    const int frames = static_cast<int>(std::lround(seconds * 60.0));
    for (int f = 0; f <= frames; ++f) {
        const double t = seconds * f / std::max(1, frames);
        const Vec2 at{1000.0 + unitsPerSecond * t, 1000.0};
        RemoteEntity mob;
        mob.netId = 7;
        mob.kind = net::EntityKind::Mob;
        mob.position = at;
        mob.targetPosition = at;
        mob.needsSnap = false;
        mob.typeIndex = type;
        mob.radius = shipped().mobStats(type, Rarity::Common).radius;
        view.seedForTest(mob);
        Camera camera;
        camera.setViewport(kSize, kSize);
        camera.userZoom = 1.0;
        camera.snapTo(at);
        canvas.clear(Color{0, 0, 0});
        renderer.draw(canvas, view, camera, at, t);
        if (f == 0) first = canvas.getImageData(0, 0, kSize, kSize);
    }
    return canvas.getImageData(0, 0, kSize, kSize);
}

int inkedPixels(const std::vector<std::uint8_t>& rgba) {
    int count = 0;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        if (rgba[i] != kBackground || rgba[i + 1] != kBackground || rgba[i + 2] != kBackground) {
            ++count;
        }
    }
    return count;
}

} // namespace

TEST(every_florr_marker_names_a_painter_that_draws) {
    // A marker that resolves to nothing falls back to a flat disc in the
    // world, and one whose painter was never written draws nothing at all --
    // both silent. Each is asked for ink at rest.
    for (const char* name : kFlorrMarkers) {
        const MobArt art = mobArtFor(std::string("$") + name);
        if (art == MobArt::None) std::printf("    $%s names no painter\n", name);
        CHECK(art != MobArt::None);
        const int ink = inkedPixels(paint(art, MobArtAttributes{}));
        if (ink < 200) std::printf("    $%s drew %d pixels\n", name, ink);
        CHECK(ink >= 200);
    }
}

TEST(a_standing_scorpion_keeps_its_legs_still_while_its_claws_keep_time) {
    const MobArt scorpion = mobArtFor("$scorpion");
    MobArtAttributes rest;

    // The gait runs on the ground covered: 0.06 rad of it per unit walked,
    // so a scorpion that has walked one full stride stands exactly as it
    // started, and half a stride is a different pose.
    MobArtAttributes walked = rest;
    walked.distance = kTau / 0.06;
    CHECK(paint(scorpion, walked) == paint(scorpion, rest));
    walked.distance = kPi / 0.06;
    CHECK(paint(scorpion, walked) != paint(scorpion, rest));

    // The claws run on the clock whether or not it walks: one idle pinch
    // lasts 2 pi / 0.01 ms, and half of one is a closed claw.
    MobArtAttributes later = rest;
    later.clockMs = kTau / 0.01;
    CHECK(paint(scorpion, later) == paint(scorpion, rest));
    later.clockMs = kPi / 0.01;
    CHECK(paint(scorpion, later) != paint(scorpion, rest));

    // Locked on, it pinches three times as fast: a third of an idle pinch is
    // a whole frantic one.
    MobArtAttributes frantic = rest;
    frantic.aggro = 1.0;
    frantic.clockMs = kTau / 0.03;
    CHECK(paint(scorpion, frantic) == paint(scorpion, rest));
}

TEST(in_the_world_a_mob_steps_its_legs_only_as_far_as_it_walks) {
    // The renderer keeps each mob's clock and the ground it has covered from
    // frame to frame. One full idle pinch of the claws later, a scorpion that
    // stood still is drawn exactly as it started -- its legs did not drift
    // while it stood -- and one that walked the same time is not.
    const double pinch = kTau / 0.01 / 1000.0;
    std::vector<std::uint8_t> start, empty;
    const std::vector<std::uint8_t> stood = scorpionAfter(pinch, 0.0, start, empty);
    // Drawn at all, or both checks below pass for nothing.
    CHECK(differingPixels(start, empty) > 1000);
    const int still = differingPixels(stood, start);
    if (still > 8) std::printf("    a standing scorpion changed %d pixels\n", still);
    CHECK(still <= 8);

    const std::vector<std::uint8_t> walked = scorpionAfter(pinch, 150.0, start, empty);
    const int moved = differingPixels(walked, start);
    if (moved < 100) std::printf("    a walking scorpion changed only %d pixels\n", moved);
    CHECK(moved >= 100);
}

TEST(the_spider_and_the_crab_step_on_the_ground_they_cover) {
    // gardn's two walkers, given florr's gait: their legs turn
    // kGaitRadiansPerUnitWalked per unit walked, so a full stride brings them
    // back to where they started and half of one does not. The spider has
    // nothing else that moves, so a clock running on with no ground covered
    // leaves it exactly as it was; the crab's claws keep that clock.
    for (const char* name : {"spider", "crab"}) {
        const MobArt art = mobArtFor(std::string("$") + name);
        CHECK(art != MobArt::None);
        MobArtAttributes rest;
        MobArtAttributes walked = rest;
        walked.distance = kTau / kGaitRadiansPerUnitWalked;
        CHECK(paint(art, walked) == paint(art, rest));
        walked.distance = kPi / kGaitRadiansPerUnitWalked;
        CHECK(paint(art, walked) != paint(art, rest));
    }
    const MobArt spider = mobArtFor("$spider");
    MobArtAttributes later;
    later.animation = 1.3;
    later.clockMs = 1234.0;
    CHECK(paint(spider, later) == paint(spider, MobArtAttributes{}));
}

namespace {

/// One frame of a common `id` facing `angle` with entity `state` bits, drawn
/// through the world renderer at zoom 1 with the camera on it, plus any ring
/// seeds in `seeds`, as RGBA. The mob sits at the canvas centre.
constexpr int kRingSize = 200;
std::vector<std::uint8_t> mobFrame(const char* id, double angle, std::uint8_t state,
                                   const std::vector<RemoteEntity>& seeds) {
    static const SpriteCache sprites = [] {
        SpriteCache cache;
        cache.build(shipped(), FLIX_TEST_DATA_DIR);
        return cache;
    }();
    const std::uint16_t type = shipped().mobIndex(id);
    WorldRenderer renderer;
    renderer.setContent(&shipped());
    renderer.setSprites(&sprites);
    renderer.options.names = false;
    renderer.options.healthBars = false;
    WorldView view;
    view.setRealm(Realm::Overworld);
    const Vec2 at{1000.0, 1000.0};
    RemoteEntity mob;
    mob.netId = 7;
    mob.kind = net::EntityKind::Mob;
    mob.position = mob.targetPosition = at;
    mob.needsSnap = false;
    mob.typeIndex = type;
    mob.angle = angle;
    mob.state = state;
    mob.radius = shipped().mobStats(type, Rarity::Common).radius;
    view.seedForTest(mob);
    for (RemoteEntity seed : seeds) {
        seed.ownerNetId = mob.netId;
        seed.position = seed.targetPosition = at + seed.ownerOffset;
        seed.needsSnap = false;
        view.seedForTest(seed);
    }
    Camera camera;
    camera.setViewport(kRingSize, kRingSize);
    camera.userZoom = 1.0;
    camera.snapTo(at);
    Canvas canvas = Canvas::createVirtual(kRingSize, kRingSize);
    renderer.draw(canvas, view, camera, at, 1.0);
    return canvas.getImageData(0, 0, kRingSize, kRingSize);
}

/// The brightest channel of the pixel `offset` world units from the middle.
int brightnessAt(const std::vector<std::uint8_t>& rgba, Vec2 offset) {
    const int x = static_cast<int>(std::lround(kRingSize * 0.5 + offset.x));
    const int y = static_cast<int>(std::lround(kRingSize * 0.5 + offset.y));
    const std::size_t i = (static_cast<std::size_t>(y) * kRingSize + static_cast<std::size_t>(x)) * 4;
    return std::max({rgba[i], rgba[i + 1], rgba[i + 2]});
}

} // namespace

TEST(a_dandelions_stalks_point_at_its_seats_whichever_way_it_faces) {
    // Its seeds sit on FIXED world bearings (MobPetalRing::bearing ignores the
    // facing), so the stalks in the head have to as well: turned with the
    // mob, they pointed between the seeds. So the head is the same picture
    // whichever way the mob faces -- here half a stalk round, which put every
    // stalk exactly between two seats.
    const std::uint16_t type = shipped().mobIndex("dandelion");
    const MobConfig& config = shipped().mob(type);
    CHECK(config.petalRing.present && config.petalRing.shootOnHit);
    const int count = config.petalRing.count;
    const double step = kTau / count;
    const std::vector<std::uint8_t> frame = mobFrame("dandelion", step * 0.5, 0, {});
    const int moved = differingPixels(frame, mobFrame("dandelion", 0.0, 0, {}));
    if (moved != 0) std::printf("    turning the dandelion changed %d pixels\n", moved);
    CHECK_EQ(moved, 0);

    // And its stalks are ON the seat bearings. Scanned out from clear of the
    // head ring's soft edge (28 of its 25-unit design) to past the longest
    // stalk. Their lengths are random, and the shortest end inside that soft
    // edge, so most rather than all of them are looked for. A stalk is
    // #333333; the bare world is drawn black and the head white.
    const double unit = shipped().mobStats(type, Rarity::Common).radius / 25.0;
    const auto stalkAlong = [&](double bearing) {
        for (double d = 28.0; d <= 36.0; d += 0.25) {
            if (std::abs(brightnessAt(frame, Vec2::fromAngle(bearing, d * unit)) - 0x33) <= 6) {
                return true;
            }
        }
        return false;
    };
    int onSeats = 0;
    int between = 0;
    for (int i = 0; i < count; ++i) {
        if (stalkAlong(i * step)) ++onSeats;
        if (stalkAlong((i + 0.5) * step)) ++between;
    }
    if (onSeats * 2 < count || between != 0) {
        std::printf("    stalks on seats %d/%d, between seats %d\n", onSeats, count, between);
    }
    CHECK(onSeats * 2 >= count);
    CHECK_EQ(between, 0);
}

TEST(a_dandelions_seeds_go_down_under_its_head) {
    // A seed grows out of the head, so the head is drawn over it. One parked
    // on the middle of the head shows only if it is drawn on top: its dark
    // stem then crosses the white disc.
    const std::uint16_t type = shipped().mobIndex("dandelion");
    const MobConfig& config = shipped().mob(type);
    const double bodyRadius = shipped().mobStats(type, Rarity::Common).radius;
    RemoteEntity seed;
    seed.netId = 8;
    seed.kind = net::EntityKind::Petal;
    seed.typeIndex = config.petalRing.petalIndex;
    seed.spawnFlags = net::SpawnRingPetal;
    seed.radius = bodyRadius * config.petalRing.hitScale;
    // Facing +X, so its stem runs back along -X, over the head.
    seed.ownerOffset = Vec2{0.5, 0.0};
    const std::vector<std::uint8_t> frame = mobFrame("dandelion", 0.0, 0, {seed});
    const int stem = brightnessAt(frame, Vec2{-seed.radius * 1.5, 0.0});
    if (stem < 200) std::printf("    the seed's stem shows over the head (%d)\n", stem);
    CHECK(stem >= 200);
}

TEST(a_hornet_wears_its_missile_until_it_fires_it) {
    // The sting IS the loaded missile: drawn on the tail, at the size and
    // place the server will fire it from, and gone from the moment it leaves
    // (net::StateUnloaded) until the next one has slid back out.
    for (const char* id : {"hornet", "wasp"}) {
        const std::uint16_t type = shipped().mobIndex(id);
        const MobConfig& config = shipped().mob(type);
        CHECK(config.stingerShooter && config.projectile.present);
        const double body = shipped().mobStats(type, Rarity::Common).radius;
        const double shot = mobShotRadius(
            shipped().petalStats(config.projectile.ammoPetalIndex, Rarity::Common).size,
            mobShotOwnerScale(body));
        // Facing +X, so the tail and the muzzle are along -X.
        const Vec2 muzzle{-stingerMuzzleDistance(body, shot), 0.0};
        const auto stingAt = [&muzzle](const std::vector<std::uint8_t>& frame) {
            return std::abs(brightnessAt(frame, muzzle) - 0x33) <= 8;
        };
        const bool loaded = stingAt(mobFrame(id, 0.0, 0, {}));
        const bool fired = stingAt(mobFrame(id, 0.0, net::StateUnloaded, {}));
        if (!loaded || fired) std::printf("    %s: loaded %d, just fired %d\n", id, loaded, fired);
        CHECK(loaded);
        CHECK(!fired);
    }
}
