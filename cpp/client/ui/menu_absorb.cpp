// The forge's other side: Absorb.
//
// florr's old web client (~/florr_images/client_old.wasm, archived from before
// florr took absorbing out) keeps Absorb on the far side of the craft window,
// behind a Switch button. This is that window. Its body draw -- vtable slot 3
// of the absorb controller, f_bqb in a wasm-decompile listing -- was run
// offline against a recording canvas, so the geometry below is what it drew,
// and the motions are read out of the same function. Numbers are window units
// at one to the design unit; x is measured from the window's centre line,
// since florr's window is 610 wide and ours is as wide as its grid.
//
//   - the slot: a 75 square in the theme's shade, 60.5 left of the centre
//     line. A single stack stands in it at full size. With two or more the
//     square shrinks away as a disc of radius 70 grows in its place, and the
//     stacks stand on a ring of radius 40 about it, the first at three
//     o'clock, each drawn at 1 - 0.3 x the disc's growth -- 0.7 of the slot.
//   - a stack landing grows in from nothing, fading in and turning a full turn
//     backwards (the craft ring's grow); taken back, it vanishes where it
//     stands, turning (the craft ring's vanish). While an absorb waits on the
//     server the ring holds still and every tile shudders -- round a circle of
//     up to 5 three times a second, swelling 10% five times -- and the
//     server's yes bursts each stack into 30 grains of its colour.
//   - the Absorb button: 80 x 28, florr's b4 r4, red (#BB5555) while there is
//     something to absorb and grey (#AAAAAA) while there is not.
//   - the XP bar: a 30-wide round-capped #333333 track 310 long, the fill
//     #F5FF65 at 25.5 and what the staged petals would add #8C913C at 22.5
//     under it; "Level N - x/y XP" across it, "+N XP" at its right end and
//     "Next level: ..." over that end. A level gained fills the bar, flashes
//     it -- swelling to 38.25 as it fades -- throws 50 sparks along it, and
//     starts the next level from empty.
//   - two lines, and under them the craft window's grid: a row a petal and a
//     column a tier. A click stages one, shift the whole stack, and a cell
//     held down repeats; a click on a staged stack takes all of it back.
//
// Every ease is florr's x += (target - x) (1 - k^(dt * 0.06)), dt in ms: the
// fraction of the way a 60 fps frame keeps being k.

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "client/ui/item_tile.h"
#include "client/ui/menu_style.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "shared/game/absorb.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The slot: its centre, 60.5 left of the window's centre line, and its side.
constexpr double kSlotX = -60.5;
constexpr double kSlotY = 110.6;
constexpr double kSlotSide = 75.0;
/// What two or more stacks stand on, and how far out.
constexpr double kDiscRadius = 70.0;
constexpr double kRingRadius = 40.0;
/// How much smaller a stack is drawn on the ring than in the slot.
constexpr double kRingShrink = 0.3;
/// florr lays a 75 tile out from -37, not -37.5: every tile sits half a unit
/// down and right of where it stands, scaled with it.
constexpr double kTileNudge = 0.5;

/// The button: its left edge from the centre line, its top, its size.
constexpr double kButtonX = 17.5;
constexpr double kButtonY = 97.2;
constexpr double kButtonWidth = 80.0;
constexpr double kButtonHeight = 28.0;
constexpr double kButtonBorder = 4.0;
constexpr double kButtonRadius = 4.0;
constexpr double kButtonLabelSize = 16.0;
constexpr std::uint32_t kButtonFace = 0xBB5555u;
constexpr std::uint32_t kButtonIdleFace = 0xAAAAAAu;

/// The bar: its centre line, half its length, and its three strokes. A fill
/// shorter than a thirtieth of the bar is drawn proportionally thinner, so a
/// sliver never shows as a round dot wider than itself.
constexpr double kBarY = 183.6;
constexpr double kBarHalf = 155.0;
constexpr double kBarTrackWidth = 30.0;
constexpr double kBarFillWidth = 25.5;
constexpr double kBarPreviewWidth = 22.5;
constexpr double kBarFlashSwell = 12.75;
constexpr double kBarRamp = 30.0;
constexpr std::uint32_t kBarTrack = 0x333333u;
constexpr std::uint32_t kBarFill = 0xF5FF65u;
constexpr std::uint32_t kBarPreview = 0x8C913Cu;
constexpr double kLevelSize = 12.0;
constexpr double kNextSize = 10.5;
constexpr double kLineHeight = 1.4;
/// A level-up's sparks: one every 6.2 along the bar from its left cap.
constexpr int kSparks = 50;
constexpr double kSparkStep = 6.2;

/// The two lines, 16 units each, by their middles.
constexpr double kLineSize = 16.0;
constexpr double kLine1Y = 224.8;
constexpr double kLine2Y = 247.2;

/// The grid: where its view starts, how far down that its first row stands,
/// and the window's height with no rows at all.
constexpr double kListTop = 268.4;
constexpr double kListInsetY = 5.0;
constexpr double kListBottomPad = 10.0;
constexpr double kEmptyHeight = 278.4;
constexpr double kRowPitch = 70.0;
constexpr double kMaxHeight = 700.0;

/// An absorbed stack's grains, thrown as the craft ring's are: x within
/// +-500, y from -500 to 200, at any angle.
constexpr int kAbsorbGrains = 30;
constexpr SlotBurstShape kGrainShape{200.0, 0.0, kTau};

/// The shudder while an absorb is out: a circle of up to 5 units, three times
/// round a second under a sin envelope, and a 10% swell five times a second.
constexpr double kShudderRadius = 5.0;
constexpr double kShudderTurns = 3.0;
constexpr double kShudderSwells = 5.0;
constexpr double kShudderDepth = 0.1;

/// A held cell: the first repeat after a second, then one every 300 ms, each
/// step x1.3 + 1 the last, up to a million.
constexpr double kHoldDelayMs = 1000.0;
constexpr double kHoldRepeatMs = 300.0;
constexpr double kHoldGrowth = 1.3;
constexpr std::uint32_t kHoldMaxStep = 1000000;

/// How long the slot waits on an answer before it lets go, and how long a
/// refusal stays up.
constexpr double kWaitTimeoutMs = 8000.0;
constexpr double kRefusalMs = 3000.0;

/// florr's ease: the fraction of the way to its target a value moves in
/// `dtMs`, when it keeps `keep` of the distance every 60 fps frame.
double settle(double keep, double dtMs) {
    return clamp(1.0 - std::pow(keep, dtMs * 0.06), 0.0, 1.0);
}

std::uint32_t stackKey(std::uint16_t petalIndex, Rarity rarity) {
    return (static_cast<std::uint32_t>(petalIndex) << 8) |
           static_cast<std::uint32_t>(rarityIndex(rarity));
}

/// florr's short number (f_dla in a wasm-decompile listing of the old client):
/// whole below a thousand, then
/// k, m and b, with one decimal until the figure reaches 100 of its unit --
/// "1.0k", "51.5k", "514k", "50m".
std::string florrShort(double value) {
    char buffer[32];
    if (value < 1e3) std::snprintf(buffer, sizeof buffer, "%.0f", value);
    else if (value < 1e5) std::snprintf(buffer, sizeof buffer, "%.1fk", value / 1e3);
    else if (value < 1e6) std::snprintf(buffer, sizeof buffer, "%.0fk", value / 1e3);
    else if (value < 1e7) std::snprintf(buffer, sizeof buffer, "%.1fm", value / 1e6);
    else if (value < 1e9) std::snprintf(buffer, sizeof buffer, "%.0fm", value / 1e6);
    else if (value < 1e10) std::snprintf(buffer, sizeof buffer, "%.1fb", value / 1e9);
    else std::snprintf(buffer, sizeof buffer, "%.0fb", value / 1e9);
    return buffer;
}

/// "Level N - x/y XP", florr's, in whole numbers -- or short ones once the
/// whole ones would run past the bar, which florr's level curve never had to
/// worry about and ours does.
std::string levelLine(int level, double into, double need, double width) {
    const auto line = [&](const std::string& a, const std::string& b) {
        return "Level " + std::to_string(level) + " - " + a + "/" + b + " XP";
    };
    char a[32];
    char b[32];
    std::snprintf(a, sizeof a, "%.0f", into);
    std::snprintf(b, sizeof b, "%.0f", need);
    std::string out = line(a, b);
    if (measure(out, kLevelSize) > width) out = line(florrShort(into), florrShort(need));
    return out;
}

/// A round-capped stroke along the bar's centre line.
void barStroke(Canvas& canvas, double x0, double x1, double y, double width, std::uint32_t rgb,
               double alpha) {
    if (width <= 0.0 || alpha <= 0.0) return;
    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(clamp(alpha, 0.0, 1.0)));
    setStroke(canvas, rgb);
    canvas.setLineWidth(static_cast<float>(width));
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(x0), static_cast<float>(y));
    canvas.lineTo(static_cast<float>(x1), static_cast<float>(y));
    canvas.stroke();
    canvas.restore();
}

Vec2 turned(Vec2 v, double radians) {
    const double c = std::cos(radians);
    const double s = std::sin(radians);
    return {v.x * c - v.y * s, v.x * s + v.y * c};
}

} // namespace

Vec2 AbsorbPanel::size(const Profile& profile) {
    // Every ladder tier: anything up to apex may go in, so the grid has a
    // column for each, the trader's width.
    const std::size_t rows = SlotGrid::rows(profile, true);
    return {slotCardWidth(true),
            std::min(kMaxHeight, kEmptyHeight + kRowPitch * static_cast<double>(rows))};
}

void AbsorbPanel::reset() {
    grid_.reset();
    staged_.clear();
    ring_.clear();
    fx_.clear();
    disc_ = 0.0;
    shudder_ = 0.0;
    heldPetal_ = kNoPetal;
    refusal_.clear();
    switchPressed_ = false;
    // `waiting_` stays: a request still out will be answered, and the button
    // stays down until it is.
}

std::uint32_t AbsorbPanel::staged(std::uint16_t petalIndex, Rarity rarity) const {
    for (const Staged& s : staged_) {
        if (s.petalIndex == petalIndex && s.rarity == rarity) return s.count;
    }
    return 0;
}

void AbsorbPanel::stage(const Profile& profile, std::uint16_t petalIndex, Rarity rarity,
                        std::uint32_t count) {
    if (!knownPetal(petalIndex) || !absorbable(content().petal(petalIndex), rarity)) return;
    const std::uint32_t owned = profile.stackCount(petalIndex, rarity);
    const auto it = std::find_if(staged_.begin(), staged_.end(), [&](const Staged& s) {
        return s.petalIndex == petalIndex && s.rarity == rarity;
    });
    const std::uint32_t have = it != staged_.end() ? it->count : 0;
    if (owned <= have) return;
    const std::uint32_t add = std::min(count, owned - have);
    if (it != staged_.end()) it->count += add;
    else staged_.push_back({petalIndex, rarity, add});
}

void AbsorbPanel::stepBar(const std::string& account, double totalXp, double dtMs, Vec2 barLeft) {
    const LevelProgress now = levelFromTotalXp(totalXp);
    const double fraction =
        now.xpForNext > 0.0 ? clamp(now.xpIntoLevel / now.xpForNext, 0.0, 1.0) : 0.0;
    // Another account, or the first look: the bar starts where the account
    // stands rather than climbing to it.
    if (!barKnown_ || account != barAccount_) {
        barKnown_ = true;
        barAccount_ = account;
        barLevel_ = now.level;
        barFill_ = fraction;
        barFlash_ = false;
        previewShown_ = false;
        return;
    }
    const double step = settle(0.8, dtMs);
    if (barFlash_) {
        // A level just filled flashes away, and the next starts from empty.
        barFill_ -= barFill_ * step;
        if (barFill_ < 0.001) barFlash_ = false;
    } else if (now.level > barLevel_) {
        // Behind the account: fill to the end, one level at a time.
        barFill_ += (1.0 - barFill_) * step;
        if (barFill_ > 0.999) {
            barFlash_ = true;
            ++barLevel_;
            previewShown_ = false;
            for (int i = 0; i < kSparks; ++i) {
                sparks_.burst(barLeft + Vec2{kSparkStep * i, 0.0}, kBarFill, 1, kGrainShape);
            }
        }
    } else {
        barLevel_ = now.level;
        barFill_ += (fraction - barFill_) * step;
    }
}

bool AbsorbPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Vec2 mouse = ctx.mouse();
    const double nowMs = ctx.timeSeconds * 1000.0;
    const double dtMs = ctx.dt * 1000.0;
    const bool mouseDown = ctx.window.mouseDown(MouseButton::Left);

    // The server's answer. Read here rather than at the click, so it lands
    // even when the window was shut while it was out. A yes bursts every
    // stack where it stands; a no hands them back and says why.
    bool absorbed = false;
    AbsorbOutcome& outcome = ctx.net.absorbOutcome();
    if (outcome.pending) {
        outcome.pending = false;
        if (waiting_) {
            waiting_ = false;
            if (outcome.success) {
                absorbed = true;
            } else {
                refusal_ = outcome.reason;
                refusalUntil_ = nowMs + kRefusalMs;
            }
        }
    }
    if (waiting_ && nowMs - waitStarted_ > kWaitTimeoutMs) waiting_ = false;
    if (absorbed) {
        for (const RingTile& tile : ring_) {
            if (tile.side <= 0.0) continue;
            fx_.burst(tile.centre, tile.tile.rarity, kAbsorbGrains, kGrainShape);
        }
        ring_.clear();
        staged_.clear();
    }

    // What is staged cannot outlive the petals behind it: a pickup, a craft or
    // the loadout change the stack. Never while an absorb is out, though --
    // those petals are the server's, and a profile landing a frame before the
    // answer would empty the ring under its own burst.
    if (!waiting_) {
        for (Staged& s : staged_) {
            s.count = std::min(s.count, profile.stackCount(s.petalIndex, s.rarity));
        }
        staged_.erase(std::remove_if(staged_.begin(), staged_.end(),
                                     [](const Staged& s) { return s.count == 0; }),
                      staged_.end());
    }

    const SlotCardLayout card =
        drawSlotCard(canvas, ctx.bounds, kAbsorbSkin, "Absorb", "Absorb", mouse);
    const Rect panel = card.panel;
    const Rect switchRect = drawSlotSwitch(canvas, card, kCraftingSkin.fill, mouse, mouseDown);
    const double centreX = panel.x + panel.w * 0.5;
    const Vec2 slot{centreX + kSlotX, panel.y + kSlotY};

    // --- the ring --------------------------------------------------------------
    // A stack taken back leaves the way the craft ring's do; one staged since
    // last frame lands at the slot's centre and makes its way out to its place.
    for (auto it = ring_.begin(); it != ring_.end();) {
        const bool kept = std::any_of(staged_.begin(), staged_.end(), [&](const Staged& s) {
            return stackKey(s.petalIndex, s.rarity) == it->key;
        });
        if (kept) {
            ++it;
            continue;
        }
        if (it->side > 0.0) fx_.vanish(it->centre, it->side, it->tile);
        it = ring_.erase(it);
    }
    for (const Staged& s : staged_) {
        const std::uint32_t key = stackKey(s.petalIndex, s.rarity);
        const bool shown = std::any_of(ring_.begin(), ring_.end(),
                                       [&](const RingTile& t) { return t.key == key; });
        if (shown) continue;
        RingTile tile;
        tile.key = key;
        tile.tile.petalIndex = s.petalIndex;
        tile.tile.rarity = s.rarity;
        ring_.push_back(tile);
    }

    disc_ += ((staged_.size() > 1 ? 1.0 : 0.0) - disc_) * settle(0.8, dtMs);
    if (waiting_) shudder_ = std::fmod(shudder_ + dtMs / 1000.0, 1.0);
    else if (staged_.empty()) shudder_ = 0.0;
    else shudder_ -= shudder_ * settle(0.7, dtMs);

    // The slot's square, giving way to the disc as the ring forms.
    if (disc_ < 0.9999) {
        const double side = kSlotSide * (disc_ > 0.0001 ? 1.0 - disc_ : 1.0);
        drawSlotPlate(canvas, ctx.sprites, {slot.x - side * 0.5, slot.y - side * 0.5, side, side},
                      kAbsorbSkin);
    }
    if (disc_ > 0.0001) {
        setFill(canvas, kAbsorbSkin.border);
        canvas.beginPath();
        canvas.arc(static_cast<float>(slot.x), static_cast<float>(slot.y),
                   static_cast<float>(kDiscRadius * disc_), 0.0f, static_cast<float>(kTau));
        canvas.fill();
    }
    fx_.drawGrains(canvas, dtMs);
    fx_.drawVanishing(canvas, ctx.sprites, dtMs);

    const std::size_t count = ring_.size();
    const double place = settle(0.8, dtMs);
    const double grow = settle(0.7, dtMs);
    const double shrink = 1.0 - kRingShrink * disc_;
    const double swell = 1.0 + kShudderDepth * std::sin(shudder_ * kShudderSwells * kTau);
    const Vec2 shudder = Vec2::fromAngle(shudder_ * kShudderTurns * kTau,
                                         kShudderRadius * std::sin(kPi * shudder_));
    std::optional<std::uint32_t> overTile;
    for (std::size_t i = 0; i < count; ++i) {
        RingTile& t = ring_[i];
        // On the ring once there are two; held where it is while an absorb is
        // out, so nothing slides about under the shudder.
        Vec2 target{0.0, 0.0};
        if (count > 1) {
            target = waiting_ ? t.at
                              : Vec2::fromAngle(kTau * static_cast<double>(i) /
                                                    static_cast<double>(count),
                                                kRingRadius);
        }
        t.at += (target - t.at) * place;
        t.grow += (1.0 - t.grow) * grow;

        const bool growing = t.grow < 0.99999;
        const double turn = growing ? -kTau * t.grow : 0.0;
        const double scale = shrink * t.grow;
        const Vec2 offset = shudder + Vec2{kTileNudge, kTileNudge} * swell;
        t.centre = slot + t.at + turned(offset, turn) * scale;
        t.side = kSlotSide * scale * swell;

        const std::uint32_t inSlot = staged(t.tile.petalIndex, t.tile.rarity);
        t.tile.badge = inSlot > 1 ? "x" + stackCountText(inSlot) : std::string();
        t.tile.timeSeconds = ctx.timeSeconds;
        const Rect at{t.centre.x - t.side * 0.5, t.centre.y - t.side * 0.5, t.side, t.side};
        t.tile.hovered = !waiting_ && at.contains(mouse);
        if (t.tile.hovered) overTile = t.key;
        ItemTile drawn = t.tile;
        drawn.alpha = clamp(t.grow, 0.0, 1.0);
        if (t.side > 0.0) drawSlotTile(canvas, ctx.sprites, t.centre, t.side, turn, drawn);
    }

    // --- the button --------------------------------------------------------------
    const Rect button{centreX + kButtonX, panel.y + kButtonY, kButtonWidth, kButtonHeight};
    const double rim = kButtonBorder * 0.5;
    const Rect buttonHit{button.x - rim, button.y - rim, button.w + kButtonBorder,
                         button.h + kButtonBorder};
    const bool usable = !staged_.empty() && !waiting_;
    const bool overButton = usable && buttonHit.contains(mouse);
    drawFlorrButton(canvas, button, usable ? kButtonFace : kButtonIdleFace, kButtonBorder,
                    kButtonRadius, overButton, overButton && mouseDown);
    outlinedText(canvas, "Absorb", button.x + button.w * 0.5, button.y + button.h * 0.5,
                 panelLabel(kButtonLabelSize, Align::Centre, Baseline::Middle), 1.0);

    // --- the bar -------------------------------------------------------------------
    // The level the flower is playing at -- the body's, live, in the world, or
    // the account's on the title screen -- and never a flower this client is
    // only steering for somebody else.
    const SelfState& self = ctx.net.view().self();
    const bool live = self.maxHealth > 0.0 && !ctx.net.controllingFlower();
    const double barLeft = centreX - kBarHalf;
    const double barRight = centreX + kBarHalf;
    const double barY = panel.y + kBarY;
    // The maze keeps a level of its own: a different track, not a level-up.
    const bool mazeTrack = live && ctx.net.view().realm() == Realm::Maze;
    stepBar(profile.username + (mazeTrack ? "#maze" : ""), live ? self.totalXp : profile.totalXp,
            dtMs, {barLeft, barY});
    const double need = std::max(1.0, xpForNextLevel(barLevel_));

    // What the staged petals would grant, priced exactly as the server will
    // price it, and eased in from the fill and back out to it.
    double units = 0.0;
    for (const Staged& s : staged_) units += static_cast<double>(s.count) * absorbUnits(s.rarity);
    if (!staged_.empty()) {
        const double target = absorbXpTotal(units, profile.skills) / need + barFill_;
        if (previewShown_) {
            preview_ += (target - preview_) * settle(0.8, dtMs);
        } else {
            previewShown_ = true;
            preview_ = barFill_;
        }
    } else if (previewShown_) {
        if (preview_ < barFill_ + 0.001) previewShown_ = false;
        else preview_ -= preview_ * settle(0.8, dtMs);
    }

    const double length = barRight - barLeft;
    barStroke(canvas, barLeft, barRight, barY, kBarTrackWidth, kBarTrack, 1.0);
    double plus = 0.0;
    if (previewShown_) {
        const double reach = clamp(preview_, 0.0, 1.0);
        const double ramp = clamp(reach * kBarRamp, 0.0, 1.0);
        barStroke(canvas, barLeft, barLeft + reach * length, barY, ramp * kBarPreviewWidth,
                  kBarPreview, ramp);
        plus = (preview_ - barFill_) * need;
    }
    if (barFlash_) {
        // The level just filled: the whole bar, swelling as it fades.
        barStroke(canvas, barLeft, barRight, barY,
                  kBarFillWidth + kBarFlashSwell * (1.0 - barFill_), kBarFill, barFill_);
    } else {
        const double reach = clamp(barFill_, 0.0, 1.0);
        barStroke(canvas, barLeft, barLeft + reach * length, barY,
                  clamp(reach * kBarRamp, 0.0, 1.0) * kBarFillWidth, kBarFill, 1.0);
    }

    // One talent point a level (availableTalentPoints), which is what florr's
    // "Next level: +N SP" told its players about its skill points.
    outlinedText(canvas, "Next level: +1 TP", barRight,
                 barY - kBarTrackWidth * 0.5 - 1.0 - kNextSize * kLineHeight * 0.5,
                 panelLabel(kNextSize, Align::Right, Baseline::Middle), 1.0);
    if (plus >= 0.5) {
        outlinedText(canvas, "+" + florrShort(plus) + " XP", barRight, barY,
                     panelLabel(kLevelSize, Align::Right, Baseline::Middle), 1.0);
    }
    outlinedText(canvas, levelLine(barLevel_, barFill_ * need, need, length), centreX, barY,
                 panelLabel(kLevelSize, Align::Centre, Baseline::Middle), 1.0);
    sparks_.drawGrains(canvas, dtMs);

    // --- the lines ---------------------------------------------------------------
    outlinedText(canvas, "Absorb petals to gain XP", centreX, panel.y + kLine1Y,
                 panelLabel(kLineSize, Align::Centre, Baseline::Middle), 1.0);
    // A refusal says why where the warning stands, for as long as it is news.
    const bool refused = !refusal_.empty() && nowMs < refusalUntil_;
    TextStyle second = panelLabel(kLineSize, Align::Centre, Baseline::Middle);
    if (refused) second.fill = kSlotCardRefusalInk;
    outlinedText(canvas,
                 refused ? refusal_ : "WARNING: The petals will be destroyed in the process",
                 centreX, panel.y + kLine2Y, second, 1.0);

    // --- the grid ----------------------------------------------------------------
    SlotCardLayout list = card;
    const double listTop = panel.y + kListTop;
    list.listView = {panel.x, listTop, panel.w,
                     std::max(0.0, panel.bottom() - kListBottomPad - listTop)};
    list.listInsetY = kListInsetY;
    const std::optional<SlotGrid::Pick> hovered = grid_.render(
        ctx, list, kAbsorbSkin, true,
        [&](std::uint16_t petalIndex, Rarity rarity, std::uint32_t owned) {
            SlotCell cell;
            // What is staged has left the stack as far as the player can see.
            const std::uint32_t inSlot = staged(petalIndex, rarity);
            cell.count = owned > inSlot ? owned - inSlot : 0;
            cell.greyed =
                !knownPetal(petalIndex) || !absorbable(content().petal(petalIndex), rarity);
            if (cell.count > 1) cell.badge = "x" + stackCountText(cell.count);
            return cell;
        });

    // --- input -------------------------------------------------------------------
    // A cell held down keeps staging, faster and faster, for as long as the
    // press stays on it.
    if (heldPetal_ != kNoPetal) {
        const bool still = mouseDown && hovered && hovered->petalIndex == heldPetal_ &&
                           hovered->rarity == heldRarity_;
        if (!still) {
            heldPetal_ = kNoPetal;
        } else if (!waiting_ && nowMs >= heldNextMs_) {
            stage(profile, heldPetal_, heldRarity_, heldStep_);
            const double next = std::floor(static_cast<double>(heldStep_) * kHoldGrowth + 1.0);
            heldStep_ = static_cast<std::uint32_t>(
                std::clamp(next, 1.0, static_cast<double>(kHoldMaxStep)));
            heldNextMs_ = nowMs + kHoldRepeatMs;
        }
    }

    // On press, as the craft side's: the browser hit-tests in mousedown.
    if (!ctx.pressed()) return true;
    if (card.close.contains(mouse)) return false;
    if (switchRect.contains(mouse)) {
        switchPressed_ = true;
        return true;
    }
    // Nothing moves in or out of the slot while an absorb is out.
    if (waiting_) return true;
    if (overButton) {
        std::vector<NetClient::AbsorbStack> stacks;
        stacks.reserve(staged_.size());
        for (const Staged& s : staged_) stacks.push_back({s.petalIndex, s.rarity, s.count});
        ctx.net.requestAbsorb(stacks);
        waiting_ = true;
        waitStarted_ = nowMs;
        refusal_.clear();
        return true;
    }
    if (overTile) {
        // The whole stack back, florr's way.
        staged_.erase(std::remove_if(staged_.begin(), staged_.end(),
                                     [&](const Staged& s) {
                                         return stackKey(s.petalIndex, s.rarity) == *overTile;
                                     }),
                      staged_.end());
        return true;
    }
    if (hovered) {
        stage(profile, hovered->petalIndex, hovered->rarity,
              ctx.window.shiftHeld() ? UINT32_MAX : 1u);
        heldPetal_ = hovered->petalIndex;
        heldRarity_ = hovered->rarity;
        heldNextMs_ = nowMs + kHoldDelayMs;
        heldStep_ = 1;
    }
    return true;
}

} // namespace flix
