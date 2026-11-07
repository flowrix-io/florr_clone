#include "shared/game/skin_likeness.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <unordered_map>
#include <utility>

#include "shared/core/types.h"

namespace flix {

namespace {

// --- the grid ----------------------------------------------------------------

/// Where cell 0's left edge sits: the grid is centred on the flower.
constexpr double kGridOrigin = -kSkinLookCell * kSkinLookGrid * 0.5;
/// renderSkinShapes' clip disc, in authored units.
constexpr double kClipRadius = 100.0;
/// Segments a curve is flattened into. Finer than a cell along any curve a
/// skin's coordinate limits allow.
constexpr int kCurveSegments = 16;
/// How deep a skin's rim is, in cells: the studio's default outline (3 units)
/// and a little more.
constexpr int kRimCells = 2;
/// How much of what a skin paints must lie inside its rim for it to have a body
/// at all. Over a 96-skin catalog the floating line art came out at 12% or less
/// and everything with a body at 32% or more.
constexpr double kBodyShare = 0.25;

double cellCentre(int i) { return kGridOrigin + (i + 0.5) * kSkinLookCell; }

/// True when a painted cell is in `look`'s rim: within kRimCells of the outside.
bool inRim(const SkinLook& look, int x, int y) {
    for (int dy = -kRimCells; dy <= kRimCells; ++dy) {
        for (int dx = -kRimCells; dx <= kRimCells; ++dx) {
            if (look.at(x + dx, y + dy) == 0) return true;
        }
    }
    return false;
}

/// The first and last cells whose centres lie in [lo, hi], clamped to the
/// grid. first > last when none do.
int firstCellAtOrAfter(double lo) {
    const double i = std::ceil((lo - kGridOrigin) / kSkinLookCell - 0.5);
    return static_cast<int>(clamp(i, 0.0, static_cast<double>(kSkinLookGrid)));
}
int lastCellAtOrBefore(double hi) {
    const double i = std::floor((hi - kGridOrigin) / kSkinLookCell - 0.5);
    return static_cast<int>(clamp(i, -1.0, static_cast<double>(kSkinLookGrid - 1)));
}

/// "#rrggbb" as a painted cell. The colours here are sanitized ones, so the
/// fallback is only ever reached by a catalog an older build wrote.
std::uint32_t paintOf(const std::string& colour) {
    if (!isSkinHexColor(colour)) return 0x01111111u;
    return 0x01000000u | static_cast<std::uint32_t>(std::strtoul(colour.c_str() + 1, nullptr, 16));
}

struct Point {
    double x, y;
};

double segmentDistanceSq(Point p, Point a, Point b) {
    const double dx = b.x - a.x, dy = b.y - a.y;
    const double lengthSq = dx * dx + dy * dy;
    double t = 0;
    if (lengthSq > 0) t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0.0, 1.0);
    const double ex = p.x - (a.x + t * dx), ey = p.y - (a.y + t * dy);
    return ex * ex + ey * ey;
}

/// The full grid while a skin is being painted; cropped once it is done.
class Raster {
public:
    Raster() : cells_(static_cast<std::size_t>(kSkinLookGrid) * kSkinLookGrid, 0u) {}

    /// Calls `fn(x, y, worldPoint)` for every cell inside the clip disc whose
    /// centre lies in the box.
    template <class Fn>
    void eachCell(double minX, double minY, double maxX, double maxY, Fn&& fn) {
        const int y1 = lastCellAtOrBefore(maxY);
        for (int y = firstCellAtOrAfter(minY); y <= y1; ++y) eachCellInRow(y, minX, maxX, fn);
    }

    /// The same along one row, named by index: a row's own centre handed back
    /// through firstCellAtOrAfter can round onto the row after it.
    template <class Fn>
    void eachCellInRow(int y, double minX, double maxX, Fn&& fn) {
        const double py = cellCentre(y);
        const int x1 = lastCellAtOrBefore(maxX);
        for (int x = firstCellAtOrAfter(minX); x <= x1; ++x) {
            const double px = cellCentre(x);
            if (px * px + py * py > kClipRadius * kClipRadius) continue;
            fn(x, y, Point{px, py});
        }
    }

    void paint(int x, int y, std::uint32_t colour) {
        cells_[static_cast<std::size_t>(y) * kSkinLookGrid + static_cast<std::size_t>(x)] = colour;
    }

    /// Nonzero-winding fill of a closed polygon in grid space, as canvas
    /// fill() does it: a row at a time, between its edge crossings.
    void fillPolygon(const std::vector<Point>& poly, std::uint32_t colour) {
        if (poly.size() < 3) return;
        double minY = poly[0].y, maxY = poly[0].y;
        for (const Point& p : poly) {
            minY = std::min(minY, p.y);
            maxY = std::max(maxY, p.y);
        }
        std::vector<std::pair<double, int>> crossings;
        crossings.reserve(poly.size());
        const int y1 = lastCellAtOrBefore(maxY);
        for (int y = firstCellAtOrAfter(minY); y <= y1; ++y) {
            const double py = cellCentre(y);
            crossings.clear();
            for (std::size_t i = 0; i < poly.size(); ++i) {
                const Point a = poly[i], b = poly[(i + 1) % poly.size()];
                if ((a.y <= py) == (b.y <= py)) continue;
                const double x = a.x + (py - a.y) / (b.y - a.y) * (b.x - a.x);
                crossings.emplace_back(x, b.y > a.y ? 1 : -1);
            }
            std::sort(crossings.begin(), crossings.end());
            int winding = 0;
            for (std::size_t i = 0; i + 1 < crossings.size(); ++i) {
                winding += crossings[i].second;
                if (winding == 0) continue;
                eachCellInRow(y, crossings[i].first, crossings[i + 1].first,
                              [&](int x, int yy, Point) { paint(x, yy, colour); });
            }
        }
    }

    /// A round-capped stroke along a polyline in grid space: every cell within
    /// half the line width of a segment, so joins come out round as well.
    void strokePolyline(const std::vector<Point>& line, bool closed, double halfWidth,
                        std::uint32_t colour) {
        const std::size_t n = line.size();
        if (n == 0) return;
        const std::size_t segments = closed ? n : n - 1;
        for (std::size_t i = 0; i < std::max<std::size_t>(segments, 1); ++i) {
            const Point a = line[i], b = line[(i + 1) % n];
            eachCell(std::min(a.x, b.x) - halfWidth, std::min(a.y, b.y) - halfWidth,
                     std::max(a.x, b.x) + halfWidth, std::max(a.y, b.y) + halfWidth,
                     [&](int x, int y, Point p) {
                         if (segmentDistanceSq(p, a, b) <= halfWidth * halfWidth) {
                             paint(x, y, colour);
                         }
                     });
        }
    }

    SkinLook crop() const {
        SkinLook look;
        int minX = kSkinLookGrid, minY = kSkinLookGrid, maxX = -1, maxY = -1;
        for (int y = 0; y < kSkinLookGrid; ++y) {
            for (int x = 0; x < kSkinLookGrid; ++x) {
                if (cells_[static_cast<std::size_t>(y) * kSkinLookGrid + x] == 0) continue;
                minX = std::min(minX, x);
                maxX = std::max(maxX, x);
                minY = std::min(minY, y);
                maxY = std::max(maxY, y);
            }
        }
        if (maxX < 0) return look;
        look.x0 = minX;
        look.y0 = minY;
        look.w = maxX - minX + 1;
        look.h = maxY - minY + 1;
        look.cells.reserve(static_cast<std::size_t>(look.w) * look.h);
        for (int y = minY; y <= maxY; ++y) {
            const auto row = cells_.begin() + static_cast<long>(y) * kSkinLookGrid;
            look.cells.insert(look.cells.end(), row + minX, row + maxX + 1);
        }
        measure(look);
        return look;
    }

private:
    /// Fills in what skinsLookSimilar reads, so a cached look need not recount.
    static void measure(SkinLook& look) {
        std::unordered_map<std::uint32_t, int> counts;
        double sumX = 0, sumY = 0;
        for (int y = 0; y < look.h; ++y) {
            for (int x = 0; x < look.w; ++x) {
                const std::uint32_t colour = look.cells[static_cast<std::size_t>(y) * look.w + x];
                if (colour == 0) continue;
                ++look.painted;
                ++counts[colour];
                sumX += look.x0 + x;
                sumY += look.y0 + y;
            }
        }
        look.centreX = sumX / look.painted;
        look.centreY = sumY / look.painted;

        // The lowest colour on a tie, so the answer never depends on the map's
        // iteration order.
        std::uint32_t body = 0;
        int most = 0;
        for (const auto& [colour, count] : counts) {
            if (count > most || (count == most && colour < body)) {
                body = colour;
                most = count;
            }
        }
        int inside = 0;
        for (int y = look.y0; y < look.y0 + look.h; ++y) {
            for (int x = look.x0; x < look.x0 + look.w; ++x) {
                const std::uint32_t colour = look.at(x, y);
                if (colour == 0 || inRim(look, x, y)) continue;
                ++inside;
                if (colour != body) ++look.detail;
            }
        }
        look.hasBody = inside >= look.painted * kBodyShare;
    }

    std::vector<std::uint32_t> cells_;
};

/// One shape's placement: renderSkinShapes translates to (x, y), then rotates.
struct Placement {
    double x, y, c, s;

    explicit Placement(const SkinShape& shape)
        : x(shape.x), y(shape.y), c(std::cos(shape.rot * kPi / 180.0)),
          s(std::sin(shape.rot * kPi / 180.0)) {}

    Point toWorld(double lx, double ly) const { return {x + lx * c - ly * s, y + lx * s + ly * c}; }
    Point toLocal(Point p) const {
        const double dx = p.x - x, dy = p.y - y;
        return {dx * c + dy * s, -dx * s + dy * c};
    }
};

/// The outline as a list of points in grid space, for the shapes whose
/// outline is made of segments.
std::vector<Point> outlineOf(const SkinShape& shape, const Placement& at) {
    std::vector<Point> out;
    switch (shape.t) {
        case SkinShapeType::Polygon:
            for (std::size_t i = 0; i + 1 < shape.points.size(); i += 2) {
                out.push_back(at.toWorld(shape.points[i], shape.points[i + 1]));
            }
            break;
        case SkinShapeType::Line:
            out.push_back(at.toWorld(0, 0));
            out.push_back(at.toWorld(shape.x2 - shape.x, shape.y2 - shape.y));
            break;
        case SkinShapeType::Curve: {
            // The endpoint and both control points are absolute, as in the
            // painter; the curve starts on (x, y), the shape's own origin.
            const double p1x = shape.cx1 - shape.x, p1y = shape.cy1 - shape.y;
            const double p2x = shape.cx2 - shape.x, p2y = shape.cy2 - shape.y;
            const double p3x = shape.x2 - shape.x, p3y = shape.y2 - shape.y;
            for (int i = 0; i <= kCurveSegments; ++i) {
                const double t = static_cast<double>(i) / kCurveSegments, u = 1.0 - t;
                const double b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
                out.push_back(at.toWorld(b1 * p1x + b2 * p2x + b3 * p3x,
                                         b1 * p1y + b2 * p2y + b3 * p3y));
            }
            break;
        }
        default:
            break;
    }
    return out;
}

void sampleShape(Raster& raster, const SkinShape& shape) {
    const Placement at(shape);
    const bool filled = !shape.fill.empty() && shape.t != SkinShapeType::Line;
    const bool stroked = !shape.stroke.empty() && shape.sw > 0;
    const std::uint32_t fill = filled ? paintOf(shape.fill) : 0;
    const std::uint32_t stroke = stroked ? paintOf(shape.stroke) : 0;
    const double half = stroked ? shape.sw * 0.5 : 0.0;

    // The closed shapes, tested a cell at a time in their own local space.
    // `edge` is the distance from the outline, for the stroke.
    auto perCell = [&](double reach, auto&& inside, auto&& edge) {
        const double r = reach + half;
        raster.eachCell(shape.x - r, shape.y - r, shape.x + r, shape.y + r,
                        [&](int x, int y, Point p) {
                            const Point l = at.toLocal(p);
                            if (stroked && edge(l) <= half) {
                                raster.paint(x, y, stroke);
                            } else if (filled && inside(l)) {
                                raster.paint(x, y, fill);
                            }
                        });
    };

    switch (shape.t) {
        case SkinShapeType::Circle: {
            const double r = shape.r != 0 ? shape.r : 1.0;
            perCell(r, [&](Point l) { return l.x * l.x + l.y * l.y <= r * r; },
                    [&](Point l) { return std::abs(std::sqrt(l.x * l.x + l.y * l.y) - r); });
            return;
        }
        case SkinShapeType::Ellipse: {
            const double rx = shape.rx != 0 ? shape.rx : 1.0;
            const double ry = shape.ry != 0 ? shape.ry : 1.0;
            perCell(std::max(rx, ry),
                    [&](Point l) { return (l.x / rx) * (l.x / rx) + (l.y / ry) * (l.y / ry) <= 1.0; },
                    [&](Point l) {
                        // First-order distance to the ellipse, |g| / |grad g|
                        // for g = |(x/rx, y/ry)| - 1: exact on a circle and
                        // close enough near any outline a cell can resolve.
                        const double q = std::hypot(l.x / rx, l.y / ry);
                        const double grad = std::hypot(l.x / (rx * rx), l.y / (ry * ry));
                        if (q <= 0 || grad <= 0) return rx + ry;
                        return std::abs(q - 1.0) / (grad / q);
                    });
            return;
        }
        case SkinShapeType::Rect: {
            const double rx = shape.rx != 0 ? shape.rx : 1.0;
            const double ry = shape.ry != 0 ? shape.ry : 1.0;
            perCell(std::hypot(rx, ry),
                    [&](Point l) { return std::abs(l.x) <= rx && std::abs(l.y) <= ry; },
                    [&](Point l) {
                        const double ax = std::abs(l.x) - rx, ay = std::abs(l.y) - ry;
                        if (ax <= 0 && ay <= 0) return std::min(-ax, -ay);
                        return std::hypot(std::max(ax, 0.0), std::max(ay, 0.0));
                    });
            return;
        }
        case SkinShapeType::Polygon:
        case SkinShapeType::Line:
        case SkinShapeType::Curve: {
            const std::vector<Point> outline = outlineOf(shape, at);
            // A filled curve closes with a chord from its end back to its
            // start, which is what fill() does to an open path.
            if (filled) raster.fillPolygon(outline, fill);
            if (stroked) {
                raster.strokePolyline(outline, shape.t == SkinShapeType::Polygon, half, stroke);
            }
            return;
        }
    }
}

bool sameColour(std::uint32_t a, std::uint32_t b, int slack) {
    if (a == b) return true;
    if (a == 0 || b == 0) return false;
    for (int shift = 0; shift <= 16; shift += 8) {
        const int ca = static_cast<int>((a >> shift) & 0xFF), cb = static_cast<int>((b >> shift) & 0xFF);
        if (std::abs(ca - cb) > slack) return false;
    }
    return true;
}

/// True when `look` has `colour` -- or nothing, for an unpainted cell --
/// within kSkinLookNudgeCells of (x, y).
bool foundNear(const SkinLook& look, std::uint32_t colour, int x, int y, int slack) {
    if (sameColour(colour, look.at(x, y), slack)) return true;
    for (int dy = -kSkinLookNudgeCells; dy <= kSkinLookNudgeCells; ++dy) {
        for (int dx = -kSkinLookNudgeCells; dx <= kSkinLookNudgeCells; ++dx) {
            if (sameColour(colour, look.at(x + dx, y + dy), slack)) return true;
        }
    }
    return false;
}

/// True when `look` paints anything within kSkinLookNudgeCells of (x, y).
bool paintedNear(const SkinLook& look, int x, int y) {
    for (int dy = -kSkinLookNudgeCells; dy <= kSkinLookNudgeCells; ++dy) {
        for (int dx = -kSkinLookNudgeCells; dx <= kSkinLookNudgeCells; ++dx) {
            if (look.at(x + dx, y + dy) != 0) return true;
        }
    }
    return false;
}

/// True when two skins that disagree at (x, y) disagree only about their rims:
/// both paint the cell and it is rim on both, or one paints it right beside what
/// the other paints. Rim on one only does not count: an ear drawn over the other
/// skin's rim is the middle of something new.
bool onlyRimsDiffer(const SkinLook& a, const SkinLook& b, int x, int y) {
    const bool paintedA = a.at(x, y) != 0, paintedB = b.at(x, y) != 0;
    if (paintedA && paintedB) return inRim(a, x, y) && inRim(b, x, y);
    return paintedNear(paintedA ? b : a, x, y);
}

int countDifferences(const SkinLook& a, const SkinLook& b, int stopAfter, int colourSlack,
                     bool forgiveRims) {
    if (a.w == 0 && b.w == 0) return 0;
    // Outside both crops both are unpainted, which matches itself, so only
    // the union of the two can hold a difference.
    int minX = kSkinLookGrid, minY = kSkinLookGrid, maxX = -1, maxY = -1;
    for (const SkinLook* look : {&a, &b}) {
        if (look->w == 0) continue;
        minX = std::min(minX, look->x0);
        minY = std::min(minY, look->y0);
        maxX = std::max(maxX, look->x0 + look->w - 1);
        maxY = std::max(maxY, look->y0 + look->h - 1);
    }
    int differing = 0;
    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            const std::uint32_t ca = a.at(x, y), cb = b.at(x, y);
            if (ca == cb) continue;
            if (foundNear(b, ca, x, y, colourSlack) && foundNear(a, cb, x, y, colourSlack)) continue;
            if (forgiveRims && onlyRimsDiffer(a, b, x, y)) continue;
            // Two different skins usually part company within a row or two of
            // the first face feature, so this rarely scans far.
            if (++differing > stopAfter) return differing;
        }
    }
    return differing;
}

/// The difference the wide tests hold against their allowance: over the cells
/// SkinLook::detail counts, so the two measure one thing. A rim's colour is
/// forgiven. Counted, a new rim cost 60 to 80 cells however little was on the skin,
/// which took a copy with one circle under it past the allowance of most of a
/// catalog. Its shape is not, past the nudge: ears or a crown are all rim, and they
/// are a new skin. Line art with no body is nothing but rim, so it is compared in
/// full.
int innerDifference(const SkinLook& a, const SkinLook& b, int stopAfter) {
    return countDifferences(a, b, stopAfter, kSkinSimilarColourSlack, a.hasBody && b.hasBody);
}

/// `look` resized by `scale` about its middle and moved so that middle lands on
/// `like`'s. Nearest-cell, which is fine here: the comparison it is for forgives
/// a cell of movement anyway.
SkinLook fittedOnto(const SkinLook& look, const SkinLook& like, double scale) {
    const auto toGrid = [&](int at, double from, double to) {
        return static_cast<int>(std::lround((at - from) * scale + to));
    };
    const int left = std::max(0, toGrid(look.x0, look.centreX, like.centreX) - 1);
    const int top = std::max(0, toGrid(look.y0, look.centreY, like.centreY) - 1);
    const int right = std::min(kSkinLookGrid - 1,
                               toGrid(look.x0 + look.w - 1, look.centreX, like.centreX) + 1);
    const int bottom = std::min(kSkinLookGrid - 1,
                                toGrid(look.y0 + look.h - 1, look.centreY, like.centreY) + 1);
    SkinLook out;
    out.hasBody = look.hasBody;
    if (right < left || bottom < top) return out;
    out.x0 = left;
    out.y0 = top;
    out.w = right - left + 1;
    out.h = bottom - top + 1;
    out.cells.reserve(static_cast<std::size_t>(out.w) * out.h);
    for (int y = top; y <= bottom; ++y) {
        const int fromY = static_cast<int>(std::lround((y - like.centreY) / scale + look.centreY));
        for (int x = left; x <= right; ++x) {
            const int fromX = static_cast<int>(std::lround((x - like.centreX) / scale + look.centreX));
            out.cells.push_back(look.at(fromX, fromY));
        }
    }
    return out;
}

/// True when no more than `allowed` cells differ, as drawn or with the pictures
/// lined up. The smaller is fitted onto the larger whichever way round they were
/// passed, and their areas give the ratio, which a stray speck barely moves.
bool differsByAtMostLinedUp(const SkinLook& a, const SkinLook& b, int allowed) {
    if (innerDifference(a, b, allowed) <= allowed) return true;
    if (a.painted == 0 || b.painted == 0) return false;
    const SkinLook& large = a.painted >= b.painted ? a : b;
    const SkinLook& small = a.painted >= b.painted ? b : a;
    const double scale = std::sqrt(static_cast<double>(large.painted) / small.painted);
    if (scale > kSkinSimilarMaxRescale) return false;
    return innerDifference(large, fittedOnto(small, large, scale), allowed) <= allowed;
}

void hashBytes(std::uint64_t& h, const void* data, std::size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < size; ++i) h = (h ^ bytes[i]) * 1099511628211ull;
}

void hashNumber(std::uint64_t& h, double v) {
    std::uint64_t bits = 0;
    std::memcpy(&bits, &v, sizeof bits);
    hashBytes(h, &bits, sizeof bits);
}

void hashText(std::uint64_t& h, const std::string& s) {
    hashNumber(h, static_cast<double>(s.size()));
    hashBytes(h, s.data(), s.size());
}

} // namespace

SkinLook sampleSkinLook(const std::vector<SkinShape>& shapes) {
    Raster raster;
    for (const SkinShape& shape : shapes) sampleShape(raster, shape);
    return raster.crop();
}

int skinLookDifference(const SkinLook& a, const SkinLook& b, int stopAfter) {
    return countDifferences(a, b, stopAfter, kSkinLookColourSlack, false);
}

bool skinsLookAlikeLinedUp(const SkinLook& a, const SkinLook& b) {
    return differsByAtMostLinedUp(a, b, kSkinLookAlikeCells);
}

bool skinsLookSimilar(const SkinLook& a, const SkinLook& b) {
    const int detailShare =
        static_cast<int>(kSkinSimilarDetailShare * std::min(a.detail, b.detail));
    return differsByAtMostLinedUp(a, b, std::max(kSkinLookAlikeCells, detailShare));
}

std::uint64_t skinShapesHash(const std::vector<SkinShape>& shapes) {
    std::uint64_t h = 1469598103934665603ull;
    for (const SkinShape& s : shapes) {
        hashNumber(h, static_cast<double>(s.t));
        for (const double v : {s.x, s.y, s.r, s.rx, s.ry, s.x2, s.y2, s.cx1, s.cy1, s.cx2, s.cy2,
                               s.rot, s.sw}) {
            hashNumber(h, v);
        }
        hashNumber(h, static_cast<double>(s.points.size()));
        for (const double v : s.points) hashNumber(h, v);
        hashText(h, s.fill);
        hashText(h, s.stroke);
    }
    return h;
}

std::vector<SkinShape> starterSkinShapes() {
    std::vector<SkinShape> out;
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 25;
    body.fill = "#ffe763";
    body.stroke = "#cdb74f";
    body.sw = 3;
    out.push_back(body);
    for (const double ex : {-7.0, 7.0}) {
        SkinShape eye;
        eye.t = SkinShapeType::Ellipse;
        eye.x = ex;
        eye.y = -5;
        eye.rx = 3.2;
        eye.ry = 6.5;
        eye.fill = "#111111";
        out.push_back(eye);
    }
    return out;
}

} // namespace flix
