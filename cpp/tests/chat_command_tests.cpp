// The chat command surface, end to end over loopback.
//
// The bug these exist to keep fixed: handleChat used to sanitise a line and
// broadcast it, so every command the client offers in its autocomplete --
// "/help", "/admin spawn ..." -- reached the world as ordinary chat. The first
// test here is that one directly; the rest cover the commands that change
// server state, which are the ones a silent regression would hide.

#include "test.h"

#include <utime.h>

#include <cmath>
#include <ctime>
#include <string>
#include <vector>

#include "server_harness.h"
#include "server/bot_identity.h"
#include "server/db.h"
#include "server/systems/spawning.h"
#include "shared/game/terrain.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

/// `/admin spawn <mob> <rarity> <x> <y> 1`, the console an operator uses.
void adminSpawnAt(NetClient& client, const char* mob, const char* rarity, Vec2 at) {
    client.sendChat("/admin spawn " + std::string(mob) + " " + rarity + " " +
                    std::to_string(static_cast<int>(at.x)) + " " +
                    std::to_string(static_cast<int>(at.y)) + " 1");
}

// seedUser, loginAs, transcript, sawText, sawTextSince and say are the
// harness's own (server_harness.h).

/// The newest line whose text is exactly `text`, or null. For the tests that
/// care which channel carried a line and who it was signed by.
const ChatLine* lineReading(const NetClient& client, const std::string& text) {
    for (auto it = client.chat().rbegin(); it != client.chat().rend(); ++it) {
        if (it->text == text) return &*it;
    }
    return nullptr;
}

/// The snapshots this harness's database wrote, read back off disk. A backup
/// is only a backup if it loads, so the test that makes one opens it.
std::vector<Database::BackupInfo> reopenBackups(Harness& h) {
    Database probe;
    std::string error;
    probe.load(h.dbPath, error);
    return probe.listBackups();
}

} // namespace

TEST(admin_dashboard_shows_a_bag_and_a_full_admin_announces) {
    // The dashboard's panel reads the player list and a bag over its own
    // binary message (admin_dashboard_tests.cpp has the rest of it); here it
    // is held to the console's rule for who gets an answer at all, beside
    // the console's own announce.
    Harness h("dashboard-admin", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "visitor", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, visitor, "visitor", "password7"));
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.isSkinAdmin(); }));
    boss.joinGame(1000, 800, {}, "Boss");
    visitor.joinGame(1000, 800, {}, "Visitor");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.status() == NetClient::Status::Playing && visitor.status() == NetClient::Status::Playing; }));
    CHECK(say(h, boss, "/admin give visitor rose legendary 3"));

    // By the row's connection, which is how the list names a player.
    boss.adminDashboardPlayers("", 0);
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.adminDashboard().players.size() == 2; }));
    net::ConnectionId visitorId = 0;
    for (const net::AdminDashboardPlayer& row : boss.adminDashboard().players) {
        if (row.username == "visitor") visitorId = row.connection;
    }
    CHECK(visitorId != 0);
    boss.adminDashboardInventory(visitorId, "visitor", 0);
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.adminDashboard().bagUsername == "visitor"; }));
    bool rose = false;
    for (const net::AdminDashboardStack& stack : boss.adminDashboard().bag) {
        if (content().petal(stack.petalIndex).id == "rose") rose = stack.count == 3;
    }
    CHECK(rose);

    // A player asking the same is not answered at all.
    visitor.adminDashboardPlayers("", 0);
    h.step(8, {&boss, &visitor});
    CHECK(visitor.adminDashboard().players.empty());
    CHECK(visitor.adminDashboard().playersPending);
    visitor.sendChat("/admin announce fake");
    h.step(8, {&boss, &visitor});
    CHECK(sawText(visitor, "Command does not exist."));
    CHECK(boss.adminAnnouncement().text.empty());

    boss.sendChat("/admin announce Hello & welcome");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return visitor.adminAnnouncement().text == "Hello & welcome"; }));
    CHECK_EQ(visitor.adminAnnouncement().author, std::string("boss"));
    const auto* line = lineReading(visitor, "Hello &amp; welcome");
    CHECK(line != nullptr);
    if (line) CHECK_EQ(line->channel, net::ChatChannel::Admin);
    if (line) CHECK_EQ(line->author, std::string("boss"));
}

TEST(admin_dashboard_control_changes_view_and_releases) {
    Harness h("dashboard-control", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "visitor", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient boss, visitor;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, visitor, "visitor", "password7"));
    boss.joinGame(1000, 800, {}, "Boss");
    visitor.joinGame(1000, 800, {}, "Visitor");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.selfPlaced() && visitor.selfPlaced(); }));
    const auto ownId = boss.view().self().netId;
    const auto otherId = visitor.view().self().netId;
    CHECK(ownId != otherId);
    boss.sendChat("/admin control visitor");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.view().self().netId == otherId; }));
    CHECK(boss.controllingFlower());
    net::InputFrame steering;
    steering.sequence = 10;
    steering.moveStrength = 1;
    steering.moveAngle = 0.5;
    steering.flags = net::InputAttack;
    boss.sendInput(steering);
    net::InputFrame competing;
    competing.sequence = 20;
    visitor.sendInput(competing);
    h.step(2, {&boss, &visitor});
    bool foundTarget = false;
    Query<NetId, PlayerInput> controlledInputs{h.server.world()};
    controlledInputs.each([&](Entity, NetId& id, PlayerInput& input) {
        if (id.value == otherId) {
            foundTarget = true;
            CHECK_NEAR(input.current.moveStrength, 1.0, 0.001);
            CHECK_EQ(input.current.flags, net::InputAttack);
        }
    });
    CHECK(foundTarget);
    boss.sendChat("/admin release");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.view().self().netId == ownId; }));
    CHECK(!boss.controllingFlower());
    // A player has no console to control anybody with: the line is answered
    // the way any `/admin` from them is, and nothing moves.
    CHECK(say(h, visitor, "/admin control boss"));
    CHECK(sawText(visitor, "Command does not exist."));
    h.step(8, {&boss, &visitor});
    CHECK_EQ(visitor.view().self().netId, otherId);
    CHECK_EQ(boss.view().self().netId, ownId);
    // A name nobody plays under is refused in words of its own.
    CHECK(say(h, boss, "/admin control nobody"));
    CHECK(sawText(boss, "No player named nobody is in the world."));
    boss.sendChat("/admin control visitor");
    CHECK(h.stepUntil({&boss, &visitor}, [&] { return boss.view().self().netId == otherId; }));
    visitor.disconnect();
    CHECK(h.stepUntil({&boss}, [&] { return boss.view().self().netId == ownId; }));
}

TEST(a_slash_command_is_answered_rather_than_broadcast) {
    Harness h("cmd-not-broadcast", [](const std::string& path) {
        seedUser(path, "asker", "password7");
        seedUser(path, "bystander", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient asker;
    NetClient bystander;
    CHECK(loginAs(h, asker, "asker", "password7"));
    CHECK(loginAs(h, bystander, "bystander", "password7"));

    const std::size_t before = asker.chat().size();
    asker.sendChat("/help");
    CHECK(h.stepUntil({&asker, &bystander},
                      [&] { return asker.chat().size() > before; }, 120));

    // The asker got the listing...
    CHECK(sawText(asker, "/biome"));
    // ...and it went to the asker ALONE. The regression this guards is the
    // whole reason the file exists: "/help" used to arrive at everybody as a
    // chat message reading "/help".
    CHECK(!sawText(bystander, "/help"));
    CHECK(!sawText(bystander, "/biome"));
}

TEST(an_unknown_command_is_refused_and_still_not_broadcast) {
    Harness h("cmd-unknown", [](const std::string& path) {
        seedUser(path, "asker", "password7");
        seedUser(path, "bystander", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient asker;
    NetClient bystander;
    CHECK(loginAs(h, asker, "asker", "password7"));
    CHECK(loginAs(h, bystander, "bystander", "password7"));

    const std::size_t before = asker.chat().size();
    asker.sendChat("/notacommand");
    CHECK(h.stepUntil({&asker, &bystander},
                      [&] { return asker.chat().size() > before; }, 120));

    CHECK(sawText(asker, "Unknown command"));
    CHECK(!sawText(bystander, "/notacommand"));
}

TEST(an_ordinary_line_still_reaches_everyone) {
    Harness h("cmd-plain-chat", [](const std::string& path) {
        seedUser(path, "talker", "password7");
        seedUser(path, "listener", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient talker;
    NetClient listener;
    CHECK(loginAs(h, talker, "talker", "password7"));
    CHECK(loginAs(h, listener, "listener", "password7"));

    const std::size_t before = listener.chat().size();
    talker.sendChat("hello everyone");
    CHECK(h.stepUntil({&talker, &listener},
                      [&] { return listener.chat().size() > before; }, 120));
    CHECK(sawText(listener, "hello everyone"));
}

TEST(the_admin_console_is_denied_to_a_non_admin) {
    Harness h("cmd-admin-denied", [](const std::string& path) {
        seedUser(path, "nobody", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "nobody", "password7"));
    CHECK(say(h, client, "/admin list-players"));

    // The command's EXISTENCE is denied, not the permission: telling a
    // stranger a console is there is half of finding a way in.
    CHECK(sawText(client, "Command does not exist."));
    CHECK(!sawText(client, "level"));
}

TEST(an_admin_can_run_the_console) {
    Harness h("cmd-admin-allowed", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    CHECK(say(h, client, "/admin list-players"));
    CHECK(sawText(client, "[ADMIN] boss executed: list-players"));
    CHECK(sawText(client, "boss"));
}

TEST(an_account_registered_as_a19kisme_is_an_ordinary_player) {
    // The project owner's account name used to be read as a grant: the
    // permanent admin flag at registration and at every load, a console with
    // no chat or command budget, a way past mutes, an "[ADMIN]" label on its
    // lines -- and anybody could register the name on a server that did not
    // have it yet. A name is not a privilege, so whoever registers it, in
    // either case, is an ordinary player, in memory and on disk.
    for (const std::string spelling : {"a19kisme", "A19KISME"}) {
        Harness h(spelling == "a19kisme" ? "cmd-a19-lower" : "cmd-a19-upper",
                  [](const std::string& path) {
                      seedUser(path, "boss", "password7", true);
                      seedUser(path, "listener", "password7");
                  }, dataDir(), 0);
        if (!h.ready) { CHECK(false); return; }

        NetClient squatter;
        NetClient boss;
        NetClient listener;
        CHECK(loginNew(h, squatter, spelling.c_str(), "password7"));
        CHECK(loginAs(h, boss, "boss", "password7"));
        CHECK(loginAs(h, listener, "listener", "password7"));
        const std::vector<NetClient*> all{&squatter, &boss, &listener};
        h.step(5, all);

        CHECK(!squatter.isSkinAdmin());
        const Account* account = h.server.database().findUser(spelling);
        CHECK(account != nullptr);
        if (account != nullptr) CHECK(!account->admin);
        // And not on disk either, where a flag read in at load used to be
        // written straight back out.
        h.server.persistAll();
        Database probe;
        std::string error;
        CHECK(probe.load(h.dbPath, error));
        const Account* stored = probe.findUser(spelling);
        CHECK(stored != nullptr);
        if (stored != nullptr) CHECK(!stored->admin);

        CHECK(say(h, squatter, "/admin list-players"));
        CHECK(sawText(squatter, "Command does not exist."));

        // Signed with the account's own name, and nothing else.
        const std::size_t heard = listener.chat().size();
        squatter.sendChat("hello there");
        CHECK(h.stepUntil(all, [&] { return listener.chat().size() > heard; }, 120));
        const ChatLine* line = lineReading(listener, "hello there");
        CHECK(line != nullptr);
        if (line != nullptr) CHECK_EQ(line->author, spelling);
        CHECK(!sawText(listener, "[ADMIN]"));

        // A mute holds.
        CHECK(say(h, boss, "/admin mute " + spelling));
        CHECK(sawText(boss, "Muted " + spelling));
        squatter.sendChat("can you hear me");
        h.step(30, all);
        CHECK(sawText(squatter, "You are muted"));
        CHECK(!sawText(listener, "can you hear me"));

        // So do both budgets: four lines, then a refusal; twelve commands,
        // then a refusal.
        for (int i = 0; i < 6; ++i) squatter.sendChat("line " + std::to_string(i));
        h.step(10, all);
        CHECK(sawText(squatter, "You are sending messages too quickly."));
        for (int i = 0; i < 16; ++i) squatter.sendChat("/notacommand");
        h.step(10, all);
        CHECK(sawText(squatter, "You are sending commands too quickly."));
    }
}

TEST(give_writes_the_petal_into_the_account) {
    Harness h("cmd-give", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    const std::uint16_t rose = content().petalIndex("rose");
    CHECK(rose != kInvalidIndex);

    const auto roseCount = [&] {
        std::uint32_t total = 0;
        for (const Profile::Stack& stack : client.profile().inventory) {
            if (stack.petalIndex == rose && stack.rarity == Rarity::Legendary) total += stack.count;
        }
        return total;
    };
    CHECK_EQ(roseCount(), 0u);

    client.sendChat("/admin give boss rose legendary 3");
    // The give re-sends the profile, so waiting on the inventory is waiting on
    // the command rather than on a fixed number of ticks.
    CHECK(h.stepUntil({&client}, [&] { return roseCount() == 3u; }, 200));
    CHECK(sawText(client, "Gave 3x legendary rose"));
}

TEST(give_hands_out_a_universal_petal) {
    Harness h("cmd-give-universal", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    const std::uint16_t rose = content().petalIndex("rose");
    CHECK(rose != kInvalidIndex);

    // The one way a universal petal comes into the game.
    client.sendChat("/admin give boss rose universal 2");
    CHECK(h.stepUntil({&client}, [&] {
        return client.profile().stackCount(rose, Rarity::Universal) == 2u;
    }, 200));
    CHECK(sawText(client, "Gave 2x universal rose"));
}

TEST(give_rejects_an_unknown_petal_and_an_unknown_rarity) {
    Harness h("cmd-give-bad", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    CHECK(say(h, client, "/admin give boss notapetal legendary"));
    CHECK(sawText(client, "Petal type \"notapetal\" does not exist"));

    CHECK(say(h, client, "/admin give boss rose notararity"));
    CHECK(sawText(client, "Invalid rarity. Valid rarities:"));

    // Past an int is refused, not narrowed: 4294967297 used to wrap to a give
    // of exactly one.
    CHECK(say(h, client, "/admin give boss rose legendary 4294967297"));
    CHECK(sawText(client, "Invalid amount \"4294967297\""));
}

TEST(spawn_places_a_mob_and_killall_clears_it) {
    Harness h("cmd-spawn", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    const auto liveMobs = [&] {
        int count = 0;
        Query<MobTag> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&) { ++count; });
        return count;
    };

    const int before = liveMobs();
    CHECK(say(h, client, "/admin spawn bee rare 3 stack"));
    CHECK(sawText(client, "rare bee"));
    CHECK(liveMobs() > before);

    CHECK(say(h, client, "/admin killall"));
    // The destroy runs through the command buffer, so it lands on the tick
    // after the command rather than inside it.
    h.step(2, {&client});
    CHECK_EQ(liveMobs(), 0);
    CHECK(sawText(client, "pets left intact"));
}

TEST(a_boss_from_the_console_is_announced_to_the_whole_server) {
    // The announcement is a property of the SPAWNER, not of the band fill: a
    // boss the console conjures is as much an event as one a difficulty-200
    // band rolled in a corner nobody has visited, and the same queue carries
    // both into chat and on to the bot controller.
    Harness h("cmd-boss-announce", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    CHECK(say(h, client, "/admin spawn bee super 1"));
    // The queue is drained on the tick after the command, and the line is
    // worded per recipient: this one is standing on the boss, so it is told
    // where rather than that it happened "somewhere".
    CHECK(h.stepUntil({&client}, [&] { return sawText(client, "has spawned"); }, 60));
    CHECK(sawText(client, "A Super bee has spawned"));

    // And nothing below the line says a word, an ultra included. Named
    // precisely rather than "no spawn line at all", because the world is
    // stocking itself the whole time this runs and its own difficulty-100
    // band is entitled to roll a super while we watch.
    CHECK(say(h, client, "/admin spawn bee ultra 1"));
    h.step(30, {&client});
    CHECK(!sawText(client, "Ultra bee has spawned"));
}

TEST(the_console_cannot_spawn_a_unique_while_its_biome_clock_cools_down) {
    // A server that has just started has every boss clock cooling down (they
    // are dealt out over one cooldown, none ready at boot), so a unique or an
    // apex typed now is refused -- nothing stands and chat says why -- while
    // a super beside it is spawned as ever.
    Harness h("cmd-spawn-cooling", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    const auto liveOfRarity = [&](Rarity rarity) {
        int count = 0;
        Query<MobTag, MobType> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&, MobType& type) { count += type.rarity == rarity ? 1 : 0; });
        return count;
    };

    CHECK(say(h, client, "/admin spawn bee unique"));
    CHECK(sawText(client, "unique clock is cooling down"));
    CHECK(say(h, client, "/admin spawn bee apex 3"));
    CHECK(sawText(client, "apex clock is cooling down"));
    h.step(30, {&client});
    CHECK_EQ(liveOfRarity(Rarity::Unique), 0);
    CHECK_EQ(liveOfRarity(Rarity::Apex), 0);
    CHECK(!sawText(client, "Unique bee has spawned"));
    CHECK(!sawText(client, "Apex bee has spawned"));

    const int supers = liveOfRarity(Rarity::Super);
    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(sawText(client, "Spawned super bee"));
    CHECK(liveOfRarity(Rarity::Super) > supers);
}

TEST(a_full_admin_named_a19kisme_is_held_to_the_boss_clock) {
    // The owner's account name used to wave the console past a biome's boss
    // clocks. Being a full admin is the database flag and nothing more, so a
    // full admin of that name is refused exactly as any other is -- nothing
    // stands, and the clock is not spent again.
    Harness h("cmd-spawn-cooling-a19", [](const std::string& path) {
        seedUser(path, "a19kisme", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "a19kisme", "password7"));
    client.joinGame(1920, 1080, {}, "Owner");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    const auto liveOfRarity = [&](Rarity rarity) {
        int count = 0;
        Query<MobTag, MobType> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&, MobType& type) { count += type.rarity == rarity ? 1 : 0; });
        return count;
    };
    const std::string clocksBefore = h.server.database().storedTable("bossClocks").dump();

    CHECK(say(h, client, "/admin spawn bee unique"));
    CHECK(sawText(client, "unique clock is cooling down"));
    CHECK(say(h, client, "/admin spawn bee apex 3"));
    CHECK(sawText(client, "apex clock is cooling down"));
    h.step(30, {&client});
    CHECK_EQ(liveOfRarity(Rarity::Unique), 0);
    CHECK_EQ(liveOfRarity(Rarity::Apex), 0);
    CHECK(!sawText(client, "Unique bee has spawned"));
    CHECK(!sawText(client, "Apex bee has spawned"));
    CHECK_EQ(h.server.database().storedTable("bossClocks").dump(), clocksBefore);
}

TEST(a_unique_from_the_console_restarts_its_biome_clock) {
    // An admin's unique spends the biome's clock just as a wild one does: let
    // in while the clock is ready, and then the next one there waits a whole
    // cooldown. Per tier, so the apex clock is still ready afterwards.
    Harness h("cmd-spawn-charge", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    // Bees only: every OTHER biome's clock is ready too, so a wild unique can
    // roll elsewhere on the same step and is not what this test is about.
    const std::uint16_t bee = content().mobIndex("bee");
    const auto liveOfRarity = [&](Rarity rarity) {
        int count = 0;
        Query<MobTag, MobType> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&, MobType& type) {
            count += type.configIndex == bee && type.rarity == rarity ? 1 : 0;
        });
        return count;
    };

    // Every clock is dealt within one cooldown of the first spawner pass, so
    // one apex cooldown on, all of them stand ready.
    h.clock += kApexSpawnCooldownMillis;
    h.step(1, {&client});

    CHECK(say(h, client, "/admin spawn bee unique"));
    CHECK(sawText(client, "Spawned unique bee"));
    CHECK_EQ(liveOfRarity(Rarity::Unique), 1);

    CHECK(say(h, client, "/admin spawn bee unique"));
    CHECK(sawText(client, "unique clock is cooling down"));
    CHECK_EQ(liveOfRarity(Rarity::Unique), 1);

    CHECK(say(h, client, "/admin spawn bee apex"));
    CHECK(sawText(client, "Spawned apex bee"));
    CHECK_EQ(liveOfRarity(Rarity::Apex), 1);
    CHECK(say(h, client, "/admin spawn bee apex"));
    CHECK(sawText(client, "apex clock is cooling down"));
}

TEST(boss_clocks_are_kept_in_the_database_and_survive_a_restart) {
    // First run: the spawner deals the clocks out and they reach the
    // database's `bossClocks` table as wall-clock ready times.
    std::vector<std::string> biomes;
    {
        Harness h("cmd-boss-clock-save", [](const std::string& path) {
            seedUser(path, "boss", "password7", true);
        });
        if (!h.ready) { CHECK(false); return; }
        NetClient client;
        CHECK(loginAs(h, client, "boss", "password7"));
        client.joinGame(1920, 1080, {}, "Boss");
        CHECK(h.stepUntil({&client},
                          [&] { return client.status() == NetClient::Status::Playing; }, 200));
        h.step(2, {&client});

        const Json& table = h.server.database().storedTable("bossClocks");
        CHECK(table.isObject());
        biomes = table.keys();
        CHECK(!biomes.empty());
        const double now = static_cast<double>(h.server.database().nowMillis());
        for (const std::string& biome : biomes) {
            // Scattered over one cooldown from boot: still cooling, and never
            // further off than a whole cooldown.
            const double unique = table[biome]["uniqueReadyAt"].asDouble();
            const double apex = table[biome]["apexReadyAt"].asDouble();
            CHECK(unique > now - 1000.0 && unique <= now + kUniqueSpawnCooldownMillis + 1000.0);
            CHECK(apex > now - 1000.0 && apex <= now + kApexSpawnCooldownMillis + 1000.0);
        }

        // Anyone may ask, not only an admin.
        CHECK(say(h, client, "/boss-timers"));
        CHECK(sawText(client, "Boss cooldowns:"));
    }

    // Second run, on a database whose unique clocks came ready while it was
    // down and whose apex clocks have an hour to go: the unique is let in at
    // once (a fresh boot would refuse it), the apex is not.
    Harness h("cmd-boss-clock-load", [&](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        Database db;
        std::string error;
        db.load(path, error);
        const double now = static_cast<double>(db.nowMillis());
        for (const std::string& biome : biomes) {
            Json entry = Json::object();
            entry["uniqueReadyAt"] = now - 60000.0;
            entry["apexReadyAt"] = now + 3600000.0;
            db.rawTable("bossClocks")[biome] = std::move(entry);
        }
        db.markDirty();
        db.save();
    });
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    CHECK(say(h, client, "/boss-timers"));
    CHECK(sawText(client, "unique ready, apex 59m") || sawText(client, "unique ready, apex 1h 0m"));

    CHECK(say(h, client, "/admin spawn bee unique"));
    CHECK(sawText(client, "Spawned unique bee"));
    CHECK(say(h, client, "/admin spawn bee apex"));
    CHECK(sawText(client, "apex clock is cooling down"));

    // The console's charge reaches the table straight away: the unique clock
    // there is a whole cooldown out again.
    const Json& table = h.server.database().storedTable("bossClocks");
    const double now = static_cast<double>(h.server.database().nowMillis());
    bool charged = false;
    for (const std::string& biome : table.keys()) {
        if (table[biome]["uniqueReadyAt"].asDouble() > now + kUniqueSpawnCooldownMillis - 60000.0) {
            charged = true;
        }
    }
    CHECK(charged);
}

TEST(spawn_with_a_bad_mob_type_spawns_nothing) {
    Harness h("cmd-spawn-bad", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    const auto liveMobs = [&] {
        int count = 0;
        Query<MobTag> mobs{h.server.world()};
        mobs.each([&](Entity, MobTag&) { ++count; });
        return count;
    };

    // A bad mob type is a server-console diagnostic and nothing else -- the
    // reference logs it inside spawnMob and still acknowledges in chat -- so
    // the only thing a player can observe is that nothing was spawned.
    const int before = liveMobs();
    CHECK(say(h, client, "/admin spawn notamob rare"));
    CHECK(sawText(client, "Spawned rare notamob"));
    CHECK_EQ(liveMobs(), before);
}

TEST(teleport_moves_the_flower_and_refuses_a_point_off_the_map) {
    Harness h("cmd-teleport", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    // A point taken from the OVERWORLD'S OWN extent, not a pair of round
    // numbers: every map states its size now, and the command refuses a
    // coordinate past the map -- so a hard-coded point is a test that starts
    // failing the moment an author resizes the world.
    //
    // And an OPEN one. The shipped map is about half solid now --
    // collision is a layer property and water, dirt and castle all collide --
    // so the middle of the map is as likely to be inside a castle wall as not.
    // `tp` puts the body exactly where it is told, and the very next movement
    // substep shoves it out of a wall, which would read here as the command
    // having missed. The nearest open tile to the geometric target is still a
    // point nobody typed into this file, so the test still follows an author
    // resizing the world.
    const Terrain& terrain = h.server.terrain();
    const Vec2 extent = terrain.realmExtent(Realm::Overworld);
    int openTx = 0;
    int openTy = 0;
    CHECK(terrain.nearestOpenTile({extent.x * 0.5, extent.y * 0.25}, openTx, openTy,
                                  Realm::Overworld));
    const Vec2 openCentre = Terrain::tileCenter(openTx, openTy);
    const double targetX = std::floor(openCentre.x);
    const double targetY = std::floor(openCentre.y);
    CHECK(!terrain.blocked({targetX, targetY}, Realm::Overworld));
    CHECK(say(h, client, "/admin tp boss " + std::to_string(static_cast<long>(targetX)) + " " +
                             std::to_string(static_cast<long>(targetY))));
    CHECK(sawText(client, "Teleported"));

    bool landed = false;
    Query<PlayerTag, Transform, PlayerAccount> flowers{h.server.world()};
    flowers.each([&](Entity, PlayerTag&, Transform& transform, PlayerAccount& account) {
        if (account.username != "Boss") return;
        landed = std::abs(transform.position.x - targetX) < 1.0 &&
                 std::abs(transform.position.y - targetY) < 1.0;
    });
    CHECK(landed);

    // A coordinate past the map is a typo, and typing one is how the
    // TypeScript build used to hang its tick loop. It is refused, not clamped.
    CHECK(say(h, client, "/admin tp boss 1e20 1e20"));
    CHECK(sawText(client, "Coordinates out of range"));
}

TEST(mute_stops_chat_but_not_commands) {
    Harness h("cmd-mute", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "loud", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient loud;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, loud, "loud", "password7"));

    CHECK(say(h, boss, "/admin mute loud"));
    CHECK(sawText(boss, "Muted loud"));

    const std::size_t bossLines = boss.chat().size();
    loud.sendChat("can you hear me");
    h.step(30, {&boss, &loud});
    CHECK_EQ(boss.chat().size(), bossLines);
    CHECK(sawText(loud, "You are muted"));

    // A mute bars a player from talking to other players, not from asking the
    // server about their own account.
    CHECK(say(h, loud, "/biome"));
    CHECK(sawText(loud, "populated biome"));

    CHECK(say(h, boss, "/admin unmute loud"));
    const std::size_t after = boss.chat().size();
    loud.sendChat("and now");
    CHECK(h.stepUntil({&boss, &loud}, [&] { return boss.chat().size() > after; }, 120));
    CHECK(sawText(boss, "and now"));
}

TEST(unmute_all_lifts_every_mute_online_or_not) {
    Harness h("cmd-unmute-all", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "loud", "password7");
        seedUser(path, "away", "password7");
        seedUser(path, "quiet", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient loud;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, loud, "loud", "password7"));

    CHECK(say(h, boss, "/admin mute loud"));
    CHECK(say(h, boss, "/admin mute away"));
    CHECK(h.server.database().findUser("away")->muted);

    CHECK(say(h, boss, "/admin unmute_all"));
    CHECK(sawText(boss, "Unmuted 2 accounts."));
    CHECK(h.stepUntil({&boss, &loud}, [&] { return sawText(loud, "You have been unmuted"); }, 60));
    CHECK(!h.server.database().findUser("loud")->muted);
    CHECK(!h.server.database().findUser("away")->muted);
    CHECK(!h.server.database().findUser("quiet")->muted);

    CHECK(say(h, boss, "/admin unmute_all"));
    CHECK(sawText(boss, "Nobody is muted."));
}

TEST(a_full_admin_cannot_be_muted) {
    Harness h("cmd-mute-admin", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "other", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(say(h, boss, "/admin mute other"));
    CHECK(sawText(boss, "is a full admin and cannot be muted"));
}

TEST(a_temporary_grant_opens_the_console_and_closes_on_respawn) {
    Harness h("cmd-grant", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "helper", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient helper;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, helper, "helper", "password7"));
    helper.joinGame(1920, 1080, {}, "Helper");
    CHECK(h.stepUntil({&boss, &helper}, [&] { return helper.status() == NetClient::Status::Playing; }, 200));

    CHECK(!helper.isSkinAdmin());
    CHECK(say(h, boss, "/admin grant_admin helper"));
    CHECK(sawText(boss, "Granted temporary admin"));
    // The grantee's client is told, so its command autocomplete stops hiding
    // the admin rows.
    CHECK(h.stepUntil({&boss, &helper}, [&] { return helper.isSkinAdmin(); }, 120));

    CHECK(say(h, helper, "/admin list-players"));
    CHECK(sawText(helper, "[ADMIN] helper executed"));

    // The loan does not extend itself: a grantee may not hand out a successor.
    CHECK(say(h, helper, "/admin grant_admin boss"));
    CHECK(sawText(helper, "Only a full admin can grant or revoke admin access."));

    // And it ends with the life it was lent for.
    helper.requestRespawn();
    CHECK(h.stepUntil({&boss, &helper}, [&] { return !helper.isSkinAdmin(); }, 200));
    const std::size_t before = helper.chat().size();
    helper.sendChat("/admin list-players");
    CHECK(h.stepUntil({&boss, &helper}, [&] { return helper.chat().size() > before; }, 120));
    CHECK(sawText(helper, "Command does not exist."));
}

TEST(a_local_grant_makes_an_admin_the_respawn_does_not_take_back) {
    // GameServer::grantAdmin is what the offline page's Grant Admin button
    // calls: the server is in the player's own page, so the grant is a direct
    // call rather than anything on a wire. It is the PERMANENT flag, which is
    // the whole difference from `/admin grant_admin` -- a console lent for one
    // life would be gone the first time that page's player died.
    Harness h("cmd-local-grant", [](const std::string& path) {
        seedUser(path, "solo", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "solo", "password7"));
    client.joinGame(1920, 1080, {}, "Solo");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    CHECK(!client.isSkinAdmin());

    // A token that names no account is a refusal, not a silently invented one.
    CHECK(!h.server.grantAdmin("nobody-at-all"));
    CHECK(!h.server.grantAdmin(""));

    // Nor is anything that names this very account without being the
    // credential its client was issued: its name, in either spelling, the
    // nameplate it joined under, its id. A "helpful" fallback that looked any
    // of these up would let whatever a player can type aim the grant -- the
    // thing grantAdmin is keyed on the token to rule out.
    const Account* before = h.server.database().findUser("solo");
    CHECK(before != nullptr);
    const std::string accountId = before != nullptr ? before->id : std::string();
    for (const std::string& notAToken :
         {std::string("solo"), std::string("Solo"), std::string("SOLO"), accountId}) {
        CHECK(!h.server.grantAdmin(notAToken));
    }
    h.step(30, {&client});
    CHECK(!client.isSkinAdmin());
    before = h.server.database().findUser("solo");
    CHECK(before != nullptr);
    if (before != nullptr) CHECK(!before->admin);

    // Keyed on the session token the client was issued, as the offline page
    // hands it over -- never on the account's name.
    CHECK(h.server.grantAdmin(client.sessionToken()));
    // The client is told, the same resend a temporary grant does: that flag is
    // what stops the command autocomplete hiding the /admin rows.
    CHECK(h.stepUntil({&client}, [&] { return client.isSkinAdmin(); }, 120));
    CHECK(say(h, client, "/admin list-players"));
    CHECK(sawText(client, "[ADMIN] solo executed: list-players"));

    // Survives the life the loan would have ended with.
    client.requestRespawn();
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    CHECK(client.isSkinAdmin());

    // And survives the page: the account carries the flag, and the database is
    // dirty so the next write puts it on disk rather than in nothing.
    const Account* account = h.server.database().findUser("solo");
    CHECK(account != nullptr);
    if (account != nullptr) CHECK(account->admin);
    h.server.persistAll();
    Database probe;
    std::string error;
    CHECK(probe.load(h.dbPath, error));
    const Account* stored = probe.findUser("solo");
    CHECK(stored != nullptr);
    if (stored != nullptr) CHECK(stored->admin);

    // Granting it twice is a no-op that still reports the standing.
    CHECK(h.server.grantAdmin(client.sessionToken()));
}

TEST(a_command_never_takes_a_nameplate_for_the_player_it_names) {
    // A nameplate is whatever its client typed on the title screen, so a
    // player can wear another's account name. While the account it names was
    // not in the world -- on the title screen, or not signed in at all -- the
    // console used to settle for the flower wearing it: the grant, the give,
    // the control and the confirmation all went to the impostor.
    Harness h("cmd-nameplate", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "alice", "password7");
        seedUser(path, "mallory", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient alice;
    NetClient mallory;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, alice, "alice", "password7"));   // and stays on the title screen
    CHECK(loginAs(h, mallory, "mallory", "password7"));
    boss.joinGame(1920, 1080, {}, "Boss");
    mallory.joinGame(1920, 1080, {}, "alice");
    std::vector<NetClient*> all{&boss, &alice, &mallory};
    CHECK(h.stepUntil(all, [&] {
        return boss.status() == NetClient::Status::Playing &&
               mallory.status() == NetClient::Status::Playing;
    }, 200));

    const std::string aliceId = h.server.database().findUser("alice")->id;
    const std::string malloryId = h.server.database().findUser("mallory")->id;
    const auto roses = [&](const std::string& userId) {
        const PlayerRecord* record = h.server.database().findProgress(userId);
        return record != nullptr ? record->itemCount(Rarity::Rare, "petal_rose") : 0;
    };

    const auto noneOfItReachedMallory = [&] {
        const std::uint64_t mark = boss.chatSequence();
        CHECK(say(h, boss, "/admin grant_admin alice"));
        CHECK(sawTextSince(boss, mark, "Player \"alice\" not found"));
        const auto ownView = boss.view().self().netId;
        CHECK(say(h, boss, "/admin control alice"));
        CHECK(sawTextSince(boss, mark, "No player named alice is in the world."));
        h.step(10, all);
        CHECK_EQ(boss.view().self().netId, ownView);
        CHECK(!mallory.isSkinAdmin());

        // A give by name lands on the account of that name, as an offline
        // give does, and never on the flower wearing it.
        const int aliceBefore = roses(aliceId);
        CHECK(say(h, boss, "/admin give alice rose rare 2"));
        CHECK(sawTextSince(boss, mark, "petal to alice (offline)"));
        CHECK_EQ(roses(aliceId), aliceBefore + 2);
        CHECK_EQ(roses(malloryId), 0);
        CHECK(!sawTextSince(boss, mark, "Granted"));
    };

    // alice on the title screen...
    noneOfItReachedMallory();

    // ...and signed out altogether.
    alice.disconnect();
    all = {&boss, &mallory};
    h.step(10, all);
    noneOfItReachedMallory();

    // A mute is by account name too.
    CHECK(say(h, boss, "/admin mute alice"));
    CHECK(h.server.database().findUser("alice")->muted);
    CHECK(!h.server.database().findUser("mallory")->muted);

    // And what a command does resolve, it names by ACCOUNT: mallory's grant
    // says "mallory", whatever her flower is called.
    CHECK(say(h, boss, "/admin grant_admin mallory"));
    CHECK(sawText(boss, "Granted temporary admin to mallory ("));
    CHECK(!sawText(boss, "Granted temporary admin to alice"));
    CHECK(h.stepUntil(all, [&] { return mallory.isSkinAdmin(); }, 120));
}

TEST(a_bot_is_still_named_by_its_nameplate) {
    // Bots own no account, so a nameplate is all there is to call one by, and
    // the console still answers to it.
    Harness h("cmd-bot-target", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 3);
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));
    boss.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&boss}, [&] { return boss.status() == NetClient::Status::Playing; }, 200));

    // A bot whose name is one word, so it can be typed as one argument.
    std::string name;
    CHECK(h.stepUntil({&boss}, [&] {
        Query<PlayerTag, PlayerAccount> flowers{h.server.world()};
        flowers.each([&](Entity, PlayerTag&, PlayerAccount& account) {
            if (!name.empty() || !account.userId.empty() || account.username.empty()) return;
            if (account.username.find(' ') != std::string::npos) return;
            name = account.username;
        });
        return !name.empty();
    }, 600));
    if (name.empty()) return;

    CHECK(say(h, boss, "/admin corrupt " + name + " on"));
    CHECK(sawText(boss, "Corrupted " + name + " ("));
    int corrupted = 0;
    Query<PlayerTag, PlayerAccount, PlayerVisuals> flowers{h.server.world()};
    flowers.each([&](Entity, PlayerTag&, PlayerAccount& account, PlayerVisuals& visuals) {
        if (account.userId.empty() && account.username == name && visuals.corrupted) ++corrupted;
    });
    CHECK(corrupted > 0);

    // It holds no session, so nothing that needs one resolves to it.
    CHECK(say(h, boss, "/admin grant_admin " + name));
    CHECK(sawText(boss, "Player \"" + name + "\" not found"));
}

TEST(set_bot_count_clamps_and_applies) {
    Harness h("cmd-botcount", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    // The TypeScript build reported the clamp and then returned WITHOUT
    // applying anything, so a count over the cap said it had capped and did
    // nothing.
    // Both halves are asserted: the wording, and that it applied. The number
    // is derived from the cap rather than written out, so raising the ceiling
    // does not silently turn this into a test of the un-clamped path.
    CHECK(say(h, client, "/admin set_bot_count " + std::to_string(kMaxBots + 50)));
    CHECK(sawText(client, "capped at " + std::to_string(kMaxBots)));

    CHECK(say(h, client, "/admin set_bot_count default"));
    CHECK(sawText(client, "override cleared"));

    // A double space is not an error worth a diagnostic. The reply carries the
    // previous population after the target, so this matches the target alone.
    CHECK(say(h, client, "/admin set_bot_count  4"));
    CHECK(sawText(client, "Bot count target set to 4 (was "));
}

TEST(generate_code_mints_a_redeemable_code) {
    Harness h("cmd-code", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    CHECK(say(h, client, "/admin generate_code 250 3"));
    CHECK(sawText(client, "[CODE GENERATED]"));
    CHECK(sawText(client, "Stars: 250"));
    CHECK(sawText(client, "Max Uses: 3"));

    CHECK(say(h, client, "/admin list_codes"));
    CHECK(sawText(client, "Stars: 250"));

    // A refused mint says so rather than writing a zero-star code.
    CHECK(say(h, client, "/admin generate_code notanumber"));
    CHECK(sawText(client, "Usage: generate_code"));
}

TEST(notifications_are_appended_to_the_array_table_not_over_it) {
    Harness h("cmd-notify", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    CHECK(say(h, client, "/admin notify star_code Event starting now"));
    CHECK(sawText(client, "Notification created: Event starting now"));

    // The feed is the one unmodelled table stored as an ARRAY. Reading it back
    // through the notification request is what proves it was not coerced to an
    // empty object on the way in.
    client.requestNotifications(20, 0);
    CHECK(h.stepUntil({&client}, [&] { return !client.notifications().empty(); }, 200));
    CHECK_EQ(client.notifications().size(), 1u);
    CHECK_EQ(client.notifications()[0].message, std::string("Event starting now"));

    CHECK(say(h, client, "/admin notify nosuchtype hello"));
    CHECK(sawText(client, "Valid types:"));

    CHECK(say(h, client, "/admin clear_notifications"));
    CHECK(sawText(client, "Cleared 1 notification(s)"));
}

TEST(loadout_from_string_reports_the_build_the_world_would_spawn) {
    Harness h("cmd-fromstring", [](const std::string& path) {
        seedUser(path, "asker", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "asker", "password7"));

    CHECK(say(h, client, "/level-from-string m28"));
    // Whatever the level is, it is the SAME level the bot factory rolls -- one
    // shared roll, so the console cannot describe a bot the world would not
    // build.
    const BotIdentity expected = botIdentityForName("m28", kLoadoutActiveSlots, kMaxLevel);
    CHECK(sawText(client, "would be level " + std::to_string(expected.level)));

    CHECK(say(h, client, "/loadout-from-string m28"));
    CHECK(sawText(client, "Slot 1: " + std::string(rarityName(expected.slots[0].rarity)) + " " +
                              content().petal(expected.slots[0].petalIndex).id));

    CHECK(say(h, client, "/level-from-string"));
    CHECK(sawText(client, "Usage: /level-from-string &lt;name&gt;"));
}

TEST(a_command_this_build_lacks_is_left_unanswered) {
    Harness h("cmd-unsupported", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    // The reference's command chain falls off its last branch for an admin
    // verb it does not know, and the echo is all the operator sees. This build
    // says exactly as much -- no apology of its own about what it lacks.
    CHECK(say(h, client, "/admin nosuchverb"));
    CHECK(sawText(client, "[ADMIN] boss executed: nosuchverb"));
    CHECK(!sawText(client, "not available"));

    // `update` is the one command that answers with what this build cannot do,
    // because the thing it installs is a JavaScript build and a native server
    // has nowhere to put one. Note it does NOT back the database up first:
    // refusing has to happen before the step that writes a file.
    CHECK(say(h, client, "/admin update now"));
    CHECK(sawText(client, "cannot update itself"));
    CHECK(!sawText(client, "Step 1/4"));
}

TEST(a_squad_forms_talks_and_disbands) {
    Harness h("cmd-squad", [](const std::string& path) {
        seedUser(path, "lead", "password7");
        seedUser(path, "mate", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient lead;
    NetClient mate;
    CHECK(loginAs(h, lead, "lead", "password7"));
    CHECK(loginAs(h, mate, "mate", "password7"));

    CHECK(say(h, lead, "/squad-create"));
    CHECK(sawText(lead, "private squad created!"));
    CHECK(lead.squad().inSquad);
    CHECK(lead.squad().members.size() == 1);

    // The hyphen form and the space form are the same command: the reference
    // rewrites one into the other, and so does this.
    CHECK(say(h, lead, "/squad invite mate"));
    CHECK(sawText(lead, "Invite sent to mate."));
    // say() only polls the client it spoke for, and the invitation is a line
    // sent to the OTHER one.
    h.step(3, {&lead, &mate});
    CHECK(sawText(mate, "@lead has invited you to their squad."));

    CHECK(say(h, mate, "/squad-accept"));
    h.step(3, {&lead, &mate});
    CHECK(sawText(lead, "mate has joined the squad."));
    // The squad's own notice: on its channel, signed by nobody, so the chat
    // box files it under Squad and colours it as the squad's.
    const ChatLine* joined = lineReading(lead, "mate has joined the squad.");
    CHECK(joined != nullptr && joined->channel == net::ChatChannel::Squad &&
          joined->author.empty());
    CHECK(lead.squad().members.size() == 2);
    CHECK(mate.squad().members.size() == 2);
    CHECK(mate.squad().id == lead.squad().id);

    CHECK(say(h, lead, "/squad-info"));
    CHECK(sawText(lead, "@lead [lead] (Leader)"));
    CHECK(sawText(lead, "@mate [mate]"));

    const std::size_t before = mate.chat().size();
    lead.sendChat("/s regroup");
    CHECK(h.stepUntil({&lead, &mate}, [&] { return mate.chat().size() > before; }));
    CHECK(sawText(mate, "regroup"));
    CHECK(sawText(lead, "regroup"));
    // Signed with the speaker alone; the channel is what tags it "[Squad]".
    const ChatLine* said = lineReading(mate, "regroup");
    CHECK(said != nullptr && said->channel == net::ChatChannel::Squad && said->author == "lead");

    // The leader leaving promotes the next member and tells them both things.
    CHECK(say(h, lead, "/squad-leave"));
    h.step(3, {&lead, &mate});
    CHECK(sawText(lead, "You have left the squad."));
    CHECK(!lead.squad().inSquad);
    CHECK(sawText(mate, "mate is now the squad leader."));
    CHECK(sawText(mate, "lead has left the squad."));
    CHECK(mate.squad().members.size() == 1);
}

TEST(a_squad_invite_is_refused_when_it_should_be) {
    Harness h("cmd-squad-refuse", [](const std::string& path) {
        seedUser(path, "one", "password7");
        seedUser(path, "two", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient one;
    NetClient two;
    CHECK(loginAs(h, one, "one", "password7"));
    CHECK(loginAs(h, two, "two", "password7"));

    CHECK(say(h, one, "/squad-invite nobody"));
    CHECK(sawText(one, "Player \"nobody\" not found."));

    CHECK(say(h, one, "/squad-create"));
    CHECK(say(h, one, "/squad-invite one"));
    CHECK(sawText(one, "You cannot invite yourself."));

    // A member who is not the leader may not invite, which is the rule a squad
    // filling itself up from four directions at once would break.
    CHECK(say(h, one, "/squad-invite two"));
    CHECK(say(h, two, "/squad-accept"));
    h.step(3, {&one, &two});
    CHECK(say(h, two, "/squad-invite one"));
    CHECK(sawText(two, "Only the squad leader can invite players."));

    CHECK(say(h, one, "/squad-invite two"));
    CHECK(sawText(one, "That player is already in a squad."));
}

TEST(a_squad_cannot_span_biomes) {
    // A squad is a party you are PLAYING with: the party bar, the pink
    // minimap dots and the shared loot ranking all say "these people are
    // here". Two flowers on two maps are none of that, and a squad across
    // them was a way to rank for loot on ground you were not standing on.
    Harness h("cmd-squad-biome",
              [](const std::string& path) {
                  seedUser(path, "here", "password7");
                  seedUser(path, "away", "password7");
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient here;
    NetClient away;
    CHECK(loginAs(h, here, "here", "password7"));
    CHECK(loginAs(h, away, "away", "password7"));
    here.joinGame(1280, 720, "garden", "here");
    away.joinGame(1280, 720, "desert", "away");
    CHECK(h.stepUntil({&here, &away}, [&] {
        return here.status() == NetClient::Status::Playing &&
               away.status() == NetClient::Status::Playing;
    }));

    CHECK(say(h, here, "/squad-create public"));
    CHECK(say(h, here, "/squad-invite away"));
    CHECK(sawText(here, "A squad cannot span biomes."));
    CHECK(sawText(here, "Desert"));
    h.step(3, {&here, &away});
    CHECK(!sawText(away, "has invited you to their squad"));

    // And the public listing does not offer what it would refuse.
    CHECK(say(h, away, "/squad-find-public"));
    CHECK(sawText(away, "No public squads available in your biome."));
    const std::string squadId = here.squad().id;
    CHECK(!squadId.empty());
    CHECK(say(h, away, "/squad-join " + squadId));
    CHECK(sawText(away, "A squad cannot span biomes."));
    CHECK(!away.squad().inSquad);

    // Same biome: the ordinary rules, unchanged.
    away.leaveGame();
    h.step(3, {&here, &away});
    away.joinGame(1280, 720, "garden", "away");
    CHECK(h.stepUntil({&here, &away},
                      [&] { return away.status() == NetClient::Status::Playing; }));
    CHECK(say(h, away, "/squad-join " + squadId));
    h.step(3, {&here, &away});
    CHECK(away.squad().inSquad);
    CHECK(away.squad().members.size() == 2);

    // Leaving the biome leaves the squad. This is the half the join-time
    // checks cannot cover: a player can squad up in the garden, walk back to
    // the title screen and press play on another door.
    away.leaveGame();
    h.step(3, {&here, &away});
    away.joinGame(1280, 720, "desert", "away");
    CHECK(h.stepUntil({&here, &away},
                      [&] { return away.status() == NetClient::Status::Playing; }));
    h.step(5, {&here, &away});
    CHECK(!away.squad().inSquad);
    CHECK(sawText(away, "A squad cannot span biomes."));
    CHECK(sawText(here, "away has left the squad."));
    CHECK(here.squad().members.size() == 1);
}

TEST(a_squadmate_is_sent_the_drop_their_squad_earned) {
    // END TO END, over the socket, because the unit rules passing says
    // nothing about whether a player SEES the drop: the eligibility list is
    // server state, and a drop only reaches a client that the replicator
    // decided to stream it to. This walks the whole chain -- squad roster,
    // the per-tick ranking index, the kill, the reservation, the wire -- and
    // asserts at both ends, so a failure says which end is wrong.
    Harness h("cmd-squad-loot",
              [](const std::string& path) {
                  seedUser(path, "fighter", "password7", true);
                  seedUser(path, "mate", "password7");
              },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient fighter;
    NetClient mate;
    CHECK(loginAs(h, fighter, "fighter", "password7"));
    CHECK(loginAs(h, mate, "mate", "password7"));
    fighter.joinGame(1280, 720, "garden", "fighter");
    mate.joinGame(1280, 720, "garden", "mate");
    CHECK(h.stepUntil({&fighter, &mate}, [&] {
        return fighter.status() == NetClient::Status::Playing &&
               mate.status() == NetClient::Status::Playing;
    }));

    CHECK(say(h, fighter, "/squad-create public"));
    CHECK(say(h, fighter, "/squad-invite mate"));
    h.step(3, {&fighter, &mate});
    CHECK(say(h, mate, "/squad-accept"));
    h.step(3, {&fighter, &mate});
    CHECK(fighter.squad().members.size() == 2);
    if (fighter.squad().members.size() != 2) return;

    World& world = h.server.world();
    const auto bodyOf = [&](const char* name) {
        Entity found = NULL_ENTITY;
        Query<PlayerTag, PlayerAccount> people{world};
        people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
            if (account.username == name) found = e;
        });
        return found;
    };
    const Entity fighterBody = bodyOf("fighter");
    const Entity mateBody = bodyOf("mate");
    CHECK(fighterBody != NULL_ENTITY && mateBody != NULL_ENTITY);
    if (fighterBody == NULL_ENTITY || mateBody == NULL_ENTITY) return;

    // Side by side, so the drop lands in both viewports: a squadmate across
    // the map is eligible for a drop the replicator never sends them, which
    // is correct and would make this test ask the wrong question.
    const Vec2 at = world.get<Transform>(fighterBody).position;
    world.get<Transform>(mateBody).position = at + Vec2{60, 0};

    // A common mob dropped ON the fighter, killed by the flower's own body
    // damage. Only the fighter ever touches it.
    const std::uint32_t before = static_cast<std::uint32_t>(
        world.get<PlayerProgress>(mateBody).totalXp);
    adminSpawnAt(fighter, "starfish", "uncommon", at + Vec2{5, 0});
    Entity mob = NULL_ENTITY;
    CHECK(h.stepUntil({&fighter, &mate}, [&] {
        Query<MobTag, MobType, Transform> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type, Transform& where) {
            if (mob != NULL_ENTITY) return;
            if (type.configIndex != content().mobIndex("starfish")) return;
            if (distance(where.position, at) > 400.0) return;
            mob = e;
        });
        return mob != NULL_ENTITY;
    }, 120));
    if (mob == NULL_ENTITY) { CHECK(false); return; }

    // Killed by the fighter's own body, which is the ordinary kill path --
    // contact damage, a real Bounty, a real death. Stacked the odds so it
    // takes one touch rather than a minute of shoving: what is under test is
    // who gets paid, not how long a starfish lasts.
    world.get<Health>(mob).current = 1.0;
    world.get<ContactDamage>(fighterBody).amount = 500.0;
    world.get<Transform>(mob).position = at;
    CHECK(h.stepUntil({&fighter, &mate}, [&] {
        Query<DropTag, DropItem> drops{world};
        return !drops.collect().empty();
    }, 240));

    Query<DropTag, DropItem> drops{world};
    const std::vector<Entity> dropped = drops.collect();
    CHECK(!dropped.empty());
    if (dropped.empty()) return;

    // SERVER SIDE: the squadmate is on the reservation.
    const DropItem& item = world.get<DropItem>(dropped.front());
    CHECK(claimed(item.eligible, mateBody, 0));
    // ...and was paid the kill's XP without landing a hit.
    CHECK(world.get<PlayerProgress>(mateBody).totalXp > before);

    // CLIENT SIDE: the drop actually reached the squadmate's screen.
    const NetId* dropId = world.tryGet<NetId>(dropped.front());
    CHECK(dropId != nullptr);
    if (dropId == nullptr) return;
    CHECK(h.stepUntil({&fighter, &mate}, [&] {
        return mate.view().entities().count(dropId->value) != 0;
    }, 120));
    CHECK(mate.view().entities().count(dropId->value) != 0);

    // And the console can say all of that out loud, which is what an operator
    // has to go on when a player reports that sharing is not working.
    CHECK(say(h, fighter, "/admin squads"));
    CHECK(sawText(fighter, ", shares)"));
    // The console escapes its own output, so the arrow arrives as `-&gt;`.
    CHECK(sawText(fighter, "pooled: loot and XP are shared"));
    CHECK(!sawText(fighter, ", ALONE)"));
}

TEST(a_player_squadded_with_a_bot_is_paid_for_what_the_bot_kills) {
    // THE PARTY A QUIET SERVER ACTUALLY HAS. A player invites a bot, the bot
    // does the killing, and the player is paid for it -- loot reserved and
    // XP banked -- without landing a hit. Reported as "squad loot sharing is
    // not working... squadmates are bots", which it could not do while bots
    // were left out of the reward index entirely.
    Harness h("cmd-squad-bot",
              [](const std::string& path) { seedUser(path, "owner", "password7", true); },
              dataDir(), 4);
    if (!h.ready) { CHECK(false); return; }

    NetClient owner;
    CHECK(loginAs(h, owner, "owner", "password7"));
    owner.joinGame(1280, 720, "garden", "owner");
    CHECK(h.stepUntil({&owner}, [&] { return owner.status() == NetClient::Status::Playing; }));
    h.step(120, {&owner});

    World& world = h.server.world();
    // A bot in the player's own realm, by the nameplate `/squad-invite`
    // matches on.
    Entity ownerBody = NULL_ENTITY;
    std::vector<std::pair<Entity, std::string>> bots;
    Query<PlayerTag, PlayerAccount, Transform> flowers{world};
    flowers.each([&](Entity e, PlayerTag&, PlayerAccount& account, Transform& where) {
        if (!account.userId.empty()) { ownerBody = e; return; }
        if (where.realm != Realm::Overworld) return;
        bots.push_back({e, account.username});
    });
    CHECK(ownerBody != NULL_ENTITY);
    CHECK(!bots.empty());
    if (ownerBody == NULL_ENTITY || bots.empty()) return;

    // The player joins the BOTS' squad, which is the reliable direction:
    // bots host public squads of their own and advertise the code in their
    // boss callouts, and a bot that already has one refuses an invite
    // ("Player already has a squad"), so inviting by name only works on
    // whichever bot happens to be free that run.
    std::string squadId;
    // Asked on a slow clock: the console refills two commands a second, and
    // a polling loop that drains the bucket leaves nothing for the spawn
    // below -- which lands as "the mob never appeared" twenty lines later.
    for (int attempt = 0; attempt < 20 && squadId.empty(); ++attempt) {
        owner.sendChat("/admin squads");
        h.step(30, {&owner});
        const std::string log = transcript(owner);
        const std::size_t at = log.rfind("squad_");
        if (at == std::string::npos || at + 15 > log.size()) continue;
        squadId = log.substr(at, 15);
    }
    CHECK(!squadId.empty());
    if (squadId.empty()) return;

    CHECK(say(h, owner, "/squad-join " + squadId));
    h.step(3, {&owner});
    CHECK(owner.squad().members.size() >= 2);
    if (owner.squad().members.size() < 2) return;

    // Which bot shares the squad.
    Entity botBody = NULL_ENTITY;
    for (const auto& candidate : bots) {
        for (const auto& member : owner.squad().members) {
            if (member.bot && member.name == candidate.second) botBody = candidate.first;
        }
    }
    CHECK(botBody != NULL_ENTITY);
    if (botBody == NULL_ENTITY) return;

    // The console agrees that the two of them are pooled, which is the line
    // an operator reads when this is reported again.
    // (The listing above was also read while the player was still alone, so
    // the transcript carries an ALONE from then; only the verdict now is
    // worth asserting.)
    CHECK(say(h, owner, "/admin squads"));
    CHECK(sawText(owner, "pooled: loot and XP are shared"));

    // Near enough that the drop is inside the player's viewport -- a
    // squadmate across the zone is eligible for an item the replicator never
    // sends them -- but far enough that the player's own body cannot touch
    // the mob. Everything the corpse is paid for has to be the BOT's doing.
    const Vec2 at = world.get<Transform>(botBody).position;
    world.get<Transform>(ownerBody).position = at + Vec2{700, 0};

    // Dropped on the bot, which kills it on the spot -- bots fight what is
    // put in front of them, which is the whole reason this is the test.
    const double before = world.get<PlayerProgress>(ownerBody).totalXp;
    adminSpawnAt(owner, "starfish", "uncommon", at);

    // Waited for and picked out BY NAME. Every mob above common leaves one of
    // everything in its table now, so the zone's other bots keep the ground
    // covered in their own kills and the first drop the query hands back is
    // rarely this one.
    const std::uint16_t starfishPetal = content().petalIndex("starfish");
    const auto fromTheKill = [&] {
        Entity found = NULL_ENTITY;
        Query<DropTag, DropItem, Transform> drops{world};
        drops.each([&](Entity e, DropTag&, DropItem& item, Transform& where) {
            if (item.configIndex != starfishPetal) return;
            // On this spot too: the +-50 spawn scatter is the whole distance a
            // drop travels from the mob that left it.
            if (distance(where.position, at) > 100.0) return;
            found = e;
        });
        return found;
    };
    CHECK(h.stepUntil({&owner}, [&] { return fromTheKill() != NULL_ENTITY; }, 240));
    const Entity dropped = fromTheKill();
    CHECK(dropped != NULL_ENTITY);
    if (dropped == NULL_ENTITY) return;

    // The player never touched it, and is on the reservation and paid the XP.
    const PlayerAccount& account = world.get<PlayerAccount>(ownerBody);
    CHECK(claimed(world.get<DropItem>(dropped).eligible, ownerBody, account.connection));
    CHECK(world.get<PlayerProgress>(ownerBody).totalXp > before);
}

TEST(a_squad_that_is_not_pooled_says_why) {
    // The other half of the diagnostic: a squad the loot rule does NOT pool
    // has to say what is wrong with it, because "ALONE" on its own sends the
    // reader back to whoever wrote the command.
    Harness h("cmd-squads-why",
              [](const std::string& path) { seedUser(path, "solo", "password7", true); },
              dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient solo;
    CHECK(loginAs(h, solo, "solo", "password7"));
    solo.joinGame(1280, 720, "garden", "solo");
    CHECK(h.stepUntil({&solo}, [&] { return solo.status() == NetClient::Status::Playing; }));

    CHECK(say(h, solo, "/squad-create public"));
    CHECK(say(h, solo, "/admin squads"));
    CHECK(sawText(solo, ", ALONE)"));
    CHECK(sawText(solo, "not pooled: a squad needs two members in the world"));
}

TEST(a_public_squad_is_listed_and_joinable) {
    Harness h("cmd-squad-public", [](const std::string& path) {
        seedUser(path, "host", "password7");
        seedUser(path, "guest", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient host;
    NetClient guest;
    CHECK(loginAs(h, host, "host", "password7"));
    CHECK(loginAs(h, guest, "guest", "password7"));

    CHECK(say(h, host, "/squad-create public"));
    CHECK(sawText(host, "public squad created!"));

    CHECK(say(h, guest, "/squad-find-public"));
    CHECK(sawText(guest, "Public squads:"));
    CHECK(sawText(guest, "leader: host"));

    const std::string squadId = host.squad().id;
    CHECK(!squadId.empty());
    CHECK(say(h, guest, "/squad-join " + squadId));
    h.step(3, {&host, &guest});
    CHECK(sawText(host, "guest has joined the squad."));
    CHECK(guest.squad().members.size() == 2);

    // A private squad drops off the listing, which is the whole difference
    // between the two.
    CHECK(say(h, host, "/squad-private"));
    h.step(3, {&host, &guest});
    CHECK(sawText(guest, "Squad is now private."));
    CHECK(!host.squad().isPublic);
}

TEST(a_squadmate_is_streamed_across_the_map) {
    Harness h("cmd-squad-view", [](const std::string& path) {
        seedUser(path, "near", "password7", true);
        seedUser(path, "far", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient near;
    NetClient far;
    CHECK(loginAs(h, near, "near", "password7"));
    CHECK(loginAs(h, far, "far", "password7"));
    near.joinGame(1280, 720, {}, "near");
    far.joinGame(1280, 720, {}, "far");
    CHECK(h.stepUntil({&near, &far}, [&] {
        return near.status() == NetClient::Status::Playing &&
               far.status() == NetClient::Status::Playing;
    }));

    // Half a world apart: well outside the four-screen box the replicator
    // streams, so nothing but a squad could put them in each other's view.
    CHECK(say(h, near, "/admin teleport near 1000 1000"));
    CHECK(say(h, near, "/admin teleport far 30000 30000"));
    h.step(20, {&near, &far});

    const auto sees = [](const NetClient& viewer, const NetClient& other) {
        return viewer.view().entities().count(other.view().self().netId) != 0;
    };
    CHECK(!sees(near, far));

    CHECK(say(h, near, "/squad-create"));
    CHECK(say(h, near, "/squad-invite far"));
    h.step(3, {&near, &far});
    CHECK(say(h, far, "/squad-accept"));
    h.step(20, {&near, &far});

    // Both directions: the exemption is the VIEWER's squad, so it has to be
    // applied per recipient rather than to the entity being looked at.
    CHECK(sees(near, far));
    CHECK(sees(far, near));
    CHECK(near.squad().members.size() == 2);
    for (const SquadState::Member& member : near.squad().members) {
        // A member in the world carries the wire id the minimap and the party
        // bars find their body by.
        CHECK(member.netId != 0);
    }

    // And it stops when the squad does.
    CHECK(say(h, far, "/squad-leave"));
    h.step(20, {&near, &far});
    CHECK(!sees(near, far));
}

TEST(a_restart_warns_and_can_be_called_off) {
    Harness h("cmd-restart", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "player", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    NetClient player;
    CHECK(loginAs(h, boss, "boss", "password7"));
    CHECK(loginAs(h, player, "player", "password7"));

    CHECK(say(h, boss, "/admin restart cancel"));
    CHECK(sawText(boss, "No pending restart to cancel."));

    CHECK(say(h, boss, "/admin restart 12s"));
    CHECK(sawText(boss, "Restart scheduled in 12s."));

    CHECK(say(h, boss, "/admin restart status"));
    CHECK(sawText(boss, "(reason: admin)."));

    // Every player is warned, not just the one who typed it. Two seconds of
    // ticks reaches the ten-second mark and no other.
    h.step(90, {&boss, &player});
    CHECK(sawText(player, "Server restarting in 10 seconds!"));
    CHECK(!sawText(player, "Server will restart in 1 minute"));

    CHECK(say(h, boss, "/admin restart cancel"));
    CHECK(sawText(boss, "Pending restart cancelled."));

    // And nothing fires afterwards: fifteen more seconds of ticks past what
    // was the deadline.
    const std::size_t before = player.chat().size();
    h.step(450, {&boss, &player});
    CHECK(player.chat().size() == before);
}

TEST(a_fired_restart_exits_non_zero) {
    Harness h("cmd-restart-exit", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    // Nothing has asked the server to stop, so there is no code to report yet.
    CHECK(h.server.exitCode() == 0);

    CHECK(say(h, boss, "/admin restart 1s"));
    // A second to the deadline, another for the last notice to leave the
    // sockets, and a margin on top.
    h.step(150, {&boss});

    CHECK(sawText(boss, "Server restarting now"));
    // The whole point: pm2 and systemd leave a cleanly-exited process down, so
    // the exit that is meant to be followed by a start is NOT a clean one.
    CHECK(h.server.exitCode() == GameServer::kRestartExit);
    CHECK(h.server.exitCode() != 0);
}

TEST(the_database_backs_up_and_lists_its_backups) {
    Harness h("cmd-backup", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    CHECK(say(h, boss, "/admin backup_db"));
    CHECK(sawText(boss, "Database backed up to"));
    CHECK(sawText(boss, "-manual-boss.snapshot.json"));

    // The one file this test made, as the reply names it. It is in the
    // harness's own directory -- the database sits at <home>/db/, so its
    // backups go to <home>/db_backups -- and it is the ONLY file the test
    // deletes: a directory of backups is somebody's rescue kit, and a test
    // that cleaned up "every snapshot it could see" once reached the repo's
    // own db_backups through a relative TMPDIR.
    std::string written;
    for (const ChatLine& line : boss.chat()) {
        const std::string lead = "Database backed up to ";
        const std::size_t at = line.text.find(lead);
        if (at == std::string::npos) continue;
        const std::size_t end = line.text.find(" (", at + lead.size());
        if (end == std::string::npos) continue;
        written = line.text.substr(at + lead.size(), end - at - lead.size());
    }
    const std::string ownDirectory = h.files.home + "/db_backups/";
    CHECK(!written.empty());
    CHECK_EQ(written.compare(0, ownDirectory.size(), ownDirectory), 0);

    CHECK(say(h, boss, "/admin backup_db list"));
    CHECK(sawText(boss, "Database backups (1, newest first):"));
    CHECK(sawText(boss, "To restore: copy a backup over inventory.json"));
    CHECK(sawText(boss, "Only this server's own snapshots (*.snapshot.json) are pruned"));

    CHECK(say(h, boss, "/admin backup_db everything"));
    CHECK(sawText(boss, "Usage: backup_db [list]"));

    // The snapshot is a real, complete file: anything less is worse than none,
    // because it looks like a rescue and is not one.
    const std::vector<Database::BackupInfo> backups = reopenBackups(h);
    CHECK(backups.size() == 1);
    if (backups.size() == 1) CHECK_EQ(backups.front().file, written);
    Database reread;
    std::string error;
    CHECK(reread.load(written, error));
    CHECK(reread.findUser("boss") != nullptr);
    if (!written.empty() && written.compare(0, ownDirectory.size(), ownDirectory) == 0) {
        std::remove(written.c_str());
    }
}

TEST(pruning_deletes_only_the_servers_own_snapshots) {
    // The backup directory is shared. The TypeScript server kept its snapshots
    // there under the very pattern this one used to write, and an operator
    // keeps copies of their own beside them -- so once the Node server's
    // backups started reaching the real ~/db_backups, a prune that took
    // "every inventory-*.json past the newest thirty" would have deleted the
    // oldest of somebody else's, the four-megabyte pre-purge rescue among
    // them. Only names this build writes are pruned.
    const std::string home = tempDir("florr-prune-" + std::to_string(::getpid()));
    ::mkdir((home + "/db").c_str(), 0755);
    const std::string directory = home + "/db_backups";
    ::mkdir(directory.c_str(), 0755);
    const std::string path = home + "/db/inventory.json";
    CHECK_EQ(Database::backupDirectoryFor(path), directory);

    // Everything planted is OLDER than the backup about to be taken, by a day
    // per file, so the prune's newest-first order puts every one of them past
    // the backup itself.
    const auto plant = [&](const std::string& name, int daysAgo) {
        const std::string file = directory + "/" + name;
        CHECK(writeText(file, "{}"));
        const std::time_t when = std::time(nullptr) - static_cast<std::time_t>(daysAgo) * 86400;
        struct utimbuf stamp {when, when};
        ::utime(file.c_str(), &stamp);
        return file;
    };
    // The TypeScript server's two, by the names prod really has.
    const std::vector<std::string> foreign{
        plant("inventory-2026-07-17T02-00-27-265Z-pre-update.json", 90),
        plant("inventory-2026-09-03T23-36-13-000Z-pre-spam-purge.json", 80),
        // An operator's copy, and one that only nearly looks like ours.
        plant("inventory-before-the-migration.json", 70),
        plant("inventory-2026-09-05T00-00-00-000Z-Manual.snapshot.json", 60),
    };
    // Thirty of this server's own, the oldest five weeks old.
    std::vector<std::string> own;
    for (int i = 0; i < static_cast<int>(Database::kMaxDatabaseBackups); ++i) {
        char name[96];
        std::snprintf(name, sizeof name,
                      "inventory-2026-08-%02dT00-00-%02d-000Z-pre-update.snapshot.json",
                      i % 28 + 1, i);
        own.push_back(plant(name, 35 - i));
    }
    const auto bare = [](const std::string& file) {
        return file.substr(file.find_last_of('/') + 1);
    };
    for (const std::string& file : own) CHECK(Database::isOwnSnapshotName(bare(file)));
    for (const std::string& file : foreign) CHECK(!Database::isOwnSnapshotName(bare(file)));

    Database::BackupInfo made;
    std::size_t listed = 0;
    {
        // Scoped, so its last save -- a database loaded from nothing is dirty,
        // and ~Database writes a dirty one -- lands before the cleanup below
        // rather than after it.
        Database db;
        std::string error;
        db.load(path, error);
        CHECK(db.backup("pre-update", made, error));
        listed = db.listBackups().size();
    }
    CHECK(Database::isOwnSnapshotName(bare(made.file)));

    // Thirty-one of ours now, so the oldest one goes -- and only it.
    const auto exists = [](const std::string& file) {
        struct stat info {};
        return ::stat(file.c_str(), &info) == 0;
    };
    CHECK(!exists(own.front()));
    for (std::size_t i = 1; i < own.size(); ++i) CHECK(exists(own[i]));
    CHECK(exists(made.file));
    for (const std::string& file : foreign) CHECK(exists(file));
    // And the list shows everybody's, so an operator can see what is there.
    CHECK_EQ(listed, own.size() + foreign.size());

    // Only what this test planted or made, then the directories.
    for (const std::string& file : own) std::remove(file.c_str());
    for (const std::string& file : foreign) std::remove(file.c_str());
    std::remove(made.file.c_str());
    std::remove(path.c_str());
    std::remove((path + ".tmp").c_str());
    ::rmdir(directory.c_str());
    ::rmdir((home + "/db").c_str());
    ::rmdir(home.c_str());
}

TEST(change_maze_rotates_the_active_maze) {
    Harness h("cmd-maze", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient boss;
    CHECK(loginAs(h, boss, "boss", "password7"));

    const std::int64_t started = activeMaze().day();
    CHECK(say(h, boss, "/admin change-maze next"));
    CHECK(sawText(boss, "Maze changed to day " + std::to_string(started + 1)));
    CHECK(activeMaze().day() == started + 1);

    CHECK(say(h, boss, "/admin change-maze rubbish"));
    CHECK(sawText(boss, "Usage: change-maze [next|garden|desert|ocean|"));

    // Back where the rest of the suite expects it: the active maze is one
    // process-wide object, so a test that moves it has to put it back.
    CHECK(say(h, boss, "/admin change-maze " + std::to_string(started)));
    CHECK(activeMaze().day() == started);
}

TEST(guild_commands_reach_the_same_logic_as_the_guild_panel) {
    Harness h("cmd-guild", [](const std::string& path) {
        seedUser(path, "leader", "password7");
        seedUser(path, "member", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient leader;
    NetClient member;
    CHECK(loginAs(h, leader, "leader", "password7"));
    CHECK(loginAs(h, member, "member", "password7"));

    CHECK(say(h, leader, "/guild-create AB12"));
    // The same validation the binary GuildCreate applies: exactly five
    // alphanumerics, because the tag hangs under a nameplate.
    CHECK(sawText(leader, "exactly 5 alphanumeric characters"));

    CHECK(say(h, leader, "/guild-create ABC12"));
    CHECK(sawText(leader, "created"));

    CHECK(say(h, leader, "/guild-invite member"));
    CHECK(sawText(leader, "Guild invite sent to member"));

    CHECK(say(h, member, "/guild-accept"));
    CHECK(say(h, leader, "/guild-info"));
    CHECK(sawText(leader, "ABC12"));
    CHECK(sawText(leader, "member"));

    // A guild message reaches the guild.
    const std::size_t before = member.chat().size();
    leader.sendChat("/g meeting at the lake");
    CHECK(h.stepUntil({&leader, &member},
                      [&] { return member.chat().size() > before; }, 120));
    CHECK(sawText(member, "meeting at the lake"));
    const ChatLine* said = lineReading(member, "meeting at the lake");
    CHECK(said != nullptr && said->channel == net::ChatChannel::Guild &&
          said->author == "leader");
    // The guild's own notice, like the squad's, is on its channel unsigned.
    const ChatLine* joined = lineReading(leader, "member has joined the guild.");
    CHECK(joined != nullptr && joined->channel == net::ChatChannel::Guild &&
          joined->author.empty());
}

TEST(a_whisper_reaches_one_player_and_echoes_to_the_sender) {
    Harness h("cmd-whisper", [](const std::string& path) {
        seedUser(path, "alice", "password7");
        seedUser(path, "bob", "password7");
        seedUser(path, "carol", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    NetClient bob;
    NetClient carol;
    CHECK(loginAs(h, alice, "alice", "password7"));
    CHECK(loginAs(h, bob, "bob", "password7"));
    CHECK(loginAs(h, carol, "carol", "password7"));

    const std::size_t carolBefore = carol.chat().size();
    const std::size_t bobBefore = bob.chat().size();
    // Typed in the wrong case: the copies carry the account's own spelling.
    alice.sendChat("/w BOB meet me by the oak");
    CHECK(h.stepUntil({&alice, &bob, &carol},
                      [&] { return bob.chat().size() > bobBefore; }, 120));
    h.step(3, {&alice, &bob, &carol});

    // Each copy names the OTHER party, on the channel that says which way it
    // went, and both sides now answer the right person.
    const ChatLine* received = lineReading(bob, "meet me by the oak");
    CHECK(received != nullptr && received->channel == net::ChatChannel::Whisper &&
          received->author == "alice");
    const ChatLine* echoed = lineReading(alice, "meet me by the oak");
    CHECK(echoed != nullptr && echoed->channel == net::ChatChannel::WhisperSent &&
          echoed->author == "bob");
    CHECK_EQ(bob.whisperPartner(), std::string("alice"));
    CHECK_EQ(alice.whisperPartner(), std::string("bob"));
    // Nobody else hears it.
    CHECK_EQ(carol.chat().size(), carolBefore);
    CHECK(!sawText(carol, "meet me by the oak"));

    CHECK(say(h, alice, "/w nobody hello"));
    CHECK(sawText(alice, "No player named nobody is online."));
    CHECK(say(h, alice, "/w alice hello"));
    CHECK(sawText(alice, "You cannot whisper to yourself."));
    CHECK(say(h, alice, "/w bob"));
    CHECK(sawText(alice, "Usage: /w"));
}

TEST(a_local_line_reaches_only_the_players_who_can_see_the_speaker) {
    Harness h("cmd-local", [](const std::string& path) {
        seedUser(path, "alice", "password7");
        seedUser(path, "bob", "password7");
        seedUser(path, "carol", "password7");
        seedUser(path, "dave", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    NetClient bob;
    NetClient carol;
    NetClient dave;   // stays on the title screen
    CHECK(loginAs(h, alice, "alice", "password7"));
    CHECK(loginAs(h, bob, "bob", "password7"));
    CHECK(loginAs(h, carol, "carol", "password7"));
    CHECK(loginAs(h, dave, "dave", "password7"));
    alice.joinGame(1280, 720, "garden", "alice");
    bob.joinGame(1280, 720, "garden", "bob");
    carol.joinGame(1280, 720, "garden", "carol");
    CHECK(h.stepUntil({&alice, &bob, &carol, &dave}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing &&
               carol.status() == NetClient::Status::Playing;
    }, 300));

    // Bob a step from Alice, well inside her 1280x720 screen and she inside
    // his; Carol in the same realm but several screens away. Placed on open
    // ground, so the next movement substep has no wall to shove them out of.
    World& world = h.server.world();
    const Terrain& terrain = h.server.terrain();
    Entity aliceBody = NULL_ENTITY;
    Entity bobBody = NULL_ENTITY;
    Entity carolBody = NULL_ENTITY;
    Query<PlayerTag, Transform, PlayerAccount> flowers{world};
    flowers.each([&](Entity e, PlayerTag&, Transform&, PlayerAccount& account) {
        if (account.username == "alice") aliceBody = e;
        if (account.username == "bob") bobBody = e;
        if (account.username == "carol") carolBody = e;
    });
    CHECK(aliceBody != NULL_ENTITY && bobBody != NULL_ENTITY && carolBody != NULL_ENTITY);
    if (aliceBody == NULL_ENTITY || bobBody == NULL_ENTITY || carolBody == NULL_ENTITY) return;
    const Transform from = world.get<Transform>(aliceBody);
    const auto placeNear = [&](Entity body, Vec2 target) {
        int tx = 0;
        int ty = 0;
        CHECK(terrain.nearestOpenTile(target, tx, ty, from.realm));
        Transform& transform = world.get<Transform>(body);
        transform.position = Terrain::tileCenter(tx, ty);
        transform.realm = from.realm;
    };
    placeNear(bobBody, {from.position.x + 150.0, from.position.y});
    placeNear(carolBody, {from.position.x + 4000.0, from.position.y});
    h.step(3, {&alice, &bob, &carol, &dave});
    const Vec2 here = world.get<Transform>(aliceBody).position;
    const Vec2 near = world.get<Transform>(bobBody).position;
    const Vec2 far = world.get<Transform>(carolBody).position;
    CHECK(std::abs(near.x - here.x) < 500.0 && std::abs(near.y - here.y) < 300.0);
    CHECK(std::abs(far.x - here.x) > 1500.0 || std::abs(far.y - here.y) > 1000.0);

    const std::size_t carolBefore = carol.chat().size();
    const std::size_t daveBefore = dave.chat().size();
    const std::size_t bobBefore = bob.chat().size();
    alice.sendChat("/l hello neighbours");
    CHECK(h.stepUntil({&alice, &bob, &carol, &dave},
                      [&] { return bob.chat().size() > bobBefore; }, 120));
    h.step(3, {&alice, &bob, &carol, &dave});

    const ChatLine* heard = lineReading(bob, "hello neighbours");
    CHECK(heard != nullptr && heard->channel == net::ChatChannel::Local &&
          heard->author == "alice" && heard->speakerNetId != 0);
    // The speaker sees her own line, as anyone does in a box they typed in.
    const ChatLine* own = lineReading(alice, "hello neighbours");
    CHECK(own != nullptr && own->channel == net::ChatChannel::Local);
    // Out of sight is out of earshot, and so is the title screen.
    CHECK_EQ(carol.chat().size(), carolBefore);
    CHECK_EQ(dave.chat().size(), daveBefore);

    // With no flower there is nothing to be near, and the server says so
    // rather than dropping the line silently.
    CHECK(say(h, dave, "/l anyone here?"));
    CHECK(sawText(dave, "not in the world"));
    CHECK(!sawText(bob, "anyone here?"));

    // Global still reaches everyone, near, far and on the title screen.
    const std::size_t carolGlobal = carol.chat().size();
    alice.sendChat("hello everyone");
    CHECK(h.stepUntil({&alice, &bob, &carol, &dave},
                      [&] { return carol.chat().size() > carolGlobal; }, 120));
    h.step(3, {&alice, &bob, &carol, &dave});
    const ChatLine* global = lineReading(dave, "hello everyone");
    CHECK(global != nullptr && global->channel == net::ChatChannel::Global);
    CHECK(lineReading(carol, "hello everyone") != nullptr);
}

TEST(delete_guests_keeps_a_guest_that_actually_played) {
    Harness h("cmd-guests", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
        seedUser(path, "User12345678", "password7");
        seedUser(path, "User87654321", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    // One of the two guests has XP, which makes it a player whose account
    // happens to be named like a guest.
    {
        Database db;
        std::string error;
        db.load(h.dbPath, error);
        if (const Account* played = db.findUser("User87654321")) {
            db.progress(played->id).totalXp = 5000;
            db.markDirty();
            db.save();
        }
    }
    // The server already loaded the file this test just edited, so restart the
    // check against a server that sees the edit.
    Harness fresh("cmd-guests-2", [&](const std::string& path) {
        Json root;
        std::string error;
        if (Json::parseFile(h.dbPath, root, error)) root.writeFile(path, 2);
    });
    if (!fresh.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(fresh, client, "boss", "password7"));
    CHECK(say(fresh, client, "/admin delete_guests"));
    CHECK(sawText(client, "Deleted 1 guest account(s) and their player data."));
}

// A squad outside the garden is still a squad.
//
// The bug: a member with no body was read as standing wherever the picker
// OPENS -- the garden -- rather than nowhere. So a flower in the desert could
// invite nobody who was not already in the world, while one in the garden
// could invite anybody, and squads looked broken in every biome but the first.
TEST(a_squad_outside_the_garden_can_invite_someone_with_no_body_yet) {
    Harness h("cmd-squad-biome", [](const std::string& path) {
        seedUser(path, "digger", "password7");
        seedUser(path, "lobbyist", "password7");
        seedUser(path, "gardener", "password7");
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient digger;     // playing, in the desert
    NetClient lobbyist;   // logged in, no body, no door of their own
    NetClient gardener;   // playing, in the garden
    CHECK(loginAs(h, digger, "digger", "password7"));
    CHECK(loginAs(h, lobbyist, "lobbyist", "password7"));
    CHECK(loginAs(h, gardener, "gardener", "password7"));

    digger.joinGame(1280, 720, "desert", "digger");
    CHECK(h.stepUntil({&digger}, [&] { return digger.status() == NetClient::Status::Playing; }));
    gardener.joinGame(1280, 720, "garden", "gardener");
    CHECK(h.stepUntil({&gardener}, [&] { return gardener.status() == NetClient::Status::Playing; }));
    h.step(5, {&digger, &lobbyist, &gardener});

    CHECK(say(h, digger, "/squad-create"));
    CHECK(say(h, digger, "/squad-invite lobbyist"));
    CHECK(sawText(digger, "Invite sent to lobbyist."));
    CHECK(!sawText(digger, "cannot span biomes"));

    h.step(5, {&digger, &lobbyist});
    CHECK(say(h, lobbyist, "/squad-accept"));
    CHECK(h.stepUntil({&digger, &lobbyist},
                      [&] { return lobbyist.squad().members.size() == 2; }));

    // The rule itself still holds: somebody STANDING in another biome is
    // refused, which is the whole reason the test above is not just "anyone
    // may join".
    CHECK(say(h, digger, "/squad-invite gardener"));
    CHECK(sawText(digger, "gardener is in Garden, and the squad is in Desert."));
}

TEST(god_makes_the_admin_invulnerable_until_turned_off) {
    Harness h("cmd-god", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;   // bots own no connection
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    CHECK(say(h, client, "/admin god on"));
    CHECK(sawText(client, "You are now invulnerable."));
    CHECK(std::isinf(world.get<Health>(body).invulnerableUntilMillis));

    // A mob that bites hard, pinned onto the flower every tick so the contact
    // never breaks. Too tough for the flower's own body damage to kill.
    const Vec2 at = world.get<Transform>(body).position;
    adminSpawnAt(client, "starfish", "uncommon", at);
    Entity mob = NULL_ENTITY;
    CHECK(h.stepUntil({&client}, [&] {
        Query<MobTag, MobType, Transform> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type, Transform& where) {
            if (mob != NULL_ENTITY) return;
            if (type.configIndex != content().mobIndex("starfish")) return;
            if (distance(where.position, at) > 400.0) return;
            mob = e;
        });
        return mob != NULL_ENTITY;
    }, 120));
    if (mob == NULL_ENTITY) { CHECK(false); return; }
    world.get<Health>(mob).max = 1e9;
    world.get<Health>(mob).current = 1e9;
    world.get<ContactDamage>(mob).amount = 50.0;
    const auto pin = [&] {
        if (!world.isAlive(mob) || !world.isAlive(body)) return;
        world.get<Transform>(mob).position = world.get<Transform>(body).position;
    };

    const double full = world.get<Health>(body).max;
    for (int i = 0; i < 150; ++i) {
        pin();
        h.step(1, {&client});
    }
    CHECK(world.isAlive(body));
    CHECK_EQ(world.get<Health>(body).current, full);

    // The same bite, the moment the protection comes off -- which is what
    // shows the mob was ever able to hurt anyone.
    CHECK(say(h, client, "/admin god off"));
    CHECK(sawText(client, "You are no longer invulnerable."));
    CHECK(h.stepUntil({&client}, [&] {
        pin();
        return !world.isAlive(body) || world.get<Health>(body).current < full;
    }, 240));
}

TEST(a_fire_ant_hole_springs_on_a_flower_and_falls_with_its_brood) {
    // The whole ambush through the shipping loop: the broadphase the hole is
    // kept out of, the spawner that opens it and the combat that closes it.
    // The unit tests drive each of those alone; this is the claim about all
    // three at once.
    Harness h("cmd-fire-ant-ambush", [](const std::string& path) {
        seedUser(path, "digger", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "digger", "password7"));
    client.joinGame(1920, 1080, {}, "Digger");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    // Ten soldiers at once is not the fight under test.
    CHECK(say(h, client, "/admin god on"));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;   // bots own no connection
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    const std::uint16_t holeType = content().mobIndex("fire_ant_hole");
    const std::uint16_t antType = content().mobIndex("soldier_fire_ant");
    const int broodSize = content().mob(holeType).ambush.count;
    CHECK(broodSize > 0);

    // Down well clear of the flower first.
    adminSpawnAt(client, "fire_ant_hole", "common", world.get<Transform>(body).position + Vec2{600, 0});
    Entity hole = NULL_ENTITY;
    CHECK(h.stepUntil({&client}, [&] {
        Query<MobTag, MobType> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type) {
            if (hole == NULL_ENTITY && type.configIndex == holeType) hole = e;
        });
        return hole != NULL_ENTITY;
    }, 120));
    if (hole == NULL_ENTITY) { CHECK(false); return; }

    const auto brood = [&] {
        std::vector<Entity> out;
        Query<MobTag, MobType, HoleTether> ants{world};
        ants.without<Dead>();
        ants.each([&](Entity e, MobTag&, MobType& type, HoleTether& tether) {
            if (type.configIndex == antType && tether.hole == hole) out.push_back(e);
        });
        return out;
    };
    h.step(30, {&client});
    CHECK(brood().empty());

    // Right under the flower: its body sits on the hole and its ring sweeps
    // through it every tick from here on. Out they come, all of them at once.
    world.get<Transform>(hole).position = world.get<Transform>(body).position;
    CHECK(h.stepUntil({&client}, [&] { return !brood().empty(); }, 30));
    CHECK_EQ(static_cast<int>(brood().size()), broodSize);

    // The ring chews at it for two seconds and it never loses a point -- and
    // nothing more comes out of it.
    const double holeMax = world.get<Health>(hole).max;
    h.step(60, {&client});
    CHECK(world.isAlive(hole));
    if (!world.isAlive(hole)) return;
    CHECK_NEAR(world.get<Health>(hole).current, holeMax, 1e-9);
    CHECK(static_cast<int>(brood().size()) <= broodSize);

    // Every ant down to its last sliver, so the flower's own body and ring
    // finish them -- the ordinary kill path -- and the hole goes with the last.
    //
    // Back onto the hole first. Ten soldiers ramming a flower bounce it the
    // way gardn's do, and two seconds of it carries the flower hundreds of
    // units off the hole -- out past where a tethered soldier will follow it
    // before turning home, so the brood would never reach it.
    world.get<Transform>(body).position = world.get<Transform>(hole).position;
    world.get<Motion>(body).velocity = Vec2{0, 0};
    for (const Entity ant : brood()) world.get<Health>(ant).current = 0.01;
    CHECK(h.stepUntil({&client}, [&] { return !world.isAlive(hole); }, 600));
    CHECK(brood().empty());
}

TEST(a_termite_mound_leads_into_its_own_dungeon_and_falls_when_it_is_cleared) {
    // The whole dungeon through the shipping loop: in by standing on the
    // mound, out by the copy's pad (beside the mound, not wherever the pad's
    // targetMap says), back in to the SAME copy, and the mound falling with
    // loot the moment the last thing inside dies -- then everyone carried out.
    //
    // The shipped mound has no pad any more -- clearing it is the only way
    // out, since "fix termites" (5ffec410) took the pad off its map -- but a
    // copy's own pad still leads out beside the nest it was entered through,
    // and that is half of what this walks. So it boots on the shipped world
    // with the pad the mound had until then put back, where it stood.
    const std::string dir = stageShippedDataDir("termite-dungeon", "termite_mound", [](Json& map) {
        const int id = map["nextobjectid"].asInt(1);
        for (Json& layer : map["layers"].items()) {
            const Json& read = layer;
            if (read["name"].asString() != "teleporters") continue;
            // Drawn back in since: that pad is the one to walk.
            if (!read["objects"].items().empty()) return true;
            Json target = Json::object();
            target["name"] = Json("targetMap");
            target["type"] = Json("string");
            target["value"] = Json("jungle");
            Json pad = Json::object();
            pad["id"] = Json(id);
            pad["name"] = Json("");
            pad["type"] = Json("");
            pad["point"] = Json(true);
            pad["x"] = Json(1280);
            pad["y"] = Json(1280);
            pad["width"] = Json(0);
            pad["height"] = Json(0);
            pad["rotation"] = Json(0);
            pad["visible"] = Json(true);
            pad["properties"] = Json::array();
            pad["properties"].push(std::move(target));
            layer["objects"].push(std::move(pad));
            map["nextobjectid"] = Json(id + 1);
            return true;
        }
        return false;
    });
    CHECK(!dir.empty());
    if (dir.empty()) return;
    // Removed on every way out, and only after the server reading it is gone.
    struct Cleanup {
        std::string dir;
        ~Cleanup() { removeDataDir(dir); }
    } cleanup{dir};
    Harness h("cmd-termite-dungeon", [](const std::string& path) {
        seedUser(path, "digger", "password7", true);
    }, dir);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "digger", "password7"));
    client.joinGame(1920, 1080, {}, "Digger");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    CHECK(say(h, client, "/admin god on"));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    const Realm home = world.get<Transform>(body).realm;

    const std::uint16_t moundType = content().mobIndex("termite_mound");
    const std::uint16_t overmindType = content().mobIndex("termite_overmind");
    // Uncommon, not common: a common mob rolls each drop row on its own and
    // may leave nothing, and the loot is part of what is under test.
    adminSpawnAt(client, "termite_mound", "uncommon", world.get<Transform>(body).position + Vec2{600, 0});
    Entity mound = NULL_ENTITY;
    CHECK(h.stepUntil({&client}, [&] {
        Query<MobTag, MobType> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type) {
            if (mound == NULL_ENTITY && type.configIndex == moundType) mound = e;
        });
        return mound != NULL_ENTITY;
    }, 120));
    if (mound == NULL_ENTITY) { CHECK(false); return; }
    const Vec2 moundAt = world.get<Transform>(mound).position;

    const auto realmOf = [&] { return world.get<Transform>(body).realm; };
    const auto isCopy = [&](Realm realm) {
        const MapData* map = h.server.worldMaps().forRealm(realm);
        return map != nullptr && map->templateId() == "termite_mound";
    };
    const auto dwellers = [&](Realm realm, std::uint16_t onlyType = kInvalidIndex) {
        std::vector<Entity> out;
        Query<MobTag, MobType, Transform> mobs{world};
        mobs.without<Dead>();
        mobs.each([&](Entity e, MobTag&, MobType& type, Transform& transform) {
            if (transform.realm != realm) return;
            if (onlyType != kInvalidIndex && type.configIndex != onlyType) return;
            out.push_back(e);
        });
        return out;
    };

    // In: stand on it.
    world.get<Transform>(body).position = moundAt;
    CHECK(h.stepUntil({&client}, [&] { return isCopy(realmOf()); }, 120));
    const Realm inside = realmOf();
    if (!isCopy(inside)) return;
    CHECK(client.view().realm() == inside || h.stepUntil({&client}, [&] {
        return client.view().realm() == inside;
    }, 30));
    CHECK_EQ(dwellers(inside, overmindType).size(), std::size_t(1));
    // 30 termites, ten of each kind, spread over the room rather than rolled
    // one by one:
    // thirty independent rolls over this map leave some pair within a body
    // width or two, an even spread keeps every one of them far apart.
    CHECK_EQ(dwellers(inside, content().mobIndex("worker_termite")).size(), std::size_t(10));
    CHECK_EQ(dwellers(inside, content().mobIndex("baby_termite")).size(), std::size_t(10));
    CHECK_EQ(dwellers(inside, content().mobIndex("soldier_termite")).size(), std::size_t(10));
    {
        std::vector<Vec2> at;
        for (const Entity mob : dwellers(inside)) {
            if (world.get<MobType>(mob).configIndex != overmindType) {
                at.push_back(world.get<Transform>(mob).position);
            }
        }
        double closest = 1e18;
        for (std::size_t i = 0; i < at.size(); ++i) {
            for (std::size_t j = i + 1; j < at.size(); ++j) closest = std::min(closest, distance(at[i], at[j]));
        }
        CHECK(closest > 400);
    }
    // A hit on one termite is shared with those connected to it (the
    // "psionic connection"), and a termite that only took a share is still
    // numbered: its damage event reaches the flower watching it.
    {
        const Vec2 at = world.get<Transform>(body).position;
        Entity struck = NULL_ENTITY;
        Entity onlyShared = NULL_ENTITY;
        for (const Entity mob : dwellers(inside, content().mobIndex("worker_termite"))) {
            if (struck == NULL_ENTITY) {
                struck = mob;
                world.get<Transform>(mob).position = at + Vec2{30, 0};
            } else if (onlyShared == NULL_ENTITY) {
                // Connected to the struck one (within 100 of it; more above
                // common) but on its far side, clear of the flower.
                onlyShared = mob;
                world.get<Transform>(mob).position = at + Vec2{30.0 + 90.0, 0};
            }
        }
        CHECK(onlyShared != NULL_ENTITY);
        if (onlyShared != NULL_ENTITY) {
            const double before = world.get<Health>(onlyShared).current;
            const std::uint32_t id = world.get<NetId>(onlyShared).value;
            bool numbered = false;
            CHECK(h.stepUntil({&client}, [&] {
                for (const ViewEvent& event : client.view().events()) {
                    if (event.kind == net::EventKind::Damage && event.netId == id) numbered = true;
                }
                return numbered;
            }, 40));
            CHECK(world.get<Health>(onlyShared).current < before);
        }
    }
    // The overmind is the one queen that lays nothing: three seconds later
    // the brood is still exactly what was put down.
    h.step(90, {&client});
    CHECK_EQ(dwellers(inside, content().mobIndex("soldier_termite")).size(), std::size_t(10));
    CHECK_EQ(dwellers(inside).size(), std::size_t(31));
    // The mound outside is unhurt and still there.
    CHECK(world.isAlive(mound) && !world.has<Dead>(mound));

    // Out by the pad, which puts the flower down beside the mound.
    const MapData* map = h.server.worldMaps().forRealm(inside);
    Vec2 pad;
    bool padFound = false;
    for (const MapElement& element : map->elements()) {
        if (element.kind != MapElementKind::Teleporter) continue;
        pad = element.centre();
        padFound = true;
    }
    CHECK(padFound);
    if (!padFound) return;
    h.step(160, {&client});   // past the arrival's pad lockout
    CHECK(h.stepUntil({&client}, [&] {
        if (realmOf() == home) return true;
        world.get<Transform>(body).position = pad;
        return false;
    }, 200));
    const double rim = world.get<Body>(mound).radius;
    CHECK(distance(world.get<Transform>(body).position, moundAt) > rim);
    CHECK(distance(world.get<Transform>(body).position, moundAt) < rim + 400);

    // Back in: the same copy, with the same brood.
    h.step(160, {&client});
    CHECK(h.stepUntil({&client}, [&] {
        if (isCopy(realmOf())) return true;
        world.get<Transform>(body).position = moundAt;
        return false;
    }, 200));
    CHECK(realmOf() == inside);

    // Everything the flower did in there was forwarded to the mound's ledger.
    // A fight from slivers is worth slivers, though, and the loot floor is 1%
    // of the mound -- so the ledger is handed a real fight's worth first.
    const double handedCredit = world.get<Health>(mound).max;
    world.get<Bounty>(mound).credit(body, handedCredit);
    double ledgerCredit = 0.0;

    // Clear it: every termite at a sliver and brought to the flower, so its
    // own body finishes them the ordinary way. Armour off too: this flower
    // carries no petals, and its bare body hits for less than a rare
    // overmind wears.
    CHECK(h.stepUntil({&client}, [&] {
        const Vec2 at = world.get<Transform>(body).position;
        for (const Entity mob : dwellers(inside)) {
            if (Armor* armor = world.tryGet<Armor>(mob)) armor->amount = 0.0;
            world.get<Health>(mob).current = std::min(world.get<Health>(mob).current, 0.01);
            world.get<Transform>(mob).position = at + Vec2{30, 0};
        }
        if (world.isAlive(mound)) {
            for (const Bounty::Share& share : world.get<Bounty>(mound).contributors) {
                if (share.player == body) ledgerCredit = share.damage;
            }
        }
        return !world.isAlive(mound) || world.has<Dead>(mound);
    }, 900));
    // The flower's swings in there reached the mound's ledger on top.
    CHECK(ledgerCredit > handedCredit);

    // The mound fell in the overworld and left loot where it stood; the party
    // is carried out beside it.
    bool dropped = false;
    CHECK(h.stepUntil({&client}, [&] {
        Query<DropItem, Transform> drops{world};
        drops.each([&](Entity, DropItem&, Transform& transform) {
            if (transform.realm == home && distance(transform.position, moundAt) < 300) dropped = true;
        });
        return dropped;
    }, 30));
    CHECK(h.stepUntil({&client}, [&] { return realmOf() == home; }, 300));
    CHECK(distance(world.get<Transform>(body).position, moundAt) < rim + 400);
    CHECK(dwellers(inside).empty());
}

TEST(termites_out_in_the_open_share_a_hit_with_the_ones_near_them) {
    // The psionic connection is distance and nothing else: three workers
    // spawned in the overworld, two of them 90 apart and the third 600 away,
    // and only the pair shares what the flower's body does to one of them --
    // as the flower's own hit, which is what provokes a neutral worker.
    Harness h("cmd-termite-open", [](const std::string& path) {
        seedUser(path, "warden", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "warden", "password7"));
    client.joinGame(1920, 1080, {}, "Warden");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));
    CHECK(say(h, client, "/admin god on"));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    const Vec2 at = world.get<Transform>(body).position;

    const std::uint16_t worker = content().mobIndex("worker_termite");
    for (int i = 0; i < 3; ++i) adminSpawnAt(client, "worker_termite", "common", at + Vec2{0, 900.0 + 50 * i});
    std::vector<Entity> workers;
    CHECK(h.stepUntil({&client}, [&] {
        workers.clear();
        Query<MobTag, MobType> mobs{world};
        mobs.each([&](Entity e, MobTag&, MobType& type) {
            if (type.configIndex == worker) workers.push_back(e);
        });
        return workers.size() == 3;
    }, 120));
    if (workers.size() != 3) return;
    for (const Entity e : workers) {
        CHECK(world.has<ColonyMember>(e));
        // Deep enough that the flower's body never finishes one mid-test.
        world.get<Health>(e).max = world.get<Health>(e).current = 1e6;
    }

    const Entity struck = workers[0];
    const Entity partner = workers[1];
    const Entity straggler = workers[2];
    const double partnerBefore = world.get<Health>(partner).current;
    const double stragglerBefore = world.get<Health>(straggler).current;
    CHECK(h.stepUntil({&client}, [&] {
        const Vec2 flower = world.get<Transform>(body).position;
        world.get<Transform>(struck).position = flower + Vec2{30, 0};
        world.get<Transform>(partner).position = flower + Vec2{120, 0};
        world.get<Transform>(straggler).position = flower + Vec2{-600, 0};
        return world.get<Health>(partner).current < partnerBefore;
    }, 60));
    CHECK_NEAR(world.get<Health>(straggler).current, stragglerBefore, 1e-9);
    // The share is the flower's hit on the partner: on its ledger, and a
    // neutral worker turns on whoever hurt it.
    const Bounty& ledger = world.get<Bounty>(partner);
    CHECK_EQ(ledger.contributors.size(), std::size_t(1));
    if (!ledger.contributors.empty()) CHECK(ledger.contributors[0].player == body);
    CHECK(h.stepUntil({&client}, [&] {
        const MobAi* brain = world.tryGet<MobAi>(partner);
        return brain != nullptr && brain->target == body;
    }, 10));
}

TEST(a_boss_no_player_killed_is_still_announced) {
    // Nobody to credit -- a boss finished by poison with no flower behind it,
    // the same as one a mob killed -- still gets its line in chat, just
    // without the "by".
    Harness h("cmd-boss-uncredited", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(sawText(client, "Spawned super bee"));

    const std::uint16_t bee = content().mobIndex("bee");
    int poisoned = 0;
    std::vector<Entity> supers;
    Query<MobTag, MobType> mobs{h.server.world()};
    mobs.each([&](Entity e, MobTag&, MobType& type) {
        if (type.configIndex == bee && type.rarity == Rarity::Super) supers.push_back(e);
    });
    for (Entity e : supers) {
        Afflictions* afflictions = h.server.world().tryGet<Afflictions>(e);
        if (afflictions == nullptr) {
            h.server.world().add<Afflictions>(e, Afflictions{});
            afflictions = h.server.world().tryGet<Afflictions>(e);
        }
        afflictions->poisonStacks.push_back({NULL_ENTITY, 1e12, 1e18});
        ++poisoned;
    }
    CHECK(poisoned > 0);

    CHECK(h.stepUntil({&client}, [&] { return sawText(client, "Super bee has been defeated!"); },
                      120));
    CHECK(!sawText(client, "Super bee has been defeated by"));
}

TEST(killall_announces_the_bosses_it_removes) {
    // killall removes mobs without killing them, so the death path never sees
    // them; it announces the bosses it clears itself, with nobody credited.
    Harness h("cmd-killall-announce", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(sawText(client, "Spawned super bee"));
    CHECK(say(h, client, "/admin killall"));
    CHECK(h.stepUntil({&client}, [&] { return sawText(client, "Super bee has been defeated!"); },
                      120));
}

TEST(a_dead_summon_is_not_announced) {
    // A flower's summon is not a boss: it was never announced on the way in,
    // and losing one says nothing in chat either, killer or no killer.
    Harness h("cmd-summon-unannounced", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    client.joinGame(1920, 1080, {}, "Boss");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }, 200));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> people{world};
    people.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    CHECK(say(h, client, "/admin spawn bee super"));
    CHECK(sawText(client, "Spawned super bee"));

    const std::uint16_t bee = content().mobIndex("bee");
    std::vector<Entity> supers;
    Query<MobTag, MobType> mobs{world};
    mobs.each([&](Entity e, MobTag&, MobType& type) {
        if (type.configIndex == bee && type.rarity == Rarity::Super) supers.push_back(e);
    });
    CHECK(!supers.empty());
    for (Entity e : supers) {
        world.add<Pet>(e, Pet{body, 0});
        Afflictions* afflictions = world.tryGet<Afflictions>(e);
        if (afflictions == nullptr) {
            world.add<Afflictions>(e, Afflictions{});
            afflictions = world.tryGet<Afflictions>(e);
        }
        afflictions->poisonStacks.push_back({NULL_ENTITY, 1e12, 1e18});
    }

    CHECK(h.stepUntil({&client}, [&] {
        for (Entity e : supers) {
            if (world.isAlive(e)) return false;
        }
        return true;
    }, 120));
    h.step(10, {&client});
    CHECK(!sawText(client, "Super bee has been defeated"));
}
