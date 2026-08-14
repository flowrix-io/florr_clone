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

import { Entity, Query, Scheduler, World } from './ecs';
import * as C from './ecs/components';
import {
    DpsLabel,
    InterpTarget,
    IsPlayerRender,
    MobRender,
    RendersAsPet,
    RenderEye,
    RenderRef,
} from './ecs/client/components';
import {
    AI_TYPE_UNKNOWN,
    applyEnemyUpdate,
    applyPlayerUpdate,
    beginDeathAnimation,
    ClientReaper,
    EnemyUpdate,
    enemyKey,
    findPlayerRef,
    forgetEnemy,
    forgetPlayer,
    playerKey,
    playerRefOf,
    setMobDps,
    setMobHealth,
    snapPlayer,
} from './ecs/client/ingest';
import {
    createInterpolationQueries,
    defaultInterpolationConfig,
    easeRateFromAmount,
    InterpolationConfig,
    registerInterpolationSystems,
} from './ecs/client/interpolation';
import { idToRarity, mobTypes } from './ecs/interning';
import { Enemy } from './enemy';
import { getMobStats } from './mobs';
import { Player } from './player';

export type MobTier = Enemy['tier'];

/**
 * Longest a frame gap may count for when easing.
 *
 * A backgrounded tab resumes with a multi-second delta; without this the first
 * frame back applies a full-strength ease and everything on screen teleports.
 * Matches the legacy `easeAmount()` clamp exactly.
 */
const MAX_FRAME_DELTA_MS = 100;

export class ClientWorld {
    readonly world = new World();
    private readonly scheduler = new Scheduler(this.world);
    readonly config: InterpolationConfig = defaultInterpolationConfig();

    /** Every mob, for the render cull pass. */
    readonly mobs: Query;
    /** Every flower, for the render pass, the minimap and the leaderboard. */
    readonly players: Query;

    private reaper: ClientReaper | undefined;
    /** `${type}_${tier}` memoised by interned ids — see mobCacheKey(). */
    private readonly cacheKeys = new Map<number, string>();
    /** Which mob types draw through the flower path; memoised per type_tier. */
    private readonly flowerMobs = new Map<string, boolean>();

    constructor() {
        registerInterpolationSystems(
            this.scheduler,
            createInterpolationQueries(this.world),
            this.config,
            // Indirected so the reaper can be installed after construction
            // (it needs Graphics, which is built later) without the systems
            // capturing an undefined at registration time.
            {
                enemyGone: id => this.reaper?.enemyGone(id),
                playerGone: id => this.reaper?.playerGone(id),
            },
        );
        this.mobs = this.world.query([C.IsEnemy, C.Position]);
        this.players = this.world.query([IsPlayerRender, C.Position]);
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
    collectMobs(out: Entity[]): Entity[] {
        return this.mobs.collect(out);
    }

    /** Same, for flowers. See collectMobs on why this is not chunk iteration. */
    collectPlayers(out: Entity[]): Entity[] {
        return this.players.collect(out);
    }

    /** Install the graphics-side cleanup hook. See ClientReaper. */
    setReaper(reaper: ClientReaper): void {
        this.reaper = reaper;
    }

    /** Track the user's interpolation setting. */
    setInterpolationAmount(amount: number): void {
        this.config.easeRatePerSecond = easeRateFromAmount(amount);
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
    tickFrame(frameDeltaMs: number, nowMs: number, renderNowMs: number): void {
        const dtMs = Math.min(frameDeltaMs, MAX_FRAME_DELTA_MS);
        this.config.snapshotNowMs = renderNowMs;
        this.scheduler.tick(dtMs / 1000, dtMs, nowMs);
    }

    /** Drop every entity; used on scene teardown. */
    clear(): void {
        for (const e of this.world.query([]).collect()) this.world.destroy(e);
    }

    // -------------------------------------------------------------------------
    // Mobs
    // -------------------------------------------------------------------------

    /**
     * Ingest one wire record. `snapTimeMs` is the de-jittered server-mapped
     * timestamp when the caller has one (the delta stream); the bulk handlers
     * pass arrival time.
     */
    ingestEnemy(enemy: Enemy, nowMs: number, snapTimeMs: number): void {
        const update = enemy as unknown as EnemyUpdate;
        // Resolved here rather than in the ECS: only this layer may read
        // mob_configs, and the flower path is what decides whether the mob
        // needs eye state at all.
        update.rendersAsFlower = this.rendersAsFlower(enemy.type, enemy.tier);
        applyEnemyUpdate(this.world, update, nowMs, snapTimeMs);
    }

    private rendersAsFlower(type: string | undefined, tier: string | undefined): boolean {
        if (!type) return false;
        const key = `${type}_${tier ?? 'common'}`;
        const cached = this.flowerMobs.get(key);
        if (cached !== undefined) return cached;
        const stats = getMobStats(type, tier ?? 'common');
        const value = type === 'digger' || !!(stats as any)?.petal_ring;
        this.flowerMobs.set(key, value);
        return value;
    }

    /** Server says this mob is gone. Refused (returns false) mid-death-pop. */
    forgetEnemy(id: string, nowMs: number): boolean {
        return forgetEnemy(this.world, id, nowMs, this.reaper);
    }

    /** Start the death pop. Returns false if it was already running/unknown. */
    beginEnemyDeath(id: string, nowMs: number): boolean {
        return beginDeathAnimation(this.world, id, nowMs);
    }

    enemyEntity(id: string): Entity | undefined {
        return this.world.lookup(enemyKey(id));
    }

    /** Apply an `enemyDamaged` health write; returns the health before it. */
    setEnemyHealth(id: string, health: number): number | undefined {
        return setMobHealth(this.world, id, health);
    }

    setEnemyDps(id: string, dps: number): void {
        setMobDps(this.world, id, dps);
    }

    enemyCount(): number {
        return this.mobs.count();
    }

    /** Wire ids of every mob. Allocates — resync sweeps only, never per frame. */
    enemyIds(): string[] {
        const out: string[] = [];
        for (const e of this.mobs.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined) out.push(key.slice(2));
        }
        return out;
    }

    // --- per-mob reads, for the renderers ------------------------------------

    mobX(e: Entity): number { return this.world.get(e, C.Position, 'x'); }
    mobY(e: Entity): number { return this.world.get(e, C.Position, 'y'); }
    mobAngle(e: Entity): number { return this.world.get(e, C.Angle, 'value'); }
    mobHealth(e: Entity): number { return this.world.get(e, C.Health, 'current'); }
    mobMaxHealth(e: Entity): number { return this.world.get(e, C.Health, 'max'); }
    mobTypeId(e: Entity): number { return this.world.get(e, C.MobKind, 'type'); }
    mobTierId(e: Entity): number { return this.world.get(e, C.MobKind, 'tier'); }

    /**
     * The last AUTHORITATIVE values off the wire, for delta merges.
     *
     * The delta stream omits unchanged fields, and the fallback must be the last
     * server value — never the render-mutated `Position`/`Angle`. Feeding the
     * client's own lagging rendered angle back in as if it were fresh server
     * data makes a mob chase its own tail and wobble after finishing a turn.
     */
    mobTargetX(e: Entity): number { return this.world.get(e, InterpTarget, 'x'); }
    mobTargetY(e: Entity): number { return this.world.get(e, InterpTarget, 'y'); }
    mobTargetAngle(e: Entity): number { return this.world.get(e, InterpTarget, 'angle'); }

    /** Interned id -> name. Returns the table's own string; no allocation. */
    mobType(e: Entity): string {
        return mobTypes.nameOf(this.world.get(e, C.MobKind, 'type'));
    }

    mobTier(e: Entity): MobTier {
        return (idToRarity(this.world.get(e, C.MobKind, 'tier')) ?? 'common') as MobTier;
    }

    isPet(e: Entity): boolean {
        return this.world.has(e, RendersAsPet);
    }

    /**
     * `${type}_${tier}` for the SVG and label caches, memoised by interned id.
     *
     * Building it per mob per frame is a string allocation in the middle of the
     * mob pass — precisely where the measured render optimisations live (see
     * the mob-bake note: a bake was added, measured and deleted; do not put a
     * new per-frame allocation in its place).
     */
    mobCacheKey(e: Entity): string {
        const typeId = this.world.get(e, C.MobKind, 'type') as number;
        const tierId = this.world.get(e, C.MobKind, 'tier') as number;
        const packed = typeId * 32 + tierId;
        let key = this.cacheKeys.get(packed);
        if (key === undefined) {
            key = `${mobTypes.nameOf(typeId)}_${idToRarity(tierId) ?? 'common'}`;
            this.cacheKeys.set(packed, key);
        }
        return key;
    }

    /** Wire id, for effects and caches keyed by it (glitch seeds, damage text). */
    mobId(e: Entity): string {
        return this.world.externalIdOf(e)?.slice(2) ?? '';
    }

    /** Death-pop start, or 0 when not dying. Compare against `Date.now()`. */
    deathAnimationStart(e: Entity): number {
        if (!this.world.has(e, C.DeathAnimation)) return 0;
        return this.world.get(e, C.DeathAnimation, 'startTime');
    }

    mobFlipped(e: Entity): boolean {
        return this.world.get(e, MobRender, 'flipped') === 1;
    }

    /**
     * True when the mob's sprite animation should run at 2x — an actively
     * hunting hostile/neutral. Mobs first seen through the delta stream have no
     * AI type at all and are never accelerated, exactly as before.
     */
    mobAnimatesFast(e: Entity): boolean {
        if (this.world.get(e, MobRender, 'chasing') !== 1) return false;
        const ai = this.world.get(e, MobRender, 'aiType') as number;
        return ai !== AI_TYPE_UNKNOWN && (ai === 1 || ai === 2);
    }

    /** Measured DPS for a target dummy, or undefined if never reported. */
    mobDps(e: Entity): number | undefined {
        if (!this.world.has(e, DpsLabel)) return undefined;
        return this.world.get(e, DpsLabel, 'value');
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
    upsertPlayer(id: string, x: number, y: number, angle: number | undefined, ref: Player): Entity | undefined {
        return applyPlayerUpdate(this.world, { id, x, y, angle }, ref);
    }

    /** Move an existing flower's interpolation target. No-op if unknown. */
    movePlayer(id: string, x: number | undefined, y: number | undefined, angle?: number): void {
        const e = this.world.lookup(playerKey(id));
        if (e === undefined) return;
        if (x !== undefined) this.world.set(e, InterpTarget, 'x', x);
        if (y !== undefined) this.world.set(e, InterpTarget, 'y', y);
        if (angle !== undefined) this.world.set(e, C.Angle, 'value', angle);
    }

    /**
     * Move a flower NOW rather than easing to it — teleports, portals, respawn.
     *
     * Sets the target and tags the entity; the snap system cuts position (and
     * the petal anchor) onto it on the next tick. Writing position directly
     * here would be undone by the same tick's ease.
     */
    teleportPlayer(id: string, x: number, y: number): void {
        this.movePlayer(id, x, y);
        snapPlayer(this.world, id);
    }

    /** Re-snap on the next tick without moving the target (respawn). */
    snapPlayer(id: string): void {
        snapPlayer(this.world, id);
    }

    removePlayer(id: string): void {
        forgetPlayer(this.world, id, this.reaper);
    }

    /** Drop every flower (a `currentPlayers` full replace). */
    clearPlayers(): void {
        for (const e of this.players.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined) this.reaper?.playerGone(key.slice(2));
            this.world.destroy(e);
        }
    }

    playerEntity(id: string): Entity | undefined {
        return this.world.lookup(playerKey(id));
    }

    hasPlayer(id: string): boolean {
        return this.world.lookup(playerKey(id)) !== undefined;
    }

    /** The plain `Player` object for a socket id. */
    player(id: string): Player | undefined {
        return findPlayerRef(this.world, id) as Player | undefined;
    }

    /** The plain `Player` object behind an entity handle. */
    playerOf(e: Entity): Player | undefined {
        return playerRefOf(this.world, e) as Player | undefined;
    }

    playerCount(): number {
        return this.players.count();
    }

    /** Socket ids of every flower. Allocates — resync sweeps, not per frame. */
    playerIds(): string[] {
        const out: string[] = [];
        for (const e of this.players.collect()) {
            const key = this.world.externalIdOf(e);
            if (key !== undefined) out.push(key.slice(2));
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

    playerX(e: Entity): number { return this.world.get(e, C.Position, 'x'); }
    playerY(e: Entity): number { return this.world.get(e, C.Position, 'y'); }
    playerAngle(e: Entity): number { return this.world.get(e, C.Angle, 'value'); }

    /** Socket id of a flower entity. */
    playerId(e: Entity): string {
        return this.world.externalIdOf(e)?.slice(2) ?? '';
    }

    /**
     * The flower's DRAWN position from this frame, which is what its absolute
     * server-sent petal positions are measured against. Using the server
     * position instead makes petals visibly lead or lag their owner.
     */
    renderRefX(e: Entity): number { return this.world.get(e, RenderRef, 'x'); }
    renderRefY(e: Entity): number { return this.world.get(e, RenderRef, 'y'); }

    // --- eye state (storage only; the renderers do the easing) ---------------

    hasEye(e: Entity): boolean { return this.world.has(e, RenderEye); }
    eyeX(e: Entity): number { return this.world.get(e, RenderEye, 'x'); }
    eyeY(e: Entity): number { return this.world.get(e, RenderEye, 'y'); }
    eyeInitialised(e: Entity): boolean { return this.world.get(e, RenderEye, 'init') === 1; }

    setEye(e: Entity, x: number, y: number): void {
        this.world.write(e, RenderEye, { x, y, init: 1 });
    }
}
