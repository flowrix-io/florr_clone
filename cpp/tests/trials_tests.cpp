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
    CHECK_EQ(trialRarity(17), Rarity::Unique);
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

TEST(only_unique_and_apex_trials_refresh) {
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
    CHECK_EQ(trialRewardRarity(20), Rarity::Unique);
    CHECK_EQ(trialFullRewardStars(20), 307546);
    CHECK_EQ(trialFullRewardXp(20), 81920000.0);
    CHECK_EQ(trialFullRewardPetals(20), 20);
    CHECK_EQ(trialRewardRarity(18), Rarity::Unique);
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
