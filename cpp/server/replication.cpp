#include "server/replication.h"

#include <algorithm>
#include <cmath>

namespace flr {

std::uint8_t computeEntityState(World& world, Entity e, double nowMillis) {
    std::uint8_t state = 0;

    if (const Health* health = world.tryGet<Health>(e)) {
        if (nowMillis < health->flashUntilMillis) state |= net::StateHurt;
        if (nowMillis < health->invulnerableUntilMillis) state |= net::StateInvulnerable;
    }
    if (const Afflictions* afflictions = world.tryGet<Afflictions>(e)) {
        if (afflictions->poisoned(nowMillis)) state |= net::StatePoisoned;
        if (afflictions->slowed(nowMillis)) state |= net::StateSlowed;
    }
    if (const PlayerInput* input = world.tryGet<PlayerInput>(e)) {
        if (input->current.attacking()) state |= net::StateAttacking;
        if (input->current.defending()) state |= net::StateDefending;
    }
    if (world.has<Dead>(e)) state |= net::StateDead;

    return state;
}

void Replicator::build(World& world, Entity viewer, ClientView& view,
                       const Frame& frame, ByteWriter& out) {
    const Transform* viewerTransform = world.tryGet<Transform>(viewer);
    if (!viewerTransform) return;

    const Vec2 centre = viewerTransform->position;
    Vec2 viewport{1920, 1080};
    if (const PlayerLocation* location = world.tryGet<PlayerLocation>(viewer)) {
        viewport = location->viewport;
    }
    // A radius over the viewport's half-diagonal covers the corners; anything
    // less pops entities in and out as the camera rotates the world past them.
    const double reach = 0.5 * std::sqrt(viewport.x * viewport.x + viewport.y * viewport.y) + viewMargin;
    const double reachSq = reach * reach;

    // --- gather what is in view ------------------------------------------
    candidates_.clear();
    Query<NetId, Replicated, Transform> replicated{world};
    replicated.each([&](Entity e, NetId& id, Replicated&, Transform& transform) {
        const double distanceSq = flr::distanceSq(transform.position, centre);
        // The viewer's own body is always replicated, however the camera sits:
        // losing it would leave the client with nothing to anchor prediction to.
        if (distanceSq > reachSq && e != viewer) return;
        candidates_.push_back({e, id.value, distanceSq});
    });

    if (candidates_.size() > maxEntities) {
        // Nearest wins. That is both the cheapest useful rule and the one that
        // matches what the player is actually looking at.
        std::nth_element(candidates_.begin(),
                         candidates_.begin() + static_cast<std::ptrdiff_t>(maxEntities),
                         candidates_.end(),
                         [](const Candidate& a, const Candidate& b) {
                             return a.distanceSq < b.distanceSq;
                         });
        candidates_.resize(maxEntities);
    }

    for (auto& tracked : view.tracked) tracked.second.seenThisTick = false;

    // --- header -----------------------------------------------------------
    out.u8(static_cast<std::uint8_t>(net::ServerMessage::Snapshot));
    out.u32(frame.tick);
    out.f64(frame.nowMillis);

    // The last input the simulation has consumed. The client discards its
    // predicted inputs up to here and replays only what is still outstanding.
    std::uint32_t acknowledged = 0;
    if (const PlayerInput* input = world.tryGet<PlayerInput>(viewer)) {
        acknowledged = input->lastAppliedSequence;
    }
    out.u32(acknowledged);

    // The viewer's own authoritative state, always in full. It is the one
    // entity whose exact values the client must reconcile against, so it never
    // goes through the change-mask path.
    out.position(viewerTransform->position);
    if (const Motion* motion = world.tryGet<Motion>(viewer)) {
        out.position(motion->velocity);
    } else {
        out.position({0, 0});
    }
    if (const Health* health = world.tryGet<Health>(viewer)) {
        out.f32(static_cast<float>(health->current));
        out.f32(static_cast<float>(health->max));
    } else {
        out.f32(0);
        out.f32(0);
    }
    if (const PlayerProgress* progress = world.tryGet<PlayerProgress>(viewer)) {
        out.f64(progress->totalXp);
        out.u16(static_cast<std::uint16_t>(progress->level));
        out.u32(static_cast<std::uint32_t>(std::max(0, progress->stars)));
    } else {
        out.f64(0);
        out.u16(1);
        out.u32(0);
    }

    // --- spawns and updates ----------------------------------------------
    const std::size_t spawnCountAt = out.reserveU16();
    std::uint16_t spawnCount = 0;
    const std::size_t updateCountAt = out.reserveU16();
    std::uint16_t updateCount = 0;

    // Two passes over the same candidate list rather than two gathers: the
    // client must create an entity before it can be updated, and interleaving
    // the two record types would force it to tolerate either order.
    for (const Candidate& candidate : candidates_) {
        auto it = view.tracked.find(candidate.netId);
        if (it != view.tracked.end()) {
            it->second.seenThisTick = true;
            continue;
        }

        const Replicated& info = world.get<Replicated>(candidate.entity);
        const Transform& transform = world.get<Transform>(candidate.entity);
        const double radius = world.tryGet<Body>(candidate.entity)
                                  ? world.get<Body>(candidate.entity).radius
                                  : 10.0;

        std::uint8_t flags = info.spawnFlags;
        if (candidate.entity == viewer) flags |= net::SpawnIsSelf;
        const PlayerAccount* account = world.tryGet<PlayerAccount>(candidate.entity);
        if (account && !account->username.empty()) flags |= net::SpawnHasName;

        out.u32(candidate.netId);
        out.u8(static_cast<std::uint8_t>(info.kind));
        out.u16(info.typeIndex);
        out.u8(static_cast<std::uint8_t>(info.rarity));
        out.u8(flags);
        out.position(transform.position);
        out.angle(transform.angle);
        out.f32(static_cast<float>(radius));
        // Current health and state travel WITH the spawn. Without them an
        // entity that enters view already hurt draws a full health bar until
        // it next changes, which for a fleeing mob may be never.
        const Health* spawnHealth = world.tryGet<Health>(candidate.entity);
        out.unitShort(spawnHealth ? spawnHealth->fraction() : 1.0);
        out.u8(computeEntityState(world, candidate.entity, frame.nowMillis));
        if (flags & net::SpawnHasName) out.str(account->username);
        ++spawnCount;

        // Seed the tracked values from what the spawn record just carried, so
        // this tick's update pass has nothing left to say about it.
        ClientView::Tracked tracked;
        tracked.position = transform.position;
        tracked.angle = transform.angle;
        tracked.radius = radius;
        tracked.seenThisTick = true;
        tracked.healthFraction = spawnHealth ? spawnHealth->fraction() : 1.0;
        tracked.state = computeEntityState(world, candidate.entity, frame.nowMillis);
        view.tracked.emplace(candidate.netId, tracked);
    }
    out.patchU16(spawnCountAt, spawnCount);

    for (const Candidate& candidate : candidates_) {
        auto it = view.tracked.find(candidate.netId);
        if (it == view.tracked.end()) continue;
        ClientView::Tracked& tracked = it->second;

        const Transform& transform = world.get<Transform>(candidate.entity);
        const Health* health = world.tryGet<Health>(candidate.entity);
        const Body* body = world.tryGet<Body>(candidate.entity);
        const std::uint8_t state = computeEntityState(world, candidate.entity, frame.nowMillis);

        std::uint8_t mask = 0;
        if (distanceSq(transform.position, tracked.position) >
            tolerances.position * tolerances.position) {
            mask |= net::FieldPosition;
        }
        if (std::fabs(wrapAngle(transform.angle - tracked.angle)) > tolerances.angle) {
            mask |= net::FieldAngle;
        }
        if (health && std::fabs(health->fraction() - tracked.healthFraction) >
                          tolerances.healthFraction) {
            mask |= net::FieldHealth;
        }
        if (state != tracked.state) mask |= net::FieldState;
        if (body && std::fabs(body->radius - tracked.radius) > tolerances.radius) {
            mask |= net::FieldSize;
        }
        if (mask == 0) continue;

        out.u32(candidate.netId);
        out.u8(mask);
        if (mask & net::FieldPosition) {
            out.position(transform.position);
            tracked.position = transform.position;
        }
        if (mask & net::FieldAngle) {
            out.angle(transform.angle);
            tracked.angle = transform.angle;
        }
        if (mask & net::FieldHealth) {
            out.unitShort(health->fraction());
            tracked.healthFraction = health->fraction();
        }
        if (mask & net::FieldState) {
            out.u8(state);
            tracked.state = state;
        }
        if (mask & net::FieldSize) {
            out.f32(static_cast<float>(body->radius));
            tracked.radius = body->radius;
        }
        ++updateCount;
    }
    out.patchU16(updateCountAt, updateCount);

    // --- removals ---------------------------------------------------------
    //
    // Anything tracked that this tick did not see has left view or died. The
    // erase happens only after the removal is written, and the transport is
    // ordered and reliable, so the client cannot be left believing in an
    // entity the server has forgotten.
    removals_.clear();
    for (const auto& entry : view.tracked) {
        if (!entry.second.seenThisTick) removals_.push_back(entry.first);
    }
    out.u16(static_cast<std::uint16_t>(std::min<std::size_t>(removals_.size(), 0xFFFF)));
    for (const std::uint32_t netId : removals_) {
        out.u32(netId);
        view.tracked.erase(netId);
    }

    // --- events -----------------------------------------------------------
    const std::size_t eventCountAt = out.reserveU16();
    std::uint16_t eventCount = 0;
    if (frame.events) {
        // Events are cosmetic and one-shot. Scoping them to the same reach as
        // entities keeps a busy fight on the far side of the map from costing
        // every client bytes for numbers they will never see.
        for (const WireEvent& event : frame.events->events()) {
            if (event.positional && distanceSq(event.position, centre) > reachSq) continue;
            out.u8(static_cast<std::uint8_t>(event.kind));
            out.u32(event.netId);
            out.u32(event.otherNetId);
            out.f32(static_cast<float>(event.amount));
            out.position(event.position);
            out.f32(static_cast<float>(event.radius));
            out.u8(event.flag);
            ++eventCount;
        }
    }
    out.patchU16(eventCountAt, eventCount);
}

} // namespace flr
