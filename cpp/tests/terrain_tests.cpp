#include "test.h"

#include "shared/game/spatial.h"
#include "shared/game/terrain.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

using namespace flr;

namespace {

/// One generated map, shared by the tests that only read it. Generation walks
/// 40000 tiles and a repair BFS; doing it per test case is pure waste.
const Terrain& sharedMap() {
    static const Terrain map = [] {
        Terrain t;
        t.generate(0xC0FFEEull);
        return t;
    }();
    return map;
}

int countOf(const std::vector<Entity>& list, Entity e) {
    return static_cast<int>(std::count(list.begin(), list.end(), e));
}

/// True when the circle overlaps any blocking tile -- the property
/// resolveCircle exists to establish.
bool overlapsWall(const Terrain& t, Vec2 p, double radius) {
    const int x0 = Terrain::toTileCoord(p.x - radius);
    const int x1 = Terrain::toTileCoord(p.x + radius);
    const int y0 = Terrain::toTileCoord(p.y - radius);
    const int y1 = Terrain::toTileCoord(p.y + radius);
    for (int ty = y0; ty <= y1; ++ty) {
        for (int tx = x0; tx <= x1; ++tx) {
            if (!tileBlocks(t.atTile(tx, ty))) continue;
            const Rect r = Terrain::tileRect(tx, ty);
            const double nx = clamp(p.x, r.left(), r.right());
            const double ny = clamp(p.y, r.top(), r.bottom());
            if (distanceSq(p, Vec2{nx, ny}) < radius * radius - 1e-6) return true;
        }
    }
    return false;
}

const double kQuietNan = std::numeric_limits<double>::quiet_NaN();
const double kInfinity = std::numeric_limits<double>::infinity();

} // namespace

// ---------------------------------------------------------------------------
// Terrain: grid basics
// ---------------------------------------------------------------------------

TEST(fresh_terrain_is_open_ground) {
    Terrain t;
    CHECK_EQ(t.at(Vec2{kWorldHalf, kWorldHalf}), Tile::Ground);
    CHECK(!t.blocked(Vec2{kWorldHalf, kWorldHalf}));
    CHECK(!t.inWater(Vec2{kWorldHalf, kWorldHalf}));
    CHECK_EQ(t.openTileCount(), kTilesPerAxis * kTilesPerAxis);
    CHECK(t.isConnected());
}

TEST(out_of_bounds_reads_are_wall) {
    Terrain t;
    // The whole point of the total accessor: nothing needs a bounds check to
    // discover the map has an edge.
    CHECK_EQ(t.atTile(-1, 0), Tile::Wall);
    CHECK_EQ(t.atTile(0, -1), Tile::Wall);
    CHECK_EQ(t.atTile(kTilesPerAxis, 0), Tile::Wall);
    CHECK_EQ(t.atTile(0, kTilesPerAxis), Tile::Wall);
    CHECK_EQ(t.atTile(-100000, 100000), Tile::Wall);
    CHECK_EQ(t.at(Vec2{-1.0, kWorldHalf}), Tile::Wall);
    CHECK_EQ(t.at(Vec2{kWorldSize, kWorldHalf}), Tile::Wall);
    CHECK(t.blocked(Vec2{-50000, -50000}));
    CHECK(t.blocked(Vec2{1e30, 1e30}));
    // NaN has no tile; answering Wall is the closed-world answer.
    CHECK(t.blocked(Vec2{kQuietNan, kQuietNan}));
}

TEST(tile_coordinates_clamp_instead_of_overflowing) {
    // A runaway coordinate must not be cast out of int's range: that is
    // undefined behaviour, and downstream it becomes a loop that never ends.
    CHECK(Terrain::toTileCoord(1e30) < (1 << 21));
    CHECK(Terrain::toTileCoord(-1e30) > -(1 << 21));
    CHECK_EQ(Terrain::toTileCoord(kQuietNan), Terrain::toTileCoord(-1e30));
    CHECK_EQ(Terrain::toTileCoord(0.0), 0);
    CHECK_EQ(Terrain::toTileCoord(kTileSize - 0.001), 0);
    CHECK_EQ(Terrain::toTileCoord(kTileSize), 1);
    CHECK_EQ(Terrain::toTileCoord(-0.001), -1);
}

TEST(set_tile_ignores_out_of_range_writes) {
    Terrain t;
    t.setTile(-1, -1, Tile::Water);
    t.setTile(kTilesPerAxis, 5, Tile::Water);
    CHECK_EQ(t.openTileCount(), kTilesPerAxis * kTilesPerAxis);
    t.setTile(3, 4, Tile::Wall);
    CHECK_EQ(t.atTile(3, 4), Tile::Wall);
    CHECK_EQ(t.openTileCount(), kTilesPerAxis * kTilesPerAxis - 1);
}

// ---------------------------------------------------------------------------
// Terrain: generation
// ---------------------------------------------------------------------------

TEST(generation_is_deterministic_for_a_seed) {
    Terrain a, b;
    a.generate(12345);
    b.generate(12345);
    CHECK_EQ(a.seed(), std::uint64_t(12345));
    int differences = 0;
    for (std::size_t i = 0; i < a.tileCount(); ++i) {
        if (a.tiles()[i] != b.tiles()[i]) ++differences;
    }
    CHECK_EQ(differences, 0);
}

TEST(generation_differs_across_seeds) {
    Terrain a, b;
    a.generate(1);
    b.generate(2);
    int differences = 0;
    for (std::size_t i = 0; i < a.tileCount(); ++i) {
        if (a.tiles()[i] != b.tiles()[i]) ++differences;
    }
    // Not merely "some": a different seed is a different map, so a large
    // fraction of the grid must move.
    CHECK(differences > kTilesPerAxis * kTilesPerAxis / 10);
}

TEST(generated_map_is_fully_connected) {
    // Every seed, not just the lucky one: the repair pass is what guarantees
    // this, and a seed that happens to need no repair proves nothing.
    for (std::uint64_t seed : {std::uint64_t(1), std::uint64_t(7), std::uint64_t(42),
                               std::uint64_t(0xDEADBEEF), std::uint64_t(0)}) {
        Terrain t;
        t.generate(seed);
        CHECK(t.isConnected());
        CHECK(!t.blocked(t.spawnPoint()));
    }
}

TEST(generated_map_has_every_tile_kind_and_biome) {
    const Terrain& t = sharedMap();
    int kindCounts[kTileKindCount] = {0, 0, 0, 0, 0};
    int openPerSection[kSectionCount] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int ty = 0; ty < kTilesPerAxis; ++ty) {
        for (int tx = 0; tx < kTilesPerAxis; ++tx) {
            const Tile tile = t.atTile(tx, ty);
            ++kindCounts[static_cast<int>(tile)];
            const int section = t.sectionOfTile(tx, ty);
            if (section >= 0 && !tileBlocks(tile)) ++openPerSection[section];
        }
    }
    for (int k = 0; k < kTileKindCount; ++k) CHECK(kindCounts[k] > 0);
    // A section with no floor is a section no player can ever visit.
    for (int s = 0; s < kSectionCount; ++s) CHECK(openPerSection[s] > 0);
}

TEST(walling_off_a_pocket_breaks_connectivity) {
    // Guards the guard: isConnected() must be able to say no, or the
    // generation test above is vacuous.
    Terrain t;
    CHECK(t.isConnected());
    for (int d = -1; d <= 1; ++d) {
        t.setTile(5 + d, 4, Tile::Wall);
        t.setTile(5 + d, 6, Tile::Wall);
        t.setTile(4, 5 + d, Tile::Wall);
        t.setTile(6, 5 + d, Tile::Wall);
    }
    CHECK(!t.isConnected());
    t.setTile(5, 4, Tile::Ground);
    CHECK(t.isConnected());
}

// ---------------------------------------------------------------------------
// Terrain: resolveCircle
// ---------------------------------------------------------------------------

TEST(resolve_circle_leaves_a_free_circle_untouched) {
    Terrain t;
    const Vec2 p{kWorldHalf, kWorldHalf};
    const Vec2 out = t.resolveCircle(p, kPlayerBaseRadius);
    CHECK_NEAR(out.x, p.x, 1e-9);
    CHECK_NEAR(out.y, p.y, 1e-9);
}

TEST(resolve_circle_pushes_a_circle_out_of_a_wall) {
    Terrain t;
    t.setTile(10, 10, Tile::Wall);
    const Rect wall = Terrain::tileRect(10, 10);

    // Overlapping the wall's left face by 50 units.
    const Vec2 start{wall.left() - 50.0, wall.top() + kTileSize * 0.5};
    const Vec2 out = t.resolveCircle(start, 100.0);
    CHECK(out.x <= wall.left() - 100.0);
    CHECK(out.x >= wall.left() - 100.0 - 20.1);
    CHECK_NEAR(out.y, start.y, 1e-9);
    CHECK(!overlapsWall(t, out, 100.0));

    // And a circle that never touched it does not move.
    const Vec2 clear = t.resolveCircle(Vec2{wall.left() - 500.0, start.y}, 100.0);
    CHECK_NEAR(clear.x, wall.left() - 500.0, 1e-9);
}

TEST(resolve_circle_escapes_a_wall_it_is_buried_in) {
    Terrain t;
    for (int ty = 20; ty <= 24; ++ty) {
        for (int tx = 20; tx <= 24; ++tx) t.setTile(tx, ty, Tile::Wall);
    }
    // Dead centre of a 5x5 block: no tile offers a push direction, so this is
    // the case that jitters forever if ejection is missing.
    const Vec2 buried = Terrain::tileCenter(22, 22);
    const Vec2 out = t.resolveCircle(buried, kPlayerBaseRadius);
    CHECK(!t.blocked(out));
    CHECK(!overlapsWall(t, out, kPlayerBaseRadius));
    // Idempotent: resolving an already-resolved position is a no-op, which is
    // what stops a body vibrating between two walls every tick.
    const Vec2 again = t.resolveCircle(out, kPlayerBaseRadius);
    CHECK_NEAR(again.x, out.x, 1e-9);
    CHECK_NEAR(again.y, out.y, 1e-9);
}

TEST(resolve_circle_ejects_a_shallow_embed_without_teleporting) {
    Terrain t;
    t.setTile(10, 10, Tile::Wall);
    // Two units past the wall's left face: technically inside geometry, so the
    // ejection path runs, but the answer must still be two units back out and
    // not a jump to the middle of the neighbouring tile.
    const Vec2 start{10 * kTileSize + 2.0, 10 * kTileSize + 150.0};
    const Vec2 out = t.resolveCircle(start, 12.0);
    CHECK(out.x <= 10 * kTileSize - 12.0);
    CHECK(out.x >= 10 * kTileSize - 12.0 - 20.1);
    CHECK_NEAR(out.y, start.y, 1e-9);
    CHECK(distance(out, start) < kTileSize * 0.25);
    CHECK(!overlapsWall(t, out, 12.0));
}

TEST(resolve_circle_settles_in_a_concave_corner) {
    Terrain t;
    t.setTile(10, 10, Tile::Wall);
    t.setTile(11, 10, Tile::Wall);
    t.setTile(10, 11, Tile::Wall);
    // Just inside the free tile's top-left corner, overlapping all three.
    const Vec2 start{11 * kTileSize + 5.0, 11 * kTileSize + 5.0};
    const Vec2 out = t.resolveCircle(start, 60.0);
    CHECK(out.x >= 11 * kTileSize + 60.0 - 1e-6);
    CHECK(out.y >= 11 * kTileSize + 60.0 - 1e-6);
    CHECK(!overlapsWall(t, out, 60.0));
}

TEST(resolve_circle_pushes_a_body_back_inside_the_world) {
    Terrain t;
    const Vec2 out = t.resolveCircle(Vec2{-5000.0, kWorldHalf}, 25.0);
    CHECK(out.x >= 0.0);
    CHECK(out.x <= kWorldSize);
    CHECK(!t.blocked(out));
    const Vec2 far = t.resolveCircle(Vec2{kWorldSize + 90000.0, kWorldHalf}, 25.0);
    CHECK(far.x <= kWorldSize);
    CHECK(!t.blocked(far));
}

TEST(resolve_circle_survives_nonsense_input) {
    Terrain t;
    t.generate(3);
    const Vec2 cases[] = {
        Vec2{kQuietNan, kQuietNan},
        Vec2{kInfinity, 0.0},
        Vec2{1e30, -1e30},
        Vec2{kWorldHalf, kWorldHalf},
    };
    const double radii[] = {-5.0, 0.0, kQuietNan, kInfinity, 1e9, 1e-12};
    for (const Vec2& p : cases) {
        for (const double r : radii) {
            const Vec2 out = t.resolveCircle(p, r);
            CHECK(std::isfinite(out.x));
            CHECK(std::isfinite(out.y));
            CHECK(out.x >= 0.0 && out.x <= kWorldSize);
            CHECK(out.y >= 0.0 && out.y <= kWorldSize);
        }
    }
}

TEST(resolve_circle_never_leaves_a_walkable_start_overlapping) {
    // The property that actually matters, checked across the real map: a body
    // standing anywhere legal is still standing somewhere legal afterwards.
    const Terrain& t = sharedMap();
    Rng rng(99);
    int checked = 0;
    for (int i = 0; i < 400; ++i) {
        const Vec2 p{rng.range(0, kWorldSize), rng.range(0, kWorldSize)};
        if (t.blocked(p)) continue;
        const Vec2 out = t.resolveCircle(p, kPlayerBaseRadius);
        CHECK(!t.blocked(out));
        CHECK(!overlapsWall(t, out, kPlayerBaseRadius));
        ++checked;
    }
    CHECK(checked > 50);
}

// ---------------------------------------------------------------------------
// Terrain: segmentBlocked
// ---------------------------------------------------------------------------

TEST(segment_blocked_sees_a_wall_across_the_line) {
    Terrain t;
    for (int ty = 0; ty < kTilesPerAxis; ++ty) t.setTile(30, ty, Tile::Wall);
    const double y = 40 * kTileSize + 17.0;
    CHECK(t.segmentBlocked(Vec2{25 * kTileSize, y}, Vec2{35 * kTileSize, y}));
    CHECK(!t.segmentBlocked(Vec2{20 * kTileSize, y}, Vec2{29.9 * kTileSize, y}));
    // Stopping exactly at the wall's near face is still clear; entering it is
    // not. Off-by-one here is the difference between shooting through a wall
    // and being unable to shoot along one.
    CHECK(!t.segmentBlocked(Vec2{25 * kTileSize, y}, Vec2{30 * kTileSize - 1e-6, y}));
    CHECK(t.segmentBlocked(Vec2{25 * kTileSize, y}, Vec2{30 * kTileSize + 1.0, y}));
}

TEST(segment_blocked_handles_degenerate_and_nonsense_endpoints) {
    Terrain t;
    t.setTile(10, 10, Tile::Wall);
    const Vec2 inWall = Terrain::tileCenter(10, 10);
    const Vec2 open = Terrain::tileCenter(0, 0);
    CHECK(t.segmentBlocked(inWall, inWall));       // zero length inside a wall
    CHECK(!t.segmentBlocked(open, open));
    CHECK(t.segmentBlocked(open, inWall));
    CHECK(t.segmentBlocked(inWall, open));         // blocked at the first tile
    CHECK(t.segmentBlocked(Vec2{kQuietNan, 0}, open));
    CHECK(t.segmentBlocked(open, Vec2{0, kInfinity}));
    // Out of the map is wall, so nothing can see out of it.
    CHECK(t.segmentBlocked(open, Vec2{-9999, -9999}));
}

TEST(segment_blocked_agrees_with_sampling_the_line) {
    const Terrain& t = sharedMap();
    Rng rng(2024);
    int clearSegments = 0;
    for (int i = 0; i < 500; ++i) {
        const Vec2 a{rng.range(0, kWorldSize), rng.range(0, kWorldSize)};
        const Vec2 b = a + Vec2::fromAngle(rng.angle(), rng.range(50.0, 3000.0));
        const bool dda = t.segmentBlocked(a, b);
        // Dense sampling can miss a tile the line only clips at a corner, so
        // the implication runs one way: anything sampling can see, the DDA
        // must also have seen.
        bool sampledBlock = false;
        for (int s = 0; s <= 600 && !sampledBlock; ++s) {
            sampledBlock = t.blocked(a + (b - a) * (s / 600.0));
        }
        if (sampledBlock) CHECK(dda);
        if (!dda) {
            CHECK(!sampledBlock);
            ++clearSegments;
        }
    }
    CHECK(clearSegments > 20);
}

TEST(segment_blocked_is_symmetric) {
    const Terrain& t = sharedMap();
    Rng rng(31337);
    for (int i = 0; i < 400; ++i) {
        const Vec2 a{rng.range(100, kWorldSize - 100), rng.range(100, kWorldSize - 100)};
        const Vec2 b{rng.range(100, kWorldSize - 100), rng.range(100, kWorldSize - 100)};
        CHECK_EQ(t.segmentBlocked(a, b), t.segmentBlocked(b, a));
    }
}

// ---------------------------------------------------------------------------
// Terrain: spawns, sections, biomes
// ---------------------------------------------------------------------------

TEST(find_open_spawn_lands_somewhere_walkable) {
    const Terrain& t = sharedMap();
    Rng rng(5);
    for (int i = 0; i < 200; ++i) {
        const Vec2 around{rng.range(0, kWorldSize), rng.range(0, kWorldSize)};
        const Vec2 p = t.findOpenSpawn(rng, around, 2000.0);
        CHECK(!t.blocked(p));
        CHECK(p.x >= 0.0 && p.x <= kWorldSize);
        CHECK(p.y >= 0.0 && p.y <= kWorldSize);
    }
    // Even asked about the middle of solid rock, and with no room to search.
    Terrain solid;
    solid.fill(Tile::Wall);
    solid.setTile(0, 0, Tile::Ground);
    const Vec2 p = solid.findOpenSpawn(rng, Terrain::tileCenter(5, 5), 0.0);
    CHECK(!solid.blocked(p));
}

TEST(nearest_open_tile_gives_up_on_a_solid_map) {
    Terrain solid;
    solid.fill(Tile::Wall);
    int tx = -1, ty = -1;
    CHECK(!solid.nearestOpenTile(Vec2{kWorldHalf, kWorldHalf}, tx, ty));
    // A solid map has nothing to connect, which isConnected() must report as
    // connected rather than as a failure.
    CHECK(solid.isConnected());
    CHECK_EQ(solid.openTileCount(), 0);
}

TEST(sections_and_biomes_cover_the_map) {
    Terrain t;
    for (int sy = 0; sy < kSectionsPerAxis; ++sy) {
        for (int sx = 0; sx < kSectionsPerAxis; ++sx) {
            const Vec2 center{(sx + 0.5) * kSectionSize, (sy + 0.5) * kSectionSize};
            CHECK_EQ(t.sectionAt(center), sy * kSectionsPerAxis + sx);
        }
    }
    CHECK_EQ(t.sectionAt(Vec2{-1.0, 0.0}), -1);
    CHECK_EQ(t.sectionAt(Vec2{kWorldSize, 0.0}), -1);

    CHECK_EQ(std::string(biomeOf(0).name), std::string("Garden"));
    CHECK_EQ(std::string(biomeOf(4).name), std::string("Ant Hell"));
    CHECK_EQ(std::string(biomeOf(8).name), std::string("Unknown"));
    // Off-map still paints something, so a renderer walking past the edge has
    // no special case either.
    CHECK_EQ(std::string(biomeOf(-1).name), std::string("Void"));
    CHECK_EQ(std::string(biomeOf(kSectionCount).name), std::string("Void"));

    // The same tile kind is a different colour per biome -- that is the whole
    // reason the colour lives on the biome and not on the Tile.
    CHECK(tileColor(0, Tile::Ground) != tileColor(2, Tile::Ground));
    CHECK(tileColor(4, Tile::Wall) != tileColor(4, Tile::Ground));
    CHECK_EQ(tileColor(0, Tile::Water), kBiomes[0].tileColors[static_cast<int>(Tile::Water)]);
}

// ---------------------------------------------------------------------------
// SpatialGrid
// ---------------------------------------------------------------------------

TEST(spatial_grid_finds_what_was_inserted) {
    SpatialGrid grid;
    std::vector<Entity> out;
    const Entity e = makeEntity(1, 1);
    grid.insert(e, Vec2{1000, 1000}, 10);
    CHECK_EQ(grid.size(), std::size_t(1));
    grid.query(Vec2{1000, 1000}, 50, out);
    CHECK_EQ(countOf(out, e), 1);
    // A query that shares no cell finds nothing at all.
    grid.query(Vec2{50000, 50000}, 100, out);
    CHECK_EQ(out.size(), std::size_t(0));
    CHECK(!grid.empty());
}

TEST(spatial_grid_finds_a_fat_entity_from_every_cell_it_covers) {
    SpatialGrid grid(600.0);
    const Entity big = makeEntity(7, 1);
    const Vec2 center{5000, 5000};
    const double radius = 1500;
    grid.insert(big, center, radius);

    std::vector<Entity> out;
    const int x0 = grid.cellX(center.x - radius);
    const int x1 = grid.cellX(center.x + radius);
    const int y0 = grid.cellY(center.y - radius);
    const int y1 = grid.cellY(center.y + radius);
    CHECK(x1 > x0);   // otherwise this proves nothing about fat insertion
    for (int cy = y0; cy <= y1; ++cy) {
        for (int cx = x0; cx <= x1; ++cx) {
            const Vec2 probe{(cx + 0.5) * grid.cellSize(), (cy + 0.5) * grid.cellSize()};
            grid.query(probe, 1.0, out);
            CHECK_EQ(countOf(out, big), 1);
        }
    }
    // And once, not once per cell, when the query spans all of them.
    grid.query(center, radius * 2, out);
    CHECK_EQ(countOf(out, big), 1);
    CHECK_EQ(out.size(), std::size_t(1));
}

TEST(spatial_grid_query_returns_a_complete_candidate_set) {
    // The contract the collision systems rely on: the result may hold extras,
    // but it can never miss an entity that actually overlaps.
    SpatialGrid grid;
    Rng rng(4242);
    std::vector<Vec2> positions;
    std::vector<double> radii;
    grid.clear();
    for (int i = 0; i < 200; ++i) {
        const Vec2 p{rng.range(0, kWorldSize), rng.range(0, kWorldSize)};
        const double r = rng.range(5.0, 400.0);
        positions.push_back(p);
        radii.push_back(r);
        grid.insert(makeEntity(static_cast<std::uint32_t>(i + 1), 1), p, r);
    }

    std::vector<Entity> out;
    for (int q = 0; q < 100; ++q) {
        const Vec2 c{rng.range(0, kWorldSize), rng.range(0, kWorldSize)};
        const double qr = rng.range(10.0, 1200.0);
        grid.query(c, qr, out);
        for (std::size_t i = 0; i < positions.size(); ++i) {
            if (distance(positions[i], c) > qr + radii[i]) continue;
            CHECK_EQ(countOf(out, makeEntity(static_cast<std::uint32_t>(i + 1), 1)), 1);
        }
    }
}

TEST(spatial_grid_clear_retires_the_previous_tick) {
    SpatialGrid grid;
    std::vector<Entity> out;
    const Entity oldEntity = makeEntity(3, 1);
    const Entity newEntity = makeEntity(4, 1);
    grid.insert(oldEntity, Vec2{2000, 2000}, 100);

    grid.clear();
    CHECK_EQ(grid.size(), std::size_t(0));
    grid.query(Vec2{2000, 2000}, 200, out);
    CHECK_EQ(out.size(), std::size_t(0));   // stale bucket contents stay hidden

    grid.insert(newEntity, Vec2{2000, 2000}, 100);
    grid.query(Vec2{2000, 2000}, 200, out);
    CHECK_EQ(out.size(), std::size_t(1));
    CHECK_EQ(countOf(out, newEntity), 1);
}

TEST(spatial_grid_query_rect_matches_its_bounds) {
    SpatialGrid grid;
    std::vector<Entity> out;
    const Entity e = makeEntity(9, 1);
    grid.insert(e, Vec2{3000, 3000}, 0);

    grid.queryRect(Vec2{2900, 2900}, Vec2{3100, 3100}, out);
    CHECK_EQ(countOf(out, e), 1);
    // Inverted corners describe the same rectangle.
    grid.queryRect(Vec2{3100, 3100}, Vec2{2900, 2900}, out);
    CHECK_EQ(countOf(out, e), 1);
    grid.queryRect(Rect{2900, 2900, 200, 200}, out);
    CHECK_EQ(countOf(out, e), 1);
    grid.queryRect(Vec2{20000, 20000}, Vec2{21000, 21000}, out);
    CHECK_EQ(out.size(), std::size_t(0));
}

TEST(spatial_grid_rejects_nonsense_input) {
    SpatialGrid grid;
    std::vector<Entity> out;
    grid.insert(NULL_ENTITY, Vec2{100, 100}, 10);
    grid.insert(makeEntity(2, 1), Vec2{kQuietNan, 100}, 10);
    grid.insert(makeEntity(3, 1), Vec2{100, kInfinity}, 10);
    CHECK_EQ(grid.size(), std::size_t(0));

    // A non-finite radius degrades to a point insertion rather than filing the
    // entity into every bucket on the map.
    const Entity e = makeEntity(4, 1);
    grid.insert(e, Vec2{100, 100}, kInfinity);
    CHECK_EQ(grid.size(), std::size_t(1));
    grid.query(Vec2{100, 100}, 10, out);
    CHECK_EQ(countOf(out, e), 1);
    grid.query(Vec2{40000, 40000}, 10, out);
    CHECK_EQ(out.size(), std::size_t(0));

    out.push_back(makeEntity(77, 1));
    grid.query(Vec2{kQuietNan, 0}, 10, out);
    CHECK_EQ(out.size(), std::size_t(0));   // cleared even on the reject path
}

TEST(spatial_grid_clamps_positions_outside_its_bounds) {
    // Nothing should live outside the world, but a knockback that overshoots
    // must still be findable rather than silently dropped.
    SpatialGrid grid;
    std::vector<Entity> out;
    const Entity e = makeEntity(11, 1);
    grid.insert(e, Vec2{-5000, -5000}, 10);
    grid.query(Vec2{10, 10}, 10, out);
    CHECK_EQ(countOf(out, e), 1);

    const Entity beyond = makeEntity(12, 1);
    grid.insert(beyond, Vec2{kWorldSize + 5000, kWorldSize + 5000}, 10);
    grid.query(Vec2{kWorldSize - 10, kWorldSize - 10}, 10, out);
    CHECK_EQ(countOf(out, beyond), 1);
}

TEST(spatial_grid_honours_its_own_origin_and_cell_size) {
    // A detached region (the arena) gets its own grid over its own coordinate
    // space; one grid spanning both would clamp arena entities onto the
    // overworld's border cells and collide them with whatever lives there.
    SpatialGrid arena(200.0, Vec2{150000.0, 150000.0}, Vec2{5000.0, 5000.0});
    CHECK_NEAR(arena.cellSize(), 200.0, 1e-12);
    CHECK_EQ(arena.cols(), 25);
    CHECK_EQ(arena.rows(), 25);

    std::vector<Entity> out;
    const Entity e = makeEntity(21, 1);
    arena.insert(e, Vec2{151000, 152000}, 30);
    arena.query(Vec2{151050, 152050}, 100, out);
    CHECK_EQ(countOf(out, e), 1);
    arena.query(Vec2{153000, 152000}, 100, out);
    CHECK_EQ(out.size(), std::size_t(0));

    // A degenerate cell size falls back rather than asking for four billion
    // buckets.
    SpatialGrid degenerate(0.0);
    CHECK_NEAR(degenerate.cellSize(), SpatialGrid::kDefaultCellSize, 1e-12);
    SpatialGrid tiny(1.5);
    CHECK(tiny.cols() <= 512);
    CHECK(tiny.rows() <= 512);
}

TEST(spatial_grid_does_not_allocate_once_warm) {
    SpatialGrid grid;
    std::vector<Entity> out;
    Rng rng(8);

    // Two identical rounds. The first grows every buffer; the second must
    // reuse all of them, or the broadphase allocates 25 times a second for
    // the life of the process.
    auto round = [&]() {
        for (int tick = 0; tick < 3; ++tick) {
            grid.clear();
            Rng inner(1234);
            for (int i = 0; i < 500; ++i) {
                const Vec2 p{inner.range(0, kWorldSize), inner.range(0, kWorldSize)};
                grid.insert(makeEntity(static_cast<std::uint32_t>(i + 1), 1), p, inner.range(5, 300));
            }
            Rng probe(999);
            for (int q = 0; q < 100; ++q) {
                grid.query(Vec2{probe.range(0, kWorldSize), probe.range(0, kWorldSize)}, 800.0, out);
            }
        }
    };

    round();
    const std::size_t reserved = grid.reservedEntries();
    const std::size_t outCapacity = out.capacity();
    round();
    CHECK_EQ(grid.reservedEntries(), reserved);
    CHECK_EQ(out.capacity(), outCapacity);
    CHECK(reserved > 0);
    (void)rng;
}
