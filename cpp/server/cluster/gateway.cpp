// The gateway of a sharded game: the accounts, the sockets of clients with no
// flower out, and which server has which biome. See server/cluster/gateway.h and cpp/docs/ARCHITECTURE.md,
// "Sharding".

#include "server/cluster/gateway.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <set>

#include "server/cluster/row_merge.h"
#include "server/account_limits.h"
#include "server/crypto.h"
#include "shared/net/websocket.h"
#include "server/game_server_internal.h"
#include "server/routine_log_policy.h"
#include "server/text.h"
#include "shared/game/config.h"

namespace flix {

using cluster::ClientInfo;
using cluster::FlowerState;
using cluster::ToGateway;
using cluster::ToServer;
using cluster::Where;
using cluster::whereHandled;

namespace {

/// How long an arrival waits for its biome to have a server before the client
/// is put back on the title screen: a hand-over takes a fraction of this.
constexpr double kArrivalPatienceMillis = 8000.0;
/// How long the first deal waits for the servers it was told to expect.
constexpr double kPlacementPatienceMillis = 20000.0;
constexpr double kBalanceIntervalMillis = 15000.0;
/// A move empties a biome's ground, so one is given time to show what it did.
constexpr double kMoveSettleMillis = 60000.0;
/// What a client may have waiting behind one slow request.
constexpr std::size_t kMaxHeldFrames = 256;
/// How long a stopping gateway waits for its servers' last word.
constexpr double kDrainMillis = 3000.0;

ByteWriter begin(ToServer message) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(message));
    return w;
}

ByteWriter clientFrame(net::ConnectionId client, const std::byte* data, std::size_t size) {
    ByteWriter w(size + 8);
    w.u8(static_cast<std::uint8_t>(ToServer::ClientFrame));
    w.u32(client);
    w.raw(data, size);
    return w;
}

/// A client's frame past its message id, however much of it has been read.
ByteReader frameBody(const ByteReader& frame) {
    ByteReader r(frame.begin(), frame.size());
    r.u8();
    return r;
}

/// The unmodelled tables a simulation server reads, sent to every one of them
/// as they change.
bool sharedTable(const std::string& key) { return key == "guilds" || key == "chatTerms"; }

/// The ones a biome's server WRITES, sent with the biome and written back by
/// whoever has it.
constexpr const char* kBiomeTables[] = {"bossClocks", "sacrificeSpawn", "adminArena", "adminEvents"};

/// The host part of a peer address ("1.2.3.4:5678", "::ffff:1.2.3.4:5678"),
/// as a URL would have it.
std::string hostOfPeer(const std::string& peer) {
    std::string host = peer;
    const std::size_t colon = host.rfind(':');
    if (colon != std::string::npos) host = host.substr(0, colon);
    if (host.rfind("::ffff:", 0) == 0 && host.find('.') != std::string::npos) host = host.substr(7);
    if (host.find(':') != std::string::npos && host.front() != '[') host = "[" + host + "]";
    return host;
}

ByteWriter attachedAnswer(bool ok) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Attached));
    w.boolean(ok);
    return w;
}

} // namespace

// ---------------------------------------------------------------------------
// Starting and stopping
// ---------------------------------------------------------------------------

bool GameServer::startGateway(std::string& errorOut) {
    if (config_.clusterSecret.empty()) {
        errorOut = "a sharded game needs a cluster secret";
        return false;
    }
    hosted_.all = false;
    hosted_.realm.fill(false);
    gateway_ = std::make_unique<Gateway>(*this);
    Gateway& g = *gateway_;
    g.startedMillis = monotonicMillis();
    gwBuildBiomes();
    gwReadDistribution();
    gwReadDomains();
    database_.onRowWritten = [this](Database::Part part, const std::string& key) {
        for (const auto& entry : gateway_->servers) {
            if (!entry.second.copying) continue;
            gateway_->changed[static_cast<std::size_t>(part)].insert(key);
            return;
        }
    };
    // An acknowledgement of a server's rows goes out on the link only behind
    // the journal line that holds them.
    g.door.beforeWrite = [this] { database_.flushJournal(); };
    // The game's own port, for clients and servers both. The sessions are
    // adopted connections whose frames go wherever their client's socket is
    // (gwDeliver); what a socket here says is handed to the session it is, or
    // to the link it is (gwDoorFrame): a link is a WebSocket at /link, which a
    // server dials plain whatever certificate the port has.
    g.door.certPath = config_.certPath;
    g.door.keyPath = config_.keyPath;
    g.door.webRoot = config_.webRoot;
    g.door.bindHost = config_.bindHost;
    // Its servers' links are WebSockets at /link.
    g.door.webSockets = true;
    if (!g.door.start(config_.port, errorOut)) return false;
    database_.onTableWritten = [this](const std::string& key, const std::string& text) {
        if (!sharedTable(key)) return;
        ByteWriter w = begin(ToServer::Table);
        w.str(key);
        w.blob(text);
        for (const auto& entry : gateway_->servers) {
            if (entry.second.slot != 0) gwSend(entry.second.slot, w);
        }
    };
    // A mute, a promotion, a rename: the servers that know the account are
    // told as the journal is.
    database_.onAccountWritten = [this](const std::string& key) {
        const Account* account = std::as_const(database_).findUser(key);
        if (account == nullptr) return;
        for (auto& entry : sessions_) {
            const Session& session = entry.second;
            if (!session.authenticated() || session.userId != account->id) continue;
            Account shown = *account;
            shown.passwordHash.clear();
            ByteWriter w = begin(ToServer::Account);
            w.blob(accountRecordJson(shown).dump(0));
            for (const auto& told : session.elsewhere.told) gwSend(told.first, w);
        }
    };
    std::printf("[cluster] gateway: %zu biomes to place, servers dial the game's port, %u\n",
                g.biomes.size(), static_cast<unsigned>(config_.port));
    return true;
}

void GameServer::gwBuildBiomes() {
    Gateway& g = *gateway_;
    g.biomeOf.fill(-1);
    const auto add = [&](const std::string& name, Realm realm, double cost) {
        auto at = std::find_if(g.biomes.begin(), g.biomes.end(),
                               [&](const Gateway::Biome& b) { return b.name == name; });
        if (at == g.biomes.end()) {
            Gateway::Biome biome;
            biome.name = name;
            g.biomes.push_back(std::move(biome));
            at = g.biomes.end() - 1;
        }
        at->realms.push_back(realm);
        at->cost += cost;
        g.biomeOf[realmIndex(realm)] = static_cast<int>(at - g.biomes.begin());
    };
    for (const MapData& map : worldMaps_.maps()) {
        if (ubiquitousRealm(map.realm())) continue;
        // A guess from the map's size until there are measurements, and half
        // of it for a prestige twin: the same ground, for far fewer players.
        const double tiles = static_cast<double>(map.width()) * map.height();
        add(biomeOfRealm(map.realm()), map.realm(), tiles / 5000.0 * (map.prestige() ? 0.5 : 1.0));
    }
    add(kMazeSpawnChoice, Realm::Maze, 0.5);
    add(kArenaSpawnChoice, Realm::Arena, 0.1);
    add(kAdminArenaSpawnChoice, kAdminArenaRealm, 0.1);
}

bool GameServer::ubiquitousRealm(Realm realm) const {
    // Generated per run or copied per party, and reached only from a realm
    // beside them: every server has its own, and no flower is ever sent to
    // another server to stand in one.
    if (isTrialRealm(realm) || realm == kWavesRealm) return true;
    const MapData* map = worldMaps_.forRealm(realm);
    if (map == nullptr) return realm != Realm::Arena && realm != Realm::Maze && realm != kAdminArenaRealm;
    return !map->prestige() && worldMaps_.copiesOf(map->templateId()).size() > 1;
}

bool GameServer::gwDraining() {
    Gateway& g = *gateway_;
    if (g.drainUntilMillis < 0) {
        g.drainUntilMillis = monotonicMillis() + kDrainMillis;
        for (auto& entry : sessions_) gwRelease(entry.second);
        if (exitCode_ == kRestartExit) gwRestartServers();
        gwFlush();
    }
    return !g.leases.empty() && monotonicMillis() < g.drainUntilMillis;
}

// ---------------------------------------------------------------------------
// The links
// ---------------------------------------------------------------------------

void GameServer::gwFlush() {
    gwPassEdits();
    // What the sessions queued, into the sockets and links it goes out on:
    // after beforeWrite, so behind the journal.
    listener_.flush();
    gateway_->door.flush();
}

void GameServer::gwSend(int slot, const ByteWriter& message) {
    Gateway::Server* server = gateway_->bySlot(slot);
    if (server == nullptr) return;
    if (net::Connection* link = gateway_->door.find(server->link)) {
        link->send(server->cipher.seal(message));
    }
}

void GameServer::gwLinkOpened(net::Connection& link) {
    // A whole table's rows may be queued for one server at once.
    link.maxPendingBytes = cluster::kLinkMaxPending;
    Gateway::Server server;
    server.link = link.id();
    server.openedAtMillis = monotonicMillis();
    server.lastHeardMillis = server.openedAtMillis;
    gateway_->servers[link.id()] = std::move(server);
}

bool GameServer::gwHandshake(net::Connection& link, ByteReader& reader, std::uint8_t message) {
    Gateway& g = *gateway_;
    Gateway::Server& server = g.servers[link.id()];
    const auto refuse = [&](const std::string& why) {
        std::fprintf(stderr, "[cluster] refused a server from %s: %s\n", link.peer().c_str(),
                     why.c_str());
        ByteWriter w = begin(ToServer::Refused);
        w.str(why);
        link.send(server.cipher.seal(w));
        link.closeGracefully();
        return false;
    };
    if (message == static_cast<std::uint8_t>(ToGateway::Hello) && !server.greeted) {
        server.greeting = cluster::Greeting::read(reader);
        server.greetingDigest = server.greeting.digest();
        server.name = cluster::serverName(server.greeting.name);
        std::string why = server.greeting.refusal();
        if (why.empty() && !reader.ok()) why = "malformed greeting";
        if (why.empty() && server.greeting.probe && server.greeting.id == config_.membership.id) {
            why = "it is this very server";
        }
        if (!why.empty()) return refuse(why);
        server.greeted = true;
        server.nonce = crypto::secureRandom().hex(16);
        ByteWriter w = begin(ToServer::Challenge);
        w.str(server.nonce);
        w.str(cluster::linkProof(config_.clusterSecret, "gateway", server.greetingDigest, server.nonce));
        link.send(w);
        return true;
    }
    if (message == static_cast<std::uint8_t>(ToGateway::Proof) && server.greeted) {
        const std::string proof = reader.str();
        if (!reader.ok() ||
            !crypto::constantTimeEquals(
                proof, cluster::linkProof(config_.clusterSecret, "server", server.nonce,
                                          server.greetingDigest))) {
            return refuse("its cluster key is not ours");
        }
        server.cipher.start(config_.clusterSecret, server.greetingDigest, server.nonce, true);
        if (server.greeting.probe) {
            link.send(server.cipher.seal(begin(ToServer::Ready)));
            link.closeGracefully();
            return true;
        }
        if (server.name.empty() || server.name == "Unnamed") server.name = "server";
        // The same server back before its old link was noticed dead.
        for (auto& entry : g.servers) {
            if (entry.first == link.id() || entry.second.slot == 0) continue;
            const bool same = server.greeting.id.empty() ? entry.second.name == server.name
                                                         : entry.second.greeting.id == server.greeting.id;
            if (!same) continue;
            if (net::Connection* stale = g.door.find(entry.first)) stale->closeGracefully();
            const int slot = entry.second.slot;
            gwServerLost(slot, entry.second.name);
            break;
        }
        // A name is how an admin says which: one each.
        // ("gateway" is the gateway's own, in `/admin shards domain`.)
        for (int n = 2; g.byName(server.name) != nullptr || lowerCase(server.name) == "gateway"; ++n) {
            server.name = cluster::serverName(server.greeting.name) + "-" + std::to_string(n);
        }
        int slot = 1;
        while (slot <= cluster::kMaxServers && g.bySlot(slot) != nullptr) ++slot;
        if (slot > cluster::kMaxServers) return refuse("there are no slots left");
        server.slot = slot;
        // A stranger gets the frames a client does; only a server, the ones a
        // whole table takes.
        link.maxFrameBytes = cluster::kLinkMaxFrame;
        server.journalKey = server.greeting.id.empty() ? "name:" + sanitizePlayerName(server.greeting.name)
                                                       : server.greeting.id;
        server.publicHost = server.greeting.publicHost;
        server.publicPort = server.greeting.publicPort;
        // Straight, it is where its link came from -- unless that is this
        // machine (the gateway's own simulation, or a server dialling over
        // loopback), which the client knows by the name it found the gateway at.
        server.directPort = server.greeting.port;
        if (!server.greeting.local) {
            const std::string host = hostOfPeer(link.peer());
            const bool loopback = host.rfind("127.", 0) == 0 || host == "[::1]" || host == "localhost";
            if (!loopback) server.directHost = host;
        }
        const std::string straight =
            (server.directHost.empty() ? std::string("(this host)") : server.directHost) + ":" +
            std::to_string(server.directPort);
        const auto domain = g.domains.find(lowerCase(server.name));
        const std::string viaHost = domain != g.domains.end() ? domain->second.host : server.publicHost;
        const std::uint16_t viaPort = domain != g.domains.end() ? domain->second.port : server.publicPort;
        if (server.greeting.local) {
            std::printf("[cluster] %s, this process's own simulation, joined; its clients stay on this port\n",
                        server.name.c_str());
        } else if (viaHost.empty()) {
            std::printf("[cluster] %s joined from %s; clients that dial straight are sent to %s. Players who "
                        "come through a proxy cannot be sent to it until it has a domain: /admin shards "
                        "domain %s <its hostname>\n",
                        server.name.c_str(), link.peer().c_str(), straight.c_str(), server.name.c_str());
        } else {
            std::printf("[cluster] %s joined from %s; clients are sent to %s:%s (straight: %s)\n",
                        server.name.c_str(), link.peer().c_str(), viaHost.c_str(),
                        viaPort != 0 ? std::to_string(viaPort).c_str() : "(their port)", straight.c_str());
        }
        const Json& taken = std::as_const(database_).storedTable("leaseJournals")[server.journalKey];
        ByteWriter w = begin(ToServer::Welcome);
        w.u8(static_cast<std::uint8_t>(slot));
        w.i64(activeMaze().day());
        w.u64(static_cast<std::uint64_t>(taken.asDouble()));
        // Where a client that dials that server's own port is sent instead:
        // through the proxy, and straight.
        std::string ownHost;
        std::uint16_t ownPort = 0;
        gwOwnAddress(ownHost, ownPort);
        w.str(ownHost);
        w.u16(ownPort);
        w.u16(config_.port);
        gwSend(slot, w);
        for (const char* key : {"guilds", "chatTerms"}) {
            const Json& table = std::as_const(database_).storedTable(key);
            if (table.isNull()) continue;
            ByteWriter t = begin(ToServer::Table);
            t.str(key);
            t.blob(table.dump(0));
            gwSend(slot, t);
        }
        if (server.greeting.copy) gwBeginCopy(slot);
        g.reachableChanged = true;
        g.nextBalanceMillis = 0;
        return true;
    }
    return refuse("it spoke out of turn");
}

void GameServer::gwLinkMessage(net::Connection& link, ByteReader& frame) {
    Gateway& g = *gateway_;
    const auto found = g.servers.find(link.id());
    if (found == g.servers.end()) return;
    std::vector<std::byte> plain;
    if (!found->second.cipher.open(frame.rest(), frame.remaining(), plain)) {
        std::fprintf(stderr, "[cluster] a frame from %s does not open; dropping the link\n",
                     link.peer().c_str());
        link.closeGracefully();
        return;
    }
    ByteReader reader(plain);
    found->second.lastHeardMillis = monotonicMillis();
    const std::uint8_t message = reader.u8();
    if (found->second.slot == 0) {
        gwHandshake(link, reader, message);
        return;
    }
    const int slot = found->second.slot;

    // A client this server may speak to or about: one it has been told of.
    const auto clientOf = [&](net::ConnectionId id) -> Session* {
        Session* session = sessionFor(id);
        return session != nullptr && session->elsewhere.told.count(slot) != 0 ? session : nullptr;
    };

    switch (static_cast<ToGateway>(message)) {
        case ToGateway::ClientFrame: {
            const net::ConnectionId id = reader.u32();
            Session* session = clientOf(id);
            if (session == nullptr || reader.remaining() == 0) break;
            // Two of the frames passing through say where this client's
            // squad is, which is where its squad commands have to go.
            gwNoteSquad(*session, slot, static_cast<std::uint8_t>(reader.rest()[0]),
                        reader.remaining() > 1 ? static_cast<std::uint8_t>(reader.rest()[1]) : 0);
            // Wherever its socket is.
            if (net::Connection* client = listener_.find(id)) {
                client->send(reader.rest(), reader.remaining());
            }
            break;
        }
        case ToGateway::ClientClose: {
            // Its socket at that server's port closed, or that server closed
            // it: the session goes as any whose socket went.
            const net::ConnectionId id = reader.u32();
            if (clientOf(id) == nullptr) break;
            if (net::Connection* client = listener_.find(id)) client->closeGracefully();
            break;
        }
        case ToGateway::FromClient: {
            const net::ConnectionId id = reader.u32();
            const bool atMarket = reader.boolean();
            Session* session = clientOf(id);
            net::Connection* client = listener_.find(id);
            // From where it is, or from where it was: what it sent there
            // before it was redirected is still its own, in order.
            if (!reader.ok() || session == nullptr || client == nullptr || client->closing() ||
                (session->elsewhere.carrier != slot && session->elsewhere.lastCarrier != slot) ||
                reader.remaining() == 0) {
                break;
            }
            const auto kind = static_cast<net::ClientMessage>(reader.rest()[0]);
            ByteReader frame(reader.rest(), reader.remaining());
            session->elsewhere.viaCarrier = true;
            session->elsewhere.carrierAtMarket = atMarket;
            onMessage(*client, frame);
            if (Session* still = sessionFor(id)) still->elsewhere.viaCarrier = false;
            if (cluster::awaitsGateway(kind)) {
                // The answer and the edits it made go ahead of the word that
                // the server may carry on with what the client sent next.
                gwPassEdits();
                listener_.flush();
                ByteWriter w = begin(ToServer::Handled);
                w.u32(id);
                gwSend(slot, w);
            }
            break;
        }
        case ToGateway::Attached: {
            const net::ConnectionId id = reader.u32();
            Session* session = clientOf(id);
            if (reader.ok() && session != nullptr && session->elsewhere.carrier == slot) {
                session->elsewhere.transitSinceMillis = 0;
            }
            break;
        }
        case ToGateway::Recovered: gwRecovered(slot, reader); break;
        case ToGateway::SquadNote: {
            const net::ConnectionId id = reader.u32();
            const std::uint8_t kind = reader.u8();
            const std::uint8_t first = reader.u8();
            if (Session* session = reader.ok() ? clientOf(id) : nullptr) gwNoteSquad(*session, slot, kind, first);
            break;
        }
        case ToGateway::Rows: {
            const std::uint64_t seq = reader.u64();
            const int n = reader.u16();
            for (int i = 0; i < n && reader.ok(); ++i) {
                const std::string user = reader.str();
                const std::uint32_t lease = reader.u32();
                const std::uint32_t ack = reader.u32();
                std::string row = reader.blob();
                if (reader.ok()) gwTakeRow(user, lease, slot, ack, std::move(row));
            }
            if (reader.ok()) gwNoteTaken(slot, seq);
            break;
        }
        case ToGateway::Table: {
            const std::string key = reader.str();
            const std::string text = reader.blob();
            if (reader.ok()) gwTable(slot, key, text);
            break;
        }
        case ToGateway::LeaseReturned: gwLeaseReturned(slot, reader); break;
        case ToGateway::ClientState: {
            const net::ConnectionId id = reader.u32();
            const cluster::ClientState state = cluster::ClientState::read(reader);
            Session* session = clientOf(id);
            if (session == nullptr || !reader.ok() || session->elsewhere.slot != slot) break;
            session->elsewhere.state = state;
            oracleReadyAt_[session->userId] = clockMillis_ + state.oracleWait;
            traderReadyAt_[session->userId] = clockMillis_ + state.traderWait;
            break;
        }
        case ToGateway::FenceAck: {
            const net::ConnectionId id = reader.u32();
            const std::uint32_t fence = reader.u32();
            const bool atMarket = reader.boolean();
            Session* session = sessionFor(id);
            if (session == nullptr || !reader.ok() || session->elsewhere.fenceSeq != fence) break;
            Session::Elsewhere& e = session->elsewhere;
            e.atMarket = atMarket;
            if (e.leaving) {
                e.leaving = false;
            } else if (e.fenced) {
                e.fenced = false;
                e.pastFence = true;
            }
            gwDrainHeld(id);
            break;
        }
        case ToGateway::Released: {
            const std::string name = reader.str();
            std::string drops = reader.blob();
            if (!reader.ok()) break;
            for (std::size_t i = 0; i < g.biomes.size(); ++i) {
                Gateway::Biome& biome = g.biomes[i];
                if (biome.name != name || biome.slot != slot) continue;
                // Unasked, it is a server putting its affairs in order.
                if (!biome.handingOver) found->second.leaving = true;
                const int next = biome.next;
                biome.slot = 0;
                biome.handingOver = false;
                biome.next = 0;
                biome.drops = std::move(drops);
                g.reachableChanged = true;
                const Gateway::Server* to = g.bySlot(next);
                if (to != nullptr && !to->leaving) gwHost(i, next);
                break;
            }
            break;
        }
        case ToGateway::Stats: {
            const cluster::ServerStats stats = cluster::ServerStats::read(reader);
            if (!reader.ok()) break;
            found->second.stats = stats;
            found->second.reported = true;
            // A server's tick, dealt over its biomes by how busy each is. A
            // realm nobody is in still costs the mobs its bots keep awake.
            std::vector<double> activity(g.biomes.size(), 0.0);
            std::vector<int> humans(g.biomes.size(), 0);
            std::vector<bool> boss(g.biomes.size(), false);
            double total = 0.0;
            for (const cluster::ServerStats::RealmLoad& load : stats.realms) {
                const int at = g.biomeOf[realmIndex(load.realm)];
                const double busy = 2.0 * load.humans + 1.0 * load.flowers + 0.02 * load.mobs;
                total += busy;
                if (at < 0) continue;
                activity[static_cast<std::size_t>(at)] += busy;
                humans[static_cast<std::size_t>(at)] += load.humans;
                boss[static_cast<std::size_t>(at)] = boss[static_cast<std::size_t>(at)] || load.boss;
            }
            for (std::size_t i = 0; i < g.biomes.size(); ++i) {
                Gateway::Biome& biome = g.biomes[i];
                if (biome.slot != slot) continue;
                biome.humans = humans[i];
                biome.boss = boss[i];
                const double cost = total > 0.0 ? stats.tickMillis * activity[i] / total : 0.0;
                biome.cost += (cost - biome.cost) * 0.1;
            }
            break;
        }
        case ToGateway::Chat: {
            const auto channel = static_cast<net::ChatChannel>(reader.u8());
            const std::string author = reader.str();
            const std::string text = reader.str();
            const std::uint32_t speaker = reader.u32();
            if (reader.ok()) broadcastChat(channel, author, text, speaker);
            break;
        }
        case ToGateway::Announce: {
            const std::string here = reader.str();
            const std::string elsewhere = reader.str();
            std::unordered_set<net::ConnectionId> present;
            for (int n = reader.u16(); n > 0 && reader.ok(); --n) present.insert(reader.u32());
            if (!reader.ok()) break;
            for (auto& entry : sessions_) {
                if (!entry.second.authenticated()) continue;
                net::Connection* client = listener_.find(entry.first);
                if (client == nullptr) continue;
                sendChatTo(*client, net::ChatChannel::System, "",
                           present.count(entry.first) != 0 ? here : elsewhere);
            }
            break;
        }
        case ToGateway::Notification: {
            const std::string type = reader.str();
            const std::string text = reader.str();
            if (reader.ok()) addNotification(type, text);
            break;
        }
        case ToGateway::TitanForged: {
            const std::string user = reader.str();
            const std::string username = reader.str();
            const std::uint16_t petal = reader.u16();
            if (!reader.ok()) break;
            takeUniversals(petal, user);
            universalHolders_[petal] = HolderMemo{username, clockMillis_};
            gwPassEdits();
            break;
        }
        case ToGateway::UniversalFound: {
            const std::string user = reader.str();
            const std::string username = reader.str();
            const std::uint16_t petal = reader.u16();
            if (!reader.ok()) break;
            takeUniversals(petal, user, UniversalTaken::Found);
            universalHolders_[petal] = HolderMemo{username, clockMillis_};
            gwPassEdits();
            break;
        }
        case ToGateway::TitanHolder: {
            const net::ConnectionId id = reader.u32();
            const std::uint16_t petal = reader.u16();
            net::Connection* client = listener_.find(id);
            if (!reader.ok() || clientOf(id) == nullptr || client == nullptr) break;
            if (petal >= content().petalCount()) break;
            ByteWriter w;
            w.u8(static_cast<std::uint8_t>(net::ServerMessage::TitanHolder));
            w.u16(petal);
            w.str(universalHolderName(petal));
            client->send(w);
            break;
        }
        case ToGateway::CreditKill: {
            const std::string user = reader.str();
            const std::string mob = reader.str();
            const Rarity rarity = clampRarity(reader.u8());
            const double stars = reader.f64();
            if (!reader.ok() || std::as_const(database_).findUserById(user) == nullptr) break;
            PlayerRecord& record = database_.progress(user);
            record.recordKill(mob, rarity);
            record.stars += std::max(0.0, stars);
            database_.markDirty();
            gwPassEdits();
            for (auto& entry : sessions_) {
                Session& session = entry.second;
                if (session.authenticated() && session.userId == user) sendProfile(session);
            }
            break;
        }
        case ToGateway::CreditLoot: {
            // Drops that server held for somebody who has left it: into the
            // account's bag, wherever its row is now -- gwPassEdits carries
            // the stacks to a server that has it on loan, as amounts.
            const std::string user = reader.str();
            const Account* account = std::as_const(database_).findUserById(user);
            const int n = reader.u16();
            bool gave = false;
            for (int i = 0; i < n && reader.ok(); ++i) {
                const std::uint16_t petal = content().petalIndex(reader.str());
                const Rarity rarity = clampRarity(reader.u8());
                const int count = static_cast<int>(std::min<std::uint32_t>(reader.u32(), 1u << 20));
                if (!reader.ok() || account == nullptr || petal >= content().petalCount() ||
                    count <= 0) {
                    continue;
                }
                PlayerRecord& record = database_.progress(user);
                if (rarity == Rarity::Universal) {
                    // There is one of it, as at bankPickups: none for a flower
                    // that holds it already, and every other copy is taken.
                    if (holdsUniversal(record, petal)) continue;
                    giveToInventory(record, petal, rarity, 1);
                    if (tracksUniversals(user)) {
                        takeUniversals(petal, user, UniversalTaken::Found);
                        universalHolders_[petal] = HolderMemo{account->username, clockMillis_};
                    }
                } else {
                    giveToInventory(record, petal, rarity, count);
                }
                gave = true;
            }
            if (!gave) break;
            database_.markDirty();
            gwPassEdits();
            for (auto& entry : sessions_) {
                Session& session = entry.second;
                if (session.authenticated() && session.userId == user) sendProfile(session);
            }
            break;
        }
        case ToGateway::TempAdminEnded: {
            const net::ConnectionId id = reader.u32();
            if (reader.ok() && clientOf(id) != nullptr) revokeTempAdmin(id);
            break;
        }
        case ToGateway::CopyAck: {
            const std::uint64_t seq = reader.u64();
            if (reader.ok()) found->second.copyOnDisk = seq;
            break;
        }
        case ToGateway::SquadMoved: {
            const net::ConnectionId id = reader.u32();
            cluster::SquadState squad = cluster::SquadState::read(reader);
            Session* session = clientOf(id);
            if (!reader.ok() || session == nullptr || session->elsewhere.slot == 0) break;
            const int to = session->elsewhere.slot;
            squad.members.erase(
                std::remove_if(squad.members.begin(), squad.members.end(),
                               [&](net::ConnectionId member) { return sessionFor(member) == nullptr; }),
                squad.members.end());
            if (squad.members.empty()) break;
            for (const net::ConnectionId member : squad.members) {
                Session& other = *sessionFor(member);
                gwAttach(other, to);
                other.elsewhere.squadSlot = to;
                other.elsewhere.inSquad = true;
            }
            ByteWriter w = begin(ToServer::Squad);
            squad.write(w);
            gwSend(to, w);
            break;
        }
        default: break;
    }
}

void GameServer::gwNoteSquad(Session& session, int slot, std::uint8_t message, std::uint8_t first) {
    Session::Elsewhere& e = session.elsewhere;
    const auto kind = static_cast<net::ServerMessage>(message);
    if (kind == net::ServerMessage::SquadUpdate) {
        const bool in = first != 0;
        if (in || e.squadSlot == slot) {
            e.inSquad = in;
            e.squadSlot = in ? slot : 0;
        }
    } else if (kind == net::ServerMessage::SquadInviteReceived && !e.inSquad) {
        e.squadSlot = slot;
    }
}

void GameServer::gwLinkClosed(net::ConnectionId link, const std::string& reason) {
    Gateway& g = *gateway_;
    const auto found = g.servers.find(link);
    if (found == g.servers.end()) return;
    const int slot = found->second.slot;
    const std::string name = found->second.name;
    if (slot != 0) {
        std::printf("[cluster] %s is gone (%s)\n", name.c_str(), reason.c_str());
        gwServerLost(slot, name);
    }
    g.servers.erase(link);
}

void GameServer::gwServerLost(int slot, const std::string& name) {
    Gateway& g = *gateway_;
    for (Gateway::Biome& biome : g.biomes) {
        if (biome.slot != slot) {
            if (biome.next == slot) biome.next = 0;
            continue;
        }
        biome.slot = 0;
        biome.handingOver = false;
        biome.next = 0;
        biome.humans = 0;
        biome.boss = false;
    }
    g.reachableChanged = true;
    g.nextBalanceMillis = 0;

    if (Gateway::Server* server = g.bySlot(slot)) {
        // Off the books before anything below looks for somewhere to go.
        server->slot = 0;
        server->copying = false;
    }

    // Every row it had is as it last sent it. What its players were shown
    // after that is in its lease journal, and is handed over when it is
    // linked again (gwRecovered).
    for (auto it = g.leases.begin(); it != g.leases.end();) {
        it = it->second.slot == slot ? g.leases.erase(it) : std::next(it);
    }
    // Whoever was at its port, or on the way there, lost the socket with it,
    // and dials the gateway again to sign back in.
    std::vector<net::ConnectionId> stranded;
    for (const auto& entry : sessions_) {
        if (entry.second.elsewhere.carrier == slot) stranded.push_back(entry.first);
    }
    for (const net::ConnectionId id : stranded) {
        if (Session* session = sessionFor(id)) {
            // Nothing of it is that server's to be told any more.
            session->elsewhere.told.erase(slot);
            if (session->elsewhere.slot == slot) {
                session->elsewhere.slot = 0;
                session->elsewhere.lease = 0;
            }
        }
        gwDropClient(id);
    }
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        Session::Elsewhere& e = session.elsewhere;
        e.told.erase(slot);
        net::Connection* client = listener_.find(entry.first);
        if (e.squadSlot == slot) {
            if (e.inSquad && client != nullptr) sendSquadUpdate(*client, nullptr);
            e.squadSlot = 0;
            e.inSquad = false;
        }
        if (e.slot != slot) continue;
        const bool wasDead = e.state.dead;
        const Realm was = e.state.realm;
        const bool left = e.leaving;
        e.slot = 0;
        e.lease = 0;
        e.state = cluster::ClientState{};
        e.leaving = false;
        // A fenced request is simply run here now: there is nothing left to
        // wait for.
        if (e.fenced) {
            e.fenced = false;
            e.pastFence = true;
        }
        session.profileShadow = Session::ProfileShadow{};
        if (left || client == nullptr) continue;
        if (isTrialRealm(was)) {
            session.spawnChoice.clear();
            gwArrivalFailed(session, "The server your trial was on has stopped.");
            continue;
        }
        // The flower is gone with the server; its account is not. It comes
        // back at its own door, on whichever server has that biome next.
        e.entering = std::make_unique<FlowerState>();
        e.entering->how = FlowerState::How::Fresh;
        e.entering->dead = wasDead;
        e.entering->realm = spawnRealmFor(session);
        e.enteringSinceMillis = monotonicMillis();
        sendNotice(*client, net::NoticeSeverity::Warning,
                   "Your biome's server restarted. Taking you back to your spawn point.");
    }
    for (auto& entry : sessions_) gwDrainHeld(entry.first);
    (void)name;
}

// ---------------------------------------------------------------------------
// Where a client's frames go
// ---------------------------------------------------------------------------

ClientInfo GameServer::gwClientInfo(const Session& session, int slot) const {
    ClientInfo info;
    info.userId = session.userId;
    info.username = session.username;
    info.address = session.clientAddress;
    info.displayName = session.displayName;
    info.spawnChoice = session.spawnChoice;
    info.admin = session.admin;
    info.adminTier = session.adminTier;
    info.grantTier = kNotAnAdmin;
    if (const auto grant = tempAdmins_.find(session.connection); grant != tempAdmins_.end()) {
        info.grantTier = grant->second.tier;
        info.grantedBy = grant->second.grantedBy;
    }
    const Session::Elsewhere& e = session.elsewhere;
    if (e.slot != 0 && e.slot != slot) info.elsewhere = biomeOfRealm(e.state.realm);
    return info;
}

void GameServer::gwAttach(Session& session, int slot) {
    if (slot == 0 || gateway_->bySlot(slot) == nullptr || !session.authenticated()) return;
    ByteWriter info;
    gwClientInfo(session, slot).write(info);
    const auto told = session.elsewhere.told.find(slot);
    if (told != session.elsewhere.told.end() && told->second == info.buffer()) return;
    const bool fresh = told == session.elsewhere.told.end();
    session.elsewhere.told[slot] = info.buffer();
    if (fresh) {
        if (const Account* account = std::as_const(database_).findUserById(session.userId)) {
            Account shown = *account;
            shown.passwordHash.clear();
            ByteWriter a = begin(ToServer::Account);
            a.blob(accountRecordJson(shown).dump(0));
            gwSend(slot, a);
        }
    }
    ByteWriter w = begin(ToServer::Client);
    w.u32(session.connection);
    w.raw(info.data(), info.size());
    gwSend(slot, w);
}

void GameServer::gwForward(Session& session, int slot, ByteReader frame) {
    gwAttach(session, slot);
    gwSend(slot, clientFrame(session.connection, frame.begin(), frame.size()));
}

bool GameServer::gwRoute(Session& session, net::Connection& connection, net::ClientMessage id,
                         ByteReader frame) {
    Session::Elsewhere& e = session.elsewhere;
    if (e.pastFence) {
        e.pastFence = false;
        return false;
    }
    if (!session.authenticated()) return false;

    if (e.busy()) {
        // Steering does not wait for a shop: a flower mid-purchase still
        // moves. One between servers has nothing to steer.
        if (id == net::ClientMessage::Input || id == net::ClientMessage::Ping) {
            if (e.slot != 0) {
                gwForward(session, e.slot, frame);
                return true;
            }
            return id == net::ClientMessage::Input;
        }
        if (e.held.size() >= kMaxHeldFrames) {
            connection.closeGracefully();
            return true;
        }
        e.held.emplace_back(frame.begin(), frame.begin() + frame.size());
        return true;
    }

    switch (id) {
        case net::ClientMessage::Chat:
            return gwRouteChat(session, connection, frame);
        case net::ClientMessage::GuildSquadAll:
        case net::ClientMessage::GuildInviteToSquad: {
            const int slot = gwSquadSlot(session);
            if (slot == 0) return false;
            if (id == net::ClientMessage::GuildInviteToSquad) {
                ByteReader r = frameBody(frame);
                gwAttachForSquad(r.str(), slot);
            } else {
                const std::string guild = guildNameForUser(session.username);
                const Json& members = database_.storedTable("guilds")[guild]["memberUsernames"];
                for (std::size_t i = 0; i < members.size(); ++i) {
                    gwAttachForSquad(members[i].asString(), slot);
                }
            }
            gwForward(session, slot, frame);
            return true;
        }
        case net::ClientMessage::AdminTools: {
            ByteReader r = frameBody(frame);
            const Json q = Json::parseOrNull(r.str());
            const std::string kind = q["kind"].asString();
            if (kind == "event" || kind == "arena") {
                const int slot = gwSlotOfRealm(kAdminArenaRealm);
                if (slot == 0) return false;
                gwForward(session, slot, frame);
                return true;
            }
            if (kind != "market" || e.slot == 0) return false;
            break;
        }
        case net::ClientMessage::JoinGame:
            // A flower already in the world asks for nothing by this.
            return e.slot != 0;
        case net::ClientMessage::Respawn:
            if (e.slot != 0) break;
            // Off the title screen, as handleRespawn allows: a fresh body at
            // the door last picked.
            e.entering = std::make_unique<FlowerState>();
            e.entering->how = FlowerState::How::Fresh;
            e.entering->realm = spawnRealmFor(session);
            e.enteringSinceMillis = monotonicMillis();
            gwDispatch(session);
            return true;
        default: break;
    }

    if (e.slot == 0) return false;
    if (id == net::ClientMessage::LeaveGame) {
        gwForward(session, e.slot, frame);
        e.leaving = true;
    } else {
        switch (id == net::ClientMessage::AdminTools ? Where::Fenced : whereHandled(id)) {
            case Where::Here: return false;
            case Where::There: gwForward(session, e.slot, frame); return true;
            case Where::Fenced: break;
        }
        if (e.viaCarrier && e.carrier == e.slot) {
            // Sent by the server the flower is on, which carried out
            // everything before it and put the rows ahead of it on the link:
            // the fence is already behind it.
            e.atMarket = e.carrierAtMarket;
            return false;
        }
        e.held.emplace_front(frame.begin(), frame.begin() + frame.size());
        e.fenced = true;
    }
    ByteWriter w = begin(ToServer::Fence);
    w.u32(session.connection);
    w.u32(++e.fenceSeq);
    gwSend(e.slot, w);
    return true;
}

void GameServer::gwDrainHeld(net::ConnectionId id) {
    while (true) {
        Session* session = sessionFor(id);
        net::Connection* connection = listener_.find(id);
        if (session == nullptr || connection == nullptr || connection->closing()) return;
        Session::Elsewhere& e = session->elsewhere;
        if (e.busy() || e.held.empty()) return;
        const std::vector<std::byte> frame = std::move(e.held.front());
        e.held.pop_front();
        ByteReader reader(frame);
        onMessage(*connection, reader);
        gwPassEdits();
    }
}

int GameServer::gwSquadSlot(Session& session) {
    const Session::Elsewhere& e = session.elsewhere;
    if (e.squadSlot != 0 && gateway_->bySlot(e.squadSlot) != nullptr) return e.squadSlot;
    if (e.slot != 0) return e.slot;
    // Nowhere yet: wherever they are about to be, which is where the squad
    // will have to be too.
    const int door = session.spawnChoice.empty() ? 0 : gwSlotOfRealm(spawnRealmFor(session));
    return door != 0 ? door : gwSlotOfRealm(Realm::Overworld);
}

void GameServer::gwAttachForSquad(const std::string& username, int slot) {
    Session* target = sessionForUser(trimmed(username));
    if (target != nullptr) gwAttach(*target, slot);
}

bool GameServer::gwRouteChat(Session& session, net::Connection& connection, ByteReader frame) {
    Session::Elsewhere& e = session.elsewhere;
    ByteReader r = frameBody(frame);
    const std::string text = sanitizeChat(r.str());
    if (!r.ok() || text.empty() || text[0] != '/') return false;
    std::vector<std::string> words = splitWords(text);
    if (words.empty()) return false;
    const std::string verb = lowerCase(words[0]);

    if (verb == "/l" || verb == "/local") {
        if (e.slot == 0) return false;
        gwForward(session, e.slot, frame);
        return true;
    }
    const bool squad = verb == "/squad" || verb.rfind("/squad-", 0) == 0;
    if (squad || verb == "/s" || verb == "/guild-squad") {
        const int slot = gwSquadSlot(session);
        if (slot == 0) return false;
        // The player an invitation names has to be known where it is made.
        const std::string sub = verb == "/squad" ? (words.size() > 1 ? lowerCase(words[1]) : "")
                                : squad          ? verb.substr(7)
                                                 : "";
        const std::size_t at = verb == "/squad" ? 2 : 1;
        if (sub == "invite" && words.size() > at) gwAttachForSquad(words[at], slot);
        if (verb == "/guild-squad") {
            const std::string guild = guildNameForUser(session.username);
            const Json& members = database_.storedTable("guilds")[guild]["memberUsernames"];
            for (std::size_t i = 0; i < members.size(); ++i) {
                gwAttachForSquad(members[i].asString(), slot);
            }
        }
        gwForward(session, slot, frame);
        return true;
    }
    if ((verb == "/admin" || verb == "/cmd") && words.size() > 1 && effectiveAdmin(session)) {
        words.erase(words.begin());
        const int slot = gwServerForCommand(session, words);
        if (slot == 0) return false;
        if (slot > 0) {
            gwForward(session, slot, frame);
            return true;
        }
        for (const auto& entry : gateway_->servers) {
            if (entry.second.slot != 0) gwForward(session, entry.second.slot, frame);
        }
        // The maze is every process's, this one's included: it is what a
        // joining client is told to build.
        const std::string command = lowerCase(words[0]);
        return command != "change-maze" && command != "change_maze";
    }
    (void)connection;
    return false;
}

void GameServer::gwBotRaid(const Session& speaker) {
    if (speaker.elsewhere.slot != 0) gwSend(speaker.elsewhere.slot, begin(ToServer::BotRaid));
}

int GameServer::gwServerForCommand(Session& session, const std::vector<std::string>& words) {
    const std::string verb = lowerCase(words[0]);
    const Session::Elsewhere& e = session.elsewhere;
    const auto any = [&](std::initializer_list<const char*> names) {
        return std::any_of(names.begin(), names.end(), [&](const char* n) { return verb == n; });
    };
    const auto serverOf = [&](const std::string& player) {
        const Session* target = sessionForUser(player);
        return target != nullptr && target->elsewhere.slot != 0 ? target->elsewhere.slot : e.slot;
    };
    if (any({"spawn", "spawn_npc", "start_waves", "stop_waves", "control", "release", "god",
             "invulnerable", "phase"})) {
        return e.slot;
    }
    if (any({"teleport", "tp", "corrupt"})) {
        if (words.size() < 2) return e.slot;
        const int slot = serverOf(words[1]);
        // Nobody by that name: a bot, perhaps, and only its server knows.
        return slot != 0 ? slot : -1;
    }
    if (any({"set_max_enemies", "set_bot_count", "squads", "bots", "killall", "kill_all",
             "clear_mobs", "clear_npcs", "teleport_all", "tpall", "teleport_bots", "tpbots",
             "fixnpc", "change-maze", "change_maze"})) {
        return -1;
    }
    if (any({"sacrifice", "spawn_sacrifice", "spawn-sacrifice"})) {
        bool found = false;
        const Realm hel = worldMaps_.realmOfId("hel", found);
        return found ? gwSlotOfRealm(hel) : 0;
    }
    if (verb == "arena") {
        const std::string sub = words.size() > 1 ? lowerCase(words[1]) : std::string();
        if ((sub == "bring" || sub == "return") && words.size() > 2) {
            return lowerCase(words[2]) == "all" ? -1 : serverOf(words[2]);
        }
        return gwSlotOfRealm(kAdminArenaRealm);
    }
    if (verb == "restart" && words.size() > 1) {
        for (const Gateway::Biome& biome : gateway_->biomes) {
            std::string name = lowerCase(words[1]);
            std::replace(name.begin(), name.end(), '-', '_');
            if (biome.name == name) return -1;
        }
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Flowers arriving
// ---------------------------------------------------------------------------

void GameServer::gwJoin(Session& session, double viewWidth, double viewHeight) {
    Session::Elsewhere& e = session.elsewhere;
    e.entering = std::make_unique<FlowerState>();
    e.entering->how = FlowerState::How::Join;
    e.entering->trialFloor = session.trialFloor;
    e.entering->viewWidth = viewWidth;
    e.entering->viewHeight = viewHeight;
    e.entering->realm = session.trialFloor > 0 ? kFirstTrialRealm : spawnRealmFor(session);
    e.enteringSinceMillis = monotonicMillis();
    gwDispatch(session);
}

int GameServer::gwSlotOfRealm(Realm realm) const {
    const int at = gateway_->biomeOf[realmIndex(realm)];
    if (at < 0) return 0;
    const Gateway::Biome& biome = gateway_->biomes[static_cast<std::size_t>(at)];
    return biome.handingOver ? 0 : biome.slot;
}

int GameServer::gwQuietestSlot() const {
    int best = 0;
    double bestTick = 0.0;
    for (const auto& entry : gateway_->servers) {
        const Gateway::Server& server = entry.second;
        if (server.slot == 0 || server.leaving || !gwPlaceable(server.slot)) continue;
        if (best == 0 || server.stats.tickMillis < bestTick) {
            best = server.slot;
            bestTick = server.stats.tickMillis;
        }
    }
    return best;
}

void GameServer::gwDispatch(Session& session) {
    Gateway& g = *gateway_;
    Session::Elsewhere& e = session.elsewhere;
    if (e.entering == nullptr || !session.authenticated()) return;
    const double waited = monotonicMillis() - e.enteringSinceMillis;
    FlowerState& state = *e.entering;
    const int slot = isTrialRealm(state.realm) ? gwQuietestSlot() : gwSlotOfRealm(state.realm);
    // The account's last flower has to be home before the next goes out: two
    // servers holding one row is the one thing this never does.
    std::string targetHost;
    std::uint16_t targetPort = 0;
    if (slot != 0 && !gwRedirectTarget(session, slot, targetHost, targetPort)) {
        gwArrivalFailed(session, "That biome's server cannot be reached from where you are connected yet.");
        return;
    }
    if (slot == 0 || g.leases.count(session.userId) != 0) {
        if (waited > kArrivalPatienceMillis) {
            gwArrivalFailed(session, slot == 0
                                         ? "That biome's server is not up yet. Try again in a moment."
                                         : "Your last flower is still leaving the world. Try again in a moment.");
        }
        return;
    }

    // A server asked about this client's squad answers for where it WAS.
    if (e.inSquad && e.squadSlot != 0 && e.squadSlot != slot) {
        ByteWriter w = begin(ToServer::SquadLeaving);
        w.u32(session.connection);
        w.str(biomeOfRealm(state.realm));
        gwSend(e.squadSlot, w);
    }

    state.displayName = session.displayName;
    if (state.how != FlowerState::How::Walk) {
        state.spawnChoice = session.spawnChoice;
        state.prestige = session.prestige;
    } else {
        session.spawnChoice = state.spawnChoice;
        session.prestige = state.prestige;
    }

    database_.progress(session.userId);
    gwPassEdits();
    Gateway::Lease lease;
    lease.id = g.nextLease++;
    lease.slot = slot;
    lease.client = session.connection;
    lease.shadow = database_.progressText(session.userId);
    lease.version = database_.progressVersion(session.userId);

    e.slot = slot;
    e.lease = lease.id;
    e.state = cluster::ClientState{};
    e.state.playing = true;
    e.state.realm = state.realm;
    gwAttach(session, slot);
    // The client goes to the flower: its socket is sent to that server's
    // port, ahead of the grant, so the server is expecting it by then.
    gwRedirect(session, slot);

    ByteWriter w = begin(ToServer::Grant);
    w.u32(session.connection);
    w.u32(lease.id);
    w.blob(lease.shadow);
    w.u32(session.profileRevision);
    w.f64(oracleWaitMillis(session.userId));
    w.f64(traderWaitMillis(session.userId));
    state.write(w);
    gwSend(slot, w);
    g.leases[session.userId] = std::move(lease);
    e.entering.reset();
    gwDrainHeld(session.connection);
}

void GameServer::gwArrivalFailed(Session& session, const std::string& why) {
    Session::Elsewhere& e = session.elsewhere;
    const bool joining = e.entering != nullptr && e.entering->how == FlowerState::How::Join;
    e.entering.reset();
    session.trialFloor = 0;
    if (net::Connection* client = listener_.find(session.connection)) {
        if (!joining) {
            // Its client believes it is in the world.
            ByteWriter w;
            w.u8(static_cast<std::uint8_t>(net::ServerMessage::LeftWorld));
            client->send(w);
        }
        sendNotice(*client, net::NoticeSeverity::Bad, why);
        sendFullProfile(session, *client);
    }
    // Nothing in the world for it to be anywhere else for.
    if (e.slot == 0) gwRedirect(session, 0);
    gwDrainHeld(session.connection);
}

void GameServer::gwRelease(Session& session) {
    Gateway& g = *gateway_;
    Session::Elsewhere& e = session.elsewhere;
    ByteWriter w = begin(ToServer::ClientGone);
    w.u32(session.connection);
    for (const auto& told : e.told) gwSend(told.first, w);
    if (const auto lease = g.leases.find(session.userId);
        lease != g.leases.end() && lease->second.client == session.connection) {
        // Still out: the row is the server's until it says so, and its last
        // word on it is on the way.
        lease->second.client = 0;
    }
    // Where the socket is outlives the account on it: a sign-out or a sign-in
    // happens on a live socket.
    Session::Elsewhere fresh;
    fresh.carrier = e.carrier;
    fresh.lastCarrier = e.lastCarrier;
    fresh.pendingCarrier = e.pendingCarrier;
    fresh.door = e.door;
    fresh.viaProxy = e.viaProxy;
    fresh.transitSinceMillis = e.transitSinceMillis;
    fresh.ticket = std::move(e.ticket);
    fresh.outbox = std::move(e.outbox);
    fresh.outboxBytes = e.outboxBytes;
    e = std::move(fresh);
}

// ---------------------------------------------------------------------------
// Where a client's socket is
// ---------------------------------------------------------------------------
//
// A session here is an adopted connection, numbered by this server for as long
// as the client is signed in, whichever port its socket is at. A socket at this
// server's own port is the door's; one at another server's port is that
// server's, and what is said here to its session is delivered there. Nothing a
// client sends or is sent is ever passed on by a server that is not the one it
// is connected to.

void GameServer::gwDoorOpened(net::Connection& socket) {
    Gateway& g = *gateway_;
    // Another server of the game, for its link: not a client.
    if (socket.path() == net::ws::kLinkPath) {
        gwLinkOpened(socket);
        return;
    }
    // Its own domain checked: the gateway checks only its servers'.
    if (socket.path() == net::ws::kReachPath) {
        socket.closeGracefully();
        return;
    }
    if (cameThroughProxy(socket.peer(), socket.forwarded())) g.sawProxy = true;
    const net::ConnectionId id = listener_.reserveId();
    const std::string address = clientAddress(socket.peer(), socket.forwarded());
    net::Connection& client = listener_.adopt(
        id, socket.peer(), [this, id](const std::byte* data, std::size_t size) { gwDeliver(id, data, size); });
    g.doorOf[socket.id()] = id;
    onConnect(client);
    if (Session* session = sessionFor(id)) {
        session->clientAddress = address;
        session->elsewhere.door = socket.id();
        session->elsewhere.viaProxy = cameThroughProxy(socket.peer(), socket.forwarded());
    }
}

bool GameServer::gwRedirectTarget(const Session& session, int slot, std::string& host, std::uint16_t& port) {
    Gateway& g = *gateway_;
    Gateway::Server* server = g.bySlot(slot);
    if (server == nullptr) return false;
    if (g.simulation != nullptr && g.simulation->shardSlot() == slot) {
        // This process's own: back to this port, the way the client came,
        // and handed over here (gwHandOver).
        host.clear();
        port = 0;
        return true;
    }
    // A domain an admin gave it, or the one it was started with.
    std::string viaHost;
    std::uint16_t viaPort = 0;
    if (gwDomainOf(slot, viaHost, viaPort) &&
        (server->reach != Gateway::Reach::Silent || !session.elsewhere.viaProxy)) {
        host = viaHost;
        // Always the port itself, never 0 ("the one you are on"): a player who
        // reached the gateway straight, on its own port, would take that port
        // to the domain, where nothing answers. A domain with none is 443 --
        // what the check dialled -- and the client speaks TLS to it.
        port = viaPort != 0 ? viaPort : 443;
        return true;
    }
    // A server's own port is reachable only straight: a client that came
    // through Cloudflare is never sent round it, to an address it was not
    // given and over a connection nobody vouches for.
    if (session.elsewhere.viaProxy) {
        if (!server->warnedUnreachable && server->reach != Gateway::Reach::Silent) {
            server->warnedUnreachable = true;
            std::fprintf(stderr,
                         "[cluster] %s has no domain, so players who come through a proxy cannot be sent to "
                         "it: give it its own proxied hostname with /admin shards domain %s <hostname>\n",
                         server->name.c_str(), server->name.c_str());
        }
        return false;
    }
    host = server->directHost;
    port = server->directPort;
    return true;
}

void GameServer::gwDoorFrame(net::Connection& socket, ByteReader& reader) {
    Gateway& g = *gateway_;
    if (g.servers.count(socket.id()) != 0) {
        gwLinkMessage(socket, reader);
        return;
    }
    for (Gateway::HandOver& waiting : g.handOvers) {
        if (waiting.socket != socket.id()) continue;
        // The simulation's to hear, once it has the socket. A client says
        // nothing until it is let in; one that does not is not one of ours.
        if (waiting.after.size() >= 64) socket.closeGracefully();
        else waiting.after.emplace_back(reader.rest(), reader.rest() + reader.remaining());
        return;
    }
    const auto at = g.doorOf.find(socket.id());
    if (at == g.doorOf.end() || reader.remaining() == 0) return;
    Session* session = sessionFor(at->second);
    net::Connection* client = listener_.find(at->second);
    if (session == nullptr || client == nullptr || client->closing()) return;
    if (static_cast<net::ClientMessage>(reader.rest()[0]) == net::ClientMessage::Attach) {
        reader.u8();
        const std::string ticket = reader.str();
        if (!reader.ok() || session->stage != SessionStage::Anonymous) {
            socket.closeGracefully();
            return;
        }
        gwAttachHome(socket, *session, ticket);
        return;
    }
    onMessage(*client, reader);
}

void GameServer::gwDoorClosed(net::Connection& socket, const std::string& reason) {
    Gateway& g = *gateway_;
    if (g.servers.count(socket.id()) != 0) {
        gwLinkClosed(socket.id(), reason);
        return;
    }
    g.handOvers.erase(std::remove_if(g.handOvers.begin(), g.handOvers.end(),
                                     [&](const Gateway::HandOver& h) { return h.socket == socket.id(); }),
                      g.handOvers.end());
    const auto at = g.doorOf.find(socket.id());
    if (at == g.doorOf.end()) return;
    const net::ConnectionId id = at->second;
    g.doorOf.erase(at);
    Session* session = sessionFor(id);
    if (session == nullptr || session->elsewhere.door != socket.id()) return;
    session->elsewhere.door = 0;
    // As a socket closing always ended a session.
    gwDropClient(id);
}

void GameServer::gwDeliver(net::ConnectionId id, const std::byte* data, std::size_t size) {
    Gateway& g = *gateway_;
    Session* session = sessionFor(id);
    if (session == nullptr) return;
    Session::Elsewhere& e = session->elsewhere;
    const int at = e.carrier != 0 ? e.carrier : e.pendingCarrier;
    if (at != 0) {
        ByteWriter w(size + 8);
        w.u8(static_cast<std::uint8_t>(ToServer::Deliver));
        w.u32(id);
        w.raw(data, size);
        gwSend(at, w);
        return;
    }
    if (e.door != 0) {
        if (net::Connection* socket = g.door.find(e.door)) socket->send(data, size);
        return;
    }
    if (e.transitSinceMillis <= 0) return;
    if (e.outboxBytes + size > cluster::kMaxTransitBytes) {
        // Not reading, wherever it is: given up on at the next tick.
        e.outbox.clear();
        e.outboxBytes = 0;
        e.transitSinceMillis = 1;
        return;
    }
    e.outbox.emplace_back(data, data + size);
    e.outboxBytes += size;
}

void GameServer::gwRedirect(Session& session, int slot) {
    Gateway& g = *gateway_;
    Session::Elsewhere& e = session.elsewhere;
    if (slot == 0 && e.pendingCarrier != 0) {
        // Called home again before it got home: it stays.
        e.pendingCarrier = 0;
        e.outbox.clear();
        e.outboxBytes = 0;
        return;
    }
    if (e.carrier == slot || (slot != 0 && e.pendingCarrier == slot)) return;
    const Gateway::Server* server = slot != 0 ? g.bySlot(slot) : nullptr;
    if (slot != 0 && server == nullptr) return;
    std::string host;
    std::uint16_t port = 0;
    // (gwDispatch refuses a flower a server its client cannot reach.)
    if (server != nullptr && !gwRedirectTarget(session, slot, host, port)) return;
    // Everything said to it so far leaves the way it is connected now.
    listener_.flush();

    const std::string ticket = crypto::secureRandom().hex(16);
    ByteWriter redirect;
    redirect.u8(static_cast<std::uint8_t>(net::ServerMessage::Redirect));
    if (server != nullptr) {
        ByteWriter expect = begin(ToServer::Expect);
        expect.u32(session.connection);
        expect.str(ticket);
        gwSend(slot, expect);
        if (host.empty() && port == 0 && g.simulation != nullptr) {
            // To this port, for the simulation in this process.
            const double now = monotonicMillis();
            for (auto it = g.toSimulation.begin(); it != g.toSimulation.end();) {
                it = it->second < now ? g.toSimulation.erase(it) : std::next(it);
            }
            g.toSimulation[ticket] = now + cluster::kAttachPatienceMillis;
        }
        redirect.str(host);
        redirect.u16(port);
    } else {
        // Home: wherever the client first found this server.
        redirect.str("");
        redirect.u16(0);
        e.ticket = ticket;
    }
    redirect.str(ticket);

    if (e.carrier == 0 && e.door == 0 && e.transitSinceMillis > 0 && server != nullptr) {
        // Still on its way home: told the moment it arrives, and everything
        // after that goes where it is going.
        e.outbox.emplace_back(redirect.data(), redirect.data() + redirect.size());
        e.outboxBytes += redirect.size();
        e.pendingCarrier = slot;
        return;
    }
    if (e.carrier == 0) {
        if (net::Connection* socket = e.door != 0 ? g.door.find(e.door) : nullptr) {
            socket->send(redirect);
            socket->closeGracefully();
        }
        g.doorOf.erase(e.door);
        e.door = 0;
    } else {
        // The server it is at sends it on, and lets the socket go.
        ByteWriter w(redirect.size() + 8);
        w.u8(static_cast<std::uint8_t>(ToServer::Deliver));
        w.u32(session.connection);
        w.raw(redirect.data(), redirect.size());
        gwSend(e.carrier, w);
    }
    e.lastCarrier = e.carrier;
    e.carrier = slot;
    e.transitSinceMillis = monotonicMillis();
    e.outbox.clear();
    e.outboxBytes = 0;
}

void GameServer::gwAttachHome(net::Connection& socket, Session& greeted, const std::string& ticket) {
    Gateway& g = *gateway_;
    Session* home = nullptr;
    for (auto& entry : sessions_) {
        Session::Elsewhere& e = entry.second.elsewhere;
        if (e.carrier != 0 || e.door != 0 || e.ticket.empty()) continue;
        if (crypto::constantTimeEquals(e.ticket, ticket)) {
            home = &entry.second;
            break;
        }
    }
    const auto local = home == nullptr ? g.toSimulation.find(ticket) : g.toSimulation.end();
    if (local != g.toSimulation.end()) {
        const bool fresh = local->second >= monotonicMillis();
        g.toSimulation.erase(local);
        if (fresh && g.simulation != nullptr) {
            // Sent to this process's own simulation, which takes the socket as
            // it is -- between polls, not inside this one. The session the
            // socket opened here was only its handshake.
            const net::ConnectionId handshake = greeted.connection;
            greeted.elsewhere.door = 0;
            g.doorOf.erase(socket.id());
            endSession(handshake);
            listener_.abandon(handshake);
            g.handOvers.push_back(Gateway::HandOver{socket.id(), ticket, {}});
            return;
        }
    }
    if (home == nullptr) {
        // A ticket from before a restart, or used: the client signs in again
        // on the session the socket already has.
        socket.send(attachedAnswer(false));
        return;
    }
    // The session the socket opened was only ever its handshake.
    const net::ConnectionId handshake = greeted.connection;
    greeted.elsewhere.door = 0;
    endSession(handshake);
    listener_.abandon(handshake);

    Session::Elsewhere& e = home->elsewhere;
    g.doorOf[socket.id()] = home->connection;
    e.door = socket.id();
    e.viaProxy = cameThroughProxy(socket.peer(), socket.forwarded());
    e.ticket.clear();
    e.transitSinceMillis = 0;
    socket.send(attachedAnswer(true));
    for (const std::vector<std::byte>& frame : e.outbox) socket.send(frame.data(), frame.size());
    e.outbox.clear();
    e.outboxBytes = 0;
    if (e.pendingCarrier != 0) {
        // Already sent on: the last of what it was just given says where.
        socket.closeGracefully();
        g.doorOf.erase(socket.id());
        e.door = 0;
        e.lastCarrier = 0;
        e.carrier = e.pendingCarrier;
        e.pendingCarrier = 0;
        e.transitSinceMillis = monotonicMillis();
    }
}

void GameServer::setLocalSimulation(GameServer* simulation) {
    if (!gateway_) return;
    gateway_->simulation = simulation;
    gateway_->toSimulation.clear();
    if (simulation == nullptr) gateway_->handOvers.clear();
}

void GameServer::gwHandOver() {
    Gateway& g = *gateway_;
    if (g.handOvers.empty()) return;
    std::vector<Gateway::HandOver> due;
    due.swap(g.handOvers);
    for (Gateway::HandOver& h : due) {
        std::unique_ptr<net::Connection> socket = g.door.release(h.socket);
        if (!socket) continue;
        if (g.simulation == nullptr || socket->closing()) {
            // Nobody to take it: it signs in again.
            socket->closeGracefully();
            g.door.take(std::move(socket));
            continue;
        }
        g.simulation->takeClient(std::move(socket), h.ticket, h.after);
    }
}

namespace {

std::string domainText(const std::string& host, std::uint16_t port) {
    return port == 0 ? host : host + ":" + std::to_string(port);
}

/// A hostname as an admin types it, with or without a scheme, a port or a
/// slash: false for anything that is not one.
bool parseDomain(std::string text, std::string& host, std::uint16_t& port) {
    text = lowerCase(text);
    for (const char* scheme : {"https://", "http://", "wss://", "ws://"}) {
        if (text.rfind(scheme, 0) == 0) text.erase(0, std::char_traits<char>::length(scheme));
    }
    while (!text.empty() && text.back() == '/') text.pop_back();
    port = 0;
    if (!cluster::parseAddress(text, host, port) || host.size() > 253) return false;
    for (const char c : host) {
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
    }
    return host.front() != '.' && host.front() != '-' && host.back() != '.' && host.back() != '-';
}

} // namespace

bool GameServer::gwDomainOf(int slot, std::string& host, std::uint16_t& port) const {
    const Gateway& g = *gateway_;
    const Gateway::Server* server = g.bySlot(slot);
    if (server == nullptr) return false;
    const auto domain = g.domains.find(lowerCase(server->name));
    if (domain != g.domains.end()) {
        host = domain->second.host;
        port = domain->second.port;
        return true;
    }
    host = server->publicHost;
    port = server->publicPort;
    return !host.empty();
}

bool GameServer::gwPlaceable(int slot) const {
    const Gateway& g = *gateway_;
    const Gateway::Server* server = g.bySlot(slot);
    if (server == nullptr) return false;
    if (g.simulation != nullptr && g.simulation->shardSlot() == slot) return true;
    std::string host;
    std::uint16_t port = 0;
    if (gwDomainOf(slot, host, port)) return server->reach != Gateway::Reach::Silent;
    // No domain: only players who dial its port straight can get there, which
    // is every player only where nobody comes through a proxy.
    gwOwnAddress(host, port);
    return host.empty() && !g.sawProxy;
}

bool GameServer::wantsLocalSimulation() const {
    if (!gateway_ || gateway_->simulation != nullptr) return false;
    for (const auto& entry : gateway_->servers) {
        const Gateway::Server& server = entry.second;
        if (server.slot != 0 && !server.leaving && !gwPlaceable(server.slot)) return true;
    }
    return false;
}

void GameServer::Gateway::ReachCheck::onConnect(net::Connection& c) {
    ByteWriter w;
    w.str(nonce);
    c.send(w);
}

void GameServer::Gateway::ReachCheck::onMessage(net::Connection&, ByteReader& reader) {
    if (outcome != 0) return;
    const std::string proof = reader.str();
    if (reader.ok() && crypto::constantTimeEquals(proof, expected)) {
        outcome = 1;
    } else {
        outcome = -1;
        why = "a server answers there, but not this one";
    }
}

void GameServer::Gateway::ReachCheck::onDisconnect(net::Connection&, const std::string& reason) {
    if (outcome != 0) return;
    outcome = -1;
    why = reason;
}

namespace {

/// How long a look at a domain may take, and how often one is looked at again
/// after it answered and after it did not.
constexpr double kReachPatienceMillis = 10000.0;
constexpr double kReachAgainMillis = 5.0 * 60.0 * 1000.0;
constexpr double kReachRetryMillis = 30000.0;

/// Whether a player's page reaches host:port over TLS: Cloudflare's own
/// https ports, and 443 (port 0 is the one the player is on, 443 through
/// Cloudflare). Any other port is plain.
bool tlsPort(std::uint16_t port) {
    for (const std::uint16_t p : {0, 443, 2053, 2083, 2087, 2096, 8443}) {
        if (port == p) return true;
    }
    return false;
}

} // namespace

void GameServer::gwServiceReach(double now) {
    Gateway& g = *gateway_;
    for (auto& entry : g.servers) {
        Gateway::Server& server = entry.second;
        if (server.slot == 0 || server.greeting.local) continue;
        std::string host;
        std::uint16_t port = 0;
        if (!gwDomainOf(server.slot, host, port)) {
            server.reach = Gateway::Reach::None;
            server.reachDomain.clear();
            server.check.reset();
            continue;
        }
        const std::string key = domainText(host, port);
        if (key != server.reachDomain) {
            // A new domain: whatever was found of the last one is not of this.
            server.reachDomain = key;
            server.check.reset();
            server.reach = Gateway::Reach::Checking;
            server.nextReachMillis = 0;
        }
        if (!server.check && now >= server.nextReachMillis) gwStartReach(server.slot, host, port, now);
        if (!server.check) continue;
        Gateway::ReachCheck& check = *server.check;
        check.dialer.poll(check, 0);
        check.dialer.flush();
        if (check.outcome == 0 && check.dialer.state() == net::Dialer::State::Failed) {
            // Refused, or no WebSocket there: it never opened.
            check.outcome = -1;
            check.why = check.dialer.error().empty() ? "nothing answers" : check.dialer.error();
        }
        if (check.outcome == 0 && now - check.startedMillis > kReachPatienceMillis) {
            check.outcome = -1;
            check.why = "no answer in " + std::to_string(static_cast<int>(kReachPatienceMillis / 1000)) + " s";
        }
        // A copy: settling lets go of the check, and the reason with it.
        const std::string why = check.why;
        if (check.outcome != 0) gwSettleReach(server.slot, check.outcome, why, now);
    }
}

void GameServer::gwStartReach(int slot, const std::string& host, std::uint16_t port, double now) {
    Gateway::Server& server = *gateway_->bySlot(slot);
    const bool tls = tlsPort(port);
#ifndef __EMSCRIPTEN__
    if (tls) {
        gwSettleReach(slot, 0, "this build speaks no TLS, so it cannot look", now);
        return;
    }
#endif
    auto check = std::make_shared<Gateway::ReachCheck>();
    check->nonce = crypto::secureRandom().hex(16);
    check->expected = cluster::linkProof(config_.clusterSecret, "reach", check->nonce, server.greetingDigest);
    check->startedMillis = now;
    check->dialer.webSocketPath = net::ws::kReachPath;
    check->dialer.secure = tls;
    std::string error;
    if (!check->dialer.connect(host, port == 0 ? 443 : port, error)) {
        gwSettleReach(slot, -1, error, now);
        return;
    }
    server.check = std::move(check);
}

void GameServer::gwSettleReach(int slot, int answered, const std::string& why, double now) {
    Gateway::Server& server = *gateway_->bySlot(slot);
    const Gateway::Reach was = server.reach;
    const Gateway::Reach is = answered > 0   ? Gateway::Reach::Answers
                              : answered < 0 ? Gateway::Reach::Silent
                                             : Gateway::Reach::Unchecked;
    server.check.reset();
    server.reach = is;
    server.reachWhy = why;
    server.nextReachMillis = now + (is == Gateway::Reach::Answers  ? kReachAgainMillis
                                    : is == Gateway::Reach::Silent ? kReachRetryMillis
                                                                   : 1e15);
    const net::ConnectionId asked = server.reachAskedBy;
    server.reachAskedBy = 0;
    if (was == is && asked == 0) return;
    std::string line;
    if (is == Gateway::Reach::Answers) {
        line = server.reachDomain + " reaches " + server.name + ": players who come through the proxy are sent "
               "there.";
    } else if (is == Gateway::Reach::Silent) {
        line = server.reachDomain + " does not reach " + server.name + " (" + why + "): the biomes it would "
               "have are simulated on the gateway meanwhile, and it is looked at again every " +
               std::to_string(static_cast<int>(kReachRetryMillis / 1000)) + " s.";
    } else {
        line = server.reachDomain + " for " + server.name + " is believed, not looked at: " + why + ".";
    }
    std::printf("[cluster] %s\n", line.c_str());
    if (asked != 0) {
        if (net::Connection* admin = listener_.find(asked)) sendSystem(*admin, escapedMarkup(line));
    }
}

void GameServer::gwOwnAddress(std::string& host, std::uint16_t& port) const {
    const Gateway& g = *gateway_;
    host = g.address.host.empty() ? config_.publicHost : g.address.host;
    port = g.address.host.empty() ? config_.publicPort : g.address.port;
}

void GameServer::gwReadDomains() {
    Gateway& g = *gateway_;
    const Json& table = std::as_const(database_).storedTable("cluster");
    g.domains.clear();
    g.address = Gateway::Domain{};
    Gateway::Domain d;
    if (table["domains"].isObject()) {
        for (const auto& [name, value] : table["domains"].members()) {
            if (parseDomain(value.asString(), d.host, d.port)) g.domains[lowerCase(name)] = d;
        }
    }
    if (parseDomain(table["address"].asString(), d.host, d.port)) g.address = d;
}

void GameServer::gwWriteDomains() {
    const Gateway& g = *gateway_;
    Json domains = Json::object();
    for (const auto& [name, d] : g.domains) domains[name] = Json(domainText(d.host, d.port));
    Json& table = database_.rawTable("cluster");
    table["domains"] = std::move(domains);
    if (g.address.host.empty()) table.erase("address");
    else table["address"] = Json(domainText(g.address.host, g.address.port));
    database_.markDirty();
}

void GameServer::runDomainCommand(net::Connection& connection, const std::vector<std::string>& words) {
    Gateway& g = *gateway_;
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    if (words.size() == 2) {
        // Every server's, and the gateway's own.
        std::string host;
        std::uint16_t port = 0;
        gwOwnAddress(host, port);
        out("gateway: " + (host.empty() ? std::string("no domain") : domainText(host, port)));
        std::set<std::string> told;
        for (const auto& entry : g.servers) {
            const Gateway::Server& server = entry.second;
            if (server.slot == 0) continue;
            const std::string key = lowerCase(server.name);
            told.insert(key);
            const auto d = g.domains.find(key);
            std::string where;
            if (server.greeting.local) where = "this process's own: on the gateway's port";
            else if (d != g.domains.end()) where = domainText(d->second.host, d->second.port);
            else if (!server.publicHost.empty())
                where = domainText(server.publicHost, server.publicPort) + " (its --public-host)";
            else where = "no domain: players who come through the proxy cannot be sent to it";
            switch (server.reach) {
                case Gateway::Reach::None: break;
                case Gateway::Reach::Checking: where += ", being looked at"; break;
                case Gateway::Reach::Answers: where += ", reaches it"; break;
                case Gateway::Reach::Silent: where += ", does not reach it (" + server.reachWhy + ")"; break;
                case Gateway::Reach::Unchecked: where += ", not looked at (" + server.reachWhy + ")"; break;
            }
            if (!server.greeting.local && !gwPlaceable(server.slot)) where += "; its biomes are on the gateway";
            out(server.name + ": " + where);
        }
        for (const auto& [name, d] : g.domains) {
            if (told.count(name) == 0) out(name + ": " + domainText(d.host, d.port) + " (not connected)");
        }
        return;
    }
    if (words.size() != 4) {
        out("Usage: shards domain [<server>|gateway <hostname[:port]>|none]");
        return;
    }
    const std::string name = lowerCase(words[2]);
    const std::string value = lowerCase(words[3]);
    const bool clear = value == "none" || value == "clear" || value == "off";
    Gateway::Domain d;
    if (!clear && !parseDomain(value, d.host, d.port)) {
        out(words[3] + " is not a hostname. Give the one players reach that server at through Cloudflare, "
                       "such as shard1.example.com.");
        return;
    }
    if (name == "gateway") {
        g.address = clear ? Gateway::Domain{} : d;
        gwWriteDomains();
        // Every server sends a client that dialled it to sign in here.
        std::string host;
        std::uint16_t port = 0;
        gwOwnAddress(host, port);
        for (const auto& entry : g.servers) {
            if (entry.second.slot == 0) continue;
            ByteWriter w = begin(ToServer::Address);
            w.str(host);
            w.u16(port);
            gwSend(entry.second.slot, w);
        }
        out(clear ? "The gateway has no domain now." : "The gateway is " + domainText(d.host, d.port) + ".");
        return;
    }
    Gateway::Server* server = g.byName(name);
    if (server != nullptr && server->greeting.local) {
        out(server->name + " is this process's own simulation: its players stay on the gateway's port, and "
                           "need no domain.");
        return;
    }
    if (clear) g.domains.erase(name);
    else g.domains[name] = d;
    gwWriteDomains();
    const std::string label = server != nullptr ? server->name : words[2];
    if (server != nullptr) {
        server->warnedUnreachable = false;
        // Looked at again now, even if it is the domain it had; and the admin
        // is told how that went.
        server->reachDomain.clear();
        if (!clear) server->reachAskedBy = connection.id();
    }
    if (clear) {
        out(label + " has no domain now" +
            (server != nullptr && !server->publicHost.empty() ? "; its --public-host is used." : "."));
    } else if (server == nullptr) {
        out(label + " is " + domainText(d.host, d.port) + "; it is looked at when it connects.");
    } else {
        out("Looking at whether " + domainText(d.host, d.port) + " reaches " + label +
            ". Until it does, its biomes stay on the gateway.");
    }
}

void GameServer::gwClientClosed(net::ConnectionId id) {
    Gateway& g = *gateway_;
    Session* session = sessionFor(id);
    if (session == nullptr) return;
    Session::Elsewhere& e = session->elsewhere;
    if (e.door == 0) return;
    // Behind whatever it was still to be told.
    if (net::Connection* socket = g.door.find(e.door)) socket->closeGracefully();
    g.doorOf.erase(e.door);
    e.door = 0;
}

void GameServer::gwDropClient(net::ConnectionId id) {
    gwClientClosed(id);
    endSession(id);
    listener_.abandon(id);
}

// ---------------------------------------------------------------------------
// The servers' lease journals
// ---------------------------------------------------------------------------
//
// What each server's players were shown is in its lease journal before they
// are shown it (cluster/lease_journal.h). Every row taken from a server moves
// the mark of how much of that journal is safe here; the mark is kept in the
// database, in the same journal line as the rows, so a gateway that restarts
// tells the server exactly what it still holds.

void GameServer::gwNoteTaken(int slot, std::uint64_t seq) {
    Gateway::Server* server = gateway_->bySlot(slot);
    if (server == nullptr || server->journalKey.empty()) return;
    const Json& known = std::as_const(database_).storedTable("leaseJournals")[server->journalKey];
    if (known.isNumber() && static_cast<std::uint64_t>(known.asDouble()) >= seq) return;
    Json& table = database_.rawTable("leaseJournals");
    if (!table.isObject()) table = Json::object();
    table[server->journalKey] = Json(static_cast<double>(seq));
    database_.markDirty();
    // Out on the link only behind the journal line (the link's beforeWrite).
    ByteWriter w = begin(ToServer::RowsTaken);
    w.u64(seq);
    gwSend(slot, w);
}

void GameServer::gwRecovered(int slot, ByteReader& reader) {
    const std::uint64_t seq = reader.u64();
    const int n = reader.u16();
    std::vector<std::string> users;
    for (int i = 0; i < n && reader.ok(); ++i) {
        const std::string user = reader.str();
        const std::string base = reader.blob();
        const std::string row = reader.blob();
        if (!reader.ok()) break;
        // An account deleted since has nothing to put it on.
        if (std::as_const(database_).findUserById(user) == nullptr) continue;
        const Json change = rowDifference(Json::parseOrNull(base), Json::parseOrNull(row));
        if (change.isNull()) continue;
        // On whatever the row is now -- lent out again, perhaps, in which case
        // the server holding it hears of it as of any edit made here.
        PlayerRecord& record = database_.progress(user);
        Json value = playerRecordJson(record);
        applyRowDifference(value, change);
        record = parsePlayerRecord(value);
        users.push_back(user);
    }
    if (!reader.ok()) return;
    if (!users.empty()) {
        database_.markDirty();
        gwPassEdits();
        const Gateway::Server* server = gateway_->bySlot(slot);
        std::printf("[cluster] %s handed over %zu row%s its players were shown before it was lost\n",
                    server != nullptr ? server->name.c_str() : "a server", users.size(),
                    users.size() == 1 ? "" : "s");
        for (auto& entry : sessions_) {
            Session& session = entry.second;
            if (!session.authenticated() || session.elsewhere.slot != 0) continue;
            if (std::find(users.begin(), users.end(), session.userId) != users.end()) sendProfile(session);
        }
    }
    gwNoteTaken(slot, seq);
}

// ---------------------------------------------------------------------------
// The rows on loan
// ---------------------------------------------------------------------------

void GameServer::gwPassEdits() {
    Gateway& g = *gateway_;
    if (database_.progressEdits() == g.seenEdits) return;
    g.seenEdits = database_.progressEdits();
    for (auto& entry : g.leases) {
        Gateway::Lease& lease = entry.second;
        const std::uint64_t version = database_.progressVersion(entry.first);
        if (version == lease.version) continue;
        lease.version = version;
        std::string text = database_.progressText(entry.first);
        // Gone, or the same: an account deleted under its flower has no row to
        // send an edit of, and gwTakeRow will not bring it back.
        if (text.empty() || text == lease.shadow) continue;
        Json change = rowDifference(Json::parseOrNull(lease.shadow), Json::parseOrNull(text));
        lease.shadow = std::move(text);
        if (change.isNull()) continue;
        ByteWriter w = begin(ToServer::RowPatch);
        w.str(entry.first);
        w.u32(lease.id);
        w.u32(lease.nextSeq);
        w.blob(change.dump(0));
        gwSend(lease.slot, w);
        lease.pending.emplace_back(lease.nextSeq++, std::move(change));
    }
}

void GameServer::gwTakeRow(const std::string& userId, std::uint32_t id, int slot,
                           std::uint32_t ack, std::string row) {
    Gateway& g = *gateway_;
    const auto found = g.leases.find(userId);
    if (found == g.leases.end() || found->second.id != id || found->second.slot != slot) return;
    // Anything this side changed since it last looked is an edit to send, and
    // has to be one before the row it was made to is replaced.
    gwPassEdits();
    // An admin deleted the account while its flower was out.
    if (std::as_const(database_).findUserById(userId) == nullptr) return;
    Gateway::Lease& lease = found->second;
    while (!lease.pending.empty() && lease.pending.front().first <= ack) lease.pending.pop_front();
    if (!lease.pending.empty()) {
        // Written before the server had taken these: put back on top, so the
        // row here is never without an edit its player was shown.
        Json value = Json::parseOrNull(row);
        for (const auto& pending : lease.pending) applyRowDifference(value, pending.second);
        row = playerRecordText(parsePlayerRecord(value));
    }
    lease.shadow = row;
    database_.putProgressText(userId, std::move(row), true);
    lease.version = database_.progressVersion(userId);
}

void GameServer::gwLeaseReturned(int slot, ByteReader& reader) {
    Gateway& g = *gateway_;
    const std::uint64_t seq = reader.u64();
    const net::ConnectionId client = reader.u32();
    const std::string userId = reader.str();
    const std::uint32_t id = reader.u32();
    const std::uint32_t ack = reader.u32();
    std::string row = reader.blob();
    const std::uint32_t revision = reader.u32();
    const double oracle = reader.f64();
    const double trader = reader.f64();
    const bool onward = reader.boolean();
    FlowerState state;
    if (onward) state = FlowerState::read(reader);
    const auto found = g.leases.find(userId);
    if (!reader.ok() || found == g.leases.end() || found->second.id != id ||
        found->second.slot != slot) {
        return;
    }
    gwTakeRow(userId, id, slot, ack, std::move(row));
    gwNoteTaken(slot, seq);
    const net::ConnectionId holder = found->second.client;
    g.leases.erase(found);
    oracleReadyAt_[userId] = clockMillis_ + oracle;
    traderReadyAt_[userId] = clockMillis_ + trader;

    Session* session = sessionFor(client);
    if (session != nullptr && holder == client && session->elsewhere.slot == slot) {
        Session::Elsewhere& e = session->elsewhere;
        e.slot = 0;
        e.lease = 0;
        e.state = cluster::ClientState{};
        session->profileRevision = revision;
        session->profileShadow = Session::ProfileShadow{};
        session->trialFloor = 0;
        if (onward) {
            e.entering = std::make_unique<FlowerState>(std::move(state));
            e.enteringSinceMillis = monotonicMillis();
        } else {
            // Out of the world: back to the title screen, which is this
            // server's to show.
            gwRedirect(*session, 0);
        }
    }
    // Whoever of this account was waiting for the row to come home.
    for (auto& entry : sessions_) {
        if (entry.second.authenticated() && entry.second.userId == userId) gwDispatch(entry.second);
    }
}

void GameServer::gwTable(int slot, const std::string& key, const std::string& text) {
    Json value = Json::parseOrNull(text);
    if (!value.isObject()) return;
    bool found = false;
    const Realm hel = worldMaps_.realmOfId("hel", found);
    if (key == "bossClocks") {
        // One row per biome, and each is the business of that biome's server.
        Json& table = database_.rawTable(key);
        for (const std::string& biome : value.keys()) {
            for (const Gateway::Biome& b : gateway_->biomes) {
                if (b.name == biome && b.slot == slot) table[biome] = value[biome];
            }
        }
        database_.markDirty();
    } else if ((key == "sacrificeSpawn" && found && gwSlotOfRealm(hel) == slot) ||
               ((key == "adminArena" || key == "adminEvents") &&
                gwSlotOfRealm(kAdminArenaRealm) == slot)) {
        database_.putTable(key, std::move(value), true);
    }
}

// ---------------------------------------------------------------------------
// Which server has which biome
// ---------------------------------------------------------------------------

void GameServer::gwHost(std::size_t at, int slot) {
    Gateway& g = *gateway_;
    Gateway::Biome& biome = g.biomes[at];
    for (const char* key : kBiomeTables) {
        const Json& table = database_.storedTable(key);
        if (table.isNull()) continue;
        ByteWriter t = begin(ToServer::Table);
        t.str(key);
        t.blob(table.dump(0));
        gwSend(slot, t);
    }
    ByteWriter w = begin(ToServer::Host);
    w.str(biome.name);
    w.u8(static_cast<std::uint8_t>(biome.realms.size()));
    for (const Realm realm : biome.realms) w.u8(static_cast<std::uint8_t>(realm));
    w.blob(biome.drops);
    gwSend(slot, w);
    biome.slot = slot;
    biome.handingOver = false;
    biome.next = 0;
    biome.drops.clear();
    g.reachableChanged = true;
    if (const Gateway::Server* server = g.bySlot(slot)) {
        std::printf("[cluster] %s -> %s\n", biome.name.c_str(), server->name.c_str());
    }
}

void GameServer::gwHandOver(std::size_t at, int toSlot) {
    Gateway& g = *gateway_;
    Gateway::Biome& biome = g.biomes[at];
    biome.handingOver = true;
    biome.next = toSlot;
    g.lastMoveMillis = monotonicMillis();
    ByteWriter w = begin(ToServer::Release);
    w.str(biome.name);
    gwSend(biome.slot, w);
}

void GameServer::gwPlace(double nowMillis) {
    Gateway& g = *gateway_;
    std::vector<int> slots;
    std::vector<cluster::ServerLoad> servers;
    int connected = 0;
    bool settling = false;
    for (const auto& entry : g.servers) {
        const Gateway::Server& server = entry.second;
        if (server.slot == 0 || server.leaving) continue;
        ++connected;
        // Only a server the players sent there can reach: one whose domain is
        // still being looked at is given nothing in the first deal.
        if (!gwPlaceable(server.slot)) continue;
        if (!g.placedOnce && server.reach == Gateway::Reach::Checking) {
            settling = true;
            continue;
        }
        slots.push_back(server.slot);
        servers.push_back({true, server.stats.tickMillis});
    }
    if (slots.empty()) return;
    // The gateway's own simulation, alone where players can reach: every
    // biome goes on there rather than one staying shut.
    if (slots.size() == 1 && g.simulation != nullptr && g.simulation->shardSlot() == slots[0] && connected > 1) {
        servers[0].takesAll = true;
    }
    if (!g.placedOnce) {
        // The first deal waits for the hands it was told to expect: dealt to
        // the first server to connect, the rest would have to be moved off it
        // again a second later.
        const bool enough = connected >= std::max(2, config_.expectedShards) && !settling;
        if (!enough && nowMillis - g.startedMillis < kPlacementPatienceMillis) return;
        g.placedOnce = true;
    }
    // A biome on a server players can no longer reach goes to one they can:
    // the gateway's own simulation, if it is the only one.
    for (std::size_t i = 0; i < g.biomes.size(); ++i) {
        Gateway::Biome& biome = g.biomes[i];
        if (biome.slot == 0 || biome.handingOver) continue;
        if (std::find(slots.begin(), slots.end(), biome.slot) != slots.end()) continue;
        const Gateway::Server* holder = g.bySlot(biome.slot);
        if (holder == nullptr || holder->leaving) continue;
        std::printf("[cluster] %s leaves %s, which players cannot reach\n", biome.name.c_str(),
                    holder->name.c_str());
        gwHandOver(i, 0);
    }
    const auto indexOf = [&](int slot) {
        const auto at = std::find(slots.begin(), slots.end(), slot);
        return at == slots.end() ? -1 : static_cast<int>(at - slots.begin());
    };
    const auto loads = [&] {
        std::vector<cluster::BiomeLoad> biomes;
        for (const Gateway::Biome& biome : g.biomes) {
            cluster::BiomeLoad load;
            load.server = indexOf(biome.handingOver && biome.next != 0 ? biome.next : biome.slot);
            load.cost = biome.cost;
            load.humans = biome.humans;
            load.pinned = biome.handingOver || biome.boss;
            if (const Gateway::Server* home = g.byName(biome.home)) load.home = indexOf(home->slot);
            biomes.push_back(load);
        }
        return biomes;
    };
    for (const cluster::Move& move : cluster::placeOrphans(loads(), servers)) {
        const auto biome = static_cast<std::size_t>(move.biome);
        if (g.biomes[biome].handingOver) continue;
        gwHost(biome, slots[static_cast<std::size_t>(move.to)]);
    }
    for (const cluster::Move& move : cluster::homecomings(loads(), servers)) {
        gwHandOver(static_cast<std::size_t>(move.biome), slots[static_cast<std::size_t>(move.to)]);
    }
    if (!g.balance || nowMillis < g.nextBalanceMillis) return;
    g.nextBalanceMillis = nowMillis + kBalanceIntervalMillis;
    if (nowMillis - g.lastMoveMillis < kMoveSettleMillis) return;
    const cluster::Move move = cluster::rebalance(loads(), servers);
    if (move.biome < 0) return;
    const auto biome = static_cast<std::size_t>(move.biome);
    std::printf("[cluster] balancing: %s moves\n", g.biomes[biome].name.c_str());
    gwHandOver(biome, slots[static_cast<std::size_t>(move.to)]);
}

void GameServer::gwTellReachable() {
    Gateway& g = *gateway_;
    if (!g.reachableChanged) return;
    g.reachableChanged = false;
    ByteWriter w = begin(ToServer::Reachable);
    for (std::size_t i = 0; i < static_cast<std::size_t>(kMaxRealms); ++i) {
        const int at = g.biomeOf[i];
        const bool open = at < 0 || g.biomes[static_cast<std::size_t>(at)].slot != 0 ||
                          g.biomes[static_cast<std::size_t>(at)].handingOver;
        w.boolean(open);
    }
    for (const auto& entry : g.servers) {
        if (entry.second.slot != 0) gwSend(entry.second.slot, w);
    }
}

void GameServer::gwRestartServers() {
    const ByteWriter w = begin(ToServer::Restart);
    for (const auto& entry : gateway_->servers) {
        if (entry.second.slot != 0) gwSend(entry.second.slot, w);
    }
}

void GameServer::gwTick(double) {
    Gateway& g = *gateway_;
    const double now = monotonicMillis();
    if (now >= g.nextHeartbeatMillis) {
        g.nextHeartbeatMillis = now + cluster::kLinkHeartbeatMillis;
        ByteWriter beat = begin(ToServer::Heartbeat);
        for (auto& entry : g.servers) {
            net::Connection* link = g.door.find(entry.first);
            if (link == nullptr) continue;
            if (entry.second.slot != 0) gwSend(entry.second.slot, beat);
            if (now - entry.second.lastHeardMillis > cluster::kLinkSilenceMillis) {
                link->closeGracefully();
            }
        }
    }
    gwServiceDisband(now);
    gwServiceReach(now);
    gwPlace(now);
    gwTellReachable();
    gwServiceCopies(now);
    // A client sent somewhere that never turned up there.
    std::vector<net::ConnectionId> lost;
    for (const auto& entry : sessions_) {
        const double since = entry.second.elsewhere.transitSinceMillis;
        if (since > 0 && now - since > cluster::kAttachPatienceMillis) lost.push_back(entry.first);
    }
    for (const net::ConnectionId id : lost) gwDropClient(id);
    std::vector<net::ConnectionId> waiting;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        // What changed about a client since each server was told: a name, a
        // lent console, the biome it is in.
        for (const auto& told : std::map<int, std::vector<std::byte>>(session.elsewhere.told)) {
            gwAttach(session, told.first);
        }
        if (session.elsewhere.entering != nullptr) waiting.push_back(entry.first);
    }
    for (const net::ConnectionId id : waiting) {
        if (Session* session = sessionFor(id)) gwDispatch(*session);
    }
    // A kill or a pickup credited to somebody on the title screen: what a
    // snapshot tick would have sent, and the gateway has none.
    sendDueProfiles();
    gwFlush();
}

// ---------------------------------------------------------------------------
// Asked about from outside
// ---------------------------------------------------------------------------

std::string GameServer::serverOfBiome(const std::string& biome) const {
    if (!gateway_) return {};
    for (const Gateway::Biome& b : gateway_->biomes) {
        if (b.name != biome || b.slot == 0 || b.handingOver) continue;
        const Gateway::Server* server = gateway_->bySlot(b.slot);
        return server != nullptr ? server->name : std::string();
    }
    return {};
}

int GameServer::slotOf(const std::string& name) const {
    if (!gateway_) return 0;
    const Gateway::Server* server = const_cast<Gateway&>(*gateway_).byName(name);
    return server != nullptr ? server->slot : 0;
}

std::vector<std::string> GameServer::biomeNames() const {
    std::vector<std::string> names;
    if (gateway_) {
        for (const Gateway::Biome& b : gateway_->biomes) names.push_back(b.name);
    }
    return names;
}

std::size_t GameServer::leaseCount() const { return gateway_ ? gateway_->leases.size() : 0; }

bool GameServer::moveBiome(const std::string& biome, const std::string& to, std::string& why) {
    if (!gateway_) {
        why = "This is not a sharded game.";
        return false;
    }
    Gateway& g = *gateway_;
    const Gateway::Server* target = g.byName(to);
    const int slot = target != nullptr ? target->slot : 0;
    if (slot == 0) {
        why = "No server called \"" + to + "\" is connected.";
        return false;
    }
    int carried = 0;
    for (const Gateway::Biome& b : g.biomes) {
        if ((b.handingOver && b.next != 0 ? b.next : b.slot) == slot) ++carried;
    }
    for (std::size_t i = 0; i < g.biomes.size(); ++i) {
        Gateway::Biome& b = g.biomes[i];
        if (b.name != biome) continue;
        if (b.handingOver) {
            why = biome + " is already being handed over.";
        } else if (b.slot == slot) {
            why = biome + " is already on " + to + ".";
        } else if (carried + 1 >= static_cast<int>(g.biomes.size())) {
            why = "No server may be given every biome.";
        } else if (b.slot == 0) {
            gwHost(i, slot);
            return true;
        } else {
            gwHandOver(i, slot);
            return true;
        }
        return false;
    }
    why = "There is no biome called \"" + biome + "\".";
    return false;
}

// ---------------------------------------------------------------------------
// The distribution an admin asked for
// ---------------------------------------------------------------------------
//
// Kept in the database's `cluster` table, so it outlives every server in it
// and is copied with everything else: `assign` is biome -> server name, and
// `balance` is false while nothing is to be moved for the load's sake.

GameServer::Gateway::Server* GameServer::Gateway::byName(const std::string& name) {
    if (name.empty()) return nullptr;
    for (auto& entry : servers) {
        if (entry.second.slot != 0 && lowerCase(entry.second.name) == lowerCase(name)) {
            return &entry.second;
        }
    }
    return nullptr;
}

void GameServer::gwReadDistribution() {
    const Json& table = std::as_const(database_).storedTable("cluster");
    gateway_->balance = !table["balance"].isBool() || table["balance"].asBool();
    for (Gateway::Biome& biome : gateway_->biomes) {
        biome.home = table["assign"][biome.name].asString();
    }
}

void GameServer::gwWriteDistribution() {
    Json assign = Json::object();
    for (const Gateway::Biome& biome : gateway_->biomes) {
        if (!biome.home.empty()) assign[biome.name] = Json(biome.home);
    }
    Json& table = database_.rawTable("cluster");
    table["assign"] = std::move(assign);
    table["balance"] = Json(gateway_->balance);
    database_.markDirty();
    gateway_->nextBalanceMillis = 0;
}

bool GameServer::assignBiomes(const std::vector<std::string>& biomes, const std::string& to,
                              std::string& why) {
    if (!gateway_) {
        why = "This is not a sharded game.";
        return false;
    }
    Gateway& g = *gateway_;
    std::string name;
    if (!to.empty()) {
        // One that is down may be assigned to: its biomes go home when it is up.
        if (const Gateway::Server* server = g.byName(to)) name = server->name;
        for (const Gateway::Biome& b : g.biomes) {
            if (name.empty() && lowerCase(b.home) == lowerCase(to)) name = b.home;
        }
        if (name.empty()) {
            why = "No server called \"" + to + "\" is connected.";
            return false;
        }
    }
    // Everything or nothing, so a typo in the fifth name moves none of them.
    std::vector<Gateway::Biome*> chosen;
    for (const std::string& biome : biomes) {
        bool found = false;
        for (Gateway::Biome& b : g.biomes) {
            if (b.name != lowerCase(biome) && lowerCase(biome) != "all") continue;
            found = true;
            if (std::find(chosen.begin(), chosen.end(), &b) == chosen.end()) chosen.push_back(&b);
        }
        if (!found) {
            why = "There is no biome called \"" + biome + "\".";
            return false;
        }
    }
    if (!name.empty()) {
        std::size_t homes = 0;
        for (Gateway::Biome& b : g.biomes) {
            if (b.home == name || std::find(chosen.begin(), chosen.end(), &b) != chosen.end()) ++homes;
        }
        if (homes >= g.biomes.size()) {
            why = "No server may be given every biome.";
            return false;
        }
    }
    for (Gateway::Biome* b : chosen) b->home = name;
    gwWriteDistribution();
    return true;
}

void GameServer::runShardsCommand(Session&, net::Connection& connection,
                                  const std::vector<std::string>& words) {
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    if (!gateway_) {
        out("This is not a sharded game. /admin cluster links this server to another.");
        return;
    }
    Gateway& g = *gateway_;
    const std::string sub = words.size() > 1 ? lowerCase(words[1]) : std::string();
    if (sub == "domain") return runDomainCommand(connection, words);
    const auto usage = [&] {
        out("Usage: shards");
        out("  shards assign <server> <biome> [biome...]   keep biomes on a server");
        out("  shards unassign <biome...|all>              let the balance place them");
        out("  shards move <biome> <server>                move one now, without keeping it there");
        out("  shards balance on|off                       move biomes to even the load, or never");
        out("  shards domain [<server>|gateway <host>|none] the hostname players reach it at through Cloudflare");
    };
    const auto joined = [](const std::vector<std::string>& all, std::size_t from) {
        std::string text;
        for (std::size_t i = from; i < all.size(); ++i) text += (i > from ? ", " : "") + lowerCase(all[i]);
        return text;
    };
    std::string why;
    if (sub == "move") {
        if (words.size() != 4) return usage();
        out(moveBiome(lowerCase(words[2]), words[3], why)
                ? "Handing " + lowerCase(words[2]) + " over to " + words[3] + "."
                : why);
        return;
    }
    if (sub == "assign") {
        if (words.size() < 4) return usage();
        const std::vector<std::string> biomes(words.begin() + 3, words.end());
        out(assignBiomes(biomes, words[2], why)
                ? "Assigned " + joined(words, 3) + " to " + words[2] + "."
                : why);
        return;
    }
    if (sub == "unassign") {
        if (words.size() < 3) return usage();
        const std::vector<std::string> biomes(words.begin() + 2, words.end());
        out(assignBiomes(biomes, {}, why) ? "Unassigned " + joined(words, 2) + "." : why);
        return;
    }
    if (sub == "balance" && words.size() == 3 &&
        (lowerCase(words[2]) == "on" || lowerCase(words[2]) == "off")) {
        g.balance = lowerCase(words[2]) == "on";
        gwWriteDistribution();
        out(g.balance ? "Biomes will be moved to even the load."
                      : "Nothing will be moved for the load's sake.");
        return;
    }
    if (!sub.empty()) return usage();
    char line[200];
    for (const auto& entry : g.servers) {
        const Gateway::Server& server = entry.second;
        if (server.slot == 0) continue;
        std::string biomes;
        int humans = 0;
        int held = 0;
        for (const Gateway::Biome& b : g.biomes) {
            if (b.slot != server.slot) continue;
            ++held;
            humans += b.humans;
            biomes += (biomes.empty() ? "" : ", ") + b.name +
                      (b.humans > 0 ? " (" + std::to_string(b.humans) + ")" : std::string()) +
                      (b.home == server.name ? " [assigned]" : "") +
                      (b.handingOver ? " (leaving)" : "");
        }
        std::snprintf(line, sizeof line, "%s: %d biome%s, tick %.1f ms, %d player%s%s",
                      server.name.c_str(), held, held == 1 ? "" : "s", server.stats.tickMillis,
                      humans, humans == 1 ? "" : "s", server.leaving ? ", stopping" : "");
        out(line);
        out("  " + (biomes.empty() ? std::string("no biomes") : biomes));
        out("  database: " + gwCopyState(server.slot));
    }
    std::string orphans;
    for (const Gateway::Biome& b : g.biomes) {
        if (b.slot == 0) orphans += (orphans.empty() ? "" : ", ") + b.name;
    }
    if (!orphans.empty()) out("Waiting for a server: " + orphans);
    std::string away;
    for (const Gateway::Biome& b : g.biomes) {
        if (b.home.empty() || g.byName(b.home) != nullptr) continue;
        away += (away.empty() ? "" : ", ") + b.name + " -> " + b.home;
    }
    if (!away.empty()) out("Assigned to servers that are down: " + away);
    if (!g.balance) out("Balancing is off.");
}

std::string GameServer::biomeBreakdownFromServers() const {
    const Gateway& g = *gateway_;
    std::vector<std::pair<std::string, int>> counts;
    for (const auto& entry : g.servers) {
        for (const cluster::ServerStats::RealmLoad& load : entry.second.stats.realms) {
            if (load.flowers == 0) continue;
            const std::string label = biomeLabel(biomeOfRealm(load.realm));
            if (label.empty()) continue;
            auto at = std::find_if(counts.begin(), counts.end(),
                                   [&](const auto& c) { return c.first == label; });
            if (at == counts.end()) counts.emplace_back(label, load.flowers);
            else at->second += load.flowers;
        }
    }
    if (counts.empty()) return "No players are currently in any biome.";
    std::sort(counts.begin(), counts.end(), [](const auto& a, const auto& b) {
        return a.second != b.second ? a.second > b.second : a.first < b.first;
    });
    std::string rows;
    for (const auto& [label, count] : counts) {
        if (!rows.empty()) rows += "<br/>";
        rows += escapedMarkup(label) + ": " + std::to_string(count);
    }
    return "<span style=\"color: #4fc3f7;\">Most populated biome: <b>" +
           escapedMarkup(counts.front().first) + "</b> (" + std::to_string(counts.front().second) +
           (counts.front().second == 1 ? " player" : " players") + ")</span><br/>" + rows;
}

std::string GameServer::bossTimersFromServers() const {
    const auto label = [](double left) -> std::string {
        if (left <= 0.0) return "ready";
        const long seconds = static_cast<long>(std::ceil(left / 1000.0));
        if (seconds < 3600) {
            return std::to_string(seconds / 60) + "m " + std::to_string(seconds % 60) + "s";
        }
        return std::to_string(seconds / 3600) + "h " + std::to_string(seconds % 3600 / 60) + "m";
    };
    std::string rows;
    for (const auto& entry : gateway_->servers) {
        for (const cluster::ServerStats::BossClock& clock : entry.second.stats.clocks) {
            if (!rows.empty()) rows += "<br/>";
            rows += escapedMarkup(biomeLabel(clock.biome)) + ": eternal " + label(clock.eternalLeft) +
                    ", apex " + label(clock.apexLeft);
        }
    }
    if (rows.empty()) return "No biome clocks yet (the spawner has not run).";
    return "<span style=\"color: #ffb74d;\">Boss cooldowns:</span><br/>" + rows;
}

} // namespace flix
