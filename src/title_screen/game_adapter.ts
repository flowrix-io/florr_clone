import { Item } from '../item';
import { Player, PlayerInventory } from '../player';
import { GameInterface } from '../inventory';
import { applyZoomCompensation } from '../zoom-compensation';
import { getPetalStats } from '../petals';
import { getPreconnectedSocket } from '../net/preconnect';
import { getPreloadedAssets } from '../preloader';
import { getItemSpriteDataUrl } from './sprite_data_url';

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
            id: getPreconnectedSocket()?.id || '',
            name: '',
            score: 0,
            imageLoaded: false,
            image: new Image(),
            velocityX: 0, velocityY: 0,
            health: 100, maxHealth: 100, damage: 0,
            inventory: this._playerData.inventory,
            loadout: this._playerData.loadout,
            level: 1, xp: 0, xpToNextLevel: 100,
        };
    }

    getSocket() {
        return getPreconnectedSocket() || undefined;
    }

    showFloatingText(_x: number, _y: number, text: string, _color: string, _fontSize: number): void {
        console.log(`[TitleScreen] ${text}`);
    }

    /** Used by CanvasInventoryPanel — pulls petal frames from preloaded assets. */
    getPetalCanvas(petalType: string, rarity: string, _time?: number): HTMLCanvasElement | null {
        const assets = getPreloadedAssets() as any;
        if (!assets || !assets.petalImages) return null;
        const entry = assets.petalImages[`${petalType}_${rarity}`];
        if (!entry) return null;
        if (Array.isArray(entry)) {
            const frameIndex = Math.floor((Date.now() / 42) % entry.length);
            return entry[frameIndex];
        }
        return entry;
    }

    /** Used by preview renderers to look up the per-petal spawn count. */
    getPetalStats(petalType: string, rarity: string): any {
        return getPetalStats(petalType, rarity);
    }

    /** Used by CanvasInventoryPanel — converts a preloaded sprite into a data URL. */
    getItemSpriteDataUrl(itemType: string): string | null {
        return getItemSpriteDataUrl(itemType);
    }
}
