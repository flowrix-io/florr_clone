#include "client/render/darkness.h"

#include <algorithm>
#include <cmath>

#include "client/camera.h"
#include "client/ease.h"
#include "shared/game/config.h"

namespace flix {

namespace {

/// florr's fade, as the time constant every client ease is stated in.
constexpr double kLightFadeSeconds = easeTimeConstantFromRatePerMs(kLightFadeRatePerMs);

#ifndef __EMSCRIPTEN__
/// Lays one half-alpha white disc into the shade's mask of `width` x `height`
/// device pixels. The mask holds how much of the dark is left, 255 for all of
/// it; a disc takes half of what is left wherever it covers, so overlapping
/// discs stack as florr's do. The rim is antialiased over one pixel by
/// distance from the centre.
void layDisc(std::vector<std::uint8_t>& mask, int width, int height, double cx, double cy,
             double radius) {
    const double inner = radius - 0.5;
    const double outer = radius + 0.5;
    const int y0 = std::max(0, static_cast<int>(std::floor(cy - outer)));
    const int y1 = std::min(height - 1, static_cast<int>(std::ceil(cy + outer)));
    for (int y = y0; y <= y1; ++y) {
        const double dy = y + 0.5 - cy;
        const double dy2 = dy * dy;
        if (dy2 >= outer * outer) continue;
        const double outerHalf = std::sqrt(outer * outer - dy2);
        const int xa = std::max(0, static_cast<int>(std::ceil(cx - outerHalf - 0.5)));
        const int xb = std::min(width - 1, static_cast<int>(std::floor(cx + outerHalf - 0.5)));
        if (xa > xb) continue;
        // Pixel centres closer than `inner` are wholly inside.
        int ca = xb + 1;
        int cb = xb;
        if (inner > 0.0 && dy2 < inner * inner) {
            const double innerHalf = std::sqrt(inner * inner - dy2);
            ca = std::max(xa, static_cast<int>(std::ceil(cx - innerHalf - 0.5)));
            cb = std::min(xb, static_cast<int>(std::floor(cx + innerHalf - 0.5)));
        }
        std::uint8_t* row = mask.data() + static_cast<std::size_t>(y) * width;
        const auto rim = [&](int x) {
            const double dx = x + 0.5 - cx;
            const double cover = clamp(outer - std::sqrt(dx * dx + dy2), 0.0, 1.0);
            row[x] = static_cast<std::uint8_t>(
                std::lround(row[x] * (1.0 - cover * kLightDiscAlpha)));
        };
        if (ca > cb) {
            for (int x = xa; x <= xb; ++x) rim(x);
            continue;
        }
        for (int x = xa; x < ca; ++x) rim(x);
        for (int x = ca; x <= cb; ++x) row[x] = static_cast<std::uint8_t>((row[x] + 1) >> 1);
        for (int x = cb + 1; x <= xb; ++x) rim(x);
    }
}
#endif

} // namespace

double bulbLight(Rarity rarity) {
    if (rarity >= Rarity::Unique) return kBulbLightTopRarity;
    return kBulbLight + kBulbLightPerRarity * static_cast<int>(rarity);
}

Color darknessFloor(std::uint32_t darkColor) {
    const auto lift = [](std::uint32_t channel) {
        return static_cast<std::uint8_t>(static_cast<float>(channel & 0xFFu) * 0.9f + 25.5f);
    };
    return Color{lift(darkColor >> 16), lift(darkColor >> 8), lift(darkColor)};
}

double lightReach(const RemoteEntity& entity, const ContentRegistry* content) {
    double light = 0.0;
    switch (entity.kind) {
        case net::EntityKind::Player:
            if (entity.dead() || entity.healthFraction <= 0.0) return 0.0;
            light = kFlowerLight;
            break;
        case net::EntityKind::Mob: {
            if (entity.dead()) return 0.0;
            if ((entity.spawnFlags & net::SpawnIsPet) != 0) light = kPetLight;
            const MobConfig* config = content ? &content->mob(entity.typeIndex) : nullptr;
            if (config && config->emissive) {
                light = std::max(light, config->lightRadius > 0 ? config->lightRadius
                                                                 : kEmissiveMobLight);
            }
            break;
        }
        case net::EntityKind::Petal:
        case net::EntityKind::Drop: {
            const PetalConfig* config = content ? &content->petal(entity.typeIndex) : nullptr;
            if (config && config->emissive) light = bulbLight(entity.rarity);
            break;
        }
        default:
            break;
    }
    return light > 0.0 ? light + std::max(0.0, entity.radius) : 0.0;
}

void gatherLights(const WorldView& view, Vec2 selfDrawn, const ContentRegistry* content,
                  std::vector<LightSource>& out) {
    out.clear();
    for (const auto& [netId, entity] : view.entities()) {
        const double reach = lightReach(entity, content);
        if (reach <= 0.0) continue;
        out.push_back({netId, entity.isSelf() ? selfDrawn : entity.position, reach});
    }
}

DarkMap::DarkMap() = default;
DarkMap::~DarkMap() = default;

void DarkMap::step(const std::vector<LightSource>& sources, double stepSeconds, bool snap) {
    for (auto& [id, light] : lights_) light.present = false;
    for (const LightSource& source : sources) {
        // A new light starts dark and eases in, as florr's does.
        Light& light = lights_[source.netId];
        light.position = source.position;
        light.reach = source.reach;
        light.present = true;
    }
    for (auto it = lights_.begin(); it != lights_.end();) {
        Light& light = it->second;
        const double target = light.present ? 1.0 : 0.0;
        if (snap) light.fade = target;
        else easeToward(light.fade, target, kLightFadeSeconds, stepSeconds);
        if (!light.present && light.fade < kLightForgottenBelow) {
            it = lights_.erase(it);
        } else {
            ++it;
        }
    }
}

double DarkMap::breathe(double timeSeconds) {
    return 1.0 + kLightBreathe * (0.5 - 0.5 * std::cos(std::fmod(timeSeconds, kTau)));
}

void DarkMap::discs(double timeSeconds, std::vector<LightDisc>& out) const {
    out.clear();
    const double breath = breathe(timeSeconds);
    for (const auto& [id, light] : lights_) {
        const double scale = breath * light.fade;
        if (scale <= 0.0) continue;
        out.push_back({light.position, light.reach * scale, (light.reach + kLightPad) * scale});
    }
}

void DarkMap::shade(Canvas& canvas, const Camera& camera, const std::vector<LightDisc>& discs,
                    Color floor) {
    const int width = canvas.pixelWidth();
    const int height = canvas.pixelHeight();
    if (width <= 0 || height <= 0 || canvas.width() <= 0) return;
    // Device pixels per design unit: the frame's base transform.
    const double perUnit = static_cast<double>(width) / canvas.width();
    const double zoom = camera.zoom();
#ifdef __EMSCRIPTEN__
    // florr's own picture: the floor colour, a half-white disc per radius
    // filled one at a time so that overlaps stack, multiplied over the frame.
    if (!layer_ || layer_->pixelWidth() != width || layer_->pixelHeight() != height) {
        layer_ = std::make_unique<Canvas>(Canvas::createVirtual(width, height));
    }
    Canvas& layer = *layer_;
    layer.save();
    layer.resetTransform();
    layer.setFillStyle(floor);
    layer.fillRect(0, 0, static_cast<float>(width), static_cast<float>(height));
    layer.setFillStyle(Color{255, 255, 255});
    layer.setGlobalAlpha(static_cast<float>(kLightDiscAlpha));
    for (const LightDisc& disc : discs) {
        const Vec2 at = camera.worldToScreen(disc.centre);
        const auto x = static_cast<float>(at.x * perUnit);
        const auto y = static_cast<float>(at.y * perUnit);
        for (const double radius : {disc.inner, disc.outer}) {
            const auto r = static_cast<float>(radius * zoom * perUnit);
            if (r <= 0.0f) continue;
            layer.beginPath();
            layer.arc(x, y, r, 0.0f, static_cast<float>(kTau));
            layer.fill();
        }
    }
    layer.restore();
    canvas.save();
    canvas.setGlobalCompositeOperation("multiply");
    canvas.drawCanvas(layer, 0, 0, static_cast<float>(canvas.width()),
                      static_cast<float>(canvas.height()));
    canvas.restore();
#else
    mask_.assign(static_cast<std::size_t>(width) * height, 255);
    for (const LightDisc& disc : discs) {
        const Vec2 at = camera.worldToScreen(disc.centre);
        for (const double radius : {disc.inner, disc.outer}) {
            if (radius <= 0.0) continue;
            layDisc(mask_, width, height, at.x * perUnit, at.y * perUnit, radius * zoom * perUnit);
        }
    }
    canvas.multiplyDevice(mask_.data(), width, height, 0, 0, floor);
#endif
}

} // namespace flix
