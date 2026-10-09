#include "shared/game/rarity.h"

namespace flix {

bool tryParseRarity(const std::string& name, Rarity& out) {
    for (int i = 0; i < kRarityCount; ++i) {
        if (name == kRarityNames[static_cast<std::size_t>(i)]) {
            out = static_cast<Rarity>(i);
            return true;
        }
    }
    return false;
}

Rarity parseRarity(const std::string& name) {
    Rarity rarity = Rarity::Common;
    tryParseRarity(name, rarity);
    return rarity;
}

} // namespace flix
