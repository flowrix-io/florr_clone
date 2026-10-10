#pragma once
// A real server on loopback, with real clients speaking the real protocol.
//
// Extracted from integration_tests.cpp once a second file needed it. Nothing
// here is a stub: below the socket it is the shipping code path, which is the
// whole point -- a test that mocks the server tests the mock.

#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "test_data.h"   // dataDir(), and the scratch files every fixture here is written to

namespace flix::testsupport {

/// A scratch database path for a test that opens a Database of its own: one
/// per test name and per process, so two runs at once never share it.
inline std::string tempPath(const char* name) {
    return tempUnique(std::string("florr-itest-") + name, ".json");
}

/// The directory a harness keeps its server's files in: one per test name and
/// per process, so two runs at once never share an account table.
///
/// The database is `<home>/db/inventory.json`, one level down, because a
/// server writes beside its database as well as into it: `backup_db` and
/// `update` put their snapshots one level ABOVE the database's own directory
/// (Database::backupDirectoryFor), which for a database sitting directly in
/// TMPDIR was TMPDIR's PARENT -- shared by every run and every other program,
/// and, for a relative TMPDIR, the repo root's own db_backups/. One level down,
/// that is `<home>/db_backups`, and nothing a harness's server writes ever
/// reaches past `<home>`.
inline std::string harnessHome(const char* name) {
    return tempRoot() + "/florr-itest-" + name + "-" + std::to_string(::getpid());
}

/// What a harness puts on disk, and the cleanup of it.
///
/// A member of Harness declared BEFORE its server, so it is destroyed AFTER
/// it -- which is the whole point. ~GameServer destroys the Database, and
/// ~Database saves a dirty database on the way out (one is dirty at the end of
/// almost every test: a login, a registration, the first load of a missing
/// file). A removal in ~Harness's own body ran before that save, which then
/// wrote the file straight back, so every harness test left its database
/// behind. Only the files a harness writes are removed by name; the
/// directories are rmdir'd, which leaves alone one that still holds anything
/// -- a backup a test did not clean up says so by staying.
struct HarnessFiles {
    std::string home;
    std::string dbPath;

    explicit HarnessFiles(const char* name)
        : home(harnessHome(name)), dbPath(home + "/db/inventory.json") {
        // Both levels before anything opens the database: save() writes a
        // temporary file beside it and renames it into place, which needs the
        // directory to be there already.
        ::mkdir(home.c_str(), 0755);
        ::mkdir((home + "/db").c_str(), 0755);
        // A run that crashed with this pid left its file behind.
        std::remove(dbPath.c_str());
    }
    ~HarnessFiles() {
        std::remove(dbPath.c_str());
        std::remove((dbPath + ".tmp").c_str());
        ::rmdir((home + "/db").c_str());
        ::rmdir((home + "/db_backups").c_str());
        ::rmdir(home.c_str());
    }
    HarnessFiles(const HarnessFiles&) = delete;
    HarnessFiles& operator=(const HarnessFiles&) = delete;
};

/// A server on a free port with an empty database, plus the plumbing to step
/// it and its clients forward together.
struct Harness {
    /// Must stay ABOVE `server`: see HarnessFiles for why the order is the
    /// cleanup.
    HarnessFiles files;
    GameServer server;
    /// `files.dbPath`, kept under the name every test already reads.
    std::string dbPath;
    std::uint16_t port = 0;
    bool ready = false;
    double clock = 0;
    /// For tests that need to ask the terrain for a point. Separate from the
    /// server's own stream so a probe cannot shift what the simulation rolls.
    Rng probeRng{0xA11CE};

    /// `seed` runs against the database file BEFORE the server opens it, for
    /// tests that need an account to already own something.
    ///
    /// `contentDir` is the data directory to boot on, defaulting to the staged
    /// one. A test that needs a map the shipped data does not have -- a second
    /// realm to teleport into, a door that is not pickable -- stages one of its
    /// own with stageDataDir() or twoMapDataDir() below and passes it here. The
    /// alternative is bending the shipped map into a test rig, which makes the
    /// game's own data a test fixture and stops an author from changing it.
    /// `bots` is the bot population to run with, or -1 for the server's usual
    /// one. The bots are spread over every biome a player can pick, and each
    /// is born in one of its map's doors or beginner bands, so one can be
    /// standing exactly where a joining player is put down -- which is right
    /// for a live server and fatal to any test that says "these are the only
    /// flowers in sight" or "this mob lived long enough to act". Those pass 0;
    /// bot_tests.cpp leaves it alone. `configure`, if given, sees the config
    /// last, for a field none of the above covers.
    explicit Harness(const char* dbName,
                     const std::function<void(const std::string&)>& seed = {},
                     const std::string& contentDir = dataDir(), int bots = -1,
                     const std::function<void(ServerConfig&)>& configure = {})
        : files(dbName) {
        dbPath = files.dbPath;
        if (seed) seed(dbPath);

        ServerConfig config;
        config.dataDir = contentDir;
        config.databasePath = dbPath;
        config.worldSeed = 12345;
        config.botCount = bots;
        if (configure) configure(config);

        std::string error;
        for (std::uint16_t candidate = 47100; candidate < 47160; ++candidate) {
            config.port = candidate;
            if (server.start(config, error)) { port = candidate; ready = true; break; }
        }
        if (!ready) std::printf("  harness could not start a server: %s\n", error.c_str());
    }

    /// Advances the simulation by `ticks`, servicing both ends each step.
    ///
    /// The server's socket and its simulation are stepped separately, exactly
    /// as run() interleaves them, so a test sees the same ordering production
    /// does rather than a convenient fiction.
    void step(int ticks, std::vector<NetClient*> clients) {
        for (int i = 0; i < ticks; ++i) {
            for (NetClient* c : clients) c->poll(1);
            server.serviceNetwork(1);
            clock += net::kTickMillis;
            server.tick(clock);
            server.serviceNetwork(0);
            for (NetClient* c : clients) c->poll(1);
        }
    }

    /// Steps until `done` holds or the budget runs out; returns whether it did.
    template <class F>
    bool stepUntil(std::vector<NetClient*> clients, F done, int maxTicks = 400) {
        for (int i = 0; i < maxTicks; ++i) {
            step(1, clients);
            if (done()) return true;
        }
        return false;
    }
};

// ---------------------------------------------------------------------------
// Synthetic map fixtures
// ---------------------------------------------------------------------------
//
// A data directory the server can boot on, built out of the staged content's
// mobs and petals plus maps written here. Anything that depends on how the
// maps are laid out -- a teleporter that lands somewhere, a door an admin may
// name but the picker may not offer -- gets a world of its own, so the test
// holds still while the author redraws the shipped maps, and a fixture the
// test can read is a better statement of the invariant than a rectangle
// hidden in the game's art.

/// The tileset every fixture map paints from: ground, wall, water, and one
/// DIAGONAL wall whose collision is half its cell.
///
/// Nothing is tagged solid, because there is no such tag: a cell blocks where
/// a layer with `has_collision` paints a tile that CARRIES COLLISION SHAPES,
/// which is Tiled's own semantic (shared/game/tiled_map.h). So each blocking
/// tile here declares an `objectgroup`, exactly as maps/tileset.tsj does --
/// the three whole-cell ones a rectangle over the entire tile, and
/// `castle_tri` a triangle over the half below its diagonal. A tile with no
/// objectgroup (the grass) contributes no collision wherever it is painted,
/// which is what makes the background layer scenery twice over.
///
/// The shapes are in the TILE'S OWN IMAGE SPACE, which is what Tiled's Tile
/// Collision Editor draws in and what the loader reads them in -- 300 here,
/// against 256-unit cells, so the load scales them by 256/300 and a whole-tile
/// shape still comes out a whole cell. (This is an image-collection tileset, so
/// every tile declares its image size and the tileset-level
/// tilewidth/tileheight is only the display grid; the two agree here.) Every
/// shape below is the whole tile or a fixed fraction of it, so the scale never
/// makes an expected number in a test an arithmetic puzzle.
///
/// `water` is the one tag left on a tile and it says only what KIND of blocker
/// a colliding cell is -- exactly as maps/tileset.tsj uses it.
inline std::string fixtureTileset() {
    return R"({
 "columns": 0,
 "grid": { "height": 300, "orientation": "orthogonal", "width": 300 },
 "name": "fixture",
 "tilecount": 4,
 "tiledversion": "1.10.1",
 "tileheight": 300,
 "tilerendersize": "grid",
 "tilewidth": 300,
 "type": "tileset",
 "version": "1.10",
 "tiles": [
  { "id": 0, "image": "tiles/grass_c_0.svg", "imageheight": 300, "imagewidth": 300,
    "properties": [ { "name": "covers_everything", "type": "bool", "value": true } ] },
  { "id": 1, "image": "tiles/castle_c_0.svg", "imageheight": 300, "imagewidth": 300,
    "properties": [ { "name": "covers_everything", "type": "bool", "value": true } ],
    "objectgroup": { "draworder": "index", "id": 2, "name": "", "opacity": 1,
      "type": "objectgroup", "visible": true, "x": 0, "y": 0,
      "objects": [ { "id": 1, "name": "", "type": "", "rotation": 0, "visible": true,
                     "x": 0, "y": 0, "width": 300, "height": 300 } ] } },
  { "id": 2, "image": "tiles/water_c_0.svg", "imageheight": 300, "imagewidth": 300,
    "properties": [ { "name": "water", "type": "bool", "value": true },
                    { "name": "covers_everything", "type": "bool", "value": true } ],
    "objectgroup": { "draworder": "index", "id": 2, "name": "", "opacity": 1,
      "type": "objectgroup", "visible": true, "x": 0, "y": 0,
      "objects": [ { "id": 1, "name": "", "type": "", "rotation": 0, "visible": true,
                     "x": 0, "y": 0, "width": 300, "height": 300 } ] } },
  { "id": 3, "image": "tiles/castle_tri_0.svg", "imageheight": 300, "imagewidth": 300,
    "properties": [ { "name": "covers_everything", "type": "bool", "value": true } ],
    "objectgroup": { "draworder": "index", "id": 2, "name": "", "opacity": 1,
      "type": "objectgroup", "visible": true, "x": 0, "y": 0,
      "objects": [ { "id": 1, "name": "", "type": "", "rotation": 0, "visible": true,
                     "x": 0, "y": 0, "width": 0, "height": 0,
                     "polygon": [ { "x": 0, "y": 0 }, { "x": 300, "y": 300 },
                                  { "x": 0, "y": 300 } ] } ] } }
 ]
})";
}

/// One `player_spawns` object: a door rectangle with its authored properties.
///
/// `spawnId` empty exercises the id fallback the shipped map relies on -- no
/// Tiled name, no `spawnId`, just a label.
inline std::string fixtureDoor(const std::string& spawnId, const std::string& label,
                               double x, double y, double w, double h, bool pickable = true,
                               double order = 0.0) {
    std::string out = "{ \"id\": " + std::to_string(static_cast<int>(x + y) + 1) +
                      ", \"name\": \"\", \"type\": \"player_spawn\", \"visible\": true," +
                      " \"rotation\": 0, \"x\": " + std::to_string(x) +
                      ", \"y\": " + std::to_string(y) + ", \"width\": " + std::to_string(w) +
                      ", \"height\": " + std::to_string(h) + ", \"properties\": [";
    if (!spawnId.empty()) {
        out += "{ \"name\": \"spawnId\", \"type\": \"string\", \"value\": \"" + spawnId + "\" },";
    }
    out += "{ \"name\": \"label\", \"type\": \"string\", \"value\": \"" + label + "\" },";
    out += "{ \"name\": \"order\", \"type\": \"float\", \"value\": " + std::to_string(order) + " },";
    out += std::string("{ \"name\": \"pickable\", \"type\": \"bool\", \"value\": ") +
           (pickable ? "true" : "false") + " }]}";
    return out;
}

/// One `spawns` object WITH a difficulty: a spawn BAND, which owns a
/// population of its own at the tier that difficulty buys. Ground no band
/// covers grows nothing at all, so a fixture map that wants mobs needs one of
/// these whatever else it carries. (The same object with no difficulty is a
/// mob REGION, which only answers a band standing on it that named no roster;
/// no fixture here needs one.)
///
/// A number, not a rarity name -- zero is fully common and three hundred is
/// unique with a little apex in it; see the difficulty curve in
/// shared/game/difficulty.h. Written as a float property because that is what
/// Tiled writes for any number an author types into one.
inline std::string fixtureBand(double x, double y, double w, double h, const std::string& mobs,
                               double difficulty) {
    return "{ \"id\": 81, \"name\": \"\", \"type\": \"spawn\", \"visible\": true,"
           " \"rotation\": 0, \"x\": " + std::to_string(x) +
           ", \"y\": " + std::to_string(y) + ", \"width\": " + std::to_string(w) +
           ", \"height\": " + std::to_string(h) + ", \"properties\": ["
           "{ \"name\": \"difficulty\", \"type\": \"float\", \"value\": " +
           std::to_string(difficulty) + " },"
           "{ \"name\": \"mobs\", \"type\": \"string\", \"value\": \"" + mobs + "\" }]}";
}

/// One `teleporters` object: a POINT, which is how every pad is authored.
inline std::string fixturePad(double x, double y, const std::string& targetMap,
                              const std::string& targetSpawn) {
    return "{ \"id\": 90, \"name\": \"\", \"type\": \"teleporter\", \"visible\": true,"
           " \"rotation\": 0, \"width\": 0, \"height\": 0, \"x\": " + std::to_string(x) +
           ", \"y\": " + std::to_string(y) + ", \"properties\": ["
           "{ \"name\": \"targetMap\", \"type\": \"string\", \"value\": \"" + targetMap + "\" },"
           "{ \"name\": \"targetSpawn\", \"type\": \"string\", \"value\": \"" + targetSpawn +
           "\" }]}";
}

/// One `npcs` object: a POINT naming the NPC that stands there and its tier.
/// An empty `npc` writes the object without one, which the reader drops.
inline std::string fixtureNpc(double x, double y, const std::string& npc,
                              const std::string& rarity) {
    std::string out = "{ \"id\": 95, \"name\": \"\", \"type\": \"npc\", \"visible\": true,"
                      " \"point\": true, \"rotation\": 0, \"width\": 0, \"height\": 0,"
                      " \"x\": " + std::to_string(x) + ", \"y\": " + std::to_string(y) +
                      ", \"properties\": [";
    std::string properties;
    if (!npc.empty()) {
        properties += "{ \"name\": \"npc\", \"type\": \"string\", \"value\": \"" + npc + "\" }";
    }
    if (!rarity.empty()) {
        if (!properties.empty()) properties += ",";
        properties += "{ \"name\": \"rarity\", \"type\": \"string\", \"value\": \"" + rarity +
                      "\" }";
    }
    return out + properties + "]}";
}

/// A Tiled map `cols` x `rows`, plus whatever objects the caller names on each
/// of the object layers the game reads.
///
/// Deliberately the same shape the real reader sees: one external tileset,
/// plain-array layer data, and THREE tile layers whose `has_collision`
/// properties are the only thing that decides collision --
///
///     background   has_collision false   painted everywhere, never blocks
///     water        has_collision true    the water tiles
///     walls        has_collision true    the solid tiles
///
/// -- exactly as maps/garden.tmj is built. `solidAt` says which cells the
/// walls layer paints; the default is a one-cell border, which is what most
/// callers want. `waterAt` is the same for the water layer, and a cell it
/// claims is a blocker of a different KIND: it still stops a body, and it is
/// what tileIsWater() is true of. `diagonalAt` paints the DIAGONAL wall tile,
/// whose authored shape is the triangle below its diagonal -- a cell that
/// blocks half of itself, which is what the whole map is made of now and what
/// a whole-cell collision reader cannot tell from a full wall.
///
/// Note the background layer: it paints every cell, INCLUDING the ones under
/// the walls, and it never blocks a thing -- twice over, since its tile
/// carries no collision shapes either.
inline std::string fixtureMap(int cols, int rows, const std::string& doors,
                              const std::string& pads, const std::string& spawns = {},
                              const std::function<bool(int, int)>& solidAt = {},
                              const std::function<bool(int, int)>& waterAt = {},
                              const std::function<bool(int, int)>& diagonalAt = {},
                              const std::string& npcs = {}) {
    std::string background, wall, water;
    for (int y = 0; y < rows; ++y) {
        for (int x = 0; x < cols; ++x) {
            const bool border = x == 0 || y == 0 || x == cols - 1 || y == rows - 1;
            const bool diagonal = diagonalAt && diagonalAt(x, y);
            const bool solid = !diagonal && (solidAt ? solidAt(x, y) : border);
            const bool wet = waterAt && waterAt(x, y) && !solid && !diagonal;
            if (!background.empty()) { background += ","; wall += ","; water += ","; }
            background += "1";
            wall += diagonal ? "4" : (solid ? "2" : "0");
            water += wet ? "3" : "0";
        }
    }
    const std::string size = std::to_string(cols);
    const std::string tall = std::to_string(rows);
    // Tiled writes a layer's custom properties exactly like this, and the
    // property is absent rather than false on a layer nobody ticked -- which
    // is the case the reader has to read as "scenery".
    const char* collides = R"("properties": [ { "name": "has_collision", "type": "bool", "value": true } ],)";
    std::string out = R"({
 "compressionlevel": -1, "infinite": false, "orientation": "orthogonal",
 "renderorder": "right-down", "tiledversion": "1.10.1", "type": "map",
 "version": "1.10", "nextlayerid": 9, "nextobjectid": 9,
 "tilewidth": 256, "tileheight": 256,
 "width": )" + size + R"(, "height": )" + tall + R"(,
 "tilesets": [ { "firstgid": 1, "source": "fixture.tsj" } ],
 "layers": [
  { "type": "tilelayer", "id": 1, "name": "background", "opacity": 1, "visible": true,
    "x": 0, "y": 0, "width": )" + size + R"(, "height": )" + tall + R"(,
    "data": [)" + background + R"(] },
  { "type": "tilelayer", "id": 2, "name": "water", "opacity": 1, "visible": true,
    )" + collides + R"(
    "x": 0, "y": 0, "width": )" + size + R"(, "height": )" + tall + R"(,
    "data": [)" + water + R"(] },
  { "type": "tilelayer", "id": 3, "name": "walls", "opacity": 1, "visible": true,
    )" + collides + R"(
    "x": 0, "y": 0, "width": )" + size + R"(, "height": )" + tall + R"(,
    "data": [)" + wall + R"(] },
  { "type": "objectgroup", "id": 4, "name": "player_spawns", "draworder": "topdown",
    "opacity": 1, "visible": true, "x": 0, "y": 0, "objects": [)" + doors + R"(] },
  { "type": "objectgroup", "id": 5, "name": "teleporters", "draworder": "topdown",
    "opacity": 1, "visible": true, "x": 0, "y": 0, "objects": [)" + pads + R"(] },
  { "type": "objectgroup", "id": 6, "name": "spawns", "draworder": "topdown",
    "opacity": 1, "visible": true, "x": 0, "y": 0, "objects": [)" + spawns + R"(] },
  { "type": "objectgroup", "id": 7, "name": "npcs", "draworder": "topdown",
    "opacity": 1, "visible": true, "x": 0, "y": 0, "objects": [)" + npcs + R"(] }
 ]
})";
    return out;
}

/// The wall pattern for a map at least as SOLID as the shipped ones.
///
/// garden.tmj paints a colliding tile on about half its cells -- water, dirt
/// and castle all collide -- and every placement path on the server has to
/// survive that. So does this: a solid border, one clear room at the top left
/// for the door, and everywhere else walls except a grid of corridors, one row
/// in four and one column in five. That is 60% solid and, unlike a scatter of
/// open cells, it is CONNECTED: a body can walk from any open cell to any
/// other, which is what makes it a map rather than a set of pockets.
inline std::function<bool(int, int)> denseWalls(int cols, int rows, int roomCols, int roomRows) {
    return [cols, rows, roomCols, roomRows](int x, int y) {
        if (x == 0 || y == 0 || x == cols - 1 || y == rows - 1) return true;
        if (x >= 1 && y >= 1 && x <= roomCols && y <= roomRows) return false;   // the door's room
        return !(y % 4 == 1 || x % 5 == 1);
    };
}

/// A data directory with the staged content and the caller's maps in it.
///
/// `maps` is (file stem, .tmj text). The manifest is written in that order, so
/// maps[0] is the overworld and maps[1] the next realm -- the same rule the
/// shipped maps.json follows. Returns the directory, or "" when it could not
/// be staged.
inline std::string stageDataDir(const std::string& name,
                                const std::vector<std::pair<std::string, std::string>>& maps) {
    const std::string dir = tempDir("florr-fixture-" + name + "-" + std::to_string(::getpid()));
    // All three are what a server boots on -- a directory with no drop table
    // is refused at start like one with no mobs -- so a failed copy of any of
    // them fails the staging rather than the server a test then starts.
    for (const char* file : {"mobs.json", "petals.json", "mob_drops.json"}) {
        if (!copyFile(dataDir() + "/" + file, dir + "/" + file)) return std::string();
    }
    if (!writeText(dir + "/fixture.tsj", fixtureTileset())) return std::string();
    // The art itself is optional: a missing tile file is one warning in the
    // client's sprite cache, never a failure, and no test here renders. It is
    // copied flat, beside the tileset, because the loader resolves a tile's
    // image by its file name alone.
    copyFile(dataDir() + "/grass_c_0.svg", dir + "/grass_c_0.svg");
    copyFile(dataDir() + "/castle_c_0.svg", dir + "/castle_c_0.svg");
    copyFile(dataDir() + "/water_c_0.svg", dir + "/water_c_0.svg");
    copyFile(dataDir() + "/castle_tri_0.svg", dir + "/castle_tri_0.svg");

    std::string manifest = "{\n  \"maps\": [";
    for (std::size_t i = 0; i < maps.size(); ++i) {
        if (!writeText(dir + "/" + maps[i].first + ".tmj", maps[i].second)) return std::string();
        if (i != 0) manifest += ",";
        manifest += "\n    { \"file\": \"" + maps[i].first + ".tmj\" }";
    }
    manifest += "\n  ]\n}\n";
    if (!writeText(dir + "/maps.json", manifest)) return std::string();
    return dir;
}

/// The standard two-map fixture world.
///
/// `meadow` is the overworld: two pickable doors, `meadow` first in button
/// order, and a pad in cell (12, 3) into `warren`. `warren` is a second,
/// differently-sized realm whose only door, `warren_gate`, is NOT pickable --
/// the arrangement the picker's two lists exist for. The shipped termite mound
/// has doors like that too, but this keeps its own, so a test of the picker
/// does not move when the mound is redrawn.
inline std::string twoMapDataDir(const std::string& name) {
    // Placed in CELLS times the cell size rather than in spelled-out pixels:
    // a door is meant to sit on particular ground, and only the cell says
    // which ground that is.
    const double cell = kTileSize;
    const std::string meadow =
        fixtureMap(24, 24,
                   fixtureDoor("meadow", "Meadow", cell * 2, cell * 2, cell * 4, cell * 4, true,
                               0.0) +
                       "," +
                       fixtureDoor("dunes", "Dunes", cell * 16, cell * 16, cell * 4, cell * 4,
                                   true, 1.0),
                   fixturePad(cell * 12, cell * 3, "warren", "warren_gate"));
    const std::string warren =
        fixtureMap(16, 16,
                   fixtureDoor("warren_gate", "Warren", cell * 3, cell * 3, cell * 3, cell * 3,
                               false, 0.0),
                   std::string());
    return stageDataDir(name, {{"meadow", meadow}, {"warren", warren}});
}

/// A one-map world that is MOSTLY WALL, denser still than the shipped garden.
///
/// 32x32 cells, three fifths of it solid, with two doors:
///
///   `hollow` -- pickable, order 0, in the one clear room. This is where a
///               join with no choice lands.
///   `cellar` -- NOT pickable, and drawn over a single cell that is SOLID all
///               the way across. A door an author placed badly, which is the
///               case every "give up and use the rectangle's centre" fallback
///               used to hand back a point inside a wall for.
///
/// Every placement path the server has -- the join, the respawn, the bots, a
/// band fill, a drop -- runs on this, and a path that quietly gives up on a
/// dense map shows up here rather than in the game.
inline std::string denseMapDataDir(const std::string& name) {
    const int side = 32;
    const double cell = kTileSize;
    const std::string world =
        fixtureMap(side, side,
                   fixtureDoor("hollow", "Hollow", cell * 2, cell * 2, cell * 4, cell * 4, true,
                               0.0) +
                       "," +
                       // Cell (12, 14) exactly: denseWalls() makes it solid, and
                       // a door over exactly one solid cell is the case the
                       // fallback exists for.
                       fixtureDoor("cellar", "Cellar", cell * 12, cell * 14, cell, cell, false,
                                   1.0),
                   std::string(),
                   // A difficulty-0 BAND over the whole map, so the spawner has
                   // somewhere to put anything at all: ground no band covers
                   // grows nothing, and this fixture exists to watch mobs be
                   // placed on awkward terrain. It names its roster outright
                   // because the map's id is its default mob group and
                   // `hollow` is not a group mobs.json defines.
                   fixtureBand(0, 0, side * kTileSize, side * kTileSize, "garden 100%", 0.0),
                   denseWalls(side, side, 6, 6));
    return stageDataDir(name, {{"hollow", world}});
}

/// A copy of the staged data directory -- the shipped content and every
/// shipped map, the very files a server boots on -- with ONE map edited, for a
/// test that needs the real world with something in it the shipped files no
/// longer carry.
///
/// `edit` is handed `mapStem`'s parsed document to change in place, and false
/// from it fails the staging. Every other file is copied byte for byte, and
/// only what a server reads is copied at all: the content, the drop table, the
/// manifest, its maps and the tilesets they name -- not the tile art or the
/// font, which no harness server draws. Returns the directory, or "" when it
/// could not be staged.
inline std::string stageShippedDataDir(const std::string& name, const std::string& mapStem,
                                       const std::function<bool(Json&)>& edit) {
    const std::string dir = tempDir("florr-fixture-" + name + "-" + std::to_string(::getpid()));
    for (const char* file : {"mobs.json", "petals.json", "mob_drops.json", "maps.json"}) {
        if (!copyFile(dataDir() + "/" + file, dir + "/" + file)) return std::string();
    }
    Json manifest;
    std::string error;
    if (!Json::parseFile(dataDir() + "/maps.json", manifest, error)) return std::string();
    std::vector<std::string> tilesets;
    bool edited = false;
    for (const Json& entry : manifest["maps"].items()) {
        const std::string file = entry["file"].asString();
        Json map;
        if (file.empty() || !Json::parseFile(dataDir() + "/" + file, map, error)) {
            return std::string();
        }
        const Json& read = map;
        for (const Json& tileset : read["tilesets"].items()) {
            const std::string source = tileset["source"].asString();
            if (source.empty()) continue;
            if (std::find(tilesets.begin(), tilesets.end(), source) == tilesets.end()) {
                tilesets.push_back(source);
            }
        }
        if (file != mapStem + ".tmj") {
            if (!copyFile(dataDir() + "/" + file, dir + "/" + file)) return std::string();
            continue;
        }
        if (!edit(map) || !map.writeFile(dir + "/" + file)) return std::string();
        edited = true;
    }
    // A stem the manifest does not name edits nothing, and a test that
    // thought it had changed the world would be testing the shipped one.
    if (!edited) return std::string();
    for (const std::string& tileset : tilesets) {
        if (!copyFile(dataDir() + "/" + tileset, dir + "/" + tileset)) return std::string();
    }
    return dir;
}

/// Deletes a directory stageDataDir() or stageShippedDataDir() made, files
/// and all.
inline void removeDataDir(const std::string& dir) {
    if (dir.empty()) return;
    // No <filesystem>: this tree targets a toolchain without it in the wasm
    // build, and the fixture's shape is known -- flat files and nothing else.
    const std::string command = "rm -rf '" + dir + "'";
    if (std::system(command.c_str()) != 0) {
        std::printf("  could not remove fixture dir %s\n", dir.c_str());
    }
}

inline bool connectClient(Harness& h, NetClient& client) {
    client.contentHash = content().contentHash();
    if (!client.connect("127.0.0.1", h.port)) return false;
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Ready; });
}

/// Registers `name` and waits for the account state to arrive.
inline bool loginNew(Harness& h, NetClient& client, const char* name, const char* password) {
    if (!connectClient(h, client)) return false;
    client.requestRegister(name, password);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

/// Logs an account a seed wrote in, and waits for the account state to arrive.
inline bool loginAs(Harness& h, NetClient& client, const char* name, const char* password) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, password);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

// ---------------------------------------------------------------------------
// Seeds: accounts written into the database before the server opens it
// ---------------------------------------------------------------------------

/// A registered account with a known password, so a test can log clients in
/// against the same database. `admin` sets the account's admin flag, which is
/// what makes it a full admin -- never its name.
inline void seedUser(const std::string& path, const std::string& username,
                     const std::string& password, bool admin = false) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);   // the default cost makes this the slowest step of a test
    CreateResult created = db.createUser(username, password);
    if (created.ok() && admin) created.account->admin = true;
    db.markDirty();
    db.save();
}

/// Gives a seeded account a stack -- `itemKey` is the bag's own key,
/// "petal_rose" -- which no amount of playing would hand out reliably.
inline void seedStack(const std::string& path, const std::string& username, const char* itemKey,
                      Rarity rarity, int count) {
    Database db;
    std::string error;
    db.load(path, error);
    const Account* account = db.findUser(username);
    if (account == nullptr) return;
    db.progress(account->id).addItem(rarity, itemKey, count);
    db.markDirty();
    db.save();
}

// ---------------------------------------------------------------------------
// What a client was told
// ---------------------------------------------------------------------------

/// Waits for a profile whose `predicate` holds. The server answers every
/// request that changes an account with a fresh Profile, so a state change is
/// observable without polling anything else.
template <class F>
bool awaitProfile(Harness& h, NetClient& client, F predicate) {
    return h.stepUntil({&client}, [&] { return predicate(client.profile()); }, 200);
}

/// Every chat line this client holds, joined -- the whole transcript as one
/// haystack, because command output is many lines and a test cares that the
/// answer is somewhere in it, not which line carried it.
inline std::string transcript(const NetClient& client) {
    std::string all;
    for (const ChatLine& line : client.chat()) {
        all += line.author;
        all += ": ";
        all += line.text;
        all += '\n';
    }
    return all;
}

/// Whether `needle` is anywhere in that transcript, author names included.
inline bool sawText(const NetClient& client, const std::string& needle) {
    return transcript(client).find(needle) != std::string::npos;
}

/// sawText over only the lines that landed after `mark`, a chatSequence()
/// reading -- for a test that asks the same question twice and needs the
/// second answer, not the first one still sitting in the transcript.
inline bool sawTextSince(const NetClient& client, std::uint64_t mark, const std::string& needle) {
    const std::vector<ChatLine>& lines = client.chat();
    const std::uint64_t landed = client.chatSequence() - mark;
    const std::size_t fresh =
        landed < lines.size() ? static_cast<std::size_t>(landed) : lines.size();
    for (std::size_t i = lines.size() - fresh; i < lines.size(); ++i) {
        if ((lines[i].author + ": " + lines[i].text).find(needle) != std::string::npos) return true;
    }
    return false;
}

/// Sends `text` and steps until the transcript grows, so a test does not have
/// to guess how many ticks a reply takes.
inline bool say(Harness& h, NetClient& client, const std::string& text, int maxTicks = 120) {
    const std::size_t before = client.chat().size();
    client.sendChat(text);
    return h.stepUntil({&client}, [&] { return client.chat().size() > before; }, maxTicks);
}

/// The player flowers this client's own view holds, its own included.
inline std::size_t playersVisibleTo(const NetClient& client) {
    std::size_t n = 0;
    for (const auto& e : client.view().entities()) {
        if (e.second.kind == net::EntityKind::Player) ++n;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Bodies in the server's world
// ---------------------------------------------------------------------------

/// The flower whose nameplate reads `name` -- the account's name, unless its
/// join chose another -- or NULL_ENTITY.
inline Entity bodyNamed(World& world, const std::string& name) {
    Entity found = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> players{world};
    players.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == name) found = e;
    });
    return found;
}

/// The one flower in the world that belongs to an account: the body of a
/// test's only client, or NULL_ENTITY before it has joined.
///
/// A bot is a flower too, and owns no account -- its PlayerAccount carries no
/// userId -- so it is skipped by that rather than by which archetype row a
/// query happens to visit last. Taking "the last PlayerTag" used to find the
/// client only because of the order the rows were in, and with the usual bot
/// population running that is not an order anything promises.
inline Entity onlyPlayer(World& world) {
    Entity found = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> players{world};
    players.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (!account.userId.empty()) found = e;
    });
    return found;
}

// ---------------------------------------------------------------------------
// Past the socket
// ---------------------------------------------------------------------------

/// The suite's one reach past GameServer's public interface: its friend
/// (server/game_server.h declares it).
///
/// Everything else in this file reaches the server from outside, the way the
/// rest of the world can -- a socket, the database file, the world() it
/// exposes -- and a test should do the same whenever it can; the top of this
/// file says why. This is for the tests that cannot: a guard against a state
/// no message leads to any more -- a session whose stage stopped saying
/// Playing while its body stood, which a repeated Hello used to leave -- can
/// be watched working only by putting a session into that state by hand.
/// Untested, a guard like that is indistinguishable from dead code, and the
/// next tidy-up takes it out.
///
/// Defined here and nowhere else, so every test file that includes this one
/// shares the one definition.
struct GameServerPeer {
    /// The session signed in as `username`, or nullptr. None for a socket that
    /// has closed, because a disconnect erases the session, or that has signed
    /// out, because a sign-out clears the name.
    static Session* sessionOf(GameServer& server, const std::string& username) {
        if (username.empty()) return nullptr;
        for (auto& entry : server.sessions_) {
            if (entry.second.username == username) return &entry.second;
        }
        return nullptr;
    }

    /// Re-files the session signed in as `username` under `orphanId`, a
    /// connection id the listener has never issued, and points its bodies
    /// there too. What that leaves is the state a transport that closes a
    /// socket without reporting it produces -- a session, and the flower it
    /// steers, with no connection behind them -- reached without such a
    /// transport, which is what the server's audit for it needs to be tested
    /// against now that the one that did exists no more. Its real socket stays
    /// open and no longer has a session: what it sends is ignored and its
    /// eventual close finds nothing to end. False if there is no such session.
    static bool detachFromSocket(GameServer& server, const std::string& username,
                                 net::ConnectionId orphanId) {
        for (auto it = server.sessions_.begin(); it != server.sessions_.end(); ++it) {
            if (it->second.username != username) continue;
            const net::ConnectionId was = it->first;
            Session session = std::move(it->second);
            server.sessions_.erase(it);
            session.connection = orphanId;
            for (const Entity body : {session.entity, session.splitOther}) {
                if (PlayerAccount* account = server.world().tryGet<PlayerAccount>(body)) {
                    account->connection = orphanId;
                }
            }
            server.sessions_[orphanId] = std::move(session);
            auto view = server.views_.find(was);
            if (view != server.views_.end()) {
                server.views_[orphanId] = std::move(view->second);
                server.views_.erase(was);
            }
            return true;
        }
        return false;
    }
};

} // namespace flix::testsupport
