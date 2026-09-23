// Fits each mob's artwork to its hitbox and prints the `visual_scale` and
// `visualOffsetX/Y` that put it there.
//
//   hitbox_fit [mob id ...] [--outer] [--cut F] [--alpha F] [--digits N]
//              [--preview DIR] [--mobs PATH] [--petals PATH]
//
// With no ids it fits every mob; name some to fit just those. Nothing is
// written back -- the run ends with the lines to paste into src/mobs.json.
// mobs.json is read straight out of the source tree, so an edit to it is
// measured by the next run without a rebuild.
//
// The art is drawn through the client's own SpriteCache, so what is measured
// is exactly what the game paints. Its BODY is then found by discarding what
// is not body:
//   * anything see-through -- below --alpha (0.9) of the art's most opaque
//     pixel: a fly's wings;
//   * anything thin -- narrower than 2 x --cut (0.35) x the body's inscribed
//     radius: legs, antennae, the point of a stinger;
//   * anything that is then no longer attached to the largest piece: the
//     blob on the end of an antenna.
// Holes are filled first, so an eye or a see-through belly cannot split it.
// Animated art is fitted at several moments and the median taken, so a
// spinning starfish is measured whole rather than smeared into its core.
//
// The body's smallest enclosing circle becomes the hitbox, taken through the
// MIDDLE of the body's outline, because that is where gardn puts it: a baby
// ant's radius is 14, its body path is 14, and the 7-wide stroke hangs 3.5
// over. An outline is an edge band DARKER than what it encloses, as gardn's
// HSV(base, 0.8) strokes are; a lighter one is a ring of the art (an ant
// hole) and the hitbox takes its outside. --outer always takes the outside.
//
// The procedural mobs ($rock, $cactus, ...) are ports of gardn, drawn at the
// collision radius by construction, and are left out unless named. Named,
// they are the check on the convention: rock, cactus and leech come out at
// ~1 and ~0. The scorpion does not -- gardn draws its long body 40 units
// against a radius of 35 -- which is the one shape where "enclose the body"
// and the reference part ways.
//
// The offsets are in the units MobConfig::visualOffsetX/Y are: the art's own
// frame (+X is the way it faces), in multiples of the drawn radius.
//
// --preview DIR writes DIR/<id>.png per mob. Left: the art as it sits now.
// Middle: as it would sit fitted. Right: what was taken for the body -- white
// is body, grey was cut as too thin or detached, dark is see-through (all in
// the first pose); yellow is the outline's outside edge and red is the
// hitbox (the median over every pose).
#include "canvas.h"
#include "client/render/mob_art.h"
#include "client/render/sprites.h"
#include "shared/core/types.h"
#include "shared/game/config.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <vector>

#ifndef FLIX_SOURCE_DIR
#define FLIX_SOURCE_DIR "../src"
#endif
#ifndef FLIX_TEST_DATA_DIR
#define FLIX_TEST_DATA_DIR "data"
#endif

using namespace flix;

namespace {

// The art is measured at this diameter: a pixel is 1/200 of its radius.
// Measured again at twice this, a clean body (fly, baby ant, roach) agrees to
// about 0.001 -- the third decimal -- whatever --digits prints. A body with a
// stinger does worse, ~0.01 in scale, because where the cut falls along a
// tapering stinger moves with the pixel grid.
constexpr int kArtPx = 400;
constexpr double kArtRadiusPx = kArtPx * 0.5;
// Twice the art, so a drawing that spills out of its box is still seen.
constexpr int kN = kArtPx * 2;
constexpr double kCentre = kN * 0.5;

// Animated art is fitted at these moments. The step is not a harmonic of any
// period the SVGs use, so the frames land on different poses.
constexpr int kFrames = 8;
constexpr double kFrameStep = 0.173;

// An outline is a band of one colour at the edge. Two pixels further in that
// differ from it by more than this, per channel, are where it ends.
constexpr int kOutlineTolerance = 6;
// ...and it is DARKER than what it encloses, by at least this much luminance:
// gardn strokes a body in HSV(base, 0.8). A band that is lighter is a ring of
// the art itself -- an ant hole's outer disc -- and the hitbox goes outside it.
constexpr double kOutlineDarker = 4.0;

// The opening rounds every convex corner off along with the legs. A corner's
// sliver never gets further than this (x the cut) from what survived -- a
// right angle's reaches 0.41 -- while a leg reaches well past it.
constexpr double kSliverReach = 0.75;

// Within these the art is already where the fit would put it.
constexpr double kScaleTolerance = 0.03;    // relative
constexpr double kOffsetTolerance = 0.03;   // drawn radii

using Mask = std::vector<std::uint8_t>;

struct Options {
    std::vector<std::string> ids;
    bool outer = false;
    double cut = 0.35;
    double alpha = 0.9;
    int digits = 4;              // decimals printed
    std::string previewDir;
    std::string mobsPath = FLIX_SOURCE_DIR "/mobs.json";
    std::string petalsPath = FLIX_SOURCE_DIR "/petals.json";
};

struct Circle {
    double x = 0, y = 0, r = -1;
    bool contains(Vec2 p) const { return std::hypot(p.x - x, p.y - y) <= r + 1e-7; }
};

// One pose of the art, measured.
struct FrameFit {
    Circle outer;               // the body's outside edge, canvas pixels
    double outlinePx = 0;
    std::vector<float> alpha;   // kept for the preview
    Mask solid, body;
};

struct Fit {
    std::string skip;           // why there is no fit; empty when there is
    double scale = 1, offsetX = 0, offsetY = 0;
    Circle outer;               // median over the frames
    double hitboxPx = 0;        // the radius the hitbox is fitted to
    FrameFit first;             // the first pose, for the preview
};

// --- masks -------------------------------------------------------------------

std::size_t at(int x, int y) { return static_cast<std::size_t>(y) * kN + x; }

// One row or column of Felzenszwalb & Huttenlocher's squared distance
// transform: the lower envelope of the parabolas rooted at each sample.
void distance1d(const std::vector<double>& f, std::vector<double>& d, std::vector<int>& v,
                std::vector<double>& z) {
    const int n = static_cast<int>(f.size());
    constexpr double kHuge = 1e30;
    int k = 0;
    v[0] = 0;
    z[0] = -kHuge;
    z[1] = kHuge;
    for (int q = 1; q < n; ++q) {
        double s = ((f[q] + double(q) * q) - (f[v[k]] + double(v[k]) * v[k])) / (2.0 * q - 2.0 * v[k]);
        while (s <= z[k]) {
            --k;
            s = ((f[q] + double(q) * q) - (f[v[k]] + double(v[k]) * v[k])) / (2.0 * q - 2.0 * v[k]);
        }
        ++k;
        v[k] = q;
        z[k] = s;
        z[k + 1] = kHuge;
    }
    k = 0;
    for (int q = 0; q < n; ++q) {
        while (z[k + 1] < q) ++k;
        d[q] = double(q - v[k]) * (q - v[k]) + f[v[k]];
    }
}

// Squared distance from every pixel to the nearest one set in `seeds`.
std::vector<double> distanceSq(const Mask& seeds) {
    constexpr double kFar = 1e20;
    std::vector<double> grid(seeds.size());
    for (std::size_t i = 0; i < seeds.size(); ++i) grid[i] = seeds[i] ? 0.0 : kFar;
    std::vector<double> f(kN), d(kN), z(kN + 1);
    std::vector<int> v(kN);
    for (int x = 0; x < kN; ++x) {
        for (int y = 0; y < kN; ++y) f[y] = grid[at(x, y)];
        distance1d(f, d, v, z);
        for (int y = 0; y < kN; ++y) grid[at(x, y)] = d[y];
    }
    for (int y = 0; y < kN; ++y) {
        for (int x = 0; x < kN; ++x) f[x] = grid[at(x, y)];
        distance1d(f, d, v, z);
        for (int x = 0; x < kN; ++x) grid[at(x, y)] = d[x];
    }
    return grid;
}

// Everything the outside cannot reach becomes part of the shape.
void fillHoles(Mask& mask) {
    Mask outside(mask.size(), 0);
    std::vector<int> stack;
    const auto push = [&](int x, int y) {
        if (x < 0 || y < 0 || x >= kN || y >= kN) return;
        const std::size_t i = at(x, y);
        if (mask[i] || outside[i]) return;
        outside[i] = 1;
        stack.push_back(static_cast<int>(i));
    };
    for (int i = 0; i < kN; ++i) {
        push(i, 0);
        push(i, kN - 1);
        push(0, i);
        push(kN - 1, i);
    }
    while (!stack.empty()) {
        const int i = stack.back();
        stack.pop_back();
        const int x = i % kN, y = i / kN;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
    }
    for (std::size_t i = 0; i < mask.size(); ++i) mask[i] = outside[i] ? 0 : 1;
}

Mask largestComponent(const Mask& mask) {
    std::vector<int> label(mask.size(), 0);
    std::vector<int> sizes{0};
    std::vector<int> stack;
    for (std::size_t start = 0; start < mask.size(); ++start) {
        if (!mask[start] || label[start]) continue;
        const int id = static_cast<int>(sizes.size());
        int size = 0;
        label[start] = id;
        stack.push_back(static_cast<int>(start));
        while (!stack.empty()) {
            const int i = stack.back();
            stack.pop_back();
            ++size;
            const int x = i % kN, y = i / kN;
            const int next[4][2] = {{x + 1, y}, {x - 1, y}, {x, y + 1}, {x, y - 1}};
            for (const auto& n : next) {
                if (n[0] < 0 || n[1] < 0 || n[0] >= kN || n[1] >= kN) continue;
                const std::size_t j = at(n[0], n[1]);
                if (mask[j] && !label[j]) {
                    label[j] = id;
                    stack.push_back(static_cast<int>(j));
                }
            }
        }
        sizes.push_back(size);
    }
    Mask out(mask.size(), 0);
    if (sizes.size() < 2) return out;
    const int best = static_cast<int>(std::max_element(sizes.begin() + 1, sizes.end()) - sizes.begin());
    for (std::size_t i = 0; i < mask.size(); ++i) out[i] = label[i] == best ? 1 : 0;
    return out;
}

// --- the smallest enclosing circle (Welzl, iterative) --------------------------

Circle circleOf(Vec2 a, Vec2 b) {
    return {(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, std::hypot(a.x - b.x, a.y - b.y) * 0.5};
}

Circle circleOf(Vec2 a, Vec2 b, Vec2 c) {
    const double d = 2.0 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (std::fabs(d) < 1e-9) {
        // Collinear: the widest pair already holds the third.
        Circle best = circleOf(a, b);
        for (const Circle& other : {circleOf(a, c), circleOf(b, c)})
            if (other.r > best.r) best = other;
        return best;
    }
    const double a2 = a.lengthSq(), b2 = b.lengthSq(), c2 = c.lengthSq();
    const double x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const double y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return {x, y, std::hypot(a.x - x, a.y - y)};
}

Circle enclosing(std::vector<Vec2> points) {
    if (points.empty()) return {};
    std::mt19937 rng(1);   // fixed: the same art prints the same numbers
    std::shuffle(points.begin(), points.end(), rng);
    Circle c{points[0].x, points[0].y, 0};
    for (std::size_t i = 1; i < points.size(); ++i) {
        if (c.contains(points[i])) continue;
        c = {points[i].x, points[i].y, 0};
        for (std::size_t j = 0; j < i; ++j) {
            if (c.contains(points[j])) continue;
            c = circleOf(points[i], points[j]);
            for (std::size_t k = 0; k < j; ++k)
                if (!c.contains(points[k])) c = circleOf(points[i], points[j], points[k]);
        }
    }
    return c;
}

// --- the outline ----------------------------------------------------------------

// How wide the band of edge colour is, in pixels: the median over rays cast
// out from the centre. A ray that runs a long way in without the colour
// changing has found a body with no outline there, and if most rays do, the
// body has none and the answer is zero.
double outlineWidth(const std::vector<std::uint8_t>& rgba, const Mask& body, const Circle& outer) {
    const auto inside = [&](double x, double y, int& index) {
        const int ix = static_cast<int>(std::floor(x)), iy = static_cast<int>(std::floor(y));
        if (ix < 0 || iy < 0 || ix >= kN || iy >= kN) return false;
        index = static_cast<int>(at(ix, iy));
        return true;
    };
    std::vector<double> runs;
    int considered = 0;
    constexpr int kRays = 720;
    for (int ray = 0; ray < kRays; ++ray) {
        const double angle = ray * kTau / kRays;
        const double dx = std::cos(angle), dy = std::sin(angle);
        int index = 0;
        double edge = -1;
        for (double r = outer.r + 2.0; r >= 0.0; r -= 0.5) {
            if (inside(outer.x + dx * r, outer.y + dy * r, index) && body[index]) {
                edge = r;
                break;
            }
        }
        if (edge < outer.r * 0.5) continue;   // a notch, not the rim
        const double refR = edge - 1.5;       // past the antialiased fringe
        if (!inside(outer.x + dx * refR, outer.y + dy * refR, index)) continue;
        const std::uint8_t* ref = &rgba[static_cast<std::size_t>(index) * 4];
        if (ref[3] < 250) continue;
        ++considered;
        int misses = 0;
        double firstMiss = -1;
        for (double r = refR - 0.5; r >= edge - outer.r * 0.4; r -= 0.5) {
            if (!inside(outer.x + dx * r, outer.y + dy * r, index)) break;
            const std::uint8_t* p = &rgba[static_cast<std::size_t>(index) * 4];
            int diff = 0;
            for (int ch = 0; ch < 4; ++ch) diff = std::max(diff, std::abs(p[ch] - ref[ch]));
            if (diff > kOutlineTolerance) {
                if (misses++ == 0) firstMiss = r;
                if (misses >= 3) {
                    const auto luma = [](const std::uint8_t* c) {
                        return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
                    };
                    if (luma(p) - luma(ref) >= kOutlineDarker) runs.push_back(edge - firstMiss);
                    break;
                }
            } else {
                misses = 0;
            }
        }
    }
    if (considered == 0 || runs.size() < 0.4 * considered) return 0.0;
    std::nth_element(runs.begin(), runs.begin() + runs.size() / 2, runs.end());
    return runs[runs.size() / 2];
}

// --- fitting ---------------------------------------------------------------------

std::string whyNotFitted(const ContentRegistry& content, const SpriteCache& sprites,
                         std::uint16_t index, bool named) {
    const MobConfig& config = content.mob(index);
    if (config.id == "garbage" || config.id == "digger") return "drawn by code, not its artwork";
    const MobArt art = mobArtFor(config.image);
    // A link from one segment toward the next, not a body about its centre.
    if (art == MobArt::LeechBody) return "a link drawn toward the next segment";
    if (art != MobArt::None && !named)
        return "procedural gardn port, drawn at its hitbox; name it to measure anyway";
    if (config.petalRing.present && config.petalRing.flowerFace) return "drawn as a flower face";
    if (config.size <= 0 || config.visualScale <= 0) return "never drawn (size or visual_scale is 0)";
    if (!sprites.mobDrawable(index)) return "no artwork";
    return {};
}

// Puts back what the opening cut that never strays far from the body: the
// corners it rounded off, as opposed to the legs it removed.
void restoreSlivers(const Mask& solid, Mask& body, double reach) {
    const std::vector<double> toBody = distanceSq(body);
    Mask seen(solid.size(), 0);
    std::vector<int> stack, piece;
    for (std::size_t start = 0; start < solid.size(); ++start) {
        if (!solid[start] || body[start] || seen[start]) continue;
        double farthestSq = 0;
        piece.clear();
        seen[start] = 1;
        stack.push_back(static_cast<int>(start));
        while (!stack.empty()) {
            const int i = stack.back();
            stack.pop_back();
            piece.push_back(i);
            farthestSq = std::max(farthestSq, toBody[i]);
            const int x = i % kN, y = i / kN;
            const int next[4][2] = {{x + 1, y}, {x - 1, y}, {x, y + 1}, {x, y - 1}};
            for (const auto& n : next) {
                if (n[0] < 0 || n[1] < 0 || n[0] >= kN || n[1] >= kN) continue;
                const std::size_t j = at(n[0], n[1]);
                if (solid[j] && !body[j] && !seen[j]) {
                    seen[j] = 1;
                    stack.push_back(static_cast<int>(j));
                }
            }
        }
        if (farthestSq <= reach * reach)
            for (const int i : piece) body[static_cast<std::size_t>(i)] = 1;
    }
}

// Finds the body in one rendered pose and the circle around it. False when
// the pose has nothing solid in it.
bool fitFrame(const std::vector<std::uint8_t>& rgba, const Options& options, FrameFit& out) {
    out.alpha.assign(static_cast<std::size_t>(kN) * kN, 0.0f);
    for (std::size_t i = 0; i < out.alpha.size(); ++i) out.alpha[i] = rgba[i * 4 + 3] / 255.0f;
    const float peak = *std::max_element(out.alpha.begin(), out.alpha.end());
    if (peak < 0.05f) return false;
    out.solid.assign(out.alpha.size(), 0);
    for (std::size_t i = 0; i < out.alpha.size(); ++i)
        out.solid[i] = out.alpha[i] >= options.alpha * peak ? 1 : 0;
    fillHoles(out.solid);

    // An opening -- erode, then grow back -- by a disc sized off the body's own
    // thickness, so a leg is thin relative to THIS mob rather than to a number
    // that suits one mob's scale.
    Mask background(out.solid.size());
    for (std::size_t i = 0; i < out.solid.size(); ++i) background[i] = out.solid[i] ? 0 : 1;
    const std::vector<double> toEdge = distanceSq(background);
    double inscribedSq = 0;
    for (std::size_t i = 0; i < toEdge.size(); ++i)
        if (out.solid[i]) inscribedSq = std::max(inscribedSq, toEdge[i]);
    const double cut = options.cut * std::sqrt(inscribedSq);
    Mask eroded(out.solid.size(), 0);
    bool anyEroded = false;
    for (std::size_t i = 0; i < eroded.size(); ++i) {
        eroded[i] = out.solid[i] && toEdge[i] > cut * cut ? 1 : 0;
        anyEroded = anyEroded || eroded[i];
    }
    out.body = out.solid;
    if (anyEroded) {
        const std::vector<double> toCore = distanceSq(eroded);
        for (std::size_t i = 0; i < out.body.size(); ++i)
            out.body[i] = out.solid[i] && toCore[i] <= cut * cut ? 1 : 0;
        restoreSlivers(out.solid, out.body, cut * kSliverReach);
    }
    out.body = largestComponent(out.body);

    std::vector<Vec2> rim;
    for (int y = 0; y < kN; ++y) {
        for (int x = 0; x < kN; ++x) {
            if (!out.body[at(x, y)]) continue;
            const bool edge = x == 0 || y == 0 || x == kN - 1 || y == kN - 1 ||
                              !out.body[at(x + 1, y)] || !out.body[at(x - 1, y)] ||
                              !out.body[at(x, y + 1)] || !out.body[at(x, y - 1)];
            if (edge) rim.push_back({x + 0.5, y + 0.5});
        }
    }
    if (rim.empty()) return false;
    out.outer = enclosing(std::move(rim));
    out.outer.r += 0.5;   // pixel centres to pixel edges
    out.outlinePx = options.outer ? 0.0 : outlineWidth(rgba, out.body, out.outer);
    return true;
}

double median(std::vector<double> values) {
    std::nth_element(values.begin(), values.begin() + values.size() / 2, values.end());
    return values[values.size() / 2];
}

Fit fitMob(const SpriteCache& sprites, Canvas& canvas, std::uint16_t index, const Options& options) {
    Fit fit;
    std::vector<double> xs, ys, rs, outlines;
    for (int frame = 0; frame < kFrames; ++frame) {
        canvas.clear(Color{0, 0, 0, 0});
        // Rotation 0, unmirrored: the art's own frame, which is the one the
        // offsets are stated in.
        sprites.drawMob(canvas, index, kCentre, kCentre, kArtPx, 0.0, frame * kFrameStep);
        FrameFit pose;
        if (!fitFrame(canvas.getImageData(0, 0, kN, kN), options, pose)) continue;
        xs.push_back(pose.outer.x);
        ys.push_back(pose.outer.y);
        rs.push_back(pose.outer.r);
        outlines.push_back(pose.outlinePx);
        if (xs.size() == 1) fit.first = std::move(pose);
    }
    if (xs.size() * 2 < kFrames) {
        fit.skip = xs.empty() ? "no solid body found" : "a solid body in too few frames to trust";
        return fit;
    }
    fit.outer = {median(xs), median(ys), median(rs)};
    fit.hitboxPx = fit.outer.r - median(outlines) * 0.5;
    fit.scale = kArtRadiusPx / fit.hitboxPx;
    fit.offsetX = -(fit.outer.x - kCentre) / kArtRadiusPx;
    fit.offsetY = -(fit.outer.y - kCentre) / kArtRadiusPx;
    return fit;
}

// --- preview ---------------------------------------------------------------------

constexpr int kPanel = 240;
constexpr double kPanelHitbox = 50.0;
constexpr int kGap = 4;

std::uint32_t crc32(const std::uint8_t* data, std::size_t size, std::uint32_t crc = 0) {
    static std::uint32_t table[256];
    static bool built = false;
    if (!built) {
        for (std::uint32_t n = 0; n < 256; ++n) {
            std::uint32_t c = n;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        built = true;
    }
    crc = ~crc;
    for (std::size_t i = 0; i < size; ++i) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    return ~crc;
}

// An RGB PNG with stored (uncompressed) deflate blocks: no zlib to link, and
// a preview is small enough that the size does not matter.
bool writePng(const std::string& path, int width, int height, const std::vector<std::uint8_t>& rgb) {
    std::vector<std::uint8_t> raw;
    raw.reserve(static_cast<std::size_t>(width * 3 + 1) * height);
    for (int y = 0; y < height; ++y) {
        raw.push_back(0);
        raw.insert(raw.end(), rgb.begin() + static_cast<std::ptrdiff_t>(y) * width * 3,
                   rgb.begin() + static_cast<std::ptrdiff_t>(y + 1) * width * 3);
    }
    std::vector<std::uint8_t> zlib{0x78, 0x01};
    for (std::size_t pos = 0; pos < raw.size();) {
        const std::size_t len = std::min<std::size_t>(65535, raw.size() - pos);
        zlib.push_back(pos + len == raw.size() ? 1 : 0);
        zlib.push_back(static_cast<std::uint8_t>(len & 0xFF));
        zlib.push_back(static_cast<std::uint8_t>(len >> 8));
        zlib.push_back(static_cast<std::uint8_t>(~len & 0xFF));
        zlib.push_back(static_cast<std::uint8_t>((~len >> 8) & 0xFF));
        zlib.insert(zlib.end(), raw.begin() + static_cast<std::ptrdiff_t>(pos),
                    raw.begin() + static_cast<std::ptrdiff_t>(pos + len));
        pos += len;
    }
    std::uint32_t a = 1, b = 0;
    for (std::uint8_t byte : raw) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    const std::uint32_t adler = (b << 16) | a;
    for (int shift = 24; shift >= 0; shift -= 8) zlib.push_back(static_cast<std::uint8_t>(adler >> shift));

    FILE* file = std::fopen(path.c_str(), "wb");
    if (!file) return false;
    const auto be32 = [](std::uint32_t v, std::uint8_t* out) {
        for (int i = 0; i < 4; ++i) out[i] = static_cast<std::uint8_t>(v >> (24 - 8 * i));
    };
    const auto chunk = [&](const char* type, const std::vector<std::uint8_t>& body) {
        std::uint8_t head[8];
        be32(static_cast<std::uint32_t>(body.size()), head);
        std::copy(type, type + 4, head + 4);
        std::uint32_t crc = crc32(head + 4, 4);
        crc = crc32(body.data(), body.size(), crc);
        std::uint8_t tail[4];
        be32(crc, tail);
        std::fwrite(head, 1, 8, file);
        if (!body.empty()) std::fwrite(body.data(), 1, body.size(), file);
        std::fwrite(tail, 1, 4, file);
    };
    static const std::uint8_t kSignature[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    std::fwrite(kSignature, 1, 8, file);
    std::vector<std::uint8_t> header(13, 0);
    be32(static_cast<std::uint32_t>(width), header.data());
    be32(static_cast<std::uint32_t>(height), header.data() + 4);
    header[8] = 8;   // bit depth
    header[9] = 2;   // truecolour
    chunk("IHDR", header);
    chunk("IDAT", zlib);
    chunk("IEND", {});
    return std::fclose(file) == 0;
}

// The art at a given scale and offset, over grass, with the hitbox in red.
std::vector<std::uint8_t> artPanel(const SpriteCache& sprites, std::uint16_t index, double scale,
                                   double offsetX, double offsetY) {
    Canvas canvas = Canvas::createVirtual(kPanel, kPanel);
    canvas.clear(Color{30, 167, 97});
    const double drawn = kPanelHitbox * scale;
    const double mid = kPanel * 0.5;
    sprites.drawMob(canvas, index, mid + offsetX * drawn, mid + offsetY * drawn, drawn * 2.0, 0.0,
                    0.0);
    canvas.setStrokeStyle(Color{255, 40, 40});
    canvas.setLineWidth(2.0f);
    canvas.strokeCircle(static_cast<float>(mid), static_cast<float>(mid),
                        static_cast<float>(kPanelHitbox));
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(mid - 5), static_cast<float>(mid));
    canvas.lineTo(static_cast<float>(mid + 5), static_cast<float>(mid));
    canvas.moveTo(static_cast<float>(mid), static_cast<float>(mid - 5));
    canvas.lineTo(static_cast<float>(mid), static_cast<float>(mid + 5));
    canvas.stroke();
    return canvas.getImageData(0, 0, kPanel, kPanel);
}

bool writePreview(const std::string& path, const SpriteCache& sprites, std::uint16_t index,
                  const MobConfig& config, const Fit& fit) {
    const int width = kPanel * 3 + kGap * 2;
    std::vector<std::uint8_t> rgb(static_cast<std::size_t>(width) * kPanel * 3, 255);
    const auto put = [&](int x, int y, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        if (x < 0 || y < 0 || x >= width || y >= kPanel) return;
        std::uint8_t* p = &rgb[(static_cast<std::size_t>(y) * width + x) * 3];
        p[0] = r;
        p[1] = g;
        p[2] = b;
    };
    const auto blit = [&](const std::vector<std::uint8_t>& rgba, int left) {
        for (int y = 0; y < kPanel; ++y)
            for (int x = 0; x < kPanel; ++x) {
                const std::uint8_t* s = &rgba[(static_cast<std::size_t>(y) * kPanel + x) * 4];
                put(left + x, y, s[0], s[1], s[2]);
            }
    };
    blit(artPanel(sprites, index, config.visualScale, config.visualOffsetX, config.visualOffsetY), 0);
    blit(artPanel(sprites, index, fit.scale, fit.offsetX, fit.offsetY), kPanel + kGap);

    // The body panel samples the measuring canvas, framed on the art's box.
    const int left = (kPanel + kGap) * 2;
    const double span = kArtRadiusPx * 1.25;
    const double step = span * 2.0 / kPanel;
    const double origin = kCentre - span;
    for (int y = 0; y < kPanel; ++y) {
        for (int x = 0; x < kPanel; ++x) {
            const int sx = static_cast<int>(origin + (x + 0.5) * step);
            const int sy = static_cast<int>(origin + (y + 0.5) * step);
            std::uint8_t shade = 25;
            if (sx >= 0 && sy >= 0 && sx < kN && sy < kN) {
                const std::size_t i = at(sx, sy);
                if (fit.first.body[i]) shade = 230;
                else if (fit.first.solid[i]) shade = 120;
                else if (fit.first.alpha[i] > 0.05f) shade = 60;
            }
            put(left + x, y, shade, shade, shade);
        }
    }
    const auto ring = [&](double radius, std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        const double cx = (fit.outer.x - origin) / step, cy = (fit.outer.y - origin) / step;
        const double rr = radius / step;
        for (int i = 0; i < 1440; ++i) {
            const double a = i * kTau / 1440;
            put(left + static_cast<int>(cx + std::cos(a) * rr), static_cast<int>(cy + std::sin(a) * rr),
                r, g, b);
        }
    };
    ring(fit.outer.r, 255, 220, 40);
    ring(fit.hitboxPx, 255, 40, 40);
    return writePng(path, width, kPanel, rgb);
}

// --- output ----------------------------------------------------------------------

// `digits` decimals, trailing zeros dropped, and never "-0".
std::string num(double v, int digits) {
    char text[64];
    std::snprintf(text, sizeof text, "%.*f", digits, v);
    std::string s = text;
    if (s.find('.') != std::string::npos) {
        while (s.back() == '0') s.pop_back();
        if (s.back() == '.') s.pop_back();
    }
    return s == "-0" ? "0" : s;
}

bool parse(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        const auto value = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        if (arg == "--outer") {
            options.outer = true;
        } else if (arg == "--cut" || arg == "--alpha" || arg == "--digits" ||
                   arg == "--preview" || arg == "--mobs" || arg == "--petals") {
            const char* v = value();
            if (!v) {
                std::fprintf(stderr, "%s needs a value\n", arg.c_str());
                return false;
            }
            if (arg == "--cut") options.cut = std::atof(v);
            else if (arg == "--alpha") options.alpha = std::atof(v);
            else if (arg == "--digits") options.digits = std::clamp(std::atoi(v), 0, 12);
            else if (arg == "--preview") options.previewDir = v;
            else if (arg == "--mobs") options.mobsPath = v;
            else options.petalsPath = v;
        } else if (arg == "-h" || arg == "--help") {
            return false;
        } else if (!arg.empty() && arg[0] == '-') {
            std::fprintf(stderr, "unknown option %s\n", arg.c_str());
            return false;
        } else {
            options.ids.push_back(arg);
        }
    }
    return true;
}

} // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parse(argc, argv, options)) {
        std::fprintf(stderr,
                     "usage: hitbox_fit [mob id ...] [--outer] [--cut F] [--alpha F] [--digits N]\n"
                     "                  [--preview DIR] [--mobs PATH] [--petals PATH]\n");
        return 2;
    }

    ContentRegistry content;
    std::string error;
    if (!content.loadFiles(options.mobsPath, options.petalsPath, error)) {
        std::fprintf(stderr, "content: %s\n", error.c_str());
        return 1;
    }
    SpriteCache sprites;
    sprites.build(content, FLIX_TEST_DATA_DIR);

    std::vector<std::uint16_t> indices;
    if (options.ids.empty()) {
        for (std::size_t i = 0; i < content.mobCount(); ++i) indices.push_back(static_cast<std::uint16_t>(i));
    } else {
        for (const std::string& id : options.ids) {
            const std::uint16_t index = content.mobIndex(id);
            if (index == kInvalidIndex) {
                std::fprintf(stderr, "no such mob: %s\n", id.c_str());
                return 1;
            }
            indices.push_back(index);
        }
    }

    std::printf("Hitbox fitted %s. Offsets are in drawn radii, in the art's own frame.\n\n",
                options.outer ? "to the outside edge of the body's outline (--outer)"
                              : "through the middle of the body's outline, as gardn does");
    // Wide enough for "-0.1234 -> -0.1234" at the chosen precision.
    const int column = 2 * (options.digits + 4) + 4;
    std::printf("%-22s %-*s %-*s %-*s\n", "mob", column, "visual_scale", column, "visualOffsetX",
                column, "visualOffsetY");

    struct Change { std::string id; std::string line; };
    std::vector<Change> changes;
    std::vector<std::string> skipped;
    Canvas canvas = Canvas::createVirtual(kN, kN);
    for (const std::uint16_t index : indices) {
        const MobConfig& config = content.mob(index);
        std::string skip = whyNotFitted(content, sprites, index, !options.ids.empty());
        Fit fit;
        if (skip.empty()) {
            fit = fitMob(sprites, canvas, index, options);
            skip = fit.skip;
        }
        if (!skip.empty()) {
            skipped.push_back(config.id + " (" + skip + ")");
            continue;
        }

        const double nowScale = config.visualScale;
        const bool ok = std::fabs(fit.scale / nowScale - 1.0) < kScaleTolerance &&
                        std::fabs(fit.offsetX - config.visualOffsetX) < kOffsetTolerance &&
                        std::fabs(fit.offsetY - config.visualOffsetY) < kOffsetTolerance;
        const int digits = options.digits;
        const auto pair = [digits](double now, double fitted) {
            return num(now, digits) + " -> " + num(fitted, digits);
        };
        std::printf("%-22s %-*s %-*s %-*s %s\n", config.id.c_str(), column,
                    pair(nowScale, fit.scale).c_str(), column,
                    pair(config.visualOffsetX, fit.offsetX).c_str(), column,
                    pair(config.visualOffsetY, fit.offsetY).c_str(), ok ? "ok" : "CHANGE");

        if (!ok) {
            std::string line = "\"visual_scale\": " + num(fit.scale, digits);
            // An offset inside the tolerance is noise -- a hundredth of a drawn
            // radius is a third of a pixel on a common mob -- so it is left
            // out, unless the entry has one now that has to move.
            const auto wanted = [](double now, double fitted) {
                return std::fabs(fitted) >= kOffsetTolerance ||
                       std::fabs(fitted - now) >= kOffsetTolerance;
            };
            if (wanted(config.visualOffsetX, fit.offsetX))
                line += ", \"visualOffsetX\": " + num(fit.offsetX, digits);
            if (wanted(config.visualOffsetY, fit.offsetY))
                line += ", \"visualOffsetY\": " + num(fit.offsetY, digits);
            changes.push_back({config.id, line});
        }
        if (!options.previewDir.empty()) {
            const std::string path = options.previewDir + "/" + config.id + ".png";
            if (!writePreview(path, sprites, index, config, fit))
                std::fprintf(stderr, "could not write %s\n", path.c_str());
        }
    }

    if (!skipped.empty()) {
        std::printf("\nNot fitted:\n");
        for (const std::string& line : skipped) std::printf("  %s\n", line.c_str());
    }
    if (changes.empty()) {
        std::printf("\nEvery fitted mob is already on its hitbox.\n");
    } else {
        std::printf("\nFor src/mobs.json:\n");
        for (const Change& change : changes)
            std::printf("  %-22s %s\n", (change.id + ":").c_str(), change.line.c_str());
    }
    if (!options.previewDir.empty()) std::printf("\nPreviews in %s\n", options.previewDir.c_str());
    return 0;
}
