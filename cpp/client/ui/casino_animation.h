#pragma once
#include "shared/core/json.h"
#include "shared/core/types.h"
#include "shared/game/casino.h"
#include <algorithm>
#include <string>
#include "canvas.h"
namespace flix {
// Presentation only: the server settles the wager and supplies every bounce.
struct CasinoAnimation {
    std::string game,message,side;
    bool pending=false,settled=false;
    double revision=0,requestedAt=0,startedAt=0;
    int path=0,slot=8,multiplier=0;
    void begin(const std::string& kind,double currentRevision,double now) {
        *this=CasinoAnimation{};game=kind;pending=true;revision=currentRevision;requestedAt=now;
    }
    double duration() const {return game=="flip"?2.4:4.4;}
    double progress(double now) const {return settled?std::clamp((now-startedAt)/duration(),0.0,1.0):0;}
    bool busy(double now) const {return pending || (settled && progress(now)<1);}
    void update(const Json& reply,double now) {
        if(!pending)return;
        if(reply["revision"].asDouble() > revision) {
            if(!reply["ok"].asBool(true)) {pending=false;message=reply["message"].asString();return;}
            if(reply["game"].asString()==game) {
                side=reply["side"].asString();path=reply["path"].asInt(-1);slot=reply["slot"].asInt(-1);
                if((game=="flip" && side!="heads" && side!="tails") ||
                   (game=="plinko" && (plinkoSlot(path)<0 || plinkoSlot(path)!=slot))) {
                    pending=false;message="Invalid game result. Reopen the casino to refresh.";return;
                }
                pending=false;settled=true;startedAt=now;multiplier=reply["multiplier"].asInt();message=reply["message"].asString();return;
            }
        }
        if(now-requestedAt>=8){pending=false;message="No reply yet. Reopen the casino to check your balance before retrying.";}
    }
};
void renderCasinoAnimation(Canvas&,Rect,const CasinoAnimation&,double now);
}
