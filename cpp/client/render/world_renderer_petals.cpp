// Petals in the world -- a flower's ring, its shots, loose petals -- with the
// ALT rarity glow, and the drops lying on the ground.

#include "client/render/world_renderer_internal.h"

#include <cmath>
#include <cstdint>

#include "client/ui/draw.h"
#include "client/ui/item_tile.h"
#include "shared/game/config.h"

namespace flix {

using namespace world_render;

namespace {

/// Loot breathes where it lies: the reference scales it by 1 +- 3% off a sine
/// on the frame clock in milliseconds, i.e. 10 rad/s, and shares one phase
/// across every drop rather than giving each its own.
constexpr double kDropPulseRate = ui::kDropPulseRate;
constexpr double kDropPulseAmount = ui::kDropPulseAmount;

/// The ALT rarity glow: how far it reaches past the petal's own artwork (the
/// browser build's 16-unit blur pad), and its one alpha. It is florr's way of
/// drawing a glow -- the firefly's is a single flat ellipse in its body colour
/// at 0.298 (76/255) -- rather than a ramp of nested discs, which cost a
/// dozen fills a petal every frame and made holding ALT crawl.
constexpr double kPetalGlowPad = 16.0;
constexpr double kPetalGlowAlpha = 76.0 / 255.0;

} // namespace

void WorldRenderer::drawPetalGlow(Canvas& canvas, double radius, std::uint32_t rgb,
                                  int bands) const {
    if (radius <= 1.0) return;
    // The browser build bakes a three-stop radial gradient: 0.6 at the centre,
    // 0.25 at 40%, 0 at the rim.
    fillRadialRamp(canvas, radius, rgb, bands, [radius](double r) {
        const double knee = radius * 0.4;
        if (r <= knee) return 0.6 + (0.25 - 0.6) * (r / knee);
        return 0.25 * (1.0 - (r - knee) / (radius - knee));
    });
}

void WorldRenderer::drawPetalSprite(Canvas& canvas, const RemoteEntity& entity,
                                    const Camera& camera, Vec2 at, double timeSeconds) const {
    const PetalConfig* config = content_ ? &content_->petal(entity.typeIndex) : nullptr;
    // Three entries in petals.json are pure modifiers with no artwork at all.
    if (config && config->hidden) return;

    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    // The drawn petal is 12 units per size unit, times the petal's own
    // `visual_scale`. entity.radius is the 20-unit gameplay reach, and
    // noPhysics petals carry no body at all, so neither is usable as a drawing
    // size -- and visual_scale must never reach either of them.
    const double artSize = (config ? config->size : 1.0) * petalArtScale(config);
    // A seat on a MOB's ring is sized from the radius the server replicated
    // for it -- a bigger mob carries bigger seeds, and the same number is what
    // the seed collides at. Twice the radius times `visual_scale` is the same
    // formula a projectile of the same petal is drawn by, and for a flower's
    // own petal (whose radius IS the nominal 10 per size unit) it would come
    // out at exactly kPetalArtSize * size * visual_scale -- but it is left
    // keyed on the flag rather than applied to everything, because the three
    // `noPhysics` petals carry no body and would be sized from a default.
    // A loose petal is sized the same way, for the same reason: its body grows
    // with its tier (30 a step, to 300 at apex) and `size` does not.
    const double diameter = entity.isRingPetal() || entity.isLoosePetal()
                                ? 2.0 * entity.radius * petalArtScale(config) * zoom
                                : kPetalArtSize * artSize * zoom;
    if (diameter <= 0.5) return;

    // The sprite's own spin is the ring's shared phase and nothing else, so
    // every instance of one petal type on a flower points the same way rather
    // than fanning outward like spokes. entity.angle is where the INSTANCE
    // faces -- its ring bearing, or a clump grain's bearing out of its clump --
    // and only an inward-facing clump reads it.
    double rotation = 0;
    if (entity.isRingPetal()) {
        // gardn's kFollowRot: turned to its own outward bearing, so whatever
        // the artwork puts at the petal's -X end -- a dandelion's stem --
        // points back into the body it grew on. `ownerOffset` is the smoothed
        // offset from the mob, so this follows the DRAWN body rather than a
        // snapshot-old one, exactly as the anchoring does.
        const Vec2 out = entity.ownerOffset;
        rotation = out.lengthSq() > 0.0 ? out.angle() : entity.angle;
    } else if (entity.isLoosePetal()) {
        // Lying on the ground, not turning with any ring: held at the angle
        // the server put it down at.
        rotation = entity.angle;
    } else if (config && config->hasFixedDirection) {
        rotation = config->fixedDirection;
    } else if (config && config->clumpFacesInward &&
               content_->petalStats(entity.typeIndex, entity.rarity).count > 1) {
        // A grain faces out of its clump's centre, so half a turn on points
        // the artwork's +X tip -- a stinger's point -- back into the middle.
        // Gated on the count: a lone petal's facing is its ring bearing, and
        // turning that round would aim it at the flower.
        rotation = entity.angle + kPi;
    } else if (config && petalIsCompass(*config)) {
        // A compass does not spin with the ring: the server aims it, and its
        // needle -- the artwork's red +X end -- is the whole point of it.
        rotation = entity.angle;
    } else {
        const double speed = (config && config->speed > 0) ? config->speed : 1.0;
        rotation = std::fmod(timeSeconds * kPetalSpinRate * speed, kTau) + kPi * 0.5;
    }

    canvas.save();
    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
    if (config && config->emissive) {
        // Unrotated, exactly as the browser build draws it: the glow is round,
        // and spinning it would only cost time.
        const double lightRadius =
            (config->lightRadius > 0 ? config->lightRadius : kPetalArtSize * artSize * 3.0) * zoom;
        const std::uint32_t glow = !config->lightColor.empty()
                                       ? static_cast<std::uint32_t>(config->lightColorRgba >> 8)
                                       : static_cast<std::uint32_t>(config->colorRgba >> 8);
        drawPetalGlow(canvas, lightRadius, glow);
    }
    if (options.rarityGlow) {
        // ALT held: every petal wears its tier, as one flat disc under it.
        ui::setFill(canvas, rarityColor(entity.rarity), kPetalGlowAlpha);
        canvas.fillCircle(0, 0, static_cast<float>(diameter * 0.5 + kPetalGlowPad * zoom));
    }
    // From here it is the petal itself, which flashes when it is struck; the
    // two glows above are light, not petal.
    const ScopedColorTint flash(canvas, hitTint(entity.netId));
    canvas.rotate(static_cast<float>(rotation));
    // Both axes: a petal that declares an X offset is drawn off it in the
    // browser build too, and dropping one of the two silently moves it.
    if (config && (config->visualOffsetX != 0 || config->visualOffsetY != 0)) {
        canvas.translate(static_cast<float>(config->visualOffsetX * zoom),
                         static_cast<float>(config->visualOffsetY * zoom));
    }
    if (sprites_) {
        // The sprite cache falls back to a disc in the petal's own colour when
        // its artwork failed to compile, which is the useful fallback here.
        sprites_->drawPetal(canvas, entity.typeIndex, entity.rarity, 0, 0, diameter, 0,
                            timeSeconds);
    } else {
        ui::disc(canvas, {0, 0}, diameter * 0.5,
                 config ? static_cast<std::uint32_t>(config->colorRgba >> 8) : 0xFFFFFFu,
                 ui::kInk, zoom);
    }
    canvas.restore();
}

void WorldRenderer::drawDrop(Canvas& canvas, const Camera& camera, Vec2 at,
                             std::uint16_t typeIndex, Rarity rarity, double rotation,
                             double scale, double alpha, double timeSeconds) const {
    // The pulse rides on top of whatever the animations asked for, so a drop
    // flying to its taker or spinning out keeps breathing as it goes.
    scale *= 1.0 + std::sin(timeSeconds * kDropPulseRate) * kDropPulseAmount;
    const double zoom = camera.zoom();
    if (scale <= 0.0 || alpha <= 0.0 || kDropBackdropSide * zoom * scale <= 1.0) return;
    if (!sprites_) return;
    const Vec2 screen = camera.worldToScreen(at);

    // A drop is one item tile, the same object the loadout bar and the
    // inventory draw, laid on the ground with its shadow under it. The camera
    // is folded into the transform rather than multiplied into each number:
    // the tile is written in its own 60-unit cell and only lines up when the
    // whole cell is scaled at once.
    const double cell = kDropBackdropSide * zoom * scale;
    canvas.save();
    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
    if (rotation != 0) canvas.rotate(static_cast<float>(rotation));

    ui::ItemTile tile;
    tile.petalIndex = typeIndex;
    tile.rarity = rarity;
    tile.shadow = true;
    tile.alpha = alpha;
    // Frame zero, not the frame clock: a drop's petal does not animate on the
    // ground, and the name rides with the plate so a spinning despawn spins
    // its label too.
    tile.timeSeconds = 0.0;
    ui::drawItemTile(canvas, *sprites_, {-cell * 0.5, -cell * 0.5, cell, cell}, tile);

    canvas.restore();
}

} // namespace flix
