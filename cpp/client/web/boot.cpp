#include "client/web/boot.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

#include <fstream>

#include "client/web/persist.h"
#include "shared/core/file.h"
#endif

namespace flix::web {

#ifdef __EMSCRIPTEN__

EM_JS_DEPS(flix_boot, "$stringToUTF8,$lengthBytesUTF8");

EM_JS(int, flix_boot_supported, (), { return Module.flixBoot ? 1 : 0; });

// The path in two calls -- its length, then the bytes into a buffer the caller
// sized -- rather than one that returns a malloc'd string, which would need
// _malloc exported to JavaScript for this alone. See persist.cpp's storedSize.
EM_JS(int, flix_boot_path_length, (), {
  const path = (Module.flixBoot && Module.flixBoot.path) || "";
  return lengthBytesUTF8(path);
});
EM_JS(void, flix_boot_path_copy, (char* out, int capacity), {
  const path = (Module.flixBoot && Module.flixBoot.path) || "";
  stringToUTF8(path, out, capacity);
});

EM_JS(void, flix_reload_page, (), { location.reload(); });

namespace {

std::string storagePath(const char* name) {
    return std::string(kStorageDirectory) + "/" + name;
}

/// Whether the mount made the two files. It makes them up front, and it makes
/// nothing at all when the browser refuses the page storage.
bool storageMounted() {
    std::ifstream probe(storagePath(kBootScriptName));
    return static_cast<bool>(probe);
}

bool writeStored(const char* name, const std::string& bytes) {
    // Truncated in place, never removed and recreated: the mount pairs each
    // storage key with the file object it made (persist.cpp).
    std::ofstream out(storagePath(name), std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.flush();
    return static_cast<bool>(out);
}

} // namespace

bool bootScriptsSupported() { return flix_boot_supported() != 0; }

std::string bootUnavailableReason() {
    if (!bootScriptsSupported()) return "this page does not run boot scripts";
    if (!storageMounted()) return "this browser gives the page no storage to keep one in";
    return {};
}

std::string bootedThrough() {
    const int length = flix_boot_path_length();
    if (length <= 0) return {};
    std::string path(static_cast<std::size_t>(length) + 1, '\0');
    flix_boot_path_copy(path.data(), length + 1);
    path.resize(static_cast<std::size_t>(length));
    return path;
}

BootChoice storedBootChoice() {
    BootChoice choice;
    readFile(storagePath(kBootScriptName), choice.source);
    if (!choice.source.empty()) readFile(storagePath(kBootPathName), choice.path);
    return choice;
}

bool storeBootChoice(const std::string& path, const std::string& source, std::string& error) {
    error = bootUnavailableReason();
    if (!error.empty()) return false;
    if (source.empty()) {
        error = "the script is empty";
        return false;
    }
    if (!writeStored(kBootPathName, path) || !writeStored(kBootScriptName, source)) {
        error = "browser storage refused it (it may be full)";
        return false;
    }
    return true;
}

bool clearBootChoice(std::string& error) {
    error = bootUnavailableReason();
    if (!error.empty()) return false;
    if (!writeStored(kBootScriptName, {}) || !writeStored(kBootPathName, {})) {
        error = "browser storage refused it";
        return false;
    }
    return true;
}

void reloadPage() { flix_reload_page(); }

#else

bool bootScriptsSupported() { return false; }
std::string bootUnavailableReason() { return "boot scripts are a feature of the browser build"; }
std::string bootedThrough() { return {}; }
BootChoice storedBootChoice() { return {}; }

bool storeBootChoice(const std::string&, const std::string&, std::string& error) {
    error = bootUnavailableReason();
    return false;
}

bool clearBootChoice(std::string& error) {
    error = bootUnavailableReason();
    return false;
}

void reloadPage() {}

#endif

} // namespace flix::web
