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
#include <string>
#include <unordered_map>
#include <vector>

#include "shared/core/world.h"
#include "shared/game/components.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flix {


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
        /// The last health fraction SENT, and -1 until one has been.
        ///
        /// Compared for exact equality, because the wire carries the f64 this
        /// holds: anything a hit changes about a mob's pool is a change the
        /// client must see. A threshold here used to be the bug -- at 1/255 a
        /// petal taking a millionth of an apex mob read as "unchanged" and the
        /// bar sat still through the whole fight.
        double healthFraction = -1;
        double radius = -1;
        std::uint8_t state = 0xFF;    ///< 0xFF is not a valid state, forcing a first send
        std::uint8_t faceFlags = 0xFF;
        std::uint8_t equipFlags = 0xFF;
        std::uint32_t renderFlags = 0xFFFFFFFFu;
        std::uint16_t level = 0;      ///< 0 is not a valid level, forcing a first send
        std::uint8_t bestRarity = 0xFF;
        std::uint32_t arenaScore = 0;
        /// A hash of the equipped skin id, not the id itself.
        ///
        /// One Tracked exists per entity per viewer -- mobs, petals, drops and
        /// all -- so a std::string here would be 32 bytes on every one of them
        /// to describe something only players ever have. The hash is used for
        /// change detection alone; the wire always carries the real id. 0 is
        /// the hash of "", so the sentinel for "never sent" has to be
        /// something else.
        std::uint32_t skinIdHash = 0xFFFFFFFFu;
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
/// Health is deliberately absent: it is compared exactly (see
/// ClientView::Tracked::healthFraction) rather than against a threshold,
/// because a mob's bar is read as a proportion of a pool that spans nine
/// orders of magnitude across the tier ladder, and any fixed fraction of it is
/// enormous at the top.
struct ReplicationTolerances {
    double position = 0.05;     ///< world units
    double angle = 0.01;        ///< radians, ~0.6 degrees
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
    /// The space `position` is in. A positional event is only sent to viewers
    /// in the same realm: a damage number in the maze means nothing to a
    /// flower in the overworld whose window happens to cover the same numbers.
    Realm realm = Realm::Overworld;
    double radius = 0;
    std::uint8_t flag = 0;

    /// Lightning only: where each bolt ends, in world space. Empty for every
    /// other kind, and the only variable-length thing on the event wire.
    std::vector<Vec2> points;

    /// Only clients within this distance of `position` are sent the event.
    /// A damage number on the far side of the map is bytes nobody will see.
    bool positional = false;
};

/// Collects the tick's events, then hands each client the ones it can see.
class EventQueue {
public:
    void clear() { events_.clear(); }
    void push(const WireEvent& e) { events_.push_back(e); }

    /// `flags` is a net::DamageEventFlags mask. Poison is called out on the
    /// wire because the client colours and offsets a tick differently from a
    /// petal hit, and only the server knows which one landed.
    void damage(std::uint32_t netId, double amount, Vec2 at, Realm realm,
                std::uint8_t flags = 0) {
        WireEvent e;
        e.kind = net::EventKind::Damage;
        e.netId = netId;
        e.amount = amount;
        e.position = at;
        e.realm = realm;
        e.flag = flags;
        e.positional = true;
        events_.push_back(e);
    }

    void killed(std::uint32_t netId, Vec2 at, Realm realm) {
        WireEvent e;
        e.kind = net::EventKind::Killed;
        e.netId = netId;
        e.position = at;
        e.realm = realm;
        e.positional = true;
        events_.push_back(e);
    }

    /// `petalIndex` and `rarity` are the drop's LOOK, carried so the client can
    /// play the pickup for an item it never held: magnetism is a pickup radius,
    /// and loot that lands inside it is collected on the tick it spawned --
    /// before any snapshot has carried the entity. See net::EventKind::PickedUp.
    void pickedUp(std::uint32_t dropNetId, std::uint32_t byNetId, Vec2 at, Realm realm,
                  std::uint16_t petalIndex, Rarity rarity) {
        WireEvent e;
        e.kind = net::EventKind::PickedUp;
        e.netId = dropNetId;
        e.otherNetId = byNetId;
        e.amount = static_cast<double>(petalIndex);
        e.flag = static_cast<std::uint8_t>(rarityIndex(rarity));
        e.position = at;
        e.realm = realm;
        e.positional = true;
        events_.push_back(e);
    }

    /// `targets` is where the bolts end -- the mobs the strike hit -- already
    /// trimmed to net::kMaxLightningTargets by the caller, which is the only
    /// side that knows which ones are nearest.
    void lightning(Vec2 at, double radius, Realm realm, const std::vector<Vec2>& targets) {
        WireEvent e;
        e.kind = net::EventKind::Lightning;
        e.position = at;
        e.radius = radius;
        e.realm = realm;
        e.points = targets;
        e.positional = true;
        events_.push_back(std::move(e));
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
        /// Counts SNAPSHOTS, not ticks: the wire runs slower than the
        /// simulation and on its own clock, so a cadence expressed in ticks
        /// would land unevenly on the frames that actually go out.
        std::uint32_t snapshotIndex = 0;
        double nowMillis = 0;
        const EventQueue* events = nullptr;
        /// Bodies streamed to this client however far away they are.
        ///
        /// The viewer's squadmates, and nothing else: the reference's own
        /// visibility test lets a squad member through the viewport box, which
        /// is what makes the party HUD and the pink minimap dots work at a
        /// distance. Null when the viewer squads alone, which is the ordinary
        /// case and costs the gather nothing.
        const std::vector<Entity>* alwaysVisible = nullptr;
    };

    /// Appends a complete Snapshot payload (message id included) to `out`.
    ///
    /// `viewer` must be a live player entity. `view` is mutated to record what
    /// this snapshot told the client.
    void build(World& world, Entity viewer, ClientView& view, const Frame& frame, ByteWriter& out);

    ReplicationTolerances tolerances;

    /// Per-AXIS half-extent of the replicated region, as a multiple of the
    /// client's own reported viewport.
    ///
    /// Two decisions live in this one number. It is a RECTANGLE rather than a
    /// circle, because the screen is one and a radius that covers the corners
    /// over-serves the edges; and it is two viewports rather than half of one,
    /// because the reference streams a box four screens wide so an entity is
    /// known long before it is drawn. Anything tighter pops mobs in at the
    /// screen edge as soon as the player zooms out or enlarges the window.
    double viewportReach = 2.0;

    /// How far out an entity still gets an update EVERY snapshot, as a
    /// multiple of the viewport per axis.
    ///
    /// The streamed box is four screens across (viewportReach above), and the
    /// screen inside it is one -- so fifteen sixteenths of everything streamed
    /// is, at any moment, being described to a client that is not drawing it.
    /// Those entities are streamed so they are KNOWN before they are drawn,
    /// which is a statement about existence, not about being current to the
    /// tick: a mob two screens away can be a tenth of a second stale without a
    /// single pixel being wrong.
    ///
    /// The viewport a client reports is the world rectangle it DRAWS -- it
    /// divides by its own zoom before sending, so a wide loadout lens widens
    /// this box rather than seeing past it. The drawn rectangle is therefore
    /// 0.5 of it per axis, and 0.75 leaves a quarter-screen margin all round:
    /// 640 world units at 1440p, which the fastest thing in the game takes two
    /// seconds to cross and the far band is never more than a fifth of a
    /// second stale. Nothing reaches the drawn edge without having been at
    /// full rate for a long while first.
    double nearReach = 0.75;

    /// One snapshot in this many carries the far band. Staggered by net id, so
    /// the band's cost is spread evenly over the snapshots rather than landing
    /// on every fourth one as a spike.
    int farSnapshotStride = 4;

    /// Ceiling on entities in one snapshot.
    ///
    /// A frame-size backstop, NOT a cull rule: the reference caps nothing, and
    /// this sits far above what a four-screen box ever holds, so the nearest-
    /// wins tiebreak below should never actually fire in play. It exists only
    /// so a pathological world cannot ask the server to build a frame past the
    /// transport's limit.
    std::size_t maxEntities = 8000;

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

/// The player-specific flag families that define the flower sprite. Keeping
/// these separate from EntityState lets ordinary entities retain their compact
/// generic state while players track the TypeScript renderer exactly.
struct PlayerVisualState {
    std::uint8_t faceFlags = FaceNone;
    std::uint8_t equipFlags = EquipNone;
    std::uint32_t renderFlags = PlayerRenderNone;
    /// The plate under every flower reads its own level and tints itself with
    /// the best rarity anywhere in that flower's loadout, so both belong to
    /// the viewer of a player rather than to the player being viewed.
    std::uint16_t level = 1;
    Rarity bestRarity = Rarity::Common;
    /// The arena leaderboard's number; zero for anyone not in the ring.
    std::uint32_t arenaScore = 0;
    /// Borrowed from PlayerVisuals, never owned: this is rebuilt for every
    /// player in every viewer's snapshot, and copying a ~20-character id that
    /// many times a second is a heap allocation per player per viewer for a
    /// string that has not changed since login. Null is "no custom skin", and
    /// the pointee outlives the snapshot it is written into -- the world is
    /// not mutated while one is being built.
    const std::string* equippedSkinId = nullptr;
};

/// The id a visual state names, or "" when it names none.
inline const std::string& skinIdOf(const PlayerVisualState& visuals) {
    static const std::string none;
    return visuals.equippedSkinId ? *visuals.equippedSkinId : none;
}

PlayerVisualState computePlayerVisuals(World& world, Entity e, double nowMillis);

} // namespace flix
