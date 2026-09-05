#pragma once
// The star shop: what a petal costs, and what may be sold at all.
//
// Prices live here rather than in petals.json because they are not a property
// of the petal -- they are an economy the server tunes -- and because both the
// shop panel and the purchase handler must agree on them to the star. The
// client shows a price; the server recomputes it and ignores whatever the
// client claimed.

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flix {

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
// The rotating store
// ---------------------------------------------------------------------------
//
// The shop does not sell the catalogue. It sells ten cards that change on the
// hour, some of them discounted, and both sides DERIVE those ten from the
// clock rather than one sending the other a list: the client draws a price the
// server will honour because the two ran the same generator over the same
// content, and a purchase carries only which card was clicked.

/// How long one set of offers stands. The panel counts down to the next
/// rotation against this and the server prices a purchase by the rotation the
/// clock is in, so the number is shared rather than spelled out twice.
inline constexpr std::int64_t kShopRotationSeconds = 3600;

/// Two rows of five. The panel's grid is built to this.
inline constexpr int kShopOfferCount = 10;
inline constexpr int kShopOfferColumns = 5;

/// Seconds since the epoch: the one clock the offers hang off.
inline std::int64_t shopClockNow() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

/// Which rotation a moment falls in. Floor division, not the language's
/// truncation: a clock set before 1970 would otherwise give the two hours
/// either side of the epoch the same rotation.
inline std::int64_t shopRotation(std::int64_t unixSeconds) {
    const std::int64_t quotient = unixSeconds / kShopRotationSeconds;
    return (unixSeconds < 0 && quotient * kShopRotationSeconds != unixSeconds) ? quotient - 1
                                                                              : quotient;
}

/// When that rotation ends, in the same seconds-since-epoch.
inline std::int64_t shopRotationEnd(std::int64_t rotation) {
    return (rotation + 1) * kShopRotationSeconds;
}

/// One card in the store.
struct ShopOffer {
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    /// What it costs, discount already taken off. This IS the price: nothing
    /// that spends stars re-derives it from the two fields above.
    double price = 0;
    /// 0, or the 10/20/30 the discounted cards wear on their ribbon.
    int discountPercent = 0;
};

/// The ten cards a rotation offers.
///
/// Pure, and deterministic to the star: the same rotation index produces the
/// same cards on every machine that loaded the same petals.json. That is what
/// lets the client price a card the server will agree to.
inline std::vector<ShopOffer> shopOffers(std::int64_t rotation) {
    std::vector<ShopOffer> offers;

    std::vector<std::uint16_t> pool;
    for (const std::uint16_t index : content().petalDisplayOrder()) {
        if (shopSellsPetal(index)) pool.push_back(index);
    }
    std::vector<Rarity> tiers;
    for (int tier = 0; tier < kRarityCount; ++tier) {
        const Rarity rarity = clampRarity(tier);
        if (shopSellsRarity(rarity)) tiers.push_back(rarity);
    }
    if (pool.empty() || tiers.empty()) return offers;

    Rng rng(static_cast<std::uint64_t>(rotation));
    const int count = std::min<int>(kShopOfferCount, static_cast<int>(pool.size()));
    const int half = static_cast<int>(tiers.size()) / 2;

    for (int slot = 0; slot < count; ++slot) {
        // Partial Fisher-Yates, so no petal is offered twice in one rotation.
        const auto taken = static_cast<std::size_t>(slot);
        const auto remaining = static_cast<std::uint32_t>(pool.size() - taken);
        std::swap(pool[taken], pool[taken + rng.below(remaining)]);

        // The top row draws from the cheap half of the ladder and the bottom
        // row from the dear half, which is what gives the grid a shape a
        // player can read at a glance instead of ten prices in no order.
        const bool dear = slot >= kShopOfferColumns && half > 0;
        const int lowest = dear ? half : 0;
        const int highest = dear ? static_cast<int>(tiers.size()) - 1 : std::max(0, half - 1);

        ShopOffer offer;
        offer.petalIndex = pool[taken];
        offer.rarity = tiers[static_cast<std::size_t>(rng.rangeInt(lowest, highest))];
        offer.discountPercent = rng.chance(0.2) ? 10 * (1 + static_cast<int>(rng.below(3))) : 0;
        offer.price = std::floor(shopPrice(offer.petalIndex, offer.rarity) *
                                 static_cast<double>(100 - offer.discountPercent) / 100.0);
        offers.push_back(offer);
    }
    return offers;
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

} // namespace flix
