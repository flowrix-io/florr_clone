#include "test.h"

#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "server/systems/combat.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/spatial.h"
#include "shared/net/protocol.h"

#include <cmath>
#include <string>
#include <vector>
#include "fixture_content.h"
#include "render_rig.h"

using namespace flix;

namespace {

// A glitch petal's hit is rolled on the server and painted green on the client.
// The percentages here are written out rather than read from combat.h: they are
// what was asked for, and a constant a test reads out of the code under test
// cannot catch that code changing it.

constexpr double kPetalDamage = 100.0;
constexpr double kWeakHit = 50.0;     // -50%
constexpr double kStrongHit = 130.0;  // +30%

/// Hand-written, never the shipped tables. `plain` and `glitch_plain` are one
/// petal and its form. `bolt` is there to show a form outranks the cyan of the
/// petal it copied.
struct GlitchContent {
    ContentRegistry registry;
    std::string error;
    bool ok = false;
    std::uint16_t target = kInvalidIndex;
    std::uint16_t plain = kInvalidIndex;
    std::uint16_t glitched = kInvalidIndex;
    std::uint16_t glitchedBolt = kInvalidIndex;
};

const GlitchContent& glitchContent() {
    static const GlitchContent state = [] {
        GlitchContent c;
        c.ok = test::loadFixtureContent(c.registry, testsupport::tempDir("flix_glitch_tests"),
            R"({"target":{"name":"Target","health":500,"damage":0,"size":1,"speed":0.2}})",
            R"({
              "plain":{"name":"Plain","damage":100,"health":50,"size":1},
              "glitch_plain":{"name":"Glitch Plain","damage":100,"health":50,"size":1},
              "bolt":{"name":"Bolt","damage":100,"health":50,"size":1,"lightningDamage":true},
              "glitch_bolt":{"name":"Glitch Bolt","damage":100,"health":50,"size":1,
                             "lightningDamage":true}
            })",
            c.error);
        c.target = c.registry.mobIndex("target");
        c.plain = c.registry.petalIndex("plain");
        c.glitched = c.registry.petalIndex("glitch_plain");
        c.glitchedBolt = c.registry.petalIndex("glitch_bolt");
        return c;
    }();
    return state;
}

/// The world plus the four things a combat tick needs, the shape
/// combat_tests.cpp and lightning_tests.cpp use.
struct Sim {
    World world;
    SpatialGrid grid;
    CommandBuffer commands{world};
    EventQueue events;
    CombatSystem combat;
    Query<Transform, Body> collidable{world};
    std::uint32_t nextNetId = 1;
    double now = 10000.0;

    Entity actor(Vec2 at, double radius, double health, Team team) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{radius, 1.0});
        world.add<Health>(e, Health{health, health, 0.0, 0.0});
        world.add<Faction>(e, Faction{team, false});
        world.add<NetId>(e, NetId{nextNetId++});
        return e;
    }

    Entity player(Vec2 at) {
        const Entity e = actor(at, 20.0, 1e9, Team::Players);
        world.add<PlayerTag>(e);
        world.add<PlayerProgress>(e);
        return e;
    }

    /// Enough health that a long run of hits never kills it.
    Entity mob(Vec2 at) {
        const Entity e = actor(at, 20.0, 1e9, Team::Hostiles);
        world.add<MobTag>(e);
        world.add<MobType>(e, MobType{glitchContent().target, Rarity::Common, 1.0});
        world.add<Bounty>(e, Bounty{});
        return e;
    }

    /// A petal of `owner`'s sitting on `at`, with enough health to outlast a test.
    Entity petal(Entity owner, Vec2 at, std::uint16_t configIndex) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Body>(e, Body{10.0, 1.0});
        world.add<Health>(e, Health{1e9, 1e9, 0.0, 0.0});
        PetalInstance instance;
        instance.owner = owner;
        instance.configIndex = configIndex;
        world.add<PetalInstance>(e, instance);
        world.add<NetId>(e, NetId{nextNetId++});
        return e;
    }

    /// One tick, far enough after the last that no hit window is still shut.
    void step() {
        now += 1000.0;
        events.clear();
        grid.clear();
        collidable.each([&](Entity e, Transform& transform, Body& body) {
            grid.insert(e, Realm::Overworld, transform.position, body.radius);
        });
        combat.run(world, grid, glitchContent().registry, now, net::kTickSeconds, commands, events);
    }

    /// This tick's numbers on `e`.
    std::vector<WireEvent> numbersOn(Entity e) {
        std::vector<WireEvent> out;
        const std::uint32_t id = world.get<NetId>(e).value;
        for (const WireEvent& event : events.events()) {
            if (event.kind == net::EventKind::Damage && event.netId == id) out.push_back(event);
        }
        return out;
    }
};

bool isGreen(const WireEvent& event) { return (event.flag & net::DamageGlitch) != 0; }

/// How many of a run's hits came out at each of the three amounts, and how many
/// came out at anything else, which should be none.
struct Tally {
    int weak = 0;
    int strong = 0;
    int regular = 0;
    int other = 0;

    void add(double amount) {
        if (std::fabs(amount - kWeakHit) < 1e-6) ++weak;
        else if (std::fabs(amount - kStrongHit) < 1e-6) ++strong;
        else if (std::fabs(amount - kPetalDamage) < 1e-6) ++regular;
        else ++other;
    }
    int total() const { return weak + strong + regular + other; }
};

/// Each share within 3 points of its target. The stream is seeded, so a run is
/// the same every time; the band is wide enough to survive a change of seed
/// (it is more than 4 sigma at this many hits) and narrow enough to catch a
/// percentage being wrong.
void checkShares(const Tally& tally) {
    CHECK_EQ(tally.other, 0);
    const double total = tally.total();
    CHECK(total > 0.0);
    CHECK_NEAR(tally.weak / total, 0.25, 0.03);
    CHECK_NEAR(tally.strong / total, 0.40, 0.03);
    CHECK_NEAR(tally.regular / total, 0.35, 0.03);
}

constexpr int kFrameSize = 400;
constexpr Vec2 kHitAt{1000.0, 1000.0};

/// One frame of one number reported with `flags`, and the channels' sums over
/// every pixel painted. Nothing else is on the screen; the outline is a
/// near-black grey that adds to all three alike.
struct Ink {
    double r = 0;
    double g = 0;
    double b = 0;
    std::size_t pixels = 0;
};

Ink renderNumber(std::uint8_t flags) {
    CHECK(testsupport::fontsReady());
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    const Camera camera = testsupport::frameCamera(kFrameSize, kHitAt);
    WorldView view;
    view.setRealm(Realm::Overworld);
    WorldRenderer renderer;

    ViewEvent hit;
    hit.kind = net::EventKind::Damage;
    hit.netId = 7;
    hit.amount = 88.0;
    hit.position = kHitAt;
    hit.flag = flags;
    view.events().push_back(hit);
    renderer.ingestEvents(view);
    renderer.update(0.0);
    renderer.draw(canvas, view, camera, kHitAt, 0.0);

    const std::vector<std::uint8_t> rgba = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    Ink ink;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        if (rgba[i] == 0 && rgba[i + 1] == 0 && rgba[i + 2] == 0) continue;
        ink.r += rgba[i];
        ink.g += rgba[i + 1];
        ink.b += rgba[i + 2];
        ++ink.pixels;
    }
    return ink;
}

} // namespace

TEST(a_glitch_roll_is_25_percent_weak_then_40_percent_strong_then_regular) {
    CHECK_NEAR(glitchDamageScale(0.0), 0.5, 1e-12);
    CHECK_NEAR(glitchDamageScale(0.249), 0.5, 1e-12);
    CHECK_NEAR(glitchDamageScale(0.251), 1.3, 1e-12);
    CHECK_NEAR(glitchDamageScale(0.649), 1.3, 1e-12);
    CHECK_NEAR(glitchDamageScale(0.651), 1.0, 1e-12);
    CHECK_NEAR(glitchDamageScale(0.999), 1.0, 1e-12);
}

TEST(a_glitch_petals_hits_are_green_and_come_at_the_three_rolled_amounts) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity mob = sim.mob({0, 0});
    const Entity player = sim.player({600, 0});
    sim.petal(player, {25, 0}, content.glitched);

    Tally tally;
    for (int i = 0; i < 4000; ++i) {
        const double before = sim.world.get<Health>(mob).current;
        sim.step();
        const std::vector<WireEvent> numbers = sim.numbersOn(mob);
        CHECK_EQ(numbers.size(), std::size_t(1));
        if (numbers.empty()) continue;
        CHECK(isGreen(numbers[0]));
        tally.add(numbers[0].amount);
        // The number is what the bar actually lost, not a repainted label.
        CHECK_NEAR(before - sim.world.get<Health>(mob).current, numbers[0].amount, 1e-6);
    }
    CHECK_EQ(tally.total(), 4000);
    checkShares(tally);
}

TEST(an_ordinary_petals_hits_are_never_green_and_never_rolled) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity mob = sim.mob({0, 0});
    const Entity player = sim.player({600, 0});
    sim.petal(player, {25, 0}, content.plain);

    for (int i = 0; i < 200; ++i) {
        sim.step();
        const std::vector<WireEvent> numbers = sim.numbersOn(mob);
        CHECK_EQ(numbers.size(), std::size_t(1));
        if (numbers.empty()) continue;
        CHECK(!isGreen(numbers[0]));
        CHECK_NEAR(numbers[0].amount, kPetalDamage, 1e-9);
    }
}

TEST(a_glitch_petals_shot_is_rolled_and_green_like_its_body) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity mob = sim.mob({0, 0});
    const Entity player = sim.player({600, 0});

    Tally tally;
    for (int i = 0; i < 4000; ++i) {
        const Entity shot = sim.world.create();
        sim.world.add<ProjectileTag>(shot);
        Projectile projectile;
        projectile.owner = player;
        projectile.creditTo = player;
        projectile.damage = kPetalDamage;
        projectile.remainingDistance = 1000.0;
        projectile.petalConfigIndex = content.glitched;
        projectile.lastPosition = {-15, 0};
        sim.world.add<Projectile>(shot, projectile);
        sim.world.add<Transform>(shot, Transform{{-15, 0}, 0.0});
        sim.world.add<Motion>(shot, Motion{{0, 0}});
        sim.world.add<Body>(shot, Body{5.0, 0.1});

        sim.step();
        const std::vector<WireEvent> numbers = sim.numbersOn(mob);
        CHECK_EQ(numbers.size(), std::size_t(1));
        if (!numbers.empty()) {
            CHECK(isGreen(numbers[0]));
            tally.add(numbers[0].amount);
        }
        sim.world.destroy(shot);
    }
    CHECK_EQ(tally.total(), 4000);
    checkShares(tally);
}

TEST(a_glitch_form_is_green_even_when_it_copied_a_lightning_petal) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity mob = sim.mob({0, 0});
    const Entity player = sim.player({600, 0});
    sim.petal(player, {25, 0}, content.glitchedBolt);

    sim.step();
    const std::vector<WireEvent> numbers = sim.numbersOn(mob);
    CHECK_EQ(numbers.size(), std::size_t(1));
    if (!numbers.empty()) {
        CHECK(isGreen(numbers[0]));
        CHECK((numbers[0].flag & net::DamageLightning) == 0);
    }
}

TEST(a_glitch_petal_hitting_a_duellist_is_rolled_and_green) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity first = sim.player({0, 0});
    const Entity second = sim.player({600, 0});
    sim.world.get<Faction>(first).friendlyFireEnabled = true;
    sim.world.get<Faction>(second).friendlyFireEnabled = true;
    sim.petal(second, {25, 0}, content.glitched);

    Tally tally;
    for (int i = 0; i < 4000; ++i) {
        sim.step();
        const std::vector<WireEvent> numbers = sim.numbersOn(first);
        CHECK_EQ(numbers.size(), std::size_t(1));
        if (numbers.empty()) continue;
        CHECK(isGreen(numbers[0]));
        tally.add(numbers[0].amount);
    }
    CHECK_EQ(tally.total(), 4000);
    checkShares(tally);
}

TEST(a_colony_shares_one_glitch_roll_rather_than_rolling_per_termite) {
    const GlitchContent& content = glitchContent();
    CHECK(content.ok);
    Sim sim;
    const Entity struck = sim.mob({0, 0});
    const Entity left = sim.mob({-60, 0});
    const Entity right = sim.mob({0, 60});
    sim.world.add<ColonyMember>(struck);
    sim.world.add<ColonyMember>(left);
    sim.world.add<ColonyMember>(right);
    const Entity player = sim.player({600, 0});
    // Clear of the other two, so `struck` is the only one this petal touches.
    sim.petal(player, {20, -20}, content.glitched);

    Tally tally;
    for (int i = 0; i < 4000; ++i) {
        sim.step();
        const std::vector<WireEvent> a = sim.numbersOn(struck);
        const std::vector<WireEvent> b = sim.numbersOn(left);
        const std::vector<WireEvent> c = sim.numbersOn(right);
        CHECK_EQ(a.size(), std::size_t(1));
        CHECK_EQ(b.size(), std::size_t(1));
        CHECK_EQ(c.size(), std::size_t(1));
        if (a.empty() || b.empty() || c.empty()) continue;
        // One hit, split evenly: three shares of the same roll, all green.
        CHECK_NEAR(a[0].amount, b[0].amount, 1e-6);
        CHECK_NEAR(a[0].amount, c[0].amount, 1e-6);
        CHECK(isGreen(a[0]));
        CHECK(isGreen(b[0]));
        CHECK(isGreen(c[0]));
        tally.add(a[0].amount + b[0].amount + c[0].amount);
    }
    CHECK_EQ(tally.total(), 4000);
    checkShares(tally);
}

TEST(a_glitch_number_is_painted_green_and_the_others_keep_their_colours) {
    // #00ff00: green is the whole of it. The near-black outline adds a little to
    // all three channels alike, so red and blue stay small rather than at zero.
    const Ink glitch = renderNumber(net::DamageGlitch);
    CHECK(glitch.pixels > 50);
    CHECK(glitch.r < glitch.g * 0.4);
    CHECK(glitch.b < glitch.g * 0.4);

    // Whose hit it was, added per viewer by the replicator, changes nothing.
    const Ink mine = renderNumber(net::DamageGlitch | net::DamageByViewer);
    CHECK(mine.pixels > 50);
    CHECK(mine.r < mine.g * 0.4);

    // An ordinary hit is still red-dominant.
    const Ink hit = renderNumber(0);
    CHECK(hit.pixels > 50);
    CHECK(hit.r > hit.g * 1.5);
}
