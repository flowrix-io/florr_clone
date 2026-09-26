#include "server/systems/combat.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

#include "server/loot_eligibility.h"

namespace flix {

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

/// Whether a flower has been turned hostile to every other flower.
///
/// Corruption is the Flower petal's 5% break outcome and it is symmetric on
/// purpose: a corrupted flower may attack anyone anywhere in the world and
/// anyone may fight it back, because a one-way version would leave it
/// untouchable by everything except mobs.
bool isCorrupted(const World& world, Entity player) {
    if (player == NULL_ENTITY) return false;
    const PlayerVisuals* visuals = world.tryGet<PlayerVisuals>(player);
    return visuals != nullptr && visuals->corrupted;
}

/// Whether one flower's petals may swing at another's.
///
/// The two ways are not the same shape. BOTH duellists must be in the arena --
/// friendlyFireEnabled is the flag the arena sets -- while EITHER side being
/// corrupted is enough. Nothing here looks at distance: the caller only
/// reaches it after an overlap test, and the arena sits far enough from the
/// world that no pair spanning the two could ever touch.
bool canPetalsDamagePlayer(const World& world, Entity attacker, Entity victim) {
    if (isCorrupted(world, attacker) || isCorrupted(world, victim)) return true;
    const Faction* attackerFaction = world.tryGet<Faction>(attacker);
    const Faction* victimFaction = world.tryGet<Faction>(victim);
    return attackerFaction != nullptr && attackerFaction->friendlyFireEnabled &&
           victimFaction != nullptr && victimFaction->friendlyFireEnabled;
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

/// Whether a projectile should test against this entity at all. Drops and
/// ground effects are in the broadphase because they have bodies, not because
/// they are targets.
///
/// Other SHOTS are targets, and deliberately so: two of them meeting is the
/// bullet-vs-bullet rule, and canDamage() is what keeps a volley from
/// detonating against itself -- both shots resolve to the same player or the
/// same team and are refused before any damage is exchanged.
bool isShootable(const World& world, Entity e) {
    return !world.has<DropTag>(e) && !world.has<GroundEffectTag>(e);
}

/// What being hit COSTS the shot that hit it.
///
/// Symmetric with the damage flowing the other way: a shot pays the victim's
/// body damage, and a victim that happens to be another shot charges its own
/// damage stat. That is the whole of penetration -- nothing counts hits, the
/// pool simply runs out.
///
/// A PETAL charges its damage stat, the same way another shot does. A ring
/// eating an incoming volley is a real defence and it has to survive this
/// change: a basic petal's ten points is a common missile's whole pool, so the
/// ring still stops what it always stopped, and only a shot fat enough to
/// outlast it now gets through. It is read off the config rather than off a
/// component because a petal carries no ContactDamage -- the melee pass
/// resolves a ring's damage from the registry too.
///
/// A FLOWER is the exception and returns infinity. It has no body damage to
/// charge with, and post-hit invulnerability means a shot that survived would
/// sit inside the victim until its range expired rather than landing again.
/// Mob shots have always been consumed by the flower they hit, and they still
/// are.
double bodyDamageOf(const World& world, const ContentRegistry& content, Entity victim) {
    if (world.has<PlayerTag>(victim)) return std::numeric_limits<double>::infinity();
    if (const Projectile* shot = world.tryGet<Projectile>(victim)) return shot->damage;
    if (const PetalInstance* petal = world.tryGet<PetalInstance>(victim)) {
        const double damage = content.petalStats(petal->configIndex, petal->rarity).damage;
        return damage > 0.0 ? damage : kProjectileDefaultBodyDamage;
    }
    if (const ContactDamage* contact = world.tryGet<ContactDamage>(victim)) return contact->amount;
    return kProjectileDefaultBodyDamage;
}

/// Fold the live poison stacks back into the scalar summary on Afflictions.
///
/// The stacks are what tick; the summary exists because replication asks
/// Afflictions::poisoned() whether to light the poisoned state bit, and
/// because "how fast is this mob losing health" is worth having in one place.
/// Rates ADD, exactly as poisonStackSystem applies every live stack in turn.
void summarisePoison(Afflictions& afflictions, double nowMillis) {
    double total = 0;
    double until = 0;
    double strongest = 0;
    Entity owner = NULL_ENTITY;
    for (const PoisonStack& stack : afflictions.poisonStacks) {
        if (stack.untilMillis <= nowMillis || stack.perSecond <= 0.0) continue;
        total += stack.perSecond;
        until = std::max(until, stack.untilMillis);
        // Named for the client and for a kill notice, both of which want one
        // culprit; the ledger credit is per stack and does not go through here.
        if (stack.perSecond > strongest) {
            strongest = stack.perSecond;
            owner = stack.source;
        }
    }
    afflictions.poisonPerSecond = total;
    afflictions.poisonUntilMillis = until;
    afflictions.poisonSource = owner;
}

/// The victim radius a ground field reaches with, which is deliberately not
/// the same number for every kind.
///
/// A pollen puff tests the mob's CONFIG radius for its tier -- the reference
/// kept that from the legacy loop and says so at ecsRuntime.ts:745 -- so a mob
/// that rolled a big body is no easier to dust than one that rolled a small
/// one. A web and a uranium cloud test the body that is actually there.
double fieldTargetRadius(const World& world, const ContentRegistry& content, Entity victim,
                         GroundEffectKind kind, const Body* body) {
    if (kind == GroundEffectKind::Poison) {
        if (const MobType* type = world.tryGet<MobType>(victim)) {
            return content.mobStats(type->configIndex, type->rarity).radius;
        }
    }
    return body != nullptr ? body->radius : 0.0;
}

/// What a petal pays to land a hit: the mob's own `damage` stat, which is
/// exactly what its body would have dealt anyway. One, not zero, for a victim
/// carrying no stats at all -- the reference's explicit fallback.
double contactDamageOf(const World& world, Entity mob) {
    const ContactDamage* contact = world.tryGet<ContactDamage>(mob);
    return contact != nullptr ? contact->amount : 1.0;
}

/// What one strike from this mob takes off.
///
/// The spec's own number when it states one, and otherwise the mob's tier-
/// scaled `damage` -- which is what lets a mythic jellyfish shock harder than a
/// common one without a second rarity ladder in mobs.json.
double lightningDamageOf(const MobConfig& config, const MobStats& stats) {
    return config.lightning.damage > 0.0 ? config.lightning.damage : stats.damage;
}

/// The gap between two strikes from this mob: the spec's, else the mob's own
/// attack cadence, else the default. Deliberately NOT rarity-scaled -- neither
/// is the `cooldown` a volley reads.
double lightningCooldownOf(const MobConfig& config) {
    if (config.lightning.cooldownMillis > 0.0) return config.lightning.cooldownMillis;
    if (config.cooldownMillis > 0.0) return config.cooldownMillis;
    return kDefaultLightningCooldownMillis;
}

/// Write a swing into the victim's contributor ledger.
///
/// The number SWUNG, never the number that fitted in the health that was left.
/// trackDamage() stores what the caller computed, and the ledger is what ranks
/// contributors for the mob's four to twenty-five loot slots -- clamping to the
/// remainder would rank whoever lands the killing blow by the sliver they took
/// rather than by the hit they threw, and sort them under the chip damage that
/// softened it up.
void creditSwing(World& world, Entity victim, Entity source, double amount) {
    Bounty* bounty = world.tryGet<Bounty>(victim);
    if (bounty == nullptr) return;
    const Entity credited = CombatSystem::creditedPlayer(world, source);
    if (credited != NULL_ENTITY) bounty->credit(credited, amount);
}

/// Which segment of a shared-health chain holds the pool: the one at the FRONT
/// of whatever is still joined to `e`.
///
/// A leech is one animal, so its health has to be one number, one ledger and
/// one death -- which means one entity has to own all three. The front segment
/// is that entity because it is already the chain's root everywhere else: the
/// AI steers it, the followers trace it, and repairChains() promotes whatever
/// ends up at the front when a leader is lost. Resolving by WALKING rather than
/// by reading `chainHead` is what keeps a half that outlived its head a whole
/// animal instead of a body with no pool.
///
/// Returns `e` itself for anything that is not a shared chain, which is every
/// mob in the game but the leech.
Entity poolOwner(const World& world, Entity e) {
    const BodySegment* segment = world.tryGet<BodySegment>(e);
    if (segment == nullptr || !segment->sharedHealth) return e;

    Entity owner = e;
    // Bounded by the longest chain that can exist, plus the head. A cycle is
    // cut by the AI pass on the tick after it forms, and until then this walk
    // must end rather than spin the tick.
    for (int hop = 0; hop <= kCentipedeSegmentCount; ++hop) {
        const BodySegment* link = world.tryGet<BodySegment>(owner);
        if (link == nullptr || !link->sharedHealth) return owner;
        const Entity ahead = link->ahead;
        // A leader the world has taken away -- despawned off-screen, or reaped
        // after a tick this one somehow survived -- leaves this segment at the
        // front. A leader marked Dead is NOT skipped: the pool is empty and
        // the hit belongs to the corpse, where canHit() refuses it.
        if (ahead == NULL_ENTITY || !world.isAlive(ahead)) return owner;
        owner = ahead;
    }
    return owner;
}

/// What a swing lands on `victim`: `damage`, plus a claw's `critDamage` while
/// the victim is still above kClawCritHealthFraction of its health.
///
/// Asked of the ANIMAL, as every status is: a leech's beads all draw on one
/// pool, and whether the bonus is due is a question about that pool. Read
/// before the hit, so the blow that carries a mob below the line is the last
/// one to get it.
double swingDamage(const World& world, double damage, double critDamage, Entity victim) {
    if (!(critDamage > 0.0)) return damage;
    const Health* health = world.tryGet<Health>(poolOwner(world, victim));
    if (health == nullptr || !(health->max > 0.0)) return damage;
    return health->fraction() > kClawCritHealthFraction ? damage + critDamage : damage;
}

/// Fang's heal: `amount` back onto the flower, never past its max, and through
/// the gates every heal in the game passes -- a dandelion's lockout, and a
/// corpse, which only a revive may stand back up.
void stealLife(World& world, Entity player, double amount, double nowMillis) {
    if (!(amount > 0.0) || !world.isAlive(player) || world.has<Dead>(player)) return;
    if (CombatSystem::healingBlocked(world, player, nowMillis)) return;
    Health* health = world.tryGet<Health>(player);
    if (health == nullptr || !health->alive()) return;
    health->current = std::min(health->max, health->current + amount);
}

} // namespace

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

struct CombatSystem::Queries {
    explicit Queries(World& world)
        : progress(world), afflicted(world), auras(world), contact(world), strikers(world),
          petals(world), projectiles(world), fields(world), cooldowns(world),
          auraCooldowns(world) {
        // A dead flower projects nothing, which is the same guard the
        // reference's pre-movement pass opens with.
        auras.without<Dead>();
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
        strikers.without<Dead>();
    }

    Query<PlayerProgress> progress;
    Query<Afflictions, Health> afflicted;
    /// Flowers that might be wearing a raindrop. Every loadout is walked each
    /// tick rather than cached: a slot's petal, tier and broken flag all change
    /// under the ring pipeline, and ten array reads are cheaper than keeping a
    /// second copy of them honest.
    Query<PlayerTag, Loadout, Transform> auras;
    /// Petals are excluded and handled separately: their damage, reload and
    /// riders all come out of the petal config, and reading it once beats
    /// mirroring six numbers onto every petal entity every tick.
    Query<ContactDamage, Transform, Body> contact;
    /// Mobs that might shock at range. Every mob is walked and the config
    /// decides -- the same trade gatherAuras makes with loadouts: one config
    /// read per mob per tick beats keeping a second copy of the spec honest
    /// through summons, rarity rolls and a hot content reload.
    Query<MobTag, MobType, Transform, Body> strikers;
    Query<PetalInstance, Transform, Body> petals;
    Query<Projectile, Transform, Body, Motion> projectiles;
    Query<GroundEffect, Transform> fields;
    Query<HitCooldowns> cooldowns;
    Query<AuraCooldowns> auraCooldowns;
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

    // Resolving BOTH sides to the player behind them covers every self-harm
    // pair at once -- petal vs own flower, pet vs own petal, shot vs the pet
    // that fired it -- without a rule per pair.
    const Entity sourcePlayer = source != NULL_ENTITY ? creditedPlayer(world, source)
                                                      : NULL_ENTITY;
    const Entity victimPlayer = creditedPlayer(world, victim);
    if (sourcePlayer != NULL_ENTITY && sourcePlayer == victimPlayer) return false;
    // ONE PERSON, HOWEVER MANY BODIES. A splitter gives one connection two
    // flowers, and in the PVP ring -- the one place flowers may hurt each
    // other at all -- the pair would otherwise be duellists: the parked half
    // stands there while the steered one walks its ring through it, and the
    // petal killed you with your own petals. Asked of the CONNECTION rather
    // than of any split bookkeeping, because that is the thing the two bodies
    // actually share and because combat has no business knowing what a
    // splitter is. A bot's connection is 0 and two bots are still enemies.
    if (sourcePlayer != NULL_ENTITY && victimPlayer != NULL_ENTITY) {
        const PlayerAccount* mine = world.tryGet<PlayerAccount>(sourcePlayer);
        const PlayerAccount* theirs = world.tryGet<PlayerAccount>(victimPlayer);
        if (mine != nullptr && theirs != nullptr && mine->connection != 0 &&
            mine->connection == theirs->connection) {
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
    // Corruption is checked on the resolved PLAYER and not on the Faction
    // beside it, because a petal is spawned with a copy of its flower's
    // Faction: a flower corrupted after its ring was strung would otherwise
    // keep swinging harmlessly.
    if (isCorrupted(world, sourcePlayer) || isCorrupted(world, victimPlayer)) return true;
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
    if (!std::isfinite(amount) || amount == 0.0) {
        result.refused = true;
        return result;
    }

    // A shared chain answers as ONE mob from here down: armour, the ledger,
    // the XP, the loot slots and the death all belong to the pool's owner,
    // whichever of its ten bodies the hit actually landed on. Done at the top
    // rather than at the health write so there is no second rule about which
    // of the two entities each of those consequences attaches to.
    //
    // The struck segment is kept for exactly one purpose: the floating number
    // pops where the player hit, not up at the head.
    const Entity struck = victim;
    victim = poolOwner(world, victim);
    if (!canHit(world, victim, source, nowMillis)) {
        // One refusal still pays the ledger. Every reference path writes the
        // contribution BEFORE it tests whether the mob is already dead --
        // trackDamage() at playerState.ts:2751 and creditDamage() at
        // projectileCollision.ts:437 both sit above their `isDead` continue --
        // so a swing that lands on something another petal killed earlier in
        // this same tick still buys its dealer a loot slot. That is the
        // difference between two players sharing a kill and one of them
        // getting nothing.
        //
        // Only that refusal: a same-side hit never reaches trackDamage at all,
        // and there is no ledger left on an entity the reaper has taken.
        const Health* health = world.tryGet<Health>(victim);
        const bool corpse = world.isAlive(victim) && health != nullptr &&
                            (world.has<Dead>(victim) || health->current <= 0.0);
        if (corpse && canDamage(world, source, victim)) {
            creditSwing(world, victim, source, amount);
        }
        result.refused = true;
        return result;
    }

    // TypeScript's mob health writer is `max(0, health - amount)`.  Glitch is
    // authored with negative damage, so its contact deliberately heals mobs;
    // PVP's separate player damage path rejects non-positive values.  Preserve
    // that asymmetry instead of sanitising the content into another petal.
    if (amount < 0.0) {
        if (!world.has<MobTag>(victim)) {
            result.refused = true;
            return result;
        }
        // Negative damage is a HEAL, and a dandelion's lockout refuses it like
        // any other. This is the one heal that arrives down the damage path,
        // which is why the lockout has to be asked here as well as in the
        // petal system -- a lockout that covered every route but this one
        // would be a glitch petal quietly topping up the mob a dandelion is
        // holding down.
        //
        // Only the health WRITE is skipped. The contact still happened, so the
        // swing is not refused: the petal that delivered it flashes the mob
        // and pays for the swing out of its own health exactly as it does when
        // nothing is locked, which is the rule resolveMelee states as "a swing
        // of nothing is still a swing".
        const bool blocked = healingBlocked(world, victim, nowMillis);
        Health& health = world.get<Health>(victim);
        if (!blocked) health.current -= amount;
        if (isDirectHit(kind)) {
            health.flashUntilMillis = std::max(health.flashUntilMillis,
                                               nowMillis + kHurtFlashMillis);
        }
        result.applied = blocked ? 0.0 : amount;
        if (!blocked) creditSwing(world, victim, source, amount);
        mirrorSharedChain(world, victim, false, NULL_ENTITY);
        return result;
    }

    // Evasion: a talisman's wearer or a fly side-steps the hit whole. Ahead of
    // armour, the shield and root's stacks, because a hit that never landed
    // has nothing for any of them to blunt -- root would otherwise spend a
    // stack on a blow that went wide. Direct only: a drip is not an attack.
    if (isDirectHit(kind) && rollDodge(world, victim, nowMillis)) {
        result.dodged = true;
        return result;
    }

    // Armour: the victim's flat reduction on every DIRECT hit, less whatever a
    // bur has stripped. Mobs carry one, and so does a bone petal -- whose
    // armour also comes off the Recoil it pays for its own hits, which is the
    // one blow a petal on the ring routinely takes.
    //
    // DIRECT ONLY, for the reason the shield below is direct-only: poison and a
    // sponge repayment arrive as a per-tick drip -- thirty slivers a second --
    // and a flat subtraction from each of them is not a tax, it is immunity.
    // Armour answers hits; poison is what gets through it.
    //
    // Below zero the subtraction ADDS, which is what a stripped mob is for.
    if (armorBlunts(kind)) {
        const double armor = effectiveArmor(world, victim, nowMillis);
        if (armor != 0.0) amount = std::max(0.0, amount - armor);
    }

    const bool directPlayerHit = isDirectHit(kind) && world.has<PlayerTag>(victim);

    // Root's armour, which is the flower's answer to the Armor a mob carries
    // above -- and the opposite kind of thing. A mob's is a standing property
    // of the mob; a flower's is AMMUNITION the petal system banked, and one
    // stack is spent here to blunt this hit by what the stack is worth.
    //
    // Spent even when it absorbs the blow whole. A stack that survived the
    // hits it stopped would make ten of them a permanent reduction rather
    // than a bank, and the post-hit window below is what keeps a single mob
    // from draining the bank in one tick's worth of contact.
    //
    // Direct only, for the reason the mob's armour is: a flat subtraction
    // from each sliver of a poison drip is immunity, not a tax.
    if (directPlayerHit) {
        if (ArmorStackState* armor = world.tryGet<ArmorStackState>(victim)) {
            if (armor->stacks > 0 && armor->perStack > 0.0) {
                --armor->stacks;
                amount = std::max(0.0, amount - armor->perStack);
            }
        }
    }

    // Shell's shield is a temporary flat reduction per DIRECT hit. It neither
    // depletes nor applies to poison/radiation, matching getShieldAmount() in
    // the TypeScript hit paths.
    if (directPlayerHit) {
        if (ShieldState* shield = world.tryGet<ShieldState>(victim)) {
            if (shield->active(nowMillis)) amount = std::max(0.0, amount - shield->amount);
            else {
                shield->amount = 0;
                shield->untilMillis = 0;
            }
        }
    }
    if (amount <= 0.0) {
        // TypeScript still grants the brief post-hit protection after a shield
        // absorbs the full number; this was a legitimate hit, not a rejected
        // target. Callers therefore still arm their attacker cooldown.
        //
        // The FLOWER only. A mob's invulnerability window is shared by
        // everything attacking it, so granting one here would let the weakest
        // petal in a ring -- the one armour happens to absorb whole -- lock the
        // mob for 50 ms against every other petal and every other player.
        // Nothing but armour can zero a mob's hit, so this is where that would
        // have started.
        if (directPlayerHit) {
            Health& health = world.get<Health>(victim);
            health.invulnerableUntilMillis = std::max(health.invulnerableUntilMillis,
                                                      nowMillis + kPostHitInvulnerabilityMillis);
        }
        return result;
    }

    // Cotton takes what is left of the hit in the flower's place, up to what
    // it has left, and only the overflow goes on. After armour and the shield,
    // so a cotton is never spent on the part of a blow those two would have
    // stopped anyway; ahead of the sponge, which would otherwise defer the
    // whole hit and leave the cotton nothing to catch.
    //
    // Direct only, like everything else a flower wears against hits: a poison
    // drip would wear a cotton down a sliver at a time and leave it broken for
    // the blow it is there for.
    if (directPlayerHit) {
        amount = soakIntoCotton(world, victim, source, amount, nowMillis, kind);
        if (amount <= 0.0) {
            // Caught whole. The flower still earns the post-hit window a
            // shield-absorbed hit does, or mob contact -- paced by that window
            // and nothing else -- would strip the cotton on the very next tick.
            // Re-fetched: a cotton breaking relocates rows.
            Health& health = world.get<Health>(victim);
            health.invulnerableUntilMillis = std::max(health.invulnerableUntilMillis,
                                                      nowMillis + kPostHitInvulnerabilityMillis);
            return result;
        }
    }

    if (directPlayerHit) {
        const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(victim);
        const double durationMillis = modifiers ? modifiers->spongeDamageDurationMillis : 0.0;
        if (durationMillis > 0.0) {
            SpongeDamageEffect effect;
            effect.remainingDamage = amount;
            effect.damagePerSecond = amount / (durationMillis / 1000.0);
            effect.source = source;
            world.ensure<SpongeDamageState>(victim).effects.push_back(effect);
            Health& health = world.get<Health>(victim);
            health.invulnerableUntilMillis =
                std::max(health.invulnerableUntilMillis,
                         nowMillis + kPostHitInvulnerabilityMillis);
            return result;
        }
    }

    Health& health = world.get<Health>(victim);
    // What the health bar actually lost, which is what the caller is told and
    // what the floating number reads. The LEDGER is credited the full swing
    // instead -- see creditSwing().
    const double applied = std::min(amount, health.current);
    health.current -= applied;
    if (health.current < 0.0) health.current = 0.0;
    bool fatal = health.current <= 0.0;
    if (isDirectHit(kind)) {
        health.flashUntilMillis = std::max(health.flashUntilMillis, nowMillis + kHurtFlashMillis);
    }
    result.applied = applied;
    if (directPlayerHit) {
        health.invulnerableUntilMillis =
            std::max(health.invulnerableUntilMillis,
                     nowMillis + kPostHitInvulnerabilityMillis);
    }

    // Second Chance turns a killing blow on a flower into 1 HP. It is asked
    // here rather than at the call sites because every lethal path in the game
    // funnels through this function, where the reference has to remember to
    // ask on five of them -- one of which is a poison tick.
    //
    // `health` dangles from this call on: the lockout is a component, and
    // adding one relocates the victim's row.
    if (fatal && trySecondChance(world, victim, nowMillis)) fatal = false;

    creditSwing(world, victim, source, amount);

    // Every kind narrates itself. A poison tick and a sponge repayment reach
    // the reference's client as ordinary damage on the same two channels a
    // petal hit does -- markPoisonDamaged() and emitPlayerDamaged() -- and the
    // client already colours and offsets a poison number away from the petal
    // hit that landed in the same tick, so nothing is buried by reporting one.
    //
    // Those two channels are also the WHOLE of it: `enemiesDamaged` carries
    // mobs and `playerDamaged` carries flowers, and nothing else in the world
    // is ever narrated. A petal paying for its own swing therefore loses
    // health silently, which is what setInstanceHealth() does.
    if (events_ != nullptr && (world.has<MobTag>(victim) || world.has<PlayerTag>(victim))) {
        // Reported against the body that was HIT. For everything but a leech
        // that is the victim itself; for a leech it is the segment the petal
        // touched, so the number rises off the bead the player is looking at
        // while the pool it came out of lives up at the head.
        const Entity shown = world.isAlive(struck) ? struck : victim;
        if (const NetId* id = world.tryGet<NetId>(shown)) {
            const Transform* transform = world.tryGet<Transform>(shown);
            std::uint8_t flags{0};
            if (kind == DamageKind::Poison) flags |= net::DamagePoison;
            // Every strike in the game reaches here as DamageKind::Lightning --
            // the petal cutter's burst, a jellyfish's reach and a firefly's
            // touch alike -- so the cyan is decided once, where the number is
            // reported, rather than at each of the three triggers.
            if (kind == DamageKind::Lightning) flags |= net::DamageLightning;
            events_->damage(id->value, applied, transform ? transform->position : Vec2{},
                            transform ? transform->realm : Realm::Overworld, flags);
        }
    }

    // A dandelion sheds a seed when it is hit. Booked here rather than fired
    // here: letting one go retires an entity and creates another, and the
    // damage path is walked by every system that deals any. The mob AI pass
    // pays it off (see MobAiSystem::tickPetalRings).
    //
    // DIRECT hits only, so the poison already on a dandelion does not empty it
    // thirty times a second, and never a fatal one -- a corpse fires nothing.
    // Capped at the seats it HAS rather than the seats still filled: counting
    // the live ones means walking the ring on every hit, and the pass that
    // spends the debt drops whatever it cannot fill anyway.
    if (isDirectHit(kind) && !fatal) {
        if (MobPetalRing* ring = world.tryGet<MobPetalRing>(victim)) {
            if (ring->pending < static_cast<int>(ring->seats.size())) ++ring->pending;
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
        mirrorSharedChain(world, victim, true, killer);
        return result;
    }
    mirrorSharedChain(world, victim, false, NULL_ENTITY);
    return result;
}

// ---------------------------------------------------------------------------
// Shared segment health
// ---------------------------------------------------------------------------

void CombatSystem::mirrorSharedChain(World& world, Entity owner, bool fatal, Entity killer) {
    const BodySegment* head = world.tryGet<BodySegment>(owner);
    if (head == nullptr || !head->sharedHealth) return;
    const Health* pool = world.tryGet<Health>(owner);
    if (pool == nullptr) return;

    // Read the pool out before anything structural happens below, and walk the
    // chain into a list for the same reason: adding Dead to a segment moves it
    // to another archetype and invalidates every column pointer this walk
    // would otherwise still be holding.
    const double fraction = pool->fraction();
    const double flashUntil = pool->flashUntilMillis;

    chainScratch_.clear();
    Entity at = head->behind;
    for (int hop = 0; hop < kCentipedeSegmentCount && at != NULL_ENTITY; ++hop) {
        if (!world.isAlive(at)) break;
        const BodySegment* link = world.tryGet<BodySegment>(at);
        if (link == nullptr || !link->sharedHealth) break;
        chainScratch_.push_back(at);
        at = link->behind;
    }

    for (const Entity segment : chainScratch_) {
        if (Health* health = world.tryGet<Health>(segment)) {
            // By FRACTION, not by the number: the pool is the owner's bar, and
            // a segment authored with a different max would otherwise show a
            // bar that disagrees with the animal it belongs to. What the client
            // is sent is the fraction anyway.
            health->current = health->max * fraction;
            health->flashUntilMillis = std::max(health->flashUntilMillis, flashUntil);
        }
        if (!fatal || world.has<Dead>(segment)) continue;
        // One animal, one death. The segments carry no contributor ledger --
        // every swing was credited to the pool's owner -- so they pay no XP,
        // reserve no loot slot and enter nobody's kill gallery. They are the
        // body of a mob that has already paid out, and this is what takes them
        // off the map with it.
        world.add<Dead>(segment, Dead{killer});
        deaths_.push_back({segment, killer, false});
    }
}

void CombatSystem::awardBounty(World& world, Entity victim) {
    const Bounty* bounty = world.tryGet<Bounty>(victim);
    if (bounty == nullptr || bounty->xp <= 0.0) return;

    // TypeScript ranks positive contributors and grants the mob's FULL XP to
    // each eligible looter; it does not divide one pool in damage proportion.
    // The ranking itself is the loot system's -- one rule, so the players a
    // corpse pays XP to are exactly the ones it reserves its drops for, squads
    // included.
    std::vector<Bounty::Share> shares;
    for (const Bounty::Share& share : bounty->contributors) {
        if (share.damage > 0.0 && world.has<PlayerTag>(share.player)) shares.push_back(share);
    }
    std::stable_sort(shares.begin(), shares.end(),
                     [](const Bounty::Share& a, const Bounty::Share& b) {
                         return a.damage > b.damage;
                     });
    Rarity rarity = Rarity::Common;
    if (const MobType* type = world.tryGet<MobType>(victim)) rarity = type->rarity;
    const Health* health = world.tryGet<Health>(victim);
    std::vector<Entity> recipients;
    selectLootRecipients(shares, lootSlotsForRarity(rarity), squads, recipients,
                         lootDamageFloor(health != nullptr ? health->max : 0.0));

    // Every recipient is paid the mob's full XP -- the corpse is not split
    // between them, and no account earns at a different rate than another.
    const double xp = std::round(bounty->xp);
    for (const Entity recipient : recipients) {
        PlayerProgress* progress = world.tryGet<PlayerProgress>(recipient);
        if (progress == nullptr) continue;
        progress->totalXp += xp;
        // The arena leaderboard counts the XP earned inside the ring
        // (src/server/playerManager.ts:929); a flower outside it has no score.
        if (ArenaScore* arena = world.tryGet<ArenaScore>(recipient)) arena->score += xp;
        const int level = levelFromTotalXp(progress->totalXp).level;
        if (level != progress->level) {
            progress->level = level;
            progress->leveledThisTick = true;

            // Level-up stat recalculation and full heal happen immediately in
            // addXPToPlayer(), before the death broadcast. Waiting for next
            // tick's petal pass leaves one snapshot with the new level and old
            // health/damage.
            const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(recipient);
            const double healthScale = modifiers ? modifiers->maxHealthScale : 1.0;
            const Transform* at = world.tryGet<Transform>(recipient);
            const bool arena = at != nullptr && at->realm == Realm::Arena;
            if (Health* health = world.tryGet<Health>(recipient)) {
                // The ring's pool is flat (PVP_MAX_HEALTH); a level gained in
                // it still heals, as the reference's level-up does.
                health->max = arena ? kArenaMaxHealth
                                    : std::round(maxHealthForLevel(level) * healthScale);
                health->current = health->max;
            }
            if (ContactDamage* contact = world.tryGet<ContactDamage>(recipient)) {
                // The worn cutter's bonus rides along, or the level-up would
                // strip it until the next petal pass folded it back on.
                contact->amount = bodyDamageForLevel(level) +
                                  (modifiers ? modifiers->bodyDamageBonus : 0.0);
            }
        }
    }
}

bool CombatSystem::trySecondChance(World& world, Entity victim, double nowMillis) {
    if (!world.has<PlayerTag>(victim)) return false;
    // Skills are disabled inside the PvP arena, and friendly fire is the only
    // thing that marks a flower as being in one.
    if (const Faction* faction = world.tryGet<Faction>(victim)) {
        if (faction->friendlyFireEnabled) return false;
    }
    const PlayerSkillTree* tree = world.tryGet<PlayerSkillTree>(victim);
    if (tree == nullptr) return false;
    // {window, lockout}, and {0, 0} for a tier the talent does not define --
    // the reference's `if (!duration) return false` makes those a no-op rather
    // than an extrapolation, so a corrupt record cannot buy immortality.
    const std::array<double, 2> effect = secondChanceEffect(tree->skills.level(SkillId::SecondChance));
    if (effect[0] <= 0.0) return false;

    // ensure(), not tryGet(): a flower that has never been saved carries no
    // lockout, and the first save is exactly where one starts.
    SecondChance& lockout = world.ensure<SecondChance>(victim);
    if (nowMillis < lockout.readyAtMillis) return false;
    lockout.readyAtMillis = nowMillis + effect[1];

    Health& health = world.get<Health>(victim);
    health.current = 1.0;
    // The talent's window replaces the 50 ms post-hit one rather than adding
    // to it; every tier is longer, so taking the later of the two is the same
    // rule stated without a special case.
    health.invulnerableUntilMillis = std::max(health.invulnerableUntilMillis,
                                              nowMillis + effect[0]);
    return true;
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

    // This mirrors playerState.ts exactly: `effectiveKnockback` is the petal
    // stat divided by mob mass, and setMobKnockback() REPLACES the old vector.
    // It is a positional offset, consumed by movement next tick -- no scale,
    // friction or second mass division is involved.
    world.ensure<Knockback>(victim).impulse = direction * (strength / mass);
}

namespace {

/// A flower is shoved out of a contact by moving it 25 units immediately: the
/// same fixed displacement whether a mob walked into it or another duellist's
/// petal swung at it, neither mass-scaled nor turned into velocity. For mob
/// contact it happens before the damage/invulnerability branch, so an
/// invulnerable player still gets bumped. Petal knockback on a MOB deliberately
/// does not use this path: that one is queued for the mob's next movement pass.
void applyMobContactKnockback(World& world, Entity player, Vec2 offset) {
    Transform* transform = world.tryGet<Transform>(player);
    if (transform == nullptr) return;
    const Vec2 direction = offset.normalized();
    if (direction.lengthSq() < 1e-12) return;
    transform->position += direction * kMobContactKnockback;
}

/// A glitch mob's touch -- body or shot -- leaves the flower glitched.
///
/// Infection is a property of TOUCH, not of damage: playerState.ts sets it
/// beside the contact bump and above the invulnerability branch, and
/// server.ts's projectile hook sets it before the damage it may then refuse.
/// So the callers place this outside the hit gates, and the mark lands on a
/// flower that is bouncing off the mob during respawn protection too. It is
/// never cleared here: the bit lives on PlayerVisuals until the body is
/// despawned, which is what keeps a corpse glitched, and a respawn is a fresh
/// entity. A plain field write, so it is safe inside a candidate loop that
/// must not relocate archetype rows.
void markGlitched(World& world, Entity player) {
    if (PlayerVisuals* visuals = world.tryGet<PlayerVisuals>(player)) visuals->glitched = true;
}

} // namespace

void CombatSystem::applyPoison(World& world, Entity victim, Entity source, double perSecond,
                               double durationMillis, double nowMillis) {
    if (!std::isfinite(perSecond) || perSecond <= 0.0) return;
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    // A status lands on the ANIMAL, and a shared chain is one animal: poison
    // dripped into the tail has to tick against the pool the tail draws on, or
    // it is a bite the leech never feels. See poolOwner().
    victim = poolOwner(world, victim);
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;

    // Credited to the PLAYER rather than to the petal that applied it: the
    // petal is often destroyed before the poison finishes ticking, and a kill
    // whose source has been reaped would award nobody anything.
    const Entity credited = creditedPlayer(world, source);
    const Entity attribution = credited != NULL_ENTITY ? credited : source;

    const double untilMillis = nowMillis + durationMillis;
    Afflictions& afflictions = world.ensure<Afflictions>(victim);

    // A flower carries exactly one bite, refreshed rather than accumulated:
    // playerState.ts overwrites poisonDamage and poisonUntil outright, so a
    // common mob's nip replaces a mythic's and may even shorten it.
    if (world.has<PlayerTag>(victim)) {
        afflictions.poisonPerSecond = perSecond;
        afflictions.poisonSource = attribution;
        afflictions.poisonUntilMillis = untilMillis;
        return;
    }

    afflictions.pruneStacks(nowMillis);
    if (PoisonStack* existing = afflictions.stackFrom(attribution)) {
        // gardn's outlast rule: a fresh bite takes over only when it would
        // last longer, and then it carries its own rate in with it. Without
        // the guard a short weak poison stomps a long strong one; without the
        // rate coming along, a long weak one silently keeps the strong rate.
        if (existing->untilMillis < untilMillis) {
            existing->perSecond = perSecond;
            existing->untilMillis = untilMillis;
        }
    } else {
        afflictions.poisonStacks.push_back({attribution, perSecond, untilMillis});
    }
    summarisePoison(afflictions, nowMillis);
}

void CombatSystem::applySlow(World& world, Entity victim, double factor, double durationMillis,
                             Rarity sourceRarity, double nowMillis) {
    if (!std::isfinite(factor) || factor >= 1.0) return;
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    // The head is also the only body a slow could possibly mean: the segments
    // do not steer, they trace whatever is in front of them.
    victim = poolOwner(world, victim);
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;
    // A flower is never slowed by anything. applyMobSlow() is the reference's
    // one and only slow implementation -- both the petal bridge and the web
    // field resolve to it -- and it opens by refusing anything without
    // MobKind, so no web, honey petal or pincer has ever cost a player speed.
    //
    // The guard is not academic here: a thrown web outlives the flower that
    // threw it by up to ten seconds, and an orphaned one loses its side along
    // with its owner, which makes it a hazard that hurts everything. Without
    // this it would halve the speed of whoever walked through it.
    if (!world.has<MobTag>(victim)) return;

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

void CombatSystem::slowFlower(World& world, Entity victim, double factor,
                              double durationMillis, double nowMillis) {
    if (!std::isfinite(factor) || factor >= 1.0) return;
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    if (!world.isAlive(victim) || !world.has<PlayerTag>(victim)) return;
    // No rarity gate: a flower has no tier of its own and counts as common,
    // where stallPower() is 1 for every source.
    const double landed = clamp(factor, 0.0, 1.0);

    Afflictions& afflictions = world.ensure<Afflictions>(victim);
    if (!afflictions.webbed(nowMillis)) {
        afflictions.webbedFactor = landed;
        afflictions.webbedUntilMillis = nowMillis + durationMillis;
        return;
    }
    afflictions.webbedFactor = std::min(afflictions.webbedFactor, landed);
    afflictions.webbedUntilMillis =
        std::max(afflictions.webbedUntilMillis, nowMillis + durationMillis);
}

void CombatSystem::applyArmorShred(World& world, Entity victim, double amount,
                                   double nowMillis) {
    if (!std::isfinite(amount) || amount <= 0.0) return;
    // A status lands on the ANIMAL, and a shared chain is one animal: a bur
    // that stripped only the tail it touched would strip armour nothing reads,
    // because the damage path bills the pool's owner. See poolOwner().
    victim = poolOwner(world, victim);
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;
    // Armour is a mob stat, so a strip is a mob debuff. A petal landing on
    // another flower in the arena takes nothing off it, and an orphaned bur
    // cannot follow a slow's old bug into hurting whoever walks past.
    if (!world.has<MobTag>(victim)) return;

    // Deepest wins, expiry never comes closer -- applySlow's rule, for the
    // reason Afflictions::armorShred gives: a strip that ACCUMULATED across
    // every contact of a spinning ring would have no bound at all.
    Afflictions& afflictions = world.ensure<Afflictions>(victim);
    if (nowMillis >= afflictions.armorShredUntilMillis) afflictions.armorShred = 0.0;
    afflictions.armorShred = std::max(afflictions.armorShred, amount);
    afflictions.armorShredUntilMillis =
        std::max(afflictions.armorShredUntilMillis, nowMillis + kArmorShredMillis);
}

void CombatSystem::applyNoHeal(World& world, Entity victim, double durationMillis,
                               double nowMillis) {
    if (!std::isfinite(durationMillis) || durationMillis <= 0.0) return;
    // A status lands on the ANIMAL, and a shared chain is one animal: the
    // lockout is asked of whoever owns the pool, so a lock on the tail alone
    // would be a dandelion that never holds a leech down. See poolOwner().
    victim = poolOwner(world, victim);
    if (!world.isAlive(victim) || !world.has<Health>(victim)) return;

    // Longest wins and the expiry never comes closer, the rule the slow and
    // the armour strip above both run on. There is no strength to dilute --
    // healing is either locked or it is not -- so this is the whole of it.
    Afflictions& afflictions = world.ensure<Afflictions>(victim);
    afflictions.noHealUntilMillis =
        std::max(afflictions.noHealUntilMillis, nowMillis + durationMillis);
}

bool CombatSystem::healingBlocked(const World& world, Entity entity, double nowMillis) {
    const Afflictions* afflictions = world.tryGet<Afflictions>(entity);
    return afflictions != nullptr && afflictions->healBlocked(nowMillis);
}

double CombatSystem::effectiveArmor(const World& world, Entity victim, double nowMillis) {
    const Armor* armor = world.tryGet<Armor>(victim);
    if (armor == nullptr) return 0.0;
    const Afflictions* afflictions = world.tryGet<Afflictions>(victim);
    const double shred = afflictions != nullptr ? afflictions->shred(nowMillis) : 0.0;
    // Not clamped at zero: past it the mob takes EXTRA, which is the whole
    // reason a bur strips 1.5x what the tier it matches is wearing.
    return armor->amount - shred;
}

double CombatSystem::evasionOf(const World& world, Entity victim) {
    if (const Evasion* evasion = world.tryGet<Evasion>(victim)) return evasion->chance;
    if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(victim)) {
        return modifiers->evasion;
    }
    return 0.0;
}

bool CombatSystem::rollDodge(World& world, Entity victim, double nowMillis) {
    const double evasion = evasionOf(world, victim);
    // Nothing is drawn for a victim that cannot dodge, so the stream only
    // moves when evasion is actually in the fight.
    if (!(evasion > 0.0) || !rng_.chance(evasion)) return false;
    // A miss still spends the attack. Mob contact on a flower is paced by the
    // post-hit window and nothing else, so a miss that left it shut would be
    // retried on the very next tick and a 3% dodge would dodge nothing. The
    // flower only, for the reason the shield-absorbed branch gives: a mob's
    // window is shared by every petal and every player attacking it.
    if (world.has<PlayerTag>(victim)) {
        Health& health = world.get<Health>(victim);
        health.invulnerableUntilMillis =
            std::max(health.invulnerableUntilMillis, nowMillis + kPostHitInvulnerabilityMillis);
    }
    return true;
}

double CombatSystem::soakIntoCotton(World& world, Entity flower, Entity source, double amount,
                                    double nowMillis, DamageKind kind) {
    const Loadout* loadout = world.tryGet<Loadout>(flower);
    if (loadout == nullptr || !(amount > 0.0)) return amount;

    // Gathered before the first is struck: a cotton the hit breaks is marked
    // Dead, which relocates rows while the ring's list would still be walked.
    //
    // One per SLOT. Every instance of a shared-pool slot mirrors the whole
    // pool, so taking a share from two of them would spend it twice; the
    // fold at the top of the next tick is what tells them apart again.
    cottonScratch_.clear();
    std::array<bool, kLoadoutSlots> seen{};
    for (const Entity petal : loadout->spawned) {
        const PetalInstance* instance = world.tryGet<PetalInstance>(petal);
        if (instance == nullptr || !instance->soaksOwnerDamage) continue;
        if (instance->slot >= kLoadoutSlots || seen[instance->slot]) continue;
        // One this tick has already broken, or one spent by being used, has
        // nothing left to catch with.
        if (world.has<Dead>(petal)) continue;
        const Health* health = world.tryGet<Health>(petal);
        if (health == nullptr || health->current <= 0.0) continue;
        seen[instance->slot] = true;
        cottonScratch_.push_back(petal);
    }

    // In ring order, each taking what it can and passing the rest on: a second
    // cotton catches what overflowed the first before any of it reaches the
    // flower.
    for (const Entity cotton : cottonScratch_) {
        if (!(amount > 0.0)) break;
        const Health* health = world.tryGet<Health>(cotton);
        if (health == nullptr || health->current <= 0.0) continue;
        const double caught = std::min(amount, health->current);
        // An ordinary hit on the petal: it flashes, it breaks, its own armour
        // applies, and the slot reloads by the one path every petal does.
        // What the FLOWER is spared is the whole of `caught` either way.
        const DamageResult hit = applyDamage(world, cotton, source, caught, nowMillis, kind);
        if (hit.refused || hit.dodged) continue;
        amount -= caught;
    }
    return amount;
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

    beginTick(world, nowMillis, dt, events);
    runContactPhase(world, grid, content, nowMillis);
    runWorldPhase(world, grid, content, nowMillis, dt);
}

void CombatSystem::beginTick(World& world, double nowMillis, double dt, EventQueue& events) {
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
    // This is the reference's order too: registerAfflictionSystems lands in
    // Phase.Combat ahead of registerMobCollisionSystem, and says so
    // (src/server/ecsRuntime.ts:651-654, "legacy ticked poison before the
    // melee pass"). Do not move it behind contact.
    tickAfflictions(world, nowMillis, dt);
    tickSpongeDamage(world, nowMillis, dt);
}

void CombatSystem::runContactPhase(World& world, const SpatialGrid& grid,
                                   const ContentRegistry& content, double nowMillis) {
    melee_.clear();
    auras_.clear();
    mobContactedPlayers_.clear();
    // The raindrop field runs in updatePlayerPreMovement, ahead of the movement
    // window and therefore ahead of the flower's own body and ring contact. It
    // matters: a mob the field finishes off is already Dead when the ring
    // swings, so the ring neither hits it again nor is credited for it.
    gatherAuras(world, content);
    resolveAuras(world, grid, nowMillis);
    gatherContact(world, content);
    gatherPetals(world, content);
    resolveMelee(world, grid, nowMillis);
}

void CombatSystem::tickMobLightning(World& world, const SpatialGrid& grid,
                                    const ContentRegistry& content, double nowMillis) {
    gatherMobLightning(world, content);
    resolveMobLightning(world, grid, nowMillis);
}

void CombatSystem::runWorldPhase(World& world, const SpatialGrid& grid,
                                 const ContentRegistry& content, double nowMillis, double dt) {
    // TypeScript advances projectiles and then world fields after mobs move.
    // Damage fields are commutative within this phase, while projectile impact
    // remains the discrete collision whose post-movement position matters.
    // Lightning at range goes here, after the mobs have moved: a jellyfish
    // shocks from where it IS rather than from where it was, and the positions
    // the client is sent to draw arms to are the ones this tick's snapshot
    // carries. The other trigger -- a firefly's touch -- fires in the contact
    // phase above, where the collision it needs is resolved.
    tickMobLightning(world, grid, content, nowMillis);
    tickProjectiles(world, grid, content, nowMillis, dt);
    tickGroundEffects(world, grid, content, nowMillis, dt);

    if (tick_ % kCooldownPruneTicks == 0) {
        queries_->cooldowns.each([&](Entity, HitCooldowns& cooldowns) { cooldowns.prune(nowMillis); });
        // The reference drops a mob's aura timestamps the moment it leaves the
        // world (forgetEnemyFromRaindropAura) because the map is keyed by mob
        // id and would otherwise grow by one entry per mob ever seen in range.
        // A deadline sweep is the same rule: every entry is stale 500 ms after
        // it was written, whether or not the mob it names still exists.
        queries_->auraCooldowns.each([&](Entity, AuraCooldowns& cooldowns) {
            cooldowns.hits.prune(nowMillis);
        });
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
        if (afflictions.webbedFactor < 1.0 && nowMillis >= afflictions.webbedUntilMillis) {
            afflictions.webbedFactor = 1.0;
            afflictions.webbedUntilMillis = 0;
        }
        // Armour grows back. Afflictions::shred() already reads zero past the
        // expiry, so this is housekeeping rather than the rule -- it keeps a
        // mob that was stripped an hour ago from carrying the number, and keeps
        // an inspector's dump honest about what is actually on it.
        if (afflictions.armorShred != 0.0 && nowMillis >= afflictions.armorShredUntilMillis) {
            afflictions.armorShred = 0.0;
            afflictions.armorShredUntilMillis = 0;
        }
        // A mob holds one stack per poisoning player and EVERY one of them
        // ticks, so three flowers running blue_iris on the same boss deal
        // three times the damage and each is credited its own share. A single
        // slot would keep only the strongest, which loses the other two their
        // XP and loot ranking as well as their damage.
        if (!afflictions.poisonStacks.empty()) {
            afflictions.pruneStacks(nowMillis);
            for (const PoisonStack& stack : afflictions.poisonStacks) {
                if (stack.perSecond > 0.0) {
                    poison_.push_back({e, stack.source, stack.perSecond * dt});
                }
            }
            summarisePoison(afflictions, nowMillis);
            return;
        }

        if (afflictions.poisonPerSecond <= 0.0) return;
        if (nowMillis < afflictions.poisonUntilMillis) {
            // Poison armor is a flower's modifier, and the scalar slot is the
            // flower's path -- a mob never reaches this branch.
            double dps = afflictions.poisonPerSecond;
            if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(e)) {
                dps = std::max(0.0, dps - modifiers->poisonArmor);
            }
            if (dps > 0.0) poison_.push_back({e, afflictions.poisonSource, dps * dt});
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
        // A mob's poison is reported purple and nudged sideways so it cannot
        // land under the petal hit that arrived in the same tick. A flower's
        // is reported in the ordinary colour: playerDamaged carries one number
        // for every cause, and the reference has never tinted one of them.
        const DamageKind kind = world.has<PlayerTag>(tick.victim) ? DamageKind::Periodic
                                                                  : DamageKind::Poison;
        applyDamage(world, tick.victim, source, tick.amount, nowMillis, kind);
    }
}

void CombatSystem::tickSpongeDamage(World& world, double nowMillis, double dt) {
    spongeTicks_.clear();
    Query<SpongeDamageState, Health> deferred{world};
    deferred.without<Dead>();
    deferred.each([&](Entity player, SpongeDamageState& state, Health& health) {
        // TypeScript pauses the repayment while any invulnerability is live;
        // it does not silently consume that portion of the stored hit.
        if (nowMillis < health.invulnerableUntilMillis) return;

        std::size_t kept = 0;
        for (SpongeDamageEffect& effect : state.effects) {
            const double amount = std::min(effect.remainingDamage,
                                           effect.damagePerSecond * std::max(0.0, dt));
            if (amount > 0.0) {
                spongeTicks_.push_back({player, effect.source, amount});
                effect.remainingDamage -= amount;
            }
            if (effect.remainingDamage > 0.001) state.effects[kept++] = effect;
        }
        state.effects.resize(kept);
    });

    for (const PoisonTick& tick : spongeTicks_) {
        const Entity source = world.isAlive(tick.source) ? tick.source : NULL_ENTITY;
        applyDamage(world, tick.victim, source, tick.amount, nowMillis, DamageKind::Periodic);
    }
}

void CombatSystem::tickGroundEffects(World& world, const SpatialGrid& grid,
                                     const ContentRegistry& content, double nowMillis, double dt) {
    fields_.clear();
    queries_->fields.each([&](Entity e, GroundEffect& effect, Transform& transform) {
        if (effect.radius <= 0.0) return;
        // A strike's burst is a pollen puff in every respect the field pass
        // cares about -- same reach rule, same rim rule, same once-per-victim
        // chip -- and differs only in the colour of the number it reports.
        const DamageKind hitKind = world.has<LightningBurst>(e) ? DamageKind::Lightning
                                                                : DamageKind::Direct;
        fields_.push_back({e, effect.kind, hitKind, transform.position, effect.radius,
                           effect.damagePerSecond, effect.slowFactor, effect.rarity,
                           effect.damagePerHit, effect.damageIntervalMillis, transform.realm,
                           effect.slowsFlowers});
    });

    for (const FieldSource& field : fields_) {
        if (!world.isAlive(field.effect)) continue;
        if (Lifetime* lifetime = world.tryGet<Lifetime>(field.effect)) {
            lifetime->remainingSeconds -= dt;
            if (lifetime->remainingSeconds <= 0.0) {
                world.add<Dead>(field.effect);
                continue;
            }
        }
        if (field.damagePerSecond <= 0.0 && field.damagePerHit <= 0.0 &&
            field.slowFactor >= 1.0) continue;
        grid.query(field.realm, field.position, field.radius + kBroadphasePad, candidates_);
        for (const Entity victim : candidates_) {
            const Transform* transform = world.tryGet<Transform>(victim);
            if (transform == nullptr) continue;
            // Circle overlap, not centre-in-radius: every one of the three
            // reference fields adds the victim's own radius to its reach, so a
            // boss whose body edge is in the cloud is irradiated even though
            // its centre is 200 units outside it. A centre test shrinks the
            // effective area against a big mob by (r/(r+R))^2, which is most of
            // a web's or a puff's job.
            const Body* body = world.tryGet<Body>(victim);
            const double reach =
                field.radius + fieldTargetRadius(world, content, victim, field.kind, body);
            const double gapSq = distanceSq(transform->position, field.position);
            // The uranium pulse excludes on a strict `>` (playerState.ts:2686)
            // where pollen and web exclude on `>=` (groundEffects.ts:163, :231),
            // so a victim touching at exactly the rim is irradiated but is
            // neither dusted nor webbed.
            const bool inside = field.kind == GroundEffectKind::Radiation
                                    ? gapSq <= reach * reach
                                    : gapSq < reach * reach;
            if (!inside) continue;
            if (!canHit(world, victim, field.effect, nowMillis)) continue;

            if (field.damagePerHit > 0.0 && world.has<MobTag>(victim) &&
                !world.has<Pet>(victim)) {
                const HitCooldowns* cooldowns = world.tryGet<HitCooldowns>(field.effect);
                if (cooldowns == nullptr || cooldowns->ready(victim, nowMillis)) {
                    // A discrete chip, not a drip: a puff bites once every
                    // 500 ms and a lightning burst exactly once. The reference
                    // reports both through markEnemyDamaged(), the ordinary
                    // hit channel, and credits them through creditDamage(),
                    // which provokes a neutral mob. Direct is how a C++ chip
                    // buys both of those -- the flash it also lights is what
                    // steerAggressive reads as "something just hurt me".
                    const DamageResult hit = applyDamage(world, victim, field.effect,
                                                         field.damagePerHit, nowMillis,
                                                         field.hitKind);
                    if (!hit.refused) {
                        world.ensure<HitCooldowns>(field.effect)
                            .arm(victim, nowMillis + field.damageIntervalMillis);
                    }
                }
            } else if (field.damagePerSecond > 0.0) {
                applyDamage(world, victim, field.effect, field.damagePerSecond * dt, nowMillis,
                            DamageKind::Periodic);
            }
            // Refreshed every tick while inside, so the linger is the tail
            // after walking out rather than the length of the debuff.
            if (field.slowsFlowers && world.has<PlayerTag>(victim)) {
                slowFlower(world, victim, field.slowFactor, kGroundEffectSlowLingerMillis,
                           nowMillis);
            } else {
                applySlow(world, victim, field.slowFactor, kGroundEffectSlowLingerMillis,
                          field.rarity, nowMillis);
            }
        }
    }
}

void CombatSystem::gatherAuras(World& world, const ContentRegistry& content) {
    // One name lookup for the whole pass. The registry is a hash map and every
    // flower would otherwise pay for it once per equipped slot.
    const std::uint16_t raindrop = content.petalIndex("raindrop");
    if (raindrop == kNoPetal) return;

    queries_->auras.each([&](Entity e, PlayerTag&, Loadout& loadout, Transform& transform) {
        // Damage and radius are maximised INDEPENDENTLY, which is what the
        // reference does: two raindrops of different tiers give the better
        // number of each rather than the better petal's pair.
        double bestDamage = 0;
        double bestRadius = 0;
        for (int i = 0; i < kLoadoutActiveSlots; ++i) {
            const LoadoutSlot& slot = loadout.slots[static_cast<std::size_t>(i)];
            if (slot.configIndex != raindrop) continue;
            // A broken raindrop's field switches off until the slot reloads,
            // and raindrop reloads slowly, so this is a visible outage rather
            // than a technicality.
            if (slot.broken) continue;
            bestDamage = std::max(bestDamage, content.petalStats(raindrop, slot.rarity).damage);
            bestRadius = std::max(bestRadius,
                                  kRaindropAuraBaseRadius +
                                      rarityIndex(slot.rarity) * kRaindropAuraRadiusPerRarity);
        }
        if (bestRadius <= 0.0 || bestDamage <= 0.0) return;

        // The field is petal output, so it takes the petal curve -- the same
        // multiplier the ring's own contact takes, not the flower's body one.
        const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(e);
        auras_.push_back({e, transform.position, bestRadius,
                          bestDamage * (modifiers != nullptr ? modifiers->petalDamageScale : 1.0),
                          transform.realm});
    });
}

void CombatSystem::resolveAuras(World& world, const SpatialGrid& grid, double nowMillis) {
    for (const AuraSource& aura : auras_) {
        if (!world.isAlive(aura.player) || world.has<Dead>(aura.player)) continue;

        grid.query(aura.realm, aura.position, aura.radius + kBroadphasePad, candidates_);
        for (const Entity victim : candidates_) {
            // Pets are not in the reference's enemy grid at all, so the field
            // sweeps wild mobs and never the flower's own summons.
            if (!world.has<MobTag>(victim) || world.has<Pet>(victim)) continue;
            if (!world.isAlive(victim) || world.has<Dead>(victim)) continue;
            const Transform* transform = world.tryGet<Transform>(victim);
            if (transform == nullptr) continue;

            // Circle overlap against the mob's LIVE radius, excluding on
            // exactly touching -- the field's own test, not the pollen puff's
            // config-radius one.
            const Body* body = world.tryGet<Body>(victim);
            const double reach = aura.radius + (body != nullptr ? body->radius : 0.0);
            if (distanceSq(transform->position, aura.position) >= reach * reach) continue;

            const AuraCooldowns* armed = world.tryGet<AuraCooldowns>(aura.player);
            if (armed != nullptr && !armed->hits.ready(victim, nowMillis)) continue;
            // Stamped before the hit and regardless of what the hit does, as
            // the reference stamps it: dwelling in the field costs a chip every
            // 500 ms rather than one on every tick of contact.
            world.ensure<AuraCooldowns>(aura.player)
                .hits.arm(victim, nowMillis + kRaindropAuraDamageIntervalMillis);
            applyDamage(world, victim, aura.player, aura.damage, nowMillis);
        }
    }
}

void CombatSystem::gatherContact(World& world, const ContentRegistry& content) {
    queries_->contact.each([&](Entity e, ContactDamage& contact, Transform& transform, Body& body) {
        MeleeSource source;
        source.attacker = e;
        source.position = transform.position;
        source.realm = transform.realm;
        source.radius = body.radius;
        source.damage = contact.amount;
        source.hitIntervalMillis = contact.intervalMillis;
        source.isMobBody = world.has<MobTag>(e);
        source.isPet = world.has<Pet>(e);
        source.isPlayerBody = world.has<PlayerTag>(e);
        // A seed of a mob's ring is a piece of that mob's body, so it hits
        // like one: the fixed 25-unit displacement, and the one-contact-per-
        // tick rule shared with the hull, so an animal wearing ten of them
        // still only touches a flower once a tick. It brings the ring PETAL's
        // own riders along, resolved at spawn -- a dandelion's seed head locks
        // healing exactly as its loose seeds do.
        if (const MobRingPetal* seed = world.tryGet<MobRingPetal>(e)) {
            source.isMobRing = true;
            source.noHealDurationMillis = seed->noHealDurationMillis;
        }
        // Contact with a mob moves a player by the fixed TypeScript 25-unit
        // displacement; resolveMelee handles that special case directly.
        source.knockback = 0.0;

        if (const MobType* type = world.tryGet<MobType>(e)) {
            const MobConfig& config = content.mob(type->configIndex);
            const MobStats stats = content.mobStats(type->configIndex, type->rarity);
            source.poisonPerSecond = stats.poisonPerSecond;
            source.poisonDurationMillis = stats.poisonDurationMillis;
            source.rarity = type->rarity;
            source.glitchInfecting = config.glitchInfecting;
            if (config.lightning.present && config.lightning.onContact) {
                // Past the BODY. A flower touching this mob has its centre a
                // whole body radius away, so a reach measured from the centre
                // stops reaching the very thing that triggered it as soon as
                // the mob is bigger than the reach -- which an ultra firefly
                // is. See LightningSpec::radius.
                source.lightningRadius = body.radius + config.lightning.radius;
                source.lightningDamage = lightningDamageOf(config, stats);
                source.lightningCooldownMillis = lightningCooldownOf(config);
            }
        }
        if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(e)) {
            source.damage *= modifiers->damageScale;
        }
        // recalculatePlayerStats() stores the flower's body damage ROUNDED and
        // every contact hit deals exactly that integer, so a level-10 flower
        // with the rare Damage talent hits for 44 rather than 44.4 and a mob
        // sitting on an exact health boundary dies on the same hit it dies on
        // in the reference. Mob contact damage is unrounded on both sides.
        if (source.isPlayerBody) source.damage = std::round(source.damage);
        // A body that does nothing on contact is not gathered -- but a shock IS
        // something it does, so a mob whose whole weapon is the strike still
        // reaches resolveMelee rather than being dropped for dealing no bump.
        if (source.damage <= 0.0 && source.poisonPerSecond <= 0.0 &&
            source.lightningRadius <= 0.0) {
            return;
        }
        melee_.push_back(source);
    });
}

void CombatSystem::gatherPetals(World& world, const ContentRegistry& content) {
    queries_->petals.each([&](Entity e, PetalInstance& petal, Transform& transform, Body& body) {
        const PetalConfig& config = content.petal(petal.configIndex);
        if (config.noPhysics) return;   // a pure modifier has no body to hit with

        const PetalStats stats = content.petalStats(petal.configIndex, petal.rarity);
        const bool inert = stats.damage <= 0.0 && stats.critDamage <= 0.0 &&
                           stats.poisonPerSecond <= 0.0 && stats.slowFactor >= 1.0 &&
                           stats.knockback <= 0.0 && stats.armorReduction <= 0.0 &&
                           stats.noHealDurationMillis <= 0.0;
        if (inert) return;

        MeleeSource source;
        source.attacker = e;
        source.position = transform.position;
        source.realm = transform.realm;
        source.radius = body.radius;
        source.damage = stats.damage;
        source.hitIntervalMillis = stats.damageIntervalMillis;
        source.knockback = stats.knockback;
        source.poisonPerSecond = stats.poisonPerSecond;
        source.poisonDurationMillis = stats.poisonDurationMillis;
        source.slowFactor = stats.slowFactor;
        source.slowDurationMillis = stats.slowDurationMillis;
        source.noHealDurationMillis = stats.noHealDurationMillis;
        source.armorReduction = stats.armorReduction;
        source.critDamage = stats.critDamage;
        source.lifesteal = stats.lifesteal;
        source.owner = petal.owner;
        source.rarity = petal.rarity;
        source.isPetal = true;
        if (config.lightningDamage) source.hitKind = DamageKind::Lightning;
        // The flower's damage bonus is a property of the flower, not of the
        // petal entity, so it is read here rather than baked in at spawn --
        // swapping a damage petal in must affect the ring on the same tick.
        //
        // The PETAL curve, not the body one. getDamageMultiplier() puts
        // everything a petal does -- ring contact, a shot, a puff, a pulse --
        // on the steep effect table, where a body slam takes the gentle stat
        // table; sharing one factor costs a fully talented ring most of its
        // damage.
        //
        // A claw's bonus is petal damage too, and takes the same curve.
        if (const PlayerModifiers* modifiers = world.tryGet<PlayerModifiers>(petal.owner)) {
            source.damage *= modifiers->petalDamageScale;
            source.critDamage *= modifiers->petalDamageScale;
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
        grid.query(source.realm, source.position, source.radius + kBroadphasePad, candidates_);
        for (const Entity victim : candidates_) {
            if (victim == source.attacker) continue;
            const Transform* transform = world.tryGet<Transform>(victim);
            const Body* body = world.tryGet<Body>(victim);
            if (transform == nullptr || body == nullptr) continue;

            // A petal only ever bleeds inside its OWN hit block, below. The
            // reference has no mob-vs-petal collision at all, so letting a mob
            // body melee the ring as well would charge the exchange twice.
            // A MOB's ring seed is not a PetalInstance and is deliberately
            // not covered by this: it is a body, and bodies collide.
            if (!source.isPetal && world.has<PetalInstance>(victim)) continue;

            if (source.isPetal && world.has<PlayerTag>(victim)) {
                // Flower vs flower is a wholly separate collision in the
                // reference -- applyPvpDamage() has exactly one caller, and it
                // is the petal loop -- with its own gate, its own throttle and
                // its own cost to the petal.
                resolvePetalPvp(world, source, victim, transform->position, body->radius,
                                nowMillis);
                continue;
            }
            // A flower's body never hurts another flower, whatever side the
            // two are on: resolvePlayerMobContact walks the ENEMY grid, so
            // another flower is not a candidate for it in the first place.
            if (source.isPlayerBody && world.has<PlayerTag>(victim)) continue;

            // A pet and a wild mob meet in the separation kernel's contact
            // list, which is built with the same gap the kernel keeps between
            // bodies rather than at exact circle overlap.
            const bool petPair = source.isMobBody && world.has<MobTag>(victim) &&
                                 source.isPet != world.has<Pet>(victim);

            const Vec2 offset = transform->position - source.position;
            const double reach = source.radius + body->radius +
                                 (petPair ? kMobCollisionBuffer : 0.0);
            if (offset.lengthSq() > reach * reach) continue;

            // A TypeScript mob bump is independent of damage: it still lands
            // during respawn invulnerability, is not throttled by the damage
            // cooldown, and occurs before a lethal hit is handled.
            const bool mobTouchesPlayer = (source.isMobBody || source.isMobRing) &&
                                          world.has<PlayerTag>(victim) &&
                                          !world.has<Dead>(victim) &&
                                          world.has<Health>(victim) &&
                                          canDamage(world, source.attacker, victim);
            if (mobTouchesPlayer) {
                // resolvePlayerMobContact() breaks after its first collision:
                // one flower wedged in a pile takes one hit/bump per tick, not
                // a full stack. Preserve that rule across C++'s source-first
                // combat loop.
                if (std::find(mobContactedPlayers_.begin(), mobContactedPlayers_.end(), victim) !=
                    mobContactedPlayers_.end()) {
                    continue;
                }
                mobContactedPlayers_.push_back(victim);
                applyMobContactKnockback(world, victim, offset);
                if (source.glitchInfecting) markGlitched(world, victim);

                // A firefly discharges on the tick its body reaches a flower.
                //
                // Here, ABOVE the body's own hit, on purpose. Both land on the
                // same flower on the same tick and the first of them opens the
                // 50 ms post-hit window that refuses the second, so whichever
                // goes first is the one the player feels -- and a firefly whose
                // shock is silently eaten by its own bump is a firefly that
                // never shocks anybody.
                //
                // Nothing about being HIT reaches this block: a petal landing
                // on the firefly is the other direction through resolveMelee
                // and throws nothing, which is the whole difference between a
                // firefly and a thorn.
                if (source.lightningRadius > 0.0) {
                    // Read before it is created: a mob that has never struck
                    // should not pay an archetype move just for touching
                    // somebody while it is still charging.
                    const LightningClock* clock = world.tryGet<LightningClock>(source.attacker);
                    if (clock == nullptr ||
                        nowMillis - clock->lastStrikeMillis >= source.lightningCooldownMillis) {
                        world.ensure<LightningClock>(source.attacker).lastStrikeMillis = nowMillis;
                        // From the MOB, not from the flower it touched: the
                        // bolt lands where the firefly is, and the flowers
                        // standing around it are inside the same flash.
                        strikeLightning(world, grid, source.attacker, source.position,
                                        source.realm, source.lightningRadius,
                                        source.lightningDamage, nowMillis);
                    }
                }
            }

            if (!canHit(world, victim, source.attacker, nowMillis)) continue;

            // Almost nothing is throttled in the reference, and the throttle
            // that survives is not keyed the way a hit ledger usually is.
            //
            // Mob body contact is paced by the victim's own 50 ms post-hit
            // window and by nothing else; pet/wild contact by nothing at all;
            // a flower's body by nothing. Only a petal whose config names a
            // `damageCooldown` waits, and that wait is keyed on the petal
            // INSTANCE with no victim in the key -- one glass petal lands one
            // hit per window however many mobs it is sitting on, rather than
            // one per mob, which would make it a full-rate area attack.
            const double interval = (mobTouchesPlayer || petPair)
                                        ? 0.0
                                        : std::max(0.0, source.hitIntervalMillis);
            // Read, do not create: an attacker that has never landed a hit
            // should not pay an archetype move just for being near something.
            const HitCooldowns* armed =
                interval > 0.0 ? world.tryGet<HitCooldowns>(source.attacker) : nullptr;
            if (armed != nullptr &&
                !(source.isPetal ? armed->globalReady(nowMillis) : armed->ready(victim, nowMillis))) {
                continue;
            }

            // A claw's bonus is decided here, per victim, off the health the
            // victim has BEFORE this hit.
            const double swing = swingDamage(world, source.damage, source.critDamage, victim);
            DamageResult hit =
                applyDamage(world, victim, source.attacker, swing, nowMillis, source.hitKind);
            // A swing of NOTHING is still a swing. canHit() has already vouched
            // for this victim one line above -- alive, not a corpse, not
            // invulnerable, on the other side -- so the only refusal
            // applyDamage can add here is a damage figure of zero, and several
            // petals carry one deliberately: iris and blue_iris are pure
            // poison, bubble and bomb pure utility. The reference never looks
            // at the number; it applies every rider and charges the petal its
            // own health BELOW damageMob(), so a zero-damage petal poisons,
            // shoves and wears out exactly like any other. Read as a refusal,
            // those four petals landed nothing at all and never broke.
            //
            // It can still MISS. applyDamage refuses a zero before it rolls
            // evasion, so the roll for one is made here -- an iris is an attack
            // like any other, and a fly that could not side-step the one petal
            // that needs no damage to kill it would not be evasive at all.
            const bool zeroSwing = source.isPetal && swing == 0.0;
            if (zeroSwing && hit.refused && rollDodge(world, victim, nowMillis)) {
                hit.dodged = true;
            }
            // A miss lands nothing, costs the petal nothing -- it touched
            // nothing -- and still spends the pacing below, as a swing does.
            const bool landed = !hit.dodged && (!hit.refused || zeroSwing);
            // Petal knockback is set after the hit using its own stat and the
            // victim's mass, exactly like playerState.ts. Mob contact already
            // performed its fixed player displacement above.
            //
            // Every rider sits BELOW the reference's already-dead `continue`
            // and inside its not-invulnerable branch, so a refused hit lands
            // none of them: it credits the ledger and nothing else.
            if (landed && !hit.killed) {
                if (source.isPetal) {
                    applyKnockback(world, victim, offset, source.knockback);
                }
                applyPoison(world, victim, source.attacker, source.poisonPerSecond,
                            source.poisonDurationMillis, nowMillis);
                applySlow(world, victim, source.slowFactor, source.slowDurationMillis,
                          source.rarity, nowMillis);
                applyNoHeal(world, victim, source.noHealDurationMillis, nowMillis);
                // A rider like the other two, and for the same reason it has to
                // be: armour can absorb a bur's own damage whole, and a strip
                // that only landed when the damage did would be a petal that
                // cannot counter the one thing it exists to counter. `landed`
                // covers that -- a swing of nothing is still a swing.
                applyArmorShred(world, victim, source.armorReduction, nowMillis);
            }

            // Fang: the flower drinks a fraction of what the hit actually took
            // off -- the health bar's loss, not the swing, so armour and
            // overkill cost it exactly what they cost the hit. A killing blow
            // still took something, and still feeds.
            if (source.lifesteal > 0.0 && hit.applied > 0.0) {
                stealLife(world, source.owner, hit.applied * source.lifesteal, nowMillis);
            }

            // The petal pays for the hit out of its own health, at the mob's
            // full damage stat, in the same block and on the same tick as the
            // damage it dealt. This IS the reload cycle: a ring that hits
            // thirty times a second and never bleeds is unbreakable, and the
            // break/reload rhythm is most of what paces the fight.
            //
            // Exempt for a petal that names a `damageCooldown` -- glass and
            // infinity never break on contact. Recoil rather than Direct, so
            // the ring does not flash white for a cost the reference pays
            // silently -- but it is a blow as far as armour goes, and a bone
            // shrugs off the part of the bite its armour covers. The floating
            // number takes care of itself: a petal is on neither of the
            // reference's two damage-report channels.
            if (landed && source.isPetal && source.hitIntervalMillis <= 0.0 &&
                world.has<MobTag>(victim)) {
                applyDamage(world, source.attacker, victim, contactDamageOf(world, victim),
                            nowMillis, DamageKind::Recoil);
            }

            // Re-fetched, never cached across the calls above: adding Dead or
            // Knockback to the victim relocates archetype rows, and the
            // attacker's own row may be one of the ones that moved.
            if (interval > 0.0) {
                HitCooldowns& cooldowns = world.ensure<HitCooldowns>(source.attacker);
                if (source.isPetal) cooldowns.armGlobal(nowMillis + interval);
                else cooldowns.arm(victim, nowMillis + interval);
            }

            // The other half of the one-per-tick contact rule, for the
            // direction mobContactedPlayers_ cannot see. resolvePlayerMobContact
            // breaks out of its candidate loop on the first LIVE mob it
            // collides with, so a flower's body lands one hit per tick however
            // many mobs it is wedged between -- a corpse it is also touching
            // costs it nothing, because that candidate is skipped rather than
            // ending the loop, which is what canHit() refusing above does.
            if (source.isPlayerBody && !hit.refused) break;
        }
    }
}

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

void CombatSystem::strikeLightning(World& world, const SpatialGrid& grid, Entity source, Vec2 at,
                                   Realm realm, double radius, double damage, double nowMillis) {
    if (radius <= 0.0 || !(damage > 0.0)) return;

    grid.query(realm, at, radius + kBroadphasePad, strikeCandidates_);
    strikeVictims_.clear();
    strikeArms_.clear();
    for (const Entity victim : strikeCandidates_) {
        if (victim == source) continue;
        // Flowers only, stated outright rather than left to the faction rule.
        // A mob's shock is aimed at what it is fighting; washing over the mobs
        // beside it would turn a jellyfish shoal into a mutual suicide pact,
        // and canDamage() would not have stopped that on its own -- it lets
        // anything through whose side it cannot resolve.
        if (!world.has<PlayerTag>(victim)) continue;
        const Transform* transform = world.tryGet<Transform>(victim);
        if (transform == nullptr || transform->realm != realm) continue;
        // Centres inside the disc. The stricter of the two rules a field could
        // use -- it does not add the victim's own radius -- so every arm drawn
        // ends on a flower that was certainly inside the flash.
        if (distanceSq(transform->position, at) > radius * radius) continue;
        // Asked here rather than left to applyDamage so that a teammate is not
        // given a bolt to look at. canHit() is deliberately NOT what is asked:
        // a flower inside its respawn window is still standing in the strike
        // and still gets an arm, and applyDamage refuses the damage on its own.
        if (!canDamage(world, source, victim)) continue;
        strikeVictims_.push_back(victim);
        strikeArms_.push_back(transform->position);
    }
    if (strikeVictims_.empty()) return;

    // Reported BEFORE the damage lands, and from positions read before it
    // lands: a strike can kill, replication drops a dead entity in the same
    // tick, and a bolt to the flower it just felled is exactly the bolt to
    // draw. This is why the arms ride the event instead of the client working
    // them out from its entity table.
    if (events_ != nullptr) {
        // Nearest first, and only when there are more than fit -- the same
        // rule a petal's strike trims by, for the same reason: a plain
        // truncation takes whatever order the archetypes hold, which is a
        // direction rather than a disc. The DAMAGE list is not trimmed; every
        // flower inside the radius is hit whether or not an arm was drawn.
        if (strikeArms_.size() > net::kMaxLightningTargets) {
            std::partial_sort(strikeArms_.begin(),
                              strikeArms_.begin() + net::kMaxLightningTargets,
                              strikeArms_.end(), [at](const Vec2& a, const Vec2& b) {
                                  return distanceSq(a, at) < distanceSq(b, at);
                              });
            strikeArms_.resize(net::kMaxLightningTargets);
        }
        events_->lightning(at, radius, realm, strikeArms_);
    }

    // Entities, not pointers: applyDamage can mark a flower Dead, which
    // relocates the row every Transform* above came out of.
    for (const Entity victim : strikeVictims_) {
        applyDamage(world, victim, source, damage, nowMillis, DamageKind::Lightning);
    }
}

void CombatSystem::gatherMobLightning(World& world, const ContentRegistry& content) {
    strikers_.clear();
    queries_->strikers.each([&](Entity e, MobTag&, MobType& type, Transform& transform,
                                Body& body) {
        const MobConfig& config = content.mob(type.configIndex);
        if (!config.lightning.present || config.lightning.strikeRange <= 0.0) return;
        // A pet is a mob a flower summoned, and a strike only ever aims at
        // flowers. Letting one through would mean a summon that electrocutes
        // its owner, which is what canDamage then has to refuse -- once per
        // broadphase query, every tick, forever.
        if (world.has<Pet>(e)) return;
        LightningSource striker;
        striker.mob = e;
        striker.position = transform.position;
        // Both reaches are stated against the skin -- see LightningSpec. An
        // ultra jellyfish is 315 units across; measured from its centre its
        // 300-unit shock never left its own body and it could not hurt a flower
        // standing on top of it, let alone one nearby.
        striker.radius = body.radius + config.lightning.radius;
        striker.damage = lightningDamageOf(config, content.mobStats(type.configIndex, type.rarity));
        striker.strikeRange = body.radius + config.lightning.strikeRange;
        striker.cooldownMillis = lightningCooldownOf(config);
        striker.realm = transform.realm;
        strikers_.push_back(striker);
    });
}

void CombatSystem::resolveMobLightning(World& world, const SpatialGrid& grid, double nowMillis) {
    for (const LightningSource& striker : strikers_) {
        if (!world.isAlive(striker.mob) || world.has<Dead>(striker.mob)) continue;
        // The clock first: it is the cheap half, and a mob still charging is
        // spared the broadphase query entirely. Read, not created -- a mob that
        // has never struck pays no archetype move for standing in an empty sea.
        const LightningClock* clock = world.tryGet<LightningClock>(striker.mob);
        if (clock != nullptr && nowMillis - clock->lastStrikeMillis < striker.cooldownMillis) {
            continue;
        }
        // Something has to be in reach before a strike is thrown. Without this
        // the mob would flash on its cooldown forever with nothing to hit,
        // which is a bolt on every client's screen once a second per jellyfish.
        if (!playerWithin(world, grid, striker.mob, striker.position, striker.realm,
                          striker.strikeRange, nowMillis)) {
            continue;
        }
        // Stamped before the strike and whatever the strike turns out to do,
        // exactly as every other cooldown here is stamped: a shock that lands
        // on a flower already inside its respawn window still costs the charge.
        world.ensure<LightningClock>(striker.mob).lastStrikeMillis = nowMillis;
        strikeLightning(world, grid, striker.mob, striker.position, striker.realm, striker.radius,
                        striker.damage, nowMillis);
    }
}

bool CombatSystem::playerWithin(World& world, const SpatialGrid& grid, Entity mob, Vec2 at,
                                Realm realm, double range, double nowMillis) {
    grid.query(realm, at, range + kBroadphasePad, strikeCandidates_);
    for (const Entity candidate : strikeCandidates_) {
        if (!world.has<PlayerTag>(candidate)) continue;
        const Transform* transform = world.tryGet<Transform>(candidate);
        if (transform == nullptr || transform->realm != realm) continue;
        if (distanceSq(transform->position, at) > range * range) continue;
        // The full hit test, not just the faction one: a corpse and a flower
        // still inside its respawn window are both standing there, and neither
        // is a reason to spend a charge. A strike ALREADY under way still
        // washes over them -- see strikeLightning.
        if (!canHit(world, candidate, mob, nowMillis)) continue;
        return true;
    }
    return false;
}

void CombatSystem::resolvePetalPvp(World& world, const MeleeSource& source, Entity victim,
                                   Vec2 victimPosition, double victimRadius, double nowMillis) {
    const PetalInstance* petal = world.tryGet<PetalInstance>(source.attacker);
    if (petal == nullptr) return;
    const Entity owner = petal->owner;
    // The reference skips its own flower by id and its splitter half by socket
    // -- one person, however many bodies. The native server has no splitter, so
    // resolving the ring back to its owner is the whole of that rule here, and
    // it is the only thing standing between a corrupted flower and its own ring.
    if (owner == victim) return;
    if (!canPetalsDamagePlayer(world, owner, victim)) return;

    // Exclusive, and exactly co-located misses: the reference skips on
    // `distSqP >= minDistSq || distSqP <= 0`, so two flowers standing on the
    // same pixel trade nothing until one of them moves.
    const Vec2 offset = victimPosition - source.position;
    const double reach = source.radius + victimRadius;
    const double gapSq = offset.lengthSq();
    if (gapSq >= reach * reach || gapSq <= 0.0) return;

    // Keyed on the VICTIM here, where the same petal's window against mobs is
    // keyed on the instance alone: the reference's PvP key carries the other
    // flower's id, so one petal reaches two duellists in a tick and neither of
    // them twice. A petal that declares a `damageCooldown` brings its own.
    const double interval = source.hitIntervalMillis > 0.0 ? source.hitIntervalMillis
                                                           : kPvpPetalHitIntervalMillis;
    const HitCooldowns* armed = world.tryGet<HitCooldowns>(source.attacker);
    if (armed != nullptr && !armed->ready(victim, nowMillis)) return;
    // Stamped before the swing and whatever the swing turns out to do, which
    // is where the reference stamps it: a petal that swings at an invulnerable
    // flower still waits its 250 ms, and still pays for the swing below.
    world.ensure<HitCooldowns>(source.attacker).arm(victim, nowMillis + interval);

    // A claw opens on a fresh duellist exactly as it opens on a fresh mob.
    const double swing = swingDamage(world, source.damage, source.critDamage, victim);
    const DamageResult hit =
        applyDamage(world, victim, source.attacker, swing, nowMillis, source.hitKind);
    // And a fang drinks from one: what the victim's bar lost, never what a
    // shield, a cotton or a sponge took instead.
    if (source.lifesteal > 0.0 && hit.applied > 0.0) {
        stealLife(world, owner, hit.applied * source.lifesteal, nowMillis);
    }
    // Away from the FLOWER rather than from the petal: applyPvpDamage measures
    // from the attacker's own centre, and a spinning ring puts its petals on
    // the far side of the victim half the time. A refused swing -- dead,
    // invulnerable, same side -- shoves nobody, because the reference returns
    // above its knockback.
    if (!hit.refused && !hit.dodged && world.isAlive(owner)) {
        if (const Transform* attacker = world.tryGet<Transform>(owner)) {
            applyMobContactKnockback(world, victim, victimPosition - attacker->position);
        }
    }
    // The duel is where this petal earns its place: a flower that cannot heal
    // for ten seconds has lost its rose, its passive regeneration and its
    // yggdrasil at once. Gated on the same refusal the shove is -- a swing at
    // an invulnerable flower locks nothing, and neither does one it dodged.
    if (!hit.refused && !hit.dodged) {
        applyNoHeal(world, victim, source.noHealDurationMillis, nowMillis);
    }

    // A flat point, never the victim's damage stat, and charged whatever the
    // swing did: the reference pays it outside applyPvpDamage's early returns,
    // so a swing at an invulnerable flower still wears the ring down. Skipped
    // only for a petal that declares a `damageCooldown` -- the same exemption
    // that makes glass and infinity unbreakable against mobs. The environment
    // is the source because the reference attributes this to nobody, and
    // naming the victim would let their own faction refuse the cost.
    if (source.hitIntervalMillis <= 0.0) {
        applyDamage(world, source.attacker, NULL_ENTITY, kPvpPetalSelfDamage, nowMillis,
                    DamageKind::Periodic);
    }
}

void CombatSystem::tickProjectiles(World& world, const SpatialGrid& grid,
                                   const ContentRegistry& content, double nowMillis, double dt) {
    shots_.clear();
    queries_->projectiles.each([&](Entity e, Projectile& projectile, Transform& transform,
                                   Body& body, Motion& motion) {
        // Movement has already flown the shot this tick, so the budget spent
        // is the distance it just covered -- not one it is about to.
        shots_.push_back({e, transform.position, projectile.lastPosition, body.radius,
                          motion.velocity.length() * dt, body.mass, motion.velocity.length(),
                          transform.realm});
    });

    for (const ShotSource& shot : shots_) {
        if (!world.isAlive(shot.entity) || world.has<Dead>(shot.entity)) continue;
        Projectile* projectile = world.tryGet<Projectile>(shot.entity);
        if (projectile == nullptr) continue;

        // MovementSystem already spent the distance budget while flying the
        // shot. Subtracting the same travel again halves every projectile's
        // configured range.
        if (projectile->remainingDistance <= 0.0) {
            world.add<Dead>(shot.entity);
            continue;
        }
        // Copied before anything structural: the component moves the moment a
        // victim is marked Dead.
        const double damage = projectile->damage;
        const std::uint16_t petalIndex = projectile->petalConfigIndex;
        const Rarity rarity = projectile->rarity;
        const bool infecting = projectile->glitchInfecting;
        // A blueberry's shot lands as lightning, exactly as its body does.
        const DamageKind hitKind =
            petalIndex != kNoPetal && content.petal(petalIndex).lightningDamage
                ? DamageKind::Lightning
                : DamageKind::Direct;

        // Centred on the segment, so the pad the broadphase already spends on
        // the tick's travel covers the whole of it rather than only the end.
        const Vec2 flown = shot.position - shot.from;
        const double flownLength = flown.length();
        const Vec2 midpoint = shot.from + flown * 0.5;
        grid.query(shot.realm, midpoint,
                   shot.radius + flownLength * 0.5 + shot.travelled + kBroadphasePad, candidates_);

        // Gathered whole before a single hit lands. The loop below marks
        // victims Dead and that relocates their rows, so nothing here may hold
        // a pointer into the world across an applyDamage().
        impacts_.clear();
        for (const Entity victim : candidates_) {
            if (victim == shot.entity || !world.isAlive(victim)) continue;
            if (!isShootable(world, victim)) continue;
            const Transform* transform = world.tryGet<Transform>(victim);
            const Body* body = world.tryGet<Body>(victim);
            if (transform == nullptr || body == nullptr) continue;

            // Against the SEGMENT the shot just flew, not its endpoint. A
            // fast shot covers more ground in a tick than its own hit reach is
            // wide, and an endpoint test would let it step clean over a flower
            // -- in front of it one tick, behind it the next, never touching.
            // `offset` stays the vector from the
            // point of closest approach, which is what the shove below pushes
            // along and what the nearest-first ordering sorts on.
            const Vec2 toVictim = transform->position - shot.from;
            double along = 0.0;
            if (flownLength > 1e-9) {
                const Vec2 axis = flown * (1.0 / flownLength);
                along = clamp(toVictim.x * axis.x + toVictim.y * axis.y, 0.0, flownLength);
            }
            const Vec2 nearest = shot.from + (flownLength > 1e-9
                                                  ? flown * (along / flownLength)
                                                  : Vec2{});
            const Vec2 offset = transform->position - nearest;
            const double reach = shot.radius + body->radius;
            const double distanceSquared = offset.lengthSq();
            if (distanceSquared > reach * reach) continue;
            // Above canHit() on purpose: a glitch shot marks the flower it
            // touches whether or not the hit itself is refused, and a
            // flower under respawn protection is not in `impacts_` at all.
            if (infecting && world.has<PlayerTag>(victim) && !world.has<Dead>(victim) &&
                canDamage(world, shot.entity, victim)) {
                markGlitched(world, victim);
            }
            if (!canHit(world, victim, shot.entity, nowMillis)) continue;
            impacts_.push_back({victim, offset, distanceSquared});
        }
        if (impacts_.empty()) continue;

        // Nearest first. A shot arriving into a clump spends its health pool
        // front to back, and ordering by distance is the only answer that does
        // not depend on grid bucket order.
        std::sort(impacts_.begin(), impacts_.end(),
                  [](const ShotImpact& a, const ShotImpact& b) {
                      return a.distanceSquared < b.distanceSquared;
                  });

        // Only resolved once something is actually going to be hit: this is a
        // per-shot table lookup and most shots spend their life hitting
        // nothing at all.
        const bool hasStats = petalIndex != kNoPetal;
        const PetalStats stats =
            hasStats ? content.petalStats(petalIndex, rarity) : PetalStats{};
        const double reloadInterval = hasStats ? stats.damageIntervalMillis
                                               : kPetalHitIntervalMillis;

        for (const ShotImpact& impact : impacts_) {
            if (!world.isAlive(shot.entity) || world.has<Dead>(shot.entity)) break;
            // Re-tested per victim rather than trusted from the gather: an
            // earlier impact in this same pass may have killed this one, and a
            // corpse must not pay out twice.
            if (!canHit(world, impact.victim, shot.entity, nowMillis)) continue;

            // The shot's own ledger, so a body it is PASSING THROUGH is hit
            // once per damage interval and not once per tick of overlap. It is
            // added at spawn precisely so arming it here cannot relocate the
            // shot out from under this loop.
            if (const HitCooldowns* ledger = world.tryGet<HitCooldowns>(shot.entity)) {
                if (!ledger->ready(impact.victim, nowMillis)) continue;
            }

            // Charged BEFORE the hit lands, because a victim marked Dead by it
            // no longer has the components this reads.
            const double cost = bodyDamageOf(world, content, impact.victim);
            const bool victimIsShot = world.has<Projectile>(impact.victim);

            DamageResult hit =
                applyDamage(world, impact.victim, shot.entity, damage, nowMillis, hitKind);
            // A shot of zero is refused before applyDamage rolls evasion, and
            // its riders below land regardless -- so it is rolled here, as a
            // zero-damage petal's swing is in resolveMelee.
            if (hit.refused && damage == 0.0 && rollDodge(world, impact.victim, nowMillis)) {
                hit.dodged = true;
            }

            // RE-FETCHED, never carried across applyDamage(). Marking the
            // victim Dead moves it between archetypes, and an archetype
            // swap-removes -- so when the victim is ANOTHER SHOT, the row that
            // slides into its slot may be this one's. A ledger pointer taken
            // before the call is exactly the dangling write the bullet-vs-
            // bullet rule made reachable.
            //
            // Armed on a dodge too: a shot passing through a fly gets one
            // roll per damage interval, not one per tick of overlap.
            if (HitCooldowns* ledger = world.tryGet<HitCooldowns>(shot.entity)) {
                ledger->arm(impact.victim, nowMillis + reloadInterval);
            }

            // A dodged shot flew past: no riders, and none of its pool spent
            // on a body it never touched.
            if (hit.dodged) continue;

            // Riders belong to flesh. A shot cannot be poisoned, slowed or
            // shoved -- it has no Afflictions and its flight is a straight
            // line by contract with the client's interpolation.
            if (!hit.killed && !victimIsShot && hasStats) {
                // The petal's own `knockback` stat is the RING's, not the
                // volley's: projectileCollision.ts stamps a flat force on a
                // mob whatever fired it. What replaces the flat number here is
                // the shot's momentum, which is the same value for stock
                // ammunition and grows only when the shot itself does -- so a
                // mob takes that push ALONE. Queueing the flat force as well
                // would shove it twice for one hit.
                if (world.has<MobTag>(impact.victim)) {
                    pushFromImpact(world, impact.victim, impact.offset, shot.mass, shot.speed);
                } else {
                    applyKnockback(world, impact.victim, impact.offset, stats.knockback);
                }
                applyPoison(world, impact.victim, shot.entity, stats.poisonPerSecond,
                            stats.poisonDurationMillis, nowMillis);
                applySlow(world, impact.victim, stats.slowFactor, stats.slowDurationMillis,
                          rarity, nowMillis);
                applyNoHeal(world, impact.victim, stats.noHealDurationMillis, nowMillis);
            }

            // What the hit cost the shot. Its own health pool is the whole of
            // penetration: nothing counts victims, the pool simply runs out.
            // A shot whose ammunition declares no pool was born with one point
            // and dies here, exactly as it did before it had one.
            if (!world.isAlive(shot.entity) || world.has<Dead>(shot.entity)) break;
            if (!std::isfinite(cost) || cost <= 0.0) {
                world.add<Dead>(shot.entity);
                break;
            }
            Health* health = world.tryGet<Health>(shot.entity);
            if (health == nullptr) {
                world.add<Dead>(shot.entity);
                break;
            }
            health->current -= cost;
            if (health->current <= 0.0) {
                health->current = 0.0;
                world.add<Dead>(shot.entity);
                break;
            }
        }
    }
}

void CombatSystem::pushFromImpact(World& world, Entity victim, Vec2 offset, double shotMass,
                                  double shotSpeed) {
    if (!world.isAlive(victim)) return;
    // Flowers are not pushed from here. applyKnockback above already writes
    // the flower's displacement and movement drains it; doubling that up would
    // be two shoves for one hit.
    if (!world.has<MobTag>(victim)) return;

    Transform* transform = world.tryGet<Transform>(victim);
    if (transform == nullptr) return;
    const Body* body = world.tryGet<Body>(victim);
    const double push = projectilePush(shotMass, shotSpeed, body ? body->mass : 1.0);
    if (!(push > 0.0)) return;

    const Vec2 direction = offset.normalized();
    if (direction.lengthSq() < 1e-12) return;   // exactly co-located: no direction to push along

    // Committed to the position rather than to Knockback. Knockback holds ONE
    // pending shove and the next hit replaces it, so a petal landing on the
    // same tick would erase the shot's momentum outright. This is the same
    // shape as the shove a flower takes from mob contact -- an immediate
    // displacement, no wall resolve, small enough that the next movement step
    // puts it back on legal ground.
    transform->position += direction * push;
}

} // namespace flix
