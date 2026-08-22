"use strict";
/**
 * Ground effects: pollen puffs and web fields, as entities.
 *
 * Replaces the two bespoke arrays + tick loops in server.ts
 * (`updateGroundPollens`, `updateWebFields`). Each effect is an entity built by
 * the prefabs in `../prefabs` — Position, Radius, its marker component, and an
 * `Expires` deadline — and the two systems here do per-tick what the legacy
 * loops did:
 *
 *   pollen   chip-damages every wild mob overlapping it, at most once per
 *            victim per GROUND_POLLEN_DAMAGE_INTERVAL_MS, credited to the
 *            owning player; a victim that reaches zero goes through the
 *            injected kill hook (XP, drops and the wire stay legacy).
 *   web      refreshes a short timed slow on everything standing in it, via
 *            the injected hook (the rarity contest against the mob's tier is
 *            config knowledge, so it runs in the composition root).
 *
 * Expiry is handled HERE rather than by the generic `expiry` sweep, because an
 * expiring effect has to tell clients (`groundPollenRemoved` / `webRemoved`),
 * and the sweep destroys silently. The generic sweep is disabled while legacy
 * owns timers anyway (see LEGACY_OWNED_SYSTEMS); if it is ever enabled, these
 * systems still win the race only because they run and destroy first within
 * the tick their deadline passes — so keep them registered ahead of it.
 *
 * Broad phase is the shared SpatialGrid, which already excludes pets and the
 * dead — the same filter the legacy pollen loop applied by hand. The grid is
 * rebuilt at the top of `tickProjectiles`; the caller ticks this scheduler
 * immediately after it, so the positions are this tick's.
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
exports.WEB_SLOW_LINGER_MS = exports.WEB_SLOW_FACTOR = exports.GROUND_POLLEN_DAMAGE_INTERVAL_MS = void 0;
exports.createGroundEffectQueries = createGroundEffectQueries;
exports.groundPollenSystem = groundPollenSystem;
exports.webFieldSystem = webFieldSystem;
exports.registerGroundEffectSystems = registerGroundEffectSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
/** A mob standing on a pollen puff takes chip damage at most this often. */
exports.GROUND_POLLEN_DAMAGE_INTERVAL_MS = 500;
/** gardn: Collision.cc clamps speed_ratio of anything overlapping a web to 0.5. */
exports.WEB_SLOW_FACTOR = 0.5;
/**
 * gardn re-evaluates the overlap every tick and resets speed_ratio afterwards.
 * Here the slow is a short timed one that the field keeps refreshing, so a mob
 * walking out of a web is back to full speed within this long.
 */
exports.WEB_SLOW_LINGER_MS = 250;
function createGroundEffectQueries(world) {
    return {
        pollens: world.query([C.Position, C.Radius, C.GroundPollen, C.Expires]),
        webs: world.query([C.Position, C.Radius, C.WebField, C.Expires]),
    };
}
/**
 * Chip-damage pass for pollen puffs.
 *
 * Effect handles are snapshotted before any work: the kill hook reaches legacy
 * code that may create or retire entities, and iterating live chunks across
 * that is how a swap-remove skips a row.
 */
function groundPollenSystem(queries, grid, gridResult, deps) {
    const { damageMultiplierOf, creditDamage, markEnemyDamaged, onKill, emitExpired, pollenTargetRadiusOf, } = deps;
    const scratch = [];
    return (ctx) => {
        const { world, cmd, now } = ctx;
        scratch.length = 0;
        queries.pollens.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                scratch.push(entities[i]);
        });
        for (let p = 0; p < scratch.length; p++) {
            const pollen = scratch[p];
            if (!world.isAlive(pollen))
                continue;
            if (now >= world.get(pollen, C.Expires, 'at')) {
                const id = world.externalIdOf(pollen);
                if (id)
                    emitExpired('pollen', id);
                cmd.destroy(pollen);
                continue;
            }
            const x = world.get(pollen, C.Position, 'x');
            const y = world.get(pollen, C.Position, 'y');
            const radius = world.get(pollen, C.Radius, 'value');
            const damage = world.get(pollen, C.GroundPollen, 'damage');
            const owner = world.get(pollen, C.GroundPollen, 'owner');
            const lastDamageByEnemy = world.get(pollen, C.GroundPollen, 'lastDamageByEnemy');
            // Owner gone -> damage still lands, just unattributed and
            // unmultiplied, exactly as the legacy `players[pollen.playerId]`
            // miss behaved.
            const ownerAlive = world.isAlive(owner);
            const multiplier = ownerAlive ? (damageMultiplierOf(owner) ?? 1) : 1;
            const finalDamage = damage * multiplier;
            grid.query(x, y, radius, gridResult);
            for (let i = 0; i < gridResult.count; i++) {
                const victim = gridResult.entity(i);
                if (!world.isAlive(victim))
                    continue;
                // A mob killed earlier this tick may still be in the grid; its
                // shell has already left `enemies[]`, so skip it the way the
                // legacy scan (which iterated the shells) never saw it.
                const health = world.get(victim, C.Health, 'current');
                if (health <= 0 || world.has(victim, C.IsDead))
                    continue;
                const dx = gridResult.x[i] - x;
                const dy = gridResult.y[i] - y;
                const minDistance = radius + pollenTargetRadiusOf(victim);
                if (dx * dx + dy * dy >= minDistance * minDistance)
                    continue;
                const last = lastDamageByEnemy.get(victim) || 0;
                if (now - last < exports.GROUND_POLLEN_DAMAGE_INTERVAL_MS)
                    continue;
                lastDamageByEnemy.set(victim, now);
                if (ownerAlive)
                    creditDamage(victim, owner, finalDamage);
                const next = Math.max(0, health - finalDamage);
                world.set(victim, C.Health, 'current', next);
                markEnemyDamaged(victim);
                if (next <= 0 && !world.has(victim, C.IsDead)) {
                    onKill(victim, owner);
                }
            }
        }
        scratch.length = 0;
    };
}
/** Slow-refresh pass for web fields. */
function webFieldSystem(queries, grid, gridResult, deps) {
    const { applySlow, emitExpired } = deps;
    const scratch = [];
    return (ctx) => {
        const { world, cmd, now } = ctx;
        scratch.length = 0;
        queries.webs.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++)
                scratch.push(entities[i]);
        });
        for (let w = 0; w < scratch.length; w++) {
            const web = scratch[w];
            if (!world.isAlive(web))
                continue;
            if (now >= world.get(web, C.Expires, 'at')) {
                const id = world.externalIdOf(web);
                if (id)
                    emitExpired('web', id);
                cmd.destroy(web);
                continue;
            }
            const x = world.get(web, C.Position, 'x');
            const y = world.get(web, C.Position, 'y');
            const radius = world.get(web, C.Radius, 'value');
            // The field carries the rarity of the petal that was thrown, so a
            // high-rarity web still bites on mobs that shrug off a common one.
            const rarity = world.get(web, C.WebField, 'rarity');
            grid.query(x, y, radius, gridResult);
            for (let i = 0; i < gridResult.count; i++) {
                const victim = gridResult.entity(i);
                if (!world.isAlive(victim))
                    continue;
                if (world.get(victim, C.Health, 'current') <= 0)
                    continue;
                if (world.has(victim, C.IsDead))
                    continue;
                const dx = gridResult.x[i] - x;
                const dy = gridResult.y[i] - y;
                const reach = radius + gridResult.radius[i];
                if (dx * dx + dy * dy >= reach * reach)
                    continue;
                applySlow(victim, exports.WEB_SLOW_FACTOR, now + exports.WEB_SLOW_LINGER_MS, rarity, now);
            }
        }
        scratch.length = 0;
    };
}
function registerGroundEffectSystems(scheduler, queries, grid, gridResult, deps) {
    scheduler.add('groundPollens', system_1.Phase.Combat, groundPollenSystem(queries, grid, gridResult, deps));
    scheduler.add('webFields', system_1.Phase.Combat, webFieldSystem(queries, grid, gridResult, deps));
}
