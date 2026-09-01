#pragma once
// The star shop: what a petal costs, and what may be sold at all.
//
// Prices live here rather than in petals.json because they are not a property
// of the petal -- they are an economy the server tunes -- and because both the
// shop panel and the purchase handler must agree on them to the star. The
// client shows a price; the server recomputes it and ignores whatever the
// client claimed.

#include <cmath>
#include <string>
#include <unordered_map>

#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flr {

/// Base (common-tier) price per petal id. Anything absent costs the default,
/// which is what keeps a newly added petal buyable instead of free.
inline const std::unordered_map<std::string, double>& shopBasePrices() {
    static const std::unordered_map<std::string, double> kPrices = {
        {"basic", 10},        {"rose", 15},          {"stinger", 20},
        {"light", 12},        {"rock", 18},          {"sand", 14},
        {"yggdrasil", 120},   {"dandelion", 13},     {"clover", 16},
        {"bone", 17},         {"cactus", 19},        {"poison_cactus", 22},
        {"iris", 18},         {"lightning", 25},     {"missile", 21},
        {"jelly", 20},        {"yucca", 15},         {"leaf", 14},
        {"cutter", 50},       {"lightning_cutter", 60}, {"wing", 23},
        {"square", 1000},     {"golden_leaf", 18},   {"blood_leaf", 24},
        {"target_dummy_egg", 100000000.0},           {"splitter", 1000000.0},
        {"flower", 3000000.0}, {"moon", 2000},       {"shell", 15},
        {"observer", 75},     {"guided_missile", 30},
    };
    return kPrices;
}

inline constexpr double kDefaultShopPrice = 10.0;

/// Each tier is 3.5x the last, so the ladder outruns star income far faster
/// than crafting does -- buying your way to legendary is meant to be absurd.
inline double shopPrice(const std::string& petalId, Rarity rarity) {
    const auto& table = shopBasePrices();
    const auto it = table.find(petalId);
    const double base = it == table.end() ? kDefaultShopPrice : it->second;
    return std::floor(base * std::pow(3.5, rarityIndex(rarity)));
}

inline double shopPrice(std::uint16_t petalIndex, Rarity rarity) {
    return shopPrice(content().petal(petalIndex).id, rarity);
}

/// Unique and apex are not for sale at any price: they are the reward for
/// crafting and for killing things, and a star price would make both pointless.
inline bool shopSellsRarity(Rarity rarity) {
    return rarity != Rarity::Unique && rarity != Rarity::Apex;
}

/// Admin-only petals never appear in the shop, whatever their price says --
/// and neither does the egg of a mob its config forbids eggs for. Both filters
/// are the browser's (src/shop.ts:466-469): dropping either one lands the
/// catalogue on the wrong number of cards.
inline bool shopSellsPetal(std::uint16_t petalIndex) {
    if (petalIndex >= content().petalCount()) return false;
    const PetalConfig& petal = content().petal(petalIndex);
    if (petal.isAdminPetal) return false;
    constexpr char kEggSuffix[] = "_egg";
    constexpr std::size_t kEggSuffixLen = sizeof(kEggSuffix) - 1;
    if (petal.id.size() > kEggSuffixLen &&
        petal.id.compare(petal.id.size() - kEggSuffixLen, kEggSuffixLen, kEggSuffix) == 0) {
        const std::uint16_t mob =
            content().mobIndex(petal.id.substr(0, petal.id.size() - kEggSuffixLen));
        if (mob != kInvalidIndex && content().mob(mob).noEggDrop) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Star challenges
// ---------------------------------------------------------------------------

/// Stars awarded for killing a mob of this tier. Mythic is the floor: below it
/// a kill is worth XP and loot only, which is what makes a star mean something.
inline int starsForKill(Rarity mobRarity) {
    switch (mobRarity) {
        case Rarity::Mythic: return 1;
        case Rarity::Ultra:  return 5;
        case Rarity::Super:  return 25;
        case Rarity::Unique: return 100;
        case Rarity::Apex:   return 250;
        default: return 0;
    }
}

} // namespace flr
