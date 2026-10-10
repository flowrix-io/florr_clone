#pragma once

// Running a script in place of the game when the page loads.
//
// The asset browser (Debug > Assets > Boot) can name a JavaScript file for the
// next page load to run INSTEAD of the game: one of the debug tools embedded
// in the wasm under /boot (client/web/boot/), or any .js file the player has
// open. The page reads that choice before it does anything else
// (client/web/shell.html, offline/shell.html), so a tool that never starts the
// game costs nothing, and one that does can set itself up first and then call
// Module.flixBoot.startGame().
//
// The choice is two files in the browser-storage mount (persist.h): the
// script, copied in at the moment it is chosen, and the path it was chosen
// from. Copied rather than referred to, because the page has to run it before
// there is any wasm to read /boot out of -- and storage is the one thing both
// the page and the client can reach. The page reads the two keys directly,
// `<prefix>boot-script` and `<prefix>boot-path`, base64 like everything the
// mount stores.
//
// Two ways out of a script that breaks the page, both read by the page and
// both needing nothing from the client: `?boot=game` skips the script for one
// load, and `?boot=reset` forgets it.

#include <string>

namespace flix::web {

/// The mount's names for the two files. main.cpp and offline/main.cpp mount
/// them beside the session and the settings.
inline constexpr const char* kBootScriptName = "boot-script";
inline constexpr const char* kBootPathName = "boot-path";

/// Where the embedded tools are.
inline constexpr const char* kBootToolDirectory = "/boot";

/// Whether this page reads a boot script at all: both shells do, and say so
/// by installing Module.flixBoot. False natively, where there is no page.
bool bootScriptsSupported();

/// Why a choice cannot be stored, or empty when it can: no page to run one,
/// or no browser storage to keep it in.
std::string bootUnavailableReason();

/// The path of the script this page load ran in place of the game, or empty
/// when it started the game directly.
std::string bootedThrough();

/// What the next page load will run. Empty for the game.
struct BootChoice {
    std::string path;
    std::string source;
    bool empty() const { return source.empty(); }
};
BootChoice storedBootChoice();

/// Makes `source` -- the file at `path`, as it reads now -- what the next page
/// load runs.
bool storeBootChoice(const std::string& path, const std::string& source, std::string& error);

/// Makes the next page load start the game again.
bool clearBootChoice(std::string& error);

/// Reloads the page, which is what puts a new choice into effect.
void reloadPage();

} // namespace flix::web
