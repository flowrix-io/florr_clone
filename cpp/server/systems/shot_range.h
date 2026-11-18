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

/// Gives a carrot its whole flight back: what one does each time it comes off
/// a wall or passes through a mob, so a carrot that keeps finding things to
/// hit keeps flying. False when the shot names no petal to read the range off.
inline bool refillShotFlight(Projectile& projectile, Lifetime* lifetime) {
    if (projectile.petalConfigIndex >= content().petalCount()) return false;
    const ProjectileSpec& spec = content().petal(projectile.petalConfigIndex).projectile;
    const double range = petalShotRange(spec, projectile.rarity);
    const double speed = petalShotSpeed(spec, projectile.rarity);
    if (!(range > 0.0) || !(speed > 0.0)) return false;
    projectile.remainingDistance = range;
    if (lifetime != nullptr) lifetime->remainingSeconds = range / speed;
    return true;
}

} // namespace flix
