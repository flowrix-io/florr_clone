#include "server/systems/movement.h"

#include <algorithm>
#include <cmath>

#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/map_elements.h"

namespace flix {
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

/// A coasting moon slower than this, in units a second, has stopped.
constexpr double kMinCoastSpeed = 1e-3;

/// Range left on a projectile below this is rounding noise, not reach, and the
/// shot is spent. The last step of a flight is clamped to exactly the budget,
/// but `velocity * fraction * dt` and the displacement it produces round
/// differently, and the difference (~1e-13) is smaller than one ulp of a
/// coordinate near 5000. Asked to fly that residual, the shot moves by exactly
/// zero, spends nothing, and lives forever. A millionth of a unit is far below
/// anything drawable and far above any residual the arithmetic can leave.
constexpr double kSpentRangeEpsilon = 1e-6;

Vec2 sanitizePosition(const Terrain& terrain, Vec2 p, Realm realm) {
    // A body that arrived here non-finite has already lost its place in the
    // world; putting it at the centre of its realm is recoverable, propagating
    // NaN is not.
    if (!std::isfinite(p.x) || !std::isfinite(p.y)) {
        const Vec2 extent = terrain.realmExtent(realm);
        return {extent.x * 0.5, extent.y * 0.5};
    }
    return p;
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

/// True when the straight path between two body CENTRES touches solid.
///
/// The push-out picks a face per shape and is free to choose the far one, so a
/// centre pressed into a diagonal seam can be ejected into the open quadrant on
/// the other side of the wall. Accepting that is a teleport through solid, which
/// is why the caller refuses any ejection this reports.
///
/// Terrain's own test, against the AUTHORED SHAPES of `realm`. It used to walk
/// the grid here and test whole cell rectangles, which was the same
/// question while a cell was all wall or all air -- and is a different, much
/// stricter one now that a cell blocks only the triangle under its diagonal: a
/// body standing legitimately inside the open half of a wall cell had every
/// push-out refused, so it stopped a body-width short of an authored slope and
/// could not slide along one at all. There is one answer to "did this path cross
/// the wall" and it lives in Terrain.
bool centerPathCrossesWall(const Terrain& terrain, Vec2 a, Vec2 b, Realm realm) {
    // Terrain::kCenterPathInflation is the margin: every blocking shape is
    // grown by half a unit first, so a path that grazes the shared corner of a
    // diagonal seam -- which it can do by a fraction of a pixel -- still counts
    // as crossing it. Its default, rather than a second copy of the number.
    return terrain.segmentTouchesBlockingTile(a, b, Terrain::kCenterPathInflation, realm);
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

/// Whether a knockback leaves this mob where it stands.
///
/// gardn weighs a stationary mob at ten thousand times its mass, which at any
/// shove a petal deals is "never". Here that is the mobs that cannot walk: a
/// nest, a rock, a cactus, the target dummy. Nothing would ever walk one of
/// them back, so a ring that nudged a nest would leave it wherever the fight
/// ended, and in time inside a wall.
bool anchoredAgainstKnockback(World& world, const ContentRegistry& registry, Entity e) {
    if (const MobAi* ai = world.tryGet<MobAi>(e); ai != nullptr && ai->kind == AiKind::Stationary) {
        return true;
    }
    const MobType* type = world.tryGet<MobType>(e);
    if (type == nullptr || type->configIndex >= registry.mobCount()) return false;
    // Zero, not "not positive": a moth's speed is written negative and it
    // flies.
    return registry.mob(type->configIndex).speed == 0.0;
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

/// One tick of SOFT contact between a loose petal and something pressed into
/// it: `push` of the overlap is taken back this tick (loosePetalContactPush),
/// the slab giving way by `slabShare` of it and the other body the rest.
///
/// `out` runs from the slab to the other body. The slab moves first and is
/// STEPPED, so a wall stops it, and whatever of its share the wall refused is
/// handed to the other body -- a slab pinned against a wall pushes back with
/// everything it has. The other body is stepped too, at `otherWallRadius`
/// (a mob's point hull, a flower's own radius), unless it does not move at
/// all -- an NPC, a mob that cannot walk -- in which case the slab takes it
/// all by being given a share of 1.
void softLooseContact(const Terrain& terrain, Realm realm, Vec2& slab, double slabRadius,
                      double slabShare, Vec2& other, double otherWallRadius, bool otherMoves,
                      Vec2 out, double push) {
    if (!(push > 0.0)) return;
    const Vec2 before = slab;
    stepCollide(terrain, realm, slab, out * (-push * slabShare), slabRadius, 1.0, true, true);
    if (!otherMoves) return;
    const Vec2 moved = before - slab;
    const double taken = std::max(0.0, moved.x * out.x + moved.y * out.y);
    const double rest = push - taken;
    if (rest > 0.0) {
        stepCollide(terrain, realm, other, out * rest, otherWallRadius, 1.0, true, true);
    }
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

StepOutcome stepCollide(const Terrain& terrain, Realm realm, Vec2& position, Vec2 velocity,
                        double radius, double dt, bool collideTerrain,
                        bool refuseWallCrossing) {
    StepOutcome out;
    const double r = sanitizeCollisionRadius(radius);
    const double hull = r > kMinCollisionRadius ? r : kMinCollisionRadius;
    const Vec2 start = sanitizePosition(terrain, position, realm);
    position = start;

    Vec2 delta = sanitizeMovementVelocity(velocity) * (dt > 0.0 ? dt : 0.0);
    double distance = delta.length();

    // The reach is measured in substeps of the body's own size; a small body
    // then takes shorter ones than that, so it cannot step through a thin wall,
    // and more of them to cover the same ground.
    const double reach = substepLength(hull) * kMaxSubstepCount;
    const double stepLength = std::min(substepLength(hull), hull + kMaxSubstepPenetration);
    const int maxSteps = static_cast<int>(std::ceil(reach / stepLength));
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
        if (steps > maxSteps) steps = maxSteps;   // ceil() rounding
    }

    const Vec2 stepDelta = delta / static_cast<double>(steps);
    for (int i = 0; i < steps; ++i) {
        const Vec2 from = position;
        const Vec2 want = from + stepDelta;
        Vec2 got = collideTerrain ? terrain.resolveCircle(want, hull, realm) : want;

        // The containment guard is a TILE question, so it is asked of every
        // authored map -- each world realm has a grid of its own -- and of
        // nothing else: the maze's resolver slides along its own geometry and
        // the arena has nothing to cross. Same geometry, same physics,
        // whichever realm id the map was loaded into.
        if (refuseWallCrossing && collideTerrain && isWorldRealm(realm)
            && distanceSq(got, want) > kContactEpsilon * kContactEpsilon
            // A centre already inside a blocking tile is exempt: the
            // resolver's output is its only way out, arbitrary as the
            // direction may be.
            && !terrain.blocked(from, realm)
            && centerPathCrossesWall(terrain, from, got, realm)) {
            // The ejection would carry the centre across solid. Refuse it and
            // end the tick's movement where this substep started.
            out.blocked = true;
            break;
        }

        got = terrain.clampInside(got, hull, realm);
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
      mobTargets(world), npcTargets(world), mobBodies(world), playerPositions(world),
      npcBodies(world), looseBodies(world), ringAnchors(world) {
    // A body marked Dead is still in the world so later systems can see it die,
    // but a corpse must not keep walking.
    players.without<Dead>();
    mobs.without<Dead>();
    projectiles.without<Dead>();
    // A guided shot locking onto an intangible mob would fly through it and
    // circle it for good.
    mobTargets.without<Dead, Intangible>();
    mobBodies.without<Dead>();
    // A broken wax is gone from the moment it breaks: nothing walks into it
    // for the rest of the tick while it waits for the reaper.
    looseBodies.without<Dead>();
    ringAnchors.without<Dead>();
    // playerPositions deliberately keeps corpses: a dead flower is about to
    // respawn where it stands, and letting the mobs around it coast for those
    // few ticks is the artefact the LOD gate exists to avoid.
}

void MovementSystem::bind(World& world) {
    if (boundWorld_ == &world && queries_) return;
    boundWorld_ = &world;
    queries_.emplace(world);
}

void MovementSystem::run(World& world, const Terrain& terrain, double nowMillis, double dt) {
    runPlayerPhase(world, terrain, nowMillis, dt);
    runWorldPhase(world, terrain, nowMillis, dt);
}

void MovementSystem::runPlayerPhase(World& world, const Terrain& terrain,
                                    double nowMillis, double dt) {
    bind(world);
    // Before the flowers, so the moon a flower walks into is where its own
    // momentum has already carried it this tick.
    coastRingAnchors(world, terrain, dt);
    movePlayers(world, terrain, nowMillis, dt);
    // The pads act on the position the tick has already settled on, which is
    // what makes the suction able to beat a shove: the reference runs them at
    // the very end of its per-player pipeline, on the coordinates it is about
    // to commit.
    if (worldMaps != nullptr) {
        teleportTerrain_ = &terrain;
        stepTeleporters(world, nowMillis, dt);
    }
}

void MovementSystem::runWorldPhase(World& world, const Terrain& terrain,
                                   double nowMillis, double dt) {
    bind(world);
    seekTargetsReady_ = false;
    moveMobs(world, terrain, nowMillis, dt);
    // Projectiles after mobs: a shot fired this tick takes its launch bearing
    // from where the mobs ended up, not from where they were.
    moveProjectiles(world, terrain, dt);
    // Separation last, once everything has moved -- the reference resolves
    // mob-vs-mob overlap in its combat phase for the same reason. A pass run
    // before the movers would have its work undone the same tick.
    separateMobs(world, terrain);
    // And the loose petals after that, off the separation pass's own grid,
    // so what they are solid against is where the mobs finally stand.
    collideLooseBodies(world, terrain);
}

void MovementSystem::collectNpcDiscs() {
    npcDiscs_.clear();
    queries_->npcBodies.each([&](Entity, NpcTag&, Transform& transform, Body& body) {
        npcDiscs_.push_back({transform.position, body.radius, transform.realm});
    });
}

void MovementSystem::collectLooseDiscs() {
    looseDiscs_.clear();
    queries_->looseBodies.each([&](Entity e, LoosePetal&, Transform& transform, Body& body) {
        // A degenerate coordinate would put a NaN into every flower and mob it
        // shoved; the petal pass retires a wax that has one.
        const Vec2 p = transform.position;
        if (!std::isfinite(p.x) || !std::isfinite(p.y)) return;
        if (std::fabs(p.x) > kMaxSaneWorldCoord || std::fabs(p.y) > kMaxSaneWorldCoord) return;
        LooseDisc disc;
        disc.entity = e;
        disc.position = p;
        disc.radius = sanitizeCollisionRadius(body.radius);
        disc.mass = body.mass > 1e-6 ? body.mass : 1.0;
        disc.realm = transform.realm;
        looseDiscs_.push_back(disc);
    });
}

void MovementSystem::storeLooseDiscs(World& world) const {
    for (const LooseDisc& disc : looseDiscs_) {
        if (Transform* transform = world.tryGet<Transform>(disc.entity)) {
            transform->position = disc.position;
        }
    }
}

void MovementSystem::coastRingAnchors(World& world, const Terrain& terrain, double dt) {
    queries_->ringAnchors.each([&](Entity, RingAnchor&, Transform& transform, Motion& motion,
                                   Body& body) {
        if (motion.velocity.lengthSq() <= 0.0) return;
        MoveState state{transform.position, motion.velocity};
        integrateVelocity(state, Vec2{0, 0}, dt);
        const Vec2 velocity = sanitizeMovementVelocity(state.velocity);
        // Stopped, rather than stepped through the walls forever at a speed
        // too small to draw.
        if (velocity.lengthSq() < kMinCoastSpeed * kMinCoastSpeed) {
            motion.velocity = Vec2{0, 0};
            return;
        }
        const StepOutcome out = stepCollide(terrain, transform.realm, transform.position, velocity,
                                            body.radius, dt, true, true);
        // Rebuilt from what it achieved, unlike a flower's: a moon thrown into
        // a wall slides along it and loses what it had going into it, rather
        // than pressing on with no one steering.
        motion.velocity = velocityAfterStep(velocity, out, dt, 1.0);
    });
}

void MovementSystem::movePlayers(World& world, const Terrain& terrain,
                                 double nowMillis, double dt) {
    collectNpcDiscs();
    collectLooseDiscs();

    queries_->players.each([&](Entity e, PlayerTag&, Transform& transform, Motion& motion,
                               Body& body, PlayerInput& input) {
        // The cursor is one value with two readers -- movement and petal aim --
        // so it is derived once, here, before anything downstream looks at it.
        input.aimDirection = Vec2::fromAngle(input.current.aimAngle);

        // Facing is the WALK heading, and it is frozen while the flower is
        // standing still: it is where the flower went, not where its owner is
        // pointing. Under cursor control the two are the same value, so this
        // only reads differently on WASD -- where the client keeps sending the
        // cursor angle as the aim -- and at rest, where the reference holds
        // the heading it stopped on. The angle is what both clients ease the
        // pupils toward, so writing the cursor here makes every flower's eyes
        // track a mouse the reference never showed them.
        if (input.current.moveStrength > 0.0) {
            transform.angle = input.current.moveAngle;
        }

        // Every scale folds into the TARGET speed, never into the velocity
        // that came out of the last tick. That is what the client does, and a
        // player who walks into water must ease down to the slower speed
        // rather than have it applied retroactively to momentum they had.
        double maxSpeed = kPlayerMaxSpeed;
        if (const PlayerModifiers* mods = world.tryGet<PlayerModifiers>(e)) {
            maxSpeed *= sanitizeSpeedScale(mods->speedScale);
        }
        // Afflictions::slowFactor is deliberately NOT read. Slows are a mob
        // affliction in the reference -- its one writer refuses any victim
        // without a mob kind -- so a flower standing in a Web petal's field
        // keeps full speed. The one thing that does slow a flower is a MOB's
        // web, which is gardn's (speed_ratio 0.5 while the two overlap) and has
        // a field of its own.
        if (const Afflictions* afflictions = world.tryGet<Afflictions>(e)) {
            if (afflictions->webbed(nowMillis)) {
                maxSpeed *= clamp(afflictions->webbedFactor, 0.0, 1.0);
            }
        }
        if (terrain.inWater(transform.position, transform.realm)) maxSpeed *= kWaterSpeedScale;

        MoveState state{transform.position, motion.velocity};
        integrateVelocity(state, desiredVelocity(input.current.moveAngle,
                                                 input.current.moveStrength, maxSpeed), dt);

        // A pending shove becomes momentum that the same friction spends, so
        // the flower slides the distance out over the next few ticks instead
        // of jumping it in one -- with the camera pinned to the flower, a jump
        // jolts the whole screen however smoothly the client then eases it.
        {
            const Vec2 shove = takeKnockback(world, e);
            const double reach = shove.length();
            if (reach > 0.0) {
                const double speed = shoveSpeed(reach, dt, /*decaysFirst=*/false);
                if (speed > 0.0) {
                    state.velocity += shove * (speed / reach);
                } else {
                    transform.position += shove;
                }
            }
        }
        const Vec2 velocity = sanitizeMovementVelocity(state.velocity);
        // The containment guard is the flower's alone, as it is in the
        // reference: it lives in stepPlayerMovement, and mobs and projectiles
        // take the resolver's word for it. A player arrives here from a
        // contact knockback that already overlapped wall geometry often
        // enough that without it, diagonal seams are passable.
        stepCollide(terrain, transform.realm, transform.position, velocity, body.radius, dt, true,
                    true);
        // Loose petals before NPCs: a wax gives way and an NPC does not, so an
        // NPC is the last word on where the flower may stand, as a wall is.
        if (!looseDiscs_.empty()) shoveLooseBodies(terrain, transform, body);
        if (!npcDiscs_.empty()) pushOutOfNpcs(terrain, transform, body.radius);
        // TypeScript's stepPlayerMovement returns the friction-integrated
        // velocity unchanged when wall resolution alters the position. Keeping
        // the attempted velocity is observable on the following tick (the
        // flower continues pressing/sliding); rebuilding it from achieved
        // displacement changes both acceleration and the wall trajectory.
        motion.velocity = velocity;
    });
    storeLooseDiscs(world);
}

void MovementSystem::shoveLooseBodies(const Terrain& terrain, Transform& transform,
                                      const Body& body) {
    const double radius = sanitizeCollisionRadius(body.radius);
    const double mass = body.mass > 1e-6 ? body.mass : 1.0;
    for (LooseDisc& disc : looseDiscs_) {
        if (disc.realm != transform.realm) continue;
        const double reach = disc.radius + radius;
        const Vec2 offset = transform.position - disc.position;
        const double gapSq = offset.lengthSq();
        if (gapSq >= reach * reach) continue;
        const double gap = std::sqrt(gapSq);
        // Along the line between the centres, so a flower pressing on a slab
        // off-centre slides round it as it shoves. Dead centre has no line.
        const Vec2 out = gap > 1e-9 ? offset * (1.0 / gap) : Vec2{1.0, 0.0};
        // The slab's share of the push is the flower's mass over both.
        softLooseContact(terrain, transform.realm, disc.position, disc.radius,
                         mass / (mass + disc.mass), transform.position, radius, true, out,
                         loosePetalContactPush(reach - gap));
    }
}

void MovementSystem::collideLooseBodies(World& world, const Terrain& terrain) {
    collectLooseDiscs();
    if (looseDiscs_.empty()) return;
    collectNpcDiscs();
    const ContentRegistry& registry = content();

    // How far separation may have carried a mob from where it filed it in
    // separationGrid_: the most one mob's summed push is ever allowed.
    constexpr double kFiledDrift = kMobSeparationMaxPushPerPair * kMobSeparationPushHeadroom;

    for (LooseDisc& disc : looseDiscs_) {
        // Mobs. The separation set is exactly the mobs worth colliding this
        // tick -- awake, finite, not flagged no_mob_collision (an ant hole is
        // a hole in the ground, and a slab slides over it as a mob does) --
        // so the slab meets the mobs the way they meet each other.
        separationGrid_.query(disc.realm, disc.position, disc.radius + kFiledDrift,
                              separationCandidates_);
        for (const Entity mob : separationCandidates_) {
            const std::uint32_t index = entityIndex(mob);
            const std::uint32_t slot =
                index < separationSlot_.size() ? separationSlot_[index] : kNoSeparationEntry;
            if (slot == kNoSeparationEntry) continue;
            const SeparationEntry& entry = separationSet_[slot];
            if (entry.entity != mob || entry.noCollision) continue;
            Transform* transform = world.tryGet<Transform>(mob);
            if (transform == nullptr) continue;

            const double reach = disc.radius + entry.radius;
            const Vec2 offset = transform->position - disc.position;
            const double gapSq = offset.lengthSq();
            if (gapSq >= reach * reach) continue;
            const double gap = std::sqrt(gapSq);
            const Vec2 out = gap > 1e-9 ? offset * (1.0 / gap) : Vec2{-1.0, 0.0};

            // A mob that cannot walk -- a nest, a rock, a cactus -- is never
            // moved by anything, and a slab shoved into one is eased round it.
            // Everything else gives way by mass. A mob meets walls as a point,
            // as it does everywhere else.
            const bool anchored = anchoredAgainstKnockback(world, registry, mob);
            const Body* body = world.tryGet<Body>(mob);
            const double mobMass = body != nullptr && body->mass > 1e-6 ? body->mass : 1.0;
            softLooseContact(terrain, disc.realm, disc.position, disc.radius,
                             anchored ? 1.0 : mobMass / (mobMass + disc.mass),
                             transform->position, kMobWallRadius, !anchored, out,
                             loosePetalContactPush(reach - gap));
        }

        // NPCs never give way, to a flower or to anything else.
        for (NpcDisc& npc : npcDiscs_) {
            if (npc.realm != disc.realm) continue;
            const double reach = npc.radius + disc.radius;
            const Vec2 offset = npc.position - disc.position;
            const double gapSq = offset.lengthSq();
            if (gapSq >= reach * reach) continue;
            const double gap = std::sqrt(gapSq);
            const Vec2 out = gap > 1e-9 ? offset * (1.0 / gap) : Vec2{-1.0, 0.0};
            softLooseContact(terrain, disc.realm, disc.position, disc.radius, 1.0, npc.position,
                             npc.radius, false, out, loosePetalContactPush(reach - gap));
        }
    }

    // Slab against slab, by mass. A handful at most -- one per wax slot per
    // flower on screen -- so every pair is simply tested.
    for (std::size_t i = 0; i < looseDiscs_.size(); ++i) {
        for (std::size_t j = i + 1; j < looseDiscs_.size(); ++j) {
            LooseDisc& a = looseDiscs_[i];
            LooseDisc& b = looseDiscs_[j];
            if (a.realm != b.realm) continue;
            const double reach = a.radius + b.radius;
            const Vec2 offset = b.position - a.position;
            const double gapSq = offset.lengthSq();
            if (gapSq >= reach * reach) continue;
            const double gap = std::sqrt(gapSq);
            // Two slabs laid on the same spot -- two wax slots coming off one
            // reload -- have no line between them; split them sideways.
            const Vec2 out = gap > 1e-9 ? offset * (1.0 / gap) : Vec2{0.0, 1.0};
            softLooseContact(terrain, a.realm, a.position, a.radius, b.mass / (a.mass + b.mass),
                             b.position, b.radius, true, out, loosePetalContactPush(reach - gap));
        }
    }

    storeLooseDiscs(world);
}

void MovementSystem::pushOutOfNpcs(const Terrain& terrain, Transform& transform,
                                   double radius) const {
    bool moved = false;
    for (const NpcDisc& npc : npcDiscs_) {
        if (npc.realm != transform.realm) continue;
        const Vec2 offset = transform.position - npc.position;
        const double reach = npc.radius + radius;
        const double gapSq = offset.lengthSq();
        if (gapSq >= reach * reach) continue;
        // Straight out along the line between the two centres, which is what
        // lets a flower pressing into one slide round it rather than stick.
        // Dead centre has no line; any way out will do.
        const double gap = std::sqrt(gapSq);
        const Vec2 out = gap > 1e-9 ? offset * (1.0 / gap) : Vec2{1.0, 0.0};
        transform.position = npc.position + out * reach;
        moved = true;
    }
    // A wall still wins: an NPC parked against one must not be able to shove
    // a flower into it.
    if (moved) transform.position = terrain.resolveCircle(transform.position, radius, transform.realm);
}

void MovementSystem::stepTeleporters(World& world, double nowMillis, double dt) {
    teleportPlayers_.clear();
    queries_->players.each([&](Entity e, PlayerTag&, Transform&, Motion&, Body&, PlayerInput&) {
        teleportPlayers_.push_back(e);
    });

    for (const Entity e : teleportPlayers_) {
        // A flower the server keeps off the pads -- its bots -- is not even
        // pulled by one: the suction is the pad's first act, and a bot half
        // dragged onto a pad it can never take would stand there forever.
        if (takesTeleporters && !takesTeleporters(e)) continue;
        Transform* transform = world.tryGet<Transform>(e);
        if (!transform) continue;
        // Every world map has its own pads. The arena and the maze have none:
        // they are generated rather than authored, so there is nothing there
        // to stand on.
        const MapData* map = worldMaps->forRealm(transform->realm);
        if (map == nullptr) continue;
        // The state is per flower and starts empty, so it is created on the
        // first tick this runs for a player rather than by the prefab -- one
        // more component on every flower for a feature a handful of pads use.
        TeleporterState& state = world.ensure<TeleporterState>(e);
        const MapData::TeleportStep step =
            map->stepTeleporters(transform->position, dt, nowMillis, state);
        // The suction is committed raw, with no wall resolution and no world
        // clamp, exactly as the reference commits it: the pull is small and
        // every pad is authored on open ground.
        transform->position = step.position;

        if (step.fired < 0) continue;
        // A pad that fired leads to ANOTHER map, which means a realm change --
        // a new tile grid on the wire and a cleared view on the client. Only
        // the connection layer can do that, so it is handed up rather than
        // done here. Without a handler the pad is inert, which is what a
        // focused movement test gets and what it should get: a test with no
        // server has nowhere to send anyone.
        if (!onTeleport) continue;
        const MapElement& pad = map->elements()[static_cast<std::size_t>(step.fired)];
        WorldMaps::Destination destination;
        // No mob list: the arrival is a player being put down on authored
        // ground, and refusing to send them because a mob is standing on the
        // pad would leave them charging it forever.
        if (!worldMaps->resolveTeleporter(pad, teleportRng_, *teleportTerrain_, destination)) {
            continue;   // reported at load; nothing to do per tick
        }
        onTeleport(e, destination.realm, destination.position);
    }
}

void MovementSystem::moveMobs(World& world, const Terrain& terrain,
                              double nowMillis, double dt) {
    const ContentRegistry& registry = content();
    queries_->mobs.each([&](Entity e, MobTag&, Transform& transform, Motion& motion, Body&) {
        // The shove a petal or a blast queued. The TypeScript server wrote
        // this vector on every hit and then never read it back, so a mob
        // walked straight through a ring; that was a bug, not a design.
        //
        // Spent before the mob's own step, and through the wall resolver
        // rather than added raw as a flower's is: a rare jelly's shove is a
        // hundred units before mass divides it, and a mob pressed against a wall
        // would otherwise be put through it. The crossing guard is the same
        // one the flower's step takes after its shove. Speed 1 for the
        // displacement over one second, so a dt of zero still delivers it.
        //
        // Spent over several ticks rather than in this one; see
        // kKnockbackSpendDecay. A wall that stops the shove takes the rest of
        // it too, or a mob pinned against one would grind into it for the
        // whole recoil.
        if (Knockback* kb = world.tryGet<Knockback>(e)) {
            const Vec2 fresh = takeKnockback(world, e);
            if (anchoredAgainstKnockback(world, registry, e) ||
                !std::isfinite(kb->carry.x) || !std::isfinite(kb->carry.y)) {
                kb->carry = Vec2{0, 0};
            } else {
                kb->carry += fresh;
                if (kb->carry.lengthSq() < kKnockbackSettleDistance * kKnockbackSettleDistance) {
                    kb->carry = Vec2{0, 0};
                } else {
                    // A step of no time delivers the lot, as the old one-shot
                    // did, rather than holding it owed forever.
                    const double kept =
                        dt > 0.0 ? std::pow(kKnockbackSpendDecay, dt * kKnockbackSpendRate) : 0.0;
                    const Vec2 spend = kb->carry * (1.0 - kept);
                    const StepOutcome out = stepCollide(terrain, transform.realm,
                                                        transform.position, spend, kMobWallRadius,
                                                        1.0, true, true);
                    kb->carry = out.blocked ? Vec2{0, 0} : kb->carry * kept;
                }
            }
        }

        const Vec2 velocity = sanitizeMovementVelocity(motion.velocity);

        // Unlike a player's, a mob's slow and water penalty scale the DISPLACEMENT
        // and are not written back into Motion. The AI publishes the velocity it
        // wants in world terms; if the penalty were folded into the stored value
        // it would compound every tick the AI left the velocity alone, and a mob
        // that paused in a river would never get out of it.
        double envScale = 1.0;
        if (terrain.inWater(transform.position, transform.realm)) envScale *= kMobWaterSpeedScale;
        // Slow already scales the desired speed in MobAiSystem. Applying it
        // again here squares the factor (a 0.5 web becomes 0.25 speed).

        const Vec2 attempted = velocity * envScale;
        const StepOutcome out = stepCollide(terrain, transform.realm, transform.position, attempted,
                                            kMobWallRadius, dt);

        // No friction is applied here. The AI phase runs the shared
        // integrateVelocity() against its desired heading and so owns a mob's
        // acceleration and coast-down. A knockback is positional, so it does
        // not alter this stored velocity at all.
        motion.velocity = velocityAfterStep(attempted, out, dt, envScale);
    });
}

void MovementSystem::moveProjectiles(World& world, const Terrain& terrain, double dt) {
    spentProjectiles_.clear();
    queries_->projectiles.each([&](Entity e, ProjectileTag&, Transform& transform,
                                   Motion& motion, Projectile& projectile) {
        if (!(projectile.remainingDistance > 0.0)) {
            // Park immediately so a spent shot cannot move or hit anything
            // else before the lifecycle phase reaps it below.
            motion.velocity = {0, 0};
            spentProjectiles_.push_back(e);
            return;
        }

        // The tail of this tick's segment, recorded before anything moves so
        // that combat can test the whole path the shot flew. Written here and
        // not derived from velocity * dt afterwards, because the weave carries
        // the shot sideways off its axis and the range budget can shorten the
        // last step: both would leave the derived tail somewhere the shot was
        // never at.
        projectile.lastPosition = transform.position;

        Vec2 velocity = sanitizeMovementVelocity(motion.velocity);

        // Seeking is a LAUNCH correction, not a guidance system: the shot
        // snaps onto the nearest mob inside a cone around the bearing it was
        // fired on, once, and then holds that bearing. That is what the
        // reference does, and a shot that re-aimed mid-flight would be a
        // different weapon -- unmissable rather than merely well thrown.
        //
        // The weave below is not a second bite at this: it is a fixed,
        // target-blind pattern about the SAME bearing, which is why the two
        // can coexist. (The client eases a projectile toward its replicated
        // position rather than dead-reckoning it, so a curved path draws
        // faithfully, a beat behind, like every other entity.)
        //
        // The correction belongs to the volley, and the petal system spawns
        // the shot on the petal's orbit bearing; this runs on the shot's first
        // step, before it has moved, so it still measures from the petal's
        // own position. Consuming seekRange is what makes it one-shot.
        if (projectile.seekRange > 0.0 && velocity.lengthSq() > kMinProjectileSpeed * kMinProjectileSpeed) {
            velocity = aimAtLaunch(world, e, transform.position, projectile, velocity);
            projectile.seekRange = 0.0;
        }
        const double speed = velocity.length();

        // The weave. `velocity` stays the shot's AXIS for its whole flight --
        // the sideways carry is added to the step and never written back --
        // because a weave folded into the stored velocity is a rotation, and
        // a rotation compounds: the shot would spiral off instead of snaking
        // along the bearing it was fired on.
        //
        // Sideways OFFSET is amplitude * sin(phase), so what a step carries is
        // its derivative, amplitude * omega * cos(phase). The offset is zero
        // at launch and the shot crosses its own axis twice a cycle, which is
        // what makes the path read as a wave rather than as a shot that was
        // simply aimed wrong.
        Vec2 step = velocity;
        if (projectile.waveAmplitude > 0.0 && projectile.waveFrequency > 0.0 &&
            speed > kMinProjectileSpeed) {
            const double omega = 2.0 * kPi * projectile.waveFrequency;
            const double turn = omega * dt;
            // Sampled at the MIDDLE of the step, not at either end. Read at a
            // step boundary the cosines sum to sin(phase) plus a constant, and
            // that constant is a permanent sideways offset: the shot weaves
            // correctly about a line PARALLEL to the bearing it was fired on
            // instead of about the bearing itself, by a few units at the wasp's
            // numbers. The midpoint sum telescopes to exactly
            // amplitude * sin(phase), which is the curve this is meant to be.
            const Vec2 across{-velocity.y / speed, velocity.x / speed};
            step += across * (projectile.waveAmplitude * omega *
                              std::cos(projectile.wavePhase + turn * 0.5));
            projectile.wavePhase = wrapAngle(projectile.wavePhase + turn);
        }
        const double stepSpeed = step.length();

        // Range is a distance budget, not a timer: the last tick is shortened
        // so a fast shot dies exactly at its stated reach rather than one whole
        // tick past it. Measured on the STEP and not on the axis, so a weaving
        // shot spends the budget along the path it actually flies.
        Vec2 attempted = step;
        const double travel = stepSpeed * dt;
        if (travel > projectile.remainingDistance && travel > kMinStepSeconds) {
            attempted = step * (projectile.remainingDistance / travel);
        }

        double radius = 0.0;
        if (const Body* body = world.tryGet<Body>(e)) radius = body->radius;

        // Walls do not stop a shot: it flies over terrain as if the map were
        // open ground, so a volley fired along a corridor or across a bend
        // still reaches what it was aimed at. The world's edge is the one
        // thing it cannot cross -- the step still clamps to it, and that clamp
        // is what `blocked` reports.
        //
        // A carrot is the exception: it meets walls, and the edge, like a body
        // does, and comes off them mirror-fashion -- the part of its velocity
        // into the surface is turned round, the part along it kept. The
        // surface's normal is the way the resolver pushed it back out.
        const bool bounces = projectile.bouncesOffWalls;
        const StepOutcome out = stepCollide(terrain, transform.realm, transform.position,
                                            attempted, radius, dt, /*collideTerrain=*/bounces);
        projectile.remainingDistance -= out.displacement.length();
        if (!(projectile.remainingDistance > kSpentRangeEpsilon)) projectile.remainingDistance = 0.0;

        if (out.blocked && bounces) {
            const Vec2 pushedBack = out.displacement - attempted * dt;
            if (pushedBack.lengthSq() > 1e-12) {
                const Vec2 normal = pushedBack.normalized();
                const double into = velocity.x * normal.x + velocity.y * normal.y;
                if (into < 0.0) velocity -= normal * (2.0 * into);
            }
        } else if (out.blocked) {
            // The map edge eats shots.
            projectile.remainingDistance = 0.0;
            motion.velocity = {0, 0};
            spentProjectiles_.push_back(e);
            return;
        }

        motion.velocity = velocity;
        // Pointed along the STEP rather than along the axis: a weaving missile
        // that stayed square to its bearing would slide sideways like a crab.
        if (stepSpeed > kMinProjectileSpeed) transform.angle = step.angle();
        if (!(projectile.remainingDistance > 0.0)) {
            motion.velocity = {0, 0};
            spentProjectiles_.push_back(e);
            return;
        }

        // The net under the distance rule. Every shot is spawned with its
        // range restated as a flight time, and a shot that cannot spend its
        // range -- a NaN velocity sanitised to zero, a step that rounds to no
        // movement -- must still die on that schedule instead of lying on the
        // ground until something walks into it. A whole tick of slack keeps
        // this strictly the backstop: the two clocks tie to within rounding,
        // and firing on the tie would cut a tick off ordinary flights.
        if (Lifetime* lifetime = world.tryGet<Lifetime>(e)) {
            lifetime->remainingSeconds -= dt;
            if (lifetime->remainingSeconds <= -net::kTickSeconds) {
                projectile.remainingDistance = 0.0;
                motion.velocity = {0, 0};
                spentProjectiles_.push_back(e);
            }
        }
    });

    // Expiry is a movement result, so movement owns the transition to Dead.
    // Combat retains its zero-range check as a backstop for callers that edit
    // Projectile state between phases, but ordinary flight no longer depends
    // on combat happening to clean up a projectile parked on the ground.
    for (const Entity e : spentProjectiles_) {
        if (world.isAlive(e) && !world.has<Dead>(e)) world.add<Dead>(e);
    }
}

void MovementSystem::collectSeekTargets() {
    seekTargets_.clear();
    seekTargetsReady_ = true;

    // Mobs only. The reference's seek walks the shared enemy broadphase, which
    // deliberately holds no players and no pets, so a guided shot locks onto
    // wild mobs and nothing else; the team test below is what keeps a pet off
    // the list here, since a pet is a mob on the players' team.
    queries_->mobTargets.each([&](Entity e, MobTag&, Transform& t, Faction& f, Health& h) {
        if (!h.alive()) return;
        seekTargets_.push_back({e, t.position, f.team});
    });
    // A target dummy draws a guided shot like the mob it is built from. The
    // players' own NPCs are not filed at all: a mob's volley that curled onto
    // the oracle would be wasted on something that takes no hits.
    queries_->npcTargets.each([&](Entity e, NpcTag&, Transform& t, Faction& f) {
        if (f.team == Team::Players) return;
        seekTargets_.push_back({e, t.position, f.team});
    });
}

Entity MovementSystem::findSeekTarget(Entity self, const Projectile& projectile, Team team,
                                      Vec2 position, double heading) const {
    // A config with a range but no cone re-aims within 45 degrees of the
    // firing bearing -- the reference's default. A full circle would let a
    // shot leave along a bearing nothing was ever fired on.
    const double cone = projectile.seekCone > 0.0 ? projectile.seekCone : kPi * 0.25;
    const double rangeSq = projectile.seekRange * projectile.seekRange;
    double bestDistanceSq = 0.0;
    Entity best = NULL_ENTITY;

    for (const SeekTarget& candidate : seekTargets_) {
        if (candidate.entity == self || candidate.entity == projectile.owner) continue;
        if (candidate.entity == projectile.creditTo) continue;
        if (candidate.team == team || candidate.team == Team::Neutral) continue;

        const Vec2 toTarget = candidate.position - position;
        const double distanceSquared = toTarget.lengthSq();
        // A target sitting exactly on the shot has no bearing to aim at.
        if (distanceSquared > rangeSq || distanceSquared < 1e-12) continue;
        // Strictly nearer, so an exact tie keeps the one found first.
        if (best != NULL_ENTITY && distanceSquared >= bestDistanceSq) continue;
        if (std::fabs(angleDelta(heading, toTarget.angle())) > cone) continue;

        bestDistanceSq = distanceSquared;
        best = candidate.entity;
    }
    return best;
}

Vec2 MovementSystem::aimAtLaunch(World& world, Entity self, Vec2 position,
                                 const Projectile& projectile, Vec2 velocity) {
    if (!seekTargetsReady_) collectSeekTargets();

    // A shot inherits its owner's team when it has none of its own, so a mob's
    // volley does not lock onto the mobs beside it.
    Team team = Team::Players;
    if (const Faction* faction = world.tryGet<Faction>(self)) team = faction->team;
    else if (const Faction* owner = world.tryGet<Faction>(projectile.owner)) team = owner->team;

    const double speed = velocity.length();
    const double heading = velocity.angle();
    const Entity target = findSeekTarget(self, projectile, team, position, heading);
    if (target == NULL_ENTITY) return velocity;

    const Transform* targetTransform = world.tryGet<Transform>(target);
    if (!targetTransform) return velocity;
    return Vec2::fromAngle((targetTransform->position - position).angle(), speed);
}

// ---------------------------------------------------------------------------
// Mob separation
// ---------------------------------------------------------------------------

bool MovementSystem::activeForSeparation(Vec2 position, Realm realm, Rarity rarity) const {
    // A boss is never off, the same exception the AI phase makes: it is an
    // announced event standing where the server said it would be, and a raid
    // arriving to find its escorts sitting inside each other is the visible
    // half of "asleep".
    if (isBossRarity(rarity)) return true;
    // Nobody connected is the PERMISSIVE case, as it is in the reference's
    // activity field: with no observer there is nothing to save the work for,
    // and a bench or a test that never adds a player sees the unmodified rule.
    if (separationPlayers_.empty()) return true;
    const double reachSq = kMobActiveRadius * kMobActiveRadius;
    for (const RealmPoint& player : separationPlayers_) {
        if (player.realm != realm) continue;
        if (distanceSq(position, player.position) <= reachSq) return true;
    }
    return false;
}

void MovementSystem::buildSeparationSet(World& world) {
    separationPlayers_.clear();
    queries_->playerPositions.each([&](Entity, PlayerTag&, Transform& transform) {
        if (!std::isfinite(transform.position.x) || !std::isfinite(transform.position.y)) return;
        separationPlayers_.push_back({transform.position, transform.realm});
    });

    // Retire last pass's slots before the set they index is dropped. The table
    // is keyed by entity INDEX, which the world recycles.
    for (const SeparationEntry& entry : separationSet_) {
        const std::uint32_t index = entityIndex(entry.entity);
        if (index < separationSlot_.size()) separationSlot_[index] = kNoSeparationEntry;
    }
    separationSet_.clear();
    separationGrid_.clear();

    const ContentRegistry& registry = content();
    queries_->mobBodies.each([&](Entity e, MobTag&, Transform& transform, Body& body,
                                 MobType& type) {
        const Vec2 position = transform.position;
        // A degenerate coordinate makes the cell walks non-terminating and
        // would put a NaN into every push the mob takes part in. Such a mob
        // sits the pass out -- and, never entering the set, is excluded as a
        // push TARGET as well as a pusher.
        if (!std::isfinite(position.x) || !std::isfinite(position.y)) return;
        if (std::fabs(position.x) > kMaxSaneWorldCoord) return;
        if (std::fabs(position.y) > kMaxSaneWorldCoord) return;
        // Far from every flower: sit this tick out, the same LOD rule the AI
        // phase applies. A shove nobody is near enough to see is missed
        // outright rather than applied one-sided.
        if (!activeForSeparation(position, transform.realm, type.rarity)) return;

        SeparationEntry entry;
        entry.entity = e;
        entry.position = position;
        entry.realm = transform.realm;
        entry.radius = sanitizeCollisionRadius(body.radius);
        if (const BodySegment* segment = world.tryGet<BodySegment>(e)) {
            entry.chainHead = segment->chainHead;
        }
        if (const MobType* type = world.tryGet<MobType>(e)) {
            entry.noCollision = registry.mob(type->configIndex).noMobCollision;
        }
        if (const HoleTether* tether = world.tryGet<HoleTether>(e)) {
            if (tether->emerging) entry.emergingFrom = tether->hole;
        }

        const std::uint32_t index = entityIndex(e);
        if (index >= separationSlot_.size()) {
            separationSlot_.resize(static_cast<std::size_t>(index) + 1, kNoSeparationEntry);
        }
        separationSlot_[index] = static_cast<std::uint32_t>(separationSet_.size());
        separationSet_.push_back(entry);
        separationGrid_.insert(e, transform.realm, position, entry.radius);
    });
}

void MovementSystem::separateMobs(World& world, const Terrain& terrain) {
    buildSeparationSet(world);
    if (separationSet_.empty()) return;

    // Jacobi, not in-place: every push is computed from the positions the pass
    // started with and applied afterwards, so the outcome does not depend on
    // the order the set happens to be walked in. Mass plays no part -- the
    // separation is symmetric and driven purely by the two radii.
    for (SeparationEntry& self : separationSet_) {
        if (self.noCollision) continue;
        // The grid files a mob under every cell its own circle touches, so a
        // query of this mob's radius plus the buffer already returns every
        // neighbour that can be inside the sum of the two radii.
        separationGrid_.query(self.realm, self.position, self.radius + kMobCollisionBuffer,
                              separationCandidates_);

        for (const Entity candidate : separationCandidates_) {
            const std::uint32_t index = entityIndex(candidate);
            const std::uint32_t slot =
                index < separationSlot_.size() ? separationSlot_[index] : kNoSeparationEntry;
            if (slot == kNoSeparationEntry) continue;
            const SeparationEntry& other = separationSet_[slot];
            if (other.entity != candidate || other.entity == self.entity) continue;
            // Segments of one centipede never push each other: the chain pass
            // holds them in formation, and a physical shove makes them tangle.
            if (self.chainHead != NULL_ENTITY && self.chainHead == other.chainHead) continue;
            // The exemption belongs to the PAIR: a mob flagged
            // no_mob_collision neither pushes nor is pushed.
            if (other.noCollision) continue;

            const Vec2 toOther = other.position - self.position;
            const double distance = toOther.length();
            const double minDistance = self.radius + other.radius + kMobCollisionBuffer;
            if (!(distance < minDistance)) continue;
            // A child still climbing out of the parent it was spawned inside
            // passes through it, both ways round, until the two are apart.
            if (self.emergingFrom == other.entity) {
                self.insideParent = true;
                continue;
            }
            if (other.emergingFrom == self.entity) continue;
            if (!(distance > 0.0)) continue;

            const double push = std::min((minDistance - distance) * 0.5, kMobSeparationMaxPushPerPair);
            self.push -= toOther * (push / distance);
        }
    }

    // The cap is on the SUM, not on each pair: a mob wedged in a crowd would
    // otherwise be moved by every neighbour at once.
    const double cap = kMobSeparationMaxPushPerPair * kMobSeparationPushHeadroom;
    for (const SeparationEntry& entry : separationSet_) {
        // Out of its parent: from here on the two collide like any pair.
        if (entry.emergingFrom != NULL_ENTITY && !entry.insideParent) {
            if (HoleTether* tether = world.tryGet<HoleTether>(entry.entity)) {
                tether->emerging = false;
            }
        }
        if (entry.push.x == 0.0 && entry.push.y == 0.0) continue;
        Transform* transform = world.tryGet<Transform>(entry.entity);
        if (!transform) continue;
        // Separation must not shove a mob into a wall. This runs after the
        // wall pass, so a violation would be on screen for a whole tick. The
        // push is stepped, not resolved in one go: it can be longer than a
        // point is allowed to plunge into a thin wall in one substep.
        Vec2 position = entry.position;
        stepCollide(terrain, entry.realm, position, entry.push.clampedLength(cap), kMobWallRadius,
                    1.0);
        transform->position = position;
    }
}

} // namespace flix
