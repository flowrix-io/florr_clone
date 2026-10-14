// Skin deduplication: what counts as "the same skin", and what the server does
// with one.
//
// The sampling cases are written as the catalog's real copies were made -- the
// same payload again, the starter with a hair moved, a nose one size up -- and
// its real changes: a mouth, a recoloured body, an eye taken away. The
// geometry cases pin the sampler to the painter: a rotated rect has to land
// where renderSkinShapes would rotate it, or every rotated shape would compare
// against the wrong picture.

#include "test.h"

#include "client/net_client.h"
#include "server_harness.h"
#include "shared/core/types.h"
#include "shared/game/skin_format.h"
#include "shared/game/skin_likeness.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace flix;

namespace {

SkinShape circle(double x, double y, double r, const char* fill) {
    SkinShape s;
    s.t = SkinShapeType::Circle;
    s.x = x;
    s.y = y;
    s.r = r;
    s.fill = fill;
    return s;
}

bool alike(const std::vector<SkinShape>& a, const std::vector<SkinShape>& b) {
    return skinsLookAlike(sampleSkinLook(a), sampleSkinLook(b));
}

int paintedCells(const SkinLook& look) {
    int n = 0;
    for (const std::uint32_t c : look.cells) n += c != 0;
    return n;
}

/// The starter with a smile under its eyes, drawn bold enough (16 cells) to
/// be a change with room to spare, rather than at the threshold.
std::vector<SkinShape> starterWithMouth() {
    std::vector<SkinShape> shapes = starterSkinShapes();
    SkinShape mouth;
    mouth.t = SkinShapeType::Curve;
    mouth.x = -7;
    mouth.y = 8;
    mouth.x2 = 7;
    mouth.y2 = 8;
    mouth.cx1 = -4;
    mouth.cy1 = 14;
    mouth.cx2 = 4;
    mouth.cy2 = 14;
    mouth.stroke = "#111111";
    mouth.sw = 3;
    shapes.push_back(mouth);
    return shapes;
}

} // namespace

TEST(a_skin_looks_like_itself) {
    CHECK(alike(starterSkinShapes(), starterSkinShapes()));
    // Painting nothing visible is a look like any other.
    CHECK(alike({circle(0, 0, 0.5, "#123456")}, {circle(10, 0, 0.5, "#654321")}));
}

TEST(copies_that_only_differ_in_the_shape_list_look_alike) {
    // A shape hidden under the body changes the list and not the picture.
    std::vector<SkinShape> hidden = starterSkinShapes();
    hidden.insert(hidden.begin(), circle(4, 4, 6, "#ff0000"));
    CHECK(alike(starterSkinShapes(), hidden));

    // The two eyes in the other order paint the same two eyes.
    std::vector<SkinShape> swapped = starterSkinShapes();
    std::swap(swapped[1], swapped[2]);
    CHECK(alike(starterSkinShapes(), swapped));
}

TEST(a_nudge_or_a_shade_is_not_a_new_skin) {
    std::vector<SkinShape> nudged = starterSkinShapes();
    for (SkinShape& s : nudged) s.x += 1.0;
    CHECK(alike(starterSkinShapes(), nudged));

    std::vector<SkinShape> shaded = starterSkinShapes();
    shaded[0].fill = "#f8e070";   // #ffe763, a few steps off on every channel
    CHECK(alike(starterSkinShapes(), shaded));

    // The catalog's own case: one face published twice, the second with its
    // nose dot a size larger.
    std::vector<SkinShape> small = starterSkinShapes();
    small.push_back(circle(0, 3, 1.5, "#111111"));
    std::vector<SkinShape> large = starterSkinShapes();
    large.push_back(circle(0, 3, 2.5, "#111111"));
    CHECK(alike(small, large));
}

TEST(a_change_anybody_would_see_is_a_new_skin) {
    CHECK(!alike(starterSkinShapes(), starterWithMouth()));
    // Even the thinnest smile the studio's own curve draws -- the smallest
    // change kSkinLookAlikeCells was set to let through.
    std::vector<SkinShape> thin = starterWithMouth();
    thin.back().sw = 2;
    CHECK(!alike(starterSkinShapes(), thin));

    std::vector<SkinShape> red = starterSkinShapes();
    red[0].fill = "#d01c1d";
    CHECK(!alike(starterSkinShapes(), red));

    std::vector<SkinShape> oneEyed = starterSkinShapes();
    oneEyed.pop_back();
    CHECK(!alike(starterSkinShapes(), oneEyed));

    // Moved well off the flower's centre: it is drawn about the hitbox, so
    // this is a different thing to wear.
    std::vector<SkinShape> moved = starterSkinShapes();
    for (SkinShape& s : moved) s.x += 12.0;
    CHECK(!alike(starterSkinShapes(), moved));
}

TEST(the_sampler_rotates_shapes_the_way_the_painter_does) {
    // renderSkinShapes translates, then rotate()s by `rot` degrees: a canvas
    // rotation, (x, y) -> (x cos - y sin, x sin + y cos). A rect of 14 x 4
    // turned 30 degrees has to sample exactly as the polygon through those
    // four rotated corners -- and the other way round has to differ.
    SkinShape rect;
    rect.t = SkinShapeType::Rect;
    rect.x = 6;
    rect.y = -4;
    rect.rx = 14;
    rect.ry = 4;
    rect.rot = 30;
    rect.fill = "#3a86ff";

    auto turned = [&](double degrees) {
        const double c = std::cos(degrees * kPi / 180.0), s = std::sin(degrees * kPi / 180.0);
        SkinShape poly;
        poly.t = SkinShapeType::Polygon;
        poly.x = rect.x;
        poly.y = rect.y;
        const double corners[4][2] = {{-rect.rx, -rect.ry}, {rect.rx, -rect.ry},
                                      {rect.rx, rect.ry}, {-rect.rx, rect.ry}};
        for (const auto& corner : corners) {
            poly.points.push_back(corner[0] * c - corner[1] * s);
            poly.points.push_back(corner[0] * s + corner[1] * c);
        }
        poly.fill = "#3a86ff";
        return poly;
    };
    const SkinLook asRect = sampleSkinLook({rect});
    // Not one cell apart, nudge or no nudge: the two are the same region,
    // tested two different ways.
    CHECK_EQ(skinLookDifference(asRect, sampleSkinLook({turned(30)})), 0);
    CHECK(!skinsLookAlike(asRect, sampleSkinLook({turned(-30)})));
}

TEST(lines_and_curves_paint_their_outline_and_curves_their_fill) {
    SkinShape line;
    line.t = SkinShapeType::Line;
    line.x = -20;
    line.y = 0;
    line.x2 = 20;
    line.y2 = 0;
    line.stroke = "#000000";
    line.sw = 4;
    line.fill = "#ff0000";   // a line has no inside: the painter ignores this
    const SkinLook drawn = sampleSkinLook({line});
    // 40 long plus the round caps, 4 wide: two rows of about 22 cells.
    CHECK(paintedCells(drawn) >= 40 && paintedCells(drawn) <= 50);
    for (const std::uint32_t c : drawn.cells) CHECK(c == 0 || c == 0x01000000u);

    SkinShape blob;
    blob.t = SkinShapeType::Curve;
    blob.x = -15;
    blob.y = 0;
    blob.x2 = 15;
    blob.y2 = 0;
    blob.cx1 = -15;
    blob.cy1 = -30;
    blob.cx2 = 15;
    blob.cy2 = -30;
    blob.fill = "#00ff00";
    const SkinLook filled = sampleSkinLook({blob});
    // Closed by the chord along y = 0, so the inside is above it.
    CHECK(filled.at(50, 45) == 0x0100ff00u);
    CHECK(filled.at(50, 52) == 0u);
}

TEST(the_worst_skin_samples_fast_enough_to_publish) {
    // Every shape at its limits and every polygon point used: the payload a
    // publish costs most to check. It runs on the tick, so it has to stay a
    // small slice of one.
    std::vector<SkinShape> heavy;
    for (int i = 0; i < kMaxSkinShapes; ++i) {
        SkinShape s;
        s.t = SkinShapeType::Polygon;
        s.rot = i * 7.0;
        for (int p = 0; p < kMaxPolyPoints; ++p) {
            const double a = p * 2.0 * kPi / kMaxPolyPoints;
            const double r = p % 2 ? kSkinCoordLimit : 10.0;
            s.points.push_back(r * std::cos(a));
            s.points.push_back(r * std::sin(a));
        }
        s.fill = "#3a86ff";
        s.stroke = "#111111";
        s.sw = kMaxSkinStrokeWidth;
        heavy.push_back(s);
    }
    const auto start = std::chrono::steady_clock::now();
    const SkinLook look = sampleSkinLook(heavy);
    const double ms =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    std::printf("  worst-case skin sampled in %.2f ms\n", ms);
    CHECK(paintedCells(look) > 0);
    CHECK(ms < 50.0);
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::Harness;
using flix::testsupport::sawText;

bool registerAs(Harness& h, NetClient& client, const char* name) {
    if (!connectClient(h, client)) return false;
    client.requestRegister(name, "hunter2!");
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

/// Publishes and steps until the server has answered in the Skins channel.
bool publish(Harness& h, NetClient& client, const char* name, const std::vector<SkinShape>& shapes) {
    const std::size_t before = client.chat().size();
    client.publishSkin(name, shapes);
    return h.stepUntil({&client}, [&] { return client.chat().size() > before; });
}

CustomSkin storedSkin(const char* id, const char* name, const char* author, double createdAt,
                      std::vector<SkinShape> shapes) {
    CustomSkin skin;
    skin.id = id;
    skin.name = name;
    skin.author = author;
    skin.createdAt = createdAt;
    skin.shapes = std::move(shapes);
    return skin;
}

} // namespace

TEST(publishing_a_look_alike_is_refused_and_names_the_original) {
    Harness h("skin-dedupe-publish", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient first;
    NetClient second;
    CHECK(registerAs(h, first, "original"));
    CHECK(registerAs(h, second, "copier"));

    CHECK(publish(h, first, "smiley", starterWithMouth()));
    CHECK(sawText(first, "Published \"smiley\""));
    CHECK(h.stepUntil({&first, &second}, [&] { return second.skinCatalog().size() == 1; }));

    // Somebody else's skin, one shade off.
    std::vector<SkinShape> copy = starterWithMouth();
    copy[0].fill = "#fde865";
    CHECK(publish(h, second, "mine now", copy));
    CHECK(sawText(second, "looks just like \"smiley\" by original"));

    // Your own again, under a new name.
    CHECK(publish(h, first, "smiley again", starterWithMouth()));
    CHECK(sawText(first, "looks just like your \"smiley\""));

    // The starter flower itself is nobody's to publish.
    CHECK(publish(h, second, "flower", starterSkinShapes()));
    CHECK(sawText(second, "That's the starter flower"));

    // A real change still goes through.
    std::vector<SkinShape> red = starterWithMouth();
    red[0].fill = "#d01c1d";
    CHECK(publish(h, second, "angry", red));
    CHECK(sawText(second, "Published \"angry\""));

    h.step(10, {&first, &second});
    CHECK_EQ(first.skinCatalog().size(), static_cast<std::size_t>(2));
    CHECK_EQ(h.server.database().storedTable("customSkins").keys().size(), static_cast<std::size_t>(2));
}

TEST(a_catalog_full_of_copies_is_folded_into_its_originals_at_start) {
    std::string wearerId, starterWearerId, keeperId;
    Harness h("skin-dedupe-fold", [&](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        db.setPasswordCost(4);
        const std::string wearer = db.createUser("wearer", "hunter2!").account->id;
        const std::string starterWearer = db.createUser("plain", "hunter2!").account->id;
        const std::string keeper = db.createUser("keeper", "hunter2!").account->id;

        std::vector<SkinShape> nose = starterWithMouth();
        nose.push_back(circle(0, 3, 1.5, "#111111"));
        std::vector<SkinShape> biggerNose = starterWithMouth();
        biggerNose.push_back(circle(0, 3, 2.5, "#111111"));
        std::vector<SkinShape> red = starterWithMouth();
        red[0].fill = "#d01c1d";

        Json& catalog = db.rawTable("customSkins");
        // Filed newest first, so only the timestamps say which is the original.
        catalog["sk_c"] = skinToJson(storedSkin("sk_c", "copy two", "thief", 300, biggerNose));
        catalog["sk_b"] = skinToJson(storedSkin("sk_b", "copy one", "thief", 200, nose));
        catalog["sk_a"] = skinToJson(storedSkin("sk_a", "original", "artist", 100, nose));
        catalog["sk_red"] = skinToJson(storedSkin("sk_red", "angry", "artist", 150, red));
        catalog["sk_plain"] =
            skinToJson(storedSkin("sk_plain", "flower", "lazy", 50, starterSkinShapes()));
        // The browser build's payload: no shapes this build can read, never
        // sent, and not this pass's to touch.
        Json legacy = Json::object();
        legacy["id"] = "skin-7";
        legacy["data"] = "AAAA";
        catalog["skin-7"] = legacy;

        db.progress(wearer).equippedSkinId = "sk_c";
        db.progress(starterWearer).equippedSkinId = "sk_plain";
        db.progress(keeper).equippedSkinId = "sk_red";
        db.markDirty();
        db.save();
        wearerId = wearer;
        starterWearerId = starterWearer;
        keeperId = keeper;
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    const Database& db = h.server.database();
    const Json& catalog = db.storedTable("customSkins");
    CHECK(catalog.contains("sk_a"));
    CHECK(catalog.contains("sk_red"));
    CHECK(catalog.contains("skin-7"));
    CHECK(!catalog.contains("sk_b"));
    CHECK(!catalog.contains("sk_c"));
    CHECK(!catalog.contains("sk_plain"));

    // The wearer of a copy now wears the original; a starter look-alike's
    // wearer is the plain flower; a distinct skin's wearer is untouched.
    CHECK_EQ(db.findProgress(wearerId)->equippedSkinId, std::string("sk_a"));
    CHECK(db.findProgress(starterWearerId)->equippedSkinId.empty());
    CHECK_EQ(db.findProgress(keeperId)->equippedSkinId, std::string("sk_red"));

    // And what a client is sent is the folded catalog.
    NetClient client;
    CHECK(connectClient(h, client));
    client.requestLogin("wearer", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.skinCatalog().size() == 2; }));
}
