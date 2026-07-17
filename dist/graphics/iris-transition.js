"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("./core");
core_1.Graphics.prototype.startIrisTransition = function (screenshot) {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = false;
    this.irisTitleScreen = false;
    this.irisOnComplete = null;
    this.irisWaiting = false;
};
/**
 * Title→game join: hold the title screenshot covering the whole screen
 * (iris fully closed) until beginIrisReveal() is called, instead of
 * revealing on a fixed timer. Prevents the world from flashing at (0,0)
 * before the first server position arrives.
 */
core_1.Graphics.prototype.startIrisRevealHold = function (screenshot) {
    this.irisTransitionActive = true;
    this.irisScreenshot = screenshot;
    this.irisClosing = false;
    this.irisTitleScreen = true;
    this.irisOnComplete = null;
    this.irisWaiting = true;
    this.irisWaitStartTime = Date.now();
    this.irisTransitionStartTime = Date.now();
};
/** Release the join hold and start the timed reveal from full-cover. */
core_1.Graphics.prototype.beginIrisReveal = function () {
    if (!this.irisWaiting)
        return;
    this.irisWaiting = false;
    this.irisTransitionStartTime = Date.now();
};
core_1.Graphics.prototype.startIrisClose = function (screenshot, onComplete) {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = true;
    this.irisTitleScreen = false;
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
    // Join hold: keep the title screenshot covering the whole screen until
    // beginIrisReveal() (or the timeout) releases it. Drawn as a plain full
    // cover — the growing-circle math below only kicks in once released.
    if (this.irisWaiting) {
        if (Date.now() - this.irisWaitStartTime > this.IRIS_WAIT_TIMEOUT_MS) {
            this.beginIrisReveal(); // fallback: don't hang the screen forever
        }
        else {
            if (this.irisScreenshot) {
                this.ctx.drawImage(this.irisScreenshot, 0, 0, this.viewW, this.viewH);
            }
            else {
                this.ctx.save();
                this.ctx.fillStyle = 'black';
                this.ctx.fillRect(0, 0, this.viewW, this.viewH);
                this.ctx.restore();
            }
            return;
        }
    }
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
    let eased;
    if (this.irisClosing) {
        eased = Math.pow(1 - progress, 3); // starts big (1), shrinks to 0
    }
    else {
        eased = 1 - Math.pow(1 - progress, 3); // starts small (0), grows to 1
    }
    const centerX = this.viewW / 2;
    const centerY = this.viewH / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
    const currentRadius = eased * maxRadius;
    if (this.irisClosing && !this.irisTitleScreen && this.irisScreenshot) {
        // Teleporter close: black everywhere, frozen screenshot inside shrinking circle
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
        // Title screen transitions or teleporter open: draw outside the circle
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.viewW, this.viewH);
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2, true);
        this.ctx.clip();
        if (this.irisTitleScreen && this.irisScreenshot) {
            this.ctx.drawImage(this.irisScreenshot, 0, 0, this.viewW, this.viewH);
        }
        else {
            this.ctx.fillStyle = 'black';
            this.ctx.fill();
        }
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
