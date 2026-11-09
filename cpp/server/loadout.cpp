// Editing the worn ring: equipping out of the bag, swapping slots and rows,
// and the saved presets.

#include "server/game_server.h"

#include <algorithm>
#include <optional>
#include <vector>

#include "server/game_server_internal.h"
#include "shared/game/config.h"

namespace flix {

namespace {

/// How closely a preset load came to what was saved.
struct PresetLoad {
    int downgraded = 0;   ///< equipped, but at a lower rarity than was saved
    int missing = 0;      ///< not owned at the saved rarity or any below it
};

/// Re-equips a saved preset onto `record`.
///
/// Everything worn goes back into the bag first, so each slot draws from the
/// whole collection: a petal the preset wants in slot 0 may be sitting in
/// slot 7 right now. Then two passes. The first seats every petal that is
/// there at its saved rarity; only then does the second step what is left
/// down a rarity at a time. In one pass, a slot early on the bar that had to
/// step down could take the very petal a later slot was saved with, and the
/// later slot would step down too. A petal owned at no rarity at or below its
/// saved one leaves its slot empty.
PresetLoad equipPreset(PlayerRecord& record, const std::vector<std::optional<StoredItem>>& preset) {
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);
    const std::vector<std::optional<StoredItem>> previous = record.loadout;
    for (const std::optional<StoredItem>& worn : previous) {
        // Under its raw key, not via the index: a petal this build no longer
        // knows still belongs to the account, and the bag keeps unknown keys.
        if (worn && !worn->petalType.empty()) {
            record.addItem(worn->rarity, "petal_" + worn->petalType, 1);
        }
    }

    std::vector<std::optional<StoredItem>> next(kLoadoutSlots);
    std::vector<std::size_t> unseated;
    PresetLoad result;
    const std::size_t slots = std::min<std::size_t>(preset.size(), kLoadoutSlots);
    for (std::size_t i = 0; i < slots; ++i) {
        if (!preset[i]) continue;
        const std::uint16_t index = content().petalIndex(preset[i]->petalType);
        if (index == kInvalidIndex) {
            ++result.missing;
        } else if (takeFromInventory(record, index, preset[i]->rarity, 1)) {
            next[i] = petalItem(preset[i]->petalType, preset[i]->rarity);
        } else {
            unseated.push_back(i);
        }
    }
    for (const std::size_t i : unseated) {
        const std::uint16_t index = content().petalIndex(preset[i]->petalType);
        for (int tier = rarityIndex(preset[i]->rarity) - 1; tier >= 0 && !next[i]; --tier) {
            const Rarity rarity = static_cast<Rarity>(tier);
            if (takeFromInventory(record, index, rarity, 1)) {
                next[i] = petalItem(preset[i]->petalType, rarity);
            }
        }
        if (next[i]) ++result.downgraded;
        else ++result.missing;
    }

    // A slot that ends up holding what it already held keeps its own item,
    // and with it whatever per-instance state it carried.
    for (std::size_t i = 0; i < next.size() && i < previous.size(); ++i) {
        if (next[i] && previous[i] && previous[i]->petalType == next[i]->petalType &&
            previous[i]->rarity == next[i]->rarity) {
            next[i] = previous[i];
        }
    }
    record.loadout = std::move(next);
    return result;
}

} // namespace

PlayerRecord& GameServer::editableLoadout(Session& session) {
    PlayerRecord& record = liveRecord(session);
    if (record.loadout.size() < kLoadoutSlots) record.loadout.resize(kLoadoutSlots);
    return record;
}

void GameServer::recordEdited(Session& session, net::Connection& connection) {
    // An event's kit is the event's: there is nothing of the account's to save.
    if (!session.eventKit) database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) applyAccountToSession(session);
    sendProfile(session, connection);
}

bool GameServer::loadoutLockedInMaze(Session& session, net::Connection& connection) {
    if (session.eventKit && hostedArenaRules_["lockLoadout"].asBool()) {
        sendNotice(connection, net::NoticeSeverity::Warning, "The host locked event loadouts.");
        return true;
    }
    if (!session.playingIn(Realm::Maze)) return false;
    // The maze body plays a DERIVED ring -- the account's, one rarity down --
    // and the reference locks the loadout for the run rather than let an edit
    // made in maze terms be persisted in regular ones.
    sendNotice(connection, net::NoticeSeverity::Warning, "Your loadout is locked inside the maze.");
    return true;
}

bool GameServer::presetsClosed(const Session& session, net::Connection& connection) {
    // Custom event kits and public arena kits stay isolated from the
    // account's presets. Personal-gear events save and load against their own
    // temporary copy.
    if (!session.arena && !(session.eventKit && hostedArenaKit_.isObject())) return false;
    sendNotice(connection, net::NoticeSeverity::Warning, "Saved loadouts can't be used in the arena.");
    return true;
}

void GameServer::handleSetLoadout(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::uint8_t slot = reader.u8();
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;
    if (slot >= kLoadoutSlots) return;
    if (petalIndex != kNoPetal && petalIndex >= content().petalCount()) return;
    if (loadoutLockedInMaze(session, connection)) return;

    PlayerRecord& record = editableLoadout(session);

    // Equipping must come out of the inventory, or a client can name any petal
    // it likes and simply be given it. The server's bag is the only one that
    // counts: a stack the client shows and this record does not hold was
    // edited into its memory or is a Profile out of date, and either way it is
    // put right.
    if (petalIndex != kNoPetal && !takeFromInventory(record, petalIndex, rarity, 1)) {
        resyncProfile(session, connection);
        return;
    }

    // Whatever was in the slot goes back to the inventory. Doing this after the
    // take, not before, means a failed take cannot also have emptied the slot.
    if (record.loadout[slot].has_value()) {
        const StoredItem& previous = *record.loadout[slot];
        const std::uint16_t previousIndex = content().petalIndex(previous.petalType);
        if (previousIndex != kInvalidIndex) {
            giveToInventory(record, previousIndex, previous.rarity, 1);
        }
    }

    if (petalIndex == kNoPetal) {
        record.loadout[slot].reset();
    } else {
        record.loadout[slot] = petalItem(content().petal(petalIndex).id, rarity);
    }
    recordEdited(session, connection);
}

void GameServer::handleSwapLoadout(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::uint8_t a = reader.u8();
    const std::uint8_t b = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (a >= kLoadoutSlots || b >= kLoadoutSlots || a == b) return;
    if (loadoutLockedInMaze(session, connection)) return;

    PlayerRecord& record = editableLoadout(session);
    std::swap(record.loadout[a], record.loadout[b]);
    recordEdited(session, connection);
}

void GameServer::handleSwapLoadoutRows(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    if (loadoutLockedInMaze(session, connection)) return;

    PlayerRecord& record = editableLoadout(session);
    for (std::size_t i = 0; i < kLoadoutActiveSlots; ++i) {
        std::swap(record.loadout[i], record.loadout[i + kLoadoutActiveSlots]);
    }
    recordEdited(session, connection);
}

void GameServer::handleSaveLoadoutPreset(Session& session, net::Connection& connection,
                                         ByteReader& reader) {
    const std::uint8_t preset = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (preset >= kLoadoutPresetCount) return;
    if (presetsClosed(session, connection)) return;

    // Saving in the maze is allowed: nothing is edited, and the account's own
    // ring -- what the player will have back outside -- is what gets saved. In
    // a personal-gear event, the ring the event lent.
    PlayerRecord& record = database_.progress(session.userId);
    const PlayerRecord& source = session.eventKit ? *session.eventKit : record;
    std::vector<std::optional<StoredItem>> saved(kLoadoutSlots);
    for (std::size_t i = 0; i < saved.size() && i < source.loadout.size(); ++i) {
        const std::optional<StoredItem>& worn = source.loadout[i];
        if (worn && !worn->petalType.empty()) saved[i] = petalItem(worn->petalType, worn->rarity);
    }
    const std::string name = loadoutPresetName(preset);
    record.loadoutPresets[name] = std::move(saved);
    database_.markDirty();
    // The profile carries the presets, and the bar's K/L row is drawn from it.
    sendProfile(session, connection);
    sendNotice(connection, net::NoticeSeverity::Good, "Saved loadout " + name + ".");
}

void GameServer::handleLoadLoadoutPreset(Session& session, net::Connection& connection,
                                         ByteReader& reader) {
    const std::uint8_t preset = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (preset >= kLoadoutPresetCount) return;
    if (presetsClosed(session, connection)) return;
    if (loadoutLockedInMaze(session, connection)) return;

    PlayerRecord& permanent = database_.progress(session.userId);
    PlayerRecord& record = session.eventKit ? *session.eventKit : permanent;
    const std::string name = loadoutPresetName(preset);
    // A preset never saved is an empty loadout, and loads as one: every petal
    // goes back into the bag. Copied either way -- equipPreset rewrites the
    // record the preset lives in.
    const auto saved = permanent.loadoutPresets.find(name);
    const std::vector<std::optional<StoredItem>> slots =
        saved != permanent.loadoutPresets.end() ? saved->second
                                             : std::vector<std::optional<StoredItem>>(kLoadoutSlots);
    const PresetLoad result = equipPreset(record, slots);
    // A personal-gear event then enforces its current bans on what came back.
    if (session.eventKit) {
        clearHostedGear(session);
        enforceHostedRules(session);
    }
    recordEdited(session, connection);

    std::string text = "Loaded loadout " + name;
    if (result.downgraded > 0 || result.missing > 0) {
        const auto petals = [](int n) { return std::to_string(n) + (n == 1 ? " petal" : " petals"); };
        text += " (";
        if (result.downgraded > 0) text += petals(result.downgraded) + " at a lower rarity";
        if (result.downgraded > 0 && result.missing > 0) text += ", ";
        if (result.missing > 0) text += petals(result.missing) + " not found";
        text += ")";
    }
    text += ".";
    sendNotice(connection,
               result.missing > 0 ? net::NoticeSeverity::Warning : net::NoticeSeverity::Good, text);
}

} // namespace flix
