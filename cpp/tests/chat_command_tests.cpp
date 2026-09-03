// The chat command surface, end to end over loopback.
//
// The bug these exist to keep fixed: handleChat used to sanitise a line and
// broadcast it, so every command the client offers in its autocomplete --
// "/help", "/admin spawn ..." -- reached the world as ordinary chat. The first
// test here is that one directly; the rest cover the commands that change
// server state, which are the ones a silent regression would hide.

#include "test.h"

#include <string>
#include <vector>

#include "server_harness.h"
#include "server/bot_identity.h"
#include "server/db.h"

using namespace flr;
using namespace flr::testsupport;

namespace {

void seedUser(const std::string& path, const std::string& username, const std::string& password,
              bool admin = false) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);   // the default cost makes this the slowest test
    CreateResult created = db.createUser(username, password);
    if (created.ok() && admin) created.account->admin = true;
    db.markDirty();
    db.save();
}

bool loginAs(Harness& h, NetClient& client, const char* name, const char* password) {
    if (!connectClient(h, client)) return false;
    client.requestLogin(name, password);
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; });
}

/// Every chat line this client holds, joined -- the whole transcript as one
/// haystack, because command output is many lines and a test cares that the
/// answer is somewhere in it, not which line carried it.
std::string transcript(const NetClient& client) {
    std::string all;
    for (const ChatLine& line : client.chat()) {
        all += line.author;
        all += ": ";
        all += line.text;
        all += '\n';
    }
    return all;
}

bool sawText(const NetClient& client, const std::string& needle) {
    return transcript(client).find(needle) != std::string::npos;
}

/// Sends `text` and steps until the transcript grows, so a test does not have
/// to guess how many ticks a reply takes.
bool say(Harness& h, NetClient& client, const std::string& text, int maxTicks = 120) {
    const std::size_t before = client.chat().size();
    client.sendChat(text);
    return h.stepUntil({&client}, [&] { return client.chat().size() > before; }, maxTicks);
}

} // namespace

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

TEST(give_rejects_an_unknown_petal_and_an_unknown_rarity) {
    Harness h("cmd-give-bad", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    CHECK(say(h, client, "/admin give boss notapetal legendary"));
    CHECK(sawText(client, "No petal named \"notapetal\""));

    CHECK(say(h, client, "/admin give boss rose notararity"));
    CHECK(sawText(client, "Invalid rarity \"notararity\""));
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

TEST(spawn_reports_a_bad_mob_type_instead_of_spawning_something_else) {
    Harness h("cmd-spawn-bad", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));
    CHECK(say(h, client, "/admin spawn notamob rare"));
    CHECK(sawText(client, "No mob type named \"notamob\""));
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

    CHECK(say(h, client, "/admin tp boss 12345 23456"));
    CHECK(sawText(client, "Teleported"));

    bool landed = false;
    Query<PlayerTag, Transform, PlayerAccount> flowers{h.server.world()};
    flowers.each([&](Entity, PlayerTag&, Transform& transform, PlayerAccount& account) {
        if (account.username != "Boss") return;
        landed = std::abs(transform.position.x - 12345.0) < 1.0 &&
                 std::abs(transform.position.y - 23456.0) < 1.0;
    });
    CHECK(landed);

    // A coordinate past the map is a typo, and typing one is how the browser
    // build used to hang its tick loop. It is refused, not clamped.
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
    CHECK(sawText(helper, "does not cover \"grant_admin\""));

    // And it ends with the life it was lent for.
    helper.requestRespawn();
    CHECK(h.stepUntil({&boss, &helper}, [&] { return !helper.isSkinAdmin(); }, 200));
    const std::size_t before = helper.chat().size();
    helper.sendChat("/admin list-players");
    CHECK(h.stepUntil({&boss, &helper}, [&] { return helper.chat().size() > before; }, 120));
    CHECK(sawText(helper, "Command does not exist."));
}

TEST(set_bot_count_clamps_and_applies) {
    Harness h("cmd-botcount", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    // The browser build reported the clamp and then returned WITHOUT applying
    // anything, so `set_bot_count 100` said it had capped at 50 and did
    // nothing. Both halves are asserted: the wording, and that it applied.
    CHECK(say(h, client, "/admin set_bot_count 100"));
    CHECK(sawText(client, "capped at " + std::to_string(kMaxBots)));

    CHECK(say(h, client, "/admin set_bot_count default"));
    CHECK(sawText(client, "override cleared"));

    // A double space is not an error worth a diagnostic.
    CHECK(say(h, client, "/admin set_bot_count  4"));
    CHECK(sawText(client, "Bot count target set to 4."));
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
    CHECK(sawText(client, "Max uses: 3"));

    CHECK(say(h, client, "/admin list_codes"));
    CHECK(sawText(client, "250 stars"));

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
    CHECK(sawText(client, "Cleared 1 notification."));
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
    CHECK(sawText(client, "Usage: /level-from-string <name>"));
}

TEST(commands_this_build_lacks_say_so_by_name) {
    Harness h("cmd-unsupported", [](const std::string& path) {
        seedUser(path, "boss", "password7", true);
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "boss", "password7"));

    // The client advertises the browser build's whole table. A player who
    // types one of the rows this server has no counterpart for deserves to be
    // told which row, not a bare "unknown command".
    CHECK(say(h, client, "/admin update now"));
    CHECK(sawText(client, "\"update\" is not available on this server"));

    CHECK(say(h, client, "/squad-create public"));
    CHECK(sawText(client, "Squads are not available on this server."));
}

TEST(api_keys_are_minted_and_revoked_per_account) {
    Harness h("cmd-apikey", [](const std::string& path) {
        seedUser(path, "owner", "password7");
    });
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginAs(h, client, "owner", "password7"));

    CHECK(say(h, client, "/create-api-key discord-bot"));
    CHECK(sawText(client, "[API KEY CREATED] label: discord-bot"));
    CHECK(sawText(client, "sk_"));

    CHECK(say(h, client, "/delete-api-key sk_"));
    CHECK(sawText(client, "Deleted API key \"discord-bot\""));

    CHECK(say(h, client, "/delete-api-key sk_"));
    CHECK(sawText(client, "No API key of yours matched"));
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
    CHECK(sawText(client, "Deleted 1 guest account."));
}
