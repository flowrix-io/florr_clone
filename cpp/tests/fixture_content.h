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

#include <string>

#include "shared/core/json.h"
#include "shared/game/rarity.h"

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

} // namespace test
} // namespace flix
