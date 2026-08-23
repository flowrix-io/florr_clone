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
 *   N  changed/new ENTITIES of any kind   R  entities to forget
 *   F  1 = this is a full resync, drop anything not mentioned
 *
 * There is ONE entity stream. Players, mobs and dropped loot used to travel as
 * P/D, E/R and a separate one-shot item event channel respectively — three sets
 * of delta bookkeeping, three removal paths, three viewport culls. They are one
 * table keyed by entity id now, because they were never actually different
 * things on the wire: an entity has a position, and the kind only decides which
 * extra fields it fills in. `K` carries that kind and, being delta-encoded like
 * everything else, costs one byte on first sight and nothing after.
 *
 * Folding items in also fixed them. One-shot events are lost for good when uWS
 * discards a frame under backpressure — invisible loot, or a ghost the client
 * can never clear — which is what the whole `needsItemResync` full-replace path
 * existed to paper over. A delta-encoded item is re-derived from the per-socket
 * baseline every tick, so a dropped frame costs one tick of staleness.
 *
 * Three things make the payload small, and all three are load-bearing:
 *   - recipient-invariant work (face/equip flags, petal positions) is computed
 *     once per tick in buildPlayerSnapshots, not once per recipient × player;
 *   - everything is culled to the recipient's 200%-viewport box;
 *   - unchanged entities are simply not mentioned.
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
exports.bindBroadcastWorld = bindBroadcastWorld;
exports.buildPlayerSnapshots = buildPlayerSnapshots;
exports.broadcastGameState = broadcastGameState;
const constants_1 = require("../constants");
const player_1 = require("../player");
const petals_1 = require("../petals");
const mobs_1 = require("../mobs");
const itemRegistry_1 = require("./itemRegistry");
const squadManager_1 = require("./squadManager");
const utils_1 = require("./utils");
const wire_fields_1 = require("../wire_fields");
const C = __importStar(require("../ecs/components"));
const enemyEncoder_1 = require("../ecs/net/enemyEncoder");
const enemyRegistry_1 = require("./enemyRegistry");
// ---------------------------------------------------------------------------
// The world, injected
// ---------------------------------------------------------------------------
// Enemy deltas are encoded straight from component columns
// (ecs/net/enemyEncoder.ts) — there is no shell array to iterate any more.
// The world arrives through a thunk bound by server.ts, the same shape the
// enemy and item registries use, because importing the runtime from here
// would close a cycle.
let broadcastWorldThunk;
/** Install the ECS world source. Called once, from the composition root. */
function bindBroadcastWorld(getWorld) {
    broadcastWorldThunk = getWorld;
}
function requireBroadcastWorld() {
    if (!broadcastWorldThunk) {
        throw new Error('tickBroadcast: no ECS world installed. server.ts must call '
            + 'bindBroadcastWorld() at startup — without it no enemy can reach the wire.');
    }
    return broadcastWorldThunk();
}
let enemyWireQuery;
let enemyWireQueryWorld;
/**
 * Every live, visible mob. IsDead is excluded even though the same-tick reap
 * normally retires dead entities before a broadcast fires: an off-tick kill
 * (an admin command between ticks) marks the shell dead while the entity waits
 * for the end-of-step drain, and a client that was just told `enemyDestroyed`
 * must not receive fresh deltas for the same id.
 */
function enemyWireEntities(world) {
    if (enemyWireQuery === undefined || enemyWireQueryWorld !== world) {
        enemyWireQuery = world.query([C.IsEnemy, C.Position, C.MobKind, C.Health], [C.IsDead]);
        enemyWireQueryWorld = world;
    }
    return enemyWireQuery;
}
/** Mob-config lookup for the encoder's "omit default maxHealth" rule. */
const enemyEncoderDeps = {
    defaultMaxHealthOf: (typeName, rarityName) => (0, mobs_1.getMobStats)(typeName, rarityName)?.health,
};
// The item channel's drop-recovery list is gone with the channel. Items ride
// the entity stream now, which re-derives them from the per-socket baseline
// every tick — a dropped frame heals itself instead of needing a full replace.
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
 * There is only one entity channel left to recover. Items used to need their
 * own path because their spawns and removals were one-shot events fired from
 * timers and pickup handlers; they ride the delta stream now, so a dropped
 * frame is repaired by the same F=1 resync as everything else.
 *
 * Returns true if the entity channel needs a full resync this tick.
 */
function recoverDroppedChannels(view) {
    const { socket } = view;
    const dropped = socket.droppedEvents;
    if (dropped && dropped.size > 0) {
        if (dropped.has('gameStateUpdate'))
            socket.needsEntityResync = true;
        dropped.clear();
    }
    // A previous frame to this socket was dropped by uWS (backpressure over
    // maxBackpressure), but the delta maps were already committed as if the
    // client received it — any one-shot removal in that frame is otherwise lost
    // forever. Recover by clearing the maps so everything re-sends as
    // first-sight full records, and tag the frame F=1 so the client drops
    // enemies it doesn't mention.
    const fullResync = socket.needsEntityResync === true;
    if (fullResync) {
        // Clearing the baseline is the whole point: F=1 tells the client to drop
        // anything this frame does not mention, which is only safe if the frame
        // re-sends EVERYTHING as a first-sight record. Leaving the baseline
        // populated would send just the tick's changes and make the client
        // delete the rest — and the server, still believing it had delivered
        // them, would never send them again.
        socket.lastSentEntities?.clear();
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
function collectPlayerDeltas(view, snapshots, sent, changed, present) {
    const { selfId } = view;
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
        present.add(p.id);
        let wantPetals = isSelf;
        if (!wantPetals && petalDetailBudget > 0 &&
            Math.abs(p.x - view.px0) <= petalBoxW &&
            Math.abs(p.y - view.py0) <= petalBoxH) {
            wantPetals = true;
            petalDetailBudget--;
        }
        const { petalsOut, petalsSig } = encodePetals(view, snap, wantPetals);
        const next = {
            K: 0 /* WireKind.Player */,
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
        const prev = sent.get(p.id);
        const delta = encodePlayerDelta(p.id, next, prev, isSelf, petalsOut);
        if (delta) {
            // Kind rides the delta only when the client has not seen this entity
            // before (or last saw it as something else, which a recycled id
            // makes possible). One byte on appearance, nothing thereafter.
            if (prev === undefined || prev.K !== 0 /* WireKind.Player */)
                delta.K = 0 /* WireKind.Player */;
            changed.push((0, wire_fields_1.packFields)(delta, wire_fields_1.ENTITY_FIELDS));
            sent.set(p.id, next);
        }
    }
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
    // Returned UNPACKED: the caller attaches `K` on first appearance, then packs.
    return changed ? delta : null;
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
function collectEnemyDeltas(view, sent, changed, present) {
    // Finer position grid than the old 1-unit: slow wandering mobs (Bee/Ladybug
    // move ~0.5/tick) otherwise staircase across the 1-unit grid, so their
    // rendered motion visibly lags their (correct) server facing — they look
    // like they're not facing the way they're going. Never coarser than the old
    // 1 unit, so weak connections aren't regressed.
    const enemyPrecision = view.quality === 'slow' ? 1 : 0.5;
    // Straight off the component columns: the viewport cull reads the Position
    // chunks, and only mobs inside the box pay the encode. The encoder
    // (ecs/net/enemyEncoder.ts) converts interned type/tier ids back to wire
    // strings — the one place that conversion is allowed to happen.
    const world = requireBroadcastWorld();
    enemyWireEntities(world).chunks(chunk => {
        const pos = chunk.cols(C.Position);
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            const dx = pos.x[i] - view.px0;
            const dy = pos.y[i] - view.py0;
            if ((dx < 0 ? -dx : dx) >= view.vw || (dy < 0 ? -dy : dy) >= view.vh)
                continue;
            const entity = entities[i];
            // An off-tick removal (admin command, a disconnecting owner's
            // pets) leaves the entity alive until the next tick's drain; the
            // client has already been told this mob died, so it must not go
            // back on the wire. Skipping it also puts it straight on this
            // frame's removal list, exactly as if the drain had run.
            if ((0, enemyRegistry_1.isPendingEntityRemoval)(entity))
                continue;
            const id = world.externalIdOf(entity);
            if (id === undefined)
                continue;
            present.add(id);
            const prev = sent.get(id);
            const delta = (0, enemyEncoder_1.encodeEnemyDelta)(world, entity, prev, enemyPrecision, enemyEncoderDeps);
            if (delta) {
                if (prev === undefined || prev.K !== 1 /* WireKind.Mob */)
                    delta.wire.K = 1 /* WireKind.Mob */;
                delta.next.K = 1 /* WireKind.Mob */;
                changed.push((0, wire_fields_1.packFields)(delta.wire, wire_fields_1.ENTITY_FIELDS));
                sent.set(id, delta.next);
            }
        }
    });
}
/**
 * Every dropped item this client can see, delta-encoded into the entity stream.
 *
 * This replaces the itemsSpawned / itemSpawned / itemRemoved / itemPickedUp
 * one-shot channel. One-shot was the whole problem: uWS discards a frame once a
 * socket passes its backpressure limit, and a lost spawn left loot the client
 * never rendered while a lost removal left a ghost it could never clear. The
 * `needsItemResync` machinery existed to paper over exactly that.
 *
 * As part of the stream an item is re-derived from the per-socket baseline
 * every tick, so a dropped frame costs one tick of staleness and then heals
 * itself — the same property mobs and players already had.
 *
 * ELIGIBILITY is the cull, on top of the viewport box: a drop is only real for
 * the players it was awarded to, and one already picked up by this player is
 * gone as far as they are concerned.
 */
function collectItemDeltas(view, sent, changed, present) {
    const items = (0, itemRegistry_1.collectWorldItems)(_broadcastItemScratch);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const dx = item.x - view.px0;
        const dy = item.y - view.py0;
        if ((dx < 0 ? -dx : dx) >= view.vw || (dy < 0 ? -dy : dy) >= view.vh)
            continue;
        if (!isItemVisibleTo(view, item))
            continue;
        present.add(item.id);
        const next = {
            K: 2 /* WireKind.Item */,
            x: quantize(item.x, view.precision),
            y: quantize(item.y, view.precision),
            I: wire_fields_1.WIRE_ITEM_TYPES.indexOf(item.type),
            R: item.rarity ? wire_fields_1.WIRE_RARITIES.indexOf(item.rarity) : 0,
            P: item.petalType ?? '',
        };
        const prev = sent.get(item.id);
        const delta = { i: item.id };
        let dirty = false;
        if (!prev || prev.K !== 2 /* WireKind.Item */) {
            delta.K = 2 /* WireKind.Item */;
            dirty = true;
        }
        if (!prev || prev.x !== next.x) {
            delta.x = next.x;
            dirty = true;
        }
        if (!prev || prev.y !== next.y) {
            delta.y = next.y;
            dirty = true;
        }
        if (!prev || prev.I !== next.I) {
            delta.I = next.I;
            dirty = true;
        }
        if (!prev || prev.R !== next.R) {
            delta.R = next.R;
            dirty = true;
        }
        if (!prev || prev.P !== next.P) {
            delta.P = next.P;
            dirty = true;
        }
        if (dirty) {
            changed.push((0, wire_fields_1.packFields)(delta, wire_fields_1.ENTITY_FIELDS));
            sent.set(item.id, next);
        }
    }
}
/** Eligibility + already-picked-up, for this socket and its split halves. */
function isItemVisibleTo(view, item) {
    if (item.eligiblePlayers && item.eligiblePlayers.length > 0) {
        let ok = false;
        for (const pid of item.eligiblePlayers) {
            if ((0, utils_1.getOriginalSocketId)(pid) === view.socket.id) {
                ok = true;
                break;
            }
        }
        if (!ok)
            return false;
    }
    if (item.pickedUpBy) {
        for (const pid of item.pickedUpBy) {
            if ((0, utils_1.getOriginalSocketId)(pid) === view.socket.id)
                return false;
        }
    }
    return true;
}
const _broadcastItemScratch = [];
/** Reused across recipients; cleared per frame. */
const _presentScratch = new Set();
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
    // ONE table, ONE pass, ONE removal list. Players, mobs and drops are all
    // just entities on the wire now; what differs is which fields they fill in.
    if (!socket.lastSentEntities)
        socket.lastSentEntities = new Map();
    const sent = socket.lastSentEntities;
    const changed = [];
    const present = _presentScratch;
    present.clear();
    collectPlayerDeltas(view, snapshots, sent, changed, present);
    collectEnemyDeltas(view, sent, changed, present);
    collectItemDeltas(view, sent, changed, present);
    // Removals: anything this client knew that is no longer present — it left
    // the viewport box, was picked up, or left the world. The sent-state stays
    // authoritative, so a removal lost to backpressure is simply regenerated
    // the next time this loop runs. That is the ghost-entity guard, and it now
    // covers items too, which used to rely on one-shot events.
    const removed = [];
    for (const id of sent.keys()) {
        if (!present.has(id))
            removed.push(id);
    }
    for (let i = 0; i < removed.length; i++)
        sent.delete(removed[i]);
    // Skip emit entirely when nothing changed this tick — quiet scenes use zero
    // bandwidth instead of an empty-but-still-emitted heartbeat. Never skip a
    // pending resync: even an empty F=1 snapshot is meaningful (it tells the
    // client its remaining entities are stale).
    if (!fullResync && changed.length === 0 && removed.length === 0) {
        socket.lastUpdateTime = now;
        return;
    }
    // Server tick timestamp. The client maps this into its own clock and
    // timestamps interpolation snapshots with it, so snapshot spacing stays
    // the server's true tick spacing even when packets arrive in bursts
    // (TCP under jitter) — arrival-time stamps compressed the timeline and
    // made entities visibly stutter/rubber-band under latency.
    const gameState = { T: now };
    if (changed.length > 0)
        gameState.N = changed;
    if (removed.length > 0)
        gameState.R = removed.map(wire_fields_1.packId);
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
