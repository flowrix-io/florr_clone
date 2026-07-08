"use strict";
// ── Maze mode (shared client + server) ──────────────────────────────────────
// A daily-rotating maze in the style of rrolf/florr's maze: a grid of walkable
// corridors carved out of solid void, with every corridor/void junction rounded
// by a quarter-circle fillet whose radius is one full grid cell ("rrolf walls").
//
// Each biome (garden/desert/ocean) has a fixed, hand-editable layout hardcoded
// below; the daily rotation only cycles which biome is active (day % 3). The
// server and every client build byte-identical mazes from the single small
// `mazeInfo { day }` message — no wall data goes over the wire.
//
// This module is intentionally self-contained (no imports from constants.ts)
// because constants.ts hooks its shared collision helpers into it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAZE_TEMPLATES = exports.MAZE_MAX_PETAL_RARITY_INDEX = exports.MAZE_ZONE_TIERS = exports.MAZE_BIOME_SECTIONS = exports.MAZE_BIOMES = exports.MAZE_CELL_SIZE = exports.MAZE_MAX_TEMPLATE_DIM = exports.MAZE_MIN_TEMPLATE_DIM = exports.MAZE_ORIGIN_Y = exports.MAZE_ORIGIN_X = void 0;
exports.getActiveMaze = getActiveMaze;
exports.getCurrentMazeDay = getCurrentMazeDay;
exports.setActiveMazeDay = setActiveMazeDay;
exports.generateMaze = generateMaze;
exports.buildMazeFromTemplate = buildMazeFromTemplate;
exports.isInMazeRegion = isInMazeRegion;
exports.getMazeCellValue = getMazeCellValue;
exports.mazeBlocksPoint = mazeBlocksPoint;
exports.getMazeZoneAtWorld = getMazeZoneAtWorld;
exports.isMazeFloorAtWorld = isMazeFloorAtWorld;
exports.resolveMazeCollision = resolveMazeCollision;
exports.mazeCircleWallOverlap = mazeCircleWallOverlap;
exports.mazeBlocksLine = mazeBlocksLine;
// World placement: far outside both the regular 60000x60000 map and the PVP
// arena at (150000,150000), so the maze shares no coordinate space with either.
exports.MAZE_ORIGIN_X = 200000;
exports.MAZE_ORIGIN_Y = 200000;
// Templates are the authored mazes at corridor resolution; each template cell
// expands to a 2x2 block of grid cells (exactly like rrolf's RR_MAZE
// templates), which is what makes room for the corner fillets.
//
// The template SIZE is per-biome and adjustable: a template array of N rows of
// N characters yields an N-cell maze (grid = 2N cells, world span = 2N × 600).
// Everything downstream — region bounds, collision, rendering, minimap,
// spawner density — derives from the ACTIVE maze's dimensions, not a constant.
exports.MAZE_MIN_TEMPLATE_DIM = 8;
exports.MAZE_MAX_TEMPLATE_DIM = 64; // grid 128, world span 76800
exports.MAZE_CELL_SIZE = 1000; // world units per grid cell
// Daily biome rotation. Section indices map into SECTION_CONFIGS / the
// preloaded section ground textures (Garden=0, Desert=1, Ocean=3).
exports.MAZE_BIOMES = ['garden', 'desert', 'ocean'];
exports.MAZE_BIOME_SECTIONS = {
    garden: 0,
    desert: 1,
    ocean: 3,
};
// Difficulty zones by corridor depth (BFS distance from the entrance), lowest
// to deepest. Ultra mobs spawn only as bosses in the deepest (mythic) rooms.
exports.MAZE_ZONE_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
// Highest petal rarity usable inside the maze (index into RARITY_LEVELS):
// common..mythic allowed, ultra and above blocked.
exports.MAZE_MAX_PETAL_RARITY_INDEX = 5;
let activeMaze = null;
function getActiveMaze() {
    return activeMaze;
}
function getCurrentMazeDay() {
    return Math.floor(Date.now() / 86400000);
}
/** (Re)build and install the maze for the given UTC day number. */
function setActiveMazeDay(dayNumber) {
    if (!activeMaze || activeMaze.dayNumber !== dayNumber) {
        activeMaze = generateMaze(dayNumber);
    }
    return activeMaze;
}
// ── Hardcoded biome layouts ─────────────────────────────────────────────────
// One hand-editable template per biome (rrolf-style), 27×27 characters:
//   '#'              wall
//   c u r e l m     corridor, difficulty zone common..mythic
//   S                corridor, common zone, the player entrance/respawn cell
//   B                corridor, mythic zone, an ultra-boss room cell
// Each template cell expands to a 2×2 block of collision/render cells with
// rrolf corner codes. The daily rotation only cycles WHICH biome is active
// (day % 3 → garden/desert/ocean); the layout for a biome never changes, so
// client and server trivially agree on the maze from the day number alone.
const ZONE_BY_CHAR = {
    c: 0, u: 1, r: 2, e: 3, l: 4, m: 5,
    S: 0, // spawn room is common
    B: 5, // boss rooms are mythic
};
exports.MAZE_TEMPLATES = {
    garden: [
        '######################',
        '#mmm#mmmm#lll##llllee#',
        '#m#m#m##m#m#l##l##l#e#',
        '#m#m#m##m#m#l##l##l#e#',
        '#m#m#mB#m#m#llll##l#e#',
        '#m#m####m######l##l#e#',
        '#m#mmmmmm######l##l#e#',
        '#m#############m####e#',
        '#m#####cccuuuu#mmB##e#',
        '#l#####c##u##u######e#',
        '#ll##Scc##u##u######e#',
        '##ll######u##rrrrrree#',
        '###l######u##r###e##e#',
        '###ll#rrrrr##r###e##e#',
        '#l##l#r###r##r###e#ee#',
        '#l##l#r###rrrr###e####',
        '#ll#e#r#rrr##r#eeeeee#',
        '#l##e#r######r#e####e#',
        '#l##e#r######r#e##l#e#',
        '#eeeeeeeeeeeer#e##e#e#',
        '###############eeeeee#',
        '######################',
    ],
    desert: [
        '######################',
        '#Bmmmm#mmmmmBmmm#mll##',
        '#mmmm##m#######mmm#ll#',
        '#mmmm##m############l#',
        '#mmmm##l##S##l######l#',
        '#mmmmmll##c##lll####l#',
        '#mmm###l##c####l#elll#',
        '#mm####l##c####l#e####',
        '#m#####l##c####eeee###',
        '#######l##cc###eeeee##',
        '#######l##c###eeeeeee#',
        '#eeeelll#cc##eeeeeeee#',
        '#e#e###l##c##eeeeeeee#',
        '#e#####ll#c##eeeeeeee#',
        '#e###e##l#u##e#eeee#e#',
        '#eerrre#e#uu#e##ere#e#',
        '#e##r#e#e#u##e###r##e#',
        '#e##r#e#e#u##l##rr##e#',
        '#e##r#eee#u####rr###l#',
        '#e##r#####u###rr###ll#',
        '#e##rrrruuuuurr###lll#',
        '######################',
    ],
    ocean: [
        '######################',
        '#####mmmmmm######Bmm##',
        '#####m####mmm######m##',
        '###llm######m######m##',
        '###l#m######m#mlllmm##',
        '#lll#m##mmm#m#m#l##m##',
        '#l###mmmm#B#mmm#l##m##',
        '#ll#########m###l##m##',
        '##l#############l##mm#',
        '##le############l#####',
        '###e##cccScccc##l#####',
        '###e##c######c##llll##',
        '###e##c######c###l####',
        '###e##c##u###c###eeee#',
        '#eee##ccccu##cc#####e#',
        '#e#######u####c#u##ee#',
        '#e###r###u####uuuu#e##',
        '#e#rrrr##u######u##ee#',
        '#r#r#r###u#uuu######e#',
        '#r#r#u#uuuuu#u#rrr#rr#',
        '#rrr#uuu#####rrr#rrr##',
        '######################',
    ],
};
// ── Template parsing + corner-code expansion ────────────────────────────────
function generateMaze(dayNumber) {
    const biome = exports.MAZE_BIOMES[((dayNumber % 3) + 3) % 3];
    return buildMazeFromTemplate(exports.MAZE_TEMPLATES[biome], biome, dayNumber);
}
/**
 * Build a maze from any square template (size MAZE_MIN..MAZE_MAX cells per
 * side). Exposed separately so tools/tests can build arbitrary-size mazes.
 */
function buildMazeFromTemplate(template, biome, dayNumber) {
    const D = template.length;
    if (D < exports.MAZE_MIN_TEMPLATE_DIM || D > exports.MAZE_MAX_TEMPLATE_DIM || template.some(row => row.length !== D)) {
        throw new Error(`[maze] ${biome} template must be square, ${exports.MAZE_MIN_TEMPLATE_DIM}-${exports.MAZE_MAX_TEMPLATE_DIM} cells per side (got ${D} rows of lengths ${[...new Set(template.map(r => r.length))].join('/')})`);
    }
    // Parse the character grid into walkability + zone, and find the spawn
    // cell and boss rooms.
    const tpl = new Uint8Array(D * D); // 0 = wall, 1 = walkable
    const tplZone = new Uint8Array(D * D).fill(255);
    let spawnCell = null;
    const bossCells = [];
    for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
            const ch = template[y][x];
            if (ch === '#')
                continue;
            const zone = ZONE_BY_CHAR[ch];
            if (zone === undefined) {
                // Tolerate typos as wall — a bad hand-edit must not crash the
                // live server when the daily rotation reaches this biome.
                // (scripts/importMazeMap.js is the strict authoring path.)
                console.warn(`[maze] ${biome} template has unknown char '${ch}' at ${x},${y} — treating as wall`);
                continue;
            }
            tpl[y * D + x] = 1;
            tplZone[y * D + x] = zone;
            if (ch === 'S' && !spawnCell)
                spawnCell = { x, y };
            if (ch === 'B')
                bossCells.push(y * D + x);
        }
    }
    if (!spawnCell) {
        // No 'S' authored: fall back to the first walkable cell (identical on
        // client and server, so determinism holds) rather than crashing.
        console.error(`[maze] ${biome} template has no spawn cell ('S') — falling back to the first walkable cell. Add an 'S' (white pixel via scripts/importMazeMap.js).`);
        outer: for (let y = 0; y < D; y++) {
            for (let x = 0; x < D; x++) {
                if (tpl[y * D + x]) {
                    spawnCell = { x, y };
                    break outer;
                }
            }
        }
        if (!spawnCell) {
            throw new Error(`[maze] ${biome} template has no walkable cells at all`);
        }
    }
    // Expand template → grid with rrolf's corner codes (port of init_maze).
    const dim = D * 2;
    const values = new Uint8Array(dim * dim);
    const zones = new Uint8Array(dim * dim).fill(255);
    const toff = (x, y, a, b) => {
        const nx = x + a, ny = y + b;
        return (nx < 0 || ny < 0 || nx >= D || ny >= D) ? 0 : tpl[ny * D + nx];
    };
    const setGrid = (gx, gy, v) => { values[gy * dim + gx] = v; };
    for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
            const walk = tpl[y * D + x] !== 0;
            const zone = tplZone[y * D + x];
            for (let sy = 0; sy < 2; sy++) {
                for (let sx = 0; sx < 2; sx++) {
                    zones[(y * 2 + sy) * dim + (x * 2 + sx)] = zone;
                }
            }
            const top = toff(x, y, 0, -1);
            const bottom = toff(x, y, 0, 1);
            const left = toff(x, y, -1, 0);
            const right = toff(x, y, 1, 0);
            if (walk) {
                // Floor: round convex corners where two walls meet diagonally.
                if (top === 0) {
                    setGrid(x * 2, y * 2, left === 0 ? 7 : 1);
                    setGrid(x * 2 + 1, y * 2, right === 0 ? 5 : 1);
                }
                else {
                    setGrid(x * 2, y * 2, 1);
                    setGrid(x * 2 + 1, y * 2, 1);
                }
                if (bottom === 0) {
                    setGrid(x * 2, y * 2 + 1, left === 0 ? 6 : 1);
                    setGrid(x * 2 + 1, y * 2 + 1, right === 0 ? 4 : 1);
                }
                else {
                    setGrid(x * 2, y * 2 + 1, 1);
                    setGrid(x * 2 + 1, y * 2 + 1, 1);
                }
            }
            else {
                // Wall: round concave corners where two corridors meet.
                if (top) {
                    setGrid(x * 2, y * 2, (left && toff(x, y, -1, -1)) ? 15 : 0);
                    setGrid(x * 2 + 1, y * 2, (right && toff(x, y, 1, -1)) ? 13 : 0);
                }
                else {
                    setGrid(x * 2, y * 2, 0);
                    setGrid(x * 2 + 1, y * 2, 0);
                }
                if (bottom) {
                    setGrid(x * 2, y * 2 + 1, (left && toff(x, y, -1, 1)) ? 14 : 0);
                    setGrid(x * 2 + 1, y * 2 + 1, (right && toff(x, y, 1, 1)) ? 12 : 0);
                }
                else {
                    setGrid(x * 2, y * 2 + 1, 0);
                    setGrid(x * 2 + 1, y * 2 + 1, 0);
                }
            }
        }
    }
    const cellCenter = (tx, ty) => ({
        x: exports.MAZE_ORIGIN_X + (tx * 2 + 1) * exports.MAZE_CELL_SIZE,
        y: exports.MAZE_ORIGIN_Y + (ty * 2 + 1) * exports.MAZE_CELL_SIZE,
    });
    const spawn = cellCenter(spawnCell.x, spawnCell.y);
    return {
        dayNumber,
        biome,
        templateDim: D,
        gridDim: dim,
        worldSize: dim * exports.MAZE_CELL_SIZE,
        values,
        zones,
        spawnX: spawn.x,
        spawnY: spawn.y,
        bossSpots: bossCells.map(idx => cellCenter(idx % D, Math.floor(idx / D))),
    };
}
// ── Queries ─────────────────────────────────────────────────────────────────
/** True if (x, y) lies inside the maze's coordinate region. */
function isInMazeRegion(x, y) {
    if (!activeMaze)
        return false;
    return x >= exports.MAZE_ORIGIN_X && x < exports.MAZE_ORIGIN_X + activeMaze.worldSize &&
        y >= exports.MAZE_ORIGIN_Y && y < exports.MAZE_ORIGIN_Y + activeMaze.worldSize;
}
/** Grid cell value at grid coords; out of range reads as solid wall (0). */
function getMazeCellValue(gx, gy) {
    if (!activeMaze || gx < 0 || gy < 0 || gx >= activeMaze.gridDim || gy >= activeMaze.gridDim)
        return 0;
    return activeMaze.values[gy * activeMaze.gridDim + gx];
}
/**
 * Exact per-cell wall test at a world point, matching the rendered fillet
 * geometry: solid cells block everywhere, corner cells block on the black
 * side of their quarter-circle arc (convex floor corners block BEYOND the
 * arc, concave wall corners block WITHIN it).
 */
function mazeCellBlocksPoint(gx, gy, wx, wy) {
    const value = getMazeCellValue(gx, gy);
    if (value === 0)
        return true;
    if (value === 1)
        return false;
    const g = exports.MAZE_CELL_SIZE;
    const cornerX = exports.MAZE_ORIGIN_X + (gx + ((value >> 1) & 1)) * g;
    const cornerY = exports.MAZE_ORIGIN_Y + (gy + (value & 1)) * g;
    const dx = wx - cornerX;
    const dy = wy - cornerY;
    const withinArc = dx * dx + dy * dy <= g * g;
    return value >= 12 ? withinArc : !withinArc;
}
/** True if the point is inside solid maze wall (or outside the corridor grid). */
function mazeBlocksPoint(x, y) {
    if (!isInMazeRegion(x, y))
        return false;
    const gx = Math.floor((x - exports.MAZE_ORIGIN_X) / exports.MAZE_CELL_SIZE);
    const gy = Math.floor((y - exports.MAZE_ORIGIN_Y) / exports.MAZE_CELL_SIZE);
    return mazeCellBlocksPoint(gx, gy, x, y);
}
/** Zone index (0-5) at a world position, or -1 for walls / outside the maze. */
function getMazeZoneAtWorld(x, y) {
    if (!activeMaze || !isInMazeRegion(x, y))
        return -1;
    const gx = Math.floor((x - exports.MAZE_ORIGIN_X) / exports.MAZE_CELL_SIZE);
    const gy = Math.floor((y - exports.MAZE_ORIGIN_Y) / exports.MAZE_CELL_SIZE);
    if (gx < 0 || gy < 0 || gx >= activeMaze.gridDim || gy >= activeMaze.gridDim)
        return -1;
    const z = activeMaze.zones[gy * activeMaze.gridDim + gx];
    return z === 255 ? -1 : z;
}
/** Walkable floor test at world coords (floor or a convex-corner floor cell). */
function isMazeFloorAtWorld(x, y) {
    if (!isInMazeRegion(x, y))
        return false;
    const gx = Math.floor((x - exports.MAZE_ORIGIN_X) / exports.MAZE_CELL_SIZE);
    const gy = Math.floor((y - exports.MAZE_ORIGIN_Y) / exports.MAZE_CELL_SIZE);
    const v = getMazeCellValue(gx, gy);
    return v === 1 || (v >= 4 && v <= 7);
}
function resolveMazeCollisionOnce(px, py, r) {
    if (!activeMaze)
        return null;
    const g = exports.MAZE_CELL_SIZE;
    const u = px - exports.MAZE_ORIGIN_X;
    const v = py - exports.MAZE_ORIGIN_Y;
    const cx = Math.floor(u / g);
    const cy = Math.floor(v / g);
    const val = (a, b) => getMazeCellValue(cx + a, cy + b);
    // Fillet push-out around the corner vertex (ox, oy) in maze-local coords.
    // inverse=0 → convex floor corner (stay within g - r of the vertex);
    // inverse=1 → concave wall corner (stay beyond g + r of the vertex).
    const curveCheck = (ox, oy, inverse) => {
        let dx = u - ox;
        let dy = v - oy;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (inverse === 0) {
            if (d > g - r) {
                if (d === 0) {
                    dx = 1;
                    dy = 0;
                    d = 1;
                }
                const s = (g - r) / d;
                return { x: exports.MAZE_ORIGIN_X + ox + dx * s, y: exports.MAZE_ORIGIN_Y + oy + dy * s };
            }
        }
        else {
            if (d < g + r) {
                if (d === 0) {
                    dx = 1;
                    dy = 0;
                    d = 1;
                }
                const s = (g + r) / d;
                return { x: exports.MAZE_ORIGIN_X + ox + dx * s, y: exports.MAZE_ORIGIN_Y + oy + dy * s };
            }
        }
        return null;
    };
    const cornerOf = (tile, baseX, baseY) => {
        const left = (tile >> 1) & 1;
        const top = tile & 1;
        const inverse = (tile >> 3) & 1;
        return { ox: (baseX + left) * g, oy: (baseY + top) * g, inverse };
    };
    // Current cell (a rounded-corner cell constrains from within).
    const tile0 = val(0, 0);
    if (tile0 !== 1) {
        if (tile0 === 0) {
            // Centre is inside a solid cell. rrolf treats this as unreachable,
            // but here instantaneous displacements (mob-contact knockback,
            // petal knockback) are applied AFTER movement resolution and can
            // embed an entity. Returning "no collision" would then let it
            // noclip through the entire wall network — instead push it out
            // through the nearest walkable neighbor face and let the outer
            // iteration finish the job.
            const lx = u - cx * g;
            const ly = v - cy * g;
            const isFloorCell = (a, b) => {
                const t = val(a, b);
                return t === 1 || (t >= 4 && t <= 7);
            };
            let best = null;
            const consider = (d, x, y) => {
                if (!best || d < best.d)
                    best = { d, x, y };
            };
            if (isFloorCell(-1, 0))
                consider(lx, exports.MAZE_ORIGIN_X + cx * g - r, py);
            if (isFloorCell(1, 0))
                consider(g - lx, exports.MAZE_ORIGIN_X + (cx + 1) * g + r, py);
            if (isFloorCell(0, -1))
                consider(ly, px, exports.MAZE_ORIGIN_Y + cy * g - r);
            if (isFloorCell(0, 1))
                consider(g - ly, px, exports.MAZE_ORIGIN_Y + (cy + 1) * g + r);
            return best; // null only deep inside the wall mass (unreachable by a single knock)
        }
        const c = cornerOf(tile0, cx, cy);
        const hit = curveCheck(c.ox, c.oy, c.inverse);
        if (hit)
            return hit;
    }
    // Left neighbor
    if (val(-1, 0) !== 1 && u - cx * g < r) {
        const tile = val(-1, 0);
        if (tile === 0)
            return { x: exports.MAZE_ORIGIN_X + cx * g + r, y: py };
        const c = cornerOf(tile, cx - 1, cy);
        const hit = curveCheck(c.ox, c.oy, c.inverse);
        if (hit)
            return hit;
    }
    // Top neighbor
    if (val(0, -1) !== 1 && v - cy * g < r) {
        const tile = val(0, -1);
        if (tile === 0)
            return { x: px, y: exports.MAZE_ORIGIN_Y + cy * g + r };
        const c = cornerOf(tile, cx, cy - 1);
        const hit = curveCheck(c.ox, c.oy, c.inverse);
        if (hit)
            return hit;
    }
    // Right neighbor
    if (val(1, 0) !== 1 && (cx + 1) * g - u < r) {
        const tile = val(1, 0);
        if (tile === 0)
            return { x: exports.MAZE_ORIGIN_X + (cx + 1) * g - r, y: py };
        const c = cornerOf(tile, cx + 1, cy);
        const hit = curveCheck(c.ox, c.oy, c.inverse);
        if (hit)
            return hit;
    }
    // Bottom neighbor
    if (val(0, 1) !== 1 && (cy + 1) * g - v < r) {
        const tile = val(0, 1);
        if (tile === 0)
            return { x: px, y: exports.MAZE_ORIGIN_Y + (cy + 1) * g - r };
        const c = cornerOf(tile, cx, cy + 1);
        const hit = curveCheck(c.ox, c.oy, c.inverse);
        if (hit)
            return hit;
    }
    return null;
}
/**
 * Resolve a circle of the given radius against the maze walls. Iterates a few
 * times so corner cases (literally) settle, exactly like the tile resolver.
 */
function resolveMazeCollision(x, y, radius) {
    let nx = x, ny = y;
    let collided = false;
    for (let i = 0; i < 4; i++) {
        const hit = resolveMazeCollisionOnce(nx, ny, radius);
        if (!hit)
            break;
        nx = hit.x;
        ny = hit.y;
        collided = true;
    }
    return { x: nx, y: ny, collided };
}
/**
 * Cheap overlap test for projectiles/points: does a circle at (x, y) touch a
 * solid maze cell? (Corner fillets are approximated by their full cell here —
 * fine for projectile hits.) Returns the blocking cell's world rect, or null.
 */
function mazeCircleWallOverlap(x, y, radius) {
    if (!activeMaze)
        return null;
    if (!isInMazeRegion(x, y))
        return null;
    const g = exports.MAZE_CELL_SIZE;
    const minGx = Math.floor((x - radius - exports.MAZE_ORIGIN_X) / g);
    const maxGx = Math.floor((x + radius - exports.MAZE_ORIGIN_X) / g);
    const minGy = Math.floor((y - radius - exports.MAZE_ORIGIN_Y) / g);
    const maxGy = Math.floor((y + radius - exports.MAZE_ORIGIN_Y) / g);
    for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
            const v = getMazeCellValue(gx, gy);
            if (v === 1)
                continue; // plain floor never blocks
            const left = exports.MAZE_ORIGIN_X + gx * g;
            const top = exports.MAZE_ORIGIN_Y + gy * g;
            // circle vs AABB broad phase
            const nearX = Math.max(left, Math.min(x, left + g));
            const nearY = Math.max(top, Math.min(y, top + g));
            const dx = x - nearX, dy = y - nearY;
            if (dx * dx + dy * dy > radius * radius)
                continue;
            // Narrow phase: corner cells only block on the black side of their
            // fillet arc — test the nearest point so projectiles match the
            // rendered (and walkable) geometry instead of the full cell box.
            if (!mazeCellBlocksPoint(gx, gy, nearX, nearY) && !mazeCellBlocksPoint(gx, gy, x, y))
                continue;
            return { left, right: left + g, top, bottom: top + g };
        }
    }
    return null;
}
/** Line-of-sight helper: true if the segment crosses solid maze wall. */
function mazeBlocksLine(x1, y1, x2, y2) {
    if (!activeMaze)
        return false;
    if (!isInMazeRegion(x1, y1) && !isInMazeRegion(x2, y2))
        return false;
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / (exports.MAZE_CELL_SIZE / 3)));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (mazeBlocksPoint(x1 + dx * t, y1 + dy * t))
            return true;
    }
    return false;
}
