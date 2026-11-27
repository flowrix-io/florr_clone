#pragma once

#include "shared/game/rarity.h"

namespace flix {

inline constexpr const char* kPrismForgeInputId = "glass";
inline constexpr const char* kPrismForgeOutputId = "prism_mirror";

/// A guaranteed same-tier conversion at Super, Eternal (Unique), and Apex.
/// Universal and Admin retain their separate acquisition rules.
inline constexpr bool prismForgeable(Rarity rarity) {
    return rarity == Rarity::Super || rarity == Rarity::Unique || rarity == Rarity::Apex;
}

} // namespace flix
