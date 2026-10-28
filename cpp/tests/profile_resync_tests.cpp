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

#include <functional>
#include <string>

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

/// Comfortably past the server's resync grace: a check sent after this long
/// cannot be racing a Profile still on its way.
constexpr int kPastGraceTicks = 75;

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
    h.step(kPastGraceTicks, {&client});

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
    h.step(kPastGraceTicks, {&client});

    // Stars are not in the digest, so a Profile -- which would overwrite
    // them -- is the only thing that could put this back.
    editInMemory(client).stars = -12345.0;
    client.sendProfileCheck();
    h.step(kPromptTicks * 3, {&client});
    CHECK_EQ(client.profile().stars, -12345.0);
}

TEST(a_profile_check_right_behind_a_profile_waits_for_it) {
    Harness h("resync-grace", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord& record) {
            record.addItem(Rarity::Rare, "petal_rose", 4);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    // The login's own Profile went just now. A check that disagrees inside
    // the grace is taken for one folded before that Profile landed.
    setHeldCount(client, rose, Rarity::Rare, 999);
    client.sendProfileCheck();
    h.step(kPromptTicks * 3, {&client});
    CHECK_EQ(client.profile().stackCount(rose, Rarity::Rare), 999u);

    // Once the grace has run out, the Profile is presumed lost and goes again.
    h.step(kPastGraceTicks, {&client});
    client.sendProfileCheck();
    CHECK(h.stepUntil({&client}, [&] { return client.profile().stackCount(rose, Rarity::Rare) == 4u; },
                      kPromptTicks));
}

TEST(pickups_banked_on_one_tick_are_told_in_one_profile) {
    // A Profile is the whole account, and banking used to send one per pickup
    // and per kill. A veteran's runs to 8-14 KB, so a tick that collected a
    // handful put tens of KB in front of their next snapshot. Three drops
    // taken at once are one Profile, carrying all three.
    Harness h("resync-coalesce", [](const std::string& path) {
        seedTinkerer(path, [](PlayerRecord&) {});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    const std::uint16_t rose = content().petalIndex("rose");
    if (rose == kInvalidIndex) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.joinGame(1920, 1080, {}, "Tinkerer");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    if (body == NULL_ENTITY) { CHECK(false); return; }

    const auto dropUnder = [&] {
        const Transform& at = world.get<Transform>(body);
        const Entity drop = world.create();
        world.add<DropTag>(drop);
        world.add<Transform>(drop, Transform{at.position, 0.0, at.realm});
        world.add<Body>(drop, Body{10.0, 1.0});
        DropItem item;
        item.configIndex = rose;
        item.rarity = Rarity::Common;
        world.add<DropItem>(drop, std::move(item));
        world.add<Lifetime>(drop, Lifetime{30.0});
        world.add<Replicated>(drop, Replicated{net::EntityKind::Drop, 0, rose, Rarity::Common, 0});
    };
    // Profile bytes the client has read since the last call. Every Profile of
    // this account is the same size: the counts change, not the stacks.
    const auto profileBytes = [&] {
        std::uint32_t in = 0, out = 0;
        std::vector<NetClient::WireEvent> top;
        client.takeWireStats(in, out, top, 64);
        for (const NetClient::WireEvent& event : top) {
            if (event.incoming && std::string(event.name) == "profile") return event.bytes;
        }
        return 0u;
    };

    h.step(kPastGraceTicks, {&client});
    profileBytes();
    dropUnder();
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(rose, Rarity::Common) == 1u;
    }, 120));
    h.step(kPromptTicks, {&client});
    const std::uint32_t one = profileBytes();
    CHECK(one > 0);

    dropUnder();
    dropUnder();
    dropUnder();
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(rose, Rarity::Common) == 4u;
    }, 120));
    h.step(kPromptTicks, {&client});
    CHECK_EQ(profileBytes(), one);
}
