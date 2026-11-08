#include "test.h"
#include "render_rig.h"
#include "client/ui/menus.h"
#include "client/ui/market_ui.h"
#include "server_harness.h"
#include "shared/game/economy.h"
#include "server/systems/loot.h"
#include "shared/game/collection.h"
#include <cmath>
using namespace flix;
using namespace flix::testsupport;
namespace {
void seedWallet(const std::string& path,const char* name,double stars,bool admin=false) {
    seedUser(path,name,"password7",admin);Database db;std::string error;CHECK(db.load(path,error));db.progress(db.findUser(name)->id).stars=stars;db.markDirty();CHECK(db.save());
}
PlayerRecord& wallet(Harness& h,const char* name){return const_cast<Database&>(h.server.database()).progress(h.server.database().findUser(name)->id);}
bool request(Harness& h,NetClient& client,const std::string& kind,const std::string& action,Json q=Json::object()) {
    const auto before=client.adminTools(kind).dump();q["kind"]=kind;q["action"]=action;client.requestAdminTools(q);
    return h.stepUntil({&client},[&]{return client.adminTools(kind).dump()!=before;},120);
}
Json posting(const char* item,int rarity,int quantity,int price,bool orders=false){Json q=Json::object();q["item"]=item;q["rarity"]=rarity;q["quantity"]=quantity;q["price"]=price;q["orders"]=orders;return q;}
}
TEST(commerce_market_escrow_partial_fills_fractional_tax_and_replay) {
    Harness h("commerce-market",[](const std::string& path){seedWallet(path,"seller",200);seedWallet(path,"buyer",500);seedStack(path,"seller","petal_basic",Rarity::Common,5);seedStack(path,"seller","petal_rose",Rarity::Rare,7);},dataDir(),0);
    CHECK(h.ready);if(!h.ready)return;NetClient seller,buyer;CHECK(loginAs(h,seller,"seller","password7"));CHECK(loginAs(h,buyer,"buyer","password7"));
    const double sellerStart=wallet(h,"seller").stars,buyerStart=wallet(h,"buyer").stars;
    CHECK(request(h,seller,"market","post",posting("basic",0,5,1)));
    CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),0);
    Json take=Json::object();take["id"]=seller.adminTools("market")["rows"][0]["id"];take["quantity"]=1;
    CHECK(request(h,buyer,"market","take",take));CHECK(std::abs(wallet(h,"seller").stars-sellerStart-0.8)<1e-8);CHECK_EQ(wallet(h,"buyer").stars,buyerStart-1);
    CHECK_EQ(wallet(h,"buyer").itemCount(Rarity::Common,"petal_basic"),1);
    CHECK(request(h,seller,"market","cancel",take));CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),4);
    const double paid=wallet(h,"buyer").stars;CHECK(request(h,buyer,"market","take",take));CHECK(!buyer.adminTools("market")["ok"].asBool());CHECK_EQ(wallet(h,"buyer").stars,paid);
    CHECK(request(h,buyer,"market","post",posting("rose",2,3,9,true)));CHECK_EQ(wallet(h,"buyer").stars,paid-27);
    take["id"]=buyer.adminTools("market")["rows"][0]["id"];take["quantity"]=2;take["orders"]=true;
    CHECK(request(h,seller,"market","take",take));CHECK_EQ(wallet(h,"buyer").itemCount(Rarity::Rare,"petal_rose"),2);CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Rare,"petal_rose"),5);
    CHECK(std::abs(wallet(h,"seller").stars-sellerStart-15.2)<1e-8);
    CHECK(request(h,buyer,"market","cancel",take));CHECK_EQ(wallet(h,"buyer").stars,paid-18);
    CHECK(request(h,seller,"market","post",posting("rose",2,1,8)));CHECK(!seller.adminTools("market")["ok"].asBool());
    CHECK(request(h,seller,"market","post",posting("basic",11,1,100)));CHECK(!seller.adminTools("market")["ok"].asBool());
    CHECK(const_cast<Database&>(h.server.database()).save());Database saved;std::string error;CHECK(saved.load(h.dbPath,error));CHECK_EQ(saved.findProgress(saved.findUser("buyer")->id)->stars,paid-18);
}
TEST(commerce_market_sorting_and_rarity_ranges_are_server_side) {
    Harness h("market-sort",[](const std::string& path){
        seedWallet(path,"seller",100);seedWallet(path,"viewer",100);Database db;std::string error;CHECK(db.load(path,error));const auto owner=db.findUser("seller")->id;
        const auto row=[&](const char* id,int rarity,int price,bool orders){Json r=Json::object();r["id"]=id;r["owner"]=owner;r["item"]="basic";r["rarity"]=rarity;r["price"]=price;r["quantity"]=1;r["orders"]=orders;db.rawTable("petalMarket")[id]=r;};
        row("order_common",0,10000,true);row("order_rare",2,1000,true);row("listing_common",0,5,false);row("listing_rare",2,100,false);row("listing_mythic",5,243,false);row("listing_ultra",6,729,false);db.markDirty();CHECK(db.save());
    },dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient client;CHECK(loginAs(h,client,"viewer","password7"));Json q=Json::object();q["orders"]=true;
    CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["rows"][0]["id"].asString(),"order_common");
    q["orders"]=false;CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["rows"][0]["id"].asString(),"listing_ultra");
    q["sort"]=0;CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["rows"][0]["id"].asString(),"listing_common");
    q["sort"]=1e200;CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["rows"][0]["id"].asString(),"listing_ultra");
    q["sort"]=1;CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["rows"][0]["id"].asString(),"listing_ultra");
    for(const auto& range:std::vector<std::pair<std::string,int>>{{"Rare-",2},{"Ultra+",1},{"Mythic",1}}){q["rarityFilter"]=range.first;CHECK(request(h,client,"market","browse",q));CHECK_EQ(client.adminTools("market")["total"].asInt(),range.second);}
    q["rarityFilter"]="admin+";CHECK(request(h,client,"market","browse",q));CHECK(!client.adminTools("market")["ok"].asBool());
}

TEST(market_mr_bee_is_an_apex_spawn_npc_and_gifts_single_public_copies) {
    Harness h("market-bee",[](const std::string& path){seedUser(path,"visitor","password7");},dataDir(),0);
    CHECK(h.ready);if(!h.ready)return;NetClient client;CHECK(loginAs(h,client,"visitor","password7"));
    client.joinGame(1280,720);CHECK(h.stepUntil({&client},[&]{return client.status()==NetClient::Status::Playing;}));
    World& world=h.server.world();Entity host=NULL_ENTITY;Vec2 home;
    Query<NpcTag,Npc,Transform> npcs{world};
    npcs.each([&](Entity e,NpcTag&,Npc& npc,Transform& at){if(npc.configIndex==content().mobIndex("mr_bee")){host=e;home=npc.home;CHECK_EQ(npc.rarity,Rarity::Apex);CHECK_EQ(npc.service,NpcService::Market);CHECK(npc.cruises);npc.nextMarketGiftMillis=0;}});
    CHECK(host!=NULL_ENTITY);if(host==NULL_ENTITY)return;
    CHECK(!world.has<MobTag>(host));
    CHECK(!content().mobStats(content().mobIndex("mr_bee"),Rarity::Apex).ambient);
    CHECK(content().mob(content().mobIndex("mr_bee")).noEggDrop);
    CHECK(world.get<Body>(host).radius>50);CHECK(world.get<Body>(host).radius<120);
    Query<PlayerTag,Transform> players{world};players.each([&](Entity,PlayerTag&,Transform& at){at.position=home+Vec2{900,0};});
    h.step(35,{&client});int drops=0;
    Query<DropTag,DropItem> items{world};items.each([&](Entity,DropTag&,DropItem& item){++drops;CHECK(item.singleCopy);CHECK(item.humansOnly);CHECK(item.eligible.empty());CHECK(rarityIndex(item.rarity)<=rarityIndex(Rarity::Ultra));});
    CHECK(drops>0);CHECK(world.get<Npc>(host).nextMarketGiftMillis>0);
    for(int sample=0;sample<12;++sample){h.step(30,{&client});CHECK(distanceSq(world.get<Transform>(host).position,home)<=260.*260.+.01);}
}

TEST(market_commands_open_the_correct_gui_without_requiring_admin) {
    Harness h("market-open",[](const std::string& path){seedUser(path,"visitor","password7");},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient client;CHECK(loginAs(h,client,"visitor","password7"));
    client.sendChat("/shop");CHECK(h.stepUntil({&client},[&]{return client.takeMarketRequest();}));CHECK(!client.marketOrdersRequested());
    h.step(16,{&client});client.sendChat("/order");CHECK(h.stepUntil({&client},[&]{return client.takeMarketRequest();}));CHECK(client.marketOrdersRequested());
}

TEST(market_listing_escrow_survives_relogin_and_database_save) {
    Harness h("market-relogin",[](const std::string& path){seedWallet(path,"seller",200);seedStack(path,"seller","petal_basic",Rarity::Common,5);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient seller;CHECK(loginAs(h,seller,"seller","password7"));
    CHECK(request(h,seller,"market","post",posting("basic",0,3,1)));
    const auto id=seller.adminTools("market")["rows"][0]["id"];
    CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),2);
    seller.disconnect();h.step(3,{});h.server.persistAll();
    Database saved;std::string error;CHECK(saved.load(h.dbPath,error));
    CHECK_EQ(saved.findProgress(saved.findUser("seller")->id)->itemCount(Rarity::Common,"petal_basic"),2);
    CHECK_EQ(saved.storedTable("petalMarket")[id.asString()]["quantity"].asInt(),3);
    NetClient again;CHECK(loginAs(h,again,"seller","password7"));
    CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),2);
    Json q=Json::object();q["id"]=id;
    CHECK(request(h,again,"market","cancel",q));CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),5);
    CHECK(request(h,again,"market","cancel",q));CHECK(!again.adminTools("market")["ok"].asBool());CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),5);
}

TEST(market_shop_and_order_tabs_render_locally_and_preferences_roundtrip) {
    Harness h("market-render",[](const std::string& path){seedWallet(path,"seller",200);seedStack(path,"seller","petal_basic",Rarity::Common,5);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient client;CHECK(loginAs(h,client,"seller","password7"));CHECK(request(h,client,"market","post",posting("basic",0,3,1)));CHECK(fontsReady());
    SpriteCache sprites;WorldRenderer renderer;Window window;ClientSettings settings;DragState drag;ShopPanel shop;
    MenuSystem menus;menus.setNearbyNpc({NpcService::Market,content().mobIndex("mr_bee"),Rarity::Apex,0});menus.toggle(MenuId::Crafting);CHECK_EQ(menus.open(),MenuId::Shop);
    shop.openMarket();shop.setSlide(1,false);
    Canvas canvas=Canvas::createVirtual(900,680);MenuContext ctx{canvas,window,client,sprites,renderer,settings,drag};ctx.bounds=ShopPanel::bounds(900,680);shop.render(ctx);canvas.savePPM("/tmp/flowrix-market-gui.ppm");
    shop.openMarket(true);shop.render(ctx);canvas.savePPM("/tmp/flowrix-orders-gui.ppm");
    CHECK_EQ(settings.marketListingSort,1);settings.marketListingSort=0;settings.marketOrderSort=2;settings.marketRarityFilter="Ultra+";
    const auto path=tempPath("market-settings");CHECK(settings.save(path));ClientSettings loaded;CHECK(loaded.load(path));CHECK_EQ(loaded.marketListingSort,0);CHECK_EQ(loaded.marketOrderSort,2);CHECK_EQ(loaded.marketRarityFilter,std::string("Ultra+"));std::remove(path.c_str());
}

TEST(market_public_gift_is_collectible_by_only_one_player) {
    Harness h("market-public",[](const std::string& path){seedWallet(path,"alice",10);seedWallet(path,"bob",10);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient alice,bob;CHECK(loginAs(h,alice,"alice","password7"));CHECK(loginAs(h,bob,"bob","password7"));alice.joinGame(1280,720);bob.joinGame(1280,720);
    CHECK(h.stepUntil({&alice,&bob},[&]{return alice.status()==NetClient::Status::Playing&&bob.status()==NetClient::Status::Playing;}));
    World& world=h.server.world();Vec2 at;bool found=false;
    Query<PlayerTag,Transform> players{world};players.each([&](Entity,PlayerTag&,Transform& body){if(!found){at=body.position;found=true;}body.position=at;});CHECK(found);
    const auto before=wallet(h,"alice").itemCount(Rarity::Ultra,"petal_basic")+wallet(h,"bob").itemCount(Rarity::Ultra,"petal_basic");
    LootSystem gifts;const auto e=gifts.spawnDrop(world,content().petalIndex("basic"),Rarity::Ultra,at,Realm::Overworld,{});CHECK(e!=NULL_ENTITY);world.get<DropItem>(e).singleCopy=true;world.get<DropItem>(e).humansOnly=true;
    h.step(5,{&alice,&bob});
    CHECK_EQ(wallet(h,"alice").itemCount(Rarity::Ultra,"petal_basic")+wallet(h,"bob").itemCount(Rarity::Ultra,"petal_basic"),before+1);
    CHECK(!world.isAlive(e));
}

TEST(market_numbers_keep_small_prices_exact_and_use_suffixes_for_long_values) {
    CHECK_EQ(marketNumber(0.8),"0.8");CHECK_EQ(marketNumber(999),"999");
    CHECK_EQ(marketNumber(1000),"1,000");CHECK_EQ(marketNumber(19000),"19,000");
    CHECK_EQ(marketNumber(999999),"999,999");CHECK_EQ(marketNumber(12345.8),"12,345.8");
    CHECK_EQ(marketNumber(1e6),"1M");CHECK_EQ(marketNumber(1250000),"1.2M");
    CHECK_EQ(marketNumber(1e9),"1B");CHECK_EQ(marketNumber(1e12),"1T");
    CHECK_EQ(marketNumber(1234567890.8,true),"1,234,567,890.8");
}
TEST(market_long_values_and_sort_labels_render_without_scientific_notation) {
    Harness h("market-long-gui",[](const std::string& path){seedWallet(path,"seller",1234567890.8);seedStack(path,"seller","petal_basic",Rarity::Common,5);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient client;CHECK(loginAs(h,client,"seller","password7"));CHECK(request(h,client,"market","post",posting("basic",0,3,1000000000)));CHECK(fontsReady());
    SpriteCache sprites;WorldRenderer renderer;Window window;ClientSettings settings;DragState drag;ShopPanel shop;
    settings.marketListingSort=1;shop.openMarket();shop.setSlide(1,false);
    Canvas canvas=Canvas::createVirtual(900,680);MenuContext ctx{canvas,window,client,sprites,renderer,settings,drag};ctx.bounds=ShopPanel::bounds(900,680);shop.render(ctx);canvas.savePPM("/tmp/flowrix-market-long-gui.ppm");
    CHECK(ui::measure("Best value",13)<90);
    shop.openMarket(true);Canvas orders=Canvas::createVirtual(900,680);MenuContext orderCtx{orders,window,client,sprites,renderer,settings,drag};orderCtx.bounds=ShopPanel::bounds(900,680);shop.render(orderCtx);orders.savePPM("/tmp/flowrix-orders-long-gui.ppm");
}

TEST(market_mr_bee_stays_in_front_of_overlapping_mobs_and_projectiles) {
    std::string error;CHECK(loadContent(dataDir(),error));CHECK(fontsReady());
    SpriteCache sprites;CHECK(sprites.build(content(),dataDir()));
    constexpr int size=500;const Vec2 at{1000,1000};
    WorldRenderer::EntityMap scene;
    RemoteEntity mob;mob.netId=1;mob.kind=net::EntityKind::Mob;mob.typeIndex=content().mobIndex("rock");mob.position=mob.targetPosition=at;mob.radius=170;mob.healthFraction=1;scene[mob.netId]=mob;
    RemoteEntity shot=mob;shot.netId=2;shot.kind=net::EntityKind::Projectile;shot.typeIndex=content().petalIndex("basic");shot.radius=140;scene[shot.netId]=shot;
    RemoteEntity bee=mob;bee.netId=3;bee.kind=net::EntityKind::Npc;bee.typeIndex=content().mobIndex("mr_bee");bee.rarity=Rarity::Apex;bee.radius=80;bee.plate.opacity=1;
    const auto frame=[&](const WorldRenderer::EntityMap& entities,const char* path){
        Canvas canvas=Canvas::createVirtual(size,size);WorldRenderer renderer;renderer.setContent(&content());renderer.setSprites(&sprites);
        Camera camera=frameCamera(size,at);renderer.draw(canvas,entities,camera,at,0);canvas.savePPM(path);
        return canvas.getImageData(size/2-12,size/2-12,24,24);
    };
    const auto covered=frame(scene,"/tmp/flowrix-market-covered.ppm");
    scene[bee.netId]=bee;const auto front=frame(scene,"/tmp/flowrix-market-mr-bee-front.ppm");
    WorldRenderer::EntityMap alone;alone[bee.netId]=bee;
    const auto expected=frame(alone,"/tmp/flowrix-market-mr-bee-alone.ppm");
    CHECK(differingPixels(covered,expected)>100);CHECK_EQ(differingPixels(front,expected),0);
}
