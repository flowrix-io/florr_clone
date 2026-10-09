#pragma once
// How the client turns a 20 Hz snapshot stream into display-rate motion.
//
// This is a port of the browser build's model (src/ecs/client/interpolation.ts),
// which is itself gardn's. The two rules that matter, and why:
//
//  * FLOWERS ARE NEVER PREDICTED. Every flower -- the viewer's included --
//    eases toward the authoritative position with one fixed time constant
//    (client/ease.h). The client runs no movement simulation of its own, so
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
//    constant. That is the trade the browser build makes on purpose.
//
//  * MOBS ARE PLAYED BACK ON A DELAY, flowers are not. A mob carries a short
//    sample history and is rendered behind the render clock -- by the longest
//    gap the snapshot cadence produces plus the worst lateness the connection
//    has shown lately, see WorldView::noteLateness -- which absorbs jitter and
//    packet loss. Every snapshot adds a sample to every buffered mob, the ones
//    it did not mention included. Flowers get no buffer,
//    because a buffered remote flower visibly lags the local one and the whole
//    point of the shared ease is that every flower moves alike.
//
// Facing follows the same split. A flower's angle comes straight off the wire
// -- it drives the eyes, and easing it makes the pupils swim. A mob's angle is
// eased rather than interpolated from the history: passive AI turns up to 180
// degrees in one server step, and interpolating that whips the mob through the
// whole turn inside a single sample interval.

#include <chrono>
#include <cmath>

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
inline double renderClockMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

/// The fraction of the remaining gap an ease closes per frame at 60 fps. The
/// browser build's default (`localStorage.interpolationAmount`), and the
/// settings panel's slider is the same number. Only ever turned into a time
/// constant, by easeTimeConstant() (client/ease.h).
inline constexpr double kDefaultInterpolationAmount = 0.15;

/// Beyond this gap an ease is a glide across the map rather than a smoothing.
/// Respawns, portals and a maze rotation all produce it.
inline constexpr double kTeleportSnapDistance = 600.0;

/// Below this the ease is invisible; settle exactly instead of asymptoting.
inline constexpr double kSettleEpsilon = 0.01;

/// The least a buffered mob is played back behind the render clock, and where
/// the delay starts before any snapshot has said how the connection behaves.
inline constexpr double kMobRenderDelayMillis = 80.0;

/// The most it is ever played back behind. Past this a mob is drawn so far
/// behind where it is being hit that the fight stops reading.
inline constexpr double kMaxMobRenderDelayMillis = 200.0;

/// The longest gap between two snapshots on a connection that is perfect.
///
/// Snapshots go out on the first TICK at or after each 20 Hz deadline, so the
/// gaps alternate one tick and two -- 33 and 67 ms, never 50. The buffer has
/// to cover the long one before it covers any network lateness at all, which
/// is why a flat 80 ms left a mob 13 ms of slack and extrapolating on any
/// connection that was not loopback.
inline constexpr double kSnapshotGapMillis =
    ((net::kTicksPerSecond + net::kSnapshotsPerSecond - 1) / net::kSnapshotsPerSecond) *
    net::kTickMillis;

/// Slack kept above the longest gap plus the worst recent lateness.
inline constexpr double kPlaybackMarginMillis = 15.0;

/// Per snapshot, how much of the worst recent lateness is remembered: about a
/// three-second half-life at 20 Hz. A connection that hiccupped once keeps the
/// deeper buffer for a while rather than starving on the next hiccup.
inline constexpr double kLatenessMemory = 0.99;

/// How fast the playback delay may move, in ms of delay per ms of frame time.
/// Changing the delay IS changing playback speed -- raising it 0.15 runs every
/// mob at 85% for as long as it rises -- so it grows briskly, because starving
/// is the visible failure, and shrinks slowly, because nothing is wrong yet.
inline constexpr double kDelayGrowRate = 0.15;
inline constexpr double kDelayShrinkRate = 0.03;

/// Samples kept per mob. At 20 Hz this is half a second of history -- more
/// than the playback delay needs, enough to ride out a burst of late packets.
inline constexpr int kMobSampleCapacity = 10;

} // namespace flix
