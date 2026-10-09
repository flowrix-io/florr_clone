// The admin database editor: the path edits it is built on, the tree it sends,
// and the server end to end over loopback -- who may use it, and that an edit
// lands on the record AND on a player who is in the world when it is made.

#include "test.h"

#include <cctype>
#include <string>

#include "server/admin_db.h"
#include "server/admin_db_key.h"
#include "server/db.h"
#include "server_harness.h"
#include "shared/net/admin_db.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

// seedUser, loginAs, sawText and say are the harness's own (server_harness.h).

/// Types `/admin db <key>`, as an admin reading the server log would.
bool unlock(Harness& h, NetClient& admin) {
    say(h, admin, "/admin db " + h.server.adminDbKey());
    return h.stepUntil({&admin}, [&] { return admin.adminDb().openRequested; }, 60);
}

/// Waits for the next Result the editor gets, and reports whether it was ok.
bool awaitResult(Harness& h, std::vector<NetClient*> clients, NetClient& admin) {
    const std::uint32_t before = admin.adminDb().resultSeq;
    h.stepUntil(clients, [&] { return admin.adminDb().resultSeq != before; }, 200);
    return admin.adminDb().resultSeq != before && admin.adminDb().resultOk;
}

/// Opens an account in the editor and waits for its document.
bool openAccount(Harness& h, std::vector<NetClient*> clients, NetClient& admin,
                 const std::string& name) {
    admin.adminDbOpen(net::AdminDbScope::Account, name);
    return h.stepUntil(clients, [&] { return admin.adminDb().loaded; }, 200);
}

const net::AdminDbNode* docNode(const NetClient& admin, const net::AdminDbPath& path) {
    return const_cast<net::AdminDbNode&>(admin.adminDb().root).find(path);
}

/// The key as somebody might type it with caps lock on.
std::string upperCase(std::string text) {
    for (char& ch : text) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    return text;
}

} // namespace

// ---------------------------------------------------------------------------
// The pure parts
// ---------------------------------------------------------------------------

TEST(admin_db_paths_edit_what_exists_and_never_invent_a_level) {
    Json doc = Json::parseOrNull(
        R"({"stars":3,"inventory":{"rare":{"petal_basic":2}},"loadout":[null,{"petalType":"rose"}]})");
    std::string error;

    CHECK(admin_db::setAt(doc, {"stars"}, Json(7.0), error));
    CHECK_EQ(doc["stars"].asDouble(), 7.0);

    // A new key directly under an object that exists is an add...
    CHECK(admin_db::setAt(doc, {"inventory", "rare", "petal_rose"}, Json(4.0), error));
    CHECK_EQ(doc["inventory"]["rare"]["petal_rose"].asDouble(), 4.0);
    // ...but a missing level on the way is refused, not conjured.
    CHECK(!admin_db::setAt(doc, {"inventory", "rarre", "petal_rose"}, Json(1.0), error));
    CHECK(!doc["inventory"].contains("rarre"));
    CHECK(!error.empty());

    // Arrays: replace an index, append with "-", and nothing past the end.
    CHECK(admin_db::setAt(doc, {"loadout", "0"}, Json::object(), error));
    CHECK(doc["loadout"][std::size_t{0}].isObject());
    CHECK(admin_db::setAt(doc, {"loadout", "-"}, Json(), error));
    CHECK_EQ(doc["loadout"].size(), std::size_t{3});
    CHECK(!admin_db::setAt(doc, {"loadout", "9"}, Json(), error));
    CHECK(!admin_db::setAt(doc, {"loadout", "01"}, Json(), error));
    // A scalar has no fields to set.
    CHECK(!admin_db::setAt(doc, {"stars", "x"}, Json(1.0), error));

    CHECK(admin_db::removeAt(doc, {"loadout", "0"}, error));
    CHECK_EQ(doc["loadout"].size(), std::size_t{2});
    CHECK_EQ(doc["loadout"][std::size_t{0}]["petalType"].asString(), std::string("rose"));
    CHECK(admin_db::removeAt(doc, {"inventory", "rare", "petal_basic"}, error));
    CHECK(!doc["inventory"]["rare"].contains("petal_basic"));
    CHECK(!admin_db::removeAt(doc, {"inventory", "rare", "petal_basic"}, error));
    CHECK(!admin_db::removeAt(doc, {}, error));

    CHECK(admin_db::nodeAt(doc, {"inventory", "rare", "petal_rose"}) != nullptr);
    CHECK(admin_db::nodeAt(doc, {"inventory", "epic"}) == nullptr);
    CHECK(admin_db::nodeAt(doc, {}) == &doc);
}

TEST(admin_db_tree_round_trips_and_goes_shallow_when_large) {
    const Json small = Json::parseOrNull(R"({"a":1.5,"b":[true,null,"x"],"c":{"d":"e"}})");
    ByteWriter w;
    net::writeAdminDbNode(w, small);
    ByteReader r(w.buffer());
    net::AdminDbNode node;
    CHECK(net::readAdminDbNode(r, node));
    CHECK(node.type == Json::Type::Object);
    CHECK(!node.unloaded);
    CHECK_EQ(node.keys.size(), std::size_t{3});
    CHECK_EQ(node.child("a")->number, 1.5);
    CHECK_EQ(node.child("b")->size, 3u);
    CHECK(node.child("b")->children[0].boolean);
    CHECK(node.child("b")->children[1].type == Json::Type::Null);
    CHECK_EQ(node.find({"c", "d"})->text, std::string("e"));
    CHECK_EQ(node.find({"b", "2"})->text, std::string("x"));

    // Past the budget the children arrive shut, with their sizes still exact,
    // and a string too long to carry arrives as its length alone.
    Json large = Json::object();
    for (int i = 0; i < 400; ++i) {
        Json entry = Json::object();
        entry["text"] = std::string(1000, 'q');
        large["entry" + std::to_string(i)] = entry;
    }
    large["long"] = std::string(net::kAdminDbMaxString + 10, 'z');
    ByteWriter big;
    net::writeAdminDbNode(big, large);
    CHECK(big.size() < net::kAdminDbNodeBudget);
    ByteReader rb(big.buffer());
    net::AdminDbNode shallow;
    CHECK(net::readAdminDbNode(rb, shallow));
    CHECK(!shallow.unloaded);
    CHECK_EQ(shallow.size, 401u);
    CHECK(shallow.child("entry7")->unloaded);
    CHECK_EQ(shallow.child("entry7")->size, 1u);
    CHECK(shallow.child("long")->unloaded);
    CHECK_EQ(shallow.child("long")->size, static_cast<std::uint32_t>(net::kAdminDbMaxString + 10));
}

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

TEST(the_database_editor_is_for_full_admins_only) {
    Harness h("admindb-gate", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "nobody", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient nobody;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, nobody, "nobody", "password7"));

    // The command is denied the way every console command is...
    CHECK(say(h, nobody, "/admin db"));
    CHECK(sawText(nobody, "Command does not exist."));
    CHECK(!nobody.adminDb().openRequested);

    // ...and a raw request, sent without the command, is not answered at all.
    nobody.adminDbList("", 0);
    nobody.adminDbOpen(net::AdminDbScope::Account, "boss");
    h.step(30, {&boss, &nobody});
    CHECK(nobody.adminDb().accounts.empty());
    CHECK(!nobody.adminDb().loaded);

    // A temporary grant opens the console but not the editor: the editor can
    // set the admin flag, and the grant is a loan.
    nobody.joinGame(1920, 1080, {}, "Nobody");
    CHECK(h.stepUntil({&boss, &nobody},
                      [&] { return nobody.status() == NetClient::Status::Playing; }, 200));
    CHECK(say(h, boss, "/admin grant_admin nobody"));
    h.step(10, {&boss, &nobody});
    CHECK(say(h, nobody, "/admin db"));
    CHECK(sawText(nobody, "Only a full admin can open the database editor."));
    CHECK(!nobody.adminDb().openRequested);

    // The full admin's command opens it, with the key, on the account it names.
    CHECK(say(h, boss, "/admin db " + h.server.adminDbKey() + " Nobody"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));
    CHECK_EQ(boss.adminDb().openUsername, std::string("Nobody"));
}

TEST(the_database_editor_key_is_derived_from_the_address_and_the_secret) {
    CHECK(admin_db::isPrivateIPv4("10.0.0.5"));
    CHECK(admin_db::isPrivateIPv4("172.16.4.1"));
    CHECK(admin_db::isPrivateIPv4("172.31.255.255"));
    CHECK(admin_db::isPrivateIPv4("192.168.1.20"));
    CHECK(!admin_db::isPrivateIPv4("172.32.0.1"));
    CHECK(!admin_db::isPrivateIPv4("8.8.8.8"));
    CHECK(!admin_db::isPrivateIPv4("127.0.0.1"));
    CHECK(!admin_db::isPrivateIPv4("10.0.0.5x"));
    CHECK(!admin_db::isPrivateIPv4("10.0.0"));

    const std::string key = admin_db::deriveKey("secret", "192.168.1.20");
    CHECK_EQ(key.size(), std::size_t{16});
    CHECK_EQ(key, admin_db::deriveKey("secret", "192.168.1.20"));
    // Another machine, or another database's secret, is another key: the
    // address alone is guessable, the secret is what makes it a key.
    CHECK(key != admin_db::deriveKey("secret", "192.168.1.21"));
    CHECK(key != admin_db::deriveKey("other", "192.168.1.20"));

    const std::string upper = upperCase(key);
    CHECK(admin_db::keyMatches(key, key));
    CHECK(admin_db::keyMatches(upper, key));
    CHECK(!admin_db::keyMatches(key.substr(1), key));
    CHECK(!admin_db::keyMatches("", key));
    CHECK(!admin_db::keyMatches("", ""));
}

TEST(a_fixed_database_editor_key_is_used_as_is) {
    // The offline page's: the same in every browser, whatever the database's
    // secret or the machine's address.
    Harness h("admindb-fixed-key", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "player", "password7");
    }, dataDir(), 0, [](ServerConfig& config) { config.fixedAdminDbKey = "0ff1ce0ff1ce0ff1"; });
    if (!h.ready) { CHECK(false); return; }
    CHECK_EQ(h.server.adminDbKey(), std::string("0ff1ce0ff1ce0ff1"));

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    // And said where it is asked for. A fixed key is the page's own, written
    // in its source, and that page has no log a player reads: the usage line
    // and the refusal both give it, rather than sending them to a console the
    // page does not have.
    CHECK(say(h, boss, "/admin db"));
    // The usage line's "<key>" arrives escaped, as all console output does.
    CHECK(sawText(boss, "[username]. This server's key is fixed: 0ff1ce0ff1ce0ff1."));
    CHECK(say(h, boss, "/admin db 0000000000000000"));
    CHECK(sawText(boss,
                  "Wrong database editor key. This server's key is fixed: 0ff1ce0ff1ce0ff1."));
    CHECK(!boss.adminDb().openRequested);

    CHECK(say(h, boss, "/admin db 0ff1ce0ff1ce0ff1"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));

    // The Grant Admin button's confirmation carries it as well, which is how
    // a player who has just taken the console learns there is an editor.
    NetClient player;
    CHECK(loginAs(h, player, "player", "password7"));
    CHECK(h.server.grantAdmin(player.sessionToken()));
    CHECK(h.stepUntil({&player}, [&] { return sawText(player, "You are now an admin."); }, 60));
    CHECK(sawText(player, "The database editor's key here is 0ff1ce0ff1ce0ff1"));
}

TEST(a_derived_database_editor_key_is_never_said) {
    // Every other server derives its key from its machine, and the key's
    // whole worth is that only somebody who can read that machine's log has
    // it. No answer -- the usage line, a refusal, the grant's confirmation --
    // may repeat it.
    Harness h("admindb-derived-key", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "player", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::string key = h.server.adminDbKey();
    CHECK_EQ(key.size(), std::size_t{16});
    const std::string upper = upperCase(key);

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(say(h, boss, "/admin db"));
    CHECK(sawText(boss, "The key is printed in the server log at start-up."));
    CHECK(say(h, boss, "/admin db 0000000000000000"));
    CHECK(sawText(boss, "Wrong database editor key."));
    CHECK(!sawText(boss, "fixed"));
    CHECK(!sawText(boss, key));
    CHECK(!sawText(boss, upper));

    NetClient player;
    CHECK(loginAs(h, player, "player", "password7"));
    CHECK(h.server.grantAdmin(player.sessionToken()));
    CHECK(h.stepUntil({&player}, [&] { return sawText(player, "You are now an admin."); }, 60));
    CHECK(!sawText(player, "database editor's key"));
    CHECK(!sawText(player, key));
    CHECK(!sawText(player, upper));
}

TEST(the_database_editor_needs_its_key) {
    Harness h("admindb-key", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    CHECK_EQ(h.server.adminDbKey().size(), std::size_t{16});

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    // A full admin without the key gets the usage line, and with a wrong one
    // a refusal; neither opens the panel...
    CHECK(say(h, boss, "/admin db"));
    CHECK(sawText(boss, "The key is printed in the server log"));
    CHECK(say(h, boss, "/admin db bob"));
    CHECK(sawText(boss, "Wrong database editor key."));
    CHECK(!boss.adminDb().openRequested);

    // ...and a raw request from an admin who has not typed it is not answered.
    boss.adminDbList("", 0);
    boss.adminDbOpen(net::AdminDbScope::Account, "bob");
    h.step(30, {&boss});
    CHECK(boss.adminDb().accounts.empty());
    CHECK(!boss.adminDb().loaded);

    // The right key opens it, case-blind, and the echo does not repeat it.
    const std::string upper = upperCase(h.server.adminDbKey());
    CHECK(say(h, boss, "/admin db " + upper + " bob"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));
    CHECK_EQ(boss.adminDb().openUsername, std::string("bob"));
    CHECK(sawText(boss, "executed: db **** bob"));
    CHECK(!sawText(boss, h.server.adminDbKey()));
    CHECK(!sawText(boss, upper));
    CHECK(openAccount(h, {&boss}, boss, "bob"));

    // The unlock belongs to the connection: a new one starts locked.
    NetClient again;
    CHECK(loginAs(h, again, "boss", "password7"));
    again.adminDbList("", 0);
    h.step(30, {&boss, &again});
    CHECK(again.adminDb().accounts.empty());
}

TEST(the_database_editor_needs_its_key_whatever_the_admin_is_called) {
    // The owner's account name used to open the editor with no key at all,
    // and to satisfy every later request's unlock check with it -- and the
    // editor resets passwords. The key is the server's machine, not a name: a
    // full admin called a19kisme types it like any other.
    Harness h("admindb-key-a19", [](const std::string& path) {
        seedUser(path, "a19kisme", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient admin;
    CHECK(loginAs(h, admin, "a19kisme", "password7"));

    CHECK(say(h, admin, "/admin db"));
    CHECK(sawText(admin, "The key is printed in the server log"));
    CHECK(say(h, admin, "/admin db bob"));
    CHECK(sawText(admin, "Wrong database editor key."));
    CHECK(!admin.adminDb().openRequested);

    admin.adminDbList("", 0);
    admin.adminDbOpen(net::AdminDbScope::Account, "bob");
    h.step(30, {&admin});
    CHECK(admin.adminDb().accounts.empty());
    CHECK(!admin.adminDb().loaded);

    CHECK(say(h, admin, "/admin db " + h.server.adminDbKey() + " bob"));
    CHECK(h.stepUntil({&admin}, [&] { return admin.adminDb().openRequested; }, 60));
    CHECK_EQ(admin.adminDb().openUsername, std::string("bob"));
}

TEST(the_database_editor_finds_and_shows_an_account) {
    Harness h("admindb-show", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bobby", "password7");
        seedUser(path, "rob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));

    boss.adminDbList("OB", 0);
    CHECK(h.stepUntil({&boss}, [&] { return !boss.adminDb().listPending; }, 100));
    CHECK_EQ(boss.adminDb().listTotal, 2u);
    bool sawBobby = false;
    for (const AdminDbAccountRow& row : boss.adminDb().accounts) {
        if (row.username == "bobby") sawBobby = true;
        CHECK(row.username != "boss");
    }
    CHECK(sawBobby);

    // Opened by any spelling, answered under the stored one.
    CHECK(openAccount(h, {&boss}, boss, "BOBBY"));
    CHECK_EQ(boss.adminDb().key, std::string("bobby"));
    CHECK(docNode(boss, {"account", "username"}) != nullptr);
    CHECK(docNode(boss, {"progress"}) != nullptr);
    // The hash is never sent.
    CHECK(docNode(boss, {"account", "password"}) == nullptr);
}

TEST(a_database_edit_reaches_a_player_in_the_world) {
    Harness h("admindb-live", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient bob;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    CHECK(loginAs(h, bob, "bob", "password7"));
    bob.joinGame(1920, 1080, {}, "Bob");
    CHECK(h.stepUntil({&boss, &bob}, [&] { return bob.status() == NetClient::Status::Playing; },
                      200));
    CHECK(openAccount(h, {&boss, &bob}, boss, "bob"));

    // The player is told at once: the profile is re-sent with the new figures.
    boss.adminDbSet({"progress", "totalXP"}, "50000");
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    CHECK(h.stepUntil({&boss, &bob}, [&] { return bob.profile().totalXp == 50000.0; }, 100));
    CHECK(bob.profile().level > 1);
    boss.adminDbSet({"progress", "stars"}, "1234");
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    CHECK(h.stepUntil({&boss, &bob}, [&] { return bob.profile().stars == 1234.0; }, 100));

    // And it is on the BODY, not only the record: a save writes the body back
    // into the record, and that must not undo the edit.
    CHECK(say(h, boss, "/admin save"));
    boss.adminDbFetch({});
    h.step(10, {&boss, &bob});
    const net::AdminDbNode* xp = docNode(boss, {"progress", "totalXP"});
    CHECK(xp != nullptr && xp->number == 50000.0);
    const net::AdminDbNode* stars = docNode(boss, {"progress", "stars"});
    CHECK(stars != nullptr && stars->number == 1234.0);

    // An inventory count, added where there was none.
    boss.adminDbSet({"progress", "inventory"}, R"({"rare":{"petal_rose":3}})");
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    const std::uint16_t rose = content().petalIndex("rose");
    CHECK(h.stepUntil({&boss, &bob}, [&] {
        for (const Profile::Stack& stack : bob.profile().inventory) {
            if (stack.petalIndex == rose && stack.rarity == Rarity::Rare && stack.count == 3) {
                return true;
            }
        }
        return false;
    }, 100));
}

TEST(the_database_editor_guards_identity_and_says_what_was_stored) {
    Harness h("admindb-guards", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    CHECK(openAccount(h, {&boss}, boss, "bob"));

    boss.adminDbSet({"account", "username"}, "\"robert\"");
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbSet({"account", "password"}, "\"hunter2\"");
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbRemove({"account", "id"});
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbSet({"progress", "stars"}, "not json");
    CHECK(!awaitResult(h, {&boss}, boss));

    // `tp` is worked out from the level, so writing it changes nothing, and
    // the editor says so rather than "saved".
    boss.adminDbSet({"progress", "tp"}, "999");
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(boss.adminDb().resultMessage.find("Not saved") != std::string::npos);

    // A flag that is not a boolean is not stored as one, and the editor says
    // it was not saved rather than claiming it was.
    boss.adminDbSet({"account", "muted"}, "\"yes\"");
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(boss.adminDb().resultMessage.find("Not saved") != std::string::npos);
    h.step(5, {&boss});
    CHECK(docNode(boss, {"account", "muted"}) == nullptr);

    // A real one is, and it is listed as one.
    boss.adminDbSet({"account", "muted"}, "true");
    CHECK(awaitResult(h, {&boss}, boss));
    h.step(5, {&boss});
    CHECK(docNode(boss, {"account", "muted"}) != nullptr);
    CHECK((boss.adminDb().flags & net::AdminDbMuted) != 0);

    // Back to the default reads back as absent, and is still a save.
    boss.adminDbSet({"account", "muted"}, "false");
    CHECK(awaitResult(h, {&boss}, boss));
    h.step(5, {&boss});
    CHECK(docNode(boss, {"account", "muted"}) == nullptr);
}

TEST(the_database_editor_never_changes_the_admin_flag) {
    Harness h("admindb-adminflag", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "other", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));

    // Not granted: in any spelling, as a set or as an add.
    CHECK(openAccount(h, {&boss}, boss, "bob"));
    for (const char* value : {"true", "1", "\"yes\"", "{}"}) {
        boss.adminDbSet({"account", "admin"}, value);
        CHECK(!awaitResult(h, {&boss}, boss));
        CHECK(boss.adminDb().resultMessage.find("admin flag") != std::string::npos);
    }
    boss.adminDbSet({"account", "admin", "nested"}, "true");
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbFetch({});
    h.step(5, {&boss});
    CHECK(docNode(boss, {"account", "admin"}) == nullptr);
    CHECK((boss.adminDb().flags & net::AdminDbIsAdmin) == 0);

    // Not taken away either: not from another admin, and not from yourself.
    CHECK(openAccount(h, {&boss}, boss, "other"));
    boss.adminDbSet({"account", "admin"}, "false");
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbRemove({"account", "admin"});
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(openAccount(h, {&boss}, boss, "boss"));
    boss.adminDbRemove({"account", "admin"});
    CHECK(!awaitResult(h, {&boss}, boss));

    // What the database holds, read back through the list.
    boss.adminDbList("", 0);
    CHECK(h.stepUntil({&boss}, [&] { return !boss.adminDb().listPending; }, 100));
    for (const AdminDbAccountRow& row : boss.adminDb().accounts) {
        const bool admin = (row.flags & net::AdminDbIsAdmin) != 0;
        CHECK_EQ(admin, row.username != "bob");
    }
}

TEST(the_database_editor_resets_a_password) {
    Harness h("admindb-actions", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient bob;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    CHECK(loginAs(h, bob, "bob", "password7"));

    // A reset signs whoever holds the account out, and the new one works.
    boss.adminDbSetPassword("bob", "brandnew9");
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    CHECK(h.stepUntil({&boss, &bob},
                      [&] { return bob.status() != NetClient::Status::LoggedIn; }, 100));
    NetClient again;
    CHECK(loginAs(h, again, "bob", "brandnew9"));

    // The account is still there: the editor has no way to delete one.
    boss.adminDbList("bob", 0);
    CHECK(h.stepUntil({&boss, &again}, [&] { return !boss.adminDb().listPending; }, 100));
    CHECK_EQ(boss.adminDb().listTotal, 1u);
}

TEST(the_database_editor_edits_a_raw_table) {
    Harness h("admindb-table", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    CHECK(say(h, boss, "/admin notification super_craft first"));
    CHECK(say(h, boss, "/admin notification super_craft second"));

    boss.adminDbTables();
    CHECK(h.stepUntil({&boss}, [&] {
        for (const AdminDbTableRow& t : boss.adminDb().tables) {
            if (t.name == "notifications") return true;
        }
        return false;
    }, 100));
    for (const AdminDbTableRow& t : boss.adminDb().tables) {
        CHECK(t.name != "ipSalt");
        if (t.name == "notifications") {
            CHECK(t.isArray);
            CHECK_EQ(t.entries, 2u);
        }
    }

    boss.adminDbOpen(net::AdminDbScope::Table, "notifications");
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().loaded; }, 100));
    CHECK(boss.adminDb().root.type == Json::Type::Array);
    CHECK_EQ(boss.adminDb().root.size, 2u);

    // Through the array accessor: an object-coercing write would have
    // replaced the whole feed with {}.
    boss.adminDbRemove({"0"});
    CHECK(awaitResult(h, {&boss}, boss));
    h.step(5, {&boss});
    CHECK(boss.adminDb().root.type == Json::Type::Array);
    CHECK_EQ(boss.adminDb().root.size, 1u);
    CHECK_EQ(docNode(boss, {"0", "message"})->text, std::string("second"));

    boss.adminDbSet({"0", "message"}, "\"edited\"");
    CHECK(awaitResult(h, {&boss}, boss));
    boss.requestNotifications(50, 0);
    CHECK(h.stepUntil({&boss}, [&] {
        return !boss.notifications().empty() && boss.notifications().front().message == "edited";
    }, 100));

    // A whole table is not replaced from here.
    boss.adminDbSet({}, "[]");
    CHECK(!awaitResult(h, {&boss}, boss));
}
