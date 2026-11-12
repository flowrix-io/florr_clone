// A splitter worn beside a bandage (user's rule, 2026-11-11): both stay
// equipped, but the splitter is held back -- it never comes out on the ring
// and never splits the flower, the way a spare copy of a petal that does not
// stack sits on the bar doing nothing. The bandage works as ever.
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

} // namespace

TEST(a_bandage_on_the_active_row_holds_a_splitter_back) {
    const ContentRegistry& shipped = shippedContent();
    const std::uint16_t splitter = shipped.petalIndex(kSplitterPetalId);
    const std::uint16_t bandage = shipped.petalIndex(kBandageId);
    const std::uint16_t basic = shipped.petalIndex("basic");
    CHECK(splitter != kInvalidIndex && bandage != kInvalidIndex && basic != kInvalidIndex);
    if (splitter == kInvalidIndex || bandage == kInvalidIndex || basic == kInvalidIndex) return;

    std::array<EquippedPetal, kLoadoutActiveSlots> row{};
    const auto at = [&](int i) { return row[static_cast<std::size_t>(i)]; };
    row[2] = EquippedPetal{splitter, Rarity::Common, Rarity::Common};
    row[5] = EquippedPetal{basic, Rarity::Common, Rarity::Common};
    CHECK(!slotHeldBack(shipped, 2, at));

    row[7] = EquippedPetal{bandage, Rarity::Mythic, Rarity::Mythic};
    CHECK(slotHeldBack(shipped, 2, at));
    // The bandage is the one that counts, and the rest of the bar is untouched.
    CHECK(!slotHeldBack(shipped, 7, at));
    CHECK(!slotHeldBack(shipped, 5, at));
    CHECK(!slotHeldBack(shipped, 0, at));
}

TEST(a_splitter_beside_a_bandage_stays_equipped_but_never_comes_out) {
    Harness h("splitter-bandage-held", [](const std::string& path) {
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

    // Equipping it is allowed: nothing refuses the edit.
    client.setLoadoutSlot(1, content().petalIndex(kSplitterPetalId), Rarity::Common);
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 1, kSplitterPetalId); }));

    // Past its equip reload it still fields nothing, and the flower stays one.
    skipReload(world, 1);
    CHECK(!h.stepUntil({&client}, [&] {
        return outOnRing(world, 1) > 0 || flowers(world).size() != 1;
    }, 30));
    // The bandage still works.
    const std::vector<Entity> one = flowers(world);
    CHECK(!one.empty() && world.get<PlayerModifiers>(one.front()).undeadMillis > 0.0);

    // Taking the bandage off lets it out: the flower splits at once, and the
    // petal comes out once its reload is served.
    client.setLoadoutSlot(0, kNoPetal, Rarity::Common);
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));
    skipReload(world, 1);
    CHECK(h.stepUntil({&client}, [&] { return outOnRing(world, 1) > 0; }, 30));
}

TEST(putting_a_bandage_on_merges_a_split_flower) {
    Harness h("splitter-bandage-merge", [](const std::string& path) {
        seedMender(path, [](PlayerRecord& record) {
            record.loadout[0] = petal(kSplitterPetalId, Rarity::Common);
            record.addItem(Rarity::Mythic, bagKey(kBandageId), 1);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(play(h, client));
    World& world = h.server.world();
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));

    client.setLoadoutSlot(3, content().petalIndex(kBandageId), Rarity::Mythic);
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 1; }));
    CHECK(slotIs(client, 0, kSplitterPetalId));
    CHECK(slotIs(client, 3, kBandageId));

    // In storage the bandage is not worn, so it holds nothing back.
    client.swapLoadoutSlots(3, 13);
    CHECK(h.stepUntil({&client}, [&] { return flowers(world).size() == 2; }));
}
