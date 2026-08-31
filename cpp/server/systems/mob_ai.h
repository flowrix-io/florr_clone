#pragma once
// Mob intent: what every wild mob decides to do this tick.
//
// The system belongs to the INTENT phase and writes exactly two things -- the
// mob's velocity for this tick (Motion::velocity, already eased toward what
// the mob asked for through the shared integrateVelocity step) and where it
// points (Transform::angle). Positions belong to the movement phase, which
// integrates that velocity as it stands, applies knockback and pushes the body
// out of walls; it must not ease it a second time. There is
// one deliberate exception, at placeFollower(): a centipede's trailing segment
// has no motion of its own, its place is a CONSTRAINT on the segment ahead of
// it, and expressing a constraint as a velocity leaves the chain permanently a
// tick behind and visibly elastic.
//
// Damage is not this file's business either. A mob that reaches its target
// stamps MobAi::lastAttackMillis; the combat system reads the overlap and
// applies ContactDamage. Two systems that can both hurt the same player in one
// tick is how a mob ends up dealing double damage on the tick it arrives.
//
// What shapes the rest is the cost model. A 60000-unit world holds thousands
// of mobs and a few dozen players, so the two gates below are not tuning, they
// are the reason the tick fits its budget:
//
//   LOD      a mob further than kMobActiveRadius from every active player does
//            not think at all. The caller supplies the player positions, so a
//            region with nobody in it costs one distance test per mob.
//   CADENCE  ACQUIRING a target is a broadphase query plus a few line-of-sight
//            rays, and runs only when MobAi::nextDecisionMillis says so.
//            KEEPING one is a pointer chase and a distance, and runs every
//            tick -- so aggro is dropped promptly even though it can never be
//            gained more often than the decision clock allows.
//
// Pets are excluded on purpose: a summoned mob fights for its owner and its
// behaviour is not "wild mob with a different target list".

#include <cstdint>
#include <functional>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"

namespace flr {

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/// How often a mob may run the expensive half of its thinking: acquiring a
/// target, re-picking a heading, probing for a wall.
///
/// Jittered because a wave of mobs spawned on one tick would otherwise scan on
/// the same tick forever after, turning a flat cost into a 25Hz spike.
inline constexpr double kMobDecisionIntervalMillis = 500.0;
inline constexpr double kMobDecisionJitterMillis = 250.0;

/// How long a passive mob keeps running after the last hit that scared it.
inline constexpr double kMobFleeDurationMillis = 3500.0;

/// Aggro range for a mob whose config gives none. Not a nicety: every
/// centipede body entry in the shipped data has `range: 0`, and a promoted
/// body segment that could never notice anything would be a mob that has
/// stopped playing the game.
inline constexpr double kMobDefaultAggroRange = 400.0;

/// How far away a damage contributor may be and still be recognised as "the
/// thing that just hit me".
inline constexpr double kMobRetaliationRadius = 1200.0;

/// Facing turn rate, radians per second. A mob that adopted its heading
/// outright would spin on the spot every time its steering changed sign.
inline constexpr double kMobTurnRate = 9.0;

/// Wandering is a stroll, not a charge.
inline constexpr double kMobWanderSpeedScale = 0.45;

/// How far a sandstorm's heading may swing in one decision. Small, because a
/// sandstorm is weather: it drifts across the map rather than milling about.
inline constexpr double kSandstormTurnPerDecision = 0.5;

/// Added to the two bodies' radii before a mob counts as in contact, so an
/// attack lands when the sprites touch rather than when the centres do.
inline constexpr double kMobContactSlack = 4.0;

/// Line-of-sight rays one acquisition may spend. Candidates are tested
/// nearest-first, so the cap costs only the pathological case of eight players
/// stacked behind the same wall.
inline constexpr int kTargetLosRayCap = 8;

/// How far ahead a wandering mob looks for a wall before committing to a
/// heading. One tile: enough to notice, cheap enough to run on the decision
/// clock.
inline constexpr double kMobWallProbe = kTileSize;

/// Segment spacing used when BodySegment::spacing was never filled in, as a
/// multiple of the segment's own radius. Slightly under a full diameter so the
/// body reads as one animal rather than a string of beads.
inline constexpr double kSegmentSpacingPerRadius = 1.8;

/// Extra room beyond the nest's own body when placing an escort.
inline constexpr double kNestSpawnMargin = 40.0;

/// Floor under Spawner::intervalMillis. A nest configured with 0 would ask for
/// a mob every tick and cap out its brood in under a second.
inline constexpr double kMinSpawnIntervalMillis = 100.0;

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

/// The angle a mob holds this tick, given how it is trying to travel.
///
/// Free-standing and pure because it carries a per-config exception on each
/// side -- `hideRotation` mobs are drawn upright and `reversed` art points
/// backwards along the travel -- and those are the two things here that fail
/// silently and only ever look like an art bug.
///
/// `maxTurn` is the turn allowed this step, i.e. a rate multiplied by dt. A
/// travel vector of no length holds the current angle rather than snapping to
/// zero, which is what keeps a stopped mob facing where it was going.
double steerFacing(double current, Vec2 travel, bool hideRotation, bool reversed, double maxTurn);

// ---------------------------------------------------------------------------
// Spawning escorts
// ---------------------------------------------------------------------------

/// A nest's request for one escort.
///
/// The AI decides WHEN a nest spawns and WHAT: assembling the entity -- prefab,
/// net id, loot table, faction -- is the spawning system's job. The hook below
/// is where the two meet, and it is why this file needs to know nothing about
/// how a mob is built.
struct MobSpawnRequest {
    Entity parent = NULL_ENTITY;
    std::uint16_t configIndex = 0;
    Rarity rarity = Rarity::Common;
    Vec2 position;
    /// 0 means the escort never expires on its own.
    double lifetimeMillis = 0;
};

// ---------------------------------------------------------------------------
// MobAiSystem
// ---------------------------------------------------------------------------

class MobAiSystem {
public:
    /// Queries are built once against `world` and reused every tick; run() must
    /// be handed that same World. `seed` fixes the wander and spawn-placement
    /// rolls so a test gets the same walk twice.
    explicit MobAiSystem(World& world, std::uint64_t seed = 0xA1B2C3D4E5F60717ull);

    /// Builds one escort at flush time. Returning NULL_ENTITY means "could not
    /// spawn"; the nest simply tries again on its next interval. With no hook
    /// set a nest keeps its cadence and produces nothing.
    using SpawnHook = std::function<Entity(World&, const MobSpawnRequest&)>;
    void setSpawnHook(SpawnHook hook) { spawnHook_ = std::move(hook); }

    /// One tick of mob intent.
    ///
    /// `grid` must already hold this tick's players -- it is the only way a mob
    /// finds one. `activePlayers` are the positions LOD is measured against;
    /// an empty list means nobody is watching and no mob thinks, which is the
    /// intended behaviour and not a degenerate case. `dt` is in seconds.
    ///
    /// A nest's spawn lands as a deferred command, so `commands` must be
    /// flushed while this system is still alive.
    void run(World& world, const Terrain& terrain, const SpatialGrid& grid,
             const std::vector<Vec2>& activePlayers,
             double nowMillis, double dt, CommandBuffer& commands);

    /// Per-run counters. Reset at the top of every run(), so they describe the
    /// last tick and nothing else. `targetScans` is the one that matters: it is
    /// the number of broadphase queries the AI spent, and it is what tells a
    /// test that target caching is actually caching.
    struct Stats {
        std::uint64_t considered = 0;    ///< mobs the query produced
        std::uint64_t thought = 0;       ///< mobs that passed the LOD gate
        std::uint64_t skipped = 0;       ///< mobs LOD dropped
        std::uint64_t targetScans = 0;   ///< broadphase acquisitions run
        std::uint64_t attacks = 0;       ///< contact attacks intended
        std::uint64_t spawnRequests = 0; ///< escorts asked of the spawn hook
        std::uint64_t promotions = 0;    ///< segments promoted to chain heads
    };
    const Stats& stats() const { return stats_; }

private:
    /// The per-tier numbers the AI needs, flattened out of the content tables.
    ///
    /// Memoised by (config, rarity): mobStats() is a dozen multiplies and two
    /// table lookups, and running it for every mob every tick is pure repeat
    /// work over data that cannot change while the server is up.
    struct Drive {
        double speed = 0;
        double attackCooldownMillis = 0;
        bool hideRotation = false;
        bool reversed = false;
        bool valid = false;
    };

    struct Candidate {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        double score = 0;   ///< distance less the player's aggro bonus
    };

    Drive driveFor(std::uint16_t configIndex, Rarity rarity);

    void steerMob(World& world, const Terrain& terrain, const SpatialGrid& grid,
                  Entity self, Transform& transform, Motion& motion, const Body& body,
                  const MobType& type, MobAi& ai, double nowMillis, double dt);

    Vec2 steerWander(const Terrain& terrain, const Transform& transform, MobAi& ai,
                     double speed, bool decisionDue);
    Vec2 steerSandstorm(const Terrain& terrain, const Transform& transform, MobAi& ai,
                        double speed, bool decisionDue);
    Vec2 steerPassive(World& world, const Terrain& terrain, Entity self,
                      const Transform& transform, MobAi& ai, double speed,
                      double nowMillis, bool decisionDue);
    Vec2 steerAggressive(World& world, const Terrain& terrain, const SpatialGrid& grid,
                         Entity self, const Transform& transform, const Body& body,
                         MobAi& ai, const Drive& drive, double speed,
                         double nowMillis, bool decisionDue);

    Entity acquireTarget(World& world, const Terrain& terrain, const SpatialGrid& grid,
                         Entity self, Vec2 from, double range);
    Entity nearestAttacker(World& world, Entity self, Vec2 from, double radius) const;
    bool targetHeld(World& world, Vec2 from, Entity target, double range) const;
    void stampAttack(World& world, Entity self, MobAi& ai, double nowMillis, const Drive& drive);

    void repairChains(World& world);
    void followChains(World& world, const Terrain& terrain, const std::vector<Vec2>& activePlayers);
    void placeFollower(World& world, const Terrain& terrain, Entity self, Entity ahead);
    void driveSpawners(World& world, const Terrain& terrain, double nowMillis, CommandBuffer& commands);

    Query<Transform, Motion, Body, MobType, MobAi> mobs_;
    Query<BodySegment, Transform> segments_;
    Query<Spawner, Transform, MobType> nests_;
    Query<PlayerTag, PlayerModifiers> playerModifiers_;

    SpawnHook spawnHook_;
    Rng rng_;
    Stats stats_;

    /// The widest aggro bonus any live player carries, recomputed once per
    /// tick. The bonus is per-player but the broadphase radius is per-query, so
    /// without it a mob would query its bare range and miss exactly the player
    /// whose petals were meant to draw attention.
    double maxAggroBonus_ = 0;

    std::vector<Drive> drives_;
    std::uint32_t drivesHash_ = 0;

    // Scratch, reused so that a steady-state tick allocates nothing.
    std::vector<Entity> gridScratch_;
    std::vector<Candidate> candidates_;
    std::vector<Entity> chainHeads_;
    std::unordered_map<Entity, Entity> followerOf_;
    std::unordered_set<Entity> visited_;
};

} // namespace flr
