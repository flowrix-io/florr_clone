// WorldRenderer's frame: the layer order draw() paints in, the per-entity
// dispatch, the shaken camera and the drawing-call accounting.
//
// The class is split across these files by what each part draws:
//   world_renderer.cpp               this file
//   world_renderer_events.cpp        server events into the effect pools;
//                                    update() ages them, hit flashes, shake
//   world_renderer_terrain.cpp       tiles, the chunk cache, maze, arena, waves
//   world_renderer_map_elements.cpp  portals, teleporters, the waves rift
//   world_renderer_flowers.cpp       flower bodies, faces, worn gear, corpses
//   world_renderer_petals.cpp        petals, the ALT glow, drops
//   world_renderer_mobs.cpp          mob gaze, motion, pose and bodies
//   world_renderer_glitch.cpp        the glitch post-process and its atlas
//   world_renderer_overlays.cpp      plates, bars, mob labels, chat bubbles,
//                                    hitboxes
//   world_renderer_effects.cpp       damage numbers, explosions, lightning,
//                                    sacrifice rituals
// and world_renderer_internal.h holds what more than one of them uses.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "client/ui/draw.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/map_elements.h"
#include "shared/game/terrain.h"

namespace flix {

using namespace world_render;

namespace {

constexpr double kPetalDeathGrowth = 0.5;

/// A projectile is drawn from the same petal artwork, filling its own body:
/// diameter is twice the radius the server replicated for it.
///
/// It has to come off the wire rather than out of the petal config, because a
/// shot's size is NOT its petal's. It is scaled by whatever fired it -- a
/// mob's shot by the shooter's body over kProjectileSizeDivisor, a flower's by
/// how much the flower has grown -- and the browser build draws mob shots from
/// exactly that scaled number (`projectile.size * 20`, game-objects.ts). Using
/// the config's unscaled `size` here drew every mob's ammunition at a stock
/// flower's calibre, three times the body it actually hits with.
constexpr double kProjectileArtSize = 20.0;
constexpr double kProjectileArtPerRadius = 2.0;

/// Loot never settles perfectly square: each drop rests tilted by up to this
/// many degrees either way. Seeded on the net id rather than rolled, so the
/// tilt is the same every frame, survives the drop leaving and re-entering
/// view, and is shared by the spawn, pickup and despawn animations.
constexpr double kDropRestTiltDegrees = 10.0;

double dropRestRotation(std::uint32_t netId) {
    // A cheap integer hash: consecutive net ids must not land on neighbouring
    // angles, or a burst of loot from one mob settles in a visible fan.
    std::uint32_t h = netId * 2654435761u;
    h ^= h >> 15;
    h *= 2246822519u;
    h ^= h >> 13;
    const double unit = static_cast<double>(h % 2001u) / 2000.0;  // 0..1
    return (unit - 0.5) * 2.0 * kDropRestTiltDegrees * kPi / 180.0;
}

/// One grain, wherever it is pooled: florr scales a unit square to the
/// grain's side, turns it to the grain's facing and multiplies only the alpha
/// down, so it never shrinks. Walked as a four-point path rather than pushed
/// through the transform stack -- at this size a grain is four lineTo calls,
/// and a save/rotate/restore per grain costs the rasterizer more than the
/// square itself does.
void drawSparkleGrain(Canvas& canvas, const Camera& camera, const EffectParticle& p) {
    const double left = p.lifeSeconds / p.maxLifeSeconds;
    if (left <= 0) return;
    const Vec2 at = camera.worldToScreen(p.position);
    const double r = p.size * 0.5 * camera.zoom();
    // Grains are spawned off every high-rarity petal and drop the server
    // replicates, and replication reaches a good deal further than the camera
    // does -- so most of them, in a busy world, are behind the edge of the
    // screen. Each one was four browser calls painting nothing: 782 circles a
    // frame measured, against the ~50 that are actually in shot.
    //
    // `r` is half the side, so a corner reaches r * sqrt(2) once the square
    // turns. The bound covers the corner, because the sliver of a grain just
    // past the edge is still a sliver that shows.
    const double reach = r * 1.4143;
    if (at.x + reach < 0 || at.y + reach < 0 || at.x - reach > camera.viewportWidth() ||
        at.y - reach > camera.viewportHeight()) {
        return;
    }
    // The fade rides on globalAlpha rather than on the colour's own alpha
    // channel. Both composite to the same pixels -- source-over multiplies the
    // two, the grain is one convex path so it cannot overlap itself, and the
    // ambient alpha is 1 here -- but a colour carries its fade in the STRING,
    // so every grain assigned a new `#rrggbbaa` for the browser to parse. This
    // way the colour is one interned string per rarity and only a float moves.
    // Measured at 0.41 -> 0.29 ms for 850 grains. Whoever calls this puts
    // globalAlpha back; see the loops that do.
    ui::setFill(canvas, p.color);
    canvas.setGlobalAlpha(static_cast<float>(left));
    const double c = std::cos(p.rotation) * r;
    const double s = std::sin(p.rotation) * r;
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(at.x - c + s), static_cast<float>(at.y - s - c));
    canvas.lineTo(static_cast<float>(at.x + c + s), static_cast<float>(at.y + s - c));
    canvas.lineTo(static_cast<float>(at.x + c - s), static_cast<float>(at.y + s + c));
    canvas.lineTo(static_cast<float>(at.x - c - s), static_cast<float>(at.y - s + c));
    canvas.closePath();
    canvas.fill();
}

} // namespace

bool WorldRenderer::hiddenByOptions(const RemoteEntity& entity) const {
    if ((entity.spawnFlags & net::SpawnForeign) == 0) return false;
    // A pet, or a shot one fired: the pet switch answers for both, so hiding
    // the pets does not leave their volleys flying out of nothing.
    if ((entity.spawnFlags & net::SpawnIsPet) != 0) return options.hideOtherPets;
    return options.hideOtherPetals;
}

const MapData* WorldRenderer::mapFor(Realm realm) const {
    return worldMaps_ != nullptr ? worldMaps_->forRealm(realm) : nullptr;
}

const std::vector<const SvgDocument*>& WorldRenderer::artFor(const MapData& map) const {
    if (artMap_ == &map) return art_;
    // Every file the map names, resolved in one go the first time the realm is
    // drawn. Doing it per cell would hash a file name per tile per layer per
    // frame; doing it lazily per file would put a disk read inside whichever
    // frame first walked far enough east. A map's palette is tens of files, so
    // the whole of it is cheaper than either.
    art_.clear();
    art_.reserve(map.artFiles().size());
    for (const std::string& file : map.artFiles()) {
        art_.push_back(sprites_ ? sprites_->tileArt(file) : nullptr);
    }
    artMap_ = &map;
    return art_;
}

void WorldRenderer::drawEntity(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    const double radius = entity.radius * zoom;

    switch (entity.kind) {
        case net::EntityKind::Player:
            if (entity.dead()) {
                // In the waves a dead flower is a camera: the server walks its
                // body after whatever it is watching (GameServer::spectateWaves),
                // so there is no corpse to show.
                if (realm_ == kWavesRealm) break;
                // A corpse carries none of the living furniture: no plate, no
                // bar, no level, no petals.
                drawCorpse(canvas, entity, camera, at, timeSeconds);
                break;
            }
            // The viewer's own flower wears no plate: its name, bar and level
            // are all already on the HUD, so a second copy of them under the
            // body is clutter sitting exactly where the player is looking.
            // Other flowers keep theirs -- that plate is how you read a
            // stranger. The chat bubble is the one piece of furniture the
            // local flower does keep, and drawChatBubbles draws it.
            //
            // The plate goes down first so a grown flower paints over the top
            // of its own name rather than the other way round.
            if (entity.isSelf()) drawSelfManaBar(canvas, entity, camera, at);
            else drawPlayerPlate(canvas, entity, camera, at, timeSeconds);
            drawFlower(canvas, entity, camera, at, timeSeconds);
            break;

        case net::EntityKind::Mob: {
            MobDraw mob;
            mob.netId = entity.netId;
            mob.position = at;
            mob.angle = entity.angle;
            mob.radius = entity.radius;
            mob.typeIndex = entity.typeIndex;
            mob.rarity = entity.rarity;
            mob.healthFraction = entity.healthFraction;
            mob.barHealth = entity.plate.health;
            mob.barLag = entity.plate.lag;
            mob.barShield = entity.plate.shield;
            mob.plateOpacity = entity.plate.opacity;
            mob.chasing = (entity.state & net::StateChasing) != 0;
            mob.pet = (entity.spawnFlags & net::SpawnIsPet) != 0;
            mob.unloaded = (entity.state & net::StateUnloaded) != 0;
            drawMobBody(canvas, camera, mob, timeSeconds);

            // A Killed event arrives after the snapshot has already erased the
            // entity, so remember what the mob looked like while it is here.
            mobShadows_[entity.netId] = mob;
            // Bars, names and tiers all go down after every body, so a mob
            // drawn later cannot cover an earlier one's label.
            //
            // A leech's trailing bodies wear no plate at all. The chain is one
            // animal on one health pool, so the head's bar is the whole truth
            // about it and nine more copies of it would be nine bars saying
            // the same thing -- stacked less than a diameter apart, over a
            // name and a tier that are equally redundant. The plate is one
            // block (see drawMobLabel), so it goes or stays whole.
            const MobConfig* type = content_ ? &content_->mob(mob.typeIndex) : nullptr;
            if (type == nullptr || !type->sharedChainBody()) mobLabels_.push_back(mob);
            break;
        }

        case net::EntityKind::Npc: {
            // A mob's body under an NPC's plate. No shadow is kept for it:
            // nothing kills an NPC, so there is no death animation to replay.
            MobDraw npc;
            npc.netId = entity.netId;
            npc.position = at;
            npc.angle = entity.angle;
            npc.radius = entity.radius;
            npc.typeIndex = entity.typeIndex;
            npc.rarity = entity.rarity;
            npc.plateOpacity = entity.plate.opacity;
            npc.npc = true;
            drawMobBody(canvas, camera, npc, timeSeconds);
            mobLabels_.push_back(npc);
            break;
        }

        case net::EntityKind::Petal:
            drawPetalSprite(canvas, entity, camera, at, timeSeconds);
            break;

        case net::EntityKind::Projectile: {
            // A projectile IS its petal: the same artwork, filling the body
            // the server gave it, turned to its heading.
            const PetalConfig* config = content_ ? &content_->petal(entity.typeIndex) : nullptr;
            // The config size is the fallback only: a spawn record always
            // carries a radius, so this is reached for a projectile whose body
            // the server declined to state at all.
            const double artUnits = entity.radius > 0.0
                                        ? entity.radius * kProjectileArtPerRadius
                                        : (config ? config->size : 1.0) * kProjectileArtSize;
            // The shot is the petal's artwork, so it grows with the petal's
            // visual_scale. entity.radius above is the body the server damages
            // from and stays where it is.
            const double diameter = artUnits * petalArtScale(config) * zoom;
            const ScopedColorTint flash(canvas, hitTint(entity.netId));
            if (config && config->id == "gas" && entity.rarity == Rarity::Common) {
                // Gas is a cloud rather than a petal, and there can be hundreds
                // of it at once.
                ui::setFill(canvas, 0x00FF00u, 0.5);
                canvas.fillCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                  static_cast<float>(diameter * 0.5));
                break;
            }
            if (sprites_ && sprites_->petalDrawable(entity.typeIndex)) {
                sprites_->drawPetal(canvas, entity.typeIndex, entity.rarity, screen.x, screen.y,
                                    diameter, entity.angle, timeSeconds);
            } else {
                ui::disc(canvas, screen, std::max(2.0, diameter * 0.5),
                         config ? static_cast<std::uint32_t>(config->colorRgba >> 8)
                                : rarityColor(entity.rarity),
                         ui::kPaper, 2.0 * zoom);
            }
            break;
        }

        case net::EntityKind::Drop: {
            // A drop lands with a flourish: it slides in from a random offset
            // and unwinds a random spin over 400 ms, easing out, settling on
            // its own slight tilt rather than perfectly square.
            Vec2 where = at;
            double rotation = dropRestRotation(entity.netId);
            const auto spawn = dropSpawns_.find(entity.netId);
            if (spawn != dropSpawns_.end()) {
                const double t = clamp(spawn->second.ageSeconds / kDropSpawnSeconds, 0.0, 1.0);
                const double eased = 1.0 - (1.0 - t) * (1.0 - t);
                const double offset = spawn->second.distance * (1.0 - eased);
                where += Vec2::fromAngle(spawn->second.angle, offset);
                rotation += spawn->second.rotation * (1.0 - eased);
            }
            drawDrop(canvas, camera, where, entity.typeIndex, entity.rarity, rotation, 1.0, 1.0,
                     timeSeconds);
            break;
        }

        case net::EntityKind::Effect: {
            // Replicated::typeIndex carries the field kind: pollen, web, or
            // radiation. The effect's rarity supplies its tier treatment.
            switch (static_cast<GroundEffectKind>(entity.typeIndex)) {
                // Drawn in a pass of its own, over the mobs: see
                // drawSacrificeRituals.
                case GroundEffectKind::Sacrifice:
                    break;
                case GroundEffectKind::Web: {
                    // Ten spokes out to the rim, then five concentric rings of
                    // quadratic segments sagging between them.
                    constexpr int kSpokes = 10;
                    constexpr int kLevels = 5;
                    canvas.save();
                    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
                    canvas.rotate(static_cast<float>(entity.angle));
                    canvas.setGlobalAlpha(static_cast<float>(0x60 / 255.0));
                    ui::setStroke(canvas, 0xFFFFFFu);
                    canvas.setLineCap("round");
                    canvas.setLineWidth(static_cast<float>(std::max(1.0, radius * 0.075)));
                    canvas.beginPath();
                    for (int i = 0; i < kSpokes; ++i) {
                        const double angle = kTau * i / kSpokes;
                        canvas.moveTo(0, 0);
                        canvas.lineTo(static_cast<float>(std::cos(angle) * radius),
                                      static_cast<float>(std::sin(angle) * radius));
                    }
                    for (int j = 0; j < kLevels; ++j) {
                        const double ring = j * radius / kLevels;
                        const double sag = ring - radius / (2 * kLevels);
                        canvas.moveTo(static_cast<float>(ring), 0);
                        for (int i = 0; i < kSpokes; ++i) {
                            const double to = kTau * (i + 1) / kSpokes;
                            const double between = kPi * (2 * i + 1) / kSpokes;
                            canvas.quadraticCurveTo(static_cast<float>(std::cos(between) * sag),
                                                    static_cast<float>(std::sin(between) * sag),
                                                    static_cast<float>(std::cos(to) * ring),
                                                    static_cast<float>(std::sin(to) * ring));
                        }
                    }
                    canvas.stroke();
                    canvas.restore();
                    break;
                }
                case GroundEffectKind::Radiation: {
                    // Strongest on the petal and gone at the rim, on the same
                    // curve the pulse's damage falls off by
                    // (radiationStrength), with no edge drawn. The server
                    // sends the cloud at its reach (replicatedRadius).
                    //
                    // The ramp is laid over the inner 80% only: the curve is
                    // under 1% there, and spending the bands where the glow
                    // actually changes keeps the steep middle from banding.
                    constexpr std::uint32_t kTint = 0x9B59B6u;
                    constexpr double kCentreAlpha = 0.3;
                    canvas.save();
                    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
                    fillRadialRamp(canvas, radius * 0.8, kTint, 24, [radius](double r) {
                        return kCentreAlpha * radiationStrength(r, radius);
                    });
                    canvas.restore();
                    break;
                }
                case GroundEffectKind::OpenTomb: {
                    // The tomb's own painter in its broken-open state, at the
                    // size and facing the tomb had when it fell.
                    canvas.save();
                    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
                    canvas.rotate(static_cast<float>(entity.angle));
                    canvas.scale(static_cast<float>(zoom), static_cast<float>(zoom));
                    MobArtAttributes attr;
                    attr.radius = entity.radius;
                    attr.opened = true;
                    paintMobArt(canvas, MobArt::Tomb, attr);
                    canvas.restore();
                    break;
                }
                case GroundEffectKind::Poison:
                default:
                    ui::disc(canvas, screen, radius, 0xFFE763u, 0xCFBB50u, 3.0 * zoom);
                    break;
            }
            break;
        }
    }
}

void WorldRenderer::draw(Canvas& canvas, const WorldView& view, const Camera& camera,
                         Vec2 selfDrawn, double timeSeconds) const {
    realm_ = view.realm();
    if (shakeOffset_.x == 0.0 && shakeOffset_.y == 0.0) {
        draw(canvas, view.entities(), camera, selfDrawn, timeSeconds);
        return;
    }
    // The world, the viewer's flower with it, is drawn through a camera
    // pushed by the shake; the caller's stays where the cursor expects it.
    draw(canvas, view.entities(), shakenCamera(camera), selfDrawn, timeSeconds);
}

Camera WorldRenderer::shakenCamera(const Camera& camera) const {
    // The push is a SCREEN distance, so it is divided back through the zoom:
    // a loadout zoomed out to half shakes as hard as one that is not.
    Camera shaken = camera;
    const double zoom = camera.zoom() > 1e-6 ? camera.zoom() : 1.0;
    shaken.snapTo(camera.centre() + shakeOffset_ / zoom);
    return shaken;
}

int WorldRenderer::canvasOps() {
#ifdef __EMSCRIPTEN__
    return canvasOpsEmitted();
#else
    return 0;
#endif
}

void WorldRenderer::chargeOps(int& bucket) const {
    const int now = canvasOps();
    bucket += now - opMark_;
    opMark_ = now;
}

void WorldRenderer::draw(Canvas& canvas, const EntityMap& entities, const Camera& camera,
                         Vec2 selfDrawn, double timeSeconds) const {
    // What lies under the entities is the realm's business. The arena and
    // the maze are generated and draw themselves; every other realm is an
    // authored map with a tile grid and annotations -- teleporters, spawn-zone
    // tints -- of its own.
    ops_ = SectionOps{};
    opMark_ = canvasOps();
    ++frame_;
#ifdef __EMSCRIPTEN__
    // A new frame empties the glitch atlas. One that ran out of room last
    // frame is made bigger now, between frames, and one nothing has wanted
    // for two seconds is given back.
    glitchCells_.clear();
    glitchShelfX_ = glitchShelfY_ = glitchShelfRow_ = glitchShelfWidth_ = 0;
    if (glitchAtlas_.size > 0) {
        if (glitchAtlas_.usedFrame + kGlitchAtlasIdleFrames < frame_) {
            glitchAtlas_ = GlitchAtlas{};
        } else if (glitchAtlas_.overflowed && glitchAtlas_.size < kGlitchMaxAtlas) {
            const int size = glitchAtlasSize(glitchAtlas_.size * 2);
            glitchAtlas_.bodies = std::make_unique<Canvas>(Canvas::createVirtual(size, size));
            glitchAtlas_.tints = std::make_unique<Canvas>(Canvas::createVirtual(size * 2, size));
            glitchAtlas_.size = size;
        }
        glitchAtlas_.overflowed = false;
    }
#endif

    if (realm_ == Realm::Maze || realm_ == Realm::Arena || realm_ == kAdminArenaRealm ||
        realm_ == kWavesRealm) {
        // Neither has a map for the chunk cache to hold, and the one it holds
        // is a realm the player has left: tens of megabytes of bitmaps.
        if (!terrainChunks_.chunks.empty()) terrainChunks_ = TerrainChunks{};
    }
    if (realm_ == Realm::Maze) {
        drawMaze(canvas, camera);
    } else if (realm_ == Realm::Arena) {
        drawArena(canvas, camera);
    } else if (realm_ == kWavesRealm) {
        drawWaves(canvas, camera, timeSeconds);
    } else {
        drawTerrain(canvas, camera, realm_);
        drawMapElements(canvas, camera, realm_, timeSeconds);
    }
    drawRift(canvas, camera, timeSeconds);
    chargeOps(ops_.terrain);

    // A dark map: florr draws every entity into a layer cut down to its
    // lights' outer discs, so out of the light the ground shows and nothing on
    // it does. A clip to the same discs is the same picture. No light at all
    // clips to a speck off the screen, not to nothing -- an empty path is no
    // clip.
    const bool lightClipped = lightClip_ != nullptr;
    if (lightClipped) {
        canvas.save();
        canvas.beginPath();
        canvas.arc(-1000.0f, -1000.0f, 1.0f, 0.0f, static_cast<float>(kTau));
        for (const LightDisc& disc : *lightClip_) {
            const Vec2 at = camera.worldToScreen(disc.centre);
            const auto r = static_cast<float>(disc.outer * camera.zoom());
            if (r <= 0.0f) continue;
            canvas.moveTo(static_cast<float>(at.x) + r, static_cast<float>(at.y));
            canvas.arc(static_cast<float>(at.x), static_cast<float>(at.y), r, 0.0f,
                       static_cast<float>(kTau));
        }
        canvas.clip();
    }

    const Rect visible = camera.visibleWorld(0);
    // A body is kept until its whole extent is off screen, and the margin grows
    // with the body: a super-tier mob is wider than any fixed margin, and
    // popping one out while half of it is still visible is the failure a fixed
    // margin produces.
    const auto onScreen = [&visible](Vec2 at, double radius) {
        const double margin = radius + std::max(radius * 2.0, 100.0);
        return at.x + margin >= visible.left() && at.x - margin <= visible.right() &&
               at.y + margin >= visible.top() && at.y - margin <= visible.bottom();
    };

#ifdef __EMSCRIPTEN__
    // Before any body is drawn, so the glitched ones find theirs waiting.
    prepareGlitchAtlas(entities, camera, selfDrawn, timeSeconds, onScreen);
    chargeOps(ops_.mobs);
#endif

    // Draw order is by kind, not by position, and follows the browser build's:
    // ground effects, mobs, then every flower with its petals over it, then
    // loot, and projectiles last of all. Petals BELOW players was the visible
    // error -- a petal passing in front of a flower went behind its face.
    // An NPC goes down just before the mobs: it stands still in the world, so
    // anything moving past it passes over it, and its plate joins theirs --
    // the labels are all laid at the end of the mob layer.
    static constexpr net::EntityKind kOrder[] = {
        net::EntityKind::Effect, net::EntityKind::Npc, net::EntityKind::Mob,
        net::EntityKind::Player, net::EntityKind::Petal, net::EntityKind::Drop,
        net::EntityKind::Projectile,
    };


    // Per-layer cost, reported through sectionTiming(). The clock is only read
    // at layer boundaries -- six reads a frame -- so measuring the frame does
    // not measurably change it.
    const auto sectionClock = [] {
        return std::chrono::duration<double, std::milli>(
                   std::chrono::steady_clock::now().time_since_epoch())
            .count();
    };
    timing_ = SectionTiming{};
    double layerStarted = sectionClock();

    // A hole in the ground goes down before every other mob, so the ants it
    // lets out stand on it rather than under it. gardn draws its holes in a
    // pass of their own ahead of the mob pass for exactly this; within each
    // pass the order stays the map's. A nest that sends waves -- a server --
    // goes down with them: its escorts come up out of its centre, and the
    // map's order would otherwise bury about half of them under its body.
    const auto isHole = [this](std::uint16_t typeIndex) {
        if (content_ == nullptr) return false;
        const MobConfig& mob = content_->mob(typeIndex);
        return mob.hole || !mob.spawnWaves.empty();
    };
    // A loose petal lies on the ground like an NPC stands on it, so it goes
    // down in the NPC's layer: under the mobs, the flowers and every ring
    // petal swinging past. In the petal layer an apex wax -- 600 across --
    // would be painted over whichever of its owner's petals the map order
    // happened to put first.
    // A seed on a mob's ammunition ring grows OUT of the mob, so it goes down
    // under it: in the mob layer, after the holes and before every body. In
    // the petal layer a dandelion's seeds were painted over its own head.
    const auto layerOf = [](const RemoteEntity& entity) {
        if (entity.isLoosePetal()) return net::EntityKind::Npc;
        if (entity.isRingPetal()) return net::EntityKind::Mob;
        return entity.kind;
    };
    const auto drawLive = [&](const RemoteEntity& entity) {
        // Every entity draws at its own interpolated position, petals
        // included: WorldView has already anchored each ring to the
        // flower its owner is DRAWN at (see RemoteEntity::ownerOffset), so
        // there is no correction to apply here. Applying one was the petal
        // shake -- the obvious `owner.position - owner.targetPosition`
        // fixup subtracts a value that stair-steps at the snapshot rate.
        Vec2 at = entity.isSelf() ? selfDrawn : entity.position;
        if (hiddenByOptions(entity)) {
            // A pet drawn before the switch went on keeps the shadow it was
            // last drawn in; dropping it stops that pet's death animation
            // playing where nothing had been drawn for a while.
            if (entity.kind == net::EntityKind::Mob) mobShadows_.erase(entity.netId);
            return;
        }
        if (!onScreen(at, entity.radius)) return;

        if (entity.kind == net::EntityKind::Drop) ++timing_.itemCount;
        drawEntity(canvas, entity, camera, at, timeSeconds);
        if (options.hitboxes) drawHitbox(canvas, entity, camera, at);
    };
    // The mobs the server has already destroyed finish their animation in
    // the same layer the live ones were drawn in, and take no label: a bar
    // over a corpse is the browser build's one suppression here.
    const auto drawDying = [&](const DyingMob& dying) {
        if (!onScreen(dying.position, dying.radius)) return;
        MobDraw mob;
        mob.netId = dying.netId;
        mob.position = dying.position;
        mob.angle = dying.angle;
        mob.radius = dying.radius;
        mob.typeIndex = dying.typeIndex;
        mob.rarity = dying.rarity;
        mob.pet = dying.pet;
        mob.deathProgress = clamp(dying.ageSeconds / kDeathAnimationSeconds, 0.0, 1.0);
        drawMobBody(canvas, camera, mob, timeSeconds);
    };
    // A destroyed petal or shot fades where it was last drawn while it grows,
    // in the layer its live siblings are drawn in: gardn's filter, an alpha
    // and a scale about its centre over the ordinary drawing.
    const auto drawDyingPetal = [&](const DyingPetal& dying) {
        const RemoteEntity& entity = dying.entity;
        const double t = clamp(dying.ageSeconds / kPetalDeathSeconds, 0.0, 1.0);
        const double scale = 1.0 + kPetalDeathGrowth * t;
        if (!onScreen(entity.position, entity.radius * scale)) return;
        const Vec2 screen = camera.worldToScreen(entity.position);
        canvas.save();
        canvas.setGlobalAlpha(static_cast<float>(canvas.globalAlpha() * (1.0 - t)));
        canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
        canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
        canvas.translate(static_cast<float>(-screen.x), static_cast<float>(-screen.y));
        drawEntity(canvas, entity, camera, entity.position, timeSeconds);
        canvas.restore();
    };

    // Market hosts remain easy to find even in a crowded spawn. Keep their
    // bodies and plates above world combat, with chat and menus still above.
    std::vector<const RemoteEntity*> foregroundNpcs;
    const auto foregroundNpc = [this](const RemoteEntity& entity) {
        return entity.kind==net::EntityKind::Npc && content_ &&
               content_->mob(entity.typeIndex).npc.service==NpcService::Market;
    };
    mobLabels_.clear();
    for (const net::EntityKind kind : kOrder) {
        // A drop's glitter opens the drop layer, so it lies UNDER every drop,
        // live or dying, and over the flowers below. Drawn with the effects it
        // covered the tile it came off, and the burst a landing drop throws hid
        // the icon it was announcing.
        if (kind == net::EntityKind::Drop) {
            for (const EffectParticle& p : dropSparkles_) drawSparkleGrain(canvas, camera, p);
            canvas.setGlobalAlpha(1.0f);
        }

        const bool mobs = kind == net::EntityKind::Mob;
        // A sacrifice's own mob -- its body and its ring with it -- waits until
        // the ritual's star has greyed everything else, and is drawn over it
        // in colour (below).
        const auto sacrificed = [](const RemoteEntity& entity) {
            return (entity.spawnFlags & net::SpawnSacrificed) != 0;
        };
        if (mobs) {
            for (const auto& entry : entities) {
                const RemoteEntity& entity = entry.second;
                if (entity.kind == kind && isHole(entity.typeIndex) && !sacrificed(entity)) {
                    drawLive(entity);
                }
            }
            for (const DyingMob& dying : dying_) {
                if (isHole(dying.typeIndex)) drawDying(dying);
            }
            for (const auto& entry : entities) {
                if (entry.second.isRingPetal() && !sacrificed(entry.second)) drawLive(entry.second);
            }
        }
        for (const auto& entry : entities) {
            const RemoteEntity& entity = entry.second;
            if (layerOf(entity) != kind) continue;
            if (foregroundNpc(entity)) { foregroundNpcs.push_back(&entity); continue; }
            if (mobs && sacrificed(entity)) continue;
            // A ring seed's typeIndex is a PETAL index, so it must be ruled
            // out before isHole reads it as a mob's.
            if (mobs && (entity.isRingPetal() || isHole(entity.typeIndex))) continue;
            drawLive(entity);
        }
        for (const DyingPetal& dying : dyingPetals_) {
            if (layerOf(dying.entity) == kind) drawDyingPetal(dying);
        }
        chargeOps(kind == net::EntityKind::Mob || kind == net::EntityKind::Npc ? ops_.mobs
                  : kind == net::EntityKind::Petal      ? ops_.petals
                  : kind == net::EntityKind::Drop       ? ops_.items
                  : kind == net::EntityKind::Projectile ? ops_.projectiles
                                                        : ops_.flowers);

        // Loot the snapshot has already removed finishes its flight to the
        // player who took it, or spins out where it lay, in the layer its live
        // siblings were drawn in.
        if (kind == net::EntityKind::Drop) {
            for (const DyingDrop& drop : dyingDrops_) {
                const bool taken = drop.takerNetId != 0;
                const double t = clamp(drop.ageSeconds / (taken ? kDropPickupSeconds
                                                                : kDropDespawnSeconds),
                                       0.0, 1.0);
                Vec2 where = drop.position;
                double rotation = dropRestRotation(drop.netId);
                double scale = 1.0;
                double alpha = 1.0;
                if (taken) {
                    // Eased IN, and aimed at where the taker is NOW: a drop
                    // flying at a stale position visibly misses a moving
                    // flower over the 150 ms it is in the air.
                    const double eased = t * t;
                    Vec2 target = drop.position;
                    const auto taker = entities.find(drop.takerNetId);
                    if (taker != entities.end()) {
                        target = taker->second.isSelf() ? selfDrawn : taker->second.position;
                    }
                    where += (target - drop.position) * eased;
                    scale = 1.0 - eased * 0.7;
                    alpha = 1.0 - eased * 0.5;
                } else {
                    rotation += t * kTau;
                    alpha = 1.0 - t;
                    scale = 1.0 - t * 0.3;
                }
                if (!onScreen(where, kDropBackdropSide)) continue;
                ++timing_.itemCount;
                drawDrop(canvas, camera, where, drop.typeIndex, drop.rarity, rotation, scale,
                         alpha, timeSeconds);
            }
        }

        // Layer boundaries, in the draw order kOrder declares. Petals close
        // the mob layer because they are drawn onto the flowers they orbit;
        // splitting them off would report a cost the reference does not.
        if (kind == net::EntityKind::Petal || kind == net::EntityKind::Drop ||
            kind == net::EntityKind::Projectile) {
            const double now = sectionClock();
            const double spent = now - layerStarted;
            layerStarted = now;
            if (kind == net::EntityKind::Petal) timing_.mobsMillis += spent;
            else if (kind == net::EntityKind::Drop) timing_.itemsMillis += spent;
            else timing_.projectilesMillis += spent;
        }

        if (!mobs) continue;
        for (const DyingMob& dying : dying_) {
            if (!isHole(dying.typeIndex)) drawDying(dying);
        }
        // Everything drawn so far -- the ground, NPCs and every mob -- goes
        // grey under a sacrifice's star; the flowers and petals that follow
        // keep their colour, and so does the mob the sacrifice summoned,
        // drawn now in the order the mob layer would have drawn it.
        drawSacrificeRituals(canvas, entities, camera);
        for (const auto& entry : entities) {
            const RemoteEntity& entity = entry.second;
            if (sacrificed(entity) && entity.kind == kind && isHole(entity.typeIndex)) {
                drawLive(entity);
            }
        }
        for (const auto& entry : entities) {
            if (sacrificed(entry.second) && entry.second.isRingPetal()) drawLive(entry.second);
        }
        for (const auto& entry : entities) {
            const RemoteEntity& entity = entry.second;
            if (!sacrificed(entity) || layerOf(entity) != kind) continue;
            if (entity.isRingPetal() || isHole(entity.typeIndex)) continue;
            drawLive(entity);
        }
        chargeOps(ops_.mobs);
        for (const MobDraw& mob : mobLabels_) drawMobLabel(canvas, camera, mob);
        chargeOps(ops_.labels);
    }

    drawEffects(canvas, camera);
    chargeOps(ops_.effects);
    const auto foregroundLabelStart=mobLabels_.size();
    for (const auto* npc:foregroundNpcs) drawLive(*npc);
    chargeOps(ops_.mobs);
    for (std::size_t i=foregroundLabelStart;i<mobLabels_.size();++i)
        drawMobLabel(canvas,camera,mobLabels_[i]);
    chargeOps(ops_.labels);
    if (lightClipped) canvas.restore();
    // Last of all, over every body and every effect: what somebody is saying
    // is the one thing on screen that must never be hidden behind the fight --
    // not by the dark either.
    drawChatBubbles(canvas, entities, camera, selfDrawn);
    chargeOps(ops_.bubbles);
}

} // namespace flix
