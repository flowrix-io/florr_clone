// Prestige: the talent, the prestige twin maps, what grows in them, and the
// join that reaches them. See shared/game/prestige.h.

#include "test.h"

#include "server_harness.h"
#include "server/db.h"
#include "server/systems/spawning.h"
#include "shared/game/prestige.h"
#include "shared/game/map_elements.h"
#include "shared/game/skills.h"
#include "shared/game/terrain.h"
#include "test_data.h"

#include <string>
#include <vector>

using namespace flix;
using namespace flix::testsupport;

namespace {

/// Gives a seeded account the Prestige node, and optionally XP enough for
/// `level`, which is what a purchase is paid from.
void seedProgress(const std::string& path, const std::string& username, bool prestige,
                  int level = 1) {
    Database db;
    std::string error;
    db.load(path, error);
    const Account* account = db.findUser(username);
    if (account == nullptr) return;
    PlayerRecord& record = db.progress(account->id);
    if (prestige) record.skills.set(SkillId::Prestige, 0);
    double xp = 0.0;
    for (int l = 1; l < level; ++l) xp += xpForNextLevel(l);
    record.totalXp = xp;
    db.markDirty();
    db.save();
}

bool logIn(Harness& h, NetClient& client, const char* name) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, "password7");
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

bool join(Harness& h, NetClient& client, const char* name, bool prestige,
          const std::string& where = {}) {
    client.joinGame(1920, 1080, where, name, prestige);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                       200);
}

Realm realmOf(World& world, Entity e) {
    return e == NULL_ENTITY ? Realm::Overworld : world.get<Transform>(e).realm;
}

} // namespace

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

TEST(an_prestige_band_rolls_one_tier_up_and_stops_at_super) {
    CHECK(prestigeRarity(Rarity::Common) == Rarity::Uncommon);
    CHECK(prestigeRarity(Rarity::Mythic) == Rarity::Ultra);
    CHECK(prestigeRarity(Rarity::Ultra) == Rarity::Super);
    // Super has nowhere to go: unique and apex never stand in a twin.
    CHECK(prestigeRarity(Rarity::Super) == Rarity::Super);
    CHECK(!barredFromPrestige(Rarity::Super));
    CHECK(barredFromPrestige(Rarity::Unique));
    CHECK(barredFromPrestige(Rarity::Apex));
}

TEST(prestige_is_one_root_node_costing_225) {
    CHECK_EQ(skillTierCount(SkillId::Prestige), 1);
    CHECK_EQ(skillTierCost(SkillId::Prestige, 0), 225);
    CHECK(skillFork(SkillId::Prestige) == nullptr);
    CHECK(skillFromKey("prestige") == SkillId::Prestige);

    SkillSet skills;
    CHECK(!skills.prestigeUnlocked());
    CHECK(skills.prerequisiteMet(SkillId::Prestige));
    skills.set(SkillId::Prestige, 0);
    CHECK(skills.prestigeUnlocked());
    CHECK_EQ(skills.spent(), 225);
    CHECK_EQ(availableTalentPoints(225, skills), 0);
    // It multiplies nothing.
    CHECK_NEAR(skills.statScale(SkillId::Damage), 1.0, 1e-12);
    CHECK_NEAR(skills.reloadScale(), 1.0, 1e-12);
}

// ---------------------------------------------------------------------------
// The twin maps
// ---------------------------------------------------------------------------

TEST(every_shipped_biome_has_an_prestige_twin_after_every_plain_realm) {
    WorldMaps maps;
    std::string error;
    CHECK(maps.load(dataDir(), nullptr, error));

    int plain = 0;
    int twins = 0;
    int lastPlainSlot = -1;
    int firstTwinSlot = maps.count();
    for (int i = 0; i < maps.count(); ++i) {
        const MapData& map = maps.maps()[static_cast<std::size_t>(i)];
        if (map.prestige()) {
            ++twins;
            firstTwinSlot = std::min(firstTwinSlot, i);
            CHECK(maps.isPrestige(map.realm()));
            CHECK_EQ(map.id(), std::string(kPrestigeMapPrefix) + map.templateId());
            CHECK(map.displayName().rfind("Prestige ", 0) == 0);
            continue;
        }
        lastPlainSlot = i;
        CHECK(!maps.isPrestige(map.realm()));
        bool found = false;
        const Realm twin = maps.prestigeRealm(map.realm(), found);
        // The instanced dungeon copies have none; every biome does.
        if (map.id() != map.templateId() || maps.copiesOf(map.templateId()).size() > 1) {
            CHECK(!found);
            continue;
        }
        ++plain;
        CHECK(found);
        if (!found) continue;
        const MapData* other = maps.forRealm(twin);
        CHECK(other != nullptr);
        if (other == nullptr) continue;
        CHECK(other->prestige());
        CHECK_EQ(other->id(), std::string(kPrestigeMapPrefix) + map.id());
        // Same place, same mobs.
        CHECK_EQ(other->biome(), map.biome());
        CHECK_EQ(other->defaultMobGroup(), map.defaultMobGroup());
        CHECK_EQ(other->elements().size(), map.elements().size());
        // A twin of a twin is not a thing.
        bool again = false;
        maps.prestigeRealm(twin, again);
        CHECK(!again);
    }
    CHECK(plain >= 8);
    CHECK_EQ(twins, plain);
    // Appended: turning prestige on renumbered no existing realm.
    CHECK(lastPlainSlot < firstTwinSlot);
    // There is no prestige arena or maze.
    bool found = true;
    maps.prestigeRealm(Realm::Arena, found);
    CHECK(!found);
    maps.prestigeRealm(Realm::Maze, found);
    CHECK(!found);
    // Nor are a twin's doors offered on their own.
    for (const SpawnChoice& door : maps.doors()) CHECK(!maps.isPrestige(door.realm));
}

TEST(a_pad_on_an_prestige_twin_leads_to_another_twin) {
    WorldMaps maps;
    std::string error;
    CHECK(maps.load(dataDir(), nullptr, error));
    int pads = 0;
    for (const MapData& map : maps.maps()) {
        if (!map.prestige()) continue;
        for (const MapElement& pad : map.elements()) {
            if (pad.kind != MapElementKind::Teleporter || pad.targetMap.empty()) continue;
            bool found = false;
            const Realm target = maps.realmOfId(pad.targetMap, found);
            CHECK(found);
            if (!found) continue;
            const MapData* destination = maps.forRealm(target);
            if (destination == nullptr) continue;
            // Into a twin, unless the place it leads has none (a dungeon).
            bool hasTwin = false;
            maps.prestigeRealm(maps.realmOfId(stripPrestigePrefix(pad.targetMap), found), hasTwin);
            CHECK(destination->prestige() || !hasTwin);
            ++pads;
        }
    }
    CHECK(pads > 0);
    // And the plain maps' pads were left alone.
    for (const MapData& map : maps.maps()) {
        if (map.prestige()) continue;
        for (const MapElement& pad : map.elements()) {
            if (pad.kind != MapElementKind::Teleporter) continue;
            CHECK(pad.targetMap.rfind(kPrestigeMapPrefix, 0) != 0);
        }
    }
}

TEST(a_copies_entry_cannot_also_be_prestige) {
    const std::string dir = tempDir("flix-prestige-manifest-" + std::to_string(::getpid()));
    CHECK(writeText(dir + "/maps.json",
                    R"({"maps": [{"file": "a.tmj", "copies": 2, "prestige": true}]})"));
    WorldMaps maps;
    std::string error;
    CHECK(!maps.load(dir, nullptr, error));
    CHECK(error.find("cannot also have a prestige twin") != std::string::npos);
}

// ---------------------------------------------------------------------------
// What grows there
// ---------------------------------------------------------------------------

TEST(an_prestige_twin_grows_every_band_a_tier_up_and_no_boss_above_super) {
    World world;
    CommandBuffer commands{world};
    Terrain terrain;
    SpawnSystem spawner;
    Rng rng{0xA5CE11u};
    WorldMaps maps;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    spawner.worldMaps = &maps;
    // One pass with nobody about stocks every band on every map as records.
    spawner.run(world, terrain, shippedContent(), {}, rng, 50000.0, net::kTickSeconds, commands);
    commands.flush();

    bool found = false;
    const Realm garden = maps.realmOfId("garden", found);
    CHECK(found);
    const Realm prestigeGarden = maps.prestigeRealm(garden, found);
    CHECK(found);
    CHECK(spawner.prestigeRealm(prestigeGarden));
    CHECK(!spawner.prestigeRealm(garden));

    const auto tiers = [&](Realm realm) {
        std::vector<SpawnSystem::LatentSite> sites;
        spawner.latentSites(realm, sites);
        return sites;
    };
    const std::vector<SpawnSystem::LatentSite> plainSites = tiers(garden);
    const std::vector<SpawnSystem::LatentSite> twinSites = tiers(prestigeGarden);
    CHECK(!plainSites.empty());
    CHECK(!twinSites.empty());

    // Difficulty-0 ground is all common in the garden and all uncommon in its
    // twin, mob floors aside -- and nothing in the twin is common.
    int plainCommons = 0;
    double plainSum = 0.0;
    for (const auto& site : plainSites) {
        plainCommons += site.rarity == Rarity::Common ? 1 : 0;
        plainSum += rarityIndex(site.rarity);
    }
    double twinSum = 0.0;
    for (const auto& site : twinSites) {
        CHECK(site.rarity != Rarity::Common);
        twinSum += rarityIndex(site.rarity);
    }
    CHECK(plainCommons > 0);
    CHECK(twinSum / twinSites.size() > plainSum / plainSites.size() + 0.5);

    // On every twin: nothing above super, as a record or as a body.
    for (const MapData& map : maps.maps()) {
        if (!map.prestige()) continue;
        for (const auto& site : tiers(map.realm())) CHECK(!barredFromPrestige(site.rarity));
    }
    Query<MobTag, Transform, MobType> mobs{world};
    mobs.each([&](Entity, MobTag&, Transform& transform, MobType& type) {
        if (maps.isPrestige(transform.realm)) CHECK(!barredFromPrestige(type.rarity));
    });
    // And no clock was dealt for one: a twin is not a boss biome.
    for (const SpawnSystem::BiomeBossClock& clock : spawner.bossClocks()) {
        CHECK(clock.biome.rfind(kPrestigeMapPrefix, 0) != 0);
    }
    // No announcement either: a twin's supers are its everyday stock. The
    // plain biomes' cold stock does announce its supers, so the list is not
    // empty for want of anything to say.
    CHECK(!spawner.bossSpawns.empty());
    for (const SpawnSystem::BossSpawn& boss : spawner.bossSpawns) {
        CHECK(!maps.isPrestige(boss.realm));
    }
}

TEST(nothing_puts_a_unique_or_apex_into_an_prestige_twin) {
    World world;
    Terrain terrain;
    SpawnSystem spawner;
    Rng rng{7u};
    WorldMaps maps;
    std::string error;
    CHECK(maps.load(dataDir(), &terrain, error));
    spawner.worldMaps = &maps;
    bool found = false;
    const Realm garden = maps.realmOfId("garden", found);
    const Realm twin = maps.prestigeRealm(garden, found);
    CHECK(found);
    const std::uint16_t bee = shippedContent().mobIndex("bee");
    CHECK(bee != kInvalidIndex);
    const Vec2 at = terrain.spawnPoint(twin);

    CHECK(spawner.spawnMob(world, terrain, shippedContent(), bee, Rarity::Unique, at, twin, 0.0,
                           rng) == NULL_ENTITY);
    CHECK(spawner.spawnMob(world, terrain, shippedContent(), bee, Rarity::Apex, at, twin, 0.0,
                           rng) == NULL_ENTITY);
    // Super is the ceiling, not over it.
    CHECK(spawner.spawnMob(world, terrain, shippedContent(), bee, Rarity::Super, at, twin, 0.0,
                           rng) != NULL_ENTITY);
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

TEST(only_a_tree_with_prestige_joins_the_prestige_biome) {
    Harness h("prestige-join",
              [](const std::string& path) {
                  seedUser(path, "climber", "password7");
                  seedUser(path, "walker", "password7");
                  seedProgress(path, "climber", true);
                  seedProgress(path, "walker", false);
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();
    const WorldMaps& maps = h.server.worldMaps();
    bool found = false;
    const Realm twin = maps.prestigeRealm(Realm::Overworld, found);
    CHECK(found);

    // Without the talent the flag is refused, and said so.
    NetClient walker;
    CHECK(logIn(h, walker, "walker"));
    CHECK(join(h, walker, "walker", true));
    CHECK(realmOf(world, bodyNamed(world, "walker")) == Realm::Overworld);
    CHECK(sawText(walker, "Prestige is a talent"));

    // With it, the default door's twin.
    NetClient climber;
    CHECK(logIn(h, climber, "climber"));
    CHECK(join(h, climber, "climber", true));
    CHECK(realmOf(world, bodyNamed(world, "climber")) == twin);
    CHECK(climber.view().realm() == twin);

    // A named door goes to that door's twin.
    climber.leaveGame();
    h.step(5, {&climber, &walker});
    const SpawnChoice* desert = maps.choice("desert");
    CHECK(desert != nullptr);
    if (desert != nullptr) {
        CHECK(join(h, climber, "climber", true, desert->id));
        const Realm desertTwin = maps.prestigeRealm(desert->realm, found);
        CHECK(found);
        CHECK(realmOf(world, bodyNamed(world, "climber")) == desertTwin);
    }

    // The arena has no twin: the flag means nothing there.
    climber.leaveGame();
    h.step(5, {&climber, &walker});
    CHECK(join(h, climber, "climber", true, kArenaSpawnChoice));
    CHECK(realmOf(world, bodyNamed(world, "climber")) == Realm::Arena);
}

TEST(prestige_is_bought_with_225_points_and_not_on_the_maze_tree) {
    Harness h("prestige-buy",
              [](const std::string& path) {
                  seedUser(path, "rich", "password7");
                  seedUser(path, "poor", "password7");
                  seedProgress(path, "rich", false, 225);
                  seedProgress(path, "poor", false, 224);
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient poor;
    CHECK(logIn(h, poor, "poor"));
    CHECK(awaitProfile(h, poor, [](const Profile& p) { return p.level == 224; }));
    poor.requestUpgradeSkill(SkillId::Prestige, 0);
    CHECK(h.stepUntil({&poor}, [&] { return sawText(poor, "need 225"); }, 60));
    CHECK(!poor.profile().skills.prestigeUnlocked());

    NetClient rich;
    CHECK(logIn(h, rich, "rich"));
    CHECK(awaitProfile(h, rich, [](const Profile& p) { return p.level == 225; }));
    rich.requestUpgradeSkill(SkillId::Prestige, 0);
    CHECK(awaitProfile(h, rich, [](const Profile& p) {
        return p.skills.prestigeUnlocked() && p.talentPoints() == 0;
    }));

    // A reset hands the points back and the next join is an ordinary one.
    rich.requestResetSkills();
    CHECK(awaitProfile(h, rich, [](const Profile& p) { return !p.skills.prestigeUnlocked(); }));
    CHECK(join(h, rich, "rich", true));
    World& world = h.server.world();
    CHECK(realmOf(world, bodyNamed(world, "rich")) == Realm::Overworld);
}

TEST(a_reset_in_a_prestige_biome_sends_the_flower_home) {
    Harness h("prestige-reset-kick",
              [](const std::string& path) {
                  seedUser(path, "climber", "password7");
                  seedUser(path, "walker", "password7");
                  seedProgress(path, "climber", true);
                  seedProgress(path, "walker", true);
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient climber;
    CHECK(logIn(h, climber, "climber"));
    CHECK(awaitProfile(h, climber, [](const Profile& p) { return p.skills.prestigeUnlocked(); }));
    CHECK(join(h, climber, "climber", true));
    CHECK(h.server.worldMaps().isPrestige(realmOf(world, bodyNamed(world, "climber"))));

    // Without the talent the flower may not stay: the body goes, and the
    // client is told so rather than left drawing a world it is not in.
    climber.requestResetSkills();
    CHECK(h.stepUntil({&climber}, [&] { return climber.leftWorld; }, 60));
    CHECK(climber.status() == NetClient::Status::LoggedIn);
    CHECK(bodyNamed(world, "climber") == NULL_ENTITY);
    CHECK(awaitProfile(h, climber, [](const Profile& p) { return !p.skills.prestigeUnlocked(); }));

    // And the next join, asking for prestige all the same, is an ordinary one.
    CHECK(join(h, climber, "climber", true));
    CHECK(realmOf(world, bodyNamed(world, "climber")) == Realm::Overworld);

    // A reset in an ordinary biome leaves the flower where it is.
    NetClient walker;
    CHECK(logIn(h, walker, "walker"));
    CHECK(awaitProfile(h, walker, [](const Profile& p) { return p.skills.prestigeUnlocked(); }));
    CHECK(join(h, walker, "walker", false));
    walker.requestResetSkills();
    CHECK(awaitProfile(h, walker, [](const Profile& p) { return !p.skills.prestigeUnlocked(); }));
    h.step(10, {&walker});
    CHECK(!walker.leftWorld);
    CHECK(walker.status() == NetClient::Status::Playing);
    CHECK(bodyNamed(world, "walker") != NULL_ENTITY);
}

TEST(a_prestige_super_is_neither_announced_nor_mourned) {
    // A super is a prestige biome's everyday stock, not a boss: no spawn line,
    // no "has been defeated" line, whether it dies or an operator clears it.
    Harness h("prestige-quiet-super",
              [](const std::string& path) {
                  seedUser(path, "warden", "password7", true);
                  seedProgress(path, "warden", true);
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(logIn(h, client, "warden"));
    CHECK(join(h, client, "warden", true));
    const Realm realm = realmOf(world, bodyNamed(world, "warden"));
    CHECK(h.server.worldMaps().isPrestige(realm));

    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(sawText(client, "Spawned super bee"));
    const std::uint16_t bee = shippedContent().mobIndex("bee");
    std::vector<Entity> supers;
    Query<MobTag, MobType, Transform> mobs{world};
    mobs.each([&](Entity e, MobTag&, MobType& type, Transform& at) {
        if (type.configIndex == bee && type.rarity == Rarity::Super && at.realm == realm) {
            supers.push_back(e);
        }
    });
    CHECK_EQ(supers.size(), std::size_t(1));
    for (const Entity e : supers) {
        Afflictions* afflictions = world.tryGet<Afflictions>(e);
        if (afflictions == nullptr) {
            world.add<Afflictions>(e, Afflictions{});
            afflictions = world.tryGet<Afflictions>(e);
        }
        afflictions->poisonStacks.push_back({NULL_ENTITY, 1e12, 1e18});
    }
    CHECK(h.stepUntil({&client}, [&] {
        for (const Entity e : supers) {
            if (world.isAlive(e)) return false;
        }
        return true;
    }, 120));
    h.step(10, {&client});

    // And one cleared by killall, which announces the bosses it removes.
    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(say(h, client, "/admin killall"));
    h.step(10, {&client});

    // The plain biomes' supers are still announced server-wide, "somewhere";
    // what must not appear is a line about THIS bee, which would say it
    // spawned here.
    CHECK(!sawText(client, "Super Bee has spawned!"));
    CHECK(!sawText(client, "Super Bee has been defeated"));
}
