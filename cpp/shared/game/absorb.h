#pragma once
// Absorbing: petals traded in for XP, from the craft window's Absorb side.
//
// One header because both ends price a request -- the client to print the
// "+N XP" it is about to grant, the server to grant it -- and the two must
// arrive at the same number.
//
// The curve is ours, not florr's. florr's own table (1, 5, 50, 500, 10k, 500k,
// 50M, 5B a petal) was sized for florr's level curve and would hand out a
// hundred of ours for one mythic. Here every tier is worth seven of the one
// below and a RARE petal is worth exactly 1 XP, which keeps absorbing a side
// income: a petal of any tier comes to roughly 1-3.5% of what killing a mob of
// that tier pays. The two tiers under rare are fractions of an XP, so a
// request is priced in whole UNITS -- a common is one, a rare 49 -- and turned
// into XP once, after the Absorption talent: forty-nine commons are 1 XP
// whether they go in one click or seven.

#include <cmath>
#include <cstdint>

#include "shared/game/config.h"
#include "shared/game/rarity.h"
#include "shared/game/skills.h"

namespace flix {

/// The petal florr refuses to absorb (as it refuses square, which we do not
/// have): everyone starts with it, so it is worth nothing.
inline constexpr const char* kUnabsorbablePetalId = "basic";

/// Every tier is worth this many of the tier below it.
inline constexpr double kAbsorbXpGrowth = 7.0;
/// Units in one XP: a rare petal's worth, two tiers above the one-unit common.
inline constexpr double kAbsorbUnitsPerXp = kAbsorbXpGrowth * kAbsorbXpGrowth;

/// How many petal stacks one Absorb request may name. More than a grid holds:
/// a type at every ladder tier for every petal there is.
inline constexpr int kMaxAbsorbStacks = 4096;

/// What one petal of `rarity` is worth, in units: 7^tier, so 1 for a common
/// and 40,353,607 for an apex. Exact in a double, as is any stack of them up
/// to 2^53 units -- past that the request is worth more XP than the curve can
/// tell apart anyway.
inline double absorbUnits(Rarity rarity) {
    return std::pow(kAbsorbXpGrowth, static_cast<double>(rarityIndex(rarity)));
}

/// What one petal of `rarity` is worth in XP before the talent: 1/49, 1/7, 1,
/// 7, 49 ... 823,543 at apex.
inline double absorbXpPerPetal(Rarity rarity) { return absorbUnits(rarity) / kAbsorbUnitsPerXp; }

/// Whether a petal may be absorbed at `rarity`: anything on the ladder except
/// the basic. Never a universal -- those are forged one per petal and tracked,
/// and destroying one is not a trade the game offers.
inline bool absorbable(const PetalConfig& petal, Rarity rarity) {
    return rarityIndex(rarity) < kLadderRarityCount && petal.id != kUnabsorbablePetalId;
}

/// The Absorption talent's multiplier for a tree: the one the flower is
/// playing on, which is the one its Profile carries -- so the client prices a
/// request with exactly the tree the server will.
inline double absorbXpScale(const SkillSet& skills) {
    return scaleAt(kAbsorbSkillScale, skills.level(SkillId::Absorbing));
}

/// What absorbing a whole request grants: `units` (the sum of
/// count x absorbUnits over it) through the talent, floored once. The nudge
/// keeps a total that is whole on paper -- 2,450 units at 2.52x is 126 -- from
/// flooring to the integer under it when the scale is a hair short in binary.
inline double absorbXpTotal(double units, const SkillSet& skills) {
    return std::floor(units * absorbXpScale(skills) / kAbsorbUnitsPerXp + 1e-7);
}

} // namespace flix
