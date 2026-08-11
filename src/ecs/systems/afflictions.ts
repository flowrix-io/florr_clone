/**
 * Affliction systems: poison stacks, player poison, and slows.
 *
 * All three used to be scans over every mob or every player testing a mostly
 * undefined field. As components they are queries over exactly the afflicted
 * entities, so an empty-affliction tick costs nothing at all rather than ~1400
 * undefined checks.
 */

import * as C from '../components';
import { Entity } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

export interface AfflictionQueries {
    poisonStacks: Query;
    poisonedPlayers: Query;
    slowed: Query;
}

export function createAfflictionQueries(world: World): AfflictionQueries {
    return {
        poisonStacks: world.query([C.PoisonStack]),
        poisonedPlayers: world.query([C.Poisoned, C.Health], [C.IsDead]),
        slowed: world.query([C.Slowed, C.Speed]),
    };
}

/**
 * Apply every active poison stack to its victim and retire lapsed ones.
 *
 * A stack is destroyed when it lapses OR when its target dies — the generation
 * check on the handle is what makes the latter safe. Under the old id-based
 * scheme a stack could outlive its mob and then apply to whichever mob happened
 * to reuse the id.
 */
export function poisonStackSystem(queries: AfflictionQueries) {
    return (ctx: SystemContext): void => {
        const { world, cmd, now, deltaMs } = ctx;

        queries.poisonStacks.chunks(chunk => {
            const stack = chunk.cols(C.PoisonStack);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const self = entities[i] as Entity;
                const target = stack.target[i] as Entity;

                if (!world.isAlive(target) || now >= stack.endTime[i]) {
                    cmd.destroy(self);
                    continue;
                }
                if (!world.has(target, C.Health)) {
                    cmd.destroy(self);
                    continue;
                }

                // PoisonEffect.damage is per millisecond, as before.
                const current = world.get(target, C.Health, 'current') as number;
                const next = current - stack.damagePerMs[i] * deltaMs;
                world.set(target, C.Health, 'current', next);

                if (next <= 0 && !world.has(target, C.IsDead)) {
                    cmd.add(target, C.IsDead);
                }
            }
        });
    };
}

/**
 * Tick the single poison stack a player can carry.
 *
 * Players deliberately differ from mobs here: exactly one stack at a time,
 * refreshed rather than accumulated, because a fresh bite replaces the old one.
 */
export function playerPoisonSystem(queries: AfflictionQueries) {
    return (ctx: SystemContext): void => {
        const { cmd, now, deltaTime } = ctx;

        queries.poisonedPlayers.chunks(chunk => {
            const poison = chunk.cols(C.Poisoned);
            const health = chunk.cols(C.Health);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                if (now >= poison.until[i]) {
                    cmd.remove(entities[i] as Entity, C.Poisoned);
                    continue;
                }
                // Player poison is expressed per SECOND, unlike mob stacks.
                health.current[i] -= poison.damagePerSecond[i] * deltaTime;
                if (health.current[i] <= 0) {
                    cmd.add(entities[i] as Entity, C.IsDead);
                }
            }
        });
    };
}

/**
 * Restore full speed when a slow lapses.
 *
 * Mirrors the existing `updateSlowEffects` contract exactly: a slow scales
 * `Speed.current` down and this restores it from `Speed.base`, so the ~15
 * movement branches that read speed never learn about slows at all.
 */
export function slowExpirySystem(queries: AfflictionQueries) {
    return (ctx: SystemContext): void => {
        const { cmd, now } = ctx;

        queries.slowed.chunks(chunk => {
            const slowed = chunk.cols(C.Slowed);
            const speed = chunk.cols(C.Speed);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                if (now >= slowed.until[i]) {
                    speed.current[i] = speed.base[i];
                    cmd.remove(entities[i] as Entity, C.Slowed);
                }
            }
        });
    };
}

export function registerAfflictionSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: AfflictionQueries,
): void {
    scheduler.add('poisonStacks', Phase.Combat, poisonStackSystem(queries));
    scheduler.add('playerPoison', Phase.Combat, playerPoisonSystem(queries));
    scheduler.add('slowExpiry', Phase.Combat, slowExpirySystem(queries));
}
