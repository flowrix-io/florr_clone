"use strict";
// Shared helper for drawing petal icons in UI previews (loadout, inventory,
// crafting, drag previews). Mirrors player-drawing's count clamp: a petal with
// count <= 0 (third_eye, antennae, observer, …) is shown as a single icon.
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawPetalGroup = drawPetalGroup;
function drawPetalGroup(ctx, petalCanvas, count, cx, cy, size) {
    const drawCount = typeof count === 'number' && count >= 1 && isFinite(count)
        ? Math.floor(count)
        : 1;
    if (drawCount === 1) {
        ctx.drawImage(petalCanvas, cx - size / 2, cy - size / 2, size, size);
        return;
    }
    let subSize;
    let ringRadius;
    if (drawCount === 2) {
        subSize = size * 0.62;
        ringRadius = size * 0.22;
    }
    else if (drawCount <= 4) {
        subSize = size * 0.55;
        ringRadius = size * 0.30;
    }
    else if (drawCount <= 6) {
        subSize = size * 0.48;
        ringRadius = size * 0.34;
    }
    else {
        subSize = size * 0.40;
        ringRadius = size * 0.36;
    }
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < drawCount; i++) {
        const a = startAngle + (i / drawCount) * Math.PI * 2;
        const x = cx + Math.cos(a) * ringRadius;
        const y = cy + Math.sin(a) * ringRadius;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.drawImage(petalCanvas, -subSize / 2, -subSize / 2, subSize, subSize);
        ctx.restore();
    }
}
