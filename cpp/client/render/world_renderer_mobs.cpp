// Mobs: where one looks and how it moves, its pose for the frame, and the
// body itself, with the mobs that need more than their art (diggers, garbage
// piles, petal rings, a loaded sting).

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "client/ease.h"
#include "client/ui/draw.h"
#include "shared/game/components.h"
#include "shared/game/config.h"

namespace flix {

using namespace world_render;

namespace {

/// How far an upright mob's body must travel in a frame before its eyes read
/// the step as a heading, squared. A mob walks on the order of a world unit
/// per frame, so a hundredth of one is comfortably below travel and above the
/// wobble a played-back position carries while a mob stands still.
constexpr double kMobEyeStepEpsilonSq = 1e-4;

/// The longest frame a mob's motion is advanced by in one step. A frame that
/// took longer -- the tab was hidden, the window was dragged -- is time the
/// player did not watch, and a quarter second is already a visible stutter.
constexpr double kMaxMotionStepMs = 250.0;

/// How fast an upright mob's heading follows its motion: a fifth of each
/// frame's step per 60 fps frame. Smoothed because a played-back position's
/// single-frame step is as likely to be playback jitter as travel.
const double kMobHeadingEaseSeconds = easeTimeConstant(0.2);

/// Faster than any mob runs, in world units per millisecond: a drawn position
/// that moved further than this in a frame was snapped, not walked -- a
/// correction, a realm hop -- and the legs should not race to cover it.
constexpr double kMaxWalkUnitsPerMs = 3.0;

/// A flower-shaped mob. Not read off mob stats: the loader overwrites every
/// mob's colour with its rarity colour, and the whole point of this one is that
/// it looks like a flower. A ring's face names its own (PetalRingSpec).
constexpr std::uint32_t kDiggerBodyColor = 0x999999u;

} // namespace

Vec2 WorldRenderer::mobEye(const MobDraw& mob) const {
    const MobConfig* config = content_ ? &content_->mob(mob.typeIndex) : nullptr;
    const bool upright = config != nullptr && config->hideRotation;
    const auto entry = mobEyes_.emplace(mob.netId, MobEye{});
    MobEye& state = entry.first->second;
    const bool first = entry.second;
    // Asked twice in one frame -- a glitched ring mob is painted into the web
    // glitch atlas and then again in its place -- the eye answers the same,
    // rather than easing two steps and tracking at double speed.
    if (!first && state.easedFrame == frame_) return state.offset;
    state.easedFrame = frame_;

    double look = mob.angle;
    if (upright) {
        // The body is drawn facing nowhere, so the heading comes out of its
        // motion. Smoothed before it is read as a direction: a mob's drawn
        // position is played back from snapshot samples, so any single frame's
        // step is as likely to be playback jitter as it is to be travel. Below
        // the threshold the last heading is held rather than replaced -- a mob
        // that stops has not turned to face east, and one that walked off
        // screen and back has not either.
        if (!first) {
            easeToward(state.step, mob.position - state.lastPosition, kMobHeadingEaseSeconds);
            if (state.step.lengthSq() > kMobEyeStepEpsilonSq) state.heading = state.step.angle();
        }
        look = state.heading;
    }
    state.lastPosition = mob.position;

    // The flower eye's own time constant: the eye of a flower-shaped mob is
    // the only thing showing where it is headed, and it tracks exactly as a
    // player's pupils do.
    const Vec2 target{std::cos(look) * 2.0, std::sin(look) * 4.4};
    if (first) {
        // First sight starts ON target: a mob popping in should not roll its
        // eyes into place from the origin.
        state.offset = target;
        return target;
    }
    easeToward(state.offset, target, kEyeEaseSeconds);
    return state.offset;
}

Vec2 WorldRenderer::mobGaze(const MobDraw& mob) const {
    MobEye& state = mobEyes_[mob.netId];
    const Vec2 target{std::cos(mob.angle), std::sin(mob.angle)};
    if (!state.gazeLive) {
        // First sight starts on target, as mobEye's does: an oracle walking on
        // screen is already looking where it looks.
        state.gaze = target;
        state.gazeLive = true;
        return target;
    }
    // At the flower eye's own time constant, and straight across rather than
    // round the rim -- which is what a flower's pupils do when it turns, and
    // what makes a turn read as the eye moving rather than the body.
    easeToward(state.gaze, target, kEyeEaseSeconds);
    return state.gaze;
}

MobMotion WorldRenderer::mobMotion(const MobDraw& mob, double clockSeconds) const {
    const auto entry = mobPaces_.emplace(mob.netId, MobPace{});
    MobPace& pace = entry.first->second;
    if (entry.second) {
        // First sight: a clock at zero, standing still, and already as worked
        // up as the mob is -- one that walks on screen mid-chase is not
        // calming down from nothing.
        pace.aggro = mob.chasing ? 1.0 : 0.0;
        pace.lastSeconds = clockSeconds;
        pace.lastPosition = mob.position;
        pace.advancedFrame = frame_;
        pace.unloaded = mob.unloaded;
    } else if (pace.advancedFrame != frame_) {
        // Once a frame, for the reason mobEye gives: a mob painted twice in
        // one frame must not walk twice as far.
        pace.advancedFrame = frame_;
        const double dtMs = clamp((clockSeconds - pace.lastSeconds) * 1000.0, 0.0,
                                  kMaxMotionStepMs);
        if (dtMs > 0.0) {
            // florr's own bookkeeping, in its order: ease the ground speed
            // toward what the body covered this frame, then walk the legs on
            // the eased speed.
            double target = (mob.position - pace.lastPosition).length() / dtMs;
            if (target > kMaxWalkUnitsPerMs) target = pace.speed;
            // Eased over the motion's own step rather than the frame period:
            // it is one term of an integration on this mob's clock, which can
            // span frames the mob was not drawn on.
            easeToward(pace.speed, target, kMobSpeedEaseSeconds, dtMs / 1000.0);
            pace.distance += pace.speed * dtMs;
            pace.clockMs += dtMs;
            easeToward(pace.aggro, mob.chasing ? 1.0 : 0.0, kMobAggroEaseSeconds, dtMs / 1000.0);
            pace.aggroMs += pace.aggro * dtMs;
            pace.unloadedMs += dtMs;
        }
        // A corpse keeps the sting it died with: its MobDraw is rebuilt from
        // a DyingMob, which knows nothing of the reload.
        if (mob.deathProgress < 0.0) {
            if (mob.unloaded && !pace.unloaded) pace.unloadedMs = 0.0;
            pace.unloaded = mob.unloaded;
        }
        pace.lastSeconds = clockSeconds;
        pace.lastPosition = mob.position;
    }
    MobMotion motion;
    motion.clockMs = pace.clockMs;
    motion.distance = pace.distance;
    motion.speed = pace.speed;
    motion.aggro = pace.aggro;
    motion.aggroMs = pace.aggroMs;
    motion.seed = mob.netId;
    motion.health = clamp(mob.healthFraction, 0.0, 1.0);
    motion.pet = mob.pet;
    return motion;
}

double WorldRenderer::stingLoad(const MobDraw& mob, const MobConfig& config) const {
    const auto pace = mobPaces_.find(mob.netId);
    if (pace == mobPaces_.end() || !pace->second.unloaded) return 1.0;
    // The server says when the next missile is loaded, not how far along it
    // is, so the cadence is timed here against the same cooldown it reloads
    // on. Held short of 1 until the server agrees: a sting fully out on a mob
    // that cannot fire yet would promise a shot that is not coming.
    const double cooldown =
        config.cooldownMillis > 0.0 ? config.cooldownMillis : kDefaultVolleyCooldownMillis;
    const double t = clamp(pace->second.unloadedMs / cooldown, 0.0, 0.98);
    return t * t * (3.0 - 2.0 * t);
}

void WorldRenderer::drawLoadedSting(Canvas& canvas, const MobConfig& config, const MobDraw& mob,
                                    Vec2 screen, double rotation, double grown, double zoom,
                                    double clockSeconds) const {
    const std::uint16_t ammo = config.projectile.ammoPetalIndex;
    if (!sprites_ || !content_ || ammo == kInvalidIndex || !sprites_->petalDrawable(ammo)) return;
    const double load = stingLoad(mob, config);
    if (load <= 0.0) return;
    // The radius fireVolley gives the shot, graded at this mob's tier, drawn
    // the way a projectile is: twice that times the ammunition's
    // visual_scale. So the sting that leaves is the missile that arrives.
    const PetalConfig& petal = content_->petal(ammo);
    const double radius = mobShotRadius(content_->petalStats(ammo, mob.rarity).size,
                                        mobShotOwnerScale(mob.radius));
    const double length = 2.0 * radius * petalArtScale(&petal);
    // Loaded, it sits where fireVolley puts a stinger's shot.from. Reloading,
    // it is drawn back in by up to its own length -- far enough to hide under
    // the body it is coming out of.
    const double out =
        (stingerMuzzleDistance(mob.radius, radius) - length * (1.0 - load)) * grown;
    const double tail = rotation + kPi;
    const Vec2 at = screen + Vec2::fromAngle(tail, out * zoom);
    sprites_->drawPetal(canvas, ammo, mob.rarity, at.x, at.y, length * grown * zoom, tail,
                        clockSeconds);
}

const std::vector<std::uint16_t>& WorldRenderer::droppablePetals() const {
    if (!droppablePetals_.empty() || !content_) return droppablePetals_;
    for (std::uint16_t i = 0; i < content_->petalCount(); ++i) {
        const PetalConfig& petal = content_->petal(i);
        // The server's own drop rule: no admin petals, no cutters, nothing
        // with a source of its own, and no egg for a mob whose config forbids
        // one.
        if (petal.isAdminPetal) continue;
        if (petal.id == "cutter" || petal.id == "lightning_cutter") continue;
        if (petalHasOwnSource(petal)) continue;
        const std::string suffix = "_egg";
        if (petal.id.size() > suffix.size() &&
            petal.id.compare(petal.id.size() - suffix.size(), suffix.size(), suffix) == 0) {
            const std::uint16_t mob =
                content_->mobIndex(petal.id.substr(0, petal.id.size() - suffix.size()));
            if (mob != kInvalidIndex && content_->mob(mob).noEggDrop) continue;
        }
        droppablePetals_.push_back(i);
    }
    return droppablePetals_;
}

void WorldRenderer::drawGarbagePile(Canvas& canvas, std::uint32_t netId, double baseSize,
                                    double timeSeconds) const {
    const std::vector<std::uint16_t>& eligible = droppablePetals();
    if (eligible.empty() || !sprites_ || !content_) return;

    // Seeded on the server's id for the mob, so every client builds the same
    // pile out of the same petals without a byte of it crossing the wire, and
    // the pile stays the same pile however far it is shoved. The browser build
    // seeded on where it stood, which reshuffled it on every push. Hashed
    // rather than used raw: ids are small and consecutive, and the picks below
    // read the seed's low six digits as a fraction of the petal list, so raw
    // ids would build every pile out of the first few petals.
    const long long seed = static_cast<long long>(hash01(netId, 0x6A5Du) * 2147483648.0);
    const int count = 5 + static_cast<int>(((seed % 5) + 5) % 5);
    for (int i = 0; i < count; ++i) {
        const long long petalSeed = ((seed + i * 1000LL) % 1000000LL + 1000000LL) % 1000000LL;
        const std::size_t pick = static_cast<std::size_t>(
            static_cast<double>(petalSeed) / 1000000.0 * static_cast<double>(eligible.size()));
        const std::uint16_t index = eligible[std::min(pick, eligible.size() - 1)];

        const double angle = static_cast<double>(i) / count * kTau;
        const double maxRadius = (baseSize * 0.5) * 0.8;
        const double radius = maxRadius * (0.7 + static_cast<double>(petalSeed % 300) / 1000.0);
        const double x = std::cos(angle) * radius;
        const double y = std::sin(angle) * radius + (i % 3) * 3.0;
        const double rotation = static_cast<double>(petalSeed % 360) * kPi / 180.0;
        const PetalConfig& config = content_->petal(index);
        const double size = baseSize * (0.6 + static_cast<double>(petalSeed % 200) / 1000.0) *
                            config.size * petalArtScale(&config);
        sprites_->drawPetal(canvas, index, Rarity::Common, x, y, size, rotation, timeSeconds);
    }
}

void WorldRenderer::drawDiggerMob(Canvas& canvas, const MobDraw& mob, double radius,
                                  double timeSeconds) const {
    const double scale = radius / kFlowerArtRadius;

    canvas.save();
    canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
    const Vec2 eye = mobEye(mob);
    // EquipCutter, so the blade is drawn by the one painter a player's flower
    // uses: the digger carries the same object and must not drift from it.
    // gardn's digger is a flower in its mob colour -- grey wild, and its
    // owner's flower colour once summoned.
    drawFace(canvas, FaceSquareEyes, EquipCutter, eye.x, eye.y, 14.5, timeSeconds,
             mob.pet ? kPetBodyColor : kDiggerBodyColor);
    canvas.restore();
}

void WorldRenderer::drawDiggerPicture(Canvas& canvas, double radius, double timeSeconds) const {
    const double scale = radius / kFlowerArtRadius;
    canvas.save();
    canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
    // gardn's FlowerRenderAttributes defaults, which its gallery leaves alone:
    // the eyes 3 forward, the mouth a 15 smile.
    drawFace(canvas, FaceSquareEyes, EquipCutter, 3.0, 0.0, 15.0, timeSeconds, kDiggerBodyColor);
    canvas.restore();
}

void WorldRenderer::drawPetalRingMob(Canvas& canvas, const MobConfig& config, const MobDraw& mob,
                                     double radius, double rotation, bool mirrored,
                                     Vec2 bodyShift, double timeSeconds,
                                     const MobMotion* motion) const {
    // Only the BODY takes the art offset. The ring is where the server hits
    // from, and moving it with the drawing would draw seeds where none are.
    canvas.save();
    canvas.translate(static_cast<float>(bodyShift.x), static_cast<float>(bodyShift.y));
    // A flower FACE, or the mob's own artwork. Stated by the config rather
    // than inferred from whether artwork exists: the glitch flower ships an
    // SVG it deliberately does not use, and a rule that preferred the drawing
    // whenever there was one would change the one mob this path was written
    // for. See PetalRingSpec::flowerFace.
    if (config.petalRing.flowerFace || !sprites_ || !sprites_->mobDrawable(mob.typeIndex)) {
        const double scale = radius / kFlowerArtRadius;
        canvas.save();
        canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
        const Vec2 eye = mobEye(mob);
        drawFace(canvas, config.petalRing.squareEyes ? FaceSquareEyes : 0, EquipNone, eye.x, eye.y,
                 14.5, timeSeconds, config.petalRing.faceColor);
        canvas.restore();
    } else {
        // At the origin: the caller has already translated to where the mob is.
        // The world radius is handed over beside the drawn one for the reason
        // drawMobBody gives -- a code-drawn mob cuts its detail from how big it
        // IS, not from how big it is being painted.
        //
        // A body whose ring is AMMUNITION is drawn unturned. Its seats sit on
        // fixed world bearings (MobPetalRing::bearing ignores the facing), and
        // the stalks in its drawing are where those seats grow from -- turned
        // with the mob, a dandelion's stalks pointed between its seeds.
        const double visualScale = config.visualScale > 0 ? config.visualScale : 1.0;
        const double facing = config.petalRing.shootOnHit ? 0.0 : rotation;
        sprites_->drawMob(canvas, mob.typeIndex, mob.rarity, 0.0, 0.0, radius * 2.0, facing,
                          timeSeconds, mirrored, mob.radius * visualScale, {1.0, 0.0}, motion);
    }
    canvas.restore();

    const std::uint16_t index = config.petalRing.petalIndex;
    if (!sprites_ || !content_ || index == kInvalidIndex) return;
    const PetalConfig& petal = content_->petal(index);
    // Only a DECORATIVE ring is painted here. A ring that is ammunition is
    // made of real entities, each replicated and drawn as a petal anchored to
    // this mob, so painting it again would double every seed.
    if (config.petalRing.shootOnHit) return;
    const int count = static_cast<int>(clamp(config.petalRing.count, 0, 16));
    if (count <= 0) return;

    // Every distance is a multiple of the mob's own radius, so the ring grows
    // with rarity along with the body.
    //
    // The mob's WORLD radius, which is why `visual_scale` is divided back out:
    // a ring is laid out off the body the server simulates -- an ammunition
    // ring's seats are, at spawn (MobPetalRing::orbit), and this decoration
    // ring, which nothing simulates, is drawn by the same rule -- and an
    // art-only field must not move it. Anything the death animation did to
    // `radius` survives the division, so a popping mob's ring still balloons
    // with it.
    //
    const double artScale = config.visualScale > 0 ? config.visualScale : 1.0;
    const double ringRadius = radius / artScale;
    const double orbit = ringRadius * config.petalRing.orbitScale;
    const double size =
        ringRadius * config.petalRing.petalScale * petal.size * petalArtScale(&petal);
    const double speed = petal.speed > 0 ? petal.speed : 1.0;
    // The RING's own spin, which has nothing to do with the mob's facing. A
    // ring that is part of the BODY does not have one: a dandelion's seed head
    // is attached to it, and seeds sweeping past a mob that is standing still
    // read as something orbiting it rather than something growing out of it.
    const double spin = config.petalRing.spins
                            ? std::fmod(timeSeconds * kPetalSpinRate * speed, kTau)
                            : 0.0;
    const double step = kTau / std::max(1, count);
    for (int i = 0; i < count; ++i) {
        const double angle = i * step + spin;
        // gardn's kFollowRot: a petal turned to its own outward bearing, so
        // whatever its artwork puts at the petal's -X end -- a dandelion's
        // stem -- points back into the body. An upright petal is what the
        // glitch flower's squares want, so this is per ring.
        const double facing = config.petalRing.followRotation ? angle : 0.0;
        sprites_->drawPetal(canvas, index, mob.rarity, std::cos(angle) * orbit,
                            std::sin(angle) * orbit, size, facing, timeSeconds);
    }
}

bool WorldRenderer::poseMob(const MobDraw& mob, const MobConfig* config, double zoom,
                            double clockSeconds, MobPose& pose) const {
    // A mob that has locked on beats its wings twice as fast, but only the two
    // kinds that actually chase: a passive mob fleeing is not excited, and a
    // sandstorm has no target to lock on to in the first place.
    const bool hurries = mob.chasing && config &&
                         (config->ai == AiKind::Neutral || config->ai == AiKind::Hostile);
    pose.timeSeconds = hurries ? clockSeconds * 2.0 : clockSeconds;

    const double visualScale = (config && config->visualScale > 0) ? config->visualScale : 1.0;
    pose.diameter = mob.radius * 2.0 * visualScale * zoom;
    pose.alpha = 1.0;
    if (mob.deathProgress >= 0.0) {
        const double p = clamp(mob.deathProgress, 0.0, 1.0);
        // Balloons to three times its size while it fades on a cubic curve,
        // which is what makes a kill read at a glance in a crowd.
        pose.diameter *= 1.0 + p * 2.0;
        pose.alpha = 1.0 - p * p * p;
    }
    if (pose.diameter <= 0.5 || pose.alpha <= 0.0) return false;

    pose.rotation = (config && config->hideRotation) ? 0.0 : mob.angle;
    pose.mirrored = config && config->reversed;
    // The server points `reversed` art backwards by adding pi to the facing.
    // The browser build MIRRORS it instead, which is a different transform for
    // anything asymmetric, so undo the half turn and reflect it here.
    if (pose.mirrored && !(config && config->hideRotation)) pose.rotation = mob.angle - kPi;

    // `visualOffsetX/Y`, resolved to a screen vector because the sprite is
    // handed a centre rather than a transform. The offset lives in the art's
    // own frame, which the sprite cache mirrors AFTER rotating, so the X is
    // flipped before the turn. Scaled by the drawn radius -- death pop
    // included -- so the same point of the drawing stays on the body.
    pose.bodyShift = {};
    if (config && (config->visualOffsetX != 0 || config->visualOffsetY != 0)) {
        const double r = pose.diameter * 0.5;
        const double ox = (pose.mirrored ? -config->visualOffsetX : config->visualOffsetX) * r;
        const double oy = config->visualOffsetY * r;
        const double c = std::cos(pose.rotation);
        const double s = std::sin(pose.rotation);
        pose.bodyShift = {ox * c - oy * s, ox * s + oy * c};
    }
    return true;
}

double WorldRenderer::glitchFlowerReach(const MobConfig& config, const MobPose& pose) const {
    // The wrapper has to cover the RING, not just the body: it sizes its
    // buffer from the radius it is handed. The ring stays on the hitbox, so a
    // shifted body only needs the shift added on.
    return pose.diameter * 0.5 * (config.petalRing.orbitScale * 0.5 + 0.3) +
           pose.bodyShift.length();
}

void WorldRenderer::drawMobBody(Canvas& canvas, const Camera& camera, const MobDraw& mob,
                                double clockSeconds) const {
    const MobConfig* config = content_ ? &content_->mob(mob.typeIndex) : nullptr;
    const double zoom = camera.zoom();
    MobPose pose;
    if (!poseMob(mob, config, zoom, clockSeconds, pose)) return;
    const double timeSeconds = pose.timeSeconds;
    const double diameter = pose.diameter;
    const double alpha = pose.alpha;
    const double rotation = pose.rotation;
    const bool mirrored = pose.mirrored;
    const Vec2 bodyShift = pose.bodyShift;
    const Vec2 screen = camera.worldToScreen(mob.position);
    const Vec2 art = screen + bodyShift;
    const double visualScale = (config && config->visualScale > 0) ? config->visualScale : 1.0;
    // The real clock, not the pose's: a florr painter keeps its own tempo and
    // blends in its own hurry from `aggro`.
    const MobMotion motion = mobMotion(mob, clockSeconds);

    canvas.save();
    if (alpha < 1.0) canvas.setGlobalAlpha(static_cast<float>(alpha));

    if (config && config->emissive) {
        // Radially symmetric, so the mob's own rotation never reaches it.
        const double lightRadius =
            (config->lightRadius > 0 ? config->lightRadius : mob.radius * 4.0) * zoom;
        canvas.save();
        canvas.translate(static_cast<float>(art.x), static_cast<float>(art.y));
        // The sun lights 2000 units, which is the whole screen: sixteen bands
        // of it is sixteen full-screen fills a frame, so a glow that large is
        // painted coarsely. The browser build blits a baked sprite and never
        // pays this at all.
        drawPetalGlow(canvas, lightRadius, config->lightColorRgba >> 8,
                      lightRadius > 300.0 ? 6 : 16);
        canvas.restore();
    }

    // Everything from here is the body, and flashes when it is hit; the glow
    // above is light, not body. A dying mob keeps its net id, so the killing
    // blow flashes on through the death animation.
    const ScopedColorTint flash(canvas, hitTint(mob.netId));

    // Before the body, so the sting comes out from under it. Off the HITBOX
    // centre rather than the art's: it is the server's muzzle.
    if (config && config->stingerShooter && config->projectile.present &&
        !config->hideRotation) {
        const double drawnAtRest = mob.radius * 2.0 * visualScale * zoom;
        drawLoadedSting(canvas, *config, mob, screen, rotation,
                        drawnAtRest > 0.0 ? diameter / drawnAtRest : 1.0, zoom, clockSeconds);
    }

    static const std::string kNoId;
    const std::string& id = config ? config->id : kNoId;
    if (id == "garbage") {
        // Its entry in mobs.json is an empty document: the pile IS the artwork,
        // laid out in world units off the mob's COLLISION size -- the browser
        // build sizes the pile from that and never from the death scale.
        canvas.save();
        canvas.translate(static_cast<float>(art.x), static_cast<float>(art.y));
        canvas.scale(static_cast<float>(mirrored ? -zoom : zoom), static_cast<float>(zoom));
        drawGarbagePile(canvas, mob.netId, mob.radius * 2.0, timeSeconds);
        canvas.restore();
    } else if (id == "digger") {
        // A flower carrying a cutter rather than a bug, the way gardn draws it.
        canvas.save();
        canvas.translate(static_cast<float>(art.x), static_cast<float>(art.y));
        drawDiggerMob(canvas, mob, diameter * 0.5, timeSeconds);
        canvas.restore();
    } else if (config && config->petalRing.present) {
        const double radius = diameter * 0.5;
        const auto paint = [&](Canvas& target) {
            drawPetalRingMob(target, *config, mob, radius, rotation, mirrored, bodyShift,
                             timeSeconds, &motion);
        };
        if (id == "glitch_flower") {
            drawGlitched(canvas, screen, glitchFlowerReach(*config, pose), mob.netId, timeSeconds,
                         paint);
        } else {
            canvas.save();
            canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
            paint(canvas);
            canvas.restore();
        }
    } else if (sprites_ && (sprites_->mobArt(mob.typeIndex) == MobArt::Oracle ||
                            sprites_->mobArt(mob.typeIndex) == MobArt::Trader ||
                            sprites_->mobArt(mob.typeIndex) == MobArt::Titan)) {
        // The body is drawn UPRIGHT and the facing goes to the eye instead: an
        // oracle turning round is a pupil sliding across its socket, the way a
        // flower's is, not a disc of tendrils spinning on the spot -- and the
        // trader and the titan wear a flower's face, whose eyes are eased
        // toward its facing with the same time constant a player's are. So the
        // gaze is the facing, eased, in world space -- which with no
        // rotation applied is the art's space too.
        sprites_->drawMob(canvas, mob.typeIndex, mob.rarity, art.x, art.y, diameter, 0.0,
                          timeSeconds, false, mob.radius * visualScale, mobGaze(mob), &motion);
    } else if (sprites_ && sprites_->mobDrawable(mob.typeIndex)) {
        // The world radius is handed over beside the drawn one because the mobs
        // drawn by code cut their detail from how big the mob IS. Not the death
        // scale and not the zoom: a rock does not gain facets while it pops,
        // and it does not lose them when the camera pulls back.
        sprites_->drawMob(canvas, mob.typeIndex, mob.rarity, art.x, art.y, diameter, rotation,
                          timeSeconds, mirrored, mob.radius * visualScale, {1.0, 0.0}, &motion);
    } else {
        // No artwork: the tier colour, which is at least the one fact about a
        // mob worth reading from across the screen.
        ui::disc(canvas, art, diameter * 0.5, rarityColor(mob.rarity), ui::kInk, 2.0 * zoom);
    }
    canvas.restore();
}

} // namespace flix
