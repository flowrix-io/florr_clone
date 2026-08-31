#include "test.h"

#include "server/systems/movement.h"

#include <cmath>
#include <limits>

using namespace flr;

namespace {

const double kNan = std::numeric_limits<double>::quiet_NaN();

/// One world, one map, one system, driven a tick at a time.
///
/// Every test builds its own: MovementSystem caches queries against the World
/// it is handed, and sharing one across fixtures is exactly the mistake the
/// rebind path exists to survive -- so it gets its own test rather than being
/// baked into every other one.
struct Fixture {
    World world;
    Terrain terrain;
    MovementSystem movement;
    double nowMillis = 0;

    Entity spawnPlayer(Vec2 at) {
        const Entity e = world.create();
        world.add<PlayerTag>(e);
        world.add<Transform>(e, Transform{at, 0});
        world.add<Motion>(e, Motion{});
        world.add<Body>(e, Body{kPlayerBaseRadius, 1.0});
        world.add<PlayerInput>(e, PlayerInput{});
        world.add<Knockback>(e, Knockback{});
        // Passed by value, not default-added: Archetype::addRow zero-fills a
        // trivially-copyable column instead of default-constructing it, so
        // add<PlayerModifiers>(e) alone would hand back speedScale == 0.
        world.add<PlayerModifiers>(e, PlayerModifiers{});
        world.add<Afflictions>(e, Afflictions{});
        world.add<Health>(e, Health{100, 100, 0, 0});
        world.add<Faction>(e, Faction{Team::Players, false});
        return e;
    }

    Entity spawnMob(Vec2 at, double radius = 20.0, double mass = 1.0) {
        const Entity e = world.create();
        world.add<MobTag>(e);
        world.add<Transform>(e, Transform{at, 0});
        world.add<Motion>(e, Motion{});
        world.add<Body>(e, Body{radius, mass});
        world.add<Knockback>(e, Knockback{});
        world.add<Afflictions>(e, Afflictions{});
        world.add<Health>(e, Health{100, 100, 0, 0});
        world.add<Faction>(e, Faction{Team::Hostiles, false});
        return e;
    }

    Entity spawnProjectile(Vec2 at, Vec2 velocity, double range,
                           double seekRange = 0, double seekCone = 0) {
        const Entity e = world.create();
        world.add<ProjectileTag>(e);
        world.add<Transform>(e, Transform{at, velocity.angle()});
        world.add<Motion>(e, Motion{velocity});
        Projectile p;
        p.damage = 10;
        p.remainingDistance = range;
        p.seekRange = seekRange;
        p.seekCone = seekCone;
        world.add<Projectile>(e, p);
        world.add<Faction>(e, Faction{Team::Players, false});
        return e;
    }

    void drive(Entity e, double angle, double strength) {
        PlayerInput& input = world.get<PlayerInput>(e);
        input.current.moveAngle = angle;
        input.current.moveStrength = strength;
    }

    void step(int ticks = 1, double dt = net::kTickSeconds) {
        for (int i = 0; i < ticks; ++i) {
            movement.run(world, terrain, nowMillis, dt);
            nowMillis += dt * 1000.0;
        }
    }

    Vec2 positionOf(Entity e) { return world.get<Transform>(e).position; }
    Vec2 velocityOf(Entity e) { return world.get<Motion>(e).velocity; }

    /// A full-height wall at tile column `tx`, i.e. x in [tx*300, tx*300+300).
    void wallColumn(int tx) {
        for (int ty = 0; ty < Terrain::tilesPerAxis(); ++ty) terrain.setTile(tx, ty, Tile::Wall);
    }
};

} // namespace

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

TEST(player_accelerates_to_terminal_velocity_and_coasts_to_rest) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    fx.drive(player, 0.0, 1.0);
    fx.step(200);

    CHECK_NEAR(fx.velocityOf(player).x, kPlayerMaxSpeed, 0.5);
    CHECK_NEAR(fx.velocityOf(player).y, 0.0, 1e-9);
    CHECK(fx.positionOf(player).x > 3000.0);

    // Releasing the cursor decays under friction; it does not stop dead.
    const Vec2 released = fx.positionOf(player);
    fx.drive(player, 0.0, 0.0);
    fx.step(1);
    CHECK(fx.velocityOf(player).x < kPlayerMaxSpeed);
    CHECK(fx.velocityOf(player).x > 0.0);
    fx.step(200);
    CHECK_NEAR(fx.velocityOf(player).length(), 0.0, 0.01);
    // ...and it drifted a little further before settling.
    CHECK(fx.positionOf(player).x > released.x);
}

TEST(partial_move_strength_walks_instead_of_sprinting) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    fx.drive(player, 0.0, 0.5);
    fx.step(200);
    CHECK_NEAR(fx.velocityOf(player).x, kPlayerMaxSpeed * 0.5, 0.5);
}

TEST(movement_velocity_is_frame_rate_independent) {
    Fixture coarse, fine;
    const Entity a = coarse.spawnPlayer({3000, 3000});
    const Entity b = fine.spawnPlayer({3000, 3000});
    coarse.drive(a, 0.0, 1.0);
    fine.drive(b, 0.0, 1.0);

    // One second, in five 200ms steps versus twenty-five 40ms ones.
    coarse.step(5, 0.2);
    fine.step(25, 0.04);
    CHECK_NEAR(coarse.velocityOf(a).x, fine.velocityOf(b).x, 1e-9);

    // Position integration is explicit Euler, so the two disagree DURING the
    // acceleration transient -- the coarse step spends the whole 200ms at the
    // velocity it ended with. Once both are at terminal velocity they cover
    // ground at the same rate, which is what the player actually feels.
    const double coarseStart = coarse.positionOf(a).x;
    const double fineStart = fine.positionOf(b).x;
    coarse.step(5, 0.2);
    fine.step(25, 0.04);
    CHECK_NEAR(coarse.positionOf(a).x - coarseStart, fine.positionOf(b).x - fineStart, 0.5);
}

TEST(speed_modifier_scales_the_target_not_the_momentum) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    fx.world.get<PlayerModifiers>(player).speedScale = 1.5;
    fx.drive(player, 0.0, 1.0);
    fx.step(200);
    CHECK_NEAR(fx.velocityOf(player).x, kPlayerMaxSpeed * 1.5, 0.5);

    // A ludicrous modifier is capped rather than obeyed: past the cap a
    // flower would outrun the substep budget and start clipping walls.
    fx.world.get<PlayerModifiers>(player).speedScale = 1e6;
    fx.step(400);
    CHECK(fx.velocityOf(player).length() <= kPlayerMaxSpeed * 8.0 + 1.0);
}

TEST(an_unset_or_corrupt_speed_modifier_means_unmodified) {
    Fixture fx;
    const Entity zeroed = fx.spawnPlayer({3000, 3000});
    const Entity broken = fx.spawnPlayer({3000, 6000});
    // Exactly what an entity carries before any phase has recomputed it:
    // addRow() zero-fills trivially-copyable columns, so speedScale is 0.
    fx.world.get<PlayerModifiers>(zeroed).speedScale = 0.0;
    fx.world.get<PlayerModifiers>(broken).speedScale = kNan;
    fx.drive(zeroed, 0.0, 1.0);
    fx.drive(broken, 0.0, 1.0);
    fx.step(200);

    // Nothing in the game roots a player, so neither reading may freeze one.
    CHECK_NEAR(fx.velocityOf(zeroed).x, kPlayerMaxSpeed, 0.5);
    CHECK_NEAR(fx.velocityOf(broken).x, kPlayerMaxSpeed, 0.5);
    CHECK(std::isfinite(fx.positionOf(broken).x));
}

TEST(water_slows_a_player_and_a_slow_stacks_on_top) {
    Fixture dry, wet, slowed;
    wet.terrain.fill(Tile::Water);
    slowed.terrain.fill(Tile::Water);

    const Entity a = dry.spawnPlayer({3000, 3000});
    const Entity b = wet.spawnPlayer({3000, 3000});
    const Entity c = slowed.spawnPlayer({3000, 3000});
    dry.drive(a, 0.0, 1.0);
    wet.drive(b, 0.0, 1.0);
    slowed.drive(c, 0.0, 1.0);

    Afflictions& afflictions = slowed.world.get<Afflictions>(c);
    afflictions.slowFactor = 0.5;
    afflictions.slowUntilMillis = 1e9;

    dry.step(200);
    wet.step(200);
    slowed.step(200);

    CHECK_NEAR(dry.velocityOf(a).x, kPlayerMaxSpeed, 0.5);
    CHECK_NEAR(wet.velocityOf(b).x, kPlayerMaxSpeed * kWaterSpeedScale, 0.5);
    CHECK(wet.velocityOf(b).x < dry.velocityOf(a).x);
    // Water and the affliction multiply; the slow does not simply replace it.
    CHECK_NEAR(slowed.velocityOf(c).x, kPlayerMaxSpeed * kWaterSpeedScale * 0.5, 0.5);
    CHECK(slowed.velocityOf(c).x < wet.velocityOf(b).x);
}

TEST(an_expired_slow_stops_applying) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    Afflictions& afflictions = fx.world.get<Afflictions>(player);
    afflictions.slowFactor = 0.25;
    afflictions.slowUntilMillis = 500.0;   // fx.nowMillis starts at 0
    fx.drive(player, 0.0, 1.0);

    fx.step(10);                            // 400ms: still slowed
    CHECK(fx.velocityOf(player).x < kPlayerMaxSpeed * 0.5);
    fx.step(200);                           // long past it
    CHECK_NEAR(fx.velocityOf(player).x, kPlayerMaxSpeed, 0.5);
}

TEST(aim_angle_becomes_the_facing_and_the_aim_direction) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    fx.world.get<PlayerInput>(player).current.aimAngle = kPi * 0.5;
    fx.step(1);
    CHECK_NEAR(fx.world.get<Transform>(player).angle, kPi * 0.5, 1e-12);
    CHECK_NEAR(fx.world.get<PlayerInput>(player).aimDirection.x, 0.0, 1e-9);
    CHECK_NEAR(fx.world.get<PlayerInput>(player).aimDirection.y, 1.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Knockback
// ---------------------------------------------------------------------------

TEST(knockback_displaces_then_decays_to_rest) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({5000, 5000});
    const double startX = fx.positionOf(player).x;
    fx.world.get<Knockback>(player).impulse = {600, 0};

    fx.step(1);
    // The hit lands at full strength on the tick it happened: mass 1, so the
    // impulse is the velocity.
    CHECK_NEAR(fx.velocityOf(player).x, 600.0, 1e-9);
    // ...and the impulse is consumed, not re-applied every tick afterwards.
    CHECK_NEAR(fx.world.get<Knockback>(player).impulse.x, 0.0, 1e-12);
    CHECK(fx.positionOf(player).x > startX);

    fx.step(1);
    CHECK(fx.velocityOf(player).x < 600.0);   // same friction as movement
    fx.step(200);
    CHECK_NEAR(fx.velocityOf(player).length(), 0.0, 0.01);
    const double settled = fx.positionOf(player).x;
    CHECK(settled > startX);

    // It came to rest instead of coasting forever.
    fx.step(50);
    CHECK_NEAR(fx.positionOf(player).x, settled, 0.05);
}

TEST(knockback_scales_inversely_with_mass) {
    Fixture fx;
    const Entity light = fx.spawnMob({5000, 5000}, 20.0, 1.0);
    const Entity heavy = fx.spawnMob({5000, 6000}, 20.0, 4.0);
    const Entity weightless = fx.spawnMob({5000, 7000}, 20.0, 0.0);

    fx.world.get<Knockback>(light).impulse = {400, 0};
    fx.world.get<Knockback>(heavy).impulse = {400, 0};
    fx.world.get<Knockback>(weightless).impulse = {400, 0};
    fx.step(1);

    const double lightMoved = fx.positionOf(light).x - 5000.0;
    const double heavyMoved = fx.positionOf(heavy).x - 5000.0;
    CHECK(lightMoved > 0.0);
    CHECK_NEAR(heavyMoved, lightMoved / 4.0, 1e-9);
    // A zero mass is a data bug, not a licence to teleport: it is floored.
    CHECK(std::isfinite(fx.positionOf(weightless).x));
    CHECK(fx.positionOf(weightless).x < kWorldSize);
}

TEST(a_nonsense_impulse_is_dropped_rather_than_propagated) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({5000, 5000});
    fx.world.get<Knockback>(player).impulse = {kNan, 1e300};
    fx.step(3);
    CHECK(std::isfinite(fx.positionOf(player).x));
    CHECK(std::isfinite(fx.positionOf(player).y));
    CHECK_NEAR(fx.positionOf(player).x, 5000.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Tile collision
// ---------------------------------------------------------------------------

TEST(a_player_driven_at_a_wall_stops_against_it) {
    Fixture fx;
    fx.wallColumn(10);                       // x in [3000, 3300)
    const Entity player = fx.spawnPlayer({2000, 5000});
    fx.drive(player, 0.0, 1.0);
    fx.step(200);

    const Vec2 at = fx.positionOf(player);
    CHECK(!fx.terrain.blocked(at));
    // Resting against the face, not inside it.
    CHECK(at.x <= 3000.0 - kPlayerBaseRadius + 1e-6);
    CHECK(at.x > 3000.0 - kPlayerBaseRadius - 1.0);
    // Pushing into a wall bleeds speed instead of storing it up, so letting go
    // does not fire the flower backwards.
    CHECK_NEAR(fx.velocityOf(player).x, 0.0, 1.0);
}

TEST(a_wall_removes_only_the_velocity_that_points_into_it) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity player = fx.spawnPlayer({2900, 5000});
    fx.drive(player, kPi * 0.25, 1.0);       // hard into the wall, and +y
    fx.step(60);

    CHECK(!fx.terrain.blocked(fx.positionOf(player)));
    CHECK(fx.positionOf(player).x <= 3000.0 - kPlayerBaseRadius + 1e-6);
    // Sliding: the tangential half of the input survives the contact.
    CHECK(fx.positionOf(player).y > 5100.0);
    CHECK(fx.velocityOf(player).y > kPlayerMaxSpeed * 0.5);
}

TEST(a_body_spawned_inside_a_wall_is_ejected_without_gaining_speed) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity mob = fx.spawnMob({3150, 5000});   // dead centre of the wall
    fx.step(1);

    const Vec2 at = fx.positionOf(mob);
    CHECK(!fx.terrain.blocked(at));
    // The ejection is a correction, not a launch: it must not be read back as
    // velocity, or the mob rockets away from every wall it clips.
    CHECK_NEAR(fx.velocityOf(mob).length(), 0.0, 1e-9);
}

TEST(an_absurd_velocity_cannot_tunnel_through_a_wall) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity mob = fx.spawnMob({2000, 5000});

    // Re-asserted every tick, so the friction that would otherwise bleed it off
    // never gets the chance: this is the corrupt-velocity case, not a fast mob.
    for (int i = 0; i < 60; ++i) {
        fx.world.get<Motion>(mob).velocity = {100000.0, 0};
        fx.step(1);
        const Vec2 at = fx.positionOf(mob);
        CHECK(!fx.terrain.blocked(at));
        CHECK(at.x <= 3000.0 - 20.0 + 1e-6);
    }
    // It did travel -- the cap slows it, it does not freeze it.
    CHECK(fx.positionOf(mob).x > 2500.0);
}

TEST(one_tick_of_travel_is_bounded_by_the_substep_budget) {
    Fixture fx;
    const Entity mob = fx.spawnMob({30000, 30000}, 20.0);
    fx.world.get<Motion>(mob).velocity = {1e9, 0};
    fx.step(1);
    // Radius 20 is below the substep floor, so the budget is the floor times
    // the substep cap. Exceeding it would mean the loop took longer steps --
    // which is how a body ends up on the far side of a wall.
    const double budget = kMinSubstepLength * kMaxSubstepCount;
    CHECK(fx.positionOf(mob).x - 30000.0 <= budget + 1e-6);
    CHECK(fx.positionOf(mob).x > 30000.0);
}

TEST(a_zero_or_nan_radius_terminates_and_stays_out_of_walls) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity pointBody = fx.spawnMob({2000, 5000}, 0.0);
    const Entity nanBody = fx.spawnMob({2000, 6000}, kNan, kNan);

    // The bound on this test is the tick count: if the substep loop were not
    // capped, one of these would never return and the suite would hang here.
    for (int i = 0; i < 50; ++i) {
        fx.world.get<Motion>(pointBody).velocity = {100000.0, 0};
        fx.world.get<Motion>(nanBody).velocity = {kNan, 100000.0};
        fx.step(1);
    }

    CHECK(std::isfinite(fx.positionOf(pointBody).x));
    CHECK(!fx.terrain.blocked(fx.positionOf(pointBody)));
    CHECK(fx.positionOf(pointBody).x < 3000.0);
    // A NaN velocity is dropped, so the body never left its start.
    CHECK(std::isfinite(fx.positionOf(nanBody).x));
    CHECK_NEAR(fx.positionOf(nanBody).x, 2000.0, 1e-9);
    CHECK_NEAR(fx.positionOf(nanBody).y, 6000.0, 1e-9);
}

TEST(a_nan_position_is_replaced_rather_than_propagated) {
    Fixture fx;
    const Entity mob = fx.spawnMob({1000, 1000});
    fx.world.get<Transform>(mob).position = {kNan, kNan};
    fx.step(1);
    CHECK(std::isfinite(fx.positionOf(mob).x));
    CHECK(std::isfinite(fx.positionOf(mob).y));
    CHECK(!fx.terrain.blocked(fx.positionOf(mob)));
}

TEST(everything_is_clamped_inside_the_world) {
    Fixture fx;
    const Entity escapee = fx.spawnMob({100, 100});
    const Entity teleported = fx.spawnMob({40000, 40000});
    fx.world.get<Transform>(teleported).position = {-5000, kWorldSize + 5000};

    for (int i = 0; i < 40; ++i) {
        fx.world.get<Motion>(escapee).velocity = {-4000, -4000};
        fx.step(1);
    }

    for (const Entity e : {escapee, teleported}) {
        const Vec2 at = fx.positionOf(e);
        CHECK(at.x >= 0.0 && at.x <= kWorldSize);
        CHECK(at.y >= 0.0 && at.y <= kWorldSize);
    }
}

TEST(a_dead_body_stops_moving) {
    Fixture fx;
    const Entity player = fx.spawnPlayer({3000, 3000});
    fx.drive(player, 0.0, 1.0);
    fx.step(20);
    const Vec2 lastLiving = fx.positionOf(player);
    CHECK(lastLiving.x > 3000.0);

    fx.world.add<Dead>(player, Dead{});
    fx.step(20);
    // A corpse stays where it fell so later systems can still see it die.
    CHECK_NEAR(fx.positionOf(player).x, lastLiving.x, 1e-12);
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

TEST(a_mob_moves_at_the_velocity_the_ai_gave_it) {
    Fixture fx;
    const Entity mob = fx.spawnMob({5000, 5000});
    const double dt = net::kTickSeconds;
    for (int i = 0; i < 10; ++i) {
        fx.world.get<Motion>(mob).velocity = {200, 0};   // what the AI phase does
        fx.step(1, dt);
    }
    CHECK_NEAR(fx.positionOf(mob).x, 5000.0 + 200.0 * dt * 10.0, 1e-6);
}

TEST(water_costs_a_mob_less_than_it_costs_a_player) {
    Fixture wet;
    wet.terrain.fill(Tile::Water);
    const Entity mob = wet.spawnMob({5000, 5000});
    const double dt = net::kTickSeconds;
    wet.world.get<Motion>(mob).velocity = {200, 0};
    wet.step(1, dt);

    CHECK_NEAR(wet.positionOf(mob).x - 5000.0, 200.0 * kMobWaterSpeedScale * dt, 1e-9);
    // The penalty is on the displacement, not on the stored velocity: folding
    // it in would compound on every tick the AI left the velocity alone, and a
    // mob that paused in a river would never get out again.
    CHECK(kMobWaterSpeedScale > kWaterSpeedScale);
}

TEST(a_stalled_mob_is_slowed_and_recovers) {
    Fixture fx;
    const Entity mob = fx.spawnMob({5000, 5000});
    Afflictions& afflictions = fx.world.get<Afflictions>(mob);
    afflictions.slowFactor = 0.25;
    afflictions.slowUntilMillis = 1000.0;
    const double dt = net::kTickSeconds;

    fx.world.get<Motion>(mob).velocity = {400, 0};
    fx.step(1, dt);
    const double slowedStep = fx.positionOf(mob).x - 5000.0;
    CHECK_NEAR(slowedStep, 400.0 * 0.25 * dt, 1e-9);

    fx.nowMillis = 5000.0;                  // the stall has expired
    const double before = fx.positionOf(mob).x;
    fx.world.get<Motion>(mob).velocity = {400, 0};
    fx.step(1, dt);
    CHECK_NEAR(fx.positionOf(mob).x - before, 400.0 * dt, 1e-9);
}

TEST(mob_velocity_is_left_for_the_ai_phase_to_damp) {
    Fixture fx;
    const Entity mob = fx.spawnMob({5000, 5000});
    fx.world.get<Knockback>(mob).impulse = {800, 0};
    fx.step(1);
    // The shove lands in the velocity and STAYS there. Mob friction belongs to
    // the AI phase, which eases the velocity toward the heading it wants; a
    // second decay here would compound with that one and slow every mob.
    CHECK_NEAR(fx.velocityOf(mob).x, 800.0, 1e-9);
    fx.step(1);
    CHECK_NEAR(fx.velocityOf(mob).x, 800.0, 1e-9);
    CHECK_NEAR(fx.positionOf(mob).x, 5000.0 + 800.0 * net::kTickSeconds * 2.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

TEST(a_projectile_flies_straight_and_spends_its_range_exactly) {
    Fixture fx;
    const double dt = net::kTickSeconds;
    const Entity shot = fx.spawnProjectile({5000, 5000}, {500, 0}, 30.0);

    fx.step(1, dt);                                   // 20 units of a 30 budget
    CHECK_NEAR(fx.positionOf(shot).x, 5020.0, 1e-9);
    CHECK_NEAR(fx.world.get<Projectile>(shot).remainingDistance, 10.0, 1e-9);

    fx.step(1, dt);                                   // the last 10, not 20
    CHECK_NEAR(fx.positionOf(shot).x, 5030.0, 1e-9);
    CHECK_NEAR(fx.world.get<Projectile>(shot).remainingDistance, 0.0, 1e-12);

    fx.step(5, dt);                                   // spent: it stays put
    CHECK_NEAR(fx.positionOf(shot).x, 5030.0, 1e-9);
    CHECK_NEAR(fx.velocityOf(shot).length(), 0.0, 1e-12);
}

TEST(a_projectile_that_hits_terrain_is_spent_where_it_hit) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity shot = fx.spawnProjectile({2900, 5000}, {800, 0}, 100000.0);
    fx.step(40);

    CHECK_NEAR(fx.world.get<Projectile>(shot).remainingDistance, 0.0, 1e-12);
    CHECK(fx.positionOf(shot).x < 3000.0);
    CHECK(!fx.terrain.blocked(fx.positionOf(shot)));
}

TEST(a_homing_projectile_turns_toward_its_target_and_a_dumb_one_does_not) {
    Fixture fx;
    const double dt = net::kTickSeconds;
    fx.spawnMob({5400, 5400});                        // bearing +45 degrees

    const Entity homing = fx.spawnProjectile({5000, 5000}, {500, 0}, 5000.0, 1000.0, kPi * 0.5);
    const Entity dumb = fx.spawnProjectile({5000, 4000}, {500, 0}, 5000.0);

    fx.step(1, dt);
    const Vec2 turned = fx.velocityOf(homing);
    // Rate-limited: one tick buys exactly one tick's worth of turn, not a snap.
    CHECK_NEAR(turned.angle(), kProjectileTurnRate * dt, 1e-9);
    // ...and homing steers, it does not accelerate.
    CHECK_NEAR(turned.length(), 500.0, 1e-9);
    CHECK_NEAR(fx.world.get<Transform>(homing).angle, turned.angle(), 1e-12);

    CHECK_NEAR(fx.velocityOf(dumb).y, 0.0, 1e-12);
    CHECK_NEAR(fx.velocityOf(dumb).angle(), 0.0, 1e-12);

    // Over several ticks it arcs onto the bearing instead of overshooting.
    fx.step(30, dt);
    CHECK(fx.positionOf(homing).y > 5100.0);
    CHECK_NEAR(fx.velocityOf(homing).length(), 500.0, 1e-9);
    CHECK_NEAR(fx.velocityOf(dumb).y, 0.0, 1e-12);
}

TEST(homing_ignores_targets_outside_the_cone_and_on_its_own_team) {
    Fixture behind, friendly;
    const double dt = net::kTickSeconds;

    // 180 degrees off the heading, well outside a 45 degree cone.
    behind.spawnMob({4600, 5000});
    const Entity ignoring = behind.spawnProjectile({5000, 5000}, {500, 0}, 5000.0,
                                                   1000.0, kPi * 0.25);
    behind.step(5, dt);
    CHECK_NEAR(behind.velocityOf(ignoring).y, 0.0, 1e-12);

    // In the cone and in range, but the projectile's own team.
    const Entity ally = friendly.spawnMob({5400, 5400});
    friendly.world.get<Faction>(ally).team = Team::Players;
    const Entity restrained = friendly.spawnProjectile({5000, 5000}, {500, 0}, 5000.0,
                                                       1000.0, kPi * 0.5);
    friendly.step(5, dt);
    CHECK_NEAR(friendly.velocityOf(restrained).y, 0.0, 1e-12);
}

TEST(homing_ignores_targets_out_of_range_and_dead_ones) {
    Fixture fx;
    const double dt = net::kTickSeconds;
    fx.spawnMob({5000, 9000});                        // 4000 away, range is 1000
    const Entity shot = fx.spawnProjectile({5000, 5000}, {0, 500}, 100000.0,
                                           1000.0, kPi * 0.5);
    fx.step(1, dt);
    CHECK_NEAR(fx.velocityOf(shot).x, 0.0, 1e-12);

    // A corpse in range is not a target either.
    const Entity corpse = fx.spawnMob({5400, 5400});
    fx.world.get<Health>(corpse).current = 0.0;
    fx.step(1, dt);
    CHECK_NEAR(fx.velocityOf(shot).x, 0.0, 1e-12);
}

TEST(homing_picks_the_nearest_valid_target) {
    Fixture fx;
    const double dt = net::kTickSeconds;
    fx.spawnMob({5000, 5900});                        // far, straight ahead of +y
    const Entity near = fx.spawnMob({4700, 5300});    // nearer, off to -x
    const Entity shot = fx.spawnProjectile({5000, 5000}, {0, 500}, 5000.0,
                                           1000.0, kPi * 0.75);
    fx.step(1, dt);
    // Turning toward -x is only explicable by having chosen the nearer mob.
    CHECK(fx.velocityOf(shot).x < 0.0);
    CHECK(fx.positionOf(near).x < 5000.0);
}

TEST(a_seek_range_without_a_cone_still_homes) {
    Fixture fx;
    const double dt = net::kTickSeconds;
    fx.spawnMob({5400, 5400});
    // seekCone left at its config default of 0: seekRange is the switch, so a
    // config that forgets the cone gets a missile, not a dud.
    const Entity shot = fx.spawnProjectile({5000, 5000}, {500, 0}, 5000.0, 1000.0, 0.0);
    fx.step(1, dt);
    CHECK(fx.velocityOf(shot).y > 0.0);
}

// ---------------------------------------------------------------------------
// System plumbing
// ---------------------------------------------------------------------------

TEST(the_system_rebinds_its_queries_when_handed_a_new_world) {
    Terrain terrain;
    MovementSystem movement;

    Vec2 first{0, 0};
    {
        World world;
        const Entity e = world.create();
        world.add<MobTag>(e);
        world.add<Transform>(e, Transform{{5000, 5000}, 0});
        world.add<Motion>(e, Motion{{200, 0}});
        world.add<Body>(e, Body{20, 1});
        movement.run(world, terrain, 0.0, net::kTickSeconds);
        first = world.get<Transform>(e).position;
    }
    CHECK(first.x > 5000.0);

    // The cached archetype list belongs to the world it was built against;
    // reusing it here would read freed storage.
    World fresh;
    const Entity e = fresh.create();
    fresh.add<MobTag>(e);
    fresh.add<Transform>(e, Transform{{1000, 1000}, 0});
    fresh.add<Motion>(e, Motion{{200, 0}});
    fresh.add<Body>(e, Body{20, 1});
    movement.run(fresh, terrain, 0.0, net::kTickSeconds);
    CHECK(fresh.get<Transform>(e).position.x > 1000.0);
}

TEST(a_zero_dt_tick_changes_nothing_but_still_resolves_geometry) {
    Fixture fx;
    fx.wallColumn(10);
    const Entity player = fx.spawnPlayer({5000, 5000});
    fx.drive(player, 0.0, 1.0);
    fx.world.get<Motion>(player).velocity = {300, 0};
    fx.step(1, 0.0);
    CHECK_NEAR(fx.positionOf(player).x, 5000.0, 1e-12);

    // ...but a body sitting in geometry is still pushed out of it.
    const Entity stuck = fx.spawnMob({3150, 5000});
    fx.step(1, 0.0);
    CHECK(!fx.terrain.blocked(fx.positionOf(stuck)));
}

TEST(step_collide_is_usable_without_a_world) {
    Terrain terrain;
    for (int ty = 0; ty < Terrain::tilesPerAxis(); ++ty) terrain.setTile(10, ty, Tile::Wall);

    Vec2 position{2900, 5000};
    const StepOutcome open = stepCollide(terrain, position, {100, 0}, 20.0, 0.04);
    CHECK(!open.blocked);
    CHECK_NEAR(open.displacement.x, 4.0, 1e-9);

    const StepOutcome hit = stepCollide(terrain, position, {5000, 0}, 20.0, 0.04);
    CHECK(hit.blocked);
    CHECK(position.x <= 3000.0 - 20.0 + 1e-6);
    CHECK(hit.displacement.x > 0.0);

    // Sanitisers are total.
    CHECK_NEAR(sanitizeCollisionRadius(kNan), 0.0, 1e-12);
    CHECK_NEAR(sanitizeCollisionRadius(-5.0), 0.0, 1e-12);
    CHECK_NEAR(sanitizeCollisionRadius(1e9), kMaxCollisionRadius, 1e-12);
    CHECK_NEAR(sanitizeMovementVelocity({kNan, 1.0}).length(), 0.0, 1e-12);
    CHECK_NEAR(sanitizeMovementVelocity({1e9, 0}).length(), kMaxMovementSpeed, 1e-9);
    CHECK_NEAR(sanitizeMovementVelocity({3, 4}).length(), 5.0, 1e-12);
}
