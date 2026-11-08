// The bestiary.
//
// A row per mob, a column per tier, and a cell filled in only once the account
// has actually killed one. The empty cells are the point: the grid is a
// checklist of the world, and the gaps are what is left to find.
//
// Every mob is generated at every tier, so no cell is ever "this mob does not
// exist here": an unkilled cell is a bare plate in the card's own frame colour,
// which is what makes a part-filled row read at a glance. Hovering one that HAS
// been killed opens a tooltip carrying the full drop table: the same
// upgrade/downgrade pipeline the server rolls, run forwards and displayed as
// per-rarity percentages.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "client/render/world_renderer.h"
#include "client/ui/item_tile.h"
#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "shared/core/json.h"
#include "shared/game/config.h"

namespace flix {

using namespace flix::ui;

namespace {

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

constexpr double kPad = kMenuPadding;
constexpr double kTitleHeight = 30.0;
constexpr double kTitleGap = 26.0;
/// The cell the shared item chrome is written in, and the gap the reference
/// leaves between two of them. The bestiary is a grid of SEPARATE plates, not
/// the edge-to-edge sheet the panel used to draw: neighbours never share a
/// rule, and the 4-unit rim each plate carries reaches 2 units into the gap.
constexpr double kCell = kCellSize;
constexpr double kGridGap = kCellGap;
constexpr double kCellRadius = 5.0;
constexpr double kCellRim = 4.0;
/// Reserved for the scrollbar when the grid is centred; the bar itself is
/// drawn narrower than the reserve, hard against the right padding.
constexpr double kScrollbarWidth = 12.0;
constexpr double kThumbWidth = 8.0;

/// Where the scrollable content starts, measured down from the card's top.
constexpr double kContentTop = kPad + kTitleHeight + kTitleGap;

/// The card is a fixed size however big the window is. It is a corner overlay
/// now -- pinned under the top icon row rather than standing beside the icon
/// column -- so the height is literal too instead of two thirds of a viewport.
///
/// The width is DERIVED, not the reference shot's literal 603: that card holds
/// eight tiers and this game has ten (the reference has no unique or apex), so
/// a literal width would clip the last columns against the scrollbar. It is the
/// row, the padding either side, the scrollbar reserve, and the same ~4.5
/// units of slack the reference leaves at each end of a row.
constexpr double kGridSlack = 9.0;
constexpr double kCardHeight = 607.0;

/// The kill tally, top-right, tilted the way the reference shot draws it: it
/// reads as a sticker stuck on the plate rather than as part of the artwork,
/// and it deliberately overhangs the plate's right edge.
constexpr double kTallySize = 12.0;
constexpr double kTallyTilt = 19.0 * kPi / 180.0;
/// Its CENTRE, in from the plate's top-right corner. Centred rather than
/// right-aligned, which is what keeps "x9" and "x2.1k" sitting on the same
/// spot instead of growing leftwards from one edge.
constexpr double kTallyInset = 8.5;

/// How a mob is drawn in its 60-unit tile depends on whose drawing it is.
///
/// A PAINTED mob -- one a painter in mob_art.h draws, which is gardn's drawing
/// code -- is drawn the way gardn's mob gallery draws it (GalleryMob in
/// ~/gardn/Client/Ui/TitleScreen/MobGallery.cc): turned 135 degrees
/// (kMobPictureTilt) and at gardn's size, which is the world's picture at half
/// size -- `ctx.scale(0.5)` -- after a mob whose radius passes half the tile
/// has been shrunk to that. galleryMobDiameter applies it to this game's own
/// world picture, the art at its radius times its `visual_scale`, which is
/// gardn's picture wherever the art was ported from gardn at gardn's size.
constexpr double kGardnMobScale = 0.5;
constexpr double kGardnMobRadiusCap = 30.0;

/// For the painted mobs gardn has, what gardn's gallery actually PAINTS: the
/// span of the picture along its longer side, in tile units, at the tile's
/// tilt, standing still. Measured, not derived -- gardn draws many mobs at a
/// fixed size whatever their radius (a bee is a 30x20 ellipse, a spider's legs
/// are 35 long), so no rule over the radius reproduces it; a rule over OUR
/// radius made a worker ant 69% of gardn's and a hornet 133%. Measured
/// 2026-11-07 by linking ~/gardn's Client/Assets/Mob.cc against a gardn
/// Renderer written over cpp_canvas, running GalleryMob::on_render's
/// transforms, and taking the alpha (>= 16) bounding box at 8 px a unit.
/// The centipedes are their head alone; the body segment gardn draws behind
/// it is drawGalleryMob's. gardn's massive ladybug, massive beetle and boulder
/// have no mob here, and its square and digger are not painted here (below).
///
/// `scaleOf` draws a mob gardn lacks at the very scale gardn draws one it
/// has: the wasp is the hornet's painter in other colours, at the same size.
struct GardnMobPicture {
    const char* id;
    double span;
    const char* scaleOf = nullptr;
};
constexpr GardnMobPicture kGardnMobPicture[] = {
    {"baby_ant", 20.1},       {"worker_ant", 23.8},     {"soldier_ant", 26.4},
    {"bee", 36.4},            {"ladybug", 33.8},        {"beetle", 45.0},
    {"dark_ladybug", 33.8},   {"hornet", 31.4},         {"cactus", 31.9},
    {"rock", 34.1},           {"centipede", 44.5},      {"evil_centipede", 44.5},
    {"desert_centipede", 44.5}, {"sandstorm", 32.0},    {"scorpion", 37.8},
    {"spider", 37.4},         {"ant_hole", 30.0},       {"queen_ant", 50.6},
    {"shiny_ladybug", 33.8},  {"wasp", 0.0, "hornet"},
};

/// A mob drawn from an SVG document -- its own, or a petal's -- is not
/// gardn's, and is drawn as the gallery drew every mob before: upright, at
/// its own size as the world draws it -- a speck of a baby, a hornet nearly
/// filling the plate -- 1.15x its body across, capped at 48.
constexpr double kIconZoom = 1.15;
constexpr double kIconCap = 48.0;

/// The digger is the exception: its mobs.json entry is an SVG, but the world
/// draws it as gardn does, a grey flower carrying a cutter, and so does its
/// tile -- upright, as GalleryMob leaves gardn's digger, at gardn's radius 40
/// shrunk to the cap and halved.
constexpr double kGardnDiggerRadius = 40.0;

/// That size is the BODY's, and a spider's legs or a bee's sting reach past
/// it. gardn clips the art to its tile; here the whole picture is held inside
/// the plate instead, drawn smaller only where it would spill onto the next
/// tile. The inset clears the rim's inner half and leaves a sliver of plate
/// showing round the art.
constexpr double kIconInset = kCellRim * 0.5 + 2.0;

/// Every rung of the ladder is a column, apex included: a biome's apex clock
/// puts one in the world now and then, and it is the rarest cell on the
/// sheet. Universal is above the ladder, and no mob is ever that.
///
/// The drop table stops a tier short. An apex mob's graded drop is capped at
/// unique (LootSystem::finishDropRarity), and no lesser mob grades past it,
/// so an apex column there would always be empty.
constexpr int kTierColumns = kLadderRarityCount;
constexpr int kDropTiers = kLadderRarityCount - 1;

constexpr double kGridWidth = kTierColumns * kCell + (kTierColumns - 1) * kGridGap;
constexpr double kCardWidth = kGridWidth + kPad * 2.0 + kScrollbarWidth + 4.0 + kGridSlack;

// Drop table, in the tooltip's own space.
constexpr double kDropsGapY = 6.0;
constexpr double kDropsHeaderH = 20.0;
constexpr double kColHeaderH = 16.0;
/// gardn's GalleryPetal size. Any smaller and the petal's name inside the
/// card shrinks to a smear.
constexpr double kCardSize = 45.0;
constexpr double kCardLabelH = 14.0;
constexpr double kDropCellW = 56.0;
constexpr double kDropRowH = kCardSize + 4.0 + kCardLabelH;
constexpr double kDropRowGapY = 4.0;

struct Cell {
    /// x is a screen coordinate; y is measured from the card's top, as the
    /// reference stores it, because the scroll cull compares against it raw.
    Rect rect;
    std::uint16_t mobIndex = 0;
    Rarity rarity = Rarity::Common;
    std::uint32_t kills = 0;
};

/// Every string on this panel is stroked with a ROUND join: the reference sets
/// `ctx.lineJoin = 'round'` before the title and never puts it back, so the
/// whole frame inherits it.
TextStyle galleryStyle(double size, std::uint32_t fill) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.stroke = kInk;
    style.roundJoin = true;
    return style;
}

/// Gallery counts share the full stat suffix range, retaining lowercase k.
std::string abbreviateNumber(double value) {
    std::string out = abbreviate(value);
    if (!out.empty() && out.back() == 'K') out.back() = 'k';
    return out;
}

// ---------------------------------------------------------------------------
// Drop tables
// ---------------------------------------------------------------------------

/// One authored row of mob_drops.json.
///
/// The server resolves the same file into rarity OFFSETS from the mob that
/// died (server/systems/loot.h), which is all a roll needs. The gallery needs
/// the authored ABSOLUTE rarity instead: every percentage in the tooltip is
/// the upgrade/downgrade pipeline run forwards from it.
struct DropDef {
    std::string type;        ///< as authored; every row that is kept is a petal
    std::string itemType;
    Rarity rarity = Rarity::Common;
    double probability = 0;
    int maxQuantity = 1;
    /// kInvalidIndex for anything that is not a petal, which is exactly the
    /// set of drops the browser build has no icon for either.
    std::uint16_t petalIndex = kInvalidIndex;
};

/// The staged content directory.
///
/// Nothing a panel is handed carries the client's `--data` path, and
/// mob_drops.json is staged beside the font, so the directory the fonts were
/// initialised from is the one handle the UI layer has on it. A client without
/// the file finds no table and the tooltip degrades to its text rows rather
/// than failing.
std::string dataDirectory() {
    const std::string& dir = Fonts::dataDirectory();
    return dir.empty() ? std::string(".") : dir;
}

// ---------------------------------------------------------------------------
// Authored mob order and stats
// ---------------------------------------------------------------------------

/// The two things the ContentRegistry deliberately drops on the floor.
///
/// `order` is the bestiary's row order. ContentRegistry sorts its keys so an
/// index means the same thing on both ends of the wire (config.cpp
/// usableKeys), but the browser walks `Object.keys(MOB_CONFIG)` -- mobs.json's
/// own declaration order -- so the rows have to be recovered from the file.
/// Never resort the registry to fix this: those indices cross the wire.
///
/// `speed` is the authored figure, sign included. The loader keeps only the
/// magnitude because a negative speed is a direction the flee behaviour
/// already owns (moth ships -0.48), but the tooltip prints mobs.json verbatim.
struct MobRows {
    std::vector<std::uint16_t> order;
    std::vector<double> speed;
};

const MobRows& mobRows() {
    static const MobRows rows = [] {
        MobRows out;
        out.speed.reserve(content().mobCount());
        for (std::size_t i = 0; i < content().mobCount(); ++i) {
            out.speed.push_back(content().mob(static_cast<std::uint16_t>(i)).speed);
        }

        Json root;
        std::string error;
        // Json::keys() preserves insertion order -- that is how loadDropTables
        // reads the sibling file.
        if (Json::parseFile(dataDirectory() + "/mobs.json", root, error) && root.isObject()) {
            for (const std::string& mobId : root.keys()) {
                const std::uint16_t index = content().mobIndex(mobId);
                if (index >= content().mobCount()) continue;
                out.order.push_back(index);
                const Json& speed = root[mobId]["speed"];
                if (speed.isNumber()) out.speed[index] = speed.asDouble(out.speed[index]);
            }
        }
        // A partial read would silently hide mobs; fall back to the whole
        // registry rather than to a truncated bestiary.
        if (out.order.size() != content().mobCount()) {
            out.order.clear();
            for (std::size_t i = 0; i < content().mobCount(); ++i) {
                out.order.push_back(static_cast<std::uint16_t>(i));
            }
        }
        return out;
    }();
    return rows;
}

std::vector<std::vector<DropDef>> loadDropTables() {
    std::vector<std::vector<DropDef>> byMob(content().mobCount());
    Json root;
    std::string error;
    if (!Json::parseFile(dataDirectory() + "/mob_drops.json", root, error)) return byMob;
    if (!root.isObject()) return byMob;

    for (const std::string& mobId : root.keys()) {
        const std::uint16_t index = content().mobIndex(mobId);
        if (index >= byMob.size()) continue;
        const Json& drops = root[mobId]["drops"];
        if (!drops.isArray()) continue;
        for (const Json& entry : drops.items()) {
            DropDef def;
            def.type = entry["type"].asString("petal");
            def.itemType = entry["itemType"].asString();
            if (def.itemType.empty()) continue;
            // As the server reads it (server/systems/loot.cpp): mobs drop no
            // consumables, and every other row is a petal.
            if (def.type == "consumable") continue;
            def.rarity = parseRarity(entry["rarity"].asString("common"));
            def.probability = entry["probability"].asDouble(0.0);
            def.maxQuantity = entry["maxQuantity"].asInt(1);
            def.petalIndex = content().petalIndex(def.itemType);
            byMob[index].push_back(std::move(def));
        }
    }

    // The guaranteed common egg is runtime content, generated per mob rather
    // than authored, so mob_drops.json does not hold it -- see
    // DropTables::resolve, which builds the same row on the server. It has to
    // be here too: above unusual a row's probability is its WEIGHT in the
    // draw for which item the kill is graded on, and leaving out the heaviest
    // row of all would overstate every other row on the card.
    for (std::size_t i = 0; i < byMob.size(); ++i) {
        const MobConfig& mob = content().mob(static_cast<std::uint16_t>(i));
        if (mob.noEggDrop ||
            (mob.id.size() >= 4 && mob.id.compare(mob.id.size() - 4, 4, "_pet") == 0)) continue;
        const std::string eggId = mob.id + "_egg";
        const std::uint16_t egg = content().petalIndex(eggId);
        if (egg == kInvalidIndex) continue;
        std::vector<DropDef>& rows = byMob[i];
        auto existing = std::find_if(rows.begin(), rows.end(), [&](const DropDef& row) {
            return row.petalIndex == egg && row.rarity == Rarity::Common;
        });
        if (existing != rows.end()) {
            existing->probability = 1.0;
            continue;
        }
        DropDef def;
        def.type = "petal";
        def.itemType = eggId;
        def.rarity = Rarity::Common;
        def.probability = 1.0;
        def.petalIndex = egg;
        rows.insert(rows.begin(), std::move(def));
    }
    return byMob;
}

/// Parsed once, on the first tooltip. Content is immutable after load, so the
/// resolved indices cannot go stale.
const std::vector<DropDef>& mobDropTable(std::uint16_t mobIndex) {
    static const std::vector<std::vector<DropDef>> tables = loadDropTables();
    static const std::vector<DropDef> kNone;
    return mobIndex < tables.size() ? tables[mobIndex] : kNone;
}

/// Crafting success at a tier, as a PERCENTAGE. The shared
/// `craftSuccessChance` is the same ladder expressed as a fraction; the drop
/// arithmetic below mixes it with literal 100s and needs this scale.
double craftPercent(int tier) { return 64.0 / std::pow(2.0, tier); }

/// The tier's column in the drop table, or -1 for a rarity items never take.
int dropTier(Rarity r) {
    const int i = rarityIndex(r);
    return i < kDropTiers ? i : -1;
}

double upgradePercent(Rarity r) {
    const int i = dropTier(r);
    return (i < 0 || i >= kDropTiers - 1) ? 0.0 : craftPercent(i) / 3.0;
}

double downgradePercent(Rarity r) {
    const int i = dropTier(r);
    return i <= 0 ? 0.0 : 100.0 / (1.0 + craftPercent(i - 1));
}

Rarity tierAbove(Rarity r) {
    const int i = dropTier(r);
    return (i >= 0 && i < kDropTiers - 1) ? static_cast<Rarity>(i + 1) : r;
}

Rarity tierBelow(Rarity r) {
    const int i = dropTier(r);
    return i > 0 ? static_cast<Rarity>(i - 1) : r;
}

/// One (item, rarity) square of the table.
struct DropCell {
    /// The entry whose multiplier the square shows. Later branches landing on
    /// the same square only add their probability, exactly as the reference's
    /// object spread keeps the first entry's fields.
    const DropDef* drop = nullptr;
    double probability = 0;   ///< percent, 0..100
};

struct DropRow {
    const DropDef* meta = nullptr;   ///< row identity: (type, itemType)
    std::array<DropCell, kDropTiers> cells{};
};

/// Mirrors the server drop pipeline so the tooltip shows real rates.
///
/// A common mob rolls each authored row on its own at the listed probability;
/// an unusual one hands out its whole table. Both keep the row's authored
/// rarity and branch into the upgrade/downgrade split. Every mob above that
/// also drops one of EVERY item it has -- two authored lines naming the same
/// item merge first, as the server merges them -- but only ONE of those rows
/// is the kill's graded drop, drawn weighted by probability and landing a
/// tier below the mob 90% of the time. The rest are chaff, flat at two tiers
/// down. Every graded outcome is then clamped up to the mob's rarity floor;
/// chaff is not, which is what keeps it chaff.
std::vector<DropRow> computeMobDrops(std::uint16_t mobIndex, Rarity mobRarity,
                                     std::array<bool, kDropTiers>& usedTiers) {
    std::vector<DropRow> rows;
    const std::vector<DropDef>& table = mobDropTable(mobIndex);
    if (table.empty()) return rows;

    const int tier = rarityIndex(mobRarity);
    const double upgradeMultiplier = dropUpgradeMultiplier(mobRarity);
    // Server-side floor on the graded drop: a rare mob never grades below one
    // tier under it, an epic or better below two. Chaff passes floorTier 0 --
    // it is the one thing the floor must not lift.
    const int minTier = tier >= 3 ? tier - 2 : (tier == 2 ? 1 : 0);

    const auto push = [&](const DropDef& drop, Rarity rarity, double probability,
                          int floorTier = 0) {
        if (probability <= 0) return;
        int column = dropTier(rarity);
        if (column < 0) return;
        if (column < floorTier) column = floorTier;
        // Below the petal's lowest tier the server drops nothing at all
        // (petalComesAt), so there is no chance to quote.
        if (drop.petalIndex != kInvalidIndex &&
            !petalComesAt(content().petal(drop.petalIndex), static_cast<Rarity>(column))) {
            return;
        }

        DropRow* row = nullptr;
        for (DropRow& candidate : rows) {
            if (candidate.meta->type == drop.type && candidate.meta->itemType == drop.itemType) {
                row = &candidate;
                break;
            }
        }
        if (row == nullptr) {
            rows.emplace_back();
            rows.back().meta = &drop;
            row = &rows.back();
        }
        DropCell& cell = row->cells[static_cast<std::size_t>(column)];
        if (cell.drop == nullptr) cell.drop = &drop;
        cell.probability += probability;
        usedTiers[static_cast<std::size_t>(column)] = true;
    };

    // An apex kill drops TEN of every row (LootSystem's `copies`): one base
    // rarity per row, then each copy rolls its own upgrade/downgrade. So a
    // graded square is the chance at least one of the ten lands on it -- at
    // one copy, just the branch's own chance, as every other tier shows.
    // Chaff needs nothing: its ten copies are all the same flat tier.
    const int copies = mobRarity == Rarity::Apex ? 10 : 1;

    // One graded drop: the mutually exclusive upgrade/downgrade split around
    // its base, every branch held up to the mob's floor. Branches the floor
    // lifts onto one square are one outcome for a copy, so they are summed
    // before the copies are.
    const auto outcomes = [&](Rarity base, double baseProb, const DropDef& drop) {
        const double up = std::min(100.0, upgradePercent(base) * upgradeMultiplier);
        // The server only rolls the downgrade when the upgrade missed.
        const double down = downgradePercent(base) * (100.0 - up) / 100.0;
        const double same = std::max(0.0, 100.0 - up - down);
        std::array<double, kDropTiers> perCopy{};
        const auto land = [&](Rarity rarity, double percent) {
            const int column = dropTier(rarity);
            if (column >= 0) perCopy[static_cast<std::size_t>(std::max(column, minTier))] += percent;
        };
        land(tierBelow(base), down);
        land(base, same);
        land(tierAbove(base), up);
        for (int column = 0; column < kDropTiers; ++column) {
            const double chance = std::min(1.0, perCopy[static_cast<std::size_t>(column)] / 100.0);
            if (chance <= 0) continue;
            push(drop, static_cast<Rarity>(column),
                 baseProb * 100.0 * (1.0 - std::pow(1.0 - chance, copies)));
        }
    };

    if (tier == rarityIndex(Rarity::Common)) {
        for (const DropDef& drop : table) outcomes(drop.rarity, drop.probability, drop);
        return rows;
    }

    // Rows naming one item are one drop, weighted by the chance that either
    // authored line would have fired.
    std::vector<std::pair<const DropDef*, double>> merged;
    for (const DropDef& drop : table) {
        const double probability = clamp(drop.probability, 0.0, 1.0);
        auto found = std::find_if(merged.begin(), merged.end(), [&](const auto& row) {
            return row.first->type == drop.type && row.first->itemType == drop.itemType;
        });
        if (found == merged.end()) {
            merged.emplace_back(&drop, probability);
        } else {
            found->second = 1.0 - (1.0 - found->second) * (1.0 - probability);
        }
    }

    // An unusual mob grades every row it hands out, so there is no draw and
    // no chaff -- the whole table pays out at its authored rarity.
    if (tier == rarityIndex(Rarity::Uncommon)) {
        for (const auto& [drop, probability] : merged) outcomes(drop->rarity, 1.0, *drop);
        return rows;
    }

    double totalWeight = 0;
    for (const auto& [drop, probability] : merged) totalWeight += probability;

    // Stepped by INDEX rather than through tierBelow() twice, which cannot
    // walk down from a tier the drop grid has no column for -- apex.
    const Rarity chaff = clampRarity(std::max(0, tier - 2));
    for (const auto& [drop, probability] : merged) {
        // The chance this is the row the kill is graded on.
        const double share = totalWeight > 0 ? probability / totalWeight : 0.0;
        const Rarity lower = clampRarity(std::min(tier - 1, kDropTiers - 1));
        outcomes(lower, share * 0.9, *drop);
        outcomes(drop->rarity, share * 0.1, *drop);
        // Every kill this row is NOT the graded drop, it still drops -- as
        // chaff, which the floor above deliberately does not reach.
        push(*drop, chaff, (1.0 - share) * 100.0);
    }
    return rows;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/// The gallery's own scrollbar: a bare thumb in the card's own frame colour,
/// with NO groove behind it. The reference draws only the thumb, so an
/// unscrolled panel shows one short bar in the top corner rather than a track
/// running the height of the card.
void galleryScrollbar(Canvas& canvas, Rect track, double contentHeight, double scroll,
                      double maxScroll) {
    const double thumbHeight = std::max(20.0, track.h * (track.h / contentHeight));
    const double thumbY = track.y + (scroll / maxScroll) * (track.h - thumbHeight);
    setFill(canvas, kGallerySkin.accent);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(track.x), static_cast<float>(thumbY),
                     static_cast<float>(track.w), static_cast<float>(thumbHeight), 4.0f);
    canvas.fill();
}

void drawDropCard(Canvas& canvas, const SpriteCache& sprites, double cellX, double rowY,
                  Rarity rarity, const DropCell& cell, double timeSeconds) {
    const double cardX = cellX + (kDropCellW - kCardSize) * 0.5;

    // Named, as gardn names every drop in its gallery: the tile lifts its
    // icon to make room for the name whether or not one is drawn, so a
    // nameless card reads as one with its label missing.
    ItemTile tile;
    tile.petalIndex = cell.drop->petalIndex;
    tile.rarity = rarity;
    if (cell.drop->maxQuantity > 1) tile.badge = "x" + std::to_string(cell.drop->maxQuantity);
    tile.timeSeconds = timeSeconds;
    drawItemTile(canvas, sprites, {cardX, rowY, kCardSize, kCardSize}, tile);

    // Aggregated branches can push the expected count past one drop per kill;
    // the display caps at 100% rather than printing a number no roll can mean.
    const std::string label = cell.probability < 0.01
                                  ? std::string("<0.01%")
                                  : fixedDecimals(std::min(100.0, cell.probability), 2) + "%";
    TextStyle probability = galleryStyle(10.0, kPaper);
    probability.align = Align::Centre;
    probability.baseline = Baseline::Top;
    text(canvas, label, cellX + kDropCellW * 0.5, rowY + kCardSize + 4.0, probability);
}

/// Scrollbar drag state.
///
/// It belongs on GalleryPanel, but menus.h declares that class and is not this
/// change's to edit. There is exactly one gallery panel in the process, so a
/// file-local record behaves identically until the fields can move onto it.
struct ScrollDrag {
    bool active = false;
    double startY = 0;
    double startOffset = 0;
};

ScrollDrag& scrollDrag() {
    static ScrollDrag drag;
    return drag;
}

} // namespace

double galleryMobDiameter(const ContentRegistry& content, const SpriteCache& sprites,
                          std::uint16_t mobIndex) {
    const MobConfig& config = content.mob(mobIndex);
    // Common's radius, never the cell's own tier: a row would otherwise swell
    // left to right and the grid would read as a size chart.
    const double radius = content.mobStats(mobIndex, Rarity::Common).radius;
    if (config.id == "digger") {
        return 2.0 * std::min(kGardnDiggerRadius, kGardnMobRadiusCap) * kGardnMobScale;
    }
    if (sprites.mobArt(mobIndex) == MobArt::None) {
        return std::min(kIconCap, radius * 2.0 * kIconZoom);
    }
    for (const GardnMobPicture& row : kGardnMobPicture) {
        if (config.id != row.id) continue;
        if (row.scaleOf) {
            // The same diameter is the same scale: a painter is fitted by the
            // diameter alone, whatever world radius it is cut at.
            const std::uint16_t other = content.mobIndex(row.scaleOf);
            if (other != kInvalidIndex && other != mobIndex) {
                return galleryMobDiameter(content, sprites, other);
            }
            break;
        }
        const double span = sprites.mobPictureSpan(mobIndex, radius);
        if (span > 0.0) return 2.0 * row.span / span;
    }
    // gardn's GalleryMob over this game's world picture: shrunk to the cap,
    // then drawn at half size, the art at the visual_scale the world draws it.
    const double visualScale = config.visualScale > 0 ? config.visualScale : 1.0;
    return 2.0 * std::min(radius, kGardnMobRadiusCap) * kGardnMobScale * visualScale;
}

void drawGalleryMob(Canvas& canvas, const ContentRegistry& content, const SpriteCache& sprites,
                    const WorldRenderer& renderer, std::uint16_t mobIndex, Rarity rarity,
                    Rect plate, double timeSeconds) {
    const MobConfig& config = content.mob(mobIndex);
    // Detail is cut from the mob's OWN common-tier radius, not from the tile:
    // a rock in the bestiary is the rock the garden has, at picture size,
    // rather than a boulder squeezed into 60 units.
    const double radius = content.mobStats(mobIndex, Rarity::Common).radius;
    const double diameter = galleryMobDiameter(content, sprites, mobIndex);
    const double cx = plate.x + plate.w * 0.5;
    const double cy = plate.y + plate.h * 0.5;

    if (config.id == "digger") {
        canvas.save();
        canvas.translate(static_cast<float>(cx), static_cast<float>(cy));
        renderer.drawDiggerPicture(canvas, diameter * 0.5, timeSeconds);
        canvas.restore();
        return;
    }

    // gardn's centipede: the head on the tile's centre and one body segment
    // two radii behind it, drawn after the head as GalleryMob draws it, the
    // pair clipped to the plate the way gardn clips every tile -- the
    // segment runs off the corner rather than being shrunk to fit.
    const std::uint16_t body = config.segmentBodyIndex;
    if (config.gardnChain && body != kInvalidIndex && sprites.mobArt(mobIndex) != MobArt::None) {
        const double tilt = sprites.mobPictureTilt(mobIndex);
        const double behind = diameter;  // two drawn radii
        canvas.save();
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(plate.x), static_cast<float>(plate.y),
                         static_cast<float>(plate.w), static_cast<float>(plate.h),
                         static_cast<float>(kCellRadius));
        canvas.clip();
        sprites.drawMob(canvas, mobIndex, rarity, cx, cy, diameter, tilt, timeSeconds, false,
                        radius);
        sprites.drawMob(canvas, body, rarity, cx - std::cos(tilt) * behind,
                        cy - std::sin(tilt) * behind, diameter, tilt, timeSeconds, false,
                        content.mobStats(body, Rarity::Common).radius);
        canvas.restore();
        return;
    }

    sprites.drawMobPicture(canvas, mobIndex, rarity, cx, cy, plate.w - kIconInset * 2.0, diameter,
                           timeSeconds, radius);
}

double GalleryPanel::preferredWidth() { return kCardWidth; }

double GalleryPanel::preferredHeight() { return kCardHeight; }

void GalleryPanel::reset() {
    // Deliberately empty. The browser panel's scroll offset is a member that
    // toggling never touches, so reopening the bestiary returns the player to
    // the row they were reading rather than to the bees.
}

bool GalleryPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Profile& profile = ctx.net.profile();
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    // The reference's listeners live on the panel's own canvas, so hover,
    // wheel and press only exist while the pointer is over the card.
    const bool overPanel = panel.contains(mouse);

    // The overlay frame, not the tall list panels' 7px one: the bestiary is a
    // corner panel, and it sat in that row wearing a frame almost twice as
    // thick as settings' and changelog's either side of it.
    panelCard(canvas, panel, kGallerySkin);

    TextStyle title = galleryStyle(24.0, kPaper);
    title.align = Align::Centre;
    text(canvas, "Mob Gallery", panel.x + panel.w * 0.5, panel.y + kPad + kTitleHeight * 0.5,
         title);

    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, closeRect.contains(mouse));

    // --- layout ------------------------------------------------------------
    const double contentTop = panel.y + kContentTop;
    const Rect view{panel.x + kPad, contentTop, panel.w - kPad * 2 - kScrollbarWidth - 4.0,
                    std::max(0.0, panel.h - kContentTop - kPad)};

    const double startX = view.x + std::max(0.0, (view.w - kGridWidth) * 0.5);

    std::vector<Cell> cells;
    cells.reserve(content().mobCount() * kTierColumns);
    double y = kContentTop;
    // Declaration order, not index order: the registry's indices are sorted.
    for (const std::uint16_t mobIndex : mobRows().order) {
        for (int tier = 0; tier < kTierColumns; ++tier) {
            const Rarity rarity = clampRarity(tier);
            Cell cell;
            cell.rect = {startX + tier * (kCell + kGridGap), y, kCell, kCell};
            cell.mobIndex = mobIndex;
            cell.rarity = rarity;
            cell.kills = profile.killCount(mobIndex, rarity);
            cells.push_back(cell);
        }
        y += kCell + kGridGap;
    }
    // The trailing row gap counts: the reference measures from the first row's
    // top to the cursor AFTER the last row's gap, which is one gap of slack at
    // the bottom of the scroll range.
    const double contentHeight = y - kContentTop;

    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = view.h;
    const double maxScroll = scroll_.maxOffset();

    // --- input -------------------------------------------------------------
    // The close button answers the PRESS, before anything else can claim it.
    const bool closing = ctx.pressed() && closeButtonHit(panel, ctx.window).contains(mouse);

    // Narrower than the reserve the grid was centred against, and hard against
    // the right padding: the bar the reference draws is 8 wide, not 12.
    const Rect trackRect{panel.right() - kPad - kThumbWidth, view.y, kThumbWidth, view.h};
    ScrollDrag& drag = scrollDrag();
    if (!ctx.window.mouseDown(MouseButton::Left)) drag.active = false;
    if (!closing && ctx.pressed() && maxScroll > 0 && trackRect.contains(mouse)) {
        drag.active = true;
        drag.startY = mouse.y;
        drag.startOffset = scroll_.offset;
    }
    if (drag.active) {
        // Track travel maps to content travel, so grabbing anywhere in the
        // groove drags at the same rate the thumb moves.
        scroll_.offset = drag.startOffset +
                         (mouse.y - drag.startY) * (maxScroll / std::max(1.0, view.h));
    } else if (overPanel) {
        // The wheel delta the browser reports is about 100px a notch, and its
        // sign is inverted against SDL's.
        scroll_.offset -= ctx.wheel() * 100.0;
    }
    // The grid band, which already stops short of the track.
    scroll_.offset -= touchScroll(ctx.window, view, maxScroll > 0);
    scroll_.offset = clamp(scroll_.offset, 0.0, maxScroll);

    // Hit-tested over EVERY cell, not just the drawn ones, and gated on the
    // content band rather than the grid: that is what the reference does, and
    // it is why a cell in the never-drawn bottom strip can still be hovered.
    //
    // Not while a finger is dragging the grid: the cell under it rides along
    // with it, and its card would follow the whole scroll. A TAP still hovers
    // -- it is the only way a phone has to read a cell at all.
    int hovered = -1;
    if (overPanel && !drag.active && !ctx.window.touchScrolling() && mouse.y >= view.y &&
        mouse.y <= view.bottom()) {
        const Vec2 inGrid{mouse.x, mouse.y - panel.y + scroll_.offset};
        for (std::size_t i = 0; i < cells.size(); ++i) {
            if (insideInclusive(cells[i].rect, inGrid)) {
                hovered = static_cast<int>(i);
                break;
            }
        }
    }

    // --- cells -------------------------------------------------------------
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(view.x), static_cast<float>(view.y), static_cast<float>(view.w),
                static_cast<float>(view.h));
    canvas.clip();

    for (std::size_t i = 0; i < cells.size(); ++i) {
        const Cell& cell = cells[i];
        // Culled in the CARD's space, which is the space cell.rect.y is
        // measured in: a cell is on screen when it lands inside the band the
        // content area occupies, kContentTop down from the card's top. The
        // browser build compared the same y against a band starting at zero,
        // which threw away the bottom row of every card it drew -- visible as
        // a strip of bare panel under the grid, and hoverable, since the hit
        // test never had the bug.
        const double bandTop = scroll_.offset + kContentTop;
        if (cell.rect.bottom() <= bandTop || cell.rect.y >= bandTop + view.h) continue;
        const Rect rect{cell.rect.x, panel.y + cell.rect.y - scroll_.offset, cell.rect.w,
                        cell.rect.h};

        const bool known = cell.kills > 0;

        setFill(canvas, known ? rarityColor(cell.rarity) : kGallerySkin.accent);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(rect.x), static_cast<float>(rect.y),
                         static_cast<float>(rect.w), static_cast<float>(rect.h),
                         static_cast<float>(kCellRadius));
        canvas.fill();
        // An unkilled cell is a bare plate in the card's own frame colour: a
        // hole punched in the sheet rather than a tile with something in it.
        // Only a killed one gets the rim -- the rarity at the 0.8 value every
        // item plate in the game is outlined with -- so the grid reads as a
        // checklist from across the panel, before a single tally is legible.
        if (known) {
            setStroke(canvas, shade(rarityColor(cell.rarity), kItemTilePlateShade));
            canvas.setLineWidth(static_cast<float>(kCellRim));
            canvas.stroke();
        }

        if (known) {
            drawGalleryMob(canvas, content(), ctx.sprites, ctx.renderer, cell.mobIndex, cell.rarity,
                           rect, ctx.timeSeconds);

            // Abbreviated, unlike the drop table's own counts: five figures of
            // ant kills laid across a 60-unit plate is a smear, and a bestiary
            // tally is read for its order of magnitude.
            const std::string tally = "x" + abbreviateNumber(cell.kills);
            TextStyle count = galleryStyle(kTallySize, kPaper);
            count.align = Align::Centre;
            count.baseline = Baseline::Middle;
            canvas.save();
            canvas.translate(static_cast<float>(rect.right() - kTallyInset),
                             static_cast<float>(rect.y + kTallyInset));
            canvas.rotate(static_cast<float>(kTallyTilt));
            text(canvas, tally, 0.0, 0.0, count);
            canvas.restore();
        }

        if (hovered == static_cast<int>(i)) {
            setStroke(canvas, kPaper);
            canvas.setLineWidth(2.0f);
            canvas.beginPath();
            canvas.roundRect(static_cast<float>(rect.x), static_cast<float>(rect.y),
                             static_cast<float>(rect.w), static_cast<float>(rect.h),
                             static_cast<float>(kCellRadius));
            canvas.stroke();
        }
    }
    canvas.restore();

    if (maxScroll > 0) {
        galleryScrollbar(canvas, trackRect, contentHeight, scroll_.offset, maxScroll);
    }

    // --- tooltip -----------------------------------------------------------
    // Only over a mob the account has actually killed. A locked cell says
    // nothing, which is what keeps the grid a checklist.
    if (hovered >= 0 && cells[static_cast<std::size_t>(hovered)].kills > 0) {
        const Cell& cell = cells[static_cast<std::size_t>(hovered)];
        const MobConfig& config = content().mob(cell.mobIndex);
        const MobStats stats = content().mobStats(cell.mobIndex, cell.rarity);

        std::vector<TooltipLine> lines;
        lines.emplace_back(config.name, 20.0, kPaper, 0.0);
        lines.emplace_back(rarityLabel(cell.rarity), 14.0, rarityColor(cell.rarity), 0.0);
        if (!config.description.empty()) {
            TooltipLine body{config.description, 12.0, kPaper, 10.0};
            body.maxWidth = 280.0;
            lines.push_back(std::move(body));
        }
        const double statGap = config.description.empty() ? 10.0 : 4.0;
        const auto stat = [&](std::string body, double gapBefore,
                              std::optional<std::uint32_t> labelColor = std::nullopt) {
            TooltipLine line{std::move(body), 12.0, kPaper, gapBefore};
            line.alpha = 0.56;
            line.labelColor = labelColor;
            lines.push_back(std::move(line));
        };
        stat("HP: " + abbreviateNumber(stats.health), statGap, kStatHealth);
        stat("Damage: " + abbreviateNumber(stats.damage), 0.0, kStatDamage);
        // Skipped when it is nothing, because a zero here reads as a mob with
        // a weakness rather than one whose author simply wrote no armour.
        if (stats.armor != 0.0) stat("Armor: " + abbreviateNumber(stats.armor), 0.0, kStatArmor);
        // Only the evasive few carry one, and it is the reason the fly takes
        // ten swings to kill -- the card is the one place that can say so.
        if (stats.evasion > 0.0) {
            stat("Evasion: " + fixedDecimals(stats.evasion * 100.0, 0) + "%", 0.0);
        }
        // florr's Mob/Attribute/UndeadDuration: how long this tier stands
        // Undead when it is struck down.
        if (const double undead = mobUndeadMillis(config, cell.rarity); undead > 0.0) {
            char buffer[32];
            std::snprintf(buffer, sizeof buffer, "%g", std::round(undead / 10.0) / 100.0);
            stat("Undead: " + std::string(buffer) + "s", 0.0, kStatUndead);
        }
        // The raw config figure, not the units-per-second the simulation runs
        // on, and the AUTHORED sign with it: the tooltip reads straight off
        // mobs.json, where the moth's -0.48 is what a player sees. The unit is
        // a flower's top speed, so two places: a bee is 0.1, a fly 0.48.
        stat("Speed: " + fixedDecimals(mobRows().speed[cell.mobIndex], 2), 0.0);
        stat("XP: " + abbreviateNumber(stats.xp), 0.0);

        std::array<bool, kDropTiers> usedTiers{};
        const std::vector<DropRow> rows = computeMobDrops(cell.mobIndex, cell.rarity, usedTiers);
        std::vector<int> columns;
        for (int i = 0; i < kDropTiers; ++i) {
            if (usedTiers[static_cast<std::size_t>(i)]) columns.push_back(i);
        }
        const bool hasDrops = !rows.empty() && !columns.empty();

        const double tableWidth = static_cast<double>(columns.size()) * kDropCellW;
        const double dropsHeight =
            hasDrops ? kDropsGapY + kDropsHeaderH + kColHeaderH +
                           static_cast<double>(rows.size()) * kDropRowH +
                           std::max<double>(0.0, static_cast<double>(rows.size()) - 1.0) *
                               kDropRowGapY
                     : 0.0;
        const double minWidth = hasDrops ? tableWidth : 0.0;

        // Anchored to the CELL and clamped to the SCREEN, never to the cursor:
        // a box that follows the pointer slides over the thing being read.
        //
        // The screen, not the card, because the card is a corner overlay now:
        // a drop table is wider than half of it, so clamping to the card would
        // fold the box back over the very cell it describes. Overhanging the
        // right edge onto the world is what the reference does.
        const Vec2 size = measureTooltip(lines, minWidth, dropsHeight);
        double tx = cell.rect.right() + 8.0;
        double ty = panel.y + cell.rect.y - scroll_.offset;
        if (tx + size.x > canvas.width() - 4.0) tx = cell.rect.x - size.x - 8.0;
        if (ty + size.y > canvas.height() - 4.0) ty = canvas.height() - size.y - 4.0;
        if (tx < 4.0) tx = 4.0;
        if (ty < contentTop) ty = contentTop;

        const Rect box = paintTooltip(canvas, tx, ty, lines, minWidth, dropsHeight);

        if (hasDrops) {
            double cy = box.y + kDropsGapY;
            TextStyle heading = galleryStyle(12.0, 0xFFD700u);
            heading.baseline = Baseline::Top;
            text(canvas, "Drops:", box.x, cy, heading);
            cy += kDropsHeaderH;

            const double tableX = tx + (size.x - tableWidth) * 0.5;
            TextStyle header = galleryStyle(10.0, kPaper);
            header.align = Align::Centre;
            for (std::size_t i = 0; i < columns.size(); ++i) {
                const Rarity rarity = clampRarity(columns[i]);
                header.fill = rarityColor(rarity);
                text(canvas, rarityLabel(rarity),
                     tableX + static_cast<double>(i) * kDropCellW + kDropCellW * 0.5,
                     cy + kColHeaderH * 0.5, header);
            }
            cy += kColHeaderH;

            for (std::size_t r = 0; r < rows.size(); ++r) {
                const double rowY = cy + static_cast<double>(r) * (kDropRowH + kDropRowGapY);
                for (std::size_t i = 0; i < columns.size(); ++i) {
                    const double cellX = tableX + static_cast<double>(i) * kDropCellW;
                    // A tier this row cannot drop at is left blank, not drawn
                    // as an empty frame.
                    const DropCell& square = rows[r].cells[static_cast<std::size_t>(columns[i])];
                    if (square.drop == nullptr) continue;
                    drawDropCard(canvas, ctx.sprites, cellX, rowY, clampRarity(columns[i]), square,
                                 ctx.timeSeconds);
                }
            }
        }
    }

    return !closing;
}

} // namespace flix
