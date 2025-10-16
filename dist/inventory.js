"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryManager = void 0;
const petals_1 = require("./petals");
class InventoryManager {
    constructor(game, chat) {
        this.inventoryPanel = null;
        this.craftingPanel = null;
        this.craftingItems = [];
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.LOADOUT_SLOTS = 10;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        this.chat = null;
        this.ITEM_RARITY_COLORS = {
            common: '#7eef6d',
            uncommon: '#ffe65d',
            rare: '#4d52e3',
            epic: '#861fde',
            legendary: '#de1f1f',
            mythic: '#1fdbde',
            ultra: '#de1f65',
            super: '#2bffa4',
            unique: '#bf00ff'
        };
        this.game = game;
        this.chat = chat;
        this.allPetalTypes = (0, petals_1.getAllPetalTypes)();
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
        const craftingMain = document.createElement('div');
        craftingMain.className = 'crafting-main';
        craftingMain.style.flex = '0 0 50%';
        const craftingCircleContainer = document.createElement('div');
        craftingCircleContainer.className = 'crafting-circle-container';
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement('div');
            slot.className = 'crafting-slot';
            slot.dataset.index = i.toString();
            craftingCircleContainer.appendChild(slot);
        }
        const multiplierText = document.createElement('div');
        multiplierText.className = 'crafting-multiplier';
        craftingCircleContainer.appendChild(multiplierText);
        craftingMain.appendChild(craftingCircleContainer);
        const craftingActions = document.createElement('div');
        craftingActions.className = 'crafting-actions';
        const craftButton = document.createElement('button');
        craftButton.className = 'craft-button';
        craftButton.textContent = 'Craft';
        craftButton.addEventListener('click', () => this.craftItems());
        craftingActions.appendChild(craftButton);
        const successChance = document.createElement('div');
        successChance.className = 'success-chance';
        successChance.textContent = 'Success Chance: 0%';
        craftingActions.appendChild(successChance);
        craftingMain.appendChild(craftingActions);
        craftingContent.appendChild(craftingMain);
        // Create inventory preview section
        const inventoryPreview = document.createElement('div');
        inventoryPreview.className = 'crafting-inventory-preview';
        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Inventory';
        inventoryPreview.appendChild(previewTitle);
        const inventoryGrid = document.createElement('div');
        inventoryGrid.className = 'crafting-inventory-grid';
        inventoryPreview.appendChild(inventoryGrid);
        craftingContent.appendChild(inventoryPreview);
        this.craftingPanel.appendChild(craftingContent);
        document.body.appendChild(this.craftingPanel);
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .crafting-main {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
                margin-bottom: 15px;
                max-height: none;
            }
            .crafting-circle-container {
                position: relative;
                width: 180px;
                height: 180px;
                flex-shrink: 0;
            }
            .crafting-slot {
                width: 40px;
                height: 40px;
                position: absolute;
                cursor: pointer !important;
                user-select: none;
            }
            .crafting-multiplier {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 24px;
                font-weight: bold;
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                display: none;
            }
            .crafting-actions {
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex-shrink: 0;
            }
            .crafting-inventory-preview {
                margin-top: 15px;
                border-top: 2px solid #444;
                padding-top: 10px;
                flex: 1 1 auto;
                overflow-y: auto;
            }
            .crafting-slot {
                cursor: pointer !important;
                user-select: none;
            }
            .crafting-slot img {
                pointer-events: none;
            }
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
    getLoadoutKeyBindings() {
        return this.LOADOUT_KEY_BINDINGS;
    }
    hideChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '0');
            this.chat.chatInput?.setAttribute('z-index', '0');
            this.chat.hide();
        }
    }
    showChat() {
        if (this.chat?.chatContainer) {
            this.chat.chatContainer.setAttribute('z-index', '1000');
            this.chat.chatInput?.setAttribute('z-index', '1000');
            this.chat.show();
        }
    }
    toggleInventory() {
        if (!this.inventoryPanel)
            return;
        const isOpen = this.inventoryPanel.style.display === 'block';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.updateInventoryDisplay();
        }
        else {
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
    toggleCrafting() {
        if (!this.craftingPanel)
            return;
        const isOpen = this.craftingPanel.classList.contains('open');
        if (!isOpen) {
            this.craftingPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.craftingPanel?.classList.add('open');
            }, 10);
            this.updateCraftingDisplay();
        }
        else {
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
    equipItemToLoadout(rarity, type, loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player || loadoutSlot >= this.LOADOUT_SLOTS || this.getItemCount(rarity, type) === 0)
            return;
        // Parse petal type if it's a petal
        let itemType;
        let petalType;
        if (type.startsWith('petal_')) {
            itemType = 'petal';
            petalType = type.substring(6); // Remove 'petal_' prefix
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
    useLoadoutItem(slot) {
        const player = this.game.getLocalPlayer();
        if (!player || !player.loadout[slot])
            return;
        const item = player.loadout[slot];
        if (item.onCooldown)
            return;
        // Petals cannot be used as consumables
        if (item.type === 'petal') {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'Petals cannot be used - they provide passive protection!', '#FFA500', 16);
            return;
        }
        this.game.getSocket()?.emit('useItem', { type: item.type, rarity: item.rarity });
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4,
            ultra: 5,
            super: 6,
            unique: 7
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
                        const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
                        if (stats && stats.image) {
                            // Create an image element with the SVG data
                            const img = document.createElement('img');
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.objectFit = 'contain';
                            // Convert SVG string to blob URL (same as graphics system)
                            const svgBlob = new Blob([stats.image ?? ''], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            petalDiv.appendChild(img);
                        }
                        else {
                            // Fallback to colored circle
                            petalDiv.style.borderRadius = '50%';
                            petalDiv.style.border = '2px solid #000';
                            petalDiv.style.backgroundColor = '#90EE90'; // Default green
                        }
                    }
                    else {
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
                        const clampedHealth = Math.max(0, item.health); // Cap health at 0
                        const healthPercentage = clampedHealth / item.maxHealth;
                        healthFill.style.width = `${healthPercentage * 100}%`;
                        healthFill.style.height = '100%';
                        healthFill.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
                        healthBar.appendChild(healthFill);
                        slot.appendChild(healthBar);
                    }
                    slot.appendChild(petalDiv);
                }
                else {
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
                const itemData = dragEvent.dataTransfer?.getData('text/plain');
                const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');
                if (itemData) {
                    const { rarity, type } = JSON.parse(itemData);
                    const slot = parseInt(target.dataset.slot || '-1');
                    if (rarity && type && slot >= 0) {
                        this.equipItemToLoadout(rarity, type, slot);
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
        const craftingSlots = this.craftingPanel?.querySelectorAll('.crafting-slot');
        craftingSlots?.forEach(slot => {
            slot.addEventListener('click', () => {
                this.removeCraftingBatch();
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
        // Safety check: ensure inventory exists and is properly initialized
        if (!player.inventory || typeof player.inventory !== 'object') {
            console.warn('[INVENTORY] Player inventory is not properly initialized:', player.inventory);
            // Initialize empty inventory if missing
            player.inventory = {};
            return;
        }
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        content.innerHTML = '';
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        content.appendChild(title);
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
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
                        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
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
                            const svgBlob = new Blob([stats.image ?? ''], { type: 'image/svg+xml' });
                            const url = URL.createObjectURL(svgBlob);
                            img.src = url;
                            itemElement.appendChild(img);
                        }
                        else {
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
                    }
                    else {
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
    moveItemToInventory(loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Safety check: ensure loadout exists and is properly initialized
        if (!player.loadout || !Array.isArray(player.loadout) || loadoutSlot >= player.loadout.length) {
            console.warn(`[INVENTORY] Invalid loadout access: slot ${loadoutSlot}, loadout:`, player.loadout);
            return;
        }
        const item = player.loadout[loadoutSlot];
        if (!item || !item.rarity)
            return;
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
    addItemToCraftingSlot(rarity, type, slotIndex) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (this.getItemCount(rarity, type) === 0)
            return;
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
        if (this.craftingItems[slotIndex]) {
            return;
        }
        const existingItems = this.craftingItems.filter(slot => slot !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0];
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity || item.petalType !== firstItem.petalType) {
                this.game.showFloatingText(this.game.canvas.width / 2, 50, 'Items must be of the same type and rarity!', '#FF0000', 20);
                return;
            }
        }
        this.craftingItems[slotIndex] = item;
        this.removeItem(rarity, type, 1);
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    handleCraftingItemClick(rarity, type, isShiftClick) {
        const itemsFromStack = this.getItemCount(rarity, type);
        if (itemsFromStack === 0)
            return;
        const isPetal = type.startsWith('petal_');
        const petalType = isPetal ? type.substring(6) : undefined;
        const itemType = isPetal ? 'petal' : type;
        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            if (firstItem.rarity !== rarity || firstItem.type !== itemType || firstItem.petalType !== petalType) {
                const itemsToReturn = [...this.craftingItems];
                this.craftingItems = [];
                itemsToReturn.forEach(item => {
                    const itemKey = item.petalType ? `petal_${item.petalType}` : item.type;
                    this.addItem(item.rarity, itemKey, 1);
                });
            }
        }
        let amountToAdd;
        if (isShiftClick) {
            amountToAdd = itemsFromStack;
        }
        else {
            amountToAdd = 5;
        }
        const actualAmountToAdd = Math.min(amountToAdd, this.getItemCount(rarity, type));
        if (actualAmountToAdd < 5) {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'You need at least 5 items to add a batch.', '#FF0000', 20);
            return;
        }
        const batchesToAdd = Math.floor(actualAmountToAdd / 5);
        const totalItemsToAdd = batchesToAdd * 5;
        const item = {
            type: itemType,
            rarity: rarity,
            petalType: petalType
        };
        for (let i = 0; i < totalItemsToAdd; i++) {
            this.craftingItems.push(item);
        }
        this.removeItem(rarity, type, totalItemsToAdd);
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    removeCraftingBatch() {
        if (this.craftingItems.length === 0)
            return;
        const itemsToRemove = this.craftingItems.splice(-5);
        if (itemsToRemove.length > 0) {
            const item = itemsToRemove[0];
            const type = item.petalType ? `petal_${item.petalType}` : item.type;
            if (item.rarity) {
                this.addItem(item.rarity, type, itemsToRemove.length);
            }
        }
        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }
    craftItems() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const itemsToCraftCount = this.craftingItems.length;
        if (itemsToCraftCount < 5 || itemsToCraftCount % 5 !== 0) {
            this.game.showFloatingText(this.game.canvas.width / 2, 50, 'You must add items in multiples of 5 to craft!', '#FF0000', 20);
            return;
        }
        this.game.getSocket()?.emit('craftItems', { items: this.craftingItems });
        this.craftingItems = [];
        this.updateCraftingDisplay();
    }
    updateCraftingDisplay() {
        if (!this.craftingPanel)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        const container = this.craftingPanel.querySelector('.crafting-circle-container');
        const multiplierEl = this.craftingPanel.querySelector('.crafting-multiplier');
        const radius = 70;
        const containerSize = 180;
        if (this.craftingItems.length > 0) {
            const firstItem = this.craftingItems[0];
            const attempts = this.craftingItems.length / 5;
            multiplierEl.textContent = `x${attempts}`;
            multiplierEl.style.display = 'block';
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                slot.style.borderColor = this.ITEM_RARITY_COLORS[firstItem.rarity];
                if (firstItem.type === 'petal' && firstItem.petalType && firstItem.rarity) {
                    const stats = (0, petals_1.getPetalStats)(firstItem.petalType, firstItem.rarity);
                    if (stats && stats.image) {
                        const img = document.createElement('img');
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'contain';
                        const svgBlob = new Blob([stats.image ?? ''], { type: 'image/svg+xml' });
                        img.src = URL.createObjectURL(svgBlob);
                        slot.appendChild(img);
                    }
                }
                else {
                    const img = document.createElement('img');
                    img.src = `./assets/${firstItem.type}.png`;
                    img.alt = firstItem.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            });
        }
        else {
            multiplierEl.style.display = 'none';
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    slot.style.left = `${x}px`;
                    slot.style.top = `${y}px`;
                }
                slot.innerHTML = '';
                slot.style.borderColor = '#666';
            });
        }
        // Calculate and update success chance
        const successChance = this.calculateSuccessChance();
        const successElement = this.craftingPanel.querySelector('.success-chance');
        if (successElement) {
            successElement.textContent = `Success Chance: ${successChance}%`;
        }
        // Update inventory preview
        this.updateCraftingInventoryPreview();
    }
    calculateSuccessChance() {
        const items = this.craftingItems;
        if (items.length === 0)
            return 0;
        // Group items by rarity
        const rarityCounts = {};
        items.forEach(item => {
            if (item.rarity) {
                rarityCounts[item.rarity] = (rarityCounts[item.rarity] || 0) + 1;
            }
        });
        // Calculate success chance based on rarity progression
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        let baseChance = 64; // 64% for common->uncommon
        // Find the highest rarity in the crafting slots
        let highestRarityIndex = -1;
        for (const rarity of rarities) {
            if (rarityCounts[rarity] > 0) {
                highestRarityIndex = rarities.indexOf(rarity);
            }
        }
        if (highestRarityIndex === -1)
            return 0;
        // Halve the chance for each rarity level above common
        const chance = baseChance / Math.pow(2, highestRarityIndex);
        return Math.round(chance);
    }
    calculatePetalCount() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        let totalPetals = 0;
        const petalRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        petalRarities.forEach(rarity => {
            const petalCount = player.inventory[rarity]?.['petal'] || 0;
            totalPetals += petalCount;
        });
        return totalPetals;
    }
    updateCraftingInventoryPreview() {
        const inventoryGrid = this.craftingPanel?.querySelector('.crafting-inventory-grid');
        if (!inventoryGrid)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        inventoryGrid.innerHTML = '';
        const rarities = ['unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        rarities.forEach(rarity => {
            const rarityItems = player.inventory[rarity];
            if (rarityItems) {
                Object.entries(rarityItems).forEach(([itemType, count]) => {
                    if (count > 0) {
                        const itemElement = document.createElement('div');
                        itemElement.className = 'crafting-inventory-item';
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
                        if (itemType.includes('petal_')) {
                            // Create petal visual using SVG image
                            const petalDiv = document.createElement('div');
                            petalDiv.style.width = '60%';
                            petalDiv.style.height = '60%';
                            petalDiv.style.display = 'flex';
                            petalDiv.style.alignItems = 'center';
                            petalDiv.style.justifyContent = 'center';
                            // Get petal SVG from stats
                            const stats = (0, petals_1.getPetalStats)(itemType.replace('petal_', ''), rarity);
                            if (stats && stats.image) {
                                // Create an image element with the SVG data
                                const img = document.createElement('img');
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'contain';
                                // Convert SVG string to blob URL (same as graphics system)
                                const svgBlob = new Blob([stats.image ?? ''], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(svgBlob);
                                img.src = url;
                                petalDiv.appendChild(img);
                            }
                            else {
                                // Fallback to colored circle
                                petalDiv.style.borderRadius = '50%';
                                petalDiv.style.border = '2px solid #000';
                                petalDiv.style.backgroundColor = '#90EE90'; // Default green
                            }
                            itemContainer.appendChild(petalDiv);
                        }
                        else {
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
                        itemElement.addEventListener('click', (e) => {
                            this.handleCraftingItemClick(rarity, itemType, e.shiftKey);
                        });
                        inventoryGrid.appendChild(itemElement);
                    }
                });
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
            loadoutBar.remove();
        }
    }
    getItemCount(rarity, type) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        return player.inventory[rarity]?.[type] || 0;
    }
    addItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (!player.inventory[rarity]) {
            player.inventory[rarity] = {};
        }
        if (!player.inventory[rarity][type]) {
            player.inventory[rarity][type] = 0;
        }
        player.inventory[rarity][type] += count;
    }
    removeItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
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
exports.InventoryManager = InventoryManager;
