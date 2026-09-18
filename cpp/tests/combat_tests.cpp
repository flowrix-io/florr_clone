#include "test.h"

#include "server/systems/combat.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/spatial.h"

#include <sys/stat.h>

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <string>

using namespace flix;

namespace {

// The world plus everything run() needs, so a test spends its lines on the
// behaviour under test rather than on assembling four collaborators.
struct Arena {
    World world;
    SpatialGrid grid;
    CommandBuffer commands{world};
    EventQueue events;
    CombatSystem combat;
    /// No content loaded: every petal reads as the registry's placeholder,
    /// which is inert. Tests that need real petal stats pass their own.
    ContentRegistry noContent;
    Query<Transform, Body> collidable{world};

    Entity actor(Vec2 at, double radius, double health, Team team, double mass = 1.0) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{radius, mass});
        world.add<Health>(e, Health{health, health, 0.0, 0.0});
        world.add<Faction>(e, Faction{team, false});
        return e;
    }

    Entity player(Vec2 at) {
        const Entity e = actor(at, 20.0, 100.0, Team::Players);
        world.add<PlayerTag>(e);
        world.add<PlayerProgress>(e);
        return e;
    }

    Entity mob(Vec2 at, double health, double xp = 0.0, double radius = 20.0) {
        const Entity e = actor(at, radius, health, Team::Hostiles);
        world.add<MobTag>(e);
        Bounty bounty;
        bounty.xp = xp;
        world.add<Bounty>(e, std::move(bounty));
        return e;
    }

    // The server rebuilds the broadphase at the top of every tick; a test that
    // forgets to would see combat find nothing and pass for the wrong reason.
    void rebuildGrid() {
        grid.clear();
        collidable.each([&](Entity e, Transform& transform, Body& body) {
            grid.insert(e, Realm::Overworld, transform.position,
                        broadphaseRadius(world.tryGet<MobPetalRing>(e), body.radius));
        });
    }

    void step(double nowMillis, const ContentRegistry& content, double dt = net::kTickSeconds) {
        rebuildGrid();
        combat.run(world, grid, content, nowMillis, dt, commands, events);
    }
    void step(double nowMillis) { step(nowMillis, noContent); }

    double health(Entity e) { return world.get<Health>(e).current; }
};

double slowFactorOf(World& world, Entity e) {
    const Afflictions* afflictions = world.tryGet<Afflictions>(e);
    return afflictions != nullptr ? afflictions->slowFactor : 1.0;
}

TEST(shell_shield_reduces_direct_hits_but_not_periodic_damage) {
    Arena arena;
    const Entity player = arena.player({0, 0});
    const Entity mob = arena.mob({100, 0}, 100);
    arena.world.add<ShieldState>(player, ShieldState{10.0, 2000.0});

    arena.combat.applyDamage(arena.world, player, mob, 15.0, 1000.0);
    CHECK_NEAR(arena.health(player), 95.0, 1e-9);

    arena.combat.applyDamage(arena.world, player, mob, 15.0, 1100.0, DamageKind::Periodic);
    CHECK_NEAR(arena.health(player), 80.0, 1e-9);

    arena.combat.applyDamage(arena.world, player, mob, 15.0, 3000.0);
    CHECK_NEAR(arena.health(player), 65.0, 1e-9);
}

TEST(a_direct_player_hit_grants_the_typescript_fifty_millisecond_window) {
    Arena arena;
    const Entity player = arena.player({0, 0});
    const Entity mob = arena.mob({100, 0}, 100);

    CHECK(!arena.combat.applyDamage(arena.world, player, mob, 10.0, 1000.0).refused);
    CHECK_NEAR(arena.health(player), 90.0, 1e-9);
    CHECK_NEAR(arena.world.get<Health>(player).invulnerableUntilMillis, 1050.0, 1e-9);
    CHECK(arena.combat.applyDamage(arena.world, player, mob, 10.0, 1049.0).refused);
    CHECK_NEAR(arena.health(player), 90.0, 1e-9);
    CHECK(!arena.combat.applyDamage(arena.world, player, mob, 10.0, 1050.0).refused);
    CHECK_NEAR(arena.health(player), 80.0, 1e-9);
}

TEST(a_sponge_queues_a_direct_hit_and_repays_it_after_invulnerability) {
    Arena arena;
    const Entity player = arena.player({0, 0});
    const Entity mob = arena.mob({100, 0}, 100);
    PlayerModifiers modifiers;
    modifiers.spongeDamageDurationMillis = 1000.0;
    arena.world.add<PlayerModifiers>(player, modifiers);

    const DamageResult hit = arena.combat.applyDamage(arena.world, player, mob, 10.0, 1000.0);
    CHECK(!hit.refused);
    CHECK_NEAR(hit.applied, 0.0, 1e-12);
    CHECK_NEAR(arena.health(player), 100.0, 1e-9);
    CHECK_EQ(arena.world.get<SpongeDamageState>(player).effects.size(), std::size_t(1));

    arena.step(1033.0);
    CHECK_NEAR(arena.health(player), 100.0, 1e-9);
    arena.step(1066.0);
    CHECK_NEAR(arena.health(player), 100.0 - 10.0 * net::kTickSeconds, 1e-9);
}

// --- synthetic content ------------------------------------------------------
//
// Hand-written rather than the shipped tables: these tests assert on exact
// numbers, and pinning them to whatever balance mobs.json currently ships
// would make a tuning change look like a combat regression.

std::string tempDir() {
    const char* env = std::getenv("TMPDIR");
    std::string base = (env != nullptr && *env != '\0') ? env : "/tmp";
    if (base.back() != '/') base.push_back('/');
    base += "flix_combat_tests";
    mkdir(base.c_str(), 0755);   // already exists is fine
    return base;
}

bool writeText(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return out.good();
}

struct Fixture {
    ContentRegistry registry;
    std::string error;
    bool ok = false;
    std::uint16_t sting = kInvalidIndex;
    std::uint16_t plain = kInvalidIndex;
    std::uint16_t jelly = kInvalidIndex;
    std::uint16_t venom = kInvalidIndex;
    std::uint16_t frost = kInvalidIndex;
    std::uint16_t spore = kInvalidIndex;
    std::uint16_t grunt = kInvalidIndex;
    std::uint16_t glitch = kInvalidIndex;
    std::uint16_t burr = kInvalidIndex;
    std::uint16_t taproot = kInvalidIndex;
    std::uint16_t dandy = kInvalidIndex;
};

const Fixture& fixture() {
    static const Fixture state = [] {
        Fixture f;
        const std::string mobs = tempDir() + "/mobs.json";
        const std::string petals = tempDir() + "/petals.json";
        // `poison` is per MILLISECOND in the JSON, so 0.01 is 10/second.
        const bool wrote =
            writeText(mobs, R"({
              "grunt":{"name":"Grunt","health":10,"damage":5,"size":1,"speed":1,"section":[0]},
              "glitch":{"name":"Glitch","health":250,"damage":25,"size":1,"speed":2.5,"section":[7]}
            })") &&
            writeText(petals, R"({
              "frost":{"name":"Frost","damage":1,"health":5,"size":1,"slowFactor":0.5,"slowDuration":1000},
              "sting":{"name":"Sting","damage":10,"health":5,"size":1,"knockback":2,"damageCooldown":500},
              "plain":{"name":"Plain","damage":10,"health":5,"size":1},
              "jelly":{"name":"Jelly","damage":1,"health":5,"size":1,"knockback":15},
              "venom":{"name":"Venom","damage":1,"health":5,"size":1,"poison":0.01,"poisonDuration":2000},
              "spore":{"name":"Spore","damage":0,"health":6,"size":1,"knockback":3,"poison":0.01,"poisonDuration":2000},
              "burr":{"name":"Burr","damage":5,"health":5,"size":1,"armorReduction":1.5},
              "taproot":{"name":"Taproot","damage":10,"health":10,"size":1,"armorPerStack":12},
              "dandy":{"name":"Dandy","damage":8,"health":8,"size":1,"noHealDuration":10000}
            })");
        if (!wrote) {
            f.error = "cannot write the fixture content";
            return f;
        }
        f.ok = f.registry.loadFiles(mobs, petals, std::string(), f.error);
        f.sting = f.registry.petalIndex("sting");
        f.plain = f.registry.petalIndex("plain");
        f.jelly = f.registry.petalIndex("jelly");
        f.venom = f.registry.petalIndex("venom");
        f.frost = f.registry.petalIndex("frost");
        f.spore = f.registry.petalIndex("spore");
        f.grunt = f.registry.mobIndex("grunt");
        f.glitch = f.registry.mobIndex("glitch");
        f.burr = f.registry.petalIndex("burr");
        f.taproot = f.registry.petalIndex("taproot");
        f.dandy = f.registry.petalIndex("dandy");
        return f;
    }();
    return state;
}

} // namespace

// ---------------------------------------------------------------------------
// applyDamage: the single path
// ---------------------------------------------------------------------------

TEST(damage_reduces_health_and_death_marks_dead_exactly_once) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0, 60.0);

    const DamageResult first = a.combat.applyDamage(a.world, mob, player, 30.0, 1000.0);
    CHECK(!first.refused);
    CHECK(!first.killed);
    CHECK_NEAR(first.applied, 30.0, 1e-9);
    CHECK_NEAR(a.health(mob), 70.0, 1e-9);
    // The white flash is set by the hit, not by a separate system.
    CHECK(a.world.get<Health>(mob).flashUntilMillis > 1000.0);
    CHECK(!a.world.has<Dead>(mob));

    // Overkill is clamped to what was actually left, so the ledger records
    // damage dealt and not damage swung.
    const DamageResult killing = a.combat.applyDamage(a.world, mob, player, 500.0, 1010.0);
    CHECK(killing.killed);
    CHECK_NEAR(killing.applied, 70.0, 1e-9);
    CHECK_NEAR(a.health(mob), 0.0, 1e-9);
    CHECK(a.world.has<Dead>(mob));
    CHECK_EQ(a.world.get<Dead>(mob).killer, player);

    // A corpse is not a target: a second killing blow would pay the bounty twice.
    const DamageResult afterwards = a.combat.applyDamage(a.world, mob, player, 10.0, 1020.0);
    CHECK(afterwards.refused);
    CHECK(!afterwards.killed);
    CHECK_EQ(a.combat.deaths().size(), std::size_t(1));
    CHECK_EQ(a.combat.deaths()[0].entity, mob);
    CHECK(!a.combat.deaths()[0].wasPlayer);
}

TEST(an_invulnerable_target_takes_nothing_until_protection_lapses) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    a.world.get<Health>(player).invulnerableUntilMillis = 5000.0;

    const DamageResult blocked = a.combat.applyDamage(a.world, player, mob, 50.0, 4999.0);
    CHECK(blocked.refused);
    CHECK_NEAR(blocked.applied, 0.0, 1e-12);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    // Not even a flash: a refused hit leaves no trace at all.
    CHECK_NEAR(a.world.get<Health>(player).flashUntilMillis, 0.0, 1e-12);

    // The bound is exclusive, so the tick it expires on already lands.
    const DamageResult landed = a.combat.applyDamage(a.world, player, mob, 50.0, 5000.0);
    CHECK(!landed.refused);
    CHECK_NEAR(a.health(player), 50.0, 1e-9);
}

TEST(non_finite_and_zero_damage_are_refused_but_negative_damage_heals_mobs) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);

    const double nan = std::nan("");
    CHECK(a.combat.applyDamage(a.world, mob, player, nan, 0.0).refused);
    CHECK(a.combat.applyDamage(a.world, mob, player, INFINITY, 0.0).refused);
    CHECK(!a.combat.applyDamage(a.world, mob, player, -5.0, 0.0).refused);
    CHECK(a.combat.applyDamage(a.world, mob, player, 0.0, 0.0).refused);
    // A NaN that got through would sit below zero forever and never compare
    // its way back out.
    CHECK_NEAR(a.health(mob), 105.0, 1e-9);
    CHECK(!a.world.has<Dead>(mob));
}

TEST(a_target_with_no_health_component_cannot_be_damaged) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity scenery = a.world.create();
    a.world.add<Transform>(scenery, Transform{{1000, 1000}, 0.0});
    CHECK(a.combat.applyDamage(a.world, scenery, player, 10.0, 0.0).refused);
    CHECK(!a.world.has<Dead>(scenery));
}

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

TEST(same_team_damage_is_refused_but_pvp_friendly_fire_lands) {
    Arena a;
    const Entity first = a.player({1000, 1000});
    const Entity second = a.player({1000, 1000});

    CHECK(!CombatSystem::canDamage(a.world, first, second));
    CHECK(a.combat.applyDamage(a.world, second, first, 25.0, 0.0).refused);
    CHECK_NEAR(a.health(second), 100.0, 1e-9);

    // One side being in a PvP region is enough: a duellist's pets carry no
    // flag of their own and would otherwise be unable to fight.
    a.world.get<Faction>(first).friendlyFireEnabled = true;
    CHECK(CombatSystem::canDamage(a.world, first, second));
    CHECK(!a.combat.applyDamage(a.world, second, first, 25.0, 0.0).refused);
    CHECK_NEAR(a.health(second), 75.0, 1e-9);

    // Wild mobs never hurt each other whatever the players are doing.
    const Entity mobA = a.mob({1000, 1000}, 50.0);
    const Entity mobB = a.mob({1000, 1000}, 50.0);
    CHECK(!CombatSystem::canDamage(a.world, mobA, mobB));
    CHECK(CombatSystem::canDamage(a.world, mobA, first));
}

TEST(nothing_can_damage_itself_or_what_it_owns) {
    Arena a;
    const Entity owner = a.player({1000, 1000});
    a.world.get<Faction>(owner).friendlyFireEnabled = true;   // even in PvP

    const Entity petal = a.world.create();
    a.world.add<PetalTag>(petal);
    // Named rather than positional: everything past `subCount` wants its own
    // default, and a positional list silently re-aims at the wrong field the
    // moment one is inserted above it.
    PetalInstance instance;
    instance.owner = owner;
    a.world.add<PetalInstance>(petal, instance);
    a.world.add<Transform>(petal, Transform{{1000, 1000}, 0.0});
    a.world.add<Body>(petal, Body{8.0, 1.0});

    const Entity pet = a.world.create();
    a.world.add<Pet>(pet, Pet{owner, 0});
    a.world.add<Health>(pet, Health{50.0, 50.0, 0.0, 0.0});
    a.world.add<Faction>(pet, Faction{Team::Players, true});

    CHECK(!CombatSystem::canDamage(a.world, petal, owner));
    CHECK(!CombatSystem::canDamage(a.world, petal, pet));    // resolves to the same flower
    CHECK(!CombatSystem::canDamage(a.world, owner, owner));
    CHECK(a.combat.applyDamage(a.world, owner, petal, 40.0, 0.0).refused);
    CHECK_NEAR(a.health(owner), 100.0, 1e-9);
}

TEST(a_hazard_with_no_faction_hurts_everything) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    // NULL_ENTITY is the environment. Refusing here instead would silently
    // disarm anything that forgot to give its source a Faction.
    CHECK(CombatSystem::canDamage(a.world, NULL_ENTITY, player));
    CHECK(!a.combat.applyDamage(a.world, player, NULL_ENTITY, 10.0, 0.0).refused);
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Contact damage
// ---------------------------------------------------------------------------

TEST(mob_contact_is_paced_by_the_flowers_post_hit_window_alone) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    // Co-located deliberately: TypeScript's 25-unit contact push separates
    // ordinary overlaps, while this test isolates the damage cadence.
    const Entity mob = a.mob({1000, 1000}, 100.0);
    // A per-victim interval on the ATTACKER is not consulted for mob body
    // contact: the reference's resolvePlayerMobContact carries no cooldown of
    // its own and leans entirely on the 50 ms invulnerability every hit
    // grants the flower.
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    a.step(0.0);
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
    CHECK_NEAR(a.world.get<Health>(player).invulnerableUntilMillis,
               kPostHitInvulnerabilityMillis, 1e-9);

    // 50 ms spans one 33 ms tick but not two, so resting contact costs a hit
    // every other tick -- not one a tick, and not one every 500 ms.
    for (int tick = 1; tick <= 10; ++tick) a.step(tick * net::kTickMillis);
    CHECK_NEAR(a.health(player), 40.0, 1e-9);

    a.step(500.0);
    CHECK_NEAR(a.health(player), 30.0, 1e-9);
}

TEST(contact_damage_needs_an_actual_overlap) {
    Arena a;
    const Entity player = a.player({1000, 1000});          // radius 20
    const Entity mob = a.mob({1000, 1000}, 100.0);         // radius 20
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    // Same broadphase cell, well outside touching range: the grid hands over
    // candidates, and the exact circle test is what decides.
    a.world.get<Transform>(mob).position = Vec2{1200, 1000};
    a.step(0.0);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);

    a.world.get<Transform>(mob).position = Vec2{1035, 1000};
    a.step(1000.0);
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
}

TEST(a_dead_body_stops_dealing_contact_damage_in_the_same_tick) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1005, 1000}, 100.0);
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});
    a.combat.applyDamage(a.world, mob, player, 500.0, 0.0);
    CHECK(a.world.has<Dead>(mob));

    a.step(0.0);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Knockback
// ---------------------------------------------------------------------------

TEST(knockback_replaces_the_pending_displacement_and_is_scaled_by_mass) {
    Arena a;
    const Entity light = a.actor({1000, 1000}, 10.0, 100.0, Team::Hostiles, 1.0);
    const Entity heavy = a.actor({1000, 1000}, 10.0, 100.0, Team::Hostiles, 4.0);

    a.combat.applyKnockback(a.world, light, Vec2{5, 0}, 5.0);
    a.combat.applyKnockback(a.world, light, Vec2{5, 0}, 5.0);
    // setMobKnockback() replaces rather than accumulates, so a dense petal
    // ring does not launch a mob farther for each overlapping instance.
    CHECK_NEAR(a.world.get<Knockback>(light).impulse.x, 5.0, 1e-9);
    CHECK_NEAR(a.world.get<Knockback>(light).impulse.y, 0.0, 1e-12);

    a.combat.applyKnockback(a.world, heavy, Vec2{5, 0}, 5.0);
    CHECK_NEAR(a.world.get<Knockback>(heavy).impulse.x, 5.0 / 4.0, 1e-9);

    // The push is a direction, not a displacement: a distant hit does not push
    // harder than a touching one.
    const Entity other = a.actor({1000, 1000}, 10.0, 100.0, Team::Hostiles, 1.0);
    a.combat.applyKnockback(a.world, other, Vec2{0, 400}, 5.0);
    CHECK_NEAR(a.world.get<Knockback>(other).impulse.y, 5.0, 1e-9);
    CHECK_NEAR(a.world.get<Knockback>(other).impulse.x, 0.0, 1e-12);
}

TEST(knockback_preserves_the_typescript_magnitude_and_skips_static_entities) {
    Arena a;
    const Entity mover = a.actor({1000, 1000}, 10.0, 100.0, Team::Hostiles, 0.001);
    a.combat.applyKnockback(a.world, mover, Vec2{1, 0}, 1e6);
    CHECK_NEAR(a.world.get<Knockback>(mover).impulse.x, 1e9, 1e-3);

    // A nest has no Motion; pushing it would only cost an archetype move.
    const Entity nest = a.world.create();
    a.world.add<Transform>(nest, Transform{{1000, 1000}, 0.0});
    a.world.add<Body>(nest, Body{30.0, 100.0});
    a.combat.applyKnockback(a.world, nest, Vec2{1, 0}, 50.0);
    CHECK(!a.world.has<Knockback>(nest));

    // Exactly co-located: there is no direction to push along.
    const Entity stacked = a.actor({1000, 1000}, 10.0, 100.0, Team::Hostiles, 1.0);
    a.combat.applyKnockback(a.world, stacked, Vec2{0, 0}, 50.0);
    CHECK(!a.world.has<Knockback>(stacked));
}

TEST(a_contact_hit_pushes_the_victim_away_from_the_attacker) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({980, 1000}, 100.0);
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    a.step(0.0);
    CHECK_NEAR(a.world.get<Transform>(player).position.x, 1025.0, 1e-9);
    CHECK_NEAR(a.world.get<Transform>(player).position.y, 1000.0, 1e-9);
}

TEST(a_mob_contact_knocks_an_invulnerable_player_back) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    a.world.get<Health>(player).invulnerableUntilMillis = 1000.0;
    const Entity mob = a.mob({980, 1000}, 100.0);
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    a.step(0.0);
    // playerState.ts performs this displacement before its invulnerability
    // branch. Damage is refused; the 25-unit push is not.
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    CHECK_NEAR(a.world.get<Transform>(player).position.x, 1025.0, 1e-9);
}

TEST(only_the_first_mob_contact_lands_per_player_per_tick) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity first = a.mob({1000, 1000}, 100.0);
    const Entity second = a.mob({1000, 1000}, 100.0);
    a.world.add<ContactDamage>(first, ContactDamage{10.0, 500.0});
    a.world.add<ContactDamage>(second, ContactDamage{10.0, 500.0});

    a.step(0.0);
    // playerState.ts breaks out of the candidate loop after the first contact.
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
}

TEST(a_glitch_mobs_touch_marks_the_flower_even_while_invulnerable) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    Arena a;
    const Entity player = a.player({1000, 1000});
    a.world.add<PlayerVisuals>(player);
    a.world.get<Health>(player).invulnerableUntilMillis = 1000.0;
    const Entity mob = a.mob({980, 1000}, 100.0);
    a.world.add<MobType>(mob, MobType{f.glitch, Rarity::Common});
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    a.step(0.0, f.registry);
    // playerState.ts sets `glitched` beside the 25-unit bump and above its
    // invulnerability branch: the damage is refused, the mark is not. It is
    // what the client's PlayerRenderGlitch bit is ORed from on the wire.
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    CHECK_NEAR(a.world.get<Transform>(player).position.x, 1025.0, 1e-9);
    CHECK(a.world.get<PlayerVisuals>(player).glitched);

    // And it stays: nothing in combat clears it once the mob has gone.
    a.world.add<Dead>(mob);
    a.step(net::kTickMillis, f.registry);
    CHECK(a.world.get<PlayerVisuals>(player).glitched);
}

TEST(an_ordinary_mobs_touch_leaves_no_mark) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    Arena a;
    const Entity player = a.player({1000, 1000});
    a.world.add<PlayerVisuals>(player);
    const Entity mob = a.mob({980, 1000}, 100.0);
    a.world.add<MobType>(mob, MobType{f.grunt, Rarity::Common});
    a.world.add<ContactDamage>(mob, ContactDamage{10.0, 500.0});

    a.step(0.0, f.registry);
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
    CHECK(!a.world.get<PlayerVisuals>(player).glitched);
}

// ---------------------------------------------------------------------------
// Afflictions
// ---------------------------------------------------------------------------

TEST(poison_ticks_over_time_and_then_expires) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 1000.0);
    a.combat.applyPoison(a.world, mob, player, 10.0, 1000.0, 0.0);

    // Thirty fixed ticks is one second: 10/second lands 10 damage in total.
    for (int tick = 0; tick < net::kTicksPerSecond; ++tick) {
        a.step(tick * net::kTickMillis);
    }
    CHECK_NEAR(a.health(mob), 990.0, 1e-6);

    // Past its duration the affliction clears itself, so the replicated state
    // bit stops claiming the mob is poisoned.
    a.step(1000.0);
    a.step(1040.0);
    CHECK_NEAR(a.health(mob), 990.0, 1e-6);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 0.0, 1e-12);
    CHECK(!a.world.get<Afflictions>(mob).poisoned(1040.0));
}

TEST(a_poison_kill_still_credits_its_source) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 2.0, 100.0);
    a.combat.applyPoison(a.world, mob, player, 10.0, 5000.0, 0.0);

    for (int tick = 0; tick < 10 && !a.world.has<Dead>(mob); ++tick) {
        a.step(tick * net::kTickMillis);
    }
    CHECK(a.world.has<Dead>(mob));
    CHECK_EQ(a.world.get<Dead>(mob).killer, player);
    // The whole bounty, because the poison did every point of the damage.
    CHECK_NEAR(a.world.get<PlayerProgress>(player).totalXp, 100.0, 1e-9);
}

TEST(a_fresh_bite_takes_over_a_mobs_stack_only_when_it_would_outlast_it) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity other = a.player({2000, 1000});
    const Entity mob = a.mob({1000, 1000}, 1000.0);

    a.combat.applyPoison(a.world, mob, player, 5.0, 1000.0, 0.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 5.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonUntilMillis, 1000.0, 1e-9);

    // Stronger but SHORTER changes nothing at all. gardn's outlast rule
    // (Damage.cc) is what the reference ports: a fresh bite takes over its
    // stack only when it would run longer, rate and all. Without the guard a
    // pincer landing after an iris wipes the iris poison.
    a.combat.applyPoison(a.world, mob, player, 20.0, 200.0, 0.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 5.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonUntilMillis, 1000.0, 1e-9);

    // Weaker but longer DOES take over, and brings its own rate with it.
    a.combat.applyPoison(a.world, mob, player, 1.0, 3000.0, 0.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 1.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonUntilMillis, 3000.0, 1e-9);

    // The rule is per (victim, source) pair: a second flower's bite is its own
    // stack and both tick, so two players poisoning one mob is twice the rate.
    a.combat.applyPoison(a.world, mob, other, 4.0, 2000.0, 0.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 5.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonUntilMillis, 3000.0, 1e-9);
    // The one culprit named for the client is the strongest of them.
    CHECK_EQ(a.world.get<Afflictions>(mob).poisonSource, other);

    // Once every stack has lapsed, any strength takes hold again.
    a.combat.applyPoison(a.world, mob, player, 1.0, 500.0, 4000.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 1.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonUntilMillis, 4500.0, 1e-9);
}

TEST(a_stronger_slow_replaces_a_weaker_one_but_not_the_other_way) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);

    a.combat.applySlow(a.world, mob, 0.8, 1000.0, Rarity::Common, 0.0);
    CHECK_NEAR(slowFactorOf(a.world, mob), 0.8, 1e-9);

    // Lower factor is a deeper slow.
    a.combat.applySlow(a.world, mob, 0.3, 200.0, Rarity::Common, 0.0);
    CHECK_NEAR(slowFactorOf(a.world, mob), 0.3, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).slowUntilMillis, 1000.0, 1e-9);

    a.combat.applySlow(a.world, mob, 0.95, 4000.0, Rarity::Common, 0.0);
    CHECK_NEAR(slowFactorOf(a.world, mob), 0.3, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).slowUntilMillis, 4000.0, 1e-9);

    // A factor of 1 is not a slow at all and must not create an affliction.
    const Entity fresh = a.mob({1000, 1000}, 100.0);
    a.combat.applySlow(a.world, fresh, 1.0, 1000.0, Rarity::Common, 0.0);
    CHECK(!a.world.has<Afflictions>(fresh));
}

TEST(an_expired_slow_is_cleared_by_the_tick) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.combat.applySlow(a.world, mob, 0.5, 100.0, Rarity::Common, 0.0);
    a.step(0.0);
    CHECK(a.world.get<Afflictions>(mob).slowed(0.0));

    a.step(200.0);
    CHECK_NEAR(slowFactorOf(a.world, mob), 1.0, 1e-12);
    CHECK(!a.world.get<Afflictions>(mob).slowed(200.0));
}

TEST(stall_power_thins_a_slow_landed_on_a_higher_tier_mob) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<MobType>(mob, MobType{0, Rarity::Rare, 1.0});

    // Two tiers up: a ninth of the slow lands, so 0.1 becomes 1 - 0.9/9.
    a.combat.applySlow(a.world, mob, 0.1, 1000.0, Rarity::Common, 0.0);
    CHECK_NEAR(slowFactorOf(a.world, mob), 1.0 - 0.9 / 9.0, 1e-9);

    // Out-tiering it buys reliability, never a deeper slow than the petal has.
    const Entity common = a.mob({1000, 1000}, 100.0);
    a.world.add<MobType>(common, MobType{0, Rarity::Common, 1.0});
    a.combat.applySlow(a.world, common, 0.1, 1000.0, Rarity::Mythic, 0.0);
    CHECK_NEAR(slowFactorOf(a.world, common), 0.1, 1e-9);
}

// ---------------------------------------------------------------------------
// Bounty
// ---------------------------------------------------------------------------

TEST(each_ranked_contributor_receives_the_mobs_full_xp) {
    Arena a;
    const Entity first = a.player({1000, 1000});
    const Entity second = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0, 120.0);

    a.combat.applyDamage(a.world, mob, first, 75.0, 0.0);
    // Overkill: the excess must not inflate the last hitter's share.
    a.combat.applyDamage(a.world, mob, second, 900.0, 10.0);
    CHECK(a.world.has<Dead>(mob));

    CHECK_NEAR(a.world.get<PlayerProgress>(first).totalXp, 120.0, 1e-9);
    CHECK_NEAR(a.world.get<PlayerProgress>(second).totalXp, 120.0, 1e-9);
}

TEST(a_mob_killed_by_another_mob_pays_nobody) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity killer = a.mob({1000, 1000}, 100.0);
    const Entity victim = a.mob({1000, 1000}, 100.0);
    a.world.get<Faction>(victim).team = Team::Neutral;

    a.combat.applyDamage(a.world, victim, killer, 500.0, 0.0);
    CHECK(a.world.has<Dead>(victim));
    CHECK_NEAR(a.world.get<PlayerProgress>(player).totalXp, 0.0, 1e-12);
}

TEST(crossing_an_xp_threshold_flags_the_level_up) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 10.0, 250.0);

    a.combat.applyDamage(a.world, mob, player, 10.0, 0.0);
    const PlayerProgress& progress = a.world.get<PlayerProgress>(player);
    CHECK_NEAR(progress.totalXp, 250.0, 1e-9);
    CHECK_EQ(progress.level, levelFromTotalXp(250.0).level);
    CHECK(progress.level > 1);
    CHECK(progress.leveledThisTick);

    // The flag is owned by combat and cleared at the top of the next tick, so
    // replication cannot emit the same level-up twice.
    a.step(40.0);
    CHECK(!a.world.get<PlayerProgress>(player).leveledThisTick);
}

TEST(a_pets_kill_credits_its_owner) {
    Arena a;
    const Entity owner = a.player({1000, 1000});
    const Entity pet = a.actor({1000, 1000}, 15.0, 50.0, Team::Players);
    a.world.add<MobTag>(pet);
    a.world.add<Pet>(pet, Pet{owner, 0});
    const Entity mob = a.mob({1000, 1000}, 40.0, 80.0);

    CHECK_EQ(CombatSystem::creditedPlayer(a.world, pet), owner);
    a.combat.applyDamage(a.world, mob, pet, 100.0, 0.0);
    CHECK(a.world.has<Dead>(mob));
    // The owner, not the pet: XP has to reach an account.
    CHECK_EQ(a.world.get<Dead>(mob).killer, owner);
    CHECK_NEAR(a.world.get<PlayerProgress>(owner).totalXp, 80.0, 1e-9);
}

TEST(a_players_death_is_reported_and_pays_no_bounty) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    Bounty bounty;
    bounty.xp = 500.0;
    a.world.add<Bounty>(player, std::move(bounty));

    a.combat.applyDamage(a.world, player, mob, 200.0, 0.0);
    CHECK(a.world.has<Dead>(player));
    CHECK_EQ(a.combat.deaths().size(), std::size_t(1));
    CHECK(a.combat.deaths()[0].wasPlayer);
    CHECK_EQ(a.combat.deaths()[0].killer, mob);
    // Nothing is handed out for killing a flower here: the account keeps what
    // it had and the Died message is the whole of the consequence.
    CHECK_NEAR(a.world.get<PlayerProgress>(player).totalXp, 0.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

namespace {

Entity spawnShot(Arena& a, Vec2 at, Vec2 velocity, double damage, double range,
                 Entity owner, Entity creditTo) {
    const Entity e = a.world.create();
    a.world.add<ProjectileTag>(e);
    Projectile projectile;
    projectile.owner = owner;
    projectile.creditTo = creditTo;
    projectile.damage = damage;
    projectile.remainingDistance = range;
    // Where the server seeds it at spawn. Left at the origin the shot would
    // read as having flown a segment from {0,0} to here, and combat tests that
    // whole segment.
    projectile.lastPosition = at;
    a.world.add<Projectile>(e, projectile);
    a.world.add<Transform>(e, Transform{at, 0.0});
    a.world.add<Motion>(e, Motion{velocity});
    a.world.add<Body>(e, Body{5.0, 0.1});
    return e;
}

} // namespace

TEST(a_projectile_hits_the_nearest_target_once_and_expires) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity near = a.mob({1000, 1000}, 100.0, 40.0);
    const Entity far = a.mob({1030, 1000}, 100.0, 40.0);
    const Entity shot = spawnShot(a, {1005, 1000}, {1000, 0}, 25.0, 500.0, player, player);

    a.step(0.0);
    CHECK_NEAR(a.health(near), 75.0, 1e-9);
    CHECK_NEAR(a.health(far), 100.0, 1e-9);   // consumed by the first thing it met
    CHECK(a.world.has<Dead>(shot));

    // Already marked: a second tick must not deal the damage again.
    a.step(40.0);
    CHECK_NEAR(a.health(near), 75.0, 1e-9);
}

TEST(a_fast_projectile_cannot_step_over_a_body_between_ticks) {
    Arena a;
    const Entity player = a.player({500, 2000});
    const Entity mob = a.mob({800, 1000}, 100.0);

    // An apex shooter's missile flies faster than its own hit reach is wide,
    // because speed rides the calibre: this one covered 200 units in the tick
    // and is 25 units of reach across. Tested at its ENDPOINT it has already
    // passed the mob and misses forever; tested along the segment it flew, it
    // hits the thing that was standing in the way.
    const Entity shot = spawnShot(a, {900, 1000}, {5000, 0}, 25.0, 500.0, player, player);
    a.world.get<Projectile>(shot).lastPosition = Vec2{700, 1000};

    a.step(0.0);
    CHECK_NEAR(a.health(mob), 75.0, 1e-9);
    CHECK(a.world.has<Dead>(shot));
}

TEST(a_projectile_still_misses_what_its_path_went_wide_of) {
    Arena a;
    const Entity player = a.player({500, 2000});
    // Beside the line rather than on it, by more than the two radii: sweeping
    // the segment must not turn the test into a corridor the width of the
    // whole tick's travel.
    const Entity mob = a.mob({800, 1040}, 100.0);

    const Entity shot = spawnShot(a, {900, 1000}, {5000, 0}, 25.0, 500.0, player, player);
    a.world.get<Projectile>(shot).lastPosition = Vec2{700, 1000};

    a.step(0.0);
    CHECK_NEAR(a.health(mob), 100.0, 1e-9);
    CHECK(!a.world.has<Dead>(shot));
}

TEST(a_projectile_expires_when_its_range_runs_out) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    // Movement has already spent the shot's five-unit range before combat.
    const Entity shot = spawnShot(a, {1000, 1000}, {1000, 0}, 25.0, 5.0, player, player);
    a.world.get<Projectile>(shot).remainingDistance = 0.0;

    a.step(0.0);
    CHECK(a.world.has<Dead>(shot));
    // Range ran out first, so the overlapping mob is untouched.
    CHECK_NEAR(a.health(mob), 100.0, 1e-9);
}

TEST(a_projectile_passes_through_its_own_side) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity pet = a.actor({1000, 1000}, 15.0, 50.0, Team::Players);
    a.world.add<Pet>(pet, Pet{player, 0});
    // Fired by the pet, credited to the flower: neither of them is a target.
    const Entity shot = spawnShot(a, {1000, 1000}, {100, 0}, 25.0, 500.0, pet, player);

    a.step(0.0);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    CHECK_NEAR(a.health(pet), 50.0, 1e-9);
    CHECK(!a.world.has<Dead>(shot));
    // Combat does not spend range a second time; MovementSystem owns flight.
    CHECK_NEAR(a.world.get<Projectile>(shot).remainingDistance, 500.0, 1e-9);
}

TEST(a_mob_shot_credits_nobody_and_still_kills) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    a.world.get<Health>(player).current = 10.0;
    const Entity shot = spawnShot(a, {1000, 1000}, {100, 0}, 25.0, 500.0, mob, NULL_ENTITY);
    a.world.add<Faction>(shot, Faction{Team::Hostiles, false});

    a.step(0.0);
    CHECK(a.world.has<Dead>(player));
    // The mob behind the shot is the killer, which is what the Died message
    // needs to name.
    CHECK_EQ(a.world.get<Dead>(player).killer, mob);
}

// ---------------------------------------------------------------------------
// Projectiles as bodies (the arras.io model)
// ---------------------------------------------------------------------------
//
// The tests above spawn shots with no Health at all, and they still pass: a
// shot with no pool is consumed by the first thing it meets, which is what
// every shot did before it had one. The pool is what the rest of this section
// is about.

namespace {

/// A shot that penetrates: the same body as spawnShot, plus the health pool
/// and the per-victim ledger that the two firing paths give a real one.
Entity spawnDurableShot(Arena& a, Vec2 at, Vec2 velocity, double damage, double range,
                        Entity owner, Entity creditTo, double health,
                        Team team = Team::Players) {
    const Entity e = spawnShot(a, at, velocity, damage, range, owner, creditTo);
    a.world.add<Health>(e, Health{health, health});
    a.world.add<HitCooldowns>(e, HitCooldowns{});
    a.world.add<Faction>(e, Faction{team, false});
    return e;
}

} // namespace

TEST(a_shot_penetrates_a_line_of_mobs_until_its_pool_runs_out) {
    Arena a;
    const Entity player = a.player({500, 1000});
    // Three bodies the shot is already overlapping. None declares contact
    // damage, so each costs the shot kProjectileDefaultBodyDamage.
    const Entity first = a.mob({1000, 1000}, 100.0);
    const Entity second = a.mob({1030, 1000}, 100.0);
    const Entity third = a.mob({1060, 1000}, 100.0);
    const Entity shot =
        spawnDurableShot(a, {1020, 1000}, {1000, 0}, 25.0, 500.0, player, player, 2.0);

    a.step(0.0);
    // Two paid for, in distance order from the shot; the third is behind a
    // pool that is already empty.
    CHECK_NEAR(a.health(second), 75.0, 1e-9);
    CHECK_NEAR(a.health(first), 75.0, 1e-9);
    CHECK_NEAR(a.health(third), 100.0, 1e-9);
    CHECK(a.world.has<Dead>(shot));
}

TEST(a_shot_passing_through_a_body_trades_health_for_damage_every_tick) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity mob = a.mob({1000, 1000}, 500.0);
    // Deep enough to survive several passes, so what governs the second hit is
    // the ledger and not the pool running out.
    const Entity shot =
        spawnDurableShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, player, player, 100.0);

    a.step(0.0);
    CHECK_NEAR(a.health(mob), 475.0, 1e-9);
    CHECK_NEAR(a.health(shot), 99.0, 1e-9);
    CHECK(!a.world.has<Dead>(shot));

    // kPetalHitIntervalMillis is ZERO, and deliberately so: the reference
    // throttles only the three petals that name a `damageCooldown` and lets
    // every other one damage what it overlaps on every tick, paying for it out
    // of its own health. A shot is a petal that flies, so it does the same --
    // damage every tick, pool spent every tick. The ledger is what carries the
    // three throttled petals' volleys, not a default.
    a.step(net::kTickMillis);
    CHECK_NEAR(a.health(mob), 450.0, 1e-9);
    CHECK_NEAR(a.health(shot), 98.0, 1e-9);
}

TEST(a_shot_from_a_throttled_petal_waits_out_its_own_ledger) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity mob = a.mob({1000, 1000}, 500.0);
    const Entity shot =
        spawnDurableShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, player, player, 100.0);

    a.step(0.0);
    CHECK_NEAR(a.health(mob), 475.0, 1e-9);

    // Stand in for a `damageCooldown` petal by arming the shot's own ledger:
    // the entry is keyed on the VICTIM, so the shot may still hit anything
    // else it meets in the meantime.
    a.world.get<HitCooldowns>(shot).arm(mob, 500.0);
    a.step(net::kTickMillis);
    CHECK_NEAR(a.health(mob), 475.0, 1e-9);
    // The pool is untouched too: a refused hit costs the shot nothing.
    CHECK_NEAR(a.health(shot), 99.0, 1e-9);

    a.step(500.0);
    CHECK_NEAR(a.health(mob), 450.0, 1e-9);
}

TEST(a_shot_is_spent_whole_on_a_flower) {
    Arena a;
    const Entity mob = a.mob({500, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    // A pool that would carry it through a hundred mobs buys it nothing here:
    // a flower has no body damage to charge with, and a shot that survived
    // would sit inside a victim who is briefly invulnerable to it.
    const Entity shot = spawnDurableShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, mob,
                                         NULL_ENTITY, 100.0, Team::Hostiles);

    a.step(0.0);
    CHECK_NEAR(a.health(player), 75.0, 1e-9);
    CHECK(a.world.has<Dead>(shot));
}

TEST(a_glitch_mobs_shot_marks_the_flower_it_hits) {
    Arena a;
    const Entity mob = a.mob({500, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    a.world.add<PlayerVisuals>(player);
    const Entity shot = spawnShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, mob, NULL_ENTITY);
    a.world.add<Faction>(shot, Faction{Team::Hostiles, false});
    a.world.get<Projectile>(shot).glitchInfecting = true;

    a.step(0.0);
    CHECK_NEAR(a.health(player), 75.0, 1e-9);
    CHECK(a.world.get<PlayerVisuals>(player).glitched);
}

TEST(a_glitch_shot_marks_an_invulnerable_flower_it_passes_through) {
    Arena a;
    const Entity mob = a.mob({500, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    a.world.add<PlayerVisuals>(player);
    a.world.get<Health>(player).invulnerableUntilMillis = 1000.0;
    const Entity shot = spawnShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, mob, NULL_ENTITY);
    a.world.add<Faction>(shot, Faction{Team::Hostiles, false});
    a.world.get<Projectile>(shot).glitchInfecting = true;

    a.step(0.0);
    // server.ts applyProjectileHitToPlayer: the mark lands before the
    // invulnerability branch that refuses the damage.
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    CHECK(a.world.get<PlayerVisuals>(player).glitched);
}

TEST(an_ordinary_shot_leaves_no_mark_and_a_friendly_glitch_shot_leaves_none_either) {
    Arena a;
    const Entity mob = a.mob({500, 1000}, 100.0);
    const Entity player = a.player({1000, 1000});
    a.world.add<PlayerVisuals>(player);
    const Entity plain = spawnShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, mob, NULL_ENTITY);
    a.world.add<Faction>(plain, Faction{Team::Hostiles, false});
    // A glitch flower fighting FOR the flower (the Flower petal's pet squad)
    // shoots from the flower's own side, and its shots pass through it.
    const Entity friendly = spawnShot(a, {1000, 1000}, {1000, 0}, 25.0, 500.0, NULL_ENTITY,
                                      NULL_ENTITY);
    a.world.add<Faction>(friendly, Faction{Team::Players, false});
    a.world.get<Projectile>(friendly).glitchInfecting = true;

    a.step(0.0);
    CHECK_NEAR(a.health(player), 75.0, 1e-9);
    CHECK(!a.world.get<PlayerVisuals>(player).glitched);
}

TEST(opposing_shots_shoot_each_other_down) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity mob = a.mob({1500, 1000}, 100.0);
    const Entity outgoing =
        spawnDurableShot(a, {1000, 1000}, {1000, 0}, 12.0, 500.0, player, player, 10.0);
    const Entity incoming = spawnDurableShot(a, {1005, 1000}, {-1000, 0}, 4.0, 500.0, mob,
                                             NULL_ENTITY, 10.0, Team::Hostiles);

    a.step(0.0);
    // Each charged the other its damage stat: the trade is symmetric, and the
    // weaker pool is the one that empties.
    CHECK_NEAR(a.health(outgoing), 6.0, 1e-9);
    CHECK(a.world.has<Dead>(incoming));
    CHECK(!a.world.has<Dead>(outgoing));
}

TEST(shots_from_one_side_pass_through_each_other) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity first =
        spawnDurableShot(a, {1000, 1000}, {1000, 0}, 12.0, 500.0, player, player, 10.0);
    const Entity second =
        spawnDurableShot(a, {1002, 1000}, {1000, 0}, 12.0, 500.0, player, player, 10.0);

    a.step(0.0);
    CHECK_NEAR(a.health(first), 10.0, 1e-9);
    CHECK_NEAR(a.health(second), 10.0, 1e-9);
    CHECK(!a.world.has<Dead>(first));
    CHECK(!a.world.has<Dead>(second));
}

TEST(a_shot_shoves_the_mob_it_hits_along_its_own_momentum) {
    Arena a;
    const Entity player = a.player({500, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity shot = spawnShot(a, {980, 1000}, {300, 0}, 25.0, 500.0, player, player);
    // The push is momentum, so the shot needs a real mass and a real speed.
    a.world.get<Body>(shot).mass = projectileMass(10.0);
    a.world.add<Health>(shot, Health{100.0, 100.0});
    a.world.add<HitCooldowns>(shot, HitCooldowns{});

    // Petal stats come out of the registry, and the placeholder content the
    // arena loads carries none -- so the riders are skipped and this measures
    // the push alone. It still needs a petal index to reach them at all.
    a.world.get<Projectile>(shot).petalConfigIndex = 0;

    const double before = a.world.get<Transform>(mob).position.x;
    a.step(0.0);
    const double after = a.world.get<Transform>(mob).position.x;
    // Pushed AWAY from the shot, along the line between the two bodies.
    CHECK(after > before);
    CHECK_NEAR(after - before, projectilePush(projectileMass(10.0), 300.0,
                                              a.world.get<Body>(mob).mass), 1e-9);
}

// ---------------------------------------------------------------------------
// Ground effects
// ---------------------------------------------------------------------------

TEST(a_ground_effect_damages_and_slows_only_what_stands_in_it) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity inside = a.mob({1050, 1000}, 100.0);
    const Entity outside = a.mob({1300, 1000}, 100.0);

    const Entity field = a.world.create();
    a.world.add<GroundEffectTag>(field);
    a.world.add<GroundEffect>(field, GroundEffect{GroundEffectKind::Poison, player, 100.0,
                                                  50.0, 0.5, Rarity::Common});
    a.world.add<Transform>(field, Transform{{1000, 1000}, 0.0});

    a.step(0.0);
    CHECK_NEAR(a.health(inside), 100.0 - 50.0 * net::kTickSeconds, 1e-9);
    CHECK_NEAR(a.health(outside), 100.0, 1e-9);
    CHECK_NEAR(slowFactorOf(a.world, inside), 0.5, 1e-9);
    CHECK_NEAR(slowFactorOf(a.world, outside), 1.0, 1e-12);
    // The owner is on the field's own side and is never hurt by it.
    CHECK_NEAR(a.health(player), 100.0, 1e-9);

    // The slow is refreshed every tick inside and lapses shortly after leaving.
    a.world.get<Transform>(inside).position = Vec2{1300, 1000};
    a.step(40.0);
    a.step(40.0 + kGroundEffectSlowLingerMillis + net::kTickMillis);
    CHECK_NEAR(slowFactorOf(a.world, inside), 1.0, 1e-12);
}

TEST(a_timed_ground_effect_expires_and_stops_applying) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity field = a.world.create();
    a.world.add<GroundEffectTag>(field);
    a.world.add<GroundEffect>(field, GroundEffect{GroundEffectKind::Radiation, player, 100.0,
                                                  30.0, 1.0, Rarity::Common});
    a.world.add<Transform>(field, Transform{{1000, 1000}, 0.0});
    a.world.add<Lifetime>(field, Lifetime{net::kTickSeconds * 1.5});

    a.step(0.0);
    CHECK_NEAR(a.health(mob), 99.0, 1e-9);
    a.step(net::kTickMillis);
    CHECK(a.world.has<Dead>(field));
    CHECK_NEAR(a.health(mob), 99.0, 1e-9);
}

TEST(pollen_hits_each_mob_at_most_once_per_half_second) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    const Entity field = a.world.create();
    a.world.add<GroundEffectTag>(field);
    a.world.add<GroundEffect>(field, GroundEffect{GroundEffectKind::Poison, player, 100.0,
                                                  0.0, 1.0, Rarity::Common, 7.0, 500.0});
    a.world.add<Transform>(field, Transform{{1000, 1000}, 0.0});

    a.step(1000.0);
    CHECK_NEAR(a.health(mob), 93.0, 1e-9);
    a.step(1200.0);
    CHECK_NEAR(a.health(mob), 93.0, 1e-9);
    a.step(1500.0);
    CHECK_NEAR(a.health(mob), 86.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Petals, against real config
// ---------------------------------------------------------------------------

namespace {

Entity equipPetal(Arena& a, Entity owner, std::uint16_t configIndex, Rarity rarity, Vec2 at) {
    const Entity e = a.world.create();
    a.world.add<PetalTag>(e);
    PetalInstance instance;
    instance.owner = owner;
    instance.configIndex = configIndex;
    instance.rarity = rarity;
    a.world.add<PetalInstance>(e, instance);
    a.world.add<Transform>(e, Transform{at, 0.0});
    a.world.add<Body>(e, Body{8.0, 0.2});
    return e;
}

} // namespace

TEST(a_petal_hits_with_its_config_stats_and_its_own_cooldown) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1040, 1000}, 200.0, 60.0);
    const Entity petal = equipPetal(a, player, f.sting, Rarity::Common, {1025, 1000});

    a.step(0.0, f.registry);
    CHECK_NEAR(a.health(mob), 190.0, 1e-9);          // sting: 10 damage at common
    CHECK(a.world.get<Knockback>(mob).impulse.x > 0.0);
    // Damage dealt by a petal is answerable to the flower wearing it.
    CHECK_EQ(CombatSystem::creditedPlayer(a.world, petal), player);
    CHECK_NEAR(a.world.get<Bounty>(mob).contributors.at(0).damage, 10.0, 1e-9);
    CHECK_EQ(a.world.get<Bounty>(mob).contributors.at(0).player, player);

    // damageCooldown of 500ms, not the tick rate.
    a.step(net::kTickMillis, f.registry);
    CHECK_NEAR(a.health(mob), 190.0, 1e-9);
    a.step(500.0, f.registry);
    CHECK_NEAR(a.health(mob), 180.0, 1e-9);
}

TEST(a_petal_without_a_knockback_field_uses_the_game_default) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The web implementation defaults an omitted knockback to 5.  Most
    // ordinary petals omit the JSON field, so reading it as zero silently
    // removed their push in the native game.
    CHECK_NEAR(f.registry.petalStats(f.plain, Rarity::Common).knockback, 5.0, 1e-9);
    // Unlike damage, ordinary knockback does not use the rarity multiplier.
    CHECK_NEAR(f.registry.petalStats(f.sting, Rarity::Mythic).knockback, 2.0, 1e-9);
    // Jelly is the one TypeScript rarity-override table for this stat.
    CHECK_NEAR(f.registry.petalStats(f.jelly, Rarity::Rare).knockback, 100.0, 1e-9);

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1040, 1000}, 100.0);
    equipPetal(a, player, f.plain, Rarity::Common, {1025, 1000});

    a.step(0.0, f.registry);
    CHECK(a.world.has<Knockback>(mob));
    CHECK(a.world.get<Knockback>(mob).impulse.x > 0.0);
}

TEST(rarity_scales_a_petals_damage_off_the_config) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1040, 1000}, 5000.0);
    equipPetal(a, player, f.sting, Rarity::Rare, {1025, 1000});

    a.step(0.0, f.registry);
    // Two tiers up the flat 3x ladder: 10 -> 90.
    CHECK_NEAR(a.health(mob), 5000.0 - 90.0, 1e-9);
}

TEST(a_petals_damage_takes_the_talent_scale_and_not_the_loadout_one) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    {
        // The loadout aggregate scales the FLOWER's own body damage and
        // nothing a petal does. The reference's getDamageMultiplier is the
        // damage TALENT times any damage_boost effect, and no petal
        // `playerModifiers.damage` is folded into the petal side at all.
        Arena a;
        const Entity player = a.player({1000, 1000});
        a.world.add<PlayerModifiers>(player);
        a.world.get<PlayerModifiers>(player).damageScale = 2.5;
        const Entity mob = a.mob({1040, 1000}, 200.0);
        equipPetal(a, player, f.sting, Rarity::Common, {1025, 1000});

        a.step(0.0, f.registry);
        CHECK_NEAR(a.health(mob), 190.0, 1e-9);      // sting's flat 10, unscaled
    }
    {
        // The talent does reach it, on its own steeper curve -- which is why
        // the two factors are published as two fields rather than collapsed.
        Arena a;
        const Entity player = a.player({1000, 1000});
        a.world.add<PlayerModifiers>(player);
        a.world.get<PlayerModifiers>(player).petalDamageScale = 2.5;
        const Entity mob = a.mob({1040, 1000}, 200.0);
        equipPetal(a, player, f.sting, Rarity::Common, {1025, 1000});

        a.step(0.0, f.registry);
        CHECK_NEAR(a.health(mob), 175.0, 1e-9);
    }
}

TEST(a_petal_lands_the_poison_and_slow_its_config_carries) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity poisoned = a.mob({1040, 1000}, 500.0);
    const Entity chilled = a.mob({1040, 1200}, 500.0);
    equipPetal(a, player, f.venom, Rarity::Common, {1025, 1000});
    equipPetal(a, player, f.frost, Rarity::Common, {1025, 1200});

    a.step(0.0, f.registry);
    const Afflictions& venomed = a.world.get<Afflictions>(poisoned);
    CHECK_NEAR(venomed.poisonPerSecond, 10.0, 1e-9);      // 0.01/ms in the JSON
    CHECK_NEAR(venomed.poisonUntilMillis, 2000.0, 1e-9);
    // Attributed to the flower, so a kill after the petal breaks still pays.
    CHECK_EQ(venomed.poisonSource, player);
    CHECK_NEAR(slowFactorOf(a.world, chilled), 0.5, 1e-9);

    // The direct hit is 1. The next tick costs another 1 -- a petal with no
    // `damageCooldown` in its config bites on every tick it stays in contact,
    // which is what makes a ring held on a mob a damage-per-second weapon --
    // plus one tick of the poison it left behind.
    CHECK_NEAR(a.health(poisoned), 499.0, 1e-9);
    a.step(net::kTickMillis, f.registry);
    CHECK_NEAR(a.health(poisoned), 499.0 - 1.0 - 10.0 * net::kTickSeconds, 1e-6);
}

TEST(a_zero_damage_petal_still_lands_its_riders_and_still_pays_for_them) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // iris, blue_iris, bubble and bomb all ship `"damage": 0` beside a real
    // health pool: the rider IS the petal. applyDamage refuses a swing of
    // nothing, and reading that refusal as "this hit was rejected" left all
    // four landing nothing at all -- no poison, no shove -- and, because a
    // petal pays for its swing in the same block, never wearing out either:
    // a one-hit-point iris sat on a mob for ever.
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1040, 1000}, 500.0);
    a.world.add<ContactDamage>(mob, ContactDamage{4.0, 0.0});
    const Entity petal = equipPetal(a, player, f.spore, Rarity::Common, {1025, 1000});
    a.world.add<Health>(petal, Health{6.0, 6.0, 0.0, 0.0});

    a.step(0.0, f.registry);

    CHECK_NEAR(a.health(mob), 500.0, 1e-9);     // it really does deal no damage
    CHECK_NEAR(a.health(petal), 2.0, 1e-9);     // and still pays the mob's 4
    CHECK_NEAR(a.world.get<Afflictions>(mob).poisonPerSecond, 10.0, 1e-9);
    CHECK(a.world.get<Knockback>(mob).impulse.x > 0.0);

    // Second contact empties it, exactly as a damaging petal's would.
    a.step(net::kTickMillis, f.registry);
    CHECK_NEAR(a.health(petal), 0.0, 1e-9);
    CHECK(a.world.has<Dead>(petal));
}

TEST(a_petal_never_hits_its_own_flower) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    equipPetal(a, player, f.sting, Rarity::Common, {1000, 1000});   // sitting on top of it

    for (int tick = 0; tick < 20; ++tick) a.step(tick * net::kTickMillis, f.registry);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

TEST(a_poison_tick_narrates_itself_as_poison_and_a_direct_hit_as_a_hit) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    a.world.add<NetId>(player, NetId{8});
    // Far from everything else, so the only thing happening to it is poison.
    const Entity poisoned = a.mob({1000, 5000}, 500.0);
    a.world.add<NetId>(poisoned, NetId{7});

    const Entity attacker = a.mob({1010, 1000}, 100.0);
    a.world.add<ContactDamage>(attacker, ContactDamage{5.0, 500.0});
    a.world.add<NetId>(attacker, NetId{9});

    a.combat.applyPoison(a.world, poisoned, player, 10.0, 2000.0, 0.0);
    a.events.clear();
    a.step(0.0);

    CHECK(a.health(poisoned) < 500.0);
    CHECK_NEAR(a.health(player), 95.0, 1e-9);

    std::size_t damageEvents = 0;
    std::size_t poisonEvents = 0;
    std::uint32_t reported = 0;
    double amount = 0;
    for (const WireEvent& event : a.events.events()) {
        if (event.kind != net::EventKind::Damage) continue;
        ++damageEvents;
        if ((event.flag & net::DamagePoison) != 0) {
            ++poisonEvents;
            CHECK_EQ(event.netId, std::uint32_t(7));
            CHECK_NEAR(event.amount, 10.0 * net::kTickSeconds, 1e-9);
            continue;
        }
        reported = event.netId;
        amount = event.amount;
    }
    // Both are narrated. A poison tick reaches the reference's client on the
    // same batched enemiesDamaged channel a petal hit does -- flagged
    // `poisonOnly`, which is what lets the client colour it purple and offset
    // it away from the hit that landed in the same tick.
    CHECK_EQ(damageEvents, std::size_t(2));
    CHECK_EQ(poisonEvents, std::size_t(1));
    CHECK_EQ(reported, std::uint32_t(8));
    CHECK_NEAR(amount, 5.0, 1e-9);
}

TEST(the_hit_cooldown_list_is_pruned_rather_than_growing_without_bound) {
    Arena a;
    const Entity attacker = a.mob({1000, 1000}, 1000.0);
    a.world.add<ContactDamage>(attacker, ContactDamage{1.0, 100.0});
    HitCooldowns cooldowns;
    for (int i = 0; i < 64; ++i) {
        cooldowns.arm(makeEntity(static_cast<std::uint32_t>(1000 + i), 1), 50.0);
    }
    a.world.add<HitCooldowns>(attacker, std::move(cooldowns));

    for (int tick = 0; tick <= kCooldownPruneTicks; ++tick) {
        a.step(tick * net::kTickMillis);
    }
    // Every entry expired long before the sweep; none of them survive it.
    CHECK_EQ(a.world.get<HitCooldowns>(attacker).entries.size(), std::size_t(0));
}

// ---------------------------------------------------------------------------
// Armour, and the bur that strips it
// ---------------------------------------------------------------------------

TEST(armor_is_a_flat_subtraction_from_direct_hits_only) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0, 60.0);
    a.world.add<Armor>(mob, Armor{4.0});

    a.combat.applyDamage(a.world, mob, player, 10.0, 1000.0);
    CHECK_NEAR(a.health(mob), 94.0, 1e-9);
    // A strike is a landed hit, so armour answers it too.
    a.combat.applyDamage(a.world, mob, player, 10.0, 1100.0, DamageKind::Lightning);
    CHECK_NEAR(a.health(mob), 88.0, 1e-9);

    // A drip is not a hit. Armour that taxed each poison tick would be
    // immunity, since a tick is a thirtieth of a second's worth.
    a.combat.applyDamage(a.world, mob, player, 10.0, 1200.0, DamageKind::Poison);
    CHECK_NEAR(a.health(mob), 78.0, 1e-9);
    a.combat.applyDamage(a.world, mob, player, 10.0, 1300.0, DamageKind::Periodic);
    CHECK_NEAR(a.health(mob), 68.0, 1e-9);
}

TEST(armor_heavier_than_the_swing_absorbs_it_without_locking_the_mob) {
    Arena a;
    const Entity one = a.player({1000, 1000});
    const Entity two = a.player({1000, 1040});
    const Entity mob = a.mob({1000, 1000}, 100.0, 60.0);
    a.world.add<Armor>(mob, Armor{50.0});

    // Absorbed whole -- and NOT refused: the swing landed, it simply took
    // nothing off, which is what keeps a bur's strip and a petal's poison
    // working against something they cannot damage.
    const DamageResult soft = a.combat.applyDamage(a.world, mob, one, 20.0, 1000.0);
    CHECK(!soft.refused);
    CHECK_NEAR(soft.applied, 0.0, 1e-12);
    CHECK_NEAR(a.health(mob), 100.0, 1e-9);
    // No post-hit window: a mob's is shared by everyone attacking it, so the
    // weakest petal in a ring must not be able to shield it from the rest.
    CHECK_NEAR(a.world.get<Health>(mob).invulnerableUntilMillis, 0.0, 1e-12);

    const DamageResult hard = a.combat.applyDamage(a.world, mob, two, 80.0, 1000.0);
    CHECK_NEAR(hard.applied, 30.0, 1e-9);
    CHECK_NEAR(a.health(mob), 70.0, 1e-9);
}

TEST(negative_effective_armor_adds_to_every_hit) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0, 60.0);
    a.world.add<Armor>(mob, Armor{-5.0});

    a.combat.applyDamage(a.world, mob, player, 10.0, 1000.0);
    CHECK_NEAR(a.health(mob), 85.0, 1e-9);
}

TEST(an_armor_strip_takes_the_deepest_and_grows_back) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 1000.0, 60.0);
    a.world.add<Armor>(mob, Armor{10.0});

    a.combat.applyArmorShred(a.world, mob, 4.0, 1000.0);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 1000.0), 6.0, 1e-9);
    // Deeper wins.
    a.combat.applyArmorShred(a.world, mob, 25.0, 1100.0);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 1100.0), -15.0, 1e-9);
    // Shallower does not dilute it, and does not shorten it either.
    a.combat.applyArmorShred(a.world, mob, 1.0, 1200.0);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 1200.0), -15.0, 1e-9);

    // The deep strip was refreshed at 1100 and the shallow one at 1200, so the
    // window runs from the later of the two.
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 1200.0 + kArmorShredMillis - 1.0),
               -15.0, 1e-9);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 1200.0 + kArmorShredMillis), 10.0, 1e-9);

    // And the lapsed number is cleared off the component rather than left
    // sitting there reading as a live debuff.
    a.step(1200.0 + kArmorShredMillis);
    CHECK_NEAR(a.world.get<Afflictions>(mob).armorShred, 0.0, 1e-12);
}

TEST(a_flower_has_no_armor_to_strip) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    a.combat.applyArmorShred(a.world, player, 10.0, 1000.0);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, player, 1000.0), 0.0, 1e-12);
}

TEST(a_bur_strips_armor_on_contact_even_when_armor_ate_its_damage) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.burr == kInvalidIndex) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1040, 1000}, 500.0, 60.0);
    // Heavier than the bur's own 5 damage, so the first contact takes nothing
    // off the health bar -- and must still strip.
    a.world.add<Armor>(mob, Armor{9.0});
    equipPetal(a, player, f.burr, Rarity::Common, {1025, 1000});

    a.step(0.0, f.registry);
    CHECK_NEAR(a.health(mob), 500.0, 1e-9);
    CHECK_NEAR(a.world.get<Afflictions>(mob).armorShred, 1.5, 1e-9);
    CHECK_NEAR(CombatSystem::effectiveArmor(a.world, mob, 0.0), 7.5, 1e-9);

    // Once stripped below the swing, the same petal starts landing.
    a.world.get<Armor>(mob).amount = 1.0;
    a.step(net::kTickMillis, f.registry);
    CHECK_NEAR(a.health(mob), 500.0 - (5.0 - (1.0 - 1.5)), 1e-9);
}

TEST(a_burs_strip_rides_the_plain_three_times_ladder) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.burr == kInvalidIndex) return;

    // The figures the design states, tier by tier.
    static const double kExpected[kRarityCount] = {
        1.5, 4.5, 13.5, 40.5, 121.5, 364.5, 1093.5, 3280.5, 9841.5, 29524.5,
    };
    for (int t = 0; t < kRarityCount; ++t) {
        const PetalStats s = f.registry.petalStats(f.burr, clampRarity(t));
        CHECK_NEAR(s.armorReduction, kExpected[t], kExpected[t] * 1e-9);
    }
}

TEST(mob_armor_triples_per_tier_and_flattens_above_ultra) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.grunt == kInvalidIndex) return;

    // `grunt` states no armour, so it wears the default 1 at common.
    static const double kExpected[kRarityCount] = {
        1.0, 3.0, 9.0, 27.0, 81.0, 243.0, 729.0, 729.0, 729.0, 729.0,
    };
    for (int t = 0; t < kRarityCount; ++t) {
        CHECK_NEAR(f.registry.mobStats(f.grunt, clampRarity(t)).armor, kExpected[t], 1e-9);
    }
}

// ---------------------------------------------------------------------------
// Root's stacking armour
// ---------------------------------------------------------------------------

TEST(a_root_stack_blunts_a_direct_hit_and_is_spent_doing_it) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(player, ArmorStackState{2, 12.0, 0.0});

    a.combat.applyDamage(a.world, player, mob, 20.0, 1000.0);
    CHECK_NEAR(a.health(player), 92.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 1);

    // One stack per hit, not one per point of damage: the second blow is
    // blunted by the same twelve and takes the bank to nothing.
    a.combat.applyDamage(a.world, player, mob, 20.0, 1100.0);
    CHECK_NEAR(a.health(player), 84.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 0);

    // Out of stacks, the third lands whole. That is the petal: a bank, not a
    // standing reduction.
    a.combat.applyDamage(a.world, player, mob, 20.0, 1200.0);
    CHECK_NEAR(a.health(player), 64.0, 1e-9);
}

TEST(a_root_stack_is_spent_even_when_it_swallows_the_blow_whole) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(player, ArmorStackState{1, 50.0, 0.0});

    // Absorbed entirely -- and the stack goes with it. A stack that survived
    // the hits it stopped would make ten of them permanent immunity to
    // anything below the per-stack figure.
    a.combat.applyDamage(a.world, player, mob, 30.0, 1000.0);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 0);
    // The flower still gets the post-hit window a shielded blow grants, which
    // is what stops one mob in contact draining the whole bank in a tick.
    CHECK(a.world.get<Health>(player).invulnerableUntilMillis > 1000.0);
}

TEST(a_drip_neither_spends_a_root_stack_nor_is_blunted_by_one) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(player, ArmorStackState{3, 12.0, 0.0});

    // A poison tick is a thirtieth of a second's worth of damage; subtracting
    // twelve from each of them would be immunity, and spending a stack on
    // each would empty a full bank in a third of a second.
    a.combat.applyDamage(a.world, player, mob, 5.0, 1000.0, DamageKind::Poison);
    a.combat.applyDamage(a.world, player, mob, 5.0, 1100.0, DamageKind::Periodic);
    CHECK_NEAR(a.health(player), 90.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 3);

    // A strike is a landed hit in every other respect, so it spends one.
    a.combat.applyDamage(a.world, player, mob, 20.0, 1200.0, DamageKind::Lightning);
    CHECK_NEAR(a.health(player), 82.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 2);
}

TEST(a_mob_never_spends_a_root_stack) {
    // The component is a flower's. A mob carrying one -- which nothing puts
    // there -- must not get a second armour system behind Armor.
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(mob, ArmorStackState{5, 40.0, 0.0});

    a.combat.applyDamage(a.world, mob, player, 20.0, 1000.0);
    CHECK_NEAR(a.health(mob), 80.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(mob).stacks, 5);
}

TEST(root_armour_lands_ahead_of_a_shell_shield_and_a_sponge) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(player, ArmorStackState{1, 12.0, 0.0});
    a.world.add<ShieldState>(player, ShieldState{5.0, 5000.0});
    PlayerModifiers modifiers;
    modifiers.spongeDamageDurationMillis = 1000.0;
    a.world.add<PlayerModifiers>(player, modifiers);

    // 30 - 12 (stack) - 5 (shield) = 13, and what is left is what the sponge
    // takes on to pay back rather than damage landing now.
    a.combat.applyDamage(a.world, player, mob, 30.0, 1000.0);
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
    const SpongeDamageState& stored = a.world.get<SpongeDamageState>(player);
    CHECK_EQ(stored.effects.size(), std::size_t(1));
    if (!stored.effects.empty()) CHECK_NEAR(stored.effects[0].remainingDamage, 13.0, 1e-9);
}

TEST(a_root_stack_stated_as_zero_blunts_nothing) {
    // perStack is republished from the loadout every tick, so a zero here is
    // a flower whose root has just come off with the tick's write still to
    // come. It must not eat a stack for nothing.
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.world.add<ArmorStackState>(player, ArmorStackState{4, 0.0, 0.0});

    a.combat.applyDamage(a.world, player, mob, 20.0, 1000.0);
    CHECK_NEAR(a.health(player), 80.0, 1e-9);
    CHECK_EQ(a.world.get<ArmorStackState>(player).stacks, 4);
}

TEST(a_roots_stack_rides_the_plain_three_times_ladder) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.taproot == kInvalidIndex) return;

    // Matched to mob damage, which is the same 3x ladder all the way up: what
    // a stack absorbs has to keep pace with what a mob of the tier hits for,
    // or root is immunity at one end and dead weight at the other.
    static const double kExpected[kRarityCount] = {
        12.0, 36.0, 108.0, 324.0, 972.0, 2916.0, 8748.0, 26244.0, 78732.0, 236196.0,
    };
    for (int t = 0; t < kRarityCount; ++t) {
        const PetalStats s = f.registry.petalStats(f.taproot, clampRarity(t));
        CHECK_NEAR(s.armorPerStack, kExpected[t], kExpected[t] * 1e-9);
    }
    // And a petal that states none has none, which is what keeps the counter
    // off every other tile on the bar.
    CHECK_NEAR(f.registry.petalStats(f.burr, Rarity::Common).armorPerStack, 0.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Dandelion: the healing lockout
// ---------------------------------------------------------------------------

TEST(a_dandelions_lockout_is_flat_across_the_rarity_ladder) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.dandy == kInvalidIndex) return;

    // gardn's `dandy_ticks` is 10 * SIM_RATE whatever tier the petal is, so an
    // apex dandelion locks healing for exactly as long as a common one. The
    // damage beside it still climbs, which is what keeps this an assertion
    // about the lockout rather than about the loader doing nothing at all.
    for (int t = 0; t < kRarityCount; ++t) {
        const PetalStats s = f.registry.petalStats(f.dandy, clampRarity(t));
        CHECK_NEAR(s.noHealDurationMillis, 10000.0, 1e-9);
    }
    CHECK(f.registry.petalStats(f.dandy, Rarity::Mythic).damage >
          f.registry.petalStats(f.dandy, Rarity::Common).damage);
    // And a petal that states none has none: the rider must not reach every
    // other petal in the game.
    CHECK_NEAR(f.registry.petalStats(f.plain, Rarity::Common).noHealDurationMillis, 0.0, 1e-12);
}

TEST(a_dandelion_hit_locks_healing_on_what_it_touches) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.dandy == kInvalidIndex) return;

    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1030, 1000}, 200.0, 60.0);
    equipPetal(a, player, f.dandy, Rarity::Common, {1015, 1000});

    CHECK(!CombatSystem::healingBlocked(a.world, mob, 1000.0));
    a.step(1000.0, f.registry);
    CHECK(CombatSystem::healingBlocked(a.world, mob, 1000.0));
    // Ten seconds, from the hit.
    CHECK(CombatSystem::healingBlocked(a.world, mob, 10999.0));
    CHECK(!CombatSystem::healingBlocked(a.world, mob, 11001.0));
}

TEST(a_locked_mob_refuses_the_glitch_petals_negative_damage_heal) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    a.combat.applyDamage(a.world, mob, player, 40.0, 1000.0);
    CHECK_NEAR(a.health(mob), 60.0, 1e-9);

    // Negative damage is the one heal that arrives down the damage path.
    a.combat.applyDamage(a.world, mob, player, -10.0, 1100.0);
    CHECK_NEAR(a.health(mob), 70.0, 1e-9);

    // Refused as a HEAL, but not refused as a swing: the petal that delivered
    // it still made contact, and still pays for that contact.
    a.combat.applyNoHeal(a.world, mob, 10000.0, 1200.0);
    const DamageResult locked = a.combat.applyDamage(a.world, mob, player, -10.0, 1300.0);
    CHECK(!locked.refused);
    CHECK_NEAR(locked.applied, 0.0, 1e-12);
    CHECK_NEAR(a.health(mob), 70.0, 1e-9);

    // And it comes back once the lockout lapses.
    a.combat.applyDamage(a.world, mob, player, -10.0, 11300.0);
    CHECK_NEAR(a.health(mob), 80.0, 1e-9);
}

TEST(the_longest_lockout_wins_and_never_comes_closer) {
    Arena a;
    const Entity mob = a.mob({1000, 1000}, 100.0);

    a.combat.applyNoHeal(a.world, mob, 10000.0, 1000.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).noHealUntilMillis, 11000.0, 1e-9);

    // A second, shorter dandelion cannot cut the live one short -- the rule
    // the slow and the armour strip already run on.
    a.combat.applyNoHeal(a.world, mob, 1000.0, 1500.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).noHealUntilMillis, 11000.0, 1e-9);

    // A later hit that WOULD outlast it extends it.
    a.combat.applyNoHeal(a.world, mob, 10000.0, 5000.0);
    CHECK_NEAR(a.world.get<Afflictions>(mob).noHealUntilMillis, 15000.0, 1e-9);

    // Nothing at all for a duration of zero, which is every other petal.
    const Entity other = a.mob({1200, 1000}, 100.0);
    a.combat.applyNoHeal(a.world, other, 0.0, 1000.0);
    CHECK(!CombatSystem::healingBlocked(a.world, other, 1000.0));
}

TEST(a_hit_books_a_seed_against_a_mobs_ammunition_ring) {
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({1000, 1000}, 100.0);
    MobPetalRing ring;
    ring.remaining = 10;
    a.world.add<MobPetalRing>(mob, ring);

    a.combat.applyDamage(a.world, mob, player, 10.0, 1000.0);
    CHECK_EQ(a.world.get<MobPetalRing>(mob).pending, 1);

    // A poison tick is not a blow: a dandelion standing in a cloud would
    // otherwise empty itself thirty times a second.
    a.combat.applyDamage(a.world, mob, player, 5.0, 1100.0, DamageKind::Poison);
    a.combat.applyDamage(a.world, mob, player, 5.0, 1200.0, DamageKind::Periodic);
    CHECK_EQ(a.world.get<MobPetalRing>(mob).pending, 1);

    // The debt never runs past the ring: nine more hits fill it and the tenth
    // adds nothing.
    for (int i = 0; i < 20; ++i) {
        a.combat.applyDamage(a.world, mob, player, 1.0, 1300.0 + i, DamageKind::Lightning);
    }
    CHECK_EQ(a.world.get<MobPetalRing>(mob).pending, 10);

    // And a killing blow books nothing: a corpse sheds no seeds.
    a.world.get<MobPetalRing>(mob).pending = 0;
    CHECK(a.combat.applyDamage(a.world, mob, player, 500.0, 2000.0).killed);
    CHECK_EQ(a.world.get<MobPetalRing>(mob).pending, 0);
}

TEST(a_dandelion_seed_carries_the_lockout_to_what_it_lands_on) {
    const Fixture& f = fixture();
    CHECK(f.ok);
    if (f.dandy == kInvalidIndex) return;

    // What a dandelion MOB throws: an ordinary projectile whose ammunition is
    // the dandelion petal. Nothing about the lockout is stamped on the shot --
    // combat resolves it from the petal index and the tier, which is the whole
    // reason the mob's seeds behave like the petal they are made of.
    Arena a;
    const Entity player = a.player({1000, 1000});
    const Entity mob = a.mob({500, 1000}, 100.0);
    const Entity shot = spawnShot(a, {990, 1000}, {1000, 0}, 5.0, 500.0, mob, mob);
    a.world.get<Projectile>(shot).petalConfigIndex = f.dandy;
    a.world.get<Projectile>(shot).rarity = Rarity::Common;
    a.world.add<Faction>(shot, Faction{Team::Hostiles, false});
    a.world.add<Health>(shot, Health{1.0, 1.0, 0.0, 0.0});
    a.world.add<HitCooldowns>(shot);

    CHECK(!CombatSystem::healingBlocked(a.world, player, 1000.0));
    a.step(1000.0, f.registry);
    CHECK(a.health(player) < 100.0);
    CHECK(CombatSystem::healingBlocked(a.world, player, 1000.0));
    CHECK(!CombatSystem::healingBlocked(a.world, player, 11001.0));
}

// ---------------------------------------------------------------------------
// A mob's own petal ring, as something you can walk into
// ---------------------------------------------------------------------------

namespace {

/// A mob carrying a ring the server owns: `count` seeds on a fixed orbit, which
/// is what lets the test place a flower on one of them by hand.
// The orbit is deliberately well clear of the body: at four radii a flower
// standing on a seed is nowhere near the hull, so a hit here can only have
// come from the ring. (At the dandelion's own 1.65 the two overlap, and every
// assertion below would be measuring body contact instead.)
const char* const kRingMobsJson = R"({
  "seedhead":{"name":"Seedhead","health":100,"damage":12,"size":1,"speed":0,"section":[0],
              "petal_ring":{"petalType":"dandy","count":8,"orbit":4.0,"hitScale":0.5,
                            "spin":false,"shootOnHit":true}},
  "spinner": {"name":"Spinner","health":100,"damage":12,"size":1,"speed":0,"section":[0],
              "petal_ring":{"petalType":"dandy","count":8,"orbit":4.0,"hitScale":0.5,
                            "shootOnHit":true}},
  "tightring":{"name":"Tightring","health":100,"damage":12,"size":1,"speed":0,"section":[0],
              "petal_ring":{"petalType":"dandy","count":8,"orbit":1.65,"hitScale":0.35,
                            "spin":false,"shootOnHit":true}}
})";

struct RingFixture {
    ContentRegistry registry;
    std::string error;
    bool ok = false;
    std::uint16_t seedhead = kInvalidIndex;
    std::uint16_t spinner = kInvalidIndex;
    std::uint16_t tightring = kInvalidIndex;
    std::uint16_t dandy = kInvalidIndex;
};

const RingFixture& ringFixture() {
    static const RingFixture state = [] {
        RingFixture f;
        const std::string mobs = tempDir() + "/ring_mobs.json";
        const std::string petals = tempDir() + "/ring_petals.json";
        const bool wrote =
            writeText(mobs, kRingMobsJson) &&
            writeText(petals,
                      R"({"dandy":{"name":"Dandy","damage":8,"health":8,"size":1,
                                   "noHealDuration":10000}})");
        if (!wrote) {
            f.error = "cannot write the ring fixture content";
            return f;
        }
        f.ok = f.registry.loadFiles(mobs, petals, std::string(), f.error);
        f.seedhead = f.registry.mobIndex("seedhead");
        f.spinner = f.registry.mobIndex("spinner");
        f.tightring = f.registry.mobIndex("tightring");
        f.dandy = f.registry.petalIndex("dandy");
        return f;
    }();
    return state;
}

/// A ring mob with `remaining` seeds still on it, built the way the spawner
/// builds one.
Entity ringMob(Arena& a, std::uint16_t configIndex, Vec2 at, int remaining, double radius = 20.0) {
    const Entity e = a.mob(at, 100.0, 0.0, radius);
    a.world.add<MobType>(e, MobType{configIndex, Rarity::Common, 1.0});
    a.world.add<ContactDamage>(e, ContactDamage{12.0, kMobHitIntervalMillis});
    // Built the way SpawnSystem builds one, gate included: a ring the server
    // cannot place gets no component at all, and the ring's world geometry is
    // resolved against this mob's own body, once.
    const PetalRingSpec& spec = ringFixture().registry.mob(configIndex).petalRing;
    if (!spec.present || !spec.shootOnHit) return e;
    MobPetalRing ring;
    ring.count = spec.count;
    ring.remaining = remaining;
    ring.orbit = radius * spec.orbitScale;
    ring.seedRadius = radius * spec.hitScale;
    ring.outerReach = ring.orbit + ring.seedRadius;
    a.world.add<MobPetalRing>(e, ring);
    return e;
}

/// Where seed `index` of an 8-seed ring on a radius-20 body sits.
Vec2 seat(Vec2 mobAt, int index, int count = 8, double orbit = 80.0) {
    return mobAt + Vec2::fromAngle(index * kTau / count, orbit);
}

/// When this mob's ring may next swing at this flower, or -1 if it never has.
double ringReadyAt(World& world, Entity mob, Entity victim) {
    const RingCooldowns* cooldowns = world.tryGet<RingCooldowns>(mob);
    if (cooldowns == nullptr) return -1.0;
    for (const HitCooldowns::Entry& e : cooldowns->hits.entries) {
        if (e.victim == victim) return e.readyAtMillis;
    }
    return -1.0;
}

} // namespace

TEST(a_flower_standing_on_a_seed_takes_the_mobs_damage) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    ringMob(a, f.seedhead, {1000, 1000}, 8);
    // Right on seed 0, which is out along +x at twice the body radius.
    const Entity player = a.player(seat({1000, 1000}, 0));

    a.step(1000.0, f.registry);
    // The MOB's damage, not the petal's: the ring is how this mob hits.
    CHECK_NEAR(a.health(player), 88.0, 1e-9);
    // And it is a dandelion seed, so it locks healing exactly as the petal does.
    CHECK(CombatSystem::healingBlocked(a.world, player, 1000.0));
}

TEST(the_gaps_in_a_shed_ring_are_gaps_you_can_stand_in) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    // Three seeds left, so seats 0..2 bite and seats 3..7 are empty air --
    // the same 0..remaining-1 the renderer draws and shedRingPetals empties.
    ringMob(a, f.seedhead, {1000, 1000}, 3);
    const Entity onSeed = a.player(seat({1000, 1000}, 1));
    const Entity inGap = a.player(seat({1000, 1000}, 5));

    a.step(1000.0, f.registry);
    CHECK_NEAR(a.health(onSeed), 88.0, 1e-9);
    CHECK_NEAR(a.health(inGap), 100.0, 1e-9);

    // Nor is it a band: the gap between the hull and the ring is open ground.
    // The reference could not say this -- its test was an annulus around the
    // whole orbit, because it could not know where the petals were.
    // 45 out: past the hull's 40 units of reach, short of the 50 at which the
    // flower's own body would start to overlap a seed sitting at 80.
    const Entity inside = a.player({1000 + 45.0, 1000});
    a.step(2000.0, f.registry);
    CHECK_NEAR(a.health(inside), 100.0, 1e-9);
}

TEST(a_ring_hit_is_throttled_on_its_own_clock) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    ringMob(a, f.seedhead, {1000, 1000}, 8);
    const Entity player = a.player(seat({1000, 1000}, 0));

    // Walked back onto the seed after every step: a ring hit shoves the flower
    // 25 units clear, exactly as the hull does, so "standing in it" is a player
    // pushing back in rather than a body that never moves.
    const Vec2 on = seat({1000, 1000}, 0);
    const auto reseat = [&](double at) {
        a.world.get<Transform>(player).position = on;
        a.step(at, f.registry);
    };

    reseat(1000.0);
    CHECK_NEAR(a.health(player), 88.0, 1e-9);

    // Not thirty hits a second: the ring pays kMobPetalRingHitIntervalMillis
    // between swings at the same flower, on a clock of its own.
    for (int i = 1; i < 15; ++i) reseat(1000.0 + i * net::kTickMillis);
    CHECK_NEAR(a.health(player), 88.0, 1e-9);

    reseat(1000.0 + kMobPetalRingHitIntervalMillis + 1.0);
    CHECK_NEAR(a.health(player), 76.0, 1e-9);
}

TEST(a_spinning_ring_is_decoration_and_bites_nobody) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The server cannot say where a spinning ring's petals are -- the phase is
    // the viewer's own clock -- so it does not pretend to. Asked for both at
    // once, the LOADER is what says no, so a spinning ring never reaches the
    // simulation in the first place. This is the glitch flower's ring, and it
    // stays as untouchable as it has always been.
    CHECK(!f.registry.mob(f.spinner).petalRing.shootOnHit);
    Arena a;
    ringMob(a, f.spinner, {1000, 1000}, 8);
    const Entity player = a.player(seat({1000, 1000}, 0));
    const Vec2 on = seat({1000, 1000}, 0);

    for (int i = 0; i < 40; ++i) {
        a.world.get<Transform>(player).position = on;
        a.step(1000.0 + i * net::kTickMillis, f.registry);
    }
    CHECK_NEAR(a.health(player), 100.0, 1e-9);
}

TEST(a_bald_ring_and_a_dead_one_bite_nobody) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    Arena a;
    ringMob(a, f.seedhead, {1000, 1000}, 0);
    const Entity onStripped = a.player(seat({1000, 1000}, 0));
    a.step(1000.0, f.registry);
    CHECK_NEAR(a.health(onStripped), 100.0, 1e-9);

    const Entity corpse = ringMob(a, f.seedhead, {3000, 3000}, 8);
    a.world.add<Dead>(corpse);
    const Entity onCorpse = a.player(seat({3000, 3000}, 0));
    a.step(2000.0, f.registry);
    CHECK_NEAR(a.health(onCorpse), 100.0, 1e-9);
}

TEST(a_ring_inside_its_own_hulls_reach_still_lands_the_first_hit) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The shipped dandelion's shape: seeds at 1.65 radii, which for a body
    // whose hull already reaches a flower's centre at 40 units puts nearly the
    // whole ring INSIDE the hull's own reach. Whichever of the two resolves
    // first opens the 50 ms window that refuses the other, so this is the
    // arrangement that decides whether a seed is ever felt at all.
    Arena a;
    const Entity mob = ringMob(a, f.tightring, {1000, 1000}, 8);
    const Entity player = a.player({1035, 1000});   // touching hull AND seed 0

    a.step(1000.0, f.registry);
    CHECK_NEAR(a.health(player), 88.0, 1e-9);
    // The RING is what landed it -- the hull's hit was the one refused.
    CHECK_NEAR(ringReadyAt(a.world, mob, player), 1000.0 + kMobPetalRingHitIntervalMillis, 1e-9);
}

TEST(a_refused_ring_swing_does_not_cost_the_ring_its_window) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The bug this is here for: charging the throttle for a swing the victim's
    // 50 ms post-hit window refused. Those two clocks are 600 ms and 50 ms, so
    // a ring that paid for refusals was re-armed by the hull roughly twelve
    // times per window and never swung again after the first contact.
    Arena a;
    const Entity mob = ringMob(a, f.tightring, {1000, 1000}, 8);
    const Entity player = a.player({1035, 1000});
    a.world.add<Health>(player, Health{10000.0, 10000.0, 0.0, 0.0});

    const Vec2 on = a.world.get<Transform>(player).position;
    int ringHits = 0;
    double armed = -1.0;
    for (int i = 0; i < 60; ++i) {
        a.world.get<Transform>(player).position = on;   // shoved out every time; walk back in
        a.step(1000.0 + i * net::kTickMillis, f.registry);
        const double now = ringReadyAt(a.world, mob, player);
        if (now != armed) { ++ringHits; armed = now; }
    }
    // Two seconds of contact at a 600 ms throttle: three or four swings, not
    // the single one a burnt window allowed.
    CHECK(ringHits >= 3);
}

TEST(a_players_petals_reach_a_mob_through_its_own_ring) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The complaint this is here for: a ring that bites a flower at 80 units
    // while the flower's own petals, sitting right on the seeds, swing at a
    // hull 50 units away and connect with nothing.
    Arena a;
    const Entity mob = ringMob(a, f.seedhead, {1000, 1000}, 8);
    const Entity owner = a.player({1400, 1000});          // far away; only the petal is close
    // On seed 0 and nowhere near the hull: 80 units out, hull radius 20.
    const Entity petal = equipPetal(a, owner, f.dandy, Rarity::Common, seat({1000, 1000}, 0));
    a.world.add<Health>(petal, Health{8.0, 8.0, 0.0, 0.0});

    a.step(1000.0, f.registry);
    CHECK_NEAR(a.health(mob), 92.0, 1e-9);   // the dandy petal's 8
    // And the exchange is the ordinary one: the petal paid for the swing out
    // of its own health, exactly as it does against a hull.
    CHECK(a.world.get<Health>(petal).current < a.world.get<Health>(petal).max);
}

TEST(a_petal_in_the_gap_between_hull_and_ring_reaches_neither) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // The other half of the claim: the ring is seats, not an annulus, and not
    // a blanket enlargement of the mob. A petal parked between the hull and a
    // seed touches nothing.
    Arena a;
    const Entity mob = ringMob(a, f.seedhead, {1000, 1000}, 8);
    const Entity owner = a.player({1400, 1000});
    equipPetal(a, owner, f.dandy, Rarity::Common, {1000 + 45.0, 1000});

    a.step(1000.0, f.registry);
    CHECK_NEAR(a.health(mob), 100.0, 1e-9);

    // Nor does a shed seat: seats 0..2 only, so the one at index 4 is gone.
    Arena b;
    const Entity stripped = ringMob(b, f.seedhead, {1000, 1000}, 3);
    const Entity owner2 = b.player({1400, 1000});
    equipPetal(b, owner2, f.dandy, Rarity::Common, seat({1000, 1000}, 4));
    b.step(1000.0, f.registry);
    CHECK_NEAR(b.health(stripped), 100.0, 1e-9);
}

TEST(a_ring_never_shoves_a_flower_it_cannot_hit) {
    const RingFixture& f = ringFixture();
    CHECK(f.ok);
    if (!f.ok) return;

    // "The knockback is weird": a bump applied above the hit gate fires on
    // every tick of contact rather than on the ring's own 600 ms clock, which
    // is 25 units of displacement thirty times a second.
    Arena a;
    ringMob(a, f.seedhead, {1000, 1000}, 8);
    const Entity player = a.player(seat({1000, 1000}, 0));
    a.world.add<Health>(player, Health{10000.0, 10000.0, 0.0, 0.0});

    const Vec2 start = a.world.get<Transform>(player).position;
    a.step(1000.0, f.registry);
    const double first = distance(a.world.get<Transform>(player).position, start);
    CHECK_NEAR(first, kMobContactKnockback, 1e-9);

    // Walked back on and held there for half the throttle: not one more shove.
    for (int i = 1; i < 9; ++i) {
        a.world.get<Transform>(player).position = start;
        a.step(1000.0 + i * net::kTickMillis, f.registry);
        CHECK_NEAR(distance(a.world.get<Transform>(player).position, start), 0.0, 1e-9);
    }
}
