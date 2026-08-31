#pragma once
// Per-client snapshot construction.
//
// Each client sees only what is near it, and is told about an entity in three
// stages: a SPAWN record carrying the immutable facts (kind, type, rarity,
// name), then per-tick UPDATE records carrying only the fields that changed,
// then a REMOVE when it leaves view or dies.
//
// Removals are derived, not evented: every tick the replicator diffs what the
// client is believed to know against what is actually in view. There is no
// one-shot "this entity went away" message that can be dropped and leave a
// permanent ghost -- the diff regenerates the removal for as long as the
// discrepancy exists.

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flr {

/// Allocates the ids entities are known by on the wire.
///
/// Separate from Entity because Entity encodes a slot that gets recycled: a
/// client that has not yet processed a removal would otherwise apply an update
/// meant for a brand-new entity to the corpse of the old one. Net ids are
/// monotonic and never reused within a server's lifetime.
class NetIdAllocator {
public:
    std::uint32_t next() { return ++counter_; }

private:
    std::uint32_t counter_ = 0;
};

/// What one client is believed to already know.
class ClientView {
public:
    /// The last values sent for one entity, so the next tick can send only
    /// what actually changed.
    struct Tracked {
        Vec2 position;
        double angle = 0;
        double healthFraction = -1;   ///< -1 so the first update always sends it
        double radius = -1;
        std::uint8_t state = 0xFF;    ///< 0xFF is not a valid state, forcing a first send
        bool seenThisTick = false;
    };

    std::unordered_map<std::uint32_t, Tracked> tracked;

    /// Cleared when the client re-joins, so a fresh session re-learns the world
    /// rather than inheriting a stale belief about it.
    void reset() { tracked.clear(); }
};

/// Quantisation thresholds below which a field is considered unchanged.
///
/// These are the whole reason a snapshot is small. A mob drifting a hundredth
/// of a unit does not need eight bytes spent on it, and no player can see the
/// difference. Set them just under what a pixel represents at normal zoom.
struct ReplicationTolerances {
    double position = 0.05;     ///< world units
    double angle = 0.01;        ///< radians, ~0.6 degrees
    double healthFraction = 1.0 / 255.0;
    double radius = 0.05;
};

/// One transient thing that happened this tick, for effects the client plays
/// without the server streaming per-frame animation state.
struct WireEvent {
    net::EventKind kind = net::EventKind::Damage;
    std::uint32_t netId = 0;
    std::uint32_t otherNetId = 0;
    double amount = 0;
    Vec2 position;
    double radius = 0;
    std::uint8_t flag = 0;

    /// Only clients within this distance of `position` are sent the event.
    /// A damage number on the far side of the map is bytes nobody will see.
    bool positional = false;
};

/// Collects the tick's events, then hands each client the ones it can see.
class EventQueue {
public:
    void clear() { events_.clear(); }
    void push(const WireEvent& e) { events_.push_back(e); }

    void damage(std::uint32_t netId, double amount, Vec2 at, bool critical = false) {
        WireEvent e;
        e.kind = net::EventKind::Damage;
        e.netId = netId;
        e.amount = amount;
        e.position = at;
        e.flag = critical ? 1 : 0;
        e.positional = true;
        events_.push_back(e);
    }

    void killed(std::uint32_t netId, Vec2 at) {
        WireEvent e;
        e.kind = net::EventKind::Killed;
        e.netId = netId;
        e.position = at;
        e.positional = true;
        events_.push_back(e);
    }

    void pickedUp(std::uint32_t dropNetId, std::uint32_t byNetId, Vec2 at) {
        WireEvent e;
        e.kind = net::EventKind::PickedUp;
        e.netId = dropNetId;
        e.otherNetId = byNetId;
        e.position = at;
        e.positional = true;
        events_.push_back(e);
    }

    const std::vector<WireEvent>& events() const { return events_; }

private:
    std::vector<WireEvent> events_;
};

/// Builds the Snapshot message for one client.
class Replicator {
public:
    /// Everything the snapshot needs that is not in the world.
    struct Frame {
        std::uint32_t tick = 0;
        double nowMillis = 0;
        const EventQueue* events = nullptr;
    };

    /// Appends a complete Snapshot payload (message id included) to `out`.
    ///
    /// `viewer` must be a live player entity. `view` is mutated to record what
    /// this snapshot told the client.
    void build(World& world, Entity viewer, ClientView& view, const Frame& frame, ByteWriter& out);

    ReplicationTolerances tolerances;

    /// Half-extent of the replicated region beyond the client's own viewport.
    /// A margin means an entity is known slightly before it is visible, so it
    /// does not pop in at the screen edge, and interpolation has a sample to
    /// work from the moment it matters.
    double viewMargin = 400.0;

    /// Ceiling on entities in one snapshot. A player standing in a swarm must
    /// not be able to make the server build an unbounded frame; the nearest
    /// entities win, which is also what they are looking at.
    std::size_t maxEntities = 900;

private:
    struct Candidate {
        Entity entity;
        std::uint32_t netId;
        double distanceSq;
    };

    std::vector<Candidate> candidates_;
    std::vector<std::uint32_t> removals_;
};

/// Derives the EntityState bits the client draws from. Called once per
/// replicated entity per tick.
std::uint8_t computeEntityState(World& world, Entity e, double nowMillis);

} // namespace flr
