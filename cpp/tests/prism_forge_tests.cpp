#include "test.h"

#include "server_harness.h"
#include "server/systems/npcs.h"
#include "shared/game/prism_forge.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

struct AssemblyMap {
    std::string dir;
    explicit AssemblyMap(const char* name, const char* mapId = "computer") {
        const double cell = kTileSize;
        const std::string map = fixtureMap(24, 24,
            fixtureDoor("entry", "Entry", cell * 2, cell * 2, cell, cell, true, 0.0),
            {}, {}, {}, {}, {}, fixtureNpc(cell * 12, cell * 12, "assembler", "super"));
        dir = stageDataDir(name, {{mapId, map}});
    }
    ~AssemblyMap() { removeDataDir(dir); }
};

std::uint8_t recipeFor(const char* output, Rarity rarity = Rarity::Super,
                       const char* mapId = "computer") {
    const auto petal = content().petalIndex(output);
    const auto& recipes = content().mob(content().mobIndex("assembler")).npc.recipes;
    for (std::size_t i = 0; i < recipes.size(); ++i) {
        if (recipes[i].makes(petal) > 0 && recipes[i].availableAt(rarity, mapId)) {
            return static_cast<std::uint8_t>(i);
        }
    }
    CHECK(false);
    return 0;
}

Entity station(Harness& h) {
    Entity found = NULL_ENTITY;
    Query<NpcTag, Npc> query{h.server.world()};
    query.each([&](Entity entity, NpcTag&, Npc& npc) {
        if (npc.service == NpcService::Assembler) found = entity;
    });
    return found;
}

bool enter(Harness& h, NetClient& client) {
    if (!loginAs(h, client, "smith", "password7")) return false;
    client.joinGame(1280, 720, {}, "Smith");
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; });
}

void standAt(Harness& h, NetClient& client, Rarity rarity) {
    World& world = h.server.world();
    const Entity npc = station(h);
    const Entity player = onlyPlayer(world);
    CHECK(npc != NULL_ENTITY && player != NULL_ENTITY);
    if (npc == NULL_ENTITY || player == NULL_ENTITY) return;
    world.get<Npc>(npc).rarity = rarity;
    const double radius = NpcSystem::npcRadius(content(), world.get<Npc>(npc).configIndex, rarity);
    world.get<Body>(npc).radius = radius;
    world.get<Transform>(player).position = world.get<Transform>(npc).position + Vec2{radius + 60, 0};
    world.get<Motion>(player).velocity = {};
    h.step(1, {&client});
}

bool awaitAssembly(Harness& h, NetClient& client, AssembleOutcome& outcome) {
    if (!h.stepUntil({&client}, [&] { return client.assembleOutcome().pending; }, 200)) return false;
    outcome = client.assembleOutcome();
    client.assembleOutcome().pending = false;
    return true;
}

bool assemble(Harness& h, NetClient& client, Rarity rarity, std::uint8_t recipe,
              int count, AssembleOutcome& outcome) {
    client.requestAssemble(rarity, recipe, count);
    return awaitAssembly(h, client, outcome);
}

bool dispatch(Harness& h, NetClient& client, const ByteWriter& message) {
    net::Connection* connection = h.serverEndOf(client);
    if (connection == nullptr) return false;
    ByteReader reader(message.buffer());
    h.server.onMessage(*connection, reader);
    return true;
}

ByteWriter assemblyMessage(std::uint8_t rarity, std::uint8_t recipe, std::uint16_t count) {
    ByteWriter message;
    message.u8(static_cast<std::uint8_t>(net::ClientMessage::Assemble));
    message.u8(rarity);
    message.u8(recipe);
    message.u16(count);
    return message;
}

void seedWornGlass(const std::string& path, Rarity rarity) {
    Database db;
    std::string error;
    CHECK(db.load(path, error));
    const Account* account = db.findUser("smith");
    CHECK(account != nullptr);
    if (account == nullptr) return;
    PlayerRecord& record = db.progress(account->id);
    if (record.loadout.empty()) record.loadout.resize(1);
    StoredItem glass;
    glass.petalType = kPrismForgeInputId;
    glass.rarity = rarity;
    record.loadout[0] = glass;
    db.markDirty();
    CHECK(db.save());
}

} // namespace

TEST(prism_assembler_recipe_is_an_extra_only_at_computer_super_eternal_and_apex_stations) {
    const ContentRegistry& registry = shippedContent();
    const auto glass = registry.petalIndex(kPrismForgeInputId);
    const auto prism = registry.petalIndex(kPrismForgeOutputId);
    const auto& recipes = registry.mob(registry.mobIndex("assembler")).npc.recipes;
    int extras = 0;
    std::vector<int> offered(kRarityCount, 0);
    for (const AssemblyRecipe& recipe : recipes) {
        if (recipe.makes(prism) == 0) {
            CHECK(!recipe.availableAtEveryStation);
            for (int tier = 0; tier < kLadderRarityCount; ++tier) {
                CHECK(recipe.availableAt(static_cast<Rarity>(tier), "garden"));
            }
            continue;
        }
        ++extras;
        CHECK(recipe.availableAtEveryStation);
        CHECK_EQ(recipe.minRarity, recipe.maxRarity);
        CHECK(prismForgeable(recipe.minRarity));
        CHECK_EQ(recipe.takes(glass), std::int64_t(recipe.minRarity == Rarity::Unique ? 50 : 30));
        CHECK_EQ(recipe.makes(prism), std::int64_t(1));
        CHECK_EQ(recipe.inputs.size(), std::size_t(1));
        CHECK_EQ(recipe.outputs.size(), std::size_t(1));
        for (int tier = 0; tier < kRarityCount; ++tier) {
            const Rarity rarity = static_cast<Rarity>(tier);
            const bool expected = prismForgeable(rarity) && rarity == recipe.minRarity;
            CHECK_EQ(recipe.availableAt(rarity, "computer"), expected);
            CHECK_EQ(recipe.availableAt(rarity, "prestige_computer"), expected);
            if (recipe.availableAt(rarity, "computer")) ++offered[tier];
            CHECK(!recipe.availableAt(rarity, "garden"));
            CHECK(!recipe.availableAt(rarity, ""));
        }
    }
    CHECK_EQ(extras, 3);
    for (int tier = 0; tier < kRarityCount; ++tier) {
        CHECK_EQ(offered[tier], prismForgeable(static_cast<Rarity>(tier)) ? 1 : 0);
    }
}

TEST(prism_assembler_guarantees_same_tier_batches_beside_the_stations_original_recipe) {
    for (const char* mapId : {"computer", "prestige_computer"}) {
        AssemblyMap map("prism-assembly-success", mapId);
        Harness h("prism-assembly-success", [](const std::string& path) {
            seedUser(path, "smith", "password7");
            for (const Rarity rarity : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
                seedStack(path, "smith", "petal_glass", rarity, rarity == Rarity::Unique ? 101 : 61);
                seedStack(path, "smith", "petal_prism_mirror", rarity, 2);
            }
        }, map.dir, 0);
        CHECK(h.ready);
        if (!h.ready) continue;
        NetClient client;
        CHECK(enter(h, client));
        const auto glass = content().petalIndex(kPrismForgeInputId);
        const auto prism = content().petalIndex(kPrismForgeOutputId);
        const Entity npc = station(h);
        CHECK(npc != NULL_ENTITY);
        if (npc == NULL_ENTITY) continue;
        auto& database = const_cast<Database&>(h.server.database());
        CHECK(database.save());
        for (const Rarity rarity : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
            const auto recipe = recipeFor(kPrismForgeOutputId, rarity, mapId);
            CHECK(h.server.world().get<Npc>(npc).recipe != recipe);
            standAt(h, client, rarity);
            AssembleOutcome outcome;
            CHECK(assemble(h, client, rarity, recipe, 2, outcome));
            CHECK(outcome.success);
            CHECK_EQ(outcome.rarity, rarity);
            CHECK_EQ(outcome.recipe, recipe);
            CHECK_EQ(outcome.made, 2);
            CHECK(awaitProfile(h, client, [&](const Profile& profile) {
                return profile.stackCount(glass, rarity) == 1u && profile.stackCount(prism, rarity) == 4u;
            }));
        }
        CHECK(database.maybeSave(1000000000));
        Database reopened;
        std::string error;
        CHECK(reopened.load(h.dbPath, error));
        const Account* account = reopened.findUser("smith");
        CHECK(account != nullptr);
        if (account == nullptr) continue;
        const PlayerRecord* record = reopened.findProgress(account->id);
        CHECK(record != nullptr);
        if (record == nullptr) continue;
        for (const Rarity rarity : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
            CHECK_EQ(record->itemCount(rarity, "petal_glass"), 1);
            CHECK_EQ(record->itemCount(rarity, "petal_prism_mirror"), 4);
        }
    }
}

TEST(prism_assembler_does_not_spend_equipped_glass_or_overflow_a_full_output_stack) {
    AssemblyMap map("prism-assembly-stock");
    Harness h("prism-assembly-stock", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_glass", Rarity::Super, 29);
        seedStack(path, "smith", "petal_glass", Rarity::Unique, 50);
        seedStack(path, "smith", "petal_glass", Rarity::Apex, 60);
        seedStack(path, "smith", "petal_prism_mirror", Rarity::Unique, kMaxStackCount);
        seedStack(path, "smith", "petal_prism_mirror", Rarity::Apex, kMaxStackCount - 1);
        seedWornGlass(path, Rarity::Super);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    const auto glass = content().petalIndex(kPrismForgeInputId);
    const auto prism = content().petalIndex(kPrismForgeOutputId);
    AssembleOutcome outcome;
    for (const Rarity rarity : {Rarity::Super, Rarity::Unique, Rarity::Apex}) {
        standAt(h, client, rarity);
        CHECK(assemble(h, client, rarity, recipeFor(kPrismForgeOutputId, rarity),
                       rarity == Rarity::Apex ? 2 : 1, outcome));
        CHECK(!outcome.success);
        CHECK_EQ(outcome.made, 0);
    }
    CHECK_EQ(client.profile().stackCount(glass, Rarity::Super), 29u);
    CHECK_EQ(client.profile().stackCount(glass, Rarity::Unique), 50u);
    CHECK_EQ(client.profile().stackCount(glass, Rarity::Apex), 60u);
    CHECK_EQ(client.profile().stackCount(prism, Rarity::Super), 0u);
    CHECK_EQ(client.profile().stackCount(prism, Rarity::Unique),
             static_cast<unsigned>(kMaxStackCount));
    const auto& db = h.server.database();
    const PlayerRecord* record = db.findProgress(db.findUser("smith")->id);
    CHECK(record != nullptr && record->loadout[0].has_value());
    if (record && record->loadout[0]) CHECK_EQ(record->loadout[0]->petalType, std::string("glass"));
    CHECK(assemble(h, client, Rarity::Apex, recipeFor(kPrismForgeOutputId, Rarity::Apex), 1, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& profile) {
        return profile.stackCount(glass, Rarity::Apex) == 30u &&
               profile.stackCount(prism, Rarity::Apex) == static_cast<unsigned>(kMaxStackCount);
    }));
}

TEST(prism_assembler_eternal_requires_fifty_unequipped_glass_per_prism) {
    for (const int stock : {30, 49, 50, 100}) {
        AssemblyMap map("prism-assembly-eternal-cost");
        Harness h("prism-assembly-eternal-cost", [stock](const std::string& path) {
            seedUser(path, "smith", "password7");
            seedStack(path, "smith", "petal_glass", Rarity::Unique, stock);
            // Forty-nine bagged plus one worn is still short of the cost.
            if (stock == 49) seedWornGlass(path, Rarity::Unique);
        }, map.dir, 0);
        CHECK(h.ready);
        if (!h.ready) continue;
        NetClient client;
        CHECK(enter(h, client));
        standAt(h, client, Rarity::Unique);
        const auto glass = content().petalIndex(kPrismForgeInputId);
        const auto prism = content().petalIndex(kPrismForgeOutputId);
        const int runs = stock == 100 ? 2 : 1;
        const int made = stock >= 50 ? runs : 0;
        AssembleOutcome outcome;
        CHECK(assemble(h, client, Rarity::Unique,
                       recipeFor(kPrismForgeOutputId, Rarity::Unique), runs, outcome));
        CHECK_EQ(outcome.success, made > 0);
        CHECK_EQ(outcome.made, made);
        CHECK(awaitProfile(h, client, [&](const Profile& profile) {
            return profile.stackCount(glass, Rarity::Unique) ==
                       static_cast<unsigned>(stock - made * 50) &&
                   profile.stackCount(prism, Rarity::Unique) == static_cast<unsigned>(made);
        }));
        const auto& db = h.server.database();
        const PlayerRecord* record = db.findProgress(db.findUser("smith")->id);
        CHECK(record != nullptr);
        if (record == nullptr) continue;
        CHECK_EQ(record->itemCount(Rarity::Unique, "petal_glass"), stock - made * 50);
        CHECK_EQ(record->itemCount(Rarity::Unique, "petal_prism_mirror"), made);
        if (stock == 49) {
            CHECK(!record->loadout.empty() && record->loadout[0].has_value());
            if (!record->loadout.empty() && record->loadout[0]) {
                CHECK_EQ(record->loadout[0]->petalType, std::string("glass"));
                CHECK_EQ(record->loadout[0]->rarity, Rarity::Unique);
            }
        }
    }
}

TEST(prism_assembler_eternal_rejects_the_cheaper_super_and_apex_recipe_indices) {
    AssemblyMap map("prism-assembly-eternal-bypass");
    Harness h("prism-assembly-eternal-bypass", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_glass", Rarity::Unique, 100);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    standAt(h, client, Rarity::Unique);
    const auto glass = content().petalIndex(kPrismForgeInputId);
    const auto prism = content().petalIndex(kPrismForgeOutputId);
    AssembleOutcome outcome;
    for (const Rarity cheapTier : {Rarity::Super, Rarity::Apex}) {
        const auto cheaper = recipeFor(kPrismForgeOutputId, cheapTier);
        CHECK(assemble(h, client, Rarity::Unique, cheaper, 2, outcome));
        CHECK(!outcome.success);
        CHECK_EQ(outcome.made, 0);
        CHECK_EQ(client.profile().stackCount(glass, Rarity::Unique), 100u);
        CHECK_EQ(client.profile().stackCount(prism, Rarity::Unique), 0u);
    }
    CHECK(assemble(h, client, Rarity::Unique,
                   recipeFor(kPrismForgeOutputId, Rarity::Unique), 2, outcome));
    CHECK(outcome.success);
    CHECK_EQ(outcome.made, 2);
    CHECK(awaitProfile(h, client, [&](const Profile& profile) {
        return profile.stackCount(glass, Rarity::Unique) == 0u &&
               profile.stackCount(prism, Rarity::Unique) == 2u;
    }));
}

TEST(prism_assembler_rejects_other_tiers_wrong_station_tier_and_malformed_requests_without_loss) {
    AssemblyMap map("prism-assembly-tier");
    Harness h("prism-assembly-tier", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        for (int tier = 0; tier < kRarityCount; ++tier) {
            seedStack(path, "smith", "petal_glass", static_cast<Rarity>(tier), 30);
        }
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    const auto recipe = recipeFor(kPrismForgeOutputId);
    AssembleOutcome outcome;
    for (const int tier : {0, 1, 2, 3, 4, 5, 6, 10, 11}) {
        const Rarity rarity = static_cast<Rarity>(tier);
        standAt(h, client, rarity);
        CHECK(assemble(h, client, rarity, recipe, 1, outcome));
        CHECK(!outcome.success);
    }
    standAt(h, client, Rarity::Super);
    CHECK(assemble(h, client, Rarity::Apex, recipe, 1, outcome));
    CHECK(!outcome.success);
    for (const std::uint8_t tier : {12, 255}) {
        CHECK(dispatch(h, client, assemblyMessage(tier, recipe, 1)));
        CHECK(awaitAssembly(h, client, outcome));
        CHECK(!outcome.success);
    }
    ByteWriter missing;
    missing.u8(static_cast<std::uint8_t>(net::ClientMessage::Assemble));
    missing.u8(static_cast<std::uint8_t>(Rarity::Super));
    CHECK(dispatch(h, client, missing));
    ByteWriter extra = assemblyMessage(static_cast<std::uint8_t>(Rarity::Super), recipe, 1);
    extra.u8(0);
    CHECK(dispatch(h, client, extra));
    h.step(5, {&client});
    CHECK(!client.assembleOutcome().pending);
    const auto glass = content().petalIndex(kPrismForgeInputId);
    const auto prism = content().petalIndex(kPrismForgeOutputId);
    for (int tier = 0; tier < kRarityCount; ++tier) {
        const Rarity rarity = static_cast<Rarity>(tier);
        CHECK_EQ(client.profile().stackCount(glass, rarity), 30u);
        CHECK_EQ(client.profile().stackCount(prism, rarity), 0u);
    }
}

TEST(prism_assembler_requires_authentication_a_live_nearby_body_and_regular_inventory) {
    AssemblyMap map("prism-assembly-access");
    Harness h("prism-assembly-access", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_glass", Rarity::Super, 30);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(connectClient(h, client));
    const auto recipe = recipeFor(kPrismForgeOutputId);
    CHECK(dispatch(h, client, assemblyMessage(7, recipe, 1)));
    h.step(5, {&client});
    CHECK(!client.assembleOutcome().pending);
    client.requestLogin("smith", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    AssembleOutcome outcome;
    CHECK(assemble(h, client, Rarity::Super, recipe, 1, outcome));
    CHECK(!outcome.success); // signed in, but still on the title screen
    const auto glass = content().petalIndex(kPrismForgeInputId);
    const auto prism = content().petalIndex(kPrismForgeOutputId);
    CHECK_EQ(client.profile().stackCount(glass, Rarity::Super), 30u);
    CHECK_EQ(client.profile().stackCount(prism, Rarity::Super), 0u);
    client.joinGame(1280, 720, {}, "Smith");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK(assemble(h, client, Rarity::Super, recipe, 1, outcome));
    CHECK(!outcome.success); // door is far from the station
    standAt(h, client, Rarity::Super);
    CHECK_EQ(client.profile().stackCount(glass, Rarity::Super), 30u);
    CHECK_EQ(client.profile().stackCount(prism, Rarity::Super), 0u);
    Session* session = GameServerPeer::sessionOf(h.server, "smith");
    CHECK(session != nullptr);
    if (!session) return;
    session->eventKit = std::make_unique<PlayerRecord>();
    session->eventKit->addItem(Rarity::Super, "petal_glass", 30);
    client.requestAssemble(Rarity::Super, recipe, 1);
    h.step(5, {&client});
    CHECK(!client.assembleOutcome().pending);
    CHECK_EQ(session->eventKit->itemCount(Rarity::Super, "petal_glass"), 30);
    session->eventKit.reset();
    CHECK(assemble(h, client, Rarity::Super, recipe, 1, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& profile) {
        return profile.stackCount(glass, Rarity::Super) == 0u && profile.stackCount(prism, Rarity::Super) == 1u;
    }));
}

TEST(prism_assembler_cannot_be_used_at_an_assembler_outside_the_computer) {
    AssemblyMap map("prism-assembly-map", "garden");
    Harness h("prism-assembly-map", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_glass", Rarity::Super, 30);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    standAt(h, client, Rarity::Super);
    AssembleOutcome outcome;
    CHECK(assemble(h, client, Rarity::Super, recipeFor(kPrismForgeOutputId), 1, outcome));
    CHECK(!outcome.success);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("glass"), Rarity::Super), 30u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("prism_mirror"), Rarity::Super), 0u);
}

TEST(prism_assembler_keeps_the_original_recipe_and_ordinary_glass_upgrading) {
    AssemblyMap map("prism-assembly-original");
    Harness h("prism-assembly-original", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_mimic", Rarity::Super, 1);
        seedStack(path, "smith", "petal_ram", Rarity::Super, 1);
        seedStack(path, "smith", "petal_glass", Rarity::Common, 5);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    standAt(h, client, Rarity::Super);
    const Entity npc = station(h);
    CHECK(npc != NULL_ENTITY);
    if (npc == NULL_ENTITY) return;
    const auto saw = recipeFor("sawblade");
    h.server.world().get<Npc>(npc).recipe = saw;
    AssembleOutcome outcome;
    CHECK(assemble(h, client, Rarity::Super, saw, 1, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& profile) {
        return profile.stackCount(content().petalIndex("sawblade"), Rarity::Super) == 1u;
    }));
    const auto glass = content().petalIndex("glass");
    client.requestCraft(glass, Rarity::Common, 5);
    CHECK(h.stepUntil({&client}, [&] { return client.craftOutcome().pending; }));
    CHECK_EQ(client.craftOutcome().petalIndex, glass);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("prism_mirror"), Rarity::Common), 0u);
}

TEST(prism_assembler_capacity_counts_duplicate_outputs_and_subtracts_consumed_outputs) {
    AssemblyMap map("prism-assembly-capacity");
    Json mobs;
    std::string error;
    CHECK(Json::parseFile(map.dir + "/mobs.json", mobs, error));
    auto& recipes = mobs["assembler"]["npc"]["recipes"];
    for (std::size_t i = 0; i < recipes.size(); ++i) {
        if (recipes[i]["to"].asString() != kPrismForgeOutputId) continue;
        Json outputs = Json::array();
        outputs.push(kPrismForgeOutputId);
        outputs.push(kPrismForgeOutputId);
        recipes[i]["to"] = outputs;
    }
    CHECK(writeText(map.dir + "/mobs.json", mobs.dump()));
    Harness h("prism-assembly-capacity", [](const std::string& path) {
        seedUser(path, "smith", "password7");
        seedStack(path, "smith", "petal_glass", Rarity::Super, 30);
        seedStack(path, "smith", "petal_prism_mirror", Rarity::Super, kMaxStackCount - 1);
        seedStack(path, "smith", "petal_battery", Rarity::Super, kMaxStackCount);
    }, map.dir, 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient client;
    CHECK(enter(h, client));
    standAt(h, client, Rarity::Super);
    AssembleOutcome outcome;
    CHECK(assemble(h, client, Rarity::Super, recipeFor(kPrismForgeOutputId), 1, outcome));
    CHECK(!outcome.success); // two output rows cannot each spend the last free slot
    CHECK_EQ(client.profile().stackCount(content().petalIndex("glass"), Rarity::Super), 30u);
    CHECK_EQ(client.profile().stackCount(content().petalIndex("prism_mirror"), Rarity::Super),
             static_cast<unsigned>(kMaxStackCount - 1));

    // The existing battery recipe consumes three and returns one. A full
    // battery stack has room because its inputs are consumed first.
    const auto batteryRecipe = recipeFor("lightning");
    h.server.world().get<Npc>(station(h)).recipe = batteryRecipe;
    CHECK(assemble(h, client, Rarity::Super, batteryRecipe, 1, outcome));
    CHECK(outcome.success);
    CHECK(awaitProfile(h, client, [&](const Profile& profile) {
        return profile.stackCount(content().petalIndex("battery"), Rarity::Super) ==
                   static_cast<unsigned>(kMaxStackCount - 2) &&
               profile.stackCount(content().petalIndex("lightning"), Rarity::Super) == 1u;
    }));
}

TEST(prism_assembler_recipe_restrictions_are_parsed_and_invalid_restrictions_fail_closed) {
    ContentRegistry registry;
    std::string error;
    const std::string dir = tempDir("prism-assembly-schema-" + std::to_string(::getpid()));
    const std::string mobs = R"JSON({"maker":{"npc":{"service":"assembler","recipes":[
      {"from":["glass"],"to":"prism","availableAtEveryStation":true,
       "minRarity":"super","maxRarity":"apex","maps":["computer"]},
      {"from":["glass"],"to":"prism"},
      {"from":["glass"],"to":"prism","minRarity":"typo"},
      {"from":["glass"],"to":"prism","minRarity":"apex","maxRarity":"super"},
      {"from":["glass"],"to":"prism","maxRarity":"universal"},
      {"from":["glass"],"to":"prism","maps":true},
      {"from":["glass"],"to":"prism","maps":[]},
      {"from":["glass"],"to":"prism","maps":[""]},
      {"from":["glass"],"to":"prism","availableAtEveryStation":"true"}
    ]}}})JSON";
    CHECK(test::loadFixtureContent(registry, dir, mobs,
        R"JSON({"glass":{"damage":1},"prism":{"damage":1}})JSON", error));
    const auto& recipes = registry.mob(registry.mobIndex("maker")).npc.recipes;
    CHECK_EQ(recipes.size(), std::size_t(2));
    if (recipes.size() == 2) {
        CHECK(recipes[0].availableAtEveryStation);
        CHECK(recipes[0].availableAt(Rarity::Super, "computer"));
        CHECK(!recipes[0].availableAt(Rarity::Ultra, "computer"));
        CHECK(!recipes[0].availableAt(Rarity::Apex, "garden"));
        CHECK(!recipes[1].availableAtEveryStation);
        CHECK(recipes[1].availableAt(Rarity::Common, "garden"));
    }
    CHECK(registry.warnings().size() >= 7u);
    removeDataDir(dir);
}

TEST(prism_assembler_petal_is_absent_from_authored_and_random_mob_drops) {
    const ContentRegistry& registry = shippedContent();
    const auto prism = registry.petalIndex(kPrismForgeOutputId);
    CHECK(prism != kInvalidIndex);
    DropTables tables;
    std::string error;
    CHECK(tables.load(registry, dataFile("mob_drops.json"), error));
    for (std::uint16_t mob = 0; mob < registry.mobCount(); ++mob) {
        for (const auto& entry : tables.forMob(mob)) {
            CHECK(entry.kind != DropTables::Kind::Petal || entry.petalIndex != prism);
        }
    }
    CHECK(std::find(tables.droppablePetals().begin(), tables.droppablePetals().end(), prism) ==
          tables.droppablePetals().end());
}
