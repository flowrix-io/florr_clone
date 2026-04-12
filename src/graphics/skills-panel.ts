// Canvas-based talents/skills panel — replaces the prior DOM grid implementation.
// Renders a radial talent tree with one branch per skill (damage, petalHealth,
// playerHealth, healingMultiplier), each branch a chain of nine rarity tiers
// connected by dashed lines. The center of the panel hosts a small flower-face
// avatar representing the player; the bottom-right shows derived stat lines.
import { RARITY_LEVELS, Rarity } from '../petals';

interface GameAPI {
    getLocalPlayer(): any;
    /** The shared Graphics instance — used to call drawFlower() against our
     *  canvas by temporarily rebinding its `ctx` field. Optional so non-game
     *  test harnesses can omit it. */
    graphics?: any;
}

const RARITY_COLORS: Record<string, string> = {
    common: '#7eef6d',
    uncommon: '#ffe65d',
    rare: '#4d52e3',
    epic: '#861fde',
    legendary: '#de1f1f',
    mythic: '#1fdbde',
    ultra: '#de1f65',
    super: '#2bffa4',
    unique: '#bf00ff'
};

const RARITY_MULTIPLIERS: Record<string, number> = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0
};

const RARITY_TP_COSTS: Record<string, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 5,
    legendary: 8,
    mythic: 12,
    ultra: 18,
    super: 25,
    unique: 26
};

interface SkillDef {
    id: string;
    name: string;
    /** Glyph drawn inside the node. */
    icon: 'cross' | 'swirl' | 'curve' | 'heart' | 'shield';
    /** Maximum number of tiers for this skill (defaults to full 9 if omitted). */
    maxTiers?: number;
    /** If true the branch spirals inward at the end instead of continuing
     *  along its normal curve. */
    spiral?: boolean;
    /** If set, this skill branches from the specified parent skill at the given
     *  tier index instead of originating from the flower center. */
    branchFrom?: { skillId: string; tierIndex: number };
    /** Angle offset (radians) from the parent branch direction. Negative = left
     *  of the branch direction. Only used when branchFrom is set. */
    branchAngleOffset?: number;
    /** Custom per-tier descriptions (replaces the default "X% multiplier" tooltip line). */
    tierDescriptions?: Record<string, string>;
    /** Prerequisite: the parent skill must be at this rarity or higher to unlock. */
    prerequisiteRarity?: string;
}

/** Second Chance invulnerability durations per tier (seconds). */
const SECOND_CHANCE_DURATIONS: Record<string, number> = {
    common: 0.3,
    uncommon: 1.5,
};

const SKILLS: SkillDef[] = [
    { id: 'damage', name: 'Damage', icon: 'swirl', spiral: true },
    { id: 'petalHealth', name: 'Petal Health', icon: 'curve', spiral: true },
    { id: 'playerHealth', name: 'Flower Health', icon: 'cross', spiral: true },
    { id: 'healingMultiplier', name: 'Healing', icon: 'heart', maxTiers: 4 },
    {
        id: 'secondChance',
        name: 'Second Chance',
        icon: 'shield',
        maxTiers: 2,
        branchFrom: { skillId: 'playerHealth', tierIndex: 2 }, // branches from rare Flower Health
        branchAngleOffset: -Math.PI / 3, // left of branch direction
        tierDescriptions: {
            common: '0.3s invulnerability at 1 HP (60s cd)',
            uncommon: '1.5s invulnerability at 1 HP (30s cd)',
        },
        prerequisiteRarity: 'rare',
    },
];

interface NodeRect {
    skillId: string;
    rarity: Rarity;
    tier: number;
    /** Plane-local position relative to the radial center (z=0 plane). */
    px: number;
    py: number;
    /** Base radius of the node circle in CSS pixels (before depth scaling). */
    r: number;
    icon: SkillDef['icon'];
    // ----- Filled in each frame by project() -----
    /** Projected screen-space x for the current rotation. */
    sx: number;
    /** Projected screen-space y for the current rotation. */
    sy: number;
    /** Depth-adjusted scale factor (1 == on-plane). */
    scale: number;
    /** Rotated z used for back-to-front sorting. */
    rz: number;
}

function darken(hex: string, percent: number = 30): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const f = 1 - percent / 100;
    const nr = Math.round(r * f);
    const ng = Math.round(g * f);
    const nb = Math.round(b * f);
    return `#${((nr << 16) | (ng << 8) | nb).toString(16).padStart(6, '0')}`;
}

export class CanvasSkillsPanel {
    private game: GameAPI;
    public canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private nodes: NodeRect[] = [];
    /** Indices into `nodes`, sorted back-to-front for the current rotation. */
    private drawOrder: number[] = [];
    private hoverIdx: number = -1;
    private rafHandle: number = 0;
    private running: boolean = false;

    // ===== 2D rotation state =====
    /** Plane rotation angle (radians). Mouse drag along the X axis spins the
     *  whole talent tree around the flower pivot. */
    private rotation: number = 0;
    /** True while the user is dragging the background to spin the tree. */
    private isDragging: boolean = false;
    /** True after a mousedown when we're still deciding whether the gesture
     *  is a click on a node or the start of a rotate drag. */
    private pendingClick: { x: number; y: number; nodeIdx: number } | null = null;
    private readonly DRAG_THRESHOLD = 5;

    // Header / chrome hit rects (canvas-local CSS pixels).
    private closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private resetBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private closeBtnHovered: boolean = false;
    private resetBtnHovered: boolean = false;

    // Cached layout dimensions to avoid recomputing every frame unless size changes.
    private lastCssW: number = 0;
    private lastCssH: number = 0;

    /** Player skill state cached from updateState() — drives node coloring. */
    private playerTp: number = 0;
    private playerSkills: Record<string, string | undefined> = {};
    private statFlowerHealth: string = '0';
    private statBodyDamage: string = '0';

    private static readonly PANEL_BG = '#dc7e92';
    private static readonly PANEL_BORDER = '#b56476';
    private static readonly NODE_LOCKED_BG = '#5a5a5a';
    private static readonly NODE_LOCKED_BORDER = '#3a3a3a';

    public onUpgrade: ((skillId: string, rarity: string) => void) | null = null;
    public onReset: (() => void) | null = null;
    public onClose: (() => void) | null = null;

    constructor(game: GameAPI) {
        this.game = game;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'skills-canvas';
        this.canvas.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            user-select: none;
        `;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('CanvasSkillsPanel: failed to acquire 2d context');
        this.ctx = ctx;

        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        // Drag continues even when the cursor briefly leaves the canvas, so the
        // move/up listeners live on `window` and gate themselves on isDragging.
        window.addEventListener('mousemove', this.handleWindowMouseMove);
        window.addEventListener('mouseup', this.handleWindowMouseUp);
    }

    public attachTo(parent: HTMLElement) {
        parent.appendChild(this.canvas);
    }

    public start() {
        if (this.running) return;
        this.running = true;
        const loop = () => {
            if (!this.running) return;
            this.draw();
            this.rafHandle = requestAnimationFrame(loop);
        };
        loop();
    }

    public stop() {
        this.running = false;
        if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        this.hoverIdx = -1;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public destroy() {
        this.stop();
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
        this.canvas.remove();
    }

    /** Returns true if the given client coordinates are within the canvas bounds. */
    public containsClient(clientX: number, clientY: number): boolean {
        const rect = this.canvas.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    /** Push the latest player state used to color nodes and render stat lines. */
    public updateState(tp: number, skills: Record<string, string | undefined>, flowerHealth: string, bodyDamage: string) {
        this.playerTp = tp;
        this.playerSkills = skills || {};
        this.statFlowerHealth = flowerHealth;
        this.statBodyDamage = bodyDamage;
    }

    private syncCanvasSize(): { dpr: number; cssW: number; cssH: number } {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        return { dpr, cssW: rect.width, cssH: rect.height };
    }

    private layout(cssW: number, cssH: number) {
        if (cssW === this.lastCssW && cssH === this.lastCssH && this.nodes.length > 0) return;
        this.lastCssW = cssW;
        this.lastCssH = cssH;

        // Header / button rects.
        const pad = 14;
        const closeSize = 26;
        this.closeBtnRect = { x: cssW - pad - closeSize, y: pad - 4, w: closeSize, h: closeSize };
        this.resetBtnRect = { x: cssW - pad - 70, y: cssH - pad - 28, w: 70, h: 28 };

        // The talent tree fans out in a 180° arc above the flower. Each skill
        // is its own branch radiating outward. Branches curve in the same
        // direction; skills with `spiral` curl into a tight inward spiral at
        // their end, and skills with `maxTiers` stop early.
        // Skills with `branchFrom` fork off an existing branch node instead of
        // originating from the flower center.
        const mainSkills = SKILLS.filter(s => !s.branchFrom);
        const branchCount = mainSkills.length;
        const fullTierCount = RARITY_LEVELS.length;   // 9

        const nodeRadius = 22;
        const radiusStep = 65;

        const arcSpan = Math.PI * 2;
        const angleStep = arcSpan / branchCount;
        const startAngle = -Math.PI / 2;  // first branch points straight up

        // Every branch is laid out by walking equal-length segments from the
        // flower outward. The direction curves via the Spiral of Theodorus
        // (each step turns by atan(1/√n)), giving a smooth, naturally
        // non-overlapping curve with uniform node spacing.
        const segLen = radiusStep;

        this.nodes = [];

        // Track the position and direction at each tier of each main branch
        // so sub-branches can fork off them.
        const branchEndpoints: Record<string, { x: number; y: number; angle: number }[]> = {};

        for (let s = 0; s < branchCount; s++) {
            const skill = mainSkills[s];
            const tierCount = Math.min(skill.maxTiers ?? fullTierCount, fullTierCount);
            const baseAngle = startAngle + s * angleStep;

            // Walk position and heading, starting at the flower center.
            let curX = 0;
            let curY = 0;
            let curAngle = baseAngle;

            branchEndpoints[skill.id] = [];

            for (let t = 0; t < tierCount; t++) {
                // First 3 tiers go straight out. After that, curvature ramps
                // up gradually, then eases off on the very last tier.
                if (t >= 3) {
                    const curveIdx = t - 3;  // 0, 1, 2, 3, 4, 5
                    const maxTurn = Math.PI * 0.37;
                    const ramp = Math.min(1, (curveIdx + 1) / 4); // 0.25, 0.5, 0.75, 1, 1, ...
                    const ease = t === tierCount - 1 ? 1.5 : 1;   // last tier turns less
                    curAngle += maxTurn * ramp * ease;
                }
                curX += Math.cos(curAngle) * segLen;
                curY += Math.sin(curAngle) * segLen;

                branchEndpoints[skill.id].push({ x: curX, y: curY, angle: curAngle });

                this.nodes.push({
                    skillId: skill.id,
                    rarity: RARITY_LEVELS[t] as Rarity,
                    tier: t,
                    px: curX,
                    py: curY,
                    r: nodeRadius,
                    icon: skill.icon,
                    sx: 0, sy: 0, scale: 1, rz: 0,
                });
            }
        }

        // Lay out sub-branches that fork from existing nodes.
        const subBranches = SKILLS.filter(s => s.branchFrom);
        for (const skill of subBranches) {
            const parent = skill.branchFrom!;
            const endpoints = branchEndpoints[parent.skillId];
            if (!endpoints || !endpoints[parent.tierIndex]) continue;

            const fork = endpoints[parent.tierIndex];
            const tierCount = Math.min(skill.maxTiers ?? fullTierCount, fullTierCount);
            const branchAngle = fork.angle + (skill.branchAngleOffset ?? 0);

            let curX = fork.x;
            let curY = fork.y;
            let curAngle = branchAngle;

            for (let t = 0; t < tierCount; t++) {
                curX += Math.cos(curAngle) * segLen;
                curY += Math.sin(curAngle) * segLen;

                this.nodes.push({
                    skillId: skill.id,
                    rarity: RARITY_LEVELS[t] as Rarity,
                    tier: t,
                    px: curX,
                    py: curY,
                    r: nodeRadius,
                    icon: skill.icon,
                    sx: 0, sy: 0, scale: 1, rz: 0,
                });
            }
        }
    }

    /** Apply the current 2D rotation to a plane-local (x, y) point and translate
     *  it into canvas-space. No depth, no perspective — pure 2D rotation around
     *  the (cx, cy) flower pivot. */
    private project(px: number, py: number, cx: number, cy: number): { sx: number; sy: number } {
        const cosR = Math.cos(this.rotation);
        const sinR = Math.sin(this.rotation);
        return {
            sx: cx + px * cosR - py * sinR,
            sy: cy + px * sinR + py * cosR,
        };
    }

    /** Project every node into screen space using the current rotation. */
    private updateProjections(cx: number, cy: number) {
        for (const n of this.nodes) {
            const p = this.project(n.px, n.py, cx, cy);
            n.sx = p.sx;
            n.sy = p.sy;
            // No perspective scaling in 2D mode.
            n.scale = 1;
            n.rz = 0;
        }
        this.drawOrder.length = this.nodes.length;
        for (let i = 0; i < this.nodes.length; i++) this.drawOrder[i] = i;
    }

    private getCurrentTierIndex(skillId: string): number {
        const tier = this.playerSkills[skillId];
        if (!tier) return -1;
        return RARITY_LEVELS.indexOf(tier as Rarity);
    }

    public draw() {
        const { dpr, cssW, cssH } = this.syncCanvasSize();
        this.layout(cssW, cssH);

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        // ----- Panel background + border -----
        const radius = 6;
        const borderW = 4;
        ctx.fillStyle = CanvasSkillsPanel.PANEL_BORDER;
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, cssW, cssH, radius);
        ctx.fill();
        ctx.fillStyle = CanvasSkillsPanel.PANEL_BG;
        ctx.beginPath();
        (ctx as any).roundRect(borderW, borderW, cssW - borderW * 2, cssH - borderW * 2, Math.max(0, radius - 2));
        ctx.fill();

        // ----- 3D scene: project nodes through current rotation -----
        const cx = cssW / 2;
        const cy = cssH - 90;
        this.updateProjections(cx, cy);

        // 2D scene: connectors first, then nodes, then the flower on top so
        // it always sits at the visual center of the fan.
        this.drawConnectors(ctx, cx, cy);
        for (const idx of this.drawOrder) {
            this.drawNode(ctx, this.nodes[idx], idx === this.hoverIdx);
        }
        this.drawPlayerAvatar(ctx, cx, cy);

        // ----- Header (drawn last so it sits on top of the 3D scene) -----
        this.drawHeader(ctx, cssW);

        // ----- Stat lines + reset button at the bottom -----
        this.drawStatsAndReset(ctx, cssW, cssH);

        // ----- Tooltip for hovered node -----
        if (this.hoverIdx >= 0 && !this.isDragging) {
            this.drawTooltip(ctx, this.nodes[this.hoverIdx], cssW, cssH);
        }

        ctx.restore();
    }

    private drawHeader(ctx: CanvasRenderingContext2D, cssW: number) {
        // Title centered.
        ctx.save();
        ctx.font = 'bold 22px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        ctx.strokeText('Talents', cssW / 2, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Talents', cssW / 2, 14);
        ctx.restore();

        // TP badge — dark rounded square containing the talent point count,
        // followed by an outlined "TP" label.
        const badgeSize = 30;
        const bx = 14;
        const by = 12;
        ctx.save();
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        (ctx as any).roundRect(bx, by, badgeSize, badgeSize, 6);
        ctx.fill();
        ctx.fillStyle = '#5a5a5a';
        ctx.beginPath();
        (ctx as any).roundRect(bx + 3, by + 3, badgeSize - 6, badgeSize - 6, 4);
        ctx.fill();

        ctx.font = 'bold 16px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        const tpText = String(this.playerTp);
        ctx.strokeText(tpText, bx + badgeSize / 2, by + badgeSize / 2 + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(tpText, bx + badgeSize / 2, by + badgeSize / 2 + 1);

        // "TP" label to the right of the badge.
        ctx.font = 'bold 16px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeText('TP', bx + badgeSize + 6, by + badgeSize / 2 + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('TP', bx + badgeSize + 6, by + badgeSize / 2 + 1);
        ctx.restore();

        // Close button (top-right).
        const cb = this.closeBtnRect;
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        (ctx as any).roundRect(cb.x, cb.y, cb.w, cb.h, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.closeBtnHovered ? '#ffffff' : '#e8d8d8';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const p = 8;
        ctx.beginPath();
        ctx.moveTo(cb.x + p, cb.y + p);
        ctx.lineTo(cb.x + cb.w - p, cb.y + cb.h - p);
        ctx.moveTo(cb.x + cb.w - p, cb.y + p);
        ctx.lineTo(cb.x + p, cb.y + cb.h - p);
        ctx.stroke();
        ctx.restore();
    }

    /** Draws dashed connector lines from the center to the first node of each
     *  branch, then between consecutive tiers within each branch, using the
     *  current 3D projection. Sub-branches connect their first node to the
     *  parent branch node they fork from. Connectors upgrade to a brighter
     *  green tint once both endpoints are unlocked. */
    private drawConnectors(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
        const fullTierCount = RARITY_LEVELS.length;

        ctx.save();
        ctx.lineCap = 'round';
        let branchStart = 0;
        for (let s = 0; s < SKILLS.length; s++) {
            const skill = SKILLS[s];
            const currentIdx = this.getCurrentTierIndex(skill.id);
            const tierCount = Math.min(skill.maxTiers ?? fullTierCount, fullTierCount);

            for (let t = 0; t < tierCount; t++) {
                const node = this.nodes[branchStart + t];
                let prev: { sx: number; sy: number };

                if (t === 0) {
                    if (skill.branchFrom) {
                        // Connect first sub-branch node to its parent branch node.
                        const parentNode = this.nodes.find(
                            n => n.skillId === skill.branchFrom!.skillId && n.tier === skill.branchFrom!.tierIndex
                        );
                        prev = parentNode ?? { sx: cx, sy: cy };
                    } else {
                        prev = { sx: cx, sy: cy };
                    }
                } else {
                    prev = this.nodes[branchStart + t - 1];
                }

                // For sub-branches, check if the prerequisite is met for the
                // connector color (parent skill must be at the required rarity).
                let unlocked = t <= currentIdx;
                if (skill.branchFrom && skill.prerequisiteRarity) {
                    const parentIdx = this.getCurrentTierIndex(skill.branchFrom.skillId);
                    const reqIdx = RARITY_LEVELS.indexOf(skill.prerequisiteRarity as Rarity);
                    if (parentIdx < reqIdx) unlocked = false;
                }

                ctx.strokeStyle = unlocked ? 'rgba(126, 239, 109, 0.85)' : 'rgba(0, 0, 0, 0.35)';
                ctx.lineWidth = (unlocked ? 4 : 3) * Math.max(0.4, node.scale);
                ctx.setLineDash(unlocked ? [] : [6 * node.scale, 6 * node.scale]);
                ctx.beginPath();
                ctx.moveTo(prev.sx, prev.sy);
                ctx.lineTo(node.sx, node.sy);
                ctx.stroke();
            }
            branchStart += tierCount;
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    /** Check whether a sub-branch skill's prerequisite is met (parent skill at
     *  the required rarity or higher). Returns true for non-branching skills. */
    private isPrerequisiteMet(skillId: string): boolean {
        const skill = SKILLS.find(s => s.id === skillId);
        if (!skill?.branchFrom || !skill.prerequisiteRarity) return true;
        const parentIdx = this.getCurrentTierIndex(skill.branchFrom.skillId);
        const reqIdx = RARITY_LEVELS.indexOf(skill.prerequisiteRarity as Rarity);
        return parentIdx >= reqIdx;
    }

    private drawNode(ctx: CanvasRenderingContext2D, node: NodeRect, hovered: boolean) {
        const currentIdx = this.getCurrentTierIndex(node.skillId);
        const prereqMet = this.isPrerequisiteMet(node.skillId);
        const isUnlocked = node.tier <= currentIdx && prereqMet;
        const isAvailable = prereqMet && node.tier === currentIdx + 1 && this.playerTp >= RARITY_TP_COSTS[node.rarity];

        let fill: string;
        let border: string;
        if (isUnlocked) {
            fill = RARITY_COLORS[node.rarity];
            border = darken(fill, 30);
        } else if (isAvailable) {
            fill = '#ffe65d';
            border = darken(fill, 30);
        } else {
            fill = CanvasSkillsPanel.NODE_LOCKED_BG;
            border = CanvasSkillsPanel.NODE_LOCKED_BORDER;
        }

        const r = node.r * node.scale;

        ctx.save();
        // Outer ring (border).
        ctx.fillStyle = border;
        ctx.beginPath();
        ctx.arc(node.sx, node.sy, r, 0, Math.PI * 2);
        ctx.fill();
        // Inner fill.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(node.sx, node.sy, r - 3 * node.scale, 0, Math.PI * 2);
        ctx.fill();
        if (hovered && (isUnlocked || isAvailable)) {
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(node.sx, node.sy, r - 3 * node.scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.restore();

        // Glyph (icon) centered in the node.
        this.drawIcon(ctx, node.icon, node.sx, node.sy, r * 0.95, '#ffffff');

        // Cost label — small red number anchored above-right of the node,
        // matching the reference screenshot.
        const cost = RARITY_TP_COSTS[node.rarity];
        ctx.save();
        const fontSize = Math.max(7, 11 * node.scale);
        ctx.font = `bold ${fontSize.toFixed(1)}px Ubuntu, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * node.scale;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        const lx = node.sx + r * 0.7;
        const ly = node.sy - r * 0.85;
        ctx.strokeText(String(cost), lx, ly);
        ctx.fillStyle = '#ff5050';
        ctx.fillText(String(cost), lx, ly);
        ctx.restore();
    }

    private drawIcon(ctx: CanvasRenderingContext2D, icon: SkillDef['icon'], cx: number, cy: number, size: number, color: string) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, size * 0.13);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (icon) {
            case 'cross': {
                // Plus sign (medical cross) — two perpendicular bars.
                const arm = size * 0.55;
                const thick = size * 0.22;
                ctx.fillRect(cx - thick / 2, cy - arm / 2, thick, arm);
                ctx.fillRect(cx - arm / 2, cy - thick / 2, arm, thick);
                break;
            }
            case 'swirl': {
                // Stylized 5-petal flower swirl, like the reference design.
                const petalCount = 5;
                const petalLen = size * 0.32;
                const petalWid = size * 0.18;
                for (let i = 0; i < petalCount; i++) {
                    const a = (i / petalCount) * Math.PI * 2 - Math.PI / 2;
                    const px = cx + Math.cos(a) * petalLen * 0.6;
                    const py = cy + Math.sin(a) * petalLen * 0.6;
                    ctx.beginPath();
                    ctx.ellipse(px, py, petalWid, petalLen * 0.65, a, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'curve': {
                // "C" letter — open arc on the right.
                ctx.beginPath();
                ctx.lineWidth = size * 0.22;
                ctx.arc(cx, cy, size * 0.32, Math.PI * 0.25, -Math.PI * 0.25, true);
                ctx.stroke();
                break;
            }
            case 'heart': {
                // Heart shape — two arcs over a triangular tip.
                const s = size * 0.34;
                ctx.beginPath();
                ctx.moveTo(cx, cy + s * 0.6);
                ctx.bezierCurveTo(cx + s * 1.4, cy - s * 0.2, cx + s * 0.6, cy - s * 1.1, cx, cy - s * 0.2);
                ctx.bezierCurveTo(cx - s * 0.6, cy - s * 1.1, cx - s * 1.4, cy - s * 0.2, cx, cy + s * 0.6);
                ctx.fill();
                break;
            }
            case 'shield': {
                // Shield shape — pointed bottom, curved top.
                const s = size * 0.38;
                ctx.beginPath();
                ctx.moveTo(cx, cy + s * 1.1);              // bottom point
                ctx.lineTo(cx - s * 0.8, cy + s * 0.1);    // lower-left
                ctx.lineTo(cx - s * 0.8, cy - s * 0.4);    // upper-left
                ctx.quadraticCurveTo(cx, cy - s * 1.0, cx + s * 0.8, cy - s * 0.4); // curved top
                ctx.lineTo(cx + s * 0.8, cy + s * 0.1);    // upper-right
                ctx.closePath();
                ctx.fill();
                break;
            }
        }
        ctx.restore();
    }

    /** Draws the player's flower at the radial center using the shared
     *  `Graphics.drawFlower()` so the avatar matches the in-game character.
     *  We rebind the Graphics instance's `ctx` to our offscreen panel canvas
     *  for the duration of the call, then restore it. */
    private drawPlayerAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
        const graphics = this.game.graphics;
        const player = this.game.getLocalPlayer();
        if (!graphics || typeof graphics.drawFlower !== 'function') {
            // Fallback: simple yellow circle if Graphics isn't available.
            ctx.save();
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(cx, cy, 41, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffe763';
            ctx.beginPath();
            ctx.arc(cx, cy, 38, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return;
        }

        ctx.save();
        ctx.translate(cx, cy);

        // Temporarily rebind the Graphics ctx so drawFlower() draws onto our
        // panel canvas. This is the same trick used by the inventory canvas to
        // call into shared draw helpers.
        const savedCtx = graphics.ctx;
        graphics.ctx = ctx;
        try {
            graphics.drawFlower({
                radius: 38,
                color: player?.color ?? '#FFE763',
                faceFlags: 0,
                equipFlags: 0,
                eyeX: graphics.playerEye?.x ?? 0,
                eyeY: graphics.playerEye?.y ?? 0,
                mouth: 14.5,
            });
        } finally {
            graphics.ctx = savedCtx;
        }
        ctx.restore();
    }

    private drawStatsAndReset(ctx: CanvasRenderingContext2D, cssW: number, cssH: number) {
        // Stat lines, just above the reset button on the right.
        ctx.save();
        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';

        const rightX = cssW - 18;
        const baseY = cssH - 56;

        const fhText = `Flower Health: ${this.statFlowerHealth}`;
        ctx.strokeText(fhText, rightX, baseY);
        ctx.fillStyle = '#7eef6d';
        ctx.fillText(fhText, rightX, baseY);

        const bdText = `Body Damage: ${this.statBodyDamage}`;
        ctx.strokeText(bdText, rightX, baseY + 16);
        ctx.fillStyle = '#e0e0e0';
        ctx.fillText(bdText, rightX, baseY + 16);
        ctx.restore();

        // Reset button (bottom-right, dark red).
        const rb = this.resetBtnRect;
        ctx.save();
        ctx.fillStyle = '#7a2a2a';
        ctx.beginPath();
        (ctx as any).roundRect(rb.x, rb.y, rb.w, rb.h, 5);
        ctx.fill();
        ctx.fillStyle = this.resetBtnHovered ? '#d83a3a' : '#b53030';
        ctx.beginPath();
        (ctx as any).roundRect(rb.x + 2, rb.y + 2, rb.w - 4, rb.h - 4, 4);
        ctx.fill();

        ctx.font = 'bold 14px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        ctx.strokeText('Reset', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Reset', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1);
        ctx.restore();
    }

    /** Draws a tooltip box near the hovered node showing skill name, rarity,
     *  multiplier, cost, and current status (unlocked / available / locked). */
    private drawTooltip(ctx: CanvasRenderingContext2D, node: NodeRect, cssW: number, _cssH: number) {
        const skill = SKILLS.find(s => s.id === node.skillId)!;
        const rarityName = node.rarity.charAt(0).toUpperCase() + node.rarity.slice(1);
        const cost = RARITY_TP_COSTS[node.rarity];
        const currentIdx = this.getCurrentTierIndex(node.skillId);
        const prereqMet = this.isPrerequisiteMet(node.skillId);
        const isUnlocked = node.tier <= currentIdx && prereqMet;
        const isAvailable = prereqMet && node.tier === currentIdx + 1 && this.playerTp >= cost;

        let status: string;
        let statusColor: string;
        if (!prereqMet) {
            const reqRarity = skill.prerequisiteRarity!;
            const parentSkill = SKILLS.find(s => s.id === skill.branchFrom!.skillId)!;
            status = `Requires ${reqRarity} ${parentSkill.name}`;
            statusColor = '#ff5050';
        } else if (isUnlocked) {
            status = 'Unlocked';
            statusColor = '#7eef6d';
        } else if (isAvailable) {
            status = 'Click to unlock';
            statusColor = '#ffe65d';
        } else if (node.tier === currentIdx + 1) {
            status = `Need ${cost - this.playerTp} more TP`;
            statusColor = '#ff5050';
        } else {
            status = 'Locked';
            statusColor = '#aaaaaa';
        }

        // Use custom tier description if available, otherwise show multiplier.
        const effectLine = skill.tierDescriptions?.[node.rarity]
            ?? `${(RARITY_MULTIPLIERS[node.rarity] * 100).toFixed(0)}% multiplier`;

        const lines = [
            { text: `${skill.name} — ${rarityName}`, color: RARITY_COLORS[node.rarity] },
            { text: effectLine, color: '#ffffff' },
            { text: `Cost: ${cost} TP`, color: '#ffffff' },
            { text: status, color: statusColor },
        ];

        const fontSize = 13;
        const lineHeight = 18;
        const padX = 12;
        const padY = 10;
        ctx.font = `bold ${fontSize}px Ubuntu, sans-serif`;

        // Measure widest line.
        let maxW = 0;
        for (const l of lines) {
            const w = ctx.measureText(l.text).width;
            if (w > maxW) maxW = w;
        }
        const boxW = maxW + padX * 2;
        const boxH = lines.length * lineHeight + padY * 2;

        // Position: prefer above the node; shift left/right to stay in bounds.
        let tx = node.sx - boxW / 2;
        let ty = node.sy - node.r * node.scale - boxH - 8;
        if (tx < 4) tx = 4;
        if (tx + boxW > cssW - 4) tx = cssW - 4 - boxW;
        if (ty < 4) ty = node.sy + node.r * node.scale + 8;

        ctx.save();
        // Background.
        ctx.fillStyle = 'rgba(30, 30, 30, 0.92)';
        ctx.beginPath();
        (ctx as any).roundRect(tx, ty, boxW, boxH, 6);
        ctx.fill();
        // Border.
        ctx.strokeStyle = RARITY_COLORS[node.rarity];
        ctx.lineWidth = 2;
        ctx.beginPath();
        (ctx as any).roundRect(tx, ty, boxW, boxH, 6);
        ctx.stroke();

        // Text lines.
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let i = 0; i < lines.length; i++) {
            const ly = ty + padY + i * lineHeight;
            ctx.fillStyle = lines[i].color;
            ctx.fillText(lines[i].text, tx + padX, ly);
        }
        ctx.restore();
    }

    // ===== input =====
    private toLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    /** Hit-tests against the projected (post-rotation) node positions. Walks
     *  the draw order in reverse so the front-most node wins ties when nodes
     *  overlap on screen. */
    private hitTestNode(x: number, y: number): number {
        for (let oi = this.drawOrder.length - 1; oi >= 0; oi--) {
            const i = this.drawOrder[oi];
            const n = this.nodes[i];
            const dx = x - n.sx;
            const dy = y - n.sy;
            const r = n.r * n.scale;
            if (dx * dx + dy * dy <= r * r) return i;
        }
        return -1;
    }

    private handleMouseMove = (e: MouseEvent) => {
        const { x, y } = this.toLocal(e);
        this.closeBtnHovered = this.pointInRect(x, y, this.closeBtnRect);
        this.resetBtnHovered = this.pointInRect(x, y, this.resetBtnRect);
        if (!this.isDragging) {
            const idx = this.hitTestNode(x, y);
            if (idx !== this.hoverIdx) this.hoverIdx = idx;
        }
    };

    private handleMouseLeave = () => {
        if (!this.isDragging) this.hoverIdx = -1;
        this.closeBtnHovered = false;
        this.resetBtnHovered = false;
    };

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const { x, y } = this.toLocal(e);

        if (this.pointInRect(x, y, this.closeBtnRect)) {
            e.preventDefault();
            this.onClose?.();
            return;
        }
        if (this.pointInRect(x, y, this.resetBtnRect)) {
            e.preventDefault();
            this.onReset?.();
            return;
        }
        // Defer the click vs. drag decision until the mouse moves enough to
        // trip the drag threshold. A node click is committed on mouseup if no
        // drag occurred; otherwise the gesture becomes an orbit drag.
        e.preventDefault();
        const idx = this.hitTestNode(x, y);
        this.pendingClick = { x: e.clientX, y: e.clientY, nodeIdx: idx };
    };

    private handleWindowMouseMove = (e: MouseEvent) => {
        if (!this.pendingClick && !this.isDragging) return;

        if (!this.isDragging && this.pendingClick) {
            const dx = e.clientX - this.pendingClick.x;
            const dy = e.clientY - this.pendingClick.y;
            if (dx * dx + dy * dy >= this.DRAG_THRESHOLD * this.DRAG_THRESHOLD) {
                this.isDragging = true;
                this.hoverIdx = -1;
            }
        }

        if (this.isDragging) {
            // Pure 2D rotation: horizontal mouse motion spins the tree around
            // the flower pivot. Vertical motion is intentionally ignored.
            this.rotation += e.movementX * 0.008;
        }
    };

    private handleWindowMouseUp = (e: MouseEvent) => {
        if (this.isDragging) {
            this.isDragging = false;
            this.pendingClick = null;
            return;
        }
        if (this.pendingClick) {
            // Click — fire upgrade if the original mousedown landed on a node.
            const idx = this.pendingClick.nodeIdx;
            this.pendingClick = null;
            if (idx >= 0) {
                const node = this.nodes[idx];
                this.onUpgrade?.(node.skillId, node.rarity);
            }
        }
    };
}
