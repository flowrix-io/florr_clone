/**
 * Deferred structural changes.
 *
 * Creating, destroying or re-componenting an entity while a query is iterating
 * mutates the very arrays being walked: archetypes keep rows dense by
 * swap-remove, so destroying the current entity slides an unvisited one into the
 * slot the loop just passed, and it is silently skipped. That class of bug is
 * miserable to find — an entity survives one tick in a thousand.
 *
 * So systems that need to change the shape of the world record their intent
 * here and the scheduler flushes it between phases, when nothing is iterating.
 * Plain FIELD WRITES need none of this and should be done directly — only
 * create/destroy/add/remove are structural.
 *
 * The buffer holds its ops in flat parallel arrays and is reused every tick, so
 * a normal tick's worth of spawns and despawns allocates nothing.
 */

import { ComponentType, Schema } from './component';
import { Entity } from './entity';
import { ComponentInit, World } from './world';

const enum Op {
    Destroy = 0,
    Add = 1,
    Remove = 2,
}

export class CommandBuffer {
    private ops: number[] = [];
    private entities: Entity[] = [];
    private types: Array<ComponentType<any> | undefined> = [];
    private values: Array<ComponentInit<any> | undefined> = [];
    private length = 0;

    constructor(private readonly world: World) {}

    /** Queue destruction of `e`. Safe to queue the same entity twice. */
    destroy(e: Entity): void {
        this.push(Op.Destroy, e, undefined, undefined);
    }

    /** Queue adding `type` to `e`, optionally initialising fields. */
    add<S extends Schema>(e: Entity, type: ComponentType<S>, values?: ComponentInit<S>): void {
        this.push(Op.Add, e, type, values);
    }

    /** Queue removal of `type` from `e`. */
    remove(e: Entity, type: ComponentType<any>): void {
        this.push(Op.Remove, e, type, undefined);
    }

    /** Number of queued operations. */
    get size(): number {
        return this.length;
    }

    private push(
        op: Op,
        e: Entity,
        type: ComponentType<any> | undefined,
        values: ComponentInit<any> | undefined,
    ): void {
        const i = this.length++;
        this.ops[i] = op;
        this.entities[i] = e;
        this.types[i] = type;
        this.values[i] = values;
    }

    /**
     * Apply every queued operation in order, then reset.
     *
     * Operations targeting an entity that died earlier in the same flush are
     * skipped rather than throwing: two systems independently deciding to kill
     * the same mob in one tick is normal (a petal hit and a poison tick landing
     * together), and should not be an error.
     */
    flush(): void {
        const world = this.world;
        for (let i = 0; i < this.length; i++) {
            const e = this.entities[i];
            if (!world.isAlive(e)) continue;
            switch (this.ops[i]) {
                case Op.Destroy:
                    world.destroy(e);
                    break;
                case Op.Add:
                    world.add(e, this.types[i]!, this.values[i]);
                    break;
                case Op.Remove:
                    world.remove(e, this.types[i]!);
                    break;
            }
        }
        this.clear();
    }

    /** Drop every queued operation without applying it. */
    clear(): void {
        // Null out the reference arrays so a queued component payload cannot
        // outlive the tick that queued it.
        for (let i = 0; i < this.length; i++) {
            this.types[i] = undefined;
            this.values[i] = undefined;
        }
        this.length = 0;
    }
}
