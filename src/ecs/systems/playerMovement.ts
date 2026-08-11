/**
 * Player movement system — the ECS port of `computeTargetVelocity` plus the
 * movement half of `updatePlayerState`.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT ported
 * ---------------------------------------------------------------------------
 * `stepPlayerMovement` (constants.ts) is injected, not reimplemented. It is the
 * single source of truth for player physics and is run by BOTH the server and
 * the client's movement prediction, so the two execute the same code and there
 * is nothing to reconcile in open movement. Forking it into an ECS-shaped copy
 * would silently break that parity the moment either copy drifted — and it also
 * carries the wall-containment guards (unresolved-overlap fallback, centre-path
 * crossing refusal, substep caps) that exist because getting them wrong wedges
 * players inside geometry or spins the substep loop at 100% CPU.
 *
 * So this system's job is only: gather inputs from columns, decide a target
 * velocity, hand it to the shared physics, write the result back.
 *
 * The speed multiplier is injected for the same reason at a lower stake — it
 * reads the loadout and active effects, which are their own subsystem.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** The mutable movement state `stepPlayerMovement` consumes and returns. */
export interface PlayerMoveState {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

/** The exact signature of the shared `stepPlayerMovement`. */
export type StepPlayerMovement = (
    state: PlayerMoveState,
    targetVX: number,
    targetVY: number,
    dt: number,
    effectiveSize: number,
) => PlayerMoveState;

export interface PlayerMovementDeps {
    /** MAX_SPEED from constants.ts. */
    maxSpeed: number;
    /** PLAYER_SIZE from constants.ts. */
    playerSize: number;
    /** The shared physics step. Inject `stepPlayerMovement` verbatim. */
    step: StepPlayerMovement;
    /**
     * Equivalent of `getSpeedMultiplier(player)` — the product of active speed
     * effects and petal modifiers. Injected because it reads the loadout and
     * effect list, which are a separate subsystem.
     */
    speedMultiplier(entity: Entity): number;
}

/**
 * Upper bound on the effective speed factor.
 *
 * `getSpeedMultiplier` multiplies every speed_boost effect and petal modifier
 * with no cap, so an apex or stacked boost — or a degenerate value — can make
 * this enormous, moving the player thousands of px in one tick and landing them
 * at a coordinate that then hangs distance and raycast loops elsewhere (bot
 * wall-avoidance among them). 8x is well above any intended boost.
 */
const MAX_SPEED_FACTOR = 8;

/** Client-supplied mouse fraction is normally 0..1; this bounds a malformed one. */
const MAX_MOUSE_MULTIPLIER = 1.5;

const KEYS_LEFT = ['ArrowLeft', 'a'];
const KEYS_RIGHT = ['ArrowRight', 'd'];
const KEYS_UP = ['ArrowUp', 'w'];
const KEYS_DOWN = ['ArrowDown', 's'];

function held(keys: string[] | undefined, names: string[]): boolean {
    if (!keys) return false;
    for (let i = 0; i < names.length; i++) {
        if (keys.indexOf(names[i]) !== -1) return true;
    }
    return false;
}

export interface PlayerMovementQueries {
    movable: Query;
}

export function createPlayerMovementQueries(world: World): PlayerMovementQueries {
    return {
        // Dead players do not move, and lobby players are not in the world at
        // all — the IsLobby exclusion is what replaces the old separate
        // `lobbyPlayers` map that every simulation loop was blind to.
        movable: world.query(
            [C.Position, C.Velocity, C.Angle, C.PlayerInput, C.PlayerModifiers, C.IsPlayer],
            [C.IsDead, C.IsLobby],
        ),
    };
}

/**
 * Advance every living, in-world player one step.
 *
 * Note this system writes `PlayerModifiers.speedFactor` as a side effect, just
 * as `computeTargetVelocity` cached it on the player. That cache is not an
 * optimisation — the broadcast sends it to the owning client so client-side
 * prediction moves at exactly the server's speed.
 */
export function playerMovementSystem(queries: PlayerMovementQueries, deps: PlayerMovementDeps) {
    const { maxSpeed, playerSize, step, speedMultiplier } = deps;

    // Reused across players so the per-tick input object is not reallocated.
    // `step` still returns a fresh object per call; that is one small object per
    // player per tick (~30/tick at full population) and is left alone rather
    // than changing a signature shared with the client.
    const state: PlayerMoveState = { x: 0, y: 0, vx: 0, vy: 0 };

    return (ctx: SystemContext): void => {
        const dt = ctx.deltaTime;

        queries.movable.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const vel = chunk.cols(C.Velocity);
            const angle = chunk.cols(C.Angle);
            const input = chunk.cols(C.PlayerInput);
            const mods = chunk.cols(C.PlayerModifiers);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i] as Entity;

                // --- effective speed factor, clamped exactly as before -------
                let speedFactor = mods.speedBoost[i] * speedMultiplier(entity);
                if (!(speedFactor >= 0)) speedFactor = 1;          // NaN / negative
                if (speedFactor > MAX_SPEED_FACTOR) speedFactor = MAX_SPEED_FACTOR;
                mods.speedFactor[i] = speedFactor;

                // --- target velocity from input ------------------------------
                let targetVX = 0;
                let targetVY = 0;

                if (input.useMouse[i]) {
                    // The client has already resolved direction and a speed
                    // fraction; the server applies MAX_SPEED and the factor.
                    // The fraction is clamped so a malformed or huge value
                    // cannot bypass the speed-factor cap above. NaN -> 0.
                    const raw = input.mouseSpeedMultiplier[i];
                    const mouseMult = Math.min(MAX_MOUSE_MULTIPLIER, Math.max(0, raw)) || 0;
                    const speed = maxSpeed * speedFactor * mouseMult;
                    const dirX = input.mouseDirectionX[i];
                    const dirY = input.mouseDirectionY[i];
                    targetVX = dirX * speed;
                    targetVY = dirY * speed;
                    angle.value[i] = Math.atan2(dirY, dirX);
                } else {
                    const keys = input.keys[i] as string[] | undefined;
                    if (held(keys, KEYS_LEFT)) targetVX -= 1;
                    if (held(keys, KEYS_RIGHT)) targetVX += 1;
                    if (held(keys, KEYS_UP)) targetVY -= 1;
                    if (held(keys, KEYS_DOWN)) targetVY += 1;

                    // Normalise diagonals so they are not faster than cardinals.
                    if (targetVX !== 0 && targetVY !== 0) {
                        const length = Math.sqrt(targetVX * targetVX + targetVY * targetVY);
                        targetVX /= length;
                        targetVY /= length;
                    }

                    const speed = maxSpeed * speedFactor;
                    targetVX *= speed;
                    targetVY *= speed;

                    // Facing only updates while actually moving, so a player who
                    // releases the keys keeps the heading they stopped on.
                    if (targetVX !== 0 || targetVY !== 0) {
                        angle.value[i] = Math.atan2(targetVY, targetVX);
                    }
                }

                // --- shared physics ------------------------------------------
                state.x = pos.x[i];
                state.y = pos.y[i];
                state.vx = vel.x[i];
                state.vy = vel.y[i];

                const effectiveSize = playerSize * (mods.sizeMultiplier[i] || 1);
                const moved = step(state, targetVX, targetVY, dt, effectiveSize);

                pos.x[i] = moved.x;
                pos.y[i] = moved.y;
                vel.x[i] = moved.vx;
                vel.y[i] = moved.vy;
            }
        });
    };
}

export function registerPlayerMovementSystem(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: PlayerMovementQueries,
    deps: PlayerMovementDeps,
): void {
    scheduler.add('playerMovement', Phase.Simulation, playerMovementSystem(queries, deps));
}
