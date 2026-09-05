#pragma once
// Small value types and math shared by every part of the game.

#include <cstdint>
#include <cmath>
#include <algorithm>

namespace flix {

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// World coordinates are doubles. The world is 60k x 60k and regions sit far
// off-origin, where a float's 24-bit mantissa quantises movement badly enough
// to see; only per-frame render locals are ever narrowed to float.
struct Vec2 {
    double x = 0, y = 0;

    constexpr Vec2() = default;
    constexpr Vec2(double px, double py) : x(px), y(py) {}

    constexpr Vec2 operator+(Vec2 o) const { return {x + o.x, y + o.y}; }
    constexpr Vec2 operator-(Vec2 o) const { return {x - o.x, y - o.y}; }
    constexpr Vec2 operator*(double s) const { return {x * s, y * s}; }
    constexpr Vec2 operator/(double s) const { return {x / s, y / s}; }
    constexpr Vec2 operator-() const { return {-x, -y}; }
    Vec2& operator+=(Vec2 o) { x += o.x; y += o.y; return *this; }
    Vec2& operator-=(Vec2 o) { x -= o.x; y -= o.y; return *this; }
    Vec2& operator*=(double s) { x *= s; y *= s; return *this; }
    constexpr bool operator==(Vec2 o) const { return x == o.x && y == o.y; }

    double length() const { return std::sqrt(x * x + y * y); }
    constexpr double lengthSq() const { return x * x + y * y; }
    double angle() const { return std::atan2(y, x); }

    // Zero-length stays zero rather than producing NaN; callers treat "no
    // direction" as a valid state (a stationary player, a target on top of us).
    Vec2 normalized() const {
        const double len = length();
        return len > 1e-12 ? Vec2{x / len, y / len} : Vec2{0, 0};
    }

    // Rescales to at most `max`, leaving shorter vectors untouched.
    Vec2 clampedLength(double max) const {
        const double lenSq = lengthSq();
        if (lenSq <= max * max || lenSq < 1e-24) return *this;
        const double len = std::sqrt(lenSq);
        return {x / len * max, y / len * max};
    }

    static Vec2 fromAngle(double radians, double length = 1.0) {
        return {std::cos(radians) * length, std::sin(radians) * length};
    }
};

inline constexpr Vec2 operator*(double s, Vec2 v) { return v * s; }

inline double distance(Vec2 a, Vec2 b) { return (a - b).length(); }
inline constexpr double distanceSq(Vec2 a, Vec2 b) { return (a - b).lengthSq(); }

struct Rect {
    double x = 0, y = 0, w = 0, h = 0;
    constexpr double left() const { return x; }
    constexpr double top() const { return y; }
    constexpr double right() const { return x + w; }
    constexpr double bottom() const { return y + h; }
    constexpr bool contains(Vec2 p) const {
        return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
    }
    constexpr bool intersects(const Rect& o) const {
        return x < o.right() && right() > o.x && y < o.bottom() && bottom() > o.y;
    }
};

// ---------------------------------------------------------------------------
// Scalar math
// ---------------------------------------------------------------------------

inline constexpr double kPi = 3.14159265358979323846;
inline constexpr double kTau = 2.0 * kPi;

template <class T>
constexpr T clamp(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

inline constexpr double lerp(double a, double b, double t) { return a + (b - a) * t; }

// Wraps to (-pi, pi] -- the same range std::atan2 produces, so a wrapped angle
// and a freshly computed heading can be compared directly. Used everywhere an
// angular difference is taken, so that turning from +179 to -179 degrees reads
// as a 2 degree turn and not a 358 degree one.
inline double wrapAngle(double a) {
    a = std::fmod(a, kTau);
    if (a <= -kPi) a += kTau;
    else if (a > kPi) a -= kTau;
    return a;
}

inline double angleDelta(double from, double to) { return wrapAngle(to - from); }

// Shortest-path angular interpolation.
inline double lerpAngle(double from, double to, double t) {
    return wrapAngle(from + angleDelta(from, to) * t);
}

// Frame-rate independent exponential approach. `rate` is the fraction of the
// remaining gap closed per second; the pow() makes a 30Hz and a 144Hz client
// converge identically instead of the faster one converging sooner.
inline double damp(double current, double target, double rate, double dtSeconds) {
    return lerp(target, current, std::pow(1.0 - rate, dtSeconds));
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

// xoshiro256++. Seeded explicitly so that anything that must agree between
// runs or between machines (maze layout, map decoration) is reproducible, and
// so a test can pin a seed and get the same rolls every time.
class Rng {
public:
    explicit Rng(std::uint64_t seed = 0x9E3779B97F4A7C15ull) { reseed(seed); }

    void reseed(std::uint64_t seed) {
        // SplitMix64 expands one seed word into the four-word state; seeding
        // the state directly from a small counter gives poor early output.
        for (auto& s : s_) {
            seed += 0x9E3779B97F4A7C15ull;
            std::uint64_t z = seed;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
            s = z ^ (z >> 31);
        }
    }

    std::uint64_t next() {
        const std::uint64_t result = rotl(s_[0] + s_[3], 23) + s_[0];
        const std::uint64_t t = s_[1] << 17;
        s_[2] ^= s_[0];
        s_[3] ^= s_[1];
        s_[1] ^= s_[2];
        s_[0] ^= s_[3];
        s_[2] ^= t;
        s_[3] = rotl(s_[3], 45);
        return result;
    }

    /// Uniform in [0, 1).
    double unit() { return static_cast<double>(next() >> 11) * 0x1.0p-53; }
    double range(double lo, double hi) { return lo + unit() * (hi - lo); }
    double angle() { return unit() * kTau; }
    bool chance(double probability) { return unit() < probability; }

    /// Uniform integer in [0, bound). Returns 0 for an empty bound.
    std::uint32_t below(std::uint32_t bound) {
        if (bound == 0) return 0;
        // Lemire's debiased multiply-shift: one multiply in the common case,
        // and no modulo bias, which matters for drop tables.
        std::uint64_t product = static_cast<std::uint64_t>(next() >> 32) * bound;
        std::uint32_t low = static_cast<std::uint32_t>(product);
        if (low < bound) {
            const std::uint32_t threshold = (~bound + 1u) % bound;
            while (low < threshold) {
                product = static_cast<std::uint64_t>(next() >> 32) * bound;
                low = static_cast<std::uint32_t>(product);
            }
        }
        return static_cast<std::uint32_t>(product >> 32);
    }

    int rangeInt(int lo, int hiInclusive) {
        if (hiInclusive <= lo) return lo;
        return lo + static_cast<int>(below(static_cast<std::uint32_t>(hiInclusive - lo + 1)));
    }

    Vec2 insideCircle(double radius) {
        // sqrt() of the uniform makes the samples area-uniform; without it
        // spawns bunch up at the centre of every spawn ring.
        const double r = radius * std::sqrt(unit());
        const double a = angle();
        return Vec2::fromAngle(a, r);
    }

private:
    static constexpr std::uint64_t rotl(std::uint64_t x, int k) {
        return (x << k) | (x >> (64 - k));
    }
    std::uint64_t s_[4]{};
};

} // namespace flix
