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

/// One line of a mob's table.
///
/// `rarityOffset` is relative to the MOB's tier, which is the part the original
/// data got wrong: it wrote a "common rose" and an "uncommon rose" as separate
/// absolute-rarity lines, so a mythic ladybug dropped common roses. What those
/// two lines meant was "the usual one, and occasionally one tier better", and
/// that is what an offset says. The actual tier of the drop is this offset plus
/// the upgrade/downgrade roll in rollDropRarity().
struct DropEntry {
    const char* petalId = nullptr;
    int rarityOffset = 0;
    double probability = 0.0;
    int minCount = 1;
    int maxCount = 1;
};

/// Longest table in the data is four lines; the slack is for new content.
inline constexpr std::size_t kDropEntriesPerMob = 6;

struct MobDropRow {
    const char* mobId = nullptr;
    DropEntry entries[kDropEntriesPerMob]{};
};

/// Every mob that drops anything.
///
/// Two things from the original are deliberately gone. Consumables (health
/// potions, speed boosts) are not a concept in this build -- the inventory
/// holds petals -- so those lines are dropped rather than reinterpreted as the
/// same-named petal. And the per-mob `guaranteed` flag is gone: it forced a
/// drop when every roll failed, on tables that already pay out 78% to 100% of
/// the time, so all it did was distort the rates it was bolted onto.
inline constexpr MobDropRow kMobDropTable[] = {
    {"bee",                   {{"stinger", 0, 0.30}, {"faster", 0, 0.50}, {"pollen", 0, 0.80}}},
    {"ladybug",               {{"rose", 0, 0.50}, {"rose", 1, 0.10}, {"light", 0, 0.50}}},
    {"soldier_ant",           {{"glass", 0, 0.80}, {"clover", 0, 0.10}, {"clover", 1, 0.10}}},
    {"worker_ant",            {{"corn", 0, 0.40}, {"leaf", 0, 0.40}}},
    {"baby_ant",              {{"light", 0, 0.40}, {"leaf", 0, 0.40}}},
    {"ant_hole",              {{"soil", 1, 0.50}}},
    {"fire_ant_hole",         {{"magnet", 0, 0.40}}},
    {"rock",                  {{"rock", 0, 0.40}}},
    {"dandelion",             {{"dandelion", 1, 0.40}}},
    {"soldier_fire_ant",      {{"bone", 0, 0.40}, {"bone", 1, 0.20}, {"yucca", 0, 0.40}}},
    {"shiny_ladybug",         {{"yggdrasil", 0, 0.40}, {"rose", 1, 0.20}, {"azalea", 0, 0.10}, {"dahlia", 0, 0.50}}},
    {"dark_ladybug",          {{"dahlia", 0, 0.40}, {"bone", 0, 0.40}, {"yin_yang", 0, 0.10}}},
    {"sandstorm",             {{"sand", 0, 0.40}, {"sand", 1, 0.20}, {"rock", 0, 0.60}, {"stick", 0, 0.25}}},
    {"cactus",                {{"cactus", 0, 0.70}, {"poison_cactus", 0, 0.30}}},
    {"beetle",                {{"lentil", 0, 0.20}, {"lentil", 1, 0.80}, {"iris", 0, 0.50}, {"iris", 1, 0.10}}},
    {"hel_beetle",            {{"bone", 0, 0.40}, {"bone", 1, 0.20}, {"blood_leaf", 0, 0.40}, {"blood_leaf", 1, 0.20}}},
    {"jellyfish",             {{"lightning", 0, 0.40}, {"lightning", 1, 0.20}, {"jelly", 0, 0.40}, {"jelly", 1, 0.20}}},
    {"bubble",                {{"bubble", 0, 0.50}, {"air", 1, 0.90}}},
    {"starfish",              {{"starfish", 0, 1.00}}},
    {"sponge_1",              {{"sponge", 0, 1.00}}},
    {"sponge_2",              {{"sponge", 0, 1.00}}},
    {"hornet",                {{"missile", 0, 1.00}, {"antennae", 0, 0.50}}},
    {"leafbug",               {{"leaf", 0, 1.00}}},
    {"bush",                  {{"leaf", 0, 0.50}, {"leaf", 1, 0.10}, {"raindrop", 0, 0.40}}},
    {"mantis",                {{"leaf", 0, 1.00}}},
    {"fly",                   {{"wing", 0, 1.00}}},
    {"moth",                  {{"wing", 0, 1.00}, {"bulb", 1, 0.50}}},
    {"target_dummy",          {{"square", 0, 1.00, 1, 3}}},
    {"garbage",               {{"gas", 1, 0.50}}},
    {"roach",                 {{"golden_leaf", 0, 1.00}, {"faster", 0, 0.50}}},
    {"spider",                {{"third_eye", 0, 0.05}, {"faster", 0, 0.50}}},
    {"javascript",            {{"javascript", 0, 1.00}, {"bomb", 0, 0.50}}},
    {"glitch",                {{"glitch", 0, 1.00}}},
    {"glitch_flower",         {{"glitch", 0, 1.00, 1, 2}, {"javascript", 0, 0.40}, {"bomb", 0, 0.40}, {"glass", 0, 0.40}}},
    {"desert_centipede",      {{"powder", 0, 0.50}}},
    {"desert_centipede_body", {{"powder", 0, 0.50}}},
    {"centipede",             {{"peas", 0, 0.50}}},
    {"centipede_body",        {{"peas", 0, 0.50}}},
    {"sun",                   {{"glass", 0, 1.00}, {"rock", 1, 0.50}, {"sand", 1, 0.50}, {"pollen", 1, 0.50}}},
    {"shell",                 {{"magnet", 0, 0.80}, {"shell", 0, 0.60}}},
    {"evil_centipede",        {{"blue_iris", 0, 0.35}, {"iris", 0, 0.50}}},
    {"evil_centipede_body",   {{"blue_iris", 0, 0.20}, {"iris", 0, 0.50}}},
    {"queen_ant",             {{"wing", 0, 0.50}, {"iris", 0, 0.50}, {"stinger", 0, 0.40}}},
    {"digger",                {{"uranium", 0, 0.50}, {"cutter", 0, 0.15}}},
};

/// kMobDropTable resolved against loaded content: ids become indices once,
/// and the per-tick path is an array lookup.
class DropTables {
public:
    struct Entry {
        std::uint16_t petalIndex = kNoPetal;
        int rarityOffset = 0;
        double probability = 0.0;
        int minCount = 1;
        int maxCount = 1;
    };

    /// Resolves against `content`. Idempotent, and re-runs itself only when the
    /// registry or its content hash changes, so a hot reload relinks and a
    /// steady state costs one comparison.
    void link(const ContentRegistry& content);

    bool linkedTo(const ContentRegistry& content) const;

    /// The table for a mob. Empty for a mob that drops nothing, and for an
    /// index the content does not define.
    const std::vector<Entry>& forMob(std::uint16_t mobIndex) const;

    /// Ids in kMobDropTable the loaded content does not define, one line each.
    /// The shipped data has some: the original table names two petals that were
    /// never added to petals.json.
    const std::vector<std::string>& unresolved() const { return unresolved_; }

private:
    std::vector<std::vector<Entry>> byMob_;
    std::vector<std::string> unresolved_;
    const ContentRegistry* content_ = nullptr;
    std::uint32_t contentHash_ = 0;
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
