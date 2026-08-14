/**
 * Self-test for the player movement system.
 *
 * The PHYSICS is not tested here — it is the shared `stepPlayerMovement`,
 * injected verbatim, so parity with the client's prediction is by construction.
 * What is tested is everything this system actually decides: the target
 * velocity derived from input, the speed-factor clamps, facing updates, and
 * which entities are eligible to move at all.
 *
 * The injected step is a plain Euler integrator with no walls, so assertions
 * are exact and a failure means the port is wrong rather than the terrain.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { spawnPlayer } from '../prefabs';
import { Scheduler } from '../system';
import { World } from '../world';
import {
    createPlayerMovementQueries,
    PlayerMoveState,
    registerPlayerMovementSystem,
} from './playerMovement';

const TICK_SECONDS = 1 / 30;
const TICK_MS = 1000 / 30;
const MAX_SPEED = 300;
const PLAYER_SIZE = 50;

export function runPlayerMovementSelfTest(): string[] {
    const failures: string[] = [];

    const check = (name: string, condition: boolean, detail?: string) => {
        if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name: string, actual: unknown, expected: unknown) => {
        if (actual !== expected) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    const checkClose = (name: string, actual: number, expected: number, tolerance = 1e-6) => {
        if (!(Math.abs(actual - expected) <= tolerance)) {
            failures.push(`${name}: expected ~${expected}, got ${actual}`);
        }
    };

    /** Records what the shared physics was handed, and integrates trivially. */
    interface StepCall {
        targetVX: number;
        targetVY: number;
        dt: number;
        effectiveSize: number;
    }

    function makeHarness(speedBoost = 1) {
        const world = new World();
        const scheduler = new Scheduler(world);
        const calls: StepCall[] = [];

        registerPlayerMovementSystem(scheduler, createPlayerMovementQueries(world), {
            maxSpeed: MAX_SPEED,
            playerSize: PLAYER_SIZE,
            step: (state: PlayerMoveState, targetVX, targetVY, dt, effectiveSize) => {
                calls.push({ targetVX, targetVY, dt, effectiveSize });
                // Straight Euler: velocity becomes the target, position advances.
                return {
                    x: state.x + targetVX * dt,
                    y: state.y + targetVY * dt,
                    vx: targetVX,
                    vy: targetVY,
                };
            },
        });

        let now = 1000;
        return {
            world,
            calls,
            speedBoost,
            tick(times = 1) {
                for (let i = 0; i < times; i++) {
                    now += TICK_MS;
                    scheduler.tick(TICK_SECONDS, TICK_MS, now);
                }
            },
        };
    }

    function addPlayer(world: World, id: string): Entity {
        return spawnPlayer(world, {
            socketId: id, name: id, x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
    }

    // -- keyboard: cardinal ----------------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'kb');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });

        h.tick();
        checkClose('right key drives +X at full speed', h.calls[0].targetVX, MAX_SPEED);
        checkClose('right key leaves Y alone', h.calls[0].targetVY, 0);
        checkClose('position advanced', h.world.get(p, C.Position, 'x') as number, MAX_SPEED * TICK_SECONDS);
        checkClose('facing points right', h.world.get(p, C.Angle, 'value') as number, 0);
    }

    // -- keyboard: diagonals are normalised ------------------------------------
    {
        // A diagonal must not be faster than a cardinal — the classic bug this
        // normalisation exists to prevent.
        const h = makeHarness();
        const p = addPlayer(h.world, 'diag');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d', 's'] });

        h.tick();
        const { targetVX, targetVY } = h.calls[0];
        const magnitude = Math.sqrt(targetVX * targetVX + targetVY * targetVY);
        checkClose('diagonal speed equals cardinal speed', magnitude, MAX_SPEED, 1e-9);
        checkClose('diagonal splits evenly on X', targetVX, MAX_SPEED / Math.SQRT2, 1e-9);
        checkClose('diagonal splits evenly on Y', targetVY, MAX_SPEED / Math.SQRT2, 1e-9);
        checkClose('facing is down-right', h.world.get(p, C.Angle, 'value') as number, Math.PI / 4, 1e-6);
    }

    // -- opposing keys cancel ---------------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'cancel');
        h.world.set(p, C.Angle, 'value', 1.234);
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['a', 'd'] });

        h.tick();
        checkClose('opposing keys cancel to zero', h.calls[0].targetVX, 0);
        // Facing must NOT reset when there is no movement: a player who stops
        // keeps the heading they stopped on.
        checkClose('facing preserved when not moving', h.world.get(p, C.Angle, 'value') as number, 1.234, 1e-5);
    }

    // -- no input --------------------------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'idle');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: [] });

        h.tick();
        checkClose('idle target is zero', h.calls[0].targetVX, 0);
        checkClose('idle stays put', h.world.get(p, C.Position, 'x') as number, 0);
    }

    // -- mouse input -----------------------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'mouse');
        h.world.write(p, C.PlayerInput, {
            useMouse: 1, mouseDirectionX: 0, mouseDirectionY: 1, mouseSpeedMultiplier: 0.5,
        });

        h.tick();
        checkClose('mouse applies the speed fraction', h.calls[0].targetVY, MAX_SPEED * 0.5);
        checkClose('mouse X is zero', h.calls[0].targetVX, 0);
        checkClose('facing follows the mouse', h.world.get(p, C.Angle, 'value') as number, Math.PI / 2, 1e-6);
    }

    // -- mouse multiplier is clamped -------------------------------------------
    {
        // A malformed client value must not bypass the speed cap.
        const h = makeHarness();
        const p = addPlayer(h.world, 'badmouse');

        h.world.write(p, C.PlayerInput, { useMouse: 1, mouseDirectionX: 1, mouseDirectionY: 0, mouseSpeedMultiplier: 1000 });
        h.tick();
        checkClose('huge mouse multiplier clamps to 1.5', h.calls[0].targetVX, MAX_SPEED * 1.5);

        h.world.set(p, C.PlayerInput, 'mouseSpeedMultiplier', -5);
        h.tick();
        checkClose('negative mouse multiplier clamps to 0', h.calls[1].targetVX, 0);

        h.world.set(p, C.PlayerInput, 'mouseSpeedMultiplier', NaN);
        h.tick();
        checkClose('NaN mouse multiplier becomes 0', h.calls[2].targetVX, 0);
    }

    // -- speed factor clamps ----------------------------------------------------
    {
        // getSpeedMultiplier has no internal cap, so a stacked apex boost can
        // otherwise move the player thousands of px in a tick and land them at a
        // coordinate that hangs raycast loops elsewhere.
        const h = makeHarness();
        const p = addPlayer(h.world, 'fast');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });
        h.world.set(p, C.PlayerModifiers, 'speedBoost', 500);

        h.tick();
        checkClose('speed factor caps at 8', h.calls[0].targetVX, MAX_SPEED * 8);
        checkClose('capped factor is cached for the client',
            h.world.get(p, C.PlayerModifiers, 'speedFactor') as number, 8);
    }

    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'nan');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });
        h.world.set(p, C.PlayerModifiers, 'speedBoost', NaN);

        h.tick();
        checkClose('NaN speed factor falls back to 1', h.calls[0].targetVX, MAX_SPEED);
        checkClose('cached factor is 1', h.world.get(p, C.PlayerModifiers, 'speedFactor') as number, 1);
    }

    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'neg');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });
        h.world.set(p, C.PlayerModifiers, 'speedBoost', -3);

        h.tick();
        checkClose('negative speed factor falls back to 1', h.calls[0].targetVX, MAX_SPEED);
    }

    // -- size multiplier reaches the physics ------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'big');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });
        h.world.set(p, C.PlayerModifiers, 'sizeMultiplier', 3);

        h.tick();
        checkClose('effective size scales the hitbox', h.calls[0].effectiveSize, PLAYER_SIZE * 3);

        // A zero multiplier must not produce a zero hitbox: downstream, a zero
        // effective size makes the substep count Infinity and spins the loop.
        h.world.set(p, C.PlayerModifiers, 'sizeMultiplier', 0);
        h.tick();
        checkClose('zero size multiplier falls back to 1x', h.calls[1].effectiveSize, PLAYER_SIZE);
    }

    // -- eligibility -----------------------------------------------------------
    {
        const h = makeHarness();
        const alive = addPlayer(h.world, 'alive');
        const dead = addPlayer(h.world, 'dead');
        const lobby = spawnPlayer(h.world, {
            socketId: 'lobby', name: 'lobby', x: 0, y: 0,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], lobby: true, now: 0,
        });

        for (const p of [alive, dead, lobby]) {
            h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });
        }
        h.world.add(dead, C.IsDead);

        h.tick();
        checkEqual('exactly one player moved', h.calls.length, 1);
        check('living player moved', (h.world.get(alive, C.Position, 'x') as number) > 0);
        checkEqual('dead player did not move', h.world.get(dead, C.Position, 'x'), 0);
        // The lobby exclusion is the structural replacement for the old separate
        // lobbyPlayers map that every simulation loop was blind to.
        checkEqual('lobby player did not move', h.world.get(lobby, C.Position, 'x'), 0);
    }

    // -- velocity is written back ----------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'vel');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['s'] });

        h.tick();
        checkClose('velocity written back from physics',
            h.world.get(p, C.Velocity, 'y') as number, MAX_SPEED, 1e-3);
    }

    // -- timestep reaches the physics -------------------------------------------
    {
        const h = makeHarness();
        const p = addPlayer(h.world, 'dt');
        h.world.write(p, C.PlayerInput, { useMouse: 0, keys: ['d'] });

        h.tick();
        checkClose('dt is the smoothed tick seconds', h.calls[0].dt, TICK_SECONDS);
    }

    return failures;
}
