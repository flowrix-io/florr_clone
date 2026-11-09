// "There is a black grid over the map" is a claim about pixels, so this renders
// the shipped overworld through the real WorldRenderer and reads them back.
//
// A seam between two map tiles is the black the frame is cleared to showing
// through where neither tile reached. It runs the whole length of the frame, so
// it is caught as a row or column that is almost entirely black -- which no
// tile artwork ever paints.

#include "test.h"

#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"
#include "test_data.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

using namespace flix;

namespace {

/// A 1280x720 window on a 1x display: two thirds of a device pixel per design
/// unit, the scale the seams opened widest at.
constexpr int kPixelWidth = 1280;
constexpr int kPixelHeight = 720;
constexpr int kDesignWidth = 1920;
constexpr int kDesignHeight = 1080;

/// The longest run of rows (or columns) of the frame that are at least 90%
/// near-black, counted along `columns`.
int blackLines(const std::vector<std::uint8_t>& pixels, bool columns) {
    const int lines = columns ? kPixelWidth : kPixelHeight;
    const int length = columns ? kPixelHeight : kPixelWidth;
    int found = 0;
    for (int line = 0; line < lines; ++line) {
        int dark = 0;
        for (int along = 0; along < length; ++along) {
            const int x = columns ? line : along;
            const int y = columns ? along : line;
            const std::size_t i = (static_cast<std::size_t>(y) * kPixelWidth + x) * 4;
            if (pixels[i] < 16 && pixels[i + 1] < 16 && pixels[i + 2] < 16) ++dark;
        }
        if (dark * 10 >= length * 9) ++found;
    }
    return found;
}

/// The shipped overworld behind a WorldRenderer, drawn a frame at a time onto
/// a 1280x720 canvas the way the app draws it.
struct TerrainScene {
    WorldMaps maps;
    SpriteCache sprites;
    WorldRenderer renderer;
    WorldView view;

    bool load() {
        std::string error;
        if (!loadContent(testsupport::dataDir(), error)) return false;
        if (!maps.load(testsupport::dataDir(), nullptr, error)) return false;
        sprites.build(content(), testsupport::dataDir());
        renderer.setSprites(&sprites);
        renderer.setWorldMaps(&maps);
        view.setRealm(Realm::Overworld);
        return true;
    }

    std::vector<std::uint8_t> frame(Vec2 centre, double zoom) {
        Canvas canvas = Canvas::createVirtual(kPixelWidth, kPixelHeight);
        canvas.setLogicalSize(kDesignWidth, kDesignHeight);
        canvas.resetTransform();
        const float scale = static_cast<float>(kPixelWidth) / kDesignWidth;
        canvas.scale(scale, scale);
        Camera camera;
        camera.setViewport(kDesignWidth, kDesignHeight);
        camera.userZoom = zoom;
        camera.snapTo(centre);
        renderer.draw(canvas, view, camera, centre, 0.0);
        return canvas.getImageData(0, 0, kPixelWidth, kPixelHeight);
    }
};

using testsupport::differingPixels;

/// Enough frames for the chunk cache to have baked everything on screen: it
/// bakes a handful of chunks a frame and paints the rest straight meanwhile.
constexpr int kFramesToBakeAll = 40;

} // namespace

TEST(terrain_chunks_look_the_same_before_and_after_their_bitmap_arrives) {
    // The first frame at a new view bakes a few chunks and paints the rest
    // straight, clipped to them; later frames blit every one. Both halves go
    // through the same painter on the same pixel grid, so the first frame and
    // the fortieth must be the same picture -- anything else is a pop as each
    // bitmap lands, or a seam where a baked chunk meets a straight one. The
    // view is a run of garden walls, whose edge tiles are nearly all turned
    // or mirrored, at the default zoom and at the antennae's.
    TerrainScene scene;
    CHECK(scene.load());
    scene.renderer.setTerrainCache(true);
    const Vec2 walls{22272.3, 13440.7};
    for (const double zoom : {1.0, 0.1}) {
        const std::vector<std::uint8_t> first = scene.frame(walls, zoom);
        std::size_t chunksAfterFirst = 0, bytes = 0;
        scene.renderer.terrainCacheStats(chunksAfterFirst, bytes);
        std::vector<std::uint8_t> last;
        for (int i = 0; i < kFramesToBakeAll; ++i) last = scene.frame(walls, zoom);
        std::size_t chunks = 0;
        scene.renderer.terrainCacheStats(chunks, bytes);
        // The first frame really did leave chunks to the straight paint, or
        // this compares two frames of bitmaps and proves nothing.
        CHECK(chunksAfterFirst > 0);
        CHECK(chunks > chunksAfterFirst);
        CHECK(bytes > 0);
        // One level of slack: an anti-aliased edge composited into a clear
        // bitmap and then onto the frame rounds differently in the last bit
        // from the same edge composited straight onto it. A tile in the wrong
        // place, or a chunk edge missing its neighbour's overlap, is off by
        // whole colours.
        CHECK(differingPixels(first, last, 1) == 0);
    }
}

TEST(terrain_chunks_leave_no_seam_when_antennae_zoom_the_camera_far_out) {
    // The chunk cache's own version of the seam check below: chunks meet on
    // whole device pixels, and their edges hold the neighbouring cells'
    // overlap, so the grid of chunks must be as seamless as the grid of tiles.
    TerrainScene scene;
    CHECK(scene.load());
    scene.renderer.setTerrainCache(true);
    const Vec2 centre{16384.3, 16384.7};
    for (const double zoom : {0.100, 0.106, 0.112, 0.130, 1.0, 1.37}) {
        std::vector<std::uint8_t> pixels = scene.frame(centre, zoom);
        CHECK(blackLines(pixels, true) == 0);
        CHECK(blackLines(pixels, false) == 0);
        for (int i = 0; i < kFramesToBakeAll; ++i) pixels = scene.frame(centre, zoom);
        CHECK(blackLines(pixels, true) == 0);
        CHECK(blackLines(pixels, false) == 0);
    }
}

TEST(terrain_chunks_follow_the_camera_without_changing_the_picture) {
    // Moving the camera moves where the chunks are blitted and nothing else:
    // a view reached by walking onto it, with the cache full of chunks baked
    // on the way, is the view a fresh cache paints there.
    TerrainScene walked;
    CHECK(walked.load());
    walked.renderer.setTerrainCache(true);
    const Vec2 from{21000.4, 12900.2};
    const Vec2 to{22272.3, 13440.7};
    for (int step = 0; step <= 30; ++step) {
        const double t = step / 30.0;
        walked.frame({from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t}, 1.0);
    }
    std::vector<std::uint8_t> arrived;
    for (int i = 0; i < kFramesToBakeAll; ++i) arrived = walked.frame(to, 1.0);

    TerrainScene fresh;
    CHECK(fresh.load());
    fresh.renderer.setTerrainCache(true);
    std::vector<std::uint8_t> painted;
    for (int i = 0; i < kFramesToBakeAll; ++i) painted = fresh.frame(to, 1.0);
    CHECK(differingPixels(arrived, painted, 0) == 0);
}

TEST(terrain_chunks_are_given_back_in_a_realm_without_a_map) {
    TerrainScene scene;
    CHECK(scene.load());
    scene.renderer.setTerrainCache(true);
    scene.frame({16384.0, 16384.0}, 1.0);
    std::size_t chunks = 0, bytes = 0;
    scene.renderer.terrainCacheStats(chunks, bytes);
    CHECK(chunks > 0);
    // The maze draws itself and has nothing for the cache to hold.
    scene.view.setRealm(Realm::Maze);
    scene.frame({16384.0, 16384.0}, 1.0);
    scene.renderer.terrainCacheStats(chunks, bytes);
    CHECK(chunks == 0);
    CHECK(bytes == 0);
}

TEST(terrain_chunks_bake_the_same_picture_again_after_a_gpu_crash_drops_them) {
    // A GPU process dying empties every canvas, so App::dropCanvasCaches hands
    // back all the chunks and they are made again. What comes back has to be
    // the picture that was there, on the same grid: the world going on from
    // where it was, not from a chunk cache with holes in it.
    TerrainScene scene;
    CHECK(scene.load());
    scene.renderer.setTerrainCache(true);
    const Vec2 walls{22272.3, 13440.7};
    std::vector<std::uint8_t> before;
    for (int i = 0; i < kFramesToBakeAll; ++i) before = scene.frame(walls, 1.0);
    std::size_t chunks = 0, bytes = 0;
    scene.renderer.terrainCacheStats(chunks, bytes);
    CHECK(chunks > 0);

    scene.renderer.dropCanvasCaches();
    scene.renderer.terrainCacheStats(chunks, bytes);
    CHECK(chunks == 0);
    CHECK(bytes == 0);

    std::vector<std::uint8_t> after;
    for (int i = 0; i < kFramesToBakeAll; ++i) after = scene.frame(walls, 1.0);
    scene.renderer.terrainCacheStats(chunks, bytes);
    CHECK(chunks > 0);
    CHECK(differingPixels(before, after, 0) == 0);
}

TEST(map_tiles_leave_no_seam_when_antennae_zoom_the_camera_far_out) {
    // High-tier antennae take the camera to 0.1, where the 1.5-unit overlap
    // every tile is drawn with is a fifth of a device pixel. Two neighbouring
    // tile corners, each snapped to a whole pixel on its own, used to land a
    // pixel further apart than the tile reached, at every boundary where the
    // rounding fell that way -- a black line every dozen tiles, across the
    // whole map. These zooms each opened one at this scale. Painted straight,
    // with no chunk cache: the tests above hold the cache to this same picture.
    // The tile artwork comes out of the scene's sprite cache; without it every
    // cell draws nothing and the whole frame is the black this is looking for.
    TerrainScene scene;
    CHECK(scene.load());

    // The middle of the garden: at 0.1 the view is 19200 x 10800 units, and
    // all of it has to be map for a black line to mean a seam.
    const Vec2 centre{16384.3, 16384.7};
    for (const double zoom : {0.100, 0.106, 0.112, 0.130}) {
        const std::vector<std::uint8_t> pixels = scene.frame(centre, zoom);
        CHECK(pixels.size() == static_cast<std::size_t>(kPixelWidth) * kPixelHeight * 4);
        CHECK(blackLines(pixels, true) == 0);
        CHECK(blackLines(pixels, false) == 0);
    }
}

namespace {

/// A data directory holding one 100 x 100 map: white paper on the bottom
/// layer, and over all of it a veil -- a square of black at half opacity --
/// on the layer above, turned through all eight of Tiled's orientations cell
/// by cell. A veil over paper is ONE grey wherever exactly one veil covers a
/// pixel: darker where two do (tiles painted into each other), lighter or
/// darker again where none does or the backdrop shows through (a seam).
std::string veilDataDir() {
    const std::string dir = testsupport::tempDir("flix_terrain_veil");
    constexpr int kSide = 100;
    static const std::uint32_t kFlips[8] = {0u,          0x80000000u, 0x40000000u, 0xC0000000u,
                                            0x20000000u, 0xA0000000u, 0x60000000u, 0xE0000000u};
    std::string paper, veil;
    for (int y = 0; y < kSide; ++y) {
        for (int x = 0; x < kSide; ++x) {
            if (!paper.empty()) { paper += ","; veil += ","; }
            paper += "1";
            veil += std::to_string(2u | kFlips[(x + y * 3) % 8]);
        }
    }
    const std::string side = std::to_string(kSide);
    const std::string map = R"({
 "compressionlevel": -1, "infinite": false, "orientation": "orthogonal",
 "renderorder": "right-down", "tiledversion": "1.10.1", "type": "map",
 "version": "1.10", "nextlayerid": 3, "nextobjectid": 1,
 "tilewidth": 256, "tileheight": 256, "width": )" + side + R"(, "height": )" + side + R"(,
 "tilesets": [ { "firstgid": 1, "source": "veil.tsj" } ],
 "layers": [
  { "type": "tilelayer", "id": 1, "name": "background", "opacity": 1, "visible": true,
    "x": 0, "y": 0, "width": )" + side + R"(, "height": )" + side + R"(, "data": [)" + paper + R"(] },
  { "type": "tilelayer", "id": 2, "name": "veil", "opacity": 1, "visible": true,
    "x": 0, "y": 0, "width": )" + side + R"(, "height": )" + side + R"(, "data": [)" + veil + R"(] }
 ]
})";
    const std::string tileset = R"({
 "columns": 0, "name": "veil", "tilecount": 2, "tiledversion": "1.10.1",
 "tileheight": 256, "tilewidth": 256, "type": "tileset", "version": "1.10",
 "tiles": [
  { "id": 0, "image": "tiles/paper.svg", "imageheight": 256, "imagewidth": 256,
    "properties": [ { "name": "covers_everything", "type": "bool", "value": true } ] },
  { "id": 1, "image": "tiles/veil.svg", "imageheight": 256, "imagewidth": 256 }
 ]
})";
    const bool written =
        testsupport::writeText(dir + "/veil.tmj", map) &&
        testsupport::writeText(dir + "/veil.tsj", tileset) &&
        testsupport::writeText(dir + "/maps.json", "{ \"maps\": [ { \"file\": \"veil.tmj\" } ] }\n") &&
        testsupport::writeText(dir + "/paper.svg",
                               R"(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">)"
                               R"(<rect width="256" height="256" fill="#ffffff"/></svg>)") &&
        testsupport::writeText(dir + "/veil.svg",
                               R"(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">)"
                               R"(<rect width="256" height="256" fill="#000000" opacity="0.5"/></svg>)");
    return written ? dir : std::string();
}

/// The pixels of `frame` (RGBA, `width` wide) more than one level off the
/// frame's centre pixel in any channel.
int offCentrePixels(const std::vector<std::uint8_t>& frame, int width, int height) {
    const std::size_t mid = (static_cast<std::size_t>(height / 2) * width + width / 2) * 4;
    int off = 0;
    for (std::size_t i = 0; i + 3 < frame.size(); i += 4) {
        for (std::size_t c = 0; c < 3; ++c) {
            if (std::abs(static_cast<int>(frame[i + c]) - static_cast<int>(frame[mid + c])) > 1) {
                ++off;
                break;
            }
        }
    }
    return off;
}

} // namespace

TEST(map_tiles_meet_without_overlapping_at_any_zoom_or_display_scale) {
    // Every tile is painted into exactly its own cell, both edges on whole
    // device pixels and shared with the neighbour. They used to be painted
    // 1.5 units oversized, which put a strip of every boundary under two
    // tiles: wherever the art was translucent at its edge -- the drop shadow
    // along every shore and wall -- the strip came out twice as dark, a tick
    // at each tile boundary. A uniform veil turns that into a whole grid of
    // darker lines, and a seam into lines of another colour, so the frame
    // must be one grey from edge to edge. Painted straight and through the
    // chunk cache, at display scales where a cell is a fraction of a pixel
    // past a whole number, and with the cells turned every way Tiled turns
    // them (a quarter turn of a cell a pixel wider than tall must still land
    // on itself).
    std::string error;
    CHECK(loadContent(testsupport::dataDir(), error));
    const std::string dir = veilDataDir();
    CHECK(!dir.empty());
    if (dir.empty()) return;
    WorldMaps maps;
    CHECK(maps.load(dir, nullptr, error));
    SpriteCache sprites;
    sprites.build(content(), dir);
    const Vec2 centre{12800.3, 12800.7};
    struct Display { int width, height; };
    for (const bool cache : {false, true}) {
        for (const Display display : {Display{1280, 720}, Display{1366, 768}, Display{960, 540}}) {
            for (const double zoom : {1.0, 1.6, 1.37, 0.85, 0.3, 0.106}) {
                WorldRenderer renderer;
                renderer.setSprites(&sprites);
                renderer.setWorldMaps(&maps);
                renderer.setTerrainCache(cache);
                WorldView view;
                view.setRealm(Realm::Overworld);
                // The cache's first frame paints most chunks straight; the
                // later ones blit them. Both must be the one grey.
                for (int pass = 0; pass < (cache ? 2 : 1); ++pass) {
                    std::vector<std::uint8_t> pixels;
                    for (int i = 0; i < (pass == 0 ? 1 : kFramesToBakeAll); ++i) {
                        Canvas canvas = Canvas::createVirtual(display.width, display.height);
                        canvas.setLogicalSize(kDesignWidth, kDesignHeight);
                        canvas.resetTransform();
                        const float scale = static_cast<float>(display.width) / kDesignWidth;
                        canvas.scale(scale, scale);
                        Camera camera;
                        camera.setViewport(kDesignWidth, kDesignHeight);
                        camera.userZoom = zoom;
                        camera.snapTo(centre);
                        renderer.draw(canvas, view, camera, centre, 0.0);
                        pixels = canvas.getImageData(0, 0, display.width, display.height);
                    }
                    const std::size_t mid =
                        (static_cast<std::size_t>(display.height / 2) * display.width +
                         display.width / 2) * 4;
                    // The veil really is there: half-black over white.
                    CHECK(pixels.size() > mid + 2 && pixels[mid] > 100 && pixels[mid] < 160);
                    const int off = offCentrePixels(pixels, display.width, display.height);
                    if (off != 0) {
                        std::printf("    %s %dx%d zoom %.3f pass %d: %d pixels off the veil's grey\n",
                                    cache ? "cached" : "straight", display.width, display.height,
                                    zoom, pass, off);
                    }
                    CHECK(off == 0);
                }
            }
        }
    }
}
