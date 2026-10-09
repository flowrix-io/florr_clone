// The oracle.
//
// What the craft key opens while the flower stands at an oracle NPC (see
// shared/game/npc.h). The forge gambles five petals on a roll; the oracle
// takes a fixed price -- oracleCraftCost(), a table that runs from 7 commons
// to 1012 uniques -- and the upgrade is certain.
//
// It is drawn on the slot card every craft-key card shares (menus.h), in the
// slate of its reference shot (oracle_screenshot_menu.png): one slot and the
// Craft button beside it, one line of text, and the grid, where every cell
// carries "owned/price" and a stack that cannot yet pay its column's price
// sits on a grey plate. The reference grid stops at super; this one keeps the
// unique column, because unique -> apex has a price here.
//
// One upgrade per craft, and one craft per half hour (kOracleCooldownMillis):
// while the account waits, the line of text turns red and says how long, and
// every stack in the grid sits on grey with its plain count, as the reference's
// second shot (oracle_screenshot_cooldown.png) has it.
//
// No spin. A roll is something to watch resolve; a purchase is not. The staged
// petal breathes the way a drop lying on the ground does, the breath swells
// while the oracle works, and the upgrade LANDS in the slot exactly as loot
// lands on the ground (SlotFlourish).

#include <algorithm>
#include <cmath>
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

constexpr const char* kLine = "The Oracle will guarantee a craft... for the right price.";

/// How long the oracle works before the upgrade may land. Long enough for the
/// swell to read; a server that answers sooner is held until it has run.
constexpr double kPulseSeconds = 1.4;
/// The breath swells from a drop's own 3% to this, and quickens from a drop's
/// 10 rad/s to this many times that, both over the pulse. An ease-in, so it
/// starts as the drop it is and builds.
constexpr double kPulsePeakAmount = 0.16;
constexpr double kPulsePeakRateScale = 2.4;
/// Grains a second the slot throws at the height of the pulse -- a drop's own
/// shimmer rate. The shimmer ramps with the swell, so the first moments of the
/// pulse are as quiet as a drop at rest.
constexpr double kPulseGrainRate = 36.0;
/// A pulse that has run out holds at its peak waiting on the server. One that
/// never hears back drops to idle after this: the craft resolved server-side
/// either way, and the profile will say how.
constexpr double kCraftTimeoutSeconds = 8.0;
/// How long a refusal stays under the slot.
constexpr double kRefusalSeconds = 3.0;

} // namespace

Rect OraclePanel::bounds(int w, int h) { return slotCardBounds(false, w, h); }

void OraclePanel::reset() {
    grid_.reset();
    flourish_.clear();
    stagedPetal_ = kNoPetal;
    crafts_ = 0;
    phase_ = Phase::Idle;
    resultPending_ = false;
    refusal_.clear();
}

void OraclePanel::stage(const Profile& profile, std::uint16_t petalIndex, Rarity rarity) {
    const int cost = oracleCraftCost(rarity);
    if (cost <= 0) return;
    if (profile.stackCount(petalIndex, rarity) < static_cast<std::uint32_t>(cost)) return;
    // One upgrade, so a click REPLACES what was staged rather than adding to
    // it: there is only ever one price in the slot.
    stagedPetal_ = petalIndex;
    stagedRarity_ = rarity;
    crafts_ = 1;
    // Whatever was refused, the player has moved on from it.
    refusal_.clear();
}

bool OraclePanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    const double dt = std::max(0.0, ctx.dt);

    const auto removeCraft = [this]() {
        crafts_ = 0;
        stagedPetal_ = kNoPetal;
    };
    // The account's wait for its next craft, counted down on this client's
    // clock from what the last profile said.
    const double cooldown = ctx.net.oracleCooldownRemainingMillis();
    const bool waiting = cooldown > 0.0;
    const auto land = [this, now]() {
        phase_ = Phase::Result;
        phaseStarted_ = now;
        resultPending_ = false;
        flourish_.land(now, resultRarity_);
    };

    // A result the server sent while this face of the menu was not showing
    // still has to land, so it is read here rather than in the click.
    OracleOutcome& outcome = ctx.net.oracleOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        if (outcome.success) {
            resultPetal_ = outcome.petalIndex;
            resultRarity_ = outcome.rarity;
            resultCount_ = outcome.crafted;
            // Mid-pulse it is only recorded -- the pulse owns when it lands.
            if (phase_ == Phase::Pulsing && now - phaseStarted_ < kPulseSeconds) {
                resultPending_ = true;
            } else {
                land();
            }
        } else {
            // Refused: nothing left the inventory, so what was offered goes
            // straight back into the slot, with the reason under it.
            if (phase_ == Phase::Pulsing) {
                stagedPetal_ = offeredPetal_;
                stagedRarity_ = offeredRarity_;
                crafts_ = offeredCrafts_;
                phase_ = Phase::Idle;
            }
            refusal_ = outcome.reason.empty() ? "The oracle refused." : outcome.reason;
            refusalUntil_ = now + kRefusalSeconds;
        }
    }

    // Nothing can be staged while the oracle is not taking crafts.
    if (waiting && phase_ == Phase::Idle) removeCraft();

    // The staging area cannot outlive the petals behind it -- but never while
    // the pulse runs: those are already the server's, and a profile landing a
    // frame ahead of the result would empty the slot under its own animation.
    if (phase_ != Phase::Pulsing && knownPetal(stagedPetal_)) {
        const int cost = oracleCraftCost(stagedRarity_);
        const int affordable =
            cost > 0 ? static_cast<int>(profile.stackCount(stagedPetal_, stagedRarity_) /
                                        static_cast<std::uint32_t>(cost))
                     : 0;
        if (affordable < crafts_) {
            crafts_ = affordable;
            if (crafts_ <= 0) stagedPetal_ = kNoPetal;
        }
    }

    const SlotCardLayout card = drawSlotCard(canvas, ctx.bounds, kOracleSkin, "Oracle", mouse);
    const Rect panel = card.panel;

    // --- the pulse ---------------------------------------------------------
    // Idle and on a result the slot breathes exactly as a drop on the ground
    // does. While the oracle works the breath swells and quickens; its PHASE is
    // the integral of the quickening rate, so the beat speeds up smoothly
    // rather than jumping every time the rate is re-read.
    double breath = dropPulse(now);
    if (phase_ == Phase::Pulsing) {
        const double elapsed = now - phaseStarted_;
        const double u = clamp(elapsed / kPulseSeconds, 0.0, 1.0);
        const double eased = u * u;
        const double rateGain = kDropPulseRate * (kPulsePeakRateScale - 1.0);
        const double ramp = std::min(elapsed, kPulseSeconds);
        const double phase = kDropPulseRate * elapsed +
                             rateGain * (ramp * ramp / (2.0 * kPulseSeconds) +
                                         std::max(0.0, elapsed - kPulseSeconds));
        const double amount = kDropPulseAmount + (kPulsePeakAmount - kDropPulseAmount) * eased;
        breath = 1.0 + std::sin(phase) * amount;

        // The shimmer, building with the swell.
        flourish_.shimmer(offeredRarity_, kPulseGrainRate * eased, dt);

        if (elapsed >= kPulseSeconds && resultPending_) {
            land();
        } else if (elapsed >= kCraftTimeoutSeconds) {
            phase_ = Phase::Idle;
        }
    }

    // --- the slot ----------------------------------------------------------
    // Under the tile, as a drop's glitter lies under the drop.
    flourish_.drawGrains(canvas, panel, card.slot, dt);
    drawSlotPlate(canvas, ctx.sprites, card.slotRect, kOracleSkin);
    if (phase_ == Phase::Result && knownPetal(resultPetal_)) {
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = resultRarity_;
        if (resultCount_ > 1) tile.badge = "x" + std::to_string(resultCount_);
        tile.timeSeconds = now;
        flourish_.drawLanded(canvas, ctx.sprites, card.slot, kSlotCardSlot * breath, now, tile);
    } else {
        const std::uint16_t shown = phase_ == Phase::Pulsing ? offeredPetal_ : stagedPetal_;
        const Rarity shownRarity = phase_ == Phase::Pulsing ? offeredRarity_ : stagedRarity_;
        const int shownCrafts = phase_ == Phase::Pulsing ? offeredCrafts_ : crafts_;
        if (knownPetal(shown)) {
            ItemTile tile;
            tile.petalIndex = shown;
            tile.rarity = shownRarity;
            // The badge counts PETALS, the way a stack is counted everywhere
            // else: this is how many of them the oracle is being handed.
            tile.badge = "x" + std::to_string(shownCrafts * oracleCraftCost(shownRarity));
            tile.timeSeconds = now;
            drawSlotTile(canvas, ctx.sprites, card.slot, kSlotCardSlot * breath, 0.0, tile);
        }
    }

    // A refusal, under the slot, for as long as it lasts. The reference has no
    // line here; the only thing that ever puts one there is the oracle saying
    // no, which is worth saying where the player is looking.
    if (!refusal_.empty() && now < refusalUntil_) {
        drawSlotRefusal(canvas, card, refusal_);
    } else {
        refusal_.clear();
    }

    // --- craft button ------------------------------------------------------
    // The reference's grey pill at rest, and the colour of the tier being
    // bought once there is something to buy -- the forge's rule, so the faces
    // of the menu answer "is anything staged" the same way.
    const bool canCraft =
        !waiting && phase_ == Phase::Idle && knownPetal(stagedPetal_) && crafts_ > 0;
    const Rarity nextRarity = upgradeRarity(stagedRarity_);
    const bool tinted = knownPetal(stagedPetal_) && nextRarity != stagedRarity_;
    drawSlotButton(canvas, card.button, "Craft",
                   tinted ? std::optional<std::uint32_t>(rarityColor(nextRarity)) : std::nullopt,
                   card.button.contains(mouse));

    // The line says how long to wait while there is a wait, in red.
    if (waiting) {
        drawSlotLine(canvas, card, oracleCooldownText(cooldown), kSlotCardWaitInk);
    } else {
        drawSlotLine(canvas, card, kLine);
    }

    // --- the grid ----------------------------------------------------------
    // Every cell says "owned/price". Held but short of the column's price: on
    // a grey plate, and not clickable -- the petal keeps its colours, and the
    // label still says how far short, "4/19" being the reason to go farm.
    // While the oracle is not taking crafts, EVERY stack is on grey and says
    // only how many there are: there is no price to be short of until the
    // wait is over.
    const std::uint32_t held =
        knownPetal(stagedPetal_)
            ? static_cast<std::uint32_t>(std::max(0, crafts_)) *
                  static_cast<std::uint32_t>(oracleCraftCost(stagedRarity_))
            : 0u;
    const std::optional<SlotGrid::Pick> hovered = grid_.render(
        ctx, card, kOracleSkin, false,
        [&](std::uint16_t petalIndex, Rarity rarity, std::uint32_t owned) {
            SlotCell cell;
            cell.count = owned;
            if (petalIndex == stagedPetal_ && rarity == stagedRarity_) {
                cell.count = owned > held ? owned - held : 0;
            }
            const std::uint32_t price =
                static_cast<std::uint32_t>(std::max(1, oracleCraftCost(rarity)));
            cell.greyed = waiting || cell.count < price;
            cell.badge = waiting ? "x" + stackCountText(cell.count)
                                 : stackCountText(cell.count) + "/" + std::to_string(price);
            cell.badgeCentred = true;
            return cell;
        });

    // --- input -------------------------------------------------------------
    // On press, as the forge answers: a press that starts on a cell and
    // drifts off must not still fire.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        removeCraft();
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (card.close.contains(mouse) && ctx.pressed()) return false;

    // The upgrade sits there until it is dismissed, and the press that
    // dismisses it does nothing else.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }

    if (card.button.contains(mouse)) {
        if (canCraft) {
            phase_ = Phase::Pulsing;
            phaseStarted_ = now;
            resultPending_ = false;
            offeredPetal_ = stagedPetal_;
            offeredRarity_ = stagedRarity_;
            offeredCrafts_ = crafts_;
            refusal_.clear();
            ctx.net.requestOracleCraft(stagedPetal_, stagedRarity_);
            // Handed over: the slot draws the offer's copy from here, and a
            // refusal is what puts it back.
            stagedPetal_ = kNoPetal;
            crafts_ = 0;
        }
        return true;
    }

    if (phase_ == Phase::Idle && card.slotRect.contains(mouse)) {
        removeCraft();
        return true;
    }

    if (hovered && phase_ == Phase::Idle) stage(profile, hovered->petalIndex, hovered->rarity);
    return true;
}

} // namespace flix
