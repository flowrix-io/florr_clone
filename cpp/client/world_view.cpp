#include "client/world_view.h"

#include <chrono>
#include <cmath>

namespace flr {

namespace {

double monotonicMillis() {
    using clock = std::chrono::steady_clock;
    static const clock::time_point start = clock::now();
    return std::chrono::duration<double, std::milli>(clock::now() - start).count();
}

} // namespace

void WorldView::clear() {
    entities_.clear();
    events_.clear();
    self_ = SelfState{};
    tick_ = 0;
}

bool WorldView::applySnapshot(ByteReader& reader) {
    const std::uint32_t tick = reader.u32();
    const double serverTime = reader.f64();
    const std::uint32_t acknowledged = reader.u32();

    const Vec2 selfPosition = reader.position();
    const Vec2 selfVelocity = reader.position();
    const double health = reader.f32();
    const double maxHealth = reader.f32();
    const double totalXp = reader.f64();
    const int level = reader.u16();
    const int stars = static_cast<int>(reader.u32());

    // Snapshots are ordered by TCP, but a reconnect can replay an older tick.
    // Applying it would rewind every entity by a frame.
    if (tick_ != 0 && tick <= tick_) return true;

    const std::uint16_t spawnCount = reader.u16();
    const std::uint16_t updateCount = reader.u16();

    // Decode into scratch first so a truncated frame leaves the view untouched
    // rather than half-applied.
    struct Spawn {
        std::uint32_t netId;
        net::EntityKind kind;
        std::uint16_t typeIndex;
        Rarity rarity;
        std::uint8_t flags;
        Vec2 position;
        double angle;
        double radius;
        double healthFraction;
        std::uint8_t state;
        std::uint8_t faceFlags;
        std::uint8_t equipFlags;
        std::uint32_t renderFlags;
        std::uint16_t level;
        Rarity bestRarity;
        std::uint32_t ownerNetId;
        std::string name;
    };
    std::vector<Spawn> spawns;
    spawns.reserve(spawnCount);
    for (std::uint16_t i = 0; i < spawnCount; ++i) {
        Spawn s{};
        s.netId = reader.u32();
        s.kind = static_cast<net::EntityKind>(reader.u8());
        s.typeIndex = reader.u16();
        s.rarity = clampRarity(reader.u8());
        s.flags = reader.u8();
        s.position = reader.position();
        s.angle = reader.angle();
        s.radius = reader.f32();
        s.healthFraction = reader.unitShort();
        s.state = reader.u8();
        s.level = 1;
        s.bestRarity = Rarity::Common;
        if (s.kind == net::EntityKind::Player) {
            s.faceFlags = reader.u8();
            s.equipFlags = reader.u8();
            s.renderFlags = reader.u32();
            s.level = reader.u16();
            s.bestRarity = clampRarity(reader.u8());
        }
        if (s.kind == net::EntityKind::Petal) s.ownerNetId = reader.u32();
        if (s.flags & net::SpawnHasName) s.name = reader.str();
        spawns.push_back(std::move(s));
        if (!reader.ok()) return false;
    }

    struct Update {
        std::uint32_t netId;
        std::uint8_t mask;
        Vec2 position;
        double angle;
        double healthFraction;
        std::uint8_t state;
        double radius;
        std::uint8_t faceFlags;
        std::uint8_t equipFlags;
        std::uint32_t renderFlags;
        std::uint16_t level;
        Rarity bestRarity;
    };
    std::vector<Update> updates;
    updates.reserve(updateCount);
    for (std::uint16_t i = 0; i < updateCount; ++i) {
        Update u{};
        u.netId = reader.u32();
        u.mask = reader.u8();
        if (u.mask & net::FieldPosition) u.position = reader.position();
        if (u.mask & net::FieldAngle) u.angle = reader.angle();
        if (u.mask & net::FieldHealth) u.healthFraction = reader.unitShort();
        if (u.mask & net::FieldState) u.state = reader.u8();
        if (u.mask & net::FieldSize) u.radius = reader.f32();
        if (u.mask & net::FieldPlayerVisuals) {
            u.faceFlags = reader.u8();
            u.equipFlags = reader.u8();
            u.renderFlags = reader.u32();
            u.level = reader.u16();
            u.bestRarity = clampRarity(reader.u8());
        }
        updates.push_back(u);
        if (!reader.ok()) return false;
    }

    const std::uint16_t removalCount = reader.u16();
    std::vector<std::uint32_t> removals;
    removals.reserve(removalCount);
    for (std::uint16_t i = 0; i < removalCount; ++i) removals.push_back(reader.u32());
    if (!reader.ok()) return false;

    const std::uint16_t eventCount = reader.u16();
    std::vector<ViewEvent> events;
    events.reserve(eventCount);
    for (std::uint16_t i = 0; i < eventCount; ++i) {
        ViewEvent e;
        e.kind = static_cast<net::EventKind>(reader.u8());
        e.netId = reader.u32();
        e.otherNetId = reader.u32();
        e.amount = reader.f32();
        e.position = reader.position();
        e.radius = reader.f32();
        e.flag = reader.u8();
        events.push_back(e);
    }
    if (!reader.ok()) return false;

    // --- commit ------------------------------------------------------------
    tick_ = tick;
    serverTimeMillis_ = serverTime;
    previousArrivalMillis_ = lastArrivalMillis_;
    lastArrivalMillis_ = monotonicMillis();

    self_.position = selfPosition;
    self_.velocity = selfVelocity;
    self_.health = health;
    self_.maxHealth = maxHealth;
    self_.totalXp = totalXp;
    self_.level = level;
    self_.stars = stars;
    self_.acknowledgedInput = acknowledged;

    for (Spawn& s : spawns) {
        RemoteEntity e;
        e.netId = s.netId;
        e.kind = s.kind;
        e.typeIndex = s.typeIndex;
        e.rarity = s.rarity;
        e.spawnFlags = s.flags;
        e.name = std::move(s.name);
        // Both endpoints start at the spawn position: a fresh entity must not
        // slide in from wherever a recycled record happened to leave them.
        e.previousPosition = e.targetPosition = e.position = s.position;
        e.previousAngle = e.targetAngle = e.angle = s.angle;
        e.radius = s.radius;
        e.healthFraction = s.healthFraction;
        e.state = s.state;
        e.faceFlags = s.faceFlags;
        e.equipFlags = s.equipFlags;
        e.renderFlags = s.renderFlags;
        e.level = s.level;
        e.bestRarity = s.bestRarity;
        e.ownerNetId = s.ownerNetId;
        e.fresh = true;
        if (s.flags & net::SpawnIsSelf) self_.netId = s.netId;
        entities_[s.netId] = std::move(e);
    }

    for (const Update& u : updates) {
        auto it = entities_.find(u.netId);
        // An update for an entity we never saw spawn is not an error: the
        // spawn may have been dropped by a viewport edge case. Ignoring it is
        // correct -- the next tick's diff will spawn it properly.
        if (it == entities_.end()) continue;
        RemoteEntity& e = it->second;

        if (u.mask & net::FieldPosition) {
            e.previousPosition = e.targetPosition;
            e.targetPosition = u.position;
        } else {
            e.previousPosition = e.targetPosition;
        }
        if (u.mask & net::FieldAngle) {
            e.previousAngle = e.targetAngle;
            e.targetAngle = u.angle;
        } else {
            e.previousAngle = e.targetAngle;
        }
        if (u.mask & net::FieldHealth) e.healthFraction = u.healthFraction;
        if (u.mask & net::FieldState) e.state = u.state;
        if (u.mask & net::FieldSize) e.radius = u.radius;
        if (u.mask & net::FieldPlayerVisuals) {
            e.faceFlags = u.faceFlags;
            e.equipFlags = u.equipFlags;
            e.renderFlags = u.renderFlags;
            e.level = u.level;
            e.bestRarity = u.bestRarity;
        }

        e.sampleStartMillis = previousArrivalMillis_;
        e.sampleEndMillis = lastArrivalMillis_;
        e.fresh = false;
    }

    // An entity that did not change at all still needs its blend window
    // advanced, or interpolate() keeps replaying the last transition.
    for (auto& entry : entities_) {
        RemoteEntity& e = entry.second;
        if (e.sampleEndMillis < lastArrivalMillis_ && !e.fresh) {
            e.previousPosition = e.targetPosition;
            e.previousAngle = e.targetAngle;
            e.sampleStartMillis = previousArrivalMillis_;
            e.sampleEndMillis = lastArrivalMillis_;
        }
    }

    for (const std::uint32_t netId : removals) entities_.erase(netId);

    events_.insert(events_.end(), events.begin(), events.end());
    return true;
}

void WorldView::interpolate(double nowMillis) {
    const double renderTime = nowMillis - interpolationDelayMillis;

    for (auto& entry : entities_) {
        RemoteEntity& e = entry.second;

        if (e.fresh || e.sampleEndMillis <= e.sampleStartMillis) {
            e.position = e.targetPosition;
            e.angle = e.targetAngle;
        } else {
            double t = (renderTime - e.sampleStartMillis) / (e.sampleEndMillis - e.sampleStartMillis);
            // Clamping rather than extrapolating: when snapshots stop arriving the
            // entity holds still, which reads as lag. Extrapolating instead sends
            // it drifting through walls and then snapping back.
            t = clamp(t, 0.0, 1.0);

            e.position = {
                lerp(e.previousPosition.x, e.targetPosition.x, t),
                lerp(e.previousPosition.y, e.targetPosition.y, t),
            };
            e.angle = lerpAngle(e.previousAngle, e.targetAngle, t);
        }
        e.eyeX += (std::cos(e.angle) * 2.0 - e.eyeX) * 0.15;
        e.eyeY += (std::sin(e.angle) * 4.4 - e.eyeY) * 0.15;
    }
}

} // namespace flr
