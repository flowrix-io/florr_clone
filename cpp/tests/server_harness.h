#pragma once
// A real server on loopback, with real clients speaking the real protocol.
//
// Extracted from integration_tests.cpp once a second file needed it. Nothing
// here is a stub: below the socket it is the shipping code path, which is the
// whole point -- a test that mocks the server tests the mock.

#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <functional>
#include <string>
#include <vector>

#include "client/net_client.h"
#include "server/game_server.h"
#include "shared/game/config.h"

namespace flix::testsupport {

inline std::string tempPath(const char* name) {
    return std::string("/tmp/florr-itest-") + name + "-" + std::to_string(::getpid()) + ".json";
}

/// The content directory, found relative to THIS source file rather than to
/// the working directory: the test binary is run from the build tree, from the
/// project root, and from ctest, and all three must work.
inline const std::string& dataDir() {
    static const std::string resolved = [] {
#ifdef FLIX_TEST_DATA_DIR
        {
            const std::string staged = FLIX_TEST_DATA_DIR;
            std::ifstream mapProbe(staged + "/map_bundle.ts", std::ios::binary);
            if (mapProbe) return staged;
        }
#endif
        const std::string here = __FILE__;
        const std::size_t slash = here.find_last_of('/');
        const std::string tests = slash == std::string::npos ? std::string(".") : here.substr(0, slash);
        const std::string candidates[] = {
            tests + "/../build/data",   // staged beside the binaries
            tests + "/../data",         // the checked-in mob_xp.json plus copies
            "data",
        };
        for (const std::string& candidate : candidates) {
            std::ifstream probe(candidate + "/mobs.json", std::ios::binary);
            if (probe) return candidate;
        }
        return std::string("data");
    }();
    return resolved;
}

/// A server on a free port with an empty database, plus the plumbing to step
/// it and its clients forward together.
struct Harness {
    GameServer server;
    std::string dbPath;
    std::uint16_t port = 0;
    bool ready = false;
    double clock = 0;
    /// For tests that need to ask the terrain for a point. Separate from the
    /// server's own stream so a probe cannot shift what the simulation rolls.
    Rng probeRng{0xA11CE};

    /// `seed` runs against the database file BEFORE the server opens it, for
    /// tests that need an account to already own something.
    explicit Harness(const char* dbName,
                     const std::function<void(const std::string&)>& seed = {}) {
        dbPath = tempPath(dbName);
        std::remove(dbPath.c_str());
        if (seed) seed(dbPath);

        ServerConfig config;
        config.dataDir = dataDir();
        config.databasePath = dbPath;
        config.worldSeed = 12345;

        std::string error;
        for (std::uint16_t candidate = 47100; candidate < 47160; ++candidate) {
            config.port = candidate;
            if (server.start(config, error)) { port = candidate; ready = true; break; }
        }
        if (!ready) std::printf("  harness could not start a server: %s\n", error.c_str());
    }

    ~Harness() { std::remove(dbPath.c_str()); }

    /// Advances the simulation by `ticks`, servicing both ends each step.
    ///
    /// The server's socket and its simulation are stepped separately, exactly
    /// as run() interleaves them, so a test sees the same ordering production
    /// does rather than a convenient fiction.
    void step(int ticks, std::vector<NetClient*> clients) {
        for (int i = 0; i < ticks; ++i) {
            for (NetClient* c : clients) c->poll(1);
            server.serviceNetwork(1);
            clock += net::kTickMillis;
            server.tick(clock);
            server.serviceNetwork(0);
            for (NetClient* c : clients) c->poll(1);
        }
    }

    /// Steps until `done` holds or the budget runs out; returns whether it did.
    template <class F>
    bool stepUntil(std::vector<NetClient*> clients, F done, int maxTicks = 400) {
        for (int i = 0; i < maxTicks; ++i) {
            step(1, clients);
            if (done()) return true;
        }
        return false;
    }
};

inline bool connectClient(Harness& h, NetClient& client) {
    client.contentHash = content().contentHash();
    if (!client.connect("127.0.0.1", h.port)) return false;
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Ready; });
}

/// Registers `name` and waits for the account state to arrive.
inline bool loginNew(Harness& h, NetClient& client, const char* name, const char* password) {
    if (!connectClient(h, client)) return false;
    client.requestRegister(name, password);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

} // namespace flix::testsupport
