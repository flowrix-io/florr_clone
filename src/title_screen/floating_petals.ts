import { PETAL_CONFIG, RARITY_LEVELS, PetalStats } from '../petals';
import { getPreloadedAssets } from '../preloader';

export interface FloatingPetal {
    x: number;
    y: number;
    speedX: number;
    rotation: number;
    rotationSpeed: number;
    size: number;
    petalType: string;
    rarity: string;
    petalStats: PetalStats;
}

const BASE_PETAL_PIXELS = 32;
const SPAWN_PROBABILITY = 0.02;

export class FloatingPetalManager {
    private petals: FloatingPetal[] = [];
    private active: boolean = true;
    private spawnEnabled: boolean = true;

    constructor() {
        // Render-only manager: petals are drawn onto whatever canvas the
        // background animation hands us each frame.
    }

    private pickPetal(): { petalType: string; rarity: string; petalStats: PetalStats } {
        const petalTypes = Object.keys(PETAL_CONFIG);
        const nonAdminPetalTypes = petalTypes.filter(type =>
            !PETAL_CONFIG[type]['common']?.isAdminPetal &&
            !type.endsWith('_egg')
        );
        const petalType = nonAdminPetalTypes.length > 0
            ? nonAdminPetalTypes[Math.floor(Math.random() * nonAdminPetalTypes.length)]
            : 'basic';
        const rarity = RARITY_LEVELS[Math.floor(Math.random() * RARITY_LEVELS.length)];
        const petalStats = PETAL_CONFIG[petalType]?.[rarity] ?? PETAL_CONFIG.basic?.common!;
        return { petalType, rarity, petalStats };
    }

    private createPetal(viewportHeight: number): FloatingPetal {
        const { petalType, rarity, petalStats } = this.pickPetal();
        const size = 0.5 + Math.random() * 1.5;
        const speedX = 0.5 + Math.random() * 2;
        const rotationSpeed = (Math.random() - 0.5) * 4;
        return {
            x: -50,
            y: Math.random() * viewportHeight,
            speedX,
            rotation: Math.random() * 360,
            rotationSpeed,
            size,
            petalType,
            rarity,
            petalStats,
        };
    }

    private getPetalCanvas(petalType: string, rarity: string): HTMLCanvasElement | null {
        const assets = getPreloadedAssets() as any;
        if (!assets || !assets.petalImages) return null;
        const entry = assets.petalImages[`${petalType}_${rarity}`];
        if (!entry) return null;
        if (Array.isArray(entry)) {
            const frameIndex = Math.floor((Date.now() / 42) % entry.length);
            return entry[frameIndex];
        }
        return entry as HTMLCanvasElement;
    }

    /** Advance + draw all petals. Called once per frame by BackgroundAnimation. */
    public draw(ctx: CanvasRenderingContext2D, viewportWidth: number, viewportHeight: number): void {
        if (!this.active) return;

        if (this.spawnEnabled && Math.random() < SPAWN_PROBABILITY) {
            this.petals.push(this.createPetal(viewportHeight));
        }

        for (let i = this.petals.length - 1; i >= 0; i--) {
            const petal = this.petals[i];
            petal.x += petal.speedX;
            petal.rotation += petal.rotationSpeed;
            if (petal.x > viewportWidth + 50) {
                this.petals.splice(i, 1);
            }
        }

        for (const petal of this.petals) {
            const drawSize = petal.size * BASE_PETAL_PIXELS;
            const cx = petal.x + drawSize / 2;
            const cy = petal.y + drawSize / 2;
            const sprite = this.getPetalCanvas(petal.petalType, petal.rarity);
            if (!sprite) continue;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((petal.rotation * Math.PI) / 180);
            ctx.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.restore();
        }
    }

    public startAnimation(): void {
        this.active = true;
        this.spawnEnabled = true;
    }

    public stopAnimation(): void {
        this.spawnEnabled = false;
    }

    public destroy(): void {
        this.active = false;
        this.spawnEnabled = false;
        this.petals = [];
    }

    public hide(): void {
        this.active = false;
    }

    public show(): void {
        this.active = true;
    }
}
