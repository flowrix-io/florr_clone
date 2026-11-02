// The admin dashboard and flower control, end to end over loopback.
//
// The first version of the dashboard named its rows by connection and then
// typed that number into chat commands that only resolve names, so nothing it
// selected was ever reached; reset the server's view of a client on every
// change of viewpoint without telling the client, so the old self and a whole
// screen of entities stayed behind as ghosts; wrote the steering admin's window
// over the steered player's own; let the steered player escape by switching
// splitter halves; and let a one-life grant take a full admin's flower. Every
// test below holds one of those down, through the shipping path: a real
// GameServer, real NetClients and the real protocol.

#include "test.h"

#include <cmath>
#include <cstdio>
#include <limits>
#include <string>
#include <vector>

#include "client/ui/menus.h"
#include "server/db.h"
#include "server/systems/combat.h"
#include "server_harness.h"
#include "shared/game/config.h"
#include "shared/net/admin_dashboard.h"
#include "shared/net/transport.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

constexpr const char* kPassword = "password7";

/// Accounts written straight into the database file before the server opens
/// it: registering them would run into the per-address registration limit,
/// which every loopback client shares.
void seedUsers(const std::string& path, const std::vector<std::string>& names,
               const std::vector<std::string>& admins = {}) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);   // the default cost makes this the slowest part
    for (const std::string& name : names) {
        CreateResult created = db.createUser(name, kPassword);
        if (!created.ok()) continue;
        for (const std::string& admin : admins) {
            if (admin == name) created.account->admin = true;
        }
    }
    db.markDirty();
    db.save();
}

/// Connects and signs in every client, then joins each one into the world
/// under `plates[i]` with a `width` x `height` window, and waits until each
/// has its body placed. Stepped together, so a crowd costs one wait.
bool enterWorld(Harness& h, const std::vector<NetClient*>& clients,
                const std::vector<std::string>& accounts, const std::vector<std::string>& plates,
                int width = 1000, int height = 800, const std::string& door = {}) {
    for (NetClient* client : clients) {
        client->contentHash = content().contentHash();
        if (!client->connect("127.0.0.1", h.port)) return false;
    }
    if (!h.stepUntil(clients, [&] {
            for (NetClient* c : clients) {
                if (c->status() != NetClient::Status::Ready) return false;
            }
            return true;
        })) {
        return false;
    }
    for (std::size_t i = 0; i < clients.size(); ++i) {
        clients[i]->requestLogin(accounts[i], kPassword);
    }
    if (!h.stepUntil(clients, [&] {
            for (NetClient* c : clients) {
                if (c->status() != NetClient::Status::LoggedIn) return false;
            }
            return true;
        })) {
        return false;
    }
    for (std::size_t i = 0; i < clients.size(); ++i) {
        clients[i]->joinGame(width, height, door, plates[i]);
    }
    return h.stepUntil(clients, [&] {
        for (NetClient* c : clients) {
            if (c->status() != NetClient::Status::Playing || !c->selfPlaced()) return false;
        }
        return true;
    });
}

Entity bodyWithNetId(World& world, std::uint32_t netId) {
    Entity found = NULL_ENTITY;
    Query<PlayerTag, NetId> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, NetId& id) {
        if (id.value == netId) found = e;
    });
    return found;
}

/// Every body the account owns -- both halves of a split flower. By account
/// id, because the name on a body is its nameplate.
std::vector<Entity> bodiesOf(Harness& h, const std::string& username) {
    std::vector<Entity> found;
    const Account* account = h.server.database().findUser(username);
    if (account == nullptr) return found;
    const std::string id = account->id;
    Query<PlayerTag, PlayerAccount> bodies{h.server.world()};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& owner) {
        if (owner.userId == id) found.push_back(e);
    });
    return found;
}

int selfFlagged(const NetClient& client) {
    int n = 0;
    for (const auto& entry : client.view().entities()) {
        if (entry.second.isSelf()) ++n;
    }
    return n;
}

/// Nothing in these tests is about dying unless it says so, and a mob that
/// wanders up mid-test should not decide one.
void protect(World& world, Entity body) {
    if (Health* health = world.tryGet<Health>(body)) {
        health->invulnerableUntilMillis = std::numeric_limits<double>::infinity();
    }
}

void kill(World& world, Entity body) {
    Health& health = world.get<Health>(body);
    health.invulnerableUntilMillis = 0;
    health.current = 0;
    world.add<Dead>(body, Dead{NULL_ENTITY});
}

/// An open point in the overworld that `accept` likes, nearest to `from`.
template <class F>
Vec2 openPointWhere(const Terrain& terrain, Vec2 from, F accept) {
    const Vec2 extent = terrain.realmExtent(Realm::Overworld);
    Vec2 best = from;
    double bestGap = -1;
    for (double x = 300; x < extent.x - 300; x += 125) {
        for (double y = 300; y < extent.y - 300; y += 125) {
            const Vec2 p{x, y};
            if (terrain.blocked(p, Realm::Overworld) || !accept(p)) continue;
            const double gap = std::max(std::abs(p.x - from.x), std::abs(p.y - from.y));
            if (bestGap < 0 || gap < bestGap) {
                best = p;
                bestGap = gap;
            }
        }
    }
    return best;
}

// transcript() and sawText() are the harness's own (server_harness.h).

/// Sends a console line and steps until something new lands in the sender's
/// transcript.
bool say(Harness& h, NetClient& client, const std::string& text,
         const std::vector<NetClient*>& clients) {
    const std::uint64_t before = client.chatSequence();
    client.sendChat(text);
    return h.stepUntil(clients, [&] { return client.chatSequence() > before; }, 120);
}

/// The connection the dashboard lists `username` under, or 0.
net::ConnectionId listed(Harness& h, NetClient& admin, const std::string& username,
                         const std::vector<NetClient*>& clients) {
    admin.adminDashboardPlayers("", 0);
    if (!h.stepUntil(clients, [&] { return !admin.adminDashboard().playersPending; })) return 0;
    for (const net::AdminDashboardPlayer& row : admin.adminDashboard().players) {
        if (row.username == username) return row.connection;
    }
    return 0;
}

/// Steps until a Control or Release answer lands, and reports it.
bool answered(Harness& h, NetClient& admin, std::uint32_t before,
              const std::vector<NetClient*>& clients) {
    return h.stepUntil(clients, [&] { return admin.adminDashboard().resultSeq != before; }, 120);
}

/// One input frame from a client, with a sequence the server has not seen.
void steer(NetClient& client, std::uint32_t sequence, double strength, double angle,
           std::uint8_t flags = 0) {
    net::InputFrame frame;
    frame.sequence = sequence;
    frame.moveStrength = strength;
    frame.moveAngle = angle;
    frame.flags = flags;
    client.sendInput(frame);
}

} // namespace

TEST(the_player_list_pages_in_account_order_and_searches_both_names) {
    // One more than a page, plus the admin: the list has to be cut, and the
    // cut has to land in the same place twice.
    const int others = static_cast<int>(net::kAdminDashboardPageSize) + 1;
    std::vector<std::string> names{"boss"};
    for (int i = 0; i < others; ++i) {
        char name[8];
        std::snprintf(name, sizeof name, "p%03d", i);
        names.push_back(name);
    }
    Harness h("dash-paging", [&](const std::string& path) { seedUsers(path, names, {"boss"}); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    std::vector<NetClient> clients(names.size());
    std::vector<NetClient*> all;
    std::vector<std::string> plates;
    for (std::size_t i = 0; i < clients.size(); ++i) {
        all.push_back(&clients[i]);
        // One flower wears a nameplate nothing else matches, to be found by.
        plates.push_back(names[i] == "p007" ? "Sunflower" : "Flower");
    }
    CHECK(enterWorld(h, all, names, plates));
    NetClient& boss = clients[0];
    CHECK(h.stepUntil(all, [&] { return boss.isSkinAdmin(); }));

    // The first page: a whole page, the true total, and account order --
    // "boss" before "p000", and the names in sequence after it.
    boss.adminDashboardPlayers("", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().playersPending; }));
    const AdminDashboardState& d = boss.adminDashboard();
    CHECK_EQ(d.players.size(), static_cast<std::size_t>(net::kAdminDashboardPageSize));
    CHECK_EQ(d.playersTotal, static_cast<std::uint32_t>(names.size()));
    if (!d.players.empty()) CHECK_EQ(d.players.front().username, std::string("boss"));
    for (std::size_t i = 1; i < d.players.size(); ++i) {
        CHECK(d.players[i - 1].username < d.players[i].username);
    }

    // Load more picks up exactly where the first page stopped.
    boss.adminDashboardPlayers("", static_cast<std::uint32_t>(d.players.size()));
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().playersPending; }));
    CHECK_EQ(d.players.size(), names.size());
    if (d.players.size() == names.size()) {
        CHECK_EQ(d.players.back().username, std::string("p050"));
        CHECK_EQ(d.players[d.players.size() - 2].username, std::string("p049"));
    }

    // Case-blind, on the account...
    boss.adminDashboardPlayers("P04", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().playersPending; }));
    CHECK_EQ(d.playersTotal, 10u);
    // ...and on the nameplate, which is what an admin reads off the screen.
    boss.adminDashboardPlayers("SUNFL", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().playersPending; }));
    CHECK_EQ(d.players.size(), 1u);
    if (d.players.size() == 1) {
        CHECK_EQ(d.players.front().username, std::string("p007"));
        CHECK_EQ(d.players.front().name, std::string("Sunflower"));
    }
}

TEST(a_bag_is_read_by_connection_from_the_account_even_in_the_arena) {
    Harness h("dash-bag", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor", "pirate"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor, pirate;
    const std::vector<NetClient*> all{&boss, &visitor, &pirate};
    CHECK(enterWorld(h, {&boss, &visitor}, {"boss", "visitor"}, {"Boss", "Visitor"}));
    // The ring plays on a scratch kit; the dashboard must not be reading it.
    CHECK(enterWorld(h, {&pirate}, {"pirate"}, {"Pirate"}, 1000, 800, kArenaSpawnChoice));

    CHECK(say(h, boss, "/admin give pirate rose legendary 3", all));
    CHECK(say(h, boss, "/admin give visitor basic rare 2", all));

    const net::ConnectionId pirateId = listed(h, boss, "pirate", all);
    CHECK(pirateId != 0);
    boss.adminDashboardInventory(pirateId, "pirate", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().bagPending; }));
    const AdminDashboardState& d = boss.adminDashboard();
    CHECK_EQ(d.bagUsername, std::string("pirate"));
    bool rose = false;
    for (const net::AdminDashboardStack& stack : d.bag) {
        if (content().petal(stack.petalIndex).id == "rose" && stack.rarity == Rarity::Legendary) {
            rose = stack.count == 3;
        }
    }
    CHECK(rose);

    // And by connection, not by whoever a name might resolve to: the next
    // player's bag replaces it, and a connection that is gone says so.
    const net::ConnectionId visitorId = listed(h, boss, "visitor", all);
    boss.adminDashboardInventory(visitorId, "visitor", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().bagPending; }));
    CHECK_EQ(d.bagUsername, std::string("visitor"));
    pirate.disconnect();
    h.step(5, {&boss, &visitor});
    boss.adminDashboardInventory(pirateId, "pirate", 0);
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return !boss.adminDashboard().bagPending; }));
    CHECK(d.bagGone);
}

TEST(control_by_connection_steers_the_target_and_release_hands_it_back) {
    Harness h("dash-control", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    const std::uint32_t bossNet = boss.view().self().netId;
    const std::uint32_t visitorNet = visitor.view().self().netId;
    const Entity bossBody = bodyWithNetId(world, bossNet);
    const Entity visitorBody = bodyWithNetId(world, visitorNet);
    if (bossBody == NULL_ENTITY || visitorBody == NULL_ENTITY) { CHECK(false); return; }
    protect(world, bossBody);
    protect(world, visitorBody);

    // Asking for yourself is refused in its own words.
    const net::ConnectionId self = listed(h, boss, "boss", all);
    std::uint32_t seq = boss.adminDashboard().resultSeq;
    boss.adminControl(self, "boss");
    CHECK(answered(h, boss, seq, all));
    CHECK(!boss.adminDashboard().resultOk);
    CHECK_EQ(boss.adminDashboard().resultMessage, std::string("You cannot control your own flower."));

    const net::ConnectionId target = listed(h, boss, "visitor", all);
    CHECK(target != 0);
    seq = boss.adminDashboard().resultSeq;
    boss.adminControl(target, "visitor");
    CHECK(answered(h, boss, seq, all));
    CHECK(boss.adminDashboard().resultOk);
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == visitorNet; }));
    CHECK(boss.controllingFlower());
    CHECK_EQ(boss.adminDashboard().control.username, std::string("visitor"));
    CHECK_EQ(boss.adminDashboard().control.connection, target);
    CHECK(sawText(visitor, "An admin is steering your flower"));

    // A second control while one runs: release first.
    seq = boss.adminDashboard().resultSeq;
    boss.adminControl(target, "visitor");
    CHECK(answered(h, boss, seq, all));
    CHECK_EQ(boss.adminDashboard().resultMessage,
             std::string("You are already controlling visitor. Release it first."));

    // The admin's input steers the visitor's flower, the visitor's own is
    // dropped, and the admin's own flower takes neither.
    steer(boss, 100, 1.0, 0.5, net::InputAttack);
    steer(visitor, 100, 0.0, 0.0);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 1.0, 0.01);
    CHECK_EQ(world.get<PlayerInput>(visitorBody).current.flags, net::InputAttack);
    CHECK_NEAR(world.get<PlayerInput>(bossBody).current.moveStrength, 0.0, 0.01);

    // The binary Release gives it back, and the visitor steers again.
    seq = boss.adminDashboard().resultSeq;
    boss.adminRelease();
    CHECK(answered(h, boss, seq, all));
    CHECK(boss.adminDashboard().resultOk);
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == bossNet; }));
    CHECK(!boss.controllingFlower());
    steer(visitor, 200, 1.0, -1.0);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 1.0, 0.01);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveAngle, -1.0, 0.01);
    CHECK(sawText(visitor, "Your flower is yours to steer again."));
}

TEST(the_controllers_view_holds_one_self_and_no_ghosts) {
    Harness h("dash-ghosts", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    const std::uint32_t bossNet = boss.view().self().netId;
    const std::uint32_t visitorNet = visitor.view().self().netId;
    const Entity bossBody = bodyWithNetId(world, bossNet);
    const Entity visitorBody = bodyWithNetId(world, visitorNet);
    if (bossBody == NULL_ENTITY || visitorBody == NULL_ENTITY) { CHECK(false); return; }
    protect(world, bossBody);
    protect(world, visitorBody);

    // Far enough apart that neither body is in the other's box: anything of
    // the old viewpoint still held after a switch is a ghost.
    const Vec2 from = world.get<Transform>(bossBody).position;
    world.get<Transform>(visitorBody).position =
        openPointWhere(h.server.terrain(), from, [&](Vec2 p) {
            return std::max(std::abs(p.x - from.x), std::abs(p.y - from.y)) >= 4500;
        });
    CHECK(h.stepUntil(all, [&] { return boss.view().entities().count(visitorNet) == 0; }));
    CHECK_EQ(selfFlagged(boss), 1);

    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == visitorNet; }));
    h.step(10, all);
    CHECK_EQ(selfFlagged(boss), 1);
    CHECK_EQ(boss.view().entities().count(bossNet), std::size_t{0});

    CHECK(say(h, boss, "/admin release", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == bossNet; }));
    h.step(10, all);
    CHECK_EQ(selfFlagged(boss), 1);
    CHECK_EQ(boss.view().entities().count(visitorNet), std::size_t{0});

    // The target leaving is a change of viewpoint too, and its body must not
    // be held after it.
    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == visitorNet; }));
    visitor.disconnect();
    CHECK(h.stepUntil({&boss}, [&] { return boss.view().self().netId == bossNet; }));
    h.step(10, {&boss});
    CHECK_EQ(selfFlagged(boss), 1);
    CHECK_EQ(boss.view().entities().count(visitorNet), std::size_t{0});
    CHECK(sawText(boss, "Control ended: visitor left the world."));
    CHECK(!boss.controllingFlower());
}

TEST(control_follows_the_targets_splitter_switch) {
    Harness h("dash-split", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    CHECK(say(h, boss, std::string("/admin give visitor ") + kSplitterPetalId + " common 1", all));
    CHECK(h.stepUntil(all, [&] { return visitor.profile().stackCount(splitter, Rarity::Common) > 0; }));
    visitor.setLoadoutSlot(0, splitter, Rarity::Common);
    CHECK(h.stepUntil(all, [&] { return bodiesOf(h, "visitor").size() == 2; }));
    for (const Entity half : bodiesOf(h, "visitor")) protect(world, half);

    const std::uint32_t steered = visitor.view().self().netId;
    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == steered; }));

    // Loaded on both halves, then the visitor switches. The control goes with
    // the switch: the admin is now steering the half the visitor moved into.
    CHECK(h.stepUntil(all, [&] {
        for (const Entity half : bodiesOf(h, "visitor")) {
            if (world.get<Loadout>(half).slots[0].broken) return false;
        }
        return true;
    }, 700));
    visitor.usePetal(0);
    CHECK(h.stepUntil(all, [&] {
        return visitor.view().self().netId != steered && visitor.view().self().netId != 0;
    }));
    const std::uint32_t active = visitor.view().self().netId;
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == active; }));
    h.step(5, all);
    CHECK_EQ(selfFlagged(boss), 1);

    // Whichever half they are in, the visitor's own input moves none of them,
    // and the admin's moves the one that is active now.
    const Entity activeBody = bodyWithNetId(world, active);
    if (activeBody == NULL_ENTITY) { CHECK(false); return; }
    steer(visitor, 900000, 1.0, 0.25);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(activeBody).current.moveStrength, 0.0, 0.01);
    steer(boss, 900000, 1.0, 0.25);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(activeBody).current.moveStrength, 1.0, 0.01);
}

TEST(control_ends_when_either_flower_dies) {
    Harness h("dash-death", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    const std::uint32_t bossNet = boss.view().self().netId;
    const Entity bossBody = bodyWithNetId(world, bossNet);
    Entity visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    if (bossBody == NULL_ENTITY || visitorBody == NULL_ENTITY) { CHECK(false); return; }
    protect(world, bossBody);

    // The steered flower dies: the admin is back on their own.
    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.controllingFlower(); }));
    kill(world, visitorBody);
    CHECK(h.stepUntil(all, [&] { return !boss.controllingFlower(); }));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == bossNet; }));
    CHECK(sawText(boss, "Control ended: visitor's flower died."));

    // A fresh body, taken again -- and this time the admin's own flower dies.
    visitor.requestRespawn();
    CHECK(h.stepUntil(all, [&] {
        const Entity body = bodyWithNetId(world, visitor.view().self().netId);
        return body != NULL_ENTITY && !world.has<Dead>(body);
    }));
    visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    protect(world, visitorBody);
    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.controllingFlower(); }));
    kill(world, bossBody);
    CHECK(h.stepUntil(all, [&] { return !boss.controllingFlower() && boss.dead(); }));
    CHECK(sawText(boss, "Control ended: your flower died."));
    CHECK_EQ(boss.view().self().netId, bossNet);
    // The visitor has their flower back.
    steer(visitor, 5000, 1.0, 1.0);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 1.0, 0.01);
}

TEST(control_ends_when_either_side_disconnects) {
    Harness h("dash-disconnect", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor", "carol"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor, carol;
    const std::vector<NetClient*> all{&boss, &visitor, &carol};
    CHECK(enterWorld(h, all, {"boss", "visitor", "carol"}, {"Boss", "Visitor", "Carol"}));
    World& world = h.server.world();
    const std::uint32_t bossNet = boss.view().self().netId;
    const Entity carolBody = bodyWithNetId(world, carol.view().self().netId);
    if (carolBody == NULL_ENTITY) { CHECK(false); return; }
    for (NetClient* client : all) protect(world, bodyWithNetId(world, client->view().self().netId));

    // The target goes.
    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.controllingFlower(); }));
    visitor.disconnect();
    CHECK(h.stepUntil({&boss, &carol}, [&] {
        return !boss.controllingFlower() && boss.view().self().netId == bossNet;
    }));

    // The admin goes: the flower they held answers its own player again.
    CHECK(say(h, boss, "/admin control carol", {&boss, &carol}));
    CHECK(h.stepUntil({&boss, &carol}, [&] { return boss.controllingFlower(); }));
    steer(carol, 300, 1.0, 0.0);
    h.step(2, {&boss, &carol});
    CHECK_NEAR(world.get<PlayerInput>(carolBody).current.moveStrength, 0.0, 0.01);
    boss.disconnect();
    h.step(5, {&carol});
    steer(carol, 301, 1.0, 0.0);
    h.step(2, {&carol});
    CHECK_NEAR(world.get<PlayerInput>(carolBody).current.moveStrength, 1.0, 0.01);
    CHECK(sawText(carol, "Your flower is yours to steer again."));
}

TEST(control_ends_when_the_target_takes_a_teleporter) {
    const std::string dir = twoMapDataDir("dashrealm");
    CHECK(!dir.empty());
    if (dir.empty()) return;
    Harness h("dash-realm", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dir, 0);
    if (!h.ready) { CHECK(false); removeDataDir(dir); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    const std::uint32_t bossNet = boss.view().self().netId;
    const Entity visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    const MapData* map = h.server.worldMaps().forRealm(Realm::Overworld);
    const MapElement* pad = nullptr;
    if (map != nullptr) {
        for (const MapElement& element : map->elements()) {
            if (element.kind == MapElementKind::Teleporter) pad = &element;
        }
    }
    if (visitorBody == NULL_ENTITY || pad == nullptr) {
        CHECK(false);
        removeDataDir(dir);
        return;
    }

    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == visitor.view().self().netId; }));
    // Held on the pad until it fires.
    world.get<Transform>(visitorBody).position = pad->centre();
    CHECK(h.stepUntil(all, [&] {
        return world.get<Transform>(visitorBody).realm != Realm::Overworld;
    }, 150));
    CHECK(h.stepUntil(all, [&] {
        return !boss.controllingFlower() && boss.view().self().netId == bossNet;
    }));
    CHECK(sawText(boss, "Control ended: you and visitor are in different realms now."));
    CHECK(boss.view().realm() == Realm::Overworld);
    removeDataDir(dir);
}

TEST(a_temporary_admin_cannot_take_a_full_admins_flower) {
    Harness h("dash-lent", [](const std::string& path) {
        seedUsers(path, {"boss", "helper", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, helper, visitor;
    const std::vector<NetClient*> all{&boss, &helper, &visitor};
    CHECK(enterWorld(h, all, {"boss", "helper", "visitor"}, {"Boss", "Helper", "Visitor"}));
    const std::uint32_t bossNet = boss.view().self().netId;
    const std::uint32_t helperNet = helper.view().self().netId;
    CHECK(say(h, boss, "/admin grant_admin helper", all));
    CHECK(h.stepUntil(all, [&] { return helper.isSkinAdmin(); }));

    // mute's line: a grant lent for one life does not reach the admin who
    // lent it, and the refusal says so in mute's words.
    CHECK(say(h, helper, "/admin control boss", all));
    CHECK(h.stepUntil(all, [&] {
        return sawText(helper, "boss is a full admin and cannot be controlled.");
    }));
    h.step(10, all);
    CHECK_EQ(helper.view().self().netId, helperNet);
    CHECK(!helper.controllingFlower());
    CHECK_EQ(boss.view().self().netId, bossNet);

    // Anybody else's flower the grant does reach.
    CHECK(say(h, helper, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] {
        return helper.view().self().netId == visitor.view().self().netId;
    }));
}

TEST(revoking_a_temporary_grant_ends_the_control_it_held) {
    Harness h("dash-revoke", [](const std::string& path) {
        seedUsers(path, {"boss", "helper", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, helper, visitor;
    const std::vector<NetClient*> all{&boss, &helper, &visitor};
    CHECK(enterWorld(h, all, {"boss", "helper", "visitor"}, {"Boss", "Helper", "Visitor"}));
    World& world = h.server.world();
    const std::uint32_t helperNet = helper.view().self().netId;
    const Entity visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    CHECK(say(h, boss, "/admin grant_admin helper", all));
    CHECK(h.stepUntil(all, [&] { return helper.isSkinAdmin(); }));
    CHECK(say(h, helper, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return helper.controllingFlower(); }));

    CHECK(say(h, boss, "/admin revoke_admin helper", all));
    CHECK(h.stepUntil(all, [&] {
        return !helper.controllingFlower() && helper.view().self().netId == helperNet;
    }));
    CHECK(sawText(helper, "Control ended: your temporary admin access ended."));
    steer(visitor, 400, 1.0, 0.0);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 1.0, 0.01);
}

TEST(each_side_keeps_its_own_viewport_claim) {
    Harness h("dash-viewport", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor", "carol"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor, carol;
    const std::vector<NetClient*> all{&boss, &visitor, &carol};
    // The admin's window is small, the steered player's large.
    CHECK(enterWorld(h, {&boss}, {"boss"}, {"Boss"}, 640, 360));
    CHECK(enterWorld(h, {&visitor, &carol}, {"visitor", "carol"}, {"Visitor", "Carol"}, 1600, 900));
    World& world = h.server.world();
    const Entity bossBody = bodyWithNetId(world, boss.view().self().netId);
    const Entity visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    const std::uint32_t carolNet = carol.view().self().netId;
    const Entity carolBody = bodyWithNetId(world, carolNet);
    if (bossBody == NULL_ENTITY || visitorBody == NULL_ENTITY || carolBody == NULL_ENTITY) {
        CHECK(false);
        return;
    }
    for (const Entity body : {bossBody, visitorBody, carolBody}) protect(world, body);

    CHECK(say(h, boss, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return boss.view().self().netId == visitor.view().self().netId; }));
    net::InputFrame small;
    small.sequence = 50;
    small.viewportWidth = 640;
    small.viewportHeight = 360;
    boss.sendInput(small);
    net::InputFrame large;
    large.sequence = 60;
    large.viewportWidth = 1600;
    large.viewportHeight = 900;
    visitor.sendInput(large);
    h.step(3, all);
    // Each claim on its own body.
    CHECK_NEAR(world.get<PlayerLocation>(visitorBody).viewport.x, 1600.0, 0.5);
    CHECK_NEAR(world.get<PlayerLocation>(visitorBody).viewport.y, 900.0, 0.5);
    CHECK_NEAR(world.get<PlayerLocation>(bossBody).viewport.x, 640.0, 0.5);
    CHECK_NEAR(world.get<PlayerLocation>(bossBody).viewport.y, 360.0, 0.5);

    // And each stream culled to its own claim, around the visitor's flower:
    // half the window plus a margin of 1.5 windows (Replicator::viewportReach)
    // per axis -- 1280 x 720 for the admin's, 3200 x 1800 for the visitor's.
    // Carol stands where only the larger box reaches.
    const Vec2 at = world.get<Transform>(visitorBody).position;
    const Vec2 spot = openPointWhere(h.server.terrain(), at, [&](Vec2 p) {
        const double dx = std::abs(p.x - at.x);
        const double dy = std::abs(p.y - at.y);
        const bool outsideAdmin = dx >= 1280.0 + 200.0 || dy >= 720.0 + 200.0;
        const bool insideVisitor = dx < 3200.0 - 200.0 && dy < 1800.0 - 200.0;
        return outsideAdmin && insideVisitor;
    });
    world.get<Transform>(carolBody).position = spot;
    CHECK(h.stepUntil(all, [&] { return visitor.view().entities().count(carolNet) == 1; }));
    h.step(5, all);
    CHECK_EQ(visitor.view().entities().count(carolNet), std::size_t{1});
    CHECK_EQ(boss.view().entities().count(carolNet), std::size_t{0});
}

TEST(release_with_nothing_to_release_changes_nothing) {
    Harness h("dash-release", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    const std::uint32_t bossNet = boss.view().self().netId;
    Vec2 arrival;
    while (boss.takeRealmChange(arrival)) {}

    // By the console...
    CHECK(say(h, boss, "/admin release", all));
    CHECK(sawText(boss, "You are not controlling a flower."));
    // ...and by the panel, which is told the same and that it did not work.
    const std::uint32_t seq = boss.adminDashboard().resultSeq;
    boss.adminRelease();
    CHECK(answered(h, boss, seq, all));
    CHECK(!boss.adminDashboard().resultOk);
    CHECK_EQ(boss.adminDashboard().resultMessage, std::string("You are not controlling a flower."));
    h.step(5, all);
    // Nothing restated: no view reset, the same self, everything still held.
    CHECK(!boss.takeRealmChange(arrival));
    CHECK_EQ(boss.view().self().netId, bossNet);
    CHECK_EQ(boss.view().entities().count(visitor.view().self().netId), std::size_t{1});
}

TEST(signing_in_as_another_account_ends_the_grant_and_the_control) {
    Harness h("dash-switch", [](const std::string& path) {
        seedUsers(path, {"boss", "helper", "visitor", "other"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, helper, visitor;
    const std::vector<NetClient*> all{&boss, &helper, &visitor};
    CHECK(enterWorld(h, all, {"boss", "helper", "visitor"}, {"Boss", "Helper", "Visitor"}));
    World& world = h.server.world();
    const Entity visitorBody = bodyWithNetId(world, visitor.view().self().netId);
    CHECK(say(h, boss, "/admin grant_admin helper", all));
    CHECK(h.stepUntil(all, [&] { return helper.isSkinAdmin(); }));
    CHECK(say(h, helper, "/admin control visitor", all));
    CHECK(h.stepUntil(all, [&] { return helper.controllingFlower(); }));

    // The same socket signs in as somebody else. The grant was lent to the
    // person, for one life; the account now on the socket never had it.
    // The flag is cleared first: the sign-in that brought helper into the
    // world raised it, and nothing else lowers it, so a wait on it as it
    // stood returned on the first tick whatever became of this login.
    helper.authAnswered = false;
    helper.requestLogin("other", kPassword);
    CHECK(h.stepUntil(all, [&] { return helper.authAnswered; }));
    CHECK_EQ(static_cast<int>(helper.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(helper.profile().username, std::string("other"));
    CHECK(helper.status() == NetClient::Status::LoggedIn);
    h.step(5, all);
    CHECK(say(h, boss, "/admin list_admins", all));
    CHECK(sawText(boss, "No temporary admin grants are active."));
    CHECK(say(h, helper, "/admin save", all));
    CHECK(sawText(helper, "Command does not exist."));
    // And the flower it was steering answers its own player again.
    steer(visitor, 700, 1.0, 0.0);
    h.step(2, all);
    CHECK_NEAR(world.get<PlayerInput>(visitorBody).current.moveStrength, 1.0, 0.01);
}

TEST(the_announce_gate_its_byte_cap_and_its_chat_budget) {
    // The Admin channel is the one line every connected client raises a banner
    // for, so it is the server's own voice: the database flag may use it, a
    // console lent for one life may not, a player is not told it exists, and
    // what goes out is signed with the account that sent it rather than with
    // a name written into the server.
    Harness h("dash-announce", [](const std::string& path) {
        seedUsers(path, {"boss", "helper", "player"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, helper, player;
    const std::vector<NetClient*> all{&boss, &helper, &player};
    CHECK(enterWorld(h, all, {"boss", "helper", "player"}, {"Boss", "Helper", "Player"}));

    const auto adminLines = [](const NetClient& client) {
        int count = 0;
        for (const ChatLine& line : client.chat()) {
            if (line.channel == net::ChatChannel::Admin) ++count;
        }
        return count;
    };

    CHECK(say(h, player, "/admin announce hello", all));
    CHECK(sawText(player, "Command does not exist."));

    CHECK(say(h, boss, "/admin grant_admin helper", all));
    CHECK(h.stepUntil(all, [&] { return helper.isSkinAdmin(); }));
    CHECK(say(h, helper, "/admin announce hello", all));
    CHECK(sawText(helper, "Only a full admin can send announcements."));
    h.step(10, all);
    CHECK_EQ(adminLines(boss), 0);
    CHECK_EQ(adminLines(player), 0);
    CHECK(player.adminAnnouncement().text.empty());

    boss.sendChat("/admin announce Doors open at noon");
    CHECK(h.stepUntil(all, [&] { return player.adminAnnouncement().text == "Doors open at noon"; }));
    CHECK_EQ(player.adminAnnouncement().author, std::string("boss"));
    CHECK(player.adminAnnouncement().sequence > 0);

    // The cap is the shared one, to the byte: exactly the cap goes out, one
    // more is refused.
    const std::size_t cap = net::kMaxAnnouncementBytes;
    CHECK(say(h, boss, "/admin announce " + std::string(cap + 1, 'x'), all));
    CHECK(sawText(boss, "Announcements can contain up to " + std::to_string(cap) + " bytes."));
    boss.sendChat("/admin announce " + std::string(cap, 'y'));
    CHECK(h.stepUntil(all, [&] { return player.adminAnnouncement().text == std::string(cap, 'y'); }));
    CHECK(say(h, boss, "/admin announce", all));
    CHECK(sawText(boss, "Write a message after announce."));

    // Refused like any other line with a blocked word in it: a full admin's
    // reaches the same players. Not billed, as a refusal above it is not.
    CHECK(say(h, boss, "/admin announce Doors open, you shit", all));
    CHECK(sawText(boss, "Announcement not sent: it contains a word that is not allowed in chat."));
    h.step(10, all);
    CHECK(player.adminAnnouncement().text != "Doors open, you shit");

    // Billed as a line said to everyone: a burst runs dry.
    const int beforeBurst = adminLines(player);
    for (int i = 0; i < 6; ++i) boss.sendChat("/admin announce burst " + std::to_string(i));
    h.step(10, all);
    CHECK(sawText(boss, "You are sending messages too quickly."));
    CHECK(adminLines(player) - beforeBurst < 6);
}

TEST(closing_every_menu_closes_the_dashboard) {
    // App::leaveToTitle and App::showLoggedOut both call close(), and a
    // dashboard that outlived it went on eating every key on the next screen.
    MenuSystem menus;
    menus.toggle(MenuId::AdminDashboard);
    CHECK(menus.anyOpen());
    CHECK(menus.open() == MenuId::AdminDashboard);
    menus.close();
    CHECK(!menus.anyOpen());
}

TEST(a_connection_that_is_another_account_now_is_refused_under_the_old_name) {
    // A connection id is not a person. Log Out keeps the socket, so the next
    // account to sign in on it inherits the id the panel picked the last one
    // by -- and every restarted server deals its ids out from 1 again. Asked
    // by id alone, the server showed the new account's bag under the old
    // name and handed over the new account's flower. The row's account name
    // rides with the id, and a connection that holds another is refused as
    // one that has left.
    Harness h("dash-reused-id", [](const std::string& path) {
        seedUsers(path, {"boss", "alice", "bob"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, target;
    const std::vector<NetClient*> all{&boss, &target};
    CHECK(enterWorld(h, all, {"boss", "alice"}, {"Boss", "Alice"}));
    World& world = h.server.world();
    protect(world, bodyWithNetId(world, boss.view().self().netId));
    const net::ConnectionId id = listed(h, boss, "alice", all);
    CHECK(id != 0);

    // alice goes; bob signs in on the very same socket, and walks in.
    target.logout();
    h.step(3, all);
    target.authAnswered = false;
    target.requestLogin("bob", kPassword);
    CHECK(h.stepUntil(all, [&] { return target.authAnswered; }));
    CHECK_EQ(static_cast<int>(target.authStatus), static_cast<int>(net::AuthStatus::Ok));
    target.joinGame(1000, 800, {}, "Bob");
    CHECK(h.stepUntil(all, [&] {
        return target.status() == NetClient::Status::Playing && target.selfPlaced();
    }));
    protect(world, bodyWithNetId(world, target.view().self().netId));

    // The id the panel holds, under the name it was picked as: neither bob's
    // bag nor bob's flower.
    boss.adminDashboardInventory(id, "alice", 0);
    CHECK(h.stepUntil(all, [&] { return !boss.adminDashboard().bagPending; }));
    CHECK(boss.adminDashboard().bagGone);
    CHECK(boss.adminDashboard().bag.empty());
    CHECK(boss.adminDashboard().bagUsername.empty());
    std::uint32_t seq = boss.adminDashboard().resultSeq;
    boss.adminControl(id, "alice");
    CHECK(answered(h, boss, seq, all));
    CHECK(!boss.adminDashboard().resultOk);
    CHECK_EQ(boss.adminDashboard().resultMessage, std::string("That player has left."));
    h.step(5, all);
    CHECK(!boss.controllingFlower());
    CHECK(!sawText(target, "An admin is steering your flower"));

    // The list says whose the id is now, and under that name it is bob's.
    CHECK_EQ(listed(h, boss, "bob", all), id);
    seq = boss.adminDashboard().resultSeq;
    boss.adminControl(id, "bob");
    CHECK(answered(h, boss, seq, all));
    CHECK(boss.adminDashboard().resultOk);
    CHECK(h.stepUntil(all, [&] { return boss.controllingFlower(); }));
    CHECK_EQ(boss.adminDashboard().control.username, std::string("bob"));
}

TEST(the_dashboard_state_lets_go_of_its_ids_when_the_connection_or_the_account_goes) {
    // The panel holds its pick across frames, and stays open through a drop
    // and the redial after it, so what it was given has to say when it stops
    // being true: every wipe of the client's dashboard state moves a
    // generation the panel compares against, and lets go of its pick when it
    // moves. Here, the wipes themselves -- another account signed in on the
    // socket, and the socket dropped.
    Harness h("dash-generation", [](const std::string& path) {
        seedUsers(path, {"boss", "deputy", "visitor"}, {"boss", "deputy"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    CHECK(listed(h, boss, "visitor", all) != 0);
    CHECK(!boss.adminDashboard().players.empty());
    const std::uint32_t first = boss.adminDashboard().generation;

    // The same account again is not a change of anything...
    boss.authAnswered = false;
    boss.resumeSession(boss.sessionToken());
    CHECK(h.stepUntil(all, [&] { return boss.authAnswered; }));
    CHECK_EQ(boss.adminDashboard().generation, first);

    // ...another one is: the ids it held were asked for by the last account.
    CHECK(listed(h, boss, "visitor", all) != 0);
    boss.authAnswered = false;
    boss.requestLogin("deputy", kPassword);
    CHECK(h.stepUntil(all, [&] { return boss.authAnswered; }));
    CHECK_EQ(static_cast<int>(boss.authStatus), static_cast<int>(net::AuthStatus::Ok));
    const std::uint32_t second = boss.adminDashboard().generation;
    CHECK(second != first);
    CHECK(boss.adminDashboard().players.empty());

    // And a dropped socket is one, whatever comes back after it. (A second
    // Hello is a way to make the server close it from here.)
    CHECK(listed(h, boss, "visitor", all) != 0);
    net::Connection unused(-1, 0, std::string());
    boss.onConnect(unused);
    CHECK(h.stepUntil(all, [&] { return boss.status() == NetClient::Status::Failed; }));
    CHECK(boss.adminDashboard().generation != second);
    CHECK(boss.adminDashboard().players.empty());
}

TEST(dashboard_requests_are_billed_like_the_console_commands_they_stand_in_for) {
    // The console's road to control spends from the command allowance; the
    // panel's binary road spent nothing. A temporary grantee could alternate
    // Control and Release as fast as frames go out, and every pair put two
    // System lines in the target's chat -- a whole transcript replaced in one
    // burst -- and two in the server log. Every op is billed now, a page too,
    // and refused with the console's own notice once the budget is gone.
    Harness h("dash-billed", [](const std::string& path) {
        seedUsers(path, {"boss", "helper", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, helper, visitor;
    const std::vector<NetClient*> all{&boss, &helper, &visitor};
    CHECK(enterWorld(h, all, {"boss", "helper", "visitor"}, {"Boss", "Helper", "Visitor"}));
    World& world = h.server.world();
    for (NetClient* client : all) protect(world, bodyWithNetId(world, client->view().self().netId));
    CHECK(say(h, boss, "/admin grant_admin helper", all));
    CHECK(h.stepUntil(all, [&] { return helper.isSkinAdmin(); }));
    const net::ConnectionId id = listed(h, helper, "visitor", all);
    CHECK(id != 0);

    const auto steeringNotices = [&] {
        int n = 0;
        for (const ChatLine& line : visitor.chat()) {
            if (line.text.find("An admin is steering your flower") != std::string::npos ||
                line.text.find("Your flower is yours to steer again.") != std::string::npos) {
                ++n;
            }
        }
        return n;
    };

    // A hundred pairs in one burst: what gets through is the budget's worth.
    for (int i = 0; i < 100; ++i) {
        helper.adminControl(id, "visitor");
        helper.adminRelease();
    }
    h.step(10, all);
    const int notices = steeringNotices();
    CHECK(notices > 0);
    CHECK(notices <= 12);
    CHECK(sawText(helper, "You are sending commands too quickly."));
    CHECK(!helper.adminDashboard().resultOk);
    CHECK_EQ(helper.adminDashboard().resultMessage,
             std::string("You are sending commands too quickly."));

    // A refused page is let go of, not left loading: its Load more row would
    // otherwise never ask again.
    helper.adminDashboardPlayers("", 0);
    CHECK(h.stepUntil(all, [&] { return !helper.adminDashboard().playersPending; }));
    CHECK(helper.adminDashboard().playersRefused);

    // And the budget comes back as the console's does, at two a second.
    h.step(60, all);
    helper.adminDashboardPlayers("", 0);
    CHECK(h.stepUntil(all, [&] { return !helper.adminDashboard().playersPending; }));
    CHECK(!helper.adminDashboard().playersRefused);
    CHECK(!helper.adminDashboard().players.empty());
}

TEST(admin_cursor_drags_mobs_and_ignores_retired_remove_requests) {
    Harness h("admin-cursor", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    Session* session = GameServerPeer::sessionOf(h.server, "boss");
    CHECK(session != nullptr);
    if (!session) return;
    const Entity owner = session->entity;
    protect(world, owner);
    world.get<Loadout>(owner).slots[0] = LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    const Vec2 origin = world.get<Transform>(owner).position;
    const Realm realm = world.get<Transform>(owner).realm;
    const auto makeTarget = [&](Vec2 at, Realm where) {
        const Entity e = world.create();
        Transform t;
        t.position = at;
        t.realm = where;
        world.add<Transform>(e, t);
        world.add<Body>(e, Body{25, 1000000}); // Anchored mass cannot resist a drag.
        world.add<Motion>(e);
        world.add<MobTag>(e);
        return e;
    };
    const Entity mob = makeTarget(origin + Vec2{200, 0}, realm);
    const Entity elsewhere = makeTarget(origin + Vec2{200, 0},
        realm == Realm::Overworld ? Realm::Arena : Realm::Overworld);
    std::uint32_t seq = 0;
    const auto point = [&](double dist, std::uint8_t flags, double angle = 0.0) {
        net::InputFrame frame;
        frame.sequence = ++seq;
        frame.aimDistance = static_cast<std::uint16_t>(dist);
        frame.flags = flags;
        frame.aimAngle = angle;
        boss.sendInput(frame);
        h.step(2, all);
    };
    point(200, net::InputAdminDrag);
    CHECK_EQ(session->cursorDragged, mob);
    point(350, net::InputAdminDrag);
    CHECK_NEAR(world.get<Transform>(mob).position.x, origin.x + 350, 2.0);
    CHECK(world.get<Transform>(elsewhere).realm != realm);
    point(350, 0);
    point(500, 0);
    CHECK_EQ(session->cursorDragged, NULL_ENTITY);
    CHECK_NEAR(world.get<Transform>(mob).position.x, origin.x + 350, 2.0);

    // Unequipping and lost privileges revoke an existing grab immediately.
    point(350, net::InputAdminDrag);
    CHECK_EQ(session->cursorDragged, mob);
    world.get<Loadout>(owner).slots[0] = LoadoutSlot{};
    point(400, net::InputAdminDrag);
    CHECK_EQ(session->cursorDragged, NULL_ENTITY);
    world.get<Loadout>(owner).slots[0] = LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    session->admin = false;
    point(350, 0);
    point(350, net::InputAdminDrag);
    CHECK_EQ(session->cursorDragged, NULL_ENTITY);
    session->admin = true;
    point(350, 0);

    const Entity drop = world.create();
    Transform dropped;
    dropped.position = origin + Vec2{200, 0};
    dropped.realm = realm;
    world.add<Transform>(drop, dropped);
    world.add<DropTag>(drop);
    const auto xpBefore = world.get<PlayerProgress>(owner).totalXp;
    // A modified client sending the new flags still cannot edit the world.
    session->admin = false;
    point(200, std::uint8_t{1 << 3});
    CHECK(world.isAlive(drop));
    session->admin = true;
    point(200, 0);
    world.get<Loadout>(owner).slots[0].rarity = Rarity::Universal;
    point(200, std::uint8_t{1 << 3});
    CHECK(world.isAlive(drop));
    world.get<Loadout>(owner).slots[0].rarity = Rarity::Admin;
    point(200, 0);
    point(200, std::uint8_t{1 << 3});
    CHECK(world.isAlive(drop));
    CHECK(world.isAlive(mob)); // Cursor gestures cannot remove entities.
    CHECK_EQ(world.get<PlayerProgress>(owner).totalXp, xpBefore);
    point(0, 0);

    CHECK(say(h, boss, "/admin spawn_npc oracle common"));
    Entity oracle = NULL_ENTITY;
    Query<NpcTag, Transform> npcs{world};
    npcs.each([&](Entity e, NpcTag&, Transform& t) {
        if (t.realm == realm && distanceSq(t.position, origin) < 100.0) oracle = e;
    });
    CHECK(oracle != NULL_ENTITY);
    const Vec2 toOracle = world.get<Transform>(oracle).position - world.get<Transform>(owner).position;
    point(toOracle.length(), std::uint8_t{1 << 3}, toOracle.angle());
    CHECK(world.isAlive(oracle));
    CHECK(world.isAlive(owner));
}

TEST(admin_cursor_drags_non_admin_players_with_finite_release_protection) {
    Harness h("cursor-player", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor", "helper"}, {"boss", "helper"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor, helper;
    const std::vector<NetClient*> all{&boss, &visitor, &helper};
    CHECK(enterWorld(h, all, {"boss", "visitor", "helper"}, {"Boss", "Visitor", "Helper"}));
    World& world = h.server.world();
    Session* owner = GameServerPeer::sessionOf(h.server, "boss");
    Session* target = GameServerPeer::sessionOf(h.server, "visitor");
    Session* admin = GameServerPeer::sessionOf(h.server, "helper");
    if (!owner || !target || !admin) { CHECK(false); return; }
    const Entity player = target->entity;
    const Entity adminBody = admin->entity;
    const Realm realm = world.get<Transform>(owner->entity).realm;
    const Vec2 origin = openPointWhere(h.server.terrain(), world.get<Transform>(owner->entity).position,
        [&](Vec2 p) { return !h.server.terrain().blocked(p + Vec2{200, 0}, realm) &&
                            !h.server.terrain().blocked(p + Vec2{350, 0}, realm) &&
                            !h.server.terrain().blocked(p + Vec2{450, 0}, realm); });
    world.get<Transform>(owner->entity).position = origin;
    world.get<Transform>(player).position = origin + Vec2{200, 0};
    world.get<Transform>(adminBody).position = origin + Vec2{450, 0};
    world.get<Loadout>(owner->entity).slots[0] =
        LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    world.get<Health>(player).invulnerableUntilMillis = 0;
    world.get<Health>(player).hitCooldownUntilMillis = 0;
    protect(world, owner->entity);
    protect(world, adminBody);
    std::uint32_t sequence = 0;
    const auto point = [&](Vec2 position, bool held) {
        const Vec2 offset = position - world.get<Transform>(owner->entity).position;
        net::InputFrame input;
        input.sequence = ++sequence;
        input.aimAngle = offset.angle();
        input.aimDistance = static_cast<std::uint16_t>(std::round(offset.length()));
        input.flags = held ? net::InputAdminDrag : 0;
        boss.sendInput(input);
        h.step(2, all);
    };
    point(world.get<Transform>(adminBody).position, true);
    CHECK(owner->cursorDragged != adminBody);
    point(origin, false);
    // A covering mob is nearer the pointer's centre, but a player wins.
    const Entity covering = world.create();
    const Vec2 coveredPointer = world.get<Transform>(player).position + Vec2{10, 0};
    world.add<Transform>(covering, Transform{coveredPointer, 0, realm});
    world.add<Body>(covering, Body{200, 1000000});
    world.add<MobTag>(covering);
    point(coveredPointer, true);
    CHECK_EQ(owner->cursorDragged, player);
    point(origin + Vec2{350, 0}, true);
    const Vec2 moved = world.get<Transform>(player).position;
    CHECK(distance(moved, origin + Vec2{350, 0}) < 3.0);
    CHECK(!h.server.terrain().blocked(moved, realm));
    CHECK(world.get<Health>(player).shielded(h.clock));

    const Entity enemy = world.create();
    world.add<Faction>(enemy, Faction{Team::Hostiles, false});
    CombatSystem combat;
    const double health = world.get<Health>(player).current;
    CHECK(combat.applyDamage(world, player, enemy, 10, h.clock).refused);
    CHECK_NEAR(world.get<Health>(player).current, health, 0.01);
    point(moved, false);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY);
    CHECK(world.get<Health>(player).shielded(h.clock));
    h.step(100, all);
    CHECK(!world.get<Health>(player).shielded(h.clock));
    CHECK(!combat.applyDamage(world, player, enemy, 1, h.clock).refused);

    // Promotion ends a grab and protects the player on subsequent attempts.
    point(world.get<Transform>(player).position, true);
    CHECK_EQ(owner->cursorDragged, player);
    target->admin = true;
    h.step(2, all);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY);
    target->admin = false;
    point(origin, false);
    point(world.get<Transform>(player).position, true);
    CHECK_EQ(owner->cursorDragged, player);
    world.get<Transform>(player).realm = Realm::Arena;
    h.step(2, all);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY);
    world.get<Transform>(player).realm = realm;
    world.get<Transform>(player).position = moved;
    point(origin, false);
    point(world.get<Transform>(player).position, true);
    CHECK_EQ(owner->cursorDragged, player);
    world.get<Loadout>(owner->entity).slots[0] = LoadoutSlot{};
    h.step(2, all);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY);
    CHECK(std::isfinite(world.get<Health>(player).invulnerableUntilMillis));

    world.get<Loadout>(owner->entity).slots[0] =
        LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    point(origin, false);
    point(world.get<Transform>(player).position, true);
    CHECK_EQ(owner->cursorDragged, player);
    world.get<Transform>(owner->entity).realm = Realm::Arena;
    world.get<Transform>(player).realm = Realm::Arena;
    h.step(2, all);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY); // Even when both change realm.
    world.get<Transform>(owner->entity).realm = realm;
    world.get<Transform>(owner->entity).position = origin;
    world.get<Transform>(player).realm = realm;
    world.get<Transform>(player).position = moved;
    point(moved, true);
    CHECK_EQ(owner->cursorDragged, NULL_ENTITY); // Must release before re-grabbing.
    point(moved, false);
    point(moved, true);
    CHECK_EQ(owner->cursorDragged, player);
    boss.disconnect();
    h.step(110, {&visitor, &helper});
    CHECK(GameServerPeer::sessionOf(h.server, "boss") == nullptr);
    CHECK(world.isAlive(player));
    CHECK(world.get<Health>(player).invulnerableUntilMillis < h.clock);
}

TEST(admin_hover_kill_checks_cursor_authority_targets_and_key_edges) {
    Harness h("admin-hover-kill", [](const std::string& path) {
        seedUsers(path, {"boss", "visitor"}, {"boss"});
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    const std::vector<NetClient*> all{&boss, &visitor};
    CHECK(enterWorld(h, all, {"boss", "visitor"}, {"Boss", "Visitor"}));
    World& world = h.server.world();
    Session* admin = GameServerPeer::sessionOf(h.server, "boss");
    Session* player = GameServerPeer::sessionOf(h.server, "visitor");
    CHECK(admin && player);
    if (!admin || !player) return;
    protect(world, admin->entity);
    protect(world, player->entity);
    const Vec2 origin = world.get<Transform>(admin->entity).position;
    const Realm realm = world.get<Transform>(admin->entity).realm;
    const auto makeMob = [&](Vec2 at, Realm where) {
        Entity e = world.create();
        world.add<Transform>(e, Transform{at, 0.0, where});
        world.add<Body>(e, Body{25, 1000000});
        world.add<MobTag>(e);
        return e;
    };
    const Entity mob = makeMob(origin + Vec2{200, 0}, realm);
    const Entity second = makeMob(origin + Vec2{200, 0}, realm);
    const Entity elsewhere = makeMob(origin + Vec2{200, 0}, realm == Realm::Maze ? Realm::Overworld : Realm::Maze);
    const Entity pet = makeMob(origin + Vec2{300, 0}, realm);
    world.add<Pet>(pet);
    const Entity npc = makeMob(origin + Vec2{350, 0}, realm);
    world.add<NpcTag>(npc);
    std::uint32_t sequence = 0;
    const auto point = [&](double distance, std::uint8_t flags) {
        net::InputFrame input;
        input.sequence = ++sequence;
        input.aimDistance = static_cast<std::uint16_t>(distance);
        input.flags = flags;
        boss.sendInput(input);
        h.step(2, all);
    };
    const double xp = world.get<PlayerProgress>(admin->entity).totalXp;
    point(200, net::InputAdminKill); // No Admin Cursor equipped.
    CHECK(world.isAlive(mob));
    point(200, 0);
    world.get<Loadout>(admin->entity).slots[0] = LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    admin->admin = false;
    point(200, net::InputAdminKill);
    CHECK(world.isAlive(mob));
    CHECK(world.isAlive(second));
    admin->admin = true;
    point(200, net::InputAdminKill); // Promotion while held is not a new press.
    CHECK(world.isAlive(mob));
    point(200, 0);
    point(200, net::InputAdminKill);
    CHECK_EQ(int(world.isAlive(mob)) + int(world.isAlive(second)), 1);
    h.step(30, all);
    point(200, net::InputAdminKill);
    CHECK_EQ(int(world.isAlive(mob)) + int(world.isAlive(second)), 1);
    point(200, 0);
    point(200, net::InputAdminKill);
    CHECK(!world.isAlive(mob));
    CHECK(!world.isAlive(second));
    CHECK(world.isAlive(elsewhere));
    for (const double distance : {300.0, 350.0}) {
        point(distance, 0);
        h.step(8, all);
        point(distance, net::InputAdminKill);
    }
    CHECK(!world.isAlive(pet));
    CHECK(world.isAlive(npc));
    CHECK(world.isAlive(player->entity));
    world.get<Transform>(player->entity).position = origin + Vec2{400, 0};
    player->admin = true;
    point(400, 0);
    h.step(8, all);
    point(400, net::InputAdminKill);
    CHECK(!world.has<Dead>(player->entity));
    player->admin = false;
    point(400, 0);
    h.step(8, all);
    point(400, net::InputAdminKill);
    CHECK(world.has<Dead>(player->entity));
    CHECK_EQ(world.get<Health>(player->entity).current, 0.0);
    CHECK(h.stepUntil(all, [&] { return visitor.dead(); }));
    CHECK_EQ(world.get<PlayerProgress>(admin->entity).totalXp, xp);
}

TEST(owner_cursor_preempts_lower_grabs_and_can_drag_admins_but_not_owners) {
    Harness h("owner-cursor-priority", [](const std::string& path) {
        seedUser(path, "owner", kPassword, true, kOwnerAdminTier);
        seedUser(path, "peer", kPassword, true, kOwnerAdminTier);
        seedUser(path, "helper", kPassword, true);
        seedUser(path, "visitor", kPassword);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient owner, peer, helper, visitor;
    const std::vector<NetClient*> all{&owner, &peer, &helper, &visitor};
    CHECK(enterWorld(h, all, {"owner", "peer", "helper", "visitor"}, {"Owner", "Peer", "Helper", "Visitor"}));
    World& world = h.server.world();
    Session* boss = GameServerPeer::sessionOf(h.server, "owner");
    Session* equal = GameServerPeer::sessionOf(h.server, "peer");
    Session* lower = GameServerPeer::sessionOf(h.server, "helper");
    Session* target = GameServerPeer::sessionOf(h.server, "visitor");
    if (!boss || !equal || !lower || !target) { CHECK(false); return; }
    const Realm realm = world.get<Transform>(boss->entity).realm;
    const Vec2 base = openPointWhere(h.server.terrain(), world.get<Transform>(boss->entity).position,
        [&](Vec2 p) { return !h.server.terrain().blocked(p + Vec2{200, 0}, realm) &&
                            !h.server.terrain().blocked(p + Vec2{300, 0}, realm); });
    world.get<Transform>(boss->entity).position = base;
    world.get<Transform>(equal->entity).position = base + Vec2{0, -100};
    world.get<Transform>(lower->entity).position = base + Vec2{0, 100};
    world.get<Transform>(target->entity).position = base + Vec2{200, 0};
    for (Session* session : {boss, equal, lower, target}) protect(world, session->entity);
    for (Session* session : {boss, equal, lower})
        world.get<Loadout>(session->entity).slots[0] =
            LoadoutSlot{content().petalIndex("cursor"), Rarity::Admin, 0, false};
    std::uint32_t ownerSeq = 0, peerSeq = 0, helperSeq = 0;
    const auto point = [&](NetClient& client, Session* session, std::uint32_t& sequence, Vec2 at, bool held) {
        const Vec2 delta = at - world.get<Transform>(session->entity).position;
        net::InputFrame input;
        input.sequence = ++sequence;
        input.aimAngle = delta.angle();
        input.aimDistance = static_cast<std::uint16_t>(std::round(delta.length()));
        input.flags = held ? net::InputAdminDrag : 0;
        client.sendInput(input);
        h.step(2, all);
    };
    Entity mob = world.create();
    world.add<Transform>(mob, Transform{base + Vec2{300, 0}, 0, realm});
    world.add<Body>(mob, Body{25, 1000000});
    world.add<MobTag>(mob);
    point(helper, lower, helperSeq, base + Vec2{300, 0}, true);
    CHECK_EQ(lower->cursorDragged, mob);
    point(owner, boss, ownerSeq, base + Vec2{300, 0}, true);
    CHECK_EQ(boss->cursorDragged, mob);
    CHECK_EQ(lower->cursorDragged, NULL_ENTITY);
    point(peer, equal, peerSeq, base + Vec2{300, 0}, true);
    CHECK(equal->cursorDragged != mob); // Equal owners cannot steal a grab.
    point(helper, lower, helperSeq, base, false);
    point(helper, lower, helperSeq, base + Vec2{300, 0}, true);
    CHECK(lower->cursorDragged != mob);
    point(owner, boss, ownerSeq, base, false);
    h.step(2, all);
    CHECK_EQ(lower->cursorDragged, NULL_ENTITY); // Must release and press again.
    point(helper, lower, helperSeq, base, false);
    point(helper, lower, helperSeq, base + Vec2{300, 0}, true);
    CHECK_EQ(lower->cursorDragged, mob);

    // Taking an admin also releases whatever they were holding.
    point(owner, boss, ownerSeq, world.get<Transform>(lower->entity).position, true);
    CHECK_EQ(boss->cursorDragged, lower->entity);
    CHECK_EQ(lower->cursorDragged, NULL_ENTITY);
    point(owner, boss, ownerSeq, base + Vec2{200, 0}, true);
    CHECK(distance(world.get<Transform>(lower->entity).position, base + Vec2{200, 0}) < 3.0);
    point(owner, boss, ownerSeq, base, false);
    point(owner, boss, ownerSeq, world.get<Transform>(equal->entity).position, true);
    CHECK(boss->cursorDragged != equal->entity);
    point(owner, boss, ownerSeq, base, false);
    point(peer, equal, peerSeq, base, false);
    point(peer, equal, peerSeq, world.get<Transform>(boss->entity).position, true);
    CHECK(equal->cursorDragged != boss->entity);
    point(helper, lower, helperSeq, base, false);
    point(helper, lower, helperSeq, world.get<Transform>(boss->entity).position, true);
    CHECK(lower->cursorDragged != boss->entity);

    CHECK(say(h, helper, "/admin control owner"));
    CHECK_EQ(boss->controlledBy, net::ConnectionId(0));
    CHECK_EQ(lower->controlling, net::ConnectionId(0));
    CHECK(say(h, peer, "/admin control owner"));
    CHECK_EQ(boss->controlledBy, net::ConnectionId(0));
    CHECK_EQ(equal->controlling, net::ConnectionId(0));

    // Owner grabbing breaks a lower admin's existing flower control safely.
    world.get<Transform>(target->entity).position = base + Vec2{300, 0};
    CHECK(say(h, helper, "/admin control visitor"));
    CHECK_EQ(lower->controlling, target->connection);
    point(owner, boss, ownerSeq, world.get<Transform>(target->entity).position, true);
    CHECK_EQ(boss->cursorDragged, target->entity);
    CHECK_EQ(lower->controlling, net::ConnectionId(0));
    CHECK_EQ(target->controlledBy, net::ConnectionId(0));
    point(owner, boss, ownerSeq, base, false);

    // The built-in Owner flag, rather than the account name, grants this.
    point(owner, boss, ownerSeq, base, false);
    point(owner, boss, ownerSeq, world.get<Transform>(lower->entity).position, true);
    CHECK_EQ(boss->cursorDragged, lower->entity);
    boss->adminTier = kTopAdminTier;
    h.step(2, all);
    CHECK_EQ(boss->cursorDragged, NULL_ENTITY);
}
