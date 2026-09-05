#pragma once
// The talent tree: what a branch is, what a tier costs, and what it multiplies.
//
// Talent points are DERIVED, never stored: a player has earned one per level
// and spent whatever their tiers cost. Keeping a balance as well is a second
// source of truth that drifts the first time a level-up and a spend race, and
// the refund rule -- "resetting hands back your level in points" -- only makes
// sense if the two were the same number all along.

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

#include "shared/game/rarity.h"

namespace flix {

enum class SkillId : std::uint8_t {
    Damage = 0,
    PetalHealth,
    PlayerHealth,
    Healing,
    Absorbing,
    SecondChance,
    Count,
};

inline constexpr int kSkillCount = static_cast<int>(SkillId::Count);

/// The keys the database and the TypeScript build use. Stored rather than
/// derived from the enum so a reordering here cannot silently rename a saved
/// branch out from under an account.
inline constexpr std::array<const char*, kSkillCount> kSkillKeys = {
    "damage", "petalHealth", "playerHealth", "healingMultiplier", "absorbing", "secondChance",
};

inline constexpr std::array<const char*, kSkillCount> kSkillLabels = {
    "Damage", "Petal Health", "Flower Health", "Healing", "Absorption", "Second Chance",
};

/// One line of what the branch actually does, shown in its tooltip.
inline constexpr std::array<const char*, kSkillCount> kSkillSummaries = {
    "Multiplies the damage your body and petals deal.",
    "Multiplies the health of every equipped petal.",
    "Multiplies your flower's maximum health.",
    "Multiplies healing from petals.",
    "Multiplies XP from absorbed petals.",
    "Survive a killing blow at 1 HP.",
};

/// How many tiers each branch has. Two of them stop short of the full ladder.
inline constexpr std::array<int, kSkillCount> kSkillTiers = {
    kRarityCount, kRarityCount, kRarityCount, 4, kRarityCount, 2,
};

/// What one tier costs in talent points. Steep at the top, so the last tiers
/// are a long-term goal rather than an afternoon's levelling.
inline constexpr std::array<int, kRarityCount> kTierCost = {
    1, 2, 3, 5, 8, 12, 18, 25, 26, 30,
};

/// Second Chance forks off Flower Health and stays locked until that branch
/// reaches rare.
inline constexpr SkillId kSecondChanceParent = SkillId::PlayerHealth;
inline constexpr Rarity kSecondChanceRequirement = Rarity::Rare;

/// What a Second Chance tier buys: the killing blow leaves the flower at 1 HP
/// with this much invulnerability, then locks the talent out for the cooldown.
///
/// Only two tiers, matching kSkillTiers. The reference's tables define common
/// and uncommon and nothing else, and its `if (!duration) return false` makes
/// every higher tier a no-op rather than an extrapolation -- so a tier outside
/// this range must not revive at all.
inline constexpr std::array<double, 2> kSecondChanceDurationMillis = {300.0, 1500.0};
inline constexpr std::array<double, 2> kSecondChanceCooldownMillis = {60000.0, 30000.0};

/// The window and lockout for a tier, or {0, 0} when that tier does nothing.
inline std::array<double, 2> secondChanceEffect(int tier) {
    if (tier < 0 || tier >= static_cast<int>(kSecondChanceDurationMillis.size())) return {0.0, 0.0};
    const std::size_t t = static_cast<std::size_t>(tier);
    return {kSecondChanceDurationMillis[t], kSecondChanceCooldownMillis[t]};
}

/// Applied to the player's own numbers: max health, body damage, petal health.
/// A gentle curve -- these compound with level and with petal modifiers.
inline constexpr std::array<double, kRarityCount> kStatSkillScale = {
    1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9,
};

/// Applied to petal EFFECTS: healing output. Steeper than the stat curve.
inline constexpr std::array<double, kRarityCount> kEffectSkillScale = {
    1.0, 1.1, 1.2, 1.35, 1.6, 2.0, 2.6, 3.3, 4.0, 4.8,
};

/// Applied to absorbed-petal XP. Geometric, so apex lands on exactly 8x.
inline constexpr std::array<double, kRarityCount> kAbsorbSkillScale = {
    1.0, 1.26, 1.59, 2.0, 2.52, 3.17, 4.0, 5.04, 6.35, 8.0,
};

/// `tier` is a rarity index, or -1 for a branch never touched. Out-of-range
/// tiers read as neutral rather than clamping, because the only way to get one
/// is a corrupt record, and a corrupt record must not grant a bonus.
inline double scaleAt(const std::array<double, kRarityCount>& table, int tier) {
    return (tier >= 0 && tier < kRarityCount) ? table[static_cast<std::size_t>(tier)] : 1.0;
}

/// One account's tree.
struct SkillSet {
    std::array<std::int8_t, kSkillCount> tier{};

    SkillSet() { clear(); }

    void clear() { tier.fill(-1); }

    int level(SkillId id) const { return tier[static_cast<std::size_t>(id)]; }
    void set(SkillId id, int t) { tier[static_cast<std::size_t>(id)] = static_cast<std::int8_t>(t); }

    /// Points already committed to the tree: every tier up to and including
    /// the one bought, on every branch.
    int spent() const {
        int total = 0;
        for (int s = 0; s < kSkillCount; ++s) {
            for (int t = 0; t <= tier[static_cast<std::size_t>(s)] && t < kRarityCount; ++t) {
                total += kTierCost[static_cast<std::size_t>(t)];
            }
        }
        return total;
    }

    double statScale(SkillId id) const { return scaleAt(kStatSkillScale, level(id)); }
    double effectScale(SkillId id) const { return scaleAt(kEffectSkillScale, level(id)); }

    /// True when Second Chance's prerequisite is satisfied.
    bool secondChanceUnlocked() const {
        return level(kSecondChanceParent) >= rarityIndex(kSecondChanceRequirement);
    }
};

/// Points available: one per level, less what the tree already holds. Clamped
/// at zero so a rebalance that raises a tier cost can never mint negative TP.
inline int availableTalentPoints(int level, const SkillSet& skills) {
    const int free = level - skills.spent();
    return free > 0 ? free : 0;
}

/// Resolves a database key. Returns SkillId::Count for anything unknown, which
/// is how an older record's retired branch is ignored rather than misapplied.
inline SkillId skillFromKey(const std::string& key) {
    for (int i = 0; i < kSkillCount; ++i) {
        if (key == kSkillKeys[static_cast<std::size_t>(i)]) return static_cast<SkillId>(i);
    }
    return SkillId::Count;
}

inline int skillTierCount(SkillId id) {
    const std::size_t i = static_cast<std::size_t>(id);
    return i < kSkillTiers.size() ? kSkillTiers[i] : kRarityCount;
}

} // namespace flix
