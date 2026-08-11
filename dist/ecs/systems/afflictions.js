"use strict";
/**
 * Affliction systems: poison stacks, player poison, and slows.
 *
 * All three used to be scans over every mob or every player testing a mostly
 * undefined field. As components they are queries over exactly the afflicted
 * entities, so an empty-affliction tick costs nothing at all rather than ~1400
 * undefined checks.
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
exports.createAfflictionQueries = createAfflictionQueries;
exports.poisonStackSystem = poisonStackSystem;
exports.playerPoisonSystem = playerPoisonSystem;
exports.slowExpirySystem = slowExpirySystem;
exports.registerAfflictionSystems = registerAfflictionSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
function createAfflictionQueries(world) {
    return {
        poisonStacks: world.query([C.PoisonStack]),
        poisonedPlayers: world.query([C.Poisoned, C.Health], [C.IsDead]),
        slowed: world.query([C.Slowed, C.Speed]),
    };
}
/**
 * Apply every active poison stack to its victim and retire lapsed ones.
 *
 * A stack is destroyed when it lapses OR when its target dies — the generation
 * check on the handle is what makes the latter safe. Under the old id-based
 * scheme a stack could outlive its mob and then apply to whichever mob happened
 * to reuse the id.
 */
function poisonStackSystem(queries) {
    return (ctx) => {
        const { world, cmd, now, deltaMs } = ctx;
        queries.poisonStacks.chunks(chunk => {
            const stack = chunk.cols(C.PoisonStack);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const self = entities[i];
                const target = stack.target[i];
                if (!world.isAlive(target) || now >= stack.endTime[i]) {
                    cmd.destroy(self);
                    continue;
                }
                if (!world.has(target, C.Health)) {
                    cmd.destroy(self);
                    continue;
                }
                // PoisonEffect.damage is per millisecond, as before.
                const current = world.get(target, C.Health, 'current');
                const next = current - stack.damagePerMs[i] * deltaMs;
                world.set(target, C.Health, 'current', next);
                if (next <= 0 && !world.has(target, C.IsDead)) {
                    cmd.add(target, C.IsDead);
                }
            }
        });
    };
}
/**
 * Tick the single poison stack a player can carry.
 *
 * Players deliberately differ from mobs here: exactly one stack at a time,
 * refreshed rather than accumulated, because a fresh bite replaces the old one.
 */
function playerPoisonSystem(queries) {
    return (ctx) => {
        const { cmd, now, deltaTime } = ctx;
        queries.poisonedPlayers.chunks(chunk => {
            const poison = chunk.cols(C.Poisoned);
            const health = chunk.cols(C.Health);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= poison.until[i]) {
                    cmd.remove(entities[i], C.Poisoned);
                    continue;
                }
                // Player poison is expressed per SECOND, unlike mob stacks.
                health.current[i] -= poison.damagePerSecond[i] * deltaTime;
                if (health.current[i] <= 0) {
                    cmd.add(entities[i], C.IsDead);
                }
            }
        });
    };
}
/**
 * Restore full speed when a slow lapses.
 *
 * Mirrors the existing `updateSlowEffects` contract exactly: a slow scales
 * `Speed.current` down and this restores it from `Speed.base`, so the ~15
 * movement branches that read speed never learn about slows at all.
 */
function slowExpirySystem(queries) {
    return (ctx) => {
        const { cmd, now } = ctx;
        queries.slowed.chunks(chunk => {
            const slowed = chunk.cols(C.Slowed);
            const speed = chunk.cols(C.Speed);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                if (now >= slowed.until[i]) {
                    speed.current[i] = speed.base[i];
                    cmd.remove(entities[i], C.Slowed);
                }
            }
        });
    };
}
function registerAfflictionSystems(scheduler, queries) {
    scheduler.add('poisonStacks', system_1.Phase.Combat, poisonStackSystem(queries));
    scheduler.add('playerPoison', system_1.Phase.Combat, playerPoisonSystem(queries));
    scheduler.add('slowExpiry', system_1.Phase.Combat, slowExpirySystem(queries));
}
