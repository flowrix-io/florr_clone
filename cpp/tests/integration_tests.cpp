#include "test.h"

#include "client/net_client.h"
#include "client/prediction.h"
#include "server/game_server.h"
#include "shared/game/config.h"

#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using namespace flr;

// These tests answer "is it still a multiplayer game": a real server object,
// real sockets on loopback, real clients speaking the real protocol.
// Everything below the socket is the shipping code path.

namespace {

std::string tempPath(const char* name) {
    return std::string("/tmp/florr-itest-") + name + "-" + std::to_string(::getpid()) + ".json";
}

/// The content directory, found relative to THIS source file rather than to
/// the working directory: the test binary is run from the build tree, from the
/// project root, and from ctest, and all three must work.
const std::string& dataDir() {
    static const std::string resolved = [] {
        const std::string here = __FILE__;
        const std::size_t slash = here.find_last_of('/');
        const std::string tests = slash == std::string::npos ? std::string(".") : here.substr(0, slash);
        const std::string candidates[] = {
            tests + "/../build/data",   // staged beside the binaries
            tests + "/../data",         // the checked-in mob_xp.json plus copies
            "data",
        };
        for (const std::string& candidate : candidates) {
            std::ifstream probe(candidate + "/mobs.json", std::ios::binary);
            if (probe) return candidate;
        }
        return std::string("data");
    }();
    return resolved;
}

/// A server on a free port with an empty database, plus the plumbing to step
/// it and its clients forward together.
struct Harness {
    GameServer server;
    std::string dbPath;
    std::uint16_t port = 0;
    bool ready = false;
    double clock = 0;

    explicit Harness(const char* dbName) {
        dbPath = tempPath(dbName);
        std::remove(dbPath.c_str());

        ServerConfig config;
        config.dataDir = dataDir();
        config.databasePath = dbPath;
        config.worldSeed = 12345;

        std::string error;
        for (std::uint16_t candidate = 47100; candidate < 47160; ++candidate) {
            config.port = candidate;
            if (server.start(config, error)) { port = candidate; ready = true; break; }
        }
        if (!ready) std::printf("  harness could not start a server: %s\n", error.c_str());
    }

    ~Harness() { std::remove(dbPath.c_str()); }

    /// Advances the simulation by `ticks`, servicing both ends each step.
    ///
    /// The server's socket and its simulation are stepped separately, exactly
    /// as run() interleaves them, so a test sees the same ordering production
    /// does rather than a convenient fiction.
    void step(int ticks, std::vector<NetClient*> clients) {
        for (int i = 0; i < ticks; ++i) {
            for (NetClient* c : clients) c->poll(1);
            server.serviceNetwork(1);
            clock += net::kTickMillis;
            server.tick(clock);
            server.serviceNetwork(0);
            for (NetClient* c : clients) c->poll(1);
        }
    }

    /// Steps until `done` holds or the budget runs out; returns whether it did.
    template <class F>
    bool stepUntil(std::vector<NetClient*> clients, F done, int maxTicks = 400) {
        for (int i = 0; i < maxTicks; ++i) {
            step(1, clients);
            if (done()) return true;
        }
        return false;
    }
};

bool connectClient(Harness& h, NetClient& client) {
    client.contentHash = content().contentHash();
    if (!client.connect("127.0.0.1", h.port)) return false;
    return h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Ready; });
}

std::size_t playersVisibleTo(const NetClient& client) {
    std::size_t n = 0;
    for (const auto& e : client.view().entities()) {
        if (e.second.kind == net::EntityKind::Player) ++n;
    }
    return n;
}

} // namespace

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

    alice.joinGame(1280, 720);
    bob.joinGame(1280, 720);
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing;
    }));

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

TEST(client_prediction_agrees_with_the_server) {
    Harness h("prediction");
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister("carol", "password3");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK(h.stepUntil({&client}, [&] { return client.view().self().netId != 0; }));

    Prediction prediction;
    prediction.reset(client.view().self().position);

    net::InputFrame input;
    input.moveAngle = 0.7;
    input.moveStrength = 1.0;

    double worstCorrection = 0;
    for (int i = 0; i < 60; ++i) {
        input.sequence = static_cast<std::uint32_t>(i + 1);
        prediction.apply(input, kPlayerMaxSpeed, net::kTickSeconds);
        client.sendInput(input);
        h.step(1, {&client});

        const SelfState& self = client.view().self();
        prediction.reconcile(self.position, self.velocity, self.acknowledgedInput, kPlayerMaxSpeed);
        // Skip the first few ticks, before the client knows where it spawned.
        if (i > 10) worstCorrection = std::max(worstCorrection, prediction.lastCorrection());
    }

    // Both sides run the same integrateVelocity over the same inputs, so in
    // open ground the correction should be near zero. A large value means the
    // two physics paths have diverged.
    CHECK(worstCorrection < 5.0);
}

TEST(a_disconnect_removes_the_player_from_everyone_else) {
    Harness h("disconnect");
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
        alice.joinGame(1280, 720);
        bob.joinGame(1280, 720);
        CHECK(h.stepUntil({&alice, &bob}, [&] {
            return alice.status() == NetClient::Status::Playing &&
                   bob.status() == NetClient::Status::Playing;
        }));
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
    client.joinGame(1280, 720);
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
