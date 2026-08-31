#include "server/systems/mob_ai.h"

#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"

#include <algorithm>
#include <cmath>

namespace flr {
namespace {

/// Below this a vector carries no usable direction and normalising it would
/// produce a heading out of pure rounding noise.
constexpr double kDirectionEpsilonSq = 1e-9;

bool entityUsable(World& world, Entity e) {
    if (!world.isAlive(e)) return false;
    if (world.tryGet<Dead>(e) != nullptr) return false;
    const Health* health = world.tryGet<Health>(e);
    return health == nullptr || health->alive();
}

bool nearAnyPlayer(Vec2 position, const std::vector<Vec2>& activePlayers) {
    const double reachSq = kMobActiveRadius * kMobActiveRadius;
    for (const Vec2 player : activePlayers) {
        if (distanceSq(position, player) <= reachSq) return true;
    }
    return false;
}

} // namespace

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

double steerFacing(double current, Vec2 travel, bool hideRotation, bool reversed, double maxTurn) {
    // Drawn upright whatever it is doing: a hole and a sandstorm have no front.
    if (hideRotation) return 0.0;
    // No heading to adopt -- hold the last one. Falling back to zero here is
    // what would make a mob snap east every time it stopped.
    if (!(travel.lengthSq() > kDirectionEpsilonSq)) return wrapAngle(current);

    double want = travel.angle();
    if (reversed) want = wrapAngle(want + kPi);
    // Written as a failed > so a NaN step turns nothing rather than poisoning
    // the angle for the rest of the entity's life.
    if (!(maxTurn > 0.0)) return wrapAngle(current);

    const double delta = angleDelta(current, want);
    return wrapAngle(current + clamp(delta, -maxTurn, maxTurn));
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

MobAiSystem::MobAiSystem(World& world, std::uint64_t seed)
    : mobs_(world), segments_(world), nests_(world), playerModifiers_(world), rng_(seed) {
    // A pet is not a wild mob with a different target list; its behaviour
    // belongs to whatever owns pets. Dead mobs still exist until the reaper
    // runs, and a corpse must not keep steering.
    mobs_.without<Dead, Pet>();
    segments_.without<Dead>();
    playerModifiers_.without<Dead>();
    // nests_ deliberately keeps Dead spawners: a dying nest is exactly when its
    // brood has to be released.
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

MobAiSystem::Drive MobAiSystem::driveFor(std::uint16_t configIndex, Rarity rarity) {
    const ContentRegistry& registry = content();

    // Content is immutable once loaded, so the per-tier numbers can be cached
    // for the life of the process; a hot reload changes the hash and throws the
    // whole table away rather than leaving one stale row behind.
    if (registry.contentHash() != drivesHash_) {
        drives_.clear();
        drivesHash_ = registry.contentHash();
    }

    // An index from outside the tables gets an inert Drive and is never given a
    // row: sizing the cache from an arbitrary u16 would reserve half a million
    // entries for one corrupt mob.
    if (configIndex >= registry.mobCount()) return Drive{};

    const std::size_t tier = static_cast<std::size_t>(clamp(rarityIndex(rarity), 0, kRarityCount - 1));
    const std::size_t key = static_cast<std::size_t>(configIndex) * kRarityCount + tier;
    if (key >= drives_.size()) drives_.resize(registry.mobCount() * kRarityCount);

    Drive& drive = drives_[key];
    if (!drive.valid) {
        const MobConfig& config = registry.mob(configIndex);
        const MobStats stats = registry.mobStats(configIndex, rarity);
        drive.speed = stats.speed;
        drive.attackCooldownMillis = stats.attackCooldownMillis;
        drive.hideRotation = config.hideRotation;
        drive.reversed = config.reversed;
        drive.valid = true;
    }
    return drive;
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

Entity MobAiSystem::acquireTarget(World& world, const Terrain& terrain, const SpatialGrid& grid,
                                  Entity self, Vec2 from, double range) {
    ++stats_.targetScans;

    grid.query(from, range + maxAggroBonus_, gridScratch_);
    candidates_.clear();
    for (const Entity candidate : gridScratch_) {
        if (candidate == self) continue;
        if (!world.has<PlayerTag>(candidate)) continue;
        if (!entityUsable(world, candidate)) continue;
        const Transform* transform = world.tryGet<Transform>(candidate);
        if (transform == nullptr) continue;

        // A raised aggro radius makes the player read as that many units
        // closer, so one comparison covers both "is anyone in range" and "who
        // is the most conspicuous".
        const PlayerModifiers* mods = world.tryGet<PlayerModifiers>(candidate);
        const double bonus = mods != nullptr ? mods->aggroRadiusBonus : 0.0;
        const double score = distance(from, transform->position) - bonus;
        if (score > range) continue;
        candidates_.push_back(Candidate{candidate, transform->position, score});
    }

    std::sort(candidates_.begin(), candidates_.end(),
              [](const Candidate& a, const Candidate& b) { return a.score < b.score; });

    // Nearest-first, stopping at the first one actually visible. Raycasting
    // every candidate is what turns a crowded spawn into a quadratic tick, so
    // the walk is capped -- past the cap the mob simply notices nobody this
    // decision and looks again on the next one.
    const std::size_t rays = std::min<std::size_t>(candidates_.size(),
                                                   static_cast<std::size_t>(kTargetLosRayCap));
    for (std::size_t i = 0; i < rays; ++i) {
        if (!terrain.segmentBlocked(from, candidates_[i].position)) return candidates_[i].entity;
    }
    return NULL_ENTITY;
}

Entity MobAiSystem::nearestAttacker(World& world, Entity self, Vec2 from, double radius) const {
    // Bounty is the ledger combat already keeps of who hurt this mob, so
    // working out who to turn on is a walk over a handful of entries rather
    // than another broadphase query -- which is what lets retaliation happen on
    // the tick the hit lands instead of waiting for the decision clock.
    const Bounty* bounty = world.tryGet<Bounty>(self);
    if (bounty == nullptr) return NULL_ENTITY;

    Entity best = NULL_ENTITY;
    double bestSq = radius * radius;
    for (const Bounty::Share& share : bounty->contributors) {
        if (share.damage <= 0.0) continue;
        if (!entityUsable(world, share.player)) continue;
        const Transform* transform = world.tryGet<Transform>(share.player);
        if (transform == nullptr) continue;
        const double gapSq = distanceSq(from, transform->position);
        // Nearest rather than biggest contributor: the ledger accumulates over
        // the mob's entire life, so the heaviest hitter is often someone who
        // left minutes ago, while whoever is standing next to it is who a
        // player expects it to round on.
        if (gapSq <= bestSq) {
            bestSq = gapSq;
            best = share.player;
        }
    }
    return best;
}

bool MobAiSystem::targetHeld(World& world, Vec2 from, Entity target, double range) const {
    if (!entityUsable(world, target)) return false;
    const Transform* transform = world.tryGet<Transform>(target);
    if (transform == nullptr) return false;

    const PlayerModifiers* mods = world.tryGet<PlayerModifiers>(target);
    const double bonus = mods != nullptr ? mods->aggroRadiusBonus : 0.0;
    const double leash = (range + bonus) * kAggroDropMultiplier;
    return distanceSq(from, transform->position) <= leash * leash;
}

void MobAiSystem::stampAttack(World& world, Entity self, MobAi& ai, double nowMillis,
                              const Drive& drive) {
    double cooldown = drive.attackCooldownMillis;
    if (!(cooldown > 0.0)) {
        const ContactDamage* contact = world.tryGet<ContactDamage>(self);
        cooldown = contact != nullptr ? contact->intervalMillis : kMobHitIntervalMillis;
    }
    if (nowMillis - ai.lastAttackMillis < cooldown) return;

    // Combat owns the per-victim ledger; the AI only reads it, so the two can
    // never disagree about whether this victim has already been hit.
    const HitCooldowns* hits = world.tryGet<HitCooldowns>(self);
    if (hits != nullptr && !hits->ready(ai.target, nowMillis)) return;

    ai.lastAttackMillis = nowMillis;
    ++stats_.attacks;
}

// ---------------------------------------------------------------------------
// Behaviours
// ---------------------------------------------------------------------------

Vec2 MobAiSystem::steerWander(const Terrain& terrain, const Transform& transform, MobAi& ai,
                              double speed, bool decisionDue) {
    if (!(speed > 0.0)) return Vec2{0, 0};

    if (decisionDue) {
        const Vec2 fromAnchor = transform.position - ai.anchor;
        if (fromAnchor.lengthSq() > kMobWanderRadius * kMobWanderRadius) {
            // Outside its territory: head back, loosely. Without this a mob
            // shoved by knockback or dragged by a chase colonises wherever it
            // was abandoned, and a section slowly empties into its neighbours.
            ai.wanderAngle = wrapAngle((-fromAnchor).angle() + rng_.range(-0.6, 0.6));
        } else {
            ai.wanderAngle = wrapAngle(rng_.angle());
        }
        // A heading straight into a wall would be spent pressed against it for
        // the whole interval.
        const Vec2 probe = transform.position + Vec2::fromAngle(ai.wanderAngle, kMobWallProbe);
        if (terrain.segmentBlocked(transform.position, probe)) {
            ai.wanderAngle = wrapAngle(ai.wanderAngle + kPi);
        }
    }
    return Vec2::fromAngle(ai.wanderAngle, speed * kMobWanderSpeedScale);
}

Vec2 MobAiSystem::steerSandstorm(const Terrain& terrain, const Transform& transform, MobAi& ai,
                                 double speed, bool decisionDue) {
    // It never had a target and never will; clearing it means nothing that
    // reads MobAi can mistake a sandstorm for something that is hunting.
    ai.target = NULL_ENTITY;
    ai.fleeUntilMillis = 0;

    if (decisionDue) {
        // The heading DRIFTS rather than being re-rolled. Re-rolling produces
        // an animal milling about; a small signed nudge produces weather
        // crossing the map, which is the whole read of this mob.
        ai.wanderAngle = wrapAngle(ai.wanderAngle +
                                   rng_.range(-kSandstormTurnPerDecision, kSandstormTurnPerDecision));
        const Vec2 probe = transform.position + Vec2::fromAngle(ai.wanderAngle, kMobWallProbe);
        if (terrain.segmentBlocked(transform.position, probe)) {
            ai.wanderAngle = wrapAngle(ai.wanderAngle + kPi * 0.75);
        }
    }
    if (!(speed > 0.0)) return Vec2{0, 0};
    return Vec2::fromAngle(ai.wanderAngle, speed);
}

Vec2 MobAiSystem::steerPassive(World& world, const Terrain& terrain, Entity self,
                               const Transform& transform, MobAi& ai, double speed,
                               double nowMillis, bool decisionDue) {
    // The damage flash is combat's own record that a hit landed this moment, so
    // the AI needs no event of its own and cannot miss one to a system ordering.
    const Health* health = world.tryGet<Health>(self);
    if (health != nullptr && nowMillis < health->flashUntilMillis) {
        if (ai.target == NULL_ENTITY) {
            ai.target = nearestAttacker(world, self, transform.position, kMobRetaliationRadius);
        }
        // Refreshed on every hit: a mob under sustained fire keeps running
        // rather than turning around between two shots.
        if (ai.target != NULL_ENTITY) ai.fleeUntilMillis = nowMillis + kMobFleeDurationMillis;
    }

    if (nowMillis < ai.fleeUntilMillis && ai.target != NULL_ENTITY) {
        const Transform* threat = world.tryGet<Transform>(ai.target);
        if (threat != nullptr && entityUsable(world, ai.target)) {
            const Vec2 away = transform.position - threat->position;
            if (away.lengthSq() > kDirectionEpsilonSq) {
                // Remembered so that when the flee expires the mob carries on
                // the way it was going instead of pivoting on the spot.
                ai.wanderAngle = away.angle();
                return away.normalized() * speed;
            }
            // Standing exactly on the attacker: any direction is away.
            return Vec2::fromAngle(ai.wanderAngle, speed);
        }
    }

    // The scare is over, or whatever caused it is gone. Drop the target rather
    // than carry one this mob will never act on.
    ai.fleeUntilMillis = 0;
    ai.target = NULL_ENTITY;
    return steerWander(terrain, transform, ai, speed, decisionDue);
}

Vec2 MobAiSystem::steerAggressive(World& world, const Terrain& terrain, const SpatialGrid& grid,
                                  Entity self, const Transform& transform, const Body& body,
                                  MobAi& ai, const Drive& drive, double speed,
                                  double nowMillis, bool decisionDue) {
    const double range = ai.aggroRange > 0.0 ? ai.aggroRange : kMobDefaultAggroRange;

    // Retaliation is free (a walk over the damage ledger), so it runs the tick
    // the hit lands. It is gated on having no target so a mob under sustained
    // fire does not re-decide every tick, and bounded by the leash below so it
    // can never pick a target the very next statement would throw away.
    if (ai.target == NULL_ENTITY) {
        const Health* health = world.tryGet<Health>(self);
        if (health != nullptr && nowMillis < health->flashUntilMillis) {
            const double reachable = std::min(kMobRetaliationRadius, range * kAggroDropMultiplier);
            ai.target = nearestAttacker(world, self, transform.position, reachable);
        }
    }

    // Keeping a target costs a pointer chase, so it is checked every tick and
    // aggro drops promptly. Gaining one costs a broadphase query and a few
    // rays, so it waits for the decision clock.
    if (ai.target != NULL_ENTITY && !targetHeld(world, transform.position, ai.target, range)) {
        ai.target = NULL_ENTITY;
    }
    // A neutral mob never goes looking: it only ever has the target that hurt it.
    if (ai.target == NULL_ENTITY && ai.kind == AiKind::Hostile && decisionDue) {
        ai.target = acquireTarget(world, terrain, grid, self, transform.position, range);
    }
    if (ai.target == NULL_ENTITY) return steerWander(terrain, transform, ai, speed, decisionDue);

    const Transform* threat = world.tryGet<Transform>(ai.target);
    if (threat == nullptr) {
        ai.target = NULL_ENTITY;
        return steerWander(terrain, transform, ai, speed, decisionDue);
    }

    const Vec2 toTarget = threat->position - transform.position;
    const double gap = toTarget.length();
    const Body* threatBody = world.tryGet<Body>(ai.target);
    const double reach = body.radius + (threatBody != nullptr ? threatBody->radius : 0.0) + kMobContactSlack;
    if (gap <= reach) stampAttack(world, self, ai, nowMillis, drive);

    if (!(gap > kDirectionEpsilonSq)) return Vec2{0, 0};
    return toTarget * (speed / gap);
}

// ---------------------------------------------------------------------------
// One mob
// ---------------------------------------------------------------------------

void MobAiSystem::steerMob(World& world, const Terrain& terrain, const SpatialGrid& grid,
                           Entity self, Transform& transform, Motion& motion, const Body& body,
                           const MobType& type, MobAi& ai, double nowMillis, double dt) {
    const Drive drive = driveFor(type.configIndex, type.rarity);

    double speed = drive.speed;
    // A slow changes what the mob ASKS for, not how physics answers, so it
    // belongs here rather than in the movement integrator -- applied in both
    // places it would land twice on the same tick.
    if (const Afflictions* afflictions = world.tryGet<Afflictions>(self)) {
        if (afflictions->slowed(nowMillis)) speed *= clamp(afflictions->slowFactor, 0.0, 1.0);
    }

    const bool decisionDue = nowMillis >= ai.nextDecisionMillis;
    if (decisionDue) {
        ai.nextDecisionMillis = nowMillis + kMobDecisionIntervalMillis +
                                rng_.range(0.0, kMobDecisionJitterMillis);
    }

    Vec2 desired{0, 0};
    switch (ai.kind) {
    case AiKind::Stationary:
        // Never moves, and the velocity is CLEARED rather than merely left
        // untargeted: easing toward zero would let a nest slide for half a
        // second after a knockback, and a hole that drifts is a hole that ends
        // up inside a wall.
        motion.velocity = Vec2{0, 0};
        ai.target = NULL_ENTITY;
        transform.angle = steerFacing(transform.angle, Vec2{0, 0}, drive.hideRotation,
                                      drive.reversed, kMobTurnRate * dt);
        return;

    case AiKind::Sandstorm:
        desired = steerSandstorm(terrain, transform, ai, speed, decisionDue);
        break;

    case AiKind::Passive:
        desired = steerPassive(world, terrain, self, transform, ai, speed, nowMillis, decisionDue);
        break;

    case AiKind::Neutral:
    case AiKind::Hostile:
        desired = steerAggressive(world, terrain, grid, self, transform, body, ai, drive, speed,
                                  nowMillis, decisionDue);
        break;
    }

    // The shared player step, deliberately: a mob that adopted its desired
    // velocity outright would reverse instantly, and the whole game reads as
    // things with weight. It also means a knockback still in the velocity
    // decays away instead of being overwritten the tick after it landed.
    MoveState state{transform.position, motion.velocity};
    integrateVelocity(state, desired, dt);
    motion.velocity = state.velocity;

    // Facing follows what the mob is TRYING to do, falling back to what it is
    // actually doing: a mob pinned against a wall or mid-knockback keeps facing
    // its target rather than spinning to face the shove.
    const Vec2 travel = desired.lengthSq() > kDirectionEpsilonSq ? desired : motion.velocity;
    transform.angle = steerFacing(transform.angle, travel, drive.hideRotation, drive.reversed,
                                  kMobTurnRate * dt);
}

// ---------------------------------------------------------------------------
// Segmented bodies
// ---------------------------------------------------------------------------

void MobAiSystem::repairChains(World& world) {
    followerOf_.clear();
    chainHeads_.clear();

    segments_.each([&](Entity self, BodySegment& segment, Transform&) {
        if (segment.ahead != NULL_ENTITY &&
            (!world.isAlive(segment.ahead) || world.tryGet<Dead>(segment.ahead) != nullptr)) {
            // Cut in half: the piece behind the wound becomes its own animal.
            // Entity handles carry a generation, so a recycled slot reads as
            // dead here rather than splicing an unrelated mob into the chain.
            segment.ahead = NULL_ENTITY;
            ++stats_.promotions;
        }
        // `head` is derived, never trusted: the link is the truth and the flag
        // is a cache of it for everyone downstream.
        segment.head = segment.ahead == NULL_ENTITY;
        if (segment.head) {
            chainHeads_.push_back(self);
            return;
        }
        if (!followerOf_.emplace(segment.ahead, self).second) {
            // Two segments claiming the same leader would make the chain a
            // tree. The first keeps the link; this one starts a chain of its own.
            segment.ahead = NULL_ENTITY;
            segment.head = true;
            chainHeads_.push_back(self);
            ++stats_.promotions;
        }
    });
}

void MobAiSystem::followChains(World& world, const Terrain& terrain,
                               const std::vector<Vec2>& activePlayers) {
    visited_.clear();

    for (const Entity head : chainHeads_) {
        const Transform* headTransform = world.tryGet<Transform>(head);
        // The chain is still WALKED when nobody is near -- only the placement
        // is skipped. Walking is what marks the segments visited, and a segment
        // the walk never reached is indistinguishable from one in a cycle.
        const bool active = headTransform != nullptr &&
                            nearAnyPlayer(headTransform->position, activePlayers);

        visited_.insert(head);
        Entity ahead = head;
        for (;;) {
            const auto link = followerOf_.find(ahead);
            if (link == followerOf_.end()) {
                if (BodySegment* tail = world.tryGet<BodySegment>(ahead)) tail->behind = NULL_ENTITY;
                break;
            }
            const Entity self = link->second;
            if (!visited_.insert(self).second) {
                // A cycle in the follower graph. Walking it spins the tick at
                // 100% CPU, which stops the server logging as well as serving,
                // so the link is cut instead of followed.
                if (BodySegment* looped = world.tryGet<BodySegment>(self)) {
                    looped->ahead = NULL_ENTITY;
                    looped->head = true;
                    ++stats_.promotions;
                }
                break;
            }
            if (BodySegment* leader = world.tryGet<BodySegment>(ahead)) leader->behind = self;
            if (active) placeFollower(world, terrain, self, ahead);
            ahead = self;
        }
    }

    // Anything still naming a live leader that no walk reached sits in a cycle
    // with no head at all, so there is no root to have started from. Promote it
    // and next tick has one.
    segments_.each([&](Entity self, BodySegment& segment, Transform&) {
        if (segment.ahead == NULL_ENTITY) return;
        if (visited_.count(self) != 0) return;
        segment.ahead = NULL_ENTITY;
        segment.head = true;
        ++stats_.promotions;
    });
}

void MobAiSystem::placeFollower(World& world, const Terrain& terrain, Entity self, Entity ahead) {
    const Transform* leader = world.tryGet<Transform>(ahead);
    Transform* transform = world.tryGet<Transform>(self);
    const BodySegment* segment = world.tryGet<BodySegment>(self);
    if (leader == nullptr || transform == nullptr || segment == nullptr) return;

    const Body* body = world.tryGet<Body>(self);
    const double radius = body != nullptr ? body->radius : 0.0;
    const double spacing = segment->spacing > 0.0 ? segment->spacing : radius * kSegmentSpacingPerRadius;

    const Vec2 back = transform->position - leader->position;
    // Exactly coincident with its leader there is no trailing direction left to
    // keep, so the chain unfolds behind the leader's facing rather than
    // dividing by zero and placing the segment at NaN.
    const Vec2 direction = back.lengthSq() > kDirectionEpsilonSq
                               ? back.normalized()
                               : Vec2::fromAngle(leader->angle + kPi);

    const Vec2 placed = terrain.resolveCircle(leader->position + direction * spacing, radius);
    transform->position = placed;
    // The follower is carried, not driven. Leaving a velocity on it would have
    // the movement phase integrate it a second time this tick.
    if (Motion* motion = world.tryGet<Motion>(self)) motion->velocity = Vec2{0, 0};

    Drive drive;
    if (const MobType* type = world.tryGet<MobType>(self)) drive = driveFor(type->configIndex, type->rarity);

    // A segment points ALONG its joint, with no turn limit: there is no inertia
    // here to justify a lag, and a segment lagging its own link is exactly what
    // makes a centipede look broken.
    const Vec2 forward = leader->position - placed;
    transform->angle = steerFacing(transform->angle, forward, drive.hideRotation, drive.reversed, kPi);
}

// ---------------------------------------------------------------------------
// Nests
// ---------------------------------------------------------------------------

void MobAiSystem::driveSpawners(World& world, const Terrain& terrain, double nowMillis,
                                CommandBuffer& commands) {
    // Deliberately not LOD-gated. maxAlive bounds the work whatever happens,
    // and a nest that stopped topping up while nobody was looking would be
    // standing empty for the first player who walked in on it.
    nests_.each([&](Entity self, Spawner& nest, Transform& transform, MobType& type) {
        // Pruned first and unconditionally. A nest that went on counting
        // corpses reaches maxAlive once and then never spawns again -- and
        // because nothing else touches this list, nothing else would fix it.
        std::size_t kept = 0;
        for (const Entity child : nest.children) {
            if (world.isAlive(child) && world.tryGet<Dead>(child) == nullptr) {
                nest.children[kept++] = child;
            }
        }
        nest.children.resize(kept);

        if (world.tryGet<Dead>(self) != nullptr) {
            // The nest is dying; its escorts are not. They were spawned into
            // the world and go on living without it, so the list is RELEASED
            // rather than destroyed.
            nest.children.clear();
            return;
        }

        if (!spawnHook_ || nest.maxAlive <= 0) return;
        if (static_cast<int>(nest.children.size()) >= nest.maxAlive) return;
        if (nowMillis < nest.nextSpawnMillis) return;
        nest.nextSpawnMillis = nowMillis + std::max(nest.intervalMillis, kMinSpawnIntervalMillis);

        MobSpawnRequest request;
        request.parent = self;
        request.configIndex = nest.childConfigIndex;
        // Offsets are relative to the parent, so a rare queen fields uncommon
        // soldiers; clamping keeps a hand-edited -9 from wrapping to apex.
        request.rarity = clampRarity(rarityIndex(type.rarity) + nest.rarityOffset);
        const Body* body = world.tryGet<Body>(self);
        const double margin = (body != nullptr ? body->radius : 0.0) + kNestSpawnMargin;
        request.position = terrain.findOpenSpawn(rng_, transform.position, margin);
        request.lifetimeMillis = nest.childLifetimeMillis;
        ++stats_.spawnRequests;

        commands.defer([this, request](World& deferred) {
            Spawner* nest2 = deferred.tryGet<Spawner>(request.parent);
            if (nest2 == nullptr) return;                                   // died before the flush
            if (deferred.tryGet<Dead>(request.parent) != nullptr) return;
            // Re-checked here because several ticks' commands can be flushed
            // together, and a nest must never overshoot its cap.
            if (static_cast<int>(nest2->children.size()) >= nest2->maxAlive) return;
            const Entity child = spawnHook_(deferred, request);
            if (child != NULL_ENTITY) nest2->children.push_back(child);
        });
    });
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

void MobAiSystem::run(World& world, const Terrain& terrain, const SpatialGrid& grid,
                      const std::vector<Vec2>& activePlayers,
                      double nowMillis, double dt, CommandBuffer& commands) {
    stats_ = Stats{};
    // Written as a failed > so a NaN step takes this branch too. A zero step
    // has nothing to integrate and would hand every mob an infinite turn.
    if (!(dt > 0.0) || !std::isfinite(dt)) return;

    maxAggroBonus_ = 0.0;
    playerModifiers_.each([&](Entity, PlayerTag&, PlayerModifiers& mods) {
        if (mods.aggroRadiusBonus > maxAggroBonus_) maxAggroBonus_ = mods.aggroRadiusBonus;
    });

    repairChains(world);

    mobs_.each([&](Entity self, Transform& transform, Motion& motion, Body& body,
                   MobType& type, MobAi& ai) {
        ++stats_.considered;
        // A trailing segment is carried by the chain pass; only the head steers.
        const BodySegment* segment = world.tryGet<BodySegment>(self);
        if (segment != nullptr && !segment->head) return;

        if (!nearAnyPlayer(transform.position, activePlayers)) {
            ++stats_.skipped;
            return;
        }
        ++stats_.thought;
        steerMob(world, terrain, grid, self, transform, motion, body, type, ai, nowMillis, dt);
    });

    followChains(world, terrain, activePlayers);
    driveSpawners(world, terrain, nowMillis, commands);
}

} // namespace flr
