#pragma once
// Local movement prediction for the player's own flower.
//
// The client moves immediately on input and the server confirms afterwards.
// Both run the SAME integrateVelocity() from shared/game/constants.h, so in
// open movement the prediction is not an approximation of the server -- it is
// bit-for-bit the same arithmetic, and reconciliation has nothing to correct.
//
// A correction is therefore always meaningful: it means the server saw
// something the client could not (a wall, a knockback, a slow), which is
// exactly when a visible adjustment is honest rather than noise.

#include <cstdint>
#include <deque>

#include "shared/game/constants.h"
#include "shared/net/protocol.h"

namespace flr {

class Prediction {
public:
    /// Discards history and adopts an authoritative position outright. Used on
    /// join, respawn and teleport, where there is no continuity to preserve.
    void reset(Vec2 position);

    /// Records an input the client has applied locally and is about to send.
    /// Returns the resulting predicted position.
    Vec2 apply(const net::InputFrame& input, double maxSpeed, double dt);

    /// Folds in the server's authoritative state.
    ///
    /// Everything up to `acknowledgedSequence` is dropped from the pending
    /// queue; the remaining inputs are replayed from the authoritative state to
    /// arrive back at "now". Without the replay the flower would visibly snap
    /// backwards by one round trip on every single snapshot.
    void reconcile(Vec2 authoritativePosition, Vec2 authoritativeVelocity,
                   std::uint32_t acknowledgedSequence, double maxSpeed);

    Vec2 position() const { return state_.position; }
    Vec2 velocity() const { return state_.velocity; }

    /// How far the last reconciliation moved the flower. Large values mean the
    /// client and server genuinely disagree -- worth surfacing in a debug HUD,
    /// because a persistent non-zero value is a physics divergence bug.
    double lastCorrection() const { return lastCorrection_; }

    std::size_t pendingCount() const { return pending_.size(); }

    /// Bound on unacknowledged inputs. At 25 Hz this is ~5 seconds; past that
    /// the connection is not really alive and replaying more only burns time.
    static constexpr std::size_t kMaxPending = 128;

private:
    struct Pending {
        net::InputFrame input;
        double dt;
        double maxSpeed;
    };

    MoveState state_;
    std::deque<Pending> pending_;
    double lastCorrection_ = 0;
};

} // namespace flr
