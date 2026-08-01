"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.startIrisTransition = function (screenshot) {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = false;
    this.irisOnComplete = null;
};
core_1.Graphics.prototype.startIrisClose = function (screenshot, onComplete) {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = true;
    this.irisOnComplete = onComplete;
};
/** Capture the current canvas contents as a screenshot for use in transitions. */
core_1.Graphics.prototype.captureScreenshot = function () {
    // Snapshot at the full physical backing resolution (world + UI both live
    // on the main canvas now).
    const shot = document.createElement('canvas');
    shot.width = this.canvas.width;
    shot.height = this.canvas.height;
    shot.getContext('2d').drawImage(this.canvas, 0, 0);
    return shot;
};
core_1.Graphics.prototype.drawIrisTransition = function () {
    const elapsed = Date.now() - this.irisTransitionStartTime;
    const progress = Math.min(elapsed / this.IRIS_TRANSITION_DURATION, 1);
    if (progress >= 1) {
        if (this.irisClosing) {
            // Closing complete: draw final black frame
            this.ctx.save();
            this.ctx.fillStyle = 'black';
            this.ctx.fillRect(0, 0, this.viewW, this.viewH);
            this.ctx.restore();
        }
        this.irisTransitionActive = false;
        this.irisScreenshot = null;
        if (this.irisOnComplete) {
            const cb = this.irisOnComplete;
            this.irisOnComplete = null;
            cb();
        }
        return;
    }
    // Opening: circle grows (ease out), Closing: circle shrinks (ease in)
    const eased = this.irisClosing
        ? Math.pow(1 - progress, 3) // starts big (1), shrinks to 0
        : 1 - Math.pow(1 - progress, 3); // starts small (0), grows to 1
    const centerX = this.viewW / 2;
    const centerY = this.viewH / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
    const currentRadius = eased * maxRadius;
    if (this.irisClosing && this.irisScreenshot) {
        // Black everywhere, frozen screenshot inside the shrinking circle.
        this.ctx.save();
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.viewW, this.viewH);
        this.ctx.restore();
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2);
        this.ctx.clip();
        this.ctx.drawImage(this.irisScreenshot, 0, 0, this.viewW, this.viewH);
        this.ctx.restore();
    }
    else {
        // Opening: black outside the growing circle, live world inside.
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.viewW, this.viewH);
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2, true);
        this.ctx.clip();
        this.ctx.fillStyle = 'black';
        this.ctx.fill();
        this.ctx.restore();
    }
    // Draw black outline ring around the circle edge
    if (currentRadius > 0) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = this.IRIS_OUTLINE_WIDTH;
        this.ctx.stroke();
        this.ctx.restore();
    }
};
