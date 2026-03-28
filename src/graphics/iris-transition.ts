import { Graphics } from './core';

declare module './core' {
    interface Graphics {
        startIrisTransition(screenshot: HTMLCanvasElement | null): void;
        startIrisClose(screenshot: HTMLCanvasElement | null, onComplete: () => void): void;
        captureScreenshot(): HTMLCanvasElement;
        drawIrisTransition(): void;
    }
}

Graphics.prototype.startIrisTransition = function(this: Graphics, screenshot: HTMLCanvasElement | null): void {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = false;
    this.irisTitleScreen = false;
    this.irisOnComplete = null;
};

Graphics.prototype.startIrisClose = function(this: Graphics, screenshot: HTMLCanvasElement | null, onComplete: () => void): void {
    this.irisTransitionActive = true;
    this.irisTransitionStartTime = Date.now();
    this.irisScreenshot = screenshot;
    this.irisClosing = true;
    this.irisTitleScreen = false;
    this.irisOnComplete = onComplete;
};

/** Capture the current canvas contents as a screenshot for use in transitions. */
Graphics.prototype.captureScreenshot = function(this: Graphics): HTMLCanvasElement {
    const shot = document.createElement('canvas');
    shot.width = this.canvas.width;
    shot.height = this.canvas.height;
    shot.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return shot;
};

Graphics.prototype.drawIrisTransition = function(this: Graphics): void {
    const elapsed = Date.now() - this.irisTransitionStartTime;
    const progress = Math.min(elapsed / this.IRIS_TRANSITION_DURATION, 1);


    if (progress >= 1) {
        if (this.irisClosing) {
            // Closing complete: draw final black frame
            this.ctx.save();
            this.ctx.fillStyle = 'black';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
    let eased: number;
    if (this.irisClosing) {
        eased = Math.pow(1 - progress, 3); // starts big (1), shrinks to 0
    } else {
        eased = 1 - Math.pow(1 - progress, 3); // starts small (0), grows to 1
    }

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
    const currentRadius = eased * maxRadius;

    if (this.irisClosing && !this.irisTitleScreen && this.irisScreenshot) {
        // Teleporter close: black everywhere, frozen screenshot inside shrinking circle
        this.ctx.save();
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2);
        this.ctx.clip();
        this.ctx.drawImage(this.irisScreenshot, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    } else {
        // Title screen transitions or teleporter open: draw outside the circle
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.arc(centerX, centerY, Math.max(currentRadius, 0), 0, Math.PI * 2, true);
        this.ctx.clip();
        if (this.irisTitleScreen && this.irisScreenshot) {
            this.ctx.drawImage(this.irisScreenshot, 0, 0, this.canvas.width, this.canvas.height);
        } else {
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
