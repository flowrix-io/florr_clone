import { Socket } from './ws_client';
import { getBaseDeviceScale } from './zoom-compensation';
import {
    SkinShape,
    SkinShapeType,
    CustomSkin,
    sanitizeSkin,
    MAX_SKIN_SHAPES,
    MAX_SKIN_NAME_LEN,
    MAX_POLY_POINTS,
    SKIN_COORD_LIMIT,
    SKIN_RADIUS_LIMIT,
    MAX_STROKE_WIDTH,
} from './skin_format';
import { renderCustomSkinShapes } from './graphics/player-skins';
import { getCurrentGame } from './app_refs';

// Skin Studio: a canvas-drawn menu (same lifecycle/style as GuildMenuManager —
// drawn on the shared title/game canvas, opened from the top icon-button strip).
// Players author a data-driven skin out of simple shapes and publish it; everyone
// can browse published skins and equip one; admins (and authors) can take skins
// down. Skins are pure data (skin_format.ts) re-sanitized server-side, so nothing
// here runs untrusted code.

type Action =
    | { k: 'close' }
    | { k: 'tab'; tab: 'create' | 'browse' }
    | { k: 'addShape'; shape: SkinShapeType }
    | { k: 'selectShape'; i: number }
    | { k: 'moveShape'; i: number; dir: number }
    | { k: 'delShape'; i: number }
    | { k: 'step'; field: string; delta: number }
    | { k: 'fill'; color: string }
    | { k: 'stroke'; color: string }
    | { k: 'addVertex' }
    | { k: 'delVertex' }
    | { k: 'editName' }
    | { k: 'textMode' }
    | { k: 'publish' }
    | { k: 'reset' }
    | { k: 'equip'; id: string }
    | { k: 'unequip' }
    | { k: 'delete'; id: string; name: string };

interface HitRegion { x: number; y: number; w: number; h: number; action: Action; }

// Theme matches the purple "skins" icon-button on the title strip
// (#c45cff bg / #9a3fd0 border in title_screen/canvas_buttons.ts).
const ACCENT = '#c45cff';
const BORDER = '#9a3fd0';
const ACCENT_FG = '#2c0d44';      // dark-purple text drawn on top of ACCENT fills
const ACCENT_SEL = 'rgba(196,92,255,0.18)'; // selected-row tint (ACCENT @ 18%)
const PANEL_BG = '#8737b6';
const PANEL_BG2 = '#702d97';
const ROW_BG = '#a655dd';     // secondary buttons — themed purple, dimmer than ACCENT
const LIST_ROW = '#5f2a86';   // shape-list row background — darker purple, reads on PANEL_BG2
const CLOSE_BG = '#dc7e92';
const CLOSE_BORDER = '#b56476';
const TEXT = '#e9eef1';
const MUTED = '#9fb0b8';
const ERROR_FG = '#ff8a9a';

const PALETTE = [
    '#ffe763', '#ff9d00', '#e8731f', '#d01c1d', '#e85cc0', '#c45cff', '#3a86ff',
    '#27dade', '#2bd14f', '#7d5a3a', '#ffffff', '#bfc6cc', '#5a6670', '#111111',
];

function starterShapes(): SkinShape[] {
    return [
        { t: 'circle', x: 0, y: 0, r: 25, fill: '#ffe763', stroke: '#cdb74f', sw: 3, rot: 0 },
        { t: 'ellipse', x: -7, y: -5, rx: 3.2, ry: 6.5, fill: '#111111', stroke: '', sw: 0, rot: 0 },
        { t: 'ellipse', x: 7, y: -5, rx: 3.2, ry: 6.5, fill: '#111111', stroke: '', sw: 0, rot: 0 },
    ];
}

function defaultShape(t: SkinShapeType): SkinShape {
    switch (t) {
        case 'circle': return { t, x: 0, y: 0, r: 10, fill: '#3a86ff', stroke: '', sw: 0, rot: 0 };
        case 'ellipse': return { t, x: 0, y: 0, rx: 10, ry: 6, fill: '#3a86ff', stroke: '', sw: 0, rot: 0 };
        case 'rect': return { t, x: 0, y: 0, rx: 8, ry: 8, fill: '#3a86ff', stroke: '', sw: 0, rot: 0 };
        case 'line': return { t, x: -10, y: 0, x2: 10, y2: 0, stroke: '#111111', sw: 2, fill: '', rot: 0 };
        case 'polygon': return { t, x: 0, y: 0, points: [0, -12, 11, 8, -11, 8], fill: '#3a86ff', stroke: '', sw: 0, rot: 0 };
    }
}

export class SkinStudio {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private socket: Socket | null = null;
    private isOpen_ = false;
    private tab: 'create' | 'browse' = 'create';

    // Editor state
    private shapes: SkinShape[] = starterShapes();
    private selected = 0;
    private skinName = '';

    // Catalog state (mirrors the server's published-skin set)
    private catalog: CustomSkin[] = [];
    private isAdmin = false;
    private equippedId = '';

    // Interaction state
    private hitRegions: HitRegion[] = [];
    private hoverKey: string | null = null;
    private listScroll = 0;
    private browseScroll = 0;
    private drag: { handle: string } | null = null;
    private nameInput: HTMLInputElement | null = null;

    // Text mode: swap the visual editor for a textarea where the skin's shapes
    // are typed directly as canvas commands (one shape per line). Edits parse
    // back into `shapes` live, so the preview updates as you type.
    private textMode = false;
    private textArea: HTMLTextAreaElement | null = null;
    private textError = '';

    private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
    private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private mouseUpHandler: (() => void) | null = null;
    private wheelHandler: ((e: WheelEvent) => void) | null = null;
    private keyHandler: ((e: KeyboardEvent) => void) | null = null;

    // Layout (logical px; panel drawn with the shared device scale like guildMenu)
    private readonly PX = 20;
    private readonly PY = 72;
    private readonly PW = 600;
    private readonly PH = 540;
    private readonly HEADER = 46;
    private readonly PREVIEW = 200;

    constructor() {
        this.keyHandler = (e: KeyboardEvent) => {
            if (!this.isOpen_) return;
            if (e.key === 'Escape' && !this.nameInput && !this.textArea) this.hide();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    // ── lifecycle ──────────────────────────────────────────────────────────
    public setCanvas(canvas: HTMLCanvasElement): void {
        this.detachCanvas();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.attachCanvas();
    }

    public setSocket(socket: Socket | null): void { this.socket = socket; }

    public isOpen(): boolean { return this.isOpen_; }
    public toggle(): void { this.isOpen_ ? this.hide() : this.show(); }
    public show(): void { this.isOpen_ = true; }
    public hide(): void { this.isOpen_ = false; this.closeNameInput(); this.removeTextArea(); this.drag = null; }

    private attachCanvas(): void {
        if (!this.canvas) return;
        this.mouseDownHandler = (e) => this.onMouseDown(e);
        this.mouseMoveHandler = (e) => this.onMouseMove(e);
        this.mouseUpHandler = () => { this.drag = null; };
        this.wheelHandler = (e) => this.onWheel(e);
        this.canvas.addEventListener('mousedown', this.mouseDownHandler);
        this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
        this.canvas.addEventListener('mouseup', this.mouseUpHandler);
        this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }
    private detachCanvas(): void {
        if (!this.canvas) return;
        if (this.mouseDownHandler) this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
        if (this.mouseMoveHandler) this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
        if (this.mouseUpHandler) this.canvas.removeEventListener('mouseup', this.mouseUpHandler);
        if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
        this.mouseDownHandler = this.mouseMoveHandler = null;
        this.mouseUpHandler = null; this.wheelHandler = null;
    }

    // ── socket-driven catalog updates (called from socket.ts) ──────────────
    public applyCatalog(skins: CustomSkin[], isAdmin: boolean): void {
        this.catalog = Array.isArray(skins) ? skins.slice() : [];
        this.isAdmin = isAdmin;
        this.equippedId = getCurrentGame()?.getLocalPlayer()?.equippedSkinId || this.equippedId;
    }
    public applySkinPublished(skin: CustomSkin): void {
        if (!skin || !skin.id) return;
        const i = this.catalog.findIndex(s => s.id === skin.id);
        if (i >= 0) this.catalog[i] = skin; else this.catalog.push(skin);
    }
    public applySkinDeleted(id: string): void {
        this.catalog = this.catalog.filter(s => s.id !== id);
        if (this.equippedId === id) this.equippedId = '';
    }

    // ── mouse ──────────────────────────────────────────────────────────────
    private localMouse(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private previewRect() {
        return { x: this.PX + 24, y: this.PY + this.HEADER + 12, w: this.PREVIEW, h: this.PREVIEW };
    }
    private previewScale(): number { return (this.PREVIEW / 2) / 40; } // shows ±40 local units
    private toLocal(mx: number, my: number) {
        const pr = this.previewRect();
        const s = this.previewScale();
        return { x: (mx - (pr.x + pr.w / 2)) / s, y: (my - (pr.y + pr.h / 2)) / s };
    }
    private toPx(lx: number, ly: number) {
        const pr = this.previewRect();
        const s = this.previewScale();
        return { x: pr.x + pr.w / 2 + lx * s, y: pr.y + pr.h / 2 + ly * s };
    }

    // Draggable handles for the selected shape, in local coords.
    private handles(): { id: string; lx: number; ly: number }[] {
        const s = this.shapes[this.selected];
        if (!s) return [];
        const out = [{ id: 'c', lx: s.x, ly: s.y }];
        if (s.t === 'line') out.push({ id: 'e', lx: s.x2 ?? 0, ly: s.y2 ?? 0 });
        if (s.t === 'polygon' && s.points) {
            for (let i = 0; i + 1 < s.points.length; i += 2) {
                out.push({ id: 'v' + (i / 2), lx: s.x + s.points[i], ly: s.y + s.points[i + 1] });
            }
        }
        return out;
    }

    private onMouseDown(e: MouseEvent): void {
        if (!this.isOpen_ || !this.canvas) return;
        const { x, y } = this.localMouse(e);

        // Clicks on UI regions first.
        const region = this.hitTest(x, y);
        if (region) { e.preventDefault(); this.dispatch(region.action); return; }

        // Otherwise: start a drag in the preview if the create tab is showing.
        if (this.tab === 'create' && !this.textMode && this.shapes[this.selected]) {
            const pr = this.previewRect();
            if (x >= pr.x && x <= pr.x + pr.w && y >= pr.y && y <= pr.y + pr.h) {
                e.preventDefault();
                let best: string | null = null, bestD = 9;
                for (const h of this.handles()) {
                    const p = this.toPx(h.lx, h.ly);
                    const d = Math.hypot(p.x - x, p.y - y);
                    if (d < bestD) { bestD = d; best = h.id; }
                }
                this.drag = { handle: best || 'c' };
                this.applyDrag(x, y);
            }
        }
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isOpen_ || !this.canvas) return;
        const { x, y } = this.localMouse(e);
        if (this.drag) { this.applyDrag(x, y); return; }
        const region = this.hitTest(x, y);
        this.hoverKey = region ? actionKey(region.action) : null;
        const inPanel = x >= this.PX && x <= this.PX + this.PW && y >= this.PY && y <= this.PY + this.PH;
        this.canvas.style.cursor = region ? 'pointer' : inPanel ? 'default' : 'default';
    }

    private applyDrag(mx: number, my: number): void {
        const s = this.shapes[this.selected];
        if (!s || !this.drag) return;
        const l = this.toLocal(mx, my);
        const cx = clamp(l.x, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT);
        const cy = clamp(l.y, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT);
        const h = this.drag.handle;
        if (h === 'c') { s.x = round1(cx); s.y = round1(cy); }
        else if (h === 'e') { s.x2 = round1(cx); s.y2 = round1(cy); }
        else if (h[0] === 'v' && s.points) {
            const i = parseInt(h.slice(1)) * 2;
            s.points[i] = round1(cx - s.x); s.points[i + 1] = round1(cy - s.y);
        }
    }

    private onWheel(e: WheelEvent): void {
        if (!this.isOpen_ || !this.canvas) return;
        const { x, y } = this.localMouse(e);
        if (x < this.PX || x > this.PX + this.PW || y < this.PY || y > this.PY + this.PH) return;
        e.preventDefault();
        if (this.tab === 'browse') this.browseScroll = Math.max(0, this.browseScroll + e.deltaY);
        else this.listScroll = Math.max(0, this.listScroll + e.deltaY);
    }

    private hitTest(x: number, y: number): HitRegion | null {
        // Later regions are drawn on top, so iterate in reverse.
        for (let i = this.hitRegions.length - 1; i >= 0; i--) {
            const r = this.hitRegions[i];
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
        }
        return null;
    }

    // ── actions ────────────────────────────────────────────────────────────
    private dispatch(a: Action): void {
        switch (a.k) {
            case 'close': this.hide(); break;
            case 'tab': this.tab = a.tab; break;
            case 'addShape':
                if (this.shapes.length >= MAX_SKIN_SHAPES) break;
                this.shapes.push(defaultShape(a.shape));
                this.selected = this.shapes.length - 1;
                break;
            case 'selectShape': this.selected = a.i; break;
            case 'moveShape': {
                const j = a.i + a.dir;
                if (j < 0 || j >= this.shapes.length) break;
                const t = this.shapes[a.i]; this.shapes[a.i] = this.shapes[j]; this.shapes[j] = t;
                if (this.selected === a.i) this.selected = j; else if (this.selected === j) this.selected = a.i;
                break;
            }
            case 'delShape':
                this.shapes.splice(a.i, 1);
                if (this.selected >= this.shapes.length) this.selected = this.shapes.length - 1;
                break;
            case 'step': this.step(a.field, a.delta); break;
            case 'fill': { const s = this.shapes[this.selected]; if (s) s.fill = a.color; break; }
            case 'stroke': {
                const s = this.shapes[this.selected];
                if (s) { s.stroke = a.color; if (a.color && !(s.sw && s.sw > 0)) s.sw = 2; }
                break;
            }
            case 'addVertex': {
                const s = this.shapes[this.selected];
                if (s && s.t === 'polygon' && s.points && s.points.length < MAX_POLY_POINTS * 2) {
                    const n = s.points.length;
                    const ax = s.points[n - 2], ay = s.points[n - 1];
                    const bx = s.points[0], by = s.points[1];
                    s.points.push(round1((ax + bx) / 2), round1((ay + by) / 2));
                }
                break;
            }
            case 'delVertex': {
                const s = this.shapes[this.selected];
                if (s && s.t === 'polygon' && s.points && s.points.length > 6) s.points.splice(-2, 2);
                break;
            }
            case 'editName': this.openNameInput(); break;
            case 'textMode': this.textMode = !this.textMode; this.textError = ''; break;
            case 'publish': this.publish(); break;
            case 'reset':
                this.shapes = starterShapes(); this.selected = 0; this.textError = '';
                if (this.textArea) this.textArea.value = this.serializeShapes();
                break;
            case 'equip': this.equip(a.id); break;
            case 'unequip': this.equip(''); break;
            case 'delete':
                if (confirm(`Delete "${a.name}"?`)) this.socket?.emit('deleteSkin', a.id);
                break;
        }
    }

    private step(field: string, delta: number): void {
        const s = this.shapes[this.selected];
        if (!s) return;
        const set = (v: number, lo: number, hi: number) => round1(clamp(v + delta, lo, hi));
        switch (field) {
            case 'x': s.x = set(s.x, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT); break;
            case 'y': s.y = set(s.y, -SKIN_COORD_LIMIT, SKIN_COORD_LIMIT); break;
            case 'r': s.r = set(s.r ?? 1, 0.5, SKIN_RADIUS_LIMIT); break;
            case 'rx': s.rx = set(s.rx ?? 1, 0.5, SKIN_RADIUS_LIMIT); break;
            case 'ry': s.ry = set(s.ry ?? 1, 0.5, SKIN_RADIUS_LIMIT); break;
            case 'rot': s.rot = set(s.rot ?? 0, -180, 180); break;
            case 'sw': s.sw = set(s.sw ?? 0, 0, MAX_STROKE_WIDTH); break;
        }
    }

    private publish(): void {
        if (!this.socket) return;
        const payload = { name: this.skinName, shapes: this.shapes };
        const check = sanitizeSkin(payload);
        if ('error' in check) {
            if (!this.skinName) this.openNameInput();
            (getCurrentGame() as any)?.chat?.addChatMessage?.({ sender: 'Skins', content: check.error, timestamp: Date.now() });
            return;
        }
        this.socket.emit('publishSkin', payload);
    }

    private equip(id: string): void {
        if (!this.socket) return;
        this.equippedId = id;
        this.socket.emit('equipSkin', id);
        const lp = getCurrentGame()?.getLocalPlayer();
        if (lp) { lp.equippedSkinId = id; if (id) lp.renderFlags = 0; }
    }

    // ── name entry (one transient input — typing into a canvas isn't possible;
    //    mirrors the guild menu's create/invite prompt) ──────────────────────
    private openNameInput(): void {
        if (this.nameInput) this.closeNameInput();
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = MAX_SKIN_NAME_LEN;
        input.value = this.skinName;
        input.placeholder = 'Skin name';
        input.style.cssText =
            `position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:4000;
             padding:8px 10px; width:260px; border:2px solid ${ACCENT}; border-radius:4px;
             background:${PANEL_BG2}; color:#fff; font-family:Ubuntu,sans-serif; outline:none;`;
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { this.skinName = input.value.trim(); this.closeNameInput(); }
            else if (e.key === 'Escape') { this.closeNameInput(); }
        });
        input.addEventListener('blur', () => { this.skinName = input.value.trim(); this.closeNameInput(); });
        document.body.appendChild(input);
        this.nameInput = input;
        setTimeout(() => input.focus(), 0);
    }
    private closeNameInput(): void {
        if (this.nameInput) { this.nameInput.remove(); this.nameInput = null; }
    }

    private currentUsername(): string {
        return (this.socket as any)?.username || (getCurrentGame() as any)?.socket?.username || '';
    }

    // ── rendering ──────────────────────────────────────────────────────────
    public render(): void {
        if (!this.canvas || !this.isOpen_) return;
        if (!this.ctx) { this.ctx = this.canvas.getContext('2d'); if (!this.ctx) return; }
        const ctx = this.ctx;
        this.hitRegions = [];

        ctx.save();
        ctx.setTransform(getBaseDeviceScale(), 0, 0, getBaseDeviceScale(), 0, 0);
        ctx.textBaseline = 'alphabetic';

        // Draw every canvas label with a black outline (strokeText → fillText),
        // like the other menus. Wrap fillText for this frame so all labels,
        // headings and button text pick it up without per-call changes; the
        // outline width tracks the font size (≈ the other menus' lineWidth-3-on-13px).
        const origFillText = ctx.fillText.bind(ctx);
        (ctx as any).fillText = (text: string, x: number, y: number, maxWidth?: number): void => {
            const m = /([\d.]+)px/.exec(ctx.font);
            const fp = m ? parseFloat(m[1]) : 12;
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(2, fp * 0.22);
            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#fff'; // all label text is white over the black outline
            if (maxWidth === undefined) { ctx.strokeText(text, x, y); origFillText(text, x, y); }
            else { ctx.strokeText(text, x, y, maxWidth); origFillText(text, x, y, maxWidth); }
            ctx.restore();
        };

        try {
            // Panel
            roundRect(ctx, this.PX, this.PY, this.PW, this.PH, 8);
            ctx.fillStyle = BORDER; ctx.fill();
            roundRect(ctx, this.PX + 3, this.PY + 3, this.PW - 6, this.PH - 6, 6);
            ctx.fillStyle = PANEL_BG; ctx.fill();

            this.drawHeader(ctx);
            if (this.tab === 'create') this.drawCreate(ctx);
            else this.drawBrowse(ctx);
        } finally {
            (ctx as any).fillText = origFillText;
            ctx.restore();
        }

        // The text editor is a real <textarea> floated over the canvas (you
        // can't type into a canvas). Keep it alive + aligned only while the
        // Create tab is in text mode; tear it down otherwise.
        if (this.tab === 'create' && this.textMode) this.ensureTextArea();
        else this.removeTextArea();
    }

    private drawHeader(ctx: CanvasRenderingContext2D): void {
        const x = this.PX, y = this.PY, w = this.PW;
        roundRect(ctx, x + 3, y + 3, w - 6, this.HEADER, 6);
        ctx.fillStyle = PANEL_BG2; ctx.fill();

        ctx.font = 'bold 18px Ubuntu, sans-serif';
        ctx.fillStyle = ACCENT; ctx.textAlign = 'left';
        ctx.fillText('Skin Studio', x + 16, y + 30);

        // Tabs
        this.button(ctx, x + 150, y + 11, 86, 26, 'Create', this.tab === 'create', { k: 'tab', tab: 'create' });
        this.button(ctx, x + 242, y + 11, 86, 26, 'Browse', this.tab === 'browse', { k: 'tab', tab: 'browse' });

        // Text/visual toggle (only meaningful while editing on the Create tab)
        if (this.tab === 'create') {
            this.button(ctx, x + 336, y + 11, 86, 26, this.textMode ? 'Visual' : 'Text',
                this.textMode, { k: 'textMode' }, ROW_BG, BORDER, TEXT);
        }

        // Close
        this.button(ctx, x + w - 84, y + 11, 70, 26, 'Close', false, { k: 'close' }, CLOSE_BG, CLOSE_BORDER, '#3a1721');
    }

    // CREATE TAB
    private drawCreate(ctx: CanvasRenderingContext2D): void {
        const bodyTop = this.PY + this.HEADER + 6;
        this.drawPreview(ctx);

        if (this.textMode) {
            this.drawTextEditor(ctx);
        } else {
            // Left column below the preview: add buttons + shape list.
            // Start below the preview's "drag the squares" caption (drawn at
            // pr.y + pr.h + 12) so the "Add shape" label doesn't overlap it.
            const pr = this.previewRect();
            const listX = this.PX + 12, listW = 224;
            let ay = pr.y + pr.h + 28;
            ctx.font = '11px Ubuntu, sans-serif'; ctx.fillStyle = MUTED; ctx.textAlign = 'left';
            ctx.fillText('Add shape', listX + 4, ay + 2);
            ay += 8;
            const types: SkinShapeType[] = ['circle', 'ellipse', 'rect', 'polygon', 'line'];
            const bw = (listW - 4 * 4) / 5;
            types.forEach((t, i) => {
                this.button(ctx, listX + i * (bw + 4), ay, bw, 22, shortType(t), false, { k: 'addShape', shape: t }, ROW_BG, BORDER, TEXT, '10px');
            });
            ay += 30;
            this.drawShapeList(ctx, listX, ay, listW, this.PY + this.PH - ay - 46);

            // Right column: properties of selected shape
            this.drawProps(ctx, this.PX + 248, bodyTop + 6, this.PW - 248 - 14);
        }

        // Bottom bar: name + publish + reset
        const by = this.PY + this.PH - 38;
        const nameLabel = this.skinName ? this.skinName : '(click to name)';
        this.button(ctx, this.PX + 12, by, 240, 28, 'Name: ' + nameLabel, false, { k: 'editName' }, ROW_BG, BORDER, TEXT, '12px', 'left');
        this.button(ctx, this.PX + this.PW - 230, by, 120, 28, 'Publish', true, { k: 'publish' });
        this.button(ctx, this.PX + this.PW - 104, by, 92, 28, 'Reset', false, { k: 'reset' }, ROW_BG, BORDER, TEXT);
    }

    private drawPreview(ctx: CanvasRenderingContext2D): void {
        const pr = this.previewRect();
        ctx.save();
        roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 6);
        ctx.fillStyle = '#3b7d4f'; ctx.fill();
        ctx.save();
        roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 6); ctx.clip();
        ctx.translate(pr.x + pr.w / 2, pr.y + pr.h / 2);
        const s = this.previewScale();
        // reference body circle
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 25 * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        renderCustomSkinShapes(ctx, this.shapes, 25 * s);
        ctx.restore();
        // handles for the selected shape (hidden in text mode — you edit by typing)
        if (!this.textMode) {
            for (const h of this.handles()) {
                const p = this.toPx(h.lx, h.ly);
                ctx.fillStyle = h.id === 'c' ? ACCENT : '#ffffff';
                ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.rect(p.x - 3, p.y - 3, 6, 6); ctx.fill(); ctx.stroke();
            }
        }
        ctx.restore();
        ctx.fillStyle = MUTED; ctx.font = '10px Ubuntu, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(this.textMode ? 'live preview' : 'drag the squares to shape it', pr.x + pr.w / 2, pr.y + pr.h + 12);
    }

    private drawShapeList(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
        ctx.save();
        roundRect(ctx, x, y, w, h, 6); ctx.fillStyle = PANEL_BG2; ctx.fill();
        roundRect(ctx, x, y, w, h, 6); ctx.clip();
        const rowH = 26;
        const maxScroll = Math.max(0, this.shapes.length * rowH - h);
        this.listScroll = Math.min(this.listScroll, maxScroll);
        let ry = y + 4 - this.listScroll;
        this.shapes.forEach((s, i) => {
            if (ry + rowH > y && ry < y + h) {
                const sel = i === this.selected;
                roundRect(ctx, x + 4, ry, w - 8, rowH - 4, 4);
                ctx.fillStyle = sel ? ACCENT_SEL : LIST_ROW; ctx.fill();
                if (sel) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.stroke(); }
                // swatch
                ctx.fillStyle = s.fill || s.stroke || '#000';
                ctx.fillRect(x + 10, ry + 6, 10, 10);
                ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x + 10, ry + 6, 10, 10);
                ctx.fillStyle = TEXT; ctx.font = '12px Ubuntu, sans-serif'; ctx.textAlign = 'left';
                ctx.fillText(`${i + 1}. ${s.t}`, x + 28, ry + 15);
                // row buttons
                const bx = x + w - 80;
                this.iconBtn(ctx, bx, ry + 2, 'up', { k: 'moveShape', i, dir: -1 });
                this.iconBtn(ctx, bx + 24, ry + 2, 'down', { k: 'moveShape', i, dir: 1 });
                this.iconBtn(ctx, bx + 48, ry + 2, 'del', { k: 'delShape', i });
                this.hitRegions.push({ x: x + 4, y: ry, w: w - 92, h: rowH - 4, action: { k: 'selectShape', i } });
            }
            ry += rowH;
        });
        ctx.restore();
    }

    private drawProps(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
        const s = this.shapes[this.selected];
        ctx.fillStyle = MUTED; ctx.font = '11px Ubuntu, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Selected shape', x, y + 2);
        if (!s) { ctx.fillText('— none —', x, y + 22); return; }
        let cy = y + 14;
        const steppers: [string, string, number, number][] = [];
        steppers.push(['X', 'x', s.x, 1], ['Y', 'y', s.y, 1]);
        if (s.t === 'circle') steppers.push(['Radius', 'r', s.r ?? 0, 1]);
        if (s.t === 'ellipse' || s.t === 'rect') steppers.push(['Width', 'rx', s.rx ?? 0, 1], ['Height', 'ry', s.ry ?? 0, 1]);
        if (s.t !== 'line') steppers.push(['Rotation', 'rot', s.rot ?? 0, 15]);
        steppers.push(['Outline w', 'sw', s.sw ?? 0, 1]);

        // two columns of steppers
        const colW = (w - 10) / 2;
        steppers.forEach((st, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            this.stepper(ctx, x + col * (colW + 10), cy + row * 30, colW, st[0], st[1], st[2], st[3]);
        });
        cy += Math.ceil(steppers.length / 2) * 30 + 6;

        if (s.t === 'polygon') {
            this.button(ctx, x, cy, 90, 22, 'Add point', false, { k: 'addVertex' }, ROW_BG, BORDER, TEXT, '11px');
            this.button(ctx, x + 98, cy, 90, 22, 'Del point', false, { k: 'delVertex' }, ROW_BG, BORDER, TEXT, '11px');
            cy += 30;
        }

        if (s.t !== 'line') { cy = this.drawPalette(ctx, x, cy, w, 'Fill', s.fill || '', 'fill'); }
        cy = this.drawPalette(ctx, x, cy, w, 'Outline', s.stroke || '', 'stroke');
    }

    private drawPalette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, current: string, kind: 'fill' | 'stroke'): number {
        ctx.fillStyle = MUTED; ctx.font = '11px Ubuntu, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(label, x, y + 10);
        const sw = 20, gap = 4, perRow = Math.floor((w + gap) / (sw + gap));
        let sx = x, sy = y + 16;
        const cells = ['', ...PALETTE]; // '' = none
        cells.forEach((c, i) => {
            const col = i % perRow, rr = Math.floor(i / perRow);
            const cxp = x + col * (sw + gap), cyp = sy + rr * (sw + gap);
            if (c === '') {
                ctx.fillStyle = '#1a1d20'; ctx.fillRect(cxp, cyp, sw, sw);
                ctx.strokeStyle = '#777'; ctx.lineWidth = 1; ctx.strokeRect(cxp + 0.5, cyp + 0.5, sw - 1, sw - 1);
                ctx.strokeStyle = '#d05a5a'; ctx.beginPath(); ctx.moveTo(cxp + 3, cyp + sw - 3); ctx.lineTo(cxp + sw - 3, cyp + 3); ctx.stroke();
            } else {
                ctx.fillStyle = c; ctx.fillRect(cxp, cyp, sw, sw);
            }
            const isCur = (current || '') === c;
            ctx.strokeStyle = isCur ? ACCENT : '#000'; ctx.lineWidth = isCur ? 2 : 1;
            ctx.strokeRect(cxp + 0.5, cyp + 0.5, sw - 1, sw - 1);
            this.hitRegions.push({ x: cxp, y: cyp, w: sw, h: sw, action: kind === 'fill' ? { k: 'fill', color: c } : { k: 'stroke', color: c } });
            sx = cxp;
        });
        void sx;
        const rows = Math.ceil(cells.length / perRow);
        return y + 16 + rows * (sw + gap) + 8;
    }

    private stepper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, field: string, value: number, step: number): void {
        ctx.fillStyle = MUTED; ctx.font = '10px Ubuntu, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(label, x, y + 9);
        const by = y + 12, bh = 18, bw = 20;
        const valW = w - bw * 2 - 6;
        this.button(ctx, x, by, bw, bh, '-', false, { k: 'step', field, delta: -step }, ROW_BG, BORDER, TEXT, '12px');
        roundRect(ctx, x + bw + 3, by, valW, bh, 3); ctx.fillStyle = PANEL_BG2; ctx.fill();
        ctx.fillStyle = TEXT; ctx.font = '11px Ubuntu, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(round1(value)), x + bw + 3 + valW / 2, by + 13);
        this.button(ctx, x + bw + valW + 6, by, bw, bh, '+', false, { k: 'step', field, delta: step }, ROW_BG, BORDER, TEXT, '12px');
    }

    // BROWSE TAB
    private drawBrowse(ctx: CanvasRenderingContext2D): void {
        const x = this.PX, top = this.PY + this.HEADER + 8;
        ctx.fillStyle = MUTED; ctx.font = '12px Ubuntu, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Published skins — equip one; everyone sees it.', x + 14, top + 12);
        this.button(ctx, x + this.PW - 190, top, 176, 24, 'Unequip (default flower)', false, { k: 'unequip' }, ROW_BG, BORDER, TEXT, '11px');

        const gridTop = top + 34, gridBottom = this.PY + this.PH - 12;
        const gridX = x + 14, gridW = this.PW - 28;
        ctx.save();
        ctx.beginPath(); ctx.rect(gridX, gridTop, gridW, gridBottom - gridTop); ctx.clip();

        if (this.catalog.length === 0) {
            ctx.fillStyle = MUTED; ctx.font = '13px Ubuntu, sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('No skins published yet. Make one in the Create tab.', gridX + 4, gridTop + 24);
            ctx.restore();
            return;
        }

        const me = this.currentUsername().toLowerCase();
        const cols = 3, cardW = (gridW - (cols - 1) * 12) / cols, cardH = 168;
        const sorted = this.catalog.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const rows = Math.ceil(sorted.length / cols);
        const maxScroll = Math.max(0, rows * (cardH + 12) - (gridBottom - gridTop));
        this.browseScroll = Math.min(this.browseScroll, maxScroll);

        sorted.forEach((skin, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const cx = gridX + col * (cardW + 12);
            const cyp = gridTop + row * (cardH + 12) - this.browseScroll;
            if (cyp + cardH < gridTop || cyp > gridBottom) return;
            const equipped = skin.id === this.equippedId;
            roundRect(ctx, cx, cyp, cardW, cardH, 6);
            ctx.fillStyle = PANEL_BG2; ctx.fill();
            if (equipped) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke(); }

            // preview
            const ps = cardW - 20, pcx = cx + cardW / 2, pcy = cyp + 10 + ps / 2;
            ctx.save();
            roundRect(ctx, cx + 10, cyp + 10, ps, ps, 4); ctx.fillStyle = '#3b7d4f'; ctx.fill();
            roundRect(ctx, cx + 10, cyp + 10, ps, ps, 4); ctx.clip();
            ctx.translate(pcx, pcy);
            renderCustomSkinShapes(ctx, skin.shapes, (ps / 2) * (25 / 36));
            ctx.restore();

            ctx.fillStyle = TEXT; ctx.font = 'bold 12px Ubuntu, sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(clip(skin.name, 16), cx + 10, cyp + ps + 26);
            ctx.fillStyle = MUTED; ctx.font = '10px Ubuntu, sans-serif';
            ctx.fillText('by ' + clip(skin.author, 16), cx + 10, cyp + ps + 40);

            const by = cyp + cardH - 28;
            const canDelete = this.isAdmin || skin.author.toLowerCase() === me;
            const eqW = canDelete ? cardW - 20 - 56 : cardW - 20;
            this.button(ctx, cx + 10, by, eqW, 22, equipped ? 'Equipped' : 'Equip', equipped, { k: 'equip', id: skin.id }, undefined, undefined, undefined, '11px');
            if (canDelete) {
                const isTakedown = this.isAdmin && skin.author.toLowerCase() !== me;
                this.button(ctx, cx + 10 + eqW + 6, by, 50, 22, isTakedown ? 'Remove' : 'Delete', false, { k: 'delete', id: skin.id, name: skin.name }, CLOSE_BG, CLOSE_BORDER, '#3a1721', '10px');
            }
        });
        ctx.restore();
    }

    // ── text mode (type shapes as canvas commands) ─────────────────────────
    // Logical-coord rectangle the <textarea> overlay occupies (right of the
    // preview, above the bottom bar).
    private textAreaRect(): { x: number; y: number; w: number; h: number } {
        const x = this.PX + 248;
        const y = this.PY + this.HEADER + 12;
        const w = this.PW - 248 - 14;
        const h = (this.PY + this.PH - 38) - y - 10;
        return { x, y, w, h };
    }

    private drawTextEditor(ctx: CanvasRenderingContext2D): void {
        // Backing panel (the live <textarea> sits exactly on top of this).
        const r = this.textAreaRect();
        roundRect(ctx, r.x, r.y, r.w, r.h, 6); ctx.fillStyle = PANEL_BG2; ctx.fill();

        // Help / format reference under the preview on the left.
        const pr = this.previewRect();
        let hy = pr.y + pr.h + 26;
        const line = (s: string, color = MUTED, font = '11px') => {
            ctx.fillStyle = color; ctx.font = `${font} Ubuntu, sans-serif`; ctx.textAlign = 'left';
            ctx.fillText(s, this.PX + 14, hy); hy += 16;
        };
        ctx.fillStyle = TEXT; ctx.font = 'bold 12px Ubuntu, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Canvas commands', this.PX + 14, hy); hy += 18;
        line('One shape per line:');
        line('type x=.. y=.. fill=#rrggbb');
        line('types: circle ellipse rect line polygon');
        line('circle: r=    ellipse/rect: rx= ry=');
        line('line: x2= y2=   polygon: points=x,y,x,y');
        line('optional: rot=  stroke=#rrggbb  sw=');
        hy += 4;
        if (this.textError) line(this.textError, ERROR_FG, 'bold 11px');
    }

    private ensureTextArea(): void {
        if (!this.textArea) this.createTextArea();
        this.positionTextArea();
    }

    private createTextArea(): void {
        const ta = document.createElement('textarea');
        ta.spellcheck = false;
        ta.wrap = 'off';
        ta.value = this.serializeShapes();
        ta.style.cssText =
            `position:fixed; z-index:4000; box-sizing:border-box; resize:none; outline:none;
             border:2px solid ${ACCENT}; border-radius:6px; background:${PANEL_BG2};
             color:#fff; caret-color:#fff; padding:8px 10px; line-height:1.45; white-space:pre;
             font-family:Ubuntu,sans-serif; font-weight:bold;`;
        ta.addEventListener('input', () => this.onTextInput());
        ta.addEventListener('keydown', (e) => {
            e.stopPropagation(); // keep game/menu hotkeys from firing while typing
            if (e.key === 'Escape') { e.preventDefault(); this.textMode = false; }
        });
        document.body.appendChild(ta);
        this.textArea = ta;
        setTimeout(() => ta.focus(), 0);
    }

    private positionTextArea(): void {
        if (!this.textArea || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        // Logical px → on-screen CSS px: drawing scales logical coords by the
        // base device scale into the backing store, then the element is shown
        // at rect.width/canvas.width CSS px per backing pixel.
        const f = (rect.width / this.canvas.width) * getBaseDeviceScale();
        const r = this.textAreaRect();
        const s = this.textArea.style;
        s.left = (rect.left + r.x * f) + 'px';
        s.top = (rect.top + r.y * f) + 'px';
        s.width = (r.w * f) + 'px';
        s.height = (r.h * f) + 'px';
        const fontPx = Math.max(10, 13 * f);
        s.fontSize = fontPx + 'px';
        // Black outline like the other menus' strokeText→fillText. -webkit-text-stroke
        // doesn't render on a <textarea>'s text, so build the outline from text-shadow
        // (8 directions), scaled to the canvas ratio (≈1.5px outline on the 13px font).
        const o = Math.max(1, fontPx * 1.5 / 13);
        s.textShadow = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
            .map(([dx, dy]) => `${(dx * o).toFixed(2)}px ${(dy * o).toFixed(2)}px 0 #000`).join(', ');
    }

    private removeTextArea(): void {
        if (this.textArea) { this.textArea.remove(); this.textArea = null; }
    }

    private onTextInput(): void {
        if (!this.textArea) return;
        const res = this.parseShapes(this.textArea.value);
        if ('error' in res) { this.textError = res.error; return; }
        this.textError = '';
        this.shapes = res.shapes;
        if (this.selected >= this.shapes.length) this.selected = this.shapes.length - 1;
        if (this.selected < 0) this.selected = 0;
    }

    private serializeShapes(): string {
        return this.shapes.map(s => serializeShape(s)).join('\n');
    }

    private parseShapes(text: string): { shapes: SkinShape[] } | { error: string } {
        const lines = text.split('\n');
        const shapes: SkinShape[] = [];
        const NUM_KEYS = ['x', 'y', 'rot', 'sw', 'r', 'rx', 'ry', 'x2', 'y2'];
        for (let li = 0; li < lines.length; li++) {
            const raw = lines[li].trim();
            if (!raw || raw.startsWith('#')) continue; // blanks + comments
            const at = (msg: string) => ({ error: `Line ${li + 1}: ${msg}` });
            const toks = raw.split(/\s+/);
            const t = toks[0] as SkinShapeType;
            if (['circle', 'ellipse', 'rect', 'polygon', 'line'].indexOf(t) === -1) return at(`unknown shape "${toks[0]}"`);
            const kv: Record<string, string> = {};
            for (let i = 1; i < toks.length; i++) {
                const eq = toks[i].indexOf('=');
                if (eq <= 0) return at(`expected key=value near "${toks[i]}"`);
                kv[toks[i].slice(0, eq)] = toks[i].slice(eq + 1);
            }
            for (const k of NUM_KEYS) if (kv[k] !== undefined && !isFinite(parseFloat(kv[k]))) return at(`"${k}" must be a number`);
            for (const k of ['fill', 'stroke']) if (kv[k] && !/^#[0-9a-fA-F]{6}$/.test(kv[k])) return at(`"${k}" must be a #rrggbb color`);
            const num = (k: string, d: number) => (kv[k] !== undefined ? parseFloat(kv[k]) : d);
            const s: SkinShape = { t, x: num('x', 0), y: num('y', 0), rot: num('rot', 0), fill: kv.fill || '', stroke: kv.stroke || '', sw: num('sw', 0) };
            if (t === 'circle') s.r = num('r', 10);
            else if (t === 'ellipse' || t === 'rect') { s.rx = num('rx', 10); s.ry = num('ry', 6); }
            else if (t === 'line') { s.x2 = num('x2', 0); s.y2 = num('y2', 0); }
            else if (t === 'polygon') {
                const pts = (kv.points || '').split(',').map(v => parseFloat(v));
                if (kv.points && pts.some(v => !isFinite(v))) return at('"points" must be a comma list of numbers');
                if (pts.length < 6) return at('polygon needs points=x,y,x,y,x,y (≥3 points)');
                if (pts.length > MAX_POLY_POINTS * 2) return at(`polygon allows at most ${MAX_POLY_POINTS} points`);
                s.points = pts;
            }
            shapes.push(s);
        }
        if (shapes.length === 0) return { error: 'Add at least one shape line.' };
        if (shapes.length > MAX_SKIN_SHAPES) return { error: `Too many shapes (max ${MAX_SKIN_SHAPES}).` };
        return { shapes };
    }

    // ── small drawing helpers ──────────────────────────────────────────────
    private button(
        ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
        label: string, active: boolean, action: Action,
        bg = ACCENT, border = BORDER, fg = ACCENT_FG, font = '12px', align: 'center' | 'left' = 'center',
    ): void {
        const hovered = this.hoverKey === actionKey(action);
        const realBg = active ? ACCENT : bg;
        const realFg = active ? ACCENT_FG : fg;
        roundRect(ctx, x, y, w, h, 4); ctx.fillStyle = border; ctx.fill();
        roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 3); ctx.fillStyle = realBg; ctx.fill();
        if (hovered) { roundRect(ctx, x, y, w, h, 4); ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill(); }
        ctx.fillStyle = realFg; ctx.font = `bold ${font} Ubuntu, sans-serif`;
        ctx.textAlign = align;
        const tx = align === 'left' ? x + 8 : x + w / 2;
        ctx.fillText(clipToWidth(ctx, label, w - 12), tx, y + h / 2 + 4);
        this.hitRegions.push({ x, y, w, h, action });
    }

    private iconBtn(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'up' | 'down' | 'del', action: Action): void {
        const s = 20;
        const hovered = this.hoverKey === actionKey(action);
        roundRect(ctx, x, y, s, s, 3); ctx.fillStyle = BORDER; ctx.fill();
        roundRect(ctx, x + 1, y + 1, s - 2, s - 2, 2); ctx.fillStyle = hovered ? ACCENT : ROW_BG; ctx.fill();
        ctx.strokeStyle = TEXT; ctx.fillStyle = TEXT; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        const cx = x + s / 2, cy = y + s / 2;
        ctx.beginPath();
        if (kind === 'up') { ctx.moveTo(cx - 4, cy + 2); ctx.lineTo(cx, cy - 3); ctx.lineTo(cx + 4, cy + 2); ctx.stroke(); }
        else if (kind === 'down') { ctx.moveTo(cx - 4, cy - 2); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx + 4, cy - 2); ctx.stroke(); }
        else { ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4); ctx.strokeStyle = '#e58a8a'; ctx.stroke(); }
        this.hitRegions.push({ x, y, w: s, h: s, action });
    }
}

// ── module helpers ──────────────────────────────────────────────────────────
let sharedInstance: SkinStudio | null = null;
export function getSkinStudio(): SkinStudio {
    if (!sharedInstance) sharedInstance = new SkinStudio();
    return sharedInstance;
}

function actionKey(a: Action): string {
    return [a.k, (a as any).tab, (a as any).i, (a as any).field, (a as any).delta, (a as any).color, (a as any).id, (a as any).shape, (a as any).dir]
        .filter(v => v !== undefined).join(':');
}
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function round1(v: number): number { return Math.round(v * 10) / 10; }
function shortType(t: SkinShapeType): string {
    return t === 'circle' ? 'Circ' : t === 'ellipse' ? 'Elps' : t === 'rect' ? 'Rect' : t === 'polygon' ? 'Poly' : 'Line';
}
// One shape → one editable command line (round-trips through parseShapes).
function serializeShape(s: SkinShape): string {
    const p: string[] = [s.t, `x=${round1(s.x)}`, `y=${round1(s.y)}`];
    if (s.t === 'circle') p.push(`r=${round1(s.r ?? 0)}`);
    else if (s.t === 'ellipse' || s.t === 'rect') p.push(`rx=${round1(s.rx ?? 0)}`, `ry=${round1(s.ry ?? 0)}`);
    else if (s.t === 'line') p.push(`x2=${round1(s.x2 ?? 0)}`, `y2=${round1(s.y2 ?? 0)}`);
    else if (s.t === 'polygon' && s.points) p.push(`points=${s.points.map(round1).join(',')}`);
    if (s.t !== 'line' && (s.rot ?? 0) !== 0) p.push(`rot=${round1(s.rot ?? 0)}`);
    if (s.fill) p.push(`fill=${s.fill}`);
    if (s.stroke) p.push(`stroke=${s.stroke}`);
    if ((s.sw ?? 0) > 0) p.push(`sw=${round1(s.sw ?? 0)}`);
    return p.join(' ');
}
function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function clipToWidth(ctx: CanvasRenderingContext2D, s: string, w: number): string {
    if (ctx.measureText(s).width <= w) return s;
    let out = s;
    while (out.length > 1 && ctx.measureText(out + '…').width > w) out = out.slice(0, -1);
    return out + '…';
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}
