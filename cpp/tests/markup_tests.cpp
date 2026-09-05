#include "test.h"

#include "client/ui/markup.h"

#include <string>

using flix::ui::kWebMarkup;
using flix::ui::markupPlainText;
using flix::ui::MarkupSpan;
using flix::ui::parseMarkup;

// The chat wire carries markup, and this is where the rules about which tags
// survive it are pinned down. Two of them matter beyond looks: <script> and
// <iframe> are dropped with their content in every build, and <a> is honoured
// only where there is a page to open it in.

namespace {

/// Everything the spans say, concatenated, so a test can assert on text
/// without caring where the parser drew the run boundaries.
std::string flatten(const std::vector<MarkupSpan>& spans) {
    std::string out;
    for (const MarkupSpan& span : spans) {
        if (span.lineBreak) out.push_back('\n');
        else out += span.text;
    }
    return out;
}

/// The first span covering `needle`, or a default span when there is none.
MarkupSpan spanContaining(const std::vector<MarkupSpan>& spans, const std::string& needle) {
    for (const MarkupSpan& span : spans) {
        if (span.text.find(needle) != std::string::npos) return span;
    }
    return {};
}

} // namespace

TEST(markup_plain_text_is_untouched) {
    const std::vector<MarkupSpan> spans = parseMarkup("hello there");
    CHECK_EQ(spans.size(), std::size_t{1});
    CHECK_EQ(spans[0].text, std::string("hello there"));
    CHECK(!spans[0].hasColor);
    CHECK(!spans[0].bold);
}

TEST(markup_boss_spawn_announcement) {
    // Verbatim from enemySpawner.ts, which is what the transcript used to
    // print tags and all.
    const std::vector<MarkupSpan> spans =
        parseMarkup("<b style=\"color: #2bffa4;\">A super crab has spawned somewhere!</b>");
    CHECK_EQ(flatten(spans), std::string("A super crab has spawned somewhere!"));
    CHECK_EQ(spans.size(), std::size_t{1});
    CHECK(spans[0].bold);
    CHECK(spans[0].hasColor);
    CHECK_EQ(spans[0].color, std::uint32_t{0x2BFFA4u});
}

TEST(markup_nested_spans_keep_their_own_colours) {
    // The boss-defeated line: an outer <b> with two coloured <span>s inside.
    const std::vector<MarkupSpan> spans = parseMarkup(
        "<b style=\"color: #de1f1f;\">A legendary ant has been defeated by "
        "<span style=\"color: #00ff00;\">@dar</span> "
        "[<span style=\"color: yellow;\">bot</span>]</b>");
    CHECK_EQ(flatten(spans),
             std::string("A legendary ant has been defeated by @dar [bot]"));
    CHECK_EQ(spanContaining(spans, "defeated").color, std::uint32_t{0xDE1F1Fu});
    CHECK_EQ(spanContaining(spans, "@dar").color, std::uint32_t{0x00FF00u});
    // A named colour, and the run after the inner span must fall back to the
    // enclosing <b> rather than keeping the span's yellow.
    CHECK_EQ(spanContaining(spans, "bot").color, std::uint32_t{0xFFFF00u});
    CHECK(spanContaining(spans, "bot").bold);
}

TEST(markup_br_becomes_a_hard_break) {
    const std::vector<MarkupSpan> spans =
        parseMarkup("<span style=\"color: #4fc3f7;\">Public squads:<br/>one<br/>two</span>");
    CHECK_EQ(flatten(spans), std::string("Public squads:\none\ntwo"));
    int breaks = 0;
    for (const MarkupSpan& span : spans) {
        if (span.lineBreak) ++breaks;
    }
    CHECK_EQ(breaks, 2);
}

TEST(markup_style_tags) {
    const std::vector<MarkupSpan> spans = parseMarkup("<i>lean</i><u>rule</u><blink>on</blink>");
    CHECK(spanContaining(spans, "lean").italic);
    CHECK(spanContaining(spans, "rule").underline);
    CHECK(spanContaining(spans, "on").blink);
    CHECK(!spanContaining(spans, "lean").underline);
}

TEST(markup_entities_are_decoded) {
    CHECK_EQ(markupPlainText("Show what level &lt;name&gt; rolls"),
             std::string("Show what level <name> rolls"));
    CHECK_EQ(markupPlainText("Tom &amp; Jerry"), std::string("Tom & Jerry"));
    CHECK_EQ(markupPlainText("&#65;&#x42;"), std::string("AB"));
    // Not an entity: a bare ampersand has to survive as itself.
    CHECK_EQ(markupPlainText("100% & rising"), std::string("100% & rising"));
}

TEST(markup_stray_angle_bracket_is_text) {
    CHECK_EQ(markupPlainText("2 < 3 and 4 > 1"), std::string("2 < 3 and 4 > 1"));
    // An unterminated tag is not a tag either.
    CHECK_EQ(markupPlainText("<b unclosed"), std::string("<b unclosed"));
}

TEST(markup_script_is_dropped_with_its_payload) {
    const std::string line = "before<script>alert('pwned')</script>after";
    CHECK_EQ(markupPlainText(line), std::string("beforeafter"));
    // Not merely stripped of its tags -- the code inside must not reach the
    // transcript as text either.
    CHECK(markupPlainText(line).find("alert") == std::string::npos);
}

TEST(markup_iframe_is_dropped_with_its_payload) {
    const std::string line =
        "look<iframe src=\"https://evil.example/\" width=\"280\">fallback</iframe>here";
    CHECK_EQ(markupPlainText(line), std::string("lookhere"));
    CHECK(markupPlainText(line).find("evil.example") == std::string::npos);
}

TEST(markup_nested_script_close_does_not_end_early) {
    CHECK_EQ(markupPlainText("a<script>x<script>y</script>z</script>b"), std::string("ab"));
}

TEST(markup_unknown_tags_are_dropped_with_their_content) {
    CHECK_EQ(markupPlainText("keep<video>gone</video>keep"), std::string("keepkeep"));
    CHECK_EQ(markupPlainText("<img src=\"https://x/y.png\">shown"), std::string("shown"));
}

TEST(markup_links_are_web_only) {
    const std::vector<MarkupSpan> spans =
        parseMarkup("see <a href=\"https://florr.io/\">this</a> now");
    if (kWebMarkup) {
        CHECK_EQ(flatten(spans), std::string("see this now"));
        CHECK_EQ(spanContaining(spans, "this").href, std::string("https://florr.io/"));
        CHECK(spanContaining(spans, "this").underline);
    } else {
        // Native drops it exactly as it drops any tag outside the allowlist.
        CHECK_EQ(flatten(spans), std::string("see  now"));
        CHECK(spanContaining(spans, "this").href.empty());
    }
}

TEST(markup_javascript_href_is_never_kept) {
    const std::vector<MarkupSpan> spans =
        parseMarkup("<a href=\"javascript:alert(1)\">click</a>");
    for (const MarkupSpan& span : spans) CHECK(span.href.empty());
}

TEST(markup_comments_never_reach_the_transcript) {
    CHECK_EQ(markupPlainText("a<!-- secret -->b"), std::string("ab"));
}

TEST(markup_unbalanced_close_is_ignored) {
    CHECK_EQ(markupPlainText("</b>text</span>"), std::string("text"));
}

TEST(markup_style_attribute_only_yields_colour) {
    const std::vector<MarkupSpan> spans =
        parseMarkup("<span style=\"position: fixed; color: #abc; z-index: 9\">x</span>");
    CHECK(spans.size() >= 1);
    CHECK(spans[0].hasColor);
    // #abc expands the way CSS expands it.
    CHECK_EQ(spans[0].color, std::uint32_t{0xAABBCCu});
}
