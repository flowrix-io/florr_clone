"use strict";
/**
 * The client's entity store.
 *
 * This replaces `Game.players` and `Game.enemies` — the two `Map<string, T>`
 * stores the client used to keep — with a single ECS World. It is the ONLY
 * place client-side entity state lives; there is no second copy to drift out of
 * sync, which is the failure this rewrite exists to remove.
 *
 * Layering:
 *
 *   src/ecs/**            isomorphic, no DOM, no game config. Components,
 *                         ingestion and the interpolation systems.
 *   src/client_world.ts   this file. Knows about mob configs and the `Player`
 *                         object, wires the reaper, owns the frame tick.
 *   src/net/**            decodes the wire and calls the ingest wrappers here.
 *   src/graphics/**       reads components. Never writes them except for
 *                         cosmetic eye state.
 *
 * WHAT THE ECS OWNS, AND WHAT IT DOES NOT
 * ---------------------------------------
 * Mobs are fully decomposed: nothing about a mob survives outside the world, so
 * `Enemy` is now purely a transient wire record.
 *
 * Flowers are split. Position, facing, the eased eye and the petal-ring anchor
 * are components; the remaining ~45 fields (name, health, loadout, inventory,
 * cosmetics, maze/PVP state) stay on the plain `Player` object held in
 * `LegacyPlayer.ref`, because no system iterates them and every UI panel in the
 * game takes a `Player`. The fields that DID move have been deleted from the
 * `Player` interface, so a renderer cannot read a stale copy of one — that
 * deletion, not this comment, is what makes the split safe.
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
exports.ClientWorld = void 0;
const ecs_1 = require("./ecs");
const C = __importStar(require("./ecs/components"));
const components_1 = require("./ecs/client/components");
const ingest_1 = require("./ecs/client/ingest");
const interpolation_1 = require("./ecs/client/interpolation");
const interning_1 = require("./ecs/interning");
const mobs_1 = require("./mobs");
/**
 * Longest a frame gap may count for when easing.
 *
 * A backgrounded tab resumes with a multi-second delta; without this the first
 * frame back applies a full-strength ease and everything on screen teleports.
 * Matches the legacy `easeAmount()` clamp exactly.
 */
const MAX_FRAME_DELTA_MS = 100;
class ClientWorld {
    constructor() {
        this.world = new ecs_1.World();
        this.scheduler = new ecs_1.Scheduler(this.world);
        this.config = (0, interpolation_1.defaultInterpolationConfig)();
        /** `${type}_${tier}` memoised by interned ids — see mobCacheKey(). */
        this.cacheKeys = new Map();
        /** Which mob types draw through the flower path; memoised per type_tier. */
        this.flowerMobs = new Map();
        (0, interpolation_1.registerInterpolationSystems)(this.scheduler, (0, interpolation_1.createInterpolationQueries)(this.world), this.config, 
        // Indirected so the reaper can be installed after construction
        // (it needs Graphics, which is built later) without the systems
        // capturing an undefined at registration time.
        {
            enemyGone: id => this.reaper?.enemyGone(id),
            playerGone: id => this.reaper?.playerGone(id),
        });
        this.mobs = this.world.query([C.IsEnemy, C.Position]);
        this.players = this.world.query([components_1.IsPlayerRender, C.Position]);
    }
    /**
     * Snapshot every mob into `out` and return it.
     *
     * Handles, not chunk rows: a handle stays valid across an archetype move,
     * and `Query.chunks` hands back ONE reused view object, so nesting two
     * iterations (a renderer that walks mobs and, per mob, looks something else
     * up) would silently corrupt the outer walk. Pass a caller-owned scratch
     * array so the snapshot costs nothing per frame and two callers can never
     * share one buffer.
     */
    collectMobs(out) {
        return this.mobs.collect(out);
    }
    /** Same, for flowers. See collectMobs on why this is not chunk iteration. */
    collectPlayers(out) {
        return this.players.collect(out);
    }
    /** Install the graphics-side cleanup hook. See ClientReaper. */
    setReaper(reaper) {
        this.reaper = reaper;
    }
    /** Track the user's interpolation setting. */
    setInterpolationAmount(amount) {
        this.config.easeRatePerSecond = (0, interpolation_1.easeRateFromAmount)(amount);
    }
    /**
     * Advance render interpolation by one frame.
     *
     * `frameDeltaMs` is wall-clock frame time; `nowMs` is `Date.now()` (the
     * death-animation clock, shared with `Graphics.frameTimestamp`);
     * `renderNowMs` is `performance.now()` (the snapshot-playback clock). The
     * two clocks are ~1.7e12 ms apart and are never compared with each other —
     * see the header of ecs/client/ingest.ts.
     */
    tickFrame(frameDeltaMs, nowMs, renderNowMs) {
        const dtMs = Math.min(frameDeltaMs, MAX_FRAME_DELTA_MS);
        this.config.snapshotNowMs = renderNowMs;
        this.scheduler.tick(dtMs / 1000, dtMs, nowMs);
    }
    /** Drop every entity; used on scene teardown. */
    clear() {
        for (const e of this.world.query([]).collect())
            this.world.destroy(e);
    }
    // -------------------------------------------------------------------------
    // Mobs
    // -------------------------------------------------------------------------
    /**
     * Ingest one wire record. `snapTimeMs` is the de-jittered server-mapped
     * timestamp when the caller has one (the delta stream); the bulk handlers
     * pass arrival time.
     */
    ingestEnemy(enemy, nowMs, snapTimeMs) {
        const update = enemy;
        // Resolved here rather than in the ECS: only this layer may read
        // mob_configs, and the flower path is what decides whether the mob
        // needs eye state at all.
        update.rendersAsFlower = this.rendersAsFlower(enemy.type, enemy.tier);
        (0, ingest_1.applyEnemyUpdate)(this.world, update, nowMs, snapTimeMs);
    }
    rendersAsFlower(type, tier) {
        if (!type)
            return false;
        const key = `${type}_${tier ?? 'common'}`;
        const cached = this.flowerMobs.get(key);
        if (cached !== undefined)
            return cached;
        const stats = (0, mobs_1.getMobStats)(type, tier ?? 'common');
        const value = type === 'digger' || !!stats?.petal_ring;
        this.flowerMobs.set(key, value);
        return value;
    }
    /** Server says this mob is gone. Refused (returns false) mid-death-pop. */
    forgetEnemy(id, nowMs) {
        return (0, ingest_1.forgetEnemy)(this.world, id, nowMs, this.reaper);
    }
    /** Start the death pop. Returns false if it was already running/unknown. */
    beginEnemyDeath(id, nowMs) {
        return (0, ingest_1.beginDeathAnimation)(this.world, id, nowMs);
    }
    enemyEntity(id) {
        return this.world.lookup((0, ingest_1.enemyKey)(id));
    }
    /** Apply an `enemyDamaged` health write; returns the health before it. */
    setEnemyHealth(id, health) {
        return (0, ingest_1.setMobHealth)(this.world, id, health);
    }
    setEnemyDps(id, dps) {
        (0, ingest_1.setMobDps)(this.world, id, dps);
    }
    enemyCount() {
        return this.mobs.count();
    }
    /** Wire ids of every mob. Allocates — resync sweeps only, never per frame. */
    enemyIds() {
        const out = [];
        for (const e of this.mobs.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined)
                out.push(key.slice(2));
        }
        return out;
    }
    // --- per-mob reads, for the renderers ------------------------------------
    mobX(e) { return this.world.get(e, C.Position, 'x'); }
    mobY(e) { return this.world.get(e, C.Position, 'y'); }
    mobAngle(e) { return this.world.get(e, C.Angle, 'value'); }
    mobHealth(e) { return this.world.get(e, C.Health, 'current'); }
    mobMaxHealth(e) { return this.world.get(e, C.Health, 'max'); }
    mobTypeId(e) { return this.world.get(e, C.MobKind, 'type'); }
    mobTierId(e) { return this.world.get(e, C.MobKind, 'tier'); }
    /**
     * The last AUTHORITATIVE values off the wire, for delta merges.
     *
     * The delta stream omits unchanged fields, and the fallback must be the last
     * server value — never the render-mutated `Position`/`Angle`. Feeding the
     * client's own lagging rendered angle back in as if it were fresh server
     * data makes a mob chase its own tail and wobble after finishing a turn.
     */
    mobTargetX(e) { return this.world.get(e, components_1.InterpTarget, 'x'); }
    mobTargetY(e) { return this.world.get(e, components_1.InterpTarget, 'y'); }
    mobTargetAngle(e) { return this.world.get(e, components_1.InterpTarget, 'angle'); }
    /** Interned id -> name. Returns the table's own string; no allocation. */
    mobType(e) {
        return interning_1.mobTypes.nameOf(this.world.get(e, C.MobKind, 'type'));
    }
    mobTier(e) {
        return ((0, interning_1.idToRarity)(this.world.get(e, C.MobKind, 'tier')) ?? 'common');
    }
    isPet(e) {
        return this.world.has(e, components_1.RendersAsPet);
    }
    /**
     * `${type}_${tier}` for the SVG and label caches, memoised by interned id.
     *
     * Building it per mob per frame is a string allocation in the middle of the
     * mob pass — precisely where the measured render optimisations live (see
     * the mob-bake note: a bake was added, measured and deleted; do not put a
     * new per-frame allocation in its place).
     */
    mobCacheKey(e) {
        const typeId = this.world.get(e, C.MobKind, 'type');
        const tierId = this.world.get(e, C.MobKind, 'tier');
        const packed = typeId * 32 + tierId;
        let key = this.cacheKeys.get(packed);
        if (key === undefined) {
            key = `${interning_1.mobTypes.nameOf(typeId)}_${(0, interning_1.idToRarity)(tierId) ?? 'common'}`;
            this.cacheKeys.set(packed, key);
        }
        return key;
    }
    /** Wire id, for effects and caches keyed by it (glitch seeds, damage text). */
    mobId(e) {
        return this.world.externalIdOf(e)?.slice(2) ?? '';
    }
    /** Death-pop start, or 0 when not dying. Compare against `Date.now()`. */
    deathAnimationStart(e) {
        if (!this.world.has(e, C.DeathAnimation))
            return 0;
        return this.world.get(e, C.DeathAnimation, 'startTime');
    }
    mobFlipped(e) {
        return this.world.get(e, components_1.MobRender, 'flipped') === 1;
    }
    /**
     * True when the mob's sprite animation should run at 2x — an actively
     * hunting hostile/neutral. Mobs first seen through the delta stream have no
     * AI type at all and are never accelerated, exactly as before.
     */
    mobAnimatesFast(e) {
        if (this.world.get(e, components_1.MobRender, 'chasing') !== 1)
            return false;
        const ai = this.world.get(e, components_1.MobRender, 'aiType');
        return ai !== ingest_1.AI_TYPE_UNKNOWN && (ai === 1 || ai === 2);
    }
    /** Measured DPS for a target dummy, or undefined if never reported. */
    mobDps(e) {
        if (!this.world.has(e, components_1.DpsLabel))
            return undefined;
        return this.world.get(e, components_1.DpsLabel, 'value');
    }
    // -------------------------------------------------------------------------
    // Flowers
    // -------------------------------------------------------------------------
    /**
     * Create or update a flower.
     *
     * `ref` is only consumed on creation; an existing flower keeps the object it
     * already has so every handler holding a reference to it stays valid.
     */
    upsertPlayer(id, x, y, angle, ref) {
        return (0, ingest_1.applyPlayerUpdate)(this.world, { id, x, y, angle }, ref);
    }
    /** Move an existing flower's interpolation target. No-op if unknown. */
    movePlayer(id, x, y, angle) {
        const e = this.world.lookup((0, ingest_1.playerKey)(id));
        if (e === undefined)
            return;
        if (x !== undefined)
            this.world.set(e, components_1.InterpTarget, 'x', x);
        if (y !== undefined)
            this.world.set(e, components_1.InterpTarget, 'y', y);
        if (angle !== undefined)
            this.world.set(e, C.Angle, 'value', angle);
    }
    /**
     * Move a flower NOW rather than easing to it — teleports, portals, respawn.
     *
     * Sets the target and tags the entity; the snap system cuts position (and
     * the petal anchor) onto it on the next tick. Writing position directly
     * here would be undone by the same tick's ease.
     */
    teleportPlayer(id, x, y) {
        this.movePlayer(id, x, y);
        (0, ingest_1.snapPlayer)(this.world, id);
    }
    /** Re-snap on the next tick without moving the target (respawn). */
    snapPlayer(id) {
        (0, ingest_1.snapPlayer)(this.world, id);
    }
    removePlayer(id) {
        (0, ingest_1.forgetPlayer)(this.world, id, this.reaper);
    }
    /** Drop every flower (a `currentPlayers` full replace). */
    clearPlayers() {
        for (const e of this.players.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined)
                this.reaper?.playerGone(key.slice(2));
            this.world.destroy(e);
        }
    }
    playerEntity(id) {
        return this.world.lookup((0, ingest_1.playerKey)(id));
    }
    hasPlayer(id) {
        return this.world.lookup((0, ingest_1.playerKey)(id)) !== undefined;
    }
    /** The plain `Player` object for a socket id. */
    player(id) {
        return (0, ingest_1.findPlayerRef)(this.world, id);
    }
    /** The plain `Player` object behind an entity handle. */
    playerOf(e) {
        return (0, ingest_1.playerRefOf)(this.world, e);
    }
    playerCount() {
        return this.players.count();
    }
    /** Socket ids of every flower. Allocates — resync sweeps, not per frame. */
    playerIds() {
        const out = [];
        for (const e of this.players.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined)
                out.push(key.slice(2));
        }
        return out;
    }
    /*
     * NOTE ON "WHICH HALF AM I DRIVING".
     *
     * After a splitter petal this client owns two flowers and drives one. That
     * fact lives in exactly ONE place — `Game.activePlayerId`, flipped by the
     * server's `playerSwitched` — and everything that needs it (camera, death
     * screen, loadout bar, prediction) resolves the entity by that id.
     *
     * There is deliberately no tag mirroring it here. An unread second copy of
     * a fact is how this rewrite has been bitten twice: it can only be right by
     * accident, and the next reader would trust it.
     */
    // --- per-flower reads, for the renderers ---------------------------------
    playerX(e) { return this.world.get(e, C.Position, 'x'); }
    playerY(e) { return this.world.get(e, C.Position, 'y'); }
    playerAngle(e) { return this.world.get(e, C.Angle, 'value'); }
    /** Socket id of a flower entity. */
    playerId(e) {
        return this.world.externalIdOf(e)?.slice(2) ?? '';
    }
    /**
     * The flower's DRAWN position from this frame, which is what its absolute
     * server-sent petal positions are measured against. Using the server
     * position instead makes petals visibly lead or lag their owner.
     */
    renderRefX(e) { return this.world.get(e, components_1.RenderRef, 'x'); }
    renderRefY(e) { return this.world.get(e, components_1.RenderRef, 'y'); }
    // --- eye state (storage only; the renderers do the easing) ---------------
    hasEye(e) { return this.world.has(e, components_1.RenderEye); }
    eyeX(e) { return this.world.get(e, components_1.RenderEye, 'x'); }
    eyeY(e) { return this.world.get(e, components_1.RenderEye, 'y'); }
    eyeInitialised(e) { return this.world.get(e, components_1.RenderEye, 'init') === 1; }
    setEye(e, x, y) {
        this.world.write(e, components_1.RenderEye, { x, y, init: 1 });
    }
}
exports.ClientWorld = ClientWorld;
