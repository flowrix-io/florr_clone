// The slot card: the one window the forge, the oracle, the trader and the
// titan are drawn in.
//
// It is florr's craft window, measured out of florr's own client rather than
// off screenshots: the screen render (sub_1008d1230, 0x1008d8c5c..0x1008d9c60)
// was run under ~/florr_images/emulator/menus.py and every Skia call it made
// recorded, at the coordinates it laid the window out at. The numbers below
// are those, in window units, which this client draws at one to the design
// unit. What the four cards share and what they do not is in menus.h; the
// window's slide is MenuSystem's (menus.cpp), with every other panel's.

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

// -- the window -------------------------------------------------------------------

/// Laid out inside 610 x 700 at x = 95, its bottom 20 above the view's.
constexpr double kWindowMinWidth = 610.0;
constexpr double kWindowMaxHeight = 700.0;
constexpr double kWindowX = 95.0;
constexpr double kWindowBottom = 20.0;
/// The highest the window may reach on a short view: clear of the player's
/// own plate in the top-left corner.
constexpr double kWindowTopMin = 160.0;
/// The panel: filled in the theme, then a 7-wide round-joined stroke of its
/// shade, which is what rounds its corners.
constexpr double kWindowStroke = 7.0;
/// Everything inside sits 10 in from the panel's edge.
constexpr double kWindowPad = 10.0;

/// The title row: 24-unit text on a 1.4 line, centred over the row less the
/// close button's 10.
constexpr double kTitleSize = 24.0;
constexpr double kLineHeight = 1.4;
constexpr double kTitleRow = kTitleSize * kLineHeight;
/// The close button: 25 square, 39 in from the panel's right, centred on the
/// row. Its rim reaches 2 past the square, rounded 8; the face is 2 inside it,
/// rounded 4; the cross runs 6.25 out from the middle at 3.75 wide. Every
/// corner is a quadratic, not an arc.
constexpr double kCloseSide = 25.0;
constexpr double kCloseFromRight = 39.0;
constexpr double kCloseRimOut = 2.0;
constexpr double kCloseRimRadius = 8.0;
constexpr double kCloseFaceIn = 2.0;
constexpr double kCloseFaceRadius = 4.0;
constexpr double kCloseArm = 6.25;
constexpr double kCloseCrossWidth = 3.75;
constexpr std::uint32_t kCloseRimInk = 0x974545u;
constexpr std::uint32_t kCloseFaceInk = 0xBB5555u;
constexpr std::uint32_t kCloseCrossInk = 0xCCCCCCu;

/// The body: 500 wide, centred, under the title row; 295 deep.
constexpr double kBodyTop = kWindowPad + kTitleRow + kWindowPad;
constexpr double kBodyWidth = 500.0;
constexpr double kBodyHeight = 295.0;
/// In the body: the slot (or the ring's centre), the button and the odds
/// under it, and the two lines -- 16 and 14 units, each on a 1.4 line.
constexpr double kSlotX = 150.0;
constexpr double kSlotY = 125.0;
constexpr double kButtonX = 380.0;
constexpr double kButtonY = 125.0;
constexpr double kChanceY = 150.0;
constexpr double kChanceSize = 14.0;
constexpr double kLineTop = 250.0;
constexpr double kLineSize = 16.0;
constexpr double kLine2Top = 275.4;
constexpr double kLine2Size = 14.0;

/// The button: 35 tall and 13 either side of its label; a rim rounded 10 and
/// a face 5 inside it rounded 5, both with quadratic corners.
constexpr double kButtonHeight = 35.0;
constexpr double kButtonPadX = 13.0;
constexpr double kButtonRadius = 10.0;
constexpr double kButtonRim = 5.0;
constexpr double kButtonFaceRadius = 5.0;
constexpr double kButtonLabelSize = 16.0;
constexpr std::uint32_t kButtonIdleFace = 0x777777u;
constexpr std::uint32_t kButtonIdleRim = 0x606060u;

/// The grid: 60-unit cells on a 70-unit pitch, in a list 16 wider than its
/// columns, centred under the body and 10 below it. The first row is 10 down
/// and each cell 5 in; the view stops 10 short of the panel's bottom.
constexpr double kGridCell = 60.0;
constexpr double kGridPitch = 70.0;
constexpr double kListExtra = 16.0;
constexpr double kListTop = kBodyTop + kBodyHeight + kWindowPad;
constexpr double kCellInsetX = 5.0;
constexpr double kCellInsetY = 10.0;
constexpr double kListBottomPad = 10.0;
constexpr double kWheelStep = 100.0;

/// A path round `r` with corners of `radius` drawn the way florr's widgets
/// draw them: a quadratic through the corner point, not a circular arc.
void quadRoundPath(Canvas& canvas, Rect r, double radius) {
    const auto f = [](double v) { return static_cast<float>(v); };
    const double x0 = r.x, y0 = r.y, x1 = r.right(), y1 = r.bottom();
    canvas.beginPath();
    canvas.moveTo(f(x0 + radius), f(y0));
    canvas.lineTo(f(x1 - radius), f(y0));
    canvas.quadraticCurveTo(f(x1), f(y0), f(x1), f(y0 + radius));
    canvas.lineTo(f(x1), f(y1 - radius));
    canvas.quadraticCurveTo(f(x1), f(y1), f(x1 - radius), f(y1));
    canvas.lineTo(f(x0 + radius), f(y1));
    canvas.quadraticCurveTo(f(x0), f(y1), f(x0), f(y1 - radius));
    canvas.lineTo(f(x0), f(y0 + radius));
    canvas.quadraticCurveTo(f(x0), f(y0), f(x0 + radius), f(y0));
    canvas.closePath();
}

void fillQuadRound(Canvas& canvas, Rect r, double radius, std::uint32_t rgb) {
    setFill(canvas, rgb);
    quadRoundPath(canvas, r, radius);
    canvas.fill();
}

/// The width of the grid's list for `columns` cells.
double listWidth(std::size_t columns) {
    return static_cast<double>(columns) * kGridPitch + kListExtra;
}

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

std::uint32_t slotCardShade(std::uint32_t theme) {
    // florr squares the channel back after scaling its root by 0.9, and rounds.
    const auto shade = [](std::uint32_t c) {
        return static_cast<std::uint32_t>(std::lround(static_cast<double>(c) * 0.81));
    };
    return (shade((theme >> 16) & 0xFFu) << 16) | (shade((theme >> 8) & 0xFFu) << 8) |
           shade(theme & 0xFFu);
}

PanelSkin slotCardSkin(std::uint32_t theme) {
    const std::uint32_t shade = slotCardShade(theme);
    return PanelSkin{theme, shade, shade};
}

double slotCardWidth(bool withApex) { return slotCardColumnsWidth(tierColumns(withApex)); }

double slotCardColumnsWidth(std::size_t columns) {
    // florr's list is 576 wide in its 610: 17 either side. Our ladder has a
    // tier more than florr's, so a grid through unique is a column wider and
    // the window grows by it rather than squeezing the cells.
    return std::max(kWindowMinWidth, listWidth(columns) + 2.0 * (kWindowPad + 7.0));
}

double slotCardHeight(std::size_t rows) {
    return std::min(kWindowMaxHeight,
                    kListTop + kCellInsetY + static_cast<double>(rows) * kGridPitch + kListBottomPad);
}

Rect slotCardBounds(double width, double height, int, int viewHeight) {
    const double bottom = static_cast<double>(viewHeight) - kWindowBottom;
    const double fitted = std::max(0.0, std::min(height, bottom - kWindowTopMin));
    return {kWindowX, bottom - fitted, width, fitted};
}

SlotCardLayout drawSlotCard(Canvas& canvas, Rect panel, const PanelSkin& skin, const char* title,
                            const char* button, Vec2 mouse) {
    // The panel: the theme, under a stroke of its shade whose round joins are
    // the window's corners.
    setFill(canvas, skin.fill);
    canvas.fillRect(static_cast<float>(panel.x), static_cast<float>(panel.y),
                    static_cast<float>(panel.w), static_cast<float>(panel.h));
    canvas.save();
    setStroke(canvas, skin.border);
    canvas.setLineWidth(static_cast<float>(kWindowStroke));
    canvas.setLineJoin("round");
    canvas.strokeRect(static_cast<float>(panel.x), static_cast<float>(panel.y),
                      static_cast<float>(panel.w), static_cast<float>(panel.h));
    canvas.restore();

    SlotCardLayout layout;
    layout.panel = panel;

    // The title, centred over the row the close button leaves it.
    const double rowMiddle = panel.y + kWindowPad + kTitleRow * 0.5;
    outlinedText(canvas, title, panel.x + (panel.w - kWindowPad) * 0.5, rowMiddle,
                 panelLabel(kTitleSize, Align::Centre, Baseline::Middle), 1.0);

    // The close button.
    const Rect square{panel.right() - kCloseFromRight, rowMiddle - kCloseSide * 0.5, kCloseSide,
                      kCloseSide};
    layout.close = {square.x - kCloseRimOut, square.y - kCloseRimOut,
                    kCloseSide + kCloseRimOut * 2.0, kCloseSide + kCloseRimOut * 2.0};
    const bool closeHovered = layout.close.contains(mouse);
    fillQuadRound(canvas, layout.close, kCloseRimRadius, kCloseRimInk);
    fillQuadRound(canvas,
                  {square.x + kCloseFaceIn, square.y + kCloseFaceIn,
                   kCloseSide - kCloseFaceIn * 2.0, kCloseSide - kCloseFaceIn * 2.0},
                  kCloseFaceRadius, closeHovered ? lighten(kCloseFaceInk, 0.12) : kCloseFaceInk);
    {
        const double cx = square.x + kCloseSide * 0.5;
        const double cy = square.y + kCloseSide * 0.5;
        canvas.save();
        setStroke(canvas, kCloseCrossInk);
        canvas.setLineWidth(static_cast<float>(kCloseCrossWidth));
        canvas.setLineCap("butt");
        canvas.beginPath();
        canvas.moveTo(static_cast<float>(cx - kCloseArm), static_cast<float>(cy - kCloseArm));
        canvas.lineTo(static_cast<float>(cx + kCloseArm), static_cast<float>(cy + kCloseArm));
        canvas.moveTo(static_cast<float>(cx + kCloseArm), static_cast<float>(cy - kCloseArm));
        canvas.lineTo(static_cast<float>(cx - kCloseArm), static_cast<float>(cy + kCloseArm));
        canvas.stroke();
        canvas.restore();
    }

    // The body, centred under the row.
    layout.body = {panel.x + (panel.w - kBodyWidth) * 0.5, panel.y + kBodyTop};
    layout.centreX = layout.body.x + kBodyWidth * 0.5;
    layout.slot = {layout.body.x + kSlotX, layout.body.y + kSlotY};
    layout.slotRect = {layout.slot.x - kSlotCardSlot * 0.5, layout.slot.y - kSlotCardSlot * 0.5,
                       kSlotCardSlot, kSlotCardSlot};
    const double buttonWidth = measure(button, kButtonLabelSize) + kButtonPadX * 2.0;
    layout.button = {layout.body.x + kButtonX - buttonWidth * 0.5,
                     layout.body.y + kButtonY - kButtonHeight * 0.5, buttonWidth, kButtonHeight};
    layout.chanceY = layout.body.y + kChanceY;
    layout.lineY = layout.body.y + kLineTop + kLineSize * kLineHeight * 0.5;
    layout.line2Y = layout.body.y + kLine2Top + kLine2Size * kLineHeight * 0.5;

    const double listTop = panel.y + kListTop;
    layout.listView = {panel.x, listTop, panel.w,
                       std::max(0.0, panel.bottom() - kListBottomPad - listTop)};
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
                    std::optional<std::uint32_t> tint, bool hovered, bool pressed) {
    std::uint32_t face = tint ? *tint : kButtonIdleFace;
    if (tint && (hovered || pressed)) {
        // Per channel, as florr's button does it: c * 0.9, plus 25.5 hovered.
        const double lift = pressed ? 0.0 : 25.5;
        const auto channel = [&](int shift) {
            const double c = static_cast<double>((face >> shift) & 0xFFu) * 0.9 + lift;
            return static_cast<std::uint32_t>(std::min(255.0, c)) << shift;
        };
        face = channel(16) | channel(8) | channel(0);
    }
    const std::uint32_t rim = tint ? slotCardShade(face) : kButtonIdleRim;
    fillQuadRound(canvas, rect, kButtonRadius, rim);
    fillQuadRound(canvas,
                  {rect.x + kButtonRim, rect.y + kButtonRim, rect.w - kButtonRim * 2.0,
                   rect.h - kButtonRim * 2.0},
                  kButtonFaceRadius, face);
    outlinedText(canvas, label, rect.x + rect.w * 0.5, rect.y + rect.h * 0.5,
                 panelLabel(kButtonLabelSize, Align::Centre, Baseline::Middle),
                 kSlotCardLabelStroke);
}

void drawSlotChance(Canvas& canvas, const SlotCardLayout& layout, const std::string& text) {
    outlinedText(canvas, text, layout.button.x + layout.button.w * 0.5, layout.chanceY,
                 panelLabel(kChanceSize, Align::Centre, Baseline::Middle), kSlotCardLabelStroke);
}

void drawSlotLine(Canvas& canvas, const SlotCardLayout& layout, const std::string& text,
                  std::optional<std::uint32_t> ink, bool second) {
    TextStyle style =
        panelLabel(second ? kLine2Size : kLineSize, Align::Centre, Baseline::Middle);
    if (ink) style.fill = *ink;
    outlinedText(canvas, text, layout.centreX, second ? layout.line2Y : layout.lineY, style,
                 kSlotCardLabelStroke);
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

namespace {

/// The petal types a grid has rows for: held at some tier `held` accepts,
/// in id order -- florr's list is the inventory's petal ids, in order.
template <typename Held>
std::vector<std::uint16_t> heldTypes(const Profile& profile, Held held) {
    std::vector<std::uint16_t> types;
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.count == 0 || !held(stack.rarity)) continue;
        if (std::find(types.begin(), types.end(), stack.petalIndex) == types.end()) {
            types.push_back(stack.petalIndex);
        }
    }
    std::sort(types.begin(), types.end());
    return types;
}

/// Wheel and touch scrolling over the list, clamped to what it holds.
void scrollList(MenuContext& ctx, ui::Scroller& scroll, const SlotCardLayout& layout,
                double contentHeight) {
    const Vec2 mouse = ctx.mouse();
    scroll.contentHeight = contentHeight;
    scroll.viewHeight = layout.listView.h;
    // Anywhere below the body scrolls the grid, not just over the cells.
    if (layout.panel.contains(mouse) && mouse.y >= layout.listView.y) {
        scroll.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    }
    scroll.offset -= touchScroll(ctx.window, layout.listView, scroll.maxOffset() > 0);
    scroll.offset = clamp(scroll.offset, 0.0, scroll.maxOffset());
}

/// The list's clip: as wide as its columns, centred, down to the view's
/// bottom.
Rect listClip(const SlotCardLayout& layout, std::size_t columns) {
    const double width = listWidth(columns);
    return {layout.panel.x + (layout.panel.w - width) * 0.5, layout.listView.y, width,
            layout.listView.h};
}

double contentHeightFor(std::size_t rows) {
    return kCellInsetY + static_cast<double>(rows) * kGridPitch;
}

} // namespace

std::size_t SlotGrid::rows(const Profile& profile, bool withApex) {
    const int columns = static_cast<int>(tierColumns(withApex));
    return heldTypes(profile, [&](Rarity r) { return rarityIndex(r) < columns; }).size();
}

std::optional<SlotGrid::Pick> SlotGrid::render(
    MenuContext& ctx, const SlotCardLayout& layout, const PanelSkin& skin, bool withApex,
    const std::function<SlotCell(std::uint16_t petalIndex, Rarity, std::uint32_t owned)>& look) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const std::size_t columns = tierColumns(withApex);

    // A stack only a column the grid does not have would show -- an apex one
    // on a card that stops at unique -- does not earn its type a row.
    const std::vector<std::uint16_t> types = heldTypes(
        profile, [&](Rarity r) { return rarityIndex(r) < static_cast<int>(columns); });

    scrollList(ctx, scroll_, layout, contentHeightFor(types.size()));
    const Rect clip = listClip(layout, columns);

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(clip.x), static_cast<float>(clip.y), static_cast<float>(clip.w),
                static_cast<float>(clip.h));
    canvas.clip();

    std::optional<Pick> hovered;
    for (std::size_t row = 0; row < types.size(); ++row) {
        const std::uint16_t petalIndex = types[row];
        const double y =
            clip.y - scroll_.offset + kCellInsetY + static_cast<double>(row) * kGridPitch;
        if (y + kGridCell < clip.y || y > clip.bottom()) continue;
        // Each row RIGHT TO LEFT, as florr paints it: the oracle's
        // "owned/price" labels hang past a cell's right edge over the next
        // one, and painting that cell after it would cut the label off.
        for (std::size_t k = 0; k < columns; ++k) {
            const std::size_t column = columns - 1 - k;
            const Rarity rarity = static_cast<Rarity>(column);
            const Rect rect{clip.x + kCellInsetX + static_cast<double>(column) * kGridPitch, y,
                            kGridCell, kGridCell};
            const SlotCell cell = look(petalIndex, rarity, profile.stackCount(petalIndex, rarity));
            if (cell.count == 0) {
                // A tier the account holds none of: a flat square in the
                // shade. Not hoverable and not clickable.
                drawSlotPlate(canvas, ctx.sprites, rect, skin);
                continue;
            }
            const bool over = !cell.greyed && rect.contains(mouse) && clip.contains(mouse);
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
    return hovered;
}

std::size_t SlotTierGrid::rows(const Profile& profile, Rarity tier, std::size_t columns) {
    columns = std::max<std::size_t>(1, columns);
    const std::size_t types = heldTypes(profile, [&](Rarity r) { return r == tier; }).size();
    return (types + columns - 1) / columns;
}

std::optional<SlotTierGrid::Pick> SlotTierGrid::render(
    MenuContext& ctx, const SlotCardLayout& layout, const PanelSkin& skin, Rarity tier,
    std::size_t columns, double top,
    const std::function<SlotCell(std::uint16_t petalIndex, std::uint32_t owned)>& look) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    columns = std::max<std::size_t>(1, columns);

    const std::vector<std::uint16_t> types =
        heldTypes(profile, [&](Rarity r) { return r == tier; });
    const std::size_t rows = (types.size() + columns - 1) / columns;

    SlotCardLayout from = layout;
    from.listView.y = layout.panel.y + top;
    from.listView.h = std::max(0.0, layout.panel.bottom() - kListBottomPad - from.listView.y);
    scrollList(ctx, scroll_, from, contentHeightFor(rows));
    const Rect clip = listClip(from, columns);
    const double areaCentre = clip.x + clip.w * 0.5;

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(clip.x), static_cast<float>(clip.y), static_cast<float>(clip.w),
                static_cast<float>(clip.h));
    canvas.clip();

    std::optional<Pick> hovered;
    for (std::size_t row = 0; row < rows; ++row) {
        const double y =
            clip.y - scroll_.offset + kCellInsetY + static_cast<double>(row) * kGridPitch;
        if (y + kGridCell < clip.y || y > clip.bottom()) continue;
        const std::size_t first = row * columns;
        const std::size_t count = std::min(columns, types.size() - first);
        // Each row centred where a full row of the list would stand.
        const double rowWidth = static_cast<double>(count) * kGridPitch - (kGridPitch - kGridCell);
        const double startX = areaCentre - rowWidth * 0.5;
        for (std::size_t k = 0; k < count; ++k) {
            const std::uint16_t petalIndex = types[first + k];
            const Rect rect{startX + static_cast<double>(k) * kGridPitch, y, kGridCell, kGridCell};
            const SlotCell cell = look(petalIndex, profile.stackCount(petalIndex, tier));
            if (cell.count == 0) {
                drawSlotPlate(canvas, ctx.sprites, rect, skin);
                continue;
            }
            const bool under = rect.contains(mouse) && clip.contains(mouse);
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
    return hovered;
}

// ---------------------------------------------------------------------------
// florr's slot motions
// ---------------------------------------------------------------------------
//
// Read out of the trade window's draw (0x100849600) and the particle system
// it runs (0x100793cc0); the craft and oracle bodies use the same pieces.

namespace {

/// A petal growing into a slot, an outcome popping in, and a replaced tile
/// vanishing all ease at this rate; growing is done past kGrowDone.
constexpr double kMotionRate = 0.021400496636323946;
constexpr double kGrowDone = 0.99999;
/// The pulse on a fresh outcome runs down over this many ms: scale
/// 1 + 0.5 sin(pi v) and a turn of 0.1 sin(pi v) radians.
constexpr double kPulseMs = 200.0;
constexpr double kPulseScale = 0.5;
constexpr double kPulseTurn = 0.1;
/// A vanishing tile also runs on a clock: its progress gains dt / 300 a
/// frame on top of the ease, and it is gone past 0.9999.
constexpr double kVanishMs = 300.0;
constexpr double kVanishDone = 0.9999;
/// A grain: velocity U(-500, 500) on each axis, life 500..1000 ms, side
/// 2..5, angle 2..5 rad, spinning a turn a second; gravity 200 down, and drag
/// that keeps 95% of the velocity per 60 fps frame.
constexpr double kGrainSpeed = 500.0;
constexpr double kGrainLifeMs = 500.0;
constexpr double kGrainSize = 2.0;
constexpr double kGrainSizeSpread = 3.0;
constexpr double kGrainGravity = 200.0;
constexpr double kGrainDrag = 0.95;
constexpr std::size_t kMaxSlotGrains = 512;

double eased(double dtMs, double rate) { return 1.0 - std::exp(-rate * dtMs); }

} // namespace

int slotBurstGrains(Rarity rarity) {
    static constexpr std::array<int, 6> kGrains = {3, 4, 5, 7, 12, 25};
    // (florr makes a zero entry one; none of its entries is zero.)
    return kGrains[static_cast<std::size_t>(
        std::min<int>(rarityIndex(rarity), static_cast<int>(kGrains.size()) - 1))];
}

void SlotMotion::clear() {
    stopRoll();
    growKey_ = 0xFFFFFFFFu;
    grow_ = 0.0;
    pop_ = 1.0;
    pulse_ = 0.0;
    grains_.clear();
    vanishing_.clear();
    sceneKey_ = 0xFFFFFFFFu;
}

void SlotMotion::stepRoll(double dtMs, bool rolling, bool showing, double spinTarget,
                          double upRate, double downRate) {
    spin_ += ((rolling ? spinTarget : 0.0) - spin_) * eased(dtMs, rolling ? upRate : downRate);
    phase_ = std::fmod(phase_ + spin_ * dtMs / 1000.0, kTau);
    // The shake and the show share florr's menu rate.
    constexpr double kShowRate = 0.0133886130788526;
    shake_ += ((rolling ? 1.0 : 0.0) - shake_) * eased(dtMs, kShowRate);
    show_ += ((showing ? 1.0 : 0.0) - show_) * eased(dtMs, kShowRate);
}

void SlotMotion::drawGrowing(Canvas& canvas, const SpriteCache& sprites, Vec2 centre,
                             double side, double alpha, std::uint32_t key, double dtMs,
                             ItemTile tile) {
    if (key != growKey_) {
        growKey_ = key;
        grow_ = 0.0;
    }
    grow_ += (1.0 - grow_) * eased(dtMs, kMotionRate);
    const bool growing = grow_ < kGrowDone;
    tile.alpha = alpha * (growing ? clamp(grow_, 0.0, 1.0) : 1.0);
    drawSlotTile(canvas, sprites, centre, side * (growing ? grow_ : 1.0),
                 growing ? grow_ * -kTau : 0.0, tile);
}

void SlotMotion::startPop() {
    pop_ = 1.0;
    pulse_ = 1.0;
}

void SlotMotion::drawPopped(Canvas& canvas, const SpriteCache& sprites, Vec2 centre, double side,
                            double dtMs, ItemTile tile) {
    pop_ += (0.0 - pop_) * eased(dtMs, kMotionRate);
    double scale = 1.0;
    double turn = 0.0;
    if (pop_ > 1e-4) {
        tile.alpha *= clamp(1.0 - pop_, 0.0, 1.0);
        turn += kTau * pop_;
        scale *= 1.0 - pop_;
    }
    const double wave = std::sin(kPi * pulse_);
    scale *= 1.0 + kPulseScale * wave;
    turn += kPulseTurn * wave;
    pulse_ = std::max(0.0, pulse_ - dtMs / kPulseMs);
    if (scale <= 0.0) return;
    drawSlotTile(canvas, sprites, centre, side * scale, turn, tile);
}

void SlotMotion::vanish(Vec2 centre, double side, const ItemTile& tile) {
    Vanishing v;
    v.centre = centre;
    v.side = side;
    v.tile = tile;
    vanishing_.push_back(v);
}

void SlotMotion::burst(Vec2 at, Rarity rarity, int count, const SlotBurstShape& shape,
                       Vec2 carry) {
    for (int i = 0; i < count && grains_.size() < kMaxSlotGrains; ++i) {
        Grain g;
        g.position = at;
        g.velocity = Vec2{jitter() * kGrainSpeed * 2.0 - kGrainSpeed,
                          jitter() * (shape.riseTo + kGrainSpeed) - kGrainSpeed} +
                     carry;
        g.lifeMs = kGrainLifeMs + jitter() * kGrainLifeMs;
        g.size = kGrainSize + jitter() * kGrainSizeSpread;
        g.angle = shape.angleBase + jitter() * shape.angleSpread;
        g.color = rarityColor(rarity);
        grains_.push_back(g);
    }
}

void SlotMotion::drawGrains(Canvas& canvas, double dtMs) {
    // Drawn where they stand, then moved: a fresh grain first shows the frame
    // after it was thrown.
    for (const Grain& g : grains_) {
        canvas.save();
        canvas.setGlobalAlpha(static_cast<float>(clamp(g.alpha, 0.0, 1.0)));
        canvas.translate(static_cast<float>(g.position.x), static_cast<float>(g.position.y));
        canvas.rotate(static_cast<float>(g.angle));
        setFill(canvas, g.color);
        const float half = static_cast<float>(g.size * 0.5);
        canvas.fillRect(-half, -half, half * 2.0f, half * 2.0f);
        canvas.restore();
    }
    const double seconds = dtMs / 1000.0;
    const double keep = std::pow(kGrainDrag, 0.06 * dtMs);
    for (Grain& g : grains_) {
        g.position += g.velocity * seconds;
        g.velocity.x *= keep;
        g.velocity.y = g.velocity.y * keep + kGrainGravity * seconds;
        g.alpha -= dtMs / g.lifeMs;
        g.angle += kTau * seconds;
    }
    grains_.erase(std::remove_if(grains_.begin(), grains_.end(),
                                 [](const Grain& g) { return g.alpha <= 0.0; }),
                  grains_.end());
}

void SlotMotion::drawVanishing(Canvas& canvas, const SpriteCache& sprites, double dtMs) {
    for (Vanishing& v : vanishing_) {
        v.progress += (1.0 - v.progress) * eased(dtMs, kMotionRate);
        ItemTile tile = v.tile;
        tile.alpha *= clamp(1.0 - v.progress, 0.0, 1.0);
        const double side = v.side * (1.0 - v.progress);
        if (side > 0.0) drawSlotTile(canvas, sprites, v.centre, side, kTau * v.progress, tile);
        v.progress += dtMs / kVanishMs;
    }
    vanishing_.erase(std::remove_if(vanishing_.begin(), vanishing_.end(),
                                    [](const Vanishing& v) { return v.progress >= kVanishDone; }),
                     vanishing_.end());
}

void SlotMotion::drawSlotScene(Canvas& canvas, const SpriteCache& sprites,
                               const SlotCardLayout& card, const PanelSkin& skin,
                               double sinceClickMs, double dtMs, const ItemTile* shown,
                               std::uint32_t shownKey, const ItemTile* result,
                               std::uint32_t resultKey, const SlotBurstShape& shape) {
    // Swung out from the centre while the shake is in, and back as the
    // outcome shows; the spin turns the swing about the centre.
    constexpr double kSwingDepth = 50.0;
    constexpr double kSwingRate = 0.01;
    constexpr double kResultSide = 90.0;
    constexpr int kBurstMultiplier = 5;
    const double swing =
        kSwingDepth * shake_ * std::sin(kSwingRate * sinceClickMs) * (1.0 - show_);
    const Vec2 at = card.slot + Vec2::fromAngle(phase_ - kPi * 0.5, swing);

    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(clamp(1.0 - show_, 0.0, 1.0)));
    drawSlotPlate(canvas, sprites,
                  {at.x - kSlotCardSlot * 0.5, at.y - kSlotCardSlot * 0.5, kSlotCardSlot,
                   kSlotCardSlot},
                  skin);
    canvas.restore();
    drawGrains(canvas, dtMs);

    const std::uint32_t key = result != nullptr ? resultKey
                              : shown != nullptr ? shownKey
                                                 : 0xFFFFFFFFu;
    if (key != sceneKey_) {
        if (sceneKey_ != 0xFFFFFFFFu) vanish(sceneAt_, sceneSide_, sceneTile_);
        if (result != nullptr) {
            startPop();
            burst(card.slot, result->rarity, kBurstMultiplier * slotBurstGrains(result->rarity),
                  shape);
        }
        sceneKey_ = key;
    }
    if (result != nullptr) {
        drawPopped(canvas, sprites, card.slot, kResultSide, dtMs, *result);
        sceneAt_ = card.slot;
        sceneSide_ = kResultSide;
        sceneTile_ = *result;
    } else if (shown != nullptr) {
        drawGrowing(canvas, sprites, at, kSlotCardSlot, 1.0, shownKey, dtMs, *shown);
        sceneAt_ = at;
        sceneSide_ = kSlotCardSlot;
        sceneTile_ = *shown;
    }
}

} // namespace flix
