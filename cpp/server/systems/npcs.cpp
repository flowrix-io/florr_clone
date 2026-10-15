#include "server/systems/npcs.h"

#include <algorithm>

#include "server/systems/mob_ai.h"
#include "server/systems/movement.h"
#include "shared/net/protocol.h"

namespace flix {

void NpcSystem::bind(World& world) {
    if (boundWorld_ == &world) return;
    boundWorld_ = &world;
    npcs_.emplace(world);
}

void NpcSystem::loadSites(const WorldMaps& maps, const ContentRegistry& content,
                          std::vector<std::string>& warnings) {
    sites_.clear();
    for (std::size_t slot = 0; slot < maps.maps().size(); ++slot) {
        const MapData& map = maps.maps()[slot];
        for (const MapElement& element : map.elements()) {
            if (element.kind != MapElementKind::Npc) continue;
            const std::uint16_t mobIndex = content.mobIndex(element.npcId);
            if (mobIndex == kInvalidIndex) {
                warnings.push_back("map " + map.id() + ": npc \"" + element.npcId +
                                   "\" is not a mob in mobs.json; nothing stands there");
                continue;
            }
            // A mob with no `npc` block has never said what it is as an NPC --
            // which side it is on, what it offers -- and is almost certainly a
            // typo for the one that was meant.
            if (!content.mob(mobIndex).npc.present) {
                warnings.push_back("map " + map.id() + ": \"" + element.npcId +
                                   "\" is not an NPC (mobs.json gives it no `npc` block); "
                                   "nothing stands there");
                continue;
            }
            Site site;
            site.realm = map.realm();
            // A point object's box is the point itself; an area's NPC is put
            // down somewhere inside it when placed, and until then the box's
            // middle is as good an answer to "where" as any.
            site.roams = element.npcRoams();
            site.position = site.roams ? element.centre() : Vec2{element.bounds.x, element.bounds.y};
            site.area = element.bounds;
            site.outline = element.polygon;
            site.mobIndex = mobIndex;
            if (!element.npcEveryRarity) {
                site.rarity = element.npcRarity;
                sites_.push_back(site);
                continue;
            }
            // "all": a site per ladder tier, each holding one NPC. Universal
            // is no rung of the ladder -- nothing stands there unasked.
            for (int tier = 0; tier < kLadderRarityCount; ++tier) {
                site.rarity = static_cast<Rarity>(tier);
                sites_.push_back(site);
            }
        }
    }
}

double NpcSystem::npcRadius(const ContentRegistry& content, std::uint16_t mobIndex,
                            Rarity rarity) {
    if (mobIndex >= content.mobCount()) return kMobBaseRadius;
    const MobConfig& config = content.mob(mobIndex);
    rarity = clampRarity(std::max(rarityIndex(rarity), rarityIndex(config.minRarity)));
    const double radius = content.mobStats(mobIndex, rarity).radius;
    // A dummy placed as an NPC shrinks with its tier exactly as one a band
    // plants does (MobConfig::fixtureSizeScale).
    return (radius > 0.0 ? radius : kMobBaseRadius) * config.fixtureSizeScale(rarity);
}

Vec2 NpcSystem::pickRoamingSpot(const Terrain& terrain, const ContentRegistry& content,
                                 const Site& site) {
    // Open, dry ground, clear of walls for the body and -- for one that
    // cruises -- a margin to wander in; then, failing that, for the body
    // alone, then any open point at all. Each pass is a fixed number of
    // draws, so a site drawn over solid rock costs a bounded search, never a
    // hang.
    const double radius = npcRadius(content, site.mobIndex, site.rarity);
    const MobConfig& config = content.mob(site.mobIndex);
    const bool cruises = !config.npc.still && config.beeFlight;
    const double margins[] = {radius + (cruises ? kNpcLeashRadius : 0.0), radius, 0.0};
    for (const double clearance : margins) {
        for (int attempt = 0; attempt < 200; ++attempt) {
            const Vec2 at{site.area.x + rng_.unit() * site.area.w,
                          site.area.y + rng_.unit() * site.area.h};
            if (!zoneContains(site.area, site.outline, at)) continue;
            if (terrain.blocked(at, site.realm) || terrain.inWater(at, site.realm)) continue;
            if (clearance > 0.0 && terrain.resolveWall(at, clearance, site.realm).collided) continue;
            return at;
        }
    }
    return site.position;
}

Entity NpcSystem::spawnNpc(World& world, const Terrain& terrain, const ContentRegistry& content,
                           std::uint16_t mobIndex, Rarity rarity, Vec2 at, Realm realm,
                           double nowMillis, std::optional<Team> side) {
    if (mobIndex >= content.mobCount()) return NULL_ENTITY;
    const MobConfig& config = content.mob(mobIndex);
    // The mob's own size ladder and floor, exactly as a wild one of the same
    // tier would have: an NPC and its enemy twin are the same creature. An
    // NPC alone may stand at universal -- the tier is its plate, and its stats
    // read apex (mobStats) -- because no NPC is ever rolled: one is placed.
    rarity = clampRarity(std::max(rarityIndex(rarity), rarityIndex(config.minRarity)));
    const MobStats stats = content.mobStats(mobIndex, rarity);
    const double radius = npcRadius(content, mobIndex, rarity);

    // It meets walls as a point, as its mob does, so it has to start with its
    // centre on open ground -- and one standing still is never moved again.
    const Vec2 position = terrain.resolveCircle(at, kMobWallRadius, realm);

    const Entity e = world.create();
    world.add<NpcTag>(e);
    // Facing down the screen until somebody walks up: the eye is centred on
    // nothing in particular, which reads as a creature at rest. A still one
    // faces east, its drawing's own pose, and keeps it.
    const bool still = config.npc.still;
    world.add<Transform>(e, Transform{position, still ? 0.0 : kPi * 0.5, realm});
    world.add<Body>(e, Body{radius, stats.mass});
    const Team team = side.value_or(config.npc.team);
    world.add<Faction>(e, Faction{team, false});
    // Off the players' side it is a thing to fight, and it fights back with
    // its mob's own body: the same bite, at this tier, on the mob's cadence --
    // what touching a flower costs it and what a petal striking it pays. The
    // players' own NPCs touch nobody (and canHit refuses them anyway): a mob
    // wandering through the oracle must not be bitten by it -- unless the NPC
    // wears a ring, which makes it a fighter on its side the way a flower is
    // one on the players': its body bites what its petals hit.
    const bool fighter = config.npc.wearsPetals();
    if (team != Team::Players || fighter) {
        world.add<ContactDamage>(e, ContactDamage{stats.damage, kMobHitIntervalMillis});
    }
    // The ring itself is the petal system's: a loadout, one slot a petal, and
    // the ring geometry it lays them out on. Everything after that -- the fly
    // out, the orbit about this body's edge, the breaks and the reloads -- is
    // what a flower's ring does, by the same code.
    if (fighter) {
        Loadout loadout;
        for (std::size_t i = 0; i < config.npc.petals.size() && i < kLoadoutActiveSlots; ++i) {
            loadout.slots[i].configIndex = config.npc.petals[i];
            loadout.slots[i].rarity = config.npc.petalRarity;
        }
        world.add<Loadout>(e, std::move(loadout));
        world.add<PetalRing>(e);
    }
    // The mob's own pool, armour and dodge at this tier, so that an NPC on the
    // other side is hit exactly as its mob would be -- the whole point of a
    // target dummy -- and its plate reads the same pool. The pool never moves:
    // the damage path takes nothing off an NPC (CombatSystem::applyDamage).
    // Afflictions is what lets poison and a bur's strip land on one.
    world.add<Health>(e, Health{stats.health, stats.health, 0.0, 0.0});
    world.add<Armor>(e, Armor{stats.armor});
    if (stats.evasion > 0.0) world.add<Evasion>(e, Evasion{stats.evasion});
    world.add<Afflictions>(e);

    Npc npc;
    npc.configIndex = mobIndex;
    npc.rarity = rarity;
    npc.service = config.npc.service;
    npc.home = position;
    npc.nextGlanceMillis = nowMillis;
    // Flies like its mob does when its mob flies like a bee, starting off on
    // a heading and a weave of its own.
    npc.still = still;
    // One recipe each, rolled here: a replaced assembler may well make
    // something else. Off the NPCs' own stream, so it moves no spawn.
    if (!config.npc.recipes.empty()) {
        npc.recipe = static_cast<std::uint8_t>(
            rng_.below(static_cast<std::uint32_t>(config.npc.recipes.size())));
    }
    npc.cruises = !still && config.beeFlight && stats.speed > 0.0;
    const BeeCruiseDrive cruise = beeCruiseDrive(stats.speed, stats.cruiseSpeed);
    npc.speed = cruise.thrust;
    npc.cruiseCeiling = cruise.ceiling;
    npc.cruise.heading = rng_.angle();
    npc.cruise.headingPickedMillis = nowMillis;
    npc.cruise.phase = rng_.angle();
    world.add<Npc>(e, npc);

    world.add<Replicated>(e, Replicated{net::EntityKind::Npc, 0, mobIndex, rarity, 0});
    if (netIds != nullptr) world.add<NetId>(e, NetId{netIds->next()});
    return e;
}

void NpcSystem::placeMissing(World& world, const Terrain& terrain, const ContentRegistry& content,
                             double nowMillis) {
    for (Site& site : sites_) {
        if (site.entity != NULL_ENTITY && world.isAlive(site.entity) && world.has<NpcTag>(site.entity)) {
            continue;
        }
        if (site.roams) site.position = pickRoamingSpot(terrain, content, site);
        site.entity = spawnNpc(world, terrain, content, site.mobIndex, site.rarity, site.position,
                               site.realm, nowMillis);
    }
}

void NpcSystem::run(World& world, const Terrain& terrain, const ContentRegistry& content,
                    const std::vector<RealmPoint>& players, double nowMillis) {
    bind(world);
    // Before the query walk, never inside it: a create relocates rows.
    placeMissing(world, terrain, content, nowMillis);

    npcs_->each([&](Entity e, NpcTag&, Npc& npc, Transform& transform) {
        // Neither moves nor turns: it stands where it was put down, facing
        // where it was put down facing.
        if (npc.still) return;
        if (npc.cruises) {
            // The leash: out past it, the heading swings back toward home a
            // little each tick, and the weave the cruise lays over it goes on.
            const Vec2 fromHome = transform.position - npc.home;
            if (fromHome.lengthSq() > kNpcLeashRadius * kNpcLeashRadius) {
                npc.cruise.heading =
                    lerpAngle(npc.cruise.heading, (npc.home - transform.position).angle(),
                              kNpcLeashTurn);
            }
            // The fixed step, as the mob half of the tick is: the cruise's
            // friction is stated per tick.
            const Vec2 velocity =
                stepBeeCruise(npc.cruise, npc.speed, npc.cruiseCeiling, nowMillis,
                              net::kTickSeconds, rng_);
            // Against walls as a point, and stepped as a mob's move is, so a
            // point cannot plunge through a thin wall in one go.
            const Vec2 from = transform.position;
            stepCollide(terrain, transform.realm, transform.position, velocity, kMobWallRadius,
                        net::kTickSeconds);
            // Its eye is on where it is GOING -- the step it actually took, so
            // one sliding along a wall looks along the wall -- and nowhere
            // else, flowers or no flowers. Held on the last bearing through a
            // tick that went nowhere, rather than snapping to east.
            const Vec2 step = transform.position - from;
            if (step.lengthSq() > 1e-12) transform.angle = step.angle();
            return;
        }

        // One that stands watches the nearest flower in its own realm, measured
        // from its centre.
        // A linear walk: there are a handful of NPCs and a few dozen flowers,
        // and anything cleverer would cost more to build than this costs to do.
        const double watch = kNpcWatchRange * kNpcWatchRange;
        double bestSq = watch;
        const RealmPoint* nearest = nullptr;
        for (const RealmPoint& player : players) {
            if (player.realm != transform.realm) continue;
            const double gapSq = distanceSq(player.position, transform.position);
            if (gapSq < bestSq) {
                bestSq = gapSq;
                nearest = &player;
            }
        }
        if (nearest != nullptr) {
            // A flower standing exactly on it has no bearing to look along;
            // the last one is kept rather than snapping to east.
            const Vec2 toward = nearest->position - transform.position;
            if (toward.lengthSq() > 1e-6) transform.angle = toward.angle();
            // Held on the last bearing for one glance after the flower walks
            // out of range: it watches them go rather than looking away the
            // tick they cross the line.
            npc.nextGlanceMillis = nowMillis + kNpcGlanceMillis;
            return;
        }
        // Nobody to look at: it glances about.
        if (nowMillis < npc.nextGlanceMillis) return;
        transform.angle = rng_.angle();
        npc.nextGlanceMillis = nowMillis + kNpcGlanceMillis + rng_.unit() * kNpcGlanceSpreadMillis;
    });
}

Entity NpcSystem::findService(World& world, NpcService service, Vec2 at, Realm realm,
                              double reach, std::optional<Rarity> tier) {
    bind(world);
    Entity best = NULL_ENTITY;
    double bestGap = 0.0;
    npcs_->each([&](Entity e, NpcTag&, Npc& npc, Transform& transform) {
        if (npc.service != service || transform.realm != realm) return;
        if (tier && npc.rarity != *tier) return;
        const Body* body = world.tryGet<Body>(e);
        const double gap = distance(at, transform.position) - (body != nullptr ? body->radius : 0.0);
        if (gap > reach) return;
        if (best != NULL_ENTITY && gap >= bestGap) return;
        best = e;
        bestGap = gap;
    });
    return best;
}

} // namespace flix
