#include "test.h"
#include "server_harness.h"
#include "render_rig.h"
#include "client/ui/menus.h"
#include "client/ui/admin_tools_ui.h"
#include "server/systems/combat.h"
#include "shared/game/admin_arena.h"
using namespace flix;
using namespace flix::testsupport;
namespace {
bool event(Harness& h,NetClient& client,const char* action,Json q=Json::object()){
    const auto before=client.adminTools("event").dump();q["kind"]="event";q["action"]=action;client.requestAdminTools(q);
    return h.stepUntil({&client},[&]{return client.adminTools("event").dump()!=before;});
}
void seed(const std::string& path){seedUser(path,"host","password7",true);seedUser(path,"alice","password7");seedUser(path,"bob","password7");}
bool join(Harness& h,NetClient& host,NetClient& alice,NetClient& bob){
    if(!loginAs(h,host,"host","password7")||!loginAs(h,alice,"alice","password7")||!loginAs(h,bob,"bob","password7"))return false;
    host.joinGame(1000,800,kAdminArenaSpawnChoice);alice.joinGame(1000,800);bob.joinGame(1000,800);
    if(!h.stepUntil({&host,&alice,&bob},[&]{return host.status()==NetClient::Status::Playing&&alice.status()==NetClient::Status::Playing&&bob.status()==NetClient::Status::Playing;}))return false;
    return say(h,host,"/admin arena bring all");
}
}
TEST(hosted_teams_block_allied_players_pets_and_shots_and_allow_opponents){
    Harness h("hosted-teams",seed,dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient host,alice,bob;CHECK(join(h,host,alice,bob));
    Json q=Json::object();q["mode"]="solo";CHECK(event(h,alice,"team_mode",q));CHECK(!alice.adminTools("event")["ok"].asBool());
    CHECK(event(h,host,"team_mode",q));CHECK(host.adminTools("event")["ok"].asBool());
    auto* a=GameServerPeer::sessionOf(h.server,"alice");auto* b=GameServerPeer::sessionOf(h.server,"bob");auto* boss=GameServerPeer::sessionOf(h.server,"host");CHECK(a&&b&&boss);if(!a||!b||!boss)return;
    World& world=h.server.world();CHECK_EQ(world.get<Faction>(boss->entity).hostedTeam,1);CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,2);CHECK_EQ(world.get<Faction>(b->entity).hostedTeam,2);
    CHECK(!CombatSystem::canDamage(world,a->entity,b->entity));CHECK(CombatSystem::canDamage(world,boss->entity,a->entity));CHECK(CombatSystem::canDamage(world,a->entity,boss->entity));
    const Entity pet=world.create();world.add<Pet>(pet,Pet{a->entity});world.add<Faction>(pet,Faction{Team::Players,true});
    const Entity shot=world.create();Projectile projectile;projectile.owner=pet;projectile.creditTo=a->entity;world.add<Projectile>(shot,projectile);world.add<Faction>(shot,Faction{Team::Players,true});
    CHECK(!CombatSystem::canDamage(world,pet,b->entity));CHECK(!CombatSystem::canDamage(world,shot,b->entity));CHECK(!CombatSystem::canDamage(world,b->entity,pet));CHECK(CombatSystem::canDamage(world,shot,boss->entity));
    q["player"]=a->userId;q["team"]=3;CHECK(event(h,host,"team_assign",q));CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,3);CHECK_EQ(world.get<Faction>(b->entity).hostedTeam,2);CHECK_EQ(world.get<Faction>(boss->entity).hostedTeam,1);CHECK(CombatSystem::canDamage(world,a->entity,b->entity));
    q["team"]=-1;CHECK(event(h,host,"team_assign",q));CHECK(!host.adminTools("event")["ok"].asBool());CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,3);
    Json preset=Json::object();preset["name"]="team_night";CHECK(event(h,host,"save",preset));q["mode"]="ffa";CHECK(event(h,host,"team_mode",q));CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,0);CHECK(event(h,host,"load",preset));CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,3);
    CHECK(say(h,host,"/admin arena return alice"));CHECK_EQ(world.get<Faction>(a->entity).hostedTeam,0);
    CHECK(event(h,host,"save_current"));Database reopened;std::string error;CHECK(reopened.load(h.dbPath,error));CHECK_EQ(reopened.storedTable("adminArena")["teams"]["assignments"][a->userId].asInt(),3);
}
TEST(hosted_petal_name_bans_apply_only_to_selected_rarity_and_preserve_real_bags){
    Harness h("hosted-name-bans",seed,dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient host,alice,bob;CHECK(join(h,host,alice,bob));
    Json q=Json::object();q["item"]="rose";q["rarity"]=int(Rarity::Rare);q["amount"]=3;CHECK(event(h,host,"clear"));CHECK(event(h,host,"add",q));q["slot"]=0;CHECK(event(h,host,"slot",q));q["rarity"]=int(Rarity::Epic);CHECK(event(h,host,"add",q));
    const auto* user=h.server.database().findUser("alice");const auto normal=h.server.database().findProgress(user->id)->inventory.dump();
    q["item"]="Rose";q["rarity"]=int(Rarity::Rare);CHECK(event(h,host,"petal_ban",q));CHECK(host.adminTools("event")["ok"].asBool());
    auto* a=GameServerPeer::sessionOf(h.server,"alice");CHECK(a&&a->eventKit);if(!a||!a->eventKit)return;
    CHECK_EQ(a->eventKit->itemCount(Rarity::Rare,"petal_rose"),0);CHECK_EQ(a->eventKit->itemCount(Rarity::Epic,"petal_rose"),3);CHECK(!a->eventKit->loadout[0]);
    CHECK_EQ(h.server.database().findProgress(user->id)->inventory.dump(),normal);
    q["rarity"]=-1;CHECK(event(h,host,"petal_ban",q));CHECK_EQ(a->eventKit->itemCount(Rarity::Epic,"petal_rose"),0);
    q["rarity"]=999;CHECK(event(h,host,"petal_ban",q));CHECK(!host.adminTools("event")["ok"].asBool());q["rarity"]=-1;q["item"]="does not exist";CHECK(event(h,host,"petal_ban",q));CHECK(!host.adminTools("event")["ok"].asBool());
    q["item"]="Rose";q["remove"]=true;CHECK(event(h,host,"petal_ban",q));CHECK_EQ(host.adminTools("event")["rules"]["petalBans"].size(),std::size_t(1));
}
TEST(hosted_team_and_petal_name_panels_render_locally){
    Harness h("hosted-team-ui",seed,dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient host,alice,bob;CHECK(join(h,host,alice,bob));Json q=Json::object();q["mode"]="solo";CHECK(event(h,host,"team_mode",q));CHECK(fontsReady());
    Window window;ClientSettings settings;DragState drag;SpriteCache sprites;WorldRenderer renderer;
    Canvas teams=Canvas::createVirtual(820,620);MenuContext ctx{teams,window,host,sprites,renderer,settings,drag};resetAdminToolsUi();renderEventTeams(ctx,{24,50,772,380});teams.savePPM("/tmp/flowrix-hosted-teams.ppm");
    q=Json::object();q["item"]="Rose";q["rarity"]=int(Rarity::Ultra);CHECK(event(h,host,"petal_ban",q));Canvas bans=Canvas::createVirtual(820,620);MenuContext banctx{bans,window,host,sprites,renderer,settings,drag};renderPetalBans(banctx,{24,50,772,380});bans.savePPM("/tmp/flowrix-petal-name-bans.ppm");
}

TEST(hosted_personal_gear_allows_saved_loadouts_without_mutating_real_inventory){
    Harness h("hosted-personal-presets",[](const std::string& path){
        seed(path);seedStack(path,"alice","petal_rose",Rarity::Rare,3);
        Database db;std::string error;CHECK(db.load(path,error));auto& record=db.progress(db.findUser("alice")->id);
        std::vector<std::optional<StoredItem>> slots(kLoadoutSlots);StoredItem item;item.petalType="rose";item.rarity=Rarity::Rare;slots[0]=item;
        record.loadoutPresets[loadoutPresetName(0)]=slots;db.markDirty();CHECK(db.save());
    },dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient host,alice,bob;CHECK(join(h,host,alice,bob));CHECK(event(h,host,"off"));
    auto* a=GameServerPeer::sessionOf(h.server,"alice");CHECK(a&&a->eventKit);if(!a||!a->eventKit)return;
    const auto& real=*h.server.database().findProgress(a->userId);const auto before=real.inventory.dump();
    alice.loadLoadoutPreset(0);CHECK(h.stepUntil({&alice},[&]{return a->eventKit->loadout[0]&&a->eventKit->loadout[0]->petalType=="rose";}));CHECK_EQ(real.inventory.dump(),before);
    alice.saveLoadoutPreset(1);CHECK(h.stepUntil({&alice},[&]{return real.loadoutPresets.find(loadoutPresetName(1))!=real.loadoutPresets.end();}));
    Json q=Json::object();q["item"]="Rose";q["rarity"]=int(Rarity::Rare);CHECK(event(h,host,"petal_ban",q));
    alice.loadLoadoutPreset(0);h.step(10,{&alice});CHECK(!a->eventKit->loadout[0]);CHECK_EQ(a->eventKit->itemCount(Rarity::Rare,"petal_rose"),0);CHECK_EQ(real.inventory.dump(),before);
    CHECK(event(h,host,"clear")); // Custom event kits still cannot overwrite saved presets.
    alice.saveLoadoutPreset(2);h.step(8,{&alice});CHECK(real.loadoutPresets.find(loadoutPresetName(2))==real.loadoutPresets.end());
}

TEST(hosted_pvp_and_map_updates_keep_the_world_visible_without_a_teleport_iris){
    Harness h("hosted-no-flash",seed,dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient host,alice,bob;CHECK(join(h,host,alice,bob));
    CHECK(h.stepUntil({&host,&alice,&bob},[&]{return host.view().entities().count(host.view().self().netId)>0;}));
    Vec2 arrival;while(host.takeRealmChange(arrival)){}host.takeTeleported();const auto self=host.view().self().netId;
    CHECK(say(h,host,"/admin arena pvp on"));CHECK(!host.takeTeleported());CHECK(!host.takeRealmChange(arrival));CHECK(host.view().entities().count(self)>0);
    CHECK(say(h,host,"/admin arena pvp off"));CHECK(!host.takeTeleported());CHECK(!host.takeRealmChange(arrival));CHECK(host.view().entities().count(self)>0);
    Json q=Json::object();q["kind"]="arena";q["action"]="update";const auto previous=host.adminTools("arena").dump();host.requestAdminTools(q);
    CHECK(h.stepUntil({&host},[&]{return host.adminTools("arena").dump()!=previous;}));CHECK(host.adminTools("arena")["ok"].asBool());CHECK(!host.takeTeleported());CHECK(host.view().entities().count(self)>0);CHECK(host.takeRealmChange(arrival));
    CHECK(say(h,host,"/admin arena wall desert"));CHECK(!host.takeTeleported());CHECK(host.view().entities().count(self)>0);
}
