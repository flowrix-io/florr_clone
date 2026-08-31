#include "client/prediction.h"

namespace flr {

void Prediction::reset(Vec2 position) {
    state_.position = position;
    state_.velocity = {0, 0};
    pending_.clear();
    lastCorrection_ = 0;
}

Vec2 Prediction::apply(const net::InputFrame& input, double maxSpeed, double dt) {
    const Vec2 target = desiredVelocity(input.moveAngle, input.moveStrength, maxSpeed);
    integrateVelocity(state_, target, dt);
    state_.position += state_.velocity * dt;

    pending_.push_back({input, dt, maxSpeed});
    // Dropping the OLDEST is right: those are the inputs the server is most
    // likely to have already applied, and keeping the recent ones is what makes
    // the replay land near the truth.
    while (pending_.size() > kMaxPending) pending_.pop_front();

    return state_.position;
}

void Prediction::reconcile(Vec2 authoritativePosition, Vec2 authoritativeVelocity,
                           std::uint32_t acknowledgedSequence, double maxSpeed) {
    const Vec2 before = state_.position;

    while (!pending_.empty() && pending_.front().input.sequence <= acknowledgedSequence) {
        pending_.pop_front();
    }

    state_.position = authoritativePosition;
    state_.velocity = authoritativeVelocity;

    for (const Pending& p : pending_) {
        const Vec2 target = desiredVelocity(p.input.moveAngle, p.input.moveStrength,
                                            p.maxSpeed > 0 ? p.maxSpeed : maxSpeed);
        integrateVelocity(state_, target, p.dt);
        state_.position += state_.velocity * p.dt;
    }

    lastCorrection_ = distance(before, state_.position);
}

} // namespace flr
