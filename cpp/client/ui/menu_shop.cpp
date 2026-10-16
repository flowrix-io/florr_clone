// The star shop.
//
// Three tabs over one window: the store's ten rotating offers, the challenges
// that pay the stars to buy them with, and the code redeemer.
//
// It is florr's premium shop window, measured out of florr's own client rather
// than off screenshots: its draw (0x1008f84a0, called from the screen render)
// was run under ~/florr_images/emulator/shop.py and every Skia call recorded --
// see SHOP.md beside it. The numbers below are those, in window units relative
// to the window's top-left corner, which this client draws at one to the
// design unit. The window, its tab strip, the Shop tab, the confirm box and
// the error box are florr's; the Challenge and Bonus tabs are this game's own
// (florr's are a daily mob list and a bonus-drops timer, neither of which this
// server has), set in florr's widgets. The window's slide is MenuSystem's.
//
// The offers themselves are not this file's: `shopOffers` in shared/game/shop.h
// derives them from the clock, and the server derives the same ten to price
// what is clicked. This panel only draws them and names which one was pressed.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <unordered_map>
#include <vector>

#include "svg.h"

#include "client/ui/item_tile.h"
#include "client/ui/menu_icons.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/game/config.h"
#include "shared/game/shop.h"

namespace flix {

using namespace flix::ui;

namespace {

// --- the window -------------------------------------------------------------

/// Sized to the Shop tab's content: 13 + five 140 cells + 13 across; the title
/// row, the tab strip, 8, the two header lines, two 160 rows, 10, the two
/// footer lines and 13 down.
constexpr double kWindowWidth = 746.0;
constexpr double kWindowHeight = 541.4;
constexpr double kWindowPad = 13.0;
/// The window and its rim -- the fill's 0.81 shade -- and every plate on it.
constexpr std::uint32_t kWindowFill = 0x7EEF6Du;
constexpr std::uint32_t kWindowRim = 0x66C258u;

/// Every label is white over a black outline 0.12 of its size.
constexpr double kLineHeight = 1.4;

/// The title, centred on its 1.4 row 10 below the top, and the close button.
constexpr double kTitleSize = 24.0;
constexpr double kTitleMiddle = 10.0 + kTitleSize * kLineHeight * 0.5;
constexpr double kCloseSide = 25.0;
constexpr double kCloseFromRight = 39.0;
constexpr double kCloseTop = 14.3;

/// The tab strip under it, full width, and its three 100x30 tabs centred 10
/// apart, 10 below its top. The open tab is drawn pressed.
constexpr double kStripTop = 10.0 + kTitleSize * kLineHeight + 10.0;
constexpr double kStripHeight = 50.0;
constexpr double kTabWidth = 100.0;
constexpr double kTabHeight = 30.0;
constexpr double kTabGap = 10.0;
constexpr double kTabSize = 16.0;

/// Every shop button is a b4 r4 one (drawFlorrButton).
constexpr double kButtonBorder = 4.0;
constexpr double kButtonRadius = 4.0;

/// The header: "Today's offers:" at 20 and the time line at 14 under it, both
/// centred, 8 below the strip.
constexpr double kHeaderTop = kStripTop + kStripHeight + 8.0;
constexpr double kOffersHeadingSize = 20.0;
constexpr double kSubSize = 14.0;
constexpr double kHeadingMiddle = kHeaderTop + kOffersHeadingSize * kLineHeight * 0.5;
constexpr double kSubMiddle = kHeaderTop + kOffersHeadingSize * kLineHeight + kSubSize * kLineHeight * 0.5;
constexpr double kHeaderHeight = (kOffersHeadingSize + kSubSize) * kLineHeight;

/// Lock: 25 tall and its label plus 25 wide, right-aligned with the cards and
/// centred on the two header lines.
constexpr double kLockHeight = 25.0;
constexpr double kLockExtra = 25.0;
constexpr double kLockSize = 14.0;
constexpr std::uint32_t kLockFace = 0x72D862u;

// --- the store's grid -------------------------------------------------------

/// Two rows of five 140x160 cells; each holds a 120x140 plate 20 in and 10
/// down, the tile and the price button on it.
constexpr double kGridLeft = kWindowPad + 20.0;
constexpr double kGridTop = kHeaderTop + kHeaderHeight + 10.0;
constexpr double kCellWidth = 140.0;
constexpr double kCellHeight = 160.0;
constexpr double kPlateWidth = 120.0;
constexpr double kPlateHeight = 140.0;
constexpr double kPlateRadius = 5.0;
constexpr double kTile = 80.0;
constexpr double kTileLeft = 20.0;
constexpr double kTileTop = 10.0;
constexpr double kPriceLeft = 10.0;
constexpr double kPriceTop = 100.0;
constexpr double kPriceWidth = 100.0;
constexpr double kPriceHeight = 30.0;
/// In the price button, a centred row: the star in a 30 box (24, 3 in), then
/// the price at 16.
constexpr double kPriceIconBox = 30.0;
constexpr double kPriceStar = 24.0;
constexpr double kPriceSize = 16.0;
constexpr std::uint32_t kPriceFace = 0xFCDF03u;

/// The discount tag: a black rounded rect 28 tall and its label plus 5 wide,
/// centred on the tile's top-right corner and tipped 0.4 rad clockwise.
constexpr double kBadgeHeight = 28.0;
constexpr double kBadgeExtra = 5.0;
constexpr double kBadgeRadius = 5.0;
constexpr double kBadgeRadians = 0.4;
constexpr double kBadgeSize = 20.0;

/// The footer: the balance plate in the bottom-right corner -- 5 in, the star
/// in a 20 box, the number at 20, 5 in -- and two 14 lines right-aligned 10
/// left of it.
constexpr double kFooterTop = kGridTop + 2.0 * kCellHeight + 10.0;
constexpr double kFooterSize = 14.0;
constexpr double kFooterMiddle = kFooterTop + kFooterSize * kLineHeight;
constexpr double kBalanceHeight = 38.0;
constexpr double kBalanceStar = 20.0;
constexpr double kBalanceSize = 20.0;
constexpr double kBalanceInset = 5.0;

constexpr std::size_t kCodeMaxLength = 64;

constexpr std::uint32_t kGold = 0xFFD700u;

// --- the dialogs ------------------------------------------------------------

/// A box on the window -- the window's own panel, 20 in -- centred on the
/// window, over a scrim on the window alone. The scrim fades in on florr's
/// usual ease; the box waits for a stage ease to finish, then grows in about
/// its centre on a third.
constexpr double kDialogPad = 20.0;
constexpr double kDialogGap = 20.0;
constexpr double kDialogTitleSize = 24.0;
constexpr double kDialogLineSize = 14.0;
constexpr double kDialogButtonHeight = 28.0;
constexpr double kDialogButtonGap = 10.0;
constexpr double kDialogBuyWidth = 80.0;
/// The buy button's row: the star in a 22 box with 3 either side, then the
/// price at 14.
constexpr double kDialogStarBox = 28.0;
constexpr double kDialogStar = 22.0;
constexpr double kDialogPriceSize = 14.0;
/// Cancel: its 16 label plus 28.
constexpr double kDialogCancelExtra = 28.0;
constexpr double kDialogCancelSize = 16.0;
constexpr std::uint32_t kDialogGrey = 0x666666u;
constexpr std::uint32_t kRefundWarning = 0xFF3333u;
/// The eases, per millisecond.
constexpr double kScrimRate = 0.021400496636323946;
constexpr double kStageRate = 0.0894;
constexpr double kGrowRate = 0.0550;
/// The scrim's darkest: floor(100 s) / 255 of black.
constexpr double kScrimMax = 100.0;

// --- this game's tabs -------------------------------------------------------

/// The Bonus tab's code box is the one highlighted thing on the window, in
/// Apex's colour and drawn the way florr draws a window: the colour under a
/// 7-wide rim of its 0.81 shade. Its Redeem button is the shade on the
/// shade's own shade, as florr's tabs sit on their strip -- grey, florr's
/// unusable button, until there is a code to send.
constexpr std::uint32_t kHighlight = 0xFF00FFu;   // rarityColor(Rarity::Apex)
constexpr double kCodeBoxWidth = 520.0;
constexpr double kCodeFieldHeight = 40.0;
constexpr double kRedeemWidth = 110.0;
constexpr std::uint32_t kButtonIdle = 0x777777u;
constexpr std::uint32_t kButtonIdleRim = 0x606060u;

/// The challenge tiers and what a kill at each pays (starsForKill). Each card
/// wears its tier's own colour from the rarity palette.
struct StarChallenge {
    Rarity tier;
    int stars;
};

const std::array<StarChallenge, 5> kChallenges = {{
    {Rarity::Mythic, starsForKill(Rarity::Mythic)},
    {Rarity::Ultra, starsForKill(Rarity::Ultra)},
    {Rarity::Super, starsForKill(Rarity::Super)},
    {Rarity::Unique, starsForKill(Rarity::Unique)},
    {Rarity::Apex, starsForKill(Rarity::Apex)},
}};

/// One of the stars that rain down the screen when a code is redeemed.
///
/// The reference drops these on the GAME canvas, underneath the shop's own, so
/// they pass behind the card. Drawn here before anything else in the panel for
/// the same reason.
struct FallingStar {
    Vec2 at;
    double vy = 0;          ///< pixels per frame at 60fps, as the reference stores it
    double rotation = 0;
    double spin = 0;
    double size = 0;
    double alpha = 0;
    double life = 0;        ///< seconds left
    double maxLife = 0;
};

constexpr std::size_t kFallingStars = 20;

// ---------------------------------------------------------------------------
// State the panel cannot hold
// ---------------------------------------------------------------------------

/// The code field and the dialog.
///
/// Kept beside the panel and keyed on the instance rather than being a
/// file-level singleton -- two shops would otherwise share one code field.
struct ShopState {
    enum class Modal : std::uint8_t { None, Confirm, Alert };

    std::string code;
    /// Caret, selection, focus and the blink's phase. The phase is anchored to
    /// the last edit rather than taken modulo wall time, so the caret is solid
    /// the instant a key lands instead of blinking out mid-keystroke.
    ui::TextFieldState field;

    /// The dialog that is up and answering, or None.
    Modal modal = Modal::None;
    /// The one being DRAWN, which outlives `modal` for as long as it takes to
    /// shrink away. What it says lives with it, so a box on its way out still
    /// reads what it read.
    Modal shown = Modal::None;
    std::vector<std::string> lines;
    std::uint16_t pendingPetal = kNoPetal;
    Rarity pendingRarity = Rarity::Common;
    /// Which card of the rotation the confirm box is holding, so the buy
    /// carries the offer's own discounted price rather than the ladder's --
    /// and what that card costs, which the box prints on its buy button.
    int pendingSlot = -1;
    double pendingPrice = 0;
    /// The scrim, the stage that holds the box back, and the box's scale.
    double scrim = 0;
    double stage = 0;
    double grow = 0;

    /// Where the left button last went down, so a button acts only on a
    /// release that ends a press which began on it.
    Vec2 pressedAt{-1e9, -1e9};

    /// The rotation the cards below were generated for, so the store is built
    /// once an hour rather than once a frame. `INT64_MIN` is "nothing yet".
    std::int64_t offersRotation = INT64_MIN;
    std::vector<ShopOffer> offers;

    std::vector<FallingStar> stars;
    Rng rng;
};

ShopState& stateFor(const ShopPanel* panel) {
    static std::unordered_map<const ShopPanel*, ShopState> states;
    return states[panel];
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

/// florr's text box is the run plus 2 * int(2 * size * 0.12) -- the outline's
/// reach either side, in whole pixels -- which every content-sized widget on
/// the window measures with.
double textPad(double size) { return 2.0 * std::floor(2.0 * size * kTextStrokeRatio); }

TextStyle shopText(double size, Align align = Align::Centre, std::uint32_t fill = kPaper) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.align = align;
    style.baseline = Baseline::Middle;
    style.roundJoin = true;
    return style;
}

/// A flat rect, for the scrim -- which covers the window and nothing else.
void fillWindowRect(Canvas& canvas, Rect r, std::uint32_t rgb, double alpha) {
    setFill(canvas, rgb, alpha);
    canvas.fillRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                    static_cast<float>(r.h));
}

/// The star glyph, from the game-icons.net document florr draws its own from.
///
/// Two of them, because the shop needs both: gold where the star is the
/// currency against a neutral ground, and the artwork's own white where it
/// sits INSIDE something already gold -- a gold star on a gold pill is a
/// silhouette of nothing.
const SvgDocument* starDocument(bool gold) {
    const auto compile = [](bool asGold) {
        const int index = menuIconIndex("stars");
        if (index < 0) return SvgDocument::fromString(std::string());
        std::string svg = kMenuIcons[index].svg;
        if (asGold) {
            const std::string white = "fill=\"#fff\"";
            const std::string amber = "fill=\"#ffd700\"";
            for (std::size_t at = svg.find(white); at != std::string::npos;
                 at = svg.find(white, at + amber.size())) {
                svg.replace(at, white.size(), amber);
            }
        }
        return SvgDocument::fromString(svg);
    };
    static const SvgDocument goldDoc = compile(true);
    static const SvgDocument paperDoc = compile(false);
    const SvgDocument& doc = gold ? goldDoc : paperDoc;
    return doc.empty() ? nullptr : &doc;
}

/// Fills the sky with the reward shower a redeemed code sets off: twenty
/// stars, dropped in above the top edge, spinning as they fall.
void spawnFallingStars(ShopState& state, double viewWidth) {
    if (state.stars.size() >= kFallingStars) return;
    const std::size_t room = kFallingStars - state.stars.size();
    for (std::size_t i = 0; i < room; ++i) {
        FallingStar star;
        star.at = {state.rng.unit() * viewWidth, -20.0 - state.rng.unit() * 50.0};
        star.vy = state.rng.range(2.0, 5.0);
        star.rotation = state.rng.angle();
        star.spin = (state.rng.unit() - 0.5) * 0.1;
        star.size = state.rng.range(8.0, 20.0);
        star.alpha = state.rng.range(0.8, 1.0);
        // Two independent rolls in the reference, so a star can begin part-way
        // through its own fade.
        star.life = state.rng.range(2.0, 3.0);
        star.maxLife = state.rng.range(2.0, 3.0);
        state.stars.push_back(star);
    }
}

/// Steps and draws the shower, dropping stars that ran out of screen or life.
void drawFallingStars(Canvas& canvas, ShopState& state, double dt, double viewHeight) {
    // The reference integrates per FRAME at 60fps -- `y += vy`, `lifetime -=
    // 16` -- so its speeds are converted here rather than reused raw, or the
    // shower runs at whatever rate this client happens to hit.
    const double frames = dt * 60.0;
    std::vector<FallingStar> alive;
    alive.reserve(state.stars.size());
    for (FallingStar star : state.stars) {
        star.at.y += star.vy * frames;
        star.rotation += star.spin * frames;
        star.life -= dt;
        const double progress = star.maxLife > 0 ? star.life / star.maxLife : 0.0;
        if (star.at.y > viewHeight + 50.0 || progress <= 0.0) continue;

        canvas.save();
        canvas.setGlobalAlpha(static_cast<float>(star.alpha * progress));
        canvas.translate(static_cast<float>(star.at.x), static_cast<float>(star.at.y));
        canvas.rotate(static_cast<float>(star.rotation));
        setFill(canvas, kGold);
        setStroke(canvas, kPaper);
        canvas.setLineWidth(1.0f);
        canvas.beginPath();
        const double outer = star.size * 0.5;
        for (int i = 0; i < 10; ++i) {
            const double angle = i * kPi / 5.0 - kPi * 0.5;
            const double radius = (i % 2 == 0) ? outer : outer * 0.4;
            const auto px = static_cast<float>(std::cos(angle) * radius);
            const auto py = static_cast<float>(std::sin(angle) * radius);
            if (i == 0) canvas.moveTo(px, py);
            else canvas.lineTo(px, py);
        }
        canvas.closePath();
        canvas.fill();
        canvas.stroke();
        canvas.restore();
        alive.push_back(star);
    }
    state.stars = std::move(alive);
}

/// The star icon in a `size` square whose top-left corner is (x, y). White by
/// default, as florr draws it on its yellow buttons and its balance.
void drawStarIcon(Canvas& canvas, double x, double y, double size, bool gold = false) {
    if (const SvgDocument* doc = starDocument(gold)) {
        doc->renderFitted(canvas, static_cast<float>(x), static_cast<float>(y),
                          static_cast<float>(size), 0.0f);
        return;
    }
    // Only when the SVG failed to compile: a star drawn rather than typed --
    // the glyph is not in the shipped face, and the shop is the one screen
    // where the currency has to be unmistakable.
    fillStar(canvas, {x + size * 0.5, y + size * 0.5}, size * 0.5, gold ? kGold : kPaper);
}

/// A star-and-number row centred in `button`: the star in an `iconBox` square
/// with the glyph `star` wide in its middle, then the number at `size`.
void drawStarRow(Canvas& canvas, Rect button, const std::string& number, double iconBox,
                 double star, double size) {
    const double row = iconBox + measure(number, size) + textPad(size);
    const double x = button.x + (button.w - row) * 0.5;
    const double inset = (iconBox - star) * 0.5;
    drawStarIcon(canvas, x + inset, button.y + (button.h - star) * 0.5, star);
    text(canvas, number, x + iconBox + textPad(size) * 0.5, button.y + button.h * 0.5,
         shopText(size, Align::Left));
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/// Prices, abbreviated. Not florr's formatter, which spells out every price
/// that is not a round thousand: florr's prices are round by construction and
/// this server's are not, and a ten-digit price will not fit a 100-wide button.
std::string formatPrice(double price) {
    char buffer[32];
    double value = price;
    int decimals = 1;
    const char* suffix = "";
    if (price >= 1e9) { value = price / 1e9; suffix = "B"; }
    else if (price >= 1e6) { value = price / 1e6; suffix = "M"; }
    else if (price >= 1e4) { value = price / 1e3; decimals = 0; suffix = "k"; }
    else if (price >= 1e3) { value = price / 1e3; suffix = "k"; }
    else {
        std::snprintf(buffer, sizeof buffer, "%.0f", price);
        return buffer;
    }
    // Rounded before it is printed: `toFixed` breaks a tie AWAY from zero and
    // `%.*f` breaks it to even, so a 2,250-star card reads "2.3k" and not
    // "2.2k".
    const double scale = std::pow(10.0, decimals);
    value = std::floor(value * scale + 0.5) / scale;
    std::snprintf(buffer, sizeof buffer, "%.*f", decimals, value);
    std::string out = buffer;
    // "1.0k" reads worse than "1k", and the trailing zero is never news.
    if (out.size() > 2 && out.compare(out.size() - 2, 2, ".0") == 0) out.erase(out.size() - 2);
    return out + suffix;
}

/// Greedy word wrap for a dialog's message. A single word wider than the limit
/// keeps its own line and overflows, rather than being broken mid-word.
std::vector<std::string> wrapMessage(const std::string& body, double size, double maxWidth) {
    std::vector<std::string> lines;
    std::string line;
    std::size_t at = 0;
    while (at <= body.size()) {
        const std::size_t space = body.find(' ', at);
        const std::string word =
            body.substr(at, space == std::string::npos ? std::string::npos : space - at);
        if (!word.empty()) {
            const std::string candidate = line.empty() ? word : line + " " + word;
            if (!line.empty() && measure(candidate, size) > maxWidth) {
                lines.push_back(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (space == std::string::npos) break;
        at = space + 1;
    }
    if (!line.empty()) lines.push_back(line);
    return lines;
}

std::string trimmed(const std::string& s) {
    std::size_t first = 0;
    while (first < s.size() && static_cast<unsigned char>(s[first]) <= ' ') ++first;
    std::size_t last = s.size();
    while (last > first && static_cast<unsigned char>(s[last - 1]) <= ' ') --last;
    return s.substr(first, last - first);
}

/// The line under "Today's offers:", florr's `:time`: the seconds rounded up,
/// then the largest whole unit -- 5 h 23 m is "5 hours".
std::string rotationCaption(std::int64_t secondsLeft) {
    const std::int64_t s = std::max<std::int64_t>(0, secondsLeft);
    if (s == 0) return "Store will change immediately";
    const auto unit = [](std::int64_t n, const char* one, const char* many) {
        return std::to_string(n) + " " + (n == 1 ? one : many);
    };
    std::string time;
    if (s >= 86400) time = unit(s / 86400, "day", "days");
    else if (s >= 3600) time = unit(s / 3600, "hour", "hours");
    else if (s >= 60) time = unit(s / 60, "minute", "minutes");
    else time = unit(s, "second", "seconds");
    return "Store will change in " + time;
}

/// The discount tag, centred on `corner` and tipped clockwise: a black rounded
/// rect with the saving on it, stuck over the tile's top-right corner.
void drawDiscountBadge(Canvas& canvas, Vec2 corner, int percent) {
    const std::string label = "-" + std::to_string(percent) + "%";
    const double width = measure(label, kBadgeSize) + textPad(kBadgeSize) + kBadgeExtra;
    canvas.save();
    canvas.translate(static_cast<float>(corner.x), static_cast<float>(corner.y));
    canvas.rotate(static_cast<float>(kBadgeRadians));
    fillQuadRound(canvas, {-width * 0.5, -kBadgeHeight * 0.5, width, kBadgeHeight}, kBadgeRadius,
                  kInk);
    text(canvas, label, 0.0, 0.0, shopText(kBadgeSize));
    canvas.restore();
}

/// The dialog eases, a frame of `dt` seconds on. The scrim follows the box's
/// target on its own; the stage runs first on the way in and last on the way
/// out, and the box only grows while it is complete.
void stepDialog(ShopState& state, double dt) {
    const double ms = dt * 1000.0;
    const auto ease = [ms](double& x, double target, double rate) {
        x += (target - x) * (1.0 - std::exp(-rate * ms));
    };
    const bool open = state.modal != ShopState::Modal::None;
    if (open) state.shown = state.modal;
    ease(state.scrim, open ? 1.0 : 0.0, kScrimRate);
    if (open) {
        ease(state.stage, 1.0, kStageRate);
        if (state.stage > 0.9999) ease(state.grow, 1.0, kGrowRate);
    } else {
        ease(state.grow, 0.0, kGrowRate);
        if (state.grow < 1e-4) ease(state.stage, 0.0, kStageRate);
    }
    if (!open && state.scrim < 1e-3 && state.grow < 1e-4 && state.stage < 1e-4) {
        state.scrim = state.stage = state.grow = 0.0;
        state.shown = ShopState::Modal::None;
    }
}

} // namespace

double ShopPanel::preferredWidth() { return kWindowWidth; }
double ShopPanel::preferredHeight() { return kWindowHeight; }

void ShopPanel::reset() {
    // Whatever was typed into the code field is kept for the panel's whole
    // lifetime; closing it drops only the focus and any open dialog.
    ShopState& state = stateFor(this);
    state.field.blur();
    state.modal = ShopState::Modal::None;
    state.shown = ShopState::Modal::None;
    state.scrim = state.stage = state.grow = 0.0;
    state.lines.clear();
    state.pendingPetal = kNoPetal;
    state.pressedAt = {-1e9, -1e9};
    // The shower belongs to the moment a code was redeemed. It can only be
    // drawn while the window is up, and a shower that resumed mid-air an hour
    // later would be a ghost of a reward already given.
    state.stars.clear();
}

bool ShopPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = ctx.bounds;
    ShopState& state = stateFor(this);

    // florr's window takes no input until it is 0.9 of the way in, nor while
    // it leaves: the pointer is somewhere else entirely, as far as it knows.
    const bool live = open_ >= 0.9 && !closing_;
    const Vec2 mouse = live ? ctx.mouse() : Vec2{-1e9, -1e9};
    const bool held = live && ctx.window.mouseDown(MouseButton::Left);
    if (live && ctx.pressed()) state.pressedAt = mouse;
    /// A click on `r`: released over it, from a press that began on it.
    const auto clicked = [&](Rect r) {
        return live && ctx.released() && r.contains(mouse) && r.contains(state.pressedAt);
    };
    const auto pressing = [&](Rect r) { return held && r.contains(mouse) && r.contains(state.pressedAt); };

    // The server's answer to a purchase or a code. Read before the dialog is
    // latched, so a refusal raises its box on the frame it arrived rather than
    // the one after.
    ShopOutcome& answer = ctx.net.shopOutcome();
    if (answer.pending) {
        answer.pending = false;
        if (!answer.ok) {
            state.modal = ShopState::Modal::Alert;
            state.lines = wrapMessage(
                (answer.redeem ? "Code redemption failed: " : "Purchase failed: ") + answer.message,
                kDialogLineSize, 260.0);
        } else if (answer.redeem) {
            // The field was already cleared when the code was sent; the stars
            // are the whole confirmation.
            spawnFallingStars(state, ctx.window.width());
        }
    }

    // Behind everything, including the window: the reference drops these on
    // the game canvas and the shop's own canvas sits over it.
    if (!state.stars.empty()) {
        drawFallingStars(canvas, state, ctx.dt, ctx.window.height());
    }

    stepDialog(state, ctx.dt);
    // Input answers the frame that was drawn, so the dialog's presence is
    // latched here and used by both passes. While one is up the window under
    // it answers nothing.
    const bool modalUp = state.modal != ShopState::Modal::None;
    const Vec2 under = modalUp ? Vec2{-1e9, -1e9} : mouse;

    // What the pointer is over, pushed to the window once at the end.
    CursorShape cursor = CursorShape::Arrow;

    // A focused field or an open dialog owns the keyboard. Without this the
    // menu system reads every letter typed into the code field as a hotkey.
    if (modalUp || state.field.focused) ctx.wantsText = true;

    // Read the balance from the live entity when there is one, so a mythic
    // kill's payout shows up before the next profile arrives -- unless this
    // client is steering somebody else's flower, whose stars the snapshot's
    // self block is carrying then: the shop spends this account's.
    const double stars =
        ctx.net.status() == NetClient::Status::Playing && !ctx.net.controllingFlower()
            ? ctx.net.view().self().stars
            : profile.stars;

    const auto at = [&](double x, double y) { return Vec2{panel.x + x, panel.y + y}; };

    // --- window -------------------------------------------------------------
    drawFlorrPanel(canvas, panel, kWindowFill, kWindowRim);

    text(canvas, "Shop", panel.x + panel.w * 0.5, panel.y + kTitleMiddle, shopText(kTitleSize));

    const Rect closeRect{panel.right() - kCloseFromRight, panel.y + kCloseTop, kCloseSide,
                         kCloseSide};
    const bool closeHover = closeRect.contains(under);
    if (closeHover) cursor = CursorShape::Hand;
    drawFlorrClose(canvas, closeRect, closeHover, !modalUp && pressing(closeRect));

    // --- tabs ---------------------------------------------------------------
    setFill(canvas, kWindowRim);
    canvas.fillRect(static_cast<float>(panel.x), static_cast<float>(panel.y + kStripTop),
                    static_cast<float>(panel.w), static_cast<float>(kStripHeight));
    static constexpr std::array<const char*, 3> kTabLabels{"Shop", "Challenge", "Bonus"};
    const double tabsWidth = 3.0 * kTabWidth + 2.0 * kTabGap;
    std::array<Rect, 3> tabRects{};
    for (int i = 0; i < 3; ++i) {
        const Rect rect{panel.x + (panel.w - tabsWidth) * 0.5 + i * (kTabWidth + kTabGap),
                        panel.y + kStripTop + 10.0, kTabWidth, kTabHeight};
        tabRects[static_cast<std::size_t>(i)] = rect;
        const bool active = static_cast<int>(tab_) == i;
        const bool hovered = rect.contains(under);
        if (hovered) cursor = CursorShape::Hand;
        drawFlorrButton(canvas, rect, kWindowRim, kButtonBorder, kButtonRadius, hovered,
                        active || (!modalUp && pressing(rect)));
        text(canvas, kTabLabels[static_cast<std::size_t>(i)], rect.x + rect.w * 0.5,
             rect.y + rect.h * 0.5, shopText(kTabSize));
    }

    // --- the footer, on every tab -------------------------------------------
    // The balance is the one number all three tabs are about, so it is the
    // window's footer rather than the store's.
    {
        const std::string balance = withSeparators(stars);
        const double width = kBalanceInset + kBalanceStar + measure(balance, kBalanceSize) +
                             textPad(kBalanceSize) + kBalanceInset;
        const Rect plate{panel.right() - kWindowPad - width,
                         panel.y + kFooterMiddle - kBalanceHeight * 0.5, width, kBalanceHeight};
        fillQuadRound(canvas, plate, kPlateRadius, kWindowRim);
        drawStarIcon(canvas, plate.x + kBalanceInset, plate.y + (plate.h - kBalanceStar) * 0.5,
                     kBalanceStar);
        text(canvas, balance, plate.x + kBalanceInset + kBalanceStar + textPad(kBalanceSize) * 0.5,
             plate.y + plate.h * 0.5, shopText(kBalanceSize, Align::Left));

        const double right = plate.x - 10.0;
        const double line = kFooterSize * kLineHeight;
        text(canvas, "You gain stars by completing challenges, or by", right,
             panel.y + kFooterTop + line * 0.5, shopText(kFooterSize, Align::Right));
        text(canvas, "redeeming a code on the Bonus tab.", right,
             panel.y + kFooterTop + line * 1.5, shopText(kFooterSize, Align::Right));
    }

    // --- tab contents -------------------------------------------------------
    // Laid out by the draw pass and answered for at the bottom of the frame.
    // A rect left empty is a region this tab does not have, and an empty rect
    // contains no point, so the hit tests need no second look at `tab_`.
    std::array<Rect, kShopOfferCount> priceButtons{};
    Rect codeField{};
    Rect redeemButton{};

    if (tab_ == Tab::Offers) {
        const std::int64_t rotation = shopRotation(shopClockNow());
        if (state.offersRotation != rotation) {
            state.offersRotation = rotation;
            state.offers = shopOffers(rotation);
        }

        text(canvas, "Today's offers:", panel.x + panel.w * 0.5, panel.y + kHeadingMiddle,
             shopText(kOffersHeadingSize));
        const std::int64_t remaining = shopRotationEnd(rotation) - shopClockNow();
        text(canvas, rotationCaption(remaining), panel.x + panel.w * 0.5, panel.y + kSubMiddle,
             shopText(kSubSize));

        // Locking an offer through a rotation is florr's; nothing on this
        // server keeps per-account offers, so the button is drawn where it
        // belongs and left inert -- no hover, no press -- rather than made to
        // lie about what it did.
        {
            const double width = measure("Lock", kLockSize) + textPad(kLockSize) + kLockExtra;
            const double right = panel.x + kGridLeft + 4.0 * kCellWidth + kPlateWidth;
            const Rect lock{right - width, panel.y + kHeaderTop + (kHeaderHeight - kLockHeight) * 0.5,
                            width, kLockHeight};
            drawFlorrButton(canvas, lock, kLockFace, kButtonBorder, kButtonRadius, false, false);
            text(canvas, "Lock", lock.x + lock.w * 0.5, lock.y + lock.h * 0.5, shopText(kLockSize));
        }

        std::array<Rect, kShopOfferCount> tiles{};
        for (std::size_t i = 0; i < state.offers.size() && i < kShopOfferCount; ++i) {
            const ShopOffer& offer = state.offers[i];
            const int column = static_cast<int>(i) % kShopOfferColumns;
            const int row = static_cast<int>(i) / kShopOfferColumns;
            const Vec2 plateAt = at(kGridLeft + column * kCellWidth, kGridTop + row * kCellHeight);
            fillQuadRound(canvas, {plateAt.x, plateAt.y, kPlateWidth, kPlateHeight}, kPlateRadius,
                          kWindowRim);

            tiles[i] = {plateAt.x + kTileLeft, plateAt.y + kTileTop, kTile, kTile};
            ItemTile tile;
            tile.petalIndex = offer.petalIndex;
            tile.rarity = offer.rarity;
            tile.timeSeconds = ctx.timeSeconds;
            drawItemTile(canvas, ctx.sprites, tiles[i], tile);

            // After the tile and before the button, as florr orders them.
            if (offer.discountPercent > 0) {
                drawDiscountBadge(canvas, {tiles[i].right(), tiles[i].y}, offer.discountPercent);
            }

            // The button is the card's one control. Every one is live whatever
            // the balance: a player who cannot afford a card is told so by the
            // server's refusal rather than by a card that quietly does nothing.
            const Rect price{plateAt.x + kPriceLeft, plateAt.y + kPriceTop, kPriceWidth,
                             kPriceHeight};
            priceButtons[i] = price;
            const bool hot = price.contains(under);
            if (hot) cursor = CursorShape::Hand;
            drawFlorrButton(canvas, price, kPriceFace, kButtonBorder, kButtonRadius, hot,
                            !modalUp && pressing(price));
            drawStarRow(canvas, price, formatPrice(offer.price), kPriceIconBox, kPriceStar,
                        kPriceSize);
        }
    } else if (tab_ == Tab::Bonus) {
        text(canvas, "Redeem a Code", panel.x + panel.w * 0.5, panel.y + kHeadingMiddle,
             shopText(kOffersHeadingSize));
        text(canvas, "Codes are handed out on the Discord, and each pays its stars once.",
             panel.x + panel.w * 0.5, panel.y + kSubMiddle, shopText(kSubSize));

        // The code box, 20 under the header: the highlight colour under its
        // shade's rim, the field and the button 20 in.
        const Rect box{panel.x + (panel.w - kCodeBoxWidth) * 0.5,
                       panel.y + kHeaderTop + kHeaderHeight + kDialogGap, kCodeBoxWidth,
                       kCodeFieldHeight + 2.0 * kDialogPad};
        drawFlorrPanel(canvas, box, kHighlight, slotCardShade(kHighlight));

        codeField = Rect{box.x + kDialogPad, box.y + kDialogPad,
                         box.w - 2.0 * kDialogPad - 10.0 - kRedeemWidth, kCodeFieldHeight};
        // The button's rim is its box: the rect it is laid out by sits half a
        // border inside, so the rim lines up with the field's edges.
        redeemButton = Rect{codeField.right() + 10.0, codeField.y, kRedeemWidth, kCodeFieldHeight};

        if (codeField.contains(under)) cursor = CursorShape::Text;
        inputField(canvas, codeField, state.code, "Enter code...", state.field.focused,
                   ctx.timeSeconds, &state.field);

        const bool usable = !trimmed(state.code).empty();
        const bool redeemHover = usable && redeemButton.contains(under);
        if (redeemHover) cursor = CursorShape::Hand;
        const double half = kButtonBorder * 0.5;
        const std::uint32_t face = slotCardShade(kHighlight);
        drawFlorrButton(canvas,
                        {redeemButton.x + half, redeemButton.y + half,
                         redeemButton.w - kButtonBorder, redeemButton.h - kButtonBorder},
                        usable ? face : kButtonIdle, kButtonBorder, kButtonRadius, redeemHover,
                        usable && !modalUp && pressing(redeemButton),
                        usable ? std::nullopt : std::optional<std::uint32_t>(kButtonIdleRim));
        text(canvas, "Redeem", redeemButton.x + redeemButton.w * 0.5,
             redeemButton.y + redeemButton.h * 0.5, shopText(kTabSize));
    } else {
        text(canvas, "Earn Stars by Defeating Mythic+ Mobs", panel.x + panel.w * 0.5,
             panel.y + kHeadingMiddle, shopText(kOffersHeadingSize));
        text(canvas, "Every kill at one of these tiers pays its stars to whoever helped.",
             panel.x + panel.w * 0.5, panel.y + kSubMiddle, shopText(kSubSize));

        // One card a tier on the store's own grid, in the row centred down the
        // two the store fills: the tier's colour framed florr's way where a
        // petal would stand, and what it pays where a price would.
        const double gridHeight = 2.0 * kCellHeight;
        const double top = kGridTop - 10.0 + (gridHeight - kPlateHeight) * 0.5;
        for (std::size_t i = 0; i < kChallenges.size(); ++i) {
            const StarChallenge& challenge = kChallenges[i];
            const Vec2 plateAt = at(kGridLeft + static_cast<double>(i) * kCellWidth, top);
            fillQuadRound(canvas, {plateAt.x, plateAt.y, kPlateWidth, kPlateHeight}, kPlateRadius,
                          kWindowRim);

            const double half = kButtonBorder * 0.5;
            const Rect swatch{plateAt.x + kTileLeft + half, plateAt.y + kTileTop + half,
                              kTile - kButtonBorder, kTile - kButtonBorder};
            drawFlorrButton(canvas, swatch, rarityColor(challenge.tier), kButtonBorder, kButtonRadius, false,
                            false);
            text(canvas, rarityLabel(challenge.tier), swatch.x + swatch.w * 0.5,
                 swatch.y + swatch.h * 0.5, shopText(kTabSize));

            const Rect reward{plateAt.x + kPriceLeft, plateAt.y + kPriceTop, kPriceWidth,
                              kPriceHeight};
            drawFlorrButton(canvas, reward, kPriceFace, kButtonBorder, kButtonRadius, false, false);
            drawStarRow(canvas, reward, "+" + std::to_string(challenge.stars), kPriceIconBox,
                        kPriceStar, kPriceSize);
        }
    }

    // --- dialog -------------------------------------------------------------
    // The window dims under it and one box stands on it, grown in about the
    // window's centre: a title, the message, and what can be done about it.
    Rect confirmRect{};
    Rect cancelRect{};
    if (state.shown != ShopState::Modal::None) {
        const double alpha = std::floor(kScrimMax * clamp(state.scrim, 0.0, 1.0)) / 255.0;
        if (alpha > 0) fillWindowRect(canvas, panel, kInk, alpha);

        const bool confirming = state.shown == ShopState::Modal::Confirm;
        const std::string title = confirming ? "Confirm" : "Error";
        const std::vector<std::string> lines =
            confirming ? std::vector<std::string>{"Are you sure you want to buy this?",
                                                  "Petal purchases are not refundable"}
                       : state.lines;
        const char* cancelLabel = confirming ? "Cancel" : "OK";
        const double cancelWidth =
            measure(cancelLabel, kDialogCancelSize) + textPad(kDialogCancelSize) + kDialogCancelExtra;
        const double buttonsWidth =
            confirming ? kDialogBuyWidth + kDialogButtonGap + cancelWidth : cancelWidth;

        // As wide as its widest line or its buttons, 20 in either side; as
        // tall as its column with 20 between the pieces.
        double widest = std::max(measure(title, kDialogTitleSize), buttonsWidth);
        for (const std::string& line : lines) widest = std::max(widest, measure(line, kDialogLineSize));
        const double titleRow = kDialogTitleSize * kLineHeight;
        const double lineRow = kDialogLineSize * kLineHeight;
        const double linesHeight = static_cast<double>(lines.size()) * lineRow;
        const double boxW = widest + 2.0 * kDialogPad;
        const double boxH = kDialogPad + titleRow + kDialogGap + linesHeight + kDialogGap +
                            (confirming ? kTile + kDialogGap : 0.0) + kDialogButtonHeight +
                            kDialogPad;
        const Vec2 centre{panel.x + panel.w * 0.5, panel.y + panel.h * 0.5};
        const Rect box{centre.x - boxW * 0.5, centre.y - boxH * 0.5, boxW, boxH};

        double y = box.y + kDialogPad;
        const double buttonsY = box.bottom() - kDialogPad - kDialogButtonHeight;
        double bx = centre.x - buttonsWidth * 0.5;
        if (confirming) {
            confirmRect = {bx, buttonsY, kDialogBuyWidth, kDialogButtonHeight};
            bx += kDialogBuyWidth + kDialogButtonGap;
        }
        cancelRect = {bx, buttonsY, cancelWidth, kDialogButtonHeight};

        const double scale = clamp(state.grow, 0.0, 1.0);
        if (scale > 1e-4) {
            canvas.save();
            canvas.translate(static_cast<float>(centre.x), static_cast<float>(centre.y));
            canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
            canvas.translate(static_cast<float>(-centre.x), static_cast<float>(-centre.y));

            drawFlorrPanel(canvas, box, kWindowFill, kWindowRim);
            text(canvas, title, centre.x, y + titleRow * 0.5, shopText(kDialogTitleSize));
            y += titleRow + kDialogGap;
            for (std::size_t i = 0; i < lines.size(); ++i) {
                // The confirm's second line is florr's danger colour.
                const std::uint32_t ink = confirming && i == 1 ? kRefundWarning : kPaper;
                text(canvas, lines[i], centre.x, y + lineRow * 0.5,
                     shopText(kDialogLineSize, Align::Centre, ink));
                y += lineRow;
            }
            y += kDialogGap;

            const bool answering = state.modal != ShopState::Modal::None;
            if (confirming) {
                ItemTile tile;
                tile.petalIndex = state.pendingPetal;
                tile.rarity = state.pendingRarity;
                tile.timeSeconds = ctx.timeSeconds;
                drawItemTile(canvas, ctx.sprites, {centre.x - kTile * 0.5, y, kTile, kTile}, tile);

                const bool hovered = answering && confirmRect.contains(mouse);
                if (hovered) cursor = CursorShape::Hand;
                drawFlorrButton(canvas, confirmRect, kPriceFace, kButtonBorder, kButtonRadius,
                                hovered, answering && pressing(confirmRect));
                drawStarRow(canvas, confirmRect, formatPrice(state.pendingPrice), kDialogStarBox,
                            kDialogStar, kDialogPriceSize);
            }

            const bool cancelHover = answering && cancelRect.contains(mouse);
            if (cancelHover) cursor = CursorShape::Hand;
            drawFlorrButton(canvas, cancelRect, kDialogGrey, kButtonBorder, kButtonRadius,
                            cancelHover, answering && pressing(cancelRect));
            text(canvas, cancelLabel, cancelRect.x + cancelRect.w * 0.5,
                 cancelRect.y + cancelRect.h * 0.5, shopText(kDialogCancelSize));
            canvas.restore();
        }
        // Only while the box is up and answering; one on its way out is a
        // picture.
        if (state.modal == ShopState::Modal::None) confirmRect = cancelRect = Rect{};
    }

    // Again over everything, as florr does, so nothing inside overruns it.
    drawFlorrRim(canvas, panel, kWindowRim);

    // The whole window has now been laid out, so this is the last word on what
    // the pointer is over.
    if (live) ctx.window.setCursorShape(cursor);

    // --- actions ------------------------------------------------------------
    // What the box says is left in place: it is still drawn on its way out.
    const auto closeModal = [&state] { state.modal = ShopState::Modal::None; };
    const auto resolveModal = [&](bool confirmed) {
        if (confirmed && state.modal == ShopState::Modal::Confirm &&
            state.pendingPetal != kNoPetal) {
            ctx.net.requestBuyPetal(state.pendingPetal, state.pendingRarity, state.pendingSlot);
        }
        closeModal();
    };
    const auto alert = [&](const std::string& message) {
        state.modal = ShopState::Modal::Alert;
        state.lines = wrapMessage(message, kDialogLineSize, 260.0);
    };
    const auto submitCode = [&] {
        const std::string code = trimmed(state.code);
        if (code.empty()) {
            alert("Please enter a code");
            return;
        }
        ctx.net.requestRedeemCode(code);
        // Cleared on SEND, not on the answer; the reply only decides between
        // the shower and the error box.
        state.code.clear();
        state.field.selection.collapse(0);
        state.field.caretSeconds = ctx.timeSeconds;
    };

    if (!live) return true;

    // --- keyboard -----------------------------------------------------------
    if (modalUp) {
        if (ctx.window.keyPressed(Key::Enter)) {
            resolveModal(state.modal == ShopState::Modal::Confirm);
        } else if (ctx.window.keyPressed(Key::Escape)) {
            closeModal();
        }
    } else if (state.field.focused) {
        // Printable ASCII only: codes are, and it keeps the caret's byte index
        // and its character index the same thing.
        TextEditOptions typing;
        typing.maxBytes = kCodeMaxLength;
        typing.asciiOnly = true;
        editText(ctx.window, state.code, state.field, ctx.timeSeconds, typing);
        if (ctx.window.keyPressed(Key::Enter)) submitCode();
        // Escape leaves the field rather than the panel. A second press then
        // reaches the menu system, where Escape is Settings' key.
        if (ctx.window.keyPressed(Key::Escape)) state.field.blur();
    }
    // The drag half of the pointer, before the click pass below claims it.
    if (!modalUp) {
        trackTextMouse(ctx.window, state.field, codeField,
                       inputFieldRun(codeField, state.code, state.field), state.code,
                       ctx.timeSeconds);
    }

    // --- mouse --------------------------------------------------------------
    // florr's buttons act on the RELEASE of a press that began on them -- the
    // pressed face is what shows while the button is held.
    if (!ctx.released()) return true;

    if (modalUp) {
        if (clicked(confirmRect)) resolveModal(true);
        else if (clicked(cancelRect)) resolveModal(false);
        // The scrim swallows everything else, including the close button.
        return true;
    }

    if (clicked(closeRect)) return false;

    for (int i = 0; i < 3; ++i) {
        if (!clicked(tabRects[static_cast<std::size_t>(i)])) continue;
        // Leaving the code field behind clears its focus, or the shop would go
        // on eating keystrokes from a tab with no field on it.
        if (static_cast<int>(tab_) != i) state.field.blur();
        tab_ = static_cast<Tab>(i);
        return true;
    }

    if (!trimmed(state.code).empty() && clicked(redeemButton)) {
        submitCode();
        return true;
    }

    for (std::size_t i = 0; i < state.offers.size() && i < kShopOfferCount; ++i) {
        if (!clicked(priceButtons[i])) continue;
        const ShopOffer& offer = state.offers[i];
        // Some of these prices are a whole session's stars; a stray click must
        // not spend one, so the purchase goes through a confirmation. The box
        // shows the petal itself rather than naming it.
        state.modal = ShopState::Modal::Confirm;
        state.pendingPetal = offer.petalIndex;
        state.pendingRarity = offer.rarity;
        state.pendingSlot = static_cast<int>(i);
        state.pendingPrice = offer.price;
        break;
    }
    return true;
}

} // namespace flix
