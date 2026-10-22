#!/usr/bin/env node
/**
 * Writes maps/pyramid.tmj: the pyramid, a maze laid out by rrolf's maze
 * generator and drawn with florr's pyramid tiles.
 *
 *     node scripts/generate-pyramid-map.js [seed]
 *
 * The maze is generateMaze() from rrolf's map editor (~/rrolf,
 * MapEditor/app.js -- AGPL-3.0-or-later, (C) 2024 Paul Johnson), copied as it
 * is but for Math.random, which is a seeded generator here so the same seed
 * always writes the same map. It carves a block maze on rrolf's 40 x 40
 * editor grid: a cell is wall or floor, floor cells sit on even coordinates,
 * and the walk starts in the corner at (0, 0).
 *
 * Everything after the maze is this game's: a rim of wall around it; every
 * cell two tiles across; the wall art picked per tile from which of its four
 * corners are wall -- florr's full, edge, outer-corner and inner-corner pieces
 * (tileset ids 96..99), turned by Tiled's flip bits -- where a corner is wall
 * when all four tiles meeting there are wall; the door and the pad back to
 * the desert in the start cell's corridor; spawn bands over 4 x 4 blocks of
 * cells, harder the further the walk is from the door (rrolf's floodFill, as
 * its editor numbers the cells); and the pharaoh's one-at-a-time band around
 * the deepest cell. The map says `minimap: false` and how dark it is inside.
 *
 * The result is an ordinary Tiled map: open and edit it in Tiled. Running this
 * again throws those edits away.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'maps', 'pyramid.tmj');
const SEED = Number(process.argv[2] || 20261021);

const GRID_SIZE = 40;          // rrolf's editor grid
const RIM = 1;                 // wall cells around the maze
const CELL_TILES = 2;          // tiles across one maze cell
const TILE = 256;
const BLOCK = 4;               // maze cells per spawn band, each way
const DARKNESS = '#ff120d00';  // florr's pyramid dark colour (client/render/darkness.h)

const FLOORS = [92, 93, 94, 95];
const BRI = 96, C = 97, L = 98, TL = 99;
const FH = 0x80000000, FV = 0x40000000, FD = 0x20000000;

// --- a seeded Math.random --------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const random = mulberry32(SEED);

// --- rrolf's generateMaze, as its map editor has it ------------------------

function generateMaze() {
    const MAZE_SIZE = GRID_SIZE;
    const i = (x, y) => x + y * MAZE_SIZE;

    const visited_map = new Uint8Array(MAZE_SIZE * MAZE_SIZE);
    const maze = new Uint8Array(MAZE_SIZE * MAZE_SIZE).fill(1);

    const stack = [];

    const append = (x, y) => {
        stack.push([x, y]);
        visited_map[i(x, y)] = 1;
        maze[i(x, y)] = 0;
    };

    append(0, 0);

    while (stack.length)
    {
        const [x, y] = stack.at(-1);

        let neighbors = [];

        if (y + 2 < MAZE_SIZE && !visited_map[i(x, y + 2)])
            neighbors.push(0);
        if (y - 2 > 0 &&         !visited_map[i(x, y - 2)])
            neighbors.push(1);
        if (x + 2 < MAZE_SIZE && !visited_map[i(x + 2, y)])
            neighbors.push(2);
        if (x - 2 > 0 &&         !visited_map[i(x - 2, y)])
            neighbors.push(3);

        if (neighbors.length === 0)
        {
            stack.pop();
            continue;
        }

        const d = neighbors[Math.floor(random() * neighbors.length)];
        switch (d)
        {
            case 0:
                append(x, y + 2);
                maze[i(x, y + 1)] = 0;
                break;
            case 1:
                append(x, y - 2);
                maze[i(x, y - 1)] = 0;
                break;
            case 2:
                append(x + 2, y);
                maze[i(x + 1, y)] = 0;
                break;
            case 3:
                append(x - 2, y);
                maze[i(x - 1, y)] = 0;
                break;
        }
    }

    return maze;
}

// --- rrolf's floodFill: walking distance from the spawn, in cells ----------

function floodFill(isWall, spawn) {
    const dist = new Map();
    const key = (x, y) => x + ',' + y;
    const queue = [[spawn[0], spawn[1]]];
    dist.set(key(spawn[0], spawn[1]), 0);
    for (let head = 0; head < queue.length; ++head) {
        const [x, y] = queue[head];
        const d = dist.get(key(x, y));
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
            if (isWall(nx, ny) || dist.has(key(nx, ny))) continue;
            dist.set(key(nx, ny), d + 1);
            queue.push([nx, ny]);
        }
    }
    return (x, y) => dist.get(key(x, y));
}

// --- tiles ------------------------------------------------------------------

const maze = generateMaze();
const mazeWall = (x, y) => maze[x + y * GRID_SIZE] === 1;
const CELLS = GRID_SIZE + 2 * RIM;
const W = CELLS * CELL_TILES;
const H = W;

/// Is map cell (cx, cy) wall -- the rim, or a wall of the maze.
function cellWall(cx, cy) {
    const x = cx - RIM, y = cy - RIM;
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return true;
    return mazeWall(x, y);
}
function tileWall(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    return cellWall(Math.floor(tx / CELL_TILES), Math.floor(ty / CELL_TILES));
}
/// A corner is wall when every tile meeting at it is: the wall is drawn half
/// a tile in from a wall cell's edge, so walls and their rounded ends never
/// meet only at a point.
function vertexWall(vx, vy) {
    return tileWall(vx - 1, vy - 1) && tileWall(vx, vy - 1) &&
           tileWall(vx - 1, vy) && tileWall(vx, vy);
}

function wallGid(tx, ty) {
    const tl = vertexWall(tx, ty), tr = vertexWall(tx + 1, ty);
    const bl = vertexWall(tx, ty + 1), br = vertexWall(tx + 1, ty + 1);
    const n = tl + tr + bl + br;
    if (n === 0) return 0;
    if (n === 4) return C + 1;
    if (n === 1) return ((TL + 1) | ((tr || br) ? FH : 0) | ((bl || br) ? FV : 0)) >>> 0;
    if (n === 2) {
        if (tl && bl) return L + 1;
        if (tr && br) return ((L + 1) | FH) >>> 0;
        if (tl && tr) return ((L + 1) | FD) >>> 0;
        if (bl && br) return ((L + 1) | FD | FV) >>> 0;
        throw new Error(`corners meet only diagonally at tile ${tx},${ty}`);
    }
    // Three: florr's inner corner is open at the bottom right.
    let flips = (!bl ? FH : 0) | (!tr ? FV : 0);
    if (!tl) flips = FH | FV;
    return ((BRI + 1) | flips) >>> 0;
}

const floor = [];
const walls = [];
for (let ty = 0; ty < H; ++ty) {
    for (let tx = 0; tx < W; ++tx) {
        floor.push(FLOORS[Math.floor(random() * FLOORS.length)] + 1);
        walls.push(wallGid(tx, ty));
    }
}

// --- the door, the pad, the bands ------------------------------------------

/// A maze cell's rectangle in world units.
function cellRect(x, y, w = 1, h = 1) {
    return {
        x: (x + RIM) * CELL_TILES * TILE,
        y: (y + RIM) * CELL_TILES * TILE,
        w: w * CELL_TILES * TILE,
        h: h * CELL_TILES * TILE,
    };
}
function cellCentre(x, y) {
    const r = cellRect(x, y);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

const SPAWN = [0, 0];
const distance = floodFill(mazeWall, SPAWN);
let deepest = SPAWN, deepestDistance = 0;
for (let y = 0; y < GRID_SIZE; ++y) {
    for (let x = 0; x < GRID_SIZE; ++x) {
        const d = distance(x, y);
        if (d !== undefined && d > deepestDistance) { deepest = [x, y]; deepestDistance = d; }
    }
}

let nextId = 1;
function object(fields) {
    const o = Object.assign({ height: 0, id: nextId++, name: '', rotation: 0, type: '',
                              visible: true, width: 0 }, fields);
    const sorted = {};
    for (const k of Object.keys(o).sort()) sorted[k] = o[k];
    return sorted;
}
const prop = (name, type, value) => ({ name, type, value });
const rectPolygon = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

const doorAt = cellCentre(...SPAWN);
const DOOR = 384;
const door = object({
    height: DOOR, width: DOOR, x: doorAt.x - DOOR / 2, y: doorAt.y - DOOR / 2,
    properties: [
        prop('biome', 'string', 'pyramid'),
        prop('color', 'color', '#ffccb77a'),
        prop('label', 'string', 'Pyramid'),
        prop('order', 'float', 8),
    ],
});

// Two cells along the corridor the walk starts down, so arriving does not
// land a flower on the door.
const padCell = mazeWall(1, 0) ? [0, 2] : [2, 0];
const padAt = cellCentre(...padCell);
const pad = object({
    point: true, x: padAt.x, y: padAt.y,
    properties: [
        prop('id', 'string', 'pyramid_portal'),
        prop('to', 'string', 'pyramid_portal_desert'),
    ],
});

const bands = [];
for (let by = 0; by < GRID_SIZE / BLOCK; ++by) {
    for (let bx = 0; bx < GRID_SIZE / BLOCK; ++bx) {
        // The door's own block is the one with no band: the safe ground a
        // flower arrives on.
        if (bx === 0 && by === 0) continue;
        let sum = 0, count = 0;
        for (let y = by * BLOCK; y < (by + 1) * BLOCK; ++y) {
            for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; ++x) {
                const d = distance(x, y);
                if (d !== undefined) { sum += d; ++count; }
            }
        }
        if (count === 0) continue;
        // Up to 90 at nine tenths of the deepest walk; the pharaoh's band is
        // the only ground at 100.
        const reach = Math.min(1, sum / count / (0.9 * deepestDistance));
        const difficulty = 5 * Math.round(18 * reach);
        const r = cellRect(bx * BLOCK, by * BLOCK, BLOCK, BLOCK);
        bands.push(object({
            name: `block ${bx},${by}`, polygon: rectPolygon(r.w, r.h), x: r.x, y: r.y,
            properties: [prop('difficulty', 'float', difficulty), prop('mobs', 'string', 'pyramid')],
        }));
    }
}
{
    const x0 = Math.max(0, deepest[0] - 2), y0 = Math.max(0, deepest[1] - 2);
    const x1 = Math.min(GRID_SIZE - 1, deepest[0] + 2), y1 = Math.min(GRID_SIZE - 1, deepest[1] + 2);
    const r = cellRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    bands.push(object({
        name: 'pharaoh', polygon: rectPolygon(r.w, r.h), x: r.x, y: r.y,
        properties: [
            prop('difficulty', 'float', 100),
            prop('mobs', 'string', 'pharaoh_beetle'),
            prop('singular', 'bool', true),
        ],
    }));
}

const tileLayer = (id, name, data, collide) => ({
    data, height: H, id, name, opacity: 1,
    properties: [prop('has_collision', 'bool', collide)],
    type: 'tilelayer', visible: true, width: W, x: 0, y: 0,
});
const objectLayer = (id, name, objects) => ({
    draworder: 'topdown', id, name, objects, opacity: 1, type: 'objectgroup',
    visible: true, x: 0, y: 0,
});

const doc = {
    compressionlevel: -1,
    height: H,
    infinite: false,
    layers: [
        tileLayer(1, 'background', floor, false),
        tileLayer(2, 'walls', walls, true),
        objectLayer(3, 'player_spawns', [door]),
        objectLayer(4, 'spawns', bands),
        objectLayer(5, 'teleporters', [pad]),
    ],
    nextlayerid: 6,
    nextobjectid: nextId,
    orientation: 'orthogonal',
    properties: [
        prop('darkness', 'color', DARKNESS),
        prop('minimap', 'bool', false),
    ],
    renderorder: 'right-down',
    tiledversion: '1.10.1',
    tileheight: TILE,
    tilesets: [{ firstgid: 1, source: 'tileset.tsj' }],
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    width: W,
};

// --- Tiled's own JSON layout, so the file diffs like one Tiled saved -------

function scalar(v) {
    if (typeof v === 'string') return JSON.stringify(v).replace(/\//g, '\\/');
    return String(v);
}
function value(v, col, key, owner) {
    if (Array.isArray(v)) {
        if (key === 'data' && owner && owner.width) {
            const rows = [];
            for (let i = 0; i < v.length; i += owner.width) {
                rows.push(v.slice(i, i + owner.width).map(scalar).join(', '));
            }
            return '[' + rows.join(',\n' + ' '.repeat(12)) + ']';
        }
        if (v.length && v.every(x => x !== null && typeof x === 'object')) {
            return '[\n' + v.map(x => dict(x, col + 7)).join(', \n') + ']';
        }
        return '[' + v.map(scalar).join(', ') + ']';
    }
    if (v !== null && typeof v === 'object') return '\n' + dict(v, col + 3);
    return scalar(v);
}
function dict(d, col) {
    const pad = ' '.repeat(col);
    const lines = Object.keys(d).map(
        k => ' '.repeat(col + 1) + JSON.stringify(k) + ':' + value(d[k], col + 1, k, d));
    return pad + '{\n' + lines.join(',\n') + '\n' + pad + '}';
}
const text = '{' + Object.keys(doc).map(
    k => ' ' + JSON.stringify(k) + ':' + value(doc[k], 1, k, doc)).join(',\n') + '\n}';
fs.writeFileSync(OUT, text);

console.log(`maps/pyramid.tmj: ${W}x${H} tiles, seed ${SEED}, ${bands.length} bands, ` +
            `deepest walk ${deepestDistance} cells at ${deepest}`);
