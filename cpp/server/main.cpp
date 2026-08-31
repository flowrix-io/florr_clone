// The game server. Headless: it draws nothing and opens no window.

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "server/game_server.h"

namespace {

flr::GameServer* g_server = nullptr;

void onSignal(int) {
    // Only an atomic flag is stored here; flushing the database and telling
    // clients happens on the main thread, where it is safe to do.
    if (g_server) g_server->stop();
}

void usage(const char* program) {
    std::printf(
        "usage: %s [options]\n"
        "  --port <number>    listen port (default 4242)\n"
        "  --data <dir>       directory holding mobs.json and petals.json (default data)\n"
        "  --db <path>        account database (default inventory.json)\n"
        "  --seed <number>    world generation seed\n"
        "  --max-players <n>  connection limit\n",
        program);
}

} // namespace

int main(int argc, char** argv) {
    flr::ServerConfig config;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        const auto next = [&](const char* name) -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "%s needs a value\n", name);
                std::exit(2);
            }
            return argv[++i];
        };
        if (arg == "--port") config.port = static_cast<std::uint16_t>(std::atoi(next("--port")));
        else if (arg == "--data") config.dataDir = next("--data");
        else if (arg == "--db") config.databasePath = next("--db");
        else if (arg == "--seed") config.worldSeed = std::strtoull(next("--seed"), nullptr, 10);
        else if (arg == "--max-players") config.maxPlayers = static_cast<std::size_t>(std::atoi(next("--max-players")));
        else if (arg == "--help" || arg == "-h") { usage(argv[0]); return 0; }
        else {
            std::fprintf(stderr, "unknown option: %s\n", arg.c_str());
            usage(argv[0]);
            return 2;
        }
    }

    flr::GameServer server;
    std::string error;
    if (!server.start(config, error)) {
        std::fprintf(stderr, "could not start: %s\n", error.c_str());
        return 1;
    }

    // A write to a closed socket must not take the process down; the transport
    // reports the failure and drops that one connection instead.
    std::signal(SIGPIPE, SIG_IGN);

    g_server = &server;
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);

    std::printf("listening on port %u\n", static_cast<unsigned>(config.port));
    server.run();
    std::printf("shut down cleanly\n");
    return 0;
}
