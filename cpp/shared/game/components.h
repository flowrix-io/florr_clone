#pragma once
// Every component in the game.
//
// Two rules shape this list:
//
//  * A component is what an entity HAS, not what it is allowed to do. Systems
//    are selected by which components an entity carries, so "can be damaged"
//    is a Health component and not a flag inside a giant Actor struct.
//
//  * State that toggles frequently lives in a FIELD, not in its own tag.
//    Adding or removing a component moves the entity between archetypes, which
//    copies all of its data. Tags are reserved for what an entity fundamentally
//    is -- and that changes at most once in its lifetime.

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/component.h"
#include "shared/core/entity.h"
#include "shared/core/types.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"
#include "shared/game/skills.h"
#include "shared/net/protocol.h"

namespace flr {

// ---------------------------------------------------------------------------
// Kind tags -- exactly one per entity, fixed for its lifetime
// ---------------------------------------------------------------------------

struct PlayerTag {};
struct MobTag {};
struct PetalTag {};
struct ProjectileTag {};
struct DropTag {};
struct GroundEffectTag {};

/// Marks an entity as finished. The reaper destroys these at the end of the
/// tick, so a death that happens mid-system is visible to every later system
/// in the same tick instead of vanishing underneath it.
struct Dead {
    Entity killer = NULL_ENTITY;
};

// ---------------------------------------------------------------------------
// Spatial
// ---------------------------------------------------------------------------

struct Transform {
    Vec2 position;
    double angle = 0;      ///< facing, radians
};

struct Motion {
    Vec2 velocity;         ///< units per second
};

struct Body {
    double radius = 10;
    /// Resistance to being pushed, in collision and knockback. Scales with
    /// area so a boss shrugs off what launches a ladybug.
    double mass = 1;
};

/// One pending positional displacement from a knockback-producing hit.
///
/// This intentionally is not momentum. TypeScript writes the resulting x/y
/// offset to the mob's Knockback component and the next movement pass applies
/// it directly, leaving ordinary velocity untouched. A later hit replaces the
/// previous value rather than launching a mob with an accumulated volley.
struct Knockback {
    Vec2 impulse;
};

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/// Who an entity will not hurt. Players and their pets share a team; every
/// wild mob is on the hostile team. PvP swaps players onto distinct teams.
enum class Team : std::uint8_t { Players = 0, Hostiles = 1, Neutral = 2 };

struct Faction {
    Team team = Team::Hostiles;
    /// In PvP, players are hostile to each other; elsewhere they are not.
    bool friendlyFireEnabled = false;
};

struct Health {
    double current = 1;
    double max = 1;
    /// When the white damage flash ends. Purely visual, but it lives here so
    /// the networking layer can derive StateHurt without a second lookup.
    double flashUntilMillis = 0;
    /// Damage is refused entirely before this time -- respawn protection.
    double invulnerableUntilMillis = 0;

    double fraction() const { return max > 0 ? clamp(current / max, 0.0, 1.0) : 0.0; }
    bool alive() const { return current > 0; }
};

/// Damage dealt by touching this entity.
struct ContactDamage {
    double amount = 0;
    /// Minimum gap between two hits on the same victim.
    double intervalMillis = kMobHitIntervalMillis;
};

/// Recent hits, so a damage source that stays in contact does not deal its
/// damage every tick.
///
/// A flat vector rather than a map: the list is a handful of entries and is
/// scanned linearly, which beats hashing at this size and keeps the component
/// relocatable without allocating a node per hit.
struct HitCooldowns {
    struct Entry {
        Entity victim = NULL_ENTITY;
        double readyAtMillis = 0;
    };
    std::vector<Entry> entries;

    bool ready(Entity victim, double nowMillis) const {
        for (const Entry& e : entries) {
            if (e.victim == victim) return nowMillis >= e.readyAtMillis;
        }
        return true;
    }

    void arm(Entity victim, double readyAtMillis) {
        for (Entry& e : entries) {
            if (e.victim == victim) { e.readyAtMillis = readyAtMillis; return; }
        }
        entries.push_back({victim, readyAtMillis});
    }

    /// Drops expired entries. Called on a slow cadence: without it a petal
    /// that has grazed a thousand mobs carries all thousand forever.
    void prune(double nowMillis) {
        std::size_t out = 0;
        for (std::size_t i = 0; i < entries.size(); ++i) {
            if (entries[i].readyAtMillis > nowMillis) entries[out++] = entries[i];
        }
        entries.resize(out);
    }
};

/// Damage-over-time and movement debuffs.
///
/// One component rather than one per affliction: they are read together every
/// tick, and splitting them would mean three archetype moves every time a mob
/// is poisoned, slowed and then recovers.
struct Afflictions {
    double poisonPerSecond = 0;
    double poisonUntilMillis = 0;
    Entity poisonSource = NULL_ENTITY;

    double slowFactor = 1.0;      ///< multiplies speed; 1 = unaffected
    double slowUntilMillis = 0;

    bool poisoned(double nowMillis) const { return nowMillis < poisonUntilMillis && poisonPerSecond > 0; }
    bool slowed(double nowMillis) const { return nowMillis < slowUntilMillis && slowFactor < 1.0; }
};

/// XP awarded for landing the killing blow, and the ledger of who contributed.
///
/// Contributions are tracked so that loot and XP go to everyone who fought the
/// mob rather than whoever happened to land the last hit.
struct Bounty {
    double xp = 0;
    struct Share {
        Entity player = NULL_ENTITY;
        double damage = 0;
    };
    std::vector<Share> contributors;

    void credit(Entity player, double damage) {
        for (Share& s : contributors) {
            if (s.player == player) { s.damage += damage; return; }
        }
        contributors.push_back({player, damage});
    }
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/// One equipped petal type. An empty slot has `configIndex == kNoPetal`.
inline constexpr std::uint16_t kNoPetal = 0xFFFF;

struct LoadoutSlot {
    std::uint16_t configIndex = kNoPetal;
    Rarity rarity = Rarity::Common;

    /// When a broken slot comes back. Held on the slot rather than the petal
    /// entity because the petal entity is destroyed while it is broken.
    double reloadReadyAtMillis = 0;
    bool broken = false;

    bool empty() const { return configIndex == kNoPetal; }
};

struct Loadout {
    std::array<LoadoutSlot, kLoadoutSlots> slots{};
    /// Petal entities currently spawned for each slot. A slot may own several
    /// (clumped petals such as sand spawn as a cluster).
    std::vector<Entity> spawned;
};

/// The orbiting ring's live geometry. On the player, not on each petal, so all
/// of a flower's petals necessarily agree about where the ring is.
struct PetalRing {
    double radius = kPetalOrbitRestRadius;
    double targetRadius = kPetalOrbitRestRadius;
    double spin = 0;       ///< current ring rotation, radians
};

struct PlayerInput {
    net::InputFrame current;
    std::uint32_t lastAppliedSequence = 0;
    /// Where the cursor is in world space, derived from the input's aim angle
    /// and used for both movement and petal facing.
    Vec2 aimDirection{1, 0};
};

/// Account-scoped identity. Cold: read on join, on save, and when someone
/// types in chat.
struct PlayerAccount {
    std::string userId;
    std::string username;
    net::ConnectionId connection = 0;
    bool admin = false;
};

/// The talent tree as the simulation sees it.
///
/// A copy of the account's tree rather than a pointer into the database: the
/// tick must not reach into storage, and a tree only changes when the player
/// buys a tier, at which point the owner writes this component too.
struct PlayerSkillTree {
    SkillSet skills;
};

struct PlayerProgress {
    double totalXp = 0;
    int level = 1;
    int stars = 0;
    /// Set when the level changed this tick so the networking layer can emit a
    /// LevelUp event without diffing.
    bool leveledThisTick = false;
};

/// Player body presentation that is not implied by a generic entity state.
///
/// `faceFlags` holds persistent/special-case bits (dandelion, square eyes and
/// corruption); poison, attack, defend and death are layered on by snapshot
/// construction. `equipFlags` is recomputed from the loadout by PetalSystem.
/// `glitched` is transient and is ORed into renderFlags for the wire, matching
/// TypeScript's effectiveRenderFlags() rather than persisting an affliction.
struct PlayerVisuals {
    std::uint8_t faceFlags = FaceNone;
    std::uint8_t equipFlags = EquipNone;
    std::uint32_t renderFlags = PlayerRenderNone;
    bool glitched = false;
};

/// Passive bonuses summed from equipped petals each tick.
///
/// Recomputed from scratch rather than applied incrementally on equip: an
/// incremental version has to unwind exactly what it applied, and a single
/// missed unwind is a permanent stat the player keeps forever.
struct PlayerModifiers {
    double maxHealthScale = 1.0;
    double speedScale = 1.0;
    double damageScale = 1.0;
    double sizeScale = 1.0;
    double luck = 0.0;          ///< adds to drop upgrade rolls
    double magnetism = 0.0;     ///< adds to pickup radius
    double aggroRadiusBonus = 0.0;
    double rangeScale = 1.0;    ///< petal reach
    double cameraZoom = 1.0;
    double passiveHealPerSecond = 0.0;
};

/// Where the player is: the open world, or one of the detached regions.
enum class Region : std::uint8_t { Overworld = 0, Arena = 1 };

struct PlayerLocation {
    Region region = Region::Overworld;
    /// Viewport in world units, reported by the client, used to decide what to
    /// replicate. Clamped server-side -- a client claiming a 40000-unit
    /// viewport is asking to see the whole map.
    Vec2 viewport{1920, 1080};
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

struct MobType {
    std::uint16_t configIndex = 0;
    Rarity rarity = Rarity::Common;
    /// Per-spawn size jitter from the config's `random_size` range.
    double sizeJitter = 1.0;
};

enum class AiKind : std::uint8_t {
    Passive = 0,    ///< never attacks; flees when hurt
    Neutral,        ///< retaliates, but does not seek
    Hostile,        ///< seeks players within its range
    Sandstorm,      ///< drifts on its own heading, ignoring players
    Stationary,     ///< a nest or hole: never moves, spawns escorts
};

struct MobAi {
    AiKind kind = AiKind::Neutral;
    Entity target = NULL_ENTITY;
    /// Where the mob was spawned; it wanders around this rather than drifting
    /// across the map over a long session.
    Vec2 anchor;
    double aggroRange = 0;
    double wanderAngle = 0;
    double nextDecisionMillis = 0;
    double lastAttackMillis = 0;
    /// Set while the mob is fleeing after being hurt (passive mobs).
    double fleeUntilMillis = 0;
};

/// A mob summoned by a player, which fights for them and does not drop loot.
struct Pet {
    Entity owner = NULL_ENTITY;
    /// Slot index of the petal that summoned it, so a broken petal can recall
    /// exactly the pets it owns.
    std::uint8_t slot = 0;
};

/// A segmented body (centipedes). Each segment follows the one ahead.
struct BodySegment {
    Entity ahead = NULL_ENTITY;
    Entity behind = NULL_ENTITY;
    /// Distance this segment holds behind the one in front.
    double spacing = 0;
    bool head = false;
};

/// A nest that periodically produces escorts, up to a live cap.
struct Spawner {
    std::uint16_t childConfigIndex = 0;
    int rarityOffset = 0;
    double intervalMillis = 2000;
    double nextSpawnMillis = 0;
    double childLifetimeMillis = 0;
    int maxAlive = 5;
    std::vector<Entity> children;
};

// ---------------------------------------------------------------------------
// Petals and projectiles
// ---------------------------------------------------------------------------

struct PetalInstance {
    Entity owner = NULL_ENTITY;
    std::uint16_t configIndex = 0;
    Rarity rarity = Rarity::Common;
    std::uint8_t slot = 0;
    /// Index within a clumped slot, used to fan the cluster out around its
    /// shared ring position.
    std::uint8_t subIndex = 0;
    std::uint8_t subCount = 1;
    /// Angle offset from the ring's rotation, fixed at spawn.
    double ringOffset = 0;
    /// Next time this petal may fire, heal, or otherwise act.
    double nextActionMillis = 0;
};

struct Projectile {
    Entity owner = NULL_ENTITY;
    /// The player credited with any kill, which is not the owner when the
    /// shooter was a pet.
    Entity creditTo = NULL_ENTITY;
    double damage = 0;
    double remainingDistance = 0;
    std::uint16_t petalConfigIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    /// Homing cone and range, both zero for a dumb projectile.
    double seekRange = 0;
    double seekCone = 0;
};

struct Lifetime {
    double remainingSeconds = 0;
};

// ---------------------------------------------------------------------------
// Drops and ground effects
// ---------------------------------------------------------------------------

struct DropItem {
    std::uint16_t configIndex = 0;
    Rarity rarity = Rarity::Common;
    /// Only these players may pick it up. Empty means anyone can, which is
    /// what a drop falls back to once its reservation expires.
    std::vector<Entity> eligible;
    double freeForAllAtMillis = 0;
};

enum class GroundEffectKind : std::uint8_t { Poison = 0, Web = 1, Radiation = 2 };

struct GroundEffect {
    GroundEffectKind kind = GroundEffectKind::Poison;
    Entity owner = NULL_ENTITY;
    double radius = 0;
    double damagePerSecond = 0;
    double slowFactor = 1.0;
    Rarity rarity = Rarity::Common;
};

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

/// A stable id for an entity on the wire.
///
/// Distinct from Entity: an Entity handle encodes a slot that gets recycled,
/// and a client that missed a removal would otherwise apply an update meant
/// for a new entity to the corpse of the old one. Net ids are never reused
/// within a session.
struct NetId {
    std::uint32_t value = 0;
};

/// What the client needs in order to draw this entity, and what changed.
struct Replicated {
    net::EntityKind kind = net::EntityKind::Mob;
    std::uint8_t state = 0;      ///< net::EntityState bits, rebuilt each tick
    std::uint16_t typeIndex = 0; ///< index into the mob or petal config table
    Rarity rarity = Rarity::Common;
    std::uint8_t spawnFlags = 0;
};

} // namespace flr

// Component registration. Global scope, once per type.
FLR_COMPONENT(flr::PlayerTag);
FLR_COMPONENT(flr::MobTag);
FLR_COMPONENT(flr::PetalTag);
FLR_COMPONENT(flr::ProjectileTag);
FLR_COMPONENT(flr::DropTag);
FLR_COMPONENT(flr::GroundEffectTag);
FLR_COMPONENT(flr::Dead);
FLR_COMPONENT(flr::Transform);
FLR_COMPONENT(flr::Motion);
FLR_COMPONENT(flr::Body);
FLR_COMPONENT(flr::Knockback);
FLR_COMPONENT(flr::Faction);
FLR_COMPONENT(flr::Health);
FLR_COMPONENT(flr::ContactDamage);
FLR_COMPONENT(flr::HitCooldowns);
FLR_COMPONENT(flr::Afflictions);
FLR_COMPONENT(flr::Bounty);
FLR_COMPONENT(flr::Loadout);
FLR_COMPONENT(flr::PetalRing);
FLR_COMPONENT(flr::PlayerInput);
FLR_COMPONENT(flr::PlayerAccount);
FLR_COMPONENT(flr::PlayerSkillTree);
FLR_COMPONENT(flr::PlayerProgress);
FLR_COMPONENT(flr::PlayerVisuals);
FLR_COMPONENT(flr::PlayerModifiers);
FLR_COMPONENT(flr::PlayerLocation);
FLR_COMPONENT(flr::MobType);
FLR_COMPONENT(flr::MobAi);
FLR_COMPONENT(flr::Pet);
FLR_COMPONENT(flr::BodySegment);
FLR_COMPONENT(flr::Spawner);
FLR_COMPONENT(flr::PetalInstance);
FLR_COMPONENT(flr::Projectile);
FLR_COMPONENT(flr::Lifetime);
FLR_COMPONENT(flr::DropItem);
FLR_COMPONENT(flr::GroundEffect);
FLR_COMPONENT(flr::NetId);
FLR_COMPONENT(flr::Replicated);
