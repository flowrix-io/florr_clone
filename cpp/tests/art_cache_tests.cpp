#include "test.h"

#include "client/render/art_cache.h"
#include "client/render/mob_art.h"
#include "client/render/sprites.h"
#include "shared/game/config.h"
#include "fixture_content.h"
#include "test_data.h"

#include <functional>
#include <string>
#include <vector>

// The web tile cache rests on one property of the artwork: that a document
// without a SMIL timeline draws the same picture at every `timeSeconds`, so
// one rasterisation of it can stand in for every frame. `animated()` is what
// answers that, and getting it wrong would freeze a moving picture rather than
// merely cost frame time -- so it is pinned here, on the native build, where
// the cache itself is a deliberate no-op.

using namespace flix;

namespace {

const char* kStatic = R"SVG(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#3a7"/>
  <circle cx="50" cy="50" r="20" fill="#286"/>
</svg>)SVG";

const char* kAnimated = R"SVG(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="20" fill="#286">
    <animate attributeName="r" values="10;30;10" dur="2s" repeatCount="indefinite"/>
  </circle>
</svg>)SVG";

/// The timeline is on a nested node, which is where a check that only looked at
/// the root would miss it.
const char* kAnimatedChild = R"SVG(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(10 10)">
    <g>
      <rect width="40" height="40" fill="#286">
        <animateTransform attributeName="transform" type="rotate"
                          values="0 20 20;360 20 20" dur="3s" repeatCount="indefinite"/>
      </rect>
    </g>
  </g>
</svg>)SVG";

} // namespace

TEST(svg_document_reports_whether_it_animates) {
    CHECK(!SvgDocument::fromString(kStatic).animated());
    CHECK(SvgDocument::fromString(kAnimated).animated());
    CHECK(SvgDocument::fromString(kAnimatedChild).animated());
}

TEST(art_cache_is_a_no_op_off_the_web) {
#ifndef __EMSCRIPTEN__
    // Caching these tiles was measured four times SLOWER against the software
    // rasterizer, so the native build must keep drawing the artwork. The
    // contract is that drawCachedArt draws nothing and says so, leaving the
    // caller's renderFitted fallback as the only thing that paints.
    const SvgDocument art = SvgDocument::fromString(kStatic);
    Canvas canvas = Canvas::createVirtual(64, 64);
    CHECK(!drawCachedArt(canvas, art, 0.0, 0.0, 64.0, 64.0));

    std::size_t entries = 1, bytes = 1;
    artCacheStats(entries, bytes);
    CHECK(entries == 0);
    CHECK(bytes == 0);
#endif
}

using flix::testsupport::shippedContent;

namespace {

/// A square petal and the mob drawn as it, written here: the yellow it is
/// painted, the green it is repainted from super up and the outline round it
/// are the test's, where the shipped square's are the author's to recolour.
/// At 64 px its 32-unit document is doubled: the stroke runs down x = 4,
/// 6 px wide, and the middle of the box is all fill.
constexpr std::uint32_t kSquareFill = 0xFFE869u;
constexpr std::uint32_t kSquareStroke = 0xCFBC55u;
constexpr std::uint32_t kSuperSquareFill = 0x8AFF69u;
const ContentRegistry& squareContent() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        if (!test::loadFixtureContent(r, testsupport::tempDir("flix_art_cache_square"), R"({
            "square": {"name":"Square","health":20,"damage":10,"size":1.3333,
                       "visual_scale":0.8081,"speed":0,"image":"$petal:square"}
        })",
                                      R"({
            "square": {"name":"Square","damage":10,"health":10,"size":1,"cooldown":1000,"count":1,
                       "rarityFills":{"super":"#8AFF69"},
                       "image":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" fill=\"none\"><rect width=\"28\" height=\"28\" x=\"2\" y=\"2\" fill=\"#ffe869\"/><path d=\"M 2 2 L 2 30 M 2 30 L 30 30 M 30 30 L 30 2 M 30 2 L 2 2 M 2 2 Z\" stroke=\"#cfbc55\" stroke-linecap=\"round\" stroke-width=\"3\"/></svg>"}
        })",
                                      error)) {
            std::printf("    (the square fixture did not load: %s)\n", error.c_str());
        }
        return r;
    }();
    return registry;
}

} // namespace

TEST(icosahedron_art_animates_in_the_actual_petal_renderer) {
    // An animated document of the icosahedron's kind -- a body turning on an
    // animateTransform -- written here: whether the shipped art moves is the
    // author's to change.
    ContentRegistry content;
    std::string error;
    CHECK(test::loadFixtureContent(content, testsupport::tempDir("flix_art_cache_animated"), R"({
        "plain": {"name":"Plain","health":1,"damage":1,"size":1}
    })",
                                   R"({
        "icosahedron": {"name":"Icosahedron","damage":19,"health":20,"size":2,"cooldown":2500,
                        "count":1,
                        "image":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"32\" height=\"32\"><g><animateTransform attributeName=\"transform\" type=\"rotate\" values=\"0 16 16;360 16 16\" dur=\"6s\" repeatCount=\"indefinite\"/><path d=\"M16 2 3 9 16 8Z\" fill=\"#c4b5fd\"/><path d=\"M3 9 8 22 16 8Z\" fill=\"#7c3aed\"/></g></svg>"}
    })",
                                   error));
    const auto id = content.petalIndex("icosahedron");
    CHECK(id != kInvalidIndex);
    if (id == kInvalidIndex) return;
    const auto art = SvgDocument::fromString(content.petal(id).image);
    CHECK(!art.empty());
    CHECK(art.animated());
    SpriteCache sprites;
    sprites.build(content, testsupport::dataDir());
    const auto frame = [&](double time) {
        Canvas canvas = Canvas::createVirtual(64, 64);
        sprites.drawPetal(canvas, id, Rarity::Common, 32, 32, 64, 0, time);
        return canvas.getImageData(0, 0, 64, 64);
    };
    CHECK(frame(0.0) != frame(0.75));
}

TEST(every_procedural_marker_in_the_shipped_mobs_compiles) {
    // The failure this pins is SILENT. An `image` naming a painter this build
    // does not have -- a typo, or a painter added to mobs.json and not to
    // mobArtFor -- is not a parse error and not a warning anybody reads: the
    // marker falls through to the document path, fails to parse as SVG, and
    // the mob draws as a flat rarity disc in the world, in the bestiary and on
    // its own tooltip.
    //
    // Asked of the '$' entries only. The garbage pile ships a literally empty
    // <svg/> and is MEANT to draw nothing from it (the renderer paints the
    // pile itself), so "declares an image" is not the same question as
    // "should draw something".
    const ContentRegistry& content = shippedContent();
    CHECK(content.loaded());
    SpriteCache sprites;
    sprites.build(content, testsupport::dataDir());

    int markers = 0;
    for (std::uint16_t i = 0; i < content.mobCount(); ++i) {
        const MobConfig& config = content.mob(i);
        if (config.image.empty() || config.image[0] != '$') continue;
        ++markers;
        if (!sprites.mobDrawable(i)) {
            std::printf("    mob '%s': image \"%s\" names nothing this build can draw\n",
                        config.id.c_str(), config.image.c_str());
        }
        CHECK(sprites.mobDrawable(i));
    }
    // The count is not the point, but a lookup that quietly found no markers
    // at all would pass this test for the wrong reason.
    CHECK(markers >= 7);
}

TEST(the_procedural_markers_name_painters_this_build_has) {
    // `$sponge:` is the odd one out: a palette marker expanded into a document
    // rather than a painter name, which is why this asks mobArtFor about the
    // painters by name instead of about every '$' string in the file.
    CHECK(mobArtFor("$rock") == MobArt::Rock);
    CHECK(mobArtFor("$cactus") == MobArt::Cactus);
    CHECK(mobArtFor("$sandstorm") == MobArt::Sandstorm);
    CHECK(mobArtFor("$scorpion") == MobArt::Scorpion);
    CHECK(mobArtFor("$crab") == MobArt::Crab);
    CHECK(mobArtFor("$leech") == MobArt::LeechHead);
    CHECK(mobArtFor("$leech_body") == MobArt::LeechBody);
    CHECK(mobArtFor("$spider") == MobArt::Spider);
    CHECK(mobArtFor("$nothing_by_that_name") == MobArt::None);
    CHECK(mobArtFor("<svg/>") == MobArt::None);
    CHECK(mobArtFor("") == MobArt::None);
}

TEST(a_super_square_is_repainted_green_with_a_derived_outline) {
    // A square repainted from super up (`rarityFills`): one fill colour named,
    // the outline worked out from it by the rule every gardn body's outline
    // follows. Below super it is the yellow it is drawn in.
    const ContentRegistry& content = squareContent();
    CHECK(content.loaded());
    const std::uint16_t square = content.petalIndex("square");
    CHECK(square != kInvalidIndex);
    SpriteCache sprites;
    sprites.build(content, testsupport::dataDir());

    const auto pixelsAt = [&](Rarity rarity) {
        Canvas canvas = Canvas::createVirtual(64, 64);
        sprites.drawPetal(canvas, square, rarity, 32, 32, 64, 0, 0);
        const std::vector<std::uint8_t> image = canvas.getImageData(0, 0, 64, 64);
        const auto rgb = [&](int x, int y) {
            const std::size_t at = (static_cast<std::size_t>(y) * 64 + x) * 4;
            return (std::uint32_t{image[at]} << 16) | (std::uint32_t{image[at + 1]} << 8) |
                   image[at + 2];
        };
        return std::pair<std::uint32_t, std::uint32_t>{rgb(32, 32), rgb(4, 32)};
    };

    const auto ultra = pixelsAt(Rarity::Ultra);
    CHECK(ultra.first == kSquareFill);
    CHECK(ultra.second == kSquareStroke);
    for (const Rarity tier : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
        const auto repainted = pixelsAt(tier);
        CHECK(repainted.first == kSuperSquareFill);
        CHECK(repainted.second == outlineOf(kSuperSquareFill));
    }
    CHECK(outlineOf(0x8AFF69u) == 0x6ECC54u);
}

TEST(the_square_mob_is_drawn_as_the_square_petal_is_at_every_tier) {
    // A mob drawn as the square petal (`$petal:square`) is the petal's own
    // sprite at the mob's tier, so the same box drawn either way is the same
    // pixels -- yellow below super, green from there up, in the world and on a
    // bestiary tile alike.
    const ContentRegistry& content = squareContent();
    const std::uint16_t mob = content.mobIndex("square");
    const std::uint16_t petal = content.petalIndex("square");
    CHECK(mob != kInvalidIndex);
    CHECK(petal != kInvalidIndex);
    if (mob == kInvalidIndex || petal == kInvalidIndex) return;
    SpriteCache sprites;
    sprites.build(content, testsupport::dataDir());

    const auto pixels = [](const std::function<void(Canvas&)>& paint) {
        Canvas canvas = Canvas::createVirtual(64, 64);
        paint(canvas);
        return canvas.getImageData(0, 0, 64, 64);
    };
    for (const Rarity tier : {Rarity::Common, Rarity::Ultra, Rarity::Super, Rarity::Apex}) {
        const std::vector<std::uint8_t> asPetal =
            pixels([&](Canvas& c) { sprites.drawPetal(c, petal, tier, 32, 32, 64, 0, 0); });
        const std::vector<std::uint8_t> asMob =
            pixels([&](Canvas& c) { sprites.drawMob(c, mob, tier, 32, 32, 64, 0, 0); });
        CHECK(asMob == asPetal);
        const std::size_t middle = (32u * 64u + 32u) * 4u;
        const std::uint32_t fill = (std::uint32_t{asMob[middle]} << 16) |
                                   (std::uint32_t{asMob[middle + 1]} << 8) | asMob[middle + 2];
        CHECK(fill == (rarityIndex(tier) >= rarityIndex(Rarity::Super) ? kSuperSquareFill
                                                                       : kSquareFill));
    }

    // The bestiary's picture wears the tier of its cell.
    const auto tile = [&](Rarity tier) {
        const std::vector<std::uint8_t> image = pixels(
            [&](Canvas& c) { sprites.drawMobPicture(c, mob, tier, 32, 32, 64, 48, 0); });
        const std::size_t middle = (32u * 64u + 32u) * 4u;
        return (std::uint32_t{image[middle]} << 16) | (std::uint32_t{image[middle + 1]} << 8) |
               image[middle + 2];
    };
    CHECK(tile(Rarity::Mythic) == kSquareFill);
    CHECK(tile(Rarity::Unique) == kSuperSquareFill);
}

TEST(a_mob_drawn_as_a_petal_that_does_not_exist_is_a_plain_disc) {
    ContentRegistry content;
    std::string error;
    CHECK(test::loadFixtureContent(content, testsupport::tempDir("flix_art_cache_petal_art"), R"({
        "lost": {"name":"Lost","health":1,"damage":1,"size":1,"image":"$petal:nope"},
        "found": {"name":"Found","health":1,"damage":1,"size":1,"image":"$petal:basic"}
    })",
                                   R"({
        "basic": {"name":"Basic","damage":5,"health":5,"size":1,"cooldown":1000,"count":1,
                  "image":"<svg viewBox=\"0 0 2 2\"><rect width=\"2\" height=\"2\" fill=\"#fff\"/></svg>"}
    })",
                                   error));
    SpriteCache sprites;
    sprites.build(content, testsupport::dataDir());
    CHECK(!sprites.mobDrawable(content.mobIndex("lost")));
    CHECK(sprites.mobDrawable(content.mobIndex("found")));
    bool warned = false;
    for (const std::string& w : sprites.warnings()) {
        warned = warned || w.find("mob lost: draws petal 'nope'") != std::string::npos;
    }
    CHECK(warned);
}
