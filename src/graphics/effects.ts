import { Graphics } from './core';

declare module './core' {
    interface Graphics {
        drawFloatingTexts(): void;
        drawExplosionEffects(): void;
        drawPetalBreakEffects(): void;
        drawLightningEffects(): void;
        drawPetalParticleEffects(): void;
        drawFallingStars(): void;
    }
}

Graphics.prototype.drawFloatingTexts = function(this: Graphics): void {
    this.floatingTexts = this.floatingTexts.filter(text => {
        text.y -= 1;
        text.alpha -= 1 / text.lifetime;

        if (text.alpha <= 0) return false;

        this.ctx.save();
        // Apply camera transform to convert world coordinates to screen coordinates
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
        const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;
        this.ctx.translate(-validCameraX, -validCameraY);

        this.ctx.globalAlpha = text.alpha;
        this.ctx.fillStyle = text.color;
        this.ctx.font = `${text.fontSize}px Ubuntu, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(text.text, text.x, text.y);
        this.ctx.restore();

        return true;
    });
};

Graphics.prototype.drawExplosionEffects = function(this: Graphics): void {
    this.explosionEffects = this.explosionEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;

        if (progress >= 1) return false;

        this.ctx.save();
        this.ctx.globalAlpha = effect.alpha * (1 - progress);

        // Draw expanding circle
        const currentRadius = effect.radius * progress;
        this.ctx.strokeStyle = '#FF4500';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw inner circle
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, currentRadius * 0.5, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw particles
        effect.particles = effect.particles.filter(particle => {
            const particleProgress = particle.life / particle.maxLife;
            if (particleProgress <= 0) return false;

            // Update particle position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame

            // Draw particle
            this.ctx.globalAlpha = particleProgress * effect.alpha;
            this.ctx.fillStyle = particle.color;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
            this.ctx.fill();

            return true;
        });

        this.ctx.restore();
        return true;
    });
};

Graphics.prototype.drawPetalBreakEffects = function(this: Graphics): void {
    this.petalBreakEffects = this.petalBreakEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;

        if (progress >= 1) return false;

        this.ctx.save();
        this.ctx.globalAlpha = effect.alpha * (1 - progress);

        // Draw petal fragments
        const fragmentCount = 6;
        for (let i = 0; i < fragmentCount; i++) {
            const angle = (i / fragmentCount) * Math.PI * 2;
            const distance = progress * 30;
            const fragmentX = effect.x + Math.cos(angle) * distance;
            const fragmentY = effect.y + Math.sin(angle) * distance;

            this.ctx.fillStyle = '#FF69B4';
            this.ctx.beginPath();
            this.ctx.arc(fragmentX, fragmentY, 3, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.restore();
        return true;
    });
};

Graphics.prototype.drawLightningEffects = function(this: Graphics): void {
    this.lightningEffects = this.lightningEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;

        if (progress >= 1) return false;

        this.ctx.save();
        this.ctx.globalAlpha = effect.alpha * (1 - progress);

        // Draw lightning bolts as white lines between targets
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';

        // Draw lines from origin to each target
        effect.targets.forEach(target => {
            this.ctx.beginPath();
            this.ctx.moveTo(effect.x, effect.y);
            this.ctx.lineTo(target.x, target.y);
            this.ctx.stroke();
        });

        // Draw lines between targets to create a web effect
        for (let i = 0; i < effect.targets.length; i++) {
            for (let j = i + 1; j < effect.targets.length; j++) {
                const target1 = effect.targets[i];
                const target2 = effect.targets[j];

                this.ctx.beginPath();
                this.ctx.moveTo(target1.x, target1.y);
                this.ctx.lineTo(target2.x, target2.y);
                this.ctx.stroke();
            }
        }

        // Draw bright center point
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, 5, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw target points
        effect.targets.forEach(target => {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.beginPath();
            this.ctx.arc(target.x, target.y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });

        this.ctx.restore();
        return true;
    });
};

Graphics.prototype.drawPetalParticleEffects = function(this: Graphics): void {
    this.petalParticleEffects = this.petalParticleEffects.filter(effect => {
        const elapsed = Date.now() - effect.startTime;
        const progress = elapsed / effect.lifetime;

        if (progress >= 1) return false;

        this.ctx.save();

        // Draw particles
        effect.particles = effect.particles.filter(particle => {
            const particleProgress = particle.life / particle.maxLife;
            if (particleProgress <= 0) return false;

            // Update particle position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 16; // Assuming 60fps, reduce by ~16ms per frame

            // Draw particle with white base color and faint rarity tinting
            this.ctx.globalAlpha = particleProgress * 0.6; // More visible particles

            // Create a gradient from white base to rarity color
            const gradient = this.ctx.createRadialGradient(
                particle.x, particle.y, 0,
                particle.x, particle.y, particle.size
            );
            gradient.addColorStop(0, particle.baseColor); // White center
            gradient.addColorStop(0.7, particle.baseColor); // Mostly white
            gradient.addColorStop(1, particle.color); // Faint rarity color at edges

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size * particleProgress, 0, Math.PI * 2);
            this.ctx.fill();

            return true;
        });

        this.ctx.restore();
        return true;
    });
};

Graphics.prototype.drawFallingStars = function(this: Graphics): void {
    this.fallingStars = this.fallingStars.filter(star => {
        // Update position
        star.y += star.vy;
        star.rotation += star.rotationSpeed;

        // Update lifetime
        star.lifetime -= 16; // Assuming ~60fps
        const progress = star.lifetime / star.maxLife;

        // Remove if off screen or lifetime expired
        if (star.y > this.canvas.height + 50 || progress <= 0) {
            return false;
        }

        // Draw star (in screen coordinates)
        this.ctx.save();
        this.ctx.globalAlpha = star.alpha * progress;
        this.ctx.translate(star.x, star.y);
        this.ctx.rotate(star.rotation);

        // Draw a star shape
        this.ctx.fillStyle = '#ffd700';
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;

        const points = 5;
        const outerRadius = star.size / 2;
        const innerRadius = outerRadius * 0.4;

        this.ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i * Math.PI) / points - Math.PI / 2;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
        return true;
    });
};
