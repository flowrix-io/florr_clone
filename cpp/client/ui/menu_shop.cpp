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
#include "client/ui/petal_hover.h"
#include "client/ui/market_ui.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/core/text.h"
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
/// The window and its rim -- borderOf(fill) -- and every plate on it.
constexpr std::uint32_t kWindowFill = 0x7EEF6Du;
constexpr std::uint32_t kWindowRim = borderOf(kWindowFill);

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

// --- what Lock locks on -----------------------------------------------------

/// The picker a right click on Lock raises, as a dialog box on the window:
/// title, one line, the tier buttons with the search field beside them, the
/// grid of petals, and the count with Clear and Done under it.
constexpr double kWatchWidth = 660.0;
constexpr double kWatchHeight = 480.0;
constexpr double kWatchControlsHeight = 30.0;
constexpr double kWatchTierWidth = 66.0;
constexpr double kWatchTierGap = 8.0;
constexpr double kWatchTile = 64.0;
constexpr double kWatchTileGap = 11.0;
constexpr int kWatchColumns = 8;
constexpr double kWatchBar = 8.0;
constexpr double kWatchWheelStep = 40.0;
constexpr std::size_t kWatchSearchLimit = 64;
constexpr std::uint32_t kClearFace = 0xBB5555u;

/// The picker's tabs: any tier, then each tier the store sells, cheap to dear.
constexpr std::array<int, 5> kWatchTiers = {
    kShopWatchAnyTier, rarityIndex(Rarity::Mythic), rarityIndex(Rarity::Ultra),
    rarityIndex(Rarity::Super), rarityIndex(Rarity::Eternal)};

// --- this game's tabs -------------------------------------------------------

/// The Bonus tab's code box is the one highlighted thing on the window, in
/// Apex's colour and drawn the way florr draws a window: the colour under a
/// 7-wide rim of its border shade. Its Redeem button is the shade on the
/// shade's own shade, as florr's tabs sit on their strip -- grey, florr's
/// unusable button, until there is a code to send.
constexpr std::uint32_t kHighlight = 0xFF00FFu;   // rarityColor(Rarity::Apex)
constexpr double kCodeBoxWidth = 520.0;
constexpr double kCodeFieldHeight = 40.0;
constexpr double kRedeemWidth = 110.0;
constexpr std::uint32_t kButtonIdle = 0x777777u;

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
    {Rarity::Eternal, starsForKill(Rarity::Eternal)},
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
    enum class Modal : std::uint8_t { None, Confirm, Alert, Watch };

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

    /// Whether this opening has asked the server where the account's store
    /// stands -- locked or not -- yet. Asked each time the window opens and
    /// again when the store changes under it; the answer arrives as the
    /// "shop" reply on the tools channel.
    bool lockAsked = false;
    /// When it was last asked, so a clock that disagrees with the server's
    /// about the hour asks now and then rather than every frame.
    double lockAskedAt = 0;

    /// The picker: which tier it is showing, its search and its scroll.
    int watchTier = kShopWatchAnyTier;
    std::string watchSearch;
    ui::TextFieldState watchField;
    ui::Scroller watchScroll;
    /// The last reply whose refusal has been shown, so one is shown once.
    double lockRevisionSeen = -1;

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

/// The same line while the store is locked: how long the lock still holds.
std::string lockCaption(std::int64_t secondsLeft) {
    const std::int64_t s = std::max<std::int64_t>(0, secondsLeft);
    const auto unit = [](std::int64_t n, const char* one, const char* many) {
        return std::to_string(n) + " " + (n == 1 ? one : many);
    };
    std::string time;
    if (s >= 3600) time = unit(s / 3600, "hour", "hours");
    else if (s >= 60) time = unit(s / 60, "minute", "minutes");
    else time = unit(s, "second", "seconds");
    return "Offers locked for " + time;
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
    marketMode_=false;tab_=Tab::Offers;
    refreshMarketUi();
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
    // Asked again on the next opening: the lock may have run out, or been
    // pressed from another tab, while the window was shut.
    state.lockAsked = false;
    state.watchField.blur();
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
    drawFlorrPanel(canvas, panel, kWindowFill);

    text(canvas, marketMode_?"Mr. Bee's Market":"Shop", panel.x + panel.w * 0.5, panel.y + kTitleMiddle, shopText(kTitleSize));

    const Rect closeRect{panel.right() - kCloseFromRight, panel.y + kCloseTop, kCloseSide,
                         kCloseSide};
    const bool closeHover = closeRect.contains(under);
    if (closeHover) cursor = CursorShape::Hand;
    drawFlorrClose(canvas, closeRect, closeHover, !modalUp && pressing(closeRect));

    // --- tabs ---------------------------------------------------------------
    setFill(canvas, kWindowRim);
    canvas.fillRect(static_cast<float>(panel.x), static_cast<float>(panel.y + kStripTop),
                    static_cast<float>(panel.w), static_cast<float>(kStripHeight));
    static constexpr std::array<const char*, 5> kTabLabels{"Shop", "Challenge", "Bonus", "Market", "Orders"};
    const int tabCount=marketMode_?2:3;
    const double tabsWidth = tabCount * kTabWidth + (tabCount-1) * kTabGap;
    std::array<Rect, 5> tabRects{};
    for (int j = 0; j < tabCount; ++j) {
        const int i=marketMode_?j+3:j;
        const Rect rect{panel.x + (panel.w - tabsWidth) * 0.5 + j * (kTabWidth + kTabGap),
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
    if(tab_!=Tab::Market&&tab_!=Tab::Orders){
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
    Rect lockButton{};

    // Where the account's store stands. Asked for once each opening, and kept
    // in step afterwards by the answer every Lock and Unlock press gets back.
    const auto sendShop = [&](const char* action) {
        Json q = Json::object();
        q["kind"] = "shop";
        q["action"] = action;
        ctx.net.requestAdminTools(q);
    };
    const Json& lockReply = ctx.net.adminTools("shop");
    const bool lockAnswered = lockReply["kind"].asString() == "shop";
    const std::int64_t now = shopClockNow();
    const auto lockedUntil = static_cast<std::int64_t>(lockReply["until"].asDouble(0));
    const bool storeLocked =
        lockAnswered && lockReply["ok"].asBool() && lockReply["locked"].asBool() && now < lockedUntil;
    // Asked again when the hour turns or the lock runs out: the store that
    // comes up may hold a petal the account locks on.
    const bool lockStale =
        lockAnswered && lockReply["ok"].asBool() && !storeLocked &&
        (lockReply["locked"].asBool() ||
         static_cast<std::int64_t>(lockReply["rotation"].asDouble(0)) != shopRotation(now)) &&
        ctx.timeSeconds - state.lockAskedAt >= 5.0;
    if (live && (!state.lockAsked || lockStale) && ctx.net.haveSession()) {
        state.lockAsked = true;
        state.lockAskedAt = ctx.timeSeconds;
        sendShop("status");
    }
    const Json& watches = lockReply["watches"];
    const auto watched = [&](std::uint16_t petal, int tier) {
        if (!watches.isArray()) return false;
        const std::string& id = content().petal(petal).id;
        for (const Json& row : watches.items()) {
            if (row["tier"].asInt(kShopWatchAnyTier) == tier && row["petal"].asString() == id) {
                return true;
            }
        }
        return false;
    };
    if (lockAnswered && !lockReply["ok"].asBool() &&
        lockReply["revision"].asDouble(0) != state.lockRevisionSeen) {
        state.lockRevisionSeen = lockReply["revision"].asDouble(0);
        const std::string why = lockReply["message"].asString();
        if (!why.empty()) {
            state.modal = ShopState::Modal::Alert;
            state.lines = wrapMessage("Lock failed: " + why, kDialogLineSize, 260.0);
        }
    }

    if (tab_ == Tab::Market || tab_ == Tab::Orders) {
        MenuContext market=ctx; market.pointerBlocked=ctx.pointerBlocked||modalUp||open_<.9||closing_;
        renderMarket(market,{panel.x+13,panel.y+kStripTop+kStripHeight+8,panel.w-26,panel.h-kStripTop-kStripHeight-25},tab_==Tab::Orders);
        ctx.wantsText=ctx.wantsText||market.wantsText;
    } else if (tab_ == Tab::Offers) {
        // A locked store keeps showing the rotation it was locked on; the
        // server prices a purchase from the same one.
        const std::int64_t rotation =
            storeLocked ? static_cast<std::int64_t>(lockReply["rotation"].asDouble(0))
                        : shopRotation(now);
        if (state.offersRotation != rotation) {
            state.offersRotation = rotation;
            state.offers = shopOffers(rotation);
        }

        text(canvas, "Today's offers:", panel.x + panel.w * 0.5, panel.y + kHeadingMiddle,
             shopText(kOffersHeadingSize));
        const std::string caption = storeLocked
                                        ? lockCaption(lockedUntil - now)
                                        : rotationCaption(shopRotationEnd(rotation) - now);
        text(canvas, caption, panel.x + panel.w * 0.5, panel.y + kSubMiddle, shopText(kSubSize));

        // Lock keeps these ten cards through the hourly change, for up to a
        // day; Unlock goes back to the live store. Held by the server against
        // the account (server/shop.cpp), which prices a purchase from the
        // same rotation the cards were drawn from. Not offered until the
        // server has said where the store stands, so the label never lies.
        if (lockAnswered && lockReply["ok"].asBool()) {
            const char* label = storeLocked ? "Unlock" : "Lock";
            const double width = measure(label, kLockSize) + textPad(kLockSize) + kLockExtra;
            const double right = panel.x + kGridLeft + 4.0 * kCellWidth + kPlateWidth;
            lockButton = Rect{right - width,
                              panel.y + kHeaderTop + (kHeaderHeight - kLockHeight) * 0.5, width,
                              kLockHeight};
            const bool hot = lockButton.contains(under);
            if (hot) cursor = CursorShape::Hand;
            drawFlorrButton(canvas, lockButton, storeLocked ? kDialogGrey : kLockFace,
                            kButtonBorder, kButtonRadius, hot, !modalUp && pressing(lockButton));
            text(canvas, label, lockButton.x + lockButton.w * 0.5,
                 lockButton.y + lockButton.h * 0.5, shopText(kLockSize));

            // Across from it, what it locks on by itself -- and, under the
            // pointer, how that is set.
            const std::size_t count = watches.isArray() ? watches.size() : 0;
            std::string note;
            if (hot) note = "Right click to select a petal to lock on";
            else if (count > 0) {
                note = "Locks on " + std::to_string(count) + (count == 1 ? " petal" : " petals");
            }
            if (!note.empty()) {
                text(canvas, note, panel.x + kGridLeft, lockButton.y + lockButton.h * 0.5,
                     shopText(kLockSize, Align::Left));
            }
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
        drawFlorrPanel(canvas, box, kHighlight);

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
        const std::uint32_t face = borderOf(kHighlight);
        drawFlorrButton(canvas,
                        {redeemButton.x + half, redeemButton.y + half,
                         redeemButton.w - kButtonBorder, redeemButton.h - kButtonBorder},
                        usable ? face : kButtonIdle, kButtonBorder, kButtonRadius, redeemHover,
                        usable && !modalUp && pressing(redeemButton));
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
    // The picker's, laid out only while it is the box that is up.
    Rect watchClose{};
    Rect watchSearchRect{};
    Rect watchClear{};
    Rect watchDone{};
    std::array<Rect, kWatchTiers.size()> watchTabs{};
    std::uint16_t watchHovered = kNoPetal;
    Rect watchHoveredRect{};
    if (state.shown != ShopState::Modal::None) {
        const double alpha = std::floor(kScrimMax * clamp(state.scrim, 0.0, 1.0)) / 255.0;
        if (alpha > 0) fillWindowRect(canvas, panel, kInk, alpha);
        // The cards under the scrim are not what the pointer is on: only the
        // petal in the dialog itself, painted after this, may show its stats.
        coverPetalHover(panel);
    }
    if (state.shown == ShopState::Modal::Watch) {
        const Vec2 centre{panel.x + panel.w * 0.5, panel.y + panel.h * 0.5};
        const Rect box{centre.x - kWatchWidth * 0.5, centre.y - kWatchHeight * 0.5, kWatchWidth,
                       kWatchHeight};
        const double left = box.x + kDialogPad;
        const double right = box.right() - kDialogPad;
        const bool answering = state.modal == ShopState::Modal::Watch;

        double y = box.y + 10.0;
        const double titleMiddle = y + kDialogTitleSize * kLineHeight * 0.5;
        y += kDialogTitleSize * kLineHeight;
        const double lineMiddle = y + kDialogLineSize * kLineHeight * 0.5;
        y += kDialogLineSize * kLineHeight + 10.0;
        watchClose = {right - kCloseSide, titleMiddle - kCloseSide * 0.5, kCloseSide, kCloseSide};
        for (std::size_t i = 0; i < watchTabs.size(); ++i) {
            watchTabs[i] = {left + 2.0 + static_cast<double>(i) * (kWatchTierWidth + kWatchTierGap),
                            y + 2.0, kWatchTierWidth, kWatchControlsHeight - 4.0};
        }
        const double searchX = watchTabs.back().right() + 14.0;
        watchSearchRect = {searchX, y, right - searchX, kWatchControlsHeight};
        y += kWatchControlsHeight + 10.0;
        const double footerY = box.bottom() - 16.0 - kDialogButtonHeight;
        const Rect view{left, y, right - left, footerY - 12.0 - y};
        const double doneWidth = measure("Done", kDialogCancelSize) +
                                 textPad(kDialogCancelSize) + kDialogCancelExtra;
        const double clearWidth = measure("Clear", kDialogCancelSize) +
                                  textPad(kDialogCancelSize) + kDialogCancelExtra;
        watchDone = {right - doneWidth, footerY, doneWidth, kDialogButtonHeight};
        watchClear = {watchDone.x - kDialogButtonGap - clearWidth, footerY, clearWidth,
                      kDialogButtonHeight};

        // Every petal the store can show at this tier, in the order the rest
        // of the game lists petals.
        const std::string wanted = trimmed(lowerCase(state.watchSearch));
        std::vector<std::uint16_t> petals;
        for (const std::uint16_t index : content().petalDisplayOrder()) {
            if (!shopMayOffer(index, state.watchTier)) continue;
            const PetalConfig& petal = content().petal(index);
            if (!wanted.empty() && lowerCase(petal.name).find(wanted) == std::string::npos &&
                lowerCase(petal.id).find(wanted) == std::string::npos) {
                continue;
            }
            petals.push_back(index);
        }
        constexpr double kPitch = kWatchTile + kWatchTileGap;
        const std::size_t rows = (petals.size() + kWatchColumns - 1) / kWatchColumns;
        state.watchScroll.contentHeight = static_cast<double>(rows) * kPitch - kWatchTileGap + 4.0;
        state.watchScroll.viewHeight = view.h;
        if (answering) {
            if (box.contains(mouse)) state.watchScroll.offset -= ctx.wheel() * kWatchWheelStep;
            state.watchScroll.offset -=
                touchScroll(ctx.window, view, state.watchScroll.maxOffset() > 0);
        }
        state.watchScroll.offset =
            clamp(state.watchScroll.offset, 0.0, state.watchScroll.maxOffset());

        const double scale = clamp(state.grow, 0.0, 1.0);
        if (scale > 1e-4) {
            canvas.save();
            canvas.translate(static_cast<float>(centre.x), static_cast<float>(centre.y));
            canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
            canvas.translate(static_cast<float>(-centre.x), static_cast<float>(-centre.y));

            drawFlorrPanel(canvas, box, kWindowFill);
            text(canvas, "Lock on a petal", centre.x, titleMiddle, shopText(kDialogTitleSize));
            text(canvas, "The store locks itself for a day when a picked petal is on offer.",
                 centre.x, lineMiddle, shopText(kDialogLineSize));
            const bool closeHot = answering && watchClose.contains(mouse);
            if (closeHot) cursor = CursorShape::Hand;
            drawFlorrClose(canvas, watchClose, closeHot, answering && pressing(watchClose));

            // What is chosen is ringed in ink: white is lost on the top tier's
            // white plate.
            const auto ring = [&](Rect r, double grow) {
                setStroke(canvas, kInk);
                canvas.setLineWidth(3.0f);
                canvas.beginPath();
                canvas.roundRect(static_cast<float>(r.x - grow), static_cast<float>(r.y - grow),
                                 static_cast<float>(r.w + 2.0 * grow),
                                 static_cast<float>(r.h + 2.0 * grow), 6.0f);
                canvas.stroke();
            };
            for (std::size_t i = 0; i < watchTabs.size(); ++i) {
                const int tier = kWatchTiers[i];
                const bool hot = answering && watchTabs[i].contains(mouse);
                if (hot) cursor = CursorShape::Hand;
                const bool any = tier == kShopWatchAnyTier;
                drawFlorrButton(canvas, watchTabs[i],
                                any ? kButtonIdle : rarityColor(static_cast<Rarity>(tier)),
                                kButtonBorder, kButtonRadius, hot,
                                state.watchTier == tier || (answering && pressing(watchTabs[i])));
                text(canvas, any ? "Any" : rarityLabel(static_cast<Rarity>(tier)),
                     watchTabs[i].x + watchTabs[i].w * 0.5, watchTabs[i].y + watchTabs[i].h * 0.5,
                     shopText(kDialogLineSize));
                if (state.watchTier == tier) ring(watchTabs[i], 3.0);
            }
            if (answering && watchSearchRect.contains(mouse)) cursor = CursorShape::Text;
            inputField(canvas, watchSearchRect, state.watchSearch, "Search...",
                       state.watchField.focused, ctx.timeSeconds, &state.watchField);

            canvas.save();
            canvas.beginPath();
            canvas.rect(static_cast<float>(view.x), static_cast<float>(view.y),
                        static_cast<float>(view.w), static_cast<float>(view.h));
            canvas.clip();
            for (std::size_t i = 0; i < petals.size(); ++i) {
                const Rect cell{view.x + 2.0 + static_cast<double>(i % kWatchColumns) * kPitch,
                                view.y + 2.0 - state.watchScroll.offset +
                                    static_cast<double>(i / kWatchColumns) * kPitch,
                                kWatchTile, kWatchTile};
                if (cell.bottom() <= view.y || cell.y >= view.bottom()) continue;
                ItemTile tile;
                tile.petalIndex = petals[i];
                // Any tier is no tier's colour: the grey plate.
                tile.greyed = state.watchTier == kShopWatchAnyTier;
                tile.rarity = static_cast<Rarity>(
                    tile.greyed ? std::max(rarityIndex(Rarity::Mythic),
                                           rarityIndex(content().petal(petals[i]).minRarity))
                                : state.watchTier);
                // Already locked on whatever its tier.
                if (!tile.greyed && watched(petals[i], kShopWatchAnyTier)) tile.badge = "Any";
                tile.timeSeconds = ctx.timeSeconds;
                tile.tooltip = false;
                drawItemTile(canvas, ctx.sprites, cell, tile);
                if (watched(petals[i], state.watchTier)) ring(cell, 0.0);
                if (answering && view.contains(mouse) && cell.contains(mouse)) {
                    watchHovered = petals[i];
                    watchHoveredRect = cell;
                    cursor = CursorShape::Hand;
                    notePetalHoverAt(cell, petals[i], tile.rarity);
                }
            }
            canvas.restore();
            if (petals.empty()) {
                text(canvas, "No petals found", centre.x, view.y + view.h * 0.5,
                     shopText(kDialogLineSize));
            }
            scrollbar(canvas, view, state.watchScroll.contentHeight, state.watchScroll.offset,
                      kWindowRim, kWatchBar);

            const std::size_t count = watches.isArray() ? watches.size() : 0;
            text(canvas,
                 std::to_string(count) + " / " + std::to_string(kMaxShopWatches) + " picked", left,
                 footerY + kDialogButtonHeight * 0.5, shopText(kDialogLineSize, Align::Left));
            const auto footerButton = [&](Rect r, const char* label, std::uint32_t face,
                                          bool usable) {
                const bool hot = usable && answering && r.contains(mouse);
                if (hot) cursor = CursorShape::Hand;
                drawFlorrButton(canvas, r, usable ? face : kButtonIdle, kButtonBorder,
                                kButtonRadius, hot, usable && answering && pressing(r));
                text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5, shopText(kDialogCancelSize));
            };
            footerButton(watchClear, "Clear", kClearFace, count > 0);
            footerButton(watchDone, "Done", kLockFace, true);
            canvas.restore();
        }
        if (!answering) {
            watchClose = watchSearchRect = watchClear = watchDone = Rect{};
            watchTabs.fill(Rect{});
        }
    } else if (state.shown != ShopState::Modal::None) {
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

            drawFlorrPanel(canvas, box, kWindowFill);
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
    const auto closeModal = [&state] {
        state.modal = ShopState::Modal::None;
        state.watchField.blur();
    };
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
    if (state.modal == ShopState::Modal::Watch && state.watchField.focused) {
        TextEditOptions typing;
        typing.maxBytes = kWatchSearchLimit;
        editText(ctx.window, state.watchSearch, state.watchField, ctx.timeSeconds, typing);
        if (ctx.window.keyPressed(Key::Enter) || ctx.window.keyPressed(Key::Escape)) {
            state.watchField.blur();
        }
    } else if (modalUp) {
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

    if (state.modal == ShopState::Modal::Watch) {
        trackTextMouse(ctx.window, state.watchField, watchSearchRect,
                       inputFieldRun(watchSearchRect, state.watchSearch, state.watchField),
                       state.watchSearch, ctx.timeSeconds);
    }

    // Right on Lock picks what it locks on, on the press as every right click
    // in the game does.
    if (!modalUp && !ctx.pointerBlocked && ctx.window.mousePressed(MouseButton::Right) &&
        lockButton.contains(mouse)) {
        state.modal = ShopState::Modal::Watch;
        state.watchScroll.offset = 0;
        ctx.rightPressTaken = true;
        return true;
    }

    // --- mouse --------------------------------------------------------------
    // florr's buttons act on the RELEASE of a press that began on them -- the
    // pressed face is what shows while the button is held.
    if (!ctx.released()) return true;

    if (modalUp) {
        if (state.modal == ShopState::Modal::Watch) {
            if (clicked(watchClose) || clicked(watchDone)) {
                closeModal();
            } else if (clicked(watchClear)) {
                if (watches.isArray() && watches.size() > 0) sendShop("clear_watches");
            } else if (watchHovered != kNoPetal && clicked(watchHoveredRect)) {
                const bool on = !watched(watchHovered, state.watchTier);
                if (on && watches.isArray() && watches.size() >= kMaxShopWatches) {
                    alert("The store can lock on " + std::to_string(kMaxShopWatches) +
                          " petals at most");
                } else {
                    Json q = Json::object();
                    q["kind"] = "shop";
                    q["action"] = "watch";
                    q["petal"] = content().petal(watchHovered).id;
                    q["tier"] = static_cast<double>(state.watchTier);
                    q["on"] = on;
                    ctx.net.requestAdminTools(q);
                }
            } else {
                for (std::size_t i = 0; i < watchTabs.size(); ++i) {
                    if (!clicked(watchTabs[i])) continue;
                    state.watchTier = kWatchTiers[i];
                    state.watchScroll.offset = 0;
                }
            }
            return true;
        }
        if (clicked(confirmRect)) resolveModal(true);
        else if (clicked(cancelRect)) resolveModal(false);
        // The scrim swallows everything else, including the close button.
        return true;
    }

    if (clicked(closeRect)) return false;

    for (int j = 0; j < tabCount; ++j) {
        const int i=marketMode_?j+3:j;
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

    if (clicked(lockButton)) {
        sendShop(storeLocked ? "unlock" : "lock");
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
