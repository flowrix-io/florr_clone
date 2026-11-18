#include "client/ui/petal_hover.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>

#include "canvas.h"
#include "client/net_client.h"
#include "client/ui/draw.h"
#include "client/ui/menus.h"
#include "shared/game/config.h"
#include "window.h"

namespace flix::ui {

namespace {

using Matrix = std::array<float, 6>;

/// The frame's collection. One per process: there is one screen.
struct HoverState {
    const Canvas* screen = nullptr;
    /// Design units -> canvas pixels, as the frame's base transform has it,
    /// and its inverse, which takes a tile drawn under any transform back to
    /// the units the pointer is in.
    Matrix inverse{1, 0, 0, 1, 0, 0};
    bool invertible = false;
    Vec2 mouse{};
    /// The tile under the pointer, the last one noted.
    bool have = false;
    Rect rect{};
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    /// A scrolled list's view, while a PetalHoverClip is alive.
    bool clipped = false;
    Rect clip{};

    /// The card on screen, which outlives the hover by its fade-out: the
    /// petal and box it describes, and how far in it has faded.
    bool showing = false;
    Rect shownRect{};
    std::uint16_t shownPetal = kNoPetal;
    Rarity shownRarity = Rarity::Common;
    double opacity = 0.0;
    double lastSeconds = -1.0;
    /// A press on the tile under the pointer hides its card until the pointer
    /// moves to another one, as the browser's mousedown does.
    int lastKey = -1;
    bool suppressed = false;
    /// The scratch surface a part-faded card is painted into, so the box and
    /// its text fade as ONE picture rather than each at that alpha.
    std::unique_ptr<Canvas> layer;
};

/// How long the card takes to fade in, and to fade out. Short: it is there
/// the moment the pointer arrives, the fade only takes the edge off.
constexpr double kFadeInSeconds = 0.12;
constexpr double kFadeOutSeconds = 0.12;

HoverState& state() {
    static HoverState s;
    return s;
}

bool invert(const Matrix& m, Matrix& out) {
    const double det = static_cast<double>(m[0]) * m[3] - static_cast<double>(m[1]) * m[2];
    if (!(std::fabs(det) > 1e-12)) return false;
    const double a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    out = {static_cast<float>(a), static_cast<float>(b), static_cast<float>(c),
           static_cast<float>(d), static_cast<float>(-(a * m[4] + c * m[5])),
           static_cast<float>(-(b * m[4] + d * m[5]))};
    return true;
}

/// `rect` as drawn under `transform`, in design units: the box around its four
/// corners, which is the rect itself for anything merely moved or scaled, and
/// a little larger for a tile that is rocking.
Rect toDesign(const Matrix& transform, Rect rect) {
    const HoverState& s = state();
    double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
    const double xs[2] = {rect.x, rect.right()};
    const double ys[2] = {rect.y, rect.bottom()};
    for (const double x : xs) {
        for (const double y : ys) {
            const double px = transform[0] * x + transform[2] * y + transform[4];
            const double py = transform[1] * x + transform[3] * y + transform[5];
            const double dx = s.inverse[0] * px + s.inverse[2] * py + s.inverse[4];
            const double dy = s.inverse[1] * px + s.inverse[3] * py + s.inverse[5];
            x0 = std::min(x0, dx);
            y0 = std::min(y0, dy);
            x1 = std::max(x1, dx);
            y1 = std::max(y1, dy);
        }
    }
    return {x0, y0, x1 - x0, y1 - y0};
}

/// A stable name for what is under the pointer, so the dwell restarts when it
/// changes to another petal or another tile, and carries on while it does not.
/// The box is rounded coarsely: a tile easing the last pixel into its slot is
/// still the same tile.
int hoverKey(const HoverState& s) {
    if (!s.have) return -1;
    std::uint32_t h = s.petalIndex;
    h = h * 31u + static_cast<std::uint32_t>(s.rarity);
    h = h * 1000003u + static_cast<std::uint32_t>(static_cast<std::int32_t>(std::lround(s.rect.x / 8.0)));
    h = h * 1000003u + static_cast<std::uint32_t>(static_cast<std::int32_t>(std::lround(s.rect.y / 8.0)));
    return static_cast<int>(h & 0x7FFFFFFFu);
}

}  // namespace

void beginPetalHover(const Canvas& screen, double mouseX, double mouseY) {
    HoverState& s = state();
    s.screen = &screen;
    s.invertible = invert(screen.currentTransform(), s.inverse);
    s.mouse = {mouseX, mouseY};
    s.have = false;
    s.clipped = false;
}

void notePetalHoverAt(Rect designRect, std::uint16_t petalIndex, Rarity rarity) {
    HoverState& s = state();
    if (petalIndex == kNoPetal || !designRect.contains(s.mouse)) return;
    if (s.clipped && !s.clip.contains(s.mouse)) return;
    s.have = true;
    s.rect = designRect;
    s.petalIndex = petalIndex;
    s.rarity = rarity;
}

void notePetalHover(const Canvas& canvas, Rect rect, std::uint16_t petalIndex, Rarity rarity) {
    HoverState& s = state();
    if (&canvas != s.screen || !s.invertible) return;
    notePetalHoverAt(toDesign(canvas.currentTransform(), rect), petalIndex, rarity);
}

void coverPetalHover(Rect designRect) {
    HoverState& s = state();
    if (designRect.contains(s.mouse)) s.have = false;
}

PetalHoverClip::PetalHoverClip(const Canvas& canvas, Rect rect) {
    HoverState& s = state();
    hadClip_ = s.clipped;
    previous_ = s.clip;
    if (&canvas != s.screen || !s.invertible) return;
    Rect clip = toDesign(canvas.currentTransform(), rect);
    if (s.clipped) {
        // Nested inside another view: only where both are drawn.
        const double x0 = std::max(clip.x, s.clip.x), y0 = std::max(clip.y, s.clip.y);
        const double x1 = std::min(clip.right(), s.clip.right());
        const double y1 = std::min(clip.bottom(), s.clip.bottom());
        clip = {x0, y0, std::max(0.0, x1 - x0), std::max(0.0, y1 - y0)};
    }
    s.clipped = true;
    s.clip = clip;
}

PetalHoverClip::~PetalHoverClip() {
    HoverState& s = state();
    s.clipped = hadClip_;
    s.clip = previous_;
}

void paintPetalHover(Canvas& canvas, Window& window, const DragState& drag,
                     const Profile& profile, double timeSeconds) {
    HoverState& s = state();
    const double dt =
        s.lastSeconds < 0.0 ? 0.0 : std::clamp(timeSeconds - s.lastSeconds, 0.0, 0.1);
    s.lastSeconds = timeSeconds;

    // Shown the moment the pointer is over a petal, and anchored to the TILE,
    // never to the cursor. A press hides it -- what follows is a click or a
    // drag, and a box in the way is the last thing either wants -- until the
    // pointer moves on to another tile. `mousePressed` as well as `mouseDown`,
    // because a quick click is pressed and released on one frame and is never
    // seen held. A finger shows nothing: its pointer rests where it last
    // lifted, on whatever slid under it.
    const bool pointerDown = window.mouseDown(MouseButton::Left) ||
                             window.mousePressed(MouseButton::Left) ||
                             window.mouseDown(MouseButton::Right) || drag.active();
    const int key = hoverKey(s);
    if (key != s.lastKey) {
        s.lastKey = key;
        s.suppressed = false;
    }
    if (pointerDown) s.suppressed = true;
    const bool wanted = key >= 0 && !s.suppressed && !window.pointerIsTouch();

    if (wanted) {
        // Straight onto the new petal, at whatever opacity the card already
        // had: moving along a row of tiles swaps the card, it does not blink.
        s.showing = true;
        s.shownRect = s.rect;
        s.shownPetal = s.petalIndex;
        s.shownRarity = s.rarity;
        s.opacity = std::min(1.0, s.opacity + dt / kFadeInSeconds);
        // The first frame of a fresh hover is not blank: the card starts on
        // its way in rather than a frame late.
        if (s.opacity <= 0.0) s.opacity = std::min(1.0, 1.0 / 60.0 / kFadeInSeconds);
    } else {
        s.opacity = std::max(0.0, s.opacity - dt / kFadeOutSeconds);
        if (s.opacity <= 0.0) s.showing = false;
    }
    if (!s.showing || s.shownPetal == kNoPetal || s.shownPetal >= content().petalCount()) return;

    // The reload the bar would actually run, as the slot wedge times it.
    const double reloadScale =
        profile.skills.reloadScale() *
        (1.0 - barReloadCut(content(), [&](int i) { return profile.equipped(content(), i); }));
    const std::vector<TooltipLine> lines =
        petalTooltip(s.shownPetal, s.shownRarity, profile.skills, reloadScale);
    const bool alt = window.altHeld();
    const Vec2 size = measureTooltip(lines, 0.0, 0.0, alt);
    const Vec2 at = tooltipAnchor(s.shownRect, size, canvas.width(), canvas.height());

    if (s.opacity >= 0.999) {
        paintTooltip(canvas, at.x, at.y, lines, 0.0, 0.0, alt);
        return;
    }
    // Part faded: painted whole into a scratch layer and laid down once, so
    // the half-black box does not show through its own outlined text. A few
    // units of slack all round for the outlines' reach past the box.
    constexpr double kSlack = 4.0;
    LayerBox box;
    const Rect extent{at.x - kSlack, at.y - kSlack, size.x + kSlack * 2, size.y + kSlack * 2};
    if (!beginLayer(canvas, s.layer, extent, box)) return;
    paintTooltip(*s.layer, at.x, at.y, lines, 0.0, 0.0, alt);
    endLayer(canvas, *s.layer, box, s.opacity);
}

}  // namespace flix::ui
