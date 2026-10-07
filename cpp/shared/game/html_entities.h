#pragma once
// HTML character references -- "&lt;", "&amp", "&#x2665;" -- decoded the way
// a browser decodes them.
//
// Chat lines are markup, so a player who wants a literal '<' in one writes
// "&lt;", and the browser client accepted everything a browser does: the
// legacy names that need no semicolon ("&lt", "&amp", "&copy"), numeric
// references with or without one, and the named set beyond Latin-1. Both the
// client's chat parser and the server's image-link check read through this,
// so the two cannot disagree about what a src says.
//
// The named table is the HTML 4 set (every legacy name, Greek, arrows, maths,
// typographic punctuation, card suits), plus the HTML 5 names for ASCII
// punctuation and a handful of popular symbols -- not all 2,231 HTML 5 names.
// A name outside it stays literal, as an unknown one does in a browser.

#include <cstddef>
#include <cstdint>
#include <string>

namespace flix {

/// U+00A0, as UTF-8. "&nbsp;" decodes to this rather than to a plain space,
/// so a run of them is neither collapsed nor broken across rows; whatever
/// draws the text turns it back into a space.
inline constexpr const char* kNoBreakSpace = "\xC2\xA0";

/// Decodes the reference starting at `s[at]`, which must be '&', appending
/// the result to `out` and advancing `at` past what it consumed. Something
/// that is not a reference appends the '&' alone and advances by one.
///
/// `inAttribute` applies the attribute-value rule: a semicolon-less name
/// followed by a letter, digit or '=' is left alone, so a URL's "?a=1&copy=2"
/// keeps its "&copy".
void decodeCharacterReference(const std::string& s, std::size_t& at, std::string& out,
                              bool inAttribute = false);

/// Every reference in `s` decoded.
std::string decodeCharacterReferences(const std::string& s, bool inAttribute = false);

/// Appends the UTF-8 encoding of `codePoint`, or nothing for one that is not
/// a scalar value.
void appendUtf8(std::string& out, std::uint32_t codePoint);

} // namespace flix
