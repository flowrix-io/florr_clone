// The skin catalogue on the wire: the Browse tab pages it in from the server,
// up to kSkinPageSize skins at a time, and a client fetches the skins on the
// flowers it sees by id.
//
// It used to arrive whole with every sign-in, in one frame. Once the
// production catalogue outgrew kMaxFrameBytes the server cut it short, and the
// newest skins were missing from everybody's Browse tab.

#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server_harness.h"
#include "shared/core/types.h"
#include "shared/game/skin_format.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

#include <cmath>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

using namespace flix;
using flix::testsupport::browseAll;
using flix::testsupport::connectClient;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;

namespace {

/// A colour no other skin of the fixture comes near: steps of 36 on each
/// channel are past the look-alike fold's colour slack, so the start-up fold
/// keeps every skin. 512 of them.
std::string colourOf(int index) {
    char fill[8];
    std::snprintf(fill, sizeof fill, "#%02x%02x%02x", (index % 8) * 36, (index / 8 % 8) * 36,
                  (index / 64 % 8) * 36);
    return fill;
}

std::string idOf(int index) {
    char id[16];
    std::snprintf(id, sizeof id, "sk_%03d", index);
    return id;
}

/// A plain disc, by an author nobody signs in as (an author may publish only
/// kMaxSkinsPerUser). Oldest first in the file's key order, as a live
/// catalogue is, so the newest are the end of the file -- the ones that went
/// missing.
CustomSkin discSkin(int index, const std::string& name = {}, const std::string& author = "painter") {
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 20;
    body.fill = colourOf(index);
    CustomSkin skin;
    skin.id = idOf(index);
    skin.name = name.empty() ? skin.id : name;
    skin.author = author;
    skin.createdAt = 1000.0 + index;
    skin.shapes = {body};
    return skin;
}

/// A skin as large as the studio lets one be: every shape a polygon with the
/// most points a polygon may have.
CustomSkin heavySkin(int index) {
    SkinShape polygon;
    polygon.t = SkinShapeType::Polygon;
    polygon.fill = colourOf(index);
    for (int i = 0; i < kMaxPolyPoints; ++i) {
        const double angle = 2.0 * kPi * i / kMaxPolyPoints;
        polygon.points.push_back(20.0 * std::cos(angle));
        polygon.points.push_back(20.0 * std::sin(angle));
    }
    CustomSkin skin = discSkin(index);
    skin.shapes.assign(kMaxSkinShapes, polygon);
    return skin;
}

/// Opens a database file, lets `fill` add to it, and saves it.
template <typename F>
void seed(const std::string& path, F fill) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    fill(db);
    db.markDirty();
    db.save();
}

/// Asks for one page of the listing and waits for it.
bool loadPage(Harness& h, NetClient& client, SkinSort sort, const std::string& search,
              bool more) {
    client.browseSkins(sort, search, more);
    return h.stepUntil({&client}, [&] { return !client.skinBrowse().pending; });
}

std::vector<std::string> idsOf(const std::vector<CustomSkin>& skins) {
    std::vector<std::string> ids;
    for (const CustomSkin& skin : skins) ids.push_back(skin.id);
    return ids;
}

} // namespace

TEST(the_browse_tab_loads_the_skin_catalogue_two_hundred_at_a_time) {
    constexpr int kTotal = 2 * kSkinPageSize + 1;
    Harness h("skin-pages", [](const std::string& path) {
        seed(path, [](Database& db) {
            db.createUser("viewer", "hunter2!");
            Json& catalog = db.rawTable("customSkins");
            for (int i = 0; i < kTotal; ++i) catalog[idOf(i)] = skinToJson(discSkin(i));
        });
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient viewer;
    CHECK(loginAs(h, viewer, "viewer", "hunter2!"));
    h.step(5, {&viewer});
    // Signing in sends no catalogue: nothing is worn, nothing is browsed.
    CHECK(viewer.skinCatalog().empty());
    CHECK(!viewer.skinBrowse().loaded);

    // The first page: the newest 200, newest first, and the size of the rest.
    CHECK(loadPage(h, viewer, SkinSort::Newest, "", false));
    const NetClient::SkinBrowse& listing = viewer.skinBrowse();
    CHECK(listing.loaded);
    CHECK_EQ(listing.total, static_cast<std::uint32_t>(kTotal));
    CHECK_EQ(listing.skins.size(), static_cast<std::size_t>(kSkinPageSize));
    CHECK_EQ(listing.skins.front().id, idOf(kTotal - 1));
    CHECK_EQ(listing.skins.back().id, idOf(kTotal - kSkinPageSize));

    // Not asked for, no more comes.
    viewer.browseSkins(SkinSort::Newest, "", false);
    CHECK(!viewer.skinBrowse().pending);
    h.step(5, {&viewer});
    CHECK_EQ(viewer.skinBrowse().skins.size(), static_cast<std::size_t>(kSkinPageSize));

    // Scrolled to the end, the next 200, then the last one.
    CHECK(loadPage(h, viewer, SkinSort::Newest, "", true));
    CHECK_EQ(viewer.skinBrowse().skins.size(), static_cast<std::size_t>(2 * kSkinPageSize));
    CHECK(loadPage(h, viewer, SkinSort::Newest, "", true));
    CHECK_EQ(viewer.skinBrowse().skins.size(), static_cast<std::size_t>(kTotal));
    viewer.browseSkins(SkinSort::Newest, "", true);
    CHECK(!viewer.skinBrowse().pending);

    // Every skin once, newest first, and each in the registry the world
    // renderer and the card buttons read.
    const std::vector<CustomSkin>& all = viewer.skinBrowse().skins;
    for (int i = 0; i < kTotal; ++i) CHECK_EQ(all[static_cast<std::size_t>(i)].id, idOf(kTotal - 1 - i));
    CHECK_EQ(viewer.skinCatalog().size(), static_cast<std::size_t>(kTotal));
    CHECK(viewer.findSkin(idOf(0)) != nullptr);
}

TEST(the_server_searches_and_orders_the_browse_listing) {
    Harness h("skin-browse-orders", [](const std::string& path) {
        seed(path, [](Database& db) {
            const std::string viewer = db.createUser("viewer", "hunter2!").account->id;
            Json& catalog = db.rawTable("customSkins");
            catalog[idOf(0)] = skinToJson(discSkin(0, "Sunflower", "garden"));
            catalog[idOf(1)] = skinToJson(discSkin(1, "Moon", "NightOwl"));
            catalog[idOf(2)] = skinToJson(discSkin(2, "sunny day", "beach"));
            catalog[idOf(3)] = skinToJson(discSkin(3, "Rock", "garden"));
            catalog[idOf(4)] = skinToJson(discSkin(4, "Cloud", "sky"));
            db.progress(viewer).favoriteSkins = {idOf(1), idOf(3)};
            // Top rated: 3 has +2, 0 has +1 (two likes, one dislike), 1 has
            // +1 (one like): 0 before 1 on likes; then the unvoted, newest
            // first; 2 last at -1.
            const char* voters[] = {"voter_a", "voter_b", "voter_c"};
            for (const char* name : voters) db.createUser(name, "hunter2!");
            const auto vote = [&](const char* name, int skin, SkinVote v) {
                db.progress(db.findUser(name)->id).skinVotes[idOf(skin)] = v;
            };
            vote("voter_a", 3, SkinVote::Like);
            vote("voter_b", 3, SkinVote::Like);
            vote("voter_a", 0, SkinVote::Like);
            vote("voter_b", 0, SkinVote::Like);
            vote("voter_c", 0, SkinVote::Dislike);
            vote("voter_c", 1, SkinVote::Like);
            vote("voter_a", 2, SkinVote::Dislike);
        });
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient viewer;
    CHECK(loginAs(h, viewer, "viewer", "hunter2!"));

    CHECK(browseAll(h, viewer, {}, SkinSort::Top));
    CHECK(idsOf(viewer.skinBrowse().skins) ==
          (std::vector<std::string>{idOf(3), idOf(0), idOf(1), idOf(4), idOf(2)}));
    CHECK_EQ(viewer.skinBrowse().skins.front().likes, 2u);

    CHECK(browseAll(h, viewer, {}, SkinSort::Favorites));
    CHECK(idsOf(viewer.skinBrowse().skins) == (std::vector<std::string>{idOf(3), idOf(1)}));

    // Name or author, any case, spaces trimmed.
    CHECK(browseAll(h, viewer, {}, SkinSort::Newest, "  SUN "));
    CHECK(idsOf(viewer.skinBrowse().skins) == (std::vector<std::string>{idOf(2), idOf(0)}));
    CHECK(browseAll(h, viewer, {}, SkinSort::Newest, "garden"));
    CHECK(idsOf(viewer.skinBrowse().skins) == (std::vector<std::string>{idOf(3), idOf(0)}));
    // And a search inside Favorites.
    CHECK(browseAll(h, viewer, {}, SkinSort::Favorites, "owl"));
    CHECK(idsOf(viewer.skinBrowse().skins) == (std::vector<std::string>{idOf(1)}));
    CHECK(browseAll(h, viewer, {}, SkinSort::Newest, "nothing like it"));
    CHECK(viewer.skinBrowse().loaded && viewer.skinBrowse().skins.empty());

    // Unstarring takes a skin out of the Favorites listing at once.
    CHECK(browseAll(h, viewer, {}, SkinSort::Favorites));
    viewer.favoriteSkin(idOf(3), false);
    CHECK(h.stepUntil({&viewer}, [&] { return !viewer.isFavoriteSkin(idOf(3)); }));
    CHECK(idsOf(viewer.skinBrowse().skins) == (std::vector<std::string>{idOf(1)}));
    CHECK_EQ(viewer.skinBrowse().total, 1u);
}

TEST(a_skin_on_a_flower_in_view_is_fetched_without_browsing) {
    Harness h("skin-fetch", [](const std::string& path) {
        seed(path, [](Database& db) {
            const std::string author = db.createUser("wearer", "hunter2!").account->id;
            db.createUser("watcher", "hunter2!");
            db.progress(author).equippedSkinId = idOf(7);
            Json& catalog = db.rawTable("customSkins");
            catalog[idOf(7)] = skinToJson(discSkin(7));
            catalog[idOf(8)] = skinToJson(discSkin(8));
        });
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    // The wearer's own skin comes with the sign-in, and only that one.
    NetClient wearer;
    CHECK(loginAs(h, wearer, "wearer", "hunter2!"));
    CHECK(h.stepUntil({&wearer}, [&] { return wearer.findSkin(idOf(7)) != nullptr; }));
    CHECK_EQ(wearer.equippedSkinId(), idOf(7));
    CHECK_EQ(wearer.skinCatalog().size(), std::size_t(1));

    NetClient watcher;
    CHECK(loginAs(h, watcher, "watcher", "hunter2!"));
    for (NetClient* client : {&wearer, &watcher}) {
        client->joinGame(1280, 720);
        CHECK(h.stepUntil({&wearer, &watcher},
                          [&] { return client->status() == NetClient::Status::Playing; }));
    }
    CHECK(h.stepUntil({&wearer, &watcher}, [&] { return wearer.view().self().netId != 0; }));
    const std::uint32_t wearerId = wearer.view().self().netId;

    // The watcher never opened the studio, and still draws the skin.
    CHECK(h.stepUntil({&wearer, &watcher}, [&] {
        const auto seen = watcher.view().entities().find(wearerId);
        return seen != watcher.view().entities().end() && seen->second.equippedSkinId == idOf(7) &&
               watcher.findSkin(idOf(7)) != nullptr;
    }));
    CHECK(watcher.findSkin(idOf(8)) == nullptr);
    CHECK(!watcher.skinBrowse().loaded);
}

TEST(a_page_of_large_skins_stops_short_of_the_frame_limit) {
    // 64 skins of the largest kind are about 1.6 MB: two hundred of them
    // would be a frame the client drops, and with it the connection.
    constexpr int kTotal = 64;
    Harness h("skin-pages-large", [](const std::string& path) {
        seed(path, [](Database& db) {
            db.createUser("viewer", "hunter2!");
            Json& catalog = db.rawTable("customSkins");
            for (int i = 0; i < kTotal; ++i) catalog[idOf(i)] = skinToJson(heavySkin(i));
        });
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    std::size_t bytes = 0;
    for (int i = 0; i < kTotal; ++i) {
        ByteWriter w;
        writeCustomSkin(w, heavySkin(i));
        bytes += w.size();
    }
    CHECK(bytes > net::kMaxFrameBytes);

    NetClient viewer;
    CHECK(loginAs(h, viewer, "viewer", "hunter2!"));
    CHECK(loadPage(h, viewer, SkinSort::Newest, "", false));
    const std::size_t first = viewer.skinBrowse().skins.size();
    CHECK(first > 0 && first < static_cast<std::size_t>(kTotal));
    CHECK_EQ(viewer.skinBrowse().total, static_cast<std::uint32_t>(kTotal));

    CHECK(browseAll(h, viewer));
    CHECK(viewer.status() == NetClient::Status::LoggedIn);
    std::set<std::string> seen;
    for (const CustomSkin& skin : viewer.skinBrowse().skins) {
        seen.insert(skin.id);
        CHECK_EQ(skin.shapes.size(), static_cast<std::size_t>(kMaxSkinShapes));
    }
    CHECK_EQ(seen.size(), static_cast<std::size_t>(kTotal));
}

TEST(a_skin_published_while_browsing_goes_on_top_of_newest_and_pages_stay_whole) {
    constexpr int kTotal = kSkinPageSize + 20;
    Harness h("skin-pages-live", [](const std::string& path) {
        seed(path, [](Database& db) {
            db.createUser("viewer", "hunter2!");
            db.createUser("artist", "hunter2!");
            Json& catalog = db.rawTable("customSkins");
            for (int i = 0; i < kTotal; ++i) catalog[idOf(i)] = skinToJson(discSkin(i));
        });
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient viewer;
    NetClient artist;
    CHECK(loginAs(h, viewer, "viewer", "hunter2!"));
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    viewer.browseSkins(SkinSort::Newest, "", false);
    CHECK(h.stepUntil({&viewer, &artist}, [&] { return viewer.skinBrowse().loaded; }));
    CHECK_EQ(viewer.skinBrowse().skins.size(), static_cast<std::size_t>(kSkinPageSize));

    // Blue at 255, where none of the first 220 grid colours comes within the
    // publish check's colour slack (they stop at 108), so it is new.
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 24;
    body.fill = "#33ccff";
    artist.publishSkin("fresh", {body});
    CHECK(h.stepUntil({&viewer, &artist}, [&] {
        return viewer.skinBrowse().skins.front().name == "fresh";
    }));
    CHECK_EQ(viewer.skinBrowse().total, static_cast<std::uint32_t>(kTotal + 1));

    // The rest pages in after it with nothing twice and nothing skipped.
    CHECK(browseAll(h, viewer, {&artist}));
    std::set<std::string> seen;
    for (const CustomSkin& skin : viewer.skinBrowse().skins) seen.insert(skin.id);
    CHECK_EQ(viewer.skinBrowse().skins.size(), static_cast<std::size_t>(kTotal + 1));
    CHECK_EQ(seen.size(), static_cast<std::size_t>(kTotal + 1));
}
