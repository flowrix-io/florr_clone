#include "test.h"

#include "server/crypto.h"
#include "server/db.h"
#include "shared/core/json.h"
#include "shared/game/constants.h"
#include "test_data.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace flix;

// "Keep the database format" is a hard requirement: real accounts exist in the
// previous server's inventory.json. These tests load a file in exactly that
// shape and prove a load/save cycle loses nothing -- including fields this
// build has never heard of, which an older binary must not delete from a
// database a newer one wrote.

namespace {

/// A realistic legacy database, covering every top-level key the previous
/// server wrote plus fields this build does not use.
const char* kLegacyDatabase = R"({
  "players": {
    "u-alpha": {
      "totalXP": 125430,
      "mazeTotalXP": 900,
      "mazeTp": 3,
      "mazeSkills": {"absorb": "rare"},
      "inventory": {"common": {"basic": 42, "rose": 7}, "rare": {"stinger": 2}},
      "loadout": [
        {"type": "petal", "rarity": "rare", "petalType": "stinger", "health": 6, "maxHealth": 6},
        null,
        {"type": "petal", "rarity": "common", "petalType": "basic"},
        null, null, null, null, null
      ],
      "mazeLoadout": [null, null, null, null, null, null, null, null],
      "mobKills": {"bee": {"common": 14, "rare": 1}, "ladybug": {"common": 3}},
      "stars": 12,
      "renderFlags": 5,
      "equippedSkinId": "skin-7",
      "dailyStreak": 3,
      "lastStreakDate": "2026-08-29",
      "someFutureField": {"nested": [1, 2, {"deep": true}]}
    }
  },
  "users": {
    "alpha": {
      "id": "u-alpha", "username": "alpha",
      "password": "$2b$12$2XTXtpXNuMonJ9HX442GYeByWDfnKcgsxGWvOK.v7LBQcqAzNhmqu",
      "admin": true, "lastActiveAt": 1758000000000, "muted": false,
      "experimentGroup": "b"
    },
    "beta": {
      "id": "u-beta", "username": "beta",
      "password": "$2b$10$rzSCxDNoOpZCvoqIOV9COeDf72b.2.BrFKB.nglQgpG1r6knpj32m",
      "isPlainText": true, "muted": true, "mutedAt": 1757000000000, "mutedBy": "alpha"
    }
  },
  "codes": {"WELCOME": {"code": "WELCOME", "stars": 5, "maxUses": 100, "uses": 3,
                        "usedBy": ["u-alpha"], "createdBy": "alpha", "createdAt": 1750000000000}},
  "notifications": [{"id": "n1", "type": "super_craft",
                     "message": "alpha crafted a Super Stinger", "timestamp": 1758000000001}],
  "guilds": {"ALPHA": {"name": "ALPHA", "leaderUsername": "alpha",
                       "memberUsernames": ["alpha", "beta"], "createdAt": 1751000000000}},
  "apiKeys": {"key-1": {"key": "key-1", "username": "alpha", "label": "discord-bot",
                        "createdAt": 1752000000000}},
  "customSkins": {"skin-7": {"id": "skin-7", "name": "Sunny", "author": "alpha", "data": "AAAA"}},
  "sessions": {"deadbeef": {"tokenHash": "deadbeef", "userId": "u-alpha", "username": "alpha",
                            "createdAt": 1758000000000, "expiresAt": 4102444800000}},
  "aTopLevelKeyWeDoNotKnow": {"anything": 42}
})";

/// Every path scratchPath() has handed out, removed when the process exits.
///
/// Not by the tests themselves: each one's last std::remove runs while its own
/// Database is still in scope, and ~Database writes a dirty database straight
/// back on the way out (a load of a missing file, a migration, a login all
/// leave one dirty), so the file outlived the run. At exit every test's
/// Database is long gone, and the removal sticks.
struct ScratchFiles {
    std::vector<std::string> paths;
    ~ScratchFiles() {
        for (const std::string& path : paths) {
            std::remove(path.c_str());
            std::remove((path + ".tmp").c_str());
        }
    }
};

/// A database file of this process's own, in the tests' scratch directory.
std::string scratchPath(const char* name) {
    static ScratchFiles handedOut;
    std::string path = testsupport::tempUnique(std::string("florr-dbtest-") + name, ".json");
    handedOut.paths.push_back(path);
    return path;
}

void writeFile(const std::string& path, const std::string& text) {
    testsupport::writeText(path, text);
}

/// The file as it is on disk now, or "" when it cannot be read.
std::string readFile(const std::string& path) {
    std::string text;
    testsupport::readText(path, text);
    return text;
}

} // namespace

TEST(a_legacy_database_loads_with_its_accounts_intact) {
    const std::string path = scratchPath("load");
    writeFile(path, kLegacyDatabase);

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    CHECK(error.empty());
    CHECK(!db.loadFailed());

    const Account* alpha = db.findUser("alpha");
    CHECK(alpha != nullptr);
    if (alpha) {
        CHECK_EQ(alpha->id, std::string("u-alpha"));
        CHECK(alpha->admin);
    }

    // The whole point: passwords hashed by the previous server still verify.
    CHECK(db.verifyPassword("alpha", "correct horse battery staple"));
    CHECK(db.verifyPassword("beta", "hunter2"));
    CHECK(!db.verifyPassword("alpha", "wrong"));
    CHECK(!db.verifyPassword("nobody", "anything"));

    const PlayerRecord& progress = db.progress("u-alpha");
    CHECK_NEAR(progress.totalXp, 125430.0, 1e-9);
    CHECK_EQ(progress.stars, 12);

    std::remove(path.c_str());
}

TEST(a_save_cycle_loses_nothing_including_unknown_fields) {
    const std::string path = scratchPath("roundtrip");
    writeFile(path, kLegacyDatabase);

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    db.markDirty();
    CHECK(db.save());

    Json before, after;
    std::string e1, e2;
    CHECK(Json::parse(kLegacyDatabase, before, e1));
    CHECK(Json::parse(readFile(path), after, e2));

    for (const std::string& key : before.keys()) CHECK(after.contains(key));

    const Json& player = after["players"]["u-alpha"];
    for (const char* key : {"totalXP", "inventory", "loadout", "mobKills", "stars",
                            "mazeTotalXP", "mazeSkills", "renderFlags", "equippedSkinId",
                            "dailyStreak", "lastStreakDate"}) {
        CHECK(player.contains(key));
    }
    CHECK_EQ(player["mobKills"]["bee"]["common"].asInt(), 14);
    CHECK_EQ(player["loadout"].size(), std::size_t(8));
    CHECK(player["loadout"][1].isNull());
    CHECK_EQ(player["loadout"][0]["petalType"].asString(), std::string("stinger"));

    const Json& beta = after["users"]["beta"];
    for (const char* key : {"mutedAt", "mutedBy", "isPlainText"}) CHECK(beta.contains(key));

    // Fields this build has never heard of. Without preservation, running an
    // older server against a newer database quietly deletes what it added.
    CHECK(player.contains("someFutureField"));
    CHECK_EQ(player["someFutureField"]["nested"].size(), std::size_t(3));
    CHECK(player["someFutureField"]["nested"][2]["deep"].asBool());
    CHECK_EQ(after["users"]["alpha"]["experimentGroup"].asString(), std::string("b"));
    CHECK(after.contains("aTopLevelKeyWeDoNotKnow"));
    CHECK_EQ(after["aTopLevelKeyWeDoNotKnow"]["anything"].asInt(), 42);

    // The side tables the game does not read on this path must also survive.
    CHECK_EQ(after["guilds"]["ALPHA"]["memberUsernames"].size(), std::size_t(2));
    CHECK_EQ(after["codes"]["WELCOME"]["uses"].asInt(), 3);
    CHECK_EQ(after["notifications"].size(), std::size_t(1));
    CHECK(after["customSkins"].contains("skin-7"));
    CHECK(after["apiKeys"].contains("key-1"));

    std::remove(path.c_str());
}

TEST(an_unreadable_database_blocks_writes_instead_of_replacing_it) {
    const std::string path = scratchPath("corrupt");
    const std::string corrupt = "{ this is not json";
    writeFile(path, corrupt);

    Database db;
    std::string error;
    CHECK(!db.load(path, error));
    CHECK(!error.empty());
    CHECK(db.loadFailed());

    // Coming up with an empty database and saving over the file would turn a
    // recoverable problem into permanent, total account loss.
    db.markDirty();
    CHECK(!db.save());
    CHECK_EQ(readFile(path), corrupt);

    std::remove(path.c_str());
}

TEST(a_missing_database_starts_empty_and_is_writable) {
    const std::string path = scratchPath("missing");
    std::remove(path.c_str());

    Database db;
    std::string error;
    // A first run has no file yet; that is not a failure.
    CHECK(db.load(path, error));
    CHECK(!db.loadFailed());

    const CreateResult created = db.createUser("newplayer", "a-good-password");
    CHECK(created.ok());
    CHECK(created.account != nullptr);
    CHECK(db.verifyPassword("newplayer", "a-good-password"));

    db.markDirty();
    CHECK(db.save());

    Database reloaded;
    CHECK(reloaded.load(path, error));
    CHECK(reloaded.verifyPassword("newplayer", "a-good-password"));

    std::remove(path.c_str());
}

TEST(duplicate_registration_is_refused) {
    const std::string path = scratchPath("dupe");
    std::remove(path.c_str());

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    CHECK(db.createUser("taken", "a-good-password").ok());

    const CreateResult again = db.createUser("taken", "another-password");
    CHECK(!again.ok());
    CHECK(!again.reason.empty());
    // The original password must still be the one that works.
    CHECK(db.verifyPassword("taken", "a-good-password"));
    CHECK(!db.verifyPassword("taken", "another-password"));

    std::remove(path.c_str());
}

TEST(a_set_password_rehashes_and_survives_a_reload) {
    const std::string path = scratchPath("setpassword");
    std::remove(path.c_str());

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    db.setPasswordCost(crypto::kBcryptMinCost);
    CHECK(db.createUser("rotator", "a-good-password").ok());

    std::string reason;
    CHECK(db.setPassword("rotator", "a-better-password", reason));
    CHECK(reason.empty());
    CHECK(!db.verifyPassword("rotator", "a-good-password"));
    CHECK(db.verifyPassword("rotator", "a-better-password"));

    // Stored as a hash, never as what was typed -- the same property
    // createUser has, and the one a reload has to preserve.
    const Account* account = db.findUser("rotator");
    CHECK(account != nullptr);
    if (account) {
        CHECK(crypto::isBcryptHash(account->passwordHash));
        CHECK(!account->isPlainText);
    }

    CHECK(db.save());
    Database reloaded;
    CHECK(reloaded.load(path, error));
    CHECK(reloaded.verifyPassword("rotator", "a-better-password"));

    std::remove(path.c_str());
}

TEST(a_set_password_refuses_what_validPassword_refuses) {
    const std::string path = scratchPath("setpassword-rules");
    std::remove(path.c_str());

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    db.setPasswordCost(crypto::kBcryptMinCost);
    CHECK(db.createUser("picky", "a-good-password").ok());

    std::string reason;
    CHECK(!db.setPassword("picky", "short", reason));
    CHECK(!reason.empty());
    // Past bcrypt's 72 bytes, where the tail would silently do nothing.
    CHECK(!db.setPassword("picky", std::string(73, 'x'), reason));
    CHECK(!db.setPassword("nobody", "a-fine-password", reason));
    CHECK(!reason.empty());

    // A refusal leaves the account exactly as it was.
    CHECK(db.verifyPassword("picky", "a-good-password"));

    std::remove(path.c_str());
}

TEST(the_admin_flag_comes_only_from_the_file) {
    // No account is an admin because of its NAME. A row called a19kisme with
    // no `admin` field loads as an ordinary account and is written back as
    // one -- a flag read in at load is a flag the next save writes out -- and
    // a fresh registration of the name, in any case, starts as one. A row
    // that does carry the flag keeps it: the file is the only authority,
    // which is also why taking a name check out does not take back a flag an
    // older build has already written.
    const std::string path = scratchPath("admin-flag");
    writeFile(path, R"({
  "users": {
    "a19kisme": {"id": "u-named", "username": "a19kisme",
                 "password": "$2b$12$2XTXtpXNuMonJ9HX442GYeByWDfnKcgsxGWvOK.v7LBQcqAzNhmqu"},
    "keeper": {"id": "u-keeper", "username": "keeper", "admin": true,
               "password": "$2b$12$2XTXtpXNuMonJ9HX442GYeByWDfnKcgsxGWvOK.v7LBQcqAzNhmqu"}
  },
  "players": {"u-named": {}, "u-keeper": {}}
})");

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    const Account* named = db.findUser("a19kisme");
    CHECK(named != nullptr);
    if (named) CHECK(!named->admin);
    const Account* keeper = db.findUser("keeper");
    CHECK(keeper != nullptr);
    if (keeper) CHECK(keeper->admin);

    db.markDirty();
    CHECK(db.save());
    Json saved;
    std::string parseError;
    CHECK(Json::parse(readFile(path), saved, parseError));
    CHECK(saved["users"].contains("a19kisme"));
    CHECK(!saved["users"]["a19kisme"].contains("admin"));
    CHECK(saved["users"]["keeper"]["admin"].asBool());

    const std::string freshPath = scratchPath("admin-flag-fresh");
    std::remove(freshPath.c_str());
    Database fresh;
    CHECK(fresh.load(freshPath, error));
    fresh.setPasswordCost(crypto::kBcryptMinCost);
    const CreateResult created = fresh.createUser("A19KISME", "a-good-password");
    CHECK(created.ok());
    if (created.account) CHECK(!created.account->admin);

    std::remove(path.c_str());
    std::remove(freshPath.c_str());
}

TEST(sessions_are_stored_hashed_and_expire) {
    const std::string path = scratchPath("sessions");
    std::remove(path.c_str());

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    const CreateResult created = db.createUser("sessionuser", "a-good-password");
    CHECK(created.ok());
    if (!created.account) return;

    const std::string token = db.createSession(created.account->id, "sessionuser");
    CHECK(!token.empty());

    const Database::Session* resolved = db.resolveSession(token);
    CHECK(resolved != nullptr);
    if (resolved) {
        CHECK_EQ(resolved->username, std::string("sessionuser"));
        // Only the hash is stored, so a leaked database hands out no sessions.
        CHECK(resolved->tokenHash != token);
    }
    CHECK(db.resolveSession("some-other-token") == nullptr);
    CHECK(db.resolveSession("") == nullptr);

    db.revokeSession(token);
    CHECK(db.resolveSession(token) == nullptr);

    std::remove(path.c_str());
}

TEST(a_star_balance_past_32_bits_survives_the_database) {
    // Stars are a double for the same reason XP is: the reference keeps the
    // balance in a JS number and a code can mint any amount, so the only
    // ceiling the pipeline is allowed to have is the JSON number's own 2^53.
    // Held as an int, everything past 2.1 billion used to come back as garbage
    // -- a balance in the billions is not a rounding error, it is a different
    // number entirely.
    const std::string path = scratchPath("bigstars");
    std::remove(path.c_str());

    constexpr double kBalance = 12'345'678'901'234.0;
    {
        Database db;
        std::string error;
        db.load(path, error);
        db.setPasswordCost(4);
        const CreateResult created = db.createUser("croesus", "a-good-password");
        CHECK(created.ok());
        if (!created.account) return;
        db.progress(created.account->id).stars = kBalance;
        db.markDirty();
        CHECK(db.save());
    }

    // On the disk as digits, not as an exponent an older reader would mangle.
    CHECK(readFile(path).find("12345678901234") != std::string::npos);

    Database reloaded;
    std::string error;
    CHECK(reloaded.load(path, error));
    const Account* account = reloaded.findUser("croesus");
    CHECK(account != nullptr);
    if (account) CHECK_EQ(reloaded.progress(account->id).stars, kBalance);

    std::remove(path.c_str());
}

TEST(a_stack_stops_at_the_cap_instead_of_wrapping) {
    // One past a full stack used to wrap the int negative, and a stack at or
    // below zero is erased as empty: the pickup that should have been lost
    // took the whole stack with it.
    PlayerRecord record;
    record.addItem(Rarity::Common, "petal_rose", kMaxStackCount - 1);
    record.addItem(Rarity::Common, "petal_rose", 5);
    CHECK_EQ(record.itemCount(Rarity::Common, "petal_rose"), kMaxStackCount);
    record.addItem(Rarity::Common, "petal_rose", kMaxStackCount);
    CHECK_EQ(record.itemCount(Rarity::Common, "petal_rose"), kMaxStackCount);

    // And spent from the top like any other stack.
    record.addItem(Rarity::Common, "petal_rose", -(kMaxStackCount - 7));
    CHECK_EQ(record.itemCount(Rarity::Common, "petal_rose"), 7);
    record.addItem(Rarity::Common, "petal_rose", -7);
    CHECK_EQ(record.itemCount(Rarity::Common, "petal_rose"), 0);
    CHECK(!record.inventory.contains("common"));

    // A count past the cap in the file -- hand-edited, or written by a server
    // whose JS numbers have no int ceiling -- reads as a full stack rather
    // than through an out-of-range cast.
    record.inventory["rare"]["petal_rose"] = Json(1e12);
    CHECK_EQ(record.itemCount(Rarity::Rare, "petal_rose"), kMaxStackCount);
    record.inventory["rare"]["petal_rose"] = Json(-3.0);
    CHECK_EQ(record.itemCount(Rarity::Rare, "petal_rose"), 0);
    record.inventory["rare"]["petal_rose"] = Json("lots");
    CHECK_EQ(record.itemCount(Rarity::Rare, "petal_rose"), 0);
}

TEST(a_save_rewrites_every_row_changed_since_the_last_one) {
    // A save assembles the file from each row's cached text and re-serialises
    // only rows handed out mutably since. After every kind of edit that text
    // must still be exactly what rebuilding the whole tree gives: a row whose
    // cache outlived an edit is an edit the file never receives.
    const std::string path = scratchPath("rowcache");
    writeFile(path, kLegacyDatabase);

    Database db;
    std::string error;
    CHECK(db.load(path, error));
    db.setPasswordCost(crypto::kBcryptMinCost);

    const auto matchesRebuild = [&](const char* edit) {
        const bool same = db.serialise() == db.toJson().dump(0);
        if (!same) ::testing::reportFailure(__FILE__, __LINE__, std::string("stale after ") + edit);
    };
    matchesRebuild("the load");

    db.progress("u-alpha").addItem(Rarity::Rare, "stinger", 3);
    matchesRebuild("an inventory change");
    db.progress("u-alpha").totalXp += 10;
    matchesRebuild("an XP change");
    db.findUser("BETA")->admin = true;
    matchesRebuild("an account found by another spelling");
    db.findUserById("u-alpha")->muted = true;
    matchesRebuild("an account found by id");

    const std::string token = db.createSession("u-alpha", "alpha");
    matchesRebuild("a new session");
    CHECK(db.resolveSession(token) != nullptr);
    matchesRebuild("a resume, which stamps lastActiveAt");
    db.revokeSession(token);
    matchesRebuild("a revoked session");

    db.rawTable("codes")["WELCOME"].set("uses", Json(4));
    matchesRebuild("a raw table edit");
    db.rawArrayTable("notifications").push(Json::object());
    matchesRebuild("a raw array edit");
    db.rawTable("brandNewTable")["k"] = Json(1);
    matchesRebuild("a new raw table");
    CHECK(!db.accountAddressHash("203.0.113.9").empty());
    matchesRebuild("a newly minted address salt");

    CHECK(db.createUser("gamma", "a-good-password").ok());
    matchesRebuild("a new account");
    CHECK(db.eraseUser("beta"));
    matchesRebuild("an erased account");

    // And through the file, not only the string.
    CHECK(db.save());
    Database reloaded;
    CHECK(reloaded.load(path, error));
    CHECK_EQ(reloaded.progress("u-alpha").itemCount(Rarity::Rare, "stinger"), 5);
    CHECK(reloaded.findUser("alpha") != nullptr && reloaded.findUser("alpha")->muted);
    CHECK(reloaded.findUser("beta") == nullptr);
    CHECK(reloaded.findUser("gamma") != nullptr);
    CHECK_EQ(reloaded.storedTable("codes")["WELCOME"]["uses"].asInt(), 4);
    CHECK_EQ(reloaded.storedTable("notifications").size(), std::size_t(2));

    std::remove(path.c_str());
}

TEST(equipped_petals_stay_in_the_stored_inventory) {
    // Live, equipping takes a petal out of the bag. Stored, it stays in it and
    // the loadout only says which ones are worn, so a loadout lost from the
    // file costs a re-equip rather than the petals.
    PlayerRecord record;
    record.addItem(Rarity::Common, "petal_basic", 3);
    record.loadout.resize(kLoadoutSlots);
    StoredItem stinger;
    stinger.petalType = "stinger";
    stinger.rarity = Rarity::Rare;
    record.loadout[0] = stinger;
    StoredItem basic;
    basic.petalType = "basic";
    record.loadout[2] = basic;

    const Json stored = playerRecordJson(record);
    CHECK(stored["loadoutInInventory"].asBool());
    CHECK_EQ(stored["inventory"]["common"]["petal_basic"].asInt(), 4);
    CHECK_EQ(stored["inventory"]["rare"]["petal_stinger"].asInt(), 1);

    // And a load hands the worn ones back to the loadout: nothing doubles.
    const PlayerRecord loaded = parsePlayerRecord(stored);
    CHECK_EQ(loaded.itemCount(Rarity::Common, "petal_basic"), 3);
    CHECK_EQ(loaded.itemCount(Rarity::Rare, "petal_stinger"), 0);
    CHECK(loaded.loadout[0].has_value() && loaded.loadout[0]->petalType == "stinger");
    CHECK(loaded.loadout[2].has_value() && loaded.loadout[2]->petalType == "basic");
    CHECK_EQ(playerRecordJson(loaded).dump(0), stored.dump(0));
    CHECK(!loaded.extra.contains("loadoutInInventory"));

    // A loadout gone from the file leaves every petal in the bag.
    Json lost = stored;
    lost.erase("loadout");
    const PlayerRecord bare = parsePlayerRecord(lost);
    CHECK_EQ(bare.itemCount(Rarity::Common, "petal_basic"), 4);
    CHECK_EQ(bare.itemCount(Rarity::Rare, "petal_stinger"), 1);
}

TEST(a_stored_loadout_cannot_wear_what_the_inventory_lacks) {
    // Two slots naming the one rare stinger the bag holds: the first is
    // seated, the second dropped rather than given a copy.
    Json stored;
    std::string error;
    CHECK(Json::parse(R"({"loadoutInInventory": true,
        "inventory": {"rare": {"petal_stinger": 1}},
        "loadout": [{"type": "petal", "rarity": "rare", "petalType": "stinger"},
                    {"type": "petal", "rarity": "rare", "petalType": "stinger"},
                    {"type": "petal", "rarity": "mythic", "petalType": "rose"}]})",
                      stored, error));
    const PlayerRecord record = parsePlayerRecord(stored);
    CHECK(record.loadout[0].has_value());
    CHECK(!record.loadout[1].has_value());
    CHECK(!record.loadout[2].has_value());
    CHECK_EQ(record.itemCount(Rarity::Rare, "petal_stinger"), 0);
}

TEST(an_unmarked_record_keeps_its_worn_petals_out_of_the_bag) {
    // The old shape: worn petals are not in the stored inventory, so the load
    // must not take them out of it a second time. The next save migrates it.
    Json stored;
    std::string error;
    CHECK(Json::parse(R"({"inventory": {"common": {"petal_basic": 5}},
        "loadout": [{"type": "petal", "rarity": "common", "petalType": "basic"},
                    {"type": "petal", "rarity": "rare", "petalType": "stinger"}]})",
                      stored, error));
    const PlayerRecord record = parsePlayerRecord(stored);
    CHECK_EQ(record.itemCount(Rarity::Common, "petal_basic"), 5);
    CHECK(record.loadout[0].has_value() && record.loadout[1].has_value());

    const Json migrated = playerRecordJson(record);
    CHECK_EQ(migrated["inventory"]["common"]["petal_basic"].asInt(), 6);
    CHECK_EQ(migrated["inventory"]["rare"]["petal_stinger"].asInt(), 1);
}
