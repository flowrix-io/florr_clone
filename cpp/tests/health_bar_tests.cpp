#include "test.h"

#include "canvas.h"

#include "client/ui/draw.h"
#include "client/ui/theme.h"
#include "client/world_view.h"

#include <cstdint>
#include <vector>

// Every health bar but a mob's is rysteria_gardn's (ui::healthBar,
// HealthBarEase) in the plate it always had: a red trail of what was just
// lost, held a quarter
// second after the hit and then drained, and -- under the HUD's see-through
// layer -- a fill clipped apart from its plate rather than stacked on it, so
// the plate does not darken the green.

using namespace flix;

namespace {

constexpr double kFrameSeconds = 1.0 / 60.0;
constexpr double kFrameMillis = 1000.0 / 60.0;

/// Steps `bar` toward `health` (no shield) for `millis`, from `now`.
double run(HealthBarEase& bar, double health, double now, double millis) {
    for (const double end = now + millis; now < end; now += kFrameMillis) {
        bar.step(health, 0.0, now, kFrameSeconds);
    }
    return now;
}

constexpr int kWidth = 260;
constexpr int kHeight = 60;
constexpr std::uint32_t kGround = 0x808080u;
/// Not black, so a plate that went missing would not read as one.
constexpr std::uint32_t kPlate = 0x1C1C1Cu;

/// A bar 220 by 20 in a plate 4 proud of it, on a grey ground, drawn at
/// `alpha`.
std::vector<std::uint8_t> barFrame(double health, double lag, double alpha) {
    Canvas canvas = Canvas::createVirtual(kWidth, kHeight);
    ui::setFill(canvas, kGround);
    canvas.fillRect(0, 0, kWidth, kHeight);
    canvas.setGlobalAlpha(static_cast<float>(alpha));
    ui::HealthBar bar;
    bar.x = 20;
    bar.y = 20;
    bar.width = 220;
    bar.height = 20;
    bar.plateX = 16;
    bar.plateY = 16;
    bar.plateWidth = 228;
    bar.plateHeight = 28;
    bar.plateRadius = 14;
    bar.plateColour = kPlate;
    bar.health = health;
    bar.lag = lag;
    ui::healthBar(canvas, bar);
    return canvas.getImageData(0, 0, kWidth, kHeight);
}

/// One channel of the pixel at (x, 30), the bar's centre line.
int channel(const std::vector<std::uint8_t>& pixels, int x, int c) {
    return pixels[(static_cast<std::size_t>(30) * kWidth + static_cast<std::size_t>(x)) * 4 +
                  static_cast<std::size_t>(c)];
}

/// `colour` laid once over the ground at `alpha`, channel `c`.
double over(std::uint32_t colour, double alpha, int c) {
    const int shift = 16 - 8 * c;
    return alpha * ((colour >> shift) & 0xFF) + (1.0 - alpha) * ((kGround >> shift) & 0xFF);
}

} // namespace

TEST(a_hit_leaves_a_red_trail_that_holds_and_then_drains) {
    HealthBarEase bar;
    bar.snap(1.0, 0.0);

    // The green slides most of the way down to the new health...
    double now = run(bar, 0.5, 0.0, 200.0);
    CHECK(bar.health < 0.55);
    // ...while the red stays where the health was, for a quarter second.
    CHECK_EQ(bar.lag, 1.0);

    // Then it drains toward the green, never past it.
    now = run(bar, 0.5, now, 300.0);
    CHECK(bar.lag < 1.0);
    CHECK(bar.lag > bar.health);
    now = run(bar, 0.5, now, 3000.0);
    CHECK_NEAR(bar.lag, 0.5, 0.01);

    // A second hit holds it again from that hit.
    now = run(bar, 0.3, now, 200.0);
    const double held = bar.lag;
    CHECK(held > 0.45);
    run(bar, 0.3, now, 30.0);
    CHECK_NEAR(bar.lag, held, 1e-9);
}

TEST(healing_pulls_the_red_trail_up_with_the_green) {
    HealthBarEase bar;
    bar.snap(0.4, 0.0);
    run(bar, 0.9, 0.0, 100.0);
    CHECK(bar.health > 0.4);
    // There is nothing lost to show: the trail rides at the green's end.
    CHECK_EQ(bar.lag, bar.health);
}

TEST(a_health_bar_shows_its_red_trail_only_while_there_is_one) {
    const std::vector<std::uint8_t> trail = barFrame(0.5, 0.75, 1.0);
    // Green over the first half, red over the next quarter, plate past it.
    const std::uint32_t at[][2] = {{80, ui::kHealth}, {155, ui::kHealthLag},
                                   {215, kPlate}};
    for (const auto& probe : at) {
        for (int c = 0; c < 3; ++c) {
            CHECK_NEAR(channel(trail, static_cast<int>(probe[0]), c), over(probe[1], 1.0, c), 1.0);
        }
    }

    // With nothing just lost, the same spot is bare plate.
    const std::vector<std::uint8_t> settled = barFrame(0.5, 0.5, 1.0);
    for (int c = 0; c < 3; ++c) {
        CHECK_NEAR(channel(settled, 155, c), over(kPlate, 1.0, c), 1.0);
    }
}

TEST(a_see_through_health_bar_blends_each_line_with_the_ground_once) {
    // Under the HUD's layer alpha every line is laid over the GROUND, as a
    // flattened layer would be. Stacked, the green would also take in the
    // plate under it and come out darker.
    const std::vector<std::uint8_t> pixels = barFrame(0.5, 0.75, ui::kHudLayerAlpha);
    const std::uint32_t at[][2] = {{80, ui::kHealth}, {155, ui::kHealthLag},
                                   {215, kPlate}};
    for (const auto& probe : at) {
        for (int c = 0; c < 3; ++c) {
            CHECK_NEAR(channel(pixels, static_cast<int>(probe[0]), c),
                       over(probe[1], ui::kHudLayerAlpha, c), 1.0);
        }
    }
}

TEST(a_health_bar_sits_in_the_plate_its_caller_gives_it) {
    // Every bar keeps the plate it always had: the rim above and below the
    // fill, and the plate's own end past the fill's, are the caller's colour.
    const std::vector<std::uint8_t> full = barFrame(1.0, 1.0, 1.0);
    const auto at = [&](int x, int y, int c) {
        return full[(static_cast<std::size_t>(y) * kWidth + static_cast<std::size_t>(x)) * 4 +
                    static_cast<std::size_t>(c)];
    };
    for (int c = 0; c < 3; ++c) {
        CHECK_NEAR(at(130, 17, c), over(kPlate, 1.0, c), 1.0);
        CHECK_NEAR(at(130, 42, c), over(kPlate, 1.0, c), 1.0);
        CHECK_NEAR(at(130, 30, c), over(ui::kHealth, 1.0, c), 1.0);
        CHECK_NEAR(at(242, 30, c), over(kPlate, 1.0, c), 1.0);
    }
}

// ---------------------------------------------------------------------------
// A mob's plate (MobPlateEase) is florr's, not rysteria's: it starts from
// nothing and its red waits for the green rather than for a clock.
// ---------------------------------------------------------------------------

namespace {

/// Steps `plate` toward `health` (no shield), shown, for `millis`.
void run(MobPlateEase& plate, double health, double millis) {
    for (double t = 0; t < millis; t += kFrameMillis) plate.step(health, 0.0, true, kFrameSeconds);
}

} // namespace

TEST(a_mobs_plate_fades_in_over_an_empty_bar_that_fills) {
    MobPlateEase plate;
    CHECK_EQ(plate.opacity, 0.0);
    CHECK_EQ(plate.health, 0.0);
    // florr's 0.2 of the gap per 60 Hz frame: a fifth of the way there after
    // one frame, and all but settled after half a second.
    run(plate, 0.8, kFrameMillis * 0.5);
    CHECK_NEAR(plate.opacity, 0.2, 1e-6);
    CHECK_NEAR(plate.health, 0.16, 1e-6);
    run(plate, 0.8, 500.0);
    CHECK_NEAR(plate.opacity, 1.0, 1e-3);
    CHECK_NEAR(plate.health, 0.8, 1e-3);
    // The red filled up behind the green, slower, but never past it.
    CHECK(plate.lag <= plate.health + 1e-9);
}

TEST(a_mobs_red_trail_holds_until_the_green_has_landed) {
    MobPlateEase plate;
    plate.snap(1.0, 0.0, true);
    plate.step(0.4, 0.0, true, kFrameSeconds);
    // The green is on its way down and still well above the health, so the
    // red has not moved.
    CHECK(plate.health > 0.4 + 0.1);
    CHECK_EQ(plate.lag, 1.0);
    run(plate, 0.4, 600.0);
    // The green has landed and the red is draining after it, at half its rate.
    CHECK_NEAR(plate.health, 0.4, 1e-3);
    CHECK(plate.lag < 1.0);
    CHECK(plate.lag > 0.4);
    run(plate, 0.4, 2000.0);
    CHECK_NEAR(plate.lag, 0.4, 1e-3);
}

TEST(a_hidden_mob_plate_fades_out) {
    MobPlateEase plate;
    plate.snap(1.0, 0.0, true);
    for (double t = 0; t < 1000.0; t += kFrameMillis) plate.step(1.0, 0.0, false, kFrameSeconds);
    CHECK(plate.opacity < 1e-3);
}
