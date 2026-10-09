// The titan's forge.
//
// What the craft key opens while the flower stands at the titan NPC (see
// shared/game/npc.h): kTitanForgeCost apex petals of one kind in, one
// universal of it out, every time. A universal forged here lasts until another
// player forges the same petal, and then its holder gets the apex petals back
// less the one the forge keeps -- which is what the card's three lines say.
//
// It is drawn on the slot card every craft-key card shares (menus.h), cut down
// to eight columns and one row of grid, in charcoal. The ring is florr's own
// forge ring: five full-size slots on a pentagon standing on its point, about
// where the other cards hold their one slot. The grid is one row of petals
// rather than a petal-by-tier table, because only apex goes in: every petal
// the account holds at apex, greyed until there are five of it.
//
// The forge plays the way the forge's craft does, cut short -- the seats
// clear, and the five close in on the middle, turning -- and the universal
// lands there the way loot lands on the ground (SlotFlourish). Nothing is rolled, so
// nothing is handed back: a refusal is the only way the five return.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>

#include "client/ui/item_tile.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "shared/game/config.h"
#include "shared/game/npc.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The card: eight grid columns wide, and only as tall as one row of them
/// under the three lines of text. Measured, like the rest, in design units
/// from the card's outer top edge and its centre line.
constexpr std::size_t kColumns = 8;
constexpr double kCardHeight = 508.0;
/// Where the grid's view begins.
constexpr double kGridTop = 414.0;

/// The ring: five slots of a grid cell's size, 90 out from the slot card's
/// slot centre, the first straight up.
constexpr int kRingSlots = kTitanForgeCost;
constexpr double kRingRadius = 90.0;
constexpr double kRingSlot = 60.0;
constexpr double kRingStart = -kPi * 0.5;

/// The Forge button is wider than the card's stock button: it says more.
constexpr double kButtonWidth = 70.0;

/// How often the titan is asked again about a petal it has not answered
/// for: the server drops a query that comes too soon after the last.
constexpr double kHolderRetrySeconds = 0.3;

/// The three lines, centred, from the card's top.
constexpr double kFirstLineY = 350.0;
constexpr double kLinePitch = 22.5;
constexpr std::array<const char*, 3> kLines = {
    "Universal petals will last until another player forges the same petal.",
    "When that happens, you will receive your Apex petals back,",
    "but one will be permanently destroyed.",
};

/// The close: the five turn a quarter of the way round once more than they
/// were and draw in on the middle, shrinking, until they are one clump --
/// not all the way, or five tiles stacked exactly would read as the ring
/// vanishing rather than closing.
constexpr double kForgeSeconds = 1.2;
constexpr double kForgeTurns = 1.0;
constexpr double kMergeDepth = 0.86;
constexpr double kMergeShrink = 0.62;
/// Past this much of the close the names come off: five labels on top of
/// each other are noise.
constexpr double kNameDropPull = 0.5;
/// How long the ring waits on the titan before it gives up on the answer.
/// The forge resolved server-side either way, and the profile will say how.
constexpr double kForgeTimeoutSeconds = 8.0;
constexpr double kRefusalSeconds = 3.0;

/// An apex stack as the staging counts it, held below what an int holds.
std::uint32_t apexOwned(const Profile& profile, std::uint16_t petalIndex) {
    return std::min<std::uint32_t>(profile.stackCount(petalIndex, Rarity::Apex),
                                   static_cast<std::uint32_t>(kMaxStackCount));
}

/// Whether the account already holds this petal at universal, in the bag or
/// on the bar. One of each petal exists at universal, so the titan forges
/// none for an account that has it -- the server's rule, shown here first.
bool holdsUniversal(const Profile& profile, std::uint16_t petalIndex) {
    if (profile.stackCount(petalIndex, Rarity::Universal) > 0) return true;
    for (const Profile::Slot& slot : profile.loadout) {
        if (!slot.empty() && slot.petalIndex == petalIndex && slot.rarity == Rarity::Universal) {
            return true;
        }
    }
    return false;
}

} // namespace

Rect TitanPanel::bounds(int w, int h) {
    return slotCardBounds(slotCardColumnsWidth(kColumns), kCardHeight, w, h);
}

void TitanPanel::reset() {
    grid_.reset();
    flourish_.clear();
    stagedPetal_ = kNoPetal;
    phase_ = Phase::Idle;
    resultPending_ = false;
    refusal_.clear();
    askedPetal_ = kNoPetal;
    askedAt_ = -1.0;
}

bool TitanPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    const double dt = std::max(0.0, ctx.dt);

    // A result the server sent while this face of the menu was not showing
    // still has to land, so it is read here rather than in the click.
    TitanForgeOutcome& outcome = ctx.net.titanForgeOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        if (outcome.success && knownPetal(outcome.petalIndex)) {
            resultPetal_ = outcome.petalIndex;
            // Mid-close the result is only recorded: the ring decides when it
            // has closed. Anywhere else it lands now.
            if (phase_ == Phase::Forging) {
                resultPending_ = true;
            } else {
                phase_ = Phase::Result;
                phaseStarted_ = now;
                flourish_.land(now, Rarity::Universal);
            }
            // It is this flower's now, and the titan remembers it so.
            ctx.net.forgetTitanHolder(outcome.petalIndex);
            askedAt_ = -1.0;
        } else if (!outcome.success) {
            // Refused: nothing left the inventory, so the five go back into
            // the ring, with the reason under the button.
            if (phase_ == Phase::Forging) {
                stagedPetal_ = offeredPetal_;
                phase_ = Phase::Idle;
            }
            resultPending_ = false;
            refusal_ = outcome.reason.empty() ? "The titan refused." : outcome.reason;
            refusalUntil_ = now + kRefusalSeconds;
        }
    }

    // How far the close has run, 0..1, while it is running.
    double close = 0.0;
    if (phase_ == Phase::Forging) {
        const double elapsed = now - phaseStarted_;
        close = clamp(elapsed / kForgeSeconds, 0.0, 1.0);
        if (close >= 1.0 && resultPending_) {
            resultPending_ = false;
            phase_ = Phase::Result;
            phaseStarted_ = now;
            flourish_.land(now, Rarity::Universal);
            close = 0.0;
        } else if (elapsed >= kForgeTimeoutSeconds) {
            phase_ = Phase::Idle;
            close = 0.0;
        }
    }

    // The ring cannot hold five the account no longer has, nor a petal it now
    // holds at universal -- but never while a forge is out: those five are the
    // server's, and a profile landing a frame ahead of the result would empty
    // the ring under its own animation.
    if (phase_ == Phase::Idle && knownPetal(stagedPetal_) &&
        (apexOwned(profile, stagedPetal_) < static_cast<std::uint32_t>(kTitanForgeCost) ||
         holdsUniversal(profile, stagedPetal_))) {
        stagedPetal_ = kNoPetal;
    }

    const SlotCardLayout card = drawSlotCard(canvas, ctx.bounds, kTitanSkin, "Forge", mouse);
    const Rect panel = card.panel;

    // --- the ring ----------------------------------------------------------
    // The seats, flat in the border's charcoal, stand only while the ring is
    // idle: once the five go in, the forge is the petals closing and the
    // universal landing, with no empty slots left behind to say otherwise.
    // Laid out regardless -- they are what the idle panel hit-tests.
    std::array<Rect, kRingSlots> seats{};
    for (int i = 0; i < kRingSlots; ++i) {
        const double angle = kRingStart + kTau * i / kRingSlots;
        const Vec2 at = card.slot + Vec2::fromAngle(angle, kRingRadius);
        seats[static_cast<std::size_t>(i)] = {at.x - kRingSlot * 0.5, at.y - kRingSlot * 0.5,
                                              kRingSlot, kRingSlot};
        if (phase_ == Phase::Idle) {
            drawSlotPlate(canvas, ctx.sprites, seats[static_cast<std::size_t>(i)], kTitanSkin);
        }
    }

    flourish_.drawGrains(canvas, panel, card.slot, dt);
    const std::uint16_t ringPetal = phase_ == Phase::Forging ? offeredPetal_
                                    : phase_ == Phase::Idle  ? stagedPetal_
                                                             : kNoPetal;
    if (knownPetal(ringPetal)) {
        // Smoothstep in, so the close accelerates off the ring instead of
        // snapping inward; cubic out on the turn, so it settles as it merges.
        const double pull = kMergeDepth * close * close * (3.0 - 2.0 * close);
        const double turn = (1.0 - std::pow(1.0 - close, 3.0)) * kForgeTurns * kTau;
        const double radius = kRingRadius * (1.0 - pull);
        const double side = kRingSlot * (1.0 - (1.0 - kMergeShrink) * (pull / kMergeDepth));
        for (int i = 0; i < kRingSlots; ++i) {
            const double angle = kRingStart + kTau * i / kRingSlots + turn;
            ItemTile tile;
            tile.petalIndex = ringPetal;
            tile.rarity = Rarity::Apex;
            tile.showName = pull < kNameDropPull;
            tile.timeSeconds = now;
            drawSlotTile(canvas, ctx.sprites, card.slot + Vec2::fromAngle(angle, radius), side,
                         0.0, tile);
        }
    }
    if (phase_ == Phase::Result && knownPetal(resultPetal_)) {
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = Rarity::Universal;
        tile.timeSeconds = now;
        flourish_.drawLanded(canvas, ctx.sprites, card.slot, kSlotCardSlot * dropPulse(now), now,
                             tile);
    }

    // --- forge button ------------------------------------------------------
    // The colour of the tier it forges toward once five are in the ring -- the
    // forge's rule.
    const Rect button{card.button.x + card.button.w * 0.5 - kButtonWidth * 0.5, card.button.y,
                      kButtonWidth, card.button.h};
    const bool canForge = phase_ == Phase::Idle && knownPetal(stagedPetal_);
    drawSlotButton(canvas, button, "Forge",
                   canForge ? std::optional<std::uint32_t>(rarityColor(Rarity::Universal))
                            : std::nullopt,
                   button.contains(mouse));
    // A refusal stands in place of the card's lines, on the middle one, until
    // it expires.
    if (refusal_.empty() || now >= refusalUntil_) {
        refusal_.clear();
        for (std::size_t i = 0; i < kLines.size(); ++i) {
            SlotCardLayout line = card;
            line.lineY = panel.y + kFirstLineY + kLinePitch * static_cast<double>(i);
            drawSlotLine(canvas, line, kLines[i]);
        }
    } else {
        SlotCardLayout line = card;
        line.lineY = panel.y + kFirstLineY + kLinePitch * static_cast<double>(kLines.size() / 2);
        drawSlotLine(canvas, line, refusal_, kSlotCardRefusalInk);
    }

    // The titan remembers who it forged the picked petal for, and says so
    // halfway between the ring's lowest seats and the lines. Asked of the
    // server until it answers: only it knows every account.
    if (knownPetal(askedPetal_)) {
        const std::string* holder = ctx.net.titanHolder(askedPetal_);
        if (holder == nullptr && (askedAt_ < 0.0 || now - askedAt_ >= kHolderRetrySeconds)) {
            ctx.net.requestTitanHolder(askedPetal_);
            askedAt_ = now;
        }
        if (holder != nullptr && !holder->empty()) {
            const double lowestSeat = card.slot.y +
                                      kRingRadius * std::sin(kRingStart + kTau * 2 / kRingSlots) +
                                      kRingSlot * 0.5;
            const double linesTop = panel.y + kFirstLineY - kLinePitch * 0.5;
            SlotCardLayout line = card;
            line.lineY = (lowestSeat + linesTop) * 0.5;
            drawSlotLine(canvas, line, titanMemoryText(*holder));
        }
    }

    // --- the grid ----------------------------------------------------------
    // Every apex stack, on grey until it holds five -- the staged five are in
    // the ring, not in their stack -- and on grey for good while the account
    // holds that petal at universal.
    const std::optional<SlotTierGrid::Pick> hovered = grid_.render(
        ctx, card, kTitanSkin, Rarity::Apex, kColumns, kGridTop,
        [&](std::uint16_t petalIndex, std::uint32_t owned) {
            SlotCell cell;
            cell.count = owned;
            if (petalIndex == stagedPetal_) {
                const std::uint32_t staged = static_cast<std::uint32_t>(kTitanForgeCost);
                cell.count = owned > staged ? owned - staged : 0;
            }
            cell.greyed = cell.count < static_cast<std::uint32_t>(kTitanForgeCost) ||
                          holdsUniversal(profile, petalIndex);
            // A lone petal carries no badge, as in the inventory.
            if (cell.count > 1) cell.badge = "x" + stackCountText(cell.count);
            return cell;
        });

    // --- input -------------------------------------------------------------
    // On press, as the forge, the oracle and the trader answer.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        stagedPetal_ = kNoPetal;
        askedPetal_ = kNoPetal;
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (card.close.contains(mouse) && ctx.pressed()) return false;

    // The universal sits there until it is dismissed, and the press that
    // dismisses it does nothing else.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }

    if (button.contains(mouse)) {
        if (canForge) {
            phase_ = Phase::Forging;
            phaseStarted_ = now;
            offeredPetal_ = stagedPetal_;
            resultPending_ = false;
            refusal_.clear();
            ctx.net.requestTitanForge(stagedPetal_);
            // Handed over: the ring draws the offer from here, and a refusal
            // is what puts it back.
            stagedPetal_ = kNoPetal;
        }
        return true;
    }

    if (phase_ == Phase::Idle) {
        for (const Rect& seat : seats) {
            if (!seat.contains(mouse)) continue;
            stagedPetal_ = kNoPetal;
            askedPetal_ = kNoPetal;
            return true;
        }
    }

    if (hovered && phase_ == Phase::Idle && ctx.pressed()) {
        // Whatever is picked, the titan is asked afresh who it forged it for:
        // somebody may have forged it since it was last asked.
        askedPetal_ = hovered->petalIndex;
        askedAt_ = -1.0;
        ctx.net.forgetTitanHolder(askedPetal_);
        // A grey stack goes nowhere, quietly: its grey is the whole answer.
        // Any other one REPLACES the ring -- one forge takes five of one petal.
        if (!hovered->greyed) {
            stagedPetal_ = hovered->petalIndex;
            refusal_.clear();
        }
    }
    return true;
}

} // namespace flix
