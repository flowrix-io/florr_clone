// The forge.
//
// Five slots in a ring, a Craft button beside them, and a grid of everything
// the account owns laid out as petal-per-row and tier-per-column -- which is
// the shape that makes "what am I five away from upgrading" readable at a
// glance, and is why the crafting grid is not the inventory grid.

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

constexpr double kRingTop = 50.0;
constexpr double kRingBox = 180.0;
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

constexpr double kGridCell = 56.0;
constexpr double kGridGap = 4.0;
constexpr double kGridPadding = 12.0;
/// Columns of the tier grid: EVERY craftable tier, common through unique,
/// whether or not the account holds one. Apex is not among them because
/// nothing upgrades out of apex -- there is no tier above it to craft toward,
/// which is the same reason the inventory sweep below skips apex stacks.
///
/// Built from what the player owned, the grid was two columns wide on a fresh
/// account and never said what the forge is FOR, and it reflowed sideways the
/// first time a craft landed a new tier -- moving every cell out from under
/// the cursor mid-click.
constexpr std::size_t kTierColumns = static_cast<std::size_t>(Rarity::Unique) + 1;
/// The grid is CLIPPED to four pixels off the card's bottom edge but SCROLLS
/// against a view fourteen off it. Two different numbers on purpose: the thumb
/// and the scroll limit follow the shorter one, the paint the taller.
constexpr double kClipInset = 4.0;
constexpr double kScrollInset = 14.0;
/// One wheel notch, in content pixels -- what a browser deltaY delivers.
constexpr double kWheelStep = 100.0;

constexpr double kSwitchWidth = 58.0;
constexpr std::uint32_t kSwitchFill = 0x8A7AC9u;
constexpr std::uint32_t kSwitchBorder = 0x6A5AA8u;
constexpr std::uint32_t kSwitchHoverFill = 0xA394E0u;
constexpr std::uint32_t kDisabledFill = 0x8A8A8Au;
constexpr std::uint32_t kDisabledBorder = 0x5A5A5Au;
constexpr double kDisabledAlpha = 0.45;

/// With nothing staged the Craft button is a solid grey, at full opacity and
/// still lightening under the cursor. It is never a disabled control.
constexpr std::uint32_t kCraftIdleFill = 0x777777u;
constexpr std::uint32_t kCraftIdleBorder = 0x555555u;

/// Not every outline here is solid black: the labels under the ring are
/// stroked at 60%, which is a visibly lighter weight at these sizes.
constexpr double kSoftStroke = 0.6;

/// Absorb -- the purple half of this panel -- is maze-only, and this build has
/// no maze. The Switch button is still laid out and hit-tested, drawn in the
/// reference's disabled state and swallowing its own clicks.
constexpr bool kAbsorbAvailable = false;

/// Each clover equipped in the ten PRIMARY loadout slots at the tier being
/// crafted adds this many percentage points. Storage slots do not count.
constexpr double kCloverBonus = 0.05;
constexpr std::size_t kPrimarySlots = 10;

/// A cell of the tier grid. An unowned combination still gets a cell, drawn
/// empty: the gap is the information.
struct GridCell {
    Rect rect;
    std::uint16_t petalIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    std::uint32_t count = 0;
};

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

/// Stroke-then-fill text whose OUTLINE carries an alpha.
///
/// `TextStyle` has no stroke alpha and the reference stroke here is
/// rgba(0,0,0,0.6), so the glyph path is built and stroked directly. Round
/// join throughout: every text call site in the browser panel sets it, and a
/// mitred outline grows spikes off sharp letter corners at width 3.
void outlinedText(Canvas& canvas, const std::string& s, double x, double y,
                  const TextStyle& style, double strokeAlpha) {
    if (s.empty() || !Fonts::ready()) return;

    double penX = x;
    if (style.align != Align::Left) {
        const double width = measure(s, style.size, style.bold);
        penX -= style.align == Align::Centre ? width * 0.5 : width;
    }
    double penY = y;
    switch (style.baseline) {
        case Baseline::Top: penY += ascent(style.size, style.bold); break;
        case Baseline::Bottom: penY += descent(style.size, style.bold); break;
        case Baseline::Alphabetic: break;
        default:
            penY += (ascent(style.size, style.bold) + descent(style.size, style.bold)) * 0.5;
            break;
    }

    // This painter has always joined the outline round, whatever the style
    // asked for; paintRun reads the flag, so it is set rather than assumed.
    TextStyle rounded = style;
    rounded.roundJoin = true;
    paintRun(canvas, s, penX, penY, rounded, strokeAlpha);
}

TextStyle panelLabel(double size, Align align, Baseline baseline) {
    TextStyle style;
    style.size = size;
    style.bold = true;
    style.align = align;
    style.baseline = baseline;
    style.strokeWidth = 3.0;
    style.roundJoin = true;
    return style;
}

bool knownPetal(std::uint16_t petalIndex) {
    return petalIndex != kNoPetal && petalIndex < content().petalCount();
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

double CraftingPanel::preferredWidth() { return 580.0; }

void CraftingPanel::reset() {
    scroll_ = {};
    stagedPetal_ = kNoPetal;
    batches_ = 0;
    phase_ = Phase::Idle;
    resultPending_ = false;
}

void CraftingPanel::stage(const Profile& profile, std::uint16_t petalIndex, Rarity rarity,
                          bool wholeStack) {
    const int owned = static_cast<int>(profile.stackCount(petalIndex, rarity));
    const int possible = owned / kBatch;
    if (possible <= 0 || rarity == Rarity::Apex) return;

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
    const Rect panel = ctx.bounds;
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
        static_cast<int>(profile.stackCount(stagedPetal_, stagedRarity_)) < batches_ * kBatch) {
        batches_ = static_cast<int>(profile.stackCount(stagedPetal_, stagedRarity_)) / kBatch;
        if (batches_ <= 0) stagedPetal_ = kNoPetal;
    }

    panelCard(canvas, panel, kCraftingSkin);
    panelTitle(canvas, panel, "Craft");

    const Rect closeRect = closeButtonRect(panel);
    // 3/1, not the inventory's 4/3: the forge spells its own corners out.
    panelClose(canvas, closeRect, closeRect.contains(mouse));

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
                 panelLabel(12.0, Align::Centre, Baseline::Middle), kSoftStroke);
    canvas.setGlobalAlpha(1.0f);

    // --- the ring ----------------------------------------------------------
    const double centreX = panel.x + panel.w * 0.5;
    const double centreY = panel.y + kRingTop + kRingBox * 0.5;

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
            tile.badge = "x" + std::to_string(batches_);
        }
        tile.timeSeconds = ctx.timeSeconds;
        // The rects are still laid out on a success -- they are what the idle
        // panel hit-tests -- they are simply not drawn.
        if (!showingSuccess) drawItemTile(canvas, ctx.sprites, slot, tile);
    }

    // The outcome, in the middle of the ring. A failure draws nothing here --
    // the emptied slots behind it are the whole message.
    if (showingSuccess && knownPetal(resultPetal_)) {
        const double size = 60.0;
        const Rect card{centreX - size * 0.5, centreY - size * 0.5, size, size};
        ItemTile tile;
        tile.petalIndex = resultPetal_;
        tile.rarity = resultRarity_;
        // How many upgrades the pool actually produced -- a staged x3 that
        // landed twice reads "x2", which is the only place the player is told.
        // In the tile's own top-right badge, the way a stack is counted
        // everywhere else; it used to be a caption slung under the card in the
        // rarity colour, which is a count nothing else in the game wears. A
        // lone petal carries no badge, matching the grid.
        if (resultCount_ > 1) tile.badge = "x" + std::to_string(resultCount_);
        tile.timeSeconds = ctx.timeSeconds;
        drawItemTile(canvas, ctx.sprites, card, tile);
    }

    // --- craft button ------------------------------------------------------
    const Rect craftRect{centreX + kRingBox * 0.5 + 10.0, centreY - 15.0, 60.0, 30.0};
    const bool canCraft = phase_ == Phase::Idle && stagedPetal_ != kNoPetal && batches_ > 0;
    // The button wears the colour of the tier being crafted TOWARD, and keeps
    // wearing it through the spin.
    const std::uint16_t buttonPetal = stagedPetal_ != kNoPetal ? stagedPetal_ : ringPetal;
    const Rarity fromRarity = stagedPetal_ != kNoPetal ? stagedRarity_ : ringRarity;
    const Rarity nextRarity = upgradeRarity(fromRarity);
    const bool tinted = buttonPetal != kNoPetal && nextRarity != fromRarity;
    const std::uint32_t craftFill = tinted ? rarityColor(nextRarity) : kCraftIdleFill;
    const std::uint32_t craftBorder = tinted ? darken(craftFill, 0.25) : kCraftIdleBorder;
    inlaid(canvas, craftRect,
           craftRect.contains(mouse) ? lighten(craftFill, 0.15) : craftFill, craftBorder, 3.0, 6.0);
    outlinedText(canvas, "Craft", craftRect.x + craftRect.w * 0.5,
                 craftRect.y + craftRect.h * 0.5,
                 panelLabel(13.0, Align::Centre, Baseline::Middle), kSoftStroke);

    // A valid craft always has a chance above zero, even if it is a quarter of
    // a percent; a zero means nothing is staged, which reads as "?%".
    std::string odds = "?% success chance";
    if (stagedPetal_ != kNoPetal) {
        const double percent = std::min(100.0, craftSuccessChance(stagedRarity_) * 100.0 +
                                                   cloverBonus(profile, stagedRarity_));
        odds = percentText(percent) + " success chance";
    }
    outlinedText(canvas, odds, craftRect.x + craftRect.w * 0.5, craftRect.bottom() + 6.0,
                 panelLabel(12.0, Align::Centre, Baseline::Top), kSoftStroke);

    const double instructionY = panel.y + kRingTop + kRingBox + 10.0;
    outlinedText(canvas, "Combine 5 of the same petal to craft an upgrade",
                 panel.x + panel.w * 0.5, instructionY + 4.0,
                 panelLabel(13.0, Align::Centre, Baseline::Top), kSoftStroke);

    // --- the grid ----------------------------------------------------------
    // Columns are the fixed tier run (see kTierColumns); rows are the petal
    // types the account owns. Those come from the UNDEDUCTED profile on
    // purpose: a stack staged down to nothing keeps its row, so the grid
    // cannot reflow under the cursor mid-click and drop the next click onto a
    // different petal.
    std::vector<std::uint16_t> types;
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.count == 0 || stack.rarity == Rarity::Apex) continue;
        if (std::find(types.begin(), types.end(), stack.petalIndex) == types.end()) {
            types.push_back(stack.petalIndex);
        }
    }
    std::sort(types.begin(), types.end());

    const double inventoryTop = instructionY + 30.0;
    const Rect view{panel.x + kClipInset, inventoryTop, panel.w - kClipInset * 2,
                    std::max(0.0, panel.bottom() - kClipInset - inventoryTop)};
    const double scrollHeight = std::max(0.0, panel.bottom() - kScrollInset - inventoryTop);

    const double gridWidth =
        static_cast<double>(kTierColumns) * kGridCell +
        static_cast<double>(kTierColumns - 1) * kGridGap;
    const double startX = panel.x + kGridPadding + std::max(0.0, (panel.w - kGridPadding * 2 - gridWidth) * 0.5);

    const std::uint32_t held =
        static_cast<std::uint32_t>(std::max(0, batches_)) * static_cast<std::uint32_t>(kBatch);
    std::vector<GridCell> cells;
    double y = kGridPadding;
    for (const std::uint16_t petalIndex : types) {
        for (std::size_t column = 0; column < kTierColumns; ++column) {
            const Rarity rarity = static_cast<Rarity>(column);
            std::uint32_t count = profile.stackCount(petalIndex, rarity);
            // Staged petals are gone from the player's point of view the moment
            // they land in the ring, so the badge counts down with each click.
            if (petalIndex == stagedPetal_ && rarity == stagedRarity_) {
                count = count > held ? count - held : 0;
            }
            cells.push_back({Rect{startX + static_cast<double>(column) * (kGridCell + kGridGap), y,
                                  kGridCell, kGridCell},
                             petalIndex, rarity, count});
        }
        y += kGridCell + kGridGap;
    }
    const double contentHeight = y + kGridPadding;

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = scrollHeight;
    // Scrolls anywhere below the instruction line, not just over the cells, and
    // by the raw wheel delta rather than a step of this panel's own choosing.
    if (panel.contains(mouse) && mouse.y >= inventoryTop) {
        scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    }
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
            // A tier the account holds none of: a flat tan block, fill and
            // border the same colour. Not hoverable and not clickable.
            ItemTile blank;
            blank.empty = true;
            blank.emptyFill = kCraftingSkin.border;
            blank.emptyBorder = kCraftingSkin.border;
            drawItemTile(canvas, ctx.sprites, rect, blank);
            continue;
        }
        if (rect.contains(mouse) && view.contains(mouse)) hovered = static_cast<int>(i);

        ItemTile tile;
        tile.petalIndex = cell.petalIndex;
        tile.rarity = cell.rarity;
        tile.hovered = hovered == static_cast<int>(i);
        // A lone petal carries no badge; "x1" is noise on every cell of a fresh
        // account.
        if (cell.count > 1) tile.badge = "x" + std::to_string(cell.count);
        tile.timeSeconds = ctx.timeSeconds;
        drawItemTile(canvas, ctx.sprites, rect, tile);
    }
    canvas.restore();

    // Thumb only, no track, square-cornered, and inset from the card's edge
    // rather than the clip's: it is a hint at how far down the list is, not a
    // control to grab.
    if (contentHeight > scrollHeight && scrollHeight > 0.0) {
        const double thumbHeight = std::max(20.0, scrollHeight * scrollHeight / contentHeight);
        const double travel = contentHeight - scrollHeight;
        const double thumbY =
            inventoryTop + clamp(scroll_.offset / travel, 0.0, 1.0) * (scrollHeight - thumbHeight);
        setFill(canvas, kInk, 0.25);
        canvas.fillRect(static_cast<float>(panel.right() - 10.0), static_cast<float>(thumbY), 4.0f,
                        static_cast<float>(thumbHeight));
    }

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

    if (hovered >= 0 && phase_ == Phase::Idle) {
        const GridCell& cell = cells[static_cast<std::size_t>(hovered)];
        stage(profile, cell.petalIndex, cell.rarity, ctx.window.shiftHeld());
    }
    return true;
}

} // namespace flix
