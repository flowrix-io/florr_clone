#include "server/systems/dungeons.h"

#include <algorithm>
#include <cstdio>

#include "server/systems/combat.h"
#include "server/systems/spawning.h"
#include "shared/game/components.h"
#include "shared/game/rarity.h"

namespace flix {

namespace {

bool standing(const World& world, Entity e) {
    if (!world.isAlive(e) || world.has<Dead>(e)) return false;
    const Health* health = world.tryGet<Health>(e);
    return health == nullptr || health->alive();
}

} // namespace

void DungeonSystem::index(const ContentRegistry& content) {
    indexed_ = true;
    instances_.clear();
    byRealm_.fill(-1);
    if (worldMaps == nullptr) return;
    std::vector<std::string> seen;
    for (std::size_t i = 0; i < content.mobCount(); ++i) {
        const MobConfig& config = content.mob(static_cast<std::uint16_t>(i));
        if (!config.dungeon.present) continue;
        const std::string& mapId = config.dungeon.mapId;
        if (std::find(seen.begin(), seen.end(), mapId) != seen.end()) continue;
        seen.push_back(mapId);
        const std::vector<Realm> copies = worldMaps->copiesOf(mapId);
        if (copies.empty()) {
            // A content bug, not a runtime condition: the nest is an
            // untouchable stone until somebody stages the map.
            std::fprintf(stderr, "[dungeon] %s leads into map \"%s\", which is not staged\n",
                         config.id.c_str(), mapId.c_str());
        }
        for (const Realm realm : copies) {
            Instance instance;
            instance.realm = realm;
            instance.mapId = mapId;
            byRealm_[realmIndex(realm)] = static_cast<int>(instances_.size());
            instances_.push_back(instance);
        }
    }
}

bool DungeonSystem::isInstance(Realm realm) const {
    return indexed_ && byRealm_[realmIndex(realm)] >= 0;
}

std::vector<DungeonSystem::InstanceView> DungeonSystem::instances() const {
    std::vector<InstanceView> out;
    for (const Instance& instance : instances_) {
        InstanceView view;
        view.realm = instance.realm;
        view.live = instance.live;
        view.entrance = instance.entrance;
        view.dwellers = instance.dwellers;
        view.players = instance.players;
        view.cleared = instance.clearedAtMillis >= 0.0;
        out.push_back(view);
    }
    return out;
}

DungeonSystem::Instance* DungeonSystem::claim(const std::string& mapId) {
    for (Instance& instance : instances_) {
        if (!instance.live && instance.mapId == mapId) return &instance;
    }
    return nullptr;
}

Vec2 DungeonSystem::arrivalPoint(const Instance& instance, Rng& rng,
                                 const Terrain& terrain) const {
    const MapData* map = worldMaps != nullptr ? worldMaps->forRealm(instance.realm) : nullptr;
    if (map == nullptr) return {};
    // The map's front door: its first player spawn in button order.
    return map->defaultSpawn(rng, terrain);
}

Vec2 DungeonSystem::exitPoint(const Instance& instance, Rng& rng, double bodyRadius) const {
    return instance.returnAt +
           Vec2::fromAngle(rng.angle(), instance.returnRadius + bodyRadius + kDungeonExitGap);
}

bool DungeonSystem::exitFor(Realm realm, Rng& rng, double bodyRadius, Realm& outRealm,
                            Vec2& out) const {
    if (!isInstance(realm)) return false;
    const Instance& instance = instances_[static_cast<std::size_t>(byRealm_[realmIndex(realm)])];
    if (!instance.live) return false;
    outRealm = instance.returnRealm;
    out = exitPoint(instance, rng, bodyRadius);
    return true;
}

bool DungeonSystem::populate(World& world, const Terrain& terrain, const ContentRegistry& content,
                             SpawnSystem& spawning, Rng& rng, double nowMillis,
                             Instance& instance, Entity entrance) {
    const MobType* type = world.tryGet<MobType>(entrance);
    const Transform* at = world.tryGet<Transform>(entrance);
    const Body* body = world.tryGet<Body>(entrance);
    const MapData* map = worldMaps != nullptr ? worldMaps->forRealm(instance.realm) : nullptr;
    if (type == nullptr || at == nullptr || body == nullptr || map == nullptr) return false;
    const DungeonSpec spec = content.mob(type->configIndex).dungeon;
    // What a nest's brood comes out at everywhere else: the nest's own tier,
    // held to ultra, so a super mound is the boss and not a dungeon of supers.
    const Rarity rarity = minionRarity(type->rarity);

    instance.live = true;
    instance.entrance = entrance;
    instance.returnRealm = at->realm;
    instance.returnAt = at->position;
    instance.returnRadius = body->radius;
    instance.clearedAtMillis = -1;
    instance.emptySinceMillis = -1;
    instance.dwellers = 0;

    double broodHealth = 0.0;
    std::vector<std::pair<Entity, bool>> placed;
    for (const DungeonSpec::Entry& entry : spec.brood) {
        const bool colony = content.mob(entry.mobIndex).colony;
        for (int i = 0; i < entry.count; ++i) {
            Vec2 where;
            if (entry.door.empty() || !map->spawnAt(entry.door, rng, terrain, where)) {
                where = map->defaultSpawn(rng, terrain);
            }
            const Entity mob = spawning.spawnMob(world, terrain, content, entry.mobIndex, rarity,
                                                 where, instance.realm, nowMillis, rng);
            if (mob == NULL_ENTITY) continue;
            if (const Health* health = world.tryGet<Health>(mob)) broodHealth += health->max;
            placed.emplace_back(mob, colony);
        }
    }
    // Tagged after every spawn: a spawn creates entities, and a component
    // added between two of them could be relocated under the next.
    for (const auto& [mob, colony] : placed) {
        world.add<DungeonDweller>(mob, DungeonDweller{entrance, colony});
        world.add<KeepAwake>(mob);
    }

    DungeonEntrance& door = world.get<DungeonEntrance>(entrance);
    door.claimed = true;
    door.realm = instance.realm;
    door.broodHealth = broodHealth;
    door.colony.clear();
    if (!world.has<KeepAwake>(entrance)) world.add<KeepAwake>(entrance);
    return true;
}

void DungeonSystem::evict(World& world, Instance& instance, Rng& rng) {
    std::vector<std::pair<Entity, double>> inside;
    Query<PlayerTag, Transform> players{world};
    players.each([&](Entity e, PlayerTag&, Transform& transform) {
        if (transform.realm != instance.realm) return;
        const Body* body = world.tryGet<Body>(e);
        inside.emplace_back(e, body != nullptr ? body->radius : 25.0);
    });
    if (!moveToRealm) return;
    for (const auto& [player, radius] : inside) {
        moveToRealm(player, instance.returnRealm, exitPoint(instance, rng, radius));
    }
}

void DungeonSystem::release(World& world, Instance& instance, CommandBuffer& commands) {
    // Whatever is left in the copy -- the brood of a party that gave up, the
    // drops nobody collected, shots still in the air -- goes with it.
    Query<Transform> everything{world};
    everything.each([&](Entity e, Transform& transform) {
        if (transform.realm != instance.realm || world.has<PlayerTag>(e)) return;
        if (world.has<MobTag>(e) || world.has<DropItem>(e) || world.has<ProjectileTag>(e)) {
            commands.destroy(e);
        }
    });

    // A nest still standing goes back to being an unclaimed one: the next
    // flower to walk in finds a fresh brood, and nobody keeps a share of a
    // fight that was never finished.
    const Entity entrance = instance.entrance;
    if (world.isAlive(entrance) && !world.has<Dead>(entrance)) {
        if (DungeonEntrance* door = world.tryGet<DungeonEntrance>(entrance)) {
            door->claimed = false;
            door->broodHealth = 0.0;
            door->colony.clear();
        }
        if (Bounty* bounty = world.tryGet<Bounty>(entrance)) bounty->contributors.clear();
        if (world.has<KeepAwake>(entrance)) world.remove<KeepAwake>(entrance);
    }

    instance.live = false;
    instance.entrance = NULL_ENTITY;
    instance.clearedAtMillis = -1;
    instance.emptySinceMillis = -1;
    instance.dwellers = 0;
    instance.players = 0;
}

void DungeonSystem::run(World& world, const Terrain& terrain, const ContentRegistry& content,
                        SpawnSystem& spawning, CombatSystem& combat, Rng& rng, double nowMillis,
                        CommandBuffer& commands) {
    if (!indexed_) index(content);
    if (instances_.empty()) return;

    // --- who is standing on a nest -----------------------------------------
    struct Flower {
        Entity entity;
        Realm realm;
        Vec2 position;
        double radius;
    };
    std::vector<Flower> flowers;
    Query<PlayerTag, Transform, Body> players{world};
    players.each([&](Entity e, PlayerTag&, Transform& transform, Body& body) {
        if (!standing(world, e)) return;
        flowers.push_back({e, transform.realm, transform.position, body.radius});
    });

    std::vector<Approach> stillApproaching;
    std::vector<std::pair<Entity, Entity>> entering;   // (player, nest)
    Query<DungeonEntrance, Transform, Body> nests{world};
    nests.each([&](Entity nest, DungeonEntrance&, Transform& transform, Body& body) {
        if (!standing(world, nest)) return;
        for (const Flower& flower : flowers) {
            if (flower.realm != transform.realm) continue;
            const double reach = body.radius + flower.radius;
            if (distanceSq(flower.position, transform.position) > reach * reach) continue;
            if (admits && !admits(flower.entity)) continue;
            const TeleporterState* pads = world.tryGet<TeleporterState>(flower.entity);
            if (pads != nullptr && nowMillis < pads->cooldownUntilMillis) continue;
            double since = nowMillis;
            for (const Approach& old : approaches_) {
                if (old.player == flower.entity && old.entrance == nest) since = old.sinceMillis;
            }
            stillApproaching.push_back({flower.entity, nest, since});
            if (nowMillis - since >= kDungeonEnterDwellMillis) {
                entering.emplace_back(flower.entity, nest);
            }
        }
    });
    approaches_ = std::move(stillApproaching);

    for (const auto& [player, nest] : entering) {
        if (!world.isAlive(nest) || !world.isAlive(player)) continue;
        const MobType* type = world.tryGet<MobType>(nest);
        const DungeonEntrance* door = world.tryGet<DungeonEntrance>(nest);
        if (type == nullptr || door == nullptr) continue;
        Instance* instance = nullptr;
        if (door->claimed && isInstance(door->realm)) {
            instance = &instances_[static_cast<std::size_t>(byRealm_[realmIndex(door->realm)])];
        } else {
            // Every copy taken: the flower stays out until one comes free.
            instance = claim(content.mob(type->configIndex).dungeon.mapId);
            if (instance == nullptr) continue;
            if (!populate(world, terrain, content, spawning, rng, nowMillis, *instance, nest)) {
                instance->live = false;
                continue;
            }
        }
        if (instance->clearedAtMillis >= 0.0) continue;
        if (moveToRealm) moveToRealm(player, instance->realm, arrivalPoint(*instance, rng, terrain));
        approaches_.erase(std::remove_if(approaches_.begin(), approaches_.end(),
                                         [&](const Approach& a) { return a.player == player; }),
                          approaches_.end());
    }

    // --- every live copy ------------------------------------------------------
    for (Instance& instance : instances_) {
        instance.dwellers = 0;
        instance.players = 0;
    }
    std::vector<std::pair<Entity, Instance*>> adopted;
    std::vector<std::vector<Entity>> colonies(instances_.size());
    Query<MobTag, Transform> mobs{world};
    mobs.each([&](Entity e, MobTag&, Transform& transform) {
        const int slot = byRealm_[realmIndex(transform.realm)];
        if (slot < 0) return;
        Instance& instance = instances_[static_cast<std::size_t>(slot)];
        if (!instance.live || !standing(world, e)) return;
        ++instance.dwellers;
        const DungeonDweller* dweller = world.tryGet<DungeonDweller>(e);
        if (dweller == nullptr) {
            // Born in here after the brood was put down -- an overmind's
            // soldiers -- and every bit as much a part of the dungeon.
            adopted.emplace_back(e, &instance);
        } else if (dweller->colony) {
            colonies[static_cast<std::size_t>(slot)].push_back(e);
        }
    });
    for (const auto& [mob, instance] : adopted) {
        const MobType* type = world.tryGet<MobType>(mob);
        const bool colony = type != nullptr && content.mob(type->configIndex).colony;
        world.add<DungeonDweller>(mob, DungeonDweller{instance->entrance, colony});
        if (!world.has<KeepAwake>(mob)) world.add<KeepAwake>(mob);
        if (colony) colonies[static_cast<std::size_t>(byRealm_[realmIndex(instance->realm)])].push_back(mob);
    }
    for (const Flower& flower : flowers) {
        const int slot = byRealm_[realmIndex(flower.realm)];
        if (slot >= 0) ++instances_[static_cast<std::size_t>(slot)].players;
    }
    // Dead flowers count as inside too: one waiting on the death screen has
    // not left, and its party should not be cleaned out from under it.
    players.each([&](Entity e, PlayerTag&, Transform& transform, Body&) {
        if (standing(world, e)) return;
        const int slot = byRealm_[realmIndex(transform.realm)];
        if (slot >= 0) ++instances_[static_cast<std::size_t>(slot)].players;
    });

    for (std::size_t i = 0; i < instances_.size(); ++i) {
        Instance& instance = instances_[i];
        if (!instance.live) continue;
        const Entity nest = instance.entrance;
        const bool nestStands = standing(world, nest);

        if (instance.clearedAtMillis < 0.0) {
            if (!nestStands) {
                // The nest went some other way -- an operator, a reset. There
                // is nothing to come out beside but where it stood.
                evict(world, instance, rng);
                release(world, instance, commands);
                continue;
            }
            if (DungeonEntrance* door = world.tryGet<DungeonEntrance>(nest)) {
                door->colony = std::move(colonies[i]);
            }
            if (instance.dwellers == 0) {
                // Cleared. The nest falls where it stands, to whoever did the
                // most: its ledger holds every swing the dungeon took.
                Entity killer = NULL_ENTITY;
                if (const Bounty* bounty = world.tryGet<Bounty>(nest)) {
                    double best = 0.0;
                    for (const Bounty::Share& share : bounty->contributors) {
                        if (share.damage > best && world.isAlive(share.player)) {
                            best = share.damage;
                            killer = share.player;
                        }
                    }
                }
                combat.fell(world, nest, killer);
                instance.clearedAtMillis = nowMillis;
                continue;
            }
        } else if (nowMillis - instance.clearedAtMillis >= kDungeonClearedLingerMillis) {
            evict(world, instance, rng);
            release(world, instance, commands);
            continue;
        }

        if (instance.players == 0) {
            if (instance.emptySinceMillis < 0.0) instance.emptySinceMillis = nowMillis;
            if (nowMillis - instance.emptySinceMillis >= kDungeonAbandonMillis) {
                release(world, instance, commands);
            }
        } else {
            instance.emptySinceMillis = -1;
        }
    }
}

} // namespace flix
