import { Item, ItemWithRarity } from './item';
import { Player, PlayerInventory } from './player';
import { Socket } from './socket';
import { getPetalStats } from './petals';
import { Chat } from './chat';

interface CraftingSlot {
    index: number;
    item: Item | null;
}

interface GameInterface {
    getLocalPlayer(): Player | undefined;
    getSocket(): Socket | undefined;
    showFloatingText(x: number, y: number, text: string, color: string, fontSize: number): void;
    canvas: HTMLCanvasElement;
}

export class InventoryManager {
    private game: GameInterface;
    private inventoryPanel: HTMLDivElement | null = null;
    private craftingPanel: HTMLDivElement | null = null;
    private craftingSlots: CraftingSlot[] = Array(5).fill(null).map((_, i) => ({ index: i, item: null }));
    private isInventoryOpen: boolean = false;
    private isCraftingOpen: boolean = false;
    private readonly LOADOUT_SLOTS = 10;
    private readonly LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    private chat: Chat | null = null;
    private readonly ITEM_RARITY_COLORS: Record<string, string> = {
        common: '#7eef6d',
        uncommon: '#ffe65d',
        rare: '#4d52e3',
        epic: '#861fde',
        legendary: '#de1f1f',
        mythic: '#1fdbde'
    };

    constructor(game: GameInterface,  chat: Chat | null) {
        this.game = game;
        this.chat = chat;

        // Create loadout bar
        const loadoutBar = document.createElement('div');
        loadoutBar.id = 'loadoutBar';
        loadoutBar.style.position = 'fixed';
        loadoutBar.style.bottom = '20px';
        loadoutBar.style.left = '50%';
        loadoutBar.style.transform = 'translateX(-50%)';
        loadoutBar.style.display = 'flex';
        loadoutBar.style.gap = '5px';
        loadoutBar.style.zIndex = '1000';

        for (let i = 0; i < this.LOADOUT_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'loadout-slot';
            slot.dataset.slot = i.toString();
            slot.style.width = '50px';
            slot.style.height = '50px';
            slot.style.backgroundColor = 'rgba(99, 255, 182, 1)';
            slot.style.border = '2px solid #00ba3e';
            slot.style.borderRadius = '5px';
            loadoutBar.appendChild(slot);
        }
        document.body.appendChild(loadoutBar);
        loadoutBar.style.backgroundColor = 'red'; // Debug: make background visible
        loadoutBar.style.opacity = '1'; // Debug: ensure not transparent
        loadoutBar.style.zIndex = '9999'; // Debug: bring to front

        // Create inventory panel
        this.inventoryPanel = document.createElement('div');
        this.inventoryPanel.id = 'inventoryPanel';
        this.inventoryPanel.className = 'inventory-panel';
        this.inventoryPanel.style.display = 'none';

        const inventoryContent = document.createElement('div');
        inventoryContent.className = 'inventory-content';
        this.inventoryPanel.appendChild(inventoryContent);
        document.body.appendChild(this.inventoryPanel);

        // Create crafting panel
        this.craftingPanel = document.createElement('div');
        this.craftingPanel.id = 'craftingPanel';
        this.craftingPanel.className = 'crafting-panel';
        this.craftingPanel.style.display = 'none';

        const craftingContent = document.createElement('div');
        craftingContent.className = 'crafting-content';

        const title = document.createElement('h2');
        title.textContent = 'Crafting';
        craftingContent.appendChild(title);

        const craftingGrid = document.createElement('div');
        craftingGrid.className = 'crafting-grid';

        for (let i = 0; i < 5; i++) {
            const slot = document.createElement('div');
            slot.className = 'crafting-slot';
            slot.dataset.index = i.toString();

            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                slot.classList.add('drag-over');
            });

            slot.addEventListener('dragleave', () => {
                slot.classList.remove('drag-over');
            });

            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
                const itemData = e.dataTransfer?.getData('text/plain');
                if (itemData) {
                    try {
                        const { rarity, type } = JSON.parse(itemData);
                        this.addItemToCraftingSlot(rarity, type, i);
                    } catch (error) {
                        console.error('Failed to parse item data for crafting', error);
                    }
                }
            });

            craftingGrid.appendChild(slot);
        }

        const successChance = document.createElement('div');
        successChance.className = 'success-chance';
        successChance.textContent = 'Success Chance: 0%';
        craftingContent.appendChild(successChance);

        const petalCount = document.createElement('div');
        petalCount.className = 'petal-count';
        petalCount.textContent = 'Petals: 0';
        craftingContent.appendChild(petalCount);

        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.addEventListener('click', () => this.craftItems());

        // Create inventory preview section
        const inventoryPreview = document.createElement('div');
        inventoryPreview.className = 'crafting-inventory-preview';
        
        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Inventory';
        inventoryPreview.appendChild(previewTitle);

        const inventoryGrid = document.createElement('div');
        inventoryGrid.className = 'crafting-inventory-grid';
        inventoryPreview.appendChild(inventoryGrid);

        craftingContent.appendChild(craftingGrid);
        craftingContent.appendChild(successChance);
        craftingContent.appendChild(craftButton);
        craftingContent.appendChild(inventoryPreview);

        this.craftingPanel.appendChild(craftingContent);
        document.body.appendChild(this.craftingPanel);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .loadout-slot.on-cooldown {
                position: relative;
                overflow: hidden;
            }
            .loadout-slot.on-cooldown::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                animation: cooldown 10s linear;
            }
            @keyframes cooldown {
                from { height: 100%; }
                to { height: 0%; }
            }
        `;
        document.head.appendChild(style);

        // Setup drag and drop
        this.setupDragAndDrop();
    }

    public getLoadoutKeyBindings() {
        return this.LOADOUT_KEY_BINDINGS;
    }

    private hideChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '0');
            this.chat.chatInput?.setAttribute('z-index', '0');
            this.chat.hide();
        }
    }

    private showChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '1000');
            this.chat.chatInput?.setAttribute('z-index', '1000');
            this.chat.show();
        }
    }

    public toggleInventory() {
        if (!this.inventoryPanel) return;

        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        } else {
            this.inventoryPanel.classList.remove('open');
            this.showChat();
            setTimeout(() => {
                if (this.inventoryPanel) {
                    this.inventoryPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isInventoryOpen = !isOpen;
    }

    public toggleCrafting() {
        if (!this.craftingPanel) return;

        const isOpen = this.craftingPanel.classList.contains('open');
        if (!isOpen) {
            this.craftingPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.craftingPanel?.classList.add('open');
            }, 10);
            this.updateCraftingDisplay();
        } else {
            this.craftingPanel.classList.remove('open');
            this.showChat();
            setTimeout(() => {
                if (this.craftingPanel) {
                    this.craftingPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isCraftingOpen = !isOpen;
    }

    public equipItemToLoadout(rarity: string, type: string, loadoutSlot: number) {
        const player = this.game.getLocalPlayer();
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0) return;

        // Parse petal type if it's a petal
        let itemType: Item['type'];
        let petalType: string | undefined;
        
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6); // Remove 'petal_' prefix
        } else {
            itemType = type as Item['type'];
        }

        const item: Item = { 
            type: itemType, 
            rarity: rarity as any,
            petalType: petalType
        };

        // Initialize health for petals
        if (itemType === 'petal' && petalType && rarity) {
            const stats = getPetalStats(petalType, rarity);
            if (stats) {
                item.health = stats.health;
                item.maxHealth = stats.health;
            }
        }

        const newInventory = { ...player.inventory };
        const newLoadout = [...player.loadout];

        this.removeItem(rarity, type, 1);

        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }

        newLoadout[loadoutSlot] = item;
        
        player.loadout = newLoadout;

        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });

        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
    }

    public useLoadoutItem(slot: number) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout[slot]) return;

        const item = player.loadout[slot] as ItemWithRarity;
        if ((item as any).onCooldown) return;

        // Petals cannot be used as consumables
        if (item.type === 'petal') {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                50,
                'Petals cannot be used - they provide passive protection!',
                '#FFA500',
                16
            );
            return;
        }

        this.game.getSocket()?.emit('useItem', { type: item.type, rarity: item.rarity });

        const rarityMultipliers: Record<string, number> = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;

        switch (item.type) {
            case 'health_potion':
                this.game.showFloatingText(
                    player.x,
                    player.y - 30,
                    `+${Math.floor(50 * multiplier)} HP`,
                    '#32CD32',
                    20
                );
                break;
            case 'speed_boost':
                this.game.showFloatingText(
                    player.x,
                    player.y - 30,
                    `Speed Boost (${Math.floor(5 * multiplier)}s)`,
                    '#4169E1',
                    20
                );
                break;
            case 'shield':
                this.game.showFloatingText(
                    player.x,
                    player.y - 30,
                    `Shield (${Math.floor(3 * multiplier)}s)`,
                    '#FFD700',
                    20
                );
                break;
        }

        const slot_element = document.querySelector(`.loadout-slot[data-slot="${slot}"]`);
        if (slot_element) {
            slot_element.classList.add('on-cooldown');
            const cooldownTime = 10000 * (1 / multiplier);
            setTimeout(() => {
                slot_element.classList.remove('on-cooldown');
            }, cooldownTime);
        }

        if (this.isInventoryOpen) {
            this.updateInventoryDisplay();
        }
        this.updateLoadoutDisplay();
    }

    public updateLoadoutDisplay() {
        const player = this.game.getLocalPlayer();
        if (!player) {
            console.warn('Player not yet initialized for loadout update');
            return;
        }
        console.log('Updating loadout display with loadout:', player.loadout.map(item => item ? item.type : null));

        const slots = document.querySelectorAll('.loadout-slot');
        console.log('Found ' + slots.length + ' loadout slots');
        slots.forEach((slot, index) => {
            slot.innerHTML = '';
            slot.classList.remove('on-cooldown', 'petal-slot');

            const item = player.loadout[index];
            if (item) {
                // Handle cooldown state
                if (item.onCooldown) {
                    slot.classList.add('on-cooldown');
                }

                // Handle different item types
                if (item.type === 'petal') {
                    slot.classList.add('petal-slot');
                    
                    // Create petal visual using SVG image
                    const petalDiv = document.createElement('div');
                    petalDiv.style.width = '80%';
                    petalDiv.style.height = '80%';
                    petalDiv.style.display = 'flex';
                    petalDiv.style.alignItems = 'center';
                    petalDiv.style.justifyContent = 'center';
                    
                    // Get petal SVG from stats
                    if (item.petalType && item.rarity) {
                        const stats = getPetalStats(item.petalType, item.rarity);
                        if (stats && stats.image) {
                            // Create an image element with the SVG data
                            const img = document.createElement('img');
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.objectFit = 'contain';
                            
                            // Convert SVG string to blob URL (same as graphics system)
                            const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            
                            petalDiv.appendChild(img);
                        } else {
                            // Fallback to colored circle
                            petalDiv.style.borderRadius = '50%';
                            petalDiv.style.border = '2px solid #000';
                            petalDiv.style.backgroundColor = '#90EE90'; // Default green
                        }
                    } else {
                        // Fallback to colored circle
                        petalDiv.style.borderRadius = '50%';
                        petalDiv.style.border = '2px solid #000';
                        petalDiv.style.backgroundColor = '#90EE90'; // Default green
                    }
                    
                    // Show health bar for petals
                    if (item.health !== undefined && item.maxHealth !== undefined && item.maxHealth > 0) {
                        const healthBar = document.createElement('div');
                        healthBar.style.position = 'absolute';
                        healthBar.style.bottom = '0';
                        healthBar.style.left = '0';
                        healthBar.style.width = '100%';
                        healthBar.style.height = '3px';
                        healthBar.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                        
                        const healthFill = document.createElement('div');
                        const healthPercentage = item.health / item.maxHealth;
                        healthFill.style.width = `${healthPercentage * 100}%`;
                        healthFill.style.height = '100%';
                        healthFill.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
                        
                        healthBar.appendChild(healthFill);
                        slot.appendChild(healthBar);
                    }
                    
                    slot.appendChild(petalDiv);
                } else {
                    // Regular items (health potion, speed boost, shield)
                    const img = document.createElement('img');
                    img.src = `./assets/${item.type}.png`;
                    img.alt = item.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            }

            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[index];
            slot.appendChild(keyText);
        });
    }

    private setupDragAndDrop() {
        document.addEventListener('dragover', (e: Event) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e: Event) => {
            e.preventDefault();
            const dragEvent = e as DragEvent;
            const target = e.target as HTMLElement;

            if (!target.closest('.loadout-slot') && !target.closest('.inventory-grid')) {
                const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (loadoutSlot) {
                    this.moveItemToInventory(parseInt(loadoutSlot));
                }
            }
        });

        const updateLoadoutDraggable = () => {
            const slots = document.querySelectorAll('.loadout-slot');
            slots.forEach((slot, slotIndex) => {
                const img = slot.querySelector('img');
                if (img) {
                    img.draggable = true;
                    img.addEventListener('dragstart', (e: Event) => {
                        const dragEvent = e as DragEvent;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer!.effectAllowed = 'move';
                    });
                }
            });
        };

        const originalUpdateLoadoutDisplay = this.updateLoadoutDisplay.bind(this);
        this.updateLoadoutDisplay = () => {
            originalUpdateLoadoutDisplay();
            updateLoadoutDraggable();
        };

        const slots = document.querySelectorAll('.loadout-slot');
        slots.forEach((slot, slotIndex) => {
            (slot as HTMLElement).dataset.slot = slotIndex.toString();

            slot.addEventListener('dragenter', (e: Event) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add('drag-over');
            });

            slot.addEventListener('dragover', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                dragEvent.dataTransfer!.dropEffect = 'move';
                (e.currentTarget as HTMLElement).classList.add('drag-over');
            });

            slot.addEventListener('dragleave', (e: Event) => {
                (e.currentTarget as HTMLElement).classList.remove('drag-over');
            });

            slot.addEventListener('drop', (e: Event) => {
                e.preventDefault();
                const dragEvent = e as DragEvent;
                const target = e.currentTarget as HTMLElement;
                target.classList.remove('drag-over');

                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');

                if (itemData) {
                    const { rarity, type } = JSON.parse(itemData);
                    const slot = parseInt(target.dataset.slot || '-1');
                    if (rarity && type && slot >= 0) {
                        this.equipItemToLoadout(rarity, type, slot);
                    }
                } else if (fromLoadoutSlot) {
                    const fromSlot = parseInt(fromLoadoutSlot);
                    const toSlot = slotIndex;
                    if (fromSlot !== toSlot) {
                        this.swapLoadoutItems(fromSlot, toSlot);
                    }
                }
            });
        });

        if (this.inventoryPanel) {
            const grid = this.inventoryPanel.querySelector('.inventory-grid');
            if (grid) {
                grid.addEventListener('dragover', (e: Event) => {
                    e.preventDefault();
                    const dragEvent = e as DragEvent;
                    dragEvent.dataTransfer!.dropEffect = 'move';
                    grid.classList.add('drag-over');
                });

                grid.addEventListener('dragleave', (e: Event) => {
                    grid.classList.remove('drag-over');
                });

                grid.addEventListener('drop', (e: Event) => {
                    e.preventDefault();
                    grid.classList.remove('drag-over');
                    const dragEvent = e as DragEvent;
                    const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                    if (loadoutSlot) {
                        this.moveItemToInventory(parseInt(loadoutSlot));
                    }
                });
            }
        }
    }

    public swapLoadoutItems(fromSlot: number, toSlot: number) {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        const newLoadout = [...player.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];

        player.loadout = newLoadout;

        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });

        this.updateLoadoutDisplay();
    }

    public updateInventoryDisplay() {
        if (!this.inventoryPanel) return;

        const player = this.game.getLocalPlayer();
        if (!player) return;

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

        content.innerHTML = '';

        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);

        const rarities = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;

        rarities.forEach(rarity => {
            const items = player.inventory[rarity];
            if (items && Object.keys(items).length > 0) {
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

                Object.entries(items).forEach(([type, count]) => {
                    const itemElement = document.createElement('div');
                    itemElement.className = 'inventory-item';
                    itemElement.draggable = true;

                    itemElement.style.cssText = `
                      position: relative;
                      width: 50px;
                      height: 50px;
                      background-color: ${this.ITEM_RARITY_COLORS[rarity]}20;
                      border: 2px solid ${this.ITEM_RARITY_COLORS[rarity]};
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

                    // Handle different item types for display
                    if (type.startsWith('petal_')) {
                        // Handle petal items with SVG
                        const petalType = type.replace('petal_', '');
                        const stats = getPetalStats(petalType, rarity);
                        if (stats && stats.image) {
                            const img = document.createElement('img');
                            img.alt = type;
                            img.draggable = false;
                            img.style.cssText = `
                              width: 40px;
                              height: 40px;
                              object-fit: contain;
                          `;
                            
                            // Convert SVG string to blob URL (same as loadout display)
                            const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            
                            itemElement.appendChild(img);
                        } else {
                            // Fallback to colored circle for petals
                            const fallbackDiv = document.createElement('div');
                            fallbackDiv.style.cssText = `
                              width: 40px;
                              height: 40px;
                              border-radius: 50%;
                              background-color: #90EE90;
                              border: 2px solid #000;
                          `;
                            itemElement.appendChild(fallbackDiv);
                        }
                    } else {
                        // Handle other items with PNG images
                        const img = document.createElement('img');
                        img.src = `./assets/${type}.png`;
                        img.alt = type;
                        img.draggable = false;
                        img.style.cssText = `
                          width: 40px;
                          height: 40px;
                          object-fit: contain;
                      `;

                        itemElement.appendChild(img);
                    }

                    const countLabel = document.createElement('div');
                    countLabel.className = 'item-count';
                    countLabel.textContent = count.toString();
                    countLabel.style.cssText = `
                        position: absolute;
                        bottom: 2px;
                        right: 4px;
                        color: white;
                        font-size: 14px;
                        font-weight: bold;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    `;
                    itemElement.appendChild(countLabel);

                    grid.appendChild(itemElement);
                });

                rarityRow.appendChild(grid);
                gridContainer.appendChild(rarityRow);
            }
        });

        content.appendChild(gridContainer);
    }

    public moveItemToInventory(loadoutSlot: number) {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        const item = player.loadout[loadoutSlot];
        if (!item || !item.rarity) return;
        
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        
        const newLoadout = [...player.loadout];
        newLoadout[loadoutSlot] = null;
        player.loadout = newLoadout;

        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });

        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
    }

    public addItemToCraftingSlot(rarity: string, type: string, slotIndex: number) {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        if (this.getItemCount(rarity, type) === 0) return;
        
        const item: Item = { type: type as any, rarity: rarity as any };
        
        if (this.craftingSlots[slotIndex].item) {
            return;
        }

        const existingItems = this.craftingSlots.filter(slot => slot.item !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0].item!;
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity) {
                this.game.showFloatingText(
                    this.game.canvas.width / 2,
                    50,
                    'Items must be of the same type and rarity!',
                    '#FF0000',
                    20
                );
                return;
            }
        }

        this.craftingSlots[slotIndex].item = item;

        this.removeItem(rarity, type, 1);

        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }

    public removeItemFromCraftingSlot(slotIndex: number) {
        const craftingSlot = this.craftingSlots[slotIndex];
        if (!craftingSlot.item) return;

        const player = this.game.getLocalPlayer();
        if (!player) return;

        // Return item to inventory
        if (craftingSlot.item.rarity && craftingSlot.item.type) {
            this.addItem(craftingSlot.item.rarity, craftingSlot.item.type, 1);
        }

        // Clear the crafting slot
        craftingSlot.item = null;

        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }

    public craftItems() {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        if (!this.craftingSlots.every(slot => slot.item !== null)) {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                50,
                'All slots must be filled to craft!',
                '#FF0000',
                20
            );
            return;
        }

        const craftingItems = this.craftingSlots
            .map(slot => slot.item)
            .filter((item): item is Item => item !== null);

        this.game.getSocket()?.emit('craftItems', { items: craftingItems });

        this.craftingSlots.forEach(slot => slot.item = null);
        this.updateCraftingDisplay();
    }

    public updateCraftingDisplay() {
        if (!this.craftingPanel) return;

        const player = this.game.getLocalPlayer();
        if (!player) return;

        // Update crafting slots
        const slots = document.querySelectorAll('.crafting-slot');
        slots.forEach((slot, index) => {
            slot.innerHTML = '';

            const craftingSlot = this.craftingSlots[index];
            if (craftingSlot.item) {
                // Handle different item types
                if (craftingSlot.item.type === 'petal') {
                    // Create petal visual using SVG image
                    const petalDiv = document.createElement('div');
                    petalDiv.style.width = '80%';
                    petalDiv.style.height = '80%';
                    petalDiv.style.display = 'flex';
                    petalDiv.style.alignItems = 'center';
                    petalDiv.style.justifyContent = 'center';
                    petalDiv.style.position = 'relative';
                    
                    // Get petal SVG from stats
                    if (craftingSlot.item.petalType && craftingSlot.item.rarity) {
                        const stats = getPetalStats(craftingSlot.item.petalType, craftingSlot.item.rarity);
                        if (stats && stats.image) {
                            // Create an image element with the SVG data
                            const img = document.createElement('img');
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.objectFit = 'contain';
                            
                            // Convert SVG string to blob URL (same as graphics system)
                            const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            
                            petalDiv.appendChild(img);
                        } else {
                            // Fallback to colored circle
                            petalDiv.style.borderRadius = '50%';
                            petalDiv.style.border = '2px solid #000';
                            petalDiv.style.backgroundColor = '#90EE90'; // Default green
                        }
                    } else {
                        // Fallback to colored circle
                        petalDiv.style.borderRadius = '50%';
                        petalDiv.style.border = '2px solid #000';
                        petalDiv.style.backgroundColor = '#90EE90'; // Default green
                    }

                    // Add remove button
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = '×';
                    removeBtn.style.position = 'absolute';
                    removeBtn.style.top = '-5px';
                    removeBtn.style.right = '-5px';
                    removeBtn.style.width = '20px';
                    removeBtn.style.height = '20px';
                    removeBtn.style.borderRadius = '50%';
                    removeBtn.style.border = 'none';
                    removeBtn.style.backgroundColor = '#ff4444';
                    removeBtn.style.color = 'white';
                    removeBtn.style.fontSize = '14px';
                    removeBtn.style.cursor = 'pointer';
                    removeBtn.style.display = 'flex';
                    removeBtn.style.alignItems = 'center';
                    removeBtn.style.justifyContent = 'center';
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.removeItemFromCraftingSlot(index);
                    });

                    petalDiv.appendChild(removeBtn);
                    slot.appendChild(petalDiv);
                } else {
                    // Handle other item types with PNG images
                    const img = document.createElement('img');
                    img.src = `./assets/${craftingSlot.item.type}.png`;
                    img.alt = craftingSlot.item.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    img.style.position = 'relative';

                    // Add remove button
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = '×';
                    removeBtn.style.position = 'absolute';
                    removeBtn.style.top = '-5px';
                    removeBtn.style.right = '-5px';
                    removeBtn.style.width = '20px';
                    removeBtn.style.height = '20px';
                    removeBtn.style.borderRadius = '50%';
                    removeBtn.style.border = 'none';
                    removeBtn.style.backgroundColor = '#ff4444';
                    removeBtn.style.color = 'white';
                    removeBtn.style.fontSize = '14px';
                    removeBtn.style.cursor = 'pointer';
                    removeBtn.style.display = 'flex';
                    removeBtn.style.alignItems = 'center';
                    removeBtn.style.justifyContent = 'center';
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.removeItemFromCraftingSlot(index);
                    });

                    slot.appendChild(img);
                    slot.appendChild(removeBtn);
                }

                if (craftingSlot.item.rarity) {
                    (slot as HTMLElement).style.borderColor = this.ITEM_RARITY_COLORS[craftingSlot.item.rarity];
                }
            } else {
                (slot as HTMLElement).style.borderColor = '#666';
            }
        });

        // Calculate and update success chance
        const successChance = this.calculateSuccessChance();
        const successElement = this.craftingPanel.querySelector('.success-chance');
        if (successElement) {
            successElement.textContent = `Success Chance: ${successChance}%`;
        }

        // Calculate and update petal count
        const petalCount = this.calculatePetalCount();
        const petalElement = this.craftingPanel.querySelector('.petal-count');
        if (petalElement) {
            petalElement.textContent = `Petals: ${petalCount}`;
        }

        // Update inventory preview
        this.updateCraftingInventoryPreview();
    }

    private calculateSuccessChance(): number {
        const items = this.craftingSlots
            .map(slot => slot.item)
            .filter((item): item is Item => item !== null);

        if (items.length === 0) return 0;

        // Group items by rarity
        const rarityCounts: Record<string, number> = {};
        items.forEach(item => {
            if (item.rarity) {
                rarityCounts[item.rarity] = (rarityCounts[item.rarity] || 0) + 1;
            }
        });

        // Calculate success chance based on rarity progression
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
        let baseChance = 64; // 64% for common->uncommon

        // Find the highest rarity in the crafting slots
        let highestRarityIndex = -1;
        for (const rarity of rarities) {
            if (rarityCounts[rarity] > 0) {
                highestRarityIndex = rarities.indexOf(rarity);
            }
        }

        if (highestRarityIndex === -1) return 0;

        // Halve the chance for each rarity level above common
        const chance = baseChance / Math.pow(2, highestRarityIndex);
        return Math.round(chance);
    }

    private calculatePetalCount(): number {
        const player = this.game.getLocalPlayer();
        if (!player) return 0;

        let totalPetals = 0;
        const petalRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
        
        petalRarities.forEach(rarity => {
            const petalCount = player.inventory[rarity]?.['petal'] || 0;
            totalPetals += petalCount;
        });

        return totalPetals;
    }

    private updateCraftingInventoryPreview() {
        const inventoryGrid = this.craftingPanel?.querySelector('.crafting-inventory-grid');
        if (!inventoryGrid) return;

        const player = this.game.getLocalPlayer();
        if (!player) return;

        inventoryGrid.innerHTML = '';

        const rarities = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

        rarities.forEach(rarity => {
            const rarityItems = player.inventory[rarity];
            if (rarityItems) {
                Object.entries(rarityItems).forEach(([itemType, count]) => {
                    if (count > 0) {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'crafting-inventory-item';
                        itemElement.draggable = true;
                        itemElement.dataset.rarity = rarity;
                        itemElement.dataset.type = itemType;
                        itemElement.dataset.count = count.toString();

                        // Create container for item display
                        const itemContainer = document.createElement('div');
                        itemContainer.style.position = 'relative';
                        itemContainer.style.width = '100%';
                        itemContainer.style.height = '100%';
                        itemContainer.style.display = 'flex';
                        itemContainer.style.flexDirection = 'column';
                        itemContainer.style.alignItems = 'center';
                        itemContainer.style.justifyContent = 'center';

                        // Handle different item types
                        if (itemType === 'petal') {
                            // Create petal visual using SVG image
                            const petalDiv = document.createElement('div');
                            petalDiv.style.width = '60%';
                            petalDiv.style.height = '60%';
                            petalDiv.style.display = 'flex';
                            petalDiv.style.alignItems = 'center';
                            petalDiv.style.justifyContent = 'center';
                            
                            // Get petal SVG from stats - need to determine petal type
                            const petalTypes = ['basic', 'rose', 'stinger'];
                            let petalStats = null;
                            let petalType = 'basic'; // default
                            
                            // Try to find the correct petal type
                            for (const type of petalTypes) {
                                const stats = getPetalStats(type, rarity);
                                if (stats) {
                                    petalStats = stats;
                                    petalType = type;
                                    break;
                                }
                            }
                            
                            if (petalStats && petalStats.image) {
                                // Create an image element with the SVG data
                                const img = document.createElement('img');
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'contain';
                                
                                // Convert SVG string to blob URL (same as graphics system)
                                const svgBlob = new Blob([petalStats.image], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(svgBlob);
                                img.src = url;
                                
                                petalDiv.appendChild(img);
                            } else {
                                // Fallback to colored circle
                                petalDiv.style.borderRadius = '50%';
                                petalDiv.style.border = '2px solid #000';
                                petalDiv.style.backgroundColor = '#90EE90'; // Default green
                            }
                            
                            itemContainer.appendChild(petalDiv);
                        } else {
                            // Handle other item types with PNG images
                            const img = document.createElement('img');
                            img.src = `./assets/${itemType}.png`;
                            img.alt = itemType;
                            img.style.width = '60%';
                            img.style.height = '60%';
                            img.style.objectFit = 'contain';
                            itemContainer.appendChild(img);
                        }

                        // Add count display
                        const countDisplay = document.createElement('div');
                        countDisplay.style.position = 'absolute';
                        countDisplay.style.top = '2px';
                        countDisplay.style.right = '2px';
                        countDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                        countDisplay.style.color = 'white';
                        countDisplay.style.fontSize = '10px';
                        countDisplay.style.padding = '1px 3px';
                        countDisplay.style.borderRadius = '3px';
                        countDisplay.style.fontWeight = 'bold';
                        countDisplay.textContent = count.toString();
                        itemContainer.appendChild(countDisplay);

                        // Add rarity indicator
                        const rarityDisplay = document.createElement('div');
                        rarityDisplay.style.position = 'absolute';
                        rarityDisplay.style.bottom = '2px';
                        rarityDisplay.style.left = '2px';
                        rarityDisplay.style.backgroundColor = this.ITEM_RARITY_COLORS[rarity] || '#666';
                        rarityDisplay.style.color = 'white';
                        rarityDisplay.style.fontSize = '8px';
                        rarityDisplay.style.padding = '1px 2px';
                        rarityDisplay.style.borderRadius = '2px';
                        rarityDisplay.style.fontWeight = 'bold';
                        rarityDisplay.textContent = rarity.charAt(0).toUpperCase();
                        itemContainer.appendChild(rarityDisplay);

                        itemElement.appendChild(itemContainer);

                        // Add drag event listeners
                        itemElement.addEventListener('dragstart', (e) => {
                            e.dataTransfer?.setData('text/plain', JSON.stringify({
                                rarity: rarity,
                                type: itemType,
                                count: count
                            }));
                        });

                        inventoryGrid.appendChild(itemElement);
                    }
                });
            }
        });
    }

    public cleanup() {
        if (this.inventoryPanel) this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel) this.craftingPanel.style.display = 'none';

        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.style.display = 'none';
            const slots = loadoutBar.querySelectorAll('.loadout-slot');
            slots.forEach(slot => {
                slot.innerHTML = '';
            });
        }

        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
    }

    private getItemCount(rarity: string, type: string): number {
        const player = this.game.getLocalPlayer();
        if (!player) return 0;
        return player.inventory[rarity]?.[type] || 0;
    }

    private addItem(rarity: string, type: string, count: number) {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        if (!player.inventory[rarity]) {
            player.inventory[rarity] = {};
        }
        if (!player.inventory[rarity][type]) {
            player.inventory[rarity][type] = 0;
        }
        player.inventory[rarity][type] += count;
    }

    private removeItem(rarity: string, type: string, count: number) {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        if (this.getItemCount(rarity, type) >= count) {
            player.inventory[rarity][type] -= count;
            if (player.inventory[rarity][type] === 0) {
                delete player.inventory[rarity][type];
                if (Object.keys(player.inventory[rarity]).length === 0) {
                    delete player.inventory[rarity];
                }
            }
        }
    }
}
