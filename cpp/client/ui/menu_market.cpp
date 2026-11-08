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
struct Forms {std::string account;bool marketLoaded=false,orders=false;int rarity=0,offset=0;double nextRefresh=0;Json query=Json::object();Field filter{},rarityFilter{},item{"basic"},quantity{"1"},price{"1"};} forms;
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
std::vector<std::uint16_t> marketPetalSuggestions(std::string query) {
    const auto lower=[](std::string s){for(char& c:s)c=char(std::tolower(static_cast<unsigned char>(c)));return s;};
    query=lower(query);
    while(!query.empty()&&std::isspace(static_cast<unsigned char>(query.front())))query.erase(0,1);
    while(!query.empty()&&std::isspace(static_cast<unsigned char>(query.back())))query.pop_back();
    std::vector<std::pair<int,std::uint16_t>> matches;
    for(std::size_t i=0;i<content().petalCount();++i){
        const auto& p=content().petal(i);if(p.isAdminPetal)continue;
        const auto name=lower(p.name),id=lower(p.id);
        if(!query.empty()&&name.find(query)==std::string::npos&&id.find(query)==std::string::npos)continue;
        const int rank=name==query||id==query?0:name.rfind(query,0)==0||id.rfind(query,0)==0?1:2;
        matches.emplace_back(rank,static_cast<std::uint16_t>(i));
    }
    std::stable_sort(matches.begin(),matches.end(),[](const auto& a,const auto& b){return a.first<b.first;});
    std::vector<std::uint16_t> out;
    for(std::size_t i=0;i<std::min(matches.size(),std::size_t(5));++i)out.push_back(matches[i].second);
    return out;
}
std::optional<std::uint16_t> renderMarketPetalSuggestions(MenuContext& ctx,Rect picker,const std::vector<std::uint16_t>& choices) {
    fillRound(ctx.canvas,picker,4,0x25462Au);
    if(choices.empty())text(ctx.canvas,"No matching petals",picker.x+8,picker.y+13,style(12));
    for(std::size_t i=0;i<choices.size();++i){
        const auto& petal=content().petal(choices[i]);const Rect row{picker.x,picker.y+i*26,picker.w,26};
        const auto label=ellipsize(petal.name+" ("+petal.id+")",12,row.w-12);
        if(button(ctx,row,label))return choices[i];
    }
    return {};
}
void refreshMarketUi(){forms.marketLoaded=false;}
void renderMarket(MenuContext& ctx,Rect p,bool orders) {
    account(ctx);
    const auto money=[&](double value){return marketNumber(value,ctx.window.altHeld());};
    int& sorting=orders?ctx.settings.marketOrderSort:ctx.settings.marketListingSort;
    const auto browse=[&](const char* action="browse",Json q=Json::object()) {q["orders"]=orders;q["offset"]=forms.offset;q["filter"]=forms.filter.text;q["rarityFilter"]=forms.rarityFilter.text;q["sort"]=sorting;forms.query=Json::object();for(const char* key:{"orders","offset","filter","rarityFilter","sort"})forms.query[key]=q[key];forms.nextRefresh=ctx.timeSeconds+1;int low,high;std::string saved=forms.rarityFilter.text;saved.erase(std::remove_if(saved.begin(),saved.end(),[](unsigned char c){return std::isspace(c);}),saved.end());if(collectionRarityFilter(saved,low,high))ctx.settings.marketRarityFilter=saved;send(ctx,"market",action,q);};
    if(!forms.marketLoaded||forms.orders!=orders){forms.marketLoaded=true;forms.orders=orders;forms.offset=0;forms.rarityFilter.text=ctx.settings.marketRarityFilter;browse();}
    else if(ctx.timeSeconds>=forms.nextRefresh){send(ctx,"market","browse",forms.query);forms.nextRefresh=ctx.timeSeconds+1;}
    const auto& reply=ctx.net.adminTools("market");
    const bool pickerOpen=forms.item.state.focused;
    const auto choices=pickerOpen?marketPetalSuggestions(forms.item.text):std::vector<std::uint16_t>{};
    const double pickerHeight=26*std::max(std::size_t(1),choices.size());
    const Rect picker{p.x,p.bottom()-98+8-pickerHeight,300,pickerHeight};
    MenuContext controls=ctx;
    controls.pointerBlocked=ctx.pointerBlocked||(pickerOpen&&picker.contains(ctx.mouse()));
    const int total=std::max(0,reply["total"].asInt());
    const int offset=std::max(0,reply["offset"].asInt());
    const int pages=std::max(1,(total+4)/5);
    const std::string pager="Page "+std::to_string(std::min(pages,offset/5+1))+" / "+std::to_string(pages)+" ("+std::to_string(total)+" results)";
    const double pagerWidth=measure(pager,12);
    text(ctx.canvas,pager,p.right()-pagerWidth,p.y+10,style(12));
    const auto header=(orders?std::string("Fund requests; other players supply petals."):std::string("Petal listings. Seller receives 80%; tax 20%."))+"  Stars: "+money(ctx.net.profile().stars);
    text(ctx.canvas,ellipsize(header,13,std::max(0.0,p.w-pagerWidth-14)),p.x,p.y+10,style());
    field(ctx,forms.filter,{p.x,p.y+25,220,30},"Search petal name / ID");
    if(button(controls,{p.x+230,p.y+25,90,30},"Refresh")){forms.offset=0;browse();}
    if(button(controls,{p.right()-150,p.y+25,66,30},"<")){forms.offset=std::max(0,offset-5);browse();}
    if(button(controls,{p.right()-76,p.y+25,66,30},">")){if(offset+5<total){forms.offset=offset+5;browse();}}
    field(ctx,forms.rarityFilter,{p.x+330,p.y+25,130,30},"All / Ultra+ / Rare-",16);
    const char* sortLabel=sorting==0?"Price":sorting==1?(orders?"Highest offer":"Best value"):"Rarity";
    if(button(controls,{p.x+470,p.y+25,std::max(90.0,p.w-630),30},sortLabel)){sorting=orders?(sorting==0?2:0):(sorting+1)%3;forms.offset=0;browse();}
    double y=p.y+66;
    const auto& rows=reply["rows"];
    if(rows.isArray())for(const auto& row:rows.items()) {
        const auto rarity=Rarity(std::clamp(row["rarity"].asInt(),0,kLadderRarityCount-1));
        const auto index=content().petalIndex(row["item"].asString());
        const auto name=index==kInvalidIndex?row["item"].asString():content().petal(index).name;
        const std::string description=name+" / "+rarityLabel(rarity)+" x"+money(row["quantity"].asDouble())+" / "+money(row["price"].asDouble())+" stars each / @"+row["seller"].asString();
        fillRound(ctx.canvas,{p.x,y,p.w,30},4,0x315A36u);
        text(ctx.canvas,ellipsize(description,12,p.w-190),p.x,y+15,style(12,rarityColor(rarity)));
        const bool mine=row["mine"].asBool();
        if(button(controls,{p.right()-178,y,168,29},mine?"Cancel / refund":orders?"Fill amount below":"Buy amount below")) {Json q=Json::object();q["id"]=row["id"];q["quantity"]=number(forms.quantity.text);browse(mine?"cancel":"take",q);}
        y+=33;
    }
    const double formY=p.bottom()-98;
    text(ctx.canvas,"Petal name / ID",p.x,formY,style(12));text(ctx.canvas,"Rarity",p.x+170,formY,style(12));text(ctx.canvas,"Amount",p.x+344,formY,style(12));text(ctx.canvas,"Stars each",p.x+430,formY,style(12));
    field(controls,forms.item,{p.x,formY+12,160,30},"Name or ID",64);
    ctx.wantsText=ctx.wantsText||controls.wantsText;
    const auto choose=[&](std::uint16_t index){forms.item.text=content().petal(index).id;forms.item.state=TextFieldState{};};
    if(pickerOpen&&ctx.window.keyPressed(Key::Enter)&&!choices.empty())choose(choices.front());
    if(pickerOpen&&ctx.window.keyPressed(Key::Escape))forms.item.state.focused=false;
    if(button(controls,{p.x+170,formY+12,28,30},"<"))forms.rarity=std::max(0,forms.rarity-1);
    text(ctx.canvas,rarityLabel(Rarity(forms.rarity)),p.x+204,formY+27,style(12));
    if(button(controls,{p.x+306,formY+12,28,30},">"))forms.rarity=std::min(kLadderRarityCount-1,forms.rarity+1);
    field(ctx,forms.quantity,{p.x+344,formY+12,76,30},"1",7);field(ctx,forms.price,{p.x+430,formY+12,90,30},"Price",13);
    if(button(controls,{p.x+530,formY+12,p.w-540,30},orders?"Post order":"List petals")) {Json q=Json::object();q["item"]=forms.item.text;q["rarity"]=forms.rarity;q["quantity"]=number(forms.quantity.text);q["price"]=number(forms.price.text);browse("post",q);}
    text(ctx.canvas,ellipsize("Minimum: "+money(marketMinimum(Rarity(forms.rarity)))+" stars each (Common 1, x3 per rarity). Hold Alt for exact values.",11,p.w),p.x,formY+57,style(11));
    result(ctx,"market",{p.x,p.bottom()-29,p.w,25});
    if(pickerOpen&&forms.item.state.focused)
        if(const auto selected=renderMarketPetalSuggestions(ctx,picker,choices))choose(*selected);
}

}
