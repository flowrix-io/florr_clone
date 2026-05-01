import { Graphics } from './core';

/**
 * Cache of pre-rendered static map content (background + wall grid + edges).
 *
 * Per frame the world rendering used to do hundreds of fillRect / stroke
 * calls for the wall grid plus a tile loop for the background. None of that
 * geometry changes between frames, so we render each fixed-size chunk of
 * world space into an offscreen canvas the first time it's needed and just
 * blit visible chunks every frame after that. Per-frame work for the static
 * map drops to a handful of `drawImage` calls.
 *
 * Chunks are aligned to world coordinates so a single chunk renders
 * identically regardless of where the camera is — they can be reused as the
 * player moves around. Cache survives until `invalidate()` is called (e.g.
 * when section/biome textures finish loading and we want to re-bake).
 */

// Chunk size in world units. 1024 is a balance between:
//   - chunk count visible per frame (smaller => more blits)
//   - per-chunk render cost on first encounter (larger => longer pause)
//   - memory per chunk (1024*1024*4 bytes ≈ 4 MB).
const CHUNK_SIZE = 1024;

// Hard cap on cached chunks so memory stays bounded even on long sessions.
// Eviction is FIFO of insertion order — good enough since the player tends
// to revisit the same areas.
const MAX_CACHED_CHUNKS = 64;

declare module './core' {
    interface Graphics {
        staticMapCache?: StaticMapCache;
        invalidateStaticMapCache(): void;
        renderStaticMap(viewport: { left: number; right: number; top: number; bottom: number }): void;
    }
}

class StaticMapCache {
    private chunks = new Map<string, HTMLCanvasElement>();
    /** Chunks that failed to render (e.g. ctx allocation failed) — won't retry forever. */
    private failed = new Set<string>();

    /** Drop everything. Call when the underlying static content changes. */
    public clear(): void {
        this.chunks.clear();
        this.failed.clear();
    }

    /**
     * Blit every chunk that intersects `viewport` into `g.ctx`. Generates
     * missing chunks on demand. The active ctx is expected to already have
     * the world-coord transform applied (i.e. drawImage at world coords
     * will land in the right place).
     */
    public blitVisible(g: Graphics, viewport: { left: number; right: number; top: number; bottom: number }): void {
        const minCx = Math.floor(viewport.left / CHUNK_SIZE);
        const maxCx = Math.floor(viewport.right / CHUNK_SIZE);
        const minCy = Math.floor(viewport.top / CHUNK_SIZE);
        const maxCy = Math.floor(viewport.bottom / CHUNK_SIZE);

        const targetCtx = g.ctx;
        for (let cy = minCy; cy <= maxCy; cy++) {
            for (let cx = minCx; cx <= maxCx; cx++) {
                const key = `${cx},${cy}`;
                if (this.failed.has(key)) continue;
                let canvas: HTMLCanvasElement | undefined = this.chunks.get(key);
                if (!canvas) {
                    const generated = this.renderChunk(g, cx, cy);
                    if (!generated) {
                        this.failed.add(key);
                        continue;
                    }
                    canvas = generated;
                    this.evictIfFull();
                    this.chunks.set(key, canvas);
                }
                targetCtx.drawImage(canvas, cx * CHUNK_SIZE, cy * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
            }
        }
    }

    private evictIfFull(): void {
        if (this.chunks.size < MAX_CACHED_CHUNKS) return;
        // Map iteration is insertion order — drop the oldest entry. Cheap
        // eviction; works because nearby chunks tend to be inserted together,
        // so we keep most of the locality.
        const oldest = this.chunks.keys().next().value;
        if (oldest !== undefined) this.chunks.delete(oldest);
    }

    /**
     * Render the static content for one chunk. We temporarily swap the
     * graphics context's drawing target / camera so existing
     * drawScrollingBackground + drawWallGrid implementations can be reused
     * without modification (they read this.ctx, this.canvas, this.cameraX,
     * this.cameraY, this.zoomLevel — all redirected here).
     */
    private renderChunk(g: Graphics, cx: number, cy: number): HTMLCanvasElement | null {
        const canvas = document.createElement('canvas');
        canvas.width = CHUNK_SIZE;
        canvas.height = CHUNK_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Translate so the chunk's world origin maps to (0, 0) in the
        // chunk canvas — then existing draw code can use raw world coords.
        ctx.translate(-cx * CHUNK_SIZE, -cy * CHUNK_SIZE);

        // Match the antialiasing setting so the cached chunk doesn't drift
        // visually when the user toggles AA at runtime.
        ctx.imageSmoothingEnabled = g.antialiasing;

        const savedCtx = g.ctx;
        const savedCanvas = g.canvas;
        const savedCameraX = g.cameraX;
        const savedCameraY = g.cameraY;
        const savedZoom = g.zoomLevel;

        // Pretend the canvas IS this chunk so background/wall-grid loops
        // pick the right viewport bounds.
        g.ctx = ctx;
        // Cast: we only stub the dimensions used by drawScrollingBackground.
        g.canvas = { width: CHUNK_SIZE, height: CHUNK_SIZE } as HTMLCanvasElement;
        g.cameraX = cx * CHUNK_SIZE;
        g.cameraY = cy * CHUNK_SIZE;
        g.zoomLevel = 1.0;

        try {
            const viewport = {
                left: cx * CHUNK_SIZE,
                top: cy * CHUNK_SIZE,
                right: (cx + 1) * CHUNK_SIZE,
                bottom: (cy + 1) * CHUNK_SIZE,
            };
            g.drawScrollingBackground();
            g.drawWallGrid(viewport);
        } finally {
            g.ctx = savedCtx;
            g.canvas = savedCanvas;
            g.cameraX = savedCameraX;
            g.cameraY = savedCameraY;
            g.zoomLevel = savedZoom;
        }

        return canvas;
    }
}

Graphics.prototype.invalidateStaticMapCache = function(this: Graphics): void {
    if (this.staticMapCache) this.staticMapCache.clear();
};

Graphics.prototype.renderStaticMap = function(this: Graphics, viewport: { left: number; right: number; top: number; bottom: number }): void {
    if (!this.staticMapCache) {
        this.staticMapCache = new StaticMapCache();
    }
    this.staticMapCache.blitVisible(this, viewport);
};
