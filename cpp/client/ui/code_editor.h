#pragma once
// A text editor for a page of code: line numbers, colour, a caret and
// selection that scroll both ways, undo, and the clipboard.
//
// It was the asset browser's, and is shared with the database editor's text
// view. One copy for the reason text_input.h is one copy: two editors would
// soon disagree about what a click on a tab or a drag past the bottom does.
//
// It owns only the buffer and its view. What a buffer IS -- a file on disk, a
// record on the server -- and what saving it means are the panel's: update()
// reports that the text changed or that Ctrl+S was pressed, and the panel acts.
//
// It can also show bytes that are not text as a hex dump, read-only, so the
// asset browser's binary files scroll the same way its text does.

#include <cstddef>
#include <string>
#include <vector>

#include "canvas.h"

#include "client/ui/asset_files.h"
#include "client/ui/text_input.h"
#include "shared/core/types.h"

namespace flix {
struct MenuContext;
}

namespace flix::ui {

class CodeEditor {
public:
    struct Layout {
        Rect box;     ///< the editor's plate
        Rect gutter;  ///< line numbers, or a hex dump's offsets
        Rect view;    ///< where lines are drawn and where a press places the caret
        Rect bar;     ///< the vertical scrollbar's track
    };

    /// What one frame of input did.
    struct Input {
        /// The text changed: typing, a paste, an undo.
        bool changed = false;
        /// Ctrl/Cmd+S, which is the panel's to act on.
        bool saveRequested = false;
    };

    /// Starts over on `text`, as what was saved: no undo, nothing selected,
    /// scrolled to the top. `hex` shows it as a dump instead, and read-only.
    void load(std::string text, assets::Syntax syntax, bool hex = false);
    /// The same, but the view stays where it is and so does the caret, as far
    /// as the new text reaches: for a buffer replaced by what it was saved as.
    void reload(std::string text);
    /// What the buffer holds now is what was saved.
    void markSaved() { saved_ = text_; }

    const std::string& text() const { return text_; }
    bool hex() const { return hex_; }
    bool dirty() const { return text_ != saved_; }
    bool focused() const { return field_.focused; }
    void focusAtEnd(double timeSeconds) { field_.focusAtEnd(text_, timeSeconds); }
    void focusAtStart(double timeSeconds);
    /// Lets go of the caret and of a scrollbar drag -- what a panel closing does.
    void blur();

    /// The caret's line and column, both from 1, for a status line.
    std::size_t caretLine() const;
    std::size_t caretColumn() const;

    Layout layout(Rect box) const;

    /// The pointer, the wheel and, while the editor has the caret, the keys.
    /// A press outside `keepFocus` takes the caret away. Run before draw(), so
    /// a press lands where the frame it was aimed at drew the text.
    Input update(MenuContext&, const Layout&, Rect keepFocus);

    void draw(Canvas&, const Layout&, Vec2 mouse, double timeSeconds) const;

private:
    std::size_t rowCount() const;
    std::size_t lineEnd(std::size_t line) const;
    std::size_t visibleStart(std::size_t line) const;
    double maxScrollY(const Layout&) const;
    void clampScroll(const Layout&);
    std::size_t offsetAt(const Layout&, Vec2 point) const;
    double xOf(const Layout&, std::size_t line, std::size_t offset) const;
    void followCaret(const Layout&);
    void replaceSelection(const std::string& with);
    void carryIndent();
    void reindex();

    struct Thumb {
        bool shown = false;
        Rect rect;
        double travel = 0;
    };
    Thumb thumbOf(const Layout&) const;

    void drawText(Canvas&, const Layout&, double timeSeconds) const;
    void drawGutter(Canvas&, const Layout&) const;
    void drawHex(Canvas&, const Layout&) const;

    /// The buffer, and what it held when it was loaded or last saved.
    std::string text_;
    std::string saved_;
    bool hex_ = false;
    assets::Syntax syntax_ = assets::Syntax::Plain;
    /// What a Tab key types: the text's own first indent.
    std::string indent_ = "    ";
    std::vector<std::size_t> lines_;
    /// The longest line, in bytes, which is how far the view may scroll right.
    std::size_t longest_ = 0;
    TextFieldState field_;
    assets::EditHistory history_;
    double scrollY_ = 0;
    /// The horizontal scroll, in BYTES into every line. A proportional face
    /// has no columns, but scrolling by pixels would mean measuring each long
    /// line from its start every frame -- a map's tile layer is a single line
    /// of tens of kilobytes. Moving every line's start along by the same count
    /// of bytes keeps the cost to what is on screen.
    std::size_t scrollCol_ = 0;
    /// Set by a keyboard edit or move, so the frame brings the caret into view.
    bool follow_ = false;
    bool barDragging_ = false;
    double barGrab_ = 0;
};

} // namespace flix::ui
