#pragma once
#include <cmath>
#include "shared/game/rarity.h"
namespace flix {
inline constexpr double kMarketListingLifetimeMillis = 48.0*60*60*1000;
inline constexpr double kEconomyMax = 1000000000000.0;
inline bool validMoney(double v) { return std::isfinite(v) && v>=0 && v<=kEconomyMax && std::floor(v)==v; }
inline bool validBalance(double v) { return std::isfinite(v) && v>=0 && v<=kEconomyMax; }
// Stars use f64 balances; preserve fractional proceeds on one-star trades.
inline double sellerProceeds(double gross) { return gross*4.0/5.0; }
inline double creditStars(double balance,double amount) { return std::round((balance+amount)*10.0)/10.0; }
inline double marketMinimum(Rarity rarity) {
    if (rarityIndex(rarity)>=kLadderRarityCount) return 0;
    double price=1; for(int i=0;i<rarityIndex(rarity);++i) price*=3;
    return price;
}
}
