#pragma once
// One process's servers, whatever it is told to be.
//
// A GameServer is one thing for as long as it runs: alone, a cluster's gateway
// or a server of one. `/admin cluster` changes which, so something has to
// outlive it -- stop the one there is, read what the membership file now says,
// and start the next. It also runs the gateway's own simulation beside it: two
// servers linked are a gateway and TWO servers with biomes to share, not one
// machine left doing nothing but passing frames.

#include <atomic>
#include <memory>
#include <string>

#include "server/game_server.h"

namespace flix {

class ServerHost {
public:
    /// Starts what `config` and the membership file beside its database make
    /// this server. `pinned` is a role given on the command line: the file is
    /// not read, and no command changes it.
    bool start(const ServerConfig& config, bool pinned, std::string& errorOut);

    /// One pass, as GameServer::step. False once it has stopped for good and
    /// shut down.
    bool step();
    void run();
    void stop();
    double millisUntilTick() const;
    void serviceArrivals();
    int exitCode() const { return exitCode_; }

    /// The server clients speak to. Null only between one being shut down and
    /// the next started.
    GameServer* server() { return server_.get(); }
    /// The gateway's own simulation, or null.
    GameServer* simulation() { return simulation_.get(); }

    /// step()'s two halves, for a test with a clock of its own.
    void serviceNetwork(int timeoutMillis);
    void tick(double nowMillis);
    /// Whether the server has stopped to become something else, which the next
    /// step() does.
    bool relinking() const { return server_ && server_->exitCode() == GameServer::kRelinkExit; }
    /// Finishes the one there is and starts the next. False, to be called
    /// again, while a port it needs is still held.
    bool restart(std::string& errorOut);

private:
    bool boot(std::string& errorOut);
    /// The gateway's own simulation, from gatewayConfig_: at boot for
    /// --simulate, or later, when a server the gateway would use cannot be
    /// reached (GameServer::wantsLocalSimulation).
    bool startSimulation(std::unique_ptr<GameServer>& simulation, std::string& errorOut);

    /// The gateway's config as it was started, for its own simulation.
    ServerConfig gatewayConfig_;
    double nextSimulationMillis_ = 0;

    ServerConfig base_;
    bool pinned_ = false;
    std::unique_ptr<GameServer> server_;
    std::unique_ptr<GameServer> simulation_;
    /// Set by a signal handler.
    std::atomic<bool> stopping_{false};
    double retryUntilMillis_ = -1;
    double nextRetryMillis_ = 0;
    int exitCode_ = 0;
};

} // namespace flix
