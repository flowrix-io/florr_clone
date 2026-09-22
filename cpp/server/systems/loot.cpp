#include "server/systems/loot.h"

#include <algorithm>
#include <fstream>

#include "server/loot_eligibility.h"
#include "shared/core/json.h"

namespace flix {

// ---------------------------------------------------------------------------
// DropTables
// ---------------------------------------------------------------------------

bool DropTables::linkedTo(const ContentRegistry& content) const {
    return loaded_ && content_ == &content && contentHash_ == content.contentHash();
}

bool DropTables::load(const ContentRegistry& content, const std::string& path, std::string& errorOut) {
    Json root;
    std::string parseError;
    if (!Json::parseFile(path, root, parseError)) {
        errorOut = path + ": " + parseError;
        return false;
    }
    if (!root.isObject()) {
        errorOut = path + ": top level is not an object";
        return false;
    }

    std::vector<SourceEntry> loaded;
    for (const std::string& mobId : root.keys()) {
        const Json& table = root[mobId];
        if (!table.isObject() || !table["drops"].isArray()) {
            errorOut = path + ": table for '" + mobId + "' must contain a drops array";
            return false;
        }

        for (const Json& entry : table["drops"].items()) {
            if (!entry.isObject()) {
                errorOut = path + ": a drop for '" + mobId + "' is not an object";
                return false;
            }
            const std::string type = entry["type"].asString();
            const std::string itemId = entry["itemType"].asString();
            const std::string rarity = entry["rarity"].asString();
            if (itemId.empty() || rarity.empty() || !entry["probability"].isNumber()) {
                errorOut = path + ": a drop for '" + mobId + "' is missing itemType, rarity, or probability";
                return false;
            }

            int rarityOffset = -1;
            for (int i = 0; i < kRarityCount; ++i) {
                if (rarity == kRarityNames[static_cast<std::size_t>(i)]) {
                    rarityOffset = i;
                    break;
                }
            }
            if (rarityOffset < 0) {
                errorOut = path + ": drop '" + itemId + "' for '" + mobId + "' has an unknown rarity";
                return false;
            }

            SourceEntry source;
            source.mobId = mobId;
            source.petalId = itemId;
            // Anything not explicitly a consumable is a petal, which is how the
            // reference reads the field. Every row is kept whatever its kind:
            // the row list is what the mob HAS, and above common a mob leaves
            // one of everything it has.
            source.kind = type == "consumable" ? Kind::Consumable
                          : itemId == "random" ? Kind::RandomPetal
                                               : Kind::Petal;
            source.rarityOffset = rarityOffset;
            source.probability = clamp(entry["probability"].asDouble(), 0.0, 1.0);
            source.minCount = std::max(1, entry["minQuantity"].asInt(1));
            source.maxCount = std::max(source.minCount, entry["maxQuantity"].asInt(source.minCount));
            loaded.push_back(std::move(source));
        }
    }

    source_ = std::move(loaded);
    loaded_ = true;
    content_ = nullptr;
    contentHash_ = 0;
    resolve(content);
    errorOut.clear();
    return true;
}

void DropTables::loadDefault(const ContentRegistry& content) {
    static constexpr const char* kCandidates[] = {
        "data/mob_drops.json",
        "src/mob_drops.json",
        "../src/mob_drops.json",
        "../../src/mob_drops.json",
    };

    for (const char* candidate : kCandidates) {
        std::ifstream probe(candidate, std::ios::binary);
        if (!probe) continue;
        std::string ignored;
        if (load(content, candidate, ignored)) return;
    }

    // A standalone system test can have no data directory at all. Mark the
    // attempt so the steady-state tick does not repeatedly hit the filesystem.
    loaded_ = true;
    resolve(content);
}

void DropTables::link(const ContentRegistry& content) {
    if (!loaded_) loadDefault(content);
    if (linkedTo(content)) return;
    resolve(content);
}

void DropTables::resolve(const ContentRegistry& content) {
    content_ = &content;
    contentHash_ = content.contentHash();

    byMob_.assign(content.mobCount(), std::vector<Entry>{});
    unresolved_.clear();

    for (const SourceEntry& source : source_) {
        const std::uint16_t mobIndex = content.mobIndex(source.mobId);
        if (mobIndex == kInvalidIndex || mobIndex >= byMob_.size()) {
            unresolved_.push_back(std::string("mob '") + source.mobId +
                                  "' has a drop table but no config");
            continue;
        }

        Entry resolved;
        // A row whose item this build cannot hand out -- a consumable, the
        // Random sentinel, an id the petal registry does not know -- still
        // belongs in the table: on a common mob it is an independent roll and
        // above one it is a guaranteed drop. Only the payout is missing, and
        // kNoPetal is already what spawnDrop treats as "nothing".
        resolved.kind = source.kind;
        resolved.petalIndex =
            source.kind == Kind::Petal ? content.petalIndex(source.petalId) : kNoPetal;
        resolved.rarityOffset = source.rarityOffset;
        resolved.probability = source.probability;
        resolved.minCount = source.minCount;
        resolved.maxCount = source.maxCount;
        byMob_[mobIndex].push_back(resolved);
    }

    // The TypeScript registry auto-generates a guaranteed common egg row for
    // every non-pet mob that permits eggs. It is runtime content, so it is not
    // present in mob_drops.json and must be restored after linking.
    for (std::size_t i = 0; i < content.mobCount(); ++i) {
        const MobConfig& mob = content.mob(static_cast<std::uint16_t>(i));
        if (mob.noEggDrop ||
            (mob.id.size() >= 4 && mob.id.compare(mob.id.size() - 4, 4, "_pet") == 0)) continue;
        const std::uint16_t egg = content.petalIndex(mob.id + "_egg");
        if (egg == kInvalidIndex) continue;
        auto& rows = byMob_[i];
        auto existing = std::find_if(rows.begin(), rows.end(), [&](const Entry& row) {
            return row.kind == Kind::Petal && row.petalIndex == egg &&
                   row.rarityOffset == rarityIndex(Rarity::Common);
        });
        if (existing != rows.end()) {
            existing->probability = 1.0;
        } else {
            Entry row;
            row.petalIndex = egg;
            row.rarityOffset = rarityIndex(Rarity::Common);
            row.probability = 1.0;
            rows.insert(rows.begin(), row);
        }
    }

    // Above common every row pays out, so the authored habit of giving one
    // petal two lines -- a common rose beside an uncommon one -- would leave
    // two roses on the ground per kill. They are one drop TYPE, so they fold
    // into one row here, once, rather than per corpse. Built after the egg
    // pass above so a hand-authored egg row cannot come back as a second egg.
    mergedByMob_.assign(byMob_.size(), std::vector<Entry>{});
    for (std::size_t i = 0; i < byMob_.size(); ++i) {
        std::vector<Entry>& merged = mergedByMob_[i];
        for (const Entry& row : byMob_[i]) {
            // Only a NAMED petal can collide. A consumable and the `random`
            // sentinel both resolve to kNoPetal, and folding those together
            // would merge two unrelated rows -- sun drops two consumables.
            Entry* into = nullptr;
            if (row.kind == Kind::Petal && row.petalIndex != kNoPetal) {
                for (Entry& candidate : merged) {
                    if (candidate.kind == row.kind && candidate.petalIndex == row.petalIndex) {
                        into = &candidate;
                        break;
                    }
                }
            }
            if (into == nullptr) {
                merged.push_back(row);
                continue;
            }
            // The chance either authored line would have fired, which is what
            // those two lines meant together before the merge.
            into->probability = 1.0 - (1.0 - into->probability) * (1.0 - row.probability);
            into->rarityOffset = std::max(into->rarityOffset, row.rarityOffset);
            into->minCount = std::max(into->minCount, row.minCount);
            into->maxCount = std::max(into->maxCount, row.maxCount);
        }
    }

    // What a `random` row may turn into. A property of the content rather than
    // of a kill, so it is derived here once: admin petals, the two cutters and
    // the eggs of mobs that never lay one are excluded however they are
    // authored, and every other petal is equally likely.
    droppable_.clear();
    for (const std::uint16_t index : content.petalDisplayOrder()) {
        const PetalConfig& petal = content.petal(index);
        if (petal.isAdminPetal) continue;
        if (petal.id == "cutter" || petal.id == "lightning_cutter") continue;
        // A magic petal is CONVERTED into, never dropped. Leaving it in the
        // pool would put an apex magic leaf in front of a flower wearing a
        // common orb, straight past the gate the orb exists to be.
        if (content.isMagicForm(index)) continue;
        if (petal.id.size() > 4 && petal.id.compare(petal.id.size() - 4, 4, "_egg") == 0) {
            const std::uint16_t layer = content.mobIndex(petal.id.substr(0, petal.id.size() - 4));
            if (layer != kInvalidIndex && content.mob(layer).noEggDrop) continue;
        }
        droppable_.push_back(index);
    }
    basicPetal_ = content.petalIndex("basic");
}

const std::vector<DropTables::Entry>& DropTables::forMob(std::uint16_t mobIndex) const {
    static const std::vector<Entry> kNothing;
    if (mobIndex >= byMob_.size()) return kNothing;
    return byMob_[mobIndex];
}

const std::vector<DropTables::Entry>& DropTables::guaranteedForMob(std::uint16_t mobIndex) const {
    static const std::vector<Entry> kNothing;
    if (mobIndex >= mergedByMob_.size()) return kNothing;
    return mergedByMob_[mobIndex];
}

std::uint16_t DropTables::randomPetal(Rng& rng) const {
    if (droppable_.empty()) return basicPetal_;
    return droppable_[rng.below(static_cast<std::uint32_t>(droppable_.size()))];
}

// ---------------------------------------------------------------------------
// Rolls
// ---------------------------------------------------------------------------

Rarity LootSystem::scaleDropRarity(Rarity authoredRarity, Rarity mobRarity, double probability,
                                   Rng& rng) {
    // A common mob has no tiers beneath it to slide down, so its rows keep the
    // rarity the table authored them at and `probability` stays what it has
    // always been there: the chance the row drops at all.
    if (mobRarity == Rarity::Common) return authoredRarity;

    // Above common the row is GUARANTEED, and its probability buys quality
    // instead. Two independent holds, each kept with chance p: the drop lands
    // at the mob's own tier with p^2, one below with 2p(1-p), two below with
    // (1-p)^2. So a bee's pollen (0.8) is worth the bee's own tier two kills
    // in three, while its stinger (0.3) comes out two tiers down about half
    // the time and at full tier one kill in eleven -- you always get the
    // stinger, just rarely a good one. The authored rarity is not consulted
    // at all: above common a drop is graded against the mob that left it.
    const double keep = clamp(probability, 0.0, 1.0);
    int tier = rarityIndex(mobRarity);
    if (!rng.chance(keep)) --tier;
    if (!rng.chance(keep)) --tier;
    return clampRarity(tier);
}

Rarity LootSystem::finishDropRarity(Rarity baseRarity, Rarity mobRarity, Rng& rng) {
    Rarity base = baseRarity;

    // NOTHING is promoted here, at any tier. A mob never leaves an item above
    // its own rarity, so the lucky upgrade roll is gone from both arms it used
    // to live in: the common mob's mutually exclusive pair, and ultra's
    // multiplied roll, which was the one exception the ladder allowed.
    //
    // What survives is the DOWNGRADE, and only on a common mob. Above common
    // scaleDropRarity's band already spent the row's probability on how far
    // DOWN the item lands, and rolling again here would demote it twice; a
    // common mob has no band -- its row keeps the rarity the table authored,
    // and a deliberate uncommon row (ladybug's rose, bubble's air) still pays
    // out as authored -- so this is the only place it can slip.
    if (mobRarity == Rarity::Common && rng.chance(dropDowngradeChance(base))) {
        base = downgradeRarity(base);
    }

    // An ultra mob's own tier is throttled on top of the band: four drops in
    // five that graded ultra slip to mythic, so an ultra petal off an ultra
    // mob is five times rarer than the row's probability alone would say. A
    // demotion, so nothing here can breach the ceiling above.
    if (mobRarity == Rarity::Ultra && base == Rarity::Ultra &&
        !rng.chance(kUltraOwnTierKeepChance)) {
        base = downgradeRarity(base);
    }

    // Apex mobs explicitly cap item rarity at unique.
    if (mobRarity == Rarity::Apex && base == Rarity::Apex) base = Rarity::Unique;
    return base;
}

Rarity LootSystem::rollDropRarity(Rarity authoredRarity, Rarity mobRarity, double probability,
                                  Rng& rng) {
    return finishDropRarity(scaleDropRarity(authoredRarity, mobRarity, probability, rng), mobRarity,
                            rng);
}

bool LootSystem::mayPickUp(const DropItem& drop, Entity player, net::ConnectionId owner,
                           double nowMillis) {
    (void)nowMillis;
    // By the OWNER where there is one, so a player who died between the kill
    // and the walk back still collects what was reserved for them -- and
    // still cannot collect it twice by dying again. See LootClaim.
    if (claimed(drop.pickedUpBy, player, owner)) return false;
    return drop.eligible.empty() || claimed(drop.eligible, player, owner);
}

// ---------------------------------------------------------------------------
// The magic orb's conversion
// ---------------------------------------------------------------------------

namespace {

/// The best magic orb on a flower's ACTIVE bar, or kRarityCount for none.
///
/// Active slots only, for the reason every other worn bonus reads only those:
/// a stashed orb is not a worn one. The BEST of several rather than the first,
/// because two orbs are one conversion, at the better tier.
int wornOrbTier(const World& world, Entity player, std::uint16_t orbIndex) {
    if (orbIndex == kInvalidIndex) return kRarityCount;
    const Loadout* loadout = world.tryGet<Loadout>(player);
    if (loadout == nullptr) return kRarityCount;
    int best = kRarityCount;
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        const LoadoutSlot& slot = loadout->slots[static_cast<std::size_t>(i)];
        if (slot.empty() || slot.configIndex != orbIndex) continue;
        const int tier = rarityIndex(slot.rarity);
        if (best == kRarityCount || tier > best) best = tier;
    }
    return best;
}

} // namespace

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

Entity LootSystem::spawnDrop(World& world, std::uint16_t petalIndex, Rarity rarity, Vec2 position,
                             Realm realm, const std::vector<Entity>& eligible, double nowMillis) {
    if (petalIndex == kNoPetal) return NULL_ENTITY;

    const Entity e = world.create();
    world.add<DropTag>(e);
    world.add<Transform>(e, Transform{position, 0.0, realm});
    // No Motion: a drop is furniture. The body is here only so the broadphase
    // files it and the pickup query can find it.
    world.add<Body>(e, Body{kDropBodyRadius, 1.0});

    DropItem item;
    item.configIndex = petalIndex;
    item.rarity = rarity;
    // Resolved to CLAIMS here, where the world is in hand: the ranking that
    // produced this list deals in bodies, and a body is not who a drop
    // belongs to.
    item.eligible.clear();
    item.eligible.reserve(eligible.size());
    for (const Entity claimant : eligible) {
        const PlayerAccount* account = world.tryGet<PlayerAccount>(claimant);
        item.eligible.push_back(
            LootClaim{claimant, account != nullptr ? account->connection : 0});
    }
    world.add<DropItem>(e, std::move(item));

    world.add<Lifetime>(e, Lifetime{kDropLifetimeByRarity[static_cast<std::size_t>(rarityIndex(rarity))]});
    world.add<Replicated>(e, Replicated{net::EntityKind::Drop, 0, petalIndex, rarity, 0});
    if (netIds != nullptr) world.add<NetId>(e, NetId{netIds->next()});
    return e;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

namespace {

/// How far a flower reaches for loot.
///
/// Magnetism widens the reach and nothing else. Pulling the drop in would
/// consume it before a snapshot ever carried it.
double pickupReach(const World& world, Entity player, const PlayerModifiers& mods) {
    const Body* body = world.tryGet<Body>(player);
    const double base = body != nullptr ? body->radius * 2.0 : kDropPickupRadius;
    return base + std::max(0.0, mods.magnetism);
}

} // namespace

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

    maintainDrops(dt, commands);
    collectPickups(world, grid, commands, events, nowMillis);
    awardDeaths(world, content, rng, nowMillis);
    // Deaths pay out after the broadphase pass, but their loot is still
    // collectable this tick: the reference rolls a mob's drops inside the very
    // player step that then tests pickups, so a magnet flower standing on its
    // own kill takes the item before any snapshot could have carried it. The
    // client is not left with nothing to animate -- the pickup cue carries the
    // drop's position and look for exactly this case.
    collectFresh(world, commands, events, nowMillis);
}

void LootSystem::maintainDrops(double dt, CommandBuffer& commands) {
    expired_.clear();
    drops_->each([&](Entity e, DropTag&, Transform& transform, Lifetime& lifetime) {
        // Nothing resolves the +-50 spawn scatter -- neither server does, by
        // design -- so this push is the only way a drop that landed inside a
        // rock, a wall or water ever becomes reachable again. Pickup is a plain
        // distance test, and a tile face is far wider than its reach.
        if (terrain != nullptr) {
            transform.position =
                terrain->resolveCircle(transform.position, kDropWallRadius, transform.realm);
        }
        lifetime.remainingSeconds -= dt;
        // Outside its realm's playable area, where nothing can ever reach it.
        // Tested after the wall push, which is what normally pulls an escaping
        // drop back inside -- what reaches here is a drop the resolver could
        // not save.
        // No terrain -- a harness driving the system on its own -- means no
        // realm rectangle to be outside of, so the drop only ever times out.
        if (lifetime.remainingSeconds <= 0.0 ||
            (terrain != nullptr && terrain->outside(transform.position, transform.realm))) {
            expired_.push_back(e);
        }
    });
    for (const Entity e : expired_) commands.destroy(e);
}

void LootSystem::collectPickups(World& world, const SpatialGrid& grid, CommandBuffer& commands,
                                EventQueue& events, double nowMillis) {
    collectors_->each([&](Entity player, PlayerTag&, Transform& transform, PlayerModifiers& mods) {
        const Health* health = world.tryGet<Health>(player);
        if (health != nullptr && !health->alive()) return;

        const double reach = pickupReach(world, player, mods);
        grid.query(transform.realm, transform.position, reach, candidates_);
        for (const Entity candidate : candidates_) {
            tryCollect(world, player, transform.position, reach * reach, candidate, commands,
                       events, nowMillis);
        }
    });
}

void LootSystem::collectFresh(World& world, CommandBuffer& commands, EventQueue& events,
                              double nowMillis) {
    if (fresh_.empty()) return;
    collectors_->each([&](Entity player, PlayerTag&, Transform& transform, PlayerModifiers& mods) {
        const Health* health = world.tryGet<Health>(player);
        if (health != nullptr && !health->alive()) return;

        const double reach = pickupReach(world, player, mods);
        for (const Entity candidate : fresh_) {
            tryCollect(world, player, transform.position, reach * reach, candidate, commands,
                       events, nowMillis);
        }
    });
}

void LootSystem::tryCollect(World& world, Entity player, Vec2 playerPosition, double reachSq,
                            Entity candidate, CommandBuffer& commands, EventQueue& events,
                            double nowMillis) {
    DropItem* drop = world.tryGet<DropItem>(candidate);
    if (drop == nullptr) return;
    const Transform* at = world.tryGet<Transform>(candidate);
    if (at == nullptr) return;
    if (distanceSq(at->position, playerPosition) > reachSq) return;
    const PlayerAccount* taker = world.tryGet<PlayerAccount>(player);
    const net::ConnectionId owner = taker != nullptr ? taker->connection : 0;
    if (!mayPickUp(*drop, player, owner, nowMillis)) return;

    const Pickup pickup{player, drop->configIndex, drop->rarity};
    pickups_.push_back(pickup);
    if (onPickup) onPickup(pickup);

    const NetId* dropId = world.tryGet<NetId>(candidate);
    const NetId* playerId = world.tryGet<NetId>(player);
    if (dropId != nullptr && playerId != nullptr) {
        events.pickedUp(dropId->value, playerId->value, at->position, at->realm,
                        drop->configIndex, drop->rarity);
    }
    drop->pickedUpBy.push_back(LootClaim{player, owner});
    bool finished = false;
    if (!drop->eligible.empty()) {
        finished = std::all_of(drop->eligible.begin(), drop->eligible.end(),
                               [&](const LootClaim& claim) {
                                   return claimed(drop->pickedUpBy, claim.body, claim.owner);
                               });
    }
    if (finished) commands.destroy(candidate);
}

void LootSystem::awardDeaths(World& world, const ContentRegistry& content, Rng& rng,
                             double nowMillis) {
    fresh_.clear();
    // Once for the tick, not once per corpse: the conversion below asks for it
    // on every drop of every kill.
    const std::uint16_t magicOrb = content.petalIndex("magic_orb");
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
        const Dead* dead = world.tryGet<Dead>(corpse);
        const Entity killer = dead != nullptr ? dead->killer : NULL_ENTITY;

        // Loot slots go to the highest positive contributors, just like XP.
        ranked_.clear();
        eligible_.clear();
        if (const Bounty* bounty = world.tryGet<Bounty>(corpse)) {
            for (const Bounty::Share& share : bounty->contributors) {
                if (share.damage <= 0.0) continue;
                // Damage is the whole test on the reference's side, where the
                // tally holds nothing but player ids. So a contributor whose
                // entity is GONE still burns one of the tier's slots: nobody is
                // promoted into the gap, the next live player below the cut
                // gets nothing, and a drop reserved for someone who left can
                // never be completed and simply expires. Only a live entity
                // that is not a flower is refused -- nothing in the game
                // credits one, and the ranking is not the place to start.
                if (world.isAlive(share.player) && !world.has<PlayerTag>(share.player)) continue;
                ranked_.push_back(share);
            }
            // Stable: contributors are stored in first-hit order and the
            // reference's sort is specified stable, so on an exact damage tie
            // the slot at the cut belongs to whoever landed their damage first.
            // The order matters beyond the cut too -- the credit fallback below
            // reads the top of this list.
            std::stable_sort(ranked_.begin(), ranked_.end(), [](const auto& a, const auto& b) {
                return a.damage > b.damage;
            });
            selectLootRecipients(ranked_, lootSlotsForRarity(mobRarity), squads, eligible_);
        }

        // A common mob rolls its authored rows one by one; everything above
        // it leaves one of every drop it has, from the merged table.
        const std::vector<DropTables::Entry>& table = mobRarity == Rarity::Common
                                                          ? tables_.forMob(mobIndex)
                                                          : tables_.guaranteedForMob(mobIndex);

        // Marked before a single drop is rolled: a corpse with an empty table
        // must be just as finished as one that paid out.
        world.add<LootAwarded>(corpse);
        if (eligible_.empty()) continue;

        // A drop is ONE roll for the whole mob, and it needs a live player to
        // credit it to: the killer, falling back to the biggest damage dealer
        // when the killing blow was nobody's -- a poison tick, a mob finishing
        // a mob, a pet whose owner left. If that player is no longer in the
        // world the mob pays out nothing at all, which is the reference's gate.
        const Entity credit = world.has<PlayerTag>(killer) ? killer : ranked_.front().player;
        if (!world.has<PlayerTag>(credit)) continue;

        // A worn magic orb rewrites what this mob leaves behind: everything
        // with a magic form drops as that form instead, and nothing gets past
        // the ORB'S OWN TIER. A common orb turns every leaf this mob would
        // have dropped into a common magic leaf and nothing else -- no
        // ordinary leaf, and no magic leaf above common -- so the way to farm
        // better magic petals is to carry a better orb.
        //
        // Read off the CREDIT player, the one whose kill this is, for the same
        // reason the roll itself is credited to them: a drop is one item with
        // one identity, and the eligible list can hold several flowers wearing
        // several different orbs. kRarityCount is "no orb worn", which is
        // almost every kill in the game.
        const int orbTier = wornOrbTier(world, credit, magicOrb);

        selected_.clear();
        rollTable(table, mobRarity, rng);

        const int copies = mobRarity == Rarity::Apex ? 10 : 1;
        for (const DropTables::Entry* entry : selected_) {
            // A consumable came through like any other row -- it is a drop
            // this mob has, which is the only reason it is in the table at
            // all -- but this inventory holds petals, so winning one means the
            // mob left nothing.
            if (entry->kind == DropTables::Kind::Consumable) continue;

            // The mob's tier scale is rolled ONCE per winning row, upstream of
            // the copies: an apex batch shares one base rarity and its ten
            // items differ only by their own upgrade rolls.
            const Rarity base = scaleDropRarity(clampRarity(entry->rarityOffset), mobRarity,
                                                entry->probability, rng);
            for (int i = 0; i < copies; ++i) {
                Rarity rarity = finishDropRarity(base, mobRarity, rng);
                // The Random sentinel resolves per COPY, not per row.
                std::uint16_t petalIndex = entry->kind == DropTables::Kind::RandomPetal
                                               ? tables_.randomPetal(rng)
                                               : entry->petalIndex;
                if (orbTier != kRarityCount) {
                    const std::uint16_t magic = content.magicFormOf(petalIndex);
                    if (magic != kInvalidIndex) {
                        petalIndex = magic;
                        // The gate. Applied AFTER the ordinary roll rather than
                        // instead of it, so a low orb does not also flatten the
                        // odds -- it caps what those odds can produce.
                        if (rarityIndex(rarity) > orbTier) rarity = clampRarity(orbTier);
                    }
                }
                const Vec2 scatter{rng.range(-50.0, 50.0), rng.range(-50.0, 50.0)};
                // Unresolved on purpose, on both servers: the per-tick pass is
                // what pushes a drop out of the geometry it landed in. Noted so
                // the sweep below tests the scattered position, as the
                // reference's same-step pickup does.
                const Entity dropped =
                    spawnDrop(world, petalIndex, rarity, at + scatter, transform->realm, eligible_,
                              nowMillis);
                if (dropped != NULL_ENTITY) fresh_.push_back(dropped);
            }
        }
    }
}

void LootSystem::rollTable(const std::vector<DropTables::Entry>& table, Rarity mobRarity,
                           Rng& rng) {
    // Common mobs roll every row independently, so they can never beat the
    // full set a rarer mob hands out -- and a common kill can still leave
    // nothing at all.
    if (mobRarity == Rarity::Common) {
        for (const DropTables::Entry& entry : table) {
            if (rng.chance(entry.probability)) selected_.push_back(&entry);
        }
        return;
    }

    // Every mob above common leaves one of every drop it has. Nothing is
    // rolled here: `probability` is spent in scaleDropRarity on the tier each
    // one lands at, so a low-probability row is not a rare drop any more, it
    // is a reliably WEAK one. The table handed in is the merged one, so two
    // authored lines naming one petal are one drop rather than two.
    for (const DropTables::Entry& entry : table) selected_.push_back(&entry);
}

} // namespace flix
