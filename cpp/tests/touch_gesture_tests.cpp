#include "test.h"

#include "touch_gesture.h"

#include <vector>

// A finger on a list: held until it says whether it is a scroll, a tap, a drag
// or a hold. See touch_gesture.h.
//
// Driven the way Window drives it -- beginFrame, then the frame's contacts --
// and read back as the mouse a panel would see, because that is the whole
// contract: what a frame of mousePressed / mouseDown / mouseReleased looks
// like for each gesture. None of it can be seen in a screenshot, and every
// list in the game depends on it.

namespace {

/// One list down the middle of a 1000x1000 space, and nothing else.
const WindowRect kList{200, 200, 600, 600};

/// A frame of the mirrored left button, as Window::Impl::applyMouse leaves it.
struct Frame {
    float x = 0, y = 0;
    bool held = false;
    bool pressed = false;
    bool released = false;
    TouchPan pan;
};

struct Rig {
    TouchScrollGesture gesture;
    float x = -1, y = -1;
    bool held = false;
    double now = 0;

    Rig() {
        gesture.setRegions({kList});
        gesture.setUnitsPerPoint(1.0);
    }

    void apply(const TouchScrollGesture::Mouse& out, Frame& f) {
        if (out.moved) { x = out.x; y = out.y; }
        if (out.press) { held = true; f.pressed = true; }
        if (out.release) { held = false; f.released = true; }
    }

    /// Advances the clock by `dt` and runs one frame with these contacts.
    Frame frame(double dt, std::vector<TouchEvent> events = {}) {
        now += dt;
        Frame f;
        apply(gesture.beginFrame(now), f);
        for (const TouchEvent& e : events) {
            switch (e.phase) {
                case TouchPhase::Began: apply(gesture.began(e.point, now, false), f); break;
                case TouchPhase::Moved: apply(gesture.moved(e.point, now), f); break;
                case TouchPhase::Ended: apply(gesture.ended(e.point, now), f); break;
            }
        }
        f.x = x;
        f.y = y;
        f.held = held;
        f.pan = gesture.pan();
        return f;
    }
};

constexpr double kFrame = 1.0 / 60.0;

TouchEvent began(double x, double y) {
    return {TouchPhase::Began, TouchPoint{1, static_cast<float>(x), static_cast<float>(y)}};
}
TouchEvent moved(double x, double y) {
    return {TouchPhase::Moved, TouchPoint{1, static_cast<float>(x), static_cast<float>(y)}};
}
TouchEvent ended(double x, double y) {
    return {TouchPhase::Ended, TouchPoint{1, static_cast<float>(x), static_cast<float>(y)}};
}

} // namespace

TEST(a_finger_off_every_list_presses_the_moment_it_lands) {
    // Everything that is not a list keeps the mirror it always had: the HUD,
    // the loadout bar and the world must not start answering a frame late.
    Rig rig;
    const Frame down = rig.frame(kFrame, {began(50, 50)});
    CHECK(down.pressed);
    CHECK(down.held);
    CHECK_NEAR(down.x, 50.0, 1e-4);
    CHECK_NEAR(down.y, 50.0, 1e-4);
    CHECK(!rig.gesture.scrolling());

    const Frame up = rig.frame(kFrame, {ended(60, 55)});
    CHECK(up.released);
    CHECK(!up.held);
    // The release lands where the finger left, which is what a control that
    // fires on mouseup tests.
    CHECK_NEAR(up.x, 60.0, 1e-4);
}

TEST(a_tap_on_a_list_is_a_press_and_a_release_where_it_landed) {
    Rig rig;
    const Frame down = rig.frame(kFrame, {began(400, 400)});
    // Nothing pressed yet -- but the pointer is already there, so the press
    // that follows finds this spot's hover rather than the last one's.
    CHECK(!down.pressed);
    CHECK(!down.held);
    CHECK_NEAR(down.x, 400.0, 1e-4);
    CHECK(rig.gesture.scrolling());

    rig.frame(kFrame, {moved(402, 401)});   // wobble inside the slop
    const Frame up = rig.frame(kFrame, {ended(403, 402)});
    CHECK(up.pressed);
    CHECK(up.released);
    CHECK(!up.held);
    CHECK_NEAR(up.x, 400.0, 1e-4);
    CHECK_NEAR(up.y, 400.0, 1e-4);
    CHECK(!up.pan.active);
}

TEST(a_vertical_drag_on_a_list_scrolls_it_and_presses_nothing) {
    Rig rig;
    bool everPressed = false;
    double scrolled = 0;
    const auto take = [&](const Frame& f) {
        everPressed = everPressed || f.pressed || f.released || f.held;
        if (f.pan.active) scrolled += f.pan.dy;
    };
    take(rig.frame(kFrame, {began(400, 400)}));
    take(rig.frame(kFrame, {moved(401, 420)}));
    const Frame mid = rig.frame(kFrame, {moved(402, 470)});
    take(mid);
    CHECK(mid.pan.active);
    // The pan reports where the finger LANDED, which is how the list it
    // grabbed recognises it even after it wanders off the list.
    CHECK_NEAR(mid.pan.originX, 400.0, 1e-4);
    CHECK_NEAR(mid.pan.originY, 400.0, 1e-4);
    // Pause before lifting, so nothing coasts.
    take(rig.frame(0.2));
    take(rig.frame(kFrame, {ended(402, 470)}));
    for (int i = 0; i < 10; ++i) take(rig.frame(kFrame));

    CHECK(!everPressed);
    // Glued to the finger from where it landed, not from where it crossed the
    // slop: the list moved exactly as far as the finger did.
    CHECK_NEAR(scrolled, 70.0, 1e-3);
}

TEST(a_sideways_drag_on_a_list_presses_where_it_landed_and_drags_from_there) {
    // How a petal comes out of the inventory without a long press, and how a
    // slider in a scrolled settings list moves at all.
    Rig rig;
    rig.frame(kFrame, {began(400, 400)});
    const Frame commit = rig.frame(kFrame, {moved(430, 404)});
    CHECK(commit.pressed);
    CHECK(commit.held);
    CHECK(!commit.pan.active);
    // The press is aimed at what the finger landed on, not 30 units away.
    CHECK_NEAR(commit.x, 400.0, 1e-4);
    CHECK_NEAR(commit.y, 400.0, 1e-4);

    // The finger's position reaches the pointer on the next frame, moved or
    // not -- a drag that pauses right after the commit is still where the
    // finger is.
    const Frame next = rig.frame(kFrame);
    CHECK(!next.pressed);
    CHECK(next.held);
    CHECK_NEAR(next.x, 430.0, 1e-4);

    const Frame drag = rig.frame(kFrame, {moved(480, 420)});
    CHECK_NEAR(drag.x, 480.0, 1e-4);
    CHECK(!drag.pan.active);
    const Frame up = rig.frame(kFrame, {ended(490, 420)});
    CHECK(up.released);
    CHECK_NEAR(up.x, 490.0, 1e-4);
}

TEST(holding_still_on_a_list_presses_after_the_hold_time) {
    // Long-press is how a phone picks something up out of a list.
    Rig rig;
    rig.frame(kFrame, {began(400, 400)});
    const Frame early = rig.frame(TouchScrollGesture::kHoldSeconds * 0.5);
    CHECK(!early.pressed);
    CHECK(!early.held);

    const Frame late = rig.frame(TouchScrollGesture::kHoldSeconds);
    CHECK(late.pressed);
    CHECK(late.held);
    CHECK_NEAR(late.x, 400.0, 1e-4);
    CHECK(!rig.gesture.scrolling());

    // Committed: moving now drags, and never turns back into a scroll.
    const Frame drag = rig.frame(kFrame, {moved(400, 500)});
    CHECK(!drag.pan.active);
    CHECK(drag.held);
    CHECK_NEAR(drag.y, 500.0, 1e-4);
    CHECK(rig.frame(kFrame, {ended(400, 500)}).released);
}

TEST(a_flicked_list_coasts_to_a_stop_in_the_direction_it_was_thrown) {
    Rig rig;
    rig.frame(kFrame, {began(400, 700)});
    double y = 700;
    for (int i = 0; i < 6; ++i) {
        y -= 30;   // 1800 units a second, upward
        rig.frame(kFrame, {moved(400, y)});
    }
    rig.frame(kFrame, {ended(400, y - 30)});

    double coast = 0;
    double previous = 1e9;
    int frames = 0;
    bool slowing = true;
    for (; frames < 600; ++frames) {
        const Frame f = rig.frame(kFrame);
        if (!f.pan.active) break;
        CHECK(f.pan.dy <= 0.0);   // still upward
        slowing = slowing && std::fabs(f.pan.dy) <= previous + 1e-4;
        previous = std::fabs(f.pan.dy);
        coast += f.pan.dy;
    }
    CHECK(slowing);
    CHECK(coast < -200.0);   // it went somewhere
    CHECK(frames < 600);     // and it stopped
    CHECK(!rig.frame(kFrame).pan.active);
}

TEST(a_list_let_go_of_at_rest_does_not_coast) {
    Rig rig;
    rig.frame(kFrame, {began(400, 700)});
    rig.frame(kFrame, {moved(400, 600)});
    rig.frame(kFrame, {moved(400, 500)});
    rig.frame(0.25);   // the finger stops
    rig.frame(kFrame, {ended(400, 500)});
    CHECK(!rig.frame(kFrame).pan.active);
}

TEST(a_finger_landing_on_a_coasting_list_stops_it) {
    Rig rig;
    rig.frame(kFrame, {began(400, 700)});
    for (int i = 1; i <= 6; ++i) rig.frame(kFrame, {moved(400, 700 - 40.0 * i)});
    rig.frame(kFrame, {ended(400, 420)});
    CHECK(rig.frame(kFrame).pan.active);

    const TouchEvent catchIt{TouchPhase::Began, TouchPoint{2, 400, 400}};
    rig.frame(kFrame, {catchIt});
    const Frame after = rig.frame(kFrame);
    CHECK(after.pan.dy == 0.0f);
    // And the catching finger is a fresh decision, not a press.
    CHECK(!after.pressed);
    CHECK(!after.held);
}

TEST(a_text_field_on_a_list_is_pressed_at_once) {
    // The keyboard only comes up for a tap the page is left to finish, and the
    // field has to see its press on that same frame.
    Rig rig;
    Frame f;
    rig.now += kFrame;
    rig.apply(rig.gesture.beginFrame(rig.now), f);
    rig.apply(rig.gesture.began(TouchPoint{1, 400, 400}, rig.now, true), f);
    CHECK(f.pressed);
    CHECK(rig.held);
}

TEST(the_slop_is_measured_in_points_not_design_units) {
    // A phone's design space is ~2.4 units to the CSS pixel, and a finger's
    // wobble is the same size whatever the design space is.
    Rig rig;
    rig.gesture.setUnitsPerPoint(2.4);
    rig.frame(kFrame, {began(400, 400)});
    const Frame wobble = rig.frame(kFrame, {moved(400, 415)});   // 6.25 points
    CHECK(!wobble.pan.active);
    CHECK(!wobble.pressed);
    const Frame pan = rig.frame(kFrame, {moved(400, 425)});   // 10.4 points
    CHECK(pan.pan.active);
}

TEST(a_press_and_a_move_on_one_frame_press_where_the_finger_landed) {
    // A fast swipe that starts on a button: both events arrive between two
    // frames, and the press has to land on the button, not where the finger
    // had got to by then.
    Rig rig;
    const Frame f = rig.frame(kFrame, {began(50, 50), moved(90, 50)});
    CHECK(f.pressed);
    CHECK_NEAR(f.x, 50.0, 1e-4);
    CHECK_NEAR(rig.frame(kFrame).x, 90.0, 1e-4);
}

TEST(cancel_drops_a_held_finger_and_a_fling_without_an_edge) {
    Rig rig;
    rig.frame(kFrame, {began(400, 700)});
    for (int i = 1; i <= 6; ++i) rig.frame(kFrame, {moved(400, 700 - 40.0 * i)});
    rig.frame(kFrame, {ended(400, 420)});
    rig.gesture.cancel();
    const Frame f = rig.frame(kFrame);
    CHECK(!f.pan.active);
    CHECK(!f.pressed);

    rig.frame(kFrame, {began(400, 400)});
    rig.gesture.cancel();
    const Frame later = rig.frame(TouchScrollGesture::kHoldSeconds * 2);
    CHECK(!later.pressed);
    CHECK(!rig.gesture.scrolling());
}

TEST(a_pointer_left_behind_by_a_pan_is_not_pointing_at_anything) {
    // After a scroll the pointer rests over whatever the list slid under the
    // finger. Hover-only chrome (the gallery's card) has to stay down until
    // the next finger actually lands somewhere.
    Rig rig;
    rig.frame(kFrame, {began(400, 400)});
    rig.frame(kFrame, {moved(400, 460)});
    rig.frame(0.2);
    rig.frame(kFrame, {ended(400, 460)});
    CHECK(rig.gesture.scrolling());
    rig.frame(kFrame);
    CHECK(rig.gesture.scrolling());

    // A tap is pointing at something, list or not.
    rig.frame(kFrame, {began(400, 400)});
    rig.frame(kFrame, {ended(400, 400)});
    CHECK(!rig.gesture.scrolling());
}
