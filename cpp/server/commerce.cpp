#include "server/game_server.h"
#include "server/collection_ranks.h"
#include "server/systems/npcs.h"
#include "server/text.h"
#include "shared/game/economy.h"
#include "shared/game/casino.h"
#include "shared/game/skin_format.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>

namespace flix {
namespace {
bool integer(const Json& j,int lo,int hi,int& out) {
    const double v=j.asDouble(-1);
    if(!std::isfinite(v)||v<lo||v>hi||std::floor(v)!=v)return false;
    out=int(v); return true;
}
}
void GameServer::syncCommerceAccount(const std::string& userId) {
    const auto& record=database_.progress(userId);
    for(auto& [id,s]:sessions_) if(s.userId==userId && !s.arena && !s.eventKit) {
        for(Entity e:bodiesOf(s)) if(auto* progress=world_.tryGet<PlayerProgress>(e)) progress->stars=record.stars;
        if(auto* peer=listener_.find(id)) sendProfile(s,*peer);
    }
}
void GameServer::sendCommerce(Session& s,net::Connection& peer,const std::string& kind,bool ok,const std::string& message,const Json& data) {
    Json reply=data; reply["kind"]=kind; reply["ok"]=ok; reply["message"]=message;reply["revision"]=double(++s.commerceRevision);
    const auto& record=database_.progress(s.userId);
    reply["stars"]=record.stars; reply["chips"]=record.casinoChips;
    if(kind=="skin")sendSystem(peer,message);
    ByteWriter w; w.u8(std::uint8_t(net::ServerMessage::Commerce)); w.str(reply.dump()); peer.send(w);
}
void GameServer::handleCommerce(Session& s,net::Connection& peer,ByteReader& reader) {
    const auto raw=reader.str();
    if(!reader.ok()||!s.authenticated()||raw.size()>2048)return;
    const Json q=Json::parseOrNull(raw);
    if(!q.isObject())return;
    const auto kind=q["kind"].asString(), action=q["action"].asString();
    if(kind=="event" || kind=="arena") {runEventSetup(s,peer,q);return;}
    if(s.controlling || s.controlledBy || s.arena || s.eventKit) {sendCommerce(s,peer,kind,false,"Unavailable during flower control or a temporary event/public arena kit.");return;}
    if(kind=="market") {runMarket(s,peer,q);return;}
    if(kind=="casino") {
        if(action=="status"){sendCommerce(s,peer,kind,true,"Choose an exchange or a game above. Stand beside Hel to play.");return;}
        std::string arg=action;
        if(action!="status") {
            int amount=0; const bool validAmount=q["amount"].isString()?parseCasinoAmount(q["amount"].asString(),amount):integer(q["amount"],1,kCasinoMaxBet,amount);
            if(!validAmount) {sendCommerce(s,peer,kind,false,"Amount must be 1-19000 chips (e.g. 2.5k or 19k).");return;}
            arg+=" "+std::to_string(amount);
            if(action=="flip") {
                const auto side=q["side"].asString(); if(side!="heads"&&side!="tails")return;
                arg+=" "+side;
            }
        }
        runCasino(s,peer,arg,false);return;
    }
    if(kind=="codes") {
        if(!s.admin || !adminMay(s,AdminPower::GivePetals)) {sendCommerce(s,peer,kind,false,"Full tier 1-2 admin access required.");return;}
        auto name=q["name"].asString();
        for(char& c:name)c=char(std::toupper(static_cast<unsigned char>(c)));
        std::string message="Active star codes";
        if(action=="create") {
            int uses=0; const double stars=q["stars"].asDouble(-1);
            if(name.empty()||name.size()>32||name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=std::string::npos||!validMoney(stars)||stars<1||!integer(q["uses"],0,1000000,uses)) {sendCommerce(s,peer,kind,false,"Use a 1-32 character code (letters, digits, _ or -), a positive star reward, and a use limit 0-1000000 (0 unlimited).");return;}
            if(database_.storedTable("codes").contains(name)) {sendCommerce(s,peer,kind,false,"That code already exists.");return;}
            Json row=Json::object();row["code"]=name;row["stars"]=stars;row["uses"]=0;row["maxUses"]=uses;row["usedBy"]=Json::array();row["createdBy"]=s.username;row["createdAt"]=double(database_.nowMillis());
            database_.rawTable("codes")[name]=row;database_.markDirty();message="Created "+name;
            std::printf("[codes] %s created a named code worth %.0f stars (%d uses)\n",s.username.c_str(),stars,uses);
        } else if(action=="delete") {
            database_.rawTable("codes").erase(name);database_.markDirty();message="Deleted "+name;
        }
        Json data=Json::object(),rows=Json::array();
        int offset=0;integer(q["offset"],0,1000000,offset);int total=0;
        const auto& codes=database_.storedTable("codes");
        for(const auto& key:codes.keys()) {
            const auto& entry=codes[key]; const double max=entry["maxUses"].asDouble();
            if(max>0 && entry["uses"].asDouble()>=max)continue;
            if(total++<offset||rows.size()>=12)continue;
            Json row=Json::object();row["name"]=key;row["stars"]=entry["stars"];row["uses"]=entry["uses"];row["maxUses"]=entry["maxUses"];rows.push(row);
        }
        data["rows"]=rows;data["total"]=total;data["offset"]=offset;sendCommerce(s,peer,kind,true,message,data);return;
    }
    if(kind=="skin" && action=="buy") {
        const auto id=q["id"].asString();
        const auto& stored=database_.storedTable("customSkins");
        if(!stored[id].isObject()){sendCommerce(s,peer,kind,false,"Skin no longer exists.");return;}
        const auto skin=skinFromJson(stored[id]);
        const Account* author=database_.findUser(skin.author);
        if(!author){sendCommerce(s,peer,kind,false,"Creator account unavailable.");return;}
        if(q["price"].asDouble(-1)!=skin.price){sendCommerce(s,peer,kind,false,"Price changed. Refresh the skin catalogue before buying.");sendSkinCatalog(s,peer);return;}
        const auto authorId=author->id;
        for(auto& [cid,live]:sessions_) if(live.userId==s.userId||live.userId==authorId)if(!live.arena && !live.eventKit)persistPlayer(live);
        auto& buyer=database_.progress(s.userId);
        auto& seller=database_.progress(authorId);
        const bool owned=buyer.extra["ownedSkins"][id].asBool();
        if(owned||s.userId==authorId||skin.price==0) {sendCommerce(s,peer,kind,true,"You can equip this skin.");sendSkinCatalog(s,peer);return;}
        const double net=sellerProceeds(skin.price);
        if(!validSkinPrice(skin.price)||!validBalance(buyer.stars)||!validBalance(seller.stars)||buyer.stars<skin.price||seller.stars>kEconomyMax-net) {sendCommerce(s,peer,kind,false,"Not enough stars, or balance limit reached.");return;}
        buyer.stars=creditStars(buyer.stars,-skin.price);seller.stars=creditStars(seller.stars,net);buyer.extra["ownedSkins"][id]=true;
        database_.markDirty();syncCommerceAccount(authorId);syncCommerceAccount(s.userId);sendSkinCatalog(s,peer);
        sendCommerce(s,peer,kind,true,"Skin purchased. Creator receives 80%; 20% tax.");return;
    }
}
void GameServer::runMarket(Session& s,net::Connection& peer,const Json& q) {
    const auto action=q["action"].asString(); const bool orders=q["orders"].asBool();
    const auto fail=[&](const std::string& text){sendCommerce(s,peer,"market",false,text);};
    int minimum=0,maximum=kLadderRarityCount-1;
    if(!collectionRarityFilter(q["rarityFilter"].asString(),minimum,maximum)){fail("Rarity filter: Mythic, Ultra+, Rare-, or All.");return;}
    persistPlayer(s);
    auto& account=database_.progress(s.userId);
    if(!validBalance(account.stars)){fail("Invalid star balance. Ask an admin to review it.");return;}
    const auto tableName="petalMarket";
    std::string message;
    if(action=="post") {
        int rarity=0,quantity=0;
        const auto item=q["item"].asString();const auto index=content().petalIndex(item);
        const double price=q["price"].asDouble(-1);
        if(index==kInvalidIndex||content().petal(index).isAdminPetal||!integer(q["rarity"],0,kLadderRarityCount-1,rarity)||!integer(q["quantity"],1,1000000,quantity)||!validMoney(price)||price<marketMinimum(Rarity(rarity))||price*quantity>kEconomyMax) {fail("Invalid item, amount or price. Minimum is 1 star for Common, x3 each rarity. Admin and Universal petals cannot be traded.");return;}
        const auto& rows=database_.storedTable(tableName);
        int mine=0;for(const auto& key:rows.keys())if(rows[key]["owner"].asString()==s.userId)++mine;
        if(rows.size()>=2000||mine>=25){fail("Market limit reached (25 entries per account).");return;}
        const auto key="petal_"+item;
        if(orders ? account.stars<price*quantity : account.itemCount(Rarity(rarity),key)<quantity) {fail(orders?"Not enough stars to fund the order.":"Not enough unequipped petals.");return;}
        if(orders)account.stars=creditStars(account.stars,-price*quantity);else account.addItem(Rarity(rarity),key,-quantity);
        Json row=Json::object();
        const auto id=std::to_string(database_.nowMillis())+"_"+std::to_string(rng_.next());
        row["id"]=id;row["owner"]=s.userId;row["item"]=item;row["rarity"]=rarity;row["quantity"]=quantity;row["price"]=price;row["orders"]=orders;
        database_.rawTable(tableName)[id]=row;database_.markDirty();syncCommerceAccount(s.userId);
        message=orders?"Order funded. Stars held until filled or cancelled.":"Listing posted. Petals held until sold or cancelled.";
    } else if(action=="take" || action=="cancel") {
        const auto id=q["id"].asString(); const Json row=database_.storedTable(tableName)[id];
        if(!row.isObject()){fail("That entry is already gone. Refresh the market.");return;}
        int rarity=0,remaining=0,quantity=0;
        const auto ownerId=row["owner"].asString(),item=row["item"].asString(),key="petal_"+item;
        const double price=row["price"].asDouble(-1);const bool isOrder=row["orders"].asBool();
        if(!integer(row["rarity"],0,kLadderRarityCount-1,rarity)||!integer(row["quantity"],1,1000000,remaining)||!validMoney(price)||price<marketMinimum(Rarity(rarity))||price*remaining>kEconomyMax||!database_.findUserById(ownerId)){fail("Invalid market entry.");return;}
        for(auto& [cid,live]:sessions_)if(live.userId==ownerId&&!live.arena&&!live.eventKit)persistPlayer(live);
        auto& owner=database_.progress(ownerId);
        if(!validBalance(owner.stars)){fail("Owner balance unavailable.");return;}
        if(action=="cancel") {
            if(ownerId!=s.userId){fail("Only the creator can cancel this entry.");return;}
            if(isOrder) {if(owner.stars>kEconomyMax-price*remaining){fail("Star balance limit reached.");return;}owner.stars=creditStars(owner.stars,price*remaining);}
            else {if(owner.itemCount(Rarity(rarity),key)>kMaxStackCount-remaining){fail("Inventory is full. Free space before cancelling.");return;}owner.addItem(Rarity(rarity),key,remaining);}
            database_.rawTable(tableName).erase(id);message="Cancelled. Remaining escrow returned without tax.";
        } else {
            if(ownerId==s.userId){fail("Use Cancel for your own entry.");return;}
            if(!integer(q["quantity"],1,remaining,quantity)){fail("Choose an amount within the remaining quantity.");return;}
            auto& buyer=isOrder?owner:account;auto& seller=isOrder?account:owner;
            const double gross=price*quantity,net=sellerProceeds(gross);
            if((!isOrder&&buyer.stars<gross)||(isOrder&&seller.itemCount(Rarity(rarity),key)<quantity)||buyer.itemCount(Rarity(rarity),key)>kMaxStackCount-quantity||seller.stars>kEconomyMax-net){fail("Not enough funds/petals or destination balance is full.");return;}
            if(!isOrder)buyer.stars=creditStars(buyer.stars,-gross);else seller.addItem(Rarity(rarity),key,-quantity);
            buyer.addItem(Rarity(rarity),key,quantity);seller.stars=creditStars(seller.stars,net);
            if(quantity==remaining)database_.rawTable(tableName).erase(id);else database_.rawTable(tableName)[id]["quantity"]=remaining-quantity;
            message="Trade completed. Seller received 80%; 20% tax.";
        }
        database_.markDirty();syncCommerceAccount(ownerId);syncCommerceAccount(s.userId);
    }
    Json page=Json::object(),rows=Json::array();int offset=0,total=0;integer(q["offset"],0,2000,offset);
    const auto filter=lowerCase(q["filter"].asString());
    int sorting=0;integer(q["sort"],0,2,sorting);
    if(sorting==1&&!orders&&collectionRanks_.empty())collectionRanks_=collectionBaseRanks(content(),loot_->dropTables());
    std::vector<Json> sorted;
    const auto& entries=database_.storedTable(tableName);
    for(const auto& id:entries.keys()) {
        const auto& row=entries[id];if(row["orders"].asBool()!=orders)continue;
        if(!filter.empty()&&row["item"].asString().find(filter)==std::string::npos)continue;
        const int rarity=row["rarity"].asInt(-1);if(rarity<minimum||rarity>maximum||!validMoney(row["price"].asDouble(-1))||row["price"].asDouble()<1)continue;
        sorted.push_back(row);
    }
    std::sort(sorted.begin(),sorted.end(),[&](const Json& a,const Json& b){
        const double ap=a["price"].asDouble(),bp=b["price"].asDouble();const int ar=a["rarity"].asInt(),br=b["rarity"].asInt();
        if(sorting==2 && ar!=br)return ar>br;
        if(sorting==1&&!orders){const double av=collectionUnitScore(content(),collectionRanks_,content().petalIndex(a["item"].asString()),Rarity(ar))/ap,bv=collectionUnitScore(content(),collectionRanks_,content().petalIndex(b["item"].asString()),Rarity(br))/bp;if(av!=bv)return av>bv;}
        if(ap!=bp)return orders?ap>bp:ap<bp;
        if(ar!=br)return ar>br;
        return a["id"].asString()<b["id"].asString();
    });
    for(const auto& row:sorted) {
        if(total++<offset||rows.size()>=7)continue;
        Json view=row;view.erase("owner");view["mine"]=row["owner"].asString()==s.userId;
        const auto* owner=database_.findUserById(row["owner"].asString());view["seller"]=owner?owner->username:"Unknown";rows.push(view);
    }
    page["orders"]=orders;page["rows"]=rows;page["offset"]=offset;page["total"]=total;
    sendCommerce(s,peer,"market",true,message,page);
}
}

namespace flix {
void GameServer::installSignatureSkin() {
    const std::string id="signature_a19kisme";
    if(database_.storedTable("customSkins")[id].isObject())return;
    static const int rings[12][12]={
      {25,0,13,22,-13,22,-25,0,-13,-22,13,-22},
      {23,4,8,22,-15,18,-23,-4,-8,-22,15,-18},
      {20,7,4,21,-16,14,-20,-7,-4,-21,16,-14},
      {16,10,0,19,-16,10,-16,-10,0,-19,16,-10},
      {13,11,-3,17,-16,6,-13,-11,3,-17,16,-6},
      {10,12,-5,14,-15,3,-10,-12,5,-14,15,-3},
      {6,11,-6,11,-13,0,-6,-11,6,-11,13,0},
      {4,10,-7,8,-11,-2,-4,-10,7,-8,11,2},
      {2,9,-7,6,-9,-3,-2,-9,7,-6,9,3},
      {0,7,-6,4,-6,-4,0,-7,6,-4,6,4},
      {-1,5,-5,2,-4,-3,1,-5,5,-2,4,3},
      {-1,3,-3,1,-2,-3,1,-3,3,-1,2,3}};
    const double widths[]{2,1.8,1.5,1.5,1.2,1.2,1,1,1,1,0.8,0.8};
    const char* colors[]{"#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888","#999999","#aaaaaa","#bbbbbb","#cccccc"};
    CustomSkin skin;skin.id=id;skin.name="Hex Singularity";skin.author="a19kisme";skin.animation=1;skin.createdAt=double(database_.nowMillis());
    for(int ring=0;ring<12;++ring)for(int edge=0;edge<6;++edge) {
        const int next=(edge+1)%6;SkinShape line;line.t=SkinShapeType::Line;
        line.x=rings[ring][2*edge];line.y=rings[ring][2*edge+1];line.x2=rings[ring][2*next];line.y2=rings[ring][2*next+1];line.stroke=colors[ring];line.sw=widths[ring];skin.shapes.push_back(line);
    }
    database_.rawTable("customSkins")[id]=skinToJson(skin);database_.markDirty();
    ByteWriter packet;packet.u8(std::uint8_t(net::ServerMessage::SkinPublished));writeCustomSkin(packet,skin);broadcastToAuthenticated(packet);
}
}
