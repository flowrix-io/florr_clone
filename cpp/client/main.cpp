// The game client.
//
// Native only: every pixel is drawn through cpp_canvas into an SDL window.
// There is no HTML, no CSS and no browser anywhere in this program.

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "client/app.h"

namespace {

void usage(const char* program) {
    std::printf(
        "usage: %s [options]\n"
        "  --host <address>   server to connect to (default 127.0.0.1)\n"
        "  --port <number>    server port (default 4242)\n"
        "  --data <dir>       directory holding mobs.json and petals.json (default data)\n"
        "  --width <px>       window width (default 1280)\n"
        "  --height <px>      window height (default 720)\n"
        "  --user <name>      log in (or register) automatically\n"
        "  --password <pw>    password for --user\n"
        "  --frames <n>       render n frames then exit\n"
        "  --screenshot <f>   write the last frame to f as a PPM\n"
        "  --menu <name>      open a menu on startup: inventory, craft, talents,\n"
        "                     mobgallery, shop, skins, leaderboard, settings\n"
        "  --lobby            log in but stay on the title screen\n"
        "  --login            ignore any stored session and show the login form\n"
        "  --dead             join, then show the death card straight away\n"
        "  --tutorial         join with the onboarding tutorial card up\n"
        "  --stats            show the frame/ping/position counters\n",
        program);
}

} // namespace

int main(int argc, char** argv) {
    flr::AppConfig config;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        const auto next = [&](const char* name) -> const char* {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "%s needs a value\n", name);
                std::exit(2);
            }
            return argv[++i];
        };
        if (arg == "--host") config.host = next("--host");
        else if (arg == "--port") config.port = static_cast<std::uint16_t>(std::atoi(next("--port")));
        else if (arg == "--data") config.dataDir = next("--data");
        else if (arg == "--width") config.windowWidth = std::atoi(next("--width"));
        else if (arg == "--height") config.windowHeight = std::atoi(next("--height"));
        else if (arg == "--screenshot") config.screenshotPath = next("--screenshot");
        else if (arg == "--frames") config.screenshotAfterFrames = std::atoi(next("--frames"));
        else if (arg == "--menu") {
            // Matched against the menu's own label, lowercased and with the
            // spaces taken out, so "mobgallery" reaches "Mob Gallery" without
            // a second table of names to keep in step with the first.
            const auto slug = [](std::string text) {
                std::string out;
                for (const char c : text) {
                    if (c != ' ') out += static_cast<char>(std::tolower(c));
                }
                return out;
            };
            const std::string name = slug(next("--menu"));
            for (int id = 1; id < flr::kMenuCount; ++id) {
                if (slug(flr::menuLabel(static_cast<flr::MenuId>(id))) == name) {
                    config.autoMenu = static_cast<flr::MenuId>(id);
                }
            }
            if (config.autoMenu == flr::MenuId::None) {
                std::fprintf(stderr, "unknown menu: %s\n", name.c_str());
                return 2;
            }
        }
        else if (arg == "--lobby") config.autoJoin = false;
        else if (arg == "--login") config.forceLogin = true;
        else if (arg == "--dead") config.autoDead = true;
        else if (arg == "--tutorial") config.autoTutorial = true;
        else if (arg == "--stats") config.showStats = true;
        else if (arg == "--user") config.autoUsername = next("--user");
        else if (arg == "--password") config.autoPassword = next("--password");
        else if (arg == "--help" || arg == "-h") { usage(argv[0]); return 0; }
        else {
            std::fprintf(stderr, "unknown option: %s\n", arg.c_str());
            usage(argv[0]);
            return 2;
        }
    }

    flr::App app;
    std::string error;
    if (!app.start(config, error)) {
        std::fprintf(stderr, "could not start: %s\n", error.c_str());
        return 1;
    }
    app.run();
    return 0;
}
