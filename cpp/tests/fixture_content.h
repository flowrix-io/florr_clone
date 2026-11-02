#pragma once
// Fixture content: hand-written mob and petal JSON with the mandatory fields
// filled in.
//
// Shipped content must name a mob's `xp` table and a petal's `price` -- a
// mob nobody said the worth of, or a petal nobody priced, fails the load
// rather than falling through to a default (ContentRegistry::loadFiles).
// A three-line fixture about knockback is not shipped content: nine XP tiers
// pasted into it say nothing about knockback and bury what the test is
// actually about.
//
// So these fill in a neutral value wherever a fixture did not name one. A test
// that IS about XP or price writes the field, and is left alone.
//
// Filling means a round trip through the JSON parser and writer, so a fixture
// carrying values that do not survive one -- 1e400 and the other deliberate
// defects the sanitising tests feed the loader -- must not come through here.
// Those write their own `xp` and `price` and go to the loader verbatim.

#include <cstdio>
#include <string>

#include "shared/core/json.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"
#include "test_data.h"

namespace flix {
namespace test {

/// Every top-level entry that does not name `key` gets `value`.
inline std::string withDefault(const std::string& text, const char* key, const Json& value) {
    Json doc;
    std::string error;
    // A fixture that does not parse is left exactly as written: reporting it
    // is the loader's job, and the test is usually there to watch it do so.
    if (!Json::parse(text, doc, error) || !doc.isObject()) return text;
    for (const std::string& id : doc.keys()) {
        Json& entry = doc[id];
        if (entry.isObject() && !entry.contains(key)) entry[key] = value;
    }
    return doc.dump();
}

/// One XP at every tier -- the value a mob with no table used to award back
/// when a missing table was survivable.
inline Json neutralXp() {
    Json xp = Json::object();
    for (int i = 0; i <= static_cast<int>(Rarity::Unique); ++i) {
        xp[kRarityNames[static_cast<std::size_t>(i)]] = Json(1);
    }
    return xp;
}

inline std::string fixtureMobs(const std::string& text) {
    return withDefault(text, "xp", neutralXp());
}

inline std::string fixturePetals(const std::string& text) {
    return withDefault(text, "price", Json(10));
}

/// Writes a fixture pair into `dir` as mobs.json and petals.json, filled in as
/// above, and loads it into `registry`. False, with `error` saying why, when a
/// file cannot be written or the loader refuses the pair. The loader reads
/// files rather than strings, which is the only reason a fixture goes through
/// the disk at all; a file holding more than one fixture gives each its own
/// `dir` (testsupport::tempDir), so what a failed run leaves behind can still
/// be read back.
inline bool loadFixtureContent(ContentRegistry& registry, const std::string& dir,
                               const std::string& mobs, const std::string& petals,
                               std::string& error) {
    const std::string mobsPath = dir + "/mobs.json";
    const std::string petalsPath = dir + "/petals.json";
    if (!testsupport::writeText(mobsPath, fixtureMobs(mobs)) ||
        !testsupport::writeText(petalsPath, fixturePetals(petals))) {
        error = "could not write the fixture content into " + dir;
        return false;
    }
    return registry.loadFiles(mobsPath, petalsPath, error);
}

/// A fixture pair in the PROCESS-WIDE registry -- the one content() answers
/// from, which the shop, the AI and the client read -- for as long as this
/// lives, written into `dir` (testsupport::tempDir) and filled in as above,
/// and the shipped content put back when it goes.
///
/// Every other test reads shipped content out of that same registry and
/// expects to find it there, so a fixture must never outlive the test that
/// loaded it: the shipped content goes back on every way out of the test, an
/// early return included. Declare it before anything that caches what it read
/// off the fixture, so that is gone first.
class FixtureContent {
public:
    FixtureContent(const std::string& dir, const std::string& mobs, const std::string& petals) {
        std::string error;
        loaded_ = testsupport::writeText(dir + "/mobs.json", fixtureMobs(mobs)) &&
                  testsupport::writeText(dir + "/petals.json", fixturePetals(petals)) &&
                  loadContent(dir, error);
        if (!loaded_) std::printf("    (the fixture content did not load: %s)\n", error.c_str());
    }
    ~FixtureContent() {
        std::string error;
        if (!loadContent(testsupport::dataDir(), error)) {
            std::printf("    (the shipped content did not load back: %s)\n", error.c_str());
        }
    }
    FixtureContent(const FixtureContent&) = delete;
    FixtureContent& operator=(const FixtureContent&) = delete;

    bool loaded() const { return loaded_; }

private:
    bool loaded_ = false;
};

} // namespace test
} // namespace flix
