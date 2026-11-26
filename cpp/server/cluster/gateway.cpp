// The gateway of a sharded game: the accounts, the sockets of clients with no
// flower out, and which server has which biome. See server/cluster/gateway.h and cpp/docs/ARCHITECTURE.md,
// "Sharding".

#include "server/cluster/gateway.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "server/cluster/row_merge.h"
#include "server/crypto.h"
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
    g.listener.bindHost = config_.clusterHost;
    g.listener.maxPendingBytes = cluster::kLinkMaxPending;
    // Never TLS, whatever certificate the game's own port found: the servers
    // dial it plain (see ServerConfig::clusterHost).
    g.listener.certPath = "none";
    g.listener.keyPath = "none";
    gwBuildBiomes();
    gwReadDistribution();
    database_.onRowWritten = [this](Database::Part part, const std::string& key) {
        for (const auto& entry : gateway_->servers) {
            if (!entry.second.copying) continue;
            gateway_->changed[static_cast<std::size_t>(part)].insert(key);
            return;
        }
    };
    // An acknowledgement of a server's rows goes out on the link only behind
    // the journal line that holds them.
    g.listener.beforeWrite = [this] { database_.flushJournal(); };
    if (!g.listener.start(config_.clusterPort, errorOut)) {
        errorOut = "cluster port " + std::to_string(config_.clusterPort) + ": " + errorOut;
        return false;
    }
    // The game's own port. The sessions are adopted connections whose frames
    // go wherever their client's socket is (gwDeliver); what a socket here
    // says is handed to the session it is (gwDoorFrame).
    g.door.certPath = config_.certPath;
    g.door.keyPath = config_.keyPath;
    g.door.webRoot = config_.webRoot;
    g.door.bindHost = config_.bindHost;
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
    std::printf("[cluster] gateway: %zu biomes to place, servers dial %s:%u\n", g.biomes.size(),
                config_.clusterHost.empty() ? "*" : config_.clusterHost.c_str(),
                static_cast<unsigned>(config_.clusterPort));
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

void GameServer::gwService() {
    gateway_->listener.poll(*gateway_, 0);
}

void GameServer::gwFlush() {
    gwPassEdits();
    // What the sessions queued, into the sockets and links it goes out on:
    // after beforeWrite, so behind the journal.
    listener_.flush();
    gateway_->door.flush();
    gateway_->listener.flush();
}

void GameServer::gwSend(int slot, const ByteWriter& message) {
    Gateway::Server* server = gateway_->bySlot(slot);
    if (server == nullptr) return;
    if (net::Connection* link = gateway_->listener.find(server->link)) {
        link->send(server->cipher.seal(message));
    }
}

void GameServer::gwLinkOpened(net::Connection& link) {
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
        server.name = sanitizePlayerName(server.greeting.name);
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
            if (net::Connection* stale = g.listener.find(entry.first)) stale->closeGracefully();
            const int slot = entry.second.slot;
            gwServerLost(slot, entry.second.name);
            break;
        }
        // A name is how an admin says which: one each.
        for (int n = 2; g.byName(server.name) != nullptr; ++n) {
            server.name = sanitizePlayerName(server.greeting.name) + "-" + std::to_string(n);
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
        // Where the link came from is where its clients dial, unless it said
        // otherwise. Not for a server on this machine -- the gateway's own
        // simulation, or one dialling over loopback -- which is wherever the
        // client found the gateway.
        if (server.publicHost.empty() && !server.greeting.local) {
            const std::string host = hostOfPeer(link.peer());
            const bool loopback = host.rfind("127.", 0) == 0 || host == "[::1]" || host == "localhost";
            if (!loopback) server.publicHost = host;
        }
        std::printf("[cluster] %s joined from %s; clients dial it at %s:%u\n", server.name.c_str(),
                    link.peer().c_str(), server.publicHost.empty() ? "(this host)" : server.publicHost.c_str(),
                    static_cast<unsigned>(server.publicPort));
        const Json& taken = std::as_const(database_).storedTable("leaseJournals")[server.journalKey];
        ByteWriter w = begin(ToServer::Welcome);
        w.u8(static_cast<std::uint8_t>(slot));
        w.i64(activeMaze().day());
        w.u64(static_cast<std::uint64_t>(taken.asDouble()));
        // Where a client that dials that server's own port is sent instead.
        w.str(config_.publicHost);
        w.u16(config_.publicPort != 0 ? config_.publicPort : config_.port);
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
        if (server.slot == 0 || server.leaving) continue;
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
    const net::ConnectionId id = listener_.reserveId();
    const std::string address = clientAddress(socket.peer(), socket.forwarded());
    net::Connection& client = listener_.adopt(
        id, socket.peer(), [this, id](const std::byte* data, std::size_t size) { gwDeliver(id, data, size); });
    g.doorOf[socket.id()] = id;
    onConnect(client);
    if (Session* session = sessionFor(id)) {
        session->clientAddress = address;
        session->elsewhere.door = socket.id();
    }
}

void GameServer::gwDoorFrame(net::Connection& socket, ByteReader& reader) {
    Gateway& g = *gateway_;
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

void GameServer::gwDoorClosed(net::Connection& socket) {
    Gateway& g = *gateway_;
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
        redirect.str(server->publicHost);
        redirect.u16(server->publicPort);
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
    for (const auto& entry : g.servers) {
        const Gateway::Server& server = entry.second;
        if (server.slot == 0 || server.leaving) continue;
        slots.push_back(server.slot);
        servers.push_back({true, server.stats.tickMillis});
    }
    if (slots.empty()) return;
    if (!g.placedOnce) {
        // The first deal waits for the hands it was told to expect: dealt to
        // the first server to connect, the rest would have to be moved off it
        // again a second later.
        const bool enough = static_cast<int>(slots.size()) >= std::max(2, config_.expectedShards);
        if (!enough && nowMillis - g.startedMillis < kPlacementPatienceMillis) return;
        g.placedOnce = true;
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
            net::Connection* link = g.listener.find(entry.first);
            if (link == nullptr) continue;
            if (entry.second.slot != 0) gwSend(entry.second.slot, beat);
            if (now - entry.second.lastHeardMillis > cluster::kLinkSilenceMillis) {
                link->closeGracefully();
            }
        }
    }
    gwServiceDisband(now);
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
    const auto usage = [&] {
        out("Usage: shards");
        out("  shards assign <server> <biome> [biome...]   keep biomes on a server");
        out("  shards unassign <biome...|all>              let the balance place them");
        out("  shards move <biome> <server>                move one now, without keeping it there");
        out("  shards balance on|off                       move biomes to even the load, or never");
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
            rows += escapedMarkup(biomeLabel(clock.biome)) + ": unique " + label(clock.uniqueLeft) +
                    ", apex " + label(clock.apexLeft);
        }
    }
    if (rows.empty()) return "No biome clocks yet (the spawner has not run).";
    return "<span style=\"color: #ffb74d;\">Boss cooldowns:</span><br/>" + rows;
}

} // namespace flix
