// NPCs, and the first two with a service: the oracle and the trader.
//
// An NPC is a mob's config standing in the world without being a mob
// (shared/game/npc.h). These hold the whole chain to account: the map places
// one, its pool never moves -- a friendly one refuses every hit, a hostile one
// like the target dummy takes them all and loses nothing -- it watches whoever
// walks up, it is streamed as its own kind and drawn with the mob's plate and
// an invulnerable bar, an admin can still spawn the same creature as an enemy,
// and the oracle's service, a guaranteed craft at a fixed price, is charged
// exactly that price and is refused to anyone not standing at it. The trader's,
// one petal for one coin of its tier once a day, is held to the same.

#include "test.h"

#include <cmath>
#include <string>
#include <vector>

#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/ui/theme.h"
#include "client/world_view.h"
#include "fixture_content.h"
#include "server/db.h"
#include "server/systems/combat.h"
#include "server/systems/movement.h"
#include "server/systems/npcs.h"
#include "server_harness.h"
#include "shared/game/map_elements.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

void seedAccount(const std::string& path, const std::string& username, bool admin = false) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    CreateResult created = db.createUser(username, "password7");
    if (created.ok() && admin) created.account->admin = true;
    db.markDirty();
    db.save();
}

void seedStack(const std::string& path, const std::string& username, const char* itemKey,
               Rarity rarity, int count) {
    Database db;
    std::string error;
    db.load(path, error);
    const Account* account = db.findUser(username);
    if (account == nullptr) return;
    db.progress(account->id).addItem(rarity, itemKey, count);
    db.markDirty();
    db.save();
}

/// Where the fixture's oracle stands: a cell and a half east of the one-cell
/// door, so a flower put down anywhere in the door is inside the server's
/// reach of it without starting on top of it.
constexpr double kOracleX = kTileSize * 3.5;
constexpr double kOracleY = kTileSize * 2.5;

/// A 24x24 walled field: one small door, and whatever `npcs` the test names.
std::string npcWorld(const std::string& name, const std::string& npcs) {
    const double cell = kTileSize;
    const std::string map =
        fixtureMap(24, 24, fixtureDoor("meadow", "Meadow", cell * 2, cell * 2, cell, cell, true, 0.0),
                   std::string(), std::string(), {}, {}, {}, npcs);
    return stageDataDir(name, {{"meadow", map}});
}

std::string oracleWorld(const std::string& name) {
    return npcWorld(name, fixtureNpc(kOracleX, kOracleY, "oracle", "epic"));
}

/// The NPC standing in `world` that wears mob `id`, or NULL_ENTITY.
Entity npcWearing(World& world, const char* id) {
    Entity found = NULL_ENTITY;
    Query<NpcTag, Npc> npcs{world};
    npcs.each([&](Entity e, NpcTag&, Npc& npc) {
        if (npc.configIndex == content().mobIndex(id)) found = e;
    });
    return found;
}

Entity onlyPlayer(World& world);

/// Steps until every petal `flower` has equipped is out. A new flower's ring
/// arrives a couple of seconds after it does, and a test that starts counting
/// hits before then is counting the wait.
bool awaitRing(Harness& h, const std::vector<NetClient*>& clients, World& world, Entity flower) {
    return h.stepUntil(clients, [&] {
        const Loadout& loadout = world.get<Loadout>(flower);
        std::size_t equipped = 0;
        for (const LoadoutSlot& slot : loadout.slots) equipped += slot.empty() ? 0 : 1;
        return equipped > 0 && loadout.spawned.size() >= equipped;
    }, 200);
}

/// One full turn of the ring and a little over: every petal passes a given
/// point once, which is as many hits as a ring of petals that each break on
/// their first touch can land.
constexpr int kOneRingTurnTicks = static_cast<int>(kTau / kPetalSpinRate * net::kTicksPerSecond) + 15;

/// Where `flower` stands to sweep its ring through `npc` without touching it:
/// just off the NPC's skin, on its west side. The ring orbits wider than the
/// flower's own body, so from here the petals pass through the NPC while the
/// body stays clear of a hostile one's bite -- a flower parked on the ring's
/// own radius is flush against the dummy, and is bitten to death in seconds.
Vec2 ringOnly(World& world, Entity npc, Entity flower) {
    const double standoff = world.get<Body>(npc).radius + world.get<Body>(flower).radius + 8.0;
    return world.get<Transform>(npc).position - Vec2{standoff, 0.0};
}

/// Stands the one flower just clear of the NPC wearing `id`, wherever its
/// cruise has taken it, and lets a tick pass so the server has it there. The
/// oracle does not hold still any more, so "at the oracle" is a place that has
/// to be looked up at the moment it is needed.
void standBeside(Harness& h, NetClient& client, const char* id) {
    World& world = h.server.world();
    const Entity npc = npcWearing(world, id);
    const Entity player = onlyPlayer(world);
    if (npc == NULL_ENTITY || player == NULL_ENTITY) return;
    const Vec2 at = world.get<Transform>(npc).position;
    world.get<Transform>(player).position = at + Vec2{world.get<Body>(npc).radius + 60.0, 0.0};
    h.step(1, {&client});
}

/// Logs `name` in and puts it in the world, waiting for both.
bool joinAs(Harness& h, NetClient& client, const char* name) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, "password7");
    if (!h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; })) {
        return false;
    }
    client.joinGame(1920, 1080, {}, name);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                       200);
}

std::vector<Entity> npcsIn(World& world) {
    std::vector<Entity> out;
    Query<NpcTag> npcs{world};
    npcs.each([&](Entity e, NpcTag&) { out.push_back(e); });
    return out;
}

Entity onlyPlayer(World& world) {
    Entity found = NULL_ENTITY;
    Query<PlayerTag> players{world};
    players.each([&](Entity e, PlayerTag&) { found = e; });
    return found;
}

/// Waits for the oracle's answer and hands it back with `pending` cleared, as
/// the panel reads it.
bool awaitOracle(Harness& h, NetClient& client, OracleOutcome& out) {
    if (!h.stepUntil({&client}, [&] { return client.oracleOutcome().pending; }, 200)) return false;
    out = client.oracleOutcome();
    client.oracleOutcome().pending = false;
    return true;
}

template <class F>
bool awaitProfile(Harness& h, NetClient& client, F predicate) {
    return h.stepUntil({&client}, [&] { return predicate(client.profile()); }, 200);
}

bool ensureShippedContent() {
    std::string error;
    return loadContent(dataDir(), error);
}

} // namespace

// ---------------------------------------------------------------------------
// The price list and the content
// ---------------------------------------------------------------------------

TEST(the_oracle_charges_the_stated_price_for_every_tier) {
    // The design's own numbers, tier by tier -- "unusual" is this game's
    // uncommon. Apex and universal cost nothing because nothing crafts out of
    // either.
    const int expected[] = {7, 11, 19, 34, 65, 128, 253, 506, 1012, 0, 0};
    static_assert(sizeof(expected) / sizeof(expected[0]) == kRarityCount);
    for (int i = 0; i < kRarityCount; ++i) {
        CHECK_EQ(oracleCraftCost(static_cast<Rarity>(i)), expected[i]);
    }
}

TEST(the_shipped_oracle_is_a_mob_that_offers_a_service) {
    CHECK(ensureShippedContent());
    const std::uint16_t oracle = content().mobIndex("oracle");
    CHECK(oracle != kInvalidIndex);
    if (oracle == kInvalidIndex) return;
    const MobConfig& config = content().mob(oracle);
    CHECK(config.npc.present);
    CHECK(config.npc.service == NpcService::Oracle);
    CHECK(config.npc.team == Team::Players);
    // Drawn by code, not a document: the reference art is a 12-frame capture
    // whose eye has to move.
    CHECK_EQ(config.image, std::string("$oracle"));
    // Never grown by the ground and never dropped as an egg: an oracle in the
    // world is one a map or an admin put there.
    CHECK(config.noEggDrop);
    CHECK(!content().mobStats(oracle, Rarity::Common).ambient);
    // The target dummy is another NPC: on the hostiles' side, so a flower
    // can hit it, and offering nothing but that. The trader is the third and
    // the titan the fourth (their own tests below). Nothing else in the
    // shipped content is an NPC by accident.
    const std::uint16_t dummy = content().mobIndex("target_dummy");
    CHECK(dummy != kInvalidIndex);
    if (dummy != kInvalidIndex) {
        CHECK(content().mob(dummy).npc.present);
        CHECK(content().mob(dummy).npc.team == Team::Hostiles);
        CHECK(content().mob(dummy).npc.service == NpcService::None);
    }
    const std::uint16_t trader = content().mobIndex("trader");
    const std::uint16_t titan = content().mobIndex("titan");
    for (std::uint16_t i = 0; i < content().mobCount(); ++i) {
        if (i == oracle || i == dummy || i == trader || i == titan) continue;
        CHECK(!content().mob(i).npc.present);
    }
}

TEST(an_npc_block_is_read_and_its_unknowns_are_reported) {
    ContentRegistry registry;
    std::string error;
    // A service or a side this build does not know is SAID, and read as the
    // default -- the mob is still an NPC, so a map that places one still gets
    // something standing there. A block that is not an object is no NPC.
    const std::string mobs = test::fixtureMobs(R"({
        "seer": { "name": "Seer", "health": 10, "npc": { "service": "oracle" } },
        "fake": { "name": "Fake", "health": 10, "npc": { "service": "banker" } },
        "post": { "name": "Post", "health": 10, "npc": { "team": "hostile" } },
        "odd": { "name": "Odd", "health": 10, "npc": { "team": "pirates" } },
        "flat": { "name": "Flat", "health": 10, "npc": "oracle" },
        "wild": { "name": "Wild", "health": 10 }
    })");
    const std::string petals = test::fixturePetals(R"({ "basic": { "name": "Basic" } })");
    const std::string dir = "/tmp/florr-npc-config-" + std::to_string(::getpid());
    ::mkdir(dir.c_str(), 0755);
    CHECK(writeFile(dir + "/mobs.json", mobs));
    CHECK(writeFile(dir + "/petals.json", petals));
    CHECK(registry.loadFiles(dir + "/mobs.json", dir + "/petals.json", error));
    const auto spec = [&](const char* id) { return registry.mob(registry.mobIndex(id)).npc; };
    CHECK(spec("seer").present);
    CHECK(spec("seer").service == NpcService::Oracle);
    CHECK(spec("seer").team == Team::Players);
    CHECK(spec("fake").present);
    CHECK(spec("fake").service == NpcService::None);
    CHECK(spec("post").present);
    CHECK(spec("post").team == Team::Hostiles);
    CHECK(spec("odd").present);
    CHECK(spec("odd").team == Team::Players);
    CHECK(!spec("flat").present);
    CHECK(!spec("wild").present);
    const auto warned = [&](const char* needle) {
        for (const std::string& line : registry.warnings()) {
            if (line.find(needle) != std::string::npos) return true;
        }
        return false;
    };
    CHECK(warned("banker"));
    CHECK(warned("pirates"));
    CHECK(warned("npc is"));
    removeDataDir(dir);
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

TEST(an_npc_object_is_a_point_naming_its_mob_and_tier) {
    CHECK(ensureShippedContent());
    // Tiled is where an author types "Epic", so the tier is read case-blind;
    // an object naming no mob is dropped rather than placed as nothing.
    const std::string dir = npcWorld("npc-map", fixtureNpc(700.0, 900.0, "oracle", "Epic") + "," +
                                                    fixtureNpc(300.0, 300.0, "", "rare"));
    if (dir.empty()) { CHECK(false); return; }
    MapData map;
    std::string error;
    CHECK(map.loadTiled(dir + "/meadow.tmj", error));
    int npcs = 0;
    for (const MapElement& element : map.elements()) {
        if (element.kind != MapElementKind::Npc) continue;
        ++npcs;
        CHECK_EQ(element.npcId, std::string("oracle"));
        CHECK(element.npcRarity == Rarity::Epic);
        CHECK_NEAR(element.bounds.x, 700.0, 1e-6);
        CHECK_NEAR(element.bounds.y, 900.0, 1e-6);
    }
    CHECK_EQ(npcs, 1);
    removeDataDir(dir);
}

TEST(a_site_that_names_no_npc_is_reported_and_left_empty) {
    CHECK(ensureShippedContent());
    // A mob that offers nothing, and a mob that does not exist: both are
    // typos for an NPC someone meant, and both say so.
    const std::string dir = npcWorld(
        "npc-sites", fixtureNpc(700.0, 700.0, "oracle", "common") + "," +
                         fixtureNpc(900.0, 700.0, "bee", "common") + "," +
                         fixtureNpc(1100.0, 700.0, "not_a_mob", "common"));
    if (dir.empty()) { CHECK(false); return; }
    MapData map;
    std::string error;
    CHECK(map.loadTiled(dir + "/meadow.tmj", error));
    WorldMaps maps;
    maps.adoptSingle(std::move(map));

    NpcSystem npcs;
    std::vector<std::string> warnings;
    npcs.loadSites(maps, content(), warnings);
    CHECK_EQ(npcs.sites().size(), std::size_t(1));
    CHECK_EQ(warnings.size(), std::size_t(2));
    if (!npcs.sites().empty()) {
        CHECK_EQ(npcs.sites()[0].mobIndex, content().mobIndex("oracle"));
    }
    removeDataDir(dir);
}

TEST(an_npc_object_classed_with_its_layers_name_is_read) {
    CHECK(ensureShippedContent());
    // "npcs" on the "npcs" layer is what the jungle's author typed, and every
    // dummy on it was dropped for not saying "npc". The layer's name is as
    // plain a statement of kind as the singular; another layer's kind is not.
    std::string layerNamed = fixtureNpc(700.0, 900.0, "target_dummy", "rare");
    std::string otherKind = fixtureNpc(300.0, 300.0, "oracle", "common");
    const std::string npcClass = "\"type\": \"npc\"";
    layerNamed.replace(layerNamed.find(npcClass), npcClass.size(), "\"type\": \"npcs\"");
    otherKind.replace(otherKind.find(npcClass), npcClass.size(), "\"type\": \"spawn\"");
    const std::string dir = npcWorld("npc-layer-class", layerNamed + "," + otherKind);
    if (dir.empty()) { CHECK(false); return; }
    MapData map;
    std::string error;
    CHECK(map.loadTiled(dir + "/meadow.tmj", error));
    int npcs = 0;
    for (const MapElement& element : map.elements()) {
        if (element.kind != MapElementKind::Npc) continue;
        ++npcs;
        CHECK_EQ(element.npcId, std::string("target_dummy"));
        CHECK(element.npcRarity == Rarity::Rare);
    }
    CHECK_EQ(npcs, 1);
    removeDataDir(dir);
}

TEST(the_shipped_jungle_stands_its_target_dummies) {
    CHECK(ensureShippedContent());
    WorldMaps maps;
    Terrain terrain;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    Realm jungle = Realm::Overworld;
    bool found = false;
    for (std::size_t slot = 0; slot < maps.maps().size(); ++slot) {
        if (maps.maps()[slot].id() != "jungle") continue;
        jungle = maps.maps()[slot].realm();
        found = true;
    }
    CHECK(found);
    NpcSystem npcs;
    std::vector<std::string> warnings;
    npcs.loadSites(maps, content(), warnings);
    int dummies = 0;
    for (const NpcSystem::Site& site : npcs.sites()) {
        if (site.realm != jungle || site.mobIndex != content().mobIndex("target_dummy")) continue;
        ++dummies;
    }
    // One plot per tier, common to apex. Whatever the count becomes, zero is
    // the bug: a whole layer dropped on the class of its objects.
    CHECK(dummies > 0);
    CHECK_EQ(dummies, kLadderRarityCount);
}

TEST(the_shipped_garden_has_an_oracle_on_open_ground) {
    CHECK(ensureShippedContent());
    WorldMaps maps;
    Terrain terrain;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    NpcSystem npcs;
    std::vector<std::string> warnings;
    npcs.loadSites(maps, content(), warnings);
    CHECK(warnings.empty());
    int oracles = 0;
    for (const NpcSystem::Site& site : npcs.sites()) {
        if (content().mob(site.mobIndex).npc.service != NpcService::Oracle) continue;
        ++oracles;
        CHECK(site.realm == Realm::Overworld);
        // Its default size, common: the tier is the NPC's size, and the
        // garden's is the smallest there is.
        CHECK(site.rarity == Rarity::Common);
        // Standing where it was drawn: a centre pushed out of a wall would be
        // somewhere its author did not put it. An NPC meets walls as a point.
        const Vec2 placed = terrain.resolveCircle(site.position, kMobWallRadius, site.realm);
        CHECK_NEAR(placed.x, site.position.x, 1e-6);
        CHECK_NEAR(placed.y, site.position.y, 1e-6);
    }
    CHECK_EQ(oracles, 1);
}

TEST(an_npc_meets_walls_with_its_centre_not_its_body) {
    CHECK(ensureShippedContent());
    Terrain terrain;
    for (int ty = 0; ty < terrain.tileRows(); ++ty) terrain.setTile(10, ty, Tile::Wall);
    const double face = 10.0 * kTileSize;
    World world;
    NpcSystem npcs;
    const std::uint16_t oracle = content().mobIndex("oracle");

    // A big one, so a body-sized standoff would be unmistakable: drawn with
    // its centre just short of the wall, it stands exactly there.
    const Entity beside = npcs.spawnNpc(world, terrain, content(), oracle, Rarity::Mythic,
                                        {face - 5.0, 5000.0}, Realm::Overworld, 0.0);
    CHECK(world.get<Body>(beside).radius > 100.0);
    CHECK_NEAR(world.get<Transform>(beside).position.x, face - 5.0, 1e-9);

    // Drawn inside the wall: out to the face, not a body's width back from it.
    const Entity inside = npcs.spawnNpc(world, terrain, content(), oracle, Rarity::Mythic,
                                        {face + 20.0, 6000.0}, Realm::Overworld, 0.0);
    const Vec2 at = world.get<Transform>(inside).position;
    CHECK(!terrain.blocked(at, Realm::Overworld));
    CHECK(at.x <= face - kMobWallRadius + 1e-6);
    CHECK(at.x > face - 1.0);
}

TEST(a_cruising_npc_flies_up_to_a_wall_with_its_centre) {
    // The oracle cruises on a leash about its home. Homed beside a wall, its
    // flight takes it against the wall, and it is the CENTRE that stops there:
    // measured from the body it could never come nearer than its radius.
    CHECK(ensureShippedContent());
    Terrain terrain;
    for (int ty = 0; ty < terrain.tileRows(); ++ty) terrain.setTile(10, ty, Tile::Wall);
    const double face = 10.0 * kTileSize;
    World world;
    NpcSystem npcs;
    const Entity oracle = npcs.spawnNpc(world, terrain, content(), content().mobIndex("oracle"),
                                        Rarity::Common, {face - 60.0, 5000.0},
                                        Realm::Overworld, 0.0);
    CHECK(world.get<Npc>(oracle).cruises);
    const double radius = world.get<Body>(oracle).radius;

    double now = 0.0;
    double closest = 1e30;
    int inside = 0;
    for (int i = 0; i < 3000; ++i) {
        npcs.run(world, terrain, content(), {}, now);
        now += net::kTickSeconds * 1000.0;
        const Vec2 at = world.get<Transform>(oracle).position;
        if (terrain.blocked(at, Realm::Overworld) || at.x >= face) ++inside;
        closest = std::min(closest, face - at.x);
    }
    CHECK_EQ(inside, 0);
    CHECK(closest < radius * 0.5);
}

// ---------------------------------------------------------------------------
// In the world
// ---------------------------------------------------------------------------

TEST(the_map_places_a_friendly_oracle_whose_pool_never_moves) {
    const std::string dir = oracleWorld("npc-place");
    Harness h("npc-place", [](const std::string& path) { seedAccount(path, "seer"); }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(5, {&client});

    World& world = h.server.world();
    const std::vector<Entity> npcs = npcsIn(world);
    CHECK_EQ(npcs.size(), std::size_t(1));
    if (npcs.size() != 1) { removeDataDir(dir); return; }
    const Entity oracle = npcs[0];

    const Npc& npc = world.get<Npc>(oracle);
    CHECK(npc.service == NpcService::Oracle);
    CHECK(npc.rarity == Rarity::Epic);
    // Its home is the map's mark, and its cruise keeps it about there.
    CHECK_NEAR(npc.home.x, kOracleX, 1e-6);
    CHECK_NEAR(npc.home.y, kOracleY, 1e-6);
    CHECK(npc.cruises);
    CHECK(distance(world.get<Transform>(oracle).position, npc.home) < kNpcLeashRadius);
    // On the players' side, wearing its mob's pool at its tier -- the one its
    // plate is drawn over -- full.
    CHECK(world.get<Faction>(oracle).team == Team::Players);
    CHECK(world.has<Health>(oracle));
    const MobStats stats = content().mobStats(content().mobIndex("oracle"), Rarity::Epic);
    CHECK_NEAR(world.get<Health>(oracle).max, stats.health, 1e-9);
    CHECK_NEAR(world.get<Health>(oracle).current, stats.health, 1e-9);
    // Not a mob: nothing that hunts, farms or recycles mobs can see it.
    CHECK(!world.has<MobTag>(oracle));
    CHECK(!world.has<MobType>(oracle));
    CHECK(!world.has<MobAi>(oracle));
    CHECK(!world.has<Motion>(oracle));

    // Streamed as its own kind, wearing the oracle's config.
    CHECK(h.stepUntil({&client}, [&] {
        for (const auto& entry : client.view().entities()) {
            if (entry.second.kind == net::EntityKind::Npc &&
                entry.second.typeIndex == content().mobIndex("oracle")) {
                return true;
            }
        }
        return false;
    }, 60));
    removeDataDir(dir);
}

TEST(an_npc_that_stands_turns_to_look_at_the_flower_beside_it) {
    // The dummy stands still, so it is the one that watches: walked round to
    // the far side of it, the facing follows the flower.
    const double dummyX = kTileSize * 8.0;
    const double dummyY = kTileSize * 8.0;
    const std::string dir =
        npcWorld("npc-look", fixtureNpc(dummyX, dummyY, "target_dummy", "common"));
    Harness h("npc-look", [](const std::string& path) { seedAccount(path, "seer"); }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity dummy = npcWearing(world, "target_dummy");
    const Entity player = onlyPlayer(world);
    if (dummy == NULL_ENTITY || player == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }

    for (const Vec2 at : {Vec2{dummyX, dummyY + 300.0}, Vec2{dummyX - 300.0, dummyY},
                          Vec2{dummyX + 300.0, dummyY - 10.0}}) {
        world.get<Transform>(player).position = at;
        h.step(2, {&client});
        const Transform& self = world.get<Transform>(dummy);
        const Vec2 flower = world.get<Transform>(player).position;
        const double toward = (flower - self.position).angle();
        CHECK(std::fabs(angleDelta(self.angle, toward)) < 0.05);
    }
    removeDataDir(dir);
}

TEST(the_oracle_looks_where_it_is_flying_even_with_a_flower_beside_it) {
    // The oracle cruises, and its eye is on where it is going: a flower
    // standing right next to it does not turn its head.
    const std::string dir = oracleWorld("npc-look-fly");
    Harness h("npc-look-fly", [](const std::string& path) { seedAccount(path, "seer"); }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity oracle = npcWearing(world, "oracle");
    const Entity player = onlyPlayer(world);
    if (oracle == NULL_ENTITY || player == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }

    int checked = 0;
    for (int i = 0; i < 120; ++i) {
        // Kept right beside it, on the side it is NOT flying toward, so a head
        // that turned to the flower would be pointing the wrong way.
        const Transform& at = world.get<Transform>(oracle);
        const double side = at.angle + kPi * 0.5;
        world.get<Transform>(player).position =
            at.position + Vec2::fromAngle(side, world.get<Body>(oracle).radius + 60.0);
        const Vec2 before = at.position;
        h.step(1, {&client});
        const Transform& after = world.get<Transform>(oracle);
        const Vec2 step = after.position - before;
        if (step.lengthSq() < 1e-6) continue;
        CHECK_NEAR(angleDelta(after.angle, step.angle()), 0.0, 1e-9);
        ++checked;
    }
    CHECK(checked > 60);
    removeDataDir(dir);
}

TEST(an_npc_pool_never_moves_whatever_lands_on_it) {
    // The one rule the damage path adds, asked of the damage path itself: a
    // hit on an NPC LANDS -- it is not refused, it reports what it was worth
    // -- and nothing comes off, not even a blow worth ten times the pool.
    World world;
    CombatSystem combat;
    const auto body = [&](Team team, double health) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{{0.0, 0.0}, 0.0});
        world.add<Body>(e, Body{20.0, 1.0});
        world.add<Health>(e, Health{health, health, 0.0, 0.0});
        world.add<Faction>(e, Faction{team, false});
        return e;
    };
    const Entity flower = body(Team::Players, 100.0);
    world.add<PlayerTag>(flower);
    const Entity dummy = body(Team::Hostiles, 100.0);
    world.add<NpcTag>(dummy);
    // The control: the same body as a mob loses what it is hit for.
    const Entity mob = body(Team::Hostiles, 100.0);
    world.add<MobTag>(mob);

    const DamageResult hit = combat.applyDamage(world, dummy, flower, 40.0, 1000.0);
    CHECK(!hit.refused);
    CHECK_NEAR(hit.applied, 40.0, 1e-9);
    CHECK_NEAR(world.get<Health>(dummy).current, 100.0, 1e-9);
    CHECK(world.get<Health>(dummy).flashUntilMillis > 1000.0);

    const DamageResult overkill = combat.applyDamage(world, dummy, flower, 1000.0, 2000.0);
    CHECK(!overkill.refused);
    CHECK(!overkill.killed);
    CHECK_NEAR(world.get<Health>(dummy).current, 100.0, 1e-9);
    CHECK(!world.has<Dead>(dummy));

    combat.applyDamage(world, mob, flower, 40.0, 1000.0);
    CHECK_NEAR(world.get<Health>(mob).current, 60.0, 1e-9);
}

TEST(a_friendly_npc_refuses_the_hit_its_team_would_allow) {
    // Team rules already keep a flower's petals off the oracle. What they do
    // NOT keep off it is the other side: a mob wandering through it is a
    // hostile body touching a player-side one. That hit is refused, where the
    // same body without the tag -- a summon, say -- takes it.
    World world;
    CombatSystem combat;
    const auto body = [&](Team team) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{{0.0, 0.0}, 0.0});
        world.add<Body>(e, Body{20.0, 1.0});
        world.add<Health>(e, Health{100.0, 100.0, 0.0, 0.0});
        world.add<Faction>(e, Faction{team, false});
        return e;
    };
    const Entity mob = body(Team::Hostiles);
    world.add<MobTag>(mob);
    const Entity oracle = body(Team::Players);
    world.add<NpcTag>(oracle);
    const Entity summon = body(Team::Players);

    CHECK(!CombatSystem::canHit(world, oracle, mob, 1000.0));
    const DamageResult refused = combat.applyDamage(world, oracle, mob, 30.0, 1000.0);
    CHECK(refused.refused);
    CHECK_EQ(world.get<Health>(oracle).flashUntilMillis, 0.0);

    CHECK(CombatSystem::canHit(world, summon, mob, 1000.0));
    CHECK(!combat.applyDamage(world, summon, mob, 30.0, 1000.0).refused);
}

TEST(a_hostile_npc_takes_every_hit_and_a_friendly_one_refuses_them) {
    // The dummy stands on the hostiles' side, so a flower's ring hits it:
    // every hit flashes it and is numbered for the DPS readout, and its pool
    // stays full. The oracle, beside it, is on the players' side, and the same
    // ring passing through it lands nothing at all.
    const double dummyX = kTileSize * 8.0;
    const double oracleX = kTileSize * 14.0;
    const double y = kTileSize * 8.0;
    const std::string dir = npcWorld("npc-hits", fixtureNpc(dummyX, y, "target_dummy", "common") +
                                                    "," + fixtureNpc(oracleX, y, "oracle", "common"));
    Harness h("npc-hits", {}, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    // A registered account, so it wears the starter ring of five basics.
    NetClient client;
    CHECK(loginNew(h, client, "hitter", "password7"));
    client.joinGame(1920, 1080, {}, "hitter");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity dummy = npcWearing(world, "target_dummy");
    const Entity oracle = npcWearing(world, "oracle");
    const Entity player = onlyPlayer(world);
    if (dummy == NULL_ENTITY || oracle == NULL_ENTITY || player == NULL_ENTITY) {
        CHECK(false);
        removeDataDir(dir);
        return;
    }
    CHECK(world.get<Faction>(dummy).team == Team::Hostiles);
    const std::uint32_t dummyId = world.get<NetId>(dummy).value;
    const std::uint32_t oracleId = world.get<NetId>(oracle).value;
    const double dummyMax = world.get<Health>(dummy).max;
    const double oracleMax = world.get<Health>(oracle).max;

    // Each NPC in turn sits on the ring's orbit, so the five petals sweep
    // straight through it.
    CHECK(awaitRing(h, {&client}, world, player));
    const auto standBeside = [&](Entity npc) {
        client.view().events().clear();
        for (int i = 0; i < kOneRingTurnTicks; ++i) {
            world.get<Transform>(player).position = ringOnly(world, npc, player);
            h.step(1, {&client});
        }
    };
    const auto numbered = [&](std::uint32_t netId) {
        int count = 0;
        for (const ViewEvent& event : client.view().events()) {
            if (event.kind == net::EventKind::Damage && event.netId == netId && event.amount > 0) {
                ++count;
            }
        }
        return count;
    };

    standBeside(dummy);
    CHECK(numbered(dummyId) > 3);
    CHECK(world.get<Health>(dummy).flashUntilMillis > 0.0);
    CHECK_NEAR(world.get<Health>(dummy).current, dummyMax, 1e-9);
    CHECK(!world.has<Dead>(dummy));

    standBeside(oracle);
    CHECK_EQ(numbered(oracleId), 0);
    CHECK_EQ(world.get<Health>(oracle).flashUntilMillis, 0.0);
    CHECK_NEAR(world.get<Health>(oracle).current, oracleMax, 1e-9);
    removeDataDir(dir);
}

TEST(a_hostile_npc_bites_the_flower_touching_it_and_breaks_the_petals_striking_it) {
    // The dummy hits back with its mob's body, as the browser build's dummy --
    // an ordinary mob -- always did: a flower pressed against it is bumped and
    // bitten, and a ring sweeping through it pays for every hit and breaks.
    // The oracle beside it, on the players' side, does neither.
    const double dummyX = kTileSize * 8.0;
    const double oracleX = kTileSize * 14.0;
    const double y = kTileSize * 8.0;
    const std::string dir = npcWorld("npc-bites", fixtureNpc(dummyX, y, "target_dummy", "common") +
                                                     "," + fixtureNpc(oracleX, y, "oracle", "common"));
    Harness h("npc-bites", {}, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(loginNew(h, client, "bitten", "password7"));
    client.joinGame(1920, 1080, {}, "bitten");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity dummy = npcWearing(world, "target_dummy");
    const Entity oracle = npcWearing(world, "oracle");
    const Entity player = onlyPlayer(world);
    if (dummy == NULL_ENTITY || oracle == NULL_ENTITY || player == NULL_ENTITY) {
        CHECK(false);
        removeDataDir(dir);
        return;
    }
    CHECK(world.has<ContactDamage>(dummy));
    CHECK(!world.has<ContactDamage>(oracle));

    // The ring on the dummy: some petal breaks.
    CHECK(awaitRing(h, {&client}, world, player));
    bool broke = false;
    for (int i = 0; i < kOneRingTurnTicks && !broke; ++i) {
        world.get<Transform>(player).position = ringOnly(world, dummy, player);
        h.step(1, {&client});
        for (const LoadoutSlot& slot : world.get<Loadout>(player).slots) broke |= slot.broken;
    }
    CHECK(broke);

    // The flower against it -- flush, which is as close as it can ever get --
    // with its spawn shield dropped: bitten, and shoved off.
    const auto pressAgainst = [&](Entity npc) {
        // Copied out: the step below may relocate the flower's row.
        const double max = world.get<Health>(player).max;
        world.get<Health>(player).current = max;
        world.get<Health>(player).invulnerableUntilMillis = 0.0;
        const Vec2 at = world.get<Transform>(npc).position;
        const double reach = world.get<Body>(npc).radius + world.get<Body>(player).radius;
        world.get<Transform>(player).position = at - Vec2{reach - 3.0, 0.0};
        h.step(1, {&client});
        return max - world.get<Health>(player).current;
    };
    const double dummyBite = pressAgainst(dummy);
    CHECK(dummyBite > 0.0);
    CHECK(distance(world.get<Transform>(player).position, world.get<Transform>(dummy).position) >
          world.get<Body>(dummy).radius + world.get<Body>(player).radius + 10.0);

    CHECK_NEAR(pressAgainst(oracle), 0.0, 1e-9);
    removeDataDir(dir);
}

TEST(a_dummy_counts_a_hit_as_yours_only_on_your_own_wire) {
    // Two flowers, one dummy, one of them hitting it. The hitter's snapshots
    // mark every number on the dummy as theirs; the watcher is sent the same
    // numbers, none of them marked -- so the watcher's DPS readout stays at
    // zero while the hitter's climbs.
    const double dummyX = kTileSize * 8.0;
    const double y = kTileSize * 8.0;
    const std::string dir =
        npcWorld("npc-dps-owner", fixtureNpc(dummyX, y, "target_dummy", "common"));
    Harness h("npc-dps-owner", {}, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient hitter, watcher;
    CHECK(loginNew(h, hitter, "hitter", "password7"));
    CHECK(loginNew(h, watcher, "watcher", "password7"));
    hitter.joinGame(1920, 1080, {}, "hitter");
    watcher.joinGame(1920, 1080, {}, "watcher");
    CHECK(h.stepUntil({&hitter, &watcher}, [&] {
        return hitter.status() == NetClient::Status::Playing &&
               watcher.status() == NetClient::Status::Playing;
    }, 200));
    h.step(3, {&hitter, &watcher});
    World& world = h.server.world();
    const Entity dummy = npcWearing(world, "target_dummy");
    Entity hitterBody = NULL_ENTITY;
    Entity watcherBody = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == "hitter") hitterBody = e;
        if (account.username == "watcher") watcherBody = e;
    });
    if (dummy == NULL_ENTITY || hitterBody == NULL_ENTITY || watcherBody == NULL_ENTITY) {
        CHECK(false);
        removeDataDir(dir);
        return;
    }
    const std::uint32_t dummyId = world.get<NetId>(dummy).value;

    CHECK(awaitRing(h, {&hitter, &watcher}, world, hitterBody));
    hitter.view().events().clear();
    watcher.view().events().clear();
    for (int i = 0; i < kOneRingTurnTicks; ++i) {
        world.get<Transform>(hitterBody).position = ringOnly(world, dummy, hitterBody);
        // Well clear of the dummy and of the hitter's ring, well inside view.
        world.get<Transform>(watcherBody).position = Vec2{dummyX + 700.0, y};
        h.step(1, {&hitter, &watcher});
    }
    const auto count = [&](NetClient& client, bool mine) {
        int n = 0;
        for (const ViewEvent& event : client.view().events()) {
            if (event.kind != net::EventKind::Damage || event.netId != dummyId) continue;
            if (((event.flag & net::DamageByViewer) != 0) == mine) ++n;
        }
        return n;
    };
    CHECK(count(hitter, true) > 3);
    CHECK_EQ(count(hitter, false), 0);
    CHECK(count(watcher, false) > 3);
    CHECK_EQ(count(watcher, true), 0);
    removeDataDir(dir);
}

TEST(a_flower_cannot_walk_through_an_npc) {
    // The dummy stands still, which makes it the clean case: a flower put down
    // on its centre, and one pressing into its side, both end the tick just
    // clear of its body -- and the dummy is where it was.
    const double dummyX = kTileSize * 8.0;
    const double y = kTileSize * 8.0;
    const std::string dir =
        npcWorld("npc-solid", fixtureNpc(dummyX, y, "target_dummy", "common"));
    Harness h("npc-solid", [](const std::string& path) { seedAccount(path, "seer"); }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity dummy = npcWearing(world, "target_dummy");
    const Entity player = onlyPlayer(world);
    if (dummy == NULL_ENTITY || player == NULL_ENTITY) {
        CHECK(false);
        removeDataDir(dir);
        return;
    }
    CHECK(!world.get<Npc>(dummy).cruises);
    const Vec2 home = world.get<Transform>(dummy).position;
    const double reach = world.get<Body>(dummy).radius + world.get<Body>(player).radius;

    for (const Vec2 start : {home, home + Vec2{-reach * 0.5, 3.0}, home + Vec2{0.0, reach - 2.0}}) {
        world.get<Transform>(player).position = start;
        h.step(1, {&client});
        const Vec2 after = world.get<Transform>(player).position;
        CHECK(distance(after, home) >= reach - 1e-6);
        // Out the near side, not through to the far one.
        if (start.x != home.x || start.y != home.y) {
            CHECK((after - home).x * (start - home).x + (after - home).y * (start - home).y > 0.0);
        }
    }
    CHECK_NEAR(world.get<Transform>(dummy).position.x, home.x, 1e-9);
    CHECK_NEAR(world.get<Transform>(dummy).position.y, home.y, 1e-9);
    removeDataDir(dir);
}

TEST(the_oracle_cruises_about_its_home_like_a_bee) {
    const std::string dir = oracleWorld("npc-cruise");
    Harness h("npc-cruise", [](const std::string& path) { seedAccount(path, "seer"); }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(2, {&client});
    World& world = h.server.world();
    const Entity oracle = npcWearing(world, "oracle");
    const Entity player = onlyPlayer(world);
    if (oracle == NULL_ENTITY || player == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }
    CHECK(world.get<Npc>(oracle).cruises);
    const Vec2 home = world.get<Npc>(oracle).home;

    // Nobody near: the flower is parked across the field, far out of its watch.
    const Vec2 away{kTileSize * 20.0, kTileSize * 20.0};
    double travelled = 0.0;
    double farthest = 0.0;
    Vec2 last = world.get<Transform>(oracle).position;
    for (int i = 0; i < 900; ++i) {
        world.get<Transform>(player).position = away;
        const Vec2 previous = world.get<Transform>(oracle).position;
        h.step(1, {&client});
        const Transform& at = world.get<Transform>(oracle);
        travelled += distance(at.position, last);
        last = at.position;
        farthest = std::max(farthest, distance(at.position, home));
        // A cruiser looks along the step it just took.
        if (distance(at.position, previous) > 1e-6) {
            CHECK_NEAR(angleDelta(at.angle, (at.position - previous).angle()), 0.0, 1e-9);
        }
    }
    // It really does fly -- thirty seconds of cruising covers ground -- and it
    // never strays much past its leash: the turn back is a curve, not a wall.
    CHECK(travelled > 300.0);
    CHECK(farthest < kNpcLeashRadius + 200.0);
    removeDataDir(dir);
}

TEST(an_npc_the_map_placed_comes_back_and_killall_leaves_it_alone) {
    const std::string dir = oracleWorld("npc-return");
    Harness h("npc-return", [](const std::string& path) { seedAccount(path, "boss", true); },
              dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "boss"));
    h.step(3, {&client});
    World& world = h.server.world();
    CHECK_EQ(npcsIn(world).size(), std::size_t(1));

    // Wild mobs are cleared; the NPC is not a wild mob.
    client.sendChat("/admin killall");
    h.step(4, {&client});
    CHECK_EQ(npcsIn(world).size(), std::size_t(1));

    // Clearing the NPCs is honoured -- and the map's own is back on the tick
    // after, because it is part of the map.
    const Entity before = npcsIn(world)[0];
    client.sendChat("/admin clear_npcs");
    CHECK(h.stepUntil({&client}, [&] {
        const std::vector<Entity> now = npcsIn(world);
        return now.size() == 1 && now[0] != before;
    }, 30));
    removeDataDir(dir);
}

TEST(spawn_makes_the_oracle_an_enemy_and_spawn_npc_puts_down_any_mob) {
    const std::string dir = oracleWorld("npc-admin");
    Harness h("npc-admin", [](const std::string& path) { seedAccount(path, "boss", true); },
              dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "boss"));
    h.step(3, {&client});
    World& world = h.server.world();
    const std::uint16_t oracle = content().mobIndex("oracle");

    // `spawn` is the ENEMY: an ordinary mob wearing the oracle's config, on
    // the hostile team, thinking like any other. Put down across the field,
    // well outside its aggro range: a rare one bites hard enough to put the
    // admin on the death card before the next command.
    client.sendChat("/admin spawn oracle rare 4000 4000");
    CHECK(h.stepUntil({&client}, [&] {
        bool found = false;
        Query<MobTag, MobType> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type) {
            if (type.configIndex != oracle) return;
            found = type.rarity == Rarity::Rare && world.get<Faction>(e).team == Team::Hostiles &&
                    world.has<MobAi>(e) && world.has<Health>(e) && !world.has<Npc>(e);
        });
        return found;
    }, 30));

    // `spawn_npc` is the FRIEND, where the admin stands.
    const std::size_t npcsBefore = npcsIn(world).size();
    client.sendChat("/admin spawn_npc oracle legendary");
    CHECK(h.stepUntil({&client}, [&] { return npcsIn(world).size() == npcsBefore + 1; }, 30));
    bool placed = false;
    for (const Entity e : npcsIn(world)) {
        if (world.get<Npc>(e).rarity == Rarity::Legendary) placed = true;
    }
    CHECK(placed);

    // The target dummy is an NPC too, on its own side.
    client.sendChat("/admin spawn_npc target_dummy");
    CHECK(h.stepUntil({&client}, [&] { return npcsIn(world).size() == npcsBefore + 2; }, 30));
    const Entity dummy = npcWearing(world, "target_dummy");
    CHECK(dummy != NULL_ENTITY && world.get<Faction>(dummy).team == Team::Hostiles);

    // ANY mob can be one. A bee has no `npc` block, so it stands as an empty
    // block would have it: the players' side, offering nothing, touching
    // nobody.
    const std::uint16_t bee = content().mobIndex("bee");
    const auto beeNpc = [&](Team team) {
        Entity found = NULL_ENTITY;
        for (const Entity e : npcsIn(world)) {
            if (world.get<Npc>(e).configIndex == bee && world.get<Faction>(e).team == team) found = e;
        }
        return found;
    };
    client.sendChat("/admin spawn_npc bee");
    CHECK(h.stepUntil({&client}, [&] { return npcsIn(world).size() == npcsBefore + 3; }, 30));
    const Entity friendlyBee = beeNpc(Team::Players);
    CHECK(friendlyBee != NULL_ENTITY);
    if (friendlyBee != NULL_ENTITY) {
        CHECK(world.get<Npc>(friendlyBee).service == NpcService::None);
        CHECK(!world.has<ContactDamage>(friendlyBee));
    }

    // A side typed after it -- before or after the tier -- overrides that,
    // and a hostile one bites with its mob's body.
    client.sendChat("/admin spawn_npc bee hostile rare");
    CHECK(h.stepUntil({&client}, [&] { return npcsIn(world).size() == npcsBefore + 4; }, 30));
    const Entity hostileBee = beeNpc(Team::Hostiles);
    CHECK(hostileBee != NULL_ENTITY);
    if (hostileBee != NULL_ENTITY) {
        CHECK(world.get<Npc>(hostileBee).rarity == Rarity::Rare);
        CHECK(world.has<ContactDamage>(hostileBee));
        CHECK(!world.has<MobTag>(hostileBee));
    }

    // A word that is neither a tier nor a side places nothing.
    client.sendChat("/admin spawn_npc bee sideways");
    h.step(10, {&client});
    CHECK_EQ(npcsIn(world).size(), npcsBefore + 4);
    removeDataDir(dir);
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

TEST(an_oracle_craft_is_certain_and_costs_exactly_its_price) {
    const std::string dir = oracleWorld("oracle-craft");
    Harness h("oracle-craft", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Common, 20);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Common) == 20u;
    }));
    CHECK_EQ(client.oracleCooldownRemainingMillis(), 0.0);

    // One upgrade for seven: seven in, one out, no roll anywhere.
    OracleOutcome outcome;
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.crafted, 1);
    CHECK_EQ(outcome.spent, 7u);
    CHECK(outcome.rarity == Rarity::Uncommon);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Common) == 13u &&
               p.stackCount(rose, Rarity::Uncommon) == 1u;
    }));
    removeDataDir(dir);
}

TEST(the_oracle_refuses_a_short_stack_and_apex_and_neither_starts_the_wait) {
    const std::string dir = oracleWorld("oracle-refuse");
    Harness h("oracle-refuse", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Common, 6);
        seedStack(path, "seer", "petal_rose", Rarity::Uncommon, 11);
        seedStack(path, "seer", "petal_rose", Rarity::Apex, 3000);
        seedStack(path, "seer", "petal_rose", Rarity::Universal, 3000);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});

    OracleOutcome outcome;
    // Six is not seven: all or nothing, never a part. Standing at the oracle
    // each time, so every refusal is for its own reason and not for reach.
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.spent, 0u);
    // Nothing crafts out of apex, however many are offered.
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Apex);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);
    // Nor out of universal, which is only ever given.
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Universal);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);

    h.step(5, {&client});
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Common), 6u);
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Apex), 3000u);
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Universal), 3000u);
    CHECK_EQ(client.oracleCooldownRemainingMillis(), 0.0);

    // A refusal is not a craft: the wait has not started, and a craft the
    // stack CAN pay for still goes through.
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Uncommon);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);
    removeDataDir(dir);
}

TEST(the_oracle_serves_only_a_flower_standing_at_it) {
    const std::string dir = oracleWorld("oracle-far");
    Harness h("oracle-far", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Common, 20);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestLogin("seer", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));

    // On the title screen there is no body to be standing anywhere.
    OracleOutcome outcome;
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);

    client.joinGame(1920, 1080, {}, "seer");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity player = onlyPlayer(world);
    if (player == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }
    const double radius =
        content().mobStats(content().mobIndex("oracle"), Rarity::Epic).radius;

    // Just outside what the server allows -- the reach and its slack, from the
    // oracle's skin, wherever it has cruised to -- is refused...
    const Entity oracle = npcWearing(world, "oracle");
    if (oracle == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }
    Vec2 at = world.get<Transform>(oracle).position;
    world.get<Transform>(player).position =
        Vec2{at.x + radius + kNpcServiceReach + kNpcServiceSlack + 40.0, at.y};
    h.step(1, {&client});
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);
    CHECK(outcome.reason.find("far") != std::string::npos);

    // ...and just inside it is served, slack included: the client measured a
    // drawn position a snapshot old, and that must not cost the player.
    at = world.get<Transform>(oracle).position;
    world.get<Transform>(player).position =
        Vec2{at.x + radius + kNpcServiceReach + kNpcServiceSlack - 40.0, at.y};
    h.step(1, {&client});
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Common) == 13u &&
               p.stackCount(rose, Rarity::Uncommon) == 1u;
    }));
    removeDataDir(dir);
}

TEST(a_super_bought_from_the_oracle_is_announced) {
    const std::string dir = oracleWorld("oracle-announce");
    Harness h("oracle-announce", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Ultra, 253);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    const std::size_t chatBefore = client.chat().size();

    OracleOutcome outcome;
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Ultra);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);
    CHECK(outcome.rarity == Rarity::Super);
    CHECK(h.stepUntil({&client}, [&] {
        for (std::size_t i = chatBefore; i < client.chat().size(); ++i) {
            if (client.chat()[i].text.find("has been crafted by") != std::string::npos) return true;
        }
        return false;
    }, 60));
    removeDataDir(dir);
}

// ---------------------------------------------------------------------------
// The wait between crafts
// ---------------------------------------------------------------------------

TEST(the_wait_is_said_in_whole_minutes_rounded_up) {
    // The reference's own sentence. Rounded up, so a wait of seconds reads as
    // a minute and never as zero.
    CHECK_EQ(oracleCooldownText(27.0 * 60000.0),
             std::string("You'll be able to craft again in 27 minutes"));
    CHECK_EQ(oracleCooldownText(26.2 * 60000.0),
             std::string("You'll be able to craft again in 27 minutes"));
    CHECK_EQ(oracleCooldownText(kOracleCooldownMillis),
             std::string("You'll be able to craft again in 30 minutes"));
    CHECK_EQ(oracleCooldownText(60000.0), std::string("You'll be able to craft again in 1 minute"));
    CHECK_EQ(oracleCooldownText(1.0), std::string("You'll be able to craft again in 1 minute"));
}

TEST(the_oracle_grants_one_craft_every_thirty_minutes) {
    const std::string dir = oracleWorld("oracle-wait");
    Harness h("oracle-wait", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Common, 20);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});

    OracleOutcome outcome;
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);

    // The craft started the half hour, and the profile that followed it says
    // so -- which is what turns the panel's line red.
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Uncommon) == 1u;
    }));
    const double wait = client.oracleCooldownRemainingMillis();
    CHECK(wait > kOracleCooldownMillis - 60000.0);
    CHECK(wait <= kOracleCooldownMillis);

    // The next one is refused in the panel's own words, and costs nothing.
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.reason, std::string("You'll be able to craft again in 30 minutes"));
    h.step(5, {&client});
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Common), 13u);
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Uncommon), 1u);

    removeDataDir(dir);
}

TEST(the_oracle_wait_is_the_accounts_across_a_relog_and_ends_on_the_server_clock) {
    const std::string dir = oracleWorld("oracle-wait-kept");
    Harness h("oracle-wait-kept", [](const std::string& path) {
        seedAccount(path, "seer");
        seedStack(path, "seer", "petal_rose", Rarity::Common, 30);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    {
        NetClient client;
        CHECK(joinAs(h, client, "seer"));
        h.step(3, {&client});
        OracleOutcome outcome;
        standBeside(h, client, "oracle");
        client.requestOracleCraft(rose, Rarity::Common);
        CHECK(awaitOracle(h, client, outcome));
        CHECK(outcome.success);
        client.disconnect();
        h.step(10, {});
    }

    // A new connection is the same account, so the wait came with it: the
    // join's profile already carries it, and the craft is refused.
    NetClient client;
    CHECK(joinAs(h, client, "seer"));
    h.step(3, {&client});
    CHECK(client.oracleCooldownRemainingMillis() > kOracleCooldownMillis - 60000.0);
    OracleOutcome outcome;
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);

    // The wait is measured on the server's own tick clock, so moving that
    // clock is the whole of "half an hour later". A minute and a half short,
    // what is left rounds up to two...
    h.clock += kOracleCooldownMillis - 90000.0;
    h.step(3, {&client});
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.reason, std::string("You'll be able to craft again in 2 minutes"));

    // ...and past it, the oracle serves again.
    h.clock += 120000.0;
    h.step(3, {&client});
    standBeside(h, client, "oracle");
    client.requestOracleCraft(rose, Rarity::Common);
    CHECK(awaitOracle(h, client, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Uncommon) == 2u;
    }));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Common), 16u);
    removeDataDir(dir);
}

// ---------------------------------------------------------------------------
// The trader
// ---------------------------------------------------------------------------

namespace {

std::string traderWorld(const std::string& name) {
    return npcWorld(name, fixtureNpc(kOracleX, kOracleY, "trader", "common"));
}

/// Waits for the trader's answer and hands it back with `pending` cleared, as
/// the panel reads it.
bool awaitTrade(Harness& h, NetClient& client, TradeOutcome& out) {
    if (!h.stepUntil({&client}, [&] { return client.tradeOutcome().pending; }, 200)) return false;
    out = client.tradeOutcome();
    client.tradeOutcome().pending = false;
    return true;
}

constexpr double kHourMillis = 60.0 * 60.0 * 1000.0;

} // namespace

TEST(the_trader_wait_is_said_in_whole_hours_rounded_down_then_in_minutes) {
    // The reference says 23 the moment a trade is made: whole hours, down.
    CHECK_EQ(traderCooldownText(kTraderCooldownMillis - 1000.0),
             std::string("You'll be able to trade again in 23 hours"));
    CHECK_EQ(traderCooldownText(kTraderCooldownMillis),
             std::string("You'll be able to trade again in 24 hours"));
    CHECK_EQ(traderCooldownText(1.5 * kHourMillis),
             std::string("You'll be able to trade again in 1 hour"));
    // Under an hour there is no whole hour to say: minutes, rounded up, and
    // never zero.
    CHECK_EQ(traderCooldownText(30.0 * 60000.0),
             std::string("You'll be able to trade again in 30 minutes"));
    CHECK_EQ(traderCooldownText(29.2 * 60000.0),
             std::string("You'll be able to trade again in 30 minutes"));
    CHECK_EQ(traderCooldownText(1.0), std::string("You'll be able to trade again in 1 minute"));
}

TEST(the_shipped_trader_stands_in_the_desert_and_takes_all_but_the_marked_petals) {
    CHECK(ensureShippedContent());
    const std::uint16_t trader = content().mobIndex("trader");
    CHECK(trader != kInvalidIndex);
    if (trader == kInvalidIndex) return;
    const MobConfig& config = content().mob(trader);
    CHECK(config.npc.present);
    CHECK(config.npc.service == NpcService::Trader);
    CHECK(config.npc.team == Team::Players);
    // Drawn by code: its eyes are a flower's, and they move.
    CHECK_EQ(config.image, std::string("$trader"));
    CHECK(config.noEggDrop);
    CHECK(!content().mobStats(trader, Rarity::Common).ambient);
    // It wanders about its point on the oracle's leashed cruise rather than
    // standing on it.
    CHECK(config.beeFlight);
    CHECK(content().mobStats(trader, Rarity::Common).speed > 0.0);

    // What it hands back exists and is marked untradable -- or it would take
    // its own coins back one for one -- and so is the basic petal. A petal
    // petals.json says nothing about trades.
    const std::uint16_t coin = content().petalIndex(kTraderCoinPetal);
    CHECK(coin != kInvalidIndex);
    if (coin != kInvalidIndex) CHECK(!content().petal(coin).tradable);
    CHECK(!content().petal(content().petalIndex("basic")).tradable);
    CHECK(content().petal(content().petalIndex("rose")).tradable);

    WorldMaps maps;
    Terrain terrain;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    Realm desert = Realm::Overworld;
    bool haveDesert = false;
    for (const MapData& map : maps.maps()) {
        if (map.id() != "desert") continue;
        desert = map.realm();
        haveDesert = true;
    }
    CHECK(haveDesert);
    NpcSystem npcs;
    std::vector<std::string> warnings;
    npcs.loadSites(maps, content(), warnings);
    CHECK(warnings.empty());
    int traders = 0;
    for (const NpcSystem::Site& site : npcs.sites()) {
        if (content().mob(site.mobIndex).npc.service != NpcService::Trader) continue;
        ++traders;
        CHECK(site.realm == desert);
        CHECK(site.rarity == Rarity::Common);
        // On open ground, body and all: nothing pushes it off its point, and
        // a flower can walk right round it.
        const double radius = content().mobStats(site.mobIndex, site.rarity).radius;
        const Vec2 placed = terrain.resolveCircle(site.position, radius, site.realm);
        CHECK_NEAR(placed.x, site.position.x, 1e-6);
        CHECK_NEAR(placed.y, site.position.y, 1e-6);
    }
    CHECK_EQ(traders, 1);
}

TEST(a_trade_is_one_petal_for_one_coin_of_the_same_tier) {
    const std::string dir = traderWorld("trader-trade");
    Harness h("trader-trade", [](const std::string& path) {
        seedAccount(path, "merchant");
        seedStack(path, "merchant", "petal_rose", Rarity::Epic, 3);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t coin = content().petalIndex(kTraderCoinPetal);
    if (rose == kInvalidIndex || coin == kInvalidIndex) { CHECK(false); removeDataDir(dir); return; }

    NetClient client;
    CHECK(joinAs(h, client, "merchant"));
    h.step(3, {&client});
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Epic) == 3u;
    }));
    CHECK_EQ(client.traderCooldownRemainingMillis(), 0.0);

    TradeOutcome outcome;
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Epic);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.petalIndex, rose);
    CHECK(outcome.rarity == Rarity::Epic);
    CHECK_EQ(outcome.receivedIndex, coin);
    // One out of the stack, one coin of its tier in -- and the day's wait on
    // the profile that followed, which the oracle's is not part of.
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Epic) == 2u && p.stackCount(coin, Rarity::Epic) == 1u;
    }));
    CHECK_EQ(client.profile().stackCount(coin, Rarity::Common), 0u);
    const double wait = client.traderCooldownRemainingMillis();
    CHECK(wait > kTraderCooldownMillis - 60000.0);
    CHECK(wait <= kTraderCooldownMillis);
    CHECK_EQ(client.oracleCooldownRemainingMillis(), 0.0);
    removeDataDir(dir);
}

TEST(the_trader_refuses_what_it_does_not_take_and_a_refusal_starts_no_wait) {
    const std::string dir = traderWorld("trader-refuse");
    Harness h("trader-refuse", [](const std::string& path) {
        seedAccount(path, "merchant");
        seedStack(path, "merchant", "petal_basic", Rarity::Common, 3);
        seedStack(path, "merchant", "petal_coin", Rarity::Rare, 2);
        seedStack(path, "merchant", "petal_rose", Rarity::Apex, 1);
        seedStack(path, "merchant", "petal_rose", Rarity::Universal, 1);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t coin = content().petalIndex(kTraderCoinPetal);
    const std::uint16_t basic = content().petalIndex("basic");

    NetClient client;
    CHECK(joinAs(h, client, "merchant"));
    h.step(3, {&client});
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(coin, Rarity::Rare) == 2u && p.stackCount(basic, Rarity::Common) > 0u;
    }));
    const std::uint32_t basics = client.profile().stackCount(basic, Rarity::Common);

    // Marked untradable, both of them: the basic petal, and a coin -- which
    // would otherwise trade for itself.
    TradeOutcome outcome;
    standBeside(h, client, "trader");
    client.requestTrade(basic, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.receivedIndex, kNoPetal);
    standBeside(h, client, "trader");
    client.requestTrade(coin, Rarity::Rare);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    // A petal the account does not have, at a tier it does not have.
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Epic);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    // A tradable petal at universal: a universal coin would be a universal
    // nobody gave.
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Universal);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.receivedIndex, kNoPetal);

    h.step(5, {&client});
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Universal), 1u);
    CHECK_EQ(client.profile().stackCount(coin, Rarity::Universal), 0u);
    CHECK_EQ(client.profile().stackCount(basic, Rarity::Common), basics);
    CHECK_EQ(client.profile().stackCount(coin, Rarity::Rare), 2u);
    CHECK_EQ(client.traderCooldownRemainingMillis(), 0.0);

    // None of that was a trade, so the day has not started -- and the top
    // tier trades like any other.
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Apex);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Apex) == 0u && p.stackCount(coin, Rarity::Apex) == 1u;
    }));
    removeDataDir(dir);
}

TEST(the_trader_serves_only_a_flower_standing_at_it) {
    const std::string dir = traderWorld("trader-far");
    Harness h("trader-far", [](const std::string& path) {
        seedAccount(path, "merchant");
        seedStack(path, "merchant", "petal_rose", Rarity::Common, 5);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestLogin("merchant", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));

    // On the title screen there is no body to be standing anywhere.
    TradeOutcome outcome;
    client.requestTrade(rose, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);

    client.joinGame(1920, 1080, {}, "merchant");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    h.step(3, {&client});
    World& world = h.server.world();
    const Entity player = onlyPlayer(world);
    const Entity trader = npcWearing(world, "trader");
    if (player == NULL_ENTITY || trader == NULL_ENTITY) { CHECK(false); removeDataDir(dir); return; }
    const double radius = world.get<Body>(trader).radius;

    // Just past the reach and its slack, from the trader's skin, wherever it
    // has cruised to: refused...
    Vec2 at = world.get<Transform>(trader).position;
    world.get<Transform>(player).position =
        Vec2{at.x + radius + kNpcServiceReach + kNpcServiceSlack + 40.0, at.y};
    h.step(1, {&client});
    client.requestTrade(rose, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    CHECK(outcome.reason.find("far") != std::string::npos);

    // ...and just inside, served. It has flown on while the refusal came
    // back, so "at the trader" is looked up again.
    at = world.get<Transform>(trader).position;
    world.get<Transform>(player).position =
        Vec2{at.x + radius + kNpcServiceReach + kNpcServiceSlack - 40.0, at.y};
    h.step(1, {&client});
    client.requestTrade(rose, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(outcome.success);
    removeDataDir(dir);
}

TEST(the_trader_grants_one_trade_a_day_kept_across_a_relog) {
    const std::string dir = traderWorld("trader-wait");
    Harness h("trader-wait", [](const std::string& path) {
        seedAccount(path, "merchant");
        seedStack(path, "merchant", "petal_rose", Rarity::Common, 5);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t coin = content().petalIndex(kTraderCoinPetal);

    {
        NetClient client;
        CHECK(joinAs(h, client, "merchant"));
        h.step(3, {&client});
        TradeOutcome outcome;
        standBeside(h, client, "trader");
        client.requestTrade(rose, Rarity::Common);
        CHECK(awaitTrade(h, client, outcome));
        CHECK(outcome.success);

        // The next is refused in the panel's own words, and costs nothing.
        standBeside(h, client, "trader");
        client.requestTrade(rose, Rarity::Common);
        CHECK(awaitTrade(h, client, outcome));
        CHECK(!outcome.success);
        CHECK_EQ(outcome.reason, std::string("You'll be able to trade again in 23 hours"));
        client.disconnect();
        h.step(10, {});
    }

    // A new connection is the same account, and the wait came with it.
    NetClient client;
    CHECK(joinAs(h, client, "merchant"));
    h.step(3, {&client});
    CHECK(client.traderCooldownRemainingMillis() > kTraderCooldownMillis - 60000.0);
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Common), 4u);
    CHECK_EQ(client.profile().stackCount(coin, Rarity::Common), 1u);

    // Measured on the server's tick clock: half an hour short of the day...
    TradeOutcome outcome;
    h.clock += kTraderCooldownMillis - 30.0 * 60000.0;
    h.step(3, {&client});
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.reason, std::string("You'll be able to trade again in 30 minutes"));

    // ...and past it, the trader deals again.
    h.clock += 31.0 * 60000.0;
    h.step(3, {&client});
    standBeside(h, client, "trader");
    client.requestTrade(rose, Rarity::Common);
    CHECK(awaitTrade(h, client, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Common) == 3u && p.stackCount(coin, Rarity::Common) == 2u;
    }));
    removeDataDir(dir);
}

// ---------------------------------------------------------------------------
// On screen
// ---------------------------------------------------------------------------

namespace {

constexpr int kFrame = 200;

/// How many pixels of the oracle's pupil colour sit left and right of `cx`.
struct PupilSides {
    int left = 0;
    int right = 0;
    int outsideSocket = 0;
};

PupilSides pupilSides(const std::vector<std::uint8_t>& pixels, double cx, double cy,
                      double socketRadius) {
    PupilSides out;
    for (int y = 0; y < kFrame; ++y) {
        for (int x = 0; x < kFrame; ++x) {
            const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
            if (pixels[i] != 0xEE || pixels[i + 1] != 0xEE || pixels[i + 2] != 0xEE) continue;
            const double dx = x + 0.5 - cx;
            const double dy = y + 0.5 - cy;
            if (dx < 0) ++out.left;
            else ++out.right;
            if (dx * dx + dy * dy > socketRadius * socketRadius) ++out.outsideSocket;
        }
    }
    return out;
}

const SpriteCache& shippedSprites() {
    static const SpriteCache sprites = [] {
        ensureShippedContent();
        SpriteCache cache;
        cache.build(content(), dataDir());
        return cache;
    }();
    return sprites;
}

} // namespace

TEST(the_oracle_painter_puts_its_pupil_where_it_looks_and_keeps_it_in_the_socket) {
    CHECK(ensureShippedContent());
    const std::uint16_t oracle = content().mobIndex("oracle");
    const SpriteCache& sprites = shippedSprites();
    CHECK(sprites.mobArt(oracle) == MobArt::Oracle);
    CHECK(sprites.mobDrawable(oracle));

    // A body 100 across in a 200 frame: the socket is 15/28 of the radius.
    const double diameter = 100.0;
    const double socket = 15.0 / 28.0 * diameter * 0.5;
    const auto frame = [&](Vec2 gaze) {
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        sprites.drawMob(canvas, oracle, kFrame * 0.5, kFrame * 0.5, diameter, 0.0, 0.0, false, 0.0,
                        gaze);
        return canvas.getImageData(0, 0, kFrame, kFrame);
    };

    const PupilSides east = pupilSides(frame({1.0, 0.0}), kFrame * 0.5, kFrame * 0.5, socket);
    const PupilSides west = pupilSides(frame({-1.0, 0.0}), kFrame * 0.5, kFrame * 0.5, socket);
    CHECK(east.right > east.left * 2);
    CHECK(west.left > west.right * 2);
    // A gaze longer than one is clamped: the pupil runs to the rim and stops.
    const PupilSides wild = pupilSides(frame({40.0, 0.0}), kFrame * 0.5, kFrame * 0.5, socket);
    CHECK(wild.right > 0);
    CHECK_EQ(wild.outsideSocket, 0);
    CHECK_EQ(east.outsideSocket, 0);
}

TEST(an_npc_is_drawn_with_its_eye_on_its_facing_and_an_invulnerable_bar) {
    CHECK(ensureShippedContent());
    const std::uint16_t oracle = content().mobIndex("oracle");
    const Vec2 at{1000.0, 1000.0};
    const auto frame = [&](net::EntityKind kind, double angle) {
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        WorldView view;
        view.setRealm(Realm::Overworld);
        RemoteEntity npc;
        npc.netId = 42;
        npc.kind = kind;
        npc.typeIndex = oracle;
        npc.rarity = Rarity::Common;
        npc.position = npc.targetPosition = at;
        npc.angle = npc.targetAngle = angle;
        npc.needsSnap = false;
        npc.radius = content().mobStats(oracle, Rarity::Common).radius;
        npc.healthFraction = 0.5;
        view.seedForTest(npc);
        WorldRenderer renderer;
        renderer.setContent(&content());
        renderer.setSprites(&shippedSprites());
        Camera camera;
        camera.setViewport(kFrame, kFrame);
        camera.userZoom = 1.0;
        camera.snapTo(at);
        renderer.draw(canvas, view, camera, at, 0.0);
        return canvas.getImageData(0, 0, kFrame, kFrame);
    };
    const auto healthPixels = [](const std::vector<std::uint8_t>& pixels) {
        const std::uint8_t r = (ui::kHealth >> 16) & 0xFF;
        const std::uint8_t g = (ui::kHealth >> 8) & 0xFF;
        const std::uint8_t b = ui::kHealth & 0xFF;
        int found = 0;
        for (std::size_t i = 0; i + 2 < pixels.size(); i += 4) {
            if (pixels[i] == r && pixels[i + 1] == g && pixels[i + 2] == b) ++found;
        }
        return found;
    };

    // The body is upright; the facing is where the EYE goes.
    const double socket = 15.0 / 28.0 * content().mobStats(oracle, Rarity::Common).radius;
    const PupilSides lookingWest =
        pupilSides(frame(net::EntityKind::Npc, kPi), kFrame * 0.5, kFrame * 0.5, socket + 1.0);
    const PupilSides lookingEast =
        pupilSides(frame(net::EntityKind::Npc, 0.0), kFrame * 0.5, kFrame * 0.5, socket + 1.0);
    CHECK(lookingWest.left > lookingWest.right * 2);
    CHECK(lookingEast.right > lookingEast.left * 2);

    // The mob's plate, with the bar in its invulnerable state: no green, and
    // the spawn-shield yellow a flower's bar turns, the whole width of the bar
    // even though the wire says half -- where the same creature as a mob wears
    // half a green bar.
    const auto colourPixels = [](const std::vector<std::uint8_t>& pixels, std::uint32_t colour) {
        const std::uint8_t r = (colour >> 16) & 0xFF;
        const std::uint8_t g = (colour >> 8) & 0xFF;
        const std::uint8_t b = colour & 0xFF;
        int found = 0;
        for (std::size_t i = 0; i + 2 < pixels.size(); i += 4) {
            if (pixels[i] == r && pixels[i + 1] == g && pixels[i + 2] == b) ++found;
        }
        return found;
    };
    constexpr std::uint32_t kInvulnerable = 0xFAFFC9u;
    const std::vector<std::uint8_t> npcFrame = frame(net::EntityKind::Npc, 0.0);
    const std::vector<std::uint8_t> mobFrame = frame(net::EntityKind::Mob, 0.0);
    CHECK_EQ(healthPixels(npcFrame), 0);
    CHECK(colourPixels(npcFrame, kInvulnerable) > 0);
    CHECK(healthPixels(mobFrame) > 0);
    CHECK_EQ(colourPixels(mobFrame, kInvulnerable), 0);
    // Full width: yellow on both sides of the body's centre line.
    int left = 0;
    int right = 0;
    for (int y = 0; y < kFrame; ++y) {
        for (int x = 0; x < kFrame; ++x) {
            const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
            if (npcFrame[i] != 0xFA || npcFrame[i + 1] != 0xFF || npcFrame[i + 2] != 0xC9) continue;
            if (x < kFrame / 2 - 10) ++left;
            if (x > kFrame / 2 + 10) ++right;
        }
    }
    CHECK(left > 0);
    CHECK(right > 0);
}

namespace {

/// White pixels inside a flower's two eye sockets -- the ellipses at (+-7,
/// -4.8), 3.2 by 6.5, in its radius-25 art space -- split by which side of the
/// sockets' middles they sit on: across when `vertical` is false, down when
/// it is true. `unit` is pixels to the art unit, about the frame's centre.
struct EyeSplit {
    int before = 0;
    int after = 0;
};

EyeSplit eyeSplit(const std::vector<std::uint8_t>& pixels, double unit, bool vertical) {
    EyeSplit out;
    const double c = kFrame * 0.5;
    for (int y = 0; y < kFrame; ++y) {
        for (int x = 0; x < kFrame; ++x) {
            const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
            if (pixels[i] != 0xFF || pixels[i + 1] != 0xFF || pixels[i + 2] != 0xFF) continue;
            const double ax = (x + 0.5 - c) / unit;
            const double ay = (y + 0.5 - c) / unit;
            for (const double eye : {-7.0, 7.0}) {
                const double dx = ax - eye;
                const double dy = ay + 4.8;
                if (dx * dx / (3.2 * 3.2) + dy * dy / (6.5 * 6.5) > 1.0) continue;
                const double along = vertical ? dy : dx;
                if (along < 0.0) ++out.before;
                else ++out.after;
            }
        }
    }
    return out;
}

} // namespace

TEST(the_trader_painter_borders_only_the_rings_outer_edge_and_moves_its_eyes_like_a_flower) {
    CHECK(ensureShippedContent());
    const std::uint16_t trader = content().mobIndex("trader");
    const SpriteCache& sprites = shippedSprites();
    CHECK(sprites.mobArt(trader) == MobArt::Trader);
    CHECK(sprites.mobDrawable(trader));

    // 180 across in a 200 frame. The body's radius is the ring's outer edge,
    // 33.75 art units -- the flower in the middle is 25 of them.
    const double diameter = 180.0;
    const double unit = diameter * 0.5 / 33.75;
    const double c = kFrame * 0.5;
    const auto frame = [&](Vec2 gaze) {
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        sprites.drawMob(canvas, trader, c, c, diameter, 0.0, 0.0, false, 0.0, gaze);
        return canvas.getImageData(0, 0, kFrame, kFrame);
    };
    const auto rgbAt = [&](const std::vector<std::uint8_t>& pixels, double angle, double art) {
        const int x = static_cast<int>(c + std::cos(angle) * art * unit);
        const int y = static_cast<int>(c + std::sin(angle) * art * unit);
        const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
        return (static_cast<std::uint32_t>(pixels[i]) << 16) |
               (static_cast<std::uint32_t>(pixels[i + 1]) << 8) | pixels[i + 2];
    };

    const std::vector<std::uint8_t> picture = frame({1.0, 0.0});
    for (int i = 0; i < 12; ++i) {
        const double spoke = kTau * i / 12;
        // Halfway between two spokes, just outside the flower's ring, is where
        // two petals overlap -- and where the capture drew both their outlines
        // across the white. It is white.
        CHECK_EQ(rgbAt(picture, spoke + kPi / 12, 27.6), 0xFFFFFFu);
        // The ring's outer edge wears the basic petal's grey, on every petal.
        CHECK_EQ(rgbAt(picture, spoke, 34.0), 0xCFCFCFu);
        // And the flower's own ring is a player's: the flower yellow at 0.8.
        CHECK_EQ(rgbAt(picture, spoke + kPi / 12, 25.0), 0xCCB94Fu);
    }

    // The eyes travel as a flower's do: two units across, 4.4 down.
    const EyeSplit east = eyeSplit(frame({1.0, 0.0}), unit, false);
    const EyeSplit west = eyeSplit(frame({-1.0, 0.0}), unit, false);
    const EyeSplit down = eyeSplit(frame({0.0, 1.0}), unit, true);
    const EyeSplit up = eyeSplit(frame({0.0, -1.0}), unit, true);
    CHECK(east.after > east.before * 2);
    CHECK(west.before > west.after * 2);
    CHECK(down.after > down.before * 2);
    CHECK(up.before > up.after * 2);
}

TEST(the_trader_is_drawn_upright_with_its_eyes_on_its_facing) {
    CHECK(ensureShippedContent());
    const std::uint16_t trader = content().mobIndex("trader");
    const Vec2 at{1000.0, 1000.0};
    // Three screen pixels to the world unit, so the eyes are big enough to
    // count pixels in.
    constexpr double kZoom = 3.0;
    const double radius = content().mobStats(trader, Rarity::Common).radius;
    const double unit = radius / 33.75 * kZoom;
    const auto frame = [&](double angle) {
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        WorldView view;
        view.setRealm(Realm::Overworld);
        RemoteEntity npc;
        npc.netId = 43;
        npc.kind = net::EntityKind::Npc;
        npc.typeIndex = trader;
        npc.rarity = Rarity::Common;
        npc.position = npc.targetPosition = at;
        npc.angle = npc.targetAngle = angle;
        npc.needsSnap = false;
        npc.radius = radius;
        npc.healthFraction = 1.0;
        view.seedForTest(npc);
        WorldRenderer renderer;
        renderer.setContent(&content());
        renderer.setSprites(&shippedSprites());
        Camera camera;
        camera.setViewport(kFrame, kFrame);
        camera.userZoom = kZoom;
        camera.snapTo(at);
        renderer.draw(canvas, view, camera, at, 0.0);
        return canvas.getImageData(0, 0, kFrame, kFrame);
    };
    // Facing west, the pupils sit west in their sockets; facing east, east.
    // Were the body turned instead, the eyes would swing round the middle
    // and neither would hold.
    const EyeSplit west = eyeSplit(frame(kPi), unit, false);
    const EyeSplit east = eyeSplit(frame(0.0), unit, false);
    CHECK(west.before > west.after * 2);
    CHECK(east.after > east.before * 2);
}

// ---------------------------------------------------------------------------
// The titan: the universal forge, wearing a ring of its own
// ---------------------------------------------------------------------------

namespace {

/// Where the fixture's titan stands: the middle of the field, well clear of
/// the door and every wall -- it is a thousand units across, and its ring
/// orbits forty past its edge.
constexpr double kTitanX = kTileSize * 12.0;
constexpr double kTitanY = kTileSize * 12.0;

std::string titanWorld(const std::string& name) {
    return npcWorld(name, fixtureNpc(kTitanX, kTitanY, "titan", "universal"));
}

/// Waits for the titan's answer and hands it back with `pending` cleared, as
/// the panel reads it.
bool awaitForge(Harness& h, const std::vector<NetClient*>& clients, NetClient& client,
                TitanForgeOutcome& out) {
    if (!h.stepUntil(clients, [&] { return client.titanForgeOutcome().pending; }, 200)) {
        return false;
    }
    out = client.titanForgeOutcome();
    client.titanForgeOutcome().pending = false;
    return true;
}

/// Wears `petal` in loadout slot `slot` of `username`'s record.
void seedWorn(const std::string& path, const std::string& username, std::size_t slot,
              const char* petal, Rarity rarity) {
    Database db;
    std::string error;
    db.load(path, error);
    const Account* account = db.findUser(username);
    if (account == nullptr) return;
    PlayerRecord& record = db.progress(account->id);
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);
    StoredItem item;
    item.petalType = petal;
    item.rarity = rarity;
    record.loadout[slot] = item;
    db.markDirty();
    db.save();
}

/// The body `username` is playing, or NULL_ENTITY.
Entity bodyOf(World& world, const std::string& username) {
    Entity found = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> players{world};
    players.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == username) found = e;
    });
    return found;
}

/// Stands `username`'s flower just off the titan's east edge -- inside its
/// ring's band, where the petals sweep through it.
void standAtTitan(Harness& h, const std::vector<NetClient*>& clients, const std::string& username) {
    World& world = h.server.world();
    const Entity titan = npcWearing(world, "titan");
    const Entity body = bodyOf(world, username);
    if (titan == NULL_ENTITY || body == NULL_ENTITY) return;
    world.get<Transform>(body).position =
        world.get<Transform>(titan).position + Vec2{world.get<Body>(titan).radius + 60.0, 0.0};
    h.step(1, clients);
}

/// Every petal on the field whose owner is `owner`.
std::vector<Entity> petalsOf(World& world, Entity owner) {
    std::vector<Entity> out;
    Query<PetalInstance> petals{world};
    petals.each([&](Entity e, PetalInstance& petal) {
        if (petal.owner == owner) out.push_back(e);
    });
    return out;
}

int liveMobsOf(World& world, const char* id) {
    int count = 0;
    Query<MobTag, MobType> mobs{world};
    mobs.each([&](Entity e, MobTag&, MobType& type) {
        if (type.configIndex == content().mobIndex(id) && !world.has<Dead>(e)) ++count;
    });
    return count;
}

bool chatSays(const NetClient& client, const std::string& needle) {
    for (const ChatLine& line : client.chat()) {
        if (line.text.find(needle) != std::string::npos) return true;
    }
    return false;
}

} // namespace

TEST(the_shipped_titan_stands_in_the_jungle_wearing_a_universal_ring) {
    CHECK(ensureShippedContent());
    const std::uint16_t titan = content().mobIndex("titan");
    CHECK(titan != kInvalidIndex);
    if (titan == kInvalidIndex) return;
    const MobConfig& config = content().mob(titan);
    CHECK(config.npc.present);
    CHECK(config.npc.service == NpcService::Titan);
    CHECK(config.npc.team == Team::Players);
    CHECK_EQ(config.image, std::string("$titan"));
    CHECK(config.noEggDrop);
    // It stands: a forge that wandered off would not be one.
    CHECK(!config.beeFlight);
    // A full bar of universals, every one a petal this build has.
    CHECK(config.npc.wearsPetals());
    CHECK_EQ(config.npc.petals.size(), static_cast<std::size_t>(kLoadoutActiveSlots));
    for (const std::uint16_t petal : config.npc.petals) CHECK(petal < content().petalCount());
    CHECK(config.npc.petalRarity == Rarity::Universal);

    WorldMaps maps;
    Terrain terrain;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    Realm jungle = Realm::Overworld;
    for (const MapData& map : maps.maps()) {
        if (map.id() == "jungle") jungle = map.realm();
    }
    NpcSystem npcs;
    std::vector<std::string> warnings;
    npcs.loadSites(maps, content(), warnings);
    CHECK(warnings.empty());
    int titans = 0;
    for (const NpcSystem::Site& site : npcs.sites()) {
        if (site.mobIndex != titan) continue;
        ++titans;
        CHECK(site.realm == jungle);
        // Universal on its plate, as florr's titan is the top tier on its.
        CHECK(site.rarity == Rarity::Universal);
        // On open ground, body AND ring: nothing pushes it off its point, and
        // the ring never sweeps through a wall.
        const double radius = content().mobStats(titan, site.rarity).radius;
        const double ringReach = radius + kPetalOrbitRestRadius - kPlayerBaseRadius + 20.0;
        const Vec2 placed = terrain.resolveCircle(site.position, ringReach, site.realm);
        CHECK_NEAR(placed.x, site.position.x, 1e-6);
        CHECK_NEAR(placed.y, site.position.y, 1e-6);
        // Clear of every target dummy, whose hits would otherwise be the
        // titan's on everybody's screen.
        for (const NpcSystem::Site& other : npcs.sites()) {
            if (other.mobIndex == titan || other.realm != site.realm) continue;
            CHECK(distance(other.position, site.position) > ringReach + 200.0);
        }
    }
    CHECK_EQ(titans, 1);
}

TEST(a_titan_forge_turns_five_apex_into_one_universal) {
    const std::string dir = titanWorld("titan-forge");
    Harness h("titan-forge", [](const std::string& path) {
        seedAccount(path, "smith");
        seedStack(path, "smith", "petal_rose", Rarity::Apex, 7);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");

    NetClient client;
    CHECK(joinAs(h, client, "smith"));
    h.step(3, {&client});
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Apex) == 7u;
    }));

    standAtTitan(h, {&client}, "smith");
    client.requestTitanForge(rose);
    TitanForgeOutcome outcome;
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.petalIndex, rose);
    // Exactly five out, exactly one universal in, no roll: the two left over
    // are untouched.
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Apex) == 2u && p.stackCount(rose, Rarity::Universal) == 1u;
    }));
    // Announced, as a rare craft is -- said to be forged, and in the
    // universal grey, as each tier announces in its own colour.
    CHECK(h.stepUntil({&client}, [&] { return chatSays(client, "Universal Rose has been forged by"); },
                      30));
    // "The": there is only ever one of each petal at universal.
    CHECK(chatSays(client, "<b style=\"color: #555555;\">The Universal Rose has been forged by"));
    removeDataDir(dir);
}

TEST(the_titan_refuses_a_short_stack_and_a_flower_not_standing_at_it) {
    const std::string dir = titanWorld("titan-refuse");
    Harness h("titan-refuse", [](const std::string& path) {
        seedAccount(path, "smith");
        seedStack(path, "smith", "petal_rose", Rarity::Apex, 4);
        seedStack(path, "smith", "petal_basic", Rarity::Apex, 5);
        seedStack(path, "smith", "petal_basic", Rarity::Unique, 9);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t basic = content().petalIndex("basic");

    NetClient client;
    CHECK(joinAs(h, client, "smith"));
    h.step(3, {&client});
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(basic, Rarity::Apex) == 5u;
    }));

    // From the door, a field away: refused, and nothing taken.
    TitanForgeOutcome outcome;
    client.requestTitanForge(basic);
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(!outcome.success);
    CHECK(outcome.reason.find("too far") != std::string::npos);

    standAtTitan(h, {&client}, "smith");
    // Four apex is not five, and nine unique is not apex at all.
    client.requestTitanForge(rose);
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(!outcome.success);
    CHECK(outcome.reason.find("5 Apex Rose") != std::string::npos);
    // A petal id nobody has.
    client.requestTitanForge(0xFFFE);
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(!outcome.success);
    h.step(3, {&client});
    const Profile& profile = client.profile();
    CHECK_EQ(profile.stackCount(rose, Rarity::Apex), 4u);
    CHECK_EQ(profile.stackCount(basic, Rarity::Apex), 5u);
    CHECK_EQ(profile.stackCount(basic, Rarity::Unique), 9u);
    CHECK_EQ(profile.stackCount(rose, Rarity::Universal), 0u);
    CHECK_EQ(profile.stackCount(basic, Rarity::Universal), 0u);
    removeDataDir(dir);
}

TEST(a_forged_universal_is_taken_from_every_other_account_and_refunded_four_apex_apiece) {
    const std::string dir = titanWorld("titan-takeover");
    Harness h("titan-takeover", [](const std::string& path) {
        seedAccount(path, "smith");
        seedStack(path, "smith", "petal_rose", Rarity::Apex, 5);
        // Online: one in the bag and one worn.
        seedAccount(path, "rival");
        seedStack(path, "rival", "petal_rose", Rarity::Universal, 1);
        seedWorn(path, "rival", 0, "rose", Rarity::Universal);
        // Offline, holding three.
        seedAccount(path, "absent");
        seedStack(path, "absent", "petal_rose", Rarity::Universal, 3);
        // A universal of another petal is nobody's business.
        seedAccount(path, "bystander");
        seedStack(path, "bystander", "petal_basic", Rarity::Universal, 1);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t basic = content().petalIndex("basic");
    World& world = h.server.world();

    NetClient smith;
    NetClient rival;
    CHECK(joinAs(h, smith, "smith"));
    CHECK(joinAs(h, rival, "rival"));
    const std::vector<NetClient*> both{&smith, &rival};
    h.step(3, both);
    const Entity rivalBody = bodyOf(world, "rival");
    CHECK(rivalBody != NULL_ENTITY);
    if (rivalBody == NULL_ENTITY) { removeDataDir(dir); return; }
    CHECK_EQ(world.get<Loadout>(rivalBody).slots[0].configIndex, rose);

    standAtTitan(h, both, "smith");
    smith.requestTitanForge(rose);
    TitanForgeOutcome outcome;
    CHECK(awaitForge(h, both, smith, outcome));
    CHECK(outcome.success);

    // The rival's two -- bag and bar -- are gone, and eight apex are back.
    CHECK(awaitProfile(h, rival, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Universal) == 0u &&
               p.stackCount(rose, Rarity::Apex) == 2u * kTitanForgeRefund &&
               !p.loadout.empty() && p.loadout[0].empty();
    }));
    // Off the live body too: the ring loses it at once.
    CHECK(world.get<Loadout>(rivalBody).slots[0].empty());
    CHECK(h.stepUntil(both, [&] { return chatSays(rival, "Another player forged the Universal Rose"); },
                      30));
    // And the forger holds the one that is left.
    CHECK(awaitProfile(h, smith, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Universal) == 1u && p.stackCount(rose, Rarity::Apex) == 0u;
    }));

    // The offline account's record has paid too, at four apex apiece.
    const Database& db = h.server.database();
    const Account* absent = db.findUser("absent");
    const Account* bystander = db.findUser("bystander");
    CHECK(absent != nullptr && bystander != nullptr);
    if (absent != nullptr && bystander != nullptr) {
        const PlayerRecord* gone = db.findProgress(absent->id);
        const PlayerRecord* kept = db.findProgress(bystander->id);
        CHECK(gone != nullptr && kept != nullptr);
        if (gone != nullptr && kept != nullptr) {
            CHECK_EQ(gone->itemCount(Rarity::Universal, "petal_rose"), 0);
            CHECK_EQ(gone->itemCount(Rarity::Apex, "petal_rose"), 3 * kTitanForgeRefund);
            CHECK_EQ(kept->itemCount(Rarity::Universal, "petal_basic"), 1);
        }
    }
    (void)basic;
    removeDataDir(dir);
}

TEST(the_titan_will_not_forge_a_universal_the_forger_already_holds) {
    const std::string dir = titanWorld("titan-held");
    Harness h("titan-held", [](const std::string& path) {
        // One worn, and plenty of apex to forge another.
        seedAccount(path, "smith");
        seedStack(path, "smith", "petal_rose", Rarity::Apex, 12);
        seedWorn(path, "smith", 0, "rose", Rarity::Universal);
        seedStack(path, "smith", "petal_basic", Rarity::Apex, 5);
        seedStack(path, "smith", "petal_basic", Rarity::Universal, 1);
        // Somebody else's, which a refused forge must not touch.
        seedAccount(path, "rival");
        seedStack(path, "rival", "petal_rose", Rarity::Universal, 1);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t basic = content().petalIndex("basic");

    NetClient client;
    CHECK(joinAs(h, client, "smith"));
    h.step(3, {&client});
    standAtTitan(h, {&client}, "smith");

    // Worn or in the bag, it is the one universal of that petal: there is
    // never a second, the forger's own included.
    TitanForgeOutcome outcome;
    client.requestTitanForge(rose);
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.reason, std::string("You already have the Universal Rose."));
    client.requestTitanForge(basic);
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.reason, std::string("You already have the Universal Basic."));

    // Nothing was spent, nothing was made, and nobody lost theirs.
    h.step(3, {&client});
    const Profile& profile = client.profile();
    CHECK_EQ(profile.stackCount(rose, Rarity::Apex), 12u);
    CHECK_EQ(profile.stackCount(rose, Rarity::Universal), 0u);
    CHECK(!profile.loadout.empty() && profile.loadout[0].petalIndex == rose &&
          profile.loadout[0].rarity == Rarity::Universal);
    CHECK_EQ(profile.stackCount(basic, Rarity::Apex), 5u);
    CHECK_EQ(profile.stackCount(basic, Rarity::Universal), 1u);
    const Database& db = h.server.database();
    const Account* rival = db.findUser("rival");
    CHECK(rival != nullptr);
    if (rival != nullptr) {
        const PlayerRecord* record = db.findProgress(rival->id);
        CHECK(record != nullptr && record->itemCount(Rarity::Universal, "petal_rose") == 1);
    }
    removeDataDir(dir);
}

TEST(the_titan_names_whoever_holds_a_petal_at_universal) {
    CHECK_EQ(titanMemoryText("bob"),
             std::string("\"Ah, I remember forging that petal for a flower named bob...\""));

    const std::string dir = titanWorld("titan-holder");
    Harness h("titan-holder", [](const std::string& path) {
        seedAccount(path, "smith");
        seedStack(path, "smith", "petal_basic", Rarity::Universal, 1);
        seedStack(path, "smith", "petal_wing", Rarity::Apex, 5);
        seedAccount(path, "rival");
        seedWorn(path, "rival", 0, "rose", Rarity::Universal);
        seedAccount(path, "keeper");
        seedStack(path, "keeper", "petal_wing", Rarity::Universal, 1);
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    const std::uint16_t basic = content().petalIndex("basic");
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t wing = content().petalIndex("wing");
    const std::uint16_t stinger = content().petalIndex("stinger");

    NetClient client;
    CHECK(joinAs(h, client, "smith"));
    h.step(3, {&client});
    // Asked from the door, a field away, the titan says nothing at all.
    client.requestTitanHolder(rose);
    h.step(10, {&client});
    CHECK(client.titanHolder(rose) == nullptr);

    standAtTitan(h, {&client}, "smith");
    const auto ask = [&](std::uint16_t petal) -> std::string {
        client.forgetTitanHolder(petal);
        // Past the per-session spacing, so the query is not the one dropped.
        h.step(4, {&client});
        client.requestTitanHolder(petal);
        if (!h.stepUntil({&client}, [&] { return client.titanHolder(petal) != nullptr; }, 30)) {
            return "<no answer>";
        }
        return *client.titanHolder(petal);
    };
    // Worn or bagged, somebody else's or your own, and nobody's at all.
    CHECK_EQ(ask(rose), std::string("rival"));
    CHECK_EQ(ask(basic), std::string("smith"));
    CHECK_EQ(ask(stinger), std::string());
    CHECK_EQ(ask(wing), std::string("keeper"));

    // A forge moves the memory with the petal at once.
    client.requestTitanForge(wing);
    TitanForgeOutcome outcome;
    CHECK(awaitForge(h, {&client}, client, outcome));
    CHECK(outcome.success);
    CHECK_EQ(ask(wing), std::string("smith"));

    // Two at once: the second comes too soon and is dropped, and is answered
    // when asked again once the spacing has passed.
    client.forgetTitanHolder(rose);
    client.forgetTitanHolder(basic);
    h.step(4, {&client});
    client.requestTitanHolder(rose);
    client.requestTitanHolder(basic);
    h.step(2, {&client});
    CHECK(client.titanHolder(rose) != nullptr);
    CHECK(client.titanHolder(basic) == nullptr);
    CHECK_EQ(ask(basic), std::string("smith"));
    removeDataDir(dir);
}

TEST(the_titans_ring_orbits_it_as_a_flowers_does_and_kills_mobs_but_spares_flowers) {
    const std::string dir = titanWorld("titan-ring");
    Harness h("titan-ring", [](const std::string& path) { seedAccount(path, "boss", true); },
              dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    NetClient client;
    CHECK(joinAs(h, client, "boss"));
    World& world = h.server.world();
    const Entity titan = npcWearing(world, "titan");
    CHECK(titan != NULL_ENTITY);
    if (titan == NULL_ENTITY) { removeDataDir(dir); return; }
    const double radius = world.get<Body>(titan).radius;

    // Ten petals out, every one the titan's, universal, on the players' side,
    // and orbiting forty past its edge -- a flower's rest radius past its own.
    CHECK(h.stepUntil({&client}, [&] { return petalsOf(world, titan).size() == 10u; }, 200));
    // Wearing a ring makes it no flower: it keeps its mob's body, pool and
    // bite at its own tier, where a flower's are set by its level.
    const MobStats stats = content().mobStats(content().mobIndex("titan"), Rarity::Universal);
    CHECK_NEAR(world.get<Body>(titan).radius, stats.radius, 1e-9);
    CHECK_NEAR(world.get<Health>(titan).max, stats.health, 1e-6);
    CHECK_NEAR(world.get<ContactDamage>(titan).amount, stats.damage, 1e-6);
    CHECK(radius > 400.0);
    h.step(static_cast<int>(kPetalSpawnGlideMillis / net::kTickMillis) + 30, {&client});
    const std::vector<Entity> ring = petalsOf(world, titan);
    CHECK_EQ(ring.size(), std::size_t(10));
    const Vec2 centre = world.get<Transform>(titan).position;
    const double orbit = radius + kPetalOrbitRestRadius - kPlayerBaseRadius;
    for (const Entity petal : ring) {
        CHECK(world.get<PetalInstance>(petal).rarity == Rarity::Universal);
        CHECK(world.get<Faction>(petal).team == Team::Players);
        CHECK_NEAR(distance(world.get<Transform>(petal).position, centre), orbit, 12.0);
    }
    // And it turns.
    const Vec2 before = world.get<Transform>(ring[0]).position;
    h.step(5, {&client});
    CHECK(distance(world.get<Transform>(ring[0]).position, before) > 20.0);

    // A flower standing in the ring's band is swept by it a whole turn and
    // loses nothing; a mob in it dies. The rock is put down on screen, just
    // outside the band and clear of the flower, and only then moved into it:
    // put down in the band, it could die before anything saw it alive.
    standAtTitan(h, {&client}, "boss");
    const Entity body = bodyOf(world, "boss");
    const double full = world.get<Health>(body).max;
    const double bearing = 0.35;
    const Vec2 outside = centre + Vec2::fromAngle(bearing, orbit + 140.0);
    char command[96];
    std::snprintf(command, sizeof command, "/admin spawn rock common %.0f %.0f", outside.x,
                  outside.y);
    client.sendChat(command);
    CHECK(h.stepUntil({&client}, [&] { return liveMobsOf(world, "rock") > 0; }, 30));
    {
        Query<MobTag, MobType, Transform> mobs{world};
        mobs.each([&](Entity, MobTag&, MobType& type, Transform& transform) {
            if (type.configIndex == content().mobIndex("rock")) {
                transform.position = centre + Vec2::fromAngle(bearing, orbit);
            }
        });
    }
    CHECK(h.stepUntil({&client}, [&] { return liveMobsOf(world, "rock") == 0; },
                      kOneRingTurnTicks * 2));
    h.step(kOneRingTurnTicks, {&client});
    CHECK_NEAR(world.get<Health>(body).current, full, 1e-9);

    // Clearing it takes its ring with it, rather than leaving ten petals
    // orbiting nothing; the map's titan is back with a ring of its own.
    client.sendChat("/admin clear_npcs");
    CHECK(h.stepUntil({&client}, [&] {
        const Entity now = npcWearing(world, "titan");
        return now != NULL_ENTITY && now != titan;
    }, 30));
    CHECK(petalsOf(world, titan).empty());
    removeDataDir(dir);
}

TEST(the_titan_painter_draws_its_cog_and_scowl_and_moves_its_glints) {
    CHECK(ensureShippedContent());
    const std::uint16_t titan = content().mobIndex("titan");
    const SpriteCache& sprites = shippedSprites();
    CHECK(sprites.mobArt(titan) == MobArt::Titan);
    CHECK(sprites.mobDrawable(titan));

    // The teeth's tips on the drawn radius: 90 pixels, so an art unit is
    // 90/27.35 of a pixel.
    const double diameter = 180.0;
    const double unit = diameter * 0.5 / 27.35;
    const auto frame = [&](Vec2 gaze) {
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        sprites.drawMob(canvas, titan, kFrame * 0.5, kFrame * 0.5, diameter, 0.0, 0.0, false, 0.0,
                        gaze);
        return canvas.getImageData(0, 0, kFrame, kFrame);
    };
    const auto rgbAt = [&](const std::vector<std::uint8_t>& pixels, double ax, double ay) {
        const int x = static_cast<int>(kFrame * 0.5 + ax * unit);
        const int y = static_cast<int>(kFrame * 0.5 + ay * unit);
        const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
        if (pixels[i + 3] == 0) return 0x01000000u;   // nothing drawn there
        return (static_cast<std::uint32_t>(pixels[i]) << 16) |
               (static_cast<std::uint32_t>(pixels[i + 1]) << 8) | pixels[i + 2];
    };
    const std::vector<std::uint8_t> picture = frame({1.0, 0.0});
    // A tooth's flat top is cog out to the tip; between two teeth, past the
    // root, there is nothing.
    CHECK_EQ(rgbAt(picture, 26.8, 0.0), 0x535353u);
    const double valley = kPi / 20.0;
    CHECK_EQ(rgbAt(picture, 26.5 * std::cos(valley), 26.5 * std::sin(valley)), 0x01000000u);
    CHECK_EQ(rgbAt(picture, 0.0, 17.0), 0x666666u);
    // No frame round the eye: beside it is face. Then the eye; and above the
    // brow the scowl cuts the eye off, so the top of the socket is face.
    CHECK_EQ(rgbAt(picture, -11.8, -4.0), 0x666666u);
    CHECK_EQ(rgbAt(picture, -8.6, -2.0), 0x111111u);
    CHECK_EQ(rgbAt(picture, -7.0, -10.4), 0x666666u);
    CHECK_EQ(rgbAt(picture, 7.0, -10.4), 0x666666u);

    // The glints travel as a flower's pupils do, and never leave their
    // sockets: glint pixels split by which side of their own eye's middle
    // they sit on.
    const auto glints = [&](Vec2 gaze) {
        const std::vector<std::uint8_t> pixels = frame(gaze);
        PupilSides out;
        for (int y = 0; y < kFrame; ++y) {
            for (int x = 0; x < kFrame; ++x) {
                const std::size_t i = static_cast<std::size_t>((y * kFrame + x) * 4);
                if (pixels[i] != 0xEE || pixels[i + 1] != 0xEE || pixels[i + 2] != 0xEE) continue;
                const double ax = (x + 0.5 - kFrame * 0.5) / unit;
                const double ay = (y + 0.5 - kFrame * 0.5) / unit;
                const double dx = ax - (ax < 0.0 ? -7.0 : 7.0);
                const double dy = ay + 5.0;
                if (dx < 0.0) ++out.left;
                else ++out.right;
                if (dx * dx / 9.0 + dy * dy / 36.0 > 1.0) ++out.outsideSocket;
            }
        }
        return out;
    };
    const PupilSides east = glints({1.0, 0.0});
    const PupilSides west = glints({-1.0, 0.0});
    CHECK(east.right > east.left * 2);
    CHECK(west.left > west.right * 2);
    CHECK_EQ(east.outsideSocket, 0);
    CHECK_EQ(west.outsideSocket, 0);
}
