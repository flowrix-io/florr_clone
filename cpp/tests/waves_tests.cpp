// The wave survival mode: the rules on their own, then the rift, the game and
// its ending through a real server and real sockets, then what the portal and
// the disc put on the screen.

#include <cmath>
#include <set>
#include <string>

#include "client/render/world_renderer.h"
#include "client/ui/text.h"
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
    seedUser(path, "tier4", "password7", true, 4);
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

TEST(a_wave_spends_ten_points_a_wave_on_mobs_the_game_has) {
    for (std::size_t biome = 0; biome < kWaveBiomes.size(); ++biome) {
        Rng rng(7 + biome);
        WaveSpawner spawner;
        spawner.next(static_cast<WaveBiome>(biome), 10, rng);
        CHECK_EQ(spawner.points(), 100);
        CHECK(!spawner.special());
        int mobs = 0;
        for (int step = 0; step < 30 * 120; ++step) {
            if (const auto mob = spawner.step(static_cast<WaveBiome>(biome), 10, rng)) {
                ++mobs;
                CHECK(shippedContent().mobIndex(mob->id) != kInvalidIndex);
            }
        }
        CHECK_EQ(spawner.points(), 0);
        CHECK(mobs > 0);
        CHECK(mobs <= 100);
    }
}

TEST(the_first_wave_holds_only_what_spawns_from_wave_one) {
    Rng rng(11);
    WaveSpawner spawner;
    spawner.next(WaveBiome::Garden, 1, rng);
    std::set<std::string> seen;
    for (int step = 0; step < 30 * 60; ++step) {
        if (const auto mob = spawner.step(WaveBiome::Garden, 1, rng)) seen.insert(mob->id);
    }
    CHECK(!seen.empty());
    for (const std::string& id : seen) CHECK(id == "bee" || id == "baby_ant");
}

TEST(a_special_wave_swarms_with_one_family_on_a_bonus_budget) {
    Rng rng(13);
    WaveSpawner spawner;
    spawner.next(WaveBiome::Garden, 20, rng, 2);   // the hornets
    CHECK(spawner.special());
    CHECK_EQ(spawner.points(), 1200);
    int mobs = 0;
    for (int step = 0; step < 30 * 120; ++step) {
        if (const auto mob = spawner.step(WaveBiome::Garden, 20, rng)) {
            ++mobs;
            CHECK_EQ(std::string(mob->id), std::string("hornet"));
        }
    }
    CHECK_EQ(mobs, 1200);
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

TEST(rarity_climbs_with_the_wave_and_stops_at_mythic) {
    Rng rng(19);
    const auto mean = [&rng](int wave) {
        double total = 0.0;
        for (int i = 0; i < 4000; ++i) total += rarityIndex(rollWaveRarity(wave, rng));
        return total / 4000.0;
    };
    CHECK(mean(1) < 0.5);
    CHECK(mean(10) > mean(1));
    CHECK(mean(30) > mean(10));
    // Past wave 60 only mythic is left. A wave far past what a double can raise
    // 1.3 to must land there too rather than on a NaN.
    for (const int wave : {61, 500, 65535}) {
        for (int i = 0; i < 200; ++i) CHECK(rollWaveRarity(wave, rng) == Rarity::Mythic);
    }
}

TEST(the_waves_realm_is_a_disc_of_open_floor) {
    CHECK(!isWorldRealm(kWavesRealm));
    CHECK(kWavesRealm != kAdminArenaRealm);
    Terrain terrain;
    CHECK(!terrain.blocked(kWavesCentre, kWavesRealm));
    CHECK(terrain.blocked({kWavesCentre.x + kWavesRadius + 1.0, kWavesCentre.y}, kWavesRealm));
    const Vec2 out{kWavesCentre.x + kWavesRadius * 2.0, kWavesCentre.y};
    const Vec2 kept = terrain.clampInside(out, 25.0, kWavesRealm);
    CHECK(std::abs(distance(kept, kWavesCentre) - (kWavesRadius - 25.0)) < 1e-6);
    const auto pushed = terrain.resolveWall(out, 25.0, kWavesRealm);
    CHECK(pushed.collided);
    CHECK(distance(pushed.position, kWavesCentre) <= kWavesRadius);
    CHECK(!terrain.segmentBlocked(kWavesCentre, {kWavesCentre.x + 1000.0, kWavesCentre.y}, kWavesRealm));
    Rng rng(23);
    for (int i = 0; i < 50; ++i) {
        CHECK(distance(terrain.findOpenSpawn(rng, kWavesCentre, kWavesRadius, kWavesRealm),
                       kWavesCentre) <= kWavesRadius);
    }
    CHECK_EQ(terrain.realmExtent(kWavesRealm).x, kWavesWorldSize);
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

TEST(a_tier_that_cannot_spawn_cannot_open_a_rift) {
    Harness h("waves-tier", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient admin;
    CHECK(playing(h, admin, "tier4"));
    CHECK(say(h, admin, "/admin start_waves"));
    CHECK(GameServerPeer::waves(h.server).phase == WavePhase::Idle);
    CHECK(say(h, admin, "/admin stop_waves"));
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
    CHECK(distance(arrived, kWavesCentre) <= kWavesRadius);
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
            CHECK(distance(mob.position, kWavesCentre) <= kWavesRadius);
            CHECK(distance(mob.position, arrived) >= kWaveSpawnSafety);
        });
    }
    CHECK(h.stepUntil({&boss, &alice}, [&] { return !alice.wave().groups.empty(); }, 100));
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

TEST(nobody_standing_is_game_over_and_the_rift_closes) {
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
    CHECK(throughTheRift(h, all, boss, "boss"));
    CHECK(throughTheRift(h, all, alice, "alice"));
    kill(h, "boss");
    kill(h, "alice");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil(all, [&] { return run.phase == WavePhase::Ended; }, 60));
    CHECK(h.stepUntil(all, [&] { return !bob.rift().open && !boss.rift().open; }));
    CHECK(h.stepUntil(all, [&] { return alice.wave().phase == WavePhase::Ended; }));
    // Nobody gets up on a clock that has stopped.
    const int reached = run.wave;
    GameServerPeer::endThisWave(h.server);
    h.step(30, all);
    CHECK_EQ(run.wave, reached);
    CHECK(alice.dead());

    // Leaving is GAME OVER's Continue. The last one out clears the disc.
    boss.leaveGame();
    h.step(20, all);
    CHECK(run.phase == WavePhase::Ended);
    alice.leaveGame();
    CHECK(h.stepUntil(all, [&] { return run.phase == WavePhase::Idle; }, 60));
    h.step(5, all);
    CHECK_EQ(mobsOnTheDisc(h.server.world()), 0);
    // Which leaves the server free to open another.
    boss.joinGame(1000, 800);
    CHECK(h.stepUntil(all, [&] { return boss.status() == NetClient::Status::Playing; }));
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(run.phase == WavePhase::Open);
}

TEST(a_new_rift_clears_what_is_left_of_a_finished_game) {
    Harness h("waves-restart", seedWaves, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient boss, alice;
    CHECK(playing(h, boss, "boss"));
    CHECK(playing(h, alice, "alice"));
    std::vector<NetClient*> all{&boss, &alice};
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(h.stepUntil(all, [&] { return alice.rift().open; }));
    CHECK(throughTheRift(h, all, alice, "alice"));
    kill(h, "alice");
    auto& run = GameServerPeer::waves(h.server);
    CHECK(h.stepUntil(all, [&] { return run.phase == WavePhase::Ended; }, 60));

    // alice is sitting on GAME OVER and never presses Continue.
    CHECK(say(h, boss, "/admin start_waves"));
    CHECK(run.phase == WavePhase::Open);
    CHECK(h.stepUntil(all, [&] { return alice.view().realm() != kWavesRealm; }));
    CHECK(h.stepUntil(all, [&] { return !alice.dead(); }));
    h.step(5, all);
    CHECK_EQ(mobsOnTheDisc(h.server.world()), 0);
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
    CHECK(!run.spawner.step(run.biome, run.wave, h.probeRng).has_value());
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
    const auto sample = [&](WaveBiome biome, Vec2 at) {
        WorldRenderer renderer;
        renderer.setWaveBiome(biome);
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
    const auto outside = sample(WaveBiome::Desert, {kWavesCentre.x + kWavesRadius + 200.0, kWavesCentre.y});
    CHECK_EQ(outside[0] + outside[1] + outside[2], 0);
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
