#pragma once
// The touch HUD: a virtual stick for movement and aim, and the three buttons
// that stand in for the keys a phone does not have.
//
// A port of the browser build's src/graphics/mobile-controls.ts, control for
// control, with one thing done differently and one thing added.
//
// Differently: the sizes. The reference is written in CSS pixels on a canvas
// the size of the viewport, so its 55px stick radius is a thumb on a phone and
// a dot on a desktop monitor. This client draws into a FIXED 1920x1080 design
// space (see Window's header), where a size is a fraction of the screen rather
// than a length -- so every measurement below is the reference's, multiplied
// by the design units a CSS pixel is worth on a phone-sized viewport. The
// controls then land at the same fraction of the screen a phone player sees
// there, which is what the reference's numbers were chosen for.
//
// Added: aim. The reference aims at the mouse even on a phone, where "the
// mouse" is wherever the last tap happened to land. Here a deflected stick
// aims as well as moves, which is the only thing a thumb can say.
//
// Added too: the row swap button, the R key's stand-in. Attack and Retract are
// held, and read as state; this one acts once per press, as the key does.

#include <cstdint>
#include <functional>
#include <vector>

#include "canvas.h"
#include "window.h"

#include "shared/core/types.h"

namespace flix::ui {

/// Design units per CSS pixel on a phone-sized viewport.
///
/// A phone in landscape is about 800 CSS pixels wide, and the design space is
/// 1920 units across whatever the window's real width is -- so a control that
/// should cover a phone's thumb has to be this much larger here than the
/// number the reference writes for the same control.
///
/// It is the CEILING of the conversion now, and the default for a caller that
/// does not know the real one (the tests' phone). The real one is the
/// window's own (Window::unitsPerPoint), and on anything bigger than a phone
/// it is smaller: an iPad in landscape is 1024 points across, so a point is
/// about 1.4 units there, and the iPad Pro 12.9" is barely over 1. Laid out at
/// the phone's 2.4 regardless, the controls came out at the same FRACTION of
/// a tablet's screen as of a phone's -- a stick nearly five centimetres
/// across on the big iPad, buttons the size of a palm, and a fifth of the
/// world under the player's hands. The reference sized them in CSS pixels on
/// every device, which is what a thumb is measured in.
inline constexpr double kTouchScale = 2.4;
/// The floor of the same conversion: a window wider than the design space --
/// a touch monitor on a desk -- still gets them at no less than design size.
inline constexpr double kMinTouchScale = 1.0;

// A world finger stays independent of joystick/button fingers on iPad.
class TouchCursor {
public:
    void update(const std::vector<TouchEvent>& events, const std::function<bool(Vec2)>& accepts) {
        for (const auto& e : events) {
            if (e.phase == TouchPhase::Began && !held_ && accepts({e.point.x, e.point.y})) {
                id_ = e.point.id; held_ = true; pointed_ = true; position_ = {e.point.x, e.point.y};
            } else if (held_ && e.point.id == id_) {
                position_ = {e.point.x, e.point.y};
                if (e.phase == TouchPhase::Ended) held_ = false;
            }
        }
    }
    void reset() { held_ = false; pointed_ = false; }
    /// As MobileControls::releaseLost: a finger the window dropped without an
    /// end (the page lost focus under it) is not still dragging.
    void releaseLost(const std::vector<TouchPoint>& live) {
        if (!held_) return;
        for (const TouchPoint& point : live) {
            if (point.id == id_) return;
        }
        held_ = false;
    }
    bool held() const { return held_; }
    bool hasPointer() const { return pointed_; }
    Vec2 position() const { return position_; }
private:
    std::int64_t id_ = 0;
    bool held_ = false, pointed_ = false;
    Vec2 position_;
};

class MobileControls {
public:
    /// Anchors the controls for a viewport of this size.
    ///
    /// `loadoutBarHeight` is what the loadout bar occupies from the bottom
    /// edge: the bar is centred and reaches nearly to the edge on its own, so
    /// everything here hangs ABOVE it rather than below.
    ///
    /// `unitsPerPoint` is the window's design units per CSS pixel
    /// (Window::unitsPerPoint), which is what turns the reference's
    /// measurements -- CSS pixels -- into design units for THIS screen. It is
    /// held between kMinTouchScale and kTouchScale; the default is a phone's.
    void layout(int viewWidth, int viewHeight, double loadoutBarHeight,
                double unitsPerPoint = kTouchScale);

    /// Whether a finger landing here belongs to these controls.
    ///
    /// Pure, and deliberately so: it is the answer Window's claim handler
    /// needs the instant a contact arrives, and the state it would otherwise
    /// change is changed by update() on the same event a moment later.
    bool hits(double x, double y) const;

    /// One frame of the touch stream. Contacts that landed on a control are
    /// bound to it here and followed until they lift.
    void update(const std::vector<TouchEvent>& events);

    /// Lets go of every control whose finger is no longer down, given the
    /// window's live set (Window::touches) after the same frame's update().
    ///
    /// The event stream is not enough on its own. When the page loses focus
    /// with fingers down -- a notification pulled over the game, a swipe to
    /// another app that the browser does not answer with a touchcancel --
    /// the window drops those contacts from its live set without an end
    /// event, because the lift happens somewhere the page cannot see. A
    /// control listening only for ends kept holding: the player came back to
    /// a flower still walking in the direction the stick was last pushed.
    void releaseLost(const std::vector<TouchPoint>& live);

    /// Drops every contact -- what a screen change, a panel opening over the
    /// controls or the setting being switched off has to do, or a stick that
    /// was deflected when it vanished goes on steering forever.
    void reset();

    /// The stick's direction and how far it is pushed, 0 to 1, or nothing at
    /// all when it is centred or untouched.
    struct Stick {
        Vec2 direction{0, 0};
        double magnitude = 0;
    };
    bool stick(Stick& out) const;

    /// Where each control ended up. Published for the sake of anything that
    /// has to reason about the space they occupy -- and for the tests, which
    /// need a point on a control to press without knowing its size.
    Vec2 stickCentre() const { return stickCentre_; }
    Vec2 attackCentre() const { return attackCentre_; }
    Vec2 retractCentre() const { return retractCentre_; }
    Vec2 rowSwapCentre() const { return rowSwapCentre_; }

    bool attackPressed() const { return attack_.held; }
    bool retractPressed() const { return retract_.held; }
    bool rowSwapPressed() const { return rowSwap_.held; }

    /// Whether a finger has landed on the row swap button since the last call.
    /// Spent by asking, so one press is one swap however long the finger stays.
    bool takeRowSwap();

    void setAdminCursor(bool enabled) { adminCursor_ = enabled; }
    void draw(Canvas&) const;

private:
    /// The contact bound to one control, if any. An id and a flag rather than
    /// a sentinel id: nothing promises a platform's finger ids avoid any
    /// particular value, and "no finger" is not a finger number.
    struct Contact {
        std::int64_t id = 0;
        bool held = false;
        bool is(std::int64_t other) const { return held && id == other; }
    };

    /// False until layout() has run. A control that has never been placed sits
    /// at the origin, and would otherwise claim every touch in the top-left
    /// corner of the first frame it is asked about.
    bool placed_ = false;
    bool adminCursor_ = false;
    /// Everything shrinks by this together: the screen's own points against a
    /// phone's, times the shrink a viewport too narrow to lay the controls out
    /// side by side needs (1 on every landscape one). See layout().
    double scale_ = 1.0;
    /// Where the finger holding the stick is, relative to the stick's centre,
    /// clamped to the base. The knob is drawn at it and the direction is read
    /// off it, exactly as the reference's `knobOffset` is.
    Vec2 knob_{0, 0};
    Vec2 stickCentre_{0, 0};
    Vec2 attackCentre_{0, 0};
    Vec2 retractCentre_{0, 0};
    Vec2 rowSwapCentre_{0, 0};

    // Four fingers can be down at once, and only their ids tell the streams
    // apart -- a position cannot, once two of them are moving.
    Contact stick_;
    Contact attack_;
    Contact retract_;
    Contact rowSwap_;
    /// A press takeRowSwap has not answered for yet.
    bool rowSwapQueued_ = false;

    void moveKnob(double x, double y);
};

} // namespace flix::ui
