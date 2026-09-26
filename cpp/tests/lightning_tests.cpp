#include "test.h"

#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/ui/text.h"
#include "client/world_view.h"
#include "server/systems/combat.h"
#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/spatial.h"
#include "shared/net/protocol.h"

#include <sys/stat.h>

#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <map>
#include <string>
#include <vector>
#include "fixture_content.h"

using namespace flix;

namespace {

// The strike's damage is a field the server resolves a tick later; the only
// thing that ever reaches a screen is the Lightning event and the arms the
// renderer builds from it. These render a frame and read the pixels back,
// because "the lightning is invisible" is a claim about pixels and nothing
// short of pixels can refute it.

constexpr int kFrameSize = 400;
/// Where the strike lands. Any point does; a round one keeps the arithmetic in
/// the assertions readable.
constexpr Vec2 kStrikeAt{1000.0, 1000.0};

/// White enough to be a bolt. The ground under it is a flat biome colour and
/// nothing else on an empty frame comes near this, so the threshold only has
/// to separate "painted" from "not painted".
bool isBoltPixel(const std::vector<std::uint8_t>& rgba, std::size_t index) {
    return rgba[index] > 200 && rgba[index + 1] > 200 && rgba[index + 2] > 200;
}

std::size_t boltPixels(const std::vector<std::uint8_t>& rgba) {
    std::size_t count = 0;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        if (isBoltPixel(rgba, i)) ++count;
    }
    return count;
}

/// True when some part of a bolt was painted within `reach` pixels of `screen`.
bool paintedNear(const std::vector<std::uint8_t>& rgba, Vec2 screen, double reach) {
    const int minX = std::max(0, static_cast<int>(screen.x - reach));
    const int maxX = std::min(kFrameSize - 1, static_cast<int>(screen.x + reach));
    const int minY = std::max(0, static_cast<int>(screen.y - reach));
    const int maxY = std::min(kFrameSize - 1, static_cast<int>(screen.y + reach));
    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            const std::size_t index = (static_cast<std::size_t>(y) * kFrameSize + x) * 4;
            if (isBoltPixel(rgba, index)) return true;
        }
    }
    return false;
}

Camera frameCamera() {
    Camera camera;
    camera.setViewport(kFrameSize, kFrameSize);
    camera.userZoom = 1.0;
    camera.snapTo(kStrikeAt);
    return camera;
}

/// One frame of a strike on `targets`, `age` seconds after it landed. No
/// content and no sprites: the ground falls back to its flat biome colour,
/// which is all a white bolt has to stand out against.
std::vector<std::uint8_t> renderStrike(const std::vector<Vec2>& targets, double age) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    const Camera camera = frameCamera();

    WorldView view;
    view.setRealm(Realm::Overworld);
    WorldRenderer renderer;

    if (!targets.empty()) {
        ViewEvent strike;
        strike.kind = net::EventKind::Lightning;
        strike.position = kStrikeAt;
        strike.radius = 1000.0;
        strike.points = targets;
        view.events().push_back(strike);
        renderer.ingestEvents(view);
    }
    renderer.update(age);
    renderer.draw(canvas, view, camera, kStrikeAt, 0.0);
    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

} // namespace

// ---------------------------------------------------------------------------

TEST(a_strike_paints_an_arm_to_every_mob_it_names) {
    const std::vector<Vec2> targets = {
        {kStrikeAt.x + 120.0, kStrikeAt.y},
        {kStrikeAt.x, kStrikeAt.y + 130.0},
        {kStrikeAt.x - 150.0, kStrikeAt.y + 40.0},
    };

    // Nothing white on the bare ground, or the assertions below would be
    // measuring the biome.
    CHECK_EQ(boltPixels(renderStrike({}, 0.0)), std::size_t(0));

    const std::vector<std::uint8_t> frame = renderStrike(targets, 0.0);
    CHECK(boltPixels(frame) > 100);

    // Anchored at BOTH ends of every arm: the jitter displaces the runs
    // between the endpoints and must never move the endpoints themselves, or a
    // strike would draw bolts that start beside the flower and stop beside the
    // mob.
    const Camera camera = frameCamera();
    CHECK(paintedNear(frame, camera.worldToScreen(kStrikeAt), 3.0));
    for (const Vec2& target : targets) {
        CHECK(paintedNear(frame, camera.worldToScreen(target), 3.0));
    }
}

TEST(an_arm_wanders_off_the_straight_line_between_its_ends) {
    // A bolt drawn as a plain segment is a laser, not lightning. Nothing here
    // asserts a particular shape -- the jitter is random by design -- only that
    // some of the arm lies clear of the straight run between its endpoints.
    const Vec2 target{kStrikeAt.x + 180.0, kStrikeAt.y};
    const std::vector<std::uint8_t> frame = renderStrike({target}, 0.0);

    const Camera camera = frameCamera();
    const Vec2 from = camera.worldToScreen(kStrikeAt);
    const Vec2 to = camera.worldToScreen(target);
    const Vec2 along = (to - from).normalized();

    double furthest = 0;
    for (int y = 0; y < kFrameSize; ++y) {
        for (int x = 0; x < kFrameSize; ++x) {
            const std::size_t index = (static_cast<std::size_t>(y) * kFrameSize + x) * 4;
            if (!isBoltPixel(frame, index)) continue;
            const Vec2 offset{x - from.x, y - from.y};
            const double sideways = std::fabs(offset.x * along.y - offset.y * along.x);
            furthest = std::max(furthest, sideways);
        }
    }
    // Half a run's length is the most the reference displaces a midpoint by,
    // and a run is at least 50 units; anything above the stroke's own width is
    // proof the arm is not a segment.
    CHECK(furthest > 4.0);
}

TEST(a_strike_fades_out_instead_of_hanging_on_the_screen) {
    const std::vector<Vec2> targets = {{kStrikeAt.x + 120.0, kStrikeAt.y}};

    // Half its life in it is dimmer, and at the end of it there is nothing
    // left: a bolt that never expires is a permanent white scar across the
    // world, which is the failure mode of drawing one and forgetting it.
    const std::size_t fresh = boltPixels(renderStrike(targets, 0.0));
    const std::size_t half = boltPixels(renderStrike(targets, 0.25));
    const std::size_t gone = boltPixels(renderStrike(targets, 0.5));
    CHECK(fresh > 0);
    CHECK(half < fresh);
    CHECK_EQ(gone, std::size_t(0));
}

// ---------------------------------------------------------------------------
// The colour of the number
// ---------------------------------------------------------------------------

namespace {

/// The ink a frame was painted with, summed per channel over every pixel that
/// is not the bare background.
///
/// Summed rather than sampled because a damage number is small, is stroked in
/// near-black and is anti-aliased against that stroke, so almost every pixel of
/// it is a blend of the fill and the outline and hardly any is the fill
/// exactly. What survives all of it is the RELATION between the channels --
/// cyan has no red in it at any blend -- which is also what a player reads off
/// the screen.
struct Ink {
    double r = 0;
    double g = 0;
    double b = 0;
    std::size_t pixels = 0;
};

Ink inkOf(const std::vector<std::uint8_t>& rgba) {
    Ink ink;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        const int r = rgba[i];
        const int g = rgba[i + 1];
        const int b = rgba[i + 2];
        if (r == 0 && g == 0 && b == 0) continue;   // untouched ground
        ink.r += r;
        ink.g += g;
        ink.b += b;
        ++ink.pixels;
    }
    return ink;
}

/// One frame of a single damage number reported with `flags`, on the tick it
/// arrived. Nothing else is on the screen, so every painted pixel belongs to
/// the number or to its outline.
std::vector<std::uint8_t> renderNumber(std::uint8_t flags) {
    // A number is TEXT, and text needs the font the game ships. Without it the
    // renderer paints nothing at all and every colour assertion below would
    // pass by finding no wrong colour either.
    static const bool fontsReady = [] {
        std::string error;
        const bool ok = ui::Fonts::init(std::string(FLIX_TEST_DATA_DIR), error);
        if (!ok) std::printf("  fonts did not load: %s\n", error.c_str());
        return ok;
    }();
    CHECK(fontsReady);

    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    const Camera camera = frameCamera();

    WorldView view;
    view.setRealm(Realm::Overworld);
    WorldRenderer renderer;

    ViewEvent hit;
    hit.kind = net::EventKind::Damage;
    hit.netId = 7;
    hit.amount = 88.0;
    hit.position = kStrikeAt;
    hit.flag = flags;
    view.events().push_back(hit);
    renderer.ingestEvents(view);

    renderer.update(0.0);
    renderer.draw(canvas, view, camera, kStrikeAt, 0.0);
    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

} // namespace

TEST(a_strikes_number_is_painted_cyan) {
    // #00ffff: no red at all, and green and blue in equal measure. Asserted as
    // a relation rather than as the literal -- see inkOf. This is the number
    // the feature was asked for, so it is stated here rather than imported
    // from the renderer: a constant a test reads out of the code under test
    // cannot catch that code changing it.
    const Ink ink = inkOf(renderNumber(net::DamageLightning));
    CHECK(ink.pixels > 50);
    CHECK(ink.g > 0.0);
    // A trace of red is the outline, which is a near-black grey and so
    // contributes to all three channels alike. A tenth of the green is far
    // below what a red-bearing fill would leave and far above the outline's
    // own share.
    CHECK(ink.r < ink.g * 0.1);
    CHECK(std::fabs(ink.g - ink.b) < ink.g * 0.02);
}

TEST(an_ordinary_hit_and_a_poison_tick_keep_their_own_colours) {
    // The other two channels, so the cyan above is one channel's colour rather
    // than a repaint of every number on the screen.

    // #ff6666: red-dominant, green and blue equal.
    const Ink hit = inkOf(renderNumber(0));
    CHECK(hit.pixels > 50);
    CHECK(hit.r > hit.g * 1.5);
    CHECK(std::fabs(hit.g - hit.b) < hit.g * 0.02);

    // #ce76db: purple -- blue highest, green lowest, and plenty of red, which
    // is the channel a cyan number has none of.
    const Ink poison = inkOf(renderNumber(net::DamagePoison));
    CHECK(poison.pixels > 50);
    CHECK(poison.b > poison.g);
    CHECK(poison.r > poison.g);
    CHECK(poison.r > poison.b * 0.5);
}

// ---------------------------------------------------------------------------
// The server side of a strike
// ---------------------------------------------------------------------------
//
// Everything above is about pixels. Everything below is about who gets hurt,
// which is the other half and the half that content authors tune. Both live in
// this file because a strike that damages nobody and a strike that draws
// nothing fail the same way to a player: "the lightning did not happen".

namespace {

/// The world plus the four things a combat tick needs. Deliberately the same
/// shape combat_tests.cpp uses: a strike is combat, and a second rig for it
/// would be a second set of assumptions about how a tick is assembled.
struct Sim {
    World world;
    SpatialGrid grid;
    CommandBuffer commands{world};
    EventQueue events;
    CombatSystem combat;
    Query<Transform, Body> collidable{world};
    std::uint32_t nextNetId = 1;

    Entity actor(Vec2 at, double radius, double health, Team team) {
        const Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{radius, 1.0});
        world.add<Health>(e, Health{health, health, 0.0, 0.0});
        world.add<Faction>(e, Faction{team, false});
        // Damage is only ever REPORTED for something the client can name, so a
        // test that asserts on the event wire has to give its bodies net ids.
        world.add<NetId>(e, NetId{nextNetId++});
        return e;
    }

    Entity player(Vec2 at) {
        const Entity e = actor(at, 20.0, 500.0, Team::Players);
        world.add<PlayerTag>(e);
        world.add<PlayerProgress>(e);
        return e;
    }

    /// A wild mob of `configIndex`, carrying the body contact its config
    /// states. `radius` is passed rather than derived so a test can put two
    /// bodies a known distance apart without solving for the tier's size.
    Entity mob(Vec2 at, std::uint16_t configIndex, double contactDamage, double radius = 20.0) {
        const Entity e = actor(at, radius, 500.0, Team::Hostiles);
        world.add<MobTag>(e);
        world.add<MobType>(e, MobType{configIndex, Rarity::Common, 1.0});
        world.add<Bounty>(e, Bounty{});
        if (contactDamage > 0.0) world.add<ContactDamage>(e, ContactDamage{contactDamage});
        return e;
    }

    void rebuildGrid() {
        grid.clear();
        collidable.each([&](Entity e, Transform& transform, Body& body) {
            grid.insert(e, Realm::Overworld, transform.position, body.radius);
        });
    }

    /// One whole tick, events cleared first so every assertion reads THIS
    /// tick's wire rather than the sum of every tick a test has run.
    void step(double nowMillis, const ContentRegistry& content) {
        events.clear();
        rebuildGrid();
        combat.run(world, grid, content, nowMillis, net::kTickSeconds, commands, events);
    }

    double health(Entity e) { return world.get<Health>(e).current; }

    /// The strikes reported this tick.
    std::vector<const WireEvent*> bolts() const {
        std::vector<const WireEvent*> out;
        for (const WireEvent& event : events.events()) {
            if (event.kind == net::EventKind::Lightning) out.push_back(&event);
        }
        return out;
    }

    /// Every Damage event this tick that was reported as a strike's.
    std::vector<const WireEvent*> cyanNumbers() const {
        std::vector<const WireEvent*> out;
        for (const WireEvent& event : events.events()) {
            if (event.kind != net::EventKind::Damage) continue;
            if ((event.flag & net::DamageLightning) != 0) out.push_back(&event);
        }
        return out;
    }
};

std::string simTempDir() {
    const char* env = std::getenv("TMPDIR");
    std::string base = (env != nullptr && *env != '\0') ? env : "/tmp";
    if (base.back() != '/') base.push_back('/');
    base += "flix_lightning_tests";
    mkdir(base.c_str(), 0755);
    return base;
}

bool writeFile(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return out.good();
}

/// Hand-written content rather than the shipped tables. These tests assert on
/// exact radii and exact damage, and pinning them to whatever balance
/// mobs.json currently ships would turn a tuning change into a red build. The
/// shipped jellyfish and fireflies get one test of their own, at the bottom,
/// which asserts only the SHAPE of what they declare.
struct SimContent {
    ContentRegistry registry;
    std::string error;
    bool ok = false;
    std::uint16_t shocker = kInvalidIndex;   ///< strikes at range, like a jellyfish
    std::uint16_t toucher = kInvalidIndex;   ///< strikes on contact, like a firefly
    std::uint16_t inert = kInvalidIndex;     ///< no lightning at all
    std::uint16_t pea = kInvalidIndex;
    std::uint16_t berry = kInvalidIndex;   ///< lands its hits as lightning
};

const SimContent& simContent() {
    static const SimContent state = [] {
        SimContent c;
        const std::string mobs = simTempDir() + "/mobs.json";
        const std::string petals = simTempDir() + "/petals.json";
        const bool wrote =
            writeFile(mobs, test::fixtureMobs(R"({
              "shocker":{"name":"Shocker","health":500,"damage":20,"size":1,"speed":0.2,
                         "cooldown":2000,
                         "lightning":{"radius":300}},
              "toucher":{"name":"Toucher","health":500,"damage":30,"size":1,"speed":0.2,
                         "cooldown":0,
                         "lightning":{"radius":250,"onContact":true}},
              "inert":{"name":"Inert","health":500,"damage":30,"size":1,"speed":0.2}
            })")) &&
            writeFile(petals, test::fixturePetals(R"({
              "pea":{"name":"Pea","damage":10,"health":50,"size":1},
              "berry":{"name":"Berry","damage":10,"health":50,"size":1,"lightningDamage":true}
            })"));
        if (!wrote) {
            c.error = "cannot write the fixture content";
            return c;
        }
        c.ok = c.registry.loadFiles(mobs, petals, c.error);
        c.shocker = c.registry.mobIndex("shocker");
        c.toucher = c.registry.mobIndex("toucher");
        c.inert = c.registry.mobIndex("inert");
        c.pea = c.registry.petalIndex("pea");
        c.berry = c.registry.petalIndex("berry");
        return c;
    }();
    return state;
}

/// A petal orbiting `owner` and sitting on top of `at`, for the one case that
/// must NOT discharge anything.
Entity petalAt(Sim& sim, Entity owner, Vec2 at, std::uint16_t configIndex = kInvalidIndex) {
    const Entity e = sim.world.create();
    sim.world.add<Transform>(e, Transform{at, 0.0});
    sim.world.add<Body>(e, Body{10.0, 1.0});
    sim.world.add<Health>(e, Health{50.0, 50.0, 0.0, 0.0});
    const std::uint16_t petal = configIndex != kInvalidIndex ? configIndex : simContent().pea;
    sim.world.add<PetalInstance>(e, PetalInstance{owner, petal, Rarity::Common});
    sim.world.add<NetId>(e, NetId{sim.nextNetId++});
    return e;
}

} // namespace

// --- the config ------------------------------------------------------------

TEST(a_lightning_spec_defaults_its_trigger_to_the_reach_of_the_strike) {
    const SimContent& content = simContent();
    CHECK(content.ok);

    // A mob that states only how far its shock carries strikes at exactly the
    // flowers the shock would reach: one number to author, not two that have
    // to be kept in step.
    const LightningSpec& ranged = content.registry.mob(content.shocker).lightning;
    CHECK(ranged.present);
    CHECK_NEAR(ranged.radius, 300.0, 1e-9);
    CHECK_NEAR(ranged.strikeRange, 300.0, 1e-9);
    CHECK(!ranged.onContact);

    // A mob that has already named its trigger gets no reach thrown in. A
    // firefly that reached 250 units would shock flowers it never touched,
    // which is the opposite of what "on contact" says.
    const LightningSpec& contact = content.registry.mob(content.toucher).lightning;
    CHECK(contact.present);
    CHECK(contact.onContact);
    CHECK_NEAR(contact.strikeRange, 0.0, 1e-9);

    CHECK(!content.registry.mob(content.inert).lightning.present);
}

// --- striking at range -----------------------------------------------------

TEST(a_mob_shocks_a_flower_that_comes_inside_its_radius) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.shocker, 20.0);
    const Entity player = sim.player({200, 0});

    sim.step(10000.0, content.registry);

    // The damage: the mob's own stat, because the spec named no number.
    CHECK_NEAR(sim.health(player), 480.0, 1e-9);

    // The bolt: one strike, thrown from the mob, with an arm ending on the
    // flower it hit.
    const std::vector<const WireEvent*> bolts = sim.bolts();
    CHECK_EQ(bolts.size(), std::size_t(1));
    if (!bolts.empty()) {
        CHECK_NEAR(bolts[0]->position.x, 0.0, 1e-9);
        // The spec's 300 plus the mob's own 20-unit body: a strike is stated
        // against the skin, not the centre.
        CHECK_NEAR(bolts[0]->radius, 320.0, 1e-9);
        CHECK_EQ(bolts[0]->points.size(), std::size_t(1));
        if (!bolts[0]->points.empty()) CHECK_NEAR(bolts[0]->points[0].x, 200.0, 1e-9);
    }
    // And it says it was lightning, which is the whole of what makes the
    // number cyan on the other side.
    const std::vector<const WireEvent*> cyan = sim.cyanNumbers();
    CHECK_EQ(cyan.size(), std::size_t(1));
    if (!cyan.empty()) {
        CHECK_EQ(cyan[0]->netId, sim.world.get<NetId>(player).value);
        CHECK((cyan[0]->flag & net::DamagePoison) == 0);
    }
    CHECK(sim.world.has<LightningClock>(mob));
}

TEST(a_mob_throws_nothing_at_a_flower_outside_its_radius) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.shocker, 20.0);
    const Entity player = sim.player({400, 0});

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(player), 500.0, 1e-9);
    CHECK(sim.bolts().empty());
    // And it is still fully charged, so it strikes on the tick the flower
    // arrives rather than on the tick after that. A cooldown spent on nobody
    // is a mob that appears not to react.
    CHECK(!sim.world.has<LightningClock>(mob));
}

TEST(a_mob_holds_its_charge_between_strikes) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.shocker, 20.0);
    const Entity player = sim.player({200, 0});

    // The spec names no cooldown, so the mob's own `cooldown` of 2000 ms paces
    // it. Health is read rather than the wire because a refused strike and a
    // strike that was never thrown look the same on the wire.
    sim.step(10000.0, content.registry);
    CHECK_NEAR(sim.health(player), 480.0, 1e-9);

    // Far enough past the post-hit window that only the charge can be what is
    // stopping it.
    sim.step(11000.0, content.registry);
    CHECK_NEAR(sim.health(player), 480.0, 1e-9);
    CHECK(sim.bolts().empty());

    sim.step(12000.0, content.registry);
    CHECK_NEAR(sim.health(player), 460.0, 1e-9);
    CHECK_EQ(sim.bolts().size(), std::size_t(1));
}

TEST(a_strike_reaches_every_flower_in_the_disc_and_no_mob_at_all) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.shocker, 20.0);
    const Entity near = sim.player({100, 0});
    const Entity alsoNear = sim.player({0, -280});
    // Outside the 320 the 20-unit body and the 300-unit spec add up to.
    const Entity far = sim.player({0, 400});
    // A second shocker standing in its neighbour's flash. Mobs are not what a
    // mob's strike is aimed at, and a shoal that electrocuted itself would
    // clear the sea the first time a flower swam past.
    const Entity bystander = sim.mob({50, 0}, content.inert, 30.0);

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(near), 480.0, 1e-9);
    CHECK_NEAR(sim.health(alsoNear), 480.0, 1e-9);
    CHECK_NEAR(sim.health(far), 500.0, 1e-9);
    CHECK_NEAR(sim.health(bystander), 500.0, 1e-9);

    const std::vector<const WireEvent*> bolts = sim.bolts();
    CHECK_EQ(bolts.size(), std::size_t(1));
    // One arm per flower hit, and not one for the mob beside it.
    if (!bolts.empty()) CHECK_EQ(bolts[0]->points.size(), std::size_t(2));
}

// --- striking on contact ---------------------------------------------------

TEST(a_contact_striker_shocks_the_flower_it_touches) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.toucher, 30.0, 40.0);
    // Overlapping: 40 + 20 of body against a 50-unit gap.
    const Entity player = sim.player({50, 0});

    sim.step(10000.0, content.registry);

    const std::vector<const WireEvent*> bolts = sim.bolts();
    CHECK_EQ(bolts.size(), std::size_t(1));
    if (!bolts.empty()) {
        // Thrown from the MOB. The bolt lands where the firefly is; the flower
        // is where an arm ENDS.
        CHECK_NEAR(bolts[0]->position.x, 0.0, 1e-9);
        CHECK_EQ(bolts[0]->points.size(), std::size_t(1));
    }
    // The shock, not the bump: both want the same flower on the same tick, the
    // first of them opens the 50 ms window that refuses the second, and a
    // firefly whose shock is eaten by its own bump never shocks anybody.
    CHECK_NEAR(sim.health(player), 470.0, 1e-9);
    CHECK_EQ(sim.cyanNumbers().size(), std::size_t(1));
}

TEST(a_contact_striker_does_not_reach_a_flower_it_is_not_touching) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.toucher, 30.0, 40.0);
    // Well inside the 250-unit strike radius and nowhere near the 60 units of
    // body it would take to touch. `onContact` means what it says.
    const Entity player = sim.player({200, 0});

    sim.step(10000.0, content.registry);

    CHECK(sim.bolts().empty());
    CHECK_NEAR(sim.health(player), 500.0, 1e-9);
}

TEST(a_contact_strike_washes_over_the_flowers_around_the_one_touched) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.toucher, 30.0, 40.0);
    const Entity touching = sim.player({50, 0});
    const Entity nearby = sim.player({0, 200});     // inside the 250 disc
    const Entity away = sim.player({0, 400});       // outside it

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(touching), 470.0, 1e-9);
    CHECK_NEAR(sim.health(nearby), 470.0, 1e-9);
    CHECK_NEAR(sim.health(away), 500.0, 1e-9);
    const std::vector<const WireEvent*> bolts = sim.bolts();
    CHECK_EQ(bolts.size(), std::size_t(1));
    if (!bolts.empty()) CHECK_EQ(bolts[0]->points.size(), std::size_t(2));
}

TEST(a_contact_striker_holds_its_charge_between_strikes) {
    Sim sim;
    const SimContent& content = simContent();
    sim.mob({0, 0}, content.toucher, 30.0, 40.0);
    const Entity player = sim.player({50, 0});
    // Contact SHOVES the flower 25 units clear every tick it lands, so a test
    // that only stepped the clock would be measuring the bump rather than the
    // charge. Walked back in each time, which is what a player holding a
    // direction is doing anyway.
    const auto touching = [&] { sim.world.get<Transform>(player).position = {50, 0}; };

    // The fixture states `cooldown: 0` and no `cooldownMs`, exactly as both
    // fireflies do, so this is the default gap doing the pacing. Without it a
    // flower walking through one would be shocked on all thirty ticks a second.
    sim.step(10000.0, content.registry);
    CHECK_EQ(sim.bolts().size(), std::size_t(1));

    touching();
    sim.step(10000.0 + kDefaultLightningCooldownMillis - 100.0, content.registry);
    CHECK(sim.bolts().empty());

    touching();
    sim.step(10000.0 + kDefaultLightningCooldownMillis, content.registry);
    CHECK_EQ(sim.bolts().size(), std::size_t(1));
}

// --- the case that must not discharge --------------------------------------

TEST(a_contact_striker_throws_nothing_when_a_petal_hits_it) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.toucher, 30.0, 40.0);
    // The flower stands clear; only its ring reaches the mob. This is the
    // ranged loadout's whole case: keep your distance and swat.
    const Entity player = sim.player({600, 0});
    petalAt(sim, player, {30, 0});

    sim.step(10000.0, content.registry);

    // The petal landed...
    CHECK_NEAR(sim.health(mob), 490.0, 1e-9);
    // ...and nothing came back. Being HIT is not a trigger; a firefly is not a
    // thorn.
    CHECK(sim.bolts().empty());
    CHECK(sim.cyanNumbers().empty());
    CHECK_NEAR(sim.health(player), 500.0, 1e-9);
    CHECK(!sim.world.has<LightningClock>(mob));
}

TEST(a_ranged_striker_shocks_on_proximity_even_while_a_petal_is_hitting_it) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.shocker, 20.0);
    const Entity player = sim.player({200, 0});
    petalAt(sim, player, {30, 0});

    sim.step(10000.0, content.registry);

    // The mirror of the test above, and the reason that one is about the
    // TRIGGER rather than about petals: a jellyfish shocks because a flower is
    // near it, and being swatted neither causes that nor prevents it.
    CHECK_NEAR(sim.health(mob), 490.0, 1e-9);
    CHECK_EQ(sim.bolts().size(), std::size_t(1));
    CHECK_NEAR(sim.health(player), 480.0, 1e-9);
}

// --- what the number is painted in -----------------------------------------

TEST(only_a_strike_is_reported_as_lightning) {
    Sim sim;
    const SimContent& content = simContent();
    // An ordinary mob with an ordinary body, overlapping an ordinary flower.
    sim.mob({0, 0}, content.inert, 30.0, 40.0);
    const Entity player = sim.player({50, 0});

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(player), 470.0, 1e-9);
    // The bump hurts exactly as much as the shock in the fixture, and reads
    // completely differently: a flag byte that was set for every hit would
    // paint the whole screen cyan and nobody would notice the strike.
    CHECK(sim.cyanNumbers().empty());
    CHECK(sim.bolts().empty());
}

TEST(a_lightning_damage_petal_hits_as_lightning_and_strikes_nothing_else) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.inert, 0.0);
    const Entity bystander = sim.mob({0, 90}, content.inert, 0.0);
    const Entity player = sim.player({600, 0});
    petalAt(sim, player, {30, 0}, content.berry);

    sim.step(10000.0, content.registry);

    // The blueberry's own hit, and only that: cyan, on the mob it touched.
    CHECK_NEAR(sim.health(mob), 490.0, 1e-9);
    const std::vector<const WireEvent*> cyan = sim.cyanNumbers();
    CHECK_EQ(cyan.size(), std::size_t(1));
    if (!cyan.empty()) CHECK_EQ(cyan[0]->netId, sim.world.get<NetId>(mob).value);
    // No strike: nothing drawn, nobody else hurt.
    CHECK(sim.bolts().empty());
    CHECK_NEAR(sim.health(bystander), 500.0, 1e-9);
}

TEST(a_lightning_damage_petals_shot_hits_as_lightning_and_strikes_nothing_else) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity mob = sim.mob({0, 0}, content.inert, 0.0);
    const Entity bystander = sim.mob({0, 90}, content.inert, 0.0);
    const Entity player = sim.player({600, 0});

    const Entity shot = sim.world.create();
    sim.world.add<ProjectileTag>(shot);
    Projectile projectile;
    projectile.owner = player;
    projectile.creditTo = player;
    projectile.damage = 10.0;
    projectile.remainingDistance = 1000.0;
    projectile.petalConfigIndex = content.berry;
    projectile.lastPosition = {-15, 0};
    sim.world.add<Projectile>(shot, projectile);
    sim.world.add<Transform>(shot, Transform{{-15, 0}, 0.0});
    sim.world.add<Motion>(shot, Motion{{0, 0}});
    sim.world.add<Body>(shot, Body{5.0, 0.1});

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(mob), 490.0, 1e-9);
    const std::vector<const WireEvent*> cyan = sim.cyanNumbers();
    CHECK_EQ(cyan.size(), std::size_t(1));
    if (!cyan.empty()) CHECK_EQ(cyan[0]->netId, sim.world.get<NetId>(mob).value);
    CHECK(sim.bolts().empty());
    CHECK_NEAR(sim.health(bystander), 500.0, 1e-9);
}

TEST(a_lightning_burst_reports_its_chip_as_lightning) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity player = sim.player({0, 0});
    const Entity mob = sim.mob({100, 0}, content.inert, 0.0);

    // A petal's strike leaves behind exactly this: a one-tick damage field,
    // marked. Built by hand rather than by equipping a lightning cutter,
    // because what is under test is the mark -- that the field's chip reaches
    // the wire as a strike and not as a petal hit.
    const Entity burst = sim.world.create();
    sim.world.add<GroundEffectTag>(burst);
    sim.world.add<Transform>(burst, Transform{{100, 0}, 0.0, Realm::Overworld});
    sim.world.add<GroundEffect>(burst, GroundEffect{GroundEffectKind::Poison, player, 150.0, 0.0,
                                                    1.0, Rarity::Common, 25.0, 0.0});
    sim.world.add<Lifetime>(burst, Lifetime{net::kTickSeconds * 1.5});
    sim.world.add<LightningBurst>(burst);

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(mob), 475.0, 1e-9);
    const std::vector<const WireEvent*> cyan = sim.cyanNumbers();
    CHECK_EQ(cyan.size(), std::size_t(1));
    if (!cyan.empty()) CHECK_EQ(cyan[0]->netId, sim.world.get<NetId>(mob).value);
}

TEST(an_unmarked_burst_still_reports_an_ordinary_hit) {
    Sim sim;
    const SimContent& content = simContent();
    const Entity player = sim.player({0, 0});
    const Entity mob = sim.mob({100, 0}, content.inert, 0.0);

    // The same field without the mark: a pollen puff. It has to stay red, or
    // the mark is not doing anything.
    const Entity burst = sim.world.create();
    sim.world.add<GroundEffectTag>(burst);
    sim.world.add<Transform>(burst, Transform{{100, 0}, 0.0, Realm::Overworld});
    sim.world.add<GroundEffect>(burst, GroundEffect{GroundEffectKind::Poison, player, 150.0, 0.0,
                                                    1.0, Rarity::Common, 25.0, 0.0});
    sim.world.add<Lifetime>(burst, Lifetime{net::kTickSeconds * 1.5});

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(mob), 475.0, 1e-9);
    CHECK(sim.cyanNumbers().empty());
}

// --- the shipped data ------------------------------------------------------

TEST(the_shipped_jellyfish_and_fireflies_declare_the_strikes_they_should) {
    ContentRegistry registry;
    std::string error;
    const std::string dir = std::string(FLIX_TEST_DATA_DIR);
    if (!registry.loadFiles(dir + "/mobs.json", dir + "/petals.json", error)) {
        std::printf("  shipped content did not load: %s\n", error.c_str());
        CHECK(false);
        return;
    }

    // Only the SHAPE, never the numbers: the radii are balance and an author
    // must be able to change them without a test going red.
    const LightningSpec& jellyfish = registry.mob(registry.mobIndex("jellyfish")).lightning;
    CHECK(jellyfish.present);
    CHECK(jellyfish.radius > 0.0);
    CHECK(jellyfish.strikeRange > 0.0);   // it reaches out
    CHECK(!jellyfish.onContact);

    for (const char* id : {"firefly", "magic_firefly"}) {
        const std::uint16_t index = registry.mobIndex(id);
        CHECK(index != kInvalidIndex);
        const LightningSpec& bolt = registry.mob(index).lightning;
        CHECK(bolt.present);
        CHECK(bolt.onContact);
        // A firefly shocks what walks into it and nothing else. A reach here
        // would make it a jellyfish.
        CHECK_NEAR(bolt.strikeRange, 0.0, 1e-9);
    }

    // And nothing else in the game throws lightning, so a stray `lightning`
    // block copied onto a mob that should not have one is caught here.
    int throwers = 0;
    for (std::uint16_t i = 0; i < registry.mobCount(); ++i) {
        if (registry.mob(i).lightning.present) ++throwers;
    }
    CHECK_EQ(throwers, 3);
}

// --- the reach grows with the body -----------------------------------------
//
// The bug these exist for: `radius` used to be measured from the mob's CENTRE.
// A mob's body is the one length in the game that already scales with rarity
// -- 1.5x a common's at common, 43x at apex -- so a flat radius is eaten by the
// mob that threw it. From ultra up a flower standing ON a firefly was outside
// its own 250-unit disc, and an ultra jellyfish's 300-unit disc sat entirely
// inside its 315-unit body. Both mobs went completely silent at exactly the
// tiers a player meets them at, while the low tiers kept working -- which is
// what "sometimes I see a blue number" looks like from the outside.

TEST(a_big_mobs_strike_still_reaches_the_flower_touching_it) {
    const SimContent& content = simContent();
    // Every tier of body a mob can roll, including the ones that used to
    // swallow the strike whole. `toucher` states a 250-unit shock, and at each
    // of these the flower stands a whole body radius plus its own away.
    for (const double bodyRadius : {20.0, 180.0, 252.0, 403.0, 644.0, 1031.0}) {
        Sim sim;
        sim.mob({0, 0}, content.toucher, 30.0, bodyRadius);
        const Entity player = sim.player({bodyRadius + 15.0, 0});

        sim.step(10000.0, content.registry);

        const std::vector<const WireEvent*> bolts = sim.bolts();
        CHECK_EQ(bolts.size(), std::size_t(1));
        // And the reported reach clears the body by exactly what was authored,
        // whatever the body is.
        if (!bolts.empty()) CHECK_NEAR(bolts[0]->radius, bodyRadius + 250.0, 1e-9);
        CHECK_NEAR(sim.health(player), 470.0, 1e-9);
    }
}

TEST(a_big_mobs_strike_still_leaves_its_own_body) {
    const SimContent& content = simContent();
    // The ranged half of the same bug. A 400-unit body against a 300-unit
    // shock: from the centre the whole disc is inside the mob and the flower
    // beside it is untouchable.
    Sim sim;
    sim.mob({0, 0}, content.shocker, 20.0, 400.0);
    const Entity touching = sim.player({430, 0});
    const Entity nearby = sim.player({0, 600});      // inside 400 + 300
    const Entity away = sim.player({0, 800});        // outside it

    sim.step(10000.0, content.registry);

    CHECK_NEAR(sim.health(touching), 480.0, 1e-9);
    CHECK_NEAR(sim.health(nearby), 480.0, 1e-9);
    CHECK_NEAR(sim.health(away), 500.0, 1e-9);
    const std::vector<const WireEvent*> bolts = sim.bolts();
    CHECK_EQ(bolts.size(), std::size_t(1));
    if (!bolts.empty()) CHECK_NEAR(bolts[0]->radius, 700.0, 1e-9);
}

TEST(the_trigger_range_clears_the_body_too) {
    const SimContent& content = simContent();
    // The reach and the TRIGGER are two numbers and both are stated against
    // the skin. A 400-unit jellyfish whose trigger was measured from its centre
    // would never notice a flower pressed against it.
    Sim sim;
    sim.mob({0, 0}, content.shocker, 20.0, 400.0);
    const Entity player = sim.player({430, 0});

    sim.step(10000.0, content.registry);
    CHECK_EQ(sim.bolts().size(), std::size_t(1));
    CHECK_NEAR(sim.health(player), 480.0, 1e-9);
}

TEST(the_shipped_mobs_reach_a_flower_touching_them_at_every_tier) {
    // The shipped numbers, walked up the whole ladder. This is the test that
    // would have caught the original bug: it says nothing about how far a
    // strike goes, only that it never stops reaching the flower standing on
    // the mob -- which is the one thing a contact strike must always do.
    ContentRegistry registry;
    std::string error;
    const std::string dir = std::string(FLIX_TEST_DATA_DIR);
    if (!registry.loadFiles(dir + "/mobs.json", dir + "/petals.json", error)) {
        std::printf("  shipped content did not load: %s\n", error.c_str());
        CHECK(false);
        return;
    }

    for (const char* id : {"firefly", "magic_firefly"}) {
        const std::uint16_t index = registry.mobIndex(id);
        CHECK(index != kInvalidIndex);
        for (int tier = 0; tier < kRarityCount; ++tier) {
            const Rarity rarity = clampRarity(tier);
            const MobStats stats = registry.mobStats(index, rarity);

            Sim sim;
            const Entity mob = sim.actor({0, 0}, stats.radius, 1e9, Team::Hostiles);
            sim.world.add<MobTag>(mob);
            sim.world.add<MobType>(mob, MobType{index, rarity, 1.0});
            sim.world.add<Bounty>(mob, Bounty{});
            sim.world.add<ContactDamage>(mob, ContactDamage{stats.damage});
            // Bodies just touching, which is the whole trigger.
            const Entity player = sim.player({stats.radius + 15.0, 0});
            sim.world.get<Health>(player).max = 1e9;
            sim.world.get<Health>(player).current = 1e9;

            sim.step(10000.0, registry);
            if (sim.bolts().size() != std::size_t(1)) {
                std::printf("  %s at tier %d (body %.0f) threw %zu strikes\n", id, tier,
                            stats.radius, sim.bolts().size());
            }
            CHECK_EQ(sim.bolts().size(), std::size_t(1));
            CHECK(sim.health(player) < 1e9);
        }
    }
}
