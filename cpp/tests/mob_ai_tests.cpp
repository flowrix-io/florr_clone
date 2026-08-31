#include "test.h"

#include "server/systems/mob_ai.h"

#include "shared/game/config.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"

#include <sys/stat.h>

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

using namespace flr;

namespace {

// --- the shipped content ----------------------------------------------------
//
// The AI reads mob speed, attack cadence and the two art flags out of the
// process-wide registry, so these tests steer REAL mobs rather than invented
// ones. Paths are derived from this source file's own location because the test
// binary runs from wherever ctest puts it.

std::string testsDir() {
    const std::string path = __FILE__;
    const std::size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string firstExisting(const std::vector<std::string>& candidates) {
    for (const std::string& candidate : candidates) {
        std::ifstream probe(candidate, std::ios::binary);
        if (probe) return candidate;
    }
    return {};
}

bool readText(const std::string& path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    return true;
}

bool writeText(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return out.good();
}

/// loadContent() takes one directory and the three files do not live in one,
/// so they are staged into a scratch directory here. The staged copy is the
/// shipped bytes verbatim, so a test file that loads content before or after
/// this one ends up with exactly the same registry.
bool contentReady() {
    static const bool ok = [] {
        std::string mobs, petals, xp;
        if (!readText(firstExisting({testsDir() + "/../../src/mobs.json", "data/mobs.json",
                                     "../src/mobs.json", "../../src/mobs.json", "src/mobs.json"}), mobs)) return false;
        if (!readText(firstExisting({testsDir() + "/../../src/petals.json", "data/petals.json",
                                     "../src/petals.json", "../../src/petals.json", "src/petals.json"}), petals)) return false;
        if (!readText(firstExisting({testsDir() + "/../data/mob_xp.json", "data/mob_xp.json",
                                     "../data/mob_xp.json", "cpp/data/mob_xp.json"}), xp)) return false;

        const char* env = std::getenv("TMPDIR");
        std::string dir = (env != nullptr && *env != '\0') ? env : "/tmp";
        if (dir.back() != '/') dir.push_back('/');
        dir += "flr_mob_ai_tests";
        mkdir(dir.c_str(), 0755);
        if (!writeText(dir + "/mobs.json", mobs)) return false;
        if (!writeText(dir + "/petals.json", petals)) return false;
        if (!writeText(dir + "/mob_xp.json", xp)) return false;

        std::string error;
        return loadContent(dir, error);
    }();
    return ok;
}

// --- the harness ------------------------------------------------------------

/// One tick of the server, cut down to the two phases these tests care about:
/// the AI, and a movement stand-in that does nothing but integrate the velocity
/// the AI asked for. Keeping the stand-in that dumb is the point -- it is the
/// contract this system is written against.
struct Sim {
    World world;
    Terrain terrain;
    SpatialGrid grid;
    MobAiSystem ai;
    Query<Transform, Motion> movers;
    Query<Transform> placed;
    Query<PlayerTag, Transform> players;

    std::vector<Vec2> active;
    /// The clock starts well after zero on purpose: MobAi::lastAttackMillis and
    /// nextDecisionMillis both default to 0, and a clock that also starts at 0
    /// would make "never attacked" indistinguishable from "attacked just now".
    double now = 10000.0;
    double dt = net::kTickSeconds;
    bool autoActive = true;

    std::uint64_t totalConsidered = 0;
    std::uint64_t totalSkipped = 0;
    std::uint64_t totalScans = 0;
    std::uint64_t totalAttacks = 0;
    std::uint64_t totalPromotions = 0;
    std::uint64_t totalSpawnRequests = 0;

    Sim() : ai(world), movers(world), placed(world), players(world) {}

    Vec2 positionOf(Entity e) { return world.get<Transform>(e).position; }
    Vec2 velocityOf(Entity e) { return world.get<Motion>(e).velocity; }
    double angleOf(Entity e) { return world.get<Transform>(e).angle; }
    MobAi& brainOf(Entity e) { return world.get<MobAi>(e); }
    double gap(Entity a, Entity b) { return distance(positionOf(a), positionOf(b)); }

    Entity spawnMob(const char* id, Vec2 at, Rarity rarity = Rarity::Common) {
        const std::uint16_t index = content().mobIndex(id);
        const MobStats stats = content().mobStats(index, rarity);
        const Entity e = world.create();
        world.add<MobTag>(e);
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{stats.radius, stats.mass});
        world.add<Health>(e, Health{stats.health, stats.health, 0, 0});
        world.add<MobType>(e, MobType{index, rarity, 1.0});
        world.add<Faction>(e, Faction{Team::Hostiles, false});
        world.add<ContactDamage>(e, ContactDamage{stats.damage, kMobHitIntervalMillis});
        world.add<Bounty>(e, Bounty{stats.xp, {}});

        MobAi brain;
        brain.kind = content().mob(index).ai;
        brain.anchor = at;
        brain.aggroRange = stats.aggroRange;
        world.add<MobAi>(e, brain);
        return e;
    }

    Entity spawnPlayer(Vec2 at, double aggroBonus = 0.0) {
        const Entity e = world.create();
        world.add<PlayerTag>(e);
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{kPlayerBaseRadius, 1.0});
        world.add<Health>(e, Health{kPlayerBaseHealth, kPlayerBaseHealth, 0, 0});
        PlayerModifiers mods;
        mods.aggroRadiusBonus = aggroBonus;
        world.add<PlayerModifiers>(e, mods);
        return e;
    }

    /// What combat does to a mob: takes health, lights the damage flash, and
    /// credits the ledger. The AI reads exactly those three and nothing else.
    void hurt(Entity mob, Entity by, double damage = 5.0) {
        Health& health = world.get<Health>(mob);
        health.current -= damage;
        health.flashUntilMillis = now + 250.0;
        if (Bounty* bounty = world.tryGet<Bounty>(mob)) bounty->credit(by, damage);
    }

    void rebuildGrid() {
        grid.clear();
        placed.each([&](Entity e, Transform& transform) {
            const Body* body = world.tryGet<Body>(e);
            grid.insert(e, transform.position, body != nullptr ? body->radius : 0.0);
        });
    }

    void refreshActive() {
        if (!autoActive) return;
        active.clear();
        players.each([&](Entity, PlayerTag&, Transform& transform) { active.push_back(transform.position); });
    }

    void accumulate() {
        const MobAiSystem::Stats& s = ai.stats();
        totalConsidered += s.considered;
        totalSkipped += s.skipped;
        totalScans += s.targetScans;
        totalAttacks += s.attacks;
        totalPromotions += s.promotions;
        totalSpawnRequests += s.spawnRequests;
    }

    /// The intent phase alone. Chain geometry and facing are invariants that
    /// hold BETWEEN intent and movement, so asserting them needs a tick that
    /// stops there.
    void tickIntent(int count = 1) {
        for (int i = 0; i < count; ++i) {
            rebuildGrid();
            refreshActive();
            CommandBuffer commands(world);
            ai.run(world, terrain, grid, active, now, dt, commands);
            accumulate();
            commands.flush();
            now += net::kTickMillis;
        }
    }

    void tick(int count = 1) {
        for (int i = 0; i < count; ++i) {
            rebuildGrid();
            refreshActive();
            CommandBuffer commands(world);
            ai.run(world, terrain, grid, active, now, dt, commands);
            accumulate();
            movers.each([&](Entity, Transform& transform, Motion& motion) {
                transform.position += motion.velocity * dt;
            });
            commands.flush();
            now += net::kTickMillis;
        }
    }
};

/// Middle of the map, well away from the world edge that reads as wall.
const Vec2 kOrigin{30000.0, 30000.0};

/// Attaches `self` to the chain behind `ahead`.
void link(Sim& sim, Entity self, Entity ahead, double spacing) {
    BodySegment segment;
    segment.ahead = ahead;
    segment.spacing = spacing;
    segment.head = ahead == NULL_ENTITY;
    sim.world.add<BodySegment>(self, segment);
}

} // namespace

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

TEST(facing_turns_toward_travel_at_a_limited_rate) {
    // A quarter turn asked for, a tenth of a radian allowed.
    CHECK_NEAR(steerFacing(0.0, Vec2{0, 1}, false, false, 0.1), 0.1, 1e-12);
    CHECK_NEAR(steerFacing(0.0, Vec2{0, -1}, false, false, 0.1), -0.1, 1e-12);
    // Enough budget to arrive exactly.
    CHECK_NEAR(steerFacing(0.0, Vec2{0, 1}, false, false, 10.0), kPi / 2, 1e-12);
}

TEST(facing_takes_the_short_way_round_the_wrap) {
    // 3.0 to -3.0 is a 0.28 radian turn, not a 6 radian one.
    const double turned = steerFacing(3.0, Vec2::fromAngle(-3.0), false, false, 1.0);
    CHECK_NEAR(turned, -3.0, 1e-12);
    // And it went the short way: never through zero.
    CHECK(std::fabs(steerFacing(3.0, Vec2::fromAngle(-3.0), false, false, 0.1)) > 3.0);
}

TEST(facing_holds_its_angle_when_there_is_no_travel) {
    CHECK_NEAR(steerFacing(1.25, Vec2{0, 0}, false, false, 10.0), 1.25, 1e-12);
    CHECK_NEAR(steerFacing(1.25, Vec2{1e-9, 0}, false, false, 10.0), 1.25, 1e-12);
    // A non-finite turn budget turns nothing rather than poisoning the angle.
    CHECK_NEAR(steerFacing(1.25, Vec2{0, 1}, false, false, std::nan("")), 1.25, 1e-12);
}

TEST(facing_honours_hide_rotation_and_reversed) {
    // hideRotation wins over everything, travel and reversed included.
    CHECK_NEAR(steerFacing(2.0, Vec2{0, 1}, true, false, 10.0), 0.0, 1e-12);
    CHECK_NEAR(steerFacing(2.0, Vec2{0, 1}, true, true, 10.0), 0.0, 1e-12);
    // Reversed art points backwards along the travel.
    CHECK_NEAR(std::fabs(steerFacing(kPi, Vec2{1, 0}, false, true, 10.0)), kPi, 1e-12);
    CHECK_NEAR(steerFacing(0.0, Vec2{0, 1}, false, true, 10.0), -kPi / 2, 1e-12);
}

TEST(a_mob_turns_toward_its_target_rather_than_snapping_round) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{0, 250});

    sim.tickIntent();
    // One tick of a 9 rad/s limit at 25Hz, not the quarter turn it wanted.
    CHECK_NEAR(sim.angleOf(mob), kMobTurnRate * net::kTickSeconds, 1e-9);
    sim.tickIntent(20);
    CHECK_NEAR(sim.angleOf(mob), kPi / 2, 0.05);
}

TEST(reversed_mobs_face_away_from_where_they_are_going) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("roach", kOrigin);          // neutral, reversed art
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{400, 0});
    sim.hurt(mob, player);

    sim.tickIntent(15);
    CHECK_EQ(sim.brainOf(mob).target, player);
    // Travelling +x, drawn pointing -x.
    CHECK(sim.velocityOf(mob).x > 0.0);
    CHECK(std::fabs(sim.angleOf(mob)) > 2.9);
}

// ---------------------------------------------------------------------------
// Hostile
// ---------------------------------------------------------------------------

TEST(hostile_mob_charges_a_player_inside_its_range) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);    // range 300
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200, 0});

    const double before = sim.gap(mob, player);
    sim.tick(25);
    CHECK_EQ(sim.brainOf(mob).target, player);
    CHECK(sim.velocityOf(mob).x > 0.0);
    CHECK(sim.gap(mob, player) < before - 30.0);
}

TEST(hostile_mob_ignores_a_player_beyond_its_range) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{900, 0});                    // outside 300, inside LOD

    sim.tick(25);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    // It looked and found nobody -- as opposed to never having looked.
    CHECK(sim.totalScans > 0);
    CHECK_EQ(sim.totalSkipped, std::uint64_t(0));
}

TEST(a_raised_aggro_radius_is_noticed_from_further_away) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    // 200 past the mob's 300, but the player reads as 250 units closer.
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{500, 0}, 250.0);

    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, player);
}

TEST(aggro_drops_past_the_leash_and_holds_inside_it) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200, 0});
    sim.tickIntent(2);
    CHECK_EQ(sim.brainOf(mob).target, player);

    // Leash is 1.6x the 300 range, so 400 is still inside it.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{400, 0};
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, player);

    sim.world.get<Transform>(player).position = kOrigin + Vec2{600, 0};
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}

TEST(aggro_drops_when_the_target_dies) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{150, 0});
    sim.tickIntent(2);
    CHECK_EQ(sim.brainOf(mob).target, player);

    // Dead is a tag, so the corpse is still in the world this tick.
    sim.world.add<Dead>(player, Dead{mob});
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}

TEST(a_held_target_costs_no_further_broadphase_queries) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{150, 0});

    sim.tick(50);
    CHECK(sim.brainOf(mob).target != NULL_ENTITY);
    CHECK_EQ(sim.totalScans, std::uint64_t(1));
    CHECK_EQ(sim.totalConsidered, std::uint64_t(50));
}

TEST(retargeting_runs_on_the_decision_clock_not_every_tick) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("soldier_ant", kOrigin);
    // Visible to LOD, out of aggro range: the mob keeps looking and keeps
    // failing, which is the case that would scan every tick if it could.
    sim.spawnPlayer(kOrigin + Vec2{900, 0});

    sim.tick(50);                                   // two seconds
    CHECK_EQ(sim.totalConsidered, std::uint64_t(50));
    CHECK(sim.totalScans >= 2);                     // 500-750ms apart
    CHECK(sim.totalScans <= 5);
}

// ---------------------------------------------------------------------------
// Passive and neutral
// ---------------------------------------------------------------------------

TEST(passive_mob_never_seeks_a_player_standing_next_to_it) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{40, 0});

    sim.tick(30);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_EQ(sim.totalScans, std::uint64_t(0));     // passives never run the scan at all
    CHECK_EQ(sim.totalAttacks, std::uint64_t(0));
}

TEST(passive_mob_flees_its_attacker_then_resumes_wandering) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});

    sim.hurt(mob, player);
    sim.tick(3);
    CHECK_EQ(sim.brainOf(mob).target, player);
    CHECK(sim.brainOf(mob).fleeUntilMillis > sim.now);
    // Attacker is at +x, so the bee is heading -x.
    CHECK(sim.velocityOf(mob).x < 0.0);

    // Long enough for the scare to expire with no further hits.
    sim.tick(120);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.brainOf(mob).fleeUntilMillis, 0.0, 1e-12);
}

TEST(a_fleeing_mob_keeps_running_while_it_is_still_being_hit) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});

    // Hit once per second for four seconds -- longer than one flee window.
    for (int i = 0; i < 4; ++i) {
        sim.hurt(mob, player);
        sim.tick(25);
    }
    CHECK_EQ(sim.brainOf(mob).target, player);
    CHECK(sim.brainOf(mob).fleeUntilMillis > sim.now);
}

TEST(a_mob_with_no_damage_ledger_has_nobody_to_flee_from) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});
    sim.world.remove<Bounty>(mob);

    // The flash is lit but nothing recorded who lit it.
    sim.world.get<Health>(mob).flashUntilMillis = sim.now + 250.0;
    sim.tick(3);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.brainOf(mob).fleeUntilMillis, 0.0, 1e-12);
    (void)player;
}

TEST(neutral_mob_retaliates_only_after_it_is_hurt) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("worker_ant", kOrigin);     // neutral, range 300
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{150, 0});

    sim.tick(25);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_EQ(sim.totalScans, std::uint64_t(0));                 // it never went looking

    sim.hurt(mob, player);
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, player);
    CHECK(sim.velocityOf(mob).x > 0.0);                         // toward, not away
    CHECK_EQ(sim.totalScans, std::uint64_t(0));                 // still no broadphase query
}

TEST(neutral_mob_loses_interest_when_its_target_runs_far_enough) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("worker_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{150, 0});
    sim.hurt(mob, player);
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, player);

    sim.world.get<Transform>(player).position = kOrigin + Vec2{700, 0};
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}

TEST(retaliation_never_picks_a_target_the_leash_would_drop_the_same_tick) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("worker_ant", kOrigin);     // range 300, leash 480
    const Entity sniper = sim.spawnPlayer(kOrigin + Vec2{900, 0});

    sim.hurt(mob, sniper);
    sim.tickIntent(3);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_EQ(sim.totalScans, std::uint64_t(0));
}

TEST(a_passive_mob_stops_fleeing_an_attacker_that_died) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});
    sim.hurt(mob, player);
    sim.tickIntent(2);
    CHECK_EQ(sim.brainOf(mob).target, player);

    sim.world.add<Dead>(player, Dead{mob});
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.brainOf(mob).fleeUntilMillis, 0.0, 1e-12);
}

TEST(a_wandering_mob_drifts_but_stays_near_its_anchor) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("worker_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{600, 0});                    // in LOD, out of everything else

    sim.tick(400);                                              // sixteen seconds of walking
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    const double drifted = distance(sim.positionOf(mob), kOrigin);
    CHECK(drifted > 1.0);                                       // it did move
    // The homeward bias keeps it in its territory; one wander interval of
    // overshoot past kMobWanderRadius is expected, a walk to the next biome is not.
    CHECK(drifted < kMobWanderRadius * 2.0);
}

// ---------------------------------------------------------------------------
// Sandstorm and stationary
// ---------------------------------------------------------------------------

TEST(sandstorm_ignores_a_player_standing_in_it) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("sandstorm", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{25, 0});
    CHECK_EQ(sim.brainOf(mob).kind, AiKind::Sandstorm);

    sim.hurt(mob, player);                                      // provocation changes nothing
    sim.tick(40);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_EQ(sim.totalScans, std::uint64_t(0));
    CHECK_EQ(sim.totalAttacks, std::uint64_t(0));
    // Still blowing, and drawn upright (the config hides its rotation).
    CHECK(sim.velocityOf(mob).length() > 10.0);
    CHECK_NEAR(sim.angleOf(mob), 0.0, 1e-12);
}

TEST(a_sandstorm_heading_drifts_rather_than_being_re_rolled) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("sandstorm", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{300, 0});

    sim.tickIntent();
    const double first = sim.brainOf(mob).wanderAngle;
    sim.tickIntent(25);                                         // one second: one or two decisions
    const double later = sim.brainOf(mob).wanderAngle;
    CHECK(std::fabs(angleDelta(first, later)) <= kSandstormTurnPerDecision * 3.0 + 1e-9);
}

TEST(a_stationary_mob_never_moves) {
    CHECK(contentReady());
    Sim sim;
    const Entity nest = sim.spawnMob("ant_hole", kOrigin);
    sim.brainOf(nest).kind = AiKind::Stationary;
    sim.spawnPlayer(kOrigin + Vec2{50, 0});
    // Even carrying momentum from a knockback, it stops dead.
    sim.world.get<Motion>(nest).velocity = Vec2{120, -80};

    sim.tick(20);
    CHECK_NEAR(sim.velocityOf(nest).length(), 0.0, 1e-12);
    CHECK_NEAR(distance(sim.positionOf(nest), kOrigin), 0.0, 1e-12);
    CHECK_EQ(sim.brainOf(nest).target, NULL_ENTITY);
}

// ---------------------------------------------------------------------------
// Contact attacks
// ---------------------------------------------------------------------------

TEST(a_mob_in_contact_stamps_its_attack_on_the_configured_cadence) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);    // cooldown 2000ms
    sim.spawnPlayer(kOrigin + Vec2{10, 0});                     // well inside reach

    sim.tickIntent();
    CHECK_EQ(sim.totalAttacks, std::uint64_t(1));
    CHECK_NEAR(sim.brainOf(mob).lastAttackMillis, 10000.0, 1e-9);

    sim.tickIntent(40);                                         // 1.6s: still on cooldown
    CHECK_EQ(sim.totalAttacks, std::uint64_t(1));
    sim.tickIntent(20);                                         // past 2s
    CHECK_EQ(sim.totalAttacks, std::uint64_t(2));
}

TEST(a_mob_out_of_reach_does_not_stamp_an_attack) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{250, 0});

    sim.tickIntent(20);
    CHECK_EQ(sim.totalAttacks, std::uint64_t(0));
}

TEST(the_combat_hit_ledger_gates_the_attack_the_ai_intends) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{10, 0});

    // Combat says this victim was hit moments ago and is not due again.
    HitCooldowns hits;
    hits.arm(player, sim.now + 5000.0);
    sim.world.add<HitCooldowns>(mob, hits);

    sim.tickIntent(40);
    CHECK_EQ(sim.totalAttacks, std::uint64_t(0));
    CHECK_NEAR(sim.brainOf(mob).lastAttackMillis, 0.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Level of detail
// ---------------------------------------------------------------------------

TEST(mobs_further_than_the_active_radius_do_not_think) {
    CHECK(contentReady());
    Sim sim;
    const Entity near = sim.spawnMob("soldier_ant", kOrigin + Vec2{100, 0});
    const Entity far = sim.spawnMob("soldier_ant", kOrigin + Vec2{kMobActiveRadius + 500.0, 0});
    sim.spawnPlayer(kOrigin);

    sim.tick(10);
    CHECK_EQ(sim.totalConsidered, std::uint64_t(20));
    CHECK_EQ(sim.totalSkipped, std::uint64_t(10));
    CHECK(sim.velocityOf(near).length() > 0.0);
    CHECK_NEAR(sim.velocityOf(far).length(), 0.0, 1e-12);
    CHECK_NEAR(distance(sim.positionOf(far), kOrigin + Vec2{kMobActiveRadius + 500.0, 0}), 0.0, 1e-12);
}

TEST(nobody_watching_means_nobody_thinks) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});
    sim.autoActive = false;
    sim.active.clear();

    sim.tick(10);
    CHECK_EQ(sim.totalSkipped, std::uint64_t(10));
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.velocityOf(mob).length(), 0.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Segmented bodies
// ---------------------------------------------------------------------------

TEST(segments_trail_the_one_ahead_at_their_spacing) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin + Vec2{10, 0});
    const Entity second = sim.spawnMob("centipede_body", kOrigin + Vec2{20, 0});
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    link(sim, second, first, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    // Between intent and movement the chain is exact: each segment sits on the
    // one ahead's CURRENT position, and the walk is head-first so `second` sees
    // `first` already placed.
    sim.tickIntent();
    CHECK_NEAR(sim.gap(first, head), 40.0, 1e-9);
    CHECK_NEAR(sim.gap(second, first), 40.0, 1e-9);
    CHECK(sim.world.get<BodySegment>(head).head);
    CHECK_EQ(sim.world.get<BodySegment>(head).behind, first);
    CHECK_EQ(sim.world.get<BodySegment>(first).behind, second);
    CHECK_EQ(sim.world.get<BodySegment>(second).behind, NULL_ENTITY);

    // And once the head is moving, the body follows without stretching.
    sim.tick(40);
    CHECK_NEAR(sim.gap(first, head), 40.0, 6.0);
    CHECK_NEAR(sim.gap(second, first), 40.0, 6.0);
}

TEST(a_segment_on_top_of_its_leader_unfolds_instead_of_producing_nan) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin);   // exactly coincident
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    sim.tickIntent();
    CHECK(std::isfinite(sim.positionOf(first).x));
    CHECK(std::isfinite(sim.positionOf(first).y));
    CHECK_NEAR(sim.gap(first, head), 40.0, 1e-9);
}

TEST(a_segment_with_no_spacing_falls_back_to_its_own_body) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin + Vec2{5, 0});
    link(sim, head, NULL_ENTITY, 0.0);
    link(sim, first, head, 0.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    sim.tickIntent();
    const double radius = sim.world.get<Body>(first).radius;
    CHECK_NEAR(sim.gap(first, head), radius * kSegmentSpacingPerRadius, 1e-9);
}

TEST(a_decapitated_segment_is_promoted_and_keeps_its_own_tail) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin + Vec2{40, 0});
    const Entity second = sim.spawnMob("centipede_body", kOrigin + Vec2{80, 0});
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    link(sim, second, first, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});
    sim.tickIntent();

    sim.world.destroy(head);
    sim.tickIntent();
    CHECK(sim.world.get<BodySegment>(first).head);
    CHECK_EQ(sim.world.get<BodySegment>(first).ahead, NULL_ENTITY);
    CHECK(!sim.world.get<BodySegment>(second).head);
    CHECK_EQ(sim.world.get<BodySegment>(second).ahead, first);
    CHECK_EQ(sim.totalPromotions, std::uint64_t(1));

    // The promoted half is an animal again: it steers under its own AI.
    sim.tick(30);
    CHECK(sim.velocityOf(first).length() > 0.0);
    CHECK_NEAR(sim.gap(second, first), 40.0, 6.0);
}

TEST(a_segment_behind_a_corpse_is_promoted_before_the_reaper_runs) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin + Vec2{40, 0});
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    // Dead, but not yet destroyed -- the state every system sees mid-tick.
    sim.world.add<Dead>(head, Dead{NULL_ENTITY});
    sim.tickIntent();
    CHECK(sim.world.get<BodySegment>(first).head);
    CHECK_EQ(sim.totalPromotions, std::uint64_t(1));
}

TEST(a_cycle_in_the_chain_is_cut_rather_than_walked_forever) {
    CHECK(contentReady());
    Sim sim;
    const Entity a = sim.spawnMob("centipede_body", kOrigin);
    const Entity b = sim.spawnMob("centipede_body", kOrigin + Vec2{40, 0});
    link(sim, a, b, 40.0);
    link(sim, b, a, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    // No head exists, so nothing roots the walk; both are promoted instead.
    sim.tickIntent();
    CHECK(sim.world.get<BodySegment>(a).head);
    CHECK(sim.world.get<BodySegment>(b).head);
    CHECK_EQ(sim.totalPromotions, std::uint64_t(2));
}

TEST(two_segments_claiming_one_leader_do_not_make_the_chain_a_tree) {
    CHECK(contentReady());
    Sim sim;
    const Entity head = sim.spawnMob("centipede", kOrigin);
    const Entity first = sim.spawnMob("centipede_body", kOrigin + Vec2{40, 0});
    const Entity rogue = sim.spawnMob("centipede_body", kOrigin + Vec2{0, 40});
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    link(sim, rogue, head, 40.0);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    sim.tickIntent();
    const bool oneKept = sim.world.get<BodySegment>(first).head != sim.world.get<BodySegment>(rogue).head;
    CHECK(oneKept);
    CHECK_EQ(sim.totalPromotions, std::uint64_t(1));
}

TEST(a_distant_chain_is_still_walked_so_it_is_never_mistaken_for_a_cycle) {
    CHECK(contentReady());
    Sim sim;
    const Vec2 away = kOrigin + Vec2{kMobActiveRadius + 1000.0, 0};
    const Entity head = sim.spawnMob("centipede", away);
    const Entity first = sim.spawnMob("centipede_body", away + Vec2{40, 0});
    link(sim, head, NULL_ENTITY, 40.0);
    link(sim, first, head, 40.0);
    sim.spawnPlayer(kOrigin);

    sim.tickIntent(5);
    CHECK(!sim.world.get<BodySegment>(first).head);
    CHECK_EQ(sim.world.get<BodySegment>(first).ahead, head);
    CHECK_EQ(sim.totalPromotions, std::uint64_t(0));
    // Skipped, so nothing moved.
    CHECK_NEAR(distance(sim.positionOf(first), away + Vec2{40, 0}), 0.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Nests
// ---------------------------------------------------------------------------

namespace {

/// A stand-in for the spawning system's mob factory.
struct Hatchery {
    int calls = 0;
    MobSpawnRequest last;

    MobAiSystem::SpawnHook hook() {
        return [this](World& world, const MobSpawnRequest& request) {
            ++calls;
            last = request;
            const Entity child = world.create();
            world.add<MobTag>(child);
            world.add<Transform>(child, Transform{request.position, 0.0});
            return child;
        };
    }
};

Entity makeNest(Sim& sim, const char* childId, int maxAlive, int rarityOffset,
                Rarity rarity = Rarity::Rare) {
    const Entity nest = sim.spawnMob("ant_hole", kOrigin, rarity);
    sim.brainOf(nest).kind = AiKind::Stationary;

    Spawner spawner;
    spawner.childConfigIndex = content().mobIndex(childId);
    spawner.rarityOffset = rarityOffset;
    spawner.intervalMillis = 200.0;
    spawner.nextSpawnMillis = 0.0;
    spawner.childLifetimeMillis = 8000.0;
    spawner.maxAlive = maxAlive;
    sim.world.add<Spawner>(nest, spawner);
    return nest;
}

} // namespace

TEST(a_nest_fills_to_max_alive_and_then_stops) {
    CHECK(contentReady());
    Sim sim;
    Hatchery hatchery;
    sim.ai.setSpawnHook(hatchery.hook());
    const Entity nest = makeNest(sim, "baby_ant", 3, -1);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    sim.tick(40);                                   // 1.6s, room for eight intervals
    CHECK_EQ(hatchery.calls, 3);
    CHECK_EQ(sim.world.get<Spawner>(nest).children.size(), std::size_t(3));
    // A rare nest fields uncommon soldiers.
    CHECK_EQ(hatchery.last.rarity, Rarity::Uncommon);
    CHECK_EQ(hatchery.last.parent, nest);
    CHECK_EQ(hatchery.last.configIndex, content().mobIndex("baby_ant"));
    CHECK_NEAR(hatchery.last.lifetimeMillis, 8000.0, 1e-12);

    sim.tick(200);
    CHECK_EQ(hatchery.calls, 3);
    CHECK_EQ(sim.totalSpawnRequests, std::uint64_t(3));
}

TEST(a_nest_tops_up_after_a_child_dies_and_never_counts_a_corpse) {
    CHECK(contentReady());
    Sim sim;
    Hatchery hatchery;
    sim.ai.setSpawnHook(hatchery.hook());
    const Entity nest = makeNest(sim, "baby_ant", 2, 0);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    sim.tick(20);
    CHECK_EQ(sim.world.get<Spawner>(nest).children.size(), std::size_t(2));

    // One escort is tagged dead (still in the world), the other is destroyed
    // outright. Neither may go on occupying a slot.
    const Entity tagged = sim.world.get<Spawner>(nest).children[0];
    const Entity destroyed = sim.world.get<Spawner>(nest).children[1];
    sim.world.add<Dead>(tagged, Dead{NULL_ENTITY});
    sim.world.destroy(destroyed);

    sim.tick(20);
    CHECK_EQ(hatchery.calls, 4);
    CHECK_EQ(sim.world.get<Spawner>(nest).children.size(), std::size_t(2));
    for (const Entity child : sim.world.get<Spawner>(nest).children) {
        CHECK(child != tagged);
        CHECK(child != destroyed);
    }
}

TEST(a_dying_nest_releases_its_brood_rather_than_taking_it_along) {
    CHECK(contentReady());
    Sim sim;
    Hatchery hatchery;
    sim.ai.setSpawnHook(hatchery.hook());
    const Entity nest = makeNest(sim, "baby_ant", 3, 0);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});
    sim.tick(40);
    const std::vector<Entity> brood = sim.world.get<Spawner>(nest).children;
    CHECK_EQ(brood.size(), std::size_t(3));

    sim.world.add<Dead>(nest, Dead{NULL_ENTITY});
    sim.tick(10);
    CHECK(sim.world.get<Spawner>(nest).children.empty());
    for (const Entity child : brood) CHECK(sim.world.isAlive(child));
    CHECK_EQ(hatchery.calls, 3);                    // and it spawned nothing more
}

TEST(a_nest_with_no_spawn_hook_keeps_its_cadence_and_produces_nothing) {
    CHECK(contentReady());
    Sim sim;
    const Entity nest = makeNest(sim, "baby_ant", 3, 0);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    sim.tick(40);
    CHECK(sim.world.get<Spawner>(nest).children.empty());
    CHECK_EQ(sim.totalSpawnRequests, std::uint64_t(0));
}

TEST(a_nest_cannot_overshoot_when_several_ticks_flush_at_once) {
    CHECK(contentReady());
    Sim sim;
    Hatchery hatchery;
    sim.ai.setSpawnHook(hatchery.hook());
    const Entity nest = makeNest(sim, "baby_ant", 2, 0);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    // Four ticks' worth of requests, all deferred into one flush -- the
    // children list is empty for every one of the decisions.
    CommandBuffer commands(sim.world);
    for (int i = 0; i < 4; ++i) {
        sim.rebuildGrid();
        sim.refreshActive();
        sim.ai.run(sim.world, sim.terrain, sim.grid, sim.active, sim.now, sim.dt, commands);
        sim.accumulate();
        sim.now += 250.0;
    }
    CHECK_EQ(sim.totalSpawnRequests, std::uint64_t(4));
    commands.flush();
    CHECK_EQ(hatchery.calls, 2);
    CHECK_EQ(sim.world.get<Spawner>(nest).children.size(), std::size_t(2));
}

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

TEST(a_slow_reduces_the_speed_the_mob_asks_for) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);    // 2.4 config units = 96 u/s
    sim.spawnPlayer(kOrigin + Vec2{280, 0});

    sim.tickIntent(30);
    const double full = sim.velocityOf(mob).length();
    CHECK_NEAR(full, 96.0, 1.0);

    Afflictions slow;
    slow.slowFactor = 0.5;
    slow.slowUntilMillis = sim.now + 60000.0;
    sim.world.add<Afflictions>(mob, slow);
    sim.tickIntent(30);
    CHECK_NEAR(sim.velocityOf(mob).length(), 48.0, 1.0);
}

TEST(a_mob_type_outside_the_content_tables_is_inert_rather_than_undefined) {
    CHECK(contentReady());
    Sim sim;
    const Entity e = sim.world.create();
    sim.world.add<MobTag>(e);
    sim.world.add<Transform>(e, Transform{kOrigin, 0.0});
    sim.world.add<Motion>(e, Motion{Vec2{50, 50}});
    sim.world.add<Body>(e, Body{20.0, 1.0});
    sim.world.add<MobType>(e, MobType{60000, Rarity::Common, 1.0});
    MobAi brain;
    brain.kind = AiKind::Hostile;
    brain.anchor = kOrigin;
    brain.aggroRange = 400.0;
    sim.world.add<MobAi>(e, brain);
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    sim.tick(60);
    // It thought, it found the player, and it was given nothing to move with:
    // the velocity it started with decays away and none replaces it.
    CHECK(sim.brainOf(e).target != NULL_ENTITY);
    CHECK_NEAR(sim.velocityOf(e).length(), 0.0, 1e-6);
}

TEST(a_pet_is_not_steered_by_the_wild_mob_ai) {
    CHECK(contentReady());
    Sim sim;
    const Entity pet = sim.spawnMob("soldier_ant", kOrigin);
    sim.world.add<Pet>(pet, Pet{NULL_ENTITY, 0});
    sim.spawnPlayer(kOrigin + Vec2{100, 0});

    sim.tick(20);
    CHECK_EQ(sim.totalConsidered, std::uint64_t(0));
    CHECK_EQ(sim.brainOf(pet).target, NULL_ENTITY);
    CHECK_NEAR(sim.velocityOf(pet).length(), 0.0, 1e-12);
}

TEST(a_dead_mob_stops_steering) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{150, 0});
    sim.tick(10);
    CHECK(sim.velocityOf(mob).length() > 0.0);

    sim.world.add<Dead>(mob, Dead{NULL_ENTITY});
    sim.world.get<Motion>(mob).velocity = Vec2{0, 0};
    sim.tick(10);
    CHECK_EQ(sim.totalConsidered, std::uint64_t(10));            // ten from before the death
    CHECK_NEAR(sim.velocityOf(mob).length(), 0.0, 1e-12);
}

TEST(a_degenerate_time_step_is_a_no_op) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{150, 0});
    sim.world.get<Motion>(mob).velocity = Vec2{7, -3};
    sim.rebuildGrid();
    sim.refreshActive();

    CommandBuffer commands(sim.world);
    for (const double step : {0.0, -0.02, std::nan("")}) {
        sim.ai.run(sim.world, sim.terrain, sim.grid, sim.active, sim.now, step, commands);
        CHECK_EQ(sim.ai.stats().considered, std::uint64_t(0));
        CHECK_NEAR(sim.velocityOf(mob).x, 7.0, 1e-12);
        CHECK_NEAR(sim.velocityOf(mob).y, -3.0, 1e-12);
        CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    }
    CHECK(commands.empty());
}

TEST(a_mob_does_not_aggro_through_a_wall) {
    CHECK(contentReady());
    Sim sim;
    // A solid column of tiles between the two, spanning the mob's whole range.
    const int wallTx = Terrain::toTileCoord(kOrigin.x) + 1;
    for (int ty = 0; ty < kTilesPerAxis; ++ty) sim.terrain.setTile(wallTx, ty, Tile::Wall);

    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(Terrain::tileCenter(wallTx + 1, Terrain::toTileCoord(kOrigin.y)));

    sim.tickIntent(10);
    CHECK(sim.totalScans > 0);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}
