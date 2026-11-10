// An account's petals as the database keeps them: the bag, the worn ring and
// the kit a new account starts with. Declared in game_server_internal.h for the
// server files that move petals in and out of a record.

#include "server/game_server.h"

#include <algorithm>
#include <optional>

#include "server/game_server_internal.h"
#include "shared/game/config.h"

namespace flix {

// The database stores petals by NAME, because that is the shape real accounts
// are already saved in; the wire uses a dense index, because a name in every
// snapshot would cost more than the whole rest of the message. These two
// functions are the only place the two spellings meet.
//
// Inventory keys additionally carry a "petal_" prefix that loadout entries do
// not. That is the old schema's one real wart, and it is load-bearing: change
// either side and every stored loadout is orphaned.

std::string inventoryKey(std::uint16_t petalIndex) {
    return "petal_" + content().petal(petalIndex).id;
}

// Declared in game_server.h rather than game_server_internal.h, because the
// dashboard's view of a bag (server/admin_dashboard.cpp) reads these keys too.
std::uint16_t petalIndexFromInventoryKey(const std::string& key) {
    const std::string id = key.rfind("petal_", 0) == 0 ? key.substr(6) : key;
    return content().petalIndex(id);
}

/// Takes `count` from the inventory, or nothing at all when short. Never
/// partially succeeds: a craft that consumed three of the five it needed and
/// then failed would quietly destroy them.
bool takeFromInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count) {
    if (petalIndex == kNoPetal || count <= 0) return false;
    const std::string key = inventoryKey(petalIndex);
    if (record.itemCount(rarity, key) < count) return false;
    record.addItem(rarity, key, -count);
    return true;
}

void giveToInventory(PlayerRecord& record, std::uint16_t petalIndex, Rarity rarity, int count) {
    if (petalIndex == kNoPetal || count <= 0) return;
    record.addItem(rarity, inventoryKey(petalIndex), count);
}

/// A slot holding `petalType` at `rarity`: what a preset remembers, and what
/// equipping puts on the bar. None of the per-instance state a worn slot can
/// carry.
StoredItem petalItem(const std::string& petalType, Rarity rarity) {
    StoredItem item;
    item.type = "petal";
    item.petalType = petalType;
    item.rarity = rarity;
    return item;
}

/// One loadout slot as a body in `realm` actually wears it.
///
/// The maze plays the account's ring one rarity DOWN, and an orbiting slot
/// still above mythic after that shift is benched -- left empty on the body
/// and untouched on the account, which is the reference's applyMazeLoadout.
/// The storage row behind the ring shifts too but is never capped: it orbits
/// nothing, so nothing can be over-tier in it.
///
/// Both the body and the profile the client draws its loadout bar from go
/// through here, or the bar would advertise a rarity the flower is not
/// actually swinging.
WornSlot wornSlot(const PlayerRecord& record, std::size_t slot, Realm realm) {
    WornSlot worn;
    if (slot >= record.loadout.size() || !record.loadout[slot].has_value()) return worn;

    const StoredItem& item = *record.loadout[slot];
    worn.petalIndex = content().petalIndex(item.petalType);
    // A stored petal this build no longer has leaves the slot empty rather
    // than resolving to whatever index 0 happens to be.
    if (worn.petalIndex == kInvalidIndex) worn.petalIndex = kNoPetal;
    worn.rarity = item.rarity;

    if (realm == Realm::Maze && worn.petalIndex != kNoPetal) {
        worn.rarity = clampRarity(std::max(0, rarityIndex(worn.rarity) - 1));
        if (slot < kLoadoutActiveSlots && rarityIndex(worn.rarity) > rarityIndex(Rarity::Mythic)) {
            worn.petalIndex = kNoPetal;
            worn.rarity = Rarity::Common;
        }
    }
    return worn;
}

std::uint16_t wearStarterKit(PlayerRecord& record) {
    constexpr std::size_t kStarterPetals = 5;
    record.loadout.assign(kLoadoutSlots, std::nullopt);
    const std::uint16_t basic = content().petalIndex("basic");
    if (basic == kInvalidIndex) return basic;
    for (std::size_t i = 0; i < kStarterPetals && i < kLoadoutActiveSlots; ++i) {
        record.loadout[i] = petalItem(content().petal(basic).id, Rarity::Common);
    }
    return basic;
}

/// What a brand-new account starts with.
///
/// An empty loadout is a flower that cannot fight anything, which makes the
/// first minute of the game a walk through a field of mobs that can only hurt
/// it. Five Basic petals is the smallest kit that is actually playable, and
/// the five spares beside them are exactly one craft batch -- a brand-new
/// account can walk to the crafting panel and roll its first Unusual.
void grantStarterKit(PlayerRecord& record) {
    // A content set with no basic petal leaves a new account as it was made.
    if (content().petalIndex("basic") == kInvalidIndex) return;
    constexpr int kStartingSpares = 5;
    giveToInventory(record, wearStarterKit(record), Rarity::Common, kStartingSpares);
}

} // namespace flix
