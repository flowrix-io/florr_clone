#pragma once
// The one law everything on the client that glides toward a target follows.
//
// An ease closes `1 - e^(-step / tau)` of the remaining gap per frame: a FIXED
// time constant `tau`, in seconds, rather than a fixed fraction per frame. Two
// frames of half the step land exactly where one whole one does, so a 30 fps
// client and a 144 fps one reach the target on the same wall clock.
//
// The step is not the frame's measured delta either. It is easeStepSeconds():
// the display's frame period, smoothed. Frames are presented at an even
// cadence, but the delta measured for each one is not even -- in the browser
// the timestamp is read whenever requestAnimationFrame got round to calling,
// a few ms either side of the vblank -- and a constant-rate ease fed that
// noise takes uneven steps across evenly spaced presents, which reads as a
// shimmer on anything moving. A frame that took two or more refreshes is not
// noise, though: the display really did hold the last picture that long, so it
// steps by that many whole periods. App::frame advances the period once a frame
// and every ease reads it.
//
// Do not ease anything with a bare `value += (target - value) * k`. That is a
// fraction per FRAME and tracks twice as fast at 120 Hz as at 60.

#include <algorithm>
#include <cmath>

#include "shared/core/types.h"

namespace flix {

/// The longest step an ease takes. A stalled frame -- a resize, a breakpoint,
/// a window the compositor stopped scheduling -- otherwise resolves to a
/// full-strength snap on the frame it resumes.
inline constexpr double kMaxEaseStepSeconds = 0.1;

/// The step assumed before any frame has been measured.
inline constexpr double kDefaultEaseStepSeconds = 1.0 / 60.0;

/// How much of each measured delta the smoothed frame period takes in. About
/// twenty frames to settle on a new refresh rate when a window moves between
/// monitors, while one frame's timing noise moves it by a twentieth.
inline constexpr double kFramePeriodSmoothing = 0.05;

/// How many frames in a row may each be several refreshes before that many
/// refreshes is taken to be the period.
inline constexpr int kRelearnFrames = 30;

/// The time constant of an ease that closes `fraction` of the gap per frame
/// at 60 fps. The browser build and gardn state every ease that way, and the
/// Interpolation slider still does; this is how they become fixed-time.
inline double easeTimeConstant(double fractionPerFrameAt60Hz) {
    const double k = clamp(fractionPerFrameAt60Hz, 0.001, 0.999);
    return -1.0 / (60.0 * std::log(1.0 - k));
}

/// A flower's pupils, and a flower-shaped mob's, following its facing: 0.15
/// of the way per 60 fps frame, as the browser build eases them.
inline const double kEyeEaseSeconds = easeTimeConstant(0.15);

/// The time constant of an ease written as a rate per millisecond, florr's
/// own form (`x -= (target - x) * expm1(-rate * dt)`).
inline constexpr double easeTimeConstantFromRatePerMs(double ratePerMs) {
    return 1.0 / (ratePerMs * 1000.0);
}

/// The smoothed frame period. One per process, like renderClockMillis(): every
/// ease on screen has to step by the same amount or they drift against each
/// other.
class FramePeriod {
public:
    /// Takes in one frame's measured delta and returns the time to step by: a
    /// whole number of refresh periods, nudged so that the steps add up to the
    /// time that really passed.
    ///
    /// Only the delta's share per refresh is averaged into the period, clipped
    /// to within half and twice of it: a hitch is dropped frames, not a new
    /// refresh rate, and must not drag every ease after it. Stepping a dropped
    /// frame by a single period instead draws everything moving at half speed
    /// for the length of it.
    double advance(double measuredSeconds) {
        const double measured = clamp(measuredSeconds, 0.0, kMaxEaseStepSeconds);
        if (!(seconds_ > 0.0)) {
            seconds_ = measured > 0.0 ? measured : kDefaultEaseStepSeconds;
        } else {
            const double refreshes = std::max(1.0, std::round(measured / seconds_));
            // Off the period as it stood, so the count and the step agree.
            const double whole = refreshes * seconds_;
            // What rounding to whole refreshes left over, paid back a little
            // a frame: without it the steps drift from the clock, and paid at
            // once it would be the timing noise again.
            drift_ = clamp(drift_ + measured - whole, -seconds_, seconds_);
            const double nudge = clamp(drift_ * kFramePeriodSmoothing, -seconds_ * 0.02,
                                       seconds_ * 0.02);
            drift_ -= nudge;
            step_ = std::min(whole + nudge, kMaxEaseStepSeconds);
            // Never once a single refresh for this long: the period itself is
            // wrong -- a first delta of nothing, a window moved from a 120 Hz
            // monitor to a 60 Hz one -- and the share below cannot say so,
            // being a fraction of every frame. Taken from the frames instead.
            manyTotal_ = refreshes > 1.0 ? manyTotal_ + measured : 0.0;
            manyFrames_ = refreshes > 1.0 ? manyFrames_ + 1 : 0;
            if (manyFrames_ >= kRelearnFrames) {
                seconds_ = manyTotal_ / manyFrames_;
                manyTotal_ = 0.0;
                manyFrames_ = 0;
                drift_ = 0.0;
                return step_;
            }
            const double share = clamp(measured / refreshes, seconds_ * 0.5, seconds_ * 2.0);
            seconds_ += (share - seconds_) * kFramePeriodSmoothing;
            return step_;
        }
        step_ = seconds_;
        return step_;
    }

    /// The smoothed time between two refreshes.
    double seconds() const { return seconds_ > 0.0 ? seconds_ : kDefaultEaseStepSeconds; }
    /// What the last advance() returned.
    double step() const { return step_ > 0.0 ? step_ : kDefaultEaseStepSeconds; }

private:
    double seconds_ = 0.0;
    double step_ = 0.0;
    double drift_ = 0.0;
    double manyTotal_ = 0.0;
    int manyFrames_ = 0;
};

inline FramePeriod& framePeriod() {
    static FramePeriod period;
    return period;
}

/// This frame's ease step. Advanced once per frame by App::frame.
inline double easeStepSeconds() { return framePeriod().step(); }

/// The fraction of the remaining gap an ease with time constant `tau` closes
/// over `stepSeconds`.
inline double easeFraction(double tauSeconds, double stepSeconds = easeStepSeconds()) {
    if (!(tauSeconds > 0.0)) return 1.0;
    const double step = clamp(stepSeconds, 0.0, kMaxEaseStepSeconds);
    return -std::expm1(-step / tauSeconds);
}

/// Eases `value` toward `target` by one step. Works on anything with `-`,
/// `+=` and scaling by a double: doubles, Vec2.
template <typename T>
inline void easeToward(T& value, const T& target, double tauSeconds,
                       double stepSeconds = easeStepSeconds()) {
    value += (target - value) * easeFraction(tauSeconds, stepSeconds);
}

} // namespace flix
