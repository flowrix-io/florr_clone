#include "test.h"

#include "client/net_client.h"
#include "server/cluster/host.h"
#include "server/cluster/link.h"
#include "server/cluster/membership.h"
#include "server/cluster/placement.h"
#include "server/cluster/row_merge.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "shared/game/components.h"

#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <memory>
#include <set>
#include <string>
#include <vector>

using namespace flix;

// Sharding: one gateway, servers that each simulate some of the biomes, and
// players who are meant to notice nothing. cpp/docs/ARCHITECTURE.md, "Sharding".

namespace {

using flix::testsupport::GameServerPeer;
using flix::testsupport::HarnessFiles;
using flix::testsupport::seedStack;
using flix::testsupport::seedUser;

constexpr const char* kPassword = "password7";

/// A gateway and its servers, all real, all in this process, joined by the
/// sockets they would be joined by anywhere else.
struct Cluster {
    HarnessFiles files;
    GameServer gateway;
    std::vector<std::unique_ptr<GameServer>> servers;
    /// Each server's own port, in `servers`' order.
    std::vector<std::uint16_t> serverPorts;
    std::uint16_t port = 0;
    std::uint16_t linkPort = 0;
    double clock = 0;
    bool ready = false;

    Cluster(const char* name, int count, const std::function<void(const std::string&)>& seed = {})
        : files(name) {
        if (seed) seed(files.dbPath);
        ServerConfig config;
        config.dataDir = flix::testsupport::dataDir();
        config.databasePath = files.dbPath;
        config.worldSeed = 12345;
        config.botCount = 0;
        config.passwordCost = crypto::kBcryptMinCost;
        config.hourlyRifts = false;
        config.role = ServerConfig::Role::Gateway;
        config.clusterSecret = "a secret between servers";
        config.expectedShards = count;
        std::string error;
        bool up = false;
        for (std::uint16_t candidate = 47200; candidate < 47240 && !up; ++candidate) {
            config.port = candidate;
            up = gateway.start(config, error);
        }
        if (!up) {
            std::printf("  cluster could not start a gateway: %s\n", error.c_str());
            return;
        }
        port = config.port;
        // Servers dial the game's own port.
        linkPort = config.port;
        for (int i = 0; i < count; ++i) addServer(std::string(1, static_cast<char>('A' + i)));
        ready = stepUntil({}, [&] {
            const auto linked = [](const auto& s) { return s->linked(); };
            if (!std::all_of(servers.begin(), servers.end(), linked)) return false;
            return !gateway.serverOfBiome("garden").empty() && !gateway.serverOfBiome("desert").empty();
        });
    }

    /// `publicHost`: the proxied hostname its players are sent to (on its own
    /// port here, where there is no proxy to answer on the gateway's).
    GameServer& addServer(const std::string& name, const std::string& secret = "a secret between servers",
                          const std::string& copyPath = "", const std::string& publicHost = "") {
        ServerConfig config;
        config.copyPath = copyPath;
        config.publicHost = publicHost;
        config.dataDir = flix::testsupport::dataDir();
        config.worldSeed = 999;
        config.botCount = 0;
        config.hourlyRifts = false;
        config.role = ServerConfig::Role::Shard;
        config.clusterSecret = secret;
        config.gatewayPort = linkPort;
        config.shardName = name;
        // Its own port, which its players are sent to: the gateway relays
        // none of their traffic.
        servers.push_back(std::make_unique<GameServer>());
        std::string error;
        bool up = false;
        for (std::uint16_t candidate = static_cast<std::uint16_t>(port + 200); !up && candidate < port + 260;
             ++candidate) {
            config.port = candidate;
            if (!publicHost.empty()) config.publicPort = candidate;
            up = servers.back()->start(config, error);
            if (!up) servers.back() = std::make_unique<GameServer>();
        }
        CHECK(up);
        serverPorts.push_back(config.port);
        return *servers.back();
    }

    void step(int ticks, std::vector<NetClient*> clients) {
        for (int i = 0; i < ticks; ++i) {
            for (NetClient* c : clients) c->poll(0);
            gateway.serviceNetwork(1);
            for (auto& s : servers) s->serviceNetwork(1);
            clock += net::kTickMillis;
            for (auto& s : servers) s->tick(clock);
            gateway.serviceNetwork(1);
            gateway.tick(clock);
            for (NetClient* c : clients) c->poll(1);
        }
    }

    template <class F>
    bool stepUntil(std::vector<NetClient*> clients, F done, int maxTicks = 600) {
        for (int i = 0; i < maxTicks; ++i) {
            step(1, clients);
            if (done()) return true;
        }
        return false;
    }

    /// The server simulating `biome`.
    GameServer* serverFor(const std::string& biome) {
        const std::string name = gateway.serverOfBiome(biome);
        for (std::size_t i = 0; i < servers.size(); ++i) {
            if (name == std::string(1, static_cast<char>('A' + i))) return servers[i].get();
        }
        return nullptr;
    }

    bool signIn(NetClient& client, const char* name) {
        client.contentHash = content().contentHash();
        if (!client.connect("127.0.0.1", port)) return false;
        if (!stepUntil({&client}, [&] { return client.status() == NetClient::Status::Ready; })) return false;
        client.requestLogin(name, kPassword);
        return stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
    }

    /// A client whose socket went with its server: back at the gateway, it
    /// signs in again, as the app does on a reconnection.
    bool signInAgain(NetClient& client, const char* name, std::vector<NetClient*> all = {}) {
        all.push_back(&client);
        if (!stepUntil(all, [&] { return client.reconnected; }, 3000)) return false;
        client.reconnected = false;
        client.requestLogin(name, kPassword);
        return stepUntil(all, [&] { return client.status() == NetClient::Status::LoggedIn; });
    }

    bool join(NetClient& client, std::vector<NetClient*> all, const std::string& door = "") {
        all.push_back(&client);
        client.joinGame(1920, 1080, door, "flower");
        return stepUntil(all, [&] { return client.status() == NetClient::Status::Playing; });
    }

    Realm realm(const char* map) {
        bool found = false;
        return gateway.worldMaps().realmOfId(map, found);
    }
};

/// Two servers that between them hold the garden and the desert apart.
bool apart(Cluster& c) {
    if (!c.ready) return false;
    if (c.gateway.serverOfBiome("garden") != c.gateway.serverOfBiome("desert")) return true;
    const std::string other = c.gateway.serverOfBiome("garden") == "A" ? "B" : "A";
    std::string why;
    if (!c.gateway.moveBiome("desert", other, why)) return false;
    return c.stepUntil({}, [&] { return c.gateway.serverOfBiome("desert") == other; });
}

int stacked(const NetClient& client, const char* petal, Rarity rarity) {
    const std::uint16_t index = content().petalIndex(petal);
    int total = 0;
    for (const auto& stack : client.profile().inventory) {
        if (stack.petalIndex == index && stack.rarity == rarity) total += static_cast<int>(stack.count);
    }
    return total;
}

int owned(Cluster& c, const char* user, const char* key, Rarity rarity) {
    const Account* account = c.gateway.database().findUser(user);
    const PlayerRecord* record = c.gateway.database().findProgress(account->id);
    return record != nullptr ? record->itemCount(rarity, key) : 0;
}

bool heard(const NetClient& client, const std::string& text) {
    for (const auto& line : client.chat()) {
        if (line.text.find(text) != std::string::npos) return true;
    }
    return false;
}

void seedTwo(const std::string& path) {
    seedUser(path, "alice", kPassword);
    seedUser(path, "bobby", kPassword);
    seedUser(path, "admin1", kPassword, true);
    seedStack(path, "alice", "petal_rose", Rarity::Common, 40);
    Database db;
    std::string error;
    db.load(path, error);
    PlayerRecord& record = db.progress(db.findUser("alice")->id);
    record.loadout.assign(kLoadoutSlots, std::nullopt);
    for (int i = 0; i < 3; ++i) {
        StoredItem basic;
        basic.petalType = "basic";
        record.loadout[static_cast<std::size_t>(i)] = basic;
    }
    db.markDirty();
    db.save();
}

} // namespace

// ---------------------------------------------------------------------------
// The placement rules
// ---------------------------------------------------------------------------

TEST(no_server_is_ever_dealt_every_biome) {
    using namespace cluster;
    for (int servers = 1; servers <= 4; ++servers) {
        for (int biomes = 1; biomes <= 9; ++biomes) {
            std::vector<BiomeLoad> loads(static_cast<std::size_t>(biomes));
            for (int i = 0; i < biomes; ++i) loads[static_cast<std::size_t>(i)].cost = i;
            std::vector<int> count(static_cast<std::size_t>(servers), 0);
            for (const Move& m : placeOrphans(loads, std::vector<ServerLoad>(static_cast<std::size_t>(servers)))) {
                ++count[static_cast<std::size_t>(m.to)];
            }
            for (const int n : count) CHECK(n < biomes);
            // And with anybody to share with, nothing is left over.
            int placed = 0;
            for (const int n : count) placed += n;
            if (servers > 1 && biomes > 1) CHECK_EQ(placed, biomes);
        }
    }
}

TEST(a_dead_servers_biomes_go_to_the_quietest_survivors) {
    using namespace cluster;
    std::vector<BiomeLoad> loads{{0, 5.0}, {1, 9.0}, {2, 1.0}, {0, 4.0}};
    std::vector<ServerLoad> servers{{false}, {true}, {true}};
    const std::vector<Move> moves = placeOrphans(loads, servers);
    CHECK_EQ(moves.size(), std::size_t{2});
    for (const Move& m : moves) CHECK_EQ(m.to, 2);
}

TEST(a_biome_with_people_in_it_moves_only_off_a_struggling_server) {
    using namespace cluster;
    std::vector<BiomeLoad> loads{{0, 10.0, 8}, {0, 6.0, 4}, {1, 1.0, 1}};
    std::vector<ServerLoad> calm{{true, 10.0}, {true, 2.0}};
    CHECK_EQ(rebalance(loads, calm).biome, -1);
    std::vector<ServerLoad> hot{{true, kOverloadedTickMillis + 5.0}, {true, 2.0}};
    const Move move = rebalance(loads, hot);
    CHECK_EQ(move.biome, 1);
    CHECK_EQ(move.to, 1);
    // Nor one with a boss standing in it, however hot.
    loads[0].pinned = loads[1].pinned = true;
    CHECK_EQ(rebalance(loads, hot).biome, -1);
}

TEST(an_empty_biome_is_moved_to_even_the_load_and_then_left_alone) {
    using namespace cluster;
    std::vector<BiomeLoad> loads{{0, 4.0}, {0, 4.0}, {0, 4.0}, {1, 1.0}};
    const std::vector<ServerLoad> servers(2);
    Move move = rebalance(loads, servers);
    CHECK(move.biome >= 0 && move.biome < 3);
    loads[static_cast<std::size_t>(move.biome)].server = 1;
    CHECK_EQ(rebalance(loads, servers).biome, -1);
}

// ---------------------------------------------------------------------------
// Two owners of one row
// ---------------------------------------------------------------------------

TEST(a_row_edited_on_both_sides_keeps_both_edits) {
    const Json base = Json::parseOrNull(
        R"({"totalXP":100,"stars":50,"inventory":{"common":{"petal_rose":5,"petal_bone":2}},)"
        R"("loadout":[null,{"petalType":"basic"}],"equippedSkinId":"a"})");
    // The gateway sells two roses and equips a skin...
    Json sold = base;
    sold["stars"] = Json(80);
    sold["inventory"]["common"]["petal_rose"] = Json(3);
    sold["equippedSkinId"] = Json("b");
    // ...while the flower picks one up, loses its bones and gains XP.
    Json played = base;
    played["totalXP"] = Json(130);
    played["inventory"]["common"]["petal_rose"] = Json(6);
    played["inventory"]["common"].erase("petal_bone");

    Json merged = played;
    applyRowDifference(merged, rowDifference(base, sold));
    const Json& m = merged;
    CHECK_EQ(m["totalXP"].asInt(), 130);
    CHECK_EQ(m["stars"].asInt(), 80);
    CHECK_EQ(m["inventory"]["common"]["petal_rose"].asInt(), 4);
    CHECK(!m["inventory"]["common"].contains("petal_bone"));
    CHECK_EQ(m["equippedSkinId"].asString(), std::string("b"));
    CHECK(rowDifference(base, base).isNull());
}

TEST(a_stack_given_or_emptied_crosses_as_an_amount) {
    const Json empty = Json::parseOrNull(R"({"inventory":{}})");
    const Json full = Json::parseOrNull(R"({"inventory":{"rare":{"petal_rose":7}}})");
    Json row = full;
    applyRowDifference(row, rowDifference(full, empty));
    CHECK_EQ(std::as_const(row)["inventory"]["rare"]["petal_rose"].asInt(), 0);
    row = full;
    applyRowDifference(row, rowDifference(empty, full));
    CHECK_EQ(std::as_const(row)["inventory"]["rare"]["petal_rose"].asInt(), 14);
    // Spending what the other side already spent leaves none, not a debt.
    Json spent = empty;
    applyRowDifference(spent, rowDifference(full, empty));
    CHECK_EQ(std::as_const(spent)["inventory"]["rare"]["petal_rose"].asInt(), 0);
}

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

TEST(a_flower_state_survives_the_link) {
    cluster::FlowerState s;
    s.how = cluster::FlowerState::How::Walk;
    s.realm = static_cast<Realm>(5);
    s.position = {1234.5678901, 99999.125};
    s.spawnChoice = "desert:1";
    s.health = 0.375;
    s.inputSequence = 77;
    s.ring.push_back({3, 4, true, 1250.0, 0.5, {10.f, 0.f}});
    ByteWriter w;
    s.write(w);
    ByteReader r(w.buffer());
    const cluster::FlowerState back = cluster::FlowerState::read(r);
    CHECK(r.ok() && r.remaining() == 0);
    CHECK(back.how == s.how && back.realm == s.realm);
    CHECK_EQ(back.position.x, s.position.x);
    CHECK_EQ(back.spawnChoice, s.spawnChoice);
    CHECK_EQ(back.ring.size(), std::size_t{1});
    CHECK_EQ(back.ring[0].reloadLeft, 1250.0);
    CHECK_EQ(back.ring[0].grainsLeft.size(), std::size_t{2});
}

TEST(a_server_without_the_secret_is_given_nothing) {
    Cluster c("cluster-secret", 2);
    CHECK(c.ready);
    GameServer& stranger = c.addServer("stranger", "a guess");
    c.step(60, {});
    CHECK(!stranger.linked());
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

TEST(every_biome_has_one_server_and_no_server_has_them_all) {
    Cluster c("cluster-deal", 3);
    CHECK(c.ready);
    std::set<std::string> used;
    for (const std::string& biome : c.gateway.biomeNames()) {
        const std::string server = c.gateway.serverOfBiome(biome);
        CHECK(!server.empty());
        used.insert(server);
        int hosts = 0;
        for (auto& s : c.servers) {
            for (const MapData& map : c.gateway.worldMaps().maps()) {
                if (map.prestige() || map.biome() != biome || map.id() != biome) continue;
                if (s->hostsRealm(map.realm())) ++hosts;
            }
        }
        if (biome == "garden" || biome == "desert" || biome == "ocean") CHECK_EQ(hosts, 1);
    }
    CHECK_EQ(used.size(), std::size_t{3});
    std::string why;
    CHECK(!c.gateway.hostsRealm(Realm::Overworld));
}

TEST(a_player_joins_moves_and_sees_mobs_through_the_gateway) {
    Cluster c("cluster-play", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    CHECK(c.stepUntil({&alice}, [&] { return alice.view().self().netId != 0; }));
    CHECK(GameServerPeer::bodyOf(*c.serverFor("garden"), "alice") != NULL_ENTITY);
    CHECK(GameServerPeer::bodyOf(*c.serverFor("desert"), "alice") == NULL_ENTITY);
    CHECK(GameServerPeer::bodyOf(c.gateway, "alice") == NULL_ENTITY);

    const Vec2 from = alice.view().self().position;
    for (int i = 0; i < 30; ++i) {
        net::InputFrame input;
        input.sequence = static_cast<std::uint32_t>(i + 1);
        input.moveAngle = 0.0;
        input.moveStrength = 1.0;
        alice.sendInput(input);
        c.step(1, {&alice});
    }
    CHECK((alice.view().self().position - from).length() > 50.0);

    alice.leaveGame();
    CHECK(c.stepUntil({&alice}, [&] { return c.gateway.leaseCount() == 0; }));
    CHECK(GameServerPeer::bodyOf(*c.serverFor("garden"), "alice") == NULL_ENTITY);
    // And back in, through another door, on the other server.
    CHECK(c.join(alice, {}, "desert"));
    CHECK(c.stepUntil({&alice}, [&] {
        return GameServerPeer::bodyOf(*c.serverFor("desert"), "alice") != NULL_ENTITY;
    }));
}

TEST(what_a_flower_earns_on_a_server_is_the_gateways_at_once) {
    Cluster c("cluster-earn", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    GameServer& garden = *c.serverFor("garden");
    const Entity body = GameServerPeer::bodyOf(garden, "alice");
    garden.world().get<PlayerProgress>(body).totalXp += 5000.0;
    GameServerPeer::record(garden, "alice").addItem(Rarity::Rare, "petal_bone", 3);
    c.step(10, {&alice});
    const Account* account = c.gateway.database().findUser("alice");
    CHECK_NEAR(c.gateway.database().findProgress(account->id)->totalXp, 5000.0, 1.0);
    CHECK_EQ(owned(c, "alice", "petal_bone", Rarity::Rare), 3);
    // The server goes without a word. Nothing that was shown is lost.
    GameServerPeer::cutLink(garden);
    c.step(5, {&alice});
    CHECK_EQ(owned(c, "alice", "petal_bone", Rarity::Rare), 3);
}

TEST(a_craft_and_a_purchase_back_to_back_spend_the_same_bag_once) {
    Cluster c("cluster-fence", 2, [](const std::string& path) {
        seedTwo(path);
        Database db;
        std::string error;
        db.load(path, error);
        db.progress(db.findUser("alice")->id).stars = 1e6;
        db.markDirty();
        db.save();
    });
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    const std::uint16_t rose = content().petalIndex("rose");
    // The craft is the garden server's, the purchase the gateway's: both, and
    // a second craft behind them, in one flush.
    alice.requestCraft(rose, Rarity::Common, 40);
    alice.requestBuyPetal(rose, Rarity::Common);
    alice.requestCraft(rose, Rarity::Common, 40);
    CHECK(c.stepUntil({&alice}, [&] { return alice.shopOutcome().pending; }));
    c.step(20, {&alice});
    // Forty went in, whatever came back of them; one was bought on top.
    const Account* account = c.gateway.database().findUser("alice");
    const PlayerRecord* row = c.gateway.database().findProgress(account->id);
    CHECK(row->stars < 1e6);
    CHECK(owned(c, "alice", "petal_rose", Rarity::Common) <= 5);
    CHECK(owned(c, "alice", "petal_rose", Rarity::Common) >= 1);
    // And both ends, and the client, agree.
    GameServer& garden = *c.serverFor("garden");
    CHECK_EQ(GameServerPeer::record(garden, "alice").itemCount(Rarity::Common, "petal_rose"),
             owned(c, "alice", "petal_rose", Rarity::Common));
    CHECK_EQ(stacked(alice, "rose", Rarity::Common), owned(c, "alice", "petal_rose", Rarity::Common));
    CHECK_NEAR(garden.world().get<PlayerProgress>(GameServerPeer::bodyOf(garden, "alice")).stars,
               row->stars, 0.5);
}

TEST(a_pad_to_another_servers_biome_carries_the_flower_across) {
    Cluster c("cluster-cross", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    // Past the reload every slot of a new flower owes.
    CHECK(c.stepUntil({&alice}, [&] {
        GameServer& server = *c.serverFor("garden");
        return server.world().get<Loadout>(GameServerPeer::bodyOf(server, "alice")).spawned.size() == 3;
    }));
    GameServer& garden = *c.serverFor("garden");
    GameServer& desert = *c.serverFor("desert");
    const Entity before = GameServerPeer::bodyOf(garden, "alice");
    Health& health = garden.world().get<Health>(before);
    health.invulnerableUntilMillis = 0;
    health.current = health.max * 0.5;
    garden.world().get<PlayerProgress>(before).totalXp = 12345.0;
    const Realm to = c.realm("desert");
    const Vec2 at = c.gateway.terrain().spawnPoint(to);
    CHECK(GameServerPeer::carry(garden, "alice", to, at));
    CHECK(c.stepUntil({&alice}, [&] { return GameServerPeer::bodyOf(desert, "alice") != NULL_ENTITY; }));
    CHECK(GameServerPeer::bodyOf(garden, "alice") == NULL_ENTITY);
    const Entity after = GameServerPeer::bodyOf(desert, "alice");
    CHECK(desert.world().get<Transform>(after).realm == to);
    CHECK((desert.world().get<Transform>(after).position - at).length() < 300.0);
    CHECK(desert.world().get<Health>(after).fraction() < 0.7);
    CHECK_NEAR(desert.world().get<PlayerProgress>(after).totalXp, 12345.0, 1.0);
    CHECK(c.stepUntil({&alice}, [&] { return alice.view().realm() == to && alice.view().self().netId != 0; }));
    CHECK(alice.status() == NetClient::Status::Playing);
    CHECK_EQ(c.gateway.leaseCount(), std::size_t{1});
    // Petals that were out are out again without serving a reload.
    c.step(3, {&alice});
    CHECK_EQ(desert.world().get<Loadout>(GameServerPeer::bodyOf(desert, "alice")).spawned.size(),
             std::size_t{3});
}

TEST(global_chat_reaches_every_server_and_local_chat_stays_put) {
    Cluster c("cluster-chat", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice, bobby;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.signIn(bobby, "bobby"));
    CHECK(c.join(alice, {&bobby}));
    CHECK(c.join(bobby, {&alice}, "desert"));
    alice.sendChat("hello across the water");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return heard(bobby, "hello across the water"); }));
    c.step(30, {&alice, &bobby});
    alice.sendChat("/l only over here");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return heard(alice, "only over here"); }));
    c.step(10, {&alice, &bobby});
    CHECK(!heard(bobby, "only over here"));
    c.step(30, {&alice, &bobby});
    alice.sendChat("/w bobby psst");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return heard(bobby, "psst"); }));
}

TEST(an_admins_give_reaches_a_flower_on_any_server) {
    Cluster c("cluster-give", 2, seedTwo);
    CHECK(apart(c));
    NetClient admin, bobby;
    CHECK(c.signIn(admin, "admin1"));
    CHECK(c.signIn(bobby, "bobby"));
    CHECK(c.join(admin, {&bobby}));
    CHECK(c.join(bobby, {&admin}, "desert"));
    admin.sendChat("/admin give bobby rose epic 4");
    CHECK(c.stepUntil({&admin, &bobby}, [&] { return stacked(bobby, "rose", Rarity::Epic) == 4; }));
    CHECK_EQ(owned(c, "bobby", "petal_rose", Rarity::Epic), 4);
    // A world verb aimed at a player runs on the server that has the player.
    const Entity body = GameServerPeer::bodyOf(*c.serverFor("desert"), "bobby");
    const Vec2 target =
        c.serverFor("desert")->world().get<Transform>(body).position + Vec2{300.0, 0.0};
    admin.sendChat("/admin teleport bobby " + std::to_string(static_cast<int>(target.x)) + " " +
                   std::to_string(static_cast<int>(target.y)));
    CHECK(c.stepUntil({&admin, &bobby}, [&] {
        return (c.serverFor("desert")->world().get<Transform>(body).position - target).length() < 150.0;
    }));
    admin.sendChat("/admin shards");
    CHECK(c.stepUntil({&admin, &bobby}, [&] { return heard(admin, "tick"); }));
}

TEST(a_biome_moves_between_servers_under_the_people_in_it) {
    Cluster c("cluster-move", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    c.step(20, {&alice});
    GameServer& from = *c.serverFor("garden");
    const std::string toName = c.gateway.serverOfBiome("garden") == "A" ? "B" : "A";
    const Vec2 at = from.world().get<Transform>(GameServerPeer::bodyOf(from, "alice")).position;
    // Something lying on the ground, reserved for her.
    const net::ConnectionId owner =
        from.world().get<PlayerAccount>(GameServerPeer::bodyOf(from, "alice")).connection;
    const Vec2 far = at + Vec2{4000.0, 0.0};
    const Entity drop = GameServerPeer::loot(from).spawnDrop(
        from.world(), content().petalIndex("bone"), Rarity::Epic, far, Realm::Overworld, {});
    from.world().get<DropItem>(drop).eligible.emplace_back(NULL_ENTITY, owner);

    std::string why;
    CHECK(c.gateway.moveBiome("garden", toName, why));
    CHECK(c.stepUntil({&alice}, [&] { return c.gateway.serverOfBiome("garden") == toName; }));
    GameServer& to = *c.serverFor("garden");
    CHECK(c.stepUntil({&alice}, [&] { return GameServerPeer::bodyOf(to, "alice") != NULL_ENTITY; }));
    CHECK(&to != &from);
    CHECK((to.world().get<Transform>(GameServerPeer::bodyOf(to, "alice")).position - at).length() < 200.0);
    int drops = 0;
    Query<DropItem> lying{to.world()};
    lying.each([&](Entity, DropItem& item) {
        if (item.configIndex == content().petalIndex("bone") && item.rarity == Rarity::Epic) {
            ++drops;
            CHECK_EQ(item.eligible.size(), std::size_t{1});
        }
    });
    CHECK_EQ(drops, 1);
    // Nothing of the garden is left behind.
    int left = 0;
    Query<MobTag, Transform> mobs{from.world()};
    mobs.each([&](Entity, MobTag&, Transform& t) { left += t.realm == Realm::Overworld ? 1 : 0; });
    c.step(60, {&alice});
    CHECK_EQ(left, 0);
    CHECK(alice.status() == NetClient::Status::Playing);
}

TEST(a_player_who_came_through_the_proxy_is_never_sent_to_a_servers_own_port) {
    Cluster c("cluster-proxied", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    // As the gateway sees a socket from a Cloudflare edge carrying the
    // visitor's address (account_limit_tests has the headers themselves).
    Session* session = GameServerPeer::sessionOf(c.gateway, "alice");
    CHECK(session != nullptr);
    if (session == nullptr) return;
    session->elsewhere.viaProxy = true;
    // Neither server has a hostname behind the proxy: she stays where she is,
    // and is told.
    alice.joinGame(1920, 1080, "", "flower");
    CHECK(c.stepUntil({&alice}, [&] { return heard(alice, "cannot be reached"); }));
    c.step(20, {&alice});
    CHECK(alice.status() == NetClient::Status::LoggedIn);
    CHECK(GameServerPeer::bodyOf(*c.serverFor("garden"), "alice") == NULL_ENTITY);
    CHECK_EQ(c.gateway.leaseCount(), std::size_t{0});

    // A server that has one: she goes there, and plays.
    c.addServer("C", "a secret between servers", "", "127.0.0.1");
    CHECK(c.stepUntil({&alice}, [&] { return c.servers.back()->linked(); }));
    std::string why;
    CHECK(c.gateway.assignBiomes({"garden"}, "C", why));
    CHECK(c.stepUntil({&alice}, [&] { return c.gateway.serverOfBiome("garden") == "C"; }));
    CHECK(c.join(alice, {}));
    CHECK(GameServerPeer::bodyOf(*c.servers.back(), "alice") != NULL_ENTITY);
    CHECK(c.stepUntil({&alice}, [&] { return alice.view().self().netId != 0; }));
}

TEST(an_admin_gives_a_server_the_domain_proxied_players_reach_it_at) {
    Cluster c("cluster-domain", 2, seedTwo);
    CHECK(apart(c));
    NetClient admin, alice;
    CHECK(c.signIn(admin, "admin1"));
    CHECK(c.signIn(alice, "alice"));
    Session* session = GameServerPeer::sessionOf(c.gateway, "alice");
    CHECK(session != nullptr);
    if (session == nullptr) return;
    // Through Cloudflare, and neither server knows the name it has there.
    session->elsewhere.viaProxy = true;
    const std::string garden = c.gateway.serverOfBiome("garden");
    std::size_t at = 0;
    while (at < c.servers.size() && std::string(1, static_cast<char>('A' + at)) != garden) ++at;
    CHECK(at < c.servers.size());
    if (at >= c.servers.size()) return;
    alice.joinGame(1920, 1080, "", "flower");
    CHECK(c.stepUntil({&alice, &admin}, [&] { return heard(alice, "cannot be reached"); }));

    // What is not a hostname is refused, and changes nothing.
    admin.sendChat("/admin shards domain " + garden + " not/a:host");
    CHECK(c.stepUntil({&alice, &admin}, [&] { return heard(admin, "is not a hostname"); }));
    c.step(20, {&alice, &admin});
    // Here, where no proxy answers, its own port stands in for the 443 a
    // proxied hostname is reached on.
    const std::string domain = "127.0.0.1:" + std::to_string(c.serverPorts[at]);
    admin.sendChat("/admin shards domain " + garden + " https://" + domain + "/");
    CHECK(c.stepUntil({&alice, &admin}, [&] { return heard(admin, "are sent to " + garden + " at " + domain); }));
    // Kept with the game, not with the server.
    CHECK_EQ(c.gateway.database().storedTable("cluster")["domains"][std::string(1, static_cast<char>('a' + at))].asString(), domain);
    CHECK(c.join(alice, {&admin}));
    CHECK(GameServerPeer::bodyOf(*c.servers[at], "alice") != NULL_ENTITY);
    CHECK(c.stepUntil({&alice, &admin}, [&] { return alice.view().self().netId != 0; }));

    c.step(20, {&alice, &admin});
    admin.sendChat("/admin shards domain");
    CHECK(c.stepUntil({&alice, &admin}, [&] { return heard(admin, garden + ": " + domain); }));
    c.step(20, {&alice, &admin});
    // The gateway's own, which every server is told of.
    admin.sendChat("/admin shards domain gateway play.example.com");
    CHECK(c.stepUntil({&alice, &admin}, [&] { return heard(admin, "The gateway is play.example.com"); }));
    CHECK_EQ(c.gateway.database().storedTable("cluster")["address"].asString(), std::string("play.example.com"));
}

TEST(a_lost_servers_players_come_back_on_another) {
    Cluster c("cluster-lost", 3, seedTwo);
    CHECK(apart(c));
    NetClient alice;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.join(alice, {}));
    c.step(20, {&alice});
    const std::string was = c.gateway.serverOfBiome("garden");
    // The process dies: its socket closes and it never speaks again.
    for (std::size_t i = 0; i < c.servers.size(); ++i) {
        if (was != std::string(1, static_cast<char>('A' + i))) continue;
        c.servers[i] = std::make_unique<GameServer>();
        ServerConfig config;
        config.dataDir = flix::testsupport::dataDir();
        config.role = ServerConfig::Role::Shard;
        config.clusterSecret = "not the one any more";
        config.gatewayPort = c.linkPort;
        std::string error;
        // A port of its own, not the default one something else may hold.
        bool up = false;
        for (std::uint16_t candidate = static_cast<std::uint16_t>(c.port + 300); !up && candidate < c.port + 360;
             ++candidate) {
            config.port = candidate;
            up = c.servers[i]->start(config, error);
            if (!up) c.servers[i] = std::make_unique<GameServer>();
        }
        CHECK(up);
    }
    CHECK(c.stepUntil({&alice}, [&] {
        const std::string now = c.gateway.serverOfBiome("garden");
        return !now.empty() && now != was;
    }));
    // Its socket was that server's, and went with it: the client is back at
    // the gateway, signs in, and plays on whoever has the garden now.
    CHECK(c.signInAgain(alice, "alice"));
    CHECK(c.join(alice, {}));
    CHECK(c.stepUntil({&alice}, [&] {
        return GameServerPeer::bodyOf(*c.serverFor("garden"), "alice") != NULL_ENTITY;
    }));
    CHECK(c.stepUntil({&alice}, [&] { return alice.view().self().netId != 0; }));
    CHECK(alice.status() == NetClient::Status::Playing);
    for (const std::string& biome : c.gateway.biomeNames()) {
        CHECK(!c.gateway.serverOfBiome(biome).empty());
    }
}

TEST(signing_in_twice_takes_the_flower_home_before_it_plays_again) {
    Cluster c("cluster-twice", 2, seedTwo);
    CHECK(apart(c));
    NetClient first, second;
    CHECK(c.signIn(first, "alice"));
    CHECK(c.join(first, {}));
    GameServer& garden = *c.serverFor("garden");
    garden.world().get<PlayerProgress>(GameServerPeer::bodyOf(garden, "alice")).totalXp = 777.0;
    CHECK(c.signIn(second, "alice"));
    CHECK(c.join(second, {&first}, "desert"));
    c.step(5, {&first, &second});
    CHECK(GameServerPeer::bodyOf(garden, "alice") == NULL_ENTITY);
    GameServer& desert = *c.serverFor("desert");
    const Entity body = GameServerPeer::bodyOf(desert, "alice");
    CHECK(body != NULL_ENTITY);
    if (body != NULL_ENTITY) CHECK_NEAR(desert.world().get<PlayerProgress>(body).totalXp, 777.0, 1.0);
    CHECK_EQ(c.gateway.leaseCount(), std::size_t{1});
}

TEST(a_squad_works_one_server_and_follows_its_only_body) {
    Cluster c("cluster-squad", 2, seedTwo);
    CHECK(apart(c));
    NetClient alice, bobby;
    CHECK(c.signIn(alice, "alice"));
    CHECK(c.signIn(bobby, "bobby"));
    CHECK(c.join(alice, {&bobby}));
    // Bobby is on the title screen: a squad may hold him all the same.
    alice.sendChat("/squad-create");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return alice.squad().members.size() == 1; }));
    alice.sendChat("/squad-invite bobby");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return heard(bobby, "invited you to their squad"); }));
    bobby.sendChat("/squad-accept");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return alice.squad().members.size() == 2; }));
    CHECK_EQ(bobby.squad().members.size(), std::size_t{2});
    c.step(30, {&alice, &bobby});
    bobby.sendChat("/s here");
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return heard(alice, "here"); }));
    // She walks to the other server, and the squad goes with her.
    CHECK(GameServerPeer::carry(*c.serverFor("garden"), "alice", c.realm("desert"),
                                c.gateway.terrain().spawnPoint(c.realm("desert"))));
    CHECK(c.stepUntil({&alice, &bobby}, [&] {
        return GameServerPeer::bodyOf(*c.serverFor("desert"), "alice") != NULL_ENTITY;
    }));
    c.step(20, {&alice, &bobby});
    CHECK_EQ(alice.squad().members.size(), std::size_t{2});
    // He joins the garden instead: two biomes are not one squad.
    CHECK(c.join(bobby, {&alice}));
    CHECK(c.stepUntil({&alice, &bobby}, [&] { return alice.squad().members.size() == 1; }));
    CHECK(bobby.squad().members.empty());
}

// ---------------------------------------------------------------------------
// Where an admin wants the biomes
// ---------------------------------------------------------------------------

TEST(an_assigned_biome_is_dealt_to_its_home_and_stays_there) {
    using namespace cluster;
    std::vector<BiomeLoad> loads(5);
    for (int i = 0; i < 5; ++i) loads[static_cast<std::size_t>(i)].cost = 1.0;
    loads[3].home = loads[4].home = 1;
    loads[0].home = 0;
    std::vector<ServerLoad> servers(2);
    std::vector<int> at(5, -1);
    for (const Move& m : placeOrphans(loads, servers)) at[static_cast<std::size_t>(m.biome)] = m.to;
    CHECK_EQ(at[3], 1);
    CHECK_EQ(at[4], 1);
    CHECK_EQ(at[0], 0);
    // However lopsided, a biome that is home is not moved for the load's sake.
    std::vector<BiomeLoad> heavy{{1, 9.0}, {1, 8.0}, {1, 7.0}, {0, 0.1}};
    for (BiomeLoad& b : heavy) b.home = b.server;
    CHECK_EQ(rebalance(heavy, servers).biome, -1);
    // Away from home with home up, it goes there, people in it or not.
    heavy[2].home = 0;
    heavy[2].humans = 5;
    const std::vector<Move> home = homecomings(heavy, servers);
    CHECK_EQ(home.size(), std::size_t{1});
    CHECK(!home.empty() && home[0].biome == 2 && home[0].to == 0);
    // Not to a server that is down, and not out from under a boss.
    CHECK(homecomings(heavy, {{false}, {true}}).empty());
    heavy[2].pinned = true;
    CHECK(homecomings(heavy, servers).empty());
    // Every biome assigned to one server leaves one of them elsewhere.
    for (BiomeLoad& b : loads) b.home = 0;
    int zero = 0;
    for (const Move& m : placeOrphans(loads, servers)) zero += m.to == 0 ? 1 : 0;
    CHECK_EQ(zero, 4);
}

TEST(an_admin_assigns_biomes_and_the_assignment_outlives_the_server) {
    Cluster c("cluster-assign", 2, seedTwo);
    CHECK(c.ready);
    NetClient admin;
    CHECK(c.signIn(admin, "admin1"));
    CHECK(c.join(admin, {}));
    admin.sendChat("/admin shards assign B garden desert ocean");
    const auto all = [&](const std::string& server) {
        for (const char* biome : {"garden", "desert", "ocean"}) {
            if (c.gateway.serverOfBiome(biome) != server) return false;
        }
        return true;
    };
    CHECK(c.stepUntil({&admin}, [&] { return all("B"); }));
    CHECK(heard(admin, "Assigned garden, desert, ocean to B"));
    // It is the database's: copied with it, and read back by the next gateway.
    const Json& kept = c.gateway.database().storedTable("cluster");
    CHECK_EQ(kept["assign"]["desert"].asString(), std::string("B"));
    // Nothing is left half done by a name that is wrong.
    std::string why;
    CHECK(!c.gateway.assignBiomes({"garden", "nowhere"}, "A", why));
    CHECK_EQ(c.gateway.database().storedTable("cluster")["assign"]["garden"].asString(), std::string("B"));
    CHECK(!c.gateway.assignBiomes({"all"}, "A", why));
    CHECK(why.find("every biome") != std::string::npos);

    // B dies: somebody else has them. B is back: so are they.
    c.servers[1]->stop();
    while (c.servers[1]->step()) c.step(1, {&admin});
    c.servers[1]->shutdown();
    CHECK(c.stepUntil({&admin}, [&] { return all("A"); }));
    c.servers.erase(c.servers.begin() + 1);
    c.addServer("B");
    CHECK(c.stepUntil({&admin}, [&] { return all("B"); }));
    // The admin's flower was on B, and so was the socket.
    CHECK(c.signInAgain(admin, "admin1"));

    c.step(40, {&admin});
    admin.sendChat("/admin shards unassign all");
    CHECK(c.stepUntil({&admin}, [&] {
        return c.gateway.database().storedTable("cluster")["assign"].size() == 0;
    }));
    c.step(40, {&admin});
    admin.sendChat("/admin shards balance off");
    CHECK(c.stepUntil({&admin}, [&] {
        const Json& balance = c.gateway.database().storedTable("cluster")["balance"];
        return balance.isBool() && !balance.asBool();
    }));
}

// ---------------------------------------------------------------------------
// The link itself
// ---------------------------------------------------------------------------

TEST(a_membership_from_when_servers_linked_on_a_port_of_their_own_says_so) {
    HarnessFiles files("membership-old-port");
    const std::string path = cluster::membershipPathFor(files.dbPath);
    {
        std::FILE* f = std::fopen(path.c_str(), "wb");
        CHECK(f != nullptr);
        if (f == nullptr) return;
        std::fputs("{\"role\":\"shard\",\"key\":\"correct-horse-battery-staple\",\"name\":\"east\","
                   "\"id\":\"abcd\",\"port\":3100,\"gateway\":\"10.0.0.1\",\"gatewayPort\":3100}\n",
                   f);
        std::fclose(f);
    }
    std::string note;
    cluster::Membership m = cluster::Membership::load(path, note);
    CHECK(note.empty());
    CHECK(m.role == cluster::Membership::Role::Shard);
    CHECK(m.oldLinkPort);
    CHECK_EQ(m.gatewayPort, std::uint16_t{3100});
    // Written again, it is of now: the gateway's port is its game port.
    m.gatewayPort = 3000;
    m.oldLinkPort = false;
    std::string error;
    CHECK(m.save(path, error));
    const cluster::Membership again = cluster::Membership::load(path, note);
    CHECK(!again.oldLinkPort);
    CHECK_EQ(again.gatewayPort, std::uint16_t{3000});
    CHECK_EQ(again.gatewayHost, std::string("10.0.0.1"));
}

TEST(a_server_link_is_refused_by_a_game_port_with_nobody_to_link) {
    // A server on its own with no key, and a server's WebSocket at /link.
    HarnessFiles files("link-no-key");
    GameServer server;
    ServerConfig config;
    config.dataDir = flix::testsupport::dataDir();
    config.databasePath = files.dbPath;
    config.botCount = 0;
    config.hourlyRifts = false;
    std::string error;
    bool up = false;
    for (std::uint16_t candidate = 47500; candidate < 47540 && !up; ++candidate) {
        config.port = candidate;
        up = server.start(config, error);
    }
    CHECK(up);
    if (!up) return;
    struct Quiet : net::TransportHandler {
        bool closed = false;
        void onConnect(net::Connection&) override {}
        void onMessage(net::Connection&, ByteReader&) override {}
        void onDisconnect(net::Connection&, const std::string&) override { closed = true; }
    } quiet;
    net::Dialer dialer;
    dialer.serverLink = true;
    CHECK(dialer.connect("127.0.0.1", config.port, error));
    const double end = monotonicMillis() + 3000.0;
    while (!quiet.closed && monotonicMillis() < end) {
        dialer.poll(quiet, 0);
        server.step();
    }
    CHECK(quiet.closed);
    server.stop();
    while (server.step()) {
    }
    server.shutdown();
}

TEST(chacha20_poly1305_is_rfc_8439s) {
    // Section 2.8.2, whole.
    std::uint8_t key[32];
    for (int i = 0; i < 32; ++i) key[i] = static_cast<std::uint8_t>(0x80 + i);
    const std::uint8_t nonce[12] = {7, 0, 0, 0, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47};
    const std::uint8_t aad[12] = {0x50, 0x51, 0x52, 0x53, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7};
    const std::string text =
        "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, "
        "sunscreen would be it.";
    std::vector<std::uint8_t> sealed(text.size() + crypto::kAeadTagBytes);
    crypto::aeadSeal(key, nonce, aad, sizeof aad, reinterpret_cast<const std::uint8_t*>(text.data()),
                     text.size(), sealed.data());
    CHECK_EQ(crypto::toHex(sealed.data(), 16), std::string("d31a8d34648e60db7b86afbc53ef7ec2"));
    CHECK_EQ(crypto::toHex(sealed.data() + text.size(), 16), std::string("1ae10b594f09e26a7e902ecbd0600691"));
    std::vector<std::uint8_t> opened(text.size());
    CHECK(crypto::aeadOpen(key, nonce, aad, sizeof aad, sealed.data(), sealed.size(), opened.data()));
    CHECK_EQ(std::string(opened.begin(), opened.end()), text);
    sealed[40] ^= 1;
    CHECK(!crypto::aeadOpen(key, nonce, aad, sizeof aad, sealed.data(), sealed.size(), opened.data()));
}

TEST(a_sealed_frame_opens_once_in_order_and_only_for_the_other_end) {
    cluster::LinkCipher gateway, server, stranger;
    gateway.start("the key between them", "server nonce", "gateway nonce", true);
    server.start("the key between them", "server nonce", "gateway nonce", false);
    stranger.start("another key entirely", "server nonce", "gateway nonce", false);
    std::vector<std::byte> out;
    for (const std::size_t size : {std::size_t{0}, std::size_t{1}, std::size_t{63}, std::size_t{64}, std::size_t{200000}}) {
        ByteWriter w;
        w.buffer().resize(size, std::byte{0x5a});
        const ByteWriter sealed = server.seal(w);
        CHECK(!stranger.open(sealed.data(), sealed.size(), out));
        // Sent back where it came from, it is not the other end's.
        CHECK(!server.open(sealed.data(), sealed.size(), out));
        CHECK(gateway.open(sealed.data(), sealed.size(), out));
        CHECK(out == w.buffer());
        // Again, it is not the next frame.
        CHECK(!gateway.open(sealed.data(), sealed.size(), out));
    }
    ByteWriter w;
    w.str("one");
    const ByteWriter skipped = server.seal(w);
    const ByteWriter next = server.seal(w);
    CHECK(!gateway.open(next.data(), next.size(), out));
    CHECK(gateway.open(skipped.data(), skipped.size(), out));
}

// ---------------------------------------------------------------------------
// The database on every server
// ---------------------------------------------------------------------------

TEST(every_server_keeps_the_whole_database_and_every_change_to_it) {
    Cluster c("cluster-copy", 2, seedTwo);
    CHECK(c.ready);
    const std::string path = c.files.dbPath + ".replica";
    c.addServer("C", "a secret between servers", path);
    const auto copied = [&] {
        Database copy;
        std::string error;
        return copy.load(path, error) && copy.findUser("alice") != nullptr;
    };
    CHECK(c.stepUntil({}, [&] {
        std::FILE* f = std::fopen(path.c_str(), "rb");
        if (f != nullptr) std::fclose(f);
        return f != nullptr;
    }));
    // Changes after the first pass: an account made, one that earned, a table.
    NetClient carol, admin;
    carol.contentHash = admin.contentHash = content().contentHash();
    CHECK(carol.connect("127.0.0.1", c.port));
    CHECK(c.stepUntil({&carol}, [&] { return carol.status() == NetClient::Status::Ready; }));
    carol.requestRegister("caroline", kPassword);
    CHECK(c.stepUntil({&carol}, [&] { return carol.status() == NetClient::Status::LoggedIn; }));
    CHECK(c.signIn(admin, "admin1"));
    admin.sendChat("/admin give alice rose mythic 7");
    c.step(5, {&carol, &admin});
    std::string why;
    CHECK(c.gateway.assignBiomes({"desert"}, "A", why));
    for (int i = 0; i < 4; ++i) {
        // Copies go out half a second apart by the wall clock.
        ::usleep(300000);
        c.step(10, {&carol, &admin});
    }
    CHECK(copied());
    c.servers.back()->stop();
    while (c.servers.back()->step()) c.step(1, {&carol, &admin});
    c.servers.back()->shutdown();
    c.servers.pop_back();

    Database copy;
    std::string error;
    CHECK(copy.load(path, error));
    CHECK_EQ(copy.usernames().size(), c.gateway.database().usernames().size());
    // As good as the one it is a copy of: the passwords work, and the sessions.
    CHECK(copy.verifyPassword("alice", kPassword));
    CHECK(copy.verifyPassword("caroline", kPassword));
    const Account* alice = std::as_const(copy).findUser("alice");
    const PlayerRecord* record = alice != nullptr ? copy.findProgress(alice->id) : nullptr;
    CHECK(record != nullptr);
    if (record != nullptr) CHECK_EQ(record->itemCount(Rarity::Mythic, "petal_rose"), 7);
    CHECK_EQ(copy.storedTable("cluster")["assign"]["desert"].asString(), std::string("A"));
    CHECK_EQ(copy.storedTable("ipSalt").asString(), c.gateway.database().storedTable("ipSalt").asString());
}

// ---------------------------------------------------------------------------
// Two servers, linked from inside the game
// ---------------------------------------------------------------------------

namespace {

/// A server of its own, as `npm start` runs one: whatever its file says it is.
struct Lone {
    HarnessFiles files;
    ServerHost host;
    std::uint16_t port = 0;
    bool up = false;

    Lone(const char* name, std::uint16_t from, const std::function<void(const std::string&)>& seed)
        : files(name) {
        seed(files.dbPath);
        for (std::uint16_t candidate = from; candidate < from + 20 && !up; ++candidate) {
            port = candidate;
            std::string error;
            up = host.start(config(), false, error);
        }
    }
    ServerConfig config() const {
        ServerConfig c;
        c.dataDir = flix::testsupport::dataDir();
        c.databasePath = files.dbPath;
        c.port = port;
        c.botCount = 0;
        c.passwordCost = crypto::kBcryptMinCost;
        c.hourlyRifts = false;
        return c;
    }
};

struct Pair {
    Lone a;
    Lone b;
    Pair(const char* one, const char* two)
        : a(one, 47400, seedTwo), b(two, 47430, [](const std::string& path) {
              seedUser(path, "boss2", kPassword, true);
          }) {}

    /// Really: the links, the copies and the restarts run on the wall clock.
    template <class F>
    bool until(std::vector<NetClient*> clients, F done, double seconds = 20.0) {
        const double end = monotonicMillis() + seconds * 1000.0;
        while (monotonicMillis() < end) {
            for (NetClient* c : clients) c->poll(0);
            a.host.step();
            b.host.step();
            if (done()) return true;
        }
        return false;
    }
    void run(std::vector<NetClient*> clients, double seconds) {
        until(std::move(clients), [] { return false; }, seconds);
    }
    bool signIn(NetClient& client, std::uint16_t port, const char* name) {
        client.contentHash = content().contentHash();
        if (!client.connect("127.0.0.1", port)) return false;
        if (!until({&client}, [&] { return client.status() == NetClient::Status::Ready; }, 5.0)) return false;
        client.requestLogin(name, kPassword);
        return until({&client}, [&] {
            return client.status() == NetClient::Status::LoggedIn;
        }, 5.0);
    }
    bool say(NetClient& client, const std::string& line, const std::string& answer) {
        client.sendChat(line);
        const bool answered = until({&client}, [&] { return heard(client, answer); }, 5.0);
        // Past the half-second between two lines.
        run({&client}, 0.6);
        return answered;
    }
    GameServer* sa() { return a.host.server(); }
    GameServer* sb() { return b.host.server(); }
};

constexpr const char* kKey = "correct-horse-battery-staple";

/// Gives both the same key and joins B to A.
bool link(Pair& p) {
    NetClient admin, boss;
    if (!p.signIn(admin, p.a.port, "admin1") || !p.signIn(boss, p.b.port, "boss2")) return false;
    // The game's own port: servers dial it as players do.
    const std::string door = std::to_string(p.a.port);
    if (!p.say(admin, "/admin cluster key " + std::string(kKey), "can connect here")) return false;
    if (!p.say(boss, "/admin cluster key " + std::string(kKey), "Key set")) {
        return false;
    }
    // The key is nowhere on anybody's screen.
    if (heard(admin, kKey) || heard(boss, kKey)) return false;
    boss.sendChat("/admin cluster connect 127.0.0.1:" + door + " east");
    return p.until({&admin, &boss}, [&] {
        return p.sa() != nullptr && p.sb() != nullptr && p.sa()->role() == ServerConfig::Role::Gateway &&
               p.sb()->role() == ServerConfig::Role::Shard && p.sb()->linked() &&
               p.sa()->serverNames().size() == 2 && !p.sa()->serverOfBiome("garden").empty();
    });
}

} // namespace

TEST(two_servers_are_linked_by_a_key_and_a_command_and_unlinked_by_another) {
    Pair p("link-a", "link-b");
    CHECK(p.a.up && p.b.up);
    CHECK(link(p));
    const std::vector<std::string> names = p.sa()->serverNames();
    CHECK(std::find(names.begin(), names.end(), "east") != names.end());

    // Two servers: the one that was joined has biomes of its own, and neither
    // has all of them.
    CHECK(p.a.host.simulation() != nullptr);
    const std::vector<std::string> biomes = p.sa()->biomeNames();
    CHECK(p.until({}, [&] {
        return std::all_of(biomes.begin(), biomes.end(),
                           [&](const std::string& b) { return !p.sa()->serverOfBiome(b).empty(); });
    }));
    std::set<std::string> holders;
    for (const std::string& biome : biomes) holders.insert(p.sa()->serverOfBiome(biome));
    CHECK_EQ(holders.size(), std::size_t{2});

    // B's own port still answers, with A's game: A's accounts, and a flower
    // on whichever server has its biome.
    NetClient alice, stranger, admin;
    CHECK(p.signIn(alice, p.b.port, "alice"));
    alice.joinGame(1920, 1080, "", "flower");
    CHECK(p.until({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }, 10.0));
    CHECK(p.until({&alice}, [&] { return !alice.view().entities().empty(); }, 10.0));
    CHECK(!p.signIn(stranger, p.b.port, "boss2"));
    stranger.disconnect();
    CHECK(p.signIn(admin, p.a.port, "admin1"));
    CHECK(p.say(admin, "/admin shards assign east garden", "Assigned garden to east"));
    CHECK(p.until({&alice, &admin}, [&] { return p.sa()->serverOfBiome("garden") == "east"; }));
    CHECK(p.until({&alice, &admin}, [&] { return alice.status() == NetClient::Status::Playing; }, 5.0));

    // And the database is on B's disk.
    CHECK(p.until({&alice, &admin}, [&] {
        Database copy;
        std::FILE* f = std::fopen((p.b.files.dbPath + ".replica").c_str(), "rb");
        if (f == nullptr) return false;
        std::fclose(f);
        std::string error;
        return copy.load(p.b.files.dbPath + ".replica", error) && copy.findUser("alice") != nullptr;
    }, 10.0));
    CHECK(p.say(admin, "/admin cluster", "copied"));

    admin.sendChat("/admin cluster disconnect east");
    CHECK(p.until({&alice, &admin}, [&] {
        return p.sa() != nullptr && p.sb() != nullptr && p.sa()->role() == ServerConfig::Role::Alone &&
               p.sb()->role() == ServerConfig::Role::Alone;
    }));
    // Each with its own accounts again.
    NetClient boss, again;
    CHECK(p.signIn(boss, p.b.port, "boss2"));
    CHECK(p.signIn(again, p.a.port, "alice"));
    boss.sendChat("/admin cluster");
    CHECK(p.until({&boss}, [&] { return heard(boss, "on its own, has a key"); }, 5.0));
}

TEST(the_gateways_own_simulation_takes_its_players_on_the_gateways_port) {
    Pair p("own-a", "own-b");
    CHECK(p.a.up && p.b.up);
    CHECK(link(p));
    GameServer* own = p.a.host.simulation();
    CHECK(own != nullptr);
    if (own == nullptr) return;
    std::string name;
    for (const std::string& n : p.sa()->serverNames()) {
        if (n != "east") name = n;
    }
    NetClient admin, alice;
    CHECK(p.signIn(admin, p.a.port, "admin1"));
    CHECK(p.say(admin, "/admin shards assign " + name + " garden", "Assigned garden to " + name));
    CHECK(p.until({&admin}, [&] { return p.sa()->serverOfBiome("garden") == name; }));
    // It listens on no port of its own: the gateway's proxied hostname reaches
    // only the gateway's.
    {
        net::Dialer probe;
        std::string error;
        if (probe.connect("127.0.0.1", static_cast<std::uint16_t>(p.a.port + 1), error)) {
            net::TransportHandler nobody;
            for (int i = 0; i < 200 && probe.state() == net::Dialer::State::Connecting; ++i) probe.poll(nobody, 2);
        }
        CHECK(probe.state() != net::Dialer::State::Connected);
    }
    CHECK(p.signIn(alice, p.a.port, "alice"));
    alice.joinGame(1920, 1080, "", "flower");
    CHECK(p.until({&alice, &admin}, [&] { return alice.status() == NetClient::Status::Playing; }, 10.0));
    CHECK(p.until({&alice, &admin}, [&] { return !alice.view().entities().empty(); }, 10.0));
    CHECK(GameServerPeer::bodyOf(*own, "alice") != NULL_ENTITY);
    // Chat is the gateway's, asked of it over the link.
    alice.sendChat("hello from the gateway's own garden");
    CHECK(p.until({&alice, &admin}, [&] { return heard(admin, "hello from the gateway's own garden"); }, 5.0));
}

TEST(a_server_with_another_key_is_not_linked_and_goes_on_as_it_was) {
    Pair p("nolink-a", "nolink-b");
    CHECK(p.a.up && p.b.up);
    NetClient admin, boss;
    CHECK(p.signIn(admin, p.a.port, "admin1"));
    CHECK(p.signIn(boss, p.b.port, "boss2"));
    const std::string door = std::to_string(p.a.port);
    // Not without a key at all, and not with one that is no key.
    CHECK(p.say(boss, "/admin cluster connect 127.0.0.1:" + door, "Set the key first"));
    CHECK(p.say(boss, "/admin cluster key short", "A key is at least"));
    CHECK(p.say(admin, "/admin cluster key " + std::string(kKey), "can connect here"));
    CHECK(p.say(boss, "/admin cluster key some-other-key-entirely", "Key set"));
    CHECK(p.say(boss, "/admin cluster connect 127.0.0.1:" + door, "not this server's key"));
    // Nobody there.
    CHECK(p.say(boss, "/admin cluster connect 127.0.0.1:1", "Not linked to 127.0.0.1:1"));
    // Itself.
    CHECK(p.say(boss, "/admin cluster connect 127.0.0.1:" + std::to_string(p.b.port), "this very server"));
    CHECK(p.sa()->role() == ServerConfig::Role::Alone);
    CHECK(p.sb()->role() == ServerConfig::Role::Alone);
    CHECK(boss.status() == NetClient::Status::LoggedIn);
    // Somebody who is nobody is told nothing.
    NetClient bobby;
    CHECK(p.signIn(bobby, p.a.port, "bobby"));
    bobby.sendChat("/admin cluster key " + std::string(kKey));
    p.run({&bobby}, 1.0);
    CHECK(!heard(bobby, "Key set"));
}

TEST(a_linked_servers_copy_becomes_the_gateways_database_when_it_is_promoted) {
    Pair p("promote-a", "promote-b");
    CHECK(p.a.up && p.b.up);
    CHECK(link(p));
    CHECK(p.until({}, [&] {
        std::FILE* f = std::fopen((p.b.files.dbPath + ".replica").c_str(), "rb");
        if (f != nullptr) std::fclose(f);
        return f != nullptr;
    }, 10.0));
    p.run({}, 1.5);
    // A is gone for good. B, stopped and started with --promote:
    p.b.host.stop();
    while (p.b.host.step()) p.a.host.step();
    p.a.host.stop();
    while (p.a.host.step()) {
    }
    std::string note;
    CHECK(cluster::promote(p.b.files.dbPath, note));
    Database db;
    std::string error;
    CHECK(db.load(p.b.files.dbPath, error));
    CHECK(db.verifyPassword("alice", kPassword));
    CHECK(db.findUser("boss2") == nullptr);
    const cluster::Membership m = cluster::Membership::load(cluster::membershipPathFor(p.b.files.dbPath), error);
    CHECK(m.role == cluster::Membership::Role::Gateway);
    CHECK_EQ(m.key, std::string(kKey));
    // What was B's own is beside it, and there is nothing left to promote.
    const std::string aside = p.b.files.dbPath.substr(0, p.b.files.dbPath.rfind('/')) + "/database_independent.json";
    Database own;
    CHECK(own.load(aside, error));
    CHECK(own.findUser("boss2") != nullptr);
    CHECK(!cluster::promote(p.b.files.dbPath, note));
    // What a third server would be told: on its own again, with its key.
    CHECK(cluster::unlink(p.b.files.dbPath, note));
    CHECK(cluster::Membership::load(cluster::membershipPathFor(p.b.files.dbPath), error).role ==
          cluster::Membership::Role::Alone);
    CHECK(!cluster::unlink(p.b.files.dbPath, note));
    std::remove(aside.c_str());
    std::remove((aside + ".journal").c_str());
}

TEST(a_copy_never_overwrites_a_database_that_is_not_its_own) {
    Cluster c("cluster-aside", 2, seedTwo);
    CHECK(c.ready);
    const std::string dir = c.files.dbPath.substr(0, c.files.dbPath.rfind('/'));
    const std::string path = dir + "/elsewhere.json";
    const std::string first = dir + "/database_independent.json";
    const std::string second = dir + "/database_independent-2.json";
    const auto there = [](const std::string& file) {
        std::FILE* f = std::fopen(file.c_str(), "rb");
        if (f != nullptr) std::fclose(f);
        return f != nullptr;
    };
    const auto has = [](const std::string& file, const char* user) {
        Database db;
        std::string error;
        return db.load(file, error) && db.findUser(user) != nullptr;
    };
    const auto copyTo = [&](const char* name) {
        c.addServer(name, "a secret between servers", path);
        const bool copied = c.stepUntil({}, [&] { return there(path + ".of"); });
        c.servers.back()->stop();
        while (c.servers.back()->step()) c.step(1, {});
        c.servers.back()->shutdown();
        c.servers.pop_back();
        return copied;
    };
    // Somebody's own game is at the path the copy was told to use.
    seedUser(path, "hermit", kPassword);
    CHECK(copyTo("C"));
    CHECK(has(path, "alice"));
    CHECK(has(first, "hermit"));
    // The same cluster's copy again is this one brought up to date.
    CHECK(copyTo("C"));
    CHECK(has(path, "alice"));
    CHECK(!there(second));
    // Another database of somebody's, and the first is still not written over.
    for (const char* suffix : {"", ".journal", ".journal.next", ".of"}) std::remove((path + suffix).c_str());
    seedUser(path, "recluse", kPassword);
    CHECK(copyTo("C"));
    CHECK(has(path, "alice"));
    CHECK(has(first, "hermit"));
    CHECK(has(second, "recluse"));
    for (const std::string& file : {path, first, second}) {
        for (const char* suffix : {"", ".journal", ".journal.next", ".of", ".was", ".tmp"}) {
            std::remove((file + suffix).c_str());
        }
    }
}
