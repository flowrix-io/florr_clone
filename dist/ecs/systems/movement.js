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
        projectiles: world.query([C.Position, C.Angle, C.Speed, C.Projectile, C.Radius, C.Health], [C.IsDead]),
    };
}
/**
 * Advance every projectile along its heading, stop the ones that flew into
 * geometry, and retire the ones that have flown their full distance.
 *
 * The old loop walked the array BACKWARDS and spliced, because removing while
 * iterating forwards skips elements. Here removal is deferred to the command
 * buffer, so the loop reads forwards over dense columns.
 *
 * ---------------------------------------------------------------------------
 * Why only PLAYER projectiles expire here
 * ---------------------------------------------------------------------------
 * The two legacy loops tested max-distance in different places and it is a real
 * behavioural difference, not an accident of how they were written:
 *
 *   updatePlayerProjectiles  move -> EXPIRE -> wall -> collisions
 *   updateMobProjectiles     move -> wall -> collisions -> EXPIRE
 *
 * So a mob projectile that reaches its maximum range on the tick it also
 * reaches a player still gets that last hit; a player projectile does not. The
 * mob half of the rule therefore lives at the END of projectileCollision.ts,
 * after every hit test has run, and only the player half is applied here.
 */
function projectileFlightSystem(queries, deps) {
    const { hitsWall } = deps;
    return (ctx) => {
        const { deltaMs, cmd } = ctx;
        queries.projectiles.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const angle = chunk.cols(C.Angle);
            const speed = chunk.cols(C.Speed);
            const proj = chunk.cols(C.Projectile);
            const health = chunk.cols(C.Health);
            const radius = chunk.cols(C.Radius);
            const entities = chunk.entities;
            // Constant per archetype, so the branch is hoisted out of the row loop.
            const fromPlayer = chunk.has(C.FromPlayer);
            for (let i = 0; i < chunk.count; i++) {
                // Both legacy loops opened with this sweep. A projectile's health
                // is knocked down from OUTSIDE this system — by a petal that
                // blocked it, or by an opposing projectile — and the sweep is
                // what retires it on the following tick.
                if (health.current[i] <= 0) {
                    cmd.destroy(entities[i]);
                    continue;
                }
                const moveDistance = speed.current[i] * deltaMs;
                const a = angle.value[i];
                const x = pos.x[i] + Math.cos(a) * moveDistance;
                const y = pos.y[i] + Math.sin(a) * moveDistance;
                pos.x[i] = x;
                pos.y[i] = y;
                proj.distance[i] += moveDistance;
                // Player projectiles expire BEFORE their hit tests; see above.
                if (fromPlayer && proj.distance[i] >= proj.maxDistance[i]) {
                    cmd.destroy(entities[i]);
                    continue;
                }
                // C.Radius is already size*20/2, the exact half-size the legacy
                // wall test was handed.
                if (hitsWall(x, y, radius.value[i])) {
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
function registerMovementSystems(scheduler, queries, deps) {
    scheduler.add('projectileFlight', system_1.Phase.Simulation, projectileFlightSystem(queries, deps));
}
