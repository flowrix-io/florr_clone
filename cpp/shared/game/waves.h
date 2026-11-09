#pragma once
// The wave survival mode, ported from flooooio
// (~/flooooio/Sources/server/internal/wave: wave_mob_spawner.go, wave_pool.go).
//
// A party fights on a disc that grows each wave. Each wave spends a budget of points on mobs drawn
// from the biome's table, at a rarity that climbs with the wave number, up to
// super. A wave lasts 60 seconds, longer from wave 11, and its mobs come fast
// enough to all be out by half of that. It ends at once when they are all out
// and two or fewer are left. When the clock runs out and more than four are
// left, a red clock runs the same length with no more spawning, and clearing
// the disc ends that early too. Either way the next wave then starts, and
// everyone who died gets up beside somebody still standing. Nobody standing
// ends the game and closes the rift.
//
// Where this differs from flooooio, by request (2026-11-07): its clock runs at
// 0.48 of real time; it has no early end; it spawns at one pace whatever the
// wave, so a high wave runs out of time before its budget is spent; it stops
// at mythic; its disc stays one size; and its room stays open on GAME OVER until
// everyone has left. Mobs spawn evenly over the disc's area where flooooio's
// crowd its middle, and because the disc grows, a hostile one sees a flower
// anywhere on it where flooooio's looks 2000 units (all of its 1500 disc).
//
// flooooio has three biomes, garden, desert and ocean. Jungle, computer, hel,
// sewers and pyramid are ours, built the same way out of what those maps grow
// (waves.cpp).
//
// This file is the rules, with no server in them: GameServer (server/waves.cpp)
// owns the rift, the flowers and the mobs.

#include <array>
#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/rarity.h"
#include "shared/game/realm.h"

namespace flix {

/// The wire carries this as a u8, and a client rejects a WaveState naming one it
/// does not know: a new biome means a kProtocolVersion bump.
enum class WaveBiome : std::uint8_t {
    Garden = 0,
    Desert,
    Ocean,
    Jungle,
    Computer,
    Hel,
    Sewers,
    Pyramid,
    Count
};
inline constexpr std::size_t kWaveBiomeCount = static_cast<std::size_t>(WaveBiome::Count);

struct WaveBiomeInfo {
    const char* id;
    const char* label;
    /// The gauge's bar, drawn over a black track. Garden, desert and ocean
    /// are flooooio's BIOME_GAUGE_COLORS; it has no other biomes.
    std::uint32_t gaugeColor;
    const char* tile;           ///< maps/tiles art the disc is paved with
};
inline constexpr std::array<WaveBiomeInfo, kWaveBiomeCount> kWaveBiomes{{
    {"garden", "Garden", 0x1EA761u, "grass_c_0.svg"},
    {"desert", "Desert", 0xECDCB8u, "desert_c_0.svg"},
    {"ocean", "Ocean", 0x4E77A7u, "ocean_c_0.svg"},
    {"jungle", "Jungle", 0x228B22u, "grass2_c_0.svg"},
    // The computer map's own floor is flat black, which would hide the edge
    // of a disc that has nothing but black around it; its chip has a ground.
    {"computer", "Computer", 0x00FF00u, "computer_ground_black.svg"},
    {"hel", "Hel", 0xFF0000u, "hel_c_0.svg"},
    {"sewers", "Sewers", 0x666633u, "grate_c_0.svg"},
    {"pyramid", "Pyramid", 0xDAA520u, "pyramid_floor_c_0.svg"},
}};

/// Which biome an admin's word names, or false.
bool waveBiomeNamed(const std::string& word, WaveBiome& out);

inline const WaveBiomeInfo& waveBiomeInfo(WaveBiome biome) {
    const auto index = static_cast<std::size_t>(biome);
    return kWaveBiomes[index < kWaveBiomes.size() ? index : 0];
}

/// Idle: nothing is open. Open: the rift waits and no clock runs. Playing: a
/// flower has gone through and the waves are running.
enum class WavePhase : std::uint8_t { Idle = 0, Open, Playing };

/// flooooio steps its wave data at 30 Hz (DataUpdatePerSec), and the spawner's
/// numbers are per one of those steps.
inline constexpr double kWaveStepsPerSecond = 30.0;
inline constexpr double kWaveStepMillis = 1000.0 / kWaveStepsPerSecond;
/// A wave ends in the red only with more than this many mobs still up.
inline constexpr int kWaveRedMobCount = 4;
/// A wave with all its mobs out and this few left is over, whatever its clock
/// says.
inline constexpr int kWaveClearedMobCount = 2;
/// A wave's mobs are all out by this share of its length: a wave whose budget
/// flooooio's pace would not spend by then spawns faster.
inline constexpr double kWaveSpawnWindow = 0.5;
/// The rarest a wave's mob can be.
inline constexpr Rarity kWaveTopRarity = Rarity::Super;
/// How full the disc may get before the spawner waits and the rest of the wave
/// comes as room is made; neither is flooooio's. A count, against special
/// waves piling up unattended, and the floor the bodies cover: a super hornet
/// alone covers a seventh of the disc. Measured: a garden wave 95 unchecked put
/// 950 supers on it, 50 discs' worth, and the server's tick took 120 ms of its
/// 33. Capped at 8 discs' worth it held 134 and took 2.
inline constexpr int kWaveMaxMobs = 1500;
inline constexpr double kWaveMaxBodyArea = 8.0 * kPi * kWavesStartRadius * kWavesStartRadius;
/// How much further the disc reaches each wave, up to kWavesMaxRadius.
inline constexpr double kWaveRadiusGrowth = 50.0;
/// No spawn closer than this to a living flower (plus its radius), nor this
/// close to the disc's edge.
inline constexpr double kWaveSpawnSafety = 300.0;
/// Where a flower that died gets up: within this of a living one.
inline constexpr double kWaveReviveDistance = 200.0;

/// How long a wave is, and its red clock if it needs one, in real seconds:
/// CalculateWaveLength, 60 up to wave 10 and growing slowly after.
double waveLength(int wave);

/// How far the disc reaches during `wave`: flooooio's 1500 at wave 1, 50 more
/// each wave, 8000 at most (from wave 131).
double waveRadius(int wave);

/// Every mob id the biome's waves can hold, in its table's order.
std::vector<const char*> waveMobIds(WaveBiome biome);

/// The rarity a mob of this wave rolls: pickRandomRarity, up to super where
/// flooooio stops at mythic, then mobSpawnEndAfter lifting whatever has stopped
/// spawning by this wave.
Rarity rollWaveRarity(int wave, Rng& rng);

struct WaveMob {
    const char* id = nullptr;
    Rarity rarity = Rarity::Common;
};

/// flooooio's MobSpawner: one wave's budget, turned into mobs a few at a time.
class WaveSpawner {
public:
    /// Starts `wave`: a fresh budget and, from wave 15, a 15% chance of a
    /// special wave (one mob family in a swarm, on a 1000 point bonus).
    /// `forcedGroup` picks the special wave, for a test.
    void next(WaveBiome biome, int wave, Rng& rng, int forcedGroup = -1);

    /// One step of the wave: the mobs to place now, into `out`.
    void step(WaveBiome biome, int wave, Rng& rng, std::vector<WaveMob>& out);

    int points() const { return points_; }
    bool special() const { return group_ >= 0; }
    /// Every mob of this wave has been handed out. Until then, an empty disc only
    /// means the wave has barely started.
    bool finished() const { return points_ == 0 && queue_.empty(); }
    /// Gives up whatever of the wave has not come out yet. The red clock spawns
    /// nothing more, so what a full disc held back would never arrive, and a
    /// wave waiting on it could not end early however clear its disc got.
    void forfeit() {
        points_ = 0;
        queue_.clear();
    }
    /// How many times flooooio's pace this wave spawns at; 1 until its budget
    /// would not be spent within kWaveSpawnWindow of the wave.
    double pace() const { return pace_; }

private:
    int totalTime_ = -1;
    int group_ = -1;
    int points_ = 0;
    double pace_ = 1.0;
    int perStep_ = 1;
    std::deque<WaveMob> queue_;
};

} // namespace flix
