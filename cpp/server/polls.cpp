#include "server/game_server.h"
#include "server/chat_moderation.h"
#include "server/text.h"
#include "shared/game/markup.h"
#include "shared/core/text.h"
#include <cmath>
#include <unordered_set>
namespace flix {
Json GameServer::pollSummary(const HostedPoll& poll) const {
    Json row=Json::object(),options=Json::array(),counts=Json::array();
    for(const auto& option:poll.options)options.push(option);
    for(int count:poll.counts)counts.push(count);
    row["id"]=poll.id;row["question"]=poll.question;row["author"]=poll.author;
    row["options"]=options;row["counts"]=counts;row["total"]=double(poll.votes.size());
    row["active"]=poll.active&&clockMillis_<poll.endsAtMillis;
    return row;
}
void GameServer::sendPollState(Session& s,net::Connection& peer,const std::string& message) {
    Json data=Json::object(),options=Json::array();
    for(const auto& option:poll_.options)options.push(option);
    data["id"]=poll_.id;data["question"]=poll_.question;data["author"]=poll_.author;
    data["options"]=options;data["active"]=poll_.active && clockMillis_<poll_.endsAtMillis;
    data["remainingMillis"]=std::max(0.0,poll_.endsAtMillis-clockMillis_);
    data["voted"]=poll_.votes.count(s.userId)!=0;
    if(s.admin) {
        Json counts=Json::array();for(int count:poll_.counts)counts.push(count);
        data["counts"]=counts;data["total"]=double(poll_.votes.size());data["canViewResults"]=true;
        data["historyCount"]=double(pollHistory_.size()+(poll_.active?1:0));data["historyRevision"]=double(pollHistoryRevision_);
    }
    sendAdminTools(s,peer,"poll",true,message,data);
}
void GameServer::broadcastPollState(const std::string& voter) {
    for(auto& [id,s]:sessions_)if(s.authenticated() && (voter.empty()||s.admin||s.userId==voter))
        if(auto* peer=listener_.find(id))sendPollState(s,*peer);
}
void GameServer::expirePoll() {
    if(poll_.active && clockMillis_>=poll_.endsAtMillis) {
        poll_.active=false;pollHistory_.push_back(pollSummary(poll_));++pollHistoryRevision_;broadcastPollState();
    }
}
void GameServer::runPollRequest(Session& s,net::Connection& peer,const Json& q) {
    expirePoll();const auto action=q["action"].asString();
    if(action=="history"){
        if(!s.admin){sendAdminTools(s,peer,"poll_history",false,"Full admin access required.");return;}
        const double requested=q["offset"].asDouble(0);
        if(!std::isfinite(requested)||requested<0||requested>2147483647.0||std::floor(requested)!=requested){sendAdminTools(s,peer,"poll_history",false,"Invalid history page.");return;}
        const std::size_t total=pollHistory_.size()+(poll_.active?1:0);
        std::size_t offset=total?std::min(std::size_t(requested),total-1):0;
        const auto selected=q["id"].asString();
        if(!selected.empty()){
            if(poll_.active&&selected==poll_.id)offset=0;
            else for(std::size_t i=0;i<pollHistory_.size();++i)if(pollHistory_[i]["id"].asString()==selected){offset=(poll_.active?1:0)+pollHistory_.size()-1-i;break;}
        }
        Json data=Json::object();data["total"]=double(total);data["offset"]=double(offset);data["canViewResults"]=true;
        if(total)data["poll"]=poll_.active&&offset==0?pollSummary(poll_):pollHistory_[pollHistory_.size()-1-(offset-(poll_.active?1:0))];
        sendAdminTools(s,peer,"poll_history",true,"",data);return;
    }
    if(action=="status"){sendPollState(s,peer);return;}
    if(action=="vote") {
        const double choice=q["choice"].asDouble(-1);
        if(!poll_.active||clockMillis_>=poll_.endsAtMillis||q["id"].asString()!=poll_.id){sendPollState(s,peer,"That poll has ended or changed.");return;}
        if(!std::isfinite(choice)||choice<0||choice>=poll_.options.size()||std::floor(choice)!=choice){sendPollState(s,peer,"Choose one of the poll options.");return;}
        if(poll_.votes.count(s.userId)){sendPollState(s,peer,"Your vote is already recorded.");return;}
        poll_.votes.emplace(s.userId,int(choice));++poll_.counts[int(choice)];
        broadcastPollState(s.userId);return;
    }
    const auto fail=[&](const std::string& message){sendAdminTools(s,peer,"poll_creator",false,message);};
    if(!s.admin){fail("Only full admins can create polls.");return;}
    if(action!="create"){fail("Unknown poll action.");return;}
    if(poll_.active){fail("A poll is already running. Wait until its time limit ends.");return;}
    const auto question=sanitizeChat(q["question"].asString());const auto& choices=q["options"];
    const double seconds=q["seconds"].asDouble(-1);
    if(question.empty()||question.size()>120||!choices.isArray()||choices.size()<2||choices.size()>6||
       !std::isfinite(seconds)||seconds<10||seconds>3600||std::floor(seconds)!=seconds){fail("Use a question up to 120 bytes, 2-6 choices, and a duration of 10-3600 seconds.");return;}
    const auto clean=[&](const std::string& text){return blockedWordIn(escapedMarkup(text)).empty() && !chatLineReversesText(escapedMarkup(text));};
    if(!clean(question)){fail("The question contains disallowed language or text-direction controls.");return;}
    std::vector<std::string> options;std::unordered_set<std::string> unique;
    for(const auto& value:choices.items()) {
        const auto text=sanitizeChat(value.asString());
        if(text.empty()||text.size()>60||!unique.insert(lowerCase(text)).second||!clean(text)){fail("Choices must be unique, nonempty, at most 60 bytes, and pass chat moderation.");return;}
        options.push_back(text);
    }
    HostedPoll next;next.id=std::to_string(database_.nowMillis())+"_"+std::to_string(rng_.next());
    next.question=question;next.author=s.username;next.options=std::move(options);next.counts.resize(next.options.size());
    next.endsAtMillis=clockMillis_+seconds*1000;next.active=true;poll_=std::move(next);++pollHistoryRevision_;
    Json result=Json::object();result["created"]=true;
    sendAdminTools(s,peer,"poll_creator",true,"Poll created. Results are in Debug > Polls.",result);
    broadcastPollState();
}
}
