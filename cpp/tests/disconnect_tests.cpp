#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/components.h"

#include <unistd.h>

#include <cstdint>
#include <string>
#include <vector>

using namespace flix;

// A flower leaves the world with its socket, however the socket goes.
//
// Reported as: two windows, one logs out, the other signs in as a different
// account and plays, and after that window was closed its flower was still in
// the game -- walking its last input, drawn by everyone near it, saved every
// thirty seconds, and counted as a player so the server never went idle. It
// stayed until that account signed in again or the server restarted.
//
// The windows and the account switch were only how a second screen came to be
// watching. What left the flower behind was the close landing while the
// server was mid-tick. A client that closes with snapshots it has not read
// makes the kernel send a reset rather than an orderly close; tick() polls
// first and ends in Listener::flush(), so a reset that arrived in between was
// met by that flush's send(), which failed -- and flush() closed the socket on
// the spot, with no handler to tell. The next poll() erased the closed
// connection without drop(), GameServer::onDisconnect never ran, and the
// session it would have erased kept the body. A flush that finds a dead socket
// now leaves the reporting to the next poll(), like every other end.
//
// The tests below do not wait for the timing: they close the client, let the
// reset arrive, and run the tick BEFORE the server's poll, which is exactly
// the order GameServer::step() is in when the reset lands after its poll has
// returned. Both failed, every run, before the fix.

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::GameServerPeer;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;
using flix::testsupport::seedUser;

constexpr const char* kPassword = "password7";

/// The flower an account steers, or NULL_ENTITY. By account rather than by
/// nameplate: a join that picks no name is called "Unnamed", whoever it is.
Entity bodyOf(Harness& h, const char* username) {
    const Account* account = h.server.database().findUser(username);
    if (account == nullptr) return NULL_ENTITY;
    const std::string id = account->id;
    Entity found = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> players{h.server.world()};
    players.each([&](Entity e, PlayerTag&, PlayerAccount& owner) {
        if (owner.userId == id) found = e;
    });
    return found;
}

std::uint32_t netIdOf(World& world, Entity e) {
    const NetId* id = world.tryGet<NetId>(e);
    return id ? id->value : 0;
}

/// Neither flower is here to die, and a mob that wanders by must not end a
/// test about disconnecting by killing one of them first.
void makeInvulnerable(World& world, Entity e) {
    world.get<Health>(e).invulnerableUntilMillis = 1e300;
}

/// Puts `watcher`'s body beside `subject`'s and waits for the watcher's own
/// view to hold the subject's flower, which is what makes "the watcher still
/// draws it" a question the test can ask afterwards.
bool standBeside(Harness& h, NetClient& watcher, Entity watcherBody, Entity subject,
                 std::vector<NetClient*> clients) {
    World& world = h.server.world();
    world.get<Transform>(watcherBody).position = world.get<Transform>(subject).position + Vec2{120, 0};
    const std::uint32_t id = netIdOf(world, subject);
    return h.stepUntil(clients, [&] { return watcher.view().entities().count(id) != 0; });
}

/// The window closes while the server is mid-tick.
///
/// `closing` has been left unread for a few ticks first, as a window that is
/// drawing frames is between its reads, so its socket holds snapshots the
/// process never takes -- which is what makes its close a reset. The reset is
/// given time to arrive, and then the server ticks before it polls: the tick
/// queues the dead socket a snapshot, and its closing flush is the first thing
/// to touch it.
///
/// Returns whether `username`'s session was gone after the server's very next
/// poll. That is the transport's own report arriving, and it is asked for on
/// the spot because GameServer also audits, once a second, for sessions whose
/// socket the listener no longer holds: left to run, that audit would end the
/// session too, and a test that only looked later could not tell a socket
/// reported closed from one the transport lost and the audit found.
bool closeMidTick(Harness& h, NetClient& closing, const char* username,
                  std::vector<NetClient*> others) {
    h.step(6, others);
    closing.disconnect();
    ::usleep(20 * 1000);
    for (int i = 0; i < 3; ++i) {
        h.clock += net::kTickMillis;
        h.server.tick(h.clock);
    }
    h.server.serviceNetwork(0);
    const bool endedOnThePoll = GameServerPeer::sessionOf(h.server, username) == nullptr;
    // From here the server runs its ordinary loop.
    h.step(30, others);
    return endedOnThePoll;
}

} // namespace

TEST(a_flower_leaves_the_world_when_its_socket_closes_mid_tick) {
    Harness h("disconnect-mid-tick",
              [](const std::string& path) {
                  seedUser(path, "alice", kPassword);
                  seedUser(path, "watcher", kPassword);
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    NetClient alice, watcher;
    CHECK(loginAs(h, alice, "alice", kPassword));
    CHECK(loginAs(h, watcher, "watcher", kPassword));
    alice.joinGame(1280, 720);
    watcher.joinGame(1280, 720);
    CHECK(h.stepUntil({&alice, &watcher},
                      [&] { return alice.selfPlaced() && watcher.selfPlaced(); }));
    const Entity aliceBody = bodyOf(h, "alice");
    const Entity watcherBody = bodyOf(h, "watcher");
    CHECK(aliceBody != NULL_ENTITY && watcherBody != NULL_ENTITY);
    if (aliceBody == NULL_ENTITY || watcherBody == NULL_ENTITY) return;
    makeInvulnerable(world, aliceBody);
    makeInvulnerable(world, watcherBody);
    const std::uint32_t aliceNetId = netIdOf(world, aliceBody);
    CHECK(standBeside(h, watcher, watcherBody, aliceBody, {&alice, &watcher}));
    CHECK_EQ(h.server.playerCount(), std::size_t(2));

    CHECK(closeMidTick(h, alice, "alice", {&watcher}));

    // The session went with the socket, and the body with the session.
    CHECK(GameServerPeer::sessionOf(h.server, "alice") == nullptr);
    CHECK(bodyOf(h, "alice") == NULL_ENTITY);
    CHECK_EQ(h.server.playerCount(), std::size_t(1));
    // And the one watching was told: a flower nobody owns would still be drawn.
    CHECK_EQ(watcher.view().entities().count(aliceNetId), std::size_t(0));
}

TEST(two_windows_one_logs_out_the_other_plays_another_account_and_its_flower_leaves_with_it) {
    // The report's own sequence, as the native client produces it: two windows
    // of one install share a session-token file, so both start on the same
    // account's token.
    Harness h("disconnect-two-windows",
              [](const std::string& path) {
                  seedUser(path, "xavier", kPassword);
                  seedUser(path, "yvonne", kPassword);
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    World& world = h.server.world();

    // Window A signs in as X; the file now holds X's token.
    NetClient windowA;
    CHECK(loginAs(h, windowA, "xavier", kPassword));
    const std::string tokenX = windowA.sessionToken();
    CHECK(!tokenX.empty());

    // Window B starts from the same file and resumes it. The newer sign-in
    // wins: A is told it was replaced, and keeps the token for "Play on this
    // tab".
    NetClient windowB;
    CHECK(connectClient(h, windowB));
    windowB.resumeSession(tokenX);
    CHECK(h.stepUntil({&windowA, &windowB}, [&] {
        return windowB.status() == NetClient::Status::LoggedIn && windowA.sessionReplaced;
    }));
    windowA.sessionReplaced = false;

    // "Logged out on one tab": every token X had is revoked.
    windowB.logout();
    h.step(10, {&windowB});
    CHECK(windowB.status() == NetClient::Status::Ready);

    // "Logged into a different account on the other tab": A's only way back
    // is "Play on this tab", a fresh socket presenting the token it kept --
    // refused now -- and then the login form.
    windowA.redial();
    CHECK(h.stepUntil({&windowA, &windowB}, [&] { return windowA.reconnected; }));
    windowA.reconnected = false;
    windowA.authAnswered = false;
    windowA.resumeSession(windowA.sessionToken());
    CHECK(h.stepUntil({&windowA, &windowB}, [&] { return windowA.authAnswered; }));
    CHECK_EQ(static_cast<int>(windowA.authStatus),
             static_cast<int>(net::AuthStatus::SessionExpired));
    windowA.requestLogin("yvonne", kPassword);
    CHECK(h.stepUntil({&windowA, &windowB},
                      [&] { return windowA.status() == NetClient::Status::LoggedIn; }));

    // "Entered the game with the other account."
    windowA.joinGame(1280, 720);
    CHECK(h.stepUntil({&windowA, &windowB}, [&] { return windowA.selfPlaced(); }));

    // The other window back in the world, beside it, to see whether it stays.
    windowB.requestLogin("xavier", kPassword);
    CHECK(h.stepUntil({&windowA, &windowB},
                      [&] { return windowB.status() == NetClient::Status::LoggedIn; }));
    windowB.joinGame(1280, 720);
    CHECK(h.stepUntil({&windowA, &windowB}, [&] { return windowB.selfPlaced(); }));
    const Entity yvonneBody = bodyOf(h, "yvonne");
    const Entity xavierBody = bodyOf(h, "xavier");
    CHECK(yvonneBody != NULL_ENTITY && xavierBody != NULL_ENTITY);
    if (yvonneBody == NULL_ENTITY || xavierBody == NULL_ENTITY) return;
    makeInvulnerable(world, yvonneBody);
    makeInvulnerable(world, xavierBody);
    const std::uint32_t yvonneNetId = netIdOf(world, yvonneBody);
    CHECK(standBeside(h, windowB, xavierBody, yvonneBody, {&windowA, &windowB}));

    // "After I closed the game with the other account": Y's window closes.
    CHECK(closeMidTick(h, windowA, "yvonne", {&windowB}));

    CHECK(GameServerPeer::sessionOf(h.server, "yvonne") == nullptr);
    CHECK(bodyOf(h, "yvonne") == NULL_ENTITY);
    CHECK_EQ(h.server.playerCount(), std::size_t(1));
    CHECK_EQ(windowB.view().entities().count(yvonneNetId), std::size_t(0));
    // The window that stayed is untouched by any of it.
    CHECK(windowB.status() == NetClient::Status::Playing);
    CHECK(bodyOf(h, "xavier") != NULL_ENTITY);
}
