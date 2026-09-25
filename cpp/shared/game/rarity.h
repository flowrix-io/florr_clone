#pragma once
// Rarity: the single axis both mobs and items are graded on.
//
// Ten tiers, common through apex. Everything that scales with rarity scales
// off the index, so there is one ordered table and no string comparisons in
// any hot path.

#include <array>
#include <cstdint>
#include <string>

#include "shared/core/types.h"

namespace flix {

enum class Rarity : std::uint8_t {
    Common = 0, Uncommon, Rare, Epic, Legendary,
    Mythic, Ultra, Super, Unique, Apex,
    Count
};

inline constexpr int kRarityCount = static_cast<int>(Rarity::Count);

inline constexpr std::array<const char*, kRarityCount> kRarityNames = {
    "common", "uncommon", "rare", "epic", "legendary",
    "mythic", "ultra", "super", "unique", "apex",
};

/// Display names, used on drop labels and inventory tooltips.
inline constexpr std::array<const char*, kRarityCount> kRarityLabels = {
    "Common", "Uncommon", "Rare", "Epic", "Legendary",
    "Mythic", "Ultra", "Super", "Unique", "Apex",
};

/// Tier colours. These carry meaning at a glance -- a player reads rarity from
/// the border colour long before the label -- so they are shared verbatim by
/// the drop glow, the inventory border, and the mob outline.
inline constexpr std::array<std::uint32_t, kRarityCount> kRarityColors = {
    0x7EEF6Du,  // common     green
    0xFFE65Du,  // uncommon   yellow
    0x4D52E3u,  // rare       blue
    0x861FDEu,  // epic       purple
    0xDE1F1Fu,  // legendary  red
    0x1FDBDEu,  // mythic     cyan
    0xFF2B75u,  // ultra      pink
    0x2BFFA3u,  // super      mint
    0xEEEEEEu,  // unique     white
    0xFF00FFu,  // apex       magenta
};

inline constexpr int rarityIndex(Rarity r) { return static_cast<int>(r); }
inline constexpr const char* rarityName(Rarity r) {
    return rarityIndex(r) < kRarityCount ? kRarityNames[rarityIndex(r)] : "common";
}
inline constexpr const char* rarityLabel(Rarity r) {
    return rarityIndex(r) < kRarityCount ? kRarityLabels[rarityIndex(r)] : "Common";
}
inline constexpr std::uint32_t rarityColor(Rarity r) {
    return rarityIndex(r) < kRarityCount ? kRarityColors[rarityIndex(r)] : 0xFFFFFFu;
}

/// Parses a config/database rarity string. Unknown text reads as Common, so a
/// hand-edited save or an older record degrades instead of failing to load.
Rarity parseRarity(const std::string& name);

inline constexpr Rarity upgradeRarity(Rarity r) {
    const int i = rarityIndex(r);
    return i + 1 < kRarityCount ? static_cast<Rarity>(i + 1) : r;
}

inline constexpr Rarity downgradeRarity(Rarity r) {
    const int i = rarityIndex(r);
    return i > 0 ? static_cast<Rarity>(i - 1) : r;
}

inline constexpr Rarity clampRarity(int index) {
    return static_cast<Rarity>(clamp(index, 0, kRarityCount - 1));
}

/// The tier at which a mob stops being scenery and becomes an EVENT.
///
/// One line, shared by everything that has an opinion about bosses: the
/// spawner announces at it and places such a mob as a live entity wherever it
/// rolled, the mob AI keeps it thinking at full rate however far from anybody
/// it stands, and the bot controller rallies a raid on it. ULTRA IS BELOW IT
/// on purpose -- an ultra is a hard mob you find, a super is a thing the whole
/// server is told about.
inline constexpr bool isBossRarity(Rarity r) {
    return rarityIndex(r) >= rarityIndex(Rarity::Super);
}

// ---------------------------------------------------------------------------
// Stat scaling
// ---------------------------------------------------------------------------

/// Mob health per tier. Superlinear on purpose: each tier is meant to be a
/// wall, not a gentle step, so a common-tier loadout cannot chip down a
/// legendary by patience alone.
inline constexpr std::array<double, kRarityCount> kMobHealthScale = {
    1.0, 3.75, 13.5, 54.0, 324.0, 3159.0, 126830.0, 2374000.0, 1e7, 2e8,
};

/// Mob damage per tier -- a clean 3x ladder, so a tier above you roughly
/// triples what one touch costs.
inline constexpr std::array<double, kRarityCount> kMobDamageScale = {
    1.0, 3.0, 9.0, 27.0, 81.0, 243.0, 729.0, 2187.0, 6561.0, 1968300.0,
};

/// Mob armour per tier: a flat amount subtracted from every DIRECT hit.
///
/// The same 3x ladder as damage, but it STOPS AT ULTRA and repeats that figure
/// for the three tiers above it. Carried to apex the ladder would reach 1.9m,
/// which is more than most apex-tier rings do in a swing -- a mob nothing can
/// scratch is not a wall, it is a bug report. Ultra is where the cap belongs
/// for the same reason isBossRarity() draws its line one tier higher: below it
/// a mob is something you find and fight, above it a thing a raid is called
/// for, and a raid's damage is not what armour is meant to be balanced against.
inline constexpr std::array<double, kRarityCount> kMobArmorScale = {
    1.0, 3.0, 9.0, 27.0, 81.0, 243.0, 729.0, 729.0, 729.0, 729.0,
};

/// Mob body size per tier. Grows far more slowly than health so a mythic is
/// intimidating without filling the screen.
inline constexpr std::array<double, kRarityCount> kMobSizeScale = {
    1.5, 1.65, 1.95, 2.58, 4.5, 7.5, 10.5, 16.777216, 26.8435456, 42.949673,
};

/// A pull-down on kMobSizeScale for a mob that must not grow like a wild one:
/// 1x at common, `scaleAtUnique` at unique, linear in the rarity index, and
/// apex continues the slope. The reference's buildSizeRamp (src/mobs.ts).
///
/// Linear rather than geometric on purpose: kMobSizeScale only grows 1.1x from
/// common to uncommon, so a geometric pull-down would make an uncommon smaller
/// than a common. Linear keeps the effective size growing at every step.
inline double mobSizeRamp(Rarity r, double scaleAtUnique) {
    constexpr double kUniqueIndex = static_cast<double>(static_cast<int>(Rarity::Unique));
    return 1.0 - (1.0 - scaleAtUnique) * (rarityIndex(r) / kUniqueIndex);
}

/// Petal damage and health per tier: a flat 3x ladder matching mob damage, so
/// upgrading a petal one tier keeps pace with the mobs one tier up.
inline double petalStatScale(Rarity r) {
    return std::pow(3.0, rarityIndex(r));
}

/// Healing scales 3x per tier only to mythic, then sqrt(3) per tier.
///
/// Healing that kept tripling would outpace every damage source in the game
/// at the top tiers and make a maxed loadout unkillable; the softer tail keeps
/// high-rarity healing strong without ending combat.
inline double petalHealScale(Rarity r) {
    constexpr int kMythic = static_cast<int>(Rarity::Mythic);
    const int i = rarityIndex(r);
    if (i <= kMythic) return std::pow(3.0, i);
    return std::pow(3.0, kMythic) * std::pow(std::sqrt(3.0), i - kMythic);
}

/// Mana -- the pool, what refills it, and what a cast costs -- doubles per
/// tier.
///
/// ONE ladder for the whole resource, supply and demand together, so a kit
/// built at a single tier casts at exactly the rate it did at the tier below:
/// an apex orb fuels an apex missile as often as a common orb fuels a common
/// one, and what upgrading buys is the damage the cast lands, not more casts.
/// Splitting the two -- the pool on one curve, the cost on another -- would
/// quietly take casts away at every tier, which is an upgrade that makes the
/// build worse. Mixing tiers is where the decision lives, and 2x rather than
/// the 3x of damage is what keeps that decision from being absurd: a magic
/// petal one tier down is expensive to feed, not unfeedable.
inline double petalManaScale(Rarity r) {
    return std::pow(2.0, rarityIndex(r));
}

/// Camera zoom: the authored figure's distance from 1 multiplies by 4/3 per
/// tier.
///
/// Geometric where petalModifierScale is linear, and deliberately so. Zoom is
/// read as a WIDTH -- how much more world a tier shows -- and a linear ramp
/// spends almost all of its growth in the first few tiers. A 4/3 step gives
/// camera petals such as observer the same visible gain every time. Petals
/// authored far from 1 can run through zero near the top of the ladder;
/// loadoutCameraZoom's floor catches those generic camera values.
inline double petalZoomScale(Rarity r) {
    return std::pow(4.0 / 3.0, rarityIndex(r));
}

/// Antennae's effective vision-range multiplier from the requested output
/// table. Apex keeps the unique-tier cap.
inline double antennaeVisionRangeScale(Rarity r) {
    static constexpr std::array<double, kRarityCount> kVisionScale = {
        1.0, 1.0, 1.25, 4.0 / 3.0, 10.0 / 7.0,
        2.0, 20.0 / 7.0, 5.0, 10.0, 10.0,
    };
    return kVisionScale[static_cast<std::size_t>(rarityIndex(clampRarity(rarityIndex(r))))];
}

/// Passive player modifiers (luck, magnetism, extra max health) scale linearly
/// from 1x at common to 4x at unique. Geometric scaling here would make a
/// single high-tier utility petal worth more than a whole loadout.
inline double petalModifierScale(Rarity r) {
    constexpr double kUniqueIndex = static_cast<double>(static_cast<int>(Rarity::Unique));
    return 1.0 + (rarityIndex(r) / kUniqueIndex) * 3.0;
}

/// A mob-aggro-range multiplier at a tier: the authored common figure applied
/// once more per tier, so every upgrade takes the same fraction off whatever
/// range the tier below left. Poo's 0.75 is
///
///   common -25%, uncommon -43.8%, rare -57.8%, epic -68.4%, legendary -76.3%,
///   mythic -82.2%, ultra -86.7%, super -90%, unique -92.5%, apex -94.4%
///
/// -- the table it was balanced to, and apex is the same curve one step on.
/// Neither of the other passive curves can produce this: petalModifierScale
/// would take a -25% to -100% by unique -- mobs blind to the flower -- and the
/// zoom curve grows away from 1 rather than towards 0.
inline double petalAggroRangeScale(double authored, Rarity r) {
    return std::pow(authored, rarityIndex(r) + 1);
}

/// A dodge chance at a tier: the authored common figure added once more per
/// tier, so talisman's 0.03 is
///
///   common 3%, uncommon 6%, rare 9%, ... unique 27%, apex 30%.
///
/// Not petalModifierScale: that curve stops at 4x by unique, and a dodge
/// chance is the one modifier stated as a flat step per tier. Clamped because
/// a chance past 1 is not a stronger dodge, it is a flower nothing can touch.
inline double petalEvasionScale(double authored, Rarity r) {
    return clamp(authored * (rarityIndex(r) + 1), 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Crafting and drop rolls
// ---------------------------------------------------------------------------

/// Probability that a craft from `from` to the next tier succeeds. Halves each
/// tier from a base of 64%, so common->uncommon is routine and the top tiers
/// are a genuine gamble.
inline double craftSuccessChance(Rarity from) {
    return 0.64 / std::pow(2.0, rarityIndex(from));
}

/// Chance a drop rolls one tier above the mob that dropped it.
///
/// Read only for the one GRADED drop of a kill -- see
/// LootSystem::finishDropRarity. The extra rows a mob hands out on top of it
/// are never promoted; they are flat chaff two tiers down.
inline double dropUpgradeChance(Rarity mobRarity) {
    if (rarityIndex(mobRarity) >= kRarityCount - 1) return 0.0;
    return craftSuccessChance(mobRarity) / 3.0;
}

/// Chance a drop rolls one tier below the mob that dropped it.
inline double dropDowngradeChance(Rarity mobRarity) {
    const int i = rarityIndex(mobRarity);
    if (i <= 0) return 0.0;
    // The TypeScript formula uses the crafting ladder as a percentage (64,
    // 32, ...), then uses the result as a probability. craftSuccessChance()
    // is stored as a fraction for actual crafting, so restore that scale here.
    return 1.0 /
           (1.0 + craftSuccessChance(static_cast<Rarity>(i - 1)) * 100.0);
}

/// How much of a slow lands on a mob: full at equal rarity, a third per tier
/// the mob is above the slow's source, never more than full. Out-rareing a mob
/// buys reliability, never a slow stronger than the petal was designed for.
inline double stallPower(Rarity source, Rarity target) {
    return std::min(1.0, std::pow(3.0, rarityIndex(source) - rarityIndex(target)));
}

} // namespace flix
