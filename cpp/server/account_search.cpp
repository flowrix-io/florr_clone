#include "server/account_search.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

#include "server/db.h"
#include "shared/core/civil_date.h"
#include "shared/core/text.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"

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

bool readNumber(const std::string& text, double& out) {
    char* end = nullptr;
    out = std::strtod(text.c_str(), &end);
    return !text.empty() && end == text.c_str() + text.size();
}

constexpr double kMinuteMillis = 60.0 * 1000;
constexpr double kDayMillis = 24 * 60 * kMinuteMillis;

/// A time for Created or Active, `term.compare` already read: how long ago
/// ("7d": m, h, d or w), or a UTC date -- "2026-10", "2026-10-01" or
/// "2026-10-01t18:30", the text being lowercased -- which names its whole
/// month, day or minute.
bool readWhen(const std::string& text, Term& term) {
    static constexpr struct { char unit; double millis; } kUnits[] = {
        {'m', kMinuteMillis}, {'h', 60 * kMinuteMillis}, {'d', kDayMillis}, {'w', 7 * kDayMillis}};
    for (const auto& unit : kUnits) {
        if (text.empty() || text.back() != unit.unit) continue;
        double count = 0;
        if (!readNumber(text.substr(0, text.size() - 1), count) || !(count >= 0)) return false;
        term.ago = true;
        term.value = count * unit.millis;
        // Otherwise exact, but "=3d" can only mean the third day back.
        term.span = term.compare == Compare::Equal ? unit.millis : 0;
        return true;
    }

    const std::size_t size = text.size();
    if (size != 7 && size != 10 && size != 16) return false;
    const auto digits = [&](std::size_t from, std::size_t count, int& out) {
        out = 0;
        for (std::size_t i = from; i < from + count; ++i) {
            if (text[i] < '0' || text[i] > '9') return false;
            out = out * 10 + (text[i] - '0');
        }
        return true;
    };
    int year = 0, month = 0, day = 1, hour = 0, minute = 0;
    if (!digits(0, 4, year) || text[4] != '-' || !digits(5, 2, month) || month < 1 ||
        month > 12) {
        return false;
    }
    if (size >= 10 && (text[7] != '-' || !digits(8, 2, day) || day < 1 || day > 31)) return false;
    if (size == 16 && (text[10] != 't' || !digits(11, 2, hour) || text[13] != ':' ||
                       !digits(14, 2, minute) || hour > 23 || minute > 59)) {
        return false;
    }
    const std::int64_t first =
        daysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    term.ago = false;
    term.value = static_cast<double>(first) * kDayMillis + hour * 60 * kMinuteMillis +
                 minute * kMinuteMillis;
    if (size == 7) {
        const std::int64_t next = daysFromCivil(month == 12 ? year + 1 : year,
                                                month == 12 ? 1u : static_cast<unsigned>(month + 1), 1);
        term.span = static_cast<double>(next - first) * kDayMillis;
    } else {
        term.span = size == 10 ? kDayMillis : kMinuteMillis;
    }
    return true;
}

/// is:admin, not:guest.
bool readFlag(const std::string& word, Term& term, std::string& error) {
    const bool is = word.rfind("is:", 0) == 0;
    static constexpr struct { const char* name; Field field; const char* label; } kFlags[] = {
        {"admin", Field::Admin, "Admin"}, {"muted", Field::Muted, "Muted"},
        {"guest", Field::Guest, "Guest"}};
    const std::string flag = word.substr(is ? 3 : 4);
    for (const auto& known : kFlags) {
        if (flag != known.name) continue;
        term.field = known.field;
        term.label = known.label;
        term.compare = Compare::Equal;
        term.value = is ? 1 : 0;
        return true;
    }
    error = "\"" + word + "\" names no flag: is: or not: with admin, muted or guest.";
    return false;
}

bool readTerm(const std::string& word, const ContentRegistry& content, Term& term,
              std::string& error) {
    if (word.rfind("is:", 0) == 0 || word.rfind("not:", 0) == 0) {
        return readFlag(word, term, error);
    }

    std::string spec = word;
    const bool loadout = spec.rfind(kLoadoutPrefix, 0) == 0;
    if (loadout) spec.erase(0, std::char_traits<char>::length(kLoadoutPrefix));

    // What follows the comparison; an empty one is a count's "at least one".
    std::string operand;
    const std::size_t at = spec.find_first_of("<>=");
    const bool compared = at != std::string::npos;
    if (compared) {
        operand = spec.substr(at + readCompare(spec.substr(at), term.compare));
        spec.erase(at);
    }

    // The account's own words come before petals and rarities, none of which
    // is called any of them.
    if (!loadout) {
        const std::string name = folded(spec);
        if (name == "created" || name == "active" || name == "lastactive") {
            term.field = name == "created" ? Field::Created : Field::Active;
            term.label = name == "created" ? "Created" : "Active";
            if (compared && readWhen(operand, term)) return true;
            error = "\"" + word + "\" needs a date or a time ago after the comparison, like " +
                    spec + ">=2026-10-01 or " + spec + "<7d.";
            return false;
        }
        static constexpr struct { const char* name; Field field; const char* label; } kNumbers[] = {
            {"level", Field::Level, "Level"}, {"stars", Field::Stars, "Stars"},
            {"xp", Field::Xp, "XP"}, {"streak", Field::Streak, "Streak"}};
        for (const auto& number : kNumbers) {
            if (name != number.name) continue;
            term.field = number.field;
            term.label = number.label;
            if (compared && readNumber(operand, term.value)) return true;
            error = "\"" + word + "\" needs a number after the comparison, like " + spec +
                    ">=10.";
            return false;
        }
    }

    if (compared && !readNumber(operand, term.value)) {
        error = "\"" + word + "\" needs a number after the comparison, like " +
                (loadout ? "loadout:rose>=2." : "rose>=10.");
        return false;
    }
    term.field = loadout ? Field::Loadout : Field::Owned;
    if (!readSubject(spec, content, term, error)) return false;
    if (loadout) term.label = "Loadout " + term.label;
    return true;
}

/// "2026-10-01 18:30", UTC.
std::string dateText(double millis) {
    const auto at = static_cast<std::int64_t>(millis);
    const std::int64_t day = static_cast<std::int64_t>(kDayMillis);
    const std::int64_t days = at / day - (at % day < 0 ? 1 : 0);
    const std::int64_t minutes = (at - days * day) / static_cast<std::int64_t>(kMinuteMillis);
    char clock[8];
    std::snprintf(clock, sizeof clock, "%02d:%02d", static_cast<int>(minutes / 60),
                  static_cast<int>(minutes % 60));
    return civilFromDays(days) + " " + clock;
}

/// "12m ago", "5h ago", "3d ago": the units a search is typed in.
std::string agoText(double millis) {
    const double minutes = std::floor(std::max(0.0, millis) / kMinuteMillis);
    if (minutes < 60) return countText(minutes) + "m ago";
    const double hours = std::floor(minutes / 60);
    if (hours < 48) return countText(hours) + "h ago";
    return countText(std::floor(hours / 24)) + "d ago";
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

double valueOf(const Term& term, const Subject& subject, int level) {
    const Account* account = subject.account;
    const PlayerRecord* record = subject.record;
    switch (term.field) {
        case Field::Level: return level;
        case Field::Stars: return record != nullptr ? record->stars : 0;
        case Field::Xp: return record != nullptr ? record->totalXp : 0;
        case Field::Streak: return record != nullptr ? record->dailyStreak : 0;
        case Field::Admin: return account != nullptr && account->admin ? 1 : 0;
        case Field::Muted: return account != nullptr && account->muted ? 1 : 0;
        case Field::Guest: return account != nullptr && account->guest ? 1 : 0;
        case Field::Created:
        case Field::Active: {
            const std::int64_t at = account == nullptr            ? 0
                                    : term.field == Field::Created ? account->createdAtMillis
                                                                   : account->lastActiveAtMillis;
            if (!term.ago) return static_cast<double>(at);
            // Zero is an account that never signed in, or one made before the
            // file kept the date: as long ago as anything can be.
            if (at <= 0) return std::numeric_limits<double>::infinity();
            return static_cast<double>(subject.nowMillis - at);
        }
        case Field::Owned:
        case Field::Loadout:
            break;
    }
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
    if (term.span > 0) {
        const double end = term.value + term.span;
        switch (term.compare) {
            case Compare::Greater: return value >= end;
            case Compare::AtLeast: return value >= term.value;
            case Compare::Less: return value < term.value;
            case Compare::AtMost: return value < end;
            case Compare::Equal: return value >= term.value && value < end;
        }
        return false;
    }
    switch (term.compare) {
        case Compare::Greater: return value > term.value;
        case Compare::AtLeast: return value >= term.value;
        case Compare::Less: return value < term.value;
        case Compare::AtMost: return value <= term.value;
        case Compare::Equal: return value == term.value;
    }
    return false;
}

bool namesMatch(const Query& query, const std::string& username) {
    const std::string lowered = lowerCase(username);
    return std::all_of(query.names.begin(), query.names.end(), [&](const std::string& part) {
        return lowered.find(part) != std::string::npos;
    });
}

bool termsMatch(const Query& query, const Subject& subject, std::vector<double>& values) {
    values.clear();
    // The walk up the XP table only for a search that asks for a level.
    const bool readsLevel = std::any_of(query.terms.begin(), query.terms.end(),
                                        [](const Term& t) { return t.field == Field::Level; });
    const PlayerRecord* record = subject.record;
    const int level =
        readsLevel ? levelFromTotalXp(record != nullptr ? record->totalXp : 0.0).level : 0;
    for (const Term& term : query.terms) {
        const double value = valueOf(term, subject, level);
        if (!satisfies(term, value)) return false;
        values.push_back(value);
    }
    return true;
}

std::string countText(double value) {
    char buffer[48];
    std::snprintf(buffer, sizeof buffer, "%.0f", std::fabs(value));
    const std::string digits = buffer;
    std::string out = value < 0 ? "-" : "";
    for (std::size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out += ',';
        out += digits[i];
    }
    return out;
}

std::string valueText(const Term& term, double value) {
    switch (term.field) {
        case Field::Admin:
        case Field::Muted:
        case Field::Guest:
            return std::string();
        case Field::Created:
        case Field::Active: {
            const char* none = term.field == Field::Created ? "unknown" : "never";
            if (term.ago) return std::isinf(value) ? none : agoText(value);
            return value <= 0 ? none : dateText(value);
        }
        default:
            return countText(value);
    }
}

} // namespace flix::account_search
