// The asset browser: every file this client can reach, opened and edited in
// place, and the script the next page load runs instead of the game.
//
// The Files tab is a folder list on the left and the open file on the right. A
// text file opens in an editor -- the caret, selection, clipboard and keys of
// every text field in the client (text_input.h), scrolling both ways, colour
// for JSON, scripts and SVG, undo, and a live preview beside an SVG -- and
// anything else opens as a hex dump. Where a file lives decides what saving it
// means, and the footer says which: in the browser, /persist is the client's
// browser storage and is kept, and everything else is the wasm's in-memory
// file system, gone at the next reload. Natively it is a file on disk.
//
// The Boot tab names the script the next page load runs instead of the game:
// one of the tools embedded under /boot, or any .js file set from the Files
// tab. client/web/boot.h has how the page finds it.
//
// Opened from the debug panel's Assets button and gated on the same setting.
// The state is at file scope, as the database editor's is: there is one panel,
// and closing it does not throw away a half-edited file.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "svg.h"

#include "client/ui/asset_files.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/text_select.h"
#include "client/ui/touch_scroll.h"
#include "client/web/boot.h"
#ifdef __EMSCRIPTEN__
#include "client/web/persist.h"
#endif

namespace flix {

using namespace flix::ui;

namespace {

constexpr double kWidth = 1060.0;
constexpr double kHeight = 690.0;
constexpr double kHeaderHeight = 50.0;
constexpr double kFooterHeight = 30.0;
constexpr double kPad = 12.0;
constexpr double kListWidth = 290.0;
constexpr double kListRow = 26.0;
constexpr double kChipHeight = 24.0;
constexpr double kToolbarHeight = 38.0;
constexpr double kCodeSize = 13.0;
constexpr double kLineHeight = 18.0;
constexpr double kScrollbarWidth = 10.0;
constexpr double kListWheelStep = 60.0;
constexpr double kWheelLines = 3.0;
constexpr std::size_t kWheelColumns = 12;
constexpr double kPreviewWidth = 240.0;
constexpr double kBootRow = 60.0;
/// The largest file the panel opens. Nothing it is for is bigger -- a map is
/// half a megabyte -- and the editor holds three copies of what it opens.
constexpr std::size_t kOpenLimit = 8u << 20;
/// How far the editor lets a file grow.
constexpr std::size_t kEditLimit = 16u << 20;
/// How long a button that throws something away stays armed for its second
/// click.
constexpr double kArmSeconds = 3.0;
/// An SVG's preview is rebuilt this long after the last keystroke, not on each.
constexpr double kPreviewDebounce = 0.35;
/// How long a message holds the footer before the open file's note returns.
constexpr double kStatusSeconds = 8.0;
/// A tab is drawn this many spaces wide.
constexpr int kTabSpaces = 4;
/// Runs of text longer than this are drawn in pieces, each placed where the
/// editor's own arithmetic says it starts. The page's text engine kerns and
/// the layout here does not, and over a long run the two drift apart until a
/// caret sits beside the letter it is in front of.
constexpr std::size_t kRunChunk = 24;
/// The largest boot tool read for its summary.
constexpr std::size_t kToolLimit = 1u << 20;

constexpr std::uint32_t kEditorFill = 0x1B1F23u;
constexpr std::uint32_t kGutterFill = 0x22272Cu;
constexpr std::uint32_t kGutterInk = 0x6E7A84u;
constexpr std::uint32_t kCurrentLineFill = 0x2A3138u;
constexpr std::uint32_t kSelectionFill = 0x355F8Fu;
constexpr std::uint32_t kPreviewFill = 0xD8DDE0u;
constexpr std::uint32_t kMutedInk = 0xD5E4E1u;
constexpr std::uint32_t kFolderInk = 0xFFD27Au;
constexpr std::uint32_t kOkInk = 0xB9F6A6u;
constexpr std::uint32_t kBadInk = 0xFFB0B0u;
constexpr std::uint32_t kDirtyInk = 0xFFC94Du;

constexpr std::uint32_t kTextInk = 0xE6E6E6u;
constexpr std::uint32_t kStringInk = 0xFFE9A8u;
constexpr std::uint32_t kNumberInk = 0xA8E6FFu;
constexpr std::uint32_t kKeywordInk = 0xD9BFFFu;
constexpr std::uint32_t kCommentInk = 0x8FA88Fu;
constexpr std::uint32_t kPunctuationInk = 0xA9B1B8u;
constexpr std::uint32_t kTagInk = 0x7FC8FFu;
constexpr std::uint32_t kAttributeInk = 0xB9F6A6u;

constexpr ChipStyle kChip{0x5D7A76u, 0x445C59u};
constexpr ChipStyle kOnChip{0x8FC2BAu, 0x5D7A76u};
constexpr ChipStyle kGoChip{0x4CAF50u, 0x2E7D32u};
constexpr ChipStyle kDangerChip{0xC0504Du, 0x8E3A38u};

/// What a click landed on.
enum class Act : std::uint8_t {
    None,
    Close,
    Back,
    TabFiles,
    TabBoot,
    Place,
    Up,
    Refresh,
    Entry,
    NewFile,
    CreateFile,
    CancelNew,
    Save,
    Revert,
    CloseFile,
    Delete,
    SetBoot,
    Preview,
    UseGame,
    UseTool,
    OpenTool,
    OpenChoice,
    Reload,
};

struct Hit {
    Rect rect;
    Act act = Act::None;
    int index = -1;
};

enum class Tab : std::uint8_t { Files, Boot };

/// A starting point in the list. The browser's are fixed, a native client's
/// follow wherever it was pointed.
struct Place {
    const char* label;
    std::string path;
    const char* note;
};

struct OpenFile {
    bool open = false;
    std::string path;
    /// The buffer, and what the file held when it was opened or last saved.
    std::string text;
    std::string saved;
    bool binary = false;
    bool dirty = false;
    assets::Syntax syntax = assets::Syntax::Plain;
    /// What a Tab key types: the file's own first indent.
    std::string indent = "    ";
    std::vector<std::size_t> lines;
    /// The longest line, in bytes, which is how far the view may scroll right.
    std::size_t longest = 0;
    TextFieldState field;
    assets::EditHistory history;
    double scrollY = 0;
    /// The horizontal scroll, in BYTES into every line. A proportional face
    /// has no columns, but scrolling by pixels would mean measuring each long
    /// line from its start every frame -- a map's tile layer is a single line
    /// of tens of kilobytes. Moving every line's start along by the same count
    /// of bytes keeps the cost to what is on screen.
    std::size_t scrollCol = 0;
    /// Set by a keyboard edit or move, so the frame brings the caret into view.
    bool follow = false;
    bool svg = false;
    bool preview = true;
    std::shared_ptr<SvgDocument> drawing;
    /// When the preview is next rebuilt; negative while it is up to date.
    double previewDue = -1;
};

struct Tool {
    std::string path;
    std::string name;
    std::string summary;
    std::string source;
};

struct State {
    bool started = false;
    Tab tab = Tab::Files;
    int place = 0;
    std::string dir;
    std::vector<assets::Entry> entries;
    std::string listError;
    Scroller list;
    OpenFile file;

    bool naming = false;
    std::string newName;
    TextFieldState newField;

    /// The one button waiting for its second click.
    std::string armed;
    double armedAt = -100;

    std::string status;
    bool statusOk = true;
    double statusAt = -100;

    std::vector<Tool> tools;
    web::BootChoice choice;
    std::string bootedFrom;
    /// Whether this session changed the choice, which is when Reload is the
    /// thing to press.
    bool choiceChanged = false;
    Scroller bootList;

    bool barDragging = false;
    double barGrab = 0;
};

State& state() {
    static State s;
    return s;
}

std::string& dataDirectory() {
    static std::string dir = "data";
    return dir;
}

std::string& settingsFile() {
    static std::string path;
    return path;
}

std::vector<Place> places() {
#ifdef __EMSCRIPTEN__
    return {
        {"Content", "/data",
         "Embedded in the game: an edit lasts until the page reloads, and the game read "
         "what it needed when it started."},
        {"Storage", "/persist", "The client's browser storage: what is saved here is kept."},
        {"Boot", web::kBootToolDirectory, "Scripts a page load can run instead of the game."},
        {"Everything", "/", "The whole of the page's file system."},
    };
#else
    return {
        {"Content", dataDirectory(),
         "This build's staged copy of data/ and maps/: the next build replaces it."},
        {"Working dir", ".", "Where this client keeps its settings and its session."},
    };
#endif
}

// --- small helpers ----------------------------------------------------------

TextStyle label(double size, std::uint32_t fill = kPaper, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.strokeWidth = 0;
    style.align = align;
    style.baseline = Baseline::Middle;
    return style;
}

/// A clickable rect, cut down to the part of it inside `view`.
Rect clipTo(Rect r, Rect view) {
    const double x0 = std::max(r.x, view.x);
    const double y0 = std::max(r.y, view.y);
    const double x1 = std::min(r.right(), view.right());
    const double y1 = std::min(r.bottom(), view.bottom());
    return {x0, y0, std::max(0.0, x1 - x0), std::max(0.0, y1 - y0)};
}

void clipCanvas(Canvas& canvas, Rect r) {
    canvas.beginPath();
    canvas.rect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                static_cast<float>(r.h));
    canvas.clip();
}

bool isLead(char byte) { return (static_cast<unsigned char>(byte) & 0xC0) != 0x80; }

/// `path` cut from the FRONT until it fits: the end of a path is the part
/// that says where you are.
std::string ellipsizeFront(const std::string& path, double size, double width) {
    if (measure(path, size) <= width) return path;
    const std::string dots = "\xE2\x80\xA6";
    std::size_t from = 0;
    while (from < path.size()) {
        from = utf8Next(path, from);
        const std::string tail = dots + path.substr(from);
        if (measure(tail, size) <= width) return tail;
    }
    return dots;
}

void setStatus(State& s, const std::string& message, bool ok, double now) {
    s.status = message;
    s.statusOk = ok;
    s.statusAt = now;
}

bool isArmed(const State& s, const std::string& what, double now) {
    return s.armed == what && now - s.armedAt <= kArmSeconds;
}

/// The first click arms `what`; a second within kArmSeconds confirms it.
bool confirmArmed(State& s, const std::string& what, double now) {
    if (isArmed(s, what, now)) {
        s.armed.clear();
        return true;
    }
    s.armed = what;
    s.armedAt = now;
    return false;
}

std::uint32_t tokenInk(assets::Token token) {
    switch (token) {
        case assets::Token::String: return kStringInk;
        case assets::Token::Number: return kNumberInk;
        case assets::Token::Keyword: return kKeywordInk;
        case assets::Token::Comment: return kCommentInk;
        case assets::Token::Punctuation: return kPunctuationInk;
        case assets::Token::Tag: return kTagInk;
        case assets::Token::Attribute: return kAttributeInk;
        case assets::Token::Text: break;
    }
    return kTextInk;
}

/// Whether a file at `path` is kept by browser storage rather than memory.
bool inStorage(const std::string& path) {
#ifdef __EMSCRIPTEN__
    const std::string root = web::kStorageDirectory;
    return path == root || path.rfind(root + "/", 0) == 0;
#else
    (void)path;
    return false;
#endif
}

/// What saving the file at `path` means, for the footer.
std::string locationNote(const std::string& path) {
    const bool settings = !settingsFile().empty() && path == settingsFile();
#ifdef __EMSCRIPTEN__
    if (inStorage(path)) {
        if (settings) return "Kept in browser storage. Saving it reloads the settings.";
        if (assets::baseName(path) == "session") {
            return "Kept in browser storage. The client rewrites this when the page closes.";
        }
        return "Kept in browser storage.";
    }
    return "In memory: an edit lasts until the page reloads.";
#else
    if (settings) return "On disk. Saving it reloads the settings.";
    return "On disk.";
#endif
}

// --- the editor's arithmetic ------------------------------------------------

/// The advance of each ASCII character at the editor's size, measured once.
double asciiAdvance(unsigned char c) {
    static std::array<double, 128> table{};
    static bool ready = false;
    if (!ready) {
        for (int i = 0x20; i < 0x7F; ++i) {
            table[static_cast<std::size_t>(i)] = measure(std::string(1, static_cast<char>(i)),
                                                         kCodeSize);
        }
        // Not kept until the face could measure: a zero width is a font that
        // has not loaded, not a space that takes no room.
        ready = table[static_cast<std::size_t>(' ')] > 0;
    }
    return c < 0x80 ? table[c] : 0.0;
}

/// The width one character takes in the editor, and where the next begins. A
/// tab is kTabSpaces spaces; a carriage return and the other controls take
/// nothing, as nothing is drawn for them.
double advanceAt(const std::string& buffer, std::size_t at, std::size_t& next) {
    const auto c = static_cast<unsigned char>(buffer[at]);
    if (c < 0x80) {
        next = at + 1;
        if (c == '\t') return asciiAdvance(' ') * kTabSpaces;
        return asciiAdvance(c);
    }
    next = utf8Next(buffer, at);
    return measure(buffer.substr(at, next - at), kCodeSize);
}

/// The width of [from, to), stopping early once it passes `cap`.
double widthOf(const std::string& buffer, std::size_t from, std::size_t to,
               double cap = 1e300) {
    double width = 0;
    std::size_t at = from;
    while (at < to && width <= cap) {
        std::size_t next = at;
        width += advanceAt(buffer, at, next);
        at = next;
    }
    return width;
}

/// The characters of [from, to) as they are drawn: a tab as spaces, the
/// controls left out.
std::string displayed(const std::string& buffer, std::size_t from, std::size_t to) {
    std::string out;
    out.reserve(to - from);
    for (std::size_t i = from; i < to; ++i) {
        const char c = buffer[i];
        if (c == '\t') out.append(static_cast<std::size_t>(kTabSpaces), ' ');
        else if (static_cast<unsigned char>(c) >= 0x20 && c != 0x7F) out += c;
    }
    return out;
}

/// Draws [from, to) of `buffer` with its left edge at `x`, in short pieces --
/// see kRunChunk.
void drawRun(Canvas& canvas, const std::string& buffer, std::size_t from, std::size_t to,
             double x, double y, std::uint32_t ink) {
    const TextStyle style = label(kCodeSize, ink);
    std::size_t at = from;
    while (at < to) {
        std::size_t end = std::min(to, at + kRunChunk);
        while (end < to && !isLead(buffer[end])) ++end;
        const std::string piece = displayed(buffer, at, end);
        if (!piece.empty()) text(canvas, piece, x, y, style);
        x += widthOf(buffer, at, end);
        at = end;
    }
}

void reindex(OpenFile& f) {
    f.lines = assets::lineStarts(f.text);
    f.longest = 0;
    for (std::size_t i = 0; i < f.lines.size(); ++i) {
        const std::size_t end = i + 1 < f.lines.size() ? f.lines[i + 1] - 1 : f.text.size();
        f.longest = std::max(f.longest, end - f.lines[i]);
    }
}

/// The first indented line's indent, as what Tab types: a tab if the file
/// indents with tabs, that many spaces if with spaces, four if it has none.
std::string indentOf(const std::string& buffer) {
    std::size_t at = 0;
    for (int line = 0; line < 2000 && at < buffer.size(); ++line) {
        const std::size_t end = std::min(buffer.find('\n', at), buffer.size());
        if (at < end && buffer[at] == '\t') return "\t";
        std::size_t spaces = 0;
        while (at + spaces < end && buffer[at + spaces] == ' ') ++spaces;
        if (spaces > 0 && at + spaces < end) return std::string(std::min<std::size_t>(spaces, 8), ' ');
        at = end + 1;
    }
    return "    ";
}

std::size_t rowCount(const OpenFile& f) {
    return f.binary ? (f.text.size() + 15) / 16 : f.lines.size();
}

/// Where line `line` ends, its newline left out.
std::size_t lineEnd(const OpenFile& f, std::size_t line) {
    return line + 1 < f.lines.size() ? f.lines[line + 1] - 1 : f.text.size();
}

/// Where the shown part of line `line` begins: the horizontal scroll's count
/// of bytes in, on a character boundary, and never past the line's end.
std::size_t visibleStart(const OpenFile& f, std::size_t line) {
    const std::size_t stop = lineEnd(f, line);
    std::size_t at = std::min(f.lines[line] + f.scrollCol, stop);
    while (at < stop && !isLead(f.text[at])) ++at;
    return at;
}

struct EditorLayout {
    Rect box;      ///< the editor's plate
    Rect gutter;   ///< line numbers, or a hex dump's offsets
    Rect view;     ///< where lines are drawn and where a press places the caret
    Rect bar;      ///< the vertical scrollbar's track
    Rect preview;  ///< an SVG's preview; empty when there is none
};

EditorLayout layoutEditor(Rect box, const OpenFile& f) {
    EditorLayout out;
    if (f.svg && f.preview && !f.binary) {
        out.preview = Rect{box.right() - kPreviewWidth, box.y, kPreviewWidth, box.h};
        box.w -= kPreviewWidth + 8.0;
    }
    out.box = box;
    double gutterW = 0;
    if (f.binary) {
        gutterW = widthOf("00000000", 0, 8) + 16.0;
    } else {
        int digits = 3;
        for (std::size_t n = f.lines.size(); n >= 1000; n /= 10) ++digits;
        gutterW = digits * asciiAdvance('0') + 18.0;
    }
    out.gutter = Rect{box.x, box.y, gutterW, box.h};
    out.bar = Rect{box.right() - kScrollbarWidth - 4.0, box.y + 4.0, kScrollbarWidth, box.h - 8.0};
    const double viewX = box.x + gutterW + 6.0;
    out.view = Rect{viewX, box.y + 4.0, std::max(10.0, out.bar.x - 4.0 - viewX), box.h - 8.0};
    return out;
}

double maxScrollY(const OpenFile& f, const EditorLayout& layout) {
    return std::max(0.0, static_cast<double>(rowCount(f)) * kLineHeight + kLineHeight * 0.5 -
                             layout.view.h);
}

void clampScroll(OpenFile& f, const EditorLayout& layout) {
    f.scrollY = clamp(f.scrollY, 0.0, maxScrollY(f, layout));
    if (f.scrollCol > f.longest) f.scrollCol = f.longest;
}

struct Thumb {
    bool shown = false;
    Rect rect;
    double travel = 0;
};

Thumb thumbOf(const OpenFile& f, const EditorLayout& layout) {
    const double content = static_cast<double>(rowCount(f)) * kLineHeight + kLineHeight * 0.5;
    if (content <= layout.view.h || layout.bar.h <= 0) return {};
    const double height = std::max(28.0, layout.bar.h * (layout.view.h / content));
    const double top = maxScrollY(f, layout);
    const double y = layout.bar.y + (top > 0 ? f.scrollY / top : 0.0) * (layout.bar.h - height);
    return {true, Rect{layout.bar.x, y, layout.bar.w, height}, layout.bar.h - height};
}

/// The byte offset a point lands on: the line under it, and the character
/// boundary nearest it on that line.
std::size_t offsetAt(const OpenFile& f, const EditorLayout& layout, Vec2 point) {
    if (f.lines.empty()) return 0;
    const double row = std::floor((point.y - layout.view.y + f.scrollY) / kLineHeight);
    const std::size_t line =
        row < 0 ? 0 : std::min(static_cast<std::size_t>(row), f.lines.size() - 1);
    const std::size_t stop = lineEnd(f, line);
    std::size_t at = visibleStart(f, line);
    double x = layout.view.x;
    while (at < stop) {
        std::size_t next = at;
        const double width = advanceAt(f.text, at, next);
        if (point.x < x + width * 0.5) return at;
        x += width;
        at = next;
    }
    return stop;
}

/// Where `offset` on line `line` is drawn. An offset scrolled off to the left
/// is just left of the view, which is where a highlight that starts there is
/// cut off.
double xOf(const OpenFile& f, const EditorLayout& layout, std::size_t line, std::size_t offset) {
    const std::size_t from = visibleStart(f, line);
    if (offset < from) return layout.view.x - 1.0;
    return layout.view.x + widthOf(f.text, from, offset, layout.view.w + 20.0);
}

/// Scrolls so the caret is on screen, with some room around it.
void followCaret(OpenFile& f, const EditorLayout& layout) {
    const std::size_t caret = std::min(f.field.selection.caret, f.text.size());
    const std::size_t line = assets::lineOf(f.lines, caret);
    const double top = static_cast<double>(line) * kLineHeight;
    if (top < f.scrollY) f.scrollY = top;
    if (top + kLineHeight > f.scrollY + layout.view.h) f.scrollY = top + kLineHeight - layout.view.h;

    const std::size_t start = f.lines[line];
    const std::size_t column = caret - start;
    const double span = layout.view.w - 16.0;
    if (column < f.scrollCol) {
        f.scrollCol = column > 8 ? column - 8 : 0;
    } else if (widthOf(f.text, visibleStart(f, line), caret, span + 1.0) > span) {
        // Back from the caret until three quarters of the view is behind it.
        double behind = 0;
        std::size_t at = caret;
        while (at > start) {
            const std::size_t prev = utf8Prev(f.text, at);
            std::size_t next = prev;
            behind += advanceAt(f.text, prev, next);
            if (behind > span * 0.75) break;
            at = prev;
        }
        f.scrollCol = at - start;
    }
    clampScroll(f, layout);
}

void replaceSelection(OpenFile& f, const std::string& with) {
    TextSelection& selection = f.field.selection;
    const std::size_t begin = std::min(selection.begin(), f.text.size());
    const std::size_t end = std::min(selection.end(), f.text.size());
    if (f.text.size() - (end - begin) + with.size() > kEditLimit) return;
    f.text.replace(begin, end - begin, with);
    selection.collapse(begin + with.size());
}

/// After Enter: the new line starts with the indent of the one it broke from.
void carryIndent(OpenFile& f) {
    const std::size_t caret = f.field.selection.caret;
    if (caret == 0 || caret > f.text.size() || f.text[caret - 1] != '\n') return;
    std::size_t start = caret - 1;
    while (start > 0 && f.text[start - 1] != '\n') --start;
    std::size_t end = start;
    while (end < caret - 1 && (f.text[end] == ' ' || f.text[end] == '\t')) ++end;
    if (end == start || f.text.size() + (end - start) > kEditLimit) return;
    const std::string indent = f.text.substr(start, end - start);
    f.text.insert(caret, indent);
    f.field.selection.collapse(caret + indent.size());
}

// --- files ------------------------------------------------------------------

void relist(State& s) {
    s.listError.clear();
    if (!assets::listDirectory(s.dir, s.entries, s.listError)) s.entries.clear();
}

void enterDirectory(State& s, const std::string& dir) {
    s.dir = dir;
    s.list.offset = 0;
    s.naming = false;
    s.newField.blur();
    relist(s);
}

void loadBoot(State& s) {
    s.tools.clear();
    s.choice = web::storedBootChoice();
    s.bootedFrom = web::bootedThrough();
    std::vector<assets::Entry> entries;
    std::string error;
    if (!assets::listDirectory(web::kBootToolDirectory, entries, error)) return;
    for (const assets::Entry& entry : entries) {
        if (entry.directory || assets::extensionOf(entry.name) != "js") continue;
        Tool tool;
        tool.path = assets::joinPath(web::kBootToolDirectory, entry.name);
        tool.name = entry.name;
        if (!assets::readWhole(tool.path, tool.source, kToolLimit, error)) continue;
        tool.summary = assets::scriptSummary(tool.source);
        s.tools.push_back(std::move(tool));
    }
}

void start(State& s) {
    s.started = true;
    s.place = 0;
    enterDirectory(s, places().front().path);
}

void openFile(State& s, const std::string& path, double now) {
    std::string bytes;
    std::string error;
    if (!assets::readWhole(path, bytes, kOpenLimit, error)) {
        setStatus(s, "Could not open " + assets::baseName(path) + ": " + error, false, now);
        return;
    }
    OpenFile& f = s.file;
    f = OpenFile{};
    f.open = true;
    f.path = path;
    f.binary = !assets::looksLikeText(bytes);
    f.syntax = assets::syntaxFor(path);
    f.svg = !f.binary && assets::extensionOf(path) == "svg";
    f.previewDue = f.svg ? now : -1.0;
    f.text = bytes;
    f.saved = std::move(bytes);
    f.indent = indentOf(f.text);
    reindex(f);
    f.history.reset(f.text);
    s.armed.clear();
}

void saveFile(MenuContext& ctx, State& s) {
    OpenFile& f = s.file;
    std::string error;
    if (!assets::writeWhole(f.path, f.text, error)) {
        setStatus(s, "Could not save " + assets::baseName(f.path) + ": " + error, false,
                  ctx.timeSeconds);
        return;
    }
    f.saved = f.text;
    f.dirty = false;
    std::string message = "Saved " + assets::baseName(f.path) + " (" +
                          assets::formatSize(f.text.size()) + ")";
    if (!settingsFile().empty() && f.path == settingsFile()) {
        // Or the client writes the settings it holds back over this file on
        // the way out, and the edit is gone.
        ctx.settings.load(f.path);
        message += "; the settings were reloaded from it";
    }
    setStatus(s, message + ".", true, ctx.timeSeconds);
    relist(s);
}

/// Opens `path` in the Files tab, from wherever it is called.
void showFile(State& s, const std::string& path, double now) {
    s.tab = Tab::Files;
    const std::vector<Place> spots = places();
    for (std::size_t i = 0; i < spots.size(); ++i) {
        const std::string& root = spots[i].path;
        if (assets::parentPath(path) == root || path.rfind(root + "/", 0) == 0) {
            s.place = static_cast<int>(i);
            break;
        }
    }
    enterDirectory(s, assets::parentPath(path));
    openFile(s, path, now);
}

// --- boot -------------------------------------------------------------------

void useBootScript(State& s, const std::string& path, const std::string& source, double now) {
    std::string error;
    if (!web::storeBootChoice(path, source, error)) {
        setStatus(s, "Could not set the boot script: " + error, false, now);
        return;
    }
    s.choice = web::storedBootChoice();
    s.choiceChanged = true;
    setStatus(s, "The next page load runs " + path + " instead of the game. Reload to start it.",
              true, now);
}

void useGame(State& s, double now) {
    std::string error;
    if (!web::clearBootChoice(error)) {
        setStatus(s, "Could not clear the boot script: " + error, false, now);
        return;
    }
    s.choice = web::storedBootChoice();
    s.choiceChanged = true;
    setStatus(s, "The next page load starts the game.", true, now);
}

// --- drawing ----------------------------------------------------------------

void folderIcon(Canvas& canvas, double x, double cy) {
    fillRound(canvas, Rect{x, cy - 5.0, 7.0, 4.0}, 1.5, kFolderInk);
    fillRound(canvas, Rect{x, cy - 3.5, 15.0, 10.0}, 2.0, kFolderInk);
}

void fileIcon(Canvas& canvas, double x, double cy, std::uint32_t ink) {
    fillRound(canvas, Rect{x + 2.0, cy - 7.0, 11.0, 14.0}, 2.0, ink, 0.85);
    setFill(canvas, kInk, 0.25);
    canvas.fillRect(static_cast<float>(x + 4.5), static_cast<float>(cy - 3.0), 6.0f, 1.0f);
    canvas.fillRect(static_cast<float>(x + 4.5), static_cast<float>(cy), 6.0f, 1.0f);
    canvas.fillRect(static_cast<float>(x + 4.5), static_cast<float>(cy + 3.0), 4.0f, 1.0f);
}

std::uint32_t fileInk(const std::string& name) {
    switch (assets::syntaxFor(name)) {
        case assets::Syntax::Json: return kNumberInk;
        case assets::Syntax::Script: return kStringInk;
        case assets::Syntax::Markup: return kAttributeInk;
        case assets::Syntax::Plain: break;
    }
    return 0xDDDDDDu;
}

double badge(Canvas& canvas, const std::string& word, double x, double cy, std::uint32_t ink) {
    const double width = measure(word, 10.0) + 10.0;
    fillRound(canvas, Rect{x, cy - 8.0, width, 16.0}, 4.0, kInk, 0.35);
    text(canvas, word, x + width * 0.5, cy, label(10.0, ink, Align::Centre));
    return width;
}

void drawText(Canvas& canvas, const OpenFile& f, const EditorLayout& layout, double now) {
    const std::size_t rows = rowCount(f);
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(f.scrollY / kLineHeight)));
    const std::size_t shown = static_cast<std::size_t>(layout.view.h / kLineHeight) + 2;
    const std::size_t last = std::min(rows, first + shown);
    const TextSelection& selection = f.field.selection;
    const std::size_t caret = std::min(selection.caret, f.text.size());
    const std::size_t caretLine = assets::lineOf(f.lines, caret);
    const double right = layout.view.right();

    for (std::size_t line = first; line < last; ++line) {
        const double top = layout.view.y + static_cast<double>(line) * kLineHeight - f.scrollY;
        const double cy = top + kLineHeight * 0.5;
        const std::size_t start = f.lines[line];
        const std::size_t stop = lineEnd(f, line);
        const std::size_t from = visibleStart(f, line);

        if (line == caretLine && f.field.focused) {
            setFill(canvas, kCurrentLineFill);
            canvas.fillRect(static_cast<float>(layout.view.x - 4.0), static_cast<float>(top),
                            static_cast<float>(layout.view.w + 4.0),
                            static_cast<float>(kLineHeight));
        }

        // The selection, cut to this line; a selected newline shows as a
        // sliver past the line's end.
        if (!selection.empty() && selection.begin() <= stop && selection.end() > start) {
            const std::size_t a = std::max(selection.begin(), start);
            const std::size_t b = std::min(selection.end(), stop);
            const double x0 = std::max(layout.view.x - 4.0, xOf(f, layout, line, a));
            double x1 = std::min(right, xOf(f, layout, line, b));
            if (selection.end() > stop) x1 = std::min(right, x1 + 6.0);
            if (x1 > x0) {
                setFill(canvas, kSelectionFill);
                canvas.fillRect(static_cast<float>(x0), static_cast<float>(top), static_cast<float>(x1 - x0),
                                static_cast<float>(kLineHeight));
            }
        }

        // What fits, coloured. The colouring runs over the shown part alone.
        std::size_t to = from;
        for (double x = layout.view.x; to < stop && x < right;) {
            std::size_t next = to;
            x += advanceAt(f.text, to, next);
            to = next;
        }
        if (to > from) {
            const std::string visible = f.text.substr(from, to - from);
            double x = layout.view.x;
            for (const assets::Span& span : assets::highlightLine(visible, f.syntax)) {
                drawRun(canvas, visible, span.begin, span.end, x, cy, tokenInk(span.token));
                x += widthOf(visible, span.begin, span.end);
            }
        }
    }

    if (f.field.focused && caretVisible(f.field, now) && caretLine >= first && caretLine < last) {
        const double x = xOf(f, layout, caretLine, caret);
        if (x >= layout.view.x - 1.0 && x <= right) {
            const double top = layout.view.y + static_cast<double>(caretLine) * kLineHeight - f.scrollY;
            setFill(canvas, kPaper);
            canvas.fillRect(static_cast<float>(x), static_cast<float>(top + 2.0), 1.5f,
                            static_cast<float>(kLineHeight - 4.0));
        }
    }
}

void drawGutter(Canvas& canvas, const OpenFile& f, const EditorLayout& layout) {
    const std::size_t rows = rowCount(f);
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(f.scrollY / kLineHeight)));
    const std::size_t last = std::min(rows, first + static_cast<std::size_t>(layout.view.h / kLineHeight) + 2);
    const std::size_t caretLine =
        f.binary ? rows : assets::lineOf(f.lines, std::min(f.field.selection.caret, f.text.size()));
    for (std::size_t row = first; row < last; ++row) {
        const double cy = layout.view.y + static_cast<double>(row) * kLineHeight - f.scrollY +
                          kLineHeight * 0.5;
        if (f.binary) {
            text(canvas, assets::hexRow(f.text, row * 16).substr(0, 8), layout.gutter.x + 8.0, cy,
                 label(kCodeSize, kGutterInk));
        } else {
            text(canvas, std::to_string(row + 1), layout.gutter.right() - 8.0, cy,
                 label(kCodeSize, row == caretLine && f.field.focused ? kPaper : kGutterInk,
                       Align::Right));
        }
    }
}

void drawHex(Canvas& canvas, const OpenFile& f, const EditorLayout& layout) {
    const std::size_t rows = rowCount(f);
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(f.scrollY / kLineHeight)));
    const std::size_t last = std::min(rows, first + static_cast<std::size_t>(layout.view.h / kLineHeight) + 2);
    // Four groups of four bytes, each at a fixed place: the face is not a
    // monospace one, and the columns would wander from row to row otherwise.
    double group = 0;
    for (const char* sample : {"00 00 00 00", "bb bb bb bb", "dd dd dd dd", "ee ee ee ee"}) {
        group = std::max(group, widthOf(sample, 0, 11));
    }
    group += 12.0;
    for (std::size_t row = first; row < last; ++row) {
        const double cy = layout.view.y + static_cast<double>(row) * kLineHeight - f.scrollY +
                          kLineHeight * 0.5;
        const std::string line = assets::hexRow(f.text, row * 16);
        for (int g = 0; g < 4; ++g) {
            const std::size_t at = 10 + static_cast<std::size_t>(g) * 12 + (g >= 2 ? 1 : 0);
            if (at < line.size()) {
                text(canvas, line.substr(at, 11), layout.view.x + g * group, cy,
                     label(kCodeSize, g % 2 == 0 ? kTextInk : kNumberInk));
            }
        }
        if (line.size() > 60) {
            text(canvas, line.substr(60), layout.view.x + 4 * group + 8.0, cy,
                 label(kCodeSize, kStringInk));
        }
    }
}

void drawPreview(Canvas& canvas, const OpenFile& f, Rect box, double now) {
    fillRound(canvas, box, 6.0, kPreviewFill);
    const Rect art{box.x + 14.0, box.y + 14.0, box.w - 28.0, box.h - 44.0};
    if (!f.drawing || f.drawing->empty()) {
        text(canvas, "Nothing to draw", box.x + box.w * 0.5, art.y + art.h * 0.5,
             label(13.0, 0x555555u, Align::Centre));
    } else {
        canvas.save();
        clipCanvas(canvas, box);
        f.drawing->renderFitted(canvas, static_cast<float>(art.x), static_cast<float>(art.y),
                                static_cast<float>(art.w), static_cast<float>(art.h),
                                static_cast<float>(now));
        canvas.restore();
        char size[64];
        std::snprintf(size, sizeof size, "%g x %g", static_cast<double>(f.drawing->viewBoxWidth()),
                      static_cast<double>(f.drawing->viewBoxHeight()));
        text(canvas, size, box.x + box.w * 0.5, box.bottom() - 14.0,
             label(12.0, 0x555555u, Align::Centre));
    }
}

// --- the tabs ---------------------------------------------------------------

void filesTab(MenuContext& ctx, State& s, std::vector<Hit>& regions, Rect body) {
    Canvas& canvas = ctx.canvas;
    Window& window = ctx.window;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    const auto addRegion = [&](Rect r, Act act, int index = -1) {
        if (r.w > 0 && r.h > 0) regions.push_back({r, act, index});
    };
    const std::vector<Place> spots = places();
    if (s.place < 0 || s.place >= static_cast<int>(spots.size())) s.place = 0;

    const Rect left{body.x, body.y, kListWidth, body.h};
    const Rect right{left.right() + kPad, body.y, body.right() - left.right() - kPad, body.h};

    // -- the left column -----------------------------------------------------

    double y = left.y;
    {
        const double gap = 5.0;
        const double width = (left.w - gap * static_cast<double>(spots.size() - 1)) /
                             static_cast<double>(spots.size());
        for (std::size_t i = 0; i < spots.size(); ++i) {
            const Rect r{left.x + static_cast<double>(i) * (width + gap), y, width, kChipHeight};
            ChipStyle style = static_cast<int>(i) == s.place ? kOnChip : kChip;
            style.textSize = 12.0;
            chip(canvas, r, spots[i].label, r.contains(mouse), style);
            addRegion(r, Act::Place, static_cast<int>(i));
        }
        y += kChipHeight + 8.0;
    }
    {
        const bool canGoUp = s.dir != spots[static_cast<std::size_t>(s.place)].path;
        const Rect up{left.x, y, 38.0, kChipHeight};
        ChipStyle upStyle = kChip;
        upStyle.enabled = canGoUp;
        upStyle.textSize = 12.0;
        chip(canvas, up, "Up", canGoUp && up.contains(mouse), upStyle);
        if (canGoUp) addRegion(up, Act::Up);
        const Rect refresh{left.right() - 66.0, y, 66.0, kChipHeight};
        ChipStyle refreshStyle = kChip;
        refreshStyle.textSize = 12.0;
        chip(canvas, refresh, "Refresh", refresh.contains(mouse), refreshStyle);
        addRegion(refresh, Act::Refresh);
        const double pathX = up.right() + 8.0;
        text(canvas, ellipsizeFront(s.dir, 13.0, refresh.x - 8.0 - pathX), pathX,
             y + kChipHeight * 0.5, label(13.0, kMutedInk));
        y += kChipHeight + 6.0;
    }

    const double listBottom = left.bottom() - kChipHeight - 8.0;
    const Rect listView{left.x, y, left.w, std::max(0.0, listBottom - y)};
    fillRound(canvas, listView, 6.0, kInk, 0.18);

    Rect nameRect{};
    {
        const double formH = s.naming ? kListRow + 6.0 : 0.0;
        const int count = static_cast<int>(s.entries.size());
        s.list.contentHeight = count * kListRow + 8.0 + formH;
        s.list.viewHeight = listView.h;
        if (listView.contains(mouse)) s.list.offset -= ctx.wheel() * kListWheelStep;
        s.list.offset -= touchScroll(window, listView, s.list.maxOffset() > 0);
        s.list.offset = clamp(s.list.offset, 0.0, s.list.maxOffset());

        canvas.save();
        clipCanvas(canvas, listView);
        double rowY = listView.y + 4.0 - s.list.offset;
        if (s.naming) {
            // A new file's name, typed in place at the head of the list.
            const Rect create{listView.right() - 4.0 - 58.0, rowY + 1.0, 58.0, kListRow - 2.0};
            nameRect = Rect{listView.x + 6.0, rowY, create.x - 6.0 - (listView.x + 6.0), kListRow};
            inputField(canvas, nameRect, s.newName, "name.js", s.newField.focused, now, &s.newField);
            ChipStyle go = kGoChip;
            go.textSize = 12.0;
            chip(canvas, create, "Create", create.contains(mouse), go);
            addRegion(clipTo(create, listView), Act::CreateFile);
            rowY += formH;
        }
        const double rowW = listView.w - 8.0 - kScrollbarWidth;
        for (int i = 0; i < count; ++i, rowY += kListRow) {
            const Rect row{listView.x + 4.0, rowY, rowW, kListRow - 2.0};
            if (row.bottom() < listView.y || row.y > listView.bottom()) continue;
            const assets::Entry& entry = s.entries[static_cast<std::size_t>(i)];
            const bool selected = s.file.open && assets::joinPath(s.dir, entry.name) == s.file.path;
            const bool hovered = clipTo(row, listView).contains(mouse);
            fillRound(canvas, row, 4.0, kPaper, selected ? 0.28 : hovered ? 0.14 : 0.0);
            const double cy = row.y + row.h * 0.5;
            if (entry.directory) folderIcon(canvas, row.x + 6.0, cy);
            else fileIcon(canvas, row.x + 5.0, cy, fileInk(entry.name));
            std::string size;
            if (!entry.directory) size = assets::formatSize(entry.size);
            const double sizeW = size.empty() ? 0.0 : measure(size, 11.0) + 8.0;
            text(canvas, ellipsize(entry.name, 13.0, row.w - 34.0 - sizeW), row.x + 26.0, cy,
                 label(13.0, entry.directory ? kFolderInk : kPaper));
            if (!size.empty()) {
                text(canvas, size, row.right() - 6.0, cy, label(11.0, kMutedInk, Align::Right));
            }
            addRegion(clipTo(row, listView), Act::Entry, i);
        }
        if (count == 0) {
            const std::string empty =
                s.listError.empty() ? "Nothing here." : "Could not read it: " + s.listError;
            text(canvas, ellipsize(empty, 13.0, listView.w - 20.0), listView.x + listView.w * 0.5,
                 rowY + 18.0, label(13.0, kMutedInk, Align::Centre));
        }
        canvas.restore();
        scrollbar(canvas, Rect{listView.x, listView.y + 4.0, listView.w - 2.0, listView.h - 13.0},
                  s.list.contentHeight, s.list.offset, kAssetsSkin.accent, 8.0);
    }
    {
        const Rect make{left.x, left.bottom() - kChipHeight, 92.0, kChipHeight};
        ChipStyle style = s.naming ? kOnChip : kChip;
        style.textSize = 12.0;
        chip(canvas, make, s.naming ? "Cancel" : "New file", make.contains(mouse), style);
        addRegion(make, s.naming ? Act::CancelNew : Act::NewFile);
        const std::size_t count = s.entries.size();
        text(canvas, std::to_string(count) + (count == 1 ? " item" : " items"), left.right(),
             make.y + kChipHeight * 0.5, label(12.0, kMutedInk, Align::Right));
    }
    if (s.naming) {
        trackTextMouse(window, s.newField, nameRect, inputFieldRun(nameRect, s.newName, s.newField),
                       s.newName, now);
    }

    // -- the right column: the open file -------------------------------------

    fillRound(canvas, right, 6.0, kInk, 0.18);
    OpenFile& f = s.file;
    if (!f.open) {
        text(canvas, "Open a file on the left.", right.x + right.w * 0.5, right.y + right.h * 0.5 - 12.0,
             label(15.0, kPaper, Align::Centre));
        text(canvas, spots[static_cast<std::size_t>(s.place)].note, right.x + right.w * 0.5,
             right.y + right.h * 0.5 + 12.0, label(12.0, kMutedInk, Align::Centre));
        return;
    }

    const Rect toolbar{right.x + 8.0, right.y, right.w - 16.0, kToolbarHeight};
    const Rect editorBox{right.x + 6.0, toolbar.bottom(), right.w - 12.0,
                         right.bottom() - 6.0 - toolbar.bottom()};
    const EditorLayout layout = layoutEditor(editorBox, f);

    // Pointer first, against this frame's layout, so a press lands where the
    // frame it was aimed at drew the text.
    const Thumb thumb = thumbOf(f, layout);
    if (s.barDragging) {
        if (window.mouseDown(MouseButton::Left) && thumb.shown && thumb.travel > 0) {
            f.scrollY = (mouse.y - s.barGrab - layout.bar.y) / thumb.travel * maxScrollY(f, layout);
        } else {
            s.barDragging = false;
        }
    }
    const bool pressOnBar = ctx.pressed() && thumb.shown && insideInclusive(layout.bar, mouse);
    if (pressOnBar) {
        s.barGrab = thumb.rect.contains(mouse) ? mouse.y - thumb.rect.y : thumb.rect.h * 0.5;
        s.barDragging = true;
        if (thumb.travel > 0) {
            f.scrollY = (mouse.y - s.barGrab - layout.bar.y) / thumb.travel * maxScrollY(f, layout);
        }
    }
    if (!f.binary && !pressOnBar && !s.barDragging) {
        trackTextMouseWith(
            window, f.field, layout.view, f.text, now,
            [&](Vec2 point) { return offsetAt(f, layout, point); }, false);
        if (insideInclusive(layout.view, mouse)) window.setCursorShape(CursorShape::Text);
        // A drag past the top or bottom edge keeps the view moving that way.
        if (f.field.dragging) {
            if (mouse.y < layout.view.y) f.scrollY -= (layout.view.y - mouse.y) * ctx.dt * 12.0;
            if (mouse.y > layout.view.bottom()) {
                f.scrollY += (mouse.y - layout.view.bottom()) * ctx.dt * 12.0;
            }
        }
    }
    // A press anywhere off the file -- the list, the header -- takes the caret.
    if (ctx.pressed() && !right.contains(mouse)) f.field.blur();

    if (insideInclusive(layout.box, mouse)) {
        const float wheel = ctx.wheel();
        if (wheel != 0 && window.shiftHeld()) {
            const double step = static_cast<double>(wheel) * static_cast<double>(kWheelColumns);
            const double col = static_cast<double>(f.scrollCol) - step;
            f.scrollCol = col <= 0 ? 0 : static_cast<std::size_t>(col);
        } else if (wheel != 0) {
            f.scrollY -= static_cast<double>(wheel) * kWheelLines * kLineHeight;
        }
    }
    f.scrollY -= touchScroll(window, layout.view, maxScrollY(f, layout) > 0);

    // The keyboard, while the editor has the caret.
    if (!f.binary && f.field.focused) {
        ctx.wantsText = true;
        window.setClaimedShortcuts({Key::S, Key::Z, Key::Y});
        const bool ctrl = window.ctrlHeld();
        const TextSelection before = f.field.selection;
        bool changed = false;
        bool rewound = false;
        if (ctrl && window.keyPressed(Key::S)) {
            saveFile(ctx, s);
        } else if (ctrl && (window.keyPressed(Key::Y) ||
                            (window.keyPressed(Key::Z) && window.shiftHeld()))) {
            rewound = f.history.redo(f.text, f.field.selection);
        } else if (ctrl && window.keyPressed(Key::Z)) {
            rewound = f.history.undo(f.text, f.field.selection);
        } else {
            if (!ctrl && window.keyTyped(Key::Tab)) {
                replaceSelection(f, f.indent);
                changed = true;
            }
            TextEditOptions typing;
            typing.multiline = true;
            typing.maxBytes = kEditLimit;
            const bool enter = window.keyPressed(Key::Enter);
            if (editText(window, f.text, f.field, now, typing)) {
                changed = true;
                if (enter) carryIndent(f);
            }
            // Ctrl+Home and Ctrl+End reach the ends of the file; the line's
            // ends are editText's.
            if (ctrl && window.keyTyped(Key::Home)) {
                f.field.selection.caret = 0;
                if (!window.shiftHeld()) f.field.selection.anchor = 0;
            }
            if (ctrl && window.keyTyped(Key::End)) {
                f.field.selection.caret = f.text.size();
                if (!window.shiftHeld()) f.field.selection.anchor = f.text.size();
            }
        }
        if (changed || rewound) {
            reindex(f);
            f.dirty = f.text != f.saved;
            if (changed) f.history.record(f.text, before, f.field.selection, now);
            if (f.svg) f.previewDue = now + kPreviewDebounce;
            f.field.caretSeconds = now;
        }
        if (changed || rewound || f.field.selection.caret != before.caret ||
            f.field.selection.anchor != before.anchor) {
            f.follow = true;
        }
        if (window.keyPressed(Key::Escape)) f.field.blur();
    }
    clampScroll(f, layout);
    if (f.follow) {
        followCaret(f, layout);
        f.follow = false;
    }
    if (f.svg && f.preview && f.previewDue >= 0 && now >= f.previewDue) {
        f.drawing = std::make_shared<SvgDocument>(SvgDocument::fromString(f.text));
        f.previewDue = -1;
    }

    // -- the toolbar ---------------------------------------------------------

    {
        const double cy = toolbar.y + toolbar.h * 0.5;
        double bx = toolbar.right();
        const auto action = [&](const std::string& caption, Act act, ChipStyle style, double w,
                                bool enabled = true) {
            const Rect r{bx - w, cy - kChipHeight * 0.5, w, kChipHeight};
            style.textSize = 12.0;
            style.enabled = enabled;
            chip(canvas, r, caption, enabled && r.contains(mouse), style);
            if (enabled) addRegion(r, act);
            bx -= w + 6.0;
        };
        const bool closeArmed = isArmed(s, "close", now);
        action(closeArmed ? "Discard?" : "Close", Act::CloseFile, closeArmed ? kDangerChip : kChip,
               closeArmed ? 70.0 : 54.0);
        if (!inStorage(f.path)) {
            const bool deleteArmed = isArmed(s, "delete", now);
            action(deleteArmed ? "Sure?" : "Delete", Act::Delete, kDangerChip, 60.0);
        }
        if (!f.binary) {
            const bool revertArmed = isArmed(s, "revert", now);
            action(revertArmed ? "Sure?" : "Revert", Act::Revert, revertArmed ? kDangerChip : kChip,
                   62.0, f.dirty || revertArmed);
            action("Save", Act::Save, kGoChip, 56.0, f.dirty);
        }
        if (!f.binary && assets::extensionOf(f.path) == "js" && web::bootScriptsSupported()) {
            action("Set as boot", Act::SetBoot, kChip, 92.0);
        }
        if (f.svg) action(f.preview ? "Hide preview" : "Preview", Act::Preview, kChip, 100.0);

        TextStyle name = label(16.0);
        name.roundJoin = true;
        double x = toolbar.x;
        const std::string title = ellipsize(assets::baseName(f.path), 16.0,
                                            std::max(40.0, (bx - x) * 0.6));
        text(canvas, title, x, cy, name);
        x += measure(title, 16.0) + 10.0;
        if (f.dirty) x += badge(canvas, "MODIFIED", x, cy, kDirtyInk) + 6.0;
        if (f.binary) x += badge(canvas, "BINARY", x, cy, kNumberInk) + 6.0;
        if (bx - x > 30.0) {
            text(canvas, ellipsizeFront(assets::parentPath(f.path), 12.0, bx - x - 8.0), x, cy,
                 label(12.0, kMutedInk));
        }
    }

    // -- the editor ----------------------------------------------------------

    fillRound(canvas, layout.box, 6.0, kEditorFill);
    {
        canvas.save();
        clipCanvas(canvas, layout.box);
        setFill(canvas, kGutterFill);
        canvas.fillRect(static_cast<float>(layout.gutter.x), static_cast<float>(layout.gutter.y),
                        static_cast<float>(layout.gutter.w), static_cast<float>(layout.gutter.h));
        // The file's own words are not the page's: a drag here moves the
        // caret, and must not also start the page selection.
        TextCaptureScope capture(false);
        canvas.save();
        clipCanvas(canvas, Rect{layout.gutter.x, layout.view.y, layout.gutter.w, layout.view.h});
        drawGutter(canvas, f, layout);
        canvas.restore();
        canvas.save();
        clipCanvas(canvas, Rect{layout.view.x - 4.0, layout.view.y, layout.view.w + 4.0, layout.view.h});
        if (f.binary) drawHex(canvas, f, layout);
        else drawText(canvas, f, layout, now);
        canvas.restore();
        canvas.restore();
    }
    if (thumb.shown) {
        // Measured again: the keyboard and the wheel have moved it since.
        const Thumb moved = thumbOf(f, layout);
        setFill(canvas, kPaper, 0.06);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(layout.bar.x), static_cast<float>(layout.bar.y),
                         static_cast<float>(layout.bar.w), static_cast<float>(layout.bar.h), 5.0f);
        canvas.fill();
        const bool lit = s.barDragging || insideInclusive(moved.rect, mouse);
        setFill(canvas, kPaper, lit ? 0.5 : 0.28);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(moved.rect.x), static_cast<float>(moved.rect.y),
                         static_cast<float>(moved.rect.w), static_cast<float>(moved.rect.h), 5.0f);
        canvas.fill();
    }
    if (layout.preview.w > 0) drawPreview(canvas, f, layout.preview, now);
}

void bootTab(MenuContext& ctx, State& s, std::vector<Hit>& regions, Rect body) {
    Canvas& canvas = ctx.canvas;
    const Vec2 mouse = ctx.mouse();
    const auto addRegion = [&](Rect r, Act act, int index = -1) {
        if (r.w > 0 && r.h > 0) regions.push_back({r, act, index});
    };

    fillRound(canvas, body, 6.0, kInk, 0.18);
    const double x = body.x + 18.0;
    double y = body.y + 22.0;
    const auto line = [&](const std::string& words, std::uint32_t ink = kMutedInk,
                          double size = 13.0) {
        text(canvas, words, x, y, label(size, ink));
        y += size + 8.0;
    };
    line("What runs when this page loads. A boot script runs INSTEAD of the game, before the "
         "game is downloaded;", kPaper, 14.0);
    line("the tools below set themselves up first and then start the game, or never start it "
         "at all.", kPaper, 14.0);
    y += 6.0;

    if (!web::bootScriptsSupported()) {
        line(web::bootUnavailableReason() + ".");
        line("The browser build has a Boot tab; this one can still browse and edit files.");
        return;
    }
    const std::string reason = web::bootUnavailableReason();
    if (!reason.empty()) line("A choice cannot be kept: " + reason + ".", kBadInk);

    line("This page load: " + (s.bootedFrom.empty() ? std::string("the game, started directly")
                                                     : s.bootedFrom),
         kMutedInk);
    line("Next page load: " + (s.choice.empty() ? std::string("the game")
                                                : (s.choice.path.empty() ? std::string("a script")
                                                                         : s.choice.path)),
         kOkInk);
    y += 4.0;

    // The options: the game, every embedded tool, and a script set from the
    // Files tab when that is what is chosen.
    struct Option {
        std::string title;
        std::string summary;
        bool chosen = false;
        bool stale = false;
        Act use = Act::None;
        Act open = Act::None;
        int index = -1;
    };
    std::vector<Option> options;
    options.push_back({"The game", "Loads and starts the game, as a normal page load does.",
                       s.choice.empty(), false, Act::UseGame, Act::None, -1});
    bool choiceListed = s.choice.empty();
    for (std::size_t i = 0; i < s.tools.size(); ++i) {
        const Tool& tool = s.tools[i];
        Option option;
        option.title = tool.name;
        option.summary = tool.summary.empty() ? tool.path : tool.summary;
        option.chosen = !s.choice.empty() && s.choice.path == tool.path;
        option.stale = option.chosen && s.choice.source != tool.source;
        option.use = Act::UseTool;
        option.open = Act::OpenTool;
        option.index = static_cast<int>(i);
        choiceListed = choiceListed || option.chosen;
        options.push_back(option);
    }
    if (!choiceListed) {
        options.push_back({s.choice.path.empty() ? "A script" : s.choice.path,
                           "Set from the Files tab.", true, false, Act::None,
                           assets::exists(s.choice.path) ? Act::OpenChoice : Act::None, -1});
    }

    const double bottomH = 64.0;
    const Rect listView{body.x + 10.0, y, body.w - 20.0, body.bottom() - bottomH - y};
    s.bootList.contentHeight = static_cast<double>(options.size()) * kBootRow + 4.0;
    s.bootList.viewHeight = listView.h;
    if (listView.contains(mouse)) s.bootList.offset -= ctx.wheel() * kListWheelStep;
    s.bootList.offset -= touchScroll(ctx.window, listView, s.bootList.maxOffset() > 0);
    s.bootList.offset = clamp(s.bootList.offset, 0.0, s.bootList.maxOffset());

    canvas.save();
    clipCanvas(canvas, listView);
    double rowY = listView.y - s.bootList.offset;
    for (const Option& option : options) {
        const Rect row{listView.x, rowY, listView.w - kScrollbarWidth - 4.0, kBootRow - 6.0};
        rowY += kBootRow;
        if (row.bottom() < listView.y || row.y > listView.bottom()) continue;
        fillRound(canvas, row, 6.0, kPaper, option.chosen ? 0.22 : 0.08);
        const double cy = row.y + row.h * 0.5;
        // The radio: filled for what the next load runs.
        setFill(canvas, kPaper, 0.85);
        canvas.beginPath();
        canvas.arc(static_cast<float>(row.x + 20.0), static_cast<float>(cy), 7.0f, 0.0f,
                   static_cast<float>(kTau));
        canvas.fill();
        if (option.chosen) {
            setFill(canvas, 0x2E7D32u);
            canvas.beginPath();
            canvas.arc(static_cast<float>(row.x + 20.0), static_cast<float>(cy), 4.0f, 0.0f,
                       static_cast<float>(kTau));
            canvas.fill();
        }

        double bx = row.right() - 10.0;
        const auto action = [&](const std::string& caption, Act act, const ChipStyle& style,
                                double w, int index) {
            const Rect r{bx - w, cy - kChipHeight * 0.5, w, kChipHeight};
            ChipStyle small = style;
            small.textSize = 12.0;
            chip(canvas, r, caption, r.contains(mouse), small);
            addRegion(clipTo(r, listView), act, index);
            bx -= w + 6.0;
        };
        if (option.open != Act::None) action("Open", option.open, kChip, 58.0, option.index);
        if (option.use != Act::None) {
            if (!option.chosen) action("Use", option.use, kGoChip, 52.0, option.index);
            else if (option.stale) action("Update", option.use, kGoChip, 66.0, option.index);
        }
        if (option.chosen) {
            bx -= badge(canvas, "NEXT LOAD", bx - measure("NEXT LOAD", 10.0) - 10.0, cy, kOkInk) + 6.0;
        }
        TextStyle title = label(15.0);
        title.roundJoin = true;
        const double textX = row.x + 38.0;
        text(canvas, ellipsize(option.title, 15.0, bx - textX - 8.0), textX, cy - 9.0, title);
        std::string summary = option.summary;
        if (option.stale) summary = "The copy kept for the next load is older than this file.";
        text(canvas, ellipsize(summary, 12.0, bx - textX - 8.0), textX, cy + 10.0,
             label(12.0, option.stale ? kDirtyInk : kMutedInk));
    }
    canvas.restore();
    scrollbar(canvas, Rect{listView.x, listView.y, listView.w, listView.h - 5.0},
              s.bootList.contentHeight, s.bootList.offset, kAssetsSkin.accent, 8.0);

    const double by = body.bottom() - bottomH * 0.5;
    const Rect reload{x, by - 14.0, 116.0, 28.0};
    ChipStyle reloadStyle = s.choiceChanged ? kGoChip : kChip;
    chip(canvas, reload, "Reload page", reload.contains(mouse), reloadStyle);
    addRegion(reload, Act::Reload);
    text(canvas, "If a boot script breaks the page, add ?boot=game to the address to skip it once,",
         reload.right() + 14.0, by - 8.0, label(12.0, kMutedInk));
    text(canvas, "or ?boot=reset to forget it.", reload.right() + 14.0, by + 9.0,
         label(12.0, kMutedInk));
}

} // namespace

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

double AssetsPanel::preferredWidth() { return kWidth; }
double AssetsPanel::preferredHeight() { return kHeight; }

void AssetsPanel::setPaths(const std::string& dataDir, const std::string& settings) {
    dataDirectory() = dataDir.empty() ? std::string("data") : dataDir;
    settingsFile() = settings;
}

void AssetsPanel::reset() {
    State& s = state();
    // What was open stays open, edits and all; only what cannot outlive the
    // card -- a caret, a drag, an armed button, a half-typed name -- goes.
    s.file.field.blur();
    s.newField.blur();
    s.naming = false;
    s.armed.clear();
    s.barDragging = false;
    if (!s.started) start(s);
    else relist(s);
    loadBoot(s);
}

bool AssetsPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    State& s = state();
    if (!s.started) {
        start(s);
        loadBoot(s);
    }
    if (!s.armed.empty() && now - s.armedAt > kArmSeconds) s.armed.clear();

    std::vector<Hit> regions;
    const auto addRegion = [&](Rect r, Act act, int index = -1) {
        if (r.w > 0 && r.h > 0) regions.push_back({r, act, index});
    };

    overlayCard(canvas, panel, kAssetsSkin);
    {
        TextStyle heading;
        heading.size = 22.0;
        heading.fill = kPaper;
        heading.baseline = Baseline::Top;
        heading.roundJoin = true;
        text(canvas, "Assets", panel.x + 16.0, panel.y + 12.0, heading);

        const double tabX = panel.x + 16.0 + measure("Assets", 22.0) + 22.0;
        const Rect filesTabRect{tabX, panel.y + 13.0, 72.0, 26.0};
        const Rect bootTabRect{filesTabRect.right() + 6.0, panel.y + 13.0, 72.0, 26.0};
        chip(canvas, filesTabRect, "Files", filesTabRect.contains(mouse),
             s.tab == Tab::Files ? kOnChip : kChip);
        chip(canvas, bootTabRect, "Boot", bootTabRect.contains(mouse),
             s.tab == Tab::Boot ? kOnChip : kChip);
        addRegion(filesTabRect, Act::TabFiles);
        addRegion(bootTabRect, Act::TabBoot);

        const Rect closeRect = closeButtonRect(panel);
        panelClose(canvas, closeRect, closeRect.contains(mouse));
        addRegion(closeRect, Act::Close);
        const Rect back{closeRect.x - 10.0 - 84.0, panel.y + 13.0, 84.0, 26.0};
        chip(canvas, back, "\xE2\x80\xB9 Debug", back.contains(mouse), kChip);
        addRegion(back, Act::Back);
    }

    const Rect body{panel.x + kPad, panel.y + kHeaderHeight, panel.w - kPad * 2,
                    panel.h - kHeaderHeight - kFooterHeight};
    if (s.tab == Tab::Files) filesTab(ctx, s, regions, body);
    else bootTab(ctx, s, regions, body);

    // -- the footer ----------------------------------------------------------

    {
        const double fy = panel.bottom() - kFooterHeight * 0.5 - 2.0;
        std::string where;
        if (s.tab == Tab::Files && s.file.open) {
            const OpenFile& f = s.file;
            if (f.binary) {
                where = assets::formatSize(f.text.size());
            } else {
                const std::size_t caret = std::min(f.field.selection.caret, f.text.size());
                const std::size_t line = assets::lineOf(f.lines, caret);
                std::size_t column = 1;
                for (std::size_t i = f.lines[line]; i < caret; i = utf8Next(f.text, i)) ++column;
                where = "Ln " + std::to_string(line + 1) + ", Col " + std::to_string(column) +
                        "   " + assets::formatSize(f.text.size()) +
                        (f.field.focused ? "   Ctrl+S saves, Ctrl+Z undoes, Esc leaves" : "");
            }
        }
        const double whereW = measure(where, 12.0);
        if (!where.empty()) {
            text(canvas, where, panel.right() - kPad, fy, label(12.0, kMutedInk, Align::Right));
        }
        std::string message;
        std::uint32_t ink = kMutedInk;
        if (now - s.statusAt < kStatusSeconds && !s.status.empty()) {
            message = s.status;
            ink = s.statusOk ? kOkInk : kBadInk;
        } else if (s.tab == Tab::Files && s.file.open) {
            message = locationNote(s.file.path);
        }
        if (!message.empty()) {
            text(canvas, ellipsize(message, 13.0, panel.w - kPad * 3 - whereW), panel.x + kPad, fy,
                 label(13.0, ink));
        }
    }

    // -- the new file's name -------------------------------------------------

    if (s.naming && s.newField.focused) {
        ctx.wantsText = true;
        TextEditOptions typing;
        typing.maxBytes = 120;
        editText(ctx.window, s.newName, s.newField, now, typing);
        if (ctx.window.keyPressed(Key::Escape)) {
            s.naming = false;
            s.newField.blur();
        }
    }
    const bool createNow = s.naming && s.newField.focused && ctx.window.keyPressed(Key::Enter);

    // -- clicks --------------------------------------------------------------

    Act act = Act::None;
    int index = -1;
    if (createNow) act = Act::CreateFile;
    if (act == Act::None && ctx.released()) {
        for (auto it = regions.rbegin(); it != regions.rend(); ++it) {
            if (!it->rect.contains(mouse)) continue;
            act = it->act;
            index = it->index;
            break;
        }
    }

    OpenFile& f = s.file;
    switch (act) {
        case Act::None:
            break;
        case Act::Close:
            return false;
        case Act::Back:
            ctx.openMenu = MenuId::Debug;
            break;
        case Act::TabFiles:
            s.tab = Tab::Files;
            break;
        case Act::TabBoot:
            s.tab = Tab::Boot;
            f.field.blur();
            loadBoot(s);
            break;
        case Act::Place: {
            const std::vector<Place> spots = places();
            if (index >= 0 && index < static_cast<int>(spots.size())) {
                s.place = index;
                enterDirectory(s, spots[static_cast<std::size_t>(index)].path);
            }
            break;
        }
        case Act::Up:
            enterDirectory(s, assets::parentPath(s.dir));
            break;
        case Act::Refresh:
            relist(s);
            loadBoot(s);
            break;
        case Act::Entry:
            if (index >= 0 && index < static_cast<int>(s.entries.size())) {
                const assets::Entry& entry = s.entries[static_cast<std::size_t>(index)];
                const std::string path = assets::joinPath(s.dir, entry.name);
                if (entry.directory) {
                    enterDirectory(s, path);
                } else if (f.open && f.dirty && path != f.path &&
                           !confirmArmed(s, "open:" + path, now)) {
                    setStatus(s, assets::baseName(f.path) +
                                     " has changes that are not saved. Click again to drop them.",
                              false, now);
                } else if (!f.open || path != f.path) {
                    openFile(s, path, now);
                }
            }
            break;
        case Act::NewFile:
            if (inStorage(s.dir)) {
                setStatus(s, "Browser storage keeps the client's own files only; a new one there "
                             "would not survive a reload.",
                          false, now);
                break;
            }
            s.naming = true;
            s.newName.clear();
            s.newField.focusAtEnd(s.newName, now);
            s.list.offset = 0;
            break;
        case Act::CancelNew:
            s.naming = false;
            s.newField.blur();
            break;
        case Act::CreateFile: {
            if (!assets::validFileName(s.newName)) {
                setStatus(s, "Give the file a name, without a slash in it.", false, now);
                break;
            }
            const std::string path = assets::joinPath(s.dir, s.newName);
            std::string error;
            if (!assets::createFile(path, error)) {
                setStatus(s, "Could not make " + s.newName + ": " + error, false, now);
                break;
            }
            s.naming = false;
            s.newField.blur();
            relist(s);
            openFile(s, path, now);
            f.field.focusAtEnd(f.text, now);
            setStatus(s, "Made " + path + ".", true, now);
            break;
        }
        case Act::Save:
            if (f.open) saveFile(ctx, s);
            break;
        case Act::Revert:
            if (f.open && confirmArmed(s, "revert", now)) {
                const std::string path = f.path;
                openFile(s, path, now);
                setStatus(s, "Reverted to what " + assets::baseName(path) + " holds.", true, now);
            }
            break;
        case Act::CloseFile:
            if (!f.dirty || confirmArmed(s, "close", now)) {
                f = OpenFile{};
                s.armed.clear();
            }
            break;
        case Act::Delete:
            if (f.open && confirmArmed(s, "delete", now)) {
                std::string error;
                const std::string path = f.path;
                if (assets::removeFile(path, error)) {
                    f = OpenFile{};
                    relist(s);
                    setStatus(s, "Deleted " + path + ".", true, now);
                } else {
                    setStatus(s, "Could not delete " + assets::baseName(path) + ": " + error, false,
                              now);
                }
            }
            break;
        case Act::SetBoot:
            // The buffer as it stands, saved or not: what is on screen is what
            // the next load should run.
            if (f.open) useBootScript(s, f.path, f.text, now);
            break;
        case Act::Preview:
            f.preview = !f.preview;
            if (f.preview) f.previewDue = now;
            break;
        case Act::UseGame:
            useGame(s, now);
            break;
        case Act::UseTool:
            if (index >= 0 && index < static_cast<int>(s.tools.size())) {
                const Tool& tool = s.tools[static_cast<std::size_t>(index)];
                useBootScript(s, tool.path, tool.source, now);
            }
            break;
        case Act::OpenTool:
            if (index >= 0 && index < static_cast<int>(s.tools.size())) {
                showFile(s, s.tools[static_cast<std::size_t>(index)].path, now);
            }
            break;
        case Act::OpenChoice:
            showFile(s, s.choice.path, now);
            break;
        case Act::Reload:
            web::reloadPage();
            break;
    }
    return true;
}

} // namespace flix
