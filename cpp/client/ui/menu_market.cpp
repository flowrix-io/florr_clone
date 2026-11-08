#include "client/ui/menus.h"
#include "client/ui/market_ui.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/menu_theme.h"
#include "shared/game/economy.h"
#include "shared/game/collection.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <sstream>
#include <iomanip>
namespace flix {
using namespace ui;
namespace {
struct Field {std::string text;TextFieldState state;};
struct Forms {std::string account;bool marketLoaded=false,orders=false;int rarity=0,offset=0;Field filter{},rarityFilter{},item{"basic"},quantity{"1"},price{"1"};} forms;
void account(MenuContext& ctx){if(forms.account!=ctx.net.profile().username){forms=Forms{};forms.account=ctx.net.profile().username;}}
TextStyle style(double size=13,unsigned color=0xFFFFFF){TextStyle t;t.size=size;t.fill=color;t.baseline=Baseline::Middle;return t;}
void field(MenuContext& ctx,Field& f,Rect r,const std::string& placeholder,std::size_t max=32){inputField(ctx.canvas,r,f.text,placeholder,f.state.focused,ctx.timeSeconds,&f.state);if(!ctx.pointerBlocked)trackTextMouse(ctx.window,f.state,r,inputFieldRun(r,f.text,f.state),f.text,ctx.timeSeconds);if(f.state.focused){ctx.wantsText=true;TextEditOptions options;options.maxBytes=max;options.asciiOnly=true;editText(ctx.window,f.text,f.state,ctx.timeSeconds,options);}}
bool button(MenuContext& ctx,Rect r,const std::string& label){chip(ctx.canvas,r,label,r.contains(ctx.mouse()),ChipStyle{0x7473B0u,0x48477Au});return ctx.clicked(r);}
double number(const std::string& s){if(s.empty()||s.size()>13||s.find_first_not_of("0123456789")!=std::string::npos)return -1;try{const double value=std::stod(s);return validMoney(value)?value:-1;}catch(...){return -1;}}
void send(MenuContext& ctx,const char* kind,const char* action,Json q=Json::object()){q["kind"]=kind;q["action"]=action;ctx.net.requestAdminTools(q);}
void result(MenuContext& ctx,const char* kind,Rect r){const auto& reply=ctx.net.adminTools(kind);text(ctx.canvas,ellipsize(reply["message"].asString(),12,r.w),r.x,r.y+r.h/2,style(12,reply["ok"].asBool(true)?0xF1E8FF:0xFFAAAA));}
}
std::string marketNumber(double value, bool exact) {
    if (!std::isfinite(value) || (!exact && std::fabs(value)>=1e6)) return ui::abbreviate(value);
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(1) << value;
    std::string out=stream.str();
    if (out.size()>=2 && out.compare(out.size()-2,2,".0")==0) out.resize(out.size()-2);
    const auto dot=out.find('.');
    const auto end=dot==std::string::npos?out.size():dot;
    const std::size_t start=!out.empty()&&out[0]=='-'?1:0;
    for (std::size_t at=end;at>start+3;) { at-=3;out.insert(at,","); }
    return out;
}
void refreshMarketUi(){forms.marketLoaded=false;}
void renderMarket(MenuContext& ctx,Rect p,bool orders) {
    account(ctx);
    const auto money=[&](double value){return marketNumber(value,ctx.window.altHeld());};
    int& sorting=orders?ctx.settings.marketOrderSort:ctx.settings.marketListingSort;
    const auto browse=[&](const char* action="browse",Json q=Json::object()) {q["orders"]=orders;q["offset"]=forms.offset;q["filter"]=forms.filter.text;q["rarityFilter"]=forms.rarityFilter.text;q["sort"]=sorting;int low,high;std::string saved=forms.rarityFilter.text;saved.erase(std::remove_if(saved.begin(),saved.end(),[](unsigned char c){return std::isspace(c);}),saved.end());if(collectionRarityFilter(saved,low,high))ctx.settings.marketRarityFilter=saved;send(ctx,"market",action,q);};
    if(!forms.marketLoaded||forms.orders!=orders){forms.marketLoaded=true;forms.orders=orders;forms.offset=0;forms.rarityFilter.text=ctx.settings.marketRarityFilter;browse();}
    const auto& reply=ctx.net.adminTools("market");
    text(ctx.canvas,(orders?std::string("Fund requests; other players supply petals."):std::string("Petal listings. Seller receives 80%; tax 20%."))+"  Stars: "+money(ctx.net.profile().stars),p.x,p.y+10,style());
    field(ctx,forms.filter,{p.x,p.y+25,220,30},"Filter by petal ID");
    if(button(ctx,{p.x+230,p.y+25,90,30},"Refresh")){forms.offset=0;browse();}
    if(button(ctx,{p.right()-150,p.y+25,66,30},"<")){forms.offset=std::max(0,forms.offset-5);browse();}
    if(button(ctx,{p.right()-76,p.y+25,66,30},">")){if(forms.offset+5<reply["total"].asDouble())forms.offset+=5;browse();}
    field(ctx,forms.rarityFilter,{p.x+330,p.y+25,130,30},"All / Ultra+ / Rare-",16);
    const char* sortLabel=sorting==0?"Price":sorting==1?(orders?"Highest offer":"Best value"):"Rarity";
    if(button(ctx,{p.x+470,p.y+25,std::max(90.0,p.w-630),30},sortLabel)){sorting=orders?(sorting==0?2:0):(sorting+1)%3;forms.offset=0;browse();}
    double y=p.y+66;
    const auto& rows=reply["rows"];
    if(rows.isArray())for(const auto& row:rows.items()) {
        const auto rarity=Rarity(std::clamp(row["rarity"].asInt(),0,kLadderRarityCount-1));
        const std::string description=row["item"].asString()+" / "+rarityLabel(rarity)+" x"+money(row["quantity"].asDouble())+" / "+money(row["price"].asDouble())+" stars each / @"+row["seller"].asString();
        fillRound(ctx.canvas,{p.x,y,p.w,30},4,0x315A36u);
        text(ctx.canvas,ellipsize(description,12,p.w-190),p.x,y+15,style(12,rarityColor(rarity)));
        const bool mine=row["mine"].asBool();
        if(button(ctx,{p.right()-178,y,168,29},mine?"Cancel / refund":orders?"Fill amount below":"Buy amount below")) {Json q=Json::object();q["id"]=row["id"];q["quantity"]=number(forms.quantity.text);browse(mine?"cancel":"take",q);}
        y+=33;
    }
    const double formY=p.bottom()-98;
    text(ctx.canvas,"Petal ID",p.x,formY,style(12));text(ctx.canvas,"Rarity",p.x+170,formY,style(12));text(ctx.canvas,"Amount",p.x+344,formY,style(12));text(ctx.canvas,"Stars each",p.x+430,formY,style(12));
    field(ctx,forms.item,{p.x,formY+12,160,30},"basic");
    if(button(ctx,{p.x+170,formY+12,28,30},"<"))forms.rarity=std::max(0,forms.rarity-1);
    text(ctx.canvas,rarityLabel(Rarity(forms.rarity)),p.x+204,formY+27,style(12));
    if(button(ctx,{p.x+306,formY+12,28,30},">"))forms.rarity=std::min(kLadderRarityCount-1,forms.rarity+1);
    field(ctx,forms.quantity,{p.x+344,formY+12,76,30},"1",7);field(ctx,forms.price,{p.x+430,formY+12,90,30},"Price",13);
    if(button(ctx,{p.x+530,formY+12,p.w-540,30},orders?"Post order":"List petals")) {Json q=Json::object();q["item"]=forms.item.text;q["rarity"]=forms.rarity;q["quantity"]=number(forms.quantity.text);q["price"]=number(forms.price.text);browse("post",q);}
    text(ctx.canvas,ellipsize("Minimum: "+money(marketMinimum(Rarity(forms.rarity)))+" stars each (Common 1, x3 per rarity). Hold Alt for exact values.",11,p.w),p.x,formY+57,style(11));
    result(ctx,"market",{p.x,p.bottom()-29,p.w,25});
}

}
