#include "test.h"

#include <sys/stat.h>
#include <unistd.h>

#include "client/ui/asset_files.h"
#include "test_data.h"

using namespace flix;
using namespace flix::ui;
namespace assets = flix::ui::assets;

// The asset browser's file and text rules (client/ui/asset_files.h): what a
// path's parent is, what counts as text, where lines start, what colour a
// word is, and what an undo takes back. All of it without a window.

namespace {

/// The token at byte `at` of a highlighted line, or Text past its end.
assets::Token tokenAt(const std::vector<assets::Span>& spans, std::size_t at) {
    for (const assets::Span& span : spans) {
        if (at >= span.begin && at < span.end) return span.token;
    }
    return assets::Token::Text;
}

/// Whether the runs cover [0, size) end to end, in order, with no gap.
bool coversWhole(const std::vector<assets::Span>& spans, std::size_t size) {
    std::size_t at = 0;
    for (const assets::Span& span : spans) {
        if (span.begin != at || span.end <= span.begin) return false;
        at = span.end;
    }
    return at == size;
}

TextSelection caretAt(std::size_t at) {
    TextSelection selection;
    selection.collapse(at);
    return selection;
}

} // namespace

TEST(asset_paths_join_and_split) {
    CHECK_EQ(assets::joinPath("/", "data"), std::string("/data"));
    CHECK_EQ(assets::joinPath("/data", "mobs.json"), std::string("/data/mobs.json"));
    CHECK_EQ(assets::joinPath(".", "data"), std::string("data"));
    CHECK_EQ(assets::joinPath("data/", "tiles"), std::string("data/tiles"));

    CHECK_EQ(assets::parentPath("/data/mobs.json"), std::string("/data"));
    CHECK_EQ(assets::parentPath("/data"), std::string("/"));
    CHECK_EQ(assets::parentPath("/"), std::string("/"));
    CHECK_EQ(assets::parentPath("data"), std::string("."));
    CHECK_EQ(assets::parentPath("."), std::string("."));
    CHECK_EQ(assets::parentPath("data/tiles/"), std::string("data"));

    CHECK_EQ(assets::baseName("/data/mobs.json"), std::string("mobs.json"));
    CHECK_EQ(assets::baseName("/"), std::string("/"));
    CHECK_EQ(assets::baseName("session"), std::string("session"));

    CHECK_EQ(assets::extensionOf("Map.TMJ"), std::string("tmj"));
    CHECK_EQ(assets::extensionOf("archive.tar.gz"), std::string("gz"));
    CHECK_EQ(assets::extensionOf(".florr-session"), std::string());
    CHECK_EQ(assets::extensionOf("README"), std::string());
    CHECK_EQ(assets::extensionOf("/boot.d/run"), std::string());
}

TEST(asset_file_names_are_checked) {
    CHECK(assets::validFileName("tool.js"));
    CHECK(assets::validFileName(".hidden"));
    CHECK(!assets::validFileName(""));
    CHECK(!assets::validFileName("."));
    CHECK(!assets::validFileName(".."));
    CHECK(!assets::validFileName("a/b.js"));
    CHECK(!assets::validFileName(std::string(256, 'x')));
}

TEST(asset_line_index) {
    const std::vector<std::size_t> none = assets::lineStarts("");
    CHECK_EQ(none.size(), std::size_t{1});
    CHECK_EQ(none[0], std::size_t{0});

    const std::vector<std::size_t> starts = assets::lineStarts("a\nbc\n");
    CHECK_EQ(starts.size(), std::size_t{3});
    CHECK_EQ(starts[1], std::size_t{2});
    CHECK_EQ(starts[2], std::size_t{5});
    CHECK_EQ(assets::lineOf(starts, 0), std::size_t{0});
    CHECK_EQ(assets::lineOf(starts, 1), std::size_t{0});
    CHECK_EQ(assets::lineOf(starts, 2), std::size_t{1});
    CHECK_EQ(assets::lineOf(starts, 4), std::size_t{1});
    CHECK_EQ(assets::lineOf(starts, 5), std::size_t{2});
}

TEST(asset_text_detection) {
    CHECK(assets::looksLikeText(""));
    CHECK(assets::looksLikeText("hello\n\tworld\r\n"));
    CHECK(assets::looksLikeText("caf\xC3\xA9 \xF0\x9F\x98\x80"));
    CHECK(!assets::looksLikeText(std::string("a\0b", 3)));
    CHECK(!assets::looksLikeText("bell\x07"));
    CHECK(!assets::looksLikeText("\xC3"));              // cut short
    CHECK(!assets::looksLikeText("\xC0\xAF"));          // overlong
    CHECK(!assets::looksLikeText("\xED\xA0\x80"));      // a surrogate
    CHECK(!assets::looksLikeText("\x89PNG\r\n\x1A\n")); // what a PNG opens with
}

TEST(asset_sizes_read_the_way_people_say_them) {
    CHECK_EQ(assets::formatSize(0), std::string("0 B"));
    CHECK_EQ(assets::formatSize(1023), std::string("1023 B"));
    CHECK_EQ(assets::formatSize(1536), std::string("1.5 KB"));
    CHECK_EQ(assets::formatSize(3u * 1024u * 1024u), std::string("3.0 MB"));
}

TEST(asset_hex_rows_keep_their_columns) {
    const std::string bytes = "Hello world\n";
    const std::string expected = std::string("00000000  ") + "48 65 6c 6c 6f 20 77 6f " + " " +
                                 "72 6c 64 0a " + std::string(12, ' ') + " " + "Hello world.";
    CHECK_EQ(assets::hexRow(bytes, 0), expected);

    // A full row: the four groups and the text column sit at the same places
    // on every row, which is what the panel draws them by.
    std::string full;
    for (int i = 0; i < 32; ++i) full += static_cast<char>(i + 0x30);
    const std::string row = assets::hexRow(full, 16);
    CHECK_EQ(row.size(), std::size_t{76});
    CHECK_EQ(row.substr(0, 8), std::string("00000010"));
    CHECK_EQ(row.substr(10, 11), std::string("40 41 42 43"));
    CHECK_EQ(row.substr(35, 11), std::string("48 49 4a 4b"));
    CHECK_EQ(row.substr(60), std::string("@ABCDEFGHIJKLMNO"));
}

TEST(asset_script_summary_is_the_first_comment) {
    CHECK_EQ(assets::scriptSummary("// Hello there\n// more\ncode();"), std::string("Hello there"));
    CHECK_EQ(assets::scriptSummary("#!/usr/bin/env node\n// Tool: does x\n"),
             std::string("Tool: does x"));
    CHECK_EQ(assets::scriptSummary("/*\n * Block summary\n */\nrun();"),
             std::string("Block summary"));
    CHECK_EQ(assets::scriptSummary("//\n// After a spacer\n"), std::string("After a spacer"));
    CHECK_EQ(assets::scriptSummary("\n\n  // indented\n"), std::string("indented"));
    CHECK_EQ(assets::scriptSummary("const x = 1; // not a header"), std::string());
    CHECK_EQ(assets::scriptSummary(""), std::string());
}

TEST(asset_syntax_by_extension) {
    CHECK(assets::syntaxFor("mobs.json") == assets::Syntax::Json);
    CHECK(assets::syntaxFor("garden.tmj") == assets::Syntax::Json);
    CHECK(assets::syntaxFor("tileset.tsj") == assets::Syntax::Json);
    CHECK(assets::syntaxFor("console.js") == assets::Syntax::Script);
    CHECK(assets::syntaxFor("grass.svg") == assets::Syntax::Markup);
    CHECK(assets::syntaxFor("notes.txt") == assets::Syntax::Plain);
    CHECK(assets::syntaxFor("session") == assets::Syntax::Plain);
}

TEST(asset_highlight_json) {
    const std::string line = "  \"name\": \"bee\", \"hp\": -1.5e3, \"boss\": true, \"x\": null";
    const auto spans = assets::highlightLine(line, assets::Syntax::Json);
    CHECK(coversWhole(spans, line.size()));
    CHECK(tokenAt(spans, 0) == assets::Token::Text);
    CHECK(tokenAt(spans, 2) == assets::Token::Attribute);          // "name" is a key
    CHECK(tokenAt(spans, line.find(':')) == assets::Token::Punctuation);
    CHECK(tokenAt(spans, line.find("\"bee\"")) == assets::Token::String);
    CHECK(tokenAt(spans, line.find("-1.5e3")) == assets::Token::Number);
    CHECK(tokenAt(spans, line.find("e3")) == assets::Token::Number);
    CHECK(tokenAt(spans, line.find("true")) == assets::Token::Keyword);
    CHECK(tokenAt(spans, line.find("null")) == assets::Token::Keyword);
    // A string with an escaped quote in it is still one string.
    const std::string escaped = "\"a\\\"b\": 1";
    const auto escapedSpans = assets::highlightLine(escaped, assets::Syntax::Json);
    CHECK(tokenAt(escapedSpans, 4) == assets::Token::Attribute);
    CHECK(tokenAt(escapedSpans, escaped.find('1')) == assets::Token::Number);
}

TEST(asset_highlight_script) {
    const std::string line = "const a = \"s\" + 0x1F; /* c */ go(); // note";
    const auto spans = assets::highlightLine(line, assets::Syntax::Script);
    CHECK(coversWhole(spans, line.size()));
    CHECK(tokenAt(spans, 0) == assets::Token::Keyword);
    CHECK(tokenAt(spans, line.find('a')) == assets::Token::Text);
    CHECK(tokenAt(spans, line.find("\"s\"")) == assets::Token::String);
    CHECK(tokenAt(spans, line.find("0x1F") + 3) == assets::Token::Number);
    CHECK(tokenAt(spans, line.find("/* c */") + 3) == assets::Token::Comment);
    CHECK(tokenAt(spans, line.find("go")) == assets::Token::Text);
    CHECK(tokenAt(spans, line.find("// note")) == assets::Token::Comment);
    CHECK(tokenAt(spans, line.size() - 1) == assets::Token::Comment);
    // A block comment that does not close on its line runs to the end of it.
    const std::string open = "x(); /* to be continued";
    CHECK(tokenAt(assets::highlightLine(open, assets::Syntax::Script), open.size() - 1) ==
          assets::Token::Comment);
}

TEST(asset_highlight_markup) {
    const std::string line = "<circle cx=\"5\" fill='red'/> text <!-- hi -->";
    const auto spans = assets::highlightLine(line, assets::Syntax::Markup);
    CHECK(coversWhole(spans, line.size()));
    CHECK(tokenAt(spans, 0) == assets::Token::Tag);
    CHECK(tokenAt(spans, 3) == assets::Token::Tag);
    CHECK(tokenAt(spans, line.find("cx")) == assets::Token::Attribute);
    CHECK(tokenAt(spans, line.find('=')) == assets::Token::Punctuation);
    CHECK(tokenAt(spans, line.find("\"5\"")) == assets::Token::String);
    CHECK(tokenAt(spans, line.find("'red'")) == assets::Token::String);
    CHECK(tokenAt(spans, line.find("/>")) == assets::Token::Tag);
    CHECK(tokenAt(spans, line.find("text")) == assets::Token::Text);
    CHECK(tokenAt(spans, line.find("hi")) == assets::Token::Comment);
    // The attribute list an SVG writes one to a line: still inside the tag.
    const std::string continued = "     stroke=\"black\"";
    const auto more = assets::highlightLine(continued, assets::Syntax::Markup);
    CHECK(tokenAt(more, continued.find("stroke")) == assets::Token::Attribute);
    CHECK(tokenAt(more, continued.find("\"black\"")) == assets::Token::String);
}

TEST(asset_highlight_plain_and_empty) {
    CHECK(assets::highlightLine("", assets::Syntax::Json).empty());
    CHECK(assets::highlightLine("", assets::Syntax::Plain).empty());
    const auto plain = assets::highlightLine("just words", assets::Syntax::Plain);
    CHECK_EQ(plain.size(), std::size_t{1});
    CHECK(coversWhole(plain, 10));
}

TEST(asset_undo_groups_a_burst_of_typing) {
    assets::EditHistory history;
    std::string text = "ab";
    history.reset(text);
    text = "abc";
    history.record(text, caretAt(2), caretAt(3), 0.0);
    text = "abcd";
    history.record(text, caretAt(3), caretAt(4), 0.2);
    TextSelection selection;
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("ab"));
    CHECK_EQ(selection.caret, std::size_t{2});
    CHECK(!history.canUndo());
    CHECK(history.redo(text, selection));
    CHECK_EQ(text, std::string("abcd"));
    CHECK_EQ(selection.caret, std::size_t{4});
}

TEST(asset_undo_splits_on_a_pause_and_a_newline) {
    assets::EditHistory history;
    std::string text = "ab";
    history.reset(text);
    text = "abc";
    history.record(text, caretAt(2), caretAt(3), 0.0);
    text = "abcd";
    history.record(text, caretAt(3), caretAt(4), 0.0 + assets::EditHistory::kBurstSeconds + 1.0);
    TextSelection selection;
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("abc"));
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("ab"));

    history.reset(text);
    text = "ab\n";
    history.record(text, caretAt(2), caretAt(3), 10.0);
    text = "ab\nx";
    history.record(text, caretAt(3), caretAt(4), 10.1);
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("ab\n"));
}

TEST(asset_undo_groups_erasing_both_ways) {
    assets::EditHistory history;
    TextSelection selection;
    // Backspace twice from the end.
    std::string text = "abcd";
    history.reset(text);
    text = "abc";
    history.record(text, caretAt(4), caretAt(3), 0.0);
    text = "ab";
    history.record(text, caretAt(3), caretAt(2), 0.1);
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("abcd"));
    CHECK_EQ(selection.caret, std::size_t{4});

    // Delete twice from the same place.
    text = "abcd";
    history.reset(text);
    text = "acd";
    history.record(text, caretAt(1), caretAt(1), 0.0);
    text = "ad";
    history.record(text, caretAt(1), caretAt(1), 0.1);
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("abcd"));
}

TEST(asset_undo_puts_a_replaced_selection_back) {
    assets::EditHistory history;
    std::string text = "hello";
    history.reset(text);
    TextSelection before;
    before.anchor = 1;
    before.caret = 4;
    text = "hao";
    history.record(text, before, caretAt(2), 0.0);
    TextSelection selection;
    CHECK(history.undo(text, selection));
    CHECK_EQ(text, std::string("hello"));
    CHECK_EQ(selection.anchor, std::size_t{1});
    CHECK_EQ(selection.caret, std::size_t{4});

    // A new edit after an undo throws the redo away.
    text = "jello";
    history.record(text, caretAt(0), caretAt(1), 5.0);
    CHECK(!history.canRedo());
}

TEST(asset_undo_refuses_a_text_changed_behind_its_back) {
    assets::EditHistory history;
    std::string text = "abc";
    history.reset(text);
    text = "abcd";
    history.record(text, caretAt(3), caretAt(4), 0.0);
    text = "zzz";
    TextSelection selection;
    CHECK(!history.undo(text, selection));
    CHECK_EQ(text, std::string("zzz"));
    CHECK(!history.canUndo());
}

TEST(asset_files_on_disk) {
    const std::string dir = flix::testsupport::tempUnique("asset_files");
    ::mkdir(dir.c_str(), 0755);
    ::mkdir((dir + "/sub").c_str(), 0755);
    ::mkdir((dir + "/Zed").c_str(), 0755);
    std::string error;
    CHECK(assets::writeWhole(dir + "/b.txt", "bee", error));
    CHECK(assets::writeWhole(dir + "/A.json", "{}", error));

    std::vector<assets::Entry> entries;
    CHECK(assets::listDirectory(dir, entries, error));
    CHECK_EQ(entries.size(), std::size_t{4});
    if (entries.size() == 4) {
        // Folders first, then files, each by name with case ignored.
        CHECK_EQ(entries[0].name, std::string("sub"));
        CHECK(entries[0].directory);
        CHECK_EQ(entries[1].name, std::string("Zed"));
        CHECK_EQ(entries[2].name, std::string("A.json"));
        CHECK_EQ(entries[2].size, std::uint64_t{2});
        CHECK_EQ(entries[3].name, std::string("b.txt"));
        CHECK(!entries[3].directory);
    }
    CHECK(assets::isDirectory(dir + "/sub"));
    CHECK(!assets::isDirectory(dir + "/b.txt"));

    std::string read;
    CHECK(assets::readWhole(dir + "/b.txt", read, 1024, error));
    CHECK_EQ(read, std::string("bee"));
    CHECK(!assets::readWhole(dir + "/b.txt", read, 2, error));
    CHECK(error.find("too large") != std::string::npos);
    CHECK(!assets::readWhole(dir + "/sub", read, 1024, error));

    CHECK(assets::createFile(dir + "/new.js", error));
    CHECK(!assets::createFile(dir + "/new.js", error));
    CHECK(assets::exists(dir + "/new.js"));
    CHECK(assets::removeFile(dir + "/new.js", error));
    CHECK(!assets::exists(dir + "/new.js"));
    CHECK(!assets::listDirectory(dir + "/missing", entries, error));

    for (const char* name : {"/b.txt", "/A.json"}) ::unlink((dir + name).c_str());
    ::rmdir((dir + "/sub").c_str());
    ::rmdir((dir + "/Zed").c_str());
    ::rmdir(dir.c_str());
}
