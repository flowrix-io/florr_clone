#pragma once
// The client's mirror of the server's world.
//
// Deliberately NOT an ECS. The client does not simulate these entities -- it
// stores what the last snapshot said and interpolates between snapshots for
// rendering. A flat record per entity is the honest shape for that, and it
// keeps the draw loop free of component lookups.

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "shared/core/types.h"
#include "shared/game/rarity.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flr {

/// One entity as the client knows it.
struct RemoteEntity {
    std::uint32_t netId = 0;
    net::EntityKind kind = net::EntityKind::Mob;
    std::uint16_t typeIndex = 0;
    Rarity rarity = Rarity::Common;
    std::uint8_t spawnFlags = 0;
    std::string name;

    /// Interpolation endpoints. Rendering runs one snapshot in the past so
    /// there are always two real samples to blend between; extrapolating
    /// forward instead makes every entity overshoot and jitter on direction
    /// changes.
    Vec2 previousPosition;
    Vec2 targetPosition;
    double previousAngle = 0;
    double targetAngle = 0;
    double sampleStartMillis = 0;
    double sampleEndMillis = 0;

    /// Blended values the renderer reads.
    Vec2 position;
    double angle = 0;

    double healthFraction = 1;
    double radius = 10;
    std::uint8_t state = 0;

    /// The three flag families used only by the player sprite. They arrive for
    /// player records in a snapshot and remain zero for all other entity kinds.
    std::uint8_t faceFlags = FaceNone;
    std::uint8_t equipFlags = EquipNone;
    std::uint32_t renderFlags = PlayerRenderNone;

    /// Player-only: what the plate under the flower reads. `bestRarity` is the
    /// highest rarity anywhere in that flower's loadout, which is what tints
    /// the level label.
    std::uint16_t level = 1;
    Rarity bestRarity = Rarity::Common;

    /// The guild whose tag hangs under this flower's health bar. Nothing sets
    /// it yet: there is no guild protocol, exactly as menu_guild.cpp records,
    /// so the tag draws for nobody -- which is what the reference draws for a
    /// player in no guild. The plate reads the field rather than the transport
    /// so the wire lands in one place when it exists.
    std::string guildName;

    /// Petal-only: the flower this petal orbits. The server places petals on a
    /// ring around the owner's tick position while the owner is DRAWN at its
    /// eased or predicted one, so the ring has to be re-anchored to whatever
    /// the owner was actually drawn at or it visibly trails the flower.
    std::uint32_t ownerNetId = 0;

    /// Smoothed eye-pupil offset in the flower's radius=25 local space.
    double eyeX = 0;
    double eyeY = 0;

    /// Set on the tick a spawn record arrived, so the renderer can play a
    /// pop-in and so interpolation knows not to blend from a stale origin.
    bool fresh = true;

    bool isSelf() const { return (spawnFlags & net::SpawnIsSelf) != 0; }
    bool dead() const { return (state & net::StateDead) != 0; }
};

/// A transient effect the server reported.
struct ViewEvent {
    net::EventKind kind = net::EventKind::Damage;
    std::uint32_t netId = 0;
    std::uint32_t otherNetId = 0;
    double amount = 0;
    Vec2 position;
    double radius = 0;
    std::uint8_t flag = 0;
};

/// The authoritative state of the player's own flower, straight from the
/// snapshot and never interpolated -- prediction owns its position.
struct SelfState {
    std::uint32_t netId = 0;
    Vec2 position;
    Vec2 velocity;
    double health = 0;
    double maxHealth = 0;
    double totalXp = 0;
    int level = 1;
    int stars = 0;
    std::uint32_t acknowledgedInput = 0;
};

class WorldView {
public:
    /// Consumes a Snapshot payload. The message id must already be read.
    /// Returns false when the frame was truncated, in which case nothing is
    /// applied -- a half-read snapshot is worse than a skipped one.
    bool applySnapshot(ByteReader& reader);

    /// Advances interpolation to `nowMillis`. Call once per rendered frame,
    /// not once per snapshot: this is what decouples a 144 Hz display from a
    /// 25 Hz simulation.
    void interpolate(double nowMillis);

    void clear();

    const std::unordered_map<std::uint32_t, RemoteEntity>& entities() const { return entities_; }
    const SelfState& self() const { return self_; }
    std::uint32_t tick() const { return tick_; }
    double serverTimeMillis() const { return serverTimeMillis_; }

    /// Events from the most recent snapshot. Drained by the effects layer.
    std::vector<ViewEvent>& events() { return events_; }

    /// How far behind the newest snapshot the render clock sits. One snapshot
    /// interval plus a small cushion: enough that a late packet does not leave
    /// the blend with nothing to aim at, small enough not to feel laggy.
    double interpolationDelayMillis = net::kSnapshotMillis * 1.5;

private:
    std::unordered_map<std::uint32_t, RemoteEntity> entities_;
    std::vector<ViewEvent> events_;
    SelfState self_;
    std::uint32_t tick_ = 0;
    double serverTimeMillis_ = 0;
    /// Local arrival time of the newest snapshot, which is what interpolation
    /// is measured against. Server timestamps cannot be used directly: the two
    /// clocks are unsynchronised and drift.
    double lastArrivalMillis_ = 0;
    double previousArrivalMillis_ = 0;
};

} // namespace flr
