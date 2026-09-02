// The star shop.
//
// A redeem-code band over two tabs: a catalogue of every petal at every
// buyable tier, and the challenges that pay the stars to buy them with. The
// price ladder is steep on purpose -- 3.5x a tier -- so the catalogue is
// mostly a wish list, and the challenge list beside it is what makes that
// legible.
//
// Every metric below is the browser panel's own, unscaled: that card is a
// fixed 700 CSS px wide and two thirds of the window tall, and so is this one,
// so the numbers transfer as literals rather than as derived fractions.

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
#include "shared/game/config.h"
#include "shared/game/shop.h"

namespace flr {

using namespace flr::ui;

namespace {

constexpr double kPad = 20.0;
constexpr double kHeaderHeight = 90.0;
constexpr double kCodeSectionHeight = 110.0;
constexpr double kTabsHeight = 50.0;
constexpr double kTabWidth = 130.0;
constexpr double kTabPitch = 140.0;
constexpr double kCardSize = 44.0;
constexpr double kPriceBarHeight = 12.0;
constexpr double kCardGap = 8.0;
constexpr double kScrollbarWidth = 6.0;

/// Half-period of the code field's caret: 530 ms on, 530 ms off.
constexpr double kCaretBlinkSeconds = 0.530;
constexpr std::size_t kCodeMaxLength = 64;

/// One wheel notch in a browser is 100 CSS px of `deltaY`, and the shop adds
/// that delta raw. Anything else scrolls a different distance per notch than
/// the panel this one is copying.
constexpr double kWheelPixels = 100.0;

constexpr std::uint32_t kCodeBlue = 0x4A90E2u;
constexpr std::uint32_t kCodeBlueHover = 0x5FA1EDu;
constexpr std::uint32_t kCodeBlueLit = 0x7EB9F7u;
constexpr std::uint32_t kGold = 0xFFD700u;
constexpr std::uint32_t kAlert = 0xE74C3Cu;
constexpr std::uint32_t kModalBox = 0x2C3E50u;
constexpr std::uint32_t kModalCancel = 0x7F8C8Du;

/// The challenge tiers, with their card colour stored rather than derived:
/// the shop overrides the rarity palette for unique, which is white in the
/// tier table and purple here.
struct StarChallenge {
    Rarity tier;
    int stars;
    std::uint32_t color;
};

const std::array<StarChallenge, 5> kChallenges = {{
    {Rarity::Mythic, 1, 0x1FDBDEu},
    {Rarity::Ultra, 5, 0xDE1F65u},
    {Rarity::Super, 25, 0x2BFFA4u},
    {Rarity::Unique, 100, 0xBF00FFu},
    {Rarity::Apex, 250, 0xFF00FFu},
}};

/// One catalogue card. `rect.y` is in CONTENT space -- the scroll offset is
/// applied at draw time, so the layout pass does not have to run again when
/// the wheel moves.
struct Card {
    Rect rect;
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    double price = 0;
    bool affordable = false;
};

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

/// The code field, the modal and the per-tab scroll offsets.
///
/// `ShopPanel` is declared in menus.h, which this file does not own, so this
/// state lives beside the panel and is keyed on the instance rather than being
/// a file-level singleton -- two shops would otherwise share one code field.
/// It belongs in the class the moment the header can take it.
struct ShopState {
    enum class Modal : std::uint8_t { None, Confirm, Alert };

    std::string code;
    std::size_t caret = 0;
    bool focused = false;
    /// When the blink phase last restarted. Anchored to the last edit rather
    /// than taken modulo wall time, so the caret is solid the instant a key
    /// lands instead of blinking out mid-keystroke.
    double caretAnchor = 0;

    Modal modal = Modal::None;
    std::string message;
    std::uint32_t messageColor = kPaper;
    std::uint16_t pendingPetal = kNoPetal;
    Rarity pendingRarity = Rarity::Common;

    /// Indexed by tab. Kept across a tab switch and across a close, as the
    /// browser does: a player who scrolled down to the mythic prices does not
    /// want to find the top of the list again on the way back.
    std::array<double, 2> scroll{{0.0, 0.0}};

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

void roundedPath(Canvas& canvas, Rect r, double radius) {
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h),
                     static_cast<float>(std::min(radius, std::min(r.w, r.h) * 0.5)));
}

void fillRounded(Canvas& canvas, Rect r, double radius, std::uint32_t rgb, double alpha = 1.0) {
    if (r.w <= 0 || r.h <= 0) return;
    setFill(canvas, rgb, alpha);
    roundedPath(canvas, r, radius);
    canvas.fill();
}

/// A stroke CENTRED on the box, which is what `ctx.stroke()` after `roundRect`
/// does in the reference -- half of it hangs outside `r`. The shared `plate()`
/// insets instead, and every border here would land a pixel in from where the
/// browser puts it.
void strokeRounded(Canvas& canvas, Rect r, double radius, std::uint32_t rgb, double width,
                   double alpha = 1.0) {
    if (r.w <= 0 || r.h <= 0) return;
    canvas.save();
    canvas.setLineJoin("round");
    canvas.setLineWidth(static_cast<float>(width));
    setStroke(canvas, rgb, alpha);
    roundedPath(canvas, r, radius);
    canvas.stroke();
    canvas.restore();
}

/// The browser sets `lineJoin = 'round'` once in drawHeader and never puts it
/// back, so every glyph outline on this panel is round-joined.
TextStyle shopText(double size, bool bold, std::uint32_t fill, double strokeWidth) {
    TextStyle style;
    style.size = size;
    style.bold = bold;
    style.fill = fill;
    style.strokeWidth = strokeWidth;
    style.roundJoin = true;
    return style;
}

/// `text()` with an alpha on the FILL alone.
///
/// The reference fades a label by filling it `rgba(255,255,255,a)` over an
/// OPAQUE black outline. Wrapping the whole of `text()` in a globalAlpha takes
/// the outline with it, and a faded outline over this card's green is not
/// black any more -- an inactive tab's darkest pixel measures #184a21 that way
/// against the reference's #000000, and the label reads green-edged.
void fadedText(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style,
               double fillAlpha) {
    if (s.empty() || !Fonts::ready()) return;

    double penX = x;
    if (style.align != Align::Left) {
        const double width = measure(s, style.size, style.bold);
        penX -= style.align == Align::Centre ? width * 0.5 : width;
    }
    double penY = y;
    switch (style.baseline) {
        case Baseline::Top: penY += ascent(style.size, style.bold); break;
        case Baseline::Bottom: penY += descent(style.size, style.bold); break;
        case Baseline::Alphabetic: break;
        default:
            penY += (ascent(style.size, style.bold) + descent(style.size, style.bold)) * 0.5;
            break;
    }

    Path2D glyphs;
    appendGlyphs(glyphs, s, penX, penY, style.size, style.bold);
    if (glyphs.empty()) return;

    const double strokeWidth =
        style.strokeWidth < 0 ? style.size * kTextStrokeRatio : style.strokeWidth;
    if (strokeWidth > 0) {
        canvas.save();
        canvas.setLineJoin(style.roundJoin ? "round" : "miter");
        canvas.setLineCap("butt");
        canvas.setLineWidth(static_cast<float>(strokeWidth));
        setStroke(canvas, style.stroke);
        canvas.stroke(glyphs);
        canvas.restore();
    }
    setFill(canvas, style.fill, fillAlpha);
    canvas.fill(glyphs, "nonzero");
}

/// The card's `box-shadow: 0 6px 18px rgba(0,0,0,0.3)`.
///
/// A CSS blur radius is twice the Gaussian's standard deviation, so 18px of
/// blur is sigma 9: half of the 0.3 lands against the card's own edge and the
/// rest fades to nothing twenty pixels out. The canvas has no blur, so the
/// profile is laid down as one-pixel BANDS rather than as a stack of expanded
/// silhouettes -- the bands do not overlap, so each carries the finished alpha
/// for its own distance, and twenty card-sized fills a frame do not happen.
void panelShadow(Canvas& canvas, Rect panel) {
    /// Past here the next band's alpha rounds to nothing at eight bits.
    constexpr int kBands = 22;
    constexpr double kBlurSigma = 9.0;
    constexpr double kShadowAlpha = 0.30;

    // How much of the shadow survives `distance` pixels outside its edge.
    const auto coverage = [](double distance) {
        return kShadowAlpha * 0.5 * std::erfc(distance / (kBlurSigma * std::sqrt(2.0)));
    };

    // The silhouette itself, offset 6 down. Only the strip of it the card does
    // not cover is ever seen, but that strip is at the shadow's full alpha and
    // the bands below start outside it.
    const Rect cast{panel.x, panel.y + 6.0, panel.w, panel.h};
    fillRounded(canvas, cast, 3.0, kInk, kShadowAlpha);

    for (int band = kBands; band >= 1; --band) {
        // Band `n` fills the ring between expansions n-1 and n, whose pixel
        // centres sit half a pixel inside it.
        const double alpha = coverage(band - 0.5);
        if (alpha <= 0.002) continue;
        setFill(canvas, kInk, alpha);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(cast.x - band), static_cast<float>(cast.y - band),
                         static_cast<float>(cast.w + band * 2),
                         static_cast<float>(cast.h + band * 2), static_cast<float>(3.0 + band));
        canvas.roundRect(static_cast<float>(cast.x - (band - 1)),
                         static_cast<float>(cast.y - (band - 1)),
                         static_cast<float>(cast.w + (band - 1) * 2),
                         static_cast<float>(cast.h + (band - 1) * 2),
                         static_cast<float>(3.0 + band - 1));
        canvas.fill("evenodd");
    }
}

/// The gold star, from the same game-icons.net document the browser recolours
/// and draws as an image. Compiled once; the glyph is a fat five-point star
/// with concave limbs that a regular polygon does not resemble.
const SvgDocument* starDocument() {
    static const SvgDocument doc = [] {
        const int index = menuIconIndex("stars");
        if (index < 0) return SvgDocument::fromString(std::string());
        std::string svg = kMenuIcons[index].svg;
        const std::string white = "fill=\"#fff\"";
        const std::string gold = "fill=\"#ffd700\"";
        for (std::size_t at = svg.find(white); at != std::string::npos;
             at = svg.find(white, at + gold.size())) {
            svg.replace(at, white.size(), gold);
        }
        return SvgDocument::fromString(svg);
    }();
    return doc.empty() ? nullptr : &doc;
}

/// A star, drawn rather than typed: the glyph is not in the shipped face, and
/// the shop is the one screen where the currency has to be unmistakable. Only
/// reached when the SVG failed to compile.
void drawStar(Canvas& canvas, Vec2 at, double radius) {
    setFill(canvas, kGold);
    canvas.beginPath();
    for (int i = 0; i < 10; ++i) {
        const double r = (i % 2 == 0) ? radius : radius * 0.45;
        const Vec2 p = at + Vec2::fromAngle(-kPi * 0.5 + i * kPi / 5.0, r);
        if (i == 0) canvas.moveTo(static_cast<float>(p.x), static_cast<float>(p.y));
        else canvas.lineTo(static_cast<float>(p.x), static_cast<float>(p.y));
    }
    canvas.closePath();
    canvas.fill();
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

/// The star icon in a `size` square whose top-left corner is (x, y), matching
/// the reference's `drawImage(icon, x, y, size, size)`.
void drawStarIcon(Canvas& canvas, double x, double y, double size) {
    if (const SvgDocument* doc = starDocument()) {
        doc->renderFitted(canvas, static_cast<float>(x), static_cast<float>(y),
                          static_cast<float>(size), 0.0f);
        return;
    }
    drawStar(canvas, {x + size * 0.5, y + size * 0.5}, size * 0.5);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/// The browser's `formatPrice`. Deliberately not `abbreviate()`: the shared
/// helper keeps a decimal from 10k up, and the shop drops it -- 18382 reads
/// "18k" on a 44px card, not "18.4k".
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
    // `%.*f` breaks it to even, so a 2,250-star card reads "2.3k" in the
    // reference and would read "2.2k" here.
    const double scale = std::pow(10.0, decimals);
    value = std::floor(value * scale + 0.5) / scale;
    std::snprintf(buffer, sizeof buffer, "%.*f", decimals, value);
    std::string out = buffer;
    // "1.0k" reads worse than "1k", and the trailing zero is never news.
    if (out.size() > 2 && out.compare(out.size() - 2, 2, ".0") == 0) out.erase(out.size() - 2);
    return out + suffix;
}

/// Greedy word wrap for the modal message. A single word wider than the limit
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
            if (!line.empty() && measure(candidate, size, false) > maxWidth) {
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

bool caretVisible(double timeSeconds, double anchorSeconds) {
    const double since = std::max(0.0, timeSeconds - anchorSeconds);
    return static_cast<long long>(since / kCaretBlinkSeconds) % 2 == 0;
}

/// The buttons along the bottom of the modal, laid out by the draw pass and
/// hit-tested by the input pass.
struct ModalButton {
    Rect rect;
    const char* label = "";
    std::uint32_t fill = kCodeBlue;
    bool confirms = false;
};

} // namespace

double ShopPanel::preferredWidth() { return 700.0; }

void ShopPanel::reset() {
    // The browser keeps its scroll offsets and whatever was typed into the
    // code field for the manager's whole lifetime; closing the panel drops
    // only the focus and any open modal.
    ShopState& state = stateFor(this);
    state.focused = false;
    state.modal = ShopState::Modal::None;
    state.message.clear();
    state.pendingPetal = kNoPetal;
    // The shower belongs to the moment a code was redeemed. It rains on the
    // game canvas in the reference and so outlives the card there; this one
    // can only be drawn while the card is up, and a shower that resumed
    // mid-air an hour later would be a ghost of a reward already given.
    state.stars.clear();
}

bool ShopPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    ShopState& state = stateFor(this);

    // The server's answer to a purchase or a code. Read before the modal is
    // latched, so a refusal raises its alert on the frame it arrived rather
    // than the one after.
    ShopOutcome& answer = ctx.net.shopOutcome();
    if (answer.pending) {
        answer.pending = false;
        if (!answer.ok) {
            state.modal = ShopState::Modal::Alert;
            state.message =
                (answer.redeem ? "Code redemption failed: " : "Purchase failed: ") + answer.message;
            state.messageColor = kAlert;
        } else if (answer.redeem) {
            // The field was already cleared when the code was sent, as the
            // reference clears it; the stars are the whole confirmation.
            spawnFallingStars(state, ctx.window.width());
        }
    }

    // Behind everything, including the card: the reference drops these on the
    // game canvas and the shop's own canvas sits over it.
    if (!state.stars.empty()) {
        drawFallingStars(canvas, state, ctx.dt, ctx.window.height());
    }

    // Input answers the frame that was drawn, so the modal's presence is
    // latched here and used by both passes.
    const bool modalUp = state.modal != ShopState::Modal::None;

    // What the pointer is over. Assigned as the regions are laid out and
    // pushed to the window once, at the end of the draw pass, exactly as the
    // reference assigns `canvas.style.cursor` once per move.
    CursorShape cursor = CursorShape::Arrow;

    // A focused field or an open modal owns the keyboard. Without this the
    // menu system reads every letter typed into the code field as a hotkey and
    // Escape as "close the shop".
    if (modalUp || state.focused) ctx.wantsText = true;

    // Read the balance from the live entity when there is one, so a mythic
    // kill's payout shows up before the next profile arrives.
    const int stars = ctx.net.status() == NetClient::Status::Playing
                          ? ctx.net.view().self().stars
                          : profile.stars;

    // --- card ---------------------------------------------------------------
    panelShadow(canvas, panel);
    // A 2px frame, not the shared 4: the reference strokes its rounded path
    // centred on the canvas edge, so only half the 4px stroke is ever visible.
    panelCard(canvas, panel, kShopSkin, 2.0, 3.0);

    // --- header -------------------------------------------------------------
    TextStyle title = shopText(24.0, true, kPaper, 4.0);
    title.align = Align::Centre;
    text(canvas, "Shop", panel.x + panel.w * 0.5, panel.y + kPad + 18.0, title);

    const std::string balance = withSeparators(stars);
    const double balanceW = measure(balance, 24.0, true);
    const double groupX = panel.x + (panel.w - (28.0 + 10.0 + balanceW)) * 0.5;
    drawStarIcon(canvas, groupX, panel.y + kPad + 50.0, 28.0);
    text(canvas, balance, groupX + 38.0, panel.y + kPad + 64.0, shopText(24.0, true, kGold, 4.0));

    const Rect closeRect{panel.right() - kPad - 24.0, panel.y + kPad - 4.0, 24.0, 24.0};
    const bool closeHover = !modalUp && closeRect.contains(mouse);
    if (closeHover) cursor = CursorShape::Hand;
    fillRounded(canvas, closeRect, 4.0, closeHover ? kPaper : kInk, closeHover ? 0.25 : 0.15);
    canvas.save();
    setStroke(canvas, kPaper);
    canvas.setLineWidth(2.5f);
    canvas.setLineJoin("round");
    canvas.setLineCap("butt");
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(closeRect.x + 6.0), static_cast<float>(closeRect.y + 6.0));
    canvas.lineTo(static_cast<float>(closeRect.right() - 6.0),
                  static_cast<float>(closeRect.bottom() - 6.0));
    canvas.moveTo(static_cast<float>(closeRect.right() - 6.0),
                  static_cast<float>(closeRect.y + 6.0));
    canvas.lineTo(static_cast<float>(closeRect.x + 6.0),
                  static_cast<float>(closeRect.bottom() - 6.0));
    canvas.stroke();
    canvas.restore();

    // --- redeem code --------------------------------------------------------
    const Rect codePlate{panel.x + kPad, panel.y + kPad + kHeaderHeight, panel.w - kPad * 2,
                         kCodeSectionHeight - 10.0};
    fillRounded(canvas, codePlate, 10.0, kCodeBlue, 0.15);
    strokeRounded(canvas, codePlate, 10.0, kCodeBlue, 2.0);

    TextStyle codeTitle = shopText(18.0, true, kPaper, 3.0);
    codeTitle.baseline = Baseline::Top;
    text(canvas, "Redeem Code", codePlate.x + 15.0, codePlate.y + 12.0, codeTitle);

    const Rect field{codePlate.x + 15.0, codePlate.y + 45.0,
                     codePlate.w - 30.0 - 10.0 - 110.0, 40.0};
    const Rect redeemButton{field.right() + 10.0, field.y, 110.0, 40.0};

    const bool fieldHover = !modalUp && field.contains(mouse);
    if (fieldHover) cursor = CursorShape::Text;
    fillRounded(canvas, field, 5.0, kPaper, 0.10);
    strokeRounded(canvas, field, 5.0,
                  state.focused ? kPaper : (fieldHover ? kCodeBlueLit : kCodeBlue), 2.0);

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(field.x + 4.0), static_cast<float>(field.y),
                static_cast<float>(field.w - 8.0), static_cast<float>(field.h));
    canvas.clip();
    {
        const double beforeCaret = measure(state.code.substr(0, state.caret), 16.0, false);
        // Scroll the text so the caret stays inside the field rather than
        // running out of its right edge.
        const double scrollX = std::max(0.0, beforeCaret - (field.w - 16.0));
        const bool placeholder = state.code.empty();
        const std::string shown =
            placeholder ? (state.focused ? std::string() : "Enter code...") : state.code;

        if (placeholder) canvas.setGlobalAlpha(0.45f);
        text(canvas, shown, field.x + 8.0 - scrollX, field.y + field.h * 0.5,
             shopText(16.0, false, kPaper, 0.0));
        if (placeholder) canvas.setGlobalAlpha(1.0f);

        if (state.focused && caretVisible(ctx.timeSeconds, state.caretAnchor)) {
            const double caretX = field.x + 8.0 - scrollX + beforeCaret;
            setStroke(canvas, kPaper);
            canvas.setLineWidth(1.5f);
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(caretX), static_cast<float>(field.y + 8.0));
            canvas.lineTo(static_cast<float>(caretX), static_cast<float>(field.bottom() - 8.0));
            canvas.stroke();
        }
    }
    canvas.restore();

    const bool redeemHover = !modalUp && redeemButton.contains(mouse);
    if (redeemHover) cursor = CursorShape::Hand;
    fillRounded(canvas, redeemButton, 5.0, redeemHover ? kCodeBlueHover : kCodeBlue);
    TextStyle redeemLabel = shopText(16.0, true, kPaper, 3.0);
    redeemLabel.align = Align::Centre;
    text(canvas, "Redeem", redeemButton.x + redeemButton.w * 0.5,
         redeemButton.y + redeemButton.h * 0.5, redeemLabel);

    // --- tabs ---------------------------------------------------------------
    const double tabY = panel.y + kPad + kHeaderHeight + kCodeSectionHeight;
    std::array<Rect, 2> tabRects{};
    for (int i = 0; i < 2; ++i) {
        const Rect rect{panel.x + kPad + i * kTabPitch, tabY, kTabWidth, 40.0};
        tabRects[static_cast<std::size_t>(i)] = rect;
        const bool active = (tab_ == Tab::Shop) == (i == 0);
        const bool hovered = !modalUp && rect.contains(mouse);
        if (hovered) cursor = CursorShape::Hand;
        fillRounded(canvas, rect, 6.0, kPaper, active ? 0.25 : (hovered ? 0.15 : 0.08));

        TextStyle label = shopText(16.0, true, kPaper, 3.0);
        label.align = Align::Centre;
        // The inactive label's FILL is white at 0.7; its outline stays opaque.
        fadedText(canvas, i == 0 ? "Shop" : "Challenges", rect.x + rect.w * 0.5,
                  rect.y + rect.h * 0.5, label, active ? 1.0 : 0.7);

        if (active) {
            setFill(canvas, kPaper);
            canvas.fillRect(static_cast<float>(rect.x), static_cast<float>(rect.bottom() - 2.0),
                            static_cast<float>(rect.w), 2.0f);
        }
    }
    canvas.save();
    setStroke(canvas, kPaper, 0.3);
    canvas.setLineWidth(2.0f);
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(panel.x + kPad), static_cast<float>(tabY + 40.0));
    canvas.lineTo(static_cast<float>(panel.right() - kPad), static_cast<float>(tabY + 40.0));
    canvas.stroke();
    canvas.restore();

    // --- content layout -----------------------------------------------------
    const double contentTop = tabY + kTabsHeight;
    const Rect view{panel.x + kPad, contentTop, panel.w - kPad * 2,
                    std::max(0.0, panel.bottom() - contentTop - kPad)};
    const std::size_t tabIndex = tab_ == Tab::Shop ? 0 : 1;

    std::vector<Card> cards;
    double contentHeight = 0;

    if (tab_ == Tab::Shop) {
        std::vector<Rarity> tiers;
        for (int tier = 0; tier < kRarityCount; ++tier) {
            const Rarity rarity = clampRarity(tier);
            if (shopSellsRarity(rarity)) tiers.push_back(rarity);
        }
        // A flow grid of (petal x tier) cards, petal-major: twelve to a row in
        // a 660-wide column, with no names anywhere. The identity of a card is
        // its artwork and its tier colour, and the confirm modal spells it out
        // before any stars are spent.
        const double pitch = kCardSize + kCardGap;
        const int cols = std::max(1, static_cast<int>(std::floor((view.w + kCardGap) / pitch)));
        int col = 0;
        int row = 0;
        // Catalogue order, not index order: the browser walks
        // Object.keys(PETAL_CONFIG), which is petals.json's own key order
        // followed by the generated eggs. Index order is alphabetical and puts
        // a different petal on every card.
        for (const std::uint16_t petalIndex : content().petalDisplayOrder()) {
            if (!shopSellsPetal(petalIndex)) continue;
            for (const Rarity rarity : tiers) {
                Card card;
                card.rect = {view.x + 6.0 + col * pitch, 6.0 + row * pitch, kCardSize, kCardSize};
                card.petalIndex = petalIndex;
                card.rarity = rarity;
                card.price = shopPrice(petalIndex, rarity);
                card.affordable = static_cast<double>(stars) >= card.price;
                cards.push_back(card);
                if (++col >= cols) { col = 0; ++row; }
            }
        }
        contentHeight = (row + (col > 0 ? 1 : 0)) * pitch + 12.0;
    } else {
        contentHeight = 32.0 + 40.0 + kChallenges.size() * 104.0 + 10.0;
    }

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = view.h;
    scroll_.offset = state.scroll[tabIndex];
    // The wheel works anywhere over the card, not just over the list, and is
    // dead while a modal is up.
    if (!modalUp && panel.contains(mouse)) scroll_.offset -= ctx.wheel() * kWheelPixels;
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());
    state.scroll[tabIndex] = scroll_.offset;
    const double scroll = scroll_.offset;

    // --- content ------------------------------------------------------------
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(view.x), static_cast<float>(view.y), static_cast<float>(view.w),
                static_cast<float>(view.h));
    canvas.clip();

    int hovered = -1;
    if (tab_ == Tab::Shop) {
        for (std::size_t i = 0; i < cards.size(); ++i) {
            const Card& card = cards[i];
            const Rect rect{card.rect.x, view.y + card.rect.y - scroll, card.rect.w, card.rect.h};
            if (rect.bottom() <= view.y || rect.y >= view.bottom()) continue;

            // An unaffordable card takes no hover treatment and no click, so
            // there is nothing to answer for when the pointer is over one.
            const bool hot = !modalUp && card.affordable && view.contains(mouse) &&
                             rect.contains(mouse);
            if (hot) {
                hovered = static_cast<int>(i);
                cursor = CursorShape::Hand;
            }

            if (hot) {
                // shadowBlur 6 at rgba(0,0,0,0.4), offset 2 down. Two expanded
                // silhouettes stand in for a blur the canvas cannot do.
                fillRounded(canvas, {rect.x - 3.0, rect.y - 1.0, rect.w + 6.0, rect.h + 6.0}, 7.0,
                            kInk, 0.10);
                fillRounded(canvas, {rect.x - 1.0, rect.y + 1.0, rect.w + 2.0, rect.h + 4.0}, 5.0,
                            kInk, 0.18);
            }

            // Only the plate and the icon fade when the price is out of reach;
            // the price bar below stays opaque, or the card stops reading as a
            // card at all.
            ItemTile tile;
            tile.petalIndex = card.petalIndex;
            tile.rarity = card.rarity;
            // The price bar is this card's caption, and it sits where the name
            // would go.
            tile.showName = false;
            tile.hovered = hot;
            tile.selected = hot;
            tile.alpha = card.affordable ? 1.0 : 0.5;
            tile.timeSeconds = ctx.timeSeconds;
            drawItemTile(canvas, ctx.sprites, rect, tile);

            setFill(canvas, kInk, 0.8);
            canvas.fillRect(static_cast<float>(rect.x),
                            static_cast<float>(rect.bottom() - kPriceBarHeight),
                            static_cast<float>(rect.w), static_cast<float>(kPriceBarHeight));

            TextStyle price = shopText(9.0, true, card.affordable ? kGold : kAlert, 2.0);
            price.align = Align::Centre;
            text(canvas, formatPrice(card.price), rect.x + rect.w * 0.5,
                 rect.bottom() - kPriceBarHeight * 0.5, price);
        }
    } else {
        double y = view.y + 10.0 - scroll;

        TextStyle heading = shopText(20.0, true, kPaper, 4.0);
        heading.align = Align::Centre;
        heading.baseline = Baseline::Top;
        text(canvas, "Earn Stars by Defeating Mythic+ Mobs", view.x + view.w * 0.5, y, heading);
        y += 32.0;

        const std::string line = withSeparators(stars) + " Stars";
        const double lineW = measure(line, 18.0, true);
        const double lineX = view.x + (view.w - (22.0 + 8.0 + lineW)) * 0.5;
        drawStarIcon(canvas, lineX, y, 22.0);
        text(canvas, line, lineX + 30.0, y + 11.0, shopText(18.0, true, kGold, 3.0));
        y += 40.0;

        for (const StarChallenge& challenge : kChallenges) {
            const Rect card{view.x + 6.0, y, view.w - 12.0, 92.0};
            y += card.h + 12.0;
            if (card.bottom() <= view.y || card.y >= view.bottom()) continue;

            fillRounded(canvas, card, 10.0, challenge.color);
            strokeRounded(canvas, card, 10.0, kInk, 2.0, 0.3);

            TextStyle name = shopText(18.0, true, kPaper, 3.0);
            name.baseline = Baseline::Top;
            text(canvas, std::string(rarityLabel(challenge.tier)) + " Challenge", card.x + 12.0,
                 card.y + 12.0, name);

            TextStyle detail = shopText(14.0, false, kPaper, 3.0);
            detail.baseline = Baseline::Top;
            fadedText(canvas, std::string("Defeat any ") + rarityLabel(challenge.tier) + " tier mob",
                      card.x + 12.0, card.y + 36.0, detail, 0.95);

            drawStarIcon(canvas, card.x + 12.0, card.y + 60.0, 18.0);
            const std::string reward =
                std::to_string(challenge.stars) + (challenge.stars == 1 ? " Star" : " Stars");
            text(canvas, reward, card.x + 38.0, card.y + 69.0, shopText(16.0, true, kGold, 3.0));
        }
    }
    canvas.restore();

    // --- scrollbar ----------------------------------------------------------
    if (contentHeight > view.h && view.h > 0) {
        // Outside the content column, 8px in from the card's right edge.
        const Rect track{view.right() + 6.0, view.y, kScrollbarWidth, view.h};
        const double thumbHeight = std::max(20.0, (view.h / contentHeight) * view.h);
        const double thumbY =
            view.y + (scroll / (contentHeight - view.h)) * (view.h - thumbHeight);
        fillRounded(canvas, track, 3.0, kInk, 0.15);
        fillRounded(canvas, {track.x, thumbY, track.w, thumbHeight}, 3.0, kPaper, 0.55);
    }

    // --- modal --------------------------------------------------------------
    std::array<ModalButton, 2> buttons{};
    int buttonCount = 0;
    if (modalUp) {
        fillRounded(canvas, panel, 3.0, kInk, 0.55);

        const double boxW = std::min(440.0, panel.w - 60.0);
        const Rect box{panel.x + (panel.w - boxW) * 0.5, panel.y + (panel.h - 170.0) * 0.5, boxW,
                       170.0};
        fillRounded(canvas, box, 10.0, kModalBox);
        strokeRounded(canvas, box, 10.0, kPaper, 2.0);

        TextStyle body = shopText(16.0, false, state.messageColor, 3.0);
        body.align = Align::Centre;
        body.baseline = Baseline::Top;
        double lineY = box.y + 30.0;
        for (const std::string& piece : wrapMessage(state.message, 16.0, boxW - 30.0)) {
            text(canvas, piece, box.x + boxW * 0.5, lineY, body);
            lineY += 22.0;
        }

        if (state.modal == ShopState::Modal::Confirm) {
            buttons[0] = {Rect{}, "Cancel", kModalCancel, false};
            buttons[1] = {Rect{}, "Buy", kCodeBlue, true};
            buttonCount = 2;
        } else {
            buttons[0] = {Rect{}, "OK", kCodeBlue, false};
            buttonCount = 1;
        }

        const double row = buttonCount * 100.0 + (buttonCount - 1) * 12.0;
        double bx = box.x + (boxW - row) * 0.5;
        for (int i = 0; i < buttonCount; ++i) {
            ModalButton& button = buttons[static_cast<std::size_t>(i)];
            button.rect = {bx, box.bottom() - 36.0 - 18.0, 100.0, 36.0};
            bx += 112.0;
            const bool hovered = button.rect.contains(mouse);
            if (hovered) cursor = CursorShape::Hand;
            fillRounded(canvas, button.rect, 6.0,
                        hovered ? lighten(button.fill, 0.15) : button.fill);
            TextStyle label = shopText(15.0, true, kPaper, 3.0);
            label.align = Align::Centre;
            text(canvas, button.label, button.rect.x + button.rect.w * 0.5,
                 button.rect.y + button.rect.h * 0.5, label);
        }
    }

    // The whole card has now been laid out, so this is the last word on what
    // the pointer is over. A modal's scrim swallows every region under it, and
    // `cursor` was only ever set by a region the scrim does not cover.
    ctx.window.setCursorShape(cursor);

    // --- actions ------------------------------------------------------------
    const auto clearModal = [&state] {
        state.modal = ShopState::Modal::None;
        state.message.clear();
        state.pendingPetal = kNoPetal;
    };
    const auto resolveModal = [&](bool confirmed) {
        if (confirmed && state.modal == ShopState::Modal::Confirm &&
            state.pendingPetal != kNoPetal) {
            ctx.net.requestBuyPetal(state.pendingPetal, state.pendingRarity);
        }
        clearModal();
    };
    const auto submitCode = [&] {
        const std::string code = trimmed(state.code);
        if (code.empty()) {
            state.modal = ShopState::Modal::Alert;
            state.message = "Please enter a code";
            state.messageColor = kAlert;
            return;
        }
        ctx.net.requestRedeemCode(code);
        // Cleared on SEND, not on the answer -- the reference empties the field
        // the moment it emits, and the reply only decides between the shower
        // and the red alert.
        state.code.clear();
        state.caret = 0;
        state.caretAnchor = ctx.timeSeconds;
    };

    // --- keyboard -----------------------------------------------------------
    if (modalUp) {
        if (ctx.window.keyPressed(Key::Enter)) {
            resolveModal(state.modal == ShopState::Modal::Confirm);
        } else if (ctx.window.keyPressed(Key::Escape)) {
            clearModal();
        }
    } else if (state.focused) {
        for (const char c : ctx.window.typedText()) {
            // Printable ASCII only: codes are, and it keeps the caret's byte
            // index and its character index the same thing.
            const auto byte = static_cast<unsigned char>(c);
            if (byte < 0x20 || byte > 0x7E) continue;
            if (state.code.size() >= kCodeMaxLength) break;
            state.code.insert(state.caret, 1, c);
            ++state.caret;
            state.caretAnchor = ctx.timeSeconds;
        }
        if (ctx.window.keyPressed(Key::Backspace) && state.caret > 0) {
            state.code.erase(state.caret - 1, 1);
            --state.caret;
            state.caretAnchor = ctx.timeSeconds;
        }
        if (ctx.window.keyPressed(Key::Left) && state.caret > 0) {
            --state.caret;
            state.caretAnchor = ctx.timeSeconds;
        }
        if (ctx.window.keyPressed(Key::Right) && state.caret < state.code.size()) {
            ++state.caret;
            state.caretAnchor = ctx.timeSeconds;
        }
        if (ctx.window.keyPressed(Key::Enter)) submitCode();
        // Escape leaves the field rather than the panel; a second press then
        // closes the shop, which is the browser's behaviour exactly.
        if (ctx.window.keyPressed(Key::Escape)) state.focused = false;
    }

    // --- mouse --------------------------------------------------------------
    // On the press edge, as the reference's mousedown handler is: a tab or a
    // card responds the instant the button goes down.
    if (!ctx.pressed()) return true;

    if (modalUp) {
        for (int i = 0; i < buttonCount; ++i) {
            const ModalButton& button = buttons[static_cast<std::size_t>(i)];
            if (button.rect.contains(mouse)) resolveModal(button.confirms);
        }
        // The scrim swallows everything else, including the close button.
        return true;
    }

    if (!field.contains(mouse)) state.focused = false;
    if (closeRect.contains(mouse)) return false;

    for (int i = 0; i < 2; ++i) {
        if (!tabRects[static_cast<std::size_t>(i)].contains(mouse)) continue;
        tab_ = i == 0 ? Tab::Shop : Tab::Challenges;
        return true;
    }

    if (field.contains(mouse)) {
        if (!state.focused) {
            state.focused = true;
            state.caretAnchor = ctx.timeSeconds;
        }
        // Placed at the end rather than under the pointer: per-glyph hit
        // testing buys nothing on a field this short.
        state.caret = state.code.size();
        return true;
    }

    if (redeemButton.contains(mouse)) {
        submitCode();
        return true;
    }

    if (tab_ == Tab::Shop && hovered >= 0) {
        const Card& card = cards[static_cast<std::size_t>(hovered)];
        const PetalConfig& config = content().petal(card.petalIndex);
        const std::string name = config.name.empty() ? config.id : config.name;
        // Some of these prices are a whole session's stars; a stray click must
        // not spend one, so the purchase goes through a confirmation.
        state.modal = ShopState::Modal::Confirm;
        state.message = "Buy " + name + " (" + rarityName(card.rarity) + ") for " +
                        withSeparators(card.price) + " stars?";
        state.messageColor = kPaper;
        state.pendingPetal = card.petalIndex;
        state.pendingRarity = card.rarity;
    }
    return true;
}

} // namespace flr
