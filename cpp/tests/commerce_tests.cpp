#include "test.h"
#include "server_harness.h"
#include "render_rig.h"
#include "client/render/skin_render.h"
#include "client/ui/commerce_ui.h"
#include "client/ui/menus.h"
#include "shared/game/economy.h"
#include <cmath>
using namespace flix;
using namespace flix::testsupport;
namespace {
void seedWallet(const std::string& path,const char* name,double stars,bool admin=false) {
    seedUser(path,name,"password7",admin);Database db;std::string error;CHECK(db.load(path,error));db.progress(db.findUser(name)->id).stars=stars;db.markDirty();CHECK(db.save());
}
PlayerRecord& wallet(Harness& h,const char* name){return const_cast<Database&>(h.server.database()).progress(h.server.database().findUser(name)->id);}
bool request(Harness& h,NetClient& client,const std::string& kind,const std::string& action,Json q=Json::object()) {
    const auto before=client.commerce(kind).dump();q["kind"]=kind;q["action"]=action;client.requestCommerce(q);
    return h.stepUntil({&client},[&]{return client.commerce(kind).dump()!=before;},120);
}
Json posting(const char* item,int rarity,int quantity,int price,bool orders=false){Json q=Json::object();q["item"]=item;q["rarity"]=rarity;q["quantity"]=quantity;q["price"]=price;q["orders"]=orders;return q;}
}
TEST(commerce_market_escrow_partial_fills_fractional_tax_and_replay) {
    Harness h("commerce-market",[](const std::string& path){seedWallet(path,"seller",200);seedWallet(path,"buyer",500);seedStack(path,"seller","petal_basic",Rarity::Common,5);seedStack(path,"seller","petal_rose",Rarity::Rare,7);},dataDir(),0);
    CHECK(h.ready);if(!h.ready)return;NetClient seller,buyer;CHECK(loginAs(h,seller,"seller","password7"));CHECK(loginAs(h,buyer,"buyer","password7"));
    const double sellerStart=wallet(h,"seller").stars,buyerStart=wallet(h,"buyer").stars;
    CHECK(request(h,seller,"market","post",posting("basic",0,5,1)));
    CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),0);
    Json take=Json::object();take["id"]=seller.commerce("market")["rows"][0]["id"];take["quantity"]=1;
    CHECK(request(h,buyer,"market","take",take));CHECK(std::abs(wallet(h,"seller").stars-sellerStart-0.8)<1e-8);CHECK_EQ(wallet(h,"buyer").stars,buyerStart-1);
    CHECK_EQ(wallet(h,"buyer").itemCount(Rarity::Common,"petal_basic"),1);
    CHECK(request(h,seller,"market","cancel",take));CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Common,"petal_basic"),4);
    const double paid=wallet(h,"buyer").stars;CHECK(request(h,buyer,"market","take",take));CHECK(!buyer.commerce("market")["ok"].asBool());CHECK_EQ(wallet(h,"buyer").stars,paid);
    CHECK(request(h,buyer,"market","post",posting("rose",2,3,9,true)));CHECK_EQ(wallet(h,"buyer").stars,paid-27);
    take["id"]=buyer.commerce("market")["rows"][0]["id"];take["quantity"]=2;take["orders"]=true;
    CHECK(request(h,seller,"market","take",take));CHECK_EQ(wallet(h,"buyer").itemCount(Rarity::Rare,"petal_rose"),2);CHECK_EQ(wallet(h,"seller").itemCount(Rarity::Rare,"petal_rose"),5);
    CHECK(std::abs(wallet(h,"seller").stars-sellerStart-15.2)<1e-8);
    CHECK(request(h,buyer,"market","cancel",take));CHECK_EQ(wallet(h,"buyer").stars,paid-18);
    CHECK(request(h,seller,"market","post",posting("rose",2,1,8)));CHECK(!seller.commerce("market")["ok"].asBool());
    CHECK(request(h,seller,"market","post",posting("basic",11,1,100)));CHECK(!seller.commerce("market")["ok"].asBool());
    CHECK(const_cast<Database&>(h.server.database()).save());Database saved;std::string error;CHECK(saved.load(h.dbPath,error));CHECK_EQ(saved.findProgress(saved.findUser("buyer")->id)->stars,paid-18);
}
TEST(commerce_skin_fee_paid_ownership_and_price_change_checks) {
    Harness h("commerce-skins",[](const std::string& path){seedWallet(path,"artist",500);seedWallet(path,"buyer",100);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient artist,buyer;CHECK(loginAs(h,artist,"artist","password7"));CHECK(loginAs(h,buyer,"buyer","password7"));
    SkinShape shape;shape.t=SkinShapeType::Rect;shape.rx=20;shape.ry=13;shape.fill="#ac12de";
    const double start=wallet(h,"artist").stars;
    artist.publishSkin("Paid violet",{shape},4);h.step(8,{&artist,&buyer});CHECK_EQ(wallet(h,"artist").stars,start);CHECK(artist.skinCatalog().empty());
    artist.publishSkin("Paid violet",{shape},5);CHECK(h.stepUntil({&artist,&buyer},[&]{return !artist.skinCatalog().empty();}));CHECK_EQ(wallet(h,"artist").stars,start-100);
    const auto id=artist.skinCatalog().front().id;buyer.equipSkin(id);h.step(8,{&artist,&buyer});CHECK(wallet(h,"buyer").equippedSkinId.empty());
    Json q=Json::object();q["id"]=id;q["price"]=6;const double buyerStart=wallet(h,"buyer").stars;
    CHECK(request(h,buyer,"skin","buy",q));CHECK(!buyer.commerce("skin")["ok"].asBool());CHECK_EQ(wallet(h,"buyer").stars,buyerStart);
    q["price"]=5;CHECK(request(h,buyer,"skin","buy",q));CHECK_EQ(wallet(h,"buyer").stars,buyerStart-5);CHECK_EQ(wallet(h,"artist").stars,start-96);
    CHECK(wallet(h,"buyer").extra["ownedSkins"][id].asBool());buyer.equipSkin(id);h.step(8,{&artist,&buyer});CHECK_EQ(wallet(h,"buyer").equippedSkinId,id);
    q["kind"]="skin";q["action"]="buy";buyer.requestCommerce(q);h.step(8,{&buyer});CHECK_EQ(wallet(h,"buyer").stars,buyerStart-5);
    auto& clockDb=const_cast<Database&>(h.server.database());
    static std::int64_t later;later=clockDb.nowMillis()+static_cast<std::int64_t>(kSkinPriceCooldownMillis);
    clockDb.setClock([]{return later;});
    artist.editSkin(id,"Now free",{shape},0);CHECK(h.stepUntil({&artist,&buyer},[&]{return buyer.findSkin(id)&&buyer.findSkin(id)->price==0;}));
    CHECK(buyer.findSkin(id)->owned);

}
TEST(commerce_named_codes_require_full_admin_and_redeem_once) {
    Harness h("commerce-codes",[](const std::string& path){seedWallet(path,"boss",100,true);seedWallet(path,"visitor",10);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient boss,visitor;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    Json q=Json::object();q["name"]="Event_Night";q["stars"]=50;q["uses"]=1;
    CHECK(request(h,visitor,"codes","create",q));CHECK(!visitor.commerce("codes")["ok"].asBool());
    CHECK(request(h,boss,"codes","create",q));CHECK_EQ(boss.commerce("codes")["rows"][0]["name"].asString(),"EVENT_NIGHT");
    const double before=wallet(h,"visitor").stars;visitor.requestRedeemCode("EVENT_NIGHT");CHECK(h.stepUntil({&visitor},[&]{return wallet(h,"visitor").stars==before+50;}));
    visitor.requestRedeemCode("EVENT_NIGHT");h.step(8,{&visitor});CHECK_EQ(wallet(h,"visitor").stars,before+50);
    CHECK(request(h,boss,"codes","list"));CHECK_EQ(boss.commerce("codes")["rows"].size(),std::size_t(0));
}
TEST(commerce_event_kits_restore_inventory_stars_xp_and_saved_presets) {
    Harness h("commerce-events",[](const std::string& path){seedWallet(path,"boss",100,true);seedWallet(path,"visitor",30);seedStack(path,"visitor","petal_basic",Rarity::Common,9);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,visitor;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    boss.joinGame(1000,800,kAdminArenaSpawnChoice,"Boss");visitor.joinGame(1000,800,{},"Visitor");CHECK(h.stepUntil({&boss,&visitor},[&]{return boss.status()==NetClient::Status::Playing&&visitor.status()==NetClient::Status::Playing;}));
    CHECK(request(h,boss,"event","clear"));Json q=Json::object();q["item"]="rose";q["rarity"]=2;q["amount"]=5;q["slot"]=0;CHECK(request(h,boss,"event","add",q));CHECK(request(h,boss,"event","slot",q));
    const auto normal=wallet(h,"visitor").inventory.dump();const double stars=wallet(h,"visitor").stars,xp=wallet(h,"visitor").totalXp;
    auto* beforeGuest=GameServerPeer::sessionOf(h.server,"visitor");
    const Entity oldPet=h.server.world().create();h.server.world().add<Transform>(oldPet);h.server.world().add<Pet>(oldPet).owner=beforeGuest->entity;
    CHECK(say(h,boss,"/admin arena bring visitor"));CHECK(!h.server.world().isAlive(oldPet));auto* guest=GameServerPeer::sessionOf(h.server,"visitor");CHECK(guest&&guest->eventKit);if(!guest||!guest->eventKit)return;
    CHECK_EQ(guest->eventKit->itemCount(Rarity::Rare,"petal_rose"),5);CHECK_EQ(guest->eventKit->loadout[0]->petalType,"rose");
    h.server.world().get<PlayerProgress>(guest->entity).stars=999;h.server.world().get<PlayerProgress>(guest->entity).totalXp=99999;
    CHECK(request(h,visitor,"market","post",posting("rose",2,1,9)));CHECK(!visitor.commerce("market")["ok"].asBool());
    q["name"]="night_event";CHECK(request(h,boss,"event","save",q));CHECK(request(h,boss,"event","off"));CHECK(!guest->eventKit);
    CHECK_EQ(h.server.world().get<PlayerProgress>(guest->entity).stars,stars);CHECK_EQ(h.server.world().get<PlayerProgress>(guest->entity).totalXp,xp);
    CHECK(request(h,boss,"event","load",q));CHECK(guest->eventKit!=nullptr);
    CHECK(say(h,boss,"/admin arena return visitor"));CHECK(!guest->eventKit);CHECK_EQ(wallet(h,"visitor").inventory.dump(),normal);CHECK_EQ(wallet(h,"visitor").stars,stars);CHECK_EQ(wallet(h,"visitor").totalXp,xp);
}
TEST(commerce_signature_skin_is_cosmetic_and_animates) {
    Harness h("commerce-signature",[](const std::string& path){seedWallet(path,"a19kisme",20);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient client;CHECK(loginAs(h,client,"a19kisme","password7"));
    const auto* skin=client.findSkin("signature_a19kisme");CHECK(skin);if(!skin)return;CHECK_EQ(skin->shapes.size(),std::size_t(72));CHECK_EQ(skin->animation,std::uint8_t(1));CHECK(!client.isSkinAdmin());
    Canvas first=Canvas::createVirtual(160,160),second=Canvas::createVirtual(160,160);first.translate(80,80);second.translate(80,80);renderAnimatedSkin(first,*skin,60,0);renderAnimatedSkin(second,*skin,60,1);
    CHECK(differingPixels(first.getImageData(0,0,160,160),second.getImageData(0,0,160,160))>100);
    first.savePPM("/tmp/flowrix-signature.ppm");
}
TEST(commerce_panels_and_repeating_arena_walls_render_locally) {
    Harness h("commerce-ui",[](const std::string& path){seedWallet(path,"boss",1000,true);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient client;CHECK(loginAs(h,client,"boss","password7"));
    client.setWorldMaps(&h.server.worldMaps());client.joinGame(1000,800,kAdminArenaSpawnChoice,"Boss");CHECK(h.stepUntil({&client},[&]{return client.status()==NetClient::Status::Playing;}));
    CHECK(fontsReady());SpriteCache sprites;sprites.build(content(),dataDir());WorldRenderer renderer;renderer.setSprites(&sprites);renderer.setWorldMaps(&h.server.worldMaps());renderer.setTerrain(&client.terrain());
    Window window;ClientSettings settings;DragState drag;
    for(int panel=0;panel<4;++panel) {
        Canvas canvas=Canvas::createVirtual(760,560);canvas.setFillStyle("#5c5b9c");canvas.fillRect(0,0,760,560);MenuContext ctx{canvas,window,client,sprites,renderer,settings,drag};ctx.bounds={0,0,610,430};
        for(int frame=0;frame<2;++frame){
            if(panel==0)renderCasino(ctx);else if(panel==1)renderMarket(ctx,{12,20,736,500},false);else if(panel==2)renderStarCodes(ctx,{12,20,736,500});else renderEventSetup(ctx,{12,20,736,500});
            h.step(8,{&client});
        }
        canvas.savePPM("/tmp/flowrix-commerce-panel-"+std::to_string(panel)+".ppm");
    }
    CHECK(say(h,client,"/admin arena empty 8"));h.step(4,{&client});
    Camera camera;camera.setViewport(760,560);camera.snapTo({128,128});
    Canvas world=Canvas::createVirtual(760,560);renderer.draw(world,client.view(),camera,{128,128},0);
    world.savePPM("/tmp/flowrix-arena-wall-review.ppm");
    const auto pixels=world.getImageData(0,0,760,560);
    // Outside the top-left corner is repeated solid artwork, not floor or void.
    const auto at=(50*760+50)*4;CHECK(pixels[at]>70 && pixels[at+1]>70 && pixels[at+2]>70);
    bool hel=false;for(const auto& map:h.server.worldMaps().maps())if(map.id()=="hel")for(const auto& element:map.elements())if(element.npcId=="hel_casino")hel=true;
    CHECK(hel);
    int casinoCount=0;Query<NpcTag,Npc,Transform,Body> npcs{h.server.world()};
    npcs.each([&](Entity,NpcTag&,Npc& npc,Transform& at,Body& body){
        if(npc.service!=NpcService::Casino)return;
        if(const auto* map=h.server.worldMaps().forRealm(at.realm);map && map->id()=="hel") {
            ++casinoCount;CHECK(distanceSq(h.server.terrain().resolveCircle(at.position,body.radius,at.realm),at.position)<1);
        }
    });CHECK_EQ(casinoCount,1);
}

TEST(commerce_legacy_skins_stay_free_and_price_cooldown_is_persistent_and_author_only) {
    SkinShape shape;shape.t=SkinShapeType::Rect;shape.rx=18;shape.ry=11;shape.fill="#32aa77";
    Harness h("skin-price-cooldown",[&](const std::string& path){
        seedWallet(path,"artist",100);seedWallet(path,"visitor",50);
        Database db;std::string error;CHECK(db.load(path,error));
        CustomSkin legacy;legacy.id="legacy_skin";legacy.name="Legacy";legacy.author="artist";legacy.shapes={shape};legacy.createdAt=1000;
        Json saved=skinToJson(legacy);saved.erase("price");db.rawTable("customSkins")[legacy.id]=saved;db.markDirty();CHECK(db.save());
    },dataDir(),0);
    CHECK(h.ready);if(!h.ready)return;NetClient artist,visitor;CHECK(loginAs(h,artist,"artist","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    auto& db=const_cast<Database&>(h.server.database());static std::int64_t now;now=db.nowMillis();db.setClock([]{return now;});
    CHECK_EQ(artist.findSkin("legacy_skin")->price,0.0);
    const double balance=wallet(h,"artist").stars;
    const auto edit=[&](NetClient& who,const char* name,double price){h.step(120,{&artist,&visitor});const auto count=who.chat().size();who.editSkin("legacy_skin",name,{shape},price);CHECK(h.stepUntil({&artist,&visitor},[&]{return who.chat().size()>count;}));};
    edit(visitor,"Stolen",5);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["price"].asDouble(),0.0);
    edit(artist,"Legacy",5);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["price"].asDouble(),5.0);
    const double changedAt=db.storedTable("customSkins")["legacy_skin"]["priceChangedAt"].asDouble();CHECK_EQ(changedAt,double(now));
    edit(artist,"Renamed",5);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["priceChangedAt"].asDouble(),changedAt);
    edit(artist,"Blocked",10);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["price"].asDouble(),5.0);
    CHECK(db.save());Database reopened;std::string error;CHECK(reopened.load(h.dbPath,error));CHECK_EQ(reopened.storedTable("customSkins")["legacy_skin"]["priceChangedAt"].asDouble(),changedAt);
    now+=static_cast<std::int64_t>(kSkinPriceCooldownMillis)-1;
    edit(artist,"Too early",10);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["price"].asDouble(),5.0);
    ++now;edit(artist,"Ready",10);CHECK_EQ(db.storedTable("customSkins")["legacy_skin"]["price"].asDouble(),10.0);
    CHECK_EQ(wallet(h,"artist").stars,balance);
}
