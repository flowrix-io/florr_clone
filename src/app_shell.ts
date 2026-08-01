import { getBaseDeviceScale } from './zoom-compensation';

/**
 * The client is a single canvas driven by a single animation frame loop. The
 * title screen and the game are two *scenes* on that one surface, not two
 * independently-living apps.
 *
 * Before this existed, each half owned its own canvas element and its own
 * requestAnimationFrame loop, and handing over meant toggling `display`,
 * re-pointing every shared panel manager at the other canvas, copying a
 * screenshot between the two to fake a transition, and arbitrating which loop
 * was allowed to run through a mutable `window.currentGame` global. Every one
 * of those seams produced the same shape of bug: something in the handover
 * didn't happen, a loop stopped or was orphaned, and the screen froze on a
 * half-drawn frame while the DOM kept working.
 *
 * The invariants that make that class of bug unrepresentable here:
 *
 *  1. The loop starts once at boot and never stops. There is no code path that
 *     cancels it, so nothing can leave the client with no loop running.
 *  2. The next frame is scheduled *before* the scene draws. A scene that throws
 *     loses its own frame and nothing else — it cannot orphan the loop.
 *  3. Exactly one scene renders per frame, chosen by `mode`. Scenes never start
 *     or stop loops; they only get called.
 *  4. A scene change commits *immediately*, before any animation runs. The wipe
 *     is only a visual overlay played on top of the already-swapped scene, so a
 *     handover can never be lost by an animation that didn't finish.
 */

export type AppMode = 'title' | 'game';

export interface AppScene {
    /** Draw one frame of this scene. Called at most once per animation frame. */
    frame(): void;
    /** Called when this scene becomes the active one. */
    onEnter?(): void;
    /** Called when this scene stops being the active one. */
    onExit?(): void;
    /**
     * While a transition is opening onto this scene, the iris stays fully
     * closed until this returns true (capped by the transition deadline). Lets
     * the game hold the cover until the first authoritative position lands
     * instead of flashing the world at the origin.
     */
    readyToReveal?(): boolean;
    /** Reported by the shell when `frame()` throws, so the scene can self-heal. */
    onFrameError?(error: unknown): void;
}

const IRIS_DURATION_MS = 800;
const IRIS_OUTLINE_WIDTH = 6;
/** Hard cap on the covered-and-waiting phase, so a stuck scene can't wedge us. */
const REVEAL_HOLD_TIMEOUT_MS = 8000;

type Phase = 'idle' | 'covered' | 'wiping';

/**
 * Which region the *outgoing* snapshot occupies while it shrinks away:
 *   'outside' — the incoming scene irises in through a growing hole
 *               (title -> game: the world opens up inside the title screen).
 *   'inside'  — the outgoing scene shrinks to a point and the incoming scene
 *               is revealed around it (game -> title).
 * Either way the incoming scene renders live underneath and the outgoing one is
 * a still frame, so the two screens cross-wipe instead of dipping through black.
 */
type WipeRegion = 'outside' | 'inside';

class AppShell {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    private started: boolean = false;

    private mode: AppMode = 'title';
    private scenes: Partial<Record<AppMode, AppScene>> = {};

    private phase: Phase = 'idle';
    private phaseStartMs: number = 0;
    private pendingMode: AppMode | null = null;
    private onTransitionDone: (() => void) | null = null;
    /** Still frame of the scene being wiped away. */
    private wipeSnapshot: HTMLCanvasElement | null = null;
    private wipeRegion: WipeRegion = 'outside';

    private lastErrorLogMs: number = 0;

    /**
     * The one canvas both scenes draw into. Its stacking is fixed here, once:
     * the canvas always sits under the DOM overlays (chat, panels, widgets),
     * in both scenes. Nothing re-stacks or re-shows it on a scene change.
     */
    public attachCanvas(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        canvas.style.display = 'block';
        canvas.style.zIndex = '0';
        canvas.style.pointerEvents = 'auto';
    }

    public getCanvas(): HTMLCanvasElement | null {
        return this.canvas;
    }

    public registerScene(mode: AppMode, scene: AppScene): void {
        this.scenes[mode] = scene;
    }

    public getMode(): AppMode {
        return this.mode;
    }

    public isGameMode(): boolean {
        return this.mode === 'game';
    }

    /** True while an iris transition is on screen (input should be ignored). */
    public isTransitioning(): boolean {
        return this.phase !== 'idle';
    }

    /**
     * Start the loop. Idempotent, and there is deliberately no stop().
     */
    public start(): void {
        if (this.started) return;
        this.started = true;
        requestAnimationFrame(this.frame);
    }

    private frame = (): void => {
        // Scheduled first, on purpose: see invariant 2 above. Everything below
        // this line is allowed to fail without taking the client down.
        requestAnimationFrame(this.frame);

        const scene = this.scenes[this.mode];
        if (scene) {
            try {
                scene.frame();
            } catch (error) {
                this.reportFrameError(error);
                try {
                    scene.onFrameError?.(error);
                } catch { /* a broken error handler must not break the loop either */ }
            }
        }

        try {
            this.stepTransition();
        } catch (error) {
            // The scene swap already happened in switchTo(); only the overlay
            // can fail here, so dropping it just ends the animation early.
            this.reportFrameError(error);
            this.phase = 'idle';
            this.wipeSnapshot = null;
        }
    };

    private reportFrameError(error: unknown): void {
        const now = performance.now();
        if (now - this.lastErrorLogMs < 5000) return;
        this.lastErrorLogMs = now;
        console.error(`[AppShell] '${this.mode}' scene frame failed (loop continues):`, error);
    }

    /**
     * Switch scenes with an iris wipe.
     *
     * The swap itself happens right here, synchronously: the incoming scene is
     * live from the very next frame. What animates afterwards is only a still
     * frame of the outgoing scene shrinking away on top of it. That ordering is
     * deliberate — the handover completes even if the animation never does.
     *
     * `prepare` is where the caller builds the incoming scene. It has to run
     * *here*, between the snapshot and the commit, because constructing a scene
     * resizes the shared canvas and resizing a canvas wipes its pixels — do it
     * before the snapshot and there is nothing left to wipe away from, which
     * shows up as the incoming scene appearing instantly and unfinished.
     * Sequencing it inside the shell keeps that from being something each call
     * site has to remember.
     */
    public switchTo(mode: AppMode, opts: { prepare?: () => void; onDone?: () => void } = {}): void {
        // The commit below is synchronous, so `mode` is always the authoritative
        // current scene — this also makes a double-click a no-op rather than a
        // restarted wipe.
        if (this.mode === mode) {
            opts.onDone?.();
            return;
        }

        // 1. Freeze the outgoing scene as it currently stands on the canvas.
        this.wipeSnapshot = this.captureCanvas();
        // Going to the game: the world opens through a growing hole in the
        // title screen. Coming back: the world shrinks to a point and the title
        // screen is revealed around it. Same as the pre-shell behaviour.
        this.wipeRegion = mode === 'game' ? 'outside' : 'inside';

        // 2. Build the incoming scene (may clear the canvas — already snapshotted).
        try {
            opts.prepare?.();
        } catch (e) {
            console.error('[AppShell] scene prepare failed, staying put:', e);
            this.wipeSnapshot = null;
            return;
        }

        // 3. Commit, then play the wipe over the top.
        this.pendingMode = mode;
        this.commitPendingMode();

        this.onTransitionDone = opts.onDone ?? null;
        this.phase = 'covered';
        this.phaseStartMs = performance.now();
    }

    /** Copy the current canvas contents at full backing resolution. */
    private captureCanvas(): HTMLCanvasElement | null {
        if (!this.canvas || this.canvas.width === 0 || this.canvas.height === 0) return null;
        try {
            const shot = document.createElement('canvas');
            shot.width = this.canvas.width;
            shot.height = this.canvas.height;
            shot.getContext('2d')!.drawImage(this.canvas, 0, 0);
            return shot;
        } catch (e) {
            console.error('[AppShell] snapshot failed, wiping without one:', e);
            return null;
        }
    }

    private commitPendingMode(): void {
        const next = this.pendingMode;
        this.pendingMode = null;
        if (next === null || next === this.mode) return;
        const from = this.scenes[this.mode];
        const to = this.scenes[next];
        this.mode = next;
        // Scene enter/exit hooks are best-effort: a throwing hook must not
        // leave the shell stuck between modes.
        try { from?.onExit?.(); } catch (e) { console.error('[AppShell] onExit failed:', e); }
        try { to?.onEnter?.(); } catch (e) { console.error('[AppShell] onEnter failed:', e); }
    }

    private stepTransition(): void {
        if (this.phase === 'idle' || !this.ctx || !this.canvas) return;

        const now = performance.now();
        const elapsed = now - this.phaseStartMs;

        // Covered: the outgoing snapshot still hides the whole screen while the
        // incoming scene gets itself ready underneath (the game holds here until
        // its first authoritative position lands, so the world is never shown
        // sitting at the origin). Bounded, so a scene that never reports ready
        // still gets revealed.
        if (this.phase === 'covered') {
            this.drawWipe(0);
            const scene = this.scenes[this.mode];
            const ready = !scene?.readyToReveal || scene.readyToReveal();
            if (ready || elapsed > REVEAL_HOLD_TIMEOUT_MS) {
                this.phase = 'wiping';
                this.phaseStartMs = now;
            }
            return;
        }

        const progress = Math.min(elapsed / IRIS_DURATION_MS, 1);
        this.drawWipe(progress);
        if (progress >= 1) {
            this.phase = 'idle';
            this.wipeSnapshot = null;
            const done = this.onTransitionDone;
            this.onTransitionDone = null;
            try { done?.(); } catch (e) { console.error('[AppShell] transition callback failed:', e); }
        }
    }

    /**
     * Draw the outgoing scene's still frame over the (already live) incoming
     * one, masked to a circle that hands the screen over as `progress` runs
     * 0 -> 1. The incoming scene is whatever rendered this frame, so the two
     * screens cross-fade through each other rather than through black.
     */
    private drawWipe(progress: number): void {
        const ctx = this.ctx!;
        const dpr = getBaseDeviceScale();
        const w = this.canvas!.width / dpr;
        const h = this.canvas!.height / dpr;
        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = Math.sqrt(cx * cx + cy * cy);

        // 'outside': hole grows, easing out.  'inside': disc shrinks, easing in.
        const eased = this.wipeRegion === 'outside'
            ? 1 - Math.pow(1 - progress, 3)
            : Math.pow(1 - progress, 3);
        const radius = Math.max(0, eased * maxRadius);

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        if (this.wipeRegion === 'outside') {
            // Everything except the growing circle.
            ctx.rect(0, 0, w, h);
            ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
        } else {
            // Just the shrinking circle.
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        }
        ctx.clip();
        if (this.wipeSnapshot) {
            ctx.drawImage(this.wipeSnapshot, 0, 0, w, h);
        } else {
            // No snapshot available — fall back to a plain black wipe.
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();

        // Black rim on the circle edge, as the pre-shell transition had.
        if (radius > 0) {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = IRIS_OUTLINE_WIDTH;
            ctx.stroke();
            ctx.restore();
        }
    }
}

export const appShell = new AppShell();
