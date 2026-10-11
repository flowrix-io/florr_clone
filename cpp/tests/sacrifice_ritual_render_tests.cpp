// The sacrifice ritual, as pixels: a grey star five times the summoned mob's
// size that turns what lies under it grey -- flowers and the summoned mob
// excepted -- and a pentagram in legendary red the mob's own size, traced over
// five seconds, both turned to the ritual's own angle.

#include "test.h"

#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "shared/game/components.h"
#include "shared/game/constants.h"
#include "shared/net/protocol.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "render_rig.h"
#include "test_data.h"

using namespace flix;

namespace {

constexpr int kFrameSize = 400;
constexpr Vec2 kRitualAt{1000.0, 1000.0};
constexpr double kStarRadius = 160.0;
/// Not straight up, so a ritual drawn ignoring its angle fails.
constexpr double kRitualAngle = 0.7;
/// The flower stands this far out along the star's third arm, clear of every
/// pentagram edge's middle.
constexpr double kFlowerReach = kStarRadius * 0.75;

RemoteEntity ritual(bool complete) {
    RemoteEntity e;
    e.netId = 9;
    e.kind = net::EntityKind::Effect;
    e.typeIndex = static_cast<std::uint16_t>(GroundEffectKind::Sacrifice);
    e.position = e.targetPosition = kRitualAt;
    e.needsSnap = false;
    e.radius = kStarRadius;
    e.angle = e.targetAngle = kRitualAngle;
    e.state = complete ? net::StateRitualComplete : 0;
    return e;
}

RemoteEntity flower() {
    RemoteEntity e;
    e.netId = 4;
    e.kind = net::EntityKind::Player;
    const double angle = kRitualAngle + 2 * kTau / 5.0;
    e.position = e.targetPosition = kRitualAt + Vec2::fromAngle(angle, kFlowerReach);
    e.needsSnap = false;
    e.radius = playerRadiusForLevel(1);
    e.level = 1;
    return e;
}

const ContentRegistry& shipped() { return testsupport::shippedContent(); }

const SpriteCache& shippedSprites() {
    static const SpriteCache sprites = [] {
        SpriteCache cache;
        cache.build(shipped(), testsupport::dataDir());
        return cache;
    }();
    return sprites;
}

/// A common ladybug -- red, so there is colour to take away -- at `at` on
/// the screen.
RemoteEntity ladybugAt(std::uint32_t netId, Vec2 screen, bool sacrificed = false) {
    RemoteEntity e;
    e.spawnFlags = sacrificed ? net::SpawnSacrificed : 0;
    e.netId = netId;
    e.kind = net::EntityKind::Mob;
    e.typeIndex = shipped().mobIndex("ladybug");
    e.position = e.targetPosition =
        kRitualAt + Vec2{screen.x - kFrameSize * 0.5, screen.y - kFrameSize * 0.5};
    e.needsSnap = false;
    e.radius = 20.0;
    return e;
}

/// The frame `age` seconds after the ritual first came into view, with
/// `extra` standing in it too.
std::vector<std::uint8_t> render(bool complete, double age, bool withRitual = true,
                                 const std::vector<RemoteEntity>& extra = {}) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    const Camera camera = testsupport::frameCamera(kFrameSize, kRitualAt);
    WorldView view;
    view.setRealm(Realm::Arena);
    view.seedForTest(flower());
    for (const RemoteEntity& e : extra) view.seedForTest(e);
    if (withRitual) view.seedForTest(ritual(complete));
    WorldRenderer renderer;
    renderer.setContent(&shipped());
    renderer.setSprites(&shippedSprites());
    renderer.draw(canvas, view, camera, kRitualAt, 0.0);
    const int steps = static_cast<int>(std::lround(age * 60.0));
    for (int i = 0; i < steps; ++i) renderer.update(1.0 / 60.0);
    renderer.draw(canvas, view, camera, kRitualAt, age);
    std::vector<std::uint8_t> frame = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_RITUAL_PPM=<path> keeps the frame, for a look by eye.
    if (const char* path = std::getenv("FLIX_RITUAL_PPM")) {
        if (std::FILE* out = std::fopen(path, "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < frame.size(); i += 4) std::fwrite(&frame[i], 1, 3, out);
            std::fclose(out);
        }
    }
    return frame;
}

const std::uint8_t* pixel(const std::vector<std::uint8_t>& rgba, Vec2 at) {
    const int x = static_cast<int>(std::lround(at.x));
    const int y = static_cast<int>(std::lround(at.y));
    return &rgba[(static_cast<std::size_t>(y) * kFrameSize + x) * 4];
}

bool grey(const std::uint8_t* p) {
    return std::abs(p[0] - p[1]) <= 2 && std::abs(p[1] - p[2]) <= 2;
}

bool coloured(const std::uint8_t* p) { return !grey(p); }

bool legendaryRed(const std::uint8_t* p) { return p[0] > 180 && p[1] < 90 && p[2] < 90; }

/// Where the star's points are on screen: point 0 along the ritual's angle.
Vec2 starPoint(int k, double reach) {
    const double angle = kRitualAngle + k * kTau / 5.0;
    return Vec2{kFrameSize * 0.5 + std::cos(angle) * reach,
                kFrameSize * 0.5 + std::sin(angle) * reach};
}

Vec2 midpoint(Vec2 a, Vec2 b) { return (a + b) * 0.5; }

} // namespace

/// Pixels within `reach` of `at` that carry colour.
int colouredNear(const std::vector<std::uint8_t>& rgba, Vec2 at, double reach) {
    int n = 0;
    for (int y = static_cast<int>(at.y - reach); y <= static_cast<int>(at.y + reach); ++y) {
        for (int x = static_cast<int>(at.x - reach); x <= static_cast<int>(at.x + reach); ++x) {
            if (std::hypot(x - at.x, y - at.y) > reach) continue;
            n += coloured(pixel(rgba, Vec2{static_cast<double>(x), static_cast<double>(y)})) ? 1 : 0;
        }
    }
    return n;
}

TEST(a_ritual_star_greys_the_mobs_under_it_but_not_the_flower_or_its_own_mob) {
    // A ladybug down the middle of one of the star's arms, one well outside
    // the star altogether, and the sacrifice's own mob down another arm.
    const Vec2 inArm = starPoint(0, kStarRadius * 0.62);
    const Vec2 outside = Vec2{kFrameSize * 0.5, kFrameSize * 0.5} +
                         Vec2::fromAngle(kRitualAngle + kTau / 10.0, kStarRadius * 1.15);
    const Vec2 summoned = starPoint(4, kStarRadius * 0.62);
    const std::vector<RemoteEntity> bugs{ladybugAt(21, inArm), ladybugAt(22, outside),
                                         ladybugAt(23, summoned, true)};

    const std::vector<std::uint8_t> bare = render(true, 0.0, false, bugs);
    CHECK(colouredNear(bare, inArm, 8.0) > 20);

    const std::vector<std::uint8_t> frame = render(true, 0.0, true, bugs);
    // Under the star the mob is grey; past it, red as ever.
    CHECK_EQ(colouredNear(frame, inArm, 8.0), 0);
    CHECK(colouredNear(frame, outside, 8.0) > 20);
    // The flower standing in another arm keeps its colour, and so does the
    // mob the sacrifice summoned.
    CHECK(colouredNear(frame, starPoint(2, kFlowerReach), 8.0) > 20);
    CHECK(colouredNear(frame, summoned, 8.0) > 20);
}

TEST(the_ritual_pentagram_is_traced_in_legendary_red_over_five_seconds) {
    // The mob's size: a fifth of the star's.
    const double pentagram = kStarRadius / kSacrificeRitualRadiusScale;
    // The five edges in drawing order: point 0 -> 2 -> 4 -> 1 -> 3 -> 0.
    const auto edgeMiddle = [&](int edge) {
        return midpoint(starPoint((edge * 2) % 5, pentagram),
                        starPoint(((edge + 1) * 2) % 5, pentagram));
    };
    // Halfway, two and a half edges are down.
    const std::vector<std::uint8_t> half = render(false, kSacrificeRitualMillis / 2000.0);
    CHECK(legendaryRed(pixel(half, edgeMiddle(0))));
    CHECK(legendaryRed(pixel(half, edgeMiddle(1))));
    CHECK(!legendaryRed(pixel(half, edgeMiddle(3))));
    CHECK(!legendaryRed(pixel(half, edgeMiddle(4))));
    // Nothing red out at the star's own points: the pentagram is the smaller.
    for (int k = 0; k < 5; ++k) CHECK(!legendaryRed(pixel(half, starPoint(k, kStarRadius * 0.9))));
    // At the end, and whenever the server says the mob is out, it is whole.
    const std::vector<std::uint8_t> drawn = render(false, kSacrificeRitualMillis / 1000.0 + 0.1);
    for (int edge = 0; edge < 5; ++edge) CHECK(legendaryRed(pixel(drawn, edgeMiddle(edge))));
    const std::vector<std::uint8_t> complete = render(true, 0.0);
    for (int edge = 0; edge < 5; ++edge) CHECK(legendaryRed(pixel(complete, edgeMiddle(edge))));
}

// The ritual shakes the screen, as florr's does: from when it starts until its
// mob is out, and only while it is on screen.

namespace {

/// The largest shake over `seconds` of 60 fps frames, with the camera on
/// `cameraAt`, the ritual `complete` or not.
double ritualShake(WorldRenderer& renderer, WorldView& view, bool complete, Vec2 cameraAt,
                   double seconds) {
    view.seedForTest(ritual(complete));
    const Camera camera = testsupport::frameCamera(kFrameSize, cameraAt);
    double largest = 0.0;
    for (int i = 0; i < static_cast<int>(seconds * 60.0); ++i) {
        Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
        renderer.draw(canvas, view, camera, cameraAt, 0.0);
        renderer.update(1.0 / 60.0);
        largest = std::max(largest, renderer.shakeOffset().length());
    }
    return largest;
}

WorldView arenaView() {
    WorldView view;
    view.setRealm(Realm::Arena);
    return view;
}

} // namespace

TEST(a_sacrifice_ritual_on_screen_shakes_it_until_its_mob_is_out) {
    WorldView view = arenaView();
    WorldRenderer renderer;
    // Tracing: the shake runs at full strength through it.
    const double during = ritualShake(renderer, view, false, kRitualAt, 2.0);
    CHECK(during > 4.0);
    CHECK(during <= 5.0 + 1e-9);

    // Out: no more pushes, and what is left settles within a second.
    ritualShake(renderer, view, true, kRitualAt, 1.0);
    CHECK(renderer.shakeOffset().length() < 0.05);
}

TEST(a_sacrifice_ritual_off_screen_or_already_done_does_not_shake_it) {
    {
        WorldView view = arenaView();
        WorldRenderer renderer;
        CHECK_EQ(ritualShake(renderer, view, false, kRitualAt + Vec2{3000.0, 0.0}, 1.0), 0.0);
    }
    {
        WorldView view = arenaView();
        WorldRenderer renderer;
        CHECK_EQ(ritualShake(renderer, view, true, kRitualAt, 1.0), 0.0);
    }
    {
        // The setting turns it off.
        WorldView view = arenaView();
        WorldRenderer renderer;
        renderer.options.screenShake = false;
        CHECK_EQ(ritualShake(renderer, view, false, kRitualAt, 1.0), 0.0);
    }
}
