// What a crowded fight costs the server, phase by phase.
//
// The live server's tick goes over budget when a biome fills up: dozens of
// flowers in one place, most of them wearing shooters, a field of mobs around
// them shooting back. This boots the real server with exactly that -- real
// clients on loopback, each with a mixed loadout of projectile, web and
// summoning petals, holding attack and turning, invulnerable so the crowd
// stays put, and the operator's console keeping mobs coming in around them --
// and prints what every phase of the tick cost, combat's steps included.
//
// Usage: combat_bench [seconds] [players] [mobs]
//   seconds  simulated seconds to measure after the warm-up (default: 20)
//   players  flowers in the crowd (default: 50)
//   mobs     mobs the console keeps alive around the crowd (default: 500)
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "../tests/server_harness.h"
#include "server/db.h"
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

/// How many fighter accounts seedAccounts makes.
int gPlayers = 50;

/// The admin and every fighter, made before the server opens the database:
/// signing that many up over the wire would trip the per-address limit on
/// new accounts.
void seedAccounts(const std::string& path) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    CreateResult created = db.createUser("benchadmin", "password7");
    if (created.ok()) created.account->admin = true;
    for (int i = 0; i < gPlayers; ++i) {
        db.createUser("fighter" + std::to_string(i), "hunter2!");
    }
    db.markDirty();
    db.save();
}

/// What the crowd wears: every petal that puts shots in the air, the web
/// (a ground effect) and the summoners, at the tiers a busy biome carries.
constexpr const char* const kPetals[] = {
    "missile", "gas",     "peas",      "grapes",         "magic_peas", "rainbow",
    "guided_missile",     "magic_missile", "carrot",     "spaceship",  "web",
    "stick",   "egg",     "missile",   "peas",           "rainbow",
};
constexpr Rarity kRarities[] = {Rarity::Legendary, Rarity::Mythic, Rarity::Ultra, Rarity::Super};

/// What the console keeps around the crowd: shooters and plain fighters.
constexpr const char* const kMobs[] = {"hornet", "bee", "soldier_ant", "beetle", "ladybug",
                                       "hornet", "spider", "centipede", "rock"};
constexpr const char* const kMobRarities[] = {"epic", "legendary", "mythic", "ultra"};

} // namespace

int main(int argc, char** argv) {
    const double seconds = argc > 1 ? std::atof(argv[1]) : 20.0;
    const int players = argc > 2 ? std::max(1, std::atoi(argv[2])) : 50;
    const int mobTarget = argc > 3 ? std::max(0, std::atoi(argv[3])) : 500;

    gPlayers = players;
    Harness h("combat-bench", seedAccounts, dataDir(), 0);
    if (!h.ready) return 1;

    NetClient admin;
    if (!loginAs(h, admin, "benchadmin", "password7")) {
        std::printf("admin login failed\n");
        return 1;
    }
    admin.joinGame(1920, 1080, {}, "benchadmin");
    std::vector<std::unique_ptr<NetClient>> clients;
    std::vector<NetClient*> all{&admin};
    for (int i = 0; i < players; ++i) {
        clients.push_back(std::make_unique<NetClient>());
        const std::string name = "fighter" + std::to_string(i);
        if (!loginAs(h, *clients.back(), name.c_str(), "hunter2!")) {
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
    const Entity boss = bodyNamed(world, "benchadmin");
    if (boss == NULL_ENTITY) return 1;
    const Vec2 centre = world.get<Transform>(boss).position;
    const Realm realm = world.get<Transform>(boss).realm;
    world.get<Health>(boss).invulnerableUntilMillis = std::numeric_limits<double>::infinity();

    Rng rng{0xC0FFEE};
    std::vector<Entity> bodies;
    for (int i = 0; i < players; ++i) {
        const Entity body = bodyNamed(world, "fighter" + std::to_string(i));
        if (body == NULL_ENTITY) return 1;
        bodies.push_back(body);
        if (world.get<Transform>(body).realm == realm) {
            world.get<Transform>(body).position = centre + rng.insideCircle(900.0);
        }
        world.get<Health>(body).invulnerableUntilMillis = std::numeric_limits<double>::infinity();
        for (int slot = 0; slot < kLoadoutActiveSlots; ++slot) {
            const char* petal = kPetals[rng.below(std::size(kPetals))];
            const std::uint16_t config = content().petalIndex(petal);
            if (config == kInvalidIndex) {
                std::printf("no petal named %s\n", petal);
                return 1;
            }
            world.get<Loadout>(body).slots[slot] =
                LoadoutSlot{config, kRarities[rng.below(std::size(kRarities))], 0.0, false};
        }
    }

    const auto countMobs = [&] {
        int n = 0;
        Query<MobTag, Transform> mobs{world};
        mobs.each([&](Entity, MobTag&, Transform& at) {
            if (at.realm == realm && (at.position - centre).length() < 2500.0) ++n;
        });
        return n;
    };

    const int warmTicks = static_cast<int>(5000.0 / net::kTickMillis);
    const int ticks = warmTicks + static_cast<int>(seconds * 1000.0 / net::kTickMillis);
    std::vector<double> tickCost;
    std::map<std::string, std::vector<double>> phaseCost;
    std::vector<std::string> phaseOrder;
    std::size_t peakShots = 0, shotSum = 0;
    int mobSum = 0;

    net::InputFrame input;
    input.flags = net::InputAttack;
    input.viewportWidth = 1920;
    input.viewportHeight = 1080;
    for (int i = 0; i < ticks; ++i) {
        // Top the mobs up around the crowd, a console line at a time: the
        // console takes one line per tick.
        if (i % 2 == 0 && countMobs() < mobTarget) {
            const Vec2 at = centre + rng.insideCircle(1600.0);
            admin.sendChat(std::string("/admin spawn ") + kMobs[rng.below(std::size(kMobs))] + " " +
                           kMobRarities[rng.below(std::size(kMobRarities))] + " " +
                           std::to_string(static_cast<int>(at.x)) + " " +
                           std::to_string(static_cast<int>(at.y)) + " 8");
        }
        input.sequence = static_cast<std::uint32_t>(i + 1);
        for (std::size_t c = 0; c < clients.size(); ++c) {
            input.aimAngle = i * 0.05 + static_cast<double>(c);
            input.aimDistance = 200.0;
            clients[c]->sendInput(input);
        }
        for (NetClient* c : all) c->poll(0);
        h.server.serviceNetwork(0);

        h.clock += net::kTickMillis;
        const auto start = Clock::now();
        h.server.tick(h.clock);
        const double took = millisSince(start);

        h.server.serviceNetwork(0);
        for (NetClient* c : all) c->poll(0);
        // Invulnerability belongs to the body; a flower that somehow went
        // down comes back mortal, so keep re-applying it.
        for (const Entity body : bodies) {
            if (Health* health = world.tryGet<Health>(body)) {
                health->invulnerableUntilMillis = std::numeric_limits<double>::infinity();
            }
        }
        if (i < warmTicks) continue;

        tickCost.push_back(took);
        for (const auto& [name, ms] : GameServerPeer::lastTickPhases(h.server)) {
            auto& samples = phaseCost[name];
            if (samples.empty()) phaseOrder.push_back(name);
            samples.push_back(ms);
        }
        std::size_t shots = 0;
        Query<ProjectileTag> projectiles{world};
        projectiles.each([&](Entity, ProjectileTag&) { ++shots; });
        peakShots = std::max(peakShots, shots);
        shotSum += shots;
        if (i % 30 == 0) mobSum += countMobs();
    }

    const double n = std::max<double>(1.0, static_cast<double>(tickCost.size()));
    double tickSum = 0;
    for (const double t : tickCost) tickSum += t;
    std::printf("players=%d seconds=%.0f mob target=%d\n", players, seconds, mobTarget);
    std::printf("shots in the air: peak %zu, mean %.0f; mobs around the crowd: mean %.0f\n",
                peakShots, static_cast<double>(shotSum) / n,
                mobSum / std::max(1.0, n / 30.0));
    std::printf("tick ms: mean %.2f  p50 %.2f  p95 %.2f  max %.2f\n\n", tickSum / n,
                percentile(tickCost, 0.5), percentile(tickCost, 0.95), percentile(tickCost, 1.0));
    std::printf("%-32s %8s %8s %8s\n", "phase", "mean", "p95", "max");
    for (const std::string& name : phaseOrder) {
        const std::vector<double>& samples = phaseCost[name];
        double sum = 0;
        for (const double t : samples) sum += t;
        const double mean = sum / n;
        if (mean < 0.05 && percentile(samples, 1.0) < 1.0) continue;
        std::printf("%-32s %8.2f %8.2f %8.2f\n", name.c_str(), mean, percentile(samples, 0.95),
                    percentile(samples, 1.0));
    }
    return 0;
}
