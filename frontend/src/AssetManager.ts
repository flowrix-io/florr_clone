import { MobType } from './types';

export class AssetManager {
    private assets: Map<string, HTMLImageElement> = new Map();
    private loadedAssets: Set<string> = new Set();
    private assetPaths: Map<string, string> = new Map();

    constructor() {
        // Map asset names to their file paths
        this.assetPaths.set('player', '/player.svg');
        this.assetPaths.set('bird', '/bird.svg');
        this.assetPaths.set('bee', '/bee.svg');
        this.assetPaths.set('cat', '/cat.svg');
        this.assetPaths.set('mouse', '/mouse.svg');
        this.assetPaths.set('easy', '/easy.svg');
        this.assetPaths.set('unknown', '/player.svg'); // fallback
    }

    public async loadAssets(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const [assetName, assetPath] of this.assetPaths.entries()) {
            promises.push(this.loadAsset(assetName, assetPath));
        }

        await Promise.all(promises);
        console.log('All assets loaded successfully');
    }

    private loadAsset(name: string, path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                this.assets.set(name, img);
                this.loadedAssets.add(name);
                console.log(`Asset loaded: ${name}`);
                resolve();
            };

            img.onerror = (error) => {
                console.error(`Failed to load asset: ${name} from ${path}`, error);
                // Don't reject - game should continue without this asset
                resolve();
            };

            img.src = path;
        });
    }

    public getAsset(name: string): HTMLImageElement | null {
        return this.assets.get(name) || null;
    }

    public isAssetLoaded(name: string): boolean {
        return this.loadedAssets.has(name);
    }

    public getAllLoadedAssets(): string[] {
        return Array.from(this.loadedAssets);
    }

    public getAssetForMobType(mobType: MobType): HTMLImageElement | null {
        switch (mobType) {
            case MobType.BIRD:
                return this.getAsset('bird');
            case MobType.BEE:
                return this.getAsset('bee');
            case MobType.CAT:
                return this.getAsset('cat');
            case MobType.MOUSE:
                return this.getAsset('mouse');
            case MobType.UNKNOWN:
                return this.getAsset('unknown');
            default:
                return this.getAsset('unknown');
        }
    }

    public preloadAsset(name: string, path: string): Promise<void> {
        if (this.isAssetLoaded(name)) {
            return Promise.resolve();
        }

        this.assetPaths.set(name, path);
        return this.loadAsset(name, path);
    }

    public unloadAsset(name: string): void {
        this.assets.delete(name);
        this.loadedAssets.delete(name);
        this.assetPaths.delete(name);
    }

    public clearAssets(): void {
        this.assets.clear();
        this.loadedAssets.clear();
        this.assetPaths.clear();
    }
} 