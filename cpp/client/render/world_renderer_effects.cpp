// Effects drawn over the world: floating damage numbers, explosions and their
// debris, petal glints, lightning bolts, and sacrifice rituals.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iterator>
#include <string>

#include "client/ui/draw.h"
#include "client/ui/menu_widgets.h"
#include "shared/game/components.h"

namespace flix {

using namespace world_render;

namespace {

constexpr double kNumberArcPeak = 0.45;

constexpr std::uint32_t kLightningColor = 0xFFFFFFu;
constexpr double kLightningWidth = 2.65;

/// A glint never paints solid: it sits over the petal it came off.
constexpr double kSparkleAlpha = 0.6;

/// One petal glint: a disc that shrinks and fades together. Culled to the
/// screen for the reason drawSparkleGrain is; whoever calls this puts
/// globalAlpha back.
void drawPetalGlint(Canvas& canvas, const Camera& camera, const EffectParticle& p) {
    const double left = p.lifeSeconds / p.maxLifeSeconds;
    if (left <= 0) return;
    const Vec2 at = camera.worldToScreen(p.position);
    const double r = p.size * left * camera.zoom();
    if (at.x + r < 0 || at.y + r < 0 || at.x - r > camera.viewportWidth() ||
        at.y - r > camera.viewportHeight()) {
        return;
    }
    ui::setFill(canvas, p.color);
    canvas.setGlobalAlpha(static_cast<float>(left * kSparkleAlpha));
    canvas.fillCircle(static_cast<float>(at.x), static_cast<float>(at.y), static_cast<float>(r));
}

/// The vertical leg of a number's throw at `t` of its life, in units of the
/// apex: a parabola solved so it passes through 1 at kNumberArcPeak and keeps
/// falling afterwards, which puts the number below its spawn by the time it is
/// invisible.
double numberArc(double t) {
    return 2.0 * t / kNumberArcPeak - t * t / (kNumberArcPeak * kNumberArcPeak);
}

/// Keep ordinary hit numbers whole; large hits use the shared suffix range
/// instead of overflowing llround's signed 64-bit result.
std::string formatDamage(double value) {
    return !std::isfinite(value) || std::fabs(value) >= 1e12
               ? ui::abbreviate(value) : ui::formatWhole(value);
}

} // namespace

void WorldRenderer::drawEffects(Canvas& canvas, const Camera& camera) const {
    const double zoom = camera.zoom();
    // Effects are spawned wherever the server says something happened, which
    // is the whole replicated area -- twenty bots fighting off screen produce
    // damage numbers and explosions nobody can see, and a damage number is two
    // of the most expensive calls the browser offers. Same test the entity
    // layer uses, in world units, with the margin each effect's own extent
    // asks for.
    const Rect visible = camera.visibleWorld(0);
    const auto onScreen = [&visible](Vec2 at, double margin) {
        return at.x + margin >= visible.left() && at.x - margin <= visible.right() &&
               at.y + margin >= visible.top() && at.y - margin <= visible.bottom();
    };

    // The bolts first, UNDER the numbers: a strike into a pile draws an arm to
    // every mob in it, and a white mesh over the damage it just dealt would
    // hide the one part of the effect that carries information.
    drawLightning(canvas, camera);

    for (const Effect& e : effects_) {
        const double t = clamp(e.ageSeconds / e.lifeSeconds, 0.0, 1.0);

        switch (e.kind) {
            case Effect::Kind::DamageNumber: {
                // Ballistic: the sideways leg runs at a constant speed, the
                // vertical one along the arc, which is what a thrown thing
                // does and what makes the path a parabola rather than a line.
                const Vec2 world{e.position.x + e.drift.x * t,
                                 e.position.y + e.drift.y * numberArc(t)};
                // A damage number is at most a handful of characters centred on
                // `world`; six text sizes of world margin is well past the
                // widest one this ever draws.
                if (!onScreen(world, e.textSize * 6.0)) break;
                const Vec2 screen = camera.worldToScreen(world);
                ui::TextStyle style;
                style.size = e.textSize * zoom;
                style.fill = e.color;
                style.align = ui::Align::Centre;
                style.baseline = ui::Baseline::Alphabetic;
                // Outlined exactly like every other piece of text in the game:
                // the shared ink stroke at kTextStrokeRatio, which `strokeWidth`
                // left at its default asks for. A number painted any other way
                // reads as a different face from the names and labels around it.
                // Linear over the whole life, exactly as the browser build's
                // per-frame alpha decrement works out to.
                canvas.setGlobalAlpha(static_cast<float>(1.0 - t));
                ui::text(canvas, "-" + formatDamage(e.value), screen.x, screen.y, style);
                canvas.setGlobalAlpha(1.0f);
                break;
            }
            case Effect::Kind::Explosion: {
                // The rings reach e.radius and the debris is thrown from
                // inside them; the particles below are tested individually.
                if (!onScreen(e.position, e.radius * 2.0)) break;
                const Vec2 screen = camera.worldToScreen(e.position);
                canvas.setGlobalAlpha(static_cast<float>(1.0 - t));
                // Two rings expanding together, the inner one at half the
                // radius, then the debris over the top of both.
                ui::setStroke(canvas, kExplosionOuter);
                canvas.setLineWidth(static_cast<float>(3.0 * zoom));
                canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                    static_cast<float>(e.radius * t * zoom));
                ui::setStroke(canvas, kExplosionInner);
                canvas.setLineWidth(static_cast<float>(1.0 * zoom));
                canvas.strokeCircle(static_cast<float>(screen.x), static_cast<float>(screen.y),
                                    static_cast<float>(e.radius * t * 0.5 * zoom));

                for (const EffectParticle& p : e.particles) {
                    const double left = p.lifeSeconds / p.maxLifeSeconds;
                    if (left <= 0) continue;
                    if (!onScreen(p.position, p.size)) continue;
                    const Vec2 at = camera.worldToScreen(p.position);
                    canvas.setGlobalAlpha(static_cast<float>(left));
                    ui::setFill(canvas, p.color);
                    canvas.fillCircle(static_cast<float>(at.x), static_cast<float>(at.y),
                                      static_cast<float>(p.size * left * zoom));
                }
                canvas.setGlobalAlpha(1.0f);
                break;
            }
            case Effect::Kind::Sparkle: {
                // Particles only: the glint has no body of its own.
                for (const EffectParticle& p : e.particles) drawPetalGlint(canvas, camera, p);
                // The discs fade through globalAlpha, so the layer has to put
                // it back before anything else is painted.
                canvas.setGlobalAlpha(1.0f);
                break;
            }
        }
    }
}

void WorldRenderer::drawSacrificeRituals(Canvas& canvas, const EntityMap& entities,
                                         const Camera& camera) const {
    // Forget the rituals that have gone, so one id reused later starts over.
    for (auto it = ritualSeen_.begin(); it != ritualSeen_.end();) {
        const auto live = entities.find(it->first);
        const bool ritual = live != entities.end() &&
                            live->second.kind == net::EntityKind::Effect &&
                            live->second.typeIndex ==
                                static_cast<std::uint16_t>(GroundEffectKind::Sacrifice);
        it = ritual ? std::next(it) : ritualSeen_.erase(it);
    }

    const double zoom = camera.zoom();
    const Rect visible = camera.visibleWorld(0);
    const std::uint32_t red = rarityColor(Rarity::Legendary);

    for (const auto& entry : entities) {
        const RemoteEntity& entity = entry.second;
        if (entity.kind != net::EntityKind::Effect ||
            entity.typeIndex != static_cast<std::uint16_t>(GroundEffectKind::Sacrifice)) {
            continue;
        }
        const double seen = ritualSeen_.emplace(entity.netId, nowSeconds_).first->second;
        const double radius = entity.radius;
        if (!(radius > 0.0)) continue;
        if (entity.position.x + radius < visible.left() ||
            entity.position.x - radius > visible.right() ||
            entity.position.y + radius < visible.top() ||
            entity.position.y - radius > visible.bottom()) {
            continue;
        }
        const bool complete = (entity.state & net::StateRitualComplete) != 0;
        const double traced =
            complete ? 1.0
                     : clamp((nowSeconds_ - seen) * 1000.0 / kSacrificeRitualMillis, 0.0, 1.0);
        // On screen and its mob not out yet: it shakes the screen.
        if (!complete) ritualsTracing_.emplace_back(entity.netId, traced);

        const Vec2 centre = camera.worldToScreen(entity.position);
        const double r = radius * zoom;
        // Turned the way the server rolled it: point 0 lies along the
        // ritual's facing.
        const auto point = [&](double along, double reach) {
            const double angle = entity.angle + along * kTau / 5.0;
            return Vec2{centre.x + std::cos(angle) * reach, centre.y + std::sin(angle) * reach};
        };

        // The grey star: the pentagram's own outline, filled with grey.
        canvas.beginPath();
        for (int i = 0; i < 10; ++i) {
            const Vec2 p = point(i * 0.5, (i % 2 == 0) ? r : r * kSacrificeStarInner);
            if (i == 0) canvas.moveTo(static_cast<float>(p.x), static_cast<float>(p.y));
            else canvas.lineTo(static_cast<float>(p.x), static_cast<float>(p.y));
        }
        canvas.closePath();
        canvas.desaturate();

        // The pentagram, the size of the mob it brings -- a fifth of the
        // star -- traced point to point, every second point of the pentagon, one edge
        // after another over the ritual.
        const double edges = traced * 5.0;
        if (!(edges > 0.0)) continue;
        canvas.save();
        ui::setStroke(canvas, red);
        const double pr = r / kSacrificeRitualRadiusScale;
        canvas.setLineWidth(static_cast<float>(std::max(2.0, pr * 0.08)));
        canvas.setLineCap("round");
        canvas.setLineJoin("round");
        canvas.beginPath();
        Vec2 from = point(0, pr);
        canvas.moveTo(static_cast<float>(from.x), static_cast<float>(from.y));
        for (int edge = 0; edge < 5 && edge < edges; ++edge) {
            const Vec2 to = point(((edge + 1) * 2) % 5, pr);
            const double part = std::min(1.0, edges - edge);
            const Vec2 end = from + (to - from) * part;
            canvas.lineTo(static_cast<float>(end.x), static_cast<float>(end.y));
            from = to;
        }
        if (edges >= 5.0) canvas.closePath();
        canvas.stroke();
        canvas.restore();
    }
}

void WorldRenderer::drawLightning(Canvas& canvas, const Camera& camera) const {
    if (bolts_.empty()) return;
    const double zoom = camera.zoom();

    canvas.save();
    ui::setStroke(canvas, kLightningColor);
    canvas.setLineWidth(static_cast<float>(kLightningWidth * zoom));
    // Round on both, or every joint in a hard-angled arm shows as a notch and
    // the arm reads as a chain of separate sticks.
    canvas.setLineCap("round");
    canvas.setLineJoin("round");
    for (const LightningBolt& bolt : bolts_) {
        if (bolt.points.size() < 2) continue;
        const double t = clamp(bolt.ageSeconds / kLightningLifeSeconds, 0.0, 1.0);
        canvas.setGlobalAlpha(static_cast<float>(1.0 - t));
        canvas.beginPath();
        // One path per arm, not per run: the runs share a style, so the whole
        // polyline is a single stroke.
        const Vec2 start = camera.worldToScreen(bolt.points.front());
        canvas.moveTo(static_cast<float>(start.x), static_cast<float>(start.y));
        for (std::size_t i = 1; i < bolt.points.size(); ++i) {
            const Vec2 at = camera.worldToScreen(bolt.points[i]);
            canvas.lineTo(static_cast<float>(at.x), static_cast<float>(at.y));
        }
        canvas.stroke();
    }
    canvas.setGlobalAlpha(1.0f);
    canvas.restore();
}

} // namespace flix
