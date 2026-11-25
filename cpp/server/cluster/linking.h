#pragma once
// A server on its own, being linked to another: GameServer::Door, where it is
// dialled, and GameServer::Probe, where it dials. The methods are GameServer's
// (server/cluster/linking.cpp).

#include <map>
#include <string>

#include "server/cluster/link.h"
#include "server/cluster/membership.h"
#include "server/game_server.h"
#include "shared/net/transport.h"

namespace flix {

struct GameServer::Door : net::TransportHandler {
    explicit Door(GameServer& server) : owner(server) {}
    void onConnect(net::Connection& c) override {
        if (diallers.size() >= 32) {
            c.closeGracefully();
            return;
        }
        diallers[c.id()].sinceMillis = monotonicMillis();
    }
    void onMessage(net::Connection& c, ByteReader& reader) override { owner.doorMessage(c, reader); }
    void onDisconnect(net::Connection& c, const std::string&) override { diallers.erase(c.id()); }

    struct Dialler {
        cluster::Greeting greeting;
        std::string digest;
        std::string nonce;
        bool greeted = false;
        double sinceMillis = 0;
    };

    GameServer& owner;
    net::Listener listener;
    std::map<net::ConnectionId, Dialler> diallers;
    std::string error;
    /// Somebody is joining: when to become a gateway, a moment after they were
    /// told they may, or -1.
    double openingAtMillis = -1;
};

struct GameServer::Probe : net::TransportHandler {
    explicit Probe(GameServer& server) : owner(server) {}
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
