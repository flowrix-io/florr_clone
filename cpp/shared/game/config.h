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

namespace flix {

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

/// Gap between the shots of a burst for a config that names a `burstCount` and
/// no interval, at the common tier. Three server ticks, so the shots leave as a
/// readable string of separate projectiles rather than as one clump.
inline constexpr double kDefaultBurstIntervalMillis = 100.0;

/// What a mob is when a map (or `spawn_npc`) puts it down as an NPC, from its
/// `npc` block. `present` is what makes the mob one at all; see
/// shared/game/npc.h for what an NPC is.
struct NpcSpec {
    bool present = false;
    /// What it does for a flower that walks up to it. None is legal: a target
    /// dummy offers nothing but something to hit.
    NpcService service = NpcService::None;
    /// Whose side it stands on. The players' own NPCs cannot be hit at all; an
    /// NPC on any other side takes every hit and loses nothing from any of them.
    Team team = Team::Players;
    /// The petals it wears, one loadout slot each, in a ring that orbits it
    /// exactly as a flower's does -- spawned, placed, broken and reloaded by
    /// the petal system, at `petalRarity`. Empty for an NPC that wears none,
    /// which is every NPC but the titan. One that wears any FIGHTS like a
    /// flower: its ring and its body hit whatever its side may hit.
    std::vector<std::uint16_t> petals;
    Rarity petalRarity = Rarity::Universal;

    bool wearsPetals() const { return !petals.empty(); }
};

/// A volley. `present` is what distinguishes "fires nothing" from "fires a
/// projectile whose fields all happen to be zero".
struct ProjectileSpec {
    bool present = false;
    int count = 1;
    double distance = 0;      ///< units travelled before it expires
    /// Units per second, AT EVERY CALIBRE. Nothing scales it: a shot twice the
    /// size flies at this number too, so a grown flower's pea is a stock pea
    /// drawn bigger rather than a different weapon, and this file is the only
    /// place anything says how fast a shot travels. The cost is that a big
    /// shot leaves less clear air behind it than a stock one does at the same
    /// `burstIntervalMillis` or `spreadAngle` -- tune those, here, where the
    /// change is visible.
    double speed = 0;
    /// Angular STEP between adjacent projectiles, RADIANS -- not the total fan
    /// width, and not degrees however large it looks. `flower` ships 72, which
    /// is 72 radians: the five shots wrap to a lopsided pattern rather than the
    /// clean 72-degree star the number suggests, and the reference fires it
    /// that way. Reinterpreting it as degrees is a different weapon.
    double spreadAngle = 0.2;
    double seekRange = 0;     ///< 0 for a projectile that does not home
    /// Half-angle around the FIRING bearing that a seeking shot will re-aim
    /// within, radians. Applied once, at launch: the shot then flies straight,
    /// which is what keeps the client's dead reckoning exact.
    double seekCone = kPi * 0.25;

    /// Shots in a BURST -- volleys fired one after another off a single
    /// cooldown, which is a different thing from `count` (the shots that leave
    /// together, fanned by `spreadAngle`). A mantis fires three peas in a row
    /// down one bearing, so it is `count` 1 and `burstCount` 3, not the other
    /// way round: three at once would be a shotgun.
    ///
    /// 1 -- the default -- is a mob with no burst at all, and every existing
    /// shooter keeps the cadence it had.
    int burstCount = 1;
    /// Gap between the shots WITHIN a burst, milliseconds. It fires exactly as
    /// written -- not scaled by tier, not capped against the cadence; see
    /// fireVolley, which is also where the reason lives. Since `speed` does not
    /// grow with the calibre either, a burst does tighten as the shots get
    /// bigger: widen the gap here if an apex shooter's burst reads as a blob.
    ///
    /// The full cooldown then runs from the LAST shot of a burst, so a burst
    /// costs `(burstCount - 1)` gaps on top of the mob's stated cadence rather
    /// than being squeezed inside it.
    double burstIntervalMillis = 0;

    /// A mob fires a named petal as ammunition; a petal fires itself and
    /// leaves this empty.
    std::string ammoPetalId;
    std::uint16_t ammoPetalIndex = kInvalidIndex;
    Rarity ammoRarity = Rarity::Common;
};

/// A mob that throws lightning.
///
/// Two triggers, because the two mobs that have one are nothing alike: a
/// jellyfish shocks anything that comes inside `strikeRange` without having to
/// reach it, and a firefly shocks on the tick its body touches a flower. A mob
/// may declare either, or both.
///
/// Nothing here fires when the MOB is hit. That is deliberate and is the
/// difference between a firefly and a thorn: swatting one with a petal ring is
/// exactly the case that must not discharge, or a ranged loadout would take
/// the strike it kept its distance to avoid.
struct LightningSpec {
    bool present = false;

    /// How far the shock travels PAST THE MOB'S OWN BODY. Every flower inside
    /// that reach takes `damage` and has an arm drawn to it.
    ///
    /// Past the body, not from the centre, because a mob's body is the one
    /// length here that already scales with rarity -- 1.5x a common's at
    /// common, 43x at apex. Measured from the centre, a flat radius is eaten by
    /// the mob that threw it: an ultra jellyfish's 300 units sit entirely
    /// inside its own 315-unit body and reach nobody at all, and a flower
    /// standing ON an ultra firefly is 277 units from its centre and so outside
    /// a 250-unit disc. Stated against the skin, a strike always reaches
    /// whatever is touching the mob, at every tier, and grows with it.
    double radius = 0;

    /// What one strike takes off. 0 means the mob's own `damage` stat for its
    /// tier, which is what makes a mythic jellyfish's shock worth more than a
    /// common one's without a second ladder in the JSON.
    double damage = 0;

    /// How close a flower has to come before the mob strikes at it, measured
    /// from the body's edge like `radius`. 0 means the mob never strikes at
    /// range and `onContact` is its only trigger.
    ///
    /// Separate from `radius` because they answer different questions -- when
    /// to throw, and what the throw covers -- though a mob that states only
    /// `radius` gets them equal, which is the shape a shock wants. A mob that
    /// names `onContact` and no `range` gets zero instead: it has already said
    /// what its trigger is.
    double strikeRange = 0;

    /// Strike when this mob's body collides with a flower.
    bool onContact = false;

    /// Gap between two strikes from the same mob. 0 means the mob's own
    /// `cooldown`, and a mob with neither waits kDefaultLightningCooldownMillis
    /// -- a firefly ships `cooldown: 0`, and an unpaced strike would fire on
    /// all thirty ticks a flower spends walking through one.
    double cooldownMillis = 0;
};

/// A mob that leaves webs behind it, as gardn's spider does (Ai.cc: an
/// `alloc_web` every second of the mob's life, whatever it is doing).
///
/// Each web is a ground field on the spot the mob was standing on: it holds
/// still, lasts `lifetimeMillis`, and slows whatever of the OTHER side stands
/// in it -- flowers included, which is the one way a mob's web differs from a
/// Web petal's. See GroundEffect::slowsFlowers.
struct WebSpec {
    bool present = false;
    double intervalMillis = 0;
    double lifetimeMillis = 0;
    /// The web's radius as a multiple of the mob's OWN body radius, the way a
    /// petal ring's `orbitScale` is stated. gardn's spider is 15 across and
    /// lays a 25-unit web; stating that as a ratio keeps the web the same size
    /// against the spider at every tier, and a mythic spider leaves a mythic
    /// web (~/gardn's `25 * mob_radius_mult(rarity)`).
    double radiusScale = 0;
    /// What the web leaves of a victim's speed. gardn's speed_ratio of 0.5.
    double slowFactor = 1.0;
    /// The lowest tier that lays any. A spider below it is an ordinary chaser.
    Rarity minRarity = Rarity::Common;
};

/// A petal a mob DROPS behind it on a clock (`dropProjectile`): a real
/// projectile, built like any volley's shot and graded at the dropper's tier,
/// that is born at a standstill and lies where it fell until `lifetimeMs` runs
/// out or something breaks it. The bumble bee's pollen trail.
///
/// Not a `projectile` block with no speed: that block is an aimed WEAPON --
/// the standoff, the stinger wind-up and the pets' prey hunt all key off it --
/// and a trail is laid whether or not anything is there to aim at.
struct DropProjectileSpec {
    bool present = false;
    std::string petalId;
    std::uint16_t petalIndex = kInvalidIndex;
    double intervalMillis = 0;
    double lifetimeMillis = 0;
};

/// A ring of petals a mob carries, as a flower does.
struct PetalRingSpec {
    bool present = false;
    std::string petalId;
    std::uint16_t petalIndex = kInvalidIndex;
    int count = 0;
    /// Where the ring sits, as a multiple of the mob's own radius. The glitch
    /// flower's 2.4 is the default because it was the only ring in the game
    /// when this became a knob; a dandelion wears its seeds much closer in.
    double orbitScale = kMobPetalRingOrbitScale;
    /// DECORATIVE rings only: a petal's drawn size, as a multiple of the mob's
    /// own radius -- the BOX the artwork is fitted into. An AMMUNITION ring
    /// ignores this, because its seeds are entities and are drawn from the
    /// radius the server gave them, which is `hitScale` below.
    double petalScale = kMobPetalRingPetalScale;
    /// AMMUNITION rings only: one seed's RADIUS, as a multiple of the mob's
    /// own. It is the seed's whole size -- what it collides at, what it is
    /// drawn at, and what it keeps when it is shot off -- so there is one
    /// number rather than a drawn one and a hit one that can disagree.
    double hitScale = kMobPetalRingHitScale;
    /// The ring turns. A decorative ring spins like a flower's; a ring that is
    /// part of the body -- a dandelion's seed head -- is ATTACHED and holds
    /// still, so its petals stay on the mob rather than sweeping past it.
    ///
    /// An AMMUNITION ring must declare `"spin": false`. Its seats are where
    /// the server places real bodies and where a shed seed leaves from, and
    /// neither is knowable for a ring whose phase is a viewer's own clock.
    /// The loader refuses the combination rather than leaving it to be found.
    bool spins = true;
    /// DECORATIVE rings only: each petal is turned to face OUTWARD along its
    /// own radius, which is gardn's kFollowRot (Server/Process/Petal.cc: a
    /// petal's angle is the bearing from its owner to itself). False leaves
    /// the artwork upright, which is what the glitch flower's squares want.
    ///
    /// An AMMUNITION ring has no say: its seeds are entities, and an entity
    /// sitting on a body faces out of it. There is nothing to configure.
    bool followRotation = false;
    /// Draw the body as a flower FACE rather than as the mob's own artwork.
    ///
    /// Stated rather than inferred from "has no artwork": the glitch flower
    /// ships an SVG it deliberately does not use, so a rule that preferred the
    /// artwork whenever one existed would change the one mob this branch was
    /// written for.
    bool flowerFace = false;

    /// The ring is AMMUNITION: a hit knocks one petal off and fires it at
    /// whoever landed the hit. A ring without this is pure decoration, which
    /// is what the glitch flower's is (see cpp-mob-petal-ring-not-simulated).
    ///
    /// A shed petal never comes back. The ring is what the mob was BUILT with,
    /// so stripping one bare is progress a fight keeps rather than something
    /// that heals back between attempts -- the same reason its health does not
    /// regenerate.
    bool shootOnHit = false;
    /// Units per second, at every tier -- nothing scales it, as with
    /// `ProjectileSpec::speed`. 0 falls back to the default.
    double shotSpeed = 0;
    double shotDistance = 0;   ///< reach in world units, before the tier scale
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

/// A nest a flower walks INTO (`dungeon`): touching it carries the flower into
/// a private copy of the map `mapId` (a manifest entry with `copies`), filled
/// with `brood` -- and the nest falls, paying out like any kill, on the tick
/// the last thing in there dies. The termite mound.
struct DungeonSpec {
    bool present = false;
    /// The map's file stem; every realm loaded from it is one instance.
    std::string mapId;
    struct Entry {
        std::string mobId;
        std::uint16_t mobIndex = kInvalidIndex;
        int count = 0;
        /// The map door (player spawn) the entry is put down in. Empty means
        /// the map's own front door.
        std::string door;
    };
    std::vector<Entry> brood;
};

/// A nest that keeps its whole brood underground until a flower comes right up
/// to it, then sends every one of them out at once (`ambush`). The fire ant
/// hole. Nothing is spawned with the nest and nothing follows the first burst:
/// the brood IS the fight, and the nest falls with the last of it (see
/// AmbushNest).
struct AmbushSpec {
    bool present = false;
    std::string mobId;
    std::uint16_t mobIndex = kInvalidIndex;
    int count = 0;
    /// How close a flower has to come to spring it, EDGE to edge, in the
    /// nest's own body radii: the gap between the flower's hitbox and the
    /// nest's body is this many times the nest's radius. Measured from the
    /// edge so a big hole doesn't go off the moment a flower is a body-width
    /// from its centre; scaled by the radius so the gap grows with the hole,
    /// and a super hole springs from as far off, for its size, as a common.
    double triggerRadiusScale = 0;
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
    /// Multiplies how far a mob notices the holder from: below 1 it shrinks
    /// (poo), above 1 it grows (bulb), and a neutral mob notices a holder it
    /// grows. Compounds per tier -- see petalAggroRangeScale.
    double aggroRange = 1.0;

    // Additive, neutral at 0.
    double luck = 0.0;
    double magnetism = 0.0;              ///< extra pickup radius, units
    double aggroRadius = 0.0;            ///< extra mob notice range, units
    double petalAttractionRadius = 0.0;  ///< pulls loose petals in, units
    double poisonArmor = 0.0;            ///< poison damage absorbed per second
    /// Chance, 0..1, that a direct hit on the holder misses. Grows by the
    /// authored figure every tier -- see petalEvasionScale.
    double evasion = 0.0;
    /// Fraction, 0..1, of what a direct hit takes off the holder that is dealt
    /// back to whoever is behind it, when the attacker is the SALT'S OWN
    /// rarity. Flat across the tiers: what rarity buys is the ladder
    /// reflectionScale() puts under it at the moment of the hit, since that
    /// depends on the attacker as much as on the salt.
    double damageReflection = 0.0;

    bool any = false;   ///< set when the JSON carried a playerModifiers block
};

// ---------------------------------------------------------------------------
// MobConfig
// ---------------------------------------------------------------------------

/// One mob's place in one group: which group, and how heavily it is weighted
/// inside it. Read from either side -- a MobConfig lists the groups it is in,
/// and a MobGroup lists the mobs in it -- because a spawn rolls over a group
/// and a tool asks about a mob.
struct MobGroupMember {
    std::uint16_t group = 0;   ///< index into ContentRegistry::mobGroups()
    std::uint16_t mob = 0;     ///< index into ContentRegistry::mob()
    double weight = 1.0;
};

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
    /// Flat damage subtracted from every direct hit, at the COMMON tier;
    /// mobStats() applies kMobArmorScale on top. One is the default rather
    /// than zero -- every mob in the game is armoured, and mobs.json states
    /// only the exceptions (leafbug's 10).
    double armor = 1.0;
    /// Chance, 0..1, that a direct hit on this mob misses. Flat across the
    /// tiers: the fly's 0.9 dodges nine hits in ten at common and at apex.
    double evasion = 0.0;
    double size = 1;            ///< body diameter in "size units"; see mobStats()
    double speed = 0;           ///< config units; mobStats() converts to units/s
    double cooldownMillis = 0;  ///< gap between attacks
    double range = 0;           ///< aggro range, world units
    double visualScale = 1.0;   ///< art only; never touches the hitbox
    /// Slides the artwork off the body centre, art only like visualScale.
    /// Measured in the art's own frame (+X is the way the drawing faces) and
    /// in multiples of the DRAWN radius -- unlike a petal's, which is in world
    /// units -- so the same point of the drawing stays on the hitbox whatever
    /// the tier, the visual_scale or the death pop makes the sprite's size.
    double visualOffsetX = 0;
    double visualOffsetY = 0;

    AiKind ai = AiKind::Neutral;

    /// The groups this mob belongs to, and how heavily it is weighted inside
    /// each one.
    ///
    /// A group is whatever mobs.json says it is -- `garden`, `desert`,
    /// `sewers`, `boss_rush`, anything an author types. There is no fixed list
    /// and no fixed count: the groups ARE the union of the names the mobs use,
    /// which is what lets a map's spawn band name one without a second file
    /// having to agree that it exists.
    ///
    /// The weight is per group on purpose. A hornet that is common in the
    /// garden and rare in the jungle is one mob with two weights, and a single
    /// `spawn_weight` could only say one of those.
    std::vector<MobGroupMember> groups;

    /// The weight a group membership takes when it does not state one of its
    /// own, from `spawn_weight`. Also what the maze pool weights by.
    double spawnWeight = 1.0;

    /// The mob does not exist below this tier: mobStats() reports it as
    /// non-ambient for anything lower, which is the single place every spawner
    /// already looks.
    Rarity minRarity = Rarity::Common;

    bool hideRotation = false;   ///< draw upright regardless of heading
    bool noEggDrop = false;
    bool reversed = false;       ///< art is mirrored horizontally
    bool noMobCollision = false;
    /// A hole in the ground (`hole`): drawn beneath every other mob, so what
    /// comes out of it stands on top of it rather than vanishing under it.
    /// gardn's `attributes.hole`, and a matter of draw order only (the client
    /// also lays any nest with `spawn_waves` down in that same first pass).
    bool hole = false;
    /// Nothing in the world touches this mob (`intangible`): no petal, shot,
    /// body, aura or strike lands on it, it deals no contact damage, it pushes
    /// nothing and nothing pushes it. It cannot be hurt, so it can only die
    /// some other way -- the fire ant hole falls with its brood. Implies
    /// noMobCollision.
    bool intangible = false;

    /// The mob shoots over its TAIL: it keeps its rear on whatever it is
    /// aiming at and holds the volley until it has come round, rather than
    /// firing out of its face the instant the cooldown is up.
    ///
    /// The two mobs that have one -- hornet and wasp -- draw their stinger at
    /// the back of the sprite, so a shot leaving the front is a shot leaving
    /// the wrong end of the animal.
    bool stingerShooter = false;

    /// Off a target the mob cruises on the bee's weaving line rather than
    /// hopping like something that walks. From `bee_ai`, either value.
    bool beeFlight = false;

    /// ...and keeps weaving while it chases, swaying across its bearing at
    /// full closing speed instead of a straight line. `bee_ai: "always"`;
    /// `"idle"` is the stingers, which cruise like bees but close straight.
    bool beeChaseWeave = false;

    /// How fast the bee cruise flies, in the same flower-top-speed units as
    /// `speed` (`cruiseSpeed`). Zero -- unstated, and every mob but the bumble
    /// bee -- is the flat kBeeCruiseSpeed every cruiser shares, pulse and all.
    /// A stated one sets the cruise's thrust as well as its ceiling, and flies
    /// steadily at that speed with no pulse; see beeCruiseDrive().
    double cruiseSpeed = 0;

    /// Moves the way gardn's walkers do (`gardn_ai`): one velocity carried
    /// between ticks under gardn's per-tick friction, so a pursuit accelerates
    /// into its speed and swings wide on a turn instead of snapping to it; an
    /// idle hop of gardn's fixed stride rather than one scaled by `speed`; and
    /// a recoil off every flower it touches. See MobAiSystem's gardn notes.
    bool gardnMotion = false;

    /// The mob never appears in a GROUP roll -- a band or a region naming a
    /// group never produces it. `target_dummy` declares no
    /// spawn_weight and would otherwise inherit the default 1.0 and take its
    /// share of every group it belongs to; it only reaches the world through
    /// a band that names it outright, which is how the dummy plots work.
    bool neverAmbient = false;

    /// Touching this mob -- body, ring or shot -- leaves the flower glitched
    /// until it next logs in. A property of the family rather than of the
    /// contact path, so every path infects at once.
    bool glitchInfecting = false;

    /// A chain head -- a centipede or a leech: `segmentCount` body mobs of type
    /// `segmentBodyIndex` trail it. Both are derived from the id at load,
    /// because the reference expresses the head->body link as a naming rule
    /// rather than a JSON field and every spawn path would otherwise have to
    /// repeat it.
    std::uint16_t segmentBodyIndex = kInvalidIndex;
    int segmentCount = 0;

    /// The chain is ONE animal rather than a string of them: every segment
    /// reads the same health pool, a hit anywhere takes it off that pool, and
    /// emptying it kills the whole body at once. A leech; a centipede is the
    /// other kind, where each bead is its own mob and cutting one in half
    /// leaves two live halves.
    ///
    /// Derived from the id beside the chain link above, for the same reason
    /// that is: which family a mob belongs to is a naming rule here, not a
    /// JSON field, and a spawner reading it per tick wants a bool rather than
    /// a string compare.
    bool sharedSegmentHealth = false;

    /// One of a COLONY (`colony`): inside a dungeon, every colony mob shares
    /// whatever any one of them is hit for, split evenly between the ones
    /// still standing. Termites. Outside a dungeon there is no colony to
    /// share with, and the flag does nothing.
    bool colony = false;

    /// A TRAILING body of a shared chain, rather than the head that tows it:
    /// it shares a pool but leads no chain of its own. The renderer asks this
    /// to decide who wears the animal's name plate -- one plate on the head,
    /// not ten identical ones a radius apart -- and it lives here beside the
    /// two fields it reads so the rule cannot be spelled two ways.
    bool sharedChainBody() const { return sharedSegmentHealth && segmentCount == 0; }

    /// Some chain head's body type -- a centipede's bead or a leech's trailing
    /// tube, of either family. Set from the head's link once every mob is
    /// loaded, since the body cannot see its own name in anyone's link. The
    /// animal is announced by its head: a boss's screen-top bar and the
    /// "has been defeated" line in chat both skip these, or a super centipede
    /// would fill the top of the screen with eleven bars and chat with eleven
    /// deaths.
    bool chainBody = false;

    /// What this mob is as an NPC, from its `npc` block: absent for every
    /// ordinary mob. Having one changes nothing about the mob itself -- an
    /// admin's `spawn` still puts a hostile one in the world with the stats
    /// above. See shared/game/npc.h.
    NpcSpec npc;

    /// Applied when this mob is SUMMONED rather than spawned wild. Only the
    /// digger is nerfed, and only as a pet: a wild digger keeps its full stats.
    double petHealthScale = 1.0;
    double petDamageScale = 1.0;

    /// Per-spawn size jitter, multiplying `size`. Equal bounds means none.
    double randomSizeMin = 1.0;
    double randomSizeMax = 1.0;

    /// One spawn's `random_size` roll, as a multiplier on the nominal size.
    ///
    /// The JSON range is an ABSOLUTE size rather than a factor, so the
    /// reference divides it by the config's own `size`: a cactus (size 1.5,
    /// random_size [1, 2]) comes out between 0.667x and 1.333x, not between 1x
    /// and 2x. Wild mobs and pets both roll it (src/mobs.ts getEnemySizeScale).
    double rollRandomSize(Rng& rng) const {
        if (!(randomSizeMax > randomSizeMin) || !(size > 0.0)) return randomSizeMin;
        return rng.range(randomSizeMin, randomSizeMax) / size;
    }
    /// The largest factor rollRandomSize() can return: what anything that has
    /// to stay clear of a body it has not rolled yet must allow for.
    double maxRandomSize() const {
        if (!(randomSizeMax > randomSizeMin) || !(size > 0.0)) return randomSizeMin;
        return randomSizeMax / size;
    }

    /// Escorts placed the moment the nest spawns, and the waves it sends
    /// afterwards. Both are already resolved to mob indices.
    std::vector<std::uint16_t> initialSpawns;
    std::vector<std::vector<std::uint16_t>> spawnWaves;

    ProjectileSpec projectile;
    PetalRingSpec petalRing;
    PeriodicSpawnSpec periodicSpawn;
    AmbushSpec ambush;
    DungeonSpec dungeon;
    LightningSpec lightning;
    WebSpec web;
    DropProjectileSpec dropProjectile;

    /// Poison the mob's touch applies. Stored per second, converted from the
    /// per-millisecond figure the JSON uses.
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;

    bool emissive = false;
    std::string lightColor;
    Rgba lightColorRgba = kOpaqueWhite;
    double lightRadius = 0;

    /// XP awarded per tier, from the mob's mandatory `xp` table in mobs.json.
    /// Common through unique are written there; apex is derived as 3x unique.
    /// One per ladder rung: no mob is universal.
    std::array<double, kLadderRarityCount> xp{};
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

    /// The artwork repainted from a tier up: every fill in `image` becomes
    /// `fill`, and every stroke the outline the client derives from it, so
    /// petals.json names one colour rather than a second drawing. Written
    /// `"rarityFills": {"super": "#8AFF69"}`; the highest entry at or below
    /// a petal's tier wins, and a tier below every entry keeps `image` as it
    /// is. Sorted ascending by `from` at load. Art only -- the server never
    /// reads it.
    struct RarityFill {
        Rarity from = Rarity::Common;
        std::string fill;
        Rgba fillRgba = kOpaqueWhite;
    };
    std::vector<RarityFill> rarityFills;

    double damage = 0;
    double health = 0;
    double size = 1;            ///< diameter in "size units"; see petalStats()
    /// Art only, exactly as MobConfig::visualScale is: it multiplies the drawn
    /// petal everywhere the world paints one, and never the `size` the
    /// simulation reaches, hits and orbits with.
    double visualScale = 1.0;
    double cooldownMillis = kDefaultPetalReloadMillis;   ///< reload after breaking
    int count = 1;              ///< petals spawned per equipped slot

    /// Stars for one at the COMMON tier -- shopPrice() in shop.h runs the
    /// rarity ladder up from here. Mandatory in petals.json; a generated
    /// `<mob>_egg`, which no file names, derives it from the mob's XP.
    double price = 0;

    bool isAdminPetal = false;
    /// Whether a trader NPC takes this petal for a coin. On unless petals.json
    /// says `"tradable": false` -- the basic petal, and the coin itself, which
    /// would otherwise trade for itself.
    bool tradable = true;

    PetalModifiers modifiers;

    /// Mirrors the web game's default: petals without an explicit knockback
    /// field still push for 5.  Zero is reserved for petals that opt out.
    double knockback = 5;
    ProjectileSpec projectile;
    double range = 0;           ///< reach for the petals that have one
    /// Armour this petal STRIPS from what it touches, before rarity. Only bur
    /// has one. Stated at the common tier like every other petal stat.
    double armorReduction = 0;
    /// Armour one of root's stacks absorbs, before rarity. A petal that
    /// states this is a root: the flower wearing it collects a stack every
    /// kArmorStackIntervalMillis and spends one to blunt each direct hit.
    ///
    /// Stated at the common tier and scaled on the DAMAGE ladder, for the
    /// reason Armor in components.h gives: both it and mob damage triple per
    /// tier, so one figure holds the same proportion at every matched tier
    /// instead of quietly becoming immunity or dead weight at the ends.
    double armorPerStack = 0;
    /// Armour this petal WEARS, before rarity: a flat amount off every hit the
    /// petal itself takes, exactly as a mob's `armor` comes off every hit the
    /// mob takes. Bone's "Sturdy". Stated at the common tier and scaled on
    /// kMobArmorScale, the ladder a mob's armour climbs.
    double petalArmor = 0;
    /// What a claw adds to its swing while the victim is still above
    /// kClawCritHealthFraction of its health, before rarity. A flat figure
    /// on the petal damage ladder, added to `damage` rather than replacing it.
    double clawCritDamage = 0;
    /// The fraction of the damage this petal actually deals that comes back
    /// to its flower as health. Fang's. Flat across the ladder: the damage it
    /// is a fraction OF already climbs it.
    double lifesteal = 0;
    /// What a worn cutter adds to the flower's BODY damage, before rarity.
    /// Scaled on the damage ladder, so it is stated at the common tier like
    /// every other damage figure. Not `damage` itself: nothing about this
    /// petal touches a mob, and putting it there would make every tooltip and
    /// drop call it a weapon.
    double bodyDamage = 0;
    std::uint8_t equipFlags = EquipNone;

    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;

    /// How long a hit from this petal stops the victim healing. gardn's
    /// dandelion, and nothing else: `dandy_ticks` is a flat ten seconds at
    /// every tier over there, so this is NOT on the rarity ladder -- an apex
    /// dandelion locks healing for exactly as long as a common one.
    double noHealDurationMillis = 0;

    double speed = 0;           ///< orbit speed for the petals that override it
    bool noPhysics = false;     ///< no body, no collision: a pure modifier
    bool defendOnly = false;    ///< only acts while the ring is pulled in
    bool clumped = false;       ///< a count > 1 spawns as one cluster
    /// A clump's grains are drawn pointing at the clump's centre rather than
    /// spinning in step with the rest of the ring. Only means anything for a
    /// clumped petal at a count above 1; the stinger's triangles are the case.
    bool clumpFacesInward = false;
    /// How far out from its clump's centre each grain sits in the world, as a
    /// multiple of the petal's own radius. World only: the item tile lays out
    /// its icon by its own rules. Oranges spread theirs well past the default
    /// because their artwork is drawn half again bigger than their body.
    double clumpSpacing = 1.0;
    /// The clump hangs off the ring instead of straddling it: its centre sits
    /// one clumpSpacing outside the orbit, so one grain rides the orbit itself
    /// and the rest fan out beyond it. World only, like clumpSpacing.
    bool clumpOutsideRing = false;
    bool independentHealth = false;  ///< each petal of a cluster breaks alone
    bool wallCollide = false;
    bool emissive = false;

    double burstHeal = 0;
    double burstHealChargeMillis = 0;
    double passiveHeal = 0;     ///< per second, before rarity
    /// The passive heal counts only while the flower is actually blocking:
    /// defend held and attack not. Yucca's rule. Unlike `defendOnly` it moves
    /// nothing on the ring -- the petal still lunges with the rest of it.
    bool passiveHealDefendOnly = false;
    double burstShield = 0;

    // --- mana ---------------------------------------------------------------
    //
    // The magic petals' own resource. A flower has no mana at all until
    // something it is wearing grants a pool, which is why every figure here
    // defaults to zero rather than to a base the game would have to subtract
    // back out: a bar with no orb and no magic flower on it is not a flower
    // with an empty pool, it is a flower with no pool.

    /// Mana this petal adds to the wearer's POOL while it is equipped, before
    /// rarity. Summed over the bar: two magic flowers are two pools' worth.
    double baseMaxMana = 0;
    /// Mana returned in one delivery, on the same charge-and-home path a rose
    /// heals on. Before rarity.
    double burstMana = 0;
    double burstManaChargeMillis = 0;
    /// Mana per second while equipped, before rarity. Summed over the bar.
    double passiveMana = 0;
    /// What bringing one of this petal onto the ring costs, before rarity.
    /// Paid on SPAWN -- the equip reload and every reload after a break alike
    /// -- never on use: a magic missile fires, and a magic bubble pops, for
    /// free once it is out. A petal whose reload has run out and cannot be
    /// paid for stays off the ring until the pool can cover it, then returns
    /// at once. Charged per grain, so a clump of four is four payments.
    double requiredMana = 0;
    /// Every hit this petal lands -- its body and its shots alike -- is
    /// lightning damage (DamageKind::Lightning), with no strike attached: the
    /// one victim touched, nothing chained. Blueberries.
    bool lightningDamage = false;

    /// Held at a fixed angle instead of orbiting. `has` distinguishes the
    /// petals pinned to 0 radians from the ones that simply orbit.
    bool hasFixedDirection = false;
    double fixedDirection = 0;

    /// Draw offset in the petal's own rotated frame. Both axes, because the
    /// reference translates by both after the rotation and a petal that
    /// declares only an X offset would otherwise be drawn on the ring centre.
    double visualOffsetX = 0;
    double visualOffsetY = 0;
    /// The petal is not drawn at all. Three entries express this in the JSON
    /// with a visualOffsetY of -1e100, which is a way of shoving the sprite
    /// off the world rather than a number anything should compute with.
    bool hidden = false;

    /// The `damageCooldown` key, or kPetalHitIntervalMillis (zero) when the
    /// petal declares none. Non-zero therefore means exactly what truthiness
    /// means in the reference: this petal is throttled, and per INSTANCE
    /// rather than per victim. Three of the seventy-four are.
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

    /// A shot of this petal WEAVES instead of flying straight: it is carried
    /// sideways about the bearing it was launched on, `waveFrequency` times a
    /// second, by `waveAmplitude` multiplied by the shot's OWN RADIUS. Zero
    /// amplitude is a straight shot, which is every petal but the wasp's
    /// missile.
    ///
    /// Stated against the shot's radius rather than in world units so that one
    /// number holds across the rarity ladder: an apex wasp's missile is four
    /// times the calibre of a common one and weaves four times as wide, which
    /// is the same picture at a different size. A figure in world units would
    /// read as a twitch at the top of the ladder.
    ///
    /// `waveFrequency` is the rate at the petal's STOCK calibre. A wavelength is
    /// speed over frequency, and the shape wants one proportional to the
    /// calibre: left to itself the frequency would hold the crossings where a
    /// common missile puts them while the amplitude grew past them, and the
    /// four-times-wider apex missile would buzz rather than draw the same curve
    /// larger. `ProjectileSpec::speed` is the same at every calibre, so the
    /// firing site divides this rate by the calibre to supply that growth.
    double waveAmplitude = 0;
    double waveFrequency = 0;

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
    /// Flat reduction applied to every direct hit this mob takes. Negative is
    /// legal and means the opposite -- see Armor in components.h.
    double armor = 0;
    double evasion = 0;         ///< dodge chance, 0..1; see Evasion in components.h
    double radius = 0;          ///< world units
    double mass = 1;            ///< gardn's 1 + radius / 25; see bodyMassForRadius
    double speed = 0;           ///< world units per second
    /// Speed used ONLY while pursuing a target. Ten mob types chase at exactly
    /// the flower's top speed so a fleeing player can never outrun them, but
    /// they still WANDER at their authored speed -- folding the override into
    /// `speed` makes an idle bee cross the screen. A slow scales `speed`, so a
    /// chase that bypasses it has to re-derive the same ratio.
    double chaseSpeed = 0;
    /// The stated bee cruise, world units per second; zero when the config
    /// states none. See MobConfig::cruiseSpeed.
    double cruiseSpeed = 0;
    bool playerSpeedChaser = false;
    double xp = 1;
    double aggroRange = 0;
    double attackCooldownMillis = 0;
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;
    double visualScale = 1.0;
    double spawnWeight = 1.0;
    /// Some mob behaviours change by rarity (for example rare bees become
    /// neutral/retaliatory). This is derived alongside the numeric stats.
    AiKind ai = AiKind::Neutral;

    /// Moves on gardn's inertial integrator at THIS tier: the config's
    /// `gardn_ai`, or any neutral mob that walks. gardn runs every neutral it
    /// has (tick_default_neutral) on that integrator, and a neutral published
    /// raw goes from its drift to full chase speed in one tick and pivots on
    /// the spot when it is provoked. Derived per tier because neutrality is:
    /// a rare bee is neutral and a common one is not. Chains are left out --
    /// the head tows the body and keeps its own walk.
    bool gardnMotion = false;

    /// True when an ambient group roll may produce this mob AT THIS TIER.
    ///
    /// False below `min_rarity`, which is how that rule is enforced everywhere
    /// at once: a spawner asks this and never has to know the rule exists.
    bool ambient = false;

    bool spawnable() const { return ambient; }
};

/// A petal at one tier.
struct PetalStats {
    double damage = 0;
    double health = 0;
    /// Body damage granted to the wearer, scaled for this tier.
    double bodyDamage = 0;
    /// Armour stripped from the victim per hit, scaled for this tier.
    double armorReduction = 0;
    /// What one of this petal's armour stacks absorbs, scaled for this tier.
    /// Zero for every petal but root, and what marks a slot as one that
    /// prints a stack count on the loadout bar.
    double armorPerStack = 0;
    /// Armour the petal itself wears, scaled for this tier on kMobArmorScale.
    double petalArmor = 0;
    /// A claw's bonus against a victim above kClawCritHealthFraction, scaled
    /// for this tier.
    double critDamage = 0;
    /// Fraction of dealt damage healed back to the flower; flat by tier.
    double lifesteal = 0;
    double reloadMillis = kDefaultPetalReloadMillis;
    double poisonPerSecond = 0;
    double poisonDurationMillis = 0;
    /// Flat across the ladder; see PetalConfig::noHealDurationMillis.
    double noHealDurationMillis = 0;
    double heal = 0;                    ///< burst heal per charge
    double healChargeMillis = 0;
    double passiveHealPerSecond = 0;
    /// Mana added to the wearer's pool while this petal is worn, this tier.
    double maxMana = 0;
    double mana = 0;                    ///< burst mana per charge
    double manaChargeMillis = 0;
    double passiveManaPerSecond = 0;
    /// What one spawn of this petal costs, this tier. See PetalConfig.
    double requiredMana = 0;
    double knockback = 0;
    double shield = 0;
    double slowFactor = 1.0;
    double slowDurationMillis = 0;
    double webRadius = 0;               ///< rarity-scaled field radius
    double spongeDamageDurationMillis = 0;
    double attractionForce = 0;
    double radius = 0;                  ///< world units
    /// The petal's `size` stat as authored. Several derived reaches are stated
    /// against it rather than against `radius` -- a projectile is half the
    /// firing petal's radius, a pollen puff is 6 x size, a wall resolve uses
    /// 20 x size -- and deriving them by dividing `radius` back out is how the
    /// two halved by the wrong scale went unnoticed.
    double size = 1;
    double visualScale = 1.0;           ///< art only; flat across rarities
    double damageIntervalMillis = kPetalHitIntervalMillis;
    int count = 1;
    bool breakable = true;
    double cameraZoom = 1.0;
    PetalModifiers modifiers;           ///< already scaled for this tier
};

/// The petal that splits its wearer in two, by id.
///
/// Named once here because three layers have to agree about it: the server's
/// splitter service, the client's loadout bar (which turns a click on the
/// slot into a UsePetal), and the tooltip that says so. The reference
/// identifies its special petals by id too -- see behaviourOf() in
/// server/systems/petals.cpp -- rather than by a flag in the JSON, because the
/// mechanic lives in code and a flag would only be a second place to forget.
inline constexpr const char* kSplitterPetalId = "splitter";

/// Whether this petal DOES something when its slot is clicked on the bar.
///
/// The browser build reaches the same action with a U+slot chord; this client
/// puts it on the tile itself, so the question "is this slot clickable" has to
/// be answerable on both ends of the wire -- the bar to know whether a click
/// is a use or the start of a drag, and the server to refuse a UsePetal that
/// names a slot holding an ordinary petal.
inline bool petalIsClickToUse(const PetalConfig& config) {
    return config.id == kSplitterPetalId;
}

/// The petal that is put down on the ground instead of carried, by id.
inline constexpr const char* kWaxPetalId = "wax";

/// The petal the rest of the ring orbits instead of the flower, by id.
inline constexpr const char* kMoonPetalId = "moon";

/// Whether this petal is a LOOSE BODY rather than a place on the ring.
///
/// A loose petal is spawned beside its flower and left there: it takes no
/// place on the ring, and is never sprung toward an orbit point or bent toward
/// a mob. Wax swings at nothing; the moon, which has damage, hits the mobs
/// pressed against it as a ring petal would (never flowers). It is a BODY -- flowers, mobs, NPCs and other
/// loose petals cannot pass through it, though like two mobs they can lean a
/// little way into it and are eased back out (kLoosePetalContactStiffness) --
/// and it gives way to whatever pushes it, by mass (kLoosePetalMass). Mobs
/// that touch it bite it, which is the only thing that wears its health down.
///
/// By id for the reason petalIsClickToUse is: the server, the wire and the
/// client's renderer all have to agree about it, and petals.json is shared
/// verbatim with the frozen browser build.
///
/// Wax and the moon are the two. Both grow 30 units a tier
/// (kLoosePetalRadiusPerTier).
inline bool petalIsLooseBody(const PetalConfig& config) {
    return config.id == kWaxPetalId || config.id == kMoonPetalId;
}

/// Whether this petal is the body its flower's RING orbits -- the moon.
///
/// A loose body (above) that the rest of the ring is laid out around in place
/// of the flower: every carried petal orbits it at the distance it would
/// orbit a flower that size, and a bubble popped on that ring throws it
/// rather than the flower. Worn petals (`noPhysics`) stay on the flower, and
/// a petal flying home to deliver a heal flies to the flower.
///
/// It does not stack: one flower has one moon however many are on the bar.
/// The highest tier among them is the one that comes out (the leftmost of
/// equals) and the others hold nothing (moonSlotOf).
inline bool petalAnchorsRing(const PetalConfig& config) { return config.id == kMoonPetalId; }

/// The petal that becomes whatever is equipped to its left, by id.
inline constexpr const char* kMimicPetalId = "mimic";

/// Whether this petal copies the slot to its left rather than being itself.
/// By id for the reason petalIsClickToUse is.
inline bool petalMimicsLeft(const PetalConfig& config) { return config.id == kMimicPetalId; }

// ---------------------------------------------------------------------------
// ContentRegistry
// ---------------------------------------------------------------------------

/// One mob group, as the mobs themselves define it.
///
/// Built by the loader out of every `groups` entry in mobs.json: the groups
/// are the union of the names used, in first-mention order, and a group's
/// members are the mobs that named it with the weight each gave.
struct MobGroup {
    std::string id;
    std::vector<MobGroupMember> members;
};

class ContentRegistry {
public:
    /// Loads `mobs.json` and `petals.json` from one directory, and folds the
    /// directory's maps -- `maps.json` and every map it names -- into
    /// contentHash(), so a client whose staged maps
    /// differ from the server's (a moved pad, a renamed door) is refused at
    /// the handshake rather than drawing annotations the server does not
    /// have. A directory with no manifest folds nothing.
    ///
    /// On failure `errorOut` says what went wrong and the registry keeps
    /// whatever it already held -- a bad hot reload must not leave a running
    /// server with no content.
    bool load(const std::string& dataDir, std::string& errorOut);

    /// The same, with both paths given explicitly and no maps folded in.
    ///
    /// Fails, rather than filling in a default, when an entry omits something
    /// mandatory: a mob's `xp` table or a petal's `price`. Both used to live
    /// outside these files -- XP in cpp/data/mob_xp.json, prices in a table in
    /// shop.h -- where an entry could simply be missing, and the fallback that
    /// covered for it (1 XP a tier, 10 stars) was indistinguishable from a
    /// number somebody chose.
    bool loadFiles(const std::string& mobsPath, const std::string& petalsPath,
                   std::string& errorOut);

    /// An out-of-range index yields a shared placeholder rather than undefined
    /// behaviour: these indices arrive from the wire, and a corrupt one must
    /// cost a wrong-looking mob, not the process.
    const MobConfig& mob(std::uint16_t index) const;
    const PetalConfig& petal(std::uint16_t index) const;

    std::uint16_t mobIndex(const std::string& id) const;
    std::uint16_t petalIndex(const std::string& id) const;

    std::size_t mobCount() const { return mobs_.size(); }
    std::size_t petalCount() const { return petals_.size(); }

    /// Every petal index in CATALOGUE order: petals.json's own key order, then
    /// the generated eggs in mobs.json's order. This is what the browser's
    /// `Object.keys(PETAL_CONFIG)` yields, and what any surface that lists
    /// petals must walk -- the indices themselves are sorted so that the wire
    /// stays stable, which is a different order and the wrong one to paint.
    const std::vector<std::uint16_t>& petalDisplayOrder() const { return petalOrder_; }

    /// FNV-1a folded over the raw bytes of every file loaded, in a fixed
    /// order. Compared in the connect handshake.
    std::uint32_t contentHash() const { return hash_; }

    /// Everything the loader had to repair, one line each. Empty on clean
    /// data; the shipped data is not clean.
    const std::vector<std::string>& warnings() const { return warnings_; }

    bool loaded() const { return !mobs_.empty(); }

    MobStats mobStats(std::uint16_t index, Rarity r) const;
    PetalStats petalStats(std::uint16_t index, Rarity r) const;

    /// The mob groups, in first-mention order. A map's spawn band names one of
    /// these, or a mob id; the group is looked up first, so a group and a mob
    /// sharing a name resolves to the group.
    const std::vector<MobGroup>& mobGroups() const { return mobGroups_; }
    std::size_t mobGroupCount() const { return mobGroups_.size(); }

    /// What this petal becomes in the hands of a flower wearing a magic orb,
    /// or kInvalidIndex for a petal with no magic form.
    ///
    /// Derived from the ids at load rather than authored anywhere: a petal
    /// called `magic_X` is the magic form of `X`. The one pairing the ids
    /// cannot state is the orb itself, which is what a ROSE becomes -- the two
    /// are the same petal on two different resources, a burst that charges in
    /// orbit and flies home, healing in one case and refilling the pool in the
    /// other. Adding a `magic_X` to petals.json is therefore all it takes to
    /// make X convert.
    std::uint16_t magicFormOf(std::uint16_t index) const {
        return index < magicForm_.size() ? magicForm_[index] : kInvalidIndex;
    }

    /// Whether this petal is some other petal's magic form -- a petal that is
    /// only ever OBTAINED by converting one, never dropped on its own.
    bool isMagicForm(std::uint16_t index) const {
        return index < magicSource_.size() && magicSource_[index] != kInvalidIndex;
    }

    /// The ordinary petal this one is the magic form OF, or kInvalidIndex.
    /// The inverse of magicFormOf(), and what lets a surface that has measured
    /// the ordinary petal reuse the measurement: a magic petal is the same
    /// picture in another colour, down to the viewBox.
    std::uint16_t magicSourceOf(std::uint16_t index) const {
        return index < magicSource_.size() ? magicSource_[index] : kInvalidIndex;
    }

    /// The group `id` names, or kInvalidIndex.
    std::uint16_t mobGroupIndex(const std::string& id) const;

    /// An out-of-range index yields a shared empty group, for the same reason
    /// mob() yields a placeholder: these indices come out of map files.
    const MobGroup& mobGroup(std::uint16_t index) const;

private:
    std::vector<MobConfig> mobs_;
    std::vector<MobGroup> mobGroups_;
    std::unordered_map<std::string, std::uint16_t> mobGroupIds_;
    std::vector<PetalConfig> petals_;
    std::unordered_map<std::string, std::uint16_t> mobIds_;
    std::unordered_map<std::string, std::uint16_t> petalIds_;
    std::vector<std::uint16_t> petalOrder_;
    /// Petal index -> its magic form, or kInvalidIndex. See magicFormOf().
    std::vector<std::uint16_t> magicForm_;
    /// The reverse: a magic petal -> the ordinary one it is the form of.
    std::vector<std::uint16_t> magicSource_;
    std::vector<std::string> warnings_;
    std::uint32_t hash_ = 0;

    /// The maps half of load(): see there.
    void foldMapsIntoHash(const std::string& dataDir);
};

/// The camera multiplier one worn petal asks for at `rarity`: below 1 pulls
/// the camera out, 1 leaves it alone. Ordinary zoom petals keep the browser's
/// 0.3 floor, so no tier can take the figure through zero and invert the
/// camera; antennae's explicit vision-range table reaches 10x (0.1) and is
/// exempt from it.
///
/// Shared because both sides have to agree about it. The client draws the
/// world this far out, and the server lets the client claim a viewport this
/// much bigger than the default one -- and streams, and wakes the spawn bands
/// for, exactly that much world. If the server has a different idea from the
/// client, it culls mobs the client is drawing.
double petalCameraZoom(const ContentRegistry& registry, std::uint16_t petalIndex, Rarity rarity);

/// What one bar slot actually equips: the petal it puts on the field, the tier
/// it is that petal at, and the tier whose reload it pays.
///
/// For every petal but the mimic this is the slot itself, all three straight
/// off it. A mimic is the petal to its LEFT at the mimic's own tier, reloading
/// on the left slot's reload -- so a legendary mimic beside a common rose is a
/// legendary rose that comes back as often as the common one does. A mimic
/// with nothing to its left (the row's first slot, or an empty neighbour) is
/// just a mimic.
struct EquippedPetal {
    std::uint16_t configIndex = kNoPetal;
    Rarity rarity = Rarity::Common;
    Rarity reloadRarity = Rarity::Common;

    bool empty() const { return configIndex == kNoPetal; }
};

/// Resolves slot `slot` of a bar. `slotAt(i)` returns slot i AS STORED -- its
/// petal index (kNoPetal for empty) and rarity, `reloadRarity` ignored -- or an
/// empty one for an index the bar does not have.
///
/// A template over the accessor because the server's Loadout and the client's
/// Profile hold the bar in two different shapes, and the rule must be one rule
/// on both: the server spawns and reloads by it, the client sweeps the slot's
/// reload wedge by it.
///
/// A run of mimics copies through: each is the first non-mimic to its left, at
/// its own tier, on that petal's reload. A run that reaches an empty slot or the
/// row's edge copies its leftmost mimic, which is itself. Bounded by the row,
/// so a mimic in the first column never reaches back into the row above it.
template <class SlotAt>
EquippedPetal resolveEquippedPetal(const ContentRegistry& registry, int slot, SlotAt&& slotAt) {
    EquippedPetal self = slotAt(slot);
    self.reloadRarity = self.rarity;
    if (self.empty() || !petalMimicsLeft(registry.petal(self.configIndex))) return self;
    const int rowStart = slot - slot % kLoadoutActiveSlots;
    EquippedPetal source = self;
    for (int i = slot - 1; i >= rowStart; --i) {
        const EquippedPetal left = slotAt(i);
        if (left.empty()) break;
        source = left;
        if (!petalMimicsLeft(registry.petal(left.configIndex))) break;
    }
    return EquippedPetal{source.configIndex, self.rarity, source.rarity};
}

/// Slot `slot` of a flower's `loadout` as it is actually equipped. Every gameplay
/// read of the bar goes through this, so a mimic is the petal it copies to the
/// ring, the modifiers, the auras and the camera alike.
inline EquippedPetal equippedPetal(const ContentRegistry& registry, const Loadout& loadout,
                                   int slot) {
    return resolveEquippedPetal(registry, slot, [&](int i) {
        if (i < 0 || i >= kLoadoutSlots) return EquippedPetal{};
        const LoadoutSlot& at = loadout.slots[static_cast<std::size_t>(i)];
        return EquippedPetal{at.configIndex, at.rarity, at.rarity};
    });
}

/// The stats a resolved slot fields: the petal's at its tier, with the reload
/// taken from the tier it pays (resolveEquippedPetal).
inline PetalStats equippedPetalStats(const ContentRegistry& registry, const EquippedPetal& petal) {
    PetalStats stats = registry.petalStats(petal.configIndex, petal.rarity);
    if (petal.reloadRarity != petal.rarity) {
        stats.reloadMillis = registry.petalStats(petal.configIndex, petal.reloadRarity).reloadMillis;
    }
    return stats;
}

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

} // namespace flix
