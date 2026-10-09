#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/components.h"
#include "shared/net/transport.h"

#include <cstdint>
#include <limits>
#include <string>
#include <vector>

using namespace flix;

// A sign-in that arrives on a socket whose flower is still in the world.
//
// The shipping client only ever signs in from the login form or on a fresh
// socket, but nothing on the wire stops a client sending Login, Register or
// ResumeSession mid-game, and the server used to take one as given: the stage
// dropped back to signed-in and the body stayed where it stood -- unsaved,
// steered by nobody, crediting its pickups to whichever account the socket now
// held, and left behind for good by the next join. A sign-in takes the flower
// out of the world first, exactly as leaving to the title screen does.

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::GameServerPeer;
using flix::testsupport::Harness;
using flix::testsupport::sawText;
using flix::testsupport::sawTextSince;

constexpr const char* kPassword = "password7";

/// Accounts made straight in the file, at a cheap bcrypt cost: the default one
/// makes every login in this file a quarter of a second. Those named in
/// `admins` carry the database's admin flag -- the only thing that makes a
/// full admin.
void seedReauthAccounts(const std::string& path, const std::vector<std::string>& names,
                        const std::vector<std::string>& admins = {}) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    for (const std::string& name : names) {
        CreateResult created = db.createUser(name, kPassword);
        if (!created.ok()) continue;
        for (const std::string& admin : admins) {
            if (admin == name) created.account->admin = true;
        }
    }
    db.markDirty();
    db.save();
}

/// The handshake again, on a socket that has already made it.
/// NetClient::onConnect is the one place the shipping client sends a Hello --
/// the transport calls it once per dial -- so calling it on a live socket puts
/// on the wire exactly the second Hello a modified client would send. Its
/// argument is not read.
void sendSecondHello(NetClient& client) {
    net::Connection unused(-1, 0, std::string());
    client.onConnect(unused);
}

/// One input frame, with a sequence the server has not seen from this client.
void reauthSteer(NetClient& client, std::uint32_t sequence, double strength, double angle) {
    net::InputFrame frame;
    frame.sequence = sequence;
    frame.moveStrength = strength;
    frame.moveAngle = angle;
    client.sendInput(frame);
}

/// Sends `text` and steps every client until the sender's transcript moves.
bool reauthSay(Harness& h, NetClient& client, const std::string& text,
               const std::vector<NetClient*>& clients) {
    const std::uint64_t before = client.chatSequence();
    client.sendChat(text);
    return h.stepUntil(clients, [&] { return client.chatSequence() > before; }, 120);
}

bool reauthSignIn(Harness& h, NetClient& client, const char* name) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, kPassword);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

bool reauthJoin(Harness& h, NetClient& client) {
    client.joinGame(1280, 720);
    return h.stepUntil({&client}, [&] {
        return client.status() == NetClient::Status::Playing && client.view().self().netId != 0;
    });
}

/// Every flower in the world, whoever owns it. The harness runs no bots, so
/// on these tests this is the players' bodies and nothing else -- which is
/// exactly what a leaked body would show up in.
std::vector<Entity> flowersInWorld(World& world) {
    std::vector<Entity> found;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount&) { found.push_back(e); });
    return found;
}

/// The flowers one account owns, by account id: a body's nameplate is
/// whatever its join typed.
std::vector<Entity> flowersOf(Harness& h, const char* name) {
    std::vector<Entity> found;
    const Account* account = h.server.database().findUser(name);
    if (account == nullptr) return found;
    const std::string id = account->id;
    Query<PlayerTag, PlayerAccount> bodies{h.server.world()};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& owner) {
        if (owner.userId == id) found.push_back(e);
    });
    return found;
}

/// The account's saved XP, or -1 when it has no progress record at all.
double reauthSavedXp(Harness& h, const char* name) {
    const Account* account = h.server.database().findUser(name);
    if (account == nullptr) return -1.0;
    const PlayerRecord* record = h.server.database().findProgress(account->id);
    return record != nullptr ? record->totalXp : -1.0;
}

/// More XP than anything in a few ticks of play could earn, so a saved figure
/// at or above it can only have come from the body it was put on.
constexpr double kEarnedXp = 1.0e6;

/// Puts kEarnedXp on the one flower in the world: progress the body has and the
/// account record does not yet, until something saves it.
bool reauthEarnXp(World& world) {
    const std::vector<Entity> found = flowersInWorld(world);
    if (found.size() != 1) return false;
    PlayerProgress* progress = world.tryGet<PlayerProgress>(found.front());
    if (progress == nullptr) return false;
    progress->totalXp = kEarnedXp;
    return true;
}

/// `boss` and `visitor`, signed in as the seeded accounts of those names and
/// in the world, with boss steering visitor's flower at full stride. Returns
/// visitor's body, or NULL_ENTITY once a check here has already failed.
Entity reauthSteerVisitor(Harness& h, NetClient& boss, NetClient& visitor) {
    World& world = h.server.world();
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(reauthSignIn(h, boss, "boss"));
    CHECK(reauthSignIn(h, visitor, "visitor"));
    boss.joinGame(1280, 720);
    visitor.joinGame(1280, 720);
    CHECK(h.stepUntil(all, [&] {
        return boss.selfPlaced() && visitor.selfPlaced() && boss.isSkinAdmin();
    }));
    const std::vector<Entity> steered = flowersOf(h, "visitor");
    CHECK_EQ(steered.size(), std::size_t(1));
    if (steered.size() != 1) return NULL_ENTITY;
    // Nothing here is about dying, and a mob that wanders up must not decide
    // that the control ended some other way.
    for (const Entity body : flowersInWorld(world)) {
        world.get<Health>(body).invulnerableUntilMillis = std::numeric_limits<double>::infinity();
    }

    CHECK(reauthSay(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.controllingFlower(); }));
    reauthSteer(boss, 100, 1.0, 0.5);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(steered.front()).current.moveStrength, 1.0, 0.01);
    return steered.front();
}

/// Puts the session signed in as `name` into the state the guards at the end
/// of this file are for: its body standing in the world, under a stage that
/// has stopped saying Playing. What a repeated Hello used to leave, put there
/// by hand, because nothing on the wire leads to it now. True once the session
/// is in it.
bool reauthForgetStage(Harness& h, const char* name, SessionStage stage) {
    Session* session = GameServerPeer::sessionOf(h.server, name);
    if (session == nullptr || !session->playing()) return false;
    session->stage = stage;
    return !session->playing() && h.server.world().isAlive(session->entity);
}

} // namespace

TEST(a_login_from_inside_the_world_takes_the_flower_out_first) {
    Harness h("reauth-same", [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(1));
    CHECK(reauthEarnXp(world));
    CHECK(reauthSavedXp(h, "alice") < kEarnedXp);

    // The same account again, on the same socket, mid-game.
    client.authAnswered = false;
    client.requestLogin("alice", kPassword);
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    h.step(3, {&client});

    // Out of the world -- not standing in it for nobody -- with what it had
    // earned saved, as leaving would have saved it.
    CHECK_EQ(h.server.playerCount(), std::size_t(0));
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    CHECK(reauthSavedXp(h, "alice") >= kEarnedXp);

    // And the next join is the only flower there is.
    CHECK(reauthJoin(h, client));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(1));
}

TEST(a_login_as_another_account_from_inside_the_world_saves_the_flower_to_its_own) {
    Harness h("reauth-other",
              [](const std::string& path) { seedReauthAccounts(path, {"alice", "bob"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthEarnXp(world));

    client.authAnswered = false;
    client.requestLogin("bob", kPassword);
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(client.profile().username, std::string("bob"));
    h.step(3, {&client});

    // Alice's flower went with alice's progress, into alice's account. None of
    // it is bob's: the body was never his, and nothing it did was.
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    CHECK(reauthSavedXp(h, "alice") >= kEarnedXp);
    CHECK(reauthSavedXp(h, "bob") < kEarnedXp);

    // Bob's join puts down bob's flower, and only that one.
    CHECK(reauthJoin(h, client));
    h.step(3, {&client});
    const std::vector<Entity> after = flowersInWorld(world);
    CHECK_EQ(after.size(), std::size_t(1));
    const Account* bob = h.server.database().findUser("bob");
    CHECK(bob != nullptr);
    if (bob != nullptr && after.size() == 1) {
        CHECK_EQ(world.get<PlayerAccount>(after.front()).userId, bob->id);
    }
}

TEST(a_resume_or_a_registration_from_inside_the_world_takes_the_flower_out_too) {
    // The other two ways in go through the same door as a login.
    Harness h("reauth-resume", [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthEarnXp(world));

    client.authAnswered = false;
    client.resumeSession(client.sessionToken());
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    CHECK(reauthSavedXp(h, "alice") >= kEarnedXp);

    CHECK(reauthJoin(h, client));
    client.authAnswered = false;
    client.requestRegister("carol", kPassword);
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(client.profile().username, std::string("carol"));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));

    CHECK(reauthJoin(h, client));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(1));
}

// ---------------------------------------------------------------------------
// The handshake, again
// ---------------------------------------------------------------------------
//
// Hello is the fourth way a socket can re-introduce itself, and the one the
// leaveWorld fix above missed: it put the stage back to Anonymous under a
// standing body, and everything that looks after a body asks playing() -- the
// saves, the disconnect, the next sign-in, the next join. So the flower stood
// in the world for nobody, unsaved, and a Join on the same socket put down
// another beside it. The handshake is once per socket; a second one is a
// closed socket, and the close is an ordinary one.

TEST(a_second_hello_from_inside_the_world_closes_the_socket_and_saves_the_flower) {
    Harness h("reauth-hello", [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthEarnXp(world));
    CHECK(reauthSavedXp(h, "alice") < kEarnedXp);
    const std::string token = client.sessionToken();

    sendSecondHello(client);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Failed; }));
    h.step(3, {&client});
    // Gone with the socket, as any disconnect takes it -- and saved on the way.
    CHECK_EQ(h.server.playerCount(), std::size_t(0));
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    CHECK(reauthSavedXp(h, "alice") >= kEarnedXp);

    // A fresh socket resumes the account and joins: one flower, the only one
    // there is, and none once that socket goes too.
    client.disconnect();
    CHECK(connectClient(h, client));
    client.authAnswered = false;
    client.resumeSession(token);
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK(reauthJoin(h, client));
    h.step(3, {&client});
    CHECK_EQ(flowersOf(h, "alice").size(), std::size_t(1));
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(1));
    client.disconnect();
    h.step(5, {});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
}

TEST(a_hello_sent_with_a_burst_of_resumes_and_joins_strands_no_flower) {
    // The farming loop the repeated Hello allowed, in one write, as a script
    // would send it: every (Hello, Resume, Join) used to leave the last flower
    // standing and put down a new one. Whatever of the burst is read before
    // the close lands goes through the ordinary doors -- a resume from inside
    // the world takes the flower out first -- and the close takes the last.
    Harness h("reauth-hello-burst",
              [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthEarnXp(world));
    const std::string token = client.sessionToken();

    for (int i = 0; i < 25; ++i) {
        sendSecondHello(client);
        client.resumeSession(token);
        client.joinGame(1280, 720);
    }
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Failed; }));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    CHECK_EQ(h.server.playerCount(), std::size_t(0));
    CHECK(reauthSavedXp(h, "alice") >= kEarnedXp);
}

TEST(a_steered_flower_whose_player_sends_a_second_hello_stops_and_goes) {
    // Control ends when the steered player's socket closes, and the flower it
    // ends on is parked before it is taken out: a body left with the admin's
    // last heading on it walks that heading for as long as it stands.
    Harness h("reauth-hello-steered",
              [](const std::string& path) {
                  seedReauthAccounts(path, {"boss", "visitor"}, {"boss"});
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient boss, visitor;
    const Entity visitorBody = reauthSteerVisitor(h, boss, visitor);
    if (visitorBody == NULL_ENTITY) return;

    // The visitor's client says hello again. The server's network is serviced
    // with no tick in between, so the body is caught after the control has
    // ended and before the reap that removes it.
    sendSecondHello(visitor);
    visitor.poll(1);
    // Closed means the session is gone, which only the disconnect does. Not
    // playerCount() falling to one: the old Hello took the stage out from
    // under the body without closing anything, and that reads one as well.
    bool closed = false;
    for (int i = 0; i < 200 && !closed; ++i) {
        h.server.serviceNetwork(1);
        closed = GameServerPeer::sessionOf(h.server, "visitor") == nullptr;
    }
    CHECK(closed);
    if (world.isAlive(visitorBody)) {
        CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 0.0, 0.01);
    }

    CHECK(h.stepUntil({&boss}, [&] { return !boss.controllingFlower(); }));
    h.step(3, {&boss});
    CHECK(!world.isAlive(visitorBody));
    CHECK_EQ(flowersOf(h, "visitor").size(), std::size_t(0));
    CHECK(sawText(boss, "Control ended: visitor left the world."));
}

// ---------------------------------------------------------------------------
// Whose the socket is now
// ---------------------------------------------------------------------------

TEST(a_full_admins_socket_signing_in_as_somebody_else_keeps_no_console) {
    // The database flag is the account's, not the socket's: every sign-in
    // ASSIGNS the session's copy from the account coming in -- a login, a
    // registration and a resume alike -- so a full admin who signs in as
    // somebody else on the same socket is that somebody, console and all. A
    // flag that rode along (`session.admin || account->admin`, or left alone
    // by a resume) would hand the console, and the "[ADMIN] <name> executed"
    // signature, to an account the database never made an admin.
    Harness h("reauth-admin",
              [](const std::string& path) {
                  seedReauthAccounts(path, {"boss", "plain"}, {"boss"});
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    // What one console line comes back as, read only from what landed after
    // it was sent: an earlier answer is still in the transcript, and a check
    // against the whole of it would pass on that one.
    const auto console = [&](NetClient& client, const char* expect, const char* never) {
        const std::uint64_t mark = client.chatSequence();
        const bool answered = reauthSay(h, client, "/admin list_admins", {&client});
        h.step(2, {&client});
        return answered && sawTextSince(client, mark, expect) && !sawTextSince(client, mark, never);
    };
    const auto signedInAs = [&](NetClient& client, const char* name) {
        CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
        CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
        CHECK_EQ(client.profile().username, std::string(name));
        CHECK(h.stepUntil({&client}, [&] { return !client.isSkinAdmin(); }));
        CHECK(console(client, "Command does not exist.", "executed"));
    };

    // A login.
    NetClient byLogin;
    CHECK(reauthSignIn(h, byLogin, "boss"));
    CHECK(h.stepUntil({&byLogin}, [&] { return byLogin.isSkinAdmin(); }));
    CHECK(console(byLogin, "executed: list_admins", "Command does not exist."));
    byLogin.authAnswered = false;
    byLogin.requestLogin("plain", kPassword);
    signedInAs(byLogin, "plain");

    // A registration, which makes an account nobody could have flagged yet.
    NetClient byRegister;
    CHECK(reauthSignIn(h, byRegister, "boss"));
    CHECK(h.stepUntil({&byRegister}, [&] { return byRegister.isSkinAdmin(); }));
    byRegister.authAnswered = false;
    byRegister.requestRegister("fresh", kPassword);
    signedInAs(byRegister, "fresh");

    // A resume of another account's token -- the plain one the first socket
    // holds, which this signs that socket out of.
    const std::string plainToken = byLogin.sessionToken();
    CHECK(!plainToken.empty());
    NetClient byResume;
    CHECK(reauthSignIn(h, byResume, "boss"));
    CHECK(h.stepUntil({&byResume}, [&] { return byResume.isSkinAdmin(); }));
    byResume.authAnswered = false;
    byResume.resumeSession(plainToken);
    signedInAs(byResume, "plain");
}

TEST(a_new_account_on_the_socket_inherits_no_squad_and_no_invitation) {
    // A squad, and an invitation to one, are keyed by the CONNECTION, and a
    // socket can change account under both: Log Out keeps the socket, and a
    // sign-in is accepted on a socket that already holds one. Whoever signed
    // in next used to find themselves in the last account's party -- its
    // roster, its /s chat, its loot ranking, its leadership -- and could take
    // up an invitation that was sent to somebody else.
    Harness h("reauth-squad",
              [](const std::string& path) {
                  seedReauthAccounts(path, {"lead", "mate", "host", "other", "third", "fourth"});
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient lead, mate, host;
    const std::vector<NetClient*> all{&lead, &mate, &host};
    CHECK(reauthSignIn(h, lead, "lead"));
    CHECK(reauthSignIn(h, mate, "mate"));
    CHECK(reauthSignIn(h, host, "host"));
    const auto signIn = [&](const char* name) {
        lead.authAnswered = false;
        lead.requestLogin(name, kPassword);
        CHECK(h.stepUntil(all, [&] { return lead.authAnswered; }));
        CHECK_EQ(static_cast<int>(lead.authStatus), static_cast<int>(net::AuthStatus::Ok));
        h.step(3, all);
    };

    // A squad of two, led from the socket that is about to change hands.
    CHECK(reauthSay(h, lead, "/squad-create", all));
    CHECK(reauthSay(h, lead, "/squad-invite mate", all));
    h.step(3, all);
    CHECK(reauthSay(h, mate, "/squad-accept", all));
    h.step(3, all);
    CHECK_EQ(mate.squad().members.size(), std::size_t(2));

    // A sign-in as somebody else, with no Log Out first: lead leaves, named as
    // lead, and the account now on the socket is in no squad.
    signIn("other");
    CHECK(sawText(mate, "lead has left the squad."));
    CHECK_EQ(mate.squad().members.size(), std::size_t(1));
    CHECK(!lead.squad().inSquad);
    std::uint64_t mark = lead.chatSequence();
    CHECK(reauthSay(h, lead, "/squad-info", all));
    CHECK(sawTextSince(lead, mark, "You are not in a squad."));

    // An invitation waiting on the socket goes with the account it was for,
    // by the same road...
    CHECK(reauthSay(h, host, "/squad-create", all));
    CHECK(reauthSay(h, host, "/squad-invite other", all));
    h.step(3, all);
    CHECK(sawText(lead, "@host has invited you to their squad."));
    signIn("third");
    mark = lead.chatSequence();
    CHECK(reauthSay(h, lead, "/squad-accept", all));
    CHECK(sawTextSince(lead, mark, "No pending invite."));

    // ...and by Log Out, which keeps the socket for the next account.
    CHECK(reauthSay(h, host, "/squad-invite third", all));
    h.step(3, all);
    lead.logout();
    h.step(3, all);
    signIn("fourth");
    mark = lead.chatSequence();
    CHECK(reauthSay(h, lead, "/squad-accept", all));
    CHECK(sawTextSince(lead, mark, "No pending invite."));
    h.step(3, all);
    CHECK_EQ(host.squad().members.size(), std::size_t(1));
    CHECK(!lead.squad().inSquad);

    // A Log Out leaves the squad there and then, as a disconnect does -- not
    // at whatever sign-in comes next, which would take the socket out by the
    // other road and hide the difference. So the roster is read before any
    // sign-in. An anonymous socket is nobody's squadmate, and one that never
    // signed in again would have stayed on the roster, the party bar and the
    // /s audience for as long as it was open.
    CHECK(reauthSay(h, host, "/squad-invite fourth", all));
    h.step(3, all);
    CHECK(reauthSay(h, lead, "/squad-accept", all));
    h.step(3, all);
    CHECK_EQ(host.squad().members.size(), std::size_t(2));
    lead.logout();
    h.step(3, all);
    CHECK(sawText(host, "fourth has left the squad."));
    CHECK_EQ(host.squad().members.size(), std::size_t(1));
}

// ---------------------------------------------------------------------------
// A body the stage forgot
// ---------------------------------------------------------------------------
//
// The second line of defence. The repeated Hello was the last way a session's
// stage could stop saying Playing while its body still stood, and with that
// closed, nothing on the wire leads there. But every door a body leaves by
// used to ask the STAGE whether there was a body to take out -- the
// disconnect, a Log Out, a sign-in from inside the world -- and so did the
// park at the end of a control, while a join put a new body down over
// whatever the session still held. Whatever next dropped a stage under a body
// would have brought the stranded flowers straight back. Each now asks about
// the BODY -- whether one is held, whether it is still there -- and since no
// message can put a session in that state any more, these tests put it there
// by hand (GameServerPeer) and watch each door deal with the body anyway. A body the stage stopped vouching for goes
// unsaved -- spawnPlayer says why -- so these check only that it goes. The
// join's other case, a split still held with no active half, is in
// splitter_tests.cpp with the splitter's own tests.

TEST(a_disconnect_takes_out_a_flower_the_stage_forgot) {
    // The disconnect erases the session, so a body it does not take out on
    // the way is a body nothing will ever name again: standing in the world,
    // streamed to everyone near it, until something kills it. A repeated
    // Hello and then a close left exactly that -- the stage said Anonymous,
    // and the disconnect asked the stage.
    Harness h("reauth-forgot-disconnect",
              [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthForgetStage(h, "alice", SessionStage::Anonymous));

    client.disconnect();
    CHECK(h.stepUntil({}, [&] { return GameServerPeer::sessionOf(h.server, "alice") == nullptr; }));
    h.step(3, {});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
}

TEST(a_log_out_takes_out_a_flower_the_stage_forgot) {
    // A Log Out keeps the socket and wipes the account off its session, so a
    // body it left standing would belong to an anonymous socket: no record to
    // save into, no input to steer it, and on no list anybody walks again.
    // The client sends LeaveGame first, as it does from inside the world, but
    // the leave asks whether the session is playing, so here it is the Log
    // Out's own sign-out that has to take the body.
    Harness h("reauth-forgot-logout",
              [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthForgetStage(h, "alice", SessionStage::Authenticated));

    client.logout();
    CHECK(h.stepUntil({&client},
                      [&] { return GameServerPeer::sessionOf(h.server, "alice") == nullptr; }));
    h.step(3, {&client});
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
}

TEST(a_sign_in_takes_out_a_flower_the_stage_forgot) {
    // A sign-in from inside the world takes the body out before the incoming
    // account goes onto the session (leaveWorld). Asked of the stage, that let
    // a body the stage had forgotten ride through the change of account: still
    // the session's entity, and so banking whatever it picked up into whoever
    // had just signed in.
    Harness h("reauth-forgot-signin",
              [](const std::string& path) { seedReauthAccounts(path, {"alice", "bob"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    CHECK(reauthForgetStage(h, "alice", SessionStage::Anonymous));

    client.authAnswered = false;
    client.requestLogin("bob", kPassword);
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    h.step(3, {&client});
    // Gone before bob's account went in, and not bob's to hold.
    CHECK_EQ(flowersInWorld(world).size(), std::size_t(0));
    const Session* bob = GameServerPeer::sessionOf(h.server, "bob");
    CHECK(bob != nullptr);
    if (bob != nullptr) CHECK(bob->entity == NULL_ENTITY);
}

TEST(a_join_over_a_flower_the_stage_forgot_takes_it_out_first) {
    // handleJoin turns away a session that is playing, and one whose stage
    // has stopped saying so is let through with its body still held -- to a
    // spawnPlayer that used to overwrite session.entity with the new body and
    // leave the old one standing for nobody, for good: the repeated Hello's
    // farm, one more flower per join.
    Harness h("reauth-forgot-join",
              [](const std::string& path) { seedReauthAccounts(path, {"alice"}); },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient client;
    CHECK(reauthSignIn(h, client, "alice"));
    CHECK(reauthJoin(h, client));
    const std::vector<Entity> first = flowersOf(h, "alice");
    CHECK_EQ(first.size(), std::size_t(1));
    if (first.size() != 1) return;
    CHECK(reauthForgetStage(h, "alice", SessionStage::Authenticated));

    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] {
        const Session* session = GameServerPeer::sessionOf(h.server, "alice");
        return session != nullptr && session->playing();
    }));
    h.step(3, {&client});
    // One flower, and it is the new one: the old body went before it came.
    const std::vector<Entity> now = flowersOf(h, "alice");
    CHECK_EQ(now.size(), std::size_t(1));
    CHECK(!world.isAlive(first.front()));
    const Session* session = GameServerPeer::sessionOf(h.server, "alice");
    CHECK(session != nullptr);
    if (session != nullptr && now.size() == 1) CHECK(session->entity == now.front());
}

TEST(a_control_that_lapses_over_a_flower_the_stage_forgot_parks_it) {
    // A control ends by itself once the steered session stops playing, and
    // the body it ends on is parked whenever that body is still THERE, not
    // only while its session says Playing. A session that stopped saying it
    // over a standing body is the very case in which nothing will ever steer
    // that body again, so a park that asked the stage left it walking the
    // admin's last heading for as long as it stood.
    Harness h("reauth-forgot-control",
              [](const std::string& path) {
                  seedReauthAccounts(path, {"boss", "visitor"}, {"boss"});
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    const Entity visitorBody = reauthSteerVisitor(h, boss, visitor);
    if (visitorBody == NULL_ENTITY) return;

    CHECK(reauthForgetStage(h, "visitor", SessionStage::Authenticated));
    CHECK(h.stepUntil(all, [&] { return !boss.controllingFlower(); }));
    CHECK(sawText(boss, "Control ended: visitor left the world."));
    CHECK(world.isAlive(visitorBody));
    if (world.isAlive(visitorBody)) {
        CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 0.0, 0.01);
    }
}
