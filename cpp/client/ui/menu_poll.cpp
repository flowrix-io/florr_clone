#include "client/ui/menus.h"
#include "client/ui/poll_ui.h"
#include "client/ui/menu_theme.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include <array>
#include <cmath>
namespace flix {
using namespace ui;
namespace {
struct Field {std::string text;TextFieldState state;};
struct Form {std::string user;Field question,seconds{"60"};std::array<Field,6> options;int count=2;} form;
TextStyle style(double size=14,std::uint32_t color=0xFFFFFFu){TextStyle s;s.size=size;s.fill=color;s.baseline=Baseline::Middle;return s;}
std::vector<std::string> lines(const std::string& value,double width,double size) {
    std::vector<std::string> result;std::string line;
    for(std::size_t i=0;i<value.size();) {
        std::size_t count=1;while(i+count<value.size() && (static_cast<unsigned char>(value[i+count])&0xC0)==0x80)++count;
        const auto glyph=value.substr(i,count);i+=count;
        if(!line.empty() && measure(line+glyph,size)>width){result.push_back(line);line.clear();}
        line+=glyph;
    }
    if(!line.empty())result.push_back(line);return result;
}
void field(MenuContext& ctx,Field& f,Rect r,const char* placeholder,std::size_t max) {
    inputField(ctx.canvas,r,f.text,placeholder,f.state.focused,ctx.timeSeconds,&f.state);
    if(!ctx.pointerBlocked)trackTextMouse(ctx.window,f.state,r,inputFieldRun(r,f.text,f.state),f.text,ctx.timeSeconds);
    if(f.state.focused){ctx.wantsText=true;TextEditOptions options;options.maxBytes=max;editText(ctx.window,f.text,f.state,ctx.timeSeconds,options);}
}
bool click(MenuContext& ctx,Rect r,const std::string& label){chip(ctx.canvas,r,label,ctx.over(r),ChipStyle{0x7473B0u,0x48477Au});return ctx.clicked(r);}
void request(NetClient& net,const char* action,Json q=Json::object()){q["kind"]="poll";q["action"]=action;net.requestAdminTools(q);}
struct Overlay {std::string id;double offset=0,pendingAt=0,pendingRevision=0;bool pending=false;} overlay;
double contentHeight(const Json& poll,double width) {
    double height=lines(poll["question"].asString(),width-32,14).size()*18+10;
    for(const auto& option:poll["options"].items())height+=std::max(34.0,lines(option.asString(),width-52,13).size()*16.0+10)+6;
    return height;
}
}
void PollCreatorPanel::reset(){form=Form{};}
Rect PollCreatorPanel::bounds(int w,int h) {const double width=std::min(600.0,double(w)-24),height=std::min(540.0,double(h)-16);return {(w-width)/2,(h-height)/2,width,height};}
bool PollCreatorPanel::render(MenuContext& ctx) {
    if(!ctx.net.isSkinAdmin())return false;
    if(form.user!=ctx.net.profile().username){form=Form{};form.user=ctx.net.profile().username;}
    const auto p=ctx.bounds;panelCard(ctx.canvas,p,kAdminDashboardSkin);panelHeading(ctx.canvas,p,"Create poll");
    const Rect close=closeButtonRect(p);panelClose(ctx.canvas,close,ctx.over(close));if(ctx.clicked(close))return false;
    text(ctx.canvas,"Question (120 bytes max)",p.x+20,p.y+66,style(13));field(ctx,form.question,{p.x+20,p.y+80,p.w-40,32},"Ask the players...",120);
    text(ctx.canvas,"Choices: "+std::to_string(form.count),p.x+20,p.y+133,style());
    if(click(ctx,{p.right()-110,p.y+118,36,28},"-"))form.count=std::max(2,form.count-1);
    if(click(ctx,{p.right()-66,p.y+118,36,28},"+"))form.count=std::min(6,form.count+1);
    const double row=std::min(40.0,(p.h-265)/6);
    for(int i=0;i<form.count;++i){text(ctx.canvas,std::to_string(i+1),p.x+20,p.y+166+i*row,style());field(ctx,form.options[i],{p.x+44,p.y+151+i*row,p.w-64,30},"Option (60 bytes max)",60);}
    const double y=p.bottom()-100;text(ctx.canvas,"Time limit in seconds (10-3600)",p.x+20,y-14,style(13));
    field(ctx,form.seconds,{p.x+20,y,120,32},"60",4);
    if(click(ctx,{p.x+154,y,p.w-174,32},"Create poll")) {
        Json q=Json::object(),options=Json::array();for(int i=0;i<form.count;++i)options.push(form.options[i].text);
        q["question"]=form.question.text;q["options"]=options;
        try {std::size_t used=0;const int value=std::stoi(form.seconds.text,&used);q["seconds"]=used==form.seconds.text.size()?value:-1;}catch(...){q["seconds"]=-1;}
        request(ctx.net,"create",q);
    }
    const auto& reply=ctx.net.adminTools("poll_creator");
    text(ctx.canvas,ellipsize(reply["message"].asString(),12,p.w-40),p.x+20,p.bottom()-42,style(12,reply["ok"].asBool()?0xD8F5D8u:0xFFAAAAu));
    text(ctx.canvas,"Results: top-left Debug menu > Polls. One vote per account.",p.x+20,p.bottom()-19,style(12));
    return !(reply["created"].asBool() && reply["ok"].asBool());
}
Rect pollOverlayBounds(const NetClient& net,int w,int h) {
    if(!net.pollVisible())return {};
    const double width=std::max(120.0,std::min(560.0,double(w)-24));
    const double top=std::min(86.0,h*.13);
    const double height=std::min(contentHeight(net.adminTools("poll"),width)+78,std::max(100.0,h-top-8));
    return {(w-width)/2,top,width,height};
}
void renderPollOverlay(MenuContext& ctx) {
    if(!ctx.net.pollVisible())return;
    const auto& poll=ctx.net.adminTools("poll");const auto id=poll["id"].asString();
    if(overlay.id!=id){overlay=Overlay{};overlay.id=id;}
    if(overlay.pending && (poll["revision"].asDouble()>overlay.pendingRevision || ctx.timeSeconds-overlay.pendingAt>2))overlay.pending=false;
    const Rect p=ctx.bounds;plate(ctx.canvas,p,0x27243Fu,8,0x9B89D9u,2);
    text(ctx.canvas,"Poll from "+poll["author"].asString()+"  |  "+std::to_string(int(std::ceil(ctx.net.pollRemainingSeconds())))+"s",p.x+16,p.y+22,style(14,0xC6BCFFu));
    const Rect view{p.x+8,p.y+42,p.w-16,p.h-74};
    const double maximum=std::max(0.0,contentHeight(poll,p.w)-view.h);
    if(ctx.over(view))overlay.offset=clamp(overlay.offset-ctx.wheel()*45,0.0,maximum);
    if(maximum>0) {
        if(click(ctx,{p.right()-66,p.y+7,24,26},"^"))overlay.offset=std::max(0.0,overlay.offset-70);
        if(click(ctx,{p.right()-36,p.y+7,24,26},"v"))overlay.offset=std::min(maximum,overlay.offset+70);
    }
    overlay.offset=clamp(overlay.offset,0.0,maximum);
    ctx.canvas.save();ctx.canvas.beginPath();ctx.canvas.rect(view.x,view.y,view.w,view.h);ctx.canvas.clip();
    double y=view.y-overlay.offset;
    for(const auto& line:lines(poll["question"].asString(),p.w-32,14)){text(ctx.canvas,line,p.x+16,y+10,style());y+=18;}
    y+=10;int index=0;
    for(const auto& option:poll["options"].items()) {
        const auto wrapped=lines(option.asString(),p.w-52,13);const double height=std::max(34.0,wrapped.size()*16.0+10);
        const Rect r{p.x+16,y,p.w-32,height};fillRound(ctx.canvas,r,5,overlay.pending?0x434057u:0x545075u);
        for(std::size_t i=0;i<wrapped.size();++i)text(ctx.canvas,wrapped[i],r.x+10,r.y+13+i*16,style(13));
        if(!overlay.pending && ctx.over(view) && ctx.clicked(r)) {
            Json q=Json::object();q["id"]=id;q["choice"]=index;request(ctx.net,"vote",q);
            overlay.pending=true;overlay.pendingAt=ctx.timeSeconds;overlay.pendingRevision=poll["revision"].asDouble();
        }
        ++index;y+=height+6;
    }
    ctx.canvas.restore();
    text(ctx.canvas,overlay.pending?"Recording your vote...":"Vote to dismiss. Otherwise this closes when the timer ends.",p.x+16,p.bottom()-16,style(12,0xD6CFECu));
}
void renderPollResults(MenuContext& ctx,Rect p) {
    const auto& poll=ctx.net.adminTools("poll");double y=p.y+22;
    const auto line=[&](const std::string& value,double size=13){text(ctx.canvas,ellipsize(value,size,p.w-30),p.x+15,y,style(size));y+=24;};
    if(!poll["canViewResults"].asBool()){line("Full admin access required.");return;}
    if(poll["id"].asString().empty()){line("No poll has been created this session.");line("Use /admin createpoll to open the creator.");return;}
    line(poll["active"].asBool()?"Live poll":"Final results",16);
    for(const auto& question:lines(poll["question"].asString(),p.w-30,13))line(question);
    line("Votes: "+std::to_string(poll["total"].asInt())+" | "+(poll["active"].asBool()?std::to_string(int(std::ceil(ctx.net.pollRemainingSeconds())))+"s remaining":"Time limit reached"));
    const auto& options=poll["options"];const auto& counts=poll["counts"];
    for(std::size_t i=0;i<options.size() && i<counts.size();++i) {
        line(options[i].asString()+" : "+std::to_string(counts[i].asInt()));
        const double share=poll["total"].asDouble()>0?counts[i].asDouble()/poll["total"].asDouble():0;
        fillRound(ctx.canvas,{p.x+15,y-6,p.w-30,8},3,0x35344Fu);fillRound(ctx.canvas,{p.x+15,y-6,(p.w-30)*share,8},3,0x9B89D9u);y+=18;
    }
}
}
