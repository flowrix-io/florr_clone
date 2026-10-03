#include "test.h"

#include "server/loot_eligibility.h"
#include "server/squads.h"
#include "server/systems/combat.h"
#include "server/systems/loot.h"
#include "server/systems/spawning.h"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <vector>
#include "fixture_content.h"

using namespace flix;

namespace {

// The test binary runs from wherever ctest puts it, so every content path is
// derived from this source file's own location rather than from the working
// directory. Same trick as config_tests.cpp.
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

const ContentRegistry& shipped() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        std::string error;
        r.loadFiles(firstExisting({testsDir() + "/../../src/mobs.json", "data/mobs.json",
                                   "../src/mobs.json", "../../src/mobs.json", "src/mobs.json"}),
                    firstExisting({testsDir() + "/../../src/petals.json", "data/petals.json",
                                   "../src/petals.json", "../../src/petals.json", "src/petals.json"}),
                    error);
        return r;
    }();
    return registry;
}

std::string tempPath(const char* name) {
    const char* env = std::getenv("TMPDIR");
    std::string base = (env != nullptr && *env != '\0') ? env : "/tmp";
    if (base.back() != '/') base.push_back('/');
    base += "flix_spawning_tests";
    mkdir(base.c_str(), 0755);
    return base + "/" + name;
}

bool writeText(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return out.good();
}

/// A registry over four invented mobs, so the weighted roll can be measured
/// against numbers a test chose rather than against whatever the shipped data
/// happens to say this week.
const ContentRegistry& synthetic() {
    static const ContentRegistry registry = [] {
        ContentRegistry r;
        const std::string mobs = tempPath("mobs.json");
        const std::string petals = tempPath("petals.json");
        writeText(mobs, test::fixtureMobs(R"({
            "alpha": {"name":"Alpha","health":10,"damage":1,"size":1,"speed":0.2,
                      "groups":{"meadow":1}},
            "beta":  {"name":"Beta","health":10,"damage":1,"size":1,"speed":0.2,
                      "groups":{"meadow":3}},
            "gamma": {"name":"Gamma","health":10,"damage":1,"size":1,"speed":0.2,
                      "groups":{"meadow":6}},
            "delta": {"name":"Delta","health":10,"damage":1,"size":1,"speed":0.2,
                      "groups":{"dunes":100}},
            "ghost": {"name":"Ghost","health":10,"damage":1,"size":1,"speed":0.2,
                      "groups":{"meadow":0}}
        })"));
        writeText(petals, test::fixturePetals(R"({
            "basic": {"name":"Basic","damage":5,"health":5,"size":1,"cooldown":1000,"count":1}
        })"));
        std::string error;
        r.loadFiles(mobs, petals, error);
        return r;
    }();
    return registry;
}

/// The staged maps, as the server would load them. Defined with the band
/// tests further down; declared here because the fill test wants them too.
const WorldMaps& shippedMaps();

/// The AUTHORED fixture map -- bands of several difficulties and a region,
/// written by this file. Defined with the band tests for the same reason. See
/// its definition for why the shipped map cannot stand in for it any more.
const MapData& authoredMap();
const WorldMaps& authoredMaps();

/// Fills `out` with a one-map overworld carrying nothing but `bands`: one
/// `difficulty` band per rectangle, each naming `mobs`.
///
/// Every test below that wants ambient mobs at all needs one of these. A Sim
/// with no map has no bands, and a world with no bands grows NOTHING -- that
/// is the invariant this file pins further down, and the reason a population
/// test can no longer just stand a viewer on open ground and wait.
void makeBandedWorld(WorldMaps& out, const std::vector<Rect>& bands, const std::string& mobs,
                     double difficulty = 0.0);

/// The same, with ONE band and the `singular` flag on it: a band that holds a
/// single mob however large it is drawn. See MapElement::singular.
void makeSingularBandWorld(WorldMaps& out, const Rect& band, const std::string& mobs,
                           double difficulty = 0.0);

/// The population a band of these bounds is stocked to: the same figure
/// SpawnSystem derives from kTargetMobDensity, so a test can say "its target"
/// rather than write a number down.
int bandTarget(const Rect& bounds);

/// The centre of the first spawn band on `map`.
///
/// Where a test that wants the SHIPPED map to grow something has to stand its
/// viewer: only a band somebody can see is stocked, and the author moves the
/// bands as the map is balanced, so the spot is read out of the file rather
/// than written down here.
Vec2 firstBandCentre(const MapData& map);

/// A world plus everything the spawner needs to be driven one tick at a time.
struct Sim {
    World world;
    CommandBuffer commands{world};
    Terrain terrain;
    SpawnSystem spawner;
    Rng rng{0xC0FFEEu};
    double now = 0;

    /// The tests speak in bare overworld coordinates; the system wants to know
    /// which realm each one is in.
    static std::vector<RealmPoint> overworld(const std::vector<Vec2>& players) {
        std::vector<RealmPoint> points;
        points.reserve(players.size());
        for (const Vec2 p : players) points.push_back({p, Realm::Overworld});
        return points;
    }

    void tick(const std::vector<Vec2>& players) {
        spawner.run(world, terrain, shipped(), overworld(players), rng, now, net::kTickSeconds,
                    commands);
        commands.flush();
        now += net::kTickMillis;
    }

    /// Advances the clock without simulating the gap. Used to reach a timeout
    /// without paying for the thousand ticks in between.
    void jump(double millis, const std::vector<Vec2>& players) {
        now += millis;
        spawner.run(world, terrain, shipped(), overworld(players), rng, now, 0.0, commands);
        commands.flush();
    }

    int mobCount() {
        Query<MobTag> mobs{world};
        return static_cast<int>(mobs.count());
    }

    int mobsWithin(Vec2 centre, double radius) {
        Query<MobTag, Transform> mobs{world};
        int n = 0;
        const double r2 = radius * radius;
        mobs.each([&](Entity, MobTag&, Transform& t) {
            if (distanceSq(t.position, centre) <= r2) ++n;
        });
        return n;
    }

    /// Every record the bands are holding in `realm`.
    ///
    /// The world is not the whole population any more. A band stocks itself to
    /// its full target wherever it is and whoever is looking, and only the
    /// part of it somebody's viewport reaches is an entity; a test that counts
    /// MobTags and stops there is measuring the viewport rather than the map.
    std::vector<SpawnSystem::LatentSite> latent(Realm realm = Realm::Overworld) {
        std::vector<SpawnSystem::LatentSite> out;
        spawner.latentSites(realm, out);
        return out;
    }

    /// The whole population standing inside `bounds`, awake or not: what a
    /// band's target is stated against.
    int populationIn(const Rect& bounds) {
        int n = mobsIn(bounds);
        for (const SpawnSystem::LatentSite& site : latent()) {
            if (bounds.contains(site.position)) ++n;
        }
        return n;
    }

    /// Mobs standing inside `bounds`, whatever put them there.
    int mobsIn(const Rect& bounds) {
        Query<MobTag, Transform> mobs{world};
        int n = 0;
        mobs.each([&](Entity, MobTag&, Transform& t) { n += bounds.contains(t.position) ? 1 : 0; });
        return n;
    }

    /// Mobs inside `bounds` that a band fill PLACED: the escorts and body
    /// segments their parents brought with them are left out, because they are
    /// not spawns the band asked for and are not counted against its target.
    int bandPlacedIn(const Rect& bounds) {
        Query<MobTag, Transform> mobs{world};
        int n = 0;
        mobs.each([&](Entity e, MobTag&, Transform& t) {
            if (bounds.contains(t.position) && !isChildOfAPlacedMob(e)) ++n;
        });
        return n;
    }

    /// True when this mob is the CHILD of something a band placed rather than
    /// a spawn of its own: a nest's escort or a wave, leashed to its parent,
    /// or a centipede's body segment trailing its head. Both are laid out on
    /// their parent's geometry and legitimately reach over a band's edge, so
    /// both are exempt from "every ambient mob stands inside a band".
    bool isChildOfAPlacedMob(Entity e) {
        if (world.has<HoleTether>(e)) return true;
        const BodySegment* link = world.tryGet<BodySegment>(e);
        return link != nullptr && !link->head;
    }
};

/// The centre of section 4, comfortably away from every section border.
const Vec2 kCentre{30000.0, 30000.0};

void rebuildGrid(World& world, SpatialGrid& grid) {
    grid.clear();
    Query<Transform, Body> bodies{world};
    bodies.each([&](Entity e, Transform& t, Body& b) { grid.insert(e, Realm::Overworld, t.position, b.radius); });
}

Entity makePlayer(World& world, Vec2 position, double magnetism = 0.0, std::uint32_t netId = 0) {
    const Entity e = world.create();
    world.add<PlayerTag>(e);
    world.add<Transform>(e, Transform{position, 0.0});
    world.add<Body>(e, Body{kPlayerBaseRadius, 1.0});
    world.add<Health>(e, Health{100.0, 100.0, 0.0, 0.0});
    PlayerModifiers mods;
    mods.magnetism = magnetism;
    world.add<PlayerModifiers>(e, mods);
    if (netId != 0) world.add<NetId>(e, NetId{netId});
    return e;
}

/// A mob standing at `at`, already dead, with `contributors` credited.
Entity makeCorpse(World& world, std::uint16_t mobIndex, Rarity rarity, Vec2 at, Entity killer,
                  const std::vector<Entity>& contributors) {
    const Entity e = world.create();
    world.add<MobTag>(e);
    world.add<Transform>(e, Transform{at, 0.0});
    world.add<MobType>(e, MobType{mobIndex, rarity, 1.0});
    Bounty bounty;
    for (const Entity c : contributors) bounty.credit(c, 10.0);
    world.add<Bounty>(e, std::move(bounty));
    world.add<Dead>(e, Dead{killer});
    return e;
}

std::vector<Entity> liveDrops(World& world) {
    Query<DropTag, DropItem> drops{world};
    return drops.collect();
}

} // namespace

// ---------------------------------------------------------------------------
// Content sanity -- everything below is meaningless without it
// ---------------------------------------------------------------------------

TEST(spawning_tests_have_content) {
    CHECK(shipped().loaded());
    CHECK(synthetic().loaded());
    CHECK_EQ(synthetic().mobCount(), std::size_t(5));
}

// ---------------------------------------------------------------------------
// Type and tier selection
// ---------------------------------------------------------------------------

TEST(weighted_choice_matches_the_configured_weights) {
    const ContentRegistry& content = synthetic();
    SpawnSystem spawner;
    Rng rng(4242);

    const std::uint16_t alpha = content.mobIndex("alpha");
    const std::uint16_t beta = content.mobIndex("beta");
    const std::uint16_t gamma = content.mobIndex("gamma");
    const std::uint16_t ghost = content.mobIndex("ghost");

    constexpr int kSamples = 60000;
    int counts[3] = {0, 0, 0};
    int ghostCount = 0;
    for (int i = 0; i < kSamples; ++i) {
        const std::uint16_t picked =
            spawner.chooseGroupMob(content, content.mobGroupIndex("meadow"), Rarity::Common, rng);
        if (picked == alpha) ++counts[0];
        else if (picked == beta) ++counts[1];
        else if (picked == gamma) ++counts[2];
        else if (picked == ghost) ++ghostCount;
    }

    // 1 : 3 : 6 out of a total of 10.
    CHECK_NEAR(counts[0] / double(kSamples), 0.10, 0.01);
    CHECK_NEAR(counts[1] / double(kSamples), 0.30, 0.015);
    CHECK_NEAR(counts[2] / double(kSamples), 0.60, 0.015);
    // A zero spawn_weight is how the data says "never rolled" -- that is what
    // keeps centipede body segments from spawning as loose mobs.
    CHECK_EQ(ghostCount, 0);
}

TEST(a_group_with_nothing_in_it_yields_no_mob_type) {
    const ContentRegistry& content = synthetic();
    SpawnSystem spawner;
    Rng rng(1);
    // The two groups the fixture defines are the only two that exist: a group
    // is the union of the names the mobs use, so there is no third to be empty.
    CHECK_EQ(content.mobGroupCount(), std::size_t(2));
    CHECK_EQ(spawner.chooseGroupMob(content, content.mobGroupIndex("dunes"), Rarity::Common, rng),
             content.mobIndex("delta"));
    // A name nothing claims is answered, not asserted on: it comes off a map
    // file, where a typo must cost a band its mobs rather than the process.
    CHECK_EQ(content.mobGroupIndex("sewers"), kInvalidIndex);
    CHECK_EQ(spawner.chooseGroupMob(content, kInvalidIndex, Rarity::Common, rng), kInvalidIndex);
    CHECK_EQ(spawner.chooseGroupMob(content, 9999, Rarity::Common, rng), kInvalidIndex);
}

// ---------------------------------------------------------------------------
// The difficulty curve
// ---------------------------------------------------------------------------
//
// THE INVARIANT these replaced: a spawn's rarity is a function of the GROUND'S
// DIFFICULTY, not of a global "natural spread" table and not of a tier a band
// names outright. A difficulty maps to a continuous tier value through the
// anchor table in shared/game/difficulty.h, and the spawn is a blend of the two
// tiers either side of it. The four anchors below are the design statement the
// user wrote, so they are asserted as stated -- over a big sample, because a
// blend is a distribution and not a value.

namespace {

/// The measured share of each rarity over `samples` rolls of one difficulty at
/// neutral luck.
std::array<double, kRarityCount> rolledSpread(double difficulty, int samples,
                                              std::uint64_t seed = 4242) {
    Rng rng(seed);
    std::array<int, kRarityCount> counts{};
    for (int i = 0; i < samples; ++i) {
        ++counts[static_cast<std::size_t>(
            rarityIndex(rollSpawnRarity(difficulty, kNeutralSpawnLuck, rng)))];
    }
    std::array<double, kRarityCount> shares{};
    for (std::size_t i = 0; i < counts.size(); ++i) {
        shares[i] = static_cast<double>(counts[i]) / static_cast<double>(samples);
    }
    return shares;
}

/// The expected tier index of a difficulty, straight off the pure blend.
double expectedTier(double difficulty) {
    const TierMix mix = tierMixForDifficulty(difficulty);
    return rarityIndex(mix.lower) * (1.0 - mix.upperChance) +
           rarityIndex(mix.upper) * mix.upperChance;
}

} // namespace

TEST(the_difficulty_curve_hits_the_four_authored_anchors) {
    // Difficulty 0 is FULLY common: no drift up, no drift down, nothing else in
    // it at all. "Fully common means fully common" is why there is no downward
    // drift in the curve and why the luck nudge is zero at neutral luck.
    const auto zero = rolledSpread(0.0, 200000);
    CHECK_NEAR(zero[rarityIndex(Rarity::Common)], 1.0, 1e-12);

    // 100 -> 98% ultra, 2% super.
    const auto hundred = rolledSpread(100.0, 200000);
    CHECK_NEAR(hundred[rarityIndex(Rarity::Ultra)], 0.98, 0.005);
    CHECK_NEAR(hundred[rarityIndex(Rarity::Super)], 0.02, 0.005);

    // 200 -> nothing but supers.
    const auto twoHundred = rolledSpread(200.0, 200000);
    CHECK_NEAR(twoHundred[rarityIndex(Rarity::Super)], 1.0, 1e-12);

    // 300 -> 95% unique, 5% apex.
    const auto threeHundred = rolledSpread(300.0, 200000);
    CHECK_NEAR(threeHundred[rarityIndex(Rarity::Unique)], 0.95, 0.005);
    CHECK_NEAR(threeHundred[rarityIndex(Rarity::Apex)], 0.05, 0.005);

    // And the pure blend agrees with the sample, so everything below can be
    // asserted without paying for two hundred thousand rolls.
    CHECK_NEAR(tierValueForDifficulty(0.0), 0.00, 1e-12);
    CHECK_NEAR(tierValueForDifficulty(100.0), 6.02, 1e-12);
    CHECK_NEAR(tierValueForDifficulty(200.0), 7.00, 1e-12);
    CHECK_NEAR(tierValueForDifficulty(300.0), 8.05, 1e-12);
}

TEST(safe_ground_is_ground_that_cannot_roll_a_rare) {
    // kDangerousGroundDifficulty is the line a door, a bot's birthplace and the
    // beginner-band fallback all stay under, so what matters is what the blend
    // JUST UNDER it can contain -- not what the blend AT it mostly is.
    //
    // The bug this pins: stating the line at t = 2 ("rare") reads as "the
    // ground is rare here", but on a blended curve t = 1.99 is already 98.7%
    // rare, and every one of those difficulties counted as SAFE. The line
    // belongs at the top of pure uncommon instead.
    const TierMix justUnder = tierMixForDifficulty(std::nextafter(
        kDangerousGroundDifficulty, 0.0));
    CHECK(rarityIndex(justUnder.lower) < rarityIndex(Rarity::Rare));
    CHECK(rarityIndex(justUnder.upper) < rarityIndex(Rarity::Rare));
    CHECK_NEAR(tierValueForDifficulty(kDangerousGroundDifficulty), 1.0, 1e-9);

    // And a hair above it, a rare is on the table. If it were not, the line
    // would simply be too low and safe ground would be needlessly small.
    const TierMix justOver = tierMixForDifficulty(std::nextafter(
        kDangerousGroundDifficulty, 1000.0));
    CHECK(rarityIndex(justOver.upper) >= rarityIndex(Rarity::Rare));

    // Sampled, so the claim is about what actually spawns and not only about
    // the arithmetic: nothing rare comes out of the last safe difficulty.
    const auto spread = rolledSpread(std::nextafter(kDangerousGroundDifficulty, 0.0), 50000);
    for (int tier = rarityIndex(Rarity::Rare); tier < kRarityCount; ++tier) {
        CHECK_NEAR(spread[static_cast<std::size_t>(tier)], 0.0, 1e-12);
    }
}

TEST(a_higher_difficulty_never_spawns_a_lower_tier) {
    // Monotonicity, over the whole authored range and past the end of it. A
    // curve that dipped anywhere would make a stretch of a map's progression
    // run backwards, which is the one thing a difficulty scale must not do.
    //
    // From zero up, because that is the scale: a NEGATIVE difficulty is the
    // random-spread sentinel and not a point on this curve at all, so it is no
    // more "gentler than zero" than a colour is. See the test below.
    double previous = -1.0;
    for (double difficulty = 0.0; difficulty <= 600.0; difficulty += 0.25) {
        const double expected = expectedTier(difficulty);
        if (expected < previous - 1e-12) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "expected tier fell at difficulty " +
                                         std::to_string(difficulty));
            break;
        }
        previous = expected;
        // And the two tiers of a blend are always adjacent, so a difficulty
        // never produces something two tiers from what it says.
        const TierMix mix = tierMixForDifficulty(difficulty);
        CHECK(rarityIndex(mix.upper) - rarityIndex(mix.lower) <= 1);
    }
}

TEST(a_negative_difficulty_rolls_the_whole_natural_spread) {
    // The ONE difficulty that is not a point on the curve. -1 means "don't
    // grade this ground": roll the reference's own unbanded distribution
    // (ENEMY_TIERS, src/constants.ts) -- 40/30/15/10/4/1 over common..mythic --
    // so one band holds every tier at once instead of a two-tier blend.
    //
    // The bug this pins is the one it was written for: a negative difficulty
    // used to CLAMP, so a `-1` band grew nothing but commons and an author had
    // no way at all to ask for a mixed one.
    const auto spread = rolledSpread(kRandomDifficulty, 200000);
    for (std::size_t tier = 0; tier < kNaturalRaritySpread.size(); ++tier) {
        CHECK_NEAR(spread[tier], kNaturalRaritySpread[tier], 0.01);
    }
    // Every tier the table names actually comes up, and no tier it zeroes ever
    // does: a random band is not a lottery for a boss.
    for (std::size_t tier = 0; tier < kNaturalRaritySpread.size(); ++tier) {
        if (kNaturalRaritySpread[tier] > 0.0) {
            CHECK(spread[tier] > 0.0);
        } else {
            CHECK_EQ(spread[tier], 0.0);
        }
    }
    CHECK(hardestNaturalRarity() == Rarity::Mythic);

    // Any negative number is the sentinel, not a typo that clamps.
    for (const double difficulty : {-1.0, -2.0, -50.0}) {
        CHECK(isRandomDifficulty(difficulty));
        Rng rng(11);
        bool sawAboveCommon = false;
        for (int i = 0; i < 1000; ++i) {
            if (rollSpawnRarity(difficulty, kNeutralSpawnLuck, rng) != Rarity::Common) {
                sawAboveCommon = true;
            }
        }
        CHECK(sawAboveCommon);
    }

    // Appraised at the spread's MEAN wherever one number is all there is room
    // for -- the minimap's colour, a bot sizing up a band. An average, not a
    // roll.
    CHECK_NEAR(tierValueForDifficulty(kRandomDifficulty), 1.11, 1e-12);

    // And it is never beginner ground, however far below zero it sorts: the
    // spread reaches mythic, so a door and a newborn bot both refuse it.
    CHECK(isDangerousGround(kRandomDifficulty));
    CHECK(!isDangerousGround(0.0));
    CHECK(isDangerousGround(kDangerousGroundDifficulty));

    // Luck buys the same thing here as on the curve: a hundredth of a tier per
    // point, spent as that much chance of one tier up.
    double plainMean = 0.0, luckyMean = 0.0;
    for (std::size_t tier = 0; tier < spread.size(); ++tier) {
        plainMean += spread[tier] * static_cast<double>(tier);
    }
    {
        Rng rng(99);
        std::array<int, kRarityCount> counts{};
        const double luck = kNeutralSpawnLuck + 100.0;
        for (int i = 0; i < 200000; ++i) {
            ++counts[static_cast<std::size_t>(rarityIndex(rollNaturalRarity(luck, rng)))];
        }
        for (std::size_t tier = 0; tier < counts.size(); ++tier) {
            luckyMean += static_cast<double>(counts[tier]) / 200000.0 * static_cast<double>(tier);
        }
    }
    // A hundred points of luck is a whole tier of expected gain.
    CHECK_NEAR(luckyMean - plainMean, 1.0, 0.05);
}

TEST(difficulty_ramps_past_three_hundred) {
    // Above 300 CONTINUES the 200-to-300 slope instead of behaving like 300: a
    // bigger number must always mean at least as dangerous, and eventually
    // means apex. On the shipped anchors the slope is 0.0105 tiers per point,
    // so apex is reached at difficulty 390.48 and never before it.
    CHECK(tierValueForDifficulty(350.0) > tierValueForDifficulty(300.0));
    CHECK_NEAR(tierValueForDifficulty(350.0), 8.05 + 50.0 * 0.0105, 1e-12);
    CHECK(tierValueForDifficulty(389.0) < kMaxTierValue);
    CHECK_NEAR(tierValueForDifficulty(400.0), kMaxTierValue, 1e-12);
    CHECK_NEAR(tierValueForDifficulty(1e6), kMaxTierValue, 1e-12);

    // At the top the blend is apex alone rather than an apex/nothing pair.
    const TierMix top = tierMixForDifficulty(500.0);
    CHECK(top.lower == Rarity::Apex);
    CHECK(top.upper == Rarity::Apex);
    CHECK_EQ(top.upperChance, 0.0);
    Rng rng(7);
    for (int i = 0; i < 1000; ++i) {
        CHECK(rollSpawnRarity(500.0, kNeutralSpawnLuck, rng) == Rarity::Apex);
    }
}

TEST(luck_shifts_the_curve_upward_and_never_down) {
    // Neutral luck is exactly the anchors -- asserted above -- so the only
    // thing left is that luck moves UP and only up. A clover buys a hundredth
    // of a tier per point, which at difficulty zero is the chance of an
    // uncommon rather than a common.
    CHECK_EQ(luckTierDrift(kNeutralSpawnLuck), 0.0);
    CHECK_EQ(luckTierDrift(0.0), 0.0);            // cursed is not punished
    CHECK_EQ(luckTierDrift(-100.0), 0.0);
    CHECK(luckTierDrift(kNeutralSpawnLuck + 1.0) > 0.0);

    Rng rng(11);
    int uncommons = 0;
    const int samples = 200000;
    for (int i = 0; i < samples; ++i) {
        const Rarity r = rollSpawnRarity(0.0, kNeutralSpawnLuck + 1.0, rng);
        CHECK(rarityIndex(r) <= rarityIndex(Rarity::Uncommon));
        if (r == Rarity::Uncommon) ++uncommons;
    }
    // One point of luck, one hundredth of a tier.
    CHECK_NEAR(static_cast<double>(uncommons) / samples, 0.01, 0.003);

    // A luck-free roll at the same difficulty stays fully common, so the shift
    // above is luck and not noise.
    const auto neutral = rolledSpread(0.0, 20000);
    CHECK_NEAR(neutral[rarityIndex(Rarity::Common)], 1.0, 1e-12);
}

TEST(min_rarity_still_floors_a_named_mob_whatever_the_ground_says) {
    const ContentRegistry& content = shipped();
    const MobConfig& evil = content.mob(content.mobIndex("evil_centipede"));
    CHECK_EQ(evil.minRarity, Rarity::Rare);

    // Difficulty zero is fully common ground, and an evil centipede still
    // cannot exist below rare: the floor is a property of the MOB, which is why
    // min_rarity survived the removal of the rarity-zone scheme.
    Rng rng(77);
    for (int i = 0; i < 5000; ++i) {
        CHECK(SpawnSystem::rollRarity(evil, 0.0, kNeutralSpawnLuck, rng) == Rarity::Rare);
    }
    // A mob with no floor takes the ground's answer unchanged.
    const MobConfig& bee = content.mob(content.mobIndex("bee"));
    for (int i = 0; i < 5000; ++i) {
        CHECK(SpawnSystem::rollRarity(bee, 0.0, kNeutralSpawnLuck, rng) == Rarity::Common);
        CHECK(SpawnSystem::rollRarity(bee, 200.0, kNeutralSpawnLuck, rng) == Rarity::Super);
    }
}

TEST(a_direct_spawn_below_min_rarity_is_raised_to_it) {
    Sim sim;
    const std::uint16_t evil = shipped().mobIndex("evil_centipede");
    const Entity e = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), evil, Rarity::Common,
                                          kCentre, Realm::Overworld, 0.0, sim.rng);
    CHECK(e != NULL_ENTITY);
    CHECK_EQ(sim.world.get<MobType>(e).rarity, Rarity::Rare);
    // ...and a tier above it is left alone.
    const Entity high = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), evil,
                                             Rarity::Legendary, kCentre, Realm::Overworld, 0.0, sim.rng);
    CHECK_EQ(sim.world.get<MobType>(high).rarity, Rarity::Legendary);
}

TEST(a_spawned_mob_wears_its_tiers_armor) {
    Sim sim;
    const std::uint16_t leafbug = shipped().mobIndex("leafbug");
    const Entity common = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), leafbug,
                                               Rarity::Common, kCentre, Realm::Overworld, 0.0,
                                               sim.rng);
    CHECK_NEAR(sim.world.get<Armor>(common).amount, 10.0, 1e-9);

    // The cap: ultra and apex wear the same 729x, so a leafbug tops out at
    // 7290 rather than running the damage ladder to the end of the table.
    const Entity apex = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), leafbug,
                                             Rarity::Apex, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    CHECK_NEAR(sim.world.get<Armor>(apex).amount, 7290.0, 1e-9);

    // A mob that states nothing wears the default 1 at common.
    const Entity bee = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                            shipped().mobIndex("bee"), Rarity::Common, kCentre,
                                            Realm::Overworld, 0.0, sim.rng);
    CHECK_NEAR(sim.world.get<Armor>(bee).amount, 1.0, 1e-9);
}

TEST(an_unknown_mob_index_spawns_nothing) {
    Sim sim;
    CHECK_EQ(sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), kInvalidIndex, Rarity::Common,
                                  kCentre, Realm::Overworld, 0.0, sim.rng),
             NULL_ENTITY);
    CHECK_EQ(sim.world.size(), std::size_t(0));
}

// ---------------------------------------------------------------------------
// Population control
// ---------------------------------------------------------------------------
//
// THE INVARIANT these tests are written against: every ambient mob in the
// world stands inside a spawn BAND, or is the escort or body segment of one
// that does. There is no second population driver behind the bands -- the
// per-viewer density fill that used to stock the ground an author had not
// drawn on is gone -- so a viewer on open ground is owed nothing, and a test
// that wants mobs has to put a band under them.

TEST(a_band_converges_to_the_population_its_own_area_buys) {
    // What "converges" means now. A band's target is kTargetMobDensity over
    // the area of its outline; it stocks itself to that whoever is looking,
    // and then holds. The number is derived here the same way the spawner
    // derives it, so a change to the density is a change to both.
    //
    // POPULATION, not entities. A band is the size of several screens, so most
    // of what it holds is latent at any moment and counting MobTags would be
    // counting the flower's viewport.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "garden 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};

    for (int i = 0; i < 400; ++i) sim.tick(players);

    const int target = bandTarget(band);
    CHECK(target > 20);   // a band worth measuring convergence against
    // Most of the way there rather than exactly there: stocking is drained a
    // chunk per pass and a sample in somebody's lap is thrown away.
    CHECK(sim.populationIn(band) >= target * 3 / 4);
    // And never past it. The bound is on what the BAND placed: a hole's brood
    // and a centipede's body are children of a mob the band asked for rather
    // than spawns the band asked for, and a garden roster is full of both.
    CHECK(sim.bandPlacedIn(band) + static_cast<int>(sim.latent().size()) <= target);

    // Some of it is awake, because somebody is standing in the middle of it.
    // A band that stocked itself and woke none of it would satisfy every
    // count above and be an empty field to play in.
    CHECK(sim.mobsIn(band) > 0);

    // It holds: a converged population does not keep creeping upward. The
    // whole world this time, escorts included, because a nest going on
    // producing forever is exactly what this would catch.
    const int settled = sim.mobCount() + static_cast<int>(sim.latent().size());
    for (int i = 0; i < 400; ++i) sim.tick(players);
    CHECK(sim.mobCount() + static_cast<int>(sim.latent().size()) <=
          settled + kMaxNestChildren);
}

TEST(the_whole_map_is_stocked_whether_or_not_anybody_is_looking) {
    // The rule this file is built around. A band holds the population its own
    // area buys wherever it is drawn: nobody has to be near it, nobody has to
    // have visited it, and the flower below never goes anywhere near the
    // second one.
    const Rect near{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    const Rect away{kCentre.x + 12000.0, kCentre.y + 12000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {near, away}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    // A dozen screens away, never seen, and full.
    CHECK(sim.populationIn(away) >= bandTarget(away) * 3 / 4);
    // And not one unit of that costs the tick anything: there is no entity in
    // it at all. That is the whole trade -- the map is the size of its area,
    // the simulation is the size of the viewports.
    CHECK_EQ(sim.mobsIn(away), 0);

    // The band under the flower is just as full, and some of it is awake.
    CHECK(sim.populationIn(near) >= bandTarget(near) * 3 / 4);
    CHECK(sim.mobsIn(near) > 0);
    // Awake means the part they can SEE, not the whole band: a 6000-unit band
    // is several screens across.
    CHECK(sim.mobsIn(near) < sim.populationIn(near));
}

TEST(a_mob_nobody_is_near_becomes_a_record_again_and_comes_back) {
    // The other direction, and what makes the population stable rather than
    // churning: walking away does not DESTROY the mobs behind you, it puts
    // them back to sleep where they stand. Walk back and the same band is
    // still full.
    const Rect band{kCentre.x - 1500.0, kCentre.y - 1500.0, 3000.0, 3000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> here{kCentre};
    for (int i = 0; i < 400; ++i) sim.tick(here);

    const int awake = sim.mobsIn(band);
    const int population = sim.populationIn(band);
    CHECK(awake > 0);

    // Off to the other side of the map, and wait out the grace period. Twice,
    // because a mob that was still in view on the pass the flower left gets
    // its full period from then.
    const std::vector<Vec2> elsewhere{Vec2{5000.0, 5000.0}};
    sim.tick(elsewhere);
    sim.jump(kMobDespawnDelayMillis + 1000.0, elsewhere);
    sim.jump(kMobDespawnDelayMillis + 1000.0, elsewhere);

    // Nothing there is simulated any more, and nothing was LOST: the same
    // population is standing there, all of it asleep.
    CHECK_EQ(sim.mobsIn(band), 0);
    CHECK(sim.populationIn(band) >= population - 5);
    CHECK(sim.spawner.census().demotedTotal >= awake);

    // Walk back. It is awake again within a population pass or two, and it did
    // not have to be spawned from nothing to get there.
    const int promotedBefore = sim.spawner.census().promotedTotal;
    for (int i = 0; i < 60; ++i) sim.tick(here);
    CHECK(sim.mobsIn(band) > 0);
    CHECK(sim.spawner.census().promotedTotal > promotedBefore);
}

TEST(ground_a_player_has_just_cleared_does_not_refill_in_front_of_them) {
    // The map is full everywhere and tops itself up the moment anything dies,
    // so something has to stop the replacements appearing on the screen of the
    // player who just cleared it. That is what a record's ready time is for:
    // one placed where nobody was looking is awake at once, and one placed
    // inside a live viewport waits out kInViewRespawnMin..Max first.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    const Rect screen{kCentre.x - kSpawnViewportHalfWidth, kCentre.y - kSpawnViewportHalfHeight,
                      kSpawnViewportHalfWidth * 2.0, kSpawnViewportHalfHeight * 2.0};
    const int cleared = sim.mobsIn(screen);
    CHECK(cleared > 2);

    // Kill everything the flower can see, the way a player would.
    Query<MobTag, Transform> mobs{sim.world};
    mobs.each([&](Entity e, MobTag&, Transform& transform) {
        if (screen.contains(transform.position)) sim.world.destroy(e);
    });
    CHECK_EQ(sim.mobsIn(screen), 0);

    // Two seconds later the band has already replaced them in its books --
    // the map does not wait to be full -- and the flower's own screen has not.
    for (int i = 0; i < 60; ++i) sim.tick(players);
    CHECK(sim.populationIn(band) >= (bandTarget(band) * 3) / 4);
    CHECK(sim.mobsIn(screen) <= cleared / 2);
}

TEST(nothing_ever_wakes_in_a_flowers_lap) {
    // The report this pins: "a mob spawned on top of me and killed me".
    //
    // The placement test a record was written under was made against where the
    // players were AT THE TIME. A replacement then waits out its in-view delay
    // -- up to twelve seconds -- and a flower moves 300 units a second, so by
    // the time the record may wake, the player who cleared that ground can be
    // standing exactly on it. Waking it there materialises a body already
    // touching the flower, and body damage is dealt on the very next tick.
    //
    // So the clearance is re-tested at the moment the ENTITY appears, and a
    // record that fails it is left asleep rather than woken or thrown away.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;

    // Stock it cold, from the far side of the map: every one of these records
    // is ready the instant it exists, so nothing below is waiting on a delay.
    const std::vector<Vec2> away{Vec2{kCentre.x + 40000.0, kCentre.y + 40000.0}};
    for (int i = 0; i < 400; ++i) sim.tick(away);
    const std::vector<SpawnSystem::LatentSite> stocked = sim.latent();
    CHECK(stocked.size() > 10);

    // Now stand a flower ON one of them -- the worst case the moving player
    // above arrives at -- and leave it there.
    const Vec2 underfoot = stocked.front().position;
    const std::vector<Vec2> standing{underfoot};
    for (int i = 0; i < 200; ++i) sim.tick(standing);

    // The band woke: this is not a test that passes because nothing happened.
    CHECK(sim.mobsWithin(underfoot, kSpawnViewportHalfWidth) > 0);
    // And not one of them is in the flower's lap.
    CHECK_EQ(sim.mobsWithin(underfoot, kMinSpawnDistance), 0);

    // Held asleep, not dropped: the record is still the band's, and it comes
    // to life as soon as the flower takes a step away from it.
    bool held = false;
    for (const SpawnSystem::LatentSite& site : sim.latent()) {
        if (distance(site.position, underfoot) < kMinSpawnDistance) held = true;
    }
    CHECK(held);
    const std::vector<Vec2> stepped{underfoot + Vec2{kMinSpawnDistance + 400.0, 0.0}};
    for (int i = 0; i < 200; ++i) sim.tick(stepped);
    CHECK(sim.mobsWithin(underfoot, kMinSpawnDistance) > 0);
}

TEST(a_killed_mob_is_replaced_where_it_died_rather_than_anywhere_in_its_band) {
    // The difference between a band that is evenly full and one that is full
    // on paper. These bands are millions of square units and a viewport is a
    // few: hand a casualty's slot back to the band at large and a player
    // farming one corner strips it while the far side of the same band quietly
    // goes over density. The map would still report itself full the whole
    // time, which is exactly the failure that is hard to see.
    const Rect band{kCentre.x - 6000.0, kCentre.y - 6000.0, 12000.0, 12000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;

    // One corner of it, a long way from the middle. The watched box is the
    // kill radius plus the scatter, so every honest replacement lands inside
    // it -- and it is a fourteenth of the band, so a band-wide replacement
    // almost never does.
    const Vec2 corner{band.x + 2000.0, band.y + 2000.0};
    constexpr double kKillRadius = 900.0;
    const double watchedHalf = kKillRadius + kRespawnScatter + 100.0;
    const Rect watched{corner.x - watchedHalf, corner.y - watchedHalf, watchedHalf * 2.0,
                       watchedHalf * 2.0};

    const std::vector<Vec2> visiting{corner};
    for (int i = 0; i < 300; ++i) sim.tick(visiting);
    const int before = sim.populationIn(watched);
    CHECK(before > 3);

    // Farm it, the way a player does: marked Dead so the spawner meets them as
    // casualties rather than as mobs that simply vanished, then reaped as the
    // runtime reaps them.
    int killed = 0;
    for (int round = 0; round < 8; ++round) {
        std::vector<Entity> doomed;
        Query<MobTag, Transform> mobs{sim.world};
        mobs.each([&](Entity e, MobTag&, Transform& transform) {
            if (sim.world.has<Dead>(e)) return;
            if (distance(transform.position, corner) > kKillRadius) return;
            doomed.push_back(e);
        });
        // Marked outside the walk: adding a component moves the entity to
        // another archetype, which relocates the rows the walk is holding.
        for (const Entity e : doomed) sim.world.add<Dead>(e, Dead{NULL_ENTITY});
        killed += static_cast<int>(doomed.size());
        sim.tick(visiting);
        for (const Entity e : doomed) {
            if (sim.world.isAlive(e)) sim.world.destroy(e);
        }
        // Long enough for the replacements to come back: they wait out
        // kInViewRespawnMin..Max first, because this is somebody's screen.
        for (int i = 0; i < 500; ++i) sim.tick(visiting);
    }
    CHECK(killed > 15);

    // Every one of those slots came back to this corner. Spread over the band
    // instead, they would have gone to a hundred and forty million square
    // units of somewhere else and left the corner permanently thin.
    CHECK(sim.populationIn(watched) >= before - 3);
}

TEST(a_singular_band_holds_one_mob_however_large_it_is_drawn) {
    // The one band whose SIZE says nothing about its population. An ordinary
    // band is stocked to its area times a density, which is the right rule for
    // ground and the wrong one for a creature there is meant to be one of: the
    // queen's band is drawn over the whole hell because she may be anywhere in
    // it, not because the hell should hold a hundred queens.
    //
    // Stated against bandTarget() rather than against a bare 1, because that
    // is the number the flag has to beat: a band this size is worth dozens of
    // mobs, so "exactly one" would also be what a band the spawner had simply
    // failed to fill looks like.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    CHECK(bandTarget(band) > 20);

    WorldMaps maps;
    makeSingularBandWorld(maps, band, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    // POPULATION, awake or not: most of a band this size is latent at any
    // moment, and counting entities would be counting the flower's viewport.
    CHECK_EQ(sim.populationIn(band), 1);
    // And it holds there rather than creeping up by a mob a pass.
    for (int i = 0; i < 400; ++i) sim.tick(players);
    CHECK_EQ(sim.populationIn(band), 1);
}

TEST(a_singular_bands_one_mob_comes_back_anywhere_in_it) {
    // The counterpoint to the scatter rule above. A casualty's slot is handed
    // back within kRespawnScatter of the corpse, which is what keeps a band the
    // size of a district evenly full -- and a band of ONE has no evenness to
    // keep. Hand its slot back where it fell and the next queen is always in
    // the room the last one died in, which turns a hunt across the map into a
    // farm at one coordinate.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeSingularBandWorld(maps, band, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;

    // Where the band's one mob is, awake or not. A record is not an entity, so
    // this is the only question that can be asked between kills.
    const auto where = [&]() -> Vec2 {
        Vec2 at{};
        bool found = false;
        Query<MobTag, Transform> mobs{sim.world};
        mobs.each([&](Entity, MobTag&, Transform& transform) {
            if (!found) { at = transform.position; found = true; }
        });
        if (found) return at;
        const std::vector<SpawnSystem::LatentSite> records = sim.latent();
        return records.empty() ? Vec2{} : records.front().position;
    };

    for (int i = 0; i < 400; ++i) sim.tick(std::vector<Vec2>{kCentre});

    double furthest = 0;
    for (int round = 0; round < 8; ++round) {
        // Walk to it -- to a step away from it, not onto it. One mob in a
        // band this size is latent almost everywhere, and a record nobody is
        // near is never an entity to kill; a record somebody is STANDING ON is
        // deliberately held asleep rather than woken into their lap, which is
        // what kMinSpawnDistance means at wake time.
        const std::vector<Vec2> visiting{where() + Vec2{kMinSpawnDistance + 400.0, 0.0}};
        Entity target = NULL_ENTITY;
        for (int i = 0; i < 600 && target == NULL_ENTITY; ++i) {
            sim.tick(visiting);
            Query<MobTag> mobs{sim.world};
            mobs.each([&](Entity e, MobTag&) {
                if (target == NULL_ENTITY && !sim.world.has<Dead>(e)) target = e;
            });
        }
        if (target == NULL_ENTITY) {
            std::fprintf(stderr, "[test] the singular band never woke its mob\n");
            CHECK(false);
            return;
        }

        // Killed the way a player kills it: marked Dead so the spawner meets a
        // casualty rather than a mob that vanished, then reaped.
        const Vec2 died = sim.world.get<Transform>(target).position;
        sim.world.add<Dead>(target, Dead{NULL_ENTITY});
        sim.tick(visiting);
        if (sim.world.isAlive(target)) sim.world.destroy(target);
        // Past the in-view wait its replacement was given: this is somebody's
        // screen, so the slot does not come back on the next tick.
        for (int i = 0; i < 500; ++i) sim.tick(visiting);

        CHECK_EQ(sim.populationIn(band), 1);
        furthest = std::max(furthest, distance(where(), died));
    }

    // Rolled over the whole outline, so across eight kills it turns up a long
    // way from where it was killed at least once -- which under the scatter
    // rule it could not, by construction.
    CHECK(furthest > kRespawnScatter * 2.0);
}

TEST(a_boss_is_a_live_mob_wherever_it_rolled_and_never_sleeps) {
    // Supers and up are the exception: they are placed as entities whatever
    // corner of the map their band is in, they are never put back to sleep,
    // and they are never recycled. A boss is an event -- chat was told, the
    // bots were sent -- so it has to be standing there when somebody arrives.
    const Rect band{kCentre.x + 12000.0, kCentre.y + 12000.0, 1500.0, 1500.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%", 200.0);   // difficulty 200: all supers
    Sim sim;
    sim.spawner.worldMaps = &maps;
    // A flower on the far side of the map: the band is never in anyone's view.
    const std::vector<Vec2> players{Vec2{5000.0, 5000.0}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    CHECK(sim.mobsIn(band) > 0);
    // Not one of them is a record. A boss the spawner had quietly filed away
    // is a boss the announcement promised and the raid cannot find.
    for (const SpawnSystem::LatentSite& site : sim.latent()) {
        CHECK(rarityIndex(site.rarity) < rarityIndex(kAnnouncedRarity));
    }

    // And they outlast the grace period with nobody anywhere near them.
    const int standing = sim.mobsIn(band);
    sim.jump(kMobDespawnDelayMillis + 1000.0, players);
    sim.jump(kMobDespawnDelayMillis + 1000.0, players);
    CHECK_EQ(sim.mobsIn(band), standing);
}

TEST(a_boss_announces_itself_whatever_placed_it) {
    // Not just a band stocking itself: the arena, a nest, a script and the
    // operator console all reach the world through spawnMob, and the
    // announcement is made THERE. That is what makes "every boss is announced"
    // a property of the spawner rather than a thing each caller has to
    // remember.
    Sim sim;
    const std::uint16_t bee = shipped().mobIndex("bee");
    CHECK(bee != kInvalidIndex);

    const Entity boss = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee, Rarity::Super,
                                             kCentre, Realm::Overworld, sim.now, sim.rng);
    CHECK(boss != NULL_ENTITY);
    CHECK_EQ(sim.spawner.bossSpawns.size(), std::size_t(1));
    if (!sim.spawner.bossSpawns.empty()) {
        const SpawnSystem::BossSpawn& announced = sim.spawner.bossSpawns.front();
        // The entity rides with it, so the runtime can hand the bot controller
        // something it can follow rather than a coordinate that is already
        // stale by the time the raid sets off.
        CHECK_EQ(announced.entity, boss);
        CHECK(announced.rarity == Rarity::Super);
        CHECK(announced.mobIndex == bee);
    }

    // Everything below the line is scenery and says nothing, an ultra
    // included.
    sim.spawner.bossSpawns.clear();
    sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee, Rarity::Ultra,
                         kCentre + Vec2{500, 0}, Realm::Overworld, sim.now, sim.rng);
    CHECK(sim.spawner.bossSpawns.empty());
}

// ---------------------------------------------------------------------------
// Boss clocks: a wild unique or apex is an upgraded super
// ---------------------------------------------------------------------------

namespace {

/// Mobs of `rarity` standing in the world, whatever placed them.
int mobsOfRarity(World& world, Rarity rarity) {
    Query<MobTag, MobType> mobs{world};
    int n = 0;
    mobs.each([&](Entity, MobTag&, MobType& type) { n += type.rarity == rarity ? 1 : 0; });
    return n;
}

/// The one biome clock of a single-map fixture world.
SpawnSystem::BiomeBossClock& onlyClock(Sim& sim) {
    CHECK_EQ(sim.spawner.bossClocks().size(), std::size_t(1));
    return sim.spawner.bossClocks().front();
}

/// A difficulty-200 bee band -- every roll a super -- big enough that a tenth
/// of its stock is several mobs, driven until it is full.
struct SuperBand {
    Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    Sim sim;
    /// Far enough off that nothing in the band is refused for a player's lap.
    std::vector<Vec2> players{Vec2{5000.0, 5000.0}};

    explicit SuperBand(double difficulty = 200.0) {
        makeBandedWorld(maps, {band}, "bee 100%", difficulty);
        sim.spawner.worldMaps = &maps;
    }
    /// Every boss announced during fill(), by tier. Counted as they come:
    /// the queue keeps only the newest few, and ninety supers go through it.
    std::array<int, kRarityCount> announced{};

    /// One pass, so the clocks exist and have been dealt. That pass also
    /// stocks the band's first kZoneStockPerPass on the DEALT clocks, which
    /// are still in the future; the test sets them before the rest.
    void deal() {
        sim.spawner.run(sim.world, sim.terrain, shipped(), Sim::overworld(players), sim.rng,
                        sim.now, 0.0, sim.commands);
        sim.commands.flush();
        drainAnnouncements();
    }
    void fill() {
        for (int i = 0; i < 300; ++i) {
            sim.tick(players);
            drainAnnouncements();
        }
    }
    void drainAnnouncements() {
        for (const SpawnSystem::BossSpawn& boss : sim.spawner.bossSpawns) {
            ++announced[rarityIndex(boss.rarity)];
        }
        sim.spawner.bossSpawns.clear();
    }
};

} // namespace

TEST(every_biome_gets_its_own_boss_clocks_scattered_over_one_cooldown) {
    // One clock per BIOME, not per band or per map, and dealt out so that no
    // two biomes come ready together and none is ready the moment the server
    // starts -- which is when every band is stocking cold and placing supers
    // by the dozen.
    Sim sim;
    sim.spawner.worldMaps = &shippedMaps();
    sim.now = 50000.0;
    const double start = sim.now;
    sim.tick({});

    std::set<std::string> biomes;
    for (const MapData& map : shippedMaps().maps()) biomes.insert(map.biome());
    const auto& clocks = sim.spawner.bossClocks();
    CHECK(biomes.size() > 1);
    CHECK_EQ(clocks.size(), biomes.size());

    const auto spacing = [&](double cooldown, bool apex) {
        std::vector<double> ready;
        for (const SpawnSystem::BiomeBossClock& clock : clocks) {
            CHECK(clock.scattered);
            CHECK(biomes.count(clock.biome) == 1);
            ready.push_back(apex ? clock.apexReadyMillis : clock.uniqueReadyMillis);
        }
        std::sort(ready.begin(), ready.end());
        // Every one of them still to come, and all within one cooldown.
        CHECK(ready.front() > start);
        CHECK(ready.back() < start + cooldown);
        // Evenly spaced: a whole slot between neighbours, never two at once.
        const double slot = cooldown / static_cast<double>(ready.size());
        for (std::size_t i = 1; i < ready.size(); ++i) {
            CHECK_NEAR(ready[i] - ready[i - 1], slot, 1e-6);
        }
    };
    spacing(kUniqueSpawnCooldownMillis, false);
    spacing(kApexSpawnCooldownMillis, true);
}

TEST(a_cooling_biome_spawns_supers_and_nothing_above_them) {
    // Both clocks well in the future: every roll of an all-super band stays a
    // super. And a band steeper than super -- difficulty 300 is 95% unique on
    // the curve -- is held to super too, or it would hand out uniques far
    // faster than any clock allows.
    for (const double difficulty : {200.0, 300.0}) {
        SuperBand world(difficulty);
        world.deal();
        SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
        clock.uniqueReadyMillis = world.sim.now + kUniqueSpawnCooldownMillis;
        clock.apexReadyMillis = world.sim.now + kApexSpawnCooldownMillis;
        world.fill();

        CHECK(mobsOfRarity(world.sim.world, Rarity::Super) > 20);
        CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Unique), 0);
        CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Apex), 0);
    }
}

TEST(a_ready_clock_upgrades_one_super_and_then_cools_down) {
    // A ready clock gives each super kBossUpgradeChance of coming out a tier
    // above -- and the first one that does starts the clock again, so the
    // sixty-odd supers a band stocks at once after deal() get ONE unique, not
    // six.
    SuperBand world;
    world.deal();
    SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
    clock.uniqueReadyMillis = 0.0;
    clock.apexReadyMillis = world.sim.now + kApexSpawnCooldownMillis;
    const double apexWas = clock.apexReadyMillis;
    world.fill();

    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Unique), 1);
    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Apex), 0);
    CHECK(mobsOfRarity(world.sim.world, Rarity::Super) > 20);
    // Charged from the moment it appeared, and the apex clock left alone.
    const SpawnSystem::BiomeBossClock& after = onlyClock(world.sim);
    CHECK(after.uniqueReadyMillis > world.sim.now + kUniqueSpawnCooldownMillis - 20000.0);
    CHECK(after.uniqueReadyMillis <= world.sim.now + kUniqueSpawnCooldownMillis);
    CHECK_EQ(after.apexReadyMillis, apexWas);

    // It is announced like any other boss: an upgrade is a spawn, not a
    // relabel after the fact.
    CHECK_EQ(world.announced[rarityIndex(Rarity::Unique)], 1);
}

TEST(both_clocks_ready_gives_one_apex_and_one_unique) {
    SuperBand world;
    world.deal();
    SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
    clock.uniqueReadyMillis = 0.0;
    clock.apexReadyMillis = 0.0;
    world.fill();

    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Apex), 1);
    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Unique), 1);
    CHECK_EQ(world.announced[rarityIndex(Rarity::Apex)], 1);
    CHECK_EQ(world.announced[rarityIndex(Rarity::Unique)], 1);
    const SpawnSystem::BiomeBossClock& after = onlyClock(world.sim);
    CHECK(after.apexReadyMillis > world.sim.now + kApexSpawnCooldownMillis - 20000.0);
    CHECK(after.uniqueReadyMillis > world.sim.now + kUniqueSpawnCooldownMillis - 20000.0);
}

namespace {

/// Every live mob leashed to `nest`: its opening guard, its waves, its
/// soldiers.
std::vector<Rarity> minionTiers(World& world, Entity nest) {
    std::vector<Rarity> tiers;
    Query<MobTag, MobType, HoleTether> minions{world};
    minions.without<Dead>();
    minions.each([&](Entity, MobTag&, MobType& type, HoleTether& tether) {
        if (tether.hole == nest) tiers.push_back(type.rarity);
    });
    return tiers;
}

/// Live whole animals of `rarity` -- centipede segments not counted.
std::vector<Entity> animalsOfRarity(World& world, Rarity rarity) {
    std::vector<Entity> out;
    Query<MobTag, MobType> mobs{world};
    mobs.without<Dead>();
    mobs.each([&](Entity e, MobTag&, MobType& type) {
        if (type.rarity != rarity) return;
        const BodySegment* link = world.tryGet<BodySegment>(e);
        if (link == nullptr || link->chainHead == e) out.push_back(e);
    });
    return out;
}

} // namespace

TEST(an_ant_hole_above_ultra_sends_out_nothing_above_ultra) {
    // The hole is the boss; what comes out of it is not. Its opening guard
    // and every wave the damage releases are held to ultra, however high the
    // hole itself stands.
    for (const Rarity tier : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
        Sim sim;
        const std::uint16_t hole = shipped().mobIndex("ant_hole");
        CHECK(hole != kInvalidIndex);
        const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), hole, tier,
                                                 kCentre, Realm::Overworld, sim.now, sim.rng);
        CHECK(nest != NULL_ENTITY);
        const std::vector<Rarity> guard = minionTiers(sim.world, nest);
        CHECK(!guard.empty());
        for (const Rarity r : guard) CHECK(r == Rarity::Ultra);

        // Nine tenths of it gone in one blow: every band it crossed fires.
        sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max * 0.1;
        sim.tick({});
        const std::vector<Rarity> all = minionTiers(sim.world, nest);
        CHECK(all.size() > guard.size());
        for (const Rarity r : all) CHECK(r == Rarity::Ultra);
    }
}

TEST(a_queen_ant_above_ultra_fields_ultra_soldiers) {
    // Her soldiers come out one tier under her -- and never above ultra, so a
    // unique or apex queen fields ultras rather than supers or uniques.
    for (const Rarity tier : {Rarity::Unique, Rarity::Apex}) {
        Sim sim;
        const std::uint16_t queen = shipped().mobIndex("queen_ant");
        CHECK(queen != kInvalidIndex);
        const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), queen, tier,
                                                 kCentre, Realm::Overworld, sim.now, sim.rng);
        CHECK(nest != NULL_ENTITY);
        for (int i = 0; i < 200; ++i) sim.tick({});
        const std::vector<Rarity> soldiers = minionTiers(sim.world, nest);
        CHECK(!soldiers.empty());
        for (const Rarity r : soldiers) CHECK(r == Rarity::Ultra);
    }
}

TEST(the_minion_cap_never_raises_a_minion) {
    // Below the cap the old rule stands untouched: a mythic queen's soldiers
    // are legendary, one under her, and a mythic hole's guard is mythic.
    Sim sim;
    const Entity queen = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                              shipped().mobIndex("queen_ant"), Rarity::Mythic,
                                              kCentre, Realm::Overworld, sim.now, sim.rng);
    const Entity hole = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                             shipped().mobIndex("ant_hole"), Rarity::Mythic,
                                             kCentre + Vec2{3000.0, 0.0}, Realm::Overworld,
                                             sim.now, sim.rng);
    for (int i = 0; i < 200; ++i) sim.tick({});
    const std::vector<Rarity> soldiers = minionTiers(sim.world, queen);
    CHECK(!soldiers.empty());
    for (const Rarity r : soldiers) CHECK(r == Rarity::Legendary);
    const std::vector<Rarity> guard = minionTiers(sim.world, hole);
    CHECK(!guard.empty());
    for (const Rarity r : guard) CHECK(r == Rarity::Mythic);
}

TEST(a_biome_keeps_only_its_first_unique_and_its_first_apex) {
    // However two got there -- here spawnMob called while both clocks stand
    // ready, which is the one moment the console may place either tier (and
    // spawnMob itself charges nothing) -- the one that appeared LATER is
    // despawned on the next population pass, per tier: one unique and one
    // apex may stand together.
    WorldMaps maps;
    makeBandedWorld(maps, {Rect{kCentre.x + 12000.0, kCentre.y + 12000.0, 500.0, 500.0}}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    sim.tick({});   // the zones, and with them the biome of each realm
    onlyClock(sim).uniqueReadyMillis = 0.0;
    onlyClock(sim).apexReadyMillis = 0.0;

    const std::uint16_t bee = shipped().mobIndex("bee");
    const auto spawn = [&](Rarity tier, double dx) {
        return sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee, tier,
                                    kCentre + Vec2{dx, 0.0}, Realm::Overworld, sim.now, sim.rng);
    };
    const Entity firstUnique = spawn(Rarity::Unique, 0.0);
    const Entity firstApex = spawn(Rarity::Apex, 1500.0);
    const Entity secondUnique = spawn(Rarity::Unique, 3000.0);
    const Entity secondApex = spawn(Rarity::Apex, 4500.0);
    const Entity thirdUnique = spawn(Rarity::Unique, 6000.0);
    sim.jump(kPopulationIntervalMillis, {});

    CHECK(sim.world.isAlive(firstUnique));
    CHECK(sim.world.isAlive(firstApex));
    CHECK(!sim.world.isAlive(secondUnique));
    CHECK(!sim.world.isAlive(secondApex));
    CHECK(!sim.world.isAlive(thirdUnique));
    CHECK_EQ(animalsOfRarity(sim.world, Rarity::Unique).size(), std::size_t(1));
    CHECK_EQ(animalsOfRarity(sim.world, Rarity::Apex).size(), std::size_t(1));

    // Despawned, not killed: nothing died, so nothing pays out.
    Query<MobTag, Dead> corpses{sim.world};
    CHECK_EQ(corpses.count(), std::size_t(0));
}

TEST(an_extra_unique_centipede_goes_with_its_whole_body) {
    // Counted per animal: one unique centipede is one unique, not a head and
    // a dozen more. And the extra one leaves nothing behind -- its segments
    // are bosses too, and a boss is never recycled, so a body left standing
    // would stand there for good.
    Sim sim;
    const std::uint16_t centipede = shipped().mobIndex("centipede");
    CHECK(centipede != kInvalidIndex);
    const Entity first = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), centipede,
                                              Rarity::Unique, kCentre, Realm::Overworld, sim.now,
                                              sim.rng);
    sim.jump(kPopulationIntervalMillis, {});
    CHECK(sim.world.isAlive(first));   // alone, it is not an extra

    const Entity second = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), centipede,
                                               Rarity::Unique, kCentre + Vec2{0.0, 4000.0},
                                               Realm::Overworld, sim.now, sim.rng);
    const auto bodyOf = [&](Entity head) {
        int n = 0;
        Query<BodySegment> segments{sim.world};
        segments.each([&](Entity e, BodySegment& link) {
            if (e != head && link.chainHead == head) ++n;
        });
        return n;
    };
    CHECK(bodyOf(first) > 0);
    CHECK(bodyOf(second) > 0);
    const int firstBody = bodyOf(first);
    sim.jump(kPopulationIntervalMillis, {});

    CHECK(sim.world.isAlive(first));
    CHECK_EQ(bodyOf(first), firstBody);
    CHECK(!sim.world.isAlive(second));
    CHECK_EQ(bodyOf(second), 0);
}

TEST(a_ready_clock_waits_while_its_tier_is_standing_in_the_biome) {
    // A unique already in the biome: the ready clock does not roll at all,
    // so no super comes out a unique only to be despawned, and the clock is
    // still ready for the first super after that unique is gone.
    SuperBand world;
    world.deal();
    // Ready BEFORE the unique is placed: a cooling clock would refuse it.
    SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
    clock.uniqueReadyMillis = 0.0;
    clock.apexReadyMillis = world.sim.now + kApexSpawnCooldownMillis;
    const Entity standing = world.sim.spawner.spawnMob(
        world.sim.world, world.sim.terrain, shipped(), shipped().mobIndex("bee"), Rarity::Unique,
        Vec2{world.band.x + world.band.w * 0.5, world.band.y + world.band.h * 0.5},
        Realm::Overworld, world.sim.now, world.sim.rng);
    CHECK(standing != NULL_ENTITY);
    world.fill();

    CHECK(world.sim.world.isAlive(standing));
    CHECK_EQ(animalsOfRarity(world.sim.world, Rarity::Unique).size(), std::size_t(1));
    CHECK(mobsOfRarity(world.sim.world, Rarity::Super) > 20);
    CHECK_EQ(onlyClock(world.sim).uniqueReadyMillis, 0.0);
}

TEST(a_unique_or_apex_asked_for_during_its_cooldown_never_appears) {
    // However it is asked for -- here the path the console and every script
    // take -- a unique or an apex that would appear while its biome's clock
    // for that tier is cooling down is refused before it is an entity:
    // nothing stands, nothing is announced, and a centipede leaves no body
    // behind. Per tier, so a ready unique clock lets a unique through while
    // the apex clock still turns an apex away.
    SuperBand world;
    world.deal();
    SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
    clock.uniqueReadyMillis = world.sim.now + kUniqueSpawnCooldownMillis;
    clock.apexReadyMillis = world.sim.now + kApexSpawnCooldownMillis;
    world.sim.spawner.bossSpawns.clear();

    const std::uint16_t bee = shipped().mobIndex("bee");
    const std::uint16_t centipede = shipped().mobIndex("centipede");
    CHECK(centipede != kInvalidIndex);
    const Vec2 at{world.band.x + world.band.w * 0.5, world.band.y + world.band.h * 0.5};
    const auto spawn = [&](std::uint16_t mob, Rarity tier) {
        return world.sim.spawner.spawnMob(world.sim.world, world.sim.terrain, shipped(), mob,
                                          tier, at, Realm::Overworld, world.sim.now,
                                          world.sim.rng);
    };
    const auto announcedAbove = [&](Rarity floor) {
        int n = 0;
        for (const SpawnSystem::BossSpawn& boss : world.sim.spawner.bossSpawns) {
            n += rarityIndex(boss.rarity) > rarityIndex(floor) ? 1 : 0;
        }
        return n;
    };

    CHECK(spawn(bee, Rarity::Unique) == NULL_ENTITY);
    CHECK(spawn(bee, Rarity::Apex) == NULL_ENTITY);
    CHECK(spawn(centipede, Rarity::Unique) == NULL_ENTITY);
    CHECK(spawn(centipede, Rarity::Apex) == NULL_ENTITY);
    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Unique), 0);
    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Apex), 0);
    CHECK_EQ(announcedAbove(Rarity::Super), 0);
    // Only the two tiers the clocks own: a super is not theirs to refuse.
    CHECK(spawn(bee, Rarity::Super) != NULL_ENTITY);

    // The unique clock runs down; the apex one has not.
    clock.uniqueReadyMillis = world.sim.now;
    const Entity unique = spawn(bee, Rarity::Unique);
    CHECK(unique != NULL_ENTITY);
    CHECK(spawn(bee, Rarity::Apex) == NULL_ENTITY);
    CHECK_EQ(animalsOfRarity(world.sim.world, Rarity::Unique).size(), std::size_t(1));
    CHECK_EQ(mobsOfRarity(world.sim.world, Rarity::Apex), 0);
    CHECK_EQ(announcedAbove(Rarity::Super), 1);
    // Let in, but not charged by spawnMob: the clock's own upgrade, and the
    // console through chargeBossClock, are what start it again.
    CHECK_EQ(onlyClock(world.sim).uniqueReadyMillis, world.sim.now);
}

TEST(charging_a_clock_restarts_only_that_tier_in_that_biome) {
    // What the console calls after placing an admin's boss: that tier's
    // clock starts a whole cooldown over from now, as the band's own upgrade
    // would, and the other tier's clock is left where it was. Nothing for a
    // tier no clock owns, nor for a realm that keeps no clock.
    SuperBand world;
    world.deal();
    SpawnSystem::BiomeBossClock& clock = onlyClock(world.sim);
    clock.uniqueReadyMillis = 0.0;
    clock.apexReadyMillis = 0.0;
    const double now = world.sim.now;

    world.sim.spawner.chargeBossClock(Rarity::Super, Realm::Overworld, now);
    world.sim.spawner.chargeBossClock(Rarity::Unique, Realm::Arena, now);
    CHECK_EQ(onlyClock(world.sim).uniqueReadyMillis, 0.0);
    CHECK_EQ(onlyClock(world.sim).apexReadyMillis, 0.0);

    world.sim.spawner.chargeBossClock(Rarity::Unique, Realm::Overworld, now);
    CHECK_EQ(onlyClock(world.sim).uniqueReadyMillis, now + kUniqueSpawnCooldownMillis);
    CHECK_EQ(onlyClock(world.sim).apexReadyMillis, 0.0);
    CHECK(world.sim.spawner.bossCooldownLeft(Rarity::Unique, Realm::Overworld, now) > 0.0);

    world.sim.spawner.chargeBossClock(Rarity::Apex, Realm::Overworld, now);
    CHECK_EQ(onlyClock(world.sim).apexReadyMillis, now + kApexSpawnCooldownMillis);
}

TEST(a_biome_with_no_clock_refuses_no_unique) {
    // The arena, the maze and a harness with no maps are not biomes and keep
    // no clock, so nothing there is refused on the clock's account.
    Sim sim;
    const std::uint16_t bee = shipped().mobIndex("bee");
    CHECK(sim.spawner.bossCooldownLeft(Rarity::Unique, Realm::Overworld, sim.now) == 0.0);
    CHECK(sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee, Rarity::Apex, kCentre,
                               Realm::Overworld, sim.now, sim.rng) != NULL_ENTITY);

    SuperBand world;
    world.deal();
    onlyClock(world.sim).uniqueReadyMillis = world.sim.now + kUniqueSpawnCooldownMillis;
    CHECK(world.sim.spawner.bossCooldownLeft(Rarity::Unique, Realm::Overworld, world.sim.now) >
          0.0);
    CHECK(world.sim.spawner.bossCooldownLeft(Rarity::Unique, Realm::Arena, world.sim.now) == 0.0);
    CHECK(world.sim.spawner.bossCooldownLeft(Rarity::Unique, Realm::Maze, world.sim.now) == 0.0);
    CHECK(world.sim.spawner.bossCooldownLeft(Rarity::Super, Realm::Overworld, world.sim.now) ==
          0.0);
}

TEST(a_band_stocks_its_own_outline_and_never_the_open_ground_beside_it) {
    // This replaces "ambient mobs spawn inside the buffered viewport". The
    // viewport decides WHETHER a band fills, not WHERE its mobs land: the band
    // here sits off to one side of the flower, well inside their viewport, and
    // the open ground between the two stays empty because nothing fills it.
    //
    // `bee 100%` on purpose: bees nest nothing and tow no body chain, so every
    // mob in the world is a spawn this pass placed and the bound is exact.
    const Rect band{kCentre.x + 800.0, kCentre.y - 1000.0, 2000.0, 2000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "bee 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 200; ++i) sim.tick(players);

    Query<MobTag, Transform> mobs{sim.world};
    int checked = 0;
    mobs.each([&](Entity, MobTag&, Transform& t) {
        ++checked;
        if (!band.contains(t.position)) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "a mob stands outside the only band on the map, at " +
                                         std::to_string(t.position.x) + "," +
                                         std::to_string(t.position.y));
        }
        // Still nobody's lap, whoever the band filled for.
        CHECK(distance(t.position, kCentre) >= kMinSpawnDistance);
    });
    CHECK(checked > 0);
    // The rest of the viewport -- the same screen, one step outside the band --
    // is empty ground and stays that way.
    CHECK_EQ(sim.mobsIn(Rect{kCentre.x - 1400.0, kCentre.y - 1000.0, 2000.0, 2000.0}), 0);
}

TEST(a_crowd_of_players_cannot_exceed_the_global_cap) {
    // Sixty-four flowers standing apart, each with a band of their own. The
    // global cap is the one ceiling left above the bands, and it is what stops
    // a full server from multiplying the population by the number of people on
    // it.
    std::vector<Vec2> players;
    std::vector<Rect> bands;
    for (int y = 0; y < 8; ++y) {
        for (int x = 0; x < 8; ++x) {
            const Vec2 at{3500.0 + x * 7500.0, 3500.0 + y * 7500.0};
            players.push_back(at);
            bands.push_back(Rect{at.x - 3000.0, at.y - 3000.0, 6000.0, 6000.0});
        }
    }
    WorldMaps maps;
    makeBandedWorld(maps, bands, "garden 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    // Between them the bands want several times what the server will allow.
    CHECK(static_cast<int>(bands.size()) * bandTarget(bands.front()) > kMaxLiveMobs);

    for (int i = 0; i < 600; ++i) sim.tick(players);

    CHECK(sim.mobCount() <= kMaxLiveMobs + kMaxNestChildren);
    // And the cap is what stopped it, not an empty world.
    CHECK(sim.spawner.census().mobs > kMaxLiveMobs / 2);
}

TEST(mobs_nobody_has_been_near_stop_being_entities) {
    // The recycler, which is where a mob STOPS being simulated. What happens
    // to it then depends on whether a band is holding a slot for it -- a band
    // mob goes back to being a record where it stands, an escort or a fixture
    // is simply gone -- and that half is
    // a_mob_nobody_is_near_becomes_a_record_again_and_comes_back's business.
    // This one pins the timing: the grace period, and that an empty viewer
    // list is permissive rather than a purge.
    const Rect band{kCentre.x - 3000.0, kCentre.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "garden 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 200; ++i) sim.tick(players);
    const int populated = sim.mobsWithin(kCentre, 4000.0);
    CHECK(populated > 0);
    const int despawnedBefore = sim.spawner.census().despawnedTotal;

    // An EMPTY viewer list is permissive, not a purge. The reference's
    // near-a-player test answers TRUE for every point when it saw no player at
    // all, so an unattended server keeps its population rather than emptying
    // itself and handing the next arrival a barren map.
    const std::vector<Vec2> nobody;
    sim.jump(kMobDespawnDelayMillis + 1000.0, nobody);
    sim.jump(kMobDespawnDelayMillis + 1000.0, nobody);
    CHECK_EQ(sim.mobsWithin(kCentre, 4000.0), populated);
    CHECK_EQ(sim.spawner.census().despawnedTotal, despawnedBefore);

    // A player who WALKS AWAY is what starts the clock: every flower's own
    // viewport box is tested, and a mob outside all of them stops being an
    // entity once it has been unseen for the grace period.
    const std::vector<Vec2> elsewhere{Vec2{90000.0, 90000.0}};
    sim.tick(elsewhere);
    CHECK_EQ(sim.mobsWithin(kCentre, 4000.0), populated);   // not immediately

    // Twice: nests are ticked before the census, so a nest on the way out can
    // still have placed one escort this pass, and that escort's own grace
    // period starts now.
    sim.jump(kMobDespawnDelayMillis + 1000.0, elsewhere);
    sim.jump(kMobDespawnDelayMillis + 1000.0, elsewhere);
    CHECK_EQ(sim.mobsWithin(kCentre, 4000.0), 0);
    CHECK(sim.spawner.census().despawnedTotal >= despawnedBefore + populated);
}

TEST(the_shipped_map_grows_its_own_biomes_roster) {
    // The shape of the game's own data: garden.tmj draws art, a door and a
    // handful of bands, and declares no map properties at all -- so the map's
    // biome falls back to its id and its default mob group falls back to its
    // biome. That group is what a band with no `mobs` of its own asks for, and
    // it is also what the bands the author HAS written name. A map that
    // resolved to an empty group would stand a player in an empty world,
    // silently, which is what this pins.
    if (!shippedMaps().forRealm(Realm::Overworld)) {
        ::testing::reportFailure(__FILE__, __LINE__, "the shipped maps did not load");
        return;
    }
    const MapData& world = *shippedMaps().forRealm(Realm::Overworld);
    CHECK_EQ(world.defaultMobGroup(), std::string("garden"));
    const std::uint16_t garden = shipped().mobGroupIndex(world.defaultMobGroup());
    CHECK(garden != kInvalidIndex);
    // The author adds bands, and gives some of them rosters of their own, as
    // the map is balanced. What every band owes is that each row it names is
    // something the content actually defines: a group, or a mob id. A row that
    // resolves to neither is a typo the fill would answer with an empty band.
    for (const MapElement& element : world.elements()) {
        if (!element.isSpawnBand() && !element.isMobRegion()) continue;
        for (const ZoneMobEntry& row : element.mobDistribution) {
            if (shipped().mobGroupIndex(row.name) == kInvalidIndex &&
                shipped().mobIndex(row.name) == kInvalidIndex) {
                ::testing::reportFailure(__FILE__, __LINE__,
                                         "a band on the shipped map names \"" + row.name +
                                             "\", which is neither a mob group nor a mob");
            }
        }
    }

    Sim sim;
    sim.spawner.worldMaps = &shippedMaps();
    // Standing where the author drew a band, because a band is the only thing
    // that spawns anything: elsewhere on this map there is nothing to measure.
    // The Sim's terrain is its own flat grid, so this is about which GROUP the
    // band asks for, not about walls.
    const Vec2 at = firstBandCentre(world);
    const std::vector<Vec2> players{at};
    for (int i = 0; i < 300; ++i) sim.tick(players);

    int checked = 0;
    Query<MobTag, MobType, Transform> mobs{sim.world};
    mobs.each([&](Entity e, MobTag&, MobType& type, Transform& transform) {
        // An escort is not an ambient spawn. `ant_hole` IS a garden mob, and
        // what it puts in the world is a hell of ants that are in no garden
        // group at all -- the band chose the hole, the hole chose them. Same
        // exemption the hard-band test makes, and for the same reason.
        if (sim.isChildOfAPlacedMob(e)) return;
        ++checked;
        const MobConfig& config = shipped().mob(type.configIndex);
        bool member = false;
        for (const MobGroupMember& entry : config.groups) member |= entry.group == garden;
        // Body segments follow their head into the world and belong to no
        // group of their own; everything else answers for itself.
        if (config.id.find("_body") == std::string::npos && !member) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "not a garden mob: " + config.id);
        }
    });
    CHECK(checked > 0);
}

TEST(the_region_under_a_spawn_decides_its_group) {
    // Authored here rather than read out of the shipped map: the shipped map
    // has no regions at all now, and this is a test of the SPAWNER, not of the
    // game's art. See authoredMap().
    if (!authoredMap().loaded()) {
        ::testing::reportFailure(__FILE__, __LINE__, "the authored fixture map did not load");
        return;
    }
    Sim sim;
    sim.spawner.worldMaps = &authoredMaps();
    const std::vector<Vec2> players{kCentre};
    for (int i = 0; i < 300; ++i) sim.tick(players);

    // The band over kCentre names no mobs of its own, so it asks the ground
    // under it -- and the region covering the whole map answers with the ant
    // hell's roster. Only that band is judged: the map also carries the dummy
    // row and a hornet band, both of which name their own rows and asked this
    // region for nothing.
    const std::uint16_t antHell = shipped().mobGroupIndex("ant_hell");
    CHECK(antHell != kInvalidIndex);
    const Rect regionBand{24000.0, 24000.0, 12000.0, 12000.0};
    Query<MobTag, MobType, Transform> mobs{sim.world};
    int checked = 0;
    mobs.each([&](Entity, MobTag&, MobType& type, Transform& transform) {
        if (!regionBand.contains(transform.position)) return;
        ++checked;
        const MobConfig& config = shipped().mob(type.configIndex);
        bool member = false;
        for (const MobGroupMember& entry : config.groups) member |= entry.group == antHell;
        // Body segments follow their head into the world and belong to no
        // group of their own; everything else answers for itself.
        if (config.id.find("_body") == std::string::npos && !member) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "not an ant hell mob: " + config.id + " " +
                                         rarityName(type.rarity) + " at " +
                                         std::to_string(transform.position.x) + "," +
                                         std::to_string(transform.position.y));
        }
    });
    CHECK(checked > 0);
}

TEST(no_mob_is_placed_inside_a_wall) {
    const Vec2 player = Terrain::tileCenter(100, 100);
    // A band over the flower, because nothing else places a mob any more, and a
    // solid block of wall inside that band. Solid rather than scattered so the
    // test asserts the invariant instead of the push-out solver's tolerance for
    // pathological geometry.
    const Rect band{player.x - 3000.0, player.y - 3000.0, 6000.0, 6000.0};
    WorldMaps maps;
    makeBandedWorld(maps, {band}, "garden 100%");
    Sim sim;
    sim.spawner.worldMaps = &maps;
    for (int ty = 96; ty <= 104; ++ty) {
        for (int tx = 103; tx <= 109; ++tx) sim.terrain.setTile(tx, ty, Tile::Wall);
    }
    const std::vector<Vec2> players{player};

    for (int i = 0; i < 300; ++i) sim.tick(players);

    Query<MobTag, Transform> mobs{sim.world};
    int checked = 0;
    mobs.each([&](Entity, MobTag&, Transform& t) {
        ++checked;
        CHECK(!sim.terrain.blocked(t.position, Realm::Overworld));
    });
    CHECK(checked > 0);

    // The same holds for a caller that asks for a spot in the middle of the
    // wall: a request is a request, not a promise.
    const std::uint16_t ant = shipped().mobIndex("soldier_ant");
    for (int i = 0; i < 100; ++i) {
        const Vec2 inWall = Terrain::tileCenter(106, 100) + sim.rng.insideCircle(200.0);
        const Entity e = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), ant,
                                              Rarity::Common, inWall, Realm::Overworld, 0.0, sim.rng);
        CHECK(e != NULL_ENTITY);
        CHECK(!sim.terrain.blocked(sim.world.get<Transform>(e).position, Realm::Overworld));
    }
}

TEST(a_spawned_mob_carries_everything_the_simulation_needs) {
    Sim sim;
    const std::uint16_t bee = shipped().mobIndex("bee");
    const Entity e = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee, Rarity::Rare,
                                          kCentre, Realm::Overworld, 1234.0, sim.rng);
    CHECK(e != NULL_ENTITY);
    CHECK(sim.world.has<MobTag>(e));
    CHECK(sim.world.has<Motion>(e));
    CHECK(sim.world.has<Knockback>(e));
    CHECK(sim.world.has<HitCooldowns>(e));
    CHECK(sim.world.has<Afflictions>(e));
    CHECK(sim.world.has<AmbientMob>(e));

    const MobStats stats = shipped().mobStats(bee, Rarity::Rare);
    CHECK_NEAR(sim.world.get<Health>(e).max, stats.health, 1e-9);
    CHECK_NEAR(sim.world.get<Health>(e).current, stats.health, 1e-9);
    CHECK_NEAR(sim.world.get<Body>(e).radius, stats.radius, 1e-9);
    CHECK_NEAR(sim.world.get<Bounty>(e).xp, stats.xp, 1e-9);
    CHECK_EQ(sim.world.get<Replicated>(e).kind, net::EntityKind::Mob);
    CHECK_EQ(sim.world.get<Replicated>(e).typeIndex, bee);
    // No allocator wired up: the mob simulates and simply is not replicated.
    CHECK(!sim.world.has<NetId>(e));
    CHECK_NEAR(sim.world.get<AmbientMob>(e).lastNearPlayerMillis, 1234.0, 1e-9);
}

TEST(a_leech_reaches_the_world_as_a_whole_animal) {
    Sim sim;
    // The leech is the second family built out of a head and a trailing body,
    // and the head->body link is resolved from the ID rather than from a field
    // -- so a leech spawning as a lone head is exactly what a typo in that rule
    // looks like, and nothing else in the game would complain about it.
    const std::uint16_t leech = shipped().mobIndex("leech");
    const std::uint16_t body = shipped().mobIndex("leech_body");
    const Entity head = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), leech,
                                             Rarity::Rare, kCentre, Realm::Overworld, 0.0, sim.rng);
    CHECK(head != NULL_ENTITY);
    CHECK(sim.world.get<BodySegment>(head).head);

    // Collected by the link back to the head, which is the one the spawner
    // builds the chain along.
    std::vector<Entity> chain(kCentipedeSegmentCount + 1, NULL_ENTITY);
    Query<BodySegment> segments{sim.world};
    segments.each([&](Entity e, BodySegment& link) {
        if (link.chainHead != head || link.head) return;
        CHECK(link.segmentIndex >= 1 && link.segmentIndex <= kCentipedeSegmentCount);
        if (link.segmentIndex >= 1 && link.segmentIndex <= kCentipedeSegmentCount) {
            CHECK_EQ(chain[static_cast<std::size_t>(link.segmentIndex)], NULL_ENTITY);
            chain[static_cast<std::size_t>(link.segmentIndex)] = e;
        }
    });

    // Every segment is a leech_body at the HEAD's tier, each trailing the one
    // in front of it at the spacing the chain pass will hold it to.
    const double bodyRadius = shipped().mobStats(body, Rarity::Rare).radius;
    chain[0] = head;
    for (int i = 1; i <= kCentipedeSegmentCount; ++i) {
        const Entity e = chain[static_cast<std::size_t>(i)];
        CHECK(e != NULL_ENTITY);
        if (e == NULL_ENTITY) continue;
        CHECK_EQ(sim.world.get<BodySegment>(e).ahead, chain[static_cast<std::size_t>(i - 1)]);
        CHECK_EQ(sim.world.get<Replicated>(e).typeIndex, body);
        CHECK_NEAR(sim.world.get<Body>(e).radius, bodyRadius, 1e-9);
        CHECK_NEAR(sim.world.get<BodySegment>(e).spacing,
                   bodyRadius * kSegmentSpacingPerRadius, 1e-9);
        // Joined BOTH ways from birth, and sharing one pool. The damage path
        // walks the chain forwards from the head to spread the pool, and a
        // leech shot on the tick it spawned -- before the chain pass has ever
        // run -- must be as whole an animal as one that has been crawling for
        // a minute.
        CHECK_EQ(sim.world.get<BodySegment>(chain[static_cast<std::size_t>(i - 1)]).behind, e);
        CHECK(sim.world.get<BodySegment>(e).sharedHealth);
    }
    CHECK(sim.world.get<BodySegment>(head).sharedHealth);
    CHECK_EQ(sim.world.get<BodySegment>(chain[kCentipedeSegmentCount]).behind, NULL_ENTITY);
}

TEST(a_shipped_leech_dies_whole_when_its_tail_is_finished) {
    Sim sim;
    // The shipped animal, spawned by the real path and killed through the real
    // one: the synthetic chains in combat_tests prove the rule, and this proves
    // the leech in the ocean is wired to it.
    const std::uint16_t leech = shipped().mobIndex("leech");
    const Entity head = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), leech,
                                             Rarity::Common, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    CHECK(head != NULL_ENTITY);

    Entity tail = head;
    for (int i = 0; i < kCentipedeSegmentCount; ++i) {
        const Entity next = sim.world.get<BodySegment>(tail).behind;
        CHECK(next != NULL_ENTITY);
        if (next == NULL_ENTITY) break;
        tail = next;
    }

    const Entity player = sim.world.create();
    sim.world.add<Transform>(player, Transform{kCentre, 0.0});
    sim.world.add<PlayerTag>(player);
    sim.world.add<Faction>(player, Faction{Team::Players, false});

    // Half the animal's health, thrown at the very last body. One pool, so the
    // head's bar moves and the tail is still standing.
    CombatSystem combat;
    const double pool = sim.world.get<Health>(head).max;
    CHECK(pool > 0.0);
    // Measured off what the hit actually took: the leech wears the tier's
    // armour, and this test is about where the health went, not how much of it
    // a common leech's armour turns away.
    const DamageResult first = combat.applyDamage(sim.world, tail, player, pool * 0.5, 0.0);
    CHECK(first.applied > 0.0);
    const double left = pool - first.applied;
    CHECK_NEAR(sim.world.get<Health>(head).current, left, 1e-9);
    CHECK_NEAR(sim.world.get<Health>(tail).current,
               sim.world.get<Health>(tail).max * (left / pool), 1e-9);
    CHECK(!sim.world.has<Dead>(head));

    // The rest of it finishes the animal, not the bead.
    combat.applyDamage(sim.world, tail, player, pool, 100.0);
    CHECK_EQ(combat.deaths().size(), std::size_t(kCentipedeSegmentCount + 1));
    Entity at = head;
    for (int i = 0; i <= kCentipedeSegmentCount; ++i) {
        CHECK(sim.world.has<Dead>(at));
        CHECK_EQ(sim.world.get<Dead>(at).killer, player);
        // One ledger for the whole leech: the bodies pay no XP of their own,
        // reserve no loot slot and enter no kill gallery.
        if (i > 0) CHECK(sim.world.get<Bounty>(at).contributors.empty());
        at = sim.world.get<BodySegment>(at).behind;
    }
    CHECK_EQ(sim.world.get<Bounty>(head).contributors.size(), std::size_t(1));
}

TEST(random_size_jitters_the_body_and_nothing_else) {
    Sim sim;
    // `cactus` ships random_size [1, 2] -- gardn's cactus, 30 to 60 across.
    const std::uint16_t cactus = shipped().mobIndex("cactus");
    const MobConfig& config = shipped().mob(cactus);
    CHECK(config.randomSizeMax > config.randomSizeMin);

    const MobStats stats = shipped().mobStats(cactus, Rarity::Common);
    // `random_size` is an ABSOLUTE size range, not a factor, so the reference
    // divides the roll by the config's own nominal `size` before using it as a
    // multiplier. The cactus is size 1.5 with a [1, 2] range, so its bodies come
    // out between 0.667x and 1.333x -- not between 1x and 2x.
    const double lowest = config.randomSizeMin / config.size;
    const double highest = config.randomSizeMax / config.size;
    CHECK_NEAR(lowest, 1.0 / 1.5, 1e-12);
    CHECK_NEAR(highest, 2.0 / 1.5, 1e-12);

    bool sawSmall = false;
    bool sawLarge = false;
    for (int i = 0; i < 200; ++i) {
        const Entity e = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), cactus,
                                              Rarity::Common, kCentre, Realm::Overworld, 0.0, sim.rng);
        const double jitter = sim.world.get<MobType>(e).sizeJitter;
        CHECK(jitter >= lowest);
        CHECK(jitter <= highest);
        CHECK_NEAR(sim.world.get<Body>(e).radius, stats.radius * jitter, 1e-9);
        // Mass is NOT jittered. It is derived from the config size and the
        // rarity step alone (`mass = size * size` in the stat table), so a
        // cactus that rolled a big body is exactly as easy to knock back as
        // one that rolled a small one.
        CHECK_NEAR(sim.world.get<Body>(e).mass, stats.mass, 1e-9);
        sawSmall = sawSmall || jitter < 0.8;
        sawLarge = sawLarge || jitter > 1.2;
    }
    CHECK(sawSmall);
    CHECK(sawLarge);

    // A mob with no random_size gets exactly its configured size.
    const Entity bee = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                            shipped().mobIndex("bee"), Rarity::Common, kCentre, Realm::Overworld,
                                            0.0, sim.rng);
    CHECK_NEAR(sim.world.get<MobType>(bee).sizeJitter, 1.0, 1e-12);
}

// ---------------------------------------------------------------------------
// Nests
// ---------------------------------------------------------------------------

TEST(a_nest_places_its_initial_escorts) {
    Sim sim;
    const std::uint16_t hole = shipped().mobIndex("ant_hole");
    const MobConfig& config = shipped().mob(hole);
    CHECK(config.initialSpawns.size() == std::size_t(6));

    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), hole,
                                             Rarity::Common, kCentre, Realm::Overworld, 0.0, sim.rng);
    CHECK(nest != NULL_ENTITY);
    CHECK_EQ(sim.mobCount(), 1 + static_cast<int>(config.initialSpawns.size()));
    CHECK(sim.world.has<NestWaves>(nest));
    // The nest itself is still addressable after spawning six escorts, which is
    // the archetype-relocation trap this ordering exists to avoid.
    CHECK_EQ(sim.world.get<MobType>(nest).configIndex, hole);
}

TEST(a_nest_sends_its_waves_as_it_is_worn_down_and_holds_at_the_last) {
    Sim sim;
    const std::uint16_t hole = shipped().mobIndex("ant_hole");
    const std::size_t waveCount = shipped().mob(hole).spawnWaves.size();
    CHECK(waveCount > 1);
    const int lastWave = static_cast<int>(waveCount) - 1;

    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), hole,
                                             Rarity::Common, kCentre, Realm::Overworld, 0.0, sim.rng);
    const std::vector<Vec2> players{kCentre};
    // Counted off the nest rather than off the world, so a band fill running
    // beside it could never be mistaken for one of this hole's waves.
    const auto escortCount = [&] {
        return sim.world.get<NestWaves>(nest).children.size();
    };
    const std::size_t afterInitial = escortCount();

    // A hole answers DAMAGE, not a clock. Each wave hangs off an HP threshold
    // (gardn's kAntHole) and every band crossed on the way down fires, so a
    // hole nobody is hitting sends nothing however long it stands there.
    sim.now += kNestWaveIntervalMillis * 5.0;
    sim.tick(players);
    CHECK_EQ(escortCount(), afterInitial);
    CHECK_EQ(sim.world.get<NestWaves>(nest).nextWave, 0);

    // Half its health off releases every band it crossed on the way there.
    sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max * 0.5;
    sim.now += net::kTickMillis;
    sim.tick(players);
    const int halfway = static_cast<int>(sim.world.get<NestWaves>(nest).nextWave);
    CHECK(halfway > 0);
    CHECK(halfway < lastWave);
    CHECK(escortCount() > afterInitial);
    // Every one of them is tethered to the hole that sent it, so leading them
    // away cannot strip it of its defenders.
    for (const Entity escort : sim.world.get<NestWaves>(nest).children) {
        CHECK(sim.world.has<HoleTether>(escort));
        CHECK_EQ(sim.world.get<HoleTether>(escort).hole, nest);
    }

    // Healing only moves the mark: a rise in health sends nothing, which is
    // what stops a regenerating hole from emptying its list into the world.
    const std::size_t beforeHeal = escortCount();
    sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max;
    sim.now += net::kTickMillis;
    sim.tick(players);
    CHECK_EQ(escortCount(), beforeHeal);
    CHECK_EQ(static_cast<int>(sim.world.get<NestWaves>(nest).nextWave), halfway);

    // Worn to nothing in one blow. The band index is clamped at both ends, so
    // an overkill that drives health far negative sends the rest of the list
    // once rather than spinning millions of skipped iterations.
    const std::vector<Entity> escorts = sim.world.get<NestWaves>(nest).children;
    for (const Entity escort : escorts) sim.world.destroy(escort);
    sim.world.get<Health>(nest).current = -1e6;
    sim.now += net::kTickMillis;
    sim.tick(players);
    CHECK_EQ(static_cast<int>(sim.world.get<NestWaves>(nest).nextWave), lastWave);
    CHECK(escortCount() > 0);
}

TEST(every_nest_sends_its_escorts_up_out_of_its_centre) {
    // A hole and a server alike: the opening guard and the waves both. The
    // fire ant hole has neither -- it is an ambush, and its brood is held to
    // the same rule in a_fire_ant_hole_waits_for_a_flower_then_sends_its_whole_brood.
    for (const char* id : {"ant_hole", "server"}) {
        Sim sim;
        const std::uint16_t type = shipped().mobIndex(id);
        const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                                 Rarity::Legendary, kCentre, Realm::Overworld,
                                                 0.0, sim.rng);
        const Vec2 mouth = sim.world.get<Transform>(nest).position;

        // The opening guard: everything in the world but the nest is one of them.
        int guard = 0;
        Query<MobTag, Transform> mobs{sim.world};
        mobs.each([&](Entity e, MobTag&, Transform& t) {
            if (e == nest) return;
            ++guard;
            CHECK(distance(t.position, mouth) <= kEscortSpawnScatter + 1e-9);
        });
        CHECK_EQ(guard, static_cast<int>(shipped().mob(type).initialSpawns.size()));

        // And a wave, which is what a player digging into it actually watches.
        sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max * 0.5;
        sim.tick({kCentre});
        const std::vector<Entity> wave = sim.world.get<NestWaves>(nest).children;
        CHECK(!wave.empty());
        for (const Entity escort : wave) {
            const double gap = distance(sim.world.get<Transform>(escort).position, mouth);
            CHECK(gap <= kEscortSpawnScatter + 1e-9);
            // Off dead centre, or two of them would never separate.
            CHECK(gap > 0.0);
            // And free to climb out of it without the two shoving each other.
            CHECK(sim.world.get<HoleTether>(escort).emerging);
        }
    }
}

TEST(a_queen_lays_her_soldiers_out_of_her_centre) {
    Sim sim;
    const Entity queen = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                              shipped().mobIndex("queen_ant"), Rarity::Rare,
                                              kCentre, Realm::Overworld, 0.0, sim.rng);
    // Due on the tick she appears.
    sim.tick({kCentre});
    const std::vector<Entity> brood = sim.world.get<Spawner>(queen).children;
    CHECK_EQ(brood.size(), std::size_t(1));
    for (const Entity soldier : brood) {
        const double gap = distance(sim.world.get<Transform>(soldier).position,
                                    sim.world.get<Transform>(queen).position);
        CHECK(gap <= kEscortSpawnScatter + 1e-9);
        CHECK(sim.world.get<HoleTether>(soldier).emerging);
    }
}

// ---------------------------------------------------------------------------
// The fire ant hole: an ambush
// ---------------------------------------------------------------------------

namespace {

/// How far from a nest's centre a base-size flower stands when it is `margin`
/// outside the ambush's trigger gap (negative: inside it).
double ambushStandOff(World& world, Entity nest, const AmbushSpec& spec, double margin) {
    return world.get<Body>(nest).radius + kPlayerBaseRadius + spec.triggerDistance + margin;
}

Entity makeFighter(World& world, Vec2 at) {
    const Entity flower = makePlayer(world, at);
    world.add<Faction>(flower, Faction{Team::Players, false});
    return flower;
}

} // namespace

TEST(a_fire_ant_hole_waits_for_a_flower_then_sends_its_whole_brood) {
    Sim sim;
    const std::uint16_t type = shipped().mobIndex("fire_ant_hole");
    const AmbushSpec& spec = shipped().mob(type).ambush;
    CHECK(spec.present);
    CHECK(spec.count > 0);
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                             Rarity::Legendary, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    CHECK(nest != NULL_ENTITY);
    // Nothing comes up with it.
    CHECK_EQ(sim.mobCount(), 1);
    const Vec2 mouth = sim.world.get<Transform>(nest).position;

    // Just outside the trigger gap, for a good while: still nothing.
    const Entity flower = makePlayer(
        sim.world, mouth + Vec2{ambushStandOff(sim.world, nest, spec, 5.0), 0.0});
    for (int i = 0; i < 30; ++i) sim.tick({kCentre});
    CHECK_EQ(sim.mobCount(), 1);
    CHECK(!sim.world.get<AmbushNest>(nest).released);

    // A step inside it: every one of them, at once, and every one a soldier
    // fire ant climbing out of the middle of the hole.
    sim.world.get<Transform>(flower).position =
        mouth + Vec2{ambushStandOff(sim.world, nest, spec, -5.0), 0.0};
    sim.tick({kCentre});
    const std::vector<Entity> brood = sim.world.get<AmbushNest>(nest).brood;
    CHECK_EQ(static_cast<int>(brood.size()), spec.count);
    CHECK_EQ(sim.mobCount(), 1 + spec.count);
    for (const Entity ant : brood) {
        CHECK_EQ(sim.world.get<MobType>(ant).configIndex, shipped().mobIndex("soldier_fire_ant"));
        const double gap = distance(sim.world.get<Transform>(ant).position, mouth);
        CHECK(gap <= kEscortSpawnScatter + 1e-9);
        CHECK(gap > 0.0);
        CHECK_EQ(sim.world.get<HoleTether>(ant).hole, nest);
        CHECK(sim.world.get<HoleTether>(ant).emerging);
    }

    // One burst and no more, however long the flower stands there.
    for (int i = 0; i < 30; ++i) sim.tick({kCentre});
    CHECK_EQ(sim.mobCount(), 1 + spec.count);
}

TEST(a_corpse_at_the_rim_does_not_spring_a_fire_ant_hole) {
    Sim sim;
    const std::uint16_t type = shipped().mobIndex("fire_ant_hole");
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                             Rarity::Rare, kCentre, Realm::Overworld, 0.0, sim.rng);
    const Vec2 mouth = sim.world.get<Transform>(nest).position;
    const Entity corpse = makePlayer(sim.world, mouth + Vec2{0.0, 1.0});
    sim.world.add<Dead>(corpse, Dead{NULL_ENTITY});
    // In another realm at the same numbers is nobody here either.
    const Entity elsewhere = makePlayer(sim.world, mouth);
    sim.world.get<Transform>(elsewhere).realm = Realm::Arena;
    for (int i = 0; i < 10; ++i) sim.tick({kCentre});
    CHECK_EQ(sim.mobCount(), 1);
    CHECK(!sim.world.get<AmbushNest>(nest).released);
}

TEST(a_fire_ant_hole_cannot_be_touched) {
    Sim sim;
    const std::uint16_t type = shipped().mobIndex("fire_ant_hole");
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                             Rarity::Legendary, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    CHECK(sim.world.has<Intangible>(nest));
    // No touch to hurt a flower with, and nothing for another mob to push.
    CHECK(!sim.world.has<ContactDamage>(nest));
    CHECK(shipped().mob(type).noMobCollision);

    const Entity flower = makeFighter(sim.world, sim.world.get<Transform>(nest).position);
    CHECK(!CombatSystem::canHit(sim.world, nest, flower, 0.0));
}

TEST(a_fire_ant_hole_falls_with_its_last_ant_and_pays_everyone_who_fought) {
    // Super: the brood is held to ultra, so its ants carry a sliver of the
    // hole's own health and the forwarded ledger has to be scaled to it.
    Sim sim;
    const std::uint16_t type = shipped().mobIndex("fire_ant_hole");
    const AmbushSpec& spec = shipped().mob(type).ambush;
    CHECK(spec.count >= 2);
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                             Rarity::Super, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    CHECK(nest != NULL_ENTITY);
    const Vec2 mouth = sim.world.get<Transform>(nest).position;
    const Entity helper = makeFighter(sim.world, mouth + Vec2{0.0, 1.0});
    const Entity finisher = makeFighter(sim.world, mouth + Vec2{1.0, 0.0});
    sim.tick({kCentre});
    const std::vector<Entity> brood = sim.world.get<AmbushNest>(nest).brood;
    CHECK_EQ(static_cast<int>(brood.size()), spec.count);
    if (brood.size() < 2) return;

    CombatSystem combat;
    const auto kill = [&](Entity ant, Entity by) {
        // Exactly what it has, through its armour: the helper's whole
        // contribution is one ant.
        const double swing = sim.world.get<Health>(ant).max +
                             std::max(0.0, CombatSystem::effectiveArmor(sim.world, ant, sim.now));
        combat.applyDamage(sim.world, ant, by, swing, sim.now);
        CHECK(sim.world.has<Dead>(ant));
    };

    kill(brood[0], helper);
    for (std::size_t i = 1; i + 1 < brood.size(); ++i) {
        kill(brood[i], finisher);
        CHECK(!sim.world.has<Dead>(nest));
    }
    CHECK(!sim.world.has<Dead>(nest));

    // The last of them takes the hole with it, killed by whoever finished it.
    kill(brood.back(), finisher);
    CHECK(sim.world.has<Dead>(nest));
    CHECK_EQ(sim.world.get<Dead>(nest).killer, finisher);
    bool recorded = false;
    for (const CombatSystem::DeathRecord& death : combat.deaths()) {
        if (death.entity == nest) recorded = true;
    }
    CHECK(recorded);
    // Its health bar never moved: the hole was never hit.
    CHECK_NEAR(sim.world.get<Health>(nest).current, sim.world.get<Health>(nest).max, 1e-9);

    // The ledger is the brood's fight, scaled to the hole: both flowers clear
    // the loot floor, the helper with one ant of ten. Unscaled, one ultra ant
    // is under 1% of a super hole and the helper would get nothing.
    const Bounty& bounty = sim.world.get<Bounty>(nest);
    std::vector<Bounty::Share> ranked = bounty.contributors;
    std::stable_sort(ranked.begin(), ranked.end(),
                     [](const Bounty::Share& a, const Bounty::Share& b) {
                         return a.damage > b.damage;
                     });
    // The whole brood is worth the whole hole -- a little over, by the armour
    // each swing had to get through, since the ledger books the swing.
    double total = 0;
    for (const Bounty::Share& share : ranked) total += share.damage;
    CHECK(total >= sim.world.get<Health>(nest).max * (1.0 - 1e-9));
    CHECK(total <= sim.world.get<Health>(nest).max * 1.05);
    std::vector<Entity> paid;
    selectLootRecipients(ranked, lootSlotsForRarity(Rarity::Super), nullptr, paid,
                         lootDamageFloor(sim.world.get<Health>(nest).max));
    CHECK(std::find(paid.begin(), paid.end(), helper) != paid.end());
    CHECK(std::find(paid.begin(), paid.end(), finisher) != paid.end());

    // And the loot pass treats it as the corpse it is: the hole's drops land.
    // The flowers step back first, or they would pick them up the same tick.
    sim.world.get<Transform>(helper).position = mouth + Vec2{5000.0, 0.0};
    sim.world.get<Transform>(finisher).position = mouth + Vec2{-5000.0, 0.0};
    LootSystem loot;
    EventQueue events;
    SpatialGrid grid;
    rebuildGrid(sim.world, grid);
    loot.run(sim.world, grid, shipped(), sim.rng, sim.now, net::kTickSeconds, sim.commands,
             events);
    sim.commands.flush();
    CHECK(!liveDrops(sim.world).empty());
}

TEST(a_fire_ant_hole_whose_brood_vanished_unbeaten_is_armed_again) {
    Sim sim;
    const std::uint16_t type = shipped().mobIndex("fire_ant_hole");
    const AmbushSpec& spec = shipped().mob(type).ambush;
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), type,
                                             Rarity::Epic, kCentre, Realm::Overworld, 0.0, sim.rng);
    const Vec2 mouth = sim.world.get<Transform>(nest).position;
    const Entity flower = makeFighter(sim.world, mouth + Vec2{1.0, 0.0});
    sim.tick({kCentre});
    const std::vector<Entity> brood = sim.world.get<AmbushNest>(nest).brood;
    CHECK_EQ(static_cast<int>(brood.size()), spec.count);

    // One of them dented, then all of them taken away rather than killed.
    CombatSystem combat;
    combat.applyDamage(
        sim.world, brood.front(), flower,
        1.0 + std::max(0.0, CombatSystem::effectiveArmor(sim.world, brood.front(), sim.now)),
        sim.now);
    CHECK(!sim.world.has<Dead>(brood.front()));
    CHECK(!sim.world.get<Bounty>(nest).contributors.empty());
    for (const Entity ant : brood) sim.world.destroy(ant);
    sim.tick({kCentre});
    CHECK(!sim.world.has<Dead>(nest));
    CHECK(!sim.world.get<AmbushNest>(nest).released);
    CHECK(sim.world.get<Bounty>(nest).contributors.empty());

    // Still standing at the rim, so the next pass sends a fresh brood.
    sim.tick({kCentre});
    CHECK(sim.world.get<AmbushNest>(nest).released);
    CHECK_EQ(static_cast<int>(sim.world.get<AmbushNest>(nest).brood.size()), spec.count);
}

TEST(a_holes_neutral_ants_come_up_after_whoever_hit_it) {
    Sim sim;
    const std::uint16_t hole = shipped().mobIndex("ant_hole");
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), hole,
                                             Rarity::Common, kCentre, Realm::Overworld, 0.0,
                                             sim.rng);
    const auto flower = [&](Vec2 at) {
        const Entity e = sim.world.create();
        sim.world.add<Transform>(e, Transform{at, 0.0, Realm::Overworld});
        sim.world.add<Health>(e, Health{100.0, 100.0, 0.0, 0.0});
        return e;
    };
    // The one standing closest is NOT the one who hit it this time: an old
    // chip from `bystander` is already on the ledger, and weighed, before
    // `digger` lands the blow that crosses the bands.
    const Entity bystander = flower(kCentre + Vec2{40.0, 0.0});
    const Entity digger = flower(kCentre + Vec2{200.0, 0.0});
    sim.world.get<Bounty>(nest).credit(bystander, 500.0);
    sim.tick({kCentre});
    CHECK(sim.world.get<NestWaves>(nest).children.empty());

    // The opening guard is nobody's: it was there before anyone hit anything.
    Query<MobTag, MobAi> guard{sim.world};
    guard.each([&](Entity, MobTag&, MobAi& ai) { CHECK_EQ(ai.target, NULL_ENTITY); });

    sim.world.get<Bounty>(nest).credit(digger, 100.0);
    sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max * 0.5;
    sim.tick({kCentre});

    int neutral = 0;
    for (const Entity ant : sim.world.get<NestWaves>(nest).children) {
        const MobAi& ai = sim.world.get<MobAi>(ant);
        if (ai.kind == AiKind::Neutral) {
            ++neutral;
            CHECK_EQ(ai.target, digger);
        } else {
            // Hostile ants pick their own; passive ones never take one.
            CHECK_EQ(ai.target, NULL_ENTITY);
        }
    }
    CHECK(neutral > 0);

    // Damage nobody is credited for -- no hitter on the ledger this tick --
    // sends ants that are angry with no one.
    for (const Entity ant : std::vector<Entity>(sim.world.get<NestWaves>(nest).children)) {
        sim.world.destroy(ant);
    }
    sim.world.get<Health>(nest).current = sim.world.get<Health>(nest).max * 0.1;
    sim.tick({kCentre});
    CHECK(!sim.world.get<NestWaves>(nest).children.empty());
    for (const Entity ant : sim.world.get<NestWaves>(nest).children) {
        CHECK_EQ(sim.world.get<MobAi>(ant).target, NULL_ENTITY);
    }
}

TEST(a_spawners_neutral_child_comes_out_after_whoever_last_hit_it) {
    Sim sim;
    const Entity queen = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(),
                                              shipped().mobIndex("queen_ant"), Rarity::Rare,
                                              kCentre, Realm::Overworld, 0.0, sim.rng);
    // The shipped queen lays hostile soldiers, which find their own target. A
    // NEUTRAL child is what the rule is about, so this one lays workers.
    sim.world.get<Spawner>(queen).childConfigIndex = shipped().mobIndex("worker_ant");
    const Entity hitter = sim.world.create();
    sim.world.add<Transform>(hitter, Transform{kCentre + Vec2{150.0, 0.0}, 0.0, Realm::Overworld});
    sim.world.add<Health>(hitter, Health{100.0, 100.0, 0.0, 0.0});
    const auto brood = [&] { return sim.world.get<Spawner>(queen).children; };

    // Nobody has touched her: the first worker is angry with no one.
    sim.tick({kCentre});
    CHECK_EQ(brood().size(), std::size_t(1));
    CHECK_EQ(sim.world.get<MobAi>(brood().front()).target, NULL_ENTITY);

    // Hit once, then left alone for the rest of an interval: a timer has no
    // hit of its own to answer, so the next worker answers the last one.
    sim.world.get<Bounty>(queen).credit(hitter, 50.0);
    for (int i = 0; i < 100 && brood().size() < 2; ++i) sim.tick({kCentre});
    CHECK_EQ(brood().size(), std::size_t(2));
    CHECK_EQ(sim.world.get<MobAi>(brood().back()).target, hitter);
}

TEST(a_periodic_nest_holds_its_escort_cap_and_expires_them) {
    Sim sim;
    const std::uint16_t queen = shipped().mobIndex("queen_ant");
    const PeriodicSpawnSpec& spec = shipped().mob(queen).periodicSpawn;
    CHECK(spec.present);
    CHECK(spec.maxAlive > 0);
    CHECK(spec.lifetimeMillis > 0);

    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), queen,
                                             Rarity::Rare, kCentre, Realm::Overworld, 0.0, sim.rng);
    CHECK(sim.world.has<Spawner>(nest));
    const std::vector<Vec2> players{kCentre};

    // Long enough for many intervals; the cap must hold regardless.
    for (int i = 0; i < 1500; ++i) sim.tick(players);
    const int live = static_cast<int>(sim.world.get<Spawner>(nest).children.size());
    CHECK(live <= spec.maxAlive);
    CHECK(live > 0);

    // Escorts carry a lifetime, and it is this system that runs it down.
    Query<Pet> pets{sim.world};
    CHECK_EQ(pets.count(), std::size_t(0));
    Query<AmbientMob, Lifetime> timed{sim.world};
    CHECK(timed.count() > 0);
}

TEST(a_dead_nest_stops_producing) {
    Sim sim;
    const std::uint16_t queen = shipped().mobIndex("queen_ant");
    const Entity nest = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), queen,
                                             Rarity::Rare, kCentre, Realm::Overworld, 0.0, sim.rng);
    sim.world.add<Dead>(nest, Dead{NULL_ENTITY});

    const std::vector<Vec2> players{kCentre};
    const int before = sim.mobCount();
    for (int i = 0; i < 200; ++i) sim.tick(players);
    // The ambient roll keeps working, but the corpse spawned none of it: its
    // own escort list never grew.
    CHECK_EQ(sim.world.get<Spawner>(nest).children.size(), std::size_t(0));
    CHECK(sim.mobCount() >= before);
}

// ---------------------------------------------------------------------------
// Drop tables
// ---------------------------------------------------------------------------

TEST(the_drop_table_links_cleanly_against_the_shipped_content) {
    DropTables tables;
    tables.link(shipped());
    // Every id in the table is one the content defines. A line that does not
    // resolve is a data bug, not something to discover at runtime.
    if (!tables.unresolved().empty()) {
        std::printf("    (unresolved: %s)\n", tables.unresolved().front().c_str());
    }
    CHECK(tables.unresolved().empty());

    CHECK_EQ(tables.forMob(shipped().mobIndex("bee")).size(), std::size_t(4));
    CHECK_EQ(tables.forMob(shipped().mobIndex("starfish")).size(), std::size_t(2));
    // TypeScript synthesises a guaranteed common egg even for a mob with no
    // authored table. Only an index off the end has no table at all.
    CHECK_EQ(tables.forMob(shipped().mobIndex("dust")).size(), std::size_t(1));
    CHECK(tables.forMob(kInvalidIndex).empty());
    CHECK(tables.guaranteedForMob(kInvalidIndex).empty());

    // The merged view is the same table with one row per drop TYPE. The
    // ladybug authors its rose twice -- common 0.5 and uncommon 0.1 -- and a
    // rare ladybug leaves one rose, not two.
    const std::uint16_t ladybug = shipped().mobIndex("ladybug");
    CHECK_EQ(tables.forMob(ladybug).size(), std::size_t(4));
    CHECK_EQ(tables.guaranteedForMob(ladybug).size(), std::size_t(3));
    const std::uint16_t rose = shipped().petalIndex("rose");
    int roseRows = 0;
    double roseProbability = 0.0;
    for (const DropTables::Entry& row : tables.guaranteedForMob(ladybug)) {
        if (row.petalIndex != rose) continue;
        ++roseRows;
        roseProbability = row.probability;
    }
    CHECK_EQ(roseRows, 1);
    // Either authored line firing: 1 - 0.5*0.9.
    CHECK(std::abs(roseProbability - 0.55) < 1e-9);
    // A mob whose rows name different items is untouched by the merge.
    CHECK_EQ(tables.guaranteedForMob(shipped().mobIndex("bee")).size(), std::size_t(4));

    CHECK(tables.linkedTo(shipped()));
    tables.link(shipped());   // idempotent
    CHECK(tables.unresolved().empty());
}

TEST(drop_rarity_uses_authored_rows_for_common_and_uncommon_mobs) {
    // Neither tier has a weighted draw to reproduce, so every row they hand
    // out is graded, and graded means the authored rarity plus the mutually
    // exclusive upgrade/downgrade roll around it.
    Rng rng(31337);
    for (int i = 0; i < 40000; ++i) {
        const Rarity r = LootSystem::rollDropRarity(Rarity::Rare, Rarity::Common, rng);
        const int delta = rarityIndex(r) - rarityIndex(Rarity::Rare);
        CHECK(delta >= -1 && delta <= 1);
        const Rarity uncommon = LootSystem::rollDropRarity(Rarity::Common, Rarity::Uncommon, rng);
        CHECK(rarityIndex(uncommon) >= rarityIndex(Rarity::Common));
        CHECK(rarityIndex(uncommon) <= rarityIndex(Rarity::Uncommon));
    }
}

TEST(drop_rarity_applies_mob_floors_and_the_apex_item_cap) {
    Rng rng(5);
    for (int i = 0; i < 2000; ++i) {
        const Rarity rare = LootSystem::rollDropRarity(Rarity::Common, Rarity::Rare, rng);
        CHECK(rarityIndex(rare) >= rarityIndex(Rarity::Uncommon));
        CHECK(rarityIndex(rare) <= rarityIndex(Rarity::Rare));

        const Rarity apex = LootSystem::rollDropRarity(Rarity::Apex, Rarity::Apex, rng);
        CHECK(rarityIndex(apex) >= rarityIndex(Rarity::Super));
        CHECK(rarityIndex(apex) <= rarityIndex(Rarity::Unique));
    }
}

TEST(a_mob_leaves_its_own_rarity_at_the_pre_guaranteed_drop_rate) {
    // The whole point of the split. Guaranteed drops multiplied what a kill
    // pays out; grading exactly one row keeps the rate that decides how fast
    // anyone climbs the ladder at what it was before they existed. The
    // figures are 90% * the upgrade chance one tier under the mob -- written
    // out rather than recomputed, so a change to either half of the pipeline
    // has to come and edit this list on purpose.
    struct Case { Rarity mob; double ownTier; };
    const Case cases[] = {
        {Rarity::Rare, 0.096},        {Rarity::Epic, 0.048},
        {Rarity::Legendary, 0.024},   {Rarity::Mythic, 0.012},
        {Rarity::Ultra, 0.120},       // the 20x lucky roll, which only ultra has
        {Rarity::Super, 0.003},       {Rarity::Unique, 0.0015},
    };

    Rng rng(4242);
    constexpr int kRuns = 400000;
    for (const Case& c : cases) {
        int own = 0;
        for (int i = 0; i < kRuns; ++i) {
            if (LootSystem::rollDropRarity(Rarity::Common, c.mob, rng) == c.mob) ++own;
        }
        CHECK_NEAR(own / double(kRuns), c.ownTier, std::max(0.0005, c.ownTier * 0.05));
    }

    // Apex is the one tier that cannot leave its own rarity at all.
    int apex = 0;
    for (int i = 0; i < kRuns; ++i) {
        if (LootSystem::rollDropRarity(Rarity::Common, Rarity::Apex, rng) == Rarity::Apex) ++apex;
    }
    CHECK_EQ(apex, 0);
}

TEST(chaff_is_flat_two_tiers_below_the_mob) {
    // Not rolled and not floored: the rows a mob hands out on top of its one
    // graded drop are the bottom of its band, every time. Running them
    // through finishDropRarity instead would let a rare mob's floor lift
    // them all back to uncommon, which is exactly the inflation the graded
    // row exists to hold back.
    for (int tier = 0; tier < kRarityCount; ++tier) {
        const Rarity mob = clampRarity(tier);
        CHECK_EQ(rarityIndex(LootSystem::chaffDropRarity(mob)), std::max(0, tier - 2));
    }
}

TEST(a_kill_above_unusual_grades_exactly_one_of_its_rows) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(808);

    // A RARE ladybug separates the two cleanly: its graded drop floors at
    // uncommon and its chaff is common, so counting the non-common items
    // counts the graded ones. Three rows drop every time -- rose, light and
    // the generated egg -- and exactly one of them is the real drop.
    const std::uint16_t ladybug = shipped().mobIndex("ladybug");
    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});

    for (int i = 0; i < 400; ++i) {
        makeCorpse(world, ladybug, Rarity::Rare, kCentre, player, {player});
        loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
        commands.flush();

        int graded = 0;
        int total = 0;
        for (const Entity drop : liveDrops(world)) {
            ++total;
            if (world.get<DropItem>(drop).rarity != Rarity::Common) ++graded;
            world.destroy(drop);
        }
        CHECK_EQ(total, 3);
        CHECK_EQ(graded, 1);
    }
}

TEST(which_row_is_graded_is_drawn_by_probability) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(909);

    // The pre-guaranteed-drops weighted draw, still deciding which item a
    // kill is worth something for. The merged ladybug table is egg 1.0, rose
    // 0.55 and light 0.5, so the shares are those over 2.05.
    const std::uint16_t ladybug = shipped().mobIndex("ladybug");
    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    const std::uint16_t egg = shipped().petalIndex("ladybug_egg");
    const std::uint16_t rose = shipped().petalIndex("rose");
    const std::uint16_t light = shipped().petalIndex("light");

    constexpr int kKills = 8000;
    std::map<std::uint16_t, int> graded;
    for (int i = 0; i < kKills; ++i) {
        makeCorpse(world, ladybug, Rarity::Rare, kCentre, player, {player});
        loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
        commands.flush();
        for (const Entity drop : liveDrops(world)) {
            const DropItem& item = world.get<DropItem>(drop);
            if (item.rarity != Rarity::Common) ++graded[item.configIndex];
            world.destroy(drop);
        }
    }

    CHECK_NEAR(graded[egg] / double(kKills), 1.00 / 2.05, 0.02);
    CHECK_NEAR(graded[rose] / double(kKills), 0.55 / 2.05, 0.02);
    CHECK_NEAR(graded[light] / double(kKills), 0.50 / 2.05, 0.02);
}

// ---------------------------------------------------------------------------
// Loot: drops, eligibility, pickup, expiry
// ---------------------------------------------------------------------------

TEST(a_squads_drops_are_reserved_for_every_member) {
    // What a party is FOR. One member kills a starfish; the drop it leaves is
    // reserved for the whole squad, including the member who never touched
    // it, and every one of them may pick a copy up.
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(4242);

    const std::uint16_t starfish = shipped().mobIndex("starfish");
    const Entity fighter = makePlayer(world, kCentre + Vec2{5000, 0});
    const Entity passenger = makePlayer(world, kCentre + Vec2{5000, 0});
    const Entity stranger = makePlayer(world, kCentre + Vec2{5000, 0});

    SquadEntityIndex squads;
    squads.group[fighter] = 0;
    squads.group[passenger] = 0;
    squads.groups.push_back({SquadBody{fighter, 1}, SquadBody{passenger, 2}});
    loot.squads = &squads;

    // Only the fighter is in the tally; the stranger hit it too, so the
    // corpse has somebody outside the squad to rank against.
    makeCorpse(world, starfish, Rarity::Uncommon, kCentre, fighter, {fighter, stranger});
    loot.run(world, grid, shipped(), rng, 1000.0, net::kTickSeconds, commands, events);
    commands.flush();

    const std::vector<Entity> drops = liveDrops(world);
    CHECK(!drops.empty());
    if (drops.empty()) return;
    const DropItem& item = world.get<DropItem>(drops.front());
    const auto reserved = [&](Entity who) { return claimed(item.eligible, who, 0); };
    CHECK(reserved(fighter));
    CHECK(reserved(passenger));   // the whole point: a squad shares
    CHECK(reserved(stranger));    // and it does not take anyone else's slot
}

TEST(a_killed_mob_drops_from_its_own_table) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(11);

    const std::uint16_t starfish = shipped().mobIndex("starfish");
    const std::uint16_t starfishPetal = shipped().petalIndex("starfish");
    const std::uint16_t starfishEgg = shipped().petalIndex("starfish_egg");
    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});

    for (int i = 0; i < 40; ++i) {
        makeCorpse(world, starfish, Rarity::Uncommon, kCentre, player, {player});
    }
    loot.run(world, grid, shipped(), rng, 1000.0, net::kTickSeconds, commands, events);
    commands.flush();

    const std::vector<Entity> drops = liveDrops(world);
    // Uncommon mobs drop every row: the authored starfish plus its generated
    // guaranteed egg.
    CHECK_EQ(drops.size(), std::size_t(80));
    int petals = 0;
    int eggs = 0;
    for (const Entity drop : drops) {
        const DropItem& item = world.get<DropItem>(drop);
        if (item.configIndex == starfishPetal) ++petals;
        if (item.configIndex == starfishEgg) ++eggs;
        CHECK_EQ(item.eligible.size(), std::size_t(1));
        CHECK_EQ(item.eligible.front().body, player);
        CHECK(item.pickedUpBy.empty());
        const Vec2 offset = world.get<Transform>(drop).position - kCentre;
        CHECK(std::abs(offset.x) <= 50.0);
        CHECK(std::abs(offset.y) <= 50.0);
        CHECK(world.has<DropTag>(drop));
        CHECK_EQ(world.get<Replicated>(drop).kind, net::EntityKind::Drop);
    }
    CHECK_EQ(petals, 40);
    CHECK_EQ(eggs, 40);
}

TEST(a_mob_pays_out_exactly_once_however_long_its_corpse_lingers) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(12);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    makeCorpse(world, shipped().mobIndex("starfish"), Rarity::Common, kCentre, player, {player});

    loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
    commands.flush();
    const std::size_t first = liveDrops(world).size();
    CHECK_EQ(first, std::size_t(2));

    for (int i = 0; i < 5; ++i) {
        loot.run(world, grid, shipped(), rng, 40.0 * i, net::kTickSeconds, commands, events);
        commands.flush();
    }
    CHECK_EQ(liveDrops(world).size(), first);
}

TEST(a_pet_dying_is_not_loot) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(13);

    const Entity owner = makePlayer(world, kCentre);
    const Entity pet = makeCorpse(world, shipped().mobIndex("starfish"), Rarity::Common, kCentre,
                                  owner, {owner});
    world.add<Pet>(pet, Pet{owner, 0});

    loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
    commands.flush();
    CHECK_EQ(liveDrops(world).size(), std::size_t(0));
}

TEST(common_mobs_roll_each_drop_row_at_most_once) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(14);

    const std::uint16_t flower = shipped().mobIndex("glitch_flower");
    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    DropTables tables;
    tables.link(shipped());
    const int rowCount = static_cast<int>(tables.forMob(flower).size());

    int mostSeen = 0;
    for (int i = 0; i < 300; ++i) {
        makeCorpse(world, flower, Rarity::Common, kCentre, player, {player});
        loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
        commands.flush();
        const int produced = static_cast<int>(liveDrops(world).size());
        mostSeen = std::max(mostSeen, produced);
        CHECK(produced <= rowCount);
        for (const Entity drop : liveDrops(world)) world.destroy(drop);
    }
    CHECK_EQ(mostSeen, rowCount);
}

TEST(every_mob_above_common_leaves_one_of_each_of_its_drops) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(15);

    DropTables tables;
    tables.link(shipped());
    const std::uint16_t ladybug = shipped().mobIndex("ladybug");
    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});

    // Rose, light and the generated egg. The ladybug authors its rose twice,
    // so a mob that simply dropped every authored row would leave four items
    // and two roses -- the merge is what makes "one of each" mean one.
    std::vector<std::uint16_t> expected;
    for (const DropTables::Entry& row : tables.guaranteedForMob(ladybug)) {
        expected.push_back(row.petalIndex);
    }
    std::sort(expected.begin(), expected.end());
    CHECK_EQ(expected.size(), std::size_t(3));

    for (int tier = rarityIndex(Rarity::Uncommon); tier <= rarityIndex(Rarity::Mythic); ++tier) {
        for (int i = 0; i < 20; ++i) {
            makeCorpse(world, ladybug, clampRarity(tier), kCentre, player, {player});
            loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
            commands.flush();

            std::vector<std::uint16_t> got;
            for (const Entity drop : liveDrops(world)) {
                got.push_back(world.get<DropItem>(drop).configIndex);
                world.destroy(drop);
            }
            std::sort(got.begin(), got.end());
            CHECK(got == expected);
        }
    }
}

// ---------------------------------------------------------------------------
// The magic orb's conversion
// ---------------------------------------------------------------------------

namespace {

/// Puts one petal in the flower's first ACTIVE slot.
void wear(World& world, Entity player, const char* id, Rarity rarity, int slot = 0) {
    Loadout& loadout = world.ensure<Loadout>(player);
    loadout.slots[static_cast<std::size_t>(slot)] =
        LoadoutSlot{shipped().petalIndex(id), rarity, 0.0, false};
}

/// Forty uncommon leafbugs, which drop every authored row: a leaf and a root.
/// Returns what was left on the ground.
std::vector<Entity> farmLeafbugs(World& world, LootSystem& loot, CommandBuffer& commands,
                                 SpatialGrid& grid, EventQueue& events, Rng& rng, Entity player) {
    for (int i = 0; i < 40; ++i) {
        makeCorpse(world, shipped().mobIndex("leafbug"), Rarity::Uncommon, kCentre, player,
                   {player});
    }
    loot.run(world, grid, shipped(), rng, 1000.0, net::kTickSeconds, commands, events);
    commands.flush();
    return liveDrops(world);
}

} // namespace

TEST(the_magic_form_table_is_derived_from_the_petal_ids) {
    // magic_X is the magic form of X, and the orb is the rose's.
    for (const char* id : {"leaf", "stick", "cactus", "missile", "bubble", "peas"}) {
        const std::uint16_t base = shipped().petalIndex(id);
        CHECK_EQ(shipped().magicFormOf(base), shipped().petalIndex(std::string("magic_") + id));
    }
    CHECK_EQ(shipped().magicFormOf(shipped().petalIndex("rose")),
             shipped().petalIndex("magic_orb"));

    // A petal with no magic counterpart converts into nothing, and a magic
    // petal is a destination rather than a source.
    CHECK_EQ(shipped().magicFormOf(shipped().petalIndex("basic")), kInvalidIndex);
    CHECK_EQ(shipped().magicFormOf(shipped().petalIndex("magic_leaf")), kInvalidIndex);
}

TEST(a_magic_petal_is_never_in_the_random_drop_pool) {
    DropTables tables;
    tables.link(shipped());
    // The gate would be for nothing if a `random` row could hand out an apex
    // magic leaf to a flower wearing a common orb.
    for (const std::uint16_t index : tables.droppablePetals()) {
        CHECK(!shipped().isMagicForm(index));
    }
    CHECK(shipped().isMagicForm(shipped().petalIndex("magic_orb")));
    CHECK(!shipped().isMagicForm(shipped().petalIndex("rose")));
}

TEST(without_an_orb_a_mob_drops_exactly_what_its_table_says) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(41);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    const std::uint16_t leaf = shipped().petalIndex("leaf");
    int leaves = 0;
    for (const Entity drop : farmLeafbugs(world, loot, commands, grid, events, rng, player)) {
        if (world.get<DropItem>(drop).configIndex == leaf) ++leaves;
    }
    CHECK_EQ(leaves, 40);
}

TEST(a_worn_orb_converts_every_drop_that_has_a_magic_form) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(42);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    wear(world, player, "magic_orb", Rarity::Ultra);

    const std::uint16_t leaf = shipped().petalIndex("leaf");
    const std::uint16_t magicLeaf = shipped().petalIndex("magic_leaf");
    const std::uint16_t root = shipped().petalIndex("root");
    int magic = 0;
    int roots = 0;
    for (const Entity drop : farmLeafbugs(world, loot, commands, grid, events, rng, player)) {
        const DropItem& item = world.get<DropItem>(drop);
        // Not one ordinary leaf gets through.
        CHECK(item.configIndex != leaf);
        if (item.configIndex == magicLeaf) ++magic;
        // Root has no magic form, so the orb leaves it alone: the conversion
        // is a table, not a blanket.
        if (item.configIndex == root) ++roots;
    }
    CHECK_EQ(magic, 40);
    CHECK(roots > 0);
}

TEST(a_common_orb_gatekeeps_every_conversion_to_common) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(43);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    wear(world, player, "magic_orb", Rarity::Common);

    const std::uint16_t magicLeaf = shipped().petalIndex("magic_leaf");
    const std::uint16_t root = shipped().petalIndex("root");
    int aboveCommonRoots = 0;
    for (const Entity drop : farmLeafbugs(world, loot, commands, grid, events, rng, player)) {
        const DropItem& item = world.get<DropItem>(drop);
        if (item.configIndex == magicLeaf) {
            // Common magic leaf and nothing else, however the roll went.
            CHECK_EQ(rarityIndex(item.rarity), rarityIndex(Rarity::Common));
        }
        if (item.configIndex == root && rarityIndex(item.rarity) > 0) ++aboveCommonRoots;
    }
    // The cap is the ORB's, not a flattening of the whole table: an unconverted
    // petal still rolls its upgrades on this very mob.
    CHECK(aboveCommonRoots > 0);
}

TEST(a_better_orb_lets_a_better_conversion_through) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(43);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    wear(world, player, "magic_orb", Rarity::Ultra);

    const std::uint16_t magicLeaf = shipped().petalIndex("magic_leaf");
    int aboveCommon = 0;
    for (const Entity drop : farmLeafbugs(world, loot, commands, grid, events, rng, player)) {
        const DropItem& item = world.get<DropItem>(drop);
        if (item.configIndex == magicLeaf && rarityIndex(item.rarity) > 0) ++aboveCommon;
    }
    // Same mob, same seed, same rolls -- the only thing that changed is the
    // tier of the orb standing in front of them.
    CHECK(aboveCommon > 0);
}

TEST(a_stashed_orb_converts_nothing) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(44);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    // The first secondary slot: held, not worn, exactly as it grants no
    // modifier and draws no petal.
    wear(world, player, "magic_orb", Rarity::Ultra, kLoadoutActiveSlots);

    const std::uint16_t leaf = shipped().petalIndex("leaf");
    int leaves = 0;
    for (const Entity drop : farmLeafbugs(world, loot, commands, grid, events, rng, player)) {
        if (world.get<DropItem>(drop).configIndex == leaf) ++leaves;
    }
    CHECK_EQ(leaves, 40);
}

TEST(a_non_contributor_can_never_take_an_eligible_players_drop) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(15);

    const Entity fighter = makePlayer(world, kCentre + Vec2{4000, 0}, 0.0, 1);
    const Entity bystander = makePlayer(world, kCentre, 0.0, 2);
    (void)bystander;
    const Entity drop = loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Rare, kCentre, Realm::Overworld,
                                       {fighter}, 0.0);
    CHECK(drop != NULL_ENTITY);

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 100.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
    CHECK(world.isAlive(drop));

    // Eligibility never turns into a timed free-for-all.
    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 1e9, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
    CHECK(world.isAlive(drop));
}

TEST(a_contributor_may_take_a_reserved_drop_at_once) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(16);
    NetIdAllocator ids;
    loot.netIds = &ids;

    const Entity fighter = makePlayer(world, kCentre, 0.0, 7);
    const Entity drop = loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common,
                                       kCentre, Realm::Overworld, {fighter}, 0.0);
    // A wired allocator is what makes a drop visible to a client at all.
    CHECK(world.has<NetId>(drop));
    const std::uint32_t dropNetId = world.get<NetId>(drop).value;

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 10.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(1));
    CHECK_EQ(loot.pickups().front().player, fighter);
    // The event carries both ids so the client can fly the item to the flower.
    CHECK_EQ(events.events().size(), std::size_t(1));
    if (!events.events().empty()) {
        CHECK_EQ(events.events().front().kind, net::EventKind::PickedUp);
        CHECK_EQ(events.events().front().netId, dropNetId);
        CHECK_EQ(events.events().front().otherNetId, 7u);
    }
}

TEST(a_reservation_survives_the_owners_death) {
    // A flower's body is destroyed and rebuilt on every death, so a
    // reservation held against the CORPSE is one its owner can never collect:
    // they walk back to the item their squad earned and stand on it.
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(4711);

    const Entity died = makePlayer(world, kCentre);
    world.add<PlayerAccount>(died, PlayerAccount{"acct-1", "player", 42, false});
    loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, kCentre,
                   Realm::Overworld, {died}, 0.0);

    // Death and respawn: the same account, the same connection, a new body.
    world.destroy(died);
    const Entity reborn = makePlayer(world, kCentre);
    world.add<PlayerAccount>(reborn, PlayerAccount{"acct-1", "player", 42, false});

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 10.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(1));
    if (!loot.pickups().empty()) CHECK_EQ(loot.pickups().front().player, reborn);
}

TEST(an_unreserved_drop_is_free_for_anyone) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(17);

    const Entity passerby = makePlayer(world, kCentre);
    loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, kCentre, Realm::Overworld, {}, 0.0);
    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(1));
    CHECK_EQ(loot.pickups().front().player, passerby);
    CHECK(world.isAlive(liveDrops(world).front()));
}

TEST(each_player_can_take_an_unrestricted_drop_once) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(18);

    makePlayer(world, kCentre, 0.0, 1);
    makePlayer(world, kCentre, 0.0, 2);
    loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, kCentre, Realm::Overworld, {}, 0.0);

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(2));
    CHECK_EQ(liveDrops(world).size(), std::size_t(1));

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 1.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
}

TEST(magnetism_widens_the_pickup_radius_without_moving_the_drop) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(19);

    const Vec2 dropAt = kCentre + Vec2{300.0, 0.0};
    const Entity player = makePlayer(world, kCentre, 0.0);
    const Entity drop = loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, dropAt, Realm::Overworld,
                                       {player}, 0.0);
    CHECK(300.0 > kDropPickupRadius);

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
    // Out of reach and untouched: nothing dragged it toward the player.
    CHECK(world.get<Transform>(drop).position == dropAt);

    world.get<PlayerModifiers>(player).magnetism = 400.0;
    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    // Still where it was dropped at the moment it was claimed -- the destroy is
    // deferred, so this reads the drop as the pickup left it.
    CHECK(world.get<Transform>(drop).position == dropAt);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(1));
    CHECK(!world.isAlive(drop));
}

TEST(a_dead_player_picks_nothing_up) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(20);

    const Entity player = makePlayer(world, kCentre);
    world.get<Health>(player).current = 0.0;
    loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, kCentre, Realm::Overworld, {}, 0.0);

    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
}

TEST(drops_expire) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(21);

    const Entity drop = loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Common, kCentre, Realm::Overworld,
                                       {}, 0.0);
    constexpr double lifetime = kDropLifetimeByRarity[rarityIndex(Rarity::Common)];
    CHECK_NEAR(world.get<Lifetime>(drop).remainingSeconds, lifetime, 1e-12);

    double now = 0.0;
    const int ticks = static_cast<int>(lifetime * net::kTicksPerSecond) - 2;
    for (int i = 0; i < ticks; ++i) {
        loot.run(world, grid, shipped(), rng, now, net::kTickSeconds, commands, events);
        commands.flush();
        now += net::kTickMillis;
    }
    CHECK(world.isAlive(drop));

    for (int i = 0; i < 4; ++i) {
        loot.run(world, grid, shipped(), rng, now, net::kTickSeconds, commands, events);
        commands.flush();
        now += net::kTickMillis;
    }
    CHECK(!world.isAlive(drop));
}

TEST(a_drop_is_collectable_on_the_tick_it_was_created_in) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(22);

    // The player is standing on the corpse, with magnetism to spare.
    const Entity player = makePlayer(world, kCentre, 500.0, 1);
    makeCorpse(world, shipped().mobIndex("starfish"), Rarity::Common, kCentre, player, {player});
    rebuildGrid(world, grid);

    loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
    commands.flush();
    // Taken on the spot. The reference rolls a mob's drops inside the very
    // player step that then tests pickups -- resolvePlayerPetals kills it and
    // resolvePlayerItemPickups runs a few lines later in the same function --
    // so a magnet flower standing on its own kill collects the item before any
    // snapshot could have carried it. Holding the drop back for a tick would
    // be a different game: it is the pickup CUE, which carries the drop's
    // position and look, that gives the client something to animate.
    CHECK_EQ(loot.pickups().size(), std::size_t(2));
    CHECK_EQ(liveDrops(world).size(), std::size_t(0));

    // ...and it is taken exactly once: the second pass finds nothing left.
    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 40.0, net::kTickSeconds, commands, events);
    commands.flush();
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
}

TEST(the_pickup_cue_carries_the_drops_look_not_just_its_id) {
    // The cue is the ONLY thing a same-tick pickup leaves behind: the entity
    // is created and destroyed inside one tick, so no snapshot ever carried
    // it and the client has never heard of that net id. A cue naming only the
    // id is unplayable for exactly the flowers that collect the most -- an
    // apex observer alone reaches 437 units -- and an unplayable cue is what
    // "mobs stopped dropping loot" looks like from the seat.
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(2201);
    NetIdAllocator ids;
    loot.netIds = &ids;

    const Entity player = makePlayer(world, kCentre, 500.0, 7);
    (void)player;
    const std::uint16_t rose = shipped().petalIndex("rose");
    const Entity drop =
        loot.spawnDrop(world, rose, Rarity::Epic, kCentre, Realm::Overworld, {}, 0.0);
    CHECK(drop != NULL_ENTITY);
    const std::uint32_t dropNetId = world.get<NetId>(drop).value;
    rebuildGrid(world, grid);

    loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
    commands.flush();

    const WireEvent* cue = nullptr;
    for (const WireEvent& event : events.events()) {
        if (event.kind == net::EventKind::PickedUp) cue = &event;
    }
    CHECK(cue != nullptr);
    if (cue == nullptr) return;
    CHECK_EQ(cue->netId, dropNetId);
    CHECK_EQ(cue->otherNetId, std::uint32_t(7));
    CHECK_EQ(cue->position.x, kCentre.x);
    CHECK_EQ(cue->position.y, kCentre.y);
    // The look: the petal index in `amount` and the tier in `flag`, the two
    // fixed fields this kind has no other use for.
    CHECK_EQ(static_cast<std::uint16_t>(cue->amount), rose);
    CHECK_EQ(static_cast<int>(cue->flag), rarityIndex(Rarity::Epic));
}

TEST(the_pickup_callback_sees_what_the_list_sees) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(23);

    std::vector<LootSystem::Pickup> seen;
    loot.onPickup = [&](const LootSystem::Pickup& p) { seen.push_back(p); };

    const Entity player = makePlayer(world, kCentre);
    loot.spawnDrop(world, shipped().petalIndex("rose"), Rarity::Epic, kCentre, Realm::Overworld, {}, 0.0);
    rebuildGrid(world, grid);
    loot.run(world, grid, shipped(), rng, 0.0, 0.0, commands, events);
    commands.flush();

    CHECK_EQ(seen.size(), std::size_t(1));
    CHECK_EQ(seen.front().player, player);
    CHECK_EQ(seen.front().rarity, Rarity::Epic);
    CHECK_EQ(loot.pickups().size(), seen.size());

    // The list is per-run, not cumulative: a runtime that drains it every tick
    // must never be handed yesterday's pickups again.
    loot.run(world, grid, shipped(), rng, 40.0, 0.0, commands, events);
    CHECK_EQ(loot.pickups().size(), std::size_t(0));
}

TEST(a_dead_contributor_is_still_credited_but_a_non_player_is_not) {
    World world;
    CommandBuffer commands{world};
    SpatialGrid grid;
    LootSystem loot;
    EventQueue events;
    Rng rng(24);

    const Entity player = makePlayer(world, kCentre + Vec2{5000, 0});
    const Entity turret = world.create();   // something that damages but is not a player
    world.add<MobTag>(turret);

    const Entity corpse = makeCorpse(world, shipped().mobIndex("starfish"), Rarity::Common, kCentre,
                                     player, {player, turret});
    (void)corpse;
    loot.run(world, grid, shipped(), rng, 0.0, net::kTickSeconds, commands, events);
    commands.flush();

    const std::vector<Entity> drops = liveDrops(world);
    CHECK_EQ(drops.size(), std::size_t(2));
    for (const Entity drop : drops) {
        CHECK_EQ(world.get<DropItem>(drop).eligible.size(), std::size_t(1));
        CHECK_EQ(world.get<DropItem>(drop).eligible.front().body, player);
    }
}

// ---------------------------------------------------------------------------
// Bands that name their mobs
// ---------------------------------------------------------------------------
//
// The map does not only say which TIER belongs where. A band may name a mob
// outright, and that is the only way a mob the group roll refuses ever reaches
// the world: `target_dummy` is in no group and is marked neverAmbient, so the
// dummy bands are the whole of its existence. A parser that keeps the tier
// and drops the name leaves the DPS row unbuilt and nothing else about the
// world looks wrong.

namespace {

const WorldMaps& shippedMaps() {
    static const WorldMaps maps = [] {
        WorldMaps m;
        std::string error;
        // The manifest is what marks a staged data directory; its directory is
        // the one WorldMaps wants. FLIX_TEST_DATA_DIR first: that is the
        // directory the build stages, and the only one that has the maps in it.
        const std::string manifest = firstExisting({
#ifdef FLIX_TEST_DATA_DIR
            std::string(FLIX_TEST_DATA_DIR) + "/maps.json",
#endif
            testsDir() + "/../build/data/maps.json", "data/maps.json", "../data/maps.json"});
        const std::string dir = manifest.substr(0, manifest.find_last_of('/'));
        if (!m.load(dir, nullptr, error)) {
            std::fprintf(stderr, "[test] the shipped maps did not load: %s\n", error.c_str());
        }
        return m;
    }();
    return maps;
}

// ---------------------------------------------------------------------------
// An AUTHORED map, written here
// ---------------------------------------------------------------------------
//
// The shipped map is hand-drawn art with one door on it and no annotations at
// all: no difficulty bands, no mob regions. That is the new normal -- an author
// paints a map and the mobs follow from its `defaultMobGroup` -- and it means
// the shipped data can no longer stand in for "a map with bands on it".
//
// It used to: world.tmj carried two hundred bands, nine regions and nine
// target-dummy rows, and every test below read its coverage out of the game's
// own content. Everything those tests pinned is still true of the SPAWNER, so
// the bands they need are authored here instead, in the same Tiled shape a map
// file has. The map is a few cells wide and its objects are laid out over
// sixty thousand units, because MapData reads the annotations and the Sim
// brings its own flat terrain -- the tile layer is a formality.

/// Writes `body` to /tmp/<name>, with the minimal tileset every map must name
/// beside it. Returns the path.
std::string writeTiledFixture(const std::string& name, const std::string& body) {
    const std::string dir = std::string("/tmp/flix-spawn-fixture-") + std::to_string(::getpid());
    ::mkdir(dir.c_str(), 0755);
    {
        std::ofstream tileset(dir + "/fixture.tsj", std::ios::binary | std::ios::trunc);
        tileset << R"({"name": "fixture", "type": "tileset", "version": "1.10",
 "tilewidth": 300, "tileheight": 300, "tilecount": 1, "columns": 0,
 "grid": {"orientation": "orthogonal", "width": 300, "height": 300},
 "tiles": [{"id": 0, "image": "tiles/grass_c_0.svg", "imagewidth": 300, "imageheight": 300}]})";
    }
    const std::string path = dir + "/" + name;
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << body;
    return path;
}

/// The 1x1 map body every fixture here shares: one empty cell, one tileset,
/// whatever `spawns` objects the caller wrote, and whatever MAP properties it
/// wants (a `defaultMobGroup`, for the tests about a band with no roster of
/// its own).
std::string fixtureMapBody(const std::string& spawns, const std::string& properties = {}) {
    std::string out = R"({
      "type": "map", "orientation": "orthogonal", "infinite": false,
      "width": 1, "height": 1, "tilewidth": 256, "tileheight": 256,)";
    if (!properties.empty()) out += "\n      \"properties\": [" + properties + "],";
    out += R"(
      "tilesets": [{"firstgid": 1, "source": "fixture.tsj"}], "layers": [
        {"type": "tilelayer", "name": "ground", "width": 1, "height": 1, "data": [0]},
        {"type": "objectgroup", "name": "spawns", "objects": [)" + spawns + R"(]}
      ]})";
    return out;
}

/// One `spawn` object: a rectangle, an optional DIFFICULTY, and a distribution.
/// No difficulty makes it a mob REGION rather than a band -- difficulty zero is
/// a band of commons, which is why the marker for "no difficulty" is a missing
/// property rather than a zero.
std::string spawnObject(int id, double x, double y, double w, double h, bool hasDifficulty,
                        double difficulty, const std::string& mobs, bool singular = false) {
    std::string out = "{\"id\": " + std::to_string(id) + ", \"class\": \"spawn\", \"x\": " +
                      std::to_string(x) + ", \"y\": " + std::to_string(y) + ", \"width\": " +
                      std::to_string(w) + ", \"height\": " + std::to_string(h) +
                      ", \"properties\": [";
    if (hasDifficulty) {
        out += "{\"name\": \"difficulty\", \"type\": \"float\", \"value\": " +
               std::to_string(difficulty) + "},";
    }
    // Written the way Tiled writes a checkbox, and only when it is ticked: the
    // loader reads the flag by presence-then-value, so a fixture that always
    // emitted `false` would not exercise the same path as an authored map.
    if (singular) out += "{\"name\": \"singular\", \"type\": \"bool\", \"value\": true},";
    out += "{\"name\": \"mobs\", \"type\": \"string\", \"value\": \"" + mobs + "\"}]}";
    return out;
}

/// The DPS row's difficulties: the one difficulty per tier at which that tier
/// is EXACTLY what the ground grows (an integer tier value, so the blend is one
/// tier with no fraction in it). Nine rungs, common through unique -- apex is
/// the top of the curve and a tenth dummy would need a difficulty past the
/// clamp.
inline constexpr int kDummyRowRungs = 9;
const std::array<double, kDummyRowRungs>& dummyRowDifficulties() {
    static const std::array<double, kDummyRowRungs> table = [] {
        std::array<double, kDummyRowRungs> out{};
        for (int i = 0; i < kDummyRowRungs; ++i) {
            out[static_cast<std::size_t>(i)] = difficultyForTierValue(i);
        }
        return out;
    }();
    return table;
}
/// A `spawn` object with no difficulty: a mob region.
std::string regionObject(int id, double x, double y, double w, double h,
                         const std::string& mobs) {
    return spawnObject(id, x, y, w, h, false, 0.0, mobs);
}

/// A `spawn` object WITH a difficulty: a band.
std::string bandObject(int id, double x, double y, double w, double h, double difficulty,
                       const std::string& mobs) {
    return spawnObject(id, x, y, w, h, true, difficulty, mobs);
}

void makeSingularBandWorld(WorldMaps& out, const Rect& band, const std::string& mobs,
                           double difficulty) {
    const std::string path = writeTiledFixture(
        "flix_singular_world.tmj",
        fixtureMapBody(spawnObject(1, band.x, band.y, band.w, band.h, true, difficulty, mobs,
                                   true)));
    MapData map;
    map.setId("singular");
    std::string error;
    if (!map.loadTiled(path, error)) {
        std::fprintf(stderr, "[test] the singular fixture world did not load: %s\n",
                     error.c_str());
    }
    std::remove(path.c_str());
    out.adoptSingle(map);
}

void makeBandedWorld(WorldMaps& out, const std::vector<Rect>& bands, const std::string& mobs,
                     double difficulty) {
    std::string objects;
    int id = 1;
    for (const Rect& band : bands) {
        if (!objects.empty()) objects += ",";
        objects += bandObject(id++, band.x, band.y, band.w, band.h, difficulty, mobs);
    }
    const std::string path = writeTiledFixture("flix_banded_world.tmj", fixtureMapBody(objects));
    MapData map;
    map.setId("banded");
    std::string error;
    if (!map.loadTiled(path, error)) {
        std::fprintf(stderr, "[test] the banded fixture world did not load: %s\n", error.c_str());
    }
    std::remove(path.c_str());
    out.adoptSingle(map);
}

int bandTarget(const Rect& bounds) {
    // Parenthesised exactly as SpawnSystem::rebuildZones has it -- density
    // times AREA -- because the two associations round differently: a 6000-unit
    // square comes out 90 one way and 90.000000000000014 (so 91 after the
    // ceiling) the other, and this figure is compared against a live count.
    return std::max(1, static_cast<int>(std::ceil(kTargetMobDensity * (bounds.w * bounds.h))));
}

Vec2 firstBandCentre(const MapData& map) {
    for (const MapElement& element : map.elements()) {
        if (!element.isSpawnBand()) continue;
        return {element.bounds.x + element.bounds.w * 0.5,
                element.bounds.y + element.bounds.h * 0.5};
    }
    return {};
}

/// The authored overworld the band tests run against.
///
///   * a mob REGION over the whole world, naming the ant hell's roster;
///   * a big difficulty-0 band in the top-left, with one target-dummy band per
///     rung nested inside it -- the DPS row, which is the one thing on the map
///     that is spawned because a band NAMES it rather than because a group
///     rolled it;
///   * a difficulty-66 hornet band (legendary ground), so a named row exists at
///     a tier the difficulty-0 ground around it would never produce;
///   * a difficulty-83 and a difficulty-100 plot -- mythic and ultra ground --
///     well away from the region test's viewer, so one test's high-tier mobs
///     are not another's neighbourhood.
const MapData& authoredMap() {
    static const MapData map = [] {
        std::string objects = regionObject(1, 0, 0, 60000, 60000, "ant_hell 100%");
        objects += "," + bandObject(2, 1000, 1000, 16000, 16000, 0.0, "");
        // One dummy band per rung of the ladder, in a row inside the band
        // above. The difficulties are the curve's own:
        // dummyRowDifficulties()[i] is the difficulty whose tier value is
        // exactly i, so that band grows nothing but tier i.
        int id = 10;
        for (int i = 0; i < kDummyRowRungs; ++i) {
            objects += "," + bandObject(id++, 1500.0 + i * 1600.0, 1500.0, 1200.0, 1200.0,
                                        dummyRowDifficulties()[static_cast<std::size_t>(i)],
                                        "target_dummy 100%");
        }
        objects += "," + bandObject(30, 2000, 8000, 6000, 6000,
                                    difficultyForTierValue(rarityIndex(Rarity::Legendary)),
                                    "hornet 100%");
        // kCentre (30000, 30000) is inside the first of these, so the
        // neighbourhood tests have a band over them.
        objects += "," + bandObject(40, 24000, 24000, 12000, 12000,
                                    difficultyForTierValue(rarityIndex(Rarity::Mythic)), "");
        objects += "," + bandObject(41, 46000, 2000, 10000, 10000, 100.0, "");

        const std::string path = writeTiledFixture("authored.tmj", fixtureMapBody(objects));
        MapData out;
        out.setId("authored");
        std::string error;
        if (!out.loadTiled(path, error)) {
            std::fprintf(stderr, "[test] the authored fixture map did not load: %s\n",
                         error.c_str());
        }
        std::remove(path.c_str());
        return out;
    }();
    return map;
}

const WorldMaps& authoredMaps() {
    static const WorldMaps maps = [] {
        WorldMaps m;
        m.adoptSingle(authoredMap());
        return m;
    }();
    return maps;
}

/// Every band row that names a mob, so the test asserts against the map
/// rather than against a hard-coded list that the map is free to outgrow.
struct NamedRow {
    Rect bounds;
    double difficulty = 0.0;
    std::string mobType;
};

std::vector<NamedRow> namedBandRows() {
    std::vector<NamedRow> rows;
    for (const MapElement& element : authoredMap().elements()) {
        if (!element.isSpawnBand()) continue;
        for (const ZoneMobEntry& entry : element.mobDistribution) {
            // A row is a group or a mob; only the mobs are of interest here.
            if (shipped().mobGroupIndex(entry.name) != kInvalidIndex) continue;
            rows.push_back(NamedRow{element.bounds, element.difficulty, entry.name});
        }
    }
    return rows;
}

} // namespace

TEST(a_band_keeps_the_mob_it_names) {
    if (!authoredMap().loaded()) {
        ::testing::reportFailure(__FILE__, __LINE__, "the authored fixture map did not load");
        return;
    }
    const std::vector<NamedRow> rows = namedBandRows();
    // Nine dummy rows plus the legendary-ground hornets. A parser that drops
    // the name leaves this at zero, which is exactly the bug this guards.
    CHECK(rows.size() >= 10);

    int dummyRows = 0;
    for (const NamedRow& row : rows) {
        if (row.mobType == "target_dummy") ++dummyRows;
    }
    CHECK_EQ(dummyRows, 9);
}

TEST(the_dummy_bands_actually_build_the_dps_row) {
    if (!authoredMap().loaded()) {
        ::testing::reportFailure(__FILE__, __LINE__, "the authored fixture map did not load");
        return;
    }
    const std::uint16_t dummy = shipped().mobIndex("target_dummy");
    CHECK(dummy != kInvalidIndex);
    // The premise of the whole mechanism: the group roll will never produce
    // one, so if the band does not, nothing does.
    CHECK(shipped().mob(dummy).neverAmbient);
    CHECK(shipped().mob(dummy).groups.empty());

    Sim sim;
    sim.spawner.worldMaps = &authoredMaps();

    // Standing in the common dummy band, which sits inside the big common
    // spawn band: two bands over one square, and the inner one has to be the
    // one that answers for what grows there.
    const Rect band = [&] {
        for (const NamedRow& row : namedBandRows()) {
            if (row.mobType == "target_dummy") return row.bounds;
        }
        return Rect{};
    }();
    const Vec2 at{band.x + band.w * 0.5, band.y + band.h * 0.5};

    const std::vector<Vec2> players{at};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    int dummies = 0;
    std::vector<Rarity> tiers;
    std::vector<Vec2> where;
    Query<MobTag, MobType, Transform> mobs{sim.world};
    mobs.each([&](Entity, MobTag&, MobType& type, Transform& transform) {
        if (type.configIndex != dummy) return;
        ++dummies;
        tiers.push_back(type.rarity);
        where.push_back(transform.position);
    });
    CHECK(dummies > 0);
    CHECK_EQ(dummyRowDifficulties().size(), std::size_t{kDummyRowRungs});

    // Permanent and unkillable, so a duplicate would stand there forever: one
    // of each rarity per section, no more.
    for (std::size_t i = 0; i < tiers.size(); ++i) {
        for (std::size_t j = i + 1; j < tiers.size(); ++j) {
            if (tiers[i] == tiers[j]) {
                ::testing::reportFailure(__FILE__, __LINE__,
                                         std::string("two ") + rarityName(tiers[i]) +
                                             " dummies: " + std::to_string(where[i].x) + "," +
                                             std::to_string(where[i].y) + " and " +
                                             std::to_string(where[j].x) + "," +
                                             std::to_string(where[j].y));
            }
        }
    }

    // And every tier is one a dummy band's DIFFICULTY actually produces. The
    // dummy bands between them cover common..unique and the viewport sampled
    // above overlaps several, so the set is wider than one band -- but a tier
    // no band's difficulty can reach would fall outside it, and each of these
    // bands sits on an exact rung of the curve, so its blend is one tier with
    // no fraction in it.
    std::vector<Rarity> declared;
    for (const NamedRow& row : namedBandRows()) {
        if (row.mobType != "target_dummy") continue;
        const TierMix mix = tierMixForDifficulty(row.difficulty);
        declared.push_back(mix.lower);
        if (mix.upperChance > 0.0) declared.push_back(mix.upper);
    }
    for (const Rarity tier : tiers) {
        CHECK(std::find(declared.begin(), declared.end(), tier) != declared.end());
    }
}

TEST(a_target_dummy_is_smaller_than_the_wild_mob_of_its_tier) {
    const std::uint16_t dummy = shipped().mobIndex("target_dummy");
    if (dummy == kInvalidIndex) return;

    // A common dummy matches a common mob exactly; by unique it is three
    // quarters of one. Straight tier scaling turns the top of the DPS row into
    // a wall, which is why the reference ramps it (src/mobs.ts:212).
    Sim sim;
    Rng rng(99);
    const Entity common =
        sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), dummy, Rarity::Common,
                             kCentre, Realm::Overworld, 0.0, rng);
    const Entity unique =
        sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), dummy, Rarity::Unique,
                             kCentre + Vec2{4000.0, 0.0}, Realm::Overworld, 0.0, rng);
    CHECK(common != NULL_ENTITY);
    CHECK(unique != NULL_ENTITY);

    CHECK_NEAR(sim.world.get<MobType>(common).sizeJitter, 1.0, 1e-12);
    CHECK_NEAR(sim.world.get<MobType>(unique).sizeJitter, 0.75, 1e-12);
    CHECK_NEAR(sim.world.get<Body>(unique).radius,
               shipped().mobStats(dummy, Rarity::Unique).radius * 0.75, 1e-9);
}

// ---------------------------------------------------------------------------
// Zone mob distributions
// ---------------------------------------------------------------------------
//
// A zone says WHAT it spawns as weighted rows of section presets and named
// mobs. These drive the whole path -- the authored string, through the Tiled
// map, into MapData, into a running spawn pass -- because the parser agreeing
// with itself proves nothing about which mobs come out.

namespace {

/// Writes a one-zone Tiled map whose spawn polygon covers a 14000-unit square,
/// carrying `distribution` verbatim as its `mobs` property. Difficulty 0, so
/// every mob it grows is a common and these tests are about WHICH mob. Same one-cell
/// shape as fixtureMapBody() above -- a map must name a tileset and carry a
/// tile layer to be a map, and the Sim brings its own flat terrain.
std::string writeZoneMap(const std::string& name, const std::string& distribution) {
    const std::string polygon =
        R"({"id": 1, "class": "spawn", "x": 2000, "y": 2000,
            "polygon": [{"x":0,"y":0},{"x":14000,"y":0},{"x":14000,"y":14000},{"x":0,"y":14000}],
            "properties": [
              {"name": "difficulty", "type": "int", "value": 0},
              {"name": "mobs", "type": "string", "value": ")" + distribution + R"("}
            ]})";
    return writeTiledFixture(name, fixtureMapBody(polygon));
}

/// Every ambient mob a band has put on the map, by config id: the entities and
/// the records alike. Which of the two a given mob is right now is a fact about
/// where the flower is standing, not about what the band grows.
std::vector<std::string> spawnedMobIds(Sim& sim) {
    std::vector<std::string> ids;
    Query<MobTag, MobType> mobs{sim.world};
    mobs.each([&](Entity, MobTag&, MobType& type) {
        ids.push_back(shipped().mob(type.configIndex).id);
    });
    for (const SpawnSystem::LatentSite& site : sim.latent()) {
        ids.push_back(shipped().mob(site.mobIndex).id);
    }
    return ids;
}

} // namespace

TEST(a_zone_that_names_a_mob_spawns_only_that_mob) {
    const std::string path = writeZoneMap("flix_zone_named.tmj", "hornet 100%");
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error) || map.elements().size() != 1) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    CHECK(map.elements()[0].mobDistribution.size() == 1);

    Sim sim;
    WorldMaps maps;
    maps.adoptSingle(map);
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{{9000, 9000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    const std::vector<std::string> ids = spawnedMobIds(sim);
    CHECK(!ids.empty());
    for (const std::string& id : ids) CHECK_EQ(id, std::string("hornet"));
    std::remove(path.c_str());
}

TEST(a_zone_group_borrows_another_biomes_roster) {
    // The zone sits in the top-left corner, and asks for the Ocean. This is
    // the whole point of a group: mobs.json's groups are a palette a band can
    // draw from, rather than nine places the mobs are stuck in.
    const std::string path = writeZoneMap("flix_zone_group.tmj", "ocean 100%");
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error) || map.elements().empty()) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    CHECK_EQ(map.elements()[0].mobDistribution[0].name, std::string("ocean"));
    const std::uint16_t ocean = shipped().mobGroupIndex("ocean");
    CHECK(ocean != kInvalidIndex);

    Sim sim;
    WorldMaps maps;
    maps.adoptSingle(map);
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{{9000, 9000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    const std::vector<std::string> ids = spawnedMobIds(sim);
    CHECK(!ids.empty());
    // Ocean's roster, and none of the Garden's -- a bee here would mean the
    // group was ignored and something else rolled instead.
    for (const std::string& id : ids) {
        const std::uint16_t index = shipped().mobIndex(id);
        CHECK(index != kInvalidIndex);
        bool member = false;
        for (const MobGroupMember& entry : shipped().mob(index).groups) member |= entry.group == ocean;
        CHECK(member);
    }
    std::remove(path.c_str());
}

TEST(a_distribution_splits_in_roughly_the_authored_proportion) {
    // 80/20, over enough spawns that a working split cannot look like a broken
    // one. The bound is loose on purpose: this is asserting that the weights
    // are honoured at all, not pinning the RNG.
    const std::string path = writeZoneMap("flix_zone_split.tmj", "hornet 80% bee 20%");
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error) || map.elements().empty()) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }

    Sim sim;
    WorldMaps maps;
    maps.adoptSingle(map);
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{{9000, 9000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    int hornets = 0;
    int bees = 0;
    for (const std::string& id : spawnedMobIds(sim)) {
        if (id == "hornet") ++hornets;
        else if (id == "bee") ++bees;
        else CHECK_EQ(id, std::string("hornet"));   // nothing else may appear
    }
    CHECK(hornets + bees > 20);
    CHECK(hornets > bees);
    std::remove(path.c_str());
}

// ---------------------------------------------------------------------------
// Realm isolation
// ---------------------------------------------------------------------------
//
// Every map is its own coordinate space. A band on a biome map is stocked for
// the flower standing on THAT map, through that map's own walls, and the
// overworld's own census never reads another map's numbers as its own. Each of these pins one place the spawner used to compare positions
// across realms.

namespace {

/// writeZoneMap()'s band -- one common band naming hornets over
/// (2000,2000)-(16000,16000) -- loaded as `realm`.
bool loadHornetBandAs(const std::string& name, Realm realm, MapData& out) {
    const std::string path = writeZoneMap(name, "hornet 100%");
    std::string error;
    const bool ok = out.loadTiled(path, error, realm) && out.elements().size() == 1;
    if (!ok) std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
    std::remove(path.c_str());
    return ok;
}

/// A flat, open `side`-tile grid installed as `realm`'s map.
void installOpenGrid(Terrain& terrain, Realm realm, int side) {
    std::vector<std::uint8_t> tiles(static_cast<std::size_t>(side) * side,
                                    static_cast<std::uint8_t>(Tile::Ground));
    CHECK(terrain.setTiles(tiles, side, side, realm));
}

int mobsInRealm(World& world, Realm realm) {
    int n = 0;
    Query<MobTag, Transform> mobs{world};
    mobs.each([&](Entity, MobTag&, Transform& t) { n += t.realm == realm ? 1 : 0; });
    return n;
}

} // namespace

TEST(the_border_band_is_measured_against_the_maps_own_extent) {
    // The band of ground along the map edge is off limits to spawning: a mob
    // standing in it is half inside the boundary wall. It is a fraction of the
    // MAP's size, and the map says what that is.
    //
    // This used to be measured against a compile-time 60000-unit square, which
    // was the overworld's size when there was only ever one shape of overworld.
    // The shipped map is 19200 units across, so the right and bottom bands sat
    // forty thousand units outside the world and never rejected anything --
    // mobs spawned flush against those two walls while the left and top were
    // correctly refused. A small map makes it obvious: here the whole map is
    // 24 tiles, so the far band is most of the way across an old constant's
    // idea of the world.
    Sim sim;
    const int side = 24;   // 7200 units
    installOpenGrid(sim.terrain, Realm::Overworld, side);
    const Vec2 extent = sim.terrain.realmExtent(Realm::Overworld);
    CHECK_NEAR(extent.x, side * kTileSize, 1e-6);

    // One band over the whole little map, so there is something to place at
    // all: the question here is WHERE a band fill may put a mob, not what.
    WorldMaps maps;
    makeBandedWorld(maps, {Rect{0.0, 0.0, extent.x, extent.y}}, "garden 100%");
    sim.spawner.worldMaps = &maps;

    // Flowers hugging the FAR two walls, which is the half of the band an
    // oversized constant stops guarding -- the near walls are refused either
    // way and are the control.
    std::vector<Vec2> players;
    for (int i = 1; i <= 3; ++i) {
        players.push_back({extent.x - 150.0, extent.y * i / 4.0});
        players.push_back({extent.x * i / 4.0, extent.y - 150.0});
    }
    for (int i = 0; i < 600; ++i) sim.tick(players);

    int placed = 0;
    int inNearBand = 0;
    int inFarBand = 0;
    const auto judge = [&](Vec2 at) {
        ++placed;
        if (at.x < kWorldBoundaryThreshold || at.y < kWorldBoundaryThreshold) ++inNearBand;
        if (at.x > extent.x - kWorldBoundaryThreshold ||
            at.y > extent.y - kWorldBoundaryThreshold) {
            ++inFarBand;
        }
    };
    Query<MobTag, Transform> mobs{sim.world};
    mobs.each([&](Entity e, MobTag&, Transform& transform) {
        if (transform.realm != Realm::Overworld) return;
        // What the BAND placed. A nest's escorts ring the nest and a long mob's
        // segments trail its head, so neither is a point this pass ever sampled
        // -- and a centipede reversing into the edge wall is movement, not
        // placement.
        if (sim.isChildOfAPlacedMob(e)) return;
        judge(transform.position);
    });
    // The records too, and they are the larger half: the rule under test is
    // about where a band may SAMPLE, and most of what it samples never becomes
    // an entity while one flower stands there.
    for (const SpawnSystem::LatentSite& site : sim.latent()) judge(site.position);
    // Enough mobs that an empty far band means the rule held rather than that
    // nothing was placed at all.
    CHECK(placed >= 40);
    CHECK_EQ(inNearBand, 0);
    CHECK_EQ(inFarBand, 0);

}

TEST(a_band_on_another_map_is_stocked_through_that_maps_own_terrain) {
    // Two maps with the SAME band at the SAME numbers: the overworld's and a
    // second map's. The flower stands on the second map; only its band may
    // fill, and it must fill through the second map's grid -- the overworld
    // is walled over under those numbers, which used to starve it.
    const Realm other = worldRealm(1);
    MapData overworld;
    MapData second;
    if (!loadHornetBandAs("flix_band_realm0.tmj", Realm::Overworld, overworld) ||
        !loadHornetBandAs("flix_band_realm1.tmj", other, second)) {
        CHECK(false);
        return;
    }
    std::vector<MapData> maps;
    maps.push_back(std::move(overworld));
    maps.push_back(std::move(second));
    WorldMaps worldMaps;
    worldMaps.adoptMaps(std::move(maps));
    CHECK(worldMaps.forRealm(other) != nullptr);

    Sim sim;
    sim.spawner.worldMaps = &worldMaps;
    installOpenGrid(sim.terrain, other, 60);   // 18000 units: the band fits
    // The overworld under the whole band is solid.
    for (int ty = 6; ty <= 54; ++ty) {
        for (int tx = 6; tx <= 54; ++tx) sim.terrain.setTile(tx, ty, Tile::Wall, Realm::Overworld);
    }
    CHECK(sim.terrain.blocked({9000, 9000}, Realm::Overworld));
    CHECK(!sim.terrain.blocked({9000, 9000}, other));

    const std::vector<RealmPoint> players{{{9000, 9000}, other}};
    for (int i = 0; i < 400; ++i) {
        sim.spawner.run(sim.world, sim.terrain, shipped(), players, sim.rng, sim.now,
                        net::kTickSeconds, sim.commands);
        sim.commands.flush();
        sim.now += net::kTickMillis;
    }

    // Stocked on the second map, and nowhere else: the overworld's band at
    // the same numbers has nobody looking at it.
    CHECK(mobsInRealm(sim.world, other) > 0);
    CHECK_EQ(mobsInRealm(sim.world, Realm::Overworld), 0);

    // Every one on that map's own open ground, inside the band, and spaced
    // against the others placed in the same pass -- the placement record has
    // to carry the realm for that.
    const Rect band = worldMaps.forRealm(other)->elements()[0].bounds;
    std::vector<Vec2> placed;
    Query<MobTag, Transform, Body> mobs{sim.world};
    mobs.each([&](Entity, MobTag&, Transform& t, Body& body) {
        CHECK(t.realm == other);
        CHECK(!sim.terrain.blocked(t.position, other));
        CHECK(band.contains(t.position));
        for (const Vec2 earlier : placed) {
            CHECK(distance(earlier, t.position) >= body.radius);   // never stacked
        }
        placed.push_back(t.position);
    });

    // And the flower's own presence keeps them: nobody on the overworld means
    // nothing there to recycle, and the band's mobs are near their viewer.
    sim.spawner.run(sim.world, sim.terrain, shipped(), players, sim.rng,
                    sim.now + kMobDespawnDelayMillis + 1000.0, 0.0, sim.commands);
    sim.commands.flush();
    CHECK(mobsInRealm(sim.world, other) > 0);
}


TEST(two_biomes_may_each_hold_a_unique) {
    // The rule is one per BIOME. A unique in the garden says nothing about
    // the desert, just as each biome's clocks run on their own.
    const Realm other = worldRealm(1);
    MapData overworld;
    MapData second;
    overworld.setId("garden_like");
    second.setId("desert_like");
    if (!loadHornetBandAs("flix_biome_realm0.tmj", Realm::Overworld, overworld) ||
        !loadHornetBandAs("flix_biome_realm1.tmj", other, second)) {
        CHECK(false);
        return;
    }
    CHECK(overworld.biome() != second.biome());
    std::vector<MapData> maps;
    maps.push_back(std::move(overworld));
    maps.push_back(std::move(second));
    WorldMaps worldMaps;
    worldMaps.adoptMaps(std::move(maps));

    Sim sim;
    sim.spawner.worldMaps = &worldMaps;
    installOpenGrid(sim.terrain, other, 60);
    sim.tick({});
    // Both unique clocks ready, or the spawns below are refused outright.
    CHECK_EQ(sim.spawner.bossClocks().size(), std::size_t(2));
    for (SpawnSystem::BiomeBossClock& clock : sim.spawner.bossClocks()) {
        clock.uniqueReadyMillis = 0.0;
    }

    const std::uint16_t bee = shipped().mobIndex("bee");
    const Entity here = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee,
                                             Rarity::Unique, {17000, 17000}, Realm::Overworld,
                                             sim.now, sim.rng);
    const Entity there = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee,
                                              Rarity::Unique, {17000, 17000}, other, sim.now,
                                              sim.rng);
    sim.jump(kPopulationIntervalMillis, {});
    CHECK(sim.world.isAlive(here));
    CHECK(sim.world.isAlive(there));

    // A second one on the SAME map is still the extra.
    const Entity extra = sim.spawner.spawnMob(sim.world, sim.terrain, shipped(), bee,
                                              Rarity::Unique, {15000, 15000}, other, sim.now,
                                              sim.rng);
    sim.jump(kPopulationIntervalMillis, {});
    CHECK(sim.world.isAlive(here));
    CHECK(sim.world.isAlive(there));
    CHECK(!sim.world.isAlive(extra));
}

TEST(a_flower_on_another_map_does_not_stock_the_overworld_at_its_numbers) {
    // The overworld's band alone, and a flower standing at the band's numbers
    // on a map that has no band at all: nothing may spawn anywhere.
    MapData overworld;
    if (!loadHornetBandAs("flix_band_only_realm0.tmj", Realm::Overworld, overworld)) {
        CHECK(false);
        return;
    }
    const Realm other = worldRealm(1);
    std::vector<MapData> maps;
    maps.push_back(std::move(overworld));
    maps.push_back(MapData{});
    WorldMaps worldMaps;
    worldMaps.adoptMaps(std::move(maps));

    Sim sim;
    sim.spawner.worldMaps = &worldMaps;
    installOpenGrid(sim.terrain, other, 60);
    const std::vector<RealmPoint> players{{{9000, 9000}, other}};
    for (int i = 0; i < 200; ++i) {
        sim.spawner.run(sim.world, sim.terrain, shipped(), players, sim.rng, sim.now,
                        net::kTickSeconds, sim.commands);
        sim.commands.flush();
        sim.now += net::kTickMillis;
    }
    CHECK_EQ(sim.mobCount(), 0);
}

TEST(a_hard_band_is_where_every_boss_in_the_world_comes_from) {
    // THE INVARIANT that replaced the boss pass. There is no scheduler keeping
    // one ultra alive in the world and one super per section any more: a band's
    // DIFFICULTY is the only thing that produces a high-tier mob, so a
    // difficulty-200 band is full of supers and a map with no hard band has no
    // bosses at all. Those two rules cannot coexist with a pass that rations
    // one ultra to the whole world, which is why the pass is gone.
    //
    // Also checks what survived: the ANNOUNCEMENT. A super, unique or apex is
    // queued for the chat channel from the band fill, which is now the spawn
    // path that produces them.
    const std::string path = writeTiledFixture(
        "flix_hard_band.tmj",
        fixtureMapBody(bandObject(1, 2000, 2000, 14000, 14000, 200.0, "hornet 100%")));
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error) || map.elements().size() != 1) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    CHECK(map.elements()[0].isSpawnBand());
    CHECK_NEAR(map.elements()[0].difficulty, 200.0, 1e-9);

    Sim sim;
    WorldMaps maps;
    maps.adoptSingle(map);
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{{9000, 9000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    int mobs = 0;
    Query<MobTag, MobType> live{sim.world};
    live.each([&](Entity, MobTag&, MobType& type) {
        ++mobs;
        // Difficulty 200 is the super anchor: nothing else may come out of it.
        if (type.rarity != Rarity::Super) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     std::string("a difficulty-200 band spawned a ") +
                                         rarityName(type.rarity));
        }
    });
    CHECK(mobs > 0);
    // And every one of them was worth announcing. The queue is bounded, so this
    // is "some were queued", not "one per mob".
    CHECK(!sim.spawner.bossSpawns.empty());
    for (const SpawnSystem::BossSpawn& boss : sim.spawner.bossSpawns) {
        CHECK(rarityIndex(boss.rarity) >= rarityIndex(kAnnouncedRarity));
        CHECK(boss.realm == Realm::Overworld);
    }
    std::remove(path.c_str());
}

TEST(an_announced_boss_carries_the_map_it_spawned_on) {
    // The chat line is personalised: a player in the boss's own SECTION is told
    // it spawned, everyone else that it spawned somewhere. A section is the
    // OVERWORLD's grid, so the boss's position only means anything once its
    // realm is known -- and since the boss pass was deleted, a band on ANY
    // staged map can queue one. Without the realm, a super filling a band on
    // map two was announced as "here" to flowers standing at the same numbers
    // on the overworld, which they cannot even reach.
    const Realm other = worldRealm(1);
    const std::string path = writeTiledFixture(
        "flix_hard_band_realm1.tmj",
        fixtureMapBody(bandObject(1, 2000, 2000, 14000, 14000, 200.0, "hornet 100%")));
    MapData second;
    std::string error;
    if (!second.loadTiled(path, error, other) || second.elements().size() != 1) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    std::vector<MapData> maps;
    maps.push_back(MapData{});   // an empty overworld: no band, no bosses
    maps.push_back(std::move(second));
    WorldMaps worldMaps;
    worldMaps.adoptMaps(std::move(maps));

    Sim sim;
    sim.spawner.worldMaps = &worldMaps;
    installOpenGrid(sim.terrain, other, 60);
    const std::vector<RealmPoint> players{{{9000, 9000}, other}};
    for (int i = 0; i < 400; ++i) {
        sim.spawner.run(sim.world, sim.terrain, shipped(), players, sim.rng, sim.now,
                        net::kTickSeconds, sim.commands);
        sim.commands.flush();
        sim.now += net::kTickMillis;
    }
    CHECK(mobsInRealm(sim.world, other) > 0);
    CHECK(!sim.spawner.bossSpawns.empty());
    for (const SpawnSystem::BossSpawn& boss : sim.spawner.bossSpawns) {
        CHECK(boss.realm == other);
    }
    std::remove(path.c_str());
}

TEST(a_soft_band_announces_nothing) {
    // The other half of the announcement rule: ordinary ground is silent, so
    // the chat line still means something. Difficulty 0 is fully common.
    const std::string path = writeTiledFixture(
        "flix_soft_band.tmj",
        fixtureMapBody(bandObject(1, 2000, 2000, 14000, 14000, 0.0, "hornet 100%")));
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error)) {
        CHECK(false);
        return;
    }
    Sim sim;
    WorldMaps maps;
    maps.adoptSingle(map);
    sim.spawner.worldMaps = &maps;
    const std::vector<Vec2> players{{9000, 9000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    int mobs = 0;
    Query<MobTag, MobType> live{sim.world};
    live.each([&](Entity, MobTag&, MobType& type) {
        ++mobs;
        CHECK(type.rarity == Rarity::Common);
    });
    CHECK(mobs > 0);
    CHECK(sim.spawner.bossSpawns.empty());
    std::remove(path.c_str());
}

TEST(the_shipped_map_never_spawns_above_the_difficulty_its_ground_declares) {
    // The SHIPPED data, end to end. The bands the author has brushed on are the
    // only ground that grows anything at all, and each one may only be as hard
    // as its own difficulty says. This is the sanity check on the whole curve:
    // the band over the one door is difficulty 0, so a fresh flower walks out
    // into commons.
    //
    // The ceiling is computed FROM THE FILE for each mob's own position, rather
    // than written down here, so an author raising a band's difficulty does not
    // make this test wrong -- it makes it check the new number.
    if (!shippedMaps().forRealm(Realm::Overworld)) {
        ::testing::reportFailure(__FILE__, __LINE__, "the shipped maps did not load");
        return;
    }
    const MapData& world = *shippedMaps().forRealm(Realm::Overworld);

    Sim sim;
    sim.spawner.worldMaps = &shippedMaps();
    // Standing on one of the map's own bands; the Sim brings its own flat
    // terrain, so this is about the tier, not about walls.
    const std::vector<Vec2> players{firstBandCentre(world)};
    for (int i = 0; i < 300; ++i) sim.tick(players);

    // The hardest ground the file declares anywhere, and the ceiling that buys.
    // Nothing in the world may exceed it, wherever it has since wandered to.
    // Zero when the map carries no band at all -- which would also mean no
    // mobs, and the loop below would have nothing to walk.
    double hardest = 0.0;
    for (const MapElement& element : world.elements()) {
        if (element.isSpawnBand()) hardest = std::max(hardest, element.difficulty);
    }
    const int worldCeiling = rarityIndex(tierMixForDifficulty(hardest).upper);

    // How far a mob may have walked since it was placed. A mob is judged
    // against its OWN square only when it is this far inside that square's
    // ground -- otherwise it may have been born under a band and strolled out,
    // and the square it is standing on now never chose it.
    const double kWanderMargin = 4000.0;
    const auto clearOfEveryBand = [&](Vec2 at) {
        for (const MapElement& element : world.elements()) {
            if (!element.isSpawnBand()) continue;
            if (element.bounds.x - kWanderMargin < at.x && at.x < element.bounds.right() + kWanderMargin &&
                element.bounds.y - kWanderMargin < at.y && at.y < element.bounds.bottom() + kWanderMargin) {
                return false;
            }
        }
        return true;
    };

    int mobs = 0;
    int onDefaultGround = 0;
    int onBandedGround = 0;
    Query<MobTag, MobType, Transform> live{sim.world};
    live.each([&](Entity e, MobTag&, MobType& type, Transform& transform) {
        // An escort is not an ambient spawn, and the ground it stands on did not
        // choose it: a nest is placed by a band at that band's tier and then
        // lays its brood out on a ring around itself, which routinely reaches
        // over the band's edge onto ground no band covers. The nest answers for
        // the tier; the ring is just where the children fit. Same exemption --
        // and the same reason -- as the roster test above.
        if (sim.world.has<HoleTether>(e)) return;
        const double difficulty = sim.spawner.difficultyAt(transform.realm, transform.position);
        // The hardest thing this square can roll at neutral luck: the upper half
        // of its blend. A mob's own min_rarity still floors it above that -- that
        // is the mob's property, not the ground's.
        const TierMix mix = tierMixForDifficulty(difficulty);
        const MobConfig& config = shipped().mob(type.configIndex);
        // A body segment is the rest of the same animal as its head, laid out
        // along it and over whatever ground that reaches; the head was judged on
        // its own square.
        if (config.id.find("_body") != std::string::npos) return;
        ++mobs;
        if (rarityIndex(type.rarity) > std::max(worldCeiling, rarityIndex(config.minRarity))) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "the shipped map spawned a " + std::string(rarityName(type.rarity)) +
                                         " " + config.id + ", above anything the hardest ground on "
                                         "the map (difficulty " + std::to_string(hardest) + ") can roll");
        }
        if (difficulty != 0.0 || !clearOfEveryBand(transform.position)) {
            ++onBandedGround;
            return;
        }
        ++onDefaultGround;
        // Well away from every band, so whatever put this mob here, it is not
        // standing on ground that could have rolled it anything but a common.
        // Difficulty zero is FULLY common: not "mostly", and not "common unless
        // something drifted it".
        (void)mix;
        if (rarityIndex(type.rarity) > rarityIndex(config.minRarity)) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "the shipped map spawned a " + std::string(rarityName(type.rarity)) +
                                         " " + config.id + " on difficulty-zero ground");
        }
    });
    CHECK(mobs > 0);
    // Every live mob was judged against a difficulty rather than skipped by a
    // lookup that found nothing. WHICH arm each fell into is the author's
    // business -- a mob born in a difficulty-0 band and one that wandered clear
    // of every band are both "difficulty zero" here.
    CHECK_EQ(onDefaultGround + onBandedGround, mobs);
    // The announcement queue. Whether the map is hard enough to announce
    // ANYTHING is the author's decision -- a band at difficulty 100 is ultras
    // with a couple of supers in it, and the super is the announcement -- so
    // what is pinned is the rule rather than the outcome: a line is queued only
    // for a rarity that both clears the announcement threshold and is one the
    // hardest ground on the map could actually roll. A queue with something
    // below kAnnouncedRarity in it is chat spam; one with something above
    // worldCeiling in it is a mob that came from nowhere on this map.
    if (worldCeiling < rarityIndex(kAnnouncedRarity)) {
        CHECK(sim.spawner.bossSpawns.empty());
    }
    for (const SpawnSystem::BossSpawn& announced : sim.spawner.bossSpawns) {
        CHECK(rarityIndex(announced.rarity) >= rarityIndex(kAnnouncedRarity));
        if (rarityIndex(announced.rarity) > worldCeiling) {
            ::testing::reportFailure(__FILE__, __LINE__,
                                     "the shipped map announced a " +
                                         std::string(rarityName(announced.rarity)) + " " +
                                         shipped().mob(announced.mobIndex).id +
                                         ", above anything its hardest ground (difficulty " +
                                         std::to_string(hardest) + ") can roll");
        }
    }
}

TEST(a_band_is_the_only_ground_that_grows_anything) {
    // THE RULE, stated on one map. Its `defaultMobGroup` says garden, and one
    // difficulty-0 band is drawn on it. Inside the band: commons, from the
    // map's default group -- the band names no roster of its own, which is the
    // "difficulty and distribution are orthogonal" half of the rule. Outside
    // it, on ground the author drew nothing on: NOTHING, however long a flower
    // stands there.
    //
    // This test used to be `a_bands_difficulty_beats_the_maps_default`: the map
    // carried a `defaultDifficulty` of 100 and the second half asserted that
    // the open ground around the band grew ultras. That property is gone --
    // after the density fill was deleted nothing rolled against it, so a number
    // for "the ground no band covers" configured nothing -- and what the second
    // half pins now is that the same ground grows no mob at all.
    const std::string properties =
        R"({"name": "defaultMobGroup", "type": "string", "value": "garden"})";
    const std::string band = bandObject(1, 20000, 20000, 6000, 6000, 0.0, "");
    const std::string path =
        writeTiledFixture("flix_one_band.tmj", fixtureMapBody(band, properties));
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error)) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    CHECK_EQ(map.defaultMobGroup(), std::string("garden"));
    CHECK(map.elements().size() == 1);
    CHECK(map.elements()[0].isSpawnBand());
    std::remove(path.c_str());

    WorldMaps maps;
    maps.adoptSingle(map);
    const std::uint16_t garden = shipped().mobGroupIndex("garden");
    CHECK(garden != kInvalidIndex);

    // Inside the band: commons, and drawn from the map's default group, because
    // the band names nothing of its own.
    {
        Sim sim;
        sim.spawner.worldMaps = &maps;
        const std::vector<Vec2> players{{23000, 23000}};
        for (int i = 0; i < 400; ++i) sim.tick(players);
        int mobs = 0;
        Query<MobTag, MobType, Transform> live{sim.world};
        live.each([&](Entity e, MobTag&, MobType& type, Transform& t) {
            if (!map.elements()[0].contains(t.position)) return;
            ++mobs;
            const MobConfig& config = shipped().mob(type.configIndex);
            if (rarityIndex(type.rarity) > rarityIndex(config.minRarity)) {
                ::testing::reportFailure(__FILE__, __LINE__,
                                         "a difficulty-0 band grew a " +
                                             std::string(rarityName(type.rarity)) + " " +
                                             config.id);
            }
            // The default group answered for the roster. An escort is the
            // hole's choice rather than the group's, and a body segment is in
            // no group at all.
            if (sim.isChildOfAPlacedMob(e) ||
                config.id.find("_body") != std::string::npos) {
                return;
            }
            bool member = false;
            for (const MobGroupMember& entry : config.groups) member |= entry.group == garden;
            if (!member) {
                ::testing::reportFailure(__FILE__, __LINE__,
                                         "a band with no roster of its own grew " + config.id +
                                             ", which is not in the map's default group");
            }
        });
        CHECK(mobs > 0);
    }

    // Outside every band, on the same map, for as long as the band took to
    // fill: nothing. Not commons, not one stray -- nothing samples this ground.
    {
        Sim sim;
        sim.spawner.worldMaps = &maps;
        const std::vector<Vec2> players{{40000, 40000}};
        for (int i = 0; i < 400; ++i) sim.tick(players);
        CHECK_EQ(sim.mobCount(), 0);
        CHECK_EQ(sim.spawner.census().spawnedTotal, 0);
    }
}

TEST(a_harness_with_no_map_at_all_grows_nothing) {
    // The `worldMaps == nullptr` contract, pinned. No maps means no bands, and
    // no bands means no mobs -- a bare-Terrain harness gets an EMPTY world and
    // has to place what it wants itself through spawnMob().
    //
    // Worth its own test because the opposite used to be true: the deleted
    // density fill reached chooseRegionMobAt with no map in hand and rolled
    // over every mob group so that such a harness got mobs anyway. A test
    // written against that behaviour now measures an empty world and passes
    // vacuously, so this is the one that states which way round it is.
    Sim sim;
    CHECK(sim.spawner.worldMaps == nullptr);
    const std::vector<Vec2> players{{9000, 9000}, {30000, 30000}};
    for (int i = 0; i < 400; ++i) sim.tick(players);

    CHECK_EQ(sim.mobCount(), 0);
    CHECK_EQ(sim.spawner.census().spawnedTotal, 0);
}

TEST(a_map_with_no_band_at_all_grows_nothing) {
    // The consequence stated on its own, because it is the one that looks like
    // a bug: a map an author has drawn no band on is EMPTY. Not thinly
    // populated -- empty. The map here has everything else a map can have to
    // say about its mobs (a default group, and a mob region drawn over the
    // whole of it) and still grows nothing, because a region owns no population
    // and there is no longer a pass that fills the ground beside a band.
    const std::string properties =
        R"({"name": "defaultMobGroup", "type": "string", "value": "garden"})";
    const std::string region = regionObject(1, 0, 0, 60000, 60000, "garden 100%");
    const std::string path =
        writeTiledFixture("flix_no_band.tmj", fixtureMapBody(region, properties));
    MapData map;
    std::string error;
    if (!map.loadTiled(path, error)) {
        std::fprintf(stderr, "[test] %s did not load: %s\n", path.c_str(), error.c_str());
        CHECK(false);
        return;
    }
    std::remove(path.c_str());
    CHECK_EQ(map.defaultMobGroup(), std::string("garden"));
    CHECK(map.elements().size() == 1);
    CHECK(map.elements()[0].isMobRegion());
    bool anyBand = false;
    for (const MapElement& element : map.elements()) anyBand |= element.isSpawnBand();
    CHECK(!anyBand);
    // The load report has to say it out loud, because an empty world reads as a
    // broken spawner rather than as an unfinished map. This is the line the
    // author sees at boot and the only warning they get, so it is pinned here
    // rather than trusted: bandSummary() is exactly what the `[map]` line
    // prints for the bands clause.
    CHECK_EQ(map.bandSummary(), std::string("NO SPAWN BANDS -- no mobs will spawn on this map"));

    WorldMaps maps;
    maps.adoptSingle(map);
    Sim sim;
    sim.spawner.worldMaps = &maps;
    // Three flowers spread over the map, long enough for many fill passes.
    const std::vector<Vec2> players{{9000, 9000}, {30000, 30000}, {48000, 12000}};
    for (int i = 0; i < 600; ++i) sim.tick(players);

    CHECK_EQ(sim.mobCount(), 0);
    CHECK_EQ(sim.spawner.census().mobs, 0);
    CHECK_EQ(sim.spawner.census().spawnedTotal, 0);
}

TEST(every_ambient_mob_on_the_shipped_map_stands_inside_a_band) {
    // THE INVARIANT, driven over the game's own data with the real spawn pass.
    //
    // Every mob in the world is inside one of the bands the author drew, or is
    // the escort or body segment of one that is -- a hole's brood rings the
    // hole and a centipede's body trails its head, and both legitimately reach
    // over the band's edge onto ground nothing fills. There is no third case:
    // "somewhere else entirely" is what the deleted density fill used to
    // produce, and this is the test that would catch it coming back.
    if (!shippedMaps().forRealm(Realm::Overworld)) {
        ::testing::reportFailure(__FILE__, __LINE__, "the shipped maps did not load");
        return;
    }
    const MapData& world = *shippedMaps().forRealm(Realm::Overworld);

    // Every band, in map order. The author moves them; this reads them.
    std::vector<const MapElement*> bands;
    for (const MapElement& element : world.elements()) {
        if (element.isSpawnBand()) bands.push_back(&element);
    }
    if (bands.empty()) {
        // A legitimate state for the data to be in -- and then the map grows
        // nothing, which the bandless test above already pins. Nothing to
        // measure here.
        return;
    }

    Sim sim;
    sim.spawner.worldMaps = &shippedMaps();
    // One flower on each band, so every one of them is in view and fills.
    std::vector<Vec2> players;
    for (const MapElement* band : bands) {
        players.push_back({band->bounds.x + band->bounds.w * 0.5,
                           band->bounds.y + band->bounds.h * 0.5});
    }
    for (int i = 0; i < 400; ++i) sim.tick(players);

    int inABand = 0;
    int children = 0;
    int loose = 0;
    Query<MobTag, Transform> live{sim.world};
    live.each([&](Entity e, MobTag&, Transform& transform) {
        bool covered = false;
        for (const MapElement* band : bands) covered |= band->contains(transform.position);
        if (covered) {
            ++inABand;
            return;
        }
        if (sim.isChildOfAPlacedMob(e)) {
            ++children;
            return;
        }
        ++loose;
        ::testing::reportFailure(__FILE__, __LINE__,
                                 "an ambient mob stands on ground no band covers, at " +
                                     std::to_string(transform.position.x) + "," +
                                     std::to_string(transform.position.y));
    });
    CHECK(inABand > 0);
    CHECK_EQ(loose, 0);
    // Reported rather than asserted: whether the shipped roster has a nest or a
    // centipede in it on any given day is the author's business.
    std::printf("  shipped map: %d mobs inside a band, %d escorts/segments outside one, %d loose\n",
                inABand, children, loose);
}

TEST(a_neverambient_mob_never_comes_from_a_group_roll_however_hard_the_ground) {
    // The target dummy is in no group and is marked neverAmbient, so the group
    // roll can never produce one at any difficulty: the only way it reaches the
    // world is a band naming it outright (the DPS row above). Difficulty is a
    // new axis; it must not become a new back door.
    const ContentRegistry& content = shipped();
    const std::uint16_t dummy = content.mobIndex("target_dummy");
    CHECK(dummy != kInvalidIndex);
    CHECK(content.mob(dummy).neverAmbient);

    SpawnSystem spawner;
    Rng rng(5150);
    for (std::size_t group = 0; group < content.mobGroupCount(); ++group) {
        for (int tier = 0; tier < kRarityCount; ++tier) {
            for (int i = 0; i < 200; ++i) {
                const std::uint16_t rolled = spawner.chooseGroupMob(
                    content, static_cast<std::uint16_t>(group), clampRarity(tier), rng);
                CHECK(rolled != dummy);
            }
        }
    }
}
