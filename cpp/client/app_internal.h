#pragma once
// The few things App's own translation units share.
//
// App is one class across seven files -- the shell in app.cpp, the three
// screens, and the three in-game surfaces it draws over them (see the note at
// the top of app.cpp). Almost everything each of those needs is its own
// business and stays in its own anonymous namespace; this header is only what
// more than one of them asks for, which is the design space they all draw in
// and two questions about the world outside the class.
//
// It is short on purpose. A helper one file uses belongs in that file, and
// one that grows a second caller can move here then -- a shared header that
// collects everything is how seven files become one again.
//
// Nothing outside client/app*.cpp includes this.

#include <chrono>
#include <cstdint>

#include "window.h"

namespace flix {

/// The design space every draw call in this client is written in.
///
/// Not a window size: it is the fixed extent the frame is scaled to fill, so
/// a 900x600 window and a 3840x2160 one on a Retina panel both show exactly
/// this much of the world and this much HUD, at the same relative size. Only
/// the sharpness differs. A window that is not 16:9 shows LESS than this on
/// its short axis, never more -- the window's edge is not a zoom control. See
/// Window::setDesignSize for the machinery, and client/camera.h for why the
/// world's own zoom is left flat.
///
/// 1920 wide rather than the 1280 the window opens at, because it is the
/// resolution the browser build's layout numbers were authored against: at
/// that width uiScale is 1 on an ordinary display and the frame is identical,
/// pixel for pixel, to what this client drew before the design space existed.
///
/// The height is 1080 -- a full 16:9 -- and not the ~930 a browser viewport
/// has left at that width, because the height is a CAP, not a target: the
/// window's LONGER axis sets the scale (see Window::setDesignSize), so a
/// design space no taller than the HUD needs would hand the height that job
/// on every ordinary 16:9 monitor and scale the whole interface up with it.
/// The reference game sizes its interface off the window's WIDTH alone, and
/// at 1080 so does this one for every window from 16:9 up to the ultrawides.
/// Past that -- a window taller than 16:9 -- the height takes the scale back
/// and the cap does its real job: without one, a window dragged tall and thin
/// is a zoom control that reveals a strip of world nobody else can see.
inline constexpr int kDesignWidth = 1920;
inline constexpr int kDesignHeight = 1080;

/// True while the pointer is over this client's window. Window gets the answer
/// from DOM enter/leave callbacks in a page and SDL focus on the desktop; a
/// bounds test against the last position cannot answer after the pointer left.
inline bool pointerInWindow(const Window& window) { return window.pointerInside(); }

/// Unix milliseconds. The daily-streak card counts down to timestamps the
/// server minted from the same clock, so this cannot be the app's uptime.
inline std::int64_t wallClockMillis() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

} // namespace flix
