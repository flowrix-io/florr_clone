#pragma once
// Dragging a list with a finger.
//
// Every list in this client scrolls on the wheel, and a finger has no wheel.
// The browser build never had to care: its lists were DOM elements with
// `overflow: auto`, and the page scrolled them. Painted on a canvas, nothing
// does -- so on a phone not one list in the game moved.
//
// The window does the hard half (see touch_gesture.h): it holds the press of
// a finger that lands on a list until it can tell a scroll from a tap, and
// reports the scroll as a pan. What is left here is the list's half: saying
// where it is, and taking the pan when the finger grabbed it.

#include <vector>

#include "window.h"

#include "shared/core/types.h"

namespace flix::ui {

/// Where this frame's scrollable lists are. Filled as they lay themselves out
/// and handed to the window at the end of the frame, the same one-frame
/// contract as TextFieldRegions.
class TouchScrollRegions {
public:
    static TouchScrollRegions& instance();

    /// Drops last frame's set. Called once, at the top of the frame.
    void beginFrame() { boxes_.clear(); }
    void record(Rect box) { boxes_.push_back(box); }
    const std::vector<Rect>& boxes() const { return boxes_; }

private:
    std::vector<Rect> boxes_;
};

/// How far a finger dragged the list in `view` this frame, in design units,
/// positive when it moved DOWN. Content follows the finger, so an offset that
/// grows toward the end of the list takes `offset -= touchScroll(...)`. Zero
/// unless the drag began inside `view`.
///
/// Also records `view` for the window when `scrollable`, which is what makes a
/// finger landing there hold its press until it knows whether it is a scroll.
/// Call it every frame the list is on screen, with the rect its content is
/// clipped to -- minus a scrollbar that can be grabbed, since a finger that
/// drags a thumb down means the opposite of one that drags the content down.
double touchScroll(const Window&, Rect view, bool scrollable);

} // namespace flix::ui
