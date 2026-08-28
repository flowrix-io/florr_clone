import { Player } from '../player';
import { Chat } from '../chat';
import { SkillsManager } from '../skills';
import { InventoryManager } from '../inventory';
import { ShopManager } from '../shop';
import { Graphics } from '../graphics/core';
import { GuildMenuManager } from '../guildMenu';
import { DailyStreakWidget } from '../daily_streak_widget';
import { applyZoomCompensation } from '../zoom-compensation';
import { TitleScreenInventoryManager } from './inventory_manager';
import { Socket } from '../ws_client';
import { getPreconnectedSocket, getLivePreconnectedSocket } from '../net/preconnect';
import { getItemSpriteDataUrl, getPetalCanvas } from './preloaded_assets';

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
    return c;
}

/**
 * Builds the GameInterface used by ShopManager / mob-gallery InventoryManager
 * while the player is on the title screen (no real Game instance yet).
 */
export function buildTitleScreenGameInterface(inventoryManager: TitleScreenInventoryManager) {
    const offscreenCanvas = document.createElement('canvas');
    applyZoomCompensation(offscreenCanvas);
    return {
        getLocalPlayer: () => {
            const playerData = (inventoryManager as any).playerData;
            if (!playerData) return undefined;
            return {
                id: getPreconnectedSocket()?.id || '',
                name: localStorage.getItem('username') || 'Unnamed',
                score: 0,
                imageLoaded: true, image: new Image(),
                velocityX: 0, velocityY: 0,
                health: 100, maxHealth: 100, damage: 10,
                inventory: playerData.inventory,
                loadout: playerData.loadout,
                level: 1, xp: 0, xpToNextLevel: 100,
                tp: playerData.tp || 0,
                skills: playerData.skills || {},
                stars: playerData.stars || 0,
                mobKills: playerData.mobKills || {},
            } as any;
        },
        getSocket: () => getPreconnectedSocket(),
        showFloatingText: () => {},
        showFallingStars: () => {},
        canvas: offscreenCanvas,
        // Cloned: this adapter's consumers draw into the canvas they get back,
        // and getPetalCanvas hands out the shared cache entry.
        getPetalCanvas: (petalType: string, rarity: string, time: number = Date.now()): HTMLCanvasElement | null => {
            const entry = getPetalCanvas(petalType, rarity, time);
            return entry ? cloneCanvas(entry) : null;
        },
        getItemSpriteDataUrl,
    };
}

/**
 * Owns the lazily-initialized chat / skills / shop / mob-gallery / daily-streak
 * helpers used while the player is on the title screen but a Game has not yet
 * been started. Each `init*` method polls for a connected socket before
 * constructing its manager (with a 5s timeout).
 */
export class TitleScreenSubmanagers {
    public chat: Chat | null = null;
    public skills: SkillsManager | null = null;
    public shop: ShopManager | null = null;
    public mobGallery: InventoryManager | null = null;
    public dailyStreakWidget: DailyStreakWidget | null = null;

    private titleScreenVisible = true;

    constructor(
        private readonly inventoryManager: TitleScreenInventoryManager,
        private readonly guildMenuManager: GuildMenuManager,
    ) {}

    public setTitleScreenVisible(visible: boolean): void {
        this.titleScreenVisible = visible;
        if (this.dailyStreakWidget) {
            visible ? this.dailyStreakWidget.show() : this.dailyStreakWidget.hide();
        }
    }

    public ensureDailyStreakWidget(): void {
        if (!this.dailyStreakWidget) this.dailyStreakWidget = new DailyStreakWidget();
        if (this.titleScreenVisible) this.dailyStreakWidget.show();
        else this.dailyStreakWidget.hide();
    }

    public initChat(): void {
        const create = (label: string, socket: Socket) => {
            console.log(`[TitleScreen] Initializing chat with preconnected socket${label}`);
            this.chat = new Chat(socket);
            this.guildMenuManager.setSocket(socket);
            const menu = this.guildMenuManager;
            socket.on('guildUpdate', (data: any) => menu.applyGuildUpdate(data));
            socket.on('guildInviteReceived', (data: any) => menu.applyInviteReceived(data));
        };
        const checkSocket = setInterval(() => {
            const socket = getLivePreconnectedSocket();
            if (socket) {
                create('', socket);
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkSocket);
            const socket = getLivePreconnectedSocket();
            if (!this.chat && socket) {
                create(' (delayed)', socket);
            }
        }, 5000);
    }

    public initSkills(): void {
        const createGameInterface = () => ({
            getLocalPlayer: () => {
                const playerData = (this.inventoryManager as any).playerData;
                if (!playerData) return undefined;
                return {
                    id: getPreconnectedSocket()?.id || '',
                    name: localStorage.getItem('username') || 'Unnamed',
                    score: 0,
                    imageLoaded: true, image: new Image(),
                    velocityX: 0, velocityY: 0,
                    health: 100, maxHealth: 100, damage: 10,
                    inventory: playerData.inventory,
                    loadout: playerData.loadout,
                    level: 1, xp: 0, xpToNextLevel: 100,
                    tp: playerData.tp || 0,
                    skills: playerData.skills || {},
                } as Player;
            },
            getSocket: () => getPreconnectedSocket(),
            showFloatingText: () => {},
            canvas: document.createElement('canvas'),
            graphics: (() => {
                const c = document.createElement('canvas');
                const dummy = new Image();
                return new Graphics(c, dummy, dummy, dummy, dummy, dummy, dummy);
            })(),
        });
        const create = (label: string) => {
            console.log(`[TitleScreen] Initializing skills manager with preconnected socket${label}`);
            this.skills = new SkillsManager(createGameInterface());
            const playerData = (this.inventoryManager as any).playerData;
            if (playerData && playerData.tp !== undefined && playerData.skills) {
                this.skills.updateSkills(playerData.tp || 0, playerData.skills || {});
            }
        };
        const checkSocket = setInterval(() => {
            if (getLivePreconnectedSocket()) {
                create('');
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.skills && getLivePreconnectedSocket()) {
                create(' (delayed)');
            }
        }, 5000);
    }

    public initShop(): void {
        const gameInterface = buildTitleScreenGameInterface(this.inventoryManager);
        const initShop = () => {
            if (this.shop) return;
            console.log('[TitleScreen] Initializing shop manager');
            this.shop = new ShopManager(gameInterface as any);

            const socket = getPreconnectedSocket();
            if (!socket) return;
            socket.on('shopPurchaseSuccess', (data: { inventory: any, stars: number }) => {
                const playerData = (this.inventoryManager as any).playerData;
                if (playerData) {
                    playerData.inventory = data.inventory;
                    playerData.stars = data.stars;
                }
                this.shop?.handlePurchaseSuccess();
                this.shop?.updateStarsDisplay();
            });
            socket.on('shopPurchaseError', (message: string) => {
                this.shop?.handlePurchaseError(message);
            });
            socket.on('codeRedeemSuccess', (data: { code?: string, stars: number, totalStars: number }) => {
                const playerData = (this.inventoryManager as any).playerData;
                if (playerData) playerData.stars = data.totalStars;
                this.shop?.handleCodeRedeemSuccess(data.stars);
                this.shop?.updateStarsDisplay();
            });
            socket.on('codeRedeemError', (message: string) => {
                this.shop?.handleCodeRedeemError(message);
            });
            socket.on('starsEarned', (data: { amount: number, total: number }) => {
                const playerData = (this.inventoryManager as any).playerData;
                if (playerData) playerData.stars = data.total;
                this.shop?.updateStarsDisplay();
            });
            socket.on('dailyStreakStatus', (data: { starsAwarded: number; streak: number; newDay: boolean; nextClaimAtMs: number; streakExpiresAtMs: number; totalStars: number }) => {
                const playerData = (this.inventoryManager as any).playerData;
                if (playerData) playerData.stars = data.totalStars;
                this.shop?.updateStarsDisplay();
                this.ensureDailyStreakWidget();
                this.dailyStreakWidget?.update({
                    streak: data.streak,
                    newDay: data.newDay,
                    starsAwarded: data.starsAwarded,
                    nextClaimAtMs: data.nextClaimAtMs,
                    streakExpiresAtMs: data.streakExpiresAtMs,
                });
            });
        };
        const checkSocket = setInterval(() => {
            if (getLivePreconnectedSocket()) {
                initShop();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }

    public initMobGallery(): void {
        const gameInterface = buildTitleScreenGameInterface(this.inventoryManager);
        const initGallery = () => {
            if (this.mobGallery) return;
            console.log('[TitleScreen] Initializing mob gallery manager');
            this.mobGallery = new InventoryManager(gameInterface as any, null, { mobGalleryOnly: true });
        };
        const checkSocket = setInterval(() => {
            if (getLivePreconnectedSocket()) {
                initGallery();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }
}
