#pragma once
// One simulation server's own state: GameServer::Shard.
//
// A GameServer with no database. The gateway signs its players in and sends
// their sockets to this server's own port (Door) with a ticket; here each is a
// session adopted by the gateway's connection id, whose frames go straight to
// that socket. What they ask that is the gateway's to answer goes over the
// link as a request. Their account rows are on loan: written to the lease
// journal before anything that shows a change leaves, and back over the link
// behind it. Everything else about it -- the tick, the systems, the handlers
// -- is the single server's, run over the biomes it was given. The methods
// are GameServer's (server/cluster/shard.cpp).

#include <string>
#include <unordered_map>
#include <vector>

#include "server/cluster/lease_journal.h"
#include "server/cluster/link.h"
#include "server/game_server.h"
#include "shared/net/transport.h"

namespace flix {

struct GameServer::Shard : net::TransportHandler {
    explicit Shard(GameServer& server) : owner(server) {}

    void onConnect(net::Connection& c) override { owner.shLinkOpened(c); }
    void onMessage(net::Connection&, ByteReader& reader) override { owner.shLinkMessage(reader); }
    void onDisconnect(net::Connection&, const std::string& reason) override {
        owner.shLinkLost(reason);
    }

    struct Hosted {
        std::string biome;
        std::vector<Realm> realms;
    };

    /// This server's own port: the clients the gateway sent here.
    struct Door : net::TransportHandler {
        explicit Door(GameServer& server) : owner(server) {}
        void onConnect(net::Connection& c) override { owner.shDoorOpened(c); }
        void onMessage(net::Connection& c, ByteReader& reader) override { owner.shDoorFrame(c, reader); }
        void onDisconnect(net::Connection& c, const std::string&) override { owner.shDoorClosed(c); }
        GameServer& owner;
        net::Listener listener;
        /// Each socket at it: whether it has said Hello, and the session it
        /// was let in as, or 0 until its ticket.
        struct Socket {
            bool greeted = false;
            net::ConnectionId client = 0;
        };
        std::unordered_map<net::ConnectionId, Socket> sockets;
    };
    /// A client the gateway is sending here, by the ticket it will show.
    struct Ticket {
        net::ConnectionId client = 0;
        double expiresMillis = 0;
    };

    GameServer& owner;
    net::Dialer dialer;
    std::unique_ptr<Door> door;
    std::unordered_map<std::string, Ticket> expected;
    /// Where clients sign in: the gateway's proxied hostname (empty for none;
    /// port 0, the client's own), and its own address for a client that
    /// dialled straight (an empty host: the one the client dialled here).
    std::string gatewayPublicHost;
    std::uint16_t gatewayPublicPort = 0;
    std::string gatewayDirectHost;
    std::uint16_t gatewayDirectPort = 0;
    cluster::LeaseJournal journal;
    cluster::Greeting greeting;
    cluster::LinkCipher cipher;
    /// The gateway has proven itself and answered Welcome.
    bool welcomed = false;
    int slot = 0;
    double nextDialMillis = 0;
    double dialDelayMillis = 250;
    double lastHeardMillis = 0;
    double nextHeartbeatMillis = 0;
    double nextStatsMillis = 0;
    double tickMillis = 0;
    std::vector<Hosted> hosted;
    /// The realms SOME server simulates: a pad into any other is shut.
    std::array<bool, kMaxRealms> reachable{};
    /// userId -> the client whose body its row was lent for.
    std::unordered_map<std::string, net::ConnectionId> leased;
    /// Refused by the gateway: an operator's mistake, not a passing fault.
    bool refused = false;
    double drainUntilMillis = -1;

    /// This server's copy of the database (server/cluster/copy.cpp): null
    /// until one is sent, and nothing of it on disk until it is whole.
    std::unique_ptr<Database> copy;
    bool copyWhole = false;
    bool copyFiled = false;
    std::string copyLineage;
    std::uint64_t copyTaken = 0;
    std::uint64_t copyAcked = 0;
    double nextCopySaveMillis = 0;
};

} // namespace flix
