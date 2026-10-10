#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/components.h"

#include <cstdint>
#include <string>
#include <vector>

using namespace flix;

// The server's second line of defence behind the transport's promise that
// every closed socket is reported (see disconnect_tests.cpp for the first).
//
// A session outliving its socket is the worst way a disconnect can go wrong:
// the flower stands in the world for nobody, walking its last input, streamed
// to everyone near it, saved every thirty seconds, and counted as a player so
// the server never goes idle -- and an admin can even take control of it,
// which is how the owner's report first proved it was a real session and not
// something a client was still drawing. Listener::flush once made exactly
// that, by closing a socket it could not tell the server about. That path is
// gone, but the cost of the next one is a permanent ghost, so once a second
// the server ends any session whose connection the listener no longer holds,
// and says so in its log.

namespace {

using flix::testsupport::GameServerPeer;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;
using flix::testsupport::seedUser;

constexpr const char* kPassword = "password7";

/// Never issued by a listener, whose ids count up from 1.
constexpr net::ConnectionId kOrphanId = 0x7FFF0000u;

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

} // namespace

TEST(a_session_whose_socket_the_listener_no_longer_holds_is_ended_within_a_second) {
    Harness h("session-audit",
              [](const std::string& path) {
                  seedUser(path, "alice", kPassword);
                  seedUser(path, "watcher", kPassword);
              },
              flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, watcher;
    CHECK(loginAs(h, alice, "alice", kPassword));
    CHECK(loginAs(h, watcher, "watcher", kPassword));
    alice.joinGame(1280, 720);
    watcher.joinGame(1280, 720);
    CHECK(h.stepUntil({&alice, &watcher},
                      [&] { return alice.selfPlaced() && watcher.selfPlaced(); }));
    const Entity aliceBody = bodyOf(h, "alice");
    CHECK(aliceBody != NULL_ENTITY);
    if (aliceBody == NULL_ENTITY) return;
    h.server.world().get<Health>(aliceBody).invulnerableUntilMillis = 1e300;
    CHECK_EQ(h.server.playerCount(), std::size_t(2));

    CHECK(GameServerPeer::detachFromSocket(h.server, "alice", kOrphanId));
    // The state the old flush left behind, exactly: Playing, a body, and no
    // socket anywhere.
    const Session* orphan = GameServerPeer::sessionOf(h.server, "alice");
    CHECK(orphan != nullptr && orphan->playing() && orphan->connection == kOrphanId);

    // A little over the audit's period, run by the ordinary loop. The detached
    // client is not stepped: its socket has no session now, and is not what
    // this is about.
    h.step(40, {&watcher});

    CHECK(GameServerPeer::sessionOf(h.server, "alice") == nullptr);
    CHECK(bodyOf(h, "alice") == NULL_ENTITY);
    CHECK_EQ(h.server.playerCount(), std::size_t(1));
    // The session that does have a socket is left exactly as it was.
    const Session* kept = GameServerPeer::sessionOf(h.server, "watcher");
    CHECK(kept != nullptr && kept->playing());
    CHECK(bodyOf(h, "watcher") != NULL_ENTITY);
    CHECK(watcher.status() == NetClient::Status::Playing);

    alice.disconnect();
    watcher.disconnect();
    h.step(3, {});
}
