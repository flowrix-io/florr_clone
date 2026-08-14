"use strict";
/**
 * Viewport-status tracking — the port of `updateEnemyViewportStatus`.
 *
 * Refreshes `ViewportTracked.lastInViewport` for every mob currently near a
 * player, which is what feeds the unseen-despawn sweep. Until this existed the
 * ECS had no way to keep a mob alive: `unseenDespawn` reaped everything after
 * 30 seconds, so the tick harness had to fake this pass and legacy had to keep
 * lifecycle ownership.
 *
 * Two details carried over deliberately:
 *
 * - The test is NEAR A PLAYER, not IN A VIEWPORT. Maze and PVP players sit
 *   outside the world rectangle and are excluded from the world-clamped
 *   viewport list, which made every maze mob read as permanently out-of-view
 *   and churn through 30-second despawns.
 *
 * - It is STRIDED. This pass exists only to feed a 30-second timer, so running
 *   it at ~6Hz instead of 30Hz is equivalent, and it avoids box-testing ~1400
 *   mobs every tick. The offset keeps it off the same tick as the despawn sweep
 *   it feeds.
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
exports.createViewportQueries = createViewportQueries;
exports.viewportStatusSystem = viewportStatusSystem;
exports.registerViewportSystem = registerViewportSystem;
const C = __importStar(require("../components"));
const system_1 = require("../system");
function createViewportQueries(world) {
    return {
        tracked: world.query([C.Position, C.ViewportTracked], [C.IsDead]),
    };
}
function viewportStatusSystem(queries, deps) {
    const { isNearAnyPlayer } = deps;
    return (ctx) => {
        const now = ctx.now;
        queries.tracked.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const tracked = chunk.cols(C.ViewportTracked);
            for (let i = 0; i < chunk.count; i++) {
                if (isNearAnyPlayer(pos.x[i], pos.y[i]))
                    tracked.lastInViewport[i] = now;
            }
        });
    };
}
function registerViewportSystem(scheduler, queries, deps) {
    // Strided like the original, and offset so it never lands on the same tick
    // as the despawn sweep that consumes what it writes.
    scheduler.add('viewportStatus', system_1.Phase.Lifetime, viewportStatusSystem(queries, deps), {
        interval: 5,
        offset: 0,
    });
}
