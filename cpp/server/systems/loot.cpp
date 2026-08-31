#include "server/systems/loot.h"

#include <algorithm>

namespace flr {

// ---------------------------------------------------------------------------
// DropTables
// ---------------------------------------------------------------------------

bool DropTables::linkedTo(const ContentRegistry& content) const {
    return content_ == &content && contentHash_ == content.contentHash();
}

void DropTables::link(const ContentRegistry& content) {
    if (linkedTo(content)) return;
    content_ = &content;
    contentHash_ = content.contentHash();

    byMob_.assign(content.mobCount(), std::vector<Entry>{});
    unresolved_.clear();

    for (const MobDropRow& row : kMobDropTable) {
        const std::uint16_t mobIndex = content.mobIndex(row.mobId);
        if (mobIndex == kInvalidIndex || mobIndex >= byMob_.size()) {
            unresolved_.push_back(std::string("mob '") + row.mobId +
                                  "' has a drop table but no config");
            continue;
        }

        std::vector<Entry>& out = byMob_[mobIndex];
        for (const DropEntry& entry : row.entries) {
            // A short table leaves the tail of the row zero-initialised; the
            // null id is the terminator.
            if (entry.petalId == nullptr) break;

            const std::uint16_t petalIndex = content.petalIndex(entry.petalId);
            if (petalIndex == kInvalidIndex) {
                unresolved_.push_back(std::string("petal '") + entry.petalId + "' dropped by '" +
                                      row.mobId + "' is not in the content");
                continue;
            }

            Entry resolved;
            resolved.petalIndex = petalIndex;
            resolved.rarityOffset = entry.rarityOffset;
            resolved.probability = clamp(entry.probability, 0.0, 1.0);
            resolved.minCount = std::max(1, entry.minCount);
            resolved.maxCount = std::max(resolved.minCount, entry.maxCount);
            out.push_back(resolved);
        }
    }
}

const std::vector<DropTables::Entry>& DropTables::forMob(std::uint16_t mobIndex) const {
    static const std::vector<Entry> kNothing;
    if (mobIndex >= byMob_.size()) return kNothing;
    return byMob_[mobIndex];
}

// ---------------------------------------------------------------------------
// Rolls
// ---------------------------------------------------------------------------

Rarity LootSystem::rollDropRarity(Rarity mobRarity, int rarityOffset, double luck, Rng& rng) {
    const Rarity base = clampRarity(rarityIndex(mobRarity) + rarityOffset);

    // Luck adds to the roll rather than multiplying it: a stat whose value
    // depends on which tier you happen to be farming is one nobody can reason
    // about. The ceiling is what keeps it a nudge.
    const double baseUpgrade = dropUpgradeChance(base);
    const double upgrade = baseUpgrade <= 0.0
                               ? 0.0
                               : clamp(baseUpgrade + std::max(0.0, luck) * kLuckUpgradeBonus,
                                       0.0, kMaxDropUpgradeChance);
    if (rng.chance(upgrade)) return upgradeRarity(base);
    // Exclusive with the upgrade, so a drop moves at most one tier either way
    // and the two rolls cannot cancel into a coin flip nobody asked for.
    if (rng.chance(dropDowngradeChance(base))) return downgradeRarity(base);
    return base;
}

bool LootSystem::mayPickUp(const DropItem& drop, Entity player, double nowMillis) {
    if (drop.eligible.empty()) return true;
    if (nowMillis >= drop.freeForAllAtMillis) return true;
    for (const Entity e : drop.eligible) {
        if (e == player) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

Entity LootSystem::spawnDrop(World& world, std::uint16_t petalIndex, Rarity rarity, Vec2 position,
                             const std::vector<Entity>& eligible, double nowMillis) {
    if (petalIndex == kNoPetal) return NULL_ENTITY;

    const Entity e = world.create();
    world.add<DropTag>(e);
    world.add<Transform>(e, Transform{position, 0.0});
    // No Motion: a drop is furniture. The body is here only so the broadphase
    // files it and the pickup query can find it.
    world.add<Body>(e, Body{kDropBodyRadius, 1.0});

    DropItem item;
    item.configIndex = petalIndex;
    item.rarity = rarity;
    item.eligible = eligible;
    item.freeForAllAtMillis = nowMillis + kDropReservationSeconds * 1000.0;
    world.add<DropItem>(e, std::move(item));

    world.add<Lifetime>(e, Lifetime{kDropLifetimeSeconds});
    world.add<Replicated>(e, Replicated{net::EntityKind::Drop, 0, petalIndex, rarity, 0});
    if (netIds != nullptr) world.add<NetId>(e, NetId{netIds->next()});
    return e;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

void LootSystem::bind(World& world) {
    if (boundWorld_ == &world) return;
    boundWorld_ = &world;
    collectors_.emplace(world);
    collectors_->without<Dead>();
    drops_.emplace(world);
    corpses_.emplace(world);
    // A pet dying is its owner's petal breaking, not a kill, and a corpse that
    // has already paid out must never be walked again.
    corpses_->without<LootAwarded, Pet>();
}

void LootSystem::run(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                     Rng& rng, double nowMillis, double dt, CommandBuffer& commands,
                     EventQueue& events) {
    bind(world);
    tables_.link(content);
    pickups_.clear();

    expireDrops(dt, commands);
    collectPickups(world, grid, commands, events, nowMillis);
    // Deaths last, so a drop is on the ground for at least one snapshot before
    // anybody can be standing on it. A drop created and consumed inside one
    // tick never reaches a client, and the pickup effect has nothing to play.
    awardDeaths(world, rng, nowMillis);
}

void LootSystem::expireDrops(double dt, CommandBuffer& commands) {
    expired_.clear();
    drops_->each([&](Entity e, DropTag&, Lifetime& lifetime) {
        lifetime.remainingSeconds -= dt;
        if (lifetime.remainingSeconds <= 0.0) expired_.push_back(e);
    });
    for (const Entity e : expired_) commands.destroy(e);
}

void LootSystem::collectPickups(World& world, const SpatialGrid& grid, CommandBuffer& commands,
                                EventQueue& events, double nowMillis) {
    claimed_.clear();

    collectors_->each([&](Entity player, PlayerTag&, Transform& transform, PlayerModifiers& mods) {
        const Health* health = world.tryGet<Health>(player);
        if (health != nullptr && !health->alive()) return;

        // Magnetism widens the reach and nothing else. Pulling the drop in
        // would consume it before a snapshot ever carried it.
        const double reach = kDropPickupRadius + std::max(0.0, mods.magnetism);
        const double reachSq = reach * reach;
        grid.query(transform.position, reach, candidates_);

        for (const Entity candidate : candidates_) {
            const DropItem* drop = world.tryGet<DropItem>(candidate);
            if (drop == nullptr) continue;
            const Transform* at = world.tryGet<Transform>(candidate);
            if (at == nullptr) continue;
            if (distanceSq(at->position, transform.position) > reachSq) continue;
            if (!mayPickUp(*drop, player, nowMillis)) continue;
            // The destroy below is deferred, so the drop is still alive for the
            // rest of the pass: two players standing together would otherwise
            // each be handed the same petal.
            if (std::find(claimed_.begin(), claimed_.end(), candidate) != claimed_.end()) continue;
            claimed_.push_back(candidate);

            const Pickup pickup{player, drop->configIndex, drop->rarity};
            pickups_.push_back(pickup);
            if (onPickup) onPickup(pickup);

            const NetId* dropId = world.tryGet<NetId>(candidate);
            const NetId* playerId = world.tryGet<NetId>(player);
            if (dropId != nullptr && playerId != nullptr) {
                events.pickedUp(dropId->value, playerId->value, at->position);
            }
            commands.destroy(candidate);
        }
    });
}

void LootSystem::awardDeaths(World& world, Rng& rng, double nowMillis) {
    corpses_->collect(corpseList_);
    for (const Entity corpse : corpseList_) {
        const MobType* type = world.tryGet<MobType>(corpse);
        const Transform* transform = world.tryGet<Transform>(corpse);
        if (type == nullptr || transform == nullptr) continue;

        // Read the corpse out in full first. Everything below is a structural
        // change, and these pointers are into an archetype column.
        const std::uint16_t mobIndex = type->configIndex;
        const Rarity mobRarity = type->rarity;
        const Vec2 at = transform->position;

        // Loot goes to everyone who fought it, not to whoever landed the last
        // hit; the killer only supplies the luck that biases the tier.
        eligible_.clear();
        if (const Bounty* bounty = world.tryGet<Bounty>(corpse)) {
            for (const Bounty::Share& share : bounty->contributors) {
                if (share.damage <= 0.0) continue;
                if (!world.has<PlayerTag>(share.player)) continue;
                eligible_.push_back(share.player);
            }
        }

        double luck = 0.0;
        if (const Dead* dead = world.tryGet<Dead>(corpse)) {
            if (const PlayerModifiers* mods = world.tryGet<PlayerModifiers>(dead->killer)) {
                luck = mods->luck;
            }
        }

        const std::vector<DropTables::Entry>& table = tables_.forMob(mobIndex);

        // Marked before a single drop is rolled: a corpse with an empty table
        // must be just as finished as one that paid out.
        world.add<LootAwarded>(corpse);

        int produced = 0;
        for (const DropTables::Entry& entry : table) {
            if (produced >= kMaxDropsPerMob) break;
            if (!rng.chance(entry.probability)) continue;

            const int count = rng.rangeInt(entry.minCount, entry.maxCount);
            for (int i = 0; i < count && produced < kMaxDropsPerMob; ++i) {
                const Rarity rarity = rollDropRarity(mobRarity, entry.rarityOffset, luck, rng);
                spawnDrop(world, entry.petalIndex, rarity, at + rng.insideCircle(kDropScatterRadius),
                          eligible_, nowMillis);
                ++produced;
            }
        }
    }
}

} // namespace flr
