#include "server/systems/movement.h"

#include <cmath>

#include "shared/game/constants.h"

namespace flr {
namespace {

/// A correction from resolveCircle smaller than this is floating-point noise
/// from the push-out arithmetic, not contact with a wall.
constexpr double kContactEpsilon = 1e-6;

/// Below this a step is not worth dividing by: a dt of zero (a paused server,
/// a test stepping with 0) must not turn into a division.
constexpr double kMinStepSeconds = 1e-9;

/// Below this an environmental scale is a full stop, and dividing a
/// displacement back out through it would manufacture speed.
constexpr double kMinEnvScale = 1e-4;

/// A projectile below this speed has no meaningful heading, so it neither
/// homes nor updates its facing.
constexpr double kMinProjectileSpeed = 1e-3;

Vec2 sanitizePosition(Vec2 p) {
    // A body that arrived here non-finite has already lost its place in the
    // world; putting it at the centre is recoverable, propagating NaN is not.
    if (!std::isfinite(p.x) || !std::isfinite(p.y)) return {kWorldHalf, kWorldHalf};
    return p;
}

/// Clamps an affliction multiplier into range. NaN and negatives read as zero
/// rather than as "unchanged": a corrupt debuff should stop a body, never
/// launch it, and a slow factor of zero is a legitimate full stall.
double sanitizeSlowFactor(double factor) {
    if (!(factor > 0.0)) return 0.0;
    return factor < 1.0 ? factor : 1.0;
}

/// Ceiling on a speed modifier, so one bad petal stat cannot make a player
/// uncatchable -- or outrun the substep budget.
constexpr double kMaxSpeedScale = 8.0;

/// A speed modifier that is missing, zero or corrupt means UNMODIFIED, not
/// rooted. Nothing in the game roots a player, and a PlayerModifiers that no
/// phase has recomputed yet reads as all zeroes -- which must not come out as
/// a flower frozen on its first tick.
double sanitizeSpeedScale(double scale) {
    if (!(scale > 0.0)) return 1.0;
    return scale < kMaxSpeedScale ? scale : kMaxSpeedScale;
}

double substepLength(double sanitizedRadius) {
    // Written against kMinSubstepLength rather than 0 so a NaN radius (which
    // fails every comparison) lands on the floor and not on the cap.
    if (!(sanitizedRadius > kMinSubstepLength)) return kMinSubstepLength;
    return sanitizedRadius < kMaxSubstepLength ? sanitizedRadius : kMaxSubstepLength;
}

Vec2 clampToWorld(Vec2 p, double sanitizedRadius) {
    return {clamp(p.x, sanitizedRadius, kWorldSize - sanitizedRadius),
            clamp(p.y, sanitizedRadius, kWorldSize - sanitizedRadius)};
}

/// Drains the pending positional offset written by combat.
///
/// TypeScript's mob knockback is not velocity: it is `x += knockbackX`, then
/// `y += knockbackY` on the next movement step. Clearing it here makes the
/// effect one-shot and lets the normal movement velocity continue unchanged.
Vec2 takeKnockback(World& world, Entity e) {
    Knockback* kb = world.tryGet<Knockback>(e);
    if (!kb) return {0, 0};
    const Vec2 impulse = kb->impulse;
    kb->impulse = {0, 0};
    if (!std::isfinite(impulse.x) || !std::isfinite(impulse.y)) return {0, 0};
    return impulse;
}

void applyPendingKnockback(World& world, Entity e, Transform& transform) {
    const Vec2 displacement = takeKnockback(world, e);
    if (!std::isfinite(displacement.x) || !std::isfinite(displacement.y)) return;
    transform.position += displacement;
}

/// The velocity to store after a step.
///
/// On contact, velocity is rebuilt from what the body actually achieved. That
/// is sliding, for free: the component into the wall is gone because the body
/// did not move that way, and the component along it survives because it did.
/// The length is capped at what was attempted so that being EJECTED from a
/// wall -- a body spawned inside geometry -- cannot be read as speed.
Vec2 velocityAfterStep(Vec2 attempted, const StepOutcome& out, double dt, double envScale) {
    Vec2 result = attempted;
    if (out.blocked && dt > kMinStepSeconds) {
        result = (out.displacement / dt).clampedLength(attempted.length());
    }
    if (envScale <= kMinEnvScale) return {0, 0};
    return sanitizeMovementVelocity(result / envScale);
}

} // namespace

// ---------------------------------------------------------------------------
// Sanitisers and the step
// ---------------------------------------------------------------------------

double sanitizeCollisionRadius(double radius) {
    if (!(radius > 0.0)) return 0.0;                 // negative, zero, or NaN
    return radius < kMaxCollisionRadius ? radius : kMaxCollisionRadius;
}

Vec2 sanitizeMovementVelocity(Vec2 velocity) {
    if (!std::isfinite(velocity.x) || !std::isfinite(velocity.y)) return {0, 0};
    return velocity.clampedLength(kMaxMovementSpeed);
}

StepOutcome stepCollide(const Terrain& terrain, Vec2& position, Vec2 velocity,
                        double radius, double dt, bool collideTerrain) {
    StepOutcome out;
    const double r = sanitizeCollisionRadius(radius);
    const double hull = r > kMinCollisionRadius ? r : kMinCollisionRadius;
    const Vec2 start = sanitizePosition(position);
    position = start;

    Vec2 delta = sanitizeMovementVelocity(velocity) * (dt > 0.0 ? dt : 0.0);
    double distance = delta.length();

    const double stepLength = substepLength(hull);
    const double reach = stepLength * kMaxSubstepCount;
    if (distance > reach) {
        // Truncate the tick's travel instead of lengthening the substeps. A
        // body that only crawls this tick is a visible glitch; a body that
        // teleported through a wall is a lost server.
        delta *= reach / distance;
        distance = reach;
    }

    int steps = 1;
    if (distance > stepLength) {
        steps = static_cast<int>(std::ceil(distance / stepLength));
        if (steps > kMaxSubstepCount) steps = kMaxSubstepCount;   // ceil() rounding
    }

    const Vec2 stepDelta = delta / static_cast<double>(steps);
    for (int i = 0; i < steps; ++i) {
        const Vec2 want = position + stepDelta;
        Vec2 got = collideTerrain ? terrain.resolveCircle(want, hull) : want;
        got = clampToWorld(got, hull);
        if (distanceSq(got, want) > kContactEpsilon * kContactEpsilon) out.blocked = true;
        position = got;
    }

    out.displacement = position - start;
    return out;
}

// ---------------------------------------------------------------------------
// MovementSystem
// ---------------------------------------------------------------------------

MovementSystem::Queries::Queries(World& world)
    : players(world), mobs(world), projectiles(world),
      playerTargets(world), mobTargets(world) {
    // A body marked Dead is still in the world so later systems can see it die,
    // but a corpse must not keep walking.
    players.without<Dead>();
    mobs.without<Dead>();
    projectiles.without<Dead>();
    playerTargets.without<Dead>();
    mobTargets.without<Dead>();
}

void MovementSystem::bind(World& world) {
    if (boundWorld_ == &world && queries_) return;
    boundWorld_ = &world;
    queries_.emplace(world);
}

void MovementSystem::run(World& world, const Terrain& terrain, double nowMillis, double dt) {
    bind(world);
    seekTargetsReady_ = false;
    movePlayers(world, terrain, nowMillis, dt);
    moveMobs(world, terrain, nowMillis, dt);
    // Projectiles last: they home on where players and mobs ended up this
    // tick, so a shot never chases a position that is already stale.
    moveProjectiles(world, terrain, dt);
}

void MovementSystem::movePlayers(World& world, const Terrain& terrain,
                                 double nowMillis, double dt) {
    queries_->players.each([&](Entity e, PlayerTag&, Transform& transform, Motion& motion,
                               Body& body, PlayerInput& input) {
        // The cursor is one value with two readers -- movement and petal aim --
        // so it is derived once, here, before anything downstream looks at it.
        input.aimDirection = Vec2::fromAngle(input.current.aimAngle);
        transform.angle = input.current.aimAngle;

        // Every scale folds into the TARGET speed, never into the velocity
        // that came out of the last tick. That is what the client does, and a
        // player who walks into water must ease down to the slower speed
        // rather than have it applied retroactively to momentum they had.
        double maxSpeed = kPlayerMaxSpeed;
        if (const PlayerModifiers* mods = world.tryGet<PlayerModifiers>(e)) {
            maxSpeed *= sanitizeSpeedScale(mods->speedScale);
        }
        if (const Afflictions* afflictions = world.tryGet<Afflictions>(e)) {
            if (afflictions->slowed(nowMillis)) {
                maxSpeed *= sanitizeSlowFactor(afflictions->slowFactor);
            }
        }
        if (terrain.inWater(transform.position)) maxSpeed *= kWaterSpeedScale;

        MoveState state{transform.position, motion.velocity};
        integrateVelocity(state, desiredVelocity(input.current.moveAngle,
                                                 input.current.moveStrength, maxSpeed), dt);

        applyPendingKnockback(world, e, transform);
        const Vec2 velocity = sanitizeMovementVelocity(state.velocity);
        const StepOutcome out = stepCollide(terrain, transform.position, velocity, body.radius, dt);
        motion.velocity = velocityAfterStep(velocity, out, dt, 1.0);
    });
}

void MovementSystem::moveMobs(World& world, const Terrain& terrain,
                              double nowMillis, double dt) {
    queries_->mobs.each([&](Entity e, MobTag&, Transform& transform, Motion& motion, Body& body) {
        applyPendingKnockback(world, e, transform);
        const Vec2 velocity = sanitizeMovementVelocity(motion.velocity);

        // Unlike a player's, a mob's slow and water penalty scale the DISPLACEMENT
        // and are not written back into Motion. The AI publishes the velocity it
        // wants in world terms; if the penalty were folded into the stored value
        // it would compound every tick the AI left the velocity alone, and a mob
        // that paused in a river would never get out of it.
        double envScale = 1.0;
        if (terrain.inWater(transform.position)) envScale *= kMobWaterSpeedScale;
        if (const Afflictions* afflictions = world.tryGet<Afflictions>(e)) {
            if (afflictions->slowed(nowMillis)) {
                envScale *= sanitizeSlowFactor(afflictions->slowFactor);
            }
        }

        const Vec2 attempted = velocity * envScale;
        const StepOutcome out = stepCollide(terrain, transform.position, attempted, body.radius, dt);

        // No friction is applied here. The AI phase runs the shared
        // integrateVelocity() against its desired heading and so owns a mob's
        // acceleration and coast-down. A TypeScript knockback is positional,
        // so it does not alter this stored velocity at all.
        motion.velocity = velocityAfterStep(attempted, out, dt, envScale);
    });
}

void MovementSystem::moveProjectiles(World& world, const Terrain& terrain, double dt) {
    queries_->projectiles.each([&](Entity e, ProjectileTag&, Transform& transform,
                                   Motion& motion, Projectile& projectile) {
        if (!(projectile.remainingDistance > 0.0)) {
            // Spent, and waiting on the lifecycle phase to reap it. Parking it
            // matters: an expired shot that keeps flying keeps hitting things.
            motion.velocity = {0, 0};
            return;
        }

        Vec2 velocity = sanitizeMovementVelocity(motion.velocity);
        const double speed = velocity.length();

        if (projectile.seekRange > 0.0 && speed > kMinProjectileSpeed) {
            if (!seekTargetsReady_) collectSeekTargets();
            Team team = Team::Players;
            if (const Faction* faction = world.tryGet<Faction>(e)) team = faction->team;
            else if (const Faction* owner = world.tryGet<Faction>(projectile.owner)) team = owner->team;

            const double heading = velocity.angle();
            const Entity target = findSeekTarget(e, projectile, team, transform.position, heading);
            if (target != NULL_ENTITY) {
                const Transform* targetTransform = world.tryGet<Transform>(target);
                const double bearing = targetTransform
                    ? (targetTransform->position - transform.position).angle() : heading;
                // Rate-limited, so the shot arcs onto the bearing. Snapping to
                // it would make a homing petal unmissable and unreadable.
                const double turn = clamp(angleDelta(heading, bearing),
                                          -kProjectileTurnRate * dt, kProjectileTurnRate * dt);
                velocity = Vec2::fromAngle(heading + turn, speed);
            }
        }

        // Range is a distance budget, not a timer: the last tick is shortened
        // so a fast shot dies exactly at its stated reach rather than one whole
        // tick past it.
        Vec2 attempted = velocity;
        const double travel = speed * dt;
        if (travel > projectile.remainingDistance && travel > kMinStepSeconds) {
            attempted = velocity * (projectile.remainingDistance / travel);
        }

        double radius = 0.0;
        if (const Body* body = world.tryGet<Body>(e)) radius = body->radius;

        const StepOutcome out = stepCollide(terrain, transform.position, attempted, radius, dt);
        projectile.remainingDistance -= out.displacement.length();
        if (!(projectile.remainingDistance > 0.0)) projectile.remainingDistance = 0.0;

        if (out.blocked) {
            // Terrain and the map edge eat shots. Spending the range here is
            // what tells the lifecycle phase to reap it, without this system
            // needing a command buffer of its own.
            projectile.remainingDistance = 0.0;
            motion.velocity = {0, 0};
            return;
        }

        motion.velocity = velocity;
        if (speed > kMinProjectileSpeed) transform.angle = velocity.angle();
    });
}

void MovementSystem::collectSeekTargets() {
    seekTargets_.clear();
    seekTargetsReady_ = true;

    const auto gather = [this](Entity e, Transform& transform, Faction& faction, Health& health) {
        if (!health.alive()) return;
        seekTargets_.push_back({e, transform.position, faction.team});
    };
    queries_->playerTargets.each([&](Entity e, PlayerTag&, Transform& t, Faction& f, Health& h) {
        gather(e, t, f, h);
    });
    queries_->mobTargets.each([&](Entity e, MobTag&, Transform& t, Faction& f, Health& h) {
        gather(e, t, f, h);
    });
}

Entity MovementSystem::findSeekTarget(Entity self, const Projectile& projectile, Team team,
                                      Vec2 position, double heading) const {
    // A config that sets a range but no cone means "home on anything in
    // range": seekRange is the switch, the cone is an optional narrowing, and
    // a zero cone read literally would produce a missile that can only lock
    // onto something already exactly ahead of it.
    const double cone = projectile.seekCone > 0.0 ? projectile.seekCone : kPi;
    double bestDistanceSq = projectile.seekRange * projectile.seekRange;
    Entity best = NULL_ENTITY;

    for (const SeekTarget& candidate : seekTargets_) {
        if (candidate.entity == self || candidate.entity == projectile.owner) continue;
        if (candidate.entity == projectile.creditTo) continue;
        if (candidate.team == team || candidate.team == Team::Neutral) continue;

        const Vec2 toTarget = candidate.position - position;
        const double distanceSquared = toTarget.lengthSq();
        // A target sitting exactly on the projectile has no bearing to turn to.
        if (distanceSquared > bestDistanceSq || distanceSquared < 1e-12) continue;
        if (std::fabs(angleDelta(heading, toTarget.angle())) > cone) continue;

        bestDistanceSq = distanceSquared;
        best = candidate.entity;
    }
    return best;
}

} // namespace flr
