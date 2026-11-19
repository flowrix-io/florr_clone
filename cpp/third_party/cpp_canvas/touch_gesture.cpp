#include "touch_gesture.h"

#include <algorithm>
#include <cmath>

void TouchScrollGesture::setUnitsPerPoint(double unitsPerPoint) {
    unitsPerPoint_ = unitsPerPoint > 0 ? unitsPerPoint : 1.0;
}

bool TouchScrollGesture::onList(float x, float y) const {
    for (const WindowRect& region : regions_) {
        if (x >= region.x && x <= region.x + region.w && y >= region.y &&
            y <= region.y + region.h) {
            return true;
        }
    }
    return false;
}

void TouchScrollGesture::movePointer(Mouse& out, float x, float y) {
    if (pressedThisFrame_) {
        deferredMove_ = true;
        deferredX_ = x;
        deferredY_ = y;
        return;
    }
    out.moved = true;
    out.x = x;
    out.y = y;
}

void TouchScrollGesture::pressAtOrigin(Mouse& out) {
    out.moved = true;
    out.x = originX_;
    out.y = originY_;
    out.press = true;
    pressedThisFrame_ = true;
    // The pointer has to be at the landing point for the press to hit what
    // the finger aimed at. Wherever the finger has got to since reaches the
    // pointer on the next frame, which is the first one a drag can use it on.
    deferredMove_ = lastX_ != originX_ || lastY_ != originY_;
    deferredX_ = lastX_;
    deferredY_ = lastY_;
}

TouchScrollGesture::Mouse TouchScrollGesture::beginFrame(double now) {
    Mouse out;
    pressedThisFrame_ = false;
    pan_.dx = 0;
    pan_.dy = 0;
    pan_.active = state_ == State::Panning;

    if (deferredMove_) {
        deferredMove_ = false;
        out.moved = true;
        out.x = deferredX_;
        out.y = deferredY_;
    }

    const double dt = framed_ ? std::max(0.0, now - lastFrameAt_) : 0.0;
    lastFrameAt_ = now;
    framed_ = true;

    if (flinging_ && dt > 0) {
        // The exact distance an exponentially slowing list covers over the
        // frame, rather than speed x dt, so a slow frame and two quick ones
        // carry it the same way.
        const double rate = -std::log(kFlingDecayPerSecond);
        const double keep = std::exp(-rate * dt);
        pan_.dx += static_cast<float>(velocityX_ * (1.0 - keep) / rate);
        pan_.dy += static_cast<float>(velocityY_ * (1.0 - keep) / rate);
        pan_.active = true;
        velocityX_ *= keep;
        velocityY_ *= keep;
        if (std::hypot(velocityX_, velocityY_) < kFlingStopPointsPerSecond * unitsPerPoint_) {
            flinging_ = false;
        }
    }

    if (state_ == State::Held && now - landedAt_ >= kHoldSeconds) {
        state_ = State::Pressed;
        pressAtOrigin(out);
    }
    return out;
}

TouchScrollGesture::Mouse TouchScrollGesture::began(const TouchPoint& point, double now,
                                                    bool pressNow) {
    Mouse out;
    // A finger on the glass stops a list that is still coasting, as it does
    // on a phone. What that finger then does is decided afresh.
    flinging_ = false;
    velocityX_ = velocityY_ = 0;
    samples_.clear();
    pannedLast_ = false;

    landedAt_ = now;
    originX_ = lastX_ = point.x;
    originY_ = lastY_ = point.y;
    pan_.originX = point.x;
    pan_.originY = point.y;
    if (!pressNow && onList(point.x, point.y)) {
        // The pointer goes where the finger is, with nothing pressed, so a
        // press committed on a later frame finds hover state that is already
        // about this spot rather than the last one.
        state_ = State::Held;
        movePointer(out, point.x, point.y);
    } else {
        state_ = State::Pressed;
        pressAtOrigin(out);
    }
    return out;
}

TouchScrollGesture::Mouse TouchScrollGesture::moved(const TouchPoint& point, double now) {
    Mouse out;
    const float stepX = point.x - lastX_;
    const float stepY = point.y - lastY_;
    lastX_ = point.x;
    lastY_ = point.y;

    switch (state_) {
        case State::Held: {
            const double slop = kSlopPoints * unitsPerPoint_;
            const double fromX = point.x - originX_;
            const double fromY = point.y - originY_;
            if (fromX * fromX + fromY * fromY <= slop * slop) {
                movePointer(out, point.x, point.y);
                break;
            }
            if (std::fabs(fromY) >= std::fabs(fromX)) {
                // Measured from the landing point rather than from where the
                // slop was crossed: the list stays glued to the spot the
                // finger grabbed instead of lagging it by the slop.
                state_ = State::Panning;
                pan_.active = true;
                pan_.dx += static_cast<float>(fromX);
                pan_.dy += static_cast<float>(fromY);
                samples_.push_back({landedAt_, originX_, originY_});
                samples_.push_back({now, point.x, point.y});
                movePointer(out, point.x, point.y);
            } else {
                state_ = State::Pressed;
                pressAtOrigin(out);
            }
            break;
        }
        case State::Panning: {
            pan_.active = true;
            pan_.dx += stepX;
            pan_.dy += stepY;
            samples_.push_back({now, point.x, point.y});
            // Bounded: only the tail is ever read, and a long drag would
            // otherwise keep every frame of itself.
            const double keepFrom = now - 2.0 * kVelocityWindowSeconds;
            samples_.erase(samples_.begin(),
                           std::find_if(samples_.begin(), samples_.end(),
                                        [&](const Sample& s) { return s.time >= keepFrom; }));
            movePointer(out, point.x, point.y);
            break;
        }
        case State::Pressed:
            movePointer(out, point.x, point.y);
            break;
        case State::Idle:
            break;
    }
    return out;
}

TouchScrollGesture::Mouse TouchScrollGesture::ended(const TouchPoint& point, double now) {
    Mouse out;
    const float stepX = point.x - lastX_;
    const float stepY = point.y - lastY_;
    lastX_ = point.x;
    lastY_ = point.y;

    switch (state_) {
        case State::Held:
            // A tap: pressed and released on this one frame, where it landed.
            // The pointer stays there afterwards, as a mouse left where it
            // clicked would -- the finger's last few units of wobble inside
            // the slop are not a move anyone made.
            pressAtOrigin(out);
            deferredMove_ = false;
            out.release = true;
            break;
        case State::Panning:
            pan_.active = true;
            pan_.dx += stepX;
            pan_.dy += stepY;
            movePointer(out, point.x, point.y);
            startFling(now, point);
            pannedLast_ = true;
            break;
        case State::Pressed:
            // The release lands where the finger left, not where it landed: a
            // UI that dispatches its click on mouseup tests that position.
            // Unless the press was on this same frame -- then there is one
            // position for both, and it is the one the press was aimed at.
            movePointer(out, point.x, point.y);
            out.release = true;
            break;
        case State::Idle:
            break;
    }
    state_ = State::Idle;
    return out;
}

void TouchScrollGesture::startFling(double now, const TouchPoint& lift) {
    samples_.push_back({now, lift.x, lift.y});
    flinging_ = false;
    velocityX_ = velocityY_ = 0;

    // The oldest point of the drag's last kVelocityWindowSeconds. A finger
    // that stopped before it lifted has nothing in that window but the lift
    // itself, and a list let go of at rest stays at rest.
    const double from = now - kVelocityWindowSeconds;
    const auto reference = std::find_if(samples_.begin(), samples_.end(),
                                        [&](const Sample& s) { return s.time >= from; });
    if (reference == samples_.end()) return;
    const double span = now - reference->time;
    if (span <= 1e-4) return;

    double vx = (lift.x - reference->x) / span;
    double vy = (lift.y - reference->y) / span;
    const double speed = std::hypot(vx, vy);
    if (speed < kFlingStartPointsPerSecond * unitsPerPoint_) return;
    const double cap = kFlingMaxPointsPerSecond * unitsPerPoint_;
    if (speed > cap) {
        vx *= cap / speed;
        vy *= cap / speed;
    }
    velocityX_ = vx;
    velocityY_ = vy;
    flinging_ = true;
}

void TouchScrollGesture::cancel() {
    state_ = State::Idle;
    pannedLast_ = false;
    flinging_ = false;
    velocityX_ = velocityY_ = 0;
    deferredMove_ = false;
    pressedThisFrame_ = false;
    samples_.clear();
    pan_ = TouchPan{};
}
