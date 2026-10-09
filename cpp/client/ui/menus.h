#pragma once
// The game's menus: inventory, crafting, talents, bestiary, shop, skins,
// leaderboard and settings.
//
// One menu is open at a time. That is a deliberate rule rather than a
// limitation: every panel is anchored to the same place, they overlap, and a
// stack of them would leave the player dragging petals into a panel they
// cannot see. Opening one closes whatever was open, exactly as pressing its
// key again closes it.
//
// The panels are immediate-mode. Each one lays itself out, hit-tests, acts and
// draws in a single pass, so there is no retained widget tree to leave stale
// and no second copy of the layout for the input pass to drift away from. What
// they DO keep between frames is genuinely stateful: a scroll offset, what is
// being dragged, how far an animation has run.

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <memory>

#include "canvas.h"
#include "svg.h"
#include "window.h"

#include "client/net_client.h"
#include "client/render/sprites.h"
#include "client/interpolation.h"
#include "client/render/world_renderer.h"
#include "client/ui/menu_widgets.h"
#include "client/ui/touch_scroll.h"
#include "shared/core/types.h"
#include "shared/game/skills.h"

namespace flix {

namespace ui {
struct ItemTile;
}

/// Opens an external HTTP(S) URL with the host platform. The web build uses
/// window.open directly, keeping Emscripten's SDL shim out of the browser
/// artifact; the desktop build delegates to SDL.
bool openExternalLink(const std::string& url);

/// Which panel is on screen.
///
/// Appended to, never reordered: `ClientSettings::hotkeys` is indexed by this
/// and persists as `key.<index>`, so an insertion in the middle silently
/// rebinds every menu a player has customised.
enum class MenuId : std::uint8_t {
    None = 0,
    Inventory,
    Crafting,
    Talents,
    Gallery,
    Shop,
    Skins,
    Leaderboard,
    Settings,
    Changelog,
    Notifications,
    Guild,
    Debug,
    /// The admin database editor. Opened by `/admin db` and nothing else: it
    /// is on no strip button and its key is unbound and not rebindable.
    AdminDb,
    Count,
};

inline constexpr int kMenuCount = static_cast<int>(MenuId::Count);

/// A rebindable action, in the order the settings panel lists its rows -- the
/// browser's DEFAULT_CONTROLS order.
///
/// Appended to, never reordered: a binding persists as `ctl.<index>`, so an
/// insertion in the middle silently rebinds every action after it.
enum class ControlAction : std::uint8_t {
    MoveUp = 0,
    MoveDown,
    MoveLeft,
    MoveRight,
    Inventory,
    Crafting,
    Skills,
    ToggleMouseControls,
    ToggleHitboxes,
    ToggleDebugMenu,
    ZoomIn,
    ZoomOut,
    Chat,
    ExtendPetals,
    RetractPetals,
    /// Appended, not slotted in beside the loadout: the settings file stores
    /// a binding by this enum's number, so a row inserted mid-list would hand
    /// every later row's saved key to its neighbour.
    SwapLoadoutRows,
    Count,
};

inline constexpr int kControlCount = static_cast<int>(ControlAction::Count);

/// What the settings panel shows for one action, and where its binding lives.
/// `menu` is the panel a row really opens; MenuId::None means there is no menu
/// behind it and the key is kept in ClientSettings::controls.
struct ControlMeta {
    const char* label;
    Key defaultKey;
    MenuId menu;
};

/// The label, default key and menu of an action. Indexed by ControlAction; an
/// action out of range reports an unbound, unlabelled row rather than reading
/// off the end.
const ControlMeta& controlMeta(ControlAction action);

/// keyDown/keyPressed for a BOUND key, which is not quite the same question.
/// The browser spells both shifts, both controls and both alts as one key and
/// binds that; a client that names physical keys has to answer for either half
/// of the pair, or a binding made on one side of the keyboard is dead on the
/// other. An unbound action (Key::Unknown) is never down and never pressed.
bool boundKeyDown(const Window& window, Key key);
bool boundKeyPressed(const Window& window, Key key);

/// The loadout the bar draws: ten primary slots, ten secondary slots under
/// them, and a trash slot at the end of the second row.
///
/// Layout, not capacity: `kLoadoutSlots` is what an account holds and the wire
/// carries, and `kLoadoutActiveSlots` is how many of those are in orbit. A slot
/// past what the account actually holds still draws as an empty one.
inline constexpr int kLoadoutBarPrimary = 10;
inline constexpr int kLoadoutBarSecondary = 10;
inline constexpr int kLoadoutBarSlots = kLoadoutBarPrimary + kLoadoutBarSecondary;
/// Hit-test index of the trash, one past the last real slot.
inline constexpr int kLoadoutTrashSlot = kLoadoutBarSlots;

/// The link the Discord button opens.
inline constexpr const char* kDiscordInvite = "https://discord.gg/SvAYCGsmAg";

/// Slots in the icon strip: ten across the top-left corner, four down the
/// bottom-left one. Two of the top ten open no panel -- Discord is a link and
/// exit leaves the game -- so this is not `kMenuCount`.
inline constexpr int kStripSlotCount = 14;

/// The range ClientSettings::zoom is held to, and how far one press of a zoom
/// key moves it. The step is the browser's own ZOOM_STEP; the range is this
/// client's. The floor is 100%: the wheel and the keys only ever zoom IN.
/// Seeing MORE of the world than the default view is what antennae and
/// observer are for (see loadoutCameraZoom), and a wheel that could scroll
/// out past them -- this client's once reached 0.6, the browser's 0.5 --
/// made the two petals pointless.
inline constexpr double kMinZoom = 1.0;
inline constexpr double kMaxZoom = 1.6;
inline constexpr double kZoomKeyStep = 0.1;

/// The camera multiplier the worn loadout asks for: the smallest cameraZoom
/// over the ACTIVE slots, or 1 when none sets one. Antennae and observer are
/// the petals that do. Not summed and not stacked -- two of them show the
/// better one, exactly as the browser's getEquippedZoomMultiplier did -- and
/// floored at the browser's 0.3 so no tier can invert the camera. Storage
/// grants nothing, the same rule the server applies to the equipment bits.
double loadoutCameraZoom(const Profile& profile, const ContentRegistry& registry);

/// How far the loadout bar reaches up from the bottom edge of an in-game
/// viewport. What anything else anchored to the bottom hangs above -- the bar
/// is centred and already nearly touches the edge, so there is no room under
/// it. Derived from the same constants the bar is laid out from, so it has to
/// be asked about the same shape the bar is drawn in: pass
/// ClientSettings::classicLoadoutBar.
/// `viewWidth` is the viewport's width in design units, which the bar may have
/// had to shrink to fit; 0 asks for the unclamped height.
double inGameLoadoutBarHeight(bool classic = false, double viewWidth = 0.0);

/// Where the title screen's block of control hints starts, as an offset down
/// from the centre of the window. Under whatever the loadout bar paints
/// lowest inside its own box: the secondary row with the classic metrics, the
/// key caps beneath that row with the modern ones. Takes the same flag
/// inGameLoadoutBarHeight does, and for the same reason.
double titleHintsOffsetY(bool classic = false);

/// The highest the title screen's loadout bar paints, as an offset down from
/// the centre of the window: the primary row's top edge with the modern
/// metrics, the key caps above that row with the classic ones. What the XP
/// gauge over the bar has to clear.
double titleLoadoutTopY(bool classic = false);

/// Everything the settings menu owns. Kept in one struct so it can be written
/// to disk and read back as a unit, and so nothing else has to know which of
/// these the renderer reads and which the input layer does.
struct ClientSettings {
    WorldRenderer::Options render;
    /// Player-chosen camera zoom, multiplied into whatever the loadout asks
    /// for. Persisted, because it is a comfort setting, not a game state.
    double zoom = 1.0;
    /// How much of the gap between a drawn position and the authoritative one
    /// is closed per frame at 60 fps -- the smoothness/latency trade for every
    /// flower, petal, drop and mob facing. The browser build keeps the same
    /// number in `localStorage.interpolationAmount`. See client/interpolation.h.
    double interpolation = kDefaultInterpolationAmount;
    /// The fraction of the display's native resolution the frame is
    /// rasterised at, 0.25 to 1. The browser build keeps the same number in
    /// `localStorage.renderScale`; here it reaches Window::setRenderScale,
    /// which is the whole of its effect -- nothing moves or resizes, the
    /// picture just gets softer and the rasteriser gets cheaper. It earns its
    /// place on a HiDPI display, where 1 means filling four times the pixels
    /// a non-Retina panel would ask for.
    double renderScale = 1.0;
    /// Browser only: draws into a low-latency (`desynchronized`) canvas, which
    /// can cut a frame of input lag but can also show a frame half drawn.
    /// Off by default because of that flicker. Reaches
    /// Window::setDesynchronized the way renderScale reaches setRenderScale.
    bool desynchronizedCanvas = false;
    bool showChat = true;
    /// Which of the chat box's channel tabs its transcript shows, one bit per
    /// tab in strip order: Local, Global, Squad, Guild, Whisper. All on by
    /// default. The server's own lines belong to no tab and always show.
    std::uint8_t chatChannels = 0x3F;
    bool showMenuBar = true;
    /// The frame/ping/position readout in the bottom-right corner. Off by
    /// default, and the browser build keeps the same flag in
    /// `localStorage.showStats`.
    bool showStats = false;
    /// Shows the grey bug button in the top strip, which is the only way into
    /// the debug panel. Off by default, exactly as `debugMenuEnabled` is.
    bool showDebugButton = false;
    /// Asks the leaderboard to rank admin accounts too, which the server
    /// otherwise leaves off. Off by default; the browser keeps the same flag
    /// in `localStorage.showAdminsOnLeaderboard`.
    bool showAdminsOnLeaderboard = false;
    /// How many changelog releases the player had already seen the last time
    /// they opened the panel. The browser keeps the same number in
    /// `localStorage.lastSeenChangelogCount`, and shakes the strip's changelog
    /// button for as long as the changelog holds more entries than this.
    int changelogSeen = 0;
    /// Which notifications the player has already read. The browser keeps the
    /// same set in `localStorage['game_notifications_read']`; there is no such
    /// store here, so it rides in the settings file. Server ids carry no
    /// whitespace, which is what lets them share this file's key/value lines.
    std::vector<std::string> readNotifications;
    /// The key that opens each menu, indexed by MenuId.
    std::array<Key, kMenuCount> hotkeys{};
    /// The key bound to every other action, indexed by ControlAction. The four
    /// menu-backed actions live in `hotkeys` instead, because that is what
    /// MenuSystem opens a panel from, and their slots here are never read:
    /// controlKey/bindControl are what hide which action is kept where.
    std::array<Key, kControlCount> controls{};
    /// Whether the flower follows the cursor. Off leaves movement to the four
    /// movement keys alone; aim follows the pointer either way. The browser
    /// keeps the same flag in `localStorage.useMouseControls` and defaults it
    /// off, where this client defaults it ON: cursor-following is the control
    /// scheme it has always shipped with, and defaulting to the browser's
    /// value would take it away from every existing player.
    bool useMouseControls = true;
    /// Draws the loadout bar the way this client used to: three-quarter-size
    /// slots, the browser port's wide gaps, and the number captions above the
    /// top row. Off by default -- the bar's own shape now follows the
    /// reference game's, which is bigger, tighter and captioned underneath.
    bool classicLoadoutBar = false;
    /// Whether the on-screen touch controls are up: the stick, and the two
    /// buttons that stand in for the extend/retract keys. The browser keeps
    /// the same flag in `localStorage.requestMobile`, and resolves an unset
    /// one from `(pointer: coarse)` -- a phone gets them without being asked,
    /// and a desktop does not. `requestMobileChosen` is that "unset": until
    /// the player has said either way, the answer is the device's.
    bool requestMobile = false;
    bool requestMobileChosen = false;
    /// The spawn point the player last chose to start at -- one of the ids in
    /// WorldMaps::spawnChoices(), or "pvp"/"maze". Empty is the server's
    /// default. Remembered because it is a preference, not a game state.
    std::string spawnChoice;
    /// Whether the eleven-step tutorial has been finished or skipped, and how
    /// far it had got. The browser keeps the same pair in localStorage as
    /// `tutorial_completed` and `tutorial_step`; they ride here so this client
    /// has one settings file rather than a second store beside it.
    ///
    /// Only the first is ever read back. See ui::Tutorial::beginGame for why
    /// the reference's own resume is dead and this one matches it.
    bool tutorialCompleted = false;
    int tutorialStep = 0;

    ClientSettings();

    /// The touch controls, resolved for a device that answers `coarse` to the
    /// pointer query. A player's own choice wins; before they have made one,
    /// a touchscreen gets the controls and a desktop does not.
    bool touchControlsWanted(bool coarsePointer) const {
        return requestMobileChosen ? requestMobile : coarsePointer;
    }

    /// The key bound to an action, wherever that binding is kept.
    Key controlKey(ControlAction action) const;
    /// Binds a key to an action. A key already opening some OTHER menu is
    /// taken from it rather than the rebind being refused: two menus on one
    /// key is the only broken state, and telling the player off for it is
    /// worse than just moving it.
    void bindControl(ControlAction action, Key key);

    bool load(const std::string& path);
    bool save(const std::string& path) const;
};

/// What the player is currently dragging, if anything.
///
/// Owned by the menu system rather than by the inventory panel: a drag starts
/// in one panel and ends on the loadout bar, which is not a panel at all, and
/// the two must not each keep half of it.
struct DragState {
    enum class Source : std::uint8_t { None, Inventory, LoadoutSlot };
    Source source = Source::None;
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    int slot = -1;              ///< the loadout slot a LoadoutSlot drag left
    bool active() const { return source != Source::None; }
    void clear() { *this = DragState{}; }
};

/// One frame of everything a panel is allowed to touch.
/// What the debug panel's Profiling tab shows.
///
/// The frame cost of this client is very nearly the number of drawing calls it
/// makes times what the browser charges for each, so the question a slow frame
/// raises is always "which code is making them". The app fills this in once a
/// second -- the same rolling window the rest of the counters use, because a
/// per-frame readout jitters too much to read.
struct ProfilingStats {
    /// Whether the app filled this in at all. The native build does not.
    bool available = false;
    int opsPerFrame = 0;
    int batches = 0;
    /// What the browser spent consuming the op stream, against what the whole
    /// frame cost. The difference is the client's own arithmetic.
    double browserAvgMillis = 0;
    double browserPeakMillis = 0;
    double frameMillis = 0;
    /// Ops by the part of the frame that made them.
    int world = 0, hud = 0, panels = 0, other = 0;
    int menuBar = 0, menuStrip = 0, menuPanel = 0;
    /// Bitmaps the art cache holds, and what they occupy.
    std::size_t bakedEntries = 0;
    std::size_t bakedBytes = 0;
    /// Text runs the atlas holds, and how many it baked this frame. A screen
    /// that keeps baking is one whose text never repeats a key -- a zoom, a
    /// working set bigger than the atlas -- and is drawing it live.
    std::size_t textRuns = 0;
    int textBaked = 0;
    /// Ops by kind of call, indexed by canvas op code. See canvasOpName().
    std::array<int, kCanvasOpCodes> byType{};
};

struct MenuContext {
    Canvas& canvas;
    Window& window;
    NetClient& net;
    const SpriteCache& sprites;
    /// Used only by the skins menu, to preview a cosmetic with the very same
    /// body the world renders.
    const WorldRenderer& renderer;
    ClientSettings& settings;
    DragState& drag;
    double timeSeconds = 0;
    double dt = 0;
    /// The panel's card, already anchored -- and already offset downwards by
    /// however much of its opening slide is still to run, so everything a
    /// panel derives from this rides along with it.
    Rect bounds;
    /// Set by a panel whose text field has focus, so the chat box and the
    /// login form do not also consume this frame's keystrokes.
    bool wantsText = false;
    /// Set by the settings panel's Log Out button. Ending a session is the
    /// app's business -- it owns the stored token and the screen -- so the
    /// panel only says that it was asked for.
    bool logoutRequested = false;
    /// Whether this build can make its own player an admin, which is true of
    /// the offline page and nothing else -- see AppConfig::grantAdmin. The
    /// settings panel draws its Grant Admin row only when this is set.
    bool adminGrantOffered = false;
    /// Set by that row, and read the way the logout request is: the grant
    /// itself belongs to whoever owns the server, which is never a panel.
    bool adminGrantRequested = false;
    /// The debug panel's Profiling tab reads this. Null on a build that does
    /// not gather it.
    const ProfilingStats* profiling = nullptr;

    Vec2 mouse() const { return {window.mouseX(), window.mouseY()}; }
    bool over(Rect r) const { return r.contains(mouse()); }
    bool pressed() const { return window.mousePressed(MouseButton::Left); }
    bool released() const { return window.mouseReleased(MouseButton::Left); }
    /// A click that both began and ended inside `r`. Press-and-release is what
    /// separates a click from the end of a drag that happens to land here.
    bool clicked(Rect r) const { return released() && over(r); }
    float wheel() const { return window.wheelDelta(); }
};

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/// The petal inventory: every stack the account owns, grouped by tier.
class InventoryPanel {
public:
    /// Returns false when the panel asked to be closed.
    bool render(MenuContext&);
    void reset();

    /// The panel's natural width: five cells and their gaps, plus padding.
    static double preferredWidth();
    /// Where the card hangs in a view of this size. Defined in menus.cpp with
    /// the rest of the panel geometry, so the anchors can be read side by side.
    static Rect bounds(int viewWidth, int viewHeight);

private:

    ui::Scroller scroll_;
    /// One slot per item TYPE at its best tier, instead of one per tier.
    bool stacked_ = false;
    double stackLerp_ = 0;
    std::string search_;
    ui::TextFieldState searchField_;
};

// ---------------------------------------------------------------------------
// The slot card
// ---------------------------------------------------------------------------
//
// The craft key opens one of four cards -- the forge's, or the oracle's, the
// trader's or the titan's while the flower stands at one -- and the four are
// ONE card, laid out against the reference trade shot
// (After-trade_trade_menu.webp), which the oracle's reference matches to the
// unit: a title and a close button; a slot left of the centre line and the
// action button right of it; one line of text; and a grid of everything the
// account owns, a row a petal and a column a tier. What differs is the skin,
// the words, whether the grid runs on to apex (only the trader's: nothing
// crafts out of apex), what a cell says, and what stands where the slot is --
// the forge and the titan turn a ring of five about the slot's centre where
// the other two hold one petal.
//
// These are the pieces they share (menu_slot_card.cpp). Each panel keeps its
// own staging, its own animation and its own input: that is what makes them
// four menus rather than one. The titan's card is the same card cut down:
// eight grid columns wide, and only as tall as one row of its grid, under
// three lines of text instead of one.

/// The slot's side, and the size the oracle and the trader draw what is in it.
inline constexpr double kSlotCardSlot = 70.0;
/// A refusal under the slot, and the line while an NPC's wait runs.
inline constexpr std::uint32_t kSlotCardRefusalInk = 0xFF6B6Bu;
inline constexpr std::uint32_t kSlotCardWaitInk = 0xED706Bu;
/// Every label on the card is outlined at 60%, a visibly lighter weight than
/// the solid outline most panels use.
inline constexpr double kSlotCardLabelStroke = 0.6;

/// Where everything on a slot card is this frame. Derived from the card's rect,
/// so a card still sliding up carries all of it along.
struct SlotCardLayout {
    Rect panel;
    Rect close;
    /// The card's centre line.
    double centreX = 0;
    /// The slot's centre, and the slot: 101 left of the centre line.
    Vec2 slot;
    Rect slotRect;
    /// The action button, 129 right of the centre line.
    Rect button;
    /// The middle of the line of text.
    double lineY = 0;
};

/// The card's width -- its grid's, one column a tier through unique, or on
/// through apex when `withApex` -- and its height, the reference card's.
double slotCardWidth(bool withApex);
/// The width of a card whose grid is `columns` cells across.
double slotCardColumnsWidth(std::size_t columns);
double slotCardHeight();
/// Where a slot card stands: on the list panels' left inset and bottom edge,
/// reaching up its own height, and stopping short of the HUD in the top-left
/// corner on a window too short for all of it.
Rect slotCardBounds(bool withApex, int viewWidth, int viewHeight);
/// The same for a card of any size: the titan's is shorter and narrower.
Rect slotCardBounds(double width, double height, int viewWidth, int viewHeight);

/// Draws the card, its title and its close button, and lays out the rest.
SlotCardLayout drawSlotCard(Canvas&, Rect panel, const ui::PanelSkin&, const char* title,
                            Vec2 mouse);
/// A slot's plate: flat in the skin's border colour, so an empty slot reads as
/// a place to put something rather than as a hole in the card.
void drawSlotPlate(Canvas&, const SpriteCache&, Rect, const ui::PanelSkin&);
/// `tile` in a square of `side` centred on `centre`, turned by `rotation`. The
/// transform is set before the tile opens a path and restored after it closes
/// the last, so both canvas backends see the same geometry.
void drawSlotTile(Canvas&, const SpriteCache&, Vec2 centre, double side, double rotation,
                  const ui::ItemTile&);
/// The action button: the reference's grey pill at rest, and `tint` -- a
/// rarity's colour -- once there is something to act on.
void drawSlotButton(Canvas&, Rect, const char* label, std::optional<std::uint32_t> tint,
                    bool hovered);
/// The one line of text, in the labels' white or in `ink`.
void drawSlotLine(Canvas&, const SlotCardLayout&, const std::string& text,
                  std::optional<std::uint32_t> ink = std::nullopt);
/// Why an NPC said no, under the slot, where the player is looking.
void drawSlotRefusal(Canvas&, const SlotCardLayout&, const std::string& text);

/// What one cell of the grid says, as its panel decides it.
struct SlotCell {
    /// How many the cell shows as held: the account's stack, less whatever the
    /// panel has staged out of it. Zero draws the flat empty square.
    std::uint32_t count = 0;
    std::string badge;
    /// For a label longer than a count, hung past the tile's corner.
    bool badgeCentred = false;
    /// On a grey plate, and not clickable.
    bool greyed = false;
};

/// The grid under the line: a row for every petal type the account owns --
/// from the UNDEDUCTED profile, so a stack staged down to nothing keeps its
/// row and nothing reflows under the cursor mid-click -- and a column for
/// every tier, whether or not the account holds one, so the grid says what the
/// card is for on a fresh account too.
class SlotGrid {
public:
    struct Pick {
        std::uint16_t petalIndex = kNoPetal;
        Rarity rarity = Rarity::Common;
    };

    void reset() { scroll_ = {}; }
    /// Scrolls, draws, and returns the cell under the cursor when `look` left
    /// it clickable -- held, and not greyed.
    std::optional<Pick> render(
        MenuContext&, const SlotCardLayout&, const ui::PanelSkin&, bool withApex,
        const std::function<SlotCell(std::uint16_t petalIndex, Rarity, std::uint32_t owned)>& look);

private:
    ui::Scroller scroll_;
};

/// The titan's grid: a cell for every petal type the account holds at ONE
/// tier -- from the undeducted profile, as SlotGrid's rows are -- `columns`
/// to a row, each row centred where SlotGrid's columns would stand, and
/// scrolling a row at a time from `top` (measured from the card's top) to the
/// card's bottom border.
class SlotTierGrid {
public:
    /// The held cell under the cursor. A greyed one is reported too -- the
    /// titan still names who holds it -- but it is never drawn hovered.
    struct Pick {
        std::uint16_t petalIndex = kNoPetal;
        bool greyed = false;
    };

    void reset() { scroll_ = {}; }
    /// Scrolls, draws, and returns the held cell under the cursor, if any.
    std::optional<Pick> render(
        MenuContext&, const SlotCardLayout&, const ui::PanelSkin&, Rarity tier,
        std::size_t columns, double top,
        const std::function<SlotCell(std::uint16_t petalIndex, std::uint32_t owned)>& look);

private:
    ui::Scroller scroll_;
};

/// What the oracle and the trader play in their slot when something arrives:
/// loot's own landing -- the tile slides in from a drop's distance, unwinding
/// a drop's spin -- with twice a drop's burst of its tier's grains, and the
/// shimmer a drop throws, for the oracle's pulse to build.
class SlotFlourish {
public:
    void clear();
    /// Starts a landing at `now`, bursting in `rarity`'s colour.
    void land(double now, Rarity rarity);
    /// `rate` grains a second of shimmer for the next `dt`, carried between
    /// frames so the rate does not depend on how long a frame was.
    void shimmer(Rarity rarity, double rate, double dt);
    /// Steps the grains by `dt` and paints them under the slot, clipped to the
    /// card: a burst is the card's, not the world's.
    void drawGrains(Canvas&, Rect panel, Vec2 slotCentre, double dt);
    /// Draws `tile` where the landing started at `land` has it by `now`, at
    /// `side`.
    void drawLanded(Canvas&, const SpriteCache&, Vec2 slotCentre, double side, double now,
                    const ui::ItemTile&) const;

private:
    struct Grain {
        Vec2 position;
        Vec2 velocity;
        double lifeSeconds = 0;
        double maxLifeSeconds = 1;
        double size = 0;
        double rotation = 0;
        std::uint32_t color = 0xFFFFFFu;
    };

    void throwGrains(Rarity rarity, int count, double speed, double speedSpread, double lifeMs,
                     double lifeSpreadMs, double size, double sizeSpread);

    std::vector<Grain> grains_;
    double grainCredit_ = 0;
    double landStarted_ = 0;
    Vec2 landFrom_;
    double landSpin_ = 0;
};

/// The forge: five slots in a ring turned about where the other cards hold
/// their one, and the grid that feeds them.
class CraftingPanel {
public:
    bool render(MenuContext&);
    void reset();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    enum class Phase : std::uint8_t { Idle, Spinning, Result };

    /// Adds up to one more batch of this petal to the staging area.
    void stage(const Profile&, std::uint16_t petalIndex, Rarity rarity, bool wholeStack);

    SlotGrid grid_;
    /// What is staged. A craft consumes five at a time; `batches` is how many
    /// fives are queued, which is what the slot badge counts.
    std::uint16_t stagedPetal_ = kNoPetal;
    Rarity stagedRarity_ = Rarity::Common;
    int batches_ = 0;

    Phase phase_ = Phase::Idle;
    double phaseStarted_ = 0;
    double spinAngle_ = 0;
    /// How far the ring is drawn in toward its centre, 0 apart and 1 merged.
    /// The five breathe in and out under the turn and then clamp together for
    /// the combine; see kPullDepth and kMergeDepth.
    double ringPull_ = 0;
    /// What the ring is animating. The whole staging area goes to the server
    /// on the click, so `staged*` is empty for the whole spin and the ring
    /// needs its own copy of what was sent -- which is also what the result
    /// card is compared against.
    std::uint16_t spinPetal_ = kNoPetal;
    Rarity spinRarity_ = Rarity::Common;
    /// A result that landed before the ring finished turning, held until it
    /// does. The server answers a craft in well under a frame on a local
    /// socket, so applying an outcome the moment it arrives skipped the spin
    /// entirely -- the ring jumped straight to the result card.
    bool resultPending_ = false;
    bool lastSuccess_ = false;
    std::uint16_t resultPetal_ = kNoPetal;
    Rarity resultRarity_ = Rarity::Common;
    /// How many upgrades the pool produced, for the result caption.
    int resultCount_ = 0;
    /// How many of the five survived a failure, for the slots to keep drawing.
    int survivors_ = 0;
};

/// The oracle: what the craft card becomes while the flower stands at an
/// oracle NPC.
///
/// One slot where the forge has five, every cell labelled "owned/price" where
/// the forge counts a stack, and an upgrade that arrives the way loot does --
/// the staged petal breathes like a drop on the ground, swells while the
/// oracle works, and the upgrade lands in the slot with a drop's flourish. One
/// upgrade per craft and one craft per half hour: while the account waits,
/// the line counts the minutes down in red and nothing can be staged. See
/// menu_oracle.cpp.
class OraclePanel {
public:
    bool render(MenuContext&);
    void reset();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    enum class Phase : std::uint8_t { Idle, Pulsing, Result };

    /// Puts one upgrade's price of this petal in the slot, replacing whatever
    /// was there: the oracle sells one upgrade per craft.
    void stage(const Profile&, std::uint16_t petalIndex, Rarity rarity);

    SlotGrid grid_;
    SlotFlourish flourish_;
    std::uint16_t stagedPetal_ = kNoPetal;
    Rarity stagedRarity_ = Rarity::Common;
    /// 1 while something is staged, 0 when the slot is empty: the oracle sells
    /// one upgrade per craft, at oracleCraftCost().
    int crafts_ = 0;

    Phase phase_ = Phase::Idle;
    double phaseStarted_ = 0;
    /// What went to the oracle on the click. The staging area is emptied at
    /// once -- the petals are the server's now -- so the pulse draws this, and
    /// a refusal puts it back.
    std::uint16_t offeredPetal_ = kNoPetal;
    Rarity offeredRarity_ = Rarity::Common;
    int offeredCrafts_ = 0;
    /// A result that arrived before the pulse had run its course.
    bool resultPending_ = false;
    std::uint16_t resultPetal_ = kNoPetal;
    Rarity resultRarity_ = Rarity::Common;
    int resultCount_ = 0;
    /// Why the oracle said no, shown under the slot until it expires.
    std::string refusal_;
    double refusalUntil_ = 0;
};

/// The trader: what the craft card becomes while the flower stands at a
/// trader NPC.
///
/// One petal in the slot, a Trade button, and a grid of every stack the
/// account owns at every tier, apex included: any petal petals.json does not
/// mark untradable goes for one coin of its own tier, and the coin lands in
/// the slot the way loot lands on the ground. One trade a day: while the
/// account waits, the line counts the hours down in red and every stack sits
/// on grey. See menu_trade.cpp.
class TradePanel {
public:
    bool render(MenuContext&);
    void reset();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    /// Trading: the petal has gone to the server and the slot is showing it
    /// until the answer comes back.
    enum class Phase : std::uint8_t { Idle, Trading, Result };

    SlotGrid grid_;
    SlotFlourish flourish_;
    /// The petal in the slot: one of it, which is what one trade takes.
    std::uint16_t stagedPetal_ = kNoPetal;
    Rarity stagedRarity_ = Rarity::Common;

    Phase phase_ = Phase::Idle;
    double phaseStarted_ = 0;
    /// What went to the trader on the click. The slot is emptied at once --
    /// the petal is the server's now -- so this is drawn while the trade is
    /// out, and a refusal puts it back.
    std::uint16_t offeredPetal_ = kNoPetal;
    Rarity offeredRarity_ = Rarity::Common;
    /// What came back: the coin, at the offer's tier.
    std::uint16_t resultPetal_ = kNoPetal;
    Rarity resultRarity_ = Rarity::Common;
    /// Why the trader said no, shown under the slot until it expires.
    std::string refusal_;
    double refusalUntil_ = 0;
};

/// The titan: what the craft card becomes while the flower stands at the
/// titan NPC -- the universal forge.
///
/// The forge's ring of five, set the way florr's own forge sets it (a
/// pentagon, point up, of full-size slots), a Forge button, three lines on
/// what a universal costs its last holder, and one row of every petal the
/// account holds at apex -- greyed until there are five to forge. Five apex in,
/// one universal out, never a roll: the ring closes in on itself and the
/// universal lands in its middle the way loot lands. See menu_titan.cpp.
class TitanPanel {
public:
    bool render(MenuContext&);
    void reset();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    /// Forging: the five have gone to the server and the ring is closing on
    /// them until the answer comes back.
    enum class Phase : std::uint8_t { Idle, Forging, Result };

    SlotTierGrid grid_;
    SlotFlourish flourish_;
    /// The petal in the ring: five of it at apex, which is what one forge
    /// takes, or kNoPetal for an empty ring.
    std::uint16_t stagedPetal_ = kNoPetal;

    Phase phase_ = Phase::Idle;
    double phaseStarted_ = 0;
    /// What went to the titan on the click. The ring is emptied at once --
    /// the petals are the server's now -- so this is drawn while the forge is
    /// out, and a refusal puts it back.
    std::uint16_t offeredPetal_ = kNoPetal;
    /// What came back: one universal of it.
    std::uint16_t resultPetal_ = kNoPetal;
    /// A result that arrived before the ring had finished closing.
    bool resultPending_ = false;
    /// Why the titan said no, shown in place of the card's lines until it
    /// expires.
    std::string refusal_;
    double refusalUntil_ = 0;
    /// The petal last picked out of the grid, staged or grey, which the
    /// titan is asked about -- who holds it at universal -- and when it was
    /// last asked, so a query the server dropped is asked again.
    std::uint16_t askedPetal_ = kNoPetal;
    double askedAt_ = -1.0;
};

/// The bestiary: every mob at every tier it can appear at, and what the
/// account has actually killed.
class GalleryPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static double preferredHeight();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    ui::Scroller scroll_;
};

/// The talent tree.
class TalentsPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    struct Node {
        SkillId skill = SkillId::Damage;
        int tier = 0;
        /// Position in the tree's own space, before rotation.
        Vec2 local;
        Vec2 screen;
    };

    void layout();

    std::vector<Node> nodes_;
    bool laidOut_ = false;
    /// How far the card has slid up into place, 0 to 1. The panel opens by
    /// animating this rather than by appearing where it belongs.
    double openLerp_ = 0;
    /// Dragging anywhere in the card spins the whole fan about the flower.
    double rotation_ = 0;
    bool dragging_ = false;
    /// Where the press landed, and which node it landed on. Both outlive the
    /// press because a press is still a click until it travels far enough to
    /// become a spin, and the click belongs to the node it started on.
    Vec2 dragPress_;
    int pressedNode_ = -1;
    /// Latched the moment the press clears the drag threshold: a gesture that
    /// has become a spin stays one, even if the cursor comes back to where it
    /// started.
    bool dragMoved_ = false;
    double rotationAtAnchor_ = 0;
    /// Guards the reset button behind a second click.
    bool confirmingReset_ = false;
};

/// The star shop: the store's ten offers, the challenges that pay the stars to
/// buy them with, and the code redeemer. An overlay under the top icon row,
/// not one of the tall lists -- its grid is a fixed two rows of five and has
/// nothing to gain from a two-thirds-of-the-viewport card.
class ShopPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    /// Fixed, like every other overlay's: the header, the tab row and two rows
    /// of offer cards come to this and no window makes them taller.
    static double preferredHeight();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    enum class Tab : std::uint8_t { Offers, Challenges, Bonus };
    Tab tab_ = Tab::Offers;
    ui::Scroller scroll_;
};

/// Cosmetic flower skins.
class SkinsPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    /// Taller than the other corner overlays: this is the only one that has to
    /// show a drawing board, a shape list and that shape's properties at once.
    static double preferredHeight();
    static Rect bounds(int viewWidth, int viewHeight);
};

/// Account rankings, straight from the server.
class LeaderboardPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    ui::Scroller scroll_;
    bool requested_ = false;
};

/// Display switches, camera zoom and the menu keys.
class SettingsPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

    /// True while waiting for a key to bind. The app must not treat that
    /// keystroke as a hotkey.
    bool capturingKey() const { return rebinding_ >= 0; }

private:
    ui::Scroller scroll_;
    int rebinding_ = -1;
};

/// The release notes, newest first. Pinned under the top icon row rather than
/// beside the bottom column: it is an overlay, not one of the tall lists.
class ChangelogPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    ui::Scroller scroll_;
};

/// Server notices, invites and rewards.
class NotificationsPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    ui::Scroller scroll_;
};

/// How many of the loaded notifications the player has not read, for the badge
/// on the strip's notifications button. The browser counts the same thing the
/// same way -- what it has FETCHED, against localStorage -- so a feed whose
/// older pages were never asked for contributes nothing to the number.
///
/// Lives with the panel because the panel owns the read marks' lookup set, and
/// two mirrors of one list is one more thing to keep true.
int notificationsUnread(const NetClient&, const ClientSettings&);

/// How many entries one page of the feed asks for. The browser's page size,
/// and the number the server compares against to decide whether there is an
/// older page -- so the panel and the badge's first fetch must both use it.
inline constexpr int kNotificationPage = 50;

/// The player's guild: its roster, and the join/create form when they have none.
class GuildPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

private:
    ui::Scroller scroll_;
};

/// Frame time and memory graphs, client and server. Reachable only while the
/// settings switch that puts the bug button in the strip is on.
class DebugPanel {
public:
    /// Which half of the panel is showing. Graphs are the history of a few
    /// whole-system numbers; Profiling is this frame's drawing broken down.
    enum class Tab { Graphs, Profiling };

    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static Rect bounds(int viewWidth, int viewHeight);

    /// One frame of client samples, and any server packet that has arrived.
    ///
    /// Called every frame whether or not the panel is open, which is the
    /// browser's own arrangement: recordClientFrame runs from the render loop
    /// and the debugStats handler from the socket, so the graphs already hold
    /// two minutes of history the moment the panel is opened.
    void recordFrame(double dtSeconds, NetClient&);

private:
    /// One sample per second, so a graph holds about two minutes -- the same
    /// window the browser panel keeps.
    static constexpr int kHistory = 120;

    std::vector<double> clientFrameMillis_;
    std::vector<double> clientMemoryMB_;
    std::vector<double> serverTickAvgMillis_;
    std::vector<double> serverTickMaxMillis_;
    std::vector<double> serverHeapMB_;
    std::vector<double> serverResidentMB_;
    /// Until the first packet the server graphs say so rather than drawing a
    /// flat zero, which would read as a server that costs nothing.
    bool haveServerStats_ = false;

    Tab tab_ = Tab::Graphs;
    /// Which column the op-type table is ordered by. Count is the useful one
    /// by default; by name is for finding a particular call.
    bool sortByName_ = false;

    double sampleAge_ = 0;
    double sampleTotal_ = 0;
    int sampleCount_ = 0;

    bool drawGraphsTab(MenuContext&, Rect body);
    void drawProfilingTab(MenuContext&, Rect body);

    /// One series on one graph.
    struct Series {
        const std::vector<double>* values;
        std::uint32_t colour;
    };
    /// One labelled block: caption left, value right, plot below. `lines` are
    /// drawn on a shared auto-scaled axis with the newest sample against the
    /// right edge, and the LAST of them tints the value text -- which is what
    /// lets a two-line graph read without a legend.
    static void drawGraph(Canvas&, Rect plot, const std::string& label,
                          const std::string& value, const std::vector<Series>& lines,
                          const char* unit);
};

/// The admin database editor: accounts and the raw tables, as trees to read
/// and edit. Only ever opened by the server's answer to `/admin db`, which a
/// database-flagged admin gets and nobody else does; the server checks every
/// request again. Its state lives in menu_admin_db.cpp, at file scope, as the
/// guild panel's dialog does.
class AdminDbPanel {
public:
    bool render(MenuContext&);
    void reset();
    static double preferredWidth();
    static double preferredHeight();
    static Rect bounds(int viewWidth, int viewHeight);
};

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

class MenuSystem {
public:
    /// Handles the menu hotkeys, Escape among them. Returns true when the key
    /// was consumed, so the game does not also act on it.
    bool handleKeys(Window&);

    /// True while the client is in a game, which is the only time the exit
    /// button is offered -- and the only time the changelog and Discord
    /// buttons are not.
    ///
    /// The screen owns the loadout bar's slide: the browser builds a fresh
    /// `CanvasLoadoutBar` per screen, so crossing between them replays the
    /// rise rather than leaving the bar already seated from last time.
    void setInGame(bool inGame) {
        if (inGame == inGame_) return;
        inGame_ = inGame;
        loadoutSlide_ = 0.0;
        // Its button is gone in game, so a changelog still open from the title
        // screen would be a card with nothing on screen that opened it.
        if (inGame_ && open_ == MenuId::Changelog) close();
    }
    /// Set when the exit button was clicked. The app reads and clears it --
    /// leaving a game is the app's business, not a menu's.
    bool takeExitRequest() {
        const bool requested = exitRequested_;
        exitRequested_ = false;
        return requested;
    }
    bool adminDashboardOpen = false;
    Rect adminDashboardBounds{};
    Rect adminDashboardButton{};

    /// Set when Settings' Log Out was clicked, read and cleared by the app the
    /// same way the exit request is.
    bool takeLogoutRequest() {
        const bool requested = logoutRequested_;
        logoutRequested_ = false;
        return requested;
    }

    /// Whether Settings offers its Grant Admin row. Off unless the app says
    /// otherwise, so a client with no way to grant one draws no button.
    void setAdminGrantOffered(bool offered) { adminGrantOffered_ = offered; }

    /// Set when that row was clicked, read and cleared like the two above.
    bool takeAdminGrantRequest() {
        const bool requested = adminGrantRequested_;
        adminGrantRequested_ = false;
        return requested;
    }

    /// Anything the caller needs painted between the icon strip and the
    /// loadout bar. In game that gap is the death card's: it goes over the
    /// strip and the HUD but under the bar, and there is no other seam in this
    /// call it could be dropped into.
    using OverlayFn = std::function<void()>;

    /// One frame of every menu: the open card, the loadout bar, the icon strip
    /// and the dragged petal. The four of them do not have one fixed order --
    /// see `PanelLayer` for which card is painted where, and note that the bar
    /// and the strip themselves trade places between the two screens.
    void render(Canvas&, Window&, NetClient&, const SpriteCache&, const WorldRenderer&,
                double timeSeconds, double dt, const OverlayFn& overStripUnderBar = {});

    /// The icon strip on its own, for the login screen: the browser paints the
    /// strip over the auth form, but there is no account yet for a panel to
    /// read and no loadout for the bar to draw.
    void renderStripOnly(Canvas&, Window&, double timeSeconds);

    void toggle(MenuId);
    void close();
    MenuId open() const { return open_; }
    bool anyOpen() const { return open_ != MenuId::None || adminDashboardOpen; }

    /// True when the cursor is over menu furniture, so the game must not treat
    /// the click as aiming or the wheel as a zoom.
    bool capturesMouse(Vec2 mouse) const;

    /// How far in from the left edge the HUD must start to clear the icon
    /// strips: the width of the top row, and of the bottom column. The HUD asks
    /// rather than the strips reserving, because only the HUD knows which of
    /// its pieces can move.
    ///
    /// The top row is eight buttons wide in game, so `reservedTop()` is most of
    /// the screen: the browser build clears it by dropping BELOW the row, not
    /// by moving right. `stripBottom()` is the y to use for that.
    double reservedTop() const;
    double reservedLeft() const;
    /// The first y below the top icon row, strip inset included.
    double stripBottom() const;

    /// How many releases the changelog holds. That, against what the player
    /// has already seen, is the whole of the browser's unread rule
    /// (`CHANGELOG.length > lastSeenChangelogCount`), and opening the panel is
    /// what writes the count back -- the same gesture, not a separate
    /// acknowledgement.
    ///
    /// One rather than zero by default, so a player who has never opened the
    /// panel is told there is something in it even before whoever owns the
    /// changelog table has reported its size.
    void setChangelogEntryCount(int count) { changelogEntries_ = count < 1 ? 1 : count; }
    /// True while the strip's changelog button should shake.
    bool changelogUnread() const { return changelogEntries_ > settings_.changelogSeen; }

    /// True while a settings row is waiting for a key.
    bool capturingKey() const { return settings_panel_.capturingKey(); }

    /// The service of the NPC the player's flower is standing at, or None.
    /// The app measures it every frame; the craft panel reads it to decide
    /// whether it is the forge, the oracle or the trader this frame.
    void setNearbyNpc(NpcService service) { nearbyNpc_ = service; }
    NpcService nearbyNpc() const { return nearbyNpc_; }
    /// The craft menu's card for a `w` x `h` view as it stands this frame: the
    /// forge's, or the oracle's or the trader's while the flower is at one.
    Rect craftPanelBounds(int w, int h) const;

    /// Feeds the debug panel one frame of samples. See DebugPanel::recordFrame
    /// for why this is not done inside render().
    void recordDebugSample(double dtSeconds, NetClient& net) {
        debug_.recordFrame(dtSeconds, net);
    }

    ClientSettings& settings() { return settings_; }
    const ClientSettings& settings() const { return settings_; }

    /// The chat box and the login form both take typed text; the menus must
    /// not also eat it. Panels with a text field set this while focused.
    bool wantsText() const { return wantsText_; }
    void setWantsText(bool wants) { wantsText_ = wants; }

    /// Drawing calls the menu layer made since this was last called, split by
    /// which of its three unrelated jobs made them. One figure for the lot
    /// cannot say which to make quieter, and the bar is redrawn every frame
    /// from artwork that changes only when the loadout does.
    struct OpCounts {
        int strip = 0;
        int bar = 0;
        int panel = 0;
    };
    OpCounts takeOpCounts();

    /// Where the debug panel's Profiling tab reads its figures from. The app
    /// owns them -- they span the whole frame, not just the menus -- so it
    /// lends the panel a pointer rather than the menus gathering a copy.
    void setProfiling(const ProfilingStats* stats) { profiling_ = stats; }

private:
    const ProfilingStats* profiling_ = nullptr;
    static int canvasOpsMark();
    int opsStrip_ = 0;
    int opsBar_ = 0;
    int opsPanel_ = 0;

    /// One slot of the icon strip. The strip is not a projection of MenuId:
    /// two of its buttons open no panel at all, and the order on screen is the
    /// browser's, not the enum's.
    enum class StripAction : std::uint8_t { OpenMenu, Discord, Exit };
    struct StripSlot {
        MenuId menu;
        StripAction action;
        const char* icon;
        bool topRow;
        std::uint32_t fill;
        std::uint32_t border;
    };

    /// The strip's slots, in the browser build's order. That order is at once
    /// the layout order, the draw order, the hit-test order and the slide-in
    /// stagger order, so it is spelled out once rather than derived.
    static const std::array<StripSlot, kStripSlotCount>& strip();

    /// Where the open card falls in the paint order. It is always clear of the
    /// bar-and-strip pair, never between them -- the browser has no seam there
    /// for a card to sit in. The title screen keeps the browser's split:
    /// renderCanvasUI paints settings and debug under both, and every other
    /// card lands over them. In game every card is over both, so the loadout
    /// bar never paints across an open menu.
    enum class PanelLayer : std::uint8_t { Under, Over };
    static PanelLayer panelLayer(MenuId, bool inGame);

    static Rect panelBounds(MenuId, int viewWidth, int viewHeight);
    /// Draws whichever card is on screen -- which is `drawn_`, not `open_`,
    /// while one is still sliding out.
    void renderOpenPanel(Canvas&, Window&, NetClient&, const SpriteCache&, const WorldRenderer&,
                         double timeSeconds, double dt);
    void drawIconStrip(Canvas&, Window&, double timeSeconds);
    const SvgDocument* icon(int index);
    /// The bar's box and slot scale for the screen it is being drawn on. The
    /// title screen gives it a fixed 900x210 region below centre; in game it
    /// owns the whole viewport at three-quarter scale.
    void drawLoadoutBar(Canvas&, Window&, NetClient&, const SpriteCache&, double timeSeconds);
    /// Pick-up and drop, run AFTER the open panel has had the same click. The
    /// bar is painted under the panel and so must not answer for a press the
    /// panel is standing on top of.
    void updateLoadoutInput(Window&, NetClient&, double timeSeconds);
    /// The three loadout edits the bar can make. Each one sends the request
    /// AND records what the answer should be, so the tiles start moving on
    /// the click rather than on the echo -- see expectedLoadout_.
    void expectLoadout(const NetClient&, double timeSeconds);
    void swapLoadoutSlots(NetClient&, double timeSeconds, int a, int b);
    void swapLoadoutRows(NetClient&, double timeSeconds);
    void setLoadoutSlot(NetClient&, double timeSeconds, int slot, std::uint16_t petalIndex,
                        Rarity rarity);
    void clearLoadoutSlot(NetClient&, double timeSeconds, int slot);
    /// A CLICK on a loadout slot -- picked up and put straight back down.
    ///
    /// The petals that do something when they are used do it here: a splitter
    /// swaps which of its two flowers the player is steering. This client has
    /// no U + slot-number chord, and a tile that answers to a click is the
    /// discoverable version of one. Silent for every other petal, which is
    /// nearly all of them, and silent for a slot still reloading.
    void useLoadoutSlot(NetClient&, int slot);
    void drawDragged(Canvas&, Window&, const SpriteCache&, double timeSeconds);
    void activateStripSlot(int slot);

    MenuId open_ = MenuId::None;
    /// The card being painted. It outlives `open_` by the length of the
    /// slide-out, which is the only reason the two are separate.
    MenuId drawn_ = MenuId::None;
    /// 0 = a full viewport height below its anchor, 1 = seated. Only the tall
    /// list panels use it: they are DOM shells with a transform transition,
    /// where the corner overlays are canvas panels drawn straight at (20, 72).
    double panelSlide_ = 0;
    ClientSettings settings_;
    DragState drag_;
    bool wantsText_ = false;

    bool inGame_ = false;
    bool exitRequested_ = false;
    bool logoutRequested_ = false;
    bool adminGrantOffered_ = false;
    bool adminGrantRequested_ = false;
    int changelogEntries_ = 1;
    /// What the badge on the notifications button draws. Recomputed by
    /// render(), which is the only entry point holding a NetClient -- the
    /// login screen's strip has no account and so never badges anything.
    int notificationsUnread_ = 0;
    /// Whether this session has already asked for its first page. See the note
    /// in render(): the badge cannot count a feed nobody fetched.
    bool notificationsPrimed_ = false;

    /// The icon artwork, compiled on first use. One document per glyph, shared
    /// with nothing -- these are the only SVGs the UI layer draws.
    std::vector<std::shared_ptr<SvgDocument>> icons_;

    /// Where the strip's buttons and the loadout slots ended up last frame.
    /// Recomputed every frame; kept only so capturesMouse() can answer without
    /// laying the strip out again.
    std::array<Rect, kStripSlotCount> stripRects_{};
    /// When each slot's slide-in began, in seconds. Negative means idle.
    std::array<double, kStripSlotCount> slideStart_{};
    /// Whether a slot was visible last frame, so a late reveal (the exit and
    /// debug buttons) can slide in on the false->true edge only.
    std::array<bool, kStripSlotCount> stripVisible_{};
    bool stripSeeded_ = false;
    /// The slot the current press began on. A click only counts when the
    /// release lands on the same one, and only that slot draws the dark tint.
    int pressedSlot_ = -1;

    /// 0..1; the bar rises 120px into place on its first frames, and sinks
    /// back the same way once there is no loadout left to show.
    double loadoutSlide_ = 0;
    /// Slot under the cursor last frame: 0..19, kLoadoutTrashSlot, or -1.
    /// Recomputed by the draw pass, which is the only one that lays the bar
    /// out, and read by the input pass that runs after it.
    int loadoutHovered_ = -1;
    /// Where the pointer was when a petal was lifted off the bar, so a release
    /// that barely moved can still be told from a drag. See drawLoadoutBar.
    Vec2 loadoutGrabAt_{};
    /// Which slots a press would actually lift a petal out of, as of the last
    /// paint. The bar swallows a click for those and for nothing else -- an
    /// empty slot, the trash and the gaps all fall through and fire an attack.
    ///
    /// Per slot rather than "is the hovered one grabbable": capturesMouse is
    /// asked about THIS frame's pointer before the bar is painted, and a
    /// finger's pointer jumps. A flag about where the pointer was at the last
    /// paint answered for wherever the previous tap had lifted.
    std::array<bool, kLoadoutBarSlots> loadoutGrabbable_{};
    /// Which of the ten secondary slots Q/E has selected, or -1. Clears itself
    /// five seconds after the last press.
    int selectedSecondary_ = -1;
    double lastSelectTime_ = 0;
    /// Recorded by handleKeys and applied by drawLoadoutBar, which is the only
    /// place that has the network client to act on them.
    int pendingSwapSlot_ = -1;
    /// -1 back, +1 forward, 0 none: which way Q/E asked the selection to move.
    int pendingCycle_ = 0;
    bool pendingSecondaryDelete_ = false;
    /// R: swap the two rows.
    bool pendingRowSwap_ = false;
    /// A K/L + number chord: the preset it names, or -1, and whether Shift
    /// was down, which makes it a save rather than a load.
    int pendingPreset_ = -1;
    bool pendingPresetSave_ = false;
    /// In game, K and L are held down to name a preset, so whatever ELSE they
    /// are bound to -- mouse controls, the leaderboard -- cannot fire on the
    /// press: it would go off on every K+1 on the way to the number. Armed on
    /// the press, spent by a number, and a release that finds it still armed
    /// was a plain tap and gets the key's old action.
    std::array<bool, kLoadoutPresetBanks> presetTapArmed_{};
    /// The bank whose key is held this frame, or -1: its presets take the
    /// second row's place until it is let go. Set by handleKeys and cleared by
    /// the bar once drawn, so a frame handleKeys skips -- chat open, a text
    /// field focused -- shows the loadout rather than a stale preview.
    int presetBankShown_ = -1;

    /// One loadout tile's animated box, in canvas units.
    ///
    /// gardn animates the PETAL, not the slot: its UiLoadoutPetal owns an
    /// x/y/w/h that eases toward wherever its slot happens to be, so a swap
    /// slides two tiles past each other, a picked-up petal grows and rides the
    /// cursor, and letting go over nothing floats it home. A tile painted
    /// straight into its slot rect can do none of that.
    ///
    /// `petalIndex`/`rarity` are what this box was showing last frame, which
    /// is how a swap is recognised: the two slots' contents trade, so each
    /// takes over the other's box and eases back from there.
    struct LoadoutTileAnim {
        double cx = 0;
        double cy = 0;
        double w = 0;
        double h = 0;
        std::uint16_t petalIndex = kNoPetal;
        Rarity rarity = Rarity::Common;
        /// Whether the box is worth easing FROM. A tile that has never been
        /// drawn appears in its slot rather than flying in from the origin.
        bool live = false;
    };
    std::array<LoadoutTileAnim, kLoadoutBarSlots> loadoutTiles_{};
    /// The tile a petal dragged out of the INVENTORY rides on. Same object as
    /// a bar tile and animated the same way -- it grows, rocks, follows the
    /// cursor and drops into whichever slot it is over -- because a drag that
    /// changed what it was carrying halfway across the screen is how a player
    /// loses track of it.
    LoadoutTileAnim dragTile_{};
    /// Where the bar's slots landed this frame, so a drag that began in a
    /// panel can snap into one. Zeroed while the bar is down.
    std::array<Rect, kLoadoutBarSlots> loadoutRects_{};
    /// The primary row's slot side and the bar's scale, both in canvas units,
    /// which is what a tile riding the cursor is sized against.
    double loadoutSlotSide_ = 0;
    double loadoutScale_ = 0;
    /// The scratch surface the in-game bar is painted into before it goes
    /// onto the frame as one see-through layer, in device pixels. It only
    /// ever grows; each frame uses the top-left corner its box needs. See
    /// drawLoadoutBar.
    std::unique_ptr<Canvas> loadoutLayer_;

    /// What the bar draws while the server catches up.
    ///
    /// The loadout is the server's, and a swap is a request: the profile does
    /// not change until the echo lands, a round trip later. Waiting for it
    /// reads as a dropped click -- and worse, the dragged tile and the slot it
    /// was dropped on would both sit in that slot until the echo. So a local
    /// edit is shown at once and reconciled: empty means "the profile", and it
    /// is dropped the moment the profile agrees with it or the deadline
    /// passes, whichever comes first. gardn does the same thing with
    /// `Game::cached_loadout` and `no_change_ticks`.
    ///
    /// Nothing is ever SENT from here. The server stays the only authority,
    /// and a refused edit corrects itself within the deadline.
    std::vector<Profile::Slot> expectedLoadout_;
    double expectedLoadoutUntil_ = 0;

    Rect panelRect_{};

    /// See setNearbyNpc().
    NpcService nearbyNpc_ = NpcService::None;

    InventoryPanel inventory_;
    CraftingPanel crafting_;
    OraclePanel oracle_;
    TradePanel trader_;
    TitanPanel titan_;
    TalentsPanel talents_;
    GalleryPanel gallery_;
    ShopPanel shop_;
    SkinsPanel skins_;
    LeaderboardPanel leaderboard_;
    SettingsPanel settings_panel_;
    ChangelogPanel changelog_;
    NotificationsPanel notifications_;
    GuildPanel guild_;
    DebugPanel debug_;
    AdminDbPanel adminDb_;
};

/// The label and hotkey shown on the menu bar.
const char* menuLabel(MenuId);
/// A key's name, for the settings list. "Unbound" for Key::Unknown.
const char* keyName(Key);

} // namespace flix
