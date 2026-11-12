// The Skin Studio: a two-tab authoring surface for data-driven player skins.
//
// Not a picker. The player assembles a skin out of drawing primitives, names
// it and publishes it; the Browse tab lists what everyone else published.
//
// This is an OVERLAY PANEL and is built from the same pieces as the other
// eleven: panelCard for the frame, panelHeading and panelClose for the
// chrome, ui::button for the tabs and the actions, ui::chip for the small
// controls, ui::inputField for the name box and ui::scrollbar for both lists.
// It used to carry a private dialect of all of those -- its own card, its own
// two-tone button with a flat white hover wash, twelve file-local colours, a
// header well no other panel has, and a name prompt floated at the middle of
// the VIEWPORT because the browser build put a real <input> there. None of
// that survives. What is still local is what is genuinely this panel's: the
// shape model, the drag handles, the palette, the custom-colour picker and
// the text-mode parser.
//
// The Browse tab owns none of what it shows. Publishing, editing, equipping,
// voting, starring and taking a skin down are all requests to the server,
// which sanitizes, assigns the id and broadcasts -- the catalog this panel
// lists is NetClient's, the same one the world renderer resolves a wearer's
// skin through, and a vote or a star lights up when the server says it landed.
// Copying a card's code is the one thing it does on its own: the code is the
// Text editor's, so a copied skin pastes straight back into it.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "client/net_client.h"
#include "client/render/skin_render.h"
#include "client/ui/draw.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menu_widgets.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/text_select.h"
#include "shared/core/text.h"
#include "shared/game/skin_format.h"
#include "shared/game/skin_likeness.h"

namespace flix {

using namespace flix::ui;

namespace {

// --- palette ---------------------------------------------------------------
//
// Three shades of the card's own purple and the shared greys, rather than a
// private swatch table. kSkinsSkin is what the strip's skins button is painted
// in, so the panel a player opens is visibly the button they pressed.

/// The selection colour: the strip button's purple, which is also the skin's
/// border. Bright enough to read against the body it sits on.
constexpr std::uint32_t kAccentPurple = kSkinsSkin.border;
/// Sunken surfaces -- the shape list, a browse card.
constexpr std::uint32_t kWell = hsvScale(kSkinsSkin.fill, 0.66);
/// One row on a sunken surface.
constexpr std::uint32_t kRowFill = hsvScale(kSkinsSkin.fill, 1.12);
/// The settings panel's own neutral and danger fills, so a grey button and a
/// red one mean the same thing on every card.
constexpr std::uint32_t kNeutralFill = 0xA3A3A3u;
constexpr std::uint32_t kDangerFill = 0xCC4444u;
/// The preview board. Grass, because that is what a skin will be seen on.
constexpr std::uint32_t kBoard = 0x3B7D4Fu;
/// The "no colour" swatch: a dark cell with a slash through it.
constexpr std::uint32_t kSwatchNone = 0x1A1D20u;
constexpr std::uint32_t kSwatchNoneEdge = 0x777777u;
constexpr std::uint32_t kSwatchSlash = 0xD05A5Au;
/// A curve's two bezier handles, told apart from its anchors by colour.
constexpr std::uint32_t kHandleControl = 0xFFE763u;
/// A parse error under the command help.
constexpr std::uint32_t kErrorText = 0xFFE65Du;
/// A favourite's star: the curve handles' yellow, so the panel keeps to one.
constexpr std::uint32_t kStarFill = kHandleControl;

// --- metrics ---------------------------------------------------------------
//
// The settings card's, which is the overlay family's: a 15px margin, a 30px
// heading band and a 32px tab row under it.

constexpr double kPad = 15.0;
constexpr double kHeadingBand = 30.0;
constexpr double kTabHeight = 32.0;
constexpr double kTabWidth = 104.0;
constexpr double kTabGap = 5.0;
constexpr double kFooterHeight = 32.0;
/// The left column, and the board at the top of it. The column is the wider
/// of the two so a shape row still has room for its name beside the three
/// buttons that reorder and remove it.
constexpr double kLeftWidth = 196.0;
constexpr double kPreviewSize = 176.0;
constexpr double kColumnGap = 16.0;
/// One shape row's pitch, and the card behind it.
constexpr double kRowPitch = 28.0;
constexpr double kRowCard = kRowPitch - 4.0;
constexpr double kScrollbarWidth = 10.0;
/// The Text tab's input cap, in bytes. Derived from the format rather than
/// picked: a paste over the cap is trimmed to fit, and trimmed mid-line it
/// stops parsing. The longest line the vocabulary can produce is a 16-point
/// polygon carrying both colours and a stroke width -- a shade over 200 bytes
/// -- so 256 apiece leaves a full-size skin room to arrive whole. What is left
/// is still a bound on pasting a file in here, which is all it was ever for.
constexpr std::size_t kMaxSkinTextBytes = static_cast<std::size_t>(kMaxSkinShapes) * 256;
/// The Browse search: longer than any skin name or username it can match.
constexpr std::size_t kMaxSearchBytes = 32;
/// One wheel notch is ~100 CSS px of deltaY in a browser; the window reports
/// notches, so the step is spelled out as every other list panel spells it.
constexpr double kWheelStep = 100.0;

/// The type scale, matching the other overlay panels: 15 for a section
/// heading, 13 for body and buttons, 11 for a caption under a control.
constexpr double kSectionSize = 15.0;
constexpr double kBodySize = 13.0;
constexpr double kCaptionSize = 11.0;

/// The fourteen swatch colours, in the order they are laid out.
const char* const kPalette[] = {
    "#ffe763", "#ff9d00", "#e8731f", "#d01c1d", "#e85cc0", "#c45cff", "#3a86ff",
    "#27dade", "#2bd14f", "#7d5a3a", "#ffffff", "#bfc6cc", "#5a6670", "#111111",
};
constexpr int kPaletteCount = 14;
/// Fifteen cells -- the fourteen colours and "none" -- laid out as ONE row
/// fitted to the column, rather than a fixed cell size that wrapped thirteen
/// onto the first row and two onto a second.
constexpr double kSwatchGap = 4.0;
constexpr double kSwatchMax = 26.0;

/// The custom-colour picker under the swatches: a saturation/value square,
/// the hue strip beside it, and the colour and its hex code to the right.
constexpr double kPickerCaption = 22.0;
constexpr double kPickerSquareW = 150.0;
constexpr double kPickerSquareMaxH = 120.0;
/// Below this the square is too short to aim at, and the picker is not drawn.
constexpr double kPickerSquareMinH = 48.0;
constexpr double kHueStripW = 18.0;
constexpr double kHexFieldH = 30.0;

/// The Browse tab's sort row, and the vote row on each card.
constexpr double kSortWidth = 92.0;
constexpr double kSortHeight = 24.0;
constexpr double kVoteRowH = 22.0;
constexpr double kStarW = 24.0;
/// A card's Copy code / Edit row, between the votes and Equip.
constexpr double kToolRowH = 22.0;
constexpr double kEditW = 44.0;
/// How long a card's Copy code button says it copied.
constexpr double kCopiedSeconds = 1.5;
/// How long a second click on Publish with nothing changed is only that: a
/// double click, which would answer "Published" with a refusal of itself.
constexpr double kPublishRepeatSeconds = 1.5;

double round1(double v) { return std::round(v * 10.0) / 10.0; }

/// `String(round1(v))`: an integral value prints without a decimal point, and
/// a negative zero prints as "0", both of which JS does and printf does not.
std::string numberText(double v) {
    const double r = round1(v);
    char buf[32];
    if (std::fabs(r) < 0.05) return "0";
    if (std::fabs(r - std::round(r)) < 1e-9) {
        std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(std::llround(r)));
    } else {
        std::snprintf(buf, sizeof buf, "%.1f", r);
    }
    return buf;
}

std::uint32_t hexColor(const std::string& s, std::uint32_t fallback = kInk) {
    return skinHexColor(s, fallback);
}

/// "#rrggbb", lower case: the one spelling the skin format accepts.
std::string hexText(std::uint32_t rgb) {
    char buf[8];
    std::snprintf(buf, sizeof buf, "#%06x", static_cast<unsigned>(rgb & 0xFFFFFFu));
    return buf;
}

/// What the picker's hex box will take: "#3A86FF", "3a86ff", or the "#abc"
/// shorthand, as "#3a86ff" / "#aabbcc". Anything else is "".
std::string normalHex(const std::string& typed) {
    std::string digits = typed;
    if (!digits.empty() && digits[0] == '#') digits.erase(0, 1);
    for (char& c : digits) {
        if (c >= 'A' && c <= 'F') c = static_cast<char>(c - 'A' + 'a');
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return {};
    }
    if (digits.size() == 3) digits = {digits[0], digits[0], digits[1], digits[1], digits[2], digits[2]};
    if (digits.size() != 6) return {};
    return "#" + digits;
}

/// Hue in degrees [0, 360), saturation and value in [0, 1].
std::uint32_t hsvToRgb(double h, double s, double v) {
    h = std::fmod(h, 360.0);
    if (h < 0) h += 360.0;
    const double c = v * s;
    const double x = c * (1.0 - std::fabs(std::fmod(h / 60.0, 2.0) - 1.0));
    const double m = v - c;
    double r = 0, g = 0, b = 0;
    switch (static_cast<int>(h / 60.0)) {
        case 0: r = c; g = x; break;
        case 1: r = x; g = c; break;
        case 2: g = c; b = x; break;
        case 3: g = x; b = c; break;
        case 4: r = x; b = c; break;
        default: r = c; b = x; break;
    }
    const auto byte = [m](double channel) {
        return static_cast<std::uint32_t>(std::lround(clamp(channel + m, 0.0, 1.0) * 255.0));
    };
    return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/// The inverse. A grey has no hue and a black no saturation either, so those
/// keep the ones given: a picker dragged into a corner and back out must not
/// lose the colour it was on.
void rgbToHsv(std::uint32_t rgb, double& h, double& s, double& v) {
    const double r = ((rgb >> 16) & 0xFF) / 255.0;
    const double g = ((rgb >> 8) & 0xFF) / 255.0;
    const double b = (rgb & 0xFF) / 255.0;
    const double peak = std::max({r, g, b});
    const double span = peak - std::min({r, g, b});
    v = peak;
    if (peak <= 0) return;
    s = span / peak;
    if (span <= 0) return;
    double hue = 0;
    if (peak == r) hue = std::fmod((g - b) / span, 6.0);
    else if (peak == g) hue = (b - r) / span + 2.0;
    else hue = (r - g) / span + 4.0;
    hue *= 60.0;
    h = hue < 0 ? hue + 360.0 : hue;
}

/// The picker's surfaces, as ramps the canvas stretches over their boxes:
/// it has no gradients, and its bilinear fetch turns a short strip of texels
/// into a smooth one. The square is the hue's pure colour under a white ramp
/// (saturation, left to right) and then a black one (value, top to bottom),
/// which composes to exactly the HSV colour at every point.
///
/// Each texel is sampled at its centre, so a fetch at a fraction f of the box
/// reads f's own value rather than one half a texel off.
constexpr int kRampTexels = 64;
constexpr int kHueTexels = 96;
/// drawImage cache keys, unique to these pixels for the life of the process.
/// The SVG rasters count up from 1, so a range this high is never theirs.
constexpr std::uint32_t kSaturationKey = 0x7C5C0001u;
constexpr std::uint32_t kValueKey = 0x7C5C0002u;
constexpr std::uint32_t kHueKey = 0x7C5C0003u;

struct PickerRamps {
    std::vector<std::uint8_t> saturation;   ///< kRampTexels x 1, white -> clear
    std::vector<std::uint8_t> value;        ///< 1 x kRampTexels, clear -> black
    std::vector<std::uint8_t> hue;          ///< 1 x kHueTexels, 0 -> 360 degrees
};

const PickerRamps& pickerRamps() {
    static const PickerRamps ramps = [] {
        PickerRamps out;
        const auto put = [](std::vector<std::uint8_t>& px, std::uint32_t rgb, double alpha) {
            px.push_back(static_cast<std::uint8_t>((rgb >> 16) & 0xFF));
            px.push_back(static_cast<std::uint8_t>((rgb >> 8) & 0xFF));
            px.push_back(static_cast<std::uint8_t>(rgb & 0xFF));
            px.push_back(static_cast<std::uint8_t>(std::lround(clamp(alpha, 0.0, 1.0) * 255.0)));
        };
        for (int i = 0; i < kRampTexels; ++i) {
            const double f = (i + 0.5) / kRampTexels;
            put(out.saturation, 0xFFFFFFu, 1.0 - f);
            put(out.value, 0x000000u, f);
        }
        for (int i = 0; i < kHueTexels; ++i) {
            put(out.hue, hsvToRgb((i + 0.5) / kHueTexels * 360.0, 1.0, 1.0), 1.0);
        }
        return out;
    }();
    return ramps;
}

/// A colour that is one of the fourteen swatches.
bool isPaletteColour(const std::string& colour) {
    for (const char* swatch : kPalette) {
        if (colour == swatch) return true;
    }
    return false;
}

std::size_t utf8Length(const std::string& s) {
    std::size_t n = 0;
    for (const char c : s) {
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++n;
    }
    return n;
}

/// Catalog names and authors are cut to a character count, not a width.
std::string clipChars(const std::string& s, std::size_t n) {
    if (utf8Length(s) <= n) return s;
    std::size_t at = 0;
    for (std::size_t i = 0; i + 1 < n && at < s.size(); ++i) at = utf8Next(s, at);
    return s.substr(0, at) + "\xe2\x80\xa6";
}

void clipRect(Canvas& canvas, Rect r) {
    canvas.beginPath();
    canvas.rect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                static_cast<float>(r.h));
    canvas.clip();
}

void clipRound(Canvas& canvas, Rect r, double radius) {
    roundPath(canvas, r, radius);
    canvas.clip();
}

/// The text editor's lines, which its paint and its pointer must agree on: a
/// standard input's band, the field padding in, the first line's middle a
/// half-line below a 6px top margin.
constexpr double kEditorLineHeight = kInputTextSize * 1.5;
double editorTextX(Rect editor) { return inputFieldBand(editor).x + kInputPadding; }
double editorFirstLine(Rect editor) {
    return inputFieldBand(editor).y + 6.0 + kEditorLineHeight * 0.5;
}

/// Panel text: white, outlined so it reads over the card and over the board,
/// and vertically centred on the y it is given -- which is what lets a row's
/// contents be laid out against the row's own middle.
TextStyle label(double size, Align align = Align::Left,
                std::uint32_t fill = kPaper) {
    TextStyle style;
    style.size = size;
    style.align = align;
    style.baseline = Baseline::Middle;
    style.fill = fill;
    style.stroke = kInk;
    style.roundJoin = true;
    return style;
}

/// The overlay family's button, at whatever size the caller's box is.
ButtonStyle buttonStyle(std::uint32_t fill, double textSize = kBodySize) {
    ButtonStyle style;
    style.fill = fill;
    style.outlineWidth = 3.0;
    style.radius = 3.0;
    style.textSize = textSize;
    style.shrinkToFit = true;
    return style;
}

/// The Create tab's footer: the name box, then Reset, then Publish against the
/// right edge. Shared by the paint and the hit test, so the box the caret is
/// placed against is the box that was drawn.
constexpr double kPublishW = 106.0;
constexpr double kResetW = 84.0;
Rect footerNameField(Rect footer) {
    return {footer.x, footer.y, std::max(120.0, footer.w - kPublishW - kResetW - 24.0), footer.h};
}

// --- the skin data model ---------------------------------------------------
//
// Deliberately the SHARED model, not a studio-local one: the same structs and
// the same validator cross the wire and are stored by the server, so a skin
// this panel accepts is exactly a skin the catalog will accept back.

using ShapeType = SkinShapeType;
using Shape = SkinShape;

const char* shortType(ShapeType t) {
    switch (t) {
        case ShapeType::Circle: return "Circle";
        case ShapeType::Ellipse: return "Ellipse";
        case ShapeType::Rect: return "Rect";
        case ShapeType::Polygon: return "Polygon";
        case ShapeType::Curve: return "Curve";
        default: return "Line";
    }
}

Shape defaultShape(ShapeType t) {
    Shape s;
    s.t = t;
    switch (t) {
        case ShapeType::Circle:
            s.r = 10; s.fill = "#3a86ff"; break;
        case ShapeType::Ellipse:
            s.rx = 10; s.ry = 6; s.fill = "#3a86ff"; break;
        case ShapeType::Rect:
            s.rx = 8; s.ry = 8; s.fill = "#3a86ff"; break;
        case ShapeType::Line:
            s.x = -10; s.x2 = 10; s.stroke = "#111111"; s.sw = 2; break;
        case ShapeType::Curve:
            s.x = -12; s.y = 4; s.x2 = 12; s.y2 = 4;
            s.cx1 = -8; s.cy1 = -14; s.cx2 = 8; s.cy2 = -14;
            s.stroke = "#111111"; s.sw = 2; break;
        case ShapeType::Polygon:
            s.points = {0, -12, 11, 8, -11, 8}; s.fill = "#3a86ff"; break;
    }
    return s;
}

/// One shape as one editable command line; round-trips through parseShapes.
std::string serializeShape(const Shape& s) {
    std::string out = skinShapeTypeName(s.t);
    out += " x=" + numberText(s.x) + " y=" + numberText(s.y);
    switch (s.t) {
        case ShapeType::Circle:
            out += " r=" + numberText(s.r);
            break;
        case ShapeType::Ellipse:
        case ShapeType::Rect:
            out += " rx=" + numberText(s.rx) + " ry=" + numberText(s.ry);
            break;
        case ShapeType::Line:
            out += " x2=" + numberText(s.x2) + " y2=" + numberText(s.y2);
            break;
        case ShapeType::Curve:
            out += " x2=" + numberText(s.x2) + " y2=" + numberText(s.y2);
            out += " cx1=" + numberText(s.cx1) + " cy1=" + numberText(s.cy1);
            out += " cx2=" + numberText(s.cx2) + " cy2=" + numberText(s.cy2);
            break;
        case ShapeType::Polygon:
            if (!s.points.empty()) {
                out += " points=";
                for (std::size_t i = 0; i < s.points.size(); ++i) {
                    if (i) out += ",";
                    out += numberText(s.points[i]);
                }
            }
            break;
    }
    if (s.t != ShapeType::Line && s.t != ShapeType::Curve && s.rot != 0) {
        out += " rot=" + numberText(s.rot);
    }
    if (!s.fill.empty()) out += " fill=" + s.fill;
    if (!s.stroke.empty()) out += " stroke=" + s.stroke;
    if (s.sw > 0) out += " sw=" + numberText(s.sw);
    return out;
}

/// A whole skin as the Text editor's code: one command line per shape.
std::string skinCode(const std::vector<Shape>& shapes) {
    std::string out;
    for (std::size_t i = 0; i < shapes.size(); ++i) {
        if (i) out += "\n";
        out += serializeShape(shapes[i]);
    }
    return out;
}

// --- actions ---------------------------------------------------------------

enum class Act : std::uint8_t {
    None, Close, Tab, AddShape, SelectShape, MoveShape, DelShape, Step, Fill, Stroke,
    Picker, PickSquare, PickHue, AddVertex, DelVertex, TextMode, Publish, Reset, Equip,
    Unequip, Delete, ConfirmDelete, CancelDelete, Sort, Like, Dislike, Favorite, CopyCode,
    Edit, StopEdit,
};

enum class Field : std::uint8_t { X, Y, R, Rx, Ry, Rot, Sw };

struct Action {
    Act k = Act::None;
    int i = 0;              ///< shape index, tab, or shape type
    int dir = 0;
    Field field = Field::X;
    double delta = 0;
    std::string color;
    std::string id;
    std::string name;

    /// Identity for hover: two regions hover as one only when every field that
    /// distinguishes them agrees.
    bool operator==(const Action& o) const {
        return k == o.k && i == o.i && dir == o.dir && field == o.field && delta == o.delta &&
               color == o.color && id == o.id;
    }
};

struct HitRegion {
    Rect r;
    Action action;
};

enum class HandleKind : std::uint8_t { Anchor, End, Control1, Control2, Vertex };

struct Handle {
    HandleKind kind = HandleKind::Anchor;
    int vertex = 0;
    double lx = 0, ly = 0;
};

/// Where everything on the card sits, derived from the card. Nothing in this
/// panel carries an absolute coordinate any more: the studio used to be pinned
/// at a literal (20, 72) while MenuSystem hit-tested it at the corner anchor
/// every other overlay uses, so the card and its own mouse-capture box were
/// fourteen pixels apart.
struct Layout {
    Rect panel;
    Rect tabs;      ///< the tab row, full content width
    Rect body;      ///< everything between the tabs and the footer
    Rect footer;    ///< name field and the two actions
    Rect preview;   ///< the drawing board, top of the left column
    Rect left;      ///< board, shape palette and shape list
    Rect right;     ///< the selected shape's properties, or the text editor
};

Layout layoutOf(Rect panel) {
    Layout out;
    out.panel = panel;
    const double x = panel.x + kPad;
    const double w = panel.w - kPad * 2;
    out.tabs = {x, panel.y + kPad + kHeadingBand + 5.0, w, kTabHeight};
    out.footer = {x, panel.bottom() - kPad - kFooterHeight, w, kFooterHeight};

    const double top = out.tabs.bottom() + 12.0;
    out.body = {x, top, w, std::max(0.0, out.footer.y - 10.0 - top)};
    out.left = {x, top, kLeftWidth, out.body.h};
    out.preview = {x + (kLeftWidth - kPreviewSize) * 0.5, top, kPreviewSize, kPreviewSize};
    out.right = {x + kLeftWidth + kColumnGap, top, w - kLeftWidth - kColumnGap, out.body.h};
    return out;
}

/// The Browse tab has no footer: under its sort row, its cards run to the
/// card's own bottom pad.
Rect browseBody(const Layout& l) {
    const double top = l.tabs.bottom() + 12.0 + kSortHeight + 10.0;
    return {l.body.x, top, l.body.w, std::max(0.0, l.panel.bottom() - kPad - top)};
}

/// The Browse tab's search box: the rest of the sort row after its three
/// chips, a little taller than they are so its type is not cramped, and
/// centred on them.
Rect browseSearchField(const Layout& l) {
    constexpr double kSearchHeight = 28.0;
    const double x = l.body.x + 3 * (kSortWidth + kTabGap) + 8.0;
    const double y = l.tabs.bottom() + 12.0 + (kSortHeight - kSearchHeight) * 0.5;
    return {x, y, std::max(0.0, l.body.right() - x), kSearchHeight};
}

/// Whether a skin is one the Browse search asks for: its name or its author
/// holds `needle` (already lower case), in any case. Ids are not searched;
/// players never see one.
bool skinMatches(const CustomSkin& skin, const std::string& needle) {
    if (needle.empty()) return true;
    return lowerCase(skin.name).find(needle) != std::string::npos ||
           lowerCase(skin.author).find(needle) != std::string::npos;
}

/// Everything the studio keeps between frames.
struct Studio {
    enum class Tab : std::uint8_t { Create, Browse };
    /// The Browse tab's order. Favorites is a filter as well as an order: the
    /// starred skins only, newest first.
    enum class Sort : std::uint8_t { Newest, Top, Favorites };
    /// Which of the selected shape's two colours the custom picker edits.
    enum class PickerTarget : std::uint8_t { None, Fill, Stroke };
    enum class PickerDrag : std::uint8_t { None, Square, Hue };

    Tab tab = Tab::Create;
    Sort sort = Sort::Newest;
    /// The Browse search, as typed. Kept while the panel is closed, as the
    /// sort is.
    std::string search;
    TextFieldState searchField;
    std::vector<Shape> shapes = starterSkinShapes();
    int selected = 0;
    std::string skinName;

    /// The published skin of the player's own that the Create tab is editing,
    /// "" while it makes a new one. Publish saves over that skin instead.
    std::string editingId;
    /// The new-skin draft set aside while editing, put back by Stop editing.
    std::vector<Shape> draftShapes;
    std::string draftName;

    /// What Publish sent last and when, to swallow a double click on it. The
    /// server is what stops a second copy: this only spares the reply.
    std::uint64_t sentShapes = 0;
    std::string sentName;
    double sentAt = -kPublishRepeatSeconds;

    /// The card whose code was copied last, and when, so its button can say
    /// it worked: a clipboard gives no sign of its own.
    std::string copiedId;
    double copiedAt = -1.0;

    /// The published catalog, borrowed from NetClient rather than copied.
    ///
    /// The reference keeps its own array and refills it from applyCatalog /
    /// applySkinPublished / applySkinDeleted; here the connection already
    /// maintains exactly that list -- and has to, because the world renderer
    /// resolves a wearer's skin through the same registry. Two copies of it
    /// would be two things to keep in step. Null before the first render, and
    /// whenever the panel draws without a connection.
    const NetClient* net = nullptr;
    /// Rebound every frame for the same reason: the two lists read a finger's
    /// drag off it while they lay themselves out. Null before the first render.
    const Window* window = nullptr;

    static const std::vector<CustomSkin>& noSkins() {
        static const std::vector<CustomSkin> none;
        return none;
    }
    const std::vector<CustomSkin>& catalog() const {
        return net ? net->skinCatalog() : noSkins();
    }
    bool isAdmin() const { return net && net->isSkinAdmin(); }
    const std::string& equippedId() const {
        static const std::string none;
        return net ? net->equippedSkinId() : none;
    }

    /// This frame's geometry, set before input runs so the hit tests and the
    /// paint share one answer.
    Layout layout;

    /// Regions from the frame just drawn. The panel hit-tests and hovers
    /// against the last completed render's list.
    std::vector<HitRegion> regions;
    /// What a region is cut to. The panel while laying out its chrome, and the
    /// viewport while laying out a scrolled list: a row or a card at the edge
    /// of one is painted in part, and must answer for clicks on that part
    /// only. Without this, the Equip button of a card half-scrolled off the
    /// bottom went on taking clicks below the card entirely.
    Rect regionClip;
    Action hover;
    bool hovering = false;

    Scroller shapeScroll;
    Scroller browseScroll;

    bool dragging = false;
    HandleKind dragHandle = HandleKind::Anchor;
    int dragVertex = 0;

    bool textMode = false;
    std::string textError;
    std::string textBuffer;
    /// Caret, selection and focus for the two editors. The name box is an
    /// ordinary field on the footer, so "naming" is just where the caret is.
    TextFieldState textField;
    TextFieldState nameField;

    bool confirming = false;
    std::string confirmId;
    std::string confirmName;

    /// The custom-colour picker. Open under the swatches for one colour of
    /// whichever shape is selected, and kept open as the selection moves.
    PickerTarget picker = PickerTarget::None;
    PickerDrag pickerDrag = PickerDrag::None;
    /// The picker's own colour. HSV rather than the shape's hex, because the
    /// hex forgets the hue of a grey and the saturation of a black.
    double pickH = 0, pickS = 0, pickV = 1;
    /// The colour the picker last showed or wrote. The shape's colour moving
    /// off it -- a swatch, another shape, the text editor -- re-seeds the HSV.
    std::string pickerSeen;
    /// The hex box. It shows the shape's colour except while it has the
    /// caret, when it is the player's half-typed code.
    std::string hexDraft;
    TextFieldState hexField;
    /// The picker's boxes as last drawn, for the input that runs before the
    /// next paint. Empty while the picker is not on screen.
    Rect pickerSquare, pickerHue, pickerHex;

    Shape* selectedShape() {
        if (selected < 0 || static_cast<std::size_t>(selected) >= shapes.size()) return nullptr;
        return &shapes[static_cast<std::size_t>(selected)];
    }

    std::string serializeShapes() const { return skinCode(shapes); }

    /// The board shows +-40 local units.
    double previewScale() const { return (layout.preview.w / 2) / 40.0; }
    Vec2 toPx(double lx, double ly) const {
        const Rect pr = layout.preview;
        const double s = previewScale();
        return {pr.x + pr.w / 2 + lx * s, pr.y + pr.h / 2 + ly * s};
    }
    Vec2 toLocal(Vec2 p) const {
        const Rect pr = layout.preview;
        const double s = previewScale();
        return {(p.x - (pr.x + pr.w / 2)) / s, (p.y - (pr.y + pr.h / 2)) / s};
    }

    std::vector<Handle> handles();

    void addRegion(Rect, const Action&);

    // draw
    void draw(MenuContext&);
    void drawTabs(Canvas&, Vec2 mouse);
    void drawPreview(Canvas&);
    void drawShapeList(Canvas&, Rect);
    void drawProps(Canvas&, Rect, double timeSeconds);
    double drawPalette(Canvas&, Rect, const char* caption, const std::string& current,
                       bool isFill);
    void drawPicker(Canvas&, Rect, const std::string& current, double timeSeconds);
    void drawSortRow(Canvas&, double timeSeconds);
    void drawVoteRow(Canvas&, Rect, const CustomSkin&);
    void stepper(Canvas&, Rect, const char* caption, Field, double value, double step);
    void drawTextEditor(Canvas&, Rect, double timeSeconds);
    void drawCommandHelp(Canvas&, Rect);
    void drawFooter(Canvas&, double timeSeconds);
    void drawBrowse(Canvas&, const std::string& me, double timeSeconds);
    void drawConfirm(Canvas&, Vec2 mouse);
    /// A button that registers its own hit region, so the input pass that runs
    /// before the next paint knows what was under the cursor.
    void actionButton(Canvas&, Rect, const std::string& label, const Action&,
                      std::uint32_t fill, double textSize = kBodySize);
    void actionChip(Canvas&, Rect, const std::string& label, const Action&,
                    std::uint32_t fill = kRowFill, double textSize = kCaptionSize);
    void iconBtn(Canvas&, Rect, int kind, const Action&);
    /// A pill on a card's vote row: `glyph` 0 like, 1 dislike, 2 star.
    void votePill(Canvas&, Rect, int glyph, const std::string& count, bool active,
                  const Action&);

    // input
    bool handleInput(MenuContext&);
    bool dispatch(MenuContext&, const Action&);
    void step(Field, double delta);
    void applyDrag(Vec2 mouse);
    /// The selected shape's colour that the picker edits, or null.
    std::string* pickerColour();
    /// Re-seeds the picker from the shape's colour when that moved under it.
    void syncPicker();
    /// Writes `hex` into the shape as the picker's colour; `seed` takes the
    /// HSV from it too, which a typed code does and a drag must not.
    void applyPicked(const std::string& hex, bool seed);
    void dragPicker(Vec2 mouse);
    void closePicker();
    void enterTextMode();
    void applyTextBuffer();
    /// Loads one of the player's published skins into the Create tab.
    void beginEdit(const CustomSkin&);
    /// Back to making a new skin, with the draft beginEdit set aside.
    void stopEdit();
    /// Puts a freshly loaded board in front of the player: first shape
    /// selected, no picker, the list and the Text editor showing it.
    void boardLoaded();
    std::string parseShapes(const std::string& text, std::vector<Shape>& out) const;
};

/// The studio's state belongs on SkinsPanel, but that class is declared in
/// menus.h, which this file does not own. Exactly one panel instance exists,
/// so a file-local singleton is that same object with a longer reach.
Studio& studio() {
    static Studio state;
    return state;
}

std::vector<Handle> Studio::handles() {
    std::vector<Handle> out;
    const Shape* s = selectedShape();
    if (!s) return out;
    out.push_back({HandleKind::Anchor, 0, s->x, s->y});
    if (s->t == ShapeType::Line) out.push_back({HandleKind::End, 0, s->x2, s->y2});
    if (s->t == ShapeType::Curve) {
        out.push_back({HandleKind::End, 0, s->x2, s->y2});
        out.push_back({HandleKind::Control1, 0, s->cx1, s->cy1});
        out.push_back({HandleKind::Control2, 0, s->cx2, s->cy2});
    }
    if (s->t == ShapeType::Polygon) {
        for (std::size_t i = 0; i + 1 < s->points.size(); i += 2) {
            out.push_back({HandleKind::Vertex, static_cast<int>(i / 2), s->x + s->points[i],
                           s->y + s->points[i + 1]});
        }
    }
    return out;
}

// --- widgets ---------------------------------------------------------------

void Studio::addRegion(Rect r, const Action& action) {
    const double x0 = std::max(r.x, regionClip.x);
    const double y0 = std::max(r.y, regionClip.y);
    const double x1 = std::min(r.right(), regionClip.right());
    const double y1 = std::min(r.bottom(), regionClip.bottom());
    if (x1 <= x0 || y1 <= y0) return;
    regions.push_back({{x0, y0, x1 - x0, y1 - y0}, action});
}

void Studio::actionButton(Canvas& canvas, Rect r, const std::string& caption,
                          const Action& action, std::uint32_t fill, double textSize) {
    ui::button(canvas, r, caption, hovering && hover == action, false, buttonStyle(fill, textSize));
    addRegion(r, action);
}

void Studio::actionChip(Canvas& canvas, Rect r, const std::string& caption, const Action& action,
                        std::uint32_t fill, double textSize) {
    ChipStyle style;
    style.fill = fill;
    style.border = kWell;
    style.textSize = textSize;
    ui::chip(canvas, r, caption, hovering && hover == action, style);
    addRegion(r, action);
}

/// The three glyph buttons on a shape row: raise, lower, delete. Drawn rather
/// than typed -- the bundled face has no coverage for the arrows or the cross.
void Studio::iconBtn(Canvas& canvas, Rect r, int kind, const Action& action) {
    const bool hovered = hovering && hover == action;
    const std::uint32_t fill = kind == 2 ? kDangerFill : kRowFill;
    inlaid(canvas, r, hovered ? lighten(fill, 0.15) : fill, kWell, 2.0, 4.0);

    const double cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    canvas.save();
    canvas.setLineWidth(1.8f);
    canvas.setLineCap("round");
    setStroke(canvas, kPaper);
    canvas.beginPath();
    if (kind == 0) {
        canvas.moveTo(static_cast<float>(cx - 4), static_cast<float>(cy + 2));
        canvas.lineTo(static_cast<float>(cx), static_cast<float>(cy - 3));
        canvas.lineTo(static_cast<float>(cx + 4), static_cast<float>(cy + 2));
    } else if (kind == 1) {
        canvas.moveTo(static_cast<float>(cx - 4), static_cast<float>(cy - 2));
        canvas.lineTo(static_cast<float>(cx), static_cast<float>(cy + 3));
        canvas.lineTo(static_cast<float>(cx + 4), static_cast<float>(cy - 2));
    } else {
        canvas.moveTo(static_cast<float>(cx - 3.5), static_cast<float>(cy - 3.5));
        canvas.lineTo(static_cast<float>(cx + 3.5), static_cast<float>(cy + 3.5));
        canvas.moveTo(static_cast<float>(cx + 3.5), static_cast<float>(cy - 3.5));
        canvas.lineTo(static_cast<float>(cx - 3.5), static_cast<float>(cy + 3.5));
    }
    canvas.stroke();
    canvas.restore();
    addRegion(r, action);
}

void Studio::votePill(Canvas& canvas, Rect r, int glyph, const std::string& count, bool active,
                      const Action& action) {
    const bool hovered = hovering && hover == action;
    // A cast vote wears the colour of what it says. A star says it with its
    // own fill, so its pill keeps the row's.
    std::uint32_t fill = kRowFill;
    if (active && glyph == 0) fill = kAccent;
    if (active && glyph == 1) fill = kDangerFill;
    inlaid(canvas, r, hovered ? lighten(fill, 0.15) : fill, kWell, 2.0, 4.0);

    const double cy = r.y + r.h / 2;
    const double gx = count.empty() ? r.x + r.w / 2 : r.x + 11.0;
    canvas.save();
    canvas.setLineJoin("round");
    canvas.beginPath();
    if (glyph == 2) {
        for (int i = 0; i < 10; ++i) {
            const double a = -kPi / 2 + i * kPi / 5;
            const double radius = i % 2 == 0 ? 6.5 : 2.7;
            const auto px = static_cast<float>(gx + std::cos(a) * radius);
            const auto py = static_cast<float>(cy + 0.5 + std::sin(a) * radius);
            if (i == 0) canvas.moveTo(px, py);
            else canvas.lineTo(px, py);
        }
    } else {
        // A like points up and a dislike down: drawn, as the shape rows'
        // arrows are, because the bundled face has no glyph for either.
        const double tip = glyph == 0 ? -4.0 : 4.0;
        canvas.moveTo(static_cast<float>(gx), static_cast<float>(cy + tip));
        canvas.lineTo(static_cast<float>(gx + 5.0), static_cast<float>(cy - tip * 0.85));
        canvas.lineTo(static_cast<float>(gx - 5.0), static_cast<float>(cy - tip * 0.85));
    }
    canvas.closePath();
    if (glyph != 2 || active) {
        setFill(canvas, glyph == 2 ? kStarFill : kPaper);
        canvas.fill();
    }
    setStroke(canvas, glyph == 2 && !active ? kPaper : kInk);
    canvas.setLineWidth(glyph == 2 ? 1.4f : 1.2f);
    canvas.stroke();
    canvas.restore();

    if (!count.empty()) {
        // The pill is the control, so its count is not page text to select.
        TextCaptureScope off(false);
        ui::text(canvas, count, gx + 9.0, cy, label(kCaptionSize));
    }
    addRegion(r, action);
}

/// A captioned number: the caption over a [-][value][+] row.
void Studio::stepper(Canvas& canvas, Rect r, const char* caption, Field field, double value,
                     double stepBy) {
    ui::text(canvas, caption, r.x, r.y + 7.0, label(kCaptionSize));

    const double by = r.y + 16.0, bh = r.h - 16.0, bw = 22.0;
    const double valW = std::max(20.0, r.w - bw * 2 - 8.0);

    Action down;
    down.k = Act::Step;
    down.field = field;
    down.delta = -stepBy;
    actionChip(canvas, {r.x, by, bw, bh}, "-", down, kRowFill, kBodySize);

    const Rect well{r.x + bw + 4.0, by, valW, bh};
    fillRound(canvas, well, 3.0, kWell);
    ui::text(canvas, numberText(value), well.x + well.w / 2, well.y + well.h / 2,
             label(kBodySize, Align::Centre));

    Action up;
    up.k = Act::Step;
    up.field = field;
    up.delta = stepBy;
    actionChip(canvas, {r.x + bw + valW + 8.0, by, bw, bh}, "+", up, kRowFill, kBodySize);
}

/// The swatch grid. Returns the y the next block may start at.
double Studio::drawPalette(Canvas& canvas, Rect r, const char* caption,
                           const std::string& current, bool isFill) {
    ui::text(canvas, caption, r.x, r.y + 7.0, label(kCaptionSize));
    // The first cell is "none": no fill / no outline, which is a real choice.
    // The last opens the custom-colour picker.
    const int cells = kPaletteCount + 2;
    const double size = std::min(kSwatchMax, (r.w - (cells - 1) * kSwatchGap) / cells);
    const double sy = r.y + 18.0;
    for (int i = 0; i < cells; ++i) {
        const Rect cell{r.x + i * (size + kSwatchGap), sy, size, size};
        if (i == cells - 1) {
            // The shape's own colour when no swatch is it, and the spectrum
            // otherwise -- so a colour from the picker still shows which cell
            // it came from, and the ring says so as a swatch's would.
            const bool custom = !current.empty() && !isPaletteColour(current);
            const bool open = picker == (isFill ? PickerTarget::Fill : PickerTarget::Stroke);
            canvas.save();
            clipRound(canvas, cell, 3.0);
            if (custom) {
                setFill(canvas, hexColor(current));
                canvas.fillRect(static_cast<float>(cell.x), static_cast<float>(cell.y),
                                static_cast<float>(cell.w), static_cast<float>(cell.h));
            } else {
                const PickerRamps& ramps = pickerRamps();
                canvas.drawImage(ramps.hue.data(), 1, kHueTexels, static_cast<float>(cell.x),
                                 static_cast<float>(cell.y), static_cast<float>(cell.w),
                                 static_cast<float>(cell.h), 1.0f, kHueKey);
            }
            canvas.restore();
            strokeRound(canvas, {cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2}, 3.0,
                        custom ? kAccentPurple : open ? kPaper : kInk, custom || open ? 2.5 : 1.0);
            Action pick;
            pick.k = Act::Picker;
            pick.i = isFill ? 0 : 1;
            addRegion(cell, pick);
            continue;
        }
        const std::string colour = i == 0 ? std::string() : std::string(kPalette[i - 1]);
        const bool isCurrent = current == colour;

        if (colour.empty()) {
            fillRound(canvas, cell, 3.0, kSwatchNone);
            strokeRound(canvas, {cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1}, 3.0,
                        kSwatchNoneEdge, 1.0);
            canvas.save();
            setStroke(canvas, kSwatchSlash);
            canvas.setLineWidth(1.5f);
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(cell.x + 4), static_cast<float>(cell.bottom() - 4));
            canvas.lineTo(static_cast<float>(cell.right() - 4), static_cast<float>(cell.y + 4));
            canvas.stroke();
            canvas.restore();
        } else {
            fillRound(canvas, cell, 3.0, hexColor(colour));
        }
        // The selected swatch wears the accent ring; every other one keeps the
        // hairline that separates a white or near-black chip from the card.
        strokeRound(canvas, {cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2}, 3.0,
                    isCurrent ? kAccentPurple : kInk, isCurrent ? 2.5 : 1.0);

        Action pick;
        pick.k = isFill ? Act::Fill : Act::Stroke;
        pick.color = colour;
        addRegion(cell, pick);
    }
    return sy + size + 14.0;
}

// --- the panel -------------------------------------------------------------

void Studio::drawTabs(Canvas& canvas, Vec2 mouse) {
    const Rect row = layout.tabs;
    // The first tab says which it is doing: a new skin, or one of yours.
    const char* const labels[] = {editingId.empty() ? "Create" : "Editing", "Browse"};
    for (int i = 0; i < 2; ++i) {
        const Rect r{row.x + i * (kTabWidth + kTabGap), row.y, kTabWidth, row.h};
        const bool active = static_cast<int>(tab) == i;
        Action pick;
        pick.k = Act::Tab;
        pick.i = i;
        ui::button(canvas, r, labels[i], !active && r.contains(mouse), false,
                   buttonStyle(active ? kAccentPurple : kNeutralFill, kBodySize));
        addRegion(r, pick);
    }

    // The row's right end carries the tab's own one control: the editing mode
    // while creating, and the way out of a skin while browsing.
    if (tab == Tab::Create) {
        Action mode;
        mode.k = Act::TextMode;
        const Rect r{row.right() - 110.0, row.y, 110.0, row.h};
        actionButton(canvas, r, textMode ? "Visual editor" : "Text editor", mode,
                     textMode ? kAccentPurple : kNeutralFill);
    } else {
        Action unequip;
        unequip.k = Act::Unequip;
        const Rect r{row.right() - 110.0, row.y, 110.0, row.h};
        actionButton(canvas, r, "Unequip", unequip, kNeutralFill);
    }
}

void Studio::drawPreview(Canvas& canvas) {
    const Rect pr = layout.preview;
    canvas.save();
    // Sunk into the card the way every other surface on it is: the well's
    // colour as a frame, the board inside it.
    inlaid(canvas, pr, kBoard, kWell, 3.0, 6.0);
    canvas.save();
    clipRound(canvas, {pr.x + 3, pr.y + 3, pr.w - 6, pr.h - 6}, 4.0);
    canvas.translate(static_cast<float>(pr.x + pr.w / 2), static_cast<float>(pr.y + pr.h / 2));
    const double s = previewScale();

    setStroke(canvas, kPaper, 0.25);
    canvas.setLineDash({4.0f, 4.0f});
    canvas.setLineWidth(1.0f);
    canvas.beginPath();
    canvas.arc(0.0f, 0.0f, static_cast<float>(25 * s), 0.0f, static_cast<float>(kPi * 2));
    canvas.stroke();
    canvas.setLineDash({});

    renderSkinShapes(canvas, shapes, 25 * s);
    canvas.restore();

    // Handles are drawn AFTER the clip is released, in panel space, so a
    // handle dragged past the edge stays grabbable outside the board.
    if (!textMode) {
        const Shape* sel = selectedShape();
        if (sel && sel->t == ShapeType::Curve) {
            const Vec2 a = toPx(sel->x, sel->y);
            const Vec2 b = toPx(sel->x2, sel->y2);
            const Vec2 g1 = toPx(sel->cx1, sel->cy1);
            const Vec2 g2 = toPx(sel->cx2, sel->cy2);
            canvas.save();
            setStroke(canvas, kPaper, 0.55);
            canvas.setLineWidth(1.0f);
            canvas.setLineDash({3.0f, 3.0f});
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(a.x), static_cast<float>(a.y));
            canvas.lineTo(static_cast<float>(g1.x), static_cast<float>(g1.y));
            canvas.moveTo(static_cast<float>(b.x), static_cast<float>(b.y));
            canvas.lineTo(static_cast<float>(g2.x), static_cast<float>(g2.y));
            canvas.stroke();
            canvas.restore();
        }
        for (const Handle& h : handles()) {
            const Vec2 p = toPx(h.lx, h.ly);
            const bool control = h.kind == HandleKind::Control1 || h.kind == HandleKind::Control2;
            setFill(canvas, control ? kHandleControl
                                    : h.kind == HandleKind::Anchor ? kAccentPurple : kPaper);
            setStroke(canvas, kInk);
            canvas.setLineWidth(1.0f);
            canvas.beginPath();
            // Control points read as circles; anchors and vertices stay square.
            if (control) {
                canvas.arc(static_cast<float>(p.x), static_cast<float>(p.y), 3.5f, 0.0f,
                           static_cast<float>(kPi * 2));
            } else {
                canvas.rect(static_cast<float>(p.x - 3), static_cast<float>(p.y - 3), 6.0f, 6.0f);
            }
            canvas.fill();
            canvas.stroke();
        }
    }
    canvas.restore();

    ui::text(canvas, textMode ? "Live preview" : "Drag the handles to shape it",
             pr.x + pr.w / 2, pr.bottom() + 12.0, label(kCaptionSize, Align::Centre));
}

void Studio::drawShapeList(Canvas& canvas, Rect view) {
    if (view.h <= 0) return;
    inlaid(canvas, view, kWell, kSkinsSkin.border, 2.0, 6.0);

    shapeScroll.contentHeight = static_cast<double>(shapes.size()) * kRowPitch + 8.0;
    shapeScroll.viewHeight = view.h;
    if (window && !confirming) {
        shapeScroll.offset -= touchScroll(*window, view, shapeScroll.maxOffset() > 0);
    }
    shapeScroll.offset = clamp(shapeScroll.offset, 0.0, shapeScroll.maxOffset());

    canvas.save();
    clipRound(canvas, {view.x + 2, view.y + 2, view.w - 4, view.h - 4}, 5.0);
    const Rect outerClip = regionClip;
    regionClip = view;

    const bool scrolls = shapeScroll.contentHeight > view.h;
    const double rowW = view.w - 12.0 - (scrolls ? kScrollbarWidth + 2.0 : 0.0);
    double ry = view.y + 4.0 - shapeScroll.offset;
    for (std::size_t i = 0; i < shapes.size(); ++i) {
        const Shape& s = shapes[i];
        if (ry + kRowCard > view.y && ry < view.bottom()) {
            const bool sel = static_cast<int>(i) == selected;
            const Rect row{view.x + 6.0, ry, rowW, kRowCard};
            if (sel) inlaid(canvas, row, kAccentPurple, kSkinsSkin.border, 2.0, 4.0);

            // The shape's own colour, as the swatch that identifies its row.
            const Rect swatch{row.x + 7.0, row.y + (kRowCard - 12.0) * 0.5, 12.0, 12.0};
            fillRound(canvas, swatch, 2.0, hexColor(!s.fill.empty() ? s.fill : s.stroke, kInk));
            strokeRound(canvas, swatch, 2.0, kInk, 1.0);

            // Not selectable: the row IS the control that picks this shape, so
            // its name belongs to the button rather than to the page.
            {
                TextCaptureScope off(false);
                ui::text(canvas, std::to_string(i + 1) + ". " + shortType(s.t),
                         swatch.right() + 8.0, row.y + kRowCard * 0.5, label(kBodySize));
            }

            const double bx = row.right() - 3.0 * 22.0 - 2.0 * 3.0 - 4.0;
            const double by = row.y + (kRowCard - 20.0) * 0.5;
            Action up;
            up.k = Act::MoveShape;
            up.i = static_cast<int>(i);
            up.dir = -1;
            iconBtn(canvas, {bx, by, 22.0, 20.0}, 0, up);
            Action down = up;
            down.dir = 1;
            iconBtn(canvas, {bx + 25.0, by, 22.0, 20.0}, 1, down);
            Action del;
            del.k = Act::DelShape;
            del.i = static_cast<int>(i);
            iconBtn(canvas, {bx + 50.0, by, 22.0, 20.0}, 2, del);

            Action pick;
            pick.k = Act::SelectShape;
            pick.i = static_cast<int>(i);
            addRegion({row.x, row.y, bx - row.x - 4.0, kRowCard}, pick);
        }
        ry += kRowPitch;
    }
    canvas.restore();
    regionClip = outerClip;

    scrollbar(canvas, {view.x + 2, view.y + 5, view.w - 7, view.h - 10},
              shapeScroll.contentHeight, shapeScroll.offset, kAccentPurple, kScrollbarWidth);
}

void Studio::drawProps(Canvas& canvas, Rect r, double timeSeconds) {
    ui::text(canvas, "Selected shape", r.x, r.y + 7.0, label(kSectionSize));
    const Shape* s = selectedShape();
    if (!s) {
        ui::text(canvas, "Nothing selected \xe2\x80\x94 add a shape below.", r.x, r.y + 30.0,
                 label(kBodySize));
        return;
    }

    struct Row {
        const char* caption;
        Field field;
        double value;
        double step;
    };
    std::vector<Row> rows;
    rows.push_back({"X", Field::X, s->x, 1});
    rows.push_back({"Y", Field::Y, s->y, 1});
    if (s->t == ShapeType::Circle) rows.push_back({"Radius", Field::R, s->r, 1});
    if (s->t == ShapeType::Ellipse || s->t == ShapeType::Rect) {
        rows.push_back({"Width", Field::Rx, s->rx, 1});
        rows.push_back({"Height", Field::Ry, s->ry, 1});
    }
    // Lines and curves are authored by dragging absolute endpoints, which the
    // handles report unrotated -- so no rotation control for those.
    if (s->t != ShapeType::Line && s->t != ShapeType::Curve) {
        rows.push_back({"Rotation", Field::Rot, s->rot, 15});
    }
    rows.push_back({"Outline width", Field::Sw, s->sw, 1});

    constexpr double kStepperH = 40.0;
    constexpr double kStepperGap = 8.0;
    double cy = r.y + 22.0;
    const double colW = (r.w - 12.0) / 2;
    for (std::size_t i = 0; i < rows.size(); ++i) {
        const std::size_t col = i % 2, row = i / 2;
        stepper(canvas,
                {r.x + static_cast<double>(col) * (colW + 12.0),
                 cy + static_cast<double>(row) * (kStepperH + kStepperGap), colW, kStepperH},
                rows[i].caption, rows[i].field, rows[i].value, rows[i].step);
    }
    cy += static_cast<double>((rows.size() + 1) / 2) * (kStepperH + kStepperGap) + 2.0;

    if (s->t == ShapeType::Polygon) {
        Action add;
        add.k = Act::AddVertex;
        actionChip(canvas, {r.x, cy, 96.0, 24.0}, "Add point", add, kRowFill, kBodySize);
        Action del;
        del.k = Act::DelVertex;
        actionChip(canvas, {r.x + 104.0, cy, 96.0, 24.0}, "Remove point", del, kRowFill,
                   kBodySize);
        cy += 32.0;
    }

    if (s->t == ShapeType::Curve) {
        ui::text(canvas, "Drag the two round handles to bend it;", r.x, cy + 8.0,
                 label(kCaptionSize));
        ui::text(canvas, "a fill closes the curve into a blob.", r.x, cy + 22.0,
                 label(kCaptionSize));
        cy += 34.0;
    }

    if (s->t != ShapeType::Line) {
        cy = drawPalette(canvas, {r.x, cy, r.w, 0}, "Fill", s->fill, true);
    }
    cy = drawPalette(canvas, {r.x, cy, r.w, 0}, "Outline", s->stroke, false);

    syncPicker();
    if (const std::string* colour = pickerColour()) {
        drawPicker(canvas, {r.x, cy - 4.0, r.w, r.bottom() - (cy - 4.0)}, *colour, timeSeconds);
    }
}

void Studio::drawPicker(Canvas& canvas, Rect r, const std::string& current,
                        double timeSeconds) {
    const double squareH = std::min(kPickerSquareMaxH, r.h - kPickerCaption - 4.0);
    if (squareH < kPickerSquareMinH) return;

    ui::text(canvas, picker == PickerTarget::Fill ? "Custom fill" : "Custom outline", r.x,
             r.y + 7.0, label(kCaptionSize));
    Action close;
    close.k = Act::Picker;
    close.dir = 1;
    actionChip(canvas, {r.right() - 56.0, r.y - 2.0, 56.0, 18.0}, "Close", close);

    const double top = r.y + kPickerCaption;
    const Rect square{r.x, top, kPickerSquareW, squareH};
    const Rect hue{square.right() + 8.0, top, kHueStripW, squareH};
    pickerSquare = square;
    pickerHue = hue;

    const PickerRamps& ramps = pickerRamps();
    const auto image = [&](const std::vector<std::uint8_t>& px, int w, int h, Rect box,
                           std::uint32_t key) {
        canvas.drawImage(px.data(), w, h, static_cast<float>(box.x), static_cast<float>(box.y),
                         static_cast<float>(box.w), static_cast<float>(box.h), 1.0f, key);
    };
    canvas.save();
    setFill(canvas, hsvToRgb(pickH, 1.0, 1.0));
    canvas.fillRect(static_cast<float>(square.x), static_cast<float>(square.y),
                    static_cast<float>(square.w), static_cast<float>(square.h));
    image(ramps.saturation, kRampTexels, 1, square, kSaturationKey);
    image(ramps.value, 1, kRampTexels, square, kValueKey);
    image(ramps.hue, 1, kHueTexels, hue, kHueKey);
    setStroke(canvas, kInk);
    canvas.setLineWidth(1.0f);
    for (const Rect& box : {square, hue}) {
        canvas.strokeRect(static_cast<float>(box.x - 0.5), static_cast<float>(box.y - 0.5),
                          static_cast<float>(box.w + 1.0), static_cast<float>(box.h + 1.0));
    }

    // Where the colour is: a ring on the square, a bar across the strip.
    const double mx = square.x + pickS * square.w;
    const double my = square.y + (1.0 - pickV) * square.h;
    canvas.beginPath();
    canvas.arc(static_cast<float>(mx), static_cast<float>(my), 5.0f, 0.0f,
               static_cast<float>(kPi * 2));
    canvas.setLineWidth(3.0f);
    canvas.stroke();
    setStroke(canvas, kPaper);
    canvas.setLineWidth(1.5f);
    canvas.stroke();
    canvas.restore();
    const double hy = hue.y + pickH / 360.0 * hue.h;
    const Rect bar{hue.x - 3.0, hy - 2.5, hue.w + 6.0, 5.0};
    fillRound(canvas, bar, 2.0, kPaper);
    strokeRound(canvas, bar, 2.0, kInk, 1.0);

    Action pickSquare;
    pickSquare.k = Act::PickSquare;
    addRegion(square, pickSquare);
    // A few pixels either side: the strip is narrow enough to miss.
    Action pickHue;
    pickHue.k = Act::PickHue;
    addRegion({hue.x - 4.0, hue.y, hue.w + 8.0, hue.h}, pickHue);

    // The colour itself, then its code.
    const double cx = hue.right() + 14.0;
    const Rect chip{cx, top, r.right() - cx, 26.0};
    if (current.empty()) {
        fillRound(canvas, chip, 3.0, kSwatchNone);
        ui::text(canvas, picker == PickerTarget::Fill ? "No fill" : "No outline",
                 chip.x + chip.w / 2, chip.y + chip.h / 2, label(kCaptionSize, Align::Centre));
    } else {
        fillRound(canvas, chip, 3.0, hexColor(current));
    }
    strokeRound(canvas, {chip.x + 0.5, chip.y + 0.5, chip.w - 1, chip.h - 1}, 3.0, kInk, 1.0);

    const Rect field{cx, chip.bottom() + 8.0, chip.w, kHexFieldH};
    pickerHex = field;
    inputField(canvas, field, hexDraft, "#rrggbb", hexField.focused, timeSeconds, &hexField);
    double lineY = field.bottom() + 12.0;
    for (const char* line : {"Drag in the square and the", "strip, or type a hex code."}) {
        if (lineY > square.bottom()) break;
        ui::text(canvas, line, cx, lineY, label(kCaptionSize));
        lineY += 14.0;
    }
}

void Studio::drawTextEditor(Canvas& canvas, Rect r, double timeSeconds) {
    // The standard input, laid out a line at a time.
    const Rect band = inputFieldPlate(canvas, r);
    canvas.save();
    clipRect(canvas, band);
    TextStyle body;
    body.size = kInputTextSize;
    body.fill = kInk;
    body.strokeWidth = 0;

    const TextSelection& sel = textField.selection;
    std::size_t lineStart = 0;
    int lineIndex = 0;
    for (std::size_t i = 0; i <= textBuffer.size(); ++i) {
        if (i != textBuffer.size() && textBuffer[i] != '\n') continue;
        const std::string line = textBuffer.substr(lineStart, i - lineStart);
        const double baseY = editorFirstLine(r) + kEditorLineHeight * lineIndex;
        TextRun run;
        run.text = line;
        run.originX = editorTextX(r);
        run.size = kInputTextSize;

        // One highlight per line, cut to the part of that line the selection
        // actually covers -- a multi-line selection is a stack of these.
        if (sel.end() > lineStart && sel.begin() <= i) {
            TextSelection onLine;
            onLine.anchor = sel.begin() > lineStart ? sel.begin() - lineStart : 0;
            onLine.caret = std::min(sel.end(), i) - lineStart;
            selectionHighlight(canvas, run, onLine,
                               Rect{band.x, baseY - kEditorLineHeight * 0.5, band.w,
                                    kEditorLineHeight});
        }
        if (baseY < band.bottom()) ui::text(canvas, line, run.originX, baseY, body);

        if (sel.caret >= lineStart && sel.caret <= i && caretVisible(textField, timeSeconds)) {
            const double caretX = xOfIndex(run, sel.caret - lineStart);
            setFill(canvas, kInk);
            canvas.fillRect(static_cast<float>(caretX),
                            static_cast<float>(baseY - kInputTextSize * 0.6), 1.0f,
                            static_cast<float>(kInputTextSize * 1.2));
        }
        lineStart = i + 1;
        ++lineIndex;
    }
    canvas.restore();
}

void Studio::drawCommandHelp(Canvas& canvas, Rect r) {
    double hy = r.y + 8.0;
    ui::text(canvas, "Canvas commands", r.x, hy, label(kSectionSize));
    hy += 20.0;
    static const char* const kHelp[] = {
        "One shape per line:",
        "type x=.. y=.. fill=#rrggbb",
        "types: circle ellipse rect",
        "       line polygon curve",
        "circle: r=",
        "ellipse / rect: rx= ry=",
        "line: x2= y2=",
        "polygon: points=x,y,x,y",
        "curve: x2= y2= cx1= cy1=",
        "       cx2= cy2=",
        "optional: rot= stroke= sw=",
    };
    for (const char* line : kHelp) {
        if (hy > r.bottom()) break;
        ui::text(canvas, line, r.x, hy, label(kCaptionSize));
        hy += 15.0;
    }
    if (textError.empty()) return;
    hy += 6.0;
    // Wrapped by hand at the column width: a parse error names the line and
    // the key, and both together overrun a 170px column.
    std::string rest = textError;
    while (!rest.empty() && hy <= r.bottom()) {
        std::size_t take = rest.size();
        while (take > 1 && measure(rest.substr(0, take), kCaptionSize) > r.w) --take;
        if (take < rest.size()) {
            const std::size_t space = rest.rfind(' ', take);
            if (space != std::string::npos && space > 0) take = space;
        }
        ui::text(canvas, rest.substr(0, take), r.x, hy, label(kCaptionSize, Align::Left,
                                                              kErrorText));
        rest.erase(0, take);
        while (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);
        hy += 15.0;
    }
}

void Studio::drawFooter(Canvas& canvas, double timeSeconds) {
    const Rect r = layout.footer;
    const Rect field = footerNameField(r);
    inputField(canvas, field, skinName, "Skin name", nameField.focused, timeSeconds, &nameField);

    // Editing, the two become the way out of the edit and the save over the
    // skin being edited. Reset has no place there: the way back to the skin
    // as published is to stop and press its Edit again.
    const bool editing = !editingId.empty();
    Action reset;
    reset.k = editing ? Act::StopEdit : Act::Reset;
    actionButton(canvas, {r.right() - kPublishW - kResetW - 8.0, r.y, kResetW, r.h},
                 editing ? "Stop editing" : "Reset", reset, kNeutralFill);
    Action publish;
    publish.k = Act::Publish;
    actionButton(canvas, {r.right() - kPublishW, r.y, kPublishW, r.h},
                 editing ? "Save changes" : "Publish", publish, kAccent);
}

void Studio::drawSortRow(Canvas& canvas, double timeSeconds) {
    static const char* const kLabels[] = {"Newest", "Top rated", "Favorites"};
    const double y = layout.tabs.bottom() + 12.0;
    for (int i = 0; i < 3; ++i) {
        Action pick;
        pick.k = Act::Sort;
        pick.i = i;
        actionChip(canvas, {layout.body.x + i * (kSortWidth + kTabGap), y, kSortWidth, kSortHeight},
                   kLabels[i], pick, static_cast<int>(sort) == i ? kAccentPurple : kNeutralFill,
                   kBodySize);
    }
    inputField(canvas, browseSearchField(layout), search, "Search by name or author",
               searchField.focused, timeSeconds, &searchField);
}

void Studio::drawVoteRow(Canvas& canvas, Rect r, const CustomSkin& skin) {
    const SkinVote mine = net ? net->skinVote(skin.id) : SkinVote::None;
    const bool starred = net && net->isFavoriteSkin(skin.id);
    const double pillW = (r.w - kStarW - 8.0) / 2;
    Action like;
    like.k = Act::Like;
    like.id = skin.id;
    votePill(canvas, {r.x, r.y, pillW, r.h}, 0, abbreviate(skin.likes), mine == SkinVote::Like,
             like);
    Action dislike = like;
    dislike.k = Act::Dislike;
    votePill(canvas, {r.x + pillW + 4.0, r.y, pillW, r.h}, 1, abbreviate(skin.dislikes),
             mine == SkinVote::Dislike, dislike);
    Action star = like;
    star.k = Act::Favorite;
    votePill(canvas, {r.right() - kStarW, r.y, kStarW, r.h}, 2, {}, starred, star);
}

void Studio::drawBrowse(Canvas& canvas, const std::string& me, double timeSeconds) {
    drawSortRow(canvas, timeSeconds);

    const Rect view = browseBody(layout);
    const std::vector<CustomSkin>& skins = catalog();
    if (skins.empty()) {
        ui::text(canvas, "Nothing published yet. Make one in the Create tab.", view.x,
                 view.y + 24.0, label(kBodySize));
        return;
    }

    // Four to a row rather than three: a 135px card fits its own preview,
    // its name and a full-width Equip button, which the old three-up card did
    // not -- its preview was derived from the card WIDTH and overran the
    // bottom edge, so the buttons painted on top of the artwork.
    constexpr int cols = 4;
    constexpr double kGap = 10.0;
    constexpr double kCardH = 240.0;
    const double cardW = (view.w - (cols - 1) * kGap - kScrollbarWidth - 4.0) / cols;
    const double preview = cardW - 30.0;

    // The search narrows whichever list the sort chose, Favorites included.
    const std::size_t first = search.find_first_not_of(' ');
    const std::string needle =
        first == std::string::npos
            ? std::string()
            : lowerCase(search.substr(first, search.find_last_not_of(' ') - first + 1));
    std::vector<const CustomSkin*> sorted;
    sorted.reserve(skins.size());
    bool anyListed = false;
    for (const CustomSkin& skin : skins) {
        if (sort == Sort::Favorites && !(net && net->isFavoriteSkin(skin.id))) continue;
        anyListed = true;
        if (!skinMatches(skin, needle)) continue;
        sorted.push_back(&skin);
    }
    if (sorted.empty()) {
        const std::string why =
            !anyListed ? std::string("No favorites yet. Press the star on a skin to keep it here.")
                         : "No skins match \"" + clipChars(search, 24) + "\".";
        ui::text(canvas, why, view.x, view.y + 24.0, label(kBodySize));
        return;
    }
    // Top rated is the net score, then the plainer favourite of two that tie
    // on it (more likes), then the newer -- so a fresh skin nobody has voted
    // on yet still sorts the way the Newest tab would put it.
    const bool byScore = sort == Sort::Top;
    std::stable_sort(sorted.begin(), sorted.end(),
                     [byScore](const CustomSkin* a, const CustomSkin* b) {
                         if (byScore) {
                             const auto score = [](const CustomSkin* s) {
                                 return static_cast<std::int64_t>(s->likes) -
                                        static_cast<std::int64_t>(s->dislikes);
                             };
                             if (score(a) != score(b)) return score(a) > score(b);
                             if (a->likes != b->likes) return a->likes > b->likes;
                         }
                         return a->createdAt > b->createdAt;
                     });

    const double rows = std::ceil(static_cast<double>(sorted.size()) / cols);
    browseScroll.contentHeight = rows * (kCardH + kGap) - kGap;
    browseScroll.viewHeight = view.h;
    if (window && !confirming) {
        browseScroll.offset -= touchScroll(*window, view, browseScroll.maxOffset() > 0);
    }
    browseScroll.offset = clamp(browseScroll.offset, 0.0, browseScroll.maxOffset());

    canvas.save();
    clipRect(canvas, view);
    const Rect outerClip = regionClip;
    regionClip = view;
    for (std::size_t i = 0; i < sorted.size(); ++i) {
        const CustomSkin& skin = *sorted[i];
        const std::size_t col = i % cols, row = i / cols;
        const Rect card{view.x + static_cast<double>(col) * (cardW + kGap),
                        view.y + static_cast<double>(row) * (kCardH + kGap) - browseScroll.offset,
                        cardW, kCardH};
        if (card.bottom() < view.y || card.y > view.bottom()) continue;
        const bool equipped = skin.id == equippedId();
        inlaid(canvas, card, kWell, equipped ? kAccentPurple : kSkinsSkin.border, 2.0, 6.0);

        const Rect board{card.x + (cardW - preview) * 0.5, card.y + 10.0, preview, preview};
        canvas.save();
        inlaid(canvas, board, kBoard, kWell, 2.0, 4.0);
        clipRound(canvas, {board.x + 2, board.y + 2, board.w - 4, board.h - 4}, 3.0);
        canvas.translate(static_cast<float>(board.x + board.w / 2),
                         static_cast<float>(board.y + board.h / 2));
        renderSkinShapes(canvas, skin.shapes, board.w * 0.36);
        canvas.restore();

        ui::text(canvas, clipChars(skin.name, 14), card.x + cardW * 0.5, board.bottom() + 14.0,
                 label(kBodySize, Align::Centre));
        ui::text(canvas, "by " + clipChars(skin.author, 14), card.x + cardW * 0.5,
                 board.bottom() + 30.0, label(kCaptionSize, Align::Centre));
        const double actionsY = card.bottom() - 32.0;
        const double toolsY = actionsY - 6.0 - kToolRowH;
        drawVoteRow(canvas, {card.x + 8.0, toolsY - 6.0 - kVoteRowH, cardW - 16.0, kVoteRowH},
                    skin);

        const bool mine = lowerCase(skin.author) == me;
        const bool canDelete = isAdmin() || mine;

        // Copy code on every card; Edit only on the player's own, and not on
        // an admin's view of anyone else's -- a takedown is theirs to make,
        // a redraw under somebody else's name is not.
        const double copyW = cardW - 16.0 - (mine ? kEditW + 4.0 : 0.0);
        Action copy;
        copy.k = Act::CopyCode;
        copy.id = skin.id;
        const bool copied = copiedId == skin.id && timeSeconds - copiedAt < kCopiedSeconds;
        actionChip(canvas, {card.x + 8.0, toolsY, copyW, kToolRowH},
                   copied ? "Copied!" : "Copy code", copy, copied ? kAccent : kRowFill);
        if (mine) {
            Action edit;
            edit.k = Act::Edit;
            edit.id = skin.id;
            const bool editingThis = editingId == skin.id;
            actionChip(canvas, {card.x + 8.0 + copyW + 4.0, toolsY, kEditW, kToolRowH}, "Edit",
                       edit, editingThis ? kAccentPurple : kRowFill);
        }

        // A takedown is a glyph beside the Equip button, not a second labelled
        // one: at this card width two labelled buttons side by side left
        // neither of them legible, and a cross laid over the card's corner
        // covered the artwork it belongs to.
        const double equipW = cardW - 16.0 - (canDelete ? 28.0 : 0.0);
        Action equip;
        equip.k = Act::Equip;
        equip.id = skin.id;
        actionButton(canvas, {card.x + 8.0, actionsY, equipW, 24.0},
                     equipped ? "Equipped" : "Equip", equip,
                     equipped ? kAccent : kAccentPurple, kBodySize);
        if (canDelete) {
            Action del;
            del.k = Act::Delete;
            del.id = skin.id;
            del.name = skin.name;
            iconBtn(canvas, {card.x + 8.0 + equipW + 4.0, actionsY, 24.0, 24.0}, 2, del);
        }
    }
    canvas.restore();
    regionClip = outerClip;

    scrollbar(canvas, {view.x, view.y, view.w, view.h - 5.0}, browseScroll.contentHeight,
              browseScroll.offset, kAccentPurple, kScrollbarWidth);
}

void Studio::drawConfirm(Canvas& canvas, Vec2 mouse) {
    // A confirm is modal: nothing behind it can be clicked, so the regions
    // drawn so far are dropped rather than merely painted over.
    regions.clear();
    regionClip = layout.panel;
    const Rect box{layout.panel.x + (layout.panel.w - 320.0) * 0.5,
                   layout.panel.y + (layout.panel.h - 116.0) * 0.5, 320.0, 116.0};
    panelCard(canvas, box, kSkinsSkin);
    ui::text(canvas, "Delete \"" + clipChars(confirmName, 22) + "\"?", box.x + box.w * 0.5,
             box.y + 38.0, label(kSectionSize, Align::Centre));

    constexpr double kBtnW = 116.0, kBtnH = 30.0;
    const double by = box.bottom() - kBtnH - 18.0;
    const Rect cancel{box.x + box.w * 0.5 - kBtnW - 8.0, by, kBtnW, kBtnH};
    const Rect accept{box.x + box.w * 0.5 + 8.0, by, kBtnW, kBtnH};

    Action no;
    no.k = Act::CancelDelete;
    ui::button(canvas, cancel, "Cancel", cancel.contains(mouse), false,
               buttonStyle(kNeutralFill));
    addRegion(cancel, no);

    Action yes;
    yes.k = Act::ConfirmDelete;
    ui::button(canvas, accept, "Delete", accept.contains(mouse), false,
               buttonStyle(kDangerFill));
    addRegion(accept, yes);
}

void Studio::draw(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Vec2 mouse = ctx.mouse();
    regions.clear();
    // Set again if the picker is drawn this frame.
    pickerSquare = pickerHue = pickerHex = Rect{};

    const Rect panel = layout.panel;
    regionClip = panel;
    panelCard(canvas, panel, kSkinsSkin);
    panelHeading(canvas, panel, "Skin Studio");

    const Rect closeRect = closeButtonRect(panel);
    ui::panelClose(canvas, closeRect, closeRect.contains(mouse));
    Action close;
    close.k = Act::Close;
    addRegion(closeRect, close);

    drawTabs(canvas, mouse);

    if (tab == Tab::Create) {
        drawPreview(canvas);
        if (textMode) {
            drawCommandHelp(canvas, {layout.left.x, layout.preview.bottom() + 22.0,
                                     layout.left.w, layout.body.bottom() -
                                                        (layout.preview.bottom() + 22.0)});
            drawTextEditor(canvas, layout.right, ctx.timeSeconds);
        } else {
            const double listTop = layout.preview.bottom() + 22.0;
            ui::text(canvas, "Add shape", layout.left.x, listTop + 7.0,
                     label(kSectionSize));

            // Two rows of three; six types do not fit legibly on one.
            static const ShapeType kTypes[] = {ShapeType::Circle,  ShapeType::Ellipse,
                                               ShapeType::Rect,    ShapeType::Polygon,
                                               ShapeType::Line,    ShapeType::Curve};
            constexpr int perRow = 3;
            constexpr double gap = 4.0;
            const double bw = (layout.left.w - (perRow - 1) * gap) / perRow;
            const double by = listTop + 20.0;
            for (int i = 0; i < 6; ++i) {
                const int col = i % perRow, row = i / perRow;
                Action add;
                add.k = Act::AddShape;
                add.i = static_cast<int>(kTypes[i]);
                actionChip(canvas,
                           {layout.left.x + col * (bw + gap), by + row * 26.0, bw, 22.0},
                           shortType(kTypes[i]), add);
            }
            const double afterChips = by + 2 * 26.0 + 6.0;
            drawShapeList(canvas, {layout.left.x, afterChips, layout.left.w,
                                   layout.body.bottom() - afterChips});
            drawProps(canvas, layout.right, ctx.timeSeconds);
        }
        drawFooter(canvas, ctx.timeSeconds);
    } else {
        drawBrowse(canvas, lowerCase(ctx.net.profile().username), ctx.timeSeconds);
    }

    if (confirming) drawConfirm(canvas, mouse);
}

// --- input -----------------------------------------------------------------

void Studio::step(Field field, double delta) {
    Shape* s = selectedShape();
    if (!s) return;
    const auto set = [delta](double v, double lo, double hi) {
        return round1(clamp(v + delta, lo, hi));
    };
    switch (field) {
        case Field::X: s->x = set(s->x, -kSkinCoordLimit, kSkinCoordLimit); break;
        case Field::Y: s->y = set(s->y, -kSkinCoordLimit, kSkinCoordLimit); break;
        case Field::R: s->r = set(s->r, 0.5, kSkinRadiusLimit); break;
        case Field::Rx: s->rx = set(s->rx, 0.5, kSkinRadiusLimit); break;
        case Field::Ry: s->ry = set(s->ry, 0.5, kSkinRadiusLimit); break;
        case Field::Rot: s->rot = set(s->rot, -180.0, 180.0); break;
        case Field::Sw: s->sw = set(s->sw, 0.0, kMaxSkinStrokeWidth); break;
    }
}

void Studio::applyDrag(Vec2 mouse) {
    Shape* s = selectedShape();
    if (!s) return;
    const Vec2 l = toLocal(mouse);
    const double cx = clamp(l.x, -kSkinCoordLimit, kSkinCoordLimit);
    const double cy = clamp(l.y, -kSkinCoordLimit, kSkinCoordLimit);
    switch (dragHandle) {
        case HandleKind::Anchor: s->x = round1(cx); s->y = round1(cy); break;
        case HandleKind::End: s->x2 = round1(cx); s->y2 = round1(cy); break;
        case HandleKind::Control1: s->cx1 = round1(cx); s->cy1 = round1(cy); break;
        case HandleKind::Control2: s->cx2 = round1(cx); s->cy2 = round1(cy); break;
        case HandleKind::Vertex: {
            const std::size_t i = static_cast<std::size_t>(dragVertex) * 2;
            if (i + 1 < s->points.size()) {
                s->points[i] = round1(cx - s->x);
                s->points[i + 1] = round1(cy - s->y);
            }
            break;
        }
    }
}

std::string* Studio::pickerColour() {
    Shape* s = selectedShape();
    if (s == nullptr) return nullptr;
    switch (picker) {
        case PickerTarget::Fill: return s->t == ShapeType::Line ? nullptr : &s->fill;
        case PickerTarget::Stroke: return &s->stroke;
        case PickerTarget::None: break;
    }
    return nullptr;
}

void Studio::syncPicker() {
    const std::string* colour = pickerColour();
    if (colour == nullptr) return;
    if (!colour->empty() && *colour != pickerSeen) rgbToHsv(hexColor(*colour), pickH, pickS, pickV);
    pickerSeen = *colour;
    if (!hexField.focused) hexDraft = *colour;
}

void Studio::applyPicked(const std::string& hex, bool seed) {
    std::string* colour = pickerColour();
    if (colour == nullptr) return;
    *colour = hex;
    // As picking an outline swatch does: a colour with no width draws nothing.
    if (picker == PickerTarget::Stroke) {
        if (Shape* s = selectedShape(); s->sw <= 0) s->sw = 2;
    }
    if (seed) rgbToHsv(hexColor(hex), pickH, pickS, pickV);
    pickerSeen = hex;
    if (!hexField.focused) hexDraft = hex;
}

void Studio::dragPicker(Vec2 mouse) {
    // Clamped rather than dropped: a drag that runs off the square keeps
    // tracking its edge, as the board's handles do.
    if (pickerDrag == PickerDrag::Square && pickerSquare.w > 0 && pickerSquare.h > 0) {
        pickS = clamp((mouse.x - pickerSquare.x) / pickerSquare.w, 0.0, 1.0);
        pickV = 1.0 - clamp((mouse.y - pickerSquare.y) / pickerSquare.h, 0.0, 1.0);
    } else if (pickerDrag == PickerDrag::Hue && pickerHue.h > 0) {
        pickH = clamp((mouse.y - pickerHue.y) / pickerHue.h, 0.0, 1.0) * 360.0;
    } else {
        return;
    }
    applyPicked(hexText(hsvToRgb(pickH, pickS, pickV)), false);
}

void Studio::closePicker() {
    picker = PickerTarget::None;
    pickerDrag = PickerDrag::None;
    hexField.blur();
    pickerSeen.clear();
}

void Studio::enterTextMode() {
    textBuffer = serializeShapes();
    textField.focusAtEnd(textBuffer, 0.0);
    textError.clear();
}

void Studio::applyTextBuffer() {
    std::vector<Shape> parsed;
    const std::string error = parseShapes(textBuffer, parsed);
    if (!error.empty()) {
        textError = error;
        return;
    }
    textError.clear();
    shapes = parsed;
    if (selected >= static_cast<int>(shapes.size())) selected = static_cast<int>(shapes.size()) - 1;
    if (selected < 0) selected = 0;
}

void Studio::boardLoaded() {
    selected = 0;
    closePicker();
    dragging = false;
    textError.clear();
    shapeScroll.offset = 0;
    if (textMode) enterTextMode();
}

void Studio::beginEdit(const CustomSkin& skin) {
    tab = Tab::Create;
    // Pressing Edit on the skin already open goes back to it as it was left,
    // unsaved changes and all.
    if (editingId == skin.id) return;
    // Only the new-skin draft is set aside. Moving from one edit to another
    // drops the first edit's unsaved changes, as stopping it would.
    if (editingId.empty()) {
        draftShapes = shapes;
        draftName = skinName;
    }
    editingId = skin.id;
    shapes = skin.shapes;
    skinName = skin.name;
    boardLoaded();
}

void Studio::stopEdit() {
    editingId.clear();
    shapes = std::move(draftShapes);
    skinName = std::move(draftName);
    draftShapes.clear();
    draftName.clear();
    boardLoaded();
}

std::string Studio::parseShapes(const std::string& source, std::vector<Shape>& out) const {
    out.clear();
    std::size_t at = 0;
    int lineNo = 0;
    while (at <= source.size()) {
        const std::size_t end = std::min(source.find('\n', at), source.size());
        std::string raw = source.substr(at, end - at);
        at = end + 1;
        ++lineNo;

        const std::size_t first = raw.find_first_not_of(" \t\r");
        if (first == std::string::npos) {
            if (end >= source.size()) break;
            continue;
        }
        raw = raw.substr(first, raw.find_last_not_of(" \t\r") - first + 1);
        if (raw[0] == '#') {
            if (end >= source.size()) break;
            continue;
        }
        const std::string where = "Line " + std::to_string(lineNo) + ": ";

        std::vector<std::string> toks;
        for (std::size_t i = 0; i < raw.size();) {
            const std::size_t start = raw.find_first_not_of(" \t\r", i);
            if (start == std::string::npos) break;
            std::size_t stop = raw.find_first_of(" \t\r", start);
            if (stop == std::string::npos) stop = raw.size();
            toks.push_back(raw.substr(start, stop - start));
            i = stop;
        }

        ShapeType t = ShapeType::Circle;
        if (!parseSkinShapeType(toks[0], t)) return where + "unknown shape \"" + toks[0] + "\"";

        std::vector<std::pair<std::string, std::string>> kv;
        for (std::size_t i = 1; i < toks.size(); ++i) {
            const std::size_t eq = toks[i].find('=');
            if (eq == std::string::npos || eq == 0) {
                return where + "expected key=value near \"" + toks[i] + "\"";
            }
            kv.emplace_back(toks[i].substr(0, eq), toks[i].substr(eq + 1));
        }
        const auto find = [&kv](const char* key) -> const std::string* {
            for (const auto& pair : kv) {
                if (pair.first == key) return &pair.second;
            }
            return nullptr;
        };
        // parseFloat takes the leading numeric prefix, so "12px" is 12 and only
        // a value with no numeric prefix at all is an error.
        const auto numeric = [](const std::string& v, double& value) {
            char* stop = nullptr;
            value = std::strtod(v.c_str(), &stop);
            return stop != v.c_str() && std::isfinite(value);
        };

        static const char* const kNumKeys[] = {"x",  "y",  "rot", "sw",  "r",   "rx", "ry",
                                              "x2", "y2", "cx1", "cy1", "cx2", "cy2"};
        for (const char* key : kNumKeys) {
            const std::string* v = find(key);
            double parsedValue = 0;
            if (v && !numeric(*v, parsedValue)) {
                return where + "\"" + key + "\" must be a number";
            }
        }
        for (const char* key : {"fill", "stroke"}) {
            const std::string* v = find(key);
            if (v && !v->empty() && !isSkinHexColor(*v)) {
                return where + "\"" + key + "\" must be a #rrggbb color";
            }
        }
        const auto num = [&](const char* key, double fallback) {
            const std::string* v = find(key);
            double value = 0;
            return v && numeric(*v, value) ? value : fallback;
        };

        Shape s;
        s.t = t;
        s.x = num("x", 0);
        s.y = num("y", 0);
        s.rot = num("rot", 0);
        const std::string* fill = find("fill");
        const std::string* stroke = find("stroke");
        s.fill = fill ? *fill : std::string();
        s.stroke = stroke ? *stroke : std::string();
        s.sw = num("sw", stroke && !stroke->empty() ? 2.0 : 0.0);
        // Mirror sanitizeSkinShape's outline defaults for the open shapes, so the
        // live preview matches what publishing would produce.
        if ((t == ShapeType::Line || t == ShapeType::Curve) && s.stroke.empty() && s.fill.empty()) {
            s.stroke = "#000000";
            if (s.sw == 0) s.sw = 2;
        }
        if (t == ShapeType::Circle) {
            s.r = num("r", 10);
        } else if (t == ShapeType::Ellipse || t == ShapeType::Rect) {
            s.rx = num("rx", 10);
            s.ry = num("ry", 6);
        } else if (t == ShapeType::Line) {
            s.x2 = num("x2", 0);
            s.y2 = num("y2", 0);
        } else if (t == ShapeType::Curve) {
            s.x2 = num("x2", 0);
            s.y2 = num("y2", 0);
            // Control points default onto their own endpoint, so a curve
            // written with only x/y/x2/y2 draws as a straight segment.
            s.cx1 = num("cx1", s.x);
            s.cy1 = num("cy1", s.y);
            s.cx2 = num("cx2", s.x2);
            s.cy2 = num("cy2", s.y2);
        } else if (t == ShapeType::Polygon) {
            const std::string* raw_points = find("points");
            std::vector<double> pts;
            if (raw_points && !raw_points->empty()) {
                std::size_t p = 0;
                while (p <= raw_points->size()) {
                    const std::size_t comma = std::min(raw_points->find(',', p), raw_points->size());
                    double value = 0;
                    if (!numeric(raw_points->substr(p, comma - p), value)) {
                        return where + "\"points\" must be a comma list of numbers";
                    }
                    pts.push_back(value);
                    if (comma >= raw_points->size()) break;
                    p = comma + 1;
                }
            }
            if (pts.size() < 6) {
                return where + "polygon needs points=x,y,x,y,x,y (\xe2\x89\xa5" "3 points)";
            }
            if (pts.size() > static_cast<std::size_t>(kMaxPolyPoints) * 2) {
                return where + "polygon allows at most " + std::to_string(kMaxPolyPoints) +
                       " points";
            }
            s.points = pts;
        }
        out.push_back(s);
        if (end >= source.size()) break;
    }
    if (out.empty()) return "Add at least one shape line.";
    if (out.size() > static_cast<std::size_t>(kMaxSkinShapes)) {
        return "Too many shapes (max " + std::to_string(kMaxSkinShapes) + ").";
    }
    return {};
}

bool Studio::dispatch(MenuContext& ctx, const Action& a) {
    // Every control takes the caret away from the name box, which is what
    // clicking off a DOM input does. The box itself never reaches here: it
    // answers for its own press in trackTextMouse.
    nameField.blur();

    switch (a.k) {
        case Act::Close:
            return false;
        case Act::Tab:
            tab = a.i == 0 ? Tab::Create : Tab::Browse;
            break;
        case Act::AddShape:
            // Silently capped: the button stays fully lit, exactly as it does
            // in the reference. A greyed-out control would be a new state.
            if (static_cast<int>(shapes.size()) >= kMaxSkinShapes) break;
            shapes.push_back(defaultShape(static_cast<ShapeType>(a.i)));
            selected = static_cast<int>(shapes.size()) - 1;
            break;
        case Act::SelectShape:
            selected = a.i;
            break;
        case Act::MoveShape: {
            const int j = a.i + a.dir;
            if (j < 0 || j >= static_cast<int>(shapes.size())) break;
            std::swap(shapes[static_cast<std::size_t>(a.i)], shapes[static_cast<std::size_t>(j)]);
            if (selected == a.i) selected = j;
            else if (selected == j) selected = a.i;
            break;
        }
        case Act::DelShape:
            if (a.i < 0 || a.i >= static_cast<int>(shapes.size())) break;
            shapes.erase(shapes.begin() + a.i);
            if (selected >= static_cast<int>(shapes.size())) {
                selected = static_cast<int>(shapes.size()) - 1;
            }
            break;
        case Act::Step:
            step(a.field, a.delta);
            break;
        case Act::Fill:
            if (Shape* s = selectedShape()) s->fill = a.color;
            break;
        case Act::Stroke:
            if (Shape* s = selectedShape()) {
                s->stroke = a.color;
                // An outline colour with no width would draw nothing, so
                // picking one turns the outline on.
                if (!a.color.empty() && s->sw <= 0) s->sw = 2;
            }
            break;
        case Act::Picker: {
            // The custom cell toggles its own picker and switches from the
            // other one; the picker's Close button only closes.
            const PickerTarget want = a.i == 0 ? PickerTarget::Fill : PickerTarget::Stroke;
            if (a.dir == 1 || picker == want) {
                closePicker();
            } else {
                closePicker();
                picker = want;
            }
            break;
        }
        case Act::PickSquare:
        case Act::PickHue:
            pickerDrag = a.k == Act::PickSquare ? PickerDrag::Square : PickerDrag::Hue;
            hexField.blur();
            dragPicker(ctx.mouse());
            break;
        case Act::AddVertex: {
            Shape* s = selectedShape();
            if (s && s->t == ShapeType::Polygon &&
                s->points.size() < static_cast<std::size_t>(kMaxPolyPoints) * 2) {
                const std::size_t n = s->points.size();
                const double ax = s->points[n - 2], ay = s->points[n - 1];
                const double bx = s->points[0], by = s->points[1];
                s->points.push_back(round1((ax + bx) / 2));
                s->points.push_back(round1((ay + by) / 2));
            }
            break;
        }
        case Act::DelVertex: {
            Shape* s = selectedShape();
            if (s && s->t == ShapeType::Polygon && s->points.size() > 6) {
                s->points.resize(s->points.size() - 2);
            }
            break;
        }
        case Act::TextMode:
            textMode = !textMode;
            textError.clear();
            if (textMode) enterTextMode();
            break;
        case Act::Publish: {
            // Sanitized locally FIRST, so a rejection is instant and reads the
            // same as the server's: the name box takes the caret when the name
            // is what is missing, and the reason goes to the transcript as a
            // line from "Skins". The server runs the same validator on arrival
            // -- this pass is courtesy, not the gate.
            skinName = sanitizeSkinName(skinName);
            const SkinCheck check = sanitizeSkin(skinName, shapes);
            if (!check.ok()) {
                if (skinName.empty()) nameField.focusAtEnd(skinName, ctx.timeSeconds);
                ctx.net.addLocalChat("Skins", check.error);
                break;
            }
            const std::uint64_t board = skinShapesHash(check.shapes);
            if (board == sentShapes && skinName == sentName &&
                ctx.timeSeconds - sentAt < kPublishRepeatSeconds) {
                break;
            }
            sentShapes = board;
            sentName = skinName;
            sentAt = ctx.timeSeconds;
            // The edit stays open after a save, as the board does after a
            // publish: the server answers in the chat, and the next change
            // saves over the same skin again.
            if (!editingId.empty()) ctx.net.editSkin(editingId, skinName, shapes);
            else ctx.net.publishSkin(skinName, shapes);
            break;
        }
        case Act::Reset:
            shapes = starterSkinShapes();
            selected = 0;
            textError.clear();
            if (textMode) enterTextMode();
            break;
        case Act::Equip:
            ctx.net.equipSkin(a.id);
            break;
        case Act::Unequip:
            ctx.net.equipSkin("");
            break;
        case Act::Delete:
            confirming = true;
            confirmId = a.id;
            confirmName = a.name;
            break;
        case Act::ConfirmDelete:
            // The card does NOT disappear here: the catalog is the server's,
            // and it drops out when the broadcast comes back. Erasing it
            // locally would hide a takedown the server refused.
            ctx.net.deleteSkin(confirmId);
            confirming = false;
            break;
        case Act::CancelDelete:
            confirming = false;
            break;
        case Act::Sort:
            sort = static_cast<Sort>(a.i);
            browseScroll.offset = 0;
            break;
        case Act::Like:
        case Act::Dislike: {
            // The server refuses an author's vote on their own skin as well;
            // saying so here saves the round trip, as Publish's check does.
            const CustomSkin* skin = ctx.net.findSkin(a.id);
            if (skin == nullptr) break;
            if (lowerCase(skin->author) == lowerCase(ctx.net.profile().username)) {
                ctx.net.addLocalChat("Skins", "You can't vote on your own skin.");
                break;
            }
            // Pressing the vote already cast takes it back.
            const SkinVote pressed = a.k == Act::Like ? SkinVote::Like : SkinVote::Dislike;
            ctx.net.voteSkin(a.id, ctx.net.skinVote(a.id) == pressed ? SkinVote::None : pressed);
            break;
        }
        case Act::Favorite:
            ctx.net.favoriteSkin(a.id, !ctx.net.isFavoriteSkin(a.id));
            break;
        case Act::CopyCode:
            if (const CustomSkin* skin = ctx.net.findSkin(a.id)) {
                ctx.window.setClipboardText(skinCode(skin->shapes));
                copiedId = a.id;
                copiedAt = ctx.timeSeconds;
            }
            break;
        case Act::Edit:
            // Only a card of the player's own carries the button; the server
            // checks the author again on save.
            if (const CustomSkin* skin = ctx.net.findSkin(a.id)) beginEdit(*skin);
            break;
        case Act::StopEdit:
            stopEdit();
            break;
        case Act::None:
            break;
    }
    return true;
}

bool Studio::handleInput(MenuContext& ctx) {
    const Vec2 mouse = ctx.mouse();
    const Rect panel = layout.panel;

    // The name box and the text editor take the keyboard while they have the
    // caret, the way the DOM controls they replace do.
    // The hex box only while the picker that holds it is on screen: a
    // picker closed some other way -- another shape, another tab -- must not
    // leave the keyboard with it.
    if (tab != Tab::Create || textMode || pickerHex.w <= 0) hexField.blur();
    // The search box only on the tab it is drawn on, and not under a confirm.
    if (tab != Tab::Browse || confirming) searchField.blur();
    const bool naming = tab == Tab::Create && !textMode && nameField.focused;
    const bool editing = tab == Tab::Create && textMode;
    const bool hexing = hexField.focused;
    const bool searching = searchField.focused;
    if (naming || editing || hexing || searching) ctx.wantsText = true;

    if (naming) {
        TextEditOptions typing;
        typing.maxBytes = kMaxSkinNameLen;
        // The server's own filter is ASCII word characters, spaces and dashes,
        // so anything wider would only be dropped by sanitizeSkinName.
        typing.asciiOnly = true;
        editText(ctx.window, skinName, nameField, ctx.timeSeconds, typing);
        if (ctx.window.keyPressed(Key::Enter) || ctx.window.keyPressed(Key::Escape)) {
            skinName = sanitizeSkinName(skinName);
            nameField.blur();
        }
    } else if (editing) {
        TextEditOptions typing;
        typing.maxBytes = kMaxSkinTextBytes;
        typing.multiline = true;
        if (editText(ctx.window, textBuffer, textField, ctx.timeSeconds, typing)) {
            applyTextBuffer();
        }
        // Against the lines drawTextEditor paints.
        const Rect editor = layout.right;
        trackTextMouseMultiline(ctx.window, textField, editor, textBuffer, editorTextX(editor),
                                editorFirstLine(editor), kEditorLineHeight, kInputTextSize,
                                ctx.timeSeconds);
        if (ctx.window.keyPressed(Key::Escape)) textMode = false;
    } else if (hexing) {
        TextEditOptions typing;
        typing.maxBytes = 7;
        typing.asciiOnly = true;
        // Live, as the square is: every keystroke that completes a code
        // repaints the shape, and a half-typed one leaves it as it was.
        if (editText(ctx.window, hexDraft, hexField, ctx.timeSeconds, typing)) {
            const std::string hex = normalHex(hexDraft);
            if (!hex.empty()) applyPicked(hex, true);
        }
        // Either way the box shows the shape's colour again once it lets go.
        if (ctx.window.keyPressed(Key::Enter) || ctx.window.keyPressed(Key::Escape)) {
            hexField.blur();
        }
    } else if (searching) {
        TextEditOptions typing;
        typing.maxBytes = kMaxSearchBytes;
        // Live: every keystroke narrows the cards, from the top of the list.
        if (editText(ctx.window, search, searchField, ctx.timeSeconds, typing)) {
            browseScroll.offset = 0;
        }
        if (ctx.window.keyPressed(Key::Enter) || ctx.window.keyPressed(Key::Escape)) {
            searchField.blur();
        }
    }
    if (tab == Tab::Browse && !confirming) {
        const Rect field = browseSearchField(layout);
        trackTextMouse(ctx.window, searchField, field, inputFieldRun(field, search, searchField),
                       search, ctx.timeSeconds);
        if (insideInclusive(field, mouse)) ctx.window.setCursorShape(CursorShape::Text);
    }
    if (pickerHex.w > 0) {
        trackTextMouse(ctx.window, hexField, pickerHex,
                       inputFieldRun(pickerHex, hexDraft, hexField), hexDraft, ctx.timeSeconds);
        if (insideInclusive(pickerHex, mouse)) ctx.window.setCursorShape(CursorShape::Text);
    }
    if (tab == Tab::Create && !textMode) {
        // The name box takes its own press; the region list below would only
        // ever put the caret at one end of it.
        const Rect field = footerNameField(layout.footer);
        trackTextMouse(ctx.window, nameField, field,
                       inputFieldRun(field, skinName, nameField), skinName, ctx.timeSeconds);
        if (insideInclusive(field, mouse)) ctx.window.setCursorShape(CursorShape::Text);
    }

    // Only inside the panel, and raw: one notch is the browser's 100px of
    // deltaY, which is what the other list panels consume too.
    const float wheel = ctx.wheel();
    if (wheel != 0 && insideInclusive(panel, mouse)) {
        Scroller& scroller = tab == Tab::Browse ? browseScroll : shapeScroll;
        scroller.offset =
            clamp(scroller.offset - static_cast<double>(wheel) * kWheelStep, 0.0,
                  scroller.maxOffset());
    }

    if (dragging) {
        if (ctx.window.mouseDown(MouseButton::Left)) applyDrag(mouse);
        else dragging = false;
    }
    if (pickerDrag != PickerDrag::None) {
        if (ctx.window.mouseDown(MouseButton::Left)) dragPicker(mouse);
        else pickerDrag = PickerDrag::None;
    }

    // Hover tracks the last completed render's regions, which is where the
    // panel reads it from too.
    hovering = false;
    for (std::size_t i = regions.size(); i-- > 0;) {
        if (insideInclusive(regions[i].r, mouse)) {
            hover = regions[i].action;
            hovering = true;
            break;
        }
    }

    if (!ctx.pressed()) return true;

    // Regions win over the board: later-drawn regions are hit first.
    for (std::size_t i = regions.size(); i-- > 0;) {
        if (insideInclusive(regions[i].r, mouse)) return dispatch(ctx, regions[i].action);
    }

    // A press anywhere else has already blurred the box through
    // trackTextMouse; committing the name is what is left.
    if (!nameField.focused && !skinName.empty()) skinName = sanitizeSkinName(skinName);

    if (tab == Tab::Create && !textMode && !confirming && selectedShape()) {
        if (insideInclusive(layout.preview, mouse)) {
            double best = 9.0;
            dragHandle = HandleKind::Anchor;
            dragVertex = 0;
            for (const Handle& h : handles()) {
                const Vec2 p = toPx(h.lx, h.ly);
                const double d = distance(p, mouse);
                if (d < best) {
                    best = d;
                    dragHandle = h.kind;
                    dragVertex = h.vertex;
                }
            }
            dragging = true;
            applyDrag(mouse);
        }
    }
    return true;
}

} // namespace

double SkinsPanel::preferredWidth() { return 600.0; }
double SkinsPanel::preferredHeight() { return 580.0; }

void SkinsPanel::reset() {
    // Deliberately NOT a fresh studio: hiding the panel drops the two overlays
    // and the drag and keeps the authored shapes, so reopening it must not
    // throw away the skin being drawn.
    Studio& state = studio();
    state.nameField.blur();
    state.hexField.blur();
    state.searchField.blur();
    state.textField.dragging = false;
    state.dragging = false;
    state.pickerDrag = Studio::PickerDrag::None;
    state.confirming = false;
    state.regions.clear();
    state.hovering = false;
    if (state.textMode) state.enterTextMode();
}

bool SkinsPanel::render(MenuContext& ctx) {
    Studio& state = studio();
    // Rebound every frame rather than once: the studio is a file-local
    // singleton and the connection it reads is not, so a reconnect must not
    // leave it pointed at a dead one.
    state.net = &ctx.net;
    state.window = &ctx.window;
    // The skin being edited was taken down -- here, by an admin, or with the
    // account it belonged to signed out. What is on the board stays, as a new
    // skin: nothing is left to save it over.
    if (!state.editingId.empty() && ctx.net.findSkin(state.editingId) == nullptr) {
        state.editingId.clear();
        state.draftShapes.clear();
        state.draftName.clear();
        ctx.net.addLocalChat("Skins", "The skin you were editing is gone. Publish makes what "
                                      "you have a new skin.");
    }
    // From the shared anchor, so the card, its hit regions and the box
    // MenuSystem captures the mouse in are one rect.
    state.layout = layoutOf(ctx.bounds);
    // Input runs first and against the previous frame's regions: the panel's
    // handlers fire between renders, and every button, tab, swatch and stepper
    // acts on PRESS rather than release.
    if (!state.handleInput(ctx)) return false;
    state.draw(ctx);
    return true;
}

} // namespace flix
