#include "test.h"

#include "client/net_client.h"
#include "server_harness.h"
#include "shared/game/config.h"
#include "shared/net/protocol.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace flix;

// What one client actually has to download in order to play.
//
// A real server with its usual bot population, a real socket, and the client's
// OWN byte counter -- the one the debug panel reads, which totals framed sizes
// off the dispatch rather than estimating from a model of the protocol. A
// budget defended by arithmetic over field widths is a budget defended against
// the protocol somebody wrote down, not the one that runs: the first time this
// was measured, the guess and the meter disagreed by two orders of magnitude
// about which field was worth optimising.

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::Harness;

/// The ceiling one client's download has to fit inside.
///
/// Everything incoming counts, not only snapshots: a budget that excludes a
/// channel is one that can be met by moving bytes into the channel it excludes.
constexpr std::uint32_t kBudgetBytesPerSecond = 20000;

/// Bytes received over one simulated second of play at this window size.
///
/// The window is given in the units a client reports -- WORLD units, not
/// pixels: the client divides by its own camera zoom before sending, so this
/// is the rectangle it draws, and a zoom-out lens arrives here as a window
/// several times the size of the monitor showing it.
std::uint32_t downloadPerSecond(int viewportWidth, int viewportHeight, const char* label,
                                const char* username) {
    Harness h(label);
    if (!h.ready) { CHECK(false); return 0; }

    NetClient client;
    CHECK(connectClient(h, client));
    client.requestRegister(username, "hunter2!");
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; }));

    client.joinGame(viewportWidth, viewportHeight);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));

    // Let the view fill and the bots gather before measuring. The first second
    // after a join is nearly all spawn records, which is a one-off cost and
    // not what a budget per second is about.
    h.step(120, {&client});

    std::uint32_t in = 0;
    std::uint32_t out = 0;
    std::vector<NetClient::WireEvent> top;
    client.takeWireStats(in, out, top);   // discard the join burst

    h.step(net::kTicksPerSecond, {&client});

    client.takeWireStats(in, out, top, 4);
    std::printf("  %s %dx%d: %u B/s down over %zu entities in view\n", label, viewportWidth,
                viewportHeight, in, client.view().entities().size());
    for (const NetClient::WireEvent& event : top) {
        if (event.incoming) std::printf("      %s %u\n", event.name, event.bytes);
    }
    return in;
}

} // namespace

TEST(a_second_of_play_fits_the_download_budget_at_every_window_size) {
    // Three real monitors, the largest last. ENTITY COUNT, not window width,
    // is what the bill tracks, and past about 1440p the world runs out of mobs
    // to put in the box before the box runs out of room -- an ultrawide
    // measures within a whisker of a 1440p screen.
    //
    // The single biggest thing behind these numbers is that the streamed box
    // is four screens across while the drawn one is one, so fifteen sixteenths
    // of what is streamed is not being looked at while it is described. See
    // Replicator::nearReach.
    CHECK(downloadPerSecond(1280, 720, "bw720", "bandwidthone") < kBudgetBytesPerSecond);
    CHECK(downloadPerSecond(1920, 1080, "bw1080", "bandwidthtwo") < kBudgetBytesPerSecond);
    CHECK(downloadPerSecond(2560, 1440, "bw1440", "bandwidththree") < kBudgetBytesPerSecond);
}
