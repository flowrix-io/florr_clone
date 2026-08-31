#pragma once
// Keeping the world populated: what appears, where, and what is recycled.
//
// A 60000x60000 map cannot hold a full population. What is simulated instead
// is a moving neighbourhood: mobs appear in a ring around each player, outside
// what the client can see but inside kMobActiveRadius, and a mob nobody has
// been near for long enough is recycled. The map is dense exactly where
// someone is looking and empty everywhere else, so the tick cost scales with
// the number of players rather than with the area of the world.
//
// Two ceilings sit above that. A per-section cap keeps one biome from being
// stripped to feed another, and a global cap keeps a crowd of players from
// multiplying the population without bound -- twenty players standing apart
// each want their own neighbourhood, and without the cap they would get it.

#include <array>
#include <cstdint>
#include <optional>
#include <vector>

#include "server/replication.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"
#include "shared/game/terrain.h"

namespace flr {

// ---------------------------------------------------------------------------
// Components owned by this system
// ---------------------------------------------------------------------------

/// Bookkeeping for a mob the population controller owns.
///
/// Carrying it is what makes a mob "ambient". A pet, a boss placed by a
/// script, or anything else spawned outside this system has none, so it is
/// neither counted against the caps nor recycled out from under its owner.
struct AmbientMob {
    /// Last time any player was within kMobDespawnRadius. Stamped at spawn, so
    /// a mob placed into an empty ring still gets the full grace period rather
    /// than being recycled on the very next pass.
    double lastNearPlayerMillis = 0;
};

/// A nest working through the escalating `spawn_waves` list in its config.
///
/// Distinct from Spawner, which repeats ONE child type on a timer: a wave is a
/// heterogeneous group and the list gets harder as it goes. Kept as its own
/// component rather than widened into Spawner because two mobs in the whole
/// data set have waves, and every other nest would carry the empty vector.
struct NestWaves {
    std::uint16_t mobIndex = 0;      ///< the nest's own config, where the list lives
    std::uint16_t nextWave = 0;
    double nextWaveMillis = 0;
    /// Live escorts from previous waves, pruned as they die. Holding handles
    /// rather than a count is what makes the cap survive a mob dying: a stale
    /// counter would leak the slot forever.
    std::vector<Entity> children;
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/// Mobs the controller wants inside kMobActiveRadius of each player. Chosen so
/// a player always has something to fight within a short walk without the
/// screen ever being wall-to-wall bodies.
inline constexpr int kMobsPerPlayer = 45;

/// Hard ceilings. The global one is what a full server actually costs; the
/// per-section one stops a party camping one biome from owning the whole
/// budget.
inline constexpr int kMaxLiveMobs = 900;
inline constexpr int kMaxMobsPerSection = 260;

/// The population the ambient spawner aims a section at. Below the hard cap on
/// purpose: nest escorts push past the target but never past the cap.
inline constexpr int kSectionTargetPopulation = 180;

/// Spawn ring. The inner edge is outside the diagonal of a 1920x1080 viewport
/// (1101 units), which is the whole point -- a mob that materialises on screen
/// reads as a bug no matter how correct the population maths is.
inline constexpr double kSpawnRingMin = 1300.0;
inline constexpr double kSpawnRingMax = kMobActiveRadius;

/// No spawn lands closer than this to ANY player, not just the one whose
/// neighbourhood asked for it. Two players standing together would otherwise
/// spawn into each other's view.
inline constexpr double kMinSpawnDistance = 1200.0;

/// Radius counted as "a player has been here", and how long a mob survives
/// without one. The radius is wider than the active radius so a player pacing
/// the edge of a group does not cause it to blink out and back.
inline constexpr double kMobDespawnRadius = kMobActiveRadius * 1.5;
inline constexpr double kMobDespawnDelayMillis = 20000.0;

/// The census and spawn pass run on their own cadence rather than every tick:
/// it is O(mobs x players), and at 25Hz nothing about the population changes
/// fast enough to need it more often than this.
inline constexpr double kPopulationIntervalMillis = 200.0;

/// Spawns granted to one player per pass. A trickle rather than a burst, so a
/// player who has just cleared an area watches it refill instead of being
/// surrounded a tick later.
inline constexpr int kMaxSpawnsPerPass = 4;

/// How often a nest sends its next wave. The wave lists carry no interval of
/// their own; this is the one the game runs them at.
inline constexpr double kNestWaveIntervalMillis = 15000.0;

/// Concurrent escorts one wave-nest keeps alive. Independent of a Spawner's
/// own `maxAlive`, which the config supplies.
inline constexpr int kMaxNestChildren = 12;

/// How deep nesting may go. A nest whose escorts are themselves nests is legal
/// data and would otherwise recurse until the world ran out of memory.
inline constexpr int kMaxNestDepth = 2;

/// Radius the terrain is searched within for a legal spot around a requested
/// spawn point. Under one tile, so a rejected point is nudged rather than
/// teleported into the next clearing.
inline constexpr double kSpawnScatterRadius = 240.0;

/// Attempts allowed per requested spawn before the pass gives up on it. The
/// ring can land in a lake or in a walled-off pocket; retrying a few times
/// costs nothing and refusing to retry leaves visible holes in the population.
inline constexpr int kSpawnPlacementAttempts = 6;

// ---------------------------------------------------------------------------
// SpawnSystem
// ---------------------------------------------------------------------------

class SpawnSystem {
public:
    /// What the last population pass saw. Read by tests and by anything that
    /// wants to report server load; the controller itself keeps no other state
    /// about the world, because the world is the state.
    struct Census {
        int mobs = 0;                                  ///< ambient mobs alive
        std::array<int, kSectionCount> perSection{};
        int spawnedTotal = 0;                          ///< cumulative, since construction
        int despawnedTotal = 0;
    };

    /// Assigns the wire id for every entity this system creates.
    ///
    /// Null in a unit test, where nothing replicates. The runtime MUST point it
    /// at the server's one allocator: a mob without a NetId is simulated
    /// correctly and is invisible to every client, which is the most confusing
    /// possible failure.
    NetIdAllocator* netIds = nullptr;

    void run(World& world, const Terrain& terrain, const ContentRegistry& content,
             const std::vector<Vec2>& players, Rng& rng, double nowMillis, double dt,
             CommandBuffer& commands);

    /// Places one mob, with its nest escorts if it has any, and returns it.
    /// NULL_ENTITY when `mobIndex` names nothing.
    ///
    /// `position` is a request, not a promise: it is pushed out of the terrain
    /// before use, so a caller may hand over a point in a wall and still get a
    /// mob standing somewhere legal.
    Entity spawnMob(World& world, const Terrain& terrain, const ContentRegistry& content,
                    std::uint16_t mobIndex, Rarity rarity, Vec2 position, double nowMillis,
                    Rng& rng);

    /// The weighted type roll for one section: spawn_weight over the mobs whose
    /// `section` list contains it. kInvalidIndex when the section has none.
    std::uint16_t chooseMobType(const ContentRegistry& content, int section, Rng& rng);

    /// The natural tier roll: kNaturalSpawnWeight, then raised to the mob's
    /// min_rarity. Never returns a tier the weight table gives zero weight, so
    /// nothing above mythic can spawn in the wild unless min_rarity demands it.
    static Rarity rollRarity(const MobConfig& config, Rng& rng);

    const Census& census() const { return census_; }

private:
    void bind(World& world);
    void takeCensus(const std::vector<Vec2>& players, double nowMillis, CommandBuffer& commands);
    void fillNeighbourhoods(World& world, const Terrain& terrain, const ContentRegistry& content,
                            const std::vector<Vec2>& players, Rng& rng, double nowMillis);
    void runNests(World& world, const Terrain& terrain, const ContentRegistry& content,
                  Rng& rng, double nowMillis);
    void expireEscorts(double dt, CommandBuffer& commands);

    /// True when `position` is somewhere a new mob may legally appear.
    bool placementAllowed(const Terrain& terrain, const std::vector<Vec2>& players,
                          Vec2 position, int& sectionOut) const;

    Entity spawnMobAt(World& world, const Terrain& terrain, const ContentRegistry& content,
                      std::uint16_t mobIndex, Rarity rarity, Vec2 position, double nowMillis,
                      Rng& rng, int depth);

    /// One escort, placed on a ring just outside its nest's body.
    Entity spawnEscort(World& world, const Terrain& terrain, const ContentRegistry& content,
                       std::uint16_t childIndex, Rarity nestRarity, Vec2 anchor,
                       double anchorRadius, double nowMillis, Rng& rng, int depth);

    void rebuildCandidates(const ContentRegistry& content);

    /// Mobs eligible in one section, with a running weight total so a single
    /// uniform draw and a binary search pick one.
    struct SectionCandidates {
        std::vector<std::uint16_t> mobs;
        std::vector<double> cumulative;
    };

    World* boundWorld_ = nullptr;
    std::optional<Query<MobTag, Transform, AmbientMob>> ambient_;
    std::optional<Query<AmbientMob, Lifetime>> escorts_;
    std::optional<Query<Transform, MobType, Spawner>> spawners_;
    std::optional<Query<Transform, MobType, NestWaves>> waveNests_;

    std::array<SectionCandidates, kSectionCount> candidates_;
    const ContentRegistry* candidateContent_ = nullptr;
    std::uint32_t candidateHash_ = 0;

    Census census_;
    double nextPopulationMillis_ = 0;

    /// Per-player neighbourhood counts and the despawn list, kept as members so
    /// the pass does not allocate once it has run a few times.
    std::vector<int> neighbours_;
    std::vector<Entity> doomed_;
    std::vector<Entity> scratchChildren_;
};

} // namespace flr

FLR_COMPONENT(flr::AmbientMob);
FLR_COMPONENT(flr::NestWaves);
