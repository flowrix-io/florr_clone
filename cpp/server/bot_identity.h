#pragma once
// What a bot's NAME decides: its level and its ten petals.
//
// Extracted from game_server.cpp once a second caller needed it. The admin
// console's /level-from-string and /loadout-from-string exist precisely to
// answer "what would a bot called X be?", and a second implementation of the
// roll would answer a different question the moment either drifted.
//
// The generator is the reference's mulberry32 reproduced exactly, not the
// server's own Rng: the level and loadout a name produces have to be the same
// numbers on the browser server and on this one, or the same bot is a
// different flower depending on which build spawned it.

#include <algorithm>
#include <cstdint>
#include <iterator>
#include <string>
#include <vector>

#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flr {

/// The names the reference draws from. Two are deliberately empty: an unnamed
/// flower is a real sight in the live game.
inline constexpr const char* const kBotNames[] = {
    "m28", "M28", "uwu", "67", "Play Zorr.pro", "", "", "petal",
    "super hunter", "mark m28", "dev", "fake dev", "admin", "pytorch", "urmom",
    "skibidi", "florrio", "CraftApexPetal", "developer", "hi", "hello", "4167",
    "florrrrr", "bro", "bruh", "You suck", "pls loot super", "powder",
    "skibidi ohio rizz", "rizzler", "pro", "noob", "nub", "[YT]", "killer",
    "flower", "ur mom", "random flower", "centi", "petall", "ygg pls",
    "SUPER BASIC", "carry pls", "lol", "floor", "ded", "noooo", "nl super",
    "nah", "m29", "m56", "florr67", "get good", "super raider", "real admin",
    "not bot", "bot", "scripts", "ban dupers", "absorbed super", "Guest #1234",
    "Guest #6767", "Guest #4167", "UwU", "m27", "n28", "super petal",
    "apex petal", "apex crafter", "uniques", "i use scripts", "m28 bad",
    "guests", "leech squad", "leecher",
};

/// Only passive petals, yggdrasil and powder: a bot with a bomb would be a
/// hazard to the players standing next to it.
inline constexpr const char* const kBotPetalPool[] = {
    "basic", "stinger", "iris", "faster", "cutter", "missile", "bone", "glass",
    "dandelion", "yggdrasil", "rock", "third_eye", "powder", "javascript", "soil",
};

/// djb2-style hash, so a bot with a given name always seeds the same stream and
/// therefore always has the same build. "A bot named X plays like X" is the
/// whole point of seeding off the name rather than off the spawn.
inline std::uint32_t hashName(const std::string& s) {
    std::int32_t h = 5381;
    for (const char c : s) {
        h = static_cast<std::int32_t>(static_cast<std::uint32_t>(h) * 33u) ^
            static_cast<std::int32_t>(static_cast<unsigned char>(c));
    }
    return static_cast<std::uint32_t>(h);
}

/// mulberry32, the reference's own generator. Reproduced exactly rather than
/// swapped for the server's Rng, because the level and loadout a name produces
/// have to be the same numbers on both servers.
class BotRng {
public:
    explicit BotRng(std::uint32_t seed) : state_(seed) {}

    double unit() {
        state_ += 0x6d2b79f5u;
        std::uint32_t t = state_;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return static_cast<double>((t ^ (t >> 14))) / 4294967296.0;
    }

private:
    std::uint32_t state_;
};

/// Uniform 1..225. Roughly a ninth of bots land at apex tier.
inline int rollBotLevel(BotRng& rng) {
    return static_cast<int>(rng.unit() * 225.0) + 1;
}

/// One petal rarity for a bot of this level.
///
/// Weights by ten-level band, with apex a separate band the level check routes
/// to rather than a linear extension. The roll itself is the reference's:
/// `rng*2 + total - 2` lands in the last two units of the cumulative range, so
/// a bot's petals come from the top of its band's table almost every time --
/// which is why the rare entries are held down to a weight of one or two.
inline Rarity rollBotPetalRarity(int level, BotRng& rng) {
    struct Entry { Rarity rarity; double weight; };
    static const std::vector<std::vector<Entry>> kBands = {
        {{Rarity::Common, 300}, {Rarity::Uncommon, 55}, {Rarity::Rare, 1}},
        {{Rarity::Common, 40}, {Rarity::Uncommon, 24}, {Rarity::Rare, 15}, {Rarity::Epic, 2}},
        {{Rarity::Common, 30}, {Rarity::Uncommon, 24}, {Rarity::Rare, 20}, {Rarity::Epic, 5}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 5}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 1}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 4}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 11}},
        {{Rarity::Common, 18}, {Rarity::Uncommon, 18}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 15}, {Rarity::Mythic, 1}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 20}, {Rarity::Mythic, 2}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 20}, {Rarity::Mythic, 5}},
        {{Rarity::Common, 40}, {Rarity::Uncommon, 40}, {Rarity::Rare, 40}, {Rarity::Epic, 40}, {Rarity::Legendary, 40}, {Rarity::Mythic, 17}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 20}, {Rarity::Mythic, 11}, {Rarity::Ultra, 1}},
        {{Rarity::Common, 40}, {Rarity::Uncommon, 40}, {Rarity::Rare, 40}, {Rarity::Epic, 40}, {Rarity::Legendary, 40}, {Rarity::Mythic, 40}, {Rarity::Ultra, 21}, {Rarity::Super, 1}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 20}, {Rarity::Mythic, 20}, {Rarity::Ultra, 20}, {Rarity::Super, 20}},
        {{Rarity::Common, 20}, {Rarity::Uncommon, 20}, {Rarity::Rare, 20}, {Rarity::Epic, 20}, {Rarity::Legendary, 20}, {Rarity::Mythic, 20}, {Rarity::Ultra, 20}, {Rarity::Super, 20}, {Rarity::Unique, 1}},
    };
    // Level 200 and up draws from its own table, not from the top pre-apex band.
    static const std::vector<Entry> kApexBand = {
        {Rarity::Mythic, 10}, {Rarity::Ultra, 20}, {Rarity::Super, 20},
        {Rarity::Unique, 2}, {Rarity::Apex, 30},
    };
    constexpr int kApexLevelThreshold = 200;
    constexpr int kLevelBandSize = 10;

    const std::vector<Entry>& band =
        level >= kApexLevelThreshold
            ? kApexBand
            : kBands[static_cast<std::size_t>(
                  std::min<int>(static_cast<int>(kBands.size()) - 1,
                                std::max(1, level - 1) / kLevelBandSize))];

    double total = 0;
    for (const Entry& entry : band) total += entry.weight;
    const double roll = rng.unit() * 2.0 + total - 2.0;
    double cumulative = 0;
    for (const Entry& entry : band) {
        cumulative += entry.weight;
        if (roll < cumulative) return entry.rarity;
    }
    return band.back().rarity;
}

/// The whole build a name seeds: the level, then one entry per active slot.
///
/// The rolls are consumed in the order createBotBody consumes them -- level
/// first, then petal-then-rarity per slot -- because they come off ONE stream.
/// Reordering them here would silently give the console a different answer
/// than the bot the world actually spawns.
struct BotIdentity {
    struct Slot {
        std::uint16_t petalIndex = kInvalidIndex;
        Rarity rarity = Rarity::Common;
    };
    int level = 1;
    std::vector<Slot> slots;
};

inline BotIdentity botIdentityForName(const std::string& name, int slotCount, int maxLevel) {
    BotIdentity identity;
    BotRng rng(hashName(name));
    identity.level = std::min(maxLevel, rollBotLevel(rng));
    identity.slots.reserve(static_cast<std::size_t>(std::max(0, slotCount)));
    for (int i = 0; i < slotCount; ++i) {
        const char* id = kBotPetalPool[static_cast<std::size_t>(
            rng.unit() * static_cast<double>(std::size(kBotPetalPool)))];
        const Rarity rarity = rollBotPetalRarity(identity.level, rng);
        std::uint16_t index = content().petalIndex(id);
        if (index == kInvalidIndex) index = content().petalIndex("basic");
        identity.slots.push_back({index, rarity});
    }
    return identity;
}

} // namespace flr
