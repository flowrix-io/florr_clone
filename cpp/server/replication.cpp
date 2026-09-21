#include "server/replication.h"

#include <algorithm>
#include <cmath>

#include "server/systems/petals.h"
#include "shared/game/constants.h"

namespace flix {

namespace {

/// FNV-1a over a skin id, for Tracked's change detection only.
///
/// A collision would cost one player one missed skin change until anything
/// else about their visuals moved, which for server-minted ids (a millisecond
/// clock plus a random tail) is not a case that occurs. The alternative --
/// keeping the id itself beside every tracked entity in every view -- costs
/// memory on every mob on the map, for all of them.
std::uint32_t skinIdHash(const std::string& id) {
    std::uint32_t h = 2166136261u;
    for (const char c : id) {
        h ^= static_cast<std::uint8_t>(c);
        h *= 16777619u;
    }
    return h;
}

} // namespace

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
    if (const MobAi* ai = world.tryGet<MobAi>(e)) {
        if (ai->target != NULL_ENTITY) state |= net::StateChasing;
    }
    if (world.has<Dead>(e)) state |= net::StateDead;

    return state;
}

PlayerVisualState computePlayerVisuals(World& world, Entity e, double nowMillis) {
    PlayerVisualState out;
    if (!world.has<PlayerTag>(e)) return out;

    if (const PlayerVisuals* visuals = world.tryGet<PlayerVisuals>(e)) {
        out.faceFlags = visuals->faceFlags;
        out.equipFlags = visuals->equipFlags;
        out.renderFlags = visuals->renderFlags;
        // Borrowed, not copied; see PlayerVisualState::equippedSkinId.
        if (!visuals->equippedSkinId.empty()) out.equippedSkinId = &visuals->equippedSkinId;
        if (visuals->glitched) out.renderFlags |= PlayerRenderGlitch;
        // Corruption is a FACE, not a skin: the flower that cracked a Flower
        // petal open turns on everyone, and the face is the only warning the
        // players around it get before its ring starts biting them.
        if (visuals->corrupted) out.faceFlags |= FaceHasCorruption;
    }
    if (const Afflictions* afflictions = world.tryGet<Afflictions>(e)) {
        if (afflictions->poisoned(nowMillis)) out.faceFlags |= FacePoisoned;
        // A dandelion's lockout, which the client washes the body toward white
        // for. Derived from the timer rather than stored on PlayerVisuals for
        // the reason poison is: the affliction expires on its own clock, and a
        // flag written when it landed would need a second writer to clear it.
        if (afflictions->healBlocked(nowMillis)) out.faceFlags |= FaceDandelioned;
    }
    if (const PlayerInput* input = world.tryGet<PlayerInput>(e)) {
        // The ring itself gives defend precedence when both keys are held, so
        // the face must make the same choice rather than advertising a lunge.
        if (input->current.defending()) out.faceFlags |= FaceDefending;
        else if (input->current.attacking()) out.faceFlags |= FaceAttacking;
    }
    if (world.has<Dead>(e)) out.faceFlags |= FaceDeadEyes;
    if (const PlayerProgress* progress = world.tryGet<PlayerProgress>(e)) {
        out.level = static_cast<std::uint16_t>(std::max(1, progress->level));
    }
    // Shell's shield, measured against the pool it is protecting: the bar the
    // client draws it on is the health bar, so max health is the only scale it
    // can be quantised against. A lapsed shield reads zero rather than being
    // left to linger -- ShieldState is only swept when that flower next runs
    // its petal actions.
    if (const ShieldState* shield = world.tryGet<ShieldState>(e)) {
        const Health* health = world.tryGet<Health>(e);
        if (shield->active(nowMillis) && health != nullptr && health->max > 0) {
            out.shield = static_cast<std::uint8_t>(
                std::lround(clamp(shield->amount / health->max, 0.0, 1.0) * 255.0));
        }
    }
    if (const ArenaScore* arena = world.tryGet<ArenaScore>(e)) {
        out.arenaScore = static_cast<std::uint32_t>(
            clamp(arena->score, 0.0, static_cast<double>(0xFFFFFFFFu)));
    }
    if (const Loadout* loadout = world.tryGet<Loadout>(e)) {
        // The best rarity ANYWHERE in the loadout, empty slots ignored: the
        // level label under the flower is tinted with it, which is how a
        // passing flower advertises what it is carrying.
        for (const LoadoutSlot& slot : loadout->slots) {
            if (slot.empty()) continue;
            if (static_cast<int>(slot.rarity) > static_cast<int>(out.bestRarity)) {
                out.bestRarity = slot.rarity;
            }
        }
    }
    return out;
}

void Replicator::build(World& world, Entity viewer, ClientView& view,
                       const Frame& frame, ByteWriter& out) {
    const Transform* viewerTransform = world.tryGet<Transform>(viewer);
    if (!viewerTransform) return;

    const Vec2 centre = viewerTransform->position;
    // The viewer sees its own realm and nothing else. Every realm's
    // coordinates start at (0, 0), so a position alone says nothing about
    // whether an entity is anywhere near this client -- it has to be in the
    // same space first.
    const Realm realm = viewerTransform->realm;
    Vec2 viewport{kViewportWidth, kViewportHeight};
    if (const PlayerLocation* location = world.tryGet<PlayerLocation>(viewer)) {
        viewport = location->viewport;
    }
    // A RECTANGLE, per axis, sized off the window the client says it is
    // drawing: the reference builds the same box every frame from the viewport
    // reported by the latest input packet, so a resize or a zoom widens what is
    // streamed on the very next tick rather than at the next join. The bound is
    // exclusive at exactly the edge, as the reference's `>=` test is.
    const double reachX = viewport.x * viewportReach;
    const double reachY = viewport.y * viewportReach;

    const auto outsideView = [&](Vec2 at) {
        const double dx = at.x - centre.x;
        const double dy = at.y - centre.y;
        return (dx < 0 ? -dx : dx) >= reachX || (dy < 0 ? -dy : dy) >= reachY;
    };
    // The inner box, on the same axes: inside it an entity is drawn, or close
    // enough to being drawn that it has to be current.
    const double nearX = viewport.x * nearReach;
    const double nearY = viewport.y * nearReach;
    const auto outsideNearBox = [&](Vec2 at) {
        const double dx = at.x - centre.x;
        const double dy = at.y - centre.y;
        return (dx < 0 ? -dx : dx) >= nearX || (dy < 0 ? -dy : dy) >= nearY;
    };
    // At most three entries, scanned linearly: a set for a squad would cost
    // more to build each tick than it could ever save looking through.
    const auto exempt = [&](Entity e) {
        return frame.alwaysVisible != nullptr &&
               std::find(frame.alwaysVisible->begin(), frame.alwaysVisible->end(), e) !=
                   frame.alwaysVisible->end();
    };

    // --- gather what is in view ------------------------------------------
    candidates_.clear();
    // The connection behind the viewer's body, which is what a drop's
    // reservation is keyed by -- a body dies, a claim does not. Read once
    // rather than per candidate entity.
    const PlayerAccount* viewerAccount = world.tryGet<PlayerAccount>(viewer);
    const net::ConnectionId viewerOwner =
        viewerAccount != nullptr ? viewerAccount->connection : 0;
    Query<NetId, Replicated, Transform> replicated{world};
    replicated.each([&](Entity e, NetId& id, Replicated&, Transform& transform) {
        if (const DropItem* drop = world.tryGet<DropItem>(e)) {
            if (!drop->eligible.empty() && !claimed(drop->eligible, viewer, viewerOwner)) return;
            if (claimed(drop->pickedUpBy, viewer, viewerOwner)) return;
        }
        // The viewer's own body is always replicated, however the camera sits:
        // losing it would leave the client with nothing to anchor prediction to.
        // A squadmate is exempt for its own reason -- see Frame::alwaysVisible
        // -- but only within the viewer's realm: a party member in the maze has
        // no position that means anything on an overworld screen.
        if (e != viewer && transform.realm != realm) return;
        if (e != viewer && outsideView(transform.position) && !exempt(e)) return;
        candidates_.push_back({e, id.value, flix::distanceSq(transform.position, centre)});
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
        out.f64(std::max(0.0, progress->stars));
    } else {
        out.f64(0);
        out.u16(1);
        out.f64(0);
    }

    // Which of the viewer's own slots are reloading or hurt, and by how much.
    // Only the owner's own bar draws the wedge and the drained tile, so this
    // rides the self block rather than the player's replicated visuals.
    //
    // Streamed rather than evented on purpose: a break event that a client
    // missed would leave its wedge sweeping forever, or its tile drained on a
    // petal long since back at full health.
    static_assert(net::kMaxReportedSlots == kLoadoutActiveSlots,
                  "the wire caps the slot list at the number of orbiting slots");
    const Loadout* viewerLoadout = world.tryGet<Loadout>(viewer);
    const PetalSlotState* viewerSlots = world.tryGet<PetalSlotState>(viewer);

    struct SlotReport {
        double reloadRemaining = 0;
        double health = 1.0;
        /// The whole number the bar prints inside the slot's top border, or
        /// net::kNoSlotCounter for a petal that has none. Rounded UP, so a
        /// sponge still holding a sliver of a hit reads as 1 rather than
        /// dropping to 0 a moment early.
        std::uint16_t counter = net::kNoSlotCounter;
    };
    const auto report = [&](int i, SlotReport& out) {
        if (viewerLoadout == nullptr) return false;
        const auto index = static_cast<std::size_t>(i);
        const LoadoutSlot& slot = viewerLoadout->slots[index];
        if (slot.empty()) return false;
        const PetalSlotState::Slot* live =
            viewerSlots != nullptr ? &viewerSlots->slots[index] : nullptr;

        // A clump -- sand, light, dahlia -- loses and reloads its grains one at
        // a time, and `slot.broken` only goes up once the LAST one is gone. The
        // bar reports the missing grain instead: the wedge runs while any
        // instance is out.
        //
        // Sized by the instance that returns LAST, not the first: taking the
        // soonest would complete the sweep while grains are still missing and
        // then snap it backwards to the next one's remainder.
        if (live != nullptr && live->independent) {
            for (const double readyAt : live->instanceReadyAtMillis) {
                out.reloadRemaining = std::max(out.reloadRemaining, readyAt - frame.nowMillis);
            }
        } else if (slot.broken) {
            out.reloadRemaining = slot.reloadReadyAtMillis - frame.nowMillis;
        }
        out.reloadRemaining = std::max(0.0, out.reloadRemaining);
        if (live != nullptr) out.health = live->healthFraction;
        if (live != nullptr && live->counter >= 0.0) {
            out.counter = static_cast<std::uint16_t>(
                std::clamp(std::ceil(live->counter), 0.0,
                           static_cast<double>(net::kNoSlotCounter - 1)));
        }

        // A slot with a counter is reported every snapshot, even sitting at
        // zero with a whole petal: the number is a gauge, and a gauge that
        // vanishes while it reads empty is one the player learns to distrust.
        return out.reloadRemaining > 0.0 || out.health < 1.0 ||
               out.counter != net::kNoSlotCounter;
    };
    // Counted before it is written: the count leads the list, and ten slots is
    // cheaper to walk twice than a patch-back is to add to the writer.
    std::uint8_t reportCount = 0;
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        SlotReport slotReport;
        if (report(i, slotReport)) ++reportCount;
    }
    out.u8(reportCount);
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        SlotReport slotReport;
        if (!report(i, slotReport)) continue;
        out.u8(static_cast<std::uint8_t>(i));
        // A reload past a minute is one the bar cannot show meaningfully
        // anyway; clamping keeps the field two bytes.
        out.u16(static_cast<std::uint16_t>(std::min(slotReport.reloadRemaining, 65535.0)));
        out.unitByte(slotReport.health);
        out.u16(slotReport.counter);
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
        // Decided here rather than beside the field itself: `flags` is written
        // near the top of the record and the health fraction near the bottom,
        // and the flag is what tells the reader how many bytes the latter is.
        const Health* preHealth = world.tryGet<Health>(candidate.entity);
        const bool spawnWide = net::healthFieldIsWide(preHealth ? preHealth->max : 1.0);
        if (spawnWide) flags |= net::SpawnHealthWide;
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
        const double spawnFraction = spawnHealth ? spawnHealth->fraction() : 1.0;
        const double spawnSent = net::writeHealthFraction(out, spawnFraction, spawnWide);
        out.u8(computeEntityState(world, candidate.entity, frame.nowMillis));
        const PlayerVisualState visuals =
            computePlayerVisuals(world, candidate.entity, frame.nowMillis);
        if (info.kind == net::EntityKind::Player) {
            out.u8(visuals.faceFlags);
            out.u8(visuals.equipFlags);
            out.u32(visuals.renderFlags);
            out.u16(visuals.level);
            out.u8(static_cast<std::uint8_t>(visuals.bestRarity));
            out.u32(visuals.arenaScore);
            out.u8(visuals.shield);
            out.str(skinIdOf(visuals));
        }
        if (info.kind == net::EntityKind::Petal) {
            // Petals are placed on an absolute ring around the owner's SERVER
            // position every tick, while the owner is drawn at its own eased
            // or predicted one. Without the owner's id the client cannot put
            // the two back together and the ring visibly trails the flower.
            // A flower's petal names its flower; a mob's ring seed names its
            // mob. Both anchor the same way on the client, which is the whole
            // reason a seed is replicated as a Petal at all.
            Entity owner = NULL_ENTITY;
            if (const PetalInstance* instance = world.tryGet<PetalInstance>(candidate.entity)) {
                owner = instance->owner;
            } else if (const MobRingPetal* seed = world.tryGet<MobRingPetal>(candidate.entity)) {
                owner = seed->mob;
            }
            std::uint32_t ownerNetId = 0;
            if (const NetId* ownerId = world.tryGet<NetId>(owner)) ownerNetId = ownerId->value;
            out.u32(ownerNetId);
        }
        if (flags & net::SpawnHasName) out.str(account->username);
        ++spawnCount;

        // Seed the tracked values from what the spawn record just carried, so
        // this tick's update pass has nothing left to say about it.
        ClientView::Tracked tracked;
        tracked.position = transform.position;
        tracked.angle = transform.angle;
        tracked.radius = radius;
        tracked.seenThisTick = true;
        tracked.healthFraction = spawnSent;
        tracked.state = computeEntityState(world, candidate.entity, frame.nowMillis);
        tracked.faceFlags = visuals.faceFlags;
        tracked.equipFlags = visuals.equipFlags;
        tracked.renderFlags = visuals.renderFlags;
        tracked.level = visuals.level;
        tracked.bestRarity = static_cast<std::uint8_t>(visuals.bestRarity);
        tracked.arenaScore = visuals.arenaScore;
        tracked.shield = visuals.shield;
        tracked.skinIdHash = skinIdHash(skinIdOf(visuals));
        view.tracked.emplace(candidate.netId, tracked);
    }
    out.patchU16(spawnCountAt, spawnCount);

    const int farStride = std::max(1, farSnapshotStride);
    for (const Candidate& candidate : candidates_) {
        auto it = view.tracked.find(candidate.netId);
        if (it == view.tracked.end()) continue;
        ClientView::Tracked& tracked = it->second;

        const Transform& transform = world.get<Transform>(candidate.entity);
        // Off-screen and not due this snapshot: say nothing about it at all.
        //
        // Skipping the whole record rather than trimming its fields is the
        // point -- the net id and the mask are five bytes before a single
        // field is named, and at a hundred-odd entities a snapshot they are a
        // third of the stream on their own. `tracked` is left exactly as it
        // was, so whenever this entity IS described the diff is still measured
        // against what the client actually holds, and the spawn pass has
        // already marked it seen, so skipping it never reads as a removal.
        //
        // The viewer is exempt for the obvious reason, and a squadmate because
        // it is streamed from any distance precisely so the HUD can point at
        // it (see Frame::alwaysVisible).
        if (candidate.entity != viewer && !exempt(candidate.entity) &&
            outsideNearBox(transform.position) &&
            (frame.snapshotIndex + candidate.netId) % static_cast<std::uint32_t>(farStride) != 0) {
            continue;
        }
        const Health* health = world.tryGet<Health>(candidate.entity);
        const Body* body = world.tryGet<Body>(candidate.entity);
        const std::uint8_t state = computeEntityState(world, candidate.entity, frame.nowMillis);
        const PlayerVisualState visuals =
            computePlayerVisuals(world, candidate.entity, frame.nowMillis);

        std::uint8_t mask = 0;
        if (distanceSq(transform.position, tracked.position) >
            tolerances.position * tolerances.position) {
            mask |= net::FieldPosition;
        }
        if (std::fabs(wrapAngle(transform.angle - tracked.angle)) > tolerances.angle) {
            mask |= net::FieldAngle;
        }
        // Compared AT THE WIDTH it would be sent in, which is the only
        // comparison that means anything: judged against the unrounded double,
        // a pool healing by a hundredth of a step would put bytes on the wire
        // every snapshot that decode to the value the client already holds.
        // Judged against a fixed threshold -- as a 1/255 tolerance once was --
        // a petal taking a millionth of an apex mob reads as no change at all,
        // and the bar sits still through the whole fight.
        const bool healthWide = health != nullptr && net::healthFieldIsWide(health->max);
        const double healthFraction =
            health ? net::quantizeHealthFraction(health->fraction(), healthWide) : -1.0;
        if (health && healthFraction != tracked.healthFraction) {
            mask |= net::FieldHealth;
            if (healthWide) mask |= net::FieldHealthWide;
        }
        if (state != tracked.state) mask |= net::FieldState;
        if (body && std::fabs(body->radius - tracked.radius) > tolerances.radius) {
            mask |= net::FieldSize;
        }
        if (world.get<Replicated>(candidate.entity).kind == net::EntityKind::Player &&
            (visuals.faceFlags != tracked.faceFlags ||
             visuals.equipFlags != tracked.equipFlags ||
             visuals.renderFlags != tracked.renderFlags ||
             visuals.level != tracked.level ||
             static_cast<std::uint8_t>(visuals.bestRarity) != tracked.bestRarity ||
             visuals.arenaScore != tracked.arenaScore || visuals.shield != tracked.shield ||
             skinIdHash(skinIdOf(visuals)) != tracked.skinIdHash)) {
            mask |= net::FieldPlayerVisuals;
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
            net::writeHealthFraction(out, health->fraction(), healthWide);
            tracked.healthFraction = healthFraction;
        }
        if (mask & net::FieldState) {
            out.u8(state);
            tracked.state = state;
        }
        if (mask & net::FieldSize) {
            out.f32(static_cast<float>(body->radius));
            tracked.radius = body->radius;
        }
        if (mask & net::FieldPlayerVisuals) {
            out.u8(visuals.faceFlags);
            out.u8(visuals.equipFlags);
            out.u32(visuals.renderFlags);
            out.u16(visuals.level);
            out.u8(static_cast<std::uint8_t>(visuals.bestRarity));
            out.u32(visuals.arenaScore);
            out.u8(visuals.shield);
            out.str(skinIdOf(visuals));
            tracked.faceFlags = visuals.faceFlags;
            tracked.equipFlags = visuals.equipFlags;
            tracked.renderFlags = visuals.renderFlags;
            tracked.level = visuals.level;
            tracked.bestRarity = static_cast<std::uint8_t>(visuals.bestRarity);
            tracked.arenaScore = visuals.arenaScore;
            tracked.shield = visuals.shield;
            tracked.skinIdHash = skinIdHash(skinIdOf(visuals));
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
            if (event.positional && (event.realm != realm || outsideView(event.position))) continue;
            out.u8(static_cast<std::uint8_t>(event.kind));
            out.u32(event.netId);
            out.u32(event.otherNetId);
            out.f32(static_cast<float>(event.amount));
            out.position(event.position);
            out.f32(static_cast<float>(event.radius));
            out.u8(event.flag);
            // The one kind with a tail. Written after the fixed fields, so a
            // reader that has already taken the kind byte knows whether to
            // expect it; nothing else on this wire is variable-length.
            if (event.kind == net::EventKind::Lightning) {
                const std::size_t count =
                    std::min(event.points.size(), net::kMaxLightningTargets);
                out.u8(static_cast<std::uint8_t>(count));
                for (std::size_t i = 0; i < count; ++i) out.position(event.points[i]);
            }
            ++eventCount;
        }
    }
    out.patchU16(eventCountAt, eventCount);
}

} // namespace flix
