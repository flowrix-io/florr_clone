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

TEST(trial_arena_grows_with_enemy_rarity) {
    CHECK_EQ(trialArenaRadius(1), kTrialArenaRadius);
    CHECK(trialArenaRadius(17) > trialArenaRadius(9));
    CHECK(trialArenaRadius(19) > trialArenaRadius(17));
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
