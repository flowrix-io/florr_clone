#include "test.h"

#include "input_guard.h"

#include <cmath>
#include <cstdint>

// The production web client's key rule: keys faster than a person types are
// dropped. See input_guard.h. Driven with a clock of its own, because the
// browser half -- isTrusted, the DOM callbacks -- cannot run here.

namespace {

/// How many of `count` fresh presses, `gapMillis` apart from `startMillis`,
/// get through.
int admitted(KeyRateLimit& limit, int count, double gapMillis, double startMillis = 0) {
    int kept = 0;
    for (int i = 0; i < count; ++i) {
        if (limit.admit(startMillis + i * gapMillis, false)) ++kept;
    }
    return kept;
}

} // namespace

TEST(a_chord_pressed_in_one_instant_gets_through_whole) {
    // W and D in the same USB report: both keydowns at one timestamp.
    KeyRateLimit limit;
    CHECK(limit.admit(1000, false));
    CHECK(limit.admit(1000, false));
    CHECK(limit.admit(1000, false));
}

TEST(a_fast_typist_is_never_dropped) {
    // 200 wpm is about 17 keys a second -- sustained for a long sentence.
    KeyRateLimit limit;
    CHECK(admitted(limit, 400, 1000.0 / 17.0) == 400);
}

TEST(a_short_burst_faster_than_the_ceiling_is_absorbed) {
    // A quick bigram run: 8 keys 30 ms apart, then normal typing.
    KeyRateLimit limit;
    CHECK(admitted(limit, 8, 30) == 8);
    CHECK(admitted(limit, 50, 80, 8 * 30 + 80) == 50);
}

TEST(a_script_typing_in_one_instant_is_cut_off_after_the_burst) {
    KeyRateLimit limit;
    const int kept = admitted(limit, 200, 0);
    CHECK(kept == static_cast<int>(KeyRateLimit::kBurst));
}

TEST(a_sustained_stream_above_the_ceiling_keeps_only_the_ceiling) {
    // 200 keys a second for five seconds: the burst, then 20 a second.
    KeyRateLimit limit;
    const int kept = admitted(limit, 1000, 5);
    const int ceiling = static_cast<int>(KeyRateLimit::kBurst + 5 * KeyRateLimit::kPerSecond);
    CHECK(kept <= ceiling + 1);
    CHECK(kept >= ceiling - 1);
}

TEST(the_bucket_refills_after_a_pause) {
    KeyRateLimit limit;
    admitted(limit, 50, 0);
    CHECK(!limit.admit(10, false));
    // Half a second earns 10 presses back -- the whole burst, and no more.
    CHECK(admitted(limit, 50, 0, 510) == static_cast<int>(KeyRateLimit::kBurst));
}

TEST(a_clock_stepping_backwards_earns_nothing) {
    KeyRateLimit limit;
    admitted(limit, 50, 0, 1000);
    CHECK(!limit.admit(0, false));
    CHECK(!limit.admit(1000, false));
}

TEST(os_auto_repeat_does_not_spend_the_bucket) {
    // A held Backspace at 30 a second for three seconds, then a fresh burst.
    KeyRateLimit limit;
    int repeats = 0;
    for (int i = 0; i < 90; ++i) {
        if (limit.admit(i * (1000.0 / 30.0), true)) ++repeats;
    }
    CHECK(repeats == 90);
    CHECK(admitted(limit, 10, 0, 3000) == 10);
}

TEST(repeats_faster_than_any_os_are_thinned) {
    // A script marking every keydown `repeat: true`, 1 ms apart for a second.
    KeyRateLimit limit;
    int kept = 0;
    for (int i = 0; i < 1000; ++i) {
        if (limit.admit(i, true)) ++kept;
    }
    CHECK(kept == 50);
}

// -- the pointer physics ------------------------------------------------------
//
// A hand is modelled the way motor-control papers model an aimed movement: a
// minimum-jerk speed profile from A to B, bowed a little off the straight
// line, with a pixel of tremor, sampled once per 60 Hz frame with a little
// clock jitter and rounded to whole pixels as the DOM does. What a program
// does is written out step by step.

namespace {

constexpr double kW = 1280, kH = 720;
constexpr double kFrame = 1000.0 / 60.0;

struct Hand {
    PointerPhysics physics;
    double now = 1000;
    double x = 640, y = 360;
    std::uint32_t seed = 12345;

    /// A hand that has already been moving the pointer about for a while.
    Hand() {
        physics.setBounds(kW, kH);
        reach(500, 300, 300);
        rest(300);
    }

    struct FreshPage {};
    /// The moment the page loads: nothing known yet.
    explicit Hand(FreshPage) { physics.setBounds(kW, kH); }

    double noise() {
        seed = seed * 1664525u + 1013904223u;
        return (seed >> 8) / double(1u << 24) - 0.5;
    }

    bool sample(PointerSample::Kind kind, double px, double py, double sinceFrame = 8,
                bool scripted = false) {
        PointerSample s;
        s.kind = kind;
        s.millis = now;
        s.x = std::round(px);
        s.y = std::round(py);
        s.sinceFrameMillis = sinceFrame;
        s.scripted = scripted;
        return physics.judge(s);
    }

    bool move(double px, double py) {
        x = px;
        y = py;
        return sample(PointerSample::Kind::Move, x, y);
    }

    /// An aimed movement to (tx, ty) taking `millis`. True if every sample of
    /// it was believed.
    bool reach(double tx, double ty, double millis) {
        const double fx = x, fy = y;
        const double length = std::hypot(tx - fx, ty - fy);
        const double nx = length > 0 ? -(ty - fy) / length : 0;
        const double ny = length > 0 ? (tx - fx) / length : 0;
        const double bow = 0.04 * length;
        bool all = true;
        const int frames = static_cast<int>(std::ceil(millis / kFrame));
        for (int i = 1; i <= frames; ++i) {
            now += kFrame + noise() * 0.6;
            const double t = static_cast<double>(i) / frames;
            const double s = t * t * t * (10 - 15 * t + 6 * t * t);
            const double off = bow * std::sin(3.14159265 * t) + noise() * 1.4;
            double px = fx + (tx - fx) * s + nx * off;
            double py = fy + (ty - fy) * s + ny * off;
            if (i == frames) { px = tx; py = ty; }
            if (!move(px, py)) all = false;
        }
        return all;
    }

    /// Shaking the mouse: an oscillation along `angle`, `amplitude` px each
    /// way at `hertz`, for `millis`, reported every `everyMillis` (a 60 Hz
    /// frame, a 120 Hz one, or a raw 1000 Hz mouse). It winds up over the
    /// first fifth of a second, the way a hand does. True if every sample of
    /// it was believed.
    bool shake(double amplitude, double hertz, double angle, double millis, double everyMillis) {
        const double cx = x, cy = y;
        const double ux = std::cos(angle), uy = std::sin(angle);
        bool all = true;
        for (double t = everyMillis; t <= millis; t += everyMillis) {
            now += everyMillis + noise() * 0.1 * everyMillis;
            const double windUp = t < 200 ? (t / 200) * (t / 200) * (3 - 2 * t / 200) : 1.0;
            const double along = amplitude * windUp * std::sin(2 * 3.14159265 * hertz * t / 1000);
            const double across = noise() * 6;
            if (!move(cx + ux * along - uy * across, cy + uy * along + ux * across)) all = false;
        }
        return all;
    }

    void rest(double millis) { now += millis; }

    bool click() {
        now += 4;
        const bool down = sample(PointerSample::Kind::Press, x, y);
        now += 70;
        const bool up = sample(PointerSample::Kind::Release, x, y);
        return down && up;
    }

    /// A program's "move to x,y": one event, from wherever the pointer was.
    bool teleport(double tx, double ty) {
        now += kFrame;
        return move(tx, ty);
    }
};

} // namespace

TEST(aimed_movements_and_clicks_are_believed) {
    Hand hand;
    CHECK(hand.reach(900, 200, 350));
    CHECK(hand.click());
    hand.rest(400);
    CHECK(hand.reach(200, 600, 500));
    CHECK(hand.click());
    hand.rest(250);
    CHECK(hand.reach(230, 590, 150));   // a small correction
    CHECK(hand.click());
    hand.rest(300);
    CHECK(hand.reach(1200, 80, 600));
    CHECK(hand.click());
}

TEST(a_fast_flick_across_the_screen_is_believed) {
    // A high-DPI gaming mouse: 1200 px in a tenth of a second.
    Hand hand;
    CHECK(hand.reach(40, 360, 400));
    hand.rest(200);
    CHECK(hand.reach(1240, 300, 100));
    CHECK(hand.click());
}

TEST(shaking_the_mouse_is_believed_every_sample) {
    // Small and fast to wild and wide, along every direction, at a 60 Hz and
    // a 120 Hz display's event rate and a raw 1000 Hz mouse's.
    const double amplitudes[] = {20, 80, 200, 400, 600};
    const double rates[] = {1000.0 / 60.0, 1000.0 / 120.0, 1.0};
    int doubted = 0, runs = 0;
    for (const double amplitude : amplitudes) {
        for (double hertz = 3; hertz <= 12; hertz += 3) {
            for (const double every : rates) {
                for (double angle = 0; angle < 3.1; angle += 0.785) {
                    Hand hand;
                    hand.reach(640, 360, 400);
                    hand.rest(200);
                    ++runs;
                    if (!hand.shake(amplitude, hertz, angle, 1500, every)) ++doubted;
                }
            }
        }
    }
    CHECK(runs > 0);
    CHECK(doubted == 0);
}

TEST(a_click_straight_after_shaking_is_believed) {
    Hand hand;
    hand.reach(640, 360, 400);
    hand.rest(200);
    CHECK(hand.shake(300, 8, 0.3, 1200, kFrame));
    CHECK(hand.click());
    hand.rest(150);
    CHECK(hand.click());
}

TEST(a_resting_pointer_may_click_where_it_is) {
    Hand hand;
    CHECK(hand.click());
    hand.rest(2000);
    CHECK(hand.click());
}

TEST(slow_one_pixel_creeping_is_believed) {
    Hand hand;
    bool all = true;
    for (int i = 0; i < 60; ++i) {
        hand.now += kFrame;
        all = hand.move(hand.x + 1, hand.y) && all;
    }
    CHECK(all);
    CHECK(hand.click());
}

TEST(a_teleport_moves_only_that_one_sample) {
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    CHECK(!hand.teleport(1000, 500));
    CHECK(hand.physics.lastFlag() == PointerPhysics::Flag::Teleport);
    // The next event is judged from where the device really is, and is fine.
    hand.now += kFrame;
    CHECK(hand.move(1003, 498));
    hand.now += kFrame;
    CHECK(hand.move(1005, 497));
}

TEST(a_teleport_then_click_is_not_believed) {
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    hand.teleport(1000, 500);
    CHECK(!hand.click());
}

TEST(a_teleport_then_a_pause_then_click_is_not_believed) {
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    hand.teleport(1000, 500);
    hand.rest(300);
    CHECK(!hand.click());
    CHECK(hand.physics.lastFlag() == PointerPhysics::Flag::Press);  // the release follows
}

TEST(a_click_somewhere_the_pointer_never_went_is_not_believed) {
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    hand.x = 900;
    hand.y = 150;
    CHECK(!hand.click());
}

TEST(a_short_teleport_then_a_wiggle_then_click_is_not_believed) {
    // Under the step limit, and followed by a few small "human" moves.
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    hand.teleport(500, 380);
    for (int i = 0; i < 4; ++i) {
        hand.now += kFrame;
        hand.move(hand.x + ((i % 2) ? 2 : -1), hand.y);
    }
    CHECK(!hand.click());
}

TEST(a_ruler_straight_constant_speed_line_is_not_believed) {
    // page.mouse.move(x, y, {steps: 40}) driven one step a frame.
    Hand hand;
    int doubted = 0;
    for (int i = 1; i <= 40; ++i) {
        hand.now += kFrame;
        if (!hand.move(500 + i * 11.3, 300 - i * 4.1)) ++doubted;
    }
    CHECK(doubted > 0);
    CHECK(!hand.click());
}

TEST(an_instant_burst_of_interpolated_moves_is_not_believed) {
    // DevTools Input.dispatchMouseEvent, ten steps sent back to back.
    Hand hand;
    for (int i = 1; i <= 10; ++i) {
        hand.now += 0.05;
        hand.move(500 + i * 30, 300);
    }
    CHECK(!hand.click());
}

TEST(what_the_browser_says_a_script_made_is_not_believed) {
    Hand hand;
    hand.now += kFrame;
    CHECK(!hand.sample(PointerSample::Kind::Move, hand.x + 3, hand.y, 8, true));
    hand.now += kFrame;
    CHECK(hand.move(hand.x + 5, hand.y));   // and the next real one is
}

TEST(an_ordinary_movement_clears_a_suspect_position) {
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.rest(500);
    hand.teleport(1000, 500);
    hand.rest(300);
    CHECK(!hand.click());
    hand.rest(300);
    CHECK(hand.reach(800, 400, 300));
    hand.rest(200);
    CHECK(hand.click());
}

TEST(right_after_the_page_loads_a_click_needs_a_movement_first) {
    // A bot's favourite moment: the page is up and nothing is known.
    Hand bot{Hand::FreshPage{}};
    CHECK(bot.teleport(900, 400));     // the first sample of all is taken as it is
    CHECK(!bot.click());               // but a click there is not

    // A player's first stroke, on the way to their first click, is enough.
    Hand player{Hand::FreshPage{}};
    player.reach(700, 420, 300);
    player.rest(100);
    CHECK(player.click());
}

TEST(a_pointer_entering_at_an_edge_starts_fresh) {
    Hand hand;
    CHECK(hand.reach(600, 300, 300));
    hand.now += 10;
    hand.sample(PointerSample::Kind::Leave, 1279, 300);
    hand.rest(2000);
    hand.x = 20;
    hand.y = 500;
    CHECK(hand.sample(PointerSample::Kind::Enter, hand.x, hand.y));
    CHECK(hand.reach(300, 450, 250));
    CHECK(hand.click());
}

TEST(a_pointer_appearing_mid_canvas_from_nowhere_is_not_believed) {
    Hand hand;
    CHECK(hand.reach(600, 300, 300));
    hand.now += 10;
    hand.sample(PointerSample::Kind::Leave, 1279, 300);
    hand.rest(500);
    hand.x = 400;
    hand.y = 350;
    CHECK(!hand.sample(PointerSample::Kind::Enter, hand.x, hand.y));
    CHECK(hand.physics.lastFlag() == PointerPhysics::Flag::Nowhere);
    CHECK(!hand.click());
}

TEST(a_pointer_appearing_mid_canvas_after_a_focus_change_is_believed) {
    // Cmd-Tab back with the pointer somewhere else on the screen.
    Hand hand;
    CHECK(hand.reach(600, 300, 300));
    hand.sample(PointerSample::Kind::Leave, 1279, 300);
    hand.rest(3000);
    hand.physics.noteFocusChange(hand.now);
    hand.now += 40;
    hand.x = 400;
    hand.y = 350;
    CHECK(hand.sample(PointerSample::Kind::Enter, hand.x, hand.y));
    CHECK(hand.click());
}

TEST(a_stalled_page_folding_a_whole_movement_into_one_event_is_believed) {
    // The main thread was busy for 400 ms while the hand moved; the browser
    // delivers one event for all of it.
    Hand hand;
    CHECK(hand.reach(300, 300, 300));
    hand.now += 400;
    hand.x = 1000;
    hand.y = 600;
    CHECK(hand.sample(PointerSample::Kind::Move, hand.x, hand.y, 400));
    CHECK(hand.click());
}

TEST(thousands_of_random_aimed_movements_are_all_believed) {
    // The false-positive sweep: anywhere to anywhere, at the speed Fitts' law
    // gives a quick player, each ending in a click.
    Hand hand;
    int doubted = 0;
    for (int i = 0; i < 2000; ++i) {
        const double tx = 20 + (hand.noise() + 0.5) * (kW - 40);
        const double ty = 20 + (hand.noise() + 0.5) * (kH - 40);
        const double d = std::hypot(tx - hand.x, ty - hand.y);
        const double millis = 90 + 110 * std::log2(1 + d / 40) * (0.8 + (hand.noise() + 0.5) * 0.6);
        bool ok = hand.reach(tx, ty, millis);
        hand.rest(20 + (hand.noise() + 0.5) * 300);
        ok = hand.click() && ok;
        if (!ok) ++doubted;
        hand.rest(100 + (hand.noise() + 0.5) * 400);
    }
    CHECK(doubted == 0);
}
