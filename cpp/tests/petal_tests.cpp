#include "test.h"

#include "server/replication.h"
#include "server/systems/movement.h"
#include "server/systems/petals.h"

#include <sys/stat.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>
#include "fixture_content.h"

using namespace flix;

namespace {

// The ring is driven entirely by content, so these tests run on content of
// their own: a handful of petals chosen to isolate one rule each. Using the
// shipped data instead would tie every assertion to a balance number that is
// allowed to change.

const char* const kPetalsJson = R"JSON({
  "basic":    {"name":"Basic","damage":10,"health":10,"size":2,"cooldown":1200,"count":1,"color":"#90EE90"},
  "sandy":    {"name":"Sandy","damage":4,"health":12,"size":1,"cooldown":800,"count":4,"clumped":true,"color":"#8B0000"},
  "spready":  {"name":"Spready","damage":4,"health":12,"size":1,"cooldown":800,"count":3,"clumped":true,"clumpSpacing":2.5,"color":"#F0BD48"},
  "hanging":  {"name":"Hanging","damage":4,"health":12,"size":1,"cooldown":800,"count":3,"clumped":true,"clumpSpacing":2.5,"clumpOutsideRing":true,"color":"#F0BD48"},
  "shards":   {"name":"Shards","damage":3,"health":6,"size":1,"cooldown":500,"count":3,"independentHealth":true,"color":"#CCCCCC"},
  "rock":     {"name":"Rock","damage":1,"size":2,"cooldown":1000,"count":1,"color":"#777777"},
  "healer":   {"name":"Healer","damage":1,"health":5,"size":1,"cooldown":3500,"count":1,"burstHeal":10,"burstHealChargeMs":1000,"defendOnly":true,"color":"#FF69B4"},
  "shell":    {"name":"Shell","damage":1,"health":5,"size":1,"cooldown":3500,"count":1,"burstShield":22,"burstHealChargeMs":1000,"defendOnly":true,"color":"#FCDD86"},
  "bubble":   {"name":"Bubble","damage":0,"health":1,"size":1,"cooldown":1000,"count":1,"color":"#FFFFFF"},
  "web":      {"name":"Web","damage":5,"health":10,"size":1.2,"cooldown":3000,"count":1,"defendOnly":true,"webRadius":90,"color":"#FFFFFF"},
  "pollen":   {"name":"Pollen","damage":10,"health":10,"size":1,"cooldown":1000,"count":1,"color":"#FFE763"},
  "sponge":   {"name":"Sponge","damage":10,"health":10,"size":1,"cooldown":2000,"count":1,"spongeDamageDuration":1000,"color":"#FF96E0"},
  "root":     {"name":"Root","damage":10,"health":10,"size":1,"cooldown":1000,"count":1,"armorPerStack":12,"defendOnly":true,"color":"#B86C32"},
  "peas":     {"name":"Peas","damage":6,"health":5,"size":1,"cooldown":1000,"count":1,"projectile":{"count":3,"spreadAngle":0.5,"speed":800,"distance":1000},"color":"#00FF00"},
  "peaclump": {"name":"Peaclump","damage":6,"health":5,"size":1,"cooldown":1000,"count":4,"clumped":true,"projectile":{"count":1,"spreadAngle":0,"speed":800,"distance":1000},"color":"#00FF00"},
  "emitter":  {"name":"Emitter","damage":2,"health":null,"size":1,"cooldown":1000,"count":1,"projectile":{"count":2,"spreadAngle":0.3,"speed":400,"distance":400},"color":"#00FF00"},
  "lucky":    {"name":"Lucky","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"luck":2,"speed":1.5,"magnetism":50},"color":"#FFD700"},
  "reacher":  {"name":"Reacher","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"range":1.5},"color":"#00FFFF"},
  "anchor":   {"name":"Anchor","damage":1,"health":5,"size":1,"cooldown":1000,"count":1,"playerModifiers":{"rotationSpeed":0},"color":"#888888"},
  "inflator": {"name":"Inflator","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"playerRadius":1.5},"color":"#FF00FF"},
  "stinky":   {"name":"Stinky","damage":0,"health":1,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"aggroRange":0.75},"color":"#8B4513"},
  "glowy":    {"name":"Glowy","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"aggroRadius":150},"color":"#FFFF00"},
  "charm":    {"name":"Charm","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"evasion":0.1},"color":"#FFF824"},
  "summoner": {"name":"Summoner","damage":1,"health":4,"size":1,"cooldown":1000,"count":1,"petMobType":"critter","petMobRarity":"common","petCount":2,"color":"#AA00AA"},
  "toxic":    {"name":"Toxic","damage":2,"health":5,"size":1,"cooldown":1000,"count":1,"poison":0.05,"poisonDuration":3000,"color":"#00AA00"},
  "blade":    {"name":"Blade","damage":0,"health":null,"size":4,"cooldown":1,"count":0,"range":0,"bodyDamage":10,"equipFlags":"Cutter","noPhysics":true,"color":"#111111"},
  "sparkblade":{"name":"Spark Blade","damage":1,"health":null,"size":4,"cooldown":1,"count":0,"range":0,"bodyDamage":10,"equipFlags":"Cutter","noPhysics":true,"color":"#00FFFF"},
  "lightning":{"name":"Lightning","damage":25,"health":10,"size":1,"cooldown":2500,"count":1,"color":"#FFFFFF"},
  "battery":  {"name":"Battery","damage":0,"health":null,"size":1,"cooldown":2500,"count":1,"color":"#FCDD86"},
  "capacitor":{"name":"Capacitor","damage":0,"health":null,"size":1.25,"cooldown":2500,"count":1,"color":"#000000"},
  "wing":     {"name":"Wing","damage":15,"health":10,"size":1,"cooldown":2500,"count":1,"color":"#FFFFFF"},
  "pearl":    {"name":"Pearl","damage":20,"health":50,"size":1.25,"cooldown":4000,"count":1,"color":"#FFFFFF"},
  "cotton":   {"name":"Cotton","damage":0,"health":2,"size":1,"cooldown":1500,"count":1,"defendOnly":true,"color":"#FFFFFF"},
  "bone":     {"name":"Bone","damage":14,"health":10,"size":1,"cooldown":1500,"count":1,"petalArmor":10,"color":"#FFFFFF"},
  "vessel":   {"name":"Vessel","damage":1,"health":5,"size":1,"cooldown":1000,"count":1,"baseMaxMana":100,"color":"#42E3F5"},
  "orb":      {"name":"Orb","damage":1,"health":5,"size":1,"cooldown":3500,"count":1,"burstMana":10,"burstManaChargeMs":1000,"color":"#42E3F5"},
  "magicleaf":{"name":"Magic Leaf","damage":1,"health":5,"size":1,"cooldown":1000,"count":1,"passiveMana":5,"color":"#42E3F5"},
  "leafy":    {"name":"Leafy","damage":1,"health":5,"size":1,"cooldown":1000,"count":1,"passiveHeal":1,"color":"#39B54A"},
  "yuccaish": {"name":"Yuccaish","damage":1,"health":5,"size":1,"cooldown":1000,"count":1,"passiveHeal":1,"passiveHealDefendOnly":true,"color":"#74B53F"},
  "magicmissile":{"name":"Magic Missile","damage":6,"health":5,"size":1,"cooldown":1000,"count":1,"requiredMana":30,"projectile":{"count":1,"spreadAngle":0,"speed":800,"distance":1000},"color":"#42E3F5"},
  "magic_bubble":{"name":"Magic Bubble","damage":0,"health":1,"size":1,"cooldown":1000,"count":1,"requiredMana":40,"color":"#42E3F5"}
})JSON";

const char* const kMobsJson = R"JSON({
  "critter": {"name":"Critter","health":10,"damage":1,"size":1,"speed":0.2,"range":300,"cooldown":500,"color":"#FF0000","section":[0],"ai_type":"hostile"},
  "brute":   {"name":"Brute","health":500,"damage":5,"size":6,"speed":0.2,"range":300,"cooldown":500,"color":"#AA3300","section":[0],"ai_type":"hostile"}
})JSON";

std::string tempDir() {
    const char* env = std::getenv("TMPDIR");
    std::string base = (env != nullptr && *env != '\0') ? env : "/tmp";
    if (base.back() != '/') base.push_back('/');
    base += "flix_petal_tests";
    mkdir(base.c_str(), 0755);   // already there is fine
    return base;
}

bool writeText(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return out.good();
}

struct Fixture {
    ContentRegistry registry;
    bool ok = false;
    std::string error;
};

const Fixture& fixture() {
    static const Fixture state = [] {
        Fixture f;
        const std::string dir = tempDir();
        const std::string mobs = dir + "/mobs.json";
        const std::string petals = dir + "/petals.json";
        if (!writeText(mobs, test::fixtureMobs(kMobsJson)) ||
            !writeText(petals, test::fixturePetals(kPetalsJson))) {
            f.error = "could not write the fixture content into " + dir;
            return f;
        }
        f.ok = f.registry.loadFiles(mobs, petals, f.error);
        return f;
    }();
    return state;
}

bool contentLoaded() {
    if (!fixture().ok) {
        ::testing::reportFailure(__FILE__, __LINE__,
                                 "fixture content failed to load: " + fixture().error);
    }
    return fixture().ok;
}

std::uint16_t petalId(const char* id) { return fixture().registry.petalIndex(id); }

/// A world with one player, and the system driven at the real tick rate.
struct Rig {
    World world;
    CommandBuffer commands{world};
    PetalSystem system;
    /// Where the tick's one-shot visuals land. Only the lightning strike
    /// reports one, and it is the only way to see a strike at all: its damage
    /// is a field combat resolves later, and leaves nothing on this system.
    EventQueue events;
    Entity player = NULL_ENTITY;
    // Deliberately not zero: a timer that was never set reads as 0, and a
    // clock starting there would make that bug look like a working one.
    double now = 1000.0;

    /// Optional, and empty: a map with no walls, so a flower under movement
    /// travels exactly as far as its velocity says.
    Terrain terrain;
    MovementSystem movement;
    bool stepMovement = false;

    Rig() {
        player = world.create();
        world.add<PlayerTag>(player);
        world.add<Transform>(player, Transform{{1000.0, 1000.0}, 0.0});
        world.add<Motion>(player);
        world.add<Knockback>(player);
        world.add<Body>(player, Body{kPlayerBaseRadius, 1.0});
        world.add<Health>(player, Health{maxHealthForLevel(1), maxHealthForLevel(1), 0.0, 0.0});
        world.add<Faction>(player, Faction{Team::Players, false});
        world.add<PlayerProgress>(player, PlayerProgress{});
        world.add<PlayerInput>(player);
        world.add<PlayerModifiers>(player);
        world.add<PlayerLocation>(player);
        world.add<Loadout>(player);
        world.add<PetalRing>(player);
        world.add<Afflictions>(player);
        world.add<HitCooldowns>(player);
    }

    void equip(int slot, const char* id, Rarity rarity = Rarity::Common) {
        LoadoutSlot& s = world.get<Loadout>(player).slots[static_cast<std::size_t>(slot)];
        s.configIndex = petalId(id);
        s.rarity = rarity;
    }

    void unequip(int slot) {
        LoadoutSlot& s = world.get<Loadout>(player).slots[static_cast<std::size_t>(slot)];
        s.configIndex = kNoPetal;
    }

    void setFlags(std::uint8_t flags) { world.get<PlayerInput>(player).current.flags = flags; }

    /// The direction the player is asking to travel in, as an input frame
    /// carries it. Strength 0 is a player asking for nothing.
    void setMove(double angle, double strength = 1.0) {
        net::InputFrame& frame = world.get<PlayerInput>(player).current;
        frame.moveAngle = angle;
        frame.moveStrength = strength;
    }

    /// Stops the ring turning, by equipping a petal whose rotationSpeed
    /// modifier is zero -- the reference sums those as `+= modifier - 1`, so
    /// one of them cancels the base rate exactly.
    ///
    /// A petal is not welded to its place on the ring: it is SPRUNG toward it
    /// (PETAL_SPRING_FORCE), so on a turning ring it settles into a small fixed
    /// lead and a slightly wider orbit and never sits on its target point. A
    /// test about WHERE the ring puts a petal freezes the ring first and then
    /// lets the spring arrive; a test about the turning itself does not, and
    /// asserts against the steady state instead.
    ///
    /// It costs the LAST active slot, and one place on the ring with it.
    static constexpr int kAnchorSlot = kLoadoutActiveSlots - 1;
    void freezeRing() { equip(kAnchorSlot, "anchor"); }

    /// Steps until the spring has carried every petal onto its target. With a
    /// frozen ring the target does not move, so this converges to the point
    /// itself rather than to an orbit around it.
    void settleRing(int ticks = 120) { tick(ticks); }

    void tick(int count = 1) {
        for (int i = 0; i < count; ++i) {
            now += net::kTickMillis;
            // The server's order, for the tests that ask for it: the flower is
            // moved, then its ring is stepped. A petal that hands the flower
            // momentum -- the bubble -- is only observable through the
            // movement that spends it.
            if (stepMovement) movement.runPlayerPhase(world, terrain, now, net::kTickSeconds);
            system.run(world, fixture().registry, now, net::kTickSeconds, commands, nullptr,
                       &events);
            commands.flush();
        }
    }

    /// Runs player movement alongside the ring. Off by default: a test about
    /// where the ring puts a petal wants a flower that holds still.
    void withMovement() { stepMovement = true; }

    /// The server's end-of-tick reaper: everything marked Dead is destroyed
    /// before the next tick's ring pass runs. tick() leaves it out, so a
    /// petal killed there is still around to be seen next tick -- which is
    /// never true in production, where combat marks the kill and the reaper
    /// takes it the same tick.
    void reap() {
        Query<Dead> dead{world};
        std::vector<Entity> doomed;
        dead.collect(doomed);
        for (const Entity e : doomed) world.destroy(e);
    }

    /// Steps until `done` holds, so a test can wait on a reload without
    /// hard-coding how many ticks that is.
    template <class F>
    bool tickUntil(F done, int maxTicks = 2000) {
        for (int i = 0; i < maxTicks; ++i) {
            tick();
            if (done()) return true;
        }
        return false;
    }

    /// Equipping a petal puts its slot on a full reload before the petal ever
    /// appears -- the reference's `updateLoadout` stamps `onCooldown` and a
    /// `cooldownEndTime` on every newly equipped slot, and the spawn loadout is
    /// built the same way. A test whose subject is something else waits that
    /// out here instead of restating each petal's cooldown in ticks.
    void settleEquips(int maxTicks = 400) {
        // One tick first: `broken` reads false until the system has actually
        // seen the edit and stamped the slot's reload, so testing it before
        // that would call an unserved cooldown "ready".
        tick();
        const auto ready = [&] {
            for (int i = 0; i < kLoadoutActiveSlots; ++i) {
                if (slot(i).empty()) continue;
                if (slot(i).broken) return false;
            }
            return true;
        };
        if (ready()) return;
        if (!tickUntil(ready, maxTicks)) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "the equip reload never finished");
        }
    }

    const LoadoutSlot& slot(int index) const {
        return const_cast<World&>(world).get<Loadout>(player).slots[static_cast<std::size_t>(index)];
    }

    /// What the loadout bar drains its tile by: how much of the slot is still
    /// standing, whichever of the two health models it runs on.
    double slotHealth(int index) const {
        return const_cast<World&>(world)
            .get<PetalSlotState>(player)
            .slots[static_cast<std::size_t>(index)]
            .healthFraction;
    }

    /// The number the loadout bar prints inside the slot's top border, and -1
    /// for a petal that has none.
    double slotCounter(int index) const {
        return const_cast<World&>(world)
            .get<PetalSlotState>(player)
            .slots[static_cast<std::size_t>(index)]
            .counter;
    }

    const PetalRing& ring() const { return const_cast<World&>(world).get<PetalRing>(player); }
    const PlayerModifiers& modifiers() const {
        return const_cast<World&>(world).get<PlayerModifiers>(player);
    }

    std::vector<Entity> petals(int slotIndex = -1) {
        std::vector<Entity> out;
        Query<PetalTag, PetalInstance> query{world};
        query.each([&](Entity e, PetalTag&, PetalInstance& instance) {
            if (instance.owner != player) return;
            if (slotIndex >= 0 && instance.slot != slotIndex) return;
            out.push_back(e);
        });
        std::sort(out.begin(), out.end(), [&](Entity a, Entity b) {
            return world.get<PetalInstance>(a).subIndex < world.get<PetalInstance>(b).subIndex;
        });
        return out;
    }

    Entity petalWithSub(int slotIndex, int subIndex) {
        for (const Entity e : petals(slotIndex)) {
            if (world.get<PetalInstance>(e).subIndex == subIndex) return e;
        }
        return NULL_ENTITY;
    }

    std::size_t countOf(net::EntityKind kind) {
        std::size_t n = 0;
        Query<Replicated> query{world};
        query.each([&](Entity, Replicated& replicated) {
            if (replicated.kind == kind) ++n;
        });
        return n;
    }

    std::size_t petCount() {
        Query<Pet> query{world};
        return query.count();
    }

    Vec2 position(Entity e) { return world.get<Transform>(e).position; }
    Vec2 velocity(Entity e) { return world.get<Motion>(e).velocity; }
    double radiusOf(Entity petal) { return (position(petal) - position(player)).length(); }
    double angleOf(Entity petal) { return (position(petal) - position(player)).angle(); }
    double healthOf(Entity e) { return world.get<Health>(e).current; }
    void damage(Entity e, double amount) { world.get<Health>(e).current -= amount; }
};

/// Angular distance, so a comparison across the -pi/+pi seam is not a failure.
double angularGap(double a, double b) { return std::fabs(wrapAngle(a - b)); }

} // namespace

// ---------------------------------------------------------------------------
// Ring placement
// ---------------------------------------------------------------------------

TEST(petal_ring_places_one_petal_per_slot_evenly) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.equip(3, "basic");
    rig.equip(7, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    const std::vector<Entity> petals = rig.petals();
    CHECK_EQ(petals.size(), std::size_t(4));   // three basics and the anchor

    // Slots 0, 3, 7 and 9 are the first, second, third and fourth occupied
    // slots, so they take quarters of the ring regardless of the empty slots
    // between them.
    const double wedge = kTau / 4.0;
    const double spin = rig.ring().spin;
    for (const Entity petal : petals) {
        const int slot = rig.world.get<PetalInstance>(petal).slot;
        const int ordinal = slot == 0 ? 0 : (slot == 3 ? 1 : (slot == 7 ? 2 : 3));
        CHECK_NEAR(angularGap(rig.angleOf(petal), spin + wedge * ordinal), 0.0, 1e-6);
        CHECK_NEAR(rig.radiusOf(petal), rig.ring().radius, 1e-6);
    }
}

TEST(petal_ring_rotates_at_the_spin_rate) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.equip(1, "basic");
    rig.settleEquips();
    // No freeze here -- the turning IS the subject. The spring settles into a
    // steady state on the moving ring: a fixed lead angle and a fixed slightly
    // wider orbit, both constant from then on. What must hold in that state is
    // that the petal keeps station with the ring rather than drifting round it.
    rig.settleRing();

    const Entity first = rig.petals(0).front();
    const double before = rig.angleOf(first);
    const double radiusBefore = rig.radiusOf(first);
    const double spinBefore = rig.ring().spin;

    rig.tick(5);
    const double expected = kPetalSpinRate * net::kTickSeconds * 5.0;
    CHECK_NEAR(angularGap(rig.ring().spin, spinBefore + expected), 0.0, 1e-9);
    CHECK_NEAR(angularGap(rig.angleOf(rig.petals(0).front()), before + expected), 0.0, 1e-9);
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), radiusBefore, 1e-6);

    // The gap between the two petals is fixed by the layout: rotation must
    // carry the whole ring, not slide one petal along it.
    CHECK_NEAR(angularGap(rig.angleOf(rig.petals(0).front()), rig.angleOf(rig.petals(1).front())),
               kPi, 1e-9);
}

TEST(attacking_and_defending_move_the_ring_smoothly) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();

    const double rest = kPetalOrbitRestRadius;
    CHECK_NEAR(rest, 60.0, 1e-9);
    CHECK_NEAR(rig.ring().radius, rest, 1e-9);

    rig.settleRing();
    const double restOrbitRatio = rig.radiusOf(rig.petals(0).front()) / rig.ring().radius;
    CHECK_NEAR(restOrbitRatio, 1.0, 0.01);

    rig.setFlags(net::InputAttack);
    rig.tick();
    const double attackTarget = kPetalOrbitRestRadius * kPetalOrbitAttackExtension;
    CHECK_NEAR(attackTarget, 120.0, 1e-9);
    CHECK_NEAR(rig.ring().targetRadius, attackTarget, 1e-9);
    // Eased: one tick moves toward the target without arriving at it.
    CHECK(rig.ring().radius > rest);
    CHECK(rig.ring().radius < attackTarget);
    const double afterOne = rig.ring().radius;
    rig.tick();
    CHECK(rig.ring().radius > afterOne);

    rig.tick(200);
    CHECK_NEAR(rig.ring().radius, attackTarget, 1e-6);
    // The petal is sprung toward the ring, not welded to it, so on a turning
    // ring it holds station a fixed fraction outside its target point. What
    // matters is that it followed the ring out: it orbits at the same
    // proportion of the extended radius that it did of the resting one.
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()) / rig.ring().radius, restOrbitRatio, 1e-6);

    rig.setFlags(net::InputDefend);
    rig.tick();
    const double defendTarget = kPetalOrbitRestRadius * kPetalOrbitDefendExtension;
    CHECK_NEAR(defendTarget, 42.0, 1e-9);
    CHECK_NEAR(rig.ring().targetRadius, defendTarget, 1e-9);
    CHECK(rig.ring().radius < attackTarget);
    CHECK(rig.ring().radius > defendTarget);
    rig.tick(200);
    CHECK_NEAR(rig.ring().radius, defendTarget, 1e-6);

    // Both buttons at once is a lunge, not a block. The reference tests the
    // extend button FIRST -- `if (extendPressed) ... else if (retractPressed)`
    // -- and only reaches the retract branch when extend is up, so a player
    // holding both throws the ring out rather than pulling it in.
    rig.setFlags(net::InputAttack | net::InputDefend);
    rig.tick();
    CHECK_NEAR(rig.ring().targetRadius, attackTarget, 1e-9);
}

TEST(a_range_modifier_widens_the_ring) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "reacher");
    rig.tick();
    CHECK_NEAR(rig.ring().targetRadius, kPetalOrbitRestRadius * 1.5, 1e-9);
    rig.tick(200);
    CHECK_NEAR(rig.ring().radius, kPetalOrbitRestRadius * 1.5, 1e-6);
}

TEST(a_player_radius_modifier_scales_the_body_and_preserves_petal_clearance) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "inflator");
    rig.tick();

    const double playerRadius = rig.world.get<Body>(rig.player).radius;
    CHECK_NEAR(playerRadius, kPlayerBaseRadius * 1.5, 1e-9);
    // TypeScript grows the neutral ring from 60 to 70, not to 90: the extra
    // body radius is added once, preserving the gap from the flower's edge.
    CHECK_NEAR(rig.ring().targetRadius,
               kPetalOrbitRestRadius + playerRadius - kPlayerBaseRadius, 1e-9);
}

TEST(a_clumped_slot_spawns_a_cluster_around_one_ring_position) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sandy");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    const std::vector<Entity> grains = rig.petals(0);
    CHECK_EQ(grains.size(), std::size_t(4));

    // All four hang off the SAME ring position -- that is what clumped means.
    const double reach = rig.ring().radius;
    const Vec2 slotPoint = rig.position(rig.player) + Vec2::fromAngle(rig.ring().spin, reach);
    // `effectiveSize * 40 * 0.5` in the reference, which is exactly the
    // petal's own hit radius -- the grains sit one radius out from the shared
    // centre, not one diameter.
    const double spacing = fixture().registry.petalStats(petalId("sandy"), Rarity::Common).radius;

    std::vector<double> subAngles;
    for (const Entity grain : grains) {
        CHECK_NEAR((rig.position(grain) - slotPoint).length(), spacing, 1e-6);
        CHECK_EQ(int(rig.world.get<PetalInstance>(grain).subCount), 4);
        subAngles.push_back((rig.position(grain) - slotPoint).angle());
    }
    // Four distinct directions out of the cluster centre, not four petals piled
    // on the same point.
    std::sort(subAngles.begin(), subAngles.end());
    for (std::size_t i = 1; i < subAngles.size(); ++i) {
        CHECK_NEAR(subAngles[i] - subAngles[i - 1], kTau / 4.0, 1e-6);
    }
}

TEST(a_clump_spacing_moves_the_grains_that_many_radii_out) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "spready");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    const std::vector<Entity> grains = rig.petals(0);
    CHECK_EQ(grains.size(), std::size_t(3));

    const Vec2 slotPoint =
        rig.position(rig.player) + Vec2::fromAngle(rig.ring().spin, rig.ring().radius);
    const double radius = fixture().registry.petalStats(petalId("spready"), Rarity::Common).radius;
    for (const Entity grain : grains) {
        CHECK_NEAR((rig.position(grain) - slotPoint).length(), radius * 2.5, 1e-6);
    }
}

TEST(a_clump_outside_the_ring_puts_one_grain_on_the_orbit_and_the_rest_beyond) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "hanging");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    const std::vector<Entity> grains = rig.petals(0);
    CHECK_EQ(grains.size(), std::size_t(3));

    const Vec2 flower = rig.position(rig.player);
    const double orbit = rig.ring().radius;
    const double spacing =
        fixture().registry.petalStats(petalId("hanging"), Rarity::Common).radius * 2.5;
    // The clump's centre is one spacing outside the orbit, on the slot's bearing.
    const Vec2 hub = flower + Vec2::fromAngle(rig.ring().spin, orbit + spacing);

    int onOrbit = 0;
    for (const Entity grain : grains) {
        CHECK_NEAR((rig.position(grain) - hub).length(), spacing, 1e-6);
        const double out = (rig.position(grain) - flower).length();
        if (std::fabs(out - orbit) < 1e-6) {
            ++onOrbit;
        } else {
            CHECK(out > orbit + spacing);
        }
    }
    CHECK_EQ(onOrbit, 1);
}

TEST(an_empty_loadout_places_nothing_and_leaves_modifiers_neutral) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.tick(5);
    CHECK_EQ(rig.petals().size(), std::size_t(0));
    CHECK_NEAR(rig.modifiers().speedScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().luck, 1.0, 1e-12);
    CHECK_NEAR(rig.ring().radius, kPetalOrbitRestRadius, 1e-9);
}

TEST(a_worn_cutter_adds_body_damage_and_takes_no_ring_place) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.world.add<ContactDamage>(rig.player, ContactDamage{0.0, 0.0});
    rig.equip(0, "blade", Rarity::Epic);
    rig.equip(1, "basic");
    rig.settleEquips();

    const int level = rig.world.get<PlayerProgress>(rig.player).level;
    const auto granted = [&](Rarity rarity) {
        return fixture().registry.petalStats(petalId("blade"), rarity).bodyDamage;
    };

    // A cutter is carried, not swung: it spawns nothing, so the basic petal is
    // the ring's only occupant and gets the whole circle to itself.
    CHECK_EQ(rig.petals().size(), std::size_t(1));
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    // The petal damage ladder: 3x a tier from the authored 10, so an epic
    // blade grants 270. gardn's flat +20 does not survive a ten-tier game.
    CHECK_NEAR(granted(Rarity::Epic), 270.0, 1e-9);
    CHECK_NEAR(rig.modifiers().bodyDamageBonus, granted(Rarity::Epic), 1e-12);
    CHECK_NEAR(rig.world.get<ContactDamage>(rig.player).amount,
               bodyDamageForLevel(level) + granted(Rarity::Epic), 1e-9);

    // Rarity moves it, on the same 3x ladder a petal's damage climbs.
    CHECK(granted(Rarity::Common) < granted(Rarity::Epic));
    CHECK(granted(Rarity::Epic) < granted(Rarity::Unique));
    CHECK_NEAR(granted(Rarity::Epic), 27.0 * granted(Rarity::Common), 1e-9);
    CHECK_NEAR(granted(Rarity::Unique), 6561.0 * granted(Rarity::Common), 1e-9);
    // Exactly a basic petal's hit at the same tier: the anchor the authored
    // value is chosen for.
    CHECK_NEAR(granted(Rarity::Epic),
               fixture().registry.petalStats(petalId("basic"), Rarity::Epic).damage, 1e-9);

    // Maximised, never summed: a second blade cannot double the bonus, and the
    // better of the two is the one that counts.
    rig.equip(2, "sparkblade", Rarity::Common);
    rig.tick(5);
    CHECK_NEAR(rig.modifiers().bodyDamageBonus, granted(Rarity::Epic), 1e-12);
    rig.equip(2, "sparkblade", Rarity::Unique);
    rig.tick(5);
    CHECK_NEAR(rig.modifiers().bodyDamageBonus, granted(Rarity::Unique), 1e-12);

    rig.unequip(0);
    rig.unequip(2);
    rig.tick(5);
    CHECK_NEAR(rig.modifiers().bodyDamageBonus, 0.0, 1e-12);
    CHECK_NEAR(rig.world.get<ContactDamage>(rig.player).amount, bodyDamageForLevel(level), 1e-9);
}

// ---------------------------------------------------------------------------
// Attraction
// ---------------------------------------------------------------------------

TEST(an_attracted_petal_is_projected_inside_the_body_the_hit_test_uses) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.freezeRing();
    rig.settleRing();

    const Entity petal = rig.petals(0).front();
    const double petalRadius = rig.world.get<Body>(petal).radius;

    // A mob that rolled SMALL. Its body is a little over half the tier radius
    // the stat table quotes, and that gap is the whole bug: projecting onto the
    // TIER radius parks the petal outside the circle the melee pass tests, so
    // the ring whips around a mob it can never touch -- no damage out, and no
    // health off the petal either, because a petal pays for its swing only when
    // the swing lands. Nothing else about the capture looks wrong, which is why
    // it read as "petal health sometimes does not go down".
    const std::uint16_t brute = fixture().registry.mobIndex("brute");
    const double statRadius = fixture().registry.mobStats(brute, Rarity::Common).radius;
    const double jitter = 0.55;
    const double bodyRadius = statRadius * jitter;
    // The trap only exists for a roll this small; assert the fixture is in it.
    CHECK(statRadius * kMobOrbitRadiusScale > bodyRadius + petalRadius);

    const Vec2 orbit = rig.world.get<Transform>(petal).position;
    const Entity mob = rig.world.create();
    rig.world.add<MobTag>(mob);
    rig.world.add<MobType>(mob, MobType{brute, Rarity::Common, jitter});
    rig.world.add<Transform>(mob, Transform{orbit + Vec2{20.0, 0.0}, 0.0});
    rig.world.add<Body>(mob, Body{bodyRadius, 1.0});
    rig.world.add<Health>(mob, Health{500.0, 500.0, 0.0, 0.0});
    rig.world.add<Faction>(mob, Faction{Team::Hostiles, false});

    rig.tick(60);

    CHECK(rig.world.get<PetalInstance>(petal).attractedTo == mob);
    const double gap = (rig.world.get<Transform>(petal).position -
                        rig.world.get<Transform>(mob).position).length();
    CHECK(gap < bodyRadius + petalRadius);
    // And on the edge of the body it actually has, not buried in its middle.
    CHECK(gap > bodyRadius * 0.5);
}

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

/// PetalSystem's own kLightningRadius, which is private to it. Spelling the
/// number out here is deliberate: a test that hard-codes it is what notices the
/// reach changing under a strike that is supposed to cover a screen.
constexpr double kStrikeRadius = 1000.0;

/// Puts a mob on the field with enough health to survive the strike, so what is
/// being measured is the report and not the corpse.
Entity addMob(Rig& rig, Vec2 at, const char* type = "critter") {
    const std::uint16_t index = fixture().registry.mobIndex(type);
    const Entity mob = rig.world.create();
    rig.world.add<MobTag>(mob);
    rig.world.add<MobType>(mob, MobType{index, Rarity::Common, 1.0});
    rig.world.add<Transform>(mob, Transform{at, 0.0});
    rig.world.add<Body>(mob, Body{10.0, 1.0});
    rig.world.add<Health>(mob, Health{10000.0, 10000.0, 0.0, 0.0});
    rig.world.add<Faction>(mob, Faction{Team::Hostiles, false});
    return mob;
}

const WireEvent* firstStrike(const Rig& rig) {
    for (const WireEvent& e : rig.events.events()) {
        if (e.kind == net::EventKind::Lightning) return &e;
    }
    return nullptr;
}

TEST(a_strike_reports_a_bolt_to_every_mob_it_hit) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "lightning");
    rig.settleEquips();

    // One mob against the ring, which is what arms the petal, and two more well
    // inside the strike's thousand-unit reach but nowhere near the petal. All
    // three are struck, so all three must be drawn.
    const Vec2 orbit = rig.world.get<Transform>(rig.petals(0).front()).position;
    addMob(rig, orbit);
    addMob(rig, {1400.0, 1000.0});
    addMob(rig, {1000.0, 1300.0});

    CHECK(rig.tickUntil([&] { return firstStrike(rig) != nullptr; }, 120));
    const WireEvent* strike = firstStrike(rig);
    CHECK(strike != nullptr);
    if (strike == nullptr) return;
    CHECK_EQ(strike->points.size(), std::size_t(3));
    CHECK(strike->positional);

    // A mob outside the reach is not drawn a bolt, because it was not hit.
    Rig far;
    far.equip(0, "lightning");
    far.settleEquips();
    addMob(far, far.world.get<Transform>(far.petals(0).front()).position);
    addMob(far, {1000.0 + kStrikeRadius + 200.0, 1000.0});
    CHECK(far.tickUntil([&] { return firstStrike(far) != nullptr; }, 120));
    const WireEvent* nearOnly = firstStrike(far);
    CHECK(nearOnly != nullptr);
    if (nearOnly != nullptr) CHECK_EQ(nearOnly->points.size(), std::size_t(1));
}

TEST(a_strike_into_a_pile_keeps_the_nearest_bolts) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "lightning");
    rig.settleEquips();

    const Vec2 orbit = rig.world.get<Transform>(rig.petals(0).front()).position;
    addMob(rig, orbit);
    // Further than the cap can carry, laid out so that "nearest" and "whatever
    // order the archetype happens to hold" cannot be confused: the far half is
    // created FIRST, so a plain truncation would keep exactly the wrong ones.
    for (std::size_t i = 0; i < net::kMaxLightningTargets; ++i) {
        addMob(rig, {orbit.x + 600.0 + 5.0 * static_cast<double>(i), orbit.y});
    }
    for (std::size_t i = 0; i < net::kMaxLightningTargets; ++i) {
        addMob(rig, {orbit.x + 5.0 * static_cast<double>(i), orbit.y + 20.0});
    }

    CHECK(rig.tickUntil([&] { return firstStrike(rig) != nullptr; }, 120));
    const WireEvent* strike = firstStrike(rig);
    CHECK(strike != nullptr);
    if (strike == nullptr) return;
    CHECK_EQ(strike->points.size(), net::kMaxLightningTargets);
    for (const Vec2& point : strike->points) {
        CHECK((point - strike->position).length() < 600.0);
    }
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

/// PetalSystem's own kBatteryCharges and kBatteryStrikeIntervalMillis, which
/// are private to it. Spelt out here for the reason kStrikeRadius is: a test
/// that hard-codes them is what notices a battery quietly growing a fourth
/// charge or losing its pacing.
constexpr int kBatteryCharges = 3;
constexpr double kBatteryIntervalMillis = 500.0;

std::size_t countStrikes(const Rig& rig) {
    std::size_t count = 0;
    for (const WireEvent& e : rig.events.events()) {
        if (e.kind == net::EventKind::Lightning) ++count;
    }
    return count;
}

/// A mob overlapping the FLOWER's body without sitting on its centre, which
/// touchesMob reads as a degenerate overlap rather than a hit.
Entity ramMob(Rig& rig) {
    const Vec2 at = rig.world.get<Transform>(rig.player).position;
    return addMob(rig, {at.x + kPlayerBaseRadius + 5.0, at.y});
}

/// The battery still ON the ring. Nothing in this rig reaps a Dead entity, so
/// a spent one is still a live handle the world query returns: what has left
/// the ring is what the slot pass has dropped from the loadout, which is
/// exactly the petals carrying Dead.
Entity liveBattery(Rig& rig, int slotIndex = 0) {
    for (const Entity petal : rig.petals(slotIndex)) {
        if (!rig.world.has<Dead>(petal)) return petal;
    }
    return NULL_ENTITY;
}

int batteryCharges(Rig& rig, int slotIndex = 0) {
    const Entity petal = liveBattery(rig, slotIndex);
    if (petal == NULL_ENTITY) return -1;
    return rig.world.get<PetalInstance>(petal).charges;
}

TEST(a_battery_arrives_with_three_charges_and_spends_one_per_slam) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "battery");
    rig.settleEquips();
    CHECK_EQ(batteryCharges(rig), kBatteryCharges);

    // Nothing to ram: the charges are not a timer and must not tick away on
    // an empty field.
    rig.tick(40);
    CHECK_EQ(countStrikes(rig), std::size_t(0));
    CHECK_EQ(batteryCharges(rig), kBatteryCharges);

    ramMob(rig);
    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(1));
    CHECK_EQ(batteryCharges(rig), kBatteryCharges - 1);
}

TEST(a_battery_paces_its_strikes_half_a_second_apart) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "battery");
    rig.settleEquips();
    ramMob(rig);

    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(1));
    const double first = rig.now;

    // Held against the mob the whole time: without the limiter this is one
    // strike per tick and the battery is flat in three of them.
    CHECK(rig.tickUntil([&] { return countStrikes(rig) > 1; }, 60));
    CHECK(rig.now - first >= kBatteryIntervalMillis);
    CHECK(rig.now - first < kBatteryIntervalMillis + 2.0 * net::kTickMillis);
}

TEST(a_battery_reloads_once_its_third_charge_is_gone) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "battery");
    rig.settleEquips();
    const Entity mob = ramMob(rig);

    // Three strikes, and the petal is off the ring: it has no health pool, so
    // spending the last charge is the only thing that can ever retire it.
    CHECK(rig.tickUntil([&] { return countStrikes(rig) >= std::size_t(kBatteryCharges); }, 120));
    CHECK(rig.tickUntil([&] { return liveBattery(rig) == NULL_ENTITY; }, 5));
    CHECK(rig.slot(0).broken);

    // Still against the mob, and still silent: a flat battery is a reload, not
    // a petal that keeps firing for free.
    const std::size_t spent = countStrikes(rig);
    rig.tick(40);
    CHECK_EQ(countStrikes(rig), spent);

    // Stepped off the mob before the reload lands, so what is measured is the
    // battery that arrives rather than the charge it would spend on the tick
    // it arrived.
    rig.world.destroy(mob);
    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken && liveBattery(rig) != NULL_ENTITY; },
                        200));
    CHECK_EQ(batteryCharges(rig), kBatteryCharges);

    // And it is a working one.
    ramMob(rig);
    CHECK(rig.tickUntil([&] { return countStrikes(rig) > spent; }, 60));
}

/// What the last strike left on the field. A strike's damage is not a number
/// on the wire: it is a one-tick damage field, and this is the only place it
/// can be read before combat resolves and destroys it.
double lastStrikeDamage(Rig& rig) {
    double damage = -1.0;
    Query<GroundEffectTag, GroundEffect> query{rig.world};
    query.each([&](Entity, GroundEffectTag&, GroundEffect& effect) {
        if (effect.owner == rig.player) damage = effect.damagePerHit;
    });
    return damage;
}

/// PetalSystem's own kLightningFallbackDamage, which is private to it. The
/// battery declares `damage: 0` -- it does not hit anything with its body --
/// so this is what its shock is worth at common.
constexpr double kFallbackStrike = 25.0;

TEST(a_strike_is_paid_at_the_petal_damage_rate) {
    if (!contentLoaded()) return;
    Rig plain;
    plain.equip(0, "battery");
    plain.settleEquips();
    ramMob(plain);
    CHECK(plain.tickUntil([&] { return countStrikes(plain) > 0; }, 60));
    // An untalented common flower is the baseline the multiplier below is
    // measured against.
    CHECK_NEAR(lastStrikeDamage(plain), kFallbackStrike, 1e-9);

    // The same slam under the Damage talent. A strike is something a PETAL
    // does, so it rides the steep effect curve every other petal effect does
    // rather than arriving as the raw stat.
    Rig talented;
    talented.world.add<PlayerSkillTree>(talented.player);
    talented.world.get<PlayerSkillTree>(talented.player)
        .skills.set(SkillId::Damage, rarityIndex(Rarity::Legendary));
    talented.equip(0, "battery");
    talented.settleEquips();
    ramMob(talented);
    CHECK(talented.tickUntil([&] { return countStrikes(talented) > 0; }, 60));

    const double scale = talented.modifiers().petalDamageScale;
    CHECK(scale > 1.0);
    CHECK_NEAR(lastStrikeDamage(talented), kFallbackStrike * scale, 1e-9);
}

TEST(a_strike_climbs_the_rarity_ladder_with_the_petal) {
    if (!contentLoaded()) return;
    // A petal whose own damage stat carries the tier: petalStats has already
    // put it up the 3x ladder, and the strike spends exactly that.
    Rig bolt;
    bolt.equip(0, "lightning", Rarity::Apex);
    bolt.settleEquips();
    addMob(bolt, bolt.world.get<Transform>(bolt.petals(0).front()).position);
    CHECK(bolt.tickUntil([&] { return countStrikes(bolt) > 0; }, 120));
    CHECK_NEAR(lastStrikeDamage(bolt), 25.0 * petalStatScale(Rarity::Apex), 1e-6);

    // And a petal with NO damage stat climbs the same ladder. A flat fallback
    // is what made an apex battery shock for a common battery's number.
    Rig cell;
    cell.equip(0, "battery", Rarity::Apex);
    cell.settleEquips();
    ramMob(cell);
    CHECK(cell.tickUntil([&] { return countStrikes(cell) > 0; }, 60));
    CHECK_NEAR(lastStrikeDamage(cell), kFallbackStrike * petalStatScale(Rarity::Apex), 1e-6);

    // Which is the whole point: the tier has to change the number.
    Rig common;
    common.equip(0, "battery");
    common.settleEquips();
    ramMob(common);
    CHECK(common.tickUntil([&] { return countStrikes(common) > 0; }, 60));
    CHECK(lastStrikeDamage(cell) > lastStrikeDamage(common) * 1000.0);
}

TEST(a_battery_ignores_a_mob_that_only_touches_the_ring) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "battery");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    // On the petal, well clear of the flower. The battery discharges on what
    // the FLOWER rams; a mob the ring sweeps across is not that.
    const Vec2 orbit = rig.world.get<Transform>(rig.petals(0).front()).position;
    CHECK((orbit - rig.world.get<Transform>(rig.player).position).length() >
          kPlayerBaseRadius + 20.0);
    addMob(rig, orbit);
    rig.tick(40);
    CHECK_EQ(countStrikes(rig), std::size_t(0));
    CHECK_EQ(batteryCharges(rig), kBatteryCharges);
}

// ---------------------------------------------------------------------------
// The capacitor
// ---------------------------------------------------------------------------

/// PetalSystem's own capacitor figures, private to it and spelt out here for
/// the reason the battery's are.
constexpr double kCapacitorMaxCharge = 60.0;
constexpr double kCapacitorWindowMillis = 1000.0;

/// A capacitor on a frozen ring, with a mob sitting on it. Off its centre by a
/// few units, which touchesMob would otherwise read as a degenerate overlap.
Entity touchCapacitor(Rig& rig, Rarity rarity = Rarity::Common) {
    rig.equip(0, "capacitor", rarity);
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    const Vec2 at = rig.position(rig.petals(0).front());
    return addMob(rig, {at.x + 5.0, at.y});
}

/// Take the mob off the capacitor without taking it out of the strike's reach,
/// so the discharge still has a bolt to report.
void pullAway(Rig& rig, Entity mob) {
    const Vec2 petal = rig.position(rig.petals(0).front());
    rig.world.get<Transform>(mob).position = {petal.x + 300.0, petal.y};
}

TEST(a_capacitor_discharges_what_it_banked_when_contact_ends) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "capacitor");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    // Nothing to touch: no charge, no strike.
    rig.tick(40);
    CHECK_EQ(countStrikes(rig), std::size_t(0));

    const Vec2 at = rig.position(rig.petals(0).front());
    const Entity mob = addMob(rig, {at.x + 5.0, at.y});
    // Charging, silently, for as long as the contact lasts.
    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(0));

    pullAway(rig, mob);
    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(1));
    // One point per millisecond: one tick against the mob, under the cap.
    CHECK_NEAR(lastStrikeDamage(rig), net::kTickMillis, 1e-6);

    // Spent: stepping clear again throws nothing more.
    rig.tick(40);
    CHECK_EQ(countStrikes(rig), std::size_t(1));
}

TEST(a_capacitor_holds_no_more_than_its_cap) {
    if (!contentLoaded()) return;
    Rig rig;
    const Entity mob = touchCapacitor(rig);
    // A third of a second against the mob, well past what the cap takes.
    rig.tick(10);
    CHECK_EQ(countStrikes(rig), std::size_t(0));
    pullAway(rig, mob);
    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(1));
    CHECK_NEAR(lastStrikeDamage(rig), kCapacitorMaxCharge, 1e-6);
}

TEST(a_capacitor_that_never_leaves_discharges_every_second) {
    if (!contentLoaded()) return;
    Rig rig;
    touchCapacitor(rig);
    const double start = rig.now;

    // Held against the mob throughout. A capacitor that only fired on leaving
    // would bank forever here.
    CHECK(rig.tickUntil([&] { return countStrikes(rig) > 0; }, 60));
    CHECK_NEAR(rig.now - start, kCapacitorWindowMillis, 1e-6);
    CHECK_NEAR(lastStrikeDamage(rig), kCapacitorMaxCharge, 1e-6);

    // And starts over rather than firing every tick from then on.
    const double first = rig.now;
    CHECK(rig.tickUntil([&] { return countStrikes(rig) > 1; }, 60));
    CHECK_NEAR(rig.now - first, kCapacitorWindowMillis, 1e-6);
}

TEST(a_capacitor_climbs_the_rarity_ladder_like_lightning) {
    if (!contentLoaded()) return;
    Rig rig;
    const Entity mob = touchCapacitor(rig, Rarity::Legendary);
    rig.tick(10);
    pullAway(rig, mob);
    rig.tick();
    CHECK_EQ(countStrikes(rig), std::size_t(1));
    CHECK_NEAR(lastStrikeDamage(rig), kCapacitorMaxCharge * petalStatScale(Rarity::Legendary),
               1e-6);
}

// ---------------------------------------------------------------------------
// Breaking and reloading
// ---------------------------------------------------------------------------

TEST(a_petal_at_zero_health_breaks_and_returns_on_its_cooldown) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 10.0, 1e-9);

    rig.damage(rig.petals(0).front(), 10.0);
    const double brokenAt = rig.now + net::kTickMillis;
    rig.tick();

    CHECK(rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    CHECK_NEAR(rig.slot(0).reloadReadyAtMillis, brokenAt + 1200.0, 1e-9);

    // Not a tick early: the cooldown is the whole cost of losing a petal.
    while (rig.now + net::kTickMillis < rig.slot(0).reloadReadyAtMillis) {
        rig.tick();
        CHECK(rig.slot(0).broken);
        CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    }
    const double readyAt = rig.slot(0).reloadReadyAtMillis;
    rig.tick();
    CHECK(rig.now >= readyAt);
    CHECK(rig.now < readyAt + net::kTickMillis + 1e-9);
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    // It comes back whole, not at whatever health it died with.
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 10.0, 1e-9);
}

TEST(the_reload_talent_shortens_a_broken_petals_cooldown) {
    if (!contentLoaded()) return;

    // The same break on two flowers, one of them at the top of the Reload
    // branch. Basic's own cooldown is 1200ms, which unique cuts to 29.2%.
    const auto breakBasic = [](Rig& rig) {
        rig.equip(0, "basic");
        rig.settleEquips();
        rig.damage(rig.petals(0).front(), 10.0);
        const double brokenAt = rig.now + net::kTickMillis;
        rig.tick();
        CHECK(rig.slot(0).broken);
        return rig.slot(0).reloadReadyAtMillis - brokenAt;
    };

    Rig plain;
    CHECK_NEAR(breakBasic(plain), 1200.0, 1e-9);

    Rig unique;
    unique.world.add<PlayerSkillTree>(unique.player);
    unique.world.get<PlayerSkillTree>(unique.player)
        .skills.set(SkillId::Reload, rarityIndex(Rarity::Unique));
    CHECK_NEAR(breakBasic(unique), 350.4, 1e-9);

    // And it is a real wait, not just a shorter number on the slot. Twelve
    // ticks is 400ms: enough for unique to have its petal back, and far short
    // of the full cooldown the plain flower is still serving.
    plain.tick(12);
    unique.tick(12);
    CHECK(!unique.slot(0).broken);
    CHECK_EQ(unique.petals(0).size(), std::size_t(1));
    CHECK(plain.slot(0).broken);
}

TEST(the_reload_talent_paces_a_projectile_petals_volleys) {
    if (!contentLoaded()) return;

    // A missile petal's reload is its rate of fire: it is spent by the shot and
    // the slot pays the cooldown. Counting volleys over a fixed window is what
    // tells the two halves of that apart from a slot that merely LOOKS ready.
    const auto volleys = [](Rig& rig, int ticks) {
        rig.equip(0, "peas");
        rig.settleEquips();
        rig.setFlags(net::InputAttack);
        int fired = 0;
        bool wasBroken = rig.slot(0).broken;
        for (int i = 0; i < ticks; ++i) {
            rig.tick();
            if (rig.slot(0).broken && !wasBroken) ++fired;
            wasBroken = rig.slot(0).broken;
        }
        return fired;
    };

    Rig plain;
    const int slow = volleys(plain, 300);

    Rig unique;
    unique.world.add<PlayerSkillTree>(unique.player);
    unique.world.get<PlayerSkillTree>(unique.player)
        .skills.set(SkillId::Reload, rarityIndex(Rarity::Unique));
    const int fast = volleys(unique, 300);

    CHECK(slow > 0);
    // Not an exact ratio: the first volley of each run is paced by the equip
    // reload rather than by the shot timer, so unique lands near, not exactly
    // on, 1/0.292 times the count.
    CHECK(fast >= slow * 3);
}

TEST(partial_damage_does_not_break_a_petal) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    rig.damage(rig.petals(0).front(), 9.5);
    rig.tick(20);
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    // Damage is kept, not silently healed by the mirror that keeps a cluster
    // in step.
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 0.5, 1e-9);
}

TEST(a_clumped_slot_gives_every_grain_its_own_health) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sandy");
    rig.tick();
    for (const Entity grain : rig.petals(0)) CHECK_NEAR(rig.healthOf(grain), 12.0, 1e-9);

    // `clumped` is the second, and by far the commoner, way the reference
    // declares independent instances: `(clumped || independentHealth) &&
    // count > 1`. A four-grain clump of sand is four petals that share one
    // place on the ring, NOT one health bar shared four ways -- so a hit on
    // one grain stays on that grain.
    rig.damage(rig.petalWithSub(0, 0), 5.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 0)), 7.0, 1e-9);
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 1)), 12.0, 1e-9);

    // Two grains hit in the same tick take their own damage and nobody else's.
    rig.damage(rig.petalWithSub(0, 0), 3.0);
    rig.damage(rig.petalWithSub(0, 1), 4.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 0)), 4.0, 1e-9);
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 1)), 8.0, 1e-9);
    CHECK(!rig.slot(0).broken);

    // And one grain breaking leaves the other three on the field, which is
    // what a shared pool could never do.
    rig.damage(rig.petalWithSub(0, 0), 4.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));
    CHECK(!rig.slot(0).broken);

    CHECK(rig.tickUntil([&] { return rig.petals(0).size() == 4; }));
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 0)), 12.0, 1e-9);
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 1)), 8.0, 1e-9);
}

TEST(independent_health_petals_break_one_at_a_time) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "shards");
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));

    // Damage on one shard stays on that shard.
    rig.damage(rig.petalWithSub(0, 0), 4.0);
    rig.tick();
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 0)), 2.0, 1e-9);
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 1)), 6.0, 1e-9);

    rig.damage(rig.petalWithSub(0, 1), 6.0);
    const double brokenAt = rig.now + net::kTickMillis;
    rig.tick();
    // One down, two still out: the slot is not on cooldown.
    CHECK_EQ(rig.petals(0).size(), std::size_t(2));
    CHECK(!rig.slot(0).broken);
    CHECK(rig.petalWithSub(0, 1) == NULL_ENTITY);
    const PetalSlotState& state = rig.world.get<PetalSlotState>(rig.player);
    CHECK_NEAR(state.slots[0].instanceReadyAtMillis[1], brokenAt + 500.0, 1e-9);

    CHECK(rig.tickUntil([&] { return rig.petals(0).size() == 3; }));
    CHECK(!rig.slot(0).broken);
    // The one that came back is whole; the one that was only grazed is not
    // healed by its neighbour's return.
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 1)), 6.0, 1e-9);
    CHECK_NEAR(rig.healthOf(rig.petalWithSub(0, 0)), 2.0, 1e-9);
}

TEST(a_combat_killed_independent_petal_still_pays_its_reload) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "shards");
    rig.tick();

    // As the server does it: combat marks the kill, and the reaper destroys
    // the petal at the end of that same tick. The ring pass never sees the
    // corpse -- only a grain that is missing.
    const Entity shard = rig.petalWithSub(0, 1);
    const double brokenAt = rig.now + net::kTickMillis;
    rig.world.add<Dead>(shard);
    rig.reap();
    rig.tick();

    CHECK_EQ(rig.petals(0).size(), std::size_t(2));
    const PetalSlotState& state = rig.world.get<PetalSlotState>(rig.player);
    CHECK_NEAR(state.slots[0].instanceReadyAtMillis[1], brokenAt + 500.0, 1e-9);
    // Stays down for the whole reload, as a single petal would, and not a
    // tick longer.
    while (rig.now + net::kTickMillis < brokenAt + 500.0) {
        rig.tick();
        CHECK_EQ(rig.petals(0).size(), std::size_t(2));
    }
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));
}

TEST(a_clumped_grain_killed_and_reaped_pays_the_same_reload_as_a_single_petal) {
    if (!contentLoaded()) return;
    // The two health models side by side, both killed the way combat kills:
    // marked Dead, reaped before the ring pass. A clump must not reload any
    // faster than a single petal does.
    Rig single;
    single.equip(0, "basic");
    single.settleEquips();
    single.world.add<Dead>(single.petals(0).front());
    single.reap();
    const double singleBrokenAt = single.now + net::kTickMillis;
    single.tick();
    CHECK(single.slot(0).broken);
    CHECK_NEAR(single.slot(0).reloadReadyAtMillis, singleBrokenAt + 1200.0, 1e-9);

    Rig clump;
    clump.equip(0, "sandy");
    clump.tick();
    CHECK_EQ(clump.petals(0).size(), std::size_t(4));
    for (const Entity grain : clump.petals(0)) clump.world.add<Dead>(grain);
    clump.reap();
    const double clumpBrokenAt = clump.now + net::kTickMillis;
    clump.tick();
    CHECK_EQ(clump.petals(0).size(), std::size_t(0));
    CHECK(clump.slot(0).broken);
    CHECK_NEAR(clump.slot(0).reloadReadyAtMillis, clumpBrokenAt + 800.0, 1e-9);
    clump.tick(5);
    CHECK_EQ(clump.petals(0).size(), std::size_t(0));
    CHECK(clump.tickUntil([&] { return clump.petals(0).size() == 4; }));
    CHECK(clump.now >= clumpBrokenAt + 800.0);
}

TEST(an_independent_slot_reads_as_broken_only_when_all_of_it_is_down) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "shards");
    rig.tick();
    for (const Entity shard : rig.petals(0)) rig.damage(shard, 6.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    CHECK(rig.slot(0).broken);
    CHECK(rig.slot(0).reloadReadyAtMillis > rig.now);

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));
}

TEST(a_petal_with_no_health_pool_can_never_break) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "rock");
    rig.settleEquips();
    const std::vector<Entity> petals = rig.petals(0);
    CHECK_EQ(petals.size(), std::size_t(1));
    // No Health component at all: an unbreakable petal is not one with zero
    // hit points, which would break on its first tick.
    CHECK(!rig.world.has<Health>(petals.front()));

    rig.tick(200);
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
}

TEST(a_broken_petal_leaves_its_gap_open) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.equip(1, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    CHECK_EQ(rig.petals().size(), std::size_t(3));   // two basics and the anchor

    rig.damage(rig.petals(0).front(), 10.0);
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(2));

    // The survivor keeps the third of the ring it already had. Re-spacing the
    // remaining petals would make every break a visible lurch.
    const Entity survivor = rig.petals(1).front();
    rig.settleRing();
    CHECK_NEAR(angularGap(rig.angleOf(survivor), rig.ring().spin + kTau / 3.0), 0.0, 1e-6);
}

TEST(swapping_a_petal_rebuilds_the_slot_from_scratch) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    rig.damage(rig.petals(0).front(), 8.0);
    rig.tick();
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 2.0, 1e-9);

    rig.equip(0, "sandy");
    rig.tick();
    const std::vector<Entity> grains = rig.petals(0);
    CHECK_EQ(grains.size(), std::size_t(4));
    for (const Entity grain : grains) CHECK_NEAR(rig.healthOf(grain), 12.0, 1e-9);
    CHECK(!rig.slot(0).broken);
}

TEST(re_equipping_over_a_broken_slot_clears_its_cooldown) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    rig.damage(rig.petals(0).front(), 10.0);
    rig.tick();
    CHECK(rig.slot(0).broken);

    rig.equip(0, "shards");
    rig.tick();
    CHECK(!rig.slot(0).broken);
    CHECK_NEAR(rig.slot(0).reloadReadyAtMillis, 0.0, 1e-12);
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));
}

TEST(unequipping_removes_the_petals_immediately) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sandy");
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(4));
    rig.unequip(0);
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(0));
    CHECK(rig.world.get<Loadout>(rig.player).spawned.empty());
}

TEST(death_clears_the_ring_and_respawning_rebuilds_it) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.equip(1, "sandy");
    rig.settleEquips();
    CHECK_EQ(rig.petals().size(), std::size_t(5));

    rig.world.get<Health>(rig.player).current = 0.0;
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(0));
    CHECK(rig.world.get<Loadout>(rig.player).spawned.empty());
    // The reload debt dies with the body: coming back mid-cooldown on every
    // slot would be a harsher punishment than losing the petals was.
    CHECK(!rig.slot(0).broken);

    rig.world.get<Health>(rig.player).current = 100.0;
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(5));
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

TEST(modifiers_are_summed_from_scratch_and_vanish_when_unequipped) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "lucky");
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 3.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5, 1e-9);
    CHECK_NEAR(rig.modifiers().magnetism, 50.0, 1e-9);

    // A hundred ticks must not accumulate a hundred bonuses.
    rig.tick(100);
    CHECK_NEAR(rig.modifiers().luck, 3.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5, 1e-9);

    rig.equip(1, "lucky");
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 5.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5 * 1.5, 1e-9);
    CHECK_NEAR(rig.modifiers().magnetism, 100.0, 1e-9);

    rig.unequip(0);
    rig.unequip(1);
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().speedScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().magnetism, kBaseMagnetism, 1e-12);
}

TEST(worn_evasion_grows_a_step_a_tier_and_copies_are_independent_rolls) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.tick();
    CHECK_NEAR(rig.modifiers().evasion, 0.0, 1e-12);

    rig.equip(0, "charm");
    rig.tick();
    CHECK_NEAR(rig.modifiers().evasion, 0.1, 1e-12);

    // Rare is the third tier: three steps of the authored 0.1.
    rig.equip(0, "charm", Rarity::Rare);
    rig.tick();
    CHECK_NEAR(rig.modifiers().evasion, 0.3, 1e-12);

    // Two of them do not make 60%: a hit has to get past both rolls.
    rig.equip(1, "charm", Rarity::Rare);
    rig.tick();
    CHECK_NEAR(rig.modifiers().evasion, 1.0 - 0.7 * 0.7, 1e-12);

    rig.unequip(0);
    rig.unequip(1);
    rig.tick();
    CHECK_NEAR(rig.modifiers().evasion, 0.0, 1e-12);
}

TEST(the_strongest_worn_aggro_range_cut_wins_and_copies_do_not_multiply) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.tick();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 1.0, 1e-12);

    rig.equip(0, "stinky");
    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 0.75, 1e-12);

    // A second common is still -25%, not the -43.75% that is an uncommon's;
    // a better tier beside it takes over.
    rig.equip(1, "stinky");
    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 0.75, 1e-12);
    rig.equip(2, "stinky", Rarity::Epic);
    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, std::pow(0.75, 4), 1e-12);

    rig.unequip(0);
    rig.unequip(1);
    rig.unequip(2);
    rig.tick();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 1.0, 1e-12);
}

TEST(aggro_modifiers_work_only_while_the_petal_is_on_the_ring) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "stinky");
    rig.equip(1, "glowy");

    // Equipped but still serving the equip reload: nothing yet.
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK(rig.slot(1).broken);
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().aggroRadiusBonus, 0.0, 1e-12);

    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 0.75, 1e-12);
    CHECK_NEAR(rig.modifiers().aggroRadiusBonus, 150.0, 1e-9);

    // Each one lapses on its own when it breaks, and only for its reload.
    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().aggroRadiusBonus, 150.0, 1e-9);

    rig.damage(rig.petals(1).front(), 10.0);
    rig.tick();
    CHECK(rig.slot(1).broken);
    CHECK_NEAR(rig.modifiers().aggroRadiusBonus, 0.0, 1e-12);

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken && !rig.slot(1).broken; }));
    CHECK_NEAR(rig.modifiers().aggroRangeScale, 0.75, 1e-12);
    CHECK_NEAR(rig.modifiers().aggroRadiusBonus, 150.0, 1e-9);
}

TEST(a_broken_petal_keeps_its_equipment_modifier_while_reloading) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "lucky");
    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().luck, 3.0, 1e-9);

    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.modifiers().luck, 3.0, 1e-12);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5, 1e-12);

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_NEAR(rig.modifiers().luck, 3.0, 1e-9);
}

TEST(a_sponge_defers_damage_only_while_its_body_is_alive) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sponge", Rarity::Rare);
    rig.settleEquips();
    CHECK_NEAR(rig.modifiers().spongeDamageDurationMillis, 2000.0, 1e-9);

    rig.damage(rig.petals(0).front(), 10.0 * petalStatScale(Rarity::Rare));
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.modifiers().spongeDamageDurationMillis, 0.0, 1e-12);
}

TEST(a_yucca_heals_only_while_the_flower_is_blocking) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "yuccaish");
    rig.settleEquips();
    const double yucca =
        fixture().registry.petalStats(petalId("yuccaish"), Rarity::Common).passiveHealPerSecond;
    CHECK(yucca > 0.0);

    // Worn but not blocking: the base regeneration and nothing more.
    rig.tick();
    CHECK_NEAR(rig.modifiers().passiveHealPerSecond, 1.0, 1e-12);

    rig.setFlags(net::InputDefend);
    rig.tick();
    CHECK_NEAR(rig.modifiers().passiveHealPerSecond, 1.0 + yucca, 1e-12);

    rig.setFlags(net::InputAttack);
    rig.tick();
    CHECK_NEAR(rig.modifiers().passiveHealPerSecond, 1.0, 1e-12);

    // Both keys is a lunge, not a block (see the ring test above), so the
    // ring is out and the yucca pays nothing.
    rig.setFlags(net::InputAttack | net::InputDefend);
    rig.tick();
    CHECK_NEAR(rig.modifiers().passiveHealPerSecond, 1.0, 1e-12);

    // The health itself follows the stance, not just the published rate.
    Health& health = rig.world.get<Health>(rig.player);
    health.current = health.max * 0.5;
    const double before = health.current;
    rig.setFlags(0);
    rig.tick(30);
    const double idleGain = health.current - before;
    const double mid = health.current;
    rig.setFlags(net::InputDefend);
    rig.tick(30);
    const double blockGain = health.current - mid;
    CHECK(blockGain > idleGain);
}

TEST(a_leaf_heals_whatever_the_stance) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "leafy");
    rig.settleEquips();
    const double leaf =
        fixture().registry.petalStats(petalId("leafy"), Rarity::Common).passiveHealPerSecond;
    for (const std::uint8_t flags :
         {std::uint8_t{0}, std::uint8_t{net::InputDefend}, std::uint8_t{net::InputAttack},
          std::uint8_t{net::InputAttack | net::InputDefend}}) {
        rig.setFlags(flags);
        rig.tick();
        CHECK_NEAR(rig.modifiers().passiveHealPerSecond, 1.0 + leaf, 1e-12);
    }
}

TEST(a_sponge_publishes_the_damage_it_is_holding_for_the_bar) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sponge");
    rig.equip(1, "basic");
    rig.settleEquips();

    // Two deferred hits: the bar prints what the FLOWER is still holding, not
    // a share per hit -- combat defers a hit against the player.
    SpongeDamageState& stored = rig.world.ensure<SpongeDamageState>(rig.player);
    stored.effects.push_back(SpongeDamageEffect{9.0, 9.0, NULL_ENTITY});
    stored.effects.push_back(SpongeDamageEffect{5.0, 5.0, NULL_ENTITY});
    rig.tick();
    CHECK_NEAR(rig.slotCounter(0), 14.0, 1e-9);
    // A petal with no number of its own says so, rather than printing a zero.
    CHECK(rig.slotCounter(1) < 0.0);

    // Paid back: the number goes with the damage.
    rig.world.get<SpongeDamageState>(rig.player).effects.clear();
    rig.tick();
    CHECK_NEAR(rig.slotCounter(0), 0.0, 1e-9);

    // And a slot that stops being a sponge stops having a number at all, even
    // while the flower is still paying the old hits back.
    rig.world.get<SpongeDamageState>(rig.player)
        .effects.push_back(SpongeDamageEffect{4.0, 4.0, NULL_ENTITY});
    rig.equip(0, "basic");
    rig.tick();
    CHECK(rig.slotCounter(0) < 0.0);
}

TEST(a_broken_sponge_goes_on_printing_what_it_absorbed) {
    // The stored hits drain whether or not the body that took them survived,
    // so the number stays up while the slot reloads. A number that vanished at
    // the moment it mattered most would read as the damage being cancelled.
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sponge");
    rig.settleEquips();

    rig.world.ensure<SpongeDamageState>(rig.player)
        .effects.push_back(SpongeDamageEffect{11.0, 11.0, NULL_ENTITY});
    rig.damage(rig.petals(0).front(), 10.0);
    rig.tick();

    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.slotCounter(0), 11.0, 1e-9);
}

TEST(a_downed_flower_prints_no_stored_damage_on_its_death_card) {
    // reconcileSlots steps over a corpse, so a number left standing would
    // freeze there for as long as the death card is up -- which is how this
    // read as a feature that only worked when you were dead. The ring pass
    // drops it with the ring.
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sponge");
    rig.settleEquips();

    rig.world.ensure<SpongeDamageState>(rig.player)
        .effects.push_back(SpongeDamageEffect{18.0, 0.0, NULL_ENTITY});
    rig.tick();
    CHECK_NEAR(rig.slotCounter(0), 18.0, 1e-9);

    rig.world.add<Dead>(rig.player);
    rig.tick();
    CHECK(rig.slotCounter(0) < 0.0);

    // And a revive republishes it: the corpse kept what it was holding.
    rig.world.remove<Dead>(rig.player);
    rig.tick();
    CHECK_NEAR(rig.slotCounter(0), 18.0, 1e-9);
}

// ---------------------------------------------------------------------------
// Root: banking the armour combat spends
// ---------------------------------------------------------------------------

namespace {
/// The stacks a flower is holding, and 0 for one that has never had a root on.
int bankedStacks(Rig& rig) {
    const ArmorStackState* state = rig.world.tryGet<ArmorStackState>(rig.player);
    return state != nullptr ? state->stacks : 0;
}

/// Ticks between two stacks. ROUNDED, not truncated: a tick is 33.333... ms
/// and sixty of them sum to a hair under two seconds, so the honest answer is
/// sixty and the truncating one is fifty-nine.
const int kTicksPerStack =
    static_cast<int>(std::lround(kArmorStackIntervalMillis / net::kTickMillis));
}  // namespace

TEST(a_root_banks_one_stack_every_two_seconds_and_stops_at_ten) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.tick();

    // Nothing at first: the bank starts empty and the interval has to pass
    // before it pays out. A stack on the equipping tick would hand a flower
    // one for free every time it swapped the petal in.
    CHECK_EQ(bankedStacks(rig), 0);

    rig.tick(kTicksPerStack);
    CHECK_EQ(bankedStacks(rig), 1);
    rig.tick(kTicksPerStack);
    CHECK_EQ(bankedStacks(rig), 2);

    // Capped. Twenty seconds fills it; another twenty adds nothing.
    rig.tick(kTicksPerStack * (kMaxArmorStacks + 4));
    CHECK_EQ(bankedStacks(rig), kMaxArmorStacks);

    // And the petal publishes what a stack is worth, which is what combat
    // subtracts. Common tier: the authored figure, unscaled.
    CHECK_NEAR(rig.world.get<ArmorStackState>(rig.player).perStack, 12.0, 1e-9);
    CHECK_NEAR(rig.modifiers().armorPerStack, 12.0, 1e-9);
}

TEST(a_stack_spent_at_the_cap_comes_back_on_the_timers_own_cadence) {
    // gardn cycles the counter whether or not a stack is owed, so a flower
    // that spends one while full is not made to wait a fresh full interval.
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.tick(kTicksPerStack * (kMaxArmorStacks + 1));
    CHECK_EQ(bankedStacks(rig), kMaxArmorStacks);

    // Spend one just before the next crossing, as combat would.
    rig.tick(kTicksPerStack - 2);
    --rig.world.get<ArmorStackState>(rig.player).stacks;
    rig.tick(2);
    CHECK_EQ(bankedStacks(rig), kMaxArmorStacks);
}

TEST(taking_the_root_off_empties_the_bank) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.tick(kTicksPerStack * 3);
    CHECK_EQ(bankedStacks(rig), 3);

    // Banked stacks are not a possession. Carrying them over would let a
    // player bank ten and then fight on a loadout with no root in it.
    rig.unequip(0);
    rig.tick();
    CHECK_EQ(bankedStacks(rig), 0);
    CHECK_NEAR(rig.world.get<ArmorStackState>(rig.player).perStack, 0.0, 1e-12);
}

TEST(a_broken_root_goes_on_banking) {
    // Unlike a sponge, which has to be out to catch a hit: root banks on a
    // timer the FLOWER runs, and a petal that stopped earning the moment it
    // broke would stop exactly while the flower is being hit.
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.settleEquips();
    rig.damage(rig.petals(0).front(), 100.0);
    rig.tick();
    CHECK(rig.slot(0).broken);

    const int before = bankedStacks(rig);
    rig.tick(kTicksPerStack);
    CHECK_EQ(bankedStacks(rig), before + 1);
}

TEST(a_downed_flower_loses_the_armour_it_banked) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.tick(kTicksPerStack * 4);
    CHECK_EQ(bankedStacks(rig), 4);

    rig.world.add<Dead>(rig.player);
    rig.tick();
    CHECK_EQ(bankedStacks(rig), 0);

    // A revive starts the bank over rather than handing back what the corpse
    // was holding.
    rig.world.remove<Dead>(rig.player);
    rig.tick();
    CHECK_EQ(bankedStacks(rig), 0);
}

TEST(two_roots_are_one_bank_at_the_better_petals_strength) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.equip(1, "root", Rarity::Rare);
    rig.tick(kTicksPerStack);

    // One stack for the pair, not one each -- and worth the rare petal's
    // figure, which is the common one up two tiers of the 3x ladder.
    CHECK_EQ(bankedStacks(rig), 1);
    CHECK_NEAR(rig.modifiers().armorPerStack, 12.0 * 9.0, 1e-9);
}

TEST(a_root_prints_the_stacks_it_is_holding_on_the_bar) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "root");
    rig.equip(1, "basic");
    rig.settleEquips();

    // A root always prints, zero included: the gauge is the petal saying how
    // much it has ready, and one that disappeared while empty could not be
    // told from a petal that never had one.
    CHECK_NEAR(rig.slotCounter(0), static_cast<double>(bankedStacks(rig)), 1e-9);
    CHECK(rig.slotCounter(1) < 0.0);

    rig.tick(kTicksPerStack * 2);
    const double printed = rig.slotCounter(0);
    CHECK_NEAR(printed, static_cast<double>(bankedStacks(rig)), 1e-9);
    CHECK(printed >= 2.0);

    // And a slot that stops being a root stops having a number at all.
    rig.equip(0, "basic");
    rig.tick();
    CHECK(rig.slotCounter(0) < 0.0);
}

TEST(a_clump_pays_its_modifier_once_not_once_per_grain) {
    if (!contentLoaded()) return;
    Rig rig;
    // sandy carries no modifiers, so this checks the slot-vs-instance rule
    // through the one number a four-count petal would inflate: the count of
    // contributions, seen here as the range scale staying neutral.
    rig.equip(0, "sandy");
    rig.equip(1, "reacher");
    rig.settleEquips();
    CHECK_EQ(rig.petals().size(), std::size_t(5));
    CHECK_NEAR(rig.modifiers().rangeScale, 1.5, 1e-9);
}

TEST(rarity_scales_a_petals_published_numbers) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "toxic", Rarity::Rare);
    rig.settleEquips();
    const Entity petal = rig.petals(0).front();

    // Rare is two tiers up: a flat 3x per tier on damage and poison.
    const double scale = petalStatScale(Rarity::Rare);
    CHECK_NEAR(rig.world.get<ContactDamage>(petal).amount, 2.0 * scale, 1e-9);
    const PetalEffect& effect = rig.world.get<PetalEffect>(petal);
    CHECK_NEAR(effect.poisonPerSecond, 50.0 * scale, 1e-6);
    // Duration is flat: rarity buys damage, not a longer debuff.
    CHECK_NEAR(effect.poisonDurationMillis, 3000.0, 1e-9);
    CHECK_NEAR(rig.healthOf(petal), 5.0 * scale, 1e-9);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

TEST(a_burst_heal_charges_homes_consumes_and_reloads) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.settleEquips();
    rig.world.get<Health>(rig.player).current = 50.0;
    rig.setFlags(net::InputAttack);
    rig.tick(60);   // well past the petal's 1000ms charge

    // Input does not gate a rose: after charging it flies home because health
    // is missing, delivers one burst, and enters its normal break cooldown.
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 62.0, 1e-9);
    CHECK(rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    CHECK(rig.tickUntil([&] { return rig.world.get<Health>(rig.player).current > 70.0; }, 50));
}

/// The same burst, on a flower running flat out.
///
/// A homing petal closes on the flower with a first-order glide, and a glide
/// toward a MOVING target settles at a standing lag rather than arriving: at
/// top speed that gap is some 28 units, wider than the flower's own 20-unit
/// body, so the rose trails it and is never touched. It is the dive's landing
/// window that delivers the burst here, not contact -- without one the petal
/// chases a sprinting player forever, healing nothing and never reloading.
TEST(a_burst_heal_lands_on_a_flower_running_at_top_speed) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.settleEquips();
    rig.world.get<Health>(rig.player).current = 50.0;

    // MovementSystem is not in this rig, so the sprint is applied by hand:
    // one tick of top speed, written where movement would have written it.
    const Vec2 stride{kPlayerMaxSpeed * net::kTickSeconds, 0.0};
    bool delivered = false;
    for (int i = 0; i < 200 && !delivered; ++i) {
        rig.world.get<Transform>(rig.player).position += stride;
        rig.tick();
        delivered = rig.slot(0).broken;
    }

    CHECK(delivered);
    CHECK(rig.world.get<Health>(rig.player).current >= 60.0);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
}

/// And the dive that never lands pays out regardless.
///
/// Contact is how a burst is normally spent, but it is not guaranteed -- a
/// wall the petal is pushed back out of can hold it off the flower for as long
/// as the flower stands behind it. Stranded mid-dive the petal heals nothing
/// and never dies, so the slot never reloads and the rose simply stops being a
/// petal. Here the gap is held open by hand, which is that case in the small.
TEST(a_burst_heal_that_cannot_reach_the_flower_is_absorbed_anyway) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.settleEquips();
    rig.world.get<Health>(rig.player).current = 50.0;

    bool delivered = false;
    int ticks = 0;
    for (; ticks < 200 && !delivered; ++ticks) {
        // Whatever the dive managed last tick, drag the petal back out of
        // reach: the gap never closes, however long it chases.
        const std::vector<Entity> out = rig.petals(0);
        if (!out.empty()) {
            rig.world.get<Transform>(out.front()).position =
                rig.position(rig.player) + Vec2{400.0, 0.0};
        }
        rig.tick();
        delivered = rig.slot(0).broken;
    }

    CHECK(delivered);
    CHECK(rig.world.get<Health>(rig.player).current >= 60.0);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    // Waited out rather than paid early: the burst is only given up on once
    // the dive has had its window, which is well past the third of a second a
    // landing dive takes.
    CHECK(ticks * net::kTickMillis >= kPetalHomingTimeoutMillis);
}

TEST(a_dandelions_lockout_stops_the_ring_healing_at_all) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.settleEquips();
    rig.world.get<Health>(rig.player).current = 50.0;
    // Well past the burst's own charge and past a second of passive
    // regeneration, so a lockout that leaked anywhere would show.
    rig.world.ensure<Afflictions>(rig.player).noHealUntilMillis = rig.now + 10000.0;
    rig.setFlags(net::InputAttack);
    rig.tick(60);

    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 50.0, 1e-9);
    // The rose is still in orbit: gardn refuses the CHARGE, so the petal is
    // not spent on a heal that would land nothing and is still there when the
    // lockout lapses.
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));

    // And once it lapses, both come back.
    rig.world.get<Afflictions>(rig.player).noHealUntilMillis = 0.0;
    CHECK(rig.tickUntil([&] { return rig.world.get<Health>(rig.player).current > 55.0; }, 200));
}

TEST(a_shell_homes_grants_one_temporary_shield_and_is_consumed) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "shell");
    rig.settleEquips();
    rig.tick(40);

    const ShieldState& shield = rig.world.get<ShieldState>(rig.player);
    CHECK_NEAR(shield.amount, 22.0, 1e-9);
    CHECK(shield.active(rig.now));
    CHECK(rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
}

// ---------------------------------------------------------------------------
// Mana
// ---------------------------------------------------------------------------

TEST(a_bar_with_no_magic_petal_has_no_mana_pool_at_all) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    rig.tick(20);
    // Not a pool reading zero -- no pool. Every flower in the world would
    // otherwise carry a component that only magic builds ever look at.
    CHECK(rig.world.tryGet<ManaPool>(rig.player) == nullptr);
}

TEST(a_worn_vessel_grants_a_pool_that_arrives_full_and_doubles_per_tier) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.settleEquips();
    rig.tick();
    const ManaPool& pool = rig.world.get<ManaPool>(rig.player);
    CHECK_NEAR(pool.max, 100.0, 1e-9);
    CHECK_NEAR(pool.current, 100.0, 1e-9);

    // Two vessels are two grants: the pool is summed over the bar, unlike the
    // lotus threshold beside it.
    rig.equip(1, "vessel");
    rig.settleEquips();
    rig.tick();
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).max, 200.0, 1e-9);

    // Doubling per tier, all the way up: rare is four times common.
    Rig rare;
    rare.equip(0, "vessel", Rarity::Rare);
    rare.settleEquips();
    rare.tick();
    CHECK_NEAR(rare.world.get<ManaPool>(rare.player).max, 400.0, 1e-9);
    Rig apex;
    apex.equip(0, "vessel", Rarity::Apex);
    apex.settleEquips();
    apex.tick();
    CHECK_NEAR(apex.world.get<ManaPool>(apex.player).max, 100.0 * 512.0, 1e-9);
}

TEST(taking_the_pool_off_spills_the_mana_rather_than_banking_it) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.settleEquips();
    rig.tick();
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 100.0, 1e-9);

    rig.world.get<Loadout>(rig.player).slots[0] = LoadoutSlot{};
    rig.settleEquips();
    rig.tick();
    const ManaPool& empty = rig.world.get<ManaPool>(rig.player);
    CHECK_NEAR(empty.max, 0.0, 1e-9);
    CHECK_NEAR(empty.current, 0.0, 1e-9);

    // And putting it back on is not a refill: the once-ever seeding is what
    // keeps unequip/re-equip from being a free potion.
    rig.equip(0, "vessel");
    rig.settleEquips();
    rig.tick();
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).max, 100.0, 1e-9);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 0.0, 1e-9);
}

TEST(a_magic_leaf_refills_the_pool_per_second_and_stops_at_the_ceiling) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "magicleaf");
    rig.settleEquips();
    rig.tick();
    ManaPool& pool = rig.world.get<ManaPool>(rig.player);
    pool.current = 0.0;

    // Five a second at common, and no faster: the regen is summed per SLOT.
    rig.tick(static_cast<int>(1000.0 / net::kTickMillis));
    CHECK_NEAR(pool.current, 5.0, 0.2);

    // Doubled one tier up, like every other mana figure.
    rig.equip(1, "magicleaf", Rarity::Uncommon);
    rig.settleEquips();
    rig.world.get<ManaPool>(rig.player).current = 0.0;
    rig.tick(static_cast<int>(1000.0 / net::kTickMillis));
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 10.0, 0.4);

    // And it stops at the ceiling rather than banking past it.
    rig.tick(600);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 100.0, 1e-9);
}

TEST(an_orb_charges_homes_and_restores_mana_only_while_the_pool_is_short) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "orb");
    rig.settleEquips();
    rig.tick();
    ManaPool& pool = rig.world.get<ManaPool>(rig.player);
    pool.current = 50.0;

    // Past the orb's 1000ms charge: it flies home on its own, delivers one
    // burst, and enters the normal break cooldown -- the rose's path exactly.
    rig.tick(60);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 60.0, 1e-9);
    CHECK(rig.slot(1).broken);

    // A full pool never calls it home: an orb that spent itself for nothing
    // would be a petal missing from the ring for no gain.
    CHECK(rig.tickUntil([&] { return !rig.slot(1).broken; }));
    rig.world.get<ManaPool>(rig.player).current = 100.0;
    rig.tick(80);
    CHECK(!rig.slot(1).broken);
    CHECK_EQ(rig.petals(1).size(), std::size_t(1));
}

TEST(a_magic_missile_is_paid_for_in_mana_and_stops_firing_when_the_pool_is_dry) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "magicmissile");
    rig.settleEquips();
    rig.tick();
    ManaPool& pool = rig.world.get<ManaPool>(rig.player);
    CHECK_NEAR(pool.current, 100.0, 1e-9);

    rig.setFlags(net::InputAttack);
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) >= 1; }));
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 70.0, 1e-9);

    // Three shots is all 100 mana buys. The fourth is refused, and refused
    // WITHOUT taking what is left: a partial payment would drain the pool for
    // a shot that never flew.
    CHECK(rig.tickUntil([&] { return rig.world.get<ManaPool>(rig.player).current <= 10.0; }, 4000));
    const std::size_t flown = rig.countOf(net::EntityKind::Projectile);
    rig.tick(400);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 10.0, 1e-9);
    CHECK(rig.countOf(net::EntityKind::Projectile) <= flown);
    // And the petal is still in the ring waiting, not spent.
    CHECK(!rig.slot(1).broken);
}

TEST(a_magic_bubble_that_cannot_be_paid_for_does_not_pop) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "magic_bubble");
    rig.settleEquips();
    rig.tick();
    rig.world.get<ManaPool>(rig.player).current = 10.0;

    // The pop is momentum handed to the flower, and this rig steps no
    // movement, so the velocity it is left holding IS the burst.
    rig.setFlags(net::InputDefend);
    rig.setMove(0.0);
    rig.tick(4);
    CHECK_NEAR(rig.velocity(rig.player).length(), 0.0, 1e-9);
    CHECK(!rig.slot(1).broken);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 10.0, 1e-9);

    // Funded, it pops and the mana is gone.
    rig.world.get<ManaPool>(rig.player).current = 100.0;
    rig.tick();
    CHECK(rig.velocity(rig.player).length() > 1.0);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 60.0, 1e-9);
}

TEST(a_magic_bubble_throws_the_flower_the_way_it_is_asking_to_go) {
    if (!contentLoaded()) return;
    // North, whichever side of the ring the petal happens to be orbiting on.
    // A plain bubble's bearing is the ring's; this one's is the player's.
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "magic_bubble");
    rig.settleEquips();
    rig.tick();
    const double heading = -kPi * 0.5;
    rig.setFlags(net::InputDefend);
    rig.setMove(heading);
    rig.tick();

    // Measured as the impulse the burst handed the flower, not as ground
    // covered: the pop is spent over the following half second by the movement
    // this rig deliberately does not run.
    const Vec2 thrown = rig.velocity(rig.player);
    CHECK(thrown.lengthSq() > 0.0);
    CHECK_NEAR(angularGap(thrown.angle(), heading), 0.0, 1e-9);

    // An analogue stick barely pushed dashes just as far, and in the same
    // direction: the bearing is read, the strength is not. On a rig of its own
    // so the measurement is not taken off a flower still gliding from the
    // first dash.
    Rig nudged;
    nudged.equip(0, "vessel");
    nudged.equip(1, "magic_bubble");
    nudged.settleEquips();
    nudged.tick();
    nudged.setFlags(net::InputDefend);
    nudged.setMove(heading, 0.05);
    nudged.tick();
    const Vec2 nudge = nudged.velocity(nudged.player);
    CHECK_NEAR(nudge.length(), thrown.length(), 1e-9);
    CHECK_NEAR(angularGap(nudge.angle(), heading), 0.0, 1e-9);
}

TEST(a_magic_bubble_with_no_direction_asked_for_is_held_not_spent) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "vessel");
    rig.equip(1, "magic_bubble");
    rig.settleEquips();
    rig.tick();

    // Defend held, nothing asked for: the petal stays in the ring at full
    // charge and its mana is untouched.
    rig.setFlags(net::InputDefend);
    rig.setMove(0.0, 0.0);
    rig.tick(20);
    CHECK_NEAR(rig.velocity(rig.player).length(), 0.0, 1e-9);
    CHECK(!rig.slot(1).broken);
    CHECK_EQ(rig.petals(1).size(), std::size_t(1));
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 100.0, 1e-9);

    // And it goes the instant a key is pressed.
    rig.setMove(kPi);
    rig.tick();
    CHECK(rig.velocity(rig.player).length() > 1.0);
    CHECK_NEAR(rig.world.get<ManaPool>(rig.player).current, 60.0, 1e-9);
}


TEST(a_ring_of_bubbles_stacks_into_one_pop_instead_of_cancelling) {
    if (!contentLoaded()) return;
    // Every bubble shoves the flower clear of ITSELF, so bearings read off one
    // standing centre cancel on a symmetric ring and a ring of bubbles would
    // do nothing at all. They chain instead: each pop is aimed from where the
    // ones before it have already thrown the flower.
    const auto reachOf = [](int bubbles) {
        Rig rig;
        rig.withMovement();
        for (int i = 0; i < bubbles; ++i) rig.equip(i, "bubble");
        rig.settleEquips();
        const Vec2 before = rig.position(rig.player);
        rig.setFlags(net::InputDefend);
        rig.tick();
        rig.setFlags(0);
        rig.tick(90);
        return distance(before, rig.position(rig.player));
    };
    const double one = reachOf(1);
    CHECK_NEAR(one, 60.0, 1.0);
    CHECK_NEAR(reachOf(2), one * 2.0, 2.0);
    CHECK_NEAR(reachOf(4), one * 4.0, 4.0);
}

TEST(a_stacked_bubble_pop_never_outruns_what_a_tick_can_carry) {
    if (!contentLoaded()) return;
    // A whole ring of the best bubbles asks for more ground in a tick than
    // stepCollide will carry -- it truncates the rest, and the client snaps
    // rather than eases a flower that jumped that far. The cap is what keeps
    // the stack a launch instead of a jump cut.
    Rig rig;
    rig.withMovement();
    for (int i = 0; i < kLoadoutActiveSlots; ++i) rig.equip(i, "bubble", Rarity::Apex);
    rig.settleEquips();
    rig.setFlags(net::InputDefend);
    rig.tick();
    // The petal's cap, written from the same movement constants it is written
    // from: the floor of the per-tick substep budget.
    const double budget = kMinSubstepLength * kMaxSubstepCount;
    CHECK(rig.velocity(rig.player).length() <= budget / net::kTickSeconds + 1e-6);

    rig.setFlags(0);
    Vec2 at = rig.position(rig.player);
    double moved = 0.0;
    for (int t = 0; t < 90; ++t) {
        rig.tick();
        const Vec2 now = rig.position(rig.player);
        const double step = distance(at, now);
        CHECK(step <= budget + 1e-6);
        moved += step;
        at = now;
    }
    // And it is a real launch, not a cap that swallowed the pop.
    CHECK(moved > 500.0);
}

TEST(defending_pops_a_bubble_and_pushes_the_flower) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.withMovement();
    rig.equip(0, "bubble");
    rig.settleEquips();
    const Vec2 before = rig.position(rig.player);
    rig.setFlags(net::InputDefend);
    // The pop is MOMENTUM, not a jump. The ring is stepped after movement, so
    // the tick it goes off hands the flower a velocity and moves it nowhere;
    // the reach is spent over the half second friction takes to eat that.
    rig.tick();
    CHECK(rig.velocity(rig.player).length() > 0.0);

    rig.setFlags(0);
    rig.tick();
    const double firstStep = distance(before, rig.position(rig.player));
    CHECK(firstStep > 0.0);
    CHECK(firstStep < 60.0 * 0.4);
    // Spent, and off the ring, the same tick the reference spends it.
    CHECK(rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));

    // The whole pop arrives, and the flower comes to rest rather than coasting.
    rig.tick(60);
    CHECK_NEAR(distance(before, rig.position(rig.player)), 60.0, 1.0);
    CHECK_NEAR(rig.velocity(rig.player).length(), 0.0, 0.01);
}

TEST(a_bubble_pop_never_covers_its_reach_in_one_tick) {
    if (!contentLoaded()) return;
    // The glide is the point, so it is asserted as a shape and not just as a
    // total: every tick moves the flower less than the one before it, and no
    // single tick is the whole pop.
    Rig rig;
    rig.withMovement();
    rig.equip(0, "bubble");
    rig.settleEquips();
    rig.setFlags(net::InputDefend);
    rig.tick();
    rig.setFlags(0);

    double previous = std::numeric_limits<double>::infinity();
    int moving = 0;
    Vec2 at = rig.position(rig.player);
    for (int i = 0; i < 20; ++i) {
        rig.tick();
        const Vec2 now = rig.position(rig.player);
        const double step = distance(at, now);
        at = now;
        if (step < 0.05) break;
        CHECK(step < previous);
        previous = step;
        ++moving;
    }
    // Half a second of travel at 30 Hz, give or take: a handful of ticks is a
    // teleport with a tail, not a launch.
    CHECK(moving >= 8);
}

TEST(attacking_throws_one_web_and_consumes_its_petal) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "web");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    rig.setFlags(net::InputAttack);
    rig.tick();
    const Entity spentWeb = rig.petals(0).front();
    const double bearing = rig.angleOf(spentWeb);

    Query<GroundEffect, Transform, Lifetime> fields{rig.world};
    CHECK_EQ(fields.count(), std::size_t(1));
    fields.each([&](Entity, GroundEffect& field, Transform& transform, Lifetime& lifetime) {
        CHECK_EQ(field.kind, GroundEffectKind::Web);
        CHECK_NEAR(field.radius, 90.0, 1e-9);
        CHECK_NEAR(field.slowFactor, 0.5, 1e-12);
        CHECK_NEAR(lifetime.remainingSeconds, 10.0, 1e-12);
        CHECK_NEAR(angularGap((transform.position - rig.position(rig.player)).angle(), bearing),
                   0.0, 1e-6);
        CHECK_NEAR(distance(transform.position, rig.position(rig.player)),
                   rig.radiusOf(spentWeb) + 620.0, 1e-6);
    });
    CHECK(rig.world.has<Dead>(spentWeb));
    rig.tick();
    CHECK(rig.slot(0).broken);
}

TEST(defending_drops_pollen_with_discrete_damage_and_consumes_it) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "pollen", Rarity::Rare);
    rig.settleEquips();
    rig.setFlags(net::InputDefend);
    rig.tick();

    Query<GroundEffect, Lifetime> fields{rig.world};
    // Rare pollen has two independently-consumed instances.
    CHECK_EQ(fields.count(), std::size_t(2));
    fields.each([&](Entity, GroundEffect& field, Lifetime& lifetime) {
        CHECK_EQ(field.kind, GroundEffectKind::Poison);
        CHECK_NEAR(field.damagePerHit, 10.0 * petalStatScale(Rarity::Rare), 1e-9);
        CHECK_NEAR(field.damageIntervalMillis, 500.0, 1e-9);
        CHECK_NEAR(lifetime.remainingSeconds, 5.0, 1e-12);
    });
    CHECK(rig.world.has<Dead>(rig.petals(0).front()));
}

TEST(a_burst_heal_never_overshoots_the_health_bar) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.settleEquips();
    rig.world.get<Health>(rig.player).current = 105.0;
    rig.setFlags(net::InputDefend);
    rig.tick(60);
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 110.0, 1e-9);
}

TEST(a_projectile_petal_fires_its_fan_and_respects_its_cooldown) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peas");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    rig.tick(40);
    // Projectile timers do not advance while the ring is not attacking.
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(0));

    rig.setFlags(net::InputAttack);
    rig.tick();
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));
    const double nextShotAt =
        rig.world.get<PetalInstance>(rig.petals(0).front()).nextProjectileMillis;
    CHECK_NEAR(nextShotAt, rig.now + 1000.0, 1e-9);

    const double petalHeading = rig.angleOf(rig.petals(0).front());
    std::vector<double> offsets;
    Query<ProjectileTag, Motion, Projectile> shots{rig.world};
    shots.each([&](Entity, ProjectileTag&, Motion& motion, Projectile& projectile) {
        offsets.push_back(wrapAngle(motion.velocity.angle() - petalHeading));
        CHECK_NEAR(motion.velocity.length(), 800.0, 1e-6);
        CHECK_NEAR(projectile.damage, 6.0, 1e-9);
        CHECK_NEAR(projectile.remainingDistance, 1000.0, 1e-9);
        CHECK(projectile.creditTo == rig.player);
        CHECK(projectile.owner == rig.player);
    });
    CHECK_EQ(offsets.size(), std::size_t(3));
    std::sort(offsets.begin(), offsets.end());
    // spreadAngle is the STEP between adjacent shots, and the fan is centred
    // on the petal's outward heading.
    CHECK_NEAR(offsets[0], -0.5, 1e-6);
    CHECK_NEAR(offsets[1], 0.0, 1e-6);
    CHECK_NEAR(offsets[2], 0.5, 1e-6);

    // No second volley until the cooldown is up, then exactly three more.
    rig.tick(20);
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) > 3; }));
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(6));
}

TEST(each_grain_of_a_clump_fires_along_its_own_facing) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peaclump");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    rig.setFlags(net::InputAttack);
    rig.tick();

    // Four grains on one ring place, so the volley is four shots -- and the
    // point of the test is that they leave in four DIFFERENT directions,
    // spaced a quarter turn apart around the clump, rather than stacking on
    // the slot's shared bearing.
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(4));
    const double slotBearing = rig.world.get<Transform>(rig.petals(0).front()).angle;
    std::vector<double> offsets;
    Query<ProjectileTag, Motion> shots{rig.world};
    shots.each([&](Entity, ProjectileTag&, Motion& motion) {
        offsets.push_back(wrapAngle(motion.velocity.angle() - slotBearing));
    });
    CHECK_EQ(offsets.size(), std::size_t(4));
    std::sort(offsets.begin(), offsets.end());
    CHECK_NEAR(offsets[0], -kTau * 0.25, 1e-6);
    CHECK_NEAR(offsets[1], 0.0, 1e-6);
    CHECK_NEAR(offsets[2], kTau * 0.25, 1e-6);
    CHECK_NEAR(std::abs(offsets[3]), kTau * 0.5, 1e-6);
}

TEST(firing_a_volley_spends_the_petal_and_pays_its_reload) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peas");
    rig.settleEquips();
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));

    rig.setFlags(net::InputAttack);
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 3; }));

    // The shot IS the petal leaving the ring: the instance that fired is spent,
    // and the slot serves the reload a mob-killed petal would have served.
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    CHECK(rig.slot(0).broken);

    // Attack is still held, so the reload -- not the shot timer -- is what
    // paces the volleys: the slot comes back and spends itself again.
    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }, 400));
    CHECK(rig.tickUntil([&] { return rig.slot(0).broken; }, 400));
}

TEST(each_grain_of_a_clump_is_spent_by_its_own_shot) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peaclump");
    rig.settleEquips();
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));

    rig.setFlags(net::InputAttack);
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 4; }));
    rig.tick();
    // Four grains, four shots, four spent grains -- each on its own per-instance
    // timer rather than on a slot-wide one.
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    // They serve that timer: a grain does not come straight back into another
    // volley the tick after it fired.
    rig.tick(10);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(4));
    CHECK(rig.tickUntil([&] { return rig.petals(0).size() == 4; }, 400));
}

TEST(a_projectile_petal_with_no_health_pool_still_pays_its_reload) {
    if (!contentLoaded()) return;
    Rig rig;
    // An unbreakable emitter has no break path to fall through, so its reload
    // is stamped by the shot itself. Without that it would be respawned into
    // another volley on the very next tick.
    rig.equip(0, "emitter");
    rig.settleEquips();
    rig.setFlags(net::InputAttack);
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 2; }));

    // Nothing else would take an unbreakable petal off the ring, so the shot
    // marks it Dead -- which the server reaps at the end of this tick, as it
    // does the spent web above -- and stamps the slot itself.
    const std::vector<Entity> spent = rig.petals(0);
    CHECK_EQ(spent.size(), std::size_t(1));
    CHECK(rig.world.has<Dead>(spent.front()));
    CHECK(rig.slot(0).broken);

    // Ten more ticks of held attack, and still exactly the one volley: without
    // the stamp the slot would respawn straight into the next one.
    rig.tick(10);
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(2));
}

TEST(a_projectile_petal_that_breaks_stops_firing) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peas");
    rig.setFlags(net::InputAttack);
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 3; }));
    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    rig.tick(20);
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));
}

TEST(summons_outlive_the_egg_that_broke_under_them) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "summoner");
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));

    Query<Pet> pets{rig.world};
    std::vector<Entity> summoned = pets.collect();
    CHECK_EQ(summoned.size(), std::size_t(2));
    for (const Entity pet : summoned) {
        CHECK(rig.world.get<Pet>(pet).owner == rig.player);
        CHECK_EQ(int(rig.world.get<Pet>(pet).slot), 0);
        CHECK(rig.world.has<MobTag>(pet));
        // Fights for the player, and is worth nothing to whoever kills it.
        CHECK(rig.world.get<Faction>(pet).team == Team::Players);
        CHECK(!rig.world.has<Bounty>(pet));
    }

    // No runaway summoning: the cap holds tick after tick.
    rig.tick(100);
    CHECK_EQ(rig.petCount(), std::size_t(2));

    rig.damage(rig.petals(0).front(), 4.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    // The squad STAYS. Over there a pet is despawned only when the slot's
    // petal actually changes, when a duplicate replaces it, or when it drifts
    // off its owner's screen -- never by the egg breaking in combat -- and the
    // reload then finds the pets still out and hatches nothing.
    CHECK_EQ(rig.petCount(), std::size_t(2));
    // Not killed either: no corpse is left for the reaper to award.
    Query<Dead> dead{rig.world};
    CHECK_EQ(dead.count(), std::size_t(0));

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    rig.tick(5);
    CHECK_EQ(rig.petCount(), std::size_t(2));
}

TEST(a_pet_killed_in_the_field_is_resummoned) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "summoner");
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));

    Query<Pet> pets{rig.world};
    const Entity victim = pets.collect().front();
    rig.world.destroy(victim);
    CHECK_EQ(rig.petCount(), std::size_t(1));

    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));
}

TEST(unequipping_a_summoner_recalls_its_pets) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "summoner");
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));
    rig.unequip(0);
    rig.tick();
    CHECK_EQ(rig.petCount(), std::size_t(0));
}

TEST(a_pet_is_smaller_than_the_wild_mob_of_its_tier) {
    if (!contentLoaded()) return;
    const ContentRegistry& content = fixture().registry;
    const std::uint16_t critter = content.mobIndex("critter");
    // The pet ramp: the wild size at common, two thirds of it by unique.
    for (const Rarity rarity : {Rarity::Common, Rarity::Unique}) {
        Rig rig;
        rig.equip(0, "summoner", rarity);
        CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));
        const double wild = content.mobStats(critter, rarity).radius;
        const double expected = rarity == Rarity::Common ? wild : wild * 2.0 / 3.0;
        Query<Pet> pets{rig.world};
        for (const Entity pet : pets.collect()) {
            CHECK_NEAR(rig.world.get<Body>(pet).radius, expected, 1e-9);
        }
    }
}

TEST(a_pet_climbs_the_petal_ladder_not_the_mob_one) {
    if (!contentLoaded()) return;
    const ContentRegistry& content = fixture().registry;
    const std::uint16_t critter = content.mobIndex("critter");
    const MobConfig& config = content.mob(critter);
    // The egg's tier is the pet's tier, and a tier of egg is worth what a tier
    // of any other petal is: 3x, health and damage alike. Unique is the top a
    // pet reaches, and where the wild ladder is furthest from it.
    for (const Rarity rarity : {Rarity::Common, Rarity::Rare, Rarity::Unique}) {
        Rig rig;
        rig.equip(0, "summoner", rarity);
        CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));
        const double ladder = petalStatScale(rarity);
        Query<Pet> pets{rig.world};
        for (const Entity pet : pets.collect()) {
            const Health& health = rig.world.get<Health>(pet);
            CHECK_NEAR(health.max, config.health * ladder, 1e-9);
            CHECK_NEAR(health.current, health.max, 1e-9);
            CHECK_NEAR(rig.world.get<ContactDamage>(pet).amount, config.damage * ladder, 1e-9);
        }
    }
    // What the pet used to inherit, and what it no longer does: a unique
    // critter in the wild has far more health than the petal ladder gives.
    CHECK(content.mobStats(critter, Rarity::Unique).health >
          config.health * petalStatScale(Rarity::Unique) * 100.0);
}

TEST(the_pet_health_talent_multiplies_pets_and_nothing_else) {
    if (!contentLoaded()) return;
    const MobConfig& critter = fixture().registry.mob(fixture().registry.mobIndex("critter"));
    const Rarity tier = Rarity::Legendary;
    const double talent = kHealthSkillScale[static_cast<std::size_t>(rarityIndex(tier))];

    Rig rig;
    rig.world.add<PlayerSkillTree>(rig.player);
    rig.world.get<PlayerSkillTree>(rig.player).skills.set(SkillId::PetHealth, rarityIndex(tier));
    rig.equip(0, "summoner");
    rig.equip(1, "basic");
    rig.settleEquips();
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));

    Query<Pet> pets{rig.world};
    for (const Entity pet : pets.collect()) {
        // The pool grows on the Petal Health talent's own table...
        CHECK_NEAR(rig.world.get<Health>(pet).max, critter.health * talent, 1e-9);
        // ...and it is health alone: what the pet hits for is untouched.
        CHECK_NEAR(rig.world.get<ContactDamage>(pet).amount, critter.damage, 1e-9);
    }
    // The ring does not share in it. A basic petal is worth its own 10.
    const std::vector<Entity> basic = rig.petals(1);
    CHECK_EQ(basic.size(), std::size_t(1));
    if (!basic.empty()) CHECK_NEAR(rig.world.get<Health>(basic.front()).max, 10.0, 1e-9);
    // Nor does the flower.
    CHECK_NEAR(rig.world.get<Health>(rig.player).max, maxHealthForLevel(1), 1e-9);
}

TEST(both_health_talents_grant_what_their_tooltip_quotes) {
    if (!contentLoaded()) return;
    const MobConfig& critter = fixture().registry.mob(fixture().registry.mobIndex("critter"));
    // Apex on both branches is 450%, on the ring and on the squad alike: the
    // server reads the very table the talent tooltip prints.
    Rig rig;
    rig.world.add<PlayerSkillTree>(rig.player);
    SkillSet& skills = rig.world.get<PlayerSkillTree>(rig.player).skills;
    skills.set(SkillId::PetalHealth, rarityIndex(Rarity::Apex));
    skills.set(SkillId::PetHealth, rarityIndex(Rarity::Apex));
    rig.equip(0, "summoner");
    rig.equip(1, "basic");
    rig.settleEquips();
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));

    const std::vector<Entity> basic = rig.petals(1);
    CHECK_EQ(basic.size(), std::size_t(1));
    if (!basic.empty()) CHECK_NEAR(rig.world.get<Health>(basic.front()).max, 45.0, 1e-9);
    Query<Pet> pets{rig.world};
    for (const Entity pet : pets.collect()) {
        CHECK_NEAR(rig.world.get<Health>(pet).max, critter.health * 4.5, 1e-9);
    }
}

TEST(a_petal_health_pool_is_rounded_to_a_whole_number) {
    if (!contentLoaded()) return;
    // Cotton's 2 under the epic tier's 135% is 2.7, and the petal gets 3.
    Rig rig;
    rig.world.add<PlayerSkillTree>(rig.player);
    rig.world.get<PlayerSkillTree>(rig.player)
        .skills.set(SkillId::PetalHealth, rarityIndex(Rarity::Epic));
    rig.equip(0, "cotton");
    rig.settleEquips();
    const std::vector<Entity> cotton = rig.petals(0);
    CHECK_EQ(cotton.size(), std::size_t(1));
    if (!cotton.empty()) CHECK_NEAR(rig.world.get<Health>(cotton.front()).max, 3.0, 1e-9);
}

TEST(the_petal_health_talent_leaves_pets_alone) {
    if (!contentLoaded()) return;
    const MobConfig& critter = fixture().registry.mob(fixture().registry.mobIndex("critter"));
    Rig rig;
    rig.world.add<PlayerSkillTree>(rig.player);
    rig.world.get<PlayerSkillTree>(rig.player)
        .skills.set(SkillId::PetalHealth, rarityIndex(Rarity::Apex));
    rig.equip(0, "summoner");
    CHECK(rig.tickUntil([&] { return rig.petCount() == 2; }));
    Query<Pet> pets{rig.world};
    for (const Entity pet : pets.collect()) {
        CHECK_NEAR(rig.world.get<Health>(pet).max, critter.health, 1e-9);
    }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

TEST(spawned_entities_take_net_ids_when_an_allocator_is_installed) {
    if (!contentLoaded()) return;
    Rig rig;
    std::uint32_t counter = 0;
    rig.system.allocateNetId = [&counter] { return ++counter; };
    rig.equip(0, "peas");
    rig.settleEquips();
    rig.setFlags(net::InputAttack);
    rig.tick();

    const Entity petal = rig.petals(0).front();
    CHECK(rig.world.has<NetId>(petal));
    CHECK_EQ(rig.world.get<NetId>(petal).value, std::uint32_t(1));
    CHECK_EQ(rig.world.get<Replicated>(petal).kind, net::EntityKind::Petal);
    CHECK_EQ(rig.world.get<Replicated>(petal).typeIndex, petalId("peas"));

    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 3; }));
    Query<ProjectileTag, NetId> shots{rig.world};
    CHECK_EQ(shots.count(), std::size_t(3));
    CHECK_EQ(counter, std::uint32_t(4));
}

TEST(petals_carry_no_motion_so_movement_cannot_fight_the_ring) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    const Entity petal = rig.petals(0).front();
    CHECK(!rig.world.has<Motion>(petal));
    CHECK(!rig.world.has<Knockback>(petal));
    CHECK(rig.world.has<Body>(petal));
    CHECK(rig.world.has<ContactDamage>(petal));
    CHECK(rig.world.has<HitCooldowns>(petal));
    CHECK(rig.world.get<Faction>(petal).team == Team::Players);
}

TEST(the_ring_follows_the_flower_it_belongs_to) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.world.get<Transform>(rig.player).position = Vec2{5000.0, -2000.0};
    // The ring is sprung to its owner and centred on where that owner was at
    // the end of the LAST tick, so a flower that jumps five thousand units
    // drags its petals after it rather than teleporting them: they arrive over
    // the following ticks.
    rig.tick();
    CHECK(rig.radiusOf(rig.petals(0).front()) > rig.ring().radius * 10.0);
    rig.settleRing();
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), rig.ring().radius, 1e-4);
    CHECK_NEAR(rig.position(rig.petals(0).front()).x - 5000.0,
               std::cos(rig.ring().spin) * rig.ring().radius, 1e-4);
}

TEST(two_players_keep_separate_rings) {
    if (!contentLoaded()) return;
    Rig rig;
    Rig other;   // a second world, to prove nothing here is process-wide state
    rig.equip(0, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    other.equip(0, "sandy");
    other.freezeRing();
    other.settleEquips();
    other.settleRing();
    CHECK_EQ(rig.petals().size(), std::size_t(2));    // basic and the anchor
    CHECK_EQ(other.petals().size(), std::size_t(5));  // four grains and the anchor

    // ...and a second flower in the SAME world.
    const Entity second = rig.world.create();
    rig.world.add<PlayerTag>(second);
    rig.world.add<Transform>(second, Transform{{-500.0, 400.0}, 0.0});
    rig.world.add<Body>(second, Body{kPlayerBaseRadius, 1.0});
    rig.world.add<Health>(second, Health{100.0, 100.0, 0.0, 0.0});
    rig.world.add<Faction>(second, Faction{Team::Players, false});
    rig.world.add<PlayerInput>(second);
    rig.world.add<PlayerModifiers>(second);
    rig.world.add<Loadout>(second);
    rig.world.add<PetalRing>(second);
    rig.world.get<Loadout>(second).slots[0].configIndex = petalId("shards");
    rig.settleRing();

    CHECK_EQ(rig.petals().size(), std::size_t(2));
    Query<PetalInstance> all{rig.world};
    CHECK_EQ(all.count(), std::size_t(5));            // plus the second flower's three shards
    for (const Entity petal : all.collect()) {
        const PetalInstance& instance = rig.world.get<PetalInstance>(petal);
        const Vec2 owner = rig.world.get<Transform>(instance.owner).position;
        // The second flower's ring still turns -- it wears no anchor -- so its
        // shards hold the steady orbit a spring settles into rather than the
        // ring radius exactly.
        const double slack = instance.owner == rig.player ? 1e-6 : 1.0;
        CHECK_NEAR((rig.world.get<Transform>(petal).position - owner).length(),
                   rig.world.get<PetalRing>(instance.owner).radius, slack);
    }
}


// ---------------------------------------------------------------------------
// The fraction the loadout bar drains its tile by
// ---------------------------------------------------------------------------

TEST(a_hurt_petal_reports_a_part_full_slot) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.settleEquips();
    CHECK_NEAR(rig.slotHealth(0), 1.0, 1e-9);

    rig.damage(rig.petals(0).front(), 4.0);
    rig.tick();
    CHECK_NEAR(rig.slotHealth(0), 0.6, 1e-9);

    // A broken slot is empty, not merely low: the tile drains all the way to
    // the plate colour and refills when the reload hands the pool back.
    rig.damage(rig.petals(0).front(), 6.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.slotHealth(0), 0.0, 1e-9);

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_NEAR(rig.slotHealth(0), 1.0, 1e-9);
}

TEST(a_clump_reports_the_share_of_its_grains_still_standing) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sandy");
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));
    CHECK_NEAR(rig.slotHealth(0), 1.0, 1e-9);

    // A grain off the field counts as none of its own health rather than as
    // absent, so three whole grains of four is a tile three quarters full --
    // which is the only reading that makes a half-broken clump legible.
    rig.damage(rig.petalWithSub(0, 0), 12.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(3));
    CHECK_NEAR(rig.slotHealth(0), 0.75, 1e-9);

    // Damage on a surviving grain is its own share of the same total.
    rig.damage(rig.petalWithSub(0, 1), 6.0);
    rig.tick();
    CHECK_NEAR(rig.slotHealth(0), 0.625, 1e-9);
}

TEST(an_unbreakable_petal_never_drains_its_tile) {
    if (!contentLoaded()) return;
    // Rock has no health at all. Reading a pool it does not own would leave its
    // tile permanently empty.
    Rig rig;
    rig.equip(0, "rock");
    rig.settleEquips();
    rig.tick(20);
    CHECK_NEAR(rig.slotHealth(0), 1.0, 1e-9);
}

/// "It comes and goes": gardn's wing is the one petal that does not simply
/// ride the ring out on a swing -- it is thrown a further 120 units past it on
/// a squared sine and pulled back, over and over, for as long as the button is
/// held. Everything about the petal reads as broken without it: the tooltip
/// says nothing else, and a wing that just sits in the ring is a basic.
TEST(a_wing_lunges_past_the_ring_and_comes_back_while_attacking) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "wing");
    // A turning ring makes the spring hold station slightly outside its target
    // point, and this test measures distances against that target. Freezing it
    // takes that steady offset out; the lunge itself is unaffected either way.
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    // At rest it is an ordinary petal. The lunge is gated on the button, not
    // on the petal, so a wing left alone sits on the ring with everything else.
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), rig.ring().radius, 0.5);
    rig.tick(60);
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), rig.ring().radius, 0.5);

    rig.setFlags(net::InputAttack);
    // Long enough for the extension ramp to finish, so every sample below is
    // taken against a ring that has stopped moving and the only thing left
    // travelling is the wing.
    rig.tick(60);
    CHECK_NEAR(rig.ring().radius, kPetalOrbitRestRadius * kPetalOrbitAttackExtension, 1e-6);

    const double ring = rig.ring().radius;
    std::vector<double> reach;
    for (int i = 0; i < 120; ++i) {
        rig.tick();
        reach.push_back(rig.radiusOf(rig.petals(0).front()));
    }

    // The crest is a full lunge past the extended ring and the trough is back
    // on it. The slack is the spring's: it is pulled toward the moving point
    // rather than pinned to it, so it carries a little past the top and a
    // little inside the bottom.
    const double low = *std::min_element(reach.begin(), reach.end());
    const double high = *std::max_element(reach.begin(), reach.end());
    CHECK_NEAR(high, ring + kWingOrbitLungeReach, 5.0);
    CHECK_NEAR(low, ring, 5.0);

    // And it does it REPEATEDLY, on gardn's period: squaring the sine halves
    // it, so one out-and-back is pi / 2.5 = 1.26s rather than 2.5s.
    std::vector<int> crests;
    for (std::size_t i = 1; i + 1 < reach.size(); ++i) {
        if (reach[i] > reach[i - 1] && reach[i] >= reach[i + 1] && reach[i] > ring + 60.0) {
            crests.push_back(static_cast<int>(i));
        }
    }
    CHECK(crests.size() >= 2);
    const double period = (kPi / kWingOrbitLungeRate) / net::kTickSeconds;
    CHECK_NEAR(period, 37.7, 0.1);
    for (std::size_t i = 1; i < crests.size(); ++i) {
        CHECK_NEAR(static_cast<double>(crests[i] - crests[i - 1]), period, 2.0);
    }

    // Letting go brings it home and leaves it there: the lunge is not a
    // wind-down the petal finishes on its own.
    rig.setFlags(0);
    rig.tick(120);
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), rig.ring().radius, 0.5);
}

/// The lunge belongs to the wing alone. Sharing a ring with one must not throw
/// the rest of the loadout around -- it is read per petal, off the config the
/// instance was spawned from.
TEST(only_the_wing_lunges) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "wing");
    rig.equip(1, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    rig.setFlags(net::InputAttack);
    rig.tick(60);

    bool wingMoved = false;
    for (int i = 0; i < 120; ++i) {
        rig.tick();
        const double ring = rig.ring().radius;
        if (rig.radiusOf(rig.petals(0).front()) > ring + 60.0) wingMoved = true;
        CHECK_NEAR(rig.radiusOf(rig.petals(1).front()), ring, 0.5);
    }
    CHECK(wingMoved);
}

// ---------------------------------------------------------------------------
// Pearl: shot out onto the ground while attacking
// ---------------------------------------------------------------------------

namespace {

/// How far a pearl may be from its flower: the stock leash, grown by whatever
/// the body has grown, as the pearl's own placement works it out.
double pearlLeash(Rig& rig) {
    return kPearlMaxDistance + rig.world.get<Body>(rig.player).radius - kPlayerBaseRadius;
}

/// A rig holding attack with its pearl already shot out and at rest.
Entity restingPearl(Rig& rig) {
    rig.equip(0, "pearl");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    rig.setFlags(net::InputAttack);
    rig.tick(90);
    return rig.petals(0).front();
}

} // namespace

/// "Shoots out from orbit": on attack the pearl leaves the ring straight out
/// along its bearing, slides to a stop on the ground well past the extended
/// ring, and stays there for as long as the button is held.
TEST(a_pearl_is_shot_out_and_comes_to_rest_on_the_ground_while_attacking) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "pearl");
    rig.equip(1, "basic");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();

    const Entity pearl = rig.petals(0).front();
    const Entity basic = rig.petals(1).front();
    // At rest it is a petal on the ring like any other.
    const double start = rig.ring().radius;
    CHECK_NEAR(rig.radiusOf(pearl), start, 0.5);
    CHECK(!rig.world.get<PetalInstance>(pearl).thrown);
    const double bearing = rig.angleOf(pearl);

    rig.setFlags(net::InputAttack);
    double previous = rig.radiusOf(pearl);
    for (int i = 0; i < 90; ++i) {
        rig.tick();
        CHECK(rig.world.get<PetalInstance>(pearl).thrown);
        // Straight out and only ever out, and never past the leash.
        const double reach = rig.radiusOf(pearl);
        CHECK(reach >= previous - 1e-9);
        CHECK(reach <= pearlLeash(rig) + 1e-9);
        CHECK(angularGap(rig.angleOf(pearl), bearing) < 0.02);
        previous = reach;
    }
    // It slid its authored distance, which puts it well past the extended ring.
    CHECK_NEAR(previous, start + kPearlLaunchSpeed / kPearlGroundFriction, 1.5);
    CHECK(previous > kPetalOrbitRestRadius * kPetalOrbitAttackExtension + 80.0);
    CHECK(rig.world.get<PetalInstance>(pearl).flightVelocity.lengthSq() == 0.0);

    // At rest means at rest: not creeping, not drifting back.
    const Vec2 landed = rig.position(pearl);
    rig.tick(60);
    CHECK_NEAR(rig.position(pearl).x, landed.x, 1e-9);
    CHECK_NEAR(rig.position(pearl).y, landed.y, 1e-9);
    // The rest of the ring does what it always did.
    CHECK_NEAR(rig.radiusOf(basic), rig.ring().radius, 0.5);

    // Letting go hands it back to the ring -- once the ring has drawn back in
    // to rest, a few ticks later -- and leaves it there.
    rig.setFlags(0);
    const bool home = rig.tickUntil(
        [&] { return !rig.world.get<PetalInstance>(pearl).thrown; }, 10);
    CHECK(home);
    CHECK_NEAR(rig.ring().extension, 1.0, 1e-9);
    rig.tick(120);
    CHECK_NEAR(rig.radiusOf(pearl), rig.ring().radius, 0.5);
}

/// On the ground, not on the flower: a flower moving about inside the leash
/// leaves its pearl exactly where it came to rest.
TEST(a_pearl_stays_where_it_landed_while_its_flower_moves_inside_the_leash) {
    if (!contentLoaded()) return;
    Rig rig;
    const Entity pearl = restingPearl(rig);
    const Vec2 landed = rig.position(pearl);
    const Vec2 toward = (landed - rig.position(rig.player)).normalized();
    const Vec2 across{-toward.y, toward.x};

    for (int i = 0; i < 40; ++i) {
        // Toward it, then sideways: never far enough to pull on the leash.
        rig.world.get<Transform>(rig.player).position += (i < 20 ? toward : across) * 5.0;
        rig.tick();
        CHECK_NEAR(rig.position(pearl).x, landed.x, 1e-9);
        CHECK_NEAR(rig.position(pearl).y, landed.y, 1e-9);
        CHECK(rig.world.get<PetalInstance>(pearl).thrown);
    }
}

/// The leash: a flower walking away drags its pearl along at the maximum
/// distance rather than leaving it behind.
TEST(a_pearl_is_dragged_along_at_its_leash_by_a_flower_walking_away) {
    if (!contentLoaded()) return;
    Rig rig;
    const Entity pearl = restingPearl(rig);
    const Vec2 landed = rig.position(pearl);
    const Vec2 away = (rig.position(rig.player) - landed).normalized();

    // Far enough to go a good way past the leash, whatever it is set to.
    const int ticks = static_cast<int>(std::ceil((pearlLeash(rig) + 300.0) / 12.0));
    for (int i = 0; i < ticks; ++i) {
        rig.world.get<Transform>(rig.player).position += away * 12.0;
        rig.tick();
        CHECK(rig.radiusOf(pearl) <= pearlLeash(rig) + 1e-6);
    }
    // Taut, trailing straight behind, and carried most of the way.
    CHECK_NEAR(rig.radiusOf(pearl), pearlLeash(rig), 1e-6);
    CHECK(angularGap(rig.angleOf(pearl), (-away).angle()) < 1e-6);
    CHECK((rig.position(pearl) - landed).length() > 500.0);

    // Dragged, it still lies where the leash left it once the flower stops.
    const Vec2 stopped = rig.position(pearl);
    rig.tick(30);
    CHECK_NEAR(rig.position(pearl).x, stopped.x, 1e-9);
    CHECK_NEAR(rig.position(pearl).y, stopped.y, 1e-9);
}

/// The pearl goes out and comes in with the ring's EXTENSION, not with the
/// buttons. Attack and defend held together is an extended ring -- attack wins
/// -- so the pearl stays out; the ring drawing in brings it home on the tick
/// the extension is back at rest, not on the tick a button changed.
TEST(a_pearl_follows_the_rings_extension_not_the_buttons) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "pearl");
    rig.freezeRing();
    rig.settleEquips();
    rig.settleRing();
    const Entity pearl = rig.petals(0).front();

    // Out on the first tick the ring reaches past its rest radius.
    rig.setFlags(net::InputAttack);
    rig.tick();
    CHECK(rig.ring().extension > 1.0);
    CHECK(rig.world.get<PetalInstance>(pearl).thrown);
    rig.tick(9);
    CHECK(rig.radiusOf(pearl) > kPetalOrbitRestRadius * kPetalOrbitAttackExtension);

    // Defend on top of attack leaves the ring extended, and the pearl with it.
    rig.setFlags(net::InputAttack | net::InputDefend);
    rig.tick(30);
    CHECK_NEAR(rig.ring().extension, kPetalOrbitAttackExtension, 1e-9);
    CHECK(rig.world.get<PetalInstance>(pearl).thrown);

    // Defend alone draws the ring in over a few ticks; the pearl stays out
    // for exactly as long as the ring is still extended.
    rig.setFlags(net::InputDefend);
    bool extendedAfterRelease = false;
    for (int i = 0; i < 10; ++i) {
        rig.tick();
        const bool extended = rig.ring().extension > 1.0;
        extendedAfterRelease = extendedAfterRelease || extended;
        CHECK(rig.world.get<PetalInstance>(pearl).thrown == extended);
    }
    CHECK(extendedAfterRelease);
    rig.tick(120);
    CHECK(!rig.world.get<PetalInstance>(pearl).thrown);
    CHECK_NEAR(rig.radiusOf(pearl), rig.ring().radius, 0.5);

    // Extending again throws it again.
    rig.setFlags(net::InputAttack);
    rig.tick();
    CHECK(rig.world.get<PetalInstance>(pearl).thrown);
}

// ---------------------------------------------------------------------------
// Bone and cotton, as the ring spawns them
// ---------------------------------------------------------------------------

TEST(a_spawned_bone_wears_its_armor_and_a_spawned_cotton_soaks) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "bone", Rarity::Rare);
    rig.equip(1, "cotton");
    rig.equip(2, "basic");
    rig.settleEquips();

    const Entity bone = rig.petals(0).front();
    const Entity cotton = rig.petals(1).front();
    const Entity basic = rig.petals(2).front();
    // 10 at common, up the mob armour ladder to rare.
    CHECK(rig.world.has<Armor>(bone));
    CHECK_NEAR(rig.world.get<Armor>(bone).amount, 10.0 * kMobArmorScale[2], 1e-9);
    CHECK(!rig.world.has<Armor>(basic));
    CHECK(!rig.world.has<Armor>(cotton));

    CHECK(rig.world.get<PetalInstance>(cotton).soaksOwnerDamage);
    CHECK(!rig.world.get<PetalInstance>(bone).soaksOwnerDamage);
    CHECK(!rig.world.get<PetalInstance>(basic).soaksOwnerDamage);
}
