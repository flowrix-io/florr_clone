#include "shared/game/terrain.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdlib>
#include <deque>
#include <limits>

namespace flr {
namespace {

constexpr int kAxis = kTilesPerAxis;
constexpr int kTotalTiles = kAxis * kAxis;

constexpr int kNeighborDx[4] = {1, -1, 0, 0};
constexpr int kNeighborDy[4] = {0, 0, 1, -1};

/// Value noise on a coarse lattice, sampled in TILE units.
///
/// Lattice noise rather than a per-tile hash because the map needs blobs, not
/// static: a hash gives every tile an independent roll, which reads as gravel
/// and walls nothing off in an interesting shape.
class ValueNoise {
public:
    ValueNoise(Rng& rng, int cellTiles)
        : cell_(std::max(1, cellTiles)), dim_(kAxis / std::max(1, cellTiles) + 3) {
        values_.resize(static_cast<std::size_t>(dim_) * static_cast<std::size_t>(dim_));
        for (double& v : values_) v = rng.unit();
    }

    double at(double tx, double ty) const {
        const double fx = tx / cell_;
        const double fy = ty / cell_;
        const double bx = std::floor(fx);
        const double by = std::floor(fy);
        // Weights come from the unclamped fraction, indices from the clamped
        // lattice cell, so a sample past the edge stays continuous.
        const double sx = smoothstep(fx - bx);
        const double sy = smoothstep(fy - by);
        const int x0 = clamp(static_cast<int>(bx), 0, dim_ - 2);
        const int y0 = clamp(static_cast<int>(by), 0, dim_ - 2);
        const double a = value(x0, y0);
        const double b = value(x0 + 1, y0);
        const double c = value(x0, y0 + 1);
        const double d = value(x0 + 1, y0 + 1);
        return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
    }

private:
    static double smoothstep(double t) { return t * t * (3.0 - 2.0 * t); }
    double value(int x, int y) const {
        return values_[static_cast<std::size_t>(y) * static_cast<std::size_t>(dim_) + static_cast<std::size_t>(x)];
    }

    int cell_;
    int dim_;
    std::vector<double> values_;
};

/// The noise the whole map is cut from. One shared set rather than one per
/// biome, so features line up across a section boundary instead of stopping
/// dead on it -- a river runs out of the Garden and into the Ocean.
struct NoiseSet {
    explicit NoiseSet(Rng& rng)
        : coarse(rng, 24), medium(rng, 10), fine(rng, 4), altCoarse(rng, 14), altMedium(rng, 6) {}

    double fbm(double tx, double ty) const {
        return 0.55 * medium.at(tx, ty) + 0.30 * fine.at(tx, ty) + 0.15 * coarse.at(tx, ty);
    }

    ValueNoise coarse, medium, fine, altCoarse, altMedium;
};

/// Distance from a noise field's 0.5 level set, which draws winding lines
/// (rivers, ridges, streams) instead of blobs.
inline double ridge(double n) { return std::fabs(n - 0.5); }

inline int wrapMod(int v, int m) { return ((v % m) + m) % m; }

Tile classifyGarden(int tx, int ty, const NoiseSet& n) {
    if (n.altMedium.at(tx, ty) > 0.84) return Tile::Wall;      // boulders
    if (n.medium.at(tx, ty) > 0.80) return Tile::Water;        // ponds
    if (n.fine.at(tx, ty) > 0.74) return Tile::Sand;           // worn paths
    return Tile::Ground;
}

Tile classifyDesert(int tx, int ty, const NoiseSet& n) {
    if (n.medium.at(tx, ty) > 0.80) return Tile::Wall;         // mesas
    if (n.altCoarse.at(tx, ty) < 0.07) return Tile::Water;     // oases
    if (n.fine.at(tx, ty) > 0.80) return Tile::Stone;
    return Tile::Sand;
}

Tile classifyHel(int tx, int ty, const NoiseSet& n) {
    if (ridge(n.medium.at(tx, ty)) < 0.035) return Tile::Wall; // basalt ridges
    if (n.altCoarse.at(tx, ty) > 0.78) return Tile::Water;     // lava: passable, slow
    return Tile::Stone;
}

Tile classifyOcean(int tx, int ty, const NoiseSet& n) {
    const double height = 0.6 * n.coarse.at(tx, ty) + 0.4 * n.medium.at(tx, ty);
    if (height > 0.70) return Tile::Ground;                    // island interior
    if (height > 0.60) return Tile::Sand;                      // beach
    if (height < 0.20 && n.altMedium.at(tx, ty) > 0.86) return Tile::Wall;  // spires
    return Tile::Water;
}

Tile classifyJungle(int tx, int ty, const NoiseSet& n) {
    const double canopy = 0.55 * n.medium.at(tx, ty) + 0.45 * n.fine.at(tx, ty);
    if (canopy > 0.66) return Tile::Wall;                      // dense trees
    if (ridge(n.altMedium.at(tx, ty)) < 0.025) return Tile::Water;  // streams
    return Tile::Ground;
}

Tile classifySewers(int tx, int ty, const NoiseSet& n) {
    // A rectilinear lane grid, deliberately unlike everything around it. The
    // lanes are laid out by construction rather than by noise, so the section
    // is connected before the repair pass ever looks at it.
    const int mx = wrapMod(tx, 7);
    const int my = wrapMod(ty, 7);
    const bool lane = mx < 3 || my < 3;
    if (!lane) return Tile::Wall;
    if (n.fine.at(tx, ty) > 0.90) return Tile::Wall;           // collapsed rubble
    if (mx == 1 || my == 1) return Tile::Water;                // the channel itself
    return Tile::Stone;                                        // the ledges beside it
}

Tile classifyComputer(int tx, int ty, const NoiseSet&) {
    // Circuit board: a lattice of trace lanes with board substrate between.
    // Chips (walls) are stamped later, inside the cells, never on a lane.
    if (wrapMod(tx, 9) == 0 || wrapMod(ty, 9) == 0) return Tile::Ground;
    return Tile::Stone;
}

Tile classifyUnknown(int tx, int ty, const NoiseSet& n) {
    const double v = n.fbm(tx, ty);
    if (v > 0.70) return Tile::Wall;
    if (v < 0.24) return Tile::Water;                          // voids
    if (n.altCoarse.at(tx, ty) > 0.62) return Tile::Stone;
    return Tile::Ground;
}

Tile classifyTile(int section, int tx, int ty, const NoiseSet& n) {
    switch (section) {
        case 0: return classifyGarden(tx, ty, n);
        case 1: return classifyDesert(tx, ty, n);
        case 2: return classifyHel(tx, ty, n);
        case 3: return classifyOcean(tx, ty, n);
        // Ant Hell starts solid; carveAntHell() digs the chambers out of it.
        case 4: return Tile::Wall;
        case 5: return classifyJungle(tx, ty, n);
        case 6: return classifySewers(tx, ty, n);
        case 7: return classifyComputer(tx, ty, n);
        case 8: return classifyUnknown(tx, ty, n);
        default: return Tile::Wall;
    }
}

} // namespace

// ---------------------------------------------------------------------------
// Construction and generation
// ---------------------------------------------------------------------------

Terrain::Terrain()
    : tiles_(static_cast<std::size_t>(kTotalTiles), static_cast<std::uint8_t>(Tile::Ground)),
      spawnTile_(index(kAxis / 2, kAxis / 2)) {}

Vec2 Terrain::spawnPoint() const {
    return tileCenter(spawnTile_ % kAxis, spawnTile_ / kAxis);
}

void Terrain::setTile(int tx, int ty, Tile t) {
    if (tx < 0 || ty < 0 || tx >= kAxis || ty >= kAxis) return;
    tiles_[static_cast<std::size_t>(index(tx, ty))] = static_cast<std::uint8_t>(t);
}

void Terrain::fill(Tile t) {
    std::fill(tiles_.begin(), tiles_.end(), static_cast<std::uint8_t>(t));
}

void Terrain::generate(std::uint64_t seed) {
    seed_ = seed;
    Rng rng(seed);

    // Draw order is the reproducibility contract: every rng consumer below
    // runs exactly once, in this order, for any seed.
    generateSections(rng);
    carveAntHell(rng);
    placeCircuitChips(rng);

    // Players start in the Garden, not at the world centre.
    //
    // The centre section is the Ant Hell, which generates solid and is dug out
    // into a tunnel network -- an interesting place to raid and a hostile place
    // to be dropped into with a single Basic petal. The Garden is where the
    // starter mobs live (bee and ladybug both list section 0 in mobs.json), so
    // that is where a new flower belongs.
    spawnTile_ = chooseGardenSpawn();
    connectAll();
    assert(isConnected());
}

void Terrain::generateSections(Rng& rng) {
    const NoiseSet noise(rng);
    for (int ty = 0; ty < kAxis; ++ty) {
        for (int tx = 0; tx < kAxis; ++tx) {
            const int section = flr::sectionAt(tileCenter(tx, ty));
            tiles_[static_cast<std::size_t>(index(tx, ty))] =
                static_cast<std::uint8_t>(classifyTile(section, tx, ty, noise));
        }
    }
}

/// An open tile near the middle of the Garden section, searched outward so the
/// result is the closest walkable spot to the section's centre rather than the
/// first one in scan order.
int Terrain::chooseGardenSpawn() const {
    const int perSection = kAxis / kSectionsPerAxis;
    const int centreTx = perSection / 2;
    const int centreTy = perSection / 2;

    for (int radius = 0; radius < perSection; ++radius) {
        for (int dy = -radius; dy <= radius; ++dy) {
            for (int dx = -radius; dx <= radius; ++dx) {
                // Only the ring at this radius; the interior was covered already.
                if (std::max(std::abs(dx), std::abs(dy)) != radius) continue;
                const int tx = centreTx + dx;
                const int ty = centreTy + dy;
                if (tx < 0 || ty < 0 || tx >= perSection || ty >= perSection) continue;
                if (atTile(tx, ty) == Tile::Ground) return index(tx, ty);
            }
        }
    }
    // The Garden is noise-generated and always has ground, but if it somehow
    // did not, the centre is still a defined tile and connectAll() will open it.
    return index(centreTx, centreTy);
}

void Terrain::carveDisc(Vec2 center, double radius, Tile t) {
    const int x0 = clamp(toTileCoord(center.x - radius), 0, kAxis - 1);
    const int x1 = clamp(toTileCoord(center.x + radius), 0, kAxis - 1);
    const int y0 = clamp(toTileCoord(center.y - radius), 0, kAxis - 1);
    const int y1 = clamp(toTileCoord(center.y + radius), 0, kAxis - 1);
    const double r2 = radius * radius;
    for (int ty = y0; ty <= y1; ++ty) {
        for (int tx = x0; tx <= x1; ++tx) {
            if (distanceSq(tileCenter(tx, ty), center) <= r2) setTile(tx, ty, t);
        }
    }
}

void Terrain::carveCorridor(int fromTx, int fromTy, int toTx, int toTy, int halfWidth, Tile t) {
    const int stepX = toTx >= fromTx ? 1 : -1;
    const int stepY = toTy >= fromTy ? 1 : -1;
    auto brush = [&](int cx, int cy) {
        for (int dy = -halfWidth; dy <= halfWidth; ++dy) {
            for (int dx = -halfWidth; dx <= halfWidth; ++dx) setTile(cx + dx, cy + dy, t);
        }
    };
    // An L, not a diagonal: a diagonal staircase leaves single-tile pinch
    // points that a body wider than a tile cannot squeeze through.
    for (int x = fromTx; x != toTx + stepX; x += stepX) brush(x, fromTy);
    for (int y = fromTy; y != toTy + stepY; y += stepY) brush(toTx, y);
}

void Terrain::carveAntHell(Rng& rng) {
    const Vec2 center{kWorldHalf, kWorldHalf};
    const int centerTx = toTileCoord(center.x);
    const int centerTy = toTileCoord(center.y);

    // The spawn plaza. Everything in the map hangs off this being open.
    carveDisc(center, kTileSize * 5.0, Tile::Ground);

    // Four tunnels out of the section, ending a couple of tiles beyond its
    // edge so they meet whatever the neighbouring biome generated. Without
    // these the repair pass would still connect the hill, but by one ragged
    // corridor instead of four deliberate gates.
    const int reach = static_cast<int>(kSectionSize / kTileSize) / 2 + 3;
    carveCorridor(centerTx, centerTy, centerTx - reach, centerTy, 1, Tile::Ground);
    carveCorridor(centerTx, centerTy, centerTx + reach, centerTy, 1, Tile::Ground);
    carveCorridor(centerTx, centerTy, centerTx, centerTy - reach, 1, Tile::Ground);
    carveCorridor(centerTx, centerTy, centerTx, centerTy + reach, 1, Tile::Ground);

    const int inset = 6;
    const int lo = centerTx - reach + inset;
    const int hi = centerTx + reach - inset;

    int prevTx = centerTx;
    int prevTy = centerTy;
    for (int i = 0; i < 16; ++i) {
        const int cx = rng.rangeInt(lo, hi);
        const int cy = rng.rangeInt(lo, hi);
        const double radius = kTileSize * rng.range(2.0, 5.0);
        carveDisc(tileCenter(cx, cy), radius, Tile::Ground);
        carveCorridor(prevTx, prevTy, cx, cy, 1, Tile::Ground);
        prevTx = cx;
        prevTy = cy;
    }
}

void Terrain::placeCircuitChips(Rng& rng) {
    // Chips sit strictly inside a lattice cell, so the trace lanes stay clear
    // and the section is connected without any repair.
    for (int cellY = 0; cellY + 9 <= kAxis; cellY += 9) {
        for (int cellX = 0; cellX + 9 <= kAxis; cellX += 9) {
            if (flr::sectionAt(tileCenter(cellX + 4, cellY + 4)) != 7) continue;
            if (!rng.chance(0.55)) continue;
            const int size = rng.rangeInt(3, 5);
            const int ox = cellX + 2;
            const int oy = cellY + 2;
            for (int y = 0; y < size; ++y) {
                for (int x = 0; x < size; ++x) setTile(ox + x, oy + y, Tile::Wall);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

int Terrain::openTileCount() const {
    int n = 0;
    for (int i = 0; i < kTotalTiles; ++i) {
        if (passableIndex(i)) ++n;
    }
    return n;
}

bool Terrain::isConnected() const {
    const int open = openTileCount();
    if (!passableIndex(spawnTile_)) return open == 0;

    std::vector<std::uint8_t> seen(static_cast<std::size_t>(kTotalTiles), 0);
    std::vector<int> stack;
    stack.reserve(256);
    stack.push_back(spawnTile_);
    seen[static_cast<std::size_t>(spawnTile_)] = 1;
    int reached = 0;
    while (!stack.empty()) {
        const int cur = stack.back();
        stack.pop_back();
        ++reached;
        const int cx = cur % kAxis;
        const int cy = cur / kAxis;
        for (int d = 0; d < 4; ++d) {
            const int nx = cx + kNeighborDx[d];
            const int ny = cy + kNeighborDy[d];
            if (nx < 0 || ny < 0 || nx >= kAxis || ny >= kAxis) continue;
            const int ni = index(nx, ny);
            if (seen[static_cast<std::size_t>(ni)] || !passableIndex(ni)) continue;
            seen[static_cast<std::size_t>(ni)] = 1;
            stack.push_back(ni);
        }
    }
    return reached == open;
}

void Terrain::connectAll() {
    // 0-1 BFS from the spawn over the WHOLE grid: stepping onto an open tile
    // costs nothing, stepping into a wall costs one. dist == 0 therefore means
    // "reachable without digging", and the parent chain of any other tile is
    // the cheapest route to dig for it.
    constexpr std::int32_t kUnreached = std::numeric_limits<std::int32_t>::max();
    std::vector<std::int32_t> dist(static_cast<std::size_t>(kTotalTiles), kUnreached);
    std::vector<std::int32_t> parent(static_cast<std::size_t>(kTotalTiles), -1);
    std::vector<std::uint8_t> settled(static_cast<std::size_t>(kTotalTiles), 0);

    std::deque<std::int32_t> queue;
    dist[static_cast<std::size_t>(spawnTile_)] = 0;
    queue.push_back(spawnTile_);
    while (!queue.empty()) {
        const std::int32_t cur = queue.front();
        queue.pop_front();
        if (settled[static_cast<std::size_t>(cur)]) continue;
        settled[static_cast<std::size_t>(cur)] = 1;
        const int cx = cur % kAxis;
        const int cy = cur / kAxis;
        for (int d = 0; d < 4; ++d) {
            const int nx = cx + kNeighborDx[d];
            const int ny = cy + kNeighborDy[d];
            if (nx < 0 || ny < 0 || nx >= kAxis || ny >= kAxis) continue;
            const std::int32_t ni = index(nx, ny);
            if (settled[static_cast<std::size_t>(ni)]) continue;
            const std::int32_t cost = passableIndex(ni) ? 0 : 1;
            const std::int32_t candidate = dist[static_cast<std::size_t>(cur)] + cost;
            if (candidate < dist[static_cast<std::size_t>(ni)]) {
                dist[static_cast<std::size_t>(ni)] = candidate;
                parent[static_cast<std::size_t>(ni)] = cur;
                if (cost == 0) queue.push_front(ni);
                else queue.push_back(ni);
            }
        }
    }

    std::vector<std::int32_t> stack;
    stack.reserve(256);
    for (std::int32_t t = 0; t < kTotalTiles; ++t) {
        if (!passableIndex(t) || dist[static_cast<std::size_t>(t)] == 0) continue;

        for (std::int32_t cur = t; cur >= 0 && dist[static_cast<std::size_t>(cur)] != 0;
             cur = parent[static_cast<std::size_t>(cur)]) {
            if (!passableIndex(cur)) tiles_[static_cast<std::size_t>(cur)] = static_cast<std::uint8_t>(Tile::Ground);
        }

        // The corridor joined t's whole region to the spawn's, so flood the
        // region and mark it reached. Without this every tile of a walled-off
        // lake would dig its own corridor, and the repair would be quadratic.
        stack.clear();
        stack.push_back(t);
        dist[static_cast<std::size_t>(t)] = 0;
        while (!stack.empty()) {
            const std::int32_t cur = stack.back();
            stack.pop_back();
            const int cx = cur % kAxis;
            const int cy = cur / kAxis;
            for (int d = 0; d < 4; ++d) {
                const int nx = cx + kNeighborDx[d];
                const int ny = cy + kNeighborDy[d];
                if (nx < 0 || ny < 0 || nx >= kAxis || ny >= kAxis) continue;
                const std::int32_t ni = index(nx, ny);
                if (dist[static_cast<std::size_t>(ni)] == 0 || !passableIndex(ni)) continue;
                dist[static_cast<std::size_t>(ni)] = 0;
                stack.push_back(ni);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

bool Terrain::nearestOpenTile(Vec2 p, int& outTx, int& outTy) const {
    const int px = toTileCoord(p.x);
    const int py = toTileCoord(p.y);
    for (int ring = 0; ring <= kNearestOpenSearchTiles; ++ring) {
        bool found = false;
        double best = 0;
        for (int dy = -ring; dy <= ring; ++dy) {
            for (int dx = -ring; dx <= ring; ++dx) {
                // Only the ring itself; the interior was searched already.
                if (std::abs(dx) != ring && std::abs(dy) != ring) continue;
                const int tx = px + dx;
                const int ty = py + dy;
                if (tileBlocks(atTile(tx, ty))) continue;
                const double d2 = distanceSq(tileCenter(tx, ty), p);
                if (!found || d2 < best) {
                    found = true;
                    best = d2;
                    outTx = tx;
                    outTy = ty;
                }
            }
        }
        if (found) return true;
    }
    return false;
}

Vec2 Terrain::resolveCircle(Vec2 position, double radius) const {
    // Garbage in must not become an unbounded loop or a NaN out. A teleport
    // bug upstream costs the body a shove, never the tick.
    if (!std::isfinite(position.x) || !std::isfinite(position.y)) position = spawnPoint();
    if (!std::isfinite(radius) || radius < 0.0) radius = 0.0;
    radius = std::min(radius, kMaxResolveRadius);
    // Bound the scan before any tile arithmetic: a coordinate of 1e30 makes
    // the tile loop below run for the rest of the universe.
    position.x = clamp(position.x, -kTileSize, kWorldSize + kTileSize);
    position.y = clamp(position.y, -kTileSize, kWorldSize + kTileSize);

    // A centre inside solid geometry has no push direction -- the closest
    // point on the tile is the centre itself -- so it is ejected to the
    // nearest open tile before the usual push-out runs.
    //
    // Ejected to the nearest POINT of that tile rather than to its centre: a
    // petal shoved a hair into a wall should come back a hair, not teleport
    // 200 units to the middle of the next tile.
    if (tileBlocks(at(position))) {
        int tx = 0, ty = 0;
        if (!nearestOpenTile(position, tx, ty)) return position;   // solid everywhere
        const Rect open = tileRect(tx, ty);
        const double inset = std::min(radius, kTileSize * 0.49);
        position.x = clamp(position.x, open.left() + inset, open.right() - inset);
        position.y = clamp(position.y, open.top() + inset, open.bottom() - inset);
    }

    for (int pass = 0; pass < kResolvePasses; ++pass) {
        bool moved = false;
        const int x0 = toTileCoord(position.x - radius);
        const int x1 = toTileCoord(position.x + radius);
        const int y0 = toTileCoord(position.y - radius);
        const int y1 = toTileCoord(position.y + radius);
        for (int ty = y0; ty <= y1; ++ty) {
            for (int tx = x0; tx <= x1; ++tx) {
                if (!tileBlocks(atTile(tx, ty))) continue;
                const Rect r = tileRect(tx, ty);
                const double nx = clamp(position.x, r.left(), r.right());
                const double ny = clamp(position.y, r.top(), r.bottom());
                const Vec2 away{position.x - nx, position.y - ny};
                const double d2 = away.lengthSq();
                if (d2 >= radius * radius) continue;
                if (d2 > 1e-12) {
                    const double d = std::sqrt(d2);
                    position += away * ((radius - d) / d);
                } else {
                    // Dead centre on the tile: push through the nearest face,
                    // which is the shallowest way out of it.
                    const double toLeft = position.x - r.left() + radius;
                    const double toRight = r.right() - position.x + radius;
                    const double toTop = position.y - r.top() + radius;
                    const double toBottom = r.bottom() - position.y + radius;
                    const double least = std::min(std::min(toLeft, toRight), std::min(toTop, toBottom));
                    if (least == toLeft) position.x -= toLeft;
                    else if (least == toRight) position.x += toRight;
                    else if (least == toTop) position.y -= toTop;
                    else position.y += toBottom;
                }
                moved = true;
            }
        }
        if (!moved) break;
    }

    // Last-resort closure. The out-of-bounds-is-wall rule already keeps a body
    // inside; this makes it true even when the push-out could not converge.
    const double margin = std::min(radius, kWorldHalf * 0.5);
    position.x = clamp(position.x, margin, kWorldSize - margin);
    position.y = clamp(position.y, margin, kWorldSize - margin);
    return position;
}

bool Terrain::segmentBlocked(Vec2 a, Vec2 b) const {
    if (!std::isfinite(a.x) || !std::isfinite(a.y) || !std::isfinite(b.x) || !std::isfinite(b.y)) {
        return true;
    }

    int tx = toTileCoord(a.x);
    int ty = toTileCoord(a.y);
    if (tileBlocks(atTile(tx, ty))) return true;

    const int endTx = toTileCoord(b.x);
    const int endTy = toTileCoord(b.y);
    if (tx == endTx && ty == endTy) return false;

    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const int stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const int stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);

    // Amanatides-Woo: tMax is the ray parameter at the next grid line on each
    // axis, tDelta the parameter cost of a whole tile. An axis with no motion
    // gets an infinite tMax and is simply never chosen.
    const double kInf = std::numeric_limits<double>::infinity();
    double tMaxX = kInf, tMaxY = kInf, tDeltaX = kInf, tDeltaY = kInf;
    if (stepX != 0) {
        const double boundary = (stepX > 0 ? (tx + 1) : tx) * kTileSize;
        tMaxX = (boundary - a.x) / dx;
        tDeltaX = kTileSize / std::fabs(dx);
    }
    if (stepY != 0) {
        const double boundary = (stepY > 0 ? (ty + 1) : ty) * kTileSize;
        tMaxY = (boundary - a.y) / dy;
        tDeltaY = kTileSize / std::fabs(dy);
    }

    for (int step = 0; step < kMaxSegmentSteps; ++step) {
        if (tMaxX < tMaxY) {
            if (tMaxX > 1.0) return false;      // the segment ended first
            tx += stepX;
            tMaxX += tDeltaX;
        } else {
            if (tMaxY > 1.0) return false;
            ty += stepY;
            tMaxY += tDeltaY;
        }
        if (tileBlocks(atTile(tx, ty))) return true;
        if (tx == endTx && ty == endTy) return false;
    }
    // Longer than twice the map: nonsense input, and unseeable is the safe
    // answer for every caller (line of sight, "can I walk straight there").
    return true;
}

Vec2 Terrain::findOpenSpawn(Rng& rng, Vec2 around, double radius) const {
    if (!std::isfinite(around.x) || !std::isfinite(around.y)) around = spawnPoint();
    radius = std::isfinite(radius) ? clamp(radius, 0.0, kWorldSize) : 0.0;

    for (int attempt = 0; attempt < 24; ++attempt) {
        const Vec2 p = around + rng.insideCircle(radius);
        const Tile t = at(p);
        if (tileBlocks(t) || tileIsWater(t)) continue;
        // Reject pockets a body would immediately be squeezed out of: landing
        // in a one-tile gap between boulders reads as spawning inside a wall.
        if (distanceSq(resolveCircle(p, kPlayerBaseRadius), p) < 1.0) return p;
    }

    int tx = 0, ty = 0;
    if (nearestOpenTile(around, tx, ty)) {
        // Jitter inside the tile so repeated fallbacks do not stack every mob
        // on one point.
        const Vec2 c = tileCenter(tx, ty);
        const double j = kTileSize * 0.25;
        return {c.x + rng.range(-j, j), c.y + rng.range(-j, j)};
    }
    return spawnPoint();
}

} // namespace flr
