// The forge.
//
// Five slots in a ring, a Craft button beside them, and a grid of everything
// the account owns laid out as petal-per-row and tier-per-column -- which is
// the shape that makes "what am I five away from upgrading" readable at a
// glance, and is why the crafting grid is not the inventory grid.
//
// It is florr's craft window (menus.h), and the ring moves the way florr's
// does. Those motions were read out of florr's client, where the body's draw
// integrates them every frame (sub_1008378b0 and 0x1008387a0; the recorded
// frames are in ~/florr_images/menus_skia.json). Every one eases the same way,
// x += (target - x) * (1 - e^(-rate * dt)), with dt in milliseconds:
//
//   - a petal landing in a slot grows in, from nothing to the slot's size,
//     fading in and turning one full turn backwards as it does;
//   - while a craft rolls the ring's spin climbs toward 30 rad/s, and its
//     radius pulses in from 90 toward 40 on a 0.01 rad/ms sine whose depth
//     eases in; when the roll stops the spin runs down and the pulse out;
//   - when the outcome shows, the petals it spent vanish where they stand,
//     turning: all five on a success, which then draws the empty ring in
//     onto its centre and fades it while the upgrade -- half as large again
//     as a slot -- pops in with a pulse and a burst of grains; on a failure
//     a random set of slots, each with a few grains thrown along the turn.
//
// How long a roll lasts is the client's too (its craft-result handler,
// 0x1007e5530): a base time for the tier being crafted, cut the more of the
// next tier the account already holds, nothing at all when it holds the
// petal two tiers up or more, and on a failure stopped short by how many
// petals it cost. The Craft button wears the colour of the tier it crafts
// into whenever it can be pressed, grey otherwise.

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

/// The ring: five slots 60 across, 90 out from the slot's centre, the first
/// straight up.
constexpr double kRingRadius = 90.0;
constexpr double kRingSlot = 60.0;
constexpr double kRingStart = -kPi * 0.5;
/// A slot's grow toward 1 once a petal is in it.
constexpr double kGrowRate = 0.021400496636323946;
constexpr double kGrowDone = 0.99999;
/// The upgrade a success leaves in the ring's middle, and its burst: five
/// times florr's grains for its tier, mostly rising, at any angle. A failure
/// throws its tier's count once from each slot it empties.
constexpr double kResultSlot = 90.0;
constexpr int kBurstMultiplier = 5;
constexpr SlotBurstShape kBurst{200.0, 0.0, kTau};
/// The roll. The spin eases toward kRollSpin while rolling and back to rest
/// after, at different rates; the pulse's depth and the outcome's show ease
/// at the same rate as each other.
constexpr double kRollSpin = 30.0;
constexpr double kSpinUpRate = 0.000603020151210087;
constexpr double kSpinDownRate = 0.00632163093946958;
constexpr double kShakeRate = 0.0133886130788526;
constexpr double kShowRate = 0.0133886130788526;
/// The pulse: the radius dips by up to this much, on this sine of the clock.
constexpr double kPulseDepth = 50.0;
constexpr double kPulseRate = 0.01;
/// The roll's length by the tier crafted out of (float table 0x100E16A30):
/// common through legendary, and 5 s from there up -- florr stops at super,
/// and unique, a tier our ladder crafts out of and florr's does not, takes
/// the top figure too.
constexpr std::array<double, 5> kRollBaseMillis = {250.0, 750.0, 1500.0, 3000.0, 5000.0};
/// Holding this many of the next tier already cuts the roll to nothing; each
/// one held takes a tenth off.
constexpr double kRollHeldCut = 10.0;
/// A failure that cost n petals (1 to 4) stops at a random point between
/// (n - 1) / 4 and n / 4 of the way through.
constexpr double kRollLossStep = 0.25;
/// How long the ring waits on an outcome that has not come before it gives
/// up. The craft resolved server-side either way.
constexpr double kCraftTimeoutMillis = 8000.0;

/// florr's roll length for crafting `petal` out of `from`, before any loss.
double rollBaseMillis(const Profile& profile, std::uint16_t petal, Rarity from) {
    const int r = rarityIndex(from);
    const int top = rarityIndex(kTopLadderRarity);
    // Already holding it two tiers up or more: no suspense left.
    for (int up = r + 2; up <= top; ++up) {
        if (profile.stackCount(petal, static_cast<Rarity>(up)) > 0) return 0.0;
    }
    const double base =
        kRollBaseMillis[static_cast<std::size_t>(std::min<int>(r, kRollBaseMillis.size() - 1))];
    if (r + 2 > top) return base;
    const double held = static_cast<double>(profile.stackCount(petal, static_cast<Rarity>(r + 1)));
    return base * clamp((kRollHeldCut - held) / kRollHeldCut, 0.0, 1.0);
}

/// What a slot shows: petal and tier, or nothing.
constexpr std::uint32_t kNothing = 0xFFFFFFFFu;
std::uint32_t tileKey(std::uint16_t petal, Rarity rarity) {
    return (static_cast<std::uint32_t>(petal) << 8) | static_cast<std::uint32_t>(rarityIndex(rarity));
}

/// Uniform in [0, 1). Not reproducible and not meant to be: florr draws its
/// own from a thread-local generator.
double unitRandom() {
    static std::uint32_t state = 0x2545F491u;
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<double>(state % 1000000u) / 1000000.0;
}

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

Vec2 CraftingPanel::size(const Profile& profile) {
    // Common through unique: nothing upgrades out of apex, so there is no
    // column for it -- the same reason stage() refuses one.
    return {slotCardWidth(false), slotCardHeight(SlotGrid::rows(profile, false))};
}

void CraftingPanel::reset() {
    grid_.reset();
    stagedPetal_ = kNoPetal;
    batches_ = 0;
    phase_ = Phase::Idle;
    resultPending_ = false;
    spin_ = phaseAngle_ = shake_ = show_ = 0;
    grow_.fill(0.0);
    fx_.clear();
    revealed_ = false;
    slotKey_.fill(kNothing);
    resultKey_ = kNothing;
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

void CraftingPanel::animate(double dtMs) {
    const auto ease = [dtMs](double& value, double target, double rate) {
        value += (target - value) * (1.0 - std::exp(-rate * dtMs));
    };
    const bool rolling = phase_ == Phase::Spinning;
    ease(spin_, rolling ? kRollSpin : 0.0, rolling ? kSpinUpRate : kSpinDownRate);
    phaseAngle_ = std::fmod(phaseAngle_ + spin_ * dtMs / 1000.0, kTau);
    ease(shake_, rolling ? 1.0 : 0.0, kShakeRate);
    ease(show_, phase_ == Phase::Result && lastSuccess_ ? 1.0 : 0.0, kShowRate);
}

bool CraftingPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const double nowMs = ctx.timeSeconds * 1000.0;

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
    // animation survive the player tabbing away mid-roll.
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
        // A failure stops the roll short, by a random share of its length
        // that grows with what it cost.
        rollMillis_ = rollBaseMillis_;
        if (!lastSuccess_) {
            const int lost = std::clamp(kBatch - survivors_, 1, 4);
            const double from = kRollLossStep * (lost - 1);
            rollMillis_ *= from + unitRandom() * kRollLossStep;
        }
        // Mid-roll the outcome is only recorded; the ring owns when it is
        // shown. Anywhere else -- a result that arrived while the panel was
        // shut, or after the roll already ran out -- it lands now.
        if (phase_ == Phase::Spinning) {
            resultPending_ = true;
        } else {
            phase_ = Phase::Result;
            phaseStarted_ = ctx.timeSeconds;
        }
    }
    if (phase_ == Phase::Spinning) {
        const double elapsed = (ctx.timeSeconds - phaseStarted_) * 1000.0;
        if (elapsed >= rollMillis_ && resultPending_) {
            resultPending_ = false;
            phase_ = Phase::Result;
            phaseStarted_ = ctx.timeSeconds;
        } else if (elapsed >= kCraftTimeoutMillis) {
            phase_ = Phase::Idle;
        }
    }

    // The staged batch cannot outlive the petals behind it: another window, a
    // pickup, or the craft that just consumed them all change the stack. Never
    // during a roll, though -- those five are already at the server, and a
    // profile that lands a frame ahead of the result would empty the ring
    // half-way through its own animation.
    if (phase_ != Phase::Spinning && stagedPetal_ != kNoPetal &&
        ownedCount(profile, stagedPetal_, stagedRarity_) / kBatch < batches_) {
        batches_ = ownedCount(profile, stagedPetal_, stagedRarity_) / kBatch;
        if (batches_ <= 0) stagedPetal_ = kNoPetal;
    }

    animate(ctx.dt * 1000.0);

    const SlotCardLayout card =
        drawSlotCard(canvas, ctx.bounds, kCraftingSkin, "Craft", "Craft", mouse);
    const Rect panel = card.panel;

    // --- the ring ----------------------------------------------------------
    // Through the roll AND through a FAILED result the ring keeps showing the
    // petal as it was before the craft. A success replaces the ring with the
    // upgrade: the five went in and one came out.
    std::uint16_t ringPetal = stagedPetal_;
    Rarity ringRarity = stagedRarity_;
    if (phase_ == Phase::Spinning) {
        // The staging area went to the server whole on the click, so the roll
        // draws from its own copy of what was sent.
        ringPetal = spinPetal_;
        ringRarity = spinRarity_;
    } else if (phase_ == Phase::Result) {
        // The server answers a success with the upgraded tier, so the
        // original is one step back down.
        ringPetal = resultPetal_;
        ringRarity = lastSuccess_ ? downgradeRarity(resultRarity_) : resultRarity_;
    }
    const bool ringFilled = knownPetal(ringPetal);

    // The reveal frame: a success empties every slot -- the five went in --
    // and a failure a random set of them, as many as it cost. Each emptied
    // slot's petal vanishes where it stood, a failure's with a few grains
    // in its colour thrown along the ring's turn, and a success throws its
    // burst from the middle as the upgrade pops in.
    const bool inResult = phase_ == Phase::Result;
    const bool revealFrame = inResult && !revealed_;
    if (revealFrame) {
        revealed_ = true;
        survives_.fill(false);
        if (!lastSuccess_) {
            std::array<int, kBatch> order{0, 1, 2, 3, 4};
            for (int i = kBatch - 1; i > 0; --i) {
                std::swap(order[static_cast<std::size_t>(i)],
                          order[static_cast<std::size_t>(unitRandom() * (i + 1)) % (i + 1)]);
            }
            for (int k = 0; k < std::clamp(survivors_, 0, kBatch); ++k) {
                survives_[static_cast<std::size_t>(order[static_cast<std::size_t>(k)])] = true;
            }
        }
    }
    if (!inResult) revealed_ = false;

    // The ring draws in onto its centre and fades away as the outcome shows;
    // while rolling its radius pulses in on the clock by however deep the
    // shake has eased in.
    const double keep = 1.0 - show_;
    const double pulse = (std::sin(nowMs * kPulseRate) + 1.0) * 0.5;
    const double radius = (kRingRadius - kPulseDepth * shake_ * pulse) * keep;
    const double side = kRingSlot;

    std::array<Rect, kBatch> slots{};
    std::array<Vec2, kBatch> centres{};
    std::array<double, kBatch> angles{};
    canvas.setGlobalAlpha(static_cast<float>(clamp(keep, 0.0, 1.0)));
    for (int i = 0; i < kBatch; ++i) {
        const std::size_t at = static_cast<std::size_t>(i);
        angles[at] = kRingStart + kTau * i / kBatch + phaseAngle_;
        centres[at] = card.slot + Vec2::fromAngle(angles[at], radius);
        slots[at] = {centres[at].x - side * 0.5, centres[at].y - side * 0.5, side, side};
        if (keep > 0.001) drawSlotPlate(canvas, ctx.sprites, slots[at], kCraftingSkin);
    }
    canvas.setGlobalAlpha(1.0f);
    // The grains go under every petal.
    fx_.drawGrains(canvas, ctx.dt * 1000.0);

    for (int i = 0; i < kBatch; ++i) {
        const std::size_t at = static_cast<std::size_t>(i);
        ItemTile tile;
        tile.petalIndex = ringPetal;
        tile.rarity = ringRarity;
        tile.timeSeconds = ctx.timeSeconds;
        const bool occupied = ringFilled && (!inResult || (!lastSuccess_ && survives_[at]));
        double& grow = grow_[at];
        const std::uint32_t key = occupied ? tileKey(ringPetal, ringRarity) : kNothing;
        if (key != slotKey_[at]) {
            // What stood here vanishes where it stood, and grows in again only
            // as something new; a failure's lost petals also throw a few
            // grains in their colour along the ring's turn.
            if (slotKey_[at] != kNothing) {
                fx_.vanish(centres[at], side, slotTile_[at]);
                if (revealFrame && !lastSuccess_) {
                    // Along the ring's turn: radius times spin, tangent to it.
                    const Vec2 carry = Vec2::fromAngle(angles[at] + kPi * 0.5, radius * spin_);
                    fx_.burst(centres[at], slotTile_[at].rarity,
                              slotBurstGrains(slotTile_[at].rarity), kBurst, carry);
                }
            }
            slotKey_[at] = key;
            grow = 0.0;
        }
        if (!occupied) continue;
        grow += (1.0 - grow) * (1.0 - std::exp(-kGrowRate * ctx.dt * 1000.0));
        const bool growing = grow < kGrowDone;
        if (phase_ == Phase::Idle && batches_ > 1) {
            tile.badge = "x" + stackCountText(static_cast<std::uint64_t>(batches_));
        }
        slotTile_[at] = tile;
        // drawItemTile SETS the canvas's alpha rather than multiplying it, so
        // the ring's fade is folded in here.
        tile.alpha = clamp(keep, 0.0, 1.0) * (growing ? clamp(grow, 0.0, 1.0) : 1.0);
        drawSlotTile(canvas, ctx.sprites, centres[at], side * (growing ? grow : 1.0),
                     growing ? grow * -kTau : 0.0, tile);
    }

    // The upgrade, popped into the ring's middle once a success shows.
    const bool upgraded = inResult && lastSuccess_ && knownPetal(resultPetal_);
    ItemTile upgradeTile;
    upgradeTile.petalIndex = resultPetal_;
    upgradeTile.rarity = resultRarity_;
    // How many upgrades the pool actually produced -- a staged x3 that landed
    // twice reads "x2", which is the only place the player is told.
    if (resultCount_ > 1) {
        upgradeTile.badge = "x" + stackCountText(static_cast<std::uint64_t>(resultCount_));
    }
    upgradeTile.timeSeconds = ctx.timeSeconds;
    const std::uint32_t upgradeKey = upgraded ? tileKey(resultPetal_, resultRarity_) : kNothing;
    if (upgradeKey != resultKey_) {
        if (resultKey_ != kNothing) fx_.vanish(card.slot, kResultSlot, resultTile_);
        if (upgraded) {
            fx_.startPop();
            fx_.burst(card.slot, resultRarity_, kBurstMultiplier * slotBurstGrains(resultRarity_),
                      kBurst);
        }
        resultKey_ = upgradeKey;
    }
    if (upgraded) {
        resultTile_ = upgradeTile;
        fx_.drawPopped(canvas, ctx.sprites, card.slot, kResultSlot, ctx.dt * 1000.0, upgradeTile);
    }

    // --- craft button, the odds and the lines ---------------------------------
    const Rect craftRect = card.button;
    const bool canCraft = phase_ == Phase::Idle && stagedPetal_ != kNoPetal && batches_ > 0;
    drawSlotButton(canvas, craftRect, "Craft",
                   canCraft ? std::optional<std::uint32_t>(rarityColor(upgradeRarity(stagedRarity_)))
                            : std::nullopt,
                   craftRect.contains(mouse),
                   craftRect.contains(mouse) && ctx.window.mouseDown(MouseButton::Left));

    // A valid craft always has a chance above zero, even if it is a quarter of
    // a percent; a zero means nothing is staged, which reads as "?%".
    std::string odds = "?% success chance";
    if (stagedPetal_ != kNoPetal) {
        const double percent = std::min(100.0, craftSuccessChance(stagedRarity_) * 100.0 +
                                                   cloverBonus(profile, stagedRarity_));
        odds = percentText(percent) + " success chance";
    }
    drawSlotChance(canvas, card, odds);

    drawSlotLine(canvas, card, "Combine 5 of the same petal to craft an upgrade");
    // The warning only once there is something to lose.
    if (stagedPetal_ != kNoPetal) {
        drawSlotLine(canvas, card, "Failure will destroy 1-4 petals", std::nullopt, true);
    }

    // --- the grid ----------------------------------------------------------
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

    // Tiles on their way out go over everything.
    fx_.drawVanishing(canvas, ctx.sprites, ctx.dt * 1000.0);

    // --- input -------------------------------------------------------------
    // On press, not release: the browser hit-tests in mousedown, so a press
    // that starts on a cell and drifts off must not still fire.
    const bool rightPressed = panel.contains(mouse) && ctx.window.mousePressed(MouseButton::Right);
    if (phase_ == Phase::Idle && rightPressed) {
        removeBatch();
        return true;
    }
    if (!ctx.pressed() && !rightPressed) return true;
    if (card.close.contains(mouse) && ctx.pressed()) return false;

    // An outcome stays until the player does something else, florr's way:
    // the upgrade until it is clicked, the survivors of a failure until a
    // slot is. Picking a petal from the grid goes straight on -- the same
    // petal refills only the slots the failure emptied.
    if (phase_ == Phase::Result) {
        const Rect upgradeRect{card.slot.x - kResultSlot * 0.5, card.slot.y - kResultSlot * 0.5,
                               kResultSlot, kResultSlot};
        bool onSlot = upgraded && upgradeRect.contains(mouse);
        for (const Rect& slot : slots) onSlot = onSlot || slot.contains(mouse);
        if (onSlot) {
            phase_ = Phase::Idle;
            return true;
        }
        if (hovered) {
            phase_ = Phase::Idle;
            stage(profile, hovered->petalIndex, hovered->rarity, ctx.window.shiftHeld());
        }
        return true;
    }

    if (craftRect.contains(mouse)) {
        if (canCraft) {
            phase_ = Phase::Spinning;
            phaseStarted_ = ctx.timeSeconds;
            // Everything staged goes in ONE request, which the server crafts as
            // a pool and answers with a single result.
            spinPetal_ = stagedPetal_;
            spinRarity_ = stagedRarity_;
            // From the account as it stands before the craft lands.
            rollBaseMillis_ = rollBaseMillis(profile, stagedPetal_, stagedRarity_);
            rollMillis_ = rollBaseMillis_;
            ctx.net.requestCraft(stagedPetal_, stagedRarity_, batches_ * kBatch);
            // Handed over, so the staging area is empty from here: the ring is
            // drawing the roll's copy, not something still takeable back.
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
