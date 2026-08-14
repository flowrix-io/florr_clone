"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleScreenSubmanagers = void 0;
exports.cloneCanvas = cloneCanvas;
exports.buildTitleScreenGameInterface = buildTitleScreenGameInterface;
const chat_1 = require("../chat");
const skills_1 = require("../skills");
const inventory_1 = require("../inventory");
const shop_1 = require("../shop");
const core_1 = require("../graphics/core");
const daily_streak_widget_1 = require("../daily_streak_widget");
const zoom_compensation_1 = require("../zoom-compensation");
const preconnect_1 = require("../net/preconnect");
const preloader_1 = require("../preloader");
function cloneCanvas(src) {
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
function buildTitleScreenGameInterface(inventoryManager) {
    const offscreenCanvas = document.createElement('canvas');
    (0, zoom_compensation_1.applyZoomCompensation)(offscreenCanvas);
    return {
        getLocalPlayer: () => {
            const playerData = inventoryManager.playerData;
            if (!playerData)
                return undefined;
            return {
                id: (0, preconnect_1.getPreconnectedSocket)()?.id || '',
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
            };
        },
        getSocket: () => (0, preconnect_1.getPreconnectedSocket)(),
        showFloatingText: () => { },
        showFallingStars: () => { },
        canvas: offscreenCanvas,
        getPetalCanvas: (petalType, rarity, time = Date.now()) => {
            const assets = (0, preloader_1.getPreloadedAssets)();
            if (!assets || !assets.petalImages)
                return null;
            const entry = assets.petalImages[`${petalType}_${rarity}`];
            if (!entry)
                return null;
            if (Array.isArray(entry)) {
                const frameIndex = Math.floor((time / 42) % entry.length);
                return cloneCanvas(entry[frameIndex]);
            }
            return cloneCanvas(entry);
        },
        getItemSpriteDataUrl: (itemType) => {
            const assets = (0, preloader_1.getPreloadedAssets)();
            if (!assets || !assets.itemSprites)
                return null;
            const img = assets.itemSprites[itemType];
            if (!img)
                return null;
            try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth || 32;
                c.height = img.naturalHeight || 32;
                c.getContext('2d')?.drawImage(img, 0, 0);
                return c.toDataURL('image/png');
            }
            catch {
                return null;
            }
        },
    };
}
/**
 * Owns the lazily-initialized chat / skills / shop / mob-gallery / daily-streak
 * helpers used while the player is on the title screen but a Game has not yet
 * been started. Each `init*` method polls for a connected socket before
 * constructing its manager (with a 5s timeout).
 */
class TitleScreenSubmanagers {
    constructor(inventoryManager, guildMenuManager) {
        this.inventoryManager = inventoryManager;
        this.guildMenuManager = guildMenuManager;
        this.chat = null;
        this.skills = null;
        this.shop = null;
        this.mobGallery = null;
        this.dailyStreakWidget = null;
        this.titleScreenVisible = true;
    }
    setTitleScreenVisible(visible) {
        this.titleScreenVisible = visible;
        if (this.dailyStreakWidget) {
            visible ? this.dailyStreakWidget.show() : this.dailyStreakWidget.hide();
        }
    }
    ensureDailyStreakWidget() {
        if (!this.dailyStreakWidget)
            this.dailyStreakWidget = new daily_streak_widget_1.DailyStreakWidget();
        if (this.titleScreenVisible)
            this.dailyStreakWidget.show();
        else
            this.dailyStreakWidget.hide();
    }
    initChat() {
        const create = (label, socket) => {
            console.log(`[TitleScreen] Initializing chat with preconnected socket${label}`);
            this.chat = new chat_1.Chat(socket);
            this.guildMenuManager.setSocket(socket);
            const menu = this.guildMenuManager;
            socket.on('guildUpdate', (data) => menu.applyGuildUpdate(data));
            socket.on('guildInviteReceived', (data) => menu.applyInviteReceived(data));
        };
        const checkSocket = setInterval(() => {
            const socket = (0, preconnect_1.getLivePreconnectedSocket)();
            if (socket) {
                create('', socket);
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkSocket);
            const socket = (0, preconnect_1.getLivePreconnectedSocket)();
            if (!this.chat && socket) {
                create(' (delayed)', socket);
            }
        }, 5000);
    }
    initSkills() {
        const createGameInterface = () => ({
            getLocalPlayer: () => {
                const playerData = this.inventoryManager.playerData;
                if (!playerData)
                    return undefined;
                return {
                    id: (0, preconnect_1.getPreconnectedSocket)()?.id || '',
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
                };
            },
            getSocket: () => (0, preconnect_1.getPreconnectedSocket)(),
            showFloatingText: () => { },
            canvas: document.createElement('canvas'),
            graphics: (() => {
                const c = document.createElement('canvas');
                const dummy = new Image();
                return new core_1.Graphics(c, dummy, dummy, dummy, dummy, dummy, dummy);
            })(),
        });
        const create = (label) => {
            console.log(`[TitleScreen] Initializing skills manager with preconnected socket${label}`);
            this.skills = new skills_1.SkillsManager(createGameInterface());
            const playerData = this.inventoryManager.playerData;
            if (playerData && playerData.tp !== undefined && playerData.skills) {
                this.skills.updateSkills(playerData.tp || 0, playerData.skills || {});
            }
        };
        const checkSocket = setInterval(() => {
            if ((0, preconnect_1.getLivePreconnectedSocket)()) {
                create('');
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkSocket);
            if (!this.skills && (0, preconnect_1.getLivePreconnectedSocket)()) {
                create(' (delayed)');
            }
        }, 5000);
    }
    initShop() {
        const gameInterface = buildTitleScreenGameInterface(this.inventoryManager);
        const initShop = () => {
            if (this.shop)
                return;
            console.log('[TitleScreen] Initializing shop manager');
            this.shop = new shop_1.ShopManager(gameInterface);
            const socket = (0, preconnect_1.getPreconnectedSocket)();
            if (!socket)
                return;
            socket.on('shopPurchaseSuccess', (data) => {
                const playerData = this.inventoryManager.playerData;
                if (playerData) {
                    playerData.inventory = data.inventory;
                    playerData.stars = data.stars;
                }
                this.shop?.handlePurchaseSuccess();
                this.shop?.updateStarsDisplay();
            });
            socket.on('shopPurchaseError', (message) => {
                this.shop?.handlePurchaseError(message);
            });
            socket.on('codeRedeemSuccess', (data) => {
                const playerData = this.inventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.totalStars;
                this.shop?.handleCodeRedeemSuccess(data.stars);
                this.shop?.updateStarsDisplay();
            });
            socket.on('codeRedeemError', (message) => {
                this.shop?.handleCodeRedeemError(message);
            });
            socket.on('starsEarned', (data) => {
                const playerData = this.inventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.total;
                this.shop?.updateStarsDisplay();
            });
            socket.on('dailyStreakStatus', (data) => {
                const playerData = this.inventoryManager.playerData;
                if (playerData)
                    playerData.stars = data.totalStars;
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
            if ((0, preconnect_1.getLivePreconnectedSocket)()) {
                initShop();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }
    initMobGallery() {
        const gameInterface = buildTitleScreenGameInterface(this.inventoryManager);
        const initGallery = () => {
            if (this.mobGallery)
                return;
            console.log('[TitleScreen] Initializing mob gallery manager');
            this.mobGallery = new inventory_1.InventoryManager(gameInterface, null, { mobGalleryOnly: true });
        };
        const checkSocket = setInterval(() => {
            if ((0, preconnect_1.getLivePreconnectedSocket)()) {
                initGallery();
                clearInterval(checkSocket);
            }
        }, 100);
        setTimeout(() => clearInterval(checkSocket), 5000);
    }
}
exports.TitleScreenSubmanagers = TitleScreenSubmanagers;
