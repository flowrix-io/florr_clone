#pragma once
// The movement phase: velocity in, position out, for everything that moves.
//
// Players are the reason this file is careful. A flower is simulated here and
// nowhere else -- desiredVelocity() and integrateVelocity() out of
// constants.h, then the step below -- and the client runs no movement of its
// own: it eases every flower toward what it is sent (client/interpolation.h).
// Whatever this step does, a stall against a wall or a slide along one, is
// exactly what every screen shows.
//
// Mobs share the collision half of that path and differ only in where their
// velocity came from. Projectiles take the same step with terrain collision
// switched off: a shot flies through walls, and only the edge of the world
// stops it -- except a carrot's (Projectile::bouncesOffWalls), which meets
// walls as a body does and comes back off them.

#include <cstdint>
#include <functional>
#include <optional>
#include <vector>

#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/spatial.h"
#include "shared/game/map_elements.h"
#include "shared/game/terrain.h"

namespace flix {

/// Water costs a mob less than it costs a player.
///
/// A player picks their route and can see the bank; a mob is steered by a
/// heading and has no way to walk around a river, so slowing it as hard as a
/// player turns every stream into a place where mobs go to be shot for free.
/// Water stays a real player advantage at 0.8 without disarming the AI.
inline constexpr double kMobWaterSpeedScale = 0.8;

/// What is left of a mob's knockback after one twentieth of a second.
///
/// gardn delivers a shove as velocity (Collision.cc _deal_knockback) that its
/// 1/3 friction spends over the following ticks, so a struck mob recoils and
/// slows to a stop. Taken in one step instead, the whole shove lands between
/// two snapshots and the client -- which replays a mob's samples exactly --
/// draws it as a jump. The pass spends `1 - kKnockbackSpendDecay^(dt * 20)` of
/// what is owed each tick: the same total distance, about a third of a second
/// to deliver 95% of it.
inline constexpr double kKnockbackSpendDecay = 2.0 / 3.0;
inline constexpr double kKnockbackSpendRate = 20.0;

/// Below this a mob's owed knockback is dropped rather than spent forever.
inline constexpr double kKnockbackSettleDistance = 0.05;

// -- mob separation -----------------------------------------------------------
//
// Mobs push each other apart so a spawn wave, an escort group or a chasing
// pack spreads into a ring instead of collapsing onto one point. The push is
// radius-driven and symmetric; mass plays no part in it. The gap, the per-pair
// cap and the Jacobi headroom are shared constants; what is local to this pass
// is the grid it buckets into.

/// Broad-phase cell size for the separation pass. Its own grid rather than the
/// tick's shared one, exactly as in the reference: this pass must see pets,
/// and the shared broadphase holds whatever the systems that build it needed.
inline constexpr double kMobCollisionCellSize = 512.0;

/// Coordinates past this make cell-range loops non-terminating, so a body
/// carrying one sits the pass out entirely.
inline constexpr double kMaxSaneWorldCoord = 1e9;

// -- integration safety rails -------------------------------------------------
//
// The failure this file exists to prevent is a body crossing a wall between
// two samples of the tile grid, and the failure the rails prevent is the fix
// for it becoming an unbounded loop. A corrupt velocity is a bug somewhere
// else; it must cost that entity a slow tick and never cost the server one.

/// Longest a single collision substep may be.
///
/// Half a tile is NOT the right number, which is why this subtracts. The
/// resolver ejects an embedded centre through the tile's NEAREST face, so a
/// substep that carries the centre past a tile's midline flips that ejection
/// to the FAR face, which is a teleport through the wall. Detection reaches
/// the scan buffer beyond the tile's rectangle, so the midline that matters
/// sits that much inside the geometric one. TypeScript's `MAX_STEP_HARD` in
/// stepPlayerMovement (src/constants.ts) subtracted its drawn outline's
/// protrusion as well; the outline is tileset artwork now and a tile collides
/// as its flat rectangle, so only the buffer is left. It only ever binds on
/// bodies wider than half a tile -- a super-tier mob, or a flower stacked with
/// size petals.
inline constexpr double kMaxSubstepLength = kTileSize * 0.5 - kCollisionScanBuffer;

/// The substep a body's REACH is measured in when its radius is smaller than
/// this; see kMaxSubstepCount. A zero-radius projectile -- or a NaN one --
/// would otherwise be given no reach at all.
inline constexpr double kMinSubstepLength = 24.0;

/// How far past its own hull one substep may carry a body's centre.
///
/// A body pressed against a wall rests one hull off the face, so a substep
/// drives the centre that much less than its length into what it walks into.
/// Past half the wall's thickness the resolver's nearest face is the FAR one
/// and the body comes out the other side. The thinnest wall authored is the
/// sewers grate's 14-unit rail, and this keeps the centre short of its middle.
/// It shortens the substep only for hulls under kMinSubstepLength minus this --
/// a mob, which meets walls as a point (kMobWallRadius), and not a flower.
inline constexpr double kMaxSubstepPenetration = 6.5;

/// Cap on a tick's travel, counted in substeps of kMinSubstepLength or the
/// body's radius, whichever is longer. Reached only by a velocity that should
/// not exist; the body is moved that far and the rest of the tick's
/// displacement is dropped. Taking LONGER substeps instead is precisely how a
/// body ends up on the far side of a wall. A body whose substeps
/// kMaxSubstepPenetration shortens takes more of them over the same reach.
inline constexpr int kMaxSubstepCount = 16;

/// Speed ceiling applied to every entity before it is integrated, so one
/// arithmetic accident upstream cannot put a body 1e30 units away.
inline constexpr double kMaxMovementSpeed = 20000.0;

/// Radii above this are clamped: collision resolution is a per-tile scan, and
/// nothing in the game is four tiles wide.
inline constexpr double kMaxCollisionRadius = kTileSize * 4.0;

/// Hull given to a body with no radius of its own. A true point has nothing
/// for the tile push-out to act on, so it can come to rest exactly ON a wall
/// tile's edge and read as inside the wall from then on. Half a unit is
/// invisible and makes the push-out well defined for every body.
inline constexpr double kMinCollisionRadius = 0.5;

/// The radius a mob meets walls with: none. Its Body radius is what it fights
/// and is shoved by; against terrain only its centre counts, so a mob against
/// a wall overlaps it, and goes through any gap its centre fits through.
/// Every mob-versus-wall resolution -- its step, a shove, separation, a trailing
/// segment, a spawn -- uses this and never the Body radius, and so does every
/// NPC's, an NPC being a mob standing on the players' map.
inline constexpr double kMobWallRadius = kMinCollisionRadius;

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

struct StepOutcome {
    /// What the body actually achieved, which is not `velocity * dt` once a
    /// wall, the map edge or the substep cap has had its say.
    Vec2 displacement;
    /// True when tile collision or the world clamp moved the body off the
    /// path it asked for. Callers use it to rebuild velocity, so that pushing
    /// into a wall bleeds speed instead of storing it up.
    bool blocked = false;
};

/// Advances `position` by `velocity * dt`, substepped so that a fast body
/// samples the tile grid often enough never to cross a wall, and clamped to
/// the world. Free rather than a member so tests can drive it without a World.
///
/// `refuseWallCrossing` adds the reference's player containment guard: a
/// substep whose wall ejection would carry the CENTRE across solid is thrown
/// away and the body stops where it started. Off by default because the
/// reference only guards flowers: a mob's own step takes the resolver's word
/// for it, and only a bouncing shot collides with terrain at all. The few
/// other moves that opt in -- a mob's knockback being spent, a loose petal's
/// contact push, a coasting moon -- say so where they are made.
StepOutcome stepCollide(const Terrain& terrain, Realm realm, Vec2& position, Vec2 velocity,
                        double radius, double dt, bool collideTerrain = true,
                        bool refuseWallCrossing = false);

/// Total, non-throwing sanitisers. Every one of them maps NaN to a safe value,
/// which is why they are written as failed `>` tests rather than `<=` ones.
double sanitizeCollisionRadius(double radius);
Vec2 sanitizeMovementVelocity(Vec2 velocity);

// ---------------------------------------------------------------------------
// MovementSystem
// ---------------------------------------------------------------------------

class MovementSystem {
public:
    /// Every staged map's annotation layer, or null when the server has none.
    ///
    /// Set once rather than passed per tick: a teleporter pad is a fixture of
    /// the map, not of the frame. Null leaves the pads inert, which is what a
    /// focused test or a bench that never loads a map wants.
    const WorldMaps* worldMaps = nullptr;

    /// Called when a pad fires: the flower goes to another MAP, and only the
    /// server can move a body between realms and tell its client.
    ///
    /// A callback rather than something this system does itself, because the
    /// move is not physics: the destination realm's tile grid has to reach
    /// that player's client before its next snapshot, and the connection
    /// layer is the only thing that can send it.
    std::function<void(Entity, Realm, Vec2)> onTeleport;

    /// Which flowers a pad may take at all. Null means every flower; the
    /// server answers false for its bots, whose controller only knows the
    /// overworld. A flower this refuses is neither pulled nor charged by a
    /// pad, so it walks over one as over open ground.
    std::function<bool(Entity)> takesTeleporters;

    /// Convenience entry point used by focused tests.
    void run(World& world, const Terrain& terrain, double nowMillis, double dt);

    /// TypeScript advances flowers and their post-movement petal pipeline
    /// before mob AI. The server loop calls these two phases separately to
    /// preserve that ordering while this class still owns all integration.
    void runPlayerPhase(World& world, const Terrain& terrain, double nowMillis, double dt);
    void runWorldPhase(World& world, const Terrain& terrain, double nowMillis, double dt);

private:
    /// Queries are cached because rebuilding one per tick throws away the
    /// matched-archetype list that makes iteration free. They cannot be built
    /// in the constructor: the system is created before any World exists and
    /// is handed one per call. So they are built on first use and REBOUND when
    /// the World changes -- a cached archetype list belongs to the world it
    /// was built against, and reusing it against another reads freed storage.
    struct Queries {
        explicit Queries(World& world);

        Query<PlayerTag, Transform, Motion, Body, PlayerInput> players;
        Query<MobTag, Transform, Motion, Body> mobs;
        Query<ProjectileTag, Transform, Motion, Projectile> projectiles;
        Query<MobTag, Transform, Faction, Health> mobTargets;
        /// NPCs a guided shot may lock onto: the ones not on the players' side.
        Query<NpcTag, Transform, Faction> npcTargets;
        /// The separation pass wants every mob that has a place and a size,
        /// whether or not it is a mover: a nest still occupies its ground.
        /// MobType rides along for the level of detail: a boss is
        /// simulated wherever it stands, separation included.
        Query<MobTag, Transform, Body, MobType> mobBodies;
        /// LOD is measured against every flower, dead ones included -- a
        /// player about to respawn is still standing there watching.
        Query<PlayerTag, Transform> playerPositions;
        /// The NPCs a flower cannot walk through.
        Query<NpcTag, Transform, Body> npcBodies;
        /// The petals that are solid bodies on the ground -- wax, the moon.
        Query<LoosePetal, Transform, Body> looseBodies;
        /// The loose petals that carry momentum -- the moon, which a bubble
        /// throws.
        Query<RingAnchor, Transform, Motion, Body> ringAnchors;
    };

    /// One NPC's body, flattened out of the ECS once per player pass: a handful
    /// of them, each tested against every flower.
    struct NpcDisc {
        Vec2 position;
        double radius = 0;
        Realm realm = Realm::Overworld;
    };

    /// One loose petal, flattened out of the ECS for the passes that shove it.
    /// Unlike an NpcDisc it MOVES during the pass -- every flower or mob that
    /// pushes it leaves it somewhere new for the next one -- so the position
    /// is worked on here and written back to the Transform once at the end.
    struct LooseDisc {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        double radius = 0;
        double mass = 1;
        Realm realm = Realm::Overworld;
    };

    /// A homing candidate, flattened out of the ECS once per tick. Projectiles
    /// are few and targets are many, so one pass to collect beats one query
    /// walk per projectile.
    struct SeekTarget {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        Team team = Team::Hostiles;
    };

    /// One mob in the separation pass, flattened out of the ECS.
    ///
    /// Every field is read once per neighbour tested, so the pass pays for the
    /// component lookups once rather than once per pair.
    struct SeparationEntry {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        Realm realm = Realm::Overworld;
        double radius = 0;
        /// The centipede this mob belongs to, NULL_ENTITY for anything else.
        Entity chainHead = NULL_ENTITY;
        /// The config's `no_mob_collision`: neither pushes nor is pushed.
        bool noCollision = false;
        /// The parent this mob is still climbing out of (HoleTether::emerging),
        /// NULL_ENTITY once it is clear. The pair does not push each other.
        Entity emergingFrom = NULL_ENTITY;
        /// Found still overlapping that parent on this pass.
        bool insideParent = false;
        /// Accumulated push, applied after every pair has been evaluated.
        Vec2 push;
    };

    /// Not an index into the set. Fills the slot table for every entity that
    /// is not in this pass.
    static constexpr std::uint32_t kNoSeparationEntry = 0xFFFFFFFFu;

    void bind(World& world);
    /// Spends whatever a bubble threw a moon with: its velocity decays under
    /// the friction a flower's does with no input asking for any, and the
    /// body is stepped through the walls as a flower is. That shared decay is
    /// what lets popImpulse aim a pop at the moon with the flower's numbers.
    /// Run at the head of the player phase, where a flower spends ITS pop.
    void coastRingAnchors(World& world, const Terrain& terrain, double dt);
    void movePlayers(World& world, const Terrain& terrain, double nowMillis, double dt);
    /// The teleporter pads: the suction well, the dwell and the jump.
    ///
    /// Part of the player pipeline rather than a system of its own because it
    /// is the last thing the reference does to a flower's position, after
    /// everything else that tick has had its say.
    void stepTeleporters(World& world, double nowMillis, double dt);
    /// Puts a flower back outside every NPC body it has walked into. NPCs are
    /// solid to flowers, and they do not give way: the flower is moved, the
    /// NPC stays on its mark.
    void pushOutOfNpcs(const Terrain& terrain, Transform& transform, double radius) const;
    /// Rebuilds npcDiscs_. NPCs do not move between the two movement phases
    /// of one tick, but either phase may be the first to run in a test.
    void collectNpcDiscs();
    /// Rebuilds looseDiscs_ from the live transforms, and writes it back.
    void collectLooseDiscs();
    void storeLooseDiscs(World& world) const;
    /// A flower walking into a loose petal: half the overlap is taken back
    /// this tick (softLooseContact in movement.cpp), the petal giving way by
    /// the flower's mass over both and no further than the walls let it, and
    /// the flower by the rest. Soft like a mob, not flush like an NPC.
    void shoveLooseBodies(const Terrain& terrain, Transform& transform, const Body& body);
    /// The loose petals against everything the world phase moved, just as
    /// softly: mobs (by mass, a stationary one never giving way), NPCs (which
    /// never do), and each other (by mass). Runs after separation, so it sees
    /// the mobs where they finally stand this tick.
    void collideLooseBodies(World& world, const Terrain& terrain);
    void moveMobs(World& world, const Terrain& terrain, double nowMillis, double dt);
    void moveProjectiles(World& world, const Terrain& terrain, double dt);

    /// Pushes overlapping mobs apart. Runs once everything has moved, so a
    /// shove is never undone by the mover it was computed against.
    void separateMobs(World& world, const Terrain& terrain);
    /// Flattens the eligible mobs into `separationSet_` and files them in
    /// `separationGrid_`.
    void buildSeparationSet(World& world);
    /// The LOD gate: false for a mob too far from every flower to be worth
    /// colliding this tick.
    bool activeForSeparation(Vec2 position, Realm realm, Rarity rarity) const;

    /// Collected lazily: a tick with no seeking projectile pays nothing.
    void collectSeekTargets();
    Entity findSeekTarget(Entity self, const Projectile& projectile, Team team,
                          Vec2 position, double heading) const;
    /// The one-shot launch correction. Returns the velocity the shot leaves
    /// with, which is `velocity` itself when nothing was in the cone.
    Vec2 aimAtLaunch(World& world, Entity self, Vec2 position,
                     const Projectile& projectile, Vec2 velocity);

    /// Flowers to run the pads against, collected before any of them is
    /// touched: a flower that has never stood on a pad acquires its
    /// TeleporterState here, and adding a component moves the entity to
    /// another archetype -- which is not something a query walk survives.
    std::vector<Entity> teleportPlayers_;
    /// The terrain the current phase is running against, so the teleporter
    /// pass can place an arrival in the DESTINATION map without the whole
    /// system having to hold a Terrain of its own.
    const Terrain* teleportTerrain_ = nullptr;
    /// The stream a teleporter's arrival point is sampled from. Its own, and
    /// not the world's: an arrival must not consume draws from the simulation
    /// stream, or every mob spawned after somebody took a pad would differ.
    Rng teleportRng_{0x7E1E907E1EULL};

    /// Projectiles whose distance budget ended, or that reached the world's
    /// edge, this tick.
    /// Collected during the query walk and marked Dead afterwards: adding a
    /// component relocates an entity between archetypes, so doing it inline
    /// would invalidate the columns moveProjectiles is iterating.
    std::vector<Entity> spentProjectiles_;

    World* boundWorld_ = nullptr;
    std::optional<Queries> queries_;
    std::vector<SeekTarget> seekTargets_;
    /// Rebuilt at the top of every player pass. See pushOutOfNpcs().
    std::vector<NpcDisc> npcDiscs_;
    /// Rebuilt at the top of each pass that shoves loose petals.
    std::vector<LooseDisc> looseDiscs_;
    bool seekTargetsReady_ = false;

    /// Separation scratch, reused every tick so a steady state allocates
    /// nothing. `separationSlot_` is keyed by entity INDEX, which is how a
    /// grid candidate gets back to its entry in O(1).
    std::vector<RealmPoint> separationPlayers_;
    std::vector<SeparationEntry> separationSet_;
    std::vector<std::uint32_t> separationSlot_;
    std::vector<Entity> separationCandidates_;
    SpatialGrid separationGrid_{kMobCollisionCellSize};
};

} // namespace flix
