#include "client/web/persist.h"

#include <cstdint>

#include <emscripten.h>
#include <emscripten/wasmfs.h>
#include <unistd.h>

// $wasmFS$backends is the map WasmFS keeps of backend address -> the JS object
// implementing it. It is a JS library symbol, so it is only emitted if
// something asks for it, and EM_JS bodies are not scanned for dependencies.
EM_JS_DEPS(flix_persist, "$wasmFS$backends");

namespace flix::web {
namespace {

/// Namespaced so the client's two files cannot collide with anything else the
/// origin stores.
constexpr const char* kStoragePrefix = "flowrix/";

void (*g_flush)() = nullptr;

/// Installs the JS half of the backend: WasmFS calls into these for every read
/// and write of a file that lives in it.
///
/// The bytes are kept in a typed array per open file and mirrored into
/// localStorage after each change, rather than being re-encoded out of storage
/// on every read. Both files are a few hundred bytes, so the copy is free and
/// reads stay a subarray away.
///
/// Returns 0 if the origin has no storage to give -- a private window, or
/// cookies blocked -- in which case no backend is installed.
EM_JS(int, installBackend, (void* backend, const char* prefixPtr), {
    const prefix = UTF8ToString(prefixPtr);

    // Touching localStorage is what throws when it is unavailable, not using
    // it, so the probe has to be a real write.
    try {
        const probe = prefix + 'probe';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
    } catch (e) {
        return 0;
    }

    // localStorage holds strings, so the bytes go in base64. The files are
    // text today, but a backend that only survives ASCII is a trap for the
    // next thing stored here.
    const decode = (text) => {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
        return bytes;
    };
    const encode = (bytes) => {
        // Double quotes for the empty string: the C preprocessor sees this
        // body before JS does, and '' is an empty character constant to it.
        let binary = "";
        for (let i = 0; i < bytes.length; ++i) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    };

    // File address -> { name, bytes }. `name` is null for a file this backend
    // was never told the name of, which is stored in memory and nowhere else.
    const files = {};
    const save = (entry) => {
        try {
            localStorage.setItem(prefix + entry.name, encode(entry.bytes));
        } catch (e) {
            // A full or read-only quota. The client is still playable, so this
            // is a warning rather than a failure the game has to handle.
            console.warn('[persist] could not save ' + entry.name + ': ' + e);
        }
    };

    const impl = {
        // The name the next file created in this backend is to be stored
        // under, set by expectNext() immediately before the file is made.
        pending: null,

        allocFile: (file) => {
            const name = impl.pending;
            impl.pending = null;
            let bytes = new Uint8Array(0);
            if (name !== null) {
                try {
                    const saved = localStorage.getItem(prefix + name);
                    if (saved !== null) bytes = decode(saved);
                } catch (e) {
                    console.warn('[persist] could not read ' + name + ': ' + e);
                }
            }
            files[file] = { name: name, bytes: bytes };
        },
        freeFile: (file) => { delete files[file]; },

        read: (file, buffer, length, offset) => {
            const entry = files[file];
            if (!entry) return -5;  // EIO
            const available = Math.max(0, entry.bytes.length - offset);
            length = Math.min(length, available);
            HEAPU8.set(entry.bytes.subarray(offset, offset + length), buffer);
            return length;
        },
        write: (file, buffer, length, offset) => {
            const entry = files[file];
            if (!entry) return -5;  // EIO
            if (offset + length > entry.bytes.length) {
                const grown = new Uint8Array(offset + length);
                grown.set(entry.bytes);
                entry.bytes = grown;
            }
            entry.bytes.set(HEAPU8.subarray(buffer, buffer + length), offset);
            if (entry.name !== null) save(entry);
            return length;
        },
        getSize: (file) => files[file] ? files[file].bytes.length : 0,
        setSize: (file, size) => {
            const entry = files[file];
            if (!entry) return -5;  // EIO
            const resized = new Uint8Array(size);
            resized.set(entry.bytes.subarray(0, Math.min(size, entry.bytes.length)));
            entry.bytes = resized;
            if (entry.name !== null) save(entry);
            return 0;
        },
    };

    wasmFS$backends[backend] = impl;
    return 1;
});

/// Names the storage key the next file created in this backend belongs to.
///
/// WasmFS hands a backend the address of a new file, never its path -- the
/// name belongs to the directory, which is filled in after the backend has
/// already been asked to make the file. So the name is passed sideways, set
/// here and picked up by the allocFile hook that the create below runs
/// synchronously.
EM_JS(void, expectNext, (void* backend, const char* namePtr), {
    wasmFS$backends[backend].pending = UTF8ToString(namePtr);
});

EM_JS(void, installPageHide, (), {
    // pagehide covers a reload, a navigation and a close on the desktop.
    // Mobile browsers routinely kill a backgrounded tab without firing it, and
    // a hidden visibilitychange is the last event those do deliver, so both
    // are watched. Saving twice costs one localStorage write.
    const flush = () => _flix_persist_flush();
    addEventListener('pagehide', flush);
    addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
});

} // namespace

const char* const kStorageDirectory = "/persist";

bool mountStorage(const std::vector<std::string>& names) {
    backend_t backend = wasmfs_create_jsimpl_backend();
    if (!installBackend(backend, kStoragePrefix)) return false;

    if (wasmfs_create_directory(kStorageDirectory, 0777, backend) != 0) return false;

    // Created now, once, rather than left to the first save.
    //
    // A file made later -- by the ofstream in ClientSettings::save, say --
    // would still land in this backend, because a directory's backend is what
    // makes its children. But nothing would have told the backend its name, so
    // it would be stored in memory and lost, silently. Creating them here is
    // what pairs every file in this directory with a key, and it is why
    // App::logout truncates the session file rather than removing it: a
    // removed file takes its name binding with it.
    for (const std::string& name : names) {
        expectNext(backend, name.c_str());
        const int fd = wasmfs_create_file((std::string(kStorageDirectory) + "/" + name).c_str(),
                                          0666, backend);
        if (fd >= 0) ::close(fd);
    }
    return true;
}

void onPageHide(void (*flush)()) {
    g_flush = flush;
    installPageHide();
}

} // namespace flix::web

/// Called from the page's own unload handlers. Exported rather than passed as
/// a function pointer so the JS above can name it without a dyncall.
extern "C" EMSCRIPTEN_KEEPALIVE void flix_persist_flush() {
    if (flix::web::g_flush) flix::web::g_flush();
}
