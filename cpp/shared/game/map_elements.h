#pragma once
// The map's annotations: spawn zones, biomes and teleporters.
//
// `map_bundle.ts` carries two things. The tile grid, which Terrain already
// reads, says what is solid. MAP_ELEMENTS says what the map MEANS -- which
// stretch of ground is the beginner's field, which rectangle is the desert,
// which tier of mob belongs where. Terrain deliberately knows none of that:
// geometry and meaning are separate questions, and only one of them is needed
// per tick.
//
// This exists because a player has to spawn somewhere sane. Dropping them at
// the centre of the world puts them in the middle of the legendary and mythic
// bands, which is a place a level-1 flower cannot survive and cannot walk out
// of. The map already says where the common ground is; this reads it.

#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/rarity.h"

namespace flr {

class Terrain;

enum class MapElementKind : std::uint8_t {
    Other = 0,
    Spawn,
    Biome,
    Teleporter,
};

/// One annotation, in world coordinates. The bundle's numbers are already
/// world units -- there is no scale factor to apply, whatever the browser
/// build's SCALE_FACTOR of 1 might suggest is coming.
struct MapElement {
    MapElementKind kind = MapElementKind::Other;
    Rect bounds;

    /// Spawn zones only: the mob tier that belongs in this rectangle.
    Rarity spawnTier = Rarity::Common;
    bool hasSpawnTier = false;

    /// Biomes only.
    std::string biomeName;
    /// The tiers this biome's own spawn table admits. Empty means the biome
    /// declared no table, which is NOT the same as declaring an empty one:
    /// a biome without a table falls back to the global tiers, so it can hold
    /// anything and is never safe to spawn in.
    std::vector<Rarity> spawnTable;
    bool hasSpawnTable = false;

    Vec2 centre() const { return {bounds.x + bounds.w * 0.5, bounds.y + bounds.h * 0.5}; }
};

/// How a biome is named and coloured on the spawn picker.
///
/// Presentation next to the data it describes, as the section biome table in
/// terrain.h already is: there is one map, and one set of names for it. A
/// biome the table does not know still gets a button -- its own id, title
/// cased, in grey -- because the map is edited more often than this list.
struct BiomeDisplay {
    const char* label;
    std::uint32_t color;
};

BiomeDisplay biomeDisplay(const std::string& biomeName);

/// The map's annotation layer, loaded once beside the tile grid.
class MapData {
public:
    /// Reads MAP_ELEMENTS out of `map_bundle.ts`. The array is plain JSON
    /// inside a TypeScript literal, so it is sliced out and handed to the JSON
    /// parser rather than being re-lexed here.
    ///
    /// A bundle without the array is not an error: the annotation layer is
    /// optional, and a server that loses it falls back to the middle of the
    /// map rather than refusing to start.
    bool load(const std::string& bundlePath, std::string& errorOut);

    bool loaded() const { return !elements_.empty(); }
    const std::vector<MapElement>& elements() const { return elements_; }

    /// Where a player joining without a preference should appear.
    ///
    /// A `common` spawn zone, preferring section 0 -- the top-left corner is
    /// where the map's beginner ground is, and a player who picked nothing
    /// should land there rather than wherever the first zone in file order
    /// happens to be. Falls back to the centre of the map when the annotation
    /// layer is missing entirely.
    Vec2 defaultSpawn(Rng&, const Terrain&) const;

    /// Where a player who asked for `biomeName` should appear, or false when
    /// that biome has no area safe enough to drop someone into.
    bool spawnInBiome(const std::string& biomeName, Rng&, const Terrain&, Vec2& out) const;

    /// The biomes spawnInBiome() would actually accept, in map order. This is
    /// the SERVER's list: a destination it can honour without dropping the
    /// arrival somewhere lethal.
    const std::vector<std::string>& spawnableBiomes() const { return spawnableBiomes_; }

    /// Every biome the map names, in map order -- the PICKER's list. The
    /// browser's title screen offers each one with no tier test whatever, so
    /// filtering here would drop a button the reference still draws as soon as
    /// a biome's spawn table is raised above uncommon.
    const std::vector<std::string>& pickableBiomes() const { return pickableBiomes_; }

    /// True when a biome's own spawn table admits nothing above uncommon. A
    /// biome with no table at all is never safe -- it inherits the world's
    /// tiers, which go all the way up.
    static bool safeForSpawn(const MapElement&);

private:
    /// Picks a point inside `area` that is not inside a wall. Null when the
    /// rectangle is solid, which happens: some zones are drawn over terrain
    /// that later became a wall.
    bool findOpenPoint(const Rect& area, Rng&, const Terrain&, Vec2& out) const;

    std::vector<MapElement> elements_;
    std::vector<std::string> spawnableBiomes_;
    std::vector<std::string> pickableBiomes_;
};

} // namespace flr
