// The guild protocol and the notification feed, end to end over loopback.
//
// Both surfaces used to be drawn against structures nothing ever filled, so
// what these cover is specifically the round trip: a request leaves a client,
// the server changes the database, and every affected client is told.

#include "test.h"

#include <string>
#include <vector>

#include "server_harness.h"

using namespace flr;
using namespace flr::testsupport;

namespace {

/// A registered account with a known password, so a test can log two clients
/// in against the same database.
void seedUser(const std::string& path, const std::string& username,
              const std::string& password) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);   // the default cost makes this the slowest test
    db.createUser(username, password);
    db.markDirty();
    db.save();
}

/// Notifications are stored as a JSON ARRAY, which is the one shape rawTable()
/// would destroy -- so the seed writes the table by hand, exactly as the
/// browser build's file carries it.
void seedNotifications(const std::string& path, int count) {
    Json feed = Json::array();
    for (int i = 0; i < count; ++i) {
        Json entry = Json::object();
        entry["id"] = Json("n" + std::to_string(i));
        entry["type"] = Json(i % 2 == 0 ? "apex_craft" : "star_code");
        entry["message"] = Json("notice " + std::to_string(i));
        // Ascending, so the newest is the LAST one written and a correct
        // server has to sort rather than echo the file's order.
        entry["timestamp"] = Json(1000.0 + i);
        feed.push(std::move(entry));
    }
    Json root;
    std::string error;
    if (!Json::parseFile(path, root, error)) root = Json::object();
    root["notifications"] = std::move(feed);
    root.writeFile(path, 2);
}

bool loginAs(Harness& h, NetClient& client, const char* name, const char* password) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, password);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

} // namespace

TEST(the_leaderboard_carries_the_account_count_beside_its_rows) {
    Harness h("board-count", [](const std::string& path) {
        seedUser(path, "one", "password7");
        seedUser(path, "two", "password7");
        seedUser(path, "three", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "one", "password7"));
    client.requestLeaderboard();
    CHECK(h.stepUntil({&client}, [&] { return !client.leaderboard().empty(); }, 200));

    // The count is over every account, not over the rows that fit.
    CHECK_EQ(client.totalAccounts(), 3u);
    // The active-today figure is admin-only, and this account is not one.
    CHECK_EQ(client.dailyActiveUsers(), 0u);
}

TEST(the_notification_feed_arrives_newest_first_and_pages_backwards) {
    Harness h("notices", [](const std::string& path) {
        seedUser(path, "reader", "password7");
        seedNotifications(path, 7);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "reader", "password7"));

    client.requestNotifications(3, 0);
    CHECK(h.stepUntil({&client}, [&] { return !client.notificationsPending(); }, 200));
    CHECK_EQ(client.notifications().size(), static_cast<std::size_t>(3));
    // Newest first, whatever order the file stored them in.
    CHECK_EQ(client.notifications()[0].id, std::string("n6"));
    CHECK_EQ(client.notifications()[2].id, std::string("n4"));
    // A full page means there may be another behind it.
    CHECK(client.notificationsHaveMore());
    // The stored `type` tag survives as the wire enum the stripe colour reads.
    CHECK_EQ(static_cast<int>(client.notifications()[0].kind),
             static_cast<int>(net::NotificationKind::ApexCraft));

    // Paging APPENDS behind the oldest entry held rather than replacing.
    const double oldest = client.notifications().back().timestampMillis;
    client.requestNotifications(3, oldest);
    CHECK(h.stepUntil({&client}, [&] { return !client.notificationsPending(); }, 200));
    CHECK_EQ(client.notifications().size(), static_cast<std::size_t>(6));
    CHECK_EQ(client.notifications()[3].id, std::string("n3"));

    // The tail page is short, which is how the panel learns to stop asking.
    client.requestNotifications(3, client.notifications().back().timestampMillis);
    CHECK(h.stepUntil({&client}, [&] { return !client.notificationsPending(); }, 200));
    CHECK_EQ(client.notifications().size(), static_cast<std::size_t>(7));
    CHECK(!client.notificationsHaveMore());
}

TEST(reading_the_notification_feed_leaves_the_stored_array_intact) {
    Harness h("notices-shape", [](const std::string& path) {
        seedUser(path, "reader", "password7");
        seedNotifications(path, 2);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "reader", "password7"));
    client.requestNotifications(50, 0);
    CHECK(h.stepUntil({&client}, [&] { return !client.notificationsPending(); }, 200));

    // The feed is the one unmodelled table the browser stores as an array. A
    // read through rawTable() would have coerced it to an empty object, and
    // the next save would have written that back over the whole feed.
    Database db;
    std::string error;
    CHECK(db.load(h.dbPath, error));
    CHECK(db.storedTable("notifications").isArray());
    CHECK_EQ(db.storedTable("notifications").size(), static_cast<std::size_t>(2));
}

TEST(a_guild_is_created_named_and_pushed_back_to_its_leader) {
    Harness h("guild-create", [](const std::string& path) {
        seedUser(path, "leader", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "leader", "password7"));
    // Logging in with no guild is answered, not left silent: the panel needs
    // to know it is in the no-guild state rather than the not-asked-yet one.
    CHECK(h.stepUntil({&client}, [&] { return !client.guild().joined; }, 100));

    // Names are upper-cased and must be exactly five alphanumerics.
    client.requestGuildCreate("nope");
    CHECK(!h.stepUntil({&client}, [&] { return client.guild().joined; }, 40));

    client.requestGuildCreate("alpha");
    CHECK(h.stepUntil({&client}, [&] { return client.guild().joined; }, 200));
    CHECK_EQ(client.guild().name, std::string("ALPHA"));
    CHECK_EQ(client.guild().leader, std::string("leader"));
    CHECK_EQ(client.guild().members.size(), static_cast<std::size_t>(1));
    // The leader is online, so their own roster says so.
    CHECK_EQ(client.guild().online.size(), static_cast<std::size_t>(1));

    // A second guild under the same name is refused, and the first survives.
    NetClient other;
    CHECK(loginNew(h, other, "rival", "password7"));
    other.requestGuildCreate("ALPHA");
    CHECK(!h.stepUntil({&client, &other}, [&] { return other.guild().joined; }, 40));
}

TEST(an_invitation_reaches_the_invitee_and_joins_them_on_accept) {
    Harness h("guild-invite", [](const std::string& path) {
        seedUser(path, "leader", "password7");
        seedUser(path, "recruit", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient recruit;
    CHECK(loginAs(h, boss, "leader", "password7"));
    CHECK(loginAs(h, recruit, "recruit", "password7"));

    boss.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&boss, &recruit}, [&] { return boss.guild().joined; }, 200));

    boss.requestGuildInvite("recruit");
    CHECK(h.stepUntil({&boss, &recruit}, [&] { return recruit.guildInvite().waiting; }, 200));
    CHECK_EQ(recruit.guildInvite().guildName, std::string("ALPHA"));
    CHECK_EQ(recruit.guildInvite().fromUsername, std::string("leader"));
    // The arrival flag is what force-opens the panel, and it is raised once.
    CHECK(recruit.guildInvite().justArrived);

    recruit.requestGuildAccept();
    CHECK(h.stepUntil({&boss, &recruit}, [&] { return recruit.guild().joined; }, 200));
    // Both ends see the new roster: the leader's online column changed too.
    CHECK_EQ(boss.guild().members.size(), static_cast<std::size_t>(2));
    CHECK_EQ(recruit.guild().members.size(), static_cast<std::size_t>(2));
    CHECK_EQ(recruit.guild().leader, std::string("leader"));
    // Joining answers whatever invitation was outstanding.
    CHECK(!recruit.guildInvite().waiting);
}

TEST(a_kick_empties_the_kicked_players_guild_and_shortens_everyone_elses) {
    Harness h("guild-kick", [](const std::string& path) {
        seedUser(path, "leader", "password7");
        seedUser(path, "member", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient member;
    CHECK(loginAs(h, boss, "leader", "password7"));
    CHECK(loginAs(h, member, "member", "password7"));
    boss.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&boss, &member}, [&] { return boss.guild().joined; }, 200));
    boss.requestGuildInvite("member");
    CHECK(h.stepUntil({&boss, &member}, [&] { return member.guildInvite().waiting; }, 200));
    member.requestGuildAccept();
    CHECK(h.stepUntil({&boss, &member}, [&] { return member.guild().joined; }, 200));

    // Only the leader may kick: the member's attempt changes nothing.
    member.requestGuildKick("leader");
    CHECK(!h.stepUntil({&boss, &member}, [&] { return !boss.guild().joined; }, 40));

    boss.requestGuildKick("member");
    CHECK(h.stepUntil({&boss, &member}, [&] { return !member.guild().joined; }, 200));
    CHECK_EQ(boss.guild().members.size(), static_cast<std::size_t>(1));
}

TEST(the_last_member_out_disbands_the_guild_and_frees_its_name) {
    Harness h("guild-leave", [](const std::string& path) {
        seedUser(path, "leader", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "leader", "password7"));
    client.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&client}, [&] { return client.guild().joined; }, 200));

    client.requestGuildLeave();
    CHECK(h.stepUntil({&client}, [&] { return !client.guild().joined; }, 200));

    // Disbanded, not left standing empty holding a five-character name.
    client.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&client}, [&] { return client.guild().joined; }, 200));
    CHECK_EQ(client.guild().members.size(), static_cast<std::size_t>(1));
}

TEST(leaving_promotes_the_next_member_rather_than_orphaning_the_guild) {
    Harness h("guild-promote", [](const std::string& path) {
        seedUser(path, "leader", "password7");
        seedUser(path, "member", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient member;
    CHECK(loginAs(h, boss, "leader", "password7"));
    CHECK(loginAs(h, member, "member", "password7"));
    boss.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&boss, &member}, [&] { return boss.guild().joined; }, 200));
    boss.requestGuildInvite("member");
    CHECK(h.stepUntil({&boss, &member}, [&] { return member.guildInvite().waiting; }, 200));
    member.requestGuildAccept();
    CHECK(h.stepUntil({&boss, &member}, [&] { return member.guild().joined; }, 200));

    boss.requestGuildLeave();
    CHECK(h.stepUntil({&boss, &member}, [&] { return !boss.guild().joined; }, 200));
    CHECK(h.stepUntil({&boss, &member},
                      [&] { return member.guild().leader == std::string("member"); }, 200));
    CHECK_EQ(member.guild().members.size(), static_cast<std::size_t>(1));
}

TEST(a_guild_is_written_to_the_database_in_the_browser_builds_own_shape) {
    Harness h("guild-persist", [](const std::string& seedPath) {
        seedUser(seedPath, "leader", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "leader", "password7"));
    client.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&client}, [&] { return client.guild().joined; }, 200));

    // The database is written on a 30-second timer, so the clock is walked
    // past one rather than the test running 750 real ticks to reach it.
    h.clock += 40000.0;
    h.step(1, {&client});

    // Keyed by the upper-cased name, exactly as the browser build stores it,
    // so one file can be served by either server.
    Database db;
    std::string error;
    CHECK(db.load(h.dbPath, error));
    const Json& guilds = db.storedTable("guilds");
    CHECK(guilds.isObject());
    CHECK(guilds.contains("ALPHA"));
    CHECK_EQ(guilds["ALPHA"]["leaderUsername"].asString(), std::string("leader"));
    CHECK_EQ(guilds["ALPHA"]["memberUsernames"].size(), static_cast<std::size_t>(1));
}
