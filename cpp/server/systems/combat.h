#pragma once
// Combat: every path in the game that removes health, and the death that
// follows.
//
// The whole point of this file is that there is exactly ONE function that
// writes Health::current -- applyDamage(). Invulnerability, the same-team
// refusal, the hurt flash, the contribution ledger, the damage event and the
// transition to Dead are consequences of a hit, and a consequence that lives
// in only one place cannot be forgotten by the next damage source somebody
// adds. No other system may touch Health::current; it should reach for
// applyDamage instead.
//
// STRUCTURAL TRAP: applyDamage() adds the Dead tag, which relocates the victim
// between archetypes and invalidates every column pointer a Query::each is
// holding. It must therefore never be called from inside each(). Every pass
// below is written as gather-then-apply for exactly this reason, and any
// system that wants to deal damage must do the same.

#include <cstdint>
#include <memory>
#include <vector>

#include "server/replication.h"
#include "server/squads.h"
#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"
#include "shared/game/spatial.h"

namespace flix {

/// How long a hit keeps the client's white flash lit. Short: it reads as an
/// impact rather than a status, and it is refreshed by every landed hit, so a
/// sustained beating stays lit without anything having to track that.
inline constexpr double kHurtFlashMillis = 120.0;

/// How far one duellist's swing shoves the other flower, in world units,
/// delivered as momentum (see shoveSpeed). Not mass-scaled.
inline constexpr double kMobContactKnockback = 25.0;

/// gardn's flower-off-mob bounce (Collision.cc _cancel_movement), in units a
/// second added to the flower's velocity: a kick of PLAYER_ACCELERATION plus
/// twice the closing speed, the closing speed floored at half an acceleration
/// and capped at twenty-five. gardn's figures are per 20 Hz tick; the kick and
/// the floor land on EVERY tick the pair overlaps, so they are restated for
/// this server's 30 to push as hard per second. The reflection is a one-off
/// -- once it lands the pair is parting -- and is not rescaled.
inline constexpr double kGardnBounceKick = 5.0 * 20.0 * (20.0 / 30.0);
inline constexpr double kGardnBounceMinClosing = 2.5 * 20.0 * (20.0 / 30.0);
inline constexpr double kGardnBounceMaxClosing = 125.0 * 20.0;

/// What a gardn-motion mob (MobStats::gardnMotion) is knocked back by when its
/// body touches a flower, units a second added to its carried velocity,
/// before the mass split below.
///
/// gardn's _deal_knockback puts 20 units a tick into the mob's velocity and 10
/// more into its collision push, which under its 1/3 friction carries the mob
/// 60 units per unit of mass share. A kick of this size decays through
/// gardnStep() over the same 60. The mob takes the flower's share of the
/// pair's mass (Body::mass against the flower's 1): a common ladybug 0.31 of
/// it, a mythic one 0.13. The flower's half of the touch is the bounce above.
inline constexpr double kGardnContactRecoil = 560.0;

/// How long a petal waits between swings at the SAME flower.
///
/// Against a mob an ordinary petal is not throttled at all; against a duellist
/// it is, and per victim rather than per petal, so one petal can reach two
/// flowers in a tick but neither of them twice. A petal that declares its own
/// `damageCooldown` uses that instead.
inline constexpr double kPvpPetalHitIntervalMillis = 250.0;

/// What a swing at another flower costs the petal: a flat point, never the
/// victim's damage stat. A flower's body damage would shatter a common ring on
/// the first hit, which is why the reference charges a fixed number here and
/// the mob's own damage against a mob.
inline constexpr double kPvpPetalSelfDamage = 1.0;

/// How long a ground effect's slow outlives standing in it. Refreshed every
/// tick while inside, so this is only the tail after walking out -- long
/// enough that the debuff does not strobe at the boundary, short enough that
/// escaping a web means something.
inline constexpr double kGroundEffectSlowLingerMillis = 250.0;
inline constexpr double kPostHitInvulnerabilityMillis = 50.0;
/// A shield's exponential time constant (gardn's 15 s): left alone it keeps
/// about 37% of itself after this long. Below kShieldDropBelow it is gone.
inline constexpr double kShieldDecaySeconds = 15.0;
inline constexpr double kShieldDropBelow = 0.5;

/// How long a bur's armour strip lasts after the last hit that refreshed it.
///
/// Long enough to survive a reload -- a bur's own cooldown is 2000 ms, and a
/// debuff that lapsed inside that would be a petal that never has its effect
/// up when the rest of the ring lands -- and short enough that a boss somebody
/// grazed and walked away from is whole again by the time it is found.
inline constexpr double kArmorShredMillis = 5000.0;

/// Slack added to every broadphase query, in world units.
///
/// The exact circle test decides what was hit. This slack also covers bodies
/// whose own radius is not represented in a point-centred field query and
/// protects focused tests that intentionally build a minimal broadphase.
inline constexpr double kBroadphasePad = 24.0;

/// What paces a lightning strike when neither the strike nor the mob carrying
/// it states a gap.
///
/// A firefly ships `cooldown: 0` -- it has no volley and no attack cadence to
/// state -- and an unpaced contact strike would fire on all thirty ticks a
/// flower spends walking through one, which is thirty shocks a second.
inline constexpr double kDefaultLightningCooldownMillis = 1000.0;

/// Ticks between HitCooldowns sweeps. The entries are only a correctness
/// concern while they are in the future; the sweep exists so a petal that has
/// grazed ten thousand mobs is not still carrying all ten thousand.
inline constexpr int kCooldownPruneTicks = 50;

/// Depth limit when resolving a petal/pet/projectile back to the player behind
/// it. A cycle in the owner links would otherwise hang the tick, and this is
/// a wire-fed graph -- it is not allowed to be able to.
inline constexpr int kMaxOwnerHops = 8;

/// Why damage is being applied, which decides how the client hears about it.
///
/// The reference narrates damage on exactly two channels -- `enemiesDamaged`
/// for mobs, `playerDamaged` for flowers -- and both carry a number for a
/// poison tick and for a sponge repayment exactly as they do for a petal hit.
/// What the kind actually decides is the white flash, which is also the signal
/// a neutral mob retaliates on, and the colour the number is drawn in.
enum class DamageKind : std::uint8_t {
    Direct = 0,     ///< a landed hit: flashes, and so provokes a neutral mob
    Periodic = 1,   ///< a drip, reported in the ordinary colour
    Poison = 2,     ///< a drip the client tints purple and offsets sideways
    /// A lightning strike. A landed hit in every respect that the simulation
    /// can see -- it flashes, it provokes, a shell absorbs it and it grants the
    /// post-hit window -- and differs from Direct in exactly one place: the
    /// floating number is cyan. Hence isDirectHit() rather than a widening
    /// `!= Periodic && != Poison` test at each of applyDamage's branches.
    Lightning = 3,
    /// What a petal pays for a hit it landed: the struck mob's body damage,
    /// billed back to the petal. Silent like a drip -- the reference charges
    /// it without flashing the ring -- but a discrete blow as far as ARMOUR is
    /// concerned, which is the whole of bone: its armour is there to blunt
    /// exactly this.
    Recoil = 4,
    /// The share of a hit a salt deals back to whoever landed it. Flashes like
    /// the hit it answers, but is no hit of its own: nothing dodges, blunts or
    /// soaks it, and above all nothing reflects it -- two salted duellists
    /// would otherwise bounce one blow between them until it rounded to zero.
    Reflect = 5,
};

/// Whether this kind is a landed hit rather than a drip. Everything in
/// applyDamage that used to ask `kind == Direct` asks this.
inline constexpr bool isDirectHit(DamageKind kind) {
    return kind == DamageKind::Direct || kind == DamageKind::Lightning;
}

/// Whether the victim's Armor comes off this kind. Every landed hit, and the
/// recoil a petal pays for one; never a drip, where a flat subtraction from
/// each sliver would be immunity rather than a tax.
inline constexpr bool armorBlunts(DamageKind kind) {
    return isDirectHit(kind) || kind == DamageKind::Recoil;
}

struct DamageResult {
    double applied = 0;      ///< health actually removed, after clamping to what was left
    bool killed = false;     ///< this application is the one that marked Dead
    bool refused = false;    ///< nothing happened: invulnerable, same side, already dead
    /// The victim's evasion roll made this hit miss. Not a refusal: the swing
    /// was legitimate and spends whatever pacing a landed one would, but it
    /// touched nothing, so a caller lands none of its riders on the victim.
    bool dodged = false;
};

class CombatSystem {
public:
    CombatSystem();
    ~CombatSystem();
    CombatSystem(const CombatSystem&) = delete;
    CombatSystem& operator=(const CombatSystem&) = delete;

    /// Who ranks together when a mob's XP is shared out. Null means nobody is
    /// squadded, which is the ordinary case; the loot system reads the same
    /// table so the two payouts cannot disagree about who earned the kill.
    const SquadEntityIndex* squads = nullptr;

    /// One complete combat tick. Kept for focused simulations; GameServer uses
    /// the three phase methods below so flower/petal contact can happen before
    /// mob movement while projectiles and ground effects happen after it.
    void run(World& world, const SpatialGrid& grid, const ContentRegistry& content,
             double nowMillis, double dt, CommandBuffer& commands, EventQueue& events);

    /// Opens a combat tick and applies poison/status expiry. Call exactly once.
    void beginTick(World& world, double nowMillis, double dt, EventQueue& events);

    /// Resolves body and petal contact from the pre-mob-movement world, which
    /// is where the TypeScript player pipeline performs those collisions.
    void runContactPhase(World& world, const SpatialGrid& grid,
                         const ContentRegistry& content, double nowMillis);

    /// Resolves post-movement projectiles/ground fields and closes the tick.
    void runWorldPhase(World& world, const SpatialGrid& grid,
                       const ContentRegistry& content, double nowMillis, double dt);

    /// The single damage path. Returns what actually landed.
    ///
    /// `source` is whatever dealt the hit -- a mob, a petal, a projectile, a
    /// ground effect -- not necessarily a player; the player to credit is
    /// resolved from it. NULL_ENTITY is a legitimate source and means the
    /// environment, which no faction rule protects anyone from.
    ///
    /// Not const-safe against iteration: see the structural trap above.
    DamageResult applyDamage(World& world, Entity victim, Entity source, double amount,
                             double nowMillis, DamageKind kind = DamageKind::Direct);

    /// One lightning strike thrown BY A MOB: every flower whose centre is
    /// inside `radius` of `at` takes `damage` as DamageKind::Lightning, and the
    /// client is sent the arms to draw.
    ///
    /// Damage lands here and now rather than through the one-tick damage field
    /// a petal's strike leaves behind. Two reasons. The field pass runs after
    /// the contact pass, so a firefly's touch and the shock it triggers would
    /// arrive in the same tick with the shock second -- and the touch's own
    /// 50 ms window would swallow it, which is a firefly that never shocks
    /// anybody. And a field damages mobs; making it damage flowers instead
    /// would mean a second victim rule inside a loop that already carries one.
    ///
    /// Public because it is a weapon, and tests fire weapons directly.
    void strikeLightning(World& world, const SpatialGrid& grid, Entity source, Vec2 at,
                         Realm realm, double radius, double damage, double nowMillis);

    /// Queue the TypeScript petal/projectile mob push: direction times
    /// `strength / victimMass`. This REPLACES a prior queued push, matching
    /// `setMobKnockback()` rather than accumulating momentum.
    void applyKnockback(World& world, Entity victim, Vec2 offset, double strength);

    /// The momentum a shot transfers into a MOB it hits, committed straight to
    /// the victim's position.
    ///
    /// Flowers are excluded: a shot moves them through applyKnockback, which
    /// movement drains. A mob takes this INSTEAD of a queued knockback, so the
    /// momentum is the whole of the shove and is not replaced by the next hit.
    void pushFromImpact(World& world, Entity victim, Vec2 offset, double shotMass,
                        double shotSpeed);

    /// A mob holds one poison stack per poisoning PLAYER and every one of them
    /// ticks, so two flowers biting the same boss deal both their rates and
    /// each is credited its own share. A refresh from a source that already
    /// holds a stack takes over only when it would OUTLAST the live one, and
    /// then it replaces the RATE as well -- a weaker but longer bite dilutes,
    /// and a shorter one is ignored however strong it is.
    ///
    /// A flower is different on purpose: it carries exactly one bite, replaced
    /// outright by the next one even when that shortens it.
    void applyPoison(World& world, Entity victim, Entity source, double perSecond,
                     double durationMillis, double nowMillis);

    /// A slow never weakens while it is live: the deeper factor wins and the
    /// expiry never comes closer, so a common petal grazing a mob cannot wipe
    /// the mythic stall already on it.
    ///
    /// Only a MOB can be slowed. applyMobSlow() is the reference's single slow
    /// implementation -- the petal bridge and the web field both resolve to it
    /// -- and it opens by refusing anything that is not a mob, so no web, honey
    /// petal or pincer has ever taken a flower's speed away. A MOB's web is the
    /// exception, and reaches a flower through slowFlower() below instead.
    void applySlow(World& world, Entity victim, double factor, double durationMillis,
                   Rarity sourceRarity, double nowMillis);

    /// The one slow a FLOWER takes: a mob's web (GroundEffect::slowsFlowers).
    /// Same deepest-wins, never-shortened rule as applySlow(), written to
    /// Afflictions::webbedFactor -- the field player movement reads -- and
    /// refused for anything that is not a flower, which applySlow() covers.
    void slowFlower(World& world, Entity victim, double factor, double durationMillis,
                    double nowMillis);

    /// A bur strips `amount` of armour off `victim` for kArmorShredMillis.
    ///
    /// The DEEPEST live strip wins and its expiry never comes closer, the rule
    /// applySlow() already runs on: a ring of five burs is one debuff at the
    /// strength of one of them, not five, and the common bur a second player
    /// happens to be carrying cannot wipe the mythic strip already on the mob.
    ///
    /// Only a mob can be stripped -- a flower has no armour to take.
    void applyArmorShred(World& world, Entity victim, double amount, double nowMillis);

    /// A dandelion's lockout: `victim` heals from nothing for `durationMillis`.
    ///
    /// The LONGEST live lockout wins and the expiry never comes closer -- the
    /// rule applySlow() and applyArmorShred() already run on -- so a ring of
    /// five dandelions is one ten-second lockout rather than five, and the
    /// common dandelion a second player happens to be carrying cannot cut the
    /// one already running short.
    ///
    /// Flowers AND mobs, unlike the slow above: gardn keeps `dandy_ticks` on
    /// the entity rather than on the flower, and a lifesteal leech that could
    /// not be stopped from healing is the whole point of the petal.
    void applyNoHeal(World& world, Entity victim, double durationMillis, double nowMillis);

    /// Whether `entity` may be healed at all right now.
    ///
    /// Static and public because every healing path in the game has to ask,
    /// and most of them live in the petal system rather than here. One
    /// function so that a new heal cannot quietly become the one the lockout
    /// does not cover.
    static bool healingBlocked(const World& world, Entity entity, double nowMillis);

    /// What `victim` actually subtracts from a direct hit right now: its armour
    /// less whatever a bur has stripped. Negative means the strip out-ran the
    /// armour and the victim takes EXTRA, which is bur's whole purpose.
    static double effectiveArmor(const World& world, Entity victim, double nowMillis);

    /// The chance, 0..1, that a direct hit on `victim` misses: a mob's Evasion,
    /// or what a flower's worn talismans add up to.
    static double evasionOf(const World& world, Entity victim);

    /// Who a salt on `victim` pays back for a hit from `source`: gardn's
    /// `base_entity` -- the mob behind a shot, the flower behind a petal, the
    /// owner behind a pet. NULL_ENTITY when that is nobody who can be hurt: the
    /// environment, or a shot whose mob is already gone.
    static Entity reflectionTarget(const World& world, Entity source);

    /// The PLAYER answerable for what `source` does: through Projectile::
    /// creditTo, Pet::owner, PetalInstance::owner and GroundEffect::owner,
    /// transitively. NULL_ENTITY when nothing player-owned is behind it, which
    /// is the normal answer for a wild mob.
    static Entity creditedPlayer(const World& world, Entity source);

    /// Whether `source` is allowed to hurt `victim` at all: different sides,
    /// or the same side with friendly fire on. Two things resolving to the
    /// same player never hurt each other, which is what stops a flower's own
    /// petals and pets from killing it the moment PvP is enabled.
    static bool canDamage(const World& world, Entity source, Entity victim);

    /// canDamage() plus the victim's own state: alive, not already Dead, and
    /// past its respawn invulnerability. Shared with the contact path so that
    /// a refused hit consumes no cooldown and lands no poison either.
    static bool canHit(const World& world, Entity victim, Entity source, double nowMillis);

    /// Deaths marked during the last run(), oldest first. The loot system
    /// reads the ledger off the corpse itself (Bounty survives until the
    /// reaper runs at the end of the tick); this is for the server and for
    /// tests that want the list without a query.
    struct DeathRecord {
        Entity entity = NULL_ENTITY;
        Entity killer = NULL_ENTITY;
        bool wasPlayer = false;
    };
    const std::vector<DeathRecord>& deaths() const { return deaths_; }

    /// Kills a mob nothing struck -- a dungeon's nest, on the tick its last
    /// dweller dies -- exactly as a killing blow would: marked Dead for
    /// `killer`, recorded in deaths() and paid off its ledger (XP now, drops
    /// in the loot pass). No-op on anything already dead.
    void fell(World& world, Entity victim, Entity killer);

private:
    /// A touching body about to be tested against everything near it. Mob
    /// bodies, flower bodies and petals all reduce to this, so there is one
    /// overlap-and-cooldown loop rather than three that drift apart.
    struct MeleeSource {
        Entity attacker = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double damage = 0;
        double hitIntervalMillis = kMobHitIntervalMillis;
        double knockback = 0;
        double poisonPerSecond = 0;
        double poisonDurationMillis = 0;
        double slowFactor = 1.0;
        double slowDurationMillis = 0;
        /// How long a hit from this body stops the victim healing. Dandelion,
        /// and nothing else.
        double noHealDurationMillis = 0;
        /// Armour this body strips on contact. Bur, and nothing else.
        double armorReduction = 0;
        /// Added to `damage` while the victim is above kClawCritHealthFraction.
        /// Claw, and nothing else; already on the flower's petal curve.
        double critDamage = 0;
        /// Fraction of what a hit actually took off that heals `owner`. Fang.
        double lifesteal = 0;
        /// The flower a petal belongs to -- who a fang heals. NULL_ENTITY for
        /// every body that is not a petal.
        Entity owner = NULL_ENTITY;
        Rarity rarity = Rarity::Common;
        /// What kind of body this is, decided once in the gather rather than
        /// re-derived per candidate. The throttle, the reciprocal petal bleed,
        /// the pet/wild contact gap and the one-mob-per-tick body rule all key
        /// off these.
        bool isPetal = false;
        /// A petal that is a body on the ground -- the moon -- rather than a
        /// place on the ring. It hits mobs as a ring petal does, but leaves
        /// flowers alone, meets mobs with the slack a loose victim gets, and
        /// pays no recoil: mobs already bite it on their own contact clock.
        bool isLoose = false;
        bool isMobBody = false;
        /// A seat on a mob's own ring (MobRingPetal). Neither a mob nor a
        /// petal: a piece of the animal's body that happens to be breakable,
        /// so it bumps and is paced exactly as the hull is.
        bool isMobRing = false;
        /// An NPC off the players' side (only those carry ContactDamage). It
        /// bumps and bites a flower exactly as a mob body does, but it is not
        /// a MobTag, so it never takes the pet/wild contact gap.
        bool isNpcBody = false;
        bool isPet = false;
        bool isPlayerBody = false;
        /// A wild `gardn_ai` mob body: touching a flower knocks it back as
        /// well as the flower (see kGardnContactRecoil). Resolved from the
        /// config in the gather.
        bool gardnRecoil = false;
        /// A glitch-family mob body: its touch marks the flower (see
        /// markGlitched). Resolved from the config in the gather, where the
        /// registry is at hand.
        bool glitchInfecting = false;
        /// What this body's hit is multiplied by against a shot or a petal.
        /// A plank's 20; 1 for everything else.
        double shotDamageScale = 1.0;
        /// A mob whose touch throws lightning -- both fireflies. Zero radius
        /// means it does not, which is every other body in the game. Resolved
        /// in the gather beside the glitch flag and for the same reason.
        ///
        /// This is the CONTACT trigger only. A mob that strikes at RANGE is
        /// gathered separately (see LightningSource): it needs no collision,
        /// and hanging it off a melee source would mean a jellyfish could only
        /// shock a flower it was already touching.
        double lightningRadius = 0;
        double lightningDamage = 0;
        double lightningCooldownMillis = 0;
        /// How this body's own hit is reported. Lightning for a petal whose
        /// config says `lightningDamage` (blueberries), Direct for the rest.
        /// Unrelated to the strike above: this is the one victim touched.
        DamageKind hitKind = DamageKind::Direct;
        /// The space the body is in; the broadphase is asked about this one.
        Realm realm = Realm::Overworld;
    };

    /// A flower's raindrop field, resolved once per tick.
    ///
    /// Raindrop is not an orbiting petal that happens to hurt: it projects a
    /// damaging circle from the flower itself, so it has no petal entity to
    /// hang a MeleeSource on and its own reach rather than the ring's.
    struct AuraSource {
        Entity player = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double damage = 0;
        Realm realm = Realm::Overworld;
    };

    /// A mob that shocks whatever comes near it, resolved once per tick.
    ///
    /// Gathered rather than struck in place for the usual reason every pass
    /// here is split in two: a strike marks flowers Dead, which relocates rows,
    /// and the walk that found the strikers would be walking those rows.
    struct LightningSource {
        Entity mob = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double damage = 0;
        /// How close a flower has to come. Always at least `radius` in
        /// practice; the two are separate numbers in the config.
        double strikeRange = 0;
        double cooldownMillis = 0;
        Realm realm = Realm::Overworld;
    };

    struct FieldSource {
        Entity effect = NULL_ENTITY;
        GroundEffectKind kind = GroundEffectKind::Poison;
        /// How the field's discrete chip is REPORTED. Direct for a pollen puff,
        /// Lightning for the one-tick burst a strike leaves behind, which is
        /// what paints its number cyan. Read off the effect in the gather so
        /// the resolve never has to ask the world what a field is.
        DamageKind hitKind = DamageKind::Direct;
        Vec2 position;
        double radius = 0;
        double damagePerSecond = 0;
        double slowFactor = 1.0;
        Rarity rarity = Rarity::Common;
        double damagePerHit = 0;
        double damageIntervalMillis = 0;
        Realm realm = Realm::Overworld;
        bool slowsFlowers = false;
    };

    struct ShotSource {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        /// Where the shot was before this tick's movement. `position` is the
        /// head of the segment it flew and this is the tail; the overlap test
        /// is against the whole segment, so a shot faster than its own reach
        /// cannot step over a body between one tick and the next.
        Vec2 from;
        double radius = 0;
        double travelled = 0;
        /// Momentum, for the shove a hit delivers and the recoil it repays.
        double mass = 1;
        double speed = 0;
        Realm realm = Realm::Overworld;
    };

    /// One body a shot is overlapping this tick, resolved BEFORE any damage is
    /// dealt.
    ///
    /// A penetrating shot hits several bodies in one pass, and applyDamage()
    /// can mark any of them Dead -- which relocates its row and invalidates
    /// every Transform/Body pointer the broadphase handed out. Copying the two
    /// numbers each impact needs is what lets the hit loop run to the end.
    struct ShotImpact {
        Entity victim = NULL_ENTITY;
        Vec2 offset;
        double distanceSquared = 0;
    };

    struct PoisonTick {
        Entity victim = NULL_ENTITY;
        Entity source = NULL_ENTITY;
        double amount = 0;
    };

    struct Queries;

    /// Queries cache the archetypes they match, so they are built once and
    /// reused. The world is not known until the first run(), and a test may
    /// hand over a different one, hence the rebind rather than a member.
    void bind(World& world);

    void tickAfflictions(World& world, double nowMillis, double dt);
    void tickSpongeDamage(World& world, double nowMillis, double dt);
    /// Every shield shrinks by the same share of itself each second.
    void tickShieldDecay(World& world, double dt);
    /// Takes the registry because a pollen puff reaches for the victim's
    /// CONFIG radius rather than the body it actually spawned with.
    void tickGroundEffects(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                           double nowMillis, double dt);
    /// The strongest equipped raindrop on every live flower, and the mobs its
    /// field chips. Split in two for the usual reason: resolving a hit can
    /// mark a mob Dead, which relocates the row the gather is walking.
    void gatherAuras(World& world, const ContentRegistry& content);
    void resolveAuras(World& world, const SpatialGrid& grid, double nowMillis);
    void gatherContact(World& world, const ContentRegistry& content);
    /// One pass of lightning at RANGE: which mobs are charged and have somebody
    /// in reach, and the strikes they throw. Runs in the world phase, after
    /// movement. The CONTACT trigger is not here -- it fires inside
    /// resolveMelee, where the collision it needs has just been resolved.
    void tickMobLightning(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                          double nowMillis);
    /// The two halves of it. Split for the reason the header of LightningSource
    /// gives.
    void gatherMobLightning(World& world, const ContentRegistry& content);
    void resolveMobLightning(World& world, const SpatialGrid& grid, double nowMillis);
    /// Whether any flower this mob could actually hurt is inside `range`. The
    /// trigger for a strike at range, kept apart from the strike itself so a
    /// mob with nobody near it costs one broadphase query and no bolt.
    bool playerWithin(World& world, const SpatialGrid& grid, Entity mob, Vec2 at, Realm realm,
                      double range, double nowMillis);
    void gatherPetals(World& world, const ContentRegistry& content, double nowMillis);
    void resolveMelee(World& world, const SpatialGrid& grid, double nowMillis);
    /// A petal swinging at another flower, which is a different collision from
    /// the petal-vs-mob one beside it: gated by the arena/corruption rule
    /// rather than by the faction alone, throttled per victim, costing the
    /// petal a flat point, and shoving the victim away from the FLOWER rather
    /// than away from the petal. It carries neither poison nor slow.
    void resolvePetalPvp(World& world, const MeleeSource& source, Entity victim,
                         Vec2 victimPosition, double victimRadius, double nowMillis);
    void tickProjectiles(World& world, const SpatialGrid& grid, const ContentRegistry& content,
                         double nowMillis, double dt);

    /// Files every projectile in the shot index, and resolves the flower each
    /// one is answerable to. Run at the top of both phases, at the same points the
    /// server rebuilds its main grid, so the two describe the same world.
    void fileShots(World& world);
    struct FiledShot;
    /// `e`'s entry if it is a projectile fileShots() filed this phase.
    const FiledShot* filedShot(Entity e) const;
    bool isFiledShot(Entity e) const { return filedShot(e) != nullptr; }
    /// The flower a filed shot is answerable to, or NULL_ENTITY for a shot
    /// with none (a wild mob's) and for anything that is not a filed shot.
    Entity filedShotPlayer(Entity e) const;
    /// Every body a pass that may hit a PROJECTILE has to consider: the main
    /// broadphase's candidates plus combat's own shots. The passes that only
    /// ever want flowers or mobs query the main grid directly and never pay
    /// for the shots at all.
    void queryBodies(const SpatialGrid& grid, Realm realm, Vec2 center, double radius,
                     std::vector<Entity>& out);
    /// Appends every filed shot that could overlap the circle -- candidates,
    /// as a grid query returns, for the caller's exact test.
    void queryShots(Realm realm, Vec2 center, double radius, std::vector<Entity>& out) const;
    /// Spread a shared chain's pool across the bodies that draw on it: every
    /// segment behind `owner` is given the owner's health FRACTION and its
    /// flash, and -- when the hit was fatal -- the same death.
    ///
    /// Display and disposal only. The pool itself is one number on one entity
    /// and applyDamage is still the only thing that writes it; this is what
    /// makes ten health bars agree about it. No-op for anything that is not a
    /// shared chain.
    ///
    /// Not const-safe against iteration: it adds Dead.
    void mirrorSharedChain(World& world, Entity owner, bool fatal, Entity killer);

    /// `fallen` was one of an ambush nest's brood: when it was the last of
    /// them standing, the nest dies too, credited to `killer`, and pays out
    /// off the ledger its brood's swings were forwarded to. No-op for anything
    /// else. Adds Dead, so not safe against iteration either.
    void collapseClearedNest(World& world, Entity fallen, Entity killer);

    void awardBounty(World& world, Entity victim);

    /// Turns a killing blow on a flower into 1 HP plus the talent's own
    /// invulnerability, or leaves it lethal. It lives behind applyDamage so
    /// that body contact, a petal ring, a poison tick and a sponge repayment
    /// are all covered by one lookup rather than by five call sites that each
    /// have to remember.
    bool trySecondChance(World& world, Entity victim, double nowMillis);

    /// Rolls `victim`'s evasion against one direct hit. True means it missed;
    /// a flower that dodges is given the post-hit window a landed hit buys.
    /// Behind applyDamage, and asked directly only for a swing of zero, which
    /// applyDamage refuses before it would roll.
    bool rollDodge(World& world, Entity victim, double nowMillis);

    /// Cotton: land `amount` of any damage aimed at `flower` -- the last step
    /// before its health bar, behind the shield and the sponge -- on the
    /// flower's live cottons first, each taking up to what it has left, and return the
    /// overflow that still reaches the flower. `amount` itself when the flower
    /// is wearing none. Its rubbers catch LIGHTNING the same way.
    ///
    /// Behind applyDamage, and through it: each cotton takes its share as an
    /// ordinary hit, so it flashes, it breaks, and the slot reloads by the one
    /// path every other petal does. Not const-safe against iteration.
    double soakIntoCotton(World& world, Entity flower, Entity source, double amount,
                          double nowMillis, DamageKind kind);

    std::unique_ptr<Queries> queries_;
    World* boundWorld_ = nullptr;
    EventQueue* events_ = nullptr;

    std::vector<MeleeSource> melee_;
    std::vector<AuraSource> auras_;
    std::vector<LightningSource> strikers_;
    std::vector<FieldSource> fields_;
    std::vector<ShotSource> shots_;
    std::vector<ShotImpact> impacts_;
    std::vector<PoisonTick> poison_;
    std::vector<PoisonTick> spongeTicks_;

    std::vector<Entity> candidates_;

    /// PROJECTILES' OWN BROADPHASE. The server's main grid does not file shots
    /// at all: a flower on a full loadout of gas keeps over a thousand of them
    /// in the air around itself, and in a 600-unit grid every one of them was
    /// a candidate for every mob's aggro scan, every petal's swing and -- the
    /// quadratic part -- every other shot's hit test. Only the three passes
    /// that can actually strike a shot (melee, ground fields and shot against
    /// shot) look here, through queryBodies(), at cells sized to a shot rather
    /// than to a mob's aggro range.
    ///
    /// A sorted list of (cell, shot) rather than a SpatialGrid: cells this
    /// small over every map realm would be megabytes of empty buckets, while
    /// this costs sixteen bytes a shot and nothing where there are none. Each
    /// shot is filed under the cell its CENTRE is in, once, and a query widens
    /// itself by the largest shot filed instead -- so there are no duplicates
    /// to strip.
    static constexpr double kShotCellSize = 64.0;
    struct ShotCell {
        /// Realm, row, column, most significant first: one row of one realm is
        /// a contiguous run, found with one binary search.
        std::uint64_t key = 0;
        std::uint32_t slot = 0;
    };
    std::vector<ShotCell> shotCells_;
    double maxShotRadius_ = 0;
    /// The rows any shot was filed in, whatever its realm, so that a query
    /// with an absurd radius walks the rows that exist rather than millions.
    std::uint32_t shotRowMin_ = 0;
    std::uint32_t shotRowMax_ = 0;
    struct FiledShot {
        Entity entity = NULL_ENTITY;
        /// creditedPlayer() of the shot, resolved once when it is filed.
        Entity player = NULL_ENTITY;
        /// Where it was filed and how big. Nothing in a combat phase moves or
        /// resizes a shot -- they fly in movement, and every shove combat
        /// deals is to a flower or a mob -- so these ARE its Transform and
        /// Body for the rest of the phase, read without a lookup.
        Vec2 position;
        double radius = 0;
    };
    std::vector<FiledShot> filedShots_;
    /// filedShots_ slot by entity INDEX, or kNoShotSlot. The handle stored in
    /// the slot is compared on every read, because the world recycles indices.
    static constexpr std::uint32_t kNoShotSlot = 0xFFFFFFFFu;
    std::vector<std::uint32_t> shotSlot_;

    /// A strike's own broadphase answer and the two lists it builds from it.
    /// Separate from candidates_ because a contact strike is thrown from INSIDE
    /// the loop that is walking candidates_, and one shared scratch buffer
    /// would have the strike delete the list it was called from.
    std::vector<Entity> strikeCandidates_;
    std::vector<Entity> strikeVictims_;
    /// Where the bolts end, for the wire. Trimmed to net::kMaxLightningTargets;
    /// strikeVictims_ is not, because every flower inside the disc is hit
    /// whether or not an arm was drawn to it.
    std::vector<Vec2> strikeArms_;
    /// TypeScript stops after the first legitimate mob body-contact for a
    /// player each tick. Reused rather than allocated in resolveMelee().
    std::vector<Entity> mobContactedPlayers_;
    std::vector<DeathRecord> deaths_;
    /// The segments behind a shared chain's pool owner, gathered before any of
    /// them is touched. A member so a hit on a leech allocates nothing.
    std::vector<Entity> chainScratch_;
    /// The colony a hit is about to be shared over, and whether one is being
    /// shared right now (the shares come back through applyDamage).
    std::vector<Entity> colonyScratch_;
    bool sharingColonyHit_ = false;
    /// The relic's split, the same shape as the colony's: the other wearers
    /// a hit is being shared with, and the guard that stops a share from
    /// being shared again.
    std::vector<Entity> relicScratch_;
    bool sharingRelicHit_ = false;
    /// The cottons a hit is about to land on, gathered off the flower's ring
    /// before the first of them is struck.
    std::vector<Entity> cottonScratch_;

    /// Evasion's rolls, and nothing else. Combat's own stream for the reason
    /// the bots have theirs: drawing from the world's would move every spawn
    /// and drop roll the moment a talisman was worn. It is only drawn from
    /// when the victim has a chance to dodge, so a fight with no evasion in
    /// it rolls nothing.
    Rng rng_;

    std::uint64_t tick_ = 0;
};

} // namespace flix
