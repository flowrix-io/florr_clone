// The map's own furniture: teleporter pads, portals and their cracks, and the
// waves rift.

#include "client/render/world_renderer_internal.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>

#include "client/ui/draw.h"
#include "shared/game/map_elements.h"

namespace flix {

using namespace world_render;

namespace {

/// A teleporter is drawn as florr's web client draws a warp (client.wasm, the
/// portal component of its entity painter): everything in units of the pad's
/// radius (MapElement::padRadius) and in its colour, which is this when the
/// map gives none.
constexpr std::uint32_t kTeleporterColor = 0xFFFFFFu;

/// How far off screen a teleporter still counts as visible, in its radii: its
/// fastest sparks coast to 4 * 0.9 / ln 10 = 1.56 radii out, so it has to be
/// drawn before its centre reaches the edge.
constexpr double kTeleporterCullRadii = 1.6;
constexpr double kRiftCullRadii = 4.5;

/// The Rift's cracks, from florr's warp painter (client.wasm, the branch taken
/// when the warp's colour is black). Four or five branches leave the centre at
/// even headings, each a chain of 5 to 10 points in polar form: every step goes
/// 0.2 to 0.4 radii further out and turns up to 45 degrees, the turn dying away
/// along the branch. Each is a tapered polygon, widest near the root, and grows
/// from a hairline to a fifth of the radius as the portal opens.
///
/// florr rolls these once from the warp's id with a Lehmer generator and keeps
/// them. The same generator, restarted from the same seed each frame, gives the
/// same cracks on every frame and every client without storing anything.
void drawPortalCracks(Canvas& canvas, double radius, std::uint32_t seed, double opening) {
    constexpr std::uint64_t kModulus = 2147483647u;
    std::uint64_t state = seed % kModulus;
    if (state == 0) state = 1;
    const auto next = [&state] { return state = state * 48271u % kModulus; };
    const auto unit = [&next] { return static_cast<double>(next() - 1) / (kModulus - 2); };
    const auto between = [&next](int lo, int hi) {
        return lo + static_cast<int>(next() % static_cast<std::uint64_t>(hi - lo + 1));
    };

    const int branches = between(4, 5);
    const double first = unit() * kTau;
    const double open = std::clamp(opening, 0.0, 1.0);
    const double taper = (1.0 - open) * 3.0 + open;
    const double widest = opening * 0.2;
    struct Point {
        double x, y, width;
    };
    std::array<Point, 10> points;
    for (int branch = 0; branch < branches; ++branch) {
        const int count = between(5, 10);
        double heading = kTau / branches * branch + first;
        double reach = 0.0;
        for (int i = 0; i < count; ++i) {
            double width = std::pow(static_cast<double>(count - i - 1) / count, taper) * widest;
            if (i == 0) width = 0.0;
            if (i == 1) width *= 0.5;
            points[static_cast<std::size_t>(i)] = {reach * std::cos(heading),
                                                   reach * std::sin(heading), width};
            reach += unit() * 0.2 + 0.2;
            heading += (unit() * kPi * 0.5 - kPi * 0.25) * (count - i) / count;
        }
        // Up one side of the chain and back down the other.
        const auto vertex = [&](int i, double side) {
            const Point& here = points[static_cast<std::size_t>(i)];
            const Point& before = points[static_cast<std::size_t>(std::max(i - 1, 0))];
            const Point& after = points[static_cast<std::size_t>(std::min(i + 1, count - 1))];
            const double dx = after.x - before.x;
            const double dy = after.y - before.y;
            const double length = std::max(std::sqrt(dx * dx + dy * dy), 1e-6);
            return std::pair<float, float>(
                static_cast<float>((here.x + side * dy / length * here.width) * radius),
                static_cast<float>((here.y - side * dx / length * here.width) * radius));
        };
        canvas.beginPath();
        for (int i = 0; i < count; ++i) {
            const auto [x, y] = vertex(i, 1.0);
            if (i == 0) canvas.moveTo(x, y);
            else canvas.lineTo(x, y);
        }
        for (int i = count - 1; i >= 0; --i) {
            const auto [x, y] = vertex(i, -1.0);
            canvas.lineTo(x, y);
        }
        canvas.closePath();
        canvas.fill();
    }
}

} // namespace

void WorldRenderer::drawMapElements(Canvas& canvas, const Camera& camera, Realm realm,
                                    double timeSeconds) const {
    const MapData* map = mapFor(realm);
    if (!map) return;

    // Of everything the annotation layer carries, only the teleporters paint:
    // the browser build's MAP_COLORS are all fully transparent, its spawn
    // points draw nothing at all, and the spawn bands are tinted on the
    // minimap (ALT) but never on the ground.
    std::uint32_t pad = 0;
    for (const MapElement& element : map->elements()) {
        if (element.kind != MapElementKind::Teleporter) continue;
        ++pad;
        drawPortal(canvas, camera, element.centre(), element.padRadius,
                   element.hasColor ? element.color : kTeleporterColor, pad, timeSeconds, 1.0);
    }
}

void WorldRenderer::drawRift(Canvas& canvas, const Camera& camera, double timeSeconds) const {
    if (!rift_.open) {
        riftOpenedAtSeconds_ = -1.0;
        return;
    }
    if (riftOpenedAtSeconds_ < 0.0) riftOpenedAtSeconds_ = timeSeconds;
    if (rift_.realm != realm_) return;
    // The opening's ease: 1 - e^(-0.003078 t), t in milliseconds.
    const double opening =
        1.0 - std::exp(-0.003078 * (timeSeconds - riftOpenedAtSeconds_) * 1000.0);
    const auto seed = static_cast<std::uint32_t>(
        static_cast<std::int64_t>(rift_.position.x) * 31 + static_cast<std::int64_t>(rift_.position.y));
    drawPortal(canvas, camera, rift_.position, rift_.radius, 0x000000u, seed, timeSeconds, opening);
}

void WorldRenderer::drawPortal(Canvas& canvas, const Camera& camera, Vec2 centre,
                               double worldRadius, std::uint32_t color, std::uint32_t pad,
                               double timeSeconds, double opening) const {
    // Cracks reach four radii, where nothing else on a warp passes 1.6.
    const double cull = (color & 0xFFFFFFu) == 0u ? kRiftCullRadii : kTeleporterCullRadii;
    if (!camera.visibleWorld(worldRadius * cull).contains(centre)) return;
    // florr runs the portal on a millisecond clock, and every rate below is
    // its own, per millisecond.
    const double ms = timeSeconds * 1000.0;

    const Vec2 at = camera.worldToScreen(centre);
    const double radius = worldRadius * camera.zoom();

    canvas.save();
    canvas.translate(static_cast<float>(at.x), static_cast<float>(at.y));
    // The glow: a radial gradient, solid to a fifth of the radius and
    // clear from seven tenths of it.
    fillRadialRamp(canvas, radius * 0.7, color, 16, [radius](double r) {
        return r <= radius * 0.2 ? 1.0 : (radius * 0.7 - r) / (radius * 0.5);
    });

    // A black warp is the Rift, and only then do the cracks show.
    if ((color & 0xFFFFFFu) == 0u) drawPortalCracks(canvas, radius, pad, opening);

    // The sparks: a square is born at the centre every 10 ms and lives a
    // second. It leaves at U(1, 4) radii a second on a random heading,
    // its speed falling to a tenth every second, so at age `a` it has
    // coasted speed * (1 - 0.1^a) / ln 10 out. It spins at 4 pi a life,
    // shrinks from a tenth of the radius to nothing and fades in and out
    // on sin(life * pi). florr rolls each spark when it is born and
    // steps it every frame; here the rolls are hashed from the pad and
    // the spark's birth slot, and the flight is that step's closed form.
    constexpr double kSparkSlotMs = 10.0;
    const auto newest = static_cast<std::int64_t>(std::floor(ms / kSparkSlotMs));
    for (std::int64_t slot = newest; slot > newest - 100; --slot) {
        const double age = (ms - static_cast<double>(slot) * kSparkSlotMs) / 1000.0;
        const double life = 1.0 - age;
        const double half = life * 0.05 * radius;
        if (life <= 0.0 || half < 0.15) continue;
        const auto seed = static_cast<std::uint32_t>(slot);
        const double speed = 1.0 + 3.0 * hash01(seed, pad * 2u);
        const double heading = kTau * hash01(seed, pad * 2u + 1u);
        const double reach = speed * (1.0 - std::pow(0.1, age)) / std::log(10.0) * radius;
        const double x = std::cos(heading) * reach;
        const double y = std::sin(heading) * reach;
        const double spin = life * 2.0 * kTau;
        const double c = std::cos(spin) * half;
        const double s = std::sin(spin) * half;
        ui::setFill(canvas, color, std::sin(life * kPi));
        canvas.beginPath();
        canvas.moveTo(static_cast<float>(x + c - s), static_cast<float>(y + s + c));
        canvas.lineTo(static_cast<float>(x - c - s), static_cast<float>(y - s + c));
        canvas.lineTo(static_cast<float>(x - c + s), static_cast<float>(y - s - c));
        canvas.lineTo(static_cast<float>(x + c + s), static_cast<float>(y + s - c));
        canvas.closePath();
        canvas.fill();
    }

    // Eleven hexagons, a tenth of the radius apart and thickening inwards:
    // hexagon k is 1 - 0.1k across, stroked 0.2 + 0.1k of that wide with
    // round joins, at half alpha so the overlaps build up. All of them
    // breathe 5% on sin(t * 0.01) and turn at 3 rad/s, each the other way
    // from its neighbours.
    const double breath = std::sin(ms * 0.01) * 0.05;
    ui::setStroke(canvas, color, 0.5);
    canvas.setLineJoin("round");
    for (int k = 0; k <= 10; ++k) {
        const double size = std::abs(1.0 - 0.1 * k + breath) * radius;
        if (size < 0.25) continue;
        const double turn = ms * 0.003 * (k % 2 == 0 ? 1.0 : -1.0);
        canvas.beginPath();
        for (int corner = 0; corner < 6; ++corner) {
            const double angle = turn + corner * kTau / 6.0;
            const auto x = static_cast<float>(std::cos(angle) * size);
            const auto y = static_cast<float>(std::sin(angle) * size);
            if (corner == 0) canvas.moveTo(x, y);
            else canvas.lineTo(x, y);
        }
        canvas.closePath();
        canvas.setLineWidth(static_cast<float>((0.2 + 0.1 * k) * size));
        canvas.stroke();
    }
    canvas.restore();
}

} // namespace flix
