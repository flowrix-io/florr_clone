"use strict";
/**
 * Mob-vs-mob collision and pet melee — the port of `checkEnemyEnemyCollisions`.
 *
 * The original was an all-pairs loop with a `getMobStats` call per pair, i.e.
 * O(E²) with a config lookup inside. That was survivable at a few hundred wild
 * mobs, but pet eggs multiply the population (an apex egg spawns 3 pets, a
 * centipede pet is 10 entities) and this pass alone froze the tick once several
 * players stacked eggs. It was rewritten to bucket into a uniform grid, and
 * that structure is preserved here exactly.
 *
 * Note this pass uses its OWN grid rather than the shared SpatialGrid, for the
 * same reason it always did: it must include PETS, while the shared grid
 * deliberately excludes them so broad-phase callers do not have to filter.
 *
 * The damage callbacks are injected. Applying a mob death means awarding XP and
 * drops and emitting to clients, and the original reached back into server.ts
 * through `require('../server')` mid-function to do it — a circular import that
 * only worked because it was lazy. Injecting the two hooks removes that cycle.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.entityIndex = void 0;
exports.createMobCollisionQueries = createMobCollisionQueries;
exports.mobCollisionSystem = mobCollisionSystem;
exports.registerMobCollisionSystem = registerMobCollisionSystem;
const C = __importStar(require("../components"));
const entity_1 = require("../entity");
Object.defineProperty(exports, "entityIndex", { enumerable: true, get: function () { return entity_1.entityIndex; } });
const system_1 = require("../system");
/** Gap maintained between mobs, on top of their radii. */
const MOB_COLLISION_BUFFER = 5;
/**
 * Cap on how far a pair may be separated in one tick.
 *
 * Mobs that spawn (or wander) deeply overlapped ease apart over a few ticks
 * instead of teleporting. Steady walking-into-each-other overlap is far below
 * this, so normal contact still resolves fully within the tick.
 */
const MAX_PUSH_PER_TICK = 10;
/**
 * Broad-phase cell size. Must exceed the largest collision reach; 512 matches
 * the shared grid and comfortably covers real mob sizes.
 */
const COLLISION_CELL_SIZE = 512;
/** Coordinates past this make the cell-range loops non-terminating. */
const MAX_SANE_WORLD_COORD = 1e9;
function createMobCollisionQueries(world) {
    return {
        mobs: world.query([C.Position, C.Radius, C.Health, C.Damage, C.IsEnemy], [C.IsDead]),
    };
}
function cellKey(cx, cy) {
    return ((cy + 1024) << 16) | ((cx + 1024) & 0xFFFF);
}
function mobCollisionSystem(queries, deps) {
    const { resolveWall, noMobCollision, creditDamage, onDamaged, onKilled, activity } = deps;
    // Reused across ticks so a normal tick allocates nothing.
    const entries = [];
    const grid = new Map();
    const activeBuckets = [];
    /** Apply damage, reporting death exactly once. */
    function applyDamage(world, victim, amount, attackerOwner) {
        if (world.has(victim, C.IsDead))
            return;
        const current = world.get(victim, C.Health, 'current');
        if (current <= 0)
            return;
        // A pet's kill is credited to its owner; contributors are keyed by player.
        if (attackerOwner !== entity_1.NULL_ENTITY && world.isAlive(attackerOwner)) {
            creditDamage(victim, attackerOwner, amount);
        }
        const next = Math.max(0, current - amount);
        world.set(victim, C.Health, 'current', next);
        onDamaged(victim);
        if (next <= 0) {
            world.add(victim, C.IsDead);
            onKilled(victim);
        }
    }
    return (ctx) => {
        const world = ctx.world;
        // --- broad phase -------------------------------------------------------
        entries.length = 0;
        for (let i = 0; i < activeBuckets.length; i++)
            activeBuckets[i].length = 0;
        activeBuckets.length = 0;
        let maxRadius = 0;
        queries.mobs.chunks(chunk => {
            const pos = chunk.cols(C.Position);
            const rad = chunk.cols(C.Radius);
            const dmg = chunk.cols(C.Damage);
            const entities = chunk.entities;
            for (let i = 0; i < chunk.count; i++) {
                const entity = entities[i];
                const x = pos.x[i];
                const y = pos.y[i];
                // A degenerate position makes the cell-range loops below spin
                // forever (past 2^53, `cx++` is a no-op). Such a mob sits this
                // pass out — and, because it never enters `entries`, it is also
                // excluded as a pair target.
                if (!Number.isFinite(x) || !Number.isFinite(y))
                    continue;
                if (Math.abs(x) > MAX_SANE_WORLD_COORD || Math.abs(y) > MAX_SANE_WORLD_COORD)
                    continue;
                // Far from every player: sit this tick out, most ticks. Done
                // here rather than in the narrow phase so a distant mob costs
                // neither an Entry nor a bucket slot.
                if (!activity.shouldStep(entity, x, y, ctx.tick))
                    continue;
                const radius = rad.value[i];
                if (radius > maxRadius)
                    maxRadius = radius;
                const isPet = world.has(entity, C.PetOwner);
                const head = world.has(entity, C.CentipedeSegment)
                    ? world.get(entity, C.CentipedeSegment, 'head')
                    : entity_1.NULL_ENTITY;
                entries.push({
                    entity,
                    x,
                    y,
                    radius,
                    order: entries.length,
                    isPet,
                    owner: isPet ? world.get(entity, C.PetOwner, 'owner') : entity_1.NULL_ENTITY,
                    damage: dmg.value[i],
                    head,
                    noCollision: noMobCollision(entity),
                });
            }
        });
        grid.clear();
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const cx = Math.floor(entry.x / COLLISION_CELL_SIZE);
            const cy = Math.floor(entry.y / COLLISION_CELL_SIZE);
            const key = cellKey(cx, cy);
            let bucket = grid.get(key);
            if (bucket === undefined) {
                bucket = [];
                grid.set(key, bucket);
                activeBuckets.push(bucket);
            }
            bucket.push(entry);
        }
        // --- narrow phase ------------------------------------------------------
        for (let i = 0; i < entries.length; i++) {
            const self = entries[i];
            if (!world.isAlive(self.entity) || world.has(self.entity, C.IsDead))
                continue;
            // Anything close enough to touch is within this mob's radius plus the
            // largest radius in play plus the buffer.
            const reach = self.radius + maxRadius + MOB_COLLISION_BUFFER;
            const minCX = Math.floor((self.x - reach) / COLLISION_CELL_SIZE);
            const maxCX = Math.floor((self.x + reach) / COLLISION_CELL_SIZE);
            const minCY = Math.floor((self.y - reach) / COLLISION_CELL_SIZE);
            const maxCY = Math.floor((self.y + reach) / COLLISION_CELL_SIZE);
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cx = minCX; cx <= maxCX; cx++) {
                    const bucket = grid.get(cellKey(cx, cy));
                    if (bucket === undefined)
                        continue;
                    for (let bi = 0; bi < bucket.length; bi++) {
                        const other = bucket[bi];
                        // Each pair is processed once, from the lower-indexed
                        // side — this replaces the old `j > i` inner loop.
                        if (other.order <= self.order)
                            continue;
                        if (!world.isAlive(other.entity) || world.has(other.entity, C.IsDead))
                            continue;
                        // Segments of one centipede never push each other: the
                        // chain-follow pass keeps them in formation, and physical
                        // push-apart makes them tangle and spin. The head's AI
                        // steers around its own body instead.
                        if (self.head !== entity_1.NULL_ENTITY && self.head === other.head)
                            continue;
                        // Mobs flagged no_mob_collision neither push nor are pushed.
                        if (self.noCollision || other.noCollision)
                            continue;
                        const dx = other.x - self.x;
                        const dy = other.y - self.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const minDistance = self.radius + other.radius + MOB_COLLISION_BUFFER;
                        if (!(distance < minDistance && distance > 0))
                            continue;
                        const push = Math.min((minDistance - distance) / 2, MAX_PUSH_PER_TICK);
                        const pushX = (dx / distance) * push;
                        const pushY = (dy / distance) * push;
                        self.x -= pushX;
                        self.y -= pushY;
                        other.x += pushX;
                        other.y += pushY;
                        // Separation must not shove either mob into a wall. This
                        // pass runs after the per-mob wall pass, so a violation
                        // would be visible to clients for a full tick.
                        const w1 = resolveWall(self.x, self.y, self.radius);
                        self.x = w1.x;
                        self.y = w1.y;
                        const w2 = resolveWall(other.x, other.y, other.radius);
                        other.x = w2.x;
                        other.y = w2.y;
                        world.write(self.entity, C.Position, { x: self.x, y: self.y });
                        world.write(other.entity, C.Position, { x: other.x, y: other.y });
                        // Pet/wild contact deals damage both ways, every tick,
                        // with no cooldown. Pet-vs-pet and wild-vs-wild do not.
                        if (self.isPet === other.isPet)
                            continue;
                        const pet = self.isPet ? self : other;
                        const wild = self.isPet ? other : self;
                        applyDamage(world, wild.entity, pet.damage, pet.owner);
                        applyDamage(world, pet.entity, wild.damage, entity_1.NULL_ENTITY);
                    }
                }
            }
        }
    };
}
function registerMobCollisionSystem(scheduler, queries, deps) {
    // Combat phase: after all movement, before the Lifetime reaper, so a mob
    // killed here is still readable by anything that runs later this tick.
    scheduler.add('mobCollision', system_1.Phase.Combat, mobCollisionSystem(queries, deps));
}
