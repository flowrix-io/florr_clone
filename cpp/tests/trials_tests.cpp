#include "server/systems/loot.h"
#include "server/systems/spawning.h"
#include "shared/game/realm.h"
#include "shared/game/trials.h"
#include "test.h"

using namespace flix;

TEST(trials_have_two_floors_for_every_rarity_through_apex) {
    CHECK_EQ(kTrialFloorCount, 20);
    for (int floor = 1; floor <= kTrialFloorCount; ++floor) {
        CHECK_EQ(rarityIndex(trialRarity(floor)), (floor - 1) / 2);
        CHECK_EQ(trialIsWaveFloor(floor), floor % 2 == 0);
    }
    CHECK_EQ(trialRarity(1), Rarity::Common);
    CHECK_EQ(trialRarity(16), Rarity::Super);
    CHECK_EQ(trialRarity(17), Rarity::Eternal);
    CHECK_EQ(trialRarity(20), Rarity::Apex);
}

TEST(trial_realms_are_private_generated_discs) {
    CHECK_EQ(kTrialRealmCount, 24);
    for (int i = 0; i < kTrialRealmCount; ++i) {
        const Realm realm = trialRealm(i);
        CHECK(isTrialRealm(realm));
        CHECK(isDiscRealm(realm));
        CHECK(!isWorldRealm(realm));
        CHECK_EQ(trialRealmIndex(realm), i);
        CHECK(realm != kWavesRealm);
    }
}

TEST(trial_introduction_floors_are_smaller_than_wave_floors) {
    for (int chamber = 1; chamber <= kTrialChambersPerFloor; ++chamber) {
        CHECK(trialMobCount(1, chamber) < trialMobCount(2, chamber));
    }
    CHECK_EQ(trialMobCount(1, 1), 1);
    CHECK_EQ(trialMobCount(2, 3), 7);
}

TEST(trial_chambers_alternate_death_and_timed_rules) {
    CHECK_EQ(trialChallenge(1, 1), TrialChallenge::Defeat);
    CHECK_EQ(trialChallenge(1, 2), TrialChallenge::Timed);
    CHECK_EQ(trialChallenge(1, 3), TrialChallenge::Defeat);
    CHECK_EQ(trialChallenge(19, 2), TrialChallenge::Defeat);
    CHECK_EQ(trialChallenge(20, 2), TrialChallenge::Defeat);
    CHECK(trialFailureSeconds(20, 2) > trialThreeStarSeconds(20, 2));
}

TEST(trial_chambers_split_their_enemies_into_deliberate_waves) {
    CHECK_EQ(trialWaveCount(1, 2), 2);
    CHECK_EQ(trialMobsInWave(1, 2, 1), 1);
    CHECK_EQ(trialMobsInWave(1, 2, 2), 1);
    CHECK_EQ(trialWaveCount(2, 3), 3);
    CHECK_EQ(trialMobsInWave(2, 3, 1), 3);
    CHECK_EQ(trialMobsInWave(2, 3, 2), 2);
    CHECK_EQ(trialMobsInWave(2, 3, 3), 2);
}

TEST(apex_trial_layout_keeps_the_requested_concurrency) {
    for (int chamber = 1; chamber <= 3; ++chamber) {
        for (int wave = 1; wave <= trialWaveCount(19, chamber); ++wave) {
            CHECK_EQ(trialMobsInWave(19, chamber, wave), 1);
        }
    }
    CHECK_EQ(trialWaveCount(20, 1), 3);
    CHECK_EQ(trialMobsInWave(20, 1, 3), 1);
    CHECK_EQ(trialWaveCount(20, 2), 1);
    CHECK_EQ(trialMobsInWave(20, 2, 1), 2);
    CHECK_EQ(trialWaveCount(20, 3), 2);
    CHECK_EQ(trialMobsInWave(20, 3, 1), 2);
    CHECK_EQ(trialMobsInWave(20, 3, 2), 2);
}

TEST(timed_trial_limits_scale_with_floor_difficulty) {
    CHECK(trialThreeStarSeconds(8, 2) > trialThreeStarSeconds(2, 2));
    CHECK(trialThreeStarSeconds(18, 2) > trialThreeStarSeconds(8, 2));
    CHECK(trialTwoStarSeconds(18, 2) > trialThreeStarSeconds(18, 2));
    CHECK(trialOneStarSeconds(18, 2) > trialTwoStarSeconds(18, 2));
    CHECK(trialFailureSeconds(18, 2) > trialOneStarSeconds(18, 2));
}

TEST(trial_chamber_fits_its_mobs) {
    // A Common-sized body fights in a room about a screen across; bigger bodies and more of them
    // grow it, and the spawn ring always stays inside the disc.
    CHECK(trialChamberRadius(30.0, 1) <= 1200.0);
    CHECK(trialChamberRadius(300.0, 1) > trialChamberRadius(30.0, 1));
    CHECK(trialChamberRadius(1500.0, 2) > trialChamberRadius(300.0, 2));
    CHECK(trialChamberRadius(30.0, 12) > trialChamberRadius(30.0, 1));
    for (double r : {10.0, 100.0, 1000.0}) {
        for (int n : {1, 2, 5, 9}) {
            CHECK(trialSpawnRadius(r, n) + r < trialChamberRadius(r, n));
        }
    }
}

TEST(only_eternal_and_apex_trials_refresh) {
    CHECK(!trialIsRefreshing(16));
    CHECK(trialIsRefreshing(17));
    CHECK(trialIsRefreshing(20));
}

TEST(trial_reward_bundles_scale_with_floor_and_keep_a_separate_full_clear_bonus) {
    CHECK_EQ(trialBaseRewardStars(1), 25);
    CHECK_EQ(trialBaseRewardXp(1), 500.0);
    CHECK_EQ(trialBaseRewardPetals(1), 1);
    CHECK_EQ(trialBaseRewardStars(17), 164025);
    CHECK_EQ(trialBaseRewardXp(17), 32768000.0);
    CHECK_EQ(trialBaseRewardStars(20), 615093);
    CHECK_EQ(trialBaseRewardXp(20), 163840000.0);
    CHECK_EQ(trialBaseRewardPetals(20), 100);
    CHECK_EQ(trialRewardRarity(20), Rarity::Eternal);
    CHECK_EQ(trialFullRewardStars(20), 307546);
    CHECK_EQ(trialFullRewardXp(20), 81920000.0);
    CHECK_EQ(trialFullRewardPetals(20), 20);
    CHECK_EQ(trialRewardRarity(18), Rarity::Eternal);
    CHECK_EQ(trialBaseRewardPetals(18), 4);
    CHECK(trialBaseRewardStars(18) > trialBaseRewardStars(17));
    CHECK(trialBaseRewardXp(19) > trialBaseRewardXp(18));
}

TEST(trial_reward_petals_are_an_explicit_safe_allowlist) {
    for (int floor = 1; floor <= kTrialFloorCount; ++floor) {
        for (int season = 0; season < 20; ++season) {
            const std::string_view petal = trialRewardPetal(floor, season);
            CHECK(petal != "c++");
            CHECK(petal != "c--");
            CHECK(petal != "test_explosive");
            CHECK(petal != "glitch");
        }
    }
}

// ---------------------------------------------------------------------------
// Moving between chambers
// ---------------------------------------------------------------------------

#include "server_harness.h"

TEST(a_new_trial_chamber_plays_the_teleport_iris_and_recentres_the_flower) {
    using namespace flix::testsupport;
    Harness h("trial-teleport",
              [](const std::string& path) {
                  seedUser(path, "trialist", "password7");
                  // The Trial Grounds open only once the secret room is found.
                  Database db;
                  std::string error;
                  db.load(path, error);
                  const Account* account = db.findUser("trialist");
                  if (account == nullptr) return;
                  db.progress(account->id).extra["trialGrounds"]["unlocked"] = true;
                  db.markDirty();
                  db.save();
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "trialist", "password7"));
    client.joinGame(1920, 1080, std::string(kTrialsSpawnChoice) + ":1", "trialist", false);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    Session* session = GameServerPeer::sessionOf(h.server, "trialist");
    if (session == nullptr) { CHECK(false); return; }
    std::remove_reference_t<decltype(GameServerPeer::trials(h.server)[0])>* run = nullptr;
    for (auto& trial : GameServerPeer::trials(h.server)) {
        if (trial.owner == session->connection) run = &trial;
    }
    if (run == nullptr) { CHECK(false); return; }
    // A chamber waits in Preparing until the player presses Start.
    CHECK(run->phase == TrialPhase::Preparing);
    client.startTrialChamber();
    CHECK(h.stepUntil({&client}, [&] { return run->phase == TrialPhase::Active; }, 200));
    CHECK_EQ(run->chamber, 1);
    // Starting the first chamber is no teleport.
    CHECK(!client.takeTeleported());

    // Chamber one cleared, standing off-centre, as stepTrial leaves it.
    World& world = h.server.world();
    run->chamber = 2;
    run->phase = TrialPhase::Intermission;
    run->nextChamberAtMillis = GameServerPeer::clockMillis(h.server) + 1500.0;
    const Vec2 offCentre = kWavesCentre + Vec2{400.0, 0.0};
    world.get<Transform>(session->entity).position = offCentre;

    // The iris is cued while the old room is still up, ahead of the swap by
    // about the time it takes to shut.
    double cuedAt = -1.0;
    CHECK(h.stepUntil({&client}, [&] {
        if (client.takeTeleported()) {
            cuedAt = GameServerPeer::clockMillis(h.server);
            return true;
        }
        return false;
    }, 400));
    CHECK(run->phase == TrialPhase::Intermission);
    CHECK(cuedAt >= run->nextChamberAtMillis - kTrialTeleportLeadMillis - 100.0);

    // Then the new chamber opens with the flower back in the middle, and the
    // client hears no second teleport for it.
    CHECK(h.stepUntil({&client}, [&] { return run->phase == TrialPhase::Active; }, 400));
    CHECK_EQ(run->chamber, 2);
    CHECK(distance(world.get<Transform>(session->entity).position, kWavesCentre) < 50.0);
    h.step(5, {&client});
    CHECK(!client.takeTeleported());
}

TEST(trial_progress_flags_are_stored_as_bitmasks) {
    using namespace flix::testsupport;
    // Floors 1-3 are cleared with 9 stars; floor 1 had everything paid,
    // floor 3 has only its first-clear bundle and the 9-star bonus to come.
    Harness h("trial-masks",
              [](const std::string& path) {
                  seedUser(path, "packer", "password7");
                  Database db;
                  std::string error;
                  db.load(path, error);
                  const Account* account = db.findUser("packer");
                  if (account == nullptr) return;
                  Json root = Json::object();
                  root["season"] = 0;
                  root["unlocked"] = true;
                  root["cleared"] = 0b111;
                  root["claimedReward"] = 0b101;
                  root["fullReward"] = 0b001;
                  Json best = Json::array();
                  for (int i = 0; i < kTrialFloorCount; ++i) best.push(i < 3 ? 9 : 0);
                  root["bestStars"] = std::move(best);
                  db.progress(account->id).extra["trialGrounds"] = std::move(root);
                  db.markDirty();
                  db.save();
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "packer", "password7"));
    CHECK(h.stepUntil({&client}, [&] { return client.trialProgress().known; }, 200));
    CHECK_EQ(client.trialProgress().unlockedFloor, 4);
    CHECK(!client.trialProgress().claimable[0]);
    CHECK(client.trialProgress().claimable[1]);
    CHECK(client.trialProgress().claimable[2]);

    // Claiming floor 3's bonus sets its fullReward bit and nothing else.
    client.claimTrialReward(3);
    CHECK(h.stepUntil({&client}, [&] { return client.trialReward().known; }, 200));
    CHECK(client.trialReward().ok);
    CHECK(client.trialReward().fullBonus);
    Session* session = GameServerPeer::sessionOf(h.server, "packer");
    if (session == nullptr) { CHECK(false); return; }
    const PlayerRecord* record = h.server.database().findProgress(session->userId);
    if (record == nullptr) { CHECK(false); return; }
    const Json& stored = record->extra["trialGrounds"];
    CHECK_EQ(stored["cleared"].asInt(), 0b111);
    CHECK_EQ(stored["claimedReward"].asInt(), 0b101);
    CHECK_EQ(stored["fullReward"].asInt(), 0b101);

    // And it reads back: floor 3 is now fully paid.
    client.claimTrialReward(3);
    CHECK(h.stepUntil({&client}, [&] { return client.trialReward().floor == 3 &&
                                              !client.trialReward().ok; }, 200));
    CHECK_EQ(GameServerPeer::unlockedTrialFloor(h.server, *session), 4);
}

TEST(the_secret_passage_opens_the_trial_room_only_at_the_map_edge) {
    using namespace flix::testsupport;
    Harness h("trial-secret-passage",
              [](const std::string& path) { seedUser(path, "explorer", "password7"); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "explorer", "password7"));
    client.joinGame(1920, 1080, {}, "explorer");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    Session* session = GameServerPeer::sessionOf(h.server, "explorer");
    if (session == nullptr) { CHECK(false); return; }
    World& world = h.server.world();
    Transform& transform = world.get<Transform>(session->entity);
    const Realm garden = transform.realm;

    // The passage is row 3, open from the map's west edge to the ladybug
    // pocket's border; the wall above and below it still blocks.
    const Terrain& terrain = h.server.terrain();
    for (int tx = 0; tx <= 23; ++tx) {
        CHECK(terrain.atTile(tx, 3, garden) == Tile::Open);
        CHECK(terrain.atTile(tx, 2, garden) == Tile::Solid);
    }
    for (int tx = 0; tx <= 20; ++tx) CHECK(terrain.atTile(tx, 4, garden) == Tile::Solid);

    // Walk in from the pocket, through its border, and west to the edge.
    world.get<Health>(session->entity).current = 1e12;
    transform.position = {25.5 * kTileSize, 4.6 * kTileSize};
    std::uint32_t sequence = 0;
    double westmostInGarden = transform.position.x;
    bool teleported = false;
    for (int i = 0; i < 4000 && !teleported; ++i) {
        const Vec2 at = world.get<Transform>(session->entity).position;
        const Vec2 goal = at.x > 23.2 * kTileSize ? Vec2{22.5 * kTileSize, 3.5 * kTileSize}
                                                  : Vec2{-kTileSize, 3.5 * kTileSize};
        net::InputFrame input;
        input.sequence = ++sequence;
        input.moveAngle = std::atan2(goal.y - at.y, goal.x - at.x);
        input.moveStrength = 1.0;
        client.sendInput(input);
        // The ladybug pocket is stocked thick, and a mob in the passage would
        // shove the flower off the line this walk is about. Out of the way.
        Query<MobTag, Transform> mobs{world};
        mobs.each([&](Entity, MobTag&, Transform& mob) {
            if (mob.realm == garden && distance(mob.position, at) < 1500.0) {
                mob.position = {16000.0, 16000.0};
            }
        });
        h.step(1, {&client});
        const Transform& now = world.get<Transform>(session->entity);
        if (now.realm != garden) {
            teleported = true;
            CHECK(westmostInGarden < world.get<Body>(session->entity).radius + 16.0);
        } else {
            westmostInGarden = std::min(westmostInGarden, now.position.x);
            // Only the edge opens the room: the passage's last tile is not
            // enough, the flower's rim must reach x = 0.
            if (now.position.x > world.get<Body>(session->entity).radius + 16.0) {
                CHECK(!GameServerPeer::trialGroundsUnlocked(h.server, *session));
            }
        }
    }
    CHECK(teleported);
    CHECK(westmostInGarden < world.get<Body>(session->entity).radius + 8.0);
    CHECK(GameServerPeer::trialGroundsUnlocked(h.server, *session));
    CHECK(distance(world.get<Transform>(session->entity).position,
                   Vec2{1.5 * kTileSize, 1.5 * kTileSize}) < 50.0);
}

TEST(a_trial_reward_claimed_in_the_world_is_still_on_the_account_after_the_next_tick) {
    using namespace flix::testsupport;
    // The flower holds the live XP and stars, and the record is brought into
    // line with it every tick. A reward paid only onto the record was wiped by
    // the next sync -- or, before the sync ran every tick, by the next save.
    Harness h("trial-reward-in-world",
              [](const std::string& path) {
                  seedUser(path, "claimer", "password7");
                  Database db;
                  std::string error;
                  db.load(path, error);
                  const Account* account = db.findUser("claimer");
                  if (account == nullptr) return;
                  Json root = Json::object();
                  root["season"] = 0;
                  root["unlocked"] = true;
                  root["cleared"] = 0b1;
                  root["claimedReward"] = 0;
                  root["fullReward"] = 0;
                  Json best = Json::array();
                  for (int i = 0; i < kTrialFloorCount; ++i) best.push(i < 1 ? 9 : 0);
                  root["bestStars"] = std::move(best);
                  db.progress(account->id).extra["trialGrounds"] = std::move(root);
                  db.progress(account->id).totalXp = 1000;
                  db.markDirty();
                  db.save();
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "claimer", "password7"));
    client.joinGame(1920, 1080);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    Session* session = GameServerPeer::sessionOf(h.server, "claimer");
    if (session == nullptr) { CHECK(false); return; }
    const PlayerRecord* before = h.server.database().findProgress(session->userId);
    if (before == nullptr) { CHECK(false); return; }
    const double starsBefore = before->stars;  // the login's daily star included

    client.claimTrialReward(1);
    CHECK(h.stepUntil({&client}, [&] { return client.trialReward().known; }, 200));
    CHECK(client.trialReward().ok);
    const double xp = client.trialReward().xp;
    const double stars = client.trialReward().stars;
    CHECK(xp > 0);
    h.step(10, {&client});

    const PlayerRecord* record = h.server.database().findProgress(session->userId);
    if (record == nullptr) { CHECK(false); return; }
    CHECK_NEAR(record->totalXp, 1000.0 + xp, 1e-6);
    CHECK_NEAR(record->stars, starsBefore + stars, 1e-6);
    CHECK_NEAR(client.view().self().totalXp, 1000.0 + xp, 1e-6);
}

TEST(nothing_a_trial_chamber_makes_of_itself_drops_loot_or_fills_the_bag) {
    using namespace flix::testsupport;
    // A pharaoh beetle's mummies and a divider's pieces never went through
    // spawnTrialWave, so they carried no TrialMob and paid drops like any wild
    // mob. Everything in a trial realm is the chamber's now: no drop is made
    // there, any lying there is destroyed, and the bag takes nothing.
    Harness h("trial-no-loot",
              [](const std::string& path) {
                  seedUser(path, "looter", "password7");
                  Database db;
                  std::string error;
                  db.load(path, error);
                  const Account* account = db.findUser("looter");
                  if (account == nullptr) return;
                  db.progress(account->id).extra["trialGrounds"]["unlocked"] = true;
                  db.markDirty();
                  db.save();
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "looter", "password7"));
    client.joinGame(1920, 1080, std::string(kTrialsSpawnChoice) + ":1", "looter", false);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    Session* session = GameServerPeer::sessionOf(h.server, "looter");
    if (session == nullptr) { CHECK(false); return; }
    std::remove_reference_t<decltype(GameServerPeer::trials(h.server)[0])>* run = nullptr;
    for (auto& trial : GameServerPeer::trials(h.server)) {
        if (trial.owner == session->connection) run = &trial;
    }
    if (run == nullptr) { CHECK(false); return; }
    client.startTrialChamber();
    CHECK(h.stepUntil({&client}, [&] { return run->phase == TrialPhase::Active; }, 200));
    CHECK(session->inTrial());

    World& world = h.server.world();
    const Realm realm = run->realm;
    const Entity flower = session->entity;
    const Vec2 here = world.get<Transform>(flower).position;
    const std::uint16_t basic = content().petalIndex("basic");
    const auto bagged = [&] {
        const PlayerRecord* record = h.server.database().findProgress(session->userId);
        return record != nullptr ? record->itemCount(Rarity::Common, "petal_basic") : -1;
    };
    const int before = bagged();
    const double xpBefore = world.get<PlayerProgress>(flower).totalXp;

    // Nothing can be put down in a trial realm.
    LootSystem& loot = GameServerPeer::loot(h.server);
    CHECK(loot.spawnDrop(world, basic, Rarity::Common, here, realm, {flower}) == NULL_ENTITY);

    // One that got there anyway -- made elsewhere and carried in -- is gone
    // the next tick, at the flower's feet, without being picked up.
    const Entity stray =
        loot.spawnDrop(world, basic, Rarity::Common, Vec2{1000.0, 1000.0}, Realm::Overworld, {});
    CHECK(stray != NULL_ENTITY);
    if (stray != NULL_ENTITY) {
        Transform& at = world.get<Transform>(stray);
        at.realm = realm;
        at.position = here;
    }

    // A summon: a mob in the chamber that spawnTrialWave never tagged, killed
    // by the flower with every bit of damage its own.
    const Entity summon = GameServerPeer::spawning(h.server).spawnMob(
        world, h.server.terrain(), content(), content().mobIndex("mummy_beetle"), Rarity::Common,
        here + Vec2{60.0, 0.0}, realm, GameServerPeer::clockMillis(h.server), h.probeRng, false);
    CHECK(summon != NULL_ENTITY);
    CHECK(!world.has<TrialMob>(summon));
    if (summon != NULL_ENTITY) {
        world.get<Bounty>(summon).credit(flower, world.get<Health>(summon).max * 10.0);
        world.get<Health>(summon).current = 0.0;
        world.add<Dead>(summon, Dead{flower});
    }

    // A divider's pieces of a chamber mob are the chamber's too.
    Entity chamberMob = NULL_ENTITY;
    Query<TrialMob> roster{world};
    roster.each([&](Entity e, TrialMob&) { if (chamberMob == NULL_ENTITY) chamberMob = e; });
    CHECK(chamberMob != NULL_ENTITY);
    if (chamberMob != NULL_ENTITY &&
        GameServerPeer::spawning(h.server).divideMob(world, h.server.terrain(), content(),
                                                     chamberMob, 2,
                                                     GameServerPeer::clockMillis(h.server),
                                                     h.probeRng)) {
        int pieces = 0;
        Query<DividedMob> divided{world};
        divided.each([&](Entity e, DividedMob&) {
            ++pieces;
            CHECK(world.has<TrialMob>(e));
        });
        CHECK_EQ(pieces, 2);
    }

    h.step(5, {&client});
    CHECK(!world.isAlive(stray));
    int lying = 0;
    Query<DropTag, Transform> drops{world};
    drops.each([&](Entity, DropTag&, Transform& at) {
        if (at.realm == realm) ++lying;
    });
    CHECK_EQ(lying, 0);
    CHECK_EQ(bagged(), before);
    CHECK_NEAR(world.get<PlayerProgress>(flower).totalXp, xpBefore, 1e-9);
    // The chamber is still on: a summon's death is not a wave cleared.
    CHECK(run->phase == TrialPhase::Active);
}
