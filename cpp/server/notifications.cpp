// The global notification feed: rare crafts and star codes, kept in the
// database and paged to whoever opens the panel.

#include "server/game_server.h"

#include <algorithm>
#include <vector>

namespace flix {

namespace {

/// How many rows of the global feed are kept. The browser build trims to the
/// last thousand on every write, so a feed that has been running for months is
/// still one screen of scrollback rather than a megabyte of the save file.
constexpr std::size_t kNotificationHistory = 1000;

} // namespace

// Outside the file's own namespace, and declared in game_server.h, because the
// console's `notification` command (server/chat_commands.cpp) asks it which
// tags are real.
net::NotificationKind notificationKind(const std::string& type) {
    if (type == "super_craft") return net::NotificationKind::SuperCraft;
    if (type == "unique_craft") return net::NotificationKind::UniqueCraft;
    if (type == "apex_craft") return net::NotificationKind::ApexCraft;
    if (type == "star_code") return net::NotificationKind::StarCode;
    if (type == "universal_craft") return net::NotificationKind::UniversalCraft;
    return net::NotificationKind::Generic;
}

void GameServer::addNotification(const std::string& type, const std::string& message) {
    // rawArrayTable, never rawTable: this is the one unmodelled table stored
    // as an ARRAY, the shape the browser build gave it, and coercing it would
    // replace the whole feed with an empty object.
    Json& feed = database_.rawArrayTable("notifications");
    const std::int64_t now = database_.nowMillis();
    Json entry = Json::object();
    entry["id"] = std::to_string(now) + "-" + std::to_string(++notificationSequence_);
    entry["type"] = type;
    entry["message"] = message;
    entry["timestamp"] = static_cast<double>(now);
    feed.push(std::move(entry));

    // Trimmed from the FRONT, because the feed is in the order it was written
    // and the newest row is the one just pushed.
    std::vector<Json>& rows = feed.items();
    if (rows.size() > kNotificationHistory) {
        rows.erase(rows.begin(),
                   rows.begin() + static_cast<std::ptrdiff_t>(rows.size() - kNotificationHistory));
    }
    database_.markDirty();
}

void GameServer::handleNotifications(net::Connection& connection, ByteReader& reader) {
    const std::uint16_t limit = reader.u16();
    const double before = reader.f64();
    if (!reader.ok()) return;

    // Read through storedTable(), never rawTable(): this is the one unmodelled
    // table stored as an ARRAY, the shape the browser build gave it, and
    // rawTable() would coerce the whole feed to an empty object on the way
    // past.
    const Json& table = database_.storedTable("notifications");

    struct Row {
        const Json* entry;
        double stamp;
    };
    std::vector<Row> rows;
    if (table.isArray()) {
        rows.reserve(table.size());
        for (const Json& entry : table.items()) {
            const double stamp = entry["timestamp"].asDouble();
            // `before` is exclusive, which is what lets a page request start
            // exactly at the oldest entry the client already holds.
            if (before > 0 && stamp >= before) continue;
            rows.push_back({&entry, stamp});
        }
    }
    std::sort(rows.begin(), rows.end(),
              [](const Row& a, const Row& b) { return a.stamp > b.stamp; });

    const std::size_t want = std::min<std::size_t>(limit == 0 ? 50 : limit, 200);
    const std::size_t shown = std::min(want, rows.size());

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Notifications));
    // "More" is a full page, not a count of what is left: the browser reads
    // `batch.length === limit` and so pages one request past the end.
    w.boolean(shown == want);
    w.u16(static_cast<std::uint16_t>(shown));
    for (std::size_t i = 0; i < shown; ++i) {
        const Json& entry = *rows[i].entry;
        w.str(entry["id"].asString());
        w.u8(static_cast<std::uint8_t>(notificationKind(entry["type"].asString())));
        w.str(entry["message"].asString());
        w.f64(rows[i].stamp);
    }
    connection.send(w);
}

} // namespace flix
