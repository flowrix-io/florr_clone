#include "test.h"

#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "shared/game/constants.h"
#include "shared/net/protocol.h"
#include "render_rig.h"

#include <cstdint>
#include <vector>

// The bar under the viewer's own flower: there while the flower is hurt or
// shielded, and not a pixel of it otherwise. Claims about what is on the
// screen, so they are read off frames.

using namespace flix;

namespace {

constexpr int kFrameSize = 320;
constexpr Vec2 kAt{1000.0, 1000.0};
/// The first row under the body that a frame keeps.
constexpr int kStripTop = kFrameSize / 2 + 40;
constexpr std::uint32_t kSelf = 7;
constexpr double kFrameSeconds = 1.0 / 60.0;

using Pixels = std::vector<std::uint8_t>;

/// The viewer's own flower, where a frame is centred.
RemoteEntity ownFlower(double health, double shield, double size = 1.0) {
    RemoteEntity flower;
    flower.netId = kSelf;
    flower.kind = net::EntityKind::Player;
    flower.spawnFlags = net::SpawnIsSelf;
    flower.position = flower.targetPosition = kAt;
    flower.needsSnap = false;
    flower.level = 1;
    flower.radius = playerRadiusForLevel(flower.level) * size;
    flower.healthFraction = health;
    flower.shieldFraction = shield;
    return flower;
}

struct Scene {
    WorldView view;
    WorldRenderer renderer;
    SelfState self;
    double now = 0;

    Scene(double health, double shield) { set(health, shield); }

    /// Settles the flower on these values outright.
    void set(double health, double shield) {
        view.seedForTest(ownFlower(health, shield));
        view.setSelfNetIdForTest(kSelf);
        renderer.setSelfState(&self);
    }

    void run(double seconds) {
        for (double t = 0; t < seconds; t += kFrameSeconds) {
            now += kFrameSeconds * 1000.0;
            view.interpolate(now, kFrameSeconds);
        }
    }

    double opacity() const { return view.entities().at(kSelf).selfBarOpacity; }

    Pixels frame() const {
        Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
        renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
        // The strip under the body only, so nothing the flower's face does can
        // stand in for the bar.
        return canvas.getImageData(0, kStripTop, kFrameSize, kFrameSize - kStripTop);
    }
};

/// A frame with no bar of any kind under the flower.
Pixels bareFrame() {
    Scene scene(0.5, 0.5);
    scene.renderer.options.healthBars = false;
    return scene.frame();
}

/// The first row of the strip that differs from the bare one, or -1.
int firstChangedRow(const Pixels& frame, const Pixels& bare) {
    for (std::size_t i = 0; i < frame.size(); ++i) {
        if (frame[i] != bare[i]) return static_cast<int>(i / (kFrameSize * 4));
    }
    return -1;
}

} // namespace

TEST(the_viewers_own_flower_wears_a_health_bar_only_while_hurt_or_shielded) {
    const Pixels bare = bareFrame();
    CHECK_EQ(testsupport::differingPixels(Scene(1.0, 0.0).frame(), bare), 0);
    CHECK(testsupport::differingPixels(Scene(0.5, 0.0).frame(), bare) > 200);
    CHECK(testsupport::differingPixels(Scene(0.99, 0.0).frame(), bare) > 200);
    CHECK(testsupport::differingPixels(Scene(1.0, 0.2).frame(), bare) > 200);
}

TEST(the_viewers_own_health_bar_fades_out_once_it_has_filled) {
    Scene scene(0.5, 0.0);
    CHECK_EQ(scene.opacity(), 1.0);
    scene.run(1.0);
    CHECK_NEAR(scene.opacity(), 1.0, 1e-9);

    // Whole again at a stroke: the bar is still up while the green fills.
    RemoteEntity& flower = const_cast<RemoteEntity&>(scene.view.entities().at(kSelf));
    flower.healthFraction = 1.0;
    scene.run(0.1);
    CHECK_EQ(scene.opacity(), 1.0);
    scene.run(2.0);
    CHECK_EQ(testsupport::differingPixels(scene.frame(), bareFrame()), 0);

    // A shield alone brings it back, and losing the shield takes it away.
    flower.shieldFraction = 0.3;
    scene.run(1.0);
    CHECK(scene.opacity() > 0.99);
    flower.shieldFraction = 0.0;
    scene.run(2.0);
    CHECK_EQ(testsupport::differingPixels(scene.frame(), bareFrame()), 0);
}

TEST(the_viewers_own_health_bar_hangs_where_gardn_hangs_one) {
    // gardn's RenderHealth.cc: the line along the bar's middle is 1.33 radii
    // and 15 units under the flower's centre, at any size.
    for (const double size : {1.0, 1.6}) {
        Scene scene(0.5, 0.0);
        scene.view.seedForTest(ownFlower(0.99, 0.0, size));
        Scene bare(1.0, 0.0);
        bare.view.seedForTest(ownFlower(1.0, 0.0, size));
        const Pixels with = scene.frame();
        const Pixels without = bare.frame();

        // Coverage-weighted middle of the lit rows down the frame's centre
        // column: the fill is flat and symmetric about the bar's own middle.
        double sum = 0, weight = 0;
        const std::size_t rows = with.size() / (kFrameSize * 4);
        for (std::size_t y = 0; y < rows; ++y) {
            const std::size_t i = (y * kFrameSize + kFrameSize / 2) * 4 + 1;
            const double lit = static_cast<double>(with[i]) - without[i];
            sum += lit * (static_cast<double>(y) + 0.5);
            weight += lit;
        }
        CHECK(weight > 0);
        if (weight <= 0) continue;
        CHECK_NEAR(sum / weight + kStripTop - kFrameSize / 2,
                   kPlayerBaseRadius * size * 1.33 + 15.0, 0.3);
    }
}

TEST(the_viewers_mana_bar_makes_room_for_their_health_bar) {
    const Pixels bare = bareFrame();
    const int healthRow = firstChangedRow(Scene(0.5, 0.0).frame(), bare);
    CHECK(healthRow >= 0);

    // Alone, mana has the slot to itself.
    Scene whole(1.0, 0.0);
    whole.self.mana = whole.self.maxMana = 100.0;
    CHECK_EQ(firstChangedRow(whole.frame(), bare), healthRow);

    // With a health bar in it, mana is a row below, over none of it.
    Scene hurt(0.5, 0.0);
    const Pixels before = hurt.frame();
    hurt.self.mana = hurt.self.maxMana = 100.0;
    CHECK(firstChangedRow(hurt.frame(), before) > healthRow + 10);
}
