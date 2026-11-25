#pragma once
// One simulation server's own state: GameServer::Shard.
//
// A GameServer with no port of its own and no database. Its players' sockets
// are the gateway's, adopted here by connection id; their account rows are on
// loan, and go back over the link changed ahead of anything that shows the
// change. Everything else about it -- the tick, the systems, the handlers --
// is the single server's, run over the biomes it was given. The methods are
// GameServer's (server/cluster/shard.cpp).

#include <string>
#include <unordered_map>
#include <vector>

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

    /// The clients that dial this server's own port. Their frames go to the
    /// gateway and its answers come back: a server that was public before it
    /// was linked still is.
    struct Edge : net::TransportHandler {
        explicit Edge(GameServer& server) : owner(server) {}
        void onConnect(net::Connection& c) override { owner.shEdgeOpened(c); }
        void onMessage(net::Connection& c, ByteReader& reader) override { owner.shEdgeFrame(c, reader); }
        void onDisconnect(net::Connection& c, const std::string&) override { owner.shEdgeClosed(c); }
        GameServer& owner;
        net::Listener listener;
        bool open = false;
    };

    GameServer& owner;
    net::Dialer dialer;
    std::unique_ptr<Edge> edge;
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
