"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryManager = void 0;
class InventoryManager {
    constructor(game) {
        this.inventoryPanel = null;
        this.craftingPanel = null;
        this.craftingSlots = Array(4).fill(null).map((_, i) => ({ index: i, item: null }));
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        this.ITEM_RARITY_COLORS = {
            common: '#808080',
            uncommon: '#008000',
            rare: '#0000FF',
            epic: '#800080',
            legendary: '#FFA500',
            mythic: '#FF0000'
        };
        this.game = game;
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
        const craftingGrid = document.createElement('div');
        craftingGrid.className = 'crafting-grid';
        for (let i = 0; i < 4; i++) {
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
                const itemIndex = e.dataTransfer?.getData('text/plain');
                if (itemIndex) {
                    this.addItemToCraftingSlot(parseInt(itemIndex), i);
                }
            });
            craftingGrid.appendChild(slot);
        }
        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.addEventListener('click', () => this.craftItems());
        this.craftingPanel.appendChild(craftingGrid);
        this.craftingPanel.appendChild(craftButton);
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
            .crafting-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9);
                padding: 20px;
                border-radius: 10px;
                border: 2px solid #666;
                display: none;
                z-index: 1000;
            }
            .crafting-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin-bottom: 20px;
            }
            .crafting-slot {
                width: 60px;
                height: 60px;
                background: rgba(255, 255, 255, 0.1);
                border: 2px solid #666;
                border-radius: 5px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .crafting-slot.drag-over {
                border-color: #00ff00;
                background: rgba(0, 255, 0, 0.2);
            }
            .craft-button {
                width: 100%;
                padding: 10px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
            }
            .craft-button:hover {
                background: #45a049;
            }
            .craft-button:disabled {
                background: #666;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
        // Setup drag and drop
        this.setupDragAndDrop();
    }
    getLoadoutKeyBindings() {
        return this.LOADOUT_KEY_BINDINGS;
    }
    toggleInventory() {
        if (!this.inventoryPanel)
            return;
        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        }
        else {
            this.inventoryPanel.classList.remove('open');
            setTimeout(() => {
                if (this.inventoryPanel) {
                    this.inventoryPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isInventoryOpen = !isOpen;
    }
    toggleCrafting() {
        if (!this.craftingPanel)
            return;
        this.isCraftingOpen = !this.isCraftingOpen;
        this.craftingPanel.style.display = this.isCraftingOpen ? 'block' : 'none';
        if (this.isCraftingOpen) {
            this.updateCraftingDisplay();
        }
    }
    equipItemToLoadout(inventoryIndex, loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS)
            return;
        const item = player.inventory[inventoryIndex];
        if (!item)
            return;
        const newInventory = [...player.inventory];
        const newLoadout = [...player.loadout];
        newInventory.splice(inventoryIndex, 1);
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem) {
            newInventory.push(existingItem);
        }
        newLoadout[loadoutSlot] = item;
        player.inventory = newInventory;
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: newInventory
        });
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
            console.log('Equipped item, new loadout:', newLoadout.map(item => item ? item.type : null));
        });
    }
    useLoadoutItem(slot) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout[slot])
            return;
        const item = player.loadout[slot];
        if (item.onCooldown)
            return;
        this.game.getSocket()?.emit('useItem', item.id);
        const rarityMultipliers = {
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
                this.game.showFloatingText(player.x, player.y - 30, `+${Math.floor(50 * multiplier)} HP`, '#32CD32', 20);
                break;
            case 'speed_boost':
                this.game.showFloatingText(player.x, player.y - 30, `Speed Boost (${Math.floor(5 * multiplier)}s)`, '#4169E1', 20);
                break;
            case 'shield':
                this.game.showFloatingText(player.x, player.y - 30, `Shield (${Math.floor(3 * multiplier)}s)`, '#FFD700', 20);
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
    updateLoadoutDisplay() {
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
            const item = player.loadout[index];
            if (item) {
                const img = document.createElement('img');
                img.src = `./assets/${item.type}.png`;
                img.alt = item.type;
                img.style.width = '80%';
                img.style.height = '80%';
                img.style.objectFit = 'contain';
                slot.appendChild(img);
            }
            const keyText = document.createElement('div');
            keyText.className = 'key-binding';
            keyText.textContent = this.LOADOUT_KEY_BINDINGS[index];
            slot.appendChild(keyText);
        });
    }
    setupDragAndDrop() {
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragEvent = e;
            const target = e.target;
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
                    img.addEventListener('dragstart', (e) => {
                        const dragEvent = e;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer.effectAllowed = 'move';
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
            slot.dataset.slot = slotIndex.toString();
            slot.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragEvent = e;
                dragEvent.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.currentTarget.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const dragEvent = e;
                const target = e.currentTarget;
                target.classList.remove('drag-over');
                const inventoryIndex = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (inventoryIndex) {
                    const index = parseInt(inventoryIndex);
                    const slot = parseInt(target.dataset.slot || '-1');
                    if (index >= 0 && slot >= 0) {
                        this.equipItemToLoadout(index, slot);
                    }
                }
                else if (fromLoadoutSlot) {
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
                grid.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const dragEvent = e;
                    dragEvent.dataTransfer.dropEffect = 'move';
                    grid.classList.add('drag-over');
                });
                grid.addEventListener('dragleave', (e) => {
                    grid.classList.remove('drag-over');
                });
                grid.addEventListener('drop', (e) => {
                    e.preventDefault();
                    grid.classList.remove('drag-over');
                    const dragEvent = e;
                    const loadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                    if (loadoutSlot) {
                        this.moveItemToInventory(parseInt(loadoutSlot));
                    }
                });
            }
        }
    }
    swapLoadoutItems(fromSlot, toSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const newLoadout = [...player.loadout];
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        this.updateLoadoutDisplay();
    }
    updateInventoryDisplay() {
        if (!this.inventoryPanel)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        content.innerHTML = '';
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        const itemsByRarity = {
            mythic: [],
            legendary: [],
            epic: [],
            rare: [],
            uncommon: [],
            common: []
        };
        player.inventory.forEach(item => {
            const rarity = item.rarity || 'common';
            itemsByRarity[rarity].push(item);
        });
        const gridContainer = document.createElement('div');
        gridContainer.className = 'inventory-grid-container';
        gridContainer.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
      `;
        Object.entries(itemsByRarity).forEach(([rarity, items]) => {
            if (items.length > 0) {
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
                items.forEach(item => {
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
                        const index = player.inventory.findIndex(i => i.id === item.id);
                        e.dataTransfer?.setData('text/plain', index.toString());
                        itemElement.classList.add('dragging');
                    });
                    itemElement.addEventListener('dragend', () => {
                        itemElement.classList.remove('dragging');
                    });
                    const img = document.createElement('img');
                    img.src = `./assets/${item.type}.png`;
                    img.alt = item.type;
                    img.draggable = false;
                    img.style.cssText = `
                      width: 40px;
                      height: 40px;
                      object-fit: contain;
                  `;
                    itemElement.appendChild(img);
                    grid.appendChild(itemElement);
                });
                rarityRow.appendChild(grid);
                gridContainer.appendChild(rarityRow);
            }
        });
        content.appendChild(gridContainer);
    }
    moveItemToInventory(loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const item = player.loadout[loadoutSlot];
        if (!item)
            return;
        const newInventory = [...player.inventory];
        const newLoadout = [...player.loadout];
        newInventory.push(item);
        newLoadout[loadoutSlot] = null;
        player.inventory = newInventory;
        player.loadout = newLoadout;
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: newInventory
        });
        requestAnimationFrame(() => {
            this.updateInventoryDisplay();
            this.updateLoadoutDisplay();
        });
    }
    addItemToCraftingSlot(inventoryIndex, slotIndex) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const item = player.inventory[inventoryIndex];
        if (!item)
            return;
        if (this.craftingSlots[slotIndex].item) {
            return;
        }
        const existingItems = this.craftingSlots.filter(slot => slot.item !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0].item;
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity) {
                this.game.showFloatingText(this.game.canvas.width / 2, 50, 'Items must be of the same type and rarity!', '#FF0000', 20);
                return;
            }
        }
        this.craftingSlots[slotIndex].item = item;
        player.inventory.splice(inventoryIndex, 1);
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    craftItems() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (!this.craftingSlots.every(slot => slot.item !== null)) {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'All slots must be filled to craft!', '#FF0000', 20);
            return;
        }
        const craftingItems = this.craftingSlots
            .map(slot => slot.item)
            .filter((item) => item !== null);
        this.game.getSocket()?.emit('craftItems', { items: craftingItems });
        this.craftingSlots.forEach(slot => slot.item = null);
        this.updateCraftingDisplay();
    }
    updateCraftingDisplay() {
        const slots = document.querySelectorAll('.crafting-slot');
        slots.forEach((slot, index) => {
            slot.innerHTML = '';
            const craftingSlot = this.craftingSlots[index];
            if (craftingSlot.item) {
                const img = document.createElement('img');
                img.src = `./assets/${craftingSlot.item.type}.png`;
                img.alt = craftingSlot.item.type;
                img.style.width = '80%';
                img.style.height = '80%';
                img.style.objectFit = 'contain';
                if (craftingSlot.item.rarity) {
                    slot.style.borderColor = this.ITEM_RARITY_COLORS[craftingSlot.item.rarity];
                }
                slot.appendChild(img);
            }
            else {
                slot.style.borderColor = '#666';
            }
        });
    }
    cleanup() {
        if (this.inventoryPanel)
            this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel)
            this.craftingPanel.style.display = 'none';
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
}
exports.InventoryManager = InventoryManager;
