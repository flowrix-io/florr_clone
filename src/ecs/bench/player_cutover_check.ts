/**
 * The oracle for the player-movement cutover.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * On the projectile cutover, all four gates passed while the feature was
 * completely broken: damage was written to ECS components outside the
 * syncToEcs/syncFromEcs window, so the next tick's push overwrote it and every
 * hit was silently discarded. Nothing failed. Typechecking, the self-tests and
 * the tick harness are all structurally incapable of noticing that class of bug,
 * because each of them only ever exercises ONE side of the boundary.
 *
 * The player cutover has exactly the same shape and two known traps:
 *
 *   1. PlayerInput used to be written once, at import. Turning the movement
 *      system on without pushing it per tick would have made every flower move
 *      forever on the inputs sampled during its first tick.
 *   2. Position is pushed IN (so legacy knockback, teleports and respawns are
 *      authoritative) and pulled OUT (so the integration is). Get the order or
 *      the placement wrong and one direction silently wins.
 *
 * So this drives the REAL pipeline — the exported `syncPlayersToEcs`,
 * `runtime.tickPlayers`, `syncPlayersFromEcs`, in the real order — against a
 * verbatim copy of the legacy movement code it replaced, and asserts EXACT
 * equality of every field the window owns. Exact, not approximate: the two must
 * be the same arithmetic, and a tolerance would hide precisely the kind of slow
 * divergence that shows up as rubber-banding a week later.
 *
 * The legacy copy below is the oracle. It is deliberately duplicated rather than
 * imported: importing playerState.ts binds port 3000 at module scope, and the
 * function it came from has been deleted from that file anyway.
 */

import { MAX_SPEED, PLAYER_SIZE, stepPlayerMovement } from '../../constants';
import { ServerPlayer } from '../../player';
import { createEcsRuntime, EcsRuntime } from '../../server/ecsRuntime';
import {
    configureCutover,
    resetSyncState,
    syncPlayersFromEcs,
    syncPlayersToEcs,
} from '../../server/ecsSync';
import * as C from '../components';
import { assertNoServerBooted } from './tick_harness';

// ---------------------------------------------------------------------------
// The oracle: the movement half of updatePlayerState, exactly as it was
// ---------------------------------------------------------------------------

/** The mutable slice of a flower the movement window owns. */
interface MoveState {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    angle: number;
    speedFactor: number;
}

/**
 * `computeTargetVelocity` + the `stepPlayerMovement` call that followed it,
 * copied unchanged from server/playerState.ts before the cutover.
 *
 * Do not "tidy" this. Its value is that it is a byte-for-byte transcription of
 * the behaviour being replaced; every simplification makes it a weaker oracle.
 */
function legacyMove(
    state: MoveState,
    inputs: ServerPlayer['inputs'],
    speedBoost: number,
    sizeMultiplier: number,
    deltaTime: number,
): void {
    let targetVelocityX = 0;
    let targetVelocityY = 0;

    let speedFactor = speedBoost;
    if (!(speedFactor >= 0)) speedFactor = 1;   // NaN / negative -> 1
    if (speedFactor > 8) speedFactor = 8;
    state.speedFactor = speedFactor;

    if (inputs.useMouse &&
        inputs.mouseDirectionX !== undefined &&
        inputs.mouseDirectionY !== undefined &&
        inputs.mouseSpeedMultiplier !== undefined) {
        const mouseMult = Math.min(1.5, Math.max(0, inputs.mouseSpeedMultiplier)) || 0;
        const speed = MAX_SPEED * speedFactor * mouseMult;
        targetVelocityX = inputs.mouseDirectionX * speed;
        targetVelocityY = inputs.mouseDirectionY * speed;
        state.angle = Math.atan2(inputs.mouseDirectionY, inputs.mouseDirectionX);
    } else if (inputs.keys) {
        if (inputs.keys.includes('ArrowLeft') || inputs.keys.includes('a')) targetVelocityX -= 1;
        if (inputs.keys.includes('ArrowRight') || inputs.keys.includes('d')) targetVelocityX += 1;
        if (inputs.keys.includes('ArrowUp') || inputs.keys.includes('w')) targetVelocityY -= 1;
        if (inputs.keys.includes('ArrowDown') || inputs.keys.includes('s')) targetVelocityY += 1;

        if (targetVelocityX !== 0 && targetVelocityY !== 0) {
            const length = Math.sqrt(targetVelocityX * targetVelocityX + targetVelocityY * targetVelocityY);
            targetVelocityX /= length;
            targetVelocityY /= length;
        }

        const speed = MAX_SPEED * speedFactor;
        targetVelocityX *= speed;
        targetVelocityY *= speed;

        if (targetVelocityX !== 0 || targetVelocityY !== 0) {
            state.angle = Math.atan2(targetVelocityY, targetVelocityX);
        }
    }

    const effectivePlayerSize = PLAYER_SIZE * (sizeMultiplier ?? 1.0);
    const moved = stepPlayerMovement(
        { x: state.x, y: state.y, vx: state.velocityX, vy: state.velocityY },
        targetVelocityX, targetVelocityY, deltaTime, effectivePlayerSize,
    );
    state.velocityX = moved.vx;
    state.velocityY = moved.vy;
    state.x = moved.x;
    state.y = moved.y;
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where the test flowers stand.
 *
 * `maze` is not decoration: the maze sits at (200000, 200000), which is past
 * f32 precision, and the whole reason Position is f64 is that accumulating
 * per-tick movement out there drifts and jitters. A cutover check that only ran
 * near the origin would pass with a narrowed column.
 */
const START_REGIONS = [
    { name: 'origin', x: 0, y: 0 },
    { name: 'mid-map', x: 4200, y: -3100 },
    { name: 'maze', x: 200000, y: 200000 },
];

/** How a given flower drives itself, so every input branch is covered. */
type Style = 'mouse' | 'keys' | 'idle' | 'malformed-mouse' | 'huge-boost';

const STYLES: Style[] = ['mouse', 'keys', 'idle', 'malformed-mouse', 'huge-boost'];

interface Subject {
    player: ServerPlayer;
    reference: MoveState;
    style: Style;
    /** The petal/effect multiplier the injected `speedBoostOf` returns. */
    multiplier: number;
    sizeMultiplier: number;
}

/**
 * A ServerPlayer with only the fields the movement window reads.
 *
 * Typed through `unknown` because ServerPlayer carries ~70 fields covering
 * progression, inventory, cosmetics and networking, none of which any part of
 * this pipeline touches — filling them in would suggest they mattered.
 */
function makePlayer(id: string, x: number, y: number, sizeMultiplier: number): ServerPlayer {
    return {
        id,
        name: id,
        x,
        y,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: 100,
        maxHealth: 100,
        damage: 10,
        inventory: [],
        loadout: [],
        level: 1,
        xp: 0,
        xpToNextLevel: 100,
        speed_boost: 1,
        sizeMultiplier,
        inputs: { keys: [], useMouse: false },
    } as unknown as ServerPlayer;
}

/**
 * Drive one flower's inputs for this tick.
 *
 * Humans REPLACE `player.inputs` with a fresh object (session.ts) while bots
 * MUTATE the existing one in place (botManager's driveMove), so the fixture does
 * both: bot ids mutate, human ids replace. If the push ever went back to reading
 * inputs once at import, the mutating half would freeze and the replacing half
 * would keep an entire stale object — and only driving both shows it.
 */
function driveInputs(subject: Subject, tick: number, rng: () => number): void {
    const { player, style } = subject;
    const mutateInPlace = player.id.startsWith('bot_');

    let next: ServerPlayer['inputs'];
    switch (style) {
        case 'idle':
            next = { keys: [], useMouse: false };
            break;
        case 'keys': {
            const keys: string[] = [];
            if (rng() < 0.5) keys.push(rng() < 0.5 ? 'a' : 'ArrowLeft');
            if (rng() < 0.5) keys.push(rng() < 0.5 ? 'd' : 'ArrowRight');
            if (rng() < 0.5) keys.push('w');
            if (rng() < 0.5) keys.push('s');
            next = { keys, useMouse: false };
            break;
        }
        case 'malformed-mouse':
            // useMouse set but the direction fields absent: legacy fell THROUGH
            // to the keyboard branch, and every few ticks the multiplier is a
            // hostile value so the clamps are exercised too.
            next = tick % 3 === 0
                ? { keys: ['w'], useMouse: true }
                : {
                    keys: [],
                    useMouse: true,
                    mouseDirectionX: 1,
                    mouseDirectionY: 0,
                    mouseSpeedMultiplier: tick % 5 === 0 ? NaN : 40,
                };
            break;
        case 'huge-boost':
        case 'mouse':
        default: {
            const angle = rng() * Math.PI * 2;
            next = {
                keys: [],
                useMouse: true,
                mouseDirectionX: Math.cos(angle),
                mouseDirectionY: Math.sin(angle),
                mouseSpeedMultiplier: 0.15 + rng() * 0.85,
            };
            break;
        }
    }

    if (mutateInPlace) {
        const inputs = player.inputs;
        inputs.keys = next.keys;
        inputs.useMouse = next.useMouse;
        inputs.mouseDirectionX = next.mouseDirectionX;
        inputs.mouseDirectionY = next.mouseDirectionY;
        inputs.mouseSpeedMultiplier = next.mouseSpeedMultiplier;
    } else {
        player.inputs = next;
    }
}

function buildSubjects(): Subject[] {
    const rng = mulberry32(0x51D0C0);
    const subjects: Subject[] = [];

    let n = 0;
    for (const region of START_REGIONS) {
        for (const style of STYLES) {
            for (const isBot of [false, true]) {
                const id = `${isBot ? 'bot_' : 'sock-'}${region.name}-${style}-${n++}`;
                // Spread the flowers so the fixture is not one pile, and vary
                // the size multiplier because it decides the substep count
                // inside stepPlayerMovement.
                const x = region.x + (rng() - 0.5) * 800;
                const y = region.y + (rng() - 0.5) * 800;
                const sizeMultiplier = 0.5 + rng() * 2.5;
                const player = makePlayer(id, x, y, sizeMultiplier);
                subjects.push({
                    player,
                    reference: {
                        x, y, velocityX: 0, velocityY: 0, angle: 0, speedFactor: 1,
                    },
                    style,
                    // 'huge-boost' deliberately blows past the 8x clamp; the
                    // clamp lives in the ECS system now and must still bite.
                    multiplier: style === 'huge-boost' ? 30 : 0.6 + rng() * 1.2,
                    sizeMultiplier,
                });
            }
        }
    }
    return subjects;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const TICKS = 400;
const DT = 1 / 30;

/**
 * A tiny stub runtime. Only `tickPlayers` is exercised, but createEcsRuntime
 * builds every scheduler, so the hooks have to be callable.
 */
function makeRuntime(): EcsRuntime {
    return createEcsRuntime({
        lookupPlayer: () => undefined,
        // This bench drives the schedulers directly; the post-movement pipeline
        // is the game\'s, not the bench\'s.
        runPlayerPipeline: () => { /* not exercised here */ },
        runPetalBehaviours: () => { /* not exercised here */ },
        creditDamage: () => { /* not reachable from the player scheduler */ },
        onEnemyDamaged: () => { /* ditto */ },
        onEnemyKilled: () => { /* ditto */ },
        onPetOutOfView: () => { /* pets are not under test here */ },
        isNearAnyPlayer: () => true,
        allocateProjectileNetId: () => 1,
        resolvePlayerEntity: () => undefined,
        playerRadiusOf: () => 25,
        damageMultiplierOf: () => 1,
        onPlayerHit: () => true,
        emitEnemyDamaged: () => { /* ditto */ },
        onProjectileKill: () => { /* ditto */ },
        onGroundEffectExpired: () => { /* ditto */ },
        onEnemyPoisonDamaged: () => { /* ditto */ },
        onPoisonKill: () => { /* ditto */ },
        tickPlayerPoison: () => { /* ditto */ },
        onPlayerPoisonLapsed: () => { /* ditto */ },
        isDespawnProtectedAt: () => false,
        isItemOutOfBounds: () => false,
        onSpawnEscort: () => { /* ditto */ },
        onSpawnWaves: () => { /* ditto */ },
        onWorldItemRemoved: () => { /* ditto */ },
        onMobDespawn: () => { /* ditto */ },
        onReapEnemy: () => { /* ditto */ },
    });
}

export function runPlayerCutoverCheck(): string[] {
    assertNoServerBooted();
    const failures: string[] = [];
    const fail = (message: string) => {
        // One line per distinct failure; a divergence usually hits every flower
        // on every subsequent tick, and 12000 identical lines help nobody.
        if (failures.length < 20) failures.push(message);
    };

    resetSyncState();
    const runtime = makeRuntime();

    // --- the cutover switch itself ---------------------------------------
    // configureCutover is what decides who owns movement. Assert the state it
    // leaves behind, because "the system is registered but disabled" is a
    // silent no-op that every other gate reports as healthy.
    configureCutover(runtime);
    if (runtime.playerScheduler.names().indexOf('playerMovement') < 0) {
        fail('playerMovement is not registered on the player scheduler — it would '
            + 'run inside moveEnemies, a tick after the legacy code it replaced');
    }
    if (runtime.scheduler.names().indexOf('playerMovement') >= 0) {
        fail('playerMovement is still on the mob scheduler');
    }
    // Re-disabling it would make the whole cutover a no-op AND leave nothing
    // moving players at all, since the legacy path has been deleted.
    if (!runtime.playerScheduler.setEnabled('playerMovement', true)) {
        fail('playerMovement could not be re-enabled — it is gone');
    }
    // MOVEMENT is what is under test here, for arbitrary modifier values —
    // this oracle sweeps continuous random speed/size multipliers that no real
    // loadout can produce. So the modifier DERIVATION system is switched off
    // and the component is driven directly below, exactly the role the old
    // speedBoostOf push played. The derivation itself is exercised by the live
    // game and the self-tests.
    if (!runtime.playerScheduler.setEnabled('playerModifiers', false)) {
        fail('playerModifiers is gone from the player scheduler');
    }

    const subjects = buildSubjects();
    const players: Record<string, ServerPlayer> = {};
    for (const s of subjects) players[s.player.id] = s.player;

    const multiplierOf = new Map<string, number>();
    for (const s of subjects) multiplierOf.set(s.player.id, s.multiplier);

    // Stands in for `player.speed_boost * getSpeedMultiplier(player)`. The
    // derivation system is disabled above, so the bench writes this straight
    // into PlayerModifiers each tick — the modifier CHANNEL, with arbitrary
    // values the derivation could never produce from real config.
    const speedBoostOf = (player: ServerPlayer) =>
        player.speed_boost * (multiplierOf.get(player.id) ?? 1);
    const writeModifiers = (now: number) => {
        void now;
        for (const s of subjects) {
            const entity = runtime.world.lookup(s.player.id);
            if (entity === undefined) continue;
            runtime.world.set(entity, C.PlayerModifiers, 'speedBoost', speedBoostOf(s.player));
            runtime.world.set(entity, C.PlayerModifiers, 'sizeMultiplier', s.sizeMultiplier);
        }
    };

    const rng = mulberry32(0xBEEF01);
    const now0 = 1_000_000;

    // The position each flower entered the window with. updatePlayerState reads
    // player.x/y throughout, and it must still be seeing this.
    const previousX = new Map<string, number>();
    const previousY = new Map<string, number>();

    for (let tick = 0; tick < TICKS; tick++) {
        const now = now0 + tick * (1000 / 30);

        for (const s of subjects) driveInputs(s, tick, rng);
        for (const s of subjects) {
            previousX.set(s.player.id, s.player.x);
            previousY.set(s.player.id, s.player.y);
        }

        // The real window, in the real order (modifiers driven directly; see
        // writeModifiers above).
        syncPlayersToEcs(runtime.world, players, now);
        writeModifiers(now);
        runtime.tickPlayers(DT, DT * 1000, now);
        syncPlayersFromEcs(runtime.world, players);

        for (const s of subjects) {
            if (s.player.isDead) continue;
            legacyMove(
                s.reference,
                s.player.inputs,
                speedBoostOf(s.player),
                s.sizeMultiplier,
                DT,
            );
            const p = s.player;
            const r = s.reference;
            // The window stages its position in movedX/movedY rather than
            // committing it, because `player.x/y` must still read as the
            // PREVIOUS tick's position for the whole of updatePlayerState — that
            // is what makes petals trail the flower. So assert the stage, and
            // assert separately that the commit has NOT happened yet.
            if (p.movedX !== r.x || p.movedY !== r.y) {
                fail(`tick ${tick} ${p.id}: moved ${p.movedX},${p.movedY} != legacy ${r.x},${r.y}`);
            }
            if (p.x !== previousX.get(p.id) || p.y !== previousY.get(p.id)) {
                fail(`tick ${tick} ${p.id}: player.x/y moved during the window — petals `
                    + 'would stop trailing the flower');
            }
            if (p.velocityX !== r.velocityX || p.velocityY !== r.velocityY) {
                fail(`tick ${tick} ${p.id}: velocity ${p.velocityX},${p.velocityY} `
                    + `!= legacy ${r.velocityX},${r.velocityY}`);
            }
            if (p.angle !== r.angle) {
                fail(`tick ${tick} ${p.id}: angle ${p.angle} != legacy ${r.angle}`);
            }
            if (p.speedFactor !== r.speedFactor) {
                fail(`tick ${tick} ${p.id}: speedFactor ${p.speedFactor} != legacy ${r.speedFactor}`);
            }
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
                fail(`tick ${tick} ${p.id}: non-finite position`);
            }
        }

        // Stand in for updatePlayerState's final `player.x = newX`. Everything
        // between the window and this line is legacy and unported; what matters
        // for the pipeline is that the commit happens after, not during.
        for (const s of subjects) {
            if (s.player.isDead) continue;
            s.player.x = s.player.movedX as number;
            s.player.y = s.player.movedY as number;
        }

        // --- the writers that live OUTSIDE the window ---------------------
        // Mob-contact knockback, the wall/teleporter clamps, respawn and split
        // halves all write player.x/y straight after this point in the real
        // tick, and the next push has to adopt them. Applying the same nudge to
        // both sides is what proves the IN direction is live: if the push were
        // dropped, the ECS would keep integrating from its own stored position
        // and the two would separate within a tick.
        if (tick % 7 === 3) {
            for (const s of subjects) {
                if (s.player.isDead) continue;
                const kx = (rng() - 0.5) * 50;
                const ky = (rng() - 0.5) * 50;
                s.player.x += kx;
                s.player.y += ky;
                s.reference.x += kx;
                s.reference.y += ky;
            }
        }

        // Death and respawn: a dead flower must not be integrated, and must
        // resume from wherever legacy respawned it rather than from the stale
        // component values.
        if (tick === 120) {
            for (let i = 0; i < subjects.length; i += 3) subjects[i].player.isDead = true;
        }
        if (tick === 160) {
            for (let i = 0; i < subjects.length; i += 3) {
                const s = subjects[i];
                s.player.isDead = false;
                s.player.x = s.reference.x = 1234 + i;
                s.player.y = s.reference.y = -4321 - i;
                s.player.velocityX = s.reference.velocityX = 0;
                s.player.velocityY = s.reference.velocityY = 0;
            }
        }
    }

    // --- the bot tag ------------------------------------------------------
    // C.IsBot was never set before this change: importPlayer did not pass it, so
    // every ECS-side bot query returned empty. That is a wrong answer rather
    // than an error, so pin it against the prefix that is still authoritative.
    let taggedBots = 0;
    let prefixBots = 0;
    for (const s of subjects) {
        if (s.player.id.startsWith('bot_')) prefixBots++;
        const entity = runtime.world.lookup(s.player.id);
        if (entity !== undefined && runtime.world.has(entity, C.IsBot)) taggedBots++;
    }
    if (taggedBots !== prefixBots) {
        fail(`C.IsBot count ${taggedBots} != bot_ prefix count ${prefixBots}`);
    }

    // --- the input hole ---------------------------------------------------
    // The specific regression this guards: PlayerInput used to be written once,
    // at import. Freeze every flower's input to a hard left, run a few ticks and
    // require that they all actually go left. If the per-tick push is ever lost,
    // they carry on with whatever they were doing and nothing else here notices.
    const frozen = subjects.filter(s => !s.player.isDead).slice(0, 12);
    for (const s of frozen) {
        s.player.inputs = {
            keys: [], useMouse: true,
            mouseDirectionX: -1, mouseDirectionY: 0, mouseSpeedMultiplier: 1,
        };
    }
    const beforeX = frozen.map(s => s.player.x);
    for (let tick = 0; tick < 20; tick++) {
        const now = now0 + (TICKS + tick) * (1000 / 30);
        syncPlayersToEcs(runtime.world, players, now);
        writeModifiers(now);
        runtime.tickPlayers(DT, DT * 1000, now);
        syncPlayersFromEcs(runtime.world, players);
        for (const s of frozen) {
            s.player.x = s.player.movedX as number;
            s.player.y = s.player.movedY as number;
        }
    }
    for (let i = 0; i < frozen.length; i++) {
        const moved = beforeX[i] - frozen[i].player.x;
        if (!(moved > 1)) {
            fail(`${frozen[i].player.id} ignored a freshly written input `
                + `(moved ${moved.toFixed(3)}px left over 20 ticks) — PlayerInput is not `
                + 'being pushed per tick');
        }
    }

    resetSyncState();
    return failures;
}

/** Console entry point, run as part of `npm run harness:ecs`. */
export function main(): void {
    const failures = runPlayerCutoverCheck();
    if (failures.length === 0) {
        console.log('player cutover check: ECS movement matches the legacy path exactly');
        return;
    }
    console.error(`player cutover check: ${failures.length} FAILURE(S)`);
    for (const f of failures) console.error('  x ' + f);
    process.exitCode = 1;
}
