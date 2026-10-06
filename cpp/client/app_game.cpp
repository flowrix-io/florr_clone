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
// Close leaves the player dead with the card gone -- its dim and its Enter
// shortcut with it.

#include "client/app.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>

#include "client/ui/draw.h"
#include "client/ui/item_tile.h"
#include "client/ui/menu_style.h"
#include "shared/game/constants.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The death card's geometry, so the paint and the hit test cannot drift.
///
/// Laid out to death_ui_screenshot.png, which is 1:1 with design units (its
/// loadout slots are this build's 70 across). Everything hangs off the dead
/// flower, and the flower sits on the screen's centre -- exactly over the
/// corpse the camera is pinned to -- so each row is an offset from it rather
/// than a place in a stack. Text rows are given by the middle of their glyphs,
/// which is where ui::text centres a line.
struct DeathCard {
    Vec2 destroyedBy;   ///< centre of "You were destroyed by:"
    Vec2 killer;        ///< centre of the killer's name
    Vec2 flower;        ///< centre of the dead flower
    Rect continueBox;
    Rect closeBox;
};

constexpr double kDeathDestroyedBySize = 18.0;
constexpr double kDeathDestroyedByY = -118.5;
constexpr double kDeathKillerSize = 24.0;
constexpr double kDeathKillerY = -89.0;

/// The dead flower, at this times its 25-unit art: its yellow is 35 across
/// the radius in the screenshot, and the art's is 23.5.
constexpr double kDeathFlowerScale = 1.49;
/// Turned a little anticlockwise, as the reference's DeadFlowerIcon turns it.
constexpr double kDeathFlowerTilt = -0.2;
/// A frown: the face's curve control, where the living flower's 15 smiles.
constexpr double kDeathFlowerMouth = 5.0;
/// The loadout round it, in the flower's art units. The reference's ellipse
/// shape -- wider than tall, the top half behind the body and the bottom half
/// in front -- at the size and phase the screenshot measures: 44 by 29 rather
/// than gardn's 40 by 25, with the first petal 0.96 radians round, low on the
/// right.
constexpr double kDeathRingX = 44.0;
constexpr double kDeathRingY = 29.0;
constexpr double kDeathRingPhase = 0.96;

/// Continue is a gardn button: a 132x40 box under a 6-unit rim at 0.8 of its
/// fill, which button() derives. Close is the same button, smaller and grey.
constexpr double kDeathContinueY = 95.0;
constexpr double kDeathContinueWidth = 132.0;
constexpr double kDeathContinueHeight = 40.0;
constexpr double kDeathContinueRim = 6.0;
constexpr double kDeathContinueRadius = 4.0;
constexpr double kDeathContinueTextSize = 24.0;
constexpr std::uint32_t kDeathContinueFill = 0x62CE49u;
constexpr double kDeathCloseY = 140.0;
constexpr double kDeathCloseWidth = 68.0;
constexpr double kDeathCloseHeight = 24.0;
constexpr double kDeathCloseRim = 4.0;
constexpr double kDeathCloseRadius = 3.0;
constexpr double kDeathCloseTextSize = 16.0;
constexpr std::uint32_t kDeathCloseFill = 0x666666u;

/// How far the card reaches below the flower: Close's box and half its rim.
constexpr double kDeathCardBelow = kDeathCloseY + kDeathCloseHeight * 0.5 + kDeathCloseRim * 0.5;

/// How far past the top edge the parked card's last row sits. The card stops
/// being painted at a slide of 0.01, still 1% short of parked, and that 1%
/// must not bring Close's rim back onto the screen.
constexpr double kDeathParkClearance = 16.0;

/// `slide` is the container's animation: 1 is home and 0 parks the whole card
/// above the screen, which is the reference's animate hook --
/// `translate(0, (animation - 1) * height * 0.6)` -- with one change: 60% of a
/// screen is only a floor. At 1080 units tall it leaves Close hanging off the
/// top edge for the last frames of the slide out, so the card is lifted as far
/// as it takes to clear the edge whenever that is more.
DeathCard deathCardLayout(double width, double height, double slide) {
    const double park =
        std::max(height * 0.6, height * 0.5 + kDeathCardBelow + kDeathParkClearance);
    const Vec2 flower{width * 0.5, height * 0.5 + (slide - 1.0) * park};

    DeathCard card;
    card.flower = flower;
    card.destroyedBy = {flower.x, flower.y + kDeathDestroyedByY};
    card.killer = {flower.x, flower.y + kDeathKillerY};
    card.continueBox = {flower.x - kDeathContinueWidth * 0.5,
                        flower.y + kDeathContinueY - kDeathContinueHeight * 0.5,
                        kDeathContinueWidth, kDeathContinueHeight};
    card.closeBox = {flower.x - kDeathCloseWidth * 0.5,
                     flower.y + kDeathCloseY - kDeathCloseHeight * 0.5, kDeathCloseWidth,
                     kDeathCloseHeight};
    return card;
}

/// The reference's DeadFlowerIcon: the corpse's face with the active row of
/// the loadout laid round it. One icon per slot, whatever the petal's count,
/// at the size a tile draws it. Equipment -- a zero-count petal, the antennae
/// or a third eye -- is not a seat in the ring: it is worn, as on the corpse.
void drawDeathFlower(Canvas& canvas, const WorldRenderer& renderer, const SpriteCache& sprites,
                     const std::vector<Profile::Slot>& loadout, Vec2 centre, double time) {
    struct Seat {
        std::uint16_t petal;
        Rarity rarity;
    };
    std::vector<Seat> ring;
    std::uint8_t equipFlags = EquipNone;
    const std::size_t active =
        std::min(loadout.size(), static_cast<std::size_t>(kLoadoutActiveSlots));
    for (std::size_t i = 0; i < active; ++i) {
        const Profile::Slot& slot = loadout[i];
        if (slot.empty() || slot.petalIndex >= content().petalCount()) continue;
        const PetalConfig& config = content().petal(slot.petalIndex);
        if (config.count > 0 && !config.hidden) ring.push_back({slot.petalIndex, slot.rarity});
        equipFlags |= config.equipFlags;
    }

    canvas.save();
    canvas.translate(static_cast<float>(centre.x), static_cast<float>(centre.y));
    canvas.scale(static_cast<float>(kDeathFlowerScale), static_cast<float>(kDeathFlowerScale));
    const auto paintSeats = [&](bool front) {
        for (std::size_t i = 0; i < ring.size(); ++i) {
            const double angle =
                kTau * static_cast<double>(i) / static_cast<double>(ring.size()) +
                kDeathRingPhase;
            const double y = std::sin(angle) * kDeathRingY;
            if ((y > 0.0) != front) continue;
            const PetalStats stats = content().petalStats(ring[i].petal, ring[i].rarity);
            drawPetalCluster(canvas, sprites, ring[i].petal, ring[i].rarity, stats.size, 1,
                             std::cos(angle) * kDeathRingX, y, 0.0, time);
        }
    };
    paintSeats(false);
    canvas.save();
    canvas.rotate(static_cast<float>(kDeathFlowerTilt));
    renderer.drawDeadFlower(canvas, equipFlags, kDeathFlowerMouth, time);
    canvas.restore();
    paintSeats(true);
    canvas.restore();
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
    const bool menuOpen = menus_.anyOpen() || adminPanelOpen_ ||
        (net_.isSkinAdmin() && Rect{16, 44, 100, 32}.contains(
            Vec2{window_.mouseX(), window_.mouseY()}));

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
    updateAdminPanel();
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
    // Chat swallows the keyboard while it is open, as it does in the living
    // game: a line being typed when the body went down is sent by Enter, not
    // spent on Continue. Not returned from -- a click on Continue or Close
    // closes the line AND presses the button, which is one click, not two.
    const bool chatting = chatOpen_ && !menus_.wantsText();
    if (chatting) {
        editChatLine();
    } else if (pressedChatBox() ||
               (!deathCardVisible_ && window_.keyPressed(Key::Enter))) {
        // With the card closed, Enter is chat's again: the slot under the
        // dimmed world still says "Press Enter to chat...".
        chatOpen_ = true;
    }
    if (!deathCardVisible_) return;

    // ENTER is the Continue button by another name, but only while the card
    // that offers it is up -- Close takes the shortcut away with the button.
    // Gated on the flag rather than on where the card has slid to, so it works
    // from the frame of death. The reference spends the key on an immediate
    // respawn: there the title screen IS the respawn screen, and here
    // Continue is the way back to it.
    if (!chatting && window_.keyPressed(Key::Enter)) {
        leaveToTitle();
        return;
    }

    // The reference acts on the press, not the release, so the card is gone by
    // the time the button comes back up and a pressed state is never seen.
    if (!window_.mousePressed(MouseButton::Left)) return;

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    // The tutorial box is painted over the death card and swallows the click.
    if (tutorial_.capturesMouse(mouse)) return;
    // The ANIMATED boxes, not the resting ones: a button is only where it is
    // painted, and during the slide-in that is on its way down the screen.
    const DeathCard card = deathCardLayout(window_.width(), window_.height(), deathCardSlide_);
    if (hit(card.continueBox, mouse)) {
        leaveToTitle();
        return;
    }
    // Close takes the card away -- it slides back up the way it came -- and
    // the world's dim fades out with it. The player stays dead, and the HUD
    // and the minimap keep drawing behind where it was.
    if (hit(card.closeBox, mouse)) deathCardVisible_ = false;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void App::drawDeathCard(Canvas& canvas, double time) {
    // No scrim of its own. The death dim is a wash over the WORLD alone,
    // painted long before this -- see the call in frame() -- and the card is
    // one of the things that stays at full brightness over it.
    const DeathCard card = deathCardLayout(canvas.width(), canvas.height(), deathCardSlide_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    // Bold white with the ordinary 0.12-of-size outline. No hint line under
    // the buttons: ENTER still continues while the card is up, it just is not
    // written down any more.
    TextStyle line;
    line.align = Align::Centre;
    line.size = kDeathDestroyedBySize;
    text(canvas, "You were destroyed by:", card.destroyedBy.x, card.destroyedBy.y, line);

    line.size = kDeathKillerSize;
    const std::string killer = net_.killerName().empty()
        ? "A mysterious entity"
        : net_.killerName();
    text(canvas, killer, card.killer.x, card.killer.y, line);

    drawDeathFlower(canvas, renderer_, sprites_, net_.profile().loadout, card.flower, time);

    const bool pressing = window_.mouseDown(MouseButton::Left);
    const bool overContinue = hit(card.continueBox, mouse);
    ButtonStyle continueStyle;
    continueStyle.fill = kDeathContinueFill;
    continueStyle.outlineWidth = kDeathContinueRim;
    continueStyle.radius = kDeathContinueRadius;
    continueStyle.textSize = kDeathContinueTextSize;
    button(canvas, card.continueBox, "Continue", overContinue, overContinue && pressing,
           continueStyle);

    const bool overClose = hit(card.closeBox, mouse);
    ButtonStyle closeStyle;
    closeStyle.fill = kDeathCloseFill;
    closeStyle.outlineWidth = kDeathCloseRim;
    closeStyle.radius = kDeathCloseRadius;
    closeStyle.textSize = kDeathCloseTextSize;
    button(canvas, card.closeBox, "Close", overClose, overClose && pressing, closeStyle);
}

void App::tallyRunLoot() {
    const std::uint32_t self = net_.view().self().netId;
    if (self == 0) return;
    for (const ViewEvent& event : net_.view().events()) {
        // Somebody else's pickup is not the viewer's loot, and a drop pays out
        // one copy to each eligible flower -- so only the viewer's own cue
        // counts, and each one is exactly one item.
        if (event.kind != net::EventKind::PickedUp || event.otherNetId != self) continue;
        const auto petal = static_cast<std::uint16_t>(event.amount);
        if (petal >= content().petalCount()) continue;
        const Rarity rarity = clampRarity(static_cast<int>(event.flag));
        const auto found = std::find_if(runLoot_.begin(), runLoot_.end(), [&](const RunLoot& l) {
            return l.petalIndex == petal && l.rarity == rarity;
        });
        if (found == runLoot_.end()) {
            runLoot_.push_back({petal, rarity, 1});
        } else if (found->count < UINT32_MAX) {
            ++found->count;
        }
    }
}

namespace {

/// The "Collected this run" panel, measured off the same screenshot as the
/// card: a 4-wide grid of 50-unit tiles on a 60 pitch, 30 in from either side
/// of a panel black at 0.55, its corner where the minimap's is. A short last
/// row is centred, as the screenshot centres its two.
constexpr int kRunLootColumns = 4;
constexpr double kRunLootTile = 50.0;
constexpr double kRunLootPitch = 60.0;
constexpr double kRunLootSide = 30.0;
constexpr double kRunLootMargin = 10.0;
constexpr double kRunLootTitleY = 33.0;   ///< middle of the title, from the panel top
constexpr double kRunLootTitleSize = 24.0;
constexpr double kRunLootGridY = 65.0;    ///< top of the first row, from the panel top
constexpr double kRunLootBottom = 20.0;
constexpr double kRunLootRadius = 6.0;
constexpr double kRunLootShade = 0.55;
/// The panel stops growing before it reaches the loadout bar. Rows past that
/// are dropped from the end, which is the commonest tier.
constexpr double kRunLootFloor = 260.0;

} // namespace

void App::drawRunLoot(Canvas& canvas, double time) {
    if (runLoot_.empty()) return;

    // Rarest first, then by name -- the screenshot's order.
    std::vector<RunLoot> shown = runLoot_;
    std::sort(shown.begin(), shown.end(), [](const RunLoot& a, const RunLoot& b) {
        if (a.rarity != b.rarity) return rarityIndex(a.rarity) > rarityIndex(b.rarity);
        const std::string& an = content().petal(a.petalIndex).name;
        const std::string& bn = content().petal(b.petalIndex).name;
        if (an != bn) return an < bn;
        return a.petalIndex < b.petalIndex;
    });

    const double width = kRunLootSide * 2.0 + kRunLootTile * kRunLootColumns +
                         (kRunLootPitch - kRunLootTile) * (kRunLootColumns - 1);
    const double left = canvas.width() - kRunLootMargin - width;
    const double top = kRunLootMargin;
    const int fitRows = std::max(
        1, static_cast<int>((canvas.height() - kRunLootFloor - top - kRunLootGridY +
                             (kRunLootPitch - kRunLootTile)) / kRunLootPitch));
    const int wantRows = (static_cast<int>(shown.size()) + kRunLootColumns - 1) / kRunLootColumns;
    const int rows = std::min(wantRows, fitRows);
    shown.resize(std::min(shown.size(), static_cast<std::size_t>(rows * kRunLootColumns)));
    const double height = kRunLootGridY + rows * kRunLootPitch -
                          (kRunLootPitch - kRunLootTile) + kRunLootBottom;

    // Fades with the card's slide, so it leaves with it on Close.
    canvas.setGlobalAlpha(static_cast<float>(std::clamp(deathCardSlide_, 0.0, 1.0)));
    setFill(canvas, 0x000000u, kRunLootShade);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(left), static_cast<float>(top),
                     static_cast<float>(width), static_cast<float>(height),
                     static_cast<float>(kRunLootRadius));
    canvas.fill();

    TextStyle title;
    title.size = kRunLootTitleSize;
    title.align = Align::Centre;
    text(canvas, "Collected this run", left + width * 0.5, top + kRunLootTitleY, title);

    for (int row = 0; row < rows; ++row) {
        const int first = row * kRunLootColumns;
        const int inRow = std::min(kRunLootColumns, static_cast<int>(shown.size()) - first);
        const double rowWidth = kRunLootTile * inRow + (kRunLootPitch - kRunLootTile) * (inRow - 1);
        const double rowLeft = left + (width - rowWidth) * 0.5;
        const double rowTop = top + kRunLootGridY + row * kRunLootPitch;
        for (int i = 0; i < inRow; ++i) {
            const RunLoot& loot = shown[static_cast<std::size_t>(first + i)];
            ItemTile tile;
            tile.petalIndex = loot.petalIndex;
            tile.rarity = loot.rarity;
            if (loot.count > 1) tile.badge = "x" + stackCountText(loot.count);
            tile.timeSeconds = time;
            drawItemTile(canvas, sprites_,
                         Rect{rowLeft + i * kRunLootPitch, rowTop, kRunLootTile, kRunLootTile},
                         tile);
        }
    }
    canvas.setGlobalAlpha(1.0f);
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
    // Only promises the redial when there is one: a socket that was hung up
    // on deliberately is not coming back by itself.
    text(canvas,
         net_.reconnecting() ? "Disconnected from server. Reconnecting..."
                             : "Disconnected from server.",
         canvas.width() * 0.5, 19.0, style);
}

bool App::connectionLost() const {
    // Both halves of a redial: the wait between attempts reports Failed, an
    // attempt in flight reports Connecting. Testing only the first blinked
    // the banner out for the length of every try.
    return net_.status() == NetClient::Status::Failed || net_.reconnecting();
}

} // namespace flix
