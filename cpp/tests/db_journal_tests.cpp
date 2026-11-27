// The database journal: every change since the last snapshot, appended
// before any byte leaves for a client, and replayed by the next load. What is
// under test is the promise the journal makes -- a process that dies at any
// moment after a flush comes back with everything that flush held -- so each
// case "kills" the process by copying the files exactly as they stand on disk
// and loading the copy, never by letting the original Database go (its
// destructor saves, which is the clean path, not the one being tested).

#include "test.h"

#include "server/crypto.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/core/json.h"
#include "test_data.h"

#include <cstdio>
#include <sys/stat.h>
#include <utility>
#include <functional>
#include <map>
#include <string>

using namespace flix;
using namespace flix::testsupport;

namespace {

struct JournalFiles {
    std::vector<std::string> paths;
    ~JournalFiles() {
        for (const std::string& path : paths) {
            for (const char* suffix : {"", ".tmp", ".journal", ".journal.tmp", ".journal.next"}) {
                std::remove((path + suffix).c_str());
            }
        }
    }
};

std::string journalScratch(const std::string& name) {
    static JournalFiles handedOut;
    std::string path = testsupport::tempUnique("florr-journal-" + name, ".json");
    for (const char* suffix : {"", ".tmp", ".journal", ".journal.tmp", ".journal.next"}) {
        std::remove((path + suffix).c_str());
    }
    handedOut.paths.push_back(path);
    return path;
}

bool fileOnDisk(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0;
}

std::string readAll(const std::string& path) {
    std::string text;
    testsupport::readText(path, text);
    return text;
}

/// What a SIGKILL leaves behind: the snapshot and the journal, byte for byte
/// as they are on disk right now, copied to `to` (and `to`.journal).
void copyAsKilled(const std::string& from, const std::string& to) {
    for (const char* suffix : {"", ".journal", ".journal.next", ".tmp"}) {
        std::remove((to + suffix).c_str());
        if (fileOnDisk(from + suffix)) testsupport::writeText(to + suffix, readAll(from + suffix));
    }
}

/// The database's content with order taken out of it: a replayed rename or
/// re-insert may file a row at the end of its table instead of in its old
/// place, which changes nothing anybody owns.
std::map<std::string, std::string> contentOf(const Database& db) {
    Json root;
    std::string error;
    std::map<std::string, std::string> flat;
    if (!Json::parse(db.serialise(), root, error)) return flat;
    for (const std::string& table : root.keys()) {
        const Json& value = root[table];
        if (value.isObject() && (table == "players" || table == "users" || table == "sessions")) {
            for (const std::string& row : value.keys()) flat[table + "/" + row] = value[row].dump(0);
        } else {
            flat[table] = value.dump(0);
        }
    }
    return flat;
}

bool sameContent(const Database& a, const Database& b) {
    const auto left = contentOf(a);
    const auto right = contentOf(b);
    if (left == right) return true;
    for (const auto& [key, text] : left) {
        auto it = right.find(key);
        if (it == right.end()) std::fprintf(stderr, "  only before the kill: %s\n", key.c_str());
        else if (it->second != text) std::fprintf(stderr, "  differs: %s\n", key.c_str());
    }
    for (const auto& [key, text] : right) {
        if (!left.count(key)) std::fprintf(stderr, "  only after the reload: %s\n", key.c_str());
    }
    return false;
}

/// A database with one saved account, so the file and its journal id exist.
std::string seededDatabase(const std::string& name, Database& db) {
    const std::string path = journalScratch(name);
    std::string error;
    CHECK(db.load(path, error));
    db.setPasswordCost(crypto::kBcryptMinCost);
    CHECK(db.createUser("alpha", "long-enough-password").status == CreateStatus::Ok);
    CHECK(db.save());
    return path;
}

std::string userIdOf(const Database& db, const std::string& name) {
    const Account* account = db.findUser(name);
    return account ? account->id : std::string();
}

} // namespace

TEST(a_process_killed_after_a_journal_flush_comes_back_with_everything_it_held) {
    Database db;
    const std::string path = seededDatabase("killed", db);
    const std::string alpha = userIdOf(db, "alpha");

    // Every kind of change there is, none of them saved.
    db.progress(alpha).addItem(Rarity::Mythic, "petal_rose", 3);
    db.progress(alpha).totalXp += 12345;
    db.progress(alpha).recordKill("ladybug", Rarity::Rare);
    CHECK(db.createUser("bravo", "long-enough-password").status == CreateStatus::Ok);
    const std::string token = db.createSession(alpha, "alpha");
    db.rawTable("guilds")["Petals"] = Json::object();
    db.rawTable("guilds")["Petals"]["owner"] = Json("alpha");
    db.rawArrayTable("notifications").push(Json("hello"));
    CHECK(db.createUser("doomed", "long-enough-password").status == CreateStatus::Ok);
    CHECK(db.flushJournal());
    CHECK(db.eraseUser("doomed"));
    std::string reason;
    CHECK(db.renameUser(userIdOf(db, "bravo"), "charlie", reason));
    CHECK(db.flushJournal());
    CHECK(!db.journalPending());

    const std::string copy = journalScratch("killed-copy");
    copyAsKilled(path, copy);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK_EQ(reloaded.journalLinesReplayed(), 2);
    CHECK(reloaded.journalNote().empty());
    CHECK(sameContent(db, reloaded));
    CHECK(reloaded.findUser("doomed") == nullptr);
    CHECK(reloaded.findUser("bravo") == nullptr);
    CHECK(reloaded.findUser("charlie") != nullptr);
    CHECK(reloaded.resolveSession(token) != nullptr);
    const PlayerRecord* record = reloaded.findProgress(alpha);
    CHECK(record != nullptr);
    if (record != nullptr) {
        CHECK_EQ(record->itemCount(Rarity::Mythic, "petal_rose"), 3);
        CHECK_NEAR(record->totalXp, 12345.0, 1e-9);
    }
}

TEST(changes_not_yet_flushed_are_the_only_ones_a_kill_can_take) {
    // The other side of the promise: what was never flushed was never sent to
    // anybody either (the server flushes before every send), so it is fine to
    // lose -- and the copy must not somehow hold it.
    Database db;
    const std::string path = seededDatabase("unflushed", db);
    const std::string alpha = userIdOf(db, "alpha");
    db.progress(alpha).addItem(Rarity::Rare, "petal_basic", 1);
    CHECK(db.flushJournal());
    db.progress(alpha).addItem(Rarity::Rare, "petal_basic", 1);
    CHECK(db.journalPending());

    const std::string copy = journalScratch("unflushed-copy");
    copyAsKilled(path, copy);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    const PlayerRecord* record = reloaded.findProgress(alpha);
    CHECK(record != nullptr);
    if (record != nullptr) CHECK_EQ(record->itemCount(Rarity::Rare, "petal_basic"), 1);
}

TEST(a_torn_last_journal_line_is_dropped_and_the_journal_goes_on_working) {
    Database db;
    const std::string path = seededDatabase("torn", db);
    const std::string alpha = userIdOf(db, "alpha");
    db.progress(alpha).addItem(Rarity::Epic, "petal_wing", 2);
    CHECK(db.flushJournal());

    // Killed half way through the next append.
    const std::string copy = journalScratch("torn-copy");
    copyAsKilled(path, copy);
    const std::string whole = readAll(copy + ".journal");
    testsupport::writeText(copy + ".journal", whole + "{\"players\":{\"" + alpha + "\":{\"inv");

    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK_EQ(reloaded.journalLinesReplayed(), 1);
    CHECK(reloaded.journalNote().find("unfinished last line") != std::string::npos);
    CHECK_EQ(readAll(copy + ".journal"), whole);
    CHECK_EQ(reloaded.journalBytes(), static_cast<std::uint64_t>(whole.size()));

    // Appended after the cut, not onto the torn half: a second kill brings
    // back both batches.
    reloaded.setPasswordCost(crypto::kBcryptMinCost);
    reloaded.progress(alpha).addItem(Rarity::Epic, "petal_wing", 5);
    CHECK(reloaded.flushJournal());
    const std::string second = journalScratch("torn-second");
    copyAsKilled(copy, second);
    Database again;
    CHECK(again.load(second, error));
    CHECK_EQ(again.journalLinesReplayed(), 2);
    const PlayerRecord* record = again.findProgress(alpha);
    CHECK(record != nullptr);
    if (record != nullptr) CHECK_EQ(record->itemCount(Rarity::Epic, "petal_wing"), 7);
}

TEST(a_save_starts_a_new_journal_and_an_old_one_is_never_replayed_onto_it) {
    Database db;
    const std::string path = seededDatabase("rotate", db);
    const std::string alpha = userIdOf(db, "alpha");
    db.progress(alpha).addItem(Rarity::Legendary, "petal_rose", 1);
    CHECK(db.flushJournal());
    // The state a crash between the snapshot's rename and the new journal
    // would leave: the NEW snapshot beside the OLD journal.
    const std::string oldJournal = readAll(path + ".journal");
    CHECK(db.save());
    const std::string fresh = readAll(path + ".journal");
    CHECK(fresh.find('\n') == fresh.size() - 1);  // the header and nothing else
    CHECK(fresh != oldJournal.substr(0, fresh.size()));

    const std::string copy = journalScratch("rotate-copy");
    copyAsKilled(path, copy);
    testsupport::writeText(copy + ".journal", oldJournal);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK_EQ(reloaded.journalLinesReplayed(), 0);
    CHECK(reloaded.journalNote().find("unused") != std::string::npos);
    CHECK(sameContent(db, reloaded));
    // Set aside, not deleted; removed here so the run leaves nothing behind.
    const std::size_t at = reloaded.journalNote().find(copy + ".journal.unused-");
    CHECK(at != std::string::npos);
    if (at != std::string::npos) {
        const std::string aside = reloaded.journalNote().substr(at);
        CHECK(fileOnDisk(aside));
        CHECK_EQ(readAll(aside), oldJournal);
        std::remove(aside.c_str());
    }
}

TEST(an_older_snapshot_restored_beside_the_live_journal_is_left_as_it_was) {
    // An operator restoring a backup (which never carries a journal id) must
    // get the backup, not the backup with the live server's recent changes
    // partly laid over it.
    Database db;
    const std::string path = seededDatabase("restore", db);
    const std::string alpha = userIdOf(db, "alpha");
    const std::string backup = db.toJson().dump(0);
    CHECK(backup.find("\"journal\"") == std::string::npos);
    db.progress(alpha).addItem(Rarity::Rare, "petal_stinger", 4);
    CHECK(db.flushJournal());

    const std::string copy = journalScratch("restore-copy");
    copyAsKilled(path, copy);
    testsupport::writeText(copy, backup);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK_EQ(reloaded.journalLinesReplayed(), 0);
    const PlayerRecord* record = reloaded.findProgress(alpha);
    CHECK(record == nullptr || record->itemCount(Rarity::Rare, "petal_stinger") == 0);
    const std::size_t at = reloaded.journalNote().find(copy + ".journal.unused-");
    CHECK(at != std::string::npos);
    if (at != std::string::npos) std::remove(reloaded.journalNote().substr(at).c_str());
}

TEST(a_first_run_killed_before_its_first_save_keeps_the_accounts_it_made) {
    const std::string path = journalScratch("firstrun");
    Database db;
    std::string error;
    CHECK(db.load(path, error));
    db.setPasswordCost(crypto::kBcryptMinCost);
    CHECK(db.createUser("pioneer", "long-enough-password").status == CreateStatus::Ok);
    CHECK(db.flushJournal());
    CHECK(!fileOnDisk(path));

    const std::string copy = journalScratch("firstrun-copy");
    copyAsKilled(path, copy);
    Database reloaded;
    CHECK(reloaded.load(copy, error));
    CHECK(reloaded.findUser("pioneer") != nullptr);
    CHECK(reloaded.verifyPassword("pioneer", "long-enough-password"));
}

TEST(a_load_leaves_nothing_to_journal_and_a_read_adds_nothing) {
    // The journal is asked before every send; a load that left every row
    // marked would put the whole database in its first line, and a read-only
    // path that marked rows would put them in every line.
    Database db;
    const std::string path = seededDatabase("quiet", db);
    const std::string alpha = userIdOf(db, "alpha");
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(path, error));
    CHECK(!reloaded.journalPending());
    CHECK(reloaded.findProgress(alpha) != nullptr);
    CHECK(std::as_const(reloaded).findUser("alpha") != nullptr);
    (void)reloaded.storedTable("guilds");
    CHECK(!reloaded.journalPending());
    reloaded.progress(alpha).stars += 1;
    CHECK(reloaded.journalPending());
    CHECK(reloaded.flushJournal());
    CHECK(!reloaded.journalPending());
    // The line holds that one row and nothing else.
    const std::string journal = readAll(path + ".journal");
    const std::size_t lastLine = journal.rfind('\n', journal.size() - 2);
    const std::string line = journal.substr(lastLine + 1);
    CHECK(line.find("\"players\":{\"" + alpha + "\":") != std::string::npos);
    CHECK(line.find("\"users\"") == std::string::npos);
}

TEST(a_journal_that_grows_past_its_cap_asks_for_a_save) {
    Database db;
    const std::string path = seededDatabase("cap", db);
    CHECK(!db.wantsSaveNow());
    // One big unmodelled table, rewritten whole on every line.
    std::string filler(1 << 20, 'x');
    for (int i = 0; i * (1 << 20) <= static_cast<int>(Database::kJournalSaveBytes); ++i) {
        db.rawTable("bulk")["blob"] = Json(filler + std::to_string(i));
        CHECK(db.flushJournal());
    }
    CHECK(db.wantsSaveNow());
    CHECK(db.save());
    CHECK(!db.wantsSaveNow());
    CHECK(db.journalBytes() < 100);
}

TEST(xp_a_client_has_been_shown_survives_the_server_being_killed) {
    // End to end: the account is made, the flower earns XP on its body (the
    // way a kill pays it) and picks up a petal into the record, the client
    // SEES all of it -- and then the process dies without a save. The copy
    // of what is on disk at that moment has every bit of it.
    Harness h("journal-kill");
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("survivor", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, NetId> people{world};
    people.each([&](Entity e, PlayerTag&, NetId& id) {
        if (id.value == client.view().self().netId) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    const double earned = xpForNextLevel(1) + xpForNextLevel(2) + 17;
    world.get<PlayerProgress>(body).totalXp = earned;
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().totalXp == earned; }));

    const std::string copy = journalScratch("server-killed");
    copyAsKilled(h.dbPath, copy);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    const Account* account = reloaded.findUser("survivor");
    CHECK(account != nullptr);
    if (account == nullptr) return;
    const PlayerRecord* record = reloaded.findProgress(account->id);
    CHECK(record != nullptr);
    if (record != nullptr) CHECK_NEAR(record->totalXp, earned, 1e-9);
}

TEST(a_clean_shutdown_settles_every_flower_onto_its_account) {
    Harness h("journal-shutdown");
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("leaver", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag> people{world};
    people.each([&](Entity e, PlayerTag&) { body = e; });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    world.get<PlayerProgress>(body).totalXp = 4242;

    // No tick between the gain and the stop: shutdown alone has to carry it.
    h.server.shutdown();
    CHECK(!world.isAlive(body) || !world.has<PlayerTag>(body) ||
          h.server.playerCount() == 0);
    Database reloaded;
    std::string error;
    const std::string copy = journalScratch("server-stopped");
    copyAsKilled(h.dbPath, copy);
    CHECK(reloaded.load(copy, error));
    const Account* account = reloaded.findUser("leaver");
    CHECK(account != nullptr);
    if (account == nullptr) return;
    const PlayerRecord* record = reloaded.findProgress(account->id);
    CHECK(record != nullptr);
    if (record != nullptr) CHECK_NEAR(record->totalXp, 4242.0, 1e-9);
    // And the save made the journal moot.
    CHECK_EQ(reloaded.journalLinesReplayed(), 0);
}

TEST(a_flower_doing_nothing_writes_nothing_to_the_journal) {
    // The journal is written before every send, and a row is written whenever
    // something took it MUTABLY -- so a read on a timer through a mutable
    // accessor (the profile digest is every two seconds per client) would put
    // every online player's whole row in the journal over and over. Standing
    // still for a while has to cost nothing.
    Harness h("journal-idle");
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("idler", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));
    h.step(30, {&client});

    const std::uint64_t before = h.server.database().journalBytes();
    // The app's two-second ProfileCheck, which the harness's NetClient does
    // not send on its own.
    // And steering, the message every playing client sends most.
    net::InputFrame input;
    std::uint32_t sequence = 0;
    for (int i = 0; i < 10; ++i) {
        client.sendProfileCheck();
        for (int t = 0; t < 30; ++t) {
            input.sequence = ++sequence;
            input.moveAngle = (i % 2) ? 0.0 : 3.14159;
            input.moveStrength = 1.0;
            input.flags = static_cast<std::uint8_t>(t % 2);
            client.sendInput(input);
            // A mob its petals killed would be XP, and a row rightly written.
            World& world = h.server.world();
            std::vector<Entity> near;
            const Vec2 at = client.view().self().position;
            Query<MobTag, Transform> mobs{world};
            mobs.each([&](Entity e, MobTag&, Transform& transform) {
                if (distance(transform.position, at) < 2000.0) near.push_back(e);
            });
            for (const Entity e : near) world.destroy(e);
            h.step(1, {&client});
        }
    }
    const std::uint64_t grew = h.server.database().journalBytes() - before;
    if (grew != 0) std::fprintf(stderr, "  journal grew %llu bytes\n", static_cast<unsigned long long>(grew));
    CHECK_EQ(grew, static_cast<std::uint64_t>(0));
}

TEST(a_player_row_written_as_text_is_byte_for_byte_its_tree) {
    // Every save and journal line writes player rows through playerRecordText,
    // which skips the tree; the file's shape is the tree's. Random records over
    // everything the inventory overlay has to get right: worn petals with and
    // without a stack left, in tiers the bag has and has not, full stacks,
    // fractional and junk counts, tiers that are not objects.
    std::uint32_t seed = 12345;
    const auto next = [&](std::uint32_t bound) {
        seed = seed * 1664525u + 1013904223u;
        return bound == 0 ? 0u : (seed >> 8) % bound;
    };
    const char* petals[] = {"basic", "rose", "stinger", "wing", "light", "faster"};
    int mismatches = 0;
    for (int round = 0; round < 3000; ++round) {
        PlayerRecord record;
        record.totalXp = next(100000) + (next(4) == 0 ? 0.25 : 0.0);
        const int tiers = static_cast<int>(next(5));
        for (int t = 0; t < tiers; ++t) {
            const std::string tier = rarityName(static_cast<Rarity>(next(8)));
            if (next(12) == 0) { record.inventory[tier] = Json(7); continue; }
            const int items = static_cast<int>(next(5));
            for (int i = 0; i < items; ++i) {
                const std::string key = std::string("petal_") + petals[next(6)];
                switch (next(6)) {
                    case 0: record.inventory[tier][key] = Json(2.5); break;
                    case 1: record.inventory[tier][key] = Json(static_cast<double>(kMaxStackCount)); break;
                    case 2: record.inventory[tier][key] = Json("junk"); break;
                    default: record.inventory[tier][key] = Json(static_cast<int>(next(50)) + 1);
                }
            }
        }
        if (next(30) == 0) record.inventory = Json();
        const int slots = static_cast<int>(next(12));
        for (int i = 0; i < slots; ++i) {
            if (next(4) == 0) { record.loadout.push_back(std::nullopt); continue; }
            StoredItem item;
            item.rarity = static_cast<Rarity>(next(8));
            item.petalType = next(20) == 0 ? "" : petals[next(6)];
            record.loadout.push_back(item);
        }
        if (next(2) == 0) record.recordKill("ladybug", static_cast<Rarity>(next(8)));
        if (next(3) == 0) record.recordKill("bee", Rarity::Common);
        if (next(4) == 0) record.stars = next(10);
        if (next(5) == 0) record.extra["trialGrounds"]["unlocked"] = Json(true);
        if (next(40) == 0) record.extra["inventory"] = Json("an unknown key of the same name");
        const std::string tree = playerRecordJson(record).dump(0);
        const std::string text = playerRecordText(record);
        if (tree != text) {
            if (++mismatches <= 3) {
                std::fprintf(stderr, "  round %d:\n    tree %s\n    text %s\n", round, tree.c_str(), text.c_str());
            }
        }
    }
    CHECK_EQ(mismatches, 0);
}

TEST(kills_and_pickups_rewrite_only_their_part_and_the_row_still_matches) {
    // A farming flower's row is journalled on every kill and pickup. Those go
    // through Database::recordKill and Database::addItem, which drop only the
    // kill counts or the one tier they change -- and the text written from
    // what is kept must be the same as a fresh render, every time.
    Database db;
    seededDatabase("part-parts", db);
    const std::string id = "p-farm";
    {
        PlayerRecord& record = db.progress(id);
        record.addItem(Rarity::Rare, "petal_rose", 3);
        record.addItem(Rarity::Common, "petal_light", 9);
        StoredItem worn;
        worn.rarity = Rarity::Rare;
        worn.petalType = "rose";
        record.loadout.push_back(worn);
        worn.rarity = Rarity::Eternal;
        worn.petalType = "stinger";
        record.loadout.push_back(worn);   // a tier only the loadout names
    }
    const auto fresh = [&] {
        PlayerRecord copy = *std::as_const(db).findProgress(id);
        return playerRecordJson(copy).dump(0);
    };
    db.setLiveProgress(id, false, 10, 0);
    CHECK_EQ(db.progressText(id), fresh());
    std::uint32_t seed = 7;
    const auto next = [&](std::uint32_t n) { seed = seed * 1664525u + 1013904223u; return (seed >> 8) % n; };
    const char* const petals[] = {"rose", "light", "stinger", "basic"};
    int mismatches = 0;
    for (int round = 0; round < 400; ++round) {
        const Rarity rarity = static_cast<Rarity>(next(10));
        switch (next(4)) {
            case 0: db.recordKill(id, next(2) ? "bee" : "ladybug", rarity); break;
            case 1: db.addItem(id, rarity, std::string("petal_") + petals[next(4)], 1); break;
            // Down to nothing, which takes the stack and maybe the tier away.
            case 2: db.addItem(id, rarity, std::string("petal_") + petals[next(4)], -2); break;
            default: db.setLiveProgress(id, false, 10 + round, round); break;
        }
        if (db.progressText(id) != fresh() && ++mismatches <= 3) {
            std::fprintf(stderr, "  round %d:\n    kept  %s\n    fresh %s\n", round,
                         db.progressText(id).c_str(), fresh().c_str());
        }
    }
    CHECK_EQ(mismatches, 0);
    // And they really were kept: a kill leaves the tiers rendered.
    db.setLiveProgress(id, false, 999, 0);
    (void)db.progressText(id);
    db.recordKill(id, "bee", Rarity::Common);
    CHECK(!std::as_const(db).findProgress(id)->rendered.tiers.empty());
}

TEST(live_xp_rewrites_a_row_from_its_kept_parts_and_any_other_change_drops_them) {
    // setLiveProgress runs on every tick a flower's XP or stars move, and its
    // row is rewritten for the journal each time from the inventory and kill
    // counts it rendered last. Those must never be what a change to the bag,
    // the loadout or the kills is written from.
    Database db;
    const std::string path = seededDatabase("live-parts", db);
    const std::string id = "p-live";
    {
        PlayerRecord& record = db.progress(id);
        record.addItem(Rarity::Rare, "petal_rose", 3);
        record.recordKill("ladybug", Rarity::Common);
        StoredItem worn;
        worn.rarity = Rarity::Rare;
        worn.petalType = "rose";
        record.loadout.push_back(worn);
    }
    const auto fresh = [&] {
        PlayerRecord copy = *std::as_const(db).findProgress(id);   // a copy keeps no parts
        CHECK(!copy.rendered.any());
        return playerRecordJson(copy).dump(0);
    };
    db.setLiveProgress(id, false, 120, 2);
    CHECK_EQ(db.progressText(id), fresh());
    CHECK(std::as_const(db).findProgress(id)->rendered.any());
    db.setLiveProgress(id, true, 40, 3);
    CHECK_EQ(db.progressText(id), fresh());
    CHECK(db.progressText(id).find("\"mazeTotalXP\":40") != std::string::npos);

    // The bag, the loadout and the kills, each through the mutable accessor.
    db.progress(id).addItem(Rarity::Epic, "petal_stinger", 1);
    CHECK(!std::as_const(db).findProgress(id)->rendered.any());
    db.setLiveProgress(id, false, 121, 2);
    CHECK_EQ(db.progressText(id), fresh());
    CHECK(db.progressText(id).find("petal_stinger") != std::string::npos);
    db.progress(id).loadout.clear();
    db.setLiveProgress(id, false, 122, 2);
    CHECK_EQ(db.progressText(id), fresh());
    db.progress(id).recordKill("bee", Rarity::Common);
    db.setLiveProgress(id, false, 123, 2);
    CHECK_EQ(db.progressText(id), fresh());
    CHECK(db.progressText(id).find("\"bee\"") != std::string::npos);

    // And the journal and the next load agree with all of it.
    CHECK(db.flushJournal());
    const std::string copy = journalScratch("live-parts-copy");
    copyAsKilled(path, copy);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    const PlayerRecord* back = std::as_const(reloaded).findProgress(id);
    CHECK(back != nullptr);
    if (back == nullptr) return;
    CHECK_EQ(back->totalXp, 123.0);
    CHECK_EQ(back->mazeTotalXp, 40.0);
    CHECK_EQ(reloaded.progressText(id), db.progressText(id));
}

TEST(a_backup_restored_after_a_clean_stop_replaces_the_empty_journal_quietly) {
    // A clean stop saves, which leaves the journal a header and nothing else.
    // Restoring a backup over the file then is the documented procedure, and
    // there is nothing in that journal worth a file set aside.
    Database db;
    const std::string path = seededDatabase("restore-clean", db);
    const std::string backup = db.toJson().dump(0);
    CHECK(db.save());
    const std::string copy = journalScratch("restore-clean-copy");
    copyAsKilled(path, copy);
    testsupport::writeText(copy, backup);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK_EQ(reloaded.journalLinesReplayed(), 0);
    CHECK(reloaded.journalNote().empty());
    CHECK(reloaded.findUser("alpha") != nullptr);
}


namespace {

/// A database with enough rows that a background save takes several slices.
std::string busyDatabase(const std::string& name, Database& db) {
    const std::string path = seededDatabase(name, db);
    for (int i = 0; i < 300; ++i) {
        PlayerRecord& record = db.progress("p" + std::to_string(i));
        record.totalXp = i;
        record.addItem(Rarity::Rare, "petal_rose", i + 1);
        record.recordKill("ladybug", Rarity::Common);
    }
    for (int i = 0; i < 40; ++i) db.createSession("p" + std::to_string(i), "alpha");
    db.rawTable("guilds")["Petals"] = Json::object();
    CHECK(db.save());
    return path;
}

/// Runs one slice at a time (a zero budget stops at the first clock check)
/// until the save reports how it ended.
Database::SaveProgress runSave(Database& db, const std::function<void(int)>& between = {}) {
    for (int slice = 0; slice < 10000; ++slice) {
        const Database::SaveProgress progress = db.serviceBackgroundSave(0.0);
        if (progress != Database::SaveProgress::Running) return progress;
        if (between) between(slice);
    }
    return Database::SaveProgress::Running;
}

std::string withoutJournalId(std::string file) {
    const std::size_t at = file.rfind(",\"journal\":");
    if (at != std::string::npos) file = file.substr(0, at) + "}";
    return file;
}

} // namespace

TEST(a_background_save_writes_the_file_a_whole_save_would) {
    Database db;
    const std::string path = busyDatabase("bg-same", db);
    CHECK(db.beginBackgroundSave());
    CHECK(!db.beginBackgroundSave());  // one at a time
    int slices = 0;
    CHECK(runSave(db, [&](int) { ++slices; }) == Database::SaveProgress::Saved);
    CHECK(slices > 3);
    CHECK(!db.backgroundSaveRunning());
    CHECK_EQ(withoutJournalId(readAll(path)), db.serialise());
    CHECK(!fileOnDisk(path + ".journal.next"));
    CHECK(!fileOnDisk(path + ".tmp"));
    // The file names the journal now in place, which is empty past its header.
    const std::string journal = readAll(path + ".journal");
    CHECK(journal.find('\n') == journal.size() - 1);
    CHECK(readAll(path).find(journal.substr(1, journal.size() - 3)) != std::string::npos);
}

TEST(changes_made_while_a_background_save_runs_all_come_back) {
    // Rows changed before the save reached them, after it passed them, erased
    // while it ran, and made new while it ran: the file catches each at a
    // different moment, and the new journal puts every one right. A process
    // killed at any slice comes back with all of it too.
    Database db;
    const std::string path = busyDatabase("bg-changes", db);
    CHECK(db.beginBackgroundSave());
    int wrong = 0;
    const auto between = [&](int slice) {
        db.progress("p" + std::to_string(slice % 20)).addItem(Rarity::Epic, "petal_wing", 1);
        db.progress("p" + std::to_string(299 - slice % 20)).totalXp += 1000;
        if (slice == 2) CHECK(db.eraseUser("alpha"));  // its sessions go with it
        if (slice == 4) db.createSession("p250", "beta");
        if (slice == 5) db.rawTable("guilds")["Leaves"] = Json::object();
        if (slice == 6) db.progress("brand-new").addItem(Rarity::Common, "petal_basic", 3);
        CHECK(db.flushJournal());
        if (slice % 3 == 0) {
            const std::string copy = journalScratch("bg-changes-kill");
            copyAsKilled(path, copy);
            Database reloaded;
            std::string error;
            CHECK(reloaded.load(copy, error));
            if (!sameContent(db, reloaded)) ++wrong;
        }
    };
    CHECK(runSave(db, between) == Database::SaveProgress::Saved);
    CHECK_EQ(wrong, 0);
    db.progress("p7").addItem(Rarity::Mythic, "petal_rose", 2);
    CHECK(db.flushJournal());
    const std::string copy = journalScratch("bg-changes-after");
    copyAsKilled(path, copy);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK(sameContent(db, reloaded));
}

TEST(an_erase_behind_a_background_save_does_not_skip_a_row) {
    // The save walks each table by index; an erase before that index slides
    // every later row down one, and without the table moving the index back
    // the row that slid into place would never be written -- and, unchanged
    // since the save began, it is in no journal line either.
    Database db;
    const std::string path = busyDatabase("bg-erase", db);
    CHECK(db.beginBackgroundSave());
    CHECK(runSave(db, [&](int slice) {
        // A few slices in, the save is part way down `players`; alpha's row
        // was the first one made, far behind it.
        if (slice == 3) {
            CHECK(db.eraseUser("alpha"));
            CHECK(db.flushJournal());
        }
    }) == Database::SaveProgress::Saved);
    Database reloaded;
    std::string error;
    const std::string copy = journalScratch("bg-erase-copy");
    copyAsKilled(path, copy);
    // The file alone, as a restore would read it: no row may be missing.
    std::remove((copy + ".journal").c_str());
    CHECK(reloaded.load(copy, error));
    for (const std::string& id : db.playerIds()) {
        if (reloaded.findProgress(id) == nullptr) {
            std::fprintf(stderr, "  missing %s\n", id.c_str());
            CHECK(false);
            break;
        }
    }
}

TEST(a_restart_between_the_files_rename_and_the_journals_finishes_the_save) {
    Database db;
    const std::string path = busyDatabase("bg-between", db);
    db.progress("p1").addItem(Rarity::Epic, "petal_wing", 1);
    CHECK(db.flushJournal());
    CHECK(db.beginBackgroundSave());
    std::string oldJournal;
    CHECK(runSave(db, [&](int slice) {
        db.progress("p" + std::to_string(slice % 300)).totalXp += 7;
        CHECK(db.flushJournal());
        oldJournal = readAll(path + ".journal");
    }) == Database::SaveProgress::Saved);
    // The new file and its journal, but the old journal still under the name
    // and the new one still `.next`: the rename that did not happen.
    const std::string copy = journalScratch("bg-between-copy");
    copyAsKilled(path, copy);
    testsupport::writeText(copy + ".journal.next", readAll(copy + ".journal"));
    testsupport::writeText(copy + ".journal", oldJournal);
    Database reloaded;
    std::string error;
    CHECK(reloaded.load(copy, error));
    CHECK(reloaded.journalNote().find("interrupted") != std::string::npos);
    CHECK(!fileOnDisk(copy + ".journal.next"));
    CHECK(sameContent(db, reloaded));
}

TEST(a_whole_save_replaces_a_background_one_in_flight) {
    Database db;
    const std::string path = busyDatabase("bg-whole", db);
    CHECK(db.beginBackgroundSave());
    CHECK(db.serviceBackgroundSave(0.0) == Database::SaveProgress::Running);
    db.progress("p3").addItem(Rarity::Legendary, "petal_rose", 1);
    CHECK(db.save());
    CHECK(!db.backgroundSaveRunning());
    CHECK(db.serviceBackgroundSave(0.0) == Database::SaveProgress::Idle);
    CHECK(!fileOnDisk(path + ".journal.next"));
    CHECK_EQ(withoutJournalId(readAll(path)), db.serialise());
    Database reloaded;
    std::string error;
    const std::string copy = journalScratch("bg-whole-copy");
    copyAsKilled(path, copy);
    CHECK(reloaded.load(copy, error));
    CHECK(sameContent(db, reloaded));
}
