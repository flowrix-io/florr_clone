#include "server/game_server.h"
#include "server/text.h"
#include "shared/game/admin_arena.h"
#include "shared/game/config.h"
#include "shared/game/hosted_teams.h"
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
    hostedArenaTeams_=saved["teams"].isObject()?saved["teams"]:Json::object();
    hostedArenaKit_ = saved["kit"];
    hostedArenaRules_ = saved["rules"].isObject() ? saved["rules"] : Json::object();
    rebuildHostedRules();
}
void GameServer::saveHostedArena() {
    Json record = Json::object();
    record["cols"] = terrain_->tileCols(kAdminArenaRealm);
    record["rows"] = terrain_->tileRows(kAdminArenaRealm);
    record["floor"] = kAdminArenaThemes[terrain_->adminArenaFloor].name;
    record["wall"] = kAdminArenaThemes[terrain_->adminArenaWall].name;
    record["pvp"] = hostedArenaPvp_;
    record["teams"]=hostedArenaTeams_;
    record["kit"] = hostedArenaKit_;
    record["rules"] = hostedArenaRules_;
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
                teleportEntity(e, terrain_->resolveCircle(at->position, body ? body->radius : kPlayerBaseRadius, kAdminArenaRealm), false);
            }
            syncKitPvp(world_, e, hostedArenaPvp_);
        }
        applyHostedTeam(player);
        sendRealmChange(player, world_.get<Transform>(player.entity).position, true);
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
    if(entering)applyHostedKit(player);else endHostedKit(player);
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
    applyHostedTeam(player);
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
        hostedArenaPvp_ = w[1] == "on";
        for(auto& [id,s]:sessions_)if(s.playing()&&s.realm==kAdminArenaRealm)
            for(Entity e:bodiesOf(s))syncKitPvp(world_,e,hostedArenaPvp_);
        saveHostedArena();out("Hosted arena PvP " + w[1] + ".");return;
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

namespace flix {
void GameServer::clearHostedGear(Session& s) {
    std::vector<Entity> gear;Query<Transform> owned{world_};
    owned.each([&](Entity e,Transform&){
        Entity owner=NULL_ENTITY;
        if(const auto* p=world_.tryGet<PetalInstance>(e))owner=p->owner;
        else if(const auto* pet=world_.tryGet<Pet>(e))owner=pet->owner;
        else if(const auto* shot=world_.tryGet<Projectile>(e))owner=shot->creditTo!=NULL_ENTITY?shot->creditTo:shot->owner;
        else if(const auto* field=world_.tryGet<GroundEffect>(e))owner=field->owner;
        if(owner!=NULL_ENTITY && (owner==s.entity || (s.splitOther!=NULL_ENTITY&&owner==s.splitOther)))gear.push_back(e);
    });for(Entity e:gear)destroyBody(e);
}
int GameServer::hostedTeamFor(const Session& s) const {
    const auto mode=hostedArenaTeams_["mode"].asString();
    if(mode=="solo")return s.userId==hostedArenaTeams_["leader"].asString()?1:2;
    if(mode=="admins")return effectiveAdmin(s)?1:2;
    if(mode=="manual")return std::clamp(hostedArenaTeams_["assignments"][s.userId].asInt(2),1,4);
    return 0;
}
void GameServer::applyHostedTeam(Session& s) {
    for(Entity e:bodiesOf(s))if(auto* side=world_.tryGet<Faction>(e)){
        const auto* at=world_.tryGet<Transform>(e);
        side->hostedTeam=at&&at->realm==kAdminArenaRealm?hostedTeamFor(s):0;
    }
}
void GameServer::endHostedKit(Session& s) {
    for(Entity e:bodiesOf(s))if(auto* side=world_.tryGet<Faction>(e))side->hostedTeam=0;
    s.eventRestricted.reset();
    if(!s.eventKit)return;
    clearHostedGear(s);
    s.eventKit.reset();
    const auto& record=database_.progress(s.userId);
    for(Entity e:bodiesOf(s))if(auto* progress=world_.tryGet<PlayerProgress>(e)){progress->totalXp=s.realm==Realm::Maze?record.mazeTotalXp:record.totalXp;progress->level=levelFromTotalXp(progress->totalXp).level;}
    applyAccountToSession(s);
}
void GameServer::applyHostedKit(Session& s) {
    const double stars = s.eventKit ? s.eventKit->stars : database_.progress(s.userId).stars;
    if (!s.eventKit) clearHostedGear(s);
    endHostedKit(s);
    auto kit = std::make_unique<PlayerRecord>(database_.progress(s.userId));
    if (hostedArenaKit_.isObject()) {
        const auto stored = parsePlayerRecord(hostedArenaKit_);
        kit->inventory = stored.inventory; kit->loadout = stored.loadout;
    }
    kit->stars = stars;
    s.eventKit = std::move(kit);
    enforceHostedRules(s);
    if(auto* progress=world_.tryGet<PlayerProgress>(s.entity)){
        progress->totalXp=s.eventKit->totalXp;progress->level=levelFromTotalXp(progress->totalXp).level;
    }
    applyHostedTeam(s);
}
void GameServer::rebuildHostedRules() {
    // Replies must round-trip through the rules editor, including old saves.
    for (const char* key : {"bannedPetals", "bannedRarities", "petalBans"})
        if (!hostedArenaRules_[key].isArray()) hostedArenaRules_[key]=Json::array();
    hostedArenaAllowed_.assign(content().petalCount(),0);
    const int maximum=std::clamp(hostedArenaRules_["maxRarity"].asInt(kRarityCount-1),0,kRarityCount-1);
    for (std::size_t i=0;i<content().petalCount();++i) {
        const auto& petal=content().petal(i);
        const bool healing=petal.burstHeal>0 || petal.passiveHeal>0 || petal.killHeal>0 || petal.lifesteal>0 || petalBoostsHealing(petal) || petal.id=="yggdrasil";
        const bool summon=petal.id.size()>=4 && petal.id.compare(petal.id.size()-4,4,"_egg")==0;
        bool banned=(hostedArenaRules_["noHealing"].asBool()&&healing) ||
                    (hostedArenaRules_["noProjectiles"].asBool()&&petal.projectile.present) ||
                    (hostedArenaRules_["noSummons"].asBool()&&summon) ||
                    (hostedArenaRules_["noAdmin"].asBool()&&petal.isAdminPetal);
        for (const auto& id:hostedArenaRules_["bannedPetals"].items()) if(id.asString()==petal.id)banned=true;
        if(banned)continue;
        for(int rarity=0;rarity<=maximum;++rarity) {
            if(rarity==int(Rarity::Admin)&&hostedArenaRules_["noAdmin"].asBool())continue;
            bool blocked=false;for(const auto& r:hostedArenaRules_["bannedRarities"].items())if(r.asInt(-1)==rarity)blocked=true;
            for(const auto& ban:hostedArenaRules_["petalBans"].items())
                if(ban["id"].asString()==petal.id&&(ban["rarity"].asInt(-1)==-1||ban["rarity"].asInt(-1)==rarity))blocked=true;
            if(!blocked)hostedArenaAllowed_[i]|=1u<<rarity;
        }
    }
}
void GameServer::enforceHostedRules(Session& s) {
    if (!s.eventKit) return;
    auto& kit=*s.eventKit;
    if (!s.eventRestricted) s.eventRestricted = std::make_unique<PlayerRecord>();
    auto& hidden = *s.eventRestricted;
    hidden.loadout.resize(kit.loadout.size());
    const auto allowed=[&](const std::string& id,int rarity) {
        const auto index=content().petalIndex(id);
        return index<hostedArenaAllowed_.size() && rarity>=0 && rarity<kRarityCount &&
               (hostedArenaAllowed_[index] & (1u<<rarity));
    };
    const int slots=std::clamp(hostedArenaRules_["activeSlots"].asInt(kLoadoutActiveSlots),1,int(kLoadoutActiveSlots));
    const auto slotAllowed = [&](std::size_t i, const StoredItem& item) {
        return allowed(item.petalType, int(item.rarity)) &&
               !(i < kLoadoutActiveSlots && i >= std::size_t(slots));
    };
    // Return only newly permitted gear. Other bans still apply, and unrelated
    // inventory, loot, and player loadout changes survive rule edits.
    for (int r=0;r<kRarityCount;++r) {
        const std::string rarity=rarityName(Rarity(r));
        const auto keys=hidden.inventory[rarity].keys();
        for (const auto& key:keys) {
            if (key.rfind("petal_",0)==0 && allowed(key.substr(6),r)) {
                kit.addItem(Rarity(r),key,hidden.itemCount(Rarity(r),key));
                hidden.inventory[rarity].erase(key);
            }
        }
    }
    for (std::size_t i=0;i<kit.loadout.size();++i) {
        auto& saved=hidden.loadout[i];
        if (saved && slotAllowed(i,*saved)) {
            if (!kit.loadout[i]) kit.loadout[i]=saved;
            else kit.addItem(saved->rarity,"petal_"+saved->petalType,1);
            saved.reset();
        }
        auto& slot=kit.loadout[i];
        if (slot && !slotAllowed(i,*slot)) {
            if (saved) hidden.addItem(saved->rarity,"petal_"+saved->petalType,1);
            saved=slot;
            slot.reset();
        }
    }
    for(int r=0;r<kRarityCount;++r) {
        const std::string rarity=rarityName(Rarity(r));
        const auto keys=kit.inventory[rarity].keys();
        for(const auto& key:keys) {
            if(key.rfind("petal_",0)==0 && !allowed(key.substr(6),r)) {
                hidden.addItem(Rarity(r),key,kit.itemCount(Rarity(r),key));
                kit.inventory[rarity].erase(key);
            }
        }
    }
}
void GameServer::runEventSetup(Session& host,net::Connection& peer,const Json& q) {
    const auto kind=q["kind"].asString(),action=q["action"].asString();
    const auto fail=[&](const std::string& msg){sendAdminTools(host,peer,kind,false,msg);};
    if(!host.admin||!adminMay(host,AdminPower::SpawnMobs)){fail("Full admin hosting permission required.");return;}
    if(kind!="event" && kind!="arena"){fail("Invalid tool.");return;}
    std::string message="Event presets and temporary kits";
    if(kind=="arena"&&action!="stroke"&&action!="update"){fail("Unknown arena action.");return;}
    if(kind=="arena"&&action=="update"){
        refreshHostedArena(false);
        if(!database_.save()){fail("Map updated but could not be saved to disk.");return;}
        sendAdminTools(host,peer,"arena",true,"Map updated for everyone and saved.");return;
    }
    if(action=="rules") {
        if(!adminMay(host,AdminPower::GivePetals)){fail("Event restrictions require tier 1-2 access.");return;}
        const Json rules=q["rules"];
        const double max=rules["maxRarity"].asDouble(-1),slots=rules["activeSlots"].asDouble(-1);
        if(!rules.isObject()||!std::isfinite(max)||max<0||max>=kRarityCount||std::floor(max)!=max||
           !std::isfinite(slots)||slots<1||slots>kLoadoutActiveSlots||std::floor(slots)!=slots||
           !rules["bannedPetals"].isArray()||rules["bannedPetals"].size()>128||
           !rules["bannedRarities"].isArray()||rules["bannedRarities"].size()>kRarityCount){fail("Invalid event rules.");return;}
        for(const auto& id:rules["bannedPetals"].items())if(content().petalIndex(id.asString())==kInvalidIndex){fail("Unknown banned petal.");return;}
        for(const auto& r:rules["bannedRarities"].items()){const double n=r.asDouble(-1);if(!std::isfinite(n)||n<0||n>=kRarityCount||std::floor(n)!=n){fail("Invalid banned rarity.");return;}}
        if(rules.contains("petalBans")){
            if(!rules["petalBans"].isArray()||rules["petalBans"].size()>256){fail("Invalid petal bans.");return;}
            for(const auto& ban:rules["petalBans"].items()){
                const double r=ban["rarity"].asDouble(-2);
                if(content().petalIndex(ban["id"].asString())==kInvalidIndex||!std::isfinite(r)||r< -1||r>=kRarityCount||std::floor(r)!=r){fail("Invalid petal ban.");return;}
            }
        }
        hostedArenaRules_=rules;rebuildHostedRules();saveHostedArena();
        message="Rules applied and autosaved. Restricted gear is removed from temporary bags only.";
    }
    if(action=="petal_ban") {
        if(!adminMay(host,AdminPower::GivePetals)){fail("Event restrictions require tier 1-2 access.");return;}
        const auto name=trimmed(q["item"].asString());const double r=q["rarity"].asDouble(-2);
        if(name.empty()||name.size()>128||!std::isfinite(r)||r< -1||r>=kRarityCount||std::floor(r)!=r){fail("Choose a petal name and a rarity (or all rarities).");return;}
        auto index=content().petalIndex(name);
        if(index==kInvalidIndex){
            for(std::uint16_t i=0;i<content().petalCount();++i)if(lowerCase(content().petal(i).name)==lowerCase(name)){
                if(index!=kInvalidIndex){fail("Ambiguous petal name; select a search result.");return;}index=i;
            }
        }
        if(index==kInvalidIndex){fail("Petal name not found.");return;}
        const auto& petal=content().petal(index);Json bans=Json::array();
        for(const auto& ban:hostedArenaRules_["petalBans"].items())
            if(ban["id"].asString()!=petal.id||ban["rarity"].asInt(-2)!=int(r))bans.push(ban);
        if(!q["remove"].asBool()){
            if(bans.size()>=256){fail("Maximum 256 petal bans.");return;}
            Json ban=Json::object();ban["id"]=petal.id;ban["rarity"]=int(r);bans.push(ban);
        }else if(r== -1){
            Json legacy=Json::array();for(const auto& id:hostedArenaRules_["bannedPetals"].items())if(id.asString()!=petal.id)legacy.push(id);
            hostedArenaRules_["bannedPetals"]=legacy;
        }
        hostedArenaRules_["petalBans"]=bans;rebuildHostedRules();saveHostedArena();
        message=std::string(q["remove"].asBool()?"Unbanned ":"Banned ")+petal.name+" / "+(r== -1?"all rarities":rarityLabel(Rarity(int(r))));
    }
    if(action=="team_mode"||action=="team_assign"){
        const auto mode=q["mode"].asString();
        if(action=="team_mode"){
            if(mode!="none"&&mode!="ffa"&&mode!="solo"&&mode!="admins"&&mode!="manual"){fail("Unknown team mode.");return;}
            if(mode=="none")hostedArenaTeams_=Json::object();
            hostedArenaTeams_["mode"]=mode;
            if(mode=="solo")hostedArenaTeams_["leader"]=host.userId;
        }else{
            const double n=q["team"].asDouble(-1);const auto id=q["player"].asString();
            bool present=false;for(const auto& [cid,s]:sessions_)if(s.authenticated()&&s.userId==id&&s.realm==kAdminArenaRealm)present=true;
            if(!present||!std::isfinite(n)||n<1||n>4||std::floor(n)!=n){fail("Select an arena participant and team.");return;}
            // Freeze automatic sides before a manual adjustment, so one edit
            // never silently moves everybody else's team.
            if(hostedArenaTeams_["mode"].asString()!="manual"){
                Json assignments=Json::object();for(const auto& [cid,s]:sessions_)if(s.authenticated()&&s.realm==kAdminArenaRealm)assignments[s.userId]=hostedTeamFor(s)?hostedTeamFor(s):2;
                hostedArenaTeams_["assignments"]=assignments;
            }
            hostedArenaTeams_["mode"]="manual";hostedArenaTeams_["assignments"][id]=int(n);
        }
        const bool normal=action=="team_mode"&&mode=="none";
        if(!normal)hostedArenaPvp_=true;
        for(auto& [cid,s]:sessions_)if(s.playing()&&s.realm==kAdminArenaRealm){
            applyHostedTeam(s);for(Entity e:bodiesOf(s))syncKitPvp(world_,e,hostedArenaPvp_);
            if(auto* c=listener_.find(cid))sendSystem(*c,normal?"Teams disabled. Normal PvP rules apply.":hostedTeamFor(s)?"Arena team: "+std::string(kHostedTeamNames[hostedTeamFor(s)])+". Teammates cannot damage one another.":"Arena: free for all.");
        }
        saveHostedArena();message=normal?"Teams cleared and autosaved. PvP unchanged.":"Teams applied and autosaved. PvP enabled.";
    }
    if(action=="save_current"){saveHostedArena();if(!database_.save()){fail("Could not save arena to disk.");return;}message="Arena saved to disk.";}

    if(kind=="arena" && action=="stroke") {
        const auto& points=q["points"];const double size=q["size"].asDouble();
        if(!points.isArray()||points.size()>512||!std::isfinite(size)||size<1||size>16||std::floor(size)!=size){fail("Invalid brush stroke.");return;}
        const int cols=terrain_->tileCols(kAdminArenaRealm),rows=terrain_->tileRows(kAdminArenaRealm);
        std::vector<std::uint8_t> cells(terrain_->tiles(kAdminArenaRealm),terrain_->tiles(kAdminArenaRealm)+terrain_->tileCount(kAdminArenaRealm));
        for(const auto& point:points.items()) {
            if(!point.isArray()||point.size()!=2){fail("Invalid brush point.");return;}
            const double x=point[0].asDouble(-1),y=point[1].asDouble(-1);
            if(!std::isfinite(x)||!std::isfinite(y)||x<1||y<1||x>=cols-1||y>=rows-1||std::floor(x)!=x||std::floor(y)!=y){fail("Brush point outside map.");return;}
            for(int row=int(y);row<std::min(rows-1,int(y+size));++row)for(int col=int(x);col<std::min(cols-1,int(x+size));++col)cells[row*cols+col]=std::uint8_t(q["erase"].asBool()?Tile::Open:Tile::Solid);
        }
        if(std::find(cells.begin(),cells.end(),std::uint8_t(Tile::Open))==cells.end()){fail("At least one open tile must remain.");return;}
        terrain_->setTiles(cells,cols,rows,kAdminArenaRealm);refreshHostedArena(false);sendAdminTools(host,peer,kind,true,"Brush applied.");return;
    }
    if(kind=="arena"){fail("Unknown arena action.");return;}
    const auto name=q["name"].asString();
    const bool validName=!name.empty() && name.size()<=32 && name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")==std::string::npos;
    if(action=="save"||action=="load"||action=="delete") {
        if(!validName){fail("Event name: 1-32 letters, digits, _ or -.");return;}
        if(action=="save") {
            const auto& events=database_.storedTable("adminEvents");
            if(events.size()>=50&&!events.contains(name)){fail("Maximum 50 saved events.");return;}
            saveHostedArena();database_.rawTable("adminEvents")[name]=database_.storedTable("adminArena");message="Saved event "+name;
        } else if(action=="delete") {database_.rawTable("adminEvents").erase(name);message="Deleted event "+name;}
        else {
            const auto event=database_.storedTable("adminEvents")[name];
            if(!event.isObject()){fail("Event not found.");return;}
            if((event["kit"].isObject()||event["rules"].size()>0)&&!adminMay(host,AdminPower::GivePetals)){fail("This event's kit requires tier 1-2 admin access.");return;}
            database_.rawTable("adminArena")=event;initHostedArena();refreshHostedArena(true);message="Loaded event "+name;
        }
        database_.markDirty();
    }
    const bool kitAction=action=="capture"||action=="clear"||action=="off"||action=="add"||action=="slot"||action=="remove"||action=="clear_slot";
    if(kitAction) {
        if(!adminMay(host,AdminPower::GivePetals)){fail("Temporary kits require tier 1-2 admin access.");return;}
        PlayerRecord kit=hostedArenaKit_.isObject()?parsePlayerRecord(hostedArenaKit_):PlayerRecord{};
        if(action=="capture") {kit=liveRecord(host);kit.stars=0;}
        else if(action=="clear")kit=PlayerRecord{};
        else if(action=="clear_slot") {
            const double slot=q["slot"].asDouble(-1);if(!std::isfinite(slot)||slot<0||slot>=kLoadoutSlots||std::floor(slot)!=slot){fail("Invalid kit slot.");return;}
            kit.loadout.resize(kLoadoutSlots);kit.loadout[int(slot)].reset();
        }
        else if(action=="add"||action=="slot"||action=="remove") {
            const auto item=q["item"].asString();const auto type=content().petalIndex(item);const double r=q["rarity"].asDouble(-1),n=q["amount"].asDouble(-1);
            if(type==kInvalidIndex||!std::isfinite(r)||!std::isfinite(n)||r<0||r>=kRarityCount||std::floor(r)!=r||n<1||n>1000000||std::floor(n)!=n){fail("Invalid kit item, rarity or amount.");return;}
            if(action=="remove")kit.addItem(Rarity(int(r)),"petal_"+item,-int(n));
            else if(action=="add")kit.addItem(Rarity(int(r)),"petal_"+item,int(n));
            else {
                const double slot=q["slot"].asDouble(-1);if(!std::isfinite(slot)||slot<0||slot>=kLoadoutSlots||std::floor(slot)!=slot){fail("Invalid kit slot.");return;}
                kit.loadout.resize(kLoadoutSlots);StoredItem stored;stored.petalType=item;stored.rarity=Rarity(int(r));kit.loadout[int(slot)]=stored;
            }
        }
        if(action=="off")hostedArenaKit_=Json{};
        else {
            const Json stored=playerRecordJson(kit);hostedArenaKit_=Json::object();
            hostedArenaKit_["inventory"]=stored["inventory"];hostedArenaKit_["loadout"]=stored["loadout"];
            hostedArenaKit_["loadoutInInventory"]=stored["loadoutInInventory"];
        }
        saveHostedArena();message="Temporary event kit updated. Normal inventories stay saved.";
    }
    if(kitAction||action=="load"||action=="rules"||action=="petal_ban")for(auto& [id,s]:sessions_)if(s.playing()&&s.realm==kAdminArenaRealm){persistPlayer(s);if(action=="rules"||action=="petal_ban"){clearHostedGear(s);enforceHostedRules(s);}else applyHostedKit(s);applyAccountToSession(s);if(auto* c=listener_.find(id))sendProfile(s,*c);}
    Json data=Json::object(),events=Json::array();for(const auto& key:database_.storedTable("adminEvents").keys())events.push(key);
    data["rules"]=hostedArenaRules_;data["teams"]=hostedArenaTeams_;
    std::vector<Json> roster;for(const auto& [cid,s]:sessions_)if(s.authenticated()&&s.realm==kAdminArenaRealm){Json row=Json::object();row["id"]=s.userId;row["name"]=s.username;row["team"]=hostedTeamFor(s);roster.push_back(row);}
    std::sort(roster.begin(),roster.end(),[](const Json& a,const Json& b){return a["name"].asString()<b["name"].asString();});
    int offset=std::clamp(q["offset"].asInt(),0,int(roster.size()));Json players=Json::array();for(int i=offset;i<int(roster.size())&&i<offset+6;++i)players.push(roster[i]);
    data["players"]=players;data["playerCount"]=int(roster.size());data["offset"]=offset;
    data["events"]=events;data["kitEnabled"]=hostedArenaKit_.isObject();data["kit"]=hostedArenaKit_;
    sendAdminTools(host,peer,"event",true,message,data);
}
}
