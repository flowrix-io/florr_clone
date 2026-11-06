#include "client/ui/menus.h"
#include "client/ui/commerce_ui.h"
#include "client/ui/casino_animation.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/menu_theme.h"
#include "shared/game/economy.h"
#include <cmath>
#include <iomanip>
#include <sstream>
namespace flix {
using namespace ui;
namespace {
struct Field {std::string text;TextFieldState state;};
struct Forms {
    std::string account; bool marketLoaded=false,orders=false,casinoLoaded=false,codesLoaded=false;
    int rarity=0,offset=0,codeOffset=0,eventIndex=0,kitRarity=0;
    bool eventLoaded=false;
    Field eventName{"event_name"},kitItem{"basic"},kitAmount{"1"},kitSlot{"1"};
    Field item{"basic"},quantity{"1"},price{"1"},filter{},bet{"10"},code{},reward{"100"},uses{"1"};
    Field exchange{"10"},cashout{"10"};
    CasinoAnimation animation;
    bool autoPlinko=false;double lastCasinoFrame=-100,shownStars=0,shownChips=0;
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
void send(MenuContext& ctx,const char* kind,const char* action,Json q=Json::object()) {q["kind"]=kind;q["action"]=action;ctx.net.requestCommerce(q);}
void result(MenuContext& ctx,const char* kind,Rect r) {const auto& reply=ctx.net.commerce(kind);text(ctx.canvas,ellipsize(reply["message"].asString(),12,r.w),r.x,r.y+r.h/2,style(12,reply["ok"].asBool(true)?0xF1E8FFu:0xFFAAAAu));}
}
void resetCommerceUi(){forms=Forms{};}
void stopCasinoAuto(){forms.autoPlinko=false;}
void renderCasinoAnimation(Canvas& c,Rect board,const CasinoAnimation& a,double now) {
    fillRound(c,board,8,0x353456u);
    const double progress=a.progress(now);
    const auto circle=[&](double x,double y,double radius,std::uint32_t fill) {
        c.beginPath();c.arc(float(x),float(y),float(radius),0,float(kPi*2));setFill(c,fill);c.fill();
    };
    if(a.game=="flip") {
        const double eased=1-std::pow(1-progress,3);
        const double angle=eased*(12*kPi+(a.side=="tails"?kPi:0));
        const double cx=board.x+board.w/2,cy=board.y+board.h/2-std::sin(progress*kPi)*35;
        const double rx=std::max(3.0,46*std::abs(std::cos(angle)));
        c.beginPath();c.ellipse(float(cx),float(cy),float(rx),46,0,0,float(kPi*2));setFill(c,0xAF771Fu);c.fill();
        c.beginPath();c.ellipse(float(cx),float(cy-3),float(rx*.9),40,0,0,float(kPi*2));setFill(c,0xFFDA62u);c.fill();
        if(rx>16) {auto t=style(26,0x72501Bu);t.align=Align::Centre;const bool heads=progress>=1?a.side=="heads":std::cos(angle)>=0;text(c,heads?"H":"T",cx,cy-2,t);}
        auto t=style(13);t.align=Align::Centre;text(c,a.pending?"Waiting for server...":progress<1?"Flipping...":a.side=="heads"?"HEADS":"TAILS",cx,board.bottom()-17,t);
        return;
    }
    const double step=(board.w-38)/17,dy=(board.h-48)/16,cx=board.x+board.w/2,top=board.y+12;
    for(int row=0;row<kPlinkoRows;++row)for(int peg=0;peg<=row;++peg)
        circle(cx+(peg-row*.5)*step,top+row*dy,2.2,0xD9D8EDu);
    for(int slot=0;slot<17;++slot) {
        const double x=cx+(slot-8)*step;
        const bool landed=a.settled && progress>=1 && slot==a.slot;
        const int payout=kPlinkoPayouts[slot];
        fillRound(c,{x-step*.47,board.bottom()-29,step*.94,24},3,landed?0xFFE477u:payout==0?0xAA465Fu:payout>1?0x7160B2u:0x505077u);
        auto t=style(payout>=100?8:10,landed?0x39324Fu:0xFFFFFFu);t.align=Align::Centre;text(c,std::to_string(payout)+"x",x,board.bottom()-17,t);
    }
    if(a.settled) {
        const double hops=std::min(16.0,progress*17);
        const int row=std::min(15,int(hops));const double local=hops-row;
        int rights=0;for(int i=0;i<row;++i)rights+=(a.path>>i)&1;
        const int direction=((a.path>>row)&1)?1:-1;
        const double x=cx+(rights-row*.5+direction*.5*local)*step;
        const double y=top-6+(row+local)*dy-std::sin(local*kPi)*dy*.65+std::max(0.0,progress*17-16)*25;
        // A rotating poker chip, with a white rim and red centre.
        circle(x,y,6,0xF3F0FFu);circle(x,y,4.1,0xDC5472u);
        c.save();c.translate(float(x),float(y));c.rotate(float(now*5));setFill(c,0xFFFFFFu);c.fillRect(-1,-4,2,8);c.restore();
    } else {
        circle(cx,top-6,5,0xFFE477u);
    }
}
bool renderCasino(MenuContext& ctx) {
    account(ctx);if(!forms.casinoLoaded){forms.casinoLoaded=true;send(ctx,"casino","status");}
    if(ctx.timeSeconds-forms.lastCasinoFrame>.5)forms.autoPlinko=false;
    forms.lastCasinoFrame=ctx.timeSeconds;
    const Rect p=ctx.bounds;panelCard(ctx.canvas,p,kAdminDashboardSkin);panelHeading(ctx.canvas,p,"Hel Casino");
    const auto close=closeButtonRect(p);panelClose(ctx.canvas,close,close.contains(ctx.mouse()));if(ctx.clicked(close)){forms.autoPlinko=false;return false;}
    const auto& reply=ctx.net.commerce("casino");
    forms.animation.update(reply,ctx.timeSeconds);
    const bool busy=forms.animation.busy(ctx.timeSeconds);
    if(!busy){forms.shownStars=reply["stars"].asDouble(ctx.net.profile().stars);forms.shownChips=reply["chips"].asDouble();}
    if(!forms.animation.pending&&!forms.animation.settled&&!forms.animation.message.empty())forms.autoPlinko=false;
    text(ctx.canvas,"Stars: "+money(forms.shownStars)+"     Chips: "+money(forms.shownChips),p.x+24,p.y+70,style(18,0xFFE477u));
    text(ctx.canvas,"1 star = 1 chip. No tax. Amounts up to 19k (e.g. 2.5k).",p.x+24,p.y+98,style(12));
    field(ctx,forms.exchange,{p.x+24,p.y+117,88,30},"Stars",8);
    field(ctx,forms.cashout,{p.x+300,p.y+117,88,30},"Chips",8);
    const auto action=[&](const char* verb,const std::string& amount,const char* side="") {
        Json q=Json::object();q["amount"]=amount;q["side"]=side;send(ctx,"casino",verb,q);
        if(std::string(verb)=="flip"||std::string(verb)=="plinko")forms.animation.begin(verb,reply["revision"].asDouble(),ctx.timeSeconds);
        else {forms.animation=CasinoAnimation{};forms.autoPlinko=false;}
    };
    const auto control=[&](Rect r,const std::string& label) {if(!busy)return button(ctx,r,label);chip(ctx.canvas,r,label,false,ChipStyle{0x44435Fu,0x35344Fu});return false;};
    if(control({p.x+122,p.y+117,160,30},"Stars to chips"))action("buy",forms.exchange.text);
    if(control({p.x+398,p.y+117,182,30},"Cash out chips"))action("cashout",forms.cashout.text);
    text(ctx.canvas,"Bet",p.x+24,p.y+166,style());field(ctx,forms.bet,{p.x+24,p.y+181,150,30},"1-19k",8);
    if(button(ctx,{p.x+24,p.y+341,150,30},forms.autoPlinko?"Stop Auto":"Auto Plinko"))forms.autoPlinko=!forms.autoPlinko;
    if(control({p.x+24,p.y+221,150,32},"Bet Heads")){forms.autoPlinko=false;action("flip",forms.bet.text,"heads");}
    if(control({p.x+24,p.y+261,150,32},"Bet Tails")){forms.autoPlinko=false;action("flip",forms.bet.text,"tails");}
    if(control({p.x+24,p.y+301,150,32},"Drop Chip"))action("plinko",forms.bet.text);
    if(forms.autoPlinko&&!forms.animation.busy(ctx.timeSeconds)&&(!forms.animation.settled||ctx.timeSeconds-forms.animation.startedAt>forms.animation.duration()+.4))action("plinko",forms.bet.text);
    renderCasinoAnimation(ctx.canvas,{p.x+194,p.y+161,p.w-218,std::max(160.0,p.h-221)},forms.animation,ctx.timeSeconds);
    text(ctx.canvas,"Plinko: 16 fair bounces, 17 slots. 500x edge jackpot. Return: 99.56%.",p.x+24,p.bottom()-45,style(11));
    text(ctx.canvas,"Flip: 40% win, 2x payout. Whole chips only. One action per second.",p.x+24,p.bottom()-28,style(11));
    const std::string message=busy?(forms.animation.pending?"Waiting for the server...":"Playing..."):!forms.animation.message.empty()?forms.animation.message:reply["message"].asString();
    text(ctx.canvas,ellipsize(message,12,p.w-48),p.x+24,p.bottom()-11,style(12));return true;
}
void renderMarket(MenuContext& ctx,Rect p,bool orders) {
    account(ctx);
    const auto browse=[&](const char* action="browse",Json q=Json::object()) {q["orders"]=orders;q["offset"]=forms.offset;q["filter"]=forms.filter.text;send(ctx,"market",action,q);};
    if(!forms.marketLoaded||forms.orders!=orders){forms.marketLoaded=true;forms.orders=orders;forms.offset=0;browse();}
    const auto& reply=ctx.net.commerce("market");
    text(ctx.canvas,orders?"Fund requests; other players supply petals.":"Player petal listings. Seller receives 80%; tax 20%.",p.x,p.y+10,style());
    field(ctx,forms.filter,{p.x,p.y+25,220,30},"Filter by petal ID");
    if(button(ctx,{p.x+230,p.y+25,90,30},"Refresh")){forms.offset=0;browse();}
    if(button(ctx,{p.right()-150,p.y+25,66,30},"<")){forms.offset=std::max(0,forms.offset-7);browse();}
    if(button(ctx,{p.right()-76,p.y+25,66,30},">")){if(forms.offset+7<reply["total"].asDouble())forms.offset+=7;browse();}
    double y=p.y+66;
    const auto& rows=reply["rows"];
    if(rows.isArray())for(const auto& row:rows.items()) {
        const auto rarity=Rarity(std::clamp(row["rarity"].asInt(),0,kLadderRarityCount-1));
        const std::string description=row["item"].asString()+" / "+rarityLabel(rarity)+" x"+money(row["quantity"].asDouble())+" / "+money(row["price"].asDouble())+" stars each / @"+row["seller"].asString();
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
    field(ctx,forms.quantity,{p.x+344,formY+12,76,30},"1",7);field(ctx,forms.price,{p.x+430,formY+12,90,30},"Price",9);
    if(button(ctx,{p.x+530,formY+12,p.w-540,30},orders?"Post order":"List petals")) {Json q=Json::object();q["item"]=forms.item.text;q["rarity"]=forms.rarity;q["quantity"]=number(forms.quantity.text);q["price"]=number(forms.price.text);browse("post",q);}
    text(ctx.canvas,"Minimum: "+money(marketMinimum(Rarity(forms.rarity)))+" stars each (Common 1, x3 per rarity). Orders reserve stars; listings reserve petals.",p.x,formY+57,style(11));
    result(ctx,"market",{p.x,p.bottom()-29,p.w,25});
}
void renderStarCodes(MenuContext& ctx,Rect p) {
    account(ctx);
    const auto browse=[&](const char* action="list",Json q=Json::object()){q["offset"]=forms.codeOffset;send(ctx,"codes",action,q);};
    if(!forms.codesLoaded){forms.codesLoaded=true;browse();}
    text(ctx.canvas,"Active star codes (full tier 1-2 admins)",p.x,p.y+12,style());
    if(button(ctx,{p.right()-230,p.y,90,30},"Refresh"))browse();
    if(button(ctx,{p.right()-130,p.y,55,30},"<")){forms.codeOffset=std::max(0,forms.codeOffset-12);browse();}
    if(button(ctx,{p.right()-65,p.y,55,30},">")){if(forms.codeOffset+12<ctx.net.commerce("codes")["total"].asDouble())forms.codeOffset+=12;browse();}
    double y=p.y+40;const auto& rows=ctx.net.commerce("codes")["rows"];
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
void renderEventSetup(MenuContext& ctx,Rect p) {
    account(ctx);const auto sendEvent=[&](const char* action,Json q=Json::object()){send(ctx,"event",action,q);};
    if(!forms.eventLoaded){forms.eventLoaded=true;sendEvent("list");}
    const auto& reply=ctx.net.commerce("event");const auto& events=reply["events"];
    text(ctx.canvas,"Saved events include the map, themes, PvP setting and temporary kit.",p.x,p.y+10,style());
    field(ctx,forms.eventName,{p.x,p.y+30,230,32},"Event name");
    for(int i=0;i<3;++i){const char* labels[]{"Save event","Load event","Delete event"};const char* actions[]{"save","load","delete"};if(button(ctx,{p.x+240+i*140,p.y+30,130,32},labels[i])){Json q=Json::object();q["name"]=forms.eventName.text;sendEvent(actions[i],q);}}
    if(events.isArray()&&!events.items().empty()) {
        forms.eventIndex=std::clamp(forms.eventIndex,0,int(events.size())-1);
        if(button(ctx,{p.x,p.y+72,32,28},"<"))forms.eventIndex=(forms.eventIndex+int(events.size())-1)%events.size();
        if(button(ctx,{p.x+280,p.y+72,32,28},">"))forms.eventIndex=(forms.eventIndex+1)%events.size();
        if(button(ctx,{p.x+42,p.y+72,228,28},events[forms.eventIndex].asString()))forms.eventName.text=events[forms.eventIndex].asString();
    }
    text(ctx.canvas,reply["kitEnabled"].asBool()?"Temporary event kit enabled":"Normal inventories (no event kit)",p.x,p.y+126,style(15));
    if(button(ctx,{p.x,p.y+148,190,32},"Copy my bag + loadout"))sendEvent("capture");
    if(button(ctx,{p.x+200,p.y+148,170,32},"Empty temporary kit"))sendEvent("clear");
    if(button(ctx,{p.x+380,p.y+148,200,32},"Restore normal inventory"))sendEvent("off");
    text(ctx.canvas,"Petal ID",p.x,p.y+202,style(12));text(ctx.canvas,"Rarity",p.x+170,p.y+202,style(12));text(ctx.canvas,"Amount",p.x+344,p.y+202,style(12));text(ctx.canvas,"Slot (1-20)",p.x+430,p.y+202,style(12));
    field(ctx,forms.kitItem,{p.x,p.y+214,160,30},"basic");
    if(button(ctx,{p.x+170,p.y+214,28,30},"<"))forms.kitRarity=std::max(0,forms.kitRarity-1);
    text(ctx.canvas,rarityLabel(Rarity(forms.kitRarity)),p.x+204,p.y+229,style(12));
    if(button(ctx,{p.x+306,p.y+214,28,30},">"))forms.kitRarity=std::min(kRarityCount-1,forms.kitRarity+1);
    field(ctx,forms.kitAmount,{p.x+344,p.y+214,76,30},"1",7);field(ctx,forms.kitSlot,{p.x+430,p.y+214,76,30},"1",2);
    const auto itemRequest=[&]{Json q=Json::object();q["item"]=forms.kitItem.text;q["rarity"]=forms.kitRarity;q["amount"]=number(forms.kitAmount.text);q["slot"]=number(forms.kitSlot.text)-1;return q;};
    if(button(ctx,{p.x+516,p.y+214,94,30},"Add stack"))sendEvent("add",itemRequest());
    if(button(ctx,{p.x+620,p.y+214,p.w-630,30},"Set slot"))sendEvent("slot",itemRequest());
    text(ctx.canvas,"Configured loadout",p.x,p.y+270,style(12));
    const auto& slots=reply["kit"]["loadout"];
    if(slots.isArray())for(std::size_t i=0;i<slots.size()&&i<20;++i) {
        const double x=p.x+(i%10)*(p.w/10),y=p.y+285+(i/10)*40;
        const std::string item=slots[i]["petalType"].asString();
        text(ctx.canvas,std::to_string(i+1)+": "+(item.empty()?"-":item.substr(0,7)),x,y+14,style(10));
    }
    text(ctx.canvas,"Bag: "+money(reply["kit"]["inventory"][rarityName(Rarity(forms.kitRarity))]["petal_"+forms.kitItem.text].asDouble())+" x "+rarityLabel(Rarity(forms.kitRarity))+" "+forms.kitItem.text,p.x,p.bottom()-70,style(12));
    text(ctx.canvas,"Event gear and event earnings are discarded on exit. Normal gear stays saved.",p.x,p.bottom()-46,style(12));
    result(ctx,"event",{p.x,p.bottom()-28,p.w,24});
}

}
