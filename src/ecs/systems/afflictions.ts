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
 * What the mob-poison pass needs from the legacy side: damage attribution and
 * the death sequence are legacy-owned (XP, drops, the wire), so they arrive as
 * hooks, exactly as they do for mob collision and projectiles.
 */
export interface MobPoisonDeps {
    /** Attribute this tick's poison damage to the player whose petal bit. */
    creditDamage(victim: Entity, source: Entity, amount: number): void;
    /** Queue the victim into the batched `enemiesDamaged` with the poison flag. */
    markPoisonDamaged(victim: Entity): void;
    /**
     * Poison finished the victim: run the legacy poison-death sequence (XP to
     * the top contributor, drops, removal, the replacement spawn). Must be
     * idempotent per victim — several stacks can tick one mob in one pass.
     */
    onPoisonKill(victim: Entity): void;
}

/** The player-poison hooks; see playerPoisonSystem for why the body is legacy. */
export interface PlayerPoisonDeps {
    /**
     * Tick the flower's poison: armor, invulnerability, the health write,
     * death/second-chance and the `playerDamaged` emit all live with the
     * legacy player state this reads and writes.
     */
    tickPoison(player: Entity, deltaTime: number): void;
    /** The poison lapsed: clear the legacy mirror fields. */
    onPoisonLapsed(player: Entity): void;
}

/**
 * Apply every active poison stack to its victim and retire lapsed ones.
 *
 * A stack is destroyed when it lapses OR when its target dies — the generation
 * check on the handle is what makes the latter safe. Under the old id-based
 * scheme a stack could outlive its mob and then apply to whichever mob happened
 * to reuse the id.
 *
 * Stacks are snapshotted before any damage is applied: the kill hook reaches
 * legacy code (drops, spawns) that may make structural changes, and iterating
 * live chunks across that is how a swap-remove skips a row.
 */
export function poisonStackSystem(queries: AfflictionQueries, deps: MobPoisonDeps) {
    const { creditDamage, markPoisonDamaged, onPoisonKill } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, cmd, now, deltaMs } = ctx;

        scratch.length = 0;
        queries.poisonStacks.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let s = 0; s < scratch.length; s++) {
            const self = scratch[s];
            if (!world.isAlive(self)) continue;
            const target = world.get(self, C.PoisonStack, 'target') as Entity;

            if (!world.isAlive(target) || now >= (world.get(self, C.PoisonStack, 'endTime') as number)) {
                cmd.destroy(self);
                continue;
            }
            if (!world.has(target, C.Health)) {
                cmd.destroy(self);
                continue;
            }
            // A mob that already died this tick (or was killed by an earlier
            // stack in this pass) takes nothing more — the legacy loop skipped
            // shells that had left `enemies[]`.
            const current = world.get(target, C.Health, 'current') as number;
            if (current <= 0 || world.has(target, C.IsDead)) continue;

            // PoisonEffect.damage is per millisecond, as before; clamped at
            // zero exactly as the legacy pass clamped `enemy.health`.
            const amount = (world.get(self, C.PoisonStack, 'damagePerMs') as number) * deltaMs;
            const next = Math.max(0, current - amount);
            world.set(target, C.Health, 'current', next);

            const source = world.get(self, C.PoisonStack, 'source') as Entity;
            if (world.isAlive(source)) creditDamage(target, source, amount);
            markPoisonDamaged(target);

            if (next <= 0) onPoisonKill(target);
        }
        scratch.length = 0;
    };
}

/**
 * Apply (or refresh) a poison stack from `source`'s petal onto `victim`.
 *
 * The port of the legacy per-player dedup on `enemy.poisonEffects`: one stack
 * per (victim, source) pair, and gardn's rule (Damage.cc) that a fresh bite
 * only takes over when it would OUTLAST what is already ticking — without the
 * guard, a short weak poison stomps a long strong one (pincer landing after
 * iris used to wipe the iris poison).
 */
export function applyPoisonStack(
    world: World,
    stacks: Query,
    victim: Entity,
    source: Entity,
    damagePerMs: number,
    endTime: number,
): void {
    let existing: Entity | undefined;
    stacks.chunks(chunk => {
        const stack = chunk.cols(C.PoisonStack);
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            if ((stack.target[i] as Entity) === victim && (stack.source[i] as Entity) === source) {
                existing = entities[i] as Entity;
            }
        }
    });

    if (existing !== undefined) {
        if ((world.get(existing, C.PoisonStack, 'endTime') as number) < endTime) {
            world.write(existing, C.PoisonStack, { damagePerMs, endTime });
        }
        return;
    }
    const stack = world.create();
    world.add(stack, C.PoisonStack, { target: victim, source, damagePerMs, endTime });
}

/**
 * Tick the single poison stack a player can carry.
 *
 * Players deliberately differ from mobs here: exactly one stack at a time,
 * refreshed rather than accumulated, because a fresh bite replaces the old one.
 *
 * The body is a hook because every line of it is legacy-owned player state:
 * poison armor comes from the modifier pipeline, the health write must land on
 * the ServerPlayer (whose health the ECS does not own yet), and death runs
 * second-chance, pet despawn and two emits. What the ECS owns is the QUERY —
 * only actually-poisoned flowers are visited — and the expiry.
 */
export function playerPoisonSystem(queries: AfflictionQueries, deps: PlayerPoisonDeps) {
    const { tickPoison, onPoisonLapsed } = deps;
    const scratch: Entity[] = [];

    return (ctx: SystemContext): void => {
        const { world, cmd, now, deltaTime } = ctx;

        scratch.length = 0;
        queries.poisonedPlayers.chunks(chunk => {
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) scratch.push(entities[i] as Entity);
        });

        for (let i = 0; i < scratch.length; i++) {
            const player = scratch[i];
            if (!world.isAlive(player) || !world.has(player, C.Poisoned)) continue;
            if (now >= (world.get(player, C.Poisoned, 'until') as number)) {
                onPoisonLapsed(player);
                cmd.remove(player, C.Poisoned);
                continue;
            }
            tickPoison(player, deltaTime);
        }
        scratch.length = 0;
    };
}

/**
 * Slow a mob down for a while — the write half of the legacy `applySlow`.
 *
 * `factor` is the POST-resistance value: the caller has already run the
 * rarity contest (stallPower) against the mob's tier, since tier-vs-rarity is
 * config knowledge this layer does not hold. `Speed.base` is always the
 * unslowed speed, so a slow is a scale-down of `current` and the expiry
 * system restores it. Re-applying picks the stronger of the two slows and
 * always extends the timer, so standing in a web keeps the mob crawling.
 */
export function applySlowToEntity(
    world: World,
    victim: Entity,
    factor: number,
    until: number,
    now: number,
): void {
    // Nothing worth applying: leave the timer untouched so a negligible stall
    // can't extend a real one.
    if (factor >= 0.999) return;
    if (!world.has(victim, C.Speed)) return;

    const slowed = (world.get(victim, C.Speed, 'base') as number) * factor;
    if (!world.has(victim, C.Slowed)) {
        world.set(victim, C.Speed, 'current', slowed);
        world.add(victim, C.Slowed, { until });
        return;
    }
    const existingUntil = world.get(victim, C.Slowed, 'until') as number;
    if (existingUntil <= now || slowed < (world.get(victim, C.Speed, 'current') as number)) {
        world.set(victim, C.Speed, 'current', slowed);
    }
    world.set(victim, C.Slowed, 'until', Math.max(existingUntil, until));
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

export interface AfflictionDeps {
    mobPoison: MobPoisonDeps;
    playerPoison: PlayerPoisonDeps;
}

export function registerAfflictionSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: AfflictionQueries,
    deps: AfflictionDeps,
): void {
    scheduler.add('poisonStacks', Phase.Combat, poisonStackSystem(queries, deps.mobPoison));
    scheduler.add('playerPoison', Phase.Combat, playerPoisonSystem(queries, deps.playerPoison));
    // Input, not Combat: the legacy tick expired slows BEFORE moveEnemies ("so
    // a lapsed slow doesn't cost the mob a tick of speed"), and the AI's chase
    // steps read Speed.current in the Input phase — restoring afterwards would
    // slow every affected mob for one extra tick.
    scheduler.add('slowExpiry', Phase.Input, slowExpirySystem(queries));
}
