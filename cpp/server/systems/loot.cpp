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

            // Ladder tiers only: nothing drops universal, so a table naming
            // it is refused like any other unknown tier.
            int rarityOffset = -1;
            for (int i = 0; i < kLadderRarityCount; ++i) {
                if (rarity == kRarityNames[static_cast<std::size_t>(i)]) {
                    rarityOffset = i;
                    break;
                }
            }
            if (rarityOffset < 0) {
                errorOut = path + ": drop '" + itemId + "' for '" + mobId + "' has an unknown rarity";
                return false;
            }

            // Mobs do not drop consumables: a `consumable` row is not part of
            // the mob's table at all.
            if (type == "consumable") continue;

            SourceEntry source;
            source.mobId = mobId;
            source.petalId = itemId;
            // Anything else is a petal, which is how the reference reads the
            // field. Every row is kept whatever its kind: the row list is what
            // the mob HAS, and above common a mob leaves one of everything it
            // has.
            source.kind = itemId == "random" ? Kind::RandomPetal : Kind::Petal;
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
    // Relative to the working directory. From a build directory the first is
    // the staged copy; from the repository root it is the source, and so are
    // the other two from cpp/ and from cpp/build.
    static constexpr const char* kCandidates[] = {
        "data/mob_drops.json",
        "../data/mob_drops.json",
        "../../data/mob_drops.json",
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
        // A row whose item this build cannot hand out -- an id the petal
        // registry does not know -- still belongs in the table: on
        // a common mob it is an independent roll and above one it is a
        // guaranteed drop. Only the payout is missing, and kNoPetal is already
        // what spawnDrop treats as "nothing". (The `random` sentinel keeps
        // kNoPetal here too, and is resolved per copy in awardDeaths.)
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
            // Only a NAMED petal can collide. The `random` sentinel and an
            // unknown id both resolve to kNoPetal, and folding those together
            // would merge two unrelated rows.
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
        // Prism is made from Glass in the crafting panel, not mob loot.
        if (petal.id == "prism_mirror") continue;
        // Handed out by a rule of their own: the sacrifice, the crown.
        if (petalHasOwnSource(petal)) continue;
        // A magic petal is CONVERTED into, never dropped. Leaving it in the
        // pool would put an apex magic leaf in front of a flower wearing a
        // common orb, straight past the gate the orb exists to be. A glitch
        // petal likewise.
        if (content.isMagicForm(index) || content.isGlitchForm(index)) continue;
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

std::uint16_t DropTables::randomPetal(Rng& rng, Rarity rarity) const {
    if (droppable_.empty()) return basicPetal_;
    // A handful of draws, then the basic petal: with one petal in the pool
    // held above common the first draw all but always stands.
    for (int draw = 0; draw < 8; ++draw) {
        const std::uint16_t index =
            droppable_[rng.below(static_cast<std::uint32_t>(droppable_.size()))];
        if (content_ == nullptr || petalComesAt(content_->petal(index), rarity)) return index;
    }
    return basicPetal_;
}

// ---------------------------------------------------------------------------
// Rolls
// ---------------------------------------------------------------------------

Rarity LootSystem::scaleDropRarity(Rarity authoredRarity, Rarity mobRarity, Rng& rng) {
    // Above uncommon, 90% of graded rows first become one tier below the
    // mob; common and uncommon rows keep their authored table rarity.
    if (rarityIndex(mobRarity) > rarityIndex(Rarity::Uncommon) && rng.chance(0.9)) {
        return clampRarity(rarityIndex(mobRarity) - 1);
    }
    return authoredRarity;
}

Rarity LootSystem::chaffDropRarity(Rarity mobRarity, Rng& rng) {
    // Flat, and deliberately not run through finishDropRarity: the rarity
    // floor there exists to hold the mob's ONE graded drop up near its tier,
    // and applying it to the extra rows would undo the whole point of them
    // being chaff -- a rare mob's floor would lift every one of them back to
    // uncommon. A super's is the one exception (chaffUpgradeChance).
    const int tier = rarityIndex(mobRarity);
    const double up = chaffUpgradeChance(mobRarity);
    if (up > 0.0 && rng.chance(up)) return clampRarity(tier - 1);
    return clampRarity(tier - 2);
}

Rarity LootSystem::finishDropRarity(Rarity baseRarity, Rarity mobRarity, Rng& rng) {
    // An apex grades off its own table, not the split below: see
    // kApexEternalDropChance.
    if (mobRarity == Rarity::Apex) {
        const double roll = rng.unit();
        if (roll < kApexEternalDropChance) return Rarity::Eternal;
        if (roll < kApexEternalDropChance + kApexUltraDropChance) return Rarity::Ultra;
        return Rarity::Super;
    }
    Rarity base = baseRarity;
    const double upgrade =
        clamp(dropUpgradeChance(base) * dropUpgradeMultiplier(mobRarity), 0.0,
              kMaxDropUpgradeChance);
    if (rng.chance(upgrade)) {
        base = upgradeRarity(base);
    } else if (rng.chance(dropDowngradeChance(base) * dropDowngradeMultiplier(mobRarity))) {
        base = downgradeRarity(base);
    }

    // Rare mobs floor at tier-1; epic and above floor at tier-2, a super at
    // tier-1 (gradedDropFloor).
    const int floor = gradedDropFloor(mobRarity);
    if (rarityIndex(base) < floor) base = clampRarity(floor);
    return base;
}

Rarity LootSystem::rollDropRarity(Rarity authoredRarity, Rarity mobRarity, Rng& rng) {
    return finishDropRarity(scaleDropRarity(authoredRarity, mobRarity, rng), mobRarity, rng);
}

bool LootSystem::mayPickUp(const DropItem& drop, Entity player, net::ConnectionId owner) {
    // By the OWNER where there is one, so a player who died between the kill
    // and the walk back still collects what was reserved for them -- and
    // still cannot collect it twice by dying again. See LootClaim.
    if (claimed(drop.pickedUpBy, player, owner)) return false;
    // Gone to the first taker, even before the destroy is flushed: two
    // flowers reaching it on the same tick do not both get it.
    if (drop.singleCopy && !drop.pickedUpBy.empty()) return false;
    return drop.eligible.empty() || claimed(drop.eligible, player, owner);
}

// ---------------------------------------------------------------------------
// The magic and glitch orbs' conversion
// ---------------------------------------------------------------------------

namespace {

/// The best orb of each kind on a flower's ACTIVE bar.
///
/// Active slots only, for the reason every other worn bonus reads only those:
/// a stashed orb is not a worn one. The BEST of several rather than the first,
/// because two orbs are one conversion, at the better tier.
LootSystem::WornOrbs wornOrbs(const World& world, const ContentRegistry& content, Entity player,
                              std::uint16_t magicOrb, std::uint16_t glitchOrb) {
    LootSystem::WornOrbs best;
    const Loadout* loadout = world.tryGet<Loadout>(player);
    if (loadout == nullptr) return best;
    const auto raise = [](int& held, int tier) {
        if (held == kRarityCount || tier > held) held = tier;
    };
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        // Resolved: a mimic beside an orb is an orb at the mimic's tier.
        const EquippedPetal slot = equippedPetal(content, *loadout, i);
        if (slot.empty()) continue;
        if (slot.configIndex == magicOrb) raise(best.magic, rarityIndex(slot.rarity));
        if (slot.configIndex == glitchOrb) raise(best.glitch, rarityIndex(slot.rarity));
    }
    return best;
}

/// What one flower's copy of a drop becomes. `magic` and `glitch` are the
/// petal's forms, kInvalidIndex for one it does not have. A flower wearing both
/// orbs, on a petal with both forms, gets the better orb's; a tie is glitch.
LootSystem::OrbForm orbFormFor(const LootSystem::WornOrbs& worn, std::uint16_t petal,
                               std::uint16_t magic, std::uint16_t glitch) {
    const bool useMagic = magic != kInvalidIndex && worn.magic != kRarityCount;
    const bool useGlitch = glitch != kInvalidIndex && worn.glitch != kRarityCount;
    if (useGlitch && (!useMagic || worn.glitch >= worn.magic)) return {glitch, worn.glitch};
    if (useMagic) return {magic, worn.magic};
    return {petal, kRarityCount};
}

} // namespace

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

void LootSystem::spawnPublicMobLoot(World& world,const ContentRegistry& content,Rng& rng,
                                    std::uint16_t mob,Rarity tier,Vec2 at,Realm realm) {
    selected_.clear();rollTable(tables_.guaranteedForMob(mob),tier,rng);
    const auto featured=pickFeatured(rng);
    for(std::size_t row=0;row<selected_.size();++row){
        const auto& entry=*selected_[row];
        const Rarity rarity=row==featured?rollDropRarity(clampRarity(entry.rarityOffset),tier,rng):chaffDropRarity(tier,rng);
        const auto index=entry.kind==DropTables::Kind::RandomPetal?tables_.randomPetal(rng,rarity):entry.petalIndex;
        if(index==kNoPetal||index>=content.petalCount()||rarityIndex(rarity)<rarityIndex(content.petal(index).minRarity))continue;
        const Vec2 scatter=Vec2::fromAngle(rng.angle())*(20+rng.unit()*45);
        const Entity e=spawnDrop(world,index,rarity,at+scatter,realm,{});
        if(e!=NULL_ENTITY){auto& item=world.get<DropItem>(e);item.singleCopy=true;item.humansOnly=true;}
    }
}

Entity LootSystem::spawnDrop(World& world, std::uint16_t petalIndex, Rarity rarity, Vec2 position,
                             Realm realm, const std::vector<Entity>& eligible) {
    if (petalIndex == kNoPetal) return NULL_ENTITY;
    // Nothing is ever dropped in the Trial Grounds, whatever asked for it: the
    // floor reward is a chamber's only payout.
    if (isTrialRealm(realm)) return NULL_ENTITY;

    const Entity e = world.create();
    world.add<DropTag>(e);
    world.add<Transform>(e, Transform{position, 0.0, realm});
    // No Motion: a drop is furniture. The body is here only so the broadphase
    // files it and the pickup query can find it.
    world.add<Body>(e, Body{kDropBodyRadius, 1.0});

    DropItem item;
    item.configIndex = petalIndex;
    item.rarity = rarity;
    item.magnetReadyAtMillis = nowMillis_ + kMagnetPickupDelayMillis;
    // Resolved to CLAIMS here, where the world is in hand: the ranking that
    // produced this list deals in bodies, and a body is not who a drop
    // belongs to.
    item.eligible.clear();
    item.eligible.reserve(eligible.size());
    for (const Entity claimant : eligible) {
        const PlayerAccount* account = world.tryGet<PlayerAccount>(claimant);
        net::ConnectionId owner = account != nullptr ? account->connection : 0;
        // Between lives: claimed by who it was, so the body they come back in
        // can see it and pick it up (ownerOfGoneBody).
        if (account == nullptr && !world.isAlive(claimant) && ownerOfGoneBody) {
            owner = ownerOfGoneBody(claimant);
        }
        item.eligible.push_back(LootClaim{claimant, owner});
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

/// How far a flower reaches for loot without a magnet.
double basePickupReach(const World& world, Entity player) {
    const Body* body = world.tryGet<Body>(player);
    return body != nullptr ? body->radius * 2.0 : kDropPickupRadius;
}

/// How far a flower reaches for loot.
///
/// Magnetism widens the reach and nothing else. Pulling the drop in would
/// consume it before a snapshot ever carried it.
double pickupReach(const World& world, Entity player, const PlayerModifiers& mods) {
    return basePickupReach(world, player) + std::max(0.0, mods.magnetism);
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
    nowMillis_ = nowMillis;

    maintainDrops(dt, commands);
    collectPickups(world, grid, commands, events);
    awardDeaths(world, content, rng);
    // Deaths pay out after the broadphase pass, but their loot is still
    // collectable this tick by a flower standing on it -- its own reach, not
    // a magnet's, which waits half a second (kMagnetPickupDelayMillis). The
    // client is not left with nothing to animate -- the pickup cue carries the
    // drop's position and look for exactly this case.
    collectFresh(world, commands, events);
}

void LootSystem::maintainDrops(double dt, CommandBuffer& commands) {
    expired_.clear();
    drops_->each([&](Entity e, DropTag&, Transform& transform, Lifetime& lifetime) {
        // Nothing resolves the +-50 spawn scatter -- the reference does not
        // either, by design -- so this push is the only way a drop that landed
        // inside a rock, a wall or water ever becomes reachable again. Pickup
        // is a plain distance test, and a tile face is far wider than its reach.
        if (terrain != nullptr) {
            transform.position =
                terrain->resolveCircle(transform.position, kDropWallRadius, transform.realm);
        }
        lifetime.remainingSeconds -= dt;
        // Loot lying in a trial chamber goes the tick it is seen, however it
        // got there (spawnDrop already refuses to put any there).
        if (isTrialRealm(transform.realm)) {
            expired_.push_back(e);
            return;
        }
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
                                EventQueue& events) {
    collectors_->each([&](Entity player, PlayerTag&, Transform& transform, PlayerModifiers& mods) {
        const Health* health = world.tryGet<Health>(player);
        if (health != nullptr && !health->alive()) return;

        const double reach = pickupReach(world, player, mods);
        const double base = basePickupReach(world, player);
        grid.query(transform.realm, transform.position, reach, candidates_);
        for (const Entity candidate : candidates_) {
            tryCollect(world, player, transform.position, transform.realm, reach * reach,
                       base * base, candidate, commands, events);
        }
    });
}

void LootSystem::collectFresh(World& world, CommandBuffer& commands, EventQueue& events) {
    if (fresh_.empty()) return;
    collectors_->each([&](Entity player, PlayerTag&, Transform& transform, PlayerModifiers& mods) {
        const Health* health = world.tryGet<Health>(player);
        if (health != nullptr && !health->alive()) return;

        const double reach = pickupReach(world, player, mods);
        const double base = basePickupReach(world, player);
        for (const Entity candidate : fresh_) {
            tryCollect(world, player, transform.position, transform.realm, reach * reach,
                       base * base, candidate, commands, events);
        }
    });
}

void LootSystem::tryCollect(World& world, Entity player, Vec2 playerPosition, Realm playerRealm,
                            double reachSq, double baseReachSq, Entity candidate,
                            CommandBuffer& commands, EventQueue& events) {
    DropItem* drop = world.tryGet<DropItem>(candidate);
    if (drop == nullptr) return;
    const Transform* at = world.tryGet<Transform>(candidate);
    if (at == nullptr) return;
    // A drop on another map is out of reach whatever the numbers say. The
    // broadphase pass only ever finds drops filed under the flower's realm,
    // but the fresh pass walks this tick's drops directly -- so without this
    // a flower standing at the same coordinates on another map, a contributor
    // who changed map on the tick of the kill, took its copy from there.
    if (at->realm != playerRealm) return;
    // Never picked up in a trial: maintainDrops has queued its destroy.
    if (isTrialRealm(at->realm)) return;
    // A magnet reaches only for loot that has lain half a second: a fresh kill's
    // drops are seen on the ground first. Loot already lying there when the
    // magnet goes on is old enough, and comes in at once.
    const double reach = nowMillis_ >= drop->magnetReadyAtMillis ? reachSq : baseReachSq;
    if (distanceSq(at->position, playerPosition) > reach) return;
    const PlayerAccount* taker = world.tryGet<PlayerAccount>(player);
    const net::ConnectionId owner = taker != nullptr ? taker->connection : 0;
    // A bot's body carries no connection; see DropItem::humansOnly.
    if (drop->humansOnly && owner == 0) return;
    if (!mayPickUp(*drop, player, owner)) return;

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
    bool finished = drop->singleCopy;
    if (!finished && !drop->eligible.empty()) {
        finished = std::all_of(drop->eligible.begin(), drop->eligible.end(),
                               [&](const LootClaim& claim) {
                                   return claimed(drop->pickedUpBy, claim.body, claim.owner);
                               });
    }
    if (finished) commands.destroy(candidate);
}

void LootSystem::awardDeaths(World& world, const ContentRegistry& content, Rng& rng) {
    fresh_.clear();
    // Once for the tick, not once per corpse: the conversion below asks for it
    // on every drop of every kill.
    const std::uint16_t magicOrb = content.petalIndex("magic_orb");
    const std::uint16_t glitchOrb = content.petalIndex("glitch_orb");
    const std::uint16_t crown = content.petalIndex(kChampionCrownPetalId);
    corpses_->collect(corpseList_);
    for (const Entity corpse : corpseList_) {
        // A chamber mob, or anything it made of itself -- summons, a divider's
        // pieces -- drops nothing.
        if (inTrialGrounds(world, corpse)) {
            world.add<LootAwarded>(corpse);
            continue;
        }
        const MobType* type = world.tryGet<MobType>(corpse);
        const Transform* transform = world.tryGet<Transform>(corpse);
        if (type == nullptr || transform == nullptr) continue;

        // Read the corpse out in full first. Everything below is a structural
        // change, and these pointers are into an archetype column. The realm
        // too: adding LootAwarded moves the corpse out of its row, and the
        // corpse swapped into that row may be standing on another map.
        const std::uint16_t mobIndex = type->configIndex;
        const Rarity mobRarity = type->rarity;
        const Vec2 at = transform->position;
        const Realm realm = transform->realm;
        const Dead* dead = world.tryGet<Dead>(corpse);
        const Entity killer = dead != nullptr ? dead->killer : NULL_ENTITY;
        const Health* health = world.tryGet<Health>(corpse);
        const double damageFloor = lootDamageFloor(health != nullptr ? health->max : 0.0, mobRarity);

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
            selectLootRecipients(ranked_, lootSlotsForRarity(mobRarity), squads, eligible_,
                                 damageFloor);
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
        if (!world.has<PlayerTag>(credit) &&
            !(creditsGoneBody && !world.isAlive(credit) && creditsGoneBody(credit))) {
            continue;
        }

        // A piece of a divided mob has that share of every drop rate the mob
        // has, so killing every piece pays what killing it whole does on
        // average, and a divider is no way to multiply loot. A figure, because
        // the drops below relocate the row a pointer would be into.
        const DividedMob* divided = world.tryGet<DividedMob>(corpse);
        const double dropShare = divided != nullptr ? 1.0 / divided->pieces : 1.0;

        // A worn magic orb rewrites what this mob leaves behind: everything
        // with a magic form drops as that form instead, and nothing gets past
        // the ORB'S OWN TIER. A common orb turns every leaf this mob would
        // have dropped into a common magic leaf and nothing else -- no
        // ordinary leaf, and no magic leaf above common -- so the way to farm
        // better magic petals is to carry a better orb. A worn glitch orb does
        // exactly the same with glitch forms. Read off each flower and applied
        // to that flower's own roll: an orb is a bonus its wearer carries, not
        // a rule for the whole kill.
        //
        // Every eligible flower ROLLS the table on its own, so one lucky roll
        // no longer hands the same rare petal to everybody who hit the mob:
        // each flower faces the odds a shared roll gave, but separately.
        //
        // Rolled per flower, PLACED per outcome. Flowers whose rolls came out
        // the same share one drop on the ground, reserved for all of them --
        // which is what every drop was before -- and replication still hides
        // each drop from everyone it is not reserved for. Most of what a mob
        // leaves is chaff at a fixed tier, so most rolls agree, and a kill
        // paid to twenty-five flowers puts barely more on the ground than a
        // kill paid to one: the count is bounded by how many DIFFERENT
        // outcomes came up, not by how many flowers were paid.
        //
        // Which row is the mob's REAL drop: above unusual a kill hands out
        // exactly one graded item, picked out of the table by a
        // probability-weighted draw, and every OTHER row drops flat at two
        // tiers below the mob -- more loot per kill, at the bottom of the
        // mob's band, where it cannot move progression. A common or unusual
        // mob grades every row it hands out; neither has a weighted draw.
        const bool gradeEveryRow = rarityIndex(mobRarity) <= rarityIndex(Rarity::Uncommon);
        const int copies = mobRarity == Rarity::Apex ? 10 : 1;
        outcomes_.clear();
        for (std::size_t who = 0; who < eligible_.size(); ++who) {
            const WornOrbs worn = wornOrbs(world, content, eligible_[who], magicOrb, glitchOrb);
            const bool wearsOrb = worn.magic != kRarityCount || worn.glitch != kRarityCount;

            selected_.clear();
            rollTable(table, mobRarity, rng);
            const std::size_t featured = gradeEveryRow ? 0 : pickFeatured(rng);

            for (std::size_t row = 0; row < selected_.size(); ++row) {
                const DropTables::Entry* entry = selected_[row];
                const bool graded = gradeEveryRow || row == featured;
                // The mob's tier scale is rolled ONCE per graded row, upstream
                // of the copies: an apex batch shares one base rarity and its
                // ten items differ only by their own upgrade rolls.
                const Rarity base =
                    graded ? scaleDropRarity(clampRarity(entry->rarityOffset), mobRarity, rng)
                           : chaffDropRarity(mobRarity, rng);
                for (int i = 0; i < copies; ++i) {
                    if (dropShare < 1.0 && !rng.chance(dropShare)) continue;
                    Rarity rarity = graded ? finishDropRarity(base, mobRarity, rng) : base;
                    // The Random sentinel resolves per COPY, not per row.
                    const std::uint16_t petalIndex =
                        entry->kind == DropTables::Kind::RandomPetal
                            ? tables_.randomPetal(rng, rarity)
                            : entry->petalIndex;
                    // A petal that does not come at the tier this copy rolled
                    // is not dropped at all -- not lifted to its floor, which
                    // would turn a common spider's third eye into a legendary
                    // one.
                    if (!petalComesAt(content.petal(petalIndex), rarity)) continue;
                    OrbForm form{petalIndex, kRarityCount};
                    if (wearsOrb) {
                        form = orbFormFor(worn, petalIndex, content.magicFormOf(petalIndex),
                                          content.glitchFormOf(petalIndex));
                    }
                    // The orb's gate. Applied AFTER the ordinary roll rather
                    // than instead of it, so a low orb does not also flatten
                    // the odds -- it caps what those odds can produce.
                    if (rarityIndex(rarity) > form.cap) rarity = clampRarity(form.cap);
                    outcomes_.push_back({form.petal, rarity, static_cast<std::uint32_t>(who)});
                }
            }

            // The Universal Champion's Crown: an apex kill's own chance, once
            // per flower paid, past every orb (the crown has no other form).
            // A piece of a divided apex has its share of the chance, as of
            // every other drop. Drawn only for an apex, so no other kill's
            // rolls move.
            if (mobRarity == Rarity::Apex && crown < content.petalCount() &&
                (!mayFindUniversalCrown || mayFindUniversalCrown(eligible_[who])) &&
                rng.chance(universalCrownChance * dropShare)) {
                outcomes_.push_back({crown, Rarity::Universal, static_cast<std::uint32_t>(who)});
            }
        }

        // Equal outcomes side by side, and within one outcome each flower's
        // copies in a run of their own.
        std::sort(outcomes_.begin(), outcomes_.end(),
                  [](const RolledDrop& a, const RolledDrop& b) {
                      if (a.petal != b.petal) return a.petal < b.petal;
                      if (a.rarity != b.rarity) return rarityIndex(a.rarity) < rarityIndex(b.rarity);
                      return a.who < b.who;
                  });
        for (std::size_t begin = 0; begin < outcomes_.size();) {
            std::size_t end = begin;
            while (end < outcomes_.size() && outcomes_[end].petal == outcomes_[begin].petal &&
                   outcomes_[end].rarity == outcomes_[begin].rarity) {
                ++end;
            }
            // A flower that rolled this outcome k times is owed k copies, so
            // the group is laid down in layers: the j-th drop is reserved for
            // every flower that rolled it more than j times.
            for (std::size_t layer = 0;; ++layer) {
                claimants_.clear();
                for (std::size_t i = begin; i < end;) {
                    std::size_t run = i;
                    while (run < end && outcomes_[run].who == outcomes_[i].who) ++run;
                    if (run - i > layer) claimants_.push_back(eligible_[outcomes_[i].who]);
                    i = run;
                }
                if (claimants_.empty()) break;
                // Unresolved on purpose, as in the reference: the per-tick
                // pass is what pushes a drop out of the geometry it landed in.
                // Noted so the sweep tests the scattered position, as the
                // reference's same-step pickup does.
                const Vec2 scatter{rng.range(-50.0, 50.0), rng.range(-50.0, 50.0)};
                const Entity dropped = spawnDrop(world, outcomes_[begin].petal,
                                                 outcomes_[begin].rarity, at + scatter, realm,
                                                 claimants_);
                // One of it exists: two flowers who both rolled a universal
                // race for the one drop rather than each taking it from the
                // other.
                if (dropped != NULL_ENTITY && outcomes_[begin].rarity == Rarity::Universal) {
                    world.get<DropItem>(dropped).singleCopy = true;
                }
                if (dropped != NULL_ENTITY) fresh_.push_back(dropped);
            }
            begin = end;
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
    // rolled here: above unusual `probability` is spent in pickFeatured on
    // WHICH row is the graded drop, so a low-probability row is not a rare
    // drop any more, it is a reliably WEAK one. The table handed in is the
    // merged one, so two authored lines naming one petal are one drop rather
    // than two.
    for (const DropTables::Entry& entry : table) selected_.push_back(&entry);
}

std::size_t LootSystem::pickFeatured(Rng& rng) const {
    // The pre-guaranteed-drops weighted draw, unchanged down to the fallback:
    // a table whose probabilities are all zero picks its last row rather than
    // nothing, so a mob with such a table still leaves one graded item.
    if (selected_.empty()) return 0;
    double total = 0.0;
    for (const DropTables::Entry* entry : selected_) total += entry->probability;
    if (total <= 0.0) return selected_.size() - 1;
    double roll = rng.unit() * total;
    for (std::size_t i = 0; i < selected_.size(); ++i) {
        roll -= selected_[i]->probability;
        if (roll <= 0.0) return i;
    }
    return selected_.size() - 1;
}

} // namespace flix
