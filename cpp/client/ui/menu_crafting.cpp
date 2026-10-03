// The forge.
//
// Five slots in a ring, a Craft button beside them, and a grid of everything
// the account owns laid out as petal-per-row and tier-per-column -- which is
// the shape that makes "what am I five away from upgrading" readable at a
// glance, and is why the crafting grid is not the inventory grid.
//
// It is drawn on the slot card every craft-key card shares (menus.h), so it
// is the oracle's and the trader's card in the forge's orange: the ring turns
// about the centre of the one slot those two hold, the Craft button and the
// line sit where theirs do, and the grid is theirs, stopping at unique.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>

#include "client/ui/item_tile.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "shared/game/config.h"

namespace flix {

using namespace flix::ui;

namespace {

/// One craft consumes five of a kind. The server enforces the same number; it
/// is here so the panel can refuse a stack that cannot fill the ring.
constexpr int kBatch = 5;

/// The ring, about the slot card's slot centre.
constexpr double kRingRadius = 70.0;
constexpr double kRingSlot = 40.0;
constexpr double kSpinMillis = 1500.0;
/// The ring does not merely turn. The five are being pressed into one, so they
/// draw in toward the centre and spring back out `kPullCycles` times -- a
/// rotation alone is a carousel, and a carousel is not a forge -- and then on
/// the last approach they clamp together and stay there, which is the moment
/// the craft is actually resolving.
///
/// `kPullDepth` is how far a breath pulls, as a fraction of the ring's radius;
/// `kMergeDepth` is how far the final clamp goes. Not all the way to the
/// centre: five tiles stacked exactly is one tile, and the player would see the
/// ring vanish rather than close. A tight clump still reads as five.
constexpr double kPullCycles = 3.0;
constexpr double kPullDepth = 0.32;
constexpr double kMergeStart = 0.72;
constexpr double kMergeDepth = 0.86;
/// Converging petals also shrink, down to this much of a slot. Things being
/// crushed together get smaller; things merely orbiting do not.
constexpr double kMergeShrink = 0.62;
/// Past this much convergence the names come off. Five overlapping labels are
/// unreadable on top of each other, and by then the tiles are a moving clump
/// rather than five things to identify.
constexpr double kNameDropPull = 0.5;
/// The spin holds at its last frame waiting on the server, so a response that
/// never lands would leave the ring turning until the panel is closed. Give up
/// after this and drop back to idle; the craft is resolved server-side anyway.
constexpr double kCraftTimeoutMillis = 8000.0;

constexpr double kSwitchWidth = 58.0;
constexpr std::uint32_t kSwitchFill = 0x8A7AC9u;
constexpr std::uint32_t kSwitchBorder = 0x6A5AA8u;
constexpr std::uint32_t kSwitchHoverFill = 0xA394E0u;
constexpr std::uint32_t kDisabledFill = 0x8A8A8Au;
constexpr std::uint32_t kDisabledBorder = 0x5A5A5Au;
constexpr double kDisabledAlpha = 0.45;


/// Absorb -- the purple half of this panel -- is maze-only, and this build has
/// no maze. The Switch button is still laid out and hit-tested, drawn in the
/// reference's disabled state and swallowing its own clicks.
constexpr bool kAbsorbAvailable = false;

/// Each clover equipped in the ten PRIMARY loadout slots at the tier being
/// crafted adds this many percentage points. Storage slots do not count.
constexpr double kCloverBonus = 0.05;
constexpr std::size_t kPrimarySlots = 10;

/// The shortest string that round-trips a percentage rounded to two decimals:
/// "64%", "8%", "0.5%", "0.25%". The top tiers are fractions of a percent and
/// rounding those to "0%" would say the craft is impossible, which it is not.
std::string percentText(double percent) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.2f", percent);
    std::string out = buffer;
    if (out.find('.') != std::string::npos) {
        while (!out.empty() && out.back() == '0') out.pop_back();
        if (!out.empty() && out.back() == '.') out.pop_back();
    }
    return out + "%";
}

bool knownPetal(std::uint16_t petalIndex) {
    return petalIndex != kNoPetal && petalIndex < content().petalCount();
}

/// A stack as the staging math counts it. The wire carries a u32 but no stack
/// is deeper than kMaxStackCount, and a count past it cast straight to int
/// would stage a negative number of batches.
int ownedCount(const Profile& profile, std::uint16_t petalIndex, Rarity rarity) {
    return static_cast<int>(std::min<std::uint32_t>(profile.stackCount(petalIndex, rarity),
                                                    static_cast<std::uint32_t>(kMaxStackCount)));
}

/// Clovers raise the roll, so they have to raise the number the panel prints
/// or the two disagree in front of the player.
double cloverBonus(const Profile& profile, Rarity rarity) {
    const std::uint16_t clover = content().petalIndex("clover");
    if (clover == kInvalidIndex) return 0.0;
    double bonus = 0.0;
    const std::size_t slots = std::min(profile.loadout.size(), kPrimarySlots);
    for (std::size_t i = 0; i < slots; ++i) {
        const Profile::Slot& slot = profile.loadout[i];
        if (!slot.empty() && slot.petalIndex == clover && slot.rarity == rarity) {
            bonus += kCloverBonus;
        }
    }
    return bonus;
}

} // namespace

Rect CraftingPanel::bounds(int w, int h) { return slotCardBounds(false, w, h); }

void CraftingPanel::reset() {
    grid_.reset();
    stagedPetal_ = kNoPetal;
    batches_ = 0;
    phase_ = Phase::Idle;
    resultPending_ = false;
}

void CraftingPanel::stage(const Profile& profile, std::uint16_t petalIndex, Rarity rarity,
                          bool wholeStack) {
    const int possible = ownedCount(profile, petalIndex, rarity) / kBatch;
    if (possible <= 0 || !craftsOutOf(rarity)) return;

    if (stagedPetal_ != petalIndex || stagedRarity_ != rarity) {
        stagedPetal_ = petalIndex;
        stagedRarity_ = rarity;
        batches_ = 0;
    }
    batches_ = wholeStack ? possible : std::min(possible, batches_ + 1);
}

bool CraftingPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();

    // One click of the ring hands back one batch of five, not the whole
    // staging area, so the slot badge counts down instead of vanishing.
    const auto removeBatch = [this]() {
        if (--batches_ <= 0) {
            batches_ = 0;
            stagedPetal_ = kNoPetal;
        }
    };

    // A result the server sent while this panel was closed still has to land:
    // reading it here rather than in the craft click is what makes the
    // animation survive the player tabbing away mid-spin.
    CraftOutcome& outcome = ctx.net.craftOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        lastSuccess_ = outcome.success;
        resultPetal_ = outcome.petalIndex;
        resultRarity_ = outcome.rarity;
        resultCount_ = outcome.crafted;
        // What the server could not spend: the pool is crafted five at a time
        // until fewer than five are left, and that tail is what the remaining
        // slots show. It is a count off the wire, not a constant -- a failure
        // hands back one to four, not always three.
        survivors_ = outcome.petalsReturned;
        // Mid-spin the outcome is only recorded; the ring owns when it is
        // shown. Anywhere else -- a result that arrived while the panel was
        // shut, or after the spin already ran out -- it lands now.
        if (phase_ == Phase::Spinning) {
            resultPending_ = true;
        } else {
            phase_ = Phase::Result;
            phaseStarted_ = ctx.timeSeconds;
        }
    }

    // The staged batch cannot outlive the petals behind it: another window, a
    // pickup, or the craft that just consumed them all change the stack. Never
    // during a spin, though -- those five are already at the server, and a
    // profile that lands a frame ahead of the result would empty the ring
    // half-way through its own animation.
    if (phase_ != Phase::Spinning && stagedPetal_ != kNoPetal &&
        ownedCount(profile, stagedPetal_, stagedRarity_) / kBatch < batches_) {
        batches_ = ownedCount(profile, stagedPetal_, stagedRarity_) / kBatch;
        if (batches_ <= 0) stagedPetal_ = kNoPetal;
    }

    const SlotCardLayout card = drawSlotCard(canvas, ctx.bounds, kCraftingSkin, "Craft", mouse);
    const Rect panel = card.panel;
    const Rect closeRect = card.close;

    const Rect switchRect{closeRect.x - 6.0 - kSwitchWidth, closeRect.y, kSwitchWidth, kCloseSize};
    const bool switchHovered = kAbsorbAvailable && switchRect.contains(mouse);
    const double switchAlpha = kAbsorbAvailable ? 1.0 : kDisabledAlpha;
    inlaid(canvas, switchRect,
           kAbsorbAvailable ? (switchHovered ? kSwitchHoverFill : kSwitchFill) : kDisabledFill,
           kAbsorbAvailable ? kSwitchBorder : kDisabledBorder, 2.0, 3.0, switchAlpha);
    // The label fades with the button: the whole control is one dimmed group,
    // not a bright caption on a grey plate.
    canvas.setGlobalAlpha(static_cast<float>(switchAlpha));
    outlinedText(canvas, "Switch", switchRect.x + switchRect.w * 0.5,
                 switchRect.y + switchRect.h * 0.5 + 1.0,
                 panelLabel(12.0, Align::Centre, Baseline::Middle), kSlotCardLabelStroke);
    canvas.setGlobalAlpha(1.0f);

    // --- the ring ----------------------------------------------------------
    // Turned about where the oracle and the trader hold their one slot.
    const double centreX = card.slot.x;
    const double centreY = card.slot.y;

    if (phase_ == Phase::Spinning) {
        const double elapsed = (ctx.timeSeconds - phaseStarted_) * 1000.0;
        if (elapsed >= kSpinMillis && resultPending_) {
            // The spin ran its full course and the answer is already in hand.
            resultPending_ = false;
            phase_ = Phase::Result;
            phaseStarted_ = ctx.timeSeconds;
            spinAngle_ = 0;
        } else {
            const double t = clamp(elapsed / kSpinMillis, 0.0, 1.0);
            // Cubic ease-out over six turns: fast enough to read as a
            // commitment, slow enough at the end that the result does not
            // appear mid-blur.
            spinAngle_ = (1.0 - std::pow(1.0 - t, 3.0)) * 6.0 * kTau;
            // In and out under the turn, then held together for the combine.
            // The breath starts and ends a cycle at rest, so the ring leaves
            // the idle radius and returns to it without a step.
            ringPull_ = kPullDepth * (0.5 - 0.5 * std::cos(t * kPullCycles * kTau));
            if (t > kMergeStart) {
                // Smoothstep, so the last approach accelerates out of the
                // breath instead of snapping inward off it.
                const double m = (t - kMergeStart) / (1.0 - kMergeStart);
                ringPull_ = lerp(ringPull_, kMergeDepth, m * m * (3.0 - 2.0 * m));
            }
            // Held at the end of the spin rather than snapped back to idle: the
            // server has not answered yet, and an empty ring would read as a
            // loss.
            if (elapsed >= kCraftTimeoutMillis) {
                phase_ = Phase::Idle;
                spinAngle_ = 0;
            }
        }
    }
    if (phase_ != Phase::Spinning) {
        spinAngle_ = 0;
        ringPull_ = 0;
    }

    // Through the spin AND through a FAILED result the ring keeps showing the
    // petal as it was before the craft -- the pre-craft tier stays behind the
    // result rather than being replaced by what came out. The server answers a
    // success with the upgraded tier, so the original is one step back down.
    //
    // A success clears the ring entirely: the five went in and one came out,
    // so leaving five of the old tier orbiting the new one says the opposite
    // of what happened.
    const bool showingFailure = phase_ == Phase::Result && !lastSuccess_;
    const bool showingSuccess = phase_ == Phase::Result && lastSuccess_;
    std::uint16_t ringPetal = stagedPetal_;
    Rarity ringRarity = stagedRarity_;
    if (phase_ == Phase::Spinning) {
        // The staging area went to the server whole on the click, so the spin
        // draws from its own copy of what was sent.
        ringPetal = spinPetal_;
        ringRarity = spinRarity_;
    } else if (phase_ == Phase::Result) {
        ringPetal = resultPetal_;
        ringRarity = lastSuccess_ ? downgradeRarity(resultRarity_) : resultRarity_;
    }
    const bool ringFilled = knownPetal(ringPetal);

    // Idle and at rest these are the ring's own radius and slot size, which is
    // what keeps the rects below hit-testable as the staging area they are.
    const double radius = kRingRadius * (1.0 - ringPull_);
    const double side =
        kRingSlot * (1.0 - (1.0 - kMergeShrink) * clamp(ringPull_ / kMergeDepth, 0.0, 1.0));

    std::array<Rect, kBatch> slots{};
    for (int i = 0; i < kBatch; ++i) {
        const double angle = (static_cast<double>(i) / kBatch) * kTau + spinAngle_;
        const Rect slot{centreX + radius * std::cos(angle) - side * 0.5,
                        centreY + radius * std::sin(angle) - side * 0.5, side, side};
        slots[static_cast<std::size_t>(i)] = slot;

        const bool occupied = ringFilled && !(showingFailure && i >= survivors_);
        ItemTile tile;
        tile.petalIndex = occupied ? ringPetal : kNoPetal;
        tile.rarity = ringRarity;
        // An empty slot's fill and border are the same tan, so it reads as a
        // flat block rather than a ring with nothing in it.
        tile.empty = !occupied;
        tile.emptyFill = kCraftingSkin.border;
        tile.emptyBorder = kCraftingSkin.border;
        // Named like every other tile in the game. The ring is the only place
        // a petal was ever drawn anonymously, and a staged slot that does not
        // say what is in it reads as a different, unlabelled kind of object --
        // the repetition around the circle is the point, not noise.
        tile.showName = ringPull_ < kNameDropPull;
        if (occupied && phase_ == Phase::Idle && batches_ > 1) {
            tile.badge = "x" + stackCountText(static_cast<std::uint64_t>(batches_));
        }
        tile.timeSeconds = ctx.timeSeconds;
        // The rects are still laid out on a success -- they are what the idle
        // panel hit-tests -- they are simply not drawn.
        if (!showingSuccess) drawItemTile(canvas, ctx.sprites, slot, tile);
    }

    // The outcome, in the middle of the ring -- where the other cards hold
    // their one slot, at that slot's size. A failure draws nothing here: the
    // emptied slots behind it are the whole message.
    if (showingSuccess && knownPetal(resultPetal_)) {
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = resultRarity_;
        // How many upgrades the pool actually produced -- a staged x3 that
        // landed twice reads "x2", which is the only place the player is told.
        // In the tile's own top-right badge, the way a stack is counted
        // everywhere else; it used to be a caption slung under the card in the
        // rarity colour, which is a count nothing else in the game wears. A
        // lone petal carries no badge, matching the grid.
        if (resultCount_ > 1) {
            tile.badge = "x" + stackCountText(static_cast<std::uint64_t>(resultCount_));
        }
        tile.timeSeconds = ctx.timeSeconds;
        drawItemTile(canvas, ctx.sprites, card.slotRect, tile);
    }

    // --- craft button ------------------------------------------------------
    const Rect craftRect = card.button;
    const bool canCraft = phase_ == Phase::Idle && stagedPetal_ != kNoPetal && batches_ > 0;
    // The button wears the colour of the tier being crafted TOWARD, and keeps
    // wearing it through the spin.
    const std::uint16_t buttonPetal = stagedPetal_ != kNoPetal ? stagedPetal_ : ringPetal;
    const Rarity fromRarity = stagedPetal_ != kNoPetal ? stagedRarity_ : ringRarity;
    const Rarity nextRarity = upgradeRarity(fromRarity);
    const bool tinted = buttonPetal != kNoPetal && nextRarity != fromRarity;
    drawSlotButton(canvas, craftRect, "Craft",
                   tinted ? std::optional<std::uint32_t>(rarityColor(nextRarity)) : std::nullopt,
                   craftRect.contains(mouse));

    // A valid craft always has a chance above zero, even if it is a quarter of
    // a percent; a zero means nothing is staged, which reads as "?%".
    std::string odds = "?% success chance";
    if (stagedPetal_ != kNoPetal) {
        const double percent = std::min(100.0, craftSuccessChance(stagedRarity_) * 100.0 +
                                                   cloverBonus(profile, stagedRarity_));
        odds = percentText(percent) + " success chance";
    }
    outlinedText(canvas, odds, craftRect.x + craftRect.w * 0.5, craftRect.bottom() + 6.0,
                 panelLabel(12.0, Align::Centre, Baseline::Top), kSlotCardLabelStroke);

    drawSlotLine(canvas, card, "Combine 5 of the same petal to craft an upgrade");

    // --- the grid ----------------------------------------------------------
    // Common through unique: nothing upgrades out of apex, so there is no
    // column for it -- the same reason stage() refuses one.
    const std::uint32_t held =
        static_cast<std::uint32_t>(std::max(0, batches_)) * static_cast<std::uint32_t>(kBatch);
    const std::optional<SlotGrid::Pick> hovered = grid_.render(
        ctx, card, kCraftingSkin, false,
        [&](std::uint16_t petalIndex, Rarity rarity, std::uint32_t owned) {
            SlotCell cell;
            cell.count = owned;
            // Staged petals are gone from the player's point of view the
            // moment they land in the ring, so the badge counts down with each
            // click.
            if (petalIndex == stagedPetal_ && rarity == stagedRarity_) {
                cell.count = owned > held ? owned - held : 0;
            }
            // A lone petal carries no badge; "x1" is noise on every cell of a
            // fresh account.
            if (cell.count > 1) cell.badge = "x" + stackCountText(cell.count);
            return cell;
        });

    // --- input -------------------------------------------------------------
    // On press, not release: the browser hit-tests in mousedown, so a press
    // that starts on a cell and drifts off must not still fire.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        removeBatch();
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (closeRect.contains(mouse) && ctx.pressed()) return false;

    // The outcome sits there until it is dismissed. It used to expire on a
    // two-second timer, which put the one thing the player crafted the petal to
    // see on a clock they do not control -- look away and the result is gone
    // and there is nowhere to read it back. Any click in the panel clears it,
    // and that click does nothing else: the press that dismisses a result must
    // not also stage the cell it happens to land on.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }
    // Swallowed rather than ignored: a dead control still eats its own click.
    if (switchRect.contains(mouse)) return true;

    if (craftRect.contains(mouse)) {
        if (canCraft) {
            phase_ = Phase::Spinning;
            phaseStarted_ = ctx.timeSeconds;
            // Everything staged goes in ONE request, which the server crafts as
            // a pool and answers with a single result. A batch per click would
            // make a staged x3 three clicks and three spins; the reference
            // sends the whole array and plays one.
            spinPetal_ = stagedPetal_;
            spinRarity_ = stagedRarity_;
            ctx.net.requestCraft(stagedPetal_, stagedRarity_, batches_ * kBatch);
            // Handed over, so the staging area is empty from here: the ring is
            // drawing the animation's copy, not something still takeable back.
            stagedPetal_ = kNoPetal;
            batches_ = 0;
        }
        return true;
    }

    if (phase_ == Phase::Idle) {
        for (const Rect& slot : slots) {
            if (!slot.contains(mouse)) continue;
            removeBatch();
            return true;
        }
    }

    if (hovered && phase_ == Phase::Idle) {
        stage(profile, hovered->petalIndex, hovered->rarity, ctx.window.shiftHeld());
    }
    return true;
}

} // namespace flix
