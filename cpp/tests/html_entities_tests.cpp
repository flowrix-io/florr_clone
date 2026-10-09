#include "test.h"

#include "shared/game/html_entities.h"

#include <string>

using flix::decodeCharacterReferences;

// Character references decode the way a browser decodes them, because the
// TypeScript client, which a browser rendered, is what players learned chat
// escaping from.

namespace {
std::string text(const std::string& s) { return decodeCharacterReferences(s, false); }
std::string attr(const std::string& s) { return decodeCharacterReferences(s, true); }
} // namespace

TEST(html_entities_the_ascii_escapes) {
    CHECK_EQ(text("&lt;b&gt; &amp; &quot;x&quot; &apos;y&apos;"),
             std::string("<b> & \"x\" 'y'"));
    // Upper-case spellings are names of their own.
    CHECK_EQ(text("&LT;&GT;&AMP;&QUOT;"), std::string("<>&\""));
}

TEST(html_entities_legacy_names_need_no_semicolon) {
    CHECK_EQ(text("&lt;b&gt"), std::string("<b>"));
    CHECK_EQ(text("&ltb&gt"), std::string("<b>"));
    CHECK_EQ(text("Tom &amp Jerry"), std::string("Tom & Jerry"));
    CHECK_EQ(text("&copy 2026"), std::string("\xC2\xA9 2026"));
    // The longest legacy name the text starts with: "not" then "it;".
    CHECK_EQ(text("&notit;"), std::string("\xC2\xACit;"));
    CHECK_EQ(text("&ampx"), std::string("&x"));
}

TEST(html_entities_newer_names_need_their_semicolon) {
    CHECK_EQ(text("&hellip;&mdash;&hearts;&rarr;&euro;"),
             std::string("\xE2\x80\xA6\xE2\x80\x94\xE2\x99\xA5\xE2\x86\x92\xE2\x82\xAC"));
    CHECK_EQ(text("&hellip"), std::string("&hellip"));
    CHECK_EQ(text("&apos"), std::string("&apos"));
    CHECK_EQ(text("&lpar;&rpar;&num;&bsol;&lsqb;&rsqb;"), std::string("()#\\[]"));
    CHECK_EQ(text("&check; &starf;"), std::string("\xE2\x9C\x93 \xE2\x98\x85"));
    // Names are case-sensitive.
    CHECK_EQ(text("&Eacute;&eacute;"), std::string("\xC3\x89\xC3\xA9"));
    CHECK_EQ(text("&HELLIP;"), std::string("&HELLIP;"));
}

TEST(html_entities_numeric_references) {
    CHECK_EQ(text("&#65;&#x42;&#X43;"), std::string("ABC"));
    CHECK_EQ(text("&#65&#x42 done"), std::string("AB done"));
    CHECK_EQ(text("&#x1F600;"), std::string("\xF0\x9F\x98\x80"));
    // What a browser substitutes.
    CHECK_EQ(text("&#0;"), std::string("\xEF\xBF\xBD"));
    CHECK_EQ(text("&#xD800;"), std::string("\xEF\xBF\xBD"));
    CHECK_EQ(text("&#99999999999;"), std::string("\xEF\xBF\xBD"));
    CHECK_EQ(text("&#150;"), std::string("\xE2\x80\x93"));   // Windows-1252's en dash
    // Control characters other than tab and newline print nothing.
    CHECK_EQ(text("a&#7;b&#27;c&#10;d"), std::string("abc\nd"));
    CHECK_EQ(text("&#;&#x;&#xZ"), std::string("&#;&#x;&#xZ"));
}

TEST(html_entities_unknown_and_bare_ampersands_stay) {
    CHECK_EQ(text("100% & rising"), std::string("100% & rising"));
    CHECK_EQ(text("&bogus; &;"), std::string("&bogus; &;"));
    CHECK_EQ(text("a&"), std::string("a&"));
    CHECK_EQ(text("&&lt;"), std::string("&<"));
}

TEST(html_entities_attribute_rule_spares_query_strings) {
    CHECK_EQ(attr("https://x/?a=1&copy=2"), std::string("https://x/?a=1&copy=2"));
    CHECK_EQ(attr("https://x/?a=1&ampb=2"), std::string("https://x/?a=1&ampb=2"));
    CHECK_EQ(attr("https://x/?a=1&amp;b=2"), std::string("https://x/?a=1&b=2"));
    CHECK_EQ(attr("x&lt y"), std::string("x< y"));
    // The same text outside an attribute decodes.
    CHECK_EQ(text("?a=1&copy=2"), std::string("?a=1\xC2\xA9=2"));
}

TEST(html_entities_nbsp_is_a_no_break_space) {
    CHECK_EQ(text("a&nbsp;b&nbsp"), std::string("a\xC2\xA0" "b\xC2\xA0"));
}
