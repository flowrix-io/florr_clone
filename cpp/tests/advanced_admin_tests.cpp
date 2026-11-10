#include "test.h"
#include "server_harness.h"
#include "render_rig.h"
#include "client/ui/admin_tools_ui.h"
#include "client/ui/menus.h"
using namespace flix;
using namespace flix::testsupport;
namespace {
void seedWallet(const std::string& path,const char* name,double stars,bool admin=false) {
    seedUser(path,name,"password7",admin);Database db;std::string error;CHECK(db.load(path,error));db.progress(db.findUser(name)->id).stars=stars;db.markDirty();CHECK(db.save());
}
PlayerRecord& wallet(Harness& h,const char* name){auto& db=const_cast<Database&>(h.server.database());return db.progress(db.findUser(name)->id);}
bool request(Harness& h,NetClient& client,const std::string& kind,const std::string& action,Json q=Json::object()) {
    const auto revision=client.adminTools(kind)["revision"].asDouble();q["kind"]=kind;q["action"]=action;client.requestAdminTools(q);
    return h.stepUntil({&client},[&]{return client.adminTools(kind)["revision"].asDouble()>revision;},120);
}
Json rules() {Json r=Json::object();r["maxRarity"]=kRarityCount-1;r["activeSlots"]=int(kLoadoutActiveSlots);r["bannedPetals"]=Json::array();r["bannedRarities"]=Json::array();return r;}
}
TEST(advanced_admin_named_codes_require_full_admin_and_redeem_once) {
    Harness h("advanced-codes",[](const std::string& path){seedWallet(path,"boss",100,true);seedWallet(path,"visitor",10);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,visitor;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    Json q=Json::object();q["name"]="Event_Night";q["stars"]=50;q["uses"]=1;
    CHECK(request(h,visitor,"codes","create",q));CHECK(!visitor.adminTools("codes")["ok"].asBool());
    CHECK(request(h,boss,"codes","create",q));CHECK_EQ(boss.adminTools("codes")["rows"][0]["name"].asString(),"EVENT_NIGHT");
    q["stars"]=-1;CHECK(request(h,boss,"codes","create",q));CHECK(!boss.adminTools("codes")["ok"].asBool());
    const double before=wallet(h,"visitor").stars;visitor.requestRedeemCode("EVENT_NIGHT");CHECK(h.stepUntil({&visitor},[&]{return wallet(h,"visitor").stars==before+50;}));
    visitor.requestRedeemCode("EVENT_NIGHT");h.step(8,{&visitor});CHECK_EQ(wallet(h,"visitor").stars,before+50);
    CHECK(request(h,boss,"codes","list"));CHECK_EQ(boss.adminTools("codes")["rows"].size(),std::size_t(0));
}
TEST(advanced_admin_events_restore_real_inventory_and_enforce_rules_on_modified_clients) {
    Harness h("advanced-events",[](const std::string& path){seedWallet(path,"boss",100,true);seedWallet(path,"visitor",30);seedStack(path,"visitor","petal_basic",Rarity::Common,9);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,visitor;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    const Entity unowned=h.server.world().create();h.server.world().add<Transform>(unowned);
    boss.joinGame(1000,800,kAdminArenaSpawnChoice,"Boss");visitor.joinGame(1000,800,{},"Visitor");CHECK(h.stepUntil({&boss,&visitor},[&]{return boss.status()==NetClient::Status::Playing&&visitor.status()==NetClient::Status::Playing;}));
    CHECK(h.server.world().isAlive(unowned));
    CHECK(request(h,boss,"event","clear"));Json q=Json::object();q["item"]="rose";q["rarity"]=2;q["amount"]=5;q["slot"]=0;
    CHECK(request(h,boss,"event","add",q));
    q["item"]="basic";CHECK(request(h,boss,"event","add",q));q["item"]="rose";
    CHECK(request(h,boss,"event","slot",q));
    const auto normal=wallet(h,"visitor").inventory.dump();const double stars=wallet(h,"visitor").stars,xp=wallet(h,"visitor").totalXp;
    CHECK(say(h,boss,"/admin arena bring visitor"));auto* guest=GameServerPeer::sessionOf(h.server,"visitor");CHECK(guest&&guest->eventKit);if(!guest||!guest->eventKit)return;
    CHECK_EQ(guest->eventKit->itemCount(Rarity::Rare,"petal_rose"),5);CHECK_EQ(guest->eventKit->loadout[0]->petalType,"rose");
    Json config=rules();config["lockLoadout"]=true;q["rules"]=config;
    CHECK(request(h,visitor,"event","rules",q));CHECK(!visitor.adminTools("event")["ok"].asBool());
    CHECK(request(h,boss,"event","rules",q));CHECK(boss.adminTools("event")["ok"].asBool());
    visitor.setLoadoutSlot(0,kNoPetal,Rarity::Common);h.step(10,{&visitor});CHECK(guest->eventKit->loadout[0].has_value());
    config["bannedPetals"].push("rose");config["bannedPetals"].push("basic");q["rules"]=config;CHECK(request(h,boss,"event","rules",q));
    CHECK_EQ(guest->eventKit->itemCount(Rarity::Rare,"petal_rose"),0);CHECK_EQ(guest->eventKit->itemCount(Rarity::Rare,"petal_basic"),0);CHECK(!guest->eventKit->loadout[0].has_value());
    config["activeSlots"]=0;q["rules"]=config;CHECK(request(h,boss,"event","rules",q));CHECK(!boss.adminTools("event")["ok"].asBool());
    h.server.world().get<PlayerProgress>(guest->entity).stars=999;h.server.world().get<PlayerProgress>(guest->entity).totalXp=99999;
    q["name"]="night_event";CHECK(request(h,boss,"event","save",q));CHECK(request(h,boss,"event","off"));CHECK(guest->eventKit!=nullptr);
    CHECK_EQ(wallet(h,"visitor").inventory.dump(),normal);CHECK_EQ(wallet(h,"visitor").stars,stars);CHECK_EQ(wallet(h,"visitor").totalXp,xp);
    CHECK(request(h,boss,"event","load",q));CHECK(guest->eventKit!=nullptr);
    CHECK(say(h,boss,"/admin arena return visitor"));CHECK(!guest->eventKit);CHECK_EQ(wallet(h,"visitor").inventory.dump(),normal);CHECK_EQ(wallet(h,"visitor").stars,stars);CHECK_EQ(wallet(h,"visitor").totalXp,xp);
    CHECK_EQ(h.server.world().get<PlayerProgress>(guest->entity).stars,stars);
}
TEST(advanced_admin_map_rules_and_event_presets_survive_a_database_reopen) {
    Harness h("advanced-save",[](const std::string& path){seedWallet(path,"boss",100,true);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss;CHECK(loginAs(h,boss,"boss","password7"));boss.joinGame(1000,800,kAdminArenaSpawnChoice,"Boss");CHECK(h.stepUntil({&boss},[&]{return boss.status()==NetClient::Status::Playing;}));
    CHECK(say(h,boss,"/admin arena empty 12 10"));
    Json q=Json::object(),points=Json::array(),point=Json::array();point.push(3);point.push(4);points.push(point);q["points"]=points;q["size"]=2;
    CHECK(request(h,boss,"arena","stroke",q));CHECK(boss.adminTools("arena")["ok"].asBool());CHECK(h.server.terrain().atTile(3,4,kAdminArenaRealm)==Tile::Solid);
    Json r=rules();r["noProjectiles"]=true;r["bannedRarities"].push(2);q["rules"]=r;CHECK(request(h,boss,"event","rules",q));
    q["name"]="maze_night";CHECK(request(h,boss,"event","save",q));CHECK(request(h,boss,"event","save_current"));
    Database reopened;std::string error;CHECK(reopened.load(h.dbPath,error));const auto& saved=reopened.storedTable("adminArena");CHECK_EQ(saved["cols"].asInt(),12);CHECK_EQ(saved["rows"].asInt(),10);CHECK_EQ(saved["tiles"][4*12+3].asInt(),1);CHECK(saved["rules"]["noProjectiles"].asBool());CHECK(reopened.storedTable("adminEvents")["maze_night"].isObject());
    // Malformed strokes must be atomic: the valid point cannot be painted first.
    point=Json::array();point.push(0);point.push(0);points.push(point);q["points"]=points;q["erase"]=true;
    CHECK(request(h,boss,"arena","stroke",q));CHECK(!boss.adminTools("arena")["ok"].asBool());CHECK(h.server.terrain().atTile(3,4,kAdminArenaRealm)==Tile::Solid);
}
TEST(advanced_admin_panels_and_repeating_arena_walls_render_locally) {
    Harness h("advanced-ui",[](const std::string& path){seedWallet(path,"boss",1000,true);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient client;CHECK(loginAs(h,client,"boss","password7"));
    client.setWorldMaps(&h.server.worldMaps());client.joinGame(1000,800,kAdminArenaSpawnChoice,"Boss");CHECK(h.stepUntil({&client},[&]{return client.status()==NetClient::Status::Playing;}));
    CHECK(fontsReady());SpriteCache sprites;sprites.build(content(),dataDir());WorldRenderer renderer;renderer.setSprites(&sprites);renderer.setWorldMaps(&h.server.worldMaps());renderer.setTerrain(&client.terrain());
    Window window;ClientSettings settings;DragState drag;resetAdminToolsUi();
    for(int panel=0;panel<3;++panel) {
        Canvas canvas=Canvas::createVirtual(760,560);canvas.setFillStyle("#5c5b9c");canvas.fillRect(0,0,760,560);MenuContext ctx{canvas,window,client,sprites,renderer,settings,drag};ctx.bounds={0,0,760,560};
        for(int frame=0;frame<2;++frame){if(panel==0)renderStarCodes(ctx,{12,100,736,420});else if(panel==1)renderEventSetup(ctx,{12,100,736,420});else renderEventRules(ctx,{12,100,736,420});h.step(8,{&client});}
        canvas.savePPM("/tmp/flowrix-admin-panel-"+std::to_string(panel)+".ppm");
    }
    CHECK(say(h,client,"/admin arena empty 8"));h.step(4,{&client});Camera camera;camera.setViewport(760,560);camera.snapTo({128,128});
    Canvas world=Canvas::createVirtual(760,560);renderer.draw(world,client.view(),camera,{128,128},0);world.savePPM("/tmp/flowrix-arena-wall-review.ppm");
    const auto pixels=world.getImageData(0,0,760,560);const auto at=(50*760+50)*4;CHECK(pixels[at]>70 && pixels[at+1]>70 && pixels[at+2]>70);
}
