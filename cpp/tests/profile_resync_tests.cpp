// The bag and bar a client holds against the server's copy of them.
//
// A web client's Profile lives in wasm memory, and a count in it is one
// HEAPU32 write away from any number a player likes. Nothing the server does
// may depend on it: every equip, craft and absorb is checked against the
// record. What these tests add is the other half -- a client whose copy has
// drifted, by an edit or a missed Profile, is sent the real one again.
//
// A memory edit is simulated as exactly that: the held Profile changed in
// place behind NetClient's back, with nothing sent.

#include "test.h"

#include <algorithm>
#include <functional>
#include <string>
#include <tuple>
#include <vector>

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

constexpr const char* kName = "tinkerer";
constexpr const char* kPassword = "password7";

/// Long enough for any answer to a check to land, and for the next check to
/// be past the server's floor between two (kProfileCheckFloorMillis, 1 s).
constexpr int kSettleTicks = 75;

/// A refusal is answered in the same breath; this is a round trip and change,
/// and far inside the ProfileCheck period.
constexpr int kPromptTicks = 10;

StoredItem petal(const char* id, Rarity rarity) {
    StoredItem item;
    item.type = "petal";
    item.petalType = id;
    item.rarity = rarity;
    return item;
}

/// One account, whose record `fill` writes before the server ever opens it.
void seedTinkerer(const std::string& path, const std::function<void(PlayerRecord&)>& fill) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    CreateResult created = db.createUser(kName, kPassword);
    if (!created.ok()) return;
    PlayerRecord& record = db.progress(created.account->id);
    record.loadout.assign(kLoadoutSlots, std::nullopt);
    fill(record);
    db.markDirty();
    db.save();
}

bool login(Harness& h, NetClient& client) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(kName, kPassword);
    return h.stepUntil({&client}, [&] {
        return client.status() == NetClient::Status::LoggedIn &&
               client.profile().loadout.size() == static_cast<std::size_t>(kLoadoutSlots);
    });
}

/// What a HEAPU32 write does to the client: its Profile, changed in memory.
Profile& editInMemory(NetClient& client) { return const_cast<Profile&>(client.profile()); }

void setHeldCount(NetClient& client, std::uint16_t petalIndex, Rarity rarity, std::uint32_t count) {
    for (Profile::Stack& stack : editInMemory(client).inventory) {
        if (stack.petalIndex == petalIndex && stack.rarity == rarity) {
            stack.count = count;
            return;
        }
    }
    editInMemory(client).inventory.push_back({petalIndex, rarity, count});
}

const PlayerRecord* tinkererRecord(Harness& h) {
    const Account* account = h.server.database().findUser(kName);
    return account == nullptr ? nullptr : h.server.database().findProgress(account->id);
}

bool slotEmpty(const NetClient& client, int slot) {
    const auto& loadout = client.profile().loadout;
    return static_cast<std::size_t>(slot) < loadout.size() &&
           loadout[static_cast<std::size_t>(slot)].empty();
}

/// The flower this client steers, once it has joined.
Entity bodyOf(Harness& h) {
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{h.server.world()};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    return body;
}

bool joinWorld(Harness& h, NetClient& client) {
    client.joinGame(1920, 1080, {}, "Tinkerer");
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; },
                       200) &&
           bodyOf(h) != NULL_ENTITY;
}

/// A drop lying under `body`, which the next tick's loot pass collects.
void dropUnder(Harness& h, Entity body, std::uint16_t petal, Rarity rarity) {
    World& world = h.server.world();
    const Transform& at = world.get<Transform>(body);
    const Entity drop = world.create();
    world.add<DropTag>(drop);
    world.add<Transform>(drop, Transform{at.position, 0.0, at.realm});
    world.add<Body>(drop, Body{10.0, 1.0});
    DropItem item;
    item.configIndex = petal;
    item.rarity = rarity;
    world.add<DropItem>(drop, std::move(item));
    world.add<Lifetime>(drop, Lifetime{30.0});
    world.add<Replicated>(drop, Replicated{net::EntityKind::Drop, 0, petal, rarity, 0});
}

/// Bytes of server message `name` the client has read since the last call --
/// which also resets every counter.
std::uint32_t takeIncoming(NetClient& client, const char* name) {
    std::uint32_t in = 0, out = 0;
    std::vector<NetClient::WireEvent> top;
    client.takeWireStats(in, out, top, 64);
    for (const NetClient::WireEvent& event : top) {
        if (event.incoming && std::string(event.name) == name) return event.bytes;
    }
    return 0;
}

/// Sends a ProfileCheck and steps long enough for any answer to land, and
/// for the next check to be past the server's floor. True when the answer
/// was a whole Profile.
bool checkBroughtProfile(Harness& h, NetClient& client) {
    takeIncoming(client, "profile");
    client.sendProfileCheck();
    h.step(kSettleTicks, {&client});
    return takeIncoming(client, "profile") > 0;
}

} // namespace

TEST(a_profile_digest_ignores_the_order_of_stacks_but_not_of_slots) {
    net::ProfileDigest a;
    a.stack(3, 2, 10);
    a.stack(7, 0, 1);
    net::ProfileDigest b;
    b.stack(7, 0, 1);
    b.stack(3, 2, 10);
    CHECK_EQ(a.value(), b.value());

    // One count off by one is a different bag.
    net::ProfileDigest c;
    c.stack(3, 2, 11);
    c.stack(7, 0, 1);
    CHECK(c.value() != a.value());

    // Two petals trading slots is a different bar.
    net::ProfileDigest d;
    d.slot(0, 3, 1);
    d.slot(1, 7, 1);
    net::ProfileDigest e;
    e.slot(0, 7, 1);
    e.slot(1, 3, 1);
    CHECK(d.value() != e.value());
}

TEST(a_stack_edited_into_client_memory_cannot_be_equipped_and_is_put_back) {
    Harness h("resync-equip", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 1);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t light = content().petalIndex("light");
    if (rose == kInvalidIndex || light == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    CHECK(awaitProfile(h, client, [&](const Profile& p) { return p.stackCount(rose, Rarity::Rare) == 1u; }));

    // A stack the account never had, written straight into the client.
    setHeldCount(client, light, Rarity::Mythic, 3);
    client.setLoadoutSlot(0, light, Rarity::Mythic);
    CHECK(h.stepUntil({&client}, [&] { return client.profile().stackCount(light, Rarity::Mythic) == 0u; },
                      kPromptTicks));
    CHECK(slotEmpty(client, 0));

    // The one rose it does own equips; inflating the count it was left with
    // does not make a second.
    client.setLoadoutSlot(0, rose, Rarity::Rare);
    CHECK(awaitProfile(h, client, [&](const Profile& p) { return !p.loadout[0].empty(); }));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 0u);
    setHeldCount(client, rose, Rarity::Rare, 50);
    client.setLoadoutSlot(1, rose, Rarity::Rare);
    CHECK(h.stepUntil({&client}, [&] { return client.profile().stackCount(rose, Rarity::Rare) == 0u; },
                      kPromptTicks));
    CHECK(slotEmpty(client, 1));

    // And the record never saw any of it.
    const PlayerRecord* record = tinkererRecord(h);
    CHECK(record != nullptr);
    if (record == nullptr) return;
    CHECK_EQ(record->itemCount(Rarity::Mythic, "petal_light"), 0);
    CHECK_EQ(record->itemCount(Rarity::Rare, "petal_rose"), 0);
    CHECK(record->loadout.size() > 1 && record->loadout[0].has_value() && !record->loadout[1].has_value());
}

TEST(a_profile_check_that_disagrees_brings_the_real_profile_back) {
    Harness h("resync-check", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
            record.loadout[2] = petal("light", Rarity::Epic);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t light = content().petalIndex("light");
    if (rose == kInvalidIndex || light == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    h.step(kSettleTicks, {&client});

    // Nothing is asked of the server: the edit sits there until the check.
    setHeldCount(client, rose, Rarity::Rare, 999);
    editInMemory(client).loadout[2].rarity = Rarity::Mythic;
    h.step(kPromptTicks, {&client});
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 999u);

    client.sendProfileCheck();
    CHECK(h.stepUntil({&client}, [&] { return client.profile().stackCount(rose, Rarity::Rare) == 4u; },
                      kPromptTicks));
    CHECK(client.profile().loadout[2].petalIndex == light);
    CHECK(client.profile().loadout[2].rarity == Rarity::Epic);
}

TEST(a_profile_check_that_agrees_is_answered_with_nothing) {
    // Several tiers in the bag and petals on both rows, so the two ends
    // folding the same Profile independently is actually tested.
    Harness h("resync-agree", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
            record.addItem(Rarity::Common, "petal_basic", 12);
            record.addItem(Rarity::Legendary, "petal_light", 1);
            record.loadout[0] = petal("rose", Rarity::Epic);
            record.loadout[4] = petal("basic", Rarity::Common);
            record.loadout[13] = petal("light", Rarity::Rare);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    h.step(kSettleTicks, {&client});

    // Stars are not in the digest, so a Profile -- which would overwrite
    // them -- is the only thing that could put this back.
    editInMemory(client).stars = -12345.0;
    client.sendProfileCheck();
    h.step(kPromptTicks * 3, {&client});
    CHECK_EQ(client.profile().stars, -12345.0);
}

TEST(a_profile_check_behind_the_server_s_revision_is_not_judged) {
    Harness h("resync-revision", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    h.step(kSettleTicks, {&client});

    // A check folded before the latest Profile landed -- here, one that names
    // the revision before it -- describes a bag the server has moved on from.
    // However wrong it looks, it is not answered.
    setHeldCount(client, rose, Rarity::Rare, 999);
    const std::uint32_t latest = client.profile().revision;
    CHECK(latest > 0);
    editInMemory(client).revision = latest - 1;
    CHECK(!checkBroughtProfile(h, client));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 999u);

    // Caught up, the same disagreement is a desync, and is repaired at once.
    editInMemory(client).revision = latest;
    CHECK(checkBroughtProfile(h, client));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 4u);
}

TEST(pickups_are_told_as_a_delta_that_leaves_the_digests_agreeing) {
    // A Profile is the whole account -- 8 to 14 KB for a veteran -- and
    // banking used to send one per pickup and per kill. Pickups now send the
    // stacks they changed, and the client that applies them holds exactly
    // what a Profile would have given it: its next check agrees.
    Harness h("resync-delta", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
            record.addItem(Rarity::Common, "petal_basic", 12);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t light = content().petalIndex("light");
    if (rose == kInvalidIndex || light == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    CHECK(joinWorld(h, client));
    const Entity body = bodyOf(h);
    h.step(kSettleTicks, {&client});
    takeIncoming(client, "profile");

    // Three of a stack it holds and one of a petal new to the bag, taken on
    // one tick: one delta, two groups.
    dropUnder(h, body, rose, Rarity::Rare);
    dropUnder(h, body, rose, Rarity::Rare);
    dropUnder(h, body, rose, Rarity::Rare);
    dropUnder(h, body, light, Rarity::Epic);
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(rose, Rarity::Rare) == 7u &&
               client.profile().stackCount(light, Rarity::Epic) == 1u;
    }, 120));
    h.step(kPromptTicks, {&client});
    CHECK_EQ(takeIncoming(client, "profile"), 0u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("basic"), Rarity::Common), 12u);

    // And the delta was small: a header and two groups, not a bag.
    dropUnder(h, body, rose, Rarity::Rare);
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(rose, Rarity::Rare) == 8u;
    }, 120));
    h.step(kPromptTicks, {&client});
    const std::uint32_t delta = takeIncoming(client, "profileDelta");
    CHECK(delta > 0u);
    CHECK(delta < 64u);

    CHECK(!checkBroughtProfile(h, client));
}

TEST(a_kill_is_told_as_a_delta_cell_of_the_ledger) {
    Harness h("resync-kill", [](const std::string& path) {
        seedUser(path, kName, kPassword, true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t bee = content().mobIndex("bee");
    if (bee == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    CHECK(joinWorld(h, client));
    const Entity body = bodyOf(h);
    CHECK(say(h, client, "/admin spawn bee common"));
    h.step(kPromptTicks, {&client});
    takeIncoming(client, "profile");

    World& world = h.server.world();
    std::vector<Entity> bees;
    Query<MobTag, MobType> mobs{world};
    mobs.each([&](Entity e, MobTag&, MobType& type) {
        if (type.configIndex == bee && type.rarity == Rarity::Common) bees.push_back(e);
    });
    CHECK(!bees.empty());
    if (bees.empty()) return;
    const Entity target = bees.front();
    // A sliver of health against the flower's bare body, with a real fight's
    // worth of credit so the kill is this flower's to bank.
    if (Bounty* bounty = world.tryGet<Bounty>(target)) {
        bounty->credit(body, world.get<Health>(target).max);
    }
    CHECK(h.stepUntil({&client}, [&] {
        if (world.isAlive(target) && !world.has<Dead>(target)) {
            if (Armor* armor = world.tryGet<Armor>(target)) armor->amount = 0.0;
            Health& health = world.get<Health>(target);
            health.current = std::min(health.current, 0.01);
            world.get<Transform>(target).position = world.get<Transform>(body).position + Vec2{30, 0};
        }
        return client.profile().killCount(bee, Rarity::Common) == 1u;
    }, 300));
    h.step(kPromptTicks, {&client});
    CHECK_EQ(takeIncoming(client, "profile"), 0u);
    CHECK(!checkBroughtProfile(h, client));
}

TEST(a_client_that_drifted_under_deltas_is_sent_the_whole_profile) {
    // A delta only restates what it touched. A stack edited in memory
    // elsewhere in the bag survives it, and the check that follows -- caught
    // up, with nothing owed -- is what puts it back.
    Harness h("resync-drift", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    const std::uint16_t basic = content().petalIndex("basic");
    if (rose == kInvalidIndex || basic == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    CHECK(joinWorld(h, client));
    const Entity body = bodyOf(h);
    h.step(kSettleTicks, {&client});

    setHeldCount(client, rose, Rarity::Rare, 999);
    dropUnder(h, body, basic, Rarity::Common);
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(basic, Rarity::Common) == 1u;
    }, 120));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 999u);

    CHECK(checkBroughtProfile(h, client));
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 4u);
    CHECK_EQ(client.profile().stackCount(basic, Rarity::Common), 1u);
}

TEST(a_delta_restates_every_stack_a_legacy_bag_keeps_for_one_petal) {
    // A bag from before the "petal_" prefix can hold one petal under two
    // names, and the Profile sends both. A delta for that petal has to say
    // both as well, or the client's digest would never agree again.
    Harness h("resync-legacy", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Common, "rose", 2);
            record.addItem(Rarity::Common, "petal_rose", 3);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    CHECK(joinWorld(h, client));
    const Entity body = bodyOf(h);
    h.step(kSettleTicks, {&client});
    const auto held = [&] {
        std::vector<std::uint32_t> counts;
        for (const Profile::Stack& stack : client.profile().inventory) {
            if (stack.petalIndex == rose && stack.rarity == Rarity::Common) counts.push_back(stack.count);
        }
        std::sort(counts.begin(), counts.end());
        return counts;
    };
    const std::vector<std::uint32_t> before = held();
    // Both names survived the load, so this is the legacy bag it is about.
    CHECK_EQ(before.size(), std::size_t(2));

    dropUnder(h, body, rose, Rarity::Common);
    CHECK(h.stepUntil({&client}, [&] { return held() != before; }, 120));
    h.step(kPromptTicks, {&client});
    std::uint32_t total = 0;
    for (const std::uint32_t count : held()) total += count;
    CHECK_EQ(total, 6u);
    CHECK(!checkBroughtProfile(h, client));
}

namespace {

/// Everything a Profile tells the client, compared the way the client uses
/// it: the bag in any order, the rest as it stands.
bool sameAccount(const Profile& a, const Profile& b) {
    const auto bag = [](const Profile& p) {
        std::vector<std::tuple<std::uint16_t, int, std::uint32_t>> stacks;
        for (const Profile::Stack& s : p.inventory) {
            stacks.emplace_back(s.petalIndex, rarityIndex(s.rarity), s.count);
        }
        std::sort(stacks.begin(), stacks.end());
        return stacks;
    };
    const auto sameSlots = [](const std::vector<Profile::Slot>& x, const std::vector<Profile::Slot>& y) {
        return std::equal(x.begin(), x.end(), y.begin(), y.end(),
                          [](const Profile::Slot& l, const Profile::Slot& r) {
                              return l.petalIndex == r.petalIndex && l.rarity == r.rarity;
                          });
    };
    if (a.username != b.username || a.guest != b.guest || a.hasPassword != b.hasPassword) return false;
    if (a.totalXp != b.totalXp || a.level != b.level || a.stars != b.stars) return false;
    if (bag(a) != bag(b) || !sameSlots(a.loadout, b.loadout)) return false;
    if (a.skills.tier != b.skills.tier || a.mobKills != b.mobKills) return false;
    for (std::size_t i = 0; i < a.presets.size(); ++i) {
        if (!sameSlots(a.presets[i], b.presets[i])) return false;
    }
    return true;
}

} // namespace

TEST(account_changes_are_told_as_deltas_that_leave_the_client_holding_the_profile) {
    // Every equip, swap, preset and talent used to answer with the whole
    // Profile -- the bag and the kill ledger again, 8 to 14 KB for a veteran
    // -- so a player sorting their bar spent more on Profiles than on
    // snapshots. Each now answers with what it changed, and the client that
    // applies them all holds exactly what the whole Profile then says.
    Harness h("resync-actions", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            // A veteran's bag and ledger, so the whole Profile is big. The
            // server has not loaded its content yet, so this reads its own.
            const ContentRegistry& shipped = shippedContent();
            for (std::size_t i = 0; i < shipped.petalCount(); ++i) {
                const std::string key = "petal_" + shipped.petal(static_cast<std::uint16_t>(i)).id;
                record.addItem(Rarity::Common, key, 3);
                record.addItem(Rarity::Rare, key, 2);
            }
            for (std::size_t i = 0; i < shipped.mobCount(); ++i) {
                record.recordKill(shipped.mob(static_cast<std::uint16_t>(i)).id, Rarity::Common);
            }
            record.addItem(Rarity::Legendary, "petal_light", 1);
            record.loadout[0] = petal("basic", Rarity::Common);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t light = content().petalIndex("light");
    if (light == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    h.step(kSettleTicks, {&client});
    const std::uint32_t whole = takeIncoming(client, "profile");
    CHECK(whole > 1000u);

    // Each answer is a delta, and a small one.
    const auto answeredByDelta = [&](const std::function<bool(const Profile&)>& done) {
        if (!awaitProfile(h, client, done)) return false;
        h.step(kPromptTicks, {&client});
        std::uint32_t in = 0, out = 0;
        std::vector<NetClient::WireEvent> top;
        client.takeWireStats(in, out, top, 64);
        std::uint32_t full = 0, delta = 0;
        for (const NetClient::WireEvent& event : top) {
            if (!event.incoming) continue;
            if (std::string(event.name) == "profile") full += event.bytes;
            if (std::string(event.name) == "profileDelta") delta += event.bytes;
        }
        return full == 0 && delta > 0 && delta < whole / 4;
    };

    // The last legendary light onto the bar: its stack leaves the bag.
    client.setLoadoutSlot(1, light, Rarity::Legendary);
    CHECK(answeredByDelta([&](const Profile& p) {
        return p.loadout[1].petalIndex == light && p.stackCount(light, Rarity::Legendary) == 0u;
    }));
    client.swapLoadoutSlots(0, 1);
    CHECK(answeredByDelta([&](const Profile& p) { return p.loadout[0].petalIndex == light; }));
    client.swapLoadoutRows();
    CHECK(answeredByDelta([&](const Profile& p) { return p.loadout[10].petalIndex == light; }));
    client.saveLoadoutPreset(3);
    CHECK(answeredByDelta([&](const Profile& p) { return p.presets[3].size() > 10; }));
    client.requestUpgradeSkill(SkillId::Damage, 0);
    CHECK(answeredByDelta([&](const Profile& p) { return p.skills.level(SkillId::Damage) == 0; }));
    // And off the bar again: a stack new to the bag.
    client.setLoadoutSlot(10, kNoPetal, Rarity::Common);
    CHECK(answeredByDelta([&](const Profile& p) {
        return p.loadout[10].empty() && p.stackCount(light, Rarity::Legendary) == 1u;
    }));
    CHECK(!checkBroughtProfile(h, client));

    // A refusal brings the whole Profile, whatever the client holds; it has to
    // be what the deltas had already built.
    const Profile told = client.profile();
    setHeldCount(client, light, Rarity::Mythic, 3);
    client.setLoadoutSlot(2, light, Rarity::Mythic);
    CHECK(h.stepUntil({&client}, [&] { return client.profile().stackCount(light, Rarity::Mythic) == 0u; },
                      kPromptTicks));
    CHECK(takeIncoming(client, "profile") > 0u);
    CHECK(client.profile().revision > told.revision);
    CHECK(sameAccount(client.profile(), told));
}
