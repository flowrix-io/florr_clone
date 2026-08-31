#pragma once

// An interactive window with input, for applications that own their own frame
// loop.
//
// Canvas::showWindow() takes the loop over and reports nothing but "closed",
// which is enough for a demo and not enough for anything interactive. A Window
// inverts that: the caller drives the loop, pumps events when it likes, draws
// into the window's Canvas, and presents when it is ready.
//
// SDL is an implementation detail and does not appear in this header.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "canvas.h"

// Physical keys, named independently of any backend's numbering.
enum class Key : std::uint16_t {
    Unknown = 0,
    A, B, C, D, E, F, G, H, I, J, K, L, M,
    N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
    Num0, Num1, Num2, Num3, Num4, Num5, Num6, Num7, Num8, Num9,
    Space, Enter, Escape, Backspace, Tab,
    Left, Right, Up, Down,
    LeftShift, RightShift, LeftCtrl, RightCtrl, LeftAlt, RightAlt,
    Minus, Equals, Comma, Period, Slash, Backslash, Semicolon, Apostrophe,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
    Count
};

enum class MouseButton : std::uint8_t { Left = 0, Middle, Right, Count };

class Window {
public:
    Window();
    ~Window();
    Window(const Window&) = delete;
    Window& operator=(const Window&) = delete;

    // Creates the window. Returns false with `errorOut` set on failure.
    bool open(int width, int height, const std::string& title, std::string& errorOut);
    void close();
    bool isOpen() const { return open_; }

    // Drains OS events into the input state below. Returns false once the user
    // has asked to close the window.
    //
    // Edge state (pressed/released this frame, wheel, typed text) is cleared at
    // the START of each pump, so it stays readable for the whole frame that
    // follows -- the alternative, clearing after the frame, loses events that
    // arrive while the frame is still being drawn.
    bool pump();

    // The canvas sized to the window's drawable area. Recreated on resize, so
    // do not hold the reference across a pump().
    Canvas& canvas();

    // Uploads the canvas and shows it.
    void present();

    int width() const;
    int height() const;

    // Waits out the remainder of a frame at `targetFps`. Returns the seconds
    // the last frame actually took, so the caller can integrate with real dt.
    double frameDelay(double targetFps);

    double timeSeconds() const;

    // -- input ---------------------------------------------------------------

    bool keyDown(Key k) const;
    bool keyPressed(Key k) const;    ///< went down this frame
    bool keyReleased(Key k) const;   ///< came up this frame

    bool mouseDown(MouseButton b) const;
    bool mousePressed(MouseButton b) const;
    bool mouseReleased(MouseButton b) const;

    float mouseX() const;
    float mouseY() const;
    float wheelDelta() const;

    /// UTF-8 typed this frame, for text fields. Distinct from keyPressed:
    /// this is what the keyboard layout produced, not which key was struck.
    const std::string& typedText() const;

    /// True while a modifier is held, for shortcuts.
    bool shiftHeld() const;
    bool ctrlHeld() const;
    bool altHeld() const;

    void setCursorVisible(bool visible);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    bool open_ = false;
};
