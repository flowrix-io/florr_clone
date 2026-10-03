#include "client/render/mob_art.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

#include "client/ui/draw.h"
#include "client/ui/theme.h"
#include "shared/core/types.h"
#include "shared/game/constants.h"
#include "svg.h"

namespace flix {

std::uint32_t outlineOf(std::uint32_t rgb) { return ui::shade(rgb, 0.8); }

namespace {

/// gardn's seeded PRNG, transcribed from `Helpers/Math.cc`.
///
/// The point of it is that a rock's facets are a function of its RADIUS and
/// nothing else: two clients drawing the same rock cut it the same way without
/// a byte about the shape crossing the wire, and one rock keeps its own outline
/// for as long as it lives rather than shimmering into a new one every frame.
class SeedGenerator {
public:
    explicit SeedGenerator(std::uint32_t seed) : seed_(seed) {}

    /// [0, 1).
    double next() {
        seed_ *= 167436543u;
        seed_ += 5832385u;
        seed_ *= (76372345u + seed_);
        seed_ += 937323u;
        return static_cast<double>(seed_ % 65536u) / 65536.0;
    }

    /// (-1, 1).
    double binext() { return next() * 2.0 - 1.0; }

private:
    std::uint32_t seed_;
};

/// One step of libc++'s linear congruential engines, mod 2^31 - 1:
/// minstd_rand0 multiplies by 16807, minstd_rand by 48271. florr scatters a
/// mob's random details from one seeded off its id.
std::uint32_t minstdStep(std::uint32_t x, std::uint32_t multiplier) {
    return static_cast<std::uint32_t>((static_cast<std::uint64_t>(x) * multiplier) % 2147483647u);
}

/// uniform_real_distribution<float>'s [0, 1) from one draw of those engines,
/// as libc++ computes it: (x - 1) / 2^31, in float.
float minstdUnit(std::uint32_t x) {
    return static_cast<float>(x - 1u) * 4.656612873077393e-10f;
}

/// The most facets or spines a body is cut into.
///
/// gardn's counts are `4 + radius/10` and `5 + radius/10`, over mobs whose
/// radius never passes 60. Ours reach 43x their base size at the top of the
/// rarity ladder, where those formulae would ask for hundreds of vertices to
/// draw detail finer than the outline around it. The cap binds only past a
/// radius of ~600 -- a mob wider than half the viewport -- and everything below
/// it is gardn's own number.
constexpr int kMaxFacets = 64;

int facetCount(double radius, int base) {
    // Clamped before the conversion, not after: a radius large enough to
    // overflow the int is nonsense rather than a very detailed rock, and the
    // conversion itself would be undefined.
    const double n = base + std::min(radius, 10.0 * kMaxFacets) / 10.0;
    return std::clamp(static_cast<int>(n), base, kMaxFacets);
}

void roundStrokes(Canvas& canvas, double width) {
    canvas.setLineWidth(static_cast<float>(width));
    canvas.setLineCap("round");
    canvas.setLineJoin("round");
}

/// florr's colour scale: each channel times `f` in square-root space, which is
/// `c * f * f`, rounded half up. florr cuts every shade of a mob from one base
/// colour this way; a part it fills at 0.9 of the base is `shadeOf(base, 0.9)`.
constexpr std::uint32_t shadeOf(std::uint32_t rgb, double f) { return ui::shade(rgb, f * f); }

/// The blend florr moves claws, mandibles and wings by, 0..1: a slow idle
/// cycle on the mob's clock, cross-faded by `aggro` into one three times as
/// fast -- a mob that has locked on snaps and buzzes, one that is wandering
/// flexes.
double clawBeat(const MobArtAttributes& attr) {
    const double idle = 0.5 - 0.5 * std::cos(attr.clockMs * 0.01);
    const double frantic = 0.5 - 0.5 * std::cos(attr.clockMs * 0.03);
    const double blend = std::clamp(attr.aggro, 0.0, 1.0);
    return idle * (1.0 - blend) + frantic * blend;
}

/// gardn's own animation phase, in radians. gardn steps it every frame it
/// draws a mob, by `(1 + 0.75 * |step|) * 0.075` -- 0.075 a frame, 4.5 rad/s at
/// its 60 fps, plus 0.05625 for every unit the body moved that frame -- so a
/// gardn bug's mandibles and wings keep time and hurry as it runs. That is the
/// mob's clock and the ground it has covered.
double gardnPhase(const MobArtAttributes& attr) {
    return attr.clockMs * 0.0045 + attr.distance * 0.05625;
}

// --- quadratic Bézier helpers, for cutting the hel beetle's shell ----------

struct Pt {
    double x, y;
};

Pt quadAt(Pt p0, Pt p1, Pt p2, double t) {
    const double u = 1.0 - t;
    return {u * u * p0.x + 2 * t * u * p1.x + t * t * p2.x,
            u * u * p0.y + 2 * t * u * p1.y + t * t * p2.y};
}

/// The control point of the piece of a quadratic between parameters a and b
/// (its blossom at (a, b)).
Pt quadControl(Pt p0, Pt p1, Pt p2, double a, double b) {
    const double w0 = (1 - a) * (1 - b), w1 = (1 - a) * b + a * (1 - b), w2 = a * b;
    return {w0 * p0.x + w1 * p1.x + w2 * p2.x, w0 * p0.y + w1 * p1.y + w2 * p2.y};
}

/// The parameter in [0, 1] at which a quadratic monotone in y reaches `y`.
double quadParamAtY(Pt p0, Pt p1, Pt p2, double y) {
    double lo = 0.0, hi = 1.0;
    const bool rising = p2.y > p0.y;
    for (int i = 0; i < 60; ++i) {
        const double mid = 0.5 * (lo + hi);
        if ((quadAt(p0, p1, p2, mid).y < y) == rising) lo = mid;
        else hi = mid;
    }
    return 0.5 * (lo + hi);
}

} // namespace

void paintFlowerEyes(Canvas& canvas, double eyeX, double eyeY) {
    canvas.save();
    ui::setFill(canvas, 0x000000u);
    canvas.beginPath();
    canvas.ellipse(-7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
    canvas.moveTo(10.2f, -4.8f);
    canvas.ellipse(7, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
    canvas.fill();
    canvas.clip();
    ui::setFill(canvas, 0xFFFFFFu);
    canvas.beginPath();
    canvas.arc(static_cast<float>(-7 + eyeX), static_cast<float>(-4.8 + eyeY),
               3, 0, static_cast<float>(kTau));
    canvas.arc(static_cast<float>(7 + eyeX), static_cast<float>(-4.8 + eyeY),
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
    canvas.restore();
}

MobArt mobArtFor(const std::string& image) {
    if (image.empty() || image[0] != '$') return MobArt::None;
    const std::string name = image.substr(1);
    if (name == "rock") return MobArt::Rock;
    if (name == "cactus") return MobArt::Cactus;
    if (name == "sandstorm") return MobArt::Sandstorm;
    if (name == "crab") return MobArt::Crab;
    if (name == "leech") return MobArt::LeechHead;
    if (name == "leech_body") return MobArt::LeechBody;
    if (name == "spider") return MobArt::Spider;
    if (name == "oracle") return MobArt::Oracle;
    if (name == "trader") return MobArt::Trader;
    // florr's ports, under florr's own names.
    static const std::pair<const char*, MobArt> kFlorr[] = {
        {"scorpion", MobArt::Scorpion},
        {"ladybug", MobArt::Ladybug},
        {"ladybug_dark", MobArt::LadybugDark},
        {"ladybug_shiny", MobArt::LadybugShiny},
        {"bee", MobArt::Bee},
        {"ant_baby", MobArt::AntBaby},
        {"ant_worker", MobArt::AntWorker},
        {"ant_soldier", MobArt::AntSoldier},
        {"ant_soldier_pet", MobArt::AntSoldierPet},
        {"ant_queen", MobArt::AntQueen},
        {"fire_ant_baby", MobArt::FireAntBaby},
        {"fire_ant_worker", MobArt::FireAntWorker},
        {"fire_ant_soldier", MobArt::FireAntSoldier},
        {"fire_ant_soldier_pet", MobArt::FireAntSoldierPet},
        {"ant_hole", MobArt::AntHole},
        {"fire_ant_burrow", MobArt::FireAntBurrow},
        {"beetle", MobArt::Beetle},
        {"beetle_hel", MobArt::BeetleHel},
        {"hornet", MobArt::Hornet},
        {"wasp", MobArt::Wasp},
        {"centipede", MobArt::Centipede},
        {"centipede_body", MobArt::CentipedeBody},
        {"centipede_evil", MobArt::CentipedeEvil},
        {"centipede_evil_body", MobArt::CentipedeEvilBody},
        {"centipede_desert", MobArt::CentipedeDesert},
        {"centipede_desert_body", MobArt::CentipedeDesertBody},
        {"bubble", MobArt::Bubble},
        {"bumble_bee", MobArt::BumbleBee},
        {"shell", MobArt::Shell},
        {"starfish", MobArt::Starfish},
        {"jellyfish", MobArt::Jellyfish},
        {"dandelion", MobArt::Dandelion},
        {"fly", MobArt::Fly},
        {"leafbug", MobArt::Leafbug},
        {"leafbug_shiny", MobArt::LeafbugShiny},
        {"mantis", MobArt::Mantis},
        {"bush", MobArt::Bush},
        {"roach", MobArt::Roach},
        {"moth", MobArt::Moth},
        {"firefly", MobArt::Firefly},
        {"firefly_magic", MobArt::FireflyMagic},
        {"dummy", MobArt::Dummy},
    };
    for (const auto& [marker, art] : kFlorr) {
        if (name == marker) return art;
    }
    return MobArt::None;
}

// ---------------------------------------------------------------------------
// Every mob drawn by code, one case each
// ---------------------------------------------------------------------------
//
// Every mob gardn draws is gardn's drawing: the rock, cactus, sandstorm,
// spider and leech up front, and after the trader the ladybugs, bee, ants,
// queen, holes, beetle, hornet and centipedes. gardn draws some of those at a
// fixed size (the ants, bee, centipedes, queen) and those cases scale by the
// radius gardn gives the mob; the rest scale themselves as gardn does. Their
// mandibles and wings move on gardnPhase, and their colours are gardn's.
//
// The crab, oracle and trader are reference captures. Everything else -- the
// scorpion, and every mob gardn has no drawing for -- is florr's own client,
// ported. Those florr cases keep a few rules:
//
//   * florr scales each mob by `entity radius / design radius` and then draws
//     in its design units -- the ant worker for a radius of 20, the scorpion
//     for 40 -- and so does each case: `scale(radius / design)` and florr's
//     numbers after it. The body florr draws for that radius is the hitbox,
//     so these mobs carry no `visual_scale`.
//   * The colours are florr's constants, and its shades are `shadeOf(base, f)`
//     rather than a darker hex someone picked.
//   * A part florr builds from an SVG path string is that same string here,
//     parsed once into a function-local `static const Path2D` and filled or
//     stroked as a Path2D. A Path2D is flattened with the transform in force
//     when it is FILLED on both backends; an immediate path is not (the web
//     backend bakes its points as they are added), so no case moves the
//     transform between `beginPath` and `fill`.
//   * florr's `getFillPath` -- a stroke's outline, filled -- is a stroke at
//     that width with the same caps and joins.
//   * Legs step on `distance` (kGaitRadiansPerUnitWalked); claws, mandibles
//     and wings keep `clockMs` (clawBeat). florr's draw order is kept.
//   * Facing is +x.

void paintMobArt(Canvas& canvas, MobArt art, const MobArtAttributes& attr) {
    if (attr.radius <= 0.0) return;

    // The bee's feelers, which the bumble bee and the moth share outright: a
    // stalk hooked out from the front of the head on each side with a ball on
    // its tip. The -y one first, as florr lays them.
    const auto clubbedFeelers = [&canvas]() {
        ui::setStroke(canvas, 0x333333u);
        ui::setFill(canvas, 0x333333u);
        canvas.setLineWidth(3.0f);
        for (const float side : {-1.0f, 1.0f}) {
            canvas.beginPath();
            canvas.moveTo(25.0f, 5.0f * side);
            canvas.quadraticCurveTo(35.0f, 5.0f * side, 40.0f, 15.0f * side);
            canvas.stroke();
            canvas.beginPath();
            canvas.arc(40.0f, 15.0f * side, 5.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
        }
    };

    // The fly's pair of wings, which the moth wears too: two ovals swept back a
    // tenth of a turn from the shoulders, each beating a tenth of a turn about
    // the body's centre on the claw beat, at half opacity. Two fills, not one
    // path: where the wings cross they are twice as dense, as florr's are.
    const auto beatingWings = [&canvas, &attr](std::uint32_t color) {
        constexpr double kSweep = kPi / 10.0;
        const double beat = clawBeat(attr);
        ui::setFill(canvas, color, 0.5);
        for (const double side : {-1.0, 1.0}) {
            canvas.save();
            canvas.rotate(static_cast<float>(side * kSweep * beat));
            canvas.beginPath();
            canvas.ellipse(-7.0f, static_cast<float>(8.0 * side), 12.0f, 9.0f,
                           static_cast<float>(-side * kSweep), 0.0f, static_cast<float>(kTau));
            canvas.fill();
            canvas.restore();
        }
    };

    switch (art) {
        case MobArt::Rock: {
            const double radius = attr.radius;
            const int sides = facetCount(radius, 4);

            // Seeded off the radius alone, in 64 bits so that a boss-sized rock
            // wraps rather than overflowing the conversion.
            SeedGenerator gen(static_cast<std::uint32_t>(
                static_cast<std::uint64_t>(std::floor(radius)) * 1957264ull + 295726ull));

            // gardn's 10% of the radius. Past its own size range that would
            // exceed the facet it displaces -- the chord shrinks towards a
            // constant as the sides multiply while 0.1r does not -- and the
            // outline crosses itself into a scribble. A quarter of the chord is
            // well clear of every deflection the reference range produces, so
            // this is gardn's rock wherever gardn has one.
            const double chord = 2.0 * radius * std::sin(kPi / sides);
            const double deflection = std::min(radius * 0.1, chord * 0.25);

            ui::setFill(canvas, attr.baseColor);
            ui::setStroke(canvas, outlineOf(attr.baseColor));
            roundStrokes(canvas, 5.0);
            canvas.beginPath();
            {
                const double x = radius + gen.binext() * deflection;
                const double y = gen.binext() * deflection;
                canvas.moveTo(static_cast<float>(x), static_cast<float>(y));
            }
            for (int i = 1; i < sides; ++i) {
                const double angle = kTau * i / sides;
                const double x = std::cos(angle) * radius + gen.binext() * deflection;
                const double y = std::sin(angle) * radius + gen.binext() * deflection;
                canvas.lineTo(static_cast<float>(x), static_cast<float>(y));
            }
            canvas.closePath();
            canvas.fill();
            canvas.stroke();
            break;
        }

        case MobArt::Cactus: {
            const double radius = attr.radius;
            const int spines = facetCount(radius, 5);
            const double step = kTau / spines;

            // The spines first, so the body is laid over their roots and only
            // the 10 units that clear it show. gardn rotates the canvas between
            // spines and fills them all at once; this rotates the POINTS,
            // because a path here is flattened with the transform in force when
            // it is filled rather than the one in force when each point was
            // added.
            ui::setFill(canvas, 0x222222u);
            canvas.beginPath();
            for (int i = 0; i < spines; ++i) {
                const double angle = step * i;
                const double c = std::cos(angle), s = std::sin(angle);
                const auto point = [&](double x, double y) {
                    canvas.lineTo(static_cast<float>(x * c - y * s),
                                  static_cast<float>(x * s + y * c));
                };
                canvas.moveTo(static_cast<float>((10.0 + radius) * c),
                              static_cast<float>((10.0 + radius) * s));
                point(0.5 + radius, 3.0);
                point(0.5 + radius, -3.0);
                point(10.0 + radius, 0.0);
            }
            canvas.fill();

            ui::setFill(canvas, attr.baseColor);
            ui::setStroke(canvas, outlineOf(attr.baseColor));
            roundStrokes(canvas, 5.0);
            canvas.beginPath();
            canvas.moveTo(static_cast<float>(radius), 0.0f);
            for (int i = 0; i < spines; ++i) {
                // Each lobe bulges IN to 0.9r between two spines, which is what
                // makes the silhouette read as segments rather than as a circle
                // with hairs.
                const double base = step * i;
                canvas.quadraticCurveTo(
                    static_cast<float>(radius * 0.9 * std::cos(base + step * 0.5)),
                    static_cast<float>(radius * 0.9 * std::sin(base + step * 0.5)),
                    static_cast<float>(radius * std::cos(base + step)),
                    static_cast<float>(radius * std::sin(base + step)));
            }
            canvas.fill();
            canvas.stroke();
            break;
        }

        case MobArt::Sandstorm: {
            const double radius = attr.radius;
            // Three hexagons at three different fractions of the same phase, so
            // the layers shear against each other instead of turning as one
            // body. The shape does not scale with the radius -- only the picture
            // does -- which is why the line width has to: it is what rounds the
            // corners off.
            const double spin = attr.animation / 3.0;
            roundStrokes(canvas, radius / 5.0);

            const double shades[3] = {1.0, 0.9, 0.8};
            const double scales[3] = {1.0, 2.0 / 3.0, 1.0 / 3.0};
            canvas.save();
            for (int layer = 0; layer < 3; ++layer) {
                canvas.rotate(static_cast<float>(spin));
                const std::uint32_t color = ui::shade(attr.baseColor, shades[layer]);
                ui::setFill(canvas, color);
                ui::setStroke(canvas, color);
                const double r = radius * scales[layer];
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(r), 0.0f);
                for (int i = 1; i <= 6; ++i) {
                    const double angle = kTau * i / 6.0;
                    canvas.lineTo(static_cast<float>(std::cos(angle) * r),
                                  static_cast<float>(std::sin(angle) * r));
                }
                canvas.fill();
                canvas.stroke();
            }
            canvas.restore();
            break;
        }

        case MobArt::Scorpion: {
            // florr's scorpion, drawn for a radius of 40, the length of its
            // body: two claws pinching on the claw beat, eight legs stepping on
            // the ground it covers, a plated body, and a tail segment florr
            // ships as an SVG path with the sting laid over its tip.
            constexpr double kDesign = 40.0;
            /// Every shade of the body is cut from this.
            constexpr std::uint32_t base = 0xDBAB32u;
            constexpr std::uint32_t kLimb = 0x333333u;
            /// The tail segment's outline, in its own asset space: florr parks
            /// it with `translate(-30, 0) scale(0.4) translate(-46.513, -36.112)`.
            static const Path2D tail = svgPathData(
                "M.60856,36.22244c.22547,23.75,8.46627,35.625,31.45093,35.5s51-13,60.42638-35.5"
                "C78.25893-.24285-2.86909-21.41022.60856,36.22244Z");
            /// The four legs a side, each swinging 0.2 rad about its own rest
            /// angle a quarter turn behind the one before -- so the gait
            /// ripples down the flank.
            constexpr double kLegRest[4] = {-0.7, -0.23333333333333334, 0.23333333333333325, 0.7};
            constexpr double kLegLength = 37.0;

            canvas.save();
            const double s = attr.radius / kDesign;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 7.0);

            // --- claws -----------------------------------------------------
            // Each is turned about its root at (15, 0) and squashed to 0.7
            // across, so the pinch is a rotation of a flattened blade rather
            // than of the drawing.
            const double pinch = clawBeat(attr);
            ui::setFill(canvas, kLimb);
            ui::setStroke(canvas, kLimb);
            for (const double side : {-1.0, 1.0}) {
                // The first claw is the one on +y; it closes by turning toward -y.
                const double y = -side;
                canvas.save();
                canvas.translate(15.0f, 0.0f);
                canvas.rotate(static_cast<float>(side * 0.2 * pinch));
                canvas.scale(1.0f, 0.7f);
                canvas.beginPath();
                canvas.moveTo(-10.0f, static_cast<float>(15.0 * y));
                canvas.quadraticCurveTo(15.0f, static_cast<float>(30.0 * y), 35.0f,
                                        static_cast<float>(15.0 * y));
                canvas.quadraticCurveTo(15.0f, static_cast<float>(20.0 * y), -10.0f,
                                        static_cast<float>(5.0 * y));
                canvas.closePath();
                canvas.fill();
                canvas.stroke();
                canvas.restore();
            }

            // --- legs ------------------------------------------------------
            // Still the claws' stroke: florr never sets a width between them.
            // The -y flank is the +y one mirrored through the body's axis.
            const double stride = attr.distance * kGaitRadiansPerUnitWalked;
            canvas.beginPath();
            for (const double side : {-1.0, 1.0}) {
                for (int k = 0; k < 4; ++k) {
                    double angle = kLegRest[k] -
                                   0.2 * std::cos(side * kPi * 0.5 + k * kPi * 0.5 + stride);
                    if (side < 0) angle = -kPi - angle;
                    const double x = std::sin(angle) * kLegLength;
                    const double y = std::cos(angle) * kLegLength;
                    canvas.moveTo(0.0f, 0.0f);
                    canvas.quadraticCurveTo(static_cast<float>(x * 0.8),
                                            static_cast<float>(y * 0.5), static_cast<float>(x),
                                            static_cast<float>(y));
                }
            }
            canvas.stroke();

            // --- body ------------------------------------------------------
            const std::uint32_t rim = shadeOf(base, 0.85);
            ui::setFill(canvas, shadeOf(base, 0.95));
            ui::setStroke(canvas, rim);
            canvas.beginPath();
            canvas.moveTo(0.0f, -30.0f);
            canvas.quadraticCurveTo(40.0f, -20.0f, 40.0f, 0.0f);
            canvas.quadraticCurveTo(40.0f, 20.0f, 0.0f, 30.0f);
            canvas.quadraticCurveTo(-40.0f, 35.0f, -40.0f, 0.0f);
            canvas.quadraticCurveTo(-40.0f, -35.0f, 0.0f, -30.0f);
            canvas.closePath();
            canvas.fill();
            canvas.stroke();

            // The plates across the back, in the body's outline shade.
            canvas.beginPath();
            canvas.moveTo(22.0f, -12.0f);
            canvas.quadraticCurveTo(26.0f, 0.0f, 22.0f, 12.0f);
            canvas.moveTo(7.0f, -18.0f);
            canvas.quadraticCurveTo(10.5f, 0.0f, 7.0f, 18.0f);
            canvas.moveTo(-7.0f, -18.0f);
            canvas.quadraticCurveTo(-10.5f, 0.0f, -7.0f, 18.0f);
            canvas.moveTo(-22.0f, -15.0f);
            canvas.quadraticCurveTo(-27.0f, 0.0f, -22.0f, 15.0f);
            canvas.stroke();

            // --- tail ------------------------------------------------------
            // Laid over the back of the body, in the full base colour and
            // ringed at 0.9 of it; the ring is 15 wide in the asset's own units.
            const std::uint32_t tailRim = shadeOf(base, 0.9);
            canvas.save();
            canvas.translate(-30.0f, 0.0f);
            canvas.scale(0.4f, 0.4f);
            canvas.translate(-46.51258850097656f, -36.1117057800293f);
            ui::setFill(canvas, base);
            canvas.fill(tail);
            ui::setStroke(canvas, tailRim);
            canvas.setLineWidth(15.0f);
            canvas.stroke(tail);
            canvas.restore();

            ui::setStroke(canvas, tailRim);
            canvas.setLineWidth(4.0f);
            canvas.beginPath();
            canvas.moveTo(-26.0f, -4.0f);
            canvas.quadraticCurveTo(-27.5f, 0.0f, -26.0f, 4.0f);
            canvas.moveTo(-36.0f, -5.0f);
            canvas.quadraticCurveTo(-39.0f, 0.0f, -36.0f, 5.0f);
            canvas.stroke();

            // The sting, pointing back up the body from the tail's tip.
            ui::setFill(canvas, kLimb);
            ui::setStroke(canvas, 0x292929u);
            canvas.beginPath();
            canvas.moveTo(-8.0f, 0.0f);
            canvas.lineTo(-15.0f, -7.0f);
            canvas.lineTo(-15.0f, 7.0f);
            canvas.closePath();
            canvas.fill();
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::Crab: {
            // flooooio's MobRendererCrab, drawn at its own design radius of 25:
            // eight legs that swing and two claws that open and close. Facing
            // is +x: the claws lead, the legs splay off the flanks.
            canvas.save();
            canvas.scale(static_cast<float>(attr.radius / 25.0),
                         static_cast<float>(attr.radius / 25.0));

            /// Legs, claws and the line around them: one dark shell-brown for
            /// all of them, as in the reference. Only the carapace takes the
            /// mob's own colour.
            constexpr std::uint32_t kLimb = 0x4D2621u;

            // --- legs ------------------------------------------------------
            // Four a side. Each hangs off a hip spaced along the body's x axis,
            // swings about that hip on its own phase and bends once at the
            // knee; the front pair of a side bends forward and the back pair
            // back, which is what stops all eight from moving as one comb. They
            // step on the ground the crab covers; the claws below keep the clock.
            //
            // The reference walks the canvas transform per leg -- translate to
            // the hip, rotate, draw, translate again to the knee -- and gets its
            // points from it. The points are computed here instead, so the
            // transform never moves inside the path.
            const double gait = attr.distance * kGaitRadiansPerUnitWalked;
            ui::setStroke(canvas, kLimb);
            roundStrokes(canvas, 5.0);
            canvas.beginPath();
            for (int side = 0; side < 2; ++side) {
                const double flank = side == 0 ? -1.0 : 1.0;
                for (int i = 0; i < 4; ++i) {
                    const double swing = 0.15 * std::sin(gait + flank + 2.0 * i) + 0.15;
                    const double legDir = i < 2 ? 1.0 : -1.0;
                    const double hipX = 4.0 * i - 5.0;
                    const double knee = legDir * 0.7 * (swing + 0.3);
                    const double hip = swing * legDir;
                    const double cosHip = std::cos(hip), sinHip = std::sin(hip);
                    // Hip at the origin, knee 25 down the leg, foot 10 past the bend.
                    const double footX = -10.0 * std::sin(knee);
                    const double footY = 25.0 + 10.0 * std::cos(knee);
                    const auto px = [&](double x, double y) {
                        return static_cast<float>(x * cosHip - y * sinHip + hipX);
                    };
                    const auto py = [&](double x, double y) {
                        return static_cast<float>((x * sinHip + y * cosHip) * flank);
                    };
                    canvas.moveTo(px(0.0, 0.0), py(0.0, 0.0));
                    canvas.lineTo(px(0.0, 25.0), py(0.0, 25.0));
                    canvas.lineTo(px(footX, footY), py(footX, footY));
                }
            }
            canvas.stroke();

            // --- claws -----------------------------------------------------
            // One at a time under its own transform, set BEFORE the path is
            // opened. The reference carries a second, much longer path here --
            // the outline of stroking this one at a width of 2, baked out.
            // Filling this path and then stroking it at 2 is that picture.
            const double clawAngle = 0.15 * std::sin(attr.animation * 2.0) + 0.15;
            ui::setFill(canvas, kLimb);
            ui::setStroke(canvas, kLimb);
            roundStrokes(canvas, 2.0);
            for (int side = 0; side < 2; ++side) {
                const double flank = side == 0 ? -1.0 : 1.0;
                canvas.save();
                canvas.translate(12.0f, static_cast<float>(2.0 * flank));
                canvas.scale(1.0f, static_cast<float>(-flank));
                canvas.rotate(static_cast<float>(clawAngle));
                canvas.beginPath();
                canvas.moveTo(0.0f, -14.0f);
                canvas.quadraticCurveTo(11.0f, -20.0f, 16.0f, -9.0f);
                canvas.lineTo(11.0f, -12.0f);
                canvas.lineTo(13.0f, -7.0f);
                canvas.quadraticCurveTo(6.0f, -13.0f, 0.0f, -10.0f);
                canvas.lineTo(0.0f, -14.0f);
                canvas.closePath();
                canvas.fill();
                canvas.stroke();
                canvas.restore();
            }

            // --- carapace --------------------------------------------------
            // Taller than it is wide, and laid over the legs and the claw
            // roots. The reference fills a second baked band for the outline; a
            // stroke at 4 is that band.
            ui::setFill(canvas, attr.baseColor);
            ui::setStroke(canvas, outlineOf(attr.baseColor));
            roundStrokes(canvas, 4.0);
            canvas.beginPath();
            canvas.moveTo(0.0f, -23.0f);
            canvas.quadraticCurveTo(-7.4558f, -23.0f, -12.7279f, -16.2635f);
            canvas.quadraticCurveTo(-18.0f, -9.5269f, -18.0f, 0.0f);
            canvas.quadraticCurveTo(-18.0f, 9.5269f, -12.7279f, 16.2635f);
            canvas.quadraticCurveTo(-7.4558f, 23.0f, 0.0f, 23.0f);
            canvas.quadraticCurveTo(7.4558f, 23.0f, 12.7279f, 16.2635f);
            canvas.quadraticCurveTo(18.0f, 9.5269f, 18.0f, 0.0f);
            canvas.quadraticCurveTo(18.0f, -9.5269f, 12.7279f, -16.2635f);
            canvas.quadraticCurveTo(7.4558f, -23.0f, 0.0f, -23.0f);
            canvas.closePath();
            canvas.fill();
            canvas.stroke();

            // The two creases across the shell, in the carapace's own outline
            // colour.
            canvas.beginPath();
            canvas.moveTo(-10.0f, 8.0f);
            canvas.quadraticCurveTo(0.0f, 3.0f, 10.0f, 8.0f);
            canvas.moveTo(-10.0f, -8.0f);
            canvas.quadraticCurveTo(0.0f, -3.0f, 10.0f, -8.0f);
            canvas.stroke();

            canvas.restore();
            break;
        }

        // --- the leech -----------------------------------------------------
        //
        // One tube, painted a joint at a time. The reference strokes a
        // polyline through every segment's centre at width 25 and again at 22;
        // ours cannot see the polyline, so each segment strokes the ONE span it
        // does know -- its own centre to its leader's -- and the spans abut
        // into the same shape.
        //
        // Two rules make that work, and both are the chain pass's doing
        // (placeFollower in mob_ai.cpp): a segment is held exactly
        // `kSegmentSpacingPerRadius` radii behind its leader, and it is turned
        // to point straight AT it with no turn limit. So the leader's centre is
        // at (spacing, 0) in the segment's own frame, every frame, and a
        // round-capped bar to that point lands its cap exactly on the leader's
        // own body.
        //
        // There is deliberately no outline. The reference's is 0.75 units on a
        // body 25 across -- under a pixel at any zoom the game plays at -- and
        // drawing it per segment is the one thing this scheme cannot do: a
        // segment's outline would paint over its leader's fill, and the seam
        // that puts at every joint is exactly the bead-chain look the bar is
        // here to avoid.

        case MobArt::LeechHead: {
            // The front cap of the tube, and the beak. The head paints no bar --
            // there is nothing in front of it to reach -- and needs none: the
            // first segment's bar ends its cap on this disc.
            //
            // gardn's beak is drawn at a body radius of 12.5 and opens on an
            // angle the reference streams from the server. Nothing on our wire
            // carries it, so it rides the walk phase instead, exactly as the
            // crab's claws do -- which also means it chomps faster once the
            // leech has locked on.
            const double beakAngle = 0.15 * std::sin(attr.animation) + 0.15;
            canvas.save();
            canvas.scale(static_cast<float>(attr.radius / 12.5),
                         static_cast<float>(attr.radius / 12.5));

            // Beak first, body over it: the reference's order, which is what
            // buries the roots of both mandibles inside the head.
            ui::setStroke(canvas, 0x292929u);
            roundStrokes(canvas, 4.0);
            for (int side = 0; side < 2; ++side) {
                const double sign = side == 0 ? -1.0 : 1.0;
                canvas.save();
                canvas.rotate(static_cast<float>(beakAngle * sign));
                canvas.beginPath();
                canvas.moveTo(0.0f, static_cast<float>(10.0 * sign));
                canvas.quadraticCurveTo(11.0f, static_cast<float>(10.0 * sign), 22.0f,
                                        static_cast<float>(5.0 * sign));
                canvas.stroke();
                canvas.restore();
            }

            ui::setFill(canvas, attr.baseColor);
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 12.5f, 0.0f, static_cast<float>(kTau), false);
            canvas.fill();

            canvas.restore();
            break;
        }

        case MobArt::LeechBody: {
            // The joint between this segment and the one it is following. A
            // segment whose leader has been killed is promoted to a chain of its
            // own by the server but still draws this bar, so a leech cut in half
            // wears a short nose until it despawns. That is the price of not
            // knowing the chain, and it is the same shape a segment that still
            // HAD a leader would draw.
            ui::setStroke(canvas, attr.baseColor);
            roundStrokes(canvas, attr.radius * 2.0);
            canvas.beginPath();
            canvas.moveTo(0.0f, 0.0f);
            canvas.lineTo(static_cast<float>(attr.radius * kSegmentSpacingPerRadius), 0.0f);
            canvas.stroke();
            break;
        }

        case MobArt::Spider: {
            // gardn's spider, drawn at gardn's own body radius of 15: the legs
            // are 35 long against that 15, so they stay the same length against
            // the body at every tier rather than a fixed number of units that a
            // mythic's body would swallow.
            constexpr double kDesignRadius = 15.0;
            canvas.save();
            canvas.scale(static_cast<float>(attr.radius / kDesignRadius),
                         static_cast<float>(attr.radius / kDesignRadius));

            // --- legs ------------------------------------------------------
            // Eight curves out of the centre, all one path under the body. As
            // on the scorpion, the endpoint takes the sine on X and the cosine
            // on Y, which splays four down each flank; the pairs swing on
            // alternating sine and cosine so neighbours never move together.
            // They step on the ground the spider covers: one standing still
            // holds its legs still.
            const double gait = attr.distance * kGaitRadiansPerUnitWalked;
            const double s = std::sin(gait) * 0.2;
            const double c = std::cos(gait) * 0.2;
            const double legAngles[8] = {
                -kPi + 0.9 + s, -kPi + 0.3 + c, -kPi - 0.3 + s, -kPi - 0.9 - c,
                -0.9 - s,       -0.3 + c,       0.3 - s,        0.9 - c,
            };
            ui::setStroke(canvas, 0x333333u);
            roundStrokes(canvas, 5.0);
            canvas.beginPath();
            for (const double angle : legAngles) {
                const double x = std::sin(angle) * 35.0;
                const double y = std::cos(angle) * 35.0;
                canvas.moveTo(0.0f, 0.0f);
                canvas.quadraticCurveTo(static_cast<float>(x * 0.8), static_cast<float>(y * 0.5),
                                        static_cast<float>(x), static_cast<float>(y));
            }
            canvas.stroke();

            // --- body ------------------------------------------------------
            ui::setFill(canvas, attr.baseColor);
            ui::setStroke(canvas, outlineOf(attr.baseColor));
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, static_cast<float>(kDesignRadius), 0.0f,
                       static_cast<float>(kTau), false);
            canvas.fill();
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::Oracle: {
            // Built from the reference art (oracle.svg, a 12-frame capture),
            // which is laid out on a body 28 units across: a dark disc with ten
            // tendrils rooted on its rim, a gold ring, the flower-yellow body,
            // and one great eye in the middle. Every number below is that
            // drawing's, stated against its 28 and scaled by the radius,
            // because the oracle is one creature at every size -- ten tendrils
            // is its anatomy.
            //
            // The tendrils are the capture's motion fitted to a curve: each one
            // swings sideways off its own spoke on a sine, a little under one
            // radian each way, one period every seven and a half seconds, each a
            // steady step of phase behind the one before -- so the wave runs
            // round the body. A tendril swung hard over is also a longer one,
            // and it bends: its control point turns only 0.7 as far as its tip,
            // which is what curls it rather than pivoting a stick.
            constexpr double kArtRadius = 28.0;
            constexpr int kTendrils = 10;
            /// The capture's sway: ~0.85 radians of phase a second, against the
            /// walk clock's 4.5 (kMobWalkRadiansPerSecond) -- so a hurried,
            /// chasing oracle waves twice as fast.
            constexpr double kSwayPerWalkRadian = 0.19;
            constexpr double kSwayAmplitude = 0.9;
            constexpr double kSwayPhaseStep = 0.97;
            constexpr double kCurl = 0.7;
            /// Tip and control distances from the root: a base, plus a stretch
            /// per radian of sway.
            constexpr double kTipBase = 5.9;
            constexpr double kTipStretch = 2.9;
            constexpr double kControlBase = 4.4;
            constexpr double kControlStretch = 0.95;
            constexpr double kTendrilWidth = 5.0;
            constexpr double kRingRadius = 26.5;
            constexpr double kBodyRadius = 23.5;
            constexpr double kSocketRadius = 15.0;
            constexpr double kPupilRadius = 10.5;
            /// How far the pupil's centre travels: exactly the room between it
            /// and the socket, so it runs right up to the rim and never through.
            constexpr double kPupilTravel = kSocketRadius - kPupilRadius;
            constexpr double kSocketRim = 2.5;
            constexpr std::uint32_t kInk = 0x111111u;
            constexpr std::uint32_t kPupil = 0xEEEEEEu;

            const double radius = attr.radius;
            const double s = radius / kArtRadius;
            const auto circle = [&canvas](double r, std::uint32_t color, Vec2 at = {}) {
                ui::setFill(canvas, color);
                canvas.fillCircle(static_cast<float>(at.x), static_cast<float>(at.y),
                                  static_cast<float>(r));
            };

            // The dark disc the tendrils grow from, and the tendrils: one path,
            // the points worked out on each spoke rather than rotating the
            // canvas between them, for the reason the cactus gives.
            circle(radius, kInk);
            const double phase = attr.animation * kSwayPerWalkRadian;
            ui::setStroke(canvas, kInk);
            roundStrokes(canvas, kTendrilWidth * s);
            canvas.beginPath();
            for (int i = 0; i < kTendrils; ++i) {
                const double spoke = kTau * i / kTendrils;
                const double sway = kSwayAmplitude * std::sin(phase + i * kSwayPhaseStep);
                const double stretch = std::fabs(sway);
                const Vec2 root = Vec2::fromAngle(spoke, radius);
                const Vec2 control =
                    root + Vec2::fromAngle(spoke + sway * kCurl,
                                           (kControlBase + kControlStretch * stretch) * s);
                const Vec2 tip =
                    root + Vec2::fromAngle(spoke + sway, (kTipBase + kTipStretch * stretch) * s);
                canvas.moveTo(static_cast<float>(root.x), static_cast<float>(root.y));
                canvas.quadraticCurveTo(static_cast<float>(control.x),
                                        static_cast<float>(control.y), static_cast<float>(tip.x),
                                        static_cast<float>(tip.y));
            }
            canvas.stroke();

            // Over the tendrils' roots: the gold ring, then the body. The ring
            // is the body colour's own outline shade -- gardn's 0.8 -- which for
            // the flower yellow is the reference's #CFBB50 to within a step.
            circle(kRingRadius * s, outlineOf(attr.baseColor));
            circle(kBodyRadius * s, attr.baseColor);

            // The eye. The pupil is placed by `gaze` and never leaves the
            // socket: an eased gaze cutting across between two bearings is
            // shorter than one, and a longer one is clamped. The rim goes on
            // LAST, over the pupil's edge, which is what seats it in the socket
            // rather than on top of it.
            Vec2 gaze = attr.gaze;
            if (gaze.lengthSq() > 1.0) gaze = gaze * (1.0 / gaze.length());
            circle(kSocketRadius * s, kInk);
            circle(kPupilRadius * s, kPupil, gaze * (kPupilTravel * s));
            ui::setStroke(canvas, kInk);
            canvas.setLineWidth(static_cast<float>(kSocketRim * s));
            canvas.strokeCircle(0.0f, 0.0f, static_cast<float>(kSocketRadius * s));
            break;
        }

        case MobArt::Trader: {
            // Built from the reference art (trader.svg, a 12-frame capture): a
            // player's flower -- the 26.5 ring, the 23.5 body, the eyes and the
            // resting smile, at exactly a player's proportions in its radius-25
            // art space -- sitting in a ring of twelve basic petals, 8.75
            // across, set 25 out and 30 degrees apart.
            //
            // The capture gets two things wrong, and neither is copied:
            //
            //   * It strokes every petal's WHOLE outline, so the seams where
            //     neighbouring petals overlap are drawn in grey across the
            //     white. The ring is one silhouette with a border on its outside
            //     only: each petal gives the outline just its OUTER arc, from
            //     where it crosses the petal behind it to where it crosses the
            //     one ahead, and the twelve arcs close into one path that is
            //     filled and stroked once.
            //   * Its pupils wander through their sockets and out of them. A
            //     trader's eyes are a flower's eyes (paintFlowerEyes), placed by
            //     `gaze` scaled to the flower's own eye travel.
            /// The ring's outer edge -- petal orbit plus petal radius -- which
            /// is the trader's body radius: the middle of its outline, as a
            /// mob's hitbox is.
            constexpr double kArtRadius = 33.75;
            constexpr int kPetals = 12;
            constexpr double kPetalOrbit = 25.0;
            constexpr double kPetalRadius = 8.75;
            /// The basic petal's own white and its #CFCFCF rim, three wide.
            constexpr double kPetalRim = 3.0;
            /// A player's face, as WorldRenderer::drawFace draws it at rest.
            constexpr double kFlowerRingRadius = 26.5;
            constexpr double kFlowerBodyRadius = 23.5;
            constexpr double kFlowerRestingMouth = 14.5;

            const double s = attr.radius / kArtRadius;
            canvas.save();
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // Where two neighbouring petals cross on the outside: on the line
            // halfway between their spokes, `cross` out from the middle. Each
            // petal's outer arc runs `sweep` either side of its own spoke,
            // measured about the petal's centre, which is exactly the arc from
            // one crossing to the next.
            const double half = kPi / kPetals;
            const double off = kPetalOrbit * std::sin(half);
            const double cross =
                kPetalOrbit * std::cos(half) + std::sqrt(kPetalRadius * kPetalRadius - off * off);
            const double sweep =
                std::atan2(cross * std::sin(half), cross * std::cos(half) - kPetalOrbit);
            canvas.beginPath();
            for (int i = 0; i < kPetals; ++i) {
                const double spoke = kTau * i / kPetals;
                const Vec2 at = Vec2::fromAngle(spoke, kPetalOrbit);
                canvas.arc(static_cast<float>(at.x), static_cast<float>(at.y),
                           static_cast<float>(kPetalRadius), static_cast<float>(spoke - sweep),
                           static_cast<float>(spoke + sweep), false);
            }
            canvas.closePath();
            ui::setFill(canvas, 0xFFFFFFu);
            canvas.fill();
            // Round, so the stroke's inside turns each notch the way a stroke
            // round the union of twelve discs would, rather than spiking into
            // the white.
            ui::setStroke(canvas, 0xCFCFCFu);
            canvas.setLineWidth(static_cast<float>(kPetalRim));
            canvas.setLineJoin("round");
            canvas.stroke();

            // The flower: its ring in the body colour's outline shade, the
            // body, the eyes where it is looking, and the smile a player wears
            // at rest.
            ui::setFill(canvas, outlineOf(attr.baseColor));
            canvas.fillCircle(0.0f, 0.0f, static_cast<float>(kFlowerRingRadius));
            ui::setFill(canvas, attr.baseColor);
            canvas.fillCircle(0.0f, 0.0f, static_cast<float>(kFlowerBodyRadius));

            Vec2 gaze = attr.gaze;
            if (gaze.lengthSq() > 1.0) gaze = gaze * (1.0 / gaze.length());
            paintFlowerEyes(canvas, gaze.x * kFlowerEyeTravelX, gaze.y * kFlowerEyeTravelY);

            ui::setStroke(canvas, 0x222222u);
            canvas.setLineWidth(1.5f);
            canvas.setLineCap("round");
            canvas.beginPath();
            canvas.moveTo(-6.0f, 10.0f);
            canvas.quadraticCurveTo(0.0f, static_cast<float>(kFlowerRestingMouth), 6.0f, 10.0f);
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::Ladybug:
        case MobArt::LadybugDark:
        case MobArt::LadybugShiny: {
            // gardn's ladybug, which scales itself to radius / 30. Its spots are
            // scattered from a SeedGenerator seeded off the mob's id: one to
            // seven of them, clipped to the shell.
            const bool dark = art == MobArt::LadybugDark;
            const std::uint32_t base = dark                           ? 0x962921u
                                       : art == MobArt::LadybugShiny ? 0xEBEB34u
                                                                     : 0xEB4034u;
            static const Path2D shell = [] {
                Path2D path;
                path.moveTo(24.760068893432617f, 16.939273834228516f);
                path.quadraticCurveTo(17.74359130859375f, 27.195226669311523f, 5.530136585235596f,
                                      29.485883712768555f);
                path.quadraticCurveTo(-6.683317184448242f, 31.77654457092285f,
                                      -16.939273834228516f, 24.760068893432617f);
                path.quadraticCurveTo(-27.195226669311523f, 17.74359130859375f,
                                      -29.485883712768555f, 5.530136585235596f);
                path.quadraticCurveTo(-31.77654457092285f, -6.683317184448242f,
                                      -24.760068893432617f, -16.939273834228516f);
                path.quadraticCurveTo(-17.74359130859375f, -27.195226669311523f,
                                      -5.530136585235596f, -29.485883712768555f);
                path.quadraticCurveTo(6.683317184448242f, -31.77654457092285f,
                                      16.939273834228516f, -24.760068893432617f);
                path.quadraticCurveTo(19.241104125976562f, -23.185302734375f,
                                      21.213199615478516f, -21.213205337524414f);
                path.quadraticCurveTo(23.1852970123291f, -19.241111755371094f,
                                      24.76006507873535f, -16.939281463623047f);
                path.quadraticCurveTo(10.0f, 0.0f, 24.760068893432617f, 16.939273834228516f);
                return path;
            }();
            // The rim: the shell's outline 3.5 out, and back round 3.5 in.
            static const Path2D rim = [] {
                Path2D path;
                path.moveTo(27.64874267578125f, 18.915523529052734f);
                path.quadraticCurveTo(19.813682556152344f, 30.36800765991211f, 6.175320625305176f,
                                      32.925907135009766f);
                path.quadraticCurveTo(-7.463029861450195f, 35.48381042480469f, -18.91551971435547f,
                                      27.648746490478516f);
                path.quadraticCurveTo(-30.36800765991211f, 19.813682556152344f,
                                      -32.925907135009766f, 6.175320625305176f);
                path.quadraticCurveTo(-35.48381042480469f, -7.463029861450195f,
                                      -27.648746490478516f, -18.91551971435547f);
                path.quadraticCurveTo(-19.813682556152344f, -30.36800765991211f,
                                      -6.175320625305176f, -32.925907135009766f);
                path.quadraticCurveTo(7.463029861450195f, -35.48381042480469f, 18.91551971435547f,
                                      -27.648746490478516f);
                path.quadraticCurveTo(24.10110092163086f, -24.101102828979492f,
                                      27.648740768432617f, -18.915529251098633f);
                path.quadraticCurveTo(28.323867797851562f, -17.928699493408203f,
                                      28.25410270690918f, -16.73506736755371f);
                path.quadraticCurveTo(28.184337615966797f, -15.541434288024902f,
                                      27.398849487304688f, -14.639973640441895f);
                path.quadraticCurveTo(14.642288208007812f, 0.0f, 27.398853302001953f,
                                      14.639965057373047f);
                path.quadraticCurveTo(28.184343338012695f, 15.541427612304688f,
                                      28.254106521606445f, 16.735061645507812f);
                path.quadraticCurveTo(28.323869705200195f, 17.928693771362305f,
                                      27.64874267578125f, 18.9155216217041f);
                path.lineTo(27.64874267578125f, 18.915523529052734f);
                path.moveTo(21.871395111083984f, 14.963025093078613f);
                path.lineTo(24.760068893432617f, 16.939273834228516f);
                path.lineTo(22.12128448486328f, 19.238582611083984f);
                path.quadraticCurveTo(5.3577117919921875f, 0.0f, 22.121280670166016f,
                                      -19.238590240478516f);
                path.lineTo(24.76006507873535f, -16.939281463623047f);
                path.lineTo(21.871389389038086f, -14.963033676147461f);
                path.quadraticCurveTo(19.065046310424805f, -19.0650577545166f, 14.96302318572998f,
                                      -21.871395111083984f);
                path.quadraticCurveTo(5.903592586517334f, -28.06928253173828f,
                                      -4.884955406188965f, -26.045866012573242f);
                path.quadraticCurveTo(-15.673511505126953f, -24.022449493408203f,
                                      -21.871395111083984f, -14.96302318572998f);
                path.quadraticCurveTo(-28.06928253173828f, -5.903592586517334f,
                                      -26.045866012573242f, 4.884955406188965f);
                path.quadraticCurveTo(-24.022449493408203f, 15.673511505126953f,
                                      -14.96302318572998f, 21.871395111083984f);
                path.quadraticCurveTo(-5.903592586517334f, 28.06928253173828f, 4.884955406188965f,
                                      26.045866012573242f);
                path.quadraticCurveTo(15.673511505126953f, 24.022449493408203f,
                                      21.871395111083984f, 14.963025093078613f);
                return path;
            }();

            canvas.save();
            const double s = attr.radius / 30.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            ui::setFill(canvas, 0x111111u);
            canvas.beginPath();
            canvas.arc(15.0f, 0.0f, 18.5f, 0.0f, static_cast<float>(kTau));
            canvas.fill();

            ui::setFill(canvas, base);
            canvas.fill(shell);
            canvas.save();
            canvas.clip(shell);
            ui::setFill(canvas, dark ? ui::shade(base, 1.2) : 0x111111u);
            SeedGenerator gen(attr.seed * 374572u + 46237u);
            const auto count = static_cast<std::uint32_t>(1 + gen.next() * 7);
            for (std::uint32_t i = 0; i < count; ++i) {
                const double x = gen.binext() * 30;
                const double y = gen.binext() * 30;
                const double r = 4 + gen.next() * 5;
                canvas.beginPath();
                canvas.arc(static_cast<float>(x), static_cast<float>(y), static_cast<float>(r),
                           0.0f, static_cast<float>(kTau));
                canvas.fill();
            }
            canvas.restore();

            ui::setFill(canvas, outlineOf(base));
            canvas.fill(rim);

            canvas.restore();
            break;
        }

        case MobArt::Bee: {
            // gardn's bee, drawn for its radius of 20.
            constexpr std::uint32_t kBase = 0xFFE763u;
            canvas.save();
            const double s = attr.radius / 20.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 5.0);

            ui::setFill(canvas, 0x333333u);
            ui::setStroke(canvas, 0x292929u);
            canvas.beginPath();
            canvas.moveTo(-25.0f, 9.0f);
            canvas.lineTo(-37.0f, 0.0f);
            canvas.lineTo(-25.0f, -9.0f);
            canvas.fill();
            canvas.stroke();

            ui::setFill(canvas, kBase);
            canvas.beginPath();
            canvas.ellipse(0.0f, 0.0f, 30.0f, 20.0f, 0.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
            canvas.save();
            canvas.clip();
            ui::setFill(canvas, 0x333333u);
            canvas.fillRect(-30.0f, -20.0f, 10.0f, 40.0f);
            canvas.fillRect(-10.0f, -20.0f, 10.0f, 40.0f);
            canvas.fillRect(10.0f, -20.0f, 10.0f, 40.0f);
            canvas.restore();

            ui::setStroke(canvas, outlineOf(kBase));
            canvas.beginPath();
            canvas.ellipse(0.0f, 0.0f, 30.0f, 20.0f, 0.0f, 0.0f, static_cast<float>(kTau));
            canvas.stroke();

            ui::setStroke(canvas, 0x333333u);
            ui::setFill(canvas, 0x333333u);
            canvas.setLineWidth(3.0f);
            for (const float side : {-1.0f, 1.0f}) {
                canvas.beginPath();
                canvas.moveTo(25.0f, 5.0f * side);
                canvas.quadraticCurveTo(35.0f, 5.0f * side, 40.0f, 15.0f * side);
                canvas.stroke();
                canvas.beginPath();
                canvas.arc(40.0f, 15.0f * side, 5.0f, 0.0f, static_cast<float>(kTau));
                canvas.fill();
            }

            canvas.restore();
            break;
        }

        case MobArt::AntBaby:
        case MobArt::AntWorker:
        case MobArt::AntSoldier:
        case MobArt::AntSoldierPet:
        case MobArt::FireAntBaby:
        case MobArt::FireAntWorker:
        case MobArt::FireAntSoldier:
        case MobArt::FireAntSoldierPet: {
            // gardn's ants, drawn for its radii: 14 for the baby, 19 for the
            // rest. A head with two mandibles twitching on gardn's phase; a
            // worker adds an abdomen, a soldier wings. gardn's fire ant is its
            // soldier in rust; the fire ant's baby and worker, which gardn
            // lacks, are its baby and worker in the same rust. A summoned ant
            // wears the flower yellow.
            const bool pet = art == MobArt::AntSoldierPet || art == MobArt::FireAntSoldierPet;
            const bool fire = art == MobArt::FireAntBaby || art == MobArt::FireAntWorker ||
                              art == MobArt::FireAntSoldier;
            const std::uint32_t base = pet ? 0xFFE763u : fire ? 0xA82A00u : 0x555555u;
            const bool baby = art == MobArt::AntBaby || art == MobArt::FireAntBaby;
            const bool winged =
                !baby && art != MobArt::AntWorker && art != MobArt::FireAntWorker;
            const double a = std::sin(gardnPhase(attr));
            const float head = baby ? 0.0f : 4.0f;

            canvas.save();
            const double s = attr.radius / (baby ? 14.0 : 19.0);
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 7.0);

            if (!baby) {
                ui::setFill(canvas, base);
                ui::setStroke(canvas, outlineOf(base));
                canvas.beginPath();
                canvas.arc(-12.0f, 0.0f, 10.0f, 0.0f, static_cast<float>(kTau));
                canvas.fill();
                canvas.stroke();
            }
            if (winged) {
                ui::setFill(canvas, 0xEEEEEEu, 128.0 / 255.0);
                for (const double side : {-1.0, 1.0}) {
                    canvas.save();
                    canvas.rotate(static_cast<float>(-side * 0.1 * a));
                    canvas.translate(-11.0f, static_cast<float>(8.0 * side));
                    canvas.rotate(static_cast<float>(-side * 0.1 * kPi));
                    canvas.beginPath();
                    canvas.ellipse(0.0f, 0.0f, 15.0f, 7.0f, 0.0f, 0.0f, static_cast<float>(kTau));
                    canvas.fill();
                    canvas.restore();
                }
            }

            ui::setStroke(canvas, 0x292929u);
            canvas.beginPath();
            canvas.moveTo(head, -7.0f);
            canvas.quadraticCurveTo(head + 11.0f, static_cast<float>(-10.0 + a), head + 22.0f,
                                    static_cast<float>(-5.0 + a));
            canvas.moveTo(head, 7.0f);
            canvas.quadraticCurveTo(head + 11.0f, static_cast<float>(10.0 - a), head + 22.0f,
                                    static_cast<float>(5.0 - a));
            canvas.stroke();

            ui::setFill(canvas, base);
            ui::setStroke(canvas, outlineOf(base));
            canvas.beginPath();
            canvas.arc(head, 0.0f, 14.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::AntQueen: {
            // gardn's queen, drawn for its radius of 40. gardn paints the
            // thorax's ring in the body colour, so only the abdomen and the head
            // wear one.
            const double a = std::sin(gardnPhase(attr));
            canvas.save();
            const double s = attr.radius / 40.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            const auto disc = [&canvas](std::uint32_t color, float x, float r) {
                ui::setFill(canvas, color);
                canvas.beginPath();
                canvas.arc(x, 0.0f, r, 0.0f, static_cast<float>(kTau));
                canvas.fill();
            };
            disc(0x454545u, -25.0f, 33.5f);
            disc(0x555555u, -25.0f, 26.5f);
            disc(0x555555u, 0.0f, 28.5f);
            disc(0x555555u, 0.0f, 21.5f);

            ui::setFill(canvas, 0xEEEEEEu, 127.0 / 255.0);
            for (const double side : {-1.0, 1.0}) {
                canvas.save();
                canvas.rotate(static_cast<float>(-side * a * 0.1));
                canvas.beginPath();
                canvas.ellipse(-14.0f, static_cast<float>(16.0 * side), 30.0f, 14.0f,
                               static_cast<float>(-side * kPi / 10.0), 0.0f,
                               static_cast<float>(kTau));
                canvas.fill();
                canvas.restore();
            }

            ui::setStroke(canvas, 0x292929u);
            roundStrokes(canvas, 7.0);
            canvas.beginPath();
            canvas.moveTo(25.0f, -10.5f);
            canvas.quadraticCurveTo(41.5f, static_cast<float>(-15.0 + 2.0 * a), 58.0f,
                                    static_cast<float>(-7.5 + 2.0 * a));
            canvas.moveTo(25.0f, 10.5f);
            canvas.quadraticCurveTo(41.5f, static_cast<float>(15.0 - 2.0 * a), 58.0f,
                                    static_cast<float>(7.5 - 2.0 * a));
            canvas.stroke();

            disc(0x454545u, 25.0f, 24.5f);
            disc(0x555555u, 25.0f, 17.5f);

            canvas.restore();
            break;
        }

        case MobArt::AntHole:
        case MobArt::FireAntBurrow: {
            // gardn's ant hole and ant burrow: three discs at the full radius,
            // two thirds and one third of it, each a darker earth.
            const std::uint32_t base = art == MobArt::FireAntBurrow ? 0xB52D00u : 0xB58500u;
            const auto disc = [&canvas](std::uint32_t color, double r) {
                ui::setFill(canvas, color);
                canvas.beginPath();
                canvas.arc(0.0f, 0.0f, static_cast<float>(r), 0.0f, static_cast<float>(kTau));
                canvas.fill();
            };
            disc(base, attr.radius);
            disc(outlineOf(base), attr.radius * 2 / 3);
            disc(ui::shade(base, 0.6), attr.radius / 3);
            break;
        }

        case MobArt::Beetle: {
            // gardn's beetle, which scales itself to radius / 35: two mandibles
            // pinching a tenth of a radian on gardn's phase, a shell inside a
            // ring of its own 0.8 shade, a seam and six dimples.
            constexpr std::uint32_t kBase = 0x905DB0u;
            const double a = std::sin(gardnPhase(attr));
            canvas.save();
            const double s = attr.radius / 35.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            ui::setFill(canvas, 0x333333u);
            ui::setStroke(canvas, 0x333333u);
            roundStrokes(canvas, 7.0);
            for (const double side : {1.0, -1.0}) {
                canvas.save();
                canvas.translate(35.0f, 0.0f);
                canvas.rotate(static_cast<float>(-side * 0.1 * a));
                canvas.beginPath();
                canvas.moveTo(-10.0f, static_cast<float>(15.0 * side));
                canvas.quadraticCurveTo(15.0f, static_cast<float>(30.0 * side), 35.0f,
                                        static_cast<float>(15.0 * side));
                canvas.quadraticCurveTo(15.0f, static_cast<float>(20.0 * side), -10.0f,
                                        static_cast<float>(5.0 * side));
                canvas.lineTo(-10.0f, static_cast<float>(15.0 * side));
                canvas.fill();
                canvas.stroke();
                canvas.restore();
            }

            ui::setFill(canvas, kBase);
            canvas.beginPath();
            canvas.moveTo(0.0f, -30.0f);
            canvas.quadraticCurveTo(40.0f, -30.0f, 40.0f, 0.0f);
            canvas.quadraticCurveTo(40.0f, 30.0f, 0.0f, 30.0f);
            canvas.quadraticCurveTo(-40.0f, 30.0f, -40.0f, 0.0f);
            canvas.quadraticCurveTo(-40.0f, -30.0f, 0.0f, -30.0f);
            canvas.fill();

            const std::uint32_t mark = outlineOf(kBase);
            ui::setFill(canvas, mark);
            canvas.beginPath();
            canvas.moveTo(0.0f, -33.5f);
            canvas.quadraticCurveTo(43.5f, -33.5f, 43.5f, 0.0f);
            canvas.quadraticCurveTo(43.5f, 33.5f, 0.0f, 33.5f);
            canvas.quadraticCurveTo(-43.5f, 33.5f, -43.5f, 0.0f);
            canvas.quadraticCurveTo(-43.5f, -33.5f, 0.0f, -33.5f);
            canvas.moveTo(0.0f, -26.5f);
            canvas.quadraticCurveTo(-36.5f, -26.5f, -36.5f, 0.0f);
            canvas.quadraticCurveTo(-36.5f, 26.5f, 0.0f, 26.5f);
            canvas.quadraticCurveTo(36.5f, 26.5f, 36.5f, 0.0f);
            canvas.quadraticCurveTo(36.5f, -26.5f, 0.0f, -26.5f);
            canvas.fill("evenodd");

            ui::setStroke(canvas, mark);
            canvas.beginPath();
            canvas.moveTo(-20.0f, 0.0f);
            canvas.quadraticCurveTo(0.0f, -3.0f, 20.0f, 0.0f);
            canvas.stroke();

            canvas.beginPath();
            for (const auto& d : {std::pair<float, float>{-17, -12}, {-17, 12}, {0, -15},
                                  {0, 15}, {17, -12}, {17, 12}}) {
                canvas.moveTo(d.first + 5.0f, d.second);
                canvas.arc(d.first, d.second, 5.0f, 0.0f, static_cast<float>(kTau));
            }
            canvas.fill("evenodd");

            canvas.restore();
            break;
        }

        case MobArt::BeetleHel: {
            // gardn has no hel beetle, so it is florr's, drawn for a radius of
            // 40: a shell with a bite taken out of its nose, and five teeth set
            // on an arc behind the bite showing through it, each creeping in
            // and out on its own phase. Seam and dimples in 0.9 of the shell.
            constexpr std::uint32_t kBase = 0xAD1717u;
            static const Path2D seam = svgPathData("M-20 0Q0 -3 20 0");
            // florr subtracts "M33-22Q19 0 34 23L46 23 46-22Z" -- the bite --
            // from the shell "M0-30Q40-30 40 0 40 30 0 30-40 30-40 0-40-30
            // 0-30Z", then fills the result and outlines THAT shape. The canvas
            // has no path arithmetic, so the shape is rebuilt from the two
            // contours: the shell's front quads are cut where the bite's edge
            // crosses them, and the bite's edge between those points closes it.
            static const Path2D bitten = [] {
                const Pt top{0, -30}, nose{40, 0}, bottom{0, 30}, tail{-40, 0};
                const Pt cUpper{40, -30}, cLower{40, 30}, cLowerBack{-40, 30},
                    cUpperBack{-40, -30};
                const Pt b0{33, -22}, bc{19, 0}, b2{34, 23};
                const auto shellFrontX = [&](double y) {
                    return y < 0
                               ? quadAt(top, cUpper, nose, quadParamAtY(top, cUpper, nose, y)).x
                               : quadAt(nose, cLower, bottom,
                                        quadParamAtY(nose, cLower, bottom, y))
                                     .x;
                };
                const auto crossing = [&](double lo, double hi) {
                    const auto inside = [&](double t) {
                        const Pt p = quadAt(b0, bc, b2, t);
                        return p.x < shellFrontX(p.y);
                    };
                    const bool loInside = inside(lo);
                    for (int i = 0; i < 60; ++i) {
                        const double mid = 0.5 * (lo + hi);
                        if (inside(mid) == loInside) lo = mid;
                        else hi = mid;
                    }
                    return 0.5 * (lo + hi);
                };
                const double s0 = crossing(0.0, 0.5);
                const double s1 = crossing(0.5, 1.0);
                const Pt enter = quadAt(b0, bc, b2, s0);
                const Pt leave = quadAt(b0, bc, b2, s1);
                const double tUpper = quadParamAtY(top, cUpper, nose, enter.y);
                const double tLower = quadParamAtY(nose, cLower, bottom, leave.y);

                const auto f = [](double v) { return static_cast<float>(v); };
                Path2D path;
                path.moveTo(f(top.x), f(top.y));
                const Pt c0 = quadControl(top, cUpper, nose, 0.0, tUpper);
                path.quadraticCurveTo(f(c0.x), f(c0.y), f(enter.x), f(enter.y));
                const Pt c1 = quadControl(b0, bc, b2, s0, s1);
                path.quadraticCurveTo(f(c1.x), f(c1.y), f(leave.x), f(leave.y));
                const Pt c2 = quadControl(nose, cLower, bottom, tLower, 1.0);
                path.quadraticCurveTo(f(c2.x), f(c2.y), f(bottom.x), f(bottom.y));
                path.quadraticCurveTo(f(cLowerBack.x), f(cLowerBack.y), f(tail.x), f(tail.y));
                path.quadraticCurveTo(f(cUpperBack.x), f(cUpperBack.y), f(top.x), f(top.y));
                path.closePath();
                return path;
            }();

            canvas.save();
            const double s = attr.radius / 40.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // Rooted 0.45 rad apart on a circle of radius 40 about (65, 0), each
            // a sliver 0.16 rad wide; the phase steps 0.3 per ms and half a unit
            // more per ms of being locked on.
            const double phase = 0.3 * attr.clockMs + 0.5 * attr.aggroMs;
            ui::setFill(canvas, 0x1F1F1Fu);
            ui::setStroke(canvas, 0x1F1F1Fu);
            roundStrokes(canvas, 2.0);
            constexpr double kCentreX = 65.0;
            constexpr double kArc = 40.0;
            for (int i = 0; i < 5; ++i) {
                const double at = (i * 0.25 - 0.5) * 2.0 * 0.45;
                const double a0 = at + 0.08, a1 = at - 0.08;
                const Pt root0{kCentreX - kArc * std::cos(a0), -kArc * std::sin(a0)};
                const Pt root1{kCentreX - kArc * std::cos(a1), -kArc * std::sin(a1)};
                const double reach = 0.65 + std::sin(phase * 0.015 + 2.0 * i) * 0.04;
                const Pt mid{(root0.x + root1.x) * 0.5, (root0.y + root1.y) * 0.5};
                const Pt tip{kCentreX + (mid.x - kCentreX) * reach, mid.y * reach};
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(root0.x), static_cast<float>(root0.y));
                canvas.lineTo(static_cast<float>(root1.x), static_cast<float>(root1.y));
                canvas.lineTo(static_cast<float>(tip.x), static_cast<float>(tip.y));
                canvas.closePath();
                canvas.fill();
                canvas.stroke();
            }

            ui::setFill(canvas, kBase);
            canvas.fill(bitten);
            const std::uint32_t mark = shadeOf(kBase, 0.9);
            ui::setStroke(canvas, mark);
            roundStrokes(canvas, 7.0);
            canvas.stroke(bitten);

            canvas.stroke(seam);
            ui::setFill(canvas, mark);
            constexpr float kDimples[6][2] = {{-17, -12}, {-17, 12}, {0, -15},
                                              {0, 15},    {17, -12}, {17, 12}};
            for (const auto& d : kDimples) {
                canvas.beginPath();
                canvas.arc(d[0], d[1], 5.0f, 0.0f, static_cast<float>(kTau));
                canvas.fill();
            }

            canvas.restore();
            break;
        }

        case MobArt::Hornet: {
            // gardn's hornet, which scales itself to radius / 30: a sting, three
            // bands clipped to the body, a rim, and two flat feelers. gardn fills
            // the feelers in whatever fill was in force after the bands' clip
            // was undone -- the body's yellow -- and outlines them in black.
            constexpr std::uint32_t kBase = 0xFFD363u;
            canvas.save();
            const double s = attr.radius / 30.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 5.0);

            ui::setFill(canvas, 0x333333u);
            ui::setStroke(canvas, 0x292929u);
            canvas.beginPath();
            canvas.moveTo(-25.0f, -6.0f);
            canvas.lineTo(-47.0f, 0.0f);
            canvas.lineTo(-25.0f, 6.0f);
            canvas.fill();
            canvas.stroke();

            ui::setFill(canvas, kBase);
            canvas.beginPath();
            canvas.ellipse(0.0f, 0.0f, 30.0f, 20.0f, 0.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
            canvas.save();
            canvas.clip();
            ui::setFill(canvas, 0x333333u);
            canvas.fillRect(-30.0f, -20.0f, 10.0f, 40.0f);
            canvas.fillRect(-10.0f, -20.0f, 10.0f, 40.0f);
            canvas.fillRect(10.0f, -20.0f, 10.0f, 40.0f);
            canvas.restore();

            ui::setStroke(canvas, outlineOf(kBase));
            canvas.beginPath();
            canvas.ellipse(0.0f, 0.0f, 30.0f, 20.0f, 0.0f, 0.0f, static_cast<float>(kTau));
            canvas.stroke();

            ui::setStroke(canvas, 0x333333u);
            canvas.setLineWidth(3.0f);
            canvas.beginPath();
            canvas.moveTo(25.0f, 5.0f);
            canvas.quadraticCurveTo(40.0f, 10.0f, 50.0f, 15.0f);
            canvas.quadraticCurveTo(40.0f, 5.0f, 25.0f, 5.0f);
            canvas.moveTo(25.0f, -5.0f);
            canvas.quadraticCurveTo(40.0f, -10.0f, 50.0f, -15.0f);
            canvas.quadraticCurveTo(40.0f, -5.0f, 25.0f, -5.0f);
            canvas.fill("evenodd");
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::Wasp: {
            // gardn has no wasp, so it is florr's: drawn for a radius of 30 and
            // enlarged by 1.3 on top. A sting, two amber bands bowed back at the
            // middle cut to the body, a rim, and a pair of flat, swept feelers
            // that flick a fifth of a radian each way on the clock while it is
            // worked up.
            static const Path2D body = [] {
                Path2D oval;
                oval.ellipse(0.0f, 0.0f, 30.0f, 20.0f, 0.0f, 0.0f, static_cast<float>(kTau));
                return oval;
            }();
            static const Path2D sting = svgPathData("M11 0-11-10-11 10Z");
            static const Path2D feeler = svgPathData("M0 0Q15 5 33 14 15 0 0 0Z");
            static const Path2D stripes = [] {
                Path2D bands;
                const auto band = [&bands](float left, float width) {
                    const float right = left + width;
                    bands.moveTo(left, -20.0f);
                    bands.lineTo(right, -20.0f);
                    bands.quadraticCurveTo(right - 10.0f, 0.0f, right, 20.0f);
                    bands.lineTo(left, 20.0f);
                    bands.quadraticCurveTo(left - 10.0f, 0.0f, left, -20.0f);
                    bands.closePath();
                };
                band(5.0f, 10.0f);
                band(-15.0f, 15.0f);
                return bands;
            }();

            canvas.save();
            const double s = attr.radius / 30.0 * 1.3;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 5.0);

            // florr draws the sting only when the mob has no world entity --
            // in the world the loaded missile is an entity of its own. Ours
            // fires a fresh one, so the sting is always drawn here.
            ui::setFill(canvas, 0x333333u);
            ui::setStroke(canvas, 0x333333u);
            canvas.save();
            canvas.translate(-36.0f, 0.0f);
            canvas.rotate(static_cast<float>(kPi));
            canvas.fill(sting);
            canvas.stroke(sting);
            canvas.restore();

            ui::setFill(canvas, 0xC8803Cu);
            canvas.fill(body);
            canvas.save();
            canvas.clip(body);
            ui::setFill(canvas, 0x333333u);
            canvas.fill(stripes);
            canvas.restore();
            ui::setStroke(canvas, 0xB77334u);
            canvas.stroke(body);

            const double worked = std::clamp(attr.aggro, 0.0, 1.0);
            const double flick =
                worked > 0.001 ? std::sin(attr.clockMs * 0.03) * worked * 0.2 : 0.0;
            ui::setFill(canvas, 0x333333u);
            ui::setStroke(canvas, 0x333333u);
            canvas.setLineWidth(3.0f);
            for (const float side : {-1.0f, 1.0f}) {
                canvas.save();
                canvas.scale(1.0f, side);
                canvas.translate(25.0f, 5.0f);
                canvas.rotate(static_cast<float>(flick));
                canvas.fill(feeler);
                canvas.stroke(feeler);
                canvas.restore();
            }
            canvas.restore();
            break;
        }

        case MobArt::Centipede:
        case MobArt::CentipedeBody:
        case MobArt::CentipedeEvil:
        case MobArt::CentipedeEvilBody:
        case MobArt::CentipedeDesert:
        case MobArt::CentipedeDesertBody: {
            // gardn's centipedes, drawn for their radius of 35: a dark foot
            // either side, the body ringed in its 0.8 shade, and on a head two
            // antennae, each a stalk ending in a bead.
            const bool head = art == MobArt::Centipede || art == MobArt::CentipedeEvil ||
                              art == MobArt::CentipedeDesert;
            const std::uint32_t base =
                art == MobArt::CentipedeEvil || art == MobArt::CentipedeEvilBody ? 0x905DB0u
                : art == MobArt::CentipedeDesert || art == MobArt::CentipedeDesertBody
                    ? 0xD4C66Eu
                    : 0x8AC255u;

            canvas.save();
            const double s = attr.radius / 35.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 7.0);

            ui::setFill(canvas, 0x333333u);
            for (const float y : {-30.0f, 30.0f}) {
                canvas.beginPath();
                canvas.arc(0.0f, y, 15.0f, 0.0f, static_cast<float>(kTau));
                canvas.fill();
            }

            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 35.0f, 0.0f, static_cast<float>(kTau));
            ui::setFill(canvas, base);
            canvas.fill();
            ui::setStroke(canvas, outlineOf(base));
            canvas.stroke();

            if (head) {
                ui::setStroke(canvas, 0x333333u);
                ui::setFill(canvas, 0x333333u);
                canvas.setLineWidth(3.0f);
                for (const float side : {-1.0f, 1.0f}) {
                    canvas.beginPath();
                    canvas.moveTo(25.0f, 10.0f * side);
                    canvas.quadraticCurveTo(45.0f, 10.0f * side, 55.0f, 30.0f * side);
                    canvas.stroke();
                    canvas.beginPath();
                    canvas.arc(55.0f, 30.0f * side, 5.0f, 0.0f, static_cast<float>(kTau));
                    canvas.fill();
                }
            }
            canvas.restore();
            break;
        }

        case MobArt::Bubble: {
            // Drawn for a radius of 12: a white ring, a white disc just inside
            // it, and a glint up and to the right -- all translucent, so it is
            // the ground showing through that colours it. florr scales the
            // renderer's opacity to 0.7 for the ring and halves it again for the
            // disc and the glint, and the paint takes each as a byte. Nothing on
            // it moves.
            canvas.save();
            const double s = attr.radius / 12.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            ui::setStroke(canvas, 0xFFFFFFu, 178.0 / 255.0);
            canvas.setLineWidth(1.0f);
            canvas.strokeCircle(0.0f, 0.0f, 12.0f);

            // The glint is its own fill over the disc, so it shows twice as
            // white.
            ui::setFill(canvas, 0xFFFFFFu, 89.0 / 255.0);
            canvas.fillCircle(0.0f, 0.0f, 11.5f);
            canvas.fillCircle(4.0f, -4.0f, 3.0f);

            canvas.restore();
            break;
        }

        case MobArt::BumbleBee: {
            // Drawn for a radius of 27.5: the bee's plan on a rounder body, no
            // sting, and a golden rim. Its bands are plain rectangles the full
            // height of the body, trimmed to it by a clip. Nothing on it moves.
            static const Path2D body = [] {
                Path2D oval;
                oval.ellipse(0.0f, 0.0f, 30.0f, 25.0f, 0.0f, 0.0f, static_cast<float>(kTau));
                return oval;
            }();
            canvas.save();
            const double s = attr.radius / 27.5;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 5.0);

            ui::setFill(canvas, 0xFFD363u);
            canvas.fill(body);
            canvas.save();
            canvas.clip(body);
            ui::setFill(canvas, 0x333333u);
            // The left edge of each band, ten wide.
            for (const float left : {10.0f, -10.0f, -30.0f}) {
                canvas.fillRect(left, -25.0f, 10.0f, 50.0f);
            }
            canvas.restore();
            ui::setStroke(canvas, 0xCFAB50u);
            canvas.stroke(body);

            clubbedFeelers();
            canvas.restore();
            break;
        }

        case MobArt::Shell: {
            // Drawn for a radius of 30 and nudged 3 back along its axis: a hinge
            // tab behind, the fan of the shell over it -- a 144 degree arc of the
            // rim closed by three curves through the hinge -- and four ridges
            // fanning out from the hinge across it. One sand colour; everything
            // but the fan is its 0.9 shade. It holds still.
            constexpr std::uint32_t kBase = 0xFCDD86u;
            /// The fan's rim runs this far either side of the shell's axis.
            constexpr double kRimHalfAngle = 72.0 * kPi / 180.0;

            canvas.save();
            const double s = attr.radius / 30.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            canvas.translate(-3.0f, 0.0f);
            roundStrokes(canvas, 5.0);

            const std::uint32_t outline = shadeOf(kBase, 0.9);

            // The hinge tab, filled and ringed in the outline shade.
            ui::setFill(canvas, outline);
            ui::setStroke(canvas, outline);
            canvas.beginPath();
            canvas.moveTo(-20.0f, -15.0f);
            canvas.quadraticCurveTo(-15.0f, 0.0f, -20.0f, 15.0f);
            canvas.lineTo(0.0f, 3.0f);
            canvas.lineTo(0.0f, -3.0f);
            canvas.closePath();
            canvas.fill();
            canvas.stroke();

            // The fan: the rim from -72 to +72 degrees, then back through the
            // hinge. Its last curve ends where the rim began -- florr's own
            // constant for that point, (9.2705, -28.5317), is 30 at -72 degrees.
            ui::setFill(canvas, kBase);
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 30.0f, static_cast<float>(-kRimHalfAngle),
                       static_cast<float>(kRimHalfAngle));
            canvas.quadraticCurveTo(0.0f, 20.0f, -15.0f, 8.0f);
            canvas.quadraticCurveTo(-20.0f, 0.0f, -15.0f, -8.0f);
            canvas.quadraticCurveTo(0.0f, -20.0f, 9.270508766174316f, -28.531696319580078f);
            canvas.closePath();
            canvas.fill();
            canvas.stroke();

            // The ridges, each its own stroke, outermost first.
            canvas.setLineWidth(4.0f);
            const auto ridge = [&](float x0, float y0, float cy, float x1, float y1) {
                canvas.beginPath();
                canvas.moveTo(x0, y0);
                canvas.quadraticCurveTo(0.0f, cy, x1, y1);
                canvas.stroke();
            };
            ridge(12.0f, 15.0f, 8.0f, -8.0f, 5.0f);
            ridge(17.4f, 6.0f, 3.2f, -6.2f, 2.0f);
            ridge(17.4f, -6.0f, -3.2f, -6.2f, -2.0f);
            ridge(12.0f, -15.0f, -8.0f, -8.0f, -5.0f);

            canvas.restore();
            break;
        }

        case MobArt::Starfish: {
            // Drawn for a radius of 20: five arms whose tips sit 30 out, joined
            // by curves pulled almost to the centre, filled and ringed twice --
            // a 10-wide ring in the body's 0.9 shade, then a 5-wide one in the
            // body colour over it -- and a row of pale spots running out along
            // each arm.
            //
            // It wears its damage. Each arm is full length while the starfish's
            // health is above that arm's threshold and shrinks to half length
            // below it, taking its two outer spots with it: the arm at 288
            // degrees goes below 80% health, the one at 72 below 60%, the one at
            // 216 below 40%, the one at 144 below 20%. The arm along the facing
            // never goes. (florr eases each arm between its two lengths over a
            // few frames; here it snaps.)
            //
            // And it spins while it hunts: florr turns it at 5 rad/s times its
            // eased locked-on blend, accumulating the angle frame by frame --
            // which is 5 rad/s of `aggroMs`, so the turn picks up as it locks on
            // and stops where it is when it lets go. (florr also spins it back
            // at 2 rad/s on a second state flag the attributes do not carry;
            // that counter-turn is left out.)
            constexpr std::uint32_t kBody = 0xD14F4Du;
            constexpr int kArms = 5;
            /// The curves between two tips have their control point at this
            /// fraction of the sum of the tips -- almost at the centre, which is
            /// what makes the arms.
            constexpr double kWaist = 0.05;
            /// The health below which each arm, by its place round the body,
            /// is lost.
            constexpr double kArmLostBelow[kArms] = {0.0, 0.6, 0.2, 0.4, 0.8};
            /// The spots along an arm: how far out, how big, and how much of
            /// the arm must be left for it to show.
            struct Spot {
                double distance, radius, needs;
            };
            constexpr Spot kSpots[] = {{25.0, 2.0, 0.8}, {18.0, 3.0, 0.5}, {9.0, 4.0, 0.0}};

            canvas.save();
            const double s = attr.radius / 20.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // florr keeps the angle wrapped to a turn; so does this, for the float.
            canvas.rotate(static_cast<float>(std::fmod(attr.aggroMs * (5.0 / 1000.0), kTau)));

            // 1 for a whole arm, 0 for a lost one; a lost arm keeps half its
            // length.
            double arm[kArms];
            Vec2 tip[kArms];
            for (int i = 0; i < kArms; ++i) {
                arm[i] = attr.health >= kArmLostBelow[i] ? 1.0 : 0.0;
                const double reach = 30.0 * (0.5 + 0.5 * arm[i]);
                tip[i] = Vec2::fromAngle(kTau * i / kArms, reach);
            }

            Path2D body;
            body.moveTo(static_cast<float>(tip[0].x), static_cast<float>(tip[0].y));
            for (int i = 1; i <= kArms; ++i) {
                const Vec2 from = tip[i - 1];
                const Vec2 to = tip[i % kArms];
                body.quadraticCurveTo(static_cast<float>((from.x + to.x) * kWaist),
                                      static_cast<float>((from.y + to.y) * kWaist),
                                      static_cast<float>(to.x), static_cast<float>(to.y));
            }
            body.closePath();

            roundStrokes(canvas, 10.0);
            const std::uint32_t outline = shadeOf(kBody, 0.9);
            ui::setFill(canvas, outline);
            ui::setStroke(canvas, outline);
            canvas.fill(body);
            canvas.stroke(body);

            canvas.setLineWidth(5.0f);
            ui::setFill(canvas, kBody);
            ui::setStroke(canvas, kBody);
            canvas.fill(body);
            canvas.stroke(body);

            ui::setFill(canvas, 0xD4766Cu);
            for (int i = 0; i < kArms; ++i) {
                const double angle = kTau * i / kArms;
                for (const Spot& spot : kSpots) {
                    if (arm[i] < spot.needs) continue;
                    const Vec2 at = Vec2::fromAngle(angle, spot.distance);
                    canvas.fillCircle(static_cast<float>(at.x), static_cast<float>(at.y),
                                      static_cast<float>(spot.radius));
                }
            }

            canvas.restore();
            break;
        }

        case MobArt::Jellyfish: {
            // Drawn for a radius of 50: eight tentacles trailing from just inside
            // the bell, then the bell over them -- an opaque white rim and a
            // half-clear white disc. florr drops the renderer's opacity to 0.7
            // for the tentacles only, so they read as ghostly beside the solid
            // rim.
            //
            // The tentacles sway on the mob's clock, each on its own phase: a
            // tentacle leaves the bell along its spoke and bends
            // 0.5 sin(0.003 t + 37 i) off it. (florr runs that clock six times as
            // fast while a second state flag is up, one the attributes do not
            // carry; here it always runs at the resting rate.)
            canvas.save();
            const double s = attr.radius / 50.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // Each tentacle is its own stroke, as florr draws them, so where two
            // translucent ones cross they do not merge into one.
            roundStrokes(canvas, 7.0);
            ui::setStroke(canvas, 0xFFFFFFu, 178.0 / 255.0);
            for (int i = 0; i < 8; ++i) {
                const double spoke = kTau * i / 8;
                const double phase = attr.clockMs * 0.003 + 37.0 * i;
                const double sway = 0.5 * std::sin(std::fmod(phase, kTau));
                const Vec2 root = Vec2::fromAngle(spoke, 45.0);
                const Vec2 bend = Vec2::fromAngle(spoke, 50.0);
                const Vec2 tip = root + Vec2::fromAngle(spoke + sway, 40.0);
                canvas.beginPath();
                canvas.moveTo(static_cast<float>(root.x), static_cast<float>(root.y));
                canvas.quadraticCurveTo(static_cast<float>(bend.x), static_cast<float>(bend.y),
                                        static_cast<float>(tip.x), static_cast<float>(tip.y));
                canvas.stroke();
            }

            ui::setStroke(canvas, 0xFFFFFFu);
            canvas.setLineWidth(4.0f);
            canvas.strokeCircle(0.0f, 0.0f, 50.0f);
            ui::setFill(canvas, 0xFFFFFFu, 127.0 / 255.0);
            canvas.fillCircle(0.0f, 0.0f, 48.0f);

            canvas.restore();
            break;
        }

        case MobArt::Dandelion: {
            // Drawn for a radius of 25: a white head ringed in its 0.9 shade
            // over the roots of ten dark stems.
            //
            // florr draws a dandelion two ways. Standing in the world, it paints
            // only the head and ten dark stems from 25 out to 25 + 6u -- u a
            // uniform draw per stem from a minstd_rand0 seeded with the mob's id
            // (its low 15 bits, 0 read as 1), so each dandelion has its own
            // ragged fringe and keeps it. The seeds are not the head's to draw
            // there: they are separate petals, each carrying its own 16-long
            // stem, and in this game real entities that draw themselves. With no
            // mob behind it -- a picture -- the render fills them in itself: all
            // ten stems run out to 45 and each is capped with a seed, a white
            // disc ringed in the same 0.9 shade as the head, laid over
            // everything.
            constexpr std::uint32_t kHead = 0xFFFFFFu;
            constexpr int kStems = 10;
            constexpr float kStemRoot = 25.0f;
            /// Where every stem ends, and its seed sits, in a picture.
            constexpr float kSeedDistance = 45.0f;

            canvas.save();
            const double s = attr.radius / 25.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            roundStrokes(canvas, 7.0);
            ui::setStroke(canvas, 0x333333u);
            std::uint32_t draw = attr.seed & 0x7FFFu;
            if (draw == 0) draw = 1;
            canvas.beginPath();
            for (int i = 0; i < kStems; ++i) {
                float reach = kSeedDistance;
                if (attr.inWorld) {
                    draw = minstdStep(draw, 16807u);
                    reach = kStemRoot + minstdUnit(draw) * 6.0f;
                }
                const float angle = static_cast<float>(kTau * i / kStems);
                const float c = std::cos(angle);
                const float sn = std::sin(angle);
                canvas.moveTo(c * kStemRoot, sn * kStemRoot);
                canvas.lineTo(c * reach, sn * reach);
            }
            canvas.stroke();

            const std::uint32_t ring = shadeOf(kHead, 0.9);
            ui::setFill(canvas, ring);
            canvas.fillCircle(0.0f, 0.0f, 26.5f);
            ui::setFill(canvas, kHead);
            canvas.fillCircle(0.0f, 0.0f, 23.5f);

            if (!attr.inWorld) {
                for (int i = 0; i < kStems; ++i) {
                    const float angle = static_cast<float>(kTau * i / kStems);
                    const float x = std::cos(angle) * kSeedDistance;
                    const float y = std::sin(angle) * kSeedDistance;
                    ui::setFill(canvas, ring);
                    canvas.fillCircle(x, y, 10.5f);
                    ui::setFill(canvas, kHead);
                    canvas.fillCircle(x, y, 7.5f);
                }
            }

            canvas.restore();
            break;
        }

        case MobArt::Fly: {
            // A grey disc of radius 14 with a pair of pale wings over its back.
            // florr sizes the fly from its rarity alone rather than the entity's
            // radius, at 1x for a common one, so the disc IS the design radius.
            constexpr std::uint32_t kBody = 0x555555u;
            canvas.save();
            const double s = attr.radius / 14.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 7.0);

            ui::setFill(canvas, kBody);
            ui::setStroke(canvas, shadeOf(kBody, 0.9));
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 14.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
            canvas.stroke();

            beatingWings(0xEEEEEEu);
            canvas.restore();
            break;
        }

        case MobArt::Leafbug:
        case MobArt::LeafbugShiny: {
            // Drawn for a radius of 20. A leaf for a body -- an outline, a fill
            // and five veins, all SVG paths florr ships -- on eight dark legs,
            // with two curled antennae at its tip.
            //
            // The legs step on the ground it covers, exactly as the scorpion's
            // do: four a side, each swinging 0.2 rad about its rest angle a
            // quarter turn behind the one before. The antennae sway on the claw
            // beat, each turning about its own root, opposite ways, closing
            // toward each other and opening again.
            //
            // The golden leafbug is the same mob in gold: florr swaps every
            // colour but the legs' for its own literal set.
            const bool gold = art == MobArt::LeafbugShiny;
            const std::uint32_t antennaColor = gold ? 0x403F30u : 0x3C4030u;
            const std::uint32_t rim = gold ? 0xBEBE2Au : 0x21853Cu;
            const std::uint32_t leaf = gold ? 0xEBEB34u : 0x32A852u;
            constexpr double kLegRest[4] = {-0.7, -0.23333333333333334, 0.23333333333333325, 0.7};
            /// Each antenna turns about its root, in asset space.
            constexpr float kAntennaRootX = 145.46400451660156f;
            constexpr float kAntennaRootY[2] = {117.27400207519531f, 132.82800292968750f};
            static const Path2D antennae[2] = {
                svgPathData("M146.353 115.34c-1.239-.257-2.656.415-2.916 1.551-.26 1.137.736 "
                            "2.307 1.974 2.565 2.17.452 4.538 1.007 6.012 1.523 1.474.516 3.61 "
                            "1.529 4.555 2.176.575.394 1.37.332 1.809-.178.438-.51.267-1.187"
                            "-.223-1.67-1.071-1.053-3.074-2.497-4.797-3.456-1.722-.958-3.835"
                            "-1.974-6.414-2.51z"),
                svgPathData("M146.353 134.76c-1.239.258-2.656-.414-2.916-1.551-.26-1.137.736"
                            "-2.307 1.974-2.565 2.17-.451 4.538-1.007 6.012-1.523 1.474-.516 "
                            "3.61-1.529 4.555-2.176.575-.394 1.37-.332 1.809.178.438.51.267 "
                            "1.187-.223 1.67-1.071 1.053-3.074 2.498-4.797 3.456-1.722.959-3.835 "
                            "1.974-6.414 2.511z"),
            };
            static const Path2D body = svgPathData(
                "M114.045 134.44c7.33 3.79 16.537 3.893 21.935 2.174 5.398-1.719 11.031-6.262 "
                "11.031-11.564 0-5.301-5.633-9.845-11.03-11.564-5.399-1.719-14.607-1.615-21.936 "
                "2.175-7.329 3.79-10.128 7.171-10.128 9.39 0 2.217 2.8 5.598 10.128 9.388z");
            /// The midrib, then two pairs of side veins.
            static const Path2D veins[5] = {
                svgPathData("M112.03 123.771c-.708.022-1.28.573-1.28 1.28 0 .706.573 1.257 1.28 "
                            "1.278l27.493.845c1.172.036 2.123-.95 2.123-2.124 0-1.173-.951-2.16"
                            "-2.123-2.124z"),
                svgPathData("M129.271 116.45c-.54-.458-1.31-.499-1.809 0-.5.5-.457 1.27 0 "
                            "1.81l6.741 7.935c.76.894 2.174.83 3.004 0 .83-.83.894-2.244 0-3.004z"),
                svgPathData("M129.271 133.65c-.54.458-1.31.5-1.809 0-.5-.5-.457-1.27 0-1.809"
                            "l6.741-7.936c.76-.893 2.174-.829 3.004 0 .83.83.894 2.245 0 3.004z"),
                svgPathData("M118.95 118.309c-.407-.346-.988-.377-1.365 0s-.346.958 0 1.365"
                            "l5.088 5.99c.573.675 1.64.626 2.267 0 .626-.626.675-1.694 0-2.267z"),
                svgPathData("M118.95 131.792c-.407.345-.988.377-1.365 0-.377-.378-.346-.959 0"
                            "-1.366l5.088-5.99c.573-.674 1.64-.626 2.267 0 .626.626.675 1.694 0 "
                            "2.267z"),
            };

            canvas.save();
            const double s = attr.radius / 20.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // --- legs ------------------------------------------------------
            // Drawn at half the body's scale, from the origin; the -y flank is
            // the +y one mirrored through the body's axis.
            canvas.save();
            canvas.scale(0.5f, 0.5f);
            roundStrokes(canvas, 7.0);
            ui::setStroke(canvas, 0x333333u);
            const double stride = attr.distance * kGaitRadiansPerUnitWalked;
            canvas.beginPath();
            for (const double side : {-1.0, 1.0}) {
                for (int k = 0; k < 4; ++k) {
                    double angle = kLegRest[k] -
                                   0.2 * std::cos(side * kPi * 0.5 + k * kPi * 0.5 + stride);
                    if (side < 0) angle = -kPi - angle;
                    const double x = std::sin(angle) * 37.0;
                    const double y = std::cos(angle) * 37.0;
                    canvas.moveTo(0.0f, 0.0f);
                    canvas.quadraticCurveTo(static_cast<float>(x * 0.8),
                                            static_cast<float>(y * 0.5), static_cast<float>(x),
                                            static_cast<float>(y));
                }
            }
            canvas.stroke();
            canvas.restore();

            // The body art sits about (123, 125.051) in its own asset space.
            canvas.translate(-123.0f, -125.0510025024414f);

            // --- antennae --------------------------------------------------
            // The one rooted on -y turns toward +y and its twin the other way.
            const double sway = clawBeat(attr);
            ui::setFill(canvas, antennaColor);
            for (int i = 0; i < 2; ++i) {
                const double side = i == 0 ? 1.0 : -1.0;
                canvas.save();
                canvas.translate(kAntennaRootX, kAntennaRootY[i]);
                canvas.rotate(static_cast<float>(side * 0.1 * sway));
                canvas.translate(-kAntennaRootX, -kAntennaRootY[i]);
                canvas.fill(antennae[i]);
                canvas.restore();
            }

            // --- body ------------------------------------------------------
            // The rim goes down first and the leaf over it, so only its outer
            // half shows.
            roundStrokes(canvas, 6.370999813079834);
            ui::setStroke(canvas, rim);
            canvas.stroke(body);
            ui::setFill(canvas, leaf);
            canvas.fill(body);
            ui::setFill(canvas, rim);
            for (const Path2D& vein : veins) canvas.fill(vein);

            canvas.restore();
            break;
        }

        case MobArt::Mantis: {
            // Drawn for a radius of 20. Six legs drawn in code under the body,
            // and the body itself from an illustration in its own coordinates,
            // which florr centres by translating (-130, -121.653): a long oval
            // with its rim laid down first so the fill covers its inner half,
            // three creases and a sliver down the back in the rim's colour, and
            // two feelers.
            //
            // The legs are the scorpion's, three a side instead of four (it
            // skips the scorpion's third rest angle), at 0.6 scale, stepping on
            // the ground it covers. florr starts that gait two radians in.
            constexpr std::uint32_t kRim = 0x78A62Eu;
            constexpr double kLegRest[3] = {-0.7, -0.23333333333333334, 0.7};
            constexpr double kLegPhase[3] = {0.0, kPi * 0.5, kPi * 1.5};
            static const Path2D body = svgPathData(
                "M141.242 133.208c-5.478 1.997-14.725 3.67-23.407.443-8.682-3.225-11.779-8.116"
                "-11.779-11.856 0-3.739 3.097-8.63 11.78-11.855 8.681-3.226 17.928-1.554 23.406"
                ".443 5.479 1.996 10.32 5.915 10.32 11.412 0 5.498-4.841 9.417-10.32 11.413z");
            static const Path2D creases[3] = {
                svgPathData("M126.06 112.534c-1.89.068-4.22.31-6.068.712-1.847.402-4.04 1.143"
                            "-5.75 1.859"),
                svgPathData("M126.06 131.056c-1.89-.067-4.22-.31-6.068-.711-1.847-.402-4.04"
                            "-1.143-5.75-1.86"),
                svgPathData("M136.928 114.461c-1.67 3.68-2.148 5.614-2.148 7.334 0 1.72.478 "
                            "3.654 2.148 7.335"),
            };
            static const Path2D spine = svgPathData("m111.679 121.653 22.936-.699v1.399z");
            static const Path2D feelers[2] = {
                svgPathData("M147.841 117.235s7.324-.831 12.345-3.77c5.022-2.94 9.613-9.081 "
                            "9.613-9.081s-7.627 5.574-10.54 7.279c-2.912 1.704-11.418 5.572"
                            "-11.418 5.572z"),
                svgPathData("M147.841 126.356s7.324.831 12.345 3.77c5.022 2.94 9.613 9.081 "
                            "9.613 9.081s-7.627-5.574-10.54-7.279c-2.912-1.705-11.418-5.572"
                            "-11.418-5.572z"),
            };

            canvas.save();
            const double s = attr.radius / 20.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            // --- legs ------------------------------------------------------
            // One stroke each, the +y flank's mirrored through the body's axis.
            canvas.save();
            canvas.scale(0.6f, 0.6f);
            ui::setStroke(canvas, 0x333333u);
            roundStrokes(canvas, 5.0);
            const double stride = attr.distance * kGaitRadiansPerUnitWalked + 2.0;
            for (const double side : {-1.0, 1.0}) {
                for (int k = 0; k < 3; ++k) {
                    double angle =
                        kLegRest[k] - 0.2 * std::cos(side * kPi * 0.5 + kLegPhase[k] + stride);
                    if (side < 0) angle = -kPi - angle;
                    const double x = std::sin(angle) * 37.0;
                    const double y = std::cos(angle) * 37.0;
                    canvas.beginPath();
                    canvas.moveTo(0.0f, 0.0f);
                    canvas.quadraticCurveTo(static_cast<float>(x * 0.8),
                                            static_cast<float>(y * 0.5), static_cast<float>(x),
                                            static_cast<float>(y));
                    canvas.stroke();
                }
            }
            canvas.restore();

            // --- body ------------------------------------------------------
            canvas.translate(-130.0f, -121.65299987792969f);
            ui::setStroke(canvas, kRim);
            roundStrokes(canvas, 6.400000095367432);
            canvas.stroke(body);
            ui::setFill(canvas, 0x9ACC46u);
            canvas.fill(body);

            roundStrokes(canvas, 3.2);
            for (const Path2D& crease : creases) canvas.stroke(crease);
            canvas.stroke(spine);

            // The feelers are slivers florr only ever outlines.
            ui::setStroke(canvas, 0x353535u);
            roundStrokes(canvas, 2.677);
            for (const Path2D& feeler : feelers) canvas.stroke(feeler);

            canvas.restore();
            break;
        }

        case MobArt::Bush: {
            // Drawn for a radius of 30: a five-lobed leaf rosette -- florr's SVG
            // asset, ringed in the leaf's rim colour -- with a vein down each
            // lobe and a spray of small veins either side of it. The leafbug's
            // own two greens. It does not move.
            static const Path2D body = svgPathData(
                "M156.887 126.067c.607-1.867-.825-5.478-5.957-10.673-2.41-2.44-5.391-4.3-8.395"
                "-5.599 1.667-2.816 2.985-6.073 3.5-9.463 1.1-7.22.135-10.983-1.453-12.137-1.589"
                "-1.154-5.465-.908-11.991 2.368-3.065 1.538-5.756 3.798-7.92 6.253-2.163-2.455"
                "-4.854-4.715-7.918-6.253-6.527-3.276-10.403-3.521-11.991-2.367-1.589 1.153-2.553"
                " 4.916-1.454 12.136.516 3.39 1.833 6.647 3.5 9.463-3.004 1.3-5.984 3.16-8.394 "
                "5.599-5.132 5.195-6.564 8.806-5.958 10.673.607 1.867 3.888 3.947 11.093 5.133 "
                "3.383.557 6.889.31 10.081-.404.308 3.257 1.157 6.668 2.732 9.713 3.355 6.487 "
                "6.347 8.963 8.31 8.963s4.955-2.477 8.31-8.963c1.575-3.046 2.423-6.456 2.73-9.713 "
                "3.193.714 6.698.961 10.082.404 7.206-1.186 10.487-3.266 11.093-5.133z");
            // Filled one at a time, as florr does, so two veins that cross can
            // never cancel each other's winding.
            static constexpr const char* kVeins[25] = {
                "M139.185 112.312c.58-.238 1.238-.062 1.522.495.284.557.038 1.194-.495 1.522"
                "l-7.844 4.836c-.884.545-2.057.104-2.528-.821-.471-.925-.139-2.134.821-2.528z",
                "M134.48 126.79c.33.533.966.778 1.523.494.557-.284.733-.944.495-1.523l-3.504"
                "-8.523c-.395-.96-1.603-1.293-2.528-.821-.925.471-1.366 1.644-.821 2.528z",
                "M145.94 116.236c.437-.18.934-.047 1.149.373.214.42.028.902-.374 1.15l-5.92 3.65"
                "c-.668.411-1.553.078-1.91-.62-.355-.698-.104-1.61.621-1.908z",
                "M142.252 127.585c.248.403.729.588 1.15.373.42-.214.552-.712.373-1.149l-2.645"
                "-6.433c-.298-.725-1.21-.976-1.908-.62-.699.355-1.032 1.24-.62 1.908z",
                "M147.19 121.725c.589.214.92.832.726 1.427-.193.595-.825.9-1.426.727l-21.636"
                "-6.244c-.997-.288-1.527-1.381-1.206-2.369.32-.987 1.392-1.56 2.368-1.206z",
                "M125.788 138.47c-.02.627-.507 1.133-1.132 1.133-.625 0-1.111-.507-1.132-1.132"
                "l-.748-22.506c-.034-1.038.842-1.88 1.88-1.88 1.038 0 1.914.842 1.88 1.88z",
                "M132.293 128.199c.406.477.442 1.158 0 1.6-.442.443-1.124.406-1.601 0l-7.024"
                "-5.966c-.79-.672-.734-1.924 0-2.658.735-.734 1.987-.791 2.659 0z",
                "M117.07 128.199c-.405.477-.442 1.158 0 1.6.442.443 1.124.406 1.601 0l7.024"
                "-5.966c.79-.672.734-1.924 0-2.658s-1.986-.791-2.659 0z",
                "M130.648 135.835c.306.36.334.875 0 1.209-.334.334-.848.306-1.208 0l-5.302"
                "-4.503c-.597-.508-.554-1.453 0-2.007s1.5-.597 2.007 0z",
                "M118.715 135.835c-.306.36-.334.875 0 1.209.334.334.848.306 1.209 0l5.3-4.503"
                "c.598-.508.555-1.453 0-2.007-.553-.554-1.498-.597-2.006 0z",
                "M138.916 98.067c.351-.52.255-1.214-.25-1.582-.506-.367-1.197-.243-1.582.25"
                "l-13.833 17.77c-.638.818-.424 2.015.416 2.625.84.61 2.043.444 2.625-.416z",
                "M138.14 110.2c.61-.147 1.04-.677.942-1.295-.098-.617-.671-.988-1.295-.94l-9.19"
                ".698c-1.034.078-1.724 1.125-1.562 2.15.163 1.026 1.142 1.808 2.15 1.563z",
                "M125.826 101.253c-.048-.625.323-1.197.94-1.295.618-.098 1.148.333 1.296.94"
                "l2.175 8.956c.245 1.009-.537 1.988-1.562 2.15-1.026.163-2.072-.527-2.151-1.562z",
                "M141.299 103.055c.46-.111.784-.511.71-.977-.074-.466-.506-.746-.977-.71l-6.936"
                ".527c-.781.06-1.302.85-1.18 1.623.123.774.862 1.364 1.624 1.18z",
                "M131.645 96.041c-.036-.471.244-.903.71-.977.466-.074.866.251.978.71l1.642 6.76"
                "c.185.76-.406 1.5-1.18 1.623-.774.122-1.564-.398-1.623-1.18z",
                "M103.372 123.707c-.602.174-1.233-.132-1.427-.727-.193-.594.139-1.213.727-1.426"
                "l21.174-7.666c.976-.353 2.048.22 2.368 1.207.321.987-.21 2.08-1.207 2.368z",
                "M115.151 126.72c-.328.533-.965.778-1.522.494-.557-.284-.733-.944-.495-1.523"
                "l3.504-8.523c.395-.96 1.603-1.293 2.528-.821.925.471 1.366 1.644.821 2.528z",
                "M110.447 112.242c-.58-.238-1.238-.062-1.522.495-.284.557-.038 1.194.495 1.522"
                "l7.844 4.836c.884.545 2.057.104 2.528-.821.471-.925.139-2.134-.821-2.528z",
                "M107.38 127.515c-.248.403-.729.588-1.15.373-.42-.214-.552-.712-.373-1.149l2.645"
                "-6.433c.298-.725 1.21-.976 1.908-.62.699.355 1.032 1.241.62 1.908z",
                "M103.693 116.166c-.438-.18-.935-.047-1.15.373-.214.421-.028.902.374 1.15l5.92 "
                "3.65c.668.411 1.553.078 1.909-.62.356-.698.105-1.61-.62-1.908z",
                "M112.27 96.324c-.386-.495-1.076-.618-1.582-.25-.506.367-.601 1.062-.25 1.58"
                "l12.624 18.648c.581.86 1.785 1.026 2.625.416.84-.61 1.054-1.807.416-2.626z",
                "M123.57 100.81c.047-.624-.324-1.197-.941-1.295-.618-.097-1.148.333-1.296.941"
                "l-2.175 8.955c-.245 1.01.537 1.989 1.563 2.15 1.025.163 2.072-.526 2.15-1.562z",
                "M111.254 109.758c-.608-.148-1.038-.678-.94-1.295.097-.618.67-.989 1.295-.941"
                "l9.188.698c1.036.079 1.725 1.126 1.563 2.15-.162 1.026-1.142 1.808-2.15 1.563z",
                "M117.75 95.599c.036-.472-.244-.904-.71-.978-.466-.073-.866.252-.978.71l-1.642 "
                "6.76c-.185.761.406 1.5 1.18 1.623.774.123 1.564-.398 1.623-1.18z",
                "M108.096 102.613c-.46-.112-.784-.511-.71-.978.074-.466.506-.746.978-.71l6.935"
                ".527c.782.06 1.302.85 1.18 1.624-.123.774-.862 1.364-1.624 1.179z",
            };
            static const std::vector<Path2D> veins = [] {
                std::vector<Path2D> out;
                for (const char* d : kVeins) out.push_back(svgPathData(d));
                return out;
            }();
            constexpr std::uint32_t kRim = 0x21853Cu;

            canvas.save();
            const double s = attr.radius / 30.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            // The rosette sits about (124.671, 115.5) in its own asset space.
            canvas.translate(-124.6709976196289f, -115.5f);

            roundStrokes(canvas, 7.048999786376953);
            ui::setStroke(canvas, kRim);
            canvas.stroke(body);
            ui::setFill(canvas, 0x32A852u);
            canvas.fill(body);
            ui::setFill(canvas, kRim);
            for (const Path2D& vein : veins) canvas.fill(vein);

            canvas.restore();
            break;
        }

        case MobArt::Roach: {
            // Drawn for a radius of 20, and drawn from an illustration rather
            // than in code: every part is a path in the artwork's own
            // coordinates, which florr centres by translating (-128, -138.5). A
            // round head, a body with a scoop in its nose for the head, two
            // feelers, two oval marks on the back and two arcs across the rear.
            // Its colours are the artwork's own, not shades of one base.
            // Nothing moves: florr's roach has no legs and keeps no clock.
            constexpr std::uint32_t kBodyRim = 0x843E16u;
            static const Path2D body = svgPathData(
                "M129.955 123.095c-12.79 0-23.159 6.897-23.16 15.405.001 8.508 10.37 15.404 "
                "23.16 15.405 6.994-.007 13.61-2.118 17.998-5.74-3.978-1.303-6.893-5.159-6.893"
                "-9.665 0-4.516 2.927-8.38 6.918-9.674-4.397-3.624-11.022-5.73-18.023-5.73z");
            static const Path2D feelerLeft = svgPathData(
                "M149.734 135.404s5.738-.815 9.619-3.2c3.88-2.384 7.348-7.226 7.348-7.226s-5.868 "
                "4.477-8.119 5.86c-2.25 1.383-8.848 4.566-8.848 4.566z");
            static const Path2D feelerRight = svgPathData(
                "M149.734 141.596s5.738.815 9.619 3.2c3.88 2.383 7.348 7.226 7.348 7.226s-5.868"
                "-4.477-8.119-5.86c-2.25-1.384-8.848-4.566-8.848-4.566z");
            static const Path2D arcLeft =
                svgPathData("M125.327 131.326a26.767 26.767 0 0 0-10.796 3.153");
            static const Path2D arcRight =
                svgPathData("M125.327 145.674a26.767 26.767 0 0 1-10.796-3.153");

            canvas.save();
            const double s = attr.radius / 20.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            canvas.translate(-128.0f, -138.5f);

            // The head sits in the body's scoop, a hair taller than it is long.
            ui::setFill(canvas, 0x6C3619u);
            canvas.beginPath();
            canvas.ellipse(144.94500732421875f, 138.5f, 7.960999965667725f, 8.006f, 0.0f, 0.0f,
                           static_cast<float>(kTau));
            canvas.fill();
            ui::setStroke(canvas, 0x522812u);
            roundStrokes(canvas, 3.444999933242798);
            canvas.stroke();

            ui::setFill(canvas, 0x9B4E23u);
            canvas.fill(body);
            ui::setStroke(canvas, kBodyRim);
            canvas.stroke(body);

            // The feelers are slivers florr only ever outlines: their 2.46-wide
            // rim is the whole of them.
            ui::setStroke(canvas, 0x353535u);
            roundStrokes(canvas, 2.46);
            canvas.stroke(feelerLeft);
            canvas.stroke(feelerRight);

            // The two oval marks on the back, each tilted 0.44 rad away from
            // the body's axis.
            ui::setFill(canvas, kBodyRim);
            for (int i = 0; i < 2; ++i) {
                const float tilt = i == 0 ? 0.4399999976158142f : -0.4399999976158142f;
                canvas.beginPath();
                canvas.ellipse(134.78f, i == 0 ? 132.246f : 144.752f, 3.139f, 4.627f, tilt, 0.0f,
                               static_cast<float>(kTau));
                canvas.fill();
            }

            ui::setStroke(canvas, kBodyRim);
            roundStrokes(canvas, 3.937000036239624);
            canvas.stroke(arcLeft);
            canvas.stroke(arcRight);

            canvas.restore();
            break;
        }

        case MobArt::Moth: {
            // Drawn for a radius of 25: a dark disc with a lighter one inside
            // it, no outline, the bee's feelers set back by 8, and the fly's
            // wings in white, half again as large and nudged forward.
            canvas.save();
            const double s = attr.radius / 25.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 5.0);

            ui::setFill(canvas, 0x4B4135u);
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 25.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();
            ui::setFill(canvas, 0x6A5C4Cu);
            canvas.beginPath();
            canvas.arc(0.0f, 0.0f, 20.0f, 0.0f, static_cast<float>(kTau));
            canvas.fill();

            canvas.save();
            canvas.translate(-8.0f, 0.0f);
            clubbedFeelers();
            canvas.restore();

            canvas.save();
            canvas.scale(1.5f, 1.5f);
            canvas.translate(3.0f, 0.0f);
            beatingWings(0xFFFFFFu);
            canvas.restore();

            canvas.restore();
            break;
        }

        case MobArt::Firefly:
        case MobArt::FireflyMagic: {
            // Drawn for a radius of 25, everything 4 units forward of the mob's
            // centre. A lantern of an abdomen with one dark band across it, two
            // translucent wings, a round head, and over all of it a soft disc of
            // the lantern's own light.
            //
            // The wings beat on the claw beat, each swinging up to 0.1 pi toward
            // the body's axis. The light breathes on the clock, its radius
            // swelling between 20 and 50 once every 2 pi / 0.005 ms, about
            // 1.26 s, whatever the firefly is doing -- and only in the world:
            // florr does not light a firefly's picture on a bestiary card.
            //
            // The magic firefly is the same insect in cyan, head included, its
            // light a touch greener than its body.
            const bool magic = art == MobArt::FireflyMagic;
            const std::uint32_t abdomen = magic ? 0x77EAF9u : 0xF9EC77u;
            const std::uint32_t headColor = magic ? 0x77EAF9u : 0x555555u;
            const std::uint32_t light = magic ? 0x77F7F9u : 0xF9EC77u;

            canvas.save();
            const double s = attr.radius / 25.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));
            roundStrokes(canvas, 7.0);
            canvas.translate(4.0f, 0.0f);

            // --- abdomen ---------------------------------------------------
            const std::uint32_t abdomenRim = shadeOf(abdomen, 0.9);
            canvas.beginPath();
            canvas.ellipse(-12.0f, 0.0f, 18.0f, 14.0f, 0.0f, 0.0f, static_cast<float>(kTau));
            ui::setFill(canvas, abdomen);
            canvas.fill();
            ui::setStroke(canvas, abdomenRim);
            canvas.stroke();
            // The band, 6 wide across the abdomen's middle.
            ui::setFill(canvas, abdomenRim);
            canvas.fillRect(-21.0f, -10.0f, 6.0f, 20.0f);

            // --- wings -----------------------------------------------------
            // Drawn 1.3 times the body's scale, each an ellipse splayed 0.1 pi
            // off the axis, laid down on its own so where the two overlap the
            // white doubles. florr halves the renderer's opacity for them.
            const double beat = clawBeat(attr);
            canvas.save();
            canvas.scale(1.2999999523162842f, 1.2999999523162842f);
            ui::setFill(canvas, 0xEEEEEEu, 127.0 / 255.0);
            for (const double side : {-1.0, 1.0}) {
                canvas.save();
                canvas.rotate(static_cast<float>(side * 0.3141592653589793 * beat));
                canvas.beginPath();
                canvas.ellipse(-7.0f, static_cast<float>(side * 8.0), 12.0f, 9.0f,
                               static_cast<float>(-side * 0.3141592741012573), 0.0f,
                               static_cast<float>(kTau));
                canvas.fill();
                canvas.restore();
            }
            canvas.restore();

            // --- head ------------------------------------------------------
            canvas.beginPath();
            canvas.arc(8.0f, 0.0f, 14.0f, 0.0f, static_cast<float>(kTau));
            ui::setFill(canvas, headColor);
            canvas.fill();
            ui::setStroke(canvas, shadeOf(headColor, 0.9));
            canvas.stroke();

            // --- light -----------------------------------------------------
            // About the abdomen, at a third of the renderer's opacity.
            if (attr.inWorld) {
                const double reach = 35.0 + 15.0 * std::sin(std::fmod(attr.clockMs * 0.005, kTau));
                canvas.beginPath();
                canvas.arc(-12.0f, 0.0f, static_cast<float>(reach), 0.0f,
                           static_cast<float>(kTau));
                ui::setFill(canvas, light, 76.0 / 255.0);
                canvas.fill();
            }

            canvas.restore();
            break;
        }

        case MobArt::Dummy: {
            // florr draws its dummy with the code it draws a player's flower
            // with, set to a grey face that never changes its expression: a grey
            // disc ringed in its 0.9 shade, two black button eyes, each a tall
            // oval with a square glint in the middle that never looks anywhere,
            // and a mouth held dead straight. When its health runs out the eyes
            // become crosses, as a flower's do. (The flower code also washes the
            // face in a status colour -- a poisoned dummy goes purple -- but that
            // is an effect laid over the picture, like a hit flash.)
            constexpr std::uint32_t kBody = 0x999999u;
            constexpr std::uint32_t kInk = 0x111111u;
            /// An eye is a circle of this radius stretched twice as tall.
            constexpr double kEyeRadius = 3.0;
            constexpr double kEyeStretch = 2.0;

            canvas.save();
            const double s = attr.radius / 25.0;
            canvas.scale(static_cast<float>(s), static_cast<float>(s));

            ui::setFill(canvas, shadeOf(kBody, 0.9));
            canvas.fillCircle(0.0f, 0.0f, 26.5f);
            ui::setFill(canvas, kBody);
            canvas.fillCircle(0.0f, 0.0f, 23.5f);

            const bool dead = attr.health <= 0.0;
            for (const double side : {-1.0, 1.0}) {
                canvas.save();
                canvas.translate(static_cast<float>(side * 7.0), -5.0f);
                if (dead) {
                    // A dead eye's cross: two strokes 4 out along each diagonal.
                    constexpr float r = 4.0f;
                    roundStrokes(canvas, 3.0);
                    ui::setStroke(canvas, kInk);
                    canvas.beginPath();
                    canvas.moveTo(-r, -r);
                    canvas.lineTo(r, r);
                    canvas.stroke();
                    canvas.beginPath();
                    canvas.moveTo(r, -r);
                    canvas.lineTo(-r, r);
                    canvas.stroke();
                } else {
                    canvas.scale(1.0f, static_cast<float>(kEyeStretch));
                    ui::setFill(canvas, kInk);
                    canvas.fillCircle(0.0f, 0.0f, static_cast<float>(kEyeRadius));
                    // The glint is square in the face's own units, not stretched.
                    canvas.save();
                    canvas.scale(1.0f, static_cast<float>(1.0 / kEyeStretch));
                    ui::setFill(canvas, 0xEEEEEEu);
                    canvas.fillRect(-1.5f, -1.5f, 3.0f, 3.0f);
                    canvas.restore();
                    // A hairline round the oval, in the stretched frame like the
                    // oval.
                    ui::setStroke(canvas, kInk);
                    canvas.setLineWidth(0.5f);
                    canvas.strokeCircle(0.0f, 0.0f, static_cast<float>(kEyeRadius));
                }
                canvas.restore();
            }

            roundStrokes(canvas, 1.5);
            ui::setStroke(canvas, kInk);
            canvas.beginPath();
            canvas.moveTo(-6.0f, 10.0f);
            canvas.quadraticCurveTo(0.0f, 10.0f, 6.0f, 10.0f);
            canvas.stroke();

            canvas.restore();
            break;
        }

        case MobArt::None:
            break;
    }
}

} // namespace flix
