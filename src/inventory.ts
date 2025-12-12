import { Item, ItemWithRarity } from './item';
import { Player, PlayerInventory } from './player';
import { Socket } from './socket';
import { getPetalStats, getAllPetalTypes } from './petals';
import { Chat } from './chat';
import { Game } from './game';

interface CraftingSlot {
    index: number;
    item: Item | null;
}

interface GameInterface {
    getLocalPlayer(): Player | undefined;
    getSocket(): Socket | undefined;
    showFloatingText(x: number, y: number, text: string, color: string, fontSize: number): void;
    canvas: HTMLCanvasElement;
    getPetalStats?(petalType: string, rarity: string): any;
    getItemSprites?(): Record<string, HTMLImageElement>;
    getItemSpriteDataUrl?(itemType: string): string | null;
    getPetalCanvas?(petalType: string, rarity: string, time?: number): HTMLCanvasElement | null;
}

export class InventoryManager {
    private game: GameInterface;
    private inventoryPanel: HTMLDivElement | null = null;
    private craftingPanel: HTMLDivElement | null = null;
    private craftingItems: Item[] = [];
    private isInventoryOpen: boolean = false;
    private isCraftingOpen: boolean = false;
    private successDisplayShownAt: number = 0; // Timestamp when success display was shown
    private readonly LOADOUT_SLOTS = 10;
    private readonly LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    private readonly allPetalTypes: string[];
    private chat: Chat | null = null;
    private tooltipElement: HTMLDivElement | null = null;
    private tooltipTimeout: number | null = null;
    private hoveredElement: HTMLElement | null = null;
    private readonly ITEM_RARITY_COLORS: Record<string, string> = {
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

    /**
     * Darken a hex color by a specified percentage
     * @param hex - Hex color string (e.g., '#7eef6d')
     * @param percent - Percentage to darken (0-100, default 30)
     * @returns Darkened hex color string
     */
    private darkenColor(hex: string, percent: number = 30): string {
        // Remove # if present
        const num = parseInt(hex.replace('#', ''), 16);
        
        // Extract RGB components
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        
        // Darken each component
        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        
        // Convert back to hex
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }

    /**
     * Format petal name for display (matches graphics.ts formatting)
     * @param petalType - The petal type string
     * @returns Formatted petal name
     */
    private formatPetalName(petalType: string): string {
        if (!petalType) return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }

    /**
     * Get skill multiplier based on skill tier
     */
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

    /**
     * Abbreviate a number (e.g., 1000 -> "1K", 1500 -> "1.5K")
     */
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

    /**
     * Calculate final petal damage with skills and player modifiers
     */
    private calculateFinalPetalDamage(petalType: string, rarity: string): number {
        const player = this.game.getLocalPlayer();
        if (!player) return 0;

        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;

        const baseDamage = stats.damage;
        
        // Apply skill multiplier
        const damageSkillMultiplier = this.getSkillMultiplier(player.skills?.damage);
        
        // Note: Player modifiers (from other petals) affect player damage, not petal damage
        // Petal damage is only affected by damage skill
        return Math.round(baseDamage * damageSkillMultiplier);
    }

    /**
     * Calculate final petal health with skills
     */
    private calculateFinalPetalHealth(petalType: string, rarity: string): number {
        const player = this.game.getLocalPlayer();
        if (!player) return 0;

        const stats = getPetalStats(petalType, rarity);
        if (!stats) return 0;

        const baseHealth = stats.health;
        
        // Apply petal health skill multiplier
        const petalHealthMultiplier = this.getSkillMultiplier(player.skills?.petalHealth);
        
        return Math.round(baseHealth * petalHealthMultiplier);
    }

    /**
     * Create and show tooltip for a petal item
     */
    private showTooltip(element: HTMLElement, petalType: string, rarity: string): void {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) return;

        // Remove existing tooltip if any
        this.hideTooltip();

        // Create tooltip element
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

        // Calculate final stats
        const finalDamage = this.calculateFinalPetalDamage(petalType, rarity);
        const finalHealth = this.calculateFinalPetalHealth(petalType, rarity);

        // Petal name
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 8px; color: ' + (this.ITEM_RARITY_COLORS[rarity] || '#fff') + ';';
        nameDiv.textContent = stats.name;
        tooltip.appendChild(nameDiv);

        // Description
        if (stats.description) {
            const descDiv = document.createElement('div');
            descDiv.style.cssText = 'margin-bottom: 8px; color: #ccc; line-height: 1.4;';
            descDiv.textContent = stats.description;
            tooltip.appendChild(descDiv);
        }

        // HP - with abbreviation support
        const hpDiv = document.createElement('div');
        hpDiv.style.cssText = 'margin-bottom: 4px;';
        hpDiv.setAttribute('data-full-value', finalHealth.toString());
        hpDiv.innerHTML = `<span style="color: #4CAF50;">HP:</span> <span class="tooltip-value">${this.abbreviateNumber(finalHealth)}</span>`;
        tooltip.appendChild(hpDiv);

        // Damage - with abbreviation support
        const damageDiv = document.createElement('div');
        damageDiv.setAttribute('data-full-value', finalDamage.toString());
        damageDiv.innerHTML = `<span style="color: #f44336;">Damage:</span> <span class="tooltip-value">${this.abbreviateNumber(finalDamage)}</span>`;
        tooltip.appendChild(damageDiv);

        document.body.appendChild(tooltip);
        this.tooltipElement = tooltip;

        // Position tooltip
        this.updateTooltipPosition(element, tooltip);
    }

    /**
     * Update tooltip position relative to the hovered element
     */
    private updateTooltipPosition(element: HTMLElement, tooltip: HTMLDivElement): void {
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        // Position to the right of the element, or left if not enough space
        let left = rect.right + 10;
        let top = rect.top;

        // If tooltip would go off screen to the right, position to the left
        if (left + tooltipRect.width > window.innerWidth) {
            left = rect.left - tooltipRect.width - 10;
        }

        // If tooltip would go off screen at bottom, adjust
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }

        // If tooltip would go off screen at top, adjust
        if (top < 0) {
            top = 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    /**
     * Hide tooltip
     */
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

    /**
     * Update tooltip values based on ALT key state
     */
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

    /**
     * Setup hover tooltip for an element
     */
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
            }, 200); // 0.2 seconds
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
            // If mouse was down for less than 200ms, treat as click and hide tooltip
            if (Date.now() - mouseDownTime < 200) {
                this.hideTooltip();
            }
        };

        const handleDragStart = () => {
            isDragging = true;
            this.hideTooltip();
        };

        const handleDragEnd = () => {
            // Reset dragging flag after a short delay to allow mouse events to settle
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

    /**
     * Convert hex color to rgba string
     * @param hex - Hex color string (e.g., '#7eef6d')
     * @param alpha - Alpha value (0-1)
     * @returns RGBA color string
     */
    private hexToRgba(hex: string, alpha: number): string {
        // Remove # if present
        const num = parseInt(hex.replace('#', ''), 16);
        
        // Extract RGB components
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    constructor(game: GameInterface,  chat: Chat | null) {
        this.game = game;
        this.chat = chat;
        this.allPetalTypes = getAllPetalTypes();
        
        // Setup ALT key tracking for tooltip value display
        (window as any).altKeyPressed = false;
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                (window as any).altKeyPressed = true;
                this.updateTooltipValues(true);
            }
        });
        document.addEventListener('keyup', (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                (window as any).altKeyPressed = false;
                this.updateTooltipValues(false);
            }
        });

        // Create loadout bar (or use existing one if it already exists)
        let loadoutBar = document.getElementById('loadoutBar') as HTMLDivElement;
        if (!loadoutBar) {
            loadoutBar = document.createElement('div');
            loadoutBar.id = 'loadoutBar';
            loadoutBar.style.position = 'fixed';
            loadoutBar.style.bottom = '20px';
            loadoutBar.style.left = '50%';
            loadoutBar.style.transform = 'translateX(-50%)';
            loadoutBar.style.display = 'flex';
            loadoutBar.style.gap = '5px';
            loadoutBar.style.zIndex = '1000';
            document.body.appendChild(loadoutBar);
        } else {
            // Clear existing slots if loadout bar already exists
            loadoutBar.innerHTML = '';
        }

        // Create slots if they don't exist
        if (loadoutBar.querySelectorAll('.loadout-slot').length === 0) {
            for (let i = 0; i < this.LOADOUT_SLOTS; i++) {
                const slot = document.createElement('div');
                slot.className = 'loadout-slot';
                slot.dataset.slot = i.toString();
                slot.style.width = '50px';
                slot.style.height = '50px';
                slot.style.backgroundColor = 'rgba(99, 255, 182, 1)';
                slot.style.border = '3px solid #00ba3e';
                slot.style.borderRadius = '5px';
                loadoutBar.appendChild(slot);
            }
        }

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

        // Success display in the center
        const successDisplay = document.createElement('div');
        successDisplay.className = 'crafting-success-display';
        successDisplay.style.display = 'none';
        craftingCircleContainer.appendChild(successDisplay);
        
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

        // Add click handler to clear success display when clicking on crafting slots
        // (with minimum display time enforced in clearCraftingSuccessDisplay)
        this.craftingPanel.addEventListener('click', (e) => {
            // Clear success display when clicking on crafting slots or circle container
            const target = e.target as HTMLElement;
            if (target.closest('.crafting-slot') || target.closest('.crafting-circle-container')) {
                this.clearCraftingSuccessDisplay();
            }
        });

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
            .crafting-success-display {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 80px;
                height: 80px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 10;
                pointer-events: none;
            }
            .crafting-success-display .success-item {
                width: 60px;
                height: 60px;
                border: 3px solid;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.9);
                position: relative;
            }
            .crafting-success-display .success-item img {
                width: 90%;
                height: 90%;
                object-fit: contain;
            }
            .crafting-success-display .success-count {
                position: absolute;
                bottom: -25px;
                font-size: 18px;
                font-weight: bold;
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
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
            // Clear success display when opening
            this.clearCraftingSuccessDisplay();
            this.craftingPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.craftingPanel?.classList.add('open');
            }, 10);
            this.updateCraftingDisplay();
        } else {
            this.craftingPanel.classList.remove('open');
            this.showChat();
            // Clear success display when closing
            this.clearCraftingSuccessDisplay();
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
                item.onCooldown = true; // New petals should start on cooldown
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

        // Petals cannot be used as consumables (except yggdrasil which is always active)
        if (item.type === 'petal' && item.petalType !== 'yggdrasil') {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                50,
                'Petals cannot be used - they provide passive protection!',
                '#FFA500',
                16
            );
            return;
        }

        // Yggdrasil petals are always active - no need to emit useItem
        if (item.type === 'petal' && item.petalType === 'yggdrasil') {
            this.game.showFloatingText(
                player.x,
                player.y - 30,
                'Yggdrasil Petal - Always active! Will revive nearby corpses.',
                '#FFD700',
                20
            );
            return; // Don't emit useItem since it's always active
        }

        this.game.getSocket()?.emit('useItem', { 
            type: item.type, 
            rarity: item.rarity,
            petalType: item.petalType 
        });

        const rarityMultipliers: Record<string, number> = {
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
            let cooldownTime = 10000 * (1 / multiplier);
            
            // Special cooldown for yggdrasil petals
            if (item.type === 'petal' && item.petalType === 'yggdrasil') {
                // Get the petal stats to use the correct cooldown
                const petalStats = this.game.getPetalStats?.(item.petalType, item.rarity);
                if (petalStats) {
                    cooldownTime = petalStats.cooldown;
                }
            }
            
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
        // Remove excessive logging - only log when debugging
        // console.log('[INVENTORY] Updating loadout display with loadout:', player.loadout);

        // Only update slots in the game's loadout bar (id='loadoutBar'), not the title screen one
        const loadoutBar = document.getElementById('loadoutBar');
        if (!loadoutBar) {
            console.warn('[INVENTORY] Loadout bar not found');
            return;
        }
        const slots = loadoutBar.querySelectorAll('.loadout-slot');
        console.log('[INVENTORY] Found ' + slots.length + ' loadout slots');
        slots.forEach((slot, index) => {
            slot.innerHTML = '';
            slot.classList.remove('on-cooldown', 'petal-slot');
            // Reset background and border colors to default
            const slotElement = slot as HTMLElement;
            slotElement.style.backgroundColor = '';
            slotElement.style.borderColor = '';

            const item = player.loadout[index];
            if (item) {
                // Handle cooldown state
                if (item.onCooldown) {
                    slot.classList.add('on-cooldown');
                }

                // Handle different item types
                if (item.type === 'petal') {
                    slot.classList.add('petal-slot');
                    
                    // Set background and border colors based on rarity
                    if (item.rarity && this.ITEM_RARITY_COLORS[item.rarity]) {
                        const rarityColor = this.ITEM_RARITY_COLORS[item.rarity];
                        slotElement.style.backgroundColor = rarityColor;
                        slotElement.style.borderColor = this.darkenColor(rarityColor);
                    }
                    
                    // Create petal visual using SVG image
                    const petalDiv = document.createElement('div');
                    petalDiv.style.width = '60%';
                    petalDiv.style.height = '60%';
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
                            
                            // Use canvas image if available, otherwise use SVG data URL as fallback
                            const petalCanvas = this.game.getPetalCanvas?.(item.petalType, item.rarity, Date.now());
                            if (petalCanvas) {
                                img.src = petalCanvas.toDataURL('image/png');
                            } else {
                                // Fallback to SVG data URL if canvas not available yet
                                const svgBlob = new Blob([stats.image], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(svgBlob);
                                img.src = url;
                            }
                            
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
                        const clampedHealth = Math.max(0, item.health); // Cap health at 0
                        const healthPercentage = clampedHealth / item.maxHealth;
                        healthFill.style.width = `${healthPercentage * 100}%`;
                        healthFill.style.height = '100%';
                        healthFill.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
                        
                        healthBar.appendChild(healthFill);
                        slot.appendChild(healthBar);
                    }
                    
                    slot.appendChild(petalDiv);

                    // Add petal name label (similar to drops in graphics.ts)
                    if (item.petalType) {
                        const petalName = this.formatPetalName(item.petalType);
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
                            slot.appendChild(nameLabel);
                        }

                        // Setup tooltip for loadout petal
                        if (item.rarity) {
                            this.setupTooltip(slotElement, item.petalType, item.rarity);
                        }
                    }
                } else {
                    // Regular items (health potion, speed boost, shield)
                    const img = document.createElement('img');
                    // Use cached data URL if available, otherwise fallback to direct path
                    const dataUrl = this.game.getItemSpriteDataUrl?.(item.type);
                    if (dataUrl) {
                        img.src = dataUrl; // Use cached data URL (in-memory)
                    } else {
                        img.src = `./assets/${item.type}.png`; // Fallback
                    }
                    img.alt = item.type;
                    img.style.width = '60%';
                    img.style.height = '60%';
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
            // Only update slots in the game's loadout bar (id='loadoutBar'), not the title screen one
            const loadoutBar = document.getElementById('loadoutBar');
            if (!loadoutBar) return;
            
            const slots = loadoutBar.querySelectorAll('.loadout-slot');
            slots.forEach((slot, slotIndex) => {
                const slotElement = slot as HTMLElement;
                
                // Find the draggable element - prefer img, then petal div, then slot itself
                const img = slot.querySelector('img');
                let draggableElement: HTMLElement | null = null;
                
                if (img) {
                    draggableElement = img as HTMLElement;
                } else {
                    // Look for petal div (has display: flex style)
                    const petalDiv = Array.from(slot.children).find((child: Element) => {
                        const htmlChild = child as HTMLElement;
                        return htmlChild.style.display === 'flex' || 
                               htmlChild.style.cssText.includes('display: flex') ||
                               htmlChild.style.cssText.includes('display:flex');
                    }) as HTMLElement;
                    if (petalDiv) {
                        draggableElement = petalDiv;
                    }
                }
                
                // If we found a child element, make it draggable
                if (draggableElement) {
                    draggableElement.draggable = true;
                    draggableElement.style.cursor = 'grab';
                    
                    // Remove existing dragstart listeners by cloning
                    const newElement = draggableElement.cloneNode(true) as HTMLElement;
                    draggableElement.parentNode?.replaceChild(newElement, draggableElement);
                    
                    // Add dragstart listener
                    newElement.addEventListener('dragstart', (e: Event) => {
                        const dragEvent = e as DragEvent;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer!.effectAllowed = 'move';
                        e.stopPropagation(); // Prevent event bubbling
                    });
                } else if (slotElement && slotElement.children.length === 0) {
                    // If slot is empty, make the slot itself draggable (shouldn't happen, but just in case)
                    slotElement.draggable = true;
                    slotElement.style.cursor = 'grab';
                    slotElement.addEventListener('dragstart', (e: Event) => {
                        const dragEvent = e as DragEvent;
                        dragEvent.dataTransfer?.setData('text/loadoutSlot', slotIndex.toString());
                        dragEvent.dataTransfer!.effectAllowed = 'move';
                    });
                }
            });
        };

        // Function to setup drag and drop listeners on loadout slots
        const setupLoadoutSlotListeners = () => {
            // Only update slots in the game's loadout bar (id='loadoutBar'), not the title screen one
            const loadoutBar = document.getElementById('loadoutBar');
            if (!loadoutBar) return;
            
            const slots = loadoutBar.querySelectorAll('.loadout-slot');
            slots.forEach((slot, slotIndex) => {
                const slotElement = slot as HTMLElement;
                slotElement.dataset.slot = slotIndex.toString();

                // Remove existing listeners by cloning the element
                const newSlot = slotElement.cloneNode(true) as HTMLElement;
                slotElement.parentNode?.replaceChild(newSlot, slotElement);

                newSlot.addEventListener('dragenter', (e: Event) => {
                    e.preventDefault();
                    newSlot.classList.add('drag-over');
                });

                newSlot.addEventListener('dragover', (e: Event) => {
                    e.preventDefault();
                    const dragEvent = e as DragEvent;
                    dragEvent.dataTransfer!.dropEffect = 'move';
                    newSlot.classList.add('drag-over');
                });

                newSlot.addEventListener('dragleave', (e: Event) => {
                    newSlot.classList.remove('drag-over');
                });

                newSlot.addEventListener('drop', (e: Event) => {
                    e.preventDefault();
                    const dragEvent = e as DragEvent;
                    newSlot.classList.remove('drag-over');

                    const itemData = dragEvent.dataTransfer?.getData('text/plain');
                    const fromLoadoutSlot = dragEvent.dataTransfer?.getData('text/loadoutSlot');

                    if (itemData) {
                        const { rarity, type } = JSON.parse(itemData);
                        const slot = parseInt(newSlot.dataset.slot || '-1');
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
        };

        // Setup listeners initially
        setupLoadoutSlotListeners();

        // Wrap updateLoadoutDisplay to re-setup listeners after update
        const originalUpdateLoadoutDisplay = this.updateLoadoutDisplay.bind(this);
        this.updateLoadoutDisplay = () => {
            originalUpdateLoadoutDisplay();
            setupLoadoutSlotListeners(); // Re-setup drop listeners after innerHTML is cleared
            updateLoadoutDraggable(); // Re-setup drag listeners after innerHTML is cleared
        };

        const craftingSlots = this.craftingPanel?.querySelectorAll('.crafting-slot');
        craftingSlots?.forEach(slot => {
            slot.addEventListener('click', () => {
                this.removeCraftingBatch();
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

        // Safety check: ensure inventory exists and is properly initialized
        if (!player.inventory || typeof player.inventory !== 'object') {
            console.warn('[INVENTORY] Player inventory is not properly initialized:', player.inventory);
            // Initialize empty inventory if missing
            player.inventory = {};
            return;
        }

        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content) return;

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
                              width: 30px;
                              height: 30px;
                              object-fit: contain;
                          `;
                            
                            // Convert SVG string to blob URL (same as loadout display)
                            // Use canvas image - no fallback to SVG data URL
                            const petalCanvas = this.game.getPetalCanvas?.(petalType, rarity, Date.now());
                            if (petalCanvas) {
                                img.src = petalCanvas.toDataURL('image/png');
                            } else {
                                // No canvas available - skip rendering
                                return; // Skip this item if canvas not available
                            }
                            
                            itemElement.appendChild(img);
                        } else {
                            // Fallback to colored circle for petals
                            const fallbackDiv = document.createElement('div');
                            fallbackDiv.style.cssText = `
                              width: 30px;
                              height: 30px;
                              border-radius: 50%;
                              background-color: #90EE90;
                              border: 2px solid #000;
                          `;
                            itemElement.appendChild(fallbackDiv);
                        }
                    } else {
                        // Handle other items with PNG images
                        const img = document.createElement('img');
                        // Use cached data URL if available, otherwise fallback to direct path
                        const dataUrl = this.game.getItemSpriteDataUrl?.(type);
                        if (dataUrl) {
                            img.src = dataUrl; // Use cached data URL (in-memory)
                        } else {
                            img.src = `./assets/${type}.png`; // Fallback
                        }
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
                    countLabel.textContent = count.toString();
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

                    // Add petal name label for petals (similar to drops in graphics.ts)
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

                        // Setup tooltip for petal items
                        this.setupTooltip(itemElement, petalType, rarity);
                    }

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

        // Safety check: ensure loadout exists and is properly initialized
        if (!player.loadout || !Array.isArray(player.loadout) || loadoutSlot >= player.loadout.length) {
            console.warn(`[INVENTORY] Invalid loadout access: slot ${loadoutSlot}, loadout:`, player.loadout);
            return;
        }

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
        
        if (this.craftingItems[slotIndex]) {
            return;
        }

        const existingItems = this.craftingItems.filter(slot => slot !== null);
        if (existingItems.length > 0) {
            const firstItem = existingItems[0];
            if (item.type !== firstItem.type || item.rarity !== firstItem.rarity || item.petalType !== firstItem.petalType) {
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

        this.craftingItems[slotIndex] = item;

        this.removeItem(rarity, type, 1);

        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }

    private handleCraftingItemClick(rarity: string, type: string, isShiftClick: boolean) {
        const itemsFromStack = this.getItemCount(rarity, type);
        if (itemsFromStack === 0) return;

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
                    this.addItem(item.rarity!, itemKey, 1);
                });
            }
        }

        let amountToAdd;
        if (isShiftClick) {
            amountToAdd = itemsFromStack;
        } else {
            amountToAdd = 5;
        }
        
        const actualAmountToAdd = Math.min(amountToAdd, this.getItemCount(rarity, type));

        if (actualAmountToAdd < 5) {
            this.game.showFloatingText(
                this.game.canvas.width / 2, 50,
                'You need at least 5 items to add a batch.',
                '#FF0000', 20
            );
            return;
        }

        const batchesToAdd = Math.floor(actualAmountToAdd / 5);
        const totalItemsToAdd = batchesToAdd * 5;

        const item: Item = {
            type: itemType as Item['type'],
            rarity: rarity as Item['rarity'],
            petalType: petalType
        };

        for (let i = 0; i < totalItemsToAdd; i++) {
            this.craftingItems.push(item);
        }
        this.removeItem(rarity, type, totalItemsToAdd);

        this.updateCraftingDisplay();
        this.updateInventoryDisplay();
    }

    public removeCraftingBatch() {
        if (this.craftingItems.length === 0) return;

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

    public craftItems() {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        const itemsToCraftCount = this.craftingItems.length;

        if (itemsToCraftCount < 5 || itemsToCraftCount % 5 !== 0) {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                50,
                'You must add items in multiples of 5 to craft!',
                '#FF0000',
                20
            );
            return;
        }

        console.log('[CLIENT] Sending craftItems request:', { itemCount: this.craftingItems.length });
        // Clear any previous success display when starting new craft
        this.clearCraftingSuccessDisplay();
        this.game.getSocket()?.emit('craftItems', { items: this.craftingItems });

        this.craftingItems = [];
        this.updateCraftingDisplay();
    }

    public updateCraftingDisplay() {
        if (!this.craftingPanel) return;

        const player = this.game.getLocalPlayer();
        if (!player) return;

        // Clear success display when updating (e.g., when items change)
        // Only clear if there are no items in crafting (user cleared the slots)
        if (this.craftingItems.length === 0) {
            this.clearCraftingSuccessDisplay();
        }

        const slots = this.craftingPanel.querySelectorAll('.crafting-slot');
        const container = this.craftingPanel.querySelector('.crafting-circle-container') as HTMLElement;
        const multiplierEl = this.craftingPanel.querySelector('.crafting-multiplier') as HTMLElement;
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
                    (slot as HTMLElement).style.left = `${x}px`;
                    (slot as HTMLElement).style.top = `${y}px`;
                }
    
                slot.innerHTML = '';
                (slot as HTMLElement).style.borderColor = this.ITEM_RARITY_COLORS[firstItem.rarity!]!;

                if (firstItem.type === 'petal' && firstItem.petalType && firstItem.rarity) {
                    const stats = getPetalStats(firstItem.petalType, firstItem.rarity);
                    if (stats && stats.image) {
                        const img = document.createElement('img');
                        img.style.width = '100%';
                        img.style.height = '100%';
                        img.style.objectFit = 'contain';
                        // Use canvas image - no fallback to SVG data URL
                        const petalCanvas = this.game.getPetalCanvas?.(firstItem.petalType, firstItem.rarity, Date.now());
                        if (petalCanvas) {
                            img.src = petalCanvas.toDataURL('image/png');
                        } else {
                            // No canvas available - skip rendering
                            return; // Skip this petal if canvas not available
                        }
                        slot.appendChild(img);
                    }
                } else {
                    const img = document.createElement('img');
                    // Use cached data URL if available, otherwise fallback to direct path
                    const dataUrl = this.game.getItemSpriteDataUrl?.(firstItem.type);
                    if (dataUrl) {
                        img.src = dataUrl; // Use cached data URL (in-memory)
                    } else {
                        img.src = `./assets/${firstItem.type}.png`; // Fallback
                    }
                    img.alt = firstItem.type;
                    img.style.width = '80%';
                    img.style.height = '80%';
                    img.style.objectFit = 'contain';
                    slot.appendChild(img);
                }
            });
        } else {
            multiplierEl.style.display = 'none';
            slots.forEach((slot, index) => {
                if (container) {
                    const angle = (index / slots.length) * 2 * Math.PI;
                    const x = (containerSize / 2) + radius * Math.cos(angle) - 20;
                    const y = (containerSize / 2) + radius * Math.sin(angle) - 20;
                    (slot as HTMLElement).style.left = `${x}px`;
                    (slot as HTMLElement).style.top = `${y}px`;
                }
                slot.innerHTML = '';
                (slot as HTMLElement).style.borderColor = '#666';
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

    public showCraftingSuccess(newItem: Item, successCount: number) {
        console.log('[INVENTORY] showCraftingSuccess called:', { newItem, successCount });
        if (!this.craftingPanel) {
            console.log('[INVENTORY] No crafting panel found');
            return;
        }

        const successDisplay = this.craftingPanel.querySelector('.crafting-success-display') as HTMLElement;
        if (!successDisplay) {
            console.log('[INVENTORY] No success display element found');
            return;
        }

        // Clear previous content
        successDisplay.innerHTML = '';
        successDisplay.style.display = 'flex';
        
        // Record when the success display was shown
        this.successDisplayShownAt = Date.now();

        // Create item container
        const itemContainer = document.createElement('div');
        itemContainer.className = 'success-item';
        
        // Set border and background color based on rarity
        const rarity = newItem.rarity || 'common';
        const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#7eef6d';
        itemContainer.style.borderColor = rarityColor;
        // Set solid background with rarity color (more opaque for visibility)
        const bgColor = this.hexToRgba(rarityColor, 0.7);
        itemContainer.style.backgroundColor = bgColor;

        // Create item image
        const img = document.createElement('img');
        img.style.width = '90%';
        img.style.height = '90%';
        img.style.objectFit = 'contain';
        
        if (newItem.type === 'petal' && newItem.petalType && rarity) {
            const petalCanvas = this.game.getPetalCanvas?.(newItem.petalType, rarity, Date.now());
            if (petalCanvas) {
                img.src = petalCanvas.toDataURL('image/png');
                console.log('[INVENTORY] Using petal canvas for:', newItem.petalType, rarity);
            } else {
                console.log('[INVENTORY] Petal canvas not available');
            }
        } else {
            const dataUrl = this.game.getItemSpriteDataUrl?.(newItem.type);
            if (dataUrl) {
                img.src = dataUrl;
                console.log('[INVENTORY] Using item sprite data URL for:', newItem.type);
            } else {
                img.src = `./assets/${newItem.type}.png`;
                console.log('[INVENTORY] Using fallback image path for:', newItem.type);
            }
        }
        
        // Handle image load errors
        img.onerror = () => {
            console.error('[INVENTORY] Failed to load image for:', newItem);
            // Still show the container even if image fails
        };
        
        itemContainer.appendChild(img);
        successDisplay.appendChild(itemContainer);

        // Create success count text
        const countText = document.createElement('div');
        countText.className = 'success-count';
        countText.textContent = `x${successCount}`;
        countText.style.color = this.ITEM_RARITY_COLORS[rarity] || '#7eef6d';
        successDisplay.appendChild(countText);
        
        console.log('[INVENTORY] Success display created and shown');
    }

    public clearCraftingSuccessDisplay() {
        if (!this.craftingPanel) return;
        
        // Don't clear if it hasn't been shown for at least 0.5 seconds
        const now = Date.now();
        if (this.successDisplayShownAt > 0 && (now - this.successDisplayShownAt) < 500) {
            // Schedule to clear after the minimum display time
            const remainingTime = 500 - (now - this.successDisplayShownAt);
            setTimeout(() => {
                this.clearCraftingSuccessDisplay();
            }, remainingTime);
            return;
        }
        
        const successDisplay = this.craftingPanel.querySelector('.crafting-success-display') as HTMLElement;
        if (successDisplay) {
            successDisplay.style.display = 'none';
            successDisplay.innerHTML = '';
            this.successDisplayShownAt = 0; // Reset timestamp
        }
    }

    private calculateSuccessChance(): number {
        const items = this.craftingItems;

        if (items.length === 0) return 0;

        // Group items by rarity
        const rarityCounts: Record<string, number> = {};
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

        if (highestRarityIndex === -1) return 0;

        // Halve the chance for each rarity level above common
        const chance = baseChance / Math.pow(2, highestRarityIndex);
        return Math.round(chance);
    }

    private calculatePetalCount(): number {
        const player = this.game.getLocalPlayer();
        if (!player) return 0;

        let totalPetals = 0;
        const petalRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
        
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

                        // Set background and border colors based on rarity
                        const rarityColor = this.ITEM_RARITY_COLORS[rarity];
                        const darkenedColor = this.darkenColor(rarityColor);
                        if (rarityColor) {
                            itemElement.style.backgroundColor = rarityColor;
                            itemElement.style.border = `3px solid ${darkenedColor}`;
                        }

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
                            const stats = getPetalStats(itemType.replace('petal_', ''), rarity);
                            
                            if (stats && stats.image) {
                                // Create an image element with the SVG data
                                const img = document.createElement('img');
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'contain';
                                
                                // Use canvas image - no fallback to SVG data URL
                                const petalType = itemType.replace('petal_', '');
                                const petalCanvas = this.game.getPetalCanvas?.(petalType, rarity, Date.now());
                                if (petalCanvas) {
                                    img.src = petalCanvas.toDataURL('image/png');
                                } else {
                                    // No canvas available - skip rendering
                                    return; // Skip this petal if canvas not available
                                }
                                
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
                            // Use cached data URL if available, otherwise fallback to direct path
                            const dataUrl = this.game.getItemSpriteDataUrl?.(itemType);
                            if (dataUrl) {
                                img.src = dataUrl; // Use cached data URL (in-memory)
                            } else {
                                img.src = `./assets/${itemType}.png`; // Fallback
                            }
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

    public cleanup() {
        if (this.inventoryPanel) this.inventoryPanel.style.display = 'none';
        if (this.craftingPanel) this.craftingPanel.style.display = 'none';

        const loadoutBar = document.getElementById('loadoutBar');
        if (loadoutBar) {
            loadoutBar.remove();
        }
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
