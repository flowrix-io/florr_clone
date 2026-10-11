// The sacrifice petal, end to end on a real server: Hel lays one on its
// ground on a clock, and a flower that dies wearing one summons a mob of the
// ground it fell on.

#include "test.h"

#include <string>
#include <vector>

#include "server/game_server.h"
#include "server/systems/spawning.h"
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
    CHECK(h.stepUntil({&alice}, [&] { return sawText(alice, "Sacrifice has appeared"); }));

    // Its clock running out again while it still lies there lays no second.
    GameServerPeer::windSacrificeClock(h.server, 0.0);
    h.step(3, {&alice});
    CHECK(GameServerPeer::sacrificeDrop(h.server) == drop);
    int sacrifices = 0;
    Query<DropItem> drops{world};
    drops.each([&](Entity, DropItem& d) { sacrifices += d.configIndex == sacrifice ? 1 : 0; });
    CHECK_EQ(sacrifices, 1);
}
