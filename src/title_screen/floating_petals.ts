import { PETAL_CONFIG, RARITY_LEVELS, PetalStats } from '../petals';

export interface FloatingPetal {
    element: HTMLElement;
    x: number;
    y: number;
    speedX: number;
    rotation: number;
    rotationSpeed: number;
    size: number;
    petalStats: PetalStats;
}

export class FloatingPetalManager {
    private petals: FloatingPetal[] = [];
    private container: HTMLElement;
    private animationId: number | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.startAnimation();
    }

    private createPetal(): FloatingPetal {
        const petal = document.createElement('div');
        petal.className = 'floating-petal';

        // Get random petal type and rarity from actual petals.ts
        const petalTypes = Object.keys(PETAL_CONFIG);
        const nonAdminPetalTypes = petalTypes.filter(type =>
            !PETAL_CONFIG[type]['common']?.isAdminPetal &&
            !type.endsWith('_egg') // Exclude eggs from title screen
        );
        const petalType = nonAdminPetalTypes.length > 0 ? nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)] : 'basic';
        const rarity = RARITY_LEVELS[Math.floor(Math.random() * RARITY_LEVELS.length)];

        // Get petal stats from actual petals.ts
        const petalStats = PETAL_CONFIG[petalType]?.[rarity];
        if (!petalStats) {
            // Fallback to basic common if petal not found
            const fallbackStats = PETAL_CONFIG.basic?.common;
            if (fallbackStats) {
                petal.innerHTML = fallbackStats.image || `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fallbackStats.color}" stroke="#d9d9d9" stroke-width="2"/></svg>`;
            }
        } else {
            // Use actual petal image from petals.ts
            petal.innerHTML = petalStats.image || `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${petalStats.color}" stroke="#d9d9d9" stroke-width="2"/></svg>`;
        }

        // Random properties - only horizontal movement
        const size = 0.5 + Math.random() * 1.5; // 0.5x to 2x size
        const speedX = 0.5 + Math.random() * 2; // 0.5 to 2.5 pixels per frame (left to right only)
        const rotationSpeed = (Math.random() - 0.5) * 4; // -2 to 2 degrees per frame (rotation around center)

        petal.style.cssText = `
            position: absolute;
            width: ${size * 32}px;
            height: ${size * 32}px;
            pointer-events: none;
            z-index: 100;
            opacity: 1.0;
            transform-origin: center center;
        `;

        return {
            element: petal,
            x: -50, // Start off-screen to the left
            y: Math.random() * window.innerHeight,
            speedX,
            rotation: Math.random() * 360,
            rotationSpeed,
            size,
            petalStats: petalStats || PETAL_CONFIG.basic?.common!
        };
    }


    private updatePetal(petal: FloatingPetal): void {
        petal.x += petal.speedX;
        petal.rotation += petal.rotationSpeed;

        // Apply position and rotation (rotation around center)
        petal.element.style.left = `${petal.x}px`;
        petal.element.style.top = `${petal.y}px`;
        petal.element.style.transform = `rotate(${petal.rotation}deg)`;

        // Remove petals that have moved off-screen
        if (petal.x > window.innerWidth + 50) {
            this.removePetal(petal);
        }
    }

    private removePetal(petal: FloatingPetal): void {
        const index = this.petals.indexOf(petal);
        if (index > -1) {
            this.petals.splice(index, 1);
            this.container.removeChild(petal.element);
        }
    }

    private animate(): void {
        // Update all petals
        this.petals.forEach(petal => this.updatePetal(petal));

        // Spawn new petals occasionally
        if (Math.random() < 0.02) { // 2% chance per frame
            this.spawnPetal();
        }

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    public spawnPetal(): void {
        const petal = this.createPetal();
        this.petals.push(petal);
        this.container.appendChild(petal.element);
    }

    public startAnimation(): void {
        if (this.animationId === null) {
            this.animate();
        }
    }

    public stopAnimation(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public destroy(): void {
        this.stopAnimation();
        this.petals.forEach(petal => {
            if (petal.element.parentNode) {
                petal.element.parentNode.removeChild(petal.element);
            }
        });
        this.petals = [];
    }
}
