#include "client/render/world_renderer.h"

#include <algorithm>
#include <cmath>

#include "client/ui/draw.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/terrain.h"

namespace flr {

namespace {

/// How long a floating number lives and how far it drifts. Long enough to read
/// in a fight, short enough that a busy screen clears.
constexpr double kNumberLifeSeconds = 0.9;
constexpr double kNumberRise = 42.0;
constexpr double kPuffLifeSeconds = 0.35;

/// Biome ground colours, indexed by map section. Flat fills rather than
/// textures: the game reads better with the entities carrying all the detail.
constexpr std::uint32_t kBiomeGround[kSectionCount] = {
    0x1D8348u,  // garden
    0x17A05Cu,  // meadow
    0x0E6B3Au,  // deep garden
    0xC2A76Bu,  // desert
    0xB8985Fu,  // dunes
    0xD4BC85u,  // salt flat
    0x1B6E8Cu,  // shallows
    0x14566Bu,  // ocean
    0x0E3D4Fu,  // trench
};

constexpr std::uint32_t kTileColor(Tile tile, std::uint32_t ground) {
    switch (tile) {
        case Tile::Wall:  return 0x4A4A4Au;
        case Tile::Water: return 0x2A7FB8u;
        case Tile::Sand:  return 0xD9C08Cu;
        case Tile::Stone: return 0x6E6E6Eu;
        default: return ground;
    }
}

std::string formatDamage(double value) {
    const long rounded = static_cast<long>(value + 0.5);
    if (rounded < 1000) return std::to_string(rounded);
    // Big numbers are the norm at high rarity; the exact digits stop mattering
    // long before they stop taking up screen space.
    if (rounded < 1000000) {
        char buf[24];
        std::snprintf(buf, sizeof buf, "%.1fk", value / 1000.0);
        return buf;
    }
    char buf[24];
    std::snprintf(buf, sizeof buf, "%.1fm", value / 1000000.0);
    return buf;
}

} // namespace

void WorldRenderer::ingestEvents(WorldView& view) {
    for (const ViewEvent& event : view.events()) {
        if (effects_.size() >= maxEffects) break;

        switch (event.kind) {
            case net::EventKind::Damage: {
                Effect e;
                e.kind = Effect::Kind::DamageNumber;
                e.position = event.position;
                // Scatter horizontally so simultaneous hits on one target do
                // not stack into an unreadable pile.
                e.drift = {(static_cast<double>(effects_.size() % 5) - 2.0) * 8.0, -kNumberRise};
                e.value = event.amount;
                e.color = event.flag ? 0xFFE65Du : 0xFFFFFFu;
                e.lifeSeconds = kNumberLifeSeconds;
                effects_.push_back(e);
                break;
            }
            case net::EventKind::Heal: {
                Effect e;
                e.kind = Effect::Kind::HealNumber;
                e.position = event.position;
                e.drift = {0, -kNumberRise};
                e.value = event.amount;
                e.color = 0x7EEF6Du;
                e.lifeSeconds = kNumberLifeSeconds;
                effects_.push_back(e);
                break;
            }
            case net::EventKind::Killed: {
                Effect e;
                e.kind = Effect::Kind::Puff;
                e.position = event.position;
                e.radius = 26;
                e.color = 0xFFFFFFu;
                e.lifeSeconds = kPuffLifeSeconds;
                effects_.push_back(e);
                break;
            }
            case net::EventKind::Explosion: {
                Effect e;
                e.kind = Effect::Kind::Ripple;
                e.position = event.position;
                e.radius = event.radius > 0 ? event.radius : 60;
                e.color = 0xFF8A3Du;
                e.lifeSeconds = 0.4;
                effects_.push_back(e);
                break;
            }
            default:
                break;
        }
    }
    view.events().clear();
}

void WorldRenderer::update(double dt) {
    for (Effect& e : effects_) e.ageSeconds += dt;
    effects_.erase(std::remove_if(effects_.begin(), effects_.end(),
                                  [](const Effect& e) { return e.ageSeconds >= e.lifeSeconds; }),
                   effects_.end());
}

void WorldRenderer::drawTerrain(Canvas& canvas, const Camera& camera) const {
    const Rect visible = camera.visibleWorld(kTileSize);

    if (!terrain_) {
        ui::setFill(canvas, kBiomeGround[0]);
        canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                        static_cast<float>(camera.viewportHeight()));
        return;
    }

    const int x0 = std::max(0, static_cast<int>(std::floor(visible.x / kTileSize)));
    const int y0 = std::max(0, static_cast<int>(std::floor(visible.y / kTileSize)));
    const int x1 = std::min(kTilesPerAxis, static_cast<int>(std::ceil(visible.right() / kTileSize)));
    const int y1 = std::min(kTilesPerAxis, static_cast<int>(std::ceil(visible.bottom() / kTileSize)));

    // Everything outside the map is the void colour, so the world edge reads as
    // a boundary rather than as missing terrain.
    ui::setFill(canvas, 0x101418u);
    canvas.fillRect(0, 0, static_cast<float>(camera.viewportWidth()),
                    static_cast<float>(camera.viewportHeight()));

    const double zoom = camera.zoom();
    // One extra pixel of overlap: adjacent tiles drawn at fractional positions
    // otherwise leave hairline seams that shimmer as the camera moves.
    const double overlap = 1.0;

    for (int ty = y0; ty < y1; ++ty) {
        for (int tx = x0; tx < x1; ++tx) {
            const Tile tile = terrain_->atTile(tx, ty);
            const Vec2 world{tx * kTileSize, ty * kTileSize};
            const int section = sectionAt({world.x + kTileSize * 0.5, world.y + kTileSize * 0.5});
            const std::uint32_t ground =
                section >= 0 ? kBiomeGround[section] : kBiomeGround[0];

            const Vec2 screen = camera.worldToScreen(world);
            ui::setFill(canvas, kTileColor(tile, ground));
            canvas.fillRect(static_cast<float>(screen.x), static_cast<float>(screen.y),
                            static_cast<float>(kTileSize * zoom + overlap),
                            static_cast<float>(kTileSize * zoom + overlap));
        }
    }

    // Wall faces get a darker top edge, which is what stops a flat tile grid
    // reading as a texture and makes walls look like obstacles.
    for (int ty = y0; ty < y1; ++ty) {
        for (int tx = x0; tx < x1; ++tx) {
            if (!tileBlocks(terrain_->atTile(tx, ty))) continue;
            if (ty > 0 && tileBlocks(terrain_->atTile(tx, ty - 1))) continue;
            const Vec2 screen = camera.worldToScreen({tx * kTileSize, ty * kTileSize});
            ui::setFill(canvas, 0x333333u);
            canvas.fillRect(static_cast<float>(screen.x), static_cast<float>(screen.y),
                            static_cast<float>(kTileSize * zoom + overlap),
                            static_cast<float>(std::max(2.0, 6.0 * zoom)));
        }
    }
}

void WorldRenderer::drawFlower(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    const double radius = entity.radius * zoom;

    const bool hurt = (entity.state & net::StateHurt) != 0;
    const std::uint32_t body = hurt ? 0xFFFFFFu : 0xFFE763u;

    ui::disc(canvas, screen, radius, body, 0xCFB93Fu, ui::outlineFor(radius * 2));

    // The face. Eyes track nothing -- a fixed, slightly forward-set pair reads
    // as alive without implying a direction the flower does not actually have.
    const double eyeOffsetX = radius * 0.34;
    const double eyeOffsetY = radius * 0.16;
    const double eyeW = radius * 0.16;
    const double eyeH = radius * 0.30;

    ui::setFill(canvas, 0x111111u);
    for (int side = -1; side <= 1; side += 2) {
        canvas.beginPath();
        canvas.ellipse(static_cast<float>(screen.x + side * eyeOffsetX),
                       static_cast<float>(screen.y - eyeOffsetY),
                       static_cast<float>(eyeW), static_cast<float>(eyeH),
                       0.0f, 0.0f, static_cast<float>(kTau), false);
        canvas.fill();
    }

    // A simple smile, flattening while the player is hurt.
    const double mouthWidth = radius * 0.46;
    const double mouthDrop = hurt ? radius * 0.06 : radius * 0.26;
    ui::setStroke(canvas, 0x111111u);
    canvas.setLineWidth(static_cast<float>(std::max(1.5, radius * 0.09)));
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(screen.x - mouthWidth),
                  static_cast<float>(screen.y + radius * 0.24));
    canvas.quadraticCurveTo(static_cast<float>(screen.x),
                            static_cast<float>(screen.y + radius * 0.24 + mouthDrop),
                            static_cast<float>(screen.x + mouthWidth),
                            static_cast<float>(screen.y + radius * 0.24));
    canvas.stroke();

    if (!entity.name.empty()) {
        ui::TextStyle style;
        style.size = std::max(10.0, 15.0 * zoom);
        style.align = ui::Align::Centre;
        style.baseline = ui::Baseline::Bottom;
        ui::text(canvas, entity.name, screen.x, screen.y - radius - 10.0 * zoom, style);
    }

    (void)timeSeconds;
}

void WorldRenderer::drawHealthBar(Canvas& canvas, const RemoteEntity& entity,
                                  const Camera& camera, Vec2 at) const {
    // A full bar is noise: only show one once something has actually been lost.
    if (entity.healthFraction >= 0.999) return;

    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    const double radius = entity.radius * zoom;
    const double width = std::max(28.0, radius * 2.2);
    const double height = std::max(5.0, radius * 0.20);

    Rect box{screen.x - width * 0.5, screen.y + radius + 6.0 * zoom, width, height};
    ui::bar(canvas, box, entity.healthFraction,
            entity.kind == net::EntityKind::Player ? ui::kHealth : 0x8BE05Au);
}

void WorldRenderer::drawEntity(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    const double radius = entity.radius * zoom;

    switch (entity.kind) {
        case net::EntityKind::Player:
            drawFlower(canvas, entity, camera, at, timeSeconds);
            break;

        case net::EntityKind::Mob: {
            double rotation = entity.angle;
            double visualScale = 1.0;
            std::uint32_t fallback = 0xB0B0B0u;
            if (content_) {
                const MobConfig& config = content_->mob(entity.typeIndex);
                if (config.hideRotation) rotation = 0;
                visualScale = config.visualScale > 0 ? config.visualScale : 1.0;
                fallback = config.colorRgba >> 8;
            }
            const double diameter = radius * 2.0 * visualScale;

            if (sprites_ && sprites_->mobDrawable(entity.typeIndex)) {
                canvas.save();
                if ((entity.state & net::StateHurt) != 0) {
                    // A white wash over the sprite, rather than tinting the
                    // artwork, so every mob flashes identically regardless of
                    // what colours its SVG uses.
                    sprites_->drawMob(canvas, entity.typeIndex, screen.x, screen.y, diameter,
                                      rotation, timeSeconds);
                    canvas.setGlobalAlpha(0.55f);
                    ui::disc(canvas, screen, radius, 0xFFFFFFu, 0xFFFFFFu, 0);
                    canvas.setGlobalAlpha(1.0f);
                } else {
                    sprites_->drawMob(canvas, entity.typeIndex, screen.x, screen.y, diameter,
                                      rotation, timeSeconds);
                }
                canvas.restore();
            } else {
                ui::disc(canvas, screen, radius, fallback);
            }

            // Rarity ring: the fastest read of how dangerous something is.
            if (entity.rarity != Rarity::Common) {
                ui::setStroke(canvas, rarityColor(entity.rarity));
                canvas.setLineWidth(static_cast<float>(std::max(2.0, radius * 0.10)));
                canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                    static_cast<float>(radius + 3.0 * zoom));
            }
            drawHealthBar(canvas, entity, camera, at);
            break;
        }

        case net::EntityKind::Petal: {
            const double diameter = radius * 2.0;
            if (sprites_ && sprites_->petalDrawable(entity.typeIndex)) {
                sprites_->drawPetal(canvas, entity.typeIndex, screen.x, screen.y, diameter,
                                    entity.angle, timeSeconds);
            } else {
                ui::disc(canvas, screen, radius, 0xFFFFFFu, 0xD9D9D9u);
            }
            break;
        }

        case net::EntityKind::Projectile:
            ui::disc(canvas, screen, std::max(2.0, radius), rarityColor(entity.rarity), ui::kInk,
                     std::max(1.0, radius * 0.25));
            break;

        case net::EntityKind::Drop: {
            // Drops sit on a rarity-coloured plate so they read as loot at a
            // glance, with the petal art on top.
            const double plate = std::max(12.0, radius * 1.6);
            ui::plate(canvas,
                      Rect{screen.x - plate, screen.y - plate, plate * 2, plate * 2},
                      rarityColor(entity.rarity), plate * 0.3);
            if (sprites_ && sprites_->petalDrawable(entity.typeIndex)) {
                sprites_->drawPetal(canvas, entity.typeIndex, screen.x, screen.y, plate * 1.2,
                                    0.0, timeSeconds);
            }
            break;
        }

        case net::EntityKind::Effect: {
            const std::uint32_t tint = 0x9B59B6u;
            ui::setFill(canvas, tint, 0.22);
            canvas.fillCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                              static_cast<float>(radius));
            ui::setStroke(canvas, tint, 0.5);
            canvas.setLineWidth(2.0f);
            canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                static_cast<float>(radius));
            break;
        }
    }
}

void WorldRenderer::drawEffects(Canvas& canvas, const Camera& camera) const {
    const double zoom = camera.zoom();

    for (const Effect& e : effects_) {
        const double t = clamp(e.ageSeconds / e.lifeSeconds, 0.0, 1.0);

        switch (e.kind) {
            case Effect::Kind::DamageNumber:
            case Effect::Kind::HealNumber: {
                const Vec2 world{e.position.x + e.drift.x * t, e.position.y + e.drift.y * t};
                const Vec2 screen = camera.worldToScreen(world);
                ui::TextStyle style;
                style.size = std::max(11.0, ui::kDamageSize * zoom);
                style.fill = e.color;
                style.align = ui::Align::Centre;
                style.bold = true;
                // Fade only over the last third: fading from the start makes
                // the number unreadable exactly when it matters.
                canvas.setGlobalAlpha(static_cast<float>(t < 0.66 ? 1.0 : (1.0 - t) / 0.34));
                ui::text(canvas,
                         (e.kind == Effect::Kind::HealNumber ? "+" : "") + formatDamage(e.value),
                         screen.x, screen.y, style);
                canvas.setGlobalAlpha(1.0f);
                break;
            }
            case Effect::Kind::Puff: {
                const Vec2 screen = camera.worldToScreen(e.position);
                ui::setStroke(canvas, e.color, 1.0 - t);
                canvas.setLineWidth(static_cast<float>(std::max(1.5, 4.0 * (1.0 - t) * zoom)));
                canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                    static_cast<float>(e.radius * (0.4 + t) * zoom));
                break;
            }
            case Effect::Kind::Ripple: {
                const Vec2 screen = camera.worldToScreen(e.position);
                ui::setStroke(canvas, e.color, (1.0 - t) * 0.8);
                canvas.setLineWidth(static_cast<float>(std::max(2.0, 6.0 * (1.0 - t) * zoom)));
                canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                    static_cast<float>(e.radius * t * zoom));
                break;
            }
        }
    }
}

void WorldRenderer::draw(Canvas& canvas, const WorldView& view, const Camera& camera,
                         Vec2 predictedSelf, double timeSeconds) const {
    draw(canvas, view.entities(), camera, predictedSelf, timeSeconds);
}

void WorldRenderer::draw(Canvas& canvas, const EntityMap& entities, const Camera& camera,
                         Vec2 predictedSelf, double timeSeconds) const {
    drawTerrain(canvas, camera);

    const Rect visible = camera.visibleWorld(200);

    // Draw order is by kind, not by position: ground effects under everything,
    // players over mobs so a crowded fight never hides the thing you control.
    static constexpr net::EntityKind kOrder[] = {
        net::EntityKind::Effect, net::EntityKind::Drop, net::EntityKind::Mob,
        net::EntityKind::Projectile, net::EntityKind::Petal, net::EntityKind::Player,
    };

    for (const net::EntityKind kind : kOrder) {
        for (const auto& entry : entities) {
            const RemoteEntity& entity = entry.second;
            if (entity.kind != kind) continue;

            // The player's own body uses the predicted position; using the
            // interpolated one would show your flower a round trip behind
            // your own input.
            const Vec2 at = entity.isSelf() ? predictedSelf : entity.position;
            if (!visible.contains(at)) continue;

            drawEntity(canvas, entity, camera, at, timeSeconds);
        }
    }

    drawEffects(canvas, camera);
}

} // namespace flr
