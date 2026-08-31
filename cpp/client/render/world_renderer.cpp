#include "client/render/world_renderer.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>

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
        case Tile::Water: return 0x4169E1u;
        case Tile::Sand:  return 0xFF5500u;
        case Tile::Stone: return 0x786828u;
        case Tile::Block: return 0x00FF00u;
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

std::uint32_t scaleColor(std::uint32_t rgb, double factor) {
    const auto channel = [factor](std::uint32_t c) {
        return static_cast<std::uint32_t>(clamp(std::round(c * factor), 0.0, 255.0));
    };
    return (channel((rgb >> 16) & 0xFF) << 16) |
           (channel((rgb >> 8) & 0xFF) << 8) |
           channel(rgb & 0xFF);
}

std::uint32_t mixWithWhite(std::uint32_t rgb, double amount) {
    const auto channel = [amount](std::uint32_t c) {
        return static_cast<std::uint32_t>(clamp(std::round(c + (255.0 - c) * amount), 0.0, 255.0));
    };
    return (channel((rgb >> 16) & 0xFF) << 16) |
           (channel((rgb >> 8) & 0xFF) << 8) |
           channel(rgb & 0xFF);
}

/// Same stable integer-hash shape used by the TypeScript glitch effect. The
/// C++ client has numeric network ids instead of socket-id strings, so the id
/// is the stable per-player seed.
double hash01(std::uint32_t a, std::uint32_t b) {
    std::uint32_t h = a * 374761393u + b * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return static_cast<double>(h ^ (h >> 16)) / 4294967296.0;
}

// The TypeScript wall texture is a 124-unit SVG rasterised into every
// 300-unit tile. Keeping the source coordinates here preserves the texture's
// global phase on both normal cells and their jagged edge protrusions.
constexpr double kWallTextureViewBox = 124.0;
constexpr std::uint32_t kWallFill = 0x99550Cu;
constexpr std::uint32_t kWallDotColor = 0x783F01u;
constexpr double kWallDotRadius = 5.1641;
constexpr std::array<Vec2, 5> kWallDots = {{
    {25.2109, 51.5391}, {105.5341, 25.5207}, {51.5308, 85.3607},
    {64.5341, 15.5207}, {103.5341, 102.5207},
}};
constexpr double kWallOverlap = 1.5;
constexpr double kJaggedMaxOffset = 20.0;
constexpr int kJaggedSegments = 7;

enum class WallEdge { Top = 0, Bottom = 1, Left = 2, Right = 3 };

struct JaggedPoint {
    double t = 0;
    double offset = 0;
};

double seededRandom(std::int64_t seed) {
    const double value = std::sin(static_cast<double>(seed)) * 10000.0;
    return value - std::floor(value);
}

std::array<JaggedPoint, kJaggedSegments + 2> jaggedPoints(int tileX, int tileY,
                                                            WallEdge edge) {
    // JavaScript's `^` first converts both products to signed 32-bit values.
    // Do that conversion explicitly: multiplying in signed C++ would overflow
    // for the lower-right portion of the map and change this shared sequence.
    const std::uint32_t xBits = static_cast<std::uint32_t>(tileX) * 73856093u;
    const std::uint32_t yBits = static_cast<std::uint32_t>(tileY) * 19349669u;
    const std::uint32_t baseBits = xBits ^ yBits;
    const std::int64_t signedBase = baseBits <= 0x7fffffffu
        ? static_cast<std::int64_t>(baseBits)
        : static_cast<std::int64_t>(baseBits) - 4294967296ll;
    const std::int64_t baseSeed = signedBase + static_cast<int>(edge) * 1000;
    std::array<JaggedPoint, kJaggedSegments + 2> points{};
    points.front() = {0, 0};
    points.back() = {kTileSize, 0};
    const double segmentLength = kTileSize / static_cast<double>(kJaggedSegments + 1);
    for (int i = 1; i <= kJaggedSegments; ++i) {
        const std::int64_t seed = baseSeed + i;
        const double jitter = (seededRandom(seed) - 0.5) * segmentLength * 0.4;
        points[static_cast<std::size_t>(i)] = {
            clamp(i * segmentLength + jitter, 1.0, kTileSize - 1.0),
            seededRandom(seed + 100) * kJaggedMaxOffset,
        };
    }
    std::sort(points.begin(), points.end(),
              [](const JaggedPoint& a, const JaggedPoint& b) { return a.t < b.t; });
    return points;
}

bool wallEdgeExposed(const Terrain& terrain, int tileX, int tileY, WallEdge edge) {
    int adjacentX = tileX;
    int adjacentY = tileY;
    switch (edge) {
        case WallEdge::Top: --adjacentY; break;
        case WallEdge::Bottom: ++adjacentY; break;
        case WallEdge::Left: --adjacentX; break;
        case WallEdge::Right: ++adjacentX; break;
    }
    // Terrain::atTile deliberately returns Wall out of range for collision.
    // The TypeScript render grid instead treats its outside as air, so retain
    // that visual rule here without changing gameplay collision semantics.
    if (adjacentX < 0 || adjacentY < 0 ||
        adjacentX >= kTilesPerAxis || adjacentY >= kTilesPerAxis) return true;
    // TypeScript exposes an edge only against air (id 0) or water. Other
    // nonzero tiles, including the passable bridge tile, suppress the edge.
    const Tile adjacent = terrain.atTile(adjacentX, adjacentY);
    return adjacent == Tile::Ground || adjacent == Tile::Water;
}

Vec2 edgeBasePoint(double worldX, double worldY, WallEdge edge, double t) {
    switch (edge) {
        case WallEdge::Top: return {worldX + t, worldY};
        case WallEdge::Bottom: return {worldX + t, worldY + kTileSize};
        case WallEdge::Left: return {worldX, worldY + t};
        case WallEdge::Right: return {worldX + kTileSize, worldY + t};
    }
    return {};
}

Vec2 edgePoint(double worldX, double worldY, WallEdge edge, const JaggedPoint& point) {
    switch (edge) {
        case WallEdge::Top: return {worldX + point.t, worldY - point.offset};
        case WallEdge::Bottom: return {worldX + point.t, worldY + kTileSize + point.offset};
        case WallEdge::Left: return {worldX - point.offset, worldY + point.t};
        case WallEdge::Right: return {worldX + kTileSize + point.offset, worldY + point.t};
    }
    return {};
}

void moveToScreen(Canvas& canvas, const Camera& camera, Vec2 world) {
    const Vec2 screen = camera.worldToScreen(world);
    canvas.moveTo(static_cast<float>(screen.x), static_cast<float>(screen.y));
}

void lineToScreen(Canvas& canvas, const Camera& camera, Vec2 world) {
    const Vec2 screen = camera.worldToScreen(world);
    canvas.lineTo(static_cast<float>(screen.x), static_cast<float>(screen.y));
}

/// Paint a globally-phased copy of TypeScript's wall pattern inside the
/// caller's clip. The clip makes this work for a rectangle and for a jagged
/// extension without restarting the dot pattern at every exposed edge.
void paintWallPattern(Canvas& canvas, const Camera& camera, Rect worldBounds) {
    const Vec2 topLeft = camera.worldToScreen({worldBounds.x, worldBounds.y});
    const double zoom = camera.zoom();
    ui::setFill(canvas, kWallFill);
    canvas.fillRect(static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
                    static_cast<float>(worldBounds.w * zoom),
                    static_cast<float>(worldBounds.h * zoom));

    const int tileX0 = static_cast<int>(std::floor(worldBounds.left() / kTileSize));
    const int tileY0 = static_cast<int>(std::floor(worldBounds.top() / kTileSize));
    const int tileX1 = static_cast<int>(std::floor(worldBounds.right() / kTileSize));
    const int tileY1 = static_cast<int>(std::floor(worldBounds.bottom() / kTileSize));
    const double textureScale = kTileSize / kWallTextureViewBox;
    ui::setFill(canvas, kWallDotColor);
    for (int ty = tileY0; ty <= tileY1; ++ty) {
        for (int tx = tileX0; tx <= tileX1; ++tx) {
            for (const Vec2 dot : kWallDots) {
                const Vec2 screen = camera.worldToScreen({
                    tx * kTileSize + dot.x * textureScale,
                    ty * kTileSize + dot.y * textureScale,
                });
                canvas.fillCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                  static_cast<float>(kWallDotRadius * textureScale * zoom));
            }
        }
    }
}

template <typename TraceShape>
void fillWallShape(Canvas& canvas, const Camera& camera, Rect bounds, TraceShape&& traceShape) {
    canvas.save();
    canvas.beginPath();
    traceShape();
    canvas.clip();
    paintWallPattern(canvas, camera, bounds);
    canvas.restore();
}

void drawWallTile(Canvas& canvas, const Camera& camera, int tileX, int tileY) {
    const Rect bounds{tileX * kTileSize - kWallOverlap, tileY * kTileSize - kWallOverlap,
                      kTileSize + kWallOverlap * 2.0, kTileSize + kWallOverlap * 2.0};
    fillWallShape(canvas, camera, bounds, [&] {
        const Vec2 topLeft = camera.worldToScreen({bounds.x, bounds.y});
        canvas.rect(static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
                    static_cast<float>(bounds.w * camera.zoom()),
                    static_cast<float>(bounds.h * camera.zoom()));
    });
}

void drawJaggedWallEdge(Canvas& canvas, const Camera& camera, int tileX, int tileY,
                        WallEdge edge) {
    // drawJaggedEdge() in TypeScript saves its canvas state, so its texture
    // and stroke settings never leak into later world rendering.
    canvas.save();
    const double worldX = tileX * kTileSize;
    const double worldY = tileY * kTileSize;
    const auto points = jaggedPoints(tileX, tileY, edge);

    Rect bounds{worldX, worldY, 0, 0};
    double minX = worldX, maxX = worldX, minY = worldY, maxY = worldY;
    const auto include = [&](Vec2 p) {
        minX = std::min(minX, p.x); maxX = std::max(maxX, p.x);
        minY = std::min(minY, p.y); maxY = std::max(maxY, p.y);
    };
    for (const JaggedPoint& point : points) {
        include(edgeBasePoint(worldX, worldY, edge, point.t));
        include(edgePoint(worldX, worldY, edge, point));
    }
    bounds = {minX, minY, maxX - minX, maxY - minY};

    const auto traceFill = [&] {
        moveToScreen(canvas, camera, edgeBasePoint(worldX, worldY, edge, points.front().t));
        for (const JaggedPoint& point : points) {
            lineToScreen(canvas, camera, edgePoint(worldX, worldY, edge, point));
        }
        lineToScreen(canvas, camera, edgeBasePoint(worldX, worldY, edge, points.back().t));
        canvas.closePath();
    };
    fillWallShape(canvas, camera, bounds, traceFill);

    ui::setStroke(canvas, kWallDotColor);
    canvas.setLineWidth(static_cast<float>(3.0 * camera.zoom()));
    canvas.setLineCap("butt");
    canvas.setLineJoin("round");
    canvas.beginPath();
    moveToScreen(canvas, camera, edgePoint(worldX, worldY, edge, points.front()));
    for (std::size_t i = 1; i < points.size(); ++i) {
        lineToScreen(canvas, camera, edgePoint(worldX, worldY, edge, points[i]));
    }
    canvas.stroke();
    canvas.restore();
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
            if (tile == Tile::Wall) {
                drawWallTile(canvas, camera, tx, ty);
                continue;
            }
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

    // The web client draws every exposed side after all tile fills. Repeating
    // the order matters: protrusions are never hidden by a neighbouring fill.
    for (int ty = y0; ty < y1; ++ty) {
        for (int tx = x0; tx < x1; ++tx) {
            if (terrain_->atTile(tx, ty) != Tile::Wall) continue;
            for (const WallEdge edge : {WallEdge::Top, WallEdge::Bottom,
                                        WallEdge::Left, WallEdge::Right}) {
                if (wallEdgeExposed(*terrain_, tx, ty, edge)) {
                    drawJaggedWallEdge(canvas, camera, tx, ty, edge);
                }
            }
        }
    }
}

void WorldRenderer::drawFlower(Canvas& canvas, const RemoteEntity& entity, const Camera& camera,
                               Vec2 at, double timeSeconds) const {
    const double zoom = camera.zoom();
    const Vec2 screen = camera.worldToScreen(at);
    const double radius = entity.radius * zoom;
    if (radius <= 0.5) return;

    const auto drawBodyAtScreen = [&] {
        canvas.save();
        canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
        // The 20-unit Body radius is the gameplay hitbox.  TypeScript renders
        // its 25-unit flower artwork at that baseline, so scale the local
        // radius-25 artwork by the hitbox ratio rather than to the hitbox.
        canvas.scale(static_cast<float>(radius / kPlayerBaseRadius),
                     static_cast<float>(radius / kPlayerBaseRadius));
        drawFlowerBody(canvas, entity, timeSeconds);
        canvas.restore();
    };

    // Glitch is a post-process flag, not a replacement skin. Render the same
    // selected body into a transparent buffer, then recompose it as clipped,
    // horizontally displaced bands. This keeps it composable with Pumpkin and
    // Robot exactly as it is in the TypeScript renderer.
    const std::uint32_t bucket = static_cast<std::uint32_t>(std::max(0.0, std::floor(timeSeconds * 1000.0 / 70.0)));
    const bool burst = (entity.renderFlags & PlayerRenderGlitch) != 0 &&
                       hash01(entity.netId, bucket) < 0.45;
    if (!burst) {
        drawBodyAtScreen();
    } else {
        const int half = std::max(16, static_cast<int>(std::ceil(radius * 2.0 + 24.0)));
        const int side = half * 2;
        if (!glitchBody_ || glitchSide_ < side) {
            glitchBody_ = std::make_unique<Canvas>(Canvas::createVirtual(side, side));
            glitchSide_ = side;
        }

        Canvas& body = *glitchBody_;
        const int bufferHalf = glitchSide_ / 2;
        body.clearRect(0, 0, static_cast<float>(glitchSide_), static_cast<float>(glitchSide_));
        body.save();
        body.translate(static_cast<float>(bufferHalf), static_cast<float>(bufferHalf));
        body.scale(static_cast<float>(radius / kPlayerBaseRadius),
                   static_cast<float>(radius / kPlayerBaseRadius));
        drawFlowerBody(body, entity, timeSeconds);
        body.restore();

        constexpr int kBandCount = 9;
        for (int i = 0; i < kBandCount; ++i) {
            const double roll = hash01(entity.netId ^ 0x5F3759DFu, bucket * 31u + static_cast<std::uint32_t>(i));
            if (roll < 0.06) continue;  // the occasional missing scanline band
            double dx = 0;
            if (roll < 0.36) {
                dx = (hash01(entity.netId, bucket * 17u + static_cast<std::uint32_t>(i)) - 0.5) * radius * 0.9;
            }
            const double y0 = screen.y - bufferHalf + static_cast<double>(glitchSide_ * i) / kBandCount;
            const double y1 = screen.y - bufferHalf + static_cast<double>(glitchSide_ * (i + 1)) / kBandCount;
            canvas.save();
            canvas.beginPath();
            canvas.rect(static_cast<float>(screen.x - bufferHalf), static_cast<float>(y0),
                        static_cast<float>(glitchSide_), static_cast<float>(std::ceil(y1 - y0)));
            canvas.clip();
            canvas.drawCanvas(body, static_cast<float>(screen.x - bufferHalf + dx),
                              static_cast<float>(screen.y - bufferHalf));
            canvas.restore();
        }
    }

    if (!entity.name.empty()) {
        ui::TextStyle style;
        style.size = std::max(10.0, 15.0 * zoom);
        style.align = ui::Align::Centre;
        style.baseline = ui::Baseline::Bottom;
        ui::text(canvas, entity.name, screen.x, screen.y - radius - 10.0 * zoom, style);
    }
}

void WorldRenderer::drawFlowerBody(Canvas& canvas, const RemoteEntity& entity,
                                   double timeSeconds) const {
    // Registration order in player-skins.ts is Pumpkin, then Robot. Preserve
    // that deterministic priority when a saved account somehow has both bits.
    if (entity.renderFlags & PlayerRenderPumpkin) {
        drawPumpkin(canvas, entity);
    } else if (entity.renderFlags & PlayerRenderRobot) {
        drawRobot(canvas, entity);
    } else {
        drawDefaultFlower(canvas, entity, timeSeconds);
    }
}

void WorldRenderer::drawDefaultFlower(Canvas& canvas, const RemoteEntity& entity,
                                      double timeSeconds) const {
    std::uint32_t baseColor = 0xFFE763u;
    // The status precedence is intentional: corruption identifies a flower
    // that can hurt other players, so it must remain visible through poison.
    if (entity.faceFlags & FaceHasCorruption) baseColor = 0xD91313u;
    else if (entity.faceFlags & FacePoisoned) baseColor = 0xCE76DBu;
    else if (entity.faceFlags & FaceDandelioned) baseColor = mixWithWhite(baseColor, 0.4);

    ui::setFill(canvas, scaleColor(baseColor, 0.8));
    canvas.beginPath();
    canvas.arc(0, 0, 26.5f, 0, static_cast<float>(kTau));
    canvas.fill();
    ui::setFill(canvas, baseColor);
    canvas.beginPath();
    canvas.arc(0, 0, 23.5f, 0, static_cast<float>(kTau));
    canvas.fill();

    const bool deadEyes = (entity.faceFlags & FaceDeadEyes) != 0;
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
    } else if (entity.faceFlags & FaceSquareEyes) {
        canvas.beginPath();
        canvas.rect(-10, -11.3f, 6, 13);
        canvas.rect(4, -11.3f, 6, 13);
        canvas.fill();
        canvas.clip();
        ui::setFill(canvas, 0xFFFFFFu);
        canvas.beginPath();
        canvas.rect(static_cast<float>(-10 + entity.eyeX), static_cast<float>(-7.8 + entity.eyeY), 6, 6);
        canvas.rect(static_cast<float>(4 + entity.eyeX), static_cast<float>(-7.8 + entity.eyeY), 6, 6);
        canvas.fill();
        ui::setStroke(canvas, 0x000000u);
        canvas.setLineWidth(1.0f);
        canvas.beginPath(); canvas.rect(-10, -11.3f, 6, 13); canvas.stroke();
        canvas.beginPath(); canvas.rect(4, -11.3f, 6, 13); canvas.stroke();
    } else {
        canvas.beginPath();
        canvas.ellipse(-7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
        canvas.moveTo(10.2f, -4.8f);
        canvas.ellipse(7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
        canvas.fill();
        canvas.clip();
        ui::setFill(canvas, 0xFFFFFFu);
        canvas.beginPath();
        canvas.arc(static_cast<float>(-7 + entity.eyeX), static_cast<float>(-4.8 + entity.eyeY),
                   3, 0, static_cast<float>(kTau));
        canvas.arc(static_cast<float>(7 + entity.eyeX), static_cast<float>(-4.8 + entity.eyeY),
                   3, 0, static_cast<float>(kTau));
        canvas.fill();
        ui::setStroke(canvas, 0x000000u);
        canvas.setLineWidth(1.0f);
        canvas.beginPath();
        canvas.ellipse(-7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
        canvas.stroke();
        canvas.beginPath();
        canvas.ellipse(7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
        canvas.stroke();
    }
    canvas.restore();

    const bool active = (entity.faceFlags & (FaceAttacking | FaceDefending)) != 0;
    const double mouth = active ? 4.0 : 14.5;
    ui::setStroke(canvas, 0x222222u);
    canvas.setLineWidth(1.5f);
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(-6, 10);
    canvas.quadraticCurveTo(0, static_cast<float>(mouth), 6, 10);
    canvas.stroke();

    if (!deadEyes && mouth <= 8.0 && (entity.faceFlags & FaceAttacking)) {
        canvas.save();
        canvas.translate(0, static_cast<float>(-mouth - 8.0));
        ui::setFill(canvas, baseColor);
        canvas.beginPath();
        canvas.moveTo(-12, 0); canvas.lineTo(12, 0); canvas.lineTo(0, 6); canvas.closePath();
        canvas.fill();
        canvas.restore();
    }

    if (entity.equipFlags & (EquipAntennae | EquipObserver)) {
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
        if (entity.equipFlags & EquipObserver) {
            ui::setFill(canvas, 0xD01C1Du);
            canvas.beginPath(); canvas.arc(15, -12.5f, 2.5f, 0, static_cast<float>(kTau)); canvas.fill();
            canvas.beginPath(); canvas.arc(-15, -12.5f, 2.5f, 0, static_cast<float>(kTau)); canvas.fill();
        }
        canvas.restore();
    }

    if (entity.equipFlags & EquipThirdEye) {
        const std::uint16_t thirdEye = content_ ? content_->petalIndex("third_eye") : kInvalidIndex;
        if (sprites_ && thirdEye != kInvalidIndex && sprites_->petalDrawable(thirdEye)) {
            sprites_->drawPetal(canvas, thirdEye, 0, -14, 13, 0, timeSeconds);
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
                canvas.arc(static_cast<float>(entity.eyeX), static_cast<float>(entity.eyeY),
                           3, 0, static_cast<float>(kTau));
                canvas.fill();
            }
            canvas.restore();
        }
    }
}

void WorldRenderer::drawPumpkin(Canvas& canvas, const RemoteEntity& entity) const {
    canvas.save();
    // Stem
    ui::setFill(canvas, 0x5A7D34u); ui::setStroke(canvas, 0x3F5A24u);
    canvas.setLineWidth(2.0f); canvas.setLineJoin("round");
    canvas.beginPath();
    canvas.moveTo(-3, -23); canvas.lineTo(3, -23); canvas.lineTo(2, -31); canvas.lineTo(-2, -31);
    canvas.closePath(); canvas.fill(); canvas.stroke();

    ui::setFill(canvas, 0xA8490Du);
    canvas.beginPath(); canvas.arc(0, 0, 26, 0, static_cast<float>(kTau)); canvas.fill();
    ui::setFill(canvas, 0xE8731Fu);
    canvas.beginPath(); canvas.ellipse(0, 0, 24, 23, 0, 0, static_cast<float>(kTau)); canvas.fill();
    ui::setStroke(canvas, 0xC25A12u); canvas.setLineWidth(1.5f);
    for (const float x : {-11.0f, 11.0f}) {
        canvas.beginPath(); canvas.ellipse(x, 0, 6.5f, 22, 0, 0, static_cast<float>(kTau)); canvas.stroke();
    }

    const double eyeX = clamp(entity.eyeX, -2.0, 2.0) * 0.7;
    const double eyeY = clamp(entity.eyeY, -2.0, 2.0) * 0.5;
    ui::setFill(canvas, 0x3A1A02u);
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(-12 + eyeX), static_cast<float>(-1 + eyeY));
    canvas.lineTo(static_cast<float>(-3 + eyeX), static_cast<float>(-1 + eyeY));
    canvas.lineTo(static_cast<float>(-7.5 + eyeX), static_cast<float>(-9 + eyeY)); canvas.closePath();
    canvas.moveTo(static_cast<float>(12 + eyeX), static_cast<float>(-1 + eyeY));
    canvas.lineTo(static_cast<float>(3 + eyeX), static_cast<float>(-1 + eyeY));
    canvas.lineTo(static_cast<float>(7.5 + eyeX), static_cast<float>(-9 + eyeY)); canvas.closePath();
    canvas.fill();
    canvas.beginPath();
    canvas.moveTo(-13, 6); canvas.lineTo(-9, 12); canvas.lineTo(-4.5f, 6); canvas.lineTo(0, 13);
    canvas.lineTo(4.5f, 6); canvas.lineTo(9, 12); canvas.lineTo(13, 6); canvas.lineTo(9, 9);
    canvas.lineTo(-9, 9); canvas.closePath(); canvas.fill();
    canvas.restore();
}

void WorldRenderer::drawRobot(Canvas& canvas, const RemoteEntity& entity) const {
    canvas.save();
    ui::setStroke(canvas, 0x7B8794u); canvas.setLineWidth(2.0f); canvas.setLineCap("round");
    canvas.beginPath(); canvas.moveTo(0, -21); canvas.lineTo(0, -31); canvas.stroke();
    ui::setFill(canvas, 0xD01C1Du); canvas.beginPath(); canvas.arc(0, -33, 3, 0, static_cast<float>(kTau)); canvas.fill();

    ui::setFill(canvas, 0x4B5563u); canvas.beginPath(); canvas.roundRect(-25, -22, 50, 44, 9); canvas.fill();
    ui::setFill(canvas, 0x9AA6B2u); canvas.beginPath(); canvas.roundRect(-22, -19, 44, 38, 7); canvas.fill();
    ui::setFill(canvas, 0x6B7280u);
    for (const Vec2 bolt : {Vec2{-17, -14}, Vec2{17, -14}, Vec2{-17, 15}, Vec2{17, 15}}) {
        canvas.beginPath(); canvas.arc(static_cast<float>(bolt.x), static_cast<float>(bolt.y), 1.8f, 0, static_cast<float>(kTau)); canvas.fill();
    }
    ui::setFill(canvas, 0x10141Au); canvas.beginPath(); canvas.roundRect(-17, -8, 34, 13, 5); canvas.fill();

    const double eyeX = clamp(entity.eyeX, -2.5, 2.5);
    const double eyeY = clamp(entity.eyeY, -1.5, 1.5);
    // The default flower colour is the TypeScript robot visor tint.
    ui::setFill(canvas, 0xFFE763u);
    canvas.setShadow(Color{255, 231, 99}, 6.0f);
    for (const float x : {-8.0f, 8.0f}) {
        canvas.beginPath();
        canvas.arc(static_cast<float>(x + eyeX), static_cast<float>(-1.5 + eyeY), 2.6f, 0, static_cast<float>(kTau));
        canvas.fill();
    }
    canvas.setShadow(Color{0, 0, 0, 0}, 0);

    ui::setStroke(canvas, 0x3A4250u); canvas.setLineWidth(1.2f);
    for (const float y : {10.0f, 14.0f}) {
        canvas.beginPath(); canvas.moveTo(-10, y); canvas.lineTo(10, y); canvas.stroke();
    }
    for (int x = -10; x <= 10; x += 5) {
        canvas.beginPath(); canvas.moveTo(static_cast<float>(x), 9); canvas.lineTo(static_cast<float>(x), 15); canvas.stroke();
    }
    canvas.restore();
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
