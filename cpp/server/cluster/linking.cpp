// Linking one server to another from inside the game: `/admin cluster`.
//
// Two servers that run on their own are given the same key, each by an admin
// of its own, and one is then told to connect to the other. The one dialled
// becomes the cluster's gateway and goes on simulating its share of it; the
// one that dialled becomes a server of it. Neither gives up the game it is
// running until the key has been proven both ways: the server being dialled
// listens for that behind its own port (Door), and the one dialling asks
// first (Probe). cpp/docs/ARCHITECTURE.md, "Sharding".

#include <algorithm>
#include <cstdio>

#include "server/cluster/gateway.h"
#include "server/cluster/link.h"
#include "server/cluster/linking.h"
#include "server/crypto.h"
#include "server/game_server.h"
#include "server/game_server_internal.h"
#include "server/text.h"

namespace flix {

using cluster::Membership;
using cluster::ToGateway;
using cluster::ToServer;

namespace {

constexpr double kProbePatienceMillis = 10000.0;
/// How long a dialler that has proven nothing may keep a socket here.
constexpr double kDoorPatienceMillis = 10000.0;
/// Time for the answer to be gone before the door is.
constexpr double kOpeningMillis = 250.0;
/// How long the servers told to leave are waited for.
constexpr double kDisbandMillis = 5000.0;

ByteWriter begin(ToServer message) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(message));
    return w;
}

} // namespace

// ---------------------------------------------------------------------------
// The door: where a server on its own is dialled
// ---------------------------------------------------------------------------

void GameServer::openDoor() {
    // Whoever was dialling is let go of with it.
    if (door_) {
        for (const auto& entry : door_->diallers) listener_.close(entry.first);
    }
    door_.reset();
    if (config_.membership.key.empty()) return;
    door_ = std::make_unique<Door>(*this);
}

bool GameServer::doorTakes(net::Connection& c) {
    // No key, or too many at once: nothing to say to it.
    if (!door_ || door_->diallers.size() >= Door::kMaxDiallers) {
        c.closeGracefully();
        return false;
    }
    door_->diallers[c.id()].sinceMillis = monotonicMillis();
    return true;
}

void GameServer::doorMessage(net::Connection& c, ByteReader& reader) {
    const auto found = door_->diallers.find(c.id());
    if (found == door_->diallers.end()) return;
    Door::Dialler& dialler = found->second;
    const auto refuse = [&](const std::string& why) {
        std::fprintf(stderr, "[cluster] refused a server from %s: %s\n", c.peer().c_str(), why.c_str());
        ByteWriter w = begin(ToServer::Refused);
        w.str(why);
        c.send(w);
        c.closeGracefully();
    };
    const auto message = static_cast<ToGateway>(reader.u8());
    if (message == ToGateway::Hello && !dialler.greeted) {
        dialler.greeting = cluster::Greeting::read(reader);
        std::string why = dialler.greeting.refusal();
        if (why.empty() && !reader.ok()) why = "malformed greeting";
        if (why.empty() && dialler.greeting.id == config_.membership.id) why = "it is this very server";
        if (!why.empty()) return refuse(why);
        dialler.greeted = true;
        dialler.digest = dialler.greeting.digest();
        dialler.nonce = crypto::secureRandom().hex(16);
        ByteWriter w = begin(ToServer::Challenge);
        w.str(dialler.nonce);
        w.str(cluster::linkProof(config_.membership.key, "gateway", dialler.digest, dialler.nonce));
        c.send(w);
        return;
    }
    if (message != ToGateway::Proof || !dialler.greeted) return refuse("it spoke out of turn");
    const std::string proof = reader.str();
    if (!reader.ok() ||
        !crypto::constantTimeEquals(proof, cluster::linkProof(config_.membership.key, "server",
                                                              dialler.nonce, dialler.digest))) {
        return refuse("its cluster key is not ours");
    }
    cluster::LinkCipher cipher;
    cipher.start(config_.membership.key, dialler.digest, dialler.nonce, true);
    if (!dialler.greeting.probe && door_->openingAtMillis >= 0) {
        // Too soon: the one that is joining, back before the gateway it was
        // promised. Not told anything, so that it dials again.
        c.closeGracefully();
        return;
    }
    if (!dialler.greeting.probe) {
        // A server of a cluster this one has since disbanded.
        c.send(cipher.seal(begin(ToServer::Leave)));
        c.closeGracefully();
        return;
    }
    c.send(cipher.seal(begin(ToServer::Ready)));
    c.closeGracefully();
    std::printf("[cluster] a server from %s is joining: becoming a gateway\n", c.peer().c_str());
    door_->openingAtMillis = monotonicMillis() + kOpeningMillis;
}

// ---------------------------------------------------------------------------
// The probe: asking to join, from a server on its own
// ---------------------------------------------------------------------------

cluster::Greeting GameServer::linkGreeting() const {
    cluster::Greeting g;
    g.linkVersion = cluster::kLinkVersion;
    g.protocol = net::kProtocolVersion;
    g.contentHash = content().contentHash();
    g.name = config_.shardName.empty() ? config_.membership.name : config_.shardName;
    g.id = config_.membership.id;
    g.nonce = crypto::secureRandom().hex(16);
    return g;
}

void GameServer::probeOpened() {
    Probe& p = *probe_;
    p.greeting = linkGreeting();
    p.greeting.name = p.wanted.name;
    p.greeting.probe = true;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(ToGateway::Hello));
    p.greeting.write(w);
    p.dialer.send(w);
}

void GameServer::probeMessage(ByteReader& frame) {
    Probe& p = *probe_;
    std::vector<std::byte> plain;
    if (!p.cipher.open(frame.rest(), frame.remaining(), plain)) {
        p.verdict = "its answer does not open";
        return;
    }
    ByteReader reader(plain);
    const auto message = static_cast<ToServer>(reader.u8());
    if (message == ToServer::Refused) {
        p.verdict = "it refused: " + reader.str();
    } else if (message == ToServer::Challenge && !p.cipher.started()) {
        const std::string nonce = reader.str();
        const std::string proof = reader.str();
        const std::string digest = p.greeting.digest();
        if (!reader.ok() ||
            !crypto::constantTimeEquals(proof, cluster::linkProof(config_.membership.key, "gateway",
                                                                  digest, nonce))) {
            p.verdict = "its key is not this server's key";
            return;
        }
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(ToGateway::Proof));
        w.str(cluster::linkProof(config_.membership.key, "server", nonce, digest));
        p.dialer.send(w);
        p.cipher.start(config_.membership.key, digest, nonce, false);
    } else if (message == ToServer::Ready && p.cipher.started()) {
        p.ready = true;
    }
}

void GameServer::probeEnded(std::string why) {
    const net::ConnectionId admin = probe_->admin;
    const Membership wanted = probe_->wanted;
    const bool ready = probe_->ready;
    probe_.reset();
    net::Connection* connection = listener_.find(admin);
    std::string error = why;
    if (ready) {
        Membership m = wanted;
        m.role = Membership::Role::Shard;
        if (relink(std::move(m), error)) {
            cluster::retireCopy(config_.databasePath);
            broadcastChat(net::ChatChannel::System, "System",
                          "This server is joining another. Reconnecting shortly...");
            flushNetwork();
            return;
        }
    }
    std::printf("[cluster] not linked to %s:%u: %s\n", wanted.gatewayHost.c_str(),
                static_cast<unsigned>(wanted.gatewayPort), error.c_str());
    if (connection != nullptr) {
        sendSystem(*connection, escapedMarkup("Not linked to " + wanted.gatewayHost + ":" +
                                              std::to_string(wanted.gatewayPort) + ": " + error));
    }
}

// ---------------------------------------------------------------------------
// Once a tick, and becoming something else
// ---------------------------------------------------------------------------

void GameServer::serviceLinking() {
    const double now = monotonicMillis();
    if (probe_) {
        probe_->dialer.poll(*probe_, 0);
        Probe& p = *probe_;
        if (!p.ready && p.verdict.empty() && p.dialer.state() == net::Dialer::State::Failed) {
            p.verdict = p.dialer.error().empty() ? "could not connect" : p.dialer.error();
        }
        if (!p.ready && p.verdict.empty() && now > p.untilMillis) p.verdict = "no answer";
        if (p.ready || !p.verdict.empty()) probeEnded(p.verdict);
    }
    if (!door_) return;
    for (const auto& [id, dialler] : door_->diallers) {
        if (now - dialler.sinceMillis > kDoorPatienceMillis) listener_.close(id);
    }
    if (door_->openingAtMillis < 0 || now < door_->openingAtMillis) return;
    door_->openingAtMillis = -1;
    Membership m = config_.membership;
    m.role = Membership::Role::Gateway;
    std::string error;
    if (!relink(std::move(m), error)) {
        std::fprintf(stderr, "[cluster] could not become a gateway: %s\n", error.c_str());
        return;
    }
    broadcastChat(net::ChatChannel::System, "System",
                  "Another server is joining this one. Reconnecting shortly...");
    flushNetwork();
}

bool GameServer::relink(Membership membership, std::string& errorOut) {
    if (exitCode_ == kRelinkExit) {
        errorOut = "already being linked";
        return false;
    }
    if (!membership.save(config_.membershipPath, errorOut)) return false;
    exitCode_ = kRelinkExit;
    stop();
    return true;
}

void GameServer::gwServiceDisband(double now) {
    Gateway& g = *gateway_;
    if (g.disbandAtMillis < 0) return;
    if (g.remoteServers() > 0 && now < g.disbandAtMillis) return;
    g.disbandAtMillis = -1;
    Membership m = config_.membership;
    m.role = Membership::Role::Alone;
    std::string error;
    if (!relink(std::move(m), error)) {
        std::fprintf(stderr, "[cluster] could not disband: %s\n", error.c_str());
        return;
    }
    broadcastChat(net::ChatChannel::System, "System",
                  "This server is on its own again. Reconnecting shortly...");
    flushNetwork();
}

void GameServer::gwUpdateServers(double restartDelayMillis) {
    ByteWriter w = begin(ToServer::Update);
    w.f64(restartDelayMillis);
    for (const auto& entry : gateway_->servers) {
        if (entry.second.slot != 0 && !entry.second.greeting.local) gwSend(entry.second.slot, w);
    }
}

std::vector<std::string> GameServer::serverNames() const {
    std::vector<std::string> names;
    if (gateway_) {
        for (const auto& entry : gateway_->servers) {
            if (entry.second.slot != 0) names.push_back(entry.second.name);
        }
    }
    std::sort(names.begin(), names.end());
    return names;
}

// ---------------------------------------------------------------------------
// `/admin cluster`
// ---------------------------------------------------------------------------

void GameServer::runClusterCommand(Session& session, net::Connection& connection,
                                   const std::vector<std::string>& words) {
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    const std::string sub = words.size() > 1 ? lowerCase(words[1]) : std::string();
    Membership& mine = config_.membership;
    const bool alone = config_.role == ServerConfig::Role::Alone;

    if (sub.empty()) {
        if (gateway_) {
            out("This server is a cluster's gateway, with " +
                std::to_string(gateway_->remoteServers()) + " other server" +
                (gateway_->remoteServers() == 1 ? "" : "s") + " linked:");
            runShardsCommand(session, connection, {"shards"});
        } else if (mine.key.empty()) {
            out("This server is on its own and has no key. /admin cluster help");
        } else {
            out("This server is on its own, has a key, and can be linked to at its game port, " +
                std::to_string(config_.port) + ".");
        }
        return;
    }
    if (sub == "help") {
        out("cluster                              how this server is linked");
        out("cluster key <key>                    set the key (the same on both servers)");
        out("cluster key new                      make one up, and show it to you");
        out("cluster key off                      forget it: nothing can link to this server");
        out("cluster connect <host[:port]> [name] join the server there, as [name]");
        out("cluster disconnect <server|all>      undo it, from the server that was joined");
        out("shards                               which server has which biome, and changing it");
        return;
    }

    // Whoever is told the key has the accounts. An account's own standing, and
    // the one that may replace the server: never a console lent for a life.
    if (!session.admin) {
        out("Only an admin account can link servers, not a temporary grant.");
        return;
    }
    if (config_.membershipPath.empty()) {
        out("This server's part in a cluster was set on its command line (--role).");
        return;
    }

    if (sub == "key") {
        if (!alone) {
            out("The key is in use. /admin cluster disconnect all first.");
            return;
        }
        if (probe_) {
            out("Still connecting. Try again in a moment.");
            return;
        }
        if (words.size() == 4) {
            out("Servers link on the game's own port now: cluster key <key>|new|off");
            return;
        }
        if (words.size() != 3) {
            out("Usage: cluster key <key>|new|off");
            return;
        }
        Membership m = mine;
        const bool off = lowerCase(words[2]) == "off";
        const bool made = lowerCase(words[2]) == "new";
        m.key = off ? std::string() : made ? crypto::secureRandom().hex(24) : words[2];
        if (!off && m.key.size() < cluster::kMinLinkKey) {
            out("A key is at least " + std::to_string(cluster::kMinLinkKey) +
                " characters. \"cluster key new\" makes a good one.");
            return;
        }
        if (m.id.empty()) m.id = crypto::secureRandom().hex(8);
        if (m.name.empty()) m.name = "server-" + m.id.substr(0, 4);
        std::string error;
        if (!m.save(config_.membershipPath, error)) {
            out("The key was not kept: " + error);
            return;
        }
        mine = m;
        openDoor();
        if (off) {
            out("This server has no key now: nothing can link to it.");
            return;
        }
        // To this connection and nowhere else: not the log, not the backlog.
        if (made) out("The key is " + m.key + " -- set it on the other server too.");
        else out("Key set.");
        out("Other servers with it can connect here, at this server's game port, " +
            std::to_string(config_.port) + ".");
        return;
    }

    if (sub == "connect") {
        if (!alone) {
            out("This server is in a cluster already.");
            return;
        }
        if (mine.key.empty()) {
            out("Set the key first: cluster key <key>, the same on both servers.");
            return;
        }
        if (probe_) {
            out("Already connecting to " + probe_->wanted.gatewayHost + ".");
            return;
        }
        Membership m = mine;
        // The other server's game port: by default the one this server's is.
        m.gatewayPort = config_.port;
        if (words.size() < 3 || words.size() > 4 ||
            !cluster::parseAddress(words[2], m.gatewayHost, m.gatewayPort)) {
            out("Usage: cluster connect <host[:port]> [name]");
            return;
        }
        if (words.size() == 4) m.name = sanitizePlayerName(words[3]);
        probe_ = std::make_unique<Probe>(*this);
        probe_->wanted = m;
        probe_->admin = connection.id();
        probe_->untilMillis = monotonicMillis() + kProbePatienceMillis;
        std::string error;
        if (!probe_->dialer.connect(m.gatewayHost, m.gatewayPort, error)) {
            probe_.reset();
            out("Not linked: " + error);
            return;
        }
        out("Connecting to " + m.gatewayHost + ":" + std::to_string(m.gatewayPort) +
            ". While linked, players here use the accounts there; this server's own are kept, "
            "and come back when it is disconnected.");
        return;
    }

    if (sub == "disconnect") {
        if (!gateway_) {
            out(alone ? "This server is on its own." : "Disconnect it from the server it joined.");
            return;
        }
        if (words.size() != 3) {
            out("Usage: cluster disconnect <server|all>");
            return;
        }
        const bool all = lowerCase(words[2]) == "all";
        const Gateway::Server* one = all ? nullptr : gateway_->byName(words[2]);
        if (!all && one == nullptr) {
            out("No server called \"" + words[2] + "\" is connected.");
            return;
        }
        if (one != nullptr && one->greeting.local) {
            out("That is this server. \"cluster disconnect all\" makes it a server of one.");
            return;
        }
        for (const auto& entry : gateway_->servers) {
            const Gateway::Server& server = entry.second;
            if (server.slot == 0 || server.greeting.local || (!all && &server != one)) continue;
            gwSend(server.slot, begin(ToServer::Leave));
        }
        // The last one out takes the cluster with it.
        const bool disband = all || gateway_->remoteServers() <= 1;
        if (disband) gateway_->disbandAtMillis = monotonicMillis() + kDisbandMillis;
        out(disband ? "Disconnecting. This server will be on its own."
                    : "Disconnecting " + words[2] + ".");
        return;
    }
    out("Unknown. /admin cluster help");
}

} // namespace flix
