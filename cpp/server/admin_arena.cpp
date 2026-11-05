#include "server/game_server.h"
#include "server/text.h"
#include "shared/game/admin_arena.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <sstream>

namespace flix {
namespace {
bool boundedInt(const std::string& text, int& value, int lo, int hi) {
    const auto r = std::from_chars(text.data(), text.data() + text.size(), value);
    return r.ec == std::errc{} && r.ptr == text.data() + text.size() && value >= lo && value <= hi;
}
// Existing pets, ring petals and projectiles carry copies of their owner's
// Faction. Update those copies when an event changes PvP rules or realms.
void syncKitPvp(World& world, Entity player, bool enabled) {
    Query<Faction> sides{world};
    sides.each([&](Entity e, Faction& side) {
        Entity owner = e;
        for (int hop = 0; hop < 8 && owner != NULL_ENTITY; ++hop) {
            if (owner == player) { side.friendlyFireEnabled = enabled; return; }
            if (const auto* petal = world.tryGet<PetalInstance>(owner)) owner = petal->owner;
            else if (const auto* pet = world.tryGet<Pet>(owner)) owner = pet->owner;
            else if (const auto* shot = world.tryGet<Projectile>(owner))
                owner = shot->creditTo != NULL_ENTITY ? shot->creditTo : shot->owner;
            else if (const auto* effect = world.tryGet<GroundEffect>(owner)) owner = effect->owner;
            else return;
        }
    });
}
void border(std::vector<std::uint8_t>& cells, int cols, int rows) {
    for (int y = 0; y < rows; ++y) for (int x = 0; x < cols; ++x)
        if (!x || !y || x == cols-1 || y == rows-1) cells[y*cols+x] = static_cast<std::uint8_t>(Tile::Solid);
}
}
void GameServer::initHostedArena() {
    const Json& saved = database_.storedTable("adminArena");
    const auto size = [&](const char* key) {
        const double value = saved[key].asDouble(0);
        return value >= 4 && value <= kAdminArenaMaxSize && std::floor(value) == value
            ? static_cast<int>(value) : 0;
    };
    int cols = size("cols"), rows = size("rows");
    std::vector<std::uint8_t> cells;
    if (cols >= 4 && rows >= 4 && cols <= kAdminArenaMaxSize && rows <= kAdminArenaMaxSize &&
        saved["tiles"].isArray() && saved["tiles"].size() == std::size_t(cols*rows)) {
        for (const auto& tile : saved["tiles"].items()) {
            if (!tile.isNumber() || (tile.asDouble(-1) != 0 && tile.asDouble(-1) != 1)) { cells.clear(); break; }
            cells.push_back(static_cast<std::uint8_t>(tile.asInt()));
        }
    }
    if (cells.empty() || std::find(cells.begin(), cells.end(), std::uint8_t(Tile::Open)) == cells.end()) {
        const MapData* source = nullptr;
        for (const auto& map : worldMaps_.maps()) if (map.id() == "hel") source = &map;
        if (!source && !worldMaps_.maps().empty()) source = &worldMaps_.maps().front();
        if (source && source->width() >= 4 && source->height() >= 4 &&
            source->width() <= kAdminArenaMaxSize && source->height() <= kAdminArenaMaxSize) {
            cols = source->width(); rows = source->height(); cells.assign(terrain_->tiles(source->realm()), terrain_->tiles(source->realm()) + terrain_->tileCount(source->realm()));
        } else { cols = rows = 16; cells.assign(cols*rows, std::uint8_t(Tile::Open)); }
    }
    border(cells, cols, rows);
    if (std::find(cells.begin(), cells.end(), std::uint8_t(Tile::Open)) == cells.end())
        cells[(rows/2)*cols+cols/2] = std::uint8_t(Tile::Open);
    terrain_->setTiles(cells, cols, rows, kAdminArenaRealm);
    const int floor = adminArenaTheme(saved["floor"].asString("hel"));
    const int wall = adminArenaTheme(saved["wall"].asString("garden"));
    terrain_->adminArenaFloor = floor < 0 ? 1 : floor;
    terrain_->adminArenaWall = wall < 0 ? 0 : wall;
    hostedArenaPvp_ = saved["pvp"].asBool(false);
}
void GameServer::saveHostedArena() {
    Json record = Json::object();
    record["cols"] = terrain_->tileCols(kAdminArenaRealm);
    record["rows"] = terrain_->tileRows(kAdminArenaRealm);
    record["floor"] = kAdminArenaThemes[terrain_->adminArenaFloor].name;
    record["wall"] = kAdminArenaThemes[terrain_->adminArenaWall].name;
    record["pvp"] = hostedArenaPvp_;
    Json cells = Json::array();
    for (std::size_t i = 0; i < terrain_->tileCount(kAdminArenaRealm); ++i)
        cells.push(int(terrain_->tiles(kAdminArenaRealm)[i]));
    record["tiles"] = std::move(cells);
    database_.rawTable("adminArena") = std::move(record);
    database_.markDirty();
}
void GameServer::refreshHostedArena(bool reset) {
    grid_.sizeToRealms(*terrain_);
    if (reset) {
        std::vector<Entity> remove;
        Query<Transform> entities{world_};
        entities.each([&](Entity e, Transform& at) {
            if (at.realm != kAdminArenaRealm || world_.has<PlayerTag>(e) || world_.has<Pet>(e) ||
                world_.has<PetalInstance>(e)) return;
            remove.push_back(e);
        });
        for (Entity e : remove) destroyBody(e);
    }
    for (auto& entry : sessions_) {
        Session& player = entry.second;
        if (!player.playing() || player.realm != kAdminArenaRealm) continue;
        for (Entity e : bodiesOf(player)) {
            if (auto* at = world_.tryGet<Transform>(e)) {
                const auto* body = world_.tryGet<Body>(e);
                teleportEntity(e, terrain_->resolveCircle(at->position, body ? body->radius : kPlayerBaseRadius, kAdminArenaRealm));
            }
            syncKitPvp(world_, e, hostedArenaPvp_);
        }
        sendRealmChange(player, world_.get<Transform>(player.entity).position);
    }
    saveHostedArena();
}
bool GameServer::transferHostedArena(Session& player, bool entering) {
    if (!player.playing() || !world_.isAlive(player.entity)) return false;
    if (entering && player.realm == kAdminArenaRealm) return false;
    if (!entering && player.realm != kAdminArenaRealm) return false;
    const auto before = world_.get<Transform>(player.entity);
    if (entering) {
        player.adminArenaHasReturn = true;
        player.adminArenaReturnRealm = player.realm;
        player.adminArenaReturnPosition = before.position;
        player.adminArenaReturnChoice = player.spawnChoice;
    }
    persistPlayer(player);
    if (player.arena) endArenaRun(player);
    endControlOf(player, "joined a hosted game", false);
    endSplit(player, clockMillis_, false);
    Realm destination = entering ? kAdminArenaRealm : player.adminArenaHasReturn
        ? player.adminArenaReturnRealm : Realm::Overworld;
    Vec2 point = entering ? terrain_->spawnPoint(destination) : player.adminArenaHasReturn
        ? player.adminArenaReturnPosition : terrain_->spawnPoint(destination);
    point = terrain_->findOpenSpawn(rng_, point, entering ? kTileSize : 0.0, destination);
    player.adminArenaAdmitted = entering;
    player.spawnChoice = entering ? kAdminArenaSpawnChoice : player.adminArenaHasReturn
        ? player.adminArenaReturnChoice : std::string();
    if (!entering) player.adminArenaHasReturn = false;
    if (destination == Realm::Arena) player.arena = startArenaRun(database_.progress(player.userId));
    moveEntityToRealm(player.entity, destination, point);
    const PlayerRecord& account = liveRecord(player);
    auto& progress = world_.get<PlayerProgress>(player.entity);
    progress.totalXp = destination == Realm::Maze ? account.mazeTotalXp : account.totalXp;
    progress.level = levelFromTotalXp(progress.totalXp).level;
    applyAccountToSession(player);
    syncKitPvp(world_, player.entity, destination == Realm::Arena ||
        (destination == kAdminArenaRealm && hostedArenaPvp_));
    if (auto* peer = listener_.find(player.connection)) {
        sendProfile(player, *peer);
        sendSystem(*peer, entering ? "An admin brought you into a hosted game." : "The host returned you from the arena.");
    }
    return true;
}
void GameServer::runHostedArenaCommand(Session& admin, net::Connection& connection, const std::string& args) {
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    std::istringstream input(args);
    std::vector<std::string> w;
    for (std::string part; input >> part;) w.push_back(lowerCase(part));
    if (w.empty() || w[0] == "help" || w[0] == "status") {
        out("Admin Arena: " + std::to_string(terrain_->tileCols(kAdminArenaRealm)) + "x" +
            std::to_string(terrain_->tileRows(kAdminArenaRealm)) + ", floor " +
            kAdminArenaThemes[terrain_->adminArenaFloor].name + ", walls " +
            kAdminArenaThemes[terrain_->adminArenaWall].name + (hostedArenaPvp_ ? ", PvP on." : ", PvP off."));
        out("arena bring|return <all|username>; arena map <map-id>; arena empty <width> [height] (tiles, 4-128)");
        out("arena wall|floor <garden|hel|desert|computer|jungle>; arena build <x> <y> <width> <height> <wall|open>; arena pvp <on|off>");
        return;
    }
    if (!admin.admin) { out("Only full admins may configure or move players into hosted games."); return; }
    std::printf("[admin-arena] %s: %s\n", admin.username.c_str(), args.c_str());
    if ((w[0] == "bring" || w[0] == "return") && w.size() == 2) {
        const bool entering = w[0] == "bring";
        int moved = 0;
        if (w[1] == "all") {
            for (auto& entry : sessions_) if (transferHostedArena(entry.second, entering)) ++moved;
        } else if (Session* target = sessionForUser(w[1])) moved = transferHostedArena(*target, entering) ? 1 : 0;
        out("Moved " + std::to_string(moved) + " players " + (entering ? "into the arena." : "back from the arena."));
        return;
    }
    if (w[0] == "map" && w.size() == 2) {
        const MapData* source = nullptr;
        for (const auto& map : worldMaps_.maps()) if (map.id() == w[1]) source = &map;
        if (!source || source->width() < 4 || source->height() < 4 ||
            source->width() > kAdminArenaMaxSize || source->height() > kAdminArenaMaxSize) {
            out("Unknown or oversized map. Use a staged map ID such as hel, garden or desert (max 128 tiles per axis)."); return;
        }
        std::vector<std::uint8_t> cells(terrain_->tiles(source->realm()), terrain_->tiles(source->realm()) + terrain_->tileCount(source->realm())); border(cells, source->width(), source->height());
        if (std::find(cells.begin(), cells.end(), std::uint8_t(Tile::Open)) == cells.end()) { out("Map has no open tiles."); return; }
        terrain_->clearCollisionShapes(kAdminArenaRealm);
        terrain_->setTiles(cells, source->width(), source->height(), kAdminArenaRealm);
        const int theme = adminArenaTheme(source->biome());
        if (theme >= 0) terrain_->adminArenaFloor = theme;
        refreshHostedArena(true); out("Hosted arena now uses " + w[1] + " layout. No ambient mobs or map NPCs are copied."); return;
    }
    if (w[0] == "empty" && (w.size() == 2 || w.size() == 3)) {
        int cols = 0, rows = 0;
        if (!boundedInt(w[1], cols, 4, kAdminArenaMaxSize) ||
            (w.size() == 3 && !boundedInt(w[2], rows, 4, kAdminArenaMaxSize))) { out("Size must be 4-128 tiles per axis."); return; }
        if (w.size() == 2) rows = cols;
        std::vector<std::uint8_t> cells(cols*rows, std::uint8_t(Tile::Open)); border(cells, cols, rows);
        terrain_->clearCollisionShapes(kAdminArenaRealm);
        terrain_->setTiles(cells, cols, rows, kAdminArenaRealm);
        refreshHostedArena(true); out("Created an empty hosted arena with boundary walls."); return;
    }
    if ((w[0] == "wall" || w[0] == "floor") && w.size() == 2) {
        const int theme = adminArenaTheme(w[1]);
        if (theme < 0) { out("Theme: garden, hel, desert, computer or jungle."); return; }
        if (w[0] == "wall") terrain_->adminArenaWall = theme; else terrain_->adminArenaFloor = theme;
        refreshHostedArena(false); out("Hosted arena theme updated."); return;
    }
    if (w[0] == "pvp" && w.size() == 2 && (w[1] == "on" || w[1] == "off")) {
        hostedArenaPvp_ = w[1] == "on"; refreshHostedArena(false); out("Hosted arena PvP " + w[1] + "."); return;
    }
    if (w[0] == "build" && w.size() == 6) {
        int x=0,y=0,width=0,height=0;
        const int cols=terrain_->tileCols(kAdminArenaRealm), rows=terrain_->tileRows(kAdminArenaRealm);
        if (!boundedInt(w[1],x,1,cols-2) || !boundedInt(w[2],y,1,rows-2) ||
            !boundedInt(w[3],width,1,cols-2) || !boundedInt(w[4],height,1,rows-2) ||
            x+width>cols-1 || y+height>rows-1 || (w[5]!="wall" && w[5]!="open")) {
            out("Use interior tile coordinates: arena build x y width height wall|open. Boundary walls are protected."); return;
        }
        std::vector<std::uint8_t> cells(terrain_->tiles(kAdminArenaRealm), terrain_->tiles(kAdminArenaRealm)+terrain_->tileCount(kAdminArenaRealm));
        for(int row=y;row<y+height;++row) for(int col=x;col<x+width;++col)
            cells[row*cols+col]=std::uint8_t(w[5]=="wall"?Tile::Solid:Tile::Open);
        if (std::find(cells.begin(),cells.end(),std::uint8_t(Tile::Open))==cells.end()) { out("At least one open tile must remain."); return; }
        terrain_->clearCollisionShapes(kAdminArenaRealm); terrain_->setTiles(cells,cols,rows,kAdminArenaRealm);
        refreshHostedArena(false); out("Hosted arena tiles updated."); return;
    }
    out("Invalid arena command. Use /admin arena help.");
}
} // namespace flix
