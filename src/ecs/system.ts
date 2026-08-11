/**
 * System scheduling.
 *
 * Systems are ordered functions that read and write component storage. The
 * phase list below is deliberately the order the existing server tick already
 * runs in (see `start_loop` in server.ts) rather than an idealised one, so the
 * conversion preserves behaviour: spatial index first because bot targeting
 * queries it, inputs before simulation, lifetime/despawn after combat has had a
 * chance to kill things this tick, networking last.
 *
 * Between phases the command buffer is flushed, so every structural change a
 * phase requested is visible to the next one and nothing mutates the world
 * while a query is walking it.
 */

import { CommandBuffer } from './commands';
import { World } from './world';

/**
 * Execution phases, in run order. The numeric values are the sort key.
 *
 * Adding a phase means picking a slot in the existing tick order — do not
 * renumber the others, and do not reorder them to "clean up": several of these
 * boundaries encode real dependencies (bots read the spatial index built in
 * SpatialIndex; the broadcast in Networking must see the final post-combat
 * state, otherwise clients render a tick-old world).
 */
export enum Phase {
    /** Rebuild spatial acceleration structures for this tick. */
    SpatialIndex = 100,
    /** Sample player inputs and run bot AI into the same input fields. */
    Input = 200,
    /** Movement, physics integration, collision resolution. */
    Simulation = 300,
    /** Damage application, poison, knockback, death marking. */
    Combat = 400,
    /** Spawners, waves, drops. */
    Spawning = 500,
    /** Expiry, despawn, timers, garbage collection of stale state. */
    Lifetime = 600,
    /** Encode and send state to clients. */
    Networking = 700,
}

/** Everything a system is given for one tick. */
export interface SystemContext {
    readonly world: World;
    /** Queue structural changes here; flushed between phases. */
    readonly cmd: CommandBuffer;
    /** Smoothed timestep in SECONDS (see the delta filtering in server.ts). */
    readonly deltaTime: number;
    /** The same timestep in milliseconds. */
    readonly deltaMs: number;
    /** Server clock in ms for this tick, sampled once so all systems agree. */
    readonly now: number;
    /** Monotonic tick counter, for strided passes (`tick % 5 === 0`). */
    readonly tick: number;
}

export type SystemFn = (ctx: SystemContext) => void;

export interface SystemOptions {
    /**
     * Run only every Nth tick. Mirrors the existing strided passes (viewport
     * status, despawn sweeps) that run at ~6Hz rather than 30Hz.
     */
    readonly interval?: number;
    /** Offset within the stride, so two heavy passes never land on one tick. */
    readonly offset?: number;
}

interface RegisteredSystem {
    readonly name: string;
    readonly phase: Phase;
    readonly run: SystemFn;
    readonly interval: number;
    readonly offset: number;
    enabled: boolean;
    /** Accumulated run time in ms since the last drain. */
    accumMs: number;
    calls: number;
    maxMs: number;
}

/** Per-system timing, drained for the in-game debug menu's tick graphs. */
export interface SystemTiming {
    name: string;
    phase: string;
    /** Mean ms per call over the sample window. */
    avgMs: number;
    /** Worst single call in the window. */
    maxMs: number;
    calls: number;
}

export class Scheduler {
    private readonly systems: RegisteredSystem[] = [];
    private readonly cmd: CommandBuffer;
    private sorted = false;
    private tickCounter = 0;

    /**
     * Whether to time each system. The clock calls are cheap but not free at
     * 30Hz across dozens of systems, so this stays off until the debug menu
     * asks for it.
     */
    profiling = false;

    constructor(private readonly world: World) {
        this.cmd = new CommandBuffer(world);
    }

    /** Register a system. Order within a phase is registration order. */
    add(name: string, phase: Phase, run: SystemFn, options: SystemOptions = {}): this {
        if (this.systems.some(s => s.name === name)) {
            throw new Error(`Duplicate system name "${name}"`);
        }
        this.systems.push({
            name,
            phase,
            run,
            interval: Math.max(1, options.interval ?? 1),
            offset: options.offset ?? 0,
            enabled: true,
            accumMs: 0,
            calls: 0,
            maxMs: 0,
        });
        this.sorted = false;
        return this;
    }

    /** Turn a system on or off at runtime (admin commands, debug menu). */
    setEnabled(name: string, enabled: boolean): boolean {
        const s = this.systems.find(x => x.name === name);
        if (!s) return false;
        s.enabled = enabled;
        return true;
    }

    /** Registered system names, in execution order. */
    names(): string[] {
        this.ensureSorted();
        return this.systems.map(s => s.name);
    }

    /**
     * Run one tick.
     *
     * `deltaTime`/`deltaMs` come from the caller's smoothed timestep, and `now`
     * is sampled once by the caller so every system in the tick agrees on the
     * clock — several existing systems compare against absolute deadlines
     * (`poisonUntil`, `despawnAt`, cooldown end times) and would behave subtly
     * differently if each re-read the clock.
     */
    tick(deltaTime: number, deltaMs: number, now: number): void {
        this.ensureSorted();
        const tick = ++this.tickCounter;

        const ctx: SystemContext = {
            world: this.world,
            cmd: this.cmd,
            deltaTime,
            deltaMs,
            now,
            tick,
        };

        let currentPhase: Phase | undefined;
        for (const system of this.systems) {
            if (currentPhase !== undefined && system.phase !== currentPhase) {
                this.cmd.flush();
            }
            currentPhase = system.phase;

            if (!system.enabled) continue;
            if (system.interval > 1 && tick % system.interval !== system.offset) continue;

            if (this.profiling) {
                const start = performance.now();
                system.run(ctx);
                const elapsed = performance.now() - start;
                system.accumMs += elapsed;
                system.calls++;
                if (elapsed > system.maxMs) system.maxMs = elapsed;
            } else {
                system.run(ctx);
            }
        }

        this.cmd.flush();
    }

    /**
     * Read and reset per-system timings. Returns an empty array when profiling
     * is off. Sorted slowest-first so the debug menu can show the top offenders.
     */
    drainTimings(): SystemTiming[] {
        const out: SystemTiming[] = [];
        for (const s of this.systems) {
            if (s.calls === 0) continue;
            out.push({
                name: s.name,
                phase: Phase[s.phase],
                avgMs: s.accumMs / s.calls,
                maxMs: s.maxMs,
                calls: s.calls,
            });
            s.accumMs = 0;
            s.calls = 0;
            s.maxMs = 0;
        }
        out.sort((a, b) => b.avgMs - a.avgMs);
        return out;
    }

    private ensureSorted(): void {
        if (this.sorted) return;
        // Stable sort by phase; registration order breaks ties.
        this.systems.sort((a, b) => a.phase - b.phase);
        this.sorted = true;
    }
}
