// The sacrifice petal, end to end on a real server: Hel lays one on its
// ground on a clock, and a flower that dies wearing one summons a mob of the
// ground it fell on.

#include "test.h"

#include <string>
#include <vector>

#include "server/game_server.h"
#include "server/systems/spawning.h"
#include "server/text.h"
#include "server_harness.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"

using namespace flix;

namespace {

using flix::testsupport::GameServerPeer;
using flix::testsupport::Harness;
using flix::testsupport::loginNew;
using flix::testsupport::sawText;

Entity soleBody(World& world, const std::string& name) {
    Entity found = NULL_ENTITY;
    int count = 0;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username != name) return;
        found = e;
        ++count;
    });
    return count == 1 ? found : NULL_ENTITY;
}

/// An open point in the first overworld band whose difficulty passes (or
/// fails) groundTakesSacrifice -- read off the shipped map, which the author
/// rebalances, rather than written down.
bool overworldBandPoint(const GameServer& server, bool rough, Vec2& out) {
    const MapData* map = server.worldMaps().forRealm(Realm::Overworld);
    if (map == nullptr) return false;
    for (const MapElement& band : map->elements()) {
        if (!band.isSpawnBand()) continue;
        if (groundTakesSacrifice(band.difficulty) != rough) continue;
        // The first match in map order is the band a point reads as, so the
        // point must not also sit in an earlier band of the other kind.
        for (int i = 0; i < 400; ++i) {
            const Vec2 at{band.bounds.x + band.bounds.w * ((i % 20) + 0.5) / 20.0,
                          band.bounds.y + band.bounds.h * ((i / 20) + 0.5) / 20.0};
            if (!zoneContains(band.bounds, band.polygon, at)) continue;
            if (server.terrain().blocked(at, Realm::Overworld)) continue;
            bool earlier = false;
            for (const MapElement& other : map->elements()) {
                if (&other == &band) break;
                if (other.isSpawnBand() && zoneContains(other.bounds, other.polygon, at)) {
                    earlier = true;
                }
            }
            if (earlier) continue;
            out = at;
            return true;
        }
    }
    return false;
}

/// Wears an apex sacrifice in slot 0, the way a player does.
bool wearSacrifice(Harness& h, NetClient& client, const char* account, std::uint16_t sacrifice) {
    if (!h.server.grantAdmin(client.sessionToken())) return false;
    client.sendChat(std::string("/admin give ") + account + " sacrifice apex 1");
    if (!h.stepUntil({&client}, [&] {
            return client.profile().stackCount(sacrifice, Rarity::Apex) > 0;
        })) {
        return false;
    }
    client.setLoadoutSlot(0, sacrifice, Rarity::Apex);
    return h.stepUntil({&client}, [&] {
        return !client.profile().loadout.empty() &&
               client.profile().loadout[0].petalIndex == sacrifice;
    });
}

void kill(World& world, Entity body) {
    world.get<Health>(body).current = 0.0;
    world.add<Dead>(body, Dead{NULL_ENTITY});
}

std::vector<Entity> ritualsIn(World& world) {
    std::vector<Entity> found;
    Query<SacrificeRitual> rituals{world};
    rituals.each([&](Entity e, SacrificeRitual&) { found.push_back(e); });
    return found;
}

int apexMobsNear(World& world, Vec2 at, double reach) {
    int n = 0;
    Query<MobTag, MobType, Transform> mobs{world};
    mobs.each([&](Entity e, MobTag&, MobType& type, Transform& transform) {
        if (world.has<Dead>(e) || type.rarity != Rarity::Apex) return;
        if (distance(transform.position, at) <= reach) ++n;
    });
    return n;
}

} // namespace

TEST(dying_with_a_sacrifice_on_rough_ground_summons_an_apex_there_and_spends_it) {
    Harness h("sacrifice-summon", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t sacrifice = content().petalIndex(kSacrificePetalId);
    if (sacrifice == kInvalidIndex) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));
    CHECK(wearSacrifice(h, alice, "alice", sacrifice));

    World& world = h.server.world();
    const Entity body = soleBody(world, "alice");
    if (body == NULL_ENTITY) { CHECK(false); return; }
    if (world.get<Transform>(body).realm != Realm::Overworld) { CHECK(false); return; }
    Vec2 at;
    if (!overworldBandPoint(h.server, true, at)) { CHECK(false); return; }
    world.get<Transform>(body).position = at;
    CHECK_EQ(apexMobsNear(world, at, 400.0), 0);

    const double killedAt = h.clock;
    kill(world, body);
    // Spent at once, and the ritual laid where the flower fell -- with no mob
    // yet: the pentagram is still being drawn.
    CHECK(h.stepUntil({&alice}, [&] {
        return !alice.profile().loadout.empty() && alice.profile().loadout[0].empty();
    }));
    CHECK_EQ(alice.profile().stackCount(sacrifice, Rarity::Apex), 0u);
    const std::vector<Entity> rituals = ritualsIn(world);
    CHECK_EQ(rituals.size(), std::size_t(1));
    if (rituals.size() != 1) return;
    const Entity ritual = rituals.front();
    CHECK(distance(world.get<Transform>(ritual).position, at) < 1.0);
    CHECK(world.get<Replicated>(ritual).kind == net::EntityKind::Effect);
    CHECK_EQ(apexMobsNear(world, at, 400.0), 0);

    // Five seconds on, the pentagram is complete and the mob comes out at its
    // centre; the star is five times the mob.
    while (h.clock < killedAt + kSacrificeRitualMillis - 100.0) h.step(1, {&alice});
    CHECK_EQ(apexMobsNear(world, at, 400.0), 0);
    CHECK(h.stepUntil({&alice}, [&] { return apexMobsNear(world, at, 400.0) == 1; }, 10));
    const SacrificeRitual& answered = world.get<SacrificeRitual>(ritual);
    CHECK(answered.mob != NULL_ENTITY);
    CHECK_NEAR(answered.radius,
               world.get<Body>(answered.mob).radius * kSacrificeRitualRadiusScale, 1e-6);
    // The summoned mob is flagged, so its own star does not grey it.
    CHECK((world.get<Replicated>(answered.mob).spawnFlags & net::SpawnSacrificed) != 0);
    CHECK(h.stepUntil({&alice}, [&] { return sawText(alice, "summoned"); }));

    // The star and the pentagram stand until the mob is dead.
    h.step(30, {&alice});
    CHECK(world.isAlive(ritual));
    world.add<Dead>(answered.mob, Dead{NULL_ENTITY});
    CHECK(h.stepUntil({&alice}, [&] { return !world.isAlive(ritual); }, 10));
}

TEST(a_restart_during_a_sacrifice_hands_the_apex_clock_back) {
    // The ritual spends its biome's apex clock the moment the pentagram
    // starts. A restart before the apex is out, or while it stands, loses it
    // unkilled, so what the save leaves on disk is a clock already spent --
    // ready to the next run. Once the apex is dead the whole cooldown is.
    Harness h("sacrifice-restart", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t sacrifice = content().petalIndex(kSacrificePetalId);
    if (sacrifice == kInvalidIndex) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));
    CHECK(wearSacrifice(h, alice, "alice", sacrifice));

    World& world = h.server.world();
    const Entity body = soleBody(world, "alice");
    if (body == NULL_ENTITY) { CHECK(false); return; }
    Vec2 at;
    if (!overworldBandPoint(h.server, true, at)) { CHECK(false); return; }
    world.get<Transform>(body).position = at;

    // Each biome's apex wait as the database file would hold it: persistAll
    // is the save a shutdown ends on, and the periodic one is the same call.
    const auto savedApexWaits = [&] {
        h.server.persistAll();
        const Json& table = h.server.database().storedTable("bossClocks");
        const double now = static_cast<double>(h.server.database().nowMillis());
        std::vector<std::pair<std::string, double>> waits;
        for (const std::string& biome : table.keys()) {
            waits.emplace_back(biome, table[biome]["apexReadyAt"].asDouble() - now);
        }
        return waits;
    };
    // A fresh boot deals every apex clock somewhere inside one cooldown.
    for (const auto& wait : savedApexWaits()) CHECK(wait.second > 0.0);

    kill(world, body);
    CHECK(h.stepUntil({&alice}, [&] { return ritualsIn(world).size() == 1; }, 10));
    if (ritualsIn(world).size() != 1) return;
    const Entity ritual = ritualsIn(world).front();
    CHECK(world.get<SacrificeRitual>(ritual).mob == NULL_ENTITY);

    // Mid-pentagram: exactly one biome's apex clock is spent, and it is saved
    // as ready.
    std::string biome;
    for (const auto& wait : savedApexWaits()) {
        if (wait.second <= 0.0) {
            CHECK(biome.empty());
            biome = wait.first;
        }
    }
    CHECK(!biome.empty());
    if (biome.empty()) return;

    const auto savedWait = [&] {
        for (const auto& wait : savedApexWaits()) {
            if (wait.first == biome) return wait.second;
        }
        return -1e300;
    };
    // The apex out and standing: still saved as ready.
    CHECK(h.stepUntil({&alice}, [&] { return world.get<SacrificeRitual>(ritual).mob != NULL_ENTITY; },
                      static_cast<int>(kSacrificeRitualMillis / net::kTickMillis) + 10));
    const Entity apex = world.get<SacrificeRitual>(ritual).mob;
    if (apex == NULL_ENTITY) return;
    CHECK(savedWait() <= 0.0);

    // Dead, the apex spent the clock for real.
    world.add<Dead>(apex, Dead{NULL_ENTITY});
    h.step(2, {&alice});
    CHECK(savedWait() > kApexSpawnCooldownMillis - 60000.0);
}

TEST(a_sacrifice_on_gentle_ground_is_turned_away_and_kept) {
    Harness h("sacrifice-gentle", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t sacrifice = content().petalIndex(kSacrificePetalId);
    if (sacrifice == kInvalidIndex) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));
    CHECK(wearSacrifice(h, alice, "alice", sacrifice));

    World& world = h.server.world();
    const Entity body = soleBody(world, "alice");
    if (body == NULL_ENTITY) { CHECK(false); return; }
    Vec2 at;
    if (!overworldBandPoint(h.server, false, at)) { CHECK(false); return; }
    world.get<Transform>(body).position = at;

    kill(world, body);
    CHECK(h.stepUntil({&alice}, [&] {
        return sawText(alice, "cannot be used in low mob rarity areas");
    }));
    h.step(5, {&alice});
    CHECK(!alice.profile().loadout.empty() &&
          alice.profile().loadout[0].petalIndex == sacrifice);
    CHECK_EQ(apexMobsNear(world, at, 400.0), 0);
}

TEST(hel_lays_one_apex_sacrifice_on_its_clock_for_the_first_human_to_find) {
    Harness h("sacrifice-hel", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t sacrifice = content().petalIndex(kSacrificePetalId);
    if (sacrifice == kInvalidIndex) { CHECK(false); return; }
    bool found = false;
    const Realm hel = h.server.worldMaps().realmOfId("hel", found);
    CHECK(found);

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    // A fresh server deals its first wait: never more than a day off.
    const double dealt = GameServerPeer::sacrificeReadyMillis(h.server);
    CHECK(dealt >= 0.0);
    const Json& table = h.server.database().storedTable("sacrificeSpawn");
    CHECK(table.isObject() && table["readyAt"].isNumber());
    const double wallNow = static_cast<double>(h.server.database().nowMillis());
    CHECK(table["readyAt"].asDouble() <= wallNow + 24.0 * 3600.0 * 1000.0 + 1000.0);
    CHECK(GameServerPeer::sacrificeDrop(h.server) == NULL_ENTITY);

    GameServerPeer::windSacrificeClock(h.server, 0.0);
    CHECK(h.stepUntil({&alice}, [&] {
        return GameServerPeer::sacrificeDrop(h.server) != NULL_ENTITY;
    }));
    World& world = h.server.world();
    const Entity drop = GameServerPeer::sacrificeDrop(h.server);
    CHECK(world.isAlive(drop));
    const DropItem& item = world.get<DropItem>(drop);
    CHECK_EQ(item.configIndex, sacrifice);
    CHECK(item.rarity == Rarity::Apex);
    CHECK(item.singleCopy);
    CHECK(item.humansOnly);
    CHECK(world.get<Transform>(drop).realm == hel);
    CHECK(GameServerPeer::sacrificeReadyMillis(h.server) > 0.0);
    // Laid without a word: nobody is told it is there.
    h.step(10, {&alice});
    CHECK(!sawText(alice, "Sacrifice has appeared"));

    // Its clock running out again while it still lies there lays no second.
    GameServerPeer::windSacrificeClock(h.server, 0.0);
    h.step(3, {&alice});
    CHECK(GameServerPeer::sacrificeDrop(h.server) == drop);
    int sacrifices = 0;
    Query<DropItem> drops{world};
    drops.each([&](Entity, DropItem& d) { sacrifices += d.configIndex == sacrifice ? 1 : 0; });
    CHECK_EQ(sacrifices, 1);
}

TEST(a_summon_is_announced_as_summoned_and_somewhere_outside_its_biome) {
    Harness h("sacrifice-summon-line", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t sacrifice = content().petalIndex(kSacrificePetalId);
    if (sacrifice == kInvalidIndex) { CHECK(false); return; }

    NetClient alice;
    NetClient bob;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    CHECK(loginNew(h, bob, "bob", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    bob.joinGame(1280, 720, kMazeSpawnChoice, "bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing;
    }));
    CHECK(wearSacrifice(h, alice, "alice", sacrifice));

    World& world = h.server.world();
    const Entity body = soleBody(world, "alice");
    if (body == NULL_ENTITY) { CHECK(false); return; }
    Vec2 at;
    if (!overworldBandPoint(h.server, true, at)) { CHECK(false); return; }
    world.get<Transform>(body).position = at;

    kill(world, body);
    CHECK(h.stepUntil({&alice, &bob}, [&] { return apexMobsNear(world, at, 400.0) == 1; }));
    const std::vector<Entity> rituals = ritualsIn(world);
    if (rituals.size() != 1) { CHECK(false); return; }
    const Entity mob = world.get<SacrificeRitual>(rituals.front()).mob;
    if (mob == NULL_ENTITY) { CHECK(false); return; }
    const std::string named =
        "A Apex " + content().mob(world.get<MobType>(mob).configIndex).name;

    // Alice fell in the summon's biome; bob is in the maze.
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return sawText(alice, named + " has been summoned!") &&
               sawText(bob, named + " has been summoned somewhere!");
    }));
    // ...and not also as an ordinary boss spawn.
    h.step(5, {&alice, &bob});
    CHECK(!sawText(alice, named + " has spawned"));
    CHECK(!sawText(bob, named + " has spawned"));
}

TEST(the_console_lays_hels_sacrifice_now) {
    Harness h("sacrifice-console", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    bool found = false;
    const Realm hel = h.server.worldMaps().realmOfId("hel", found);
    CHECK(found);

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));
    CHECK(h.server.grantAdmin(alice.sessionToken()));

    // Its clock a day off, so only the command can be what lays it.
    GameServerPeer::windSacrificeClock(h.server, h.clock + 24.0 * 3600.0 * 1000.0);
    const double readyAt = GameServerPeer::sacrificeReadyMillis(h.server);
    CHECK(GameServerPeer::sacrificeDrop(h.server) == NULL_ENTITY);

    alice.sendChat("/admin sacrifice");
    CHECK(h.stepUntil({&alice}, [&] { return sawText(alice, "Placed one in"); }));
    const Entity drop = GameServerPeer::sacrificeDrop(h.server);
    World& world = h.server.world();
    CHECK(drop != NULL_ENTITY && world.isAlive(drop));
    if (drop == NULL_ENTITY) return;
    CHECK(world.get<Transform>(drop).realm == hel);
    CHECK(world.get<DropItem>(drop).rarity == Rarity::Apex);
    CHECK(world.get<DropItem>(drop).singleCopy);
    CHECK(!sawText(alice, "Sacrifice has appeared"));
    CHECK_EQ(GameServerPeer::sacrificeReadyMillis(h.server), readyAt);

    // Asked again, it says where the first one lies rather than laying two.
    alice.sendChat("/admin sacrifice");
    CHECK(h.stepUntil({&alice}, [&] { return sawText(alice, "One is already lying in"); }));
    CHECK(GameServerPeer::sacrificeDrop(h.server) == drop);
}

TEST(the_sacrifice_star_is_the_grey_star_not_its_circle) {
    const Vec2 centre{100.0, -50.0};
    const double facing = 0.7;
    const double r = 200.0;
    const auto along = [&](double turn, double reach) {
        return centre + Vec2::fromAngle(facing + turn * kTau, reach);
    };
    CHECK(insideSacrificeStar(centre, facing, r, centre));
    // Out along a point, nearly to its tip.
    for (int k = 0; k < 5; ++k) CHECK(insideSacrificeStar(centre, facing, r, along(k / 5.0, r * 0.95)));
    // Between two points: in up to the inner corner, out past it.
    for (int k = 0; k < 5; ++k) {
        CHECK(insideSacrificeStar(centre, facing, r, along((k + 0.5) / 5.0, r * kSacrificeStarInner * 0.95)));
        CHECK(!insideSacrificeStar(centre, facing, r, along((k + 0.5) / 5.0, r * kSacrificeStarInner * 1.05)));
        CHECK(!insideSacrificeStar(centre, facing, r, along((k + 0.5) / 5.0, r * 0.9)));
    }
    CHECK(!insideSacrificeStar(centre, facing, r, along(0.0, r * 1.01)));
}

TEST(a_sacrifice_star_kills_the_summons_in_it_and_reloads_the_eggs_in_it) {
    Harness h("sacrifice-star", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t egg = content().petalIndex("soldier_ant_egg");
    if (egg == kInvalidIndex) { CHECK(false); return; }

    NetClient bob;
    CHECK(loginNew(h, bob, "bob", "hunter2!"));
    bob.joinGame(1280, 720, {}, "bob");
    CHECK(h.stepUntil({&bob}, [&] { return bob.status() == NetClient::Status::Playing; }));
    CHECK(h.server.grantAdmin(bob.sessionToken()));
    bob.sendChat("/admin give bob soldier_ant_egg common 1");
    CHECK(h.stepUntil({&bob}, [&] { return bob.profile().stackCount(egg, Rarity::Common) > 0; }));
    bob.setLoadoutSlot(0, egg, Rarity::Common);

    World& world = h.server.world();
    const Entity body = soleBody(world, "bob");
    if (body == NULL_ENTITY) { CHECK(false); return; }
    const auto firstPet = [&] {
        Entity found = NULL_ENTITY;
        Query<Pet> pets{world};
        pets.each([&](Entity e, Pet& pet) {
            if (pet.owner == body && !world.has<Dead>(e) && found == NULL_ENTITY) found = e;
        });
        return found;
    };
    const auto eggsOut = [&] {
        int n = 0;
        Query<PetalInstance> petals{world};
        petals.each([&](Entity e, PetalInstance& instance) {
            if (instance.owner == body && instance.configIndex == egg && !world.has<Dead>(e)) ++n;
        });
        return n;
    };
    // Bob, his ring and his summons are kept out of harm's way while the test
    // waits: a wild mob at the door can break an egg or kill a common soldier
    // ant, and whether one is about depends on everything else the world's
    // dice were spent on. The star kills by fell() and reloads by spending the
    // slot, which no invulnerability stops.
    const auto shield = [&] {
        const double until = h.clock + 1000.0;
        world.get<Health>(body).invulnerableUntilMillis = until;
        Query<Pet, Health> pets{world};
        pets.each([&](Entity, Pet& pet, Health& health) {
            if (pet.owner == body) health.invulnerableUntilMillis = until;
        });
        Query<PetalInstance, Health> ring{world};
        ring.each([&](Entity, PetalInstance& instance, Health& health) {
            if (instance.owner == body) health.invulnerableUntilMillis = until;
        });
    };
    const auto ready = [&] {
        shield();
        return !world.get<Loadout>(body).slots[0].broken && eggsOut() > 0 && firstPet() != NULL_ENTITY;
    };
    CHECK(h.stepUntil({&bob}, ready, 600));
    if (!ready()) return;

    // A ritual laid by hand, its pentagram forever being drawn.
    const auto layStar = [&](Vec2 at, double radius) {
        SacrificeRitual ritual;
        ritual.mobIndex = 0;
        ritual.rarity = Rarity::Apex;
        ritual.summonAtMillis = 1e18;
        ritual.radius = radius;
        const Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0, world.get<Transform>(body).realm});
        world.add<SacrificeRitual>(e, ritual);
        return e;
    };

    // A spot `reach` off the flower that it can see: a pet out of its owner's
    // sight is teleported back beside it.
    const auto inSight = [&](double reach) {
        const Transform& at = world.get<Transform>(body);
        for (int i = 0; i < 16; ++i) {
            const Vec2 spot = at.position + Vec2::fromAngle(i * kTau / 16.0, reach);
            if (!h.server.terrain().blocked(spot, at.realm) &&
                !h.server.terrain().segmentBlocked(at.position, spot, at.realm)) {
                return spot;
            }
        }
        return at.position + Vec2{reach, 0.0};
    };

    // A summon carried into a star away from its flower dies there, and its
    // egg goes back on its reload.
    Entity pet = firstPet();
    Vec2 away = inSight(600.0);
    world.get<Transform>(pet).position = away;
    Entity star = layStar(away, 100.0);
    h.step(1, {&bob});
    CHECK(!world.isAlive(pet) || world.has<Dead>(pet));
    CHECK(world.get<Loadout>(body).slots[0].broken);
    CHECK(world.get<Loadout>(body).slots[0].reloadReadyAtMillis > h.clock);
    CHECK_EQ(eggsOut(), 0);
    world.destroy(star);

    // An egg in a star reloads, and the summon it hatched, standing outside
    // the star, is left alone.
    CHECK(h.stepUntil({&bob}, ready, 600));
    if (!ready()) return;
    pet = firstPet();
    away = inSight(600.0);
    world.get<Transform>(pet).position = away;
    star = layStar(world.get<Transform>(body).position, 300.0);
    h.step(1, {&bob});
    CHECK(world.get<Loadout>(body).slots[0].broken);
    CHECK_EQ(eggsOut(), 0);
    CHECK(world.isAlive(pet) && !world.has<Dead>(pet));
    world.destroy(star);
}
