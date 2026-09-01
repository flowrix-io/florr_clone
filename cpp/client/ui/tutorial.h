#pragma once
// The onboarding tutorial: an eleven-step card over a live game.
//
// The browser build draws this one surface out of a fixed DOM box and its own
// stylesheet rather than out of the game's widgets, which is why nothing here
// reuses draw.h's plate() or button(): the card is plain Ubuntu on a
// translucent dark rectangle with two flat pill buttons, and a gardn-style
// control in it would read as a different design.
//
// Its persistent state is two values -- whether the tutorial is finished and
// how far it had got -- which ride in ClientSettings so there is one client
// settings file rather than a second store beside it.

#include <cstdint>
#include <string>
#include <vector>

#include "canvas.h"
#include "window.h"

#include "shared/core/types.h"

namespace flr {

struct ClientSettings;
struct Profile;

} // namespace flr

namespace flr::ui {

/// What a step waits for instead of a click. The browser spells these as
/// `condition` closures over one `completedSteps` set; there is one flag per
/// member of that set and, like the set, they latch for the whole game.
enum class TutorialGesture : std::uint8_t {
    None = 0,       ///< the step shows a Next button and waits for nothing
    Movement,       ///< W/A/S/D or an arrow key
    ExtendPetals,   ///< SPACE
    OpenInventory,  ///< Z
    EquipPetal,     ///< a petal reaching a loadout slot
    OpenCrafting,   ///< C
};

/// One step's static copy and its rules.
struct TutorialStep {
    const char* title;
    /// The browser's description string verbatim, `<strong>`, `<em>` and
    /// `<br>` included. Kept as written so a change to the reference copy is a
    /// one-line change here.
    const char* description;
    /// False on the steps whose `skipButton: false` hides the Skip button.
    bool skipButton;
    /// A step that waits for a gesture shows no Next button at all -- the
    /// browser gates that button on `!step.condition`.
    TutorialGesture gesture;
};

class Tutorial {
public:
    /// The eleven steps, which is also the counter's denominator and the
    /// number of pagination dots.
    static constexpr int kStepCount = 11;

    /// The steps, for anything that wants to read the copy.
    static const TutorialStep* steps();

    /// Arms the card for a game that has just begun. The browser puts it up a
    /// second after the socket authenticates, and not at all once the settings
    /// say it is finished.
    ///
    /// `force` is what --tutorial passes: the card goes up at once, whatever
    /// the settings file says, and without writing that flag the other way.
    void beginGame(const ClientSettings&, double nowSeconds, bool force);

    /// Takes the card down without finishing it, for leaving the world. The
    /// browser destroys the whole Tutorial with the Game that owns it.
    void endGame();

    bool visible() const { return visible_; }

    /// One frame of input: the gestures the waiting steps watch for, then the
    /// card's own two buttons. Runs before the world sees the same click, the
    /// way the browser's DOM box takes it before the canvas does.
    void update(Window&, ClientSettings&, const Profile&, double nowSeconds);

    /// Paints the card. `highlightCard` is the crafting panel's box while that
    /// panel is open and empty otherwise -- see `kCraftingHighlightStep`.
    void draw(Canvas&, double nowSeconds, Rect highlightCard);

    /// True while the pointer is over the card. In the browser the box is a
    /// DOM element on top of the canvas, so a click there never reaches the
    /// game underneath.
    bool capturesMouse(Vec2 mouse) const;

private:
    /// One stretch of a description in a single style, already positioned.
    struct Piece {
        std::string text;
        bool italic = false;
        double x = 0;       ///< from the content column's left edge
    };
    struct Line {
        std::vector<Piece> pieces;
    };

    /// Everything the card's paint and its hit-testing both need, in the
    /// card's own untransformed coordinates. `scale`/`offset`/`alpha` are the
    /// 0.3s intro, and are the identity once it has run.
    struct Layout {
        Rect card;
        double contentX = 0;
        double contentW = 0;
        double titleBaseline = 0;
        std::vector<Line> lines;
        double firstBaseline = 0;
        /// Zero-width when the step shows no such button.
        Rect skip;
        Rect next;
        double counterBaseline = 0;
        double dotsTop = 0;
        double scale = 1.0;
        Vec2 offset;
        double alpha = 1.0;
    };

    Layout layout(int viewWidth, double nowSeconds) const;
    /// A card-space rectangle in screen space, with the intro transform on it.
    static Rect transformed(const Layout&, Rect);

    void showStep(int index, double nowSeconds);
    void advance(ClientSettings&, double nowSeconds);
    void finish(ClientSettings&);
    /// True when the step showing is waiting on a gesture that has happened.
    bool conditionMet() const;

    bool visible_ = false;
    /// Set by beginGame and cleared once the card has actually gone up: the
    /// browser's own start is a one-second setTimeout after the join.
    bool pending_ = false;
    double pendingUntil_ = 0;

    int step_ = 0;
    /// When the current step was first painted, which the poll that watches
    /// its condition is measured from.
    double stepShownAt_ = 0;
    /// When the whole card was created, for the intro. Separate from
    /// stepShownAt_ because the browser animates the box, not its contents:
    /// replacing the innerHTML does not restart the animation.
    double shownAt_ = 0;
    /// When a satisfied condition will advance the card, or negative.
    double advanceAt_ = -1;

    /// The gestures the waiting steps watch for. One flag per member of the
    /// browser's `completedSteps` set, and like that set they are latched for
    /// the whole game rather than per step.
    bool movementDetected_ = false;
    bool petalsExtended_ = false;
    bool inventoryOpened_ = false;
    bool itemEquipped_ = false;
    bool craftingOpened_ = false;

    /// The loadout as it was last seen, so a slot that gains a petal can stand
    /// in for the browser's `loadout:equip` event -- there is no event bus
    /// here, and a filled slot is what that event announces.
    std::vector<std::uint32_t> lastLoadout_;

    /// Skip asks twice. The browser asks through a native confirm(), which
    /// this client has no way to put on screen; arming the button instead is
    /// what the talents panel's own destructive button already does.
    bool skipArmed_ = false;
    double skipArmedUntil_ = 0;

    /// How far each button's `transition: all 0.2s ease` has run, 0 to 1.
    /// Linear here and eased when it is read, which is one value per button
    /// instead of a start value, an end value and a clock.
    double skipHover_ = 0;
    double nextHover_ = 0;
    /// The previous frame's clock, so the two transitions can be advanced
    /// without the caller having to hand this class a dt as well.
    double lastNow_ = -1;

    /// The layout the last update() measured, so capturesMouse() and draw()
    /// answer for the same card the click was tested against.
    Layout cached_;
};

} // namespace flr::ui
