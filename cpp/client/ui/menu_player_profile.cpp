// Player profile card.
//
// What `/profile <name>` opens: one account's public card, over the game, nearly
// the whole window. From the top it is the level bar, the bar the account wears
// (both rows of it), then the counters the server keeps for it with its bag
// beside them (under them on a narrow window), the bag split into a section per
// tier, rarest first, and a count per tier under it.
//
// It draws what NetClient::playerProfileView() holds and asks for nothing, so
// closing and reopening it costs no request. Only counters the game really
// keeps are here; there is no time-played or best-score ledger to show, and no
// mob gallery on this card by design.

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

#include "client/ui/item_tile.h"
#include "client/ui/menu_style.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menu_widgets.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/touch_scroll.h"
#include "shared/game/components.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The card fills the window to this far from every edge: all of it.
constexpr double kScreenMargin = 0.0;
constexpr double kPad = 16.0;
/// The title and the line under it, above the scrolling body.
constexpr double kHeaderHeight = 82.0;
/// Where the "online now" / "offline" line is centred, from the card's top.
constexpr double kStatusLineY = 64.0;
constexpr double kScrollbarWidth = 10.0;
/// The lane the scrollbar keeps whether or not the card scrolls, so the grid's
/// column count does not change the moment a long bag appears.
constexpr double kScrollbarLane = kScrollbarWidth + 6.0;
constexpr double kWheelStep = 100.0;

constexpr double kBarHeight = 28.0;
constexpr double kSectionGap = 14.0;
constexpr double kCaptionHeight = 22.0;
constexpr int kSlotsPerRow = kLoadoutActiveSlots;
/// The bar is drawn as the one in play is: the active row (the first ten slots)
/// on top, larger, and the spare row below it, smaller, each of its tiles with
/// the number key that brings it in under it.
constexpr double kSlotGap = 12.0;
constexpr double kSlotMin = 26.0;
constexpr double kSlotMax = 64.0;
/// The spare row's tiles, as a share of the active row's.
constexpr double kSpareSlotShare = 0.74;
/// How opaque the gray card is.
constexpr float kCardAlpha = 0.6f;
constexpr double kRowGap = 12.0;
constexpr double kKeyLabelHeight = 20.0;
constexpr double kKeyLabelSize = 13.0;

/// The counters in three columns when they have the card's width to themselves,
/// in two when the bag sits beside them.
constexpr int kStatColumnsWide = 3;
constexpr int kStatColumnsBeside = 2;
/// The card is this wide before the bag goes beside the counters.
constexpr double kBesideMinWidth = 700.0;
constexpr double kStatsColumnWidth = 300.0;
constexpr double kColumnGap = 16.0;
constexpr double kStatCellHeight = 46.0;
constexpr double kStatGap = 6.0;
constexpr double kStatPad = 8.0;
constexpr std::uint32_t kStatsBoxFill = 0xCD5555u;

constexpr double kBagSide = 40.0;
constexpr double kBagGap = 5.0;
/// The bag sits on its own darker plate, no wider than this, so a wide window
/// does not stretch it into a field of tiles with the counters lost beside it.
constexpr double kBagColumnMax = 840.0;
constexpr double kPlatePad = 12.0;
constexpr float kPlateAlpha = 0.7f;
/// A tier's heading: its name between two rules, over its own tiles.
constexpr double kSectionHeader = 30.0;
constexpr double kSectionLabelSize = 16.0;
constexpr double kRuleWidth = 5.0;
constexpr double kRuleGap = 13.0;
constexpr double kTierGap = 6.0;
/// What an empty loadout slot is painted: the plain light plate the bar in play
/// shows, not a tier's colour.
constexpr std::uint32_t kEmptySlotFill = 0xEEEEEEu;
constexpr double kFooterLine = 20.0;
constexpr double kFooterItemGap = 14.0;

constexpr std::uint32_t kXpFill = 0xF8E96Au;
constexpr std::uint32_t kXpTrack = 0x3A3A3Au;
constexpr std::uint32_t kOnline = 0x6EFF6Eu;
constexpr std::uint32_t kSubtle = 0xDDDDDDu;

TextStyle style(double size, std::uint32_t fill, Align align = Align::Left) {
    TextStyle s;
    s.size = size;
    s.fill = fill;
    s.stroke = kInk;
    s.align = align;
    return s;
}

/// "1d 7h ago", "5m ago", "just now": the two largest units that are not zero.
std::string agoText(double millis) {
    const long minutes = static_cast<long>(millis / 60000.0);
    if (minutes < 1) return "just now";
    const long days = minutes / (60 * 24);
    const long hours = (minutes / 60) % 24;
    const long mins = minutes % 60;
    if (days > 0) return std::to_string(days) + "d " + std::to_string(hours) + "h ago";
    if (hours > 0) return std::to_string(hours) + "h " + std::to_string(mins) + "m ago";
    return std::to_string(mins) + "m ago";
}

struct Stat {
    std::string label;
    std::string value;
};

/// The counters, in the order the card lists them. A counter the account has no
/// value for (never entered the maze, no guild, no recorded join date) is left
/// out rather than shown as an empty box.
std::vector<Stat> statsOf(const PlayerProfileView& v) {
    std::vector<Stat> stats;
    stats.push_back({"Level", std::to_string(v.level)});
    stats.push_back({"XP", abbreviate(v.totalXp)});
    stats.push_back({"Stars", abbreviate(v.stars)});
    stats.push_back({"Mobs Killed", withSeparators(v.mobsKilled)});
    stats.push_back({"Daily Streak", std::to_string(v.streak)});
    if (v.mazeLevel > 0) stats.push_back({"Maze Level", std::to_string(v.mazeLevel)});
    if (!v.joined.empty()) stats.push_back({"Time Joined", v.joined});
    if (!v.guild.empty()) stats.push_back({"Guild", "[" + v.guild + "]"});
    return stats;
}

struct Footer {
    std::string label;
    std::uint32_t color;
};

/// "8 Eternal", "2,638 Super", ... rarest first, for every tier the bag holds.
std::vector<Footer> footerOf(const PlayerProfileView& v) {
    std::vector<double> perTier(static_cast<std::size_t>(kRarityCount), 0.0);
    for (const Profile::Stack& stack : v.inventory) {
        perTier[static_cast<std::size_t>(rarityIndex(stack.rarity))] +=
            static_cast<double>(stack.count);
    }
    std::vector<Footer> items;
    for (int tier = kRarityCount - 1; tier >= 0; --tier) {
        const double count = perTier[static_cast<std::size_t>(tier)];
        if (count <= 0.0) continue;
        const Rarity rarity = clampRarity(tier);
        items.push_back({withSeparators(count) + " " + rarityLabel(rarity), rarityColor(rarity)});
    }
    return items;
}

/// One tier's run of stacks in the bag: the heading, then its tiles.
struct Section {
    Rarity rarity = Rarity::Common;
    std::size_t first = 0;   ///< index of its first stack in the bag
    std::size_t count = 0;
    double labelY = 0;       ///< the heading's top
    double gridY = 0;        ///< the first row of tiles
};

/// Everything that sits at a fixed place in the card, measured off the card's
/// width and the answer, once a frame, so the scroll length and the paint
/// cannot disagree. Every Y is from the top of the scrolling body, every X from
/// its left edge.
struct Layout {
    double width = 0;         ///< the body's usable width
    double barY = 0;
    double loadoutY = 0;      ///< the caption; the rows follow it
    double activeSlot = kSlotMax;  ///< the top row's tile
    double spareSlot = kSlotMax;   ///< the second row's tile
    bool spareRow = false;         ///< the account has a second row at all
    bool beside = false;      ///< the bag sits beside the counters, not under
    int statColumns = kStatColumnsWide;
    double statsY = 0;
    double statsWidth = 0;
    double statsHeight = 0;
    double statCellWidth = 0;
    double statsX = 0;        ///< the counters' left edge
    double plateX = 0;        ///< the bag's plate
    double plateY = 0;
    double plateWidth = 0;
    double plateHeight = 0;
    double bagX = 0;          ///< the bag's column, inside the plate
    double bagWidth = 0;
    double bagY = 0;          ///< the caption; the sections follow it
    int columns = 1;
    std::vector<Section> sections;
    double footerY = 0;
    double footerHeight = 0;
    double total = 0;
};

/// The bag split into a run per tier. The server sends it rarest first, so a
/// tier is one run; a stack out of that order would only open a new section.
std::vector<Section> sectionsOf(const PlayerProfileView& v) {
    std::vector<Section> sections;
    for (std::size_t i = 0; i < v.inventory.size(); ++i) {
        const Rarity rarity = v.inventory[i].rarity;
        if (sections.empty() || sections.back().rarity != rarity) {
            Section section;
            section.rarity = rarity;
            section.first = i;
            sections.push_back(section);
        }
        ++sections.back().count;
    }
    return sections;
}

Layout layoutOf(const PlayerProfileView& v, double bodyWidth, const std::vector<Stat>& stats,
                const std::vector<Footer>& footer) {
    Layout l;
    l.width = bodyWidth - kScrollbarLane;

    double y = 0;
    l.barY = y;
    y += kBarHeight + kSectionGap;

    l.loadoutY = y;
    l.activeSlot = clamp((l.width - (kSlotsPerRow - 1) * kSlotGap) / kSlotsPerRow, kSlotMin, kSlotMax);
    l.spareSlot = l.activeSlot * kSpareSlotShare;
    l.spareRow = static_cast<int>(v.loadout.size()) > kSlotsPerRow;
    if (!v.loadout.empty()) {
        y += kCaptionHeight + l.activeSlot;
        if (l.spareRow) y += kRowGap + l.spareSlot + kKeyLabelHeight;
        y += kSectionGap;
    }

    // The counters and the bag share the rest of the card: side by side when
    // there is the width for it, one above the other when there is not.
    l.beside = l.width >= kBesideMinWidth;
    l.statColumns = l.beside ? kStatColumnsBeside : kStatColumnsWide;
    l.statsY = y;
    l.statsWidth = l.beside ? kStatsColumnWidth : l.width;
    const int statRows = (static_cast<int>(stats.size()) + l.statColumns - 1) / l.statColumns;
    l.statCellWidth = (l.statsWidth - kStatPad * 2 - (l.statColumns - 1) * kStatGap) /
                      static_cast<double>(l.statColumns);
    l.statsHeight = kStatPad * 2 + statRows * kStatCellHeight + (statRows - 1) * kStatGap;

    // The counters and the plate are centred as one block.
    if (l.beside) {
        l.plateWidth = std::min(l.width - l.statsWidth - kColumnGap, kBagColumnMax);
        l.statsX = (l.width - (l.statsWidth + kColumnGap + l.plateWidth)) * 0.5;
        l.plateX = l.statsX + l.statsWidth + kColumnGap;
        l.plateY = y;
    } else {
        l.plateWidth = std::min(l.width, kBagColumnMax);
        l.statsX = 0;
        l.plateX = (l.width - l.plateWidth) * 0.5;
        l.plateY = y + l.statsHeight + kSectionGap;
    }
    l.bagX = l.plateX + kPlatePad;
    l.bagWidth = l.plateWidth - kPlatePad * 2.0;
    l.bagY = l.plateY + kPlatePad;
    l.columns = std::max(1, static_cast<int>(std::floor((l.bagWidth + kBagGap) / (kBagSide + kBagGap))));

    l.sections = sectionsOf(v);
    double by = l.bagY + kCaptionHeight;
    for (Section& section : l.sections) {
        section.labelY = by;
        by += kSectionHeader;
        section.gridY = by;
        const int rows = static_cast<int>((section.count + static_cast<std::size_t>(l.columns) - 1) /
                                          static_cast<std::size_t>(l.columns));
        by += rows * (kBagSide + kBagGap) + kTierGap;
    }

    l.footerY = by + 4.0;
    // The tier counts wrap like words: as many as fit a line, then the next.
    double lineWidth = 0;
    int lines = footer.empty() ? 0 : 1;
    for (const Footer& item : footer) {
        const double itemWidth = measure(item.label, 13.0);
        if (lineWidth > 0 && lineWidth + kFooterItemGap + itemWidth > l.bagWidth) {
            ++lines;
            lineWidth = 0;
        }
        lineWidth += (lineWidth > 0 ? kFooterItemGap : 0.0) + itemWidth;
    }
    l.footerHeight = lines * kFooterLine;
    l.plateHeight = l.footerY + l.footerHeight + kPlatePad - l.plateY;
    y = l.plateY + l.plateHeight + kPad;
    // Beside the bag the counters can be the taller of the two, on a bag of one.
    if (l.beside) y = std::max(y, l.statsY + l.statsHeight + kPad);
    l.total = y;
    return l;
}

} // namespace

void PlayerProfilePanel::reset() {
    scroll_ = {};
    shownName_.clear();
}

double PlayerProfilePanel::preferredWidth() { return 960.0; }

Rect PlayerProfilePanel::bounds(int viewWidth, int viewHeight) {
    // Nearly the whole window, a margin all round.
    const double width = std::max(0.0, static_cast<double>(viewWidth) - kScreenMargin * 2.0);
    const double height = std::max(0.0, static_cast<double>(viewHeight) - kScreenMargin * 2.0);
    return {kScreenMargin, kScreenMargin, width, height};
}

bool PlayerProfilePanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const PlayerProfileView& view = ctx.net.playerProfileView();
    const bool inPanel = panel.contains(mouse);

    // A different account than the one the scroll belongs to starts at the top.
    if (view.name != shownName_) {
        scroll_.offset = 0;
        shownName_ = view.name;
    }

    bool keepOpen = true;
    canvas.setGlobalAlpha(kCardAlpha);
    panelCard(canvas, panel, kProfileSkin);
    canvas.setGlobalAlpha(1.0f);

    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, inPanel && closeRect.contains(mouse));
    if (inPanel && closeButtonHit(panel, ctx.window).contains(mouse) && ctx.released()) {
        keepOpen = false;
    }

    if (view.name.empty()) {
        panelTitle(canvas, panel, "Profile");
        return keepOpen;
    }

    // Title, and under it who is looking at what: whether the account is on now.
    panelTitle(canvas, panel, view.name + "'s Profile");
    {
        // Who is looking at what: on now, or off and for how long.
        std::string line = "offline";
        if (view.online) {
            line = "online now";
        } else if (view.lastSeenAgoMillis > 0.0) {
            line += " - last seen " + agoText(view.lastSeenAgoMillis);
        }
        text(canvas, line, panel.x + panel.w * 0.5, panel.y + kStatusLineY,
             style(13.0, view.online ? kOnline : kSubtle, Align::Centre));
    }

    const std::vector<Stat> stats = statsOf(view);
    const std::vector<Footer> footer = footerOf(view);

    const Rect body{panel.x + kPad, panel.y + kHeaderHeight, panel.w - kPad * 2,
                    panel.h - kHeaderHeight - kPad};
    const Layout l = layoutOf(view, body.w, stats, footer);

    scroll_.viewHeight = body.h;
    scroll_.contentHeight = l.total;
    if (inPanel) scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    scroll_.offset -= touchScroll(ctx.window, body, scroll_.maxOffset() > 0);
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(body.x), static_cast<float>(body.y), static_cast<float>(body.w),
                static_cast<float>(body.h));
    canvas.clip();

    const double x = body.x;
    const double top = body.y - scroll_.offset;
    const auto visible = [&](double y, double h) {
        return y + h > body.y && y < body.bottom();
    };

    // --- level bar ------------------------------------------------------------
    {
        const double y = top + l.barY;
        const Rect bar{x, y, l.width, kBarHeight};
        const LevelProgress progress = levelFromTotalXp(view.totalXp);
        const double ratio =
            progress.xpForNext > 0 ? clamp(progress.xpIntoLevel / progress.xpForNext, 0.0, 1.0) : 0.0;
        setFill(canvas, kXpTrack);
        roundPath(canvas, bar, kBarHeight * 0.5);
        canvas.fill();
        if (ratio > 0.0) {
            canvas.save();
            roundPath(canvas, bar, kBarHeight * 0.5);
            canvas.clip();
            setFill(canvas, kXpFill);
            canvas.beginPath();
            canvas.rect(static_cast<float>(bar.x), static_cast<float>(bar.y),
                        static_cast<float>(bar.w * ratio), static_cast<float>(bar.h));
            canvas.fill();
            canvas.restore();
        }
        text(canvas,
             "Lvl " + std::to_string(view.level) + " - " + abbreviate(progress.xpIntoLevel) + "/" +
                 abbreviate(progress.xpForNext) + " XP",
             bar.x + bar.w * 0.5, bar.y + bar.h * 0.5, style(15.0, kPaper, Align::Centre));
    }

    // --- loadout --------------------------------------------------------------
    // Centred, the active row above and the spare row below, as in play.
    if (!view.loadout.empty()) {
        const double centre = x + l.width * 0.5;
        if (visible(top + l.loadoutY, kCaptionHeight)) {
            text(canvas, "Loadout", centre, top + l.loadoutY + kCaptionHeight * 0.5,
                 style(16.0, kPaper, Align::Centre));
        }
        double rowY = top + l.loadoutY + kCaptionHeight;
        const auto drawRow = [&](std::size_t first, double side, bool keys) {
            const std::size_t count =
                std::min(static_cast<std::size_t>(kSlotsPerRow), view.loadout.size() - first);
            const double rowWidth = kSlotsPerRow * side + (kSlotsPerRow - 1) * kSlotGap;
            const double left = centre - rowWidth * 0.5;
            for (std::size_t k = 0; k < count; ++k) {
                const Profile::Slot& slot = view.loadout[first + k];
                const Rect rect{left + static_cast<double>(k) * (side + kSlotGap), rowY, side, side};
                if (visible(rowY, side)) {
                    ItemTile tile;
                    tile.petalIndex = slot.empty() ? kNoPetal : slot.petalIndex;
                    tile.rarity = slot.rarity;
                    if (slot.empty()) {
                        tile.empty = true;
                        tile.emptyFill = kEmptySlotFill;
                        tile.emptyBorder = borderOf(kEmptySlotFill);
                    }
                    tile.timeSeconds = ctx.timeSeconds;
                    drawItemTile(canvas, ctx.sprites, rect, tile);
                }
                if (keys && visible(rowY + side, kKeyLabelHeight)) {
                    // 1 to 9, then 0: the keyboard's own order.
                    const std::string key = "[" + std::to_string((k + 1) % 10) + "]";
                    text(canvas, key, rect.x + side * 0.5, rowY + side + kKeyLabelHeight * 0.5,
                         style(kKeyLabelSize, kPaper, Align::Centre));
                }
            }
            if (keys && visible(rowY, side)) {
                text(canvas, "[R]", left - 10.0, rowY + side * 0.5,
                     style(kKeyLabelSize + 2.0, kPaper, Align::Right));
            }
        };
        drawRow(0, l.activeSlot, false);
        if (l.spareRow) {
            rowY += l.activeSlot + kRowGap;
            drawRow(static_cast<std::size_t>(kSlotsPerRow), l.spareSlot, true);
        }
    }

    // --- counters -------------------------------------------------------------
    if (visible(top + l.statsY, l.statsHeight)) {
        const Rect box{x + l.statsX, top + l.statsY, l.statsWidth, l.statsHeight};
        setFill(canvas, borderOf(kStatsBoxFill));
        roundPath(canvas, box, 8.0);
        canvas.fill();
        setFill(canvas, kStatsBoxFill);
        roundPath(canvas, Rect{box.x + 2.0, box.y + 2.0, box.w - 4.0, box.h - 4.0}, 7.0);
        canvas.fill();
        for (std::size_t i = 0; i < stats.size(); ++i) {
            const int row = static_cast<int>(i) / l.statColumns;
            const int col = static_cast<int>(i) % l.statColumns;
            const Rect cell{box.x + kStatPad + col * (l.statCellWidth + kStatGap),
                            box.y + kStatPad + row * (kStatCellHeight + kStatGap), l.statCellWidth,
                            kStatCellHeight};
            // An inset box on a card is the card's own border colour.
            setFill(canvas, borderOf(kStatsBoxFill));
            roundPath(canvas, cell, 6.0);
            canvas.fill();
            text(canvas, stats[i].label, cell.x + cell.w * 0.5, cell.y + 14.0,
                 style(12.0, kSubtle, Align::Centre));
            text(canvas, stats[i].value, cell.x + cell.w * 0.5, cell.y + 32.0,
                 style(16.0, kPaper, Align::Centre));
        }
    }

    // --- bag ------------------------------------------------------------------
    // Its own plate, darker than the card, behind the whole of it.
    if (visible(top + l.plateY, l.plateHeight)) {
        canvas.setGlobalAlpha(kPlateAlpha);
        setFill(canvas, kProfileSkin.border);
        roundPath(canvas, Rect{x + l.plateX, top + l.plateY, l.plateWidth, l.plateHeight}, 10.0);
        canvas.fill();
        canvas.setGlobalAlpha(1.0f);
    }
    const double bagLeft = x + l.bagX;
    if (visible(top + l.bagY, kCaptionHeight)) {
        const std::string caption =
            view.inventory.empty() ? "Inventory (empty)"
                                   : "Inventory (" + withSeparators(static_cast<double>(view.inventory.size())) +
                                         (view.inventory.size() == 1 ? " stack)" : " stacks)");
        text(canvas, caption, bagLeft + l.bagWidth * 0.5, top + l.bagY + kCaptionHeight * 0.5,
             style(16.0, kPaper, Align::Centre));
    }
    for (const Section& section : l.sections) {
        // The heading: the tier's name centred over its tiles, a rule each side
        // out to the edges of the column.
        const double labelTop = top + section.labelY;
        if (visible(labelTop, kSectionHeader)) {
            const std::string caption = rarityLabel(section.rarity);
            const double centre = bagLeft + l.bagWidth * 0.5;
            const double midY = labelTop + kSectionHeader * 0.5;
            const double half = measure(caption, kSectionLabelSize) * 0.5;
            setStroke(canvas, kProfileSkin.fill);
            canvas.setLineWidth(static_cast<float>(kRuleWidth));
            canvas.setLineCap("round");
            if (centre - half - kRuleGap > bagLeft) {
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(bagLeft), static_cast<float>(midY));
                canvas.lineTo(static_cast<float>(centre - half - kRuleGap), static_cast<float>(midY));
                canvas.moveTo(static_cast<float>(centre + half + kRuleGap), static_cast<float>(midY));
                canvas.lineTo(static_cast<float>(bagLeft + l.bagWidth), static_cast<float>(midY));
                canvas.stroke();
            }
            canvas.setLineCap("butt");
            text(canvas, caption, centre, midY,
                 style(kSectionLabelSize, rarityColor(section.rarity), Align::Centre));
        }
        for (std::size_t k = 0; k < section.count; ++k) {
            const int row = static_cast<int>(k) / l.columns;
            const int col = static_cast<int>(k) % l.columns;
            const double y = top + section.gridY + row * (kBagSide + kBagGap);
            if (!visible(y, kBagSide)) continue;
            // Each row is centred in the column on its own, the short last one too.
            const int inRow = std::min(
                l.columns, static_cast<int>(section.count) - row * l.columns);
            const double rowWidth = inRow * kBagSide + (inRow - 1) * kBagGap;
            const double rowLeft = bagLeft + (l.bagWidth - rowWidth) * 0.5;
            const Profile::Stack& stack = view.inventory[section.first + k];
            ItemTile tile;
            tile.petalIndex = stack.petalIndex;
            tile.rarity = stack.rarity;
            tile.badge = stack.count > 1 ? ("x" + stackCountText(stack.count)) : std::string();
            tile.timeSeconds = ctx.timeSeconds;
            drawItemTile(canvas, ctx.sprites,
                         Rect{rowLeft + col * (kBagSide + kBagGap), y, kBagSide, kBagSide}, tile);
        }
    }

    // --- bag totals per tier --------------------------------------------------
    {
        double lineX = 0;
        double lineY = top + l.footerY;
        for (const Footer& item : footer) {
            const double itemWidth = measure(item.label, 13.0);
            if (lineX > 0 && lineX + kFooterItemGap + itemWidth > l.bagWidth) {
                lineX = 0;
                lineY += kFooterLine;
            }
            if (lineX > 0) lineX += kFooterItemGap;
            if (visible(lineY, kFooterLine)) {
                text(canvas, item.label, bagLeft + lineX, lineY + kFooterLine * 0.5,
                     style(13.0, item.color));
            }
            lineX += itemWidth;
        }
    }

    canvas.restore();

    scrollbar(canvas, Rect{body.x, body.y, body.w, body.h}, l.total, scroll_.offset,
              kProfileSkin.accent, kScrollbarWidth);
    return keepOpen;
}

} // namespace flix
