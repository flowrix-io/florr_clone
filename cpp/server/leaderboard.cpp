// The leaderboard: every account ranked by XP.

#include "server/game_server.h"

#include <algorithm>

#include "shared/game/config.h"

namespace flix {

void GameServer::handleLeaderboard(const Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const bool includeAdmins = reader.boolean();
    if (!reader.ok()) return;
    // Ranked over ACCOUNTS, not over the players currently online: the board is
    // a record of progress, and a top player who logged off has not lost it.
    struct Row {
        const std::string* name;
        double totalXp;
    };
    std::vector<Row> rows;
    rows.reserve(database_.userCount());
    // Every account, through the const lookup: the board only reads, and any
    // player may ask for it as often as they like. The mutable lookup drops
    // each row's cached text, so one request used to have the next save
    // re-serialise the whole users table on the tick thread (Database::Table).
    const Database& accounts = database_;
    for (const std::string& username : accounts.usernames()) {
        const Account* account = accounts.findUser(username);
        if (account == nullptr) continue;
        // Staff are off the board unless the asker ticked "Show Admins on
        // Leaderboard". The browser's getLeaderboard(limit, includeAdmins)
        // honours that for any caller, not only an admin: it reveals names
        // and XP, which the board shows for everyone else anyway.
        if (account->admin && !includeAdmins) continue;
        const PlayerRecord* record = accounts.findProgress(account->id);
        rows.push_back({&account->username, record ? record->totalXp : 0.0});
    }

    // The browser client asks for limit=50 and the panel scrolls all fifty;
    // still one byte on the wire, so the count below stays a u8.
    constexpr std::size_t kRows = 50;
    const std::size_t shown = std::min(kRows, rows.size());
    std::partial_sort(rows.begin(), rows.begin() + static_cast<long>(shown), rows.end(),
                      [](const Row& a, const Row& b) { return a.totalXp > b.totalXp; });

    // The count beside the title is over every account, not over the 50 rows
    // sent. The active-today figure rides along only for an admin, which is
    // how the browser's payload leaves the field out for everyone else -- and 0
    // is the same answer as "absent" to the panel, since the asker is always
    // active today themselves.
    const std::int64_t dayAgo = database_.nowMillis() - 24 * 60 * 60 * 1000;
    std::uint32_t activeToday = 0;
    if (session.admin) {
        for (const std::string& username : accounts.usernames()) {
            const Account* account = accounts.findUser(username);
            if (account && account->lastActiveAtMillis >= dayAgo) ++activeToday;
        }
    }

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Leaderboard));
    w.u8(static_cast<std::uint8_t>(shown));
    w.u32(static_cast<std::uint32_t>(database_.userCount()));
    w.u32(activeToday);
    for (std::size_t i = 0; i < shown; ++i) {
        w.str(*rows[i].name);
        w.u16(static_cast<std::uint16_t>(levelFromTotalXp(rows[i].totalXp).level));
        w.f64(rows[i].totalXp);
    }
    connection.send(w);
}

} // namespace flix
