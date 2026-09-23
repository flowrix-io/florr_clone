// A live game, minus its overlays: what this client sends, and what it does
// when the body it was sending for dies.
//
// The input frame is the only thing a movement key produces -- nothing local
// acts on it, because the drawn flower is the server's position eased (see
// client/interpolation.h) -- and it is produced at the simulation rate rather
// than once per rendered frame, so a 144Hz client is not simulated for six
// times what a 25Hz one is.
//
// Death is the other half. The card is a screen of its own (Screen::Dead)
// rather than a dialog, because everything under it keeps running: the world
// dims but still draws, the HUD and the panels stay at full brightness, and
// Close leaves the player dead with the card gone.

#include "client/app.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "client/ui/draw.h"
#include "client/ui/menu_style.h"
#include "shared/game/constants.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The death card's geometry, so the paint and the hit test cannot drift.
///
/// The reference's `make_death_main_screen` is a centred VContainer with a
/// 10px inner gap over five children: a 25px line, a 30px line, an empty
/// 100-tall spacer, a 145x40 button and a 14px line. The container is centred
/// on the screen, so every row's position follows from that stack -- there is
/// no hand-placed pixel in here to drift from it.
struct DeathCard {
    Vec2 killedBy;      ///< centre of "You were killed by"
    Vec2 killer;        ///< centre of the killer's name
    Rect continueBox;
    Rect closeBox;
    Vec2 hint;          ///< centre of "(or press ENTER to continue)"
};

constexpr double kDeathKilledBySize = 25.0;
constexpr double kDeathKillerSize = 30.0;
constexpr double kDeathHintSize = 14.0;
constexpr double kDeathGap = 10.0;
constexpr double kDeathSpacer = 100.0;
constexpr double kDeathButtonWidth = 145.0;
constexpr double kDeathButtonHeight = 40.0;
constexpr double kDeathButtonTextSize = 28.0;
/// Close is not in the reference's stack -- it is this build's own row, added
/// under Continue. Deliberately not a second gardn button: it wears the
/// crafting panel's chip in its greyed-out state, so the pair reads as one
/// primary action with a quiet secondary under it rather than as two choices.
/// Proportioned off Continue at the ratio the browser build's own Close had to
/// its Continue (0.7 by 0.75).
constexpr double kDeathCloseWidth = 100.0;
constexpr double kDeathCloseHeight = 30.0;

/// `slide` is the container's animation: 1 is home and 0 parks the whole stack
/// 60% of a screen below it, which is the reference's animate hook --
/// `translate(0, (animation - 1) * height * 0.6)`.
DeathCard deathCardLayout(double width, double height, double slide) {
    const std::array<double, 6> rows{kDeathKilledBySize, kDeathKillerSize, kDeathSpacer,
                                     kDeathButtonHeight, kDeathCloseHeight, kDeathHintSize};
    double stack = kDeathGap * static_cast<double>(rows.size() - 1);
    for (const double row : rows) stack += row;

    const double centreX = width * 0.5;
    double top = height * 0.5 - stack * 0.5 + (slide - 1.0) * height * 0.6;
    std::array<double, 6> centres{};
    for (std::size_t i = 0; i < rows.size(); ++i) {
        centres[i] = top + rows[i] * 0.5;
        top += rows[i] + kDeathGap;
    }

    DeathCard card;
    card.killedBy = {centreX, centres[0]};
    card.killer = {centreX, centres[1]};
    card.continueBox = {centreX - kDeathButtonWidth * 0.5,
                        centres[3] - kDeathButtonHeight * 0.5, kDeathButtonWidth,
                        kDeathButtonHeight};
    card.closeBox = {centreX - kDeathCloseWidth * 0.5, centres[4] - kDeathCloseHeight * 0.5,
                     kDeathCloseWidth, kDeathCloseHeight};
    card.hint = {centreX, centres[5]};
    return card;
}

} // namespace

void App::sendInputFrame(double dt) {
    net::InputFrame input;
    input.sequence = ++inputSequence_;

    // What the camera actually draws, in world units rather than pixels: the
    // render scales by userZoom, so zooming out shows more world through the
    // same window and the server has to widen what it streams to match. It
    // rides every frame, including the menu-open one below, so a resize or a
    // wheel zoom takes effect on the next tick rather than at the next join.
    const double zoom = camera_.zoom() > 1e-6 ? camera_.zoom() : 1.0;
    input.viewportWidth = static_cast<std::uint16_t>(
        std::min(65535.0, std::round(window_.width() / zoom)));
    input.viewportHeight = static_cast<std::uint16_t>(
        std::min(65535.0, std::round(window_.height() / zoom)));

    // An open menu owns the POINTER, and only the pointer. Steering toward a
    // cursor that is over a panel to drag an item around would send the flower
    // running at whatever slot the hand happened to stop on, so the cursor half
    // -- and the mouse buttons with it -- goes quiet while a panel is up. The
    // movement keys are not the menu's to take: they aim at nothing, cost the
    // open panel nothing, and being frozen in place with the inventory up is
    // how a player gets eaten. They still stop for the one thing that really is
    // typing -- a focused field, which keyboardCaptured() answers for below.
    const bool menuOpen = menus_.anyOpen();

    // Movement follows the cursor, which is the control scheme this game is
    // built around: the flower runs toward the pointer, at a speed set by how
    // far away it is. The movement keys are offered as an alternative rather
    // than a supplement, and win when held so the two cannot fight -- and
    // "Use Mouse Controls", which the K binding toggles in game, is what says
    // whether the cursor half is there at all. The arrows are not a binding:
    // the reference reads them beside whatever the four keys are bound to.
    const ClientSettings& settings = menus_.settings();
    Vec2 keyboard{0, 0};
    // A typed key is a character, not a direction. The reference's key handler
    // returns before it records anything once an <input> has focus, so while
    // the chat line -- or a panel's own field -- is taking keystrokes, none of
    // them reach the movement set. The cursor half keeps working: only the
    // keyboard half goes quiet.
    if (!keyboardCaptured()) {
        if (boundKeyDown(window_, settings.controlKey(ControlAction::MoveUp)) ||
            window_.keyDown(Key::Up)) {
            keyboard.y -= 1;
        }
        if (boundKeyDown(window_, settings.controlKey(ControlAction::MoveDown)) ||
            window_.keyDown(Key::Down)) {
            keyboard.y += 1;
        }
        if (boundKeyDown(window_, settings.controlKey(ControlAction::MoveLeft)) ||
            window_.keyDown(Key::Left)) {
            keyboard.x -= 1;
        }
        if (boundKeyDown(window_, settings.controlKey(ControlAction::MoveRight)) ||
            window_.keyDown(Key::Right)) {
            keyboard.x += 1;
        }
    }

    const Vec2 cursorWorld = camera_.screenToWorld({window_.mouseX(), window_.mouseY()});
    const Vec2 toCursor = cursorWorld - net_.view().selfDrawnPosition();

    // The on-screen stick, when there is one. It REPLACES the cursor half
    // rather than joining it: with touch controls up the pointer is wherever
    // the last tap landed, and letting that steer would send the flower
    // running at whatever was last pressed for as long as nobody tapped
    // anywhere else.
    const bool touchControls = touchControlsVisible();
    ui::MobileControls::Stick stick;
    const bool stickPushed = touchControls && mobile_.stick(stick);

    if (keyboard.lengthSq() > 0) {
        const Vec2 direction = keyboard.normalized();
        input.moveAngle = direction.angle();
        input.moveStrength = 1.0;
    } else if (stickPushed) {
        // Deflection straight to speed, no floor: the same law the cursor
        // follows, measured against the base radius instead of a distance.
        input.moveAngle = stick.direction.angle();
        input.moveStrength = stick.magnitude;
    } else if (settings.useMouseControls && !touchControls && !menuOpen) {
        const double distance = toCursor.length();
        input.moveAngle = distance > 1e-6 ? toCursor.angle() : 0.0;
        input.moveStrength = std::min(1.0, distance / kFullSpeedCursorDistance);
    } else {
        // Standing still is a decision, not a gap: with the cursor half off,
        // a frame with no key held has to say "no movement" rather than leave
        // the last angle to be read as one.
        input.moveAngle = 0.0;
        input.moveStrength = 0.0;
    }

    // Aim follows the cursor, even under keyboard movement: where the petals
    // point and where you walk are separate decisions. A thumb cannot make
    // that second decision -- there is no second pointer to make it with --
    // so a pushed stick aims as well as moves, and a centred one leaves the
    // aim where it last was rather than snapping it to a stale tap.
    if (stickPushed) input.aimAngle = stick.direction.angle();
    // A pointer parked on an open panel is not an aim, for the same reason it
    // is not a heading: hold the last one rather than pointing the petals at
    // whichever slot the hand stopped over.
    else if (menuOpen) input.aimAngle = lastAimAngle_;
    else if (!touchControls) {
        input.aimAngle = toCursor.lengthSq() > 1e-12 ? toCursor.angle() : 0.0;
    } else {
        input.aimAngle = lastAimAngle_;
    }
    lastAimAngle_ = input.aimAngle;

    const Vec2 pointer{window_.mouseX(), window_.mouseY()};
    // A press that landed on a line of chat is a text selection, not a swing.
    // Checked against the PREVIOUS frame's runs because this pass runs before
    // anything has been painted, and only on the press itself -- a hover that
    // blocked the attack would make the whole lower-left corner unshootable.
    ui::TextSelect& selectable = ui::TextSelect::instance();
    const bool textDrag = selectable.dragging() ||
                          (window_.mousePressed(MouseButton::Left) &&
                           selectable.overTextLastFrame(pointer));
    if (!chatOpen_ && !menuOpen && !textDrag && !menus_.capturesMouse(pointer) &&
        !tutorial_.capturesMouse(pointer)) {
        if (window_.mouseDown(MouseButton::Left) ||
            boundKeyDown(window_, settings.controlKey(ControlAction::ExtendPetals))) {
            input.flags |= net::InputAttack;
        }
        if (window_.mouseDown(MouseButton::Right) ||
            boundKeyDown(window_, settings.controlKey(ControlAction::RetractPetals))) {
            input.flags |= net::InputDefend;
        }
    }
    // Outside that guard on purpose: the two on-screen buttons are their own
    // contacts and answer for themselves. None of what the guard is about --
    // a press that landed on a panel, on a line of chat, or on the tutorial
    // card -- can be true of a finger the stick's own hit test claimed.
    if (touchControls) {
        if (mobile_.attackPressed()) input.flags |= net::InputAttack;
        if (mobile_.retractPressed()) input.flags |= net::InputDefend;
    }

    net_.sendInput(input);
}

void App::updatePlaying(double dt) {
    // Chat swallows the keyboard while open, or typing would also drive the
    // flower and trip every hotkey.
    if (chatOpen_ && !menus_.wantsText()) {
        editChatLine();
    } else {
        // The menus get first refusal on the keyboard: a hotkey they claim is
        // not also a chat key. Escape is one of theirs now -- it opens the
        // settings panel and no longer leaves the game, which is the red exit
        // button in the top strip's job alone.
        const bool consumed = menus_.handleKeys(window_);
        if (!consumed) {
            if (boundKeyPressed(window_, menus_.settings().controlKey(ControlAction::Chat)) ||
                pressedChatBox()) {
                chatOpen_ = true;
            }
        }
    }

    // Input is produced at the simulation rate rather than per rendered frame:
    // a 144 Hz client must not get six times the inputs of a 30 Hz one.
    inputAccumulator_ += dt;
    const double step = net::kTickSeconds;
    int produced = 0;
    while (inputAccumulator_ >= step && produced < 4) {
        inputAccumulator_ -= step;
        sendInputFrame(step);
        ++produced;
    }
    // A long stall must not queue a burst of catch-up input.
    if (inputAccumulator_ > step * 4) inputAccumulator_ = 0;

    // The wheel zooms the camera unless a panel -- or the tutorial box, which
    // is a DOM element and eats the event before the canvas -- is over it, and
    // unless the transcript took it to read back through itself.
    if (!scrollChat() && !menus_.capturesMouse({window_.mouseX(), window_.mouseY()}) &&
        !tutorial_.capturesMouse({window_.mouseX(), window_.mouseY()})) {
        menus_.settings().zoom =
            clamp(menus_.settings().zoom + window_.wheelDelta() * 0.05, kMinZoom, kMaxZoom);
    }
}

void App::updateDead(double dt) {
    (void)dt;
    // The transcript keeps drawing over the dimmed world, so it keeps
    // scrolling. There is no camera zoom to lose the wheel to here, so nothing
    // hangs on the answer.
    scrollChat();
    // ENTER is the Continue button by another name, and is gated on being
    // dead rather than on where the card has slid to. The reference takes the
    // key on the same condition, though it spends it on an immediate respawn:
    // there the title screen IS the respawn screen, and here Continue is the
    // way back to it.
    if (window_.keyPressed(Key::Enter)) {
        leaveToTitle();
        return;
    }
    if (!deathCardVisible_) return;

    // The reference acts on the press, not the release, so the card is gone by
    // the time the button comes back up and a pressed state is never seen.
    if (!window_.mousePressed(MouseButton::Left)) return;

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    // The tutorial box is painted over the death card and swallows the click.
    if (tutorial_.capturesMouse(mouse)) return;
    // The ANIMATED boxes, not the resting ones: a button is only where it is
    // painted, and during the slide-in that is on its way up the screen.
    const DeathCard card = deathCardLayout(window_.width(), window_.height(), deathCardSlide_);
    if (hit(card.continueBox, mouse)) {
        leaveToTitle();
        return;
    }
    // Close only takes the card away -- it slides back down the way it came.
    // The player stays dead, and the dimmed world, the HUD and the minimap
    // keep drawing behind where it was.
    if (hit(card.closeBox, mouse)) deathCardVisible_ = false;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void App::drawDeathCard(Canvas& canvas, double time) {
    (void)time;   // static: the card's only variable is which button is hovered
    // No scrim of its own. The death dim is a wash over the WORLD alone,
    // painted long before this -- see the call in frame() -- and the card is
    // one of the things that stays at full brightness over it.
    const DeathCard card = deathCardLayout(canvas.width(), canvas.height(), deathCardSlide_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    // Plain white text with its ordinary 0.12-of-size outline, at the
    // reference's two sizes. Nothing here is bold or coloured: the card says
    // what killed you, it does not shout about it.
    TextStyle line;
    line.align = Align::Centre;
    line.size = kDeathKilledBySize;
    text(canvas, "You were killed by", card.killedBy.x, card.killedBy.y, line);

    line.size = kDeathKillerSize;
    const std::string killer = net_.killerName().empty()
        ? "a mysterious entity"
        : net_.killerName();
    text(canvas, killer, card.killer.x, card.killer.y, line);

    const bool over = hit(card.continueBox, mouse);
    ButtonStyle continueStyle;
    continueStyle.fill = kAccent;
    continueStyle.outlineWidth = 5.0;
    continueStyle.radius = 3.0;
    continueStyle.textSize = kDeathButtonTextSize;
    continueStyle.textStrokeWidth = kDeathButtonTextSize * kTextStrokeRatio;
    button(canvas, card.continueBox, "Continue", over,
           over && window_.mouseDown(MouseButton::Left), continueStyle);

    // The crafting panel's chip, in the greyed-out state `chip` draws for a
    // disabled control: 0x8A8A8A over 0x5A5A5A at 0.45. It still answers a
    // click -- the grey is about weight, not about being dead -- but nothing
    // here brightens under the cursor, which is what keeps Continue reading as
    // the button the card is actually asking for.
    ChipStyle closeStyle;
    closeStyle.enabled = false;
    chip(canvas, card.closeBox, "Close", hit(card.closeBox, mouse), closeStyle);

    line.size = kDeathHintSize;
    text(canvas, "(or press ENTER to continue)", card.hint.x, card.hint.y, line);
}

void App::drawDisconnectBanner(Canvas& canvas) {
    // A strip across the very top, with the world and the HUD still drawing
    // underneath it. A dropped socket does not take the game off the screen.
    setFill(canvas, 0xC81E1Eu, 0.85);
    canvas.fillRect(0, 0, static_cast<float>(canvas.width()), 38.0f);

    TextStyle style;
    style.size = 16;
    style.align = Align::Centre;
    style.strokeWidth = 0;
    text(canvas, "Disconnected from server. Reconnecting...", canvas.width() * 0.5, 19.0, style);
}

} // namespace flix
