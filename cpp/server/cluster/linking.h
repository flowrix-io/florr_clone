#pragma once
// A server on its own, being linked to another: GameServer::Door, where it is
// dialled (its own game port, by a server's WebSocket at /link), and
// GameServer::Probe, where it dials. The methods are GameServer's
// (server/cluster/linking.cpp).

#include <map>
#include <string>

#include "server/cluster/link.h"
#include "server/cluster/membership.h"
#include "server/game_server.h"
#include "shared/net/transport.h"

namespace flix {

/// The servers dialling this one's game port to join it: sockets of the game's
/// own listener opened as a WebSocket at /link. They have no session.
struct GameServer::Door {
    explicit Door(GameServer& server) : owner(server) {}
    static constexpr std::size_t kMaxDiallers = 32;

    struct Dialler {
        cluster::Greeting greeting;
        std::string digest;
        std::string nonce;
        bool greeted = false;
        double sinceMillis = 0;
    };

    GameServer& owner;
    std::map<net::ConnectionId, Dialler> diallers;
    /// Somebody is joining: when to become a gateway, a moment after they were
    /// told they may, or -1.
    double openingAtMillis = -1;
};

struct GameServer::Probe : net::TransportHandler {
    explicit Probe(GameServer& server) : owner(server) {
        // A WebSocket at /link on the other server's game port, plainly
        // whatever certificate it has.
        dialer.serverLink = true;
    }
    void onConnect(net::Connection&) override { owner.probeOpened(); }
    void onMessage(net::Connection&, ByteReader& reader) override { owner.probeMessage(reader); }
    void onDisconnect(net::Connection&, const std::string& reason) override {
        // The refusal that came first is the reason, and this only its end.
        if (verdict.empty()) verdict = reason.empty() ? "the connection was lost" : reason;
    }

    GameServer& owner;
    net::Dialer dialer;
    cluster::Greeting greeting;
    cluster::LinkCipher cipher;
    cluster::Membership wanted;
    /// Whoever asked, if still there to be told.
    net::ConnectionId admin = 0;
    double untilMillis = 0;
    bool ready = false;
    std::string verdict;
};

} // namespace flix
