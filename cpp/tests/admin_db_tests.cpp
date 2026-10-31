// The admin database editor: the path edits it is built on, the tree it sends,
// and the server end to end over loopback -- who may use it, and that an edit
// lands on the record AND on a player who is in the world when it is made.

#include "test.h"

#include <cctype>
#include <chrono>
#include <cstdio>
#include <string>

#include <sys/stat.h>

#include "server/account_search.h"
#include "server/admin_db.h"
#include "server/admin_db_key.h"
#include "server/db.h"
#include "server_harness.h"
#include "test_data.h"
#include "shared/core/civil_date.h"
#include "shared/game/config.h"
#include "shared/net/admin_db.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

// seedUser, loginAs, sawText and say are the harness's own (server_harness.h).

/// Types `/admin db <key>`, as an admin reading the key file would.
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
    // And back to JSON, which is what the text view shows.
    Json back;
    CHECK(net::adminDbNodeJson(node, back));
    CHECK_EQ(back.dump(), small.dump());

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
    // Text missing a part would save as that part deleted, so there is none.
    CHECK(!net::adminDbNodeJson(shallow, back));
}

TEST(a_text_edit_applies_only_what_the_admin_changed) {
    const Json base = Json::parseOrNull(
        R"({"stars":3,"totalXP":100,"inventory":{"rare":{"petal_rose":2,"petal_basic":1}},)"
        R"("loadout":[{"petalType":"rose"},null],"old":true})");
    const Json edited = Json::parseOrNull(
        R"({"stars":9,"totalXP":100,"inventory":{"rare":{"petal_rose":2},"epic":{"petal_rose":1}},)"
        R"("loadout":[null,{"petalType":"rose"}],"new":"x"})");
    const std::vector<admin_db::Change> changes = admin_db::diff(base, edited);
    // stars, rare.petal_basic gone, epic added, the loadout WHOLE, old gone,
    // new added -- and nothing for what is the same on both sides.
    CHECK_EQ(changes.size(), std::size_t{6});
    bool loadoutWhole = false;
    for (const admin_db::Change& change : changes) {
        CHECK(change.path.front() != "totalXP");
        if (change.path == net::AdminDbPath{"loadout"}) loadoutWhole = !change.remove;
    }
    CHECK(loadoutWhole);
    CHECK(admin_db::diff(base, base).empty());

    // Applied to the record as it is NOW. The player earned XP and a rose
    // while the admin typed; neither is undone, and every change lands.
    Json now = Json::parseOrNull(
        R"({"stars":3,"totalXP":250,"inventory":{"rare":{"petal_rose":3,"petal_basic":1}},)"
        R"("loadout":[{"petalType":"rose"},null],"old":true})");
    std::string error;
    CHECK(admin_db::patchAt(now, {}, changes, error));
    CHECK_EQ(now["stars"].asDouble(), 9.0);
    CHECK_EQ(now["totalXP"].asDouble(), 250.0);
    CHECK_EQ(now["inventory"]["rare"]["petal_rose"].asDouble(), 3.0);
    CHECK(!now["inventory"]["rare"].contains("petal_basic"));
    CHECK_EQ(now["inventory"]["epic"]["petal_rose"].asDouble(), 1.0);
    CHECK(now["loadout"].items()[0].isNull());
    CHECK(!now.contains("old"));
    CHECK_EQ(now["new"].asString(), std::string("x"));

    // Below a path, and all or none: a change under a level that has gone
    // since is refused, and the change before it is not left behind.
    Json doc = Json::object();
    doc["progress"] = Json::parseOrNull(R"({"stars":3,"inventory":{}})");
    Json moved = base;
    moved["inventory"]["rare"]["petal_new"] = Json(1.0);
    std::vector<admin_db::Change> late = admin_db::diff(base, edited);
    for (const admin_db::Change& change : admin_db::diff(base, moved)) late.push_back(change);
    CHECK(!admin_db::patchAt(doc, {"progress"}, late, error));
    CHECK_EQ(doc["progress"]["stars"].asDouble(), 3.0);
    CHECK(!admin_db::patchAt(doc, {"elsewhere"}, changes, error));
    // A removal of what is already gone is already done.
    Json bare = Json::parseOrNull(R"({"stars":1})");
    CHECK(admin_db::patchAt(bare, {}, {{{"old"}, true, Json()}}, error));
    CHECK_EQ(bare.dump(), std::string(R"({"stars":1})"));
}

TEST(a_text_longer_than_a_wire_string_travels_whole) {
    // The wire's own string stops at 64 KiB; a record's JSON need not.
    const std::string text(100 * 1024, 'a');
    ByteWriter w;
    net::writeAdminDbText(w, text);
    w.u8(7);
    ByteReader r(w.buffer());
    CHECK(net::readAdminDbText(r) == text);
    CHECK_EQ(r.u8(), 7);
    CHECK(r.ok());

    // A length the frame does not hold, or past the cap, fails the reader.
    ByteWriter lie;
    lie.u32(1000);
    lie.raw("abc", 3);
    ByteReader rl(lie.buffer());
    CHECK(net::readAdminDbText(rl).empty());
    CHECK(!rl.ok());
    ByteWriter over;
    net::writeAdminDbText(over, std::string(net::kAdminDbMaxText + 1, 'b'));
    ByteReader ro(over.buffer());
    CHECK(net::readAdminDbText(ro).empty());
    CHECK(!ro.ok());
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

TEST(a_new_key_files_key_is_derived_from_the_address_and_the_secret) {
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

    // Exact: it is a password, and one an operator may have chosen.
    const std::string upper = upperCase(key);
    CHECK(admin_db::keyMatches(key, key));
    CHECK(upper != key);
    CHECK(!admin_db::keyMatches(upper, key));
    CHECK(admin_db::keyMatches("Hunter2!", "Hunter2!"));
    CHECK(!admin_db::keyMatches("hunter2!", "Hunter2!"));
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

TEST(the_key_files_key_is_never_said) {
    // Every other server keeps its key in a file on its machine, and the
    // key's whole worth is that only somebody who can read that machine's
    // files has it. No answer -- the usage line, a refusal, the grant's
    // confirmation -- may repeat it.
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
    CHECK(sawText(boss, "The key is in admin_db_key.txt, beside the database on the server."));
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
    CHECK(sawText(boss, "The key is in admin_db_key.txt"));
    CHECK(say(h, boss, "/admin db bob"));
    CHECK(sawText(boss, "Wrong database editor key."));
    CHECK(!boss.adminDb().openRequested);

    // ...and a raw request from an admin who has not typed it is not answered.
    boss.adminDbList("", 0);
    boss.adminDbOpen(net::AdminDbScope::Account, "bob");
    h.step(30, {&boss});
    CHECK(boss.adminDb().accounts.empty());
    CHECK(!boss.adminDb().loaded);

    // The key in the wrong case is a wrong key...
    const std::string upper = upperCase(h.server.adminDbKey());
    const std::uint64_t mark = boss.chatSequence();
    CHECK(say(h, boss, "/admin db " + upper + " bob"));
    CHECK(sawTextSince(boss, mark, "Wrong database editor key."));
    CHECK(!boss.adminDb().openRequested);

    // ...and the right one opens it, and the echo does not repeat it.
    CHECK(say(h, boss, "/admin db " + h.server.adminDbKey() + " bob"));
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

TEST(the_key_file_is_read_as_one_typeable_word) {
    const std::string dir = tempDir("admindb-keyfile");
    const std::string path = dir + "/" + admin_db::kKeyFileName;
    std::string key;
    std::string error;

    // The whitespace around it is not part of it: an editor's newline, a
    // Windows one, an indent.
    CHECK(writeText(path, "  Hunter2!-x\r\n\n"));
    CHECK(admin_db::readKeyFile(path, key, error));
    CHECK_EQ(key, std::string("Hunter2!-x"));

    // Anything `/admin db <key>` could not carry is refused, not truncated.
    CHECK(writeText(path, "two words\n"));
    CHECK(!admin_db::readKeyFile(path, key, error));
    CHECK(key.empty());
    CHECK(error.find("space") != std::string::npos);
    CHECK(writeText(path, "tab\tbed"));
    CHECK(!admin_db::readKeyFile(path, key, error));
    CHECK(writeText(path, " \n\t\n"));
    CHECK(!admin_db::readKeyFile(path, key, error));
    CHECK(error.find("empty") != std::string::npos);
    CHECK(writeText(path, std::string(admin_db::kMaxKeyLength, 'k')));
    CHECK(admin_db::readKeyFile(path, key, error));
    CHECK(writeText(path, std::string(admin_db::kMaxKeyLength + 1, 'k')));
    CHECK(!admin_db::readKeyFile(path, key, error));

    // A new file is the owner's alone, and an existing one is never replaced.
    std::remove(path.c_str());
    CHECK(!admin_db::readKeyFile(path, key, error));
    CHECK(error.find("no such file") != std::string::npos);
    CHECK(admin_db::createKeyFile(path, "first", error));
    struct stat info {};
    CHECK(::stat(path.c_str(), &info) == 0);
    CHECK_EQ(static_cast<int>(info.st_mode & 0777), 0600);
    CHECK(!admin_db::createKeyFile(path, "second", error));
    CHECK(admin_db::readKeyFile(path, key, error));
    CHECK_EQ(key, std::string("first"));
    std::remove(path.c_str());

    CHECK_EQ(admin_db::keyFileFor("/srv/game/dist/inventory.json"),
             std::string("/srv/game/dist/admin_db_key.txt"));
    CHECK_EQ(admin_db::keyFileFor("inventory.json"), std::string("admin_db_key.txt"));
}

TEST(a_first_start_writes_the_key_file_beside_the_database) {
    Harness h("admindb-keyfile-new", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    const std::string path = admin_db::keyFileFor(h.dbPath);
    CHECK_EQ(h.server.adminDbKeyPath(), path);
    std::string stored;
    CHECK(readText(path, stored));
    CHECK_EQ(stored, h.server.adminDbKey() + "\n");
    CHECK_EQ(h.server.adminDbKey().size(), std::size_t{16});
    struct stat info {};
    CHECK(::stat(path.c_str(), &info) == 0);
    CHECK_EQ(static_cast<int>(info.st_mode & 0777), 0600);
}

TEST(an_existing_key_file_is_kept_and_is_the_key) {
    // The operator's own key, there before the server starts: used as it is,
    // and the file left exactly as they wrote it.
    Harness h("admindb-keyfile-kept", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        writeText(admin_db::keyFileFor(path), "Garden-Gnome_42\n");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    CHECK_EQ(h.server.adminDbKey(), std::string("Garden-Gnome_42"));
    std::string stored;
    CHECK(readText(admin_db::keyFileFor(h.dbPath), stored));
    CHECK_EQ(stored, std::string("Garden-Gnome_42\n"));

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    std::uint64_t mark = boss.chatSequence();
    CHECK(say(h, boss, "/admin db garden-gnome_42"));
    CHECK(sawTextSince(boss, mark, "Wrong database editor key."));
    CHECK(!boss.adminDb().openRequested);
    CHECK(say(h, boss, "/admin db Garden-Gnome_42"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));
}

TEST(changing_the_key_file_changes_the_key_without_a_restart) {
    Harness h("admindb-keyfile-change", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::string path = admin_db::keyFileFor(h.dbPath);
    const std::string old = h.server.adminDbKey();

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    // Edited on the server machine while the server runs: the old key stops
    // working and the new one opens the editor, from the next attempt on.
    CHECK(writeText(path, "Brand-New-Key_7\n"));
    CHECK_EQ(h.server.adminDbKey(), std::string("Brand-New-Key_7"));
    std::uint64_t mark = boss.chatSequence();
    CHECK(say(h, boss, "/admin db " + old));
    CHECK(sawTextSince(boss, mark, "Wrong database editor key."));
    CHECK(!boss.adminDb().openRequested);
    CHECK(say(h, boss, "/admin db Brand-New-Key_7"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));
    CHECK(!sawText(boss, "Brand-New-Key_7"));
}

TEST(a_missing_or_unusable_key_file_keeps_the_editor_shut) {
    Harness h("admindb-keyfile-broken", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        // There but unusable at start-up: left alone, not replaced with a
        // fresh key -- it is the operator's file and theirs to fix.
        writeText(admin_db::keyFileFor(path), "two words\n");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::string path = admin_db::keyFileFor(h.dbPath);
    CHECK(h.server.adminDbKey().empty());
    std::string stored;
    CHECK(readText(path, stored));
    CHECK_EQ(stored, std::string("two words\n"));

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    // Half of the broken line does not open it.
    std::uint64_t mark = boss.chatSequence();
    CHECK(say(h, boss, "/admin db two"));
    CHECK(sawTextSince(boss, mark, "The database editor is locked: admin_db_key.txt"));
    CHECK(!boss.adminDb().openRequested);

    // Deleted while running: still shut, and not quietly re-created.
    std::remove(path.c_str());
    CHECK(h.server.adminDbKey().empty());
    mark = boss.chatSequence();
    CHECK(say(h, boss, "/admin db two"));
    CHECK(sawTextSince(boss, mark, "The database editor is locked"));
    CHECK(!boss.adminDb().openRequested);
    CHECK(!admin_db::keyFileExists(path));

    // Fixed on the machine: open again, no restart.
    CHECK(writeText(path, "Mended_Key\n"));
    CHECK(say(h, boss, "/admin db Mended_Key"));
    CHECK(h.stepUntil({&boss}, [&] { return boss.adminDb().openRequested; }, 60));
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
    CHECK(sawText(admin, "The key is in admin_db_key.txt"));
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

TEST(the_database_editor_needs_a_tier_that_may_give_and_never_changes_a_tier) {
    Harness h("admindb-tier", [](const std::string& path) {
        seedUser(path, "boss", "password7", true, 2);
        seedUser(path, "low", "password7", true, 3);
        seedUser(path, "bob", "password7");
        seedUser(path, "owner", "password7", true, kOwnerAdminTier);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient low;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, low, "low", "password7"));

    // The editor writes any bag, so a tier that may not give may not open it,
    // key or no key.
    CHECK(say(h, low, "/admin db " + h.server.adminDbKey()));
    CHECK(sawText(low, "Tier 3 admins cannot open the database editor"));
    h.step(10, {&boss, &low});
    CHECK(!low.adminDb().openRequested);
    low.adminDbList("", 0);
    h.step(30, {&boss, &low});
    CHECK(low.adminDb().accounts.empty());

    // Tier 2 may. And no tier is written from it: not raised on yourself, not
    // lowered on another admin, not put on an account that has none.
    CHECK(unlock(h, boss));
    CHECK(openAccount(h, {&boss}, boss, "boss"));
    boss.adminDbSet({"account", "adminTier"}, "1");
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(boss.adminDb().resultMessage.find("admin flag, tier, owner and ban") != std::string::npos);
    boss.adminDbRemove({"account", "adminTier"});
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(openAccount(h, {&boss}, boss, "low"));
    boss.adminDbSet({"account", "adminTier"}, "4");
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(openAccount(h, {&boss}, boss, "bob"));
    boss.adminDbSet({"account", "adminTier"}, "1");
    CHECK(!awaitResult(h, {&boss}, boss));

    // Nor the owner: not made from here, on yourself or on anyone, and not
    // unmade on the owner's own row, which a tier 1 or 2 could reach.
    CHECK(openAccount(h, {&boss}, boss, "boss"));
    boss.adminDbSet({"account", "owner"}, "true");
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(boss.adminDb().resultMessage.find("admin flag, tier, owner and ban") !=
          std::string::npos);
    CHECK(openAccount(h, {&boss}, boss, "owner"));
    boss.adminDbRemove({"account", "owner"});
    CHECK(!awaitResult(h, {&boss}, boss));
    boss.adminDbSet({"account", "adminTier"}, "1");
    CHECK(!awaitResult(h, {&boss}, boss));

    CHECK_EQ(h.server.database().findUser("boss")->adminTier, 2);
    CHECK_EQ(h.server.database().findUser("low")->adminTier, 3);
    CHECK_EQ(h.server.database().findUser("bob")->adminTier, kTopAdminTier);
    CHECK_EQ(h.server.database().findUser("owner")->adminTier, kOwnerAdminTier);
}

TEST(the_database_editor_never_sets_an_admins_password_or_ban) {
    Harness h("admindb-admin-password", [](const std::string& path) {
        seedUser(path, "boss", "password7", true, 1);
        seedUser(path, "low", "password7", true, 4);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));

    // Not a lower tier's, and not the editor's own user's.
    for (const char* name : {"low", "boss"}) {
        const std::string hashBefore = h.server.database().findUser(name)->passwordHash;
        boss.adminDbSetPassword(name, "brandnew9");
        CHECK(!awaitResult(h, {&boss}, boss));
        CHECK(boss.adminDb().resultMessage.find("Admin passwords cannot be changed") !=
              std::string::npos);
        CHECK_EQ(h.server.database().findUser(name)->passwordHash, hashBefore);
    }

    // A ban is ban_admin's, held to the tiers; the editor does not reach it.
    CHECK(openAccount(h, {&boss}, boss, "low"));
    for (const char* field : {"adminBanned", "adminBannedBy", "adminBannedAt"}) {
        boss.adminDbSet({"account", field}, "true");
        CHECK(!awaitResult(h, {&boss}, boss));
        CHECK(boss.adminDb().resultMessage.find("admin flag, tier, owner and ban") != std::string::npos);
    }
    CHECK(!h.server.database().findUser("low")->adminBanned);
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

    // An entry, as text.
    Json entry;
    CHECK(net::adminDbNodeJson(*docNode(boss, {"0"}), entry));
    Json typed = entry;
    typed["message"] = Json("as text");
    CHECK(boss.adminDbPatch({"0"}, entry.dump(), typed.dump()));
    CHECK(awaitResult(h, {&boss}, boss));
    h.step(5, {&boss});
    CHECK_EQ(docNode(boss, {"0", "message"})->text, std::string("as text"));
    CHECK_EQ(boss.adminDb().root.size, 1u);
}

TEST(the_text_view_saves_a_record_without_undoing_the_player) {
    Harness h("admindb-text", [](const std::string& path) {
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

    // The text, as the panel builds it from the tree: the progress record.
    Json opened;
    CHECK(net::adminDbNodeJson(*docNode(boss, {"progress"}), opened));
    CHECK(opened.isObject());

    // The record moves on while the admin types.
    boss.adminDbSet({"progress", "stars"}, "77");
    CHECK(awaitResult(h, {&boss, &bob}, boss));

    Json typed = opened;
    typed["totalXP"] = Json(50000.0);
    typed["inventory"]["rare"]["petal_rose"] = Json(3.0);
    CHECK(boss.adminDbPatch({"progress"}, opened.dump(), typed.dump()));
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    CHECK(boss.adminDb().resultMessage.find("Saved 2 changes to progress on bob") !=
          std::string::npos);

    // What was typed reached the player in the world; what was not typed --
    // the stars, which the text still held at their old figure -- stayed.
    const std::uint16_t rose = content().petalIndex("rose");
    CHECK(h.stepUntil({&boss, &bob}, [&] {
        bool hasRose = false;
        for (const Profile::Stack& stack : bob.profile().inventory) {
            if (stack.petalIndex == rose && stack.rarity == Rarity::Rare && stack.count == 3) {
                hasRose = true;
            }
        }
        return hasRose && bob.profile().totalXp == 50000.0;
    }, 100));
    CHECK_EQ(bob.profile().stars, 77.0);
    CHECK_EQ(docNode(boss, {"progress", "stars"})->number, 77.0);

    // A field the server works out for itself is not stored, and it says so.
    Json now;
    CHECK(net::adminDbNodeJson(*docNode(boss, {"progress"}), now));
    Json derived = now;
    derived["tp"] = Json(999.0);
    CHECK(boss.adminDbPatch({"progress"}, now.dump(), derived.dump()));
    CHECK(!awaitResult(h, {&boss, &bob}, boss));
    CHECK(boss.adminDb().resultMessage.find("Not saved") != std::string::npos);
    CHECK(boss.adminDb().resultMessage.find("tp") != std::string::npos);

    // A whole half that is not an object would parse as an empty record.
    CHECK(boss.adminDbPatch({"progress"}, now.dump(), "[]"));
    CHECK(!awaitResult(h, {&boss, &bob}, boss));
    h.step(5, {&boss, &bob});
    CHECK_EQ(docNode(boss, {"progress", "stars"})->number, 77.0);

    // Text that is the same as it was opened saves nothing.
    CHECK(boss.adminDbPatch({"progress"}, now.dump(), now.dump()));
    CHECK(awaitResult(h, {&boss, &bob}, boss));
    CHECK(boss.adminDb().resultMessage.find("Nothing to save") != std::string::npos);
}

TEST(the_text_view_never_changes_what_the_editor_locks) {
    Harness h("admindb-text-locks", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "bob", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    CHECK(openAccount(h, {&boss}, boss, "bob"));

    // The whole account row, as text. Every locked field, added or changed,
    // is refused, and refused as locked -- the path checks never see these,
    // as the path is the row, and the parse putting them back afterwards
    // would only say "not saved".
    Json row;
    CHECK(net::adminDbNodeJson(*docNode(boss, {"account"}), row));
    struct Locked {
        const char* field;
        Json value;
        const char* reason;
    };
    const std::vector<Locked> locked = {
        {"admin", Json(true), "admin flag"},
        {"adminTier", Json(1.0), "admin flag"},
        {"owner", Json(true), "admin flag"},
        {"adminBanned", Json(true), "admin flag"},
        {"username", Json("robert"), "files the account under"},
        {"id", Json("someoneelse"), "files the account under"},
        {"password", Json("hunter2"), "Set password"},
    };
    for (const Locked& lock : locked) {
        Json typed = row;
        typed[lock.field] = lock.value;
        CHECK(boss.adminDbPatch({"account"}, row.dump(), typed.dump()));
        CHECK(!awaitResult(h, {&boss}, boss));
        CHECK(boss.adminDb().resultMessage.find(lock.reason) != std::string::npos);
    }
    Json noId = row;
    noId.erase("id");
    CHECK(boss.adminDbPatch({"account"}, row.dump(), noId.dump()));
    CHECK(!awaitResult(h, {&boss}, boss));
    CHECK(boss.adminDb().resultMessage.find("files the account under") != std::string::npos);
    boss.adminDbFetch({});
    h.step(5, {&boss});
    CHECK((boss.adminDb().flags & net::AdminDbIsAdmin) == 0);
    CHECK_EQ(docNode(boss, {"account", "username"})->text, std::string("bob"));

    // What is not locked is saved from the same text.
    Json muted = row;
    muted["muted"] = Json(true);
    CHECK(boss.adminDbPatch({"account"}, row.dump(), muted.dump()));
    CHECK(awaitResult(h, {&boss}, boss));
    h.step(5, {&boss});
    CHECK((boss.adminDb().flags & net::AdminDbMuted) != 0);

    // And the password still works: the text never held the hash.
    NetClient bob;
    CHECK(loginAs(h, bob, "bob", "password7"));

    // Only the account's two halves are documents.
    CHECK(boss.adminDbPatch({"elsewhere"}, "{}", R"({"a":1})"));
    CHECK(!awaitResult(h, {&boss}, boss));
}

// ---------------------------------------------------------------------------
// Searching by value
// ---------------------------------------------------------------------------

TEST(an_account_search_reads_names_counts_and_loadout_words) {
    const ContentRegistry& content = shippedContent();
    account_search::Query q;
    std::string error;

    CHECK(account_search::parse("  Bob  ", content, q, error));
    CHECK_EQ(q.names.size(), 1u);
    CHECK_EQ(q.names[0], std::string("bob"));
    CHECK(q.terms.empty());

    // A rarity and a petal either way round, the petal by its display name.
    CHECK(account_search::parse("Rose:MYTHIC>10 yin-yang>=2", content, q, error));
    CHECK_EQ(q.terms.size(), 2u);
    CHECK(q.terms[0].field == account_search::Field::Owned);
    CHECK_EQ(q.terms[0].petal, std::string("rose"));
    CHECK(!q.terms[0].anyRarity);
    CHECK(q.terms[0].rarity == Rarity::Mythic);
    CHECK(q.terms[0].compare == account_search::Compare::Greater);
    CHECK_EQ(q.terms[0].value, 10.0);
    CHECK_EQ(q.terms[0].label, std::string("Mythic Rose"));
    CHECK_EQ(q.terms[1].petal, std::string("yin_yang"));
    CHECK(q.terms[1].anyRarity);

    // A loadout word is at least one slot unless it says otherwise; "eternal"
    // is the label of the unique tier.
    CHECK(account_search::parse("loadout:eternal:rose level<=5 petals=0", content, q, error));
    CHECK_EQ(q.terms.size(), 3u);
    CHECK(q.terms[0].field == account_search::Field::Loadout);
    CHECK(q.terms[0].rarity == Rarity::Unique);
    CHECK(q.terms[0].compare == account_search::Compare::AtLeast);
    CHECK_EQ(q.terms[0].value, 1.0);
    CHECK(q.terms[1].field == account_search::Field::Level);
    CHECK(q.terms[1].compare == account_search::Compare::AtMost);
    CHECK(q.terms[2].petal.empty());
    CHECK(q.terms[2].compare == account_search::Compare::Equal);

    // Each refusal names the word it could not read.
    CHECK(!account_search::parse("rse>=1", content, q, error));
    CHECK(error.find("\"rse\"") != std::string::npos);
    CHECK(!account_search::parse("rose>=lots", content, q, error));
    CHECK(error.find("rose>=lots") != std::string::npos);
    CHECK(!account_search::parse("rose:light>1", content, q, error));
    CHECK(error.find("two petals") != std::string::npos);
    CHECK(!account_search::parse("mythic:epic>1", content, q, error));
    CHECK(error.find("two rarities") != std::string::npos);
}

TEST(an_account_search_counts_the_inventory_and_the_loadout) {
    PlayerRecord record;
    record.addItem(Rarity::Mythic, "petal_rose", 7);
    record.addItem(Rarity::Common, "petal_rose", 3);
    record.addItem(Rarity::Common, "petal_light", 5);
    record.loadout.resize(3);
    StoredItem rose;
    rose.rarity = Rarity::Mythic;
    rose.petalType = "rose";
    record.loadout[0] = rose;
    record.loadout[2] = rose;

    const ContentRegistry& content = shippedContent();
    const auto read = [&](const std::string& text) {
        account_search::Query q;
        std::string error;
        if (!account_search::parse(text, content, q, error) || q.terms.size() != 1) return -1.0;
        return account_search::valueOf(q.terms[0], {nullptr, &record, 0}, 42);
    };
    CHECK_EQ(read("rose>0"), 10.0);
    CHECK_EQ(read("mythic:rose>0"), 7.0);
    CHECK_EQ(read("common>0"), 8.0);
    CHECK_EQ(read("petals>0"), 15.0);
    CHECK_EQ(read("loadout:rose"), 2.0);
    CHECK_EQ(read("loadout:common:rose"), 0.0);
    CHECK_EQ(read("loadout:>0"), 2.0);
    CHECK_EQ(read("level>0"), 42.0);

    account_search::Query q;
    std::string error;
    CHECK(account_search::parse("rose>0", content, q, error));
    CHECK_EQ(account_search::valueOf(q.terms[0], {}, 1), 0.0);
}

TEST(an_account_search_reads_dates_times_ago_and_flags) {
    const ContentRegistry& content = shippedContent();
    account_search::Query q;
    std::string error;
    const double minute = 60000.0;
    const double day = 1440 * minute;
    const double october = static_cast<double>(daysFromCivil(2026, 10, 1)) * day;

    // A date is the whole month, day or minute it names, in UTC.
    CHECK(account_search::parse("created>=2026-10-01 active<2026-10 created=2026-10-01T18:30",
                                content, q, error));
    CHECK_EQ(q.terms.size(), 3u);
    CHECK(q.terms[0].field == account_search::Field::Created);
    CHECK(!q.terms[0].ago);
    CHECK_EQ(q.terms[0].value, october);
    CHECK_EQ(q.terms[0].span, day);
    CHECK(q.terms[1].field == account_search::Field::Active);
    CHECK_EQ(q.terms[1].span, 31 * day);
    CHECK_EQ(q.terms[2].value, october + (18 * 60 + 30) * minute);
    CHECK_EQ(q.terms[2].span, minute);

    // A time ago is exact, unless it is an "=".
    CHECK(account_search::parse("active<7d last_active>=12h created=3d", content, q, error));
    CHECK(q.terms[0].ago);
    CHECK_EQ(q.terms[0].value, 7 * day);
    CHECK_EQ(q.terms[0].span, 0.0);
    CHECK(q.terms[1].field == account_search::Field::Active);
    CHECK_EQ(q.terms[1].value, 12 * 60 * minute);
    CHECK_EQ(q.terms[2].span, day);

    // The account's own numbers, and its flags.
    CHECK(account_search::parse("stars>100 xp>=1e6 streak=3 is:guest not:muted", content, q,
                                error));
    CHECK_EQ(q.terms.size(), 5u);
    CHECK(q.terms[0].field == account_search::Field::Stars);
    CHECK(q.terms[1].field == account_search::Field::Xp);
    CHECK_EQ(q.terms[1].value, 1e6);
    CHECK(q.terms[2].field == account_search::Field::Streak);
    CHECK(q.terms[3].field == account_search::Field::Guest);
    CHECK_EQ(q.terms[3].value, 1.0);
    CHECK(q.terms[4].field == account_search::Field::Muted);
    CHECK_EQ(q.terms[4].value, 0.0);

    CHECK(!account_search::parse("created>=yesterday", content, q, error));
    CHECK(error.find("created>=yesterday") != std::string::npos);
    // A bare number is not a year, nor days: it says which it means.
    CHECK(!account_search::parse("active<7", content, q, error));
    CHECK(!account_search::parse("created>=2026-13-01", content, q, error));
    CHECK(!account_search::parse("is:banned", content, q, error));
    CHECK(error.find("is:banned") != std::string::npos);
    CHECK(!account_search::parse("stars>=lots", content, q, error));
}

TEST(an_account_search_reads_when_an_account_was_made_and_seen) {
    const std::int64_t hour = 3600000;
    const std::int64_t day = 24 * hour;
    const std::int64_t now = daysFromCivil(2026, 10, 27) * day + 12 * hour;
    Account account;
    account.createdAtMillis = daysFromCivil(2026, 10, 1) * day + 18 * hour;
    account.lastActiveAtMillis = now - 3 * day - hour;
    account.guest = true;
    PlayerRecord record;
    record.stars = 250;
    record.dailyStreak = 4;
    const account_search::Subject seen{&account, &record, now};
    // Never signed in, and made before the file kept the date.
    const Account blank;
    const account_search::Subject never{&blank, nullptr, now};

    const ContentRegistry& content = shippedContent();
    const auto matches = [&](const account_search::Subject& subject, const std::string& text) {
        account_search::Query q;
        std::string error;
        std::vector<double> values;
        return account_search::parse(text, content, q, error) &&
               account_search::termsMatch(q, subject, values);
    };
    // A day runs from its first moment to its last.
    CHECK(matches(seen, "created=2026-10-01"));
    CHECK(matches(seen, "created<=2026-10-01"));
    CHECK(!matches(seen, "created>2026-10-01"));
    CHECK(!matches(seen, "created<2026-10-01"));
    CHECK(matches(seen, "created>=2026-10 created<2026-11"));
    CHECK(matches(seen, "created=2026-10-01T18:00"));
    CHECK(!matches(seen, "created>=2026-10-01T18:01"));
    // How long ago reads as said: seen 3 days and an hour ago.
    CHECK(matches(seen, "active<7d active>3d active=3d active>=73h"));
    CHECK(!matches(seen, "active<3d"));
    CHECK(matches(seen, "created>25d created<26d"));
    CHECK(matches(seen, "stars>=250 streak=4 is:guest not:admin not:muted"));
    CHECK(!matches(seen, "is:admin"));
    // Never is longer ago than anything, and an unknown date is the epoch.
    CHECK(matches(never, "active>3650d created>3650d created<2020-01-01"));
    CHECK(!matches(never, "active<3650d"));

    account_search::Query q;
    std::string error;
    CHECK(account_search::parse("created>=2026-10-01 active<7d is:guest stars>0", content, q,
                                error));
    const auto shown = [&](std::size_t t, const account_search::Subject& subject) {
        return account_search::valueText(q.terms[t], account_search::valueOf(q.terms[t], subject, 0));
    };
    CHECK_EQ(shown(0, seen), std::string("2026-10-01 18:00"));
    CHECK_EQ(shown(0, never), std::string("unknown"));
    CHECK_EQ(shown(1, seen), std::string("3d ago"));
    CHECK_EQ(shown(1, never), std::string("never"));
    CHECK_EQ(shown(2, seen), std::string());
    CHECK_EQ(account_search::valueText(q.terms[3], 1234), std::string("1,234"));
    // In the units a search is typed in.
    CHECK_EQ(account_search::valueText(q.terms[1], 59.9 * 60000), std::string("59m ago"));
    CHECK_EQ(account_search::valueText(q.terms[1], 47.9 * hour), std::string("47h ago"));
    CHECK_EQ(account_search::valueText(q.terms[1], 48.0 * hour), std::string("2d ago"));
}

TEST(the_database_editor_finds_accounts_by_what_they_own_and_wear) {
    Harness h("admindb-search-values", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "alice", "password7");
        seedUser(path, "bobby", "password7");
        seedUser(path, "carol", "password7");
        seedStack(path, "alice", "petal_rose", Rarity::Mythic, 12);
        seedStack(path, "bobby", "petal_rose", Rarity::Mythic, 30);
        seedStack(path, "carol", "petal_rose", Rarity::Common, 50);
        Database db;
        std::string error;
        db.load(path, error);
        StoredItem light;
        light.rarity = Rarity::Epic;
        light.petalType = "light";
        db.progress(db.findUser("carol")->id).loadout = {light, std::nullopt};
        db.markDirty();
        db.save();
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    const auto list = [&](const std::string& search) {
        boss.adminDbList(search, 0);
        h.stepUntil({&boss}, [&] { return !boss.adminDb().listPending; }, 100);
        std::string names;
        for (const AdminDbAccountRow& row : boss.adminDb().accounts) {
            names += (names.empty() ? "" : " ") + row.username;
        }
        return names;
    };

    // Most first, each row saying how many -- just the number, for one count.
    CHECK_EQ(list("mythic:rose>=10"), std::string("bobby alice"));
    CHECK_EQ(boss.adminDb().accounts[0].note, std::string("30"));
    CHECK(boss.adminDb().listError.empty());
    // Every rarity, and fewest first when the first count is a "<".
    CHECK_EQ(list("rose<40 rose>=1"), std::string("alice bobby"));
    CHECK_EQ(boss.adminDb().accounts[0].note, std::string("Rose 12, Rose 12"));
    // Names and counts together.
    CHECK_EQ(list("o rose>20"), std::string("carol bobby"));
    CHECK_EQ(list("loadout:light"), std::string("carol"));
    CHECK_EQ(boss.adminDb().accounts[0].note, std::string("1"));
    CHECK_EQ(list("loadout:mythic:light"), std::string());

    // An unreadable search says why and lists nobody.
    CHECK_EQ(list("rse>=1"), std::string());
    CHECK(boss.adminDb().listError.find("\"rse\"") != std::string::npos);
    // A plain name still searches names, and clears the complaint.
    CHECK_EQ(list("bob"), std::string("bobby"));
    CHECK(boss.adminDb().listError.empty());
    CHECK(boss.adminDb().accounts[0].note.empty());
}

TEST(the_database_editor_finds_accounts_by_when_they_were_made_and_seen) {
    const std::int64_t hour = 3600000;
    const std::int64_t day = 24 * hour;
    // The server reads the wall clock, so the times are set against it.
    const std::int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 std::chrono::system_clock::now().time_since_epoch())
                                 .count();
    Harness h("admindb-search-dates", [&](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "alice", "password7");
        seedUser(path, "bobby", "password7");
        seedUser(path, "carol", "password7");
        Database db;
        std::string error;
        db.load(path, error);
        Account* alice = db.findUser("alice");
        alice->createdAtMillis = now - 2 * day - hour;
        alice->lastActiveAtMillis = now - hour;
        Account* bobby = db.findUser("bobby");
        bobby->createdAtMillis = now - 40 * day;
        bobby->lastActiveAtMillis = now - 45 * day;
        // Older than the dates: never seen, made who knows when.
        Account* carol = db.findUser("carol");
        carol->createdAtMillis = 0;
        carol->lastActiveAtMillis = 0;
        carol->guest = true;
        db.progress(alice->id).stars = 500;
        db.markDirty();
        db.save();
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(unlock(h, boss));
    const auto list = [&](const std::string& search) {
        boss.adminDbList(search, 0);
        h.stepUntil({&boss}, [&] { return !boss.adminDb().listPending; }, 100);
        std::string names;
        for (const AdminDbAccountRow& row : boss.adminDb().accounts) {
            names += (names.empty() ? "" : " ") + row.username;
        }
        return names;
    };
    const auto note = [&](std::size_t row) {
        return row < boss.adminDb().accounts.size() ? boss.adminDb().accounts[row].note
                                                    : std::string("(no row)");
    };

    // Made in the last week: boss just now, alice two days ago -- newest first.
    CHECK_EQ(list("created<7d"), std::string("boss alice"));
    CHECK_EQ(note(1), std::string("2d ago"));
    // Not seen for a month, longest first; never is longest of all.
    CHECK_EQ(list("active>30d"), std::string("carol bobby"));
    CHECK_EQ(note(0), std::string("never"));
    CHECK_EQ(note(1), std::string("45d ago"));
    // A date: an unknown one is the epoch, before any date at all.
    const std::string twoDaysAgo = civilFromDays((now - 2 * day - hour) / day);
    CHECK_EQ(list("created<=" + twoDaysAgo), std::string("carol bobby alice"));
    CHECK_EQ(note(0), std::string("unknown"));
    // Flags say nothing in the note; the counts beside them still do.
    CHECK_EQ(list("is:guest"), std::string("carol"));
    CHECK_EQ(note(0), std::string());
    CHECK_EQ(list("not:guest stars>=100"), std::string("alice"));
    CHECK_EQ(note(0), std::string("Stars 500"));
    CHECK_EQ(list("is:admin"), std::string("boss"));
}
