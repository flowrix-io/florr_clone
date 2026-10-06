#include "test.h"

#include "client/net_client.h"
#include "client/interpolation.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server/systems/mob_ai.h"
#include "server_harness.h"
#include "shared/game/config.h"

#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using namespace flix;

// These tests answer "is it still a multiplayer game": a real server object,
// real sockets on loopback, real clients speaking the real protocol.
// Everything below the socket is the shipping code path.

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::Harness;

std::size_t playersVisibleTo(const NetClient& client) {
    std::size_t n = 0;
    for (const auto& e : client.view().entities()) {
        if (e.second.kind == net::EntityKind::Player) ++n;
    }
    return n;
}

} // namespace

TEST(malformed_and_replayed_inputs_cannot_replace_player_intent) {
    Harness h("input-validation");
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("inputcheck", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    Entity player = NULL_ENTITY;
    Query<PlayerTag, PlayerInput> players{h.server.world()};
    players.each([&](Entity e, PlayerTag&, PlayerInput&) { player = e; });
    CHECK(player != NULL_ENTITY);
    if (player == NULL_ENTITY) return;
    net::InputFrame input;
    input.sequence = 1;
    client.sendInput(input);
    CHECK(h.stepUntil({&client}, [&] {
        return h.server.world().get<PlayerInput>(player).current.sequence == 1;
    }));
    input.sequence = 2;
    input.flags = 0x80;
    client.sendInput(input);
    h.step(5, {&client});
    CHECK_EQ(h.server.world().get<PlayerInput>(player).current.sequence, 1u);
    input.flags = net::InputDefend;
    client.sendInput(input);
    CHECK(h.stepUntil({&client}, [&] {
        return h.server.world().get<PlayerInput>(player).current.sequence == 2;
    }));
    input.sequence = 1;
    input.flags = net::InputAttack;
    client.sendInput(input);
    h.step(5, {&client});
    CHECK(h.server.world().get<PlayerInput>(player).current.defending());
    CHECK(!h.server.world().get<PlayerInput>(player).current.attacking());
}

TEST(a_client_connects_registers_and_joins) {
    Harness h("join");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));

    client.requestRegister("alice", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    CHECK(!client.sessionToken().empty());
    CHECK_EQ(client.profile().username, std::string("alice"));

    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    // Rendering uses this local copy, so it must be byte-for-byte the server
    // terrain that movement and collisions are using.
    CHECK(std::equal(client.terrain().tiles(),
                     client.terrain().tiles() + client.terrain().tileCount(),
                     h.server.terrain().tiles()));

    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));
    CHECK(client.view().self().maxHealth > 0);
    CHECK(client.view().self().health > 0);
    CHECK_EQ(client.view().self().level, 1);
}

TEST(a_wrong_password_is_refused_and_a_right_one_is_not) {
    Harness h("auth");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("bob", "correct-horse");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));

    NetClient wrong;
    CHECK(connectClient(h, wrong));
    wrong.authAnswered = false;
    wrong.requestLogin("bob", "wrong");
    CHECK(h.stepUntil({&wrong}, [&] { return wrong.authAnswered; }));
    CHECK_EQ(static_cast<int>(wrong.authStatus), static_cast<int>(net::AuthStatus::BadCredentials));
    CHECK(wrong.status() != NetClient::Status::LoggedIn);

    NetClient right;
    CHECK(connectClient(h, right));
    right.authAnswered = false;
    right.requestLogin("bob", "correct-horse");
    CHECK(h.stepUntil({&right}, [&] { return right.authAnswered; }));
    CHECK_EQ(static_cast<int>(right.authStatus), static_cast<int>(net::AuthStatus::Ok));
}

TEST(a_changed_password_replaces_the_old_one) {
    Harness h("changepw");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "changer", "first-password"));

    client.requestChangePassword("first-password", "second-password");
    CHECK(h.stepUntil({&client}, [&] { return client.passwordOutcome().pending; }));
    CHECK(client.passwordOutcome().ok);
    // The session that asked survives it. A change-password answer is not an
    // auth answer, and must not put this client back on the login form.
    CHECK(client.status() == NetClient::Status::LoggedIn);

    NetClient stale;
    CHECK(connectClient(h, stale));
    stale.authAnswered = false;
    stale.requestLogin("changer", "first-password");
    CHECK(h.stepUntil({&stale}, [&] { return stale.authAnswered; }));
    CHECK_EQ(static_cast<int>(stale.authStatus), static_cast<int>(net::AuthStatus::BadCredentials));

    NetClient fresh;
    CHECK(connectClient(h, fresh));
    fresh.authAnswered = false;
    fresh.requestLogin("changer", "second-password");
    CHECK(h.stepUntil({&fresh}, [&] { return fresh.authAnswered; }));
    CHECK_EQ(static_cast<int>(fresh.authStatus), static_cast<int>(net::AuthStatus::Ok));
}

TEST(a_change_password_needs_the_current_one) {
    Harness h("changepw-wrong");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "guard", "right-password"));

    client.requestChangePassword("not-the-password", "brand-new-password");
    CHECK(h.stepUntil({&client}, [&] { return client.passwordOutcome().pending; }));
    CHECK(!client.passwordOutcome().ok);
    CHECK(!client.passwordOutcome().message.empty());

    // Nothing moved: an account whose owner mistyped is not half-changed, and
    // the token it was holding is not revoked either.
    CHECK(!client.sessionTokenRenewed);
    NetClient again;
    CHECK(connectClient(h, again));
    again.authAnswered = false;
    again.requestLogin("guard", "right-password");
    CHECK(h.stepUntil({&again}, [&] { return again.authAnswered; }));
    CHECK_EQ(static_cast<int>(again.authStatus), static_cast<int>(net::AuthStatus::Ok));
}

TEST(a_new_password_the_rules_refuse_never_reaches_the_account) {
    Harness h("changepw-rules");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "hasty", "long-enough-password"));

    // Under Database::validPassword's eight characters. The client's own form
    // catches this first; the server is what makes it true.
    client.requestChangePassword("long-enough-password", "short");
    CHECK(h.stepUntil({&client}, [&] { return client.passwordOutcome().pending; }));
    CHECK(!client.passwordOutcome().ok);
    CHECK(!client.passwordOutcome().message.empty());

    NetClient again;
    CHECK(connectClient(h, again));
    again.authAnswered = false;
    again.requestLogin("hasty", "long-enough-password");
    CHECK(h.stepUntil({&again}, [&] { return again.authAnswered; }));
    CHECK_EQ(static_cast<int>(again.authStatus), static_cast<int>(net::AuthStatus::Ok));
}

TEST(changing_a_password_revokes_the_tokens_it_replaces) {
    Harness h("changepw-tokens");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "rotator", "old-password1"));
    const std::string before = client.sessionToken();
    CHECK(!before.empty());

    client.requestChangePassword("old-password1", "new-password2");
    CHECK(h.stepUntil({&client}, [&] { return client.passwordOutcome().pending; }));
    CHECK(client.passwordOutcome().ok);

    // This client is holding a REPLACEMENT, not the token the change revoked.
    const std::string after = client.sessionToken();
    CHECK(!after.empty());
    CHECK(after != before);
    CHECK(client.sessionTokenRenewed);

    // A token minted before the change resumes nothing, which is most of the
    // point: a session somebody else was holding is what a password change is
    // meant to end, and thirty days is how long it would otherwise outlive it.
    NetClient stolen;
    CHECK(connectClient(h, stolen));
    stolen.authAnswered = false;
    stolen.resumeSession(before);
    CHECK(h.stepUntil({&stolen}, [&] { return stolen.authAnswered; }));
    CHECK_EQ(static_cast<int>(stolen.authStatus),
             static_cast<int>(net::AuthStatus::SessionExpired));

    // And the replacement is a real session, not a string that merely differs.
    NetClient resumed;
    CHECK(connectClient(h, resumed));
    resumed.authAnswered = false;
    resumed.resumeSession(after);
    CHECK(h.stepUntil({&resumed}, [&] { return resumed.authAnswered; }));
    CHECK_EQ(static_cast<int>(resumed.authStatus), static_cast<int>(net::AuthStatus::Ok));
}

TEST(a_content_mismatch_is_reported_rather_than_misparsed) {
    Harness h("proto");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    // Content the server does not have. The handshake must reject it outright
    // instead of letting the two sides disagree about every stat all session.
    client.contentHash = 0xDEADBEEF;
    CHECK(client.connect("127.0.0.1", h.port));
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Failed; }));
    CHECK(!client.lastError().empty());
}

TEST(a_refused_handshake_is_not_redialled) {
    Harness h("proto-noretry");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    client.contentHash = 0xDEADBEEF;
    CHECK(client.connect("127.0.0.1", h.port));
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Failed; }));

    // A server that refuses this build refuses it every time, so nothing
    // redials. What has to change is the build, which is what the flag says.
    CHECK(!client.reconnecting());
    CHECK(client.staleBuild);
}

TEST(a_client_redials_a_server_that_restarted) {
    const auto seed = [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        db.setPasswordCost(4);
        db.createUser("returner", "password7");
        db.markDirty();
        db.save();
    };

    NetClient client;
    std::uint16_t port = 0;
    {
        Harness first("restart-a", seed);
        if (!first.ready) { CHECK(false); return; }
        port = first.port;
        CHECK(connectClient(first, client));
        client.requestLogin("returner", "password7");
        CHECK(first.stepUntil({&client},
                              [&] { return client.status() == NetClient::Status::LoggedIn; }));
    }
    // The server process is gone -- which is exactly what a restart looks like
    // from here.
    for (int i = 0; i < 200 && client.status() != NetClient::Status::Failed; ++i) {
        client.poll(1);
    }
    CHECK(client.status() == NetClient::Status::Failed);
    CHECK(client.reconnecting());
    CHECK(!client.reconnected);

    // The same port, because the harness takes the lowest free one and the
    // first server has just released it. A client that redialled somewhere
    // else would not be testing anything.
    Harness second("restart-b", seed);
    if (!second.ready) { CHECK(false); return; }
    CHECK(second.port == port);

    // The backoff starts at a second, so this is real elapsed time rather than
    // simulated ticks; the budget covers two or three attempts.
    const bool back = second.stepUntil({&client},
                                       [&] { return client.status() == NetClient::Status::Ready ||
                                                    client.status() == NetClient::Status::LoggedIn; },
                                       2000);
    CHECK(back);
    CHECK(client.reconnected);

    // And the socket is genuinely usable again, not merely open: the account
    // goes back in over it.
    //
    // With a password rather than the token this client is still holding.
    // Sessions live in the database, and these two harnesses own separate
    // files -- on a real restart the same inventory.json comes back up and the
    // token resumes, which is what App::onReconnected presents.
    client.requestLogin("returner", "password7");
    CHECK(second.stepUntil({&client},
                           [&] { return client.status() == NetClient::Status::LoggedIn; }));
}

TEST(two_players_see_each_other_move) {
    Harness h("twoplayers");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, bob;
    CHECK(connectClient(h, alice));
    CHECK(connectClient(h, bob));

    alice.requestRegister("alice", "password1");
    bob.requestRegister("bob", "password2");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::LoggedIn &&
               bob.status() == NetClient::Status::LoggedIn;
    }));

    // The nameplate carries the flower's name, not the account's, so the two
    // bodies are told apart below by the name sent here.
    alice.joinGame(1280, 720, {}, "alice");
    bob.joinGame(1280, 720, {}, "bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing;
    }));

    // Stand them next to each other. Spawns are scattered across the map's
    // beginner zone, which is thousands of units wide -- far enough apart that
    // whether two arrivals can see one another is a coin toss, and this test is
    // about replication, not about where the map puts people.
    World& world = h.server.world();
    Entity bobBody = NULL_ENTITY;
    Vec2 aliceAt{};
    Query<PlayerTag, PlayerAccount, Transform> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account, Transform& transform) {
        if (account.username == "alice") aliceAt = transform.position;
        else if (account.username == "bob") bobBody = e;
    });
    CHECK(bobBody != NULL_ENTITY);
    if (bobBody != NULL_ENTITY) world.get<Transform>(bobBody).position = aliceAt + Vec2{60, 0};

    // And clear the ground in front of them. The door is a single tile inside
    // the garden's common band, which the band fill stocked before anyone
    // arrived, and a mob standing (or wandering) in Alice's lane shoves her
    // sideways as she runs through it -- a real collision, not a replication
    // fault, and not what this test measures.
    std::vector<Entity> bystanders;
    Query<MobTag, Transform> mobs{world};
    mobs.each([&](Entity e, MobTag&, Transform& transform) {
        if (distanceSq(transform.position, aliceAt) < 4000.0 * 4000.0) bystanders.push_back(e);
    });
    for (Entity e : bystanders) world.destroy(e);

    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return playersVisibleTo(alice) >= 2 && playersVisibleTo(bob) >= 2;
    }));

    // Find Alice's body in Bob's view, drive Alice, and confirm Bob sees the
    // movement. That is the whole multiplayer contract in one assertion.
    const std::uint32_t aliceNetId = alice.view().self().netId;
    CHECK(aliceNetId != 0);
    CHECK(bob.view().entities().count(aliceNetId) == 1);
    const Vec2 before = bob.view().entities().at(aliceNetId).targetPosition;

    net::InputFrame input;
    input.moveAngle = 0;          // straight along +x
    input.moveStrength = 1.0;
    for (int i = 0; i < 40; ++i) {
        input.sequence = static_cast<std::uint32_t>(i + 1);
        alice.sendInput(input);
        h.step(1, {&alice, &bob});
    }

    CHECK(bob.view().entities().count(aliceNetId) == 1);
    const Vec2 after = bob.view().entities().at(aliceNetId).targetPosition;
    // Forty ticks at full speed is well over a second of running; less than a
    // hundred units means input is not reaching the simulation.
    CHECK(after.x - before.x > 100.0);
    CHECK_NEAR(after.y, before.y, 60.0);
}

TEST(chat_reaches_the_other_player) {
    Harness h("chat");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, bob;
    CHECK(connectClient(h, alice));
    CHECK(connectClient(h, bob));
    alice.requestRegister("alice", "password1");
    bob.requestRegister("bob", "password2");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::LoggedIn &&
               bob.status() == NetClient::Status::LoggedIn;
    }));

    const std::size_t before = bob.chat().size();
    alice.sendChat("hello bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] { return bob.chat().size() > before; }));

    bool found = false;
    for (const ChatLine& line : bob.chat()) {
        if (line.text == "hello bob" && line.author == "alice") found = true;
    }
    CHECK(found);
}

TEST(a_new_session_opens_on_the_conversation_already_in_progress) {
    // A client that has just loaded sits on the title screen with an empty
    // transcript unless the server hands it what was said before it arrived.
    Harness h("chat-backlog", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(connectClient(h, alice));
    alice.requestRegister("alice", "password1");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::LoggedIn; }));
    alice.sendChat("said before carol came");
    CHECK(h.stepUntil({&alice}, [&] { return !alice.chat().empty(); }));

    NetClient carol;
    CHECK(connectClient(h, carol));
    carol.requestRegister("carol", "password3");
    CHECK(h.stepUntil({&alice, &carol}, [&] { return !carol.chat().empty(); }));
    alice.sendChat("said after");
    CHECK(h.stepUntil({&alice, &carol}, [&] { return carol.chat().size() >= 2; }));

    // Once each, backlog first: the replay and the live stream meet exactly.
    const auto count = [&](const std::string& text) {
        return std::count_if(carol.chat().begin(), carol.chat().end(),
                             [&](const ChatLine& line) { return line.text == text; });
    };
    CHECK_EQ(count("said before carol came"), 1);
    CHECK_EQ(count("said after"), 1);
    if (carol.chat().size() >= 2) {
        CHECK_EQ(carol.chat()[0].text, std::string("said before carol came"));
        CHECK_EQ(carol.chat()[0].author, std::string("alice"));
        CHECK_EQ(carol.chat()[0].speakerNetId, std::uint32_t{0});
        CHECK(carol.chat()[0].wallClockMillis > 0);
        CHECK_EQ(carol.chat()[1].text, std::string("said after"));
    }

    // Signing in again -- what a reconnect does -- is sent the backlog again,
    // and a client that already holds it must not print it twice.
    carol.authAnswered = false;
    carol.resumeSession(carol.sessionToken());
    CHECK(h.stepUntil({&alice, &carol}, [&] { return carol.authAnswered; }));
    h.step(5, {&alice, &carol});
    CHECK_EQ(count("said before carol came"), 1);
    CHECK_EQ(count("said after"), 1);
}

TEST(a_spoken_line_is_anchored_to_the_speakers_body) {
    // The whole point of the speaker id on the wire: a listener has to be able
    // to find the flower that said it in their OWN view, which means the id is
    // the one the snapshot stream uses and not an index into anything local.
    Harness h("bubble");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, bob;
    CHECK(connectClient(h, alice));
    CHECK(connectClient(h, bob));
    alice.requestRegister("alice", "password1");
    bob.requestRegister("bob", "password2");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::LoggedIn &&
               bob.status() == NetClient::Status::LoggedIn;
    }));
    alice.joinGame(1280, 720, {}, "alice");
    bob.joinGame(1280, 720, {}, "bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing &&
               alice.view().self().netId != 0;
    }));

    const std::size_t before = bob.chat().size();
    alice.sendChat("over my head");
    CHECK(h.stepUntil({&alice, &bob}, [&] { return bob.chat().size() > before; }));

    const std::uint32_t aliceNetId = alice.view().self().netId;
    bool anchored = false;
    for (const ChatLine& line : bob.chat()) {
        if (line.text == "over my head") anchored = line.speakerNetId == aliceNetId;
    }
    CHECK(anchored);

    // And the speaker's own client raises the bubble over its own body, which
    // is the case a "broadcast to everyone else" would quietly miss.
    CHECK_EQ(alice.chatBubbles().all().size(), std::size_t{1});
    if (!alice.chatBubbles().all().empty()) {
        CHECK_EQ(alice.chatBubbles().all()[0].speakerNetId, aliceNetId);
        CHECK_EQ(alice.chatBubbles().all()[0].text, std::string("over my head"));
    }

    // Nobody said the server's own announcements, so they float over no body.
    const std::size_t bubblesBefore = bob.chatBubbles().all().size();
    bob.addSystemMessage("A super Hornet has spawned!");
    CHECK_EQ(bob.chatBubbles().all().size(), bubblesBefore);
}

TEST(chat_flooding_is_rate_limited) {
    Harness h("flood");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, bob;
    CHECK(connectClient(h, alice));
    CHECK(connectClient(h, bob));
    alice.requestRegister("alice", "password1");
    bob.requestRegister("bob", "password2");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::LoggedIn &&
               bob.status() == NetClient::Status::LoggedIn;
    }));

    const std::size_t before = bob.chat().size();
    for (int i = 0; i < 50; ++i) alice.sendChat("spam " + std::to_string(i));
    h.step(40, {&alice, &bob});

    // A client controls how often it sends; the server controls how often it
    // will listen. Far fewer than fifty lines must get through.
    CHECK(bob.chat().size() - before < 20);
}

TEST(the_drawn_flower_tracks_the_server_without_ever_stepping_backwards) {
    // The property that makes the world look still while you run through it.
    // The client simulates nothing, so its drawn position is a low-pass of a
    // monotonically advancing authoritative one -- and a low-pass of a
    // monotonic signal is monotonic. Any backwards step along the heading is
    // a correction, and because the camera is pinned to this position, a
    // correction is a jolt of the entire world.
    Harness h("drawn-flower");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("carol", "password3");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    net::InputFrame input;
    input.moveAngle = 0.7;
    input.moveStrength = 1.0;

    // Put the body where the whole run is provably clear of walls: a wall stop
    // is a legitimate reversal of the SERVER position, and this test is about
    // what the client adds on top of it.
    const double reach = kPlayerMaxSpeed * net::kTickSeconds * 60.0 + kPlayerBaseRadius * 2;
    const Vec2 heading = Vec2::fromAngle(input.moveAngle, reach);
    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, Transform> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, Transform&) { body = e; });
    CHECK(body != NULL_ENTITY);
    if (body != NULL_ENTITY) {
        Vec2 open = world.get<Transform>(body).position;
        for (int attempt = 0; attempt < 400; ++attempt) {
            if (!h.server.terrain().blocked(open, Realm::Overworld) &&
                !h.server.terrain().segmentBlocked(open, open + heading, Realm::Overworld)) {
                break;
            }
            open = h.server.terrain().findOpenSpawn(h.probeRng, {kWorldHalf * 0.2, kWorldHalf * 0.6},
                                                    4000.0, Realm::Overworld);
        }
        world.get<Transform>(body).position = open;
    }
    CHECK(h.stepUntil({&client}, [&] {
        return distance(client.view().self().position, world.get<Transform>(body).position) < 1.0;
    }));

    // A mob touching the flower displaces it 25 units on the spot, which is a
    // real server-side reversal and not what this measures. Sweep the lane.
    const auto clearLane = [&] {
        if (body == NULL_ENTITY) return;
        const Vec2 at = world.get<Transform>(body).position;
        std::vector<Entity> doomed;
        Query<MobTag, Transform> mobs{world};
        mobs.each([&](Entity e, MobTag&, Transform& transform) {
            if (distance(transform.position, at) < 2000.0) doomed.push_back(e);
        });
        for (const Entity e : doomed) world.destroy(e);
    };
    clearLane();

    WorldView& view = client.view();
    view.snapAll();
    const Vec2 forward = Vec2::fromAngle(input.moveAngle, 1.0);
    const auto along = [&forward](Vec2 p) { return p.x * forward.x + p.y * forward.y; };
    double previousAlong = along(view.selfDrawnPosition());
    double worstBackwards = 0;
    double worstLag = 0;

    for (int i = 0; i < 60; ++i) {
        clearLane();
        input.sequence = static_cast<std::uint32_t>(i + 1);
        client.sendInput(input);
        h.step(1, {&client});
        // Two rendered frames per server tick, as a 60 Hz client gets.
        view.interpolate(1000.0 + i * net::kTickMillis, net::kTickSeconds / 2.0);
        view.interpolate(1000.0 + i * net::kTickMillis + net::kTickMillis / 2.0,
                         net::kTickSeconds / 2.0);

        const double now = along(view.selfDrawnPosition());
        worstBackwards = std::max(worstBackwards, previousAlong - now);
        previousAlong = now;
        // Settled in after a few ticks, before which the client is still
        // learning where it spawned.
        if (i > 10) {
            worstLag = std::max(worstLag,
                                distance(view.selfDrawnPosition(), view.self().position));
        }
    }

    // Not "small": zero. The ease only ever moves toward the target.
    CHECK_NEAR(worstBackwards, 0.0, 1e-9);
    // And it stays within a few frames of travel of the truth rather than
    // drifting away from it.
    CHECK(worstLag < kPlayerMaxSpeed * 0.5);
}

TEST(a_disconnect_removes_the_player_from_everyone_else) {
    // No bots: the world is one map with one small door, so the bot
    // population stands in the same place a joining player does. "Alice sees
    // exactly one flower once Bob is gone" is a statement about the
    // disconnect, and it cannot be made in a crowd.
    Harness h("disconnect", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    std::uint32_t aliceNetId = 0;
    {
        NetClient bob;
        CHECK(connectClient(h, alice));
        CHECK(connectClient(h, bob));
        alice.requestRegister("alice", "password1");
        bob.requestRegister("bob", "password2");
        CHECK(h.stepUntil({&alice, &bob}, [&] {
            return alice.status() == NetClient::Status::LoggedIn &&
                   bob.status() == NetClient::Status::LoggedIn;
        }));
        alice.joinGame(1280, 720, {}, "alice");
        bob.joinGame(1280, 720, {}, "bob");
        CHECK(h.stepUntil({&alice, &bob}, [&] {
            return alice.status() == NetClient::Status::Playing &&
                   bob.status() == NetClient::Status::Playing;
        }));
        // Spawns scatter across a zone thousands of units wide; stand them
        // together so this tests the disconnect, not the spawn scatter.
        World& world = h.server.world();
        Vec2 aliceAt{};
        Entity bobBody = NULL_ENTITY;
        Query<PlayerTag, PlayerAccount, Transform> bodies{world};
        bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account, Transform& transform) {
            if (account.username == "alice") aliceAt = transform.position;
            else if (account.username == "bob") bobBody = e;
        });
        if (bobBody != NULL_ENTITY) world.get<Transform>(bobBody).position = aliceAt + Vec2{60, 0};

        CHECK(h.stepUntil({&alice, &bob}, [&] { return playersVisibleTo(alice) >= 2; }));
        aliceNetId = alice.view().self().netId;
        CHECK(aliceNetId != 0);
        bob.disconnect();
    }

    // Bob's socket is gone. The server must drop his body and tell Alice,
    // rather than leaving a ghost standing there forever.
    CHECK(h.stepUntil({&alice}, [&] { return playersVisibleTo(alice) == 1; }));
}

TEST(a_session_token_lets_a_returning_player_back_in) {
    Harness h("persist");
    if (!h.ready) { CHECK(false); return; }

    std::string token;
    {
        NetClient client;
        CHECK(connectClient(h, client));
        client.requestRegister("dave", "password4");
        CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
        token = client.sessionToken();
        CHECK(!token.empty());
    }

    // A returning client presents only its token; the password is never stored
    // anywhere but in the player's head.
    NetClient returning;
    CHECK(connectClient(h, returning));
    returning.authAnswered = false;
    returning.resumeSession(token);
    CHECK(h.stepUntil({&returning}, [&] { return returning.authAnswered; }));
    CHECK_EQ(static_cast<int>(returning.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(returning.profile().username, std::string("dave"));

    // A made-up token must not be accepted.
    NetClient forged;
    CHECK(connectClient(h, forged));
    forged.authAnswered = false;
    forged.resumeSession("not-a-real-token");
    CHECK(h.stepUntil({&forged}, [&] { return forged.authAnswered; }));
    CHECK_EQ(static_cast<int>(forged.authStatus), static_cast<int>(net::AuthStatus::SessionExpired));
}

TEST(mobs_spawn_and_are_replicated_to_a_player) {
    Harness h("mobs");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("erin", "password5");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    // Use the largest accepted viewport so newly spawned ring mobs enter the
    // replication prefetch region without relying on random AI movement.
    client.joinGame(2600, 2600);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    const bool sawMobs = h.stepUntil({&client}, [&] {
        for (const auto& e : client.view().entities()) {
            if (e.second.kind == net::EntityKind::Mob) return true;
        }
        return false;
    }, 600);
    CHECK(sawMobs);

    // Whatever spawned must be drawable: a valid config index and a real size.
    for (const auto& entry : client.view().entities()) {
        if (entry.second.kind != net::EntityKind::Mob) continue;
        CHECK(entry.second.typeIndex < content().mobCount());
        CHECK(entry.second.radius > 0);
        CHECK(entry.second.healthFraction > 0);
    }
}

TEST(a_camera_petal_lets_its_wearer_claim_the_world_it_draws) {
    // The reported viewport is what replication streams and what wakes the
    // spawn bands, so the server clamps it. A flat clamp cut unique antennae's
    // tenfold view to a quarter of its width: mobs culled in plain view, bands
    // empty outside a box round the flower. The ceiling is the default screen
    // over the zoom the body's own loadout grants -- and no more than that.
    Harness h("camerazoom");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("hazel", "password9");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    const Vec2 drawn{kViewportWidth * 10.0, kViewportHeight * 10.0};
    client.joinGame(static_cast<int>(drawn.x), static_cast<int>(drawn.y));
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> bodies{world};
    // The one body with a connection: the rest are bots.
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.connection != 0) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;
    const auto claimed = [&] { return world.get<PlayerLocation>(body).viewport; };

    // Nothing worn that zooms out: held to the flat allowance.
    CHECK(claimed().x <= 2600.0);
    CHECK(claimed().y <= 2600.0);

    std::uint32_t sequence = 0;
    const auto report = [&](Vec2 viewport) {
        net::InputFrame input;
        input.sequence = ++sequence;
        input.viewportWidth = static_cast<std::uint16_t>(viewport.x);
        input.viewportHeight = static_cast<std::uint16_t>(viewport.y);
        client.sendInput(input);
        h.step(2, {&client});
    };

    // Unique antennae on the bar: the whole of what it draws is claimable.
    const std::uint16_t antennae = content().petalIndex("antennae");
    CHECK(antennae != kInvalidIndex);
    world.get<Loadout>(body).slots[0] = LoadoutSlot{antennae, Rarity::Unique, 0.0, false};
    report(drawn);
    CHECK_NEAR(claimed().x, drawn.x, 1e-6);
    CHECK_NEAR(claimed().y, drawn.y, 1e-6);

    // But not more than it pays for, however much the client asks.
    report({60000.0, 60000.0});
    CHECK(claimed().x < drawn.x * 1.05);
    CHECK(claimed().y < drawn.y * 1.05);

    // Taken off, the next packet is held to the flat allowance again.
    world.get<Loadout>(body).slots[0] = LoadoutSlot{};
    report(drawn);
    CHECK(claimed().x <= 2600.0);
    CHECK(claimed().y <= 2600.0);
}

TEST(a_player_who_leaves_to_the_menu_keeps_their_account) {
    Harness h("leave");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("frank", "password6");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    client.leaveGame();
    h.step(10, {&client});
    // Leaving drops the body but not the login: the connection is still
    // authenticated and can join again without another password.
    CHECK(client.status() != NetClient::Status::Playing);
    CHECK_EQ(client.profile().username, std::string("frank"));

    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
}

TEST(logging_out_ends_the_session_at_both_ends) {
    Harness h("logout");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("grace", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    const std::string token = client.sessionToken();
    CHECK(!token.empty());

    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    client.logout();
    h.step(10, {&client});

    // The client keeps nothing of the account: no token to resume with, no
    // profile for a panel to draw, and no body left on the screen. The socket
    // itself is untouched -- it is back where a fresh connection sits, ready
    // for the login form.
    CHECK(client.sessionToken().empty());
    CHECK(client.profile().username.empty());
    CHECK_EQ(playersVisibleTo(client), std::size_t(0));
    CHECK(client.status() == NetClient::Status::Ready);

    // The server dropped the body with it, rather than leaving a flower nobody
    // is steering.
    CHECK_EQ(h.server.playerCount(), std::size_t(0));

    // The token is revoked, not merely forgotten: a copy of it kept anywhere
    // else is now worthless.
    NetClient stale;
    CHECK(connectClient(h, stale));
    stale.authAnswered = false;
    stale.resumeSession(token);
    CHECK(h.stepUntil({&stale}, [&] { return stale.authAnswered; }));
    CHECK_EQ(static_cast<int>(stale.authStatus), static_cast<int>(net::AuthStatus::SessionExpired));

    // And the same socket can log straight back in, which is what the form
    // behind the Log Out button expects: no reconnect between the two.
    client.authAnswered = false;
    client.requestLogin("grace", "password7");
    CHECK(h.stepUntil({&client}, [&] { return client.authAnswered; }));
    CHECK_EQ(static_cast<int>(client.authStatus), static_cast<int>(net::AuthStatus::Ok));
    CHECK_EQ(client.profile().username, std::string("grace"));
    CHECK(client.sessionToken() != token);
}

TEST(logging_out_ends_every_session_the_account_has) {
    Harness h("logout-all");
    if (!h.ready) { CHECK(false); return; }

    // Three tokens on one account: two left behind by earlier sign-ins -- one
    // on a connection since closed, the copy left on some other machine, and
    // one on a connection a later sign-in replaced -- and the live one that
    // logs out. Only the last is signed in: one account, one session.
    NetClient parked;
    CHECK(connectClient(h, parked));
    parked.requestRegister("heidi", "password8");
    CHECK(h.stepUntil({&parked}, [&] { return parked.status() == NetClient::Status::LoggedIn; }));
    const std::string parkedToken = parked.sessionToken();
    parked.disconnect();

    NetClient there;
    CHECK(connectClient(h, there));
    there.requestLogin("heidi", "password8");
    CHECK(h.stepUntil({&there}, [&] { return there.status() == NetClient::Status::LoggedIn; }));
    const std::string thereToken = there.sessionToken();
    there.joinGame(1280, 720);
    CHECK(h.stepUntil({&there}, [&] { return there.view().self().netId != 0; }));

    NetClient here;
    CHECK(connectClient(h, here));
    here.requestLogin("heidi", "password8");
    CHECK(h.stepUntil({&here, &there}, [&] {
        return here.status() == NetClient::Status::LoggedIn && there.sessionReplaced;
    }));

    // A different account, which a logout of this one must not touch.
    NetClient bystander;
    CHECK(connectClient(h, bystander));
    bystander.requestRegister("ivan", "password9");
    CHECK(h.stepUntil({&bystander},
                      [&] { return bystander.status() == NetClient::Status::LoggedIn; }));

    here.logout();
    h.step(10, {&here, &bystander});

    // The one that logged out was not "signed out elsewhere" -- it did this.
    CHECK(!here.signedOutElsewhere);
    CHECK(here.status() == NetClient::Status::Ready);
    CHECK_EQ(h.server.playerCount(), std::size_t(0));

    // Every token the account had is dead, including the ones nobody was
    // using -- the replaced tab's among them, so it cannot play here again.
    for (const std::string& token : {thereToken, parkedToken}) {
        NetClient stale;
        CHECK(connectClient(h, stale));
        stale.authAnswered = false;
        stale.resumeSession(token);
        CHECK(h.stepUntil({&stale}, [&] { return stale.authAnswered; }));
        CHECK_EQ(static_cast<int>(stale.authStatus),
                 static_cast<int>(net::AuthStatus::SessionExpired));
    }

    CHECK(!bystander.signedOutElsewhere);
    CHECK(bystander.status() == NetClient::Status::LoggedIn);
    CHECK_EQ(bystander.profile().username, std::string("ivan"));
}

TEST(signing_in_elsewhere_replaces_the_session_and_the_first_tab_can_take_it_back) {
    Harness h("replaced", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    // The first tab, playing.
    NetClient first;
    CHECK(connectClient(h, first));
    first.requestRegister("jules", "password7");
    CHECK(h.stepUntil({&first}, [&] { return first.status() == NetClient::Status::LoggedIn; }));
    first.joinGame(1280, 720);
    CHECK(h.stepUntil({&first}, [&] { return first.view().self().netId != 0; }));
    CHECK_EQ(h.server.playerCount(), std::size_t(1));

    // Another account, which none of this may touch.
    NetClient bystander;
    CHECK(connectClient(h, bystander));
    bystander.requestRegister("kim", "password8");
    CHECK(h.stepUntil({&bystander},
                      [&] { return bystander.status() == NetClient::Status::LoggedIn; }));

    // The same account signs in on a second tab. That tab wins, and the first
    // is told why rather than simply dropped.
    NetClient second;
    CHECK(connectClient(h, second));
    second.requestLogin("jules", "password7");
    CHECK(h.stepUntil({&first, &second, &bystander}, [&] {
        return second.status() == NetClient::Status::LoggedIn && first.sessionReplaced;
    }));
    first.sessionReplaced = false;
    CHECK(first.status() == NetClient::Status::Failed);
    CHECK(!first.lastError().empty());
    CHECK_EQ(playersVisibleTo(first), std::size_t(0));
    // Its body left the world with it: no second flower on the account.
    CHECK_EQ(h.server.playerCount(), std::size_t(0));
    // It kept the token -- still good, and what "play on this tab" resumes.
    CHECK(!first.sessionToken().empty());

    // And it does NOT redial on its own. Waited out on the wall clock, past
    // the first redial's delay: a redial would resume the token, replace the
    // second tab, and the two would trade the account forever.
    CHECK(!first.reconnecting());
    const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(1500);
    while (std::chrono::steady_clock::now() < until) h.step(1, {&first, &second, &bystander});
    CHECK(first.status() == NetClient::Status::Failed);
    CHECK(!first.reconnected);
    CHECK(!second.sessionReplaced);
    CHECK(second.status() == NetClient::Status::LoggedIn);

    second.joinGame(1280, 720);
    CHECK(h.stepUntil({&second}, [&] { return second.view().self().netId != 0; }));
    CHECK_EQ(h.server.playerCount(), std::size_t(1));

    // "Play on this tab": a fresh socket, and the token presented on it --
    // what App::onReconnected does when that handshake lands. Now the SECOND
    // tab is the one replaced, and its body goes.
    first.redial();
    CHECK(h.stepUntil({&first, &second, &bystander}, [&] { return first.reconnected; }));
    first.reconnected = false;
    first.resumeSession(first.sessionToken());
    CHECK(h.stepUntil({&first, &second, &bystander}, [&] {
        return first.status() == NetClient::Status::LoggedIn && second.sessionReplaced;
    }));
    CHECK_EQ(first.profile().username, std::string("jules"));
    CHECK(second.status() == NetClient::Status::Failed);
    CHECK(!second.reconnecting());
    CHECK_EQ(h.server.playerCount(), std::size_t(0));

    // The other account never noticed any of it.
    CHECK(!bystander.sessionReplaced);
    CHECK(bystander.status() == NetClient::Status::LoggedIn);
}

TEST(a_hornets_missile_reaches_the_client_at_the_size_it_was_fired_at) {
    // No bots: they join at the same door this flower does now, and a farming
    // bot kills the hornet under test before it ever fires.
    Harness h("volley", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "hornetwatch", "password9"));
    client.joinGame(2600, 2600);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    // Where THIS client's flower stands, so the hornet can be put in its face.
    //
    // Matched by the viewer's own net id rather than by taking the first
    // PlayerTag in the world: even with the bots off, the only flower that
    // must be found is this client's. A hornet anchored on somebody else
    // fires shots this viewer's stream never carries.
    World& world = h.server.world();
    const std::uint32_t selfNetId = client.view().self().netId;
    Query<PlayerTag, NetId, Transform> flowers(world);
    Vec2 at{0, 0};
    bool found = false;
    flowers.each([&](Entity, PlayerTag&, NetId& id, Transform& transform) {
        if (id.value == selfNetId) { at = transform.position; found = true; }
    });
    CHECK(found);

    // A hornet built the way the spawner builds one -- the shipping AI, the
    // shipping content -- close enough that it has a target immediately.
    const std::uint16_t hornetIndex = content().mobIndex("hornet");
    const MobStats stats = content().mobStats(hornetIndex, Rarity::Common);
    const Entity hornet = world.create();
    world.add<MobTag>(hornet);
    world.add<Transform>(hornet, Transform{at + Vec2{160, 0}, 0.0});
    world.add<Motion>(hornet);
    world.add<Body>(hornet, Body{stats.radius, stats.mass});
    world.add<Health>(hornet, Health{stats.health, stats.health, 0, 0});
    world.add<MobType>(hornet, MobType{hornetIndex, Rarity::Common, 1.0});
    world.add<Faction>(hornet, Faction{Team::Hostiles, false});
    world.add<ContactDamage>(hornet, ContactDamage{stats.damage, kMobHitIntervalMillis});
    MobAi brain;
    brain.kind = stats.ai;
    brain.anchor = at + Vec2{160, 0};
    brain.aggroRange = stats.aggroRange;
    world.add<MobAi>(hornet, brain);

    // What the wire should carry, worked out from the same two inputs the
    // server has: the ammunition's body and the SHOOTER's, which is where the
    // hornet's 1.3 size enters.
    const std::uint16_t ammo = content().petalIndex("hornet_missile");
    const PetalStats ammoStats = content().petalStats(ammo, Rarity::Common);
    const double ownerScale = stats.radius / kMobBaseRadius;
    const double expected = std::max(
        1.0, ammoStats.size * kProjectileRadiusPerSize * ownerScale / kProjectileSizeDivisor);

    // THIS hornet's shot, found through the server's Projectile.owner and
    // its net id, not the first projectile the stream happens to carry: the
    // flower stands at the garden door, where the band over it puts hornets
    // of other tiers within sight, and an uncommon one firing first would
    // deliver a shot 1.3x this size that has nothing to do with the port
    // under test.
    double seenRadius = -1.0;
    std::uint16_t seenType = 0xFFFF;
    Query<Projectile, NetId> shots(world);
    const bool sawShot = h.stepUntil({&client}, [&] {
        bool seen = false;
        shots.each([&](Entity, Projectile& shot, NetId& id) {
            if (seen || shot.owner != hornet) return;
            const auto entry = client.view().entities().find(id.value);
            if (entry == client.view().entities().end()) return;
            if (entry->second.kind != net::EntityKind::Projectile) return;
            seenRadius = entry->second.radius;
            seenType = entry->second.typeIndex;
            seen = true;
        });
        return seen;
    }, 600);
    CHECK(sawShot);

    // The client draws a shot at twice this, so a radius that arrived wrong is
    // artwork drawn at the wrong calibre. Tolerance is the f32 the wire uses.
    CHECK_NEAR(seenRadius, expected, 1e-3);
    CHECK_EQ(seenType, ammo);
    // And it really is smaller than the ammunition petal's own body: a shot is
    // half its petal, then the shooter's scale over the divisor.
    CHECK(seenRadius < ammoStats.radius);
}

TEST(a_mantis_bursts_its_peas_through_the_real_server_loop) {
    // The AI tests drive MobAiSystem directly. This one goes through the whole
    // shipping path -- GameServer's tick, the spawner's component set, the
    // wire -- because "the burst is gone in the actual game" is a claim about
    // THAT, and a unit test on the gate cannot answer it.
    Harness h("mantisburst", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(loginNew(h, client, "mantiswatch", "password9"));
    client.joinGame(2600, 2600);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const std::uint32_t selfNetId = client.view().self().netId;
    Query<PlayerTag, NetId, Transform> flowers(world);
    Vec2 at{0, 0};
    bool found = false;
    flowers.each([&](Entity, PlayerTag&, NetId& id, Transform& transform) {
        if (id.value == selfNetId) { at = transform.position; found = true; }
    });
    CHECK(found);
    if (!found) return;

    // Built the way the spawner builds one, and far enough out that it opens
    // fire long before it is close enough to chew the flower up.
    const std::uint16_t mantisIndex = content().mobIndex("mantis");
    const MobStats stats = content().mobStats(mantisIndex, Rarity::Common);
    const Entity mantis = world.create();
    world.add<MobTag>(mantis);
    world.add<Transform>(mantis, Transform{at + Vec2{420, 0}, 0.0});
    world.add<Motion>(mantis);
    world.add<Body>(mantis, Body{stats.radius, stats.mass});
    world.add<Health>(mantis, Health{stats.health, stats.health, 0, 0});
    world.add<MobType>(mantis, MobType{mantisIndex, Rarity::Common, 1.0});
    world.add<Faction>(mantis, Faction{Team::Hostiles, false});
    world.add<ContactDamage>(mantis, ContactDamage{stats.damage, kMobHitIntervalMillis});
    MobAi brain;
    brain.kind = stats.ai;
    brain.anchor = at + Vec2{420, 0};
    brain.aggroRange = stats.aggroRange;
    world.add<MobAi>(mantis, brain);

    // Every pea THIS mantis fires, timed by the server's own clock. Keyed on
    // net id because a pea only lives about a second: counting what is alive
    // would lose the first one as the fourth goes out.
    std::vector<double> firedAt;
    std::vector<std::uint32_t> seen;
    bool reachedClient = false;
    Query<Projectile, NetId> shots(world);
    h.stepUntil({&client}, [&] {
        shots.each([&](Entity, Projectile& shot, NetId& id) {
            if (shot.owner != mantis) return;
            if (std::find(seen.begin(), seen.end(), id.value) != seen.end()) return;
            seen.push_back(id.value);
            firedAt.push_back(h.clock);
            const auto entry = client.view().entities().find(id.value);
            if (entry != client.view().entities().end() &&
                entry->second.kind == net::EntityKind::Projectile) {
                reachedClient = true;
            }
        });
        return firedAt.size() >= 5;
    }, 300);

    // Five peas is a burst, the pause, and the opening pea of the next one --
    // enough to see the shape rather than just the rate.
    CHECK_EQ(firedAt.size(), std::size_t(5));
    if (firedAt.size() < 5) return;
    CHECK(reachedClient);

    const ProjectileSpec& spec = content().mob(mantisIndex).projectile;
    const double cadence = stats.attackCooldownMillis;
    for (std::size_t i = 1; i < firedAt.size(); ++i) {
        const double gap = firedAt[i] - firedAt[i - 1];
        const double expected = i % 3 == 0 ? cadence : spec.burstIntervalMillis;
        CHECK(gap >= expected - 1e-9);
        CHECK(gap < expected + 2.0 * net::kTickMillis);
    }
    // Which is to say the three peas of a burst really are closer together
    // than the pause that follows them -- the thing a player sees.
    CHECK(firedAt[1] - firedAt[0] < firedAt[3] - firedAt[2]);
}

TEST(persist_all_writes_the_database_and_keeps_serving) {
    Harness h("persist-all");
    if (!h.ready) { CHECK(false); return; }

    // A registration is dirty in memory and, left alone, reaches the disk
    // only on the periodic save. persistAll() is the on-demand flush: the
    // offline page calls it from the tab's unload handler, where nothing
    // else would ever write the file.
    NetClient client;
    CHECK(flix::testsupport::loginNew(h, client, "carol", "hunter2!"));
    // Nobody is in the world yet, so no player is written -- but the database is.
    CHECK_EQ(h.server.persistAll(), std::size_t{0});
    {
        Database probe;
        std::string error;
        CHECK(probe.load(h.dbPath, error));
        CHECK(probe.findUser("carol") != nullptr);
    }

    // Unlike shutdown(), the listener is still up afterwards.
    NetClient second;
    CHECK(connectClient(h, second));

    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK_EQ(h.server.persistAll(), std::size_t{1});
}

TEST(a_yggdrasil_revival_takes_the_death_screen_back_down) {
    // Bots are off: they carry yggdrasil for each other and path to any corpse
    // they can reach, so with them running the revive under test could be one
    // of theirs and the name in the line would not be Bob's.
    Harness h("yggdrasil-revive", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice, bob;
    CHECK(flix::testsupport::loginNew(h, alice, "alice", "password1"));
    CHECK(flix::testsupport::loginNew(h, bob, "bob", "password2"));
    alice.joinGame(1280, 720, {}, "alice");
    bob.joinGame(1280, 720, {}, "bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing;
    }));

    World& world = h.server.world();
    Entity aliceBody = NULL_ENTITY;
    Entity bobBody = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount, Transform> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account, Transform&) {
        if (account.username == "alice") aliceBody = e;
        else if (account.username == "bob") bobBody = e;
    });
    CHECK(aliceBody != NULL_ENTITY);
    CHECK(bobBody != NULL_ENTITY);
    if (aliceBody == NULL_ENTITY || bobBody == NULL_ENTITY) return;

    // Alice goes down where she stands, and the client is told so: the death
    // card is up and nothing she presses moves the body.
    world.get<Health>(aliceBody).current = 0;
    world.add<Dead>(aliceBody, Dead{NULL_ENTITY});
    CHECK(h.stepUntil({&alice, &bob}, [&] { return alice.dead(); }));
    CHECK(!alice.revived);

    // Bob walks over her with a yggdrasil out. Close enough that the petal's
    // own orbit -- not just his body -- is inside the revival range.
    const Vec2 corpse = world.get<Transform>(aliceBody).position;
    world.get<Transform>(bobBody).position = corpse + Vec2{30, 0};
    world.get<Transform>(bobBody).realm = world.get<Transform>(aliceBody).realm;
    const std::uint16_t yggdrasil = content().petalIndex("yggdrasil");
    CHECK(yggdrasil != kInvalidIndex);
    world.get<Loadout>(bobBody).slots[0].configIndex = yggdrasil;
    world.get<Loadout>(bobBody).slots[0].rarity = Rarity::Common;
    // One tick for the slot pass to see the swap, then the equip reload is
    // waived: yggdrasil serves 512 seconds before it ever reaches the ring,
    // and this test is about what happens when it does.
    h.step(1, {&alice, &bob});
    world.get<Loadout>(bobBody).slots[0].broken = false;
    world.get<Loadout>(bobBody).slots[0].reloadReadyAtMillis = 0;

    CHECK(h.stepUntil({&alice, &bob}, [&] { return !alice.dead(); }, 200));
    // The world half really happened, and not by the corpse being replaced:
    // it is the same entity, standing.
    CHECK(world.isAlive(aliceBody));
    CHECK(!world.has<Dead>(aliceBody));
    CHECK(world.get<Health>(aliceBody).current > 0.0);

    // The client half. `revived` is the one-shot the app reads to take the
    // death card down; without it the screen stays up over a body that is
    // alive and the player cannot move.
    CHECK(alice.revived);
    bool sawLine = false;
    for (const ChatLine& line : alice.chat()) {
        if (line.text == "You were revived by bob.") sawLine = true;
    }
    CHECK(sawLine);

    // And she can move again -- which is the bug this fixes, from the
    // simulation's side: a body with no Dead tag is one movement steps.
    const Vec2 before = world.get<Transform>(aliceBody).position;
    net::InputFrame input;
    input.moveAngle = 0;
    input.moveStrength = 1.0;
    for (int i = 0; i < 30; ++i) {
        input.sequence = static_cast<std::uint32_t>(i + 1);
        alice.sendInput(input);
        h.step(1, {&alice, &bob});
    }
    CHECK(distance(world.get<Transform>(aliceBody).position, before) > 50.0);
}

TEST(a_sponge_prints_its_stored_damage_on_the_owners_bar) {
    // The whole path the loadout bar's number takes: a sponge in a real
    // server's loadout, the petal system publishing what the flower is still
    // holding, the snapshot carrying it, and the owner's client decoding it
    // into what the bar prints inside that slot's top border.
    Harness h("sponge-counter");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(flix::testsupport::loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == "alice") body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    const std::uint16_t sponge = content().petalIndex("sponge");
    CHECK(sponge != kInvalidIndex);
    world.get<Loadout>(body).slots[0] = LoadoutSlot{sponge, Rarity::Common, 0.0, false};

    // Nothing absorbed yet: an idle sponge stands at zero, and the petals
    // beside it -- which have no number of their own -- print nothing.
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == 0; }));
    CHECK_EQ(alice.view().self().slotCounter[1], -1);

    // A hit combat deferred into the sponge. Held rather than draining, so the
    // number this asserts on is a fixed one.
    SpongeDamageEffect stored;
    stored.remainingDamage = 12.0;
    stored.damagePerSecond = 0.0;
    world.ensure<SpongeDamageState>(body).effects.push_back(stored);

    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == 12; }));

    // Paid back: the gauge falls to zero and stays on the tile.
    world.get<SpongeDamageState>(body).effects.clear();
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == 0; }));

    // Unequipped: now there is no number at all.
    world.get<Loadout>(body).slots[0] = LoadoutSlot{};
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == -1; }));
}

TEST(a_root_prints_its_armour_stacks_on_the_owners_bar) {
    // The whole path the number takes for the other petal that has one: a
    // root in a real server's loadout, the petal system banking stacks on the
    // tick clock, the snapshot carrying the count, and the owner's client
    // decoding it into what the bar prints inside that slot's top border.
    Harness h("root-counter");
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(flix::testsupport::loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.username == "alice") body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    const std::uint16_t root = content().petalIndex("root");
    CHECK(root != kInvalidIndex);
    if (root == kInvalidIndex) return;
    world.get<Loadout>(body).slots[0] = LoadoutSlot{root, Rarity::Common, 0.0, false};

    // An empty bank still prints, and the petal beside it -- which has no
    // number of its own -- prints nothing.
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == 0; }));
    CHECK_EQ(alice.view().self().slotCounter[1], -1);

    // Banked on the server's own clock, so the bar counts up on its own.
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] >= 1; }));

    // Spent by a hit, and the bar reports the fall as it reported the climb.
    const int banked = alice.view().self().slotCounter[0];
    world.get<ArmorStackState>(body).stacks = banked + 4;
    CHECK(h.stepUntil(
        {&alice}, [&] { return alice.view().self().slotCounter[0] == banked + 4; }));
    world.get<ArmorStackState>(body).stacks = 0;
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == 0; }));

    // Unequipped: now there is no number at all.
    world.get<Loadout>(body).slots[0] = LoadoutSlot{};
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().slotCounter[0] == -1; }));
}

TEST(a_dandelion_sheds_a_seed_through_the_real_server_loop) {
    // The unit tests drive each link on its own -- combat books the seed, the
    // AI fires it, the replicator carries what is left of the ring. This one
    // goes through the shipping path end to end, because "hit a dandelion and
    // a petal flies off" is a claim about THAT.
    Harness h("dandelion", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(flix::testsupport::loginNew(h, client, "seedwatch", "password9"));
    client.joinGame(2600, 2600);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const std::uint32_t selfNetId = client.view().self().netId;
    Query<PlayerTag, NetId, Transform> flowers(world);
    Vec2 at{0, 0};
    Realm realm = Realm::Overworld;
    bool found = false;
    flowers.each([&](Entity, PlayerTag&, NetId& id, Transform& transform) {
        if (id.value != selfNetId) return;
        at = transform.position;
        realm = transform.realm;
        found = true;
    });
    CHECK(found);
    if (!found) return;

    // A dandelion the SPAWNER made, not one assembled here: the component set
    // it arrives with is half of what is under test, and a hand-built mob
    // would be the test asserting its own setup.
    Entity dandelion = NULL_ENTITY;
    const std::uint16_t dandelionIndex = content().mobIndex("dandelion");
    Query<MobTag, MobType, Transform> mobs(world);
    CHECK(h.stepUntil({&client}, [&] {
        mobs.each([&](Entity e, MobTag&, MobType& type, Transform&) {
            if (dandelion == NULL_ENTITY && type.configIndex == dandelionIndex) dandelion = e;
        });
        return dandelion != NULL_ENTITY;
    }, 200));
    CHECK(dandelion != NULL_ENTITY);
    if (dandelion == NULL_ENTITY) return;

    const MobPetalRing* ring = world.tryGet<MobPetalRing>(dandelion);
    CHECK(ring != nullptr);
    if (ring == nullptr) return;
    CHECK_EQ(ring->seats.size(), std::size_t(10));
    // Every seat is filled with a real entity by the spawner, not a count.
    for (const Entity seedSeat : ring->seats) CHECK(seedSeat != NULL_ENTITY);

    // Put it in the flower's ring, where the petals will chew on it.
    world.get<Transform>(dandelion).position = at;
    world.get<Transform>(dandelion).realm = realm;

    // What the CLIENT ends up believing, which is the only place the ring is
    // ever drawn from: one petal entity per seat, anchored to this mob, and
    // one fewer of them once a seed has gone.
    const std::uint32_t mobNetId = world.get<NetId>(dandelion).value;
    const auto seatsSeen = [&] {
        std::size_t seen = 0;
        for (const auto& entry : client.view().entities()) {
            if (entry.second.kind != net::EntityKind::Petal) continue;
            if (!entry.second.isRingPetal()) continue;
            if (entry.second.ownerNetId == mobNetId) ++seen;
        }
        return seen;
    };
    CHECK(h.stepUntil({&client}, [&] { return seatsSeen() == 10; }, 200));
    const bool shed = h.stepUntil({&client}, [&] { return seatsSeen() < 10; }, 400);
    CHECK(shed);

    // And the seed itself reached the wire as a dandelion petal.
    const std::uint16_t seedType = content().petalIndex("dandelion");
    const auto shotsInFlight = [&] {
        std::size_t seen = 0;
        for (const auto& entry : client.view().entities()) {
            if (entry.second.kind != net::EntityKind::Projectile) continue;
            if (entry.second.typeIndex == seedType) ++seen;
        }
        return seen;
    };
    CHECK(shotsInFlight() > 0);

    // ...and it LEAVES. A shed seed that never expires is a lingering entity,
    // which on this stack is always a server liveness bug and never a lost
    // message -- the client erases only what a removal names. The shot's own
    // range is the clock: `distance / speed` seconds, plus slack for the
    // dandelion still being shot at while this runs.
    const PetalRingSpec& spec = content().mob(dandelionIndex).petalRing;
    // Reach rides the tier ladder and the speed does not, so a seed off a big
    // dandelion is in the air for longer. Taken off the mob that actually
    // spawned rather than assumed common, so the budget cannot silently go
    // short if the spawner hands this test a graded one.
    const std::size_t tier = static_cast<std::size_t>(
        ladderIndex(clampRarity(rarityIndex(world.get<MobType>(dandelion).rarity))));
    const double tierScale = kMobSizeScale[tier] / kProjectileReachReferenceScale;
    const double flightMillis = spec.shotSpeed > 0.0
                                    ? 1000.0 * spec.shotDistance * tierScale / spec.shotSpeed
                                    : 1000.0;
    const int budget = static_cast<int>(flightMillis / net::kTickMillis) + 200;
    world.get<Transform>(dandelion).position = at + Vec2{6000.0, 0.0};   // stop feeding it hits
    CHECK(h.stepUntil({&client}, [&] { return shotsInFlight() == 0; }, budget));
}

TEST(a_loadout_edit_keeps_the_xp_earned_since_the_last_save) {
    // A kill pays the live body; the account record only catches up on the
    // 30-second autosave. A number-key petal swap re-applies the account to
    // the body, and that used to re-seed XP from the record as well: the HUD
    // showed the new level for a few frames, then fell back to the saved one,
    // and the next save wrote the rewound figure over the XP for good.
    Harness h("loadout-keeps-xp");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("grinder", "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    World& world = h.server.world();
    Entity body = NULL_ENTITY;
    Query<PlayerTag, NetId> people{world};
    people.each([&](Entity e, PlayerTag&, NetId& id) {
        if (id.value == client.view().self().netId) body = e;
    });
    CHECK(body != NULL_ENTITY);
    if (body == NULL_ENTITY) return;

    // Earned on the body, the way a kill pays it. The record still says zero.
    const double earned = xpForNextLevel(1) + xpForNextLevel(2);
    const int level = levelFromTotalXp(earned).level;
    CHECK_EQ(level, 3);
    world.get<PlayerProgress>(body).totalXp = earned;
    world.get<PlayerProgress>(body).level = level;
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().totalXp == earned; }));

    // Both edit paths: the number-key swap and a drag onto the bar.
    client.swapLoadoutSlots(0, kLoadoutActiveSlots);
    h.step(10, {&client});
    client.setLoadoutSlot(1, kNoPetal, Rarity::Common);
    h.step(10, {&client});

    CHECK_NEAR(world.get<PlayerProgress>(body).totalXp, earned, 1e-9);
    CHECK_EQ(world.get<PlayerProgress>(body).level, level);
    CHECK_NEAR(client.view().self().totalXp, earned, 1e-9);
    CHECK_EQ(levelFromTotalXp(client.view().self().totalXp).level, level);
    // The stats the edit re-derives come off the live level, not the saved one.
    CHECK(world.get<Health>(body).max > maxHealthForLevel(1));

    // And the XP is still there to be saved when the flower leaves.
    client.leaveGame();
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    const Account* account = h.server.database().findUser("grinder");
    CHECK(account != nullptr);
    if (account == nullptr) return;
    const PlayerRecord* saved = h.server.database().findProgress(account->id);
    CHECK(saved != nullptr);
    if (saved != nullptr) CHECK_NEAR(saved->totalXp, earned, 1e-9);
}

TEST(a_wax_is_put_down_through_the_real_server_loop_and_arrives_loose) {
    // No bots: a bot standing on the join point would walk into the slab.
    Harness h("wax-loop", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient client;
    CHECK(loginNew(h, client, "chandler", "long-enough-password"));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    Entity player = NULL_ENTITY;
    Query<PlayerTag> players{world};
    players.each([&](Entity e, PlayerTag&) { player = e; });
    CHECK(player != NULL_ENTITY);
    if (player == NULL_ENTITY) return;
    // Nothing on the map gets to end the test early by killing the flower
    // while its wax serves the thirty-second equip reload.
    world.get<Health>(player).invulnerableUntilMillis = 1e18;
    LoadoutSlot& slot = world.get<Loadout>(player).slots[0];
    slot.configIndex = content().petalIndex(kWaxPetalId);
    slot.rarity = Rarity::Rare;

    Entity wax = NULL_ENTITY;
    CHECK(h.stepUntil({&client}, [&] {
        Query<LoosePetal> loose{world};
        loose.each([&](Entity e, LoosePetal&) { wax = e; });
        return wax != NULL_ENTITY;
    }, 1000));
    if (wax == NULL_ENTITY) return;
    CHECK_NEAR(world.get<Body>(wax).radius, 90.0, 1e-9);
    CHECK_EQ(world.get<PetalInstance>(wax).owner, player);

    // On the wire it is a loose petal at its full radius, which is what the
    // client sizes, layers and smooths it by.
    const RemoteEntity* seen = nullptr;
    CHECK(h.stepUntil({&client}, [&] {
        for (const auto& entry : client.view().entities()) {
            if (entry.second.kind == net::EntityKind::Petal && entry.second.isLoosePetal()) {
                seen = &entry.second;
            }
        }
        return seen != nullptr;
    }, 20));
    if (seen == nullptr) return;
    CHECK(!seen->isRingPetal());
    CHECK_NEAR(seen->radius, 90.0, 0.01);
}
