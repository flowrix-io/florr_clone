#pragma once
// Gameplay constants, and the movement step the server integrates flowers
// with.
//
// Anything here that both sides need is here precisely so there is one copy:
// the client draws with the same sizes, radii and ladders the server simulates
// with. The movement step at the bottom is the server's alone -- the client
// predicts nothing and eases every flower straight from the wire
// (client/interpolation.h) -- and it lives here beside the constants it is
// built from.

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include "shared/core/types.h"
#include "shared/net/protocol.h"

namespace flix {

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/// The DEFAULT world: how big a Terrain is before any map is loaded. Not a law
/// -- every world realm carries its own dimensions (terrain.h) and a map is
/// whatever shape its file says. What this still pins down is the section grid
/// below, which is a palette rather than a geography.
inline constexpr double kWorldSize = 60000.0;
inline constexpr double kWorldHalf = kWorldSize * 0.5;

/// The default world is a 3x3 grid of biome sections, each 20000 units
/// square: the legacy procedural world's palette, which the maze still borrows
/// its ground colour from, and the grid /biome and the boss announcements
/// still count the overworld by. What spawns where is a mob group's business
/// (config.h); a `section` list left in mobs.json is ignored with a warning.
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

/// Terrain is a tile grid: one coarse Tile byte per cell, open or solid (what
/// the flow field walks, the minimap falls back to and the wire carries), with
/// each cell's authored collision SHAPES beside it for the exact tests
/// (terrain.h).
inline constexpr double kTileSize = 256.0;
inline constexpr int kTilesPerAxis = static_cast<int>(kWorldSize / kTileSize);  // 234

/// The widest a map may be, per axis.
///
/// A cap, not a size: maps are authored at whatever dimensions suit them, and
/// this only bounds what the engine will hold. It is what the DDA's step limit
/// is sized from and what stops a corrupt header asking for a terabyte of
/// grid. 512 tiles is 131072 world units on a side, four times the shipped
/// map; the grid behind it is a quarter of a megabyte, and it is run-length
/// encoded before it ever goes on the wire.
inline constexpr int kMaxTilesPerAxis = 512;

/// Slack folded into the cell-scan reach so a body already resting at the
/// push-out distance still registers as in contact. TypeScript's
/// COLLISION_BUFFER. It is NOT added to the collision shape: a body collides
/// with a wall as a disc of exactly its own radius against the SHAPES the
/// author drew on that cell's tile (shared/game/tiled_map.h) -- or, for a cell
/// whose tile carries none, against its flat 256-unit rectangle.
inline constexpr double kCollisionScanBuffer = 5.0;

/// One coarse cell: open, or holding a blocking shape somewhere in it. That is
/// all the coarse grid says. What KIND of blocker a shape is -- water, which
/// slows and is painted blue -- belongs to the authored shape (the tileset's
/// `water` tag, tiled_map.h), never to the cell.
enum class Tile : std::uint8_t {
    Open = 0,
    Solid = 1,
};

inline constexpr bool tileBlocks(Tile t) { return t == Tile::Solid; }

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

/// florr's flower radius, and the radius the flower art is drawn at.
inline constexpr double kPlayerBaseRadius = 25.0;
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

// -- teleporters -------------------------------------------------------------
//
// A pad is not a trigger volume you cross; it is a well you fall into. The
// suction reaches much further than the pad itself and is deliberately strong
// enough to beat a mob's 25-unit shove, so a player being knocked around on
// top of a pad still goes through.

/// The size of a pad that does not give one: florr's default warp radius,
/// which is what its portal is drawn at. A pad's own `radius` scales the two
/// reaches below by radius / this, so a pad drawn twice as big pulls and
/// takes a flower from twice as far.
inline constexpr double kTeleporterArtRadius = 100.0;
inline constexpr double kTeleporterRadius = 60.0;
inline constexpr double kTeleporterSuctionRadius = 150.0;
inline constexpr double kTeleporterSuctionForce = 400.0;
inline constexpr double kTeleporterDwellMillis = 1000.0;
inline constexpr double kTeleporterCooldownMillis = 5000.0;

// -- progression -------------------------------------------------------------

inline constexpr double kBaseXpRequirement = 15.0;
inline constexpr double kXpGrowth = 1.08;
inline constexpr double kLevelOneHealth = 110.0;
inline constexpr int kHealthAnchorLevel = 130;
inline constexpr double kHealthAtAnchorLevel = 30000.0;
inline constexpr double kDamagePerLevel = 1.0;

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

/// There is no level cap. The walk ends because the total is held finite: a
/// NaN reads as nothing and an infinite total as the largest double, and the
/// threshold outgrows any finite total -- it overflows to infinity at level
/// 9,189 -- so the top level a double can buy is in the low 9,100s, well
/// inside the u16 every level travels in.
inline LevelProgress levelFromTotalXp(double totalXp) {
    LevelProgress out;
    double remaining =
        std::floor(std::min(std::max(0.0, totalXp), std::numeric_limits<double>::max()));
    for (;;) {
        const double need = xpForNextLevel(out.level);
        if (remaining < need) { out.xpForNext = need; break; }
        remaining -= need;
        ++out.level;
    }
    out.xpIntoLevel = remaining;
    return out;
}

/// Linear: a level-1 flower keeps its 110, and the line runs through
/// kHealthAtAnchorLevel at kHealthAnchorLevel, carrying on at the same slope
/// past it. Rounded so a pool is always a whole number.
inline double maxHealthForLevel(int level) {
    const double l = static_cast<double>(std::max(1, level));
    const double perLevel = (kHealthAtAnchorLevel - kLevelOneHealth) /
                            static_cast<double>(kHealthAnchorLevel - 1);
    return std::round(kLevelOneHealth + (l - 1.0) * perLevel);
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

/// The ceiling on a flower's summed size modifier. Past about six times its
/// own size the wall resolver cannot contain the body (see the containment
/// guard in server/systems/movement.cpp), so the server clamps the loadout's
/// size scale here, in PetalSystem's stat pass, as the TypeScript server did;
/// and the client bounds what it draws by the same figure, so a corrupt radius
/// cannot scale a flower off the screen.
inline constexpr double kMaxPlayerSizeScale = 6.0;

// ---------------------------------------------------------------------------
// Petals
// ---------------------------------------------------------------------------

/// Loadout slots an account holds and the wire carries. Twenty, matching the
/// TypeScript build, which padded every profile's loadout to that width.
inline constexpr int kLoadoutSlots = 20;

/// How many of those slots are ACTUALLY equipped -- the ring, the modifiers,
/// the passive heals. The rest is storage a player carries and swaps from.
/// The TypeScript build drew the same two rows and stopped every gameplay loop
/// at ten (`PRIMARY_LOADOUT_SLOTS`, src/server/shared/playerModifiers.ts:36); a
/// ring built from all twenty would give a second row of petals for free.
inline constexpr int kLoadoutActiveSlots = 10;

/// The most of one petal at one tier an account can hold: a stack is an
/// `int` on every path it takes, and the wire carries it in a u32. Anything
/// added past this is dropped rather than wrapped -- a wrapped stack goes
/// negative, and a negative stack is erased as empty.
inline constexpr int kMaxStackCount = 2147483647;

/// Saved loadouts: two banks, K and L, of ten each, one per number key. A
/// preset is numbered `bank * kLoadoutPresetsPerBank + column`, where column
/// is the number key's place on the bar -- 1 is column 0, 0 is column 9.
inline constexpr int kLoadoutPresetBanks = 2;
inline constexpr int kLoadoutPresetsPerBank = 10;
inline constexpr int kLoadoutPresetCount = kLoadoutPresetBanks * kLoadoutPresetsPerBank;

/// What a preset is called: the two keys that load it, "K1" to "K0" and "L1"
/// to "L0". Also the key it is stored under in the account record, so this
/// spelling is load-bearing -- changing it orphans every saved preset.
inline std::string loadoutPresetName(int preset) {
    if (preset < 0 || preset >= kLoadoutPresetCount) return std::string();
    static constexpr char kBanks[kLoadoutPresetBanks] = {'K', 'L'};
    const int column = preset % kLoadoutPresetsPerBank;
    std::string name(1, kBanks[preset / kLoadoutPresetsPerBank]);
    name += static_cast<char>(column == kLoadoutPresetsPerBank - 1 ? '0' : '1' + column);
    return name;
}

/// The preset a loadoutPresetName names, or -1 for anything else.
inline int loadoutPresetIndex(const std::string& name) {
    for (int preset = 0; preset < kLoadoutPresetCount; ++preset) {
        if (loadoutPresetName(preset) == name) return preset;
    }
    return -1;
}

/// gardn's three ring states, as the gap between the flower's EDGE and the
/// orbit its petals are carried round on (Server/Process/Flower.cc):
/// `player.radius + 40` at rest, `+ 100` while attacking and `+ 15` while
/// defending -- 65, 125 and 40 from the centre of a new flower. Measured from
/// the edge, so a grown flower keeps the same clearance.
///
/// Attack wins when both buttons are down, and a defendOnly petal stays at
/// rest while attacking, both as gardn has them. The ring takes the state the
/// buttons ask for at once; the petal step (kPetalFriction) carries each petal
/// out or in.
inline constexpr double kPetalOrbitRestGap = 40.0;
inline constexpr double kPetalOrbitAttackGap = 100.0;
inline constexpr double kPetalOrbitDefendGap = 15.0;

/// How fast a clump's grains turn round its centre, as a share of the ring's
/// own spin: gardn lays grain j of n at `2 pi j / n + heading * 0.2`
/// (Flower.cc), a bearing in the WORLD shared by every clump on the ring
/// rather than one measured from each clump's place on it. Oranges keep their
/// own hang off the ring (clumpOutsideRing), which gardn has no petal for.
inline constexpr double kPetalClumpSpinShare = 0.2;

/// Ring spin, radians per second.
inline constexpr double kPetalSpinRate = 2.5;

/// The wing's "it comes and goes": while the flower is ATTACKING, a wing is
/// carried this much further out than the rest of the ring, on a sine that is
/// squared -- so it sits home for most of the cycle and lunges, rather than
/// gliding in and out evenly. gardn's figure is a flat 120 (Flower.cc, the
/// `PetalID::kWing` branch of the attack range), which is exactly one fully
/// extended ring, so a wing at the crest reaches twice as far as its
/// neighbours and is back among them two thirds of a second later.
///
/// Not on the rarity ladder and not scaled by the Range talent, for the same
/// reason gardn does not scale it: the lunge is the petal's identity, not its
/// power. Only the flat `+100` under it grows with `extra_range`.
inline constexpr double kWingOrbitLungeReach = 120.0;

/// Radians per second of that sine, before squaring. gardn writes it as
/// `sinf(lifetime / (0.4 * SIM_RATE))` over a 20Hz tick, which is 2.5 rad/s;
/// squaring halves the period, so one out-and-back takes pi / 2.5 = 1.26s.
/// Measured from the petal's OWN spawn, so a wing that broke and reloaded
/// starts its cycle at home rather than mid-lunge.
inline constexpr double kWingOrbitLungeRate = 2.5;

/// The pearl's throw. When the ring extends past its rest radius, a pearl is
/// shot straight out off it and left on the ground: it slides to a stop and
/// stays where it came to rest in the WORLD, not on the flower, for as long as
/// the ring stays extended. It rejoins the ring the moment the ring's
/// extension comes back down to rest -- whatever buttons did that.
///
/// Launched at `kPearlLaunchSpeed` along its bearing from the flower, and
/// slowed by ground friction that takes `kPearlGroundFriction` of its speed
/// off per second, exponentially -- so it slides `speed / friction` = 180
/// units and a stock flower's pearl settles about 240 out from the flower.
///
/// `kPearlMaxDistance` is the leash, measured from the flower's centre at a
/// stock body and grown by whatever the body has grown, as the ring's rest
/// radius is. A pearl the flower walks away from is dragged along at that
/// distance rather than left behind; one inside it is not touched.
///
/// None of these is on the rarity ladder or scaled by the Range talent, for
/// the reason the wing's lunge is not: the throw is the petal's identity.
inline constexpr double kPearlLaunchSpeed = 900.0;
inline constexpr double kPearlGroundFriction = 5.0;
inline constexpr double kPearlMaxDistance = 1000.0;
/// How long a recalled pearl takes the glide home instead of the spring. It is
/// coming back from as far as the crest, and the spring across a gap that wide
/// reads as the petal teleporting.
inline constexpr double kPearlRecallGlideMillis = 300.0;

/// Wax and the moon: the LOOSE petals (see petalIsLooseBody in config.h). Each
/// is 30 units in radius at common and every tier adds another 30, so an apex
/// one is 300 -- the only petals whose bodies grow with their rarity.
inline constexpr double kLoosePetalRadiusPerTier = 30.0;

/// How far behind the flower's heading a loose petal is put down, past the
/// flower's edge and its own. Behind rather than ahead, so a flower on the
/// move is never stopped dead by the slab it just laid, and a fleeing one
/// leaves it between itself and whatever is chasing it.
inline constexpr double kLoosePetalSpawnGap = 10.0;

/// What a loose petal weighs when something shoves it: a quarter of a flower,
/// at every tier. A shove is split by mass, so a flower pushes one at 80% of
/// its walking speed however big the slab has grown -- the user's call: wax is
/// meant to be pushed around, and one that grew heavier with its size (gardn's
/// `1 + radius / flower radius` put an apex slab at 16 flowers) was a wall.
inline constexpr double kLoosePetalMass = 0.25;

/// A claw's bonus lands while its victim is still ABOVE this fraction of its
/// health: an opening strike, not a finisher.
inline constexpr double kClawCritHealthFraction = 0.8;

/// A broken petal's slot reloads on the petal's own cooldown; this is the
/// fallback when a config omits one.
inline constexpr double kDefaultPetalReloadMillis = 10000.0;

/// Gap between two hits from the same petal when its config does not declare a
/// `damageCooldown`.
///
/// Zero, because the reference throttles only the three petals that name one
/// (glass, glasss, infinity); every other petal in data/petals.json damages
/// every mob it overlaps on every tick and pays for it out of its own instance
/// health (src/server/playerState.ts:2730-2767). A non-zero default here is
/// worth roughly fifteen sixteenths of the whole ring's DPS.
///
/// A petal that DOES declare one is throttled per INSTANCE, not per victim --
/// see HitCooldowns::armGlobal.
inline constexpr double kPetalHitIntervalMillis = 0.0;

// -- ring physics ------------------------------------------------------------
//
// gardn's petal movement, and nothing else (the user's call): every tick a
// petal's velocity loses a share to friction and gains a pull toward where it
// should be, and the petal moves by its velocity. gardn writes it, per 20 Hz
// tick (Server/Process/Flower.cc sets the acceleration, Motion.cc applies it
// against the petal's friction of DEFAULT_FRICTION * 1.5), as
//
//     velocity *= 1 - 0.5
//     velocity += 0.5 * (target - position)
//     position += velocity
//
// That one step is what makes the ring trail a running flower, overshoot when
// it extends or a petal spawns, and settle. There is no ramp on the ring's
// extension, no glide on the way out of the flower and no ease on its centre:
// each of those is a second force, and stacked on the step they read as forces
// fighting over the petal.
//
// The figures below are gardn's restated for this server's 30 Hz tick so the
// motion is the same second for second: the friction is 0.5^(20/30), the same
// decay per second, and the pull is the one that keeps the swing's frequency.
// Every fifth of a second the two land on the same spot
// (petal_tests: the_ring_step_moves_a_petal_as_gardns_does), and a flower
// running flat out leaves its ring about 15 units behind, as gardn's does.

/// The share of a petal's velocity it keeps from one tick to the next.
/// gardn's 1 - 0.5 per 20 Hz tick.
inline constexpr double kPetalFriction = 0.629961;
/// The share of the gap to its target added to a petal's per-tick velocity.
/// gardn's 0.5 per 20 Hz tick.
inline constexpr double kPetalPull = 0.255231;
/// What a homing petal -- rose, shell, orb -- is pushed toward its flower by,
/// in units per tick per tick, in place of the pull: gardn's burst heal and
/// shield set the acceleration to a flat `PLAYER_ACCELERATION * 4` toward the
/// flower (Petal.cc), which against the same friction tops out at 800 units a
/// second. Restated for our tick to keep that top speed and that friction.
inline constexpr double kPetalHomingPush = 9.867719;

/// Rate of the first-order approach the two scripted flights still use -- a
/// pearl recalled from the ground, and the ring changing hands to or from a
/// moon -- per second. Neither is ring movement: both carry a petal across a
/// gap a leash or a moon wide, which the step would cross in one lunge.
inline constexpr double kPetalGlideRate = 14.0;

/// How long a homing petal -- rose, shell, orb -- gets to reach the flower
/// before its burst is delivered without the touch.
///
/// The dive is what spends the petal, and a dive that never lands is a petal
/// that never heals and a slot that never reloads. On open ground it lands:
/// the push outruns a running flower almost threefold. But a wall
/// the petal is pushed back out of can hold it off for as long as the flower
/// stands behind it, so the burst is delivered anyway once the dive has had
/// this long -- long enough that a dive which would have arrived is never paid
/// out early, short enough that the heal still arrives while it matters.
inline constexpr double kPetalHomingTimeoutMillis = 1000.0;

// -- attraction --------------------------------------------------------------
//
// Every player attracts petals, not just the ones carrying lentil: the base
// radius is 30 (PlayerModifiers::petalAttractionRadius) and lentil raises it.
//
// A mob whose edge comes within that radius of a petal's place on the ring
// takes the petal (the user's call: "orbit the mob"). The petal's target
// becomes a point on the mob's edge that circles it as fast as the ring
// carries the petal, so gardn's step brings it in on a spiral and round the
// mob, grazing it all the way, until its place on the ring is out of reach
// again or the mob dies. A petal stays with its mob while that mob is in
// reach; a free one goes to the nearest.
//
// The circle runs AGAINST the ring's turn, as a gear meshes: the near side of
// the mob then runs the way the ring does, so the petal carries straight on
// into its circle and leaves it running with its ring point. Turning with the
// ring sent it back the way it came on contact and round to the far side of
// a big mob, from where it was flung back across the body at four times the
// jolt.
//
// No force of its own: it is the ring's step aimed somewhere else, so it is
// as smooth as the ring. It replaced a force toward the edge, which landed a
// petal in a zig-zag of bounces and could only hold it, never carry it round.

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

/// A projectile's radius per unit of the FIRING petal's `size`, before the
/// shooter's own scaling.
///
/// Stated against `size` and not against the petal's radius, exactly as the
/// reference states it (`spawnProjectile` stores `size * 20 / 2`): a shot is
/// its own body, and it must not move when the petal that fires it changes
/// size. Deriving it from the petal's radius is what silently halved every
/// volley when the petal body was brought down to its drawn size.
inline constexpr double kProjectileRadiusPerSize = 10.0;

/// Base radius a mob's config `size` multiplies.
inline constexpr double kMobBaseRadius = 20.0;

/// gardn's BASE_FLOWER_RADIUS, the yardstick it weighs every body by: a
/// flower's mass is 1 and anything else's `1 + radius / this`
/// (Server/Spawn.cc). Linear in the radius, not in the area -- an area scale
/// put an ultra mob at 225 flowers and an apex at nearly two thousand, so
/// knockback and shot pushes stopped moving anything past epic, where gardn's
/// ultra still weighs 13.
inline constexpr double kMassReferenceRadius = 25.0;

/// What gardn multiplies a mob that never moves by (`stationary`): a nest, a
/// rock, a cactus is in effect immovable whatever bumps into it.
inline constexpr double kAnchoredMassScale = 10000.0;

/// gardn's mass for a body of this radius. See kMassReferenceRadius.
inline double bodyMassForRadius(double radius) {
    return 1.0 + std::max(0.0, radius) / kMassReferenceRadius;
}

/// The shooter's rarity also scales the shot's SIZE, on its own divisor --
/// reach and size deliberately grow at different rates.
inline constexpr double kProjectileSizeDivisor = 3.0;

/// Volley cadence for a mob whose config states no cooldown.
inline constexpr double kDefaultVolleyCooldownMillis = 2000.0;

/// How much bigger than a stock body a shooter is, for sizing its shots: its
/// body radius over kMobBaseRadius, so it carries both the rarity step and the
/// mob's own authored `size`.
inline double mobShotOwnerScale(double shooterRadius) {
    return std::max(0.05, shooterRadius / kMobBaseRadius);
}

/// The radius of a shot a mob fires, from its ammunition petal's `size` stat
/// (graded at the shooter's tier) and mobShotOwnerScale().
///
/// Shared because both sides need the SAME number: the server fires the shot
/// at it, and the client draws a stinger mob's LOADED missile on its tail at
/// it, so the sting the player watches leave is the missile that arrives.
inline double mobShotRadius(double ammoSize, double ownerScale) {
    return std::max(1.0, ammoSize * kProjectileRadiusPerSize * ownerScale / kProjectileSizeDivisor);
}

/// How far out of a stinger shooter's tail its shot leaves, centre to centre:
/// the shot's body just clear of the shooter's. Shared for the same reason as
/// mobShotRadius() -- the client draws the LOADED missile exactly here, so the
/// shot appears where the sting was.
inline double stingerMuzzleDistance(double shooterRadius, double shotRadius) {
    return shooterRadius + shotRadius;
}

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

/// The furthest any mob holds a target, and so the furthest any acquires one.
/// A neutral mob keeps what provoked it out to here (gardn has no lose clause
/// for neutrals; its culling is what ends their chase); a hostile one lets go
/// much sooner, at kMobTargetLeashScale.
inline constexpr double kMobTargetRetainRadius = kViewportWidth * 5.0;

/// A hostile mob drops its target past this multiple of the range it noticed
/// it from -- gardn's `1.5 * aggro_radius` in _focus_lose_clause.
inline constexpr double kMobTargetLeashScale = 1.5;

/// ...or once a wall has hidden it this long without a break. gardn counts six
/// blocked sight checks a quarter second apart (AGGRO_LOS_GRACE_CHECKS).
inline constexpr double kMobSightGraceMillis = 1500.0;

/// Aggro range for a mob whose config declares none.
inline constexpr double kEnemyChaseRange = 500.0;

/// How far a mob wanders from its spawn anchor when it has no target.
inline constexpr double kMobWanderRadius = 400.0;

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

/// A loose petal is SOFT, the way two mobs leaning on each other are: a body
/// pressed into one is eased back out by this fraction of the overlap per
/// tick rather than snapped flush against it -- the half the separation pass
/// above takes -- and never by more in a tick than a pair of mobs is ever
/// separated by. So a flower pushing one at full speed sinks in about 10
/// units and settles there, and once it lets go the overlap halves every tick.
inline constexpr double kLoosePetalContactStiffness = 0.5;
inline constexpr double kLoosePetalMaxPushPerTick = 2.0 * kMobSeparationMaxPushPerPair;

/// How much of an `overlap` one tick of soft contact takes back.
inline constexpr double loosePetalContactPush(double overlap) {
    const double push = overlap * kLoosePetalContactStiffness;
    return push < kLoosePetalMaxPushPerTick ? push : kLoosePetalMaxPushPerTick;
}

// -- projectiles as bodies (the arras.io model) ------------------------------
//
// A shot is not a hitscan token that vanishes into the first thing it touches.
// It is a small body with its own mass, its own health pool and its own
// momentum, and every rule below follows from that:
//
//   * it PENETRATES -- a hit costs it the victim's body damage, and it only
//     dies once that pool is spent, so a fat shot punches through a line of
//     weak mobs and a thin one is eaten by the first thing it meets;
//   * it can be SHOT DOWN -- two shots from opposing sides trade body damage
//     the same way, which is the whole of the bullet-vs-bullet rule;
//   * it carries the shooter's MOMENTUM, so a volley fired while running is
//     thrown forward and one fired backwards is left behind;
//   * it SHOVES what it hits by transferring that momentum, and the shooter
//     pays a little of it back as recoil.
//
// The one deliberate departure: a shot that lands on a FLOWER is spent whole.
// Flowers have no body damage to charge a shot with, and post-hit
// invulnerability means a surviving shot would sit inside the victim doing
// nothing until its range ran out.

/// Health a shot is born with when its ammunition declares no pool at all --
/// an unbreakable petal. One means "consumed by the first thing it hits",
/// which is what such a shot did before it had a health pool.
inline constexpr double kProjectileDefaultHealth = 1.0;

/// What a hit costs a shot when the victim deals no body damage of its own.
inline constexpr double kProjectileDefaultBodyDamage = 1.0;

/// Momentum (mass x speed) to displacement, before the victim's mass divides
/// it. Chosen so a stock size-1 shot at 300 u/s lands within a few units of
/// the flat 20 the reference stamps on a mob: the shove stays where it has
/// always been for ordinary ammunition, and only grows when the shot itself
/// does. 0.27 against the old area-scale shot mass of 1; a stock 20-unit shot
/// weighs 1.8 on gardn's scale, so the figure is divided by that to keep the
/// same push.
inline constexpr double kProjectilePushPerMomentum = 0.27 / 1.8;

/// Ceiling on that shove. A heavy shot from an apex is still a push, not a
/// teleport, and this is what stops one landing on a common mob from firing it
/// clean off the screen.
inline constexpr double kProjectileMaxPush = 40.0;

/// Recoil as a fraction of the reaction a shot's momentum actually implies,
/// and its own ceiling.
///
/// One is the honest equal-and-opposite figure, and it is deliberately left
/// there: because a shot's mass and its shooter's both go as size squared, the
/// two cancel and the kick comes out at the same couple of units at EVERY
/// tier. That is what makes this a nudge rather than diep.io's reverse
/// thruster -- an apex rocks back exactly as far as a common, which is a twitch
/// on a body that size. Turn this down, not the cap, if it ever reads as too
/// much.
///
/// It is also MOBS ONLY: a flower's movement is eased straight from the wire
/// with no prediction, so kicking one here would read as rubber-banding rather
/// than as recoil.
inline constexpr double kProjectileRecoilScale = 1.0;
inline constexpr double kProjectileMaxRecoil = 4.0;

/// A shot's mass, on the same scale a mob's body uses (bodyMassForRadius).
/// Sharing the scale is what lets one momentum figure push a mob and a shot
/// alike, and it is what makes an inherited-size shot hit harder rather than
/// merely looking bigger.
inline double projectileMass(double radius) {
    return bodyMassForRadius(radius);
}

/// Momentum shove, already divided by the victim's mass and capped.
inline double projectilePush(double shotMass, double shotSpeed, double victimMass) {
    if (!(shotMass > 0.0) || !(shotSpeed > 0.0)) return 0.0;
    const double mass = victimMass > 1e-6 ? victimMass : 1.0;
    const double push = kProjectilePushPerMomentum * shotMass * shotSpeed / mass;
    if (!std::isfinite(push) || push <= 0.0) return 0.0;
    return std::min(push, kProjectileMaxPush);
}

/// A centipede -- or a leech, which is built the same way -- is a head plus
/// this many trailing body mobs. The count is a constant in the reference
/// rather than a per-mob config field.
inline constexpr int kCentipedeSegmentCount = 9;

/// How far a segment trails the one in front, as a multiple of its own RADIUS.
/// Slightly under a full diameter, so the body reads as one animal rather than
/// a string of beads.
///
/// Shared rather than server-private because the joint is DRAWN as well as
/// held: a leech segment paints the bar between its own centre and its
/// leader's, and the length of that bar is this number (see the
/// MobArt::LeechBody case in client/render/mob_art.cpp). Two copies of it would
/// be a chain that renders half a segment short of where it actually is.
inline constexpr double kSegmentSpacingPerRadius = 1.8;

/// What a gardn chain (MobConfig::gardnChain, the centipedes) leaves between
/// two joined beads, skin to skin: gardn's Segment.cc holds a segment at its
/// leader's radius plus its own plus this, so the two just touch.
inline constexpr double kGardnSegmentGap = 0.01;

// -- mob-carried petal rings -------------------------------------------------
//
// A glitch flower spins five petals around itself. The ring is not made of
// entities: it is a BAND test around the orbit circle, expressed in multiples
// of the mob's own radius so it scales with rarity exactly as the body does.

inline constexpr double kMobPetalRingOrbitScale = 2.4;
/// A ring petal's drawn BOX, as a multiple of the mob's own radius. Here
/// rather than in the renderer so PetalRingSpec can default to it -- both
/// numbers are now per-ring knobs and a default belongs beside the field it
/// defaults.
inline constexpr double kMobPetalRingPetalScale = 0.55;
inline constexpr double kMobPetalRingHitScale = 0.5;

// -- pets --------------------------------------------------------------------
//
// A summoned mob keeps its config's own behaviour -- a passive pet stays
// passive -- and moves the way its wild counterpart does: it idles on the same
// hop, and a fighting one chases on the same pursuit. What it gains is an
// owner: it fights the wild mob nearest that owner, and walks back to them
// when it leaves their screen. A wall between the two leaves it stuck where it
// is; a pet that gets way too far (kPetRecallDistance) or is trapped in sight
// of its owner is retired, and its egg hatches a fresh one after its reload.
// A sandstorm is the exception and runs its own leash below.

/// Ring distance a sandstorm pet is placed at when it teleports back to its
/// owner.
inline constexpr double kPetTeleportDistance = 80.0;

/// How close a pet walking back to its owner comes before it is home and goes
/// back to idling or fighting. Well inside the screen, so a pet that gets home
/// does not wander straight back off it.
inline constexpr double kPetHomeDistance = 300.0;

/// Past this from its owner -- or in another realm -- a pet is way too far:
/// it is retired and its egg pays a reload, wall or no wall. About one and a
/// half screens.
inline constexpr double kPetRecallDistance = 3000.0;

/// A returning pet with a clear line to its owner that has not closed on them
/// by kPetProgressStep for this long is trapped, and is retired like one that
/// got too far. A wall in the way stops this clock: that pet is stuck, and
/// stays stuck.
inline constexpr double kPetTrappedMillis = 5000.0;
inline constexpr double kPetProgressStep = 25.0;

/// How much nearer the owner another wild mob must be before a pet drops the
/// one it is fighting for it, so two mobs about as close do not split its
/// attention tick by tick.
inline constexpr double kPetRetargetMargin = 50.0;

/// A sandstorm pet shadows its owner's velocity slightly faster than the owner
/// moves, so it steadily pulls ahead until the leash below brings it back.
inline constexpr double kSandstormPetSpeedFactor = 1.2;

/// How far a sandstorm pet may get from its owner before it turns for home.
/// Inside the viewport's half height, so a storm out in front never leaves
/// its owner's screen.
inline constexpr double kSandstormPetLeash = 400.0;

/// How close a returning sandstorm pet comes before it goes back to shadowing
/// its owner -- the reference's kReturning stops at the same 100.
inline constexpr double kSandstormPetHomeDistance = 100.0;

/// A returning sandstorm pet's speed, as a multiple of whichever is faster:
/// its owner right now or a flower at full speed. The reference returns at
/// 1.5x the player's acceleration; measured against the owner too, so a
/// flower running faster than the base speed cannot outpace it.
inline constexpr double kSandstormPetReturnSpeedFactor = 1.5;

/// Extra chase range per rarity tier a summon is spawned at.
inline constexpr double kPetAggroRangePerRarity = 200.0;

/// What a unique pet's size is, as a fraction of its base size on the pet
/// ladder (kPetSizeScale) -- the endpoint of its mobSizeRamp. A common pet is
/// exactly a common mob; a unique one is a third of the old 26.8x size,
/// which would otherwise dwarf the flower that owns it -- the reference's
/// PET_SIZE_SCALE_AT_UNIQUE (src/mobs.ts). Was two thirds until 2026-10-11.
inline constexpr double kPetSizeScaleAtUnique = 1.0 / 3.0;

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

inline constexpr double kDropPickupRadius = 40.0;

/// Magnetism is a pickup RADIUS, not a force. Pulling the drop toward the
/// player looks better but means the item is consumed before any snapshot
/// carried it, so the client has nothing to animate.
inline constexpr double kBaseMagnetism = 0.0;

// ---------------------------------------------------------------------------
// Movement step
// ---------------------------------------------------------------------------

/// One tick of player physics, run by the server. The client does not
/// predict, so nothing on its side has to agree with this step (see
/// client/interpolation.h).
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
    // sooner, or the same input stepped at two rates would end up at two
    // different speeds.
    const double decay = std::pow(1.0 - kMoveFriction, dt * kFrictionReferenceRate);
    state.velocity = state.velocity * decay + target * (1.0 - decay);
}

/// The speed that, added to a flower's velocity and left to integrateVelocity's
/// friction, carries it `distance` in total before it dies out -- a shove
/// delivered as momentum, the way gardn delivers every knockback, rather than
/// as a one-tick jump that reaches the client as a teleport.
///
/// `decaysFirst` says whether the next step decays the impulse before moving
/// on it: true when it is added after this tick's movement (combat), false
/// when it is added between integrateVelocity and the step it feeds. Zero for
/// a step of no time, which has no friction to invert; callers fall back to a
/// displacement there.
inline double shoveSpeed(double distance, double dt, bool decaysFirst) {
    if (!(dt > 0.0) || !(distance > 0.0)) return 0.0;
    const double decay = std::pow(1.0 - kMoveFriction, dt * kFrictionReferenceRate);
    if (!(decay > 0.0) || !(decay < 1.0)) return 0.0;
    const double travelPerUnitSpeed = dt * (decaysFirst ? decay : 1.0) / (1.0 - decay);
    return distance / travelPerUnitSpeed;
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

} // namespace flix
