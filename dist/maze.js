"use strict";
// ── Maze mode (shared client + server) ──────────────────────────────────────
// A daily-rotating maze in the style of rrolf/florr's maze: a grid of walkable
// corridors carved out of solid void, with every corridor/void junction rounded
// by a quarter-circle fillet whose radius is one full grid cell ("rrolf walls").
//
// The maze is generated deterministically from the UTC day number, so the
// server and every client build byte-identical mazes from the single small
// `mazeInfo { day }` message — no wall data goes over the wire. The biome
// rotates garden → desert → ocean with the day, and the layout itself is
// re-rolled daily (the day number seeds the PRNG).
//
// This module is intentionally self-contained (no imports from constants.ts)
// because constants.ts hooks its shared collision helpers into it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAZE_MAX_PETAL_RARITY_INDEX = exports.MAZE_ZONE_TIERS = exports.MAZE_BIOME_SECTIONS = exports.MAZE_BIOMES = exports.MAZE_WORLD_SIZE = exports.MAZE_CELL_SIZE = exports.MAZE_GRID_DIM = exports.MAZE_TEMPLATE_DIM = exports.MAZE_ORIGIN_Y = exports.MAZE_ORIGIN_X = void 0;
exports.getActiveMaze = getActiveMaze;
exports.getCurrentMazeDay = getCurrentMazeDay;
exports.setActiveMazeDay = setActiveMazeDay;
exports.generateMaze = generateMaze;
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
// Template is the authored/generated maze at corridor resolution; each template
// cell expands to a 2x2 block of grid cells (exactly like rrolf's RR_MAZE
// templates), which is what makes room for the corner fillets.
exports.MAZE_TEMPLATE_DIM = 27; // odd, for the DFS carver
exports.MAZE_GRID_DIM = exports.MAZE_TEMPLATE_DIM * 2; // 54x54 collision/render cells
exports.MAZE_CELL_SIZE = 600; // world units per grid cell
exports.MAZE_WORLD_SIZE = exports.MAZE_GRID_DIM * exports.MAZE_CELL_SIZE; // 32400
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
// ── Seeded PRNG ─────────────────────────────────────────────────────────────
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// ── Generation ──────────────────────────────────────────────────────────────
function generateMaze(dayNumber) {
    const D = exports.MAZE_TEMPLATE_DIM;
    const rng = mulberry32((dayNumber * 2654435761) ^ 0x9e3779b9);
    // 0 = wall, 1 = walkable
    const tpl = new Uint8Array(D * D);
    const at = (x, y) => tpl[y * D + x];
    const carve = (x, y) => { tpl[y * D + x] = 1; };
    // 1. Recursive-backtracker maze over cells at odd template coordinates.
    const M = (D - 1) / 2; // maze cells per side
    const visited = new Uint8Array(M * M);
    const stack = [0]; // cell index = my * M + mx; start at (0,0) = template (1,1)
    visited[0] = 1;
    carve(1, 1);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (stack.length > 0) {
        const cur = stack[stack.length - 1];
        const mx = cur % M, my = Math.floor(cur / M);
        // Collect unvisited neighbors
        const options = [];
        for (const [dx, dy] of DIRS) {
            const nx = mx + dx, ny = my + dy;
            if (nx >= 0 && ny >= 0 && nx < M && ny < M && !visited[ny * M + nx]) {
                options.push([nx, ny]);
            }
        }
        if (options.length === 0) {
            stack.pop();
            continue;
        }
        const [nx, ny] = options[Math.floor(rng() * options.length)];
        visited[ny * M + nx] = 1;
        carve(1 + nx * 2, 1 + ny * 2); // the cell
        carve(1 + mx * 2 + (nx - mx), 1 + my * 2 + (ny - my)); // the wall between
        stack.push(ny * M + nx);
    }
    // 2. Braid: knock a wall off ~35% of dead ends so the maze has loops
    // instead of being a pure tree (rrolf's maze is heavily looped).
    for (let my = 0; my < M; my++) {
        for (let mx = 0; mx < M; mx++) {
            const tx = 1 + mx * 2, ty = 1 + my * 2;
            let openings = 0;
            for (const [dx, dy] of DIRS) {
                if (at(tx + dx, ty + dy))
                    openings++;
            }
            if (openings === 1 && rng() < 0.35) {
                const closed = DIRS.filter(([dx, dy]) => {
                    const wx = tx + dx, wy = ty + dy;
                    return wx > 0 && wy > 0 && wx < D - 1 && wy < D - 1 && !at(wx, wy);
                });
                if (closed.length > 0) {
                    const [dx, dy] = closed[Math.floor(rng() * closed.length)];
                    carve(tx + dx, ty + dy);
                }
            }
        }
    }
    // 3. Open rooms: the spawn room plus a few random chambers.
    const carveRoom = (cx, cy, half) => {
        for (let y = Math.max(1, cy - half); y <= Math.min(D - 2, cy + half); y++) {
            for (let x = Math.max(1, cx - half); x <= Math.min(D - 2, cx + half); x++) {
                carve(x, y);
            }
        }
    };
    carveRoom(2, 2, 1); // spawn room around template (2,2)
    for (let i = 0; i < 3; i++) {
        carveRoom(2 + Math.floor(rng() * (D - 4)), 2 + Math.floor(rng() * (D - 4)), 1);
    }
    // 4. BFS from the spawn cell to find the deepest reaches.
    const SPAWN_TX = 1, SPAWN_TY = 1;
    const bfs = () => {
        const dist = new Int32Array(D * D).fill(-1);
        const q = [SPAWN_TY * D + SPAWN_TX];
        dist[q[0]] = 0;
        for (let head = 0; head < q.length; head++) {
            const idx = q[head];
            const x = idx % D, y = Math.floor(idx / D);
            for (const [dx, dy] of DIRS) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= D || ny >= D)
                    continue;
                const nidx = ny * D + nx;
                if (!tpl[nidx] || dist[nidx] >= 0)
                    continue;
                dist[nidx] = dist[idx] + 1;
                q.push(nidx);
            }
        }
        return dist;
    };
    // 5. Boss rooms at the two farthest (and mutually distant) cells.
    let dist = bfs();
    const byDepth = [];
    for (let i = 0; i < D * D; i++)
        if (dist[i] > 0)
            byDepth.push(i);
    byDepth.sort((a, b) => dist[b] - dist[a]);
    const bossCells = [];
    for (const idx of byDepth) {
        if (bossCells.length >= 2)
            break;
        const x = idx % D, y = Math.floor(idx / D);
        const farFromOthers = bossCells.every(other => {
            const ox = other % D, oy = Math.floor(other / D);
            return Math.abs(ox - x) + Math.abs(oy - y) >= Math.floor(D / 2);
        });
        if (farFromOthers)
            bossCells.push(idx);
    }
    for (const idx of bossCells) {
        carveRoom(idx % D, Math.floor(idx / D), 1);
    }
    // 6. Final zone assignment: equal-width depth bands, common at the spawn
    // through mythic at the deepest corridors. Boss rooms are forced mythic.
    dist = bfs();
    let maxDist = 1;
    for (let i = 0; i < D * D; i++)
        if (dist[i] > maxDist)
            maxDist = dist[i];
    const tplZone = new Uint8Array(D * D).fill(255);
    for (let i = 0; i < D * D; i++) {
        if (dist[i] >= 0) {
            tplZone[i] = Math.min(exports.MAZE_ZONE_TIERS.length - 1, Math.floor((dist[i] / (maxDist + 1)) * exports.MAZE_ZONE_TIERS.length));
        }
    }
    for (const idx of bossCells) {
        const bx = idx % D, by = Math.floor(idx / D);
        for (let y = Math.max(0, by - 1); y <= Math.min(D - 1, by + 1); y++) {
            for (let x = Math.max(0, bx - 1); x <= Math.min(D - 1, bx + 1); x++) {
                if (tpl[y * D + x])
                    tplZone[y * D + x] = exports.MAZE_ZONE_TIERS.length - 1;
            }
        }
    }
    // 7. Expand template → grid with rrolf's corner codes (port of init_maze).
    const dim = exports.MAZE_GRID_DIM;
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
    const spawn = cellCenter(SPAWN_TX, SPAWN_TY);
    return {
        dayNumber,
        biome: exports.MAZE_BIOMES[((dayNumber % 3) + 3) % 3],
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
    return x >= exports.MAZE_ORIGIN_X && x < exports.MAZE_ORIGIN_X + exports.MAZE_WORLD_SIZE &&
        y >= exports.MAZE_ORIGIN_Y && y < exports.MAZE_ORIGIN_Y + exports.MAZE_WORLD_SIZE;
}
/** Grid cell value at grid coords; out of range reads as solid wall (0). */
function getMazeCellValue(gx, gy) {
    if (!activeMaze || gx < 0 || gy < 0 || gx >= exports.MAZE_GRID_DIM || gy >= exports.MAZE_GRID_DIM)
        return 0;
    return activeMaze.values[gy * exports.MAZE_GRID_DIM + gx];
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
    if (gx < 0 || gy < 0 || gx >= exports.MAZE_GRID_DIM || gy >= exports.MAZE_GRID_DIM)
        return -1;
    const z = activeMaze.zones[gy * exports.MAZE_GRID_DIM + gx];
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
