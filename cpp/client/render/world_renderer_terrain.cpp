// The ground: tile layers painted cell by cell or through the baked chunk
// cache, the boundary blocks past a map's edge, and the generated floors of
// the maze, the arena and the waves disc.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <unordered_map>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

#include "client/render/art_cache.h"
#include "client/ui/draw.h"
#include "shared/game/admin_arena.h"
#include "shared/game/map_elements.h"
#include "shared/game/terrain.h"

namespace flix {

using namespace world_render;

namespace {

/// Tiles are NOT drawn oversized. Every tile grid here -- the map's layers,
/// the waves' disc, the admin arena -- puts each cell in exactly its own box,
/// with both edges snapped to whole device pixels, so a boundary is covered
/// by one tile or the other and never by both or neither. Each cell used to
/// be painted 1.5 units past each side to hide anti-aliased seams, and that
/// overlap was visible: translucent ink at an edge (every wall's drop shadow)
/// went down twice in the strip two neighbours shared, a dark tick at every
/// tile boundary along every shore, and the art, stretched 1% to fill the
/// bigger box, no longer met its neighbour's where a line crossed between
/// them. See tileBakePixels and drawTileArt.

/// Where one coordinate lands on the device grid: `v` in user units, at
/// `toPixels` device pixels per user unit, rounded to the nearest whole pixel.
double snapToPixel(double v, double toPixels) { return std::round(v * toPixels) / toPixels; }

/// Device pixels per user unit at the frame's base transform, read back off
/// the canvas the way the tile cache reads it.
double devicePixelsPerUnit(const Canvas& canvas) {
    const double logical = canvas.width() > 0 ? static_cast<double>(canvas.width()) : 1.0;
    const double perUnit = static_cast<double>(canvas.pixelWidth()) / logical;
    return perUnit > 0.0 ? perUnit : 1.0;
}

/// The side, in device pixels, every tile picture of a grid is baked at when
/// one cell is `pitch` device pixels across: the largest box a snapped cell
/// can get. Snapping both edges of every cell makes them floor(pitch) or
/// ceil(pitch) pixels wide -- and as tall -- so one size of bitmap, cropped
/// to the smaller cells (drawCachedArtCell), serves the whole grid. The
/// epsilon keeps a whole-pixel pitch from rounding up a pixel on float error.
double tileBakePixels(double pitch) { return std::max(1.0, std::ceil(pitch - 1e-6)); }

/// One tile's artwork filling exactly the box (left, top, w, h), whose edges
/// the caller has put on whole device pixels. `side` is the grid's bake side
/// (tileBakePixels) in the same user units; w and h are at most that.
///
/// Through the web's art cache when it can, which bakes the picture at `side`
/// and blits the w x h of it this cell needs. Otherwise straight, stretched to
/// the box -- a pixel's difference on an axis at most -- because renderFitted
/// letterboxes a non-square box ('meet') and the half-pixel bands it would
/// leave are exactly the seams snapping exists to close.
void drawTileArt(Canvas& canvas, const SvgDocument& document, double left, double top, double w,
                 double h, double side) {
    if (drawCachedArtCell(canvas, document, left, top, w, h, side)) return;
    if (w == h) {
        document.renderFitted(canvas, static_cast<float>(left), static_cast<float>(top),
                              static_cast<float>(w), static_cast<float>(h), 0.0f);
        return;
    }
    canvas.save();
    canvas.translate(static_cast<float>(left), static_cast<float>(top));
    canvas.scale(static_cast<float>(w / side), static_cast<float>(h / side));
    document.renderFitted(canvas, 0.0f, 0.0f, static_cast<float>(side), static_cast<float>(side),
                          0.0f);
    canvas.restore();
}

/// Clips to a world rectangle. Every tiled draw needs one: the artwork inside
/// a 400-unit ground tile is free to overflow its own box (hel.svg rotates
/// squares straight out of it) and the browser build's rasterised tile crops
/// that off for free.
void clipWorldRect(Canvas& canvas, const Camera& camera, Rect world) {
    const Vec2 topLeft = camera.worldToScreen({world.x, world.y});
    canvas.beginPath();
    canvas.rect(static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
                static_cast<float>(world.w * camera.zoom()),
                static_cast<float>(world.h * camera.zoom()));
    canvas.clip();
}

/// The overlap of two world rectangles, empty when they do not meet.
Rect intersection(Rect a, Rect b) {
    const double x0 = std::max(a.left(), b.left());
    const double y0 = std::max(a.top(), b.top());
    const double x1 = std::min(a.right(), b.right());
    const double y1 = std::min(a.bottom(), b.bottom());
    return {x0, y0, std::max(0.0, x1 - x0), std::max(0.0, y1 - y0)};
}

/// Traces the wall shape of one rounded-corner cell (4-7 a convex floor
/// corner, 12-15 a concave wall corner) into the current path, in screen
/// space. The arc is one whole cell in radius and centred on the shared
/// corner vertex, which is exactly the circle Maze::cellBlocksPoint tests, so
/// what is drawn is what is collided with.
void traceMazeCorner(Canvas& canvas, const Camera& camera, double x0, double y0, double g,
                     int value) {
    const int left = (value >> 1) & 1;
    const int top = value & 1;
    const int concave = (value >> 3) & 1;
    const double cx = x0 + left * g;   // arc centre = the shared corner vertex
    const double cy = y0 + top * g;
    // A convex floor corner fills only the curved triangle at the vertex
    // opposite the arc centre; a concave wall corner fills the whole cell
    // minus that triangle. Both start their path accordingly.
    const double sx = concave ? cx : x0 + (1 - left) * g;
    const double sy = concave ? cy : y0 + (1 - top) * g;
    const double a0 = mazeFilletStartAngle(value);
    const Vec2 start = camera.worldToScreen({sx, sy});
    const Vec2 centre = camera.worldToScreen({cx, cy});
    canvas.moveTo(static_cast<float>(start.x), static_cast<float>(start.y));
    canvas.arc(static_cast<float>(centre.x), static_cast<float>(centre.y),
               static_cast<float>(g * camera.zoom()), static_cast<float>(a0),
               static_cast<float>(a0 + kPi * 0.5), false);
}

/// The reference's arena floor (src/graphics/pvp-arena.ts): gardn's "???"
/// zone, a plain grey with a faint dark grid. Its darker void and red ring gave
/// way to flooooio's border (2026-11-07, user), as the waves' disc has.
constexpr std::uint32_t kArenaFloor = 0x777777u;
constexpr double kArenaGridCell = 50.0;

} // namespace

void WorldRenderer::drawMaze(Canvas& canvas, const Camera& camera) const {
    // Beyond the maze's square there is nothing: the black the frame clears
    // to, which says nobody can go there.
    ui::setFill(canvas, 0x000000u);
    canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                    static_cast<float>(camera.viewportHeight()));

    const Maze& maze = activeMaze();
    const double size = maze.worldSize();
    const Rect square{kMazeOriginX, kMazeOriginY, size, size};
    const Rect visible = camera.visibleWorld(0);
    if (!visible.intersects(square)) return;

    // 1. Ground: the floor tile of the biome this maze borrows, paved over the
    //    maze's square on the overworld's own tile grid, so a garden maze
    //    reads as garden ground. The maze has no map file, so the tile is the
    //    one the waves disc paves that biome with (waves.h). The biome's flat
    //    colour goes under it: what shows if the art is missing.
    const int section = kMazeBiomeSections[static_cast<std::size_t>(maze.biome())];
    const Rect floor = intersection(visible, square);
    if (floor.w > 0 && floor.h > 0) {
        const Vec2 at = camera.worldToScreen({floor.x, floor.y});
        ui::setFill(canvas, biomeOf(section).ground);
        canvas.fillRect(static_cast<float>(at.x), static_cast<float>(at.y),
                        static_cast<float>(floor.w * camera.zoom()),
                        static_cast<float>(floor.h * camera.zoom()));

        WaveBiome tileBiome = WaveBiome::Garden;
        switch (maze.biome()) {
            case MazeBiome::Garden: tileBiome = WaveBiome::Garden; break;
            case MazeBiome::Desert: tileBiome = WaveBiome::Desert; break;
            case MazeBiome::Ocean: tileBiome = WaveBiome::Ocean; break;
        }
        const SvgDocument* art =
            sprites_ != nullptr ? sprites_->tileArt(waveBiomeInfo(tileBiome).tile) : nullptr;
        if (art != nullptr) {
            const int x0 = static_cast<int>(std::floor((floor.left() - kMazeOriginX) / kTileSize));
            const int y0 = static_cast<int>(std::floor((floor.top() - kMazeOriginY) / kTileSize));
            const int x1 = static_cast<int>(std::floor((floor.right() - kMazeOriginX) / kTileSize));
            const int y1 = static_cast<int>(std::floor((floor.bottom() - kMazeOriginY) / kTileSize));
            // Each cell in exactly its own box on whole device pixels, as the
            // map's are (paintTerrainCells), clipped to the maze's square.
            const double toPixels = devicePixelsPerUnit(canvas);
            const double side = tileBakePixels(kTileSize * camera.zoom() * toPixels) / toPixels;
            const auto cornerAt = [&](int x, int y) {
                const Vec2 c = camera.worldToScreen(
                    {kMazeOriginX + x * kTileSize, kMazeOriginY + y * kTileSize});
                return Vec2{snapToPixel(c.x, toPixels), snapToPixel(c.y, toPixels)};
            };
            canvas.save();
            clipWorldRect(canvas, camera, square);
            for (int y = y0; y <= y1; ++y) {
                for (int x = x0; x <= x1; ++x) {
                    const Vec2 a = cornerAt(x, y);
                    const Vec2 b = cornerAt(x + 1, y + 1);
                    if (b.x > a.x && b.y > a.y) {
                        drawTileArt(canvas, *art, a.x, a.y, b.x - a.x, b.y - a.y, side);
                    }
                }
            }
            canvas.restore();
        }
    }

    // 2. Walls: a single translucent black path, filled once. Filling cell by
    //    cell at partial alpha leaves antialiased hairline seams along every
    //    interior boundary of a contiguous wall mass; one nonzero fill
    //    rasterises the union with full coverage across shared edges.
    const double g = kMazeCellSize;
    const double zoom = camera.zoom();
    const int dim = maze.gridDim();
    const int minGx = std::max(0, static_cast<int>(std::floor((visible.left() - kMazeOriginX) / g)));
    const int maxGx = std::min(dim - 1, static_cast<int>(std::floor((visible.right() - kMazeOriginX) / g)));
    const int minGy = std::max(0, static_cast<int>(std::floor((visible.top() - kMazeOriginY) / g)));
    const int maxGy = std::min(dim - 1, static_cast<int>(std::floor((visible.bottom() - kMazeOriginY) / g)));

    canvas.save();
    clipWorldRect(canvas, camera, square);
    ui::setFill(canvas, 0x000000u, 0.2);
    canvas.beginPath();
    for (int gy = minGy; gy <= maxGy; ++gy) {
        for (int gx = minGx; gx <= maxGx; ++gx) {
            const int v = maze.cellValue(gx, gy);
            if (v == 1) continue;   // plain floor: nothing to draw
            const double x0 = kMazeOriginX + gx * g;
            const double y0 = kMazeOriginY + gy * g;
            if (v == 0) {
                const Vec2 at = camera.worldToScreen({x0, y0});
                canvas.rect(static_cast<float>(at.x), static_cast<float>(at.y),
                            static_cast<float>(g * zoom), static_cast<float>(g * zoom));
            } else {
                traceMazeCorner(canvas, camera, x0, y0, g, v);
            }
        }
    }
    canvas.fill();
    canvas.restore();
}

namespace {

/// How far flooooio's ground reaches from a disc's centre, on each axis: it
/// lays radius/80 tiles of 300 across, centred on the disc (TileRenderer.zig
/// renderGameTileset), which carries the floor on 0.875 radii past the edge.
/// Past that the canvas is cleared, which is black here.
double discGroundReach(double radius) { return radius / 80.0 * 300.0 * 0.5; }

/// The square that ground covers, on the screen.
Rect discGroundOnScreen(const Camera& camera, Vec2 centre, double radius) {
    const double reach = discGroundReach(radius);
    const Vec2 a = camera.worldToScreen({centre.x - reach, centre.y - reach});
    const Vec2 b = camera.worldToScreen({centre.x + reach, centre.y + reach});
    return {a.x, a.y, b.x - a.x, b.y - a.y};
}

/// flooooio's border (TileRenderer.zig renderBoundaryCircle): everything from
/// half a unit past the edge out goes under black at 15%. flooooio strokes a
/// ring five screens wide for it; a screen with a hole in it is the same
/// picture without a stroke that size.
void shadeOutsideDisc(Canvas& canvas, const Camera& camera, Vec2 centreWorld, double radius) {
    const Vec2 centre = camera.worldToScreen(centreWorld);
    const auto r = static_cast<float>((radius + 0.5) * camera.zoom());
    canvas.save();
    ui::setFill(canvas, 0x000000u, 0.15);
    canvas.beginPath();
    canvas.rect(0.0f, 0.0f, static_cast<float>(camera.viewportWidth()),
                static_cast<float>(camera.viewportHeight()));
    canvas.moveTo(static_cast<float>(centre.x) + r, static_cast<float>(centre.y));
    canvas.arc(static_cast<float>(centre.x), static_cast<float>(centre.y), r, 0.0f,
               static_cast<float>(kTau), false);
    canvas.fill("evenodd");
    canvas.restore();
}

} // namespace

void WorldRenderer::drawArena(Canvas& canvas, const Camera& camera) const {
    // The floor carries on past the ring, under flooooio's border, as the
    // waves' disc does; black beyond the ground.
    ui::setFill(canvas, 0x000000u);
    canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                    static_cast<float>(camera.viewportHeight()));

    const Rect ground = discGroundOnScreen(camera, kArenaCentre, kArenaRadius);
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(ground.x), static_cast<float>(ground.y),
                static_cast<float>(ground.w), static_cast<float>(ground.h));
    canvas.clip();
    ui::setFill(canvas, kArenaFloor);
    canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                    static_cast<float>(camera.viewportHeight()));

    // The grid is aligned to the arena's centre so its lines hold still as
    // the camera moves. One screen pixel wide at every zoom, as the browser
    // draws it (lineWidth 1 / zoomLevel inside the world transform).
    const double reach = discGroundReach(kArenaRadius);
    const Rect visible = camera.visibleWorld(0);
    const Rect floor{kArenaCentre.x - reach, kArenaCentre.y - reach, reach * 2.0, reach * 2.0};
    const Rect span = intersection(visible, floor);
    if (span.w > 0 && span.h > 0) {
        ui::setStroke(canvas, 0x000000u, 0.18);
        canvas.setLineWidth(1.0f);
        canvas.beginPath();
        const double firstX =
            kArenaCentre.x + std::ceil((span.left() - kArenaCentre.x) / kArenaGridCell) * kArenaGridCell;
        const double firstY =
            kArenaCentre.y + std::ceil((span.top() - kArenaCentre.y) / kArenaGridCell) * kArenaGridCell;
        for (double x = firstX; x <= span.right(); x += kArenaGridCell) {
            const Vec2 a = camera.worldToScreen({x, span.top()});
            const Vec2 b = camera.worldToScreen({x, span.bottom()});
            canvas.moveTo(static_cast<float>(a.x), static_cast<float>(a.y));
            canvas.lineTo(static_cast<float>(b.x), static_cast<float>(b.y));
        }
        for (double y = firstY; y <= span.bottom(); y += kArenaGridCell) {
            const Vec2 a = camera.worldToScreen({span.left(), y});
            const Vec2 b = camera.worldToScreen({span.right(), y});
            canvas.moveTo(static_cast<float>(a.x), static_cast<float>(a.y));
            canvas.lineTo(static_cast<float>(b.x), static_cast<float>(b.y));
        }
        canvas.stroke();
    }
    canvas.restore();

    shadeOutsideDisc(canvas, camera, kArenaCentre, kArenaRadius);
}

namespace {

/// The cells of a map one terrain paint covers, inclusive on every side.
struct CellSpan {
    int x0 = 0;
    int y0 = 0;
    int x1 = -1;
    int y1 = -1;
};

/// Paints `span` of `map`'s tile layers. `corner(tx, ty)` is the top-left of
/// cell (tx, ty) in the canvas's user units, already on a whole device pixel,
/// and the cell's box runs to corner(tx + 1, ty + 1): every edge on a whole
/// pixel, and each shared with the neighbour on that side, so the cells tile
/// the plane with no gap and no overlap at any zoom.
///
/// Whole pixels, because a box edge that falls inside a pixel is covered only
/// fractionally, and a tile is a STACK of shapes: the background goes down
/// over the neighbour's finished picture at that fraction and the shapes
/// above it cannot put back what they covered, so a sliver of the tile's own
/// background survives as a hairline -- faint, but at every boundary at once,
/// which reads as a grid ruled over the map. On a whole pixel the edge is
/// covered or it is not. And SHARED, because two corners each rounded on
/// their own can land a pixel further apart than a fixed tile size reaches:
/// at the antennae's 0.1 zoom, that was a black line every dozen tiles.
///
/// `side` is the grid's bake side (tileBakePixels) in user units. The direct
/// path and the chunk cache both paint through here, so a baked chunk is the
/// very picture the direct path would have drawn in its place.
template <typename Corner>
void paintTerrainCells(Canvas& canvas, const MapData& map,
                       const std::vector<const SvgDocument*>& art, CellSpan span, double side,
                       const Corner& corner) {
    const int cols = map.width();

    // A cell's compiled artwork, or null: an empty cell, a tile whose art
    // index is out of the palette, or a file the data directory does not
    // hold. All three draw nothing, and none of them is an error -- a map is
    // free to name art nobody has drawn yet, and that must cost that cell its
    // picture rather than the frame.
    const auto resolve = [&art](const TiledCell& cell) -> const SvgDocument* {
        if (cell.art < 0) return nullptr;
        const std::size_t slot = static_cast<std::size_t>(cell.art);
        return slot < art.size() ? art[slot] : nullptr;
    };

    // One cell's artwork, fitted to its own box and turned by its flip bits.
    // The unturned case -- which is every cell of a hand-painted centre and
    // most of a map -- skips the transform entirely and draws into an
    // axis-aligned box, because a save/rotate/restore around a tile costs more
    // than the tile does.
    //
    // Both cases hand the art cache the SAME bake side, and that is
    // deliberate: what the web build bakes is the tile UNTURNED, and the
    // rotation is in the canvas transform the blit goes through. So one bitmap
    // serves all eight orientations and the cache key needs no orientation in
    // it. Baking the turned picture instead would need the flip bits in that
    // key -- without them every rotation of one tile would collide on the
    // first one baked, and every edge tile in the map is painted as four
    // rotations of one picture.
    const auto drawCell = [&](const SvgDocument& document, int tx, int ty, std::uint8_t flags) {
        const Vec2 at = corner(tx, ty);
        const Vec2 end = corner(tx + 1, ty + 1);
        const double w = end.x - at.x;
        const double h = end.y - at.y;
        if (!(w > 0.0) || !(h > 0.0)) return;
        const TileOrientation orientation = tileOrientation(flags);
        if (orientation.radians == 0.0 && !orientation.mirror) {
            drawTileArt(canvas, document, at.x, at.y, w, h, side);
            return;
        }
        // Turned about the box's own centre, by the rotation and mirror as
        // one exact matrix of 0s and 1s -- as orientInTile turns the shapes
        // -- rather than through rotate(), whose float sine of a half turn is
        // 1e-7 off zero. That is enough to move a vertex off a subsample
        // line it sits on exactly, and an odd-sized cell's centre line is one
        // (the edge art has vertices on it), so the same tile rasterised at
        // two places -- in a chunk and straight on the frame -- came out a
        // sample apart. A quarter turn swaps the box's sides in the turned
        // space, so a cell a pixel wider than it is tall is drawn a pixel
        // taller than wide there and lands back on itself.
        const float c = static_cast<float>(std::round(std::cos(orientation.radians)));
        const float s = static_cast<float>(std::round(std::sin(orientation.radians)));
        const float flip = orientation.mirror ? -1.0f : 1.0f;
        const bool sideways = s != 0.0f;
        const double bw = sideways ? h : w;
        const double bh = sideways ? w : h;
        canvas.save();
        canvas.translate(static_cast<float>(at.x + w * 0.5), static_cast<float>(at.y + h * 0.5));
        // rotate(radians) then scale(flip, 1).
        canvas.transform(c * flip, s * flip, -s, c, 0.0f, 0.0f);
        drawTileArt(canvas, document, -bw * 0.5, -bh * 0.5, bw, bh, side);
        canvas.restore();
    };

    // The lowest layer each cell can still be seen through, worked out before
    // anything is painted. `covers_everything` is what this is for: a cell
    // whose dirt tile fills its whole square opaquely has no need of the grass
    // under it, and on this map that is most of the upper layers. The scan
    // runs top down and stops at the first covering tile.
    const std::size_t layerCount = map.layers().size();
    const std::size_t spanX = static_cast<std::size_t>(span.x1 - span.x0 + 1);
    const std::size_t spanY = static_cast<std::size_t>(span.y1 - span.y0 + 1);
    // Kept between paints rather than allocated per paint: the direct path
    // runs every frame and this is one number per cell on screen, a few dozen.
    thread_local std::vector<std::size_t> bottoms;
    bottoms.assign(spanX * spanY, 0);
    for (int ty = span.y0; ty <= span.y1; ++ty) {
        const std::size_t row = static_cast<std::size_t>(ty) * static_cast<std::size_t>(cols);
        for (int tx = span.x0; tx <= span.x1; ++tx) {
            const std::size_t index = row + static_cast<std::size_t>(tx);
            for (std::size_t layer = layerCount; layer-- > 0;) {
                const TiledCell& cell = map.layers()[layer].cells[index];
                if ((cell.flags & kTileCoversEverything) == 0) continue;
                // Only art that is actually THERE hides what is under it. A
                // covering tile whose file the data directory does not hold
                // draws nothing, and taking its word for the cell would turn
                // one missing picture into a black hole with the ground it
                // was painted over blanked out too.
                if (resolve(cell) == nullptr) continue;
                bottoms[static_cast<std::size_t>(ty - span.y0) * spanX +
                        static_cast<std::size_t>(tx - span.x0)] = layer;
                break;
            }
        }
    }

    // Layer by layer, which is what Tiled itself means by a layer. No cell
    // reaches past its own box, so the order between cells changes nothing
    // today; it mattered while tiles were painted oversized, when a cell's
    // LOWER layer laid after its neighbour's upper one wiped the overlap back
    // off, and it keeps mattering for any art that spills its box.
    for (std::size_t layer = 0; layer < layerCount; ++layer) {
        const std::vector<TiledCell>& cells = map.layers()[layer].cells;
        for (int ty = span.y0; ty <= span.y1; ++ty) {
            const std::size_t row = static_cast<std::size_t>(ty) * static_cast<std::size_t>(cols);
            const std::size_t bottomRow = static_cast<std::size_t>(ty - span.y0) * spanX;
            for (int tx = span.x0; tx <= span.x1; ++tx) {
                if (layer < bottoms[bottomRow + static_cast<std::size_t>(tx - span.x0)]) continue;
                const TiledCell& cell = cells[row + static_cast<std::size_t>(tx)];
                const SvgDocument* document = resolve(cell);
                if (document == nullptr) continue;
                drawCell(*document, tx, ty, cell.flags);
            }
        }
    }
}

/// The chunk cache's sizes. A chunk is a square run of cells, a power of two
/// on a side, as many as fit in kChunkPixels device pixels at the scale the
/// frame is drawn at -- and never fewer than one, so at a close zoom on a
/// dense display a chunk is a single cell bigger than that.
///
/// Measured in PIXELS rather than world units, which is where this parts
/// from the browser build's 1024-unit chunks (static-map-cache.ts): those are
/// baked at one pixel per unit and stretched to the screen, which is a blur
/// at any zoom past 1 and a texture several times the screen at a 2x
/// display. These are baked at the device resolution they are blitted at, so
/// a chunk is drawn one texel to one pixel and is as sharp as the tiles
/// painted straight, and the set on screen is a little more than one
/// screenful of pixels however far the camera is out.
constexpr double kChunkPixels = 512.0;
/// The most cells along a chunk's side: at the antennae's 0.1 a cell is a
/// couple of dozen pixels, and an uncapped chunk would be most of a map.
constexpr int kMaxChunkCells = 32;
/// Bitmaps past this side are refused and those cells drawn straight.
constexpr int kMaxChunkSide = 4096;
/// What the chunks may hold between them. The set on screen at a 4K backing
/// store is about 50 MB; the rest of this keeps the ring of chunks the
/// player just walked off, so walking back does not bake them again.
constexpr std::size_t kMaxChunkBytes = 96u << 20;
/// Baking is spread over frames: a new zoom or a teleport needs every chunk
/// on screen at once, and those not baked yet are painted straight -- which
/// is what every frame cost before the cache -- until their turn comes. At
/// most this many bakes a frame, and no more cells than the second figure
/// between them once the first is done; every bake is also a GPU raster
/// flush of its own on the web (see the glitch atlas in world_renderer.h).
constexpr int kMaxChunkBakesPerFrame = 6;
constexpr int kChunkBakeCellsPerFrame = 1024;

/// The wall a map is walled in with, to carry on past its edge: the commonest
/// tile on its wall layers around the map's outer ring that fills its whole
/// square opaquely and is drawn unturned -- the centre piece of the boundary
/// wall, rather than one of its edge or corner pieces. A map whose wall art is
/// not marked opaque (the computer's green board) gets its commonest unturned
/// wall tile instead. Null when the map has neither; drawBoundaryBlocks then
/// fills the outside in plain wall grey.
///
/// Worked out once per map and kept: it is a scan of the whole ring, and the
/// answer only changes when the map does.
const SvgDocument* boundaryArt(const MapData& map, const std::vector<const SvgDocument*>& art) {
    static std::unordered_map<const MapData*, int> chosen;
    const auto known = chosen.find(&map);
    int pick = -1;
    if (known != chosen.end()) {
        pick = known->second;
    } else {
        const int cols = map.width(), rows = map.height();
        // The outer two cells all round: deep enough to reach past a ring of
        // edge pieces onto the wall's own centre tiles.
        constexpr int kRingDepth = 2;
        std::unordered_map<int, int> counts;
        std::unordered_map<int, int> fallback;
        const auto look = [&](int tx, int ty) {
            const std::size_t index = static_cast<std::size_t>(ty) * static_cast<std::size_t>(cols) +
                                      static_cast<std::size_t>(tx);
            for (const TiledLayer& layer : map.layers()) {
                if (!layer.collides || index >= layer.cells.size()) continue;
                const TiledCell& cell = layer.cells[index];
                if (cell.art < 0) continue;
                const TileOrientation turn = tileOrientation(cell.flags);
                if (turn.radians != 0.0 || turn.mirror) continue;
                ++fallback[cell.art];
                if ((cell.flags & kTileCoversEverything) != 0) ++counts[cell.art];
            }
        };
        for (int ty = 0; ty < rows; ++ty) {
            for (int tx = 0; tx < cols; ++tx) {
                const bool ring = tx < kRingDepth || ty < kRingDepth || tx >= cols - kRingDepth ||
                                  ty >= rows - kRingDepth;
                if (ring) look(tx, ty);
            }
        }
        const auto commonest = [](const std::unordered_map<int, int>& tally) {
            int best = 0, index = -1;
            for (const auto& [art, count] : tally) {
                if (count > best || (count == best && art < index)) {
                    best = count;
                    index = art;
                }
            }
            return index;
        };
        pick = commonest(counts);
        if (pick < 0) pick = commonest(fallback);
        chosen[&map] = pick;
    }
    if (pick < 0 || static_cast<std::size_t>(pick) >= art.size()) return nullptr;
    return art[static_cast<std::size_t>(pick)];
}

} // namespace

void WorldRenderer::drawWaves(Canvas& canvas, const Camera& camera, double timeSeconds) const {
    // flooooio paves its disc with the biome's tile at 300 units, the ground
    // carrying on 0.875 radii past the edge under its border, and black
    // beyond that.
    constexpr double kWaveTileSize = 300.0;
    const WaveBiomeInfo& biome = waveBiomeInfo(waveBiome_);
    const double dt = std::clamp(timeSeconds - waveRadiusAt_, 0.0, 0.25);
    waveRadiusAt_ = timeSeconds;
    if (waveRadiusDrawn_ < 0.0 || waveRadius_ < waveRadiusDrawn_) {
        waveRadiusDrawn_ = waveRadius_;
    } else {
        waveRadiusDrawn_ += (waveRadius_ - waveRadiusDrawn_) * (1.0 - std::exp(-dt * 3.0));
    }
    const double radius = waveRadiusDrawn_;
    const auto width = static_cast<float>(camera.viewportWidth());
    const auto height = static_cast<float>(camera.viewportHeight());
    ui::setFill(canvas, 0x000000u);
    canvas.fillRect(0, 0, width, height);

    const Rect ground = discGroundOnScreen(camera, kWavesCentre, radius);
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(ground.x), static_cast<float>(ground.y),
                static_cast<float>(ground.w), static_cast<float>(ground.h));
    canvas.clip();
    ui::setFill(canvas, biome.gaugeColor);
    canvas.fillRect(0, 0, width, height);

    const SvgDocument* art = sprites_ != nullptr ? sprites_->tileArt(biome.tile) : nullptr;
    if (art != nullptr) {
        // Squared up on the largest disc, so the pattern holds still as the
        // ground grows under it.
        const double reach = discGroundReach(radius);
        const Rect visible = intersection(camera.visibleWorld(0),
                                          Rect{kWavesCentre.x - reach, kWavesCentre.y - reach,
                                               reach * 2.0, reach * 2.0});
        const double originX = kWavesCentre.x - kWavesMaxRadius * 2.0;
        const double originY = kWavesCentre.y - kWavesMaxRadius * 2.0;
        if (visible.w > 0 && visible.h > 0) {
            const int x0 = static_cast<int>(std::floor((visible.left() - originX) / kWaveTileSize));
            const int y0 = static_cast<int>(std::floor((visible.top() - originY) / kWaveTileSize));
            const int x1 = static_cast<int>(std::floor((visible.right() - originX) / kWaveTileSize));
            const int y1 = static_cast<int>(std::floor((visible.bottom() - originY) / kWaveTileSize));
            // Each cell in exactly its own box on whole device pixels, as the
            // map's are (paintTerrainCells).
            const double toPixels = devicePixelsPerUnit(canvas);
            const double side =
                tileBakePixels(kWaveTileSize * camera.zoom() * toPixels) / toPixels;
            const auto cornerAt = [&](int x, int y) {
                const Vec2 at = camera.worldToScreen(
                    {originX + x * kWaveTileSize, originY + y * kWaveTileSize});
                return Vec2{snapToPixel(at.x, toPixels), snapToPixel(at.y, toPixels)};
            };
            for (int y = y0; y <= y1; ++y) {
                for (int x = x0; x <= x1; ++x) {
                    const Vec2 at = cornerAt(x, y);
                    const Vec2 end = cornerAt(x + 1, y + 1);
                    if (end.x > at.x && end.y > at.y) {
                        drawTileArt(canvas, *art, at.x, at.y, end.x - at.x, end.y - at.y, side);
                    }
                }
            }
        }
    }
    canvas.restore();

    shadeOutsideDisc(canvas, camera, kWavesCentre, radius);
}

void WorldRenderer::drawTerrain(Canvas& canvas, const Camera& camera, Realm realm) const {
    if (realm == kAdminArenaRealm && terrain_) {
        const auto& floor = kAdminArenaThemes[std::min<std::size_t>(terrain_->adminArenaFloor, kAdminArenaThemes.size()-1)];
        const auto& wall = kAdminArenaThemes[std::min<std::size_t>(terrain_->adminArenaWall, kAdminArenaThemes.size()-1)];
        ui::setFill(canvas, floor.color);
        canvas.fillRect(0, 0, camera.viewportWidth(), camera.viewportHeight());
        const Rect visible = camera.visibleWorld(0);
        const int x0 = std::max(0,int(std::floor(visible.left()/kTileSize)));
        const int y0 = std::max(0,int(std::floor(visible.top()/kTileSize)));
        const int x1 = std::min(terrain_->tileCols(realm)-1,int(std::floor(visible.right()/kTileSize)));
        const int y1 = std::min(terrain_->tileRows(realm)-1,int(std::floor(visible.bottom()/kTileSize)));
        const auto* floorArt = sprites_ ? sprites_->tileArt(floor.floor) : nullptr;
        const auto* wallArt = sprites_ ? sprites_->tileArt(wall.wall) : nullptr;
        // Each cell in exactly its own box on whole device pixels, as the
        // map's are (paintTerrainCells).
        const double toPixels = devicePixelsPerUnit(canvas);
        const double side = tileBakePixels(kTileSize*camera.zoom()*toPixels)/toPixels;
        const auto cornerAt = [&](int x, int y) {
            const Vec2 at = camera.worldToScreen({x*kTileSize, y*kTileSize});
            return Vec2{snapToPixel(at.x,toPixels), snapToPixel(at.y,toPixels)};
        };
        for (int y=y0;y<=y1;++y) for(int x=x0;x<=x1;++x) {
            const bool solid = terrain_->atTile(x,y,realm) == Tile::Solid;
            const auto* art = solid ? wallArt : floorArt;
            const Vec2 at = cornerAt(x,y);
            const Vec2 end = cornerAt(x+1,y+1);
            if (!(end.x > at.x) || !(end.y > at.y)) continue;
            if (art) {
                drawTileArt(canvas,*art,at.x,at.y,end.x-at.x,end.y-at.y,side);
            } else if (solid) { ui::setFill(canvas,0x555555u); canvas.fillRect(at.x,at.y,end.x-at.x,end.y-at.y); }
        }
        ui::setStroke(canvas,0x414141u);canvas.setLineWidth(float(4*camera.zoom()));
        canvas.beginPath();
        for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x)if(terrain_->atTile(x,y,realm)==Tile::Solid) {
            const auto line=[&](int dx,int dy,double ax,double ay,double bx,double by){if(terrain_->atTile(x+dx,y+dy,realm)==Tile::Open){const auto a=camera.worldToScreen({ax,ay}),b=camera.worldToScreen({bx,by});canvas.moveTo(a.x,a.y);canvas.lineTo(b.x,b.y);}};
            const double a=x*kTileSize,b=y*kTileSize;
            line(-1,0,a,b,a,b+kTileSize);line(1,0,a+kTileSize,b,a+kTileSize,b+kTileSize);
            line(0,-1,a,b,a+kTileSize,b);line(0,1,a,b+kTileSize,a+kTileSize,b+kTileSize);
        }
        canvas.stroke();
        return;
    }

    // The physical boundary is solid. Repeat its blocks beyond authored
    // bounds so zooming out never exposes a void beside an invisible wall.
    const MapData* map = mapFor(realm);
    ui::setFill(canvas, 0x000000u);
    canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                    static_cast<float>(camera.viewportHeight()));

    // The PICTURE of a realm is its map file's tile layers, read off disk by
    // every client. The collision grid that arrives over the wire is the
    // server's answer to a different question and is never drawn: a cell looks
    // like whatever the author painted there, and blocks because of which
    // LAYER it was painted on, and the two are allowed to have nothing to do
    // with each other. Nothing in here reads a Tile.
    if (map == nullptr || map->layers().empty()) return;

    const int cols = map->width();
    const int rows = map->height();
    if (cols <= 0 || rows <= 0) return;

    const std::vector<const SvgDocument*>& art = artFor(*map);
    if (art.empty()) return;

    // The cells whose artwork can reach the screen, and NOT ONE MORE. A cell
    // is drawn over exactly its own square, so the view itself is the whole
    // margin this wants. A kTileSize margin -- the reflex, and what this used
    // to ask for -- buys a whole extra ring of cells all the way round:
    // measured on a 1280x720 view of garden.tmj, 60 cells against 32, for
    // artwork that is off screen before it is drawn.
    const Rect visible = camera.visibleWorld(0);
    CellSpan span;
    span.x0 = std::max(0, static_cast<int>(std::floor(visible.left() / kTileSize)));
    span.y0 = std::max(0, static_cast<int>(std::floor(visible.top() / kTileSize)));
    span.x1 = std::min(cols - 1, static_cast<int>(std::floor(visible.right() / kTileSize)));
    span.y1 = std::min(rows - 1, static_cast<int>(std::floor(visible.bottom() / kTileSize)));
    if (span.x1 < span.x0 || span.y1 < span.y0) return;

    // The reader guarantees width*height cells on every layer, and the cell
    // loop indexes on that rather than going through the bounds-checked
    // cellAt() per tile per layer. Checked once here so a malformed map draws
    // a black realm instead of reading off the end of a layer.
    const std::size_t cellCount = static_cast<std::size_t>(cols) * static_cast<std::size_t>(rows);
    for (const TiledLayer& layer : map->layers()) {
        if (layer.cells.size() != cellCount) return;
    }

    if (terrainCache_ &&
        drawTerrainChunks(canvas, camera, *map, art, span.x0, span.y0, span.x1, span.y1)) {
        return;
    }

    // Device pixels per design unit: the base transform the frame was opened
    // with.
    const double toPixels = devicePixelsPerUnit(canvas);
    const double side = tileBakePixels(kTileSize * camera.zoom() * toPixels) / toPixels;
    paintTerrainCells(canvas, *map, art, span, side, [&](int tx, int ty) {
        const Vec2 corner = camera.worldToScreen({tx * kTileSize, ty * kTileSize});
        return Vec2{snapToPixel(corner.x, toPixels), snapToPixel(corner.y, toPixels)};
    });
}

void WorldRenderer::dropCanvasCaches() {
    dropTerrainChunks();
    radiationSprite_.reset();
    radiationLayer_.reset();
#ifdef __EMSCRIPTEN__
    glitchAtlas_ = GlitchAtlas{};
    glitchCells_.clear();
    glitchShelfX_ = glitchShelfY_ = glitchShelfRow_ = glitchShelfWidth_ = 0;
#else
    glitchBody_.reset();
    glitchSide_ = 0;
#endif
}

namespace {

/// Two device scales that are the same zoom: the ease's target and the frame's
/// zoom it lands on are the same product of the same factors, but a scale
/// worked out by a different route may differ in the last bit.
bool sameScale(double a, double b) { return a > 0.0 && b > 0.0 && std::abs(a / b - 1.0) < 1e-9; }

/// Cells along a chunk's side at `bakeScale` device pixels per world unit:
/// the most, by powers of two, that keep a chunk within kChunkPixels.
int chunkCellsAt(double bakeScale) {
    int cells = 1;
    while (cells < kMaxChunkCells && kTileSize * bakeScale * cells * 2.0 <= kChunkPixels) {
        cells *= 2;
    }
    return cells;
}

std::uint64_t chunkKey(int kx, int ky) {
    return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(ky)) << 32) |
           static_cast<std::uint32_t>(kx);
}

} // namespace

bool WorldRenderer::drawTerrainChunks(Canvas& canvas, const Camera& camera, const MapData& map,
                                      const std::vector<const SvgDocument*>& art, int x0,
                                      int y0, int x1, int y1) const {
    // Device pixels per design unit, off the live transform -- which has to
    // be the frame's own kind, one uniform scale and a translation. Under
    // anything else a chunk blitted onto whole device pixels would not land
    // where its tiles belong, and the caller paints them straight instead.
    const std::array<float, 6> m = canvas.currentTransform();
    const double toPixels = m[0];
    if (!(toPixels > 0.0) || m[1] != 0.0f || m[2] != 0.0f ||
        std::abs(static_cast<double>(m[3]) - toPixels) > 1e-6 * toPixels) {
        return false;
    }
    const double zoom = camera.zoom();
    // Device pixels per WORLD unit the frame is drawn at.
    const double scale = zoom * toPixels;
    if (!(scale > 0.0) || !std::isfinite(scale)) return false;

    // Three generations of chunks, each baked for this map at one scale:
    //
    //  * terrainChunks_, the one this frame is drawn from. At the frame's own
    //    scale when the zoom is still, so a chunk is blitted texel for pixel;
    //    at the ease's TARGET while antennae ease the zoom, and at nothing in
    //    between. Every frame of an ease is a new scale, and a generation per
    //    octave on the way (what this did before) baked a whole screen of
    //    chunks three or four times over in under a second -- on a weak GPU
    //    that was the lag of the animation -- and then once more at the exact
    //    scale when it ended. Baked at the target, nothing baked during the
    //    ease is thrown away, and the last frame of it is already exact.
    //  * terrainAhead_, baked ahead at the zoom the other loadout row would
    //    give, a chunk a frame while nothing else is baking. Pressing the
    //    row-swap key finds it ready, and the two trade places.
    //  * terrainStale_, the generation before the current one, kept to stand
    //    in for chunks not baked yet.
    //
    // While the target generation is drawn larger than it was baked -- the
    // first frames of zooming out, before the frame has shrunk to it -- the
    // generations finer than it are drawn over it wherever they have chunks,
    // so the middle of the screen, where the view was, stays sharp and only
    // the edges the ease is uncovering are softer, for a moment.
    const bool easing = zoomEasingTarget_ > 0.0;
    const double want = easing ? zoomEasingTarget_ * toPixels : scale;
    double aheadWant = anticipatedZoom_ > 0.0 ? anticipatedZoom_ * toPixels : 0.0;
    if (sameScale(aheadWant, want)) aheadWant = 0.0;

    // Another map's chunks are no use to this one.
    for (TerrainChunks* gen : {&terrainChunks_, &terrainAhead_, &terrainStale_}) {
        if (gen->map != nullptr && gen->map != &map) *gen = TerrainChunks{};
    }
    const auto holds = [&](const TerrainChunks& gen, double at) {
        return gen.map == &map && sameScale(gen.scale, at);
    };
    const auto fresh = [&](double at) {
        TerrainChunks gen;
        gen.map = &map;
        gen.scale = at;
        gen.cells = chunkCellsAt(at);
        return gen;
    };
    if (!holds(terrainChunks_, want)) {
        if (holds(terrainAhead_, want)) {
            std::swap(terrainChunks_, terrainAhead_);
        } else if (holds(terrainStale_, want)) {
            std::swap(terrainChunks_, terrainStale_);
        } else {
            // A new scale: the generation being left stands in for the new
            // one's chunks until they are baked.
            if (terrainChunks_.map == &map && !terrainChunks_.chunks.empty()) {
                terrainStale_ = std::move(terrainChunks_);
            }
            terrainChunks_ = fresh(want);
        }
    }
    if (aheadWant > 0.0 && !holds(terrainAhead_, aheadWant)) {
        if (holds(terrainStale_, aheadWant)) {
            std::swap(terrainAhead_, terrainStale_);
        } else {
            // What the ahead slot held is a stand-in at best; it keeps that
            // job if the stale slot has nothing better.
            if (terrainAhead_.map == &map && terrainAhead_.chunks.size() > terrainStale_.chunks.size()) {
                terrainStale_ = std::move(terrainAhead_);
            }
            terrainAhead_ = fresh(aheadWant);
        }
    }

    TerrainChunks& cache = terrainChunks_;
    const double bakeScale = cache.scale;
    const int cells = cache.cells;
    // Each chunk of the current generation is drawn this much smaller than
    // it was baked (above 1 while an ease zooming out draws it larger).
    const double shrink = scale / bakeScale;

    // Everything below is in device pixels, on one grid fixed to the WORLD
    // rather than to the camera: cell t's box runs from cornerAt(t) to
    // cornerAt(t + 1), and chunk k from the corner of its first cell to the
    // corner of the first cell past it. All whole pixels, so neighbouring
    // chunks meet exactly on a cell boundary, each chunk is blitted texel for
    // pixel, and moving the camera moves only `ox`/`oy` -- the world origin's
    // place on the screen, itself snapped to a whole pixel, which is how far
    // the direct path's per-tile snapping moved the map anyway. A rescaled
    // chunk (an ease) lands on whole pixels too, each edge rounded once and
    // shared with the neighbour, so the set still meets without a gap.
    const auto cornerFor = [](const TerrainChunks& gen, int t) {
        return std::round(t * kTileSize * gen.scale);
    };
    const auto screenCorner = [&](int t) { return std::round(t * kTileSize * scale); };
    const Vec2 origin = camera.worldToScreen({0.0, 0.0});
    const double ox = std::round(toPixels * origin.x + m[4]);
    const double oy = std::round(toPixels * origin.y + m[5]);

    const int cols = map.width();
    const int rows = map.height();
    TerrainChunks* const gens[] = {&terrainChunks_, &terrainAhead_, &terrainStale_};

    // Room for `bytes` more for `gen`: the stale generation goes first, any
    // chunk of it; then the ahead one's, least recently kept first -- any of
    // them for the current generation, which the frame needs and the ahead
    // one only might, but only ones not kept this frame for the ahead one
    // itself; then, for the current generation alone, its own least recently
    // drawn, and never one drawn this frame -- the set on screen is what the
    // cache is for, and evicting part of it to bake the rest would bake it
    // all again next frame. Baking ahead never takes the current generation's
    // room: on a screen too big for both, the view on screen keeps its chunks
    // and the ease paints what the ahead one could not hold.
    const auto heldBytes = [&] {
        std::size_t total = 0;
        for (const TerrainChunks* gen : gens) total += gen->bytes;
        return total;
    };
    const auto evictOldest = [&](TerrainChunks& gen, bool sparingThisFrame) {
        auto oldest = gen.chunks.end();
        for (auto it = gen.chunks.begin(); it != gen.chunks.end(); ++it) {
            if (sparingThisFrame && it->second.usedFrame == frame_) continue;
            if (oldest == gen.chunks.end() || it->second.usedFrame < oldest->second.usedFrame) {
                oldest = it;
            }
        }
        if (oldest == gen.chunks.end()) return false;
        gen.bytes -= oldest->second.bytes;
        gen.chunks.erase(oldest);
        return true;
    };
    const auto makeRoom = [&](const TerrainChunks& gen, std::size_t bytes) {
        const bool forAhead = &gen == &terrainAhead_;
        while (heldBytes() + bytes > kMaxChunkBytes) {
            if (evictOldest(terrainStale_, false)) continue;
            if (evictOldest(terrainAhead_, forAhead)) continue;
            if (!forAhead && evictOldest(terrainChunks_, true)) continue;
            return false;
        }
        return true;
    };

    // Bakes chunk (kx, ky) of `gen`. Its own cells and the ring round them
    // are painted: a cell's box ends on its boundary, but a little art does
    // not -- renderFitted only clips a picture that spills its viewBox by
    // more than 1%, and the foliage and hut edges reach a couple of pixels
    // past theirs. Painting the ring as well puts those pixels in the
    // chunk's edges, as the direct path does; without it each chunk boundary
    // would cut them off.
    int bakes = 0;
    int bakedCells = 0;
    const auto bake = [&](TerrainChunks& gen, int kx, int ky) {
        const int n = gen.cells;
        const double left = cornerFor(gen, kx * n);
        const double top = cornerFor(gen, ky * n);
        const int width = static_cast<int>(cornerFor(gen, (kx + 1) * n) - left);
        const int height = static_cast<int>(cornerFor(gen, (ky + 1) * n) - top);
        if (width <= 0 || height <= 0 || width > kMaxChunkSide || height > kMaxChunkSide) {
            return false;
        }
        const CellSpan region{std::max(0, kx * n - 1), std::max(0, ky * n - 1),
                              std::min(cols - 1, (kx + 1) * n), std::min(rows - 1, (ky + 1) * n)};
        const int area = (region.x1 - region.x0 + 1) * (region.y1 - region.y0 + 1);
        const bool inBudget = bakes == 0 || (bakes < kMaxChunkBakesPerFrame &&
                                             bakedCells + area <= kChunkBakeCellsPerFrame);
        const std::size_t bytes = static_cast<std::size_t>(width) * height * 4;
        if (!inBudget || !makeRoom(gen, bytes)) return false;
        Canvas bitmap = Canvas::createVirtual(width, height);
        const double side = tileBakePixels(kTileSize * gen.scale);
        paintTerrainCells(bitmap, map, art, region, side, [&](int tx, int ty) {
            return Vec2{cornerFor(gen, tx) - left, cornerFor(gen, ty) - top};
        });
        gen.chunks.emplace(chunkKey(kx, ky), TerrainChunk{std::move(bitmap), bytes, frame_});
        gen.bytes += bytes;
        ++bakes;
        bakedCells += area;
        return true;
    };

    // Blits chunk (kx, ky) of `gen` into its place on the frame: texel for
    // pixel on its own grid when it was baked at the frame's scale, into the
    // frame's grid rescaled otherwise.
    const auto blit = [&](const TerrainChunks& gen, int kx, int ky, const TerrainChunk& chunk) {
        const int n = gen.cells;
        if (gen.scale == scale) {
            canvas.drawCanvas(chunk.bitmap, static_cast<float>(ox + cornerFor(gen, kx * n)),
                              static_cast<float>(oy + cornerFor(gen, ky * n)));
            return;
        }
        const double sx0 = screenCorner(kx * n);
        const double sy0 = screenCorner(ky * n);
        const double sx1 = screenCorner((kx + 1) * n);
        const double sy1 = screenCorner((ky + 1) * n);
        if (!(sx1 > sx0) || !(sy1 > sy0)) return;
        canvas.drawCanvas(chunk.bitmap, static_cast<float>(ox + sx0), static_cast<float>(oy + sy0),
                          static_cast<float>(sx1 - sx0), static_cast<float>(sy1 - sy0));
    };

    // The chunks of the current generation on screen without a bitmap yet,
    // nearest the camera first. While an ease runs, only those inside the
    // view it ends at: zooming in, the rest of the screen is about to leave
    // it, and is drawn from the generation before meanwhile.
    const Vec2 centreTiles = camera.centre() * (1.0 / kTileSize);
    Rect endView{-1e300, -1e300, 2e300, 2e300};
    if (easing) {
        const double halfW = camera.viewportWidth() * 0.5 / zoomEasingTarget_;
        const double halfH = camera.viewportHeight() * 0.5 / zoomEasingTarget_;
        endView = Rect{camera.centre().x - halfW, camera.centre().y - halfH, halfW * 2, halfH * 2};
    }
    struct Missing {
        int kx, ky;
        double distance;
    };
    thread_local std::vector<Missing> missing;
    missing.clear();
    for (int ky = y0 / cells; ky <= y1 / cells; ++ky) {
        for (int kx = x0 / cells; kx <= x1 / cells; ++kx) {
            const auto found = cache.chunks.find(chunkKey(kx, ky));
            if (found != cache.chunks.end()) {
                found->second.usedFrame = frame_;
                continue;
            }
            const double wx0 = kx * cells * kTileSize, wy0 = ky * cells * kTileSize;
            const double wide = cells * kTileSize;
            if (wx0 > endView.right() || wx0 + wide < endView.left() || wy0 > endView.bottom() ||
                wy0 + wide < endView.top()) {
                continue;
            }
            const double dx = (kx + 0.5) * cells - centreTiles.x;
            const double dy = (ky + 0.5) * cells - centreTiles.y;
            missing.push_back(Missing{kx, ky, dx * dx + dy * dy});
        }
    }
    std::sort(missing.begin(), missing.end(),
              [](const Missing& a, const Missing& b) { return a.distance < b.distance; });
    for (const Missing& chunk : missing) {
        if (!bake(cache, chunk.kx, chunk.ky)) break;
    }

    canvas.save();
    canvas.setTransform(1, 0, 0, 1, 0, 0);
    // The chunks with no bitmap this frame, and the cells they span.
    struct Hole {
        Rect box;
        int c0, r0, c1, r1;
    };
    thread_local std::vector<Hole> holes;
    holes.clear();
    for (int ky = y0 / cells; ky <= y1 / cells; ++ky) {
        for (int kx = x0 / cells; kx <= x1 / cells; ++kx) {
            const auto found = cache.chunks.find(chunkKey(kx, ky));
            if (found != cache.chunks.end()) {
                found->second.usedFrame = frame_;
                blit(cache, kx, ky, found->second);
                continue;
            }
            const double sx0 = screenCorner(kx * cells);
            const double sy0 = screenCorner(ky * cells);
            const double sx1 = screenCorner((kx + 1) * cells);
            const double sy1 = screenCorner((ky + 1) * cells);
            if (!(sx1 > sx0) || !(sy1 > sy0)) continue;
            const int c0 = kx * cells, r0 = ky * cells;
            const int c1 = std::min(cols, (kx + 1) * cells) - 1;
            const int r1 = std::min(rows, (ky + 1) * cells) - 1;
            if (c1 < c0 || r1 < r0) continue;
            holes.push_back(Hole{Rect{ox + sx0, oy + sy0, sx1 - sx0, sy1 - sy0}, c0, r0, c1, r1});
        }
    }

    // The other generations, coarsest first, for standing in and drawing over.
    thread_local std::vector<const TerrainChunks*> others;
    others.clear();
    for (const TerrainChunks* gen : {&terrainAhead_, &terrainStale_}) {
        if (gen->map == &map && gen->cells > 0 && !gen->chunks.empty()) others.push_back(gen);
    }
    std::sort(others.begin(), others.end(),
              [](const TerrainChunks* a, const TerrainChunks* b) { return a->scale < b->scale; });

    if (!holes.empty()) {
        // A hole another generation has every chunk under is drawn from it,
        // rescaled; the rest are painted straight, clipped to them, on the
        // same grid and through the same painter as a bake, so a chunk looks
        // the same the frame before its bitmap arrives as after.
        const auto covers = [&](const TerrainChunks& gen, const Hole& hole) {
            for (int sy = hole.r0 / gen.cells; sy <= hole.r1 / gen.cells; ++sy) {
                for (int sx = hole.c0 / gen.cells; sx <= hole.c1 / gen.cells; ++sx) {
                    if (gen.chunks.find(chunkKey(sx, sy)) == gen.chunks.end()) return false;
                }
            }
            return true;
        };
        // Which generation stands in for each hole: the finest that covers it.
        thread_local std::vector<const TerrainChunks*> standIn;
        standIn.assign(holes.size(), nullptr);
        CellSpan straight{cols, rows, -1, -1};
        bool anyStraight = false;
        for (std::size_t h = 0; h < holes.size(); ++h) {
            for (const TerrainChunks* gen : others) {
                if (covers(*gen, holes[h])) standIn[h] = gen;
            }
            if (standIn[h] != nullptr) continue;
            anyStraight = true;
            straight.x0 = std::min(straight.x0, std::max(0, holes[h].c0 - 1));
            straight.y0 = std::min(straight.y0, std::max(0, holes[h].r0 - 1));
            straight.x1 = std::max(straight.x1, std::min(cols - 1, holes[h].c1 + 1));
            straight.y1 = std::max(straight.y1, std::min(rows - 1, holes[h].r1 + 1));
        }
        for (const TerrainChunks* gen : others) {
            bool any = false;
            for (std::size_t h = 0; h < holes.size() && !any; ++h) any = standIn[h] == gen;
            if (!any) continue;
            canvas.save();
            canvas.beginPath();
            for (std::size_t h = 0; h < holes.size(); ++h) {
                if (standIn[h] != gen) continue;
                const Rect& box = holes[h].box;
                canvas.rect(static_cast<float>(box.x), static_cast<float>(box.y),
                            static_cast<float>(box.w), static_cast<float>(box.h));
            }
            canvas.clip();
            thread_local std::vector<std::uint64_t> drawn;
            drawn.clear();
            for (std::size_t h = 0; h < holes.size(); ++h) {
                if (standIn[h] != gen) continue;
                const Hole& hole = holes[h];
                for (int sy = hole.r0 / gen->cells; sy <= hole.r1 / gen->cells; ++sy) {
                    for (int sx = hole.c0 / gen->cells; sx <= hole.c1 / gen->cells; ++sx) {
                        const std::uint64_t key = chunkKey(sx, sy);
                        if (std::find(drawn.begin(), drawn.end(), key) != drawn.end()) continue;
                        drawn.push_back(key);
                        const auto it = gen->chunks.find(key);
                        if (it != gen->chunks.end()) blit(*gen, sx, sy, it->second);
                    }
                }
            }
            canvas.restore();
        }
        if (anyStraight) {
            canvas.save();
            canvas.beginPath();
            for (std::size_t h = 0; h < holes.size(); ++h) {
                if (standIn[h] != nullptr) continue;
                const Rect& box = holes[h].box;
                canvas.rect(static_cast<float>(box.x), static_cast<float>(box.y),
                            static_cast<float>(box.w), static_cast<float>(box.h));
            }
            canvas.clip();
            const double straightSide = tileBakePixels(kTileSize * scale);
            paintTerrainCells(canvas, map, art, straight, straightSide, [&](int tx, int ty) {
                return Vec2{ox + screenCorner(tx), oy + screenCorner(ty)};
            });
            canvas.restore();
        }
    }

    // Zooming out, the target generation is drawn larger than it was baked
    // until the frame shrinks to it. A finer generation -- the one the ease
    // set out from -- still holds the middle of the screen at no more than
    // its own resolution, and goes over it there.
    if (shrink > 1.0 + 1e-9) {
        for (const TerrainChunks* gen : others) {
            if (!(gen->scale > bakeScale) || gen->scale < scale * (1.0 - 1e-9)) continue;
            const int n = gen->cells;
            for (int ky = y0 / n; ky <= y1 / n; ++ky) {
                for (int kx = x0 / n; kx <= x1 / n; ++kx) {
                    const auto it = gen->chunks.find(chunkKey(kx, ky));
                    if (it != gen->chunks.end()) blit(*gen, kx, ky, it->second);
                }
            }
        }
    }
    canvas.restore();

    // The generation ahead covers the view the other loadout row would give.
    // Its chunks there are kept, as the ones on screen are; and when the
    // frame baked nothing of its own, one more is baked, nearest the camera
    // first, so swapping to it finds it ready.
    TerrainChunks& ahead = terrainAhead_;
    if (aheadWant > 0.0 && holds(ahead, aheadWant)) {
        const double halfW = camera.viewportWidth() * 0.5 / anticipatedZoom_;
        const double halfH = camera.viewportHeight() * 0.5 / anticipatedZoom_;
        const Vec2 c = camera.centre();
        const int ax0 = std::max(0, static_cast<int>(std::floor((c.x - halfW) / kTileSize)));
        const int ay0 = std::max(0, static_cast<int>(std::floor((c.y - halfH) / kTileSize)));
        const int ax1 = std::min(cols - 1, static_cast<int>(std::floor((c.x + halfW) / kTileSize)));
        const int ay1 = std::min(rows - 1, static_cast<int>(std::floor((c.y + halfH) / kTileSize)));
        const int n = ahead.cells;
        int bestX = 0, bestY = 0;
        double best = -1.0;
        for (int ky = ay0 / n; ay1 >= ay0 && ky <= ay1 / n; ++ky) {
            for (int kx = ax0 / n; ax1 >= ax0 && kx <= ax1 / n; ++kx) {
                const auto it = ahead.chunks.find(chunkKey(kx, ky));
                if (it != ahead.chunks.end()) {
                    it->second.usedFrame = frame_;
                    continue;
                }
                const double dx = (kx + 0.5) * n - centreTiles.x;
                const double dy = (ky + 0.5) * n - centreTiles.y;
                const double d = dx * dx + dy * dy;
                if (best < 0.0 || d < best) {
                    best = d;
                    bestX = kx;
                    bestY = ky;
                }
            }
        }
        if (best >= 0.0 && !easing && bakes == 0) bake(ahead, bestX, bestY);
    }
    return true;
}

void WorldRenderer::terrainCacheStats(std::size_t& chunks, std::size_t& bytes) const {
    chunks = terrainChunks_.chunks.size() + terrainAhead_.chunks.size() +
             terrainStale_.chunks.size();
    bytes = terrainChunks_.bytes + terrainAhead_.bytes + terrainStale_.bytes;
}

} // namespace flix
