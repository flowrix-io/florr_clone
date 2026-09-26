#include "client/ui/item_tile.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "client/render/art_cache.h"
#include "client/ui/draw.h"
#include "client/ui/menu_widgets.h"
#include "client/ui/text.h"
#include "client/ui/text_select.h"
#include "shared/game/components.h"
#include "shared/game/config.h"

namespace flix::ui {

namespace {

/// The plate: a 60x60 rounded rect in the darker shade with a SHARP 50x50 of
/// the rarity colour inside it. Two fills rather than a stroke, so the visible
/// border is a full 5 design units instead of the 2.5 a centred stroke leaves.
constexpr double kPlateSide = 60.0;
constexpr double kPlateRadius = 3.0;
constexpr double kFaceSide = 50.0;

/// The drop's backdrop, from gardn's render_drop: 3 units proud of the plate
/// on every side, at a quarter black.
constexpr double kShadowSide = 68.0;
constexpr double kShadowRadius = 4.0;
constexpr double kShadowAlpha = 0.15;

constexpr double kNameSize = 12.0;
/// Where the name's middle sits, measured from the RISEN origin the icon is
/// drawn about -- gardn writes it at `translate(0, 20)` on top of the
/// `translate(0, -5)` that lifted the icon, so it lands at +15 in the cell.
/// Reading that 20 as an absolute baseline is what had this game's names five
/// units low, crowding the plate's bottom edge.
constexpr double kNameBaseline = 20.0 - kItemTileIconRise;
/// Every outline inside a tile, as a fraction of its own text size: gardn's
/// `TextArgs::stroke_scale`. A fraction, not a constant screen width -- an
/// outline pinned to 3px made the name on a 46px bar tile nearly three times
/// as heavy as gardn's and turned a small tile's caption into a black blob.
constexpr double kTextStrokeScale = 0.12;
/// The plate's border: the 5 units of darker shade left showing around the
/// face, on each side.
constexpr double kPlateBorder = (kPlateSide - kFaceSide) * 0.5;

/// The live counter's pill. It IS the border -- the same colour, centred on
/// the border's own mid-line, so the top edge swells into a capsule around the
/// number instead of carrying a badge on top of it. Half of it therefore falls
/// outside the plate, which is what makes the swell read as a swell.
///
/// The width floats with the number, between a minimum that keeps "0" a pill
/// rather than a dot and a maximum that keeps a four-figure reading inside the
/// plate.
constexpr double kCounterSize = 11.0;
constexpr double kCounterHeight = 15.0;
constexpr double kCounterPadX = 5.0;
constexpr double kCounterMinWidth = 19.0;
constexpr double kCounterMaxWidth = 46.0;
constexpr double kCounterCentreY = -kPlateSide * 0.5 + kPlateBorder * 0.5;
/// The stack count, top-right, tilted as the reference shot draws it. A count
/// lying flat on a square plate reads as part of the artwork; the tilt is what
/// makes it a sticker on the tile instead.
constexpr double kBadgeSize = 16.0;
constexpr double kBadgeTiltRadians = -14.0 * kPi / 180.0;
/// The corner it hangs off, in the design cell. The plate's own corner rather
/// than the face's: the tilt swings the text's right end a couple of units
/// past the anchor, which lands it flush with the plate's edge.
constexpr double kBadgeAnchorX = 26.0;
constexpr double kBadgeAnchorY = -26.0;

constexpr double kHoverAlpha = 0.15;
constexpr double kDisabledAlpha = 0.6;
constexpr std::uint32_t kDisabledFill = 0x3A3A3Au;

/// The wedge is swept from a 90-unit radius so its straight edges leave the
/// plate rather than ending inside it; the clip is what makes it a corner.
constexpr double kReloadRadius = 90.0;
constexpr double kReloadAlpha = 0.25;

/// The ring a cluster is spaced on when the petal names no `clump_radius` of
/// its own: gardn's `draw_static_petal` default.
constexpr double kClusterRing = 10.0;

/// How far out a cluster's icons sit for a petal gardn does not have, in that
/// petal's radii: just under one, so neighbours overlap slightly rather than
/// only touching outlines.
constexpr double kClusterRingPerRadius = 0.8;

/// gardn's `radius` past which it shrinks a petal to fit its plate, and the
/// radius it shrinks it to. `draw_loadout_background` does this as
/// `if (data.radius > 20) ctx.scale(20 / data.radius)` -- so it is the PETAL's
/// own radius that decides, and the whole cluster that shrinks, ring included.
constexpr double kGardnShrinkAbove = 20.0;

/// What gardn actually DRAWS for every petal both games have.
///
/// `drawn` is the width of the picture `draw_static_petal_single` puts on the
/// canvas -- outline included -- measured off ~/gardn's own Petal.cc by
/// running it against a Renderer that records a bounding box instead of
/// painting. It is not `radius`: gardn strokes almost every petal with a
/// three-unit line and lets plenty of them run well past their radius, so a
/// leaf is 38 units across on a radius of 10 and a bone 45 on a radius of 12.
/// Sizing an icon by radius drew those at half of gardn's, which is what made
/// this game's bar read as a row of specks.
///
/// `radius` is gardn's PETAL_DATA radius, and it is here only for the shrink
/// rule above -- moon and cutter are the two petals it fires for.
/// `clump` is gardn's `clump_radius`, 0 for "use kClusterRing".
///
/// All three are rarity-invariant in gardn: it calls radius a tactical knob,
/// not a power knob. A petal gardn does not have -- every egg past the ant's,
/// and this game's own additions -- is not in here and falls back to
/// kPetalIconSize x `sizeStat` x `visual_scale`. Add a row when gardn grows
/// one, never to hand-tune an icon: this is a port, not a taste.
struct GardnIcon {
    const char* id;
    double drawn;   ///< the picture's width in gardn units, outline included
    double radius;  ///< gardn's PETAL_DATA radius, for the shrink rule
    double clump;   ///< gardn's clump_radius; 0 means kClusterRing
    double tilt;    ///< gardn's `icon_angle`, radians, applied to each icon
    /// How much of ITS OWN viewBox this game's artwork actually covers.
    ///
    /// A sprite is fitted to the box it is asked for, so a document whose
    /// viewBox is padded -- soil covers under half of its own, bone two
    /// thirds, dandelion four fifths because its box is kept symmetric about
    /// the stalk's pivot -- draws that much under the size asked for. The
    /// diameter is divided by this so what lands on the plate is `drawn`.
    /// 1 for the thirty-three petals whose box already hugs their picture.
    ///
    /// Measured by rasterising each document at 512px in a browser and
    /// taking the alpha bounding box, which is the same fit the sprite cache
    /// applies. Sponge has no document -- it is a C++ painter, which draws
    /// to the size it is handed -- so it takes 1.
    double box;
};
constexpr GardnIcon kGardnIcon[] = {
    {"antennae",           33, 12.5,  0,       0,     1},
    {"basic",              23,   10,  0,       0,     1},
    {"bone",             38.5,   12,  0,       1, 0.664},   // art fills 66% of its box
    {"bubble",             27,   12,  0,       0,     1},
    {"cactus",           33.5,   15,  0,       0, 0.824},   // art fills 82% of its box
    {"corn",               32,   16,  0,     0.5, 0.965},   // art fills 96% of its box
    {"cutter",             70,   40,  0,       0, 0.875},   // shrinks 20/40; fills 88% of its box
    {"dahlia",             17,    7, 10,       0,     1},
    {"dandelion",          31,   10,  0,       1, 0.795},   // art fills 80% of its box
    {"egg",                28, 12.5,  0,       0, 0.938},   // art fills 94% of its box
    {"faster",             17,    7,  0,       0,     1},
    {"heaviest",           35,   12,  0,       0,     1},
    {"honey",              25,   11,  0,       0,     1},
    {"iris",               17,    7,  0,       0,     1},
    {"leaf",            38.25,   10,  0,      -1,     1},
    {"light",             17,    7,  0,       0,     1},
    {"lightning",          21,   10,  0,       0, 0.775},   // art fills 78% of its box
    {"lotus",            26.5,   12,  0,     0.1,     1},
    {"magnet",           42.5,   12,  0,       0,     1},
    {"missile",            27,   10,  0,       1,     1},
    {"moon",              126,   50,  0,       0,     1},   // shrinks 20/50
    {"observer",           35, 12.5,  0,       0,     1},
    {"peas",               17,    7,  8,       0,     1},
    {"pincer",             23,   10,  0,     0.7,     1},
    {"pollen",             17,    7,  0,       0,     1},
    {"powder",           15.5,   10,  0,       0, 0.727},   // art fills 73% of its box
    {"rice",               25,   13,  0,     0.7,     1},
    {"rock",             29.5,   12,  0,       0, 0.986},   // art fills 99% of its box
    {"rose",               23,   10,  0,       0,     1},
    {"sand",               17,    7, 10,       0, 0.852},   // art fills 85% of its box
    {"shell",              31,   10,  0,       0, 0.973},   // art fills 97% of its box
    {"soil",               24,   10,  0,       0, 0.488},   // art fills 49% of its box
    {"sponge",           34.5,   12,  0,       0,     1},
    {"square",           23.5,   15,  0,  1.7854, 0.969},   // art fills 97% of its box
    {"starfish",           26,    8,  0,       -1, 0.797},   // art fills 80% of its box
    {"stick",              27,   15,  0,       1,     1},
    {"stinger",          15.5,    7,  0,       0,     1},
    // gardn's drawing of this one hard-codes `ctx.scale(0.5)` and ignores the
    // radius, so its picture is a 10.75-unit speck -- the one place the
    // measurement does not transfer. Sized from the radius like every other
    // petal instead: 2r plus its 1.5 outline.
    {"third_eye",        41.5,   20,  0,       0,     1},
    {"uranium",            21,   10,  0,       0,     1},
    {"web",                24,   10,  0,       0, 0.957},   // art fills 96% of its box
    {"wing",               33,   10,  0,       1,     1},
    {"yggdrasil",        26.5,   12,  0,     kPi, 0.932},   // art fills 93% of its box
    {"yin_yang",           23,   10,  0,       0, 0.926},   // art fills 93% of its box
    {"yucca",              31,   10,  0,      -1, 0.969},   // art fills 97% of its box
    {"fang",              31,   10,  0,      1, 0.969},   // art fills 97% of its box
    {"coral",              31,   10,  0,      1, 0.969},   // art fills 97% of its box
};

/// How one petal is laid out inside a tile, in design units.
struct ClusterShape {
    double diameter = 0;  ///< one icon
    double ring = 0;      ///< how far each icon of a stack sits off centre
    double shrink = 1;    ///< gardn's oversize clamp, applied to both
    /// gardn's `icon_angle`: a fixed tilt each icon is turned by, on top of
    /// whichever way round the ring it sits. Thirteen petals carry one -- a
    /// leaf lies back, a square stands on its corner, yggdrasil is upside
    /// down -- and without it they read as the same shapes lying flat.
    double tilt = 0;
};

/// gardn's own numbers where gardn has the petal, and this game's fallback
/// where it does not.
///
/// The id lookup is resolved once into a table indexed by petal index: the
/// content registry is loaded before anything draws and never reloaded, and a
/// panel of sixty tiles would otherwise run sixty string scans a frame.
///
/// `visual_scale` multiplies the FALLBACK only. It is this game's way of
/// saying "gardn draws this one much bigger than its radius" -- root is
/// authored at 1.87 for exactly that reason -- and for a petal that is in the
/// table above, that statement is already the measurement.
ClusterShape clusterShape(std::uint16_t petalIndex, double sizeStat, int count) {
    static const std::vector<const GardnIcon*> byIndex = [] {
        std::vector<const GardnIcon*> out(content().petalCount(), nullptr);
        for (std::uint16_t i = 0; i < content().petalCount(); ++i) {
            const std::string& id = content().petal(i).id;
            for (const GardnIcon& row : kGardnIcon) {
                if (id == row.id) {
                    out[i] = &row;
                    break;
                }
            }
        }
        // A magic petal takes the measurement of the petal it is the magic
        // form of. Not a hand-tune and not a second table: the two share one
        // picture down to the viewBox -- magic_leaf IS leaf's document in
        // cyan -- so a measurement of one is a measurement of both, tilt
        // included. Without this they fell through to the generic fallback and
        // came out at 20 units flat: a magic leaf drawn at half a leaf's size
        // and lying flat where a leaf lies back.
        //
        // A second pass, because the row a magic petal wants may belong to a
        // petal the first pass had not reached yet.
        for (std::uint16_t i = 0; i < content().petalCount(); ++i) {
            if (out[i] != nullptr) continue;
            const std::uint16_t base = content().magicSourceOf(i);
            if (base != kInvalidIndex && base < out.size()) out[i] = out[base];
        }
        return out;
    }();

    ClusterShape out;
    const GardnIcon* gardn = petalIndex < byIndex.size() ? byIndex[petalIndex] : nullptr;
    if (gardn != nullptr) {
        out.diameter = gardn->drawn / (gardn->box > 0 ? gardn->box : 1.0);
        out.ring = count > 1 ? (gardn->clump > 0 ? gardn->clump : kClusterRing) : 0.0;
        out.tilt = gardn->tilt;
        if (gardn->radius > kGardnShrinkAbove) out.shrink = kGardnShrinkAbove / gardn->radius;
        return out;
    }
    // Zero (or an absent field) means "unscaled" rather than "invisible",
    // exactly as the world renderer's petalArtScale() reads it.
    const double scale =
        petalIndex < content().petalCount() ? content().petal(petalIndex).visualScale : 0.0;
    const double radius = kPetalIconSize * 0.5 * (sizeStat > 0 ? sizeStat : 1.0);
    out.diameter = radius * 2.0 * (scale > 0 ? scale : 1.0);
    // Kept to the petal's size rather than gardn's fixed ring, because this
    // game authors petal size per petal: a fixed ring would leave a large
    // petal's cluster fused into a blob and a small one's scattered. And the
    // radius is taken BEFORE visual_scale, which grows each icon and not the
    // ring: a ring grown with it set the oranges -- whose fruit covers barely
    // three fifths of its box -- so far apart they fell off the plate.
    out.ring = count > 1 ? radius * kClusterRingPerRadius : 0.0;
    return out;
}

/// gardn's smootherstep on the remaining fraction: the sweep eases in and out
/// instead of ticking round at a constant rate.
double smootherStep(double t) {
    return t * t * t * (t * (6.0 * t - 15.0) + 10.0);
}

} // namespace

PetalIconMetric petalIconMetric(std::uint16_t petalIndex, double sizeStat) {
    const ClusterShape shape = clusterShape(petalIndex, sizeStat, 1);
    return PetalIconMetric{shape.diameter * shape.shrink, shape.tilt};
}

/// How much wider than the cluster its baked bitmap is, so artwork that paints
/// outside the box it was fitted into is not cropped by the bake.
constexpr double kClusterBakeMargin = 1.35;

/// The stack size from which an inward-facing cluster closes up the way
/// gardn's pinger does: five stingers turned in on its clump radius of 10.
constexpr int kTightClusterCount = 5;

void drawPetalCluster(Canvas& canvas, const SpriteCache& sprites, std::uint16_t petalIndex,
                      double sizeStat, int count, double cx, double cy, double maxDiameter,
                      double timeSeconds, bool facesInward) {
    if (petalIndex == kNoPetal || !sprites.petalDrawable(petalIndex)) return;

    // A configured count below one means "not a stack" -- third eye, antennae
    // and the observer all declare zero and are drawn as a single icon.
    const int drawCount = count >= 1 ? count : 1;
    const ClusterShape shape = clusterShape(petalIndex, sizeStat, drawCount);

    // gardn's own clamp is the `shrink` inside the shape; `maxDiameter` is a
    // caller's backstop on top of it, and a petal gardn measures is already
    // inside its plate without one, so the tile passes none.
    double fit = shape.shrink;
    const double clusterDiameter = (shape.ring * 2.0 + shape.diameter) * fit;
    if (maxDiameter > 0 && clusterDiameter > maxDiameter) fit *= maxDiameter / clusterDiameter;

    const double diameter = shape.diameter * fit;
    const double ring = shape.ring * fit;
    // gardn measures its clump radius to each petal's own ORIGIN -- a
    // stinger's is the middle of its triangle -- while drawPetal centres the
    // viewBox, which for a stinger sits 1.75 units nearer the point. Turned
    // inward, that left every triangle 1.75 units further out than the pinger
    // draws it, and a ring of five read as a loose pinwheel rather than one
    // closed shape. A big enough inward cluster puts the origin on the ring.
    const bool tight = facesInward && drawCount >= kTightClusterCount;
    const Vec2 origin = tight ? sprites.petalOrigin(petalIndex) : Vec2{};

    const auto paintCluster = [&](Canvas& into, double ox, double oy) {
        if (drawCount == 1) {
            sprites.drawPetal(into, petalIndex, ox, oy, diameter, shape.tilt, timeSeconds);
            return;
        }
        for (int i = 0; i < drawCount; ++i) {
            const double angle = (static_cast<double>(i) / drawCount) * kTau;
            // Turned to face outward AND tilted by the petal's own icon angle,
            // which is the order gardn applies them in: it rotates to the ring
            // place, steps out along it, then rotates again by `icon_angle`.
            // An inward-facing cluster is turned the other half of the way
            // round, so its icons point at each other.
            const double facing = facesInward ? angle + kPi : angle;
            const double turn = facing + shape.tilt;
            // The origin's offset from the box centre, turned with the icon;
            // stepping back by it lands the origin on the ring place.
            const double backX = (origin.x * std::cos(turn) - origin.y * std::sin(turn)) * diameter;
            const double backY = (origin.x * std::sin(turn) + origin.y * std::cos(turn)) * diameter;
            sprites.drawPetal(into, petalIndex, ox + std::cos(angle) * ring - backX,
                              oy + std::sin(angle) * ring - backY, diameter, turn, timeSeconds);
        }
    };

    // The cluster on a tile is the same picture every frame -- the petals do
    // not turn and the artwork does not animate -- so it is baked once and
    // blitted. A full loadout bar was over a thousand drawing calls a frame,
    // rebuilt sixty times a second from artwork that had not changed since it
    // was equipped, and it is the single biggest line in the counters.
    //
    // The per-instance rotations live INSIDE the bake, so the blit itself is
    // axis-aligned. drawCachedPicture refuses a rotated ambient transform for
    // itself, which is what keeps a drop -- an item tile laid on the ground at
    // its own tilt -- on the direct path.
    if (!sprites.petalAnimated(petalIndex)) {
        // A margin on the box: a petal's artwork may paint outside the circle
        // it is fitted into, and a bake that cropped it would be a visible
        // change rather than a free one.
        const double side = (ring * 2.0 + diameter) * kClusterBakeMargin;
        // Quantised, because the size is part of the key and one that wobbled
        // in its last decimal would bake a new bitmap every frame.
        const auto q = [](double v) { return static_cast<std::uint64_t>(std::lround(v * 16.0)); };
        std::uint64_t variant = petalIndex;
        variant = variant * 1000003u + static_cast<std::uint64_t>(drawCount);
        variant = variant * 1000003u + q(diameter);
        variant = variant * 1000003u + q(ring);
        variant = variant * 1000003u + q(shape.tilt);
        variant = variant * 2u + (facesInward ? 1u : 0u);
        if (drawCachedPicture(canvas, &sprites, variant, cx - side * 0.5, cy - side * 0.5, side,
                              side, [&](Canvas& bitmap) {
                                  paintCluster(bitmap, side * 0.5, side * 0.5);
                              })) {
            return;
        }
    }

    paintCluster(canvas, cx, cy);
}

void drawItemTile(Canvas& canvas, const SpriteCache& sprites, Rect rect, const ItemTile& tile) {
    TextCaptureScope off(false);
    const double side = std::min(rect.w, rect.h);
    if (side <= 0.0 || tile.alpha <= 0.0) return;
    const double scale = side / kItemTileDesign;

    const bool filled = !tile.empty && tile.petalIndex != kNoPetal;
    const std::uint32_t base = tile.empty ? tile.emptyFill : rarityColor(tile.rarity);
    const std::uint32_t border =
        tile.empty ? tile.emptyBorder : hsvScale(base, kItemTilePlateShade);

    canvas.save();
    canvas.translate(static_cast<float>(rect.x + rect.w * 0.5),
                     static_cast<float>(rect.y + rect.h * 0.5));
    canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
    if (tile.alpha < 1.0) canvas.setGlobalAlpha(static_cast<float>(tile.alpha));

    if (tile.shadow) {
        setFill(canvas, kInk, kShadowAlpha);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(-kShadowSide * 0.5),
                         static_cast<float>(-kShadowSide * 0.5), static_cast<float>(kShadowSide),
                         static_cast<float>(kShadowSide), static_cast<float>(kShadowRadius));
        canvas.fill();
    }

    setFill(canvas, border);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(-kPlateSide * 0.5), static_cast<float>(-kPlateSide * 0.5),
                     static_cast<float>(kPlateSide), static_cast<float>(kPlateSide),
                     static_cast<float>(kPlateRadius));
    canvas.fill();
    // The face drains downward as the petal loses health, uncovering the plate
    // that is already under it -- so a full tile is the flat rarity square it
    // has always been, and a dead one is the plate's darker shade all through.
    const double standing = filled ? std::clamp(tile.health, 0.0, 1.0) : 1.0;
    if (standing > 0.0) {
        const double faceHeight = kFaceSide * standing;
        setFill(canvas, base);
        canvas.fillRect(static_cast<float>(-kFaceSide * 0.5),
                        static_cast<float>(kFaceSide * 0.5 - faceHeight),
                        static_cast<float>(kFaceSide), static_cast<float>(faceHeight));
    }

    if (tile.hovered) {
        setFill(canvas, kPaper, kHoverAlpha);
        canvas.fillRect(static_cast<float>(-kFaceSide * 0.5), static_cast<float>(-kFaceSide * 0.5),
                        static_cast<float>(kFaceSide), static_cast<float>(kFaceSide));
    }

    // Everything below is clipped to the face, which is what turns the reload
    // wedge into a corner sweep and keeps a long name inside the plate.
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(-kFaceSide * 0.5), static_cast<float>(-kFaceSide * 0.5),
                static_cast<float>(kFaceSide), static_cast<float>(kFaceSide));
    canvas.clip();

    if (filled && tile.reload < 1.0) {
        const double remaining = smootherStep(1.0 - std::max(0.0, tile.reload));
        setFill(canvas, kInk, kReloadAlpha);
        canvas.beginPath();
        canvas.moveTo(0.0f, 0.0f);
        canvas.arc(0.0f, 0.0f, static_cast<float>(kReloadRadius),
                   static_cast<float>(-kPi * 0.5 - remaining * kPi * 10.0),
                   static_cast<float>(-kPi * 0.5 - remaining * kPi * 8.0), false);
        canvas.closePath();
        canvas.fill();
    }

    if (filled) {
        const PetalStats stats = content().petalStats(tile.petalIndex, tile.rarity);
        canvas.save();
        canvas.translate(0.0f, static_cast<float>(-kItemTileIconRise));
        canvas.scale(static_cast<float>(kItemTileIconScale),
                     static_cast<float>(kItemTileIconScale));
        // A clump the world draws pointing inward is drawn that way here too
        // -- all but the mythic stinger, whose three outward triangles close
        // up into one bigger triangle and are kept that way on purpose.
        const PetalConfig& config = content().petal(tile.petalIndex);
        const bool facesInward = config.clumpFacesInward &&
                                 !(config.id == "stinger" && tile.rarity == Rarity::Mythic);
        // No cap: gardn's own oversize rule lives inside the cluster, and every
        // petal it measures already fits its plate. The face clip is what
        // catches anything this game later adds that does not.
        drawPetalCluster(canvas, sprites, tile.petalIndex, stats.size, stats.count, 0.0, 0.0, 0.0,
                         tile.timeSeconds, facesInward);
        canvas.restore();
    }

    if (filled && tile.showName) {
        const std::string name = tile.nameOverride.empty()
                                     ? titleCase(content().petal(tile.petalIndex).name)
                                     : tile.nameOverride;
        if (!name.empty()) {
            TextStyle label;
            label.bold = true;
            label.size = kNameSize;
            // Shrink to the face rather than clipping: a truncated petal name
            // reads as a different petal.
            const double measured = measure(name, kNameSize, true);
            if (measured > kFaceSide) {
                label.size = std::max(6.0, kNameSize * kFaceSide / measured);
            }
            label.fill = kPaper;
            label.stroke = kInk;
            label.strokeWidth = label.size * kTextStrokeScale;
            label.align = Align::Centre;
            label.baseline = Baseline::Middle;
            text(canvas, name, 0.0, kNameBaseline, label);
        }
    }

    canvas.restore();  // unclip

    // The counter's pill: the border itself, swollen around the number and
    // centred on the border's mid-line. Outside the face clip, so neither the
    // reload wedge nor a drained face eats it, and after the icon, so a
    // cluster wide enough to reach the top edge passes under it.
    //
    // Being the border's own colour, the pill can land on a field of that
    // colour -- a tile drained back to the bare plate -- so the number keeps
    // the outline the petal's name wears for the same reason.
    if (filled && !tile.counter.empty()) {
        TextStyle label;
        label.bold = true;
        label.size = kCounterSize;
        double measured = measure(tile.counter, kCounterSize, true);
        // A four-figure counter shrinks to the pill rather than widening it
        // past the plate: the pill is a fixture of the border, not a label
        // that grows out of the tile.
        const double widest = kCounterMaxWidth - kCounterPadX * 2;
        if (measured > widest) {
            label.size = std::max(6.0, kCounterSize * widest / measured);
            measured = widest;
        }
        const double pillWidth =
            std::clamp(measured + kCounterPadX * 2, kCounterMinWidth, kCounterMaxWidth);
        setFill(canvas, border);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(-pillWidth * 0.5),
                         static_cast<float>(kCounterCentreY - kCounterHeight * 0.5),
                         static_cast<float>(pillWidth), static_cast<float>(kCounterHeight),
                         static_cast<float>(kCounterHeight * 0.5));
        canvas.fill();

        label.fill = kPaper;
        label.stroke = kInk;
        label.strokeWidth = label.size * kTextStrokeScale;
        label.align = Align::Centre;
        label.baseline = Baseline::Middle;
        text(canvas, tile.counter, 0.0, kCounterCentreY, label);
    }

    // The badge sits OUTSIDE the face clip, so it reaches the plate's own
    // corner the way the reference's does. Inside it, the count was held a
    // border's width in from the edge and read as floating over the icon
    // rather than as a label pinned to the tile.
    if (!tile.badge.empty()) {
        TextStyle badge;
        badge.bold = true;
        badge.size = kBadgeSize;
        badge.fill = kPaper;
        badge.stroke = kInk;
        badge.strokeWidth = badge.size * kTextStrokeScale;
        badge.align = Align::Right;
        badge.baseline = Baseline::Top;
        badge.roundJoin = true;
        // Rotated about the corner it is anchored to, so the tilt lifts the
        // text's head to the right and swings its tail down and away.
        canvas.save();
        canvas.translate(static_cast<float>(kBadgeAnchorX), static_cast<float>(kBadgeAnchorY));
        canvas.rotate(static_cast<float>(kBadgeTiltRadians));
        text(canvas, tile.badge, 0.0, 0.0, badge);
        canvas.restore();
    }

    // The selection ring goes OUTSIDE the clip, or the half of it that lands
    // on the plate's border is eaten.
    if (tile.selected) {
        setStroke(canvas, kPaper);
        canvas.setLineWidth(3.0f);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(-kPlateSide * 0.5 + 1.5),
                         static_cast<float>(-kPlateSide * 0.5 + 1.5),
                         static_cast<float>(kPlateSide - 3.0),
                         static_cast<float>(kPlateSide - 3.0), static_cast<float>(kPlateRadius));
        canvas.stroke();
    }

    if (tile.disabled) {
        setFill(canvas, kDisabledFill, kDisabledAlpha);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(-kPlateSide * 0.5),
                         static_cast<float>(-kPlateSide * 0.5), static_cast<float>(kPlateSide),
                         static_cast<float>(kPlateSide), static_cast<float>(kPlateRadius));
        canvas.fill();
    }

    canvas.restore();
}

} // namespace flix::ui
