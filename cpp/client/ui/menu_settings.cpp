// Settings.
//
// Four tabs in a fixed 420x500 card pinned under the top icon row: the key
// bindings, the graphics switches and sliders, the server address and the
// account actions, and the credits. Everything here is local to this client:
// nothing is sent to the server, and nothing in it can change what the
// simulation does -- which is why hitboxes can be switched on without it being
// a cheat.
//
// The panel keeps more between frames than SettingsPanel has members for: a
// tab, a press, a slider drag, a focused field, and the bindings and switches
// that have no home in ClientSettings yet. That state lives in this file
// because menus.h, which declares the class, is not this file's to change;
// there is exactly one settings panel in the process, so a file-scope instance
// is the same thing as a member.
//
// Which rows reach the rest of the client, and which do not:
//   wired   Show Hitboxes -> settings.render.hitboxes, Enable Debug Menu
//           button -> settings.showDebugButton, and the Inventory, Crafting,
//           Skills and Toggle debug menu bindings -> settings.hotkeys. These
//           are read elsewhere and persisted with the rest of ClientSettings.
//   local   every other switch, the three sliders and the other eleven
//           bindings. The rows are drawn because the reference draws them --
//           the row set is the panel's shape, not a claim about this client --
//           but their consumers are outside this file: movement, the petal
//           keys and the zoom keys are read in App, the stats readout and the
//           console overlay are drawn there, and a value cannot outlive the
//           process until ClientSettings carries a field for it to be saved
//           in. Until then they are remembered for the session and no longer.
//   inert   Render Resolution, Anti-aliasing and GPU Acceleration have no
//           native counterpart at all: SDL owns the backbuffer and the canvas
//           rasteriser is not switchable at runtime. They keep their row and
//           their value, and nothing behind them will ever read it.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"

namespace flr {

using namespace flr::ui;

namespace {

// --- layout, straight from the browser panel's getLayout() ------------------

constexpr double kPad = 15.0;
constexpr double kHeaderHeight = 30.0;
constexpr double kTabHeight = 32.0;
constexpr double kTabGap = 5.0;
constexpr double kCloseButtonSize = 28.0;
constexpr double kRowStride = 32.0;
constexpr double kCheckSize = 22.0;
constexpr double kKeyBoxHeight = 26.0;
constexpr double kSliderThickness = 8.0;
constexpr double kThumbRadius = 10.0;
constexpr double kFieldHeight = 32.0;
/// Chrome reports 100 CSS px of deltaY per wheel notch and the browser panel
/// scrolls 1:1 with it; SDL reports one notch as 1.0.
constexpr double kWheelStep = 100.0;

/// The settings gear: the first slot of the top icon row, at menus.cpp's
/// kIconInset/kIconButton. The geometry is duplicated rather than shared
/// because the strip's layout is private to menus.cpp, and these two have to
/// agree about this one button: the strip is hit-tested AFTER the panel, so a
/// click the panel answered by closing would be turned straight back into an
/// open by the gear's own toggle. Every other click outside the card closes.
constexpr Rect kGearButton{20.0, 20.0, 42.0, 42.0};

/// Inclusive on the far edges, the way the browser writes its own bounds
/// tests (`x > panelX + panelW` is outside, `x == panelX + panelW` is not) and
/// the way the icon strip hit-tests its buttons. Rect::contains is half-open,
/// which would leave the card's last pixel column reading as outside it.
bool insideEdges(Rect r, Vec2 p) {
    return p.x >= r.x && p.x <= r.right() && p.y >= r.y && p.y <= r.bottom();
}

// --- palette ----------------------------------------------------------------

constexpr std::uint32_t kTabActiveFill = 0x8888BBu;
constexpr std::uint32_t kNeutralFill = 0xA3A3A3u;   ///< inactive tab, reset buttons
constexpr std::uint32_t kActionFill = 0x5A9FDBu;    ///< Save Controls, and the slider fill
constexpr std::uint32_t kCloseFill = 0xCC4444u;     ///< close button, Log Out
/// hsvAdjust('#a3a3a3', 0.8) -- the surround every white inset field sits in.
constexpr std::uint32_t kSurroundFill = 0x828282u;
constexpr std::uint32_t kSurfaceIdle = 0xE6E6E6u;
constexpr std::uint32_t kSurfaceHover = 0xF0F0F0u;
constexpr std::uint32_t kSurfaceActive = 0xFFFFFFu;
/// hsvAdjust('#666666', 0.4).
constexpr std::uint32_t kCheckShell = 0x292929u;
constexpr std::uint32_t kCheckOff = 0x666666u;
constexpr std::uint32_t kCheckOn = 0xCFCFCFu;
constexpr std::uint32_t kTrackGrey = 0x888888u;
constexpr std::uint32_t kThumbFill = 0xDDDDDDu;
constexpr std::uint32_t kGoldHeading = 0xFFDD66u;
constexpr std::uint32_t kFooterGrey = 0xCCCCCCu;

/// The address the client dials when nothing overrides it. Duplicated from
/// AppConfig because the panel has no accessor for the live one; the browser
/// falls back to window.location.origin for exactly the same reason.
constexpr const char* kDefaultServerAddress = "127.0.0.1:4242";

// --- what the panel can point at --------------------------------------------

enum class Tab : std::uint8_t { Controls, Graphics, Advanced, Credits };
constexpr int kTabCount = 4;

/// Which widget a press began on. Two fields rather than the browser's string
/// ids ("settings_tab_graphics"), which is the same thing without an
/// allocation per frame. Only the gardn buttons appear here: checkboxes, key
/// boxes and the IP field have no pressed state in the browser either.
enum class Widget : std::uint8_t { None, Close, Tab, Button };

struct WidgetId {
    Widget kind = Widget::None;
    int index = 0;
};
bool operator==(WidgetId a, WidgetId b) { return a.kind == b.kind && a.index == b.index; }

/// Every switch in the panel. Two of them are real client settings; the rest
/// have no consumer yet and are held beside them so the panel still reads and
/// writes one value per row rather than faking it.
enum Toggle : int {
    kShowHitboxes,
    kShowStats,
    kDynamicSkybox,
    kMobDeathAnimation,
    kAntialiasing,
    kGpuAcceleration,
    kDisableUltraParticles,
    /// One value, two rows: Graphics calls it "Show Console Logs" and Advanced
    /// "Show Console Logs on Screen", as the browser does.
    kShowConsoleLogs,
    kShowAdminCommands,
    kShowAdminsOnLeaderboard,
    kDebugMenuEnabled,
    kNumberKeysUseItems,
    kUseMouseControls,
    kRequestMobile,
    kToggleCount,
};

enum Slider : int { kRenderScale, kMobFramerate, kInterpolation };

enum Button : int { kSaveControls, kResetControls, kResetTutorial, kLogOut };

/// One row of the Controls tab, in DEFAULT_CONTROLS order. `menu` names the
/// panel a row really opens, and those four live in ClientSettings::hotkeys;
/// MenuId::None means the binding is kept locally.
struct ControlRow {
    const char* label;
    Key fallback;
    MenuId menu;
};

constexpr int kControlCount = 15;
constexpr std::array<ControlRow, kControlCount> kControlRows = {{
    {"Move up",               Key::W,          MenuId::None},
    {"Move down",             Key::S,          MenuId::None},
    {"Move left",             Key::A,          MenuId::None},
    {"Move right",            Key::D,          MenuId::None},
    {"Inventory",             Key::Z,          MenuId::Inventory},
    {"Crafting",              Key::C,          MenuId::Crafting},
    {"Skills",                Key::X,          MenuId::Talents},
    {"Toggle mouse controls", Key::K,          MenuId::None},
    {"Toggle hitboxes",       Key::H,          MenuId::None},
    {"Toggle debug menu",     Key::J,          MenuId::Debug},
    {"Zoom in",               Key::Equals,     MenuId::None},
    {"Zoom out",              Key::Minus,      MenuId::None},
    {"Chat",                  Key::Enter,      MenuId::None},
    {"Extend petals",         Key::Space,      MenuId::None},
    {"Retract petals",        Key::LeftShift,  MenuId::None},
}};

/// A key as the browser's `event.key` spells it, which is what the browser
/// panel stores and shows: lower-case letters, "Space", "Shift", "=", "-".
const char* keyLabel(Key key) {
    switch (key) {
        case Key::A: return "a"; case Key::B: return "b"; case Key::C: return "c";
        case Key::D: return "d"; case Key::E: return "e"; case Key::F: return "f";
        case Key::G: return "g"; case Key::H: return "h"; case Key::I: return "i";
        case Key::J: return "j"; case Key::K: return "k"; case Key::L: return "l";
        case Key::M: return "m"; case Key::N: return "n"; case Key::O: return "o";
        case Key::P: return "p"; case Key::Q: return "q"; case Key::R: return "r";
        case Key::S: return "s"; case Key::T: return "t"; case Key::U: return "u";
        case Key::V: return "v"; case Key::W: return "w"; case Key::X: return "x";
        case Key::Y: return "y"; case Key::Z: return "z";
        case Key::Num0: return "0"; case Key::Num1: return "1"; case Key::Num2: return "2";
        case Key::Num3: return "3"; case Key::Num4: return "4"; case Key::Num5: return "5";
        case Key::Num6: return "6"; case Key::Num7: return "7"; case Key::Num8: return "8";
        case Key::Num9: return "9";
        case Key::Space: return "Space"; case Key::Enter: return "Enter";
        case Key::Tab: return "Tab"; case Key::Backspace: return "Backspace";
        case Key::Escape: return "Escape";
        case Key::Minus: return "-"; case Key::Equals: return "=";
        case Key::Comma: return ","; case Key::Period: return ".";
        case Key::Slash: return "/"; case Key::Backslash: return "\\";
        case Key::Semicolon: return ";"; case Key::Apostrophe: return "'";
        case Key::LeftShift: case Key::RightShift: return "Shift";
        case Key::LeftCtrl: case Key::RightCtrl: return "Control";
        case Key::LeftAlt: case Key::RightAlt: return "Alt";
        case Key::Left: return "ArrowLeft"; case Key::Right: return "ArrowRight";
        case Key::Up: return "ArrowUp"; case Key::Down: return "ArrowDown";
        case Key::F1: return "F1"; case Key::F2: return "F2"; case Key::F3: return "F3";
        case Key::F4: return "F4"; case Key::F5: return "F5"; case Key::F6: return "F6";
        case Key::F7: return "F7"; case Key::F8: return "F8"; case Key::F9: return "F9";
        case Key::F10: return "F10"; case Key::F11: return "F11"; case Key::F12: return "F12";
        default: return "";
    }
}

// --- state ------------------------------------------------------------------

struct PanelState {
    Tab tab = Tab::Controls;
    WidgetId pressed{};
    int dragging = -1;              ///< index into Slider, or -1
    bool ipFocused = false;
    std::string serverIp = kDefaultServerAddress;
    /// Bindings for the rows that are not backed by ClientSettings::hotkeys.
    std::array<Key, kControlCount> keys{};
    std::array<bool, kToggleCount> toggles{};
    double renderScale = 1.0;
    double mobFramerate = 15.0;
    double interpolation = 0.15;
    /// Measured by the last paint, the way the browser captures
    /// contentBottomY, so the scroll range is always the real one.
    double contentHeight = 0;
    /// Reset Tutorial asks twice. The browser asks with confirm() and then
    /// says so with alert(); this client has no dialog to put either in, so
    /// the button relabels and only a second click inside the arming window
    /// does anything -- the same guard the talents panel's reset already uses.
    bool tutorialResetArmed = false;
    double tutorialResetArmedUntil = 0;

    PanelState() {
        for (int i = 0; i < kControlCount; ++i) {
            keys[static_cast<std::size_t>(i)] = kControlRows[static_cast<std::size_t>(i)].fallback;
        }
        toggles[kMobDeathAnimation] = true;
        toggles[kAntialiasing] = true;
        toggles[kGpuAcceleration] = true;
    }
};

/// The one settings panel's state. See the note at the top of the file for
/// why it lives here rather than in SettingsPanel.
PanelState& panelState() {
    static PanelState s;
    return s;
}

bool* toggleValue(PanelState& st, ClientSettings& settings, int id) {
    switch (id) {
        case kShowHitboxes: return &settings.render.hitboxes;
        case kShowStats: return &settings.showStats;
        case kDebugMenuEnabled: return &settings.showDebugButton;
        // Everything else lands in the panel's own copy, because ClientSettings
        // has no field for it: nothing outside this file could read one, and
        // nothing would write it to disk. A row moves up here the moment a
        // field exists -- Number Keys Use Items is the one whose consumer (the
        // lobby's control hints) is already written and waiting.
        default: return &st.toggles[static_cast<std::size_t>(id)];
    }
}

Key controlKey(const PanelState& st, const ClientSettings& settings, int row) {
    const ControlRow& meta = kControlRows[static_cast<std::size_t>(row)];
    if (meta.menu == MenuId::None) return st.keys[static_cast<std::size_t>(row)];
    return settings.hotkeys[static_cast<std::size_t>(meta.menu)];
}

void bindControl(PanelState& st, ClientSettings& settings, int row, Key key) {
    const ControlRow& meta = kControlRows[static_cast<std::size_t>(row)];
    if (meta.menu == MenuId::None) {
        st.keys[static_cast<std::size_t>(row)] = key;
        return;
    }
    // A key already in use is taken from whoever had it rather than the rebind
    // being refused: two menus on one key is the only broken state, and telling
    // the player off for it is worse than just moving it.
    for (int other = 1; other < kMenuCount; ++other) {
        if (settings.hotkeys[static_cast<std::size_t>(other)] == key) {
            settings.hotkeys[static_cast<std::size_t>(other)] = Key::Unknown;
        }
    }
    settings.hotkeys[static_cast<std::size_t>(meta.menu)] = key;
}

// --- primitives -------------------------------------------------------------

TextStyle bodyStyle(double size, std::uint32_t fill, std::uint32_t stroke, double strokeWidth,
                    Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.bold = true;
    style.fill = fill;
    style.stroke = stroke;
    style.strokeWidth = strokeWidth;
    style.align = align;
    return style;
}

void roundFill(Canvas& canvas, Rect r, double radius, std::uint32_t colour) {
    setFill(canvas, colour);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h), static_cast<float>(radius));
    canvas.fill();
}

/// A white inset surface in a grey surround: the key boxes and the server-IP
/// field. Rounded outside, SHARP inside, as the browser draws it.
void insetSurface(Canvas& canvas, Rect r, std::uint32_t surface) {
    roundFill(canvas, r, 3.0, kSurroundFill);
    setFill(canvas, surface);
    canvas.fillRect(static_cast<float>(r.x + 3.0), static_cast<float>(r.y + 3.0),
                    static_cast<float>(r.w - 6.0), static_cast<float>(r.h - 6.0));
}

std::uint32_t surfaceColour(bool active, bool hovered) {
    if (active) return kSurfaceActive;
    return hovered ? kSurfaceHover : kSurfaceIdle;
}

ButtonStyle gardnStyle(std::uint32_t fill, double textSize) {
    ButtonStyle style;
    style.fill = fill;
    style.outlineWidth = 3.0;
    style.radius = 3.0;
    style.textSize = textSize;
    style.textStrokeWidth = 3.0;
    return style;
}

/// The layout cursor and the widget helpers the four tabs share.
///
/// Hover and click are answered inline, next to the geometry that produced
/// them, so there is no second copy of the layout for an input pass to drift
/// away from -- the same reason every other panel here is immediate-mode.
struct Painter {
    MenuContext& ctx;
    PanelState& st;
    double x = 0;           ///< content column, left edge
    double w = 0;           ///< content column width
    bool inView = false;    ///< the cursor is inside the clipped viewport
    double cy = 0;          ///< running layout cursor
    bool consumed = false;  ///< a widget answered this frame's release

    Canvas& canvas() const { return ctx.canvas; }
    Vec2 mouse() const { return ctx.mouse(); }
    bool over(Rect r) const { return inView && r.contains(mouse()); }

    /// Records the press and reports whether this widget is the pressed one.
    /// The browser keeps its press on the widget it started on even as the
    /// cursor leaves, so this deliberately does not re-test the hover.
    bool press(Rect r, WidgetId id) {
        if (over(r) && ctx.pressed()) st.pressed = id;
        return st.pressed == id;
    }

    bool click(Rect r) {
        if (!over(r) || !ctx.released()) return false;
        consumed = true;
        return true;
    }

    void label(const std::string& caption, double y, double size, std::uint32_t fill,
               std::uint32_t stroke, double strokeWidth, Align align = Align::Left) {
        const double at = align == Align::Centre ? x + w * 0.5 : x;
        text(canvas(), caption, at, y, bodyStyle(size, fill, stroke, strokeWidth, align));
    }

    /// A gardn button, laid out and hit-tested. Returns true when clicked.
    bool button(Rect r, const std::string& caption, std::uint32_t fill, double textSize, int id) {
        const WidgetId self{Widget::Button, id};
        const bool pressed = press(r, self);
        ui::button(canvas(), r, caption, over(r), pressed, gardnStyle(fill, textSize));
        return click(r);
    }

    /// One checkbox row. Advances the cursor by a full row.
    void checkbox(int toggleId, const std::string& caption) {
        const Rect row{x, cy, w, kRowStride};
        const bool hovered = over(row);
        bool* value = toggleValue(st, ctx.settings, toggleId);

        roundFill(canvas(), Rect{x, cy + 2.0, kCheckSize, kCheckSize}, 4.0, kCheckShell);
        const std::uint32_t inner = *value ? kCheckOn : kCheckOff;
        // Only the inner square lights up: there is no row-wide wash anywhere
        // in this panel.
        setFill(canvas(), hovered ? hsvScale(inner, 1.1) : inner);
        canvas().fillRect(static_cast<float>(x + 3.0), static_cast<float>(cy + 5.0),
                          static_cast<float>(kCheckSize - 6.0),
                          static_cast<float>(kCheckSize - 6.0));

        text(canvas(), caption, x + kCheckSize + 8.0, cy + 2.0 + kCheckSize * 0.5,
             bodyStyle(13.0, kPaper, kInk, 2.0));

        if (click(row)) *value = !*value;
        cy += kRowStride;
    }

    /// A captioned slider: the caption, then the track 22px under it, then
    /// `trailing` px of gap. `value` is quantised to `step` and reported as
    /// `value * scale` at `decimals` places between `prefix` and `suffix`.
    ///
    /// The row owns the value rather than handing back a ratio, because the
    /// caption and the thumb must agree about it: the browser quantises before
    /// it paints, and a thumb that slides between the steps its own label
    /// reports is the tell that something ported this wrong.
    void sliderRow(int id, const char* prefix, const char* suffix, double& value, double lo,
                   double hi, double step, double scale, int decimals,
                   std::uint32_t captionStroke, double trailing) {
        const double span = hi - lo;
        // The track lands 22px below the cursor, so its hit band -- ten above
        // to twenty below -- is known before the caption is laid out.
        const Rect hit{x, cy + 12.0, w, 30.0};
        if (over(hit) && ctx.pressed()) st.dragging = id;
        if (over(hit) && ctx.released()) consumed = true;
        if (st.dragging == id) {
            const double raw = lo + clamp((mouse().x - x) / w, 0.0, 1.0) * span;
            value = clamp(std::round(raw / step) * step, lo, hi);
        }

        char caption[96];
        std::snprintf(caption, sizeof caption, "%s%.*f%s", prefix, decimals, value * scale, suffix);
        label(caption, cy + 8.0, 13.0, kPaper, captionStroke, 2.0);
        cy += 22.0;

        const double r = clamp((value - lo) / span, 0.0, 1.0);
        roundFill(canvas(), Rect{x, cy, w, kSliderThickness}, kSliderThickness * 0.5, kTrackGrey);
        // Floored at the track height: a rounded rect narrower than its own
        // radius paints as a sliver of the wrong shape rather than nothing.
        roundFill(canvas(), Rect{x, cy, std::max(kSliderThickness, w * r), kSliderThickness},
                  kSliderThickness * 0.5, kActionFill);

        setFill(canvas(), (over(hit) || st.dragging == id) ? kSurfaceActive : kThumbFill);
        setStroke(canvas(), kTrackGrey);
        canvas().setLineWidth(2.0f);
        canvas().beginPath();
        canvas().arc(static_cast<float>(x + w * r),
                     static_cast<float>(cy + kSliderThickness * 0.5),
                     static_cast<float>(kThumbRadius), 0.0f, static_cast<float>(kTau));
        canvas().fill();
        canvas().stroke();
        cy += trailing;
    }
};

// --- credits ----------------------------------------------------------------

struct CreditLine {
    const char* body;
    double size;
    std::uint32_t fill;
    bool centred;
    double offset;   ///< baseline, relative to the cursor
    double advance;  ///< how far the cursor moves afterwards
};

constexpr std::array<CreditLine, 15> kCredits = {{
    {"Flowrix.pro", 18.0, kPaper, true, 10.0, 30.0},
    {"Developers", 14.0, kGoldHeading, false, 10.0, 24.0},
    {"• sussybite8888", 12.0, kPaper, false, 8.0, 20.0},
    {"• Cookery", 12.0, kPaper, false, 8.0, 20.0},
    {"• Codelinkd203", 12.0, kPaper, false, 8.0, 20.0},
    {"• NachoFrenchFry", 12.0, kPaper, false, 8.0, 20.0},
    {"• Arras Guard YT", 12.0, kPaper, false, 8.0, 20.0},
    {"Inspired By", 14.0, kGoldHeading, false, 10.0, 24.0},
    {"• florr.io by M28", 12.0, kPaper, false, 8.0, 28.0},
    {"Assets & Libraries", 14.0, kGoldHeading, false, 10.0, 24.0},
    {"• Icons from game-icons.net and svgrepo.com", 12.0, kPaper, false, 8.0, 20.0},
    {"• Ubuntu font by Canonical", 12.0, kPaper, false, 8.0, 28.0},
    {"• Assets extracted by Bismuth(https://github.com/trigonal-bacon/gardn)",
     12.0, kPaper, false, 8.0, 20.0},
    {"• UI style by Bismuth(https://github.com/trigonal-bacon/gardn)",
     12.0, kPaper, false, 8.0, 20.0},
    {"Thanks for playing!", 13.0, kFooterGrey, true, 8.0, 20.0},
}};

} // namespace

double SettingsPanel::preferredWidth() { return 420.0; }

void SettingsPanel::reset() {
    // Deliberately not the scroll offset. The browser's toggle() only re-reads
    // the stored values, so a player who scrolled down to the Controls
    // checkboxes, closed the panel and reopened it finds it where they left
    // it. The offset is zeroed on a tab change, which is where the browser
    // zeroes it too.
    rebinding_ = -1;
    PanelState& st = panelState();
    st.pressed = WidgetId{};
    st.dragging = -1;
    st.ipFocused = false;
}

bool SettingsPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    ClientSettings& settings = ctx.settings;
    PanelState& st = panelState();
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();

    // The browser clears its press on mouseup and only runs the click after,
    // so a button is never painted pressed on the frame it fires.
    if (ctx.released()) {
        st.pressed = WidgetId{};
        st.dragging = -1;
    }

    const double contentX = panel.x + kPad;
    const double contentW = panel.w - kPad * 2;
    const double contentTop = panel.y + kHeaderHeight + kPad + kTabHeight + 10.0;
    const double contentBottom = panel.bottom() - kPad;
    const double viewHeight = std::max(0.0, contentBottom - contentTop);

    // Keys first: a rebind or a keystroke has to show in the paint that
    // follows it, not one frame later.
    if (rebinding_ >= 0) {
        // Escape binds like any other key. The browser's key handler takes its
        // editing branch before the one that closes the panel and writes
        // event.key verbatim, so there is no cancel gesture here to port; and
        // MenuSystem::handleKeys swallows every key while a row is capturing,
        // so the Escape that lands on a binding cannot also close the panel.
        for (int code = 1; code < static_cast<int>(Key::Count); ++code) {
            const Key key = static_cast<Key>(code);
            if (!ctx.window.keyPressed(key)) continue;
            bindControl(st, settings, rebinding_, key);
            rebinding_ = -1;
            break;
        }
    } else if (st.ipFocused) {
        if (ctx.window.keyPressed(Key::Escape) || ctx.window.keyPressed(Key::Enter)) {
            st.ipFocused = false;
        } else {
            if (ctx.window.keyPressed(Key::Backspace) && !st.serverIp.empty()) {
                st.serverIp.pop_back();
            }
            for (const char c : ctx.window.typedText()) {
                if (st.serverIp.size() >= 128) break;
                if (static_cast<unsigned char>(c) >= 0x20) st.serverIp += c;
            }
        }
    }
    if (st.ipFocused) ctx.wantsText = true;

    // --- card ---------------------------------------------------------------
    // Drawn here rather than through panelCard(): the browser's border is a
    // rounded rect with a SHARP body inset into it, not two rounded fills.
    roundFill(canvas, panel, 5.0, kSettingsSkin.border);
    setFill(canvas, kSettingsSkin.fill);
    canvas.fillRect(static_cast<float>(panel.x + 4.0), static_cast<float>(panel.y + 4.0),
                    static_cast<float>(panel.w - 8.0), static_cast<float>(panel.h - 8.0));

    text(canvas, "Settings", contentX, panel.y + kPad + kHeaderHeight * 0.5,
         bodyStyle(20.0, kPaper, kInk, 3.0));

    const bool inPanel = panel.contains(mouse);
    bool keepOpen = true;

    const Rect closeRect{panel.right() - kPad - kCloseButtonSize, panel.y + kPad,
                         kCloseButtonSize, kCloseButtonSize};
    const bool closeHovered = inPanel && closeRect.contains(mouse);
    const WidgetId closeId{Widget::Close, 0};
    if (closeHovered && ctx.pressed()) st.pressed = closeId;
    ui::button(canvas, closeRect, "X", closeHovered, st.pressed == closeId,
               gardnStyle(kCloseFill, 16.0));
    if (closeHovered && ctx.released()) keepOpen = false;

    // --- tab bar ------------------------------------------------------------
    static constexpr std::array<const char*, kTabCount> kTabLabels = {
        {"Controls", "Graphics", "Advanced", "Credits"}};
    const double tabW = (contentW - (kTabCount - 1) * kTabGap) / kTabCount;
    const double tabY = panel.y + kHeaderHeight + kPad + 5.0;
    for (int i = 0; i < kTabCount; ++i) {
        const Rect r{contentX + i * (tabW + kTabGap), tabY, tabW, kTabHeight};
        const bool active = static_cast<int>(st.tab) == i;
        const bool hovered = inPanel && r.contains(mouse);
        const WidgetId self{Widget::Tab, i};
        if (hovered && ctx.pressed()) st.pressed = self;
        // Hover does not brighten the tab that is already selected, but a
        // press darkens it like any other button.
        ui::button(canvas, r, kTabLabels[static_cast<std::size_t>(i)], hovered && !active,
                   st.pressed == self, gardnStyle(active ? kTabActiveFill : kNeutralFill, 13.0));
        if (hovered && ctx.released()) {
            st.tab = static_cast<Tab>(i);
            scroll_.offset = 0;
            rebinding_ = -1;
            st.ipFocused = false;
        }
    }

    // --- scrolling ----------------------------------------------------------
    scroll_.viewHeight = viewHeight;
    scroll_.contentHeight = st.contentHeight;
    // Wherever the pointer is: the browser's wheel listener sits on the UI
    // canvas, not on the card, and forwards every notch to whichever panel is
    // open. A cursor resting over the world still scrolls this list.
    scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());

    canvas.save();
    // The clip spans the FULL panel width, not the content column: a label
    // that overruns the column is cut by the card's edge, not by the padding.
    canvas.beginPath();
    canvas.rect(static_cast<float>(panel.x), static_cast<float>(contentTop),
                static_cast<float>(panel.w), static_cast<float>(viewHeight));
    canvas.clip();

    Painter p{ctx, st, contentX, contentW,
              inPanel && mouse.y >= contentTop && mouse.y <= contentBottom,
              contentTop - scroll_.offset, false};
    const double contentStart = p.cy;

    switch (st.tab) {
        case Tab::Controls: {
            p.label("Controls", p.cy + 10.0, 15.0, kPaper, kInk, 2.0);
            p.cy += 28.0;

            const double labelW = contentW * 0.55;
            const double inputW = contentW * 0.4;
            for (int i = 0; i < kControlCount; ++i) {
                const Rect box{contentX + labelW, p.cy, inputW, kKeyBoxHeight};
                const bool editing = rebinding_ == i;
                text(canvas, kControlRows[static_cast<std::size_t>(i)].label, contentX,
                     p.cy + kKeyBoxHeight * 0.5, bodyStyle(12.0, kPaper, kInk, 2.0));
                insetSurface(canvas, box, surfaceColour(editing, p.over(box)));
                TextStyle keyText = bodyStyle(12.0, kInk, kInk, 0.0, Align::Centre);
                text(canvas, editing ? "..." : keyLabel(controlKey(st, settings, i)),
                     box.x + box.w * 0.5, p.cy + kKeyBoxHeight * 0.5, keyText);
                if (p.click(box)) rebinding_ = i;
                p.cy += kKeyBoxHeight + 6.0;
            }

            p.cy += 10.0;
            const double btnW = (contentW - 10.0) / 2.0;
            // Every rebind is already live; the browser's Save Controls only
            // ever put up an alert, so this is the same button doing the same
            // amount of work.
            p.button(Rect{contentX, p.cy, btnW, 30.0}, "Save Controls", kActionFill, 13.0,
                     kSaveControls);
            if (p.button(Rect{contentX + btnW + 10.0, p.cy, btnW, 30.0}, "Reset to Default",
                         kNeutralFill, 13.0, kResetControls)) {
                for (int i = 0; i < kControlCount; ++i) {
                    bindControl(st, settings, i, kControlRows[static_cast<std::size_t>(i)].fallback);
                }
                rebinding_ = -1;
            }
            p.cy += 40.0;

            p.checkbox(kNumberKeysUseItems, "Number Keys Use Items (off = swap loadout)");
            p.checkbox(kUseMouseControls, "Use Mouse Controls (K toggles in-game)");
            p.checkbox(kRequestMobile, "Request Mobile (touch joystick & attack/retract buttons)");
            break;
        }

        case Tab::Graphics: {
            p.checkbox(kShowHitboxes, "Show Hitboxes");
            p.checkbox(kShowStats, "Show Performance Stats");
            p.checkbox(kDynamicSkybox, "Dynamic Skybox");
            p.checkbox(kMobDeathAnimation, "Mob Death Animation");
            p.checkbox(kAntialiasing, "Anti-aliasing");
            p.checkbox(kGpuAcceleration, "GPU Acceleration");
            p.checkbox(kDisableUltraParticles, "Disable Ultra+ Particles");
            p.checkbox(kShowConsoleLogs, "Show Console Logs");

            p.cy += 5.0;
            // Render resolution snaps to 5%, so the thumb lands on values
            // worth naming rather than on 63%.
            p.sliderRow(kRenderScale, "Render Resolution: ", "%", st.renderScale, 0.25, 1.0, 0.05,
                        100.0, 0, kInk, 25.0);
            // The next two captions are outlined in the slider thumb's
            // leftover grey rather than black. The browser build does it too,
            // and the panel does not read the same with them "corrected".
            p.sliderRow(kMobFramerate, "Mob Animation FPS: ", "", st.mobFramerate, 5.0, 60.0, 1.0,
                        1.0, 0, kTrackGrey, 25.0);
            p.sliderRow(kInterpolation, "Interpolation: ", "", st.interpolation, 0.05, 0.5, 0.01,
                        1.0, 2, kTrackGrey, 30.0);

            // Sits below the viewport until the list is scrolled, exactly as
            // it does in the browser.
            const bool armed =
                st.tutorialResetArmed && ctx.timeSeconds < st.tutorialResetArmedUntil;
            if (p.button(Rect{contentX, p.cy, 160.0, 30.0},
                         armed ? "Are you sure?" : "Reset Tutorial",
                         armed ? kCloseFill : kNeutralFill, 13.0, kResetTutorial)) {
                if (armed) {
                    // What the browser's two localStorage.removeItem calls do.
                    // Nothing happens to the game in progress: the reference
                    // only ever starts a tutorial on a join, which is why its
                    // own alert says "on your next game".
                    settings.tutorialCompleted = false;
                    settings.tutorialStep = 0;
                    st.tutorialResetArmed = false;
                } else {
                    st.tutorialResetArmed = true;
                    st.tutorialResetArmedUntil = ctx.timeSeconds + 4.0;
                }
            }
            p.cy += 40.0;
            break;
        }

        case Tab::Advanced: {
            p.label("Server IP:", p.cy + 10.0, 13.0, kPaper, kInk, 2.0);
            p.cy += 25.0;

            const Rect field{contentX, p.cy, contentW, kFieldHeight};
            insetSurface(canvas, field, surfaceColour(st.ipFocused, p.over(field)));
            // Truncated from the LEFT: the tail of an address is the part that
            // identifies it, and the caret sits at the end.
            std::string shown = st.serverIp;
            while (!shown.empty() && measure(shown, 13.0, false) > contentW - 20.0) {
                shown.erase(shown.begin());
            }
            TextStyle value = bodyStyle(13.0, kInk, kInk, 0.0);
            value.bold = false;
            text(canvas, shown, contentX + 8.0, p.cy + kFieldHeight * 0.5, value);
            if (st.ipFocused && std::fmod(ctx.timeSeconds, 1.0) < 0.5) {
                setFill(canvas, kInk);
                canvas.fillRect(static_cast<float>(contentX + 8.0 + measure(shown, 13.0, false)),
                                static_cast<float>(p.cy + 8.0), 2.0f,
                                static_cast<float>(kFieldHeight - 16.0));
            }
            if (p.click(field)) st.ipFocused = true;
            p.cy += kFieldHeight + 15.0;

            p.checkbox(kShowConsoleLogs, "Show Console Logs on Screen");
            p.checkbox(kShowAdminCommands, "Show Admin Commands");
            p.checkbox(kShowAdminsOnLeaderboard, "Show Admins on Leaderboard");
            p.checkbox(kDebugMenuEnabled, "Enable Debug Menu button (J in-game)");

            p.cy += 10.0;
            // Closing the panel is all the browser's logout does that this
            // client can do: there is no session to revoke from here.
            if (p.button(Rect{contentX, p.cy, 160.0, 32.0}, "Log Out", kCloseFill, 14.0, kLogOut)) {
                keepOpen = false;
            }
            p.cy += 42.0;
            break;
        }

        case Tab::Credits: {
            // Not hit-testable: the browser draws the credits and nothing else.
            for (const CreditLine& line : kCredits) {
                p.label(line.body, p.cy + line.offset, line.size, line.fill, kInk, 2.0,
                        line.centred ? Align::Centre : Align::Left);
                p.cy += line.advance;
            }
            break;
        }
    }

    st.contentHeight = p.cy - contentStart;
    canvas.restore();

    // --- input the widgets did not take -------------------------------------
    if (!ctx.released()) return keepOpen;
    if (inPanel) {
        // A click on the card's empty space drops whatever had focus, the way
        // clicking off a field does everywhere else.
        if (!p.consumed) {
            rebinding_ = -1;
            st.ipFocused = false;
        }
        return keepOpen;
    }
    // A click anywhere outside the card closes the panel. The gear is the one
    // exemption: the strip is hit-tested AFTER the panel, so closing here
    // would race the gear's own toggle and reopen the panel on the same click.
    // The strip's other buttons need no exemption -- closing this panel and
    // opening theirs is what one-menu-at-a-time already does.
    if (insideEdges(kGearButton, mouse)) return keepOpen;
    return false;
}

} // namespace flr
