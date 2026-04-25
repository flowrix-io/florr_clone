import { getPetalStats, ITEM_RARITY_COLORS } from '../petals';
import { Item } from '../item';
import { PlayerInventory } from '../player';
import { InventoryManager } from '../inventory';
import { addItem as codecAddItem, removeItem as codecRemoveItem, getItemCount as codecGetItemCount, dictToInventory, inventoryToDict } from '../inventoryCodec';
import { CanvasLoadoutBar, LOADOUT_SLOT_COUNT as CANVAS_LOADOUT_SLOT_COUNT } from '../graphics/loadout-bar';
import { CanvasInventoryPanel, InventoryHitInfo } from '../graphics/inventory-panel';
import { TitleScreenGameAdapter } from './game_adapter';

/**
 * Title Screen Inventory Manager
 * Handles inventory and loadout on the title screen using the preconnected socket.
 * Crafting is delegated to a real InventoryManager instance.
 */
export class TitleScreenInventoryManager {
    private inventoryPanel: HTMLDivElement | null = null;
    private loadoutCanvas: HTMLCanvasElement | null = null;
    private canvasLoadoutBar: CanvasLoadoutBar | null = null;
    private loadoutRafId: number | null = null;
    /** source slot of an in-progress canvas-to-canvas drag, -1 if none */
    private canvasDragSourceSlot: number = -1;
    /** timestamp of last local loadout mutation for optimistic-update suppression */
    public lastLocalLoadoutChange: number = 0;
    public readonly LOADOUT_SYNC_SUPPRESS_MS: number = 600;
    private playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any; stars?: number; mobKills?: any } | null = null;
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
    private tooltipElement: HTMLDivElement | null = null;
    private tooltipTimeout: number | null = null;
    private hoveredElement: HTMLElement | null = null;
    /** Real InventoryManager used for crafting (uses the same code as in-game) */
    private gameAdapter: TitleScreenGameAdapter;
    public craftingInventoryManager: InventoryManager;

    constructor() {
        this.gameAdapter = new TitleScreenGameAdapter();
        this.craftingInventoryManager = new InventoryManager(this.gameAdapter, null, { craftingOnly: true });
        this.initializeLoadoutBar();
        this.setupSocketListeners();
        this.setupGlobalDragAndDrop();
        
        // Setup ALT key tracking for tooltip value display (only once globally)
        if (!(window as any).altKeyTrackingSetup) {
            (window as any).altKeyPressed = false;
            (window as any).altKeyTrackingSetup = true;
            (window as any).titleScreenInventoryManagers = [];
            document.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Alt') {
                    (window as any).altKeyPressed = true;
                    // Update all tooltips
                    const managers = (window as any).titleScreenInventoryManagers || [];
                    managers.forEach((manager: TitleScreenInventoryManager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(true);
                        }
                    });
                }
            });
            document.addEventListener('keyup', (e: KeyboardEvent) => {
                if (e.key === 'Alt') {
                    (window as any).altKeyPressed = false;
                    // Update all tooltips
                    const managers = (window as any).titleScreenInventoryManagers || [];
                    managers.forEach((manager: TitleScreenInventoryManager) => {
                        if (manager.tooltipElement) {
                            manager.updateTooltipValues(false);
                        }
                    });
                }
            });
        }
        // Register this instance
        if (!(window as any).titleScreenInventoryManagers) {
            (window as any).titleScreenInventoryManagers = [];
        }
        (window as any).titleScreenInventoryManagers.push(this);
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
            
            // If dropped outside loadout slots and inventory grid, move item back to inventory
            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid') && !target.closest('.crafting-inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });
    }

    private initializeLoadoutBar(): void {
        // The title-screen loadout is now a <canvas> that uses the same CanvasLoadoutBar
        // renderer as the in-game loadout.
        const canvas = document.getElementById('titleScreenLoadoutBar') as HTMLCanvasElement | null;
        if (!canvas) {
            setTimeout(() => this.initializeLoadoutBar(), 100);
            return;
        }
        this.loadoutCanvas = canvas;

        // Hand CanvasLoadoutBar a minimal "game" adapter that exposes player data and sprites.
        const adapter = {
            canvas,
            getLocalPlayer: () => ({
                loadout: this.playerData?.loadout ?? new Array(this.LOADOUT_SLOTS).fill(null)
            }),
            getPetalCanvas: (petalType: string, rarity: string, _time?: number): HTMLCanvasElement | null => {
                const assets = (window as any).preloadedAssets;
                if (!assets || !assets.petalImages) return null;
                const entry = assets.petalImages[`${petalType}_${rarity}`];
                if (!entry) return null;
                if (Array.isArray(entry)) {
                    const frameIndex = Math.floor((Date.now() / 42) % entry.length);
                    return entry[frameIndex];
                }
                return entry;
            },
            getItemSpriteDataUrl: (itemType: string): string | null => {
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
                } catch { return null; }
            },
            inventoryManager: this as any,
        };
        this.canvasLoadoutBar = new CanvasLoadoutBar(adapter);
        this.canvasLoadoutBar.show();

        // RAF loop to keep the bar painted (cheap: returns early when hidden)
        const ctx = canvas.getContext('2d');
        console.log('[TitleScreen] initializeLoadoutBar: canvas found, ctx=', !!ctx, 'bar=', !!this.canvasLoadoutBar);
        const frame = () => {
            if (ctx && this.canvasLoadoutBar) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                this.canvasLoadoutBar.draw(ctx);
            }
            this.loadoutRafId = requestAnimationFrame(frame);
        };
        if (this.loadoutRafId == null) this.loadoutRafId = requestAnimationFrame(frame);

        this.setupCanvasLoadoutInteractions(canvas);
    }

    private setupCanvasLoadoutInteractions(canvas: HTMLCanvasElement): void {
        const getLocalXY = (e: MouseEvent | DragEvent) => {
            const r = canvas.getBoundingClientRect();
            // Map CSS pixels back to canvas internal resolution
            const sx = (e.clientX - r.left) * (canvas.width / r.width);
            const sy = (e.clientY - r.top) * (canvas.height / r.height);
            return { x: sx, y: sy };
        };

        // Hover tracking
        canvas.addEventListener('mousemove', (e) => {
            if (!this.canvasLoadoutBar) return;
            const { x, y } = getLocalXY(e);
            this.canvasLoadoutBar.setHover(x, y);
            if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                this.canvasLoadoutBar.setDragPos(x, y);
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (this.canvasLoadoutBar) this.canvasLoadoutBar.setHover(-1, -1);
        });

        // Start drag from a filled canvas slot — uses HTML5 DataTransfer so it can be
        // dropped onto the existing DOM inventory grid.
        canvas.draggable = true;
        canvas.addEventListener('dragstart', (e: DragEvent) => {
            if (!this.canvasLoadoutBar || !this.playerData) { e.preventDefault(); return; }
            const { x, y } = getLocalXY(e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);
            if (hit < 0 || hit >= this.LOADOUT_SLOTS) { e.preventDefault(); return; }
            const item = this.playerData.loadout[hit];
            if (!item) { e.preventDefault(); return; }
            this.canvasDragSourceSlot = hit;
            this.canvasLoadoutBar.beginDrag(hit, x, y);
            e.dataTransfer?.setData('text/loadoutSlot', hit.toString());
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            // Render the dragged petal onto a small offscreen canvas and use it as the drag image
            // (some browsers render a URL icon for blank canvas drag images).
            if (e.dataTransfer && item.type === 'petal' && item.petalType && item.rarity) {
                const gs = 40;
                const ghost = document.createElement('canvas');
                ghost.width = gs; ghost.height = gs;
                // Force CSS size to match internal resolution so the browser doesn't scale it up
                ghost.style.width = `${gs}px`;
                ghost.style.height = `${gs}px`;
                ghost.style.position = 'fixed';
                ghost.style.top = '-1000px';
                ghost.style.left = '-1000px';
                document.body.appendChild(ghost);
                const gctx = ghost.getContext('2d');
                const assets = (window as any).preloadedAssets;
                const entry = assets?.petalImages?.[`${item.petalType}_${item.rarity}`];
                const petalCanvas = Array.isArray(entry)
                    ? entry[Math.floor(Date.now() / 42) % entry.length]
                    : entry;
                if (gctx && petalCanvas) {
                    gctx.drawImage(petalCanvas, 0, 0, gs, gs);
                }
                e.dataTransfer.setDragImage(ghost, gs / 2, gs / 2);
                requestAnimationFrame(() => ghost.remove());
            } else {
                // Fallback: a 1x1 transparent image
                const img = new Image();
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                e.dataTransfer?.setDragImage(img, 0, 0);
            }
        });
        canvas.addEventListener('dragend', () => {
            this.canvasDragSourceSlot = -1;
            this.canvasLoadoutBar?.endDrag();
        });

        // Accept drops from the inventory grid OR from other canvas slots
        canvas.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            if (this.canvasLoadoutBar) {
                const { x, y } = getLocalXY(e);
                this.canvasLoadoutBar.setHover(x, y);
                if (this.canvasLoadoutBar.draggingSlotIndex >= 0) {
                    this.canvasLoadoutBar.setDragPos(x, y);
                }
            }
        });
        canvas.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            if (!this.canvasLoadoutBar) return;
            const { x, y } = getLocalXY(e);
            const hit = this.canvasLoadoutBar.hitTest(x, y);

            const itemData = e.dataTransfer?.getData('text/plain');
            const fromLoadoutSlot = e.dataTransfer?.getData('text/loadoutSlot');

            if (hit === CANVAS_LOADOUT_SLOT_COUNT) {
                // Dropped on trash
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
            this.canvasDragSourceSlot = -1;
        });
    }

    private setupSocketListeners(): void {
        // Check for preconnected socket and authenticate early to get player data
        if (window.preconnectedSocket && window.preconnectedSocket.connected) {
            this.socket = window.preconnectedSocket;
            this.authenticateAndFetchData();
            this.setupCraftingSocketListeners();
            this.setupSkillsSocketListeners();
        } else {
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

    private setupSkillsSocketListeners(): void {
        if (!this.socket) return;
        
        // Listen for skills updates - this will be handled by index.ts which has access to titleScreen
        // We just update our local skills data here
        this.socket.on('skillsUpdated', (data: { playerId: string; tp: number; skills: { [key: string]: string } }) => {
            console.log('[TitleScreenInventory] skillsUpdated received:', data);
            // Check if this is for the current player
            if (data.playerId === this.socket.id) {
                // Update skills data in inventory manager
                this.updateSkillsData(data.tp, data.skills);
            }
        });
    }

    private setupCraftingSocketListeners(): void {
        if (!this.socket) return;

        // Listen for crafting finished event
        this.socket.on('craftingFinished', (data: { successCount: number; failCount: number; newItem: { type: string; rarity: string }; inventory: any; petalsReturned?: number }) => {
            console.log('[TitleScreen] craftingFinished received:', data);

            // Update inventory
            if (this.playerData) {
                this.playerData.inventory = data.inventory;
                this.gameAdapter.setPlayerData(this.playerData);
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
        });

        // Listen for crafting failures
        this.socket.on('craftingFailed', (error: string) => {
            alert(error);
        });

        // Listen for player updates to refresh inventory
        this.socket.on('playerUpdated', (updatedPlayer: any) => {
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
                if (updatedPlayer.stars !== undefined) this.playerData.stars = updatedPlayer.stars;
                if (updatedPlayer.mobKills) this.playerData.mobKills = updatedPlayer.mobKills;
            }
        });
    }

    /** Re-bind to the current preconnected socket and re-authenticate to fetch fresh data. */
    public reauthenticate(): void {
        if (window.preconnectedSocket) {
            this.socket = window.preconnectedSocket;
            // Clear the one-shot flag so authenticate runs again
            if ((this.socket as any)._titleScreenAuthenticated) {
                (this.socket as any)._titleScreenAuthenticated = false;
            }
            this.isAuthenticated = false;
            this.authenticateAndFetchData();
        }
    }

    private authenticateAndFetchData(): void {
        if (!this.socket || !this.socket.connected) return;

        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        // Get player name from localStorage or the name input element
        const nameInput = document.getElementById('nameInput') as HTMLInputElement;
        const playerName = (nameInput?.value || localStorage.getItem('playerName') || 'Unnamed');
        const spawnBiome = localStorage.getItem('spawnBiome') || 'default';

        if (!username || !password) return;

        console.log('[TitleScreenInventory] Authenticating to fetch player data...');
        
        // Authenticate to get player data (this will spawn on server but we won't show game until Ready)
        // Use a flag to prevent duplicate authentication
        if ((this.socket as any)._titleScreenAuthenticated) {
            console.log('[TitleScreenInventory] Already authenticated, skipping');
            return;
        }
        
        (this.socket as any)._titleScreenAuthenticated = true;
        
        this.socket.emit('authenticate', {
            username,
            password,
            playerName,
            spawnBiome
        });

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
                this.playerData = {
                    inventory: normalizedInv,
                    loadout: (() => { const a = response.player.loadout || []; const o: any[] = new Array(20).fill(null); for (let i = 0; i < Math.min(a.length, 20); i++) { if (a[i]) { a[i].onCooldown = false; } o[i] = a[i] || null; } return o; })(),
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
                if (this.socket && !(this.socket as any).username) {
                    const username = localStorage.getItem('username');
                    if (username) {
                        (this.socket as any).username = username;
                    }
                }
                
                // Loadout has loaded, notify title screen to stop showing connecting
                if ((window as any).titleScreen) {
                    (window as any).titleScreen.onLoadoutLoaded();
                }
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

    
    private formatPetalName(petalType: string): string {
        if (!petalType) return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }
    

    
    private getItemCount(rarity: string, type: string): number {
        if (!this.playerData || !this.playerData.inventory) return 0;
        return codecGetItemCount(this.playerData.inventory, rarity, type);
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
        
        // Pad to full loadout length so secondary-row writes are preserved
        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
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
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (equipItemToLoadout):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    
    private moveItemToInventory(loadoutSlot: number): void {
        if (!this.playerData || loadoutSlot >= this.playerData.loadout.length) return;
        
        const item = this.playerData.loadout[loadoutSlot];
        if (!item || !item.rarity) return;
        
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        newLoadout[loadoutSlot] = null;
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (moveItemToInventory):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
        if (this.inventoryPanel && this.inventoryPanel.style.display === 'block') {
            this.updateInventoryDisplay();
        }
    }
    
    private swapLoadoutItems(fromSlot: number, toSlot: number): void {
        if (!this.playerData) return;

        const newLoadout: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(this.playerData.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = this.playerData.loadout[i] || null;
        }
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        this.playerData.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        
        // Emit to server - ensure socket is authenticated and player exists
        if (this.socket && this.socket.connected && this.isAuthenticated && (this.socket as any).username) {
            console.log('[TitleScreen] Emitting updateLoadout (swapLoadoutItems):', { 
                socketId: this.socket.id,
                loadout: newLoadout, 
                inventory: this.playerData.inventory 
            });
            this.socket.emit('updateLoadout', {
                loadout: newLoadout,
                inventory: this.playerData.inventory
            });
        } else {
            console.warn('[TitleScreen] Cannot emit updateLoadout - socket not ready:', {
                hasSocket: !!this.socket,
                connected: this.socket?.connected,
                authenticated: this.isAuthenticated,
                hasUsername: !!(this.socket as any)?.username,
                socketId: this.socket?.id
            });
        }
        
        this.updateLoadoutDisplay();
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
            const loadout = this.playerData.loadout;
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

    private createRarityRow(rarity: string): { row: HTMLElement; grid: HTMLElement } {
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
        const invDict = this.playerData?.inventory ? inventoryToDict(this.playerData.inventory) : {};

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

    private getSkillMultiplier(skillTier: string | undefined): number {
        if (!skillTier) return 1.0;
        const SKILL_MULTIPLIERS: Record<string, number> = {
            common: 1.0,
            uncommon: 1.1,
            rare: 1.2,
            epic: 1.35,
            legendary: 1.6,
            mythic: 2.0,
            ultra: 2.6,
            super: 3.3,
            unique: 4.0
        };
        return SKILL_MULTIPLIERS[skillTier] || 1.0;
    }

    private abbreviateNumber(value: number): string {
        if (value < 1000) {
            return value.toString();
        } else if (value < 1000000) {
            const k = value / 1000;
            return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
        } else if (value < 1000000000) {
            const m = value / 1000000;
            return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
        } else {
            const b = value / 1000000000;
            return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
        }
    }

    private calculateFinalPetalDamage(petalType: string, rarity: string): number {
        if (!this.playerData) return 0;
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;
        const baseDamage = stats.damage;
        const damageSkillMultiplier = this.getSkillMultiplier(this.playerData.skills?.damage);
        return Math.round(baseDamage * damageSkillMultiplier);
    }

    private calculateFinalPetalHealth(petalType: string, rarity: string): number {
        if (!this.playerData) return 0;
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;
        const baseHealth = stats.health;
        const petalHealthMultiplier = this.getSkillMultiplier(this.playerData.skills?.petalHealth);
        return Math.round(baseHealth * petalHealthMultiplier);
    }

    private showTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return;

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

    private updateTooltipPosition(element: HTMLElement, tooltip: HTMLDivElement): void {
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

    private hideTooltip(): void {
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

    private updateTooltipValues(showFull: boolean): void {
        if (!this.tooltipElement) return;

        const valueElements = this.tooltipElement.querySelectorAll('.tooltip-value');
        valueElements.forEach((valueEl) => {
            const parent = valueEl.parentElement;
            if (parent && parent.hasAttribute('data-full-value')) {
                const fullValue = parent.getAttribute('data-full-value');
                if (fullValue) {
                    if (showFull) {
                        valueEl.textContent = fullValue;
                    } else {
                        valueEl.textContent = this.abbreviateNumber(parseInt(fullValue));
                    }
                }
            }
        });
    }

    private setupTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        let isDragging = false;
        let mouseDownTime = 0;

        const handleMouseEnter = () => {
            if (isDragging) return;
            this.hoveredElement = element;
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.hoveredElement === element && !isDragging) {
                    this.showTooltip(element, petalType, rarity);
                    // Check initial ALT state
                    this.updateTooltipValues((window as any).altKeyPressed || false);
                }
            }, 200);
        };

        const handleMouseLeave = () => {
            this.hideTooltip();
        };

        const handleMouseMove = (e: MouseEvent) => {
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

            this.canvasInventoryPanel = new CanvasInventoryPanel(this.gameAdapter as any);
            this.canvasInventoryPanel.attachTo(inventoryPanel);
            this.canvasInventoryPanel.onItemMouseDown = (rarity, itemType) => {
                if (!this.playerData) return;
                let emptySlot = -1;
                for (let i = 0; i < CANVAS_LOADOUT_SLOT_COUNT; i++) {
                    if (!this.playerData.loadout[i]) { emptySlot = i; break; }
                }
                if (emptySlot >= 0) {
                    this.equipItemToLoadout(rarity, itemType, emptySlot);
                }
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
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        if (!hit || !hit.itemType.startsWith('petal_')) return;
        const petalType = hit.itemType.replace('petal_', '');
        const rarity = hit.rarity;
        const rect = hit.rect;
        this.tooltipTimeout = window.setTimeout(() => {
            this.showTooltipAtRect(rect, petalType, rarity);
            this.updateTooltipValues((window as any).altKeyPressed || false);
        }, 200);
    }

    /** Like showTooltip() but anchored to a client-space rect (canvas hit). */
    private showTooltipAtRect(
        rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
        petalType: string,
        rarity: string
    ): void {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return;
        if (this.tooltipElement) { this.tooltipElement.remove(); this.tooltipElement = null; }

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
        if (left + tooltipRect.width > window.innerWidth) left = rect.left - tooltipRect.width - 10;
        if (top + tooltipRect.height > window.innerHeight) top = window.innerHeight - tooltipRect.height - 10;
        if (top < 0) top = 10;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    public updateFromPlayerData(playerData: { inventory: PlayerInventory; loadout: (Item | null)[]; tp?: number; skills?: any }): void {
        // Suppress stale server-pushed loadout data while an optimistic edit is in flight
        if (this.playerData && Date.now() - this.lastLocalLoadoutChange < this.LOADOUT_SYNC_SUPPRESS_MS) {
            // Keep local loadout, merge other fields
            this.playerData = {
                ...playerData,
                loadout: this.playerData.loadout,
                inventory: this.playerData.inventory,
            };
        } else {
            // Pad loadout to 20 slots so secondary row is always present
            const padded: (Item | null)[] = new Array(this.LOADOUT_SLOTS).fill(null);
            const src = playerData.loadout || [];
            for (let i = 0; i < Math.min(src.length, this.LOADOUT_SLOTS); i++) padded[i] = src[i] || null;
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
        if ((window as any).titleScreen) {
            (window as any).titleScreen.onLoadoutLoaded();
        }
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
        if (window.currentGame && (window.currentGame as any).inventoryManager) {
            (window.currentGame as any).inventoryManager.toggleCrafting();
            return;
        }

        // Update adapter with current player data before toggling
        this.gameAdapter.setPlayerData(this.playerData);
        this.craftingInventoryManager.toggleCrafting();
    }

    public toggleSkills(): void {
        // This is now handled by TitleScreen.toggleSkillsOnTitleScreen()
        // This method is kept for compatibility but shouldn't be called directly
    }


}
