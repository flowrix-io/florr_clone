#pragma once
// The admin database editor's account search: what the text in its search box
// means, and what an account reads against it.
//
// Pure apart from the petal catalogue it names petals from, so the grammar is
// tested without a server. GameServer::adminDbList lists the live database by
// it, and tools/backup_search.cpp the backups. A search is words separated by
// spaces, and an account must answer every one:
//
//   bob                the username contains "bob", in any case
//   level>=50          a number compared with >, >=, <, <= or = (==); stars,
//                      xp and streak (the daily login streak) the same way
//   created>=2026-10-01  when the account was made; active<2026-09, when it
//                      last signed in. A UTC month, day or minute
//                      (2026-10-01T18:30), each compared as the span it
//                      names, so created=2026-10-01 is that whole day
//   active<7d          how long AGO, in m, h, d or w, so it reads as said:
//                      signed in less than a week ago; created>30d, made
//                      more than 30 days ago. Never signed in, or made before
//                      the server kept the date, is longest ago of all
//   is:guest           a flag: admin, muted or guest; not:muted its opposite
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
struct Account;
struct PlayerRecord;

namespace account_search {

enum class Field : std::uint8_t {
    Level, Stars, Xp, Streak,
    Created, Active,
    Admin, Muted, Guest,
    Owned, Loadout,
};
enum class Compare : std::uint8_t { Greater, AtLeast, Less, AtMost, Equal };

struct Term {
    Field field = Field::Owned;
    /// A petal id, without the inventory's `petal_` prefix. Empty: every petal.
    std::string petal;
    bool anyRarity = true;
    Rarity rarity = Rarity::Common;
    Compare compare = Compare::AtLeast;
    double value = 1;
    /// Non-zero when `value` starts a stretch rather than being a point: a
    /// date is its whole month, day or minute, so `created>2026-10-01` begins
    /// on the 2nd and `created<=2026-10-01` runs to the end of the 1st.
    double span = 0;
    /// Created and Active: `value` is how long ago, in milliseconds, rather
    /// than when -- `active<7d` against `active>=2026-10-20`.
    bool ago = false;
    /// How a result row names what it read: "Level", "Petals", "Mythic Rose",
    /// "Loadout Rose", "Created".
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

/// One account, as a search reads it.
struct Subject {
    const Account* account = nullptr;
    /// Null when the account has no progress yet: every count is zero.
    const PlayerRecord* record = nullptr;
    /// Wall-clock Unix millis, which `active<7d` counts back from.
    std::int64_t nowMillis = 0;
};

/// What `term` reads on `subject`, whose level is `level`. A flag reads 1 or
/// 0; a time ago that never happened reads infinity.
double valueOf(const Term& term, const Subject& subject, int level);

bool satisfies(const Term& term, double value);

/// Whether `username` holds every name word of `query`, in any case.
bool namesMatch(const Query& query, const std::string& username);

/// Whether `subject` answers every term of `query`. When it does, `values`
/// holds what each term read, in the query's order.
bool termsMatch(const Query& query, const Subject& subject, std::vector<double>& values);

/// A count as a result row shows it, with thousands separated.
std::string countText(double value);

/// What `term` read, as a result row shows it: "1,234", "2026-10-01 18:30"
/// (UTC), "3d ago", "never". Empty for a flag, which every row found by it
/// shares.
std::string valueText(const Term& term, double value);

} // namespace account_search
} // namespace flix
