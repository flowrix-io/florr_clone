#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>
#include <string_view>

#include "shared/game/rarity.h"

namespace flix {

inline constexpr int kTrialFloorsPerRarity = 2;
inline constexpr int kTrialChambersPerFloor = 3;
inline constexpr int kTrialRarityCount = 10; // Common through Apex.
inline constexpr int kTrialFloorCount = kTrialRarityCount * kTrialFloorsPerRarity;
inline constexpr int kTrialPermanentFloorCount = 16; // Common through Super.
inline constexpr double kTrialReviveMillis = 5000.0;
inline constexpr double kTrialIntermissionMillis = 2500.0;
inline constexpr double kTrialArenaRadius = 3600.0;
inline constexpr const char* kTrialsSpawnChoice = "trials";

enum class TrialPhase : std::uint8_t {
    Idle = 0,
    Active,
    Intermission,
    Preparing,
    Complete,
    Failed
};
enum class TrialChallenge : std::uint8_t { Defeat = 0, Timed };
enum class TrialBuffKind : std::uint8_t {
    ProjectileDamage = 0,
    LightningDamage,
    ProjectileCritical,
    Count,
};

inline int trialRarityIndex(int floor) {
    return std::clamp((floor - 1) / kTrialFloorsPerRarity, 0, kTrialRarityCount - 1);
}
inline Rarity trialRarity(int floor) { return static_cast<Rarity>(trialRarityIndex(floor)); }
inline double trialArenaRadius(int floor) {
    // High-tier bodies grow dramatically. Give each rarity more room before
    // the selected mob's exact radius adds any further per-wave expansion.
    return kTrialArenaRadius + trialRarityIndex(floor) * 500.0;
}
inline double trialRewardPower(double base, int floor) {
    double result = 1.0;
    for (int rung = 0; rung < trialRarityIndex(floor); ++rung) result *= base;
    return result;
}
inline double trialRewardFloorMultiplier(int floor) {
    return floor % 2 == 0 ? 1.25 : 1.0;
}
inline int trialBaseRewardStars(int floor) {
    // Star-shop prices grow by rarity too. A linear reward becomes irrelevant
    // at the top of the ladder, so each rarity triples the previous payout.
    return static_cast<int>(25.0 * trialRewardPower(3.0, floor) *
                            trialRewardFloorMultiplier(floor));
}
inline double trialBaseRewardXp(int floor) {
    // XP requirements span many orders of magnitude. Four times per rarity
    // keeps Eternal and Apex trials meaningful to endgame accounts.
    return 500.0 * trialRewardPower(4.0, floor) * trialRewardFloorMultiplier(floor);
}
inline int trialFullRewardStars(int floor) { return trialBaseRewardStars(floor) / 2; }
inline double trialFullRewardXp(int floor) { return trialBaseRewardXp(floor) * 0.5; }
inline Rarity trialRewardRarity(int floor) {
    // Apex petals are too valuable for a repeatable monthly reward. One Apex
    // petal is represented by twenty of the same Eternal petal instead.
    return trialRarity(floor) == Rarity::Apex ? Rarity::Unique : trialRarity(floor);
}
inline int trialRewardPetalMultiplier(int floor) {
    return trialRarity(floor) == Rarity::Apex ? 20 : 1;
}
inline int trialBaseRewardPetals(int floor) {
    return (1 + std::max(1, floor) / 5) * trialRewardPetalMultiplier(floor);
}
inline int trialFullRewardPetals(int floor) { return trialRewardPetalMultiplier(floor); }
inline constexpr std::array<std::string_view, 10> kTrialRewardPetals{
    "basic", "rose", "stinger", "light", "rock",
    "cactus", "lightning", "missile", "jelly", "cutter",
};
inline std::string_view trialRewardPetal(int floor, int season) {
    // An allowlist is intentional: admin, debug, bespoke-source and extreme
    // petals (including C++ and C--) can never enter Trial rewards merely by
    // being added to the general catalogue.
    const int offset = trialRarityIndex(floor) + std::max(0, season);
    return kTrialRewardPetals[static_cast<std::size_t>(offset) % kTrialRewardPetals.size()];
}
inline bool trialIsWaveFloor(int floor) { return floor % 2 == 0; }
inline bool trialIsRefreshing(int floor) { return floor > kTrialPermanentFloorCount; }
inline TrialChallenge trialChallenge(int floor, int chamber) {
    // Apex health makes a clock a loadout check rather than a fair challenge.
    // Its difficulty comes from survival and the deliberate multi-Apex waves.
    if (trialRarity(floor) == Rarity::Apex) return TrialChallenge::Defeat;
    return chamber == 2 ? TrialChallenge::Timed : TrialChallenge::Defeat;
}
inline int trialMobCount(int floor, int chamber) {
    static constexpr int kIntroduction[] = {1, 2, 2};
    static constexpr int kWave[] = {3, 5, 7};
    const int slot = std::clamp(chamber, 1, 3) - 1;
    if (floor == 19) {
        static constexpr int kApexIntroduction[] = {1, 2, 3};
        return kApexIntroduction[slot];
    }
    if (floor == 20) {
        // I: three singles. II: one pair. III: two pairs.
        static constexpr int kApexWave[] = {3, 2, 4};
        return kApexWave[slot];
    }
    return trialIsWaveFloor(floor) ? kWave[slot] : kIntroduction[slot];
}
inline int trialWaveCount(int floor, int chamber) {
    const int slot = std::clamp(chamber, 1, 3) - 1;
    if (floor == 19) return trialMobCount(floor, chamber); // Apexes stay one at a time.
    if (floor == 20) {
        static constexpr int kApexWaves[] = {3, 1, 2};
        return kApexWaves[slot];
    }
    static constexpr int kIntroductionWaves[] = {1, 2, 2};
    static constexpr int kWaveFloorWaves[] = {1, 2, 3};
    return trialIsWaveFloor(floor) ? kWaveFloorWaves[slot] : kIntroductionWaves[slot];
}
inline int trialMobsInWave(int floor, int chamber, int wave) {
    const int waves = trialWaveCount(floor, chamber);
    if (wave < 1 || wave > waves) return 0;
    if (floor == 19 || (floor == 20 && chamber == 1)) return 1;
    if (floor == 20) return 2;
    const int total = trialMobCount(floor, chamber);
    return total / waves + (wave <= total % waves ? 1 : 0);
}
inline double trialThreeStarSeconds(int floor, int chamber) {
    // Harder mobs need more real combat time, but the allowance rises more
    // slowly than their raw health so higher floors remain harder to 3-star.
    static constexpr std::array<double, kTrialRarityCount> kSecondsPerMob{
        4.0, 5.0, 6.0, 8.0, 11.0, 15.0, 21.0, 30.0, 45.0, 70.0,
    };
    const int rarity = trialRarityIndex(floor);
    const int pauses = std::max(0, trialWaveCount(floor, chamber) - 1);
    return 20.0 + trialMobCount(floor, chamber) * kSecondsPerMob[rarity] + pauses * 2.5;
}
inline double trialTimeGraceSeconds(int floor, int chamber) {
    return std::max(15.0, trialThreeStarSeconds(floor, chamber) * 0.20);
}
inline double trialTwoStarSeconds(int floor, int chamber) {
    return trialThreeStarSeconds(floor, chamber) + trialTimeGraceSeconds(floor, chamber);
}
inline double trialOneStarSeconds(int floor, int chamber) {
    return trialThreeStarSeconds(floor, chamber) + trialTimeGraceSeconds(floor, chamber) * 2.0;
}
inline double trialFailureSeconds(int floor, int chamber) {
    return trialThreeStarSeconds(floor, chamber) + trialTimeGraceSeconds(floor, chamber) * 3.0;
}
inline const char* trialBuffLabel(TrialBuffKind buff) {
    switch (buff) {
        case TrialBuffKind::ProjectileDamage: return "Projectile petals deal +20% damage";
        case TrialBuffKind::LightningDamage: return "Lightning damage is increased by 20%";
        case TrialBuffKind::ProjectileCritical:
            return "Projectile hits crit for 1.5x damage once every 4 seconds";
        case TrialBuffKind::Count: break;
    }
    return "No active blessing";
}
inline std::string trialFloorLabel(int floor) {
    return std::string(rarityLabel(trialRarity(floor))) +
           (trialIsWaveFloor(floor) ? " II" : " I");
}

} // namespace flix
