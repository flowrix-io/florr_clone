"use strict";
/**
 * Wire -> client world ingestion. The ECS port of net/enemyIngest.ts.
 *
 * Both delivery paths — the bulk `enemySpawned` payload and the per-tick delta
 * decoder — funnel through here, because they must treat a mid-death-animation
 * entity identically: updating or deleting one out from under its animation
 * makes mobs blink out instead of playing their death pop.
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
exports.DEATH_ANIMATION_DURATION_MS = void 0;
exports.applyEnemyUpdate = applyEnemyUpdate;
exports.forgetEnemy = forgetEnemy;
exports.beginDeathAnimation = beginDeathAnimation;
const C = __importStar(require("../components"));
const components_1 = require("./components");
const interning_1 = require("../interning");
/** Must match the death-pop duration the renderer draws. */
exports.DEATH_ANIMATION_DURATION_MS = 200;
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
function applyEnemyUpdate(world, update, now, snapTimeMs) {
    const existing = world.lookup(update.id);
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
        (0, components_1.pushSnapshot)(world.get(existing, components_1.SnapshotBuffer, 'samples'), snapTimeMs ?? now, update.x, update.y, update.angle);
        world.write(existing, C.Health, { current: update.health, max: update.maxHealth });
        if (update.type !== undefined) {
            world.set(existing, C.MobKind, 'type', interning_1.mobTypes.intern(update.type));
        }
        if (update.tier !== undefined) {
            world.set(existing, C.MobKind, 'tier', (0, interning_1.rarityToId)(update.tier));
        }
        return existing;
    }
    const entity = world.create();
    world.bindExternalId(entity, update.id);
    world.add(entity, C.Position, { x: update.x, y: update.y });
    world.add(entity, C.Angle, { value: update.angle });
    world.add(entity, C.Health, { current: update.health, max: update.maxHealth });
    world.add(entity, C.MobKind, {
        type: interning_1.mobTypes.intern(update.type ?? 'bee'),
        tier: (0, interning_1.rarityToId)(update.tier ?? 'common'),
    });
    // First appearance: draw where the server says, with no easing.
    world.add(entity, components_1.InterpTarget, { x: update.x, y: update.y, angle: update.angle });
    world.add(entity, C.IsEnemy);
    // The two delivery paths disagree on how they mark a pet; normalise to one
    // tag so the renderer reads a single thing.
    if (update.ownerId !== undefined || update.isPet) {
        world.add(entity, components_1.RendersAsPet);
    }
    return entity;
}
/**
 * Remove an entity the server says is gone.
 *
 * Refuses while a death animation is playing, so the pop finishes. The caller
 * is expected to re-issue removal (or let the animation system reap it) rather
 * than assume this succeeded.
 */
function forgetEnemy(world, id, now) {
    const entity = world.lookup(id);
    if (entity === undefined)
        return true;
    if (isAnimatingDeath(world, entity, now))
        return false;
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
    const entity = world.lookup(id);
    if (entity === undefined)
        return;
    if (world.has(entity, C.DeathAnimation))
        return;
    world.add(entity, C.DeathAnimation, { startTime: now });
}
