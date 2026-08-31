#include "test.h"

#include "server/systems/petals.h"

#include <sys/stat.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

using namespace flr;

namespace {

// The ring is driven entirely by content, so these tests run on content of
// their own: a handful of petals chosen to isolate one rule each. Using the
// shipped data instead would tie every assertion to a balance number that is
// allowed to change.

const char* const kPetalsJson = R"JSON({
  "basic":    {"name":"Basic","damage":10,"health":10,"size":2,"cooldown":1200,"count":1,"color":"#90EE90"},
  "sandy":    {"name":"Sandy","damage":4,"health":12,"size":1,"cooldown":800,"count":4,"clumped":true,"color":"#8B0000"},
  "shards":   {"name":"Shards","damage":3,"health":6,"size":1,"cooldown":500,"count":3,"independentHealth":true,"color":"#CCCCCC"},
  "rock":     {"name":"Rock","damage":1,"size":2,"cooldown":1000,"count":1,"color":"#777777"},
  "healer":   {"name":"Healer","damage":1,"health":5,"size":1,"cooldown":3500,"count":1,"burstHeal":10,"burstHealChargeMs":1000,"defendOnly":true,"color":"#FF69B4"},
  "peas":     {"name":"Peas","damage":6,"health":5,"size":1,"cooldown":1000,"count":1,"projectile":{"count":3,"spreadAngle":0.5,"speed":800,"distance":1000},"color":"#00FF00"},
  "lucky":    {"name":"Lucky","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"luck":2,"speed":1.5,"magnetism":50},"color":"#FFD700"},
  "reacher":  {"name":"Reacher","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"range":1.5},"color":"#00FFFF"},
  "inflator": {"name":"Inflator","damage":1,"health":5,"size":1,"cooldown":2000,"count":1,"playerModifiers":{"playerRadius":1.5},"color":"#FF00FF"},
  "summoner": {"name":"Summoner","damage":1,"health":4,"size":1,"cooldown":1000,"count":1,"petMobType":"critter","petMobRarity":"common","petCount":2,"color":"#AA00AA"},
  "toxic":    {"name":"Toxic","damage":2,"health":5,"size":1,"cooldown":1000,"count":1,"poison":0.05,"poisonDuration":3000,"color":"#00AA00"}
})JSON";

const char* const kMobsJson = R"JSON({
  "critter": {"name":"Critter","health":10,"damage":1,"size":1,"speed":1,"range":300,"cooldown":500,"color":"#FF0000","section":[0],"ai_type":"hostile"}
})JSON";

std::string tempDir() {
    const char* env = std::getenv("TMPDIR");
    std::string base = (env != nullptr && *env != '\0') ? env : "/tmp";
    if (base.back() != '/') base.push_back('/');
    base += "flr_petal_tests";
    mkdir(base.c_str(), 0755);   // already there is fine
    return base;
}

bool writeText(const std::string& path, const char* text) {
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
        if (!writeText(mobs, kMobsJson) || !writeText(petals, kPetalsJson)) {
            f.error = "could not write the fixture content into " + dir;
            return f;
        }
        // No XP table: mob XP is irrelevant here and loadFiles tolerates it.
        f.ok = f.registry.loadFiles(mobs, petals, "", f.error);
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
    Entity player = NULL_ENTITY;
    // Deliberately not zero: a timer that was never set reads as 0, and a
    // clock starting there would make that bug look like a working one.
    double now = 1000.0;

    Rig() {
        player = world.create();
        world.add<PlayerTag>(player);
        world.add<Transform>(player, Transform{{1000.0, 1000.0}, 0.0});
        world.add<Motion>(player);
        world.add<Knockback>(player);
        world.add<Body>(player, Body{kPlayerBaseRadius, 1.0});
        world.add<Health>(player, Health{100.0, 100.0, 0.0, 0.0});
        world.add<Faction>(player, Faction{Team::Players, false});
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

    void tick(int count = 1) {
        for (int i = 0; i < count; ++i) {
            now += net::kTickMillis;
            system.run(world, fixture().registry, now, net::kTickSeconds, commands);
            commands.flush();
        }
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

    const LoadoutSlot& slot(int index) const {
        return const_cast<World&>(world).get<Loadout>(player).slots[static_cast<std::size_t>(index)];
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
    rig.tick();

    const std::vector<Entity> petals = rig.petals();
    CHECK_EQ(petals.size(), std::size_t(3));

    // Slots 0, 3 and 7 are the first, second and third occupied slots, so they
    // take thirds of the ring regardless of the empty slots between them.
    const double wedge = kTau / 3.0;
    const double spin = rig.ring().spin;
    for (const Entity petal : petals) {
        const int slot = rig.world.get<PetalInstance>(petal).slot;
        const int ordinal = slot == 0 ? 0 : (slot == 3 ? 1 : 2);
        CHECK_NEAR(angularGap(rig.angleOf(petal), spin + wedge * ordinal), 0.0, 1e-9);
        CHECK_NEAR(rig.radiusOf(petal), rig.ring().radius, 1e-9);
    }
}

TEST(petal_ring_rotates_at_the_spin_rate) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.equip(1, "basic");
    rig.tick();

    const Entity first = rig.petals(0).front();
    const double before = rig.angleOf(first);
    const double spinBefore = rig.ring().spin;

    rig.tick(5);
    const double expected = kPetalSpinRate * net::kTickSeconds * 5.0;
    CHECK_NEAR(angularGap(rig.angleOf(rig.petals(0).front()), before + expected), 0.0, 1e-9);
    CHECK_NEAR(angularGap(rig.ring().spin, spinBefore + expected), 0.0, 1e-9);

    // The gap between the two petals is fixed by the layout: rotation must
    // carry the whole ring, not slide one petal along it.
    CHECK_NEAR(angularGap(rig.angleOf(rig.petals(0).front()), rig.angleOf(rig.petals(1).front())),
               kPi, 1e-9);
}

TEST(attacking_and_defending_move_the_ring_smoothly) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.tick();

    const double rest = kPetalOrbitRestRadius;
    CHECK_NEAR(rest, 60.0, 1e-9);
    CHECK_NEAR(rig.ring().radius, rest, 1e-9);

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
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), attackTarget, 1e-6);

    rig.setFlags(net::InputDefend);
    rig.tick();
    const double defendTarget = kPetalOrbitRestRadius * kPetalOrbitDefendExtension;
    CHECK_NEAR(defendTarget, 42.0, 1e-9);
    CHECK_NEAR(rig.ring().targetRadius, defendTarget, 1e-9);
    CHECK(rig.ring().radius < attackTarget);
    CHECK(rig.ring().radius > defendTarget);
    rig.tick(200);
    CHECK_NEAR(rig.ring().radius, defendTarget, 1e-6);

    // Both buttons at once is a block: defending wins.
    rig.setFlags(net::InputAttack | net::InputDefend);
    rig.tick();
    CHECK_NEAR(rig.ring().targetRadius, defendTarget, 1e-9);
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
    rig.tick();

    const std::vector<Entity> grains = rig.petals(0);
    CHECK_EQ(grains.size(), std::size_t(4));

    // All four hang off the SAME ring position -- that is what clumped means.
    const double reach = rig.ring().radius;
    const Vec2 slotPoint = rig.position(rig.player) + Vec2::fromAngle(rig.ring().spin, reach);
    const double spacing = fixture().registry.petalStats(petalId("sandy"), Rarity::Common).radius * 2.0;

    std::vector<double> subAngles;
    for (const Entity grain : grains) {
        CHECK_NEAR((rig.position(grain) - slotPoint).length(), spacing, 1e-9);
        CHECK_EQ(int(rig.world.get<PetalInstance>(grain).subCount), 4);
        subAngles.push_back((rig.position(grain) - slotPoint).angle());
    }
    // Four distinct directions out of the cluster centre, not four petals piled
    // on the same point.
    std::sort(subAngles.begin(), subAngles.end());
    for (std::size_t i = 1; i < subAngles.size(); ++i) {
        CHECK_NEAR(subAngles[i] - subAngles[i - 1], kTau / 4.0, 1e-9);
    }
}

TEST(an_empty_loadout_places_nothing_and_leaves_modifiers_neutral) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.tick(5);
    CHECK_EQ(rig.petals().size(), std::size_t(0));
    CHECK_NEAR(rig.modifiers().speedScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().luck, 0.0, 1e-12);
    CHECK_NEAR(rig.ring().radius, kPetalOrbitRestRadius, 1e-9);
}

// ---------------------------------------------------------------------------
// Breaking and reloading
// ---------------------------------------------------------------------------

TEST(a_petal_at_zero_health_breaks_and_returns_on_its_cooldown) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.tick();
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
    CHECK_NEAR(rig.now, readyAt, 1e-9);
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    // It comes back whole, not at whatever health it died with.
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 10.0, 1e-9);
}

TEST(partial_damage_does_not_break_a_petal) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.tick();
    rig.damage(rig.petals(0).front(), 9.5);
    rig.tick(20);
    CHECK(!rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    // Damage is kept, not silently healed by the mirror that keeps a cluster
    // in step.
    CHECK_NEAR(rig.healthOf(rig.petals(0).front()), 0.5, 1e-9);
}

TEST(a_clumped_slot_shares_one_health_pool) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "sandy");
    rig.tick();
    for (const Entity grain : rig.petals(0)) CHECK_NEAR(rig.healthOf(grain), 12.0, 1e-9);

    // Hitting one grain costs the whole clump, and every grain shows it.
    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));
    for (const Entity grain : rig.petals(0)) CHECK_NEAR(rig.healthOf(grain), 7.0, 1e-9);

    // Two grains hit in the same tick both count against the pool.
    rig.damage(rig.petals(0)[0], 3.0);
    rig.damage(rig.petals(0)[1], 4.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_EQ(rig.petals(0).size(), std::size_t(4));
    for (const Entity grain : rig.petals(0)) CHECK_NEAR(rig.healthOf(grain), 12.0, 1e-9);
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
    rig.tick();
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
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(2));

    rig.damage(rig.petals(0).front(), 10.0);
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(1));

    // The survivor keeps the half of the ring it already had. Re-spacing the
    // remaining petals would make every break a visible lurch.
    const Entity survivor = rig.petals(1).front();
    CHECK_NEAR(angularGap(rig.angleOf(survivor), rig.ring().spin + kPi), 0.0, 1e-9);
}

TEST(swapping_a_petal_rebuilds_the_slot_from_scratch) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "basic");
    rig.tick();
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
    rig.tick();
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
    rig.tick();
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
    CHECK_NEAR(rig.modifiers().luck, 2.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5, 1e-9);
    CHECK_NEAR(rig.modifiers().magnetism, 50.0, 1e-9);

    // A hundred ticks must not accumulate a hundred bonuses.
    rig.tick(100);
    CHECK_NEAR(rig.modifiers().luck, 2.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5, 1e-9);

    rig.equip(1, "lucky");
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 4.0, 1e-9);
    CHECK_NEAR(rig.modifiers().speedScale, 1.5 * 1.5, 1e-9);
    CHECK_NEAR(rig.modifiers().magnetism, 100.0, 1e-9);

    rig.unequip(0);
    rig.unequip(1);
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 0.0, 1e-12);
    CHECK_NEAR(rig.modifiers().speedScale, 1.0, 1e-12);
    CHECK_NEAR(rig.modifiers().magnetism, kBaseMagnetism, 1e-12);
}

TEST(a_broken_petal_grants_no_modifier_until_it_returns) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "lucky");
    rig.tick();
    CHECK_NEAR(rig.modifiers().luck, 2.0, 1e-9);

    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK(rig.slot(0).broken);
    CHECK_NEAR(rig.modifiers().luck, 0.0, 1e-12);
    CHECK_NEAR(rig.modifiers().speedScale, 1.0, 1e-12);

    CHECK(rig.tickUntil([&] { return !rig.slot(0).broken; }));
    CHECK_NEAR(rig.modifiers().luck, 2.0, 1e-9);
}

TEST(a_clump_pays_its_modifier_once_not_once_per_grain) {
    if (!contentLoaded()) return;
    Rig rig;
    // sandy carries no modifiers, so this checks the slot-vs-instance rule
    // through the one number a four-count petal would inflate: the count of
    // contributions, seen here as the range scale staying neutral.
    rig.equip(0, "sandy");
    rig.equip(1, "reacher");
    rig.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(5));
    CHECK_NEAR(rig.modifiers().rangeScale, 1.5, 1e-9);
}

TEST(rarity_scales_a_petals_published_numbers) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "toxic", Rarity::Rare);
    rig.tick();
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

TEST(a_defend_only_petal_does_nothing_while_attacking) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.world.get<Health>(rig.player).current = 50.0;
    rig.setFlags(net::InputAttack);
    rig.tick(60);   // well past the petal's 1000ms charge

    // The petal is out -- defendOnly gates what it DOES, not whether it exists.
    CHECK_EQ(rig.petals(0).size(), std::size_t(1));
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 50.0, 1e-9);

    rig.setFlags(net::InputDefend);
    rig.tick();
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 60.0, 1e-9);
    // And the charge is spent: it does not heal again on the next tick.
    rig.tick();
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 60.0, 1e-9);

    CHECK(rig.tickUntil([&] { return rig.world.get<Health>(rig.player).current > 60.0; }, 40));
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 70.0, 1e-9);
}

TEST(a_burst_heal_never_overshoots_the_health_bar) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "healer");
    rig.world.get<Health>(rig.player).current = 95.0;
    rig.setFlags(net::InputDefend);
    rig.tick(60);
    CHECK_NEAR(rig.world.get<Health>(rig.player).current, 100.0, 1e-9);
}

TEST(a_projectile_petal_fires_its_fan_and_respects_its_cooldown) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peas");
    rig.tick();
    // A freshly spawned petal waits out a full cooldown, so a reload cannot be
    // turned into an instant volley.
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(0));

    const double firstShotAt = rig.world.get<PetalInstance>(rig.petals(0).front()).nextActionMillis;
    CHECK_NEAR(firstShotAt, rig.now + 1000.0, 1e-9);

    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) > 0; }));
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));

    std::vector<double> headings;
    Query<ProjectileTag, Motion, Projectile> shots{rig.world};
    shots.each([&](Entity, ProjectileTag&, Motion& motion, Projectile& projectile) {
        headings.push_back(motion.velocity.angle());
        CHECK_NEAR(motion.velocity.length(), 800.0, 1e-6);
        CHECK_NEAR(projectile.damage, 6.0, 1e-9);
        CHECK_NEAR(projectile.remainingDistance, 1000.0, 1e-9);
        CHECK(projectile.creditTo == rig.player);
        CHECK(projectile.owner == rig.player);
    });
    CHECK_EQ(headings.size(), std::size_t(3));
    std::sort(headings.begin(), headings.end());
    // spreadAngle is the STEP between adjacent shots, and the fan is centred
    // on the petal's outward heading.
    CHECK_NEAR(headings[1] - headings[0], 0.5, 1e-9);
    CHECK_NEAR(headings[2] - headings[1], 0.5, 1e-9);
    CHECK_NEAR(angularGap(headings[1], rig.angleOf(rig.petals(0).front())), 0.0, 1e-9);

    // No second volley until the cooldown is up, then exactly three more.
    rig.tick(20);
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) > 3; }));
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(6));
}

TEST(a_projectile_petal_that_breaks_stops_firing) {
    if (!contentLoaded()) return;
    Rig rig;
    rig.equip(0, "peas");
    CHECK(rig.tickUntil([&] { return rig.countOf(net::EntityKind::Projectile) == 3; }));
    rig.damage(rig.petals(0).front(), 5.0);
    rig.tick();
    CHECK_EQ(rig.petals(0).size(), std::size_t(0));
    rig.tick(20);
    CHECK_EQ(rig.countOf(net::EntityKind::Projectile), std::size_t(3));
}

TEST(summoned_pets_are_recalled_when_the_petal_breaks) {
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
    CHECK_EQ(rig.petCount(), std::size_t(0));
    // Recalled, not killed: no corpse is left for the reaper to award.
    Query<Dead> dead{rig.world};
    CHECK_EQ(dead.count(), std::size_t(0));
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

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

TEST(spawned_entities_take_net_ids_when_an_allocator_is_installed) {
    if (!contentLoaded()) return;
    Rig rig;
    std::uint32_t counter = 0;
    rig.system.allocateNetId = [&counter] { return ++counter; };
    rig.equip(0, "peas");
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
    rig.tick();
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
    rig.tick();
    rig.world.get<Transform>(rig.player).position = Vec2{5000.0, -2000.0};
    rig.tick();
    CHECK_NEAR(rig.radiusOf(rig.petals(0).front()), rig.ring().radius, 1e-9);
    CHECK_NEAR(rig.position(rig.petals(0).front()).x - 5000.0,
               std::cos(rig.ring().spin) * rig.ring().radius, 1e-9);
}

TEST(two_players_keep_separate_rings) {
    if (!contentLoaded()) return;
    Rig rig;
    Rig other;   // a second world, to prove nothing here is process-wide state
    rig.equip(0, "basic");
    rig.tick(3);
    other.equip(0, "sandy");
    other.tick();
    CHECK_EQ(rig.petals().size(), std::size_t(1));
    CHECK_EQ(other.petals().size(), std::size_t(4));

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
    rig.tick();

    CHECK_EQ(rig.petals().size(), std::size_t(1));
    Query<PetalInstance> all{rig.world};
    CHECK_EQ(all.count(), std::size_t(4));
    for (const Entity petal : all.collect()) {
        const PetalInstance& instance = rig.world.get<PetalInstance>(petal);
        const Vec2 owner = rig.world.get<Transform>(instance.owner).position;
        CHECK_NEAR((rig.world.get<Transform>(petal).position - owner).length(),
                   rig.world.get<PetalRing>(instance.owner).radius, 1e-9);
    }
}
