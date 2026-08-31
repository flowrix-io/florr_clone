#pragma once
// What a dead mob leaves behind, and who is allowed to take it.
//
// A drop is a real entity: it sits on the ground, it is replicated, it expires,
// and it is picked up by walking over it. That last part is the whole reason
// magnetism is a RADIUS and not a pull force -- dragging the item into the
// player consumes it before any snapshot ever carried it, and the client is
// left with nothing to animate.
//
// Eligibility exists so that killing a mob is worth doing. For a reservation
// window only the players who actually damaged it may pick its drops up; after
// that the drop is free for anyone, so a player who wandered off does not leave
// loot nobody can ever collect.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "server/replication.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"
#include "shared/game/spatial.h"

namespace flr {

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

/// How long the players who fought a mob keep its drops to themselves. Long
/// enough to finish the fight and walk over, short enough that a drop left
/// behind is not dead weight on the map for its whole lifetime.
inline constexpr double kDropReservationSeconds = 12.0;

/// Most drops one mob can produce, however generous its table or how many
/// quantities it rolled. A cap here is what keeps a boss from carpeting the
/// ground with entities that all have to be replicated.
inline constexpr int kMaxDropsPerMob = 4;

/// Collision radius a drop is given. It has no Motion and nothing pushes it;
/// the body exists so the broadphase files it and the pickup query finds it.
inline constexpr double kDropBodyRadius = 14.0;

/// How far drops are scattered around the corpse, so a mob that drops three
/// petals does not stack them on one pixel.
inline constexpr double kDropScatterRadius = 26.0;

/// Upgrade chance one point of luck buys, in absolute probability.
///
/// The original gave one percentage point per luck point, which no player could
/// ever notice -- the best clover in the game moved the rate by two parts in a
/// thousand. Ten points makes the stat readable while still being a nudge to a
/// roll rather than a replacement for it.
inline constexpr double kLuckUpgradeBonus = 0.10;

/// Ceiling on the upgrade roll. Stacked luck must never make an upgrade
/// certain: a drop table with no downside stops being a drop table.
inline constexpr double kMaxDropUpgradeChance = 0.90;

// ---------------------------------------------------------------------------
// The drop table
// ---------------------------------------------------------------------------

/// JSON-authored mob drop tables resolved against loaded content: ids become
/// indices once, and the per-tick path is an array lookup. The source data is
/// src/mob_drops.json, shared with the TypeScript server.
class DropTables {
public:
    struct Entry {
        std::uint16_t petalIndex = kNoPetal;
        int rarityOffset = 0;
        double probability = 0.0;
        int minCount = 1;
        int maxCount = 1;
    };

    /// Parses `path`, then resolves its ids against `content`. The JSON keeps
    /// authored item rarities; they become offsets from the killed mob's tier
    /// for the native drop roll.
    bool load(const ContentRegistry& content, const std::string& path, std::string& errorOut);

    /// Resolves previously loaded data against `content`. If callers did not
    /// explicitly load a table (unit tests), this finds the staged default.
    void link(const ContentRegistry& content);

    bool linkedTo(const ContentRegistry& content) const;

    /// The table for a mob. Empty for a mob that drops nothing, and for an
    /// index the content does not define.
    const std::vector<Entry>& forMob(std::uint16_t mobIndex) const;

    /// Mob ids in the source table the loaded content does not define.
    const std::vector<std::string>& unresolved() const { return unresolved_; }

private:
    struct SourceEntry {
        std::string mobId;
        std::string petalId;
        int rarityOffset = 0;
        double probability = 0.0;
        int minCount = 1;
        int maxCount = 1;
    };

    void resolve(const ContentRegistry& content);
    void loadDefault(const ContentRegistry& content);

    std::vector<SourceEntry> source_;
    std::vector<std::vector<Entry>> byMob_;
    std::vector<std::string> unresolved_;
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
                     const std::vector<Entity>& eligible, double nowMillis);

    /// The tier one drop rolls at: the mob's tier plus the entry's offset, then
    /// one upgrade roll (raised by the killer's luck) or one downgrade roll.
    static Rarity rollDropRarity(Rarity mobRarity, int rarityOffset, double luck, Rng& rng);

    /// Whether `player` may take this drop right now.
    static bool mayPickUp(const DropItem& drop, Entity player, double nowMillis);

    const DropTables& tables() const { return tables_; }

private:
    void bind(World& world);
    void collectPickups(World& world, const SpatialGrid& grid, CommandBuffer& commands,
                        EventQueue& events, double nowMillis);
    void expireDrops(double dt, CommandBuffer& commands);
    void awardDeaths(World& world, Rng& rng, double nowMillis);

    World* boundWorld_ = nullptr;
    std::optional<Query<PlayerTag, Transform, PlayerModifiers>> collectors_;
    std::optional<Query<DropTag, Lifetime>> drops_;
    std::optional<Query<MobTag, Dead, MobType, Transform>> corpses_;

    DropTables tables_;
    std::vector<Pickup> pickups_;

    /// Reused every tick so the steady state does not allocate.
    std::vector<Entity> candidates_;
    std::vector<Entity> claimed_;
    std::vector<Entity> expired_;
    std::vector<Entity> corpseList_;
    std::vector<Entity> eligible_;
};

} // namespace flr

FLR_COMPONENT(flr::LootAwarded);
