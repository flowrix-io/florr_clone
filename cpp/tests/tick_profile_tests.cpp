// The server's tick profile: the phase stamps tick() leaves, summed over the
// DebugStats window and read back by the client for the debug panel's Server
// tab.

#include "test.h"

#include <string>
#include <vector>

#include "server_harness.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

/// The next DebugStats the server sends `client`, sent now.
bool nextDebugStats(Harness& h, NetClient& client, NetClient::ServerDebugStats& out) {
    GameServerPeer::broadcastDebugStats(h.server);
    return h.stepUntil({&client}, [&] { return client.takeServerDebugStats(out); });
}

int indexOf(const NetClient::ServerDebugStats& stats, const std::string& name) {
    for (std::size_t i = 0; i < stats.phases.size(); ++i) {
        if (stats.phases[i].name == name) return static_cast<int>(i);
    }
    return -1;
}

} // namespace

TEST(tick_profile_sums_phases_in_tick_order_and_starts_each_window_empty) {
    Harness h("tick-profile-sums",
              [](const std::string& p) { seedUser(p, "watcher", "password7"); }, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient watcher;
    CHECK(loginAs(h, watcher, "watcher", "password7"));

    // A tick that skipped `b` and `e` (the idle gate, an off-snapshot tick),
    // then ticks that ran them. A phase first seen late still lands after the
    // one that ran before it, not at the end of the list.
    GameServerPeer::foldTick(h.server, {"a", "c", "d"}, 1.0, 5.0);
    GameServerPeer::foldTick(h.server, {"a", "b", "c", "d"}, 1.0, 4.0);
    GameServerPeer::foldTick(h.server, {"a", "b", "c", "d", "e"}, 2.0, 10.0);

    NetClient::ServerDebugStats stats;
    CHECK(nextDebugStats(h, watcher, stats));
    CHECK_EQ(stats.ticks, 3);
    CHECK_NEAR(stats.tickAvgMillis, 19.0 / 3.0, 1e-4);
    CHECK_NEAR(stats.tickMaxMillis, 10.0, 1e-4);

    const std::vector<std::string> order = {"a", "b", "c", "d", "e", "other"};
    CHECK_EQ(stats.phases.size(), order.size());
    for (std::size_t i = 0; i < order.size() && i < stats.phases.size(); ++i) {
        CHECK_EQ(stats.phases[i].name, order[i]);
    }
    if (stats.phases.size() == order.size()) {
        // a: 1 + 1 + 2 over three ticks, worst 2.
        CHECK_NEAR(stats.phases[0].totalMillis, 4.0, 1e-4);
        CHECK_NEAR(stats.phases[0].maxMillis, 2.0, 1e-4);
        CHECK_EQ(stats.phases[0].runs, 3);
        CHECK_EQ(stats.phases[1].runs, 2);
        CHECK_EQ(stats.phases[4].runs, 1);
        // What no stamp covered: 5 - 3 on the first tick, nothing after.
        CHECK_NEAR(stats.phases[5].totalMillis, 2.0, 1e-4);
        CHECK_EQ(stats.phases[5].runs, 3);
    }
    // The phases add up to the ticks they were taken from.
    double sum = 0;
    for (const auto& phase : stats.phases) sum += phase.totalMillis;
    CHECK_NEAR(sum, 19.0, 1e-3);

    // The window was drained: a second with no ticks sends no phases, not
    // the last second's again.
    CHECK(nextDebugStats(h, watcher, stats));
    CHECK_EQ(stats.ticks, 0);
    CHECK(stats.phases.empty());
}

TEST(tick_profile_reports_the_real_tick_phases) {
    Harness h("tick-profile-real",
              [](const std::string& p) { seedUser(p, "watcher", "password7"); }, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient watcher;
    CHECK(loginAs(h, watcher, "watcher", "password7"));

    h.step(1, {&watcher});
    // Longer than any real tick here, so `other` takes up the difference.
    GameServerPeer::foldLastTick(h.server, 1000.0);

    NetClient::ServerDebugStats stats;
    CHECK(nextDebugStats(h, watcher, stats));
    CHECK_EQ(stats.ticks, 1);
    CHECK(!stats.phases.empty());
    if (stats.phases.empty()) return;
    CHECK_EQ(stats.phases.front().name, std::string("sessions"));
    CHECK_EQ(stats.phases.back().name, std::string("other"));
    CHECK(indexOf(stats, "persist") > indexOf(stats, "sessions"));
    CHECK(indexOf(stats, "bot population") > indexOf(stats, "persist"));
    double sum = 0;
    for (const auto& phase : stats.phases) {
        CHECK_EQ(phase.runs, 1);
        sum += phase.totalMillis;
    }
    CHECK_NEAR(sum, 1000.0, 1e-2);
}
