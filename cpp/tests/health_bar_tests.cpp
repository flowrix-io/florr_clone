#include "test.h"

#include "canvas.h"

#include "client/ui/draw.h"
#include "client/ui/theme.h"
#include "client/world_view.h"

#include <cstdint>
#include <vector>

// Every health bar is rysteria_gardn's (ui::healthBar, HealthBarEase): a red
// trail of what was just lost, held a quarter second after the hit and then
// drained, and -- under the HUD's see-through layer -- lines that are clipped
// apart rather than stacked, so the track does not darken the green.

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

/// A bar 200 long and 20 thick on a grey ground, drawn at `alpha`.
std::vector<std::uint8_t> barFrame(double health, double lag, double alpha) {
    Canvas canvas = Canvas::createVirtual(kWidth, kHeight);
    ui::setFill(canvas, kGround);
    canvas.fillRect(0, 0, kWidth, kHeight);
    canvas.setGlobalAlpha(static_cast<float>(alpha));
    ui::HealthBar bar;
    bar.x = 30;
    bar.y = 30;
    bar.length = 200;
    bar.thickness = 20;
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
    // Green over the first half, red over the next quarter, track past it.
    const std::uint32_t at[][2] = {{80, ui::kHealth}, {155, ui::kHealthLag},
                                   {215, ui::kHealthTrack}};
    for (const auto& probe : at) {
        for (int c = 0; c < 3; ++c) {
            CHECK_NEAR(channel(trail, static_cast<int>(probe[0]), c), over(probe[1], 1.0, c), 1.0);
        }
    }

    // With nothing just lost, the same spot is bare track.
    const std::vector<std::uint8_t> settled = barFrame(0.5, 0.5, 1.0);
    for (int c = 0; c < 3; ++c) {
        CHECK_NEAR(channel(settled, 155, c), over(ui::kHealthTrack, 1.0, c), 1.0);
    }
}

TEST(a_see_through_health_bar_blends_each_line_with_the_ground_once) {
    // Under the HUD's layer alpha every line is laid over the GROUND, as a
    // flattened layer would be. Stacked, the green would also take in the
    // track under it and come out darker.
    const std::vector<std::uint8_t> pixels = barFrame(0.5, 0.75, ui::kHudLayerAlpha);
    const std::uint32_t at[][2] = {{80, ui::kHealth}, {155, ui::kHealthLag},
                                   {215, ui::kHealthTrack}};
    for (const auto& probe : at) {
        for (int c = 0; c < 3; ++c) {
            CHECK_NEAR(channel(pixels, static_cast<int>(probe[0]), c),
                       over(probe[1], ui::kHudLayerAlpha, c), 1.0);
        }
    }
}
