"use strict";
/**
 * Wire -> client world ingestion. The ECS port of net/enemyIngest.ts.
 *
 * Both enemy delivery paths — the bulk `enemySpawned` payload and the per-tick
 * delta decoder — funnel through here, because they must treat a
 * mid-death-animation entity identically: updating or deleting one out from
 * under its animation makes mobs blink out instead of playing their death pop.
 *
 * ---------------------------------------------------------------------------
 * TWO CLOCKS, AND WHY THEY DO NOT MIX
 * ---------------------------------------------------------------------------
 * `now` is the WORLD clock (`Date.now()` on the client). Death animations are
 * stamped and compared against it, and the renderer compares them against its
 * own `Date.now()` frame timestamp, so both sides agree.
 *
 * `snapTime` is the SNAPSHOT clock: `performance.now()`, or the server tick
 * timestamp mapped into that domain (see handlers/gameState.ts). It is only
 * ever compared against other snapshot samples, never against `now`. The two
 * differ by the page-load epoch — about 1.7e12 ms — so feeding one where the
 * other is expected produces animations that never start or entities that are
 * never reaped. That is why `snapTime` is a required parameter rather than
 * defaulting to `now`: a missing argument is a compile error, not a silent
 * 1.7e12 ms jump.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_TYPE_UNKNOWN = exports.DEATH_ANIMATION_DURATION_MS = void 0;
exports.playerKey = playerKey;
exports.enemyKey = enemyKey;
exports.applyEnemyUpdate = applyEnemyUpdate;
exports.setMobDps = setMobDps;
exports.setMobHealth = setMobHealth;
exports.forgetEnemy = forgetEnemy;
exports.beginDeathAnimation = beginDeathAnimation;
exports.applyPlayerUpdate = applyPlayerUpdate;
exports.snapPlayer = snapPlayer;
exports.forgetPlayer = forgetPlayer;
exports.playerRefOf = playerRefOf;
exports.findPlayerRef = findPlayerRef;
const C = __importStar(require("../components"));
const components_1 = require("./components");
const interning_1 = require("../interning");
/** Must match the death-pop duration the renderer draws. */
exports.DEATH_ANIMATION_DURATION_MS = 200;
/**
 * `MobRender.aiType` when the server has never said. Distinct from
 * `AiType.Passive` (0) so "unknown" cannot accidentally read as a real value.
 */
exports.AI_TYPE_UNKNOWN = 255;
/**
 * Players and mobs share ONE external-id namespace in a single World, and mob
 * ids come from a server-side generator while player ids are socket ids. A
 * collision would silently alias a flower to a mob, so every key is built here
 * and nowhere else.
 */
function playerKey(id) {
    return `p:${id}`;
}
function enemyKey(id) {
    return `e:${id}`;
}
const AI_TYPE_IDS = {
    passive: 0,
    neutral: 1,
    hostile: 2,
    sandstorm: 3,
};
/**
 * True when the entity is playing its death animation and must be left alone.
 */
function isAnimatingDeath(world, entity, now) {
    if (!world.has(entity, C.DeathAnimation))
        return false;
    const start = world.get(entity, C.DeathAnimation, 'startTime');
    return now - start < exports.DEATH_ANIMATION_DURATION_MS;
}
/**
 * Apply a server enemy record, creating the entity on first sight.
 *
 * A NEW entity takes the position immediately — interpolating from nowhere
 * would make it fly in from the origin. An EXISTING one only has its
 * interpolation target moved, so the renderer eases rather than snapping at the
 * tick rate.
 */
function applyEnemyUpdate(world, update, now, snapTime) {
    const key = enemyKey(update.id);
    const existing = world.lookup(key);
    if (existing !== undefined) {
        if (isAnimatingDeath(world, existing, now))
            return existing;
        world.write(existing, components_1.InterpTarget, {
            x: update.x,
            y: update.y,
            angle: update.angle,
        });
        if (!world.has(existing, components_1.SnapshotBuffer)) {
            world.add(existing, components_1.SnapshotBuffer, { samples: [] });
        }
        (0, components_1.pushSnapshot)(world.get(existing, components_1.SnapshotBuffer, 'samples'), snapTime, update.x, update.y, update.angle);
        world.write(existing, C.Health, { current: update.health, max: update.maxHealth });
        if (update.type !== undefined) {
            world.set(existing, C.MobKind, 'type', interning_1.mobTypes.intern(update.type));
        }
        if (update.tier !== undefined) {
            world.set(existing, C.MobKind, 'tier', (0, interning_1.rarityToId)(update.tier));
        }
        // Only the full payloads carry these. The delta stream leaves them
        // alone, exactly as the legacy merge did — a mob keeps whatever its
        // spawn payload said.
        writeMobRender(world, existing, update);
        return existing;
    }
    const entity = world.create();
    world.bindExternalId(entity, key);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle });
    world.add(entity, C.Health, { current: update.health, max: update.maxHealth });
    world.add(entity, C.MobKind, {
        type: interning_1.mobTypes.intern(update.type ?? 'bee'),
        tier: (0, interning_1.rarityToId)(update.tier ?? 'common'),
    });
    // First appearance: draw where the server says, with no easing.
    world.add(entity, components_1.InterpTarget, { x: update.x, y: update.y, angle: update.angle });
    world.add(entity, components_1.MobRender, { aiType: exports.AI_TYPE_UNKNOWN, chasing: 0, flipped: 0 });
    world.add(entity, C.IsEnemy);
    if (update.rendersAsFlower)
        world.add(entity, components_1.RenderEye, { x: 0, y: 0, init: 0 });
    writeMobRender(world, entity, update);
    // The two delivery paths disagree on how they mark a pet; normalise to one
    // tag so the renderer reads a single thing.
    if (update.ownerId !== undefined || update.isPet) {
        world.add(entity, components_1.RendersAsPet);
    }
    return entity;
}
function writeMobRender(world, entity, update) {
    if (update.aiType !== undefined) {
        const id = AI_TYPE_IDS[update.aiType];
        world.set(entity, components_1.MobRender, 'aiType', id === undefined ? exports.AI_TYPE_UNKNOWN : id);
    }
    if (update.isChasing !== undefined) {
        world.set(entity, components_1.MobRender, 'chasing', update.isChasing ? 1 : 0);
    }
    if (update.reversed !== undefined) {
        world.set(entity, components_1.MobRender, 'flipped', update.reversed ? 1 : 0);
    }
}
/** Record a target dummy's measured DPS for its health-bar label. */
function setMobDps(world, id, dps) {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined)
        return;
    if (!world.has(entity, components_1.DpsLabel))
        world.add(entity, components_1.DpsLabel, { value: dps });
    else
        world.set(entity, components_1.DpsLabel, 'value', dps);
}
/** Overwrite a mob's current health (the `enemyDamaged` batch). */
function setMobHealth(world, id, health) {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined)
        return undefined;
    const before = world.get(entity, C.Health, 'current');
    world.set(entity, C.Health, 'current', health);
    return before;
}
/**
 * Remove an entity the server says is gone.
 *
 * Refuses while a death animation is playing, so the pop finishes. The caller
 * is expected to re-issue removal (or let the animation system reap it) rather
 * than assume this succeeded.
 */
function forgetEnemy(world, id, now, reaper) {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined) {
        reaper?.enemyGone(id);
        return true;
    }
    if (isAnimatingDeath(world, entity, now))
        return false;
    reaper?.enemyGone(id);
    world.destroy(entity);
    return true;
}
/**
 * Begin the death animation instead of removing outright.
 *
 * The entity stays in the world, still rendered, until the animation system
 * retires it.
 */
function beginDeathAnimation(world, id, now) {
    const entity = world.lookup(enemyKey(id));
    if (entity === undefined)
        return false;
    if (world.has(entity, C.DeathAnimation))
        return false;
    world.add(entity, C.DeathAnimation, { startTime: now });
    return true;
}
/**
 * Apply a server player record, creating the flower on first sight.
 *
 * Players deliberately get NO SnapshotBuffer. Every flower, local and remote,
 * eases toward its target at the same rate so the local player's motion and a
 * remote player's motion look identical; buffered playback would put remote
 * flowers ~80ms behind the one you are driving, which reads as "other players
 * move differently". That is a bug this client has already had once, and the
 * shape of it is subtle — `applyEnemyUpdate` ADDS SnapshotBuffer on every
 * update, so routing players through it would silently migrate them from the
 * eased archetype to the buffered one. Hence a separate function, and a
 * self-test asserting a player entity never lands in the buffered query.
 *
 * `legacyRef` is the plain `Player` object carrying everything this layer does
 * not own; it is required on creation and ignored afterwards.
 */
function applyPlayerUpdate(world, update, legacyRef) {
    const key = playerKey(update.id);
    const existing = world.lookup(key);
    if (existing !== undefined) {
        world.write(existing, components_1.InterpTarget, { x: update.x, y: update.y });
        if (update.angle !== undefined) {
            // Flower facing is NOT interpolated: it comes straight off the wire
            // and drives the eye direction, which must not lag the body.
            world.set(existing, C.Angle, 'value', update.angle);
        }
        return existing;
    }
    if (legacyRef === undefined)
        return undefined;
    const entity = world.create();
    world.bindExternalId(entity, key);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle ?? 0 });
    world.add(entity, components_1.InterpTarget, { x: update.x, y: update.y, angle: update.angle ?? 0 });
    world.add(entity, components_1.RenderRef, { x: update.x, y: update.y });
    world.add(entity, components_1.RenderEye, { x: 0, y: 0, init: 0 });
    world.add(entity, components_1.LegacyPlayer, { ref: legacyRef });
    world.add(entity, components_1.IsPlayerRender);
    return entity;
}
/** Cut this flower onto its target on the next tick instead of easing to it. */
function snapPlayer(world, id) {
    const entity = world.lookup(playerKey(id));
    if (entity === undefined)
        return;
    if (!world.has(entity, components_1.NeedsSnap))
        world.add(entity, components_1.NeedsSnap);
}
/** Drop a flower the server says is gone. */
function forgetPlayer(world, id, reaper) {
    const entity = world.lookup(playerKey(id));
    reaper?.playerGone(id);
    if (entity === undefined)
        return;
    world.destroy(entity);
}
/** The `Player` object behind a flower entity, or undefined if it has none. */
function playerRefOf(world, entity) {
    if (!world.has(entity, components_1.LegacyPlayer))
        return undefined;
    return world.get(entity, components_1.LegacyPlayer, 'ref');
}
/** Look up a flower's `Player` object by socket id. */
function findPlayerRef(world, id) {
    const entity = world.lookup(playerKey(id));
    if (entity === undefined)
        return undefined;
    return playerRefOf(world, entity);
}
