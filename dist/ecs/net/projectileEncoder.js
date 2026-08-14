"use strict";
/**
 * Projectile wire encoding from component columns.
 *
 * ---------------------------------------------------------------------------
 * The protocol, and why it is this small
 * ---------------------------------------------------------------------------
 * Projectiles travel in straight lines at constant velocity, so a client can
 * dead-reckon their positions perfectly from a single spawn message (see
 * Game.update in game.ts, which advances them locally and deletes them at
 * maxDistance). The server therefore sends only:
 *
 *   mpSpawn / ppSpawn   projectiles that just entered this client's viewport
 *   mpRemove / ppRemove ids that just left it or were destroyed
 *
 * and never a per-tick position. Earlier versions DID send periodic re-syncs to
 * "correct" the client; under latency jitter they only ever snapped projectiles
 * back to a stale server position and produced visible stutter. Adding fields or
 * re-syncs here brings that back.
 *
 * The payload carries `i,x,y,a,s,mD,pT,pR,sz` and nothing else — no shooter, no
 * startX/Y, no damage, health or spawnTime. None of those are read by the
 * client and all of them would inflate a message that is sent for every shot of
 * every gas/rainbow volley.
 *
 * ---------------------------------------------------------------------------
 * The interning boundary
 * ---------------------------------------------------------------------------
 * `petalType` is stored as a PROCESS-LOCAL interned integer, assigned in
 * first-seen order. This is one of the two places (with enemyEncoder.ts) it must
 * become a string again: sending the integer would render as the wrong petal
 * rather than failing loudly. Rarity needs no table — it is already the
 * canonical RARITY_LEVELS index the wire format and database share.
 *
 * ---------------------------------------------------------------------------
 * Ids
 * ---------------------------------------------------------------------------
 * `i` is the NetId column, a small monotonic number minted by the server's
 * projectile counters — NOT the entity handle. Handles pack index+generation and
 * the index is recycled within seconds under projectile churn, so a handle on
 * the wire would eventually alias a projectile a client still has in its map.
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
exports.encodeProjectilesInBox = encodeProjectilesInBox;
exports.diffRemoved = diffRemoved;
const C = __importStar(require("../components"));
const interning_1 = require("../interning");
/**
 * Walk `query` and split it against what a client already knows.
 *
 * `spawnedOut` receives the full record for every projectile inside the box that
 * the client has not been told about; `stillKnownOut` receives the ids of
 * everything inside the box, and becomes the client's new known-set. Both are
 * caller-owned and cleared here so a per-tick broadcast allocates nothing beyond
 * the records it actually sends.
 *
 * The box is a half-extent AABB around the camera, matching the legacy
 * `Math.abs(dx) < vw` test rather than a radius — a projectile is visible when
 * it is on screen, and the screen is a rectangle.
 */
function encodeProjectilesInBox(query, centerX, centerY, halfWidth, halfHeight, known, spawnedOut, stillKnownOut) {
    spawnedOut.length = 0;
    stillKnownOut.clear();
    query.chunks(chunk => {
        const pos = chunk.cols(C.Position);
        const angle = chunk.cols(C.Angle);
        const speed = chunk.cols(C.Speed);
        const proj = chunk.cols(C.Projectile);
        const net = chunk.cols(C.NetId);
        for (let i = 0; i < chunk.count; i++) {
            const x = pos.x[i];
            const y = pos.y[i];
            const dx = x - centerX;
            const dy = y - centerY;
            if ((dx < 0 ? -dx : dx) >= halfWidth || (dy < 0 ? -dy : dy) >= halfHeight)
                continue;
            const id = net.id[i];
            stillKnownOut.add(id);
            if (known.has(id))
                continue;
            spawnedOut.push({
                i: id,
                x,
                y,
                a: angle.value[i],
                s: speed.current[i],
                mD: proj.maxDistance[i],
                // The interning boundary: process-local id back to a string.
                pT: interning_1.petalTypes.nameOf(proj.petalType[i]),
                pR: (0, interning_1.idToRarity)(proj.petalRarity[i]) ?? 'common',
                sz: proj.size[i],
            });
        }
    });
}
/**
 * Ids the client knows about but that are no longer in its box.
 *
 * A dropped removal frame (uWS drops frames past its 64KB backpressure limit)
 * is survivable here ONLY because the client independently deletes a projectile
 * when its own dead-reckoning reaches maxDistance. That safety net is why this
 * is a per-tick set difference rather than the re-sent removal list the enemy
 * encoder needs.
 */
function diffRemoved(known, stillKnown, removedOut) {
    removedOut.length = 0;
    for (const id of known) {
        if (!stillKnown.has(id))
            removedOut.push(id);
    }
}
