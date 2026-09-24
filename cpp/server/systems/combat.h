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

/// TypeScript's fixed player-vs-mob contact displacement, in world units.
/// It is neither mass-scaled nor converted into velocity.
inline constexpr double kMobContactKnockback = 25.0;

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
};

/// Whether this kind is a landed hit rather than a drip. Everything in
/// applyDamage that used to ask `kind == Direct` asks this.
inline constexpr bool isDirectHit(DamageKind kind) {
    return kind == DamageKind::Direct || kind == DamageKind::Lightning;
}

struct DamageResult {
    double applied = 0;      ///< health actually removed, after clamping to what was left
    bool killed = false;     ///< this application is the one that marked Dead
    bool refused = false;    ///< nothing happened: invulnerable, same side, already dead
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
    /// Flowers are excluded: applyKnockback already moves them and movement
    /// drains it. Mobs are the ones that need this, because a mob's Knockback
    /// component is written but never read back into a position.
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
        Rarity rarity = Rarity::Common;
        /// What kind of body this is, decided once in the gather rather than
        /// re-derived per candidate. The throttle, the reciprocal petal bleed,
        /// the pet/wild contact gap and the one-mob-per-tick body rule all key
        /// off these.
        bool isPetal = false;
        bool isMobBody = false;
        /// A seat on a mob's own ring (MobRingPetal). Neither a mob nor a
        /// petal: a piece of the animal's body that happens to be breakable,
        /// so it bumps and is paced exactly as the hull is.
        bool isMobRing = false;
        bool isPet = false;
        bool isPlayerBody = false;
        /// A glitch-family mob body: its touch marks the flower (see
        /// markGlitched). Resolved from the config in the gather, where the
        /// registry is at hand.
        bool glitchInfecting = false;
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
    void gatherPetals(World& world, const ContentRegistry& content);
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

    void awardBounty(World& world, Entity victim);

    /// Turns a killing blow on a flower into 1 HP plus the talent's own
    /// invulnerability, or leaves it lethal. It lives behind applyDamage so
    /// that body contact, a petal ring, a poison tick and a sponge repayment
    /// are all covered by one lookup rather than by five call sites that each
    /// have to remember.
    bool trySecondChance(World& world, Entity victim, double nowMillis);

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

    std::uint64_t tick_ = 0;
};

} // namespace flix
