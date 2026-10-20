#include "test.h"

#include "server_harness.h"
#include "shared/game/absorb.h"
#include "shared/game/components.h"
#include "shared/game/constants.h"

using namespace flix;
using flix::testsupport::awaitProfile;
using flix::testsupport::connectClient;
using flix::testsupport::dataDir;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;
using flix::testsupport::onlyPlayer;
using flix::testsupport::seedStack;
using flix::testsupport::seedUser;

// Absorbing: the craft window's Absorb side, which destroys petals for XP.
// The price is shared/game/absorb.h's; the requests go over a real socket,
// because the Profile that comes back is what the window redraws from.

namespace {

/// Seeds an account's Absorption talent, for the cases about the multiplier.
void seedAbsorbing(const std::string& path, const std::string& username, Rarity tier) {
    Database db;
    std::string error;
    db.load(path, error);
    const Account* account = db.findUser(username);
    if (account == nullptr) return;
    db.progress(account->id).skills.set(SkillId::Absorbing, rarityIndex(tier));
    db.markDirty();
    db.save();
}

/// Sends one Absorb and hands its answer back with `pending` cleared, as the
/// panel reads it.
bool absorb(Harness& h, NetClient& client, const std::vector<NetClient::AbsorbStack>& stacks,
            AbsorbOutcome& out) {
    client.requestAbsorb(stacks);
    if (!h.stepUntil({&client}, [&] { return client.absorbOutcome().pending; }, 200)) return false;
    out = client.absorbOutcome();
    client.absorbOutcome().pending = false;
    return true;
}

} // namespace

TEST(every_tier_is_worth_seven_of_the_one_below_and_a_rare_is_one_xp) {
    CHECK_NEAR(absorbXpPerPetal(Rarity::Rare), 1.0, 1e-12);
    CHECK_NEAR(absorbXpPerPetal(Rarity::Epic), 7.0, 1e-12);
    CHECK_NEAR(absorbXpPerPetal(Rarity::Legendary), 49.0, 1e-12);
    CHECK_NEAR(absorbXpPerPetal(Rarity::Apex), 823543.0, 1e-6);
    CHECK_NEAR(absorbXpPerPetal(Rarity::Common), 1.0 / 49.0, 1e-12);
    // Well under a kill of the same tier: absorbing is a side income.
    CHECK(absorbXpPerPetal(Rarity::Mythic) < 32000.0 * 0.05);
}

TEST(a_request_is_floored_once_so_fractions_add_up) {
    const SkillSet none;
    // Forty-nine commons are one XP however they are counted -- not 49 times
    // a fraction that floors to nothing.
    CHECK_EQ(absorbXpTotal(49.0 * absorbUnits(Rarity::Common), none), 1.0);
    CHECK_EQ(absorbXpTotal(48.0 * absorbUnits(Rarity::Common), none), 0.0);
    CHECK_EQ(absorbXpTotal(7.0 * absorbUnits(Rarity::Uncommon), none), 1.0);
    CHECK_EQ(absorbXpTotal(3.0 * absorbUnits(Rarity::Epic) + absorbUnits(Rarity::Rare), none),
             22.0);

    // The talent multiplies before the floor, and a total that is whole on
    // paper stays whole: 50 rares at 2.52x is 126, not 125.
    SkillSet legendary;
    legendary.set(SkillId::Absorbing, rarityIndex(Rarity::Legendary));
    CHECK_EQ(absorbXpTotal(50.0 * absorbUnits(Rarity::Rare), legendary), 126.0);
    SkillSet apex;
    apex.set(SkillId::Absorbing, rarityIndex(Rarity::Apex));
    CHECK_EQ(absorbXpTotal(absorbUnits(Rarity::Rare), apex), 8.0);
}

TEST(the_basic_and_universals_cannot_be_absorbed) {
    PetalConfig basic;
    basic.id = "basic";
    PetalConfig rose;
    rose.id = "rose";
    CHECK(!absorbable(basic, Rarity::Common));
    CHECK(!absorbable(basic, Rarity::Mythic));
    CHECK(absorbable(rose, Rarity::Common));
    CHECK(absorbable(rose, Rarity::Apex));
    CHECK(!absorbable(rose, Rarity::Universal));
}

TEST(absorbing_on_the_title_screen_pays_the_account) {
    Harness h("absorb-title", [](const std::string& path) {
        seedUser(path, "eater", "password7");
        seedStack(path, "eater", "petal_rose", Rarity::Rare, 10);
        seedStack(path, "eater", "petal_light", Rarity::Epic, 3);
        seedStack(path, "eater", "petal_light", Rarity::Common, 100);
    });
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t light = content().petalIndex("light");
    if (rose == kInvalidIndex || light == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "eater", "password7"));
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Rare) == 10u &&
               p.stackCount(light, Rarity::Common) == 100u;
    }));
    const double before = client.profile().totalXp;

    // Every stack in one request, priced once: 10 + 2 x 7 + floor(60/49).
    AbsorbOutcome outcome;
    CHECK(absorb(h, client,
                 {{rose, Rarity::Rare, 10}, {light, Rarity::Epic, 2}, {light, Rarity::Common, 60}},
                 outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.xpGained, 25.0);
    CHECK_EQ(outcome.absorbed, 72u);
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Rare) == 0u && p.stackCount(light, Rarity::Epic) == 1u &&
               p.stackCount(light, Rarity::Common) == 40u && p.totalXp == before + 25.0;
    }));
}

TEST(an_absorb_short_of_one_stack_takes_nothing) {
    Harness h("absorb-short", [](const std::string& path) {
        seedUser(path, "eater", "password7");
        seedStack(path, "eater", "petal_rose", Rarity::Rare, 10);
        seedStack(path, "eater", "petal_light", Rarity::Epic, 3);
        seedStack(path, "eater", "petal_basic", Rarity::Rare, 5);
        seedStack(path, "eater", "petal_rose", Rarity::Universal, 1);
    });
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t light = content().petalIndex("light");
    const std::uint16_t basic = content().petalIndex("basic");
    if (rose == kInvalidIndex || light == kInvalidIndex || basic == kInvalidIndex) {
        CHECK(false);
        return;
    }

    NetClient client;
    CHECK(loginAs(h, client, "eater", "password7"));
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Rare) == 10u;
    }));
    const double before = client.profile().totalXp;

    // One stack the bag cannot cover refuses the lot.
    AbsorbOutcome outcome;
    CHECK(absorb(h, client, {{rose, Rarity::Rare, 10}, {light, Rarity::Epic, 4}}, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(outcome.xpGained, 0.0);
    CHECK(!outcome.reason.empty());
    // Naming a stack twice asks for the sum, and the sum is checked.
    CHECK(absorb(h, client, {{rose, Rarity::Rare, 6}, {rose, Rarity::Rare, 6}}, outcome));
    CHECK(!outcome.success);
    // A basic, at any tier, and a universal are never absorbed.
    CHECK(absorb(h, client, {{rose, Rarity::Rare, 1}, {basic, Rarity::Rare, 5}}, outcome));
    CHECK(!outcome.success);
    CHECK(absorb(h, client, {{rose, Rarity::Universal, 1}}, outcome));
    CHECK(!outcome.success);

    h.step(10, {&client});
    const Profile& p = client.profile();
    CHECK_EQ(p.stackCount(rose, Rarity::Rare), 10u);
    CHECK_EQ(p.stackCount(light, Rarity::Epic), 3u);
    CHECK_EQ(p.stackCount(basic, Rarity::Rare), 5u);
    CHECK_EQ(p.stackCount(rose, Rarity::Universal), 1u);
    CHECK_EQ(p.totalXp, before);
}

TEST(the_absorption_talent_multiplies_what_absorbing_pays) {
    Harness h("absorb-talent", [](const std::string& path) {
        seedUser(path, "eater", "password7");
        seedStack(path, "eater", "petal_rose", Rarity::Rare, 50);
        seedAbsorbing(path, "eater", Rarity::Legendary);
    });
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "eater", "password7"));
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.stackCount(rose, Rarity::Rare) == 50u;
    }));
    AbsorbOutcome outcome;
    CHECK(absorb(h, client, {{rose, Rarity::Rare, 50}}, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.xpGained, 126.0);
}

TEST(absorbing_in_the_world_levels_the_flower_up_on_the_spot) {
    Harness h(
        "absorb-live",
        [](const std::string& path) {
            seedUser(path, "eater", "password7");
            seedStack(path, "eater", "petal_rose", Rarity::Legendary, 2);
        },
        dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "eater", "password7"));
    client.joinGame(1920, 1080, {}, "Eater");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                      200));
    World& world = h.server.world();
    const Entity body = onlyPlayer(world);
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    const double before = world.get<PlayerProgress>(body).totalXp;
    const int levelBefore = world.get<PlayerProgress>(body).level;

    // Two legendaries are 98 XP: a fresh flower's first few levels at once,
    // and the body -- the XP authority while it lives -- takes them now.
    AbsorbOutcome outcome;
    CHECK(absorb(h, client, {{rose, Rarity::Legendary, 2}}, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.xpGained, 98.0);
    const PlayerProgress& progress = world.get<PlayerProgress>(body);
    CHECK_EQ(progress.totalXp, before + 98.0);
    CHECK(progress.level > levelBefore);
    CHECK_EQ(progress.level, levelFromTotalXp(before + 98.0).level);
    // The level-up landed with the XP: the new level's health, full.
    const Health& health = world.get<Health>(body);
    CHECK(health.max > maxHealthForLevel(levelBefore));
    CHECK_EQ(health.current, health.max);
    // And the record was brought level with the body straight away, so the
    // Profile that followed already counts it.
    CHECK(awaitProfile(h, client, [&](const Profile& p) {
        return p.totalXp == before + 98.0 && p.stackCount(rose, Rarity::Legendary) == 0u;
    }));
}
