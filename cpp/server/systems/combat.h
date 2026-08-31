#pragma once
// Combat: every path in the game that removes health, and the death that
// follows.
//
// The whole point of this file is that there is exactly ONE function that
// writes Health::current -- applyDamage(). Invulnerability, the same-team
// refusal, the hurt flash, the contribution ledger, the damage event and the
// transition to Dead are consequences of a hit, and a consequence that lives
// in only one place cannot be forgotten by the next damage source somebody
// adds. No other system may touch Health::current; it should reach for
// applyDamage instead.
//
// STRUCTURAL TRAP: applyDamage() adds the Dead tag, which relocates the victim
// between archetypes and invalidates every column pointer a Query::each is
// holding. It must therefore never be called from inside each(). Every pass
// below is written as gather-then-apply for exactly this reason, and any
// system that wants to deal damage must do the same.

#include <cstdint>
#include <memory>
#include <vector>

#include "server/replication.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"
#include "shared/game/spatial.h"

namespace flr {

/// How long a hit keeps the client's white flash lit. Short: it reads as an
/// impact rather than a status, and it is refreshed by every landed hit, so a
/// sustained beating stays lit without anything having to track that.
inline constexpr double kHurtFlashMillis = 120.0;

/// Knockback a touching body delivers, per unit of the attacker's mass. The
/// victim's mass divides it back out in applyKnockback(), so what survives is
/// the mass RATIO -- a boss shoves a flower, a flower barely nudges a boss.
inline constexpr double kContactKnockback = 4.0;

/// Ceiling on one hit's contribution to Knockback::impulse, in units/second.
/// Without it the mass ratio between an apex mob and a common petal launches
/// the victim clean off the map in a single touch.
inline constexpr double kMaxKnockbackImpulse = 600.0;

/// How long a ground effect's slow outlives standing in it. Refreshed every
/// tick while inside, so this is only the tail after walking out -- long
/// enough that the debuff does not strobe at the boundary, short enough that
/// escaping a web means something.
inline constexpr double kGroundEffectSlowLingerMillis = 250.0;

/// Slack added to every broadphase query, in world units.
///
/// The grid is filled at the top of the tick, BEFORE movement runs, so by the
/// time combat asks it a question its positions are one step stale -- about
/// twelve units for a flower at top speed. The exact circle test still decides
/// what was hit; this only widens the CANDIDATE set enough that whatever just
/// moved into contact is in it.
inline constexpr double kBroadphasePad = 24.0;

/// Ticks between HitCooldowns sweeps. The entries are only a correctness
/// concern while they are in the future; the sweep exists so a petal that has
/// grazed ten thousand mobs is not still carrying all ten thousand.
inline constexpr int kCooldownPruneTicks = 50;

/// Depth limit when resolving a petal/pet/projectile back to the player behind
/// it. A cycle in the owner links would otherwise hang the tick, and this is
/// a wire-fed graph -- it is not allowed to be able to.
inline constexpr int kMaxOwnerHops = 8;

/// Why damage is being applied.
///
/// Only the presentation differs: a poison or radiation tick is 25 tiny
/// applications a second, and flashing the victim white and spawning a
/// floating number for each of them would bury the hit that actually matters.
/// The client draws those from StatePoisoned instead.
enum class DamageKind : std::uint8_t { Direct = 0, Periodic = 1 };

struct DamageResult {
    double applied = 0;      ///< health actually removed, after clamping to what was left
    bool killed = false;     ///< this application is the one that marked Dead
    bool refused = false;    ///< nothing happened: invulnerable, same side, already dead
};

class CombatSystem {
public:
    CombatSystem();
    ~CombatSystem();
    CombatSystem(const CombatSystem&) = delete;
    CombatSystem& operator=(const CombatSystem&) = delete;

    /// One tick of damage. Runs after movement and after the petal ring has
    /// been placed, so every hit is tested from where things ended up.
    void run(World& world, const SpatialGrid& grid, const ContentRegistry& content,
             double nowMillis, double dt, CommandBuffer& commands, EventQueue& events);

    /// The single damage path. Returns what actually landed.
    ///
    /// `source` is whatever dealt the hit -- a mob, a petal, a projectile, a
    /// ground effect -- not necessarily a player; the player to credit is
    /// resolved from it. NULL_ENTITY is a legitimate source and means the
    /// environment, which no faction rule protects anyone from.
    ///
    /// Not const-safe against iteration: see the structural trap above.
    DamageResult applyDamage(World& world, Entity victim, Entity source, double amount,
                             double nowMillis, DamageKind kind = DamageKind::Direct);

    /// Adds to what the victim is owed this tick. Movement owns velocity and
    /// consumes this; writing velocity here would fight it and lose.
    void applyKnockback(World& world, Entity victim, Vec2 offset, double strength);

    /// Poison and slow both follow one stacking rule: while an effect is live,
    /// its strength never drops and its expiry never comes closer. A weak
    /// application therefore cannot dilute or cut short a strong one, which is
    /// the bug the rule exists to prevent -- otherwise a common petal grazing
    /// a mob would wipe the mythic poison already on it.
    void applyPoison(World& world, Entity victim, Entity source, double perSecond,
                     double durationMillis, double nowMillis);
    void applySlow(World& world, Entity victim, double factor, double durationMillis,
                   Rarity sourceRarity, double nowMillis);

    /// The PLAYER answerable for what `source` does: through Projectile::
    /// creditTo, Pet::owner, PetalInstance::owner and GroundEffect::owner,
    /// transitively. NULL_ENTITY when nothing player-owned is behind it, which
    /// is the normal answer for a wild mob.
    static Entity creditedPlayer(const World& world, Entity source);

    /// Whether `source` is allowed to hurt `victim` at all: different sides,
    /// or the same side with friendly fire on. Two things resolving to the
    /// same player never hurt each other, which is what stops a flower's own
    /// petals and pets from killing it the moment PvP is enabled.
    static bool canDamage(const World& world, Entity source, Entity victim);

    /// canDamage() plus the victim's own state: alive, not already Dead, and
    /// past its respawn invulnerability. Shared with the contact path so that
    /// a refused hit consumes no cooldown and lands no poison either.
    static bool canHit(const World& world, Entity victim, Entity source, double nowMillis);

    /// Deaths marked during the last run(), oldest first. The loot system
    /// reads the ledger off the corpse itself (Bounty survives until the
    /// reaper runs at the end of the tick); this is for the server and for
    /// tests that want the list without a query.
    struct DeathRecord {
        Entity entity = NULL_ENTITY;
        Entity killer = NULL_ENTITY;
        bool wasPlayer = false;
    };
    const std::vector<DeathRecord>& deaths() const { return deaths_; }

private:
    /// A touching body about to be tested against everything near it. Mob
    /// bodies, flower bodies and petals all reduce to this, so there is one
    /// overlap-and-cooldown loop rather than three that drift apart.
    struct MeleeSource {
        Entity attacker = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double damage = 0;
        double hitIntervalMillis = kMobHitIntervalMillis;
        double knockback = 0;
        double poisonPerSecond = 0;
        double poisonDurationMillis = 0;
        double slowFactor = 1.0;
        double slowDurationMillis = 0;
        Rarity rarity = Rarity::Common;
    };

    struct FieldSource {
        Entity effect = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double damagePerSecond = 0;
        double slowFactor = 1.0;
        Rarity rarity = Rarity::Common;
    };

    struct ShotSource {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double travelled = 0;
    };

    struct PoisonTick {
        Entity victim = NULL_ENTITY;
        Entity source = NULL_ENTITY;
        double amount = 0;
    };

    struct Queries;

    /// Queries cache the archetypes they match, so they are built once and
    /// reused. The world is not known until the first run(), and a test may
    /// hand over a different one, hence the rebind rather than a member.
    void bind(World& world);

    void tickAfflictions(World& world, double nowMillis, double dt);
    void tickGroundEffects(World& world, const SpatialGrid& grid, double nowMillis, double dt);
    void gatherContact(World& world, const ContentRegistry& content);
    void gatherPetals(World& world, const ContentRegistry& content);
    void resolveMelee(World& world, const SpatialGrid& grid, double nowMillis);
    void tickProjectiles(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                         double nowMillis, double dt);
    void awardBounty(World& world, Entity victim);

    std::unique_ptr<Queries> queries_;
    World* boundWorld_ = nullptr;
    EventQueue* events_ = nullptr;

    std::vector<MeleeSource> melee_;
    std::vector<FieldSource> fields_;
    std::vector<ShotSource> shots_;
    std::vector<PoisonTick> poison_;
    std::vector<Entity> candidates_;
    std::vector<DeathRecord> deaths_;

    std::uint64_t tick_ = 0;
};

} // namespace flr
