#include "server/game_server.h"
#include "server/text.h"
#include "server/collection_ranks.h"
#include "shared/game/economy.h"
#include "shared/game/skin_format.h"
#include <algorithm>
#include <cmath>
namespace flix {
namespace {
bool integer(const Json& j,int lo,int hi,int& out) {const double v=j.asDouble(-1);if(!std::isfinite(v)||v<lo||v>hi||std::floor(v)!=v)return false;out=int(v);return true;}
}
void GameServer::syncCommerceAccount(const std::string& id) {
    const auto& record=database_.progress(id);
    for(auto& [cid,s]:sessions_) if(s.userId==id&&!s.arena&&!s.eventKit) {
        for(Entity e:{s.entity,s.splitOther})if(auto* live=world_.tryGet<PlayerProgress>(e))live->stars=record.stars;
        if(auto* peer=listener_.find(cid))sendProfile(s,*peer);
    }
}
void GameServer::runMarket(Session& s,net::Connection& peer,const Json& q) {
    const auto action=q["action"].asString();
    if(s.controlling||s.controlledBy||s.arena||s.eventKit){sendAdminTools(s,peer,"market",false,"Unavailable with a temporary event inventory or flower control.");return;}
    if(action!="browse"&&action!="post"&&action!="take"&&action!="cancel"){sendAdminTools(s,peer,"market",false,"Unknown market action.");return;} const bool orders=q["orders"].asBool();
    const auto fail=[&](const std::string& text){sendAdminTools(s,peer,"market",false,text);};
    if(q["filter"].asString().size()>64||q["rarityFilter"].asString().size()>32||q["item"].asString().size()>64||q["id"].asString().size()>80){fail("Market request is too long.");return;}
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
    int sorting=orders?0:1;integer(q["sort"],0,2,sorting);
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
        if(total++<offset||rows.size()>=5)continue;
        Json view=row;view.erase("owner");view["mine"]=row["owner"].asString()==s.userId;
        const auto* owner=database_.findUserById(row["owner"].asString());view["seller"]=owner?owner->username:"Unknown";rows.push(view);
    }
    page["orders"]=orders;page["rows"]=rows;page["offset"]=offset;page["total"]=total;
    sendAdminTools(s,peer,"market",true,message,page);
}

} // namespace flix
