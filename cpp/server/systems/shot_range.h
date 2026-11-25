#pragma once
// How far a petal's own shot flies, and for how long: the one rule the volley
// that launches it (PetalSystem::fireProjectiles), the wall a carrot comes off
// (MovementSystem) and the mob a carrot passes through (CombatSystem) all read,
// so the three cannot disagree about what "a full flight" is.

#include "shared/game/components.h"
#include "shared/game/config.h"
#include "shared/game/rarity.h"

namespace flix {

/// A flower's shots fly twice the reach their petal states, at the same
/// speed: twice as long in the air. `distance` in petals.json is the petal's
/// authored reach and stays the figure the content is written in.
inline constexpr double kPlayerShotRangeScale = 2.0;

/// The speed a petal's shot flies at: its own, doubled at the admin tier.
inline double petalShotSpeed(const ProjectileSpec& spec, Rarity rarity) {
    return spec.speed * (rarity == Rarity::Admin ? 2.0 : 1.0);
}

/// The whole distance a petal's shot is given when it leaves the ring.
inline double petalShotRange(const ProjectileSpec& spec, Rarity rarity) {
    return spec.distance * adminReachScale(rarity) * kPlayerShotRangeScale;
}

} // namespace flix
