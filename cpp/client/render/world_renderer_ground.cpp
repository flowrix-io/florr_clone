// The two ground effects that are cheap to draw once and ruinous in numbers:
// spider webs and uranium's radiation clouds.
//
// A web is 75 curve segments stroked with round caps; it is now one retained
// path, built once and stroked under each web's own transform. A radiation
// cloud was 24 nested translucent discs up to 1600 units across, so every
// pixel near it was blended a dozen times over, per cloud: a handful of
// uranium petals took an M2's GPU to 100% on the web client, and one cloud
// cost the software rasterizer ~15 ms a frame. The cloud is now baked once,
// and every cloud on screen is gathered into one low-resolution layer that
// goes onto the frame in a single blit.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "client/ui/draw.h"
#include "shared/game/components.h"

namespace flix {

using namespace world_render;

namespace {

/// A web's look: white strands at this opacity, each this share of the
/// web's radius wide (never under one unit), ten spokes and five rings.
constexpr float kWebAlpha = static_cast<float>(0x60 / 255.0);
constexpr double kWebStrandShare = 0.075;
constexpr int kWebSpokes = 10;
constexpr int kWebLevels = 5;

/// The radiation glow: the pulse's colour, this opaque on the petal, fading
/// out on the curve the pulse's damage does (radiationStrength).
constexpr std::uint32_t kRadiationTint = 0x9B59B6u;
constexpr double kRadiationCentreAlpha = 0.3;
/// The one baked cloud every cloud on screen is drawn from. The curve has no
/// edge and no detail, so it scales up without showing it.
constexpr int kRadiationSpriteSide = 512;
/// Device pixels per texel of the layer the clouds are gathered in. The
/// glow is smooth enough that a quarter of the resolution is invisible once
/// filtered back up, and it is what makes the layer's cost independent of
/// how many clouds overlap: each one is drawn into a sixteenth of the pixels,
/// and the screen is blended once for all of them.
constexpr double kRadiationLayerDownscale = 4.0;
constexpr int kRadiationLayerMaxSide = 2048;

/// The web at radius one, centred on the origin and unrotated: spokes out
/// to the rim, then rings of quadratic segments sagging between them.
void traceWeb(Path2D& path) {
    for (int i = 0; i < kWebSpokes; ++i) {
        const double angle = kTau * i / kWebSpokes;
        path.moveTo(0, 0);
        path.lineTo(static_cast<float>(std::cos(angle)), static_cast<float>(std::sin(angle)));
    }
    for (int j = 0; j < kWebLevels; ++j) {
        const double ring = static_cast<double>(j) / kWebLevels;
        const double sag = ring - 1.0 / (2 * kWebLevels);
        path.moveTo(static_cast<float>(ring), 0);
        for (int i = 0; i < kWebSpokes; ++i) {
            const double to = kTau * (i + 1) / kWebSpokes;
            const double between = kPi * (2 * i + 1) / kWebSpokes;
            path.quadraticCurveTo(static_cast<float>(std::cos(between) * sag),
                                  static_cast<float>(std::sin(between) * sag),
                                  static_cast<float>(std::cos(to) * ring),
                                  static_cast<float>(std::sin(to) * ring));
        }
    }
}

} // namespace

void WorldRenderer::drawWeb(Canvas& canvas, Vec2 screen, double radius, double angle) const {
    if (!(radius > 0.0)) return;
    // One path for every web, at radius one, scaled to each: its strand
    // scales with it, so the picture is the same as tracing each web at its
    // own size. In the browser a Path2D this long is kept on the page by key
    // (canvas.cpp emitPath), so after the first frame a web is one stroke of
    // a path the browser already holds -- not 75 segments rebuilt and sent
    // again, per web, per frame. Stroked rather than baked into a bitmap: a
    // blit paints its whole square, and a frame of webs blitted cost the GPU
    // half as much again as stroking only the strands.
    if (webPath_.empty()) traceWeb(webPath_);
    const double strand = std::max(1.0, radius * kWebStrandShare);
    canvas.save();
    canvas.translate(static_cast<float>(screen.x), static_cast<float>(screen.y));
    canvas.rotate(static_cast<float>(angle));
    canvas.scale(static_cast<float>(radius), static_cast<float>(radius));
    canvas.setGlobalAlpha(kWebAlpha);
    ui::setStroke(canvas, 0xFFFFFFu);
    canvas.setLineCap("round");
    canvas.setLineWidth(static_cast<float>(strand / radius));
    canvas.stroke(webPath_);
    canvas.restore();
}

void WorldRenderer::queueRadiation(Vec2 screen, double radius) const {
    if (radius > 0.0) radiationClouds_.push_back({screen, radius});
}

void WorldRenderer::drawRadiation(Canvas& canvas, const Camera& camera) const {
    const double viewW = camera.viewportWidth();
    const double viewH = camera.viewportHeight();
    // Only clouds that reach the screen. The entity pass's own cull keeps a
    // margin of twice a body's radius, which for a cloud is thousands of
    // units of nothing. With none left the layer is not touched at all: an
    // offscreen surface redrawn costs the browser a flush even unread.
    radiationClouds_.erase(
        std::remove_if(radiationClouds_.begin(), radiationClouds_.end(),
                       [&](const RadiationCloud& cloud) {
                           return cloud.screen.x + cloud.radius < 0.0 ||
                                  cloud.screen.x - cloud.radius > viewW ||
                                  cloud.screen.y + cloud.radius < 0.0 ||
                                  cloud.screen.y - cloud.radius > viewH;
                       }),
        radiationClouds_.end());
    if (radiationClouds_.empty()) return;
    const std::array<float, 6> m = canvas.currentTransform();
    const double perUnitX = std::hypot(m[0], m[1]);
    const double perUnitY = std::hypot(m[2], m[3]);
    if (!(viewW > 0.0) || !(viewH > 0.0) || !(perUnitX > 0.0) || !(perUnitY > 0.0)) {
        radiationClouds_.clear();
        return;
    }

    if (!radiationSprite_) {
        // Straight alpha, one colour, the alpha on the damage curve measured
        // from the centre of each texel.
        constexpr int kSide = kRadiationSpriteSide;
        std::vector<std::uint8_t> rgba(static_cast<std::size_t>(kSide) * kSide * 4);
        const double centre = kSide * 0.5;
        for (int y = 0; y < kSide; ++y) {
            for (int x = 0; x < kSide; ++x) {
                const double r = std::hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
                const double alpha = kRadiationCentreAlpha * radiationStrength(r, 1.0);
                std::uint8_t* px = &rgba[(static_cast<std::size_t>(y) * kSide + x) * 4];
                px[0] = static_cast<std::uint8_t>((kRadiationTint >> 16) & 0xFF);
                px[1] = static_cast<std::uint8_t>((kRadiationTint >> 8) & 0xFF);
                px[2] = static_cast<std::uint8_t>(kRadiationTint & 0xFF);
                px[3] = static_cast<std::uint8_t>(std::lround(clamp(alpha, 0.0, 1.0) * 255.0));
            }
        }
        radiationSprite_ = std::make_unique<Canvas>(Canvas::createVirtual(kSide, kSide));
        radiationSprite_->putImageData(rgba, kSide, kSide, 0, 0);
    }

    // Every cloud goes into one low-resolution layer covering the screen,
    // and the layer goes onto the frame once. Source-over is associative, so
    // the clouds stack in the layer exactly as they would have on the frame.
    const int layerW = std::clamp(static_cast<int>(std::ceil(viewW * perUnitX / kRadiationLayerDownscale)),
                                  1, kRadiationLayerMaxSide);
    const int layerH = std::clamp(static_cast<int>(std::ceil(viewH * perUnitY / kRadiationLayerDownscale)),
                                  1, kRadiationLayerMaxSide);
    if (!radiationLayer_ || radiationLayer_->width() != layerW ||
        radiationLayer_->height() != layerH) {
        radiationLayer_ = std::make_unique<Canvas>(Canvas::createVirtual(layerW, layerH));
    }
    Canvas& layer = *radiationLayer_;
    const double toLayerX = layerW / viewW;
    const double toLayerY = layerH / viewH;
    layer.save();
    layer.resetTransform();
    layer.clearRect(0, 0, static_cast<float>(layerW), static_cast<float>(layerH));
    for (const RadiationCloud& cloud : radiationClouds_) {
        const double rx = cloud.radius * toLayerX;
        const double ry = cloud.radius * toLayerY;
        layer.drawCanvas(*radiationSprite_, static_cast<float>(cloud.screen.x * toLayerX - rx),
                         static_cast<float>(cloud.screen.y * toLayerY - ry),
                         static_cast<float>(rx * 2.0), static_cast<float>(ry * 2.0));
    }
    layer.restore();
    radiationClouds_.clear();
    canvas.drawCanvas(layer, 0.0f, 0.0f, static_cast<float>(viewW), static_cast<float>(viewH));
}

} // namespace flix
