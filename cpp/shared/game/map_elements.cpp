#include "shared/game/map_elements.h"

#include <algorithm>
#include <fstream>
#include <iterator>

#include "shared/core/json.h"
#include "shared/game/constants.h"
#include "shared/game/terrain.h"

namespace flr {

namespace {

/// Tiers a starting area may contain. Anything above uncommon is a place a
/// level-1 flower is killed in seconds, which is the whole test.
bool safeTier(Rarity tier) { return tier == Rarity::Common || tier == Rarity::Uncommon; }

/// Keeps a spawn clear of the rectangle's own edge, so a player never appears
/// half inside the wall that bounds their zone.
constexpr double kSpawnPadding = 50.0;

/// How many points to try inside a zone before giving up on it. The zones are
/// large and mostly open; a zone that fails fifty times is one the map has
/// since walled over.
constexpr int kSpawnAttempts = 50;

/// Section 0 is the map's top-left, which is where the beginner ground is.
constexpr int kBeginnerSection = 0;

} // namespace

BiomeDisplay biomeDisplay(const std::string& biomeName) {
    struct Entry { const char* id; BiomeDisplay display; };
    static constexpr Entry kTable[] = {
        {"default",  {"Garden", 0x00BE4Fu}},
        {"garden",   {"Garden", 0x00BE4Fu}},
        {"desert",   {"Desert", 0xFFFF9Cu}},
        {"ocean",    {"Ocean", 0xC8FFFAu}},
        {"hel",      {"Hel", 0xFF0000u}},
        {"ant_hell", {"Ant Hell", 0xC9904Fu}},
        {"jungle",   {"Jungle", 0x00FF00u}},
        {"sewers",   {"Sewers", 0x803F02u}},
        {"computer", {"Computer Lab", 0x60FF95u}},
    };
    for (const Entry& entry : kTable) {
        if (biomeName == entry.id) return entry.display;
    }
    return {nullptr, 0xCCCCCCu};
}

bool MapData::safeForSpawn(const MapElement& element) {
    // A biome that declares no table inherits the world's tiers, which run all
    // the way to mythic. "No table" is therefore not "no dangerous mobs" -- it
    // is the opposite, and reading it the other way is how a spawn picker ends
    // up dropping people into Hel.
    if (!element.hasSpawnTable || element.spawnTable.empty()) return false;
    return std::all_of(element.spawnTable.begin(), element.spawnTable.end(), safeTier);
}

bool MapData::load(const std::string& bundlePath, std::string& errorOut) {
    elements_.clear();
    spawnableBiomes_.clear();
    pickableBiomes_.clear();

    std::ifstream input(bundlePath, std::ios::binary);
    if (!input) {
        errorOut = "could not open TypeScript map bundle: " + bundlePath;
        return false;
    }
    const std::string source((std::istreambuf_iterator<char>(input)),
                             std::istreambuf_iterator<char>());

    // The array is plain JSON inside a TypeScript literal, so it is sliced out
    // and handed to the JSON parser rather than lexed again here.
    constexpr const char* kMarker = "export const MAP_ELEMENTS";
    const std::size_t marker = source.find(kMarker);
    if (marker == std::string::npos) {
        errorOut = "MAP_ELEMENTS is missing from " + bundlePath;
        return false;
    }
    // Past the '=' first. The declaration reads
    //   export const MAP_ELEMENTS: MapElement[] = [
    // so the first '[' after the name belongs to the TYPE, not the value, and
    // slicing from it yields an empty array that parses perfectly.
    const std::size_t assign = source.find('=', marker);
    const std::size_t begin = assign == std::string::npos ? std::string::npos
                                                          : source.find('[', assign);
    if (begin == std::string::npos) {
        errorOut = "MAP_ELEMENTS is not an array in " + bundlePath;
        return false;
    }
    // Scan for the matching bracket rather than the next "];": the elements
    // nest arrays of their own, and every one of them would end the slice early.
    int depth = 0;
    std::size_t end = std::string::npos;
    bool inString = false;
    for (std::size_t i = begin; i < source.size(); ++i) {
        const char c = source[i];
        if (inString) {
            if (c == '\\') ++i;
            else if (c == '"') inString = false;
            continue;
        }
        if (c == '"') inString = true;
        else if (c == '[') ++depth;
        else if (c == ']' && --depth == 0) { end = i; break; }
    }
    if (end == std::string::npos) {
        errorOut = "MAP_ELEMENTS is unterminated in " + bundlePath;
        return false;
    }

    Json root;
    std::string parseError;
    if (!Json::parse(source.substr(begin, end - begin + 1), root, parseError) || !root.isArray()) {
        errorOut = "MAP_ELEMENTS did not parse: " + parseError;
        return false;
    }

    for (const Json& value : root.items()) {
        if (!value.isObject()) continue;
        MapElement element;
        const std::string kind = value["type"].asString();
        if (kind == "spawn") element.kind = MapElementKind::Spawn;
        else if (kind == "biome") element.kind = MapElementKind::Biome;
        else if (kind == "teleporter") element.kind = MapElementKind::Teleporter;
        element.bounds = {value["x"].asDouble(), value["y"].asDouble(), value["width"].asDouble(),
                          value["height"].asDouble()};
        // A zero-sized rectangle is a mistake in a spawn zone or a biome, but
        // it is how EVERY teleporter in the bundle is authored: the pad is a
        // point, so its width and height are both 0. Discarding those left the
        // annotation layer with no teleporters at all -- no dots on the
        // minimap, and no glow in the world.
        if (element.kind != MapElementKind::Teleporter &&
            (element.bounds.w <= 0 || element.bounds.h <= 0)) {
            continue;
        }

        const Json& properties = value["properties"];
        if (properties.isObject()) {
            const std::string tier = properties["spawnType"].asString();
            if (!tier.empty()) {
                element.spawnTier = parseRarity(tier);
                element.hasSpawnTier = true;
            }
            element.biomeName = properties["biomeName"].asString();
            const Json& table = properties["spawnTable"];
            if (table.isArray()) {
                element.hasSpawnTable = true;
                for (const Json& entry : table.items()) {
                    if (entry.isObject()) element.spawnTable.push_back(parseRarity(entry["tier"].asString()));
                }
            }
        }
        elements_.push_back(std::move(element));
    }

    // Two lists off one walk, in map order and without duplicates. `garden`
    // and `unnamed_biome` are the editor's names for the default ground and
    // for rectangles nobody named; neither is a destination in either list.
    //
    // The picker takes every named biome, because that is what the browser's
    // title screen offers -- it applies no tier test at all. The safety filter
    // belongs to the server's spawn logic, not to the menu: applying it here
    // too would silently delete a button the reference still draws the moment
    // a biome's first spawn table is raised above uncommon.
    for (const MapElement& element : elements_) {
        if (element.kind != MapElementKind::Biome) continue;
        if (element.biomeName.empty() || element.biomeName == "garden" ||
            element.biomeName == "unnamed_biome") {
            continue;
        }
        if (std::find(pickableBiomes_.begin(), pickableBiomes_.end(), element.biomeName) ==
            pickableBiomes_.end()) {
            pickableBiomes_.push_back(element.biomeName);
        }
        if (!safeForSpawn(element)) continue;
        if (std::find(spawnableBiomes_.begin(), spawnableBiomes_.end(), element.biomeName) ==
            spawnableBiomes_.end()) {
            spawnableBiomes_.push_back(element.biomeName);
        }
    }
    return true;
}

bool MapData::findOpenPoint(const Rect& area, Rng& rng, const Terrain& terrain, Vec2& out) const {
    const double width = area.w - kSpawnPadding * 2;
    const double height = area.h - kSpawnPadding * 2;
    if (width <= 0 || height <= 0) return false;

    for (int attempt = 0; attempt < kSpawnAttempts; ++attempt) {
        const Vec2 candidate{area.x + kSpawnPadding + rng.unit() * width,
                             area.y + kSpawnPadding + rng.unit() * height};
        if (!terrain.blocked(candidate)) {
            out = candidate;
            return true;
        }
    }
    return false;
}

Vec2 MapData::defaultSpawn(Rng& rng, const Terrain& terrain) const {
    // Beginner ground first. Only if the map declares none does this widen to
    // every common zone, and only if it declares none of those does it fall
    // back to the middle -- which is the behaviour this class exists to stop
    // being the normal case.
    std::vector<const MapElement*> preferred;
    std::vector<const MapElement*> anyCommon;
    for (const MapElement& element : elements_) {
        if (element.kind != MapElementKind::Spawn || !element.hasSpawnTier) continue;
        if (element.spawnTier != Rarity::Common) continue;
        anyCommon.push_back(&element);
        if (sectionAt(element.centre()) == kBeginnerSection) preferred.push_back(&element);
    }
    std::vector<const MapElement*>& zones = preferred.empty() ? anyCommon : preferred;

    // Shuffled, so a busy server does not stack every arrival in one corner of
    // one zone.
    for (std::size_t i = zones.size(); i > 1; --i) {
        std::swap(zones[i - 1], zones[rng.below(static_cast<std::uint32_t>(i))]);
    }
    Vec2 spawn;
    for (const MapElement* zone : zones) {
        if (findOpenPoint(zone->bounds, rng, terrain, spawn)) return spawn;
    }
    if (!zones.empty()) {
        // Every candidate was solid. The zone's centre is still a better guess
        // than the middle of the map, and movement pushes a body out of a wall.
        return zones.front()->centre();
    }
    return terrain.findOpenSpawn(rng, {kWorldHalf, kWorldHalf}, 600.0);
}

bool MapData::spawnInBiome(const std::string& biomeName, Rng& rng, const Terrain& terrain,
                           Vec2& out) const {
    std::vector<const MapElement*> areas;
    for (const MapElement& element : elements_) {
        if (element.kind != MapElementKind::Biome || element.biomeName != biomeName) continue;
        if (!safeForSpawn(element)) continue;
        areas.push_back(&element);
    }
    if (areas.empty()) return false;

    for (std::size_t i = areas.size(); i > 1; --i) {
        std::swap(areas[i - 1], areas[rng.below(static_cast<std::uint32_t>(i))]);
    }
    for (const MapElement* area : areas) {
        if (findOpenPoint(area->bounds, rng, terrain, out)) return true;
    }
    out = areas.front()->centre();
    return true;
}

} // namespace flr
