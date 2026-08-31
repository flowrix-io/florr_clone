#pragma once
// Mob and petal content: the JSON tables, loaded once, addressed by index.
//
// Two things shape this file.
//
//  * The index is what crosses the wire. It is assigned in sorted-key order so
//    that a server and a client reading the same files necessarily agree on
//    what entry 17 is; contentHash() catches the case where they are not
//    reading the same files at all.
//
//  * Everything the simulation reads per tick is a plain field on a struct in
//    a contiguous vector. No map lookups and no string comparisons survive
//    past load: ids are resolved to indices in a link pass, `ai_type` becomes
//    an AiKind, and `#rrggbb` becomes a packed integer.
//
// The shipped data is dirty -- nulls, a negative damage, an angle in the wrong
// unit, an offset of -1e100. Load sanitises every one of those, records a
// human-readable line in warnings(), and guarantees that nothing non-finite
// reaches the simulation.

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/components.h"
#include "shared/game/rarity.h"

namespace flr {

/// What mobIndex()/petalIndex() answer for an id the content does not define.
/// Deliberately the same sentinel as an empty loadout slot: "no petal" and
/// "a petal nobody has heard of" mean the same thing to everything downstream.
inline constexpr std::uint16_t kInvalidIndex = kNoPetal;

// ---------------------------------------------------------------------------
// Shared sub-structures
// ---------------------------------------------------------------------------

/// A packed 0xRRGGBBAA colour. Alpha is carried because the `bubble` petal
/// ships a fully transparent `rgba(...)` fill and means it.
using Rgba = std::uint32_t;

inline constexpr Rgba kOpaqueWhite = 0xFFFFFFFFu;

/// A volley. `present` is what distinguishes "fires nothing" from "fires a
/// projectile whose fields all happen to be zero".
struct ProjectileSpec {
    bool present = false;
    int count = 1;
    double distance = 0;      ///< units travelled before it expires
    double speed = 0;         ///< units per second
    /// Angular STEP between adjacent projectiles, radians -- not the total fan
    /// width. Five projectiles at 1.2566 make a closed ring, which is what the
    /// `flower` petal is for.
    double spreadAngle = 0;
    double seekRange = 0;     ///< 0 for a projectile that does not home
    double seekCone = 0;      ///< half-angle it will turn within, radians

    /// A mob fires a named petal as ammunition; a petal fires itself and
    /// leaves this empty.
    std::string ammoPetalId;
    std::uint16_t ammoPetalIndex = kInvalidIndex;
    Rarity ammoRarity = Rarity::Common;
};

/// A ring of petals a mob carries, as a flower does.
struct PetalRingSpec {
    bool present = false;
    std::string petalId;
    std::uint16_t petalIndex = kInvalidIndex;
    int count = 0;
};

/// A nest that keeps producing escorts.
struct PeriodicSpawnSpec {
    bool present = false;
    std::string mobId;
    std::uint16_t mobIndex = kInvalidIndex;
    double intervalMillis = 0;
    double lifetimeMillis = 0;   ///< 0 = the escort never expires on its own
    int maxAlive = 0;
    /// Tiers relative to the parent, so a rare queen fields uncommon soldiers.
    int rarityOffset = 0;
};

/// A lingering damage field (uranium).
struct RadiationSpec {
    bool present = false;
    double radius = 0;
    double intervalMillis = 0;
};

/// Passive bonuses a petal grants its holder, exactly as the JSON writes them.
///
/// Some of these are multipliers around a neutral 1.0 and some are additive
/// amounts in world units. They are kept apart here rather than normalised
/// because rarity scales the two kinds differently -- see petalStats().
struct PetalModifiers {
    // Multiplicative, neutral at 1.0.
    double maxHealth = 1.0;
    double speed = 1.0;
    double range = 1.0;          ///< petal reach
    double rotationSpeed = 1.0;  ///< ring spin; negative reverses it
    double playerRadius = 1.0;
    double damage = 1.0;

    // Additive, neutral at 0.
    double luck = 0.0;
    double magnetism = 0.0;              ///< extra pickup radius, units
    double aggroRadius = 0.0;            ///< extra mob notice range, units
    double petalAttractionRadius = 0.0;  ///< pulls loose petals in, units
    double poisonArmor = 0.0;            ///< poison damage absorbed per second

    bool any = false;   ///< set when the JSON carried a playerModifiers block
};

// ---------------------------------------------------------------------------
// MobConfig
// ---------------------------------------------------------------------------

/// One entry of mobs.json, at its base (common) tier. Rarity is applied by
/// mobStats(); nothing here is pre-scaled.
struct MobConfig {
    std::string id;             ///< the JSON key, e.g. "soldier_ant"
    std::string name;
    std::string description;
    std::string color;          ///< as written, for tooling and tooltips
    Rgba colorRgba = kOpaqueWhite;
    std::string image;          ///< inline SVG source

    double damage = 0;
    double health = 1;
    double size = 1;            ///< body diameter in "size units"; see mobStats()
    double speed = 0;           ///< config units; mobStats() converts to units/s
    double cooldownMillis = 0;  ///< gap between attacks
    double range = 0;           ///< aggro range, world units
    double visualScale = 1.0;   ///< art only; never touches the hitbox

    AiKind ai = AiKind::Neutral;

    /// The `section` list as a bitmask over the 3x3 biome grid. Order and
    /// duplicates in the JSON carry no meaning, and a mask keeps mobStats()
    /// allocation-free.
    std::uint16_t sectionMask = 0;
    double spawnWeight = 1.0;
    /// The mob does not exist below this tier: mobStats() returns an empty
    /// section mask for anything lower, which is the single place every
    /// spawner already looks.
    Rarity minRarity = Rarity::Common;

    bool hideRotation = false;   ///< draw upright regardless of heading
    bool noEggDrop = false;
    bool reversed = false;       ///< art is mirrored horizontally
    bool noMobCollision = false;

    /// Per-spawn size jitter, multiplying `size`. Equal bounds means none.
    double randomSizeMin = 1.0;
    double randomSizeMax = 1.0;

    /// Escorts placed the moment the nest spawns, and the waves it sends
    /// afterwards. Both are already resolved to mob indices.
    std::vector<std::uint16_t> initialSpawns;
    std::vector<std::vector<std::uint16_t>> spawnWaves;

    ProjectileSpec projectile;
    PetalRingSpec petalRing;
    PeriodicSpawnSpec periodicSpawn;

    /// Poison the mob's touch applies. Stored per second, converted from the
    /// per-millisecond figure the JSON uses.
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;

    bool emissive = false;
    std::string lightColor;
    Rgba lightColorRgba = kOpaqueWhite;
    double lightRadius = 0;

    /// XP awarded per tier, filled from mob_xp.json with the derivations
    /// described in loadFiles().
    std::array<double, kRarityCount> xp{};
};

// ---------------------------------------------------------------------------
// PetalConfig
// ---------------------------------------------------------------------------

/// One entry of petals.json, at its base (common) tier.
struct PetalConfig {
    std::string id;
    std::string name;
    std::string description;
    std::string color;
    Rgba colorRgba = kOpaqueWhite;
    std::string image;

    double damage = 0;
    double health = 0;
    double size = 1;            ///< diameter in "size units"; see petalStats()
    double cooldownMillis = kDefaultPetalReloadMillis;   ///< reload after breaking
    int count = 1;              ///< petals spawned per equipped slot

    bool isAdminPetal = false;

    PetalModifiers modifiers;

    /// Mirrors the web game's default: petals without an explicit knockback
    /// field still push for 5.  Zero is reserved for petals that opt out.
    double knockback = 5;
    ProjectileSpec projectile;
    double range = 0;           ///< reach for the petals that have one
    std::uint8_t equipFlags = EquipNone;

    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;

    double speed = 0;           ///< orbit speed for the petals that override it
    bool noPhysics = false;     ///< no body, no collision: a pure modifier
    bool defendOnly = false;    ///< only acts while the ring is pulled in
    bool clumped = false;       ///< a count > 1 spawns as one cluster
    bool independentHealth = false;  ///< each petal of a cluster breaks alone
    bool wallCollide = false;
    bool emissive = false;

    double burstHeal = 0;
    double burstHealChargeMillis = 0;
    double passiveHeal = 0;     ///< per second, before rarity
    double burstShield = 0;

    /// Held at a fixed angle instead of orbiting. `has` distinguishes the
    /// petals pinned to 0 radians from the ones that simply orbit.
    bool hasFixedDirection = false;
    double fixedDirection = 0;

    /// Draw offset along the flower's up axis.
    double visualOffsetY = 0;
    /// The petal is not drawn at all. Three entries express this in the JSON
    /// with a visualOffsetY of -1e100, which is a way of shoving the sprite
    /// off the world rather than a number anything should compute with.
    bool hidden = false;

    /// Per-victim gap between two hits from this petal. Falls back to
    /// kPetalHitIntervalMillis.
    double damageIntervalMillis = kPetalHitIntervalMillis;

    double cameraZoom = 1.0;    ///< < 1 zooms out
    double lightRadius = 0;
    std::string lightColor;
    Rgba lightColorRgba = kOpaqueWhite;

    /// A summoned mob. `petCount` is how many one petal keeps alive.
    std::string petMobId;
    std::uint16_t petMobIndex = kInvalidIndex;
    Rarity petMobRarity = Rarity::Common;
    int petCount = 1;

    double slowFactor = 1.0;    ///< multiplies the victim's speed; 1 = none
    double slowDurationMillis = 0;

    double spongeDamageDurationMillis = 0;
    double attractionForce = 0;
    double webRadius = 0;
    RadiationSpec radiation;

    /// False when the JSON gave no health pool at all. Such a petal is a pure
    /// modifier or an emitter and can never be broken; it is NOT a petal with
    /// zero health, which would break on the first tick.
    bool breakable = true;
};

// ---------------------------------------------------------------------------
// Derived per-rarity stats
// ---------------------------------------------------------------------------

/// A mob at one tier. Computed on demand: the whole table is a few multiplies,
/// and a precomputed 51x10 grid would only be a cache the loader has to keep
/// coherent.
struct MobStats {
    double health = 1;
    double damage = 0;
    double radius = 0;          ///< world units
    double mass = 1;            ///< proportional to area
    double speed = 0;           ///< world units per second
    double xp = 1;
    double aggroRange = 0;
    double attackCooldownMillis = 0;
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;
    double visualScale = 1.0;
    double spawnWeight = 1.0;
    /// Biome sections this mob may spawn in AT THIS TIER. Empty below
    /// `min_rarity`, which is how that rule is enforced everywhere at once.
    std::uint16_t sectionMask = 0;

    bool spawnable() const { return sectionMask != 0; }
    bool spawnsIn(int section) const {
        return section >= 0 && section < kSectionCount &&
               (sectionMask & (1u << section)) != 0;
    }
};

/// A petal at one tier.
struct PetalStats {
    double damage = 0;
    double health = 0;
    double reloadMillis = kDefaultPetalReloadMillis;
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;
    double heal = 0;                    ///< burst heal per charge
    double healChargeMillis = 0;
    double passiveHealPerSecond = 0;
    double knockback = 0;
    double shield = 0;
    double slowFactor = 1.0;
    double slowDurationMillis = 0;
    double radius = 0;                  ///< world units
    double damageIntervalMillis = kPetalHitIntervalMillis;
    int count = 1;
    bool breakable = true;
    double cameraZoom = 1.0;
    PetalModifiers modifiers;           ///< already scaled for this tier
};

// ---------------------------------------------------------------------------
// ContentRegistry
// ---------------------------------------------------------------------------

class ContentRegistry {
public:
    /// Loads `mobs.json`, `petals.json` and (optionally) `mob_xp.json` from
    /// one directory.
    ///
    /// On failure `errorOut` says what went wrong and the registry keeps
    /// whatever it already held -- a bad hot reload must not leave a running
    /// server with no content.
    bool load(const std::string& dataDir, std::string& errorOut);

    /// The same, with the three paths given explicitly. `xpPath` may be empty
    /// or absent: XP then falls back to 1 and a warning is recorded.
    bool loadFiles(const std::string& mobsPath, const std::string& petalsPath,
                   const std::string& xpPath, std::string& errorOut);

    /// An out-of-range index yields a shared placeholder rather than undefined
    /// behaviour: these indices arrive from the wire, and a corrupt one must
    /// cost a wrong-looking mob, not the process.
    const MobConfig& mob(std::uint16_t index) const;
    const PetalConfig& petal(std::uint16_t index) const;

    std::uint16_t mobIndex(const std::string& id) const;
    std::uint16_t petalIndex(const std::string& id) const;

    std::size_t mobCount() const { return mobs_.size(); }
    std::size_t petalCount() const { return petals_.size(); }

    /// FNV-1a folded over the raw bytes of every file loaded, in a fixed
    /// order. Compared in the connect handshake.
    std::uint32_t contentHash() const { return hash_; }

    /// Everything the loader had to repair, one line each. Empty on clean
    /// data; the shipped data is not clean.
    const std::vector<std::string>& warnings() const { return warnings_; }

    bool loaded() const { return !mobs_.empty(); }

    MobStats mobStats(std::uint16_t index, Rarity r) const;
    PetalStats petalStats(std::uint16_t index, Rarity r) const;

private:
    std::vector<MobConfig> mobs_;
    std::vector<PetalConfig> petals_;
    std::unordered_map<std::string, std::uint16_t> mobIds_;
    std::unordered_map<std::string, std::uint16_t> petalIds_;
    std::vector<std::string> warnings_;
    std::uint32_t hash_ = 0;
};

// ---------------------------------------------------------------------------
// Process-wide content
// ---------------------------------------------------------------------------

/// The loaded content. Reachable from anywhere so that a system does not have
/// to thread a registry reference through every call it makes; content is
/// immutable after load, so there is nothing to synchronise.
const ContentRegistry& content();

/// Loads (or reloads) the process-wide registry. False leaves the previous
/// content in place and fills `errorOut`.
bool loadContent(const std::string& dataDir, std::string& errorOut);

} // namespace flr
