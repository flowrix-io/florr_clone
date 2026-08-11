"use strict";
/**
 * Self-test for the ECS spatial grid.
 *
 * The benchmark proves the grid is fast; these assert it is CORRECT, which is
 * the part that actually matters. Each case pins a property that the production
 * enemyGrid.ts was fixed to have, so a future rewrite cannot quietly lose it:
 * fat insertion, exactly-once dedup, pet/dead exclusion, degenerate-value
 * survival, and clean reuse of retained cells between rebuilds.
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
exports.runGridSelfTest = runGridSelfTest;
const C = __importStar(require("../components"));
const prefabs_1 = require("../prefabs");
const world_1 = require("../world");
const grid_1 = require("./grid");
function runGridSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    function makeGrid() {
        const world = new world_1.World();
        const grid = new grid_1.SpatialGrid();
        grid.ensureStampCapacity(4096);
        const source = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
        const out = new grid_1.GridQueryResult(64);
        return { world, grid, source, out };
    }
    function addMob(world, id, x, y, radius) {
        return (0, prefabs_1.spawnMob)(world, {
            id, type: 'bee', tier: 'common', x, y,
            health: 10, maxHealth: 10, speed: 0, damage: 1, radius, now: 0,
        });
    }
    /** Collect returned handles as a Set for order-independent assertions. */
    function handlesOf(out) {
        const s = new Set();
        for (let i = 0; i < out.count; i++)
            s.add(out.handles[i]);
        return s;
    }
    // -- basic hit and miss ---------------------------------------------------
    {
        const { world, grid, source, out } = makeGrid();
        const near = addMob(world, 'near', 100, 100, 20);
        addMob(world, 'far', 9000, 9000, 20);
        grid.rebuild(world, source);
        grid.query(100, 100, 30, out);
        checkEqual('query returns the nearby mob only', out.count, 1);
        checkEqual('returned handle is correct', out.handles[0], near);
        checkEqual('returned position rides along', out.x[0], 100);
        checkEqual('returned radius rides along', out.radius[0], 20);
    }
    // -- fat insertion --------------------------------------------------------
    {
        // The property that lets callers query with only their OWN radius: a
        // large mob is inserted into every cell it overlaps, so a small query
        // far from its CENTRE but touching its EDGE still finds it. Under
        // centre-only insertion every caller had to inflate its query by the
        // largest mob radius in the world.
        const { world, grid, source, out } = makeGrid();
        const big = addMob(world, 'big', 0, 0, 1500);
        grid.rebuild(world, source);
        // 1200px away — several cells from the centre, well inside the radius.
        grid.query(1200, 0, 10, out);
        checkEqual('big mob found from far outside its centre cell', out.count, 1);
        checkEqual('and it is the right one', out.handles[0], big);
        // Genuinely out of reach must still miss.
        grid.query(4000, 0, 10, out);
        checkEqual('big mob not returned when out of reach', out.count, 0);
    }
    // -- exactly-once dedup ---------------------------------------------------
    {
        // A mob wider than a cell lives in several buckets. Callers apply damage
        // per returned candidate, so returning it twice is a double hit.
        const { world, grid, source, out } = makeGrid();
        addMob(world, 'wide', 0, 0, 1500);
        grid.rebuild(world, source);
        // A query wide enough to span many of the cells the mob occupies.
        grid.query(0, 0, 2000, out);
        checkEqual('wide mob returned exactly once', out.count, 1);
        checkEqual('dedup did not drop it', handlesOf(out).size, 1);
    }
    // -- several mobs, one query ----------------------------------------------
    {
        const { world, grid, source, out } = makeGrid();
        const ids = [];
        for (let i = 0; i < 10; i++)
            ids.push(addMob(world, `m${i}`, i * 10, 0, 15));
        grid.rebuild(world, source);
        grid.query(45, 0, 60, out);
        const returned = handlesOf(out);
        checkEqual('no duplicates across cells', returned.size, out.count);
        check('cluster members are returned', returned.has(ids[4]) && returned.has(ids[5]));
    }
    // -- pets and the dead are excluded ---------------------------------------
    {
        const { world, grid, source, out } = makeGrid();
        const wild = addMob(world, 'wild', 0, 0, 20);
        const pet = addMob(world, 'pet', 10, 0, 20);
        const dead = addMob(world, 'dead', 20, 0, 20);
        const owner = world.create();
        world.add(pet, C.PetOwner, { owner, image: '' });
        world.add(dead, C.IsDead);
        grid.rebuild(world, source);
        grid.query(10, 0, 100, out);
        const returned = handlesOf(out);
        check('wild mob present', returned.has(wild));
        check('pet excluded', !returned.has(pet));
        check('dead excluded', !returned.has(dead));
        checkEqual('only the wild mob', out.count, 1);
    }
    // -- retained cells are reset between rebuilds ----------------------------
    {
        // Cells are reused rather than reallocated, so a stale entry surviving a
        // rebuild is the obvious failure mode of that optimisation.
        const { world, grid, source, out } = makeGrid();
        const mover = addMob(world, 'mover', 0, 0, 20);
        grid.rebuild(world, source);
        grid.query(0, 0, 50, out);
        checkEqual('mob found at its first position', out.count, 1);
        // Move it several cells away and rebuild.
        world.write(mover, C.Position, { x: 5000, y: 5000 });
        grid.rebuild(world, source);
        grid.query(0, 0, 50, out);
        checkEqual('old cell no longer returns it', out.count, 0);
        grid.query(5000, 5000, 50, out);
        checkEqual('new cell returns it', out.count, 1);
    }
    // -- destroyed entities leave the grid ------------------------------------
    {
        const { world, grid, source, out } = makeGrid();
        const doomed = addMob(world, 'doomed', 0, 0, 20);
        grid.rebuild(world, source);
        grid.query(0, 0, 50, out);
        checkEqual('present before destroy', out.count, 1);
        world.destroy(doomed);
        grid.rebuild(world, source);
        grid.query(0, 0, 50, out);
        checkEqual('absent after destroy', out.count, 0);
    }
    // -- degenerate values are survivable -------------------------------------
    {
        // These bounds exist because a NaN/Infinity/absurd value made the
        // cell-range loops span the coordinate space and spin at 100% CPU —
        // the long-session server hang. The grid must drop such entities, not
        // hang, and must keep serving everything else.
        const { world, grid, source, out } = makeGrid();
        const good = addMob(world, 'good', 0, 0, 20);
        addMob(world, 'nan', NaN, 0, 20);
        addMob(world, 'inf', Infinity, Infinity, 20);
        addMob(world, 'huge', 1e20, 1e20, 20);
        grid.rebuild(world, source);
        grid.query(0, 0, 50, out);
        checkEqual('degenerate mobs are skipped, good one still served', out.count, 1);
        checkEqual('and it is the good one', out.handles[0], good);
        // A degenerate QUERY must bail rather than scan forever.
        grid.query(NaN, 0, 30, out);
        checkEqual('NaN query returns nothing', out.count, 0);
        grid.query(1e20, 1e20, 30, out);
        checkEqual('absurd query position returns nothing', out.count, 0);
    }
    // -- result buffer growth --------------------------------------------------
    {
        // The out buffer starts small and must grow rather than truncate: a
        // silently truncated candidate list is a missed collision.
        const { world, grid, source } = makeGrid();
        const small = new grid_1.GridQueryResult(4);
        for (let i = 0; i < 200; i++)
            addMob(world, `s${i}`, (i % 20) * 5, Math.floor(i / 20) * 5, 10);
        grid.rebuild(world, source);
        grid.query(50, 25, 400, small);
        checkEqual('all 200 candidates returned', small.count, 200);
        checkEqual('no duplicates after growth', handlesOf(small).size, 200);
    }
    // -- stamp table bounds ----------------------------------------------------
    {
        // Entities whose index is past the stamp table cannot be deduped, so the
        // grid skips them rather than risk returning one twice. Growing the
        // table must bring them back.
        const world = new world_1.World();
        const grid = new grid_1.SpatialGrid();
        const source = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
        const out = new grid_1.GridQueryResult(64);
        for (let i = 0; i < 50; i++)
            addMob(world, `b${i}`, i, 0, 5);
        grid.ensureStampCapacity(4096);
        grid.rebuild(world, source);
        grid.query(25, 0, 200, out);
        checkEqual('all mobs served with a sized stamp table', out.count, 50);
    }
    return failures;
}
