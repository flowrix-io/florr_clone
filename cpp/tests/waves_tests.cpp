// The wave survival mode: the rules on their own, then the rift, the game and
// its ending through a real server and real sockets, then what the portal and
// the disc put on the screen.

#include <array>
#include <cmath>
#include <cstdio>
#include <set>
#include <string>

#include "client/render/world_renderer.h"
#include "client/ui/text.h"
#include "server/systems/spawning.h"
#include "render_rig.h"
#include "server_harness.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"
#include "shared/game/waves.h"
#include "test.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

void seedWaves(const std::string& path) {
    seedUser(path, "boss", "password7", true);
    seedUser(path, "alice", "password7");
    seedUser(path, "bob", "password7");
    seedUser(path, "tier2", "password7", true, 2);
    seedUser(path, "tier3", "password7", true, 3);
    seedUser(path, "tier4", "password7", true, 4);
    seedUser(path, "owner", "password7", true, kOwnerAdminTier);
}

bool playing(Harness& h, NetClient& client, const char* name, const std::string& where = {}) {
    if (!loginAs(h, client, name, "password7")) return false;
    client.joinGame(1000, 800, where);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; });
}

Entity bodyOf(Harness& h, const char* name) {
    const Session* session = GameServerPeer::sessionOf(h.server, name);
    return session != nullptr ? session->entity : NULL_ENTITY;
}

/// Puts a flower on the open rift and waits for it to be taken through.
bool throughTheRift(Harness& h, std::vector<NetClient*> clients, NetClient& client,
                    const char* name) {
    if (!client.rift().open) return false;
    Entity body = bodyOf(h, name);
    if (body == NULL_ENTITY) return false;
    h.server.world().get<Transform>(body).position = client.rift().position;
    return h.stepUntil(clients, [&] { return client.view().realm() == kWavesRealm; }, 200);
}

void immortal(Harness& h, const char* name) {
    h.server.world().get<Health>(bodyOf(h, name)).invulnerableUntilMillis = 1e15;
}

void kill(Harness& h, const char* name) {
    h.server.world().add<Dead>(bodyOf(h, name), Dead{NULL_ENTITY});
}

int mobsOnTheDisc(World& world) {
    int mobs = 0;
    Query<MobTag, Transform> query{world};
    query.each([&](Entity, MobTag&, Transform& at) {
        if (at.realm == kWavesRealm) ++mobs;
    });
    return mobs;
}

/// Kills every mob on the disc but the first `keep` of them.
void killMobsLeaving(Harness& h, int keep) {
    World& world = h.server.world();
    std::vector<Entity> mobs;
    Query<MobTag, Transform> query{world};
    query.without<Dead>();
    query.each([&](Entity e, MobTag&, Transform& at) {
        if (at.realm == kWavesRealm) mobs.push_back(e);
    });
    for (std::size_t i = static_cast<std::size_t>(keep); i < mobs.size(); ++i) {
        world.add<Dead>(mobs[i], Dead{NULL_ENTITY});
    }
}

bool heardRiftLine(const NetClient& client) {
    for (const auto& line : client.chat()) {
        if (line.text.find("A Mysterious rift has opened!") != std::string::npos) return true;
    }
    return false;
}

} // namespace

// -- the rules --------------------------------------------------------------

TEST(a_wave_is_a_minute_until_wave_ten_then_keeps_growing) {
    CHECK_EQ(waveLength(1), 60.0);
    CHECK_EQ(waveLength(10), 60.0);
    double previous = waveLength(10);
    for (int wave = 11; wave <= 500; ++wave) {
        CHECK(waveLength(wave) > previous);
        previous = waveLength(wave);
    }
    CHECK(std::abs(waveLength(30) - 67.3) < 0.1);
    CHECK(std::abs(waveLength(100) - 77.5) < 0.1);
}

TEST(the_disc_grows_fifty_a_wave_from_flooooios_size_to_its_most) {
    CHECK_EQ(waveRadius(1), kWavesStartRadius);
    CHECK_EQ(waveRadius(1), 1500.0);
    CHECK_EQ(waveRadius(2), 1550.0);
    CHECK_EQ(waveRadius(10), 1950.0);
    for (int wave = 2; wave <= 131; ++wave) CHECK(waveRadius(wave) > waveRadius(wave - 1));
    CHECK_EQ(waveRadius(131), kWavesMaxRadius);
    CHECK_EQ(waveRadius(65535), kWavesMaxRadius);
    CHECK_EQ(waveRadius(0), kWavesStartRadius);
}

TEST(a_wave_spends_ten_points_a_wave_on_mobs_the_game_has) {
    std::vector<WaveMob> due;
    for (std::size_t biome = 0; biome < kWaveBiomes.size(); ++biome) {
        Rng rng(7 + biome);
        WaveSpawner spawner;
        spawner.next(static_cast<WaveBiome>(biome), 10, rng);
        CHECK_EQ(spawner.points(), 100);
        CHECK(!spawner.special());
        int mobs = 0;
        for (int step = 0; step < 30 * 120; ++step) {
            spawner.step(static_cast<WaveBiome>(biome), 10, rng, due);
            for (const WaveMob& mob : due) {
                ++mobs;
                CHECK(shippedContent().mobIndex(mob.id) != kInvalidIndex);
            }
        }
        CHECK(spawner.finished());
        CHECK(mobs > 0);
        CHECK(mobs <= 100);
    }
}

TEST(the_first_wave_holds_only_what_spawns_from_wave_one) {
    Rng rng(11);
    WaveSpawner spawner;
    spawner.next(WaveBiome::Garden, 1, rng);
    std::set<std::string> seen;
    std::vector<WaveMob> due;
    for (int step = 0; step < 30 * 60; ++step) {
        spawner.step(WaveBiome::Garden, 1, rng, due);
        for (const WaveMob& mob : due) seen.insert(mob.id);
    }
    CHECK(!seen.empty());
    for (const std::string& id : seen) CHECK(id == "bee" || id == "baby_ant");
}

TEST(every_biome_names_only_mobs_the_game_has) {
    for (std::size_t biome = 0; biome < kWaveBiomes.size(); ++biome) {
        const std::vector<const char*> ids = waveMobIds(static_cast<WaveBiome>(biome));
        CHECK(!ids.empty());
        for (const char* id : ids) CHECK(shippedContent().mobIndex(id) != kInvalidIndex);
    }
}

TEST(every_biome_paves_its_disc_with_tile_art_that_ships) {
    // Every .svg in maps/tiles is staged; a name that is not one leaves the
    // disc a flat fill of the gauge colour.
    for (const WaveBiomeInfo& biome : kWaveBiomes) {
        std::FILE* art = std::fopen(repoMap(std::string("tiles/") + biome.tile).c_str(), "rb");
        CHECK(art != nullptr);
        if (art != nullptr) std::fclose(art);
    }
}

TEST(every_biome_has_a_first_wave_and_it_ends) {
    // A table whose every mob waits for a later wave would spend nothing, and
    // its first wave could only ever end on the clock.
    std::vector<WaveMob> due;
    for (std::size_t biome = 0; biome < kWaveBiomes.size(); ++biome) {
        const auto which = static_cast<WaveBiome>(biome);
        Rng rng(41 + biome);
        WaveSpawner spawner;
        spawner.next(which, 1, rng);
        int mobs = 0;
        const int length = static_cast<int>(waveLength(1) * kWaveStepsPerSecond);
        for (int step = 0; step < length && !spawner.finished(); ++step) {
            spawner.step(which, 1, rng, due);
            mobs += static_cast<int>(due.size());
        }
        CHECK(spawner.finished());
        CHECK(mobs > 0);
    }
}

TEST(every_biomes_special_waves_are_each_one_family) {
    // A family naming a mob its biome's table lacks would quietly fall back on
    // the whole table: a swarm of everything. Every family is three kinds at
    // most, and every biome has at least one.
    std::vector<WaveMob> due;
    for (std::size_t biome = 0; biome < kWaveBiomes.size(); ++biome) {
        const auto which = static_cast<WaveBiome>(biome);
        const std::vector<const char*> table = waveMobIds(which);
        int families = 0;
        for (int group = 0;; ++group) {
            Rng rng(43 + biome * 16 + static_cast<std::uint64_t>(group));
            WaveSpawner spawner;
            spawner.next(which, 20, rng, group);
            if (!spawner.special()) break;
            ++families;
            std::set<std::string> kinds;
            for (int step = 0; step < 30 * 120 && !spawner.finished(); ++step) {
                spawner.step(which, 20, rng, due);
                for (const WaveMob& mob : due) kinds.insert(mob.id);
            }
            CHECK(spawner.finished());
            CHECK(!kinds.empty());
            CHECK(kinds.size() <= 3);
            for (const std::string& kind : kinds) {
                CHECK(std::any_of(table.begin(), table.end(),
                                  [&](const char* id) { return kind == id; }));
            }
        }
        CHECK(families > 0);
    }
}

TEST(a_special_wave_swarms_with_one_family_on_a_bonus_budget) {
    Rng rng(13);
    WaveSpawner spawner;
    spawner.next(WaveBiome::Garden, 20, rng, 2);   // the hornets
    CHECK(spawner.special());
    CHECK_EQ(spawner.points(), 1200);
    int mobs = 0;
    int steps = 0;
    std::vector<WaveMob> due;
    while (!spawner.finished() && steps < 30 * 120) {
        spawner.step(WaveBiome::Garden, 20, rng, due);
        ++steps;
        for (const WaveMob& mob : due) {
            ++mobs;
            CHECK_EQ(std::string(mob.id), std::string("hornet"));
        }
    }
    CHECK_EQ(mobs, 1200);
    // Out before the wave's clock is, swarm and all.
    CHECK(steps < waveLength(20) * kWaveStepsPerSecond);
}

TEST(a_high_wave_spawns_faster_so_its_mobs_are_out_well_before_its_clock) {
    std::vector<WaveMob> due;
    double lastPace = 0.0;
    for (const int wave : {1, 5, 20, 40, 80, 150, 400}) {
        Rng rng(29 + static_cast<std::uint64_t>(wave));
        WaveSpawner spawner;
        do {
            spawner.next(WaveBiome::Garden, wave, rng);
        } while (spawner.special());
        CHECK(spawner.pace() >= lastPace);
        lastPace = spawner.pace();
        const double length = waveLength(wave) * kWaveStepsPerSecond;
        int steps = 0;
        while (!spawner.finished() && steps < static_cast<int>(length)) {
            spawner.step(WaveBiome::Garden, wave, rng, due);
            ++steps;
        }
        CHECK(spawner.finished());
        CHECK(steps < length * 0.75);
    }
    // The low waves keep flooooio's own pace.
    Rng rng(31);
    WaveSpawner low;
    low.next(WaveBiome::Garden, 5, rng);
    CHECK_EQ(low.pace(), 1.0);
    CHECK(lastPace > 10.0);
}

TEST(a_special_wave_at_a_high_wave_is_out_before_its_clock_too) {
    std::vector<WaveMob> due;
    for (const int wave : {15, 60, 200}) {
        Rng rng(37 + static_cast<std::uint64_t>(wave));
        WaveSpawner spawner;
        spawner.next(WaveBiome::Ocean, wave, rng, 0);   // the bubbles
        const double length = waveLength(wave) * kWaveStepsPerSecond;
        int steps = 0;
        while (!spawner.finished() && steps < static_cast<int>(length)) {
            spawner.step(WaveBiome::Ocean, wave, rng, due);
            ++steps;
        }
        CHECK(spawner.finished());
        CHECK(steps < length * 0.75);
    }
}

TEST(special_waves_start_at_fifteen) {
    Rng rng(17);
    int below = 0, from = 0;
    for (int i = 0; i < 2000; ++i) {
        WaveSpawner spawner;
        spawner.next(WaveBiome::Desert, 14, rng);
        below += spawner.special();
        spawner.next(WaveBiome::Desert, 15, rng);
        from += spawner.special();
    }
    CHECK_EQ(below, 0);
    CHECK(from > 200 && from < 400);   // 15% of 2000
}

TEST(rarity_climbs_with_the_wave_to_ultra_then_super) {
    Rng rng(19);
    const auto mean = [&rng](int wave) {
        double total = 0.0;
        for (int i = 0; i < 4000; ++i) total += rarityIndex(rollWaveRarity(wave, rng));
        return total / 4000.0;
    };
    CHECK(mean(1) < 0.5);
    CHECK(mean(10) > mean(1));
    CHECK(mean(30) > mean(10));
    CHECK(mean(70) > mean(50));
    const auto share = [&rng](int wave, Rarity rarity, int rolls = 2000) {
        int hits = 0;
        for (int i = 0; i < rolls; ++i) hits += rollWaveRarity(wave, rng) == rarity;
        return hits / static_cast<double>(rolls);
    };
    const auto onlyBetween = [&rng](int wave, Rarity lowest, Rarity highest) {
        bool inside = true;
        for (int i = 0; i < 2000; ++i) {
            const int rolled = rarityIndex(rollWaveRarity(wave, rng));
            inside = inside && rolled >= rarityIndex(lowest) && rolled <= rarityIndex(highest);
        }
        return inside;
    };
    // Past wave 60 nothing below mythic is left, and past 75 no mythic either.
    CHECK(onlyBetween(61, Rarity::Mythic, Rarity::Ultra));
    CHECK(share(kWaveMythicEndsAfter, Rarity::Mythic) < 0.05);
    // Then ultras alone, all the way to kWaveSuperFrom.
    for (const int wave : {kWaveMythicEndsAfter + 1, 100, 150, kWaveSuperFrom}) {
        CHECK(onlyBetween(wave, Rarity::Ultra, Rarity::Ultra));
    }
    // Supers take over evenly from there.
    const double early = share(kWaveSuperFrom + 10, Rarity::Super);
    const double half = share((kWaveSuperFrom + kWaveAllSuperAt) / 2, Rarity::Super);
    const double late = share(kWaveAllSuperAt - 10, Rarity::Super);
    CHECK(early > 0.12 && early < 0.28);
    CHECK(half > 0.43 && half < 0.57);
    CHECK(late > 0.72 && late < 0.88);
    for (const int wave : {kWaveAllSuperAt, 275, kWaveUniqueFrom - 1}) {
        CHECK(onlyBetween(wave, Rarity::Super, Rarity::Super));
    }
}

TEST(from_wave_300_one_in_a_hundred_is_unique_and_from_400_one_in_a_thousand_apex) {
    Rng rng(23);
    constexpr int kRolls = 200000;
    const auto count = [&rng](int wave) {
        std::array<int, kRarityCount> tally{};
        for (int i = 0; i < kRolls; ++i) ++tally[static_cast<std::size_t>(rarityIndex(rollWaveRarity(wave, rng)))];
        return tally;
    };
    const auto at300 = count(kWaveUniqueFrom);
    CHECK_EQ(at300[rarityIndex(Rarity::Super)] + at300[rarityIndex(Rarity::Unique)], kRolls);
    CHECK(at300[rarityIndex(Rarity::Unique)] > 1800 && at300[rarityIndex(Rarity::Unique)] < 2200);
    CHECK_EQ(count(kWaveApexFrom - 1)[rarityIndex(Rarity::Apex)], 0);
    // An apex is not taken out of the uniques' share: 1% of them stay unique.
    for (const int wave : {kWaveApexFrom, 1000, 65535}) {
        const auto tally = count(wave);
        const int supers = tally[rarityIndex(Rarity::Super)];
        const int uniques = tally[rarityIndex(Rarity::Unique)];
        const int apexes = tally[rarityIndex(Rarity::Apex)];
        CHECK_EQ(supers + uniques + apexes, kRolls);
        CHECK(uniques > 1800 && uniques < 2200);
        CHECK(apexes > 140 && apexes < 260);
    }
}

TEST(the_waves_realm_is_a_disc_of_open_floor) {
    CHECK(!isWorldRealm(kWavesRealm));
    CHECK(kWavesRealm != kAdminArenaRealm);
    Terrain terrain;
    CHECK(!terrain.blocked(kWavesCentre, kWavesRealm));
    CHECK(terrain.blocked({kWavesCentre.x + kWavesStartRadius + 1.0, kWavesCentre.y}, kWavesRealm));
    const Vec2 out{kWavesCentre.x + kWavesStartRadius * 2.0, kWavesCentre.y};
    const Vec2 kept = terrain.clampInside(out, 25.0, kWavesRealm);
    CHECK(std::abs(distance(kept, kWavesCentre) - (kWavesStartRadius - 25.0)) < 1e-6);
    const auto pushed = terrain.resolveWall(out, 25.0, kWavesRealm);
    CHECK(pushed.collided);
    CHECK(distance(pushed.position, kWavesCentre) <= kWavesStartRadius);
    CHECK(!terrain.segmentBlocked(kWavesCentre, {kWavesCentre.x + 1000.0, kWavesCentre.y}, kWavesRealm));
    Rng rng(23);
    for (int i = 0; i < 50; ++i) {
        CHECK(distance(terrain.findOpenSpawn(rng, kWavesCentre, kWavesStartRadius * 3.0, kWavesRealm),
                       kWavesCentre) <= kWavesStartRadius);
    }
    CHECK_EQ(terrain.realmExtent(kWavesRealm).x, kWavesWorldSize);

    // Grown, the same questions answer for the bigger disc, in the same space.
    terrain.wavesRadius = 3000.0;
    CHECK(!terrain.blocked({kWavesCentre.x + 2000.0, kWavesCentre.y}, kWavesRealm));
    CHECK(terrain.blocked({kWavesCentre.x + 3001.0, kWavesCentre.y}, kWavesRealm));
    CHECK(std::abs(distance(terrain.clampInside(out, 25.0, kWavesRealm), kWavesCentre) - 2975.0) < 1e-6);
    CHECK_EQ(terrain.realmExtent(kWavesRealm).x, kWavesWorldSize);
    terrain.wavesRadius = kWavesMaxRadius;
    CHECK(!terrain.blocked({kWavesCentre.x, kWavesCentre.y - kWavesMaxRadius + 1.0}, kWavesRealm));
    CHECK(kWavesCentre.y - kWavesMaxRadius > 0.0);
}

TEST(a_mob_stays_inside_the_disc_grid_as_well) {
    Terrain terrain;
    SpatialGrid grid;
    grid.sizeToRealms(terrain);
    grid.clear();
    World world;
    const Entity mob = world.create();
    grid.insert(mob, kWavesRealm, kWavesCentre, 25.0);
    std::vector<Entity> found;
    grid.query(kWavesRealm, kWavesCentre, 50.0, found);
    CHECK_EQ(found.size(), std::size_t(1));
    found.clear();
    grid.query(Realm::Overworld, kWavesCentre, 50.0, found);
    CHECK(found.empty());
}

// -- the rift ---------------------------------------------------------------

TEST(start_waves_opens_a_black_rift_everyone_hears_about) {
    Harness h("waves-open", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));

    // No account of a player's gets to.
    CHECK(say(h, alice, "/admin start_waves"));
    CHECK(!alice.rift().open);
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);

    const Vec2 was = h.server.world().get<Transform>(bodyOf(h, "boss")).position;
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.rift().open && heardRiftLine(alice); }));
    CHECK(boss.rift().open);
    CHECK(heardRiftLine(boss));
    CHECK(alice.rift().realm == h.server.world().get<Transform>(bodyOf(h, "boss")).realm);
    CHECK(alice.rift().radius > 0.0);
    // In front of the admin rather than under them: they are not pulled in.
    CHECK(distance(alice.rift().position, was) > kTeleporterSuctionRadius);
    h.step(120, {&boss, &alice});
    CHECK(boss.view().realm() != kWavesRealm);
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Open);

    // One at a time.
    const Vec2 first = alice.rift().position;
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK_EQ(alice.rift().position.x, first.x);

    // A flower arriving later is told too.
    NetClient bob;
    CHECK(playing(h, bob, "bob"));
    CHECK(bob.rift().open);
}

TEST(only_tier_1_and_the_owner_manage_wave_rooms) {
    Harness h("waves-tier", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, owner, tier2, tier3, tier4;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, owner, "owner"));
    CHECK(playing(h, tier2, "tier2"));
    CHECK(playing(h, tier3, "tier3"));
    CHECK(playing(h, tier4, "tier4"));
    std::vector<NetClient*> all{&boss, &owner, &tier2, &tier3, &tier4};

    // Tiers 2-4 open nothing, and are told why. Tier 3 can spawn mobs, so
    // this is a power of its own, not spawning's.
    for (NetClient* lower : {&tier2, &tier3, &tier4}) {
        CHECK(say(h, *lower, "/admin start_waves"));
        CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
        CHECK(sawText(*lower, "admins cannot manage wave rooms (tier 1 only)."));
    }

    // Nor do they close one a tier 1 admin opened.
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Open);
    for (NetClient* lower : {&tier2, &tier3, &tier4}) {
        CHECK(say(h, *lower, "/admin stop_waves"));
        CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Open);
    }

    // The owner closes and opens like tier 1.
    CHECK(say(h, owner, "/admin stop_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
    CHECK(say(h, owner, "/admin start_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Open);
    CHECK(h.stepUntil(all, [&] { return tier2.rift().open; }));
}

TEST(a_rift_only_opens_on_a_map) {
    Harness h("waves-map-only", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss", kMazeSpawnChoice));
    CHECK(boss.view().realm() == Realm::Maze);
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
}

TEST(start_waves_reads_its_biome_and_starting_wave) {
    Harness h("waves-args", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    for (const char* bad : {"/admin start_waves lava", "/admin start_waves garden 0",
                            "/admin start_waves garden 5 6", "/admin start_waves 99999"}) {
        CHECK(say(h, boss, bad));
        CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
    }
    CHECK(say(h, boss, "/admin start_waves DESERT 12"));
    CHECK(GameServerPeer::waves(h.server).biome == WaveBiome::Desert);
    CHECK_EQ(GameServerPeer::waves(h.server).startWave, 12);
    CHECK(say(h, boss, "/admin stop_waves"));
    CHECK(say(h, boss, "/admin start_waves 7"));
    CHECK(GameServerPeer::waves(h.server).biome == WaveBiome::Garden);
    CHECK_EQ(GameServerPeer::waves(h.server).startWave, 7);
}

TEST(standing_on_the_rift_takes_a_flower_to_the_disc_and_starts_the_first_wave) {
    Harness h("waves-enter", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.rift().open; }));

    // Not from the suction's edge alone, and not until it has charged a second.
    const Entity body = bodyOf(h, "alice");
    Transform& at = h.server.world().get<Transform>(body);
    const Vec2 rift = alice.rift().position;
    at.position = rift;
    h.step(5, {&boss, &alice});
    CHECK(alice.view().realm() != kWavesRealm);
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Open);
    CHECK((h.server.world().get<TeleporterState>(body).chargingRift));

    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.view().realm() == kWavesRealm; }, 200));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Playing);
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.wave().known; }));
    CHECK_EQ(alice.wave().wave, 1);
    CHECK(alice.wave().phase == WavePhase::Playing);
    CHECK(alice.wave().biome == WaveBiome::Garden);
    const Vec2 arrived = h.server.world().get<Transform>(body).position;
    CHECK(distance(arrived, kWavesCentre) <= h.server.terrain().wavesRadius);
    // The rift stays for whoever else is on the way.
    CHECK(boss.rift().open);
    // Nobody else is taken along.
    CHECK(boss.view().realm() != kWavesRealm);

    // Mobs come, on the disc, clear of the flower, and the HUD is told of them.
    immortal(h, "alice");
    CHECK(h.stepUntil({&boss, &alice}, [&] { return mobsOnTheDisc(h.server.world()) > 0; }, 200));
    {
        Query<MobTag, Transform> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&, Transform& mob) {
            if (mob.realm != kWavesRealm) return;
            CHECK(distance(mob.position, kWavesCentre) <= h.server.terrain().wavesRadius);
            CHECK(distance(mob.position, arrived) >= kWaveSpawnSafety);
        });
    }
    CHECK(h.stepUntil({&boss, &alice}, [&] { return !alice.wave().groups.empty(); }, 100));
}

TEST(the_disc_grows_each_wave_and_a_new_game_starts_small) {
    Harness h("waves-grow", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 20"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    const Terrain& terrain = h.server.terrain();
    // From the start, at the starting wave's size.
    CHECK_EQ(terrain.wavesRadius, waveRadius(20));
    CHECK(h.stepUntil({&boss}, [&] { return boss.wave().known && boss.wave().radius == waveRadius(20); }));
    CHECK_EQ(boss.terrain().wavesRadius, waveRadius(20));

    // A flower standing at the old edge is where it was after the disc grows.
    const Entity body = bodyOf(h, "boss");
    World& world = h.server.world();
    const Vec2 edge{kWavesCentre.x + waveRadius(20) - 30.0, kWavesCentre.y};
    world.get<Transform>(body).position = edge;
    GameServerPeer::endThisWave(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 21; }, 20));
    CHECK_EQ(terrain.wavesRadius, waveRadius(21));
    CHECK(distance(world.get<Transform>(body).position, edge) < 50.0);
    CHECK(h.stepUntil({&boss}, [&] { return boss.wave().radius == waveRadius(21); }));
    // And it can walk out into the new ground.
    CHECK(!terrain.blocked({kWavesCentre.x + waveRadius(21) - 10.0, kWavesCentre.y}, kWavesRealm));

    // The next game starts at its own starting size again.
    CHECK(say(h, boss, "/admin stop_waves"));
    CHECK_EQ(terrain.wavesRadius, kWavesStartRadius);
    CHECK(h.stepUntil({&boss}, [&] { return boss.view().realm() != kWavesRealm; }));
    CHECK(say(h, boss, "/admin start_waves garden 3"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    CHECK_EQ(terrain.wavesRadius, waveRadius(3));
    CHECK(h.stepUntil({&boss}, [&] { return boss.wave().radius == waveRadius(3); }));
}

TEST(a_wave_goes_red_over_a_crowd_then_ends_whatever_is_left) {
    Harness h("waves-red", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 10"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.mobs > kWaveRedMobCount; }, 600));

    run.timer = waveLength(run.wave);
    h.step(10, {&boss});
    CHECK(run.red);
    CHECK_EQ(run.wave, 10);
    CHECK(run.redTimer > 0.0);
    // Red is a clock for clearing the disc: nothing new joins it.
    const int points = run.spawner.points();
    h.step(120, {&boss});
    CHECK_EQ(run.spawner.points(), points);
    CHECK(h.stepUntil({&boss}, [&] { return boss.wave().redTimer > 0.0; }));

    run.redTimer = waveLength(run.wave);
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 11; }, 20));
    CHECK(!run.red);
    CHECK_EQ(run.redTimer, 0.0);
    CHECK(run.timer < 1.0);
    CHECK_EQ(run.spawner.points() > 0, true);
}

TEST(a_wave_lasts_its_length_in_real_seconds) {
    // Wave 30, where the length has grown past the minute.
    Harness h("waves-real-time", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 30"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    const double length = waveLength(30);
    CHECK(length > 60.0);
    const double started = h.clock;
    const int budget = static_cast<int>((length + 10.0) * 1000.0 / net::kTickMillis);
    CHECK(h.stepUntil({&boss}, [&] { return run.timer >= length; }, budget));
    CHECK(std::abs((h.clock - started) / 1000.0 - length) < 0.5);
    // Still wave 30, and the crowd it left puts it on the red clock.
    h.step(10, {&boss});
    CHECK_EQ(run.wave, 30);
    CHECK(run.red);
}

TEST(a_wave_does_not_end_early_while_it_still_has_mobs_to_come) {
    Harness h("waves-not-early", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    // The disc starts empty, which must not read as cleared.
    CHECK(!run.spawner.finished());
    bool stayed = true;
    CHECK(h.stepUntil({&boss}, [&] {
        stayed = stayed && run.wave == 1;
        return run.spawner.finished() && !run.spawnedSinceSurvey;
    }, 600));
    CHECK(stayed);
    CHECK_EQ(run.wave, 1);
    CHECK(run.mobs > kWaveClearedMobCount);
}

TEST(clearing_a_wave_starts_the_next_at_once_and_gets_the_dead_up) {
    Harness h("waves-cleared", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    std::vector<NetClient*> all{&boss, &alice};
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil(all, [&] { return boss.rift().open && alice.rift().open; }));
    CHECK(throughTheRift(h, all, boss, "boss"));
    CHECK(throughTheRift(h, all, alice, "alice"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil(all, [&] { return run.spawner.finished() && !run.spawnedSinceSurvey; }, 600));
    kill(h, "alice");
    CHECK(h.stepUntil(all, [&] { return alice.dead(); }));
    CHECK_EQ(run.wave, 1);

    killMobsLeaving(h, 0);
    // A survey's worth of ticks, a fifth of a second, and no more.
    CHECK(h.stepUntil(all, [&] { return run.wave == 2; },
                      static_cast<int>(400.0 / net::kTickMillis) + 2));
    CHECK(run.timer < 1.0);
    CHECK(!run.red);
    CHECK(h.stepUntil(all, [&] { return !alice.dead(); }, 30));
}

TEST(two_mobs_left_ends_a_wave_and_three_do_not) {
    Harness h("waves-two-left", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.spawner.finished() && !run.spawnedSinceSurvey; }, 600));

    // Across the disc from the flower, so nothing wears the three down by contact.
    killMobsLeaving(h, 3);
    const Vec2 flower = h.server.world().get<Transform>(bodyOf(h, "boss")).position;
    const Vec2 far = kWavesCentre + (kWavesCentre - flower);
    {
        Query<MobTag, Transform> mobs{h.server.world()};
        mobs.without<Dead>();
        mobs.each([&](Entity, MobTag&, Transform& at) {
            if (at.realm == kWavesRealm) at.position = far;
        });
    }
    h.step(static_cast<int>(1000.0 / net::kTickMillis), {&boss});
    CHECK_EQ(run.mobs, 3);
    CHECK_EQ(run.wave, 1);

    killMobsLeaving(h, 2);
    h.step(1, {&boss});
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 2; },
                      static_cast<int>(400.0 / net::kTickMillis) + 2));
}

TEST(the_hud_counts_each_kind_and_rarity_left_on_the_disc) {
    Harness h("waves-hud-counts", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.spawner.finished() && !run.spawnedSinceSurvey; }, 600));
    const std::uint16_t rock = content().mobIndex("rock");
    CHECK(rock != kInvalidIndex);
    if (rock == kInvalidIndex) return;

    // Rocks stand still, across the disc out of the flower's reach, so the
    // count holds still too. Three of one rarity and one of another: two tiles,
    // and the three must read x3, not x0 or x1.
    World& world = h.server.world();
    SpawnSystem& spawner = GameServerPeer::spawning(h.server);
    const Vec2 flower = world.get<Transform>(bodyOf(h, "boss")).position;
    Vec2 away = kWavesCentre - flower;
    const double length = std::hypot(away.x, away.y);
    away = length > 1.0 ? away * (1.0 / length) : Vec2{1.0, 0.0};
    std::set<Entity> placed;
    const auto place = [&](Rarity rarity, double along) {
        const Vec2 at = kWavesCentre + away * 1100.0 + Vec2{-away.y, away.x} * along;
        const Entity e = spawner.spawnMob(world, h.server.terrain(), content(), rock, rarity, at,
                                          kWavesRealm, h.clock, h.probeRng);
        CHECK(e != NULL_ENTITY);
        placed.insert(e);
    };
    place(Rarity::Rare, -300.0);
    place(Rarity::Rare, 0.0);
    place(Rarity::Rare, 300.0);
    place(Rarity::Epic, 600.0);
    // Everything else on the disc goes, leaving four: more than the early end's two.
    {
        std::vector<Entity> others;
        Query<MobTag, Transform> mobs{world};
        mobs.without<Dead>();
        mobs.each([&](Entity e, MobTag&, Transform& at) {
            if (at.realm == kWavesRealm && placed.count(e) == 0) others.push_back(e);
        });
        for (const Entity e : others) world.add<Dead>(e, Dead{NULL_ENTITY});
    }

    const auto countOf = [&](Rarity rarity) -> int {
        for (const auto& group : boss.wave().groups) {
            if (group.mobIndex == rock && group.rarity == rarity) return group.count;
        }
        return -1;
    };
    CHECK(h.stepUntil({&boss}, [&] { return boss.wave().groups.size() == 2; },
                      static_cast<int>(2000.0 / net::kTickMillis)));
    CHECK_EQ(countOf(Rarity::Rare), 3);
    CHECK_EQ(countOf(Rarity::Epic), 1);
    CHECK_EQ(run.mobs, 4);
    CHECK_EQ(run.wave, 1);
}

TEST(clearing_a_red_wave_ends_it_though_mobs_were_still_to_come) {
    // A high wave's disc fills before its budget is spent, and the rest waits
    // for room. Red spawns nothing, so a cleared red disc is a cleared wave.
    Harness h("waves-red-cleared", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 10"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.mobs > kWaveRedMobCount; }, 600));
    CHECK(!run.spawner.finished());

    run.timer = waveLength(run.wave);
    h.step(10, {&boss});
    CHECK(run.red);
    CHECK(run.spawner.finished());
    killMobsLeaving(h, 0);
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 11; },
                      static_cast<int>(400.0 / net::kTickMillis) + 2));
    CHECK(!run.red);
    CHECK(run.redTimer < 1.0);
}

TEST(a_hostile_wave_mob_hunts_a_flower_from_across_a_grown_disc) {
    // Wave 60's disc reaches 4450 from the middle: the far side is further from
    // the flower than any mob notices one in the wild, and than the radius the
    // AI slows to a fifth past.
    Harness h("waves-hunter", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 60"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    World& world = h.server.world();
    Entity hunter = NULL_ENTITY;
    CHECK(h.stepUntil({&boss}, [&] {
        Query<MobTag, Transform, MobAi> mobs{world};
        mobs.without<Dead, BodySegment>();
        mobs.each([&](Entity e, MobTag&, Transform& at, MobAi& ai) {
            if (hunter == NULL_ENTITY && at.realm == kWavesRealm && ai.kind == AiKind::Hostile) {
                hunter = e;
            }
        });
        return hunter != NULL_ENTITY;
    }, 300));
    if (hunter == NULL_ENTITY) return;

    const Entity flower = bodyOf(h, "boss");
    const Vec2 me = world.get<Transform>(flower).position;
    const Vec2 out = kWavesCentre - me;   // a flower arrives at least halfway out
    const Vec2 far = kWavesCentre + out * ((h.server.terrain().wavesRadius - 300.0) / out.length());
    world.get<Transform>(hunter).position = far;
    world.get<MobAi>(hunter).target = NULL_ENTITY;
    const double before = distance(far, me);
    CHECK(before > kMobActiveRadius);

    h.step(static_cast<int>(3000.0 / net::kTickMillis), {&boss});
    CHECK(world.isAlive(hunter));
    if (!world.isAlive(hunter)) return;
    CHECK(world.get<MobAi>(hunter).target == flower);
    const Vec2 now = world.get<Transform>(flower).position;
    CHECK(distance(world.get<Transform>(hunter).position, now) < before - 300.0);
}

TEST(on_a_grown_disc_wave_mobs_spawn_evenly_over_it) {
    // Wave 60's disc reaches 4450 from the middle. Mobs land all over it, not
    // in a ring around the flower: half of them in the outer half of its area.
    Harness h("waves-spawn-even", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 60"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    World& world = h.server.world();
    const Entity flower = bodyOf(h, "boss");
    const double flowerRadius = world.get<Body>(flower).radius;
    const double inside = h.server.terrain().wavesRadius - kWaveSpawnSafety;
    std::set<Entity> seen;
    int checked = 0;
    int outerHalf = 0;
    int farFromFlower = 0;
    for (int tick = 0; tick < 900 && checked < 60; ++tick) {
        h.step(1, {&boss});
        const Vec2 me = world.get<Transform>(flower).position;
        Query<MobTag, Transform, MobType> mobs{world};
        mobs.without<Dead>();
        mobs.each([&](Entity e, MobTag&, Transform& at, MobType& type) {
            if (at.realm != kWavesRealm || !seen.insert(e).second) return;
            // A chain's tail trails its head; the head is where it was placed.
            const BodySegment* link = world.tryGet<BodySegment>(e);
            if (link != nullptr && !link->head) return;
            ++checked;
            const double mobRadius = content().mobStats(type.configIndex, type.rarity).radius;
            // A tick of walking either way, and a shove from the crowd.
            CHECK(distance(at.position, kWavesCentre) <= inside + 100.0);
            CHECK(distance(at.position, me) >= kWaveSpawnSafety + flowerRadius + mobRadius - 100.0);
            if (distance(at.position, kWavesCentre) > inside / std::sqrt(2.0)) ++outerHalf;
            if (distance(at.position, me) > 3000.0) ++farFromFlower;
        });
    }
    CHECK(checked >= 40);
    CHECK(outerHalf * 4 >= checked);
    CHECK(outerHalf * 4 <= checked * 3);
    CHECK(farFromFlower * 5 >= checked);
}

TEST(a_handful_left_at_the_bell_goes_straight_to_the_next_wave) {
    Harness h("waves-handful", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil({&boss}, [&] { return run.spawner.finished() && !run.spawnedSinceSurvey; }, 600));
    killMobsLeaving(h, kWaveRedMobCount);
    CHECK(h.stepUntil({&boss}, [&] { return run.mobs == kWaveRedMobCount; }, 30));
    CHECK_EQ(run.wave, 1);
    run.timer = waveLength(run.wave);
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 2; }, 20));
    CHECK(!run.red);
}

TEST(the_early_end_waits_for_a_count_that_has_seen_the_last_spawn) {
    Harness h("waves-fresh-count", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    // A last spawn just placed, the survey that would count its bodies not yet
    // run: a low number here means nothing.
    run.spawner = WaveSpawner{};
    run.mobs = 1;
    run.spawnedSinceSurvey = true;
    run.nextSurveyMillis = 1e15;
    h.step(10, {&boss});
    CHECK_EQ(run.wave, 1);
    run.spawnedSinceSurvey = false;
    CHECK(h.stepUntil({&boss}, [&] { return run.wave == 2; }, 10));
}

TEST(the_dead_watch_until_the_next_wave_gets_them_up_beside_a_survivor) {
    Harness h("waves-revive", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.rift().open && boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss, &alice}, alice, "alice"));
    CHECK(throughTheRift(h, {&boss, &alice}, boss, "boss"));
    immortal(h, "boss");
    World& world = h.server.world();

    kill(h, "alice");
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.dead(); }));
    // Still in the game, and not on a game over: somebody is standing.
    CHECK(alice.view().realm() == kWavesRealm);
    h.step(10, {&boss, &alice});
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Playing);

    // The camera moves on to the nearest thing still up.
    const Entity body = bodyOf(h, "alice");
    const Session* session = GameServerPeer::sessionOf(h.server, "alice");
    CHECK(h.stepUntil({&boss, &alice}, [&] { return session->waveSpectating != NULL_ENTITY; }, 120));
    h.step(2, {&boss, &alice});
    if (world.isAlive(session->waveSpectating)) {
        CHECK(distance(world.get<Transform>(body).position,
                       world.get<Transform>(session->waveSpectating).position) < 200.0);
    }

    const Vec2 standing = world.get<Transform>(bodyOf(h, "boss")).position;
    GameServerPeer::endThisWave(h.server);
    CHECK(h.stepUntil({&boss, &alice}, [&] { return !alice.dead(); }, 30));
    CHECK(!world.has<Dead>(body));
    CHECK_EQ(world.get<Health>(body).current, world.get<Health>(body).max);
    CHECK(distance(world.get<Transform>(body).position, standing) <= kWaveReviveDistance + 80.0);
    CHECK_EQ(GameServerPeer::waves(h.server).wave, 2);
    CHECK(session->waveSpectating == NULL_ENTITY);

    // And it can die again: the death is reported a second time.
    kill(h, "alice");
    CHECK(h.stepUntil({&boss, &alice}, [&] { return alice.dead(); }));
}

TEST(nobody_standing_closes_the_room_and_brings_everyone_back) {
    Harness h("waves-over", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice, bob;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    CHECK(playing(h, bob, "bob"));
    std::vector<NetClient*> all{&boss, &alice, &bob};
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil(all, [&] { return boss.rift().open && alice.rift().open; }));
    const Realm home = alice.rift().realm;
    const Vec2 rift = alice.rift().position;
    CHECK(throughTheRift(h, all, boss, "boss"));
    CHECK(throughTheRift(h, all, alice, "alice"));
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil(all, [&] { return mobsOnTheDisc(h.server.world()) > 0; }, 200));

    // One down is not the end.
    kill(h, "alice");
    CHECK(h.stepUntil(all, [&] { return alice.dead(); }));
    h.step(10, all);
    CHECK(run.phase == WavePhase::Playing);

    kill(h, "boss");
    CHECK(h.stepUntil(all, [&] { return run.phase == WavePhase::Idle; }, 30));
    CHECK(h.stepUntil(all, [&] { return !bob.rift().open && !boss.rift().open; }));
    CHECK(h.stepUntil(all, [&] {
        return alice.view().realm() == home && boss.view().realm() == home && !alice.dead() &&
               !boss.dead();
    }));
    World& world = h.server.world();
    CHECK(distance(world.get<Transform>(bodyOf(h, "alice")).position, rift) < kTileSize * 2.0);
    CHECK(!world.has<Dead>(bodyOf(h, "boss")));
    bool told = false;
    for (const auto& line : alice.chat()) {
        if (line.text.find("You reached wave 1") != std::string::npos) told = true;
    }
    CHECK(told);
    h.step(5, all);
    CHECK_EQ(mobsOnTheDisc(world), 0);
    // Which leaves the server free to open another.
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(run.phase == WavePhase::Open);
}

TEST(everyone_walking_out_leaves_the_rift_open_for_the_next_arrival) {
    Harness h("waves-empty", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    std::vector<NetClient*> all{&boss, &alice};
    CHECK(say(h, boss, "/admin start_waves garden 5"));
    CHECK(h.stepUntil(all, [&] { return alice.rift().open; }));
    CHECK(throughTheRift(h, all, alice, "alice"));
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil(all, [&] { return mobsOnTheDisc(h.server.world()) > 0; }, 200));
    run.wave = 9;

    alice.leaveGame();
    CHECK(h.stepUntil(all, [&] { return run.phase == WavePhase::Open; }, 60));
    h.step(5, all);
    CHECK_EQ(mobsOnTheDisc(h.server.world()), 0);
    CHECK(boss.rift().open);
    CHECK_EQ(run.wave, 5);
    // Nothing queued in the abandoned game comes through into the next one.
    std::vector<WaveMob> due;
    run.spawner.step(run.biome, run.wave, h.probeRng, due);
    CHECK(due.empty());
}

TEST(stop_waves_brings_everyone_back_where_they_went_in) {
    Harness h("waves-stop", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice, bob;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    CHECK(playing(h, bob, "bob"));
    std::vector<NetClient*> all{&boss, &alice, &bob};
    CHECK(say(h, boss, "/admin stop_waves"));   // nothing to stop
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil(all, [&] { return alice.rift().open && bob.rift().open; }));
    const Realm home = alice.rift().realm;
    const Vec2 rift = alice.rift().position;
    CHECK(throughTheRift(h, all, alice, "alice"));
    CHECK(throughTheRift(h, all, bob, "bob"));
    kill(h, "bob");
    CHECK(h.stepUntil(all, [&] { return bob.dead(); }));
    CHECK(h.stepUntil(all, [&] { return mobsOnTheDisc(h.server.world()) > 0; }, 200));

    // Not for a player to do.
    CHECK(say(h, alice, "/admin stop_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Playing);

    CHECK(say(h, boss, "/admin stop_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
    CHECK(h.stepUntil(all, [&] {
        return alice.view().realm() == home && bob.view().realm() == home && !boss.rift().open;
    }));
    CHECK(h.stepUntil(all, [&] { return !bob.dead(); }));
    World& world = h.server.world();
    CHECK(distance(world.get<Transform>(bodyOf(h, "alice")).position, rift) < kTileSize * 2.0);
    CHECK(!world.has<Dead>(bodyOf(h, "bob")));
    h.step(5, all);
    CHECK_EQ(mobsOnTheDisc(world), 0);
}

TEST(a_full_disc_holds_the_rest_of_the_wave_until_there_is_room) {
    Harness h("waves-full", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    CHECK(say(h, boss, "/admin start_waves garden 260"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.rift().open; }));
    CHECK(throughTheRift(h, {&boss}, boss, "boss"));
    immortal(h, "boss");
    auto& run = GameServerPeer::waves(h.server);
    // Supers fill it in seconds, long before the wave's 2600 points are spent.
    CHECK(h.stepUntil({&boss}, [&] { return run.bodyArea >= kWaveMaxBodyArea; },
                      static_cast<int>(20000.0 / net::kTickMillis)));
    h.step(static_cast<int>(5000.0 / net::kTickMillis), {&boss});
    CHECK(!run.spawner.finished());
    const int owed = run.spawner.points();
    CHECK(owed > 0);
    // Over by no more than the step that filled it.
    CHECK(run.bodyArea < kWaveMaxBodyArea * 1.5);
    CHECK(run.mobs < 300);

    // Make room and the rest comes, not dropped while it waited.
    killMobsLeaving(h, 0);
    CHECK(h.stepUntil({&boss}, [&] { return run.spawner.points() < owed; },
                      static_cast<int>(3000.0 / net::kTickMillis)));
}

TEST(a_super_on_the_disc_is_stock_not_a_boss) {
    Harness h("waves-supers", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    World& world = h.server.world();
    SpawnSystem& spawner = GameServerPeer::spawning(h.server);
    const std::uint16_t hornet = content().mobIndex("hornet");
    CHECK(hornet != kInvalidIndex);
    if (hornet == kInvalidIndex) return;
    const auto defeats = [&] {
        int lines = 0;
        for (const auto& line : boss.chat()) {
            if (line.text.find("has been defeated") != std::string::npos) ++lines;
        }
        return lines;
    };

    spawner.bossSpawns.clear();
    const Entity onDisc = spawner.spawnMob(world, h.server.terrain(), content(), hornet,
                                           Rarity::Super, kWavesCentre, kWavesRealm, h.clock,
                                           h.probeRng);
    CHECK(onDisc != NULL_ENTITY);
    CHECK(spawner.bossSpawns.empty());
    // The same mob on a map is announced, which is what makes the line above mean
    // something.
    const Transform at = world.get<Transform>(bodyOf(h, "boss"));
    const Entity onMap = spawner.spawnMob(world, h.server.terrain(), content(), hornet,
                                          Rarity::Super, at.position + Vec2{900.0, 0.0},
                                          at.realm, h.clock, h.probeRng);
    CHECK(onMap != NULL_ENTITY);
    CHECK(!spawner.bossSpawns.empty());

    const int before = defeats();
    // Through combat's own death pass, which is where kill lines come from: an
    // overwhelming poison, as chat_command_tests kills a super.
    const auto poison = [&](Entity e) {
        if (!world.has<Afflictions>(e)) world.add<Afflictions>(e, Afflictions{});
        world.get<Afflictions>(e).poisonStacks.push_back({NULL_ENTITY, 1e12, 1e18});
    };
    poison(onDisc);
    CHECK(h.stepUntil({&boss}, [&] { return !world.isAlive(onDisc); }, 120));
    h.step(10, {&boss});
    CHECK_EQ(defeats(), before);
    poison(onMap);
    CHECK(h.stepUntil({&boss}, [&] { return defeats() > before; }, 120));
}

TEST(a_unique_or_apex_on_the_disc_is_announced_to_everyone) {
    Harness h("waves-bosses", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    World& world = h.server.world();
    SpawnSystem& spawner = GameServerPeer::spawning(h.server);
    const std::uint16_t hornet = content().mobIndex("hornet");
    CHECK(hornet != kInvalidIndex);
    if (hornet == kInvalidIndex) return;
    const auto heard = [&](const NetClient& client, const std::string& what) {
        int lines = 0;
        for (const auto& line : client.chat()) {
            if (line.text.find(what) != std::string::npos) ++lines;
        }
        return lines;
    };
    const auto poison = [&](Entity e) {
        if (!world.has<Afflictions>(e)) world.add<Afflictions>(e, Afflictions{});
        world.get<Afflictions>(e).poisonStacks.push_back({NULL_ENTITY, 1e12, 1e18});
    };

    // Neither has a biome clock on the disc to wait for, and two of a tier may
    // stand there at once: the one-per-biome cull is the maps'.
    const std::string unique = std::string(rarityLabel(Rarity::Unique)) + " Hornet has ";
    const std::string apex = std::string(rarityLabel(Rarity::Apex)) + " Hornet has ";
    std::vector<Entity> mobs;
    for (const Rarity rarity : {Rarity::Unique, Rarity::Unique, Rarity::Apex}) {
        const double offset = 500.0 * static_cast<double>(mobs.size());
        mobs.push_back(spawner.spawnMob(world, h.server.terrain(), content(), hornet, rarity,
                                        kWavesCentre + Vec2{offset - 500.0, 0.0}, kWavesRealm,
                                        h.clock, h.probeRng));
        CHECK(mobs.back() != NULL_ENTITY);
        if (mobs.back() == NULL_ENTITY) return;
    }
    // Alice is on a map, nowhere near the disc, and still told.
    CHECK(h.stepUntil({&boss, &alice}, [&] {
        return heard(alice, unique + "spawned") == 2 && heard(alice, apex + "spawned") == 1;
    }, 60));
    h.step(static_cast<int>(2000.0 / net::kTickMillis), {&boss, &alice});
    for (const Entity mob : mobs) CHECK(world.isAlive(mob) && !world.has<Dead>(mob));

    for (const Entity mob : mobs) poison(mob);
    CHECK(h.stepUntil({&boss, &alice}, [&] {
        return heard(alice, unique + "been defeated") == 2 && heard(alice, apex + "been defeated") == 1;
    }, 120));
}

TEST(a_unique_on_the_disc_has_ten_times_its_health_and_an_apex_fifty) {
    Harness h("waves-boss-health", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss;
    CHECK(playing(h, boss, "boss"));
    World& world = h.server.world();
    SpawnSystem& spawner = GameServerPeer::spawning(h.server);
    const auto spawnOnDisc = [&](std::uint16_t index, Rarity rarity) {
        return spawner.spawnMob(world, h.server.terrain(), content(), index, rarity, kWavesCentre,
                                kWavesRealm, h.clock, h.probeRng);
    };
    const auto healthOf = [&](Entity e) { return world.get<Health>(e); };

    const std::uint16_t hornet = content().mobIndex("hornet");
    CHECK(hornet != kInvalidIndex);
    if (hornet == kInvalidIndex) return;
    for (const auto& [rarity, scale] : {std::pair{Rarity::Super, 1.0}, std::pair{Rarity::Unique, 10.0},
                                        std::pair{Rarity::Apex, 50.0}}) {
        const Entity mob = spawnOnDisc(hornet, rarity);
        CHECK(mob != NULL_ENTITY);
        if (mob == NULL_ENTITY) continue;
        const double wild = content().mobStats(hornet, rarity).health;
        CHECK(healthOf(mob).max == wild * scale);
        CHECK(healthOf(mob).current == healthOf(mob).max);
    }

    // A chain is one animal: every bead of a unique centipede is ten times too.
    const std::uint16_t centipede = content().mobIndex("centipede");
    CHECK(centipede != kInvalidIndex);
    if (centipede == kInvalidIndex) return;
    const std::uint16_t bead = content().mob(centipede).segmentBodyIndex;
    CHECK(bead != kInvalidIndex);
    const Entity head = spawnOnDisc(centipede, Rarity::Unique);
    CHECK(head != NULL_ENTITY);
    if (head == NULL_ENTITY || bead == kInvalidIndex) return;
    CHECK(healthOf(head).max == content().mobStats(centipede, Rarity::Unique).health * 10.0);
    int beads = 0;
    Query<BodySegment, Health> chain{world};
    chain.each([&](Entity e, BodySegment& link, Health& health) {
        if (link.chainHead != head || e == head) return;
        ++beads;
        CHECK(health.max == content().mobStats(bead, Rarity::Unique).health * 10.0);
    });
    CHECK(beads > 0);
}

// -- the screen -------------------------------------------------------------

TEST(a_black_portal_grows_cracks_and_a_white_one_has_none) {
    // Only the cracks reach past 1.6 radii, so that is where to look.
    constexpr double kRadius = 100.0;
    constexpr int kFrame = 1000;
    const Vec2 at{500.0, 500.0};
    Terrain terrain;
    std::vector<std::uint8_t> cells(16 * 16, static_cast<std::uint8_t>(Tile::Open));
    CHECK(terrain.setTiles(cells, 16, 16, kAdminArenaRealm));
    const auto cracked = [&](const WorldRenderer& renderer, double time) {
        WorldView view;
        view.setRealm(kAdminArenaRealm);
        Canvas canvas = Canvas::createVirtual(kFrame, kFrame);
        renderer.draw(canvas, view, frameCamera(kFrame, at), at, time);
        const auto pixels = canvas.getImageData(0, 0, kFrame, kFrame);
        int dark = 0;
        for (int y = 0; y < kFrame; ++y) {
            for (int x = 0; x < kFrame; ++x) {
                const double dx = x - kFrame * 0.5, dy = y - kFrame * 0.5;
                const double r = std::sqrt(dx * dx + dy * dy);
                if (r < kRadius * 1.7 || r > kRadius * 4.5) continue;
                const auto i = static_cast<std::size_t>(y * kFrame + x) * 4;
                if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 30) ++dark;
            }
        }
        return dark;
    };

    WorldRenderer renderer;
    renderer.setTerrain(&terrain);
    CHECK_EQ(cracked(renderer, 1.0), 0);

    renderer.setRift(true, kAdminArenaRealm, at, kRadius);
    const int opening = cracked(renderer, 10.0);
    const int open = cracked(renderer, 12.0);
    CHECK(open > 100);
    CHECK(open > opening);
    // The same cracks on every frame, not a fresh roll.
    CHECK_EQ(cracked(renderer, 14.0), cracked(renderer, 15.0));

    // On another map it is not here at all.
    renderer.setRift(true, Realm::Overworld, at, kRadius);
    CHECK_EQ(cracked(renderer, 20.0), 0);
}

TEST(the_waves_disc_is_paved_in_its_biome_and_black_outside) {
    const int size = 256;
    const auto sample = [&](WaveBiome biome, Vec2 at, double radius = kWavesStartRadius) {
        WorldRenderer renderer;
        renderer.setWaveBiome(biome);
        renderer.setWaveRadius(radius);
        WorldView view;
        view.setRealm(kWavesRealm);
        Canvas canvas = Canvas::createVirtual(size, size);
        renderer.draw(canvas, view, frameCamera(size, at), at, 0);
        return canvas.getImageData(size / 2, size / 2, 1, 1);
    };
    // No sprites here, so the floor shows the biome's own colour.
    const auto floor = sample(WaveBiome::Desert, kWavesCentre);
    CHECK(floor.size() == 4);
    if (floor.size() != 4) return;
    CHECK_EQ(floor[0], static_cast<std::uint8_t>(waveBiomeInfo(WaveBiome::Desert).gaugeColor >> 16));
    // Past the edge the ground carries on under flooooio's border, black at
    // 15% over it...
    const Vec2 beyond{kWavesCentre.x + kWavesStartRadius + 200.0, kWavesCentre.y};
    const auto outside = sample(WaveBiome::Desert, beyond);
    for (int c = 0; c < 3; ++c) CHECK(std::abs(outside[c] - floor[c] * 0.85) <= 2.0);
    // ...as far as flooooio's ground reaches, 0.875 radii out, and is black past it.
    const auto past = sample(WaveBiome::Desert, {kWavesCentre.x + kWavesStartRadius * 1.95, kWavesCentre.y});
    CHECK_EQ(past[0] + past[1] + past[2], 0);
    // A grown disc is floor, unshaded, out there.
    const auto grown = sample(WaveBiome::Desert, beyond, 3000.0);
    CHECK_EQ(grown[0], floor[0]);
}

TEST(the_pvp_ring_has_the_waves_border) {
    const int size = 64;
    const auto sample = [&](Vec2 at) {
        WorldRenderer renderer;
        WorldView view;
        view.setRealm(Realm::Arena);
        Canvas canvas = Canvas::createVirtual(size, size);
        renderer.draw(canvas, view, frameCamera(size, at), at, 0);
        return canvas.getImageData(size / 2, size / 2, 1, 1);
    };
    // Off the grid lines, so the floor reads as its plain grey.
    const Vec2 inside{kArenaCentre.x + 25.0, kArenaCentre.y + 25.0};
    const Vec2 outside{kArenaCentre.x + 25.0, kArenaCentre.y + kArenaRadius + 225.0};
    const auto floor = sample(inside);
    const auto shaded = sample(outside);
    const auto past = sample({kArenaCentre.x + 25.0, kArenaCentre.y + kArenaRadius * 1.95});
    CHECK(floor.size() == 4 && shaded.size() == 4 && past.size() == 4);
    if (floor.size() != 4 || shaded.size() != 4 || past.size() != 4) return;
    CHECK_EQ(floor[0], std::uint8_t(0x77));
    for (int c = 0; c < 3; ++c) CHECK(std::abs(shaded[c] - floor[c] * 0.85) <= 2.0);
    CHECK_EQ(past[0] + past[1] + past[2], 0);
    // No red ring left at the edge.
    const auto edge = sample({kArenaCentre.x + 25.0, kArenaCentre.y + kArenaRadius});
    CHECK(edge.size() == 4 && std::abs(int(edge[0]) - int(edge[1])) <= 2);
}

TEST(a_dead_flower_on_the_disc_leaves_no_corpse) {
    // Its body is out walking after whatever its player is watching.
    const int size = 256;
    const auto flower = [&](Realm realm) {
        WorldRenderer renderer;
        Terrain terrain;
        std::vector<std::uint8_t> cells(16 * 16, static_cast<std::uint8_t>(Tile::Open));
        terrain.setTiles(cells, 16, 16, kAdminArenaRealm);
        renderer.setTerrain(&terrain);
        WorldView view;
        view.setRealm(realm);
        const Vec2 at = realm == kWavesRealm ? kWavesCentre : Vec2{500.0, 500.0};
        Canvas empty = Canvas::createVirtual(size, size);
        renderer.draw(empty, view, frameCamera(size, at), at, 0);
        const auto before = empty.getImageData(0, 0, size, size);

        RemoteEntity corpse;
        corpse.netId = 7;
        corpse.kind = net::EntityKind::Player;
        corpse.position = at;
        corpse.radius = 25.0;
        corpse.state = net::StateDead;
        view.seedForTest(corpse);
        Canvas drawn = Canvas::createVirtual(size, size);
        renderer.draw(drawn, view, frameCamera(size, at), at, 0);
        return differingPixels(before, drawn.getImageData(0, 0, size, size));
    };
    CHECK(flower(kAdminArenaRealm) > 0);
    CHECK_EQ(flower(kWavesRealm), 0);
}

