#include "server/chat_moderation.h"

#include "server/text.h"
#include "shared/core/json.h"
#include "shared/core/text.h"
#include "shared/game/markup.h"

#include <algorithm>
#include <cstdint>
#include <initializer_list>
#include <iterator>
#include <utility>
#include <cstring>
#include <vector>

namespace flix {

namespace {

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

/// The built-in lists' rows. TermFit's names are short for these tables.
struct Listed {
    const char* word;   ///< lower-case a-z
    TermFit fit;
};

namespace Fit {
constexpr TermFit Inside = TermFit::Anywhere;
constexpr TermFit Start = TermFit::Start;
constexpr TermFit Whole = TermFit::Word;
} // namespace Fit

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
    {"semen", Fit::Whole},      {"sperm", Fit::Whole},     {"ejaculate", Fit::Start},
    {"ejaculation", Fit::Whole},{"masturbat", Fit::Start}, {"orgasm", Fit::Start},
    {"penis", Fit::Whole},      {"vagina", Fit::Whole},    {"testicle", Fit::Whole},
    {"scrotum", Fit::Whole},    {"clitoris", Fit::Whole},  {"clit", Fit::Whole},
    {"fap", Fit::Whole},        {"hentai", Fit::Whole},    {"pornography", Fit::Whole},
    {"cumming", Fit::Whole},    {"cummed", Fit::Whole},    {"cumdump", Fit::Start},
    {"cumbucket", Fit::Whole},  {"cumslut", Fit::Whole},   {"deepthroat", Fit::Start},
    {"rimjob", Fit::Whole},     {"gangbang", Fit::Start},  {"bukkake", Fit::Whole},
    {"buttplug", Fit::Whole},   {"buttfuck", Fit::Inside}, {"dickface", Fit::Whole},
    {"dickwad", Fit::Whole},    {"dickbag", Fit::Whole},   {"cocksuck", Fit::Start},
    {"shithead", Fit::Whole},   {"shitface", Fit::Start},  {"dipshit", Fit::Whole},
    // Slurs.
    {"nigger", Fit::Inside},    {"nigga", Fit::Inside},    {"faggot", Fit::Inside},
    {"fagot", Fit::Whole},      {"fag", Fit::Whole},       {"dyke", Fit::Whole},
    {"tranny", Fit::Whole},     {"trannies", Fit::Whole},  {"retard", Fit::Start},
    {"chink", Fit::Whole},      {"spic", Fit::Whole},      {"kike", Fit::Whole},
    {"gook", Fit::Whole},       {"coon", Fit::Whole},      {"paki", Fit::Whole},
    {"beaner", Fit::Whole},     {"wetback", Fit::Inside},  {"raghead", Fit::Inside},
    {"towelhead", Fit::Inside}, {"niglet", Fit::Inside},
    {"nignog", Fit::Inside},    {"negroid", Fit::Whole},
    {"zipperhead", Fit::Inside}, {"porchmonkey", Fit::Inside},
    {"shemale", Fit::Whole},    {"mongoloid", Fit::Whole},
    {"niglette", Fit::Inside},  {"niglets", Fit::Inside},  {"nigg", Fit::Whole},
    {"nig", Fit::Whole},        {"niggah", Fit::Whole},    {"nigguh", Fit::Whole},
    {"fagg", Fit::Whole},       {"faggit", Fit::Whole},    {"faggy", Fit::Whole},
    {"faggotry", Fit::Whole},   {"retarded", Fit::Whole},  {"tard", Fit::Whole},
    {"libtard", Fit::Whole},    {"cuck", Fit::Whole},      {"cuckold", Fit::Whole},
    {"chinky", Fit::Whole},     {"chinaman", Fit::Whole},  {"darkie", Fit::Whole},
    {"darky", Fit::Whole},      {"redskin", Fit::Whole},   {"sandnigger", Fit::Whole},
    // Harassment.
    {"killurself", Fit::Whole}, {"killyourselfirl", Fit::Whole},
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

/// Two ordinary words that spell a listed one when the space between them is
/// read through, which is how "fu ck" is caught. Nobody means anything by
/// these, and "Red Skin" is the obvious name for a red skin.
struct InnocentPair {
    const char* first;
    const char* second;
};
constexpr InnocentPair kInnocentPairs[] = {
    {"go", "ok"},       // gook
    {"pen", "is"},      // penis
    {"red", "skin"},    // redskin
};

/// What leads into a whole-word listed one in a name, which has no space to
/// end a word with: "bigdick", "kissmyass". The whole name has to be these
/// and the listed word, so "Amyass" is safe. "the" is not one: "therapist".
constexpr const char* kNameLeadIns[] = {
    "big", "eat", "fat", "hairy", "hot", "huge", "kiss", "lick", "my", "nice", "sexy", "suck",
    "ur", "wet", "your",
};

/// Listed words not read backwards from plain letters, each for what it
/// reverses into: the exclamation "drat" and the names Esra, Nemes and Huggin.
/// Written in stand-ins they still are: nobody's name is "n3m3s".
constexpr const char* kNotReversed[] = {"tard", "arse", "semen", "nigguh"};

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
    {'2', "zs"}, {'6', "gb"}, {'9', "g"}, {'+', "t"}, {'@', "a"},  {'$', "s"}, {'!', "i"}, {'|', "il"},
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
    {0xFFF9, 0xFFFB},
    {0x1D173, 0x1D17A}, {0xE0000, 0xE0FFF},
};

/// The controls that make a browser draw Latin letters out of the order they
/// are stored in: RLE, RLO, RLI and FSI. Nothing else can -- with none of these
/// open a Latin letter stays at an even bidi level, and those never swap, so a
/// bare U+200F, a left-to-right control and typed Hebrew or Arabic are all fine.
constexpr Range kReversing[] = {
    {0x202B, 0x202B}, {0x202E, 0x202E}, {0x2067, 0x2068},
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
    if (codePoint < smallest || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return 0xFFFD;
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
            struct Glyph { const char* text; const char* reads; };
            static constexpr Glyph glyphs[] = {
                {"|-|","h"}, {"|_|","u"}, {"|<","k"}, {"|{","k"},
                {"|)","d"}, {"|3","b"}, {"|2","r"}, {"/\\","a"}, {"\\/","uv"},
            };
            bool glyph=false;
            for(const auto& g:glyphs) {
                const auto size=std::strlen(g.text);
                if(span.text.compare(at,size,g.text)!=0)continue;
                Cell cell;cell.standIn=true;
                for(const char* c=g.reads;*c;++c)cell.letters|=letter(*c);
                drawn.push_back({Kind::Letter,cell});at+=size;glyph=true;break;
            }
            if(glyph)continue;
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
    bool spaced = false;
    std::vector<bool> pieceStarts;
    /// Read across spaces: how many chunks it was made of, and where the
    /// first one ends.
    std::size_t chunks = 0;
    std::size_t firstChunkEnd = 0;
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
    // Read whole chunks across separators, never a suffix of an innocent
    // word ("push it"). Bound the work even for a line of tiny chunks.
    for (std::size_t start = 0; start < drawn.size(); ++start) {
        if (drawn[start].kind != Kind::Letter ||
            (start > 0 && (drawn[start - 1].kind == Kind::Letter ||
                           drawn[start - 1].kind == Kind::Hidden))) continue;
        Word joined;
        joined.through = true;
        joined.spaced = true;
        bool gap = false;
        bool chunkOpen = false;
        for (std::size_t i = start; i < drawn.size() && joined.cells.size() < 32; ++i) {
            if (drawn[i].kind == Kind::Letter) {
                joined.pieceStarts.push_back(joined.cells.empty());
                joined.cells.push_back(drawn[i].cell);
                if (!chunkOpen) ++joined.chunks;
                chunkOpen = true;
            } else if (drawn[i].kind != Kind::Hidden) {
                if (joined.chunks == 1 && chunkOpen) joined.firstChunkEnd = joined.cells.size();
                chunkOpen = false;
                if (gap && !joined.cells.empty()) words.push_back(joined);
                gap = gap || drawn[i].kind == Kind::Gap;
            }
        }
        if (gap && !joined.cells.empty()) words.push_back(joined);
    }
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

/// Calls `found(from, to)` for every place `listed`, as `fit` says, fits in
/// `word` until it returns true, and says whether it did.
template <typename Found>
bool findListed(const Word& read, const char* listed, TermFit fit, Found&& found) {
    const std::vector<Cell>& word = read.cells;
    // Most listed words need a letter this word does not have at all, and are
    // over before the quadratic part: a line of 200 's's was 1.5 ms without.
    std::uint32_t present = 0;
    for (const Cell& cell : word) present |= cell.letters;
    for (const char* c = listed; *c != '\0'; ++c) {
        if ((present & letter(*c)) == 0) return false;
    }
    for (std::size_t from = 0; from < word.size(); ++from) {
        // A word that has to start one may only have stand-ins before it.
        if (from > 0 && fit != Fit::Inside && !word[from - 1].standIn) break;
        if (read.through && !read.pieceStarts[from]) continue;
        const std::size_t to = matchEnd(word, from, listed);
        if (to == kNoMatch) continue;
        if (read.spaced && to != word.size()) continue;
        if (onlyStandIns(word, from, to)) continue;
        if (fit == Fit::Whole && !endsWord(word, to)) continue;
        if (found(from, to)) return true;
    }
    return false;
}

/// Whether `word`, read across a space, is exactly one of kInnocentPairs.
bool isInnocentPair(const Word& word) {
    if (!word.spaced || word.chunks != 2) return false;
    for (const InnocentPair& pair : kInnocentPairs) {
        if (matchEnd(word.cells, 0, pair.first) == word.firstChunkEnd &&
            matchEnd(word.cells, word.firstChunkEnd, pair.second) == word.cells.size()) {
            return true;
        }
    }
    return false;
}

/// The first listed word `source` draws, read with or without <a>, or null.
const char* findBlocked(const std::string& source, bool links, const ChatTerms& terms) {
    for (const Word& word : wordsIn(drawnCharacters(source, links))) {
        if (isInnocentPair(word)) continue;
        std::vector<std::pair<std::size_t, std::size_t>> allowed;
        for (const ChatTerm& listed : terms.allowed) {
            findListed(word, listed.word.c_str(), listed.fit, [&](std::size_t from, std::size_t to) {
                allowed.emplace_back(from, to);
                return false;
            });
        }
        const auto inAllowed = [&](std::size_t from, std::size_t to) {
            for (const auto& [first, last] : allowed) {
                if (first <= from && to <= last) return true;
            }
            return false;
        };
        for (const ChatTerm& listed : terms.blocked) {
            const bool found = findListed(word, listed.word.c_str(), listed.fit,
                                          [&](std::size_t from, std::size_t to) {
                                              return !inAllowed(from, to);
                                          });
            if (found) return listed.word.c_str();
        }
        if(word.cells.size()<4)continue;
        Word reversed;
        reversed.cells.assign(word.cells.rbegin(),word.cells.rend());
        const bool plain=std::none_of(word.cells.begin(),word.cells.end(),[](const Cell& cell) {
            return cell.standIn;
        });
        for(const ChatTerm& listed:terms.blocked) {
            if(listed.word.size()<4)continue;
            if(plain&&std::any_of(std::begin(kNotReversed),std::end(kNotReversed),[&](const char* name) {
                return listed.word==name;
            }))continue;
            // An allowed word read backwards lets the reversal through too, so
            // a moderator's "allow" covers both readings of the word it names.
            const bool found = findListed(reversed, listed.word.c_str(), Fit::Whole,
                                          [&](std::size_t from, std::size_t to) {
                                              return !inAllowed(word.cells.size() - to,
                                                                word.cells.size() - from);
                                          });
            if(found)return listed.word.c_str();
        }
    }
    return nullptr;
}

const char* findBlockedChinese(const std::string& source,bool links) {
    static constexpr const char* phrases[]={
        "傻逼","傻比","傻屄","煞笔","煞筆","操你妈","操你媽","肏你妈","肏你媽",
        "草你妈","草你媽","艹你妈","艹你媽","你妈逼","你媽逼","你妈的","你媽的",
        "他妈的","他媽的","去你妈","去你媽","狗日的","王八蛋","婊子","贱人","賤人",
        "鸡巴","雞巴","鸡吧","雞吧","龟头","龜頭","精液","阴茎","陰莖",
        "阴道","陰道","淫荡","淫蕩","肛交","口交","性交","肉棒",
    };
    MarkupOptions options;options.links=links;
    std::vector<std::uint32_t> text;
    bool hasHan=false;
    for(const auto& span:parseMarkup(source,options)) {
        if(span.lineBreak||!span.image.empty()){text.push_back(0xFFFD);continue;}
        for(std::size_t at=0;at<span.text.size();) {
            std::size_t length=1;const auto cp=decodeAt(span.text,at,length);at+=length;
            if(within(cp,kHidden))continue;
            hasHan=hasHan || (cp>=0x3400 && cp<=0x9FFF);
            Cell cell;const Kind kind=read(cp,cell);
            if(within(cp,kGaps)|| (kind==Kind::Mark && (cp<0x80 ||
                (cp>=0x2000&&cp<=0x206F)||(cp>=0x3000&&cp<=0x303F)||
                (cp>=0xFF01&&cp<=0xFF65))))text.push_back(0);
            else text.push_back(cp);
        }
    }
    if(!hasHan)return nullptr;
    // Patterns are decoded once, instead of allocating/decoding for every line.
    static const auto patterns=[] {
        std::vector<std::vector<std::uint32_t>> result;
        for(const char* phrase:phrases) {
            std::vector<std::uint32_t> pattern;const std::string value=phrase;
            for(std::size_t at=0;at<value.size();){std::size_t size=1;pattern.push_back(decodeAt(value,at,size));at+=size;}
            result.push_back(std::move(pattern));
        }
        return result;
    }();
    for(std::size_t i=0;i<text.size();++i)for(std::size_t p=0;p<patterns.size();++p) {
        const auto& pattern=patterns[p];if(text[i]!=pattern.front())continue;
        const auto matches=[&]() {
            std::size_t at=i;
            for(std::size_t c=0;c<pattern.size();++c) {
                int skipped=0;while(at<text.size()&&text[at]==0&&skipped++<3)++at;
                if(at>=text.size()||text[at++]!=pattern[c])return false;
            }
            return true;
        };
        if(matches())return phrases[p];
    }
    return nullptr;
}

} // namespace

std::string blockedWordIn(const std::string& line, const ChatTerms& terms) {
    for (const bool links : {true, false}) {
        if (const char* word = findBlocked(line, links, terms)) return word;
        if (const char* word = findBlockedChinese(line, links)) return word;
    }
    return {};
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

namespace {

/// `name` with a space where its capitals and digits show a new word starting:
/// "KissMyAss" is "Kiss My Ass", "xXDickXx" is "x X Dick Xx", "BIGAss" is
/// "BIG Ass". A digit stays with the letters before it, where the word check
/// knows it may mean nothing ("dick4u" is "dick4 u"). If it started the next
/// word instead, "Gl4ss" would be "Gl 4ss", and "4ss" reads as "ass".
std::string splitAtWordStarts(const std::string& name) {
    const auto lower = [](char c) { return c >= 'a' && c <= 'z'; };
    const auto upper = [](char c) { return c >= 'A' && c <= 'Z'; };
    const auto digit = [](char c) { return c >= '0' && c <= '9'; };
    std::string split;
    for (std::size_t i = 0; i < name.size(); ++i) {
        const char c = name[i];
        if (i > 0) {
            const char before = name[i - 1];
            const char after = i + 1 < name.size() ? name[i + 1] : '\0';
            if ((lower(before) && upper(c)) || (upper(before) && upper(c) && lower(after)) ||
                (digit(before) && (lower(c) || upper(c)))) {
                split += ' ';
            }
        }
        split += c;
    }
    return split;
}

/// Whether `word` from `at` on is one or more lead-ins and then `listed`, and
/// nothing more.
bool leadsInto(const std::vector<Cell>& word, std::size_t at, const char* listed, bool ledIn) {
    if (ledIn) {
        const std::size_t to = matchEnd(word, at, listed);
        if (to != kNoMatch && endsWord(word, to)) return true;
    }
    for (const char* leadIn : kNameLeadIns) {
        const std::size_t to = matchEnd(word, at, leadIn);
        if (to != kNoMatch && to < word.size() && leadsInto(word, to, listed, true)) return true;
    }
    return false;
}

} // namespace

std::string blockedWordInName(const std::string& name, const ChatTerms& terms) {
    const std::string drawn = escapedMarkup(name);
    std::string word = blockedWordIn(drawn, terms);
    if (word.empty()) word = blockedWordIn(escapedMarkup(splitAtWordStarts(name)), terms);
    if (!word.empty()) return word;
    for (const Word& read : wordsIn(drawnCharacters(drawn, true))) {
        if (read.through) continue;
        std::size_t from = 0;
        while (from < read.cells.size() && read.cells[from].standIn) ++from;
        for (const ChatTerm& listed : terms.blocked) {
            if (listed.fit == Fit::Whole &&
                leadsInto(read.cells, from, listed.word.c_str(), false)) {
                return listed.word;
            }
        }
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
        Cell cell;
        if (read(codePoint, cell) == Kind::Letter && !cell.standIn) {
            codePoint = 'a';
            while ((cell.letters & letter(static_cast<char>(codePoint))) == 0) ++codePoint;
        }
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

bool chatLineBreaksRows(const std::string& line) {
    // Both readings: the server serves clients that honour <a> and clients
    // that drop it with its content, and a break inside one counts for either.
    for (const bool links : {false, true}) {
        MarkupOptions options;
        options.links = links;
        for (const MarkupSpan& span : parseMarkup(line, options)) {
            if (span.lineBreak) return true;
        }
    }
    return false;
}

bool chatLineReversesText(const std::string& line) {
    // Off the parsed text, not the line's bytes: "&#x202E;" is the same
    // control. Both readings, as the content of a dropped tag differs by them.
    for (const bool links : {false, true}) {
        MarkupOptions options;
        options.links = links;
        for (const MarkupSpan& span : parseMarkup(line, options)) {
            for (std::size_t at = 0; at < span.text.size();) {
                std::size_t length = 1;
                const std::uint32_t codePoint = decodeAt(span.text, at, length);
                at += length;
                if (within(codePoint, kReversing)) return true;
            }
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// The lists as a server has them
// ---------------------------------------------------------------------------

const char* termFitName(TermFit fit) {
    switch (fit) {
        case TermFit::Anywhere: return "anywhere";
        case TermFit::Start: return "start";
        case TermFit::Word: return "word";
    }
    return "word";
}

const char* termFitLabel(TermFit fit) {
    switch (fit) {
        case TermFit::Anywhere: return "anywhere in a word";
        case TermFit::Start: return "at the start of a word";
        case TermFit::Word: return "as a whole word";
    }
    return "as a whole word";
}

bool parseTermFit(const std::string& name, TermFit& out) {
    const std::string key = lowerCase(name);
    if (key == "anywhere" || key == "inside") {
        out = TermFit::Anywhere;
    } else if (key == "start") {
        out = TermFit::Start;
    } else if (key == "word" || key == "whole") {
        out = TermFit::Word;
    } else {
        return false;
    }
    return true;
}

const ChatTerms& ChatTerms::builtIn() {
    static const ChatTerms terms = [] {
        ChatTerms built;
        for (const Listed& listed : kBlocked) built.blocked.push_back({listed.word, listed.fit});
        for (const Listed& listed : kAllowed) built.allowed.push_back({listed.word, listed.fit});
        return built;
    }();
    return terms;
}

namespace {

/// The built-in row for `word`, or null.
template <std::size_t N>
const Listed* builtInRow(const Listed (&rows)[N], const std::string& word) {
    for (const Listed& row : rows) {
        if (word == row.word) return &row;
    }
    return nullptr;
}

bool listHas(const std::vector<std::string>& words, const std::string& word) {
    return std::find(words.begin(), words.end(), word) != words.end();
}

/// Takes `word` out of `words`; whether it was there.
bool listDrop(std::vector<std::string>& words, const std::string& word) {
    const auto at = std::find(words.begin(), words.end(), word);
    if (at == words.end()) return false;
    words.erase(at);
    return true;
}

ChatTerm* termIn(std::vector<ChatTerm>& terms, const std::string& word) {
    for (ChatTerm& term : terms) {
        if (term.word == word) return &term;
    }
    return nullptr;
}

std::string quoted(const std::string& word) { return "\"" + word + "\""; }

} // namespace

bool ChatTermEdits::validTerm(const std::string& word, std::string& reasonOut) {
    const bool letters = std::all_of(word.begin(), word.end(), [](char c) {
        return c >= 'a' && c <= 'z';
    });
    if (word.size() < 2 || word.size() > 32 || !letters) {
        // The filter reads every other spelling of a letter -- capitals, "1"
        // for "i", "$" for "s", accents, Cyrillic look-alikes, held letters --
        // as the plain one, so the plain one is all a term needs to be.
        reasonOut = "A term is 2 to 32 letters a-z, with no spaces. Write the plain spelling: "
                    "the filter already reads capitals, digits and symbols for letters (sh1t "
                    "is shit), accents, look-alike letters and held letters.";
        return false;
    }
    return true;
}

bool ChatTermEdits::block(const std::string& word, const TermFit* fit, std::string& said) {
    const ChatTerms before = applied();
    const auto allowedToo = [&] {
        for (const ChatTerm& allowedWord : before.allowed) {
            if (allowedWord.word == word) {
                return " Note: " + quoted(word) +
                       " is also an allowed word, which lets it through; unallow it to block it.";
            }
        }
        return std::string();
    };
    ChatTerm* edited = termIn(blocked, word);
    if (const Listed* row = builtInRow(kBlocked, word)) {
        const bool wasOff = listHas(unblocked, word);
        const TermFit was = edited != nullptr ? edited->fit : row->fit;
        const TermFit now = fit != nullptr ? *fit : was;
        if (!wasOff && now == was) {
            said = quoted(word) + " is already blocked " + termFitLabel(now) + "." + allowedToo();
            return false;
        }
        listDrop(unblocked, word);
        // A built-in term at its own fit is no edit: it reads the built-in row.
        blocked.erase(std::remove_if(blocked.begin(), blocked.end(),
                                     [&](const ChatTerm& term) { return term.word == word; }),
                      blocked.end());
        if (now != row->fit) blocked.push_back({word, now});
        said = (wasOff ? "Blocking " + quoted(word) + " again, " : "Now blocking " + quoted(word) + " ") +
               termFitLabel(now) + "." + allowedToo();
        return true;
    }
    const TermFit now = fit != nullptr ? *fit : edited != nullptr ? edited->fit : TermFit::Word;
    if (edited != nullptr) {
        if (edited->fit == now) {
            said = quoted(word) + " is already blocked " + termFitLabel(now) + "." + allowedToo();
            return false;
        }
        edited->fit = now;
        said = "Now blocking " + quoted(word) + " " + termFitLabel(now) + "." + allowedToo();
        return true;
    }
    std::size_t added = 0;
    for (const ChatTerm& term : blocked) {
        if (builtInRow(kBlocked, term.word) == nullptr) ++added;
    }
    if (added >= kMaxAdded) {
        said = "The filter already holds " + std::to_string(kMaxAdded) +
               " added terms, the most it takes. Unblock one first.";
        return false;
    }
    blocked.push_back({word, now});
    said = "Blocked " + quoted(word) + " " + termFitLabel(now) + "." + allowedToo();
    return true;
}

bool ChatTermEdits::unblock(const std::string& word, std::string& said) {
    if (builtInRow(kBlocked, word) != nullptr) {
        if (listHas(unblocked, word)) {
            said = quoted(word) + " is not blocked: it is a built-in term that is switched off.";
            return false;
        }
        blocked.erase(std::remove_if(blocked.begin(), blocked.end(),
                                     [&](const ChatTerm& term) { return term.word == word; }),
                      blocked.end());
        unblocked.push_back(word);
        said = "Stopped blocking " + quoted(word) +
               ". It is a built-in term: block it to switch it back on.";
        return true;
    }
    const auto at = std::find_if(blocked.begin(), blocked.end(),
                                 [&](const ChatTerm& term) { return term.word == word; });
    if (at == blocked.end()) {
        said = quoted(word) + " is not a blocked term. /mod terms list shows them.";
        return false;
    }
    blocked.erase(at);
    said = "Stopped blocking " + quoted(word) + ".";
    return true;
}

bool ChatTermEdits::allow(const std::string& word, std::string& said) {
    // A blocked term allowed whole is a term that blocks nothing, which is
    // what unblock is for -- and says so in the list, where this would not.
    for (const ChatTerm& term : applied().blocked) {
        if (term.word == word) {
            said = quoted(word) + " is a blocked term. Unblock it to stop blocking it.";
            return false;
        }
    }
    if (builtInRow(kAllowed, word) != nullptr) {
        if (!listDrop(unallowed, word)) {
            said = quoted(word) + " is already allowed.";
            return false;
        }
        said = "Allowing " + quoted(word) + " again.";
        return true;
    }
    if (listHas(allowed, word)) {
        said = quoted(word) + " is already allowed.";
        return false;
    }
    if (allowed.size() >= kMaxAdded) {
        said = "The filter already holds " + std::to_string(kMaxAdded) +
               " added allowed words, the most it takes. Unallow one first.";
        return false;
    }
    allowed.push_back(word);
    said = "Allowed " + quoted(word) + ": a blocked term inside it no longer stops a line.";
    return true;
}

bool ChatTermEdits::unallow(const std::string& word, std::string& said) {
    if (builtInRow(kAllowed, word) != nullptr) {
        if (listHas(unallowed, word)) {
            said = quoted(word) + " is not allowed: it is a built-in allowed word that is "
                                  "switched off.";
            return false;
        }
        unallowed.push_back(word);
        said = "Stopped allowing " + quoted(word) +
               ". It is a built-in allowed word: allow it to switch it back on.";
        return true;
    }
    if (!listDrop(allowed, word)) {
        said = quoted(word) + " is not an allowed word. /mod terms list shows them.";
        return false;
    }
    said = "Stopped allowing " + quoted(word) + ".";
    return true;
}

ChatTerms ChatTermEdits::applied() const {
    ChatTerms terms;
    // The built-in rows in their own order, so the log names the same word
    // for a line it always did; the added ones after them.
    for (const Listed& row : kBlocked) {
        if (listHas(unblocked, row.word)) continue;
        TermFit fit = row.fit;
        for (const ChatTerm& term : blocked) {
            if (term.word == row.word) fit = term.fit;
        }
        terms.blocked.push_back({row.word, fit});
    }
    for (const ChatTerm& term : blocked) {
        if (builtInRow(kBlocked, term.word) == nullptr) terms.blocked.push_back(term);
    }
    for (const Listed& row : kAllowed) {
        if (!listHas(unallowed, row.word)) terms.allowed.push_back({row.word, row.fit});
    }
    for (const std::string& word : allowed) {
        if (builtInRow(kAllowed, word) == nullptr) terms.allowed.push_back({word, TermFit::Anywhere});
    }
    return terms;
}

ChatTermEdits ChatTermEdits::fromJson(const Json& table) {
    ChatTermEdits edits;
    std::string reason;
    const auto words = [&](const Json& list, std::vector<std::string>& out, bool builtIn,
                           bool (*known)(const std::string&)) {
        if (!list.isArray()) return;
        for (const Json& item : list.items()) {
            const std::string word = item.asString();
            if (!validTerm(word, reason) || listHas(out, word)) continue;
            if (builtIn != known(word)) continue;
            if (!builtIn && out.size() >= kMaxAdded) continue;
            out.push_back(word);
        }
    };
    const Json& blocked = table["blocked"];
    if (blocked.isObject()) {
        std::size_t added = 0;
        for (const std::string& word : blocked.keys()) {
            TermFit fit;
            if (!validTerm(word, reason) || !parseTermFit(blocked[word].asString(), fit)) continue;
            const Listed* row = builtInRow(kBlocked, word);
            if (row != nullptr && row->fit == fit) continue;
            if (row == nullptr && added++ >= kMaxAdded) continue;
            edits.blocked.push_back({word, fit});
        }
    }
    words(table["unblocked"], edits.unblocked, true,
          [](const std::string& word) { return builtInRow(kBlocked, word) != nullptr; });
    words(table["allowed"], edits.allowed, false,
          [](const std::string& word) { return builtInRow(kAllowed, word) != nullptr; });
    words(table["unallowed"], edits.unallowed, true,
          [](const std::string& word) { return builtInRow(kAllowed, word) != nullptr; });
    // An added allowed word that is a blocked term would block nothing (see
    // allow); a hand edit cannot make one either.
    const ChatTerms terms = ChatTermEdits{edits.blocked, edits.unblocked, {}, {}}.applied();
    edits.allowed.erase(std::remove_if(edits.allowed.begin(), edits.allowed.end(),
                                       [&](const std::string& word) {
                                           for (const ChatTerm& term : terms.blocked) {
                                               if (term.word == word) return true;
                                           }
                                           return false;
                                       }),
                        edits.allowed.end());
    return edits;
}

Json ChatTermEdits::toJson() const {
    Json table = Json::object();
    Json blockedTable = Json::object();
    for (const ChatTerm& term : blocked) blockedTable[term.word] = Json(termFitName(term.fit));
    table["blocked"] = std::move(blockedTable);
    const auto list = [](const std::vector<std::string>& words) {
        Json array = Json::array();
        for (const std::string& word : words) array.push(Json(word));
        return array;
    };
    table["unblocked"] = list(unblocked);
    table["allowed"] = list(allowed);
    table["unallowed"] = list(unallowed);
    return table;
}

} // namespace flix
