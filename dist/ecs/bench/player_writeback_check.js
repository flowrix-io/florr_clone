"use strict";
/**
 * The oracle for cross-player writes made during the player loop.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * `player_cutover_check.ts` proves the movement window is arithmetically
 * identical to the code it replaced. It cannot prove anything about the OTHER
 * half of the contract: what happens to a write aimed at player B that is made
 * from inside player A's `updatePlayerState`.
 *
 * Those writes are where the cutover actually regressed. Integration used to run
 * inside `updatePlayerState`, starting from `player.x`; now it is a batched pass
 * that runs before the loop and parks its result in the `movedX`/`movedY`
 * staging pair, which `updatePlayerState` seeds `newX`/`newY` from and commits
 * ~1700 lines later. So there is now a window, per flower, in which `player.x`
 * is NOT that flower's live position — and two shipped features write into it:
 *
 *   1. PVP knockback (`applyPvpDamage`) — written by the ATTACKER's update.
 *   2. The yggdrasil revive — `isDead = false` written by the REVIVER's update,
 *      after which the revived flower's own update runs in the same loop and
 *      commits a staging pair that was last written before it died.
 *
 * Both are order-dependent: they work or silently vanish depending on where the
 * two players sit in `Object.keys(players)`. Every other gate is structurally
 * blind to that — typechecking sees a legal assignment, the self-tests never
 * build two interacting players, and the tick harness has no legacy loop at all.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is a stand-in
 * ---------------------------------------------------------------------------
 * REAL: `syncPlayersToEcs`, `runtime.tickPlayers`, `syncPlayersFromEcs` and
 * `displacePlayer`, called in the real order — the actual shipping code.
 *
 * STAND-IN: the body of `updatePlayerState`. It cannot be imported (playerState
 * imports petal_actions, which binds port 3000 at module scope), so the two
 * lines of it that matter are transcribed below — the `newX` seed at the top and
 * the `player.x = newX` commit at the bottom. Those are the lines that discard a
 * mistimed write, so they are the ones the oracle has to reproduce; everything
 * between them is unported legacy that only reads.
 *
 * Each check runs BOTH iteration orders and, where the fix is a choice of which
 * fields to write, a control that performs the OLD write and asserts it is lost.
 * Without the controls this file could pass on a codebase where nothing works.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlayerWritebackCheck = runPlayerWritebackCheck;
exports.main = main;
const ecsRuntime_1 = require("../../server/ecsRuntime");
const ecsSync_1 = require("../../server/ecsSync");
const tick_harness_1 = require("./tick_harness");
const stub_hooks_1 = require("./stub_hooks");
const DT = 1 / 30;
const NOW0 = 1000000;
/** A flower that walks steadily right, so every tick's integration is visible. */
function makePlayer(id, x, y) {
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
        sizeMultiplier: 1,
        inputs: {
            keys: [],
            useMouse: true,
            mouseDirectionX: 1,
            mouseDirectionY: 0,
            mouseSpeedMultiplier: 1,
        },
    };
}
/** The stub runtime; only the player scheduler is exercised. */
function makeRuntime() {
    return (0, ecsRuntime_1.createEcsRuntime)((0, stub_hooks_1.benchStubHooks)());
}
/**
 * One `runSimulationStep` player phase.
 *
 * The window, then the loop — and inside the loop, per flower, the seed / body /
 * commit shape of `updatePlayerState`. `body` stands for the ~1700 lines that
 * run between the seed and the commit; it is where a cross-player write lands.
 *
 * `order` is explicit because the whole class of bug is order dependence, and in
 * the real server the order is `for (const id in players)` — insertion order,
 * i.e. who connected first.
 */
function runPlayerPhase(runtime, players, order, tick, body) {
    const now = NOW0 + tick * (1000 / 30);
    (0, ecsSync_1.syncPlayersToEcs)(runtime.world, players, now);
    runtime.tickPlayers(DT, DT * 1000, now);
    (0, ecsSync_1.syncPlayersFromEcs)(runtime.world, players);
    for (const id of order) {
        const player = players[id];
        // updatePlayerState's own early return. A corpse is not updated at all.
        if (!player || !player.inputs || player.isDead)
            continue;
        // playerState.ts, the top of updatePlayerState.
        const newX = player.movedX ?? player.x;
        const newY = player.movedY ?? player.y;
        body(player);
        // playerState.ts:3144, the very end of updatePlayerState.
        player.x = newX;
        player.y = newY;
    }
}
// ---------------------------------------------------------------------------
// 1. PVP knockback
// ---------------------------------------------------------------------------
/**
 * Knock `victim` away from `attacker`, verbatim from `applyPvpDamage` except for
 * how the displacement is applied — which is the point of the check.
 */
function pvpKnockback(attacker, victim, apply) {
    const dx = victim.x - attacker.x;
    const dy = victim.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const knockDist = 25;
    const kx = (dx / dist) * knockDist;
    const ky = (dy / dist) * knockDist;
    apply(victim, kx, ky);
    return { x: kx, y: ky };
}
/** The pre-fix write: `victim.x += knockbackX`. Kept as the control. */
function displaceXYOnly(player, dx, dy) {
    player.x += dx;
    player.y += dy;
}
/**
 * Run one PVP hit and report how far the victim actually ended up from where the
 * integrator would have left them.
 *
 * The measurement has to be relative to the UNHIT position, not to the position
 * before the tick: the victim is walking, so "did it move" is not the question —
 * "did it move by the knockback on top of its own movement" is. So an identical
 * unhit twin is run alongside in the same world, and the two are differenced.
 */
function measurePvpKnockback(attackerFirst, apply) {
    (0, ecsSync_1.resetSyncState)();
    const runtime = makeRuntime();
    (0, ecsSync_1.configureCutover)(runtime);
    const attacker = makePlayer('attacker', 0, 0);
    const victim = makePlayer('victim', 100, 0);
    const twin = makePlayer('twin', 100, 0);
    const players = { attacker, victim, twin };
    // The twin always trails the pair so its own commit is never the thing under
    // test; only its position is read.
    const order = attackerFirst
        ? ['attacker', 'victim', 'twin']
        : ['victim', 'attacker', 'twin'];
    let expectedX = 0;
    for (let tick = 0; tick < 6; tick++) {
        runPlayerPhase(runtime, players, order, tick, player => {
            if (tick !== 3 || player.id !== 'attacker')
                return;
            expectedX = pvpKnockback(attacker, victim, apply).x;
        });
    }
    (0, ecsSync_1.resetSyncState)();
    return { appliedX: victim.x - twin.x, expectedX };
}
// ---------------------------------------------------------------------------
// 2. The yggdrasil revive
// ---------------------------------------------------------------------------
/**
 * Kill a flower, drag the corpse somewhere legacy is entitled to drag it, then
 * revive it mid-loop from another flower's update and report where it lands.
 *
 * The drag is not contrived: `validatePlayerPositions` recentres an
 * out-of-bounds corpse, arena and maze exits teleport one, and the death
 * knockback itself lands after the window. Whatever moved it, the revived player
 * must resume from the corpse — not from wherever the integrator last left them
 * while they were alive.
 */
function measureRevivePosition(reviverFirst) {
    (0, ecsSync_1.resetSyncState)();
    const runtime = makeRuntime();
    (0, ecsSync_1.configureCutover)(runtime);
    const reviver = makePlayer('reviver', 0, 0);
    const corpse = makePlayer('corpse', 500, 0);
    const players = { reviver, corpse };
    const order = reviverFirst ? ['reviver', 'corpse'] : ['corpse', 'reviver'];
    const DEATH_TICK = 3;
    const DRAG_TICK = 5;
    const REVIVE_TICK = 9;
    const CORPSE_DESTINATION = 20000;
    for (let tick = 0; tick < 12; tick++) {
        runPlayerPhase(runtime, players, order, tick, player => {
            if (tick !== REVIVE_TICK || player.id !== 'reviver')
                return;
            // playerState.ts, the yggdrasil block: written from INSIDE the
            // reviver's update, so the corpse's own update may still be ahead of
            // us in this same loop.
            corpse.isDead = false;
            corpse.health = corpse.maxHealth;
        });
        // Legacy writes that land after the player loop.
        if (tick === DEATH_TICK)
            corpse.isDead = true;
        if (tick === DRAG_TICK)
            corpse.x = CORPSE_DESTINATION;
    }
    (0, ecsSync_1.resetSyncState)();
    return { landedX: corpse.x, corpseX: CORPSE_DESTINATION };
}
// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------
function runPlayerWritebackCheck() {
    (0, tick_harness_1.assertNoServerBooted)();
    const failures = [];
    const fail = (message) => { if (failures.length < 20)
        failures.push(message); };
    // --- PVP knockback, both orders --------------------------------------
    for (const attackerFirst of [true, false]) {
        const label = attackerFirst ? 'attacker updated first' : 'victim updated first';
        const { appliedX, expectedX } = measurePvpKnockback(attackerFirst, ecsSync_1.displacePlayer);
        // The tolerance is for float re-association only: two flowers integrating
        // the same velocity from positions 25px apart stay 25px apart to within
        // an ulp or so. The failure being guarded is 0px vs 25px.
        if (Math.abs(appliedX - expectedX) > 1e-6) {
            fail(`pvp knockback (${label}): victim was displaced ${appliedX.toFixed(4)}px, `
                + `expected ${expectedX.toFixed(4)}px — the hit is being discarded by `
                + 'updatePlayerState\'s commit');
        }
    }
    // --- the control: the pre-fix write must still be detectably broken ---
    // If this ever stops failing, the seed/commit shape above has drifted away
    // from updatePlayerState and the two checks above prove nothing.
    {
        const early = measurePvpKnockback(true, displaceXYOnly);
        const late = measurePvpKnockback(false, displaceXYOnly);
        const earlyLost = Math.abs(early.appliedX) < 1e-6;
        const lateApplied = Math.abs(late.appliedX - late.expectedX) < 1e-6;
        if (!earlyLost || !lateApplied) {
            fail('control: a bare `victim.x += knockback` no longer shows the '
                + `order-dependent loss it must (early ${early.appliedX.toFixed(4)}px, `
                + `late ${late.appliedX.toFixed(4)}px) — this oracle has stopped `
                + 'reproducing updatePlayerState and can no longer catch the bug');
        }
    }
    // --- the revive, both orders -----------------------------------------
    for (const reviverFirst of [true, false]) {
        const label = reviverFirst ? 'reviver updated first' : 'corpse updated first';
        const { landedX, corpseX } = measureRevivePosition(reviverFirst);
        // The revived flower gets a couple of ticks of walking after the revive,
        // so it ends up slightly ahead of the corpse — but never behind it, and
        // never back at where it died. MAX_SPEED is 300px/s, so a few ticks is
        // tens of pixels against a ~19500px rewind.
        const drift = landedX - corpseX;
        if (!(drift >= 0 && drift < 100)) {
            fail(`yggdrasil revive (${label}): revived at x=${landedX.toFixed(1)}, `
                + `corpse was at x=${corpseX} — the revived player was teleported `
                + `${(-drift).toFixed(1)}px back to a stale staged position`);
        }
    }
    // --- the staging-pair invariant behind the revive fix -----------------
    // Stated directly as well as end-to-end, because this is the property every
    // other revive path (second chance, admin revive) silently depends on.
    {
        (0, ecsSync_1.resetSyncState)();
        const runtime = makeRuntime();
        (0, ecsSync_1.configureCutover)(runtime);
        const dead = makePlayer('dead', 10, 20);
        dead.isDead = true;
        const players = { dead };
        (0, ecsSync_1.syncPlayersToEcs)(runtime.world, players, NOW0);
        dead.x = 777;
        dead.y = -888;
        (0, ecsSync_1.syncPlayersToEcs)(runtime.world, players, NOW0 + 33);
        if (dead.movedX !== 777 || dead.movedY !== -888) {
            fail(`a corpse's staging pair is ${dead.movedX},${dead.movedY} but it is at `
                + '777,-888 — a mid-tick revive would commit the stale pair');
        }
        (0, ecsSync_1.resetSyncState)();
    }
    return failures;
}
/** Console entry point, run as part of `npm run harness:ecs`. */
function main() {
    const failures = runPlayerWritebackCheck();
    if (failures.length === 0) {
        console.log('player write-back check: cross-player writes survive the player loop '
            + 'in either iteration order');
        return;
    }
    console.error(`player write-back check: ${failures.length} FAILURE(S)`);
    for (const f of failures)
        console.error('  x ' + f);
    process.exitCode = 1;
}
