"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPlayerSkin = registerPlayerSkin;
exports.getActivePlayerSkin = getActivePlayerSkin;
exports.getAllPlayerSkins = getAllPlayerSkins;
exports.getPlayerSkinByName = getPlayerSkinByName;
exports.setCustomSkins = setCustomSkins;
exports.upsertCustomSkin = upsertCustomSkin;
exports.removeCustomSkin = removeCustomSkin;
exports.getCustomSkin = getCustomSkin;
exports.getAllCustomSkins = getAllCustomSkins;
exports.renderCustomSkinShapes = renderCustomSkinShapes;
const player_1 = require("../player");
// Registration-ordered so getActivePlayerSkin resolves deterministically when
// more than one bit happens to be set.
const SKIN_REGISTRY = [];
function registerPlayerSkin(skin) {
    const existing = SKIN_REGISTRY.findIndex(s => s.flag === skin.flag);
    if (existing >= 0)
        SKIN_REGISTRY[existing] = skin;
    else
        SKIN_REGISTRY.push(skin);
}
// Returns the first registered skin whose activation bit is set, or undefined
// when no skin is active (the player should render as the default flower).
function getActivePlayerSkin(renderFlags) {
    if (!renderFlags)
        return undefined;
    for (const skin of SKIN_REGISTRY) {
        if (renderFlags & skin.flag)
            return skin;
    }
    return undefined;
}
function getAllPlayerSkins() {
    return SKIN_REGISTRY;
}
function getPlayerSkinByName(name) {
    const lower = name.toLowerCase();
    return SKIN_REGISTRY.find(s => s.name.toLowerCase() === lower);
}
// ── User-created (data-driven) skins ────────────────────────────────────────
//
// Published skins arrive from the server (skinsUpdate / skinPublished /
// skinDeleted, wired in socket.ts) and live in this client-side registry so any
// player wearing one can be rendered — not just the local player. drawPlayer
// looks up player.equippedSkinId here; if found, the shape list is drawn instead
// of the default flower body. The shapes were already sanitized server-side
// (skin_format.ts), so rendering uses only validated numbers and #rrggbb colors.
const customSkinRegistry = new Map();
function setCustomSkins(list) {
    customSkinRegistry.clear();
    if (Array.isArray(list)) {
        for (const s of list)
            if (s && s.id)
                customSkinRegistry.set(s.id, s);
    }
}
function upsertCustomSkin(skin) {
    if (skin && skin.id)
        customSkinRegistry.set(skin.id, skin);
}
function removeCustomSkin(id) {
    customSkinRegistry.delete(id);
}
function getCustomSkin(id) {
    return id ? customSkinRegistry.get(id) : undefined;
}
function getAllCustomSkins() {
    return Array.from(customSkinRegistry.values());
}
/**
 * Draw a data-driven skin's shapes. Call inside the player's translated context
 * (origin at the flower centre), same space the default flower uses — `radius`
 * carries the player's size-scaled radius (the editor authors against radius 25).
 * Works with any CanvasRenderingContext2D so the editor's preview can reuse it.
 */
function renderCustomSkinShapes(ctx, shapes, radius) {
    const scale = radius / 25;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 0, 100, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        ctx.save();
        ctx.translate(s.x, s.y);
        if (s.rot)
            ctx.rotate((s.rot * Math.PI) / 180);
        ctx.beginPath();
        switch (s.t) {
            case 'circle':
                ctx.arc(0, 0, s.r || 1, 0, Math.PI * 2);
                break;
            case 'ellipse':
                ctx.ellipse(0, 0, s.rx || 1, s.ry || 1, 0, 0, Math.PI * 2);
                break;
            case 'rect': {
                const rx = s.rx || 1, ry = s.ry || 1;
                ctx.rect(-rx, -ry, rx * 2, ry * 2);
                break;
            }
            case 'line':
                // Endpoint is absolute local-space; translate() moved origin to (x,y).
                ctx.moveTo(0, 0);
                ctx.lineTo((s.x2 || 0) - s.x, (s.y2 || 0) - s.y);
                break;
            case 'curve':
                // Cubic bezier. Endpoint and both control points are absolute
                // local-space, so rebase them onto the translated origin. A fill
                // closes the path implicitly (chord from end back to start).
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo((s.cx1 ?? s.x) - s.x, (s.cy1 ?? s.y) - s.y, (s.cx2 ?? s.x2 ?? 0) - s.x, (s.cy2 ?? s.y2 ?? 0) - s.y, (s.x2 || 0) - s.x, (s.y2 || 0) - s.y);
                break;
            case 'polygon': {
                const p = s.points || [];
                if (p.length >= 6) {
                    ctx.moveTo(p[0], p[1]);
                    for (let j = 2; j + 1 < p.length; j += 2)
                        ctx.lineTo(p[j], p[j + 1]);
                    ctx.closePath();
                }
                break;
            }
        }
        if (s.fill && s.t !== 'line') {
            ctx.fillStyle = s.fill;
            ctx.fill();
        }
        if (s.stroke && (s.sw || 0) > 0) {
            ctx.strokeStyle = s.stroke;
            ctx.lineWidth = s.sw || 1;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }
    ctx.restore();
}
// ── Built-in skins ─────────────────────────────────────────────────────────
// Jack-o'-lantern: orange ribbed gourd with carved triangle eyes and a toothy
// grin. Eyes drift slightly with the look direction so it still feels alive.
registerPlayerSkin({
    flag: player_1.PlayerRenderFlags.Pumpkin,
    name: 'Pumpkin',
    render(g, attrs) {
        const ctx = g.ctx;
        const scale = attrs.radius / 25;
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.save();
        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = false;
        // Stem
        ctx.fillStyle = '#5a7d34';
        ctx.strokeStyle = '#3f5a24';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-3, -23);
        ctx.lineTo(3, -23);
        ctx.lineTo(2, -31);
        ctx.lineTo(-2, -31);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Body — dark border ring then the lit gourd, with two ribs for depth
        ctx.fillStyle = '#a8490d';
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8731f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 23, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c25a12';
        ctx.lineWidth = 1.5;
        for (const rx of [-11, 11]) {
            ctx.beginPath();
            ctx.ellipse(rx, 0, 6.5, 22, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Carved features — clamp the eye drift so pupils stay inside the sockets
        const ex = Math.max(-2, Math.min(2, attrs.eyeX)) * 0.7;
        const ey = Math.max(-2, Math.min(2, attrs.eyeY)) * 0.5;
        ctx.fillStyle = '#3a1a02';
        // Triangular eyes
        ctx.beginPath();
        ctx.moveTo(-12 + ex, -1 + ey);
        ctx.lineTo(-3 + ex, -1 + ey);
        ctx.lineTo(-7.5 + ex, -9 + ey);
        ctx.closePath();
        ctx.moveTo(12 + ex, -1 + ey);
        ctx.lineTo(3 + ex, -1 + ey);
        ctx.lineTo(7.5 + ex, -9 + ey);
        ctx.closePath();
        ctx.fill();
        // Toothy grin — zig-zag top edge over a flat base
        ctx.beginPath();
        ctx.moveTo(-13, 6);
        ctx.lineTo(-9, 12);
        ctx.lineTo(-4.5, 6);
        ctx.lineTo(0, 13);
        ctx.lineTo(4.5, 6);
        ctx.lineTo(9, 12);
        ctx.lineTo(13, 6);
        ctx.lineTo(9, 9);
        ctx.lineTo(-9, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.imageSmoothingEnabled = prevSmoothing;
    },
});
// Robot: a rounded metal head plate with a glowing visor. The eye glow uses the
// player's base flower colour so different players' robots stay distinguishable.
registerPlayerSkin({
    flag: player_1.PlayerRenderFlags.Robot,
    name: 'Robot',
    render(g, attrs) {
        const ctx = g.ctx;
        const scale = attrs.radius / 25;
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.save();
        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = false;
        // Antenna with a red bulb
        ctx.strokeStyle = '#7b8794';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -21);
        ctx.lineTo(0, -31);
        ctx.stroke();
        ctx.fillStyle = '#d01c1d';
        ctx.beginPath();
        ctx.arc(0, -33, 3, 0, Math.PI * 2);
        ctx.fill();
        // Head plate: dark bevel then brushed-metal face
        ctx.fillStyle = '#4b5563';
        ctx.beginPath();
        ctx.roundRect(-25, -22, 50, 44, 9);
        ctx.fill();
        ctx.fillStyle = '#9aa6b2';
        ctx.beginPath();
        ctx.roundRect(-22, -19, 44, 38, 7);
        ctx.fill();
        // Corner bolts
        ctx.fillStyle = '#6b7280';
        for (const [bx, by] of [[-17, -14], [17, -14], [-17, 15], [17, 15]]) {
            ctx.beginPath();
            ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
        // Visor
        ctx.fillStyle = '#10141a';
        ctx.beginPath();
        ctx.roundRect(-17, -8, 34, 13, 5);
        ctx.fill();
        // Glowing eyes — tint from the player's flower colour, drift with look dir
        const glow = attrs.color || '#27dade';
        const ex = Math.max(-2.5, Math.min(2.5, attrs.eyeX));
        const ey = Math.max(-1.5, Math.min(1.5, attrs.eyeY));
        ctx.fillStyle = glow;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 6;
        for (const sx of [-8, 8]) {
            ctx.beginPath();
            ctx.arc(sx + ex, -1.5 + ey, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        // Mouth grille
        ctx.strokeStyle = '#3a4250';
        ctx.lineWidth = 1.2;
        for (const my of [10, 14]) {
            ctx.beginPath();
            ctx.moveTo(-10, my);
            ctx.lineTo(10, my);
            ctx.stroke();
        }
        for (let gx = -10; gx <= 10; gx += 5) {
            ctx.beginPath();
            ctx.moveTo(gx, 9);
            ctx.lineTo(gx, 15);
            ctx.stroke();
        }
        ctx.restore();
        ctx.imageSmoothingEnabled = prevSmoothing;
    },
});
