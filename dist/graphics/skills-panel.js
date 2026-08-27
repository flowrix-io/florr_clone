"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasSkillsPanel = void 0;
// Canvas-based talents/skills panel — replaces the prior DOM grid implementation.
// Renders a radial talent tree with one branch per skill (damage, petalHealth,
// playerHealth, healingMultiplier), each branch a chain of nine rarity tiers
// connected by dashed lines. The center of the panel hosts a small flower-face
// avatar representing the player; the bottom-right shows derived stat lines.
const petals_1 = require("../petals");
const tooltip_1 = require("./tooltip");
const text_1 = require("./text");
const RARITY_COLORS = petals_1.ITEM_RARITY_COLORS;
const RARITY_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0,
    apex: 4.8
};
const RARITY_TP_COSTS = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 5,
    legendary: 8,
    mythic: 12,
    ultra: 18,
    super: 25,
    unique: 26,
    apex: 30
};
// Custom tooltip text for each Absorption tier, generated from
// ABSORBING_SKILL_MULTIPLIERS so the displayed percentage always matches the
// actual XP bonus applied server-side.
const ABSORBING_TIER_DESCRIPTIONS = Object.fromEntries(petals_1.RARITY_LEVELS.map(r => [r, `${Math.round(petals_1.ABSORBING_SKILL_MULTIPLIERS[r] * 100)}% absorb XP`]));
const SKILLS = [
    { id: 'damage', name: 'Damage', icon: 'swirl', spiral: true },
    { id: 'petalHealth', name: 'Petal Health', icon: 'curve', spiral: true },
    { id: 'playerHealth', name: 'Flower Health', icon: 'cross', spiral: true },
    { id: 'healingMultiplier', name: 'Healing', icon: 'heart', maxTiers: 4 },
    { id: 'absorbing', name: 'Absorption', icon: 'vortex', tierDescriptions: ABSORBING_TIER_DESCRIPTIONS },
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
function darken(hex, percent = 30) {
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
class CanvasSkillsPanel {
    constructor(game) {
        this.nodes = [];
        /** Indices into `nodes`, sorted back-to-front for the current rotation. */
        this.drawOrder = [];
        this.hoverIdx = -1;
        this.rafHandle = 0;
        this.running = false;
        // ===== 2D rotation state =====
        /** Plane rotation angle (radians). Mouse drag along the X axis spins the
         *  whole talent tree around the flower pivot. */
        this.rotation = 0;
        /** True while the user is dragging the background to spin the tree. */
        this.isDragging = false;
        /** True after a mousedown when we're still deciding whether the gesture
         *  is a click on a node or the start of a rotate drag. */
        this.pendingClick = null;
        this.DRAG_THRESHOLD = 5;
        // Header / chrome hit rects (canvas-local CSS pixels).
        this.closeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.resetBtnRect = { x: 0, y: 0, w: 0, h: 0 };
        this.closeBtnHovered = false;
        this.resetBtnHovered = false;
        // Cached layout dimensions to avoid recomputing every frame unless size changes.
        this.lastCssW = 0;
        this.lastCssH = 0;
        /** Player skill state cached from updateState() — drives node coloring. */
        this.playerTp = 0;
        this.playerSkills = {};
        this.statFlowerHealth = '0';
        this.statBodyDamage = '0';
        this.onUpgrade = null;
        this.onReset = null;
        this.onClose = null;
        this.handleMouseMove = (e) => {
            const { x, y } = this.toLocal(e);
            this.closeBtnHovered = this.pointInRect(x, y, this.closeBtnRect);
            this.resetBtnHovered = this.pointInRect(x, y, this.resetBtnRect);
            if (!this.isDragging) {
                const idx = this.hitTestNode(x, y);
                if (idx !== this.hoverIdx)
                    this.hoverIdx = idx;
            }
        };
        this.handleMouseLeave = () => {
            if (!this.isDragging)
                this.hoverIdx = -1;
            this.closeBtnHovered = false;
            this.resetBtnHovered = false;
        };
        this.handleMouseDown = (e) => {
            if (e.button !== 0)
                return;
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
        this.handleWindowMouseMove = (e) => {
            if (!this.pendingClick && !this.isDragging)
                return;
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
        this.handleWindowMouseUp = (e) => {
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
        if (!ctx)
            throw new Error('CanvasSkillsPanel: failed to acquire 2d context');
        this.ctx = ctx;
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        // Drag continues even when the cursor briefly leaves the canvas, so the
        // move/up listeners live on `window` and gate themselves on isDragging.
        window.addEventListener('mousemove', this.handleWindowMouseMove);
        window.addEventListener('mouseup', this.handleWindowMouseUp);
    }
    attachTo(parent) {
        parent.appendChild(this.canvas);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        const loop = () => {
            if (!this.running)
                return;
            this.draw();
            this.rafHandle = requestAnimationFrame(loop);
        };
        loop();
    }
    stop() {
        this.running = false;
        if (this.rafHandle)
            cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
        this.hoverIdx = -1;
    }
    isRunning() {
        return this.running;
    }
    destroy() {
        this.stop();
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
        this.canvas.remove();
    }
    /** Returns true if the given client coordinates are within the canvas bounds. */
    containsClient(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }
    /** Push the latest player state used to color nodes and render stat lines. */
    updateState(tp, skills, flowerHealth, bodyDamage) {
        this.playerTp = tp;
        this.playerSkills = skills || {};
        this.statFlowerHealth = flowerHealth;
        this.statBodyDamage = bodyDamage;
    }
    syncCanvasSize() {
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
    layout(cssW, cssH) {
        if (cssW === this.lastCssW && cssH === this.lastCssH && this.nodes.length > 0)
            return;
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
        const fullTierCount = petals_1.RARITY_LEVELS.length; // 10 (incl. apex)
        const nodeRadius = 30;
        const radiusStep = 80;
        const arcSpan = Math.PI * 2;
        const angleStep = arcSpan / branchCount;
        const startAngle = -Math.PI / 2; // first branch points straight up
        // Every branch is laid out by walking equal-length segments from the
        // flower outward. The direction curves via the Spiral of Theodorus
        // (each step turns by atan(1/√n)), giving a smooth, naturally
        // non-overlapping curve with uniform node spacing.
        const segLen = radiusStep;
        this.nodes = [];
        // Track the position and direction at each tier of each main branch
        // so sub-branches can fork off them.
        const branchEndpoints = {};
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
                    const curveIdx = t - 3; // 0, 1, 2, 3, 4, 5
                    const maxTurn = Math.PI * 0.37;
                    const ramp = Math.min(1, (curveIdx + 1) / 4); // 0.25, 0.5, 0.75, 1, 1, ...
                    const ease = t === tierCount - 1 ? 1.5 : 1; // last tier turns less
                    curAngle += maxTurn * ramp * ease;
                }
                curX += Math.cos(curAngle) * segLen;
                curY += Math.sin(curAngle) * segLen;
                branchEndpoints[skill.id].push({ x: curX, y: curY, angle: curAngle });
                this.nodes.push({
                    skillId: skill.id,
                    rarity: petals_1.RARITY_LEVELS[t],
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
            const parent = skill.branchFrom;
            const endpoints = branchEndpoints[parent.skillId];
            if (!endpoints || !endpoints[parent.tierIndex])
                continue;
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
                    rarity: petals_1.RARITY_LEVELS[t],
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
    project(px, py, cx, cy) {
        const cosR = Math.cos(this.rotation);
        const sinR = Math.sin(this.rotation);
        return {
            sx: cx + px * cosR - py * sinR,
            sy: cy + px * sinR + py * cosR,
        };
    }
    /** Project every node into screen space using the current rotation. */
    updateProjections(cx, cy) {
        for (const n of this.nodes) {
            const p = this.project(n.px, n.py, cx, cy);
            n.sx = p.sx;
            n.sy = p.sy;
            // No perspective scaling in 2D mode.
            n.scale = 1;
            n.rz = 0;
        }
        this.drawOrder.length = this.nodes.length;
        for (let i = 0; i < this.nodes.length; i++)
            this.drawOrder[i] = i;
    }
    getCurrentTierIndex(skillId) {
        const tier = this.playerSkills[skillId];
        if (!tier)
            return -1;
        return (0, petals_1.getRarityIndex)(tier);
    }
    draw() {
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
        ctx.roundRect(0, 0, cssW, cssH, radius);
        ctx.fill();
        ctx.fillStyle = CanvasSkillsPanel.PANEL_BG;
        ctx.beginPath();
        ctx.roundRect(borderW, borderW, cssW - borderW * 2, cssH - borderW * 2, Math.max(0, radius - 2));
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
    drawHeader(ctx, cssW) {
        // Title centered.
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, 'Talents', cssW / 2, 14, { size: 22, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 4 });
        ctx.restore();
        // TP badge — dark rounded square containing the talent point count,
        // followed by an outlined "TP" label.
        const badgeSize = 30;
        const bx = 14;
        const by = 12;
        ctx.save();
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.roundRect(bx, by, badgeSize, badgeSize, 6);
        ctx.fill();
        ctx.fillStyle = '#5a5a5a';
        ctx.beginPath();
        ctx.roundRect(bx + 3, by + 3, badgeSize - 6, badgeSize - 6, 4);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const tpText = String(this.playerTp);
        (0, text_1.drawText)(ctx, tpText, bx + badgeSize / 2, by + badgeSize / 2 + 1, { size: 16, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        // "TP" label to the right of the badge.
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        (0, text_1.drawText)(ctx, 'TP', bx + badgeSize + 6, by + badgeSize / 2 + 1, { size: 16, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();
        // Close button (top-right).
        const cb = this.closeBtnRect;
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.roundRect(cb.x, cb.y, cb.w, cb.h, 4);
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
    drawConnectors(ctx, cx, cy) {
        const fullTierCount = petals_1.RARITY_LEVELS.length;
        ctx.save();
        ctx.lineCap = 'round';
        let branchStart = 0;
        for (let s = 0; s < SKILLS.length; s++) {
            const skill = SKILLS[s];
            const currentIdx = this.getCurrentTierIndex(skill.id);
            const tierCount = Math.min(skill.maxTiers ?? fullTierCount, fullTierCount);
            for (let t = 0; t < tierCount; t++) {
                const node = this.nodes[branchStart + t];
                let prev;
                if (t === 0) {
                    if (skill.branchFrom) {
                        // Connect first sub-branch node to its parent branch node.
                        const parentNode = this.nodes.find(n => n.skillId === skill.branchFrom.skillId && n.tier === skill.branchFrom.tierIndex);
                        prev = parentNode ?? { sx: cx, sy: cy };
                    }
                    else {
                        prev = { sx: cx, sy: cy };
                    }
                }
                else {
                    prev = this.nodes[branchStart + t - 1];
                }
                // For sub-branches, check if the prerequisite is met for the
                // connector color (parent skill must be at the required rarity).
                let unlocked = t <= currentIdx;
                if (skill.branchFrom && skill.prerequisiteRarity) {
                    const parentIdx = this.getCurrentTierIndex(skill.branchFrom.skillId);
                    const reqIdx = (0, petals_1.getRarityIndex)(skill.prerequisiteRarity);
                    if (parentIdx < reqIdx)
                        unlocked = false;
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
    isPrerequisiteMet(skillId) {
        const skill = SKILLS.find(s => s.id === skillId);
        if (!skill?.branchFrom || !skill.prerequisiteRarity)
            return true;
        const parentIdx = this.getCurrentTierIndex(skill.branchFrom.skillId);
        const reqIdx = (0, petals_1.getRarityIndex)(skill.prerequisiteRarity);
        return parentIdx >= reqIdx;
    }
    drawNode(ctx, node, hovered) {
        const currentIdx = this.getCurrentTierIndex(node.skillId);
        const prereqMet = this.isPrerequisiteMet(node.skillId);
        const isUnlocked = node.tier <= currentIdx && prereqMet;
        const isAvailable = prereqMet && node.tier === currentIdx + 1 && this.playerTp >= RARITY_TP_COSTS[node.rarity];
        let fill;
        let border;
        if (isUnlocked) {
            fill = RARITY_COLORS[node.rarity];
            border = darken(fill, 30);
        }
        else if (isAvailable) {
            fill = '#ffe65d';
            border = darken(fill, 30);
        }
        else {
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
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const lx = node.sx + r * 0.7;
        const ly = node.sy - r * 0.85;
        (0, text_1.drawText)(ctx, String(cost), lx, ly, { font: `bold ${fontSize.toFixed(1)}px Ubuntu, sans-serif`, fill: '#ff5050', stroke: '#000000', strokeWidth: 3 * node.scale });
        ctx.restore();
    }
    drawIcon(ctx, icon, cx, cy, size, color) {
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
                ctx.moveTo(cx, cy + s * 1.1); // bottom point
                ctx.lineTo(cx - s * 0.8, cy + s * 0.1); // lower-left
                ctx.lineTo(cx - s * 0.8, cy - s * 0.4); // upper-left
                ctx.quadraticCurveTo(cx, cy - s * 1.0, cx + s * 0.8, cy - s * 0.4); // curved top
                ctx.lineTo(cx + s * 0.8, cy + s * 0.1); // upper-right
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'vortex': {
                // Inward spiral — represents absorbing/drawing-in.
                ctx.beginPath();
                const turns = 1.75;
                const steps = 24;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const a = t * Math.PI * 2 * turns;
                    const r = size * 0.36 * (1 - t * 0.85);
                    const px = cx + Math.cos(a) * r;
                    const py = cy + Math.sin(a) * r;
                    if (i === 0)
                        ctx.moveTo(px, py);
                    else
                        ctx.lineTo(px, py);
                }
                ctx.lineWidth = size * 0.16;
                ctx.stroke();
                break;
            }
        }
        ctx.restore();
    }
    /** Draws the player's flower at the radial center using the shared
     *  `Graphics.drawFlower()` so the avatar matches the in-game character.
     *  We rebind the Graphics instance's `ctx` to our offscreen panel canvas
     *  for the duration of the call, then restore it. */
    drawPlayerAvatar(ctx, cx, cy) {
        const graphics = this.game.graphics;
        const player = this.game.getLocalPlayer();
        if (!graphics || typeof graphics.drawFlower !== 'function') {
            // Fallback: simple yellow circle if Graphics isn't available.
            ctx.save();
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(cx, cy, 53, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffe763';
            ctx.beginPath();
            ctx.arc(cx, cy, 50, 0, Math.PI * 2);
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
                radius: 50,
                color: player?.color ?? '#FFE763',
                faceFlags: 0,
                equipFlags: 0,
                eyeX: graphics.playerEye?.x || 2,
                eyeY: graphics.playerEye?.y ?? 0,
                mouth: 14.5,
            });
        }
        finally {
            graphics.ctx = savedCtx;
        }
        ctx.restore();
    }
    drawStatsAndReset(ctx, cssW, cssH) {
        // Stat lines, just above the reset button on the right.
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        const rightX = cssW - 18;
        const baseY = cssH - 56;
        const fhText = `Flower Health: ${this.statFlowerHealth}`;
        (0, text_1.drawText)(ctx, fhText, rightX, baseY, { size: 13, weight: 'bold', fill: '#7eef6d', stroke: '#000000', strokeWidth: 3 });
        const bdText = `Body Damage: ${this.statBodyDamage}`;
        (0, text_1.drawText)(ctx, bdText, rightX, baseY + 16, { size: 13, weight: 'bold', fill: '#e0e0e0', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();
        // Reset button (bottom-right, dark red).
        const rb = this.resetBtnRect;
        ctx.save();
        ctx.fillStyle = '#7a2a2a';
        ctx.beginPath();
        ctx.roundRect(rb.x, rb.y, rb.w, rb.h, 5);
        ctx.fill();
        ctx.fillStyle = this.resetBtnHovered ? '#d83a3a' : '#b53030';
        ctx.beginPath();
        ctx.roundRect(rb.x + 2, rb.y + 2, rb.w - 4, rb.h - 4, 4);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, 'Reset', rb.x + rb.w / 2, rb.y + rb.h / 2 + 1, { size: 14, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        ctx.restore();
    }
    /** Draws a tooltip box near the hovered node showing skill name, rarity,
     *  multiplier, cost, and current status (unlocked / available / locked). */
    drawTooltip(ctx, node, cssW, _cssH) {
        const skill = SKILLS.find(s => s.id === node.skillId);
        const rarityName = node.rarity.charAt(0).toUpperCase() + node.rarity.slice(1);
        const cost = RARITY_TP_COSTS[node.rarity];
        const currentIdx = this.getCurrentTierIndex(node.skillId);
        const prereqMet = this.isPrerequisiteMet(node.skillId);
        const isUnlocked = node.tier <= currentIdx && prereqMet;
        const isAvailable = prereqMet && node.tier === currentIdx + 1 && this.playerTp >= cost;
        let status;
        let statusColor;
        if (!prereqMet) {
            const reqRarity = skill.prerequisiteRarity;
            const parentSkill = SKILLS.find(s => s.id === skill.branchFrom.skillId);
            status = `Requires ${reqRarity} ${parentSkill.name}`;
            statusColor = '#ff5050';
        }
        else if (isUnlocked) {
            status = 'Unlocked';
            statusColor = '#7eef6d';
        }
        else if (isAvailable) {
            status = 'Click to unlock';
            statusColor = '#ffe65d';
        }
        else if (node.tier === currentIdx + 1) {
            status = `Need ${cost - this.playerTp} more TP`;
            statusColor = '#ff5050';
        }
        else {
            status = 'Locked';
            statusColor = '#aaaaaa';
        }
        // Use custom tier description if available, otherwise show multiplier.
        const effectLine = skill.tierDescriptions?.[node.rarity]
            ?? `${(RARITY_MULTIPLIERS[node.rarity] * 100).toFixed(0)}% multiplier`;
        // gardn tooltip layout: name / rarity / spacer / body.
        const lines = [
            { text: skill.name, size: 20 },
            { text: rarityName, size: 14, color: RARITY_COLORS[node.rarity] },
            { text: effectLine, size: 12, gapBefore: 10 },
            { text: `Cost: ${cost} TP`, size: 12 },
            { text: status, size: 12, color: statusColor },
        ];
        // Position: prefer above the node; shift left/right to stay in bounds.
        const { w: boxW, h: boxH } = (0, tooltip_1.measureTooltip)(ctx, lines);
        let tx = node.sx - boxW / 2;
        let ty = node.sy - node.r * node.scale - boxH - 8;
        if (tx < 4)
            tx = 4;
        if (tx + boxW > cssW - 4)
            tx = cssW - 4 - boxW;
        if (ty < 4)
            ty = node.sy + node.r * node.scale + 8;
        (0, tooltip_1.paintTooltip)(ctx, tx, ty, lines);
    }
    // ===== input =====
    toLocal(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    pointInRect(x, y, r) {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }
    /** Hit-tests against the projected (post-rotation) node positions. Walks
     *  the draw order in reverse so the front-most node wins ties when nodes
     *  overlap on screen. */
    hitTestNode(x, y) {
        for (let oi = this.drawOrder.length - 1; oi >= 0; oi--) {
            const i = this.drawOrder[oi];
            const n = this.nodes[i];
            const dx = x - n.sx;
            const dy = y - n.sy;
            const r = n.r * n.scale;
            if (dx * dx + dy * dy <= r * r)
                return i;
        }
        return -1;
    }
}
exports.CanvasSkillsPanel = CanvasSkillsPanel;
CanvasSkillsPanel.PANEL_BG = '#dc7e92';
CanvasSkillsPanel.PANEL_BORDER = '#b56476';
CanvasSkillsPanel.NODE_LOCKED_BG = '#5a5a5a';
CanvasSkillsPanel.NODE_LOCKED_BORDER = '#3a3a3a';
