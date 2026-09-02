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

/// The jagged outline a wall or water tile wears on every exposed side.
///
/// Here rather than in terrain.cpp because three places have to agree on it
/// exactly: the collision scan, the wall push-out, and the renderer that draws
/// the outline you can see. A tile's drawn silhouette and its hitbox are the
/// same curve, and these are its two parameters -- TypeScript's
/// JAGGED_MAX_OFFSET and JAGGED_NUM_SEGMENTS.
inline constexpr double kJaggedMaxProtrusion = 20.0;
inline constexpr int kJaggedSegmentCount = 7;

/// Slack folded into the tile-scan reach so a body already resting at the
/// push-out distance still registers as in contact. TypeScript's
/// COLLISION_BUFFER. It is NOT added to the collision shape: a body collides
/// with a wall as a disc of exactly its own radius.
inline constexpr double kCollisionScanBuffer = 5.0;

enum class Tile : std::uint8_t {
    Ground = 0,
    Wall = 1,     ///< blocks movement
    Water = 2,    ///< passable, slows movement
    Sand = 3,     ///< TypeScript custom tile 3: bridge (passable)
    Stone = 4,    ///< TypeScript custom tile 4: sewage (solid)
    Block = 5,    ///< TypeScript custom tile 5: block (solid)
};

inline constexpr bool tileBlocks(Tile t) {
    // The TypeScript collision predicate is `solid || water`. Water is drawn
    // differently, but it is not walkable by players, mobs, projectiles, line
    // of sight, or spawn placement.
    return t == Tile::Wall || t == Tile::Water || t == Tile::Stone || t == Tile::Block;
}
inline constexpr bool tileIsWater(Tile t) { return t == Tile::Water; }

/// Multiplier applied to top speed while in water. Slow enough to matter,
/// fast enough that crossing a river is not a punishment.
inline constexpr double kWaterSpeedScale = 0.55;

/// The outermost band of the map is off limits to spawning. Mobs placed there
/// end up half inside the boundary wall, so the reference rejects the point
/// outright rather than nudging it (src/server/shared/positions.ts:22).
inline constexpr double kWorldBoundaryThreshold = 100.0;

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------
//
// The reference's nominal client viewport. It is a GAMEPLAY number, not just a
// render one: spawn density, the unseen-despawn keep-alive box and the AI's
// level-of-detail radius are all expressed in multiples of it. A client that
// reports its own viewport uses that instead; these are the fallbacks.

inline constexpr double kViewportWidth = 1920.0;
inline constexpr double kViewportHeight = 1080.0;

/// Extra margin around a viewport before an entity stops counting as "seen".
inline constexpr double kViewportBuffer = 500.0;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

inline constexpr double kPlayerBaseRadius = 20.0;
inline constexpr double kPlayerBaseHealth = 100.0;
inline constexpr double kPlayerBaseDamage = 5.0;

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

/// How far a mob's touch shoves the flower. The same 25 units is used by the
/// glitch flower's petal ring, which is why it is not a mob-only constant.
inline constexpr double kPlayerKnockbackForce = 25.0;

// -- teleporters -------------------------------------------------------------
//
// A pad is not a trigger volume you cross; it is a well you fall into. The
// suction reaches much further than the pad itself and is deliberately strong
// enough to beat a mob's 25-unit shove, so a player being knocked around on
// top of a pad still goes through.

inline constexpr double kTeleporterRadius = 60.0;
inline constexpr double kTeleporterSuctionRadius = 150.0;
inline constexpr double kTeleporterSuctionForce = 400.0;
inline constexpr double kTeleporterDwellMillis = 1000.0;
inline constexpr double kTeleporterCooldownMillis = 5000.0;

/// How much of the remaining impulse survives a bounce off a wall. Used by the
/// bubble dash, which walks its displacement in substeps and reflects.
inline constexpr double kBounceDamping = 0.7;

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
    const double l = static_cast<double>(std::max(1, level));
    return kPlayerBaseHealth + std::ceil(std::pow(l, 1.5) * kHealthPerLevel);
}

inline double bodyDamageForLevel(int level) {
    const double l = static_cast<double>(std::max(1, level));
    return kPlayerBaseDamage + std::ceil(std::pow(l, 1.5) * kDamagePerLevel);
}

/// Level changes health and body damage, not collision size. Only equipped
/// playerRadius modifiers grow the TypeScript flower.
inline double playerRadiusForLevel(int) {
    return kPlayerBaseRadius;
}

// -- leaderboard rewards -----------------------------------------------------
//
// The top accounts trade XP for loot. Membership is POSITIONAL -- the first ten
// and first twenty non-admin accounts by lifetime XP, with no minimum -- so on
// a small server everybody is "top ten" and everybody is on the reduced rate.
// The ranking is cached rather than recomputed per kill.

inline constexpr double kTopTenXpMultiplier = 0.5;
inline constexpr double kTopTenDropMultiplier = 1.2;
inline constexpr double kTopTwentyXpMultiplier = 0.75;
inline constexpr double kTopTwentyDropMultiplier = 1.1;
inline constexpr double kTopRankCacheMillis = 15000.0;

// ---------------------------------------------------------------------------
// Petals
// ---------------------------------------------------------------------------

/// Loadout slots an account holds and the wire carries. Twenty, matching the
/// browser build, which pads every profile's loadout to that width.
inline constexpr int kLoadoutSlots = 20;

/// How many of those slots are ACTUALLY equipped -- the ring, the modifiers,
/// the passive heals. The rest is storage a player carries and swaps from.
/// The browser draws the same two rows and stops every gameplay loop at ten
/// (`PRIMARY_LOADOUT_SLOTS`, src/server/shared/playerModifiers.ts:36); a ring
/// built from all twenty would give a second row of petals for free.
inline constexpr int kLoadoutActiveSlots = 10;

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

/// Gap between two hits from the same petal when its config does not declare a
/// `damageCooldown`.
///
/// Zero, because the reference throttles only the three petals that name one
/// (glass, glasss, infinity); every other petal in src/petals.json damages
/// every mob it overlaps on every tick and pays for it out of its own instance
/// health (src/server/playerState.ts:2730-2767). A non-zero default here is
/// worth roughly fifteen sixteenths of the whole ring's DPS.
///
/// A petal that DOES declare one is throttled per INSTANCE, not per victim --
/// see HitCooldowns::armGlobal.
inline constexpr double kPetalHitIntervalMillis = 0.0;

// -- ring physics ------------------------------------------------------------
//
// A petal is not pinned to its orbit point; it is sprung toward it. That is
// what makes the ring trail a sprinting flower, overshoot when the ring
// extends, and settle rather than snap. Values are src/ecs/systems/petalRing.ts.

inline constexpr double kPetalSpringForce = 600.0;
inline constexpr double kPetalDamping = 0.72;
inline constexpr double kPetalSpringSubstepSeconds = 0.05;
inline constexpr int kPetalSpringMaxSubsteps = 4;

/// A petal that has just appeared starts AT the flower and flies out over this
/// window; one that loses the mob it was orbiting because the mob DIED (rather
/// than moved away) glides for the shorter one instead of being snapped back.
inline constexpr double kPetalSpawnGlideMillis = 300.0;
inline constexpr double kPetalReleaseGlideMillis = 250.0;
/// Rate of the first-order approach used during either glide, per second.
inline constexpr double kPetalGlideRate = 14.0;
/// The spring force ramps in over this window after a petal appears, so a
/// fresh petal does not get slingshotted onto the ring.
inline constexpr double kPetalSpawnSmoothMillis = 300.0;

// -- attraction --------------------------------------------------------------
//
// Every player attracts petals, not just the ones carrying lentil: the base
// radius is 30 (PlayerModifiers::petalAttractionRadius) and lentil raises it.
// A petal inside that radius of a mob stops orbiting the flower and whips
// around the mob's edge instead.

/// Where on the mob the captured petal orbits, as a fraction of mob radius.
inline constexpr double kMobOrbitRadiusScale = 0.85;
/// Extra angular kick while orbiting a mob, so the ring visibly grinds.
inline constexpr double kMobOrbitSpinBoost = 2.0;

// -- raindrop aura -----------------------------------------------------------
//
// Raindrop is not an orbiting petal that happens to hurt: it projects a damage
// field centred on the FLOWER. Damage and radius are maximised independently
// across every equipped, off-cooldown raindrop.

inline constexpr double kRaindropAuraBaseRadius = 180.0;
inline constexpr double kRaindropAuraRadiusPerRarity = 18.0;
inline constexpr double kRaindropAuraDamageIntervalMillis = 500.0;

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

/// Base radius a mob's config `size` multiplies.
inline constexpr double kMobBaseRadius = 20.0;

/// Contact damage cannot land more often than this on the same victim.
inline constexpr double kMobHitIntervalMillis = 500.0;

/// Mobs within this distance of a player think every tick. Set well beyond the
/// furthest thing the broadcast will ever carry, so a mob's brain is never off
/// while a client can see it.
inline constexpr double kMobActiveRadius = 5000.0;

/// Beyond kMobActiveRadius a mob is not frozen -- it decides once every this
/// many ticks, offset by its own index so the far world does not decide in
/// lockstep. Freezing instead leaves the far map to drain into wall lines.
inline constexpr int kMobFarStride = 5;

/// Aggro RANGE decides acquisition; this decides retention. Once a mob has a
/// target it pursues for five viewports, and drops it only on distance or on
/// losing line of sight -- not on the acquisition range it started from.
inline constexpr double kMobTargetRetainRadius = kViewportWidth * 5.0;

/// Aggro range for a mob whose config declares none.
inline constexpr double kEnemyChaseRange = 500.0;

/// How far a mob wanders from its spawn anchor when it has no target.
inline constexpr double kMobWanderRadius = 400.0;

/// Aggro is dropped past this multiple of the mob's own aggro range, so a mob
/// does not chase a player across the map, and does not flicker at the edge.
inline constexpr double kAggroDropMultiplier = 1.6;

/// Slack added to the sum of two mobs' radii before they count as touching.
/// Used both by the push-apart separation pass and by pet/wild contact, so a
/// pet fights something it is merely brushing.
inline constexpr double kMobCollisionBuffer = 5.0;

/// Separation is a Jacobi solve: every overlapping pair contributes a push,
/// each pair contributes at most kMobSeparationMaxPushPerPair, and a single
/// mob's accumulated push is capped at the headroom multiple of that. Without
/// the cap a mob deep in a pile is fired across the map in one tick.
inline constexpr double kMobSeparationMaxPushPerPair = 10.0;
inline constexpr double kMobSeparationPushHeadroom = 3.0;

/// Knockback a projectile deals to a mob. A flat force divided by the victim's
/// mass, deliberately independent of the firing petal's own knockback stat.
inline constexpr double kMobKnockbackForce = 20.0;

/// A centipede is a head plus this many trailing body mobs. The count is a
/// constant in the reference rather than a per-mob config field.
inline constexpr int kCentipedeSegmentCount = 9;

// -- mob-carried petal rings -------------------------------------------------
//
// A glitch flower spins five petals around itself. The ring is not made of
// entities: it is a BAND test around the orbit circle, expressed in multiples
// of the mob's own radius so it scales with rarity exactly as the body does.

inline constexpr double kMobPetalRingOrbitScale = 2.4;
inline constexpr double kMobPetalRingHitScale = 0.5;

/// Roughly the interval at which a five-petal ring sweeps past a fixed point,
/// so standing in one costs about what being swept by each petal would.
inline constexpr double kMobPetalRingHitIntervalMillis = 600.0;

// -- pets --------------------------------------------------------------------
//
// A summoned mob keeps its config's own behaviour -- a passive pet stays
// passive, a sandstorm still drifts -- rather than being forced to fight. What
// it gains is an owner: it follows, it teleports back when a wall breaks line
// of sight, and passive/sandstorm pets that leave the owner's screen are
// retired so their egg can hatch a fresh one.

/// Ring distance a pet is placed at when it teleports back to its owner.
inline constexpr double kPetTeleportDistance = 80.0;

/// A sandstorm pet shadows its owner's velocity slightly faster than the owner
/// moves, which is precisely why it keeps running off-screen and recycling.
inline constexpr double kSandstormPetSpeedFactor = 1.2;

/// Extra chase range per rarity tier a summon is spawned at.
inline constexpr double kPetAggroRangePerRarity = 200.0;

/// Hard ceiling on one player's live summons. A backstop rather than a balance
/// rule: stacked squads once made the tick quadratic.
inline constexpr int kMaxPetsPerPlayer = 50;

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

inline constexpr double kDropPickupRadius = 40.0;

/// Half-size a loose drop is resolved against terrain with. Deliberately a
/// little larger than the drop's own collision body: a drop is scattered up to
/// 50 units from the corpse with no wall test at all, and this per-tick push is
/// the only thing that gets one back out of a rock.
inline constexpr double kDroppedItemRadius = 15.0;

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
