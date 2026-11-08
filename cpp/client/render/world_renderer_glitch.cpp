// The glitch post-process: a body drawn into a buffer and laid back down as
// displaced bands. In the web build the buffers are cells of one atlas,
// prepared once a frame for every glitched body on screen.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

#include "shared/game/config.h"

namespace flix {

using namespace world_render;

namespace {

// One glitch bucket: how long a burst, and the pattern of one, holds.
std::uint32_t glitchBucket(double timeSeconds) {
    return static_cast<std::uint32_t>(std::max(0.0, std::floor(timeSeconds * 1000.0 / 70.0)));
}
bool glitchBursts(std::uint32_t seed, std::uint32_t bucket) { return hash01(seed, bucket) < 0.45; }
// The square a glitched body is torn within, in canvas units, around its
// centre. The body is nominally `radius`, but equipment (antennae, third eye)
// and skins overshoot it, hence the generous margin.
int glitchSide(double radius) {
    return 2 * std::max(16, static_cast<int>(std::ceil(radius * 2.0 + 24.0)));
}

} // namespace

#ifdef __EMSCRIPTEN__

bool WorldRenderer::placeGlitchBody(std::uint32_t seed, int side,
                                    const std::function<void(Canvas&)>& body) const {
    const double scale = std::min(1.0, static_cast<double>(kGlitchMaxCell) / side);
    const int cell = std::max(1, static_cast<int>(std::ceil(side * scale)));

    GlitchAtlas& atlas = glitchAtlas_;
    if (atlas.size == 0) {
        const int size = glitchAtlasSize(cell);
        atlas.bodies = std::make_unique<Canvas>(Canvas::createVirtual(size, size));
        atlas.tints = std::make_unique<Canvas>(Canvas::createVirtual(size * 2, size));
        atlas.size = size;
    }
    // Shelf-packed, left to right and then down.
    if (glitchShelfX_ + cell > atlas.size) {
        glitchShelfX_ = 0;
        glitchShelfY_ += glitchShelfRow_;
        glitchShelfRow_ = 0;
    }
    if (glitchShelfY_ + cell > atlas.size) {
        atlas.overflowed = true;
        return false;
    }

    GlitchCell placed;
    placed.x = glitchShelfX_;
    placed.y = glitchShelfY_;
    placed.side = side;
    placed.scale = scale;
    glitchShelfX_ += cell;
    glitchShelfRow_ = std::max(glitchShelfRow_, cell);
    glitchShelfWidth_ = std::max(glitchShelfWidth_, glitchShelfX_);
    atlas.usedFrame = frame_;

    // Clipped to its own cell: a body that overshoots the square it was given
    // must not paint into the one beside it in the atlas.
    Canvas& bodies = *atlas.bodies;
    const float x = static_cast<float>(placed.x);
    const float y = static_cast<float>(placed.y);
    const float extent = static_cast<float>(cell);
    bodies.clearRect(x, y, extent, extent);
    bodies.save();
    bodies.beginPath();
    bodies.rect(x, y, extent, extent);
    bodies.clip();
    bodies.translate(static_cast<float>(placed.x + side * 0.5 * scale),
                     static_cast<float>(placed.y + side * 0.5 * scale));
    if (scale < 1.0) bodies.scale(static_cast<float>(scale), static_cast<float>(scale));
    {
        // Under the body's hit flash -- the seed is its net id -- since the
        // blits that recompose it out of the atlas carry no tint of their own.
        const ScopedColorTint flash(bodies, hitTint(seed));
        body(bodies);
    }
    bodies.restore();
    glitchCells_[seed] = placed;
    return true;
}

void WorldRenderer::prepareGlitchAtlas(const EntityMap& entities, const Camera& camera,
                                       Vec2 selfDrawn, double timeSeconds,
                                       const std::function<bool(Vec2, double)>& onScreen) const {
    // Exactly the bodies the entity pass will glitch this frame, painted the
    // way it will paint them: drawFlower's and drawMobBody's own sizing, and
    // the same painters. Gathered first and laid down after, so the ones that
    // need a fringe can go first: the tint pass then covers only their rows.
    struct Burst {
        std::uint32_t seed = 0;
        int side = 0;
        bool fringe = false;
        std::function<void(Canvas&)> paint;
    };
    std::vector<Burst> bursts;
    const auto fringes = [](std::uint32_t seed, std::uint32_t bucket) {
        return hash01(seed ^ 0x27D4EB2Fu, bucket) < 0.65;
    };
    const double zoom = camera.zoom();
    const auto prepareMob = [&](const MobDraw& mob) {
        if (!content_) return;
        const MobConfig& config = content_->mob(mob.typeIndex);
        if (config.id != "glitch_flower" || !config.petalRing.present) return;
        MobPose pose;
        if (!poseMob(mob, &config, zoom, timeSeconds, pose)) return;
        const std::uint32_t bucket = glitchBucket(pose.timeSeconds);
        if (!glitchBursts(mob.netId, bucket)) return;
        const double radius = pose.diameter * 0.5;
        const MobConfig* type = &config;
        bursts.push_back({mob.netId, glitchSide(glitchFlowerReach(config, pose)),
                          fringes(mob.netId, bucket),
                          [this, type, mob, radius, pose](Canvas& target) {
                              drawPetalRingMob(target, *type, mob, radius, pose.rotation,
                                               pose.mirrored, pose.bodyShift, pose.timeSeconds);
                          }});
    };
    for (const auto& entry : entities) {
        const RemoteEntity& entity = entry.second;
        const Vec2 at = entity.isSelf() ? selfDrawn : entity.position;
        if (entity.kind == net::EntityKind::Player) {
            if (entity.dead() || !(entity.renderFlags & PlayerRenderGlitch)) continue;
            if (!onScreen(at, entity.radius)) continue;
            const std::uint32_t bucket = glitchBucket(timeSeconds);
            if (!glitchBursts(entity.netId, bucket)) continue;
            const double radius = kFlowerArtRadius * playerSizeMultiplier(entity) * zoom;
            if (radius <= 0.5) continue;
            const double scale = radius / kFlowerArtRadius;
            const RemoteEntity* flower = &entity;
            bursts.push_back({entity.netId, glitchSide(radius), fringes(entity.netId, bucket),
                              [this, flower, scale, timeSeconds](Canvas& target) {
                                  // Turned on a pad, as drawFlower's own
                                  // paintBody turns it.
                                  if (flower->padSpin != 0.0) {
                                      target.rotate(static_cast<float>(flower->padSpin));
                                  }
                                  target.scale(static_cast<float>(scale),
                                               static_cast<float>(scale));
                                  drawFlowerBody(target, *flower, timeSeconds);
                              }});
        } else if (entity.kind == net::EntityKind::Mob || entity.kind == net::EntityKind::Npc) {
            if (hiddenByOptions(entity) || !onScreen(at, entity.radius)) continue;
            // The fields drawEntity fills that the pose and painter read.
            MobDraw mob;
            mob.netId = entity.netId;
            mob.position = at;
            mob.angle = entity.angle;
            mob.radius = entity.radius;
            mob.typeIndex = entity.typeIndex;
            mob.rarity = entity.rarity;
            mob.npc = entity.kind == net::EntityKind::Npc;
            mob.chasing = !mob.npc && (entity.state & net::StateChasing) != 0;
            mob.pet = !mob.npc && (entity.spawnFlags & net::SpawnIsPet) != 0;
            prepareMob(mob);
        }
    }
    for (const DyingMob& dying : dying_) {
        if (!onScreen(dying.position, dying.radius)) continue;
        MobDraw mob;
        mob.netId = dying.netId;
        mob.position = dying.position;
        mob.angle = dying.angle;
        mob.radius = dying.radius;
        mob.typeIndex = dying.typeIndex;
        mob.rarity = dying.rarity;
        mob.pet = dying.pet;
        mob.deathProgress = clamp(dying.ageSeconds / kDeathAnimationSeconds, 0.0, 1.0);
        prepareMob(mob);
    }
    if (bursts.empty()) return;

    // Fringed first, then biggest first within each: shelves pack tighter
    // tallest-first, and the fringed ones end up in a block at the top.
    std::sort(bursts.begin(), bursts.end(), [](const Burst& a, const Burst& b) {
        if (a.fringe != b.fringe) return a.fringe;
        return a.side > b.side;
    });
    int tintWide = 0;
    int tintUsed = 0;
    for (const Burst& burst : bursts) {
        if (!placeGlitchBody(burst.seed, burst.side, burst.paint)) continue;
        if (!burst.fringe) continue;
        tintWide = glitchShelfWidth_;
        tintUsed = glitchShelfY_ + glitchShelfRow_;
    }
    if (tintUsed == 0) return;

    // The reference's tint, for every fringed body at once: multiply by a
    // pure primary, then re-mask to the bodies' own alpha. Red copies on the
    // left of the tint surface, cyan on the right, and each half clipped for
    // its re-mask -- destination-in clears whatever it does not cover, which
    // unclipped would be the other half. Only the block the fringed bodies
    // were packed into.
    GlitchAtlas& atlas = glitchAtlas_;
    const float size = static_cast<float>(atlas.size);
    const float wide = static_cast<float>(std::min(atlas.size, tintWide));
    const float used = static_cast<float>(std::min(atlas.size, tintUsed));
    Canvas& tints = *atlas.tints;
    const Canvas& bodies = *atlas.bodies;
    tints.clearRect(0, 0, wide, used);
    tints.clearRect(size, 0, wide, used);
    tints.drawCanvas(bodies, 0, 0, wide, used, 0, 0, wide, used);
    tints.drawCanvas(bodies, 0, 0, wide, used, size, 0, wide, used);
    tints.save();
    tints.setGlobalCompositeOperation("multiply");
    tints.setFillStyle(Color{255, 0, 0});
    tints.fillRect(0, 0, wide, used);
    tints.setFillStyle(Color{0, 255, 255});
    tints.fillRect(size, 0, wide, used);
    tints.setGlobalCompositeOperation("destination-in");
    for (const float at : {0.0f, size}) {
        tints.save();
        tints.beginPath();
        tints.rect(at, 0, wide, used);
        tints.clip();
        tints.drawCanvas(bodies, 0, 0, wide, used, at, 0, wide, used);
        tints.restore();
    }
    tints.restore();
}

#endif

void WorldRenderer::drawGlitched(Canvas& canvas, Vec2 screen, double radius, std::uint32_t seed,
                                 double timeSeconds,
                                 const std::function<void(Canvas&)>& body) const {
    // Glitch is a post-process, not a replacement skin: the SAME body is drawn
    // into a transparent buffer and recomposed as horizontally displaced
    // bands, each one blitted straight out of the buffer. That is what keeps
    // it composable with custom skins, and what lets the glitch flower tear
    // its petal ring along with its face.
    const std::uint32_t bucket = glitchBucket(timeSeconds);
    const auto drawPlain = [&] {
        canvas.save();
        canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
        body(canvas);
        canvas.restore();
    };
    if (!glitchBursts(seed, bucket)) {
        drawPlain();
        return;
    }

    const int side = glitchSide(radius);
    const int half = side / 2;
#ifdef __EMSCRIPTEN__
    // The body is already in the atlas, laid down before the entity pass by
    // prepareGlitchAtlas. A burst it has no cell for -- the atlas was full --
    // draws without the effect for the frame.
    const auto cell = glitchCells_.find(seed);
    if (cell == glitchCells_.end() || cell->second.side != side) {
        drawPlain();
        return;
    }
    const Canvas& buffer = *glitchAtlas_.bodies;
    const double sourceX = cell->second.x;
    const double sourceY = cell->second.y;
    const double sourceScale = cell->second.scale;
#else
    // The buffer only ever GROWS, but the work is confined to the top-left
    // `side` square of it: everything below reads `side`, never `glitchSide_`.
    // Sizing the passes off the buffer instead meant one oversized glitched
    // body -- a size-6 flower, a boss-sized mob -- permanently taxed every
    // other glitched entity on screen with its dimensions, and eight glitch
    // flowers beside one of those cost five times what eight alone do.
    if (!glitchBody_ || glitchSide_ < side) {
        // Rounded up to a multiple of 64, the way the reference grows its own
        // buffers: a scene of flowers at a dozen slightly different radii
        // otherwise reallocates the surface for each of them.
        const int target = ((side + 63) / 64) * 64;
        glitchBody_ = std::make_unique<Canvas>(Canvas::createVirtual(target, target));
        glitchSide_ = target;
    }

    Canvas& buffer = *glitchBody_;
    buffer.clearRect(0, 0, static_cast<float>(side), static_cast<float>(side));
    buffer.save();
    buffer.translate(static_cast<float>(half), static_cast<float>(half));
    {
        // The body's hit flash, which a blit out of the buffer cannot carry:
        // it is painted in here, under the tint the caller put on `canvas`.
        const ScopedColorTint flash(buffer, canvas.colorTint());
        body(buffer);
    }
    buffer.restore();
    constexpr double sourceX = 0;
    constexpr double sourceY = 0;
    constexpr double sourceScale = 1.0;
#endif
    const int bufferHalf = half;

    constexpr int kBandCount = 9;
    for (int i = 0; i < kBandCount; ++i) {
        const double roll = hash01(seed ^ 0x5F3759DFu, bucket * 31u + static_cast<std::uint32_t>(i));
        if (roll < 0.06) continue;  // the occasional missing scanline band
        double dx = 0;
        if (roll < 0.36) {
            dx = (hash01(seed, bucket * 17u + static_cast<std::uint32_t>(i)) - 0.5) * radius * 0.9;
        }
        // The band is taken out of the buffer rather than clipped out of a
        // full-surface copy of it: nine clipped blits of the whole buffer is
        // nine times the pixels this needs, and nine coverage masks built to
        // throw eight ninths of each away.
        const int top = side * i / kBandCount;
        const int bottom = side * (i + 1) / kBandCount;
        if (bottom <= top) continue;
        canvas.drawCanvas(buffer, static_cast<float>(sourceX),
                          static_cast<float>(sourceY + top * sourceScale),
                          static_cast<float>(side * sourceScale),
                          static_cast<float>((bottom - top) * sourceScale),
                          static_cast<float>(screen.x - bufferHalf + dx),
                          static_cast<float>(screen.y - bufferHalf + top),
                          static_cast<float>(side), static_cast<float>(bottom - top));
    }

    // The chromatic fringe: the same silhouette flattened to red and to cyan
    // and pulled apart. Only on the stronger bursts, so the effect breathes
    // instead of sitting at a constant intensity.
    const double fringe = hash01(seed ^ 0x27D4EB2Fu, bucket);
    if (fringe >= 0.65) return;
    // Capped in absolute pixels: scaled purely off the radius, a size-6 flower
    // pulls the copies a body-width apart and reads as three flowers.
    const double shift = std::min(6.0, (0.04 + fringe * 0.12) * radius);

    // The reference builds each copy by multiplying the body with a pure
    // primary and re-masking it to the body's own alpha. In a browser those
    // are native Canvas2D composite operations, done for the whole atlas at
    // once by prepareGlitchAtlas: the copies are already waiting in the tint
    // surface, red on its left and cyan on its right. The native client has
    // no compositing backend, so it folds the tint into the blit.
#ifdef __EMSCRIPTEN__
    const auto drawTint = [&](Color colour, double offset) {
        const double tintX = sourceX + (colour.r != 0 ? 0.0 : glitchAtlas_.size);
        canvas.drawCanvas(*glitchAtlas_.tints, static_cast<float>(tintX),
                          static_cast<float>(sourceY), static_cast<float>(side * sourceScale),
                          static_cast<float>(side * sourceScale),
                          static_cast<float>(screen.x - bufferHalf + offset),
                          static_cast<float>(screen.y - bufferHalf), static_cast<float>(side),
                          static_cast<float>(side));
    };
#else
    // One tinted blit per copy. The equivalent with no tint in the blit was to
    // read the buffer back, mask a channel out of a copy of it, push that into
    // a second canvas and blit THAT -- six passes over the surface for each of
    // the two copies, which cost more than every other part of the effect put
    // together.
    const auto drawTint = [&](Color colour, double offset) {
        canvas.drawCanvasTinted(buffer, 0, 0, static_cast<float>(side), static_cast<float>(side),
                                static_cast<float>(screen.x - bufferHalf + offset),
                                static_cast<float>(screen.y - bufferHalf), colour);
    };
#endif
    canvas.save();
#ifdef __EMSCRIPTEN__
    canvas.setGlobalCompositeOperation("lighter");
#endif
    canvas.setGlobalAlpha(0.36f);
    drawTint(Color{255, 0, 0}, -shift);
    drawTint(Color{0, 255, 255}, shift);
    canvas.restore();
}

} // namespace flix
