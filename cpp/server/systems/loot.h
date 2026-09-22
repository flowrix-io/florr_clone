#pragma once
// What a dead mob leaves behind, and who is allowed to take it.
//
// A drop is a real entity: it sits on the ground, it is replicated, it expires,
// and it is picked up by walking over it. That last part is the whole reason
// magnetism is a RADIUS and not a pull force -- dragging the item into the
// player consumes it before any snapshot ever carried it, and the client is
// left with nothing to animate.
//
// Eligibility exists so that killing a mob is worth doing. Only the ranked
// contributors see a normal mob drop, and each of them may collect it once.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "server/replication.h"
#include "server/squads.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"

namespace flix {

// ---------------------------------------------------------------------------
// Components owned by this system
// ---------------------------------------------------------------------------

/// Set on a mob once its drops have been rolled.
///
/// Death is a component that survives to the end of the tick so later systems
/// can read it, which means "is dead" is not by itself a one-shot signal. This
/// tag is: without it a mob whose corpse lingers for a second tick would pay
/// out its whole table again.
struct LootAwarded {};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/// TypeScript rarity-specific item expiry, in seconds.
inline constexpr std::array<double, kRarityCount> kDropLifetimeByRarity = {
    10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 80.0, 120.0, 300.0, 600.0,
};

/// Collision radius a drop is given. It has no Motion and nothing pushes it;
/// the body exists so the broadphase files it and the pickup query finds it.
inline constexpr double kDropBodyRadius = 14.0;

/// Half-size the per-tick wall push resolves a drop with: the reference's
/// DROPPED_ITEM_RADIUS, a 30x30 hitbox. Deliberately not the body above -- that
/// one only has to be found by the pickup query, this one decides whether an
/// item ends up embedded in a rock.
inline constexpr double kDropWallRadius = 15.0;

// ---------------------------------------------------------------------------
// The drop table
// ---------------------------------------------------------------------------

/// JSON-authored mob drop tables resolved against loaded content: ids become
/// indices once, and the per-tick path is an array lookup. The source data is
/// src/mob_drops.json, shared with the TypeScript server.
class DropTables {
public:
    /// What one authored row hands out.
    ///
    /// A consumable has no native inventory slot and the `random` sentinel
    /// names no petal at all, yet both stay in the table: a row is a drop this
    /// mob HAS, and above common every drop it has comes out. Dropping such a
    /// row at load time would quietly shorten the mob's advertised table.
    enum class Kind : std::uint8_t {
        Petal = 0,     ///< `petalIndex` names the item outright
        RandomPetal,   ///< resolved per copy against droppablePetals()
        Consumable,    ///< rolled like any other row, then handed out as nothing
    };

    struct Entry {
        std::uint16_t petalIndex = kNoPetal;
        Kind kind = Kind::Petal;
        /// Authored rarity index (legacy field name). Read only on a common
        /// mob: above it a drop is graded against the mob that left it.
        int rarityOffset = 0;
        /// On a common mob, the chance the row drops at all. On every mob
        /// above one the row always drops and this is its QUALITY instead --
        /// see LootSystem::scaleDropRarity.
        double probability = 0.0;
        int minCount = 1;
        int maxCount = 1;
    };

    /// Parses `path`, then resolves its ids against `content`. The JSON's
    /// authored item rarities remain absolute rarity indices.
    bool load(const ContentRegistry& content, const std::string& path, std::string& errorOut);

    /// Resolves previously loaded data against `content`. If callers did not
    /// explicitly load a table (unit tests), this finds the staged default.
    void link(const ContentRegistry& content);

    bool linkedTo(const ContentRegistry& content) const;

    /// The authored rows for a mob, one per line of JSON. Empty for a mob
    /// that drops nothing, and for an index the content does not define.
    /// This is the common-mob table: each row is an independent chance.
    const std::vector<Entry>& forMob(std::uint16_t mobIndex) const;

    /// The same table with one row per drop TYPE, for every mob above common.
    ///
    /// Those mobs hand out every row they have, so the authored habit of
    /// giving one petal two lines -- "rose common 0.5" beside "rose uncommon
    /// 0.1", which used to be two independent chances at one item -- would
    /// otherwise pay out two roses per kill. The lines merge into one drop
    /// whose probability is the chance that either of them would have fired.
    const std::vector<Entry>& guaranteedForMob(std::uint16_t mobIndex) const;

    /// Mob ids in the source table the loaded content does not define.
    const std::vector<std::string>& unresolved() const { return unresolved_; }

    /// The petals a `random` row may hand out, in catalogue order: everything
    /// except admin petals, the two cutters, and the eggs of mobs marked
    /// noEggDrop. One list, because the reference keeps one -- the item spawner
    /// used to re-derive the rule and got it wrong.
    const std::vector<std::uint16_t>& droppablePetals() const { return droppable_; }

    /// One uniformly chosen droppable petal, for the `random` sentinel rows.
    /// Rolled per COPY rather than per row, so an apex garbage leaves ten
    /// different petals rather than ten of one.
    std::uint16_t randomPetal(Rng& rng) const;

private:
    struct SourceEntry {
        std::string mobId;
        std::string petalId;
        Kind kind = Kind::Petal;
        int rarityOffset = 0;  ///< authored rarity index (legacy field name)
        double probability = 0.0;
        int minCount = 1;
        int maxCount = 1;
    };

    void resolve(const ContentRegistry& content);
    void loadDefault(const ContentRegistry& content);

    std::vector<SourceEntry> source_;
    std::vector<std::vector<Entry>> byMob_;
    std::vector<std::vector<Entry>> mergedByMob_;
    std::vector<std::string> unresolved_;
    std::vector<std::uint16_t> droppable_;
    std::uint16_t basicPetal_ = kNoPetal;   ///< the fallback when nothing is droppable
    const ContentRegistry* content_ = nullptr;
    std::uint32_t contentHash_ = 0;
    bool loaded_ = false;
};

// ---------------------------------------------------------------------------
// LootSystem
// ---------------------------------------------------------------------------

class LootSystem {
public:
    /// One petal that changed hands this tick. Applying it to the account is
    /// the runtime's job -- this system owns the world, not the database.
    struct Pickup {
        Entity player = NULL_ENTITY;
        std::uint16_t petalIndex = kNoPetal;
        Rarity rarity = Rarity::Common;
    };

    /// Wire ids for the drops this system creates. Null in a unit test; the
    /// runtime must point it at the server's one allocator or drops are
    /// invisible to every client while still being pickable up.
    NetIdAllocator* netIds = nullptr;

    /// Who ranks together when a corpse is shared out. Null means nobody is
    /// squadded, which is the ordinary case and the whole of what a unit test
    /// needs; see server/loot_eligibility.h for what a squad changes.
    const SquadEntityIndex* squads = nullptr;

    /// The tile world the per-tick pass pushes drops out of. Null in a unit
    /// test, where there is no map; the runtime MUST point it at the server's
    /// terrain or a drop scattered into a rock or into water stays there for
    /// its whole lifetime, visible and out of reach.
    const Terrain* terrain = nullptr;

    /// Called for each pickup as it happens, in addition to pickups(). Either
    /// is enough; the callback exists for a runtime that would rather not walk
    /// the list, the list for one that would rather not own a closure.
    std::function<void(const Pickup&)> onPickup;

    /// Loads the shared JSON table during server startup. A missing or invalid
    /// file is fatal there instead of silently leaving every mob lootless.
    bool loadTables(const ContentRegistry& content, const std::string& path, std::string& errorOut) {
        return tables_.load(content, path, errorOut);
    }

    void run(World& world, const SpatialGrid& grid, const ContentRegistry& content, Rng& rng,
             double nowMillis, double dt, CommandBuffer& commands, EventQueue& events);

    /// Everything picked up during the last run(). Cleared at the start of each.
    const std::vector<Pickup>& pickups() const { return pickups_; }

    /// Places one drop and returns it. `eligible` may be empty, which means
    /// anyone may take it immediately.
    Entity spawnDrop(World& world, std::uint16_t petalIndex, Rarity rarity, Vec2 position,
                     Realm realm, const std::vector<Entity>& eligible, double nowMillis);

    /// Apply the whole drop rarity pipeline to one table row.
    static Rarity rollDropRarity(Rarity authoredRarity, Rarity mobRarity, double probability,
                                 Rng& rng);

    /// The first half of that pipeline: where in the mob's band the drop
    /// lands. Above common the row's `probability` is spent here rather than
    /// on whether it drops -- two independent holds at p each, so the item
    /// comes out at the mob's own tier with p^2, one tier below with 2p(1-p)
    /// and two below with (1-p)^2. Rolled once per winning row, upstream of
    /// the apex quantity loop, which is why it is separable at all -- ten apex
    /// copies share one base rarity.
    static Rarity scaleDropRarity(Rarity authoredRarity, Rarity mobRarity, double probability,
                                  Rng& rng);

    /// The second half, rolled per copy: a common mob's downgrade roll, an
    /// ultra mob's one-in-five throttle on its own tier, and the apex cap. Nothing is promoted at any tier -- a mob never
    /// leaves an item above its own rarity -- so the only rarity this can
    /// hand back above the mob's own is a common mob's authored uncommon row,
    /// which the table asked for on purpose.
    static Rarity finishDropRarity(Rarity baseRarity, Rarity mobRarity, Rng& rng);

    /// Whether `player` may take this drop right now.
    /// Whether this flower may take a copy. `owner` is the connection behind
    /// the body (0 for a bot): a reservation follows the PLAYER, not the body
    /// they happened to be wearing when it was made, because a body does not
    /// survive its owner's death.
    static bool mayPickUp(const DropItem& drop, Entity player, net::ConnectionId owner,
                          double nowMillis);

    const DropTables& tables() const { return tables_; }

private:
    void bind(World& world);
    void collectPickups(World& world, const SpatialGrid& grid, CommandBuffer& commands,
                        EventQueue& events, double nowMillis);
    /// The drops awardDeaths has just made, swept without the broadphase.
    ///
    /// The grid this system is handed was built before it ran, so a drop born
    /// this tick is not in it. The reference has no broadphase here at all --
    /// it re-walks the live item list per player, inside the same pipeline step
    /// that killed the mob -- so its loot is taken on the tick it spawns.
    void collectFresh(World& world, CommandBuffer& commands, EventQueue& events, double nowMillis);
    /// One flower against one drop: the shared body of both pickup passes.
    void tryCollect(World& world, Entity player, Vec2 playerPosition, double reachSq,
                    Entity candidate, CommandBuffer& commands, EventQueue& events,
                    double nowMillis);
    /// Per-tick item maintenance, in the reference's order: wall push, bounds,
    /// expiry. The push is not a nicety -- nothing resolves the spawn scatter.
    void maintainDrops(double dt, CommandBuffer& commands);
    void awardDeaths(World& world, const ContentRegistry& content, Rng& rng, double nowMillis);
    /// One full pass of a mob's table into `selected_`. The caller picks
    /// which table: the authored rows for a common mob, the merged one for
    /// every mob above it, since those drop one of everything they have.
    void rollTable(const std::vector<DropTables::Entry>& table, Rarity mobRarity, Rng& rng);

    World* boundWorld_ = nullptr;
    std::optional<Query<PlayerTag, Transform, PlayerModifiers>> collectors_;
    std::optional<Query<DropTag, Transform, Lifetime>> drops_;
    std::optional<Query<MobTag, Dead, MobType, Transform>> corpses_;

    DropTables tables_;
    std::vector<Pickup> pickups_;

    /// Reused every tick so the steady state does not allocate.
    std::vector<Entity> candidates_;
    std::vector<Entity> expired_;
    std::vector<Entity> fresh_;
    std::vector<Entity> corpseList_;
    std::vector<Bounty::Share> ranked_;
    std::vector<Entity> eligible_;
    std::vector<const DropTables::Entry*> selected_;
};

} // namespace flix

FLIX_COMPONENT(flix::LootAwarded);
