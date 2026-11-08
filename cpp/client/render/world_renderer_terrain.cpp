// The ground: tile layers painted cell by cell or through the baked chunk
// cache, the boundary blocks past a map's edge, and the generated floors of
// the maze, the arena and the waves disc.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
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

/// Every tile is drawn 1.5 units oversized on each side, so the software
/// rasteriser's anti-aliased edges never leave a hairline seam between two
/// cells of one continuous surface. Symmetric about the cell's centre, so a
/// tile that is turned by its flip bits stays registered with its neighbours.
constexpr double kTileOverlap = 1.5;

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

    // 1. Ground: the flat floor colour of the biome this maze borrows, over
    //    the maze's square. The maze is not authored in Tiled and has no map
    //    file, so it has no tile artwork to paint with -- terrain.h's kBiomes
    //    is the whole palette it has ever had a claim on, and one colour is
    //    right for it anyway: every cell of a maze is the same biome.
    const int section = kMazeBiomeSections[static_cast<std::size_t>(maze.biome())];
    {
        const Rect floor = intersection(visible, square);
        if (floor.w > 0 && floor.h > 0) {
            const Vec2 at = camera.worldToScreen({floor.x, floor.y});
            ui::setFill(canvas, biomeOf(section).ground);
            canvas.fillRect(static_cast<float>(at.x), static_cast<float>(at.y),
                            static_cast<float>(floor.w * camera.zoom()),
                            static_cast<float>(floor.h * camera.zoom()));
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

/// The side of every tile's box in DEVICE pixels, at `zoom` world units to
/// design units and `toPixels` design units to device pixels.
///
/// A WHOLE NUMBER of device pixels, and the same number for every tile.
///
/// Whole, because a tile's box edge that falls inside a pixel is covered
/// only fractionally, and a tile is a STACK of shapes: the background goes
/// down over the neighbour's finished picture at that fraction and the
/// shapes above it cannot put back what they covered, so a sliver of the
/// tile's own background survives as a hairline. It is faint -- a couple of
/// percent -- but it is at every boundary at once, which reads as a grid
/// ruled over the map. On a whole pixel the edge is covered or it is not,
/// and there is no fraction for the background to come through.
///
/// The same number for all of them, because the alternative -- snapping
/// each box's far edge as well -- makes neighbouring tiles differ in size
/// by a pixel, and the web build bakes a bitmap per size (art_cache.h): one
/// tile picture would occupy up to four entries instead of one. Only the
/// CORNER moves per tile, so the art is scaled identically everywhere and
/// the grid as a whole is quantised to the pixel it is drawn on.
///
/// And never less than a whole pixel past the next cell's corner. The
/// overlap is in WORLD units, so it shrinks with the camera, and a high
/// tier of antennae takes the camera out to 0.1 -- where 1.5 units is a
/// fifth of a pixel. Two neighbouring corners, each rounded on its own,
/// can then land a whole pixel further apart than `side` reaches, and that
/// pixel is the black the frame was cleared to: at every boundary where the
/// rounding falls that way, a grid of black lines a dozen tiles apart.
/// Corners one cell apart are never more than ceil(step) pixels apart, so
/// ceil(step) + 1 always overlaps. At any zoom where the overlap is a pixel
/// and a half or more -- every zoom short of those antennae -- the first
/// term is already the larger one and nothing moves.
double tileSidePixels(double zoom, double toPixels) {
    const double step = kTileSize * zoom * toPixels;
    return std::max(std::round((kTileSize + kTileOverlap * 2.0) * zoom * toPixels),
                    std::ceil(step) + 1.0);
}

/// Paints `span` of `map`'s tile layers. `corner(tx, ty)` is the top-left of
/// cell (tx, ty)'s oversized box in the canvas's user units, already on a
/// whole device pixel, and `side` is the box's side in the same units. The
/// direct path and the chunk cache both paint through here, so a baked chunk
/// is the very picture the direct path would have drawn in its place.
template <typename Corner>
void paintTerrainCells(Canvas& canvas, const MapData& map,
                       const std::vector<const SvgDocument*>& art, CellSpan span, double side,
                       const Corner& corner) {
    const int cols = map.width();
    const double half = side * 0.5;

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

    // One cell's artwork, fitted to its oversized square and turned by its flip
    // bits. The unturned case -- which is every cell of a hand-painted centre
    // and most of a map -- skips the transform entirely and draws into an
    // axis-aligned box, because a save/rotate/restore around a tile costs more
    // than the tile does.
    //
    // Both cases hand drawCachedArt the SAME box, and that is deliberate: what
    // the web build bakes is the tile UNTURNED, and the rotation is in the
    // canvas transform the blit goes through. So one bitmap serves all eight
    // orientations and the cache key needs no orientation in it. Baking the
    // turned picture instead would need the flip bits in that key -- without
    // them every rotation of one tile would collide on the first one baked,
    // and every edge tile in the map is painted as four rotations of one
    // picture.
    const auto drawCell = [&](const SvgDocument& document, int tx, int ty, std::uint8_t flags) {
        // The box's own corner, snapped. `side` is already whole pixels, so
        // the corner being on one puts all four edges on one -- and the
        // turned case takes its centre from here rather than from the cell's
        // own centre, so that both paths keep drawing the SAME box.
        const Vec2 at = corner(tx, ty);
        const double left = at.x;
        const double top = at.y;
        const TileOrientation orientation = tileOrientation(flags);
        if (orientation.radians == 0.0 && !orientation.mirror) {
            if (!drawCachedArt(canvas, document, left, top, side, side)) {
                document.renderFitted(canvas, static_cast<float>(left), static_cast<float>(top),
                                      static_cast<float>(side), static_cast<float>(side), 0.0f);
            }
            return;
        }
        canvas.save();
        canvas.translate(static_cast<float>(left + half), static_cast<float>(top + half));
        if (orientation.radians != 0.0) canvas.rotate(static_cast<float>(orientation.radians));
        if (orientation.mirror) canvas.scale(-1.0f, 1.0f);
        if (!drawCachedArt(canvas, document, -half, -half, side, side)) {
            document.renderFitted(canvas, static_cast<float>(-half), static_cast<float>(-half),
                                  static_cast<float>(side), static_cast<float>(side), 0.0f);
        }
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

    // Layer by layer, and NOT cell by cell. Every tile is painted kTileOverlap
    // oversized, so each one reaches 1.5 units into all four of its
    // neighbours; finishing a whole cell before starting the next one put a
    // cell's LOWER layer on top of the layer ABOVE it in the cell before,
    // which is the one thing the overlap cannot survive. Where an edge tile
    // sat next to any other dirt -- every run of wall edging on the map --
    // the grass under it was laid down after that neighbour's dirt and wiped
    // the overlap back off, leaving the two tiles meeting on a bare seam
    // again: a hairline of the layer below at exactly `boundary -
    // kTileOverlap`, an anti-aliased edge's worth of it, which is the
    // subpixel gap this order exists to close. Painting a layer across the
    // whole span before the next one starts is also what Tiled itself means
    // by a layer.
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

// Outside tiles repeat in small cached patches on the web. The patch stays
// near 512 logical pixels, so antennae zoom does not issue one blit per tiny
// block. Native rendering keeps the direct SVG path, like the terrain cache.
void drawBoundaryBlocks(Canvas& canvas,const Camera& camera,const SvgDocument* art,int cols,int rows) {
    if(cols<=0||rows<=0)return;
    const Rect view=camera.visibleWorld(kTileOverlap);
    const double width=cols*kTileSize,height=rows*kTileSize;
    const int cells=std::clamp(int(512/(kTileSize*camera.zoom())),1,16);
    const double worldSide=cells*kTileSize,side=worldSide*camera.zoom();
    static const int fallbackIdentity=0;
    const void* owner=art?static_cast<const void*>(art):&fallbackIdentity;
    const auto patch=[&](Canvas& c) {
        const float step=float(side/cells),overlap=float(kTileOverlap*camera.zoom());
        for(int y=0;y<cells;++y)for(int x=0;x<cells;++x) {
            if(art)art->renderFitted(c,x*step-overlap,y*step-overlap,step+2*overlap,step+2*overlap,0);
            else {ui::setFill(c,0x555555u);c.fillRect(x*step,y*step,step,step);}
        }
    };
    const auto strip=[&](double left,double top,double right,double bottom) {
        left=std::max(left,view.left());top=std::max(top,view.top());
        right=std::min(right,view.right());bottom=std::min(bottom,view.bottom());
        if(left>=right||top>=bottom)return;
        const Vec2 a=camera.worldToScreen({left,top}),b=camera.worldToScreen({right,bottom});
        canvas.save();canvas.beginPath();canvas.rect(a.x,a.y,b.x-a.x,b.y-a.y);canvas.clip();
        for(int y=int(std::floor(top/worldSide));y<int(std::ceil(bottom/worldSide));++y)
            for(int x=int(std::floor(left/worldSide));x<int(std::ceil(right/worldSide));++x) {
                const Vec2 at=camera.worldToScreen({x*worldSide,y*worldSide});
                if(!drawCachedPicture(canvas,owner,0xB10C0000u+cells,at.x,at.y,side,side,patch)) {
                    canvas.save();canvas.translate(at.x,at.y);patch(canvas);canvas.restore();
                }
            }
        canvas.restore();
    };
    strip(view.left(),view.top(),view.right(),0);
    strip(view.left(),height,view.right(),view.bottom());
    strip(view.left(),0,0,height);
    strip(width,0,view.right(),height);
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
        const Rect visible = intersection(camera.visibleWorld(kTileOverlap),
                                          Rect{kWavesCentre.x - reach, kWavesCentre.y - reach,
                                               reach * 2.0, reach * 2.0});
        const double originX = kWavesCentre.x - kWavesMaxRadius * 2.0;
        const double originY = kWavesCentre.y - kWavesMaxRadius * 2.0;
        if (visible.w > 0 && visible.h > 0) {
            const int x0 = static_cast<int>(std::floor((visible.left() - originX) / kWaveTileSize));
            const int y0 = static_cast<int>(std::floor((visible.top() - originY) / kWaveTileSize));
            const int x1 = static_cast<int>(std::floor((visible.right() - originX) / kWaveTileSize));
            const int y1 = static_cast<int>(std::floor((visible.bottom() - originY) / kWaveTileSize));
            const auto side = static_cast<float>((kWaveTileSize + 2.0 * kTileOverlap) * camera.zoom());
            for (int y = y0; y <= y1; ++y) {
                for (int x = x0; x <= x1; ++x) {
                    const Vec2 at = camera.worldToScreen({originX + x * kWaveTileSize - kTileOverlap,
                                                          originY + y * kWaveTileSize - kTileOverlap});
                    if (!drawCachedArt(canvas, *art, at.x, at.y, side, side)) {
                        art->renderFitted(canvas, at.x, at.y, side, side, 0);
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
        const Rect visible = camera.visibleWorld(kTileOverlap);
        const int x0 = std::max(0,int(std::floor(visible.left()/kTileSize)));
        const int y0 = std::max(0,int(std::floor(visible.top()/kTileSize)));
        const int x1 = std::min(terrain_->tileCols(realm)-1,int(std::floor(visible.right()/kTileSize)));
        const int y1 = std::min(terrain_->tileRows(realm)-1,int(std::floor(visible.bottom()/kTileSize)));
        const auto* floorArt = sprites_ ? sprites_->tileArt(floor.floor) : nullptr;
        const auto* wallArt = sprites_ ? sprites_->tileArt(wall.wall) : nullptr;
        drawBoundaryBlocks(canvas,camera,wallArt,terrain_->tileCols(realm),terrain_->tileRows(realm));
        const float side = float((kTileSize+2*kTileOverlap)*camera.zoom());
        for (int y=y0;y<=y1;++y) for(int x=x0;x<=x1;++x) {
            const bool solid = terrain_->atTile(x,y,realm) == Tile::Solid;
            const auto* art = solid ? wallArt : floorArt;
            const Vec2 at = camera.worldToScreen({x*kTileSize-kTileOverlap,y*kTileSize-kTileOverlap});
            if (art) {
                if (!drawCachedArt(canvas,*art,at.x,at.y,side,side)) art->renderFitted(canvas,at.x,at.y,side,side,0);
            } else if (solid) { ui::setFill(canvas,0x555555u); canvas.fillRect(at.x,at.y,side,side); }
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

    // The cells whose artwork can reach the screen, and NOT ONE MORE. A cell
    // is drawn over exactly its own square grown by kTileOverlap, so that
    // overlap is the whole margin this wants. A kTileSize margin -- the
    // reflex, and what this used to ask for -- buys a whole extra ring of
    // cells all the way round: measured on a 1280x720 view of garden.tmj,
    // 60 cells against 32, for artwork that is off screen before it is
    // drawn.
    const Rect visible = camera.visibleWorld(kTileOverlap);
    CellSpan span;
    span.x0 = std::max(0, static_cast<int>(std::floor(visible.left() / kTileSize)));
    span.y0 = std::max(0, static_cast<int>(std::floor(visible.top() / kTileSize)));
    span.x1 = std::min(cols - 1, static_cast<int>(std::floor(visible.right() / kTileSize)));
    span.y1 = std::min(rows - 1, static_cast<int>(std::floor(visible.bottom() / kTileSize)));
    if (span.x1 < span.x0 || span.y1 < span.y0) return;

    const std::vector<const SvgDocument*>& art = artFor(*map);
    if (art.empty()) return;

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

    const double zoom = camera.zoom();
    // Device pixels per design unit: the base transform the frame was opened
    // with, read back off the canvas the way the tile cache reads it.
    const double logical = canvas.width() > 0 ? static_cast<double>(canvas.width()) : 1.0;
    const double perUnit = static_cast<double>(canvas.pixelWidth()) / logical;
    const double toPixels = perUnit > 0.0 ? perUnit : 1.0;
    const double side = tileSidePixels(zoom, toPixels) / toPixels;
    paintTerrainCells(canvas, *map, art, span, side, [&](int tx, int ty) {
        const Vec2 corner = camera.worldToScreen(
            {tx * kTileSize - kTileOverlap, ty * kTileSize - kTileOverlap});
        return Vec2{std::round(corner.x * toPixels) / toPixels,
                    std::round(corner.y * toPixels) / toPixels};
    });
}

void WorldRenderer::dropCanvasCaches() {
    terrainChunks_ = TerrainChunks{};
#ifdef __EMSCRIPTEN__
    glitchAtlas_ = GlitchAtlas{};
    glitchCells_.clear();
    glitchShelfX_ = glitchShelfY_ = glitchShelfRow_ = glitchShelfWidth_ = 0;
#else
    glitchBody_.reset();
    glitchSide_ = 0;
#endif
}

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
    // Device pixels per WORLD unit: what a chunk is baked at, and the one
    // number every chunk in the cache shares.
    const double scale = zoom * toPixels;
    if (!(scale > 0.0) || !std::isfinite(scale)) return false;
    const double side = tileSidePixels(zoom, toPixels);
    int cells = 1;
    while (cells < kMaxChunkCells && kTileSize * scale * cells * 2.0 <= kChunkPixels) cells *= 2;

    // A new map, zoom or display scale makes every chunk the wrong picture.
    TerrainChunks& cache = terrainChunks_;
    if (cache.map != &map || cache.scale != scale || cache.cells != cells) {
        cache = TerrainChunks{};
        cache.map = &map;
        cache.scale = scale;
        cache.cells = cells;
    }

    // Everything below is in device pixels, on one grid fixed to the WORLD
    // rather than to the camera: chunk k spans grid(k) to grid(k + 1), and a
    // cell's box corner is its own corner rounded on that same grid. Both are
    // whole pixels, so neighbouring chunks meet exactly, each chunk is blitted
    // texel for pixel, and moving the camera moves only `ox`/`oy` -- the world
    // origin's place on the screen, itself snapped to a whole pixel, which is
    // how far the direct path's per-tile snapping moved the map anyway.
    const double chunkWorld = kTileSize * cells;
    const auto grid = [&](int k) { return std::round(k * chunkWorld * scale); };
    const auto cornerAt = [&](int t) { return std::round((t * kTileSize - kTileOverlap) * scale); };
    const Vec2 origin = camera.worldToScreen({0.0, 0.0});
    const double ox = std::round(toPixels * origin.x + m[4]);
    const double oy = std::round(toPixels * origin.y + m[5]);

    // Least recently drawn first, and never one drawn this frame: the set on
    // screen is what the cache is for, and evicting part of it to bake the
    // rest would bake it all again next frame.
    const auto makeRoom = [&](std::size_t bytes) {
        while (cache.bytes + bytes > kMaxChunkBytes) {
            auto oldest = cache.chunks.end();
            for (auto it = cache.chunks.begin(); it != cache.chunks.end(); ++it) {
                if (it->second.usedFrame == frame_) continue;
                if (oldest == cache.chunks.end() ||
                    it->second.usedFrame < oldest->second.usedFrame) {
                    oldest = it;
                }
            }
            if (oldest == cache.chunks.end()) return false;
            cache.bytes -= oldest->second.bytes;
            cache.chunks.erase(oldest);
        }
        return true;
    };

    const int cols = map.width();
    const int rows = map.height();
    canvas.save();
    canvas.setTransform(1, 0, 0, 1, 0, 0);
    int bakes = 0;
    int bakedCells = 0;
    // The chunks with no bitmap this frame, and the cells that reach them.
    thread_local std::vector<Rect> holes;
    holes.clear();
    CellSpan straight{cols, rows, -1, -1};
    for (int ky = y0 / cells; ky <= y1 / cells; ++ky) {
        const double top = grid(ky);
        const int height = static_cast<int>(grid(ky + 1) - top);
        for (int kx = x0 / cells; kx <= x1 / cells; ++kx) {
            const double left = grid(kx);
            const int width = static_cast<int>(grid(kx + 1) - left);
            if (width <= 0 || height <= 0) continue;
            // The chunk's own cells and the ring round them. Every tile is
            // painted kTileOverlap oversized, so the cells either side reach
            // into the chunk's edges, and only painting them here as well --
            // in the same layer-major order -- puts the same pixels in those
            // edges that the direct path does. Without them each chunk
            // boundary would be a seam of exactly the kind
            // paintTerrainCells' order exists to close.
            const CellSpan region{std::max(0, kx * cells - 1), std::max(0, ky * cells - 1),
                                  std::min(cols - 1, (kx + 1) * cells),
                                  std::min(rows - 1, (ky + 1) * cells)};
            const std::uint64_t key =
                (static_cast<std::uint64_t>(ky) << 32) | static_cast<std::uint32_t>(kx);
            auto found = cache.chunks.find(key);
            if (found == cache.chunks.end()) {
                const int area = (region.x1 - region.x0 + 1) * (region.y1 - region.y0 + 1);
                const std::size_t bytes = static_cast<std::size_t>(width) * height * 4;
                const bool inBudget =
                    bakes == 0 ||
                    (bakes < kMaxChunkBakesPerFrame && bakedCells + area <= kChunkBakeCellsPerFrame);
                if (inBudget && width <= kMaxChunkSide && height <= kMaxChunkSide &&
                    makeRoom(bytes)) {
                    Canvas bitmap = Canvas::createVirtual(width, height);
                    paintTerrainCells(bitmap, map, art, region, side, [&](int tx, int ty) {
                        return Vec2{cornerAt(tx) - left, cornerAt(ty) - top};
                    });
                    found = cache.chunks.emplace(key, TerrainChunk{std::move(bitmap), bytes, 0})
                                .first;
                    cache.bytes += bytes;
                    ++bakes;
                    bakedCells += area;
                }
            }
            if (found != cache.chunks.end()) {
                found->second.usedFrame = frame_;
                canvas.drawCanvas(found->second.bitmap, static_cast<float>(ox + left),
                                  static_cast<float>(oy + top));
                continue;
            }
            holes.push_back(Rect{ox + left, oy + top, static_cast<double>(width),
                                 static_cast<double>(height)});
            straight.x0 = std::min(straight.x0, region.x0);
            straight.y0 = std::min(straight.y0, region.y0);
            straight.x1 = std::max(straight.x1, region.x1);
            straight.y1 = std::max(straight.y1, region.y1);
        }
    }
    // The chunks still waiting for a bake, in one straight paint clipped to
    // them. On the same grid and through the same painter as a bake, so a
    // chunk looks the same the frame before its bitmap arrives as after.
    if (!holes.empty()) {
        canvas.beginPath();
        for (const Rect& hole : holes) {
            canvas.rect(static_cast<float>(hole.x), static_cast<float>(hole.y),
                        static_cast<float>(hole.w), static_cast<float>(hole.h));
        }
        canvas.clip();
        paintTerrainCells(canvas, map, art, straight, side, [&](int tx, int ty) {
            return Vec2{ox + cornerAt(tx), oy + cornerAt(ty)};
        });
    }
    canvas.restore();
    return true;
}

void WorldRenderer::terrainCacheStats(std::size_t& chunks, std::size_t& bytes) const {
    chunks = terrainChunks_.chunks.size();
    bytes = terrainChunks_.bytes;
}

} // namespace flix
