#!/usr/bin/env node
/**
 * Maze map image importer/exporter.
 *
 * Draw a maze layout as a PNG (one pixel per template cell — any square size
 * from 8x8 to 64x64 sets the map size directly; scaled-up images work with
 * --size <cells>) and import it straight into MAZE_TEMPLATES in src/maze.ts. Export the current template to a PNG to use
 * as a starting point in any pixel editor.
 *
 * Usage:
 *   node scripts/importMazeMap.js <image.png> <garden|desert|ocean> [--dry-run]
 *   node scripts/importMazeMap.js --export <garden|desert|ocean> <out.png> [--scale N]
 *
 * Color legend (the game's rarity colors — nearest color wins, so slightly
 * off-palette pixels and anti-aliasing still map correctly):
 *   #000000  wall            (also: transparent pixels)
 *   #7eef6d  common zone
 *   #ffe65d  uncommon zone
 *   #4d52e3  rare zone
 *   #861fde  epic zone
 *   #de1f1f  legendary zone
 *   #1fdbde  mythic zone
 *   #ffffff  spawn cell 'S'  (exactly one; common zone)
 *   #ff00ff  boss room 'B'   (mythic zone; ultra bosses spawn here)
 *
 * The importer validates before writing: exactly one spawn, every corridor
 * reachable from it, and it warns about missing boss rooms, floor on the
 * border, and unused zones.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Map size is per-template and adjustable — must stay within the engine's
// bounds (MAZE_MIN/MAX_TEMPLATE_DIM in src/maze.ts).
const MIN_DIM = 8;
const MAX_DIM = 64;
const MAZE_TS_PATH = path.join(__dirname, '..', 'src', 'maze.ts');
const BIOMES = ['garden', 'desert', 'ocean'];

// char → color, in priority order for nearest-color matching
const PALETTE = [
    { ch: '#', name: 'wall', rgb: [0x00, 0x00, 0x00] },
    { ch: 'c', name: 'common', rgb: [0x7e, 0xef, 0x6d] },
    { ch: 'u', name: 'uncommon', rgb: [0xff, 0xe6, 0x5d] },
    { ch: 'r', name: 'rare', rgb: [0x4d, 0x52, 0xe3] },
    { ch: 'e', name: 'epic', rgb: [0x86, 0x1f, 0xde] },
    { ch: 'l', name: 'legendary', rgb: [0xde, 0x1f, 0x1f] },
    { ch: 'm', name: 'mythic', rgb: [0x1f, 0xdb, 0xde] },
    { ch: 'S', name: 'spawn', rgb: [0xff, 0xff, 0xff] },
    { ch: 'B', name: 'boss', rgb: [0xff, 0x00, 0xff] },
];
const CHAR_TO_RGB = Object.fromEntries(PALETTE.map(p => [p.ch, p.rgb]));

// ── Minimal PNG decoder (8-bit depth; gray / gray+alpha / RGB / RGBA / indexed) ──

function decodePNG(buf) {
    const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
    let pos = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    let palette = null, trns = null;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'PLTE') {
            palette = data;
        } else if (type === 'tRNS') {
            trns = data;
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + len;
    }
    if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (use 8-bit)`);
    if (interlace !== 0) throw new Error('interlaced PNGs are not supported (save without interlacing)');
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (channels === undefined) throw new Error(`unsupported PNG color type ${colorType}`);

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const bpp = channels;
    const out = Buffer.alloc(width * height * 4);
    let prevRow = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        const filter = raw[rowStart];
        const row = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? row[i - bpp] : 0;
            const b = prevRow[i];
            const c = i >= bpp ? prevRow[i - bpp] : 0;
            let v = row[i];
            if (filter === 1) v = (v + a) & 0xff;
            else if (filter === 2) v = (v + b) & 0xff;
            else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
            } else if (filter !== 0) {
                throw new Error(`unsupported PNG filter ${filter}`);
            }
            row[i] = v;
        }
        prevRow = row;
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (colorType === 0) {
                out[o] = out[o + 1] = out[o + 2] = row[x];
                out[o + 3] = 255;
            } else if (colorType === 4) {
                out[o] = out[o + 1] = out[o + 2] = row[x * 2];
                out[o + 3] = row[x * 2 + 1];
            } else if (colorType === 2) {
                out[o] = row[x * 3]; out[o + 1] = row[x * 3 + 1]; out[o + 2] = row[x * 3 + 2];
                out[o + 3] = 255;
            } else if (colorType === 6) {
                out[o] = row[x * 4]; out[o + 1] = row[x * 4 + 1]; out[o + 2] = row[x * 4 + 2];
                out[o + 3] = row[x * 4 + 3];
            } else if (colorType === 3) {
                const idx = row[x];
                if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
                out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
                out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
            }
        }
    }
    return { width, height, rgba: out };
}

// ── Minimal PNG encoder (RGBA, filter 0) ────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

function encodePNG(width, height, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + width * 4)] = 0; // filter: none
        rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Template <-> maze.ts ────────────────────────────────────────────────────

function readTemplateBlock(source, biome) {
    const anchor = `    ${biome}: [`;
    const start = source.indexOf(anchor);
    if (start < 0) throw new Error(`could not find "${biome}" template in src/maze.ts`);
    const end = source.indexOf('\n    ],', start);
    if (end < 0) throw new Error(`could not find end of "${biome}" template in src/maze.ts`);
    const body = source.slice(start + anchor.length, end);
    const rows = [...body.matchAll(/'([^']*)'/g)].map(m => m[1]);
    return { start: start + anchor.length, end, rows };
}

function writeTemplateBlock(source, biome, rows) {
    const { start, end } = readTemplateBlock(source, biome);
    const body = '\n' + rows.map(r => `        '${r}',`).join('\n');
    return source.slice(0, start) + body + source.slice(end);
}

// ── Import ──────────────────────────────────────────────────────────────────

function nearestChar(r, g, b, a) {
    if (a < 128) return '#'; // transparent = wall
    let best = '#', bestDist = Infinity;
    for (const p of PALETTE) {
        const d = (r - p.rgb[0]) ** 2 + (g - p.rgb[1]) ** 2 + (b - p.rgb[2]) ** 2;
        if (d < bestDist) { bestDist = d; best = p.ch; }
    }
    return best;
}

function imageToTemplate(img, sizeArg) {
    if (img.width !== img.height) {
        throw new Error(`image must be square, got ${img.width}x${img.height}`);
    }
    // Map size = image size (1px per cell) when it fits the engine bounds;
    // bigger images need an explicit --size so each cell is an NxN block.
    let dim;
    if (sizeArg) {
        dim = sizeArg;
        if (dim < MIN_DIM || dim > MAX_DIM) throw new Error(`--size must be ${MIN_DIM}-${MAX_DIM}, got ${dim}`);
        if (img.width % dim !== 0) throw new Error(`image size ${img.width} is not a multiple of --size ${dim}`);
    } else if (img.width >= MIN_DIM && img.width <= MAX_DIM) {
        dim = img.width;
    } else {
        throw new Error(
            `image is ${img.width}x${img.width} — either use a ${MIN_DIM}-${MAX_DIM} pixel image (1 pixel per cell) ` +
            `or pass --size <cells> for a scaled-up image (image size must be a multiple of it)`
        );
    }
    const scale = img.width / dim;
    const rows = [];
    // Average the central region of each cell block (the middle third, at
    // least 1px). Rounded wall corners (quarter-circle fillets) and
    // anti-aliasing live at cell corners/edges — the centre is unambiguous.
    const inset = Math.floor(scale / 3);
    for (let ty = 0; ty < dim; ty++) {
        let row = '';
        for (let tx = 0; tx < dim; tx++) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let py = ty * scale + inset; py < (ty + 1) * scale - inset; py++) {
                for (let px = tx * scale + inset; px < (tx + 1) * scale - inset; px++) {
                    const o = (py * img.width + px) * 4;
                    r += img.rgba[o]; g += img.rgba[o + 1]; b += img.rgba[o + 2]; a += img.rgba[o + 3];
                    n++;
                }
            }
            row += nearestChar(r / n, g / n, b / n, a / n);
        }
        rows.push(row);
    }
    return rows;
}

function validateTemplate(rows) {
    const errors = [];
    const warnings = [];
    const D = rows.length;

    // Spawn
    const spawns = [];
    const bosses = [];
    let floorCount = 0;
    const zoneSeen = new Set();
    for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
            const ch = rows[y][x];
            if (ch === '#') continue;
            floorCount++;
            zoneSeen.add(ch === 'S' ? 'c' : ch === 'B' ? 'm' : ch);
            if (ch === 'S') spawns.push([x, y]);
            if (ch === 'B') bosses.push([x, y]);
            if (x === 0 || y === 0 || x === D - 1 || y === D - 1) {
                warnings.push(`floor cell on the border at ${x},${y} (out-of-grid still acts as wall, but it will look cut off)`);
            }
        }
    }
    if (spawns.length === 0) errors.push("no spawn cell — paint exactly one white (#ffffff) pixel 'S'");
    if (spawns.length > 1) errors.push(`${spawns.length} spawn cells at ${spawns.map(s => s.join(',')).join(' / ')} — only one allowed`);
    if (bosses.length === 0) warnings.push("no boss rooms — paint magenta (#ff00ff) pixels 'B' or no ultra bosses will spawn");
    if (floorCount < 20) errors.push(`only ${floorCount} walkable cells — that's not much of a maze`);
    for (const z of ['c', 'u', 'r', 'e', 'l', 'm']) {
        if (!zoneSeen.has(z)) warnings.push(`zone '${z}' (${PALETTE.find(p => p.ch === z).name}) is unused`);
    }

    // Connectivity from spawn
    if (spawns.length === 1) {
        const seen = new Set([spawns[0][1] * D + spawns[0][0]]);
        const queue = [spawns[0][1] * D + spawns[0][0]];
        while (queue.length) {
            const idx = queue.pop();
            const x = idx % D, y = Math.floor(idx / D);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= D || ny >= D) continue;
                const nidx = ny * D + nx;
                if (seen.has(nidx) || rows[ny][nx] === '#') continue;
                seen.add(nidx);
                queue.push(nidx);
            }
        }
        const unreachable = floorCount - seen.size;
        if (unreachable > 0) {
            const spots = [];
            for (let y = 0; y < D && spots.length < 5; y++) {
                for (let x = 0; x < D && spots.length < 5; x++) {
                    if (rows[y][x] !== '#' && !seen.has(y * D + x)) spots.push(`${x},${y}`);
                }
            }
            errors.push(`${unreachable} walkable cells are unreachable from the spawn (e.g. at ${spots.join(' / ')})`);
        }
        for (const [bx, by] of bosses) {
            if (!seen.has(by * D + bx)) errors.push(`boss room at ${bx},${by} is unreachable from the spawn`);
        }
    }

    return { errors, warnings, stats: { floorCount, spawns, bosses } };
}

// ── Main ────────────────────────────────────────────────────────────────────

function usage() {
    console.log('Usage:');
    console.log('  node scripts/importMazeMap.js <image.png> <garden|desert|ocean> [--dry-run] [--size <cells>]');
    console.log('    Map size = image size (8-64 px, 1px per cell); bigger images need --size.');
    console.log('  node scripts/importMazeMap.js --export <garden|desert|ocean> <out.png> [--scale N]');
    console.log('');
    console.log('Colors:');
    for (const p of PALETTE) {
        const hex = '#' + p.rgb.map(v => v.toString(16).padStart(2, '0')).join('');
        console.log(`  ${hex}  ${p.name}${p.ch === 'S' ? ' (exactly one)' : ''}`);
    }
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

if (args[0] === '--export') {
    const biome = args[1];
    const outPath = args[2];
    if (!BIOMES.includes(biome) || !outPath) usage();
    const scaleIdx = args.indexOf('--scale');
    const scale = scaleIdx >= 0 ? Math.max(1, parseInt(args[scaleIdx + 1], 10) || 1) : 10;

    const source = fs.readFileSync(MAZE_TS_PATH, 'utf8');
    const { rows } = readTemplateBlock(source, biome);
    const dim = rows.length;
    const size = dim * scale;
    const rgba = Buffer.alloc(size * size * 4);
    for (let ty = 0; ty < dim; ty++) {
        for (let tx = 0; tx < dim; tx++) {
            const rgb = CHAR_TO_RGB[rows[ty][tx]] || CHAR_TO_RGB['#'];
            for (let dy = 0; dy < scale; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                    const o = ((ty * scale + dy) * size + tx * scale + dx) * 4;
                    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
                }
            }
        }
    }
    fs.writeFileSync(outPath, encodePNG(size, size, rgba));
    console.log(`Exported ${biome} template to ${outPath} (${size}x${size}, ${scale}px per cell).`);
    console.log('Edit it with the legend colors, then re-import with:');
    console.log(`  node scripts/importMazeMap.js ${outPath} ${biome}${size > MAX_DIM ? ` --size ${dim}` : ''}`);
    process.exit(0);
}

const imagePath = args[0];
const biome = args[1];
const dryRun = args.includes('--dry-run');
if (!BIOMES.includes(biome)) usage();

const sizeIdx = args.indexOf('--size');
const sizeArg = sizeIdx >= 0 ? parseInt(args[sizeIdx + 1], 10) : 0;
const img = decodePNG(fs.readFileSync(imagePath));
const rows = imageToTemplate(img, sizeArg);

// Preview
console.log(`Imported ${img.width}x${img.width} image as ${rows.length}x${rows.length} ${biome} template:`);
console.log(rows.map(r => '  ' + r).join('\n'));

const { errors, warnings, stats } = validateTemplate(rows);
for (const w of warnings) console.log(`WARNING: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`${stats.floorCount} walkable cells, ${stats.bosses.length} boss room(s), spawn at ${stats.spawns.map(s => s.join(',')).join(' / ') || 'none'}`);

if (errors.length > 0) {
    console.log('\nNot written — fix the errors above and re-run.');
    process.exit(1);
}
if (dryRun) {
    console.log('\nDry run — src/maze.ts not modified.');
    process.exit(0);
}

const source = fs.readFileSync(MAZE_TS_PATH, 'utf8');
fs.writeFileSync(MAZE_TS_PATH, writeTemplateBlock(source, biome, rows));
console.log(`\nWrote ${biome} template into src/maze.ts.`);
console.log('Rebuild to apply: npm run build:server && npm run build');
