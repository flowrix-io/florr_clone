/**
 * Centipede chain systems — ports of `repairSeveredCentipedeChains` and
 * `propagateCentipedeChains`.
 *
 * Two passes, in this order, because the second depends on the first having
 * fixed up any chain broken by a death last tick:
 *
 *   1. REPAIR   a body segment whose leader no longer exists is promoted to a
 *               new chain head, and everything behind it is re-chained under it,
 *               so each half of a severed centipede keeps moving.
 *   2. PROPAGATE each head's chain is walked in segment order so every segment
 *               sees its leader's freshly-updated position for this tick.
 *
 * ---------------------------------------------------------------------------
 * What the ECS port actually fixes
 * ---------------------------------------------------------------------------
 * The original addressed chain links by STRING ID, which forced two things:
 *
 *  - Repair walked the chain with `enemies.find(e => e.leaderId === leader.id)`
 *    inside a loop, i.e. an O(n) scan per segment over ~1400 mobs. Here the
 *    follower index is built once per tick, so repair is linear overall.
 *
 *  - A recycled mob id could resolve to a DIFFERENT mob, silently splicing an
 *    unrelated centipede into the chain. Entity handles carry a generation, so
 *    a dead leader is detected as dead rather than confused for its replacement.
 *
 * The cycle guard is kept regardless. Two severed segments pointing at each
 * other made the original's `find` loop return chain members forever and spin
 * the tick at 100% CPU — a hang that stops logging and stops serving. Handles
 * do not prevent a genuine cycle in the follower graph, so the visited set
 * stays, and it also bounds the walk to at most the chain's length.
 */

import * as C from '../components';
import { Entity, NULL_ENTITY } from '../entity';
import { Phase, SystemContext } from '../system';
import { Query, World } from '../world';

/** Spacing between consecutive segments, as a fraction of segment diameter. */
const SEGMENT_SPACING_FACTOR = 0.9;

/**
 * Resolves a wall collision for a segment after it is repositioned.
 * Injected so the ECS layer does not depend on the tile grid.
 */
export type ResolveWall = (x: number, y: number, halfSize: number) => { x: number; y: number };

export interface CentipedeQueries {
    segments: Query;
}

export function createCentipedeQueries(world: World): CentipedeQueries {
    return {
        segments: world.query([C.CentipedeSegment, C.Position, C.Angle, C.Radius], [C.IsDead]),
    };
}

/**
 * Promote segments whose leader has died, and re-chain everything behind them.
 */
export function centipedeRepairSystem(queries: CentipedeQueries) {
    // Reused across ticks so a normal tick allocates nothing.
    const followerOf = new Map<number, Entity>();
    const orphans: Entity[] = [];
    const visited = new Set<number>();

    return (ctx: SystemContext): void => {
        const world = ctx.world;

        followerOf.clear();
        orphans.length = 0;

        // One pass builds the leader -> follower index AND collects orphans,
        // replacing the original's repeated linear scans.
        queries.segments.chunks(chunk => {
            const segment = chunk.cols(C.CentipedeSegment);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                const self = entities[i] as Entity;
                const leader = segment.leader[i] as Entity;
                if (leader === NULL_ENTITY) continue;

                if (world.isAlive(leader)) {
                    followerOf.set(leader, self);
                } else {
                    orphans.push(self);
                }
            }
        });

        for (const orphan of orphans) {
            if (!world.isAlive(orphan)) continue;

            // Every orphan is promoted. An orphan can never be picked up by
            // another orphan's re-chaining walk: `followerOf` is only populated
            // from segments whose leader is ALIVE, so a segment with a dead
            // leader is never a walk target. Two adjacent deaths therefore
            // produce two new heads, which matches the original behaviour of
            // promoting every segment whose leader is missing.
            world.write(orphan, C.CentipedeSegment, {
                leader: NULL_ENTITY,
                head: orphan,
                segmentIndex: 0,
            });

            visited.clear();
            visited.add(orphan);

            let leader = orphan;
            let nextIndex = 1;
            while (true) {
                const follower = followerOf.get(leader);
                if (follower === undefined) break;
                if (visited.has(follower)) {
                    // Corrupt chain: break the cycle so it cannot recur next tick.
                    world.set(follower, C.CentipedeSegment, 'leader', NULL_ENTITY);
                    break;
                }
                visited.add(follower);
                world.write(follower, C.CentipedeSegment, {
                    head: orphan,
                    segmentIndex: nextIndex++,
                });
                leader = follower;
            }
        }
    };
}

/**
 * Position every segment behind its leader.
 *
 * Segments are processed in ascending `segmentIndex` per chain so each one sees
 * its leader's already-updated position for this tick — processing out of order
 * makes the chain lag by one segment per tick and visibly stretch.
 */
export function centipedePropagateSystem(queries: CentipedeQueries, resolveWall: ResolveWall) {
    const chains = new Map<number, Entity[]>();

    return (ctx: SystemContext): void => {
        const world = ctx.world;
        chains.clear();

        queries.segments.chunks(chunk => {
            const segment = chunk.cols(C.CentipedeSegment);
            const entities = chunk.entities;

            for (let i = 0; i < chunk.count; i++) {
                // A segment with no leader IS a head; it moves under normal AI.
                if ((segment.leader[i] as Entity) === NULL_ENTITY) continue;
                const head = segment.head[i] as Entity;
                if (head === NULL_ENTITY) continue;

                let chain = chains.get(head);
                if (chain === undefined) {
                    chain = [];
                    chains.set(head, chain);
                }
                chain.push(entities[i] as Entity);
            }
        });

        for (const chain of chains.values()) {
            chain.sort((a, b) =>
                (world.get(a, C.CentipedeSegment, 'segmentIndex') as number)
                - (world.get(b, C.CentipedeSegment, 'segmentIndex') as number));

            for (const segment of chain) {
                const leader = world.get(segment, C.CentipedeSegment, 'leader') as Entity;
                if (!world.isAlive(leader)) continue;

                const leaderX = world.get(leader, C.Position, 'x') as number;
                const leaderY = world.get(leader, C.Position, 'y') as number;
                const selfX = world.get(segment, C.Position, 'x') as number;
                const selfY = world.get(segment, C.Position, 'y') as number;
                const halfSize = world.get(segment, C.Radius, 'value') as number;

                const spacing = halfSize * 2 * SEGMENT_SPACING_FACTOR;
                const dx = selfX - leaderX;
                const dy = selfY - leaderY;
                // `|| 1` reproduces the original's guard for a segment exactly
                // coincident with its leader, which would otherwise divide by 0
                // and place it at NaN.
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;

                const nextX = leaderX + (dx / distance) * spacing;
                const nextY = leaderY + (dy / distance) * spacing;

                const resolved = resolveWall(nextX, nextY, halfSize);
                world.write(segment, C.Position, { x: resolved.x, y: resolved.y });
                world.set(segment, C.Angle, 'value', Math.atan2(leaderY - resolved.y, leaderX - resolved.x));

                // Segments inherit the head's chase state so the whole chain
                // renders consistently.
                if (world.has(segment, C.MobAI)) {
                    const head = world.get(segment, C.CentipedeSegment, 'head') as Entity;
                    if (world.isAlive(head) && world.has(head, C.MobAI)) {
                        world.set(segment, C.MobAI, 'isChasing', world.get(head, C.MobAI, 'isChasing'));
                    }
                }
            }
        }
    };
}

export function registerCentipedeSystems(
    scheduler: { add: (name: string, phase: Phase, run: (ctx: SystemContext) => void) => unknown },
    queries: CentipedeQueries,
    resolveWall: ResolveWall,
): void {
    // Repair must precede propagation: a chain severed by a death last tick has
    // to be re-headed before anyone tries to follow a dead leader.
    scheduler.add('centipedeRepair', Phase.Simulation, centipedeRepairSystem(queries));
    scheduler.add('centipedePropagate', Phase.Simulation, centipedePropagateSystem(queries, resolveWall));
}
