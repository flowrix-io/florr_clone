"use strict";
/**
 * Per-tick `gameStateUpdate` encoding — the network half of the server tick.
 *
 * Each client receives a delta: short wire keys, and fields omitted when they
 * haven't changed since the last frame sent to that client. The matching decoder
 * is the `gameStateUpdate` handler in socket.ts; the two must be changed
 * together.
 *
 * The shape of one frame:
 *   T  server tick timestamp (always present)
 *   P  changed/new players      D  players to forget
 *   E  changed/new enemies      R  enemies to forget
 *   F  1 = this is a full resync, drop anything not mentioned
 *
 * Three things make the payload small, and all three are load-bearing:
 *   - recipient-invariant work (face/equip flags, petal positions) is computed
 *     once per tick in buildPlayerSnapshots, not once per recipient × player;
 *   - everything is culled to the recipient's 200%-viewport box;
 *   - unchanged entities are simply not mentioned.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEligibleItemsForSocket = getEligibleItemsForSocket;
exports.buildPlayerSnapshots = buildPlayerSnapshots;
exports.broadcastGameState = broadcastGameState;
const constants_1 = require("../constants");
const player_1 = require("../player");
const petals_1 = require("../petals");
const mobs_1 = require("../mobs");
const gameState_1 = require("./gameState");
const squadManager_1 = require("./squadManager");
const utils_1 = require("./utils");
const wire_fields_1 = require("../wire_fields");
/**
 * Item wire events whose loss desyncs the client's item map. A dropped spawn
 * leaves loot the client never renders; a dropped remove/pickup leaves a
 * ghost item. All are recovered by one itemsUpdate full replace.
 */
const ITEM_CHANNEL_EVENTS = ['itemsSpawned', 'itemSpawned', 'itemRemoved', 'itemPickedUp', 'itemsUpdate'];
/**
 * How many OTHER flowers one client receives authoritative per-petal positions
 * for each tick (their own is always sent). Everyone on screen normally fits;
 * past this, the furthest-arriving ones fall back to client-side canonical orbit
 * so a packed hub can't push the per-tick payload toward the uWS backpressure
 * limit. ~150–200 wire bytes per detailed flower per tick.
 */
const PETAL_DETAIL_MAX_PLAYERS = 12;
/** Reduce positional precision to save bandwidth. */
function quantize(value, precision) {
    return Math.round(value / precision) * precision;
}
/**
 * All world items this socket's player (including split-screen halves) can
 * currently see: eligibility-listed for them and not yet picked up by them.
 * Used on authenticate and as the drop-recovery payload.
 */
function getEligibleItemsForSocket(socketId) {
    // Lazy require: petal_actions imports back into the server graph.
    const { splitPlayers } = require('../petal_actions');
    const originalId = socketId.replace('_split2', '').replace('_split1', '');
    const splitState = splitPlayers.get(originalId);
    const playerIds = splitState ? [splitState.player1.id, splitState.player2.id, originalId] : [socketId];
    return gameState_1.items.filter(item => {
        if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
            if (!playerIds.some(playerId => item.eligiblePlayers.includes(playerId))) {
                return false; // Not eligible
            }
        }
        if (item.pickedUpBy && playerIds.some(playerId => item.pickedUpBy.has(playerId))) {
            return false; // Already picked up
        }
        return true;
    });
}
/** Precompute the recipient-invariant part of every flower, once per tick. */
function buildPlayerSnapshots() {
    const snapshots = [];
    for (const p of Object.values(constants_1.players)) {
        const petalExtension = p.inputs?.petalExtension || 1.0;
        let faceFlags = 0;
        let mouth = 14.5;
        if (petalExtension > 1.0) {
            faceFlags |= player_1.FaceFlags.Attacking;
            mouth = 4;
        }
        if (petalExtension < 1.0) {
            faceFlags |= player_1.FaceFlags.Defending;
            mouth = 4;
        }
        if (p.poisonUntil && Date.now() < p.poisonUntil)
            faceFlags |= player_1.FaceFlags.Poisoned;
        // Corruption paints the flower dark red for everyone — it is the only
        // warning other players get that this flower's petals can hurt them.
        if (p.corrupted)
            faceFlags |= player_1.FaceFlags.HasCorruption;
        let equipFlags = 0;
        // Bit i set = loadout slot i is fully on cooldown. For a clumped petal
        // the slot only counts as down when EVERY instance is down, matching
        // the slot-level `onCooldown` the client's renderer tests.
        let cooldownMask = 0;
        if (p.loadout) {
            const loadoutLen = Math.min(p.loadout.length, 10);
            for (let i = 0; i < loadoutLen; i++) {
                const item = p.loadout[i];
                if (!item || item.type !== 'petal' || !item.petalType)
                    continue;
                if (item.onCooldown)
                    cooldownMask |= (1 << i);
                const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity ?? 'common');
                if (stats?.equipFlags)
                    equipFlags |= stats.equipFlags;
                if (stats?.faceFlags)
                    faceFlags |= stats.faceFlags;
            }
        }
        snapshots.push({
            p,
            ownerId: (0, utils_1.getOriginalSocketId)(p.id),
            faceFlags,
            equipFlags,
            renderFlags: (0, player_1.effectiveRenderFlags)(p),
            equippedSkinId: p.equippedSkinId ?? '',
            mouth,
            petalExtension,
            cooldownMask,
            petalsRaw: p.petalPositions || [],
        });
    }
    return snapshots;
}
function buildRecipientView(playerId, socket) {
    const quality = socket.connectionQuality || 'good';
    const player = (0, utils_1.getActivePlayerForSocket)(playerId);
    return {
        playerId,
        socket,
        player,
        selfId: player ? player.id : playerId,
        quality,
        precision: quality === 'slow' ? 2 : quality === 'medium' ? 1 : 0.5,
        anglePrecision: quality === 'slow' ? 0.1 : 0.05,
        vw: (player?.viewportWidth || constants_1.VIEWPORT_WIDTH) * 2,
        vh: (player?.viewportHeight || constants_1.VIEWPORT_HEIGHT) * 2,
        px0: player?.x || 0,
        py0: player?.y || 0,
    };
}
/**
 * Translate transport-level drop records into channel resyncs.
 *
 * emitWithStatus/sendRaw note the event name whenever uWS discards a frame to
 * this socket; consume them here once per tick. Item-channel losses
 * (spawns/removes/pickups fire from timers and pickup handlers, not just the
 * tick loop) are recovered with a full itemsUpdate replace — the client clears
 * and refills its item map.
 *
 * Returns true if the entity channel needs a full resync this tick.
 */
function recoverDroppedChannels(view) {
    const { socket, playerId } = view;
    const dropped = socket.droppedEvents;
    if (dropped && dropped.size > 0) {
        if (dropped.has('gameStateUpdate'))
            socket.needsEntityResync = true;
        for (const ev of ITEM_CHANNEL_EVENTS) {
            if (dropped.has(ev)) {
                socket.needsItemResync = true;
                break;
            }
        }
        dropped.clear();
    }
    if (socket.needsItemResync) {
        // Status 2 = this resync was itself dropped; keep the flag armed.
        if (socket.emitWithStatus('itemsUpdate', getEligibleItemsForSocket(playerId)) !== 2) {
            socket.needsItemResync = false;
        }
    }
    // A previous frame to this socket was dropped by uWS (backpressure over
    // maxBackpressure), but the delta maps were already committed as if the
    // client received it — any one-shot removal in that frame is otherwise lost
    // forever. Recover by clearing the maps so everything re-sends as
    // first-sight full records, and tag the frame F=1 so the client drops
    // enemies it doesn't mention.
    const fullResync = socket.needsEntityResync === true;
    if (fullResync) {
        socket.lastSentPlayers?.clear();
        socket.lastSentEnemies?.clear();
    }
    return fullResync;
}
// ---------------------------------------------------------------------------
// Player deltas
// ---------------------------------------------------------------------------
/**
 * Can this recipient see `snap`'s flower?
 *
 * Exemptions from the visibility box — clients need these flowers off-screen:
 *  - both of this socket's own halves (splitter leaves one behind),
 *  - squadmates, whose minimap dots are drawn from the players map,
 *  - everyone in the PvP arena while we're in it, since the arena leaderboard
 *    is built from the players map and the arena (r=2500) is larger than the
 *    visibility box.
 */
function isPlayerVisibleTo(view, snap, squadIds, selfInArena) {
    const p = snap.p;
    if (p.id === view.selfId || snap.ownerId === view.playerId)
        return true;
    if (squadIds !== null && squadIds.has(snap.ownerId))
        return true;
    if (selfInArena && !!p.inPvpArena)
        return true;
    const pdx = p.x - view.px0;
    const pdy = p.y - view.py0;
    return (pdx < 0 ? -pdx : pdx) < view.vw && (pdy < 0 ? -pdy : pdy) < view.vh;
}
/**
 * Encode this flower's petal positions, plus a signature used to detect change.
 *
 * Petal positions are sent for the recipient's own flower AND for every other
 * flower on their screen (budget permitting), so all petals render from the same
 * authoritative source. This used to be self-only — everyone else's petals were
 * client-computed canonical orbit, which cannot reproduce reload fly-out from
 * the flower centre, per-instance breaks (a half-broken clump still drew every
 * petal), mob attraction, or the server's true orbit phase.
 *
 * The returned array is always sent when the signature changes: when a flower
 * drops out of detail range, an empty `p` is what tells its client to release
 * the stale absolute positions and fall back to canonical orbit. Signature 0
 * means "no detail for this flower", so it is seeded to 1 when detail IS being
 * sent, keeping a genuinely empty array (every petal broken) distinguishable.
 */
function encodePetals(view, snap, wantPetals) {
    const petalsOut = [];
    if (!wantPetals)
        return { petalsOut, petalsSig: 0 };
    let petalsSig = 1;
    const petalPrecision = view.quality === 'slow' ? 6 : view.quality === 'medium' ? 4 : 3;
    const petalsRaw = snap.petalsRaw;
    for (let i = 0; i < petalsRaw.length; i++) {
        const pos = petalsRaw[i];
        const px = quantize(pos.x, petalPrecision);
        const py = quantize(pos.y, petalPrecision);
        const np = pos.noPhysics ? 1 : 0;
        // FNV-1a-style mix; values fit in int32 after Math.imul.
        petalsSig = Math.imul(petalsSig ^ pos.loadoutIndex, 16777619);
        petalsSig = Math.imul(petalsSig ^ pos.instanceIndex, 16777619);
        petalsSig = Math.imul(petalsSig ^ (px | 0), 16777619);
        petalsSig = Math.imul(petalsSig ^ (py | 0), 16777619);
        petalsSig = Math.imul(petalsSig ^ np, 16777619);
        const petal = { L: pos.loadoutIndex, I: pos.instanceIndex, x: px, y: py };
        if (np)
            petal.N = 1;
        petalsOut.push((0, wire_fields_1.packFields)(petal, wire_fields_1.PETAL_FIELDS));
    }
    // Never let a mixed hash land on the "no detail" sentinel.
    if (petalsSig === 0)
        petalsSig = 1;
    return { petalsOut, petalsSig };
}
/**
 * Build the changed-player list for one recipient, and the list of players they
 * should forget.
 *
 * Anyone previously sent who has left the visibility box or the server goes on
 * the remove list. Dropping them from lastPlayers alone only stopped the deltas
 * — the client kept the flower forever, frozen at its last-known position,
 * still drawn and still on the minimap.
 */
function collectPlayerDeltas(view, snapshots) {
    const { socket, selfId } = view;
    if (!socket.lastSentPlayers)
        socket.lastSentPlayers = new Map();
    const lastPlayers = socket.lastSentPlayers;
    const changed = [];
    const currentPlayerIds = new Set();
    const squad = (0, squadManager_1.getSquadForPlayer)(view.playerId);
    const squadIds = squad ? new Set(squad.memberIds) : null;
    const selfInArena = !!view.player?.inPvpArena;
    // Per-petal detail is bounded by the standard on-screen box plus a hard
    // budget, so a crowded hub can't multiply the per-tick payload without
    // limit. Budget is consumed in the stable players-object order, so the same
    // flowers keep detail tick to tick instead of flickering between the two
    // render paths.
    const petalBoxW = (view.player?.viewportWidth || constants_1.VIEWPORT_WIDTH) / 2 + constants_1.VIEWPORT_BUFFER;
    const petalBoxH = (view.player?.viewportHeight || constants_1.VIEWPORT_HEIGHT) / 2 + constants_1.VIEWPORT_BUFFER;
    let petalDetailBudget = PETAL_DETAIL_MAX_PLAYERS;
    for (const snap of snapshots) {
        const p = snap.p;
        const isSelf = p.id === selfId;
        // Cull before anything else: a player that fails this is left out of
        // currentPlayerIds, which puts them on the remove list below.
        if (!isPlayerVisibleTo(view, snap, squadIds, selfInArena))
            continue;
        currentPlayerIds.add(p.id);
        let wantPetals = isSelf;
        if (!wantPetals && petalDetailBudget > 0 &&
            Math.abs(p.x - view.px0) <= petalBoxW &&
            Math.abs(p.y - view.py0) <= petalBoxH) {
            wantPetals = true;
            petalDetailBudget--;
        }
        const { petalsOut, petalsSig } = encodePetals(view, snap, wantPetals);
        const next = {
            x: isSelf ? p.x : quantize(p.x, view.precision),
            y: isSelf ? p.y : quantize(p.y, view.precision),
            a: isSelf ? p.angle : quantize(p.angle, view.anglePrecision),
            vx: isSelf ? quantize(p.velocityX ?? 0, 0.01) : 0,
            vy: isSelf ? quantize(p.velocityY ?? 0, 0.01) : 0,
            h: Math.round(p.health),
            H: Math.round(p.maxHealth),
            l: p.level,
            s: p.score,
            e: quantize(snap.petalExtension, 0.1),
            f: snap.faceFlags,
            q: snap.equipFlags,
            r: snap.renderFlags,
            k: snap.equippedSkinId,
            m: snap.mouth,
            v: p.inPvpArena ? 1 : 0,
            M: p.inMaze ? 1 : 0,
            V: p.pvpScore || 0,
            z: p.sizeMultiplier ?? 1.0,
            n: p.name,
            // Effective speed multiplier, sent to the owning client for prediction.
            sm: quantize(p.speedFactor ?? 1, 0.01),
            u: isSelf ? (p.lastProcessedInputSeq ?? 0) : 0,
            c: snap.cooldownMask,
            petalsSig,
        };
        const delta = encodePlayerDelta(p.id, next, lastPlayers.get(p.id), isSelf, petalsOut);
        if (delta) {
            changed.push(delta);
            lastPlayers.set(p.id, next);
        }
    }
    const removed = [];
    for (const id of lastPlayers.keys()) {
        if (!currentPlayerIds.has(id)) {
            removed.push(id);
            lastPlayers.delete(id);
        }
    }
    return { changed, removed };
}
/**
 * Diff one flower against what this client last received.
 *
 * For each field: when `prev` exists, send only if the value changed (so
 * transitions back to a default are still emitted). When `prev` is missing
 * (first send), send only if non-default — the client applies defaults to
 * missing fields. Returns null when nothing changed.
 */
function encodePlayerDelta(id, next, prev, isSelf, petalsOut) {
    const delta = { i: id };
    let changed = false;
    const put = (key, value, prevValue, dflt) => {
        if (prev ? prevValue !== value : value !== dflt) {
            delta[key] = value;
            changed = true;
        }
    };
    /** Fields with no meaningful default: always sent on first sight. */
    const putAlways = (key, value, prevValue) => {
        if (prev ? prevValue !== value : true) {
            delta[key] = value;
            changed = true;
        }
    };
    putAlways('x', next.x, prev?.x);
    putAlways('y', next.y, prev?.y);
    put('a', next.a, prev?.a, 0);
    if (isSelf)
        put('vx', next.vx, prev?.vx, 0);
    if (isSelf)
        put('vy', next.vy, prev?.vy, 0);
    putAlways('h', next.h, prev?.h);
    putAlways('H', next.H, prev?.H);
    put('l', next.l, prev?.l, 1);
    put('s', next.s, prev?.s, 0);
    put('e', next.e, prev?.e, 1.0);
    put('f', next.f, prev?.f, 0);
    put('q', next.q, prev?.q, 0);
    put('r', next.r, prev?.r, 0);
    put('k', next.k, prev?.k, '');
    put('m', next.m, prev?.m, 14.5);
    put('v', next.v, prev?.v, 0);
    put('M', next.M, prev?.M, 0);
    put('V', next.V, prev?.V, 0);
    put('z', next.z, prev?.z, 1.0);
    put('c', next.c, prev?.c, 0);
    putAlways('n', next.n, prev?.n);
    // Only the owning client predicts, so only it needs the speed factor.
    if (isSelf)
        put('sm', next.sm, prev?.sm, 1);
    // Echo the last input sequence processed by the server. This gives the
    // client a stable acknowledgement marker when RTT is high or uneven.
    if (isSelf)
        put('u', next.u, prev?.u, 0);
    // petalsSig is 0 for a flower with no petal detail this tick, so a flower
    // leaving detail range sends `p: []` exactly once.
    if (prev ? prev.petalsSig !== next.petalsSig : petalsOut.length > 0) {
        delta.p = petalsOut;
        changed = true;
    }
    return changed ? (0, wire_fields_1.packFields)(delta, wire_fields_1.PLAYER_FIELDS) : null;
}
// ---------------------------------------------------------------------------
// Enemy deltas
// ---------------------------------------------------------------------------
/**
 * Build the changed-enemy list for one recipient, and the list of enemies they
 * should forget. Unchanged enemies are NOT mentioned — the client keeps them
 * as-is. The remove list replaces an older per-tick U-array that mentioned
 * every still-visible enemy on every tick.
 */
function collectEnemyDeltas(view) {
    const { socket } = view;
    if (!socket.lastSentEnemies)
        socket.lastSentEnemies = new Map();
    const lastEnemies = socket.lastSentEnemies;
    const changed = [];
    const currentEnemyIds = new Set();
    // Finer position grid than the old 1-unit: slow wandering mobs (Bee/Ladybug
    // move ~0.5/tick) otherwise staircase across the 1-unit grid, so their
    // rendered motion visibly lags their (correct) server facing — they look
    // like they're not facing the way they're going. Never coarser than the old
    // 1 unit, so weak connections aren't regressed.
    const enemyPrecision = view.quality === 'slow' ? 1 : 0.5;
    for (let ei = 0; ei < constants_1.enemies.length; ei++) {
        const e = constants_1.enemies[ei];
        const dx = e.x - view.px0;
        const dy = e.y - view.py0;
        if ((dx < 0 ? -dx : dx) >= view.vw || (dy < 0 ? -dy : dy) >= view.vh)
            continue;
        currentEnemyIds.add(e.id);
        const delta = encodeEnemyDelta(e, lastEnemies.get(e.id), enemyPrecision);
        if (delta) {
            changed.push(delta.wire);
            lastEnemies.set(e.id, delta.next);
        }
    }
    const removed = [];
    for (const id of lastEnemies.keys()) {
        if (!currentEnemyIds.has(id)) {
            removed.push(id);
            lastEnemies.delete(id);
        }
    }
    return { changed, removed };
}
/**
 * Diff one enemy against what this client last received.
 *
 * On first sight the full record is sent, minus anything the client can derive:
 * the default maxHealth comes from the mob config for (type, tier), and the
 * default tier is 'common'. `_mobStats` is the same object, cached on the enemy
 * by the collision grids.
 */
function encodeEnemyDelta(e, prev, precision) {
    const next = {
        x: quantize(e.x, precision),
        y: quantize(e.y, precision),
        a: quantize(e.angle, 0.05),
        h: Math.round(e.health),
        H: Math.round(e.maxHealth),
        t: e.type,
        T: e.tier,
    };
    if (!prev) {
        const defaultStats = e._mobStats ?? (0, mobs_1.getMobStats)(e.type, e.tier);
        const defaultMaxH = defaultStats ? Math.round(defaultStats.health) : next.H;
        const wire = { i: e.id, t: e.type, x: next.x, y: next.y };
        if (e.tier !== 'common')
            wire.T = e.tier;
        if (next.a !== 0)
            wire.a = next.a;
        wire.h = next.h;
        if (next.H !== defaultMaxH)
            wire.H = next.H;
        // Pet marker: pets are otherwise indistinguishable from wild mobs on the
        // wire, and the client suppresses boss bars for them. Ownership never
        // changes, so it only needs to ride the first-sight record.
        if (e.ownerId)
            wire.o = 1;
        return { wire: (0, wire_fields_1.packFields)(wire, wire_fields_1.ENEMY_FIELDS), next };
    }
    if (prev.x === next.x && prev.y === next.y && prev.a === next.a &&
        prev.h === next.h && prev.H === next.H && prev.t === next.t && prev.T === next.T) {
        return null;
    }
    const wire = { i: e.id };
    if (prev.x !== next.x)
        wire.x = next.x;
    if (prev.y !== next.y)
        wire.y = next.y;
    if (prev.a !== next.a)
        wire.a = next.a;
    if (prev.h !== next.h)
        wire.h = next.h;
    if (prev.H !== next.H)
        wire.H = next.H;
    if (prev.t !== next.t)
        wire.t = next.t;
    if (prev.T !== next.T)
        wire.T = next.T;
    return { wire: (0, wire_fields_1.packFields)(wire, wire_fields_1.ENEMY_FIELDS), next };
}
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
/**
 * Send one `gameStateUpdate` frame to every authenticated client.
 *
 * `playerIds[i]` and `sockets[i]` are the same connection; the tick loop builds
 * both arrays once and reuses them.
 */
function broadcastGameState(playerIds, sockets, snapshots) {
    for (let i = 0; i < playerIds.length; i++) {
        sendGameStateTo(buildRecipientView(playerIds[i], sockets[i]), snapshots);
    }
}
function sendGameStateTo(view, snapshots) {
    const socket = view.socket;
    // Send every server tick. Local prediction needs frequent authoritative
    // anchors, especially with fast movement where a 15 TPS correction cadence
    // turns small prediction errors into large visible jumps.
    const now = Date.now();
    const fullResync = recoverDroppedChannels(view);
    const playerDeltas = collectPlayerDeltas(view, snapshots);
    const enemyDeltas = collectEnemyDeltas(view);
    // Skip emit entirely when nothing changed this tick — quiet scenes use zero
    // bandwidth instead of an empty-but-still-emitted heartbeat. Never skip a
    // pending resync: even an empty F=1 snapshot is meaningful (it tells the
    // client its remaining enemies are stale).
    if (!fullResync && playerDeltas.changed.length === 0 && enemyDeltas.changed.length === 0 &&
        enemyDeltas.removed.length === 0 && playerDeltas.removed.length === 0) {
        socket.lastUpdateTime = now;
        return;
    }
    // Server tick timestamp. The client maps this into its own clock and
    // timestamps interpolation snapshots with it, so snapshot spacing stays
    // the server's true tick spacing even when packets arrive in bursts
    // (TCP under jitter) — arrival-time stamps compressed the timeline and
    // made entities visibly stutter/rubber-band under latency.
    const gameState = { T: now };
    if (playerDeltas.changed.length > 0)
        gameState.P = playerDeltas.changed;
    if (enemyDeltas.changed.length > 0)
        gameState.E = enemyDeltas.changed;
    if (enemyDeltas.removed.length > 0)
        gameState.R = enemyDeltas.removed.map(wire_fields_1.packId);
    if (playerDeltas.removed.length > 0)
        gameState.D = playerDeltas.removed.map(wire_fields_1.packId);
    if (fullResync)
        gameState.F = 1;
    socket.lastUpdateTime = now;
    const sendStatus = socket.emitWithStatus('gameStateUpdate', gameState);
    if (sendStatus === 2) {
        // uWS discarded the frame — the deltas committed above never reached the
        // client. Schedule a full resync; this also re-arms if the resync frame
        // itself gets dropped.
        socket.needsEntityResync = true;
    }
    else if (fullResync) {
        socket.needsEntityResync = false;
    }
}
