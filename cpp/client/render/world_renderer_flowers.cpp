// Flowers: the body (the default one or a custom skin), its face and what it
// wears, the size and health-bar colour it is drawn with, and the corpse a
// dead one leaves.

#include "client/render/world_renderer_internal.h"

#include <cmath>
#include <cstdint>

#include "client/render/art_cache.h"
#include "client/render/skin_render.h"
#include "client/ui/draw.h"
#include "shared/game/config.h"

namespace flix {

using namespace world_render;

namespace {

// --- the Champion's Crown, worn ---------------------------------------------
//
// florr paints its headwear with one function for both places it shows: on an
// item it lays a faint black disc down first, standing in for the head the
// piece sits on, and on a flower it leaves the disc out. petals.json carries
// the item's picture, disc and all; this is the other branch -- the crown
// alone, in the same frame, where the head's disc is centred on the origin
// with a radius of 30.
constexpr const char* kWornCrownSvg =
    R"SVG(<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22.9 -41.7 45.8 22.3">)SVG"
    R"SVG(<g transform="matrix(1.1 0 0 1.1 -60.5 -60.5)">)SVG"
    R"SVG(<path fill="#ffdc06" stroke="#ccb005" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m48.125 18.194-4.5 8.526-8.375-4.22 4.625 13.75c3.875-.875 9.612-1.125 15.125-1.125s11.25.25 15.125 1.125L74.75 22.5l-8.375 4.22-4.5-8.526L55 25.875Z"/>)SVG"
    R"SVG(<path fill="red" stroke="#c00" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.334" d="M40.375 31.373a2 2 0 1 1-4 0 2 2 0 0 1 4 0M51.22 29.57a2 2 0 1 1-4 0 2 2 0 0 1 4 0m18.405 1.802a2 2 0 1 0 4 0 2 2 0 0 0-4 0M58.78 29.57a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/>)SVG"
    R"SVG(</g></svg>)SVG";
/// The head's disc is the flower: radius 30 in that frame is radius 25 here.
constexpr double kWornCrownScale = kFlowerArtRadius / 30.0;

/// The worn crown, in the flower's radius-25 art space and upright -- florr's
/// sits on top of the head whichever way the flower faces.
void drawWornCrown(Canvas& canvas) {
    static const SvgDocument crown = SvgDocument::fromString(kWornCrownSvg);
    if (crown.empty()) return;
    crown.renderFitted(canvas, static_cast<float>(crown.viewBoxX() * kWornCrownScale),
                       static_cast<float>(crown.viewBoxY() * kWornCrownScale),
                       static_cast<float>(crown.viewBoxWidth() * kWornCrownScale),
                       static_cast<float>(crown.viewBoxHeight() * kWornCrownScale), 0.0f);
}

/// A worn disc turns the flower's own outline black: the petal's #111111, at
/// the outline's own 3 units, and nothing added (user's choice). florr draws
/// nothing for a worn disc -- its flower painter has no branch for one.
constexpr std::uint32_t kWornDiscOutline = 0x111111u;

/// An Undead flower's body: florr's `Colors/undead`, the green its mummy
/// beetle wears.
constexpr std::uint32_t kUndeadBody = 0x83B05Du;

/// Whether a flower is drawn wrapped in the bandage: for as long as it wears
/// one (user, 2026-10-22: "always show the bandage drawing when it is
/// equipped"), and while it is Undead.
bool wrappedInBandage(std::uint8_t faceFlags, std::uint16_t equipFlags) {
    return (faceFlags & FaceUndead) != 0 || (equipFlags & EquipBandage) != 0;
}

/// How much bigger a worn piece florr draws at the flower's centre is than the
/// same petal on the ring: 1.65 x (25 + 1.5) / 25, the flower's outline radius
/// over its body's, as its flower painter (0x1006c8ef0) scales the bandage.
constexpr double kWornCentreScale = 1.65 * (kFlowerArtRadius + 1.5) / kFlowerArtRadius;

/// Straight per-channel lerp, rounded the way the browser build rounds it.
std::uint32_t lerpColor(std::uint32_t from, std::uint32_t to, double t) {
    const auto channel = [t](std::uint32_t a, std::uint32_t b) {
        return static_cast<std::uint32_t>(
            clamp(std::round(a + (static_cast<double>(b) - a) * t), 0.0, 255.0));
    };
    return (channel((from >> 16) & 0xFF, (to >> 16) & 0xFF) << 16) |
           (channel((from >> 8) & 0xFF, (to >> 8) & 0xFF) << 8) |
           channel(from & 0xFF, to & 0xFF);
}

} // namespace

void WorldRenderer::drawFlower(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    // The drawn flower is 25 world units times the petal-driven size
    // multiplier, and nothing else. entity.radius is the gameplay hitbox,
    // which grows with level; using it here made a high level flower visibly
    // larger than the browser build's, which never grows one.
    const double radius = kFlowerArtRadius * playerSizeMultiplier(entity) * zoom;
    if (radius <= 0.5) return;
    const double scale = radius / kFlowerArtRadius;

    const auto paintBody = [&](Canvas& target) {
        // Charging a pad: the body turns, face and all. Inside the glitch's
        // buffer as much as outside it, as the reference applied the spin
        // before the glitch read the transform.
        if (entity.padSpin != 0.0) target.rotate(static_cast<float>(entity.padSpin));
        target.scale(static_cast<float>(scale), static_cast<float>(scale));
        drawFlowerBody(target, entity, timeSeconds);
    };

    // A glitched flower flashes as well: drawGlitched paints its buffer under
    // whatever tint the canvas has on.
    const ScopedColorTint flash(canvas, hitTint(entity.netId));
    if (entity.renderFlags & PlayerRenderGlitch) {
        drawGlitched(canvas, screen, radius, entity.netId, timeSeconds, paintBody);
        return;
    }
    canvas.save();
    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
    paintBody(canvas);
    canvas.restore();
}

double WorldRenderer::playerSizeMultiplier(const RemoteEntity& entity) const {
    // The server multiplies the level's own hitbox radius by the loadout's
    // size modifiers before replicating it, so the multiplier is what is left
    // once the level is divided back out. Sending it separately would put the
    // same number on the wire twice and let the two disagree.
    const double base = playerRadiusForLevel(entity.level);
    if (base <= 0.0) return 1.0;
    // Bounded the way the server bounds it, so a corrupt radius cannot scale a
    // flower off the screen.
    return clamp(entity.radius / base, 0.0, kMaxPlayerSizeScale);
}

std::uint32_t invulnerableFadeColor(double secondsSinceShield) {
    const double t = clamp(secondsSinceShield / kInvulnerableFadeSeconds, 0.0, 1.0);
    return lerpColor(kInvulnerableHealth, ui::kHealth, t);
}

std::uint32_t WorldRenderer::healthBarColor(const RemoteEntity& entity, double timeSeconds) const {
    // A flower that left view while shielded never gets its fade frame, so
    // bound the table rather than let one leak per disconnect.
    if (invulnFade_.size() > 256) invulnFade_.clear();

    // -1 means "still shielded"; any other value is the moment it ended, which
    // is what the fade back to green is measured from.
    if (entity.state & net::StateInvulnerable) {
        invulnFade_[entity.netId] = -1.0;
        return kInvulnerableHealth;
    }
    const auto it = invulnFade_.find(entity.netId);
    if (it == invulnFade_.end()) return ui::kHealth;
    if (it->second < 0.0) it->second = timeSeconds;
    const double since = timeSeconds - it->second;
    if (since >= kInvulnerableFadeSeconds) {
        invulnFade_.erase(it);
        return ui::kHealth;
    }
    return invulnerableFadeColor(since);
}

void WorldRenderer::drawCorpse(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    if (kFlowerArtRadius * zoom <= 0.5) return;
    const Vec2 screen = camera.worldToScreen(at);

    // The killing blow is still flashing as the body falls.
    const ScopedColorTint flash(canvas, hitTint(entity.netId));
    canvas.save();
    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
    // A corpse lies where it fell: rotated to its facing, at a fixed radius 25
    // whatever the flower's size multiplier was, and with no skin, no status
    // tint, no plate and no petals.
    // It frowns: the HUD avatar and the death card draw this same body, and
    // the death screen they were measured from frowns on all of them.
    canvas.rotate(static_cast<float>(entity.angle));
    canvas.scale(static_cast<float>(zoom), static_cast<float>(zoom));
    drawDeadFlower(canvas, entity.equipFlags, 5.0, timeSeconds);
    canvas.restore();
}

void WorldRenderer::drawDeadFlower(Canvas& canvas, std::uint16_t equipFlags, double mouth,
                                   double timeSeconds) const {
    drawFace(canvas, FaceDeadEyes, equipFlags, 0, 0, mouth, timeSeconds);
}

const CustomSkin* WorldRenderer::wornSkin(const RemoteEntity& entity) const {
    if (entity.equippedSkinId.empty() || skinCatalog_ == nullptr) return nullptr;
    for (const CustomSkin& skin : *skinCatalog_) {
        // A skin with no shapes would paint nothing at all and read as an
        // invisible flower, so it falls back to the default body instead.
        if (skin.id == entity.equippedSkinId) return skin.shapes.empty() ? nullptr : &skin;
    }
    // Taken down since this snapshot was built, or published before this
    // client authenticated. Either way there is nothing to draw.
    return nullptr;
}

void WorldRenderer::drawFlowerBody(Canvas& canvas, const RemoteEntity& entity,
                                   double timeSeconds) const {
    // A user-created skin is drawn in place of the default flower.
    if (const CustomSkin* skin = wornSkin(entity)) {
        // kFlowerArtRadius, not the flower's grown radius: the caller has
        // already scaled into the artwork's own radius-25 space, which is the
        // space the studio authors in.
        //
        // Through the bitmap cache, because a skin is the most expensive thing
        // on a flower by a wide margin and none of it moves. It is a list of
        // authored shapes, and every one of them costs a save, a translate, a
        // path, a fill, usually a stroke with its own join and cap, and a
        // restore -- eight to fourteen drawing calls each, repainted from
        // scratch for every skinned flower on screen on every frame. A busy
        // screen of them ran to thousands of calls a frame on its own. Baked,
        // a skin is one blit.
        //
        // The box is the disc renderSkinShapes clips to (100 authored units,
        // so four times the art radius), which is the most a skin can paint.
        // The cache refuses a rotated or mirrored transform for itself, and
        // falls through to the real painter when it does.
        const double reach = kFlowerArtRadius * 4.0;
        // Keyed on the skin's address AND its id, because the catalog can be
        // replaced wholesale and a fresh allocation is free to land on an
        // address a retired skin used to have -- and on when it was last
        // edited, because an edit keeps both and changes the picture.
        std::uint64_t variant = 1469598103934665603ull;
        for (const char c : skin->id) variant = (variant ^ static_cast<unsigned char>(c)) * 1099511628211ull;
        variant = variant * 1099511628211ull + skin->shapes.size();
        variant = variant * 1099511628211ull + static_cast<std::uint64_t>(skin->editedAt);
        if (!drawCachedPicture(canvas, skin, variant, -reach, -reach, reach * 2.0, reach * 2.0,
                               [&](Canvas& bitmap) {
                                   bitmap.translate(static_cast<float>(reach),
                                                    static_cast<float>(reach));
                                   renderSkinShapes(bitmap, skin->shapes, kFlowerArtRadius);
                               })) {
            renderSkinShapes(canvas, skin->shapes, kFlowerArtRadius);
        }
        // A worn bandage shows through any body: the face's wrap, over the
        // skin.
        if (wrappedInBandage(entity.faceFlags, entity.equipFlags)) {
            drawUndeadWrap(canvas, timeSeconds);
        }
        return;
    }
    drawDefaultFlower(canvas, entity, timeSeconds);
}

void WorldRenderer::drawDefaultFlower(Canvas& canvas, const RemoteEntity& entity,
                                      double timeSeconds) const {
    // The server sends 14.5 idle and 4 while attacking or defending; the face
    // itself only ever sees the resulting curve.
    const bool active = (entity.faceFlags & (FaceAttacking | FaceDefending)) != 0;
    drawFace(canvas, entity.faceFlags, entity.equipFlags, entity.eyeX, entity.eyeY,
             active ? 4.0 : 14.5, timeSeconds);
}

void WorldRenderer::drawCutterBlade(Canvas& canvas, std::uint16_t equipFlags,
                                    double timeSeconds) const {
    if (!sprites_ || !content_) return;
    // The lightning cutter is the same blade in cyan, and carries its own bit
    // for exactly this reason. A flower wearing both shows the lightning one.
    const std::uint16_t index =
        content_->petalIndex((equipFlags & EquipLightningCutter) ? "lightning_cutter" : "cutter");
    if (index == kInvalidIndex || !sprites_->petalDrawable(index)) return;

    // The caller has already put us in the flower's radius-25 art space, which
    // is the space gardn's `ctx.scale(radius / 25)` reaches before it draws the
    // blade raw -- so the artwork goes down at its plain configured size and
    // the teeth land at radius 35, 1.4 flowers across, as they do there.
    const PetalConfig& config = content_->petal(index);
    const double diameter = kPetalArtSize * config.size * petalArtScale(&config);
    const double speed = config.speed > 0 ? config.speed : 1.0;
    // The flower sends which blade it wears, never its tier, so it is drawn
    // as a common one.
    sprites_->drawPetal(canvas, index, Rarity::Common, 0, 0, diameter,
                        std::fmod(timeSeconds * kPetalSpinRate * speed, kTau), timeSeconds);
}

void WorldRenderer::drawUndeadWrap(Canvas& canvas, double timeSeconds) const {
    if (!sprites_ || !content_) return;
    const std::uint16_t index = content_->petalIndex("bandage");
    if (index == kInvalidIndex || !sprites_->petalDrawable(index)) return;
    // The picture's box on the ring, at florr's centre scale: the strips lie
    // across the whole flower, edge to edge of its outline.
    const PetalConfig& config = content_->petal(index);
    const double box = kPetalArtSize * config.size * petalArtScale(&config) * kWornCentreScale;
    sprites_->drawPetal(canvas, index, Rarity::Common, 0, 0, box, 0, timeSeconds);
}

void WorldRenderer::drawFace(Canvas& canvas, std::uint8_t faceFlags, std::uint16_t equipFlags,
                             double eyeX, double eyeY, double mouth, double timeSeconds,
                             std::uint32_t bodyColor) const {
    // First, so the blade sits BEHIND the body: gardn draws the cutter before
    // the flower's own circle (Client/Assets/Flower.cc) and the teeth show only
    // where they reach past the rim.
    if (equipFlags & EquipCutter) drawCutterBlade(canvas, equipFlags, timeSeconds);

    std::uint32_t baseColor = bodyColor;
    // The status precedence is intentional: corruption identifies a flower
    // that can hurt other players, so it must remain visible through poison.
    if (faceFlags & FaceHasCorruption) baseColor = 0xD91313u;
    else if (faceFlags & FaceUndead) baseColor = kUndeadBody;
    else if (faceFlags & FacePoisoned) baseColor = 0xCE76DBu;
    else if (faceFlags & FaceDandelioned) baseColor = ui::lighten(baseColor, 0.4);

    ui::setFill(canvas, (equipFlags & EquipDisc) ? kWornDiscOutline : ui::shade(baseColor, 0.8));
    canvas.beginPath();
    canvas.arc(0, 0, 26.5f, 0, static_cast<float>(kTau));
    canvas.fill();
    ui::setFill(canvas, baseColor);
    canvas.beginPath();
    canvas.arc(0, 0, 23.5f, 0, static_cast<float>(kTau));
    canvas.fill();

    const bool deadEyes = (faceFlags & FaceDeadEyes) != 0;
    canvas.save();
    ui::setFill(canvas, 0x000000u);
    ui::setStroke(canvas, 0x000000u);
    if (deadEyes) {
        constexpr float len = 4.0f;
        canvas.setLineWidth(3.0f);
        canvas.setLineCap("round");
        canvas.beginPath();
        canvas.moveTo(-7 - len, -4.8f - len); canvas.lineTo(-7 + len, -4.8f + len);
        canvas.moveTo(-7 + len, -4.8f - len); canvas.lineTo(-7 - len, -4.8f + len);
        canvas.moveTo(7 - len, -4.8f - len); canvas.lineTo(7 + len, -4.8f + len);
        canvas.moveTo(7 + len, -4.8f - len); canvas.lineTo(7 - len, -4.8f + len);
        canvas.stroke();
    } else if (faceFlags & FaceSquareEyes) {
        canvas.beginPath();
        canvas.rect(-10, -11.3f, 6, 13);
        canvas.rect(4, -11.3f, 6, 13);
        canvas.fill();
        canvas.clip();
        ui::setFill(canvas, 0xFFFFFFu);
        canvas.beginPath();
        canvas.rect(static_cast<float>(-10 + eyeX), static_cast<float>(-7.8 + eyeY), 6, 6);
        canvas.rect(static_cast<float>(4 + eyeX), static_cast<float>(-7.8 + eyeY), 6, 6);
        canvas.fill();
        ui::setStroke(canvas, 0x000000u);
        canvas.setLineWidth(1.0f);
        canvas.beginPath(); canvas.rect(-10, -11.3f, 6, 13); canvas.stroke();
        canvas.beginPath(); canvas.rect(4, -11.3f, 6, 13); canvas.stroke();
    } else {
        // Shared with the trader, whose eyes are a flower's (mob_art.h).
        paintFlowerEyes(canvas, eyeX, eyeY);
    }
    canvas.restore();

    ui::setStroke(canvas, 0x222222u);
    canvas.setLineWidth(1.5f);
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(-6, 10);
    canvas.quadraticCurveTo(0, static_cast<float>(mouth), 6, 10);
    canvas.stroke();

    if (!deadEyes && mouth <= 8.0 && (faceFlags & FaceAttacking)) {
        canvas.save();
        canvas.translate(0, static_cast<float>(-mouth - 8.0));
        ui::setFill(canvas, baseColor);
        canvas.beginPath();
        canvas.moveTo(-12, 0); canvas.lineTo(12, 0); canvas.lineTo(0, 6); canvas.closePath();
        canvas.fill();
        canvas.restore();
    }

    if (equipFlags & (EquipAntennae | EquipObserver)) {
        canvas.save();
        canvas.translate(0, -35);
        ui::setFill(canvas, 0x333333u);
        ui::setStroke(canvas, 0x222222u);
        canvas.setLineWidth(3.0f);
        canvas.setLineCap("round");
        canvas.setLineJoin("round");
        canvas.beginPath();
        canvas.moveTo(5, 12.5f); canvas.quadraticCurveTo(10, -2.5f, 15, -12.5f);
        canvas.quadraticCurveTo(5, -2.5f, 5, 12.5f); canvas.closePath();
        canvas.moveTo(-5, 12.5f); canvas.quadraticCurveTo(-10, -2.5f, -15, -12.5f);
        canvas.quadraticCurveTo(-5, -2.5f, -5, 12.5f); canvas.closePath();
        canvas.fill();
        canvas.stroke();
        if (equipFlags & EquipObserver) {
            ui::setFill(canvas, 0xD01C1Du);
            canvas.beginPath(); canvas.arc(15, -12.5f, 2.5f, 0, static_cast<float>(kTau)); canvas.fill();
            canvas.beginPath(); canvas.arc(-15, -12.5f, 2.5f, 0, static_cast<float>(kTau)); canvas.fill();
        }
        canvas.restore();
    }

    if (equipFlags & EquipThirdEye) {
        const std::uint16_t thirdEye = content_ ? content_->petalIndex("third_eye") : kInvalidIndex;
        if (sprites_ && thirdEye != kInvalidIndex && sprites_->petalDrawable(thirdEye)) {
            sprites_->drawPetal(canvas, thirdEye, Rarity::Common, 0, -14, 13, 0, timeSeconds);
        } else {
            canvas.save();
            canvas.translate(0, -14);
            canvas.scale(0.5f, 0.5f);
            if (deadEyes) {
                constexpr float len = 4.0f;
                ui::setStroke(canvas, 0x222222u);
                canvas.setLineWidth(3.0f);
                canvas.setLineCap("round");
                canvas.beginPath();
                canvas.moveTo(-len, -len); canvas.lineTo(len, len);
                canvas.moveTo(len, -len); canvas.lineTo(-len, len);
                canvas.stroke();
            } else {
                ui::setFill(canvas, 0x222222u);
                ui::setStroke(canvas, 0x222222u);
                canvas.setLineWidth(1.0f);
                canvas.beginPath();
                canvas.ellipse(0, 0, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
                canvas.fill(); canvas.stroke(); canvas.clip();
                ui::setFill(canvas, 0xFFFFFFu);
                canvas.beginPath();
                canvas.arc(static_cast<float>(eyeX), static_cast<float>(eyeY),
                           3, 0, static_cast<float>(kTau));
                canvas.fill();
            }
            canvas.restore();
        }
    }

    // florr wraps the bandage on after the third eye and before the crown.
    if (wrappedInBandage(faceFlags, equipFlags)) drawUndeadWrap(canvas, timeSeconds);
    if (equipFlags & EquipCrown) drawWornCrown(canvas);
}

} // namespace flix
