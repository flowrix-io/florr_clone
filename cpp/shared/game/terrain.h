#pragma once
// The tile world.
//
// A 200x200 grid of Tile over the 60000-unit map; constants.h owns both
// numbers. Terrain answers three questions and nothing else: what is at a
// point, where does a circle end up once it is out of the walls, and is there
// a clear straight line between two points.
//
// Every accessor is TOTAL: a read outside the grid answers Tile::Wall. That is
// what closes the world -- no system special-cases the map edge, it is simply
// wall all the way out -- and it means resolveCircle keeps a body inside the
// map without a single bounds check of its own.

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/constants.h"

namespace flr {

/// Number of distinct Tile values, i.e. the size of a per-tile-kind table.
inline constexpr int kTileKindCount = 5;

/// The character of one of the nine map sections: what the section is called,
/// and what the renderer paints each tile kind as inside it. The same Tile is
/// a different colour in the Garden and in Hel, which is the whole point of a
/// biome here -- the grid stores geometry, the biome stores mood.
struct Biome {
    const char* name;
    std::array<std::uint32_t, kTileKindCount> tileColors;   ///< 0xRRGGBB, indexed by Tile
};

/// Row-major, matching sectionAt(): top-left is 0, centre is 4.
inline constexpr std::array<Biome, kSectionCount> kBiomes = {{
    // name        ground      wall        water       sand        stone
    {"Garden",   {{0x1EA761u, 0x7C7C7Cu, 0x4AA7F7u, 0xE8DCA6u, 0x9AA0A6u}}},
    {"Desert",   {{0xD9CFA4u, 0xB08A55u, 0x4AA7F7u, 0xEAE4D0u, 0xC0A878u}}},
    {"Hel",      {{0x8F0606u, 0x4E0303u, 0xE2591Bu, 0xB4634Bu, 0x6B2020u}}},
    {"Ocean",    {{0x2F9E62u, 0x6E8FA8u, 0x2E86D8u, 0xE8DCA6u, 0x8FA6B8u}}},
    {"Ant Hell", {{0xA8784Fu, 0x6B4930u, 0x4AA7F7u, 0xC8A375u, 0x8E6140u}}},
    {"Jungle",   {{0x15A12Fu, 0x0B6B1Du, 0x2E8B7Fu, 0xCFC08Au, 0x5E7A4Au}}},
    {"Sewers",   {{0x6B4A18u, 0x3F2200u, 0x5C7A2Eu, 0x8A7040u, 0x633500u}}},
    {"Computer", {{0x0F3D2Au, 0x1B6E4Au, 0x00D885u, 0x1A2A24u, 0x101418u}}},
    {"Unknown",  {{0x1A1730u, 0x2B2740u, 0x3A2E5Cu, 0x2A2440u, 0x231F38u}}},
}};

/// The biome of a section index, or a neutral one for -1 (outside the map),
/// so a renderer that walks past the edge still has something to paint.
inline const Biome& biomeOf(int section) {
    static const Biome kOutside{"Void", {{0x14171Cu, 0x14171Cu, 0x14171Cu, 0x14171Cu, 0x14171Cu}}};
    if (section < 0 || section >= kSectionCount) return kOutside;
    return kBiomes[static_cast<std::size_t>(section)];
}

inline std::uint32_t tileColor(int section, Tile tile) {
    const int kind = static_cast<int>(tile);
    return biomeOf(section).tileColors[static_cast<std::size_t>(kind < kTileKindCount ? kind : 0)];
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

class Terrain {
public:
    /// An ungenerated Terrain is all Ground: legal, walkable, and useless as a
    /// map. Systems can run against one, which is what tests want.
    Terrain();

    /// Builds the legacy procedural map for `seed`. Equal seeds give
    /// byte-identical grids; production instead loads map_bundle.ts below.
    ///
    /// Ends by flood-filling from the spawn and carving a corridor to anything
    /// the noise walled off, so the postcondition is always isConnected().
    ///
    /// Reproducible across machines only as far as the floating point is: if
    /// the client and the server are ever built by different toolchains, build
    /// both with -ffp-contract=off, or the odd tile will land on the other
    /// side of a threshold.
    void generate(std::uint64_t seed);

    /// Loads MAP_TILE_RLE from TypeScript's generated map_bundle.ts. The
    /// bundle remains the single map source used by both implementations.
    bool loadMapBundle(const std::string& path, std::string& errorOut);

    /// Replaces the grid with an authoritative network copy.
    bool setTiles(const std::vector<std::uint8_t>& tiles);

    std::uint64_t seed() const { return seed_; }

    // -- reads --------------------------------------------------------------

    Tile atTile(int tx, int ty) const {
        if (tx < 0 || ty < 0 || tx >= kTilesPerAxis || ty >= kTilesPerAxis) return Tile::Wall;
        return static_cast<Tile>(tiles_[static_cast<std::size_t>(ty) * kTilesPerAxis + static_cast<std::size_t>(tx)]);
    }

    Tile at(Vec2 p) const { return atTile(toTileCoord(p.x), toTileCoord(p.y)); }

    bool blocked(Vec2 p) const { return tileBlocks(at(p)); }
    bool inWater(Vec2 p) const { return tileIsWater(at(p)); }

    /// Which of the nine sections a point is in, or -1 outside the map.
    int sectionAt(Vec2 p) const { return flr::sectionAt(p); }
    int sectionOfTile(int tx, int ty) const { return flr::sectionAt(tileCenter(tx, ty)); }
    const Biome& biomeAt(Vec2 p) const { return biomeOf(sectionAt(p)); }

    /// The connectivity root chosen by generate(), and where a fresh player
    /// starts. Guaranteed walkable on a generated map.
    Vec2 spawnPoint() const;

    // -- collision ----------------------------------------------------------

    /// Pushes a circle out of every solid tile it overlaps and returns the
    /// corrected centre. The only tile-collision routine movement uses.
    ///
    /// Robust by construction rather than by contract: a centre already inside
    /// geometry (spawned or teleported into a wall) is ejected to the nearest
    /// open tile instead of jittering forever, absurd radii are clamped, and
    /// non-finite input is replaced rather than propagated. Bad input upstream
    /// costs the caller a shove, never the tick.
    Vec2 resolveCircle(Vec2 position, double radius) const;

    /// True when the segment crosses any blocking tile -- line of sight, and
    /// the "can I walk straight there" test the AI asks before pathing. A DDA
    /// walk: no allocation, and bounded even for nonsense endpoints.
    bool segmentBlocked(Vec2 a, Vec2 b) const;

    /// A walkable point within `radius` of `around`, avoiding water when it
    /// can. Falls back to the nearest open tile, so it always returns
    /// something a body can stand in.
    Vec2 findOpenSpawn(Rng& rng, Vec2 around, double radius) const;

    /// The nearest tile a body can stand in, searched outward from `p`. False
    /// when everything within the search bound is solid.
    bool nearestOpenTile(Vec2 p, int& outTx, int& outTy) const;

    // -- invariants ---------------------------------------------------------

    /// True when every non-blocking tile is reachable from the spawn. generate()
    /// guarantees it; setTile() can break it, which is why it is public.
    bool isConnected() const;

    /// Passable tile count, for tests and map statistics.
    int openTileCount() const;

    // -- authoring ----------------------------------------------------------
    //
    // Direct writes, for tests and for any future map editor. They do not
    // re-verify connectivity: a caller that walls off a region owns the
    // consequences.

    void setTile(int tx, int ty, Tile t);
    void fill(Tile t);

    // -- grid geometry ------------------------------------------------------

    /// Tile index for a world coordinate. Clamped before the cast: a runaway
    /// coordinate (1e30 from a bad teleport) would otherwise be undefined
    /// behaviour here and an unbounded loop in every caller that walks tiles.
    static int toTileCoord(double world) {
        const double t = std::floor(world / kTileSize);
        // Written as a failed > test so NaN takes this branch too.
        if (!(t > -kTileCoordLimit)) return -kTileCoordLimit;
        if (t > kTileCoordLimit) return kTileCoordLimit;
        return static_cast<int>(t);
    }

    static Vec2 tileCenter(int tx, int ty) {
        return {(tx + 0.5) * kTileSize, (ty + 0.5) * kTileSize};
    }

    static Rect tileRect(int tx, int ty) {
        return {tx * kTileSize, ty * kTileSize, kTileSize, kTileSize};
    }

    static constexpr int tilesPerAxis() { return kTilesPerAxis; }

    /// Raw row-major grid, one byte per tile, for the renderer and for saving.
    const std::uint8_t* tiles() const { return tiles_.data(); }
    std::size_t tileCount() const { return tiles_.size(); }

private:
    static constexpr int kTileCoordLimit = 1 << 20;

    /// Beyond four tiles a circle spans more geometry than a push-out can
    /// meaningfully resolve, and the scan cost grows quadratically. Nothing in
    /// the game is this big; the clamp exists so nothing can be.
    static constexpr double kMaxResolveRadius = kTileSize * 4.0;

    /// Overlaps against several tiles fight each other, so the push is
    /// iterated. Four passes settles every concave corner the grid can make;
    /// the cap is what makes a wedge the circle cannot fit into terminate.
    static constexpr int kResolvePasses = 4;

    /// A DDA long enough to cross the map twice. Past that the segment is
    /// nonsense and reporting it blocked is the conservative answer.
    static constexpr int kMaxSegmentSteps = 2 * kTilesPerAxis + 8;

    static constexpr int kNearestOpenSearchTiles = 24;

    int index(int tx, int ty) const { return ty * kTilesPerAxis + tx; }
    bool passableIndex(int i) const { return !tileBlocks(static_cast<Tile>(tiles_[static_cast<std::size_t>(i)])); }

    void generateSections(Rng& rng);
    void carveAntHell(Rng& rng);
    void placeCircuitChips(Rng& rng);
    int chooseGardenSpawn() const;
    void carveDisc(Vec2 center, double radius, Tile t);
    void carveCorridor(int fromTx, int fromTy, int toTx, int toTy, int halfWidth, Tile t);
    /// Flood-fills from the spawn and digs the shortest wall-crossing route to
    /// every region the fill missed.
    void connectAll();

    std::vector<std::uint8_t> tiles_;
    std::uint64_t seed_ = 0;
    int spawnTile_ = 0;
};

} // namespace flr
