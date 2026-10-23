#include "server/chat_moderation.h"

#include "shared/core/text.h"
#include "shared/game/markup.h"

#include <algorithm>
#include <cstdint>
#include <initializer_list>
#include <utility>
#include <vector>

namespace flix {

namespace {

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

/// How much of a word a listed one has to be.
enum class Fit : std::uint8_t {
    /// Anywhere in a word: "fuck" in "motherfucking".
    Inside,
    /// The start of a word: "cunt" in "cunts", but not in "Scunthorpe".
    Start,
    /// The whole word, or its plural: "ass" and "asses", but not "class",
    /// "assassin" or "assess".
    Whole,
};

struct Listed {
    const char* word;   ///< lower-case a-z
    Fit fit;
};

/// Profanity, sexual vulgarity, slurs. Kept to words that are bad in nearly
/// every sentence they turn up in: "hell", "damn" and "crap" are left alone,
/// and so are words like "homo" and "negro" that are innocent in too many
/// others (Homo sapiens; Spanish for black).
constexpr Listed kBlocked[] = {
    // Profanity.
    {"fuck", Fit::Inside},      {"phuck", Fit::Inside},    {"fck", Fit::Start},
    {"fuk", Fit::Start},        {"shit", Fit::Inside},     {"bitch", Fit::Inside},
    {"cunt", Fit::Start},       {"twat", Fit::Start},     {"bastard", Fit::Inside},
    {"wank", Fit::Start},       {"ass", Fit::Whole},       {"arse", Fit::Whole},
    {"asshole", Fit::Inside},   {"arsehole", Fit::Inside}, {"asswipe", Fit::Inside},
    {"asshat", Fit::Inside},    {"dumbass", Fit::Inside},  {"jackass", Fit::Inside},
    {"dick", Fit::Whole},       {"dickhead", Fit::Inside}, {"cock", Fit::Whole},
    {"cocksucker", Fit::Inside},
    // Sexual.
    {"pussy", Fit::Whole},      {"pussies", Fit::Whole},   {"tits", Fit::Whole},
    {"titty", Fit::Whole},      {"titties", Fit::Whole},   {"cum", Fit::Whole},
    {"cumshot", Fit::Inside},   {"jizz", Fit::Inside},     {"slut", Fit::Inside},
    {"whore", Fit::Inside},     {"porn", Fit::Inside},     {"dildo", Fit::Inside},
    {"blowjob", Fit::Inside},   {"handjob", Fit::Inside},  {"milf", Fit::Whole},
    {"rape", Fit::Whole},       {"raped", Fit::Whole},     {"raping", Fit::Whole},
    {"rapist", Fit::Whole},
    // Slurs.
    {"nigger", Fit::Inside},    {"nigga", Fit::Inside},    {"faggot", Fit::Inside},
    {"fagot", Fit::Whole},      {"fag", Fit::Whole},       {"dyke", Fit::Whole},
    {"tranny", Fit::Whole},     {"trannies", Fit::Whole},  {"retard", Fit::Start},
    {"chink", Fit::Whole},      {"spic", Fit::Whole},      {"kike", Fit::Whole},
    {"gook", Fit::Whole},       {"coon", Fit::Whole},      {"paki", Fit::Whole},
    {"beaner", Fit::Whole},     {"wetback", Fit::Inside},  {"raghead", Fit::Inside},
    {"towelhead", Fit::Inside},
    // Harassment.
    {"kys", Fit::Whole},        {"killyourself", Fit::Inside},
};

/// Real words a listed one sits inside. A match that lies wholly within one
/// of these is let through.
constexpr Listed kAllowed[] = {
    {"snigger", Fit::Inside},       // sniggers, sniggering
    {"niggard", Fit::Inside},       // niggardly
    {"shiitake", Fit::Inside},
    {"shitake", Fit::Inside},
    {"shitzu", Fit::Inside},        // the dog, as it is usually misspelt
    {"fuku", Fit::Start},           // Fukushima, Fukuoka
    {"retardant", Fit::Inside},     // flame retardant
    {"retardation", Fit::Inside},
};

// ---------------------------------------------------------------------------
// Reading a character
// ---------------------------------------------------------------------------

constexpr std::uint32_t letter(char c) { return 1u << (c - 'a'); }

/// What one drawn character is to the filter.
enum class Kind : std::uint8_t {
    /// Reads as one or more letters.
    Letter,
    /// Punctuation, a symbol, an emoji, a letter no listed word has: ends a
    /// word, unless the word is being read straight through its punctuation.
    Mark,
    /// Draws nothing -- a zero-width space, a combining accent -- and is read
    /// straight through everywhere.
    Hidden,
    /// A space, a line break, a picture: always ends a word.
    Gap,
};

/// One drawn character, folded for matching.
struct Cell {
    /// Bit n set: the character reads as 'a' + n.
    std::uint32_t letters = 0;
    /// A digit or symbol standing in for a letter -- the '1' of "sh1t", the
    /// '$'s of "a$$". It may as well be a digit or a '!' that only sits next
    /// to a word ("ass!", "ass1"), so a match never NEEDS one beside it, and a
    /// match made of nothing else ("455") is a number, not a word.
    bool standIn = false;
};

/// U+00C0-U+00FF and U+0100-U+017F, each the letter it is drawn as with its
/// accent taken off; '.' for the few that are not one letter (Æ, ×, Œ, Þ).
constexpr char kLatin1[] = "aaaaaa.ceeeeiiiidnooooo.ouuuuy.s"
                           "aaaaaa.ceeeeiiiidnooooo.ouuuuy.y";
constexpr char kLatinExtendedA[] = "aaaaaacccccccc" "dddd" "eeeeeeeeee" "gggggggg" "hhhh"
                                   "iiiiiiiiii" ".." "jj" "kkk" "llllllllll" "nnnnnnnnn"
                                   "oooooo" ".." "rrrrrr" "ssssssss" "tttttt" "uuuuuuuuuuuu"
                                   "ww" "yyy" "zzzzzz" "s";
static_assert(sizeof(kLatin1) - 1 == 0x40, "one letter per code point, U+00C0-U+00FF");
static_assert(sizeof(kLatinExtendedA) - 1 == 0x80, "one letter per code point, U+0100-U+017F");

/// Letters of other scripts drawn exactly like a Latin one -- the Cyrillic
/// "а" in a word that otherwise reads "fuck" -- and the small capitals fancy
/// text is made of.
struct LookAlike {
    std::uint32_t codePoint;
    char reads;
};
constexpr LookAlike kLookAlikes[] = {
    // Greek.
    {0x0391, 'a'}, {0x0392, 'b'}, {0x0395, 'e'}, {0x0396, 'z'}, {0x0397, 'h'}, {0x0399, 'i'},
    {0x039A, 'k'}, {0x039C, 'm'}, {0x039D, 'n'}, {0x039F, 'o'}, {0x03A1, 'p'}, {0x03A4, 't'},
    {0x03A5, 'y'}, {0x03A7, 'x'}, {0x03B1, 'a'}, {0x03B2, 'b'}, {0x03B5, 'e'}, {0x03B7, 'n'},
    {0x03B9, 'i'}, {0x03BA, 'k'}, {0x03BD, 'v'}, {0x03BF, 'o'}, {0x03C1, 'p'}, {0x03C4, 't'},
    {0x03C5, 'u'}, {0x03C7, 'x'}, {0x03C9, 'w'},
    // Cyrillic.
    {0x0401, 'e'}, {0x0405, 's'}, {0x0406, 'i'}, {0x0408, 'j'}, {0x0410, 'a'}, {0x0412, 'b'},
    {0x0415, 'e'}, {0x041A, 'k'}, {0x041C, 'm'}, {0x041D, 'h'}, {0x041E, 'o'}, {0x0420, 'p'},
    {0x0421, 'c'}, {0x0422, 't'}, {0x0423, 'y'}, {0x0425, 'x'}, {0x0430, 'a'}, {0x0432, 'b'},
    {0x0435, 'e'}, {0x043A, 'k'}, {0x043C, 'm'}, {0x043D, 'h'}, {0x043E, 'o'}, {0x043F, 'n'},
    {0x0440, 'p'}, {0x0441, 'c'}, {0x0442, 't'}, {0x0443, 'y'}, {0x0445, 'x'}, {0x0446, 'u'},
    {0x0448, 'w'}, {0x0451, 'e'}, {0x0455, 's'}, {0x0456, 'i'}, {0x0458, 'j'}, {0x0501, 'd'},
    // Small capitals.
    {0x01EB, 'q'}, {0x0262, 'g'}, {0x026A, 'i'}, {0x0274, 'n'}, {0x0280, 'r'}, {0x028F, 'y'},
    {0x0299, 'b'}, {0x029C, 'h'}, {0x029F, 'l'}, {0x1D00, 'a'}, {0x1D04, 'c'}, {0x1D05, 'd'},
    {0x1D07, 'e'}, {0x1D0A, 'j'}, {0x1D0B, 'k'}, {0x1D0D, 'm'}, {0x1D0F, 'o'}, {0x1D18, 'p'},
    {0x1D1B, 't'}, {0x1D1C, 'u'}, {0x1D20, 'v'}, {0x1D21, 'w'}, {0x1D22, 'z'}, {0xA730, 'f'},
    {0xA731, 's'},
};

/// Digits and symbols written for letters.
struct StandIn {
    std::uint32_t codePoint;
    const char* reads;
};
constexpr StandIn kStandIns[] = {
    {'0', "o"}, {'1', "il"}, {'3', "e"}, {'4', "a"}, {'5', "s"}, {'7', "t"}, {'8', "b"},
    {'9', "g"}, {'@', "a"},  {'$', "s"}, {'!', "i"}, {'|', "il"},
    {0x00A1, "i"},  // ¡
    {0x20AC, "e"},  // €
};

/// Where an a-z alphabet starts in the enclosed and squared letter blocks:
/// ⒜, Ⓐ, ⓐ, 🄐, 🄰, 🅐, 🅰 and the regional indicators 🇦.
constexpr std::uint32_t kEnclosedAlphabets[] = {
    0x249C, 0x24B6, 0x24D0, 0x1F110, 0x1F130, 0x1F150, 0x1F170, 0x1F1E6,
};

struct Range {
    std::uint32_t first;
    std::uint32_t last;
};

/// Characters that draw nothing: soft hyphen, combining marks, zero-width
/// spaces and joiners, direction controls, variation selectors, tags.
constexpr Range kHidden[] = {
    {0x00AD, 0x00AD}, {0x0300, 0x036F}, {0x0483, 0x0489}, {0x061C, 0x061C},
    {0x115F, 0x1160}, {0x17B4, 0x17B5}, {0x180B, 0x180F}, {0x1AB0, 0x1AFF},
    {0x1DC0, 0x1DFF}, {0x200B, 0x200F}, {0x202A, 0x202E}, {0x2060, 0x206F},
    {0x20D0, 0x20FF}, {0xFE00, 0xFE0F}, {0xFE20, 0xFE2F}, {0xFEFF, 0xFEFF},
    {0x1D173, 0x1D17A}, {0xE0000, 0xE0FFF},
};

/// Characters that draw as blank space.
constexpr Range kGaps[] = {
    {0x0020, 0x0020}, {0x00A0, 0x00A0}, {0x1680, 0x1680}, {0x2000, 0x200A},
    {0x2028, 0x2029}, {0x202F, 0x202F}, {0x205F, 0x205F}, {0x3000, 0x3000},
    {0x3164, 0x3164}, {0xFFA0, 0xFFA0},
};

template <std::size_t N>
bool within(std::uint32_t codePoint, const Range (&ranges)[N]) {
    for (const Range& range : ranges) {
        if (codePoint >= range.first && codePoint <= range.last) return true;
    }
    return false;
}

/// What `codePoint` is to the filter, with the letters it reads as put in
/// `cell`.
Kind read(std::uint32_t codePoint, Cell& cell) {
    // Fancy text first, folded onto the plain letter or digit it is drawn as.
    if (codePoint >= 0xFF01 && codePoint <= 0xFF5E) {
        codePoint -= 0xFEE0;    // fullwidth ASCII
    } else if (codePoint >= 0x1D400 && codePoint <= 0x1D6A3) {
        // Mathematical letters: bold, italic, script, fraktur, double-struck,
        // sans-serif and monospace, each an A-Z then an a-z.
        codePoint = 'a' + (codePoint - 0x1D400) % 52 % 26;
    } else if (codePoint >= 0x1D7CE && codePoint <= 0x1D7FF) {
        codePoint = '0' + (codePoint - 0x1D7CE) % 10;   // mathematical digits
    } else {
        for (const std::uint32_t first : kEnclosedAlphabets) {
            if (codePoint >= first && codePoint < first + 26) {
                codePoint = 'a' + (codePoint - first);
                break;
            }
        }
    }

    if (codePoint >= 'A' && codePoint <= 'Z') codePoint += 'a' - 'A';
    if (codePoint >= 'a' && codePoint <= 'z') {
        cell.letters = letter(static_cast<char>(codePoint));
        // A 'v' is a 'u' with a point on it: "fvck".
        if (codePoint == 'v') cell.letters |= letter('u');
        return Kind::Letter;
    }
    for (const StandIn& standIn : kStandIns) {
        if (codePoint != standIn.codePoint) continue;
        for (const char* c = standIn.reads; *c != '\0'; ++c) cell.letters |= letter(*c);
        cell.standIn = true;
        return Kind::Letter;
    }
    if (codePoint < 0x80) return within(codePoint, kGaps) ? Kind::Gap : Kind::Mark;

    char base = '.';
    if (codePoint >= 0xC0 && codePoint < 0x100) {
        base = kLatin1[codePoint - 0xC0];
    } else if (codePoint >= 0x100 && codePoint < 0x180) {
        base = kLatinExtendedA[codePoint - 0x100];
    } else {
        for (const LookAlike& lookAlike : kLookAlikes) {
            if (lookAlike.codePoint == codePoint) {
                base = lookAlike.reads;
                break;
            }
        }
    }
    if (base != '.') {
        cell.letters = letter(base);
        return Kind::Letter;
    }
    if (within(codePoint, kHidden)) return Kind::Hidden;
    if (within(codePoint, kGaps)) return Kind::Gap;
    return Kind::Mark;
}

/// The code point starting at `text[at]`, with its length in bytes. A byte
/// that does not start a well-formed sequence is one byte of U+FFFD.
std::uint32_t decodeAt(const std::string& text, std::size_t at, std::size_t& length) {
    const auto byte = [&](std::size_t i) { return static_cast<unsigned char>(text[i]); };
    const unsigned char lead = byte(at);
    length = 1;
    if (lead < 0x80) return lead;
    std::size_t need = 0;
    std::uint32_t codePoint = 0;
    std::uint32_t smallest = 0;
    if ((lead & 0xE0) == 0xC0) {
        need = 2; codePoint = lead & 0x1F; smallest = 0x80;
    } else if ((lead & 0xF0) == 0xE0) {
        need = 3; codePoint = lead & 0x0F; smallest = 0x800;
    } else if ((lead & 0xF8) == 0xF0) {
        need = 4; codePoint = lead & 0x07; smallest = 0x10000;
    } else {
        return 0xFFFD;
    }
    if (at + need > text.size()) return 0xFFFD;
    for (std::size_t i = 1; i < need; ++i) {
        if ((byte(at + i) & 0xC0) != 0x80) return 0xFFFD;
        codePoint = codePoint << 6 | (byte(at + i) & 0x3F);
    }
    if (codePoint < smallest || codePoint > 0x10FFFF) return 0xFFFD;
    length = need;
    return codePoint;
}

// ---------------------------------------------------------------------------
// Reading a line
// ---------------------------------------------------------------------------

struct Drawn {
    Kind kind;
    Cell cell;
};

/// Every character `source` draws, in order, read as a client does --
/// honouring <a> or dropping it with its content, as `links` says.
std::vector<Drawn> drawnCharacters(const std::string& source, bool links) {
    MarkupOptions options;
    options.links = links;
    std::vector<Drawn> drawn;
    for (const MarkupSpan& span : parseMarkup(source, options)) {
        if (span.lineBreak || !span.image.empty()) {
            drawn.push_back({Kind::Gap, {}});
            continue;
        }
        for (std::size_t at = 0; at < span.text.size();) {
            std::size_t length = 1;
            const std::uint32_t codePoint = decodeAt(span.text, at, length);
            Drawn character{Kind::Mark, {}};
            character.kind = read(codePoint, character.cell);
            drawn.push_back(character);
            at += length;
        }
    }
    return drawn;
}

struct Word {
    std::vector<Cell> cells;
    /// Read through its punctuation, and where each written piece of it
    /// starts. A match there must start where a piece does: "f.u.c.k" and
    /// "fu-ck" are spelled round the filter, but "rabbit-chasing" and
    /// "mis-hit" only happen to have "bitch" and "shit" across the hyphen.
    bool through = false;
    std::vector<bool> pieceStarts;
};

/// The words a reader can make out of `drawn`, three ways over:
///
///  * as written, split at every space and every mark: "ass!" is "ass";
///  * through its punctuation, split at spaces alone: "f.u.c.k", "fu-ck";
///  * spelled out, a run of one-letter words read as one: "f u c k".
std::vector<Word> wordsIn(const std::vector<Drawn>& drawn) {
    std::vector<Word> words;
    Word written;
    Word through;
    through.through = true;
    bool pieceOpen = false;     // the last thing `through` took was a letter
    bool throughMarks = false;  // whether `through` differs from what was written
    Word spelled;

    const auto endSpelled = [&]() {
        if (spelled.cells.size() >= 2) words.push_back(spelled);
        spelled.cells.clear();
    };
    const auto endWritten = [&]() {
        if (written.cells.empty()) return;
        if (written.cells.size() == 1) spelled.cells.push_back(written.cells.front());
        else endSpelled();
        words.push_back(std::move(written));
        written.cells.clear();
    };
    const auto endThrough = [&]() {
        if (throughMarks) words.push_back(through);
        through.cells.clear();
        through.pieceStarts.clear();
        throughMarks = false;
    };

    for (const Drawn& character : drawn) {
        switch (character.kind) {
            case Kind::Letter:
                written.cells.push_back(character.cell);
                through.cells.push_back(character.cell);
                through.pieceStarts.push_back(!pieceOpen);
                pieceOpen = true;
                break;
            case Kind::Hidden:
                break;
            case Kind::Mark:
                endWritten();
                if (!through.cells.empty()) throughMarks = true;
                pieceOpen = false;
                break;
            case Kind::Gap:
                endWritten();
                endThrough();
                pieceOpen = false;
                break;
        }
    }
    endWritten();
    endThrough();
    endSpelled();
    return words;
}

constexpr std::size_t kNoMatch = static_cast<std::size_t>(-1);

/// Where `pattern` ends if it starts at `word[at]`, or kNoMatch. Each letter
/// of it takes as many cells in a row as the pattern has of it in a row --
/// or, held, three or more: "fuuuck" is "fuck" and "asss" is "ass". Two of a
/// single letter is not a hold but how English spells, and reading it as one
/// would find "porn" in "poorness" and "rape" in "rapping"; one of a double
/// is a different word, so "as" is never "ass".
std::size_t matchEnd(const std::vector<Cell>& word, std::size_t at, const char* pattern) {
    if (*pattern == '\0') return at;
    std::size_t count = 1;
    while (pattern[count] == *pattern) ++count;
    const std::uint32_t wanted = letter(*pattern);
    std::size_t run = 0;
    while (at + run < word.size() && (word[at + run].letters & wanted) != 0) ++run;
    // Longest first, so a held letter is starred out whole.
    const std::size_t held = std::max<std::size_t>(3, count + 1);
    for (std::size_t take = run; take >= held; --take) {
        const std::size_t matched = matchEnd(word, at + take, pattern + count);
        if (matched != kNoMatch) return matched;
    }
    return run >= count ? matchEnd(word, at + count, pattern + count) : kNoMatch;
}

bool onlyStandIns(const std::vector<Cell>& word, std::size_t from, std::size_t to) {
    for (std::size_t i = from; i < to; ++i) {
        if (!word[i].standIn) return false;
    }
    return true;
}

/// Whether a whole word can end at `word[to]`: nothing after it but
/// stand-ins, with a plural "s" or "es" before them. The plural is spelled
/// exactly -- held, it would read "assess" as "ass" + "ess".
bool endsWord(const std::vector<Cell>& word, std::size_t to) {
    const auto reads = [&](std::size_t i, char c) {
        return i < word.size() && (word[i].letters & letter(c)) != 0;
    };
    if (onlyStandIns(word, to, word.size())) return true;
    if (reads(to, 's') && onlyStandIns(word, to + 1, word.size())) return true;
    return reads(to, 'e') && reads(to + 1, 's') && onlyStandIns(word, to + 2, word.size());
}

/// Calls `found(from, to)` for every place `listed` fits in `word` until it
/// returns true, and says whether it did.
template <typename Found>
bool findListed(const Word& read, const Listed& listed, Found&& found) {
    const std::vector<Cell>& word = read.cells;
    // Most listed words need a letter this word does not have at all, and are
    // over before the quadratic part: a line of 200 's's was 1.5 ms without.
    std::uint32_t present = 0;
    for (const Cell& cell : word) present |= cell.letters;
    for (const char* c = listed.word; *c != '\0'; ++c) {
        if ((present & letter(*c)) == 0) return false;
    }
    for (std::size_t from = 0; from < word.size(); ++from) {
        // A word that has to start one may only have stand-ins before it.
        if (from > 0 && listed.fit != Fit::Inside && !word[from - 1].standIn) break;
        if (read.through && !read.pieceStarts[from]) continue;
        const std::size_t to = matchEnd(word, from, listed.word);
        if (to == kNoMatch) continue;
        if (onlyStandIns(word, from, to)) continue;
        if (listed.fit == Fit::Whole && !endsWord(word, to)) continue;
        if (found(from, to)) return true;
    }
    return false;
}

/// The first listed word `source` draws, read with or without <a>, or null.
const char* findBlocked(const std::string& source, bool links) {
    for (const Word& word : wordsIn(drawnCharacters(source, links))) {
        std::vector<std::pair<std::size_t, std::size_t>> allowed;
        for (const Listed& listed : kAllowed) {
            findListed(word, listed, [&](std::size_t from, std::size_t to) {
                allowed.emplace_back(from, to);
                return false;
            });
        }
        for (const Listed& listed : kBlocked) {
            const bool found = findListed(word, listed, [&](std::size_t from, std::size_t to) {
                for (const auto& [first, last] : allowed) {
                    if (first <= from && to <= last) return false;
                }
                return true;
            });
            if (found) return listed.word;
        }
    }
    return nullptr;
}

} // namespace

std::string blockedWordIn(const std::string& line) {
    for (const bool links : {true, false}) {
        if (const char* word = findBlocked(line, links)) return word;
    }
    return {};
}

// ---------------------------------------------------------------------------
// Spam
// ---------------------------------------------------------------------------

namespace {

/// What a picture is to the spam checks: one character of its own, U+FFFC
/// OBJECT REPLACEMENT CHARACTER.
constexpr std::uint32_t kPicture = 0xFFFC;

/// Calls `drawn(codePoint, span)` for every character `line` draws, as the
/// web build draws it -- the reading with the most on screen. A space, a
/// line break or any other blank is ' ', a picture kPicture, and a character
/// that draws nothing is left out, so "a\u200Ba\u200Ba" is "aaa".
template <typename Drawn>
void eachDrawn(const std::string& line, Drawn&& drawn) {
    MarkupOptions options;
    options.links = true;
    for (const MarkupSpan& span : parseMarkup(line, options)) {
        if (span.lineBreak) {
            drawn(' ', span);
            continue;
        }
        if (!span.image.empty()) {
            drawn(kPicture, span);
            continue;
        }
        for (std::size_t at = 0; at < span.text.size();) {
            std::size_t length = 1;
            const std::uint32_t codePoint = decodeAt(span.text, at, length);
            at += length;
            if (within(codePoint, kHidden)) continue;
            drawn(within(codePoint, kGaps) ? std::uint32_t{' '} : codePoint, span);
        }
    }
}

} // namespace

std::string chatRepeatKey(const std::string& line) {
    std::string key;
    std::string text;
    eachDrawn(line, [&](std::uint32_t codePoint, const MarkupSpan& span) {
        appendUtf8(text, codePoint == kPicture ? std::uint32_t{'?'} : codePoint);
        if (codePoint == kPicture) {
            key += '\x01';
            key += span.image;
            key += '\x01';
            return;
        }
        // A letter however it is dressed -- "Hï" is "hi" -- and a digit as
        // itself: "gg" and "99" are different lines.
        Cell cell;
        const Kind kind = read(codePoint, cell);
        if (kind == Kind::Letter && !cell.standIn) {
            char first = 'a';
            while ((cell.letters & letter(first)) == 0) ++first;
            key += first;
        } else if (codePoint >= '0' && codePoint <= '9') {
            key += static_cast<char>(codePoint);
        } else if (codePoint >= 0x80) {
            appendUtf8(key, codePoint);   // an emoji, a letter of another script
        }
    });
    return key.empty() ? trimmed(text) : key;
}

bool chatLineFloods(const std::string& line) {
    // Blank runs folded to one blank: twenty spaces between two words are
    // not on anyone's screen as twenty of anything.
    std::vector<std::uint32_t> drawn;
    eachDrawn(line, [&](std::uint32_t codePoint, const MarkupSpan&) {
        if (codePoint >= 'A' && codePoint <= 'Z') codePoint += 'a' - 'A';
        if (codePoint == ' ' && !drawn.empty() && drawn.back() == ' ') return;
        drawn.push_back(codePoint);
    });
    constexpr std::size_t kLongestUnit = 10;
    constexpr std::size_t kSpan = kChatFloodSpan;
    for (std::size_t unit = 1; unit <= kLongestUnit; ++unit) {
        // How many characters in a row have matched the one `unit` back: the
        // stretch is that many plus the unit they repeat.
        std::size_t run = 0;
        for (std::size_t i = unit; i < drawn.size(); ++i) {
            run = drawn[i] == drawn[i - unit] ? run + 1 : 0;
            const std::size_t stretch = run + unit;
            if (stretch >= kSpan && stretch >= 4 * unit) return true;
        }
    }
    return false;
}

bool chatLineDrawsNothing(const std::string& line) {
    bool drawsSomething = false;
    eachDrawn(line, [&](std::uint32_t codePoint, const MarkupSpan&) {
        if (codePoint != ' ') drawsSomething = true;
    });
    return !drawsSomething;
}

} // namespace flix
