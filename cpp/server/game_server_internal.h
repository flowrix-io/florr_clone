#pragma once
// Helpers the GameServer's own source files share, and nothing else does.
//
// GameServer is one class split over many files (game_server.cpp lists them).
// What two or more of those files need that is not a member lives here, once,
// rather than as a private copy in each: two copies of how a petal is filed in
// the bag are two places for that to stop being true.

#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <vector>

#include "server/db.h"
#include "server/game_server.h"
#include "server/session.h"
#include "shared/core/world.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flix {

// --- the bag (inventory.cpp) ------------------------------------------------

/// The key a stack of `petalIndex` is filed under in the bag ("petal_rose").
std::string inventoryKey(std::uint16_t petalIndex);

/// Takes `count` from the bag, or nothing at all when short.
bool takeFromInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count);

/// Adds `count` to the bag; nothing for no petal or a count of none.
void giveToInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count);

/// A worn or saved slot holding `petalType` at `rarity`, and nothing else.
StoredItem petalItem(const std::string& petalType, Rarity rarity);

/// One loadout slot as a body in `realm` actually wears it.
WornSlot wornSlot(const PlayerRecord& record, std::size_t slot, Realm realm);

/// Five common basics on the bar and nothing else worn: the kit a new account
/// and an arena run both start from. Returns the basic petal's index, or
/// kInvalidIndex when the content has none (and then the bar is left empty).
std::uint16_t wearStarterKit(PlayerRecord& record);

/// What a brand-new account starts with.
void grantStarterKit(PlayerRecord& record);

/// Every stack in a bag (PlayerRecord::inventory: rarity -> key -> count) as
/// `visit(rarity, key, count)`, in the order the file has them, keys this
/// build does not know included. `only` skips every tier that is not it
/// without walking it.
template <typename Visit>
void forEachBagStack(const Json& bag, Visit&& visit, std::optional<Rarity> only = std::nullopt) {
    for (const std::string& rarityName : bag.keys()) {
        const Rarity rarity = parseRarity(rarityName);
        if (only && rarity != *only) continue;
        const Json& byType = bag[rarityName];
        for (const std::string& key : byType.keys()) {
            visit(rarity, key, PlayerRecord::stackCount(byType[key]));
        }
    }
}

// --- the Profile (profile.cpp) ----------------------------------------------

/// Lists the bag or ledger cell (`index`, `rarity`) among `due` once, for the
/// next ProfileDelta.
void noteDue(std::vector<Session::ProfileCell>& due, std::uint16_t index, Rarity rarity);

// --- the body (players.cpp) -------------------------------------------------

/// The viewport a flower may claim: what its client reported, clamped to what
/// that flower can honestly be drawing.
Vec2 claimableViewport(World& world, Entity body, const ContentRegistry& content, double width,
                       double height);

// --- chat (chat.cpp) --------------------------------------------------------

/// A Chat message: `speakerNetId` is the flower the line floats over, 0 for
/// none (the server's own lines, or a speaker with no body).
ByteWriter chatMessage(net::ChatChannel channel, const std::string& author, const std::string& text,
                       std::uint32_t speakerNetId);

// --- markup -----------------------------------------------------------------

/// `<b style="color: #rrggbb;">` in the tier's own colour, the one every other
/// surface draws it in: how each chat line about a boss, a craft or a find
/// opens.
inline std::string rarityBoldTag(Rarity rarity) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "<b style=\"color: #%06x;\">",
                  static_cast<unsigned>(rarityColor(rarity)));
    return buffer;
}

} // namespace flix
