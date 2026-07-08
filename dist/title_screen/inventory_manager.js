"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleScreenInventoryManager = void 0;
const petals_1 = require("../petals");
const inventory_1 = require("../inventory");
const inventoryCodec_1 = require("../inventoryCodec");
const loadout_bar_1 = require("../graphics/loadout-bar");
const inventory_panel_1 = require("../graphics/inventory-panel");
const game_adapter_1 = require("./game_adapter");
/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket.
 * Crafting is delegated to a real InventoryManager instance.
 */
class TitleScreenInventoryManager {
    constructor() {
        this.inventoryPanel = null;
        /** Title canvas the loadout bar paints into (shared with bg + UI). */
        this.loadoutCanvas = null;
        this.canvasLoadoutBar = null;
        /** timestamp of last local loadout mutation for optimistic-update suppression */
        this.lastLocalLoadoutChange = 0;
        this.LOADOUT_SYNC_SUPPRESS_MS = 600;
        this.playerData = null;
        this.socket = null;
        this.isAuthenticated = false;
        // Incremental inventory display caching
        this.renderedItems = new Map();
        this.renderedRarityRows = new Map();
        this.inventoryGridContainer = null;
        this.canvasInventoryPanel = null;
        this.svgBlobUrlCache = new Map();
        this.LOADOUT_SLOTS = 20;
        this.ITEM_RARITY_COLORS = petals_1.ITEM_RARITY_COLORS;
        this.tooltipElement = null;
        this.tooltipTimeout = null;
        this.hoveredElement = null;
        this.gameAdapter = new game_adapter_1.TitleScreenGameAdapter();
        this.craftingInventoryManager = new inventory_1.InventoryManager(this.gameAdapter, null, { craftingOnly: true });
        this.setupSocketListeners();
        this.setupGlobalDragAndDrop();
        // Setup ALT key tracking for tooltip value display (only once globally)
        if (!window.altKeyTrackingSetup) {
            window.altKeyPressed = false;
            window.altKeyTrackingSetup = true;
            window.titleScreenInventoryManagers = [];
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Alt') {
                    window.altKeyPressed = true;
                    // Update all tooltips
                    const managers = window.titleScreenInventoryManagers || [];
                    managers.forEach((manager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(true);
                        }
                    });
                }
            });
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Alt') {
                    window.altKeyPressed = false;
                    // Update all tooltips
                    const managers = window.titleScreenInventoryManagers || [];
                    managers.forEach((manager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(false);
                        }
                    });
                }
            });
        }
        // Register this instance
        if (!window.titleScreenInventoryManagers) {
            window.titleScreenInventoryManagers = [];
        }
        window.titleScreenInventoryManagers.push(this);
    }
    setupGlobalDragAndDrop() {
        // Handle dropping items outside loadout slots to move them back to inventory
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEvent = e;
            const target = e.target;
            // If the drop already landed on the title canvas inside the loadout
            // area, the canvas-level drop handler (setupCanvasLoadoutInteractions)
            // has already routed it (swap / trash / equip). Skip the fallback
            // so we don't double-handle and accidentally move the item back to
            // the inventory.
            if (this.loadoutCanvas && target === this.loadoutCanvas && this.canvasLoadoutBar) {
                const r = this.loadoutCanvas.getBoundingClientRect();
                const x = (dragEvent.clientX - r.left) * (this.loadoutCanvas.width / r.width);
                const y = (dragEvent.clientY - r.top) * (this.loadoutCanvas.height / r.height);
                if (this.canvasLoadoutBar.hitTest(x, y) >= 0)
                    return;
            }
            // If dropped outside loadout slots and inventory grid, move item back to inventory
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid') && !target.closest('.crafting-inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
    }
    /**
     * Wire the loadout bar into the shared title canvas. TitleScreen calls this
     * once after the title canvas is ready, then calls drawLoadout(ctx, bounds)
     * each frame to paint the bar at the current layout position. Pointer/drag
     * events are attached here and gated on hit-testing within the bounds.
     */
    attachToTitleCanvas(canvas) {
        if (this.loadoutCanvas === canvas && this.canvasLoadoutBar)
            return;
        this.loadoutCanvas = canvas;
        const adapter = {
            canvas,
            getLocalPlayer: () => ({
                loadout: this.playerData?.loadout ?? new Array(this.LOADOUT_SLOTS).fill(null)
            }),
            getPetalCanvas: (petalType, rarity, _time) => {
                const assets = window.preloadedAssets;
                if (!assets || !assets.petalImages)
                    return null;
                const entry = assets.petalImages[`${petalType}_${rarity}`];
                if (!entry)
                    return null;
                if (Array.isArray(entry)) {
                    const frameIndex = Math.floor((Date.now() / 42) % entry.length);
                    return entry[frameIndex];
                }
                return entry;
            },
            getPetalStats: (petalType, rarity) => (0, petals_1.getPetalStats)(petalType, rarity),
            getItemSpriteDataUrl: (itemType) => {
                const assets = window.preloadedAssets;
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
            inventoryManager: this,
        };
        this.canvasLoadoutBar = new loadout_bar_1.CanvasLoadoutBar(adapter);
        this.canvasLoadoutBar.show();
        this.setupCanvasLoadoutInteractions(canvas);
    }
    /**
     * Paint the loadout bar onto the title canvas inside the given bounds.
     * Called from TitleScreen's per-frame onFrame after the bg + title UI pass.
     */
    drawLoadout(ctx, bounds) {
        if (this.canvasLoadoutBar)
            this.canvasLoadoutBar.draw(ctx, bounds);
    }
    /** Hide the loadout bar's draw + interactions (no-op renderer next frame). */
    hideLoadoutBar() {
        this.canvasLoadoutBar?.hide();
    }
    /** Show the loadout bar (visible again on subsequent frames). */
    showLoadoutBar() {
        this.canvasLoadoutBar?.show();
    }
    /** Map a mouse/drag event to title-canvas internal coords. */
    titleCanvasCoords(canvas, e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height),
        };
    }
    /**
     * Render a small offscreen canvas containing the item sprite and use it as
     * the HTML5 drag image. Without this the browser falls back to a
     * screenshot of the source element — which for the canvas-based inventory
     * and loadout means dragging the entire canvas. Works for petals (preloaded
     * canvases keyed by `${petalType}_${rarity}`) and for non-petal items
     * (preloaded HTMLImageElement sprites keyed by item type).
     */
    setItemDragImage(dataTransfer, rarity, itemKey) {
        const gs = 40;
        const ghost = document.createElement('canvas');
        ghost.width = gs;
        ghost.height = gs;
        ghost.style.width = `${gs}px`;
        ghost.style.height = `${gs}px`;
        ghost.style.position = 'fixed';
        ghost.style.top = '-1000px';
        ghost.style.left = '-1000px';
        document.body.appendChild(ghost);
        const gctx = ghost.getContext('2d');
        const assets = window.preloadedAssets;
        let drew = false;
        if (gctx && itemKey.startsWith('petal_')) {
            const petalType = itemKey.substring(6);
            const entry = assets?.petalImages?.[`${petalType}_${rarity}`];
            const petalCanvas = Array.isArray(entry)
                ? entry[Math.floor(Date.now() / 42) % entry.length]
                : entry;
            if (petalCanvas) {
                gctx.drawImage(petalCanvas, 0, 0, gs, gs);
                drew = true;
            }
        }
        else if (gctx) {
            const sprite = assets?.itemSprites?.[itemKey];
            if (sprite && sprite.complete && sprite.naturalWidth > 0) {
                gctx.drawImage(sprite, 0, 0, gs, gs);
                drew = true;
            }
        }
        if (!drew && gctx) {
            // Last-resort placeholder so we still set a tiny drag image rather
            // than letting the browser screenshot the source canvas.
            gctx.fillStyle = '#888';
            gctx.fillRect(0, 0, gs, gs);
        }
        dataTransfer.setDragImage(ghost, gs / 2, gs / 2);
        requestAnimationFrame(() => ghost.remove());
    }
    setupCanvasLoadoutInteractions(canvas) {
        // Hover tracking — only reacts when the cursor is over the slot grid.
        canvas.addEventListener('mousemove', (e) => {
            if (!this.canvasLoadoutBar)
                return;
            const { x, y } = this.titleCanvasCoords(canvas, e);
            // hitTest is in the same canvas-coord space as the slots (which are
            // laid out at the bounds passed to drawLoadout), so we can call it
            // directly without translating coordinates.
            this.canvasLoadoutBar.setHover(x, y);
            if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                this.canvasLoadoutBar.setDragPos(x, y);
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (this.canvasLoadoutBar)
                this.canvasLoadoutBar.setHover(-1, -1);
        });
        // Drag-from-canvas: the title canvas itself is the drag source. We only
        // permit drag if the press lands on a filled loadout slot — otherwise
        // we cancel via preventDefault so other canvas UI (start button, biome
        // picker, etc.) keeps working as click targets.
        canvas.draggable = true;
        canvas.addEventListener('dragstart', (e) => {
            if (!this.canvasLoadoutBar || !this.playerData) {
                e.preventDefault();
                return;
            }
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0 || hit >= this.LOADOUT_SLOTS) {
                e.preventDefault();
                return;
            }
            const item = this.playerData.loadout[hit];
            if (!item) {
                e.preventDefault();
                return;
            }
            this.canvasLoadoutBar.beginDrag(hit, x, y);
            e.dataTransfer?.setData('text/loadoutSlot', hit.toString());
            if (e.dataTransfer)
                e.dataTransfer.effectAllowed = 'move';
            if (e.dataTransfer) {
                const itemKey = item.type === 'petal' && item.petalType
                    ? `petal_${item.petalType}`
                    : item.type;
                this.setItemDragImage(e.dataTransfer, item.rarity ?? 'common', itemKey);
            }
        });
        canvas.addEventListener('dragend', () => {
            this.canvasLoadoutBar?.endDrag();
        });
        // Accept drops from the inventory DOM grid or from other loadout slots.
        canvas.addEventListener('dragover', (e) => {
            if (!this.canvasLoadoutBar)
                return;
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0)
                return; // not over the loadout area — let other handlers take it
            e.preventDefault();
            if (e.dataTransfer)
                e.dataTransfer.dropEffect = 'move';
            this.canvasLoadoutBar.setHover(x, y);
            if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                this.canvasLoadoutBar.setDragPos(x, y);
            }
        });
        canvas.addEventListener('drop', (e) => {
            if (!this.canvasLoadoutBar)
                return;
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0)
                return;
            e.preventDefault();
            const itemData = e.dataTransfer?.getData('text/plain');
            const fromLoadoutSlot = e.dataTransfer?.getData('text/loadoutSlot');
            if (hit === loadout_bar_1.LOADOUT_SLOT_COUNT) {
                if (fromLoadoutSlot)
                    this.moveItemToInventory(parseInt(fromLoadoutSlot));
            }
            else if (hit >= 0 && hit < loadout_bar_1.LOADOUT_SLOT_COUNT) {
                if (itemData) {
                    try {
                        const { rarity, type } = JSON.parse(itemData);
                        if (rarity && type)
                            this.equipItemToLoadout(rarity, type, hit);
                    }
                    catch { }
                }
                else if (fromLoadoutSlot) {
                    const from = parseInt(fromLoadoutSlot);
                    if (from !== hit)
                        this.swapLoadoutItems(from, hit);
                }
            }
            this.canvasLoadoutBar.endDrag();
        });
    }
    setupSocketListeners() {
        // Check for preconnected socket and authenticate early to get player data
        if (window.preconnectedSocket && window.preconnectedSocket.connected) {
            this.socket = window.preconnectedSocket;
            this.authenticateAndFetchData();
            this.setupCraftingSocketListeners();
            this.setupSkillsSocketListeners();
        }
        else {
            // Wait for socket to connect
            const checkSocket = setInterval(() => {
                if (window.preconnectedSocket && window.preconnectedSocket.connected) {
                    this.socket = window.preconnectedSocket;
                    this.authenticateAndFetchData();
                    this.setupCraftingSocketListeners();
                    this.setupSkillsSocketListeners();
                    clearInterval(checkSocket);
                }
            }, 100);
        }
    }
    setupSkillsSocketListeners() {
        if (!this.socket)
            return;
        // Listen for skills updates - this will be handled by index.ts which has access to titleScreen
        // We just update our local skills data here
        this.socket.on('skillsUpdated', (data) => {
            console.log('[TitleScreenInventory] skillsUpdated received:', data);
            // Check if this is for the current player
            if (data.playerId === this.socket.id) {
                // Update skills data in inventory manager
                this.updateSkillsData(data.tp, data.skills);
            }
        });
    }
    setupCraftingSocketListeners() {
        if (!this.socket)
            return;
        // Listen for crafting finished event
        this.socket.on('craftingFinished', (data) => {
            console.log('[TitleScreen] craftingFinished received:', data);
            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
            }
            const itemKey = data.newItem.type;
            let itemType = 'petal';
            let petalType;
            if (itemKey.startsWith('petal_')) {
                itemType = 'petal';
                petalType = itemKey.substring(6);
            }
            else {
                itemType = itemKey;
            }
            const displayItem = {
                type: itemType,
                rarity: data.newItem.rarity,
                petalType: petalType
            };
            this.craftingInventoryManager.showCraftingSuccess(displayItem, data.successCount, data.petalsReturned || 0);
            if (data.failCount > 0) {
                console.log(`[TitleScreen] Failed to craft ${data.failCount}x. Items were lost.`);
            }
            // Update displays
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.craftingInventoryManager.updateCraftingDisplay();
                this.updateInventoryDisplay();
            }
        });
        // Listen for crafting failures
        this.socket.on('craftingFailed', (error) => {
            alert(error);
        });
        // Absorb tab results (petals → XP), mirroring the in-game handlers.
        this.socket.on('itemsAbsorbed', (data) => {
            if (this.playerData && data.inventory) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
            }
            this.craftingInventoryManager.handleItemsAbsorbed(data);
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.updateInventoryDisplay();
            }
        });
        this.socket.on('absorbFailed', (data) => {
            if (this.playerData && data?.inventory) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
            }
            this.craftingInventoryManager.handleAbsorbFailed();
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.updateInventoryDisplay();
            }
        });
        // Listen for player updates to refresh inventory
        this.socket.on('playerUpdated', (updatedPlayer) => {
            if (updatedPlayer.inventory) {
                if (this.playerData) {
                    this.playerData.inventory = updatedPlayer.inventory;
                    this.gameAdapter.setPlayerData(this.playerData);
                }
                if (this.craftingInventoryManager.isCraftingOpen) {
                    this.craftingInventoryManager.updateCraftingDisplay();
                    this.updateInventoryDisplay();
                }
            }
            if (this.playerData) {
                if (updatedPlayer.stars !== undefined)
                    this.playerData.stars = updatedPlayer.stars;
                if (updatedPlayer.mobKills)
                    this.playerData.mobKills = updatedPlayer.mobKills;
            }
        });
    }
    /** Re-bind to the current preconnected socket and re-authenticate to fetch fresh data. */
    reauthenticate() {
        if (window.preconnectedSocket) {
            this.socket = window.preconnectedSocket;
            // Clear the one-shot flag so authenticate runs again
            if (this.socket._titleScreenAuthenticated) {
                this.socket._titleScreenAuthenticated = false;
            }
            this.isAuthenticated = false;
            this.authenticateAndFetchData();
        }
    }
    authenticateAndFetchData() {
        if (!this.socket || !this.socket.connected)
            return;
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        // Get player name from localStorage or the name input element
        const nameInput = document.getElementById('nameInput');
        const playerName = (nameInput?.value || localStorage.getItem('playerName') || 'Unnamed');
        // This authentication is only a background data fetch for the title
        // screen — always use the neutral biome. The saved biome selection is
        // applied by the Game's own authenticate when the player clicks Ready.
        // Sending the sticky selection here put accounts into maze/PVP state
        // (maze: whole inventory displayed one rarity lower, super+ petals
        // silently unequipped) just for opening the page.
        const spawnBiome = 'default';
        if (!username || !password)
            return;
        console.log('[TitleScreenInventory] Authenticating to fetch player data...');
        // Authenticate to get player data (this will spawn on server but we won't show game until Ready)
        // Use a flag to prevent duplicate authentication
        if (this.socket._titleScreenAuthenticated) {
            console.log('[TitleScreenInventory] Already authenticated, skipping');
            return;
        }
        this.socket._titleScreenAuthenticated = true;
        this.socket.emit('authenticate', {
            username,
            password,
            playerName,
            spawnBiome
        });
        // Listen for authentication response (use on instead of once to catch it if already sent)
        const authenticatedHandler = (response) => {
            if (response.success && response.player) {
                console.log('[TitleScreenInventory] Received player data:', response.player);
                this.isAuthenticated = true;
                // inventory may come as either a PlayerInventory array (triples
                // of [rarityId, itemId, count]) or a dict keyed by rarity.
                // Only run dictToInventory when it's a plain object.
                const rawInv = response.player.inventory;
                const normalizedInv = Array.isArray(rawInv)
                    ? rawInv
                    : (rawInv ? (0, inventoryCodec_1.dictToInventory)(rawInv) : []);
                this.playerData = {
                    inventory: normalizedInv,
                    loadout: (() => { const a = response.player.loadout || []; const o = new Array(20).fill(null); for (let i = 0; i < Math.min(a.length, 20); i++) {
                        if (a[i]) {
                            a[i].onCooldown = false;
                        }
                        o[i] = a[i] || null;
                    } return o; })(),
                    tp: response.player.tp,
                    skills: response.player.skills,
                    stars: response.player.stars || 0,
                    mobKills: response.player.mobKills || {}
                };
                console.log('[TitleScreenInventory] Normalized inventory, len=', normalizedInv.length, 'rawType=', Array.isArray(rawInv) ? 'array' : typeof rawInv);
                // Sync adapter so the real InventoryManager can access player data
                this.gameAdapter.setPlayerData(this.playerData);
                this.updateLoadoutDisplay();
                // Always refresh the inventory display if the panel exists.
                // The user may have already clicked the inventory button before
                // authentication completed, leaving the panel open but empty;
                // this re-populates it once data arrives.
                if (this.inventoryPanel) {
                    this.updateInventoryDisplay();
                }
                // Mark socket as authenticated - this allows operations to proceed
                // The server sets socket.username during authentication, but we ensure it's set here too
                if (this.socket && !this.socket.username) {
                    const username = localStorage.getItem('username');
                    if (username) {
                        this.socket.username = username;
                    }
                }
                // Loadout has loaded, notify title screen to stop showing connecting
                if (window.titleScreen) {
                    window.titleScreen.onLoadoutLoaded();
                }
            }
        };
        // Check if already authenticated (socket might have authenticated before we set up listener)
        if (this.socket._authenticatedData) {
            authenticatedHandler(this.socket._authenticatedData);
        }
        else {
            this.socket.on('authenticated', authenticatedHandler);
        }
    }
    updateLoadoutDisplay() {
        // The title-screen loadout is now canvas-rendered and repaints every frame.
        // This method is kept as a no-op for existing callers.
        return;
    }
    formatPetalName(petalType) {
        if (!petalType)
            return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }
    getItemCount(rarity, type) {
        if (!this.playerData || !this.playerData.inventory)
            return 0;
        return (0, inventoryCodec_1.getItemCount)(this.playerData.inventory, rarity, type);
    }
    removeItem(rarity, type, count) {
        if (!this.playerData || !this.playerData.inventory)
            return;
        (0, inventoryCodec_1.removeItem)(this.playerData.inventory, rarity, type, count);
    }
    addItem(rarity, type, count) {
        if (!this.playerData || !this.playerData.inventory)
            return;
        (0, inventoryCodec_1.addItem)(this.playerData.inventory, rarity, type, count);
    }
    equipItemToLoadout(rarity, type, loadoutSlot) {
        if (!this.playerData || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0)
            return;
        // Parse petal type if it's a petal
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        }
        else {
            itemType = type;
        }
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
            if (stats) {
                item.health = stats.health;
                item.maxHealth = stats.health;
                item.onCooldown = false;
            }
        }
        // Pad to full loadout length so secondary-row writes are preserved
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        this.removeItem(rarity, type, 1);
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }
        newLoadout[loadoutSlot] = item;
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (equipItemToLoadout):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    moveItemToInventory(loadoutSlot) {
        if (!this.playerData || loadoutSlot >= this.playerData.loadout.length)
            return;
        const item = this.playerData.loadout[loadoutSlot];
        if (!item || !item.rarity)
            return;
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        newLoadout[loadoutSlot] = null;
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (moveItemToInventory):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    swapLoadoutItems(fromSlot, toSlot) {
        if (!this.playerData)
            return;
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && this.socket.username) {
            console.log('[TitleScreen] Emitting updateLoadout (swapLoadoutItems):', {
                socketId: this.socket.id,
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        }
        else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!this.socket?.username,
                socketId: this.socket?.id
            });
        }
        this.updateLoadoutDisplay();
    }
    createInventoryItemElement(rarity, type, count) {
        // Skip eggs on title screen
        if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) {
            return null;
        }
        const itemCount = typeof count === 'number' ? count : 0;
        if (itemCount <= 0)
            return null;
        const itemElement = document.createElement('div');
        itemElement.className = 'inventory-item';
        itemElement.draggable = true;
        const rarityColor = this.ITEM_RARITY_COLORS[rarity];
        const darkenedColor = this.darkenColor(rarityColor);
        itemElement.style.cssText = `
            position: relative;
            width: 50px;
            height: 50px;
            background-color: ${rarityColor};
            border: 3px solid ${darkenedColor};
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        itemElement.addEventListener('mouseover', () => {
            itemElement.style.transform = 'scale(1.05)';
            itemElement.style.boxShadow = `0 0 10px ${this.ITEM_RARITY_COLORS[rarity]}`;
        });
        itemElement.addEventListener('mouseout', () => {
            itemElement.style.transform = 'scale(1)';
            itemElement.style.boxShadow = 'none';
        });
        itemElement.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', JSON.stringify({ rarity, type }));
            itemElement.classList.add('dragging');
        });
        itemElement.addEventListener('dragend', () => {
            itemElement.classList.remove('dragging');
        });
        itemElement.addEventListener('click', () => {
            if (!this.playerData)
                return;
            const loadout = this.playerData.loadout;
            let emptySlot = -1;
            for (let i = 0; i < loadout_bar_1.LOADOUT_SLOT_COUNT; i++) {
                if (!loadout[i]) {
                    emptySlot = i;
                    break;
                }
            }
            if (emptySlot >= 0) {
                this.equipItemToLoadout(rarity, type, emptySlot);
            }
        });
        if (type.startsWith('petal_')) {
            const petalType = type.replace('petal_', '');
            const stats = (0, petals_1.getPetalStats)(petalType, rarity);
            if (stats && stats.image) {
                const img = document.createElement('img');
                img.alt = type;
                img.draggable = false;
                img.style.cssText = `
                    width: 30px;
                    height: 30px;
                    object-fit: contain;
                `;
                const cacheKey = `${petalType}_${rarity}`;
                let url = this.svgBlobUrlCache.get(cacheKey);
                if (!url) {
                    const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                    url = URL.createObjectURL(svgBlob);
                    this.svgBlobUrlCache.set(cacheKey, url);
                }
                img.src = url;
                itemElement.appendChild(img);
            }
        }
        else {
            const img = document.createElement('img');
            img.src = `./assets/${type}.png`;
            img.alt = type;
            img.draggable = false;
            img.style.cssText = `
                width: 30px;
                height: 30px;
                object-fit: contain;
            `;
            itemElement.appendChild(img);
        }
        const countLabel = document.createElement('div');
        countLabel.className = 'item-count';
        countLabel.textContent = itemCount.toString();
        countLabel.style.cssText = `
            position: absolute;
            top: 2px;
            right: 4px;
            color: white;
            font-size: 12px;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        `;
        itemElement.appendChild(countLabel);
        if (type.startsWith('petal_')) {
            const petalType = type.replace('petal_', '');
            const petalName = this.formatPetalName(petalType);
            if (petalName) {
                const nameLabel = document.createElement('div');
                nameLabel.className = 'petal-name';
                nameLabel.textContent = petalName;
                nameLabel.style.cssText = `
                    position: absolute;
                    bottom: 5px;
                    left: 50%;
                    transform: translateX(-50%);
                    color: white;
                    font-size: 10px;
                    font-weight: bold;
                    text-shadow:
                        -1px -1px 0 #000,
                        1px -1px 0 #000,
                        -1px 1px 0 #000,
                        1px 1px 0 #000,
                        0 0 3px rgba(0,0,0,0.8);
                    white-space: nowrap;
                    pointer-events: none;
                    z-index: 10;
                `;
                itemElement.appendChild(nameLabel);
            }
            this.setupTooltip(itemElement, petalType, rarity);
        }
        return itemElement;
    }
    createRarityRow(rarity) {
        const rarityRow = document.createElement('div');
        rarityRow.className = 'rarity-row';
        rarityRow.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 5px;
        `;
        const rarityLabel = document.createElement('div');
        rarityLabel.textContent = rarity.toUpperCase();
        rarityLabel.style.cssText = `
            color: ${this.ITEM_RARITY_COLORS[rarity]};
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
            padding-left: 5px;
        `;
        rarityRow.appendChild(rarityLabel);
        const grid = document.createElement('div');
        grid.className = 'inventory-grid';
        grid.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            padding: 5px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 5px;
            border: 1px solid ${this.ITEM_RARITY_COLORS[rarity]}40;
        `;
        rarityRow.appendChild(grid);
        return { row: rarityRow, grid };
    }
    updateInventoryDisplay() {
        if (!this.inventoryPanel)
            return;
        // Canvas inventory re-renders from playerData every frame; nothing to push.
        if (this.canvasInventoryPanel)
            return;
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        if (!this.playerData) {
            content.innerHTML = '';
            const title = document.createElement('h2');
            title.textContent = 'Inventory';
            content.appendChild(title);
            const loading = document.createElement('div');
            loading.textContent = 'Loading inventory...';
            loading.style.cssText = 'color: white; padding: 20px; text-align: center;';
            content.appendChild(loading);
            this.inventoryGridContainer = null;
            return;
        }
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const invDict = this.playerData?.inventory ? (0, inventoryCodec_1.inventoryToDict)(this.playerData.inventory) : {};
        // Build set of current item keys for removal detection
        const currentKeys = new Set();
        for (const rarity in invDict) {
            for (const type in invDict[rarity]) {
                if (invDict[rarity][type] > 0) {
                    // Skip eggs
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg'))
                        continue;
                    currentKeys.add(`${rarity}:${type}`);
                }
            }
        }
        // Incremental update if grid container already exists
        if (this.inventoryGridContainer && this.inventoryGridContainer.parentNode === content) {
            // Remove items that no longer exist
            for (const [key, entry] of this.renderedItems) {
                if (!currentKeys.has(key)) {
                    entry.element.remove();
                    this.renderedItems.delete(key);
                }
            }
            rarities.forEach(rarity => {
                const items = invDict[rarity];
                const hasItems = items && Object.keys(items).some(type => {
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg'))
                        return false;
                    return items[type] > 0;
                });
                if (hasItems) {
                    let rarityEntry = this.renderedRarityRows.get(rarity);
                    if (!rarityEntry) {
                        rarityEntry = this.createRarityRow(rarity);
                        this.renderedRarityRows.set(rarity, rarityEntry);
                        const rarityIndex = rarities.indexOf(rarity);
                        let insertBefore = null;
                        for (let i = rarityIndex + 1; i < rarities.length; i++) {
                            const nextEntry = this.renderedRarityRows.get(rarities[i]);
                            if (nextEntry) {
                                insertBefore = nextEntry.row;
                                break;
                            }
                        }
                        this.inventoryGridContainer.insertBefore(rarityEntry.row, insertBefore);
                    }
                    Object.entries(items).forEach(([type, count]) => {
                        const key = `${rarity}:${type}`;
                        if (!currentKeys.has(key))
                            return;
                        const existing = this.renderedItems.get(key);
                        if (existing) {
                            if (existing.count !== count) {
                                const countLabel = existing.element.querySelector('.item-count');
                                if (countLabel)
                                    countLabel.textContent = count.toString();
                                existing.count = count;
                            }
                        }
                        else {
                            const itemElement = this.createInventoryItemElement(rarity, type, count);
                            if (itemElement) {
                                rarityEntry.grid.appendChild(itemElement);
                                this.renderedItems.set(key, { element: itemElement, count });
                            }
                        }
                    });
                }
                else {
                    const rarityEntry = this.renderedRarityRows.get(rarity);
                    if (rarityEntry) {
                        rarityEntry.row.remove();
                        this.renderedRarityRows.delete(rarity);
                    }
                }
            });
            return;
        }
        // Full rebuild (first render)
        content.innerHTML = '';
        this.renderedItems.clear();
        this.renderedRarityRows.clear();
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
        `;
        this.inventoryGridContainer = gridContainer;
        rarities.forEach(rarity => {
            const items = invDict[rarity];
            if (items && Object.keys(items).length > 0) {
                const rarityEntry = this.createRarityRow(rarity);
                this.renderedRarityRows.set(rarity, rarityEntry);
                Object.entries(items).forEach(([type, count]) => {
                    const itemElement = this.createInventoryItemElement(rarity, type, count);
                    if (itemElement) {
                        rarityEntry.grid.appendChild(itemElement);
                        this.renderedItems.set(`${rarity}:${type}`, { element: itemElement, count });
                    }
                });
                gridContainer.appendChild(rarityEntry.row);
            }
        });
        content.appendChild(gridContainer);
    }
    darkenColor(hex, percent = 30) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }
    getSkillMultiplier(skillTier) {
        if (!skillTier)
            return 1.0;
        const SKILL_MULTIPLIERS = {
            common: 1.0,
            uncommon: 1.1,
            rare: 1.2,
            epic: 1.35,
            legendary: 1.6,
            mythic: 2.0,
            ultra: 2.6,
            super: 3.3,
            unique: 4.0,
            apex: 4.8
        };
        return SKILL_MULTIPLIERS[skillTier] || 1.0;
    }
    abbreviateNumber(value) {
        if (value < 1000) {
            return value.toString();
        }
        else if (value < 1000000) {
            const k = value / 1000;
            return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
        }
        else if (value < 1000000000) {
            const m = value / 1000000;
            return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
        }
        else {
            const b = value / 1000000000;
            return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
        }
    }
    calculateFinalPetalDamage(petalType, rarity) {
        if (!this.playerData)
            return 0;
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return 0;
        const baseDamage = stats.damage;
        const damageSkillMultiplier = this.getSkillMultiplier(this.playerData.skills?.damage);
        return Math.round(baseDamage * damageSkillMultiplier);
    }
    calculateFinalPetalHealth(petalType, rarity) {
        if (!this.playerData)
            return 0;
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return 0;
        const baseHealth = stats.health;
        const petalHealthMultiplier = this.getSkillMultiplier(this.playerData.skills?.petalHealth);
        return Math.round(baseHealth * petalHealthMultiplier);
    }
    showTooltip(element, petalType, rarity) {
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return;
        this.hideTooltip();
        const tooltip = document.createElement('div');
        tooltip.className = 'petal-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid ${this.ITEM_RARITY_COLORS[rarity] || '#fff'};
            border-radius: 8px;
            padding: 12px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;
        const finalDamage = this.calculateFinalPetalDamage(petalType, rarity);
        const finalHealth = this.calculateFinalPetalHealth(petalType, rarity);
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 8px; color: ' + (this.ITEM_RARITY_COLORS[rarity] || '#fff') + ';';
        nameDiv.textContent = stats.name;
        tooltip.appendChild(nameDiv);
        if (stats.description) {
            const descDiv = document.createElement('div');
            descDiv.style.cssText = 'margin-bottom: 8px; color: #ccc; line-height: 1.4;';
            descDiv.textContent = stats.description;
            tooltip.appendChild(descDiv);
        }
        const hpDiv = document.createElement('div');
        hpDiv.style.cssText = 'margin-bottom: 4px;';
        hpDiv.setAttribute('data-full-value', finalHealth.toString());
        hpDiv.innerHTML = `<span style="color: #4CAF50;">HP:</span> <span class="tooltip-value">${this.abbreviateNumber(finalHealth)}</span>`;
        tooltip.appendChild(hpDiv);
        const damageDiv = document.createElement('div');
        damageDiv.setAttribute('data-full-value', finalDamage.toString());
        damageDiv.innerHTML = `<span style="color: #f44336;">Damage:</span> <span class="tooltip-value">${this.abbreviateNumber(finalDamage)}</span>`;
        tooltip.appendChild(damageDiv);
        document.body.appendChild(tooltip);
        this.tooltipElement = tooltip;
        this.updateTooltipPosition(element, tooltip);
    }
    updateTooltipPosition(element, tooltip) {
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        let left = rect.right + 10;
        let top = rect.top;
        if (left + tooltipRect.width > window.innerWidth) {
            left = rect.left - tooltipRect.width - 10;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }
        if (top < 0) {
            top = 10;
        }
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
    hideTooltip() {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        this.hoveredElement = null;
    }
    updateTooltipValues(showFull) {
        if (!this.tooltipElement)
            return;
        const valueElements = this.tooltipElement.querySelectorAll('.tooltip-value');
        valueElements.forEach((valueEl) => {
            const parent = valueEl.parentElement;
            if (parent && parent.hasAttribute('data-full-value')) {
                const fullValue = parent.getAttribute('data-full-value');
                if (fullValue) {
                    if (showFull) {
                        valueEl.textContent = fullValue;
                    }
                    else {
                        valueEl.textContent = this.abbreviateNumber(parseInt(fullValue));
                    }
                }
            }
        });
    }
    setupTooltip(element, petalType, rarity) {
        let isDragging = false;
        let mouseDownTime = 0;
        const handleMouseEnter = () => {
            if (isDragging)
                return;
            this.hoveredElement = element;
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.hoveredElement === element && !isDragging) {
                    this.showTooltip(element, petalType, rarity);
                    // Check initial ALT state
                    this.updateTooltipValues(window.altKeyPressed || false);
                }
            }, 200);
        };
        const handleMouseLeave = () => {
            this.hideTooltip();
        };
        const handleMouseMove = (e) => {
            if (this.tooltipElement && this.hoveredElement === element) {
                this.updateTooltipPosition(element, this.tooltipElement);
            }
        };
        const handleMouseDown = () => {
            mouseDownTime = Date.now();
            this.hideTooltip();
        };
        const handleMouseUp = () => {
            if (Date.now() - mouseDownTime < 200) {
                this.hideTooltip();
            }
        };
        const handleDragStart = () => {
            isDragging = true;
            this.hideTooltip();
        };
        const handleDragEnd = () => {
            setTimeout(() => {
                isDragging = false;
            }, 100);
        };
        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
        element.addEventListener('mousemove', handleMouseMove);
        element.addEventListener('mousedown', handleMouseDown);
        element.addEventListener('mouseup', handleMouseUp);
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragend', handleDragEnd);
    }
    toggleInventory() {
        console.log('[TitleScreenInventory] toggleInventory called. playerData:', !!this.playerData, 'isAuthenticated:', this.isAuthenticated);
        // Reuse a stale panel from a previous game session if one exists, but
        // always strip its old DOM children so the canvas mounts cleanly.
        let inventoryPanel = document.getElementById('inventoryPanel');
        if (!inventoryPanel) {
            inventoryPanel = document.createElement('div');
            inventoryPanel.id = 'inventoryPanel';
            inventoryPanel.className = 'inventory-panel';
            inventoryPanel.style.display = 'none';
            document.body.appendChild(inventoryPanel);
        }
        this.inventoryPanel = inventoryPanel;
        // First-time mount: the canvas inventory paints the entire UI itself.
        if (!this.canvasInventoryPanel) {
            inventoryPanel.innerHTML = '';
            inventoryPanel.style.padding = '0';
            inventoryPanel.style.background = 'transparent';
            inventoryPanel.style.border = 'none';
            inventoryPanel.style.boxShadow = 'none';
            inventoryPanel.style.width = '380px';
            inventoryPanel.style.overflow = 'visible';
            this.canvasInventoryPanel = new inventory_panel_1.CanvasInventoryPanel(this.gameAdapter);
            this.canvasInventoryPanel.attachTo(inventoryPanel);
            // Click (mouseup without drag) auto-equips to first empty loadout slot.
            this.canvasInventoryPanel.onItemClick = (rarity, itemType) => {
                if (!this.playerData)
                    return;
                let emptySlot = -1;
                for (let i = 0; i < loadout_bar_1.LOADOUT_SLOT_COUNT; i++) {
                    if (!this.playerData.loadout[i]) {
                        emptySlot = i;
                        break;
                    }
                }
                if (emptySlot >= 0) {
                    this.equipItemToLoadout(rarity, itemType, emptySlot);
                }
            };
            // Dragstart sets text/plain so the title canvas's loadout drop
            // handler can equip the item to the targeted slot. We must also
            // call setDragImage with a small custom image — otherwise the
            // browser uses a screenshot of the source element, which is the
            // entire inventory canvas.
            this.canvasInventoryPanel.onItemDragStart = (rarity, itemType, e) => {
                if (!e.dataTransfer)
                    return;
                e.dataTransfer.setData('text/plain', JSON.stringify({ rarity, type: itemType }));
                e.dataTransfer.effectAllowed = 'move';
                this.setItemDragImage(e.dataTransfer, rarity, itemType);
            };
            this.canvasInventoryPanel.onItemHoverChange = (hit) => {
                this.handleCanvasInventoryHover(hit);
            };
            this.canvasInventoryPanel.onClose = () => this.toggleInventory();
        }
        const isOpen = inventoryPanel.style.display !== 'none' && inventoryPanel.style.display !== '';
        if (!isOpen) {
            inventoryPanel.style.display = 'flex';
            this.canvasInventoryPanel.start();
            setTimeout(() => inventoryPanel.classList.add('open'), 10);
        }
        else {
            inventoryPanel.classList.remove('open');
            this.canvasInventoryPanel.stop();
            setTimeout(() => { inventoryPanel.style.display = 'none'; }, 300);
        }
    }
    /** Tooltip hover bridge for the canvas inventory panel. */
    handleCanvasInventoryHover(hit) {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        if (!hit || !hit.itemType.startsWith('petal_'))
            return;
        const petalType = hit.itemType.replace('petal_', '');
        const rarity = hit.rarity;
        const rect = hit.rect;
        this.tooltipTimeout = window.setTimeout(() => {
            this.showTooltipAtRect(rect, petalType, rarity);
            this.updateTooltipValues(window.altKeyPressed || false);
        }, 200);
    }
    /** Like showTooltip() but anchored to a client-space rect (canvas hit). */
    showTooltipAtRect(rect, petalType, rarity) {
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return;
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        const tooltip = document.createElement('div');
        tooltip.className = 'petal-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid ${this.ITEM_RARITY_COLORS[rarity] || '#fff'};
            border-radius: 8px;
            padding: 12px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;
        const finalDamage = this.calculateFinalPetalDamage(petalType, rarity);
        const finalHealth = this.calculateFinalPetalHealth(petalType, rarity);
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 8px; color: ' + (this.ITEM_RARITY_COLORS[rarity] || '#fff') + ';';
        nameDiv.textContent = stats.name;
        tooltip.appendChild(nameDiv);
        if (stats.description) {
            const descDiv = document.createElement('div');
            descDiv.style.cssText = 'margin-bottom: 8px; color: #ccc; line-height: 1.4;';
            descDiv.textContent = stats.description;
            tooltip.appendChild(descDiv);
        }
        const hpDiv = document.createElement('div');
        hpDiv.style.cssText = 'margin-bottom: 4px;';
        hpDiv.setAttribute('data-full-value', finalHealth.toString());
        hpDiv.innerHTML = `<span style="color: #4CAF50;">HP:</span> <span class="tooltip-value">${this.abbreviateNumber(finalHealth)}</span>`;
        tooltip.appendChild(hpDiv);
        const damageDiv = document.createElement('div');
        damageDiv.setAttribute('data-full-value', finalDamage.toString());
        damageDiv.innerHTML = `<span style="color: #f44336;">Damage:</span> <span class="tooltip-value">${this.abbreviateNumber(finalDamage)}</span>`;
        tooltip.appendChild(damageDiv);
        document.body.appendChild(tooltip);
        this.tooltipElement = tooltip;
        const tooltipRect = tooltip.getBoundingClientRect();
        let left = rect.right + 10;
        let top = rect.top;
        if (left + tooltipRect.width > window.innerWidth)
            left = rect.left - tooltipRect.width - 10;
        if (top + tooltipRect.height > window.innerHeight)
            top = window.innerHeight - tooltipRect.height - 10;
        if (top < 0)
            top = 10;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
    updateFromPlayerData(playerData) {
        // Suppress stale server-pushed loadout data while an optimistic edit is in flight
        if (this.playerData && Date.now() - this.lastLocalLoadoutChange < this.LOADOUT_SYNC_SUPPRESS_MS) {
            // Keep local loadout, merge other fields
            this.playerData = {
                ...playerData,
                loadout: this.playerData.loadout,
                inventory: this.playerData.inventory,
            };
        }
        else {
            // Pad loadout to 20 slots so secondary row is always present
            const padded = new Array(this.LOADOUT_SLOTS).fill(null);
            const src = playerData.loadout || [];
            for (let i = 0; i < Math.min(src.length, this.LOADOUT_SLOTS); i++)
                padded[i] = src[i] || null;
            this.playerData = { ...playerData, loadout: padded };
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
        // Update the game adapter and crafting display
        this.gameAdapter.setPlayerData(this.playerData);
        if (this.craftingInventoryManager.isCraftingOpen) {
            this.craftingInventoryManager.updateCraftingDisplay();
        }
        // Loadout has loaded, notify title screen to stop showing connecting
        if (window.titleScreen) {
            window.titleScreen.onLoadoutLoaded();
        }
    }
    updateSkillsData(tp, skills) {
        // Update skills data in playerData
        if (this.playerData) {
            this.playerData.tp = tp;
            this.playerData.skills = skills;
        }
    }
    toggleCrafting() {
        // Check if game is running - if so, use game's crafting
        if (window.currentGame && window.currentGame.inventoryManager) {
            window.currentGame.inventoryManager.toggleCrafting();
            return;
        }
        // Update adapter with current player data before toggling
        this.gameAdapter.setPlayerData(this.playerData);
        this.craftingInventoryManager.toggleCrafting();
    }
    toggleSkills() {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
    }
}
exports.TitleScreenInventoryManager = TitleScreenInventoryManager;
