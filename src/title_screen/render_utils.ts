/**
 * Pure canvas rendering helpers for the title screen UI.
 * No state, no `this` — safe to call from anywhere.
 */

import { drawText } from '../graphics/text';

/** Draws a rounded rectangle path (caller fills/strokes). */
export function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Adjusts a color's brightness via HSV, like gardn's Renderer::HSV.
 * brightness > 1 brightens, < 1 darkens.
 */
export function hsvAdjust(color: string, brightness: number): string {
    let r: number, g: number, b: number;
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
    } else if (color.startsWith('rgba')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return color;
        r = parseInt(match[1]) / 255;
        g = parseInt(match[2]) / 255;
        b = parseInt(match[3]) / 255;
    } else if (color.startsWith('rgb')) {
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!match) return color;
        r = parseInt(match[1]) / 255;
        g = parseInt(match[2]) / 255;
        b = parseInt(match[3]) / 255;
    } else {
        return color;
    }

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }

    const newV = Math.min(1, Math.max(0, v * brightness));

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = newV * (1 - s);
    const q = newV * (1 - f * s);
    const t = newV * (1 - (1 - f) * s);
    let nr: number, ng: number, nb: number;
    switch (i % 6) {
        case 0: nr = newV; ng = t; nb = p; break;
        case 1: nr = q; ng = newV; nb = p; break;
        case 2: nr = p; ng = newV; nb = t; break;
        case 3: nr = p; ng = q; nb = newV; break;
        case 4: nr = t; ng = p; nb = newV; break;
        default: nr = newV; ng = p; nb = q; break;
    }

    const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

/** Hover = 1.1x brightness, pressed = 0.9x brightness, otherwise base. */
export function getButtonFillColor(baseColor: string, isHovered: boolean, isPressed: boolean): string {
    if (isPressed) return hsvAdjust(baseColor, 0.9);
    if (isHovered) return hsvAdjust(baseColor, 1.1);
    return baseColor;
}

/** Stroke color for a button — gardn's stroke_hsv = 0.8. */
export function getButtonStrokeColor(baseColor: string): string {
    return hsvAdjust(baseColor, 0.8);
}

/** gardn-style button: rounded rect with thick stroke, round cap/join, optional centered text. */
export function drawGardnButton(
    ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
    baseColor: string, isHovered: boolean, isPressed: boolean,
    text: string, fontSize: number = 18, lineWidth: number = 5, radius: number = 3
): void {
    const fillColor = getButtonFillColor(baseColor, isHovered, isPressed);
    const strokeColor = getButtonStrokeColor(baseColor);

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();

    if (text) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'miter';
        drawText(ctx, text, x + width / 2, y + height / 2,
            { size: fontSize, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
    }
}
