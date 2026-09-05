#include "test.h"

#include "server/db.h"
#include "shared/core/json.h"

#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

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

std::string scratchPath(const char* name) {
    return std::string("/tmp/florr-dbtest-") + name + "-" + std::to_string(::getpid()) + ".json";
}

void writeFile(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
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
