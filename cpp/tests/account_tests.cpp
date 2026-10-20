// Guest accounts and the Account card's requests.
//
// A first visit plays on a guest account the server makes and names; the
// Account card is where its owner picks a username -- once, and only as a
// guest -- sets a password, and signs in to another account. The database
// rules come first, then the round trips over loopback.

#include "test.h"

#include <cstdio>
#include <string>

#include "client/net_client.h"
#include "server/db.h"
#include "server/guilds.h"
#include "server_harness.h"
#include "test_data.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

std::int64_t gNowMillis = 0;
std::int64_t testClock() { return gNowMillis; }

/// Deletes the scratch file when it goes; declared above the Database so it
/// goes after it (~Database saves a dirty database on the way out).
struct ScratchFile {
    std::string path = tempUnique("florr-account", ".json");
    ~ScratchFile() {
        std::remove(path.c_str());
        std::remove((path + ".tmp").c_str());
    }
};

struct Fixture {
    ScratchFile file;   // must stay above `db`
    Database db;

    Fixture() {
        std::remove(file.path.c_str());
        std::string error;
        db.load(file.path, error);
        db.setPasswordCost(4);
    }
};

bool waitForAuth(Harness& h, NetClient& client) {
    return h.stepUntil({&client}, [&] { return client.authAnswered; });
}

/// Connects and plays as a new guest, as a first visit does.
bool joinAsGuest(Harness& h, NetClient& client) {
    if (!connectClient(h, client)) return false;
    client.requestGuest();
    return h.stepUntil({&client}, [&] {
        return client.status() == NetClient::Status::LoggedIn && !client.profile().username.empty();
    });
}

} // namespace

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

TEST(a_guest_account_is_named_by_the_server_and_has_no_password_anyone_knows) {
    Fixture f;
    const CreateResult made = f.db.createGuest();
    CHECK(made.ok());
    if (!made.account) return;
    const std::string name = made.account->username;
    CHECK(Database::isGuestUsername(name));
    CHECK(made.account->guest);
    CHECK(!made.account->passwordChosen);

    // No password opens it -- not the empty one an unset hash would let
    // through on a build that predates the flag.
    CHECK(!f.db.verifyPassword(name, ""));
    CHECK(!f.db.verifyPassword(name, "password"));

    // Two guests are two accounts.
    const CreateResult second = f.db.createGuest();
    CHECK(second.ok());
    if (second.account) CHECK(second.account->username != name);
}

TEST(the_guest_flags_survive_a_save_and_old_accounts_read_as_registered_ones) {
    std::string path;
    std::string guestName;
    {
        Fixture f;
        path = f.file.path + ".keep";
        const CreateResult guest = f.db.createGuest();
        CHECK(guest.ok());
        if (guest.account) guestName = guest.account->username;
        CHECK(f.db.createUser("registered", "password7").ok());
        const Json row = accountRecordJson(*f.db.findUser("registered"));
        // Written only while they say something, so an untouched account's row
        // is what it always was.
        CHECK(row["guest"].isNull());
        CHECK(row["passwordChosen"].isNull());
        f.db.toJson().writeFile(path, 0);
    }
    Database reread;
    std::string error;
    CHECK(reread.load(path, error));
    const Account* guest = reread.findUser(guestName);
    CHECK(guest != nullptr);
    if (guest) {
        CHECK(guest->guest);
        CHECK(!guest->passwordChosen);
        CHECK(guest->extra.isNull() || !guest->extra.contains("guest"));
    }
    const Account* registered = reread.findUser("registered");
    CHECK(registered != nullptr);
    if (registered) {
        CHECK(!registered->guest);
        CHECK(registered->passwordChosen);
    }
    std::remove(path.c_str());
}

TEST(a_rename_moves_the_account_its_sessions_and_its_place_in_the_file) {
    Fixture f;
    CHECK(f.db.createUser("first", "password7").ok());
    const CreateResult guest = f.db.createGuest();
    CHECK(f.db.createUser("last", "password7").ok());
    if (!guest.account) { CHECK(false); return; }
    const std::string userId = guest.account->id;
    const std::string oldName = guest.account->username;
    const std::string token = f.db.createSession(userId, oldName);

    std::string reason;
    CHECK(f.db.renameUser(userId, "Rosebud", reason));
    CHECK(f.db.findUser(oldName) == nullptr);
    const Account* renamed = f.db.findUser("rosebud");
    CHECK(renamed != nullptr);
    if (renamed) {
        CHECK_EQ(renamed->username, std::string("Rosebud"));
        CHECK_EQ(renamed->id, userId);
        CHECK(!renamed->guest);
    }
    CHECK(f.db.findUserById(userId) == renamed);
    // In the old row's place, not appended: a save diffs cleanly.
    CHECK_EQ(f.db.usernames().size(), static_cast<std::size_t>(3));
    if (f.db.usernames().size() == 3) CHECK_EQ(f.db.usernames()[1], std::string("Rosebud"));

    // The token minted under the old name still resumes, as the new name.
    const Database::Session* session = f.db.resolveSession(token);
    CHECK(session != nullptr);
    if (session) CHECK_EQ(session->username, std::string("Rosebud"));
}

TEST(a_rename_refuses_a_taken_a_malformed_and_a_guest_shaped_name) {
    Fixture f;
    CHECK(f.db.createUser("Taken", "password7").ok());
    const CreateResult guest = f.db.createGuest();
    if (!guest.account) { CHECK(false); return; }
    const std::string userId = guest.account->id;
    const std::string oldName = guest.account->username;

    std::string reason;
    CHECK(!f.db.renameUser(userId, "taken", reason));   // any case
    CHECK(!reason.empty());
    CHECK(!f.db.renameUser(userId, "no spaces", reason));
    CHECK(!f.db.renameUser(userId, "ab", reason));
    CHECK(!f.db.renameUser(userId, "User12345678", reason));
    CHECK(!f.db.renameUser("no-such-id", "Fresh", reason));

    // Nothing moved for any of them.
    const Account* still = f.db.findUser(oldName);
    CHECK(still != nullptr);
    if (still) CHECK(still->guest);
}

TEST(setting_a_password_marks_it_chosen) {
    Fixture f;
    const CreateResult guest = f.db.createGuest();
    if (!guest.account) { CHECK(false); return; }
    const std::string name = guest.account->username;
    std::string reason;
    CHECK(f.db.setPassword(name, "chosen-password", reason));
    const Account* account = f.db.findUser(name);
    CHECK(account != nullptr && account->passwordChosen);
    CHECK(f.db.verifyPassword(name, "chosen-password"));
}

TEST(a_token_is_kept_alive_by_use_only_while_it_is_the_accounts_only_key) {
    Fixture f;
    f.db.setClock(&testClock);
    gNowMillis = 1000000000000;
    const CreateResult guest = f.db.createGuest();
    CHECK(f.db.createUser("registered", "password7").ok());
    if (!guest.account) { CHECK(false); return; }
    const std::string guestToken =
        f.db.createSession(guest.account->id, guest.account->username);
    const Account* registered = f.db.findUser("registered");
    const std::string registeredToken =
        f.db.createSession(registered->id, registered->username);

    // Twenty days, a resume each, twice over: forty days in all.
    gNowMillis += 20LL * 86400000;
    CHECK(f.db.resolveSession(guestToken) != nullptr);
    CHECK(f.db.resolveSession(registeredToken) != nullptr);
    gNowMillis += 20LL * 86400000;
    // The guest's term restarted at its last use; the registered account's did
    // not, and its owner can sign in again with the password.
    CHECK(f.db.resolveSession(guestToken) != nullptr);
    CHECK(f.db.resolveSession(registeredToken) == nullptr);
}

TEST(a_guest_is_hashed_at_the_cheapest_cost_and_a_registration_is_not) {
    // A first visit is something anyone can ask for, and at the full cost every
    // one is a quarter of a second of CPU. A random 256-bit password needs no
    // stretching to be unguessable; a password a person chose does.
    Fixture f;
    f.db.setPasswordCost(10);
    const CreateResult guest = f.db.createGuest();
    CHECK(f.db.createUser("chooser", "password7").ok());
    if (!guest.account) { CHECK(false); return; }
    const std::string& guestHash = guest.account->passwordHash;
    const std::string& chosenHash = f.db.findUser("chooser")->passwordHash;
    CHECK(guestHash.size() > 7 && guestHash.compare(4, 3, "04$") == 0);
    CHECK(chosenHash.size() > 7 && chosenHash.compare(4, 3, "10$") == 0);
}

TEST(an_addresses_standing_is_what_its_own_recent_accounts_did) {
    Fixture f;
    f.db.setClock(&testClock);
    gNowMillis = 1000000000000;
    constexpr std::int64_t kDay = 86400000;
    const std::string school = "hash-school";

    // Made a week ago and played; made a week ago and never touched; made an
    // hour ago and not touched yet; and one from somewhere else entirely.
    gNowMillis -= 7 * kDay;
    const CreateResult played = f.db.createGuest(school);
    const CreateResult abandoned = f.db.createGuest(school);
    gNowMillis += 7 * kDay - 3600000;
    const CreateResult fresh = f.db.createGuest(school);
    const CreateResult elsewhere = f.db.createGuest("hash-elsewhere");
    gNowMillis += 3600000;
    if (!played.account || !abandoned.account || !fresh.account || !elsewhere.account) {
        CHECK(false);
        return;
    }
    f.db.progress(played.account->id).totalXp = 120;
    f.db.progress(elsewhere.account->id).totalXp = 50;

    const Database::CreatorStanding standing = f.db.creatorStanding(school, kDay, 30 * kDay);
    CHECK_EQ(standing.played, 1);
    // The week-old untouched one is past the idle window; the new one is in it.
    CHECK_EQ(standing.idleToday, 1);

    // Past the standing window, nothing counts.
    const Database::CreatorStanding later =
        f.db.creatorStanding(school, kDay, 3 * kDay);
    CHECK_EQ(later.played, 0);

    // A deleted account takes its part of the standing with it.
    CHECK(f.db.eraseUser(fresh.account->username));
    CHECK_EQ(f.db.creatorStanding(school, kDay, 30 * kDay).idleToday, 0);

    // An unknown creator has no standing, and no account is counted for it.
    CHECK_EQ(f.db.creatorStanding("", kDay, 30 * kDay).played, 0);
}

TEST(an_addresses_standing_survives_a_reload_in_any_file_order) {
    std::string path;
    {
        Fixture f;
        f.db.setClock(&testClock);
        gNowMillis = 2000000000000;
        path = f.file.path + ".order";
        // Two accounts written out of creation order: the newer one first.
        gNowMillis += 1000;
        const CreateResult newer = f.db.createGuest("hash-order");
        gNowMillis -= 40LL * 86400000;
        const CreateResult older = f.db.createGuest("hash-order");
        gNowMillis += 40LL * 86400000;
        if (!newer.account || !older.account) { CHECK(false); return; }
        f.db.progress(newer.account->id).totalXp = 5;
        f.db.toJson().writeFile(path, 0);
    }
    Database reread;
    reread.setClock(&testClock);
    std::string error;
    CHECK(reread.load(path, error));
    // Walked newest first, the old account ends the walk without hiding the
    // new one behind it.
    CHECK_EQ(reread.creatorStanding("hash-order", 86400000, 30LL * 86400000).played, 1);
    std::remove(path.c_str());
}

// ---------------------------------------------------------------------------
// Over the wire
// ---------------------------------------------------------------------------

TEST(a_first_visit_plays_on_a_guest_account_the_server_makes) {
    Harness h("guest-join", {}, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAsGuest(h, client));
    CHECK(Database::isGuestUsername(client.profile().username));
    CHECK(client.profile().guest);
    CHECK(!client.profile().hasPassword);
    CHECK(!client.sessionToken().empty());

    // The token is the account: a second connection resumes it.
    NetClient again;
    CHECK(connectClient(h, again));
    again.authAnswered = false;
    again.resumeSession(client.sessionToken());
    CHECK(waitForAuth(h, again));
    CHECK_EQ(static_cast<int>(again.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(again.profile().username, client.profile().username);

    // And it can play.
    again.joinGame(1280, 720);
    CHECK(h.stepUntil({&again}, [&] { return again.status() == NetClient::Status::Playing; }));
}

TEST(a_guest_sets_its_username_once_and_keeps_its_session) {
    Harness h("guest-rename", {}, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAsGuest(h, client));
    const std::string token = client.sessionToken();

    client.requestSetUsername("Petalwise");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));
    CHECK(client.usernameOutcome().ok);
    client.usernameOutcome().pending = false;
    CHECK(awaitProfile(h, client, [](const Profile& p) {
        return p.username == "Petalwise" && !p.guest;
    }));
    // A name is not an auth answer: the session carries on.
    CHECK(client.status() == NetClient::Status::LoggedIn);

    // Once only. The flag the first rename cleared is what refuses the second.
    client.requestSetUsername("Twicenamed");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));
    CHECK(!client.usernameOutcome().ok);
    CHECK(!client.usernameOutcome().message.empty());
    CHECK(h.server.database().findUser("Twicenamed") == nullptr);

    // The token issued before the rename still opens the account, by its new name.
    NetClient later;
    CHECK(connectClient(h, later));
    later.authAnswered = false;
    later.resumeSession(token);
    CHECK(waitForAuth(h, later));
    CHECK_EQ(static_cast<int>(later.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(later.profile().username, std::string("Petalwise"));
}

TEST(a_registered_account_cannot_set_its_username) {
    Harness h("rename-registered", {}, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "settled", "password7"));
    CHECK(!client.profile().guest);
    CHECK(client.profile().hasPassword);

    client.requestSetUsername("Unsettled");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));
    CHECK(!client.usernameOutcome().ok);
    CHECK(h.server.database().findUser("settled") != nullptr);
    CHECK(h.server.database().findUser("Unsettled") == nullptr);
}

TEST(a_guest_refused_a_taken_name_is_still_a_guest) {
    Harness h("rename-taken", [](const std::string& path) { seedUser(path, "Occupied", "password7"); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAsGuest(h, client));
    client.requestSetUsername("occupied");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));
    CHECK(!client.usernameOutcome().ok);
    client.usernameOutcome().pending = false;

    // The refusal spent nothing: a free name still goes through.
    client.requestSetUsername("Vacant");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));
    CHECK(client.usernameOutcome().ok);
}

TEST(a_guest_sets_a_password_without_a_current_one_and_can_then_log_in) {
    Harness h("guest-password", {}, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAsGuest(h, client));
    client.requestSetUsername("Keyholder");
    CHECK(h.stepUntil({&client}, [&] { return client.usernameOutcome().pending; }));

    // No current password to give: the session is the proof.
    client.requestChangePassword("", "first-chosen");
    CHECK(h.stepUntil({&client}, [&] { return client.passwordOutcome().pending; }));
    CHECK(client.passwordOutcome().ok);
    client.passwordOutcome().pending = false;
    CHECK(awaitProfile(h, client, [](const Profile& p) { return p.hasPassword; }));

    NetClient elsewhere;
    CHECK(connectClient(h, elsewhere));
    elsewhere.authAnswered = false;
    elsewhere.requestLogin("Keyholder", "first-chosen");
    CHECK(waitForAuth(h, elsewhere));
    CHECK_EQ(static_cast<int>(elsewhere.authStatus), static_cast<int>(net::AuthStatus::Ok));

    // From here the account proves itself like any other: a change with no
    // current password is refused.
    elsewhere.requestChangePassword("", "second-chosen");
    CHECK(h.stepUntil({&elsewhere}, [&] { return elsewhere.passwordOutcome().pending; }));
    CHECK(!elsewhere.passwordOutcome().ok);
}

TEST(a_refused_switch_keeps_the_session_and_a_good_one_replaces_the_account) {
    Harness h("switch-account", [](const std::string& path) { seedUser(path, "main", "password7"); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAsGuest(h, client));
    const std::string guestName = client.profile().username;

    client.authAnswered = false;
    client.requestLogin("main", "wrong-password");
    CHECK(h.stepUntil({&client}, [&] { return client.switchOutcome().pending; }));
    CHECK(!client.switchOutcome().ok);
    CHECK(!client.switchOutcome().message.empty());
    client.switchOutcome().pending = false;
    // Still the guest, on both sides: a mistyped password signs nobody out.
    CHECK(client.status() == NetClient::Status::LoggedIn);
    CHECK_EQ(client.profile().username, guestName);
    CHECK(!client.authAnswered);
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    // From inside the world, the right password: the account and the world go.
    client.requestLogin("main", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.switchOutcome().pending; }));
    CHECK(client.switchOutcome().ok);
    CHECK(client.status() == NetClient::Status::LoggedIn);
    CHECK(awaitProfile(h, client, [](const Profile& p) { return p.username == "main"; }));
    CHECK(!client.profile().guest);
}

TEST(a_guest_in_a_guild_takes_its_new_name_into_the_roster) {
    Harness h("rename-guild", [](const std::string& path) { seedUser(path, "boss", "password7"); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    NetClient guest;
    CHECK(joinAsGuest(h, guest));
    const std::string guestName = guest.profile().username;

    boss.requestGuildCreate("ALPHA");
    CHECK(h.stepUntil({&boss, &guest}, [&] { return boss.guild().joined; }, 200));
    boss.requestGuildInvite(guestName);
    CHECK(h.stepUntil({&boss, &guest}, [&] { return guest.guildInvite().waiting; }, 200));
    guest.requestGuildAccept();
    CHECK(h.stepUntil({&boss, &guest}, [&] { return guest.guild().joined; }, 200));

    guest.requestSetUsername("Recruit");
    CHECK(h.stepUntil({&boss, &guest}, [&] { return guest.usernameOutcome().pending; }));
    CHECK(guest.usernameOutcome().ok);

    // The leader's roster names the member by the new name, and the record
    // under it does too -- so the guild still counts the account as a member.
    const auto rosterHas = [](const NetClient& client, const std::string& name) {
        for (const auto& member : client.guild().members) {
            if (member.name == name) return true;
        }
        return false;
    };
    CHECK(h.stepUntil({&boss, &guest}, [&] { return rosterHas(boss, "Recruit"); }, 200));
    CHECK(!rosterHas(boss, guestName));
    const Json& guild = h.server.database().storedTable("guilds")["ALPHA"];
    CHECK_EQ(guildMemberIndex(guild, "Recruit") >= 0, true);
    CHECK_EQ(guildMemberIndex(guild, guestName), -1);
}
