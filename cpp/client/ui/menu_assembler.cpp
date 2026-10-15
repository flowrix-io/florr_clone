// The assembler.
//
// What the craft key opens while the flower stands at an assembler NPC (see
// shared/game/npc.h): one of each petal its recipe names, at the assembler's
// tier, for one of the petal it makes at that tier. Never a roll, and no wait.
//
// It is florr's assemble window, read out of florr's own client: the screen's
// draw of it (sub_1008d1230 under ~/florr_images/emulator/menus.py), with the
// body (0x100817ca0) fed a station -- the recipe index and tier florr reads
// off the assembler entity (+0x198/+0x199) and its recipe table
// (0x10234f910, built by 0x10081c920). Everything below is florr's:
//
//   - the craft family's card in machine grey #999999, 610 x 356, no grid;
//   - the assembler's one recipe (florr's assemblers each offer one; ours
//     rolls it when it is put down and sends it with the NPC);
//   - the recipe's inputs, each on a 60-unit seat in the theme's shade with
//     its tile grown in florr's way (scale, opacity and one backward turn,
//     0.0214/ms): one input on the slot's centre, two 45 either side of it,
//     three to five on a ring 90 out starting straight up. Each tile is
//     labelled "held/needed" -- florr's tile carries both, the held count at
//     +0xa4 and the recipe's count times the count at +0xa8 -- hung past its
//     corner as the oracle's cells are. Nothing stands in the middle until
//     an assembly lands;
//   - the Assemble button where the family keeps it, in the assembler's tier
//     colour while the bag can make the count, grey otherwise;
//   - under it the count: a 50 x 30 field between a left and a right
//     triangle. The field takes digits, and while it is not being typed in
//     the count is held to the most the bag can make, the field showing it.
//     The left triangle takes one off while the count is 2 or more, the right
//     one adds one while it is below that most -- each in the tier colour
//     while it does something, grey (#777777) while it does not. Sending an
//     assembly puts the count back to 1 (0x10081b941);
//   - the line: florr's UI/AssemblerCraft/Instructions.
//
// What florr's draw does once the assembly is sent could only be read in part
// (its animation state lives in statics the capture cannot keep straight): it
// throws its tier's grains from the middle, and after the answer the inputs
// move in. This one takes the family's own motions for it: the seats' tiles
// vanish where they stand as the grains fly, and the product pops into the
// middle with its burst -- held until it is collected, as the trader's coin
// is.

#include <algorithm>
#include <array>
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

/// florr's window: its least width, and its body with no grid under it.
constexpr double kWindowWidth = 610.0;
constexpr double kWindowHeight = 356.0;

/// The seats: 60 across about the slot's centre -- one on it, two 45 either
/// side of it, three or more on a ring 90 out with the first straight up.
constexpr double kSeatSide = 60.0;
constexpr double kPairOffset = 45.0;
constexpr double kRingRadius = 90.0;
/// A tile's grow into its seat, florr's (0x10083884b).
constexpr double kGrowRate = 0.021400496636323946;
constexpr double kGrowDone = 0.99999;
/// The product, as it pops into the middle.
constexpr double kResultSide = 90.0;

/// The count field and the triangles either side of it, in the body (florr:
/// a 50 x 30 field at (355, 150); triangles "M0-15 0 15 15 0Z" at (410, 165)
/// and mirrored at (350, 165), ringed 3 wide in their colour's shade).
constexpr double kCountX = 355.0;
constexpr double kCountY = 150.0;
constexpr double kCountW = 50.0;
constexpr double kCountH = 30.0;
constexpr double kArrowRightX = 410.0;
constexpr double kArrowLeftX = 350.0;
constexpr double kArrowY = 165.0;
constexpr double kArrowReach = 15.0;
constexpr double kArrowRimWidth = 3.0;
constexpr std::uint32_t kArrowIdle = 0x777777u;
/// The most digits the field takes: kAssemblerMaxBatch's.
constexpr std::size_t kCountDigits = 4;

/// The least an assembly shows its grains before the product lands -- ours,
/// not florr's, whose server takes as long as it takes.
constexpr double kAssembleMinMs = 1000.0;
constexpr double kAssembleTimeoutSeconds = 8.0;
constexpr double kRefusalSeconds = 3.0;
constexpr int kBurstMultiplier = 5;
constexpr SlotBurstShape kBurst{200.0, 0.0, kTau};

constexpr std::uint32_t kNothing = 0xFFFFFFFFu;

std::uint32_t tileKey(std::uint16_t petalIndex, Rarity rarity) {
    return (static_cast<std::uint32_t>(petalIndex) << 8) |
           static_cast<std::uint32_t>(rarityIndex(rarity));
}

/// Where seat `i` of `n` stands, from the slot's centre.
Vec2 seatOffset(std::size_t i, std::size_t n) {
    if (n <= 1) return {};
    if (n == 2) return {i == 0 ? kPairOffset : -kPairOffset, 0.0};
    return Vec2::fromAngle(-kPi * 0.5 + kTau * static_cast<double>(i) / static_cast<double>(n),
                           kRingRadius);
}

/// The field's text as a count, or -1 when it is not one: empty, or past
/// the cap.
int parsedCount(const std::string& text) {
    if (text.empty()) return -1;
    int n = 0;
    for (const char c : text) {
        if (c < '0' || c > '9') return -1;
        n = n * 10 + (c - '0');
        if (n > kAssemblerMaxBatch) return -1;
    }
    return n;
}

/// How many times the bag can run `recipe` at `tier`: the scarcest input,
/// over how many of it one run takes.
int affordable(const Profile& profile, const AssemblyRecipe& recipe, Rarity tier) {
    for (const AssemblyRecipe::Stack& output : recipe.outputs) {
        if (!knownPetal(output.petal)) return 0;
    }
    std::int64_t most = kAssemblerMaxBatch;
    for (const AssemblyRecipe::Stack& input : recipe.inputs) {
        if (!knownPetal(input.petal)) return 0;
        const std::int64_t takes = std::max<std::int64_t>(1, recipe.takes(input.petal));
        const std::int64_t held = static_cast<std::int64_t>(profile.stackCount(input.petal, tier));
        most = std::min(most, held / takes);
    }
    return static_cast<int>(most);
}

/// florr's triangle: its back edge `reach` either side of `at`, its point
/// `reach` along `facing` (1 right, -1 left), filled and ringed in the
/// fill's shade. Hovered, a live one lifts as the button does.
void drawArrow(Canvas& canvas, Vec2 at, double facing, std::uint32_t fill, bool hovered) {
    const auto f = [](double v) { return static_cast<float>(v); };
    if (hovered) fill = lighten(fill, 0.1);
    canvas.beginPath();
    canvas.moveTo(f(at.x), f(at.y - kArrowReach));
    canvas.lineTo(f(at.x), f(at.y + kArrowReach));
    canvas.lineTo(f(at.x + facing * kArrowReach), f(at.y));
    canvas.closePath();
    setFill(canvas, fill);
    canvas.fill();
    canvas.save();
    setStroke(canvas, slotCardShade(fill));
    canvas.setLineWidth(f(kArrowRimWidth));
    canvas.setLineJoin("round");
    canvas.stroke();
    canvas.restore();
}

/// Where a triangle drawn by drawArrow answers presses.
Rect arrowHit(Vec2 at, double facing) {
    const double left = facing > 0 ? at.x : at.x - kArrowReach;
    return {left - 4.0, at.y - kArrowReach - 2.0, kArrowReach + 8.0, kArrowReach * 2.0 + 4.0};
}

} // namespace

Vec2 AssemblerPanel::size() { return {kWindowWidth, kWindowHeight}; }

void AssemblerPanel::reset() {
    motion_.clear();
    count_ = "1";
    countField_.blur();
    phase_ = Phase::Idle;
    resultPending_ = false;
    refusal_.clear();
    // Nothing was showing before the card opened, so nothing vanishes as it
    // does, and every tile grows in afresh.
    seatKey_.fill(kNothing);
    seatGrow_.fill(0.0);
    seatShow_ = 1.0;
    resultKey_.fill(kNothing);
    for (SlotMotion& pop : pops_) pop.clear();
}

bool AssemblerPanel::render(MenuContext& ctx, std::uint16_t mobIndex, Rarity tier,
                            std::uint8_t recipeIndex) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    const double dtMs = std::max(0.0, ctx.dt) * 1000.0;

    // Another assembler -- another mob, tier or recipe -- drops whatever this
    // one was showing: the profile says how an assembly still out came back.
    if (mobIndex != stationMob_ || tier != stationTier_ || recipeIndex != stationRecipe_) {
        stationMob_ = mobIndex;
        stationTier_ = tier;
        stationRecipe_ = recipeIndex;
        phase_ = Phase::Idle;
        resultPending_ = false;
    }

    // A result the server sent while this face of the menu was not showing
    // still has to land, so it is read here rather than in the click.
    AssembleOutcome& outcome = ctx.net.assembleOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        if (outcome.success) {
            made_ = outcome.made;
            resultPending_ = true;
        } else {
            // Nothing left the bag: the seats grow back and the reason takes
            // the line's place.
            if (phase_ == Phase::Assembling) phase_ = Phase::Idle;
            refusal_ = outcome.reason.empty() ? "The assembler refused." : outcome.reason;
            refusalUntil_ = now + kRefusalSeconds;
        }
    }
    if (resultPending_ &&
        (phase_ != Phase::Assembling || (now - phaseStarted_) * 1000.0 >= kAssembleMinMs)) {
        resultPending_ = false;
        phase_ = Phase::Result;
        phaseStarted_ = now;
    }
    if (phase_ == Phase::Assembling && now - phaseStarted_ >= kAssembleTimeoutSeconds) {
        phase_ = Phase::Idle;
    }

    const SlotCardLayout card =
        drawSlotCard(canvas, ctx.bounds, kAssemblerSkin, "Assemble", "Assemble", mouse);
    const Rect panel = card.panel;
    const Vec2 body = card.body;

    // An assembler offers one recipe, as florr's does: the one it rolled.
    static const std::vector<AssemblyRecipe> kNoRecipes;
    const std::vector<AssemblyRecipe>& recipes =
        mobIndex < content().mobCount() ? content().mob(mobIndex).npc.recipes : kNoRecipes;
    if (recipeIndex >= recipes.size()) {
        drawSlotLine(canvas, card, kAssemblerInstructions);
        if (ctx.pressed() && card.close.contains(mouse)) return false;
        return true;
    }
    const AssemblyRecipe& recipe = recipes[recipeIndex];
    const int most = tier == Rarity::Universal ? 0 : affordable(profile, recipe, tier);

    // --- the count -----------------------------------------------------------
    // Typed while the field has the caret; held to what the bag can make, and
    // shown, while it does not -- an empty or unreadable field reads as 1.
    if (!countField_.focused) {
        const int typed = parsedCount(count_);
        count_ = std::to_string(std::max(0, std::min(typed < 0 ? 1 : typed, most)));
    }
    const int count = std::max(0, parsedCount(count_));
    const bool idle = phase_ == Phase::Idle;
    const bool canAssemble = idle && count >= 1 && count <= most;
    const bool canLess = idle && count >= 2;
    const bool canMore = idle && count < most;

    // --- the seats -----------------------------------------------------------
    const std::size_t seats = std::min(recipe.inputs.size(), kAssemblerMaxInputs);
    // The seats fade out while a product shows and back in once it is
    // collected, as the forge's ring does under its upgrade.
    seatShow_ += ((phase_ == Phase::Result ? 0.0 : 1.0) - seatShow_) *
                 (1.0 - std::exp(-kGrowRate * dtMs));
    std::array<Vec2, kAssemblerMaxInputs> centres{};
    canvas.setGlobalAlpha(static_cast<float>(std::clamp(seatShow_, 0.0, 1.0)));
    for (std::size_t i = 0; i < seats; ++i) {
        centres[i] = card.slot + seatOffset(i, seats);
        if (seatShow_ < 0.001) continue;
        drawSlotPlate(canvas, ctx.sprites,
                      {centres[i].x - kSeatSide * 0.5, centres[i].y - kSeatSide * 0.5, kSeatSide,
                       kSeatSide},
                      kAssemblerSkin);
    }
    canvas.setGlobalAlpha(1.0f);
    // The grains go under every tile.
    motion_.drawGrains(canvas, dtMs);

    // A seat holds its input while nothing is out: sent, the tiles vanish
    // where they stand, and they grow back in once the product is collected.
    for (std::size_t i = 0; i < seats; ++i) {
        const std::uint16_t input = recipe.inputs[i].petal;
        const bool occupied = idle && knownPetal(input);
        const std::uint32_t key = occupied ? tileKey(input, tier) : kNothing;
        if (key != seatKey_[i]) {
            if (seatKey_[i] != kNothing) motion_.vanish(centres[i], kSeatSide, seatTile_[i]);
            seatKey_[i] = key;
            seatGrow_[i] = 0.0;
        }
        if (!occupied) continue;
        ItemTile tile;
        tile.petalIndex = input;
        tile.rarity = tier;
        tile.timeSeconds = now;
        // florr's "held/needed": what the bag holds, and what the count in
        // the field takes of it -- one run's worth while the field reads 0.
        const std::uint64_t held = profile.stackCount(input, tier);
        const std::uint64_t needed = static_cast<std::uint64_t>(recipe.inputs[i].count) *
                                     static_cast<std::uint64_t>(std::max(1, count));
        tile.badge = stackCountText(held) + "/" + stackCountText(needed);
        tile.badgeCentred = true;
        seatTile_[i] = tile;
        double& grow = seatGrow_[i];
        grow += (1.0 - grow) * (1.0 - std::exp(-kGrowRate * dtMs));
        const bool growing = grow < kGrowDone;
        tile.alpha = growing ? std::clamp(grow, 0.0, 1.0) : 1.0;
        drawSlotTile(canvas, ctx.sprites, centres[i], kSeatSide * (growing ? grow : 1.0),
                     growing ? grow * -kTau : 0.0, tile);
    }

    // The products: nothing in the middle until an assembly lands, then
    // popped in with their burst -- one in the middle, several laid out as
    // the seats are -- and held there until they are collected.
    const std::size_t outputs = std::min(recipe.outputs.size(), kAssemblerMaxOutputs);
    const bool landed = phase_ == Phase::Result;
    const double resultSide = outputs == 1 ? kResultSide : kSeatSide;
    for (std::size_t i = 0; i < outputs; ++i) {
        const AssemblyRecipe::Stack& output = recipe.outputs[i];
        const Vec2 at = card.slot + seatOffset(i, outputs);
        const bool shows = landed && knownPetal(output.petal);
        const std::uint32_t key = shows ? tileKey(output.petal, tier) : kNothing;
        if (key != resultKey_[i]) {
            if (resultKey_[i] != kNothing) motion_.vanish(at, resultSide, resultTile_[i]);
            if (shows) {
                pops_[i].startPop();
                motion_.burst(at, tier, kBurstMultiplier * slotBurstGrains(tier), kBurst);
            }
            resultKey_[i] = key;
        }
        if (!shows) continue;
        ItemTile product;
        product.petalIndex = output.petal;
        product.rarity = tier;
        product.timeSeconds = now;
        const std::int64_t got = output.count * std::max(1, made_);
        if (got > 1) product.badge = "x" + stackCountText(static_cast<std::uint64_t>(got));
        resultTile_[i] = product;
        pops_[i].drawPopped(canvas, ctx.sprites, at, resultSide, dtMs, product);
    }

    // --- the button, the count and the line ---------------------------------
    const bool overButton = card.button.contains(mouse);
    drawSlotButton(canvas, card.button, "Assemble",
                   canAssemble ? std::optional<std::uint32_t>(rarityColor(tier)) : std::nullopt,
                   overButton && canAssemble,
                   overButton && canAssemble && ctx.window.mouseDown(MouseButton::Left));

    const Rect countRect{body.x + kCountX, body.y + kCountY, kCountW, kCountH};
    inputField(canvas, countRect, count_, "", countField_.focused, now, &countField_);
    const Vec2 less{body.x + kArrowLeftX, body.y + kArrowY};
    const Vec2 more{body.x + kArrowRightX, body.y + kArrowY};
    const Rect lessHit = arrowHit(less, -1.0);
    const Rect moreHit = arrowHit(more, 1.0);
    const std::uint32_t tierInk = rarityColor(tier);
    drawArrow(canvas, less, -1.0, canLess ? tierInk : kArrowIdle, canLess && lessHit.contains(mouse));
    drawArrow(canvas, more, 1.0, canMore ? tierInk : kArrowIdle, canMore && moreHit.contains(mouse));

    if (!refusal_.empty() && now < refusalUntil_) {
        drawSlotLine(canvas, card, refusal_, kSlotCardRefusalInk);
    } else {
        refusal_.clear();
        drawSlotLine(canvas, card, kAssemblerInstructions);
    }

    // Tiles on their way out go over everything.
    motion_.drawVanishing(canvas, ctx.sprites, dtMs);

    // --- input -------------------------------------------------------------
    // The field's own pointer handling first, unless Close takes the press.
    if (!(ctx.pressed() && card.close.contains(mouse))) {
        trackTextMouse(ctx.window, countField_, countRect,
                       inputFieldRun(countRect, count_, countField_), count_, now);
    }
    if (countField_.focused) {
        ctx.wantsText = true;
        TextEditOptions typing;
        typing.maxBytes = kCountDigits;
        typing.asciiOnly = true;
        if (editText(ctx.window, count_, countField_, now, typing)) {
            // Digits only: whatever else was typed or pasted is dropped, and
            // the caret goes to the end of what is left.
            std::string digits;
            for (const char c : count_) {
                if (c >= '0' && c <= '9') digits += c;
            }
            if (digits != count_) {
                count_ = digits;
                countField_.focusAtEnd(count_, now);
            }
        }
        if (ctx.window.keyPressed(Key::Enter) || ctx.window.keyPressed(Key::Escape)) {
            countField_.blur();
        }
    }
    if (countRect.contains(mouse)) ctx.window.setCursorShape(CursorShape::Text);

    if (!ctx.pressed()) return true;
    if (card.close.contains(mouse)) return false;
    // The field answered for its own press above.
    if (countRect.contains(mouse)) return true;

    // The product sits there until it is collected, and the press that
    // collects it does nothing else.
    if (phase_ == Phase::Result && panel.contains(mouse)) {
        phase_ = Phase::Idle;
        return true;
    }
    if (!idle) return true;

    if (overButton) {
        if (canAssemble) {
            phase_ = Phase::Assembling;
            phaseStarted_ = now;
            made_ = 0;
            refusal_.clear();
            countField_.blur();
            ctx.net.requestAssemble(tier, recipeIndex, static_cast<std::uint16_t>(count));
            // Sent: the grains fly from the middle as the seats empty, and
            // the count goes back to one.
            motion_.burst(card.slot, tier, slotBurstGrains(tier), kBurst);
            count_ = "1";
        }
        return true;
    }
    if (canLess && lessHit.contains(mouse)) {
        count_ = std::to_string(count - 1);
        return true;
    }
    if (canMore && moreHit.contains(mouse)) {
        count_ = std::to_string(count + 1);
        return true;
    }
    return true;
}

} // namespace flix
