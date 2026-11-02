#pragma once
// Shared, explicit casino economics. Payouts include the returned stake.
#include <array>
#include <cmath>
namespace flix {
inline constexpr int kCasinoChipsPerStar = 10;
inline constexpr int kCasinoMaxBet = 10000;
inline constexpr double kCasinoMaxBalance = 1000000000.0;
inline bool casinoBalanceValid(double value) {
    return std::isfinite(value) && value >= 0 && value <= kCasinoMaxBalance &&
           std::floor(value) == value;
}
inline constexpr std::array<int, 7> kPlinkoWeights{{2, 6, 12, 60, 12, 6, 2}};
inline constexpr std::array<int, 7> kPlinkoPayouts{{4, 2, 2, 0, 2, 2, 4}};
inline int plinkoSlot(int roll) {
    if (roll < 0 || roll >= 100) return -1;
    for (int slot = 0; slot < 7; ++slot) {
        if (roll < kPlinkoWeights[slot]) return slot;
        roll -= kPlinkoWeights[slot];
    }
    return -1;
}
} // namespace flix
