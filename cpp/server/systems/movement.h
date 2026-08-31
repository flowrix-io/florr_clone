#pragma once
// The movement phase: velocity in, position out, for everything that moves.
//
// Players are the reason this file is careful. The client predicts its own
// flower with desiredVelocity() and integrateVelocity() out of constants.h,
// and the server authorises it with the SAME two functions -- so in open
// movement the two agree bit for bit and nothing visibly corrects. Any
// shortcut taken here that the client does not take is a rubber-band.
//
// Everything else -- mobs, projectiles -- shares the collision half of that
// path and differs only in where its velocity came from.

#include <optional>
#include <vector>

#include "shared/core/types.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/terrain.h"

namespace flr {

/// Water costs a mob less than it costs a player.
///
/// A player picks their route and can see the bank; a mob is steered by a
/// heading and has no way to walk around a river, so slowing it as hard as a
/// player turns every stream into a place where mobs go to be shot for free.
/// Water stays a real player advantage at 0.8 without disarming the AI.
inline constexpr double kMobWaterSpeedScale = 0.8;

/// Turn rate of a homing projectile, radians per second. Fast enough to run
/// down a strafing player, slow enough that the shot visibly arcs instead of
/// snapping onto the bearing the instant a target enters its cone.
inline constexpr double kProjectileTurnRate = 4.0;

// -- integration safety rails -------------------------------------------------
//
// The failure this file exists to prevent is a body crossing a wall between
// two samples of the tile grid, and the failure the rails prevent is the fix
// for it becoming an unbounded loop. A corrupt velocity is a bug somewhere
// else; it must cost that entity a slow tick and never cost the server one.

/// Longest a single collision substep may be. Half a tile, so no substep can
/// step over solid geometry: the thinnest wall the grid can express is one
/// whole tile.
inline constexpr double kMaxSubstepLength = kTileSize * 0.5;

/// Shortest a substep may be, whatever the body's radius says. A zero-radius
/// projectile -- or a NaN one -- would otherwise ask for infinitely many
/// substeps to cross a single tile.
inline constexpr double kMinSubstepLength = 24.0;

/// Hard cap on substeps per entity per tick. Reached only by a velocity that
/// should not exist; the body is moved as far as this many substeps allow and
/// the rest of the tick's displacement is dropped. Taking LONGER substeps
/// instead is precisely how a body ends up on the far side of a wall.
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
/// the world. Free rather than a member so tests -- and one day the client's
/// prediction -- can drive it without a World.
StepOutcome stepCollide(const Terrain& terrain, Vec2& position, Vec2 velocity,
                        double radius, double dt, bool collideTerrain = true);

/// Total, non-throwing sanitisers. Every one of them maps NaN to a safe value,
/// which is why they are written as failed `>` tests rather than `<=` ones.
double sanitizeCollisionRadius(double radius);
Vec2 sanitizeMovementVelocity(Vec2 velocity);

// ---------------------------------------------------------------------------
// MovementSystem
// ---------------------------------------------------------------------------

class MovementSystem {
public:
    /// Phase 3 of the tick. Runs after intent (input and AI have chosen where
    /// everything wants to go) and before rings and combat, so petals orbit
    /// and hits land from where bodies ended up rather than where they began.
    void run(World& world, const Terrain& terrain, double nowMillis, double dt);

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
        Query<PlayerTag, Transform, Faction, Health> playerTargets;
        Query<MobTag, Transform, Faction, Health> mobTargets;
    };

    /// A homing candidate, flattened out of the ECS once per tick. Projectiles
    /// are few and targets are many, so one pass to collect beats one query
    /// walk per projectile.
    struct SeekTarget {
        Entity entity = NULL_ENTITY;
        Vec2 position;
        Team team = Team::Hostiles;
    };

    void bind(World& world);
    void movePlayers(World& world, const Terrain& terrain, double nowMillis, double dt);
    void moveMobs(World& world, const Terrain& terrain, double nowMillis, double dt);
    void moveProjectiles(World& world, const Terrain& terrain, double dt);

    /// Collected lazily: a tick with no homing projectile pays nothing.
    void collectSeekTargets();
    Entity findSeekTarget(Entity self, const Projectile& projectile, Team team,
                          Vec2 position, double heading) const;

    World* boundWorld_ = nullptr;
    std::optional<Queries> queries_;
    std::vector<SeekTarget> seekTargets_;
    bool seekTargetsReady_ = false;
};

} // namespace flr
