#pragma once
// Where the tests find the game's content, and where they write their own.
//
// The repository's data/ (mobs.json, petals.json, mob_drops.json) and maps/
// are the source. CMake stages all of it flat into <build>/data -- the
// directory the shipping server reads -- and hands that directory to the test
// binary as FLIX_TEST_DATA_DIR. Every test reads the staged copy, so what a
// test sees is what a server booted from the same build would see.
//
// One copy of this, rather than a list of candidate paths pasted into each
// test file: those lists outlived the layout they were written for. The same
// goes for the scratch directory every fixture is written into, at the bottom.

#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <utility>

#include "shared/core/file.h"
#include "shared/core/json.h"
#include "shared/game/config.h"

namespace flix::testsupport {

namespace detail {

/// cpp/tests, found from this file's own path.
inline std::string testsDir() {
    const std::string here = __FILE__;
    const std::size_t slash = here.find_last_of('/');
    return slash == std::string::npos ? std::string(".") : here.substr(0, slash);
}

inline bool readable(const std::string& path) {
    std::ifstream probe(path, std::ios::binary);
    return static_cast<bool>(probe);
}

} // namespace detail

/// The content directory. FLIX_TEST_DATA_DIR first -- the directory the build
/// staged, by absolute path, so the binary finds it whether it is run from the
/// build tree, from the project root or from ctest -- then the build tree
/// beside this source file, then `data` under the working directory, which is
/// the staged copy again for a binary run from its own build directory.
///
/// Every candidate is probed on maps.json, which is what says a directory
/// holds maps at all. The repository's own data/ has the JSON and no maps, so
/// a probe on mobs.json would accept it from the project root and boot every
/// harness server on a world with no map in it. When nothing qualifies it says
/// so once and answers `data`, and every harness server then fails to start
/// with the loader's own reason rather than on a world with nothing in it.
inline const std::string& dataDir() {
    static const std::string resolved = [] {
#ifdef FLIX_TEST_DATA_DIR
        {
            // The staged directory is the one the shipping server reads, so it
            // is preferred whenever it exists.
            const std::string staged = FLIX_TEST_DATA_DIR;
            if (detail::readable(staged + "/maps.json")) return staged;
        }
#endif
        const std::string candidates[] = {
            detail::testsDir() + "/../build/data",   // staged beside the binaries
            "data",
        };
        for (const std::string& candidate : candidates) {
            if (detail::readable(candidate + "/maps.json")) return candidate;
        }
        std::printf("  no staged data directory (one with a maps.json) was found; "
                    "the flix_data target stages it\n");
        return std::string("data");
    }();
    return resolved;
}

/// One shipped content file by bare name -- "mobs.json", "petals.json",
/// "mob_drops.json" -- for a test that loads or reads it on its own. The staged
/// copy when there is one; otherwise the file in the source tree's data/ that
/// CMake stages it from, which holds the same bytes.
inline std::string dataFile(const std::string& name) {
    const std::string staged = dataDir() + "/" + name;
    if (detail::readable(staged)) return staged;
    return detail::testsDir() + "/../../data/" + name;
}

/// One of the repository's own maps -- `repoMap("garden.tmj")` is
/// maps/garden.tmj -- for a test about the AUTHORED file rather than the staged
/// copy a server boots on.
inline std::string repoMap(const std::string& name) {
    return detail::testsDir() + "/../../maps/" + name;
}

/// The shipped mobs.json and petals.json in a registry of the tests' own,
/// parsed once per process: 220KB of JSON with inline SVG in every entry is not
/// something to repeat per test case, and unlike content() -- which every
/// harness server reloads -- nothing replaces it under a test. A failed load is
/// printed once and leaves the registry empty, which loaded() reports.
inline const ContentRegistry& shippedContent() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        if (!r.loadFiles(dataFile("mobs.json"), dataFile("petals.json"), error)) {
            std::printf("  shipped content did not load: %s\n", error.c_str());
        }
        return r;
    }();
    return registry;
}

/// One shipped content file by bare name, PARSED, for a test that reads an
/// authored figure straight off the file instead of writing it down. The
/// author rebalances these files every week, and a test about how a number is
/// READ -- converted, scaled, resolved -- has nothing to say about which number
/// the author picked; a copy of it pasted into the test only ever said when the
/// test was last updated. Parsed once per process and file. One that does not
/// parse is printed once and reads as an empty document, so every figure taken
/// off it comes out as its type's default and the checks fail loudly.
inline const Json& shippedJson(const std::string& name) {
    static std::map<std::string, Json> parsed;
    auto found = parsed.find(name);
    if (found == parsed.end()) {
        Json doc;
        std::string error;
        if (!Json::parseFile(dataFile(name), doc, error)) {
            std::printf("  %s did not parse: %s\n", name.c_str(), error.c_str());
        }
        found = parsed.emplace(name, std::move(doc)).first;
    }
    return found->second;
}

// ---------------------------------------------------------------------------
// Scratch files
// ---------------------------------------------------------------------------
//
// Fixtures a test writes for itself -- a content pair, a map, a database --
// go under TMPDIR when it is set and /tmp otherwise, so a run pointed at a
// scratch directory of its own leaves nothing anywhere else.

/// The directory scratch files go in: absolute, with no trailing slash.
///
/// Absolute because a path derived from it can climb out of it. A database's
/// backups go one level ABOVE the database's own directory
/// (Database::backupDirectoryFor), and with a relative TMPDIR that level was
/// read against whatever the working directory happened to be -- the repo root
/// for a run started there, which is exactly where the real db_backups/ sits.
/// Settled once, against the directory the run started in, so a later change
/// of directory cannot move it either.
inline std::string tempRoot() {
    static const std::string root = [] {
        const char* env = std::getenv("TMPDIR");
        std::string dir = (env != nullptr && *env != '\0') ? env : "/tmp";
        if (dir.front() != '/') {
            char cwd[4096];
            if (::getcwd(cwd, sizeof cwd) != nullptr) dir = std::string(cwd) + "/" + dir;
        }
        while (dir.size() > 1 && dir.back() == '/') dir.pop_back();
        return dir;
    }();
    return root;
}

/// `tempRoot()/<name>`, created if it is not there yet. Already there is fine:
/// every test file names a directory of its own and writes the same fixtures
/// into it on every run.
inline std::string tempDir(const std::string& name) {
    const std::string dir = tempRoot() + "/" + name;
    ::mkdir(dir.c_str(), 0755);
    return dir;
}

/// `tempRoot()/<stem>-<pid><extension>`: a name no other test process can be
/// using at the same moment, for a file two runs must not share -- a
/// database a server is writing, say.
inline std::string tempUnique(const std::string& stem, const std::string& extension = {}) {
    return tempRoot() + "/" + stem + "-" + std::to_string(::getpid()) + extension;
}

/// Writes `text` to `path` byte for byte, replacing whatever was there. The
/// directory must exist.
inline bool writeText(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
    return out.good();
}

/// All of `path`, byte for byte; false, with `out` untouched, when it cannot be
/// opened.
inline bool readText(const std::string& path, std::string& out) { return readFile(path, out); }

inline bool copyFile(const std::string& from, const std::string& to) {
    std::string text;
    return readText(from, text) && writeText(to, text);
}

} // namespace flix::testsupport
