import { Graphics, FaceFlags, EquipmentFlags, FlowerRenderAttributes } from './core';

declare module './core' {
    interface Graphics {
        drawFlower(attrs: FlowerRenderAttributes): void;
    }
}

Graphics.prototype.drawFlower = function(this: Graphics, attrs: FlowerRenderAttributes): void {
    const ctx = this.ctx;
    const { radius, faceFlags, equipFlags, eyeX, eyeY, mouth } = attrs;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    // Determine base color, applying status effects
    // Corruption outranks the other two: poison and dandelion are timers, but a
    // corrupted flower is one whose petals damage other players, so it has to
    // stay recognisable at a glance even while it is also poisoned.
    let baseColor = attrs.color;
    if (faceFlags & FaceFlags.HasCorruption) {
        baseColor = '#d91313';
    } else if (faceFlags & FaceFlags.Poisoned) {
        baseColor = '#ce76db';
    } else if (faceFlags & FaceFlags.Dandelioned) {
        baseColor = Graphics.mixColors(baseColor, '#ffffff', 0.4);
    }

    // The old flower drew two concentric circles:
    //   outer r=26.5  fill=#CFBB50   (acts as thick border)
    //   inner r=23.5  fill=#FFE763   (face)
    // We replicate this with a single stroked arc.  lineWidth=6 on
    // r=25 puts the outer edge at 28 and inner at 22, so instead we
    // draw the stroke circle at 26.5 with lineWidth=6 and fill at 23.5.
    const outerR = radius * (26.5 / 25);
    const innerR = radius * (23.5 / 25);
    const strokeColor = Graphics.darkenColor(baseColor, 0.8);

    // Outer border circle
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fill();

    // Inner fill circle
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fill();

    // Scale to normalised face space where the old hardcoded pixel
    // values (eyes at ±7, mouth at y=10, etc.) apply directly.
    // Old flower face was drawn inside the 23.5-radius circle, so
    // scale = radius / 25 keeps everything proportional.
    const scale = radius / 25;
    ctx.save();
    ctx.scale(scale, scale);

    // ── Eyes ──────────────────────────────────────────────────
    // Disable image smoothing for crisp edges (matches original)
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';

    if (faceFlags & FaceFlags.DeadEyes) {
        // X eyes for dead players
        const len = 4;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-7 - len, -4.8 - len);
        ctx.lineTo(-7 + len, -4.8 + len);
        ctx.moveTo(-7 + len, -4.8 - len);
        ctx.lineTo(-7 - len, -4.8 + len);
        ctx.moveTo(7 - len, -4.8 - len);
        ctx.lineTo(7 + len, -4.8 + len);
        ctx.moveTo(7 + len, -4.8 - len);
        ctx.lineTo(7 - len, -4.8 + len);
        ctx.stroke();
    } else if (faceFlags & FaceFlags.SquareEyes) {
        // Square eyes — fill only before clip (no stroke)
        ctx.beginPath();
        ctx.rect(-7 - 3, -4.8 - 6.5, 6, 13);
        ctx.rect(7 - 3, -4.8 - 6.5, 6, 13);
        ctx.fill();
        ctx.clip();
        // Pupils
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.rect(-7 + eyeX - 3, -4.8 + eyeY - 3, 6, 6);
        ctx.rect(7 + eyeX - 3, -4.8 + eyeY - 3, 6, 6);
        ctx.fill();
        // Outline strokes drawn while clipped (only inner half visible)
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(-7 - 3, -4.8 - 6.5, 6, 13);
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(7 - 3, -4.8 - 6.5, 6, 13);
        ctx.stroke();
    } else {
        // Normal ellipse eyes — fill only before clip (no stroke),
        // matching the original which only stroked after clip so only
        // the inner half of the outline was visible.
        ctx.beginPath();
        ctx.ellipse(-7, -4.8, 3.2, 6.5, 0, 0, Math.PI * 2);
        ctx.moveTo(10.2, -4.8);
        ctx.ellipse(7, -4.8, 3.2, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.clip();
        // Pupils
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-7 + eyeX, -4.8 + eyeY, 3, 0, Math.PI * 2);
        ctx.arc(7 + eyeX, -4.8 + eyeY, 3, 0, Math.PI * 2);
        ctx.fill();
        // Outline strokes drawn while clipped (only inner half visible)
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(-7, -4.8, 3.2, 6.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(7, -4.8, 3.2, 6.5, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore(); // Restore from eye clipping

    // ── Mouth ─────────────────────────────────────────────────
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, 10);
    ctx.quadraticCurveTo(0, mouth, 6, 10);
    ctx.stroke();

    // Angry triangle when attacking (and not dead, and mouth closed enough)
    // The triangle is filled with baseColor to mask the top of the eyes,
    // creating the appearance of angry/squinted eyes
    if (!(faceFlags & FaceFlags.DeadEyes) && mouth <= 8 && (faceFlags & FaceFlags.Attacking)) {
        ctx.save();
        ctx.translate(0, -mouth - 8);
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(12, 0);
        ctx.lineTo(0, 6);
        ctx.lineTo(-12, 0);
        ctx.fill();
        ctx.restore();
    }

    // Worried look when defending (and not dead, and mouth closed enough)
    // Triangles cover the outer edges of the eyes
    // if (!(faceFlags & FaceFlags.DeadEyes) && mouth <= 8 && (faceFlags & FaceFlags.Defending)) {
    //     ctx.save();
    //     ctx.fillStyle = baseColor;
    //     ctx.translate(0, -mouth - 8);
    //     // Left triangle — covers top-outer of left eye
    //     ctx.beginPath();
    //     ctx.moveTo(-12, 0);
    //     ctx.lineTo(0, 0);
    //     ctx.lineTo(-12, 6);
    //     ctx.closePath();
    //     ctx.fill();
    //     // Right triangle — covers top-outer of right eye
    //     ctx.beginPath();
    //     ctx.moveTo(12, 0);
    //     ctx.lineTo(0, 0);
    //     ctx.lineTo(12, 6);
    //     ctx.closePath();
    //     ctx.fill();
    //     ctx.restore();
    // }

    // ── Equipment: Antennae / Observer ────────────────────────
    if (equipFlags & (EquipmentFlags.Antennae | EquipmentFlags.Observer)) {
        ctx.save();
        ctx.translate(0, -35);
        ctx.fillStyle = '#333333';
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(5, 12.5);
        ctx.quadraticCurveTo(10, -2.5, 15, -12.5);
        ctx.quadraticCurveTo(5, -2.5, 5, 12.5);
        ctx.closePath();
        ctx.moveTo(-5, 12.5);
        ctx.quadraticCurveTo(-10, -2.5, -15, -12.5);
        ctx.quadraticCurveTo(-5, -2.5, -5, 12.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (equipFlags & EquipmentFlags.Observer) {
            ctx.fillStyle = '#d01c1d';
            ctx.beginPath();
            ctx.arc(15, -12.5, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(-15, -12.5, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // ── Equipment: Third Eye ──────────────────────────────────
    if (equipFlags & EquipmentFlags.ThirdEye) {
        // Prefer drawing the real Third Eye petal canvas when a rarity is provided
        // and the cached canvas is ready, so the flower shows the actual equipped petal.
        let drewPetalCanvas = false;
        if (attrs.thirdEyeRarity) {
            const petalCanvas = this.getPetalCanvas(
                `third_eye_${attrs.thirdEyeRarity}`,
                this.frameTimestamp || Date.now()
            );
            if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
                ctx.save();
                ctx.translate(0, -14);
                const petalDrawSize = 13;
                ctx.drawImage(petalCanvas, -petalDrawSize / 2, -petalDrawSize / 2, petalDrawSize, petalDrawSize);
                ctx.restore();
                drewPetalCanvas = true;
            }
        }
        if (!drewPetalCanvas) {
            ctx.save();
            ctx.translate(0, -14);
            ctx.scale(0.5, 0.5);
            if (faceFlags & FaceFlags.DeadEyes) {
                const len = 4;
                ctx.strokeStyle = '#222222';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(-len, -len);
                ctx.lineTo(len, len);
                ctx.moveTo(len, -len);
                ctx.lineTo(-len, len);
                ctx.stroke();
            } else {
                ctx.fillStyle = '#222222';
                ctx.strokeStyle = '#222222';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.ellipse(0, 0, 3.2, 6.5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.clip();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX, eyeY, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    ctx.restore(); // Restore from face scale
    ctx.imageSmoothingEnabled = prevSmoothing;
};
