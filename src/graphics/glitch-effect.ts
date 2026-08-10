import type { Graphics } from './core';

// Glitch render modifier for players carrying PlayerRenderFlags.Glitch.
//
// Unlike the entries in player-skins.ts this does NOT replace the flower body —
// it wraps whatever body renderer drawPlayer would have used (default flower,
// built-in skin, or user-created skin) and post-processes its output, so the
// flag composes with the skin bits instead of competing with them.
//
// The effect is intermittent: time is chopped into GLITCH_PERIOD_MS buckets and
// only some buckets "burst". A non-burst bucket calls the body renderer
// straight onto the main context, i.e. the common frame costs exactly what an
// unflagged player costs — no buffer, no extra blits. A burst frame renders the
// body once into an offscreen buffer and recomposites it as horizontally torn
// scanline bands with an additive red/cyan fringe.
//
// Everything is derived from hash(playerSeed, bucket), never from Math.random,
// so a player's glitch pattern is stable within a bucket (no per-draw flicker if
// a flower is ever drawn twice in a frame) while still differing per player.

const GLITCH_PERIOD_MS = 70;   // length of one pseudo-random state bucket
const BURST_CHANCE = 0.45;     // fraction of buckets that actually glitch
const BAND_COUNT = 9;          // horizontal slices the body is torn into
const BAND_SHIFT_CHANCE = 0.3; // per-band chance of being displaced
const BAND_DROP_CHANCE = 0.06; // per-band chance of dropping out entirely
const MAX_BUFFER_SIDE = 1024;  // past this the effect silently disables itself

// One shared pair of buffers for every glitching player on screen: a player is
// drawn, composited and finished before the next one starts, so they can never
// be needed concurrently. Sized in SCREEN pixels and grown in 64px steps (never
// shrunk) so zooming doesn't reallocate every frame.
let bodyCanvas: HTMLCanvasElement | null = null;
let bodyCtx: CanvasRenderingContext2D | null = null;
let tintCanvas: HTMLCanvasElement | null = null;
let tintCtx: CanvasRenderingContext2D | null = null;
let bufferSide = 0;

// Cheap stable string → int hash, so a player's pattern follows their id rather
// than their draw order. Cached because ids never change for a live flower.
const seedCache = new Map<string, number>();

export function glitchSeedFor(id: string): number {
    let seed = seedCache.get(id);
    if (seed === undefined) {
        seed = 0;
        for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
        // Unbounded growth isn't a concern (ids are per-session sockets), but a
        // long-lived client cycling through thousands of players shouldn't keep
        // them all — the hash is cheap enough to recompute.
        if (seedCache.size > 512) seedCache.clear();
        seedCache.set(id, seed);
    }
    return seed;
}

/** Deterministic [0, 1) from two integers. */
function hash01(a: number, b: number): number {
    let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Grow the shared buffers to at least `side` screen pixels. */
function ensureBuffers(side: number): boolean {
    if (side > MAX_BUFFER_SIDE) return false;
    if (bodyCtx && tintCtx && bufferSide >= side) return true;
    const target = Math.min(MAX_BUFFER_SIDE, Math.ceil(side / 64) * 64);
    if (!bodyCanvas) bodyCanvas = document.createElement('canvas');
    if (!tintCanvas) tintCanvas = document.createElement('canvas');
    bodyCanvas.width = bodyCanvas.height = target;
    tintCanvas.width = tintCanvas.height = target;
    bodyCtx = bodyCanvas.getContext('2d');
    tintCtx = tintCanvas.getContext('2d');
    bufferSide = bodyCtx && tintCtx ? target : 0;
    return bufferSide > 0;
}

/**
 * Fill `tintCanvas` with the body silhouette flattened to a single channel
 * (`color` is expected to be a pure primary like #ff0000 / #00ffff): multiply
 * paints the whole rect, then destination-in trims it back to the body's own
 * alpha mask.
 */
function buildTint(side: number, color: string): void {
    const ctx = tintCtx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(bodyCanvas!, 0, 0, side, side, 0, 0, side, side);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, side, side);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(bodyCanvas!, 0, 0, side, side, 0, 0, side, side);
    ctx.globalCompositeOperation = 'source-over';
}

/**
 * Render a flower body through the glitch effect.
 *
 * `drawBody` must draw in player-local space (origin at the flower centre,
 * radius ~`radius`) reading `g.ctx` at call time — the context is swapped to the
 * offscreen buffer for the duration of the call. The caller keeps ownership of
 * save()/restore() around the whole thing.
 */
export function drawBodyWithGlitch(
    g: Graphics,
    radius: number,
    seed: number,
    drawBody: () => void,
): void {
    const bucket = Math.floor(g.frameTimestamp / GLITCH_PERIOD_MS);
    if (hash01(seed, bucket) >= BURST_CHANCE) {
        drawBody();
        return;
    }

    const mainCtx = g.ctx;
    // Half-extent in local units. The body is nominally `radius`, but equipment
    // (antennae, third eye) and skins overshoot it, so leave generous margin.
    const half = radius * 2 + 24;
    // Match the buffer's resolution to the on-screen size of the flower (camera
    // zoom × device scale) so the composite blits back at ~1:1. hypot of the
    // first column is the x-axis scale even with the teleporter spin applied.
    // A size-6 flower at high zoom would ask for more than the buffer cap, so
    // clamp the scale rather than the extent: the effect degrades to a softer
    // upscaled blit instead of vanishing on exactly the biggest flowers.
    const m = mainCtx.getTransform();
    const maxScale = MAX_BUFFER_SIDE / (half * 2);
    const screenScale = Math.min(4, maxScale, Math.max(0.25, Math.hypot(m.a, m.b)));
    const side = Math.ceil(half * 2 * screenScale);
    if (side < 8 || !ensureBuffers(side)) {
        drawBody();
        return;
    }

    // ── Render the untouched body into the buffer ───────────────────────────
    const bctx = bodyCtx!;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, side, side);
    bctx.setTransform(screenScale, 0, 0, screenScale, half * screenScale, half * screenScale);
    bctx.save();
    g.ctx = bctx;
    try {
        drawBody();
    } finally {
        g.ctx = mainCtx;
        bctx.restore();
    }

    const fullW = half * 2;
    const invScale = 1 / screenScale;

    // ── Tear: blit the buffer back one horizontal band at a time ────────────
    mainCtx.save();
    for (let i = 0; i < BAND_COUNT; i++) {
        const sy = Math.floor((side * i) / BAND_COUNT);
        const sh = Math.floor((side * (i + 1)) / BAND_COUNT) - sy;
        if (sh <= 0) continue;

        const roll = hash01(seed ^ 0x5f3759df, bucket * 31 + i);
        if (roll < BAND_DROP_CHANCE) continue; // signal dropout — band missing
        let dx = 0;
        if (roll < BAND_DROP_CHANCE + BAND_SHIFT_CHANCE) {
            dx = (hash01(seed, bucket * 17 + i) - 0.5) * radius * 0.9;
        }

        mainCtx.drawImage(
            bodyCanvas!,
            0, sy, side, sh,
            -half + dx, -half + sy * invScale, fullW, sh * invScale,
        );
    }

    // ── Chromatic fringe: additive red/cyan copies pulled apart ─────────────
    // Only on the stronger bursts, so the effect breathes instead of sitting at
    // a constant intensity (and so the two tint rebuilds aren't paid every
    // burst frame).
    const fringe = hash01(seed ^ 0x27d4eb2f, bucket);
    if (fringe < 0.65) {
        // Capped in absolute pixels: scaled purely off radius, a size-6 flower
        // pulls the copies a body-width apart and reads as three flowers rather
        // than one fringed one.
        const shift = Math.min(6, (0.04 + fringe * 0.12) * radius);
        mainCtx.globalCompositeOperation = 'lighter';
        mainCtx.globalAlpha = 0.36;
        buildTint(side, '#ff0000');
        mainCtx.drawImage(tintCanvas!, 0, 0, side, side, -half - shift, -half, fullW, fullW);
        buildTint(side, '#00ffff');
        mainCtx.drawImage(tintCanvas!, 0, 0, side, side, -half + shift, -half, fullW, fullW);
    }
    mainCtx.restore();
}
