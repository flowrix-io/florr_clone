#pragma once
// The half of the asset browser that does not draw: listing a directory,
// reading and writing a file whole, and the few facts about a text that the
// editor needs -- where its lines start, what colour each word is, how to undo
// an edit.
//
// Kept apart from the panel (menu_assets.cpp) so every rule here can be tested
// without a window, and so the panel is left with layout and input.

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "client/ui/text_input.h"

namespace flix::ui::assets {

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

struct Entry {
    std::string name;
    bool directory = false;
    std::uint64_t size = 0;
};

/// The entries of the directory at `path`: folders first, then files, each
/// group by name with case ignored. "." and ".." are left out. False, with
/// `error` saying why, when the directory cannot be read.
bool listDirectory(const std::string& path, std::vector<Entry>& out, std::string& error);

bool isDirectory(const std::string& path);
bool exists(const std::string& path);

/// `dir` and `name` joined by one separator: joinPath("/", "data") is "/data"
/// and joinPath(".", "data") is "data", so a path built by walking down from a
/// root reads the way it would be typed.
std::string joinPath(const std::string& dir, const std::string& name);

/// The directory `path` is in: "/data/mobs.json" -> "/data", "/data" -> "/",
/// "data" -> ".", and the two roots, "/" and ".", are their own parents.
std::string parentPath(const std::string& path);

/// The last component: "/data/mobs.json" -> "mobs.json".
std::string baseName(const std::string& path);

/// A name's extension, lowercased and without its dot: "Map.TMJ" -> "tmj".
/// Empty when it has none -- including a dot file such as ".florr-session".
std::string extensionOf(const std::string& name);

/// Whether a new file may be called `name`: something to call it, no
/// separator, and not one of the two directory names.
bool validFileName(const std::string& name);

/// Reads all of `path`. A file larger than `limit` bytes is refused rather
/// than read, with `error` giving its size.
bool readWhole(const std::string& path, std::string& out, std::size_t limit, std::string& error);

/// Replaces the contents of `path` with `bytes`, creating the file if there
/// is none.
bool writeWhole(const std::string& path, const std::string& bytes, std::string& error);

/// Makes an empty file. Refuses one that is already there.
bool createFile(const std::string& path, std::string& error);

bool removeFile(const std::string& path, std::string& error);

/// Whether `bytes` read as text: valid UTF-8, no NUL, and no control
/// characters but tab, newline, carriage return and form feed.
bool looksLikeText(const std::string& bytes);

/// "512 B", "1.5 KB", "3.2 MB".
std::string formatSize(std::uint64_t bytes);

/// One row of a hex dump, the sixteen bytes from `offset`:
/// "00000010  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a           Hello world."
/// A short last row is padded so its text column lines up with the rest.
std::string hexRow(const std::string& bytes, std::size_t offset);

/// What a script says about itself: its first comment, the text of the first
/// line of it, as a header comment is written to be read. Empty when the file
/// does not open with one.
std::string scriptSummary(const std::string& source);

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/// Where each line of `text` starts. Never empty: an empty text is one empty
/// line, and every '\n' starts another.
std::vector<std::size_t> lineStarts(const std::string& text);

/// The line `offset` is on, counted from 0.
std::size_t lineOf(const std::vector<std::size_t>& starts, std::size_t offset);

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/// Which colouring a file gets, by its extension.
enum class Syntax : std::uint8_t { Plain, Json, Script, Markup };
Syntax syntaxFor(const std::string& name);

enum class Token : std::uint8_t {
    Text,
    String,
    Number,
    Keyword,
    Comment,
    Punctuation,
    Tag,        ///< an element's name and its brackets
    Attribute,  ///< an attribute's name, or a JSON object's key
};

struct Span {
    std::size_t begin = 0;
    std::size_t end = 0;
    Token token = Token::Text;
};

/// The coloured runs of ONE line, in order and covering it whole, adjacent
/// runs of the same colour merged. Line by line on purpose: the editor colours
/// only what is on screen, so a block comment or a string that starts above it
/// is coloured as plain text past its own first line -- a fair price for never
/// reading the rest of a half-megabyte map to colour forty lines of it.
std::vector<Span> highlightLine(const std::string& line, Syntax syntax);

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/// The editor's undo and redo.
///
/// Each step is a DIFF -- where the text changed, what was there and what is
/// there now -- worked out against a copy of the text as it last stood, rather
/// than a copy of the whole text. A map is half a megabyte; snapshots of it
/// would spend memory by the hundred megabytes for an undo depth anyone would
/// call usable. Typing and erasing are grouped into one step per burst, the
/// way every editor groups them, so one undo takes back a word, not a letter.
class EditHistory {
public:
    /// Starts over on `text`, which is what the file holds now: a fresh open,
    /// a revert, a save that reloaded.
    void reset(const std::string& text);

    /// Records whatever changed between the text as last seen and `text`.
    /// `before` and `after` are the selection either side of the change: an
    /// undo puts back the first, a redo the second.
    void record(const std::string& text, const TextSelection& before,
                const TextSelection& after, double timeSeconds);

    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }

    /// Takes back the latest step. False when there is none.
    bool undo(std::string& text, TextSelection& selection);
    bool redo(std::string& text, TextSelection& selection);

    /// How long a pause ends a burst of typing.
    static constexpr double kBurstSeconds = 1.0;
    /// What the history may hold in removed and inserted text together; the
    /// oldest steps go first past it.
    static constexpr std::size_t kMaxBytes = 16u << 20;

private:
    struct Edit {
        std::size_t offset = 0;
        std::string removed;
        std::string inserted;
        TextSelection before;
        TextSelection after;
        double at = 0;
    };
    void trim();

    std::string shadow_;
    std::vector<Edit> undo_;
    std::vector<Edit> redo_;
    std::size_t bytes_ = 0;
};

} // namespace flix::ui::assets
