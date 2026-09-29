// The trader.
//
// What the craft key opens while the flower stands at a trader NPC (see
// shared/game/npc.h): one petal in, one coin (kTraderCoinPetal) of the same
// tier out, once a day.
//
// The card is laid out against the reference shots (Image_Before_trade.webp
// and After-trade_trade_menu.webp), which put the trade on the oracle's card
// to the unit -- the 70-unit slot 101 left of the centre line, the button 129
// right of it, the one line of text at 318, the same grid on the same pitch --
// in the flower yellow where the oracle is slate. So every figure below is
// menu_oracle.cpp's. What differs is what the cells say: there is no price to
// be short of, so a stack is counted the way the inventory counts one ("x5" in
// the corner, nothing on a lone petal); and the grid runs to apex, because
// every tier trades -- two columns past the reference's super, as the
// oracle's card is one past it.
//
// One trade a day (kTraderCooldownMillis): while the account waits, the line
// turns red and says how long, and every stack sits on grey -- the second
// reference shot. A petal petals.json marks `"tradable": false` sits on grey
// all the time: it is still the account's, the trader just will not take it.
//
// The coin arrives the way the oracle's upgrade does, which is the way loot
// lands on the ground: sliding into the slot, unwinding, and throwing a burst
// of its tier's grains. There is no roll to wait on and nothing is made, so
// there is no pulse before it -- the petal handed over waits in the slot until
// the trader answers.

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
#include "shared/game/npc.h"

namespace flix {

using namespace flix::ui;

namespace {

// -- the card: the oracle's, off the same reference -----------------------------

constexpr double kGridCell = 60.0;
constexpr double kGridGap = 10.0;
constexpr double kGridLeft = 25.0;
constexpr double kGridRight = 42.0;
/// Every tier, apex included: all of them trade.
constexpr std::size_t kTierColumns = static_cast<std::size_t>(kRarityCount);
constexpr double kGridTop = 339.0;
constexpr double kGridPadding = 10.0;
constexpr double kCardBorder = 6.0;
constexpr double kCardHeight = 707.0;
constexpr double kWheelStep = 100.0;
constexpr double kThumbWidth = 8.0;
constexpr double kThumbRight = 20.0;
constexpr double kThumbMinHeight = 20.0;

constexpr double kSlotSide = 70.0;
constexpr double kRowCentreY = 181.0;
constexpr double kSlotOffsetX = -101.0;
constexpr double kTradeOffsetX = 129.0;
constexpr double kTradeWidth = 64.0;
constexpr double kTradeHeight = 35.0;
constexpr double kTradeRim = 4.0;
constexpr double kTradeRadius = 8.0;
constexpr double kLineY = 318.0;
constexpr const char* kLine = "You can trade a petal for a coin of the same rarity";

/// The idle Trade button's greys, the reference's -- the same pair a grey cell
/// wears.
constexpr std::uint32_t kTradeIdleFill = 0x777777u;
constexpr std::uint32_t kTradeIdleBorder = 0x606060u;
constexpr std::uint32_t kRefusalColor = 0xFF6B6Bu;
constexpr std::uint32_t kCooldownColor = 0xED706Bu;
constexpr double kSoftStroke = 0.6;

/// How long a handed-over petal waits in the slot for the trader's answer
/// before the slot gives up on it. The trade resolved server-side either way,
/// and the profile will say how.
constexpr double kTradeTimeoutSeconds = 8.0;
constexpr double kRefusalSeconds = 3.0;

// -- the landing: the oracle's -------------------------------------------------

constexpr int kLandingBurstGrains = kDropBurstCount * 2;
constexpr std::size_t kMaxGrains = 64;
constexpr double kGrainAlpha = 0.6;
constexpr double kFramesPerSecond = 60.0;
constexpr double kGrainScale = kSlotSide / kItemTileDesign;

struct GridCell {
    Rect rect;
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    std::uint32_t count = 0;
    bool tradable = false;
};

bool knownPetal(std::uint16_t petalIndex) {
    return petalIndex != kNoPetal && petalIndex < content().petalCount();
}

bool tradable(std::uint16_t petalIndex) {
    return knownPetal(petalIndex) && content().petal(petalIndex).tradable;
}

/// Particle jitter, as the oracle's slot has: nobody else sees this slot.
double jitter() {
    static std::uint32_t state = 0x7F4A7C15u;
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<double>(state % 100000u) / 100000.0;
}

/// Draws `tile` into a square of `side` centred on `centre`, turned by
/// `rotation`. The transform is set before the tile opens a path and restored
/// after it closes the last, so both backends see the same geometry.
void drawTileAt(Canvas& canvas, const SpriteCache& sprites, Vec2 centre, double side,
                double rotation, const ItemTile& tile) {
    canvas.save();
    canvas.translate(static_cast<float>(centre.x), static_cast<float>(centre.y));
    if (rotation != 0.0) canvas.rotate(static_cast<float>(rotation));
    drawItemTile(canvas, sprites, {-side * 0.5, -side * 0.5, side, side}, tile);
    canvas.restore();
}

} // namespace

double TradePanel::preferredHeight() { return kCardHeight; }

double TradePanel::preferredWidth() {
    return kGridLeft + static_cast<double>(kTierColumns) * (kGridCell + kGridGap) - kGridGap +
           kGridRight;
}

void TradePanel::reset() {
    scroll_ = {};
    stagedPetal_ = kNoPetal;
    phase_ = Phase::Idle;
    refusal_.clear();
    grains_.clear();
}

void TradePanel::throwBurst(Rarity rarity) {
    for (int i = 0; i < kLandingBurstGrains && grains_.size() < kMaxGrains; ++i) {
        const double angle = jitter() * kTau;
        const double pace = (kDropBurstSpeed + jitter() * kDropBurstSpeedSpread) *
                            kFramesPerSecond * kGrainScale;
        Grain grain;
        grain.position = {(jitter() - 0.5) * 4.0, (jitter() - 0.5) * 4.0};
        grain.velocity = Vec2::fromAngle(angle, pace);
        grain.lifeSeconds = grain.maxLifeSeconds =
            (kDropBurstLifeMs + jitter() * kDropBurstLifeSpreadMs) / 1000.0;
        grain.size = (kDropBurstSize + jitter() * kDropBurstSizeSpread) * kGrainScale;
        grain.rotation = jitter() * kTau;
        grain.color = rarityColor(rarity);
        grains_.push_back(grain);
    }
}

bool TradePanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    const double dt = std::max(0.0, ctx.dt);

    // The account's wait for its next trade, counted down on this client's
    // clock from what the last profile said.
    const double cooldown = ctx.net.traderCooldownRemainingMillis();
    const bool waiting = cooldown > 0.0;

    // A result the server sent while this face of the menu was not showing
    // still has to land, so it is read here rather than in the click.
    TradeOutcome& outcome = ctx.net.tradeOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        if (outcome.success && knownPetal(outcome.receivedIndex)) {
            // The coin arrives: in from a drop's distance, unwinding a drop's
            // spin, with a burst of its tier's colour from the slot.
            phase_ = Phase::Result;
            phaseStarted_ = now;
            resultPetal_ = outcome.receivedIndex;
            resultRarity_ = outcome.rarity;
            landFrom_ = Vec2::fromAngle(jitter() * kTau,
                                        (kDropLandNear + jitter() * kDropLandSpread) * kGrainScale);
            landSpin_ = (jitter() - 0.5) * kPi;
            throwBurst(resultRarity_);
        } else if (!outcome.success) {
            // Refused: nothing left the inventory, so what was offered goes
            // straight back into the slot, with the reason under it.
            if (phase_ == Phase::Trading) {
                stagedPetal_ = offeredPetal_;
                stagedRarity_ = offeredRarity_;
                phase_ = Phase::Idle;
            }
            refusal_ = outcome.reason.empty() ? "The trader refused." : outcome.reason;
            refusalUntil_ = now + kRefusalSeconds;
        }
    }
    if (phase_ == Phase::Trading && now - phaseStarted_ >= kTradeTimeoutSeconds) {
        phase_ = Phase::Idle;
    }

    // Nothing can be staged while the trader is not taking trades, and the
    // slot cannot hold a petal the account no longer has -- but never while a
    // trade is out: that petal is the server's, and a profile landing a frame
    // ahead of the result would empty the slot under it.
    if (phase_ == Phase::Idle &&
        (waiting || (knownPetal(stagedPetal_) &&
                     profile.stackCount(stagedPetal_, stagedRarity_) == 0))) {
        stagedPetal_ = kNoPetal;
    }

    panelCard(canvas, panel, kTraderSkin, kCardBorder);
    panelTitle(canvas, panel, "Trade");
    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, closeRect.contains(mouse));

    const double centreX = panel.x + panel.w * 0.5;
    const double rowY = panel.y + kRowCentreY;
    const Vec2 slotCentre{centreX + kSlotOffsetX, rowY};
    const Rect slotRect{slotCentre.x - kSlotSide * 0.5, slotCentre.y - kSlotSide * 0.5, kSlotSide,
                        kSlotSide};

    // --- grains -----------------------------------------------------------
    // Under the tile, as a drop's glitter lies under the drop, and clipped to
    // the card: the burst is the card's.
    for (Grain& grain : grains_) {
        grain.position += grain.velocity * dt;
        grain.lifeSeconds -= dt;
    }
    grains_.erase(std::remove_if(grains_.begin(), grains_.end(),
                                 [](const Grain& g) { return g.lifeSeconds <= 0.0; }),
                  grains_.end());
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

    // --- the slot ----------------------------------------------------------
    {
        ItemTile plate;
        plate.empty = true;
        plate.emptyFill = kTraderSkin.border;
        plate.emptyBorder = kTraderSkin.border;
        drawItemTile(canvas, ctx.sprites, slotRect, plate);
    }
    if (phase_ == Phase::Result && knownPetal(resultPetal_)) {
        // The landing, eased out over a drop's 400 ms, settling into the
        // breath it then keeps.
        const double t = clamp((now - phaseStarted_) / kDropLandSeconds, 0.0, 1.0);
        const double eased = 1.0 - (1.0 - t) * (1.0 - t);
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = resultRarity_;
        tile.timeSeconds = now;
        drawTileAt(canvas, ctx.sprites, slotCentre + landFrom_ * (1.0 - eased),
                   kSlotSide * dropPulse(now), landSpin_ * (1.0 - eased), tile);
    } else {
        // One petal, so no badge: the slot holds exactly what one trade takes.
        const std::uint16_t shown = phase_ == Phase::Trading ? offeredPetal_ : stagedPetal_;
        const Rarity shownRarity = phase_ == Phase::Trading ? offeredRarity_ : stagedRarity_;
        if (knownPetal(shown)) {
            ItemTile tile;
            tile.petalIndex = shown;
            tile.rarity = shownRarity;
            tile.timeSeconds = now;
            drawTileAt(canvas, ctx.sprites, slotCentre, kSlotSide * dropPulse(now), 0.0, tile);
        }
    }

    if (!refusal_.empty() && now < refusalUntil_) {
        TextStyle style = panelLabel(12.0, Align::Centre, Baseline::Top);
        style.fill = kRefusalColor;
        outlinedText(canvas, refusal_, slotCentre.x, slotRect.bottom() + 10.0, style, kSoftStroke);
    } else {
        refusal_.clear();
    }

    // --- trade button ------------------------------------------------------
    // The reference's grey pill at rest, and the colour of the tier the coin
    // will come back at once something is staged -- the forge's rule.
    const Rect tradeRect{centreX + kTradeOffsetX - kTradeWidth * 0.5, rowY - kTradeHeight * 0.5,
                         kTradeWidth, kTradeHeight};
    const bool canTrade = !waiting && phase_ == Phase::Idle && tradable(stagedPetal_);
    const std::uint32_t tradeFill = canTrade ? rarityColor(stagedRarity_) : kTradeIdleFill;
    const std::uint32_t tradeBorder = canTrade ? darken(tradeFill, 0.25) : kTradeIdleBorder;
    inlaid(canvas, tradeRect,
           tradeRect.contains(mouse) ? lighten(tradeFill, 0.15) : tradeFill, tradeBorder, kTradeRim,
           kTradeRadius);
    outlinedText(canvas, "Trade", tradeRect.x + tradeRect.w * 0.5, tradeRect.y + tradeRect.h * 0.5,
                 panelLabel(16.0, Align::Centre, Baseline::Middle), kSoftStroke);

    if (waiting) {
        TextStyle style = panelLabel(16.0, Align::Centre, Baseline::Middle);
        style.fill = kCooldownColor;
        outlinedText(canvas, traderCooldownText(cooldown), centreX, panel.y + kLineY, style,
                     kSoftStroke);
    } else {
        outlinedText(canvas, kLine, centreX, panel.y + kLineY,
                     panelLabel(16.0, Align::Centre, Baseline::Middle), kSoftStroke);
    }

    // --- the grid ----------------------------------------------------------
    // Rows are the petal types the account owns, from the UNDEDUCTED profile
    // so a stack staged down to nothing keeps its row; columns are every tier.
    std::vector<std::uint16_t> types;
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.count == 0) continue;
        if (std::find(types.begin(), types.end(), stack.petalIndex) == types.end()) {
            types.push_back(stack.petalIndex);
        }
    }
    std::sort(types.begin(), types.end());

    const double inventoryTop = panel.y + kGridTop;
    const Rect view{panel.x + kCardBorder, inventoryTop, panel.w - kCardBorder * 2,
                    std::max(0.0, panel.bottom() - kCardBorder - inventoryTop)};
    const double startX = panel.x + kGridLeft;

    std::vector<GridCell> cells;
    double y = kGridPadding;
    for (const std::uint16_t petalIndex : types) {
        const bool takes = tradable(petalIndex);
        for (std::size_t column = 0; column < kTierColumns; ++column) {
            const Rarity rarity = static_cast<Rarity>(column);
            std::uint32_t count = profile.stackCount(petalIndex, rarity);
            // The staged petal is in the slot, not in its stack.
            if (petalIndex == stagedPetal_ && rarity == stagedRarity_ && count > 0) --count;
            cells.push_back({Rect{startX + static_cast<double>(column) * (kGridCell + kGridGap), y,
                                  kGridCell, kGridCell},
                             petalIndex, rarity, count, takes});
        }
        y += kGridCell + kGridGap;
    }
    const double contentHeight = y - kGridGap + kGridPadding;

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = view.h;
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

    int hovered = -1;
    for (std::size_t i = 0; i < cells.size(); ++i) {
        const GridCell& cell = cells[i];
        const Rect rect{cell.rect.x, view.y - scroll_.offset + cell.rect.y, cell.rect.w,
                        cell.rect.h};
        if (rect.bottom() < view.y || rect.y > view.bottom()) continue;

        if (cell.count == 0) {
            // A tier the account holds none of: a flat square in the border's
            // yellow.
            ItemTile blank;
            blank.empty = true;
            blank.emptyFill = kTraderSkin.border;
            blank.emptyBorder = kTraderSkin.border;
            drawItemTile(canvas, ctx.sprites, rect, blank);
            continue;
        }
        // On grey, and not clickable, while the trader is not taking trades
        // and for a petal it never takes. The petal and its count still show.
        const bool offerable = !waiting && cell.tradable;
        if (offerable && rect.contains(mouse) && view.contains(mouse)) {
            hovered = static_cast<int>(i);
        }

        ItemTile tile;
        tile.petalIndex = cell.petalIndex;
        tile.rarity = cell.rarity;
        tile.hovered = hovered == static_cast<int>(i);
        tile.greyed = !offerable;
        if (cell.count > 1) tile.badge = "x" + stackCountText(cell.count);
        tile.timeSeconds = now;
        drawItemTile(canvas, ctx.sprites, rect, tile);
    }
    canvas.restore();

    if (contentHeight > view.h && view.h > 0.0) {
        const double thumbHeight = std::max(kThumbMinHeight, view.h * view.h / contentHeight);
        const double travel = contentHeight - view.h;
        const double thumbY =
            view.y + clamp(scroll_.offset / travel, 0.0, 1.0) * (view.h - thumbHeight);
        fillRound(canvas,
                  {panel.right() - kThumbRight - kThumbWidth, thumbY, kThumbWidth, thumbHeight},
                  kThumbWidth * 0.5, kTraderSkin.accent);
    }

    // --- input -------------------------------------------------------------
    // On press, as the forge and the oracle answer.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        stagedPetal_ = kNoPetal;
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (closeRect.contains(mouse) && ctx.pressed()) return false;

    // The coin sits there until it is dismissed, and the press that dismisses
    // it does nothing else.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }

    if (tradeRect.contains(mouse)) {
        if (canTrade) {
            phase_ = Phase::Trading;
            phaseStarted_ = now;
            offeredPetal_ = stagedPetal_;
            offeredRarity_ = stagedRarity_;
            refusal_.clear();
            ctx.net.requestTrade(stagedPetal_, stagedRarity_);
            // Handed over: the slot draws the offer from here, and a refusal
            // is what puts it back.
            stagedPetal_ = kNoPetal;
        }
        return true;
    }

    if (phase_ == Phase::Idle && slotRect.contains(mouse)) {
        stagedPetal_ = kNoPetal;
        return true;
    }

    if (hovered >= 0 && phase_ == Phase::Idle) {
        // One petal a trade, so a click REPLACES what was staged.
        const GridCell& cell = cells[static_cast<std::size_t>(hovered)];
        stagedPetal_ = cell.petalIndex;
        stagedRarity_ = cell.rarity;
        refusal_.clear();
    }
    return true;
}

} // namespace flix
