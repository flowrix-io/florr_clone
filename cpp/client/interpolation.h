#pragma once
// How the client turns the snapshot stream into display-rate motion.
//
// This is a port of the browser build's model (src/ecs/client/interpolation.ts),
// which is itself gardn's. The two rules that matter, and why:
//
//  * FLOWERS ARE NEVER PREDICTED. Every flower -- the viewer's included --
//    eases with one fixed time constant (client/ease.h) toward the position
//    the server had it at a moment ago, read off the line between two
//    snapshots (see FlowerChase). Petals, shots and drops ease the same way,
//    a ring's petals in their flower's frame. The client runs no movement simulation of its own, so
//    there is nothing to reconcile and nothing to snap back.
//
//    This client used to predict locally and reconcile on every snapshot, and
//    it is exactly the model the browser build removed. Two things make it
//    jitter badly here. The prediction integrated velocity with no terrain
//    collision at all, so walking into a wall meant predicting straight
//    through it and being yanked back on every snapshot. And the camera is
//    pinned to the flower, so a correction of any size does not nudge the
//    flower -- it jolts the whole world.
//
//    The cost is input latency of about half a round trip plus the ease time
//    constant. That is the trade the browser build made on purpose.
//
//  * MOBS ARE PLAYED BACK ON A DELAY, flowers are not. A mob carries a short
//    sample history and is rendered behind the render clock -- by the longest
//    gap the snapshot cadence produces plus the worst lateness the connection
//    has shown lately, see WorldView::noteLateness -- which absorbs jitter and
//    packet loss. Every snapshot adds a sample to every buffered mob, the ones
//    it did not mention included. Flowers are played back on the same delay,
//    the viewer's own as well, and then eased: the delay is taken OUT of the
//    ease, so on a good connection none is drawn later than it would be.
//
// Facing follows the same split. A flower's angle comes straight off the wire
// -- it drives the eyes, and easing it makes the pupils swim. A mob's angle is
// eased rather than interpolated from the history: passive AI turns up to 180
// degrees in one server step, and interpolating that whips the mob through the
// whole turn inside a single sample interval.

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>

#include "client/ease.h"
#include "shared/core/types.h"
#include "shared/net/protocol.h"

namespace flix {

/// The client's render clock, in milliseconds since an arbitrary fixed epoch.
///
/// There is exactly ONE of these on purpose. Snapshot arrivals are stamped
/// against it and mob playback is measured against it, and the two used to
/// come from different clocks -- arrivals from a steady_clock zeroed on the
/// first snapshot, playback from SDL's counter zeroed at window creation.
/// Nothing about that is visible in either expression; the difference is a
/// constant of however many seconds passed between the two, which pushed the
/// playback point permanently outside the sample window. Every mob then
/// rendered at a clamped endpoint, which is to say it held still and jumped.
///
/// NetClient times its redial backoff, the oracle and trader cooldowns and the
/// ping round trip on it too. Each of those is only ever compared with another
/// reading of this same clock, so its arbitrary epoch never shows.
inline double renderClockMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

/// Unix milliseconds: the wall clock, for the few readings that are compared
/// with a time minted somewhere else -- the daily-streak card counting down to
/// a timestamp the server set, a notification's "3 days ago", the time of day
/// a chat line arrived. Never for an interval: the wall clock can be stepped
/// under a running client, and the app's uptime cannot answer any of these.
inline std::int64_t wallClockMillis() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

/// The fraction of the remaining gap an ease closes per frame at 60 fps:
/// gardn's 0.25 (`Ui::lerp_amount`), by the user's rule that motion is as
/// smooth as gardn's. It was the browser build's 0.15. The settings panel's
/// slider is the same number. Only ever turned into a time
/// constant, by easeTimeConstant() (client/ease.h).
inline constexpr double kDefaultInterpolationAmount = 0.25;
/// What it was, for telling a settings file that never moved the slider.
inline constexpr double kOldDefaultInterpolationAmount = 0.15;

/// Beyond this gap an ease is a glide across the map rather than a smoothing.
/// Respawns, portals and a maze rotation all produce it.
inline constexpr double kTeleportSnapDistance = 600.0;

/// Below this the ease is invisible; settle exactly instead of asymptoting.
inline constexpr double kSettleEpsilon = 0.01;

/// The least a buffered mob is played back behind the render clock, and where
/// the delay starts before any snapshot has said how the connection behaves.
inline constexpr double kMobRenderDelayMillis = 50.0;

/// The most it is ever played back behind. Past this a mob is drawn so far
/// behind where it is being hit that the fight stops reading.
inline constexpr double kMaxMobRenderDelayMillis = 200.0;

/// The longest gap between two snapshots on a connection that is perfect.
///
/// Snapshots go out on a TICK, so a rate below the tick's is sent in uneven
/// gaps (20 Hz of a 30 Hz tick alternates 33 and 67 ms). The buffer has to
/// cover the long one before it covers any network lateness at all.
inline constexpr double kSnapshotGapMillis =
    ((net::kTicksPerSecond + net::kSnapshotsPerSecond - 1) / net::kSnapshotsPerSecond) *
    net::kTickMillis;

/// Slack kept above the longest gap plus the worst recent lateness.
inline constexpr double kPlaybackMarginMillis = 15.0;

/// Per snapshot, how much of the worst recent lateness is remembered: about a
/// three-second half-life. A connection that hiccupped once keeps the
/// deeper buffer for a while rather than starving on the next hiccup.
inline constexpr double kLatenessMemory = 0.993;

/// How fast the playback delay may move, in ms of delay per ms of frame time.
/// Changing the delay IS changing playback speed -- raising it 0.15 runs every
/// mob at 85% for as long as it rises -- so it grows briskly, because starving
/// is the visible failure, and shrinks slowly, because nothing is wrong yet.
inline constexpr double kDelayGrowRate = 0.15;
inline constexpr double kDelayShrinkRate = 0.03;

/// How a flower chases its sample history.
///
/// Easing straight at the newest position chases a staircase: the target
/// stands still for a whole snapshot gap and then jumps, so a flower walking
/// at a constant speed was drawn between 0.6 and 1.3 times it, on a 10 Hz beat
/// (the gaps alternate 33 and 67 ms) -- and the camera with it. Chasing a point
/// that glides along the line between snapshots has no beat at all.
///
/// Gliding costs a delay, and that delay comes out of the ease rather than on
/// top of it: `delay + tau` here is the plain ease's own time constant plus the
/// lag its snapshots' age added to that. Only a connection too uneven to leave
/// the ease anything is drawn later, which is what keeps it steady.
struct FlowerChase {
    double delayMillis = 0;
    double tauSeconds = 0;
};

/// What the age of the newest snapshot adds to a plain ease's lag: measured
/// against the real server, a little under half the gap.
inline constexpr double kSnapshotAgeLagMillis = 8.0;

/// The least of the slider's own ease that is always left, so that turning it
/// still does something once the delay has used the rest.
inline constexpr double kFlowerEaseFloorShare = 0.25;

/// The latest a flower is ever played back, short of kMaxMobRenderDelayMillis:
/// this one is felt in the controls.
inline constexpr double kMaxFlowerDelayMillis = 120.0;

/// `playbackDelayMillis` is the delay mobs are on this frame, so that flowers
/// and mobs are drawn from the same moment of the server's.
inline FlowerChase flowerChase(double easeTauSeconds, double playbackDelayMillis) {
    if (!(easeTauSeconds > 0.0)) return {};
    const double delay = std::min(playbackDelayMillis, kMaxFlowerDelayMillis);
    const double lag = easeTauSeconds * 1000.0 + kSnapshotAgeLagMillis;
    const double tau = std::max(easeTauSeconds * 1000.0 * kFlowerEaseFloorShare, lag - delay);
    return {delay, tau / 1000.0};
}

/// Samples kept per entity. At 30 Hz this is half a second of history -- more
/// than the playback delay needs, enough to ride out a burst of late packets.
inline constexpr int kMobSampleCapacity = 15;

} // namespace flix
