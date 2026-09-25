#include "test.h"

#include "server/systems/mob_ai.h"

// The hold below is sized against the CLIENT's facing ease, so the test that
// guards it reads that rate from the client rather than restating it.
#include "client/interpolation.h"

#include "shared/game/config.h"
#include "shared/game/spatial.h"
#include "shared/game/terrain.h"

#include <sys/stat.h>

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

using namespace flix;

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

/// loadContent() takes one directory and the two files do not live in one,
/// so they are staged into a scratch directory here. The staged copy is the
/// shipped bytes verbatim, so a test file that loads content before or after
/// this one ends up with exactly the same registry.
bool contentReady() {
    static const bool ok = [] {
        std::string mobs, petals;
        if (!readText(firstExisting({testsDir() + "/../../src/mobs.json", "data/mobs.json",
                                     "../src/mobs.json", "../../src/mobs.json", "src/mobs.json"}), mobs)) return false;
        if (!readText(firstExisting({testsDir() + "/../../src/petals.json", "data/petals.json",
                                     "../src/petals.json", "../../src/petals.json", "src/petals.json"}), petals)) return false;

        const char* env = std::getenv("TMPDIR");
        std::string dir = (env != nullptr && *env != '\0') ? env : "/tmp";
        if (dir.back() != '/') dir.push_back('/');
        dir += "flix_mob_ai_tests";
        mkdir(dir.c_str(), 0755);
        if (!writeText(dir + "/mobs.json", mobs)) return false;
        if (!writeText(dir + "/petals.json", petals)) return false;

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

    std::vector<RealmPoint> active;
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
        brain.kind = stats.ai;
        brain.anchor = at;
        brain.aggroRange = stats.aggroRange;
        world.add<MobAi>(e, brain);

        // As SpawnSystem does: a ring that is ammunition is stocked at spawn,
        // seats and seeds both.
        const PetalRingSpec& spec = content().mob(index).petalRing;
        if (spec.present && spec.shootOnHit && spec.petalIndex != kInvalidIndex) {
            const PetalStats seed = content().petalStats(spec.petalIndex, rarity);
            MobPetalRing ring;
            ring.seats.assign(static_cast<std::size_t>(spec.count), NULL_ENTITY);
            ring.orbit = stats.radius * spec.orbitScale;
            ring.seedRadius = stats.radius * spec.hitScale;
            world.add<MobPetalRing>(e, ring);
            for (int i = 0; i < spec.count; ++i) {
                const double bearing = i * (kTau / spec.count);
                const Entity petal = world.create();
                world.add<MobRingPetal>(petal, MobRingPetal{e, static_cast<std::size_t>(i),
                                                            seed.noHealDurationMillis});
                world.add<Transform>(
                    petal, Transform{at + Vec2::fromAngle(bearing, ring.orbit), bearing});
                world.add<Body>(petal, Body{ring.seedRadius, 1.0});
                world.add<Faction>(petal, Faction{Team::Hostiles, false});
                world.add<Health>(petal, Health{seed.health, seed.health, 0, 0});
                world.add<ContactDamage>(petal, ContactDamage{stats.damage, kMobHitIntervalMillis});
                world.add<HitCooldowns>(petal);
                world.get<MobPetalRing>(e).seats[static_cast<std::size_t>(i)] = petal;
            }
        }
        return e;
    }

    /// Seeds still seated on `mob`.
    int ringOf(Entity mob) {
        const MobPetalRing* ring = world.tryGet<MobPetalRing>(mob);
        if (ring == nullptr) return -1;
        int seated = 0;
        for (const Entity seed : ring->seats) {
            if (seed != NULL_ENTITY) ++seated;
        }
        return seated;
    }

    /// Shots in flight. The ring pass defers its create, so this is only
    /// meaningful after the tick that fired has flushed.
    std::size_t shots() {
        std::size_t count = 0;
        Query<Projectile> live{world};
        live.each([&](Entity, Projectile&) { ++count; });
        return count;
    }

    Entity spawnPlayer(Vec2 at, double aggroBonus = 0.0, double aggroRangeScale = 1.0) {
        const Entity e = world.create();
        world.add<PlayerTag>(e);
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{kPlayerBaseRadius, 1.0});
        world.add<Health>(e, Health{kPlayerBaseHealth, kPlayerBaseHealth, 0, 0});
        PlayerModifiers mods;
        mods.aggroRadiusBonus = aggroBonus;
        mods.aggroRangeScale = aggroRangeScale;
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
            grid.insert(e, Realm::Overworld, transform.position, body != nullptr ? body->radius : 0.0);
        });
    }

    void refreshActive() {
        if (!autoActive) return;
        active.clear();
        players.each([&](Entity, PlayerTag&, Transform& transform) {
            active.push_back({transform.position, transform.realm});
        });
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
            // After the stand-in movement, which is where GameServer calls it:
            // a seat is a rigid offset from a body that has just moved.
            ai.tickPetalRings(world, commands);
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

TEST(a_mob_faces_its_new_heading_on_the_tick_it_picks_it) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{0, 250});

    sim.tickIntent();
    // The reference assigns a mob's facing outright from the vector it is
    // travelling along -- `Math.atan2(moveY * speed, moveX * speed)`, with no
    // rate limit anywhere -- so the quarter turn onto the target is paid in
    // full on the tick the target is picked. Easing there instead would leave
    // the sprite aimed at where the mob used to be going for a third of a
    // second, which is most of a hop.
    CHECK_NEAR(sim.angleOf(mob), kPi / 2, 1e-9);
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

TEST(an_idle_hop_is_the_same_fraction_of_the_body_at_every_tier) {
    CHECK(contentReady());

    // THE LAW this drift is built on: a hop carries a mob a fixed fraction of
    // its own body, whatever tier it is. The acceleration is stated per body
    // (sizeFactor) and the pulse durations are fixed, so the distance follows
    // -- and a mob you can see is a mob moving relative to its own width, not
    // one moving some absolute number of units.
    //
    // It used to break above mythic. The CEILING on the drift was a flat 300
    // sitting over an acceleration measured in bodies, the two crossed just
    // past mythic, and from there up the clamp cancelled the scaling: ultra
    // hopped 1.03 bodies, super 0.73, unique 0.49 and an apex 0.32 -- a mob
    // wider than the viewport inching a third of its own width while a common
    // one crossed a full body and a sixth. See kMaxWanderSpeedPerBody.
    //
    // Measured as PATH LENGTH rather than displacement, so the answer does not
    // depend on which way the two hops in the window happened to be aimed.
    const auto bodiesTravelled = [](Rarity rarity) {
        Sim sim;
        sim.autoActive = false;          // nobody watching: the LOD's permissive case
        const Entity spider = sim.spawnMob("spider", kOrigin, rarity);
        const double radius = sim.world.get<Body>(spider).radius;
        double path = 0.0;
        for (int i = 0; i < 240; ++i) {  // 8s at 30 TPS: two full hop cycles
            sim.tickIntent();
            path += sim.velocityOf(spider).length() * sim.dt;
        }
        return path / (2.0 * radius);
    };

    const double common = bodiesTravelled(Rarity::Common);
    CHECK(common > 0.5);                 // it really did hop
    for (int t = 0; t < kRarityCount; ++t) {
        CHECK_NEAR(bodiesTravelled(clampRarity(t)), common, 1e-3);
    }
}

TEST(hostile_mob_charges_a_player_inside_its_range) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);    // range 300
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200, 0});

    const double before = sim.gap(mob, player);
    sim.tick(10);
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

TEST(worn_poo_shrinks_the_range_a_mob_notices_that_player_from) {
    CHECK(contentReady());
    // 270 past the skin: inside a soldier ant's 300, outside the 225 a common
    // poo leaves it. The bare flower beside it is the control.
    Sim hidden;
    const Entity mob = hidden.spawnMob("soldier_ant", kOrigin);
    const double skin = hidden.world.get<Body>(mob).radius;
    hidden.spawnPlayer(kOrigin + Vec2{skin + 270.0, 0}, 0.0, 0.75);
    hidden.tickIntent(5);
    CHECK_EQ(hidden.brainOf(mob).target, NULL_ENTITY);
    CHECK(hidden.totalScans > 0);

    Sim seen;
    const Entity control = seen.spawnMob("soldier_ant", kOrigin);
    const Entity bare = seen.spawnPlayer(kOrigin + Vec2{skin + 270.0, 0});
    seen.tickIntent(5);
    CHECK_EQ(seen.brainOf(control).target, bare);

    // Inside the shrunk range it is noticed as ever.
    Sim close;
    const Entity near = close.spawnMob("soldier_ant", kOrigin);
    const Entity stinky = close.spawnPlayer(kOrigin + Vec2{skin + 200.0, 0}, 0.0, 0.75);
    close.tickIntent(5);
    CHECK_EQ(close.brainOf(near).target, stinky);
}

TEST(poo_shrinks_only_the_range_past_the_skin) {
    CHECK(contentReady());
    // Apex poo leaves a 300 range at about 17 units, but a flower standing at
    // the mob's skin is noticed however little range is left.
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const double skin = sim.world.get<Body>(mob).radius;
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{skin + 10.0, 0}, 0.0, std::pow(0.75, 10));
    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, player);
}

TEST(a_mob_picks_the_bare_flower_over_a_nearer_one_wearing_poo) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const double skin = sim.world.get<Body>(mob).radius;
    // 180 out is 45 inside the 225 a common poo leaves; 220 out is 80 inside
    // a bare 300. The poo flower is nearer, but the bare one stands out more.
    sim.spawnPlayer(kOrigin + Vec2{skin + 180.0, 0}, 0.0, 0.75);
    const Entity bare = sim.spawnPlayer(kOrigin + Vec2{-(skin + 220.0), 0});
    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, bare);
}

TEST(aggro_holds_far_outside_the_aggro_range_and_drops_at_five_viewports) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200, 0});
    sim.tickIntent(2);
    CHECK_EQ(sim.brainOf(mob).target, player);

    // There is no leash on the aggro range. The reference keeps an acquired
    // target while it is within `VIEWPORT_WIDTH * 5` and still visible, so a
    // soldier ant with 300 units of range follows a flower far past it -- that
    // is what makes a mob you woke up chase you across the section.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{5000, 0};
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, player);

    // Past the retain radius it is dropped, and cannot be re-acquired from
    // there either. Five ticks because a mob that far from every player is
    // outside the LOD active radius and thinks one tick in five.
    sim.world.get<Transform>(player).position =
        kOrigin + Vec2{kMobTargetRetainRadius + 500.0, 0};
    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}

TEST(an_aggro_range_past_the_retain_radius_acquires_only_what_it_can_hold) {
    CHECK(contentReady());
    // Top-tier ranges outgrow the retain radius. Past it a mob would lock on
    // and let go on alternate ticks, so acquisition stops where retention does.
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    sim.world.get<MobAi>(mob).aggroRange = kMobTargetRetainRadius * 2.0;
    const Entity player =
        sim.spawnPlayer(kOrigin + Vec2{kMobTargetRetainRadius + 200.0, 0}, 500.0);
    sim.tickIntent(10);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);

    sim.world.get<Transform>(player).position =
        kOrigin + Vec2{kMobTargetRetainRadius - 200.0, 0};
    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, player);
    sim.tickIntent(10);
    CHECK_EQ(sim.brainOf(mob).target, player);
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

TEST(a_mob_with_nothing_to_chase_goes_looking_again_every_tick) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("soldier_ant", kOrigin);
    // Visible to LOD, out of aggro range: the mob keeps looking and keeps
    // failing, which is the case a decision clock would have throttled.
    sim.spawnPlayer(kOrigin + Vec2{900, 0});

    sim.tick(50);                                   // two seconds
    CHECK_EQ(sim.totalConsidered, std::uint64_t(50));
    // The reference pays the broadphase query per mob per tick whenever the
    // cached target fails to revalidate; only a HELD target skips it (see
    // a_held_target_costs_no_further_broadphase_queries). Putting the scan on
    // a clock instead makes a mob ignore a player who walks up to it for as
    // long as the clock says, which reads as the field lagging the flower.
    CHECK_EQ(sim.totalScans, std::uint64_t(50));
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

TEST(a_passive_mob_that_is_hit_neither_retaliates_nor_bolts) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);            // common bee: passive
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});

    sim.hurt(mob, player);
    sim.tick(3);
    // The reference has no mob flee state at all: `ai_type: passive` never
    // acquires a target, and being hit provokes only a NEUTRAL mob (which is
    // what a bee becomes from rare up). A common bee being shot keeps hopping
    // about on the idle machine -- which is why it stays inside the ring that
    // is hitting it rather than bolting out of reach.
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.brainOf(mob).fleeUntilMillis, 0.0, 1e-12);

    sim.tick(120);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    // Still drifting around where it was, not four seconds of flight away.
    CHECK(distance(sim.positionOf(mob), kOrigin) < kEnemyWanderRange * 2.0);
}

TEST(no_amount_of_damage_turns_a_passive_mob_on_its_attacker) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("bee", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});

    // Hit once per second for four seconds. Over there this is four more
    // entries on the damage ledger and nothing else: the provocation path is
    // gated on `ai_type: neutral`, so a passive mob's ledger is only ever read
    // to decide who gets the XP.
    for (int i = 0; i < 4; ++i) {
        sim.hurt(mob, player);
        sim.tick(25);
    }
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
    CHECK_NEAR(sim.brainOf(mob).fleeUntilMillis, 0.0, 1e-12);
    CHECK_EQ(sim.totalScans, std::uint64_t(0));   // and it never went looking
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

    // Same retain radius as a hostile mob's: the provoked target is held
    // until it is five viewports away, not until it leaves the aggro range.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{700, 0};
    sim.tickIntent();
    CHECK_EQ(sim.brainOf(mob).target, player);

    sim.world.get<Transform>(player).position =
        kOrigin + Vec2{kMobTargetRetainRadius + 500.0, 0};
    sim.tickIntent(5);
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
}

TEST(retaliation_reaches_further_than_the_mobs_own_aggro_range) {
    CHECK(contentReady());
    Sim sim;
    Sim far;
    {
        // Provocation is not bounded by the aggro range over there: the damage
        // handler writes the target outright and the AI only ever validates it
        // against the retain radius. Three times its own range is still a
        // target a worker ant comes for.
        const Entity mob = sim.spawnMob("worker_ant", kOrigin);   // range 300
        const Entity sniper = sim.spawnPlayer(kOrigin + Vec2{900, 0});
        sim.hurt(mob, sniper);
        sim.tickIntent(3);
        CHECK_EQ(sim.brainOf(mob).target, sniper);
        CHECK_EQ(sim.totalScans, std::uint64_t(0));   // and never a broadphase query
    }
    {
        // Past the retain radius, though, the validator drops it on the very
        // tick it was adopted: retaliation never leaves a mob charging the
        // horizon after something it can no longer reach.
        const Entity mob = far.spawnMob("worker_ant", kOrigin);
        const Entity sniper =
            far.spawnPlayer(kOrigin + Vec2{kMobTargetRetainRadius + 500.0, 0});
        far.hurt(mob, sniper);
        far.tickIntent(5);
        CHECK_EQ(far.brainOf(mob).target, NULL_ENTITY);
        CHECK_EQ(far.totalScans, std::uint64_t(0));
    }
}

TEST(a_neutral_mob_lets_go_of_the_provoker_that_died) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("worker_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{60, 0});
    sim.hurt(mob, player);
    sim.tickIntent(2);
    CHECK_EQ(sim.brainOf(mob).target, player);

    sim.world.add<Dead>(player, Dead{mob});
    sim.tickIntent(2);
    // Dropped by the same revalidation a hostile mob runs -- and NOT picked up
    // again, because provocation only fires when the damage ledger grows and a
    // corpse deals no more damage.
    CHECK_EQ(sim.brainOf(mob).target, NULL_ENTITY);
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

TEST(mobs_further_than_the_active_radius_think_one_tick_in_five) {
    CHECK(contentReady());
    Sim sim;
    const Entity near = sim.spawnMob("soldier_ant", kOrigin + Vec2{100, 0});
    const Entity far = sim.spawnMob("soldier_ant", kOrigin + Vec2{kMobActiveRadius + 500.0, 0});
    sim.spawnPlayer(kOrigin);

    sim.tick(10);
    CHECK_EQ(sim.totalConsidered, std::uint64_t(20));
    // Not frozen: a distant mob simulates at a FIFTH of the rate, which is
    // what stops the far world draining into wall lines while nobody is
    // looking at it. Ten ticks buy the far mob two of them.
    CHECK_EQ(sim.totalSkipped, std::uint64_t(10 - 10 / kMobFarStride));
    CHECK(sim.velocityOf(near).length() > 0.0);
    // The near mob has a player to chase; the far one has nothing in range and
    // stays near where it was put.
    CHECK(distance(sim.positionOf(far), kOrigin + Vec2{kMobActiveRadius + 500.0, 0}) <
          kEnemyWanderRange);
}

TEST(a_boss_thinks_every_tick_however_far_from_everybody_it_stands) {
    // The one exception to the level of detail, and the reason it is worth
    // making: a boss is placed live wherever its band rolled it, announced to
    // the whole server and raided. There are a handful in the world at once,
    // and one of them stuttering at a fifth speed until somebody gets within
    // five thousand units is a boss visibly asleep in front of the raid
    // walking up to it.
    CHECK(contentReady());
    Sim sim;
    const Vec2 away = kOrigin + Vec2{kMobActiveRadius + 500.0, 0};
    sim.spawnMob("soldier_ant", away);                    // scenery, at the same spot
    sim.spawnMob("soldier_ant", away + Vec2{200, 0}, Rarity::Super);
    sim.spawnPlayer(kOrigin);

    sim.tick(10);
    CHECK_EQ(sim.totalConsidered, std::uint64_t(20));
    // Ten skipped ticks from the ordinary mob (all but its two strided ones),
    // and not one from the boss.
    CHECK_EQ(sim.totalSkipped, std::uint64_t(10 - 10 / kMobFarStride));
}

TEST(an_empty_activity_field_is_permissive_not_a_freeze) {
    CHECK(contentReady());
    Sim sim;
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{100, 0});
    sim.autoActive = false;
    sim.active.clear();

    sim.tick(10);
    // An EMPTY activity field means "everything is active", exactly as the
    // reference's MobActivityField does -- with nobody connected the tick
    // early-returns anyway, and a test or bench that forgets to publish the
    // players must see unmodified behaviour rather than a world at a fifth
    // speed. Only a field that HAS players and does not list this one throttles
    // (see mobs_further_than_the_active_radius_think_one_tick_in_five).
    CHECK_EQ(sim.totalSkipped, std::uint64_t(0));
    CHECK_EQ(sim.brainOf(mob).target, player);
    CHECK(sim.velocityOf(mob).length() > 0.0);
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
    const Entity mob = sim.spawnMob("soldier_ant", kOrigin);    // player-speed chaser: 300 u/s
    sim.spawnPlayer(kOrigin + Vec2{280, 0});

    sim.tickIntent(30);
    const double full = sim.velocityOf(mob).length();
    CHECK_NEAR(full, 300.0, 1.0);

    Afflictions slow;
    slow.slowFactor = 0.5;
    slow.slowUntilMillis = sim.now + 60000.0;
    sim.world.add<Afflictions>(mob, slow);
    sim.tickIntent(30);
    CHECK_NEAR(sim.velocityOf(mob).length(), 150.0, 1.0);
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
    // The wild pass never sees it -- a pet is on the pet query, and the two do
    // not overlap.
    CHECK_EQ(sim.totalConsidered, std::uint64_t(0));
    // And it does not hunt the flower standing next to it: a pet's target is a
    // wild MOB, and there is not one in this world.
    CHECK_EQ(sim.brainOf(pet).target, NULL_ENTITY);
    // An ownerless pet is not frozen either -- the reference wanders it, at
    // the wander step rather than a chase -- so it drifts around where it was
    // rather than closing on the player.
    CHECK(distance(sim.positionOf(pet), kOrigin) < kEnemyWanderRange * 2.0);
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

// ---------------------------------------------------------------------------
// Volleys
// ---------------------------------------------------------------------------

namespace {

/// The one shot a volley left in the world, or NULL_ENTITY while the shooter
/// is still on cooldown.
Entity firstShot(Sim& sim) {
    Query<ProjectileTag, Transform, Body, Motion, Projectile> shots(sim.world);
    Entity found = NULL_ENTITY;
    shots.each([&](Entity e, ProjectileTag&, Transform&, Body&, Motion&, Projectile&) {
        if (found == NULL_ENTITY) found = e;
    });
    return found;
}

/// How many shots a volley has put in the world. Under tickIntent() nothing
/// moves or expires, so this only ever counts up: it is a fire counter.
int shotCount(Sim& sim) {
    Query<ProjectileTag> shots(sim.world);
    int n = 0;
    shots.each([&](Entity, ProjectileTag&) { ++n; });
    return n;
}

/// Ticks until the shooter fires, so the test does not depend on the mob's
/// decision cadence.
Entity fireAndCatch(Sim& sim, int maxTicks = 200) {
    for (int i = 0; i < maxTicks; ++i) {
        sim.tick();
        const Entity shot = firstShot(sim);
        if (shot != NULL_ENTITY) return shot;
    }
    return NULL_ENTITY;
}

} // namespace

TEST(a_hornets_missile_inherits_the_hornets_size) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    const Entity shot = fireAndCatch(sim);
    CHECK(shot != NULL_ENTITY);

    // A hornet is a size-1.3 mob, so its missiles are 1.3x what a size-1
    // shooter of the same tier fires -- which is the whole of "a projectile
    // inherits the size of the entity that spawned it". Derived from the
    // shooter's BODY here for the same reason the server derives it there: it
    // is the one number that already carries both the authored size and the
    // rarity step.
    const std::uint16_t ammo = content().petalIndex("hornet_missile");
    const PetalStats stats = content().petalStats(ammo, Rarity::Common);
    const double ownerScale = sim.world.get<Body>(hornet).radius / kMobBaseRadius;
    const double expected =
        std::max(1.0, stats.size * kProjectileRadiusPerSize * ownerScale / kProjectileSizeDivisor);
    CHECK_NEAR(sim.world.get<Body>(shot).radius, expected, 1e-9);
    CHECK(ownerScale > 1.25);   // the 1.3 is really reaching the shot

    // And it is a body, not a token: a mass on the same area scale a mob's
    // uses, and the ammunition's own health as the pool that lets it
    // penetrate.
    CHECK_NEAR(sim.world.get<Body>(shot).mass, projectileMass(expected), 1e-12);
    CHECK_NEAR(sim.world.get<Health>(shot).max, stats.health, 1e-9);
    CHECK(sim.world.has<HitCooldowns>(shot));
}

TEST(a_stinger_shooter_comes_round_before_it_fires) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    // Inside the hornet's 300-unit aggro range, measured from its skin: with
    // nothing integrating velocity below, a flower out of range never comes
    // into it.
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{250, 0});

    // The INTENT phase only, so nothing but the AI moves anything: the mob
    // stays put and the bearing to the flower stays due east for the whole
    // manoeuvre.
    int ticksTurning = 0;
    Entity shot = NULL_ENTITY;
    for (int i = 0; i < 200 && shot == NULL_ENTITY; ++i) {
        sim.tickIntent();
        shot = firstShot(sim);
        if (shot == NULL_ENTITY) ++ticksTurning;
    }
    CHECK(shot != NULL_ENTITY);
    if (shot == NULL_ENTITY) return;

    // The turn was a MANOEUVRE and not a snap. A hornet on a 2 s cadence gets
    // its first volley on the tick the cooldown allows one, so anything past
    // that tick is time spent coming round.
    CHECK(ticksTurning > 1);

    // Tail on the flower when the missile went, not face.
    const double bearing = (sim.positionOf(player) - sim.positionOf(hornet)).angle();
    const double tail = wrapAngle(sim.angleOf(hornet) + kPi);
    CHECK(std::fabs(angleDelta(tail, bearing)) <= kStingerAimTolerance + 1e-9);
    // Which is to say it is pointing AWAY: the player is due east and the
    // hornet is looking west.
    CHECK(std::cos(sim.angleOf(hornet)) < 0.0);

    // And the missile still goes at the flower, from the stinger end -- a body
    // radius out along the shot rather than out of the mob's middle.
    const Vec2 launch = sim.world.get<Motion>(shot).velocity;
    CHECK(launch.x > 0.0);
    // Measured against the shooter AFTER it has rocked back, so the gap is the
    // muzzle offset plus however much of the recoil cap the volley spent.
    const Vec2 muzzle = sim.world.get<Transform>(shot).position - sim.positionOf(hornet);
    const double radius = sim.world.get<Body>(hornet).radius;
    CHECK(muzzle.length() >= radius - 1e-9);
    CHECK(muzzle.length() <= radius + kProjectileMaxRecoil + 1e-9);
    CHECK(muzzle.x > 0.0);
}

TEST(a_stinger_shooter_holds_the_pose_before_it_shoots) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{250, 0});

    const auto bearing = [&] {
        return (sim.positionOf(player) - sim.positionOf(hornet)).angle();
    };
    // The same measure the volley gate uses: how far the TAIL is off the
    // flower, which is a half turn less the nose's offset.
    const auto aimed = [&] {
        return kPi - std::fabs(angleDelta(bearing(), sim.angleOf(hornet))) <=
               kStingerAimTolerance;
    };

    // Up to the tick it comes round -- and nothing fires on the way. This is
    // the OPENING shot of an engagement, whose cooldown expired long before
    // the mob ever saw a flower; it is telegraphed like every other one rather
    // than going off the instant the mob is round.
    int ticksToAim = -1;
    for (int i = 0; i < 200; ++i) {
        sim.tickIntent();
        CHECK_EQ(shotCount(sim), 0);
        if (aimed()) { ticksToAim = i + 1; break; }
    }
    CHECK(ticksToAim > 0);

    // Then it SITS there, still not shooting. The hold is what the drawn mob
    // needs: the client eases toward the server's facing rather than replaying
    // it, so a volley let go on the tick the SERVER comes round leaves a mob
    // the player can see is still side-on. Holding lets that gap decay.
    int ticksHeld = 0;
    for (int i = 0; i < 200; ++i) {
        sim.tickIntent();
        if (shotCount(sim) > 0) break;
        CHECK(aimed());                 // and never drifts off the pose while it waits
        ++ticksHeld;
    }
    CHECK_EQ(shotCount(sim), 1);
    // It really waited, and it waited as long as the constant says.
    CHECK(ticksHeld > 0);
    CHECK_NEAR(ticksHeld * net::kTickMillis, kStingerAimHoldMillis, net::kTickMillis * 2.0);

    // And the constant is long enough to do the job it exists for. Anchored to
    // the CLIENT's ease rather than to itself: the drawn facing closes on the
    // server's exponentially, so a hold of two time constants takes whatever
    // the swing left over down to an eighth of it. Shrink the hold below this
    // -- or speed the swing up without revisiting it -- and the missile starts
    // leaving a mob the player can see is pointing somewhere else again, which
    // is a bug no assertion about the hold matching itself would catch.
    const double clientEase = easeRateFromAmount(kDefaultInterpolationAmount);
    CHECK(kStingerAimHoldMillis >= 2000.0 / clientEase);
}

TEST(a_stinger_shooter_retraces_its_swing_around_a_moving_flower) {
    CHECK(contentReady());
    // The flower ORBITS, and that is the entire point of this test.
    //
    // At the top of a swing the mob's offset from the bearing is within a hair
    // of half a turn, and which SIDE of the wrap an angleDelta reports it on is
    // decided by whichever way the bearing last drifted. Against a pinned
    // flower it drifts not at all, always reports the same side, and the
    // retrace always looks right -- which is how a mob that unwound the far way
    // round for half of all real players shipped past a green test. Anything
    // asserting the swing has to move the flower, and has to move it both ways.
    for (const double rate : {0.35, -0.35, 1.2, -1.2, 2.5, -2.5}) {
        Sim sim;
        const Entity hornet = sim.spawnMob("hornet", kOrigin);
        const Entity player = sim.spawnPlayer(kOrigin + Vec2{250, 0});

        double theta = 0.0;
        double spun = 0.0;
        double previous = sim.angleOf(hornet);
        double spunAtShot = 0.0;
        double bearingAtShot = 0.0;
        bool haveShot = false;
        int shots = 0;
        int intervals = 0;

        for (int i = 0; i < 300; ++i) {
            // Intent only, so nothing integrates the mob: it holds the origin
            // and the bearing to the flower IS the orbit angle.
            sim.world.get<Transform>(player).position = kOrigin + Vec2::fromAngle(theta, 250.0);
            const int before = shotCount(sim);
            sim.tickIntent();
            theta += rate * net::kTickSeconds;

            // Signed, so a swing that comes home the way it went out cancels
            // and one that carries on round does not.
            spun += angleDelta(previous, sim.angleOf(hornet));
            previous = sim.angleOf(hornet);

            if (shotCount(sim) > before) {
                ++shots;
                if (haveShot) {
                    // Between two volleys the mob starts and finishes nose-on,
                    // so the only rotation it is allowed to keep is the
                    // bearing's own. A swing that unwound the far way round
                    // shows up here as a whole extra turn.
                    CHECK_NEAR(spun - spunAtShot, theta - bearingAtShot, 0.5);
                    ++intervals;
                }
                spunAtShot = spun;
                bearingAtShot = theta;
                haveShot = true;
            }
        }
        CHECK(shots >= 3);
        CHECK(intervals >= 2);
    }
}

TEST(a_stinger_shooter_noses_back_round_after_the_shot) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{250, 0});

    // Intent only, so the pair stay put and the bearing is due east for the
    // whole run: every angle below can be read against zero.
    const auto toFire = [&] {
        const int before = shotCount(sim);
        for (int i = 0; i < 200; ++i) {
            sim.tickIntent();
            if (shotCount(sim) > before) return i + 1;
        }
        return -1;
    };

    CHECK(toFire() > 0);
    // Rear-on at the shot, which is the wind-up half of the cycle.
    CHECK(std::cos(sim.angleOf(hornet)) < 0.0);

    // It comes back round, over the same swing it went out on: one rate for
    // the family, so the recovery costs exactly what the wind-up did. And it
    // RETRACES -- the offset from the bearing shrinks from a half turn to
    // nothing without ever changing sign.
    //
    // That is the whole point of stepping the offset rather than steering at
    // the bearing: from exactly tail-on the two ways home are the same half
    // turn, an ordinary shortest-path turn breaks the tie the same way it
    // broke it on the way out, and the mob completes a full revolution per
    // shot instead of coming back.
    const double wound = angleDelta((sim.positionOf(player) - sim.positionOf(hornet)).angle(),
                                    sim.angleOf(hornet));
    CHECK_NEAR(std::fabs(wound), kPi, kStingerAimTolerance);
    const double side = wound < 0.0 ? -1.0 : 1.0;

    int ticksBack = -1;
    double previous = std::fabs(wound);
    for (int i = 0; i < 200; ++i) {
        sim.tickIntent();
        const double bearing = (sim.positionOf(player) - sim.positionOf(hornet)).angle();
        const double offset = angleDelta(bearing, sim.angleOf(hornet));
        // Still on the side it wound onto, and closer to the nose than it was.
        if (std::fabs(offset) > 1e-9) CHECK(offset * side > 0.0);
        CHECK(std::fabs(offset) < previous + 1e-9);
        previous = std::fabs(offset);
        if (std::fabs(offset) < 1e-9) { ticksBack = i + 1; break; }
    }
    CHECK(ticksBack > 1);
    // Within a tick of the swing either side: the mob starts the leg already a
    // step into it, and the last step is clamped to land exactly on the nose.
    CHECK_NEAR(ticksBack * net::kTickMillis, kStingerWindupMillis, net::kTickMillis * 2.0);

    // And it STAYS there: the next wind-up is a swing's worth of time before
    // the volley is due, not the instant the nose comes round.
    for (int i = 0; i < 10; ++i) {
        sim.tickIntent();
        CHECK_NEAR(sim.angleOf(hornet), 0.0, 1e-9);
    }
    CHECK_EQ(shotCount(sim), 1);
}

TEST(the_wind_up_does_not_cost_a_stinger_shooter_its_cadence) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("hornet", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{250, 0});

    const auto toFire = [&] {
        const int before = shotCount(sim);
        for (int i = 0; i < 400; ++i) {
            sim.tickIntent();
            if (shotCount(sim) > before) return i + 1;
        }
        return -1;
    };

    CHECK(toFire() > 0);
    const int gap = toFire();
    CHECK(gap > 0);
    // A hornet's config says 2000 ms and a hornet shoots every 2000 ms. The
    // mob starts its swing BEFORE the volley is due precisely so the flag
    // stays a behaviour rather than a silent rate nerf; begun on expiry
    // instead this would be a wind-up longer.
    const double cooldown = content().mob(content().mobIndex("hornet")).cooldownMillis;
    CHECK_NEAR(gap * net::kTickMillis, cooldown, net::kTickMillis + 1e-9);
}

TEST(a_mob_that_shoots_out_of_its_face_still_does) {
    CHECK(contentReady());
    // The flag is per-mob, and every other shooter keeps the behaviour it had:
    // heading and facing are one vector, and the volley leaves on the tick the
    // cooldown allows it.
    Sim sim;
    const Entity glitch = sim.spawnMob("glitch", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{300, 0});

    const Entity shot = fireAndCatch(sim);
    CHECK(shot != NULL_ENTITY);
    if (shot == NULL_ENTITY) return;
    const double bearing = (sim.positionOf(player) - sim.positionOf(glitch)).angle();
    CHECK(std::fabs(angleDelta(sim.angleOf(glitch), bearing)) < 0.2);
    // Out of the centre, not off a stinger it does not have. The residual is
    // the shooter's own recoil, which moves the mob and not the shot.
    CHECK(distance(sim.world.get<Transform>(shot).position, sim.positionOf(glitch)) <=
          kProjectileMaxRecoil + 1e-9);
}

TEST(a_wasp_throws_its_own_weaving_missile_and_a_hornet_does_not) {
    CHECK(contentReady());
    const std::uint16_t waspMissile = content().petalIndex("wasp_missile");
    const std::uint16_t hornetMissile = content().petalIndex("hornet_missile");
    CHECK(waspMissile != kInvalidIndex);
    CHECK(waspMissile != hornetMissile);

    Sim wasp;
    wasp.spawnMob("wasp", kOrigin);
    wasp.spawnPlayer(kOrigin + Vec2{300, 0});
    const Entity stinger = fireAndCatch(wasp);
    CHECK(stinger != NULL_ENTITY);
    if (stinger == NULL_ENTITY) return;
    CHECK_EQ(wasp.world.get<Projectile>(stinger).petalConfigIndex, waspMissile);

    // The weave is stamped at the firing site, off the AMMUNITION, and scaled
    // by the shot it is riding -- so it is a shape rather than a fixed
    // wobble in world units.
    const Projectile& p = wasp.world.get<Projectile>(stinger);
    CHECK(p.waveAmplitude > 0.0);
    CHECK(p.waveFrequency > 0.0);
    const double radius = wasp.world.get<Body>(stinger).radius;
    CHECK_NEAR(p.waveAmplitude, content().petal(waspMissile).waveAmplitude * radius, 1e-9);
    // The frequency is the authored rate over the shot's calibre: speed is the
    // file's number at every size, so the pitch is the only thing that can
    // stretch the wavelength to match a bigger missile. A wasp is a size-1.3
    // mob, so even its common missile is above stock and this is not a 1.
    const ProjectileSpec& waspSpec = content().mob(content().mobIndex("wasp")).projectile;
    const double waspStock =
        std::max(1.0, content().petalStats(waspSpec.ammoPetalIndex, Rarity::Common).size *
                          kProjectileRadiusPerSize / kProjectileSizeDivisor);
    CHECK(radius > waspStock);
    CHECK_NEAR(p.waveFrequency, content().petal(waspMissile).waveFrequency / (radius / waspStock),
               1e-9);

    Sim hornet;
    hornet.spawnMob("hornet", kOrigin);
    hornet.spawnPlayer(kOrigin + Vec2{300, 0});
    const Entity missile = fireAndCatch(hornet);
    CHECK(missile != NULL_ENTITY);
    if (missile == NULL_ENTITY) return;
    CHECK_EQ(hornet.world.get<Projectile>(missile).petalConfigIndex, hornetMissile);
    CHECK_NEAR(hornet.world.get<Projectile>(missile).waveAmplitude, 0.0, 1e-12);
}

TEST(a_bigger_wasp_weaves_wider) {
    CHECK(contentReady());
    Sim common;
    const Entity smallWasp = common.spawnMob("wasp", kOrigin);
    common.spawnPlayer(kOrigin + Vec2{300, 0});
    const Entity small = fireAndCatch(common);

    Sim mythic;
    const Entity bigWasp = mythic.spawnMob("wasp", kOrigin, Rarity::Mythic);
    mythic.spawnPlayer(kOrigin + Vec2{300, 0});
    const Entity large = fireAndCatch(mythic);

    CHECK(small != NULL_ENTITY);
    CHECK(large != NULL_ENTITY);
    if (small == NULL_ENTITY || large == NULL_ENTITY) return;
    // Amplitude is stated against the shot's own radius, so the ladder carries
    // it for free and the two missiles trace the same shape at two sizes.
    const Projectile& big = mythic.world.get<Projectile>(large);
    const Projectile& little = common.world.get<Projectile>(small);
    CHECK(big.waveAmplitude > little.waveAmplitude);
    const double amplitudeRatio = big.waveAmplitude / little.waveAmplitude;
    CHECK_NEAR(amplitudeRatio,
               mythic.world.get<Body>(large).radius / common.world.get<Body>(small).radius, 1e-9);

    // The PITCH drops by exactly that factor, and that is the point rather than
    // an oversight: a wavelength is speed over frequency, speed is the same at
    // both sizes, so the only way the wavelength grows with the amplitude is
    // for the frequency to fall. Leaving the pitch alone would give the big
    // missile a common missile's wavelength at four times the swing -- a buzz,
    // not the same curve at a larger size.
    CHECK(big.waveFrequency < little.waveFrequency);
    CHECK_NEAR(little.waveFrequency / big.waveFrequency, amplitudeRatio, 1e-9);

    // Which is the claim worth testing: wavelength is speed over frequency, and
    // it comes out in the same proportion the amplitude did. Measured off the
    // muzzle rather than the launch vector, so the wasp's own travel -- its
    // business, not the weave's -- stays out of the number.
    const auto muzzle = [](Sim& sim, Entity shot, Entity shooter) {
        return (sim.world.get<Motion>(shot).velocity -
                sim.world.get<Motion>(shooter).velocity)
            .length();
    };
    const double bigWavelength = muzzle(mythic, large, bigWasp) / big.waveFrequency;
    const double littleWavelength = muzzle(common, small, smallWasp) / little.waveFrequency;
    CHECK_NEAR(bigWavelength / littleWavelength, amplitudeRatio, 1e-9);
}

TEST(a_bigger_shooters_shot_flies_at_the_same_speed) {
    CHECK(contentReady());
    Sim common;
    const Entity smallHornet = common.spawnMob("hornet", kOrigin);
    common.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity slow = fireAndCatch(common);

    Sim mythic;
    const Entity bigHornet = mythic.spawnMob("hornet", kOrigin, Rarity::Mythic);
    mythic.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity fast = fireAndCatch(mythic);

    CHECK(slow != NULL_ENTITY);
    CHECK(fast != NULL_ENTITY);
    if (slow == NULL_ENTITY || fast == NULL_ENTITY) return;

    // The shots really are different sizes -- the calibre ladder is untouched,
    // it is only speed that stopped riding it.
    const double radiusRatio =
        mythic.world.get<Body>(fast).radius / common.world.get<Body>(slow).radius;
    CHECK(radiusRatio > 1.5);
    CHECK(mythic.world.get<Body>(bigHornet).radius > common.world.get<Body>(smallHornet).radius);

    // `speed` in mobs.json is what the shot flies at, at every size and every
    // tier. Measured off the shot's own bearing so the shooter's inherited
    // travel, which is its own business, stays out of it.
    const auto gunSpeed = [](Sim& sim, Entity shot, Entity shooter) {
        const Vec2 launched = sim.world.get<Motion>(shot).velocity;
        return (launched - sim.world.get<Motion>(shooter).velocity).length();
    };
    const ProjectileSpec& spec = content().mob(content().mobIndex("hornet")).projectile;
    CHECK_NEAR(gunSpeed(common, slow, smallHornet), spec.speed, 1e-6);
    CHECK_NEAR(gunSpeed(mythic, fast, bigHornet), spec.speed, 1e-6);
}

TEST(a_glitch_volley_carries_the_infection_and_a_hornets_does_not) {
    CHECK(contentReady());
    // The stamp is what combat reads when the shot lands, so it has to come
    // off the SHOOTER's config -- the ammunition petal says nothing about it.
    {
        Sim sim;
        sim.spawnMob("glitch", kOrigin);
        sim.spawnPlayer(kOrigin + Vec2{200, 0});
        const Entity shot = fireAndCatch(sim);
        CHECK(shot != NULL_ENTITY);
        if (shot != NULL_ENTITY) CHECK(sim.world.get<Projectile>(shot).glitchInfecting);
    }
    {
        Sim sim;
        sim.spawnMob("hornet", kOrigin);
        sim.spawnPlayer(kOrigin + Vec2{200, 0});
        const Entity shot = fireAndCatch(sim);
        CHECK(shot != NULL_ENTITY);
        if (shot != NULL_ENTITY) CHECK(!sim.world.get<Projectile>(shot).glitchInfecting);
    }
}

TEST(a_bigger_hornet_fires_a_bigger_missile) {
    CHECK(contentReady());
    Sim common;
    common.spawnMob("hornet", kOrigin);
    common.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity small = fireAndCatch(common);

    Sim mythic;
    mythic.spawnMob("hornet", kOrigin, Rarity::Mythic);
    mythic.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity large = fireAndCatch(mythic);

    CHECK(small != NULL_ENTITY);
    CHECK(large != NULL_ENTITY);
    CHECK(mythic.world.get<Body>(large).radius > common.world.get<Body>(small).radius);
}

TEST(a_mantis_fires_its_peas_in_bursts_of_three) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("mantis", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{300, 0});

    const ProjectileSpec& spec = content().mob(content().mobIndex("mantis")).projectile;
    CHECK(spec.present);
    CHECK_EQ(spec.burstCount, 3);
    // One pea per shot, three shots: a burst, not a fan. Were this the other
    // way round the mantis would be a shotgun and the test below would pass on
    // a single volley.
    CHECK_EQ(spec.count, 1);
    CHECK(spec.burstIntervalMillis > 0.0);

    // The INTENT phase only: nothing moves, so the bearing holds and no shot
    // ever expires -- shotCount is a pure fire counter, and the clock at the
    // tick a shot appears is the moment it was fired.
    std::vector<double> firedAt;
    int counted = 0;
    for (int i = 0; i < 200; ++i) {
        const double at = sim.now;
        sim.tickIntent();
        const int total = shotCount(sim);
        for (; counted < total; ++counted) firedAt.push_back(at);
    }
    // Eight seconds of ticks against a cycle of a cadence plus two gaps: two
    // full bursts over is a floor, not the expected count.
    CHECK(firedAt.size() >= 6);
    if (firedAt.size() < 6) return;

    // And what it fires is peas: the shot carries the ammunition's own petal,
    // which is what the client draws it as.
    const Entity pea = firstShot(sim);
    CHECK(pea != NULL_ENTITY);
    if (pea == NULL_ENTITY) return;
    CHECK_EQ(sim.world.get<Projectile>(pea).petalConfigIndex, content().petalIndex("peas"));

    const double cadence = content().mobStats(content().mobIndex("mantis"), Rarity::Common)
                               .attackCooldownMillis;
    CHECK(cadence > 0.0);
    // What the config ASKS FOR, not what this test would like it to be: the
    // whole contract of `burstInterval` is that the authored number is the
    // number that fires, so the expectation is derived from the data and the
    // test says nothing about which of the two clocks is the longer one. A
    // mantis authored to space its peas a full cadence apart is a mantis whose
    // peas come out evenly, and that is a config decision, not a bug.
    const double inBurst = spec.burstIntervalMillis;
    for (std::size_t i = 1; i < firedAt.size(); ++i) {
        const double gap = firedAt[i] - firedAt[i - 1];
        // The cadence runs from the LAST pea of a burst, so a new burst opens a
        // full cooldown later -- the burst is not squeezed inside the mantis's
        // stated rate.
        const double expected = i % 3 == 0 ? cadence : inBurst;
        // Never early, and never later than the first tick that owes the shot.
        CHECK(gap >= expected - 1e-9);
        CHECK(gap < expected + net::kTickMillis);
    }
}

TEST(a_mantis_fires_its_authored_gap_at_every_tier_including_the_biggest) {
    CHECK(contentReady());
    const std::uint16_t mantis = content().mobIndex("mantis");
    const ProjectileSpec& spec = content().mob(mantis).projectile;

    // The authored gap is what fires, at EVERY tier, apex included. A number in
    // mobs.json that the engine scales, clamps or floors behind the author's
    // back is a number that cannot be tuned -- and the failure is invisible:
    // the biggest mantis is exactly where a size-derived adjustment grows to
    // the length of the cadence, and a burst whose gap equals its own pause is
    // a burst the player cannot see at all.
    //
    // The whole ladder, because the top of it is where that goes wrong.
    for (int tier = rarityIndex(Rarity::Common); tier < kRarityCount; ++tier) {
        const Rarity rarity = static_cast<Rarity>(tier);
        Sim sim;
        const Entity mob = sim.spawnMob("mantis", kOrigin, rarity);
        // Clear of the mob's own skin -- at ultra the body alone is hundreds of
        // units across -- and well inside the aggro range of every tier.
        sim.spawnPlayer(kOrigin + Vec2{sim.world.get<Body>(mob).radius + 200.0, 0});

        double firedAt[2] = {0.0, 0.0};
        int counted = 0;
        for (int i = 0; i < 400 && counted < 2; ++i) {
            const double at = sim.now;
            sim.tickIntent();
            const int total = shotCount(sim);
            while (counted < total && counted < 2) firedAt[counted++] = at;
        }
        CHECK_EQ(counted, 2);
        if (counted < 2) continue;

        const Entity pea = firstShot(sim);
        CHECK(pea != NULL_ENTITY);
        if (pea == NULL_ENTITY) continue;

        const double gap = firedAt[1] - firedAt[0];
        CHECK(gap >= spec.burstIntervalMillis - 1e-9);
        CHECK(gap < spec.burstIntervalMillis + net::kTickMillis);
        // And it still READS as a burst at this tier: the gap inside one is a
        // fraction of the pause that follows it. This is the assertion that an
        // engine-side adjustment fails -- stretch the gap with the shooter's
        // size and the line above still passes while an apex mantis fires an
        // even stream of peas, which is precisely the bug this pair guards.
        const double cadence =
            content().mobStats(mantis, rarity).attackCooldownMillis;
        CHECK(gap < cadence * 0.75);
    }
}

TEST(a_burst_left_hanging_by_a_lost_target_starts_over_rather_than_resuming) {
    CHECK(contentReady());
    Sim sim;
    const Entity mantis = sim.spawnMob("mantis", kOrigin);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{300, 0});

    Entity shot = NULL_ENTITY;
    for (int i = 0; i < 200 && shot == NULL_ENTITY; ++i) {
        sim.tickIntent();
        shot = firstShot(sim);
    }
    CHECK(shot != NULL_ENTITY);
    // Two peas still owed when the flower leaves.
    CHECK_EQ(int(sim.brainOf(mantis).burstRemaining), 2);

    // Well outside the mantis's aggro range, for longer than its whole cadence.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{20000, 0};
    const int before = shotCount(sim);
    sim.tickIntent(100);
    CHECK_EQ(shotCount(sim), before);

    // Back in range: the remainder of the abandoned burst must NOT go off on
    // the tick the mantis re-acquires -- what follows is a fresh burst of
    // three, opening with a shot that leaves the counter at two again.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{300, 0};
    for (int i = 0; i < 200 && shotCount(sim) == before; ++i) sim.tickIntent();
    CHECK(shotCount(sim) == before + 1);
    CHECK_EQ(int(sim.brainOf(mantis).burstRemaining), 2);
}

TEST(a_volley_carries_the_shooters_own_travel) {
    CHECK(contentReady());
    Sim sim;
    // A shooter STILL CLOSING, which is the only kind that has any travel to
    // carry: one sitting at its standoff is stopped by design (see
    // shooterStandoff) and its volley rightly inherits nothing. A mythic's
    // reach is long enough to open fire from well outside the gap it holds.
    sim.spawnMob("hornet", kOrigin, Rarity::Mythic);
    sim.spawnPlayer(kOrigin + Vec2{1200, 0});

    const Entity shot = fireAndCatch(sim);
    CHECK(shot != NULL_ENTITY);

    // The launch vector is the gun's plus the shooter's, so the difference
    // between the two is a clean speed on the shot's own bearing. Measured
    // rather than asserted against a literal, because the hornet is manoeuvring
    // and its velocity at the moment it fired is its own business.
    const Vec2 launched = sim.world.get<Motion>(shot).velocity;
    const double bearing = sim.world.get<Transform>(shot).angle;
    const ProjectileSpec& spec = content().mob(content().mobIndex("hornet")).projectile;
    // The gun's own contribution is the authored speed, whatever calibre this
    // shot came out at.
    const double muzzle = spec.speed;
    const Vec2 gun = Vec2::fromAngle(bearing, muzzle);
    const Vec2 inherited = launched - gun;
    // Something was inherited, and it is a mob's speed rather than a second
    // copy of the gun's.
    CHECK(inherited.length() > 1e-6);
    CHECK(inherited.length() < muzzle);
}

TEST(a_firing_mob_rocks_back_a_little_and_no_further) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    // The INTENT phase alone, so the harness never integrates the velocity the
    // AI asked for. The only thing that can move the shooter across one of
    // these ticks is the recoil written straight to its position.
    Vec2 before = sim.positionOf(hornet);
    Entity shot = NULL_ENTITY;
    for (int i = 0; i < 200 && shot == NULL_ENTITY; ++i) {
        before = sim.positionOf(hornet);
        sim.tickIntent();
        shot = firstShot(sim);
    }
    CHECK(shot != NULL_ENTITY);

    // A nudge, and pointing back down the barrel. The cap is what says this is
    // not diep.io: whatever the shooter and its ammunition, one volley moves it
    // a handful of units at most.
    const Vec2 kick = sim.positionOf(hornet) - before;
    CHECK(kick.length() > 0.0);
    CHECK(kick.length() <= kProjectileMaxRecoil + 1e-9);
    // The player is due east, so the shot went east and the shooter went west.
    CHECK(kick.x < 0.0);
}

// ---------------------------------------------------------------------------
// The bee cruise
// ---------------------------------------------------------------------------

namespace {

/// The slowest and the fastest the mob travelled over `ticks` of having
/// nothing to chase. A hopper rests between hops and a cruiser never does, so
/// the pair of them is what tells the two machines apart.
struct DriftSpeeds {
    double slowest = 1e30;
    double fastest = 0.0;
};

DriftSpeeds driftSpeeds(const char* id, int ticks = 120) {
    Sim sim;
    const Entity mob = sim.spawnMob(id, kOrigin);
    DriftSpeeds out;
    // A second of settling first: every drift starts from a standstill, and
    // the first hop's worth of that would look like a rest to the test.
    sim.tick(30);
    for (int i = 0; i < ticks; ++i) {
        sim.tick();
        const double speed = sim.velocityOf(mob).length();
        out.slowest = std::min(out.slowest, speed);
        out.fastest = std::max(out.fastest, speed);
    }
    return out;
}

/// The ceiling on that mob's cruise: the bee's own rate, scaled by its body.
double cruiseCeiling(const char* id) {
    const MobStats stats = content().mobStats(content().mobIndex(id), Rarity::Common);
    return kBeeCruiseSpeed * stats.radius / kWanderRefRadius;
}

} // namespace

TEST(hornets_and_wasps_cruise_instead_of_hopping) {
    CHECK(contentReady());
    // gardn runs both on tick_bee_passive, so off a target they fly the bee's
    // weaving line rather than the walker's hop. The two machines are told
    // apart by what happens BETWEEN moves: a hopper spends a second of every
    // cycle at a standstill, and a cruiser never stops.
    for (const char* id : {"hornet", "wasp", "bee"}) {
        const DriftSpeeds drift = driftSpeeds(id);
        CHECK(drift.fastest > 0.0);
        CHECK(drift.slowest > 0.25 * drift.fastest);
    }
    // The contrast, so the assertion above is known to be able to fail: a
    // ladybug hops, and comes to a dead stop between hops.
    const DriftSpeeds hopper = driftSpeeds("ladybug");
    CHECK(hopper.slowest < 0.05 * hopper.fastest);
}

TEST(a_cruise_is_flown_at_the_bees_rate_whatever_the_mob_is_authored_at) {
    CHECK(contentReady());
    // The cruise is sustained where the hop is pulsed, so the same authored
    // speed carries a cruising mob some six times as fast as a hopping one. A
    // hornet is authored at four times a bee's speed; uncapped it would drift
    // at 280 u/s, faster than it chases.
    for (const char* id : {"hornet", "wasp"}) {
        const DriftSpeeds drift = driftSpeeds(id);
        CHECK(drift.fastest <= cruiseCeiling(id) + 1e-9);
        CHECK(drift.fastest < content().mobStats(content().mobIndex(id), Rarity::Common).speed);
    }
    // And the ceiling is the BEE's own cruise restated, so the mob it was
    // tuned on is untouched by it: a bee still reaches the speed it always
    // flew at rather than being clipped down to a new one.
    const DriftSpeeds bee = driftSpeeds("bee");
    CHECK(bee.fastest > 0.95 * cruiseCeiling("bee"));
    CHECK(bee.fastest <= cruiseCeiling("bee") + 1e-9);
}

TEST(a_cruising_stinger_still_drops_everything_for_a_flower) {
    CHECK(contentReady());
    // The flag is on the PASSIVE machine only. A hornet that cruised past a
    // flower rather than turning on it would be a very peaceful hornet.
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    sim.tick(60);                       // long enough to be well into a cruise
    sim.spawnPlayer(kOrigin + Vec2{200, 0});
    CHECK(fireAndCatch(sim) != NULL_ENTITY);
    CHECK(sim.brainOf(hornet).target != NULL_ENTITY);
}

namespace {

/// A chasing mob's velocity split along and across its bearing on the flower,
/// over `ticks` of the intent phase alone -- so neither side moves and the
/// bearing holds still while the weave, if any, sweeps across it.
struct ChaseSplit {
    double slowestClosing = 1e30;
    double fastestClosing = 0.0;
    double widestSwing = 0.0;   ///< radians the heading strayed off the bearing
};

/// `provoke` hurts the mob first, for one that only chases what hit it.
ChaseSplit chaseSplit(const char* id, double playerGap, Rarity rarity = Rarity::Common,
                      bool provoke = false, int ticks = 80) {
    Sim sim;
    const Entity mob = sim.spawnMob(id, kOrigin, rarity);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{playerGap, 0});
    if (provoke) sim.hurt(mob, player);
    ChaseSplit out;
    int moving = 0;
    for (int i = 0; i < ticks; ++i) {
        sim.tickIntent();
        const Vec2 velocity = sim.velocityOf(mob);
        if (velocity.lengthSq() < 1e-9) continue;
        ++moving;
        const Vec2 toward = sim.positionOf(player) - sim.positionOf(mob);
        const Vec2 along = toward * (1.0 / toward.length());
        const double closing = velocity.x * along.x + velocity.y * along.y;
        out.slowestClosing = std::min(out.slowestClosing, closing);
        out.fastestClosing = std::max(out.fastestClosing, closing);
        out.widestSwing = std::max(out.widestSwing,
                                   std::abs(angleDelta(toward.angle(), velocity.angle())));
    }
    CHECK(sim.brainOf(mob).target == player);
    CHECK(moving > ticks / 2);
    return out;
}

double chaseSpeedOf(const char* id, Rarity rarity = Rarity::Common) {
    return content().mobStats(content().mobIndex(id), rarity).chaseSpeed;
}

} // namespace

TEST(a_bee_ai_always_mob_weaves_on_the_chase_without_losing_ground) {
    CHECK(contentReady());
    // Four seconds covers more than a whole period of the sway, so the swing
    // reaches its full width whatever phase the mob was spawned with.
    const ChaseSplit fly = chaseSplit("fly", 200.0);
    CHECK(fly.widestSwing > 0.95 * kBeeChaseWeave);
    CHECK(fly.widestSwing <= kBeeChaseWeave + 1e-9);
    // And the weave is ADDED across the pursuit: the closing rate is the full
    // chase speed on every tick, so a flower running straight away gains
    // nothing from it.
    CHECK_NEAR(fly.slowestClosing, chaseSpeedOf("fly"), 1e-6);
    CHECK_NEAR(fly.fastestClosing, chaseSpeedOf("fly"), 1e-6);
}

TEST(a_fast_chaser_weaves_as_wide_as_a_slow_one) {
    CHECK(contentReady());
    // The weave is an angle, not a sideways speed. A flat sideways speed is a
    // swing that narrows as the pursuit gets faster: the bee chases at a
    // flower's full 300 u/s, and under a flat 100 u/s sway it flew all but
    // straight. A rare bee is neutral, so it has to be hit before it chases.
    const ChaseSplit bee = chaseSplit("bee", 200.0, Rarity::Rare, true);
    CHECK_NEAR(chaseSpeedOf("bee", Rarity::Rare), kPlayerMaxSpeed, 1e-9);
    CHECK(bee.widestSwing > 0.95 * kBeeChaseWeave);
    CHECK(bee.widestSwing <= kBeeChaseWeave + 1e-9);
    CHECK_NEAR(bee.slowestClosing, chaseSpeedOf("bee", Rarity::Rare), 1e-6);
    CHECK_NEAR(bee.fastestClosing, chaseSpeedOf("bee", Rarity::Rare), 1e-6);
}

TEST(a_bee_ai_idle_stinger_closes_on_a_flower_straight) {
    CHECK(contentReady());
    // Same cruise off a target as the fly, but the approach is the line its
    // shot is aimed along. 330 is outside the hornet's standoff, so it keeps
    // closing and there is a velocity to measure.
    CHECK(chaseSplit("hornet", 330.0).widestSwing < 1e-6);
}

// ---------------------------------------------------------------------------
// Standoff
// ---------------------------------------------------------------------------

TEST(a_shooter_closes_to_its_standoff_and_stops_there) {
    CHECK(contentReady());
    Sim sim;
    const Entity hornet = sim.spawnMob("hornet", kOrigin);
    // Inside the hornet's aggro range and outside the gap it wants to hold, so
    // the only way it reaches the standoff is by walking there.
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{330, 0});

    const std::uint16_t index = content().mobIndex("hornet");
    const double radius = sim.world.get<Body>(hornet).radius;
    // A common shooter's reach IS its authored `distance` (see
    // kProjectileReachReferenceScale), which is what makes this readable.
    const double standoff = shooterStandoff(content().mob(index).projectile.distance, radius,
                                            kPlayerBaseRadius);
    CHECK(standoff < 330.0);

    sim.tick(200);
    // It closed...
    CHECK(sim.gap(hornet, player) < 330.0);
    // ...to the gap and no further. A tick of travel of slack either way,
    // because the mob stops on the tick it arrives rather than mid-step.
    const double step =
        2.0 * content().mobStats(index, Rarity::Common).speed * net::kTickSeconds;
    CHECK(sim.gap(hornet, player) > standoff - step);
    CHECK(sim.gap(hornet, player) < standoff + step + kProjectileMaxRecoil);
    // And it has SETTLED: nothing here strafes, and what is left of its travel
    // is the mob re-closing the few units its own recoil opens under it each
    // volley -- inside the ease band that is a crawl, not a mob still closing.
    CHECK(sim.velocityOf(hornet).length() <=
          content().mobStats(index, Rarity::Common).speed * kProjectileMaxRecoil /
                  kShooterStandoffEase +
              1e-9);
    // Holding is not disengaging -- it still has the flower and is still
    // shooting at it from out there.
    CHECK(sim.brainOf(hornet).target != NULL_ENTITY);
    CHECK(shotCount(sim) > 0);
}

TEST(a_flower_that_walks_into_a_shooter_reaches_it) {
    CHECK(contentReady());
    // The standoff is a mob declining to CLOSE, never a mob giving ground. The
    // difference is the whole of whether a shooter is dangerous or merely
    // untouchable, and it is invisible in the code that holds the gap -- so it
    // is asserted here, from the flower's side.
    for (const char* id : {"hornet", "wasp", "mantis"}) {
        Sim sim;
        const Entity mob = sim.spawnMob(id, kOrigin);
        const Entity player = sim.spawnPlayer(kOrigin + Vec2{330, 0});

        const double touching = sim.world.get<Body>(mob).radius + kPlayerBaseRadius;
        bool reached = false;
        for (int i = 0; i < 400 && !reached; ++i) {
            // A flower walking straight in at its own top speed.
            Transform& at = sim.world.get<Transform>(player);
            const Vec2 toMob = sim.positionOf(mob) - at.position;
            const double gap = toMob.length();
            if (gap > 0.0) {
                at.position += toMob * (std::min(kPlayerMaxSpeed * net::kTickSeconds, gap) / gap);
            }
            sim.tick();
            reached = sim.gap(mob, player) <= touching;
        }
        CHECK(reached);
    }
}

TEST(a_shooter_holds_no_further_out_than_its_missiles_carry) {
    CHECK(contentReady());
    // The standoff is a feel number and the reach is a content one; nothing
    // makes them agree. A mob that backed out of its own range would keep a
    // textbook distance and never land a shot again.
    for (const double reach : {50.0, 200.0, 333.0, 5000.0}) {
        for (const double radius : {20.0, 200.0}) {
            const double standoff = shooterStandoff(reach, radius, kPlayerBaseRadius);
            CHECK(standoff <= reach + kPlayerBaseRadius);
            CHECK(standoff <= kShooterStandoffGap + radius + kPlayerBaseRadius);
            CHECK(standoff > 0.0);
        }
    }
    // With reach to spare it is the reference's own gap, measured skin to skin.
    CHECK_NEAR(shooterStandoff(1e6, 40.0, 20.0), kShooterStandoffGap + 60.0, 1e-9);
}

TEST(a_shooter_closes_instead_of_firing_at_what_it_cannot_hit) {
    CHECK(contentReady());
    Sim sim;
    // A target is held for five viewports, so it can stand well past the
    // missiles' reach: a rare hornet's die at 433, and this flower is 600 off.
    // Firing anyway is a mob visibly shooting at something it cannot reach,
    // on a cadence then unavailable for the shot it could.
    const Entity hornet = sim.spawnMob("hornet", kOrigin, Rarity::Rare);
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{600, 0});
    sim.world.get<MobAi>(hornet).target = player;

    // Intent only: the mob holds the origin, so the gap stays the one set here.
    sim.tickIntent(200);
    CHECK_EQ(sim.brainOf(hornet).target, player);       // it kept the target
    CHECK_EQ(shotCount(sim), 0);                        // and it held its fire

    // Walk the flower into range and the volley comes.
    sim.world.get<Transform>(player).position = kOrigin + Vec2{400, 0};
    for (int i = 0; i < 200 && shotCount(sim) == 0; ++i) sim.tickIntent();
    CHECK(shotCount(sim) > 0);
}

TEST(a_top_tier_shooter_still_aggros_and_fires_from_outside_its_own_body) {
    CHECK(contentReady());
    // Aggro is measured from the mob's skin, so the authored range means the
    // same thing at every tier. Measured from the CENTRE it did not: a super
    // wasp is 436 units in radius and carries a 300-unit range, which put its
    // whole aggro circle inside itself -- it never saw a flower, never chased
    // one and never fired, at super and at every tier above it.
    for (const Rarity rarity : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
        for (const char* id : {"hornet", "wasp"}) {
            Sim sim;
            const Entity mob = sim.spawnMob(id, kOrigin, rarity);
            const double radius = sim.world.get<Body>(mob).radius;
            // Just clear of the body: as close as a flower can stand without
            // being inside the mob, and the case that used to fail.
            sim.spawnPlayer(kOrigin + Vec2{radius + 100.0, 0});

            CHECK(fireAndCatch(sim) != NULL_ENTITY);
            CHECK(sim.brainOf(mob).target != NULL_ENTITY);
        }
    }
}

TEST(every_mobs_aggro_range_grows_with_its_body) {
    CHECK(contentReady());
    // No per-mob rarity table: every mob's range rides the body-size ladder,
    // apex included, so range over radius is the same at every tier.
    for (std::size_t i = 0; i < content().mobCount(); ++i) {
        const auto index = static_cast<std::uint16_t>(i);
        const MobStats common = content().mobStats(index, Rarity::Common);
        for (int tier = 0; tier < kRarityCount; ++tier) {
            const MobStats s = content().mobStats(index, static_cast<Rarity>(tier));
            CHECK_NEAR(s.aggroRange * common.radius, common.aggroRange * s.radius,
                       std::fabs(s.aggroRange * common.radius) * 1e-9);
        }
    }
    // A ladybug is neutral from rare up, apex included: there is no tier at
    // which it goes back to hunting on its own.
    const std::uint16_t ladybug = content().mobIndex("ladybug");
    for (int tier = rarityIndex(Rarity::Rare); tier < kRarityCount; ++tier) {
        CHECK(content().mobStats(ladybug, static_cast<Rarity>(tier)).ai == AiKind::Neutral);
    }
}

TEST(a_common_shooters_reach_is_the_number_written_in_the_config) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("hornet", kOrigin);
    sim.spawnPlayer(kOrigin + Vec2{200, 0});

    const Entity shot = fireAndCatch(sim);
    CHECK(shot != NULL_ENTITY);

    // The whole point of stating reach in common-tier units: what a designer
    // writes in mobs.json is what a common shooter's missile actually flies.
    // Under the reference's flat divisor this was a sixth of it, which is how
    // the shipped hornet ended up firing 83 units at a target it only aggros
    // within 300.
    const ProjectileSpec& spec = content().mob(content().mobIndex("hornet")).projectile;
    CHECK_NEAR(sim.world.get<Projectile>(shot).remainingDistance, spec.distance, 1e-9);
}

TEST(a_higher_tier_shooter_reaches_proportionally_further) {
    CHECK(contentReady());
    Sim common;
    common.spawnMob("hornet", kOrigin);
    common.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity near = fireAndCatch(common);

    Sim mythic;
    mythic.spawnMob("hornet", kOrigin, Rarity::Mythic);
    mythic.spawnPlayer(kOrigin + Vec2{200, 0});
    const Entity far = fireAndCatch(mythic);

    CHECK(near != NULL_ENTITY);
    CHECK(far != NULL_ENTITY);

    // On the body-size ladder, not the flat divisor: mythic over common.
    const double expected = kMobSizeScale[rarityIndex(Rarity::Mythic)] / kMobSizeScale[0];
    const double ratio = mythic.world.get<Projectile>(far).remainingDistance /
                         common.world.get<Projectile>(near).remainingDistance;
    CHECK_NEAR(ratio, expected, 1e-9);
}

TEST(a_shooter_can_always_reach_what_it_has_aggroed) {
    CHECK(contentReady());
    // The bug the rescale was really about. A mob that opens fire on something
    // it cannot possibly hit is a mob whose volley is decoration, so every
    // shooting mob's authored reach must cover the range it acquires targets
    // at -- checked against the shipped content rather than one mob.
    for (std::size_t i = 0; i < content().mobCount(); ++i) {
        const auto index = static_cast<std::uint16_t>(i);
        const MobConfig& config = content().mob(index);
        if (!config.projectile.present) continue;
        const MobStats stats = content().mobStats(index, Rarity::Common);
        const double reach = config.projectile.distance *
                             kMobSizeScale[0] / kProjectileReachReferenceScale;
        if (reach < stats.aggroRange) {
            std::printf("  %s reaches %.1f but aggros at %.1f\n", config.id.c_str(), reach,
                        stats.aggroRange);
        }
        CHECK(reach >= stats.aggroRange);
    }
}

// ---------------------------------------------------------------------------
// Ammunition rings
// ---------------------------------------------------------------------------

TEST(the_dandelion_ships_a_ring_of_ten_seeds_it_can_shed) {
    CHECK(contentReady());
    const PetalRingSpec& ring = content().mob(content().mobIndex("dandelion")).petalRing;
    CHECK(ring.present);
    CHECK(ring.shootOnHit);
    CHECK_EQ(ring.count, 10);
    CHECK_EQ(ring.petalId, std::string("dandelion"));
    // A seed head is part of the BODY and holds still. It has to: the seats
    // are where the server puts real bodies and where a shed seed leaves
    // from, and a spinning ring's phase belongs to the viewer.
    CHECK(!ring.spins);

    // The seats have to be somewhere a flower can actually stand, or the ring
    // is collision nobody will ever meet: outside the hull, and wide enough
    // that a seed reaches past it. Both measured against the shipped body.
    const MobStats stats = content().mobStats(content().mobIndex("dandelion"), Rarity::Common);
    const double orbit = stats.radius * ring.orbitScale;
    const double seedReach = stats.radius * ring.hitScale + kPlayerBaseRadius;
    CHECK(ring.hitScale > 0.0);
    CHECK(orbit > stats.radius);
    CHECK(orbit + seedReach > stats.radius + kPlayerBaseRadius);

    // The glitch flower's ring is the other kind of ring in every respect:
    // decoration the server never touches, spinning, upright, and left on the
    // defaults that were constants before any of this was a knob.
    const PetalRingSpec& glitch = content().mob(content().mobIndex("glitch_flower")).petalRing;
    CHECK(!glitch.shootOnHit);
    CHECK(glitch.spins);
    CHECK(!glitch.followRotation);   // decoration keeps its own knobs
    CHECK_NEAR(glitch.orbitScale, kMobPetalRingOrbitScale, 1e-9);
    CHECK_NEAR(glitch.petalScale, kMobPetalRingPetalScale, 1e-9);
}

TEST(a_hit_dandelion_sheds_one_seed_along_the_bearing_it_sat_on) {
    CHECK(contentReady());
    Sim sim;
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200.0, 0.0});
    const Entity mob = sim.spawnMob("dandelion", kOrigin);
    CHECK_EQ(sim.ringOf(mob), 10);

    // Nothing owed, nothing fired: a dandelion nobody is fighting stands there
    // with a full head of seeds.
    sim.tick(10);
    CHECK_EQ(sim.ringOf(mob), 10);
    CHECK_EQ(sim.shots(), std::size_t(0));

    // One hit, booked the way combat books it.
    sim.hurt(mob, player, 5.0);
    sim.world.get<MobPetalRing>(mob).pending = 1;
    sim.tick();
    CHECK_EQ(sim.ringOf(mob), 9);
    CHECK_EQ(sim.shots(), std::size_t(1));

    // It leaves along the bearing of the seat it just vacated -- NOT at the
    // flower that hit it, which is standing due east. Ten seeds, so the one
    // that goes is index 9: a tenth of a turn short of due east.
    const PetalRingSpec& spec = content().mob(content().mobIndex("dandelion")).petalRing;
    const double seat = wrapAngle(9.0 * kTau / spec.count);
    Entity shot = NULL_ENTITY;
    Query<Projectile, Transform> live{sim.world};
    live.each([&](Entity e, Projectile&, Transform&) { shot = e; });
    CHECK(shot != NULL_ENTITY);
    if (shot == NULL_ENTITY) return;
    CHECK_NEAR(wrapAngle(sim.world.get<Transform>(shot).angle - seat), 0.0, 1e-6);
    CHECK(std::fabs(wrapAngle(sim.world.get<Transform>(shot).angle)) > 0.1);

    // And it is born on the RING, at the seat it left, rather than in the
    // middle of the body: what the player watched vanish is what flew.
    const double mobRadius = sim.world.get<Body>(mob).radius;
    const Vec2 from = sim.positionOf(mob) + Vec2::fromAngle(seat, mobRadius * spec.orbitScale);
    CHECK_NEAR(distance(sim.world.get<Transform>(shot).position, from), 0.0, 1e-6);

    // At the SIZE it was on the ring, which is the same radius the ring
    // collided with. A seed that halved on the way out -- which is what the
    // ammunition petal's own calibre ladder gave -- reads as a different
    // object being thrown rather than as the seed coming off.
    CHECK_NEAR(sim.world.get<Body>(shot).radius, mobRadius * spec.hitScale, 1e-9);
    // The seed IS a dandelion petal, which is what carries the healing lockout
    // to whatever it lands on.
    CHECK_EQ(sim.world.get<Projectile>(shot).petalConfigIndex, content().petalIndex("dandelion"));
}

TEST(a_dandelion_sheds_one_seed_a_tick_and_stops_when_it_is_bald) {
    CHECK(contentReady());
    Sim sim;
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200.0, 0.0});
    const Entity mob = sim.spawnMob("dandelion", kOrigin);

    // A ring of petals is thirty contacts a second. Paying them all off in the
    // tick they arrived would empty the mob instantly and stack ten shots on
    // one pixel, so the debt is capped at the ring and spent one a tick.
    sim.hurt(mob, player, 1.0);
    sim.world.get<MobPetalRing>(mob).pending = 40;
    sim.tick();
    CHECK_EQ(sim.ringOf(mob), 9);
    CHECK_EQ(sim.shots(), std::size_t(1));

    sim.tick(9);
    CHECK_EQ(sim.ringOf(mob), 0);
    CHECK_EQ(sim.shots(), std::size_t(10));

    // Bald: the rest of the debt is dropped rather than carried, or it would
    // all come out again the moment a seed grew back.
    sim.tick(5);
    CHECK_EQ(sim.shots(), std::size_t(10));
    CHECK_EQ(sim.world.get<MobPetalRing>(mob).pending, 0);
}

TEST(a_shed_seed_never_grows_back) {
    CHECK(contentReady());
    Sim sim;
    const Entity player = sim.spawnPlayer(kOrigin + Vec2{200.0, 0.0});
    const Entity mob = sim.spawnMob("dandelion", kOrigin);

    sim.hurt(mob, player, 1.0);
    sim.world.get<MobPetalRing>(mob).pending = 2;
    sim.tick(2);
    CHECK_EQ(sim.ringOf(mob), 8);

    // The ring is a magazine the mob was built with, not a resource it
    // recovers: half a minute of being left alone puts nothing back.
    sim.tick(900);
    CHECK_EQ(sim.ringOf(mob), 8);
    CHECK_EQ(sim.shots(), std::size_t(2));
}

TEST(a_rings_seeds_do_not_outlive_the_mob_they_grew_on) {
    CHECK(contentReady());

    // A seed is a piece of an animal, so it goes when the animal does -- by
    // either road. A mob DIES (Dead, then the reaper) and a mob DESPAWNS
    // (destroyed outright, no Dead tag ever), and a ring left behind by
    // either is a hitbox sitting in an empty field damaging whoever walks
    // through it, for the rest of the server's life.
    {
        Sim sim;
        const Entity mob = sim.spawnMob("dandelion", kOrigin);
        CHECK_EQ(sim.ringOf(mob), 10);
        std::vector<Entity> seeds;
        for (const Entity seed : sim.world.get<MobPetalRing>(mob).seats) seeds.push_back(seed);

        sim.world.add<Dead>(mob);
        sim.tick(2);
        // Marked, so the reaper announces them and the ring pops with the body.
        for (const Entity seed : seeds) {
            CHECK(sim.world.tryGet<Dead>(seed) != nullptr);
        }
    }
    {
        Sim sim;
        const Entity mob = sim.spawnMob("dandelion", kOrigin);
        std::vector<Entity> seeds;
        for (const Entity seed : sim.world.get<MobPetalRing>(mob).seats) seeds.push_back(seed);

        sim.world.destroy(mob);
        sim.tick(2);
        // Destroyed outright, as the mob was: scenery being recycled says
        // nothing, so its ring throws no death puffs either.
        for (const Entity seed : seeds) CHECK(!sim.world.isAlive(seed));
    }
}

// ---------------------------------------------------------------------------
// Webs
// ---------------------------------------------------------------------------

namespace {

std::vector<Entity> websIn(World& world) {
    std::vector<Entity> out;
    Query<GroundEffect, Transform, Lifetime> live{world};
    live.each([&](Entity e, GroundEffect&, Transform&, Lifetime&) { out.push_back(e); });
    return out;
}

} // namespace

TEST(a_spider_lays_a_web_where_it_stands_once_a_second) {
    CHECK(contentReady());
    const WebSpec& spec = content().mob(content().mobIndex("spider")).web;
    CHECK(spec.present);

    Sim sim;
    const Entity spider = sim.spawnMob("spider", kOrigin, Rarity::Legendary);
    // gardn lays on `lifetime % TPS == 0`, which is true the tick it is born.
    sim.tickIntent();
    std::vector<Entity> webs = websIn(sim.world);
    CHECK_EQ(webs.size(), std::size_t(1));
    if (webs.size() != 1) return;

    const Entity web = webs[0];
    const GroundEffect& field = sim.world.get<GroundEffect>(web);
    CHECK(field.kind == GroundEffectKind::Web);
    CHECK(field.slowsFlowers);
    CHECK_EQ(field.owner, spider);
    CHECK(field.rarity == Rarity::Legendary);
    CHECK_NEAR(field.slowFactor, spec.slowFactor, 1e-12);
    // Off the body that is there, so a legendary spider lays a legendary web.
    CHECK_NEAR(field.radius, sim.world.get<Body>(spider).radius * spec.radiusScale, 1e-9);
    CHECK(distance(sim.positionOf(web), kOrigin) < 1e-9);
    CHECK_NEAR(sim.world.get<Lifetime>(web).remainingSeconds, spec.lifetimeMillis / 1000.0,
               1e-9);
    // The side is COPIED onto the web, so it outlives the spider that laid it.
    CHECK(sim.world.get<Faction>(web).team == Team::Hostiles);
    CHECK(sim.world.has<Replicated>(web));

    // Two and a half seconds on: one at 1 s and one at 2 s, and no more.
    sim.tickIntent(75);
    CHECK_EQ(websIn(sim.world).size(), std::size_t(3));
}

TEST(only_a_legendary_spider_or_above_lays_webs) {
    CHECK(contentReady());
    const WebSpec& spec = content().mob(content().mobIndex("spider")).web;
    CHECK(spec.minRarity == Rarity::Legendary);
    for (int t = 0; t < kRarityCount; ++t) {
        const Rarity rarity = clampRarity(t);
        Sim sim;
        sim.spawnMob("spider", kOrigin, rarity);
        sim.tickIntent(45);   // a second and a half: two webs if it lays at all
        const std::size_t laid = websIn(sim.world).size();
        if (rarityIndex(rarity) >= rarityIndex(Rarity::Legendary)) {
            CHECK_EQ(laid, std::size_t(2));
        } else {
            CHECK_EQ(laid, std::size_t(0));
        }
    }
}

TEST(a_mob_without_a_web_block_lays_nothing) {
    CHECK(contentReady());
    Sim sim;
    sim.spawnMob("soldier_ant", kOrigin);
    sim.tickIntent(60);
    CHECK_EQ(websIn(sim.world).size(), std::size_t(0));
}
