#pragma once

// What "seen" means for a mob's simulation.
//
// A mob is SEEN when some flower's streamed box -- the rectangle replication
// sends that flower's client (Replicator::build) -- reaches the edge of its
// body. An unseen mob is not simulated at all: its brain does not step, it
// does not move, it is not separated from other mobs and it is not filed in
// the broadphase, so nothing collides with it. Nobody can tell: the box is
// the client's drawn screen plus a screen and a half of margin per side, and
// nothing a client has never been sent can be seen standing still.
//
// Bots are flowers too and see like one: a bot fighting a band needs that band
// awake as much as a human does.

#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/game/constants.h"
#include "shared/game/rarity.h"
#include "shared/game/realm.h"
#include "shared/core/types.h"

#include <cmath>
#include <vector>

namespace flix {

/// Replicator::viewportReach's default. The streamed box is this many
/// viewports across per axis on a default screen.
inline constexpr double kObserverViewportReach = 2.0;

/// The streamed box's half extents for a client drawing `viewport` world
/// units, by the rule Replicator::build applies: the drawn half, plus a margin
/// that scales with the viewport up to the default screen and stops there.
inline Vec2 streamedHalfExtent(Vec2 viewport, double reach = kObserverViewportReach) {
    const auto axis = [&](double drawn, double defaultAxis) {
        return drawn * 0.5 + std::fmin(drawn, defaultAxis) * (reach - 0.5);
    };
    return Vec2{axis(viewport.x, kViewportWidth), axis(viewport.y, kViewportHeight)};
}

/// One flower's streamed box.
///
/// Laid out so `{position, realm}` -- what a RealmPoint list used to hold --
/// is a default-screen observer standing there.
struct ViewBox {
    Vec2 centre;
    Realm realm = Realm::Overworld;
    Vec2 half = streamedHalfExtent(Vec2{kViewportWidth, kViewportHeight});
};

/// Whether a body of `radius` at `position` is inside any box in its realm.
///
/// An EMPTY list is the permissive case: with no flower anywhere there is
/// nobody to save the work for, and a test or bench that never adds a player
/// sees the unmodified rules. (On a live server an empty world's band mobs
/// are asleep as records anyway; see SpawnSystem.)
inline bool seenByAny(Vec2 position, double radius, Realm realm,
                      const std::vector<ViewBox>& views) {
    if (views.empty()) return true;
    const double r = std::isfinite(radius) && radius > 0.0 ? radius : 0.0;
    for (const ViewBox& view : views) {
        if (view.realm != realm) continue;
        if (std::fabs(position.x - view.centre.x) - r < view.half.x &&
            std::fabs(position.y - view.centre.y) - r < view.half.y) {
            return true;
        }
    }
    return false;
}

/// Every flower's streamed box, bots and corpses included (a dead flower
/// respawns where it stands, and its client is still being sent the area).
/// `reach` is Replicator::viewportReach.
inline void collectViewBoxes(World& world, double reach, std::vector<ViewBox>& out) {
    out.clear();
    Query<PlayerTag, Transform> players{world};
    players.each([&](Entity e, PlayerTag&, Transform& transform) {
        if (!std::isfinite(transform.position.x) || !std::isfinite(transform.position.y)) return;
        Vec2 viewport{kViewportWidth, kViewportHeight};
        if (const PlayerLocation* location = world.tryGet<PlayerLocation>(e)) {
            viewport = location->viewport;
        }
        out.push_back({transform.position, transform.realm, streamedHalfExtent(viewport, reach)});
    });
}

/// Whether mob `e` is simulated this tick: seen by some flower, or one of the
/// mobs that never wait to be -- a boss (super and up: announced, raided and
/// always loaded), a pet (its owner is by definition present,
/// and a pet left behind has to walk back) and anything on the waves disc
/// (a wave ends when its disc is clear; its hunters must walk in from the
/// far side whether anyone sees them yet or not).
inline bool mobSimulated(World& world, Entity e, Vec2 position, double radius, Realm realm,
                         const std::vector<ViewBox>& views) {
    if (realm == kWavesRealm) return true;
    if (world.has<Pet>(e)) return true;
    if (const MobType* type = world.tryGet<MobType>(e)) {
        if (isBossRarity(type->rarity)) return true;
    }
    return seenByAny(position, radius, realm, views);
}

} // namespace flix
