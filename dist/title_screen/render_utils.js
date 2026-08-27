"use strict";
/**
 * Pure canvas rendering helpers for the title screen UI.
 * No state, no `this` — safe to call from anywhere.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawRoundedRect = void 0;
exports.hsvAdjust = hsvAdjust;
exports.getButtonFillColor = getButtonFillColor;
exports.getButtonStrokeColor = getButtonStrokeColor;
exports.drawGardnButton = drawGardnButton;
const text_1 = require("../graphics/text");
const shapes_1 = require("../graphics/shapes");
Object.defineProperty(exports, "drawRoundedRect", { enumerable: true, get: function () { return shapes_1.drawRoundedRect; } });
/**
 * Adjusts a color's brightness via HSV, like gardn's Renderer::HSV.
 * brightness > 1 brightens, < 1 darkens.
 */
function hsvAdjust(color, brightness) {
    let r, g, b;
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
    }
    else if (color.startsWith('rgba')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match)
            return color;
        r = parseInt(match[1]) / 255;
        g = parseInt(match[2]) / 255;
        b = parseInt(match[3]) / 255;
    }
    else if (color.startsWith('rgb')) {
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!match)
            return color;
        r = parseInt(match[1]) / 255;
        g = parseInt(match[2]) / 255;
        b = parseInt(match[3]) / 255;
    }
    else {
        return color;
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
        if (max === r)
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g)
            h = ((b - r) / d + 2) / 6;
        else
            h = ((r - g) / d + 4) / 6;
    }
    const newV = Math.min(1, Math.max(0, v * brightness));
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = newV * (1 - s);
    const q = newV * (1 - f * s);
    const t = newV * (1 - (1 - f) * s);
    let nr, ng, nb;
    switch (i % 6) {
        case 0:
            nr = newV;
            ng = t;
            nb = p;
            break;
        case 1:
            nr = q;
            ng = newV;
            nb = p;
            break;
        case 2:
            nr = p;
            ng = newV;
            nb = t;
            break;
        case 3:
            nr = p;
            ng = q;
            nb = newV;
            break;
        case 4:
            nr = t;
            ng = p;
            nb = newV;
            break;
        default:
            nr = newV;
            ng = p;
            nb = q;
            break;
    }
    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}
/** Hover = 1.1x brightness, pressed = 0.9x brightness, otherwise base. */
function getButtonFillColor(baseColor, isHovered, isPressed) {
    if (isPressed)
        return hsvAdjust(baseColor, 0.9);
    if (isHovered)
        return hsvAdjust(baseColor, 1.1);
    return baseColor;
}
/** Stroke color for a button — gardn's stroke_hsv = 0.8. */
function getButtonStrokeColor(baseColor) {
    return hsvAdjust(baseColor, 0.8);
}
/** gardn-style button: rounded rect with thick stroke, round cap/join, optional centered text. */
function drawGardnButton(ctx, x, y, width, height, baseColor, isHovered, isPressed, text, fontSize = 18, lineWidth = 5, radius = 3) {
    const fillColor = getButtonFillColor(baseColor, isHovered, isPressed);
    const strokeColor = getButtonStrokeColor(baseColor);
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    (0, shapes_1.drawRoundedRect)(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();
    if (text) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'miter';
        (0, text_1.drawText)(ctx, text, x + width / 2, y + height / 2, { size: fontSize, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
    }
}
