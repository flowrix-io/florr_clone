#pragma once
// The admin database editor's account search: what the text in its search box
// means, and what an account reads against it.
//
// Pure apart from the petal catalogue it names petals from, so the grammar is
// tested without a server; GameServer::adminDbList does the listing. A search
// is words separated by spaces, and an account must answer every one:
//
//   bob                the username contains "bob", in any case
//   level>=50          a number compared with >, >=, <, <= or = (==)
//   petals>=5000       every petal the account owns, summed
//   mythic>=100        every petal it owns at one rarity
//   rose>10            one petal at every rarity; mythic:rose>10 (or
//                      rose:mythic) at one
//   loadout:rose       how many slots of the loadout it wears hold that petal,
//                      at least one unless a comparison says otherwise:
//                      loadout:mythic:rose, loadout:mythic, loadout:rose>=3
//
// A word with a colon is a count too, at least one by default, so mythic:rose
// alone finds whoever owns one. A petal is named by its id or its display
// name with case, spaces, underscores, hyphens and apostrophes ignored --
// "Yin Yang", yin_yang and yinyang are one petal -- and a rarity by its id or
// its label ("eternal" is unique).
//
// Counts are what the database holds: the inventory, which counts the petals
// a player is wearing too, and the loadout as last saved.

#include <cstdint>
#include <string>
#include <vector>

#include "shared/game/rarity.h"

namespace flix {

class ContentRegistry;
struct PlayerRecord;

namespace account_search {

enum class Field : std::uint8_t { Level, Owned, Loadout };
enum class Compare : std::uint8_t { Greater, AtLeast, Less, AtMost, Equal };

struct Term {
    Field field = Field::Owned;
    /// A petal id, without the inventory's `petal_` prefix. Empty: every petal.
    std::string petal;
    bool anyRarity = true;
    Rarity rarity = Rarity::Common;
    Compare compare = Compare::AtLeast;
    double value = 1;
    /// How a result row names what it read: "Level", "Petals", "Mythic Rose",
    /// "Loadout Rose".
    std::string label;
};

struct Query {
    /// Lowercased. The username must contain every one.
    std::vector<std::string> names;
    /// In the order typed. The first one orders the results.
    std::vector<Term> terms;
};

/// Parses a search box's text. False, with a sentence for the admin in
/// `error`, on a word that names nothing or a comparison with no number.
bool parse(const std::string& text, const ContentRegistry& content, Query& out,
           std::string& error);

/// What `term` reads on an account whose level is `level` and whose stored
/// progress is `record` (null when it has none yet: every count is zero).
double valueOf(const Term& term, const PlayerRecord* record, int level);

bool satisfies(const Term& term, double value);

} // namespace account_search
} // namespace flix
