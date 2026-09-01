#include "client/ui/tutorial.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>

#include "client/net_client.h"
#include "client/ui/draw.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/theme.h"

namespace flr::ui {

namespace {

// --- the reference's copy ----------------------------------------------------
//
// Verbatim from src/tutorial.ts, markup included. `<strong>` is parsed and
// then dropped: the page already inherits `font-weight: 700` from its body
// rule, and `bolder` on top of 700 resolves to 900, which the four Ubuntu
// weights the page loads answer with 700 again. Emphasis is therefore the one
// tag in this copy that changes anything on screen.
constexpr TutorialStep kSteps[Tutorial::kStepCount] = {
    {"Welcome to flowrix.pro!",
     "Let's learn the basics! You'll learn how to move, use petals, equip items, and craft "
     "upgrades.",
     true, TutorialGesture::None},
    {"Movement",
     "Use <strong>W/A/S/D</strong> or <strong>Arrow Keys</strong> to move your flower around the "
     "world. Try moving now!",
     true, TutorialGesture::Movement},
    {"Extending Petals",
     "Hold <strong>SPACE</strong> to extend your petals outward for maximum reach and damage. Try "
     "it now!<br><br>Your petals protect you and damage enemies that touch them.",
     true, TutorialGesture::ExtendPetals},
    {"Loadout Bar",
     "This is your <strong>Loadout Bar</strong> at the bottom of the screen. Here you can equip "
     "petals and items to use in battle.<br><br>Each slot can be accessed using keys "
     "<strong>1-9 and 0</strong>.",
     false, TutorialGesture::None},
    {"Inventory",
     "Press <strong>Z</strong> to open your inventory. This is where all your collected petals and "
     "items are stored.<br><br>You can <strong>drag and drop</strong> items from your inventory to "
     "your loadout bar to equip them.",
     true, TutorialGesture::OpenInventory},
    {"Equipping Petals",
     "Try dragging a petal from your inventory to any slot in the loadout bar!<br><br><em>Tip: "
     "Different petals have different abilities. Experiment to find your favorite "
     "combination!</em>",
     true, TutorialGesture::EquipPetal},
    {"Crafting",
     "Press <strong>C</strong> to open the crafting menu. Crafting allows you to combine 5 items "
     "of the same type and rarity to create 1 item of higher rarity!",
     true, TutorialGesture::OpenCrafting},
    {"How to Craft",
     "To craft:<br>1. Click on an item in your inventory (that you have at least 5 of) to add 5 to "
     "the crafting circle<br>2. Click the <strong>Craft</strong> button<br>3. If successful, "
     "you'll get a higher rarity item!<br><br><em>Note: Success chance decreases with higher "
     "rarities. You can close this menu with C.</em>",
     false, TutorialGesture::None},
    {"Combat Tips",
     "Your petals automatically damage enemies that touch them. More petals = more "
     "protection!<br><br>\xE2\x80\xA2 <strong>Health</strong>: Each petal has health and will break "
     "when damaged<br>\xE2\x80\xA2 <strong>Damage</strong>: Higher rarity petals deal more "
     "damage<br>\xE2\x80\xA2 <strong>Strategy</strong>: Mix defensive and offensive petals for best "
     "results",
     false, TutorialGesture::None},
    {"Additional Controls",
     "<strong>K</strong> - Toggle mouse/keyboard controls<br><strong>H</strong> - Toggle "
     "hitboxes<br><strong>+/-</strong> - Zoom in/out<br><strong>Enter</strong> - Open "
     "chat<br><strong>ESC</strong> - Exit to menu<br><br>You can customize controls in the Settings "
     "menu!",
     false, TutorialGesture::None},
    {"Tutorial Complete!",
     "You're ready to explore! Defeat enemies, collect petals, craft upgrades, and become the "
     "strongest flower in the garden!<br><br>Good luck!",
     false, TutorialGesture::None},
};

/// The one step whose `highlightElement` can ever be seen -- see the note on
/// `Tutorial::draw`.
constexpr int kCraftingHighlightStep = 7;

// --- the stylesheet, in numbers ---------------------------------------------
//
// #tutorialBox and .tutorial-* from src/tutorial.ts, under the page's own
// `* { margin: 0; padding: 0; box-sizing: border-box }` reset. Border-box is
// why the 500px cap is the card's whole width and not its content column's.

constexpr double kCardTop = 60.0;
constexpr double kCardMaxWidth = 500.0;
constexpr double kPadX = 25.0;
constexpr double kPadY = 20.0;
constexpr double kCardRadius = 12.0;

constexpr double kHeadSize = 24.0;
constexpr double kTitleGap = 15.0;      ///< the h2's margin-bottom
constexpr double kCopySize = 16.0;
constexpr double kBodyLeading = 1.6;    ///< the p's line-height
constexpr double kBodyGap = 20.0;       ///< the p's margin-bottom

constexpr double kLabelSize = 14.0;
constexpr double kButtonPadX = 20.0;
constexpr double kButtonPadY = 10.0;
constexpr double kButtonMargin = 5.0;
constexpr double kButtonGap = 10.0;     ///< the buttons row's `gap`
constexpr double kPillRadius = 8.0;

constexpr double kCounterSize = 14.0;

constexpr double kDotSize = 8.0;
constexpr double kDotGap = 5.0;
constexpr double kDotsGap = 15.0;       ///< .tutorial-progress's margin-top
constexpr double kActiveDotScale = 1.3;

constexpr double kIntroSeconds = 0.3;   ///< the box's `slideIn`
constexpr double kHoverSeconds = 0.2;   ///< the buttons' `transition`
/// The browser's own `setTimeout(..., 1000)` after the socket authenticates.
constexpr double kStartDelay = 1.0;
/// How long a first click on Skip stands in for the confirm() dialog.
constexpr double kSkipArmSeconds = 4.0;

constexpr std::uint32_t kCardFill = 0x282828u;      ///< rgba(40, 40, 40, 0.85)
constexpr double kCardAlpha = 0.85;
constexpr double kCardShadowAlpha = 0.30;           ///< 0 4px 20px rgba(0,0,0,0.3)
constexpr double kShadowSigma = 10.0;               ///< a CSS blur radius of 20
constexpr double kCardShadowDrop = 4.0;

constexpr double kSkipFillAlpha = 0.2;
constexpr double kSkipHoverAlpha = 0.3;
constexpr double kSkipLabelAlpha = 0.9;
constexpr double kNextFillAlpha = 0.9;
constexpr double kNextHoverAlpha = 1.0;
constexpr std::uint32_t kNextLabel = 0x333333u;
constexpr double kCounterAlpha = 0.7;
constexpr double kDotIdleAlpha = 0.3;
constexpr double kButtonHoverScale = 1.05;
constexpr double kButtonHoverShadow = 0.2;          ///< 0 5px 15px rgba(0,0,0,0.2)

/// The yellow ring `.tutorial-highlight` puts round an anchored element.
/// Static, not the pulse the same rule also asks for: the pulse animates
/// box-shadow and the rule's own box-shadow is `!important`, which outranks an
/// animation in the cascade.
constexpr std::uint32_t kHighlight = 0xFFFF00u;     ///< 0 0 20px rgba(255,255,0,0.8)
constexpr double kHighlightAlpha = 0.8;
constexpr double kHighlightRadius = 3.0;            ///< .crafting-panel's own

/// Blink's synthetic-oblique slant. The reference has the real Ubuntu Italic
/// to hand; this client stages the regular and bold faces only, so an <em> run
/// is sheared rather than substituted, and its glyphs are a shade wider.
constexpr double kItalicShear = 0.2;

// --- CSS line boxes ---------------------------------------------------------
//
// Ubuntu's hhea metrics, per em. A line box is built out of these; the em-box
// split that text.h's ascent()/descent() report is a different division of the
// same face (OS/2's sTypo pair) and lands every baseline here 1-3px out.
constexpr double kHheaAscent = 0.932;
constexpr double kHheaDescent = 0.189;
constexpr double kHheaLineGap = 0.028;

double normalLineHeight(double size) {
    return (kHheaAscent + kHheaDescent + kHheaLineGap) * size;
}

/// The baseline's offset from the top of a line box of the given height. The
/// leftover space is split above and below the text, which is what CSS calls
/// half-leading.
double baselineIn(double size, double lineHeight) {
    return (lineHeight - (kHheaAscent + kHheaDescent) * size) * 0.5 + kHheaAscent * size;
}

/// y for a `cubic-bezier(x1, y1, x2, y2)` at time x. Newton against the
/// curve's own x, which converges in a handful of steps for the two shapes
/// this file uses and needs no table.
double cubicBezier(double x1, double y1, double x2, double y2, double x) {
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    const auto axis = [](double p1, double p2, double t) {
        const double u = 1.0 - t;
        return 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t;
    };
    const auto slope = [](double p1, double p2, double t) {
        const double u = 1.0 - t;
        return 3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2);
    };
    double t = x;
    for (int i = 0; i < 8; ++i) {
        const double error = axis(x1, x2, t) - x;
        const double d = slope(x1, x2, t);
        if (std::fabs(error) < 1e-6 || std::fabs(d) < 1e-6) break;
        t = clamp(t - error / d, 0.0, 1.0);
    }
    return axis(y1, y2, t);
}

double easeOut(double t) { return cubicBezier(0.0, 0.0, 0.58, 1.0, t); }
double ease(double t) { return cubicBezier(0.25, 0.1, 0.25, 1.0, t); }

// --- description parsing -----------------------------------------------------

/// One word of a description, or a forced break.
struct Word {
    std::string text;
    bool italic = false;
    bool lineBreak = false;
};

/// Splits a description into words and `<br>` breaks. Runs of whitespace
/// collapse to nothing, since the layout puts a single space between words
/// itself -- which is what CSS `white-space: normal` amounts to here.
std::vector<Word> parseDescription(const std::string& html) {
    std::vector<Word> words;
    bool italic = false;
    std::string current;
    const auto flush = [&] {
        if (current.empty()) return;
        Word word;
        word.text = current;
        word.italic = italic;
        words.push_back(word);
        current.clear();
    };

    for (std::size_t i = 0; i < html.size();) {
        const char c = html[i];
        if (c == '<') {
            const std::size_t close = html.find('>', i);
            if (close == std::string::npos) break;
            std::string tag = html.substr(i + 1, close - i - 1);
            for (char& t : tag) t = static_cast<char>(std::tolower(static_cast<unsigned char>(t)));
            // A word may straddle a tag ("<strong>1-9 and 0</strong>."), so the
            // pending text is only flushed where the STYLE changes.
            if (tag == "em") { flush(); italic = true; }
            else if (tag == "/em") { flush(); italic = false; }
            else if (tag == "br" || tag == "br/" || tag == "br /") {
                flush();
                Word brk;
                brk.lineBreak = true;
                words.push_back(brk);
            }
            i = close + 1;
            continue;
        }
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            flush();
            ++i;
            continue;
        }
        current += c;
        ++i;
    }
    flush();
    return words;
}

/// The card's fill and its drop shadow.
///
/// The shadow is painted as disjoint rings at the alpha a Gaussian of sigma 10
/// leaves at that distance, which is the same trick the talents card uses: the
/// rings do not overlap, so each one's alpha is the final answer and only the
/// fringe is ever rasterised.
void cardPlate(Canvas& canvas, Rect card) {
    constexpr double kBand = 2.0;
    constexpr int kOuterBands = 12;
    /// Bands inside the shadow's own edge, so the strip the 4px drop exposes
    /// below the card is not painted as though it were outside it.
    constexpr int kInnerBands = 3;
    const double falloff = kShadowSigma * std::sqrt(2.0);

    canvas.save();
    canvas.setLineCap("butt");
    canvas.setLineJoin("round");
    canvas.setLineWidth(static_cast<float>(kBand));
    for (int i = -kInnerBands; i < kOuterBands; ++i) {
        const double d = (i + 0.5) * kBand;
        setStroke(canvas, kInk, kCardShadowAlpha * 0.5 * std::erfc(d / falloff));
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(card.x - d),
                         static_cast<float>(card.y + kCardShadowDrop - d),
                         static_cast<float>(card.w + d * 2.0),
                         static_cast<float>(card.h + d * 2.0),
                         static_cast<float>(kCardRadius + d));
        canvas.stroke();
    }
    canvas.restore();

    canvas.beginPath();
    canvas.roundRect(static_cast<float>(card.x), static_cast<float>(card.y),
                     static_cast<float>(card.w), static_cast<float>(card.h),
                     static_cast<float>(kCardRadius));
    setFill(canvas, kCardFill, kCardAlpha);
    canvas.fill();
}

/// A rounded rectangle in a flat colour: every button and dot on this card.
void fillRounded(Canvas& canvas, Rect r, double radius, std::uint32_t rgb, double alpha) {
    if (r.w <= 0 || r.h <= 0 || alpha <= 0) return;
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h),
                     static_cast<float>(std::min(radius, std::min(r.w, r.h) * 0.5)));
    setFill(canvas, rgb, alpha);
    canvas.fill();
}

/// Plain, unstroked text: this card is a DOM box, and nothing in it is drawn
/// with the game's stroked-then-filled lettering.
TextStyle cardText(double size, std::uint32_t fill, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.strokeWidth = 0;
    style.bold = true;      // the page's body rule is `font-weight: 700`
    style.align = align;
    style.baseline = Baseline::Alphabetic;
    return style;
}

} // namespace

const TutorialStep* Tutorial::steps() { return kSteps; }

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void Tutorial::beginGame(const ClientSettings& settings, double nowSeconds, bool force) {
    visible_ = false;
    pending_ = false;
    if (settings.tutorialCompleted && !force) return;

    visible_ = force;
    pending_ = !force;
    pendingUntil_ = nowSeconds + kStartDelay;
    // Always zero, never the saved step. The browser writes `tutorial_step` on
    // every Next and reads it back in its constructor -- and then start()
    // assigns 0 over the top of it before anything can use it. So the file's
    // only live rule is the completion flag, and there is no resume to port.
    step_ = 0;
    stepShownAt_ = nowSeconds;
    advanceAt_ = -1;
    skipArmed_ = false;
    skipHover_ = 0;
    nextHover_ = 0;
    lastNow_ = nowSeconds;
    lastLoadout_.clear();
    movementDetected_ = false;
    petalsExtended_ = false;
    inventoryOpened_ = false;
    itemEquipped_ = false;
    craftingOpened_ = false;
    // A forced card is up for a screenshot, so it is up whole: the intro is
    // dated far enough back that it has already finished on the first frame.
    shownAt_ = force ? nowSeconds - kIntroSeconds : nowSeconds;
}

void Tutorial::endGame() {
    visible_ = false;
    pending_ = false;
    skipArmed_ = false;
}

void Tutorial::showStep(int index, double nowSeconds) {
    step_ = index;
    stepShownAt_ = nowSeconds;
    advanceAt_ = -1;
    // Every step is drawn from scratch, so a Skip armed on the last one is not
    // still armed on this one.
    skipArmed_ = false;
}

void Tutorial::advance(ClientSettings& settings, double nowSeconds) {
    ++step_;
    // Saved on every Next, exactly as saveProgress() is, and read by nothing --
    // see the note in beginGame about why the reference's own resume is dead.
    settings.tutorialStep = step_;
    if (step_ >= kStepCount) {
        finish(settings);
        return;
    }
    showStep(step_, nowSeconds);
}

void Tutorial::finish(ClientSettings& settings) {
    visible_ = false;
    pending_ = false;
    skipArmed_ = false;
    settings.tutorialCompleted = true;
}

bool Tutorial::conditionMet() const {
    switch (kSteps[step_].gesture) {
        case TutorialGesture::Movement:      return movementDetected_;
        case TutorialGesture::ExtendPetals:  return petalsExtended_;
        case TutorialGesture::OpenInventory: return inventoryOpened_;
        case TutorialGesture::EquipPetal:    return itemEquipped_;
        case TutorialGesture::OpenCrafting:  return craftingOpened_;
        case TutorialGesture::None:          break;
    }
    return false;
}

bool Tutorial::capturesMouse(Vec2 mouse) const {
    return visible_ && transformed(cached_, cached_.card).contains(mouse);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

Rect Tutorial::transformed(const Layout& l, Rect r) {
    const double cx = l.card.x + l.card.w * 0.5;
    const double cy = l.card.y + l.card.h * 0.5;
    return Rect{cx + l.offset.x + (r.x - cx) * l.scale,
                cy + l.offset.y + (r.y - cy) * l.scale, r.w * l.scale, r.h * l.scale};
}

Tutorial::Layout Tutorial::layout(int viewWidth, double nowSeconds) const {
    Layout out;
    const TutorialStep& step = kSteps[step_];
    const bool showSkip = step.skipButton;
    const bool showNext = step.gesture == TutorialGesture::None;

    const std::vector<Word> words = parseDescription(step.description);
    const double space = measure(" ", kCopySize, true);

    // Two passes over the same words: the first with no wrap width at all,
    // because the card is shrink-to-fit and its max-content width is what the
    // 500px cap is applied to. Four of the eleven steps really are narrower
    // than the cap -- "Additional Controls" is a column of short rows.
    const auto wrap = [&](double limit) {
        std::vector<Line> lines;
        lines.emplace_back();
        double x = 0;
        for (const Word& word : words) {
            if (word.lineBreak) {
                // Two <br>s in a row leave an empty line box between them, so
                // an empty line is started rather than skipped.
                lines.emplace_back();
                x = 0;
                continue;
            }
            const double width = measure(word.text, kCopySize, true);
            // A hair of slack, so a segment that measured exactly as wide as
            // the column it set does not then wrap out of it.
            if (!lines.back().pieces.empty() && x + space + width > limit + 0.001) {
                lines.emplace_back();
                x = 0;
            }
            const bool leading = !lines.back().pieces.empty();
            const std::string text = (leading ? " " : "") + word.text;
            if (leading && lines.back().pieces.back().italic == word.italic) {
                lines.back().pieces.back().text += text;
            } else {
                Piece piece;
                piece.text = text;
                piece.italic = word.italic;
                piece.x = x;
                lines.back().pieces.push_back(piece);
            }
            x += leading ? space + width : width;
        }
        return lines;
    };

    const auto widest = [&](const std::vector<Line>& lines) {
        double best = 0;
        for (const Line& line : lines) {
            double width = 0;
            for (const Piece& piece : line.pieces) width += measure(piece.text, kCopySize, true);
            best = std::max(best, width);
        }
        return best;
    };

    const double titleWidth = measure(step.title, kHeadSize, true);
    const double skipWidth = measure("Skip Tutorial", kLabelSize, true) + kButtonPadX * 2.0;
    const double armedWidth = measure("Are you sure?", kLabelSize, true) + kButtonPadX * 2.0;
    const double nextWidth = measure("Next", kLabelSize, true) + kButtonPadX * 2.0;
    const double counterWidth =
        measure(std::to_string(step_ + 1) + " / " + std::to_string(kStepCount), kCounterSize, true);

    double buttonsWidth = 0;
    if (showSkip) buttonsWidth += (skipArmed_ ? armedWidth : skipWidth) + kButtonMargin * 2.0;
    if (showNext) buttonsWidth += nextWidth + kButtonMargin * 2.0;
    if (showSkip && showNext) buttonsWidth += kButtonGap;

    const double maxContent =
        std::max({titleWidth, widest(wrap(1e9)), buttonsWidth + counterWidth});
    const double cardW = std::min(kCardMaxWidth, maxContent + kPadX * 2.0);
    out.contentW = cardW - kPadX * 2.0;
    out.lines = wrap(out.contentW);

    out.card = Rect{viewWidth * 0.5 - cardW * 0.5, kCardTop, cardW, 0};
    out.contentX = out.card.x + kPadX;

    double y = kCardTop + kPadY;
    const double titleBox = normalLineHeight(kHeadSize);
    out.titleBaseline = y + baselineIn(kHeadSize, titleBox);
    y += titleBox + kTitleGap;

    const double bodyLine = kCopySize * kBodyLeading;
    out.firstBaseline = y + baselineIn(kCopySize, bodyLine);
    y += bodyLine * static_cast<double>(out.lines.size()) + kBodyGap;

    const double buttonH = normalLineHeight(kLabelSize) + kButtonPadY * 2.0;
    const double rowH = buttonsWidth > 0 ? buttonH + kButtonMargin * 2.0
                                         : normalLineHeight(kCounterSize);
    double bx = out.contentX + kButtonMargin;
    const double by = y + kButtonMargin;
    if (showSkip) {
        out.skip = Rect{bx, by, skipArmed_ ? armedWidth : skipWidth, buttonH};
        bx += out.skip.w + kButtonMargin * 2.0 + kButtonGap;
    }
    if (showNext) out.next = Rect{bx, by, nextWidth, buttonH};
    // The counter is the flex row's second child, centred against a row the
    // buttons' own margins made taller than it is.
    out.counterBaseline = y + (rowH - normalLineHeight(kCounterSize)) * 0.5 +
                          baselineIn(kCounterSize, normalLineHeight(kCounterSize));
    y += rowH + kDotsGap;

    out.dotsTop = y;
    y += kDotSize;
    out.card.h = y + kPadY - kCardTop;

    // The 0.3s intro. `slideIn` animates `transform`, and an animation outranks
    // the inline `translateX(-50%)` that centres the box -- so for as long as
    // it runs the card really does hang off the middle of the screen by its
    // LEFT edge, and snaps into place when it ends. Reproduced rather than
    // corrected: this is what the reference does for 300ms on every start.
    const double t = clamp((nowSeconds - shownAt_) / kIntroSeconds, 0.0, 1.0);
    if (t < 1.0) {
        const double e = easeOut(t);
        out.card.x = viewWidth * 0.5;
        out.contentX = out.card.x + kPadX;
        const double shift = out.card.x - (viewWidth * 0.5 - cardW * 0.5);
        out.skip.x += shift;
        out.next.x += shift;
        out.scale = 0.9 + 0.1 * e;
        out.offset = Vec2{0.0, -20.0 * (1.0 - e)};
        out.alpha = e;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

void Tutorial::update(Window& window, ClientSettings& settings, const Profile& profile,
                      double nowSeconds) {
    const double dt = lastNow_ < 0 ? 0.0 : clamp(nowSeconds - lastNow_, 0.0, 0.1);
    lastNow_ = nowSeconds;

    if (!pending_ && !visible_) return;

    // Watched from the moment the tutorial is armed, exactly as the browser's
    // document listener is: a key pressed during an earlier step still
    // satisfies a later one, and the keys are the literal W/A/S/D/Z/C rather
    // than whatever the player has rebound the menus to.
    if (window.keyPressed(Key::W) || window.keyPressed(Key::A) || window.keyPressed(Key::S) ||
        window.keyPressed(Key::D) || window.keyPressed(Key::Up) || window.keyPressed(Key::Down) ||
        window.keyPressed(Key::Left) || window.keyPressed(Key::Right)) {
        movementDetected_ = true;
    }
    if (window.keyPressed(Key::Space)) petalsExtended_ = true;
    if (window.keyPressed(Key::Z)) inventoryOpened_ = true;
    if (window.keyPressed(Key::C)) craftingOpened_ = true;

    // There is no event bus here to carry the browser's `loadout:equip`, and a
    // slot that has gained a petal is what that event announces. Emptying a
    // slot deliberately does not count: dragging a petal to the trash is not
    // equipping one.
    std::vector<std::uint32_t> loadout;
    loadout.reserve(profile.loadout.size());
    for (const Profile::Slot& slot : profile.loadout) {
        loadout.push_back(slot.empty() ? 0xFFFFFFFFu
                                       : (static_cast<std::uint32_t>(slot.petalIndex) << 8) |
                                             static_cast<std::uint32_t>(slot.rarity));
    }
    if (!loadout.empty()) {
        if (loadout.size() == lastLoadout_.size()) {
            for (std::size_t i = 0; i < loadout.size(); ++i) {
                if (loadout[i] != lastLoadout_[i] && loadout[i] != 0xFFFFFFFFu) {
                    itemEquipped_ = true;
                }
            }
        }
        lastLoadout_ = loadout;
    }

    if (pending_) {
        if (nowSeconds < pendingUntil_) return;
        pending_ = false;
        visible_ = true;
        shownAt_ = nowSeconds;
        showStep(0, nowSeconds);
    }

    Layout current = layout(window.width(), nowSeconds);
    const Vec2 mouse{window.mouseX(), window.mouseY()};
    const Rect skip = transformed(current, current.skip);
    const Rect next = transformed(current, current.next);
    const bool overSkip = current.skip.w > 0 && skip.contains(mouse);
    const bool overNext = current.next.w > 0 && next.contains(mouse);
    if (overSkip || overNext) window.setCursorShape(CursorShape::Hand);

    const double hoverStep = dt / kHoverSeconds;
    skipHover_ = clamp(skipHover_ + (overSkip ? hoverStep : -hoverStep), 0.0, 1.0);
    nextHover_ = clamp(nextHover_ + (overNext ? hoverStep : -hoverStep), 0.0, 1.0);

    if (skipArmed_ && nowSeconds >= skipArmedUntil_) skipArmed_ = false;

    if (window.mouseReleased(MouseButton::Left)) {
        if (overSkip) {
            // The browser puts a confirm() up here. There is no dialog to put
            // anywhere in this client, so the button asks for itself: it
            // relabels, and only a second click inside the arming window
            // actually ends the tutorial. Same guarantee, no DOM.
            if (skipArmed_) {
                finish(settings);
                return;
            }
            skipArmed_ = true;
            skipArmedUntil_ = nowSeconds + kSkipArmSeconds;
        } else if (overNext) {
            advance(settings, nowSeconds);
            if (!visible_) return;
        } else {
            skipArmed_ = false;
        }
    }

    // The gestures are polled on a 100ms interval started when the step went
    // up, and the card waits another half second after the poll that sees one.
    if (kSteps[step_].gesture != TutorialGesture::None) {
        if (advanceAt_ < 0 && conditionMet()) {
            const double since = std::max(0.0, nowSeconds - stepShownAt_);
            advanceAt_ = stepShownAt_ + 0.1 * std::ceil(since / 0.1) + 0.5;
        }
        if (advanceAt_ >= 0 && nowSeconds >= advanceAt_) {
            advance(settings, nowSeconds);
            if (!visible_) return;
        }
    }

    cached_ = layout(window.width(), nowSeconds);
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

void Tutorial::draw(Canvas& canvas, double nowSeconds, Rect highlightCard) {
    (void)nowSeconds;
    if (!visible_) return;
    const Layout& l = cached_;

    // Only one of the three anchored steps can ever show anything. `#loadoutBar`
    // is removed from the document by the inventory manager the moment the game
    // starts (src/inventory.ts:226), so the two steps that name it find nothing
    // to highlight AND fall through positionTutorialBox's element branch to the
    // same top-60 centre as every other step. `#craftingPanel` does exist, so
    // step 8 rings it -- and only while it is open, a hidden element having
    // nothing to draw a shadow around.
    if (step_ == kCraftingHighlightStep && highlightCard.w > 0 && highlightCard.h > 0) {
        constexpr double kBand = 2.0;
        constexpr int kBands = 12;
        const double falloff = kShadowSigma * std::sqrt(2.0);
        canvas.save();
        canvas.setLineCap("butt");
        canvas.setLineJoin("round");
        canvas.setLineWidth(static_cast<float>(kBand));
        for (int i = 0; i < kBands; ++i) {
            const double d = (i + 0.5) * kBand;
            setStroke(canvas, kHighlight, kHighlightAlpha * 0.5 * std::erfc(d / falloff));
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(highlightCard.x - d),
                             static_cast<float>(highlightCard.y - d),
                             static_cast<float>(highlightCard.w + d * 2.0),
                             static_cast<float>(highlightCard.h + d * 2.0),
                             static_cast<float>(kHighlightRadius + d));
            canvas.stroke();
        }
        canvas.restore();
    }

    const TutorialStep& step = kSteps[step_];

    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(l.alpha));
    if (l.scale != 1.0 || l.offset.x != 0.0 || l.offset.y != 0.0) {
        const double cx = l.card.x + l.card.w * 0.5;
        const double cy = l.card.y + l.card.h * 0.5;
        canvas.translate(static_cast<float>(cx + l.offset.x), static_cast<float>(cy + l.offset.y));
        canvas.scale(static_cast<float>(l.scale), static_cast<float>(l.scale));
        canvas.translate(static_cast<float>(-cx), static_cast<float>(-cy));
    }

    cardPlate(canvas, l.card);
    text(canvas, step.title, l.contentX, l.titleBaseline, cardText(kHeadSize, kPaper));

    double baseline = l.firstBaseline;
    for (const Line& line : l.lines) {
        for (const Piece& piece : line.pieces) {
            const double x = l.contentX + piece.x;
            if (piece.italic) {
                canvas.save();
                // x' = x - shear * (y - baseline): the glyphs lean right above
                // the baseline and stay put on it.
                canvas.transform(1.0f, 0.0f, static_cast<float>(-kItalicShear), 1.0f,
                                 static_cast<float>(kItalicShear * baseline), 0.0f);
                text(canvas, piece.text, x, baseline, cardText(kCopySize, kPaper));
                canvas.restore();
            } else {
                text(canvas, piece.text, x, baseline, cardText(kCopySize, kPaper));
            }
        }
        baseline += kCopySize * kBodyLeading;
    }

    const auto paintButton = [&](Rect box, const std::string& label, double hover, double fill,
                                 double hoverFill, std::uint32_t labelColour, double labelAlpha) {
        if (box.w <= 0) return;
        const double e = ease(hover);
        const double scale = 1.0 + (kButtonHoverScale - 1.0) * e;
        canvas.save();
        const double cx = box.x + box.w * 0.5;
        const double cy = box.y + box.h * 0.5;
        canvas.translate(static_cast<float>(cx), static_cast<float>(cy));
        canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
        canvas.translate(static_cast<float>(-cx), static_cast<float>(-cy));
        if (e > 0.0) {
            // The hover state's own `0 5px 15px rgba(0,0,0,0.2)`.
            constexpr double kBand = 2.0;
            const double falloff = 7.5 * std::sqrt(2.0);
            canvas.setLineCap("butt");
            canvas.setLineJoin("round");
            canvas.setLineWidth(static_cast<float>(kBand));
            for (int i = 0; i < 8; ++i) {
                const double d = (i + 0.5) * kBand;
                setStroke(canvas, kInk, kButtonHoverShadow * e * 0.5 * std::erfc(d / falloff));
                canvas.beginPath();
                canvas.roundRect(static_cast<float>(box.x - d), static_cast<float>(box.y + 5.0 - d),
                                 static_cast<float>(box.w + d * 2.0),
                                 static_cast<float>(box.h + d * 2.0),
                                 static_cast<float>(kPillRadius + d));
                canvas.stroke();
            }
        }
        fillRounded(canvas, box, kPillRadius, kPaper, fill + (hoverFill - fill) * e);
        canvas.setGlobalAlpha(static_cast<float>(l.alpha * labelAlpha));
        text(canvas, label, box.x + box.w * 0.5,
             box.y + kButtonPadY + baselineIn(kLabelSize, normalLineHeight(kLabelSize)),
             cardText(kLabelSize, labelColour, Align::Centre));
        canvas.restore();
    };

    paintButton(l.skip, skipArmed_ ? "Are you sure?" : "Skip Tutorial", skipHover_, kSkipFillAlpha,
                kSkipHoverAlpha, kPaper, kSkipLabelAlpha);
    paintButton(l.next, "Next", nextHover_, kNextFillAlpha, kNextHoverAlpha, kNextLabel, 1.0);

    canvas.setGlobalAlpha(static_cast<float>(l.alpha * kCounterAlpha));
    text(canvas, std::to_string(step_ + 1) + " / " + std::to_string(kStepCount),
         l.contentX + l.contentW, l.counterBaseline, cardText(kCounterSize, kPaper, Align::Right));
    canvas.setGlobalAlpha(static_cast<float>(l.alpha));

    // The dots are rebuilt with the card's innerHTML on every step, so the
    // 0.3s transition their rule carries never has an old value to run from:
    // the active one is simply 1.3x and white from the first frame it exists.
    const double dotsWidth = kStepCount * kDotSize + (kStepCount - 1) * kDotGap;
    const double dotsX = l.card.x + l.card.w * 0.5 - dotsWidth * 0.5;
    for (int i = 0; i < kStepCount; ++i) {
        const double centreX = dotsX + i * (kDotSize + kDotGap) + kDotSize * 0.5;
        const double centreY = l.dotsTop + kDotSize * 0.5;
        const double radius = kDotSize * 0.5 * (i == step_ ? kActiveDotScale : 1.0);
        setFill(canvas, kPaper, i == step_ ? 1.0 : kDotIdleAlpha);
        canvas.fillCircle(static_cast<float>(centreX), static_cast<float>(centreY),
                          static_cast<float>(radius));
    }

    canvas.setGlobalAlpha(1.0f);
    canvas.restore();
}

} // namespace flr::ui
