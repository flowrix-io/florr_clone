"use strict";
/**
 * Movement systems.
 *
 * Ports of the integration steps that were previously inlined in
 * `updateMobProjectiles` / `updatePlayerProjectiles` (server.ts) and the
 * passive-AI branch of `moveEnemies`.
 *
 * The unit conventions are carried over verbatim rather than normalised,
 * because changing them silently would change how fast everything moves:
 *   - PROJECTILE speed is pixels per MILLISECOND (`speed * deltaTimeMs`).
 *   - Mob/player speed is pixels per SECOND (`speed * deltaTime`).
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
exports.createMovementQueries = createMovementQueries;
exports.projectileFlightSystem = projectileFlightSystem;
exports.registerMovementSystems = registerMovementSystems;
const C = __importStar(require("../components"));
const system_1 = require("../system");
function createMovementQueries(world) {
    return {
        // Projectiles fly along a fixed heading; they never consult Velocity.
        projectiles: world.query([C.Position, C.Angle, C.Speed, C.Projectile], [C.IsDead]),
    };
}
/**
 * Advance every projectile along its heading and retire the ones that have
 * flown their full distance.
 *
 * The old loop walked the array BACKWARDS and spliced, because removing while
 * iterating forwards skips elements. Here removal is deferred to the command
 * buffer, so the loop reads forwards over dense columns.
 */
function projectileFlightSystem(queries) {
    return (ctx) => {
        const { deltaMs, cmd } = ctx;
        queries.projectiles.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const angle = chunk.cols(C.Angle);
            const speed = chunk.cols(C.Speed);
            const proj = chunk.cols(C.Projectile);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const moveDistance = speed.current[i] * deltaMs;
                const a = angle.value[i];
                pos.x[i] += Math.cos(a) * moveDistance;
                pos.y[i] += Math.sin(a) * moveDistance;
                proj.distance[i] += moveDistance;
                if (proj.distance[i] >= proj.maxDistance[i]) {
                    cmd.destroy(entities[i]);
                }
            }
        });
    };
}
/**
 * Register the projectile flight system in the Simulation phase.
 *
 * Passive mob drift used to live here as a dt-scaled friction integrator. That
 * was wrong: the real gardn passive step is PER TICK with no deltaTime, uses a
 * state-machine acceleration and clamps the resulting drift. It now lives in
 * systems/enemyPassive.ts as a faithful port.
 */
function registerMovementSystems(scheduler, queries) {
    scheduler.add('projectileFlight', system_1.Phase.Simulation, projectileFlightSystem(queries));
}
