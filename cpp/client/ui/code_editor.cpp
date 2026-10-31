#include "client/ui/code_editor.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_select.h"
#include "client/ui/touch_scroll.h"

namespace flix::ui {

namespace {

constexpr double kCodeSize = 13.0;
constexpr double kLineHeight = 18.0;
constexpr double kScrollbarWidth = 10.0;
constexpr double kWheelLines = 3.0;
constexpr std::size_t kWheelColumns = 12;
/// How far the editor lets a buffer grow.
constexpr std::size_t kEditLimit = 16u << 20;
/// A tab is drawn this many spaces wide.
constexpr int kTabSpaces = 4;
/// Runs of text longer than this are drawn in pieces, each placed where the
/// editor's own arithmetic says it starts. The page's text engine kerns and
/// the layout here does not, and over a long run the two drift apart until a
/// caret sits beside the letter it is in front of.
constexpr std::size_t kRunChunk = 24;

constexpr std::uint32_t kEditorFill = 0x1B1F23u;
constexpr std::uint32_t kGutterFill = 0x22272Cu;
constexpr std::uint32_t kGutterInk = 0x6E7A84u;
constexpr std::uint32_t kCurrentLineFill = 0x2A3138u;
constexpr std::uint32_t kSelectionFill = 0x355F8Fu;

constexpr std::uint32_t kTextInk = 0xE6E6E6u;
constexpr std::uint32_t kStringInk = 0xFFE9A8u;
constexpr std::uint32_t kNumberInk = 0xA8E6FFu;
constexpr std::uint32_t kKeywordInk = 0xD9BFFFu;
constexpr std::uint32_t kCommentInk = 0x8FA88Fu;
constexpr std::uint32_t kPunctuationInk = 0xA9B1B8u;
constexpr std::uint32_t kTagInk = 0x7FC8FFu;
constexpr std::uint32_t kAttributeInk = 0xB9F6A6u;

TextStyle codeStyle(std::uint32_t fill, Align align = Align::Left) {
    TextStyle style;
    style.size = kCodeSize;
    style.fill = fill;
    style.strokeWidth = 0;
    style.align = align;
    style.baseline = Baseline::Middle;
    return style;
}

void clipCanvas(Canvas& canvas, Rect r) {
    canvas.beginPath();
    canvas.rect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                static_cast<float>(r.h));
    canvas.clip();
}

bool isLead(char byte) { return (static_cast<unsigned char>(byte) & 0xC0) != 0x80; }

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
    const TextStyle style = codeStyle(ink);
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

/// The first indented line's indent, as what Tab types: a tab if the text
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

} // namespace

// --- the buffer -------------------------------------------------------------

void CodeEditor::load(std::string text, assets::Syntax syntax, bool hex) {
    *this = CodeEditor{};
    hex_ = hex;
    syntax_ = syntax;
    text_ = std::move(text);
    saved_ = text_;
    indent_ = indentOf(text_);
    reindex();
    history_.reset(text_);
}

void CodeEditor::reload(std::string text) {
    text_ = std::move(text);
    saved_ = text_;
    indent_ = indentOf(text_);
    reindex();
    history_.reset(text_);
    // Left at a byte offset that may now be inside a character; editText
    // walks a caret like that back to the boundary before it moves it.
    field_.selection.collapse(std::min(field_.selection.caret, text_.size()));
}

void CodeEditor::focusAtStart(double timeSeconds) {
    field_.focusAtEnd(text_, timeSeconds);
    field_.selection.collapse(0);
    follow_ = true;
}

void CodeEditor::blur() {
    field_.blur();
    barDragging_ = false;
}

std::size_t CodeEditor::caretLine() const {
    const std::size_t caret = std::min(field_.selection.caret, text_.size());
    return assets::lineOf(lines_, caret) + 1;
}

std::size_t CodeEditor::caretColumn() const {
    const std::size_t caret = std::min(field_.selection.caret, text_.size());
    std::size_t column = 1;
    for (std::size_t i = lines_[caretLine() - 1]; i < caret; i = utf8Next(text_, i)) ++column;
    return column;
}

void CodeEditor::reindex() {
    lines_ = assets::lineStarts(text_);
    longest_ = 0;
    for (std::size_t i = 0; i < lines_.size(); ++i) {
        const std::size_t end = i + 1 < lines_.size() ? lines_[i + 1] - 1 : text_.size();
        longest_ = std::max(longest_, end - lines_[i]);
    }
}

std::size_t CodeEditor::rowCount() const {
    return hex_ ? (text_.size() + 15) / 16 : lines_.size();
}

/// Where line `line` ends, its newline left out.
std::size_t CodeEditor::lineEnd(std::size_t line) const {
    return line + 1 < lines_.size() ? lines_[line + 1] - 1 : text_.size();
}

/// Where the shown part of line `line` begins: the horizontal scroll's count
/// of bytes in, on a character boundary, and never past the line's end.
std::size_t CodeEditor::visibleStart(std::size_t line) const {
    const std::size_t stop = lineEnd(line);
    std::size_t at = std::min(lines_[line] + scrollCol_, stop);
    while (at < stop && !isLead(text_[at])) ++at;
    return at;
}

void CodeEditor::replaceSelection(const std::string& with) {
    TextSelection& selection = field_.selection;
    const std::size_t begin = std::min(selection.begin(), text_.size());
    const std::size_t end = std::min(selection.end(), text_.size());
    if (text_.size() - (end - begin) + with.size() > kEditLimit) return;
    text_.replace(begin, end - begin, with);
    selection.collapse(begin + with.size());
}

/// After Enter: the new line starts with the indent of the one it broke from.
void CodeEditor::carryIndent() {
    const std::size_t caret = field_.selection.caret;
    if (caret == 0 || caret > text_.size() || text_[caret - 1] != '\n') return;
    std::size_t start = caret - 1;
    while (start > 0 && text_[start - 1] != '\n') --start;
    std::size_t end = start;
    while (end < caret - 1 && (text_[end] == ' ' || text_[end] == '\t')) ++end;
    if (end == start || text_.size() + (end - start) > kEditLimit) return;
    const std::string indent = text_.substr(start, end - start);
    text_.insert(caret, indent);
    field_.selection.collapse(caret + indent.size());
}

// --- the view's arithmetic --------------------------------------------------

CodeEditor::Layout CodeEditor::layout(Rect box) const {
    Layout out;
    out.box = box;
    double gutterW = 0;
    if (hex_) {
        gutterW = widthOf("00000000", 0, 8) + 16.0;
    } else {
        int digits = 3;
        for (std::size_t n = lines_.size(); n >= 1000; n /= 10) ++digits;
        gutterW = digits * asciiAdvance('0') + 18.0;
    }
    out.gutter = Rect{box.x, box.y, gutterW, box.h};
    out.bar = Rect{box.right() - kScrollbarWidth - 4.0, box.y + 4.0, kScrollbarWidth, box.h - 8.0};
    const double viewX = box.x + gutterW + 6.0;
    out.view = Rect{viewX, box.y + 4.0, std::max(10.0, out.bar.x - 4.0 - viewX), box.h - 8.0};
    return out;
}

double CodeEditor::maxScrollY(const Layout& layout) const {
    return std::max(0.0, static_cast<double>(rowCount()) * kLineHeight + kLineHeight * 0.5 -
                             layout.view.h);
}

void CodeEditor::clampScroll(const Layout& layout) {
    scrollY_ = clamp(scrollY_, 0.0, maxScrollY(layout));
    if (scrollCol_ > longest_) scrollCol_ = longest_;
}

CodeEditor::Thumb CodeEditor::thumbOf(const Layout& layout) const {
    const double content = static_cast<double>(rowCount()) * kLineHeight + kLineHeight * 0.5;
    if (content <= layout.view.h || layout.bar.h <= 0) return {};
    const double height = std::max(28.0, layout.bar.h * (layout.view.h / content));
    const double top = maxScrollY(layout);
    const double y = layout.bar.y + (top > 0 ? scrollY_ / top : 0.0) * (layout.bar.h - height);
    return {true, Rect{layout.bar.x, y, layout.bar.w, height}, layout.bar.h - height};
}

/// The byte offset a point lands on: the line under it, and the character
/// boundary nearest it on that line.
std::size_t CodeEditor::offsetAt(const Layout& layout, Vec2 point) const {
    if (lines_.empty()) return 0;
    const double row = std::floor((point.y - layout.view.y + scrollY_) / kLineHeight);
    const std::size_t line =
        row < 0 ? 0 : std::min(static_cast<std::size_t>(row), lines_.size() - 1);
    const std::size_t stop = lineEnd(line);
    std::size_t at = visibleStart(line);
    double x = layout.view.x;
    while (at < stop) {
        std::size_t next = at;
        const double width = advanceAt(text_, at, next);
        if (point.x < x + width * 0.5) return at;
        x += width;
        at = next;
    }
    return stop;
}

/// Where `offset` on line `line` is drawn. An offset scrolled off to the left
/// is just left of the view, which is where a highlight that starts there is
/// cut off.
double CodeEditor::xOf(const Layout& layout, std::size_t line, std::size_t offset) const {
    const std::size_t from = visibleStart(line);
    if (offset < from) return layout.view.x - 1.0;
    return layout.view.x + widthOf(text_, from, offset, layout.view.w + 20.0);
}

/// Scrolls so the caret is on screen, with some room around it.
void CodeEditor::followCaret(const Layout& layout) {
    const std::size_t caret = std::min(field_.selection.caret, text_.size());
    const std::size_t line = assets::lineOf(lines_, caret);
    const double top = static_cast<double>(line) * kLineHeight;
    if (top < scrollY_) scrollY_ = top;
    if (top + kLineHeight > scrollY_ + layout.view.h) scrollY_ = top + kLineHeight - layout.view.h;

    const std::size_t start = lines_[line];
    const std::size_t column = caret - start;
    const double span = layout.view.w - 16.0;
    if (column < scrollCol_) {
        scrollCol_ = column > 8 ? column - 8 : 0;
    } else if (widthOf(text_, visibleStart(line), caret, span + 1.0) > span) {
        // Back from the caret until three quarters of the view is behind it.
        double behind = 0;
        std::size_t at = caret;
        while (at > start) {
            const std::size_t prev = utf8Prev(text_, at);
            std::size_t next = prev;
            behind += advanceAt(text_, prev, next);
            if (behind > span * 0.75) break;
            at = prev;
        }
        scrollCol_ = at - start;
    }
    clampScroll(layout);
}

// --- input ------------------------------------------------------------------

CodeEditor::Input CodeEditor::update(MenuContext& ctx, const Layout& layout, Rect keepFocus) {
    Window& window = ctx.window;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    Input result;

    const Thumb thumb = thumbOf(layout);
    if (barDragging_) {
        if (window.mouseDown(MouseButton::Left) && thumb.shown && thumb.travel > 0) {
            scrollY_ = (mouse.y - barGrab_ - layout.bar.y) / thumb.travel * maxScrollY(layout);
        } else {
            barDragging_ = false;
        }
    }
    const bool pressOnBar = ctx.pressed() && thumb.shown && insideInclusive(layout.bar, mouse);
    if (pressOnBar) {
        barGrab_ = thumb.rect.contains(mouse) ? mouse.y - thumb.rect.y : thumb.rect.h * 0.5;
        barDragging_ = true;
        if (thumb.travel > 0) {
            scrollY_ = (mouse.y - barGrab_ - layout.bar.y) / thumb.travel * maxScrollY(layout);
        }
    }
    if (!hex_ && !pressOnBar && !barDragging_) {
        trackTextMouseWith(
            window, field_, layout.view, text_, now,
            [&](Vec2 point) { return offsetAt(layout, point); }, false);
        if (insideInclusive(layout.view, mouse)) window.setCursorShape(CursorShape::Text);
        // A drag past the top or bottom edge keeps the view moving that way.
        if (field_.dragging) {
            if (mouse.y < layout.view.y) scrollY_ -= (layout.view.y - mouse.y) * ctx.dt * 12.0;
            if (mouse.y > layout.view.bottom()) {
                scrollY_ += (mouse.y - layout.view.bottom()) * ctx.dt * 12.0;
            }
        }
    }
    if (ctx.pressed() && !keepFocus.contains(mouse)) field_.blur();

    if (insideInclusive(layout.box, mouse)) {
        const float wheel = ctx.wheel();
        if (wheel != 0 && window.shiftHeld()) {
            const double step = static_cast<double>(wheel) * static_cast<double>(kWheelColumns);
            const double col = static_cast<double>(scrollCol_) - step;
            scrollCol_ = col <= 0 ? 0 : static_cast<std::size_t>(col);
        } else if (wheel != 0) {
            scrollY_ -= static_cast<double>(wheel) * kWheelLines * kLineHeight;
        }
    }
    scrollY_ -= touchScroll(window, layout.view, maxScrollY(layout) > 0);

    // The keyboard, while the editor has the caret.
    if (!hex_ && field_.focused) {
        ctx.wantsText = true;
        window.setClaimedShortcuts({Key::S, Key::Z, Key::Y});
        const bool ctrl = window.ctrlHeld();
        const TextSelection before = field_.selection;
        bool changed = false;
        bool rewound = false;
        if (ctrl && window.keyPressed(Key::S)) {
            result.saveRequested = true;
        } else if (ctrl && (window.keyPressed(Key::Y) ||
                            (window.keyPressed(Key::Z) && window.shiftHeld()))) {
            rewound = history_.redo(text_, field_.selection);
        } else if (ctrl && window.keyPressed(Key::Z)) {
            rewound = history_.undo(text_, field_.selection);
        } else {
            if (!ctrl && window.keyTyped(Key::Tab)) {
                replaceSelection(indent_);
                changed = true;
            }
            TextEditOptions typing;
            typing.multiline = true;
            typing.maxBytes = kEditLimit;
            const bool enter = window.keyPressed(Key::Enter);
            if (editText(window, text_, field_, now, typing)) {
                changed = true;
                if (enter) carryIndent();
            }
            // Ctrl+Home and Ctrl+End reach the ends of the text; the line's
            // ends are editText's.
            if (ctrl && window.keyTyped(Key::Home)) {
                field_.selection.caret = 0;
                if (!window.shiftHeld()) field_.selection.anchor = 0;
            }
            if (ctrl && window.keyTyped(Key::End)) {
                field_.selection.caret = text_.size();
                if (!window.shiftHeld()) field_.selection.anchor = text_.size();
            }
        }
        if (changed || rewound) {
            reindex();
            if (changed) history_.record(text_, before, field_.selection, now);
            field_.caretSeconds = now;
            result.changed = true;
        }
        if (changed || rewound || field_.selection.caret != before.caret ||
            field_.selection.anchor != before.anchor) {
            follow_ = true;
        }
        if (window.keyPressed(Key::Escape)) field_.blur();
    }
    clampScroll(layout);
    if (follow_) {
        followCaret(layout);
        follow_ = false;
    }
    return result;
}

// --- drawing ----------------------------------------------------------------

void CodeEditor::drawText(Canvas& canvas, const Layout& layout, double now) const {
    const std::size_t rows = rowCount();
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(scrollY_ / kLineHeight)));
    const std::size_t shown = static_cast<std::size_t>(layout.view.h / kLineHeight) + 2;
    const std::size_t last = std::min(rows, first + shown);
    const TextSelection& selection = field_.selection;
    const std::size_t caret = std::min(selection.caret, text_.size());
    const std::size_t caretLine = assets::lineOf(lines_, caret);
    const double right = layout.view.right();

    for (std::size_t line = first; line < last; ++line) {
        const double top = layout.view.y + static_cast<double>(line) * kLineHeight - scrollY_;
        const double cy = top + kLineHeight * 0.5;
        const std::size_t start = lines_[line];
        const std::size_t stop = lineEnd(line);
        const std::size_t from = visibleStart(line);

        if (line == caretLine && field_.focused) {
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
            const double x0 = std::max(layout.view.x - 4.0, xOf(layout, line, a));
            double x1 = std::min(right, xOf(layout, line, b));
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
            x += advanceAt(text_, to, next);
            to = next;
        }
        if (to > from) {
            const std::string visible = text_.substr(from, to - from);
            double x = layout.view.x;
            for (const assets::Span& span : assets::highlightLine(visible, syntax_)) {
                drawRun(canvas, visible, span.begin, span.end, x, cy, tokenInk(span.token));
                x += widthOf(visible, span.begin, span.end);
            }
        }
    }

    if (field_.focused && caretVisible(field_, now) && caretLine >= first && caretLine < last) {
        const double x = xOf(layout, caretLine, caret);
        if (x >= layout.view.x - 1.0 && x <= right) {
            const double top = layout.view.y + static_cast<double>(caretLine) * kLineHeight - scrollY_;
            setFill(canvas, kPaper);
            canvas.fillRect(static_cast<float>(x), static_cast<float>(top + 2.0), 1.5f,
                            static_cast<float>(kLineHeight - 4.0));
        }
    }
}

void CodeEditor::drawGutter(Canvas& canvas, const Layout& layout) const {
    const std::size_t rows = rowCount();
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(scrollY_ / kLineHeight)));
    const std::size_t last = std::min(rows, first + static_cast<std::size_t>(layout.view.h / kLineHeight) + 2);
    const std::size_t caretLine =
        hex_ ? rows : assets::lineOf(lines_, std::min(field_.selection.caret, text_.size()));
    for (std::size_t row = first; row < last; ++row) {
        const double cy = layout.view.y + static_cast<double>(row) * kLineHeight - scrollY_ +
                          kLineHeight * 0.5;
        if (hex_) {
            ui::text(canvas, assets::hexRow(text_, row * 16).substr(0, 8), layout.gutter.x + 8.0, cy,
                 codeStyle(kGutterInk));
        } else {
            ui::text(canvas, std::to_string(row + 1), layout.gutter.right() - 8.0, cy,
                 codeStyle(row == caretLine && field_.focused ? kPaper : kGutterInk,
                           Align::Right));
        }
    }
}

void CodeEditor::drawHex(Canvas& canvas, const Layout& layout) const {
    const std::size_t rows = rowCount();
    const std::size_t first = static_cast<std::size_t>(std::max(0.0, std::floor(scrollY_ / kLineHeight)));
    const std::size_t last = std::min(rows, first + static_cast<std::size_t>(layout.view.h / kLineHeight) + 2);
    // Four groups of four bytes, each at a fixed place: the face is not a
    // monospace one, and the columns would wander from row to row otherwise.
    double group = 0;
    for (const char* sample : {"00 00 00 00", "bb bb bb bb", "dd dd dd dd", "ee ee ee ee"}) {
        group = std::max(group, widthOf(sample, 0, 11));
    }
    group += 12.0;
    for (std::size_t row = first; row < last; ++row) {
        const double cy = layout.view.y + static_cast<double>(row) * kLineHeight - scrollY_ +
                          kLineHeight * 0.5;
        const std::string line = assets::hexRow(text_, row * 16);
        for (int g = 0; g < 4; ++g) {
            const std::size_t at = 10 + static_cast<std::size_t>(g) * 12 + (g >= 2 ? 1 : 0);
            if (at < line.size()) {
                ui::text(canvas, line.substr(at, 11), layout.view.x + g * group, cy,
                     codeStyle(g % 2 == 0 ? kTextInk : kNumberInk));
            }
        }
        if (line.size() > 60) {
            ui::text(canvas, line.substr(60), layout.view.x + 4 * group + 8.0, cy,
                 codeStyle(kStringInk));
        }
    }
}

void CodeEditor::draw(Canvas& canvas, const Layout& layout, Vec2 mouse, double now) const {
    fillRound(canvas, layout.box, 6.0, kEditorFill);
    {
        canvas.save();
        clipCanvas(canvas, layout.box);
        setFill(canvas, kGutterFill);
        canvas.fillRect(static_cast<float>(layout.gutter.x), static_cast<float>(layout.gutter.y),
                        static_cast<float>(layout.gutter.w), static_cast<float>(layout.gutter.h));
        // The buffer's own words are not the page's: a drag here moves the
        // caret, and must not also start the page selection.
        TextCaptureScope capture(false);
        canvas.save();
        clipCanvas(canvas, Rect{layout.gutter.x, layout.view.y, layout.gutter.w, layout.view.h});
        drawGutter(canvas, layout);
        canvas.restore();
        canvas.save();
        clipCanvas(canvas, Rect{layout.view.x - 4.0, layout.view.y, layout.view.w + 4.0, layout.view.h});
        if (hex_) drawHex(canvas, layout);
        else drawText(canvas, layout, now);
        canvas.restore();
        canvas.restore();
    }
    const Thumb thumb = thumbOf(layout);
    if (thumb.shown) {
        setFill(canvas, kPaper, 0.06);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(layout.bar.x), static_cast<float>(layout.bar.y),
                         static_cast<float>(layout.bar.w), static_cast<float>(layout.bar.h), 5.0f);
        canvas.fill();
        const bool lit = barDragging_ || insideInclusive(thumb.rect, mouse);
        setFill(canvas, kPaper, lit ? 0.5 : 0.28);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(thumb.rect.x), static_cast<float>(thumb.rect.y),
                         static_cast<float>(thumb.rect.w), static_cast<float>(thumb.rect.h), 5.0f);
        canvas.fill();
    }
}

} // namespace flix::ui
