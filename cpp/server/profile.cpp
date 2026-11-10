// The Profile: what a client is told about its own account -- level, stars,
// the worn ring, the talent tree, the bag and the kill ledger -- sent whole or
// as a delta against what the client already holds (Session::ProfileShadow),
// and checked against the digest the client reports (ProfileCheck).

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <utility>
#include <vector>

#include "server/game_server_internal.h"
#include "shared/game/config.h"
#include "shared/game/skills.h"

namespace flix {

namespace {

/// The closest together two ProfileChecks are each worth a walk of the bag.
/// The shipping client sends one every kProfileCheckMillis; one sooner is
/// dropped rather than paid for.
constexpr double kProfileCheckFloorMillis = net::kProfileCheckMillis * 0.5;

/// Every stack of the bag exactly as the Profile carries it, as
/// `visit(petalIndex, rarity, count)`. The inventory is a sparse dictionary of
/// rarity -> item name -> count. Anything whose name this build does not know
/// (an item from a newer server, or a non-petal) is skipped for the wire but
/// left untouched in the record, so it survives the next save. sendProfile
/// writes what this visits and profileDigest folds it, so the bag a client is
/// checked against is the bag it would be sent. `only` skips every tier that
/// is not it: the walk a ProfileDelta makes for one group, which has to see
/// exactly what the Profile's walk sees there.
template <typename Visit>
void forEachProfileStack(const PlayerRecord& record, Visit&& visit,
                         std::optional<Rarity> only = std::nullopt) {
    forEachBagStack(record.inventory, [&](Rarity rarity, const std::string& key, int stack) {
        const auto count = static_cast<std::uint32_t>(stack);
        if (count == 0) return;
        const std::uint16_t index = petalIndexFromInventoryKey(key);
        if (index == kInvalidIndex) return;
        visit(index, rarity, count);
    }, only);
}

/// Every cell of the kill ledger exactly as the Profile carries it, as
/// `visit(mobIndex, rarity, count)`, in the order it is written: two entries
/// that land on one cell leave the client holding the later one. sendProfile
/// writes what this visits and a ProfileDelta's cells are read through it.
template <typename Visit>
void forEachProfileKill(const PlayerRecord& record, Visit&& visit) {
    for (const std::string& mobId : record.mobKills.keys()) {
        const std::uint16_t index = content().mobIndex(mobId);
        if (index == kInvalidIndex) continue;
        const Json& byTier = record.mobKills[mobId];
        if (!byTier.isObject()) continue;
        for (const std::string& tier : byTier.keys()) {
            const std::uint32_t count = static_cast<std::uint32_t>(std::max(0, byTier[tier].asInt()));
            if (count == 0) continue;
            visit(index, parseRarity(tier), count);
        }
    }
}

using ShadowCell = Session::ProfileShadow::Cell;

/// A bag or ledger cell's key in a ProfileShadow: sorting by it sorts by
/// petal or mob, then rarity.
std::uint32_t profileCellKey(std::uint16_t index, Rarity rarity) {
    return static_cast<std::uint32_t>(index) << 8 | static_cast<std::uint8_t>(rarity);
}

/// A cell's key back on the wire as profileCellKey took it: u16 index, u8 rarity.
void writeProfileCellKey(ByteWriter& w, std::uint32_t key) {
    w.u16(static_cast<std::uint16_t>(key >> 8));
    w.u8(static_cast<std::uint8_t>(key & 0xFF));
}

/// By key, keeping the walk's order inside one: a legacy record's two names
/// for one petal are two stacks, in the order the Profile wrote them.
void sortProfileCells(std::vector<ShadowCell>& cells) {
    std::stable_sort(cells.begin(), cells.end(),
                     [](const ShadowCell& a, const ShadowCell& b) { return a.key < b.key; });
}

/// The ledger as the client keeps it: one count a cell, the later of two
/// entries that land on one.
void keepLastPerCell(std::vector<ShadowCell>& cells) {
    sortProfileCells(cells);
    std::size_t kept = 0;
    for (std::size_t i = 0; i < cells.size(); ++i) {
        if (i + 1 < cells.size() && cells[i + 1].key == cells[i].key) continue;
        cells[kept++] = cells[i];
    }
    cells.resize(kept);
}

/// `visit(key, first, last)` for every key whose run of counts in `next`
/// differs from its run in `prev`, both sorted by sortProfileCells. The run
/// `[first, last)` is the key's in `next`, empty when it is gone.
template <typename Visit>
void forEachChangedRun(const std::vector<ShadowCell>& prev, const std::vector<ShadowCell>& next,
                       Visit&& visit) {
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < prev.size() || j < next.size()) {
        const std::uint32_t key = i == prev.size()   ? next[j].key
                                  : j == next.size() ? prev[i].key
                                                     : std::min(prev[i].key, next[j].key);
        std::size_t iEnd = i;
        while (iEnd < prev.size() && prev[iEnd].key == key) ++iEnd;
        std::size_t jEnd = j;
        while (jEnd < next.size() && next[jEnd].key == key) ++jEnd;
        const bool same = iEnd - i == jEnd - j &&
                          std::equal(prev.begin() + static_cast<std::ptrdiff_t>(i),
                                     prev.begin() + static_cast<std::ptrdiff_t>(iEnd),
                                     next.begin() + static_cast<std::ptrdiff_t>(j),
                                     [](const ShadowCell& a, const ShadowCell& b) {
                                         return a.count == b.count;
                                     });
        if (!same) visit(key, next.data() + j, next.data() + jEnd);
        i = iEnd;
        j = jEnd;
    }
}

/// Puts `counts` where `key`'s run in `cells` was: what a delta group or kill
/// cell just told the client.
void replaceProfileRun(std::vector<ShadowCell>& cells, std::uint32_t key,
                       const std::vector<std::uint32_t>& counts) {
    auto first = std::lower_bound(cells.begin(), cells.end(), key,
                                  [](const ShadowCell& c, std::uint32_t k) { return c.key < k; });
    auto last = first;
    while (last != cells.end() && last->key == key) ++last;
    auto at = cells.erase(first, last);
    for (const std::uint32_t count : counts) at = cells.insert(at, ShadowCell{key, count}) + 1;
}

/// u16 count, { u16 index, u8 rarity, u32 count }*: the Profile's bag and its
/// ledger.
void writeProfileCells(ByteWriter& w, const std::vector<ShadowCell>& cells) {
    w.u16(static_cast<std::uint16_t>(cells.size()));
    for (const ShadowCell& cell : cells) {
        writeProfileCellKey(w, cell.key);
        w.u32(cell.count);
    }
}

void appendBytes(ByteWriter& w, const ByteWriter& part) { w.raw(part.data(), part.size()); }

/// The numbers every Profile and ProfileDelta opens with: XP and level on the
/// track the flower is playing (the maze's, in the maze), and stars.
struct Standing {
    double xp = 0;
    std::uint16_t level = 1;
    double stars = 0;
};

Standing standingOf(const Session& session, const PlayerRecord& record) {
    Standing standing;
    standing.xp = session.playingIn(Realm::Maze) ? record.mazeTotalXp : record.totalXp;
    standing.level = static_cast<std::uint16_t>(levelFromTotalXp(standing.xp).level);
    standing.stars = std::max(0.0, record.stars);
    return standing;
}

/// A Profile's or a ProfileDelta's head: the message, the session's next
/// revision, and the standing.
void openProfileMessage(ByteWriter& w, net::ServerMessage kind, Session& session,
                        const Standing& standing) {
    w.u8(static_cast<std::uint8_t>(kind));
    w.u32(++session.profileRevision);
    w.f64(standing.xp);
    w.u16(standing.level);
    w.f64(standing.stars);
}

} // namespace

/// Lists `cell` among `due` once.
void noteDue(std::vector<Session::ProfileCell>& due, std::uint16_t index, Rarity rarity) {
    const Session::ProfileCell cell{index, rarity};
    if (std::find(due.begin(), due.end(), cell) == due.end()) due.push_back(cell);
}

struct GameServer::ProfileParts {
    Standing standing;
    /// Each ProfileSection as the bytes it goes on the wire as.
    ByteWriter identity, bar, skills, waits, presets;
    /// The bag and the ledger in the order the walks give them.
    std::vector<ShadowCell> stacks, kills;

    /// Hands the small sections to `shadow` once they are sent: they are what
    /// the client holds now. The waits are not kept -- they go every time.
    void rememberSections(Session::ProfileShadow& shadow) {
        shadow.identity = std::move(identity.buffer());
        shadow.bar = std::move(bar.buffer());
        shadow.skills = std::move(skills.buffer());
        shadow.presets = std::move(presets.buffer());
    }
};

void GameServer::gatherProfile(Session& session, ProfileParts& parts) {
    // The bag and ring the body is playing with (the arena run's, in the
    // ring), and the progression track it is on (the maze's, in the maze) --
    // so the panels show what the flower actually has and the talent menu
    // spends the points the body actually earned.
    const PlayerRecord& record = liveRecord(session);
    parts.standing = standingOf(session, record);
    const SkillSet& skills = session.playingIn(Realm::Maze) ? record.mazeSkills : record.skills;

    std::uint8_t accountFlags = 0;
    if (const Account* account = std::as_const(database_).findUserById(session.userId)) {
        if (account->guest) accountFlags |= net::kAccountGuest;
        if (!account->passwordChosen) accountFlags |= net::kAccountNoPassword;
    }
    parts.identity.str(session.username);
    parts.identity.u8(accountFlags);

    // The ring the flower is actually wearing, which in the maze is the
    // account's shifted down a tier: a bar advertising the rarity the account
    // owns while the body swings one below it is a bar that lies.
    const Realm realm = session.accountRealm();
    parts.bar.u8(static_cast<std::uint8_t>(kLoadoutSlots));
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        const WornSlot worn = wornSlot(record, i, realm);
        parts.bar.u16(worn.petalIndex);
        parts.bar.u8(static_cast<std::uint8_t>(worn.rarity));
    }

    // The talent tree. Only branches that have been bought are sent; the
    // balance is derived on both sides from the level, so it is not on the
    // wire at all and cannot arrive disagreeing with the tiers beside it.
    const std::size_t skillCountAt = parts.skills.reserveU16();
    std::uint16_t skillCount = 0;
    for (int i = 0; i < kSkillCount; ++i) {
        const int tier = skills.tier[static_cast<std::size_t>(i)];
        if (tier < 0) continue;
        parts.skills.u8(static_cast<std::uint8_t>(i));
        parts.skills.u8(static_cast<std::uint8_t>(tier));
        ++skillCount;
    }
    parts.skills.patchU16(skillCountAt, skillCount);

    // How long until the account may use an oracle again, as a DURATION: the
    // client's clock is not the server's, so a deadline would arrive already
    // wrong by whatever the two disagree by.
    const double wait = oracleWaitMillis(session.userId);
    parts.waits.u32(static_cast<std::uint32_t>(clamp<double>(std::ceil(wait), 0.0, 4294967295.0)));
    // And until it may trade again, the same way. A day is 86.4 million
    // milliseconds, well inside the u32.
    const double tradeWait = traderWaitMillis(session.userId);
    parts.waits.u32(static_cast<std::uint32_t>(clamp<double>(std::ceil(tradeWait), 0.0, 4294967295.0)));

    // The saved loadouts, for the row the bar shows while K or L is held --
    // only the ones that exist. The ACCOUNT's, even from inside an arena run:
    // presets are never the run's.
    const PlayerRecord* account = database_.findProgress(session.userId);
    std::vector<std::pair<int, const std::vector<std::optional<StoredItem>>*>> presets;
    if (account != nullptr) {
        for (const auto& [name, slots] : account->loadoutPresets) {
            const int preset = loadoutPresetIndex(name);
            if (preset >= 0) presets.emplace_back(preset, &slots);
        }
    }
    parts.presets.u8(static_cast<std::uint8_t>(presets.size()));
    for (const auto& [preset, slots] : presets) {
        parts.presets.u8(static_cast<std::uint8_t>(preset));
        const std::size_t count = std::min<std::size_t>(slots->size(), kLoadoutSlots);
        parts.presets.u8(static_cast<std::uint8_t>(count));
        for (std::size_t i = 0; i < count; ++i) {
            const std::optional<StoredItem>& item = (*slots)[i];
            const std::uint16_t index = item ? content().petalIndex(item->petalType) : kNoPetal;
            parts.presets.u16(index == kInvalidIndex ? kNoPetal : index);
            parts.presets.u8(static_cast<std::uint8_t>(item ? item->rarity : Rarity::Common));
        }
    }

    forEachProfileStack(record, [&](std::uint16_t index, Rarity rarity, std::uint32_t count) {
        parts.stacks.push_back({profileCellKey(index, rarity), count});
    });
    // The mob-kill ledger, for the gallery. Mob ids this build does not know
    // are skipped for the wire and left in the record, exactly as the
    // inventory is: a gallery cell is worth less than an account's history.
    forEachProfileKill(record, [&](std::uint16_t index, Rarity rarity, std::uint32_t count) {
        parts.kills.push_back({profileCellKey(index, rarity), count});
    });
}

void GameServer::sendProfile(Session& session, net::Connection& connection) {
    // A Profile is the whole account -- 8 KB at the 90th percentile of the
    // live database, 14 KB at the top, nearly all of it the bag and the kill
    // ledger -- and every equip, swap, craft, absorb, trade and talent used to
    // send one. Dragging petals around the bar was most of a busy player's
    // traffic. What changed since the client was last told is a few cells.
    Session::ProfileShadow& shadow = session.profileShadow;
    if (!shadow.known) {
        sendFullProfile(session, connection);
        return;
    }
    ProfileParts parts;
    gatherProfile(session, parts);
    std::vector<ShadowCell> stacks = parts.stacks;
    std::vector<ShadowCell> kills = parts.kills;
    sortProfileCells(stacks);
    keepLastPerCell(kills);

    ByteWriter changes;
    const std::size_t groupCountAt = changes.reserveU16();
    std::size_t groups = 0;
    forEachChangedRun(shadow.stacks, stacks,
                      [&](std::uint32_t key, const ShadowCell* first, const ShadowCell* last) {
        writeProfileCellKey(changes, key);
        // Two names for one petal in one tier is a legacy record's oddity,
        // and 255 of them is not a record at all.
        const auto n = std::min<std::ptrdiff_t>(last - first, 0xFF);
        changes.u8(static_cast<std::uint8_t>(n));
        for (std::ptrdiff_t i = 0; i < n; ++i) changes.u32(first[i].count);
        ++groups;
    });
    const std::size_t killCountAt = changes.reserveU16();
    std::size_t cells = 0;
    forEachChangedRun(shadow.kills, kills,
                      [&](std::uint32_t key, const ShadowCell* first, const ShadowCell* last) {
        writeProfileCellKey(changes, key);
        // Gone from the ledger is a cell the Profile would leave at zero.
        changes.u32(first != last ? first->count : 0);
        ++cells;
    });
    // A new arena run's kit, or an admin's edit to half the bag, can change
    // more than the whole Profile would cost to send.
    const std::size_t wholeBytes = 4 + 7 * (parts.stacks.size() + parts.kills.size());
    if (changes.size() >= wholeBytes || groups > 0xFFFF || cells > 0xFFFF) {
        writeFullProfile(session, connection, parts);
        return;
    }
    changes.patchU16(groupCountAt, static_cast<std::uint16_t>(groups));
    changes.patchU16(killCountAt, static_cast<std::uint16_t>(cells));

    // The waits are durations, different every time, and nine bytes; every
    // other section goes only when it is not what the client already holds.
    const auto differs = [](const ByteWriter& now, const std::vector<std::byte>& told) {
        return now.buffer() != told;
    };
    std::uint8_t sections = net::kProfileWaits;
    if (differs(parts.identity, shadow.identity)) sections |= net::kProfileIdentity;
    if (differs(parts.bar, shadow.bar)) sections |= net::kProfileBar;
    if (differs(parts.skills, shadow.skills)) sections |= net::kProfileSkills;
    if (differs(parts.presets, shadow.presets)) sections |= net::kProfilePresets;

    ByteWriter w(32 + changes.size());
    openProfileMessage(w, net::ServerMessage::ProfileDelta, session, parts.standing);
    w.u8(sections);
    if (sections & net::kProfileIdentity) appendBytes(w, parts.identity);
    if (sections & net::kProfileBar) appendBytes(w, parts.bar);
    if (sections & net::kProfileSkills) appendBytes(w, parts.skills);
    appendBytes(w, parts.waits);
    if (sections & net::kProfilePresets) appendBytes(w, parts.presets);
    appendBytes(w, changes);
    connection.send(w);

    shadow.stacks = std::move(stacks);
    shadow.kills = std::move(kills);
    parts.rememberSections(shadow);
    clearProfileDue(session);
}

void GameServer::sendProfile(Session& session) {
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendProfile(session, *connection);
    }
}

void GameServer::sendFullProfile(Session& session, net::Connection& connection) {
    ProfileParts parts;
    gatherProfile(session, parts);
    writeFullProfile(session, connection, parts);
}

void GameServer::writeFullProfile(Session& session, net::Connection& connection,
                                  ProfileParts& parts) {
    ByteWriter w(64 + parts.identity.size() + parts.presets.size() +
                 7 * (parts.stacks.size() + parts.kills.size()));
    openProfileMessage(w, net::ServerMessage::Profile, session, parts.standing);
    appendBytes(w, parts.identity);
    appendBytes(w, parts.bar);
    appendBytes(w, parts.skills);
    appendBytes(w, parts.waits);
    appendBytes(w, parts.presets);
    writeProfileCells(w, parts.stacks);
    writeProfileCells(w, parts.kills);
    connection.send(w);

    // A Profile replaces whatever the client held, so this is now all of it.
    Session::ProfileShadow& shadow = session.profileShadow;
    shadow.known = true;
    shadow.stacks = std::move(parts.stacks);
    sortProfileCells(shadow.stacks);
    shadow.kills = std::move(parts.kills);
    keepLastPerCell(shadow.kills);
    parts.rememberSections(shadow);
    clearProfileDue(session);
}

void GameServer::clearProfileDue(Session& session) {
    // Whatever was owed is in what was just sent.
    session.stacksDue.clear();
    session.killsDue.clear();
    session.profileDue = false;
}

void GameServer::sendProfileDelta(Session& session, net::Connection& connection) {
    // Read exactly as sendProfile reads them -- the same record, the same
    // track, the same walkers -- so a client that applies this holds what the
    // whole Profile would have given it, and the digests still agree.
    const PlayerRecord& record = liveRecord(session);

    ByteWriter w;
    openProfileMessage(w, net::ServerMessage::ProfileDelta, session, standingOf(session, record));
    // None of the small sections: a kill or a pickup moves none of them.
    w.u8(0);

    // And what the client is told goes into the shadow, cell by cell, so the
    // next sendProfile diffs against what the client really holds.
    Session::ProfileShadow& shadow = session.profileShadow;
    w.u16(static_cast<std::uint16_t>(session.stacksDue.size()));
    std::vector<std::uint32_t> counts;
    for (const Session::ProfileCell& group : session.stacksDue) {
        counts.clear();
        forEachProfileStack(record, [&](std::uint16_t index, Rarity, std::uint32_t count) {
            if (index == group.index) counts.push_back(count);
        }, group.rarity);
        w.u16(group.index);
        w.u8(static_cast<std::uint8_t>(group.rarity));
        // Two names for one petal in one tier is a legacy record's oddity,
        // and 255 of them is not a record at all.
        const std::size_t n = std::min<std::size_t>(counts.size(), 0xFF);
        w.u8(static_cast<std::uint8_t>(n));
        for (std::size_t i = 0; i < n; ++i) w.u32(counts[i]);
        counts.resize(n);
        if (shadow.known) {
            replaceProfileRun(shadow.stacks, profileCellKey(group.index, group.rarity), counts);
        }
    }

    w.u16(static_cast<std::uint16_t>(session.killsDue.size()));
    for (const Session::ProfileCell& cell : session.killsDue) {
        // The last entry on the cell, as the client keeps it from a Profile;
        // none at all is a cell the Profile leaves at zero.
        std::uint32_t last = 0;
        forEachProfileKill(record, [&](std::uint16_t index, Rarity rarity, std::uint32_t count) {
            if (index == cell.index && rarity == cell.rarity) last = count;
        });
        w.u16(cell.index);
        w.u8(static_cast<std::uint8_t>(cell.rarity));
        w.u32(last);
        if (shadow.known) {
            counts.assign(last != 0 ? 1 : 0, last);
            replaceProfileRun(shadow.kills, profileCellKey(cell.index, cell.rarity), counts);
        }
    }

    connection.send(w);
    clearProfileDue(session);
}

void GameServer::sendDueProfiles() {
    // A Profile is the whole account -- every stack and the whole kill ledger,
    // 8 KB at the 90th percentile of the live database and 14 KB at the top --
    // and banking used to send one per kill and per pickup. An AoE tick that
    // kills ten mobs put 140 KB in front of that player's next snapshot, and
    // `banking` stood out in prod's slow-tick log. Now a snapshot tick sends
    // what changed since the last one: the touched stacks and ledger cells,
    // tens of bytes, in the same flush as the snapshot that shows the kill.
    // A client that drifts anyway is caught by ProfileCheck and sent the whole
    // Profile, which is the only repair a delta needs.
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.profileDue) continue;
        if (net::Connection* connection = listener_.find(entry.first)) {
            sendProfileDelta(session, *connection);
        } else {
            clearProfileDue(session);
        }
    }
}

void GameServer::resyncProfile(Session& session, net::Connection& connection) {
    // Whole: the client is showing something it was never sent, so what it
    // holds is not the shadow and a diff against that would repair nothing.
    sendFullProfile(session, connection);
}

std::uint32_t GameServer::profileDigest(Session& session) {
    const PlayerRecord& record = liveRecord(session);
    net::ProfileDigest digest;
    forEachProfileStack(record, [&](std::uint16_t index, Rarity rarity, std::uint32_t count) {
        digest.stack(index, static_cast<std::uint8_t>(rarity), count);
    });
    // The bar as sendProfile writes it: the maze's ring is the account's one
    // tier down.
    const Realm realm = session.accountRealm();
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        const WornSlot worn = wornSlot(record, i, realm);
        digest.slot(i, worn.petalIndex, static_cast<std::uint8_t>(worn.rarity));
    }
    return digest.value();
}

void GameServer::handleProfileCheck(Session& session, net::Connection& connection,
                                    ByteReader& reader) {
    const std::uint32_t revision = reader.u32();
    const std::uint32_t claimed = reader.u32();
    if (!reader.ok() || !session.authenticated()) return;
    if (clockMillis_ < session.nextProfileCheckMillis) return;
    session.nextProfileCheckMillis = clockMillis_ + kProfileCheckFloorMillis;

    // Folded before the last Profile or delta landed: it describes a bag the
    // server has since changed and told the client about, so a mismatch
    // proves nothing. Nor does one while a change is banked and owed to the
    // next snapshot. Either way the next check, two seconds on, is judged.
    if (revision != session.profileRevision || session.profileDue) return;
    if (claimed == profileDigest(session)) return;
    sendFullProfile(session, connection);
}

} // namespace flix
