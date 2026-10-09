// The game server. Headless: it draws nothing and opens no window.
//
// Two builds, one program. Natively it owns its loop and listens on a TCP
// port. Under emscripten it runs on Node, listens for WebSocket -- and, when a
// certificate is configured, WebTransport -- sessions, and hands step() to a
// timer, because blocking the Node event loop is exactly what would stop every
// message from ever being delivered.

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "server/game_server.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace {

#ifndef __EMSCRIPTEN__
flix::GameServer* g_server = nullptr;

void onSignal(int) {
    // Only an atomic flag is stored here; flushing the database and telling
    // clients happens on the main thread, where it is safe to do.
    if (g_server) g_server->stop();
}
#endif

/// The last line the process prints, and the code it leaves behind. A restart
/// exits non-zero deliberately, because that is the one code every supervisor
/// restarts on. pm2's default autorestart would bring the process back after
/// any exit, but systemd's Restart=on-failure -- and pm2 with 0 in its
/// stop_exit_codes -- read exit 0 as "this one was meant to end" and leave the
/// server down, so the exit that is supposed to be followed by a start must
/// not look like a clean shutdown (GameServer::exitCode).
int reportExit(int code) {
    if (code == 0) {
        std::printf("shut down cleanly\n");
    } else {
        std::printf("stopped for restart; exiting with code %d so the supervisor starts us "
                    "again\n",
                    code);
    }
    return code;
}

void usage(const char* program) {
    std::printf(
        "usage: %s [options]\n"
        "  --port <number>    listen port (default 3000)\n"
        "  --data <dir>       the staged content: mobs.json, petals.json,\n"
        "                     mob_drops.json and the maps (default data)\n"
        "  --db <path>        account database (default inventory.json)\n"
        "  --seed <number>    simulation random seed\n"
#ifdef __EMSCRIPTEN__
        "  --cert <path>      TLS certificate. Without it, cert.crt then\n"
        "                     dev-cert.crt are looked for in the working\n"
        "                     directory; https also enables WebTransport\n"
        "  --key <path>       private key for --cert\n"
        "  --web-root <dir>   directory the client is served from (default:\n"
        "                     the build directory this module is in)\n"
#endif
        ,
        program);
}

#ifdef __EMSCRIPTEN__
/// Mounts the real directory holding `databasePath` over the same path in the
/// virtual filesystem, so the accounts file the server reads and writes is an
/// ordinary file on disk. Called before start(), which loads it. Rewrites
/// `databasePath` to the absolute path it resolved to.
///
/// The resolving is the point. Node`s working directory and the emscripten
/// filesystem`s are not the same place: the latter is always `/`, so a
/// relative --db -- and the default is the bare `inventory.json` that
/// `pm2 start server.js` gets -- names a file in memory that has nothing to do
/// with the one on disk of the same name. The server then loads no accounts,
/// saves to nowhere, and says nothing about either, which is how a database
/// comes to look wiped while sitting intact beside the process that is
/// ignoring it.
bool mountDatabaseDirectory(std::string& databasePath, std::string& errorOut) {
    // The caller owns the buffer, as in shared/net/web_channel.cpp: a path or
    // a failure message, and neither is worth exporting malloc for.
    char answer[1024] = {0};
    const int failed = EM_ASM_INT({
        const path = require("path");
        const fs = require("fs");
        const file = path.resolve(UTF8ToString($0));
        const directory = path.dirname(file);
        try {
            // The directory, not the file: --db may name one that does not
            // exist yet, which is an ordinary first run.
            fs.mkdirSync(directory, { recursive: true });
            FS.mkdirTree(directory);
            FS.mount(NODEFS, { root: directory }, directory);
        } catch (e) {
            stringToUTF8(directory + ": " + e, $1, $2);
            return 1;
        }
        stringToUTF8(file, $1, $2);
        return 0;
    }, databasePath.c_str(), answer, static_cast<int>(sizeof answer));

    if (failed) {
        errorOut = "the database directory cannot be reached from the host "
                   "filesystem (" + std::string(answer) + ")";
        return false;
    }
    databasePath = answer;
    return true;
}

/// Mounts the directory the database's backups go in, for the same reason as
/// the database's own, and by the same rule the writer uses
/// (Database::backupDirectoryFor): one level ABOVE the database's directory,
/// so it is not under that mount -- `/home/ubuntu/db_backups` beside
/// `/home/ubuntu/dist`. Left to MEMFS, every snapshot `backup_db` and
/// `update` took said it was saved to a real path and vanished at the next
/// restart, the one `update` takes it for included. Already inside the
/// database's directory -- a database one level below the root, whose backups
/// stay beside it -- it is the host's with no second mount.
///
/// Not fatal: a server without backups still serves its players. But nothing
/// relies on this having worked. Database::backup asks Node whether each
/// snapshot is really on the host's disk and refuses it when not, so a failed
/// mount is a refused `backup_db` and an aborted `update`, said in so many
/// words, and never a phantom. The mount is tried once, here, so the refusals
/// last until a restart finds the directory reachable: putting it right on
/// the host while the server runs mounts nothing.
void mountBackupDirectory(const std::string& databasePath) {
    const std::string backups = flix::Database::backupDirectoryFor(databasePath);
    const std::size_t slash = databasePath.find_last_of('/');
    const std::string directory =
        slash == std::string::npos ? std::string() : databasePath.substr(0, slash);
    if (!directory.empty() && backups.compare(0, directory.size() + 1, directory + "/") == 0) {
        return;
    }
    char answer[1024] = {0};
    const int failed = EM_ASM_INT({
        const fs = require("fs");
        const directory = UTF8ToString($0);
        try {
            fs.mkdirSync(directory, { recursive: true });
            FS.mkdirTree(directory);
            FS.mount(NODEFS, { root: directory }, directory);
        } catch (e) {
            stringToUTF8(directory + ": " + e, $1, $2);
            return 1;
        }
        return 0;
    }, backups.c_str(), answer, static_cast<int>(sizeof answer));
    if (failed) {
        std::fprintf(stderr,
                     "[db] the backup directory cannot be reached from the host filesystem "
                     "(%s); backup_db and update will refuse until the server is restarted "
                     "with it reachable\n",
                     answer);
    }
}

/// Has Node hand SIGINT and SIGTERM to this module instead of dying of them.
///
/// They are what `pm2 stop`, `pm2 restart` and a Ctrl-C send, and the native
/// build catches both with std::signal (onSignal, above). Under Node a C
/// signal handler is never called, and a process with no listener for one of
/// these is simply killed by it -- so the server never reached shutdown(), and
/// whatever its players had done since the last periodic save, up to half a
/// minute of it, went down with the process. The listener only NOTES the
/// signal, the way shared/net/web_channel.cpp's socket callbacks only note what
/// arrived: the main loop reads it on its next pass and makes the same stop()
/// the native handler makes, so the final save is written by the ordinary way
/// out.
EM_JS(void, flix_catch_stop_signals, (), {
    Module.flixStopSignal = "";
    const note = (name) => {
        if (!Module.flixStopSignal) Module.flixStopSignal = name;
    };
    process.on("SIGINT", () => note("SIGINT"));
    process.on("SIGTERM", () => note("SIGTERM"));
});

/// Whether one of those signals has arrived since the listeners went in.
EM_JS(int, flix_stop_signalled, (), { return Module.flixStopSignal ? 1 : 0; });
#endif

} // namespace

int main(int argc, char** argv) {
    // Line-buffer stdout. It is fully buffered by default whenever it is not a
    // terminal, which is every way the server is actually run -- under pm2, in
    // a redirect, in a CI log -- so the map summary and "listening on port"
    // sat in a 4KB buffer until the process exited. A server whose start-up
    // report only appears once it has stopped is a server nobody can check.
    std::setvbuf(stdout, nullptr, _IOLBF, 0);

    flix::ServerConfig config;

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
        else if (arg == "--cert") config.certPath = next("--cert");
        else if (arg == "--key") config.keyPath = next("--key");
        else if (arg == "--web-root") config.webRoot = next("--web-root");
        else if (arg == "--help" || arg == "-h") { usage(argv[0]); return 0; }
        else {
            std::fprintf(stderr, "unknown option: %s\n", arg.c_str());
            usage(argv[0]);
            return 2;
        }
    }

#ifdef __EMSCRIPTEN__
    // The embedded content is in memory and read-only, which is right for it.
    // The database is neither: it has to survive a restart, so the directory
    // it lives in is the real filesystem, mounted at the path the config
    // already names -- and so is the one its backups go in, which is not
    // under it. Everything else stays in MEMFS.
    std::string error;
    // Fatal, where it used to be a warning. Every account on this server is in
    // that one file; starting without it would serve an empty world and then
    // persist nothing, and both halves of that are silent.
    if (!mountDatabaseDirectory(config.databasePath, error)) {
        std::fprintf(stderr, "could not start: %s\n", error.c_str());
        return 1;
    }
    mountBackupDirectory(config.databasePath);

    // Leaked deliberately: main() returns as soon as the timer is armed and
    // the server has to outlive it. Node exiting is this process's exit.
    auto* server = new flix::GameServer();
    if (!server->start(config, error)) {
        std::fprintf(stderr, "could not start: %s\n", error.c_str());
        return 1;
    }
    std::printf("listening on port %u\n", static_cast<unsigned>(config.port));
    // Once the server is up, and before its first pass: a signal before this
    // point has nothing to save, and may end the process the way it always
    // has.
    flix_catch_stop_signals();
    emscripten_set_main_loop_arg(
        [](void* handle) {
            auto* running = static_cast<flix::GameServer*>(handle);
            // A signal becomes the stop() onSignal makes natively, here on the
            // loop's own turn; the step below then returns false and the
            // shutdown is the ordinary one, exit code 0 included. A scheduled
            // restart reaches the same place having set its own code first.
            if (flix_stop_signalled()) running->stop();
            if (running->step()) return;
            running->shutdown();
            emscripten_cancel_main_loop();
            const int code = reportExit(running->exitCode());
            // Node's own exit is this process's exit, reached directly for
            // either code. Cancelling the loop only lets Node run out of work,
            // and that is right for neither: a Node that runs out of work exits
            // 0 -- the one code a restart may not leave behind, because 0 is
            // what tells systemd's on-failure policy, or pm2 with 0 in its
            // stop_exit_codes, to leave the server down -- and nothing promises
            // that it runs out promptly once the listener has closed. After a
            // signal that matters, because the listeners above mean the signal
            // no longer ends the process by itself. It is reached directly
            // rather than through emscripten_force_exit(): with EXIT_RUNTIME
            // off that call still exits with the right code, but warns on the
            // way out that it cannot shut the runtime down, and a line reading
            // "cannot actually shut down" in the log of every restart is a
            // false alarm an operator would have to learn to ignore. Nothing is
            // left to tear down in any case -- shutdown() above has already
            // flushed every account and the database.
            EM_ASM({ process.exit($0); }, code);
        },
        server,
        // 0 lets the runtime pick; on Node that is a timer well above the
        // 30Hz the simulation ticks at, and step() ticks only when one is due.
        0, 0);
    return 0;
#else
    flix::GameServer server;
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
    return reportExit(server.exitCode());
#endif
}
