#include "client/ui/menus.h"
#include "client/ui/admin_tools_ui.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/menu_theme.h"
#include <cmath>
#include <iomanip>
#include <sstream>
namespace flix {
using namespace ui;
namespace {
struct Field {std::string text;TextFieldState state;};
struct Forms {
    std::string account;
    bool codesLoaded=false,eventLoaded=false,rulesView=false;
    int codeOffset=0,eventIndex=0,kitRarity=0;
    Field eventName{"event_name"},kitItem{"basic"},kitAmount{"1"},kitSlot{"1"};
    Field code{},reward{"100"},uses{"1"},bannedIds{};
} forms;
void account(MenuContext& ctx) {if(forms.account!=ctx.net.profile().username){forms=Forms{};forms.account=ctx.net.profile().username;}}
TextStyle style(double size=13,std::uint32_t color=0xFFFFFFu) {TextStyle t;t.size=size;t.fill=color;t.baseline=Baseline::Middle;return t;}
std::string money(double v) {std::ostringstream s;s<<std::fixed<<std::setprecision(std::floor(v)==v?0:1)<<v;return s.str();}
void field(MenuContext& ctx,Field& f,Rect r,const std::string& placeholder,std::size_t max=32) {
    inputField(ctx.canvas,r,f.text,placeholder,f.state.focused,ctx.timeSeconds,&f.state);
    trackTextMouse(ctx.window,f.state,r,inputFieldRun(r,f.text,f.state),f.text,ctx.timeSeconds);
    if(f.state.focused){ctx.wantsText=true;TextEditOptions options;options.maxBytes=max;options.asciiOnly=true;editText(ctx.window,f.text,f.state,ctx.timeSeconds,options);}
}
bool button(MenuContext& ctx,Rect r,const std::string& label) {chip(ctx.canvas,r,label,r.contains(ctx.mouse()),ChipStyle{0x7473B0u,0x48477Au});return ctx.clicked(r);}
int number(const std::string& s) {if(s.empty()||s.size()>9||s.find_first_not_of("0123456789")!=std::string::npos)return -1;try{return std::stoi(s);}catch(...){return -1;}}
void send(MenuContext& ctx,const char* kind,const char* action,Json q=Json::object()) {q["kind"]=kind;q["action"]=action;ctx.net.requestAdminTools(q);}
void result(MenuContext& ctx,const char* kind,Rect r) {const auto& reply=ctx.net.adminTools(kind);text(ctx.canvas,ellipsize(reply["message"].asString(),12,r.w),r.x,r.y+r.h/2,style(12,reply["ok"].asBool(true)?0xF1E8FFu:0xFFAAAAu));}
}
void resetAdminToolsUi(){forms=Forms{};}
void renderStarCodes(MenuContext& ctx,Rect p) {
    account(ctx);
    const auto browse=[&](const char* action="list",Json q=Json::object()){q["offset"]=forms.codeOffset;send(ctx,"codes",action,q);};
    if(!forms.codesLoaded){forms.codesLoaded=true;browse();}
    text(ctx.canvas,"Active star codes (full tier 1-2 admins)",p.x,p.y+12,style());
    if(button(ctx,{p.right()-230,p.y,90,30},"Refresh"))browse();
    if(button(ctx,{p.right()-130,p.y,55,30},"<")){forms.codeOffset=std::max(0,forms.codeOffset-12);browse();}
    if(button(ctx,{p.right()-65,p.y,55,30},">")){if(forms.codeOffset+12<ctx.net.adminTools("codes")["total"].asDouble())forms.codeOffset+=12;browse();}
    double y=p.y+40;const auto& rows=ctx.net.adminTools("codes")["rows"];
    if(rows.isArray())for(const auto& row:rows.items()){
        text(ctx.canvas,row["name"].asString()+" : "+money(row["stars"].asDouble())+" stars / uses "+money(row["uses"].asDouble())+" / "+(row["maxUses"].asDouble()>0?money(row["maxUses"].asDouble()):"unlimited"),p.x,y+12,style(12));
        if(button(ctx,{p.right()-86,y,76,24},"Delete")){Json q=Json::object();q["name"]=row["name"];browse("delete",q);}y+=25;
    }
    y=p.bottom()-82;
    text(ctx.canvas,"Custom name",p.x,y,style(12));text(ctx.canvas,"Stars",p.x+270,y,style(12));text(ctx.canvas,"Max uses (0 unlimited)",p.x+390,y,style(12));
    field(ctx,forms.code,{p.x,y+12,260,32},"EVENT_NAME",32);field(ctx,forms.reward,{p.x+270,y+12,110,32},"100",9);field(ctx,forms.uses,{p.x+390,y+12,150,32},"1",7);
    if(button(ctx,{p.right()-170,y+12,160,32},"Create named code")){Json q=Json::object();q["name"]=forms.code.text;q["stars"]=number(forms.reward.text);q["uses"]=number(forms.uses.text);browse("create",q);}
    result(ctx,"codes",{p.x,p.bottom()-26,p.w,24});
}
void renderEventRules(MenuContext& ctx,Rect p) {
    account(ctx);const auto& reply=ctx.net.adminTools("event");
    const auto sendEvent=[&](const char* action,Json q=Json::object()){send(ctx,"event",action,q);};
        Json rules=reply["rules"].isObject()?reply["rules"]:Json::object();
        if(!rules["maxRarity"].isNumber())rules["maxRarity"]=kRarityCount-1;
        if(!rules["activeSlots"].isNumber())rules["activeSlots"]=int(kLoadoutActiveSlots);
        if(!rules["bannedPetals"].isArray())rules["bannedPetals"]=Json::array();
        if(!rules["bannedRarities"].isArray())rules["bannedRarities"]=Json::array();
        const auto apply=[&]{Json q=Json::object();q["rules"]=rules;sendEvent("rules",q);};
        text(ctx.canvas,"Event rules: server enforced, autosaved, included in named presets",p.x,p.y+12,style(14));
        if(button(ctx,{p.x,p.y+40,210,30},rules["lockLoadout"].asBool()?"Loadout: LOCKED":"Loadout: editable")){rules["lockLoadout"]=!rules["lockLoadout"].asBool();apply();}
        const int active=rules["activeSlots"].asInt();
        text(ctx.canvas,"Active slots: "+std::to_string(active),p.x+230,p.y+55,style());
        if(button(ctx,{p.x+360,p.y+40,32,30},"-")){rules["activeSlots"]=std::max(1,active-1);apply();}
        if(button(ctx,{p.x+398,p.y+40,32,30},"+")){rules["activeSlots"]=std::min(int(kLoadoutActiveSlots),active+1);apply();}
        int max=rules["maxRarity"].asInt();
        text(ctx.canvas,"Max rarity: "+std::string(rarityLabel(Rarity(max))),p.x,p.y+93,style());
        if(button(ctx,{p.x+240,p.y+78,32,30},"-")){rules["maxRarity"]=std::max(0,max-1);apply();}
        if(button(ctx,{p.x+278,p.y+78,32,30},"+")){rules["maxRarity"]=std::min(kRarityCount-1,max+1);apply();}
        const char* keys[]{"noHealing","noProjectiles","noSummons","noAdmin"};
        const char* labels[]{"Healing / revive","Projectiles","Egg summons","Admin gear"};
        for(int i=0;i<4;++i) {
            const bool banned=rules[keys[i]].asBool();
            if(button(ctx,{p.x+i*(p.w/4),p.y+122,p.w/4-6,30},std::string(banned?"Banned: ":"Allow: ")+labels[i])){rules[keys[i]]=!banned;apply();}
        }
        text(ctx.canvas,"Toggle exact rarity bans",p.x,p.y+177,style());
        for(int r=0;r<kRarityCount;++r) {
            bool banned=false;for(const auto& v:rules["bannedRarities"].items())if(v.asInt()==r)banned=true;
            if(button(ctx,{p.x+(r%6)*(p.w/6),p.y+194+(r/6)*34,p.w/6-6,28},std::string(banned?"X ":"OK ")+rarityLabel(Rarity(r)))) {
                Json selected=Json::array();for(const auto& v:rules["bannedRarities"].items())if(v.asInt()!=r)selected.push(v);
                if(!banned)selected.push(r);rules["bannedRarities"]=selected;apply();
            }
        }
        field(ctx,forms.bannedIds,{p.x,p.y+274,p.w-214,30},"Petal IDs, comma or space separated",1024);
        if(button(ctx,{p.right()-204,p.y+274,94,30},"Ban IDs" )||button(ctx,{p.right()-104,p.y+274,94,30},"Unban IDs")) {
            const bool unban=ctx.mouse().x>=p.right()-104;
            std::string input=forms.bannedIds.text;for(char& c:input)if(c==',')c=' ';
            std::istringstream stream(input);std::string id;Json ids=rules["bannedPetals"];
            while(stream>>id){Json next=Json::array();bool found=false;for(const auto& v:ids.items()){if(v.asString()==id){found=true;if(unban)continue;}next.push(v);}if(!found&&!unban)next.push(id);ids=next;}
            rules["bannedPetals"]=ids;apply();
        }
        std::string banned="Banned IDs: ";for(const auto& id:rules["bannedPetals"].items())banned+=id.asString()+" ";
        text(ctx.canvas,ellipsize(banned,12,p.w),p.x,p.y+326,style(12));
        text(ctx.canvas,"Bans affect temporary bags and both loadout rows. Normal items stay saved.",p.x,p.y+350,style(12));
        text(ctx.canvas,"Changes take effect immediately for everyone in the hosted arena.",p.x,p.y+374,style(12));
        result(ctx,"event",{p.x,p.bottom()-28,p.w,24});
}
void renderEventSetup(MenuContext& ctx,Rect p) {
    account(ctx);const auto sendEvent=[&](const char* action,Json q=Json::object()){send(ctx,"event",action,q);};
    if(!forms.eventLoaded){forms.eventLoaded=true;sendEvent("list");}
    const auto& reply=ctx.net.adminTools("event");const auto& events=reply["events"];
    if(button(ctx,{p.right()-168,p.y+72,158,28},forms.rulesView?"Inventory / presets":"Event restrictions"))forms.rulesView=!forms.rulesView;
    if(button(ctx,{p.x+330,p.y+72,110,28},"Refresh"))sendEvent("list");
    if(forms.rulesView){renderEventRules(ctx,p);return;}
    text(ctx.canvas,"Saved events include the map, themes, PvP setting and temporary kit.",p.x,p.y+10,style());
    field(ctx,forms.eventName,{p.x,p.y+30,230,32},"Event name");
    for(int i=0;i<3;++i){const char* labels[]{"Save event","Load event","Delete event"};const char* actions[]{"save","load","delete"};if(button(ctx,{p.x+240+i*140,p.y+30,130,32},labels[i])){Json q=Json::object();q["name"]=forms.eventName.text;sendEvent(actions[i],q);}}
    if(events.isArray()&&!events.items().empty()) {
        forms.eventIndex=std::clamp(forms.eventIndex,0,int(events.size())-1);
        if(button(ctx,{p.x,p.y+72,32,28},"<"))forms.eventIndex=(forms.eventIndex+int(events.size())-1)%events.size();
        if(button(ctx,{p.x+280,p.y+72,32,28},">"))forms.eventIndex=(forms.eventIndex+1)%events.size();
        if(button(ctx,{p.x+42,p.y+72,228,28},events[forms.eventIndex].asString()))forms.eventName.text=events[forms.eventIndex].asString();
    }
    text(ctx.canvas,reply["kitEnabled"].asBool()?"Temporary event kit enabled":"Personal gear copied into temporary event bags",p.x,p.y+126,style(15));
    if(button(ctx,{p.x,p.y+148,190,32},"Copy my bag + loadout"))sendEvent("capture");
    if(button(ctx,{p.x+200,p.y+148,170,32},"Empty temporary kit"))sendEvent("clear");
    if(button(ctx,{p.x+380,p.y+148,200,32},"Use personal gear"))sendEvent("off");
    text(ctx.canvas,"Petal ID",p.x,p.y+202,style(12));text(ctx.canvas,"Rarity",p.x+170,p.y+202,style(12));text(ctx.canvas,"Amount",p.x+344,p.y+202,style(12));text(ctx.canvas,"Slot (1-20)",p.x+430,p.y+202,style(12));
    field(ctx,forms.kitItem,{p.x,p.y+214,160,30},"basic");
    if(button(ctx,{p.x+170,p.y+214,28,30},"<"))forms.kitRarity=std::max(0,forms.kitRarity-1);
    text(ctx.canvas,rarityLabel(Rarity(forms.kitRarity)),p.x+204,p.y+229,style(12));
    if(button(ctx,{p.x+306,p.y+214,28,30},">"))forms.kitRarity=std::min(kRarityCount-1,forms.kitRarity+1);
    field(ctx,forms.kitAmount,{p.x+344,p.y+214,76,30},"1",7);field(ctx,forms.kitSlot,{p.x+430,p.y+214,76,30},"1",2);
    const auto itemRequest=[&]{Json q=Json::object();q["item"]=forms.kitItem.text;q["rarity"]=forms.kitRarity;q["amount"]=number(forms.kitAmount.text);q["slot"]=number(forms.kitSlot.text)-1;return q;};
    if(button(ctx,{p.x+516,p.y+214,94,30},"Add stack"))sendEvent("add",itemRequest());
    if(button(ctx,{p.x+620,p.y+214,p.w-630,30},"Set slot"))sendEvent("slot",itemRequest());
    if(button(ctx,{p.x+516,p.y+250,94,26},"Remove"))sendEvent("remove",itemRequest());
    if(button(ctx,{p.x+620,p.y+250,p.w-630,26},"Clear slot"))sendEvent("clear_slot",itemRequest());
    text(ctx.canvas,"Configured loadout",p.x,p.y+270,style(12));
    const auto& slots=reply["kit"]["loadout"];
    if(slots.isArray())for(std::size_t i=0;i<slots.size()&&i<20;++i) {
        const double x=p.x+(i%10)*(p.w/10),y=p.y+285+(i/10)*40;
        const std::string item=slots[i]["petalType"].asString();
        text(ctx.canvas,std::to_string(i+1)+": "+(item.empty()?"-":item.substr(0,7)),x,y+14,style(10));
    }
    double bagCount=reply["kit"]["inventory"][rarityName(Rarity(forms.kitRarity))]["petal_"+forms.kitItem.text].asDouble();
    if(reply["kit"]["loadoutInInventory"].asBool())for(const auto& slot:slots.items())
        if(slot["petalType"].asString()==forms.kitItem.text && slot["rarity"].asString()==rarityName(Rarity(forms.kitRarity)))bagCount=std::max(0.0,bagCount-1);
    text(ctx.canvas,"Bag: "+money(bagCount)+" x "+rarityLabel(Rarity(forms.kitRarity))+" "+forms.kitItem.text,p.x,p.bottom()-70,style(12));
    text(ctx.canvas,"Event gear and event earnings are discarded on exit. Normal gear stays saved.",p.x,p.bottom()-46,style(12));
    result(ctx,"event",{p.x,p.bottom()-28,p.w,24});
}

}
