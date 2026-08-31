#pragma once
// Gameplay constants and the shared movement step.
//
// Anything here that both sides need is here precisely so there is one copy:
// the client predicts movement with the same function the server authorises it
// with, so straight-line movement reconciles to nothing at all.

#include "shared/core/types.h"
#include "shared/net/protocol.h"

namespace flr {

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

inline constexpr double kWorldSize = 60000.0;
inline constexpr double kWorldHalf = kWorldSize * 0.5;

/// The map is a 3x3 grid of biome sections, each 20000 units square. A mob's
/// `section` list in mobs.json indexes into this grid.
inline constexpr int kSectionsPerAxis = 3;
inline constexpr int kSectionCount = kSectionsPerAxis * kSectionsPerAxis;
inline constexpr double kSectionSize = kWorldSize / kSectionsPerAxis;

/// Which section contains a world position, or -1 when outside the map.
inline int sectionAt(Vec2 p) {
    const int cx = static_cast<int>(std::floor(p.x / kSectionSize));
    const int cy = static_cast<int>(std::floor(p.y / kSectionSize));
    if (cx < 0 || cy < 0 || cx >= kSectionsPerAxis || cy >= kSectionsPerAxis) return -1;
    return cy * kSectionsPerAxis + cx;
}

/// Terrain is a coarse tile grid rather than polygons: collision is then a
/// couple of array reads instead of a broadphase, and the whole map is a byte
/// per tile.
inline constexpr double kTileSize = 300.0;
inline constexpr int kTilesPerAxis = static_cast<int>(kWorldSize / kTileSize);  // 200

enum class Tile : std::uint8_t {
    Ground = 0,
    Wall = 1,     ///< blocks movement
    Water = 2,    ///< passable, slows movement
    Sand = 3,     ///< TypeScript custom tile 3: bridge (passable)
    Stone = 4,    ///< TypeScript custom tile 4: sewage (solid)
    Block = 5,    ///< TypeScript custom tile 5: block (solid)
};

inline constexpr bool tileBlocks(Tile t) {
    return t == Tile::Wall || t == Tile::Stone || t == Tile::Block;
}
inline constexpr bool tileIsWater(Tile t) { return t == Tile::Water; }

/// Multiplier applied to top speed while in water. Slow enough to matter,
/// fast enough that crossing a river is not a punishment.
inline constexpr double kWaterSpeedScale = 0.55;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

inline constexpr double kPlayerBaseRadius = 20.0;
inline constexpr double kPlayerBaseHealth = 100.0;
inline constexpr double kPlayerBaseDamage = 10.0;

/// Top speed in units per second.
inline constexpr double kPlayerMaxSpeed = 300.0;

/// Velocity friction per 1/20s of simulated time.
///
/// Movement converges to `target * (1/friction)` rather than snapping to it,
/// which is what gives the flower its weight -- it drifts a little when you
/// let go, and it takes a moment to reverse.
inline constexpr double kMoveFriction = 1.0 / 3.0;
inline constexpr double kFrictionReferenceRate = 20.0;

/// Cursor distance at which movement reaches full speed. Short, so a small
/// throw of the mouse is already a committed sprint; below it the speed eases
/// smoothly to zero for precise positioning, with no floor.
inline constexpr double kFullSpeedCursorDistance = 200.0;

inline constexpr double kRespawnInvulnerabilitySeconds = 3.0;

// -- progression -------------------------------------------------------------

inline constexpr double kBaseXpRequirement = 100.0;
inline constexpr double kXpGrowth = 1.08;
inline constexpr double kHealthPerLevel = 10.0;
inline constexpr double kDamagePerLevel = 1.0;
inline constexpr int kMaxLevel = 500;

/// XP needed to go from `level` to `level + 1`.
///
/// Rounded to a whole number so the curve is exact. Every XP award in the game
/// is an integer, and a fractional threshold means summing the thresholds and
/// subtracting them back does not land on the same value -- which shows up as
/// a player sitting on exactly enough XP being told they are a level short.
inline double xpForNextLevel(int level) {
    return std::floor(kBaseXpRequirement * std::pow(kXpGrowth, std::max(0, level - 1)));
}

/// The level a lifetime XP total buys, and the leftover XP into it.
struct LevelProgress {
    int level = 1;
    double xpIntoLevel = 0;
    double xpForNext = kBaseXpRequirement;
};

inline LevelProgress levelFromTotalXp(double totalXp) {
    LevelProgress out;
    double remaining = std::floor(std::max(0.0, totalXp));
    while (out.level < kMaxLevel) {
        const double need = xpForNextLevel(out.level);
        if (remaining < need) { out.xpForNext = need; break; }
        remaining -= need;
        ++out.level;
    }
    out.xpIntoLevel = remaining;
    if (out.level >= kMaxLevel) out.xpForNext = xpForNextLevel(kMaxLevel);
    return out;
}

inline double maxHealthForLevel(int level) {
    return kPlayerBaseHealth + kHealthPerLevel * (level - 1);
}

inline double bodyDamageForLevel(int level) {
    return kPlayerBaseDamage + kDamagePerLevel * (level - 1);
}

/// The flower grows slowly with level -- visible progress without letting a
/// high-level player's hitbox become a liability.
inline double playerRadiusForLevel(int level) {
    return kPlayerBaseRadius * (1.0 + 0.004 * (level - 1));
}

// ---------------------------------------------------------------------------
// Petals
// ---------------------------------------------------------------------------

inline constexpr int kLoadoutSlots = 8;

/// TypeScript's neutral petal orbit is 60 world units for a normal 20-unit
/// player hitbox. When the player grows, only the body's added radius grows
/// the orbit so the gap from its edge remains constant.
inline constexpr double kPetalOrbitRestRadius = 60.0;

/// TypeScript's fully extended and retracted petal-extension values. Attack
/// and defend use these as targets; damping below provides the transition.
inline constexpr double kPetalOrbitAttackExtension = 2.0;
inline constexpr double kPetalOrbitDefendExtension = 0.7;

/// How fast the ring converges on its target radius, as a fraction of the
/// remaining gap per second. Fast enough to feel instant, damped enough that
/// tapping attack does not teleport the petals.
inline constexpr double kPetalRadiusDamp = 0.999;

/// Ring spin, radians per second.
inline constexpr double kPetalSpinRate = 2.0;

/// Petal art radius and hit radius, as multiples of the flower's radius. The
/// hitbox is deliberately more generous than the art: petals are small and
/// fast, and matching the hitbox to the sprite makes them feel like they miss.
inline constexpr double kPetalDrawScale = 0.48;
inline constexpr double kPetalHitScale = 0.8;

/// A broken petal's slot reloads on the petal's own cooldown; this is the
/// fallback when a config omits one.
inline constexpr double kDefaultPetalReloadMillis = 10000.0;

/// Minimum gap between two hits from the same petal on the same victim, so a
/// petal resting against a mob does not deal its damage every single tick.
inline constexpr double kPetalHitIntervalMillis = 500.0;

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

/// Base radius a mob's config `size` multiplies.
inline constexpr double kMobBaseRadius = 20.0;

/// Contact damage cannot land more often than this on the same victim.
inline constexpr double kMobHitIntervalMillis = 500.0;

/// Simulation is skipped entirely beyond this distance from every player: a
/// mob nobody can see does not need to think, and this is what keeps a 60k
/// world affordable.
inline constexpr double kMobActiveRadius = 2400.0;

/// How far a mob wanders from its spawn anchor when it has no target.
inline constexpr double kMobWanderRadius = 400.0;

/// Aggro is dropped past this multiple of the mob's own aggro range, so a mob
/// does not chase a player across the map, and does not flicker at the edge.
inline constexpr double kAggroDropMultiplier = 1.6;

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

inline constexpr double kDropLifetimeSeconds = 45.0;
inline constexpr double kDropPickupRadius = 40.0;

/// Magnetism is a pickup RADIUS, not a force. Pulling the drop toward the
/// player looks better but means the item is consumed before any snapshot
/// carried it, so the client has nothing to animate.
inline constexpr double kBaseMagnetism = 0.0;

// ---------------------------------------------------------------------------
// Shared movement step
// ---------------------------------------------------------------------------

/// One tick of player physics, run identically by the server (authoritative)
/// and the client (prediction). Anything that changes here changes both.
///
/// `target` is the velocity the input asks for; the flower eases toward it
/// under friction rather than adopting it, which is what gives the movement
/// weight. `dt` is in seconds.
struct MoveState {
    Vec2 position;
    Vec2 velocity;
};

inline void integrateVelocity(MoveState& state, Vec2 target, double dt) {
    // Frame-rate independent: raising dt must not make the flower converge
    // sooner, or a 144Hz client would out-accelerate a 60Hz one.
    const double decay = std::pow(1.0 - kMoveFriction, dt * kFrictionReferenceRate);
    state.velocity = state.velocity * decay + target * (1.0 - decay);
}

/// Converts a cursor offset into the velocity the flower should approach.
/// Linear in distance up to kFullSpeedCursorDistance, then capped -- a short
/// throw is already full speed, and small jitters near the flower stay small.
inline Vec2 desiredVelocity(Vec2 cursorOffset, double maxSpeed) {
    const double distance = cursorOffset.length();
    if (distance < 1e-6) return {0, 0};
    const double speed = maxSpeed * std::min(1.0, distance / kFullSpeedCursorDistance);
    return cursorOffset * (speed / distance);
}

/// The same thing from a quantised input frame, which is what actually crosses
/// the wire: an angle plus a 0..1 strength.
inline Vec2 desiredVelocity(double moveAngle, double moveStrength, double maxSpeed) {
    if (moveStrength <= 0.0) return {0, 0};
    return Vec2::fromAngle(moveAngle, maxSpeed * clamp(moveStrength, 0.0, 1.0));
}

} // namespace flr
