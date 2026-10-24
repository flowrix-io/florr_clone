// The talent tree: florr's Talents window.
//
// Measured out of florr's own client rather than off screenshots: the screen
// render's talents slice (sub_1008d1230, 0x1008da402..0x1008da9c8, screen
// state 7) was run under the ~/florr_images emulator and every Skia call it
// made recorded, with the tree's body (0x10097c760), its tooltip builder
// (0x1009812e0) and the overlay pass that paints tooltips. The numbers below
// are those, at one window unit to the design unit.
//
// The window is 650 square at x = 95, its bottom 20 above the view's, rising
// from 50 below the view and fading in on florr's open ease (MenuSystem).
// Inside, 3 in from the edge and clipped there, the tree stands on florr's
// grid: columns 65 apart, rows 65 apart going up, under a projection that
// spreads the upper rows apart and bends the far columns down -- the tree is
// a dome you scroll across. Every root runs down to the flower in the middle
// of the bottom. Dragging the window sideways scrolls it, a column per 65
// units; so does the wheel, a column a notch.
//
// A node is bought by HOLDING it: 250 ms down on one the account can afford
// buys it and every tier still missing below it, the cost its badge shows.
//
// What is ours: the talents; how they are arranged -- the long branches wear
// florr's zig-zag and spiral, but which branch stands where and everything
// that forks off another is laid out for our tree (see branches()); and the
// icons, which are the ones this tree always had.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/render/mob_art.h"
#include "client/ui/text.h"
#include "client/world_view.h"
#include "shared/game/constants.h"
#include "shared/game/prestige.h"

namespace flix {

using namespace flix::ui;

namespace {

// -- the window ---------------------------------------------------------------

constexpr double kWindowSide = 650.0;
constexpr double kWindowX = 95.0;
constexpr double kWindowBottom = 20.0;
/// The tree and the TP badge are clipped to the window less 3 a side.
constexpr double kInset = 3.0;
/// The title: 24 on a 1.4 line, 10 in.
constexpr double kTitleSize = 24.0;
constexpr double kPad = 10.0;
constexpr double kLine = 1.4;
/// The close button, the craft window's: 25 square, 39 in from the right.
constexpr double kCloseSide = 25.0;
constexpr double kCloseFromRight = 39.0;
constexpr double kCloseRimGap = 2.0;
/// Reset: a b4 r4 button 28 tall, 10 in from the bottom-right corner, 14
/// either side of its 16-unit label (plus the label's outline padding).
constexpr double kResetHeight = 28.0;
constexpr double kResetPadX = 14.0;
constexpr double kResetLabelSize = 16.0;
constexpr double kButtonBorder = 4.0;
constexpr double kButtonRadius = 4.0;
constexpr std::uint32_t kResetFace = 0xDE1F1Fu;
constexpr std::uint32_t kResetIdleFace = 0x777777u;

/// The TP badge, inside the clip: a 23-radius disc of the theme's shade
/// centred 40 in, the count 36 on it, and "TP" 24 from 35 past its centre.
/// Hovering the strip they make, 56 tall from 12 in, shows a tooltip.
constexpr double kBadgeCentre = 40.0;
constexpr double kBadgeRadius = 23.0;
constexpr double kBadgeTextSize = 36.0;
constexpr double kBadgeLabelSize = 24.0;
constexpr double kBadgeLabelX = 35.0;
constexpr double kBadgeHitInset = 12.0;
constexpr double kBadgeHitHeight = 56.0;
constexpr double kBadgeHitExtra = 63.0;
constexpr double kBadgeTipY = 78.0;
constexpr const char* kBadgeTip = "You can acquire more TP by leveling up";
constexpr double kBadgeTipSize = 16.0;

// -- the tree -----------------------------------------------------------------

/// florr's grid: 65 between columns and between rows, and the projection's
/// two bends -- a row `y` up is spread 1 + y/4 times wider about the centre
/// column, and a node X across drops X tanh(X/200).
constexpr double kStep = 65.0;
constexpr double kSpread = 0.25;
constexpr double kBend = 0.005;
/// The top row sits this far above the inner area's bottom, less the rows,
/// and the flower 120 below the bottom row.
constexpr double kTreeBottom = 190.0;
constexpr double kFlowerDrop = 120.0;
constexpr double kFlowerRadius = 50.0;
constexpr double kHubRadius = 20.0;

/// A node: a 38.5 disc in its rim colour under a 32.5 one in its fill. The
/// cursor finds it within 32.5, and within 35.75 once it is already found.
constexpr double kNodeRim = 38.5;
constexpr double kNodeFace = 32.5;
constexpr double kHitRadius = 32.5;
constexpr double kHitRadiusHovered = 35.75;
/// What is left to pay, on a 14 disc of the rim colour at (26, -26), 20 high
/// and turned a sixteenth of a half turn.
constexpr double kCostAt = 26.0;
constexpr double kCostRadius = 14.0;
constexpr double kCostSize = 20.0;
constexpr double kCostTurn = kPi / 16.0;

/// Connectors: 8 wide, round, in the theme's shade, kept 10 clear of both
/// ends. Solid into a tier the account owns; otherwise 10-long dashes, one
/// every 20.
constexpr double kLinkWidth = 8.0;
constexpr double kLinkInset = 10.0;
constexpr double kDash = 10.0;
constexpr double kDashPitch = 20.0;

/// Holding a node: it buys after 250 ms and wobbles 10% in size, sin(0.03 t)
/// with t in ms, until the purchase lands. A purchase the server never
/// confirms stops wobbling after a few seconds.
constexpr double kHoldMs = 250.0;
constexpr double kWobbleRate = 0.03;
constexpr double kRequestTimeoutMs = 3000.0;

/// Every ease is x += (target - x)(1 - e^(-k dt)), dt in ms.
constexpr double kScrollRate = 0.00632163;
constexpr double kHoverRate = 0.0133886;
constexpr double kTipRate = 0.0214005;
constexpr double kFlashRate = 0.00435424;

/// A purchase: 40 grains of the tier's colour from the node, and the flower
/// bulging 10 bigger and back as its flash runs out.
constexpr int kBurstGrains = 40;
constexpr double kFlashBulge = 10.0;
constexpr SlotBurstShape kBurstShape{200.0, 0.0, kTau};

constexpr std::uint32_t kLockedFill = 0x777777u;
constexpr std::uint32_t kLockedRim = 0x606060u;
constexpr std::uint32_t kCostShort = 0xFF6666u;
constexpr std::uint32_t kFlowerBody = 0xFBE878u;

/// florr's tooltip box: half-black, corners rounded 5 with quadratics, the
/// text 7 in from either side, 5 from the top and 6 from the bottom. Over a
/// node it stands with its bottom 43.5 above the node's centre; the hint
/// under one has its top 40.5 below. A box never comes closer than 5 to the
/// view's sides.
constexpr double kTipPadX = 7.0;
constexpr double kTipPadTop = 5.0;
constexpr double kTipPadBottom = 6.0;
constexpr double kTipRadius = 5.0;
constexpr double kTipAbove = 43.5;
constexpr double kTipBelow = 40.5;
constexpr double kTipViewMargin = 5.0;
constexpr double kTipNameSize = 24.0;
constexpr double kTipBodySize = 14.0;
/// Between the rarity and the description.
constexpr double kTipGap = 16.0;
/// The badge's tooltip hangs under a point; florr's box top is 7 above it.
constexpr double kTipUnder = 7.0;

/// The two lines beside the flower: 14 high, starting 65 to its right, the
/// first ending level with its centre.
constexpr double kStatSize = 14.0;
constexpr double kStatX = 65.0;

/// Body damage is never surfaced to the client, so the line quotes a fixed
/// base under the tree's multiplier rather than inventing a level curve.
constexpr double kDisplayBodyDamage = 25.0;

// -- the layout ---------------------------------------------------------------

struct GridPoint {
    double x;
    double y;
};

/// florr's two shapes for a long branch, nine tiers each, as columns from the
/// shape's left edge and rows up: the zig-zag its Petal Health climbs in, and
/// the spiral its Reload winds in.
constexpr std::array<GridPoint, 9> kZigZag = {{
    {2, 0}, {1, 1}, {0, 0}, {0, 2}, {2, 2}, {2, 4}, {1, 3}, {0, 4}, {1, 5},
}};
constexpr std::array<GridPoint, 9> kSpiral = {{
    {1, 0}, {0, 2}, {0, 3.5}, {1, 4}, {2, 4}, {3, 3}, {3, 1}, {1, 1.5}, {2, 2},
}};

/// The zig-zag from column `left`, mirrored when asked, with our apex tier
/// added on top at `apex` (a column of the shape and a row).
std::vector<GridPoint> zigZag(double left, bool mirrored, GridPoint apex) {
    std::vector<GridPoint> points;
    for (const GridPoint& p : kZigZag) points.push_back({left + (mirrored ? 2.0 - p.x : p.x), p.y});
    points.push_back({left + apex.x, apex.y});
    return points;
}

std::vector<GridPoint> spiral(double left) {
    std::vector<GridPoint> points;
    for (const GridPoint& p : kSpiral) points.push_back({left + p.x, p.y});
    return points;
}

struct Branch {
    SkillId skill;
    std::vector<GridPoint> points;
};

/// Left to right. The long branches wear florr's shapes; what branches OFF
/// them is ours, laid out for our forks:
///   - Flower Health's zig-zag is mirrored so its rare tier stands at the
///     bottom right, and Second Chance climbs away from it toward the
///     middle;
///   - Prestige stands alone just right of the flower;
///   - Reload winds in the spiral (nine tiers, like florr's own);
///   - Healing is four tiers up the start of a zig-zag;
///   - Absorption's zig-zag is mirrored so legendary and mythic both stand
///     on its left edge, a column clear of Healing: Magnetism hooks off
///     legendary to the left and curls down and back in, and Duplicator
///     climbs off mythic up-left above it.
/// Checked across every scroll: no two nodes come closer than 92 (florr's own
/// tree comes to 81), Magnetism's none closer than 116, and no connector
/// crosses another.
const std::vector<Branch>& branches() {
    static const std::vector<Branch> kBranches = {
        {SkillId::PetalHealth, zigZag(0.0, false, {2, 5.5})},
        {SkillId::PetHealth, zigZag(3.5, false, {2, 5.5})},
        {SkillId::PlayerHealth, zigZag(7.0, true, {0, 5.5})},
        {SkillId::SecondChance, {{10.2, 1.0}, {10.7, 2.4}}},
        {SkillId::Prestige, {{12.2, 0}}},
        {SkillId::Damage, zigZag(13.7, false, {2, 5.5})},
        {SkillId::Reload, spiral(17.2)},
        {SkillId::Healing, {{21.7, 0}, {22.7, 1}, {21.7, 2}, {21.7, 4}}},
        {SkillId::Magnetism, {{25.3, 2.5}, {23.7, 2.2}, {24.4, 0.6}}},
        {SkillId::Absorbing, zigZag(27.0, true, {2, 5.5})},
        {SkillId::Duplicator, {{26.0, 4.8}, {25.2, 5.5}}},
    };
    return kBranches;
}

/// Where the window first opens: the middle of the tree, Flower Health and
/// Second Chance to the left of the flower and Prestige beside it.
constexpr double kStartColumn = 11.0;

/// The grid point `grid` under a scroll that has column `scroll` at the
/// centre, relative to the tree's origin: florr's 0x100982860.
Vec2 project(Vec2 grid, double scroll, double topRow) {
    const double gx = grid.x - scroll;
    const double across = gx * kStep;
    return {across + kSpread * gx * grid.y * kStep,
            kStep * (topRow - grid.y) + across * std::tanh(kBend * across)};
}

double ease(double dtMs, double rate) { return 1.0 - std::exp(-rate * dtMs); }

/// A colour's channels scaled by `k` and pulled toward `toward` by the rest.
std::uint32_t mixChannels(std::uint32_t c, double k, double toward) {
    const auto channel = [&](int shift) {
        const double v = static_cast<double>((c >> shift) & 0xFFu) * k + toward * (1.0 - k);
        return static_cast<std::uint32_t>(std::clamp(v, 0.0, 255.0)) << shift;
    };
    return channel(16) | channel(8) | channel(0);
}

/// A tier's own colour: its rarity's, or Prestige's yellow.
std::uint32_t tierColor(SkillId skill, int tier) {
    return skill == SkillId::Prestige ? kPrestigeYellow : rarityColor(clampRarity(tier));
}

/// florr's labels: white unless told, black outline at 0.12 of the size, round
/// joins, centred on `y`.
TextStyle florrLabel(double size, std::uint32_t fill = kPaper, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.align = align;
    style.baseline = Baseline::Middle;
    style.roundJoin = true;
    return style;
}

/// The padding florr's text widget adds to a run for its outline.
double outlinePad(double size) {
    return 2.0 * std::floor(2.0 * size * kTextStrokeRatio);
}

// -- the tooltip --------------------------------------------------------------

struct Run {
    std::string text;
    std::uint32_t color = kPaper;
};

struct TipRow {
    double size = kTipBodySize;
    std::vector<Run> runs;
    double gapBefore = 0.0;
};

double rowWidth(const TipRow& row) {
    double width = 0.0;
    for (const Run& run : row.runs) width += measure(run.text, row.size);
    return width;
}

Vec2 tipSize(const std::vector<TipRow>& rows) {
    double width = 0.0;
    double height = kTipPadTop + kTipPadBottom;
    for (const TipRow& row : rows) {
        width = std::max(width, rowWidth(row));
        height += row.gapBefore + row.size * kLine;
    }
    return {width + kTipPadX * 2.0, height};
}

/// The box with its top-left at `at`, at `alpha`: black at half of it, the
/// text at all of it.
void paintTip(Canvas& canvas, Vec2 at, const std::vector<TipRow>& rows, double alpha) {
    const Vec2 size = tipSize(rows);
    const double base = canvas.globalAlpha();
    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(base * alpha * 0.5));
    fillQuadRound(canvas, {at.x, at.y, size.x, size.y}, kTipRadius, kInk);
    canvas.setGlobalAlpha(static_cast<float>(base * alpha));
    double top = at.y + kTipPadTop;
    for (const TipRow& row : rows) {
        top += row.gapBefore;
        double penX = at.x + kTipPadX;
        const double middle = top + row.size * kLine * 0.5;
        for (const Run& run : row.runs) {
            text(canvas, run.text, penX, middle, florrLabel(row.size, run.color));
            penX += measure(run.text, row.size);
        }
        top += row.size * kLine;
    }
    canvas.restore();
}

/// Where a box of `size` stands centred on `x`, kept inside the view.
double tipLeft(double x, double width, double viewWidth) {
    const double left = x - width * 0.5;
    return std::clamp(left, kTipViewMargin, std::max(kTipViewMargin, viewWidth - kTipViewMargin - width));
}

std::string percent(double fraction) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.0f%%", fraction * 100.0);
    return buffer;
}

/// "from X% to Y%" over one of the tree's tables: what the tier below gave,
/// or 100% with nothing below, and what this one gives.
std::string fromTo(const std::array<double, kLadderRarityCount>& table, int tier) {
    const double before = tier > 0 ? scaleAt(table, tier - 1) : 1.0;
    return "from " + percent(before) + " to " + percent(scaleAt(table, tier)) + ".";
}

/// A tier's description, in florr's words for the talent where florr has it
/// and in its manner where it does not: stat names in their stat colours.
std::vector<TipRow> description(SkillId skill, int tier) {
    std::vector<TipRow> rows;
    const auto row = [&](std::vector<Run> runs) { rows.push_back({kTipBodySize, std::move(runs)}); };
    char buffer[96];
    switch (skill) {
        case SkillId::PlayerHealth:
            row({{"Increases base "}, {"Flower Health", kStatHealth},
                 {" " + fromTo(kStatSkillScale, tier)}});
            break;
        case SkillId::Damage:
            // One talent, two curves: a body slam on the stat table, every
            // petal hit on the effect table (see recomputeModifiers).
            row({{"Increases "}, {"Body Damage", kStatDamage}, {" " + fromTo(kStatSkillScale, tier)}});
            row({{"Increases petal "}, {"Damage", kStatDamage},
                 {" " + fromTo(kEffectSkillScale, tier)}});
            break;
        case SkillId::PetalHealth:
            row({{"Increases "}, {"Petal Health", kStatHealth},
                 {" " + fromTo(kHealthSkillScale, tier)}});
            break;
        case SkillId::PetHealth:
            row({{"Increases "}, {"Health", kStatHealth},
                 {" of summoned mobs " + fromTo(kHealthSkillScale, tier)}});
            break;
        case SkillId::Healing:
            row({{"Increases "}, {"Healing", kStatHeal},
                 {" from your petals " + fromTo(kEffectSkillScale, tier)}});
            break;
        case SkillId::Absorbing:
            row({{"Increases absorb XP " + fromTo(kAbsorbSkillScale, tier)}});
            break;
        case SkillId::Reload: {
            // A reload is a wait, so florr quotes what comes OFF it.
            const double before = tier > 0 ? 1.0 - scaleAt(kReloadSkillScale, tier - 1) : 0.0;
            const double after = 1.0 - scaleAt(kReloadSkillScale, tier);
            row({{"Decreases the reload time for petals from -" + percent(before) + " to -" +
                  percent(after) + "."}});
            break;
        }
        case SkillId::SecondChance: {
            const auto [duration, cooldown] = secondChanceEffect(tier);
            if (tier == 0) {
                std::snprintf(buffer, sizeof buffer,
                              "Prevents death for %gs upon taking fatal damage. Has a %gs cooldown.",
                              duration / 1000.0, cooldown / 1000.0);
            } else {
                std::snprintf(buffer, sizeof buffer,
                              "Increases duration to %gs, decreases cooldown to %gs.",
                              duration / 1000.0, cooldown / 1000.0);
            }
            row({{buffer}});
            break;
        }
        case SkillId::Duplicator:
            std::snprintf(buffer, sizeof buffer, "Adds %s for petals that have at least %d copies.",
                          tier == 0 ? "an extra copy" : "two extra copies", kDuplicatorMinCopies);
            row({{buffer}});
            break;
        case SkillId::Magnetism: {
            const auto at = static_cast<std::size_t>(std::clamp(tier, 0, 2));
            std::snprintf(buffer, sizeof buffer, "Increases petal pick up range by %.0f.",
                          kMagnetismBonus[at]);
            row({{buffer}});
            break;
        }
        case SkillId::Prestige:
            row({{"Unlocks the "}, {"Prestige", kPrestigeYellow}, {" biomes."}});
            row({{"Every mob there is +1 rarity."}});
            row({{"No Unique or Apex mobs spawn there."}});
            break;
        default: break;
    }
    return rows;
}

/// Name, rarity, then the description 16 under them. Prestige has no tier to
/// name, so its box goes straight from the name to the description.
std::vector<TipRow> tooltipRows(SkillId skill, int tier) {
    std::vector<TipRow> rows;
    rows.push_back({kTipNameSize, {{skillTierLabel(skill, tier)}}});
    if (skill != SkillId::Prestige) {
        const Rarity rarity = clampRarity(tier);
        rows.push_back({kTipBodySize, {{rarityLabel(rarity), rarityColor(rarity)}}});
    }
    std::vector<TipRow> body = description(skill, tier);
    if (!body.empty()) body.front().gapBefore = kTipGap;
    rows.insert(rows.end(), body.begin(), body.end());
    return rows;
}

// -- icons --------------------------------------------------------------------

/// The icon's full extent inside a node: our own marks, unchanged from the
/// tree they were drawn for.
constexpr double kIconExtent = 35.0 * 0.89;

/// A rounded plus. Two overlapping capsules rather than one traced outline:
/// the corners the reference rounds are the four outer ends, and every one of
/// them is the end of a bar.
void roundedCross(Canvas& canvas, Vec2 at, double extent, double thickness) {
    const double half = extent * 0.5;
    const double bar = thickness * 0.5;
    const auto round = static_cast<float>(thickness * 0.22);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(at.x - bar), static_cast<float>(at.y - half),
                     static_cast<float>(thickness), static_cast<float>(extent), round);
    canvas.fill();
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(at.x - half), static_cast<float>(at.y - bar),
                     static_cast<float>(extent), static_cast<float>(thickness), round);
    canvas.fill();
}

void drawIcon(Canvas& canvas, SkillId id, int tier, Vec2 at, double size) {
    // `size` is the glyph's FULL extent, not a radius and not a font size, so
    // every branch's mark occupies the same square of the node however it is
    // built. Everything below is a fraction of it. `tier` matters only to a
    // branch whose tiers wear different marks.
    const double half = size * 0.5;

    canvas.save();
    setFill(canvas, kPaper);
    setStroke(canvas, kPaper);
    canvas.setLineCap("round");
    canvas.setLineJoin("round");

    switch (id) {
        case SkillId::PlayerHealth: {   // a medical cross
            roundedCross(canvas, at, size, size * 0.37);
            break;
        }
        case SkillId::Damage: {         // a five-petal flower
            for (int i = 0; i < 5; ++i) {
                const double a = (i / 5.0) * kTau - kPi * 0.5;
                const Vec2 petal = at + Vec2::fromAngle(a, half * 0.58);
                canvas.beginPath();
                // The long axis points OUTWARD -- radiusX is measured along the
                // ellipse's own rotation -- so five petals read as a flower
                // rather than as a clover with its lobes touching.
                canvas.ellipse(static_cast<float>(petal.x), static_cast<float>(petal.y),
                               static_cast<float>(half * 0.42), static_cast<float>(half * 0.29),
                               static_cast<float>(a), 0.0f, static_cast<float>(kTau));
                canvas.fill();
            }
            canvas.fillCircle(static_cast<float>(at.x), static_cast<float>(at.y),
                              static_cast<float>(half * 0.30));
            break;
        }
        case SkillId::PetalHealth: {    // a plus inside a ring
            // The same mark Flower Health wears, boxed in: the two branches do
            // the same thing to two different pools, and reading as a pair is
            // the point. The ring is what says WHOSE health -- the petal is the
            // thing that goes round the flower.
            const double weight = size * 0.12;
            const double ring = half - weight * 0.5;
            canvas.setLineWidth(static_cast<float>(weight));
            canvas.beginPath();
            canvas.arc(static_cast<float>(at.x), static_cast<float>(at.y),
                       static_cast<float>(ring), 0.0f, static_cast<float>(kTau));
            canvas.stroke();
            // Sized so the cross's corners clear the ring's inner edge with a
            // little air: the arms reach 0.54 of the glyph and the bar is 0.20
            // of it, putting the furthest corner inside the 0.76 the ring
            // leaves. Filling that gap makes the two read as one blob.
            roundedCross(canvas, at, size * 0.54, size * 0.20);
            break;
        }
        case SkillId::PetHealth: {      // an egg
            // The third of the health family: the outline that says whose
            // health, with no cross inside. A pet is hatched from an egg, so
            // the outline is one -- a narrow crown and a wide base, widest a
            // little below the middle.
            const double weight = size * 0.11;
            const double tall = half - weight * 0.5;
            const double wide = tall * 0.76;
            // Where the egg is widest, and the one quarter-ellipse split: the
            // crown is the taller quarter, which is what narrows it.
            const double belly = tall * 0.12;
            constexpr double kKappa = 0.5523;
            const double crown = tall + belly;
            const double base = tall - belly;
            const auto x = [&](double dx) { return static_cast<float>(at.x + dx); };
            const auto y = [&](double dy) { return static_cast<float>(at.y + dy); };

            canvas.setLineWidth(static_cast<float>(weight));
            canvas.beginPath();
            canvas.moveTo(x(0.0), y(-tall));
            canvas.bezierCurveTo(x(wide * kKappa), y(-tall), x(wide), y(belly - crown * kKappa),
                                 x(wide), y(belly));
            canvas.bezierCurveTo(x(wide), y(belly + base * kKappa), x(wide * kKappa), y(tall),
                                 x(0.0), y(tall));
            canvas.bezierCurveTo(x(-wide * kKappa), y(tall), x(-wide), y(belly + base * kKappa),
                                 x(-wide), y(belly));
            canvas.bezierCurveTo(x(-wide), y(belly - crown * kKappa), x(-wide * kKappa), y(-tall),
                                 x(0.0), y(-tall));
            canvas.closePath();
            canvas.stroke();
            break;
        }
        case SkillId::Healing: {        // a heart, drawn as an outline
            const double s = half * 0.92;
            canvas.setLineWidth(static_cast<float>(size * 0.11));
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x), static_cast<float>(at.y + s * 0.86));
            canvas.bezierCurveTo(static_cast<float>(at.x + s * 1.35), static_cast<float>(at.y - s * 0.10),
                                 static_cast<float>(at.x + s * 0.62), static_cast<float>(at.y - s * 1.05),
                                 static_cast<float>(at.x), static_cast<float>(at.y - s * 0.24));
            canvas.bezierCurveTo(static_cast<float>(at.x - s * 0.62), static_cast<float>(at.y - s * 1.05),
                                 static_cast<float>(at.x - s * 1.35), static_cast<float>(at.y - s * 0.10),
                                 static_cast<float>(at.x), static_cast<float>(at.y + s * 0.86));
            canvas.stroke();
            break;
        }
        case SkillId::SecondChance: {   // a shield
            const double s = half * 0.92;
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x), static_cast<float>(at.y + s));
            canvas.lineTo(static_cast<float>(at.x - s * 0.78), static_cast<float>(at.y + s * 0.09));
            canvas.lineTo(static_cast<float>(at.x - s * 0.78), static_cast<float>(at.y - s * 0.45));
            canvas.quadraticCurveTo(static_cast<float>(at.x), static_cast<float>(at.y - s * 1.0),
                                    static_cast<float>(at.x + s * 0.78), static_cast<float>(at.y - s * 0.45));
            canvas.lineTo(static_cast<float>(at.x + s * 0.78), static_cast<float>(at.y + s * 0.09));
            canvas.closePath();
            canvas.fill();
            break;
        }
        case SkillId::Reload: {         // a stopwatch
            const double face = half * 0.80;
            const double weight = size * 0.11;
            canvas.setLineWidth(static_cast<float>(weight));
            // The case, left open at the top so the crown has somewhere to sit:
            // a closed ring with a stub on it reads as a balloon.
            canvas.beginPath();
            canvas.arc(static_cast<float>(at.x), static_cast<float>(at.y + half * 0.12),
                       static_cast<float>(face), static_cast<float>(-kPi * 0.36),
                       static_cast<float>(kPi + kPi * 0.36), false);
            canvas.stroke();
            // The crown: a short bar across the gap, and a stem joining it to
            // the two ends of the case.
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x - half * 0.30),
                          static_cast<float>(at.y - half * 0.86));
            canvas.lineTo(static_cast<float>(at.x + half * 0.30),
                          static_cast<float>(at.y - half * 0.86));
            canvas.stroke();
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x), static_cast<float>(at.y - half * 0.86));
            canvas.lineTo(static_cast<float>(at.x), static_cast<float>(at.y - half * 0.52));
            canvas.stroke();
            // The hands: noon and three. Both stop well inside the case -- a
            // round cap adds half the line width to each end, and a minute hand
            // drawn to the rim joins the crown's stem into one stalk through
            // the middle of the face.
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x), static_cast<float>(at.y + half * 0.12));
            canvas.lineTo(static_cast<float>(at.x), static_cast<float>(at.y - half * 0.22));
            canvas.stroke();
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(at.x), static_cast<float>(at.y + half * 0.12));
            canvas.lineTo(static_cast<float>(at.x + half * 0.36),
                          static_cast<float>(at.y + half * 0.12));
            canvas.stroke();
            break;
        }
        case SkillId::Absorbing: {      // a fork and a knife
            // Absorbing a petal is EATING it, and the place setting is the one
            // mark for that a player does not have to be taught. Both pieces
            // are built the same way -- a filled handle with a head on top --
            // so they sit at the same weight beside each other.
            const double fork = at.x - half * 0.45;
            const double blade = at.x + half * 0.45;

            canvas.setLineWidth(static_cast<float>(size * 0.10));
            for (int tine = -1; tine <= 1; ++tine) {
                const double x = fork + tine * half * 0.26;
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(x), static_cast<float>(at.y - half * 0.80));
                canvas.lineTo(static_cast<float>(x), static_cast<float>(at.y - half * 0.34));
                canvas.stroke();
            }
            // The head the three tines run into, and the handle below it. Two
            // shapes rather than one outline: the tines are strokes, and a
            // traced fork would have to re-describe every one of them.
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(fork - half * 0.37),
                             static_cast<float>(at.y - half * 0.44),
                             static_cast<float>(half * 0.74), static_cast<float>(half * 0.32),
                             static_cast<float>(half * 0.12));
            canvas.fill();
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(fork - half * 0.13),
                             static_cast<float>(at.y - half * 0.25),
                             static_cast<float>(half * 0.26), static_cast<float>(half * 1.10),
                             static_cast<float>(half * 0.13));
            canvas.fill();

            // The blade: a straight spine down the left, the cutting edge
            // bellying out to the right and tapering back to the point. The
            // belly carries the whole shape -- at a third of the glyph wide it
            // is a knife, and at the handle's own width it is a second fork
            // handle with nothing on the end.
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(blade - half * 0.12),
                          static_cast<float>(at.y - half * 0.88));
            canvas.quadraticCurveTo(
                static_cast<float>(blade + half * 0.34), static_cast<float>(at.y - half * 0.52),
                static_cast<float>(blade + half * 0.26), static_cast<float>(at.y - half * 0.08));
            canvas.lineTo(static_cast<float>(blade - half * 0.12),
                          static_cast<float>(at.y - half * 0.08));
            canvas.closePath();
            canvas.fill();
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(blade - half * 0.13),
                             static_cast<float>(at.y - half * 0.16),
                             static_cast<float>(half * 0.26), static_cast<float>(half * 1.02),
                             static_cast<float>(half * 0.13));
            canvas.fill();
            break;
        }
        case SkillId::Duplicator: {
            if (tier == 0) {        // two circles splitting apart
                // Overlapping by a sliver, so the pair still shares a pinched
                // neck: a cell caught mid-division, not two coins side by side.
                // The arcs outside each half say which way they are going.
                // Wider than the glyph square: two discs in a row are short,
                // and kept inside it they read a size smaller than every other
                // mark on the tree. The node has the room either side.
                const double r = half * 0.48;
                const double apart = half * 0.44;
                for (const double side : {-1.0, 1.0}) {
                    canvas.fillCircle(static_cast<float>(at.x + side * apart),
                                      static_cast<float>(at.y), static_cast<float>(r));
                }
                canvas.setLineWidth(static_cast<float>(size * 0.08));
                for (const double side : {-1.0, 1.0}) {
                    const double facing = side < 0.0 ? kPi : 0.0;
                    canvas.beginPath();
                    canvas.arc(static_cast<float>(at.x + side * apart), static_cast<float>(at.y),
                               static_cast<float>(r + half * 0.22), static_cast<float>(facing - 0.6),
                               static_cast<float>(facing + 0.6), false);
                    canvas.stroke();
                }
            } else {                // three circles
                // Point-up triangle, lowered by half the difference between
                // its top and bottom reach so the three sit centred in the node.
                const double r = half * 0.46;
                const double spoke = half * 0.64;
                const double lift = (spoke - spoke * 0.5) * 0.5;
                for (int i = 0; i < 3; ++i) {
                    const Vec2 c = at + Vec2::fromAngle(-kPi * 0.5 + kTau * i / 3.0, spoke) +
                                   Vec2{0.0, lift};
                    canvas.fillCircle(static_cast<float>(c.x), static_cast<float>(c.y),
                                      static_cast<float>(r));
                }
            }
            break;
        }
        case SkillId::Magnetism: {      // a horseshoe magnet
            // A thick U opening upward, its two poles cut off by a gap across
            // each arm -- the cut is what makes a U a magnet. Filled shapes
            // rather than one stroke, so the poles are solid blocks and not
            // capped line ends.
            const double weight = half * 0.50;
            const double outer = half * 0.92;
            const double inner = outer - weight;
            const double bendY = at.y + half * 0.04;
            const double cut = at.y - half * 0.42;
            const double gap = half * 0.14;
            const double top = at.y - half * 0.94;
            const auto x = [&](double dx) { return static_cast<float>(at.x + dx); };
            const auto y = [&](double py) { return static_cast<float>(py); };

            canvas.beginPath();
            canvas.moveTo(x(-outer), y(cut));
            canvas.lineTo(x(-outer), y(bendY));
            canvas.arc(x(0.0), y(bendY), static_cast<float>(outer), static_cast<float>(kPi), 0.0f, true);
            canvas.lineTo(x(outer), y(cut));
            canvas.lineTo(x(inner), y(cut));
            canvas.lineTo(x(inner), y(bendY));
            canvas.arc(x(0.0), y(bendY), static_cast<float>(inner), 0.0f, static_cast<float>(kPi), false);
            canvas.lineTo(x(-inner), y(cut));
            canvas.fill();
            for (const double side : {-1.0, 1.0}) {
                const double left = side < 0.0 ? -outer : inner;
                canvas.beginPath();
                canvas.rect(x(left), y(top), static_cast<float>(weight), static_cast<float>(cut - gap - top));
                canvas.fill();
            }
            break;
        }
        case SkillId::Prestige: {      // two chevrons climbing
            // Stroked rather than filled: a chevron is a bent line, and round
            // caps and joins give it the same soft ends every other mark has.
            canvas.setLineWidth(static_cast<float>(size * 0.16));
            for (const double lift : {-0.30, 0.22}) {
                const double tipY = at.y + half * (lift - 0.30);
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(at.x - half * 0.62),
                              static_cast<float>(tipY + half * 0.52));
                canvas.lineTo(static_cast<float>(at.x), static_cast<float>(tipY));
                canvas.lineTo(static_cast<float>(at.x + half * 0.62),
                              static_cast<float>(tipY + half * 0.52));
                canvas.stroke();
            }
            break;
        }
        default: break;
    }
    canvas.restore();
}

// -- the flower ---------------------------------------------------------------

/// The flower at the root of the tree, its pupils turned toward the cursor.
/// Drawn in the 25-unit face space the world renderer uses.
void drawAvatar(Canvas& canvas, Vec2 at, double radius, Vec2 eye) {
    const auto eyeX = static_cast<float>(eye.x);
    const auto eyeY = static_cast<float>(eye.y);
    constexpr float kTauF = static_cast<float>(kTau);

    canvas.save();
    canvas.translate(static_cast<float>(at.x), static_cast<float>(at.y));
    canvas.scale(static_cast<float>(radius / 25.0), static_cast<float>(radius / 25.0));

    setFill(canvas, shade(kFlowerBody, 0.8));
    canvas.beginPath();
    canvas.arc(0, 0, 26.5f, 0, kTauF);
    canvas.fill();
    setFill(canvas, kFlowerBody);
    canvas.beginPath();
    canvas.arc(0, 0, 23.5f, 0, kTauF);
    canvas.fill();

    canvas.save();
    setFill(canvas, kInk);
    canvas.beginPath();
    canvas.ellipse(-7, -4.8f, 3.2f, 6.5f, 0, 0, kTauF);
    canvas.moveTo(10.2f, -4.8f);
    canvas.ellipse(7, -4.8f, 3.2f, 6.5f, 0, 0, kTauF);
    canvas.fill();
    // Pupils and rim are drawn clipped to the eyes, so only the inner half of
    // the outline shows and a pupil at the edge is cut off.
    canvas.clip();
    setFill(canvas, kPaper);
    canvas.beginPath();
    canvas.arc(-7 + eyeX, -4.8f + eyeY, 3, 0, kTauF);
    canvas.arc(7 + eyeX, -4.8f + eyeY, 3, 0, kTauF);
    canvas.fill();
    setStroke(canvas, kInk);
    canvas.setLineWidth(1.0f);
    canvas.beginPath();
    canvas.ellipse(-7, -4.8f, 3.2f, 6.5f, 0, 0, kTauF);
    canvas.stroke();
    canvas.beginPath();
    canvas.ellipse(7, -4.8f, 3.2f, 6.5f, 0, 0, kTauF);
    canvas.stroke();
    canvas.restore();

    setStroke(canvas, 0x222222u);
    canvas.setLineWidth(1.5f);
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(-6, 10);
    canvas.quadraticCurveTo(0, 14.5f, 6, 10);
    canvas.stroke();
    canvas.restore();
}

/// The stat lines' abbreviation: lower-case, and it stops at millions.
std::string abbreviateStat(double value) {
    const double n = std::round(value);
    char buffer[32];
    if (n < 1000.0) {
        std::snprintf(buffer, sizeof buffer, "%.0f", n);
        return buffer;
    }
    const bool millions = n >= 1e6;
    const double scaled = n / (millions ? 1e6 : 1e3);
    std::snprintf(buffer, sizeof buffer, scaled == std::floor(scaled) ? "%.0f%s" : "%.1f%s", scaled,
                  millions ? "m" : "k");
    return buffer;
}

/// A connector from `from` to `to`, 10 clear of each end; dashed from `from`.
void drawLink(Canvas& canvas, Vec2 from, Vec2 to, bool dashed) {
    const double length = distance(from, to);
    if (length <= kLinkInset * 2.0) return;
    const Vec2 along = (to - from) * (1.0 / length);
    const Vec2 a = from + along * kLinkInset;
    const double run = length - kLinkInset * 2.0;
    canvas.beginPath();
    if (!dashed) {
        const Vec2 b = a + along * run;
        canvas.moveTo(static_cast<float>(a.x), static_cast<float>(a.y));
        canvas.lineTo(static_cast<float>(b.x), static_cast<float>(b.y));
    } else {
        for (double d = 0.0; d <= run; d += kDashPitch) {
            const Vec2 p = a + along * d;
            const Vec2 q = a + along * (d + kDash);
            canvas.moveTo(static_cast<float>(p.x), static_cast<float>(p.y));
            canvas.lineTo(static_cast<float>(q.x), static_cast<float>(q.y));
        }
    }
    canvas.stroke();
}

} // namespace

Rect TalentsPanel::bounds(int, int viewHeight) {
    return {kWindowX, static_cast<double>(viewHeight) - kWindowBottom - kWindowSide, kWindowSide,
            kWindowSide};
}

void TalentsPanel::reset() {
    if (!laidOut_) layout();
    dragging_ = false;
    pressedNode_ = -1;
    hoveredNode_ = -1;
    holdMs_ = 0;
    holdBought_ = false;
    badgeTip_ = 0;
    flash_ = 0;
    closeHeld_ = false;
    resetHeld_ = false;
    confirmingReset_ = false;
    for (Node& node : nodes_) {
        node.hover = node.tooltip = node.hint = node.wobble = node.pulse = 0;
        node.requested = false;
    }
    grains_.clear();
    // The scroll is kept from one opening to the next, as florr keeps it.
    if (!scrollSet_) {
        scroll_ = scrollTarget_ = std::min(kStartColumn, maxColumn_);
        scrollSet_ = true;
    }
}

void TalentsPanel::layout() {
    nodes_.clear();
    maxColumn_ = 0;
    for (const Branch& branch : branches()) {
        const int tiers = skillTierCount(branch.skill);
        for (int tier = 0; tier < tiers; ++tier) {
            GridPoint point{0, 0};
            if (tier < static_cast<int>(branch.points.size())) {
                point = branch.points[static_cast<std::size_t>(tier)];
            }
            Node node;
            node.skill = branch.skill;
            node.tier = tier;
            node.grid = {point.x, point.y};
            nodes_.push_back(node);
            maxColumn_ = std::max(maxColumn_, point.x);
        }
    }
    laidOut_ = true;
}

bool TalentsPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const SkillSet& skills = profile.skills;
    const int points = profile.talentPoints();
    const Rect panel = ctx.bounds;
    const double dtMs = ctx.dt * 1000.0;
    const Vec2 mouse = ctx.mouse();
    if (!laidOut_ || !scrollSet_) reset();

    // florr kills the window's input below 0.9 open and on the way out.
    const bool live = open_ >= 0.9 && !closing_;

    const Rect inner{panel.x + kInset, panel.y + kInset, panel.w - kInset * 2.0,
                     panel.h - kInset * 2.0};
    double topRow = 0;
    for (const Node& node : nodes_) topRow = std::max(topRow, node.grid.y);
    const Vec2 origin{inner.x + inner.w * 0.5, inner.bottom() - kStep * topRow - kTreeBottom};
    const Vec2 flower = origin + Vec2{0.0, kStep * topRow + kFlowerDrop};

    // -- the chrome's rects ---------------------------------------------------
    const double rowMiddle = panel.y + kPad + kTitleSize * kLine * 0.5;
    const Rect closeSquare{panel.right() - kCloseFromRight, rowMiddle - kCloseSide * 0.5,
                           kCloseSide, kCloseSide};
    const Rect closeHit{closeSquare.x - kCloseRimGap, closeSquare.y - kCloseRimGap,
                        kCloseSide + kCloseRimGap * 2.0, kCloseSide + kCloseRimGap * 2.0};
    const double resetWidth =
        measure("Reset", kResetLabelSize) + outlinePad(kResetLabelSize) + kResetPadX * 2.0;
    const Rect resetRect{panel.right() - kPad - resetWidth, panel.bottom() - kPad - kResetHeight,
                         resetWidth, kResetHeight};
    const Rect resetHit{resetRect.x - kButtonBorder * 0.5, resetRect.y - kButtonBorder * 0.5,
                        resetRect.w + kButtonBorder, resetRect.h + kButtonBorder};
    const std::string pointsText = std::to_string(points);
    const Rect badgeHit{inner.x + kBadgeHitInset, inner.y + kBadgeHitInset,
                        measure(pointsText, kBadgeTextSize) + outlinePad(kBadgeTextSize) +
                            kBadgeHitExtra,
                        kBadgeHitHeight};
    bool anyOwned = false;
    for (int s = 0; s < kSkillCount; ++s) anyOwned |= skills.level(static_cast<SkillId>(s)) >= 0;

    const bool overClose = live && closeHit.contains(mouse);
    const bool overReset = live && anyOwned && resetHit.contains(mouse);
    if (!overReset) confirmingReset_ = false;

    // -- scroll ---------------------------------------------------------------
    if (dragging_) {
        scrollTarget_ += (dragLastX_ - mouse.x) / kStep;
        dragLastX_ = mouse.x;
    }
    if (live && panel.contains(mouse)) scrollTarget_ -= ctx.wheel();
    scrollTarget_ = std::clamp(scrollTarget_, 0.0, maxColumn_);
    scroll_ += (scrollTarget_ - scroll_) * ease(dtMs, kScrollRate);

    for (Node& node : nodes_) node.at = origin + project(node.grid, scroll_, topRow);

    // -- what each node is ----------------------------------------------------
    const auto owned = [&](const Node& node) {
        return skills.prerequisiteMet(node.skill) && node.tier <= skills.level(node.skill);
    };
    const auto costOf = [&](const Node& node) {
        return skillPurchaseCost(skills, node.skill, node.tier);
    };
    const auto affordable = [&](const Node& node) {
        return !owned(node) && costOf(node) <= points;
    };

    // Exactly one node answers the cursor: the last drawn, which is the one
    // on top, and never through the chrome drawn over the tree.
    int hovered = -1;
    if (live && !dragging_ && inner.contains(mouse) && !closeHit.contains(mouse) &&
        !resetHit.contains(mouse)) {
        for (int i = static_cast<int>(nodes_.size()) - 1; i >= 0; --i) {
            const Node& node = nodes_[static_cast<std::size_t>(i)];
            const double reach = i == hoveredNode_ ? kHitRadiusHovered : kHitRadius;
            if (distance(mouse, node.at) <= reach) {
                hovered = i;
                break;
            }
        }
    }
    hoveredNode_ = hovered;

    // -- input ----------------------------------------------------------------
    bool keepOpen = true;
    if (live && ctx.pressed() && panel.contains(mouse)) {
        if (overClose) {
            closeHeld_ = true;
        } else if (overReset) {
            resetHeld_ = true;
        } else if (hovered >= 0) {
            pressedNode_ = hovered;
            holdMs_ = 0;
            holdBought_ = false;
        } else if (inner.contains(mouse)) {
            dragging_ = true;
            dragLastX_ = mouse.x;
        }
    }
    const bool down = ctx.window.mouseDown(MouseButton::Left);
    // A hold lasts while the press stays on its node and the node can still
    // be bought; it buys once.
    const bool holding = down && pressedNode_ >= 0 && pressedNode_ == hovered &&
                         affordable(nodes_[static_cast<std::size_t>(pressedNode_)]);
    if (holding) {
        holdMs_ += dtMs;
        Node& node = nodes_[static_cast<std::size_t>(pressedNode_)];
        if (holdMs_ > kHoldMs && !holdBought_) {
            holdBought_ = true;
            for (const SkillStep& step : skillPurchasePath(skills, node.skill, node.tier)) {
                ctx.net.requestUpgradeSkill(step.id, step.tier);
            }
            node.requested = true;
            node.requestedMs = holdMs_;
        }
    }
    if (!down) {
        if (closeHeld_ && overClose) keepOpen = false;
        if (resetHeld_ && overReset) {
            // Two clicks, because a reset cannot be undone and there is no
            // modal here to raise. The caption never changes.
            if (confirmingReset_) {
                ctx.net.requestResetSkills();
                confirmingReset_ = false;
            } else {
                confirmingReset_ = true;
            }
        }
        closeHeld_ = resetHeld_ = false;
        dragging_ = false;
        pressedNode_ = -1;
    }

    // -- the nodes' eases -----------------------------------------------------
    const double hoverStep = ease(dtMs, kHoverRate);
    const double tipStep = ease(dtMs, kTipRate);
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
        Node& node = nodes_[i];
        const bool isHovered = static_cast<int>(i) == hovered;
        const bool isHeld = holding && static_cast<int>(i) == pressedNode_;
        const bool canBuy = affordable(node);
        if (node.requested && owned(node)) {
            // The purchase landed: a pulse, the flower's bulge and a burst.
            node.requested = false;
            node.pulse = 1.0;
            flash_ = 1.0;
            grains_.burst(node.at, tierColor(node.skill, node.tier), kBurstGrains, kBurstShape);
        }
        if (node.requested && !isHeld) {
            node.requestedMs += dtMs;
            if (node.requestedMs > kRequestTimeoutMs) node.requested = false;
        }
        if (isHeld || node.requested) {
            node.wobble = std::sin(kWobbleRate * (isHeld ? holdMs_ : node.requestedMs));
        } else {
            node.wobble -= node.wobble * hoverStep;
        }
        node.pulse -= node.pulse * hoverStep;
        node.hover += ((isHovered && canBuy && !isHeld ? 1.0 : 0.0) - node.hover) * hoverStep;
        node.tooltip += ((isHovered && !isHeld ? 1.0 : 0.0) - node.tooltip) * tipStep;
        node.hint += ((isHovered && canBuy ? 1.0 : 0.0) - node.hint) * tipStep;
    }
    flash_ -= flash_ * ease(dtMs, kFlashRate);
    badgeTip_ += ((live && badgeHit.contains(mouse) ? 1.0 : 0.0) - badgeTip_) * tipStep;

    // -- paint ----------------------------------------------------------------
    canvas.save();
    // The whole window fades in with its open progress, florr's way.
    canvas.setGlobalAlpha(static_cast<float>(std::clamp(open_, 0.0, 1.0)));
    drawFlorrPanel(canvas, panel, kTalentsSkin.fill, kTalentsSkin.border);

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(inner.x), static_cast<float>(inner.y), static_cast<float>(inner.w),
                static_cast<float>(inner.h));
    canvas.clip();

    // The TP badge.
    const Vec2 badge{inner.x + kBadgeCentre, inner.y + kBadgeCentre};
    setFill(canvas, kTalentsSkin.border);
    canvas.fillCircle(static_cast<float>(badge.x), static_cast<float>(badge.y),
                      static_cast<float>(kBadgeRadius));
    text(canvas, pointsText, badge.x, badge.y, florrLabel(kBadgeTextSize, kPaper, Align::Centre));
    text(canvas, "TP", badge.x + kBadgeLabelX, badge.y, florrLabel(kBadgeLabelSize));

    // The connectors, all under the nodes: each tier from the one below it,
    // a fork's first from the node it hangs off, a root from the flower.
    setStroke(canvas, kTalentsSkin.border);
    canvas.setLineWidth(static_cast<float>(kLinkWidth));
    canvas.setLineCap("round");
    canvas.setLineJoin("round");
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
        const Node& node = nodes_[i];
        const bool dashed = !owned(node);
        if (node.tier > 0) {
            drawLink(canvas, nodes_[i - 1].at, node.at, dashed);
            continue;
        }
        if (const SkillFork* fork = skillFork(node.skill)) {
            for (const Node& parent : nodes_) {
                if (parent.skill == fork->parent && parent.tier == rarityIndex(fork->requirement)) {
                    drawLink(canvas, parent.at, node.at, dashed);
                    break;
                }
            }
            continue;
        }
        // A root's dashes start at the node, florr's order.
        drawLink(canvas, node.at, flower, dashed);
    }

    // The flower on its hub, bulging after a purchase.
    setFill(canvas, kTalentsSkin.border);
    canvas.fillCircle(static_cast<float>(flower.x), static_cast<float>(flower.y),
                      static_cast<float>(kHubRadius));
    const double bulge = flash_ > 1e-4 ? kFlashBulge * std::sin(kPi * (1.0 - flash_)) : 0.0;
    const double look = std::atan2(mouse.y - flower.y, mouse.x - flower.x);
    drawAvatar(canvas, flower, kFlowerRadius + bulge,
               {std::cos(look) * kFlowerEyeTravelX, std::sin(look) * kFlowerEyeTravelY});
    grains_.drawGrains(canvas, dtMs);

    // The nodes.
    for (const Node& node : nodes_) {
        const bool isOwned = owned(node);
        const int cost = isOwned ? 0 : costOf(node);
        const bool canBuy = !isOwned && cost <= points;
        const std::uint32_t own = tierColor(node.skill, node.tier);
        std::uint32_t fill = kLockedFill;
        std::uint32_t rim = kLockedRim;
        if (isOwned) {
            fill = own;
            rim = slotCardShade(own);
        } else if (canBuy) {
            // Within reach: 30% of the tier's colour over the locked grey.
            fill = mixChannels(own, 0.3, static_cast<double>(kLockedFill & 0xFFu));
            rim = slotCardShade(fill);
        }
        const double pulse = node.pulse > 1e-4 ? 1.0 + 0.5 * std::sin(kPi * node.pulse) : 1.0;
        const double scale = (1.0 + 0.1 * node.hover) * (1.0 + 0.1 * node.wobble) * pulse;

        canvas.save();
        canvas.translate(static_cast<float>(node.at.x), static_cast<float>(node.at.y));
        canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
        setFill(canvas, rim);
        canvas.fillCircle(0.0f, 0.0f, static_cast<float>(kNodeRim));
        setFill(canvas, fill);
        canvas.fillCircle(0.0f, 0.0f, static_cast<float>(kNodeFace));
        drawIcon(canvas, node.skill, node.tier, {0.0, 0.0}, kIconExtent);
        if (!isOwned) {
            setFill(canvas, rim);
            canvas.fillCircle(static_cast<float>(kCostAt), static_cast<float>(-kCostAt),
                              static_cast<float>(kCostRadius));
            canvas.save();
            canvas.translate(static_cast<float>(kCostAt), static_cast<float>(-kCostAt));
            canvas.rotate(static_cast<float>(kCostTurn));
            text(canvas, std::to_string(cost), 0.0, 0.0,
                 florrLabel(kCostSize, canBuy ? kPaper : kCostShort, Align::Centre));
            canvas.restore();
        }
        canvas.restore();
    }

    // What the flower in the middle is worth now. The live max health, which
    // the tree already multiplies; outside the world -- or steering somebody
    // else's flower -- the level curve stands in.
    const SelfState& self = ctx.net.view().self();
    const double health = self.maxHealth > 0.0 && !ctx.net.controllingFlower()
                              ? self.maxHealth
                              : maxHealthForLevel(profile.level) * skills.statScale(SkillId::PlayerHealth);
    const double bodyDamage = kDisplayBodyDamage * skills.statScale(SkillId::Damage);
    const double statX = flower.x + kStatX;
    const auto statLine = [&](const char* name, std::uint32_t color, double value, double middle) {
        text(canvas, name, statX, middle, florrLabel(kStatSize, color));
        text(canvas, " " + abbreviateStat(value), statX + measure(name, kStatSize), middle,
             florrLabel(kStatSize));
    };
    statLine("Flower Health:", kStatHealth, health, flower.y - kStatSize * kLine * 0.5);
    statLine("Body Damage:", kStatDamage, bodyDamage, flower.y + kStatSize * kLine * 0.5);

    canvas.restore();  // the tree's clip

    // Reset, the title and the close button, over the tree.
    drawFlorrButton(canvas, resetRect, anyOwned ? kResetFace : kResetIdleFace, kButtonBorder,
                    kButtonRadius, overReset, overReset && resetHeld_);
    text(canvas, "Reset", resetRect.x + resetRect.w * 0.5, resetRect.y + resetRect.h * 0.5,
         florrLabel(kResetLabelSize, kPaper, Align::Centre));
    text(canvas, "Talents", panel.x + panel.w * 0.5, rowMiddle,
         florrLabel(kTitleSize, kPaper, Align::Centre));
    drawFlorrClose(canvas, closeSquare, overClose, overClose && closeHeld_);
    // florr paints the rim a second time, so nothing inside overruns it.
    drawFlorrRim(canvas, panel, kTalentsSkin.border);

    // -- tooltips, over everything ---------------------------------------------
    const double viewWidth = static_cast<double>(canvas.width());
    if (badgeTip_ > 1e-3) {
        const std::vector<TipRow> rows = {{kBadgeTipSize, {{kBadgeTip}}}};
        const Vec2 size = tipSize(rows);
        const double anchorY = inner.y + kBadgeTipY;
        paintTip(canvas, {tipLeft(badge.x, size.x, viewWidth), anchorY - kTipUnder}, rows, badgeTip_);
    }
    for (const Node& node : nodes_) {
        if (node.tooltip > 1e-3) {
            const std::vector<TipRow> rows = tooltipRows(node.skill, node.tier);
            const Vec2 size = tipSize(rows);
            paintTip(canvas,
                     {tipLeft(node.at.x, size.x, viewWidth), node.at.y - kTipAbove - size.y},
                     rows, node.tooltip);
        }
        if (node.hint > 1e-3) {
            const std::vector<TipRow> rows = {{kTipBodySize, {{"HOLD to upgrade"}}}};
            const Vec2 size = tipSize(rows);
            paintTip(canvas, {tipLeft(node.at.x, size.x, viewWidth), node.at.y + kTipBelow}, rows,
                     node.hint);
        }
    }
    canvas.restore();  // the window's fade
    return keepOpen;
}

} // namespace flix
