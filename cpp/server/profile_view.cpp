// `/profile [name]`: one account's public card.
//
// What is told is only what the server already keeps for the account: its
// level and XP, its stars, the kills it has made, its daily streak, when it
// joined and when it was last on, the bar it wears and its bag. There is no
// time-played, games-played or best-score ledger in this game, so the card has
// none of those, and nothing here starts keeping one.
//
// The answer is read from the saved row, so it works for an account that is
// offline, and for an online one it is the row as last written (the progress
// ticker keeps XP and stars close; a sharded game's gateway holds a copy that
// can trail the server the flower is on by a few seconds).

#include "server/game_server.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "server/game_server_internal.h"
#include "server/text.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/realm.h"

namespace flix {

namespace {

constexpr std::int64_t kDayMillis = 24LL * 60 * 60 * 1000;
/// One card a second per player: it walks a whole bag, and nobody reads
/// faster than that.
constexpr std::int64_t kProfileViewIntervalMillis = 1000;
/// Account names are short; a longer argument is never one.
constexpr std::size_t kMaxNameBytes = 64;

/// "YYYY-MM-DD" in UTC, or empty for a time that is not known. Days from the
/// epoch to a civil date by Howard Hinnant's algorithm, which needs no
/// gmtime (and so no thread-unsafe global).
std::string utcDate(std::int64_t millis) {
    if (millis <= 0) return {};
    const std::int64_t z = millis / kDayMillis + 719468;
    const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const std::int64_t doe = z - era * 146097;
    const std::int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const std::int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const std::int64_t mp = (5 * doy + 2) / 153;
    const std::int64_t day = doy - (153 * mp + 2) / 5 + 1;
    const std::int64_t month = mp < 10 ? mp + 3 : mp - 9;
    const std::int64_t year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%04d-%02d-%02d", static_cast<int>(year),
                  static_cast<int>(month), static_cast<int>(day));
    return buffer;
}

/// Every kill the account has made, over every mob and tier.
double totalKills(const PlayerRecord& record) {
    double total = 0;
    for (const std::string& mobId : record.mobKills.keys()) {
        const Json& byTier = record.mobKills[mobId];
        if (!byTier.isObject()) continue;
        for (const std::string& tier : byTier.keys()) {
            total += static_cast<double>(std::max(0, byTier[tier].asInt()));
        }
    }
    return total;
}

} // namespace

void GameServer::sendPlayerProfileView(Session& session, net::Connection& connection,
                                       const std::string& requested) {
    const std::int64_t now = database_.nowMillis();
    if (now < session.profileViewNextMillis) {
        sendSystem(connection, "One profile a second, please.");
        return;
    }
    session.profileViewNextMillis = now + kProfileViewIntervalMillis;

    const std::string name = trimmed(requested);
    if (name.size() > kMaxNameBytes) {
        sendSystem(connection, "No player named <b>" + escapedMarkup(name.substr(0, 20)) + "...</b>.");
        return;
    }
    // No name is the asker's own card: chat needs a signed-in session, and a
    // session has a username.
    const std::string& lookup = name.empty() ? session.username : name;

    const Database& accounts = database_;
    const Account* account = accounts.findUser(lookup);
    if (account == nullptr) {
        sendSystem(connection, "No player named <b>" + escapedMarkup(lookup) + "</b>.");
        return;
    }
    // An account that has never played has no row: the card is then the
    // starting one, which is what a PlayerRecord default is.
    static const PlayerRecord kNoRecord;
    const PlayerRecord* found = accounts.findProgress(account->id);
    const PlayerRecord& record = found != nullptr ? *found : kNoRecord;

    const bool online = sessionForUser(account->username) != nullptr;
    const double lastSeenAgo =
        (!online && account->lastActiveAtMillis > 0)
            ? static_cast<double>(std::max<std::int64_t>(0, now - account->lastActiveAtMillis))
            : 0.0;

    // A streak counts only while it is alive: the one stored is the last the
    // account reached, and a missed day does not reset it until the next login.
    const std::string today = utcDate(now);
    const std::string yesterday = utcDate(now - kDayMillis);
    const int streak = (record.lastStreakDate == today || record.lastStreakDate == yesterday)
                           ? std::max(0, record.dailyStreak)
                           : 0;

    const int mazeLevel =
        record.mazeTotalXp > 0 ? levelFromTotalXp(record.mazeTotalXp).level : 0;

    // The bag, one stack to a (petal, tier): a legacy row can file one petal
    // under two names, which the card shows as the one stack it is. Rarest
    // first, then in the content's own petal order -- what the owner's
    // inventory does.
    std::map<std::uint32_t, std::uint64_t> merged;
    forEachBagStack(record.inventory, [&](Rarity rarity, const std::string& key, int stack) {
        if (stack <= 0) return;
        const std::uint16_t index = petalIndexFromInventoryKey(key);
        if (index == kInvalidIndex) return;
        merged[static_cast<std::uint32_t>(index) << 8 |
               static_cast<std::uint8_t>(rarity)] += static_cast<std::uint64_t>(stack);
    });
    struct Stack {
        std::uint16_t index;
        Rarity rarity;
        std::uint32_t count;
    };
    std::vector<Stack> bag;
    bag.reserve(merged.size());
    for (const auto& [key, count] : merged) {
        bag.push_back({static_cast<std::uint16_t>(key >> 8),
                       clampRarity(static_cast<int>(key & 0xFF)),
                       static_cast<std::uint32_t>(std::min<std::uint64_t>(count, 0xFFFFFFFFu))});
    }
    std::stable_sort(bag.begin(), bag.end(), [](const Stack& a, const Stack& b) {
        return rarityIndex(a.rarity) > rarityIndex(b.rarity);
    });
    // A u16 count on the wire: more stacks than petals times tiers cannot be.
    if (bag.size() > 0xFFFF) bag.resize(0xFFFF);

    ByteWriter w(256 + bag.size() * 7);
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::PlayerProfileView));
    w.str(account->username);
    w.u8(online ? net::kProfileViewOnline : 0);
    w.f64(lastSeenAgo);
    w.str(utcDate(account->createdAtMillis));
    w.f64(record.totalXp);
    w.u16(static_cast<std::uint16_t>(levelFromTotalXp(record.totalXp).level));
    w.f64(record.stars);
    w.f64(totalKills(record));
    w.u16(static_cast<std::uint16_t>(std::min(streak, 0xFFFF)));
    w.u16(static_cast<std::uint16_t>(std::min(mazeLevel, 0xFFFF)));
    w.str(guildNameForUser(account->username));

    // The bar as the account owns it (the overworld's), not as a maze run
    // would shift it down a tier.
    w.u8(static_cast<std::uint8_t>(kLoadoutSlots));
    for (std::size_t i = 0; i < static_cast<std::size_t>(kLoadoutSlots); ++i) {
        const WornSlot worn = wornSlot(record, i, Realm::Overworld);
        w.u16(worn.petalIndex);
        w.u8(static_cast<std::uint8_t>(worn.rarity));
    }

    w.u16(static_cast<std::uint16_t>(bag.size()));
    for (const Stack& stack : bag) {
        w.u16(stack.index);
        w.u8(static_cast<std::uint8_t>(stack.rarity));
        w.u32(stack.count);
    }
    connection.send(w);
}

} // namespace flix
