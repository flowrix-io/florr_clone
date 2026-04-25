import { Item } from '../item';
import { Player, PlayerInventory } from '../player';
import { GameInterface } from '../inventory';
import { applyZoomCompensation } from '../zoom-compensation';

/**
 * Adapter that provides a GameInterface for using InventoryManager on the title screen.
 * Wraps the title screen's player data and preconnected socket.
 */
export class TitleScreenGameAdapter implements GameInterface {
    canvas: HTMLCanvasElement;
    private _playerData: { inventory: PlayerInventory; loadout: (Item | null)[] } | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        applyZoomCompensation(this.canvas);
    }

    setPlayerData(pd: { inventory: PlayerInventory; loadout: (Item | null)[] } | null): void {
        this._playerData = pd;
    }

    getLocalPlayer(): Player | undefined {
        if (!this._playerData) return undefined;
        return {
            id: (window as any).preconnectedSocket?.id || '',
            name: '',
            x: 0, y: 0, angle: 0, score: 0,
            imageLoaded: false,
            image: new Image(),
            velocityX: 0, velocityY: 0,
            health: 100, maxHealth: 100, damage: 0,
            inventory: this._playerData.inventory,
            loadout: this._playerData.loadout,
            level: 1, xp: 0, xpToNextLevel: 100,
            targetX: 0, targetY: 0,
        };
    }

    getSocket() {
        return (window as any).preconnectedSocket || undefined;
    }

    showFloatingText(_x: number, _y: number, text: string, _color: string, _fontSize: number): void {
        console.log(`[TitleScreen] ${text}`);
    }

    /** Used by CanvasInventoryPanel — pulls petal frames from preloaded assets. */
    getPetalCanvas(petalType: string, rarity: string, _time?: number): HTMLCanvasElement | null {
        const assets = (window as any).preloadedAssets;
        if (!assets || !assets.petalImages) return null;
        const entry = assets.petalImages[`${petalType}_${rarity}`];
        if (!entry) return null;
        if (Array.isArray(entry)) {
            const frameIndex = Math.floor((Date.now() / 42) % entry.length);
            return entry[frameIndex];
        }
        return entry;
    }

    /** Used by CanvasInventoryPanel — converts a preloaded sprite into a data URL. */
    getItemSpriteDataUrl(itemType: string): string | null {
        const assets = (window as any).preloadedAssets;
        if (!assets || !assets.itemSprites) return null;
        const img = assets.itemSprites[itemType];
        if (!img) return null;
        try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || 32;
            c.height = img.naturalHeight || 32;
            c.getContext('2d')?.drawImage(img, 0, 0);
            return c.toDataURL('image/png');
        } catch {
            return null;
        }
    }
}
