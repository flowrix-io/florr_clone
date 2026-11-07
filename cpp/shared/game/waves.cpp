#include "shared/game/waves.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace flix {
namespace {

// mobSpawnRules. The ids are ours; each of flooooio's mobs is here under its own
// name. The weights are its own, which is why a garden centipede is 1 in 300.
struct Rule {
    const char* id;
    int spawnsAfter;
    double weight;
    int points;
};
constexpr int kCentipedePoints = 3;
const std::array<std::vector<Rule>, 3>& rules() {
    static const std::array<std::vector<Rule>, 3> table{{
        {{"bee", 1, 50, 1},
         {"spider", 3, 50, 1},
         {"hornet", 3, 50, 1},
         {"baby_ant", 1, 50, 1},
         {"worker_ant", 2, 50, 1},
         {"soldier_ant", 3, 50, 1},
         {"centipede", 2, 1, kCentipedePoints},
         {"evil_centipede", 3, 1, kCentipedePoints}},
        {{"beetle", 2, 200, 1},
         {"sandstorm", 1, 200, 1},
         {"cactus", 1, 200, 1},
         {"scorpion", 3, 200, 1},
         {"shiny_ladybug", 3, 1, 5},
         {"desert_centipede", 1, 1, kCentipedePoints}},
        {{"starfish", 3, 1, 1},
         {"jellyfish", 3, 1, 1},
         {"bubble", 1, 1, 1},
         {"sponge", 1, 1, 1},
         {"shell", 1, 1, 1},
         {"crab", 2, 1, 1},
         {"leech", 4, 1, 1}},
    }};
    return table;
}

// specialWaveMobGroups, without the mobs flooooio left commented out.
using Group = std::vector<const char*>;
const std::array<std::vector<Group>, 3>& specialGroups() {
    static const std::array<std::vector<Group>, 3> table{{
        {{"baby_ant", "worker_ant", "soldier_ant"},
         {"bee"},
         {"hornet"},
         {"hornet", "bee"},
         {"spider"}},
        {{"beetle"}, {"desert_centipede"}, {"sandstorm"}, {"scorpion"}},
        {{"bubble"},
         {"crab"},
         {"jellyfish"},
         {"leech"},
         {"shell"},
         {"shell", "sponge"},
         {"starfish"}},
    }};
    return table;
}

// relativeRarity, which florr's own wave chances are, Common through Ultra.
constexpr std::array<double, 7> kRelativeRarity{28710.94, 4921.88, 656.25, 52.5, 1.0, 0.1, 0.001};
// mobSpawnEndAfter: past this wave a rarity no longer spawns, and whatever rolled
// it is lifted one step. Mythic never ends.
constexpr std::array<int, 5> kRarityEndsAfter{20, 30, 40, 50, 60};
// amountTable: how many mobs one ordinary spawn is, 1 to 5.
constexpr std::array<double, 5> kAmountWeights{0.25, 0.20, 0.15, 0.10, 0.05};
// spawnDelay: a spawn every 0.8 s.
constexpr int kSpawnDelaySteps = 24;
constexpr int kSpecialWaveFrom = 15;
constexpr double kSpecialWaveChance = 0.15;
constexpr int kSpecialWavePoints = 1000;
constexpr int kPointsPerWave = 10;
// A chain eats this many more of the queue (ComputeDynamicMobData).
constexpr int kChainBodies = 9;

const std::vector<Rule>& rulesOf(WaveBiome biome) {
    const auto index = static_cast<std::size_t>(biome);
    return rules()[index < rules().size() ? index : 0];
}

const Rule* ruleOf(WaveBiome biome, const char* id) {
    for (const Rule& rule : rulesOf(biome)) {
        if (std::strcmp(rule.id, id) == 0) return &rule;
    }
    return nullptr;
}

bool isChain(const char* id) {
    return std::strcmp(id, "centipede") == 0 || std::strcmp(id, "desert_centipede") == 0 ||
           std::strcmp(id, "evil_centipede") == 0 || std::strcmp(id, "leech") == 0;
}

int rollAmount(Rng& rng) {
    double total = 0.0;
    for (const double weight : kAmountWeights) total += weight;
    double left = total * rng.unit();
    for (std::size_t i = 0; i < kAmountWeights.size(); ++i) {
        left -= kAmountWeights[i];
        if (left <= 0.0) return static_cast<int>(i) + 1;
    }
    return static_cast<int>(kAmountWeights.size());
}

// flatTopGaussian with its constants: a special wave ramps up to 26 mobs a spawn.
double swarmAmount(double x) {
    constexpr double kAmplitude = 25.0, kMean = 20.0, kWidth = 25.0, kDeviation = 1.0;
    const double distance = x - kMean;
    const double half = kWidth / 2.0;
    if (distance > 0.0 || distance >= -half) return 1.0 + kAmplitude;
    const double over = -distance - half;
    return 1.0 + kAmplitude * std::exp(-(over * over) / (2.0 * kDeviation * kDeviation));
}

const char* pickMob(WaveBiome biome, int wave, const Group* group, Rng& rng) {
    if (group != nullptr) {
        double total = 0.0;
        for (const char* id : *group) {
            const Rule* rule = ruleOf(biome, id);
            if (rule != nullptr && rule->spawnsAfter <= wave) total += rule->weight;
        }
        double left = total * rng.unit();
        for (const char* id : *group) {
            const Rule* rule = ruleOf(biome, id);
            if (rule == nullptr || rule->spawnsAfter > wave) continue;
            left -= rule->weight;
            if (left <= 0.0) return rule->id;
        }
    }
    double total = 0.0;
    for (const Rule& rule : rulesOf(biome)) {
        if (rule.spawnsAfter <= wave) total += rule.weight;
    }
    double left = total * rng.unit();
    const char* last = nullptr;
    for (const Rule& rule : rulesOf(biome)) {
        if (rule.spawnsAfter > wave) continue;
        last = rule.id;
        left -= rule.weight;
        if (left <= 0.0) return rule.id;
    }
    return last;
}

} // namespace

bool waveBiomeNamed(const std::string& word, WaveBiome& out) {
    for (std::size_t i = 0; i < kWaveBiomes.size(); ++i) {
        if (word == kWaveBiomes[i].id) {
            out = static_cast<WaveBiome>(i);
            return true;
        }
    }
    return false;
}

double waveLength(int wave) {
    return std::max(18.9287 * std::pow(static_cast<double>(std::max(wave, 0)), 0.2) + 30.0, 60.0);
}

Rarity rollWaveRarity(int wave, Rng& rng) {
    double total = 0.0;
    for (const double weight : kRelativeRarity) total += weight;
    // The best of 1.3^wave rolls, in closed form.
    const double value = std::pow(rng.unit(), 1.0 / std::pow(1.3, static_cast<double>(wave)));
    double floor = 1.0;
    int rolled = 0;
    for (int i = static_cast<int>(kRelativeRarity.size()) - 1; i >= 0; --i) {
        floor -= kRelativeRarity[static_cast<std::size_t>(i)] / total;
        if (value >= floor) {
            rolled = i;
            break;
        }
    }
    // An ultra rolled is a mythic spawned.
    rolled = std::min(rolled, static_cast<int>(Rarity::Mythic));
    // Lowest first, so a rarity lifted into one that has ended too keeps rising.
    // flooooio walks a Go map here, in a random order each time, which stops
    // short of that some of the time; the table says what it means to do.
    for (std::size_t i = 0; i < kRarityEndsAfter.size(); ++i) {
        if (rolled == static_cast<int>(i) && wave > kRarityEndsAfter[i]) ++rolled;
    }
    return static_cast<Rarity>(rolled);
}

void WaveSpawner::next(WaveBiome biome, int wave, Rng& rng, int forcedGroup) {
    totalTime_ = -1;
    const auto& groups = specialGroups()[std::min<std::size_t>(static_cast<std::size_t>(biome), 2)];
    group_ = -1;
    if (forcedGroup >= 0 && forcedGroup < static_cast<int>(groups.size())) {
        group_ = forcedGroup;
    } else if (forcedGroup < 0 && wave >= kSpecialWaveFrom && rng.unit() < kSpecialWaveChance) {
        group_ = static_cast<int>(rng.below(static_cast<std::uint32_t>(groups.size())));
    }
    points_ = wave * kPointsPerWave + (group_ >= 0 ? kSpecialWavePoints : 0);
}

std::optional<WaveMob> WaveSpawner::step(WaveBiome biome, int wave, Rng& rng) {
    ++totalTime_;
    if (points_ > 0 && totalTime_ % kSpawnDelaySteps == 0) {
        const auto& groups =
            specialGroups()[std::min<std::size_t>(static_cast<std::size_t>(biome), 2)];
        const Group* group = group_ >= 0 ? &groups[static_cast<std::size_t>(group_)] : nullptr;
        const int amount =
            group == nullptr
                ? rollAmount(rng)
                : static_cast<int>(std::lround(swarmAmount(
                      static_cast<double>(totalTime_) / static_cast<double>(kSpawnDelaySteps))));
        for (int i = 0; i < amount; ++i) {
            const char* id = pickMob(biome, wave, group, rng);
            // Nothing eligible, which only a wave below every rule can mean.
            if (id == nullptr) break;
            queue_.push_back({id, rollWaveRarity(wave, rng)});
            const Rule* rule = ruleOf(biome, id);
            points_ = std::max(0, points_ - (rule != nullptr ? rule->points : 1));
            if (points_ == 0) break;
        }
    }
    if (queue_.empty()) return std::nullopt;
    const WaveMob mob = queue_.front();
    queue_.pop_front();
    if (isChain(mob.id)) {
        for (int i = 0; i < kChainBodies && !queue_.empty(); ++i) queue_.pop_front();
    }
    return mob;
}

} // namespace flix
