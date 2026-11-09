// What is drawn over the bodies rather than as them: player name plates and
// health bars, the viewer's own mana bar, chat bubbles, mob labels and the
// hitbox outlines.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

#include "client/ui/draw.h"
#include "client/ui/menu_widgets.h"
#include "shared/game/config.h"
#include "shared/game/signature_skin.h"

namespace flix {

using namespace world_render;

void WorldRenderer::drawFanTitle(Canvas& canvas, const RemoteEntity& entity,
                                  const Camera& camera, Vec2 at, double timeSeconds) const {
    if (entity.equippedSkinId != kFanSkinId) return;
    const double zoom = camera.zoom();
    const double flowerScale = playerSizeMultiplier(entity);
    if (flowerScale <= 0.0) return;
    const Vec2 screen = camera.worldToScreen(at);
    const double bodyRadius = kFlowerArtRadius * flowerScale;
    const double time = std::isfinite(timeSeconds) ? timeSeconds : 0.0;
    canvas.save();
    canvas.translate(static_cast<float>(screen.x),
                     static_cast<float>(screen.y - (bodyRadius + 12.0 * flowerScale) * zoom));
    const float titleScale = static_cast<float>(zoom * flowerScale);
    canvas.scale(titleScale, titleScale);

    ui::TextStyle title;
    title.size = 16.0;
    title.align = ui::Align::Centre;
    title.baseline = ui::Baseline::Alphabetic;
    title.fill = 0xFFE7A0u;
    title.roundJoin = true;
    const std::string label = "19k's fan";
    const Vec2 pen = ui::textPen(label, 0, 0, title);
    const double prefixWidth = ui::textWidth(canvas, "19k", title.size);

    // Layered translucent outlines make a soft gold glow on both renderers;
    // native Canvas does not implement shadowBlur. Keep the core text crisp.
    ui::TextStyle glow = title;
    glow.fill = glow.stroke = 0xFFAD42u;
    const double glowAlpha = 0.075 + 0.015 * std::sin(time * 1.6);
    for (int layer = 3; layer >= 1; --layer) {
        glow.strokeWidth = layer * 2.4;
        ui::paintRun(canvas, label, pen.x, pen.y, glow, glowAlpha, glowAlpha);
    }

    // Fourteen analytic motes around "19k", gently rising and fading.
    // No particle entities, random state or growing per-player buffers.
    const double phase = static_cast<double>(entity.netId % 97) / 97.0;
    for (int i = 0; i < 14; ++i) {
        const double life = time * 0.38 + i * 0.61803398875 + phase;
        const double progress = life - std::floor(life);
        const double fade = std::sin(progress * kPi);
        const double x = pen.x + prefixWidth * ((i * 7 % 11) / 10.0) +
                         1.5 * std::sin(time * 0.8 + i * 2.4);
        const double y = 2.0 - progress * 30.0;
        const float r = static_cast<float>(0.7 + 0.45 * fade);
        const auto dot = [&](float radius, std::uint32_t color, double alpha) {
            ui::setFill(canvas, color, alpha);
            canvas.beginPath();
            canvas.arc(static_cast<float>(x), static_cast<float>(y), radius, 0,
                       static_cast<float>(kTau));
            canvas.fill();
        };
        dot(r * 3.0f, 0xFFAC45u, 0.17 * fade);
        if (i % 4 == 0) {
            ui::setFill(canvas, 0xFFF4CEu, 0.4 * fade * fade);
            canvas.fillRect(static_cast<float>(x - r * 2.2), static_cast<float>(y - 0.35),
                            r * 4.4f, 0.7f);
            canvas.fillRect(static_cast<float>(x - 0.35), static_cast<float>(y - r * 2.2),
                            0.7f, r * 4.4f);
        }
        dot(r, 0xFFF4CEu, 0.9 * fade);
    }
    ui::text(canvas, label, 0, 0, title);
    // Highlight the prefix without recording a second selectable text run.
    title.fill = 0xFFF8DDu;
    ui::paintRun(canvas, "19k", pen.x, pen.y, title);
    canvas.restore();
}

namespace {

// --- chat bubbles ----------------------------------------------------------
//
// The reference's geometry (rysteria_gardn Client/Render/RenderChat.cc and
// Server/Process/Chat.cc), in world units: an 18-unit line inside a pill three
// units taller on each side, floating 45 units clear of the speaker's body
// with each older line 28 units above the one under it.
constexpr double kChatBubbleTextSize = 18.0;
constexpr double kChatBubblePadding = 3.0;      ///< pill half-height minus half the text
constexpr double kChatBubbleGap = 45.0;         ///< clear of the body's edge
constexpr double kChatBubbleRowStep = 28.0;     ///< one row to the next
/// The pill is the flower's own yellow at the reference's 0xc0 alpha, so a
/// bubble reads as coming off the body it sits over.
constexpr std::uint32_t kChatBubbleFill = 0xFFE763u;
constexpr double kChatBubbleFillAlpha = 0.75;   // 0xc0/255
/// A retiring bubble grows as it fades, which is what the reference's
/// `scale(1 + 0.5 * deletion_animation)` does.
constexpr double kChatBubbleExitScale = 0.5;

constexpr double kPetalHitSize = 10.0;

/// A mob's plate, as florr draws it (~/florr_images/client: descriptor
/// 0x10078c0e0, painter 0x10078cb60), in world units. The bar is a line
/// 80 + 10 x tier long whatever the mob's size, stroked with round caps: a
/// #222222 track kMobBarThickness wide, the red at 0.6 of that, the green at
/// 0.7 and the shield's white at 0.5, each starting at the line's left end.
constexpr double kMobBarBaseLength = 80.0;
constexpr double kMobBarLengthPerTier = 10.0;
constexpr double kMobBarThickness = 10.0;
constexpr double kMobBarLagWidth = 0.6;
constexpr double kMobBarHealthWidth = 0.7;
constexpr double kMobBarShieldWidth = 0.5;
constexpr std::uint32_t kMobBarTrack = 0x222222u;
constexpr std::uint32_t kMobBarLag = 0xDD3434u;
/// florr's `min(fraction * 30, 1)`: a line fades in over its first thirtieth,
/// so an empty one is not a round dot.
constexpr double kMobBarFadeIn = 30.0;
/// Below this the shield's line is not drawn at all.
constexpr double kMobBarShieldMin = 0.0001;
/// How far below the bottom of a mob's hitbox the top of its bar's track
/// sits. florr hangs it lower (track top at radius + 25, plus a per-mob nudge
/// for a few long bodies); this game keeps it ten units under the hitbox.
constexpr double kMobBarGap = 10.0;

/// florr's labels: the name 16 units, white, above the bar; the tier (and a
/// summon's "Summon") 14 units, under it. Text sits on its vertical centre.
/// The name's centre is 0.7 x 16 + 4 above the bar's line and the row
/// under it 0.7 x 16 below -- both off the NAME's size, as florr has it.
constexpr double kMobNameSize = 16.0;
constexpr double kMobTierSize = 14.0;
constexpr double kMobNameRaise = 0.7 * kMobNameSize + 4.0;
constexpr double kMobTierDrop = 0.7 * kMobNameSize;
/// The DPS line under a target dummy's tier: our own, one florr line (1.4 x
/// its size) below the tier.
constexpr double kMobDpsDrop = kMobTierDrop + 1.4 * kMobTierSize;

/// What a summon's plate says it is, at the left of the tier row.
constexpr const char* kPetLabel = "Summon";

/// Where a flower's bar goes: the one slot under the body, in screen pixels.
///
/// Shared by the plate every other flower wears and by the viewer's own mana
/// bar, which stands in that exact slot now that the local plate is gone. Two
/// copies of these numbers is how the two would end up a pixel apart at one
/// zoom level and nowhere near each other at another.
struct PlateBar {
    double zoom = 1;
    double centreX = 0;
    double left = 0;
    double right = 0;
    double top = 0;
    double width = 0;
    double height = 0;
};

/// `size` is the flower's drawn size multiplier, passed in because the slot
/// hangs off the BODY: a grown flower's bar sits lower.
PlateBar plateBar(double size, const Camera& camera, Vec2 at) {
    PlateBar bar;
    bar.zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    // Every number here is a world unit, laid out exactly as the browser build
    // lays it out inside the camera transform. The whole plate sits BELOW the
    // flower centre.
    bar.centreX = screen.x;
    bar.top = screen.y + (kPlayerBaseRadius * size + 24.0) * bar.zoom;
    bar.left = screen.x - 30.0 * bar.zoom;
    bar.right = screen.x + 30.0 * bar.zoom;
    bar.width = 60.0 * bar.zoom;
    bar.height = 8.0 * bar.zoom;
    return bar;
}

/// The health bar in this slot: the fill box, and the dark backing every bar
/// here sits in -- one unit proud of the fill on every side.
ui::HealthBar plateHealthBar(const PlateBar& bar) {
    ui::HealthBar health;
    health.x = bar.left;
    health.y = bar.top;
    health.width = bar.width;
    health.height = bar.height;
    health.plateX = bar.centreX - 31.0 * bar.zoom;
    health.plateY = bar.top - bar.zoom;
    health.plateWidth = 62.0 * bar.zoom;
    health.plateHeight = 10.0 * bar.zoom;
    health.plateRadius = 5.0 * bar.zoom;
    return health;
}

/// The same backing as a path, for the mana bar to be punched out of.
void plateBarBack(Path2D& path, const PlateBar& bar) {
    const ui::HealthBar back = plateHealthBar(bar);
    path.roundRect(static_cast<float>(back.plateX), static_cast<float>(back.plateY),
                   static_cast<float>(back.plateWidth), static_cast<float>(back.plateHeight),
                   static_cast<float>(back.plateRadius));
}

} // namespace

void WorldRenderer::drawSelfManaBar(Canvas& canvas, const RemoteEntity& entity,
                                    const Camera& camera, Vec2 at) const {
    // No pool, no bar. Most flowers wear nothing that grants one, and an empty
    // strip under the body on every one of them is furniture that says only
    // "this game has mana in it".
    if (selfState_ == nullptr || !(selfState_->maxMana > 0.0)) return;

    // NOT gated on options.healthBars. That option is about reading OTHER
    // bodies -- a stranger's flower, a mob's -- and this is the viewer's own
    // resource readout, the one thing in this slot they cannot get anywhere
    // else now that it is off the HUD.
    const PlateBar bar = plateBar(playerSizeMultiplier(entity), camera, at);
    const double fraction = clamp(selfState_->mana / selfState_->maxMana, 0.0, 1.0);
    const double fillWidth = bar.width * fraction;

    // Punched rather than stacked, under one alpha, exactly as the health bar
    // in this slot is: laying a fill over a plate blends both twice.
    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(ui::kHudLayerAlpha));

    const auto fillRect = [&](Path2D& path) {
        path.roundRect(static_cast<float>(bar.left), static_cast<float>(bar.top),
                       static_cast<float>(fillWidth), static_cast<float>(bar.height),
                       static_cast<float>(bar.height * 0.5));
    };

    Path2D plate;
    plateBarBack(plate, bar);
    if (fillWidth > 0) fillRect(plate);
    ui::setFill(canvas, ui::kHealthBack);
    canvas.fill(plate, fillWidth > 0 ? "evenodd" : "nonzero");

    if (fillWidth > 0) {
        Path2D fill;
        fillRect(fill);
        // The cyan petals.json paints every magic petal in, so the bar and the
        // petals that feed it read as one thing.
        ui::setFill(canvas, ui::kMana);
        canvas.fill(fill);
    }

    canvas.restore();
}

void WorldRenderer::drawPlayerPlate(Canvas& canvas, const RemoteEntity& entity,
                                    const Camera& camera, Vec2 at, double timeSeconds) const {
    const PlateBar bar = plateBar(playerSizeMultiplier(entity), camera, at);
    const double zoom = bar.zoom;
    const double barY = bar.top;
    const double left = bar.left;
    const double right = bar.right;

    if (options.names) {
        ui::TextStyle style;
        style.size = 12.0 * zoom;
        style.align = ui::Align::Left;
        // The browser build never sets a baseline in the world pass, so the
        // pen sits on the alphabetic baseline.
        style.baseline = ui::Baseline::Alphabetic;
        ui::text(canvas, entity.name.empty() ? "Unnamed" : entity.name, left,
                 barY - 4.0 * zoom, style);
    }

    if (options.healthBars) {
        // Always drawn, even at full health: the bar is part of how a flower
        // reads, not a warning that appears once you are hurt.
        //
        // rysteria's bar in the black plate this slot has always had: the red
        // of what was just lost, the green -- tinted while spawn protection
        // lasts -- and the white shield line. A MOB's is the same bar with no
        // shield in it. Under one alpha, like everything in this slot.
        ui::HealthBar health = plateHealthBar(bar);
        health.health = entity.healthBar.health;
        health.lag = entity.healthBar.lag;
        health.shield = entity.healthBar.shield;
        health.fill = healthBarColor(entity, timeSeconds);
        canvas.save();
        canvas.setGlobalAlpha(static_cast<float>(ui::kHudLayerAlpha));
        ui::healthBar(canvas, health);
        canvas.restore();
    }

    if (options.names) {
        ui::TextStyle level;
        level.size = 10.0 * zoom;
        level.align = ui::Align::Right;
        level.baseline = ui::Baseline::Alphabetic;
        // Tinted with the best rarity anywhere in that flower's loadout, which
        // is how a passing flower advertises what it is carrying.
        level.fill = rarityColor(entity.bestRarity);
        ui::text(canvas, "Lv. " + std::to_string(entity.level), right, barY + 20.0 * zoom,
                 level);

        // The guild tag mirrors the level label on the other side of the bar,
        // one point smaller so a five-character id and its brackets cannot
        // collide with it.
        if (!entity.guildName.empty()) {
            ui::TextStyle tag;
            tag.size = 8.0 * zoom;
            tag.align = ui::Align::Left;
            tag.baseline = ui::Baseline::Alphabetic;
            tag.fill = 0x27DADEu;
            ui::text(canvas, "[" + entity.guildName + "]", left, barY + 20.0 * zoom, tag);
        }
    }
}

void WorldRenderer::drawChatBubbles(Canvas& canvas, const EntityMap& entities,
                                    const Camera& camera, Vec2 selfDrawn) const {
    if (chatBubbles_ == nullptr) return;
    const double zoom = camera.zoom();

    for (const ChatBubble& bubble : chatBubbles_->all()) {
        // A bubble is anchored to a body, not to a place: it has nowhere to be
        // while its speaker is out of the stream or lying dead, and it ages on
        // regardless so it cannot reappear stale.
        const auto found = entities.find(bubble.speakerNetId);
        if (found == entities.end()) continue;
        const RemoteEntity& speaker = found->second;
        if (speaker.kind != net::EntityKind::Player || speaker.dead()) continue;

        // The same position rule the entity pass uses, so the bubble tracks the
        // flower exactly rather than lagging it by the viewer's own ease.
        const Vec2 at = speaker.isSelf() ? selfDrawn : speaker.position;
        const Vec2 screen = camera.worldToScreen(at);

        const double alpha = ChatBubbles::fade(bubble);
        if (alpha <= 0.0) continue;
        // Grows as it goes, about its own centre.
        const double scale = 1.0 + kChatBubbleExitScale * (1.0 - alpha);

        // Clear of the DRAWN body, not the hitbox: the artwork is what the
        // player sees the bubble sitting over, and the two differ by the size
        // modifiers a loadout carries.
        const double bodyRadius = kFlowerArtRadius * playerSizeMultiplier(speaker);
        // The title sits 12 units above the body and its motes rise another
        // 30; leave the bubble clear even when the flower grows.
        const double gap = speaker.equippedSkinId == kFanSkinId
                               ? std::max(kChatBubbleGap, 42.0 * playerSizeMultiplier(speaker) + 20.0)
                               : kChatBubbleGap;
        const double lift = bodyRadius + gap + bubble.row * kChatBubbleRowStep;
        const double centreY = screen.y - lift * zoom;

        const double textSize = kChatBubbleTextSize * zoom * scale;
        if (textSize < 1.0) continue;   // too far to read, and too small to cost a path
        const double pillHeight = (kChatBubbleTextSize + 2.0 * kChatBubblePadding) * zoom * scale;
        const double textWidth = ui::textWidth(canvas, bubble.text, textSize);
        // The reference draws the pill as one round-capped stroke, so the caps
        // add half its height at each end; a rounded rect of the same radius is
        // the same shape without a line-cap join to rasterize.
        const double pillWidth = textWidth + pillHeight;

        // Against the camera's viewport, which is in DESIGN units -- the space
        // worldToScreen answers in. canvas.width() is a pixel count, and on a
        // window the base transform is scaling down it is the smaller number,
        // so culling against it drops bubbles that are on screen.
        if (screen.x + pillWidth * 0.5 < 0 ||
            screen.x - pillWidth * 0.5 > camera.viewportWidth() ||
            centreY + pillHeight < 0 || centreY - pillHeight > camera.viewportHeight()) {
            continue;
        }

        // One alpha over the pill AND its text: a bubble fades as one object,
        // and tinting the two separately leaves the letters hanging in the air
        // after the pill under them has gone.
        canvas.save();
        if (alpha < 1.0) canvas.setGlobalAlpha(static_cast<float>(alpha));

        ui::setFill(canvas, kChatBubbleFill, kChatBubbleFillAlpha);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(screen.x - pillWidth * 0.5),
                         static_cast<float>(centreY - pillHeight * 0.5),
                         static_cast<float>(pillWidth), static_cast<float>(pillHeight),
                         static_cast<float>(pillHeight * 0.5));
        canvas.fill();

        ui::TextStyle style;
        style.size = textSize;
        style.align = ui::Align::Centre;
        style.baseline = ui::Baseline::Middle;
        ui::text(canvas, bubble.text, screen.x, centreY, style);
        canvas.restore();
    }
}

void WorldRenderer::drawHitbox(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                              Vec2 at) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);

    // A flower and its petals are the two things whose drawn size deliberately
    // differs from what they collide with, so both are shown in the browser
    // build's red at 2px. Everything else keeps the generic overlay.
    double radius = entity.radius * zoom;
    std::uint32_t color = 0xFF0000u;
    if (entity.kind == net::EntityKind::Player) {
        radius = kPlayerBaseRadius * playerSizeMultiplier(entity) * zoom;
    } else if (entity.kind == net::EntityKind::Petal && content_) {
        // A flower's petal collides at 10 units per size unit whatever its
        // artwork does; a mob's ring seed collides at the radius the server
        // gave it, which is scaled by the mob it grew on.
        radius = entity.isRingPetal() || entity.isLoosePetal()
                     ? entity.radius * zoom
                     : kPetalHitSize * content_->petal(entity.typeIndex).size * zoom;
    } else if (entity.kind == net::EntityKind::Mob || entity.kind == net::EntityKind::Npc) {
        // A mob's circle is its COLLISION size, drawn in its own tier colour:
        // visual_scale moves the artwork and never the body. An NPC is a
        // mob's body, so it is outlined the same way.
        color = rarityColor(entity.rarity);
    } else if (entity.kind == net::EntityKind::Drop) {
        // A drop is picked up by walking a square over it, so its overlay is
        // the browser build's yellow 30-unit box rather than a circle.
        ui::setStroke(canvas, 0xFFFF00u);
        canvas.setLineWidth(static_cast<float>(2.0 * zoom));
        canvas.beginPath();
        canvas.rect(static_cast<float>(screen.x - 15.0 * zoom),
                    static_cast<float>(screen.y - 15.0 * zoom),
                    static_cast<float>(30.0 * zoom), static_cast<float>(30.0 * zoom));
        canvas.stroke();
        return;
    } else if (entity.kind == net::EntityKind::Projectile) {
        color = 0x00FFFFu;
    } else {
        ui::setStroke(canvas, 0xFF00FFu, 0.7);
        canvas.setLineWidth(1.5f);
        canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                            static_cast<float>(radius));
        return;
    }

    ui::setStroke(canvas, color);
    canvas.setLineWidth(static_cast<float>(2.0 * zoom));
    canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                        static_cast<float>(radius));
}

void WorldRenderer::drawMobLabel(Canvas& canvas, const Camera& camera, const MobDraw& mob) const {
    // The plate fades in with the mob and out once a chain bead heals: florr
    // multiplies everything on it, text included, by one eased opacity.
    if (mob.plateOpacity <= 0.0) return;
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(mob.position);
    const MobConfig* config = content_ ? &content_->mob(mob.typeIndex) : nullptr;
    // A chain's body bead is florr's one unlabelled mob: a bar, and no name,
    // tier or "Summon" to go with it.
    const bool labelled = config == nullptr || !config->chainBody;

    // Everything below is in world units off the mob's centre, scaled by the
    // zoom where it is drawn. The bar's length is florr's 80 + 10 per tier
    // whatever the body's size; its LINE is where the strokes run, with the
    // round caps standing half a thickness past both ends.
    const double length =
        kMobBarBaseLength + kMobBarLengthPerTier * static_cast<int>(mob.rarity);
    const double halfSpan = (length + kMobBarThickness) * 0.5;
    const double lineY = mob.radius + kMobBarGap + kMobBarThickness * 0.5;
    const auto sx = [&](double x) { return screen.x + x * zoom; };
    const auto sy = [&](double y) { return screen.y + y * zoom; };

    const double base = canvas.globalAlpha();
    const double opacity = std::min(mob.plateOpacity, 1.0);
    canvas.save();

    if (options.healthBars) {
        // An NPC's plate is a mob's plate with the bar in its invulnerable
        // state: full whatever the wire says -- which is what the server keeps
        // it at anyway -- in the pale yellow a flower's bar turns under
        // respawn protection, the one colour this game already spends on
        // "cannot be hurt". Green sitting at full would read as "not hurt
        // yet", which on a dummy taking a flood of numbers is the difference
        // between a working dummy and a bug. An intangible mob (the fire ant
        // hole) is the same promise: its brood is what you fight, not it.
        const bool invulnerable = mob.npc || (config != nullptr && config->intangible);
        const double health = invulnerable ? 1.0 : clamp(mob.barHealth, 0.0, 1.0);
        const double lag = invulnerable ? 0.0 : clamp(mob.barLag, 0.0, 1.0);
        const double shield = invulnerable ? 0.0 : clamp(mob.barShield, 0.0, 1.0);
        const auto fade = [](double share) { return std::min(share * kMobBarFadeIn, 1.0); };
        // One of florr's round-capped strokes along the line, from its left
        // end, filled as the capsule it covers: the same pixels, with no line
        // cap for the web canvas to carry (ui::healthBar does the same).
        const auto stroke = [&](double share, double width, std::uint32_t colour, double alpha) {
            if (alpha <= 0.0) return;
            const double w = width * zoom;
            canvas.setGlobalAlpha(static_cast<float>(base * opacity * alpha));
            ui::setFill(canvas, colour);
            Path2D path;
            path.roundRect(static_cast<float>(sx(-length * 0.5) - w * 0.5),
                           static_cast<float>(sy(lineY) - w * 0.5),
                           static_cast<float>(length * share * zoom + w), static_cast<float>(w),
                           static_cast<float>(w * 0.5));
            canvas.fill(path);
        };
        // Bottom to top, in florr's order. Each line is blended on its own at
        // the plate's opacity, as florr's are, rather than as one layer.
        stroke(1.0, kMobBarThickness, kMobBarTrack, 1.0);
        stroke(lag, kMobBarThickness * kMobBarLagWidth, kMobBarLag, fade(lag));
        stroke(health, kMobBarThickness * kMobBarHealthWidth,
               invulnerable ? kInvulnerableHealth : ui::kHealth, fade(health));
        if (shield > kMobBarShieldMin) {
            stroke(shield, kMobBarThickness * kMobBarShieldWidth, ui::kPaper, fade(shield));
        }
    }

    canvas.setGlobalAlpha(static_cast<float>(base * opacity));
    // florr's Text pads a run by its outline -- 2 x int(2 x size x 0.12) --
    // and lays the padded box out, with the glyphs centred in it. Measured at
    // design size: text scales with the zoom, so the layout holds at any zoom.
    const auto pad = [](double size) { return 2.0 * std::floor(2.0 * size * ui::kTextStrokeRatio); };
    // One label whose padded box starts at `boxLeft`.
    const auto label = [&](const std::string& text, double size, std::uint32_t fill,
                           double boxLeft, double y) {
        ui::TextStyle style;
        style.size = size * zoom;
        style.fill = fill;
        style.align = ui::Align::Left;
        style.baseline = ui::Baseline::Middle;
        ui::text(canvas, text, sx(boxLeft + pad(size) * 0.5), sy(y), style);
    };
    const auto boxWidth = [&](const std::string& text, double size) {
        return ui::textWidth(canvas, text, size) + pad(size);
    };

    if (labelled && options.names) {
        // Above the bar, from the left end of its track -- or, when the name is
        // longer than the whole track, centred over it.
        static const std::string kUnknownMob = "?";
        const std::string& name = config ? config->name : kUnknownMob;
        const double nameBox = boxWidth(name, kMobNameSize);
        label(name, kMobNameSize, ui::kPaper, nameBox >= halfSpan * 2.0 ? -nameBox * 0.5 : -halfSpan,
              lineY - kMobNameRaise);
    }

    // The row under the bar: "Summon" from the track's left end and the tier
    // flush with its right one. florr keeps "Summon" left of the middle and
    // starts the tier at least one unit after it, pushing it past the end of
    // the track rather than letting the two words run together.
    //
    // A summon looks exactly like the wild animal it was hatched from, so its
    // plate is the one place that can tell a player which of two ladybugs is
    // on their side. Drawn whenever any of the plate is: it captions the bar,
    // and it is also part of what the mob is called, so either option alone
    // still has to say whose it is.
    const double rowY = lineY + kMobTierDrop;
    double tierFloor = -1e300;
    if (labelled && mob.pet && (options.healthBars || options.names)) {
        const std::string summon = kPetLabel;
        const double box = boxWidth(summon, kMobTierSize);
        const double left = std::min(-halfSpan, -1.0 - box);
        label(summon, kMobTierSize, kPetLabelColor, left, rowY);
        tierFloor = left + box + 1.0;
    }
    if (labelled && options.names) {
        const std::string tier = rarityLabel(mob.rarity);
        const double box = boxWidth(tier, kMobTierSize);
        label(tier, kMobTierSize, rarityColor(mob.rarity), std::max(tierFloor, halfSpan - box),
              rowY);
    }

    // The dummy is the one mob that reports what it is being hit for -- by
    // this viewer -- and it reports a zero rather than disappearing when
    // nothing is hitting it.
    if (config && config->id == "target_dummy") {
        double total = 0;
        const auto damage = dummyDamage_.find(mob.netId);
        if (damage != dummyDamage_.end()) {
            for (const auto& sample : damage->second) total += sample.second;
        }
        const std::string dps = "DPS: " + ui::formatCompact(total / kDpsWindowSeconds);
        label(dps, kMobTierSize, ui::kPaper, halfSpan - boxWidth(dps, kMobTierSize),
              lineY + kMobDpsDrop);
    }
    canvas.restore();
}

} // namespace flix
