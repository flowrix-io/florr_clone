#include "server/account_search.h"

#include <algorithm>
#include <cstdlib>

#include "server/db.h"
#include "shared/core/text.h"
#include "shared/game/config.h"

namespace flix::account_search {

namespace {

constexpr const char* kLoadoutPrefix = "loadout:";

/// Lowercase, with the characters a display name spells a word break with
/// taken out, so "Yin Yang", yin_yang and yinyang compare equal.
std::string folded(const std::string& name) {
    std::string out;
    out.reserve(name.size());
    for (const char c : name) {
        if (c == ' ' || c == '_' || c == '-' || c == '\'') continue;
        out += lowerCase(c);
    }
    return out;
}

bool findRarity(const std::string& word, Rarity& out) {
    const std::string wanted = folded(word);
    for (int i = 0; i < kRarityCount; ++i) {
        const auto r = static_cast<Rarity>(i);
        if (wanted == folded(rarityName(r)) || wanted == folded(rarityLabel(r))) {
            out = r;
            return true;
        }
    }
    return false;
}

/// The id first, across the whole catalogue, and only then the display name:
/// a name may fold to some other petal's id, and the id is the exact one.
const PetalConfig* findPetal(const std::string& word, const ContentRegistry& content) {
    const std::string wanted = folded(word);
    for (std::size_t i = 0; i < content.petalCount(); ++i) {
        const PetalConfig& petal = content.petal(static_cast<std::uint16_t>(i));
        if (folded(petal.id) == wanted) return &petal;
    }
    for (std::size_t i = 0; i < content.petalCount(); ++i) {
        const PetalConfig& petal = content.petal(static_cast<std::uint16_t>(i));
        if (folded(petal.name) == wanted) return &petal;
    }
    return nullptr;
}

/// The comparison at the front of `text`, and how many characters it took.
std::size_t readCompare(const std::string& text, Compare& out) {
    if (text.rfind(">=", 0) == 0) { out = Compare::AtLeast; return 2; }
    if (text.rfind("<=", 0) == 0) { out = Compare::AtMost; return 2; }
    if (text.rfind("==", 0) == 0) { out = Compare::Equal; return 2; }
    if (text.rfind(">", 0) == 0) { out = Compare::Greater; return 1; }
    if (text.rfind("<", 0) == 0) { out = Compare::Less; return 1; }
    if (text.rfind("=", 0) == 0) { out = Compare::Equal; return 1; }
    return 0;
}

/// `spec` is what comes before the comparison, the `loadout:` taken off:
/// `petals` (or nothing), a rarity, a petal, or a rarity and a petal either way
/// round.
bool readSubject(const std::string& spec, const ContentRegistry& content, Term& term,
                 std::string& error) {
    if (spec.empty() || spec == "petals" || spec == "petal") {
        term.label = "Petals";
        return true;
    }
    const std::size_t colon = spec.find(':');
    std::vector<std::string> parts;
    if (colon == std::string::npos) {
        parts.push_back(spec);
    } else {
        parts.push_back(spec.substr(0, colon));
        parts.push_back(spec.substr(colon + 1));
    }
    const PetalConfig* petal = nullptr;
    bool rarityNamed = false;
    for (const std::string& part : parts) {
        Rarity rarity = Rarity::Common;
        if (findRarity(part, rarity)) {
            if (rarityNamed) {
                error = "\"" + spec + "\" names two rarities.";
                return false;
            }
            rarityNamed = true;
            term.anyRarity = false;
            term.rarity = rarity;
            continue;
        }
        const PetalConfig* named = findPetal(part, content);
        if (named == nullptr) {
            error = part.empty() ? "\"" + spec + "\" names no petal or rarity."
                                 : "There is no petal or rarity called \"" + part + "\".";
            return false;
        }
        if (petal != nullptr) {
            error = "\"" + spec + "\" names two petals.";
            return false;
        }
        petal = named;
    }
    if (petal != nullptr) term.petal = petal->id;
    if (rarityNamed) term.label = rarityLabel(term.rarity);
    if (petal != nullptr) term.label += (term.label.empty() ? "" : " ") + petal->name;
    return true;
}

bool readTerm(const std::string& word, const ContentRegistry& content, Term& term,
              std::string& error) {
    std::string spec = word;
    const bool loadout = spec.rfind(kLoadoutPrefix, 0) == 0;
    if (loadout) spec.erase(0, std::char_traits<char>::length(kLoadoutPrefix));

    const std::size_t at = spec.find_first_of("<>=");
    if (at != std::string::npos) {
        const std::size_t taken = readCompare(spec.substr(at), term.compare);
        const std::string number = spec.substr(at + taken);
        char* end = nullptr;
        term.value = std::strtod(number.c_str(), &end);
        if (taken == 0 || number.empty() || end != number.c_str() + number.size()) {
            error = "\"" + word + "\" needs a number after the comparison, like " +
                    (loadout ? "loadout:rose>=2." : "rose>=10.");
            return false;
        }
        spec.erase(at);
    }

    if (!loadout && spec == "level") {
        term.field = Field::Level;
        term.label = "Level";
        return true;
    }
    term.field = loadout ? Field::Loadout : Field::Owned;
    if (!readSubject(spec, content, term, error)) return false;
    if (loadout) term.label = "Loadout " + term.label;
    return true;
}

} // namespace

bool parse(const std::string& text, const ContentRegistry& content, Query& out,
           std::string& error) {
    out = Query{};
    const std::string lowered = lowerCase(text);
    std::size_t at = 0;
    while (at < lowered.size()) {
        const std::size_t end = std::min(lowered.find(' ', at), lowered.size());
        const std::string word = lowered.substr(at, end - at);
        at = end + 1;
        if (word.empty()) continue;
        // A username is letters, digits and underscores, so a word with any of
        // these in it can only be a count.
        if (word.find_first_of(":<>=") == std::string::npos) {
            out.names.push_back(word);
            continue;
        }
        Term term;
        if (!readTerm(word, content, term, error)) return false;
        out.terms.push_back(std::move(term));
    }
    return true;
}

double valueOf(const Term& term, const PlayerRecord* record, int level) {
    if (term.field == Field::Level) return level;
    if (record == nullptr) return 0;

    double total = 0;
    if (term.field == Field::Loadout) {
        for (const std::optional<StoredItem>& slot : record->loadout) {
            if (!slot || slot->type != "petal") continue;
            if (!term.petal.empty() && slot->petalType != term.petal) continue;
            if (!term.anyRarity && slot->rarity != term.rarity) continue;
            ++total;
        }
        return total;
    }

    const std::string itemKey = "petal_" + term.petal;
    const auto countBucket = [&](const Json& bucket) {
        if (!bucket.isObject()) return;
        if (!term.petal.empty()) {
            total += PlayerRecord::stackCount(bucket[itemKey]);
            return;
        }
        for (const auto& entry : bucket.members()) {
            if (entry.first.rfind("petal_", 0) == 0) {
                total += PlayerRecord::stackCount(entry.second);
            }
        }
    };
    if (!term.anyRarity) {
        countBucket(record->inventory[std::string(rarityName(term.rarity))]);
    } else if (record->inventory.isObject()) {
        for (const auto& entry : record->inventory.members()) countBucket(entry.second);
    }
    return total;
}

bool satisfies(const Term& term, double value) {
    switch (term.compare) {
        case Compare::Greater: return value > term.value;
        case Compare::AtLeast: return value >= term.value;
        case Compare::Less: return value < term.value;
        case Compare::AtMost: return value <= term.value;
        case Compare::Equal: return value == term.value;
    }
    return false;
}

} // namespace flix::account_search
