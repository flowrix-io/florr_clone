#pragma once

// The figures behind the petals whose effect is code rather than a stat: the
// strikes, blasts, self-costs and summons PetalSystem runs. Shared so the
// petal card (menu_inventory.cpp) quotes exactly what the server does -- a
// card that kept its own copy of these would drift the first time one moved.

#include <cstdint>

namespace flix {

/// A strike reaches this far and, when the petal declares no damage of its own,
/// lands this much AT COMMON.
///
/// The fallback is a base, not a figure: it goes up the same 3x-per-tier petal
/// ladder `stats.damage` does (see petalStatScale). A flat one is how an apex
/// battery ended up striking for a common battery's number -- `damage: 0` in
/// petals.json means "this petal does not hit things with its body", not "this
/// petal's shock ignores what tier it is".
inline constexpr double kLightningRadius = 1000.0;
inline constexpr double kLightningFallbackDamage = 25.0;

/// The battery ships with three discharges and spends one per body slam, no
/// faster than twice a second. It has no health pool -- petals.json gives it a
/// null `health`, which is a petal nothing can break -- so running the charges
/// out is the ONLY thing that ever takes it off the ring, and the slot's
/// ordinary cooldown is what hands a full one back.
inline constexpr std::uint8_t kBatteryCharges = 3;
inline constexpr double kBatteryStrikeIntervalMillis = 500.0;
/// A battery's discharge lands three times the strike a lightning petal of its
/// tier would: it is three charges and done, so each one has to count.
inline constexpr double kBatteryStrikeScale = 3.0;

/// How far apart a worn lightning cutter's strikes are: 500 ms, so at most
/// twice a second. The limiter is per PLAYER rather than per petal, so a second
/// blade shares the first one's cadence instead of doubling the strike rate.
inline constexpr double kLightningCutterIntervalMillis = 500.0;

/// The capacitor banks one point of shock per millisecond it spends against a
/// mob, holds no more than 60, and throws all of it as one strike the moment
/// the contact ends. A full second of unbroken contact discharges it too:
/// without that, a capacitor that never LEAVES -- one latched onto a mob by
/// attraction, one parked inside a boss -- would bank forever and never fire.
///
/// Common figures. The strike goes up the same 3x petal ladder a lightning
/// petal's does, so an apex capacitor charges at 3^n points a millisecond.
inline constexpr double kCapacitorChargePerMillis = 1.0;
inline constexpr double kCapacitorMaxCharge = 60.0;
inline constexpr double kCapacitorWindowMillis = 1000.0;

/// Blast reach per unit of the petal's `size` stat: 120, so a size-2 bomb
/// reaches 240 -- a couple of mobs' widths around where it went off.
///
/// The reference meant `size * 40 * 3` ("convert to pixels, make it 3x
/// larger") but its caller had already multiplied by 40, so it shipped 4800 a
/// unit: a bomb that went off 9600 units out, several screens past anything
/// its owner could see. That doubled conversion is not carried over.
inline constexpr double kExplosionRadiusPerSize = 120.0;

/// What one blast deals at common. The bomb's `damage` stat is 0 -- its body
/// hits nothing, the blast is all of it -- so the figure lives here.
inline constexpr double kBombBlastDamage = 30.0;
inline constexpr double kTestExplosiveBlastDamage = 50.0;

/// A blood leaf's burst: flat below Admin (Admin climbs the strength ladder).
inline constexpr double kBloodLeafBlastDamage = 100.0;

/// A scripted heal is a steeper curve than a burst petal's. `stats.heal`
/// already carries its rarity; a script's literal does not, so the reference
/// multiplies it by sqrt(3) per tier and by a flat 3 on top of the talent.
inline constexpr double kBehaviourHealScale = 3.0;

/// What a blood stinger costs its own flower each time it grows back, at
/// common: it climbs the tiers on the petal strength ladder its damage does
/// (petalStrengthScale), lands as a mob's hit would (applySelfDamage), and is
/// never the blow that kills.
inline constexpr double kBloodStingerSelfDamage = 5.0;

/// An apex egg does not hatch an apex pet. The reference substitutes three
/// unique ones, which is the top of the ladder a pet can actually reach. A
/// universal egg hatches the same three, stronger (see summonPets).
inline constexpr int kApexPetCount = 3;

/// The flower petal cracks on the mob it touches: nineteen breaks in twenty
/// open onto a squad of glitch flowers, and the twentieth takes the flower
/// that was carrying it.
inline constexpr double kFlowerCorruptChance = 0.05;
/// How long a flower its own petal has just corrupted cannot damage another
/// player.
inline constexpr double kCorruptionHarmlessMillis = 5000.0;
inline constexpr int kFlowerPetCount = 3;
inline constexpr const char* kFlowerPetMobId = "glitch_flower";

/// A triangle hits harder for every OTHER triangle on the active row: each one
/// adds half of its own damage again, so three triangles hit for double.
inline constexpr double kTriangleStackBonus = 0.5;
inline constexpr double triangleStackScale(int equipped) {
    return 1.0 + kTriangleStackBonus * static_cast<double>(equipped > 1 ? equipped - 1 : 0);
}

/// A web's field: what it slows mobs to, and how long it lies (Admin's
/// reach scale lengthens both the throw and the life).
inline constexpr double kWebSlowFactor = 0.5;
inline constexpr double kAdminWebSlowFactor = 0.05;
inline constexpr double kWebLifetimeSeconds = 10.0;

}  // namespace flix
