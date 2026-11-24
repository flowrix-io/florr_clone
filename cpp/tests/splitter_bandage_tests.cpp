// A splitter worn beside a bandage (user's rule, 2026-11-23, replacing the
// 2026-11-11 one that held the splitter back whenever a bandage was worn):
// the two work together as any two petals do, but while the bandage's Undead
// is running the splitter is switched off -- it fields nothing, splits
// nothing, and a split flower is merged back, the other half despawned.
//
// End to end on a real server, with accounts seeded through the Database the
// way loadout_preset_tests.cpp seeds them.

#include "test.h"

#include <array>
#include <functional>
#include <string>

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/config.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

constexpr const char* kName = "mender";
constexpr const char* kPassword = "password7";
constexpr const char* kBandageId = "bandage";

StoredItem petal(const char* id, Rarity rarity) {
    StoredItem item;
    item.petalType = id;
    item.rarity = rarity;
    return item;
}

std::string bagKey(const char* id) { return std::string("petal_") + id; }

void seedMender(const std::string& path, const std::function<void(PlayerRecord&)>& fill) {
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

/// Logs the seeded account in and puts it in the world.
bool play(Harness& h, NetClient& client) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(kName, kPassword);
    if (!h.stepUntil({&client}, [&] {
            return client.status() == NetClient::Status::LoggedIn &&
                   client.profile().loadout.size() == static_cast<std::size_t>(kLoadoutSlots);
        })) {
        return false;
    }
    client.joinGame(1280, 720, {}, kName);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; });
}

bool slotIs(const NetClient& client, int slot, const char* id) {
    const auto& loadout = client.profile().loadout;
    return slot >= 0 && static_cast<std::size_t>(slot) < loadout.size() &&
           loadout[static_cast<std::size_t>(slot)].petalIndex == content().petalIndex(id);
}

std::vector<Entity> flowers(World& world) {
    std::vector<Entity> found;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == kName) found.push_back(e);
    });
    return found;
}

/// Ring petals out for `slot` on any of the account's flowers.
int outOnRing(World& world, int slot) {
    int n = 0;
    for (const Entity body : flowers(world)) {
        for (const Entity spawned : world.get<Loadout>(body).spawned) {
            const PetalInstance* instance = world.tryGet<PetalInstance>(spawned);
            if (instance != nullptr && instance->slot == slot) ++n;
        }
    }
    return n;
}

/// Skips `slot`'s equip reload on every flower, so the next ring pass fields
/// whatever the slot is going to field.
void skipReload(World& world, int slot) {
    for (const Entity body : flowers(world)) {
        world.get<Loadout>(body).slots[static_cast<std::size_t>(slot)].reloadReadyAtMillis = 0.0;
    }
}

/// Puts `body` under a bandage's Undead that will not run out during the
/// test -- what CombatSystem::tryUndead leaves on a flower after a killing
/// blow, without needing a mob to deal one.
void makeUndead(World& world, Entity body) {
    world.add<Undead>(body, Undead{1e12, NULL_ENTITY, 30000.0, 0.25});
}

} // namespace

TEST(the_splitter_switch_is_off_only_on_an_undead_flower) {
    const ContentRegistry& shipped = shippedContent();
    const std::uint16_t splitter = shipped.petalIndex(kSplitterPetalId);
    const std::uint16_t bandage = shipped.petalIndex(kBandageId);
    CHECK(splitter != kInvalidIndex && bandage != kInvalidIndex);
    if (splitter == kInvalidIndex || bandage == kInvalidIndex) return;
    CHECK(petalDisabledWhileUndead(shipped.petal(splitter)));
    CHECK(!petalDisabledWhileUndead(shipped.petal(bandage)));
}

TEST(a_splitter_beside_a_bandage_splits_as_ever) {
    Harness h("splitter-bandage-works", [](const std::string& path) {
        seedMender(path, [](PlayerRecord& record) {
            record.loadout[0] = petal(kBandageId, Rarity::Mythic);
            record.addItem(Rarity::Common, bagKey(kSplitterPetalId), 1);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(play(h, client));
    World& world = h.server.world();
    CHECK_EQ(flowers(world).size(), std::size_t{1});

    client.setLoadoutSlot(1, content().petalIndex(kSplitterPetalId), Rarity::Common);
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 1, kSplitterPetalId); }));
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));
    skipReload(world, 1);
    CHECK(h.stepUntil({&client}, [&] { return outOnRing(world, 1) > 0; }, 30));
    // And the bandage is worn on both halves.
    for (const Entity body : flowers(world)) {
        CHECK(world.get<PlayerModifiers>(body).undeadMillis > 0.0);
    }
}

TEST(an_undead_steered_half_despawns_the_other_and_cannot_split) {
    Harness h("splitter-bandage-undead-active", [](const std::string& path) {
        seedMender(path, [](PlayerRecord& record) {
            record.loadout[0] = petal(kSplitterPetalId, Rarity::Common);
            record.loadout[3] = petal(kBandageId, Rarity::Mythic);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(play(h, client));
    World& world = h.server.world();
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));

    Session* session = GameServerPeer::sessionOf(h.server, kName);
    if (session == nullptr || !session->split()) { CHECK(false); return; }
    const Entity steered = session->entity;
    const Entity parked = session->splitOther;
    makeUndead(world, steered);

    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 1; }));
    CHECK(!world.isAlive(parked));
    CHECK(!session->split());
    CHECK(session->entity == steered);
    CHECK(world.has<Undead>(steered));

    // Switched off for as long as the Undead runs: nothing on the ring, no
    // split, and a click switches nothing.
    session->splitReadyAtMillis = 0.0;
    skipReload(world, 0);
    client.usePetal(0);
    CHECK(!h.stepUntil({&client}, [&] {
        return outOnRing(world, 0) > 0 || flowers(world).size() != 1;
    }, 30));
    // The bandage, and the rest of the bar, are untouched by it.
    CHECK(slotIs(client, 0, kSplitterPetalId));
    CHECK(slotIs(client, 3, kBandageId));
}

TEST(an_undead_parked_half_is_despawned_and_the_steered_one_carries_on) {
    Harness h("splitter-bandage-undead-parked", [](const std::string& path) {
        seedMender(path, [](PlayerRecord& record) {
            record.loadout[0] = petal(kSplitterPetalId, Rarity::Common);
            record.loadout[3] = petal(kBandageId, Rarity::Mythic);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(play(h, client));
    World& world = h.server.world();
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));

    Session* session = GameServerPeer::sessionOf(h.server, kName);
    if (session == nullptr || !session->split()) { CHECK(false); return; }
    const Entity steered = session->entity;
    const Entity parked = session->splitOther;
    makeUndead(world, parked);

    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 1; }));
    CHECK(!world.isAlive(parked));
    CHECK(!session->split());
    CHECK(session->entity == steered);
    CHECK(!world.has<Undead>(steered));
    // Paid as a lost half is: the split waits out the splitter's reload.
    CHECK(session->splitReadyAtMillis > 0.0);
}
