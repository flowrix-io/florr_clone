#include "server/cluster/host.h"

#include <algorithm>
#include <cstdio>

#include "server/crypto.h"

namespace flix {

using cluster::Membership;

namespace {

/// How long a server that stopped to become another waits for its ports.
constexpr double kRelinkPatienceMillis = 15000.0;
constexpr double kRelinkRetryMillis = 250.0;

} // namespace

bool ServerHost::start(const ServerConfig& config, bool pinned, std::string& errorOut) {
    base_ = config;
    pinned_ = pinned;
    return boot(errorOut);
}

bool ServerHost::boot(std::string& errorOut) {
    ServerConfig config = base_;
    if (!pinned_) {
        config.membershipPath = cluster::membershipPathFor(config.databasePath);
        std::string note;
        config.membership = Membership::load(config.membershipPath, note);
        if (!note.empty()) std::fprintf(stderr, "[cluster] %s\n", note.c_str());
        Membership& m = config.membership;
        if (m.id.empty()) m.id = crypto::secureRandom().hex(8);
        if (m.name.empty()) m.name = "server-" + m.id.substr(0, 4);
        if (m.role == Membership::Role::Gateway) {
            config.role = ServerConfig::Role::Gateway;
            config.clusterSecret = m.key;
            config.clusterPort = m.port;
            // Where the door was: wherever the game itself is served.
            config.clusterHost = config.bindHost;
            config.expectedShards = 2;
            config.simulates = true;
        } else if (m.role == Membership::Role::Shard) {
            config.role = ServerConfig::Role::Shard;
            config.clusterSecret = m.key;
            config.gatewayHost = m.gatewayHost;
            config.gatewayPort = m.gatewayPort;
            config.shardName = m.name;
            config.copyPath = cluster::copyPathFor(config.databasePath);
        }
    }
    const bool simulates = config.simulates && config.role == ServerConfig::Role::Gateway;
    if (simulates) config.maxPollMillis = 1;

    auto server = std::make_unique<GameServer>();
    if (!server->start(config, errorOut)) return false;
    std::unique_ptr<GameServer> simulation;
    if (simulates) {
        ServerConfig own = config;
        own.role = ServerConfig::Role::Shard;
        own.localShard = true;
        own.gatewayHost = config.clusterHost.empty() ? "127.0.0.1" : config.clusterHost;
        own.gatewayPort = config.clusterPort;
        own.shardName = config.membership.name.empty() ? "main" : config.membership.name;
        own.membership = Membership{};
        own.membershipPath.clear();
        own.copyPath.clear();
        // Both wait in their sockets; one after the other, so neither for long.
        own.maxPollMillis = 0;
        own.worldSeed = config.worldSeed ^ 0x5171;
        simulation = std::make_unique<GameServer>();
        if (!simulation->start(own, errorOut)) return false;
    }
    server_ = std::move(server);
    simulation_ = std::move(simulation);
    // Told to stop while there was nothing running to be told.
    if (stopping_) server_->stop();
    return true;
}

bool ServerHost::restart(std::string& errorOut) {
    if (server_) {
        server_->shutdown();
        if (simulation_) simulation_->shutdown();
        // The database's last save is in its destructor, and the next server
        // reads the file: gone before anything starts.
        simulation_.reset();
        server_.reset();
    }
    return boot(errorOut);
}

bool ServerHost::step() {
    if (!server_) {
        const double now = monotonicMillis();
        if (stopping_) return false;
        if (now < nextRetryMillis_) return true;
        std::string error;
        if (boot(error)) {
            retryUntilMillis_ = -1;
            return true;
        }
        if (now < retryUntilMillis_) {
            nextRetryMillis_ = now + kRelinkRetryMillis;
            return true;
        }
        std::fprintf(stderr, "[cluster] could not start again: %s\n", error.c_str());
        exitCode_ = GameServer::kRestartExit;
        return false;
    }

    if (server_->step()) {
        if (simulation_ && !simulation_->step()) {
            // Told to stop, or refused: never for good while the gateway is up.
            std::fprintf(stderr, "[cluster] this server's own simulation stopped\n");
            simulation_.reset();
            exitCode_ = GameServer::kRestartExit;
            server_->stop();
        }
        return true;
    }
    if (!relinking() || stopping_) {
        if (exitCode_ == 0 && !relinking()) exitCode_ = server_->exitCode();
        server_->shutdown();
        if (simulation_) simulation_->shutdown();
        return false;
    }
    std::string error;
    if (!restart(error)) {
        const double now = monotonicMillis();
        retryUntilMillis_ = now + kRelinkPatienceMillis;
        nextRetryMillis_ = now + kRelinkRetryMillis;
    }
    return true;
}

void ServerHost::run() {
    while (step()) {
    }
}

void ServerHost::stop() {
    // From a signal handler: flags only.
    stopping_ = true;
    if (server_) server_->stop();
}

double ServerHost::millisUntilTick() const {
    double wait = server_ ? server_->millisUntilTick() : kRelinkRetryMillis;
    if (simulation_) wait = std::min(wait, simulation_->millisUntilTick());
    return wait;
}

void ServerHost::serviceArrivals() {
    if (server_) server_->serviceArrivals();
    if (simulation_) simulation_->serviceArrivals();
}

void ServerHost::serviceNetwork(int timeoutMillis) {
    if (server_) server_->serviceNetwork(timeoutMillis);
    if (simulation_) simulation_->serviceNetwork(timeoutMillis);
}

void ServerHost::tick(double nowMillis) {
    if (simulation_) simulation_->tick(nowMillis);
    if (simulation_) simulation_->serviceNetwork(0);
    if (server_) server_->tick(nowMillis);
}

} // namespace flix
