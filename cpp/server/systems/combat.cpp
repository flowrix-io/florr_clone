#include "server/systems/combat.h"

#include <algorithm>
#include <cmath>

namespace flr {

namespace {

/// The entity one step up the ownership chain, or NULL_ENTITY at the top.
///
/// A projectile prefers creditTo over owner because a pet's shot is fired by
/// the pet but answerable to the player; every other link has one owner.
Entity ownerOf(const World& world, Entity e) {
    if (const Projectile* projectile = world.tryGet<Projectile>(e)) {
        return projectile->creditTo != NULL_ENTITY ? projectile->creditTo : projectile->owner;
    }
    if (const PetalInstance* petal = world.tryGet<PetalInstance>(e)) return petal->owner;
    if (const Pet* pet = world.tryGet<Pet>(e)) return pet->owner;
    if (const GroundEffect* effect = world.tryGet<GroundEffect>(e)) return effect->owner;
    return NULL_ENTITY;
}

struct TeamInfo {
    Team team = Team::Neutral;
    bool friendlyFire = false;
    bool known = false;
};

/// The side an entity fights on, walking up to whoever owns it.
///
/// A petal carries no Faction of its own: it is on its flower's side by
/// definition, and giving each of the eight a copy would be eight more fields
/// to keep in step with a player joining a PvP arena.
TeamInfo teamOf(const World& world, Entity e) {
    Entity current = e;
    for (int hop = 0; hop < kMaxOwnerHops && current != NULL_ENTITY; ++hop) {
        if (const Faction* faction = world.tryGet<Faction>(current)) {
            return {faction->team, faction->friendlyFireEnabled, true};
        }
        current = ownerOf(world, current);
    }
    return {};
}

/// The actor behind a hit: a shot's mob, a petal's flower, a pet's owner.
///
/// Damage arrives from the thing that touched the victim, but "who killed me"
/// has to name something the player recognises -- a projectile handle is
/// already gone by the time the Died message is written.
Entity attributedSource(const World& world, Entity source) {
    Entity current = source;
    for (int hop = 0; hop < kMaxOwnerHops; ++hop) {
        const Entity owner = ownerOf(world, current);
        if (owner == NULL_ENTITY || !world.isAlive(owner)) return current;
        current = owner;
    }
    return current;
}

/// The tier a slow is landing against. Players have no rarity of their own and
/// count as common, so stallPower() neither helps nor hinders a slow on them.
Rarity rarityOf(const World& world, Entity e) {
    if (const MobType* type = world.tryGet<MobType>(e)) return type->rarity;
    if (const Replicated* replicated = world.tryGet<Replicated>(e)) return replicated->rarity;
    return Rarity::Common;
}

/// Whether a projectile should test against this entity at all. Drops, ground
/// effects and other shots are in the broadphase because they have bodies, not
/// because they are targets.
bool isShootable(const World& world, Entity e) {
    return !world.has<DropTag>(e) && !world.has<GroundEffectTag>(e) && !world.has<Projectile>(e);
}

} // namespace

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

struct CombatSystem::Queries {
    explicit Queries(World& world)
        : progress(world), afflicted(world), contact(world), petals(world),
          projectiles(world), fields(world), cooldowns(world) {
        // A corpse stops fighting the instant it is marked, not at the end of
        // the tick when the reaper gets to it -- otherwise a mob killed by the
        // first petal in the ring still gets its contact hit in.
        afflicted.without<Dead>();
        // Petals and projectiles carry their damage in their own config and
        // component; a ContactDamage on either would otherwise be counted a
        // second time by this pass.
        contact.without<PetalInstance, Projectile, Dead>();
        petals.without<Dead>();
        projectiles.without<Dead>();
        fields.without<Dead>();
    }

    Query<PlayerProgress> progress;
    Query<Afflictions, Health> afflicted;
    /// Petals are excluded and handled separately: their damage, reload and
    /// riders all come out of the petal config, and reading it once beats
    /// mirroring six numbers onto every petal entity every tick.
    Query<ContactDamage, Transform, Body> contact;
    Query<PetalInstance, Transform, Body> petals;
    Query<Projectile, Transform, Body, Motion> projectiles;
    Query<GroundEffect, Transform> fields;
    Query<HitCooldowns> cooldowns;
};

CombatSystem::CombatSystem() = default;
CombatSystem::~CombatSystem() = default;

void CombatSystem::bind(World& world) {
    if (boundWorld_ == &world && queries_) return;
    queries_ = std::make_unique<Queries>(world);
    boundWorld_ = &world;
}

// ---------------------------------------------------------------------------
// Faction and credit
// ---------------------------------------------------------------------------

Entity CombatSystem::creditedPlayer(const World& world, Entity source) {
    Entity current = source;
    for (int hop = 0; hop < kMaxOwnerHops && current != NULL_ENTITY; ++hop) {
        if (!world.isAlive(current)) return NULL_ENTITY;
        if (world.has<PlayerTag>(current)) return current;
        current = ownerOf(world, current);
    }
    return NULL_ENTITY;
}

bool CombatSystem::canDamage(const World& world, Entity source, Entity victim) {
    if (victim == NULL_ENTITY || source == victim) return false;

    if (source != NULL_ENTITY) {
        // Resolving BOTH sides to the player behind them covers every
        // self-harm pair at once -- petal vs own flower, pet vs own petal,
        // shot vs the pet that fired it -- without a rule per pair.
        const Entity sourcePlayer = creditedPlayer(world, source);
        if (sourcePlayer != NULL_ENTITY && sourcePlayer == creditedPlayer(world, victim)) {
            return false;
        }
    }

    const TeamInfo attacker = teamOf(world, source);
    const TeamInfo defender = teamOf(world, victim);
    // An entity with no side at all is scenery or a hazard: it hurts, and is
    // hurt by, everything. Refusing here instead would silently disarm any
    // spawner that forgot a Faction.
    if (!attacker.known || !defender.known) return true;
    if (attacker.team != defender.team) return true;
    // Either side being in a PvP region is enough. Requiring both would leave
    // a duellist's pets -- which carry no flag of their own -- unable to fight.
    return attacker.friendlyFire || defender.friendlyFire;
}

bool CombatSystem::canHit(const World& world, Entity victim, Entity source, double nowMillis) {
    if (!world.isAlive(victim) || world.has<Dead>(victim)) return false;
    const Health* health = world.tryGet<Health>(victim);
    if (!health) return false;
    // A body already at zero is a corpse this tick has not reaped yet. Hitting
    // it again would mark it Dead a second time and pay its bounty twice.
    if (health->current <= 0.0) return false;
    if (nowMillis < health->invulnerableUntilMillis) return false;
    return canDamage(world, source, victim);
}

// ---------------------------------------------------------------------------
// The one damage path
// ---------------------------------------------------------------------------

DamageResult CombatSystem::applyDamage(World& world, Entity victim, Entity source,
                                       double amount, double nowMillis, DamageKind kind) {
    DamageResult result;
    // Non-finite damage reaches here from a config that multiplied a zero by
    // an infinity; it must cost a refused hit, not a NaN health bar that no
    // comparison can ever bring back below zero.
    if (!std::isfinite(amount) || amount <= 0.0 || !canHit(world, victim, source, nowMillis)) {
        result.refused = true;
        return result;
    }

    Health& health = world.get<Health>(victim);
    // Clamped to what was actually left, so the ledger records damage dealt
    // rather than damage swung: a 10000 overkill must not take the whole XP
    // share away from everyone who ground the mob down first.
    const double applied = std::min(amount, health.current);
    health.current -= applied;
    if (health.current < 0.0) health.current = 0.0;
    const bool fatal = health.current <= 0.0;
    if (kind == DamageKind::Direct) {
        health.flashUntilMillis = std::max(health.flashUntilMillis, nowMillis + kHurtFlashMillis);
    }
    result.applied = applied;

    const Entity credited = creditedPlayer(world, source);
    if (credited != NULL_ENTITY) {
        if (Bounty* bounty = world.tryGet<Bounty>(victim)) bounty->credit(credited, applied);
    }

    if (kind == DamageKind::Direct && events_ != nullptr) {
        if (const NetId* id = world.tryGet<NetId>(victim)) {
            const Transform* transform = world.tryGet<Transform>(victim);
            events_->damage(id->value, applied, transform ? transform->position : Vec2{});
        }
    }

    if (fatal) {
        // Marked, never destroyed here. Loot, the death notice and replication
        // all still have to read this entity later in the same tick; the
        // reaper is the only thing that removes it.
        //
        // `health` dangles from this line on: adding a component relocates the
        // entity to another archetype.
        const Entity killer = attributedSource(world, source);
        world.add<Dead>(victim, Dead{killer});
        result.killed = true;
        deaths_.push_back({victim, killer, world.has<PlayerTag>(victim)});
        // A player drops nothing: the account keeps the inventory, and the
        // Died message the server sends is the whole of the consequence.
        if (!world.has<PlayerTag>(victim)) awardBounty(world, victim);
    }
    return result;
}

void CombatSystem::awardBounty(World& world, Entity victim) {
    const Bounty* bounty = world.tryGet<Bounty>(victim);
    if (bounty == nullptr || bounty->xp <= 0.0) return;

    double total = 0;
    for (const Bounty::Share& share : bounty->contributors) total += share.damage;
    if (total <= 0.0) return;

    // Copied out: awarding XP can level a player up, and nothing about that is
    // allowed to depend on the corpse's component staying put underneath us.
    const double xp = bounty->xp;
    const std::vector<Bounty::Share> shares = bounty->contributors;
    for (const Bounty::Share& share : shares) {
        PlayerProgress* progress = world.tryGet<PlayerProgress>(share.player);
        if (progress == nullptr) continue;
        // Floored: every XP figure in the game is a whole number, and a
        // fractional total does not land back on the level thresholds.
        const double award = std::floor(xp * (share.damage / total));
        if (award <= 0.0) continue;
        progress->totalXp += award;
        const int level = levelFromTotalXp(progress->totalXp).level;
        if (level != progress->level) {
            progress->level = level;
            progress->leveledThisTick = true;
        }
    }
}

// ---------------------------------------------------------------------------
// Riders: knockback, poison, slow
// ---------------------------------------------------------------------------

void CombatSystem::applyKnockback(World& world, Entity victim, Vec2 offset, double strength) {
    if (!std::isfinite(strength) || strength <= 0.0) return;
    if (!world.isAlive(victim)) return;
    // Only things that move can be pushed. Testing for Motion rather than
    // adding Knockback to everything keeps a nest or a drop out of the
    // archetype churn for a push it would ignore anyway.
    if (!world.has<Motion>(victim)) return;

    const Body* body = world.tryGet<Body>(victim);
    const double mass = (body != nullptr && body->mass > 1e-6) ? body->mass : 1.0;
    Vec2 direction = offset.normalized();
    if (direction.lengthSq() < 1e-12) return;   // exactly co-located: no direction to push along

    const double impulse = std::min(strength * kKnockbackScale / mass, kMaxKnockbackImpulse);
    world.ensure<Knockback>(victim).impulse += direction * impulse;
}

void CombatSystem::applyPoison(World& world, Entity victim, Entity source, double perSecond,
                               double durationMillis, double nowMillis) {
    if (!std::isfinite(perSecond) || perSecond <= 0.0) return;
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;

    // Credited to the PLAYER rather than to the petal that applied it: the
    // petal is often destroyed before the poison finishes ticking, and a kill
    // whose source has been reaped would award nobody anything.
    const Entity credited = creditedPlayer(world, source);
    const Entity attribution = credited != NULL_ENTITY ? credited : source;

    Afflictions& afflictions = world.ensure<Afflictions>(victim);
    if (!afflictions.poisoned(nowMillis)) {
        afflictions.poisonPerSecond = perSecond;
        afflictions.poisonSource = attribution;
        afflictions.poisonUntilMillis = nowMillis + durationMillis;
        return;
    }
    if (perSecond > afflictions.poisonPerSecond) {
        afflictions.poisonPerSecond = perSecond;
        afflictions.poisonSource = attribution;
    }
    afflictions.poisonUntilMillis = std::max(afflictions.poisonUntilMillis, nowMillis + durationMillis);
}

void CombatSystem::applySlow(World& world, Entity victim, double factor, double durationMillis,
                             Rarity sourceRarity, double nowMillis) {
    if (!std::isfinite(factor) || factor >= 1.0) return;
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;

    // stallPower() is the rarity gate: out-tiering a mob buys reliability, not
    // a deeper slow, so it scales how much of the factor lands and nothing else.
    const double power = stallPower(sourceRarity, rarityOf(world, victim));
    const double landed = clamp(1.0 - (1.0 - factor) * power, 0.0, 1.0);
    if (landed >= 1.0) return;

    Afflictions& afflictions = world.ensure<Afflictions>(victim);
    if (!afflictions.slowed(nowMillis)) {
        afflictions.slowFactor = landed;
        afflictions.slowUntilMillis = nowMillis + durationMillis;
        return;
    }
    // Lower factor is a deeper slow, so min() keeps the stronger of the two.
    afflictions.slowFactor = std::min(afflictions.slowFactor, landed);
    afflictions.slowUntilMillis = std::max(afflictions.slowUntilMillis, nowMillis + durationMillis);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

void CombatSystem::run(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                       double nowMillis, double dt, CommandBuffer& commands, EventQueue& events) {
    // Combat's only structural change is the Dead tag, and that one is
    // deliberately immediate rather than deferred: the loot and death passes
    // later in THIS tick are the readers, and a deferred flush lands after
    // them. Nothing here needs the command buffer.
    (void)commands;

    bind(world);
    events_ = &events;
    deaths_.clear();
    ++tick_;

    // Owned here because combat is the only thing that awards XP. Cleared at
    // the top of the phase so replication, which runs later in the same tick,
    // sees precisely this tick's level-ups and no stale ones.
    queries_->progress.each([](Entity, PlayerProgress& progress) {
        progress.leveledThisTick = false;
    });

    // Standing damage first, so a mob that was already dying from poison is
    // dead before the petals that poisoned it swing again -- and its bounty is
    // paid once, by the poison, rather than to whoever happened to touch it.
    tickAfflictions(world, nowMillis, dt);
    tickGroundEffects(world, grid, nowMillis, dt);

    melee_.clear();
    gatherContact(world, content);
    gatherPetals(world, content);
    resolveMelee(world, grid, nowMillis);

    tickProjectiles(world, grid, content, nowMillis, dt);

    if (tick_ % kCooldownPruneTicks == 0) {
        queries_->cooldowns.each([&](Entity, HitCooldowns& cooldowns) { cooldowns.prune(nowMillis); });
    }

    // Not left dangling between ticks: a stray applyDamage() from a test or a
    // later system must not write into an EventQueue that has been cleared.
    events_ = nullptr;
}

void CombatSystem::tickAfflictions(World& world, double nowMillis, double dt) {
    poison_.clear();
    queries_->afflicted.each([&](Entity e, Afflictions& afflictions, Health&) {
        if (afflictions.slowFactor < 1.0 && nowMillis >= afflictions.slowUntilMillis) {
            afflictions.slowFactor = 1.0;
            afflictions.slowUntilMillis = 0;
        }
        if (afflictions.poisonPerSecond <= 0.0) return;
        if (nowMillis < afflictions.poisonUntilMillis) {
            poison_.push_back({e, afflictions.poisonSource, afflictions.poisonPerSecond * dt});
        } else {
            afflictions.poisonPerSecond = 0;
            afflictions.poisonUntilMillis = 0;
            afflictions.poisonSource = NULL_ENTITY;
        }
    });

    for (const PoisonTick& tick : poison_) {
        // A source that has since been reaped becomes environmental damage.
        // Passing the stale handle would be worse than useless: entity slots
        // are recycled, so it could name something on the victim's own side
        // and the poison would quietly stop working.
        const Entity source = world.isAlive(tick.source) ? tick.source : NULL_ENTITY;
        applyDamage(world, tick.victim, source, tick.amount, nowMillis, DamageKind::Periodic);
    }
}

void CombatSystem::tickGroundEffects(World& world, const SpatialGrid& grid,
                                     double nowMillis, double dt) {
    fields_.clear();
    queries_->fields.each([&](Entity e, GroundEffect& effect, Transform& transform) {
        if (effect.radius <= 0.0) return;
        if (effect.damagePerSecond <= 0.0 && effect.slowFactor >= 1.0) return;
        fields_.push_back({e, transform.position, effect.radius, effect.damagePerSecond,
                           effect.slowFactor, effect.rarity});
    });

    for (const FieldSource& field : fields_) {
        if (!world.isAlive(field.effect)) continue;
        grid.query(field.position, field.radius + kBroadphasePad, candidates_);
        for (const Entity victim : candidates_) {
            const Transform* transform = world.tryGet<Transform>(victim);
            if (transform == nullptr) continue;
            // Centre-in-radius, not circle overlap: a field is an area you are
            // standing in, and testing the body edge would let a big mob take
            // radiation damage from a cloud it is only brushing.
            if (distanceSq(transform->position, field.position) > field.radius * field.radius) continue;
            if (!canHit(world, victim, field.effect, nowMillis)) continue;

            applyDamage(world, victim, field.effect, field.damagePerSecond * dt, nowMillis,
                        DamageKind::Periodic);
            // Refreshed every tick while inside, so the linger is the tail
            // after walking out rather than the length of the debuff.
            applySlow(world, victim, field.slowFactor, kGroundEffectSlowLingerMillis,
                      field.rarity, nowMillis);
        }
    }
}

void CombatSystem::gatherContact(World& world, const ContentRegistry& content) {
    queries_->contact.each([&](Entity e, ContactDamage& contact, Transform& transform, Body& body) {
        MeleeSource source;
        source.attacker = e;
        source.position = transform.position;
        source.radius = body.radius;
        source.damage = contact.amount;
        source.hitIntervalMillis = contact.intervalMillis;
        // The push scales with the attacker's mass and is divided back out by
        // the victim's, so what a hit delivers is the ratio between them.
        source.knockback = kContactKnockback * body.mass;

        if (const MobType* type = world.tryGet<MobType>(e)) {
            const MobStats stats = content.mobStats(type->configIndex, type->rarity);
            source.poisonPerSecond = stats.poisonPerSecond;
            source.poisonDurationMillis = stats.poisonDurationMillis;
            source.rarity = type->rarity;
        }
        if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(e)) {
            source.damage *= modifiers->damageScale;
        }
        if (source.damage <= 0.0 && source.poisonPerSecond <= 0.0) return;
        melee_.push_back(source);
    });
}

void CombatSystem::gatherPetals(World& world, const ContentRegistry& content) {
    queries_->petals.each([&](Entity e, PetalInstance& petal, Transform& transform, Body& body) {
        const PetalConfig& config = content.petal(petal.configIndex);
        if (config.noPhysics) return;   // a pure modifier has no body to hit with

        const PetalStats stats = content.petalStats(petal.configIndex, petal.rarity);
        const bool inert = stats.damage <= 0.0 && stats.poisonPerSecond <= 0.0 &&
                           stats.slowFactor >= 1.0 && stats.knockback <= 0.0;
        if (inert) return;

        MeleeSource source;
        source.attacker = e;
        source.position = transform.position;
        source.radius = body.radius;
        source.damage = stats.damage;
        source.hitIntervalMillis = stats.damageIntervalMillis;
        source.knockback = stats.knockback;
        source.poisonPerSecond = stats.poisonPerSecond;
        source.poisonDurationMillis = stats.poisonDurationMillis;
        source.slowFactor = stats.slowFactor;
        source.slowDurationMillis = stats.slowDurationMillis;
        source.rarity = petal.rarity;
        // The flower's damage bonus is a property of the flower, not of the
        // petal entity, so it is read here rather than baked in at spawn --
        // swapping a damage petal in must affect the ring on the same tick.
        if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(petal.owner)) {
            source.damage *= modifiers->damageScale;
        }
        melee_.push_back(source);
    });
}

void CombatSystem::resolveMelee(World& world, const SpatialGrid& grid, double nowMillis) {
    for (const MeleeSource& source : melee_) {
        if (!world.isAlive(source.attacker) || world.has<Dead>(source.attacker)) continue;

        // The grid files each entity under every cell its own radius touches,
        // so a query at the attacker's radius already returns everything whose
        // circle could overlap; the exact test below is the one that decides.
        grid.query(source.position, source.radius + kBroadphasePad, candidates_);
        for (const Entity victim : candidates_) {
            if (victim == source.attacker) continue;
            const Transform* transform = world.tryGet<Transform>(victim);
            const Body* body = world.tryGet<Body>(victim);
            if (transform == nullptr || body == nullptr) continue;

            const Vec2 offset = transform->position - source.position;
            const double reach = source.radius + body->radius;
            if (offset.lengthSq() > reach * reach) continue;
            if (!canHit(world, victim, source.attacker, nowMillis)) continue;

            // Read, do not create: an attacker that has never landed a hit
            // should not pay an archetype move just for being near something.
            const HitCooldowns* armed = world.tryGet<HitCooldowns>(source.attacker);
            if (armed != nullptr && !armed->ready(victim, nowMillis)) continue;

            const DamageResult hit = applyDamage(world, victim, source.attacker,
                                                 source.damage, nowMillis);
            // Poison, slow and knockback ride on the CONTACT, not on the
            // damage number -- a mob whose entire attack is poison deals no
            // direct damage and must still poison. canHit() above is what
            // guarantees the contact was legitimate.
            if (!hit.killed) {
                applyKnockback(world, victim, offset, source.knockback);
                applyPoison(world, victim, source.attacker, source.poisonPerSecond,
                            source.poisonDurationMillis, nowMillis);
                applySlow(world, victim, source.slowFactor, source.slowDurationMillis,
                          source.rarity, nowMillis);
            }

            // Re-fetched, never cached across the calls above: adding Dead or
            // Knockback to the victim relocates archetype rows, and the
            // attacker's own row may be one of the ones that moved.
            world.ensure<HitCooldowns>(source.attacker)
                .arm(victim, nowMillis + std::max(0.0, source.hitIntervalMillis));
        }
    }
}

void CombatSystem::tickProjectiles(World& world, const SpatialGrid& grid,
                                   const ContentRegistry& content, double nowMillis, double dt) {
    shots_.clear();
    queries_->projectiles.each([&](Entity e, Projectile&, Transform& transform, Body& body,
                                   Motion& motion) {
        // Movement has already flown the shot this tick, so the budget spent
        // is the distance it just covered -- not one it is about to.
        shots_.push_back({e, transform.position, body.radius, motion.velocity.length() * dt});
    });

    for (const ShotSource& shot : shots_) {
        if (!world.isAlive(shot.entity) || world.has<Dead>(shot.entity)) continue;
        Projectile* projectile = world.tryGet<Projectile>(shot.entity);
        if (projectile == nullptr) continue;

        projectile->remainingDistance -= shot.travelled;
        if (projectile->remainingDistance <= 0.0) {
            world.add<Dead>(shot.entity);
            continue;
        }
        // Copied before anything structural: the component moves the moment a
        // victim is marked Dead.
        const double damage = projectile->damage;
        const std::uint16_t petalIndex = projectile->petalConfigIndex;
        const Rarity rarity = projectile->rarity;

        grid.query(shot.position, shot.radius + shot.travelled + kBroadphasePad, candidates_);
        Entity target = NULL_ENTITY;
        Vec2 targetOffset;
        double nearestSq = 0;
        for (const Entity victim : candidates_) {
            if (victim == shot.entity || !world.isAlive(victim)) continue;
            if (!isShootable(world, victim)) continue;
            const Transform* transform = world.tryGet<Transform>(victim);
            const Body* body = world.tryGet<Body>(victim);
            if (transform == nullptr || body == nullptr) continue;

            const Vec2 offset = transform->position - shot.position;
            const double reach = shot.radius + body->radius;
            const double distanceSquared = offset.lengthSq();
            if (distanceSquared > reach * reach) continue;
            if (!canHit(world, victim, shot.entity, nowMillis)) continue;
            // Nearest wins. A shot arriving into a clump has to resolve
            // against one of them and the closest is the only answer that does
            // not depend on grid bucket order.
            if (target == NULL_ENTITY || distanceSquared < nearestSq) {
                target = victim;
                targetOffset = offset;
                nearestSq = distanceSquared;
            }
        }
        if (target == NULL_ENTITY) continue;

        const DamageResult hit = applyDamage(world, target, shot.entity, damage, nowMillis);
        if (!hit.killed && petalIndex != kNoPetal) {
            const PetalStats stats = content.petalStats(petalIndex, rarity);
            applyKnockback(world, target, targetOffset, stats.knockback);
            applyPoison(world, target, shot.entity, stats.poisonPerSecond,
                        stats.poisonDurationMillis, nowMillis);
            applySlow(world, target, stats.slowFactor, stats.slowDurationMillis, rarity, nowMillis);
        }
        // One target per shot: a projectile is consumed by what it hits, and
        // the same Dead tag the range check uses is what consumes it.
        if (world.isAlive(shot.entity) && !world.has<Dead>(shot.entity)) {
            world.add<Dead>(shot.entity);
        }
    }
}

} // namespace flr
