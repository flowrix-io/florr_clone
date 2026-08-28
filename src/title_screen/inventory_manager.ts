import { createRarityRow, appendPetalNameLabel, createCountLabel } from '../graphics/inventory-dom';
import { getPetalStats, ITEM_RARITY_COLORS } from '../petals';
import { Item } from '../item';
import { PlayerInventory } from '../player';
import { InventoryManager } from '../inventory';
import { addItem as codecAddItem, removeItem as codecRemoveItem, getItemCount as codecGetItemCount, dictToInventory, inventoryToDict } from '../inventoryCodec';
import { CanvasLoadoutBar, LOADOUT_SLOT_COUNT as CANVAS_LOADOUT_SLOT_COUNT } from '../graphics/loadout-bar';
import { CanvasInventoryPanel, InventoryHitInfo } from '../graphics/inventory-panel';
import { TitleScreenGameAdapter } from './game_adapter';
import { getBaseDeviceScale } from '../zoom-compensation';
import { getCurrentGame, getTitleScreen } from '../app_refs';
import { getPreconnectedSocket, getLivePreconnectedSocket } from '../net/preconnect';
import { getPreloadedAssets } from '../preloader';
import { installAltKeyTracking } from '../alt_key';
import { hideTooltip as hideTooltipOverlay, TooltipAnchor } from '../graphics/tooltip';
import {
    showPetalTooltip,
    clearPetalTooltip,
} from '../graphics/petal-display';
import { getSocketAuth } from '../auth_session';
import { getItemSpriteDataUrl, getPetalCanvas } from './preloaded_assets';

/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket.
 * Crafting is delegated to a real InventoryManager instance.
 */
export class TitleScreenInventoryManager {
    private inventoryPanel: HTMLDivElement | null = null;
    /** Title canvas the loadout bar paints into (shared with bg + UI). */
    private loadoutCanvas: HTMLCanvasElement | null = null;
    private canvasLoadoutBar: CanvasLoadoutBar | null = null;
    /** timestamp of last local loadout mutation for optimistic-update suppression */
    public lastLocalLoadoutChange: number = 0;
    public readonly LOADOUT_SYNC_SUPPRESS_MS: number = 600;
    private playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; mazeLoadout?: (Item | null)[]; tp?: number; skills?: any; stars?: number; mobKills?: any } | null = null;
    private socket: any = null;
    private isAuthenticated: boolean = false;
    // Incremental inventory display caching
    private renderedItems: Map<string, { element: HTMLElement; count: number }> = new Map();
    private renderedRarityRows: Map<string, { row: HTMLElement; grid: HTMLElement }> = new Map();
    private inventoryGridContainer: HTMLElement | null = null;
    private canvasInventoryPanel: CanvasInventoryPanel | null = null;
    private svgBlobUrlCache: Map<string, string> = new Map();
    private readonly LOADOUT_SLOTS = 20;
    private readonly ITEM_RARITY_COLORS = ITEM_RARITY_COLORS;
    private tooltipTimeout: number | null = null;
    private hoveredElement: HTMLElement | null = null;
    /** Real InventoryManager used for crafting (uses the same code as in-game) */
    private gameAdapter: TitleScreenGameAdapter;
    public craftingInventoryManager: InventoryManager;

    constructor() {
        this.gameAdapter = new TitleScreenGameAdapter();
        this.craftingInventoryManager = new InventoryManager(this.gameAdapter, null, { craftingOnly: true });
        this.setupSocketListeners();
        this.setupGlobalDragAndDrop();
        
        // ALT held = tooltips show full values. The flag lives in alt_key.ts
        // and the shared tooltip overlay (graphics/tooltip.ts) repaints itself
        // on ALT changes.
        installAltKeyTracking();
    }
    
    private setupGlobalDragAndDrop(): void {
        // Handle dropping items outside loadout slots to move them back to inventory
        document.addEventListener('dragover', (e: Event) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e: Event) => {
            e.preventDefault();
            const dragEvent = e as DragEvent;
            const target = e.target as HTMLElement;

            // If the drop already landed on the title canvas inside the loadout
            // area, the canvas-level drop handler (setupCanvasLoadoutInteractions)
            // has already routed it (swap / trash / equip). Skip the fallback
            // so we don't double-handle and accidentally move the item back to
            // the inventory.
            if (this.loadoutCanvas && target === this.loadoutCanvas && this.canvasLoadoutBar) {
                const r = this.loadoutCanvas.getBoundingClientRect();
                // Logical coords (see titleCanvasCoords): divide by the base device
                // scale so the hit-test matches the slots on HiDPI displays.
                const scale = getBaseDeviceScale();
                const x = (dragEvent.clientX - r.left) * (this.loadoutCanvas.width / r.width) / scale;
                const y = (dragEvent.clientY - r.top) * (this.loadoutCanvas.height / r.height) / scale;
                if (this.canvasLoadoutBar.hitTest(x, y) >= 0) return;
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
    public attachToTitleCanvas(canvas: HTMLCanvasElement): void {
        if (this.loadoutCanvas === canvas && this.canvasLoadoutBar) return;
        this.loadoutCanvas = canvas;

        const adapter = {
            canvas,
            getLocalPlayer: () => ({
                loadout: this.getActiveLoadout()
            }),
            getPetalCanvas,
            getPetalStats: (petalType: string, rarity: string): any => getPetalStats(petalType, rarity),
            getItemSpriteDataUrl,
            inventoryManager: this as any,
        };
        this.canvasLoadoutBar = new CanvasLoadoutBar(adapter);
        this.canvasLoadoutBar.show();
        this.setupCanvasLoadoutInteractions(canvas);
    }

    /**
     * Paint the loadout bar onto the title canvas inside the given bounds.
     * Called from TitleScreen's per-frame onFrame after the bg + title UI pass.
     */
    public drawLoadout(ctx: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }): void {
        if (this.canvasLoadoutBar) this.canvasLoadoutBar.draw(ctx, bounds);
    }

    /** Hide the loadout bar's draw + interactions (no-op renderer next frame). */
    public hideLoadoutBar(): void {
        this.canvasLoadoutBar?.hide();
    }

    /** Show the loadout bar (visible again on subsequent frames). */
    public showLoadoutBar(): void {
        this.canvasLoadoutBar?.show();
    }

    /**
     * Map a mouse/drag event to the title-canvas coordinate space the loadout
     * slots live in. The title UI is painted under a base `scale(getBaseDeviceScale())`
     * transform (background.ts sets it before onFrame), so the slot rects are in
     * LOGICAL coords (canvas.width / baseDeviceScale). We must divide the physical
     * pointer position by the same factor, or on HiDPI displays (baseDPR > 1)
     * every hit-test is off by that factor and drag-and-drop drops miss.
     */
    private titleCanvasCoords(canvas: HTMLCanvasElement, e: MouseEvent | DragEvent): { x: number; y: number } {
        const r = canvas.getBoundingClientRect();
        const scale = getBaseDeviceScale();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width) / scale,
            y: (e.clientY - r.top) * (canvas.height / r.height) / scale,
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
    private setItemDragImage(dataTransfer: DataTransfer, rarity: string, itemKey: string): void {
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
        const assets = getPreloadedAssets() as any;

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
        } else if (gctx) {
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

    private setupCanvasLoadoutInteractions(canvas: HTMLCanvasElement): void {
        // Hover tracking — only reacts when the cursor is over the slot grid.
        canvas.addEventListener('mousemove', (e) => {
            if (!this.canvasLoadoutBar) return;
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
            if (this.canvasLoadoutBar) this.canvasLoadoutBar.setHover(-1, -1);
        });

        // Drag-from-canvas: the title canvas itself is the drag source. We only
        // permit drag if the press lands on a filled loadout slot — otherwise
        // we cancel via preventDefault so other canvas UI (start button, biome
        // picker, etc.) keeps working as click targets.
        canvas.draggable = true;
        canvas.addEventListener('dragstart', (e: DragEvent) => {
            if (!this.canvasLoadoutBar || !this.playerData) { e.preventDefault(); return; }
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0 || hit >= this.LOADOUT_SLOTS) { e.preventDefault(); return; }
            const item = this.getActiveLoadout()[hit];
            if (!item) { e.preventDefault(); return; }
            this.canvasLoadoutBar.beginDrag(hit, x, y);
            e.dataTransfer?.setData('text/loadoutSlot', hit.toString());
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
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
        canvas.addEventListener('dragover', (e: DragEvent) => {
            if (!this.canvasLoadoutBar) return;
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0) return; // not over the loadout area — let other handlers take it
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            this.canvasLoadoutBar.setHover(x, y);
            if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                this.canvasLoadoutBar.setDragPos(x, y);
            }
        });
        canvas.addEventListener('drop', (e: DragEvent) => {
            if (!this.canvasLoadoutBar) return;
            const { x, y } = this.titleCanvasCoords(canvas, e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0) return;
            e.preventDefault();

            const itemData = e.dataTransfer?.getData('text/plain');
            const fromLoadoutSlot = e.dataTransfer?.getData('text/loadoutSlot');

            if (hit === CANVAS_LOADOUT_SLOT_COUNT) {
                if (fromLoadoutSlot) this.moveItemToInventory(parseInt(fromLoadoutSlot));
            } else if (hit >= 0 && hit < CANVAS_LOADOUT_SLOT_COUNT) {
                if (itemData) {
                    try {
                        const { rarity, type } = JSON.parse(itemData);
                        if (rarity && type) this.equipItemToLoadout(rarity, type, hit);
                    } catch {}
                } else if (fromLoadoutSlot) {
                    const from = parseInt(fromLoadoutSlot);
                    if (from !== hit) this.swapLoadoutItems(from, hit);
                }
            }
            this.canvasLoadoutBar.endDrag();
        });
    }

    private setupSocketListeners(): void {
        // Check for preconnected socket and authenticate early to get player data
        const live = getLivePreconnectedSocket();
        if (live) {
            this.socket = live;
            void this.authenticateAndFetchData();
            this.setupCraftingSocketListeners();
            this.setupSkillsSocketListeners();
        } else {
            // Wait for socket to connect
            const checkSocket = setInterval(() => {
                const socket = getLivePreconnectedSocket();
                if (socket) {
                    this.socket = socket;
                    void this.authenticateAndFetchData();
                    this.setupCraftingSocketListeners();
                    this.setupSkillsSocketListeners();
                    clearInterval(checkSocket);
                }
            }, 100);
        }
    }

    /** Re-point at the current socket and (re-)install every title-screen
     *  handler. Required whenever a socket is handed back from a game: Game
     *  cleanup calls socket.removeAllListeners() before reuseSocketForTitleScreen,
     *  which drops the title screen's handlers along with the game's own. Without
     *  this, a craft started on the title screen after playing emits craftItems,
     *  gets craftingFinished back, and has nobody listening — the panel spins
     *  forever. Safe to call repeatedly: the handler objects are created once,
     *  and the socket stores handlers in a Set keyed by function identity. */
    public rebindSocketListeners(socket: any): void {
        if (!socket) return;
        this.socket = socket;
        this.setupCraftingSocketListeners();
        this.setupSkillsSocketListeners();
    }

    /** Requests go out on whatever getPreconnectedSocket() returns *now* (that's
     *  what the crafting adapter emits through), while our listeners sit on the
     *  socket that existed when they were installed. A reconnect drops the old
     *  socket and preconnects a new one, so those can drift apart — emitting on
     *  one and listening on the other is exactly how a craft ends up with no
     *  response. Re-bind whenever they diverge. */
    private ensureSocketBound(): void {
        const live = getPreconnectedSocket();
        if (live && live !== this.socket) {
            console.log('[TitleScreenInventory] Socket changed — re-binding listeners');
            this.rebindSocketListeners(live);
        }
    }

    /** Handlers are built once and reused so re-registration can't double-fire
     *  them (a second craftingFinished run would re-deduct the staged items). */
    private skillsHandlers: Record<string, (...args: any[]) => void> | null = null;
    private craftingHandlers: Record<string, (...args: any[]) => void> | null = null;

    private setupSkillsSocketListeners(): void {
        if (!this.socket) return;

        if (!this.skillsHandlers) this.skillsHandlers = {
            // Listen for skills updates - this will be handled by index.ts which has access to titleScreen
            // We just update our local skills data here
            skillsUpdated: (data: { playerId: string; tp: number; skills: { [key: string]: string } }) => {
                console.log('[TitleScreenInventory] skillsUpdated received:', data);
                // Check if this is for the current player
                if (data.playerId === this.socket.id) {
                    // Update skills data in inventory manager
                    this.updateSkillsData(data.tp, data.skills);
                }
            },

            // Authoritative maze-loadout preset from the server (after it validated/
            // capped an edit against the collection). Apply unless a newer local edit
            // is still in flight, so capping corrections land without flickering.
            mazeLoadoutUpdated: (data: { mazeLoadout: (Item | null)[] | null }) => {
                if (!this.playerData) return;
                if (Date.now() - this.lastLocalLoadoutChange < this.LOADOUT_SYNC_SUPPRESS_MS) return;
                const src = data.mazeLoadout || [];
                const padded: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
                for (let i = 0; i < Math.min(src.length, this.LOADOUT_SLOTS); i++) {
                    if (src[i]) (src[i] as any).onCooldown = false;
                    padded[i] = src[i] || null;
                }
                this.playerData.mazeLoadout = padded;
                this.refreshForContext();
            },
        };

        for (const [event, handler] of Object.entries(this.skillsHandlers)) {
            this.socket.on(event, handler);
        }
    }

    private setupCraftingSocketListeners(): void {
        if (!this.socket) return;

        if (this.craftingHandlers) {
            for (const [event, handler] of Object.entries(this.craftingHandlers)) {
                this.socket.on(event, handler);
            }
            return;
        }

        this.craftingHandlers = {
        // Listen for crafting finished event
        craftingFinished: (data: { successCount: number; failCount: number; newItem: { type: string; rarity: string }; inventory: any; petalsReturned?: number }) => {
            console.log('[TitleScreen] craftingFinished received:', data);

            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
                // Re-deduct anything still staged in the craft slots — the
                // snapshot includes those copies (staging is client-side only).
                this.craftingInventoryManager.reconcileStagedWithInventory();
            }

            const itemKey = data.newItem.type;
            let itemType: Item['type'] = 'petal';
            let petalType: string | undefined;

            if (itemKey.startsWith('petal_')) {
                itemType = 'petal';
                petalType = itemKey.substring(6);
            } else {
                itemType = itemKey as Item['type'];
            }

            const displayItem: Item = {
                type: itemType,
                rarity: data.newItem.rarity as Item['rarity'],
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
        },

        // Listen for crafting failures. The panel is left mid-spin by the craft
        // click, so the rejection has to end the animation as well as report it
        // — otherwise the slots keep spinning until the panel is reopened.
        craftingFailed: (error: string) => {
            console.warn('[TitleScreen] craftingFailed:', error);
            this.craftingInventoryManager.handleCraftFailed();
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.updateInventoryDisplay();
            }
        },

        // Absorb tab results (petals → XP), mirroring the in-game handlers.
        itemsAbsorbed: (data: { xpGained: number; absorbedCount: number; inventory: any }) => {
            if (this.playerData && data.inventory) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
                this.craftingInventoryManager.reconcileStagedWithInventory();
            }
            this.craftingInventoryManager.handleItemsAbsorbed(data);
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.updateInventoryDisplay();
            }
        },

        absorbFailed: (data: { message?: string; inventory?: any }) => {
            if (this.playerData && data?.inventory) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
                this.craftingInventoryManager.reconcileStagedWithInventory();
            }
            this.craftingInventoryManager.handleAbsorbFailed();
            if (this.craftingInventoryManager.isCraftingOpen) {
                this.updateInventoryDisplay();
            }
        },

        // Listen for player updates to refresh inventory
        playerUpdated: (updatedPlayer: any) => {
            if (updatedPlayer.inventory) {
                if (this.playerData) {
                    this.playerData.inventory = updatedPlayer.inventory;
                    this.gameAdapter.setPlayerData(this.playerData);
                    this.craftingInventoryManager.reconcileStagedWithInventory();
                }
                if (this.craftingInventoryManager.isCraftingOpen) {
                    this.craftingInventoryManager.updateCraftingDisplay();
                    this.updateInventoryDisplay();
                }
            }
            if (this.playerData) {
                if (updatedPlayer.stars !== undefined) this.playerData.stars = updatedPlayer.stars;
                if (updatedPlayer.mobKills) this.playerData.mobKills = updatedPlayer.mobKills;
            }
        },
        };

        for (const [event, handler] of Object.entries(this.craftingHandlers)) {
            this.socket.on(event, handler);
        }
    }

    /** Re-bind to the current preconnected socket and re-authenticate to fetch fresh data. */
    public reauthenticate(): void {
        const socket = getPreconnectedSocket();
        if (socket) {
            // Re-install our handlers first — coming back from a game the socket
            // has been stripped bare (see rebindSocketListeners).
            this.rebindSocketListeners(socket);
            // Clear the one-shot flag so authenticate runs again
            if ((this.socket as any)._titleScreenAuthenticated) {
                (this.socket as any)._titleScreenAuthenticated = false;
            }
            this.isAuthenticated = false;
            void this.authenticateAndFetchData();
        }
    }

    private async authenticateAndFetchData(): Promise<void> {
        if (!this.socket || !this.socket.connected) return;

        // Get player name from localStorage or the name input element
        const nameInput = document.getElementById('nameInput') as HTMLInputElement;
        const playerName = (nameInput?.value || localStorage.getItem('playerName') || 'Unnamed');
        // This authentication is only a background data fetch for the title
        // screen — always use the neutral biome. The saved biome selection is
        // applied by the Game's own authenticate when the player clicks Ready.
        // Sending the sticky selection here put accounts into maze/PVP state
        // (maze: whole inventory displayed one rarity lower, super+ petals
        // silently unequipped) just for opening the page.
        const spawnBiome = 'default';

        // May await a first-load token exchange; the duplicate-auth flag below
        // is still checked and set in one synchronous step afterwards.
        // `lobby` is what keeps this a data fetch: the server loads the account
        // but does NOT put a flower in the world, so nothing spawns until the
        // Game re-authenticates without the flag on Ready.
        const auth = await getSocketAuth(playerName, spawnBiome, true);
        if (!auth || !this.socket?.connected) return;

        console.log('[TitleScreenInventory] Authenticating to fetch player data...');

        // Use a flag to prevent duplicate authentication
        if ((this.socket as any)._titleScreenAuthenticated) {
            console.log('[TitleScreenInventory] Already authenticated, skipping');
            return;
        }
        
        (this.socket as any)._titleScreenAuthenticated = true;
        
        this.socket.emit('authenticate', auth);

        // Listen for authentication response (use on instead of once to catch it if already sent)
        const authenticatedHandler = (response: { success: boolean; error?: string; player?: any }) => {
            if (response.success && response.player) {
                console.log('[TitleScreenInventory] Received player data:', response.player);
                this.isAuthenticated = true;
                // inventory may come as either a PlayerInventory array (triples
                // of [rarityId, itemId, count]) or a dict keyed by rarity.
                // Only run dictToInventory when it's a plain object.
                const rawInv = response.player.inventory;
                const normalizedInv = Array.isArray(rawInv)
                    ? rawInv
                    : (rawInv ? dictToInventory(rawInv) : []);
                const padLoadout = (a: any[]): (Item | null)[] => {
                    const o: any[] = new Array(20).fill(null);
                    for (let i = 0; i < Math.min((a || []).length, 20); i++) { if (a[i]) { a[i].onCooldown = false; } o[i] = a[i] || null; }
                    return o;
                };
                this.playerData = {
                    inventory: normalizedInv,
                    loadout: padLoadout(response.player.loadout || []),
                    // Separate maze loadout preset. undefined when never customised
                    // (getMazeLoadout then defaults it to a copy of the regular loadout).
                    mazeLoadout: Array.isArray(response.player.mazeLoadout)
                        ? padLoadout(response.player.mazeLoadout)
                        : undefined,
                    tp: response.player.tp,
                    skills: response.player.skills,
                    stars: response.player.stars || 0,
                    mobKills: response.player.mobKills || {}
                };
                console.log('[TitleScreenInventory] Normalized inventory, len=', normalizedInv.length, 'rawType=', Array.isArray(rawInv) ? 'array' : typeof rawInv);
                // Sync adapter so the real InventoryManager can access player data
                this.gameAdapter.setPlayerData(this.playerData);
                this.craftingInventoryManager.reconcileStagedWithInventory();
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
                if (this.socket && !(this.socket as any).username) {
                    const username = localStorage.getItem('username');
                    if (username) {
                        (this.socket as any).username = username;
                    }
                }
                
                // Loadout has loaded, notify title screen to stop showing connecting
                getTitleScreen()?.onLoadoutLoaded();
            }
        };
        
        // Check if already authenticated (socket might have authenticated before we set up listener)
        if ((this.socket as any)._authenticatedData) {
            authenticatedHandler((this.socket as any)._authenticatedData);
        } else {
            this.socket.on('authenticated', authenticatedHandler);
        }
    }

    private updateLoadoutDisplay(): void {
        // The title-screen loadout is now canvas-rendered and repaints every frame.
        // This method is kept as a no-op for existing callers.
        return;
    }

    
    

    
    /** True when the maze biome is selected — edits target the maze loadout preset. */
    private isMazeContext(): boolean {
        return (localStorage.getItem('spawnBiome') || 'default') === 'maze';
    }

    /** Inventory key for a loadout item (petal_<type> for petals, else the type). */
    private itemKey(item: Item | null): string | null {
        if (!item || !item.rarity) return null;
        if (item.type === 'petal') return item.petalType ? `petal_${item.petalType}` : null;
        return item.type;
    }

    /** Full owned collection = free inventory + everything equipped in the regular loadout. */
    private getCollection(): PlayerInventory {
        const inv: PlayerInventory = this.playerData?.inventory ? [...this.playerData.inventory] : [];
        for (const item of this.playerData?.loadout || []) {
            const key = this.itemKey(item);
            if (key && item!.rarity) codecAddItem(inv, item!.rarity, key, 1);
        }
        return inv;
    }

    /**
     * The maze loadout preset, lazily defaulted to a copy of the regular loadout
     * the first time it's needed (matches the server's default). Mutating the
     * returned array is fine — it IS playerData.mazeLoadout.
     */
    private getMazeLoadout(): (Item | null)[] {
        if (!this.playerData) return new Array(this.LOADOUT_SLOTS).fill(null);
        if (this.playerData.mazeLoadout === undefined) {
            const copy: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
            for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
                const it = this.playerData.loadout[i];
                copy[i] = it ? { ...it } : null;
            }
            this.playerData.mazeLoadout = copy;
        }
        return this.playerData.mazeLoadout;
    }

    /** The loadout being edited/displayed: the maze preset or the regular loadout. */
    private getActiveLoadout(): (Item | null)[] {
        return this.isMazeContext() ? this.getMazeLoadout() : (this.playerData?.loadout || []);
    }

    /**
     * Inventory view for the active context. Regular = the physical inventory.
     * Maze = collection − mazeLoadout: the maze preset is a shared preset that
     * doesn't consume from the inventory, so we derive the "available" view by
     * removing the preset's petals from the full collection.
     */
    private getActiveInventory(): PlayerInventory {
        if (!this.isMazeContext()) return this.playerData?.inventory || [];
        const inv = this.getCollection();
        for (const item of this.getMazeLoadout()) {
            const key = this.itemKey(item);
            if (key && item!.rarity) codecRemoveItem(inv, item!.rarity, key, 1);
        }
        return inv;
    }

    /**
     * Persist a loadout edit for the active context. Maze edits go to the
     * mazeLoadout preset (tagged context 'maze'; the server validates against the
     * collection and never touches the regular loadout/inventory). Regular edits
     * keep the existing physical model.
     */
    private commitLoadoutEdit(newLoadout: (Item | null)[]): void {
        if (!this.playerData) return;
        this.lastLocalLoadoutChange = Date.now();
        const emitReady = this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username;
        if (this.isMazeContext()) {
            this.playerData.mazeLoadout = newLoadout;
            if (emitReady) {
                this.socket.emit('updateLoadout', { loadout: newLoadout, inventory: [], inPvpArena: false, context: 'maze' });
            }
        } else {
            this.playerData.loadout = newLoadout;
            if (emitReady) {
                this.socket.emit('updateLoadout', { loadout: newLoadout, inventory: this.playerData.inventory, inPvpArena: false, context: 'regular' });
            }
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }

    /** Refresh loadout + inventory display when the selected biome changes. */
    public refreshForContext(): void {
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }

    private getItemCount(rarity: string, type: string): number {
        return codecGetItemCount(this.getActiveInventory(), rarity, type);
    }

    private removeItem(rarity: string, type: string, count: number): void {
        if (!this.playerData || !this.playerData.inventory) return;
        codecRemoveItem(this.playerData.inventory, rarity, type, count);
    }

    private addItem(rarity: string, type: string, count: number): void {
        if (!this.playerData || !this.playerData.inventory) return;
        codecAddItem(this.playerData.inventory, rarity, type, count);
    }

    private equipItemToLoadout(rarity: string, type: string, loadoutSlot: number): void {
        if (!this.playerData || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0) return;
        
        // Parse petal type if it's a petal
        let itemType: Item['type'];
        let petalType: string | undefined;
        
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6);
        } else {
            itemType = type as Item['type'];
        }
        
        const item: Item = { 
            type: itemType, 
            rarity: rarity as Item['rarity'],
            petalType: petalType
        };
        
        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = getPetalStats(petalType, rarity);
            if (stats) {
                item.health = stats.health;
                item.maxHealth = stats.health;
                item.onCooldown = false;
            }
        }
        
        // Pad the ACTIVE loadout (maze preset or regular) to full length.
        const activeLoadout = this.getActiveLoadout();
        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(activeLoadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = activeLoadout[i] || null;
        }

        // The regular loadout uses the physical inventory model (equip removes
        // from inventory, swap-out returns to it). The maze preset is a shared
        // preset: it doesn't consume from the inventory — the derived maze
        // inventory (collection − preset) reflects the change automatically.
        if (!this.isMazeContext()) {
            this.removeItem(rarity, type, 1);
            const existingItem = newLoadout[loadoutSlot];
            if (existingItem && existingItem.rarity) {
                const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
                this.addItem(existingItem.rarity, existingKey, 1);
            }
        }

        newLoadout[loadoutSlot] = item;
        this.commitLoadoutEdit(newLoadout);
    }

    private moveItemToInventory(loadoutSlot: number): void {
        if (!this.playerData) return;
        const activeLoadout = this.getActiveLoadout();
        if (loadoutSlot >= activeLoadout.length) return;

        const item = activeLoadout[loadoutSlot];
        if (!item || !item.rarity) return;

        // Regular: physically return the petal to the inventory. Maze: no-op —
        // the derived maze inventory reflects the freed preset slot.
        if (!this.isMazeContext()) {
            const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
            this.addItem(item.rarity, itemKey, 1);
        }

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(activeLoadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = activeLoadout[i] || null;
        }
        newLoadout[loadoutSlot] = null;
        this.commitLoadoutEdit(newLoadout);
    }

    private swapLoadoutItems(fromSlot: number, toSlot: number): void {
        if (!this.playerData) return;
        const activeLoadout = this.getActiveLoadout();

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(activeLoadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = activeLoadout[i] || null;
        }
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        // Swaps never change the inventory in either context.
        this.commitLoadoutEdit(newLoadout);
    }

    private createInventoryItemElement(rarity: string, type: string, count: number): HTMLElement | null {
        // Skip eggs on title screen
        if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) {
            return null;
        }
        const itemCount = typeof count === 'number' ? count : 0;
        if (itemCount <= 0) return null;

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
            if (!this.playerData) return;
            const loadout = this.getActiveLoadout();
            let emptySlot = -1;
            for (let i = 0; i < CANVAS_LOADOUT_SLOT_COUNT; i++) {
                if (!loadout[i]) { emptySlot = i; break; }
            }
            if (emptySlot >= 0) {
                this.equipItemToLoadout(rarity, type, emptySlot);
            }
        });

        if (type.startsWith('petal_')) {
            const petalType = type.replace('petal_', '');
            const stats = getPetalStats(petalType, rarity);
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
        } else {
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

        itemElement.appendChild(createCountLabel(itemCount));

        if (type.startsWith('petal_')) {
            const petalType = type.replace('petal_', '');
            appendPetalNameLabel(itemElement, petalType);

            this.setupTooltip(itemElement, petalType, rarity);
        }

        return itemElement;
    }

    private createRarityRow(rarity: string): { row: HTMLElement; grid: HTMLElement } {
        return createRarityRow(rarity);
    }

    private updateInventoryDisplay(): void {
        if (!this.inventoryPanel) return;

        // Canvas inventory re-renders from playerData every frame; nothing to push.
        if (this.canvasInventoryPanel) return;

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

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
        // Active inventory view: regular inventory, or (in maze context) the
        // collection minus the maze preset so equipped maze petals aren't shown.
        const invDict = inventoryToDict(this.getActiveInventory());

        // Build set of current item keys for removal detection
        const currentKeys = new Set<string>();
        for (const rarity in invDict) {
            for (const type in invDict[rarity]) {
                if (invDict[rarity][type] > 0) {
                    // Skip eggs
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) continue;
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
                    if (type.startsWith('petal_') && type.replace('petal_', '').endsWith('_egg')) return false;
                    return items[type] > 0;
                });

                if (hasItems) {
                    let rarityEntry = this.renderedRarityRows.get(rarity);
                    if (!rarityEntry) {
                        rarityEntry = this.createRarityRow(rarity);
                        this.renderedRarityRows.set(rarity, rarityEntry);
                        const rarityIndex = rarities.indexOf(rarity);
                        let insertBefore: HTMLElement | null = null;
                        for (let i = rarityIndex + 1; i < rarities.length; i++) {
                            const nextEntry = this.renderedRarityRows.get(rarities[i]);
                            if (nextEntry) { insertBefore = nextEntry.row; break; }
                        }
                        this.inventoryGridContainer!.insertBefore(rarityEntry.row, insertBefore);
                    }

                    Object.entries(items).forEach(([type, count]) => {
                        const key = `${rarity}:${type}`;
                        if (!currentKeys.has(key)) return;
                        const existing = this.renderedItems.get(key);
                        if (existing) {
                            if (existing.count !== count) {
                                const countLabel = existing.element.querySelector('.item-count');
                                if (countLabel) countLabel.textContent = count.toString();
                                existing.count = count;
                            }
                        } else {
                            const itemElement = this.createInventoryItemElement(rarity, type, count);
                            if (itemElement) {
                                rarityEntry!.grid.appendChild(itemElement);
                                this.renderedItems.set(key, { element: itemElement, count });
                            }
                        }
                    });
                } else {
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

    private darkenColor(hex: string, percent: number = 30): string {
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

    /** Shows the shared petal tooltip (graphics/tooltip.ts) next to an anchor
     *  rect, with this manager's skill-adjusted final stats. */
    private showPetalTooltip(anchor: TooltipAnchor, petalType: string, rarity: string): void {
        if (!this.playerData) return;
        showPetalTooltip(anchor, petalType, rarity, this.playerData.skills);
    }

    private hideTooltip(): void {
        this.tooltipTimeout = clearPetalTooltip(this.tooltipTimeout);
        this.hoveredElement = null;
    }

    private setupTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        let isDragging = false;
        let mouseDownTime = 0;

        const handleMouseEnter = () => {
            if (isDragging) return;
            this.hoveredElement = element;
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.hoveredElement === element && !isDragging) {
                    this.showPetalTooltip(element.getBoundingClientRect(), petalType, rarity);
                }
            }, 200);
        };

        const handleMouseLeave = () => {
            this.hideTooltip();
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
        element.addEventListener('mousedown', handleMouseDown);
        element.addEventListener('mouseup', handleMouseUp);
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragend', handleDragEnd);
    }

    public toggleInventory(): void {
        console.log('[TitleScreenInventory] toggleInventory called. playerData:', !!this.playerData, 'isAuthenticated:', this.isAuthenticated);

        // Reuse a stale panel from a previous game session if one exists, but
        // always strip its old DOM children so the canvas mounts cleanly.
        let inventoryPanel = document.getElementById('inventoryPanel') as HTMLDivElement;
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

            // Maze-aware adapter: the inventory panel shows the ACTIVE inventory
            // view (regular inventory, or collection − mazeLoadout in maze
            // context) so maze-equipped petals aren't double-shown and regular-
            // loadout petals appear available for the maze build. It reads
            // getLocalPlayer() every frame, so switching biome updates it live.
            // (The shared gameAdapter stays regular so crafting is unaffected.)
            const inventoryPanelAdapter = {
                getLocalPlayer: () => ({
                    inventory: this.getActiveInventory(),
                    loadout: this.getActiveLoadout(),
                }),
                getPetalCanvas: (pt: string, r: string, t?: number) => this.gameAdapter.getPetalCanvas(pt, r, t),
                getPetalStats: (pt: string, r: string) => this.gameAdapter.getPetalStats(pt, r),
                getItemSpriteDataUrl: (t: string) => this.gameAdapter.getItemSpriteDataUrl(t),
            };
            this.canvasInventoryPanel = new CanvasInventoryPanel(inventoryPanelAdapter as any);
            this.canvasInventoryPanel.attachTo(inventoryPanel);
            // Click (mouseup without drag) auto-equips to first empty loadout slot.
            this.canvasInventoryPanel.onItemClick = (rarity, itemType) => {
                if (!this.playerData) return;
                const activeLoadout = this.getActiveLoadout();
                let emptySlot = -1;
                for (let i = 0; i < CANVAS_LOADOUT_SLOT_COUNT; i++) {
                    if (!activeLoadout[i]) { emptySlot = i; break; }
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
                if (!e.dataTransfer) return;
                e.dataTransfer.setData('text/plain', JSON.stringify({ rarity, type: itemType }));
                e.dataTransfer.effectAllowed = 'move';
                this.setItemDragImage(e.dataTransfer, rarity, itemType);
            };
            this.canvasInventoryPanel.onItemHoverChange = (hit: InventoryHitInfo | null) => {
                this.handleCanvasInventoryHover(hit);
            };
            this.canvasInventoryPanel.onClose = () => this.toggleInventory();
        }

        const isOpen = inventoryPanel.style.display !== 'none' && inventoryPanel.style.display !== '';
        if (!isOpen) {
            inventoryPanel.style.display = 'flex';
            this.canvasInventoryPanel.start();
            setTimeout(() => inventoryPanel.classList.add('open'), 10);
        } else {
            inventoryPanel.classList.remove('open');
            this.canvasInventoryPanel.stop();
            setTimeout(() => { inventoryPanel.style.display = 'none'; }, 300);
        }
    }

    /** Tooltip hover bridge for the canvas inventory panel. */
    private handleCanvasInventoryHover(hit: InventoryHitInfo | null): void {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        hideTooltipOverlay();
        if (!hit || !hit.itemType.startsWith('petal_')) return;
        const petalType = hit.itemType.replace('petal_', '');
        const rarity = hit.rarity;
        const rect = hit.rect;
        this.tooltipTimeout = window.setTimeout(() => {
            this.showPetalTooltip(rect, petalType, rarity);
        }, 200);
    }

    public updateFromPlayerData(playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any }): void {
        // Preserve the separate maze loadout preset across regular-state syncs —
        // this incoming payload only carries the regular loadout/inventory.
        const preservedMazeLoadout = this.playerData?.mazeLoadout;
        // Suppress stale server-pushed loadout data while an optimistic edit is in flight
        if (this.playerData && Date.now() - this.lastLocalLoadoutChange < this.LOADOUT_SYNC_SUPPRESS_MS) {
            // Keep local loadout, merge other fields
            this.playerData = {
                ...playerData,
                loadout: this.playerData.loadout,
                inventory: this.playerData.inventory,
                mazeLoadout: preservedMazeLoadout,
            };
        } else {
            // Pad loadout to 20 slots so secondary row is always present
            const padded: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
            const src = playerData.loadout || [];
            for (let i = 0; i < Math.min(src.length, this.LOADOUT_SLOTS); i++) padded[i] = src[i] || null;
            this.playerData = { ...playerData, loadout: padded, mazeLoadout: preservedMazeLoadout };
        }
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
        // Update the game adapter and crafting display
        this.gameAdapter.setPlayerData(this.playerData);
        this.craftingInventoryManager.reconcileStagedWithInventory();
        if (this.craftingInventoryManager.isCraftingOpen) {
            this.craftingInventoryManager.updateCraftingDisplay();
        }
        
        // Loadout has loaded, notify title screen to stop showing connecting
        getTitleScreen()?.onLoadoutLoaded();
    }
    
    public updateSkillsData(tp: number, skills: { [key: string]: string }): void {
        // Update skills data in playerData
        if (this.playerData) {
            this.playerData.tp = tp;
            this.playerData.skills = skills;
        }
    }

    public toggleCrafting(): void {
        // Check if game is running - if so, use game's crafting
        const game = getCurrentGame();
        if (game?.inventoryManager) {
            game.inventoryManager.toggleCrafting();
            return;
        }

        // The craft result has to be able to get back to us — verify our
        // listeners are on the socket the request will leave through.
        this.ensureSocketBound();

        // Update adapter with current player data before toggling
        this.gameAdapter.setPlayerData(this.playerData);
        this.craftingInventoryManager.toggleCrafting();
    }

    public toggleSkills(): void {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
    }


}
