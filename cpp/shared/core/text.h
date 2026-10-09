#pragma once
// The byte-level string rules the client, the server and the content loaders
// all share: ASCII case folding, whitespace trimming, one hex digit, and the
// UTF-8 bytes of a code point.
//
// One copy rather than one per translation unit, because each of these is a
// rule and not a convenience. A name is matched case-blind and typed with
// stray whitespace wherever a player can type one; a colour's hex digits read
// the same whoever parses them; and a second copy of any of them is a second
// place for the rule to quietly stop being true. Header-only, so a file that
// needs one adds an include and nothing else.
//
// The case folding is ASCII and nothing more, on purpose: std::tolower is the
// C locale's -- nothing in either program calls setlocale -- so it folds A-Z
// and leaves every other byte, every byte of a UTF-8 sequence included,
// exactly as it was. That is also why the copies this replaced, some written
// as std::tolower and some as an A-Z loop, were one rule.

#include <cctype>
#include <cstdint>
#include <string>

namespace flix {

/// One byte of lowerCase(std::string): A-Z folded, every other byte left alone.
inline char lowerCase(char c) {
    return static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
}

/// Case folding for every name comparison. Guild membership, account lookup
/// and command targets are all case-insensitive in the reference -- a player
/// invited as "Bob" answers as "bob" -- so nothing that matches a name may
/// compare raw bytes.
inline std::string lowerCase(std::string s) {
    for (char& c : s) c = lowerCase(c);
    return s;
}

/// `s` without its leading and trailing spaces, tabs, CRs and LFs. Exactly
/// those four: a trim that also takes the other control bytes is a different
/// rule, not this one.
inline std::string trimmed(const std::string& s) {
    const std::size_t first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const std::size_t last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

/// The value of one hex digit, either case, or -1 for anything that is not one.
inline int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/// Appends the UTF-8 encoding of the code point `cp`, and nothing for one past
/// U+10FFFF, which UTF-8 cannot carry.
///
/// A UTF-16 surrogate (U+D800-DFFF) is not a scalar value, but it is still
/// encoded -- as its own three bytes -- rather than dropped. That is the JSON
/// parser's case: an escape naming half a surrogate pair with no partner
/// (`\uD800`) has always come through as those bytes, and deleting it instead
/// would change what an existing database's strings read as. The other caller,
/// the character-reference decoder, never hands one over: it turns every
/// surrogate and every out-of-range number into U+FFFD first
/// (shared/game/html_entities.cpp), which is what any caller holding an
/// untrusted number should do.
inline void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp > 0x10FFFF) return;
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

} // namespace flix
