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
    Reload,
    SecondChance,
    /// Appended rather than filed beside Petal Health: the wire and the
    /// profile both carry a branch by this index, so a new branch goes on the
    /// end where it cannot renumber one an older build already knows.
    PetHealth,
    /// Two tiers under one id: Duplicator, then Triplicator. One branch rather
    /// than two because the second REPLACES the first -- a tier that is bought
    /// in order and supersedes the one below is exactly what a tier already is,
    /// and the refund, the wire and the "bought in order" rule come with it.
    Duplicator,
    Count,
};

inline constexpr int kSkillCount = static_cast<int>(SkillId::Count);

/// The keys the database and the TypeScript build use. Stored rather than
/// derived from the enum so a reordering here cannot silently rename a saved
/// branch out from under an account.
inline constexpr std::array<const char*, kSkillCount> kSkillKeys = {
    "damage", "petalHealth", "playerHealth", "healingMultiplier", "absorbing", "reload",
    "secondChance", "petHealth", "duplicator",
};

inline constexpr std::array<const char*, kSkillCount> kSkillLabels = {
    "Damage", "Petal Health", "Flower Health", "Healing", "Absorption", "Reload", "Second Chance",
    "Pet Health", "Duplicator",
};

/// One line of what the branch actually does, shown in its tooltip.
inline constexpr std::array<const char*, kSkillCount> kSkillSummaries = {
    "Multiplies the damage your body and petals deal.",
    "Multiplies the health of every equipped petal.",
    "Multiplies your flower's maximum health.",
    "Multiplies healing from petals.",
    "Multiplies XP from absorbed petals.",
    "Shortens every petal cooldown.",
    "Survive a killing blow at 1 HP.",
    "Multiplies the health of every pet you summon.",
    "Adds copies to petals that already have two or more.",
};

/// How many tiers each branch has. Three of them stop short of the full
/// ladder: Reload tops out at unique, with no apex tier to buy. None reaches
/// past the ladder: universal is a petal tier, not a talent one.
inline constexpr std::array<int, kSkillCount> kSkillTiers = {
    kLadderRarityCount, kLadderRarityCount, kLadderRarityCount, 4, kLadderRarityCount,
    rarityIndex(Rarity::Unique) + 1, 2, kLadderRarityCount, 2,
};

/// What one tier costs in talent points. Steep at the top, so the last tiers
/// are a long-term goal rather than an afternoon's levelling.
inline constexpr std::array<int, kLadderRarityCount> kTierCost = {
    1, 2, 3, 5, 8, 12, 18, 25, 26, 30,
};

/// The Duplicator branch is priced on its own: Duplicator 15, Triplicator 20.
/// It sits past a mythic tier, so the ladder's own 1 and 2 would make the
/// strongest node on the tree the cheapest one.
inline constexpr std::array<int, 2> kDuplicatorTierCost = {15, 20};

/// What a tier costs, on the branch it belongs to. Every caller that prices a
/// tier -- the purchase, the refund total, the panel -- asks this rather than
/// indexing kTierCost, so a branch with its own prices cannot be charged at
/// one rate and refunded at another.
inline int skillTierCost(SkillId id, int tier) {
    if (tier < 0) return 0;
    const std::size_t t = static_cast<std::size_t>(tier);
    if (id == SkillId::Duplicator) return t < kDuplicatorTierCost.size() ? kDuplicatorTierCost[t] : 0;
    return t < kTierCost.size() ? kTierCost[t] : 0;
}

/// Second Chance forks off Flower Health and stays locked until that branch
/// reaches rare.
inline constexpr SkillId kSecondChanceParent = SkillId::PlayerHealth;
inline constexpr Rarity kSecondChanceRequirement = Rarity::Rare;

/// Duplicator forks off Absorption at mythic.
inline constexpr SkillId kDuplicatorParent = SkillId::Absorbing;
inline constexpr Rarity kDuplicatorRequirement = Rarity::Mythic;

/// A branch that grows out of another branch's node rather than out of the
/// flower, and stays locked until that parent reaches `requirement`.
struct SkillFork {
    SkillId child;
    SkillId parent;
    Rarity requirement;
};

inline constexpr std::array<SkillFork, 2> kSkillForks = {{
    {SkillId::SecondChance, kSecondChanceParent, kSecondChanceRequirement},
    {SkillId::Duplicator, kDuplicatorParent, kDuplicatorRequirement},
}};

/// The fork `id` hangs off, or nullptr for a branch that grows from the flower.
inline const SkillFork* skillFork(SkillId id) {
    for (const SkillFork& fork : kSkillForks) {
        if (fork.child == id) return &fork;
    }
    return nullptr;
}

/// What a node is called. Duplicator's second tier has a name of its own; every
/// other tier is its branch's label.
inline const char* skillTierLabel(SkillId id, int tier) {
    if (id == SkillId::Duplicator && tier == 1) return "Triplicator";
    const std::size_t i = static_cast<std::size_t>(id);
    return i < kSkillLabels.size() ? kSkillLabels[i] : "";
}

/// Copies Duplicator (+1) and Triplicator (+2) add to a petal. The second tier
/// replaces the first rather than stacking on it.
inline constexpr std::array<int, 2> kDuplicatorExtraCopies = {1, 2};
/// The fewest copies a petal must already field to be duplicated. A single
/// petal is left alone: the talent multiplies clumps, it does not turn a rose
/// into two roses.
inline constexpr int kDuplicatorMinCopies = 2;
/// The most petals one slot may field: the config loader's cap on `count`,
/// which the petal system's per-slot bitmask is sized to.
inline constexpr int kMaxPetalCopies = 64;

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

/// Applied to the player's own numbers: max health and body damage.
/// A gentle curve -- these compound with level and with petal modifiers.
inline constexpr std::array<double, kLadderRarityCount> kStatSkillScale = {
    1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9,
};

/// Applied to petal EFFECTS: healing output. Steeper than the stat curve.
inline constexpr std::array<double, kLadderRarityCount> kEffectSkillScale = {
    1.0, 1.1, 1.2, 1.35, 1.6, 2.0, 2.6, 3.3, 4.0, 4.8,
};

/// Applied to the health of what the flower fields: its petals (Petal Health)
/// and its summons (Pet Health). One table for the tooltip and the server, so
/// the percentage a tier advertises is the percentage it grants. The effect
/// curve's shape through unique, and 4.5x at apex.
inline constexpr std::array<double, kLadderRarityCount> kHealthSkillScale = {
    1.0, 1.1, 1.2, 1.35, 1.6, 2.0, 2.6, 3.3, 4.0, 4.5,
};

/// Applied to absorbed-petal XP. Geometric, so apex lands on exactly 8x.
inline constexpr std::array<double, kLadderRarityCount> kAbsorbSkillScale = {
    1.0, 1.26, 1.59, 2.0, 2.52, 3.17, 4.0, 5.04, 6.35, 8.0,
};

/// Applied to petal COOLDOWNS, and the only table that shrinks its input: a
/// reload is a wait, so the branch is worth having when the number goes DOWN.
/// Geometric like the absorb curve, so every step is worth the same proportion
/// of the last. The branch stops at unique (0.292); the apex entry is there
/// only because every table spans the ladder, and no tree can reach it.
inline constexpr std::array<double, kLadderRarityCount> kReloadSkillScale = {
    1.0, 0.857, 0.735, 0.630, 0.540, 0.463, 0.397, 0.340, 0.292, 0.25,
};

/// `tier` is a rarity index, or -1 for a branch never touched. Out-of-range
/// tiers read as neutral rather than clamping, because the only way to get one
/// is a corrupt record, and a corrupt record must not grant a bonus.
inline double scaleAt(const std::array<double, kLadderRarityCount>& table, int tier) {
    return (tier >= 0 && tier < kLadderRarityCount) ? table[static_cast<std::size_t>(tier)] : 1.0;
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
            for (int t = 0; t <= tier[static_cast<std::size_t>(s)] && t < kLadderRarityCount; ++t) {
                total += skillTierCost(static_cast<SkillId>(s), t);
            }
        }
        return total;
    }

    double statScale(SkillId id) const { return scaleAt(kStatSkillScale, level(id)); }
    double effectScale(SkillId id) const { return scaleAt(kEffectSkillScale, level(id)); }
    /// Petal Health's or Pet Health's multiplier. See kHealthSkillScale.
    double healthScale(SkillId id) const { return scaleAt(kHealthSkillScale, level(id)); }

    /// What every petal cooldown is multiplied by. A factor below one, so it
    /// is the one scale a caller must not clamp UP to 1.0 on a missing tree.
    double reloadScale() const { return scaleAt(kReloadSkillScale, level(SkillId::Reload)); }

    /// True when `id` may be bought: always for a branch off the flower, and
    /// for a fork once its parent has reached the tier it hangs off.
    bool prerequisiteMet(SkillId id) const {
        const SkillFork* fork = skillFork(id);
        return fork == nullptr || level(fork->parent) >= rarityIndex(fork->requirement);
    }

    /// True when Second Chance's prerequisite is satisfied.
    bool secondChanceUnlocked() const { return prerequisiteMet(SkillId::SecondChance); }

    /// How many petals a slot fields once Duplicator has had its say, given
    /// the `copies` its petal and tier field on their own. Gated on the fork's
    /// prerequisite as well as the tier, so a record that holds the branch
    /// without the mythic Absorption under it grants nothing.
    int petalCopies(int copies) const {
        const int t = level(SkillId::Duplicator);
        if (copies < kDuplicatorMinCopies || t < 0 ||
            t >= static_cast<int>(kDuplicatorExtraCopies.size()) ||
            !prerequisiteMet(SkillId::Duplicator)) {
            return copies;
        }
        const int boosted = copies + kDuplicatorExtraCopies[static_cast<std::size_t>(t)];
        return boosted < kMaxPetalCopies ? boosted : kMaxPetalCopies;
    }
};

/// A slot's copy count for a flower that may or may not carry a tree. Bots and
/// test rigs without one field the petal's own count.
inline int petalCopies(int copies, const SkillSet* skills) {
    return skills != nullptr ? skills->petalCopies(copies) : copies;
}

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
    return i < kSkillTiers.size() ? kSkillTiers[i] : kLadderRarityCount;
}

} // namespace flix
