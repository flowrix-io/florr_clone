"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = exports.Phase = void 0;
const commands_1 = require("./commands");
/**
 * Execution phases, in run order. The numeric values are the sort key.
 *
 * Adding a phase means picking a slot in the existing tick order — do not
 * renumber the others, and do not reorder them to "clean up": several of these
 * boundaries encode real dependencies (bots read the spatial index built in
 * SpatialIndex; the broadcast in Networking must see the final post-combat
 * state, otherwise clients render a tick-old world).
 */
var Phase;
(function (Phase) {
    /** Rebuild spatial acceleration structures for this tick. */
    Phase[Phase["SpatialIndex"] = 100] = "SpatialIndex";
    /** Sample player inputs and run bot AI into the same input fields. */
    Phase[Phase["Input"] = 200] = "Input";
    /** Movement, physics integration, collision resolution. */
    Phase[Phase["Simulation"] = 300] = "Simulation";
    /** Damage application, poison, knockback, death marking. */
    Phase[Phase["Combat"] = 400] = "Combat";
    /** Spawners, waves, drops. */
    Phase[Phase["Spawning"] = 500] = "Spawning";
    /** Expiry, despawn, timers, garbage collection of stale state. */
    Phase[Phase["Lifetime"] = 600] = "Lifetime";
    /** Encode and send state to clients. */
    Phase[Phase["Networking"] = 700] = "Networking";
})(Phase || (exports.Phase = Phase = {}));
class Scheduler {
    constructor(world) {
        this.world = world;
        this.systems = [];
        this.sorted = false;
        this.tickCounter = 0;
        /**
         * Whether to time each system. The clock calls are cheap but not free at
         * 30Hz across dozens of systems, so this stays off until the debug menu
         * asks for it.
         */
        this.profiling = false;
        this.cmd = new commands_1.CommandBuffer(world);
    }
    /** Register a system. Order within a phase is registration order. */
    add(name, phase, run, options = {}) {
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
    setEnabled(name, enabled) {
        const s = this.systems.find(x => x.name === name);
        if (!s)
            return false;
        s.enabled = enabled;
        return true;
    }
    /** Registered system names, in execution order. */
    names() {
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
    tick(deltaTime, deltaMs, now) {
        this.ensureSorted();
        const tick = ++this.tickCounter;
        const ctx = {
            world: this.world,
            cmd: this.cmd,
            deltaTime,
            deltaMs,
            now,
            tick,
        };
        let currentPhase;
        for (const system of this.systems) {
            if (currentPhase !== undefined && system.phase !== currentPhase) {
                this.cmd.flush();
            }
            currentPhase = system.phase;
            if (!system.enabled)
                continue;
            if (system.interval > 1 && tick % system.interval !== system.offset)
                continue;
            if (this.profiling) {
                const start = performance.now();
                system.run(ctx);
                const elapsed = performance.now() - start;
                system.accumMs += elapsed;
                system.calls++;
                if (elapsed > system.maxMs)
                    system.maxMs = elapsed;
            }
            else {
                system.run(ctx);
            }
        }
        this.cmd.flush();
    }
    /**
     * Read and reset per-system timings. Returns an empty array when profiling
     * is off. Sorted slowest-first so the debug menu can show the top offenders.
     */
    drainTimings() {
        const out = [];
        for (const s of this.systems) {
            if (s.calls === 0)
                continue;
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
    ensureSorted() {
        if (this.sorted)
            return;
        // Stable sort by phase; registration order breaks ties.
        this.systems.sort((a, b) => a.phase - b.phase);
        this.sorted = true;
    }
}
exports.Scheduler = Scheduler;
