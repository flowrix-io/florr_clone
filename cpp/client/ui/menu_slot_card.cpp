// The slot card: the one card the forge, the oracle, the trader and the titan
// are drawn on.
//
// Laid out against the reference trade shot (After-trade_trade_menu.webp) and
// measured off it -- the oracle's reference shot agrees with it to the unit --
// in design units (the shots are at one design unit to the pixel), from the
// card's OUTER top edge and from its centre line. What the four cards share
// and what they do not is in menus.h; slotCardBounds() is in menus.cpp, with
// every other panel's anchoring.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

#include "client/ui/item_tile.h"
#include "client/ui/menu_style.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "shared/game/config.h"

namespace flix {

using namespace flix::ui;

namespace {

// -- the card ---------------------------------------------------------------------

/// The grid: 60-unit cells on a 70-unit pitch, 25 in from the card's left
/// edge and 42 clear of its right, where the scroll thumb runs.
constexpr double kGridCell = 60.0;
constexpr double kGridGap = 10.0;
constexpr double kGridLeft = 25.0;
constexpr double kGridRight = 42.0;
/// Where the scroll view begins, and the gap above its first row and below its
/// last.
constexpr double kGridTop = 339.0;
constexpr double kGridPadding = 10.0;
/// The card's border, which the view stops short of at the bottom.
constexpr double kCardBorder = 6.0;
/// Its height: the reference's card is this tall, which gives the grid its
/// five visible rows.
constexpr double kCardHeight = 707.0;
constexpr double kWheelStep = 100.0;
/// The thumb: 8 wide, 20 in from the card's right edge, rounded, in the skin's
/// accent. A hint at how far down the list is, not a control.
constexpr double kThumbWidth = 8.0;
constexpr double kThumbRight = 20.0;
constexpr double kThumbMinHeight = 20.0;

/// The slot and the button share a line, either side of the centre.
constexpr double kRowCentreY = 181.0;
constexpr double kSlotOffsetX = -101.0;
constexpr double kActionOffsetX = 129.0;
constexpr double kActionWidth = 64.0;
constexpr double kActionHeight = 35.0;
constexpr double kActionRim = 4.0;
constexpr double kActionRadius = 8.0;
/// The idle button's greys -- the same pair a grey cell wears.
constexpr std::uint32_t kActionIdleFill = 0x777777u;
constexpr std::uint32_t kActionIdleBorder = 0x606060u;
/// The one line of text, centred.
constexpr double kLineY = 318.0;

// -- the flourish -------------------------------------------------------------------

/// The landing throws twice a drop's burst: it is one tile doing what a whole
/// kill's worth of loot does, and a single drop's seven grains vanish behind a
/// tile this size.
constexpr int kLandingBurstGrains = kDropBurstCount * 2;
/// The shimmer: a drop's own, arriving evenly.
constexpr double kShimmerSpeed = 1.2;
constexpr double kShimmerSpeedSpread = 1.2;
constexpr double kShimmerLifeMs = 700.0;
constexpr double kShimmerLifeSpreadMs = 500.0;
constexpr double kShimmerSize = 5.0;
constexpr double kShimmerSizeSpread = 10.0;
constexpr std::size_t kMaxGrains = 192;
/// A drop's grains fade from 60%, like the ground's.
constexpr double kGrainAlpha = 0.6;
/// The world's per-frame speeds, and its grain sizes, are stated against a
/// 60-unit drop; the slot is bigger, so they grow with it.
constexpr double kFramesPerSecond = 60.0;
constexpr double kGrainScale = kSlotCardSlot / kItemTileDesign;

/// Never a universal column: no card -- forge, oracle or trader -- takes one.
std::size_t tierColumns(bool withApex) {
    return withApex ? static_cast<std::size_t>(kLadderRarityCount)
                    : static_cast<std::size_t>(Rarity::Unique) + 1;
}

/// Particle jitter. Not reproducible and not meant to be, exactly as the world
/// renderer's is: nobody else sees this slot.
double jitter() {
    static std::uint32_t state = 0x9E3779B9u;
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<double>(state % 100000u) / 100000.0;
}

} // namespace

double slotCardWidth(bool withApex) { return slotCardColumnsWidth(tierColumns(withApex)); }

double slotCardColumnsWidth(std::size_t columns) {
    return kGridLeft + static_cast<double>(columns) * (kGridCell + kGridGap) - kGridGap +
           kGridRight;
}

double slotCardHeight() { return kCardHeight; }

SlotCardLayout drawSlotCard(Canvas& canvas, Rect panel, const PanelSkin& skin, const char* title,
                            Vec2 mouse) {
    panelCard(canvas, panel, skin, kCardBorder);
    panelTitle(canvas, panel, title);
    SlotCardLayout layout;
    layout.panel = panel;
    layout.close = closeButtonRect(panel);
    panelClose(canvas, layout.close, layout.close.contains(mouse));

    layout.centreX = panel.x + panel.w * 0.5;
    const double rowY = panel.y + kRowCentreY;
    layout.slot = {layout.centreX + kSlotOffsetX, rowY};
    layout.slotRect = {layout.slot.x - kSlotCardSlot * 0.5, layout.slot.y - kSlotCardSlot * 0.5,
                       kSlotCardSlot, kSlotCardSlot};
    layout.button = {layout.centreX + kActionOffsetX - kActionWidth * 0.5,
                     rowY - kActionHeight * 0.5, kActionWidth, kActionHeight};
    layout.lineY = panel.y + kLineY;
    return layout;
}

void drawSlotPlate(Canvas& canvas, const SpriteCache& sprites, Rect rect, const PanelSkin& skin) {
    ItemTile plate;
    plate.empty = true;
    plate.emptyFill = skin.border;
    plate.emptyBorder = skin.border;
    drawItemTile(canvas, sprites, rect, plate);
}

void drawSlotTile(Canvas& canvas, const SpriteCache& sprites, Vec2 centre, double side,
                  double rotation, const ItemTile& tile) {
    canvas.save();
    canvas.translate(static_cast<float>(centre.x), static_cast<float>(centre.y));
    if (rotation != 0.0) canvas.rotate(static_cast<float>(rotation));
    drawItemTile(canvas, sprites, {-side * 0.5, -side * 0.5, side, side}, tile);
    canvas.restore();
}

void drawSlotButton(Canvas& canvas, Rect rect, const char* label,
                    std::optional<std::uint32_t> tint, bool hovered) {
    const std::uint32_t fill = tint ? *tint : kActionIdleFill;
    const std::uint32_t border = tint ? darken(fill, 0.25) : kActionIdleBorder;
    inlaid(canvas, rect, hovered ? lighten(fill, 0.15) : fill, border, kActionRim, kActionRadius);
    outlinedText(canvas, label, rect.x + rect.w * 0.5, rect.y + rect.h * 0.5,
                 panelLabel(16.0, Align::Centre, Baseline::Middle), kSlotCardLabelStroke);
}

void drawSlotLine(Canvas& canvas, const SlotCardLayout& layout, const std::string& text,
                  std::optional<std::uint32_t> ink) {
    TextStyle style = panelLabel(16.0, Align::Centre, Baseline::Middle);
    if (ink) style.fill = *ink;
    outlinedText(canvas, text, layout.centreX, layout.lineY, style, kSlotCardLabelStroke);
}

void drawSlotRefusal(Canvas& canvas, const SlotCardLayout& layout, const std::string& text) {
    TextStyle style = panelLabel(12.0, Align::Centre, Baseline::Top);
    style.fill = kSlotCardRefusalInk;
    outlinedText(canvas, text, layout.slot.x, layout.slotRect.bottom() + 10.0, style,
                 kSlotCardLabelStroke);
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

std::optional<SlotGrid::Pick> SlotGrid::render(
    MenuContext& ctx, const SlotCardLayout& layout, const PanelSkin& skin, bool withApex,
    const std::function<SlotCell(std::uint16_t petalIndex, Rarity, std::uint32_t owned)>& look) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = layout.panel;
    const Vec2 mouse = ctx.mouse();
    const std::size_t columns = tierColumns(withApex);

    // A stack only a column the grid does not have would show -- an apex one
    // on a card that stops at unique -- does not earn its type a row.
    std::vector<std::uint16_t> types;
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.count == 0 || rarityIndex(stack.rarity) >= static_cast<int>(columns)) continue;
        if (std::find(types.begin(), types.end(), stack.petalIndex) == types.end()) {
            types.push_back(stack.petalIndex);
        }
    }
    std::sort(types.begin(), types.end());

    const double inventoryTop = panel.y + kGridTop;
    const Rect view{panel.x + kCardBorder, inventoryTop, panel.w - kCardBorder * 2,
                    std::max(0.0, panel.bottom() - kCardBorder - inventoryTop)};
    const double startX = panel.x + kGridLeft;
    const double contentHeight = kGridPadding * 2 +
                                 static_cast<double>(types.size()) * (kGridCell + kGridGap) -
                                 (types.empty() ? 0.0 : kGridGap);

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = view.h;
    // Anywhere below the line scrolls the grid, not just over the cells.
    if (panel.contains(mouse) && mouse.y >= inventoryTop) {
        scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    }
    scroll_.offset -= touchScroll(ctx.window, view, scroll_.maxOffset() > 0);
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(view.x), static_cast<float>(view.y), static_cast<float>(view.w),
                static_cast<float>(view.h));
    canvas.clip();

    std::optional<Pick> hovered;
    for (std::size_t row = 0; row < types.size(); ++row) {
        const std::uint16_t petalIndex = types[row];
        const double y = view.y - scroll_.offset + kGridPadding +
                         static_cast<double>(row) * (kGridCell + kGridGap);
        if (y + kGridCell < view.y || y > view.bottom()) continue;
        // Each row RIGHT TO LEFT: the oracle's "owned/price" labels hang past a
        // cell's right edge over the next one, and painting that cell after it
        // would cut the label off at the join.
        for (std::size_t k = 0; k < columns; ++k) {
            const std::size_t column = columns - 1 - k;
            const Rarity rarity = static_cast<Rarity>(column);
            const Rect rect{startX + static_cast<double>(column) * (kGridCell + kGridGap), y,
                            kGridCell, kGridCell};
            const SlotCell cell = look(petalIndex, rarity, profile.stackCount(petalIndex, rarity));
            if (cell.count == 0) {
                // A tier the account holds none of: a flat square in the
                // border's colour. Not hoverable and not clickable.
                drawSlotPlate(canvas, ctx.sprites, rect, skin);
                continue;
            }
            const bool over = !cell.greyed && rect.contains(mouse) && view.contains(mouse);
            if (over) hovered = Pick{petalIndex, rarity};

            ItemTile tile;
            tile.petalIndex = petalIndex;
            tile.rarity = rarity;
            tile.hovered = over;
            tile.greyed = cell.greyed;
            tile.badge = cell.badge;
            tile.badgeCentred = cell.badgeCentred;
            tile.timeSeconds = ctx.timeSeconds;
            drawItemTile(canvas, ctx.sprites, rect, tile);
        }
    }
    canvas.restore();

    if (contentHeight > view.h && view.h > 0.0) {
        const double thumbHeight = std::max(kThumbMinHeight, view.h * view.h / contentHeight);
        const double travel = contentHeight - view.h;
        const double thumbY =
            view.y + clamp(scroll_.offset / travel, 0.0, 1.0) * (view.h - thumbHeight);
        fillRound(canvas,
                  {panel.right() - kThumbRight - kThumbWidth, thumbY, kThumbWidth, thumbHeight},
                  kThumbWidth * 0.5, skin.accent);
    }
    return hovered;
}

std::optional<SlotTierGrid::Pick> SlotTierGrid::render(
    MenuContext& ctx, const SlotCardLayout& layout, const PanelSkin& skin, Rarity tier,
    std::size_t columns, double top,
    const std::function<SlotCell(std::uint16_t petalIndex, std::uint32_t owned)>& look) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = layout.panel;
    const Vec2 mouse = ctx.mouse();
    columns = std::max<std::size_t>(1, columns);

    std::vector<std::uint16_t> types;
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.count == 0 || stack.rarity != tier) continue;
        if (std::find(types.begin(), types.end(), stack.petalIndex) == types.end()) {
            types.push_back(stack.petalIndex);
        }
    }
    std::sort(types.begin(), types.end());
    const std::size_t rows = (types.size() + columns - 1) / columns;

    const double viewTop = panel.y + top;
    const Rect view{panel.x + kCardBorder, viewTop, panel.w - kCardBorder * 2,
                    std::max(0.0, panel.bottom() - kCardBorder - viewTop)};
    // Where SlotGrid's columns would stand -- in from the left, and clear of
    // the thumb on the right -- and each row centred on the middle of that.
    const double areaWidth = static_cast<double>(columns) * (kGridCell + kGridGap) - kGridGap;
    const double areaCentre = panel.x + kGridLeft + areaWidth * 0.5;
    const double contentHeight = kGridPadding * 2 +
                                 static_cast<double>(rows) * (kGridCell + kGridGap) -
                                 (rows == 0 ? 0.0 : kGridGap);

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = view.h;
    if (panel.contains(mouse) && mouse.y >= viewTop) {
        scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    }
    scroll_.offset -= touchScroll(ctx.window, view, scroll_.maxOffset() > 0);
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(view.x), static_cast<float>(view.y), static_cast<float>(view.w),
                static_cast<float>(view.h));
    canvas.clip();

    std::optional<Pick> hovered;
    for (std::size_t row = 0; row < rows; ++row) {
        const double y = view.y - scroll_.offset + kGridPadding +
                         static_cast<double>(row) * (kGridCell + kGridGap);
        if (y + kGridCell < view.y || y > view.bottom()) continue;
        const std::size_t first = row * columns;
        const std::size_t count = std::min(columns, types.size() - first);
        const double rowWidth = static_cast<double>(count) * (kGridCell + kGridGap) - kGridGap;
        const double startX = areaCentre - rowWidth * 0.5;
        for (std::size_t k = 0; k < count; ++k) {
            const std::uint16_t petalIndex = types[first + k];
            const Rect rect{startX + static_cast<double>(k) * (kGridCell + kGridGap), y, kGridCell,
                            kGridCell};
            const SlotCell cell = look(petalIndex, profile.stackCount(petalIndex, tier));
            if (cell.count == 0) {
                drawSlotPlate(canvas, ctx.sprites, rect, skin);
                continue;
            }
            const bool under = rect.contains(mouse) && view.contains(mouse);
            if (under) hovered = Pick{petalIndex, cell.greyed};

            ItemTile tile;
            tile.petalIndex = petalIndex;
            tile.rarity = tier;
            tile.hovered = under && !cell.greyed;
            tile.greyed = cell.greyed;
            tile.badge = cell.badge;
            tile.badgeCentred = cell.badgeCentred;
            tile.timeSeconds = ctx.timeSeconds;
            drawItemTile(canvas, ctx.sprites, rect, tile);
        }
    }
    canvas.restore();

    if (contentHeight > view.h && view.h > 0.0) {
        const double thumbHeight = std::max(kThumbMinHeight, view.h * view.h / contentHeight);
        const double travel = contentHeight - view.h;
        const double thumbY =
            view.y + clamp(scroll_.offset / travel, 0.0, 1.0) * (view.h - thumbHeight);
        fillRound(canvas,
                  {panel.right() - kThumbRight - kThumbWidth, thumbY, kThumbWidth, thumbHeight},
                  kThumbWidth * 0.5, skin.accent);
    }
    return hovered;
}

// ---------------------------------------------------------------------------
// The flourish
// ---------------------------------------------------------------------------

void SlotFlourish::clear() {
    grains_.clear();
    grainCredit_ = 0;
}

void SlotFlourish::throwGrains(Rarity rarity, int count, double speed, double speedSpread,
                               double lifeMs, double lifeSpreadMs, double size,
                               double sizeSpread) {
    for (int i = 0; i < count && grains_.size() < kMaxGrains; ++i) {
        // Each grain its own direction and facing: a drop's scatter, not a
        // petal's spokes.
        const double angle = jitter() * kTau;
        const double pace = (speed + jitter() * speedSpread) * kFramesPerSecond * kGrainScale;
        Grain grain;
        grain.position = {(jitter() - 0.5) * 4.0, (jitter() - 0.5) * 4.0};
        grain.velocity = Vec2::fromAngle(angle, pace);
        grain.lifeSeconds = grain.maxLifeSeconds = (lifeMs + jitter() * lifeSpreadMs) / 1000.0;
        grain.size = (size + jitter() * sizeSpread) * kGrainScale;
        grain.rotation = jitter() * kTau;
        grain.color = rarityColor(rarity);
        grains_.push_back(grain);
    }
}

void SlotFlourish::land(double now, Rarity rarity) {
    landStarted_ = now;
    landFrom_ = Vec2::fromAngle(jitter() * kTau,
                                (kDropLandNear + jitter() * kDropLandSpread) * kGrainScale);
    landSpin_ = (jitter() - 0.5) * kPi;
    throwGrains(rarity, kLandingBurstGrains, kDropBurstSpeed, kDropBurstSpeedSpread,
                kDropBurstLifeMs, kDropBurstLifeSpreadMs, kDropBurstSize, kDropBurstSizeSpread);
}

void SlotFlourish::shimmer(Rarity rarity, double rate, double dt) {
    grainCredit_ += rate * dt;
    const int owed = static_cast<int>(grainCredit_);
    grainCredit_ -= owed;
    throwGrains(rarity, owed, kShimmerSpeed, kShimmerSpeedSpread, kShimmerLifeMs,
                kShimmerLifeSpreadMs, kShimmerSize, kShimmerSizeSpread);
}

void SlotFlourish::drawGrains(Canvas& canvas, Rect panel, Vec2 slotCentre, double dt) {
    for (Grain& grain : grains_) {
        grain.position += grain.velocity * dt;
        grain.lifeSeconds -= dt;
    }
    grains_.erase(std::remove_if(grains_.begin(), grains_.end(),
                                 [](const Grain& g) { return g.lifeSeconds <= 0.0; }),
                  grains_.end());
    if (grains_.empty()) return;
    canvas.save();
    roundPath(canvas, panel, kMenuRadius);
    canvas.clip();
    for (const Grain& grain : grains_) {
        const double left = grain.lifeSeconds / grain.maxLifeSeconds;
        const double r = grain.size * left;
        if (r <= 0.0) continue;
        const Vec2 at = slotCentre + grain.position;
        const double c = std::cos(grain.rotation) * r;
        const double s = std::sin(grain.rotation) * r;
        setFill(canvas, grain.color);
        canvas.setGlobalAlpha(static_cast<float>(left * kGrainAlpha));
        canvas.beginPath();
        canvas.moveTo(static_cast<float>(at.x - c + s), static_cast<float>(at.y - s - c));
        canvas.lineTo(static_cast<float>(at.x + c + s), static_cast<float>(at.y + s - c));
        canvas.lineTo(static_cast<float>(at.x + c - s), static_cast<float>(at.y + s + c));
        canvas.lineTo(static_cast<float>(at.x - c - s), static_cast<float>(at.y - s + c));
        canvas.closePath();
        canvas.fill();
    }
    canvas.setGlobalAlpha(1.0f);
    canvas.restore();
}

void SlotFlourish::drawLanded(Canvas& canvas, const SpriteCache& sprites, Vec2 slotCentre,
                              double side, double now, const ItemTile& tile) const {
    // In from its offset and unwinding its spin, eased out over a drop's 400 ms.
    const double t = clamp((now - landStarted_) / kDropLandSeconds, 0.0, 1.0);
    const double eased = 1.0 - (1.0 - t) * (1.0 - t);
    drawSlotTile(canvas, sprites, slotCentre + landFrom_ * (1.0 - eased), side,
                 landSpin_ * (1.0 - eased), tile);
}

} // namespace flix
