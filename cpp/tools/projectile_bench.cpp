// What a loadout full of projectile petals costs the server, per tick.
//
// Gas fires ten slow shots that live for ten seconds, off every slot, so a
// flower wearing nothing else keeps over a thousand of them in the air around
// itself. Every one of those is a body: it is filed in the broadphase, flown,
// hit-tested and replicated each tick. This boots the real server (no bots,
// one real client on loopback so the tick gate opens and replication runs),
// equips the loadout, holds attack, and prints what the ticks cost.
//
// Usage: projectile_bench [petal] [seconds] [observers]
//   petal      config name to fill all ten slots with (default: gas)
//   seconds    simulated seconds to hold attack for (default: 20)
//   observers  extra clients parked on the same spot, each a viewer the
//              replication has to encode the cloud for (default: 0)
//
// Also prints what the shooter's own client downloads per second once the
// cloud has built up: every shot in view is an entity on the wire.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "../tests/server_harness.h"
#include "shared/game/components.h"
#include "shared/game/config.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

using Clock = std::chrono::steady_clock;

double millisSince(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

double percentile(std::vector<double> samples, double p) {
    if (samples.empty()) return 0.0;
    std::sort(samples.begin(), samples.end());
    const std::size_t at = std::min(samples.size() - 1,
                                    static_cast<std::size_t>(p * (samples.size() - 1) + 0.5));
    return samples[at];
}

} // namespace

int main(int argc, char** argv) {
    const std::string petal = argc > 1 ? argv[1] : "gas";
    const double seconds = argc > 2 ? std::atof(argv[2]) : 20.0;
    const int observers = argc > 3 ? std::max(0, std::atoi(argv[3])) : 0;

    Harness h("projectile-bench", {}, dataDir(), 0);
    if (!h.ready) return 1;

    const std::uint16_t config = content().petalIndex(petal);
    if (config == kInvalidIndex) {
        std::printf("no petal named %s\n", petal.c_str());
        return 1;
    }

    std::vector<std::unique_ptr<NetClient>> clients;
    std::vector<NetClient*> all;
    for (int i = 0; i <= observers; ++i) {
        clients.push_back(std::make_unique<NetClient>());
        const std::string name = i == 0 ? "shooter" : "watcher" + std::to_string(i);
        if (!loginNew(h, *clients.back(), name.c_str(), "hunter2!")) {
            std::printf("login failed for %s\n", name.c_str());
            return 1;
        }
        clients.back()->joinGame(1920, 1080, {}, name);
        all.push_back(clients.back().get());
    }
    if (!h.stepUntil(all, [&] {
            return std::all_of(all.begin(), all.end(), [](NetClient* c) {
                return c->status() == NetClient::Status::Playing;
            });
        })) {
        std::printf("clients never reached Playing\n");
        return 1;
    }

    World& world = h.server.world();
    const Entity shooter = bodyNamed(world, "shooter");
    if (shooter == NULL_ENTITY) return 1;
    for (int slot = 0; slot < kLoadoutActiveSlots; ++slot) {
        world.get<Loadout>(shooter).slots[slot] = LoadoutSlot{config, Rarity::Common, 0.0, false};
    }
    // The watchers stand where the shooter stands, so every one of them has the
    // whole cloud in view.
    const Vec2 spot = world.get<Transform>(shooter).position;
    for (int i = 1; i <= observers; ++i) {
        const Entity watcher = bodyNamed(world, "watcher" + std::to_string(i));
        if (watcher != NULL_ENTITY) world.get<Transform>(watcher).position = spot;
    }

    const int ticks = static_cast<int>(seconds * 1000.0 / net::kTickMillis);
    std::vector<double> tickCost;
    std::vector<double> networkCost;
    tickCost.reserve(static_cast<std::size_t>(ticks));
    networkCost.reserve(static_cast<std::size_t>(ticks));
    std::size_t peakShots = 0;
    double shotTicks = 0;
    const int warmTicks = static_cast<int>(2000.0 / net::kTickMillis);
    std::uint64_t steadyBytes = 0;
    std::vector<NetClient::WireEvent> wireTop;

    net::InputFrame input;
    input.flags = net::InputAttack;
    input.viewportWidth = 1920;
    input.viewportHeight = 1080;
    for (int i = 0; i < ticks; ++i) {
        input.sequence = static_cast<std::uint32_t>(i + 1);
        // Turning slowly so the volleys fan out the way a player's would.
        input.aimAngle = i * 0.05;
        clients[0]->sendInput(input);
        for (NetClient* c : all) c->poll(0);

        auto start = Clock::now();
        h.server.serviceNetwork(0);
        double network = millisSince(start);

        h.clock += net::kTickMillis;
        start = Clock::now();
        h.server.tick(h.clock);
        tickCost.push_back(millisSince(start));

        start = Clock::now();
        h.server.serviceNetwork(0);
        network += millisSince(start);
        networkCost.push_back(network);
        for (NetClient* c : all) c->poll(0);

        std::uint32_t inBytes = 0;
        std::uint32_t outBytes = 0;
        clients[0]->takeWireStats(inBytes, outBytes, wireTop);
        if (i >= warmTicks) steadyBytes += inBytes;

        std::size_t shots = 0;
        Query<ProjectileTag> projectiles{world};
        projectiles.each([&](Entity, ProjectileTag&) { ++shots; });
        peakShots = std::max(peakShots, shots);
        shotTicks += static_cast<double>(shots);
    }

    // The first two seconds are the cloud building up; the steady state is
    // what a player standing there holding attack costs.
    const std::size_t warm = std::min(tickCost.size(), static_cast<std::size_t>(warmTicks));
    const std::vector<double> steadyTick(tickCost.begin() + static_cast<std::ptrdiff_t>(warm), tickCost.end());
    const std::vector<double> steadyNet(networkCost.begin() + static_cast<std::ptrdiff_t>(warm), networkCost.end());
    double tickSum = 0;
    for (const double t : steadyTick) tickSum += t;
    double netSum = 0;
    for (const double t : steadyNet) netSum += t;
    const double n = std::max<double>(1.0, static_cast<double>(steadyTick.size()));

    std::printf("petal=%s seconds=%.0f observers=%d\n", petal.c_str(), seconds, observers);
    std::printf("shots: peak %zu, mean %.0f\n", peakShots, shotTicks / std::max(1, ticks));
    std::printf("tick ms:    mean %.3f  p50 %.3f  p95 %.3f  max %.3f\n", tickSum / n,
                percentile(steadyTick, 0.5), percentile(steadyTick, 0.95),
                percentile(steadyTick, 1.0));
    std::printf("network ms: mean %.3f  p50 %.3f  p95 %.3f  max %.3f\n", netSum / n,
                percentile(steadyNet, 0.5), percentile(steadyNet, 0.95),
                percentile(steadyNet, 1.0));
    const double steadySeconds = n * net::kTickSeconds;
    std::printf("download:   %.0f B/s to the shooter\n",
                static_cast<double>(steadyBytes) / steadySeconds);
    return 0;
}
