#pragma once
// The wave survival mode, ported from flooooio
// (~/flooooio/Sources/server/internal/wave: wave_mob_spawner.go, wave_pool.go).
//
// A party fights on a disc. Each wave spends a budget of points on mobs drawn
// from the biome's table, at a rarity that climbs with the wave number. When
// the wave's clock runs out and more than four mobs are left, a red clock runs
// the same length with no more spawning; either way the next wave then starts
// and everyone who died gets up beside somebody still standing. Nobody standing
// is game over.
//
// This file is the rules, with no server in them: GameServer (server/waves.cpp)
// owns the rift, the flowers and the mobs.

#include <array>
#include <cstdint>
#include <deque>
#include <optional>
#include <string>

#include "shared/core/types.h"
#include "shared/game/rarity.h"

namespace flix {

enum class WaveBiome : std::uint8_t { Garden = 0, Desert, Ocean, Count };

struct WaveBiomeInfo {
    const char* id;
    const char* label;
    std::uint32_t gaugeColor;   ///< flooooio's BIOME_GAUGE_COLORS
    const char* tile;           ///< maps/tiles art the disc is paved with
};
inline constexpr std::array<WaveBiomeInfo, static_cast<std::size_t>(WaveBiome::Count)> kWaveBiomes{{
    {"garden", "Garden", 0x1EA761u, "grass_c_0.svg"},
    {"desert", "Desert", 0xECDCB8u, "desert_c_0.svg"},
    {"ocean", "Ocean", 0x4E77A7u, "ocean_c_0.svg"},
}};

/// Which biome an admin's word names, or false.
bool waveBiomeNamed(const std::string& word, WaveBiome& out);

inline const WaveBiomeInfo& waveBiomeInfo(WaveBiome biome) {
    const auto index = static_cast<std::size_t>(biome);
    return kWaveBiomes[index < kWaveBiomes.size() ? index : 0];
}

/// Idle: nothing is open. Open: the rift waits and no clock runs. Playing: a
/// flower has gone through and the waves are running. Ended: nobody is left
/// standing; the rift has closed and the last flowers are on GAME OVER.
enum class WavePhase : std::uint8_t { Idle = 0, Open, Playing, Ended };

/// flooooio steps its wave data at 30 Hz (DataUpdatePerSec), and every number
/// below is per one of those steps. Note the clock's step: 0.016 a step is 0.48
/// a real second, so a 60 "second" wave takes 125 real seconds. That is
/// flooooio's pacing as it plays, and it is kept.
inline constexpr double kWaveStepsPerSecond = 30.0;
inline constexpr double kWaveStepMillis = 1000.0 / kWaveStepsPerSecond;
inline constexpr double kWaveClockPerStep = 0.016;
/// A wave ends in the red only with more than this many mobs still up.
inline constexpr int kWaveRedMobCount = 4;
/// No spawn closer than this to a living flower (plus its radius), nor this
/// close to the disc's edge.
inline constexpr double kWaveSpawnSafety = 300.0;
/// Where a flower that died gets up: within this of a living one.
inline constexpr double kWaveReviveDistance = 200.0;

/// The length of a wave on the wave clock: CalculateWaveLength.
double waveLength(int wave);

/// The rarity a mob of this wave rolls: pickRandomRarity, then mobSpawnEndAfter
/// lifting whatever has stopped spawning by this wave.
Rarity rollWaveRarity(int wave, Rng& rng);

struct WaveMob {
    const char* id = nullptr;
    Rarity rarity = Rarity::Common;
};

/// flooooio's MobSpawner: one wave's budget, turned into one mob at a time.
class WaveSpawner {
public:
    /// Starts `wave`: a fresh budget and, from wave 15, a 15% chance of a
    /// special wave (one mob family in a swarm, on a 1000 point bonus).
    /// `forcedGroup` picks the special wave, for a test.
    void next(WaveBiome biome, int wave, Rng& rng, int forcedGroup = -1);

    /// One step of the wave: the mob to place now, if any.
    std::optional<WaveMob> step(WaveBiome biome, int wave, Rng& rng);

    int points() const { return points_; }
    bool special() const { return group_ >= 0; }

private:
    int totalTime_ = -1;
    int group_ = -1;
    int points_ = 0;
    std::deque<WaveMob> queue_;
};

} // namespace flix
