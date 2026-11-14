#include "shared/game/waves.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace flix {
namespace {

// mobSpawnRules, one row per WaveBiome. The ids are ours; each of flooooio's
// mobs is here under its own name. The weights are its own, which is why a
// garden centipede is 1 in 300.
//
// flooooio stops at ocean, and the rows after it are ours, from the mob group
// each of those maps' bands grow (data/mobs.json `groups`), laid out as its
// rows are. An ordinary mob weighs 50, as in its garden, and a rare one its
// share of that in the group (a golden leafbug is 0.02 of a leafbug, so 1). A
// chain weighs 1 and costs kCentipedePoints, as its centipedes do, and a rare
// variant costs 5, as its shiny ladybug does. Wave 1 is the gentle mobs and the
// hostile ones come in by wave 3, as in flooooio's, except where a biome has
// too few gentle ones to fill a wave: the hel map grows nothing but hel
// beetles, and the pyramid little but mummies. The pharaoh beetle, the
// pyramid's one-off, comes as a rare one there.
//
// Left out, as flooooio leaves out the ant hole: what the overworld grows as a
// nest (the termite mound, a dungeon door; the server, which hatches glitches),
// and the computer's sun, a still body six times a hornet's size that a super
// one would cover the disc with.
struct Rule {
    const char* id;
    int spawnsAfter;
    double weight;
    int points;
};
constexpr int kCentipedePoints = 3;
constexpr int kRarePoints = 5;
const std::array<std::vector<Rule>, kWaveBiomeCount>& rules() {
    static const std::array<std::vector<Rule>, kWaveBiomeCount> table{{
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
         {"shiny_ladybug", 3, 1, kRarePoints},
         {"desert_centipede", 1, 1, kCentipedePoints}},
        {{"starfish", 3, 1, 1},
         {"jellyfish", 3, 1, 1},
         {"bubble", 1, 1, 1},
         {"sponge", 1, 1, 1},
         {"shell", 1, 1, 1},
         {"crab", 2, 1, 1},
         {"leech", 4, 1, 1}},
        // Jungle.
        {{"bush", 1, 50, 1},
         {"leafbug", 1, 50, 1},
         {"dark_ladybug", 1, 50, 1},
         {"firefly", 2, 50, 1},
         {"mantis", 3, 50, 1},
         {"wasp", 3, 50, 1},
         {"golden_leafbug", 3, 1, kRarePoints},
         {"magic_firefly", 3, 2.5, kRarePoints},
         {"evil_centipede", 2, 1, kCentipedePoints}},
        // Computer.
        {{"javascript", 1, 50, 1},
         {"cube", 1, 50, 1},
         {"dust", 1, 50, 1},
         {"glitch", 2, 50, 1},
         {"glitch_flower", 3, 40, 1},
         {"c++", 3, 0.5, kRarePoints},
         {"c--", 3, 0.005, kRarePoints}},
        // Hel.
        {{"hel_beetle", 1, 50, 1}},
        // Sewers.
        {{"garbage", 1, 50, 1},
         {"roach", 1, 50, 1},
         {"moth", 1, 50, 1},
         {"fly", 2, 50, 1},
         {"spider", 3, 50, 1}},
        // Pyramid.
        {{"tomb", 1, 3, 1},
         {"mummy_beetle", 1, 50, 1},
         {"pharaoh_beetle", 5, 1, kRarePoints}},
    }};
    return table;
}

// specialWaveMobGroups, without the mobs flooooio left commented out, and ours
// after ocean: each a family of that biome's row, whose weights pick within it.
using Group = std::vector<const char*>;
const std::array<std::vector<Group>, kWaveBiomeCount>& specialGroups() {
    static const std::array<std::vector<Group>, kWaveBiomeCount> table{{
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
        {{"mantis"},
         {"wasp"},
         {"leafbug", "golden_leafbug"},
         {"firefly", "magic_firefly"},
         {"evil_centipede"}},
        {{"glitch"}, {"glitch", "glitch_flower"}, {"javascript"}, {"cube"}, {"dust"}},
        {{"hel_beetle"}},
        {{"fly"}, {"spider"}, {"roach"}, {"moth"}},
        {{"mummy_beetle"}, {"tomb"}},
    }};
    return table;
}

const std::vector<Group>& groupsOf(WaveBiome biome) {
    const auto index = static_cast<std::size_t>(biome);
    return specialGroups()[index < specialGroups().size() ? index : 0];
}

// relativeRarity, which florr's own wave chances are, Common through Ultra.
// Nothing above: a super had a hundredth of an ultra's weight here, which put
// them on the disc from wave 75 and left nothing else by 90. Supers, uniques
// and apexes now come on a schedule of their own (rollWaveRarity).
constexpr std::array<double, 7> kRelativeRarity{28710.94, 4921.88, 656.25, 52.5, 1.0, 0.1, 0.001};
// mobSpawnEndAfter: past this wave a rarity no longer spawns, and whatever rolled
// it is lifted one step. Common through legendary are flooooio's, where mythic
// never ends; ours does, and the climb has made ultras most of a wave by then.
constexpr std::array<int, 6> kRarityEndsAfter{20, 30, 40, 50, 60, kWaveMythicEndsAfter};
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
constexpr double kSwarmAmplitude = 25.0;
double swarmAmount(double x) {
    constexpr double kAmplitude = kSwarmAmplitude, kMean = 20.0, kWidth = 25.0, kDeviation = 1.0;
    const double distance = x - kMean;
    const double half = kWidth / 2.0;
    if (distance > 0.0 || distance >= -half) return 1.0 + kAmplitude;
    const double over = -distance - half;
    return 1.0 + kAmplitude * std::exp(-(over * over) / (2.0 * kDeviation * kDeviation));
}

// What one ordinary spawn averages.
double meanAmount() {
    double total = 0.0, weighted = 0.0;
    for (std::size_t i = 0; i < kAmountWeights.size(); ++i) {
        total += kAmountWeights[i];
        weighted += kAmountWeights[i] * static_cast<double>(i + 1);
    }
    return weighted / total;
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

std::vector<const char*> waveMobIds(WaveBiome biome) {
    std::vector<const char*> ids;
    for (const Rule& rule : rulesOf(biome)) ids.push_back(rule.id);
    return ids;
}

double waveLength(int wave) {
    return std::max(18.9287 * std::pow(static_cast<double>(std::max(wave, 0)), 0.2) + 30.0, 60.0);
}

double waveRadius(int wave) {
    const double grown = kWavesStartRadius + kWaveRadiusGrowth * (std::max(wave, 1) - 1);
    return std::min(grown, kWavesMaxRadius);
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
    // Lowest first, so a rarity lifted into one that has ended too keeps rising.
    // flooooio walks a Go map here, in a random order each time, which stops
    // short of that some of the time; the table says what it means to do.
    for (std::size_t i = 0; i < kRarityEndsAfter.size(); ++i) {
        if (rolled == static_cast<int>(i) && wave > kRarityEndsAfter[i]) ++rolled;
    }
    Rarity rarity = static_cast<Rarity>(rolled);
    // Past kWaveSuperFrom an ultra is a super by a share growing evenly to all of
    // them at kWaveAllSuperAt. Every mob is an ultra by then, so this is the
    // whole wave's mix. Drawn only where it can come out either way, so every
    // wave below keeps the one draw it has always made.
    if (rarity == Rarity::Ultra && wave > kWaveSuperFrom) {
        const double share = static_cast<double>(wave - kWaveSuperFrom) /
                             static_cast<double>(kWaveAllSuperAt - kWaveSuperFrom);
        if (share >= 1.0 || rng.unit() < share) rarity = Rarity::Super;
    }
    if (rarity == Rarity::Super && wave >= kWaveUniqueFrom) {
        const double roll = rng.unit();
        const double apex = wave >= kWaveApexFrom ? kWaveApexChance : 0.0;
        if (roll < apex) {
            rarity = Rarity::Apex;
        } else if (roll < apex + kWaveUniqueChance) {
            rarity = Rarity::Unique;
        }
    }
    return rarity;
}

void WaveSpawner::next(WaveBiome biome, int wave, Rng& rng, int forcedGroup) {
    totalTime_ = -1;
    const auto& groups = groupsOf(biome);
    group_ = -1;
    if (forcedGroup >= 0 && forcedGroup < static_cast<int>(groups.size())) {
        group_ = forcedGroup;
    } else if (forcedGroup < 0 && wave >= kSpecialWaveFrom && rng.unit() < kSpecialWaveChance) {
        group_ = static_cast<int>(rng.below(static_cast<std::uint32_t>(groups.size())));
    }
    points_ = wave * kPointsPerWave + (group_ >= 0 ? kSpecialWavePoints : 0);

    // flooooio spawns at one pace, so past wave 20 or so a wave's clock ran out
    // before its budget did. Each spawn here is made bigger instead, by as much
    // as it takes to have the lot out within kWaveSpawnWindow of the wave, and
    // the queue is drained fast enough to keep up.
    const double perSpawn = group_ >= 0 ? 1.0 + kSwarmAmplitude : meanAmount();
    const double spawns = waveLength(wave) * kWaveSpawnWindow * kWaveStepsPerSecond / kSpawnDelaySteps;
    pace_ = std::max(1.0, static_cast<double>(points_) / (perSpawn * spawns));
    perStep_ = std::max(1, static_cast<int>(std::ceil(perSpawn * pace_ / kSpawnDelaySteps)));
}

void WaveSpawner::step(WaveBiome biome, int wave, Rng& rng, std::vector<WaveMob>& out) {
    out.clear();
    ++totalTime_;
    if (points_ > 0 && totalTime_ % kSpawnDelaySteps == 0) {
        const auto& groups = groupsOf(biome);
        const Group* group = group_ >= 0 ? &groups[static_cast<std::size_t>(group_)] : nullptr;
        const double base =
            group == nullptr
                ? static_cast<double>(rollAmount(rng))
                : swarmAmount(static_cast<double>(totalTime_) / static_cast<double>(kSpawnDelaySteps));
        const int amount = std::max(1, static_cast<int>(std::lround(base * pace_)));
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
    for (int i = 0; i < perStep_ && !queue_.empty(); ++i) {
        const WaveMob mob = queue_.front();
        queue_.pop_front();
        if (isChain(mob.id)) {
            for (int eaten = 0; eaten < kChainBodies && !queue_.empty(); ++eaten) queue_.pop_front();
        }
        out.push_back(mob);
    }
}

} // namespace flix
