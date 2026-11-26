#pragma once
// The gateway's own state: GameServer::Gateway.
//
// The gateway is a GameServer that simulates nothing. It owns the database and
// everything that is the whole game's rather than a biome's -- accounts,
// guilds, the market, global chat -- and it runs those with the same handlers
// a single server does. It holds a client's socket only while that client has
// no flower in the world: a flower's client is sent to the port of the server
// the flower is on (gwRedirect), which plays it directly and asks the gateway
// only what is the gateway's to answer. Its sessions are therefore adopted
// connections (net::Listener::adopt) whose frames go wherever the client is
// now -- this server's own port (`door`) or another server's (Deliver). What
// it does instead of simulating is here: which server has which biome, who is
// playing where, and whose account row is lent out. The methods are
// GameServer's (server/cluster/gateway.cpp).

#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "server/cluster/link.h"
#include "server/cluster/placement.h"
#include "server/game_server.h"
#include "shared/net/transport.h"

namespace flix {

struct GameServer::Gateway {
    explicit Gateway(GameServer& server) : owner(server) {}

    /// The game's own port: the sockets of the clients that are here, and the
    /// links of the servers, which dial the same port as a WebSocket at /link.
    struct Door : net::TransportHandler {
        explicit Door(GameServer& server) : owner(server) {}
        void onConnect(net::Connection& c) override { owner.gwDoorOpened(c); }
        void onMessage(net::Connection& c, ByteReader& reader) override { owner.gwDoorFrame(c, reader); }
        void onDisconnect(net::Connection& c, const std::string& reason) override {
            owner.gwDoorClosed(c, reason);
        }
        GameServer& owner;
    };

    /// Whether a server's domain reaches it, as the gateway last found.
    enum class Reach : std::uint8_t {
        None,        ///< it has no domain
        Checking,    ///< not yet known: being found out
        Answers,     ///< a WebSocket there, through the proxy, reached this very server
        Silent,      ///< nothing there answered as it
        Unchecked,   ///< this build cannot dial it (TLS, natively): believed
    };

    /// One look at a domain: a WebSocket to it at /reach, as a player's page
    /// would open one, and a nonce the server at the other end has to answer
    /// with the key over its own link's greeting (gwServiceReach).
    struct ReachCheck : net::TransportHandler {
        net::Dialer dialer;
        std::string nonce;
        std::string expected;
        double startedMillis = 0;
        /// 0 while waiting, 1 for the right answer, -1 for anything else.
        int outcome = 0;
        std::string why;
        void onConnect(net::Connection& c) override;
        void onMessage(net::Connection& c, ByteReader& reader) override;
        void onDisconnect(net::Connection& c, const std::string& reason) override;
    };

    /// One simulation server on the other end of a link.
    struct Server {
        net::ConnectionId link = 0;
        /// 1..kMaxServers once it has proven itself, 0 until then.
        int slot = 0;
        std::string name;
        std::string nonce;
        cluster::Greeting greeting;
        std::string greetingDigest;
        bool greeted = false;
        cluster::LinkCipher cipher;
        double openedAtMillis = 0;
        double lastHeardMillis = 0;
        /// Handing its biomes back on its way out: given no more.
        bool leaving = false;
        cluster::ServerStats stats;
        bool reported = false;
        /// Where clients that came through the proxy are sent to reach it, if
        /// no admin has given it a domain (`domains`): Greeting::publicHost,
        /// empty for nowhere, and port 0 for the one the client is on.
        std::string publicHost;
        std::uint16_t publicPort = 0;
        /// Where clients that dialled the gateway straight are sent: the host
        /// its link came from (empty: the client's own, for a server on this
        /// machine) and its own port.
        std::string directHost;
        std::uint16_t directPort = 0;
        /// Has been said to have no domain, once.
        bool warnedUnreachable = false;
        /// Whether its domain leads to it, and which domain that was found of
        /// (host[:port]); the next look, and the one under way.
        Reach reach = Reach::None;
        std::string reachWhy;
        std::string reachDomain;
        double nextReachMillis = 0;
        std::shared_ptr<ReachCheck> check;
        /// The session of the admin who set its domain, told how the look went.
        net::ConnectionId reachAskedBy = 0;
        /// What its lease journal is known by across restarts: its id, or its
        /// name for a server started by hand without one.
        std::string journalKey;

        /// The database as it is being copied to this server
        /// (server/cluster/copy.cpp): what of the first pass is still to send.
        bool copying = false;
        std::vector<std::pair<Database::Part, std::string>> copy;
        std::size_t copied = 0;
        std::uint64_t copySent = 0;
        std::uint64_t copyOnDisk = 0;
    };

    /// One biome: the realms that go together wherever they go.
    struct Biome {
        std::string name;
        std::vector<Realm> realms;
        /// The server simulating it, or 0.
        int slot = 0;
        /// While `slot` hands it over: the server it goes to next, or 0 for
        /// whichever the placement picks. Nobody is sent in meanwhile.
        bool handingOver = false;
        int next = 0;
        double cost = 0;
        int humans = 0;
        bool boss = false;
        /// What lay on its ground when the last server let it go.
        std::string drops;
        /// The server an admin assigned it to, by name; empty for wherever the
        /// balance puts it.
        std::string home;
    };

    /// One account row out on loan.
    struct Lease {
        std::uint32_t id = 0;
        int slot = 0;
        /// Whose it is for, or 0 once that client has gone.
        net::ConnectionId client = 0;
        /// The row as both sides last agreed it, the edits below included.
        std::string shadow;
        std::uint64_t version = 0;
        /// What this side changed and the server has not yet said it took.
        std::deque<std::pair<std::uint32_t, Json>> pending;
        std::uint32_t nextSeq = 1;
    };

    /// A hostname clients reach a server at through the proxy; port 0 for the
    /// one they are on (443).
    struct Domain {
        std::string host;
        std::uint16_t port = 0;
    };
    /// A client's socket that came to this port for the simulation in this
    /// process: handed over after the poll it arrived in (gwHandOver).
    struct HandOver {
        net::ConnectionId socket = 0;
        std::string ticket;
        std::vector<std::vector<std::byte>> after;
    };

    GameServer& owner;
    Door doorHandler{owner};
    net::Listener door;
    /// The simulation in this same process (ServerHost), or null.
    GameServer* simulation = nullptr;
    /// The tickets clients were sent to it with, and until when.
    std::unordered_map<std::string, double> toSimulation;
    std::vector<HandOver> handOvers;
    /// What an admin said each server is reached at through the proxy, by its
    /// name lowercased (`/admin shards domain`); the server's own word
    /// (--public-host) only where there is none. A server knows its address,
    /// never the name Cloudflare gives it.
    std::map<std::string, Domain> domains;
    /// The same for the gateway itself, where shards send a client that came
    /// to one of them to sign in.
    Domain address;
    /// A client has come to this port through the proxy since it started: the
    /// game is behind one, so a server with no domain is no use to anybody.
    bool sawProxy = false;
    /// Each client's socket at the door, and the session it is.
    std::unordered_map<net::ConnectionId, net::ConnectionId> doorOf;
    /// The links, by their socket at the door.
    std::map<net::ConnectionId, Server> servers;
    std::vector<Biome> biomes;
    /// Biome index by realm, or -1 for a realm every server has its own of.
    std::array<int, kMaxRealms> biomeOf{};
    std::unordered_map<std::string, Lease> leases;
    std::uint32_t nextLease = 1;
    std::uint64_t seenEdits = 0;

    double startedMillis = 0;
    double nextHeartbeatMillis = 0;
    double nextBalanceMillis = 0;
    double lastMoveMillis = -1e18;
    bool placedOnce = false;
    /// `/admin shards balance off`: nothing moves but what has no server.
    bool balance = true;
    /// Every other server was told to leave: a server of one again once they
    /// have, or once this is past.
    double disbandAtMillis = -1;
    /// Rows changed since they were last copied out, by part.
    std::array<std::unordered_set<std::string>, 4> changed;
    double nextCopyMillis = 0;
    bool reachableChanged = false;
    double drainUntilMillis = -1;

    Server* byName(const std::string& name);
    /// Servers in processes of their own.
    int remoteServers() const {
        int n = 0;
        for (const auto& entry : servers) {
            if (entry.second.slot != 0 && !entry.second.greeting.local) ++n;
        }
        return n;
    }

    Server* bySlot(int slot) {
        if (slot == 0) return nullptr;
        for (auto& entry : servers) {
            if (entry.second.slot == slot) return &entry.second;
        }
        return nullptr;
    }
    const Server* bySlot(int slot) const { return const_cast<Gateway*>(this)->bySlot(slot); }
};

} // namespace flix
