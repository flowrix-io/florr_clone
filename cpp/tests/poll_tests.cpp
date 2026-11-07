#include "test.h"
#include "server_harness.h"
#include "render_rig.h"
#include "client/ui/menus.h"
#include "client/ui/poll_ui.h"
using namespace flix;
using namespace flix::testsupport;
namespace {
bool pollRequest(Harness& h,NetClient& c,const char* action,Json q=Json::object()) {
    const char* kind=std::string(action)=="create"?"poll_creator":"poll";
    const double revision=c.adminTools(kind)["revision"].asDouble();q["kind"]="poll";q["action"]=action;c.requestAdminTools(q);
    return h.stepUntil({&c},[&]{return c.adminTools(kind)["revision"].asDouble()>revision;});
}
Json draft(int seconds=10) {Json q=Json::object();q["question"]="Which biome next?";q["seconds"]=seconds;q["options"]=Json::array();q["options"].push("Garden");q["options"].push("Hel");return q;}
}
TEST(poll_creator_command_is_standalone_and_only_full_admins_can_publish) {
    Harness h("poll-auth",[](const std::string& p){seedUser(p,"boss","password7",true);seedUser(p,"visitor","password7");},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,visitor;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,visitor,"visitor","password7"));
    CHECK(say(h,boss,"/admin createpoll"));CHECK(h.stepUntil({&boss},[&]{return boss.adminTools("poll_creator")["open"].asBool();}));CHECK(boss.takePollCreatorRequest());CHECK(!boss.takePollCreatorRequest());
    CHECK(pollRequest(h,visitor,"create",draft()));CHECK(!visitor.adminTools("poll_creator")["ok"].asBool());CHECK(!boss.pollVisible());
    auto q=draft(0);CHECK(pollRequest(h,boss,"create",q));CHECK(!boss.adminTools("poll_creator")["ok"].asBool());
    q=draft();q["options"][1]="garden";CHECK(pollRequest(h,boss,"create",q));CHECK(!boss.adminTools("poll_creator")["ok"].asBool());
    q=draft();q["question"]="semen";CHECK(pollRequest(h,boss,"create",q));CHECK(!boss.adminTools("poll_creator")["ok"].asBool());
    CHECK(pollRequest(h,boss,"create",draft()));CHECK(boss.adminTools("poll_creator")["ok"].asBool());
    CHECK(h.stepUntil({&visitor},[&]{return visitor.pollVisible();}));CHECK(!visitor.adminTools("poll").contains("counts"));
    CHECK(pollRequest(h,boss,"create",draft()));CHECK(!boss.adminTools("poll_creator")["ok"].asBool());
}
TEST(poll_votes_are_account_bound_idempotent_and_restored_on_reconnect) {
    Harness h("poll-vote",[](const std::string& p){seedUser(p,"boss","password7",true);seedUser(p,"voter","password7");},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,voter;CHECK(loginAs(h,boss,"boss","password7"));CHECK(loginAs(h,voter,"voter","password7"));CHECK(pollRequest(h,boss,"create",draft(60)));
    CHECK(h.stepUntil({&voter},[&]{return voter.pollVisible();}));Json vote=Json::object();vote["id"]=voter.adminTools("poll")["id"];vote["choice"]=-1;
    CHECK(pollRequest(h,voter,"vote",vote));CHECK(!voter.adminTools("poll")["voted"].asBool());
    vote["choice"]=1;CHECK(pollRequest(h,voter,"vote",vote));CHECK(!voter.pollVisible());
    CHECK(h.stepUntil({&boss},[&]{return boss.adminTools("poll")["total"].asInt()==1;}));CHECK_EQ(boss.adminTools("poll")["counts"][1].asInt(),1);
    vote["choice"]=0;CHECK(pollRequest(h,voter,"vote",vote));h.step(3,{&boss});CHECK_EQ(boss.adminTools("poll")["counts"][0].asInt(),0);
    voter.disconnect();h.step(3,{&boss});NetClient reconnected;CHECK(loginAs(h,reconnected,"voter","password7"));
    CHECK(h.stepUntil({&reconnected},[&]{return reconnected.adminTools("poll")["id"].asString()==vote["id"].asString();}));CHECK(reconnected.adminTools("poll")["voted"].asBool());CHECK(!reconnected.pollVisible());
    CHECK(pollRequest(h,reconnected,"vote",vote));h.step(3,{&boss});CHECK_EQ(boss.adminTools("poll")["total"].asInt(),1);
}
TEST(poll_timeout_dismisses_unanswered_banner_and_rejects_late_and_stale_votes) {
    Harness h("poll-expiry",[](const std::string& p){seedUser(p,"boss","password7",true);seedUser(p,"late","password7");},dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    NetClient boss,late;CHECK(loginAs(h,boss,"boss","password7"));CHECK(pollRequest(h,boss,"create",draft()));
    CHECK(loginAs(h,late,"late","password7"));CHECK(h.stepUntil({&late},[&]{return late.pollVisible();}));const auto old=late.adminTools("poll")["id"];
    h.step(310,{&boss,&late});CHECK(!late.pollVisible());CHECK(!boss.adminTools("poll")["active"].asBool());
    Json vote=Json::object();vote["id"]=old;vote["choice"]=0;CHECK(pollRequest(h,late,"vote",vote));CHECK(!late.adminTools("poll")["voted"].asBool());
    CHECK(pollRequest(h,boss,"create",draft()));CHECK(h.stepUntil({&late},[&]{return late.pollVisible();}));CHECK(pollRequest(h,late,"vote",vote));CHECK(late.pollVisible());CHECK(!late.adminTools("poll")["voted"].asBool());
}
TEST(poll_overlay_creator_and_admin_results_render_locally) {
    Harness h("poll-render",[](const std::string& p){seedUser(p,"boss","password7",true);},dataDir(),0);CHECK(h.ready);if(!h.ready)return;NetClient boss;CHECK(loginAs(h,boss,"boss","password7"));CHECK(h.stepUntil({&boss},[&]{return boss.isSkinAdmin();}));CHECK(fontsReady());
    SpriteCache sprites;WorldRenderer renderer;Window window;ClientSettings settings;DragState drag;PollCreatorPanel creator;
    Canvas form=Canvas::createVirtual(760,600);MenuContext formCtx{form,window,boss,sprites,renderer,settings,drag};formCtx.bounds=PollCreatorPanel::bounds(760,600);creator.reset();CHECK(creator.render(formCtx));form.savePPM("/tmp/flowrix-poll-creator.ppm");
    CHECK(pollRequest(h,boss,"create",draft(60)));const auto bounds=pollOverlayBounds(boss,760,600);CHECK(bounds.w>0);CHECK(bounds.y<100);
    Canvas banner=Canvas::createVirtual(760,600);MenuContext ctx{banner,window,boss,sprites,renderer,settings,drag};ctx.bounds=bounds;renderPollOverlay(ctx);banner.savePPM("/tmp/flowrix-poll-banner.ppm");
    Canvas results=Canvas::createVirtual(420,500);MenuContext resultsCtx{results,window,boss,sprites,renderer,settings,drag};renderPollResults(resultsCtx,{0,0,420,500});results.savePPM("/tmp/flowrix-poll-results.ppm");
}
