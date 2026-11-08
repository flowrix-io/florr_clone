#include "server/game_server.h"
#include <cctype>
#include <cmath>
#include <cstdio>
namespace flix {
namespace {
bool integer(const Json& j,int lo,int hi,int& out) {
    const double v=j.asDouble(-1); if(!std::isfinite(v)||v<lo||v>hi||std::floor(v)!=v)return false;
    out=int(v);return true;
}
}
void GameServer::sendAdminTools(Session& s,net::Connection& peer,const std::string& kind,bool ok,const std::string& message,const Json& data) {
    Json reply=data;reply["kind"]=kind;reply["ok"]=ok;reply["message"]=message;reply["revision"]=double(++s.adminToolsRevision);
    ByteWriter w;w.u8(std::uint8_t(net::ServerMessage::AdminTools));w.str(reply.dump());peer.send(w);
}
void GameServer::handleAdminTools(Session& s,net::Connection& peer,ByteReader& reader) {
    const auto raw=reader.str();if(!reader.ok()||!s.authenticated()||raw.size()>16384)return;
    const Json q=Json::parseOrNull(raw);if(!q.isObject())return;
    const auto kind=q["kind"].asString(),action=q["action"].asString();
    if(kind=="market"){runMarket(s,peer,q);return;}
    if(kind=="poll"){runPollRequest(s,peer,q);return;}
    if(kind=="event"||kind=="arena"){runEventSetup(s,peer,q);return;}
    if(kind=="codes") {
        if(!s.admin || !adminMay(s,AdminPower::GivePetals)) {sendAdminTools(s,peer,kind,false,"Full tier 1-2 admin access required.");return;}
        if(action!="create"&&action!="delete"&&action!="list"){sendAdminTools(s,peer,kind,false,"Unknown code action.");return;}
        auto name=q["name"].asString();
        for(char& c:name)c=char(std::toupper(static_cast<unsigned char>(c)));
        std::string message="Active star codes";
        if(action=="create") {
            int uses=0; const double stars=q["stars"].asDouble(-1);
            if(name.empty()||name.size()>32||name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=std::string::npos||(!std::isfinite(stars)||std::floor(stars)!=stars||stars>1000000000)||stars<1||!integer(q["uses"],0,1000000,uses)) {sendAdminTools(s,peer,kind,false,"Use a 1-32 character code (letters, digits, _ or -), a positive star reward, and a use limit 0-1000000 (0 unlimited).");return;}
            if(database_.storedTable("codes").contains(name)) {sendAdminTools(s,peer,kind,false,"That code already exists.");return;}
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
        data["rows"]=rows;data["total"]=total;data["offset"]=offset;sendAdminTools(s,peer,kind,true,message,data);return;
    }

}
}
