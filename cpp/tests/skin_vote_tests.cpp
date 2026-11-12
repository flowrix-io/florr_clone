// Skin likes, dislikes and favourites: where a vote is kept, who may cast one,
// and what every client is told about it.
//
// Votes live on the VOTER's account row and the counts are the server's tally
// of those rows, so these cases read both ends: the tally a client is sent,
// and the row the save will write.

#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server_harness.h"
#include "shared/game/skin_format.h"

#include <string>
#include <vector>

using namespace flix;
using flix::testsupport::connectClient;
using flix::testsupport::browseAll;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;
using flix::testsupport::loginNew;
using flix::testsupport::sawText;

namespace {

/// A skin that looks like nothing else in the catalog: a plain disc, told
/// apart by its colour, so the start-up fold leaves every one of them alone.
CustomSkin disc(const char* id, const char* author, const char* fill, double createdAt) {
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 20;
    body.fill = fill;
    CustomSkin skin;
    skin.id = id;
    skin.name = id;
    skin.author = author;
    skin.createdAt = createdAt;
    skin.shapes = {body};
    return skin;
}

/// Seeds `artist` (password hunter2!) and two skins of theirs.
void seedCatalog(Database& db) {
    db.setPasswordCost(4);
    db.createUser("artist", "hunter2!");
    Json& catalog = db.rawTable("customSkins");
    catalog["sk_red"] = skinToJson(disc("sk_red", "artist", "#d01c1d", 100));
    catalog["sk_blue"] = skinToJson(disc("sk_blue", "artist", "#3a86ff", 200));
}

const CustomSkin* skinIn(const NetClient& client, const char* id) {
    return client.findSkin(id);
}

const PlayerRecord* rowOf(const Harness& h, const char* username) {
    const Account* account = h.server.database().findUser(username);
    return account ? h.server.database().findProgress(account->id) : nullptr;
}

} // namespace

TEST(a_vote_moves_the_tally_for_everyone_and_is_kept_on_the_voters_row) {
    Harness h("skin-votes", [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        seedCatalog(db);
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient fan;
    NetClient watcher;
    CHECK(loginNew(h, fan, "fan", "hunter2!"));
    CHECK(loginNew(h, watcher, "watcher", "hunter2!"));
    CHECK(browseAll(h, watcher, {&fan}));
    CHECK(skinIn(watcher, "sk_red") != nullptr);

    fan.voteSkin("sk_red", SkinVote::Like);
    CHECK(h.stepUntil({&fan, &watcher}, [&] {
        const CustomSkin* seen = skinIn(watcher, "sk_red");
        return fan.skinVote("sk_red") == SkinVote::Like && seen && seen->likes == 1;
    }));
    CHECK(rowOf(h, "fan") && rowOf(h, "fan")->skinVotes.at("sk_red") == SkinVote::Like);
    // Only the skin voted on moved, and only on the voter's side.
    CHECK_EQ(skinIn(watcher, "sk_blue")->likes, 0u);
    CHECK(watcher.skinVote("sk_red") == SkinVote::None);

    // A vote is replaced, not added to.
    fan.voteSkin("sk_red", SkinVote::Dislike);
    CHECK(h.stepUntil({&fan, &watcher}, [&] {
        const CustomSkin* seen = skinIn(watcher, "sk_red");
        return seen && seen->likes == 0 && seen->dislikes == 1;
    }));
    CHECK(fan.skinVote("sk_red") == SkinVote::Dislike);

    fan.voteSkin("sk_red", SkinVote::None);
    CHECK(h.stepUntil({&fan, &watcher}, [&] {
        const CustomSkin* seen = skinIn(watcher, "sk_red");
        return seen && seen->dislikes == 0 && fan.skinVote("sk_red") == SkinVote::None;
    }));
    CHECK(rowOf(h, "fan")->skinVotes.empty());
}

TEST(a_vote_never_touches_the_skin_catalogs_save_text) {
    // The reason votes sit on the voter's row: the catalogue is one cached
    // blob in the file, and a vote that edited it would have every save after
    // it re-dump every skin.
    Harness h("skin-votes-cache", [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        seedCatalog(db);
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    h.step(2, {});
    CHECK(h.server.database().tableTextCached("customSkins"));

    NetClient fan;
    CHECK(loginNew(h, fan, "fan", "hunter2!"));
    fan.voteSkin("sk_red", SkinVote::Like);
    fan.favoriteSkin("sk_blue", true);
    CHECK(h.stepUntil({&fan}, [&] {
        return fan.skinVote("sk_red") == SkinVote::Like && fan.isFavoriteSkin("sk_blue");
    }));
    CHECK(h.server.database().tableTextCached("customSkins"));
}

TEST(an_author_and_a_guest_cannot_vote_but_may_star) {
    Harness h("skin-votes-refused", [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        seedCatalog(db);
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient artist;
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    CHECK(browseAll(h, artist));
    artist.voteSkin("sk_red", SkinVote::Like);
    CHECK(h.stepUntil({&artist}, [&] { return sawText(artist, "can't vote on your own skin"); }));
    CHECK(rowOf(h, "artist")->skinVotes.empty());
    // Starring your own is only a bookmark.
    artist.favoriteSkin("sk_red", true);
    CHECK(h.stepUntil({&artist}, [&] { return artist.isFavoriteSkin("sk_red"); }));

    NetClient guest;
    CHECK(connectClient(h, guest));
    guest.requestGuest();
    CHECK(h.stepUntil({&guest}, [&] { return guest.status() == NetClient::Status::LoggedIn; }));
    guest.voteSkin("sk_red", SkinVote::Dislike);
    CHECK(h.stepUntil({&guest}, [&] { return sawText(guest, "non-guest"); }));
    guest.favoriteSkin("sk_blue", true);
    CHECK(h.stepUntil({&guest}, [&] { return guest.isFavoriteSkin("sk_blue"); }));

    h.step(5, {&artist, &guest});
    const CustomSkin* red = skinIn(artist, "sk_red");
    CHECK(red && red->likes == 0 && red->dislikes == 0);
    CHECK(guest.skinVote("sk_red") == SkinVote::None);
}

TEST(votes_and_stars_come_back_with_the_next_sign_in) {
    // The tally is counted from the rows at start, so seeded rows are a
    // restart: three likes and a dislike that no running server ever saw.
    Harness h("skin-votes-restart", [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        seedCatalog(db);
        const std::string fan = db.createUser("fan", "hunter2!").account->id;
        db.progress(fan).skinVotes["sk_blue"] = SkinVote::Like;
        db.progress(fan).favoriteSkins = {"sk_red", "sk_gone"};
        for (const char* name : {"one", "two"}) {
            const std::string id = db.createUser(name, "hunter2!").account->id;
            db.progress(id).skinVotes["sk_blue"] = SkinVote::Like;
            db.progress(id).skinVotes["sk_red"] = SkinVote::Dislike;
        }
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient fan;
    CHECK(loginAs(h, fan, "fan", "hunter2!"));
    CHECK(browseAll(h, fan));
    CHECK_EQ(skinIn(fan, "sk_blue")->likes, 3u);
    CHECK_EQ(skinIn(fan, "sk_red")->dislikes, 2u);
    CHECK(fan.skinVote("sk_blue") == SkinVote::Like);
    CHECK(fan.isFavoriteSkin("sk_red"));
    // A star on a skin that is gone is not sent: there is no card for it.
    CHECK(!fan.isFavoriteSkin("sk_gone"));

    // Unstarred, it stays unstarred on the next sign-in too.
    fan.favoriteSkin("sk_red", false);
    CHECK(h.stepUntil({&fan}, [&] { return !fan.isFavoriteSkin("sk_red"); }));
    fan.disconnect();
    NetClient again;
    CHECK(loginAs(h, again, "fan", "hunter2!"));
    CHECK(browseAll(h, again));
    CHECK(!again.isFavoriteSkin("sk_red"));
    CHECK(again.skinVote("sk_blue") == SkinVote::Like);
}

TEST(taking_a_skin_down_forgets_every_vote_and_star_on_it) {
    Harness h("skin-votes-delete", [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        seedCatalog(db);
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient fan;
    NetClient artist;
    CHECK(loginNew(h, fan, "fan", "hunter2!"));
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    CHECK(browseAll(h, fan, {&artist}));
    CHECK(browseAll(h, artist, {&fan}));
    fan.voteSkin("sk_red", SkinVote::Like);
    fan.favoriteSkin("sk_red", true);
    CHECK(h.stepUntil({&fan, &artist}, [&] {
        return fan.isFavoriteSkin("sk_red") && skinIn(artist, "sk_red") &&
               skinIn(artist, "sk_red")->likes == 1;
    }));

    artist.deleteSkin("sk_red");
    CHECK(h.stepUntil({&fan, &artist}, [&] { return skinIn(fan, "sk_red") == nullptr; }));
    CHECK(!fan.isFavoriteSkin("sk_red"));
    CHECK(fan.skinVote("sk_red") == SkinVote::None);
    const PlayerRecord* row = rowOf(h, "fan");
    CHECK(row && row->skinVotes.empty() && row->favoriteSkins.empty());
}

TEST(a_stored_vote_is_a_like_or_a_dislike_and_nothing_else) {
    Json row = Json::object();
    Json votes = Json::object();
    votes["sk_a"] = 1;
    votes["sk_b"] = -1;
    votes["sk_c"] = 5;       // hand-edited: not five likes
    votes["sk_d"] = 0;
    votes["sk_e"] = "yes";
    row["skinVotes"] = votes;
    Json favorites = Json::array();
    for (const char* id : {"sk_a", "sk_a", "", "sk_b"}) favorites.push(Json(id));
    row["favoriteSkins"] = favorites;

    const PlayerRecord record = parsePlayerRecord(row);
    CHECK_EQ(record.skinVotes.size(), std::size_t(2));
    CHECK(record.skinVotes.at("sk_a") == SkinVote::Like);
    CHECK(record.skinVotes.at("sk_b") == SkinVote::Dislike);
    CHECK_EQ(record.favoriteSkins.size(), std::size_t(2));

    // And back out as the +1 / -1 it was read from; an account with neither
    // writes neither key.
    const Json out = playerRecordJson(record);
    CHECK_EQ(out["skinVotes"]["sk_a"].asInt(), 1);
    CHECK_EQ(out["skinVotes"]["sk_b"].asInt(), -1);
    CHECK_EQ(out["favoriteSkins"].size(), std::size_t(2));
    const Json empty = playerRecordJson(PlayerRecord{});
    CHECK(!empty.contains("skinVotes"));
    CHECK(!empty.contains("favoriteSkins"));
}
