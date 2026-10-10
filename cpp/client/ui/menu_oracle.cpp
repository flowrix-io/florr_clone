// The oracle.
//
// What the craft key opens while the flower stands at an oracle NPC (see
// shared/game/npc.h). The forge gambles five petals on a roll; the oracle
// takes a fixed price -- oracleCraftCost(), a table that runs from 7 commons
// to 1012 uniques -- and the upgrade is certain.
//
// It is florr's oracle window (menus.h), in its slate: one slot and the
// Craft button beside it, one line of text, and the grid, where every cell
// carries "owned/price" and a stack that cannot yet pay its column's price
// sits on a grey plate. florr's grid stops at super; this one keeps the
// unique column, because unique -> apex has a price here.
//
// One upgrade per craft, and one craft per half hour (kOracleCooldownMillis):
// while the account waits, the line of text turns red and says how long, and
// every stack in the grid sits on grey with its plain count.
//
// The slot moves the way florr's oracle window moves it (its draw,
// 0x1008125f0): the staged petal grows in turning once backwards; a craft
// spins the slot up toward 10 rad/s and swings it out from the centre on a
// sine of the time since the click as the shake eases in; the upgrade, 90
// across, pops in at the centre with a 200 ms pulse and a burst of rising
// grains in its tier's colour, while the plate fades and the offer vanishes,
// turning. florr spins for as long as its server takes to answer; this one
// answers at once, so the slot spins for kCraftSpinMs at the least.

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

/// The craft's spin: toward 10 rad/s while it is out, easing both ways at
/// the same rate. The least it spins before its answer shows is ours.
constexpr double kSpinTarget = 10.0;
constexpr double kSpinRate = 0.00632163093946958;
constexpr double kCraftSpinMs = 1000.0;
/// The upgrade's grains mostly rise: y velocity from -500 to 200, and any
/// starting angle.
constexpr SlotBurstShape kBurst{200.0, 0.0, kTau};
/// A craft that never hears back drops to idle after this: it resolved
/// server-side either way, and the profile will say how.
constexpr double kCraftTimeoutSeconds = 8.0;
/// How long a refusal stays under the slot.
constexpr double kRefusalSeconds = 3.0;

} // namespace

Vec2 OraclePanel::size(const Profile& profile) {
    return {slotCardWidth(false), slotCardHeight(SlotGrid::rows(profile, false))};
}

void OraclePanel::reset() {
    grid_.reset();
    motion_.clear();
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
    const double dtMs = std::max(0.0, ctx.dt) * 1000.0;

    const auto removeCraft = [this]() {
        crafts_ = 0;
        stagedPetal_ = kNoPetal;
    };
    // The account's wait for its next craft, counted down on this client's
    // clock from what the last profile said.
    const double cooldown = ctx.net.oracleCooldownRemainingMillis();
    const bool waiting = cooldown > 0.0;
    const auto land = [this]() {
        phase_ = Phase::Result;
        resultPending_ = false;
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
            // Mid-spin it is only recorded -- the spin owns when it lands.
            if (phase_ == Phase::Pulsing && (now - phaseStarted_) * 1000.0 < kCraftSpinMs) {
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

    const SlotCardLayout card = drawSlotCard(canvas, ctx.bounds, kOracleSkin, "Oracle", "Craft", mouse);
    const Rect panel = card.panel;

    if (phase_ == Phase::Pulsing) {
        const double elapsed = now - phaseStarted_;
        if (elapsed * 1000.0 >= kCraftSpinMs && resultPending_) {
            land();
        } else if (elapsed >= kCraftTimeoutSeconds) {
            phase_ = Phase::Idle;
        }
    }
    const bool upgraded = phase_ == Phase::Result && knownPetal(resultPetal_);
    motion_.stepRoll(dtMs, phase_ == Phase::Pulsing, upgraded, kSpinTarget, kSpinRate, kSpinRate);

    // --- the slot ----------------------------------------------------------
    const std::uint16_t shown = phase_ == Phase::Pulsing ? offeredPetal_ : stagedPetal_;
    const Rarity shownRarity = phase_ == Phase::Pulsing ? offeredRarity_ : stagedRarity_;
    const int shownCrafts = phase_ == Phase::Pulsing ? offeredCrafts_ : crafts_;
    ItemTile shownTile;
    shownTile.petalIndex = shown;
    shownTile.rarity = shownRarity;
    // The badge counts PETALS, the way a stack is counted everywhere else:
    // this is how many of them the oracle is being handed.
    if (knownPetal(shown)) {
        shownTile.badge = "x" + std::to_string(shownCrafts * oracleCraftCost(shownRarity));
    }
    shownTile.timeSeconds = now;
    // Lit under the cursor only while the slot is at rest.
    shownTile.hovered =
        motion_.spin() < 0.05 && phase_ == Phase::Idle && card.slotRect.contains(mouse);
    ItemTile upgradeTile;
    upgradeTile.petalIndex = resultPetal_;
    upgradeTile.rarity = resultRarity_;
    if (resultCount_ > 1) upgradeTile.badge = "x" + std::to_string(resultCount_);
    upgradeTile.timeSeconds = now;
    const auto key = [](std::uint16_t petal, Rarity rarity) {
        return (static_cast<std::uint32_t>(petal) << 8) |
               static_cast<std::uint32_t>(rarityIndex(rarity));
    };
    motion_.drawSlotScene(canvas, ctx.sprites, card, kOracleSkin, (now - phaseStarted_) * 1000.0,
                          dtMs, !upgraded && knownPetal(shown) ? &shownTile : nullptr,
                          key(shown, shownRarity), upgraded ? &upgradeTile : nullptr,
                          key(resultPetal_, resultRarity_) | 0x80000000u, kBurst);

    // A refusal, under the slot, for as long as it lasts. The reference has no
    // line here; the only thing that ever puts one there is the oracle saying
    // no, which is worth saying where the player is looking.
    if (!refusal_.empty() && now < refusalUntil_) {
        drawSlotRefusal(canvas, card, refusal_);
    } else {
        refusal_.clear();
    }

    // --- craft button ------------------------------------------------------
    // florr's grey button at rest, and the colour of the tier being bought
    // once there is something to buy -- the forge's rule, so the faces of the
    // menu answer "is anything staged" the same way.
    const bool canCraft =
        !waiting && phase_ == Phase::Idle && knownPetal(stagedPetal_) && crafts_ > 0;
    const bool overButton = card.button.contains(mouse);
    drawSlotButton(canvas, card.button, "Craft",
                   canCraft ? std::optional<std::uint32_t>(rarityColor(upgradeRarity(stagedRarity_)))
                            : std::nullopt,
                   overButton, overButton && ctx.window.mouseDown(MouseButton::Left));

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

    // Tiles on their way out go over everything but the words.
    motion_.drawVanishing(canvas, ctx.sprites, dtMs);

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
        resultPetal_ = kNoPetal;
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
