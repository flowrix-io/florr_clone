// The loadout keys that act on the whole bar at once: R swaps the two rows,
// and K/L + a number save and load a whole loadout.
//
// End to end on a real server. The accounts are seeded through the Database
// itself, so a preset written by the seed is also a preset that made it
// through the JSON file and back -- which is the path a saved loadout takes
// across a restart.

#include "test.h"

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

constexpr const char* kName = "keeper";
constexpr const char* kPassword = "password7";

StoredItem petal(const char* id, Rarity rarity) {
    StoredItem item;
    item.petalType = id;
    item.rarity = rarity;
    return item;
}

std::string bagKey(const char* id) { return std::string("petal_") + id; }

/// One account, whose record `fill` writes before the server ever opens it.
void seedKeeper(const std::string& path, const std::function<void(PlayerRecord&)>& fill) {
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

bool slotIs(const NetClient& client, int slot, const char* id, Rarity rarity) {
    const auto& loadout = client.profile().loadout;
    if (slot < 0 || static_cast<std::size_t>(slot) >= loadout.size()) return false;
    return loadout[static_cast<std::size_t>(slot)].petalIndex == content().petalIndex(id) &&
           loadout[static_cast<std::size_t>(slot)].rarity == rarity;
}

bool slotEmpty(const NetClient& client, int slot) {
    const auto& loadout = client.profile().loadout;
    return static_cast<std::size_t>(slot) < loadout.size() &&
           loadout[static_cast<std::size_t>(slot)].empty();
}

bool heard(const NetClient& client, const std::string& needle) {
    for (const ChatLine& line : client.chat()) {
        if (line.text.find(needle) != std::string::npos) return true;
    }
    return false;
}

const PlayerRecord* keeperRecord(Harness& h) {
    const Account* account = h.server.database().findUser(kName);
    return account == nullptr ? nullptr : h.server.database().findProgress(account->id);
}

} // namespace

TEST(loadout_preset_names_follow_the_keys_that_load_them) {
    CHECK_EQ(loadoutPresetName(0), std::string("K1"));
    CHECK_EQ(loadoutPresetName(8), std::string("K9"));
    CHECK_EQ(loadoutPresetName(9), std::string("K0"));
    CHECK_EQ(loadoutPresetName(10), std::string("L1"));
    CHECK_EQ(loadoutPresetName(19), std::string("L0"));
    CHECK(loadoutPresetName(20).empty());
    CHECK(loadoutPresetName(-1).empty());
}

TEST(r_swaps_every_slot_of_the_top_row_with_the_one_below_it) {
    Harness h("preset-row-swap", [](const std::string& path) {
        seedKeeper(path, [](PlayerRecord& record) {
            record.loadout[0] = petal("rose", Rarity::Rare);
            record.loadout[3] = petal("basic", Rarity::Common);
            record.loadout[13] = petal("light", Rarity::Epic);
            record.loadout[19] = petal("stinger", Rarity::Common);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.swapLoadoutRows();
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 10, "rose", Rarity::Rare); }));

    CHECK(slotEmpty(client, 0));
    CHECK(slotIs(client, 13, "basic", Rarity::Common));
    CHECK(slotIs(client, 3, "light", Rarity::Epic));
    CHECK(slotIs(client, 9, "stinger", Rarity::Common));
    CHECK(slotEmpty(client, 19));
}

TEST(a_clump_swapped_onto_the_bar_reloads_instead_of_arriving_whole) {
    // Sand is a clump: each grain runs its own reload, and the swap used to
    // hand all four back on the very tick it landed in the top row.
    Harness h("preset-row-swap-reload", [](const std::string& path) {
        seedKeeper(path, [](PlayerRecord& record) {
            record.loadout[0] = petal("rose", Rarity::Common);
            record.loadout[10] = petal("sand", Rarity::Common);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.joinGame(1280, 720, {}, kName);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount&) { body = e; });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    const auto onRing = [&](const char* id) {
        int n = 0;
        for (const Entity spawned : world.get<Loadout>(body).spawned) {
            const PetalInstance* instance = world.tryGet<PetalInstance>(spawned);
            if (instance && instance->slot == 0 && instance->configIndex == content().petalIndex(id)) ++n;
        }
        return n;
    };
    CHECK(h.stepUntil({&client}, [&] { return onRing("rose") == 1; }));

    client.swapLoadoutRows();
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 0, "sand", Rarity::Common); }));
    CHECK_EQ(onRing("rose"), 0);
    CHECK_EQ(onRing("sand"), 0);
    // The bar is told, so the slot sweeps its reload rather than sitting full.
    CHECK(h.stepUntil({&client}, [&] {
        return client.view().self().slotReloadRemainingMillis[0] > 0.0;
    }, 5));
    CHECK_EQ(onRing("sand"), 0);

    CHECK(h.stepUntil({&client}, [&] { return onRing("sand") == 4; }));
}

TEST(a_saved_loadout_loads_back_out_of_the_bag_and_the_bar_alike) {
    Harness h("preset-round-trip", [](const std::string& path) {
        seedKeeper(path, [](PlayerRecord& record) {
            record.loadout[0] = petal("rose", Rarity::Rare);
            record.loadout[1] = petal("basic", Rarity::Common);
            record.loadout[12] = petal("light", Rarity::Epic);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.saveLoadoutPreset(0);
    CHECK(h.stepUntil({&client}, [&] { return heard(client, "Saved loadout K1."); }));
    // The profile carries it back, which is what the K row is drawn from.
    const std::vector<Profile::Slot>& k1 = client.profile().presets[0];
    CHECK_EQ(k1.size(), static_cast<std::size_t>(kLoadoutSlots));
    if (k1.size() == static_cast<std::size_t>(kLoadoutSlots)) {
        CHECK_EQ(k1[0].petalIndex, content().petalIndex("rose"));
        CHECK(k1[0].rarity == Rarity::Rare);
        CHECK_EQ(k1[12].petalIndex, content().petalIndex("light"));
        CHECK(k1[5].empty());
    }
    CHECK(client.profile().presets[1].empty());

    // Scramble it: the rose moves along the bar, the basic goes back into the
    // bag, and the light comes up out of the storage row.
    client.swapLoadoutSlots(0, 5);
    client.setLoadoutSlot(1, kNoPetal, Rarity::Common);
    client.swapLoadoutSlots(12, 2);
    CHECK(h.stepUntil({&client}, [&] {
        return slotIs(client, 5, "rose", Rarity::Rare) && slotEmpty(client, 1) &&
               slotIs(client, 2, "light", Rarity::Epic);
    }));
    CHECK_EQ(client.profile().stackCount(content().petalIndex("basic"), Rarity::Common), 1u);

    client.loadLoadoutPreset(0);
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 0, "rose", Rarity::Rare); }));
    CHECK(slotIs(client, 1, "basic", Rarity::Common));
    CHECK(slotIs(client, 12, "light", Rarity::Epic));
    CHECK(slotEmpty(client, 5));
    CHECK(slotEmpty(client, 2));
    // Every petal is accounted for: the basic came out of the bag, and
    // nothing the load moved was left behind in it.
    CHECK_EQ(client.profile().stackCount(content().petalIndex("basic"), Rarity::Common), 0u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("rose"), Rarity::Rare), 0u);
    CHECK(heard(client, "Loaded loadout K1."));

    const PlayerRecord* record = keeperRecord(h);
    CHECK(record != nullptr);
    if (record != nullptr) CHECK(record->loadoutPresets.count("K1") == 1);
}

TEST(a_petal_the_account_no_longer_has_comes_back_a_rarity_down) {
    // L3, saved when the account was richer than it is now. The bag holds one
    // epic and one rare rose; the bar wears a common basic.
    Harness h("preset-step-down", [](const std::string& path) {
        seedKeeper(path, [](PlayerRecord& record) {
            std::vector<std::optional<StoredItem>> preset(kLoadoutSlots);
            preset[0] = petal("rose", Rarity::Legendary);   // gone: steps down
            preset[1] = petal("rose", Rarity::Epic);        // still owned exactly
            preset[2] = petal("stinger", Rarity::Common);   // never owned at all
            preset[3] = petal("basic", Rarity::Mythic);     // only the bar's common
            record.loadoutPresets["L3"] = preset;
            record.addItem(Rarity::Epic, bagKey("rose"), 1);
            record.addItem(Rarity::Rare, bagKey("rose"), 1);
            record.loadout[7] = petal("basic", Rarity::Common);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    client.loadLoadoutPreset(kLoadoutPresetsPerBank + 2);   // L3
    CHECK(h.stepUntil({&client}, [&] { return slotIs(client, 1, "rose", Rarity::Epic); }));
    // The exact epic went to the slot saved with an epic, even though the
    // legendary's slot comes first on the bar and had to step down past it.
    CHECK(slotIs(client, 0, "rose", Rarity::Rare));
    CHECK(slotEmpty(client, 2));
    // A petal equipped elsewhere on the bar is part of what a slot draws from.
    CHECK(slotIs(client, 3, "basic", Rarity::Common));
    CHECK(slotEmpty(client, 7));
    CHECK_EQ(client.profile().stackCount(content().petalIndex("rose"), Rarity::Epic), 0u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("rose"), Rarity::Rare), 0u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("basic"), Rarity::Common), 0u);
    CHECK(h.stepUntil({&client}, [&] {
        return heard(client, "Loaded loadout L3 (2 petals at a lower rarity, 1 petal not found).");
    }));
}

TEST(loading_a_preset_that_was_never_saved_empties_the_loadout) {
    Harness h("preset-empty", [](const std::string& path) {
        seedKeeper(path, [](PlayerRecord& record) {
            record.loadout[0] = petal("rose", Rarity::Rare);
            record.loadout[14] = petal("basic", Rarity::Common);
        });
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(login(h, client));
    client.loadLoadoutPreset(kLoadoutPresetsPerBank + 9);   // L0, never saved
    CHECK(h.stepUntil({&client}, [&] { return slotEmpty(client, 0); }));
    for (int i = 0; i < kLoadoutSlots; ++i) CHECK(slotEmpty(client, i));
    // Both petals went back into the bag rather than vanishing.
    CHECK_EQ(client.profile().stackCount(content().petalIndex("rose"), Rarity::Rare), 1u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("basic"), Rarity::Common), 1u);
    CHECK(h.stepUntil({&client}, [&] { return heard(client, "Loaded loadout L0."); }));
}
