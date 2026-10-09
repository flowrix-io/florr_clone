// The trader.
//
// What the craft key opens while the flower stands at a trader NPC (see
// shared/game/npc.h): one petal in, one coin (kTraderCoinPetal) of the same
// tier out, once a day.
//
// It is drawn on the slot card every craft-key card shares (menus.h) -- the
// card is ITS reference shot's (Image_Before_trade.webp and
// After-trade_trade_menu.webp) -- in the flower yellow. There is no price to
// be short of, so a stack is counted the way the inventory counts one ("x5"
// in the corner, nothing on a lone petal); and the grid runs on to apex,
// because every tier trades.
//
// One trade a day (kTraderCooldownMillis): while the account waits, the line
// turns red and says how long, and every stack sits on grey -- the second
// reference shot. A petal petals.json marks `"tradable": false` sits on grey
// all the time: it is still the account's, the trader just will not take it.
//
// The coin arrives the way the oracle's upgrade does, the way loot lands on
// the ground (SlotFlourish). There is no roll to wait on and nothing is made,
// so there is no pulse before it -- the petal handed over waits in the slot
// until the trader answers.

#include <algorithm>
#include <cstdint>
#include <string>

#include "client/ui/item_tile.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "shared/game/config.h"
#include "shared/game/npc.h"

namespace flix {

using namespace flix::ui;

namespace {

constexpr const char* kLine = "You can trade a petal for a coin of the same rarity";

/// How long a handed-over petal waits in the slot for the trader's answer
/// before the slot gives up on it. The trade resolved server-side either way,
/// and the profile will say how.
constexpr double kTradeTimeoutSeconds = 8.0;
constexpr double kRefusalSeconds = 3.0;

bool tradable(std::uint16_t petalIndex) {
    return knownPetal(petalIndex) && content().petal(petalIndex).tradable;
}

} // namespace

Rect TradePanel::bounds(int w, int h) { return slotCardBounds(true, w, h); }

void TradePanel::reset() {
    grid_.reset();
    flourish_.clear();
    stagedPetal_ = kNoPetal;
    phase_ = Phase::Idle;
    refusal_.clear();
}

bool TradePanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
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
            phase_ = Phase::Result;
            phaseStarted_ = now;
            resultPetal_ = outcome.receivedIndex;
            resultRarity_ = outcome.rarity;
            flourish_.land(now, resultRarity_);
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

    const SlotCardLayout card = drawSlotCard(canvas, ctx.bounds, kTraderSkin, "Trade", mouse);
    const Rect panel = card.panel;

    // --- the slot ----------------------------------------------------------
    flourish_.drawGrains(canvas, panel, card.slot, dt);
    drawSlotPlate(canvas, ctx.sprites, card.slotRect, kTraderSkin);
    if (phase_ == Phase::Result && knownPetal(resultPetal_)) {
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = resultRarity_;
        tile.timeSeconds = now;
        flourish_.drawLanded(canvas, ctx.sprites, card.slot, kSlotCardSlot * dropPulse(now), now,
                             tile);
    } else {
        // One petal, so no badge: the slot holds exactly what one trade takes.
        const std::uint16_t shown = phase_ == Phase::Trading ? offeredPetal_ : stagedPetal_;
        const Rarity shownRarity = phase_ == Phase::Trading ? offeredRarity_ : stagedRarity_;
        if (knownPetal(shown)) {
            ItemTile tile;
            tile.petalIndex = shown;
            tile.rarity = shownRarity;
            tile.timeSeconds = now;
            drawSlotTile(canvas, ctx.sprites, card.slot, kSlotCardSlot * dropPulse(now), 0.0,
                         tile);
        }
    }

    if (!refusal_.empty() && now < refusalUntil_) {
        drawSlotRefusal(canvas, card, refusal_);
    } else {
        refusal_.clear();
    }

    // --- trade button ------------------------------------------------------
    // The colour of the tier the coin will come back at once something is
    // staged -- the forge's rule.
    const bool canTrade = !waiting && phase_ == Phase::Idle && tradable(stagedPetal_);
    drawSlotButton(canvas, card.button, "Trade",
                   canTrade ? std::optional<std::uint32_t>(rarityColor(stagedRarity_))
                            : std::nullopt,
                   card.button.contains(mouse));

    if (waiting) {
        drawSlotLine(canvas, card, traderCooldownText(cooldown), kSlotCardWaitInk);
    } else {
        drawSlotLine(canvas, card, kLine);
    }

    // --- the grid ----------------------------------------------------------
    // On grey, and not clickable, while the trader is not taking trades and
    // for a petal it never takes. The petal and its count still show.
    const std::optional<SlotGrid::Pick> hovered = grid_.render(
        ctx, card, kTraderSkin, true,
        [&](std::uint16_t petalIndex, Rarity rarity, std::uint32_t owned) {
            SlotCell cell;
            cell.count = owned;
            // The staged petal is in the slot, not in its stack.
            if (petalIndex == stagedPetal_ && rarity == stagedRarity_ && owned > 0) --cell.count;
            cell.greyed = waiting || !tradable(petalIndex);
            // A lone petal carries no badge, as in the inventory.
            if (cell.count > 1) cell.badge = "x" + stackCountText(cell.count);
            return cell;
        });

    // --- input -------------------------------------------------------------
    // On press, as the forge and the oracle answer.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        stagedPetal_ = kNoPetal;
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (card.close.contains(mouse) && ctx.pressed()) return false;

    // The coin sits there until it is dismissed, and the press that dismisses
    // it does nothing else.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }

    if (card.button.contains(mouse)) {
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

    if (phase_ == Phase::Idle && card.slotRect.contains(mouse)) {
        stagedPetal_ = kNoPetal;
        return true;
    }

    if (hovered && phase_ == Phase::Idle) {
        // One petal a trade, so a click REPLACES what was staged.
        stagedPetal_ = hovered->petalIndex;
        stagedRarity_ = hovered->rarity;
        refusal_.clear();
    }
    return true;
}

} // namespace flix
