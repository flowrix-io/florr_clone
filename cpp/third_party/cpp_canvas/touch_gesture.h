#pragma once

// What the mirrored finger means when it lands on a list that scrolls.
//
// Window turns the first finger down into the left mouse button (see the touch
// section of window.h), and every control written against a mouse then works
// by tap -- except scrolling. A list in this client scrolls on the wheel, and
// a finger has no wheel. A finger dragged across a list is a mouse dragged
// across it, which presses whatever it landed on first, because the controls
// here act on the press.
//
// So a finger that lands inside a region the caller published as scrollable
// is not pressed at once. Its press is HELD until the finger says what it is,
// which is how a phone's own scroll views behave:
//
//   moves past the slop, mostly vertically   a pan. The list follows the
//                                            finger and nothing is pressed.
//   moves past the slop, mostly sideways     a drag. The press lands where
//                                            the finger landed and the drag
//                                            follows it, so a petal pulled
//                                            out sideways and a slider still
//                                            work.
//   stays put for kHoldSeconds               a press, for the same reason:
//                                            long-press is how a phone picks
//                                            something up out of a list.
//   lifts before any of those                a tap: press and release on one
//                                            frame, where it landed.
//
// A pan that ends on a moving finger coasts on as a fling, decaying.
//
// A finger anywhere else is pressed the moment it lands, exactly as before.
//
// Pure: times and positions come in, mouse edges and pan distances go out, so
// the rules can be driven frame by frame from a test with no window at all.

#include <cstdint>
#include <vector>

#include "window.h"

class TouchScrollGesture {
public:
    /// Slop and speeds are in POINTS -- CSS pixels in a page -- because they
    /// are about a finger, and a finger is the same size whatever the design
    /// space is scaled to. Converted with setUnitsPerPoint().
    static constexpr double kSlopPoints = 8.0;
    static constexpr double kHoldSeconds = 0.3;
    /// Slower than this at the lift and the list stops where it was left.
    static constexpr double kFlingStartPointsPerSecond = 80.0;
    static constexpr double kFlingStopPointsPerSecond = 20.0;
    static constexpr double kFlingMaxPointsPerSecond = 6000.0;
    /// A fling's speed falls by this factor every second: 0.998 a
    /// millisecond, which is a phone's ordinary scroll deceleration.
    static constexpr double kFlingDecayPerSecond = 0.135;
    /// The lift speed is measured over this much of the drag's tail, so one
    /// jittery frame neither throws a list nor stops one.
    static constexpr double kVelocityWindowSeconds = 0.1;

    /// What one call does to the mirrored left button. Applied in order: the
    /// move, then the press, then the release -- so a tap is a press and a
    /// release together on one frame, which every control here already
    /// handles, because a quick click in a browser arrives the same way.
    struct Mouse {
        bool moved = false;
        float x = 0;
        float y = 0;
        bool press = false;
        bool release = false;
    };

    /// Where the lists are, in design units, as the last frame painted them.
    void setRegions(std::vector<WindowRect> regions) { regions_ = std::move(regions); }

    /// Design units per point: the inverse of the window's fit.
    void setUnitsPerPoint(double unitsPerPoint);

    /// The top of a frame, before its contacts: clears the frame's pan,
    /// advances a fling, commits a press that has been held long enough, and
    /// lands a pointer move that an earlier press on the last frame deferred.
    Mouse beginFrame(double now);

    /// The mirrored contact landed. `pressNow` forces the old behaviour
    /// whatever it landed on -- a text field, whose tap has to reach the page
    /// as a press on this frame for the keyboard to come up.
    Mouse began(const TouchPoint& point, double now, bool pressNow);
    Mouse moved(const TouchPoint& point, double now);
    Mouse ended(const TouchPoint& point, double now);

    /// Drops the contact and any fling without producing an edge: the page
    /// lost focus, and whatever the finger was doing happened somewhere else.
    void cancel();

    /// This frame's pan. Active while a list is being dragged or coasting.
    const TouchPan& pan() const { return pan_; }

    /// Whether the pointer is where it is because of a list drag rather than
    /// because it is pointing at something: from the moment a finger lands on
    /// a list until it presses, and after a pan until the next finger lands.
    bool scrolling() const {
        return state_ == State::Held || state_ == State::Panning || pannedLast_;
    }

private:
    enum class State : std::uint8_t { Idle, Pressed, Held, Panning };

    struct Sample {
        double time;
        float x;
        float y;
    };

    bool onList(float x, float y) const;
    /// The pointer lands at (x, y), unless a press already landed this frame
    /// -- a press lands where the finger landed, and the finger's later moves
    /// on the same frame wait for the next one.
    void movePointer(Mouse& out, float x, float y);
    void pressAtOrigin(Mouse& out);
    void startFling(double now, const TouchPoint& lift);

    std::vector<WindowRect> regions_;
    double unitsPerPoint_ = 1.0;

    State state_ = State::Idle;
    /// The last finger was a pan. Its pointer rests where it lifted, over
    /// whatever the list slid under it, which nobody pointed at.
    bool pannedLast_ = false;
    double landedAt_ = 0;
    float originX_ = 0;
    float originY_ = 0;
    /// Where the finger last was, for the pan's per-frame distance.
    float lastX_ = 0;
    float lastY_ = 0;
    std::vector<Sample> samples_;

    bool pressedThisFrame_ = false;
    bool deferredMove_ = false;
    float deferredX_ = 0;
    float deferredY_ = 0;

    bool flinging_ = false;
    double velocityX_ = 0;
    double velocityY_ = 0;
    double lastFrameAt_ = 0;
    bool framed_ = false;

    TouchPan pan_;
};
