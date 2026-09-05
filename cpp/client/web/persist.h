#pragma once

// Browser-side persistence for the emscripten client.
//
// Everything the client reads at startup -- the fonts, the SVGs, mobs.json,
// petals.json -- is embedded in the wasm and never changes, so MEMFS is the
// right home for it. Two files are not like that: the settings the player
// chose and the session token that keeps them logged in. Those are written by
// the client and have to still be there after a reload, and MEMFS is gone the
// moment the tab is.
//
// So those two are moved into their own directory, and that directory is
// backed by browser storage rather than memory. The file API above this does
// not change: ClientSettings still writes with an ofstream and App still reads
// with an ifstream. Only where the bytes end up is different.

#include <string>
#include <vector>

namespace flix::web {

/// The directory the persistent files live in. Nothing else is stored there:
/// the mount below only knows about the names it was given, so a file that
/// appears here later would be an ordinary in-memory one.
extern const char* const kStorageDirectory;

/// Mounts kStorageDirectory on a WasmFS backend whose bytes live in the
/// browser's localStorage, and creates `names` inside it, each one restored
/// from whatever was saved under it last time. They are created up front, and
/// empty when there is nothing saved, so that every later open is a write to a
/// file that already exists -- see the note in the .cpp about why that
/// matters.
///
/// Returns false, having changed nothing, when the browser will not give the
/// page storage at all (private windows and blocked cookies both do this). The
/// client still runs in that case; it just forgets, as it did before.
bool mountStorage(const std::vector<std::string>& names);

/// Calls `flush` when the page is going away.
///
/// The native client saves on the way out of run(). A browser tab has no way
/// out: it is closed or reloaded, and the main loop is simply never called
/// again, so a save that waits for shutdown() is a save that never happens.
/// pagehide and a hidden visibilitychange are the two events that do fire, on
/// desktop and on mobile respectively, and localStorage is synchronous, so
/// there is time to write from either one.
void onPageHide(void (*flush)());

} // namespace flix::web
