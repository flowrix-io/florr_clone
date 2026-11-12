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
#include <cstdlib>
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

bool similar(const std::vector<SkinShape>& a, const std::vector<SkinShape>& b) {
    return skinsLookSimilar(sampleSkinLook(a), sampleSkinLook(b));
}

/// The whole picture moved. A curve's end and control points are absolute.
std::vector<SkinShape> movedBy(std::vector<SkinShape> shapes, double dx, double dy) {
    for (SkinShape& s : shapes) {
        s.x += dx;
        s.y += dy;
        s.x2 += dx;
        s.y2 += dy;
        s.cx1 += dx;
        s.cy1 += dy;
        s.cx2 += dx;
        s.cy2 += dy;
    }
    return shapes;
}

/// The whole picture resized about the flower's centre.
std::vector<SkinShape> resizedBy(std::vector<SkinShape> shapes, double factor) {
    for (SkinShape& s : shapes) {
        for (double* v : {&s.x, &s.y, &s.r, &s.rx, &s.ry, &s.x2, &s.y2, &s.cx1, &s.cy1, &s.cx2,
                          &s.cy2, &s.sw}) {
            *v *= factor;
        }
    }
    return shapes;
}

/// A face with enough on it that a small addition is small next to it.
std::vector<SkinShape> blushingFace() {
    std::vector<SkinShape> shapes = starterWithMouth();
    shapes.push_back(circle(-14, 6, 4, "#ff66aa"));
    shapes.push_back(circle(14, 6, 4, "#ff66aa"));
    return shapes;
}

/// The starter's body with its eyes screwed shut in two chevrons: no eye left
/// where the starter has one, and about as little ink as a face can have.
std::vector<SkinShape> squintingFace() {
    std::vector<SkinShape> shapes = {starterSkinShapes()[0]};
    const auto stroke = [&](double x, double y, double x2, double y2) {
        SkinShape line;
        line.t = SkinShapeType::Line;
        line.x = x;
        line.y = y;
        line.x2 = x2;
        line.y2 = y2;
        line.stroke = "#111111";
        line.sw = 2;
        shapes.push_back(line);
    };
    stroke(-14, -9, -6, -5);
    stroke(-6, -5, -14, -1);
    stroke(14, -9, 6, -5);
    stroke(6, -5, 14, -1);
    return shapes;
}

SkinShape ellipse(double x, double y, double rx, double ry, const char* fill) {
    SkinShape s;
    s.t = SkinShapeType::Ellipse;
    s.x = x;
    s.y = y;
    s.rx = rx;
    s.ry = ry;
    s.fill = fill;
    return s;
}

SkinShape stroke(double x, double y, double x2, double y2, double width, const char* colour) {
    SkinShape s;
    s.t = SkinShapeType::Line;
    s.x = x;
    s.y = y;
    s.x2 = x2;
    s.y2 = y2;
    s.stroke = colour;
    s.sw = width;
    return s;
}

SkinShape polygon(double y, std::vector<double> points, const char* fill) {
    SkinShape s;
    s.t = SkinShapeType::Polygon;
    s.y = y;
    s.points = std::move(points);
    s.fill = fill;
    return s;
}

/// A catalog skin drawn the way players draw a detailed one: layered shades on a
/// base circle one size up, whose edge is all that is left of it.
std::vector<SkinShape> grinningFace() {
    std::vector<SkinShape> shapes = {
        circle(0, 0, 26, "#d9a000"),    circle(-1, -1, 24.5, "#f2b900"),
        circle(-2, -2, 21, "#ffcc0a"),  circle(-5, -6, 13, "#ffd83a"),
        circle(-8, -10, 6, "#ffe56e"),
    };
    for (const double x : {-5.5, 5.5}) shapes.push_back(ellipse(x, -10.5, 4.6, 7.2, "#e3a015"));
    for (const double x : {-5.5, 5.5}) shapes.push_back(ellipse(x, -10.5, 3.4, 5.8, "#9a4a1a"));
    for (const double x : {-5.5, 5.5}) shapes.push_back(ellipse(x, -10.5, 2, 4.3, "#1a1a1a"));
    shapes.push_back(polygon(0, {-21, -12, -17, -7, -12, -1, -6, 1.5, 0, 2.5, 6, 1.5, 12, -1, 17, -7,
                                 21, -12, 18, -4, 15, 5, 9, 11, 0, 15, -9, 11, -15, 5, -18, -4},
                             "#1a1a1a"));
    shapes.push_back(polygon(0, {-15, -4, -9, 0, 0, 2.5, 9, 0, 15, -4, 13, 3, 8, 9, 0, 12.5, -8, 9,
                                 -13, 3},
                             "#ffffff"));
    SkinShape lip;
    lip.t = SkinShapeType::Curve;
    lip.x = -14;
    lip.y = -1;
    lip.x2 = 14;
    lip.y2 = -1;
    lip.cx1 = -8;
    lip.cy1 = 8;
    lip.cx2 = 8;
    lip.cy2 = 8;
    lip.stroke = "#1a1a1a";
    lip.sw = 1.5;
    shapes.push_back(lip);
    shapes.push_back(stroke(0, 2.5, 0, 6, 1.2, "#1a1a1a"));
    for (const double x : {-5.0, 5.0}) shapes.push_back(stroke(x, 2, x, 5.3, 1.2, "#1a1a1a"));
    for (const double x : {-10.0, 10.0}) shapes.push_back(stroke(x, -1, x, 3, 1.2, "#1a1a1a"));
    for (const double x : {-2.5, 2.5}) shapes.push_back(stroke(x, 5.8, x, 12.3, 1.2, "#1a1a1a"));
    for (const double x : {-7.5, 7.5}) shapes.push_back(stroke(x, 4.5, x, 9.2, 1.2, "#1a1a1a"));
    for (const double x : {-12.0, 12.0}) shapes.push_back(stroke(x, 1.5, x, 4.5, 1.2, "#1a1a1a"));
    return shapes;
}

/// The reported copy of it, as it was pasted: the base circle shoved a hair and
/// painted black, and the last few lines drawn twice.
std::vector<SkinShape> grinningFaceCopy() {
    std::vector<SkinShape> shapes = grinningFace();
    shapes[0].x = -0.8;
    shapes[0].y = -0.6;
    shapes[0].fill = "#000000";
    for (const double x : {-7.5, 7.5}) shapes.push_back(stroke(x, 4.5, x, 9.2, 1.2, "#1a1a1a"));
    for (const double x : {-12.0, 12.0}) shapes.push_back(stroke(x, 1.5, x, 4.5, 1.2, "#1a1a1a"));
    return shapes;
}

/// Under everything, so only its edge shows.
std::vector<SkinShape> withRimUnder(std::vector<SkinShape> shapes, double r) {
    shapes.insert(shapes.begin(), circle(0, 0, r, "#000000"));
    return shapes;
}

/// Every colour on the skin `steps` off, on every channel.
std::vector<SkinShape> shadedBy(std::vector<SkinShape> shapes, int steps) {
    const auto shade = [&](std::string& colour) {
        if (colour.empty()) return;
        const int value = static_cast<int>(std::strtol(colour.c_str() + 1, nullptr, 16));
        int out = 0;
        for (const int shift : {16, 8, 0}) {
            const int channel = (value >> shift) & 0xFF;
            out |= (channel + steps <= 255 ? channel + steps : channel - steps) << shift;
        }
        char text[8];
        std::snprintf(text, sizeof text, "#%06x", out);
        colour = text;
    };
    for (SkinShape& s : shapes) {
        shade(s.fill);
        shade(s.stroke);
    }
    return shapes;
}

std::vector<SkinShape> withEars(std::vector<SkinShape> shapes) {
    shapes.push_back(circle(-18, -18, 7, "#aa5500"));
    shapes.push_back(circle(18, -18, 7, "#aa5500"));
    return shapes;
}

std::vector<SkinShape> withCrown(std::vector<SkinShape> shapes) {
    shapes.push_back(polygon(-25, {-12, 2, -14, -10, -6, -3, 0, -12, 6, -3, 14, -10, 12, 2}, "#ffd700"));
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

TEST(a_look_counts_the_detail_on_the_body_and_not_the_body) {
    // The starter's detail is its two eyes: the body is its commonest colour
    // and the outline is its rim.
    const SkinLook starter = sampleSkinLook(starterSkinShapes());
    CHECK(starter.detail > 20 && starter.detail < 50);
    CHECK(starter.painted > 400);
    CHECK_NEAR(starter.centreX, kSkinLookGrid * 0.5 - 0.5, 0.5);
    CHECK_NEAR(starter.centreY, kSkinLookGrid * 0.5 - 0.5, 0.5);
    // A plain disc has nothing on it.
    CHECK_EQ(sampleSkinLook({circle(0, 0, 25, "#123456")}).detail, 0);
    // And a skin that paints nothing is measured without dividing by nothing.
    CHECK_EQ(sampleSkinLook({circle(0, 0, 0.5, "#123456")}).painted, 0);

    // A body drawn in a few near shades is one body, not detail on itself.
    std::vector<SkinShape> shaded = starterSkinShapes();
    shaded.push_back(polygon(0, {-20, -14, 20, -14, 20, 14, -20, 14}, "#fff070"));
    shaded.push_back(polygon(0, {-20, 14, 20, 14, 18, 20, -18, 20}, "#f8e05c"));
    std::swap(shaded[1], shaded[3]);
    std::swap(shaded[2], shaded[4]);
    CHECK_EQ(sampleSkinLook(shaded).detail, starter.detail);
}

TEST(a_skin_s_own_detail_leaves_out_the_starter_s_eyes) {
    // Every face drawn on the starter has its eyes, so they are nobody's.
    const SkinLook starter = sampleSkinLook(starterSkinShapes());
    CHECK_EQ(starter.ownDetail, 0);
    const SkinLook smile = sampleSkinLook(starterWithMouth());
    CHECK_EQ(smile.ownDetail, smile.detail - starter.detail);
    // On any body colour, and nudged.
    std::vector<SkinShape> red = starterWithMouth();
    red[0].fill = "#d01c1d";
    CHECK_EQ(sampleSkinLook(red).ownDetail, smile.ownDetail);
    CHECK_NEAR(sampleSkinLook(movedBy(starterWithMouth(), 1.5, 0)).ownDetail, smile.ownDetail, 3);

    // Eyes somewhere else are the author's.
    const SkinLook moved = sampleSkinLook(movedBy(starterSkinShapes(), 12, 0));
    CHECK_EQ(moved.ownDetail, moved.detail);
    // And so is a busy picture that is only dark where the eyes go.
    std::vector<SkinShape> chequered = {starterSkinShapes()[0]};
    for (int row = 0; row < 8; ++row) {
        for (int col = (row % 2); col < 8; col += 2) {
            const double x = -20 + col * 5, y = -20 + row * 5;
            chequered.push_back(polygon(0, {x, y, x + 5, y, x + 5, y + 5, x, y + 5}, "#d01c1d"));
        }
    }
    chequered.push_back(starterSkinShapes()[1]);
    chequered.push_back(starterSkinShapes()[2]);
    const SkinLook busy = sampleSkinLook(chequered);
    CHECK_EQ(busy.ownDetail, busy.detail);
}

TEST(a_thick_outline_is_a_skin_s_rim_and_not_its_detail) {
    // An outline twice as deep as the band round the starter: a rim, and the
    // eyes are still all that is on it. (Much past this the outline covers more
    // of the starter than its yellow does, and becomes the body.)
    std::vector<SkinShape> thick = starterSkinShapes();
    thick[0].sw = 6;
    CHECK_EQ(sampleSkinLook(thick).detail, sampleSkinLook(starterSkinShapes()).detail);

    // A giant disc so outlined has nothing on it to forgive a face by: a face
    // drawn on it is a new skin, as on any plain disc.
    SkinShape giant = circle(0, 0, 64, "#ffe763");
    giant.stroke = "#cdb74f";
    giant.sw = kMaxSkinStrokeWidth;
    std::vector<SkinShape> face = {giant};
    for (SkinShape s : starterWithMouth()) {
        if (s.t != SkinShapeType::Circle) face.push_back(s);
    }
    CHECK(!similar({giant}, face));
    // Its outline drawn in another colour is still the same disc.
    SkinShape orange = giant;
    orange.stroke = "#e07020";
    CHECK(similar({giant}, {orange}));
}

TEST(a_copy_moved_or_resized_is_similar_but_not_alike) {
    for (const Vec2 by : {Vec2{12, 0}, Vec2{-20, 15}, Vec2{0, 30}}) {
        const std::vector<SkinShape> moved = movedBy(blushingFace(), by.x, by.y);
        CHECK(!alike(blushingFace(), moved));
        CHECK(similar(blushingFace(), moved));
    }
    for (const double factor : {0.85, 1.1, 1.2}) {
        CHECK(similar(blushingFace(), resizedBy(blushingFace(), factor)));
    }
    // The narrow test forgives a small resize, but not this one.
    CHECK(!alike(blushingFace(), resizedBy(blushingFace(), 1.2)));
    // Both at once.
    CHECK(similar(blushingFace(), movedBy(resizedBy(blushingFace(), 1.15), 18, -10)));
    // Half as wide again is a different size on the hitbox, so a different
    // thing to wear.
    CHECK(!similar(blushingFace(), resizedBy(blushingFace(), 1.5)));
}

TEST(a_little_added_to_a_detailed_skin_is_similar) {
    // "A little" next to what its author drew, the smile and the cheeks: the
    // eyes are the starter's. A nose of radius 5 adds half as much again.
    std::vector<SkinShape> withNose = blushingFace();
    withNose.push_back(circle(0, 3, 4, "#ff3333"));
    CHECK(!alike(blushingFace(), withNose));
    CHECK(similar(blushingFace(), withNose));
    // Order does not matter: which of the two is the original is the server's
    // question, not this test's.
    CHECK(similar(withNose, blushingFace()));
}

TEST(a_different_design_on_the_same_body_is_not_similar) {
    // Every eye replaced, with as little ink as the starter's own.
    CHECK(!similar(starterSkinShapes(), squintingFace()));
    // Most of what is drawn on it.
    CHECK(!similar(starterWithMouth(), squintingFace()));

    // A recolour differs everywhere.
    std::vector<SkinShape> red = blushingFace();
    red[0].fill = "#d01c1d";
    CHECK(!similar(blushingFace(), red));

    // Nothing to measure against, so the floor decides: a dot on a plain disc
    // past the allowance is a change.
    CHECK(!similar({circle(0, 0, 25, "#123456")},
                   {circle(0, 0, 25, "#123456"), circle(0, 0, 5, "#ffffff")}));
}

TEST(two_mouths_on_the_starter_are_two_skins) {
    // The live catalog's commonest false match: the eyes were most of the detail
    // on both, so the mouths, all that tells them apart, came in under half.
    // Drawn as the catalog's pair were, wide: a mouth 14 units across bends by
    // two cells, which the nudge cannot tell from straight.
    const auto withMouth = [](double y, double x2, double y2, Vec2 c1, Vec2 c2) {
        std::vector<SkinShape> shapes = starterSkinShapes();
        SkinShape mouth;
        mouth.t = SkinShapeType::Curve;
        mouth.x = -x2;
        mouth.y = y;
        mouth.x2 = x2;
        mouth.y2 = y2;
        mouth.cx1 = c1.x;
        mouth.cy1 = c1.y;
        mouth.cx2 = c2.x;
        mouth.cy2 = c2.y;
        mouth.stroke = "#111111";
        mouth.sw = 2;
        shapes.push_back(mouth);
        return shapes;
    };
    const std::vector<SkinShape> smile = withMouth(4, 12, 4, {-4, 11}, {1, 19});
    const std::vector<SkinShape> frown = withMouth(13, 10, 12, {-8, 2.4}, {9, 2.4});
    CHECK(!similar(smile, frown));
    CHECK(!similar(frown, smile));
    // A mouth is a skin, and the plain starter is not like it.
    CHECK(!similar(starterSkinShapes(), smile));
    // While the same smile, nudged, is the same skin.
    CHECK(similar(smile, movedBy(smile, 1.5, 1)));
}

namespace {

/// A skin a player reported refused (2026-11-11): a black globe badge on white,
/// lettered "DNS", every white a shade or two off the next.
std::vector<SkinShape> dnsBadge() {
    const char* const kPaths[][2] = {
        {"-25,-1.2,-24.8,-1.2,-24.7,-3.4,-24.4,-5.5,-23.8,-7.6,-23,-9.7,-22.1,-11.7,-20.9,-13.6,-18.2,-17.2,-16.6,-18.7,-14.9,-20.1,-13.2,-21.4,-11.3,-22.4,-8,-23.6,-2.3,-25,-25,-25", "#fcfcfc"},
        {"2.3,-25,-11.3,-22.4,-20.9,-13.6,-24.4,-5.5,-25,1.4,-21.4,13.4,-18.6,17,-11.1,22,-2.3,25,2.3,25,12.1,21.8,21.3,13,25,3,24.5,-4.4,21.3,-13,11.3,-22.4", "#050505"},
        {"25,-1,25,-25,2.3,-25,7.7,-23.8,11.3,-22.4,13.3,-21.2,15.2,-19.9,16.9,-18.4,18.5,-16.7,20,-14.9,21.3,-13,22.4,-11,23.4,-8.9,24.1,-6.7,24.5,-4.4,24.8,-1", "#fcfcfc"},
        {"-3,-22.6,-4.6,-22.6,-4.6,-22.3,-6.2,-22,-8.8,-21,-11.6,-19.7,-14.3,-18,-16.5,-16.2,-17.3,-15.2,-18.1,-13.7,-14,-13.4,-12.7,-13.4,-11.2,-13.7,-10.4,-14.4,-8.9,-15.9,-5.4,-19.8", "#fbfbfb"},
        {"3,-22.6,4.7,-20.7,9.2,-15.5,10.9,-13.8,11.6,-13.6,14.1,-13.5,17,-13.7,18.1,-13.9,17.3,-14.9,15.3,-17,12.8,-19,10,-20.6,8.6,-21.3,7.2,-21.9,5.7,-22.3,4.3,-22.5", "#fafafa"},
        {"-1.2,-21.2,-2,-20.5,-3.7,-19,-5.1,-17.7,-5.7,-17,-6.4,-16.3,-7,-15.6,-7.4,-15,-7.8,-14.3,-8.1,-13.7,-1,-13.7,-1,-14.5,-0.9,-16.8,-0.9,-18.2,-0.9,-19.5,-1.1,-20.7", "#f8f8f8"},
        {"1,-21.2,1,-13.4,1.8,-13.4,4.1,-13.3,5.4,-13.3,6.6,-13.4,7.2,-13.4,7.8,-13.5,8.3,-13.7,7.2,-15,6.1,-16.4,4.9,-17.7,3.7,-18.9,3,-19.5,2.4,-20.1,1.7,-20.7", "#efefef"},
        {"-19.9,11.4,19.7,11.4,20.7,9.3,21.5,7.2,22.1,5.3,22.5,3.4,22.7,-0.1,22.3,-3.7,21.2,-7.5,19.7,-11.7,-19.7,-11.7,-21.4,-7,-22.4,-3.3,-22.7,-0.1,-22.4,3,-21.4,6.7", "#fbfbfb"},
        {"8.6,2.3,8.1,5.7,12.5,6.6,15.2,5.8,17.6,2.6,16.4,-0.1,13.1,-2.1,12.3,-3.2,16.8,-2.8,17.2,-5.9,13.6,-6.5,9.3,-4.6,8.4,-2.5,9.6,0.1,13.3,2.5,11.9,3.5", "#040404"},
        {"-17.4,6.3,-12.9,6.4,-11.5,6.3,-9.3,5.7,-8.4,5.1,-7.6,4.3,-6.6,2.2,-6.1,-0.3,-6.4,-2.7,-6.8,-3.8,-7.4,-4.7,-8.2,-5.4,-9.2,-5.9,-11.5,-6.4,-12.9,-6.4,-17.4,-6.3", "#040404"},
        {"2.8,0.6,2.1,-0.9,-0.2,-5.2,-0.8,-6.3,-5,-6.3,-5,6.3,-1.4,6.1,-1.8,3.7,-1.7,1.2,-1.4,-0.6,1.1,4,2.1,6.3,6.3,6.3,6.3,-6.1,3,-6.1,3.1,-2.7", "#030303"},
        {"-13.7,-3.2,-13.7,2.1,-13.6,3.3,-13.1,3.8,-12.5,3.8,-11.8,3.3,-11.1,2.5,-10.4,1.5,-10,0.4,-9.8,-0.7,-10,-1.8,-10.2,-2.2,-10.6,-2.6,-11.1,-2.9,-11.8,-3.1,-12.7,-3.2", "#f9f9f9"},
        {"-2.3,25,-6.8,23.7,-9,22.9,-11.1,22,-13.1,21,-15.1,19.8,-16.9,18.5,-18.6,17,-20.1,15.3,-21.4,13.4,-22.5,11.3,-23.4,9,-23.9,7.4,-24.7,2.6,-25,1.4,-25,25", "#fdfdfd"},
        {"2.3,25,25,25,25,3,24.3,4.7,23.2,9.2,22.8,10.5,21.3,13,19.4,15.6,17.3,18,14.8,20.1,13.5,21,12.1,21.8,10.7,22.6,9.1,23.2,7.6,23.7,3.7,24.5", "#fdfdfd"},
        {"-3.2,22.6,-6.5,19.5,-8.1,18,-9.6,16.4,-10.7,14.8,-11.2,13.7,-18.1,13.7,-17.9,14.6,-17.2,15.5,-16.2,16.5,-14.9,17.5,-13.5,18.5,-11.8,19.4,-8.5,21.1,-5.4,22.2,-4.2,22.5", "#fbfbfb"},
        {"-8.6,13.7,-8.4,13.9,-8,14.5,-7.5,15.2,-6.9,15.9,-6.3,16.7,-5.5,17.5,-4.8,18.3,-4,19,-3.2,19.7,-2.5,20.3,-1.8,20.8,-1.5,21,-1.3,21.1,-1,21.2,-1,13.7", "#f9f9f9"},
        {"8.6,13.7,1.2,13.7,1.2,14.5,1.1,16.7,1.1,18,1.1,19.3,1.3,20.5,1.4,21,2.7,20,4,18.9,5.4,17.6,6,17,6.6,16.3,7.2,15.7,7.7,15,8.2,14.3", "#fdfdfd"},
        {"18.1,13.7,11.2,13.7,10.9,14.5,10.5,15.2,9.1,16.8,7.4,18.5,5.2,20.5,3.4,22.3,4.1,22.6,5.1,22.5,6.4,22.2,7.9,21.5,11.2,19.7,14.3,17.5,16.8,15.4,17.7,14.4", "#fbfbfb"},
    };
    std::vector<SkinShape> shapes;
    for (const auto& path : kPaths) {
        std::vector<double> points;
        for (const char* at = path[0]; *at != '\0';) {
            char* end = nullptr;
            points.push_back(std::strtod(at, &end));
            at = *end == ',' ? end + 1 : end;
        }
        shapes.push_back(polygon(0, std::move(points), path[1]));
    }
    return shapes;
}

/// The catalog skin it was refused as: a bullseye of rings one or two units
/// wide, which the grid samples into black-and-white noise.
std::vector<SkinShape> bullseye() {
    std::vector<SkinShape> shapes;
    const struct { double r; const char* fill; const char* stroke; } kRings[] = {
        {27, "#111111", ""}, {25, "#ffffff", ""}, {24, "#111111", ""}, {22, "#ffffff", ""},
        {21, "#111111", ""}, {20, "#ffffff", ""}, {18, "", "#111111"}, {15, "#3a86ff", "#111111"},
        {14, "#ffffff", ""}, {13, "#3a86ff", ""}, {12, "#3a86ff", "#111111"}, {11, "#3a86ff", "#ffffff"},
        {10, "#3a86ff", "#111111"}, {9, "#3a86ff", "#ffffff"}, {8, "#3a86ff", "#111111"},
        {8, "#ffffff", ""}, {7, "#111111", ""}, {6, "#ffffff", ""}, {5, "#111111", ""},
        {4, "#ffffff", ""}, {3, "#111111", ""}, {2, "#ffffff", ""}, {1.5, "#111111", ""},
        {0.5, "#ffffff", ""},
    };
    for (const auto& ring : kRings) {
        SkinShape s = circle(0, 0, ring.r, ring.fill);
        s.stroke = ring.stroke;
        s.sw = *ring.stroke != '\0' ? 2 : 0;
        shapes.push_back(s);
    }
    return shapes;
}

} // namespace

TEST(a_busy_badge_in_near_white_shades_is_not_another_busy_skin) {
    // Every near-white on the badge used to count as detail, the body being one
    // exact white, which doubled its allowance; and two busy black-and-white
    // pictures have black and white within a cell nearly everywhere.
    const SkinLook badge = sampleSkinLook(dnsBadge());
    CHECK(badge.detail < badge.painted / 4);
    CHECK(!similar(dnsBadge(), bullseye()));
    CHECK(!similar(bullseye(), dnsBadge()));
    // Still itself, moved a little.
    CHECK(similar(dnsBadge(), movedBy(dnsBadge(), 1.5, -1)));
}

TEST(a_skin_copied_with_a_new_rim_is_similar) {
    CHECK(similar(grinningFace(), grinningFaceCopy()));
    // The rim costs the same however little is on the skin, so the skins it
    // really let through are the plain ones. The detailed one above has allowance
    // to spare; these have less than a rim's worth.
    const std::vector<SkinShape> plain = blushingFace();
    CHECK(sampleSkinLook(plain).detail < 80);
    std::vector<SkinShape> outlined = plain;
    outlined[0].stroke = "#000000";
    CHECK(similar(plain, outlined));
    outlined[0].stroke = "#ff00ff";
    CHECK(similar(plain, outlined));
    CHECK(similar(plain, withRimUnder(plain, 27)));
    CHECK(similar(plain, withRimUnder(plain, 28)));
    // Order does not matter.
    CHECK(similar(withRimUnder(plain, 28), plain));
    // And a rim on the starter is still the starter.
    const SkinLook starter = sampleSkinLook(starterSkinShapes());
    std::vector<SkinShape> blackRim = starterSkinShapes();
    blackRim[0].stroke = "#000000";
    CHECK(skinsLookAlikeLinedUp(starter, sampleSkinLook(blackRim)));
    CHECK(skinsLookAlikeLinedUp(starter, sampleSkinLook(withRimUnder(starterSkinShapes(), 28))));
}

TEST(a_skin_copied_a_few_shades_off_is_similar_and_a_recolour_is_not) {
    for (const int steps : {25, 40, 48}) {
        CHECK(similar(blushingFace(), shadedBy(blushingFace(), steps)));
        CHECK(similar(grinningFace(), shadedBy(grinningFace(), steps)));
    }
    // Outright different colours stay different skins.
    CHECK(!similar(blushingFace(), shadedBy(blushingFace(), 80)));
    std::vector<SkinShape> orange = blushingFace();
    orange[0].fill = "#ff9900";
    CHECK(!similar(blushingFace(), orange));
    // The narrow test is not the wide one: a shade this far is not a copy to fold.
    CHECK(!alike(blushingFace(), shadedBy(blushingFace(), 25)));
}

TEST(a_new_outline_shape_is_a_new_skin) {
    // Ears and crowns are nothing but rim, and they are what somebody means by a
    // new skin even with the same face under them.
    const SkinLook starter = sampleSkinLook(starterSkinShapes());
    CHECK(!skinsLookAlikeLinedUp(starter, sampleSkinLook(withEars(starterSkinShapes()))));
    CHECK(!skinsLookAlikeLinedUp(starter, sampleSkinLook(withCrown(starterSkinShapes()))));
    CHECK(!similar(starterSkinShapes(), withEars(starterSkinShapes())));
    CHECK(!similar(starterSkinShapes(), withCrown(starterSkinShapes())));
    CHECK(!similar(withEars(starterSkinShapes()), withCrown(starterSkinShapes())));
}

TEST(line_art_skins_have_no_rim_to_forgive) {
    // Floating lines are all edge, with no body for a rim to go round. Drawn again
    // in another colour they are a recolour like any other, not a new outline.
    const auto face = [](const char* colour) {
        return std::vector<SkinShape>{stroke(-16, -14, -8, -14, 2, colour),
                                      stroke(8, -14, 16, -14, 2, colour),
                                      stroke(-14, 6, 0, 12, 2, colour),
                                      stroke(0, 12, 14, 6, 2, colour)};
    };
    CHECK(!sampleSkinLook(face("#111111")).hasBody);
    CHECK(sampleSkinLook(starterSkinShapes()).hasBody);
    CHECK(!similar(face("#111111"), face("#d01c1d")));
    // A shade off is still the same lines.
    CHECK(similar(face("#111111"), face("#303030")));
}

TEST(the_starter_is_refused_lined_up_but_on_the_narrow_allowance) {
    const SkinLook starter = sampleSkinLook(starterSkinShapes());
    CHECK(skinsLookAlikeLinedUp(starter, sampleSkinLook(movedBy(starterSkinShapes(), 20, 12))));
    CHECK(skinsLookAlikeLinedUp(starter, sampleSkinLook(resizedBy(starterSkinShapes(), 1.15))));
    // A smile is what everybody draws first, and it is a skin.
    CHECK(!skinsLookAlikeLinedUp(starter, sampleSkinLook(starterWithMouth())));
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

TEST(a_skin_similar_to_one_in_the_catalog_is_refused) {
    Harness h("skin-dedupe-similar", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient author;
    NetClient other;
    CHECK(registerAs(h, author, "author"));
    CHECK(registerAs(h, other, "other"));

    CHECK(publish(h, author, "blush", blushingFace()));
    CHECK(sawText(author, "Published \"blush\""));

    // Yours, tweaked and clicked again.
    CHECK(publish(h, author, "blush 2", movedBy(blushingFace(), 10, 0)));
    CHECK(sawText(author, "looks just like your \"blush\""));
    h.step(200, {&author, &other});
    CHECK(publish(h, author, "blush 3", resizedBy(blushingFace(), 1.1)));
    h.step(200, {&author, &other});
    std::vector<SkinShape> withNose = blushingFace();
    withNose.push_back(circle(0, 3, 4, "#ff3333"));
    CHECK(publish(h, author, "blush 4", withNose));
    // Somebody else's, the same.
    CHECK(publish(h, other, "my blush", withNose));
    CHECK(sawText(other, "looks just like \"blush\" by author"));
    h.step(200, {&author, &other});

    // The starter, moved, is still the starter, and a smile on it is a skin.
    CHECK(publish(h, other, "flower", movedBy(starterSkinShapes(), 15, 15)));
    CHECK(sawText(other, "That's the starter flower"));
    h.step(200, {&author, &other});
    CHECK(publish(h, other, "squint", squintingFace()));
    CHECK(sawText(other, "Published \"squint\""));

    h.step(10, {&author, &other});
    CHECK_EQ(h.server.database().storedTable("customSkins").keys().size(), static_cast<std::size_t>(2));
}

TEST(a_copy_with_a_new_rim_is_refused_when_published_or_saved_over_another_skin) {
    Harness h("skin-dedupe-rim", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient author;
    NetClient copier;
    CHECK(registerAs(h, author, "author"));
    CHECK(registerAs(h, copier, "copier"));

    CHECK(publish(h, author, "grin", grinningFace()));
    CHECK(sawText(author, "Published \"grin\""));
    h.step(200, {&author, &copier});
    CHECK(publish(h, author, "blush", blushingFace()));
    CHECK(sawText(author, "Published \"blush\""));
    h.step(200, {&author, &copier});

    CHECK(publish(h, copier, "my grin", grinningFaceCopy()));
    CHECK(sawText(copier, "looks just like \"grin\" by author"));
    h.step(200, {&author, &copier});
    CHECK(publish(h, copier, "my blush", withRimUnder(blushingFace(), 28)));
    CHECK(sawText(copier, "looks just like \"blush\" by author"));
    h.step(200, {&author, &copier});
    CHECK(publish(h, copier, "flower", withRimUnder(starterSkinShapes(), 28)));
    CHECK(sawText(copier, "That's the starter flower"));
    h.step(200, {&author, &copier});
    CHECK_EQ(h.server.database().storedTable("customSkins").keys().size(), static_cast<std::size_t>(2));

    // A different design on the way in, and an edit can't turn it into the copy.
    CHECK(publish(h, copier, "squint", squintingFace()));
    CHECK(sawText(copier, "Published \"squint\""));
    CHECK(h.stepUntil({&author, &copier}, [&] { return copier.skinCatalog().size() == 3; }));
    std::string squintId;
    for (const CustomSkin& skin : copier.skinCatalog()) {
        if (skin.name == "squint") squintId = skin.id;
    }
    CHECK(!squintId.empty());
    h.step(200, {&author, &copier});
    const std::size_t before = copier.chat().size();
    copier.editSkin(squintId, "squint", grinningFaceCopy());
    CHECK(h.stepUntil({&copier}, [&] { return copier.chat().size() > before; }));
    CHECK(sawText(copier, "Change it a bit more before saving"));
}

TEST(a_similar_skin_already_in_the_catalog_survives_a_restart) {
    // The fold erases rows, so it must stay on the narrow test: skins published
    // before the wider one are not the start-up pass's to delete.
    Harness h("skin-dedupe-keeps-similar", [&](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        Json& catalog = db.rawTable("customSkins");
        catalog["sk_a"] = skinToJson(storedSkin("sk_a", "original", "artist", 100, blushingFace()));
        catalog["sk_b"] = skinToJson(
            storedSkin("sk_b", "moved", "other", 200, movedBy(blushingFace(), 12, 0)));
        catalog["sk_c"] = skinToJson(
            storedSkin("sk_c", "new rim", "other", 300, withRimUnder(blushingFace(), 28)));
        catalog["sk_d"] = skinToJson(
            storedSkin("sk_d", "shaded", "other", 400, shadedBy(blushingFace(), 30)));
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    const Json& catalog = h.server.database().storedTable("customSkins");
    CHECK(catalog.contains("sk_a"));
    CHECK(catalog.contains("sk_b"));
    CHECK(catalog.contains("sk_c"));
    CHECK(catalog.contains("sk_d"));
}

TEST(clicking_publish_over_and_over_posts_one_skin) {
    Harness h("skin-dedupe-clicks", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient author;
    CHECK(registerAs(h, author, "clicker"));

    // Faster than any answer can come back: every click is on the wire before
    // the first is handled, so nothing on the client can have stopped them.
    for (int i = 0; i < 6; ++i) author.publishSkin("smiley", starterWithMouth());
    h.step(40, {&author});
    CHECK_EQ(author.skinCatalog().size(), static_cast<std::size_t>(1));

    // And again once the request budget has refilled and the answer is in.
    h.step(400, {&author});
    CHECK(publish(h, author, "smiley", starterWithMouth()));
    CHECK(sawText(author, "looks just like your \"smiley\""));
    h.step(10, {&author});
    CHECK_EQ(author.skinCatalog().size(), static_cast<std::size_t>(1));
    CHECK_EQ(h.server.database().storedTable("customSkins").keys().size(), static_cast<std::size_t>(1));
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
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    CHECK(flix::testsupport::browseAll(h, client));
    CHECK_EQ(client.skinBrowse().skins.size(), static_cast<std::size_t>(2));
}

TEST(signing_in_leaves_the_skin_catalog_s_save_text_cached) {
    // Every sign-in reads the catalog, and every Browse page. Read through
    // rawTable it lost the table's cached text, so the next save dumped every
    // skin again: on the live database, a 370 ms tick on every save that
    // followed a sign-in.
    Harness h("skin-catalog-cache", [&](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        db.rawTable("customSkins")["sk_a"] =
            skinToJson(storedSkin("sk_a", "original", "artist", 100, starterWithMouth()));
        db.markDirty();
        db.save();
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    // The first tick saves, which caches whatever the start-up pass touched.
    h.step(2, {});
    const Database& db = h.server.database();
    CHECK(db.tableTextCached("customSkins"));

    NetClient client;
    CHECK(registerAs(h, client, "viewer"));
    CHECK(db.tableTextCached("customSkins"));
    CHECK(flix::testsupport::browseAll(h, client));
    CHECK_EQ(client.skinBrowse().skins.size(), static_cast<std::size_t>(1));
    CHECK(db.tableTextCached("customSkins"));
}
