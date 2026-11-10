// The admin Cursor petal's powers, serviced every tick: phasing through walls,
// grabbing and dragging bodies, and the kill and teleport keys.

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "server/game_server_internal.h"
#include "shared/game/config.h"

namespace flix {

namespace {

/// Whether `owner` wears the admin Cursor. foldModifiers ran this tick, so its
/// server-resolved tier is read rather than all ten slots again per admin.
bool wearsAdminCursor(const World& world, Entity owner) {
    const auto* modifiers = world.tryGet<PlayerModifiers>(owner);
    return modifiers && modifiers->controlsPets && modifiers->petControlRarity == Rarity::Admin;
}

/// Where in the world the admin's pointer is: the aim, from the body, inside
/// the viewport that body may claim.
Vec2 cursorPointer(World& world, Entity owner, const PlayerInput& input, const Transform& origin) {
    const auto* location = world.tryGet<PlayerLocation>(owner);
    const Vec2 claim = location ? location->viewport : Vec2{kViewportWidth, kViewportHeight};
    const Vec2 viewport = claimableViewport(world, owner, content(), claim.x, claim.y);
    const Vec2 requested = Vec2::fromAngle(input.current.aimAngle, input.current.aimDistance);
    return origin.position + Vec2{clamp(requested.x, -viewport.x * 0.5, viewport.x * 0.5),
                                  clamp(requested.y, -viewport.y * 0.5, viewport.y * 0.5)};
}

/// Lets go of whatever the cursor holds, and of the body it was bound to.
void releaseCursor(Session& session) {
    session.cursorDragged = NULL_ENTITY;
    session.cursorBody = NULL_ENTITY;
    session.cursorButtons = 0;
}

/// Lets go of whatever the cursor holds and binds it to `owner` in `realm`,
/// with `buttons` latched as already held: a button down at this moment
/// cannot grab anything until it is released and pressed again.
void latchCursor(Session& session, Entity owner, Realm realm, std::uint8_t buttons) {
    session.cursorDragged = NULL_ENTITY;
    session.cursorBody = owner;
    session.cursorRealm = realm;
    session.cursorButtons = buttons;
}

} // namespace

void GameServer::setAdminPhase(Session& session, bool enabled) {
    for (Entity entity : bodiesOf(session)) {
        auto* input = world_.tryGet<PlayerInput>(entity);
        auto* at = world_.tryGet<Transform>(entity);
        if (!input || !at) continue;
        const auto* body = world_.tryGet<Body>(entity);
        const double radius = body ? body->radius : kPlayerBaseRadius;
        if (enabled) {
            if (!input->adminPhase || input->phaseSafeRealm != at->realm) {
                input->phaseSafePosition = terrain_->resolveCircle(at->position, radius, at->realm);
                input->phaseSafeRealm = at->realm;
            } else if (!terrain_->outside(at->position, at->realm) &&
                       !terrain_->blocked(at->position, at->realm)) {
                input->phaseSafePosition = at->position;
            }
            input->adminPhase = true;
        } else if (input->adminPhase) {
            Vec2 safe = terrain_->resolveCircle(at->position, radius, at->realm);
            if ((!std::isfinite(safe.x) || !std::isfinite(safe.y) ||
                 terrain_->outside(safe, at->realm) || terrain_->blocked(safe, at->realm)) &&
                input->phaseSafeRealm == at->realm)
                safe = terrain_->resolveCircle(input->phaseSafePosition, radius, at->realm);
            input->adminPhase = false;
            if (distanceSq(safe, at->position) > 1e-6) teleportEntity(entity, safe);
        }
    }
}

void GameServer::serviceAdminPhase() {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        const auto* input = world_.tryGet<PlayerInput>(session.entity);
        const bool enabled = session.playing() && effectiveAdmin(session) && input &&
            input->adminPhase && !world_.has<Dead>(session.entity);
        setAdminPhase(session, enabled);
    }
}

void GameServer::serviceAdminCursorActions() {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        const Entity owner = session.entity;
        const auto* input = session.playing() ? world_.tryGet<PlayerInput>(owner) : nullptr;
        const auto* origin = session.playing() ? world_.tryGet<Transform>(owner) : nullptr;
        const bool down = input && (input->current.flags & net::InputAdminKill);
        const bool pressedKill = down && !session.adminKillHeld;
        const bool teleportDown = input && (input->current.flags & net::InputAdminTeleport);
        const bool pressedTeleport = teleportDown && !session.adminTeleportHeld;
        session.adminKillHeld = down;
        session.adminTeleportHeld = teleportDown;
        const bool transitioned = session.adminKillBody != NULL_ENTITY &&
            (session.adminKillBody != owner || !origin || session.adminKillRealm != origin->realm);
        session.adminKillBody = origin ? owner : NULL_ENTITY;
        if (origin) session.adminKillRealm = origin->realm;
        const bool cursor = wearsAdminCursor(world_, owner);
        // Reuse the Cursor's existing admin tier and equipment requirements.
        // A held key, promotion or realm transition cannot repeatedly kill.
        if ((!pressedKill && !pressedTeleport) || transitioned || !origin || !cursor ||
            !adminMay(session, AdminPower::SpawnMobs) ||
            world_.has<Dead>(owner) || session.controlledBy || session.controlling ||
            clockMillis_ < session.adminKillReadyAtMillis) continue;
        session.adminKillReadyAtMillis = clockMillis_ + 250.0;
        const Vec2 pointer = cursorPointer(world_, owner, *input, *origin);
        if (pressedTeleport) {
            const auto* body = world_.tryGet<Body>(owner);
            const double radius = body ? body->radius : kPlayerBaseRadius;
            const Vec2 destination = input->adminPhase
                ? terrain_->clampInside(pointer, radius, origin->realm)
                : terrain_->resolveCircle(pointer, radius, origin->realm);
            if (!std::isfinite(destination.x) || !std::isfinite(destination.y) ||
                terrain_->outside(destination, origin->realm) ||
                (!input->adminPhase && terrain_->blocked(destination, origin->realm))) continue;
            // Release an existing drag and latch its held button so arriving
            // cannot silently grab another target at the translated pointer.
            latchCursor(session, owner, origin->realm, input->current.flags);
            teleportEntity(owner, destination, false);
            continue;
        }
        const auto valid = [&](Entity entity) {
            const auto* at = world_.tryGet<Transform>(entity);
            if (!at || at->realm != origin->realm || entity == owner ||
                world_.has<NpcTag>(entity) || world_.has<Dead>(entity)) return false;
            if (world_.has<PlayerTag>(entity)) {
                const auto* account = world_.tryGet<PlayerAccount>(entity);
                if (!account || account->admin) return false;
                if (Session* target = sessionFor(account->connection))
                    return target->playing() && target->entity == entity && !effectiveAdmin(*target);
                return account->connection == 0;
            }
            return world_.has<MobTag>(entity) || world_.has<Pet>(entity);
        };
        Entity selected = NULL_ENTITY;
        double best = 1.0;
        Query<Transform, Body> mobs{world_};
        mobs.each([&](Entity entity, Transform& at, Body& body) {
            if (!valid(entity)) return;
            const double radius = std::max(20.0, body.radius);
            const double score = distanceSq(pointer, at.position) / (radius * radius);
            if (score > best || (score == best && selected != NULL_ENTITY && entity >= selected)) return;
            if (const auto* segment = world_.tryGet<BodySegment>(entity)) {
                if (!valid(segment->chainHead)) return;
                entity = segment->chainHead;
            }
            best = score;
            selected = entity;
        });
        if (selected == NULL_ENTITY) continue;
        if (!world_.has<Pet>(selected)) {
            if (const auto* type = world_.tryGet<MobType>(selected)) announceBossDefeat(selected, *type, {});
        }
        // Wild mobs/pets are removed without a reward ledger. Players take
        // the normal corpse/respawn path, with no killer credited.
        if (world_.has<PlayerTag>(selected)) {
            if (auto* health = world_.tryGet<Health>(selected)) health->current = 0;
            world_.add<Dead>(selected);
        } else commands_.destroy(selected);
        Query<BodySegment> segments{world_};
        segments.each([&](Entity entity, BodySegment& segment) {
            if (segment.chainHead == selected) commands_.destroy(entity);
        });
        std::printf("[admin] %s removed hovered target %u\n", session.username.c_str(), unsigned(selected));
    }
}

void GameServer::serviceAdminCursor() {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing() || !adminMay(session, AdminPower::SpawnMobs)) {
            releaseCursor(session);
            continue;
        }
        const Entity owner = session.entity;
        const auto* input = world_.tryGet<PlayerInput>(owner);
        const auto* origin = world_.tryGet<Transform>(owner);
        if (!wearsAdminCursor(world_, owner) || !input || !origin || world_.has<Dead>(owner) ||
            session.controlling != 0 || session.controlledBy != 0) {
            releaseCursor(session);
            continue;
        }
        const bool ownerPriority = adminTier(session) == kOwnerAdminTier;
        bool heldByOwner = false;
        for (const auto& other : sessions_) {
            if (other.first != session.connection && other.second.cursorDragged == owner &&
                adminTier(other.second) == kOwnerAdminTier) heldByOwner = true;
        }
        if (heldByOwner) {
            latchCursor(session, owner, origin->realm, input->current.flags);
            continue;
        }
        if (session.cursorBody != owner || session.cursorRealm != origin->realm) {
            const bool firstGrab = session.cursorBody == NULL_ENTITY;
            latchCursor(session, owner, origin->realm, firstGrab ? 0 : input->current.flags);
            // A realm/body transition releases the grab. A held button cannot
            // silently acquire somebody on the other side of a teleporter.
            if (!firstGrab) continue;
        }
        const auto buttons = input->current.flags;
        const bool drag = (buttons & net::InputAdminDrag) != 0;
        const Vec2 pointer = cursorPointer(world_, owner, *input, *origin);
        const Realm realm = origin->realm;
        const auto valid = [&](Entity entity) {
            const auto* transform = world_.tryGet<Transform>(entity);
            if (!transform || transform->realm != realm || world_.has<Dead>(entity)) return false;
            const bool player = world_.has<PlayerTag>(entity);
            if (!player && !world_.has<MobTag>(entity) && !world_.has<NpcTag>(entity)) return false;
            // Grabs are exclusive. Only an Owner can preempt a lower rank,
            // for mobs/NPCs as well as players, independent of session order.
            for (const auto& other : sessions_) {
                if (other.first != session.connection && other.second.cursorDragged == entity &&
                    (!ownerPriority || adminTier(other.second) == kOwnerAdminTier)) return false;
            }
            if (player) {
                const auto* account = world_.tryGet<PlayerAccount>(entity);
                if (!account || entity == owner || (account->admin && !ownerPriority)) return false;
                if (Session* target = sessionFor(account->connection)) {
                    if (!target->playing() || target->entity != entity) return false;
                    if (effectiveAdmin(*target) &&
                        (!ownerPriority || adminTier(*target) == kOwnerAdminTier)) return false;
                    if (!ownerPriority && (target->controlledBy != 0 || target->controlling != 0)) return false;
                } else if (account->connection != 0) return false;
                return true;
            }
            return world_.has<MobTag>(entity) || world_.has<NpcTag>(entity);
        };
        const auto pick = [&]() {
            Entity selected = NULL_ENTITY;
            double best = 1e100;
            bool selectedPlayer = false;
            Query<Transform> candidates{world_};
            candidates.each([&](Entity e, Transform& transform) {
                if (!valid(e)) return;
                const auto* body = world_.tryGet<Body>(e);
                const double radius = std::max(20.0, body ? body->radius : 20.0);
                const double d = distanceSq(pointer, transform.position);
                // Pick the closest body relative to its size.
                const double score = d / (radius * radius);
                const bool player = world_.has<PlayerTag>(e);
                if (score <= 1.0 && (selected == NULL_ENTITY || (player && !selectedPlayer) ||
                    (player == selectedPlayer && (score < best || (score == best && e < selected))))) {
                    best = score;
                    selected = e;
                    selectedPlayer = player;
                    const auto* segment = world_.tryGet<BodySegment>(e);
                    if (segment && valid(segment->chainHead)) selected = segment->chainHead;
                }
            });
            return selected;
        };
        if (!drag) session.cursorDragged = NULL_ENTITY;
        else if (!(session.cursorButtons & net::InputAdminDrag)) {
            session.cursorDragged = pick();
            if (ownerPriority && session.cursorDragged != NULL_ENTITY) {
                // Apply the takeover only after selection, never while scanning.
                for (auto& other : sessions_) {
                    if (other.first == session.connection || other.second.cursorDragged != session.cursorDragged) continue;
                    other.second.cursorDragged = NULL_ENTITY;
                    if (const auto* previous = world_.tryGet<PlayerInput>(other.second.entity))
                        other.second.cursorButtons = previous->current.flags;
                }
                if (Session* target = sessionForEntity(session.cursorDragged)) {
                    endControlOf(*target, "was grabbed by the server owner", false);
                    target->cursorDragged = NULL_ENTITY;
                    if (const auto* previous = world_.tryGet<PlayerInput>(target->entity))
                        target->cursorButtons = previous->current.flags;
                }
            }
        }
        if (session.cursorDragged != NULL_ENTITY) {
            if (!valid(session.cursorDragged)) session.cursorDragged = NULL_ENTITY;
            else {
                Vec2 destination = pointer;
                if (world_.has<PlayerTag>(session.cursorDragged)) {
                    const auto* body = world_.tryGet<Body>(session.cursorDragged);
                    // Dragged players may cross walls, but never map bounds.
                    // Normal collision rescues a release inside solid terrain.
                    destination = terrain_->clampInside(pointer, body ? body->radius : kPlayerBaseRadius, realm);
                    if (auto* health = world_.tryGet<Health>(session.cursorDragged)) {
                        // No infinity and no overwritten god/spawn protection.
                        // Refreshed while held, then expires three seconds after
                        // release/disconnect. Refused hits earn no kill credit.
                        health->invulnerableUntilMillis = std::max(health->invulnerableUntilMillis,
                                                                   clockMillis_ + 3000.0);
                    }
                }
                world_.get<Transform>(session.cursorDragged).position = destination;
                if (auto* npc = world_.tryGet<Npc>(session.cursorDragged)) npc->home = pointer;
                if (auto* motion = world_.tryGet<Motion>(session.cursorDragged)) motion->velocity = Vec2{};
            }
        }
        session.cursorButtons = buttons;
    }
}

} // namespace flix
