#include "shared/game/rarity.h"

#include <cstring>

namespace flix {

Rarity parseRarity(const std::string& name) {
    for (int i = 0; i < kRarityCount; ++i) {
        if (name == kRarityNames[static_cast<std::size_t>(i)]) return static_cast<Rarity>(i);
    }
    return Rarity::Common;
}

} // namespace flix
