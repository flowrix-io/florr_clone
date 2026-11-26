#include "server/cluster/placement.h"

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace flix::cluster {

namespace {

struct Tally {
    std::vector<double> cost;
    std::vector<int> count;
};

Tally tally(const std::vector<BiomeLoad>& biomes, const std::vector<ServerLoad>& servers) {
    Tally t;
    t.cost.assign(servers.size(), 0.0);
    t.count.assign(servers.size(), 0);
    for (const BiomeLoad& biome : biomes) {
        if (biome.server < 0 || biome.server >= static_cast<int>(servers.size())) continue;
        const auto at = static_cast<std::size_t>(biome.server);
        t.cost[at] += biome.cost;
        ++t.count[at];
    }
    return t;
}

bool isUp(const std::vector<ServerLoad>& servers, int server) {
    return server >= 0 && server < static_cast<int>(servers.size()) &&
           servers[static_cast<std::size_t>(server)].up;
}

} // namespace

std::vector<Move> placeOrphans(const std::vector<BiomeLoad>& biomes,
                               const std::vector<ServerLoad>& servers) {
    std::vector<int> orphans;
    for (std::size_t i = 0; i < biomes.size(); ++i) {
        if (!isUp(servers, biomes[i].server)) orphans.push_back(static_cast<int>(i));
    }
    // Heaviest first is what makes a greedy deal come out even; the order
    // given settles ties, so two gateways would deal the same hand.
    std::stable_sort(orphans.begin(), orphans.end(), [&](int a, int b) {
        return biomes[static_cast<std::size_t>(a)].cost > biomes[static_cast<std::size_t>(b)].cost;
    });

    Tally t = tally(biomes, servers);
    std::vector<Move> moves;
    const auto full = [&](std::size_t s) {
        // Never all of them, but where nowhere else will do.
        return !servers[s].takesAll && t.count[s] + 1 >= static_cast<int>(biomes.size());
    };
    // Those with a home first, so that what is dealt to the quietest server is
    // dealt around them.
    std::stable_partition(orphans.begin(), orphans.end(), [&](int orphan) {
        return isUp(servers, biomes[static_cast<std::size_t>(orphan)].home);
    });
    for (const int orphan : orphans) {
        int best = -1;
        const int home = biomes[static_cast<std::size_t>(orphan)].home;
        const bool goesHome = isUp(servers, home) && !full(static_cast<std::size_t>(home));
        if (goesHome) best = home;
        for (std::size_t s = 0; s < servers.size() && !goesHome; ++s) {
            if (!servers[s].up) continue;
            if (full(s)) continue;
            if (best < 0 || t.cost[s] < t.cost[static_cast<std::size_t>(best)] ||
                (t.cost[s] == t.cost[static_cast<std::size_t>(best)] &&
                 t.count[s] < t.count[static_cast<std::size_t>(best)])) {
                best = static_cast<int>(s);
            }
        }
        if (best < 0) continue;
        moves.push_back({orphan, best});
        t.cost[static_cast<std::size_t>(best)] += biomes[static_cast<std::size_t>(orphan)].cost;
        ++t.count[static_cast<std::size_t>(best)];
    }
    return moves;
}

std::vector<Move> homecomings(const std::vector<BiomeLoad>& biomes,
                              const std::vector<ServerLoad>& servers) {
    Tally t = tally(biomes, servers);
    std::vector<Move> moves;
    for (std::size_t i = 0; i < biomes.size(); ++i) {
        const BiomeLoad& biome = biomes[i];
        if (biome.pinned || biome.server == biome.home) continue;
        if (!isUp(servers, biome.server) || !isUp(servers, biome.home)) continue;
        const auto to = static_cast<std::size_t>(biome.home);
        if (t.count[to] + 1 >= static_cast<int>(biomes.size())) continue;
        --t.count[static_cast<std::size_t>(biome.server)];
        ++t.count[to];
        moves.push_back({static_cast<int>(i), biome.home});
    }
    return moves;
}

Move rebalance(const std::vector<BiomeLoad>& biomes, const std::vector<ServerLoad>& servers) {
    const Tally t = tally(biomes, servers);
    int busiest = -1;
    int quietest = -1;
    for (std::size_t s = 0; s < servers.size(); ++s) {
        if (!servers[s].up) continue;
        if (busiest < 0 || t.cost[s] > t.cost[static_cast<std::size_t>(busiest)]) {
            busiest = static_cast<int>(s);
        }
        if (quietest < 0 || t.cost[s] < t.cost[static_cast<std::size_t>(quietest)]) {
            quietest = static_cast<int>(s);
        }
    }
    if (busiest < 0 || busiest == quietest) return {};
    const auto from = static_cast<std::size_t>(busiest);
    const auto to = static_cast<std::size_t>(quietest);
    if (t.count[to] + 1 >= static_cast<int>(biomes.size())) return {};

    // A server that joined with every biome already dealt has nothing at all:
    // it is owed one whatever the costs say, so long as the giver keeps some.
    const bool idle = t.count[to] == 0 && t.count[from] > 1;
    const bool overloaded = servers[from].tickMillis >= kOverloadedTickMillis;
    const double gap = t.cost[from] - t.cost[to];

    Move best;
    double bestLeft = t.cost[from];
    for (std::size_t i = 0; i < biomes.size(); ++i) {
        const BiomeLoad& biome = biomes[i];
        if (biome.server != busiest || biome.pinned || biome.home == busiest) continue;
        if (biome.humans > 0 && !overloaded) continue;
        // Moving more than the gap only swaps which server is the busy one.
        if (biome.cost >= gap && !idle) continue;
        const double left = std::max(t.cost[from] - biome.cost, t.cost[to] + biome.cost);
        if (best.biome < 0 || left < bestLeft) {
            best = {static_cast<int>(i), quietest};
            bestLeft = left;
        }
    }
    if (best.biome < 0) return {};
    const double gained = t.cost[from] - bestLeft;
    if (!idle && gained < t.cost[from] * kWorthwhileShare) return {};
    return best;
}

} // namespace flix::cluster
