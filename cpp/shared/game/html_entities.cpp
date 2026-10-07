#include "shared/game/html_entities.h"

#include <cctype>
#include <string_view>
#include <unordered_map>

namespace flix {

namespace {

struct Entity {
    const char* name;
    std::uint32_t codePoint;
};

/// The legacy names: the ones a browser decodes even without a semicolon.
/// Names are case-sensitive -- "&Eacute;" is not "&eacute;" -- and the
/// upper-case spellings of the five ASCII escapes are legacy names of their own.
constexpr Entity kLegacy[] = {
    {"AElig", 0xC6},  {"AMP", 0x26},    {"Aacute", 0xC1}, {"Acirc", 0xC2},  {"Agrave", 0xC0},
    {"Aring", 0xC5},  {"Atilde", 0xC3}, {"Auml", 0xC4},   {"COPY", 0xA9},   {"Ccedil", 0xC7},
    {"ETH", 0xD0},    {"Eacute", 0xC9}, {"Ecirc", 0xCA},  {"Egrave", 0xC8}, {"Euml", 0xCB},
    {"GT", 0x3E},     {"Iacute", 0xCD}, {"Icirc", 0xCE},  {"Igrave", 0xCC}, {"Iuml", 0xCF},
    {"LT", 0x3C},     {"Ntilde", 0xD1}, {"Oacute", 0xD3}, {"Ocirc", 0xD4},  {"Ograve", 0xD2},
    {"Oslash", 0xD8}, {"Otilde", 0xD5}, {"Ouml", 0xD6},   {"QUOT", 0x22},   {"REG", 0xAE},
    {"THORN", 0xDE},  {"Uacute", 0xDA}, {"Ucirc", 0xDB},  {"Ugrave", 0xD9}, {"Uuml", 0xDC},
    {"Yacute", 0xDD}, {"aacute", 0xE1}, {"acirc", 0xE2},  {"acute", 0xB4},  {"aelig", 0xE6},
    {"agrave", 0xE0}, {"amp", 0x26},    {"aring", 0xE5},  {"atilde", 0xE3}, {"auml", 0xE4},
    {"brvbar", 0xA6}, {"ccedil", 0xE7}, {"cedil", 0xB8},  {"cent", 0xA2},   {"copy", 0xA9},
    {"curren", 0xA4}, {"deg", 0xB0},    {"divide", 0xF7}, {"eacute", 0xE9}, {"ecirc", 0xEA},
    {"egrave", 0xE8}, {"eth", 0xF0},    {"euml", 0xEB},   {"frac12", 0xBD}, {"frac14", 0xBC},
    {"frac34", 0xBE}, {"gt", 0x3E},     {"iacute", 0xED}, {"icirc", 0xEE},  {"iexcl", 0xA1},
    {"igrave", 0xEC}, {"iquest", 0xBF}, {"iuml", 0xEF},   {"laquo", 0xAB},  {"lt", 0x3C},
    {"macr", 0xAF},   {"micro", 0xB5},  {"middot", 0xB7}, {"nbsp", 0xA0},   {"not", 0xAC},
    {"ntilde", 0xF1}, {"oacute", 0xF3}, {"ocirc", 0xF4},  {"ograve", 0xF2}, {"ordf", 0xAA},
    {"ordm", 0xBA},   {"oslash", 0xF8}, {"otilde", 0xF5}, {"ouml", 0xF6},   {"para", 0xB6},
    {"plusmn", 0xB1}, {"pound", 0xA3},  {"quot", 0x22},   {"raquo", 0xBB},  {"reg", 0xAE},
    {"sect", 0xA7},   {"shy", 0xAD},    {"sup1", 0xB9},   {"sup2", 0xB2},   {"sup3", 0xB3},
    {"szlig", 0xDF},  {"thorn", 0xFE},  {"times", 0xD7},  {"uacute", 0xFA}, {"ucirc", 0xFB},
    {"ugrave", 0xF9}, {"uml", 0xA8},    {"uuml", 0xFC},   {"yacute", 0xFD}, {"yen", 0xA5},
    {"yuml", 0xFF},
};

/// Names that need their semicolon.
constexpr Entity kNamed[] = {
    // The rest of HTML 4.
    {"apos", 0x27},     {"OElig", 0x152},   {"oelig", 0x153},   {"Scaron", 0x160},
    {"scaron", 0x161},  {"Yuml", 0x178},    {"fnof", 0x192},    {"circ", 0x2C6},
    {"tilde", 0x2DC},
    {"Alpha", 0x391},   {"Beta", 0x392},    {"Gamma", 0x393},   {"Delta", 0x394},
    {"Epsilon", 0x395}, {"Zeta", 0x396},    {"Eta", 0x397},     {"Theta", 0x398},
    {"Iota", 0x399},    {"Kappa", 0x39A},   {"Lambda", 0x39B},  {"Mu", 0x39C},
    {"Nu", 0x39D},      {"Xi", 0x39E},      {"Omicron", 0x39F}, {"Pi", 0x3A0},
    {"Rho", 0x3A1},     {"Sigma", 0x3A3},   {"Tau", 0x3A4},     {"Upsilon", 0x3A5},
    {"Phi", 0x3A6},     {"Chi", 0x3A7},     {"Psi", 0x3A8},     {"Omega", 0x3A9},
    {"alpha", 0x3B1},   {"beta", 0x3B2},    {"gamma", 0x3B3},   {"delta", 0x3B4},
    {"epsilon", 0x3B5}, {"zeta", 0x3B6},    {"eta", 0x3B7},     {"theta", 0x3B8},
    {"iota", 0x3B9},    {"kappa", 0x3BA},   {"lambda", 0x3BB},  {"mu", 0x3BC},
    {"nu", 0x3BD},      {"xi", 0x3BE},      {"omicron", 0x3BF}, {"pi", 0x3C0},
    {"rho", 0x3C1},     {"sigmaf", 0x3C2},  {"sigma", 0x3C3},   {"tau", 0x3C4},
    {"upsilon", 0x3C5}, {"phi", 0x3C6},     {"chi", 0x3C7},     {"psi", 0x3C8},
    {"omega", 0x3C9},   {"thetasym", 0x3D1}, {"upsih", 0x3D2},  {"piv", 0x3D6},
    {"ensp", 0x2002},   {"emsp", 0x2003},   {"thinsp", 0x2009}, {"zwnj", 0x200C},
    {"zwj", 0x200D},    {"lrm", 0x200E},    {"rlm", 0x200F},    {"ndash", 0x2013},
    {"mdash", 0x2014},  {"lsquo", 0x2018},  {"rsquo", 0x2019},  {"sbquo", 0x201A},
    {"ldquo", 0x201C},  {"rdquo", 0x201D},  {"bdquo", 0x201E},  {"dagger", 0x2020},
    {"Dagger", 0x2021}, {"bull", 0x2022},   {"hellip", 0x2026}, {"permil", 0x2030},
    {"prime", 0x2032},  {"Prime", 0x2033},  {"lsaquo", 0x2039}, {"rsaquo", 0x203A},
    {"oline", 0x203E},  {"frasl", 0x2044},  {"euro", 0x20AC},   {"image", 0x2111},
    {"weierp", 0x2118}, {"real", 0x211C},   {"trade", 0x2122},  {"alefsym", 0x2135},
    {"larr", 0x2190},   {"uarr", 0x2191},   {"rarr", 0x2192},   {"darr", 0x2193},
    {"harr", 0x2194},   {"crarr", 0x21B5},  {"lArr", 0x21D0},   {"uArr", 0x21D1},
    {"rArr", 0x21D2},   {"dArr", 0x21D3},   {"hArr", 0x21D4},   {"forall", 0x2200},
    {"part", 0x2202},   {"exist", 0x2203},  {"empty", 0x2205},  {"nabla", 0x2207},
    {"isin", 0x2208},   {"notin", 0x2209},  {"ni", 0x220B},     {"prod", 0x220F},
    {"sum", 0x2211},    {"minus", 0x2212},  {"lowast", 0x2217}, {"radic", 0x221A},
    {"prop", 0x221D},   {"infin", 0x221E},  {"ang", 0x2220},    {"and", 0x2227},
    {"or", 0x2228},     {"cap", 0x2229},    {"cup", 0x222A},    {"int", 0x222B},
    {"there4", 0x2234}, {"sim", 0x223C},    {"cong", 0x2245},   {"asymp", 0x2248},
    {"ne", 0x2260},     {"equiv", 0x2261},  {"le", 0x2264},     {"ge", 0x2265},
    {"sub", 0x2282},    {"sup", 0x2283},    {"nsub", 0x2284},   {"sube", 0x2286},
    {"supe", 0x2287},   {"oplus", 0x2295},  {"otimes", 0x2297}, {"perp", 0x22A5},
    {"sdot", 0x22C5},   {"lceil", 0x2308},  {"rceil", 0x2309},  {"lfloor", 0x230A},
    {"rfloor", 0x230B}, {"lang", 0x27E8},   {"rang", 0x27E9},   {"loz", 0x25CA},
    {"spades", 0x2660}, {"clubs", 0x2663},  {"hearts", 0x2665}, {"diams", 0x2666},

    // HTML 5's names for ASCII punctuation: the way to write any symbol that
    // would otherwise mean something.
    {"Tab", 0x09},      {"NewLine", 0x0A},  {"excl", 0x21},     {"num", 0x23},
    {"dollar", 0x24},   {"percnt", 0x25},   {"lpar", 0x28},     {"rpar", 0x29},
    {"ast", 0x2A},      {"midast", 0x2A},   {"plus", 0x2B},     {"comma", 0x2C},
    {"period", 0x2E},   {"sol", 0x2F},      {"colon", 0x3A},    {"semi", 0x3B},
    {"equals", 0x3D},   {"quest", 0x3F},    {"commat", 0x40},   {"lsqb", 0x5B},
    {"lbrack", 0x5B},   {"bsol", 0x5C},     {"rsqb", 0x5D},     {"rbrack", 0x5D},
    {"Hat", 0x5E},      {"lowbar", 0x5F},   {"UnderBar", 0x5F}, {"grave", 0x60},
    {"DiacriticalGrave", 0x60}, {"lcub", 0x7B}, {"lbrace", 0x7B}, {"verbar", 0x7C},
    {"vert", 0x7C},     {"VerticalLine", 0x7C}, {"rcub", 0x7D}, {"rbrace", 0x7D},

    // A few popular HTML 5 symbols.
    {"check", 0x2713},  {"checkmark", 0x2713}, {"cross", 0x2717}, {"star", 0x2606},
    {"starf", 0x2605},  {"bigstar", 0x2605}, {"phone", 0x260E}, {"female", 0x2640},
    {"male", 0x2642},   {"sung", 0x266A},   {"flat", 0x266D},   {"natural", 0x266E},
    {"sharp", 0x266F},  {"spadesuit", 0x2660}, {"clubsuit", 0x2663},
    {"heartsuit", 0x2665}, {"diamondsuit", 0x2666}, {"half", 0xBD}, {"centerdot", 0xB7},
    {"rightarrow", 0x2192}, {"leftarrow", 0x2190}, {"uparrow", 0x2191},
    {"downarrow", 0x2193}, {"hyphen", 0x2010}, {"dash", 0x2010},
    {"nldr", 0x2025},   {"mldr", 0x2026},   {"copysr", 0x2117}, {"incare", 0x2105},
    {"numero", 0x2116}, {"ohm", 0x3A9},     {"angst", 0xC5},    {"smile", 0x2323},
    {"frown", 0x2322},
};

/// Longest name in either table; nothing past it can be one.
constexpr std::size_t kLongestName = 16;

struct Tables {
    std::unordered_map<std::string_view, std::uint32_t> legacy;
    std::unordered_map<std::string_view, std::uint32_t> all;
};

const Tables& tables() {
    static const Tables built = [] {
        Tables t;
        for (const Entity& e : kLegacy) {
            t.legacy.emplace(e.name, e.codePoint);
            t.all.emplace(e.name, e.codePoint);
        }
        for (const Entity& e : kNamed) t.all.emplace(e.name, e.codePoint);
        return t;
    }();
    return built;
}

/// What a numeric reference to 0x80-0x9F means: the page was Windows-1252,
/// and every browser reads it that way. 0 marks the five it leaves alone.
constexpr std::uint16_t kWindows1252[32] = {
    0x20AC, 0,      0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0,      0x017D, 0,
    0,      0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0,      0x017E, 0x0178,
};

bool alnum(char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; }

/// A numeric reference's code point made safe to print: what a browser
/// substitutes for the invalid ones, and nothing at all for the control
/// characters other than tab and newline, which carry no glyph and could
/// only upset whatever lays the text out.
void appendNumeric(std::string& out, std::uint32_t cp) {
    if (cp >= 0x80 && cp <= 0x9F && kWindows1252[cp - 0x80] != 0) cp = kWindows1252[cp - 0x80];
    if (cp == 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
    if ((cp < 0x20 && cp != '\t' && cp != '\n') || (cp >= 0x7F && cp <= 0x9F)) return;
    appendUtf8(out, cp);
}

} // namespace

void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return;
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

void decodeCharacterReference(const std::string& s, std::size_t& at, std::string& out,
                              bool inAttribute) {
    const std::size_t start = at + 1;
    const auto literal = [&] {
        out.push_back('&');
        at = start;
    };

    // &#65; &#x41; -- the semicolon optional, as it is to a browser.
    if (start < s.size() && s[start] == '#') {
        std::size_t i = start + 1;
        const bool hex = i < s.size() && (s[i] == 'x' || s[i] == 'X');
        if (hex) ++i;
        const std::size_t digitsAt = i;
        std::uint32_t value = 0;
        bool overflow = false;
        for (; i < s.size(); ++i) {
            const char c = s[i];
            int digit = -1;
            if (c >= '0' && c <= '9') digit = c - '0';
            else if (hex && c >= 'a' && c <= 'f') digit = c - 'a' + 10;
            else if (hex && c >= 'A' && c <= 'F') digit = c - 'A' + 10;
            if (digit < 0) break;
            if (!overflow) {
                value = value * (hex ? 16u : 10u) + static_cast<std::uint32_t>(digit);
                if (value > 0x10FFFF) overflow = true;
            }
        }
        if (i == digitsAt) {
            literal();
            return;
        }
        if (i < s.size() && s[i] == ';') ++i;
        appendNumeric(out, overflow ? 0x110000u : value);
        at = i;
        return;
    }

    std::size_t end = start;
    while (end < s.size() && end - start < kLongestName && alnum(s[end])) ++end;
    if (end == start) {
        literal();
        return;
    }
    const std::string_view name(s.data() + start, end - start);
    const Tables& t = tables();

    // A whole name and its semicolon: anything in either table.
    if (end < s.size() && s[end] == ';') {
        const auto found = t.all.find(name);
        if (found != t.all.end()) {
            appendUtf8(out, found->second);
            at = end + 1;
            return;
        }
    }

    // Otherwise the longest legacy name the text starts with: "&notit;" is
    // "¬it;" and "&ampx" is "&x", exactly as a browser reads them.
    for (std::size_t length = name.size(); length >= 2; --length) {
        const auto found = t.legacy.find(name.substr(0, length));
        if (found == t.legacy.end()) continue;
        const std::size_t after = start + length;
        // In an attribute, "&copy=2" in a query string is not a copyright sign.
        if (inAttribute && after < s.size() && (alnum(s[after]) || s[after] == '=')) break;
        appendUtf8(out, found->second);
        at = after;
        return;
    }
    literal();
}

std::string decodeCharacterReferences(const std::string& s, bool inAttribute) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size();) {
        if (s[i] == '&') decodeCharacterReference(s, i, out, inAttribute);
        else out.push_back(s[i++]);
    }
    return out;
}

} // namespace flix
