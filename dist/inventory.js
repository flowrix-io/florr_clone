"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryManager = void 0;
const petals_1 = require("./petals");
const inventoryCodec_1 = require("./inventoryCodec");
const inventory_panel_1 = require("./graphics/inventory-panel");
const crafting_panel_1 = require("./graphics/crafting-panel");
const mob_gallery_panel_1 = require("./graphics/mob-gallery-panel");
const petal_icon_1 = require("./graphics/petal-icon");
class InventoryManager {
    getIsInventoryOpen() {
        return this.isInventoryOpen;
    }
    getIsMobGalleryOpen() {
        return this.isMobGalleryOpen;
    }
    /**
     * Darken a hex color by a specified percentage
     * @param hex - Hex color string (e.g., '#7eef6d')
     * @param percent - Percentage to darken (0-100, default 30)
     * @returns Darkened hex color string
     */
    darkenColor(hex, percent = 30) {
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
    formatPetalName(petalType) {
        if (!petalType)
            return "";
        let itemName = petalType[0].toUpperCase() + petalType.slice(1).toLowerCase();
        itemName = itemName.replace('_', ' ');
        return itemName;
    }
    /**
     * Get skill multiplier based on skill tier
     */
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
    /**
     * Abbreviate a number (e.g., 1000 -> "1K", 1500 -> "1.5K")
     */
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
    /**
     * Calculate final petal damage with skills and player modifiers
     */
    calculateFinalPetalDamage(petalType, rarity) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return 0;
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
    calculateFinalPetalHealth(petalType, rarity) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return 0;
        const baseHealth = stats.health;
        // Apply petal health skill multiplier
        const petalHealthMultiplier = this.getSkillMultiplier(player.skills?.petalHealth);
        return Math.round(baseHealth * petalHealthMultiplier);
    }
    /**
     * Create and show tooltip for a petal item
     */
    showTooltip(element, petalType, rarity) {
        const stats = (0, petals_1.getPetalStats)(petalType, rarity);
        if (!stats)
            return;
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
    updateTooltipPosition(element, tooltip) {
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
     * Hover handler invoked by the canvas inventory panel. Manages the tooltip
     * timeout for petals so it mirrors the prior DOM-based behavior.
     */
    handleCanvasInventoryHover(hit) {
        if (this.tooltipTimeout !== null) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        // Hide whatever tooltip is currently shown.
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        this.canvasHoverPetal = null;
        if (!hit || this.isDragging)
            return;
        if (!hit.itemType.startsWith('petal_'))
            return;
        const petalType = hit.itemType.replace('petal_', '');
        const rarity = hit.rarity;
        this.canvasHoverPetal = { petalType, rarity, rect: hit.rect };
        this.tooltipTimeout = window.setTimeout(() => {
            if (!this.canvasHoverPetal || this.isDragging)
                return;
            const { petalType: pt, rarity: rr, rect } = this.canvasHoverPetal;
            this.showTooltipAtRect(rect, pt, rr);
            this.updateTooltipValues(window.altKeyPressed || false);
        }, 200);
    }
    /**
     * Show the petal tooltip positioned next to a client-space rect.
     * Mirrors showTooltip() but anchored to a rect rather than an HTMLElement.
     */
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
        if (left + tooltipRect.width > window.innerWidth) {
            left = rect.left - tooltipRect.width - 10;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }
        if (top < 0)
            top = 10;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
    /**
     * Hide tooltip
     */
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
    /**
     * Update tooltip values based on ALT key state
     */
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
    /**
     * Setup hover tooltip for an element
     */
    setupTooltip(element, petalType, rarity) {
        let mouseDownTime = 0;
        const handleMouseEnter = () => {
            if (this.isDragging)
                return;
            this.hoveredElement = element;
            this.tooltipTimeout = window.setTimeout(() => {
                if (this.hoveredElement === element && !this.isDragging) {
                    this.showTooltip(element, petalType, rarity);
                    // Check initial ALT state
                    this.updateTooltipValues(window.altKeyPressed || false);
                }
            }, 200); // 0.2 seconds
        };
        const handleMouseLeave = () => {
            this.hideTooltip();
        };
        const handleMouseMove = () => {
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
        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
        element.addEventListener('mousemove', handleMouseMove);
        element.addEventListener('mousedown', handleMouseDown);
        element.addEventListener('mouseup', handleMouseUp);
    }
    constructor(game, chat, options) {
        this.inventoryPanel = null;
        this.craftingPanel = null;
        this.mobGalleryPanel = null;
        this.craftingItems = [];
        this.isInventoryOpen = false;
        this.isCraftingOpen = false;
        this.isMobGalleryOpen = false;
        // Incremental inventory display: track rendered items to avoid full DOM rebuilds
        this.renderedItems = new Map();
        this.renderedRarityRows = new Map();
        this.inventoryGridContainer = null;
        this.canvasInventoryPanel = null;
        this.canvasCraftingPanel = null;
        this.canvasMobGalleryPanel = null;
        this.canvasHoverPetal = null;
        // Cache petal canvas → data URL conversions to avoid expensive toDataURL() on every render
        this.petalDataUrlCache = new Map();
        /** Timestamp of the most recent local loadout mutation; used to suppress
         *  stale server broadcasts that would overwrite in-flight optimistic state. */
        this.lastLocalLoadoutChange = 0;
        this.LOADOUT_SYNC_SUPPRESS_MS = 600;
        this.successDisplayShownAt = 0; // Timestamp when success display was shown
        this.LOADOUT_SLOTS = 20;
        this.LOADOUT_KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
        this.chat = null;
        this.tooltipElement = null;
        this.tooltipTimeout = null;
        this.hoveredElement = null;
        // Custom canvas drag and drop state
        this.dragCanvas = null;
        this.isDragging = false;
        this.dragSource = null;
        this.dragStartElement = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.CLICK_DRAG_THRESHOLD = 5;
        this.ITEM_RARITY_COLORS = petals_1.ITEM_RARITY_COLORS;
        this.game = game;
        this.chat = chat;
        const mobGalleryOnly = options?.mobGalleryOnly === true;
        const craftingOnly = options?.craftingOnly === true;
        // Setup ALT key tracking for tooltip value display
        window.altKeyPressed = false;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                window.altKeyPressed = true;
                this.updateTooltipValues(true);
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt') {
                window.altKeyPressed = false;
                this.updateTooltipValues(false);
            }
        });
        if (!mobGalleryOnly && !craftingOnly) {
            // Loadout bar is now canvas-rendered (see graphics/loadout-bar.ts).
            // Ensure any legacy DOM loadout bar is removed.
            const legacy = document.getElementById('loadoutBar');
            if (legacy)
                legacy.remove();
            // Create inventory panel — a thin DOM container that just hosts the
            // fully canvas-rendered inventory UI. The canvas inside paints the
            // background, border, header, controls, items, and close button.
            this.inventoryPanel = document.createElement('div');
            this.inventoryPanel.id = 'inventoryPanel';
            this.inventoryPanel.className = 'inventory-panel';
            this.inventoryPanel.style.display = 'none';
            this.inventoryPanel.style.padding = '0';
            this.inventoryPanel.style.background = 'transparent';
            this.inventoryPanel.style.border = 'none';
            this.inventoryPanel.style.boxShadow = 'none';
            this.inventoryPanel.style.boxSizing = 'border-box';
            this.inventoryPanel.style.width = '380px';
            this.inventoryPanel.style.overflow = 'visible';
            // The canvas inventory paints the entire UI inside the panel div.
            document.body.appendChild(this.inventoryPanel);
            this.canvasInventoryPanel = new inventory_panel_1.CanvasInventoryPanel(this.game);
            this.canvasInventoryPanel.attachTo(this.inventoryPanel);
            this.canvasInventoryPanel.onItemMouseDown = (rarity, itemType, e) => {
                this.startDrag(e, { type: 'inventory', rarity, itemType }, null);
            };
            this.canvasInventoryPanel.onItemHoverChange = (hit) => {
                this.handleCanvasInventoryHover(hit);
            };
            this.canvasInventoryPanel.onClose = () => this.closeInventory();
        } // end !mobGalleryOnly && !craftingOnly
        if (!mobGalleryOnly || craftingOnly) {
            // Create crafting panel (canvas-based)
            this.craftingPanel = document.createElement('div');
            this.craftingPanel.id = 'craftingPanel';
            this.craftingPanel.className = 'crafting-panel';
            this.craftingPanel.style.display = 'none';
            this.canvasCraftingPanel = new crafting_panel_1.CanvasCraftingPanel(this.game);
            this.canvasCraftingPanel.attachTo(this.craftingPanel);
            this.canvasCraftingPanel.onClose = () => this.closeCrafting();
            this.canvasCraftingPanel.onCraft = () => this.craftItems();
            this.canvasCraftingPanel.onItemClick = (rarity, itemType, shiftKey) => {
                this.handleCraftingItemClick(rarity, itemType, shiftKey);
            };
            this.canvasCraftingPanel.onSlotClick = () => {
                this.removeCraftingBatch();
            };
            document.body.appendChild(this.craftingPanel);
        } // end crafting panel creation
        if (!craftingOnly) {
            // Mob gallery panel — slim DOM wrapper that hosts the canvas-based
            // CanvasMobGalleryPanel. Wrapper carries the slide-in animation and
            // positioning; the canvas paints all content (title, cells, scrollbar,
            // tooltip).
            this.mobGalleryPanel = document.createElement('div');
            this.mobGalleryPanel.id = 'mobGalleryPanel';
            this.mobGalleryPanel.className = 'mob-gallery-panel';
            this.mobGalleryPanel.style.display = 'none';
            this.mobGalleryPanel.style.padding = '0';
            this.mobGalleryPanel.style.background = 'transparent';
            this.mobGalleryPanel.style.border = 'none';
            this.mobGalleryPanel.style.overflow = 'visible';
            this.canvasMobGalleryPanel = new mob_gallery_panel_1.CanvasMobGalleryPanel();
            this.canvasMobGalleryPanel.attachTo(this.mobGalleryPanel);
            this.canvasMobGalleryPanel.onClose = () => this.closeMobGallery();
            document.body.appendChild(this.mobGalleryPanel);
        } // end !craftingOnly
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
            .mob-gallery-panel {
                position: fixed;
                top: 33.33vh; /* Start at 1/3 from top, leaving top empty */
                left: 100px; /* Aligned with chat */
                width: 700px;
                height: 66.67vh; /* 2/3 of viewport height */
                background: #e6d64c;
                border: 4px solid #a89d36;
                border-radius: 3px;
                transform: translateY(100vh); /* Start off-screen below */
                transition: transform 0.3s ease-out;
                z-index: 1000;
                padding: 20px;
                box-sizing: border-box;
                color: white;
                display: flex;
                flex-direction: column;
            }
            .mob-gallery-panel.open {
                transform: translateY(0); /* Slide up from the bottom */
            }
            .mob-gallery-content {
                color: white;
            }
            .mob-gallery-grid {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .mob-gallery-header-row,
            .mob-gallery-row {
                display: grid;
                gap: 0;
                margin: 0;
                padding: 0;
            }
            .mob-gallery-header {
                padding: 8px;
                margin: 0;
                text-align: center;
                font-weight: bold;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 5px;
            }
            .mob-gallery-type-cell {
                padding: 8px;
                margin: 0;
                display: flex;
                align-items: center;
                font-weight: bold;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 5px;
            }
            .mob-gallery-cell {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 0;
                border-radius: 5px;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .mob-gallery-cell:hover {
                transform: scale(1.1);
                box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
                z-index: 10;
            }
            .mob-gallery-cell svg {
                width: 40px;
                height: 40px;
            }
            .inventory-tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 15px;
                padding: 10px;
                border-bottom: 2px solid #444;
            }
            .inventory-tab {
                padding: 8px 16px;
                background: #666;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                transition: background 0.2s;
            }
            .inventory-tab:hover {
                background: #777;
            }
            .inventory-tab.active {
                background: #4CAF50;
            }
        `;
        document.head.appendChild(style);
        // Setup drag and drop
        if (!mobGalleryOnly || craftingOnly) {
            this.setupDragAndDrop();
        }
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
    closeInventory() {
        if (!this.inventoryPanel || !this.isInventoryOpen)
            return;
        this.inventoryPanel.classList.remove('open');
        this.showChat();
        this.invalidateInventoryCache();
        this.canvasInventoryPanel?.stop();
        setTimeout(() => {
            if (this.inventoryPanel) {
                this.inventoryPanel.style.display = 'none';
            }
        }, 300);
        this.isInventoryOpen = false;
    }
    closeCrafting() {
        if (!this.craftingPanel || !this.isCraftingOpen)
            return;
        this.craftingPanel.classList.remove('open');
        this.showChat();
        this.clearCraftingSuccessDisplay();
        this.canvasCraftingPanel?.stop();
        setTimeout(() => {
            if (this.craftingPanel) {
                this.craftingPanel.style.display = 'none';
            }
        }, 300);
        this.isCraftingOpen = false;
    }
    closeMobGallery() {
        if (!this.mobGalleryPanel || !this.isMobGalleryOpen)
            return;
        this.mobGalleryPanel.classList.remove('open');
        this.showChat();
        this.canvasMobGalleryPanel?.stop();
        setTimeout(() => {
            if (this.mobGalleryPanel) {
                this.mobGalleryPanel.style.display = 'none';
            }
        }, 300);
        this.isMobGalleryOpen = false;
    }
    toggleInventory() {
        if (!this.inventoryPanel)
            return;
        const isOpen = this.inventoryPanel.style.display !== 'none' && this.inventoryPanel.style.display !== '';
        if (!isOpen) {
            this.inventoryPanel.style.display = 'flex';
            this.hideChat();
            setTimeout(() => {
                this.inventoryPanel?.classList.add('open');
            }, 10);
            this.canvasInventoryPanel?.start();
            this.updateInventoryDisplay();
        }
        else {
            this.inventoryPanel.classList.remove('open');
            this.showChat();
            this.invalidateInventoryCache();
            this.canvasInventoryPanel?.stop();
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
            // Clear success display when opening
            this.clearCraftingSuccessDisplay();
            this.craftingPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.craftingPanel?.classList.add('open');
            }, 10);
            this.canvasCraftingPanel?.start();
            this.updateCraftingDisplay();
        }
        else {
            this.craftingPanel.classList.remove('open');
            this.showChat();
            // Clear success display when closing
            this.clearCraftingSuccessDisplay();
            this.canvasCraftingPanel?.stop();
            setTimeout(() => {
                if (this.craftingPanel) {
                    this.craftingPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isCraftingOpen = !isOpen;
    }
    toggleMobGallery() {
        if (!this.mobGalleryPanel)
            return;
        const isOpen = this.mobGalleryPanel.style.display === 'block';
        if (!isOpen) {
            this.mobGalleryPanel.style.display = 'block';
            this.hideChat();
            setTimeout(() => {
                this.mobGalleryPanel?.classList.add('open');
            }, 10);
            this.updateMobGalleryDisplay();
            this.canvasMobGalleryPanel?.start();
            this.hideMobGalleryNotification();
        }
        else {
            this.mobGalleryPanel.classList.remove('open');
            this.showChat();
            this.canvasMobGalleryPanel?.stop();
            setTimeout(() => {
                if (this.mobGalleryPanel) {
                    this.mobGalleryPanel.style.display = 'none';
                }
            }, 300);
        }
        this.isMobGalleryOpen = !isOpen;
    }
    updateMobGalleryIfOpen() {
        // console.log('[MobGallery] updateMobGalleryIfOpen called', { 
        //     isMobGalleryOpen: this.isMobGalleryOpen, 
        //     hasPanel: !!this.mobGalleryPanel 
        // });
        if (this.isMobGalleryOpen && this.mobGalleryPanel) {
            // Instead of auto-updating, show notification to reopen
            this.showMobGalleryNotification();
        }
        else {
            // console.log('[MobGallery] Gallery not open or panel missing');
        }
    }
    showMobGalleryNotification() {
        if (!this.mobGalleryPanel) {
            // console.warn('[MobGallery] Panel not found when trying to show notification');
            return;
        }
        const notification = this.mobGalleryPanel.querySelector('#mobGalleryNotification');
        if (notification) {
            notification.style.display = 'block';
            // console.log('[MobGallery] Notification shown');
        }
        else {
            // console.warn('[MobGallery] Notification element not found');
        }
    }
    hideMobGalleryNotification() {
        if (!this.mobGalleryPanel)
            return;
        const notification = this.mobGalleryPanel.querySelector('#mobGalleryNotification');
        if (notification) {
            notification.style.display = 'none';
        }
    }
    updateMobGalleryDisplay() {
        if (!this.canvasMobGalleryPanel)
            return;
        const player = this.game.getLocalPlayer();
        this.canvasMobGalleryPanel.setKills(player?.mobKills || {});
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
                item.onCooldown = true; // New petals should start on cooldown
            }
        }
        // Ensure loadout is padded to LOADOUT_SLOTS length (supports both primary and secondary rows)
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(player.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = player.loadout[i] || null;
        }
        this.removeItem(rarity, type, 1);
        const existingItem = newLoadout[loadoutSlot];
        if (existingItem && existingItem.rarity) {
            const existingKey = existingItem.type === 'petal' ? `${existingItem.type}_${existingItem.petalType}` : existingItem.type;
            this.addItem(existingItem.rarity, existingKey, 1);
        }
        newLoadout[loadoutSlot] = item;
        player.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
        this.game.getSocket()?.emit('updateLoadout', {
            loadout: newLoadout,
            inventory: player.inventory
        });
        window.dispatchEvent(new CustomEvent('loadout:equip'));
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
        // Petals cannot be used as consumables (except yggdrasil and splitter which can be used)
        if (item.type === 'petal' && item.petalType !== 'yggdrasil' && item.petalType !== 'splitter') {
            return;
        }
        // Yggdrasil petals are always active - no need to emit useItem
        if (item.type === 'petal' && item.petalType === 'yggdrasil') {
            return;
        }
        this.game.getSocket()?.emit('useItem', {
            type: item.type,
            rarity: item.rarity,
            petalType: item.petalType
        });
        const rarityMultipliers = {
            common: 1,
            uncommon: 1.5,
            rare: 2,
            epic: 2.5,
            legendary: 3,
            mythic: 4,
            ultra: 5,
            super: 6,
            unique: 7,
            apex: 8
        };
        const multiplier = item.rarity ? rarityMultipliers[item.rarity] : 1;
        switch (item.type) {
            case 'health_potion':
                break;
            case 'speed_boost':
                break;
            case 'shield':
                break;
        }
        // Trigger canvas loadout cooldown animation
        {
            let cooldownTime = 10000 * (1 / multiplier);
            // Special cooldown for yggdrasil petals
            if (item.type === 'petal' && item.petalType === 'yggdrasil') {
                const petalStats = this.game.getPetalStats?.(item.petalType, item.rarity);
                if (petalStats) {
                    cooldownTime = petalStats.cooldown;
                }
            }
            const loadoutBar = this.game.loadoutBar;
            if (loadoutBar && typeof loadoutBar.triggerCooldown === 'function') {
                loadoutBar.triggerCooldown(slot, cooldownTime);
            }
        }
        if (this.isInventoryOpen) {
            this.updateInventoryDisplay();
        }
        this.updateLoadoutDisplay();
    }
    updateLoadoutDisplay() {
        // Canvas loadout bar redraws every frame from player.loadout.
        // Retained as a no-op for callers expecting to refresh visuals.
        return;
    }
    createDragCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = 50;
        canvas.height = 50;
        canvas.style.cssText = `
            position: fixed;
            width: 50px;
            height: 50px;
            pointer-events: none;
            z-index: 10000;
            display: none;
            opacity: 0.85;
        `;
        document.body.appendChild(canvas);
        return canvas;
    }
    renderDragCanvas(rarity, itemType) {
        if (!this.dragCanvas)
            return;
        const ctx = this.dragCanvas.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, 50, 50);
        // Draw background with rarity color
        const bgColor = rarity ? (this.ITEM_RARITY_COLORS[rarity] || '#666') : '#666';
        const borderColor = rarity ? this.darkenColor(bgColor) : '#444';
        ctx.fillStyle = bgColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(1.5, 1.5, 47, 47, 5);
        ctx.fill();
        ctx.stroke();
        // Draw the item image
        if (itemType && itemType.startsWith('petal_')) {
            const petalType = itemType.replace('petal_', '');
            const petalCanvas = this.game.getPetalCanvas?.(petalType, rarity || 'common', Date.now());
            if (petalCanvas) {
                const stats = (0, petals_1.getPetalStats)(petalType, rarity || 'common');
                (0, petal_icon_1.drawPetalGroup)(ctx, petalCanvas, stats?.count, 25, 25, 30);
            }
        }
        else if (itemType) {
            const dataUrl = this.game.getItemSpriteDataUrl?.(itemType);
            if (dataUrl) {
                const img = new Image();
                img.src = dataUrl;
                // Draw immediately if cached
                if (img.complete) {
                    ctx.drawImage(img, 10, 10, 30, 30);
                }
            }
        }
    }
    /**
     * Called by Game when the user starts dragging a petal out of the canvas loadout bar.
     * The canvas loadout bar handles its own visual for the dragged slot; we just sync state
     * here so the document-level mouseup routes the drop correctly.
     */
    beginCanvasLoadoutDrag(slotIndex) {
        this.isDragging = true;
        this.dragSource = { type: 'loadout', slotIndex };
        this.dragStartElement = null;
        this.hideTooltip();
        // Also render the dragged item into the DOM overlay canvas so it's visible
        // over the inventory panel (which sits above the game canvas).
        if (!this.dragCanvas)
            this.dragCanvas = this.createDragCanvas();
        const player = this.game.getLocalPlayer();
        const item = player?.loadout?.[slotIndex];
        if (item) {
            const itemKey = item.type === 'petal' ? `petal_${item.petalType}` : item.type;
            this.renderDragCanvas(item.rarity, itemKey);
            this.dragCanvas.style.display = 'block';
        }
    }
    startDrag(e, source, sourceElement) {
        this.isDragging = true;
        this.dragSource = source;
        this.dragStartElement = sourceElement;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        if (!this.dragCanvas) {
            this.dragCanvas = this.createDragCanvas();
        }
        // Render the item onto the drag canvas
        if (source?.type === 'inventory') {
            this.renderDragCanvas(source.rarity, source.itemType);
        }
        else if (source?.type === 'loadout') {
            const player = this.game.getLocalPlayer();
            const item = player?.loadout[source.slotIndex];
            if (item) {
                const itemKey = item.type === 'petal' ? `petal_${item.petalType}` : item.type;
                this.renderDragCanvas(item.rarity, itemKey);
            }
        }
        // Position and show
        this.dragCanvas.style.display = 'block';
        this.dragCanvas.style.left = `${e.clientX - 25}px`;
        this.dragCanvas.style.top = `${e.clientY - 25}px`;
        // Dim the source element
        if (sourceElement)
            sourceElement.style.opacity = '0.5';
        // Hide tooltip
        this.hideTooltip();
    }
    onDragMove(e) {
        if (!this.isDragging || !this.dragCanvas)
            return;
        this.dragCanvas.style.left = `${e.clientX - 25}px`;
        this.dragCanvas.style.top = `${e.clientY - 25}px`;
        // Update drag-over highlights
        this.updateDragHighlights(e);
    }
    updateDragHighlights(e) {
        // Clear all existing highlights
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        const elemUnder = document.elementFromPoint(e.clientX, e.clientY);
        if (!elemUnder)
            return;
        const loadoutSlot = elemUnder.closest('.loadout-slot');
        if (loadoutSlot) {
            loadoutSlot.classList.add('drag-over');
            return;
        }
        const inventoryGrid = elemUnder.closest('.inventory-grid');
        if (inventoryGrid && this.dragSource?.type === 'loadout') {
            inventoryGrid.classList.add('drag-over');
        }
    }
    endDrag(e) {
        if (!this.isDragging)
            return;
        // Clear highlights
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        // Hide drag canvas
        if (this.dragCanvas) {
            this.dragCanvas.style.display = 'none';
        }
        // Restore source element opacity
        if (this.dragStartElement) {
            this.dragStartElement.style.opacity = '';
        }
        // If mouse barely moved, treat as a click: equip inventory item to first empty loadout slot
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        const movedDistSq = dx * dx + dy * dy;
        const isClick = movedDistSq < this.CLICK_DRAG_THRESHOLD * this.CLICK_DRAG_THRESHOLD;
        if (isClick && this.dragSource?.type === 'inventory' && this.dragSource.rarity && this.dragSource.itemType) {
            const player = this.game.getLocalPlayer();
            if (player && Array.isArray(player.loadout)) {
                let emptySlot = -1;
                const CANVAS_SLOT_COUNT = 20;
                for (let i = 0; i < CANVAS_SLOT_COUNT; i++) {
                    if (!player.loadout[i]) {
                        emptySlot = i;
                        break;
                    }
                }
                if (emptySlot >= 0) {
                    this.equipItemToLoadout(this.dragSource.rarity, this.dragSource.itemType, emptySlot);
                }
            }
            const canvasBarRef = this.game.loadoutBar;
            if (canvasBarRef && canvasBarRef.endDrag)
                canvasBarRef.endDrag();
            this.isDragging = false;
            this.dragSource = null;
            this.dragStartElement = null;
            return;
        }
        // Canvas loadout bar hit-test (in canvas-local coordinates)
        const canvasBar = this.game.loadoutBar;
        const gameCanvas = this.game.canvas;
        let canvasHit = -1;
        if (canvasBar && gameCanvas && canvasBar.isVisible && canvasBar.isVisible()) {
            const r = gameCanvas.getBoundingClientRect();
            const sx = e.clientX - r.left;
            const sy = e.clientY - r.top;
            canvasHit = canvasBar.hitTest(sx, sy); // -1 | 0..19 slot | 20 trash
        }
        // Determine drop target. The inventory is now a single canvas, so
        // we test containment against the canvas itself rather than walking
        // up DOM ancestors looking for an .inventory-grid.
        const droppedOnInventoryCanvas = !!this.canvasInventoryPanel?.containsClient(e.clientX, e.clientY);
        const TRASH_INDEX = 20; // matches LOADOUT_SLOT_COUNT in graphics/loadout-bar.ts
        if (canvasHit === TRASH_INDEX) {
            // Drop on trash: return loadout item to inventory
            if (this.dragSource?.type === 'loadout' && this.dragSource.slotIndex !== undefined) {
                this.moveItemToInventory(this.dragSource.slotIndex);
            }
        }
        else if (canvasHit >= 0) {
            const slotIndex = canvasHit;
            if (this.dragSource?.type === 'inventory' && this.dragSource.rarity && this.dragSource.itemType) {
                this.equipItemToLoadout(this.dragSource.rarity, this.dragSource.itemType, slotIndex);
            }
            else if (this.dragSource?.type === 'loadout' && this.dragSource.slotIndex !== undefined) {
                if (this.dragSource.slotIndex !== slotIndex) {
                    this.swapLoadoutItems(this.dragSource.slotIndex, slotIndex);
                }
            }
        }
        else if (droppedOnInventoryCanvas && this.dragSource?.type === 'loadout' && this.dragSource.slotIndex !== undefined) {
            this.moveItemToInventory(this.dragSource.slotIndex);
        }
        else if (this.dragSource?.type === 'loadout' && this.dragSource.slotIndex !== undefined) {
            // Dropped outside any valid target — return to inventory
            this.moveItemToInventory(this.dragSource.slotIndex);
        }
        // Release any canvas loadout drag state
        if (canvasBar && canvasBar.endDrag)
            canvasBar.endDrag();
        // Reset state
        this.isDragging = false;
        this.dragSource = null;
        this.dragStartElement = null;
    }
    setupDragAndDrop() {
        // Global mouse move and mouse up for drag operations
        document.addEventListener('mousemove', (e) => {
            this.onDragMove(e);
        });
        document.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.endDrag(e);
            }
        });
        // Right-click on the crafting canvas removes a batch of 5
        this.craftingPanel?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.removeCraftingBatch();
        });
    }
    swapLoadoutItems(fromSlot, toSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Pad to full loadout length so secondary-row swaps always have valid targets
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(player.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = player.loadout[i] || null;
        }
        [newLoadout[fromSlot], newLoadout[toSlot]] = [newLoadout[toSlot], newLoadout[fromSlot]];
        player.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
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
        if (!player.inventory || !Array.isArray(player.inventory)) {
            console.warn('[INVENTORY] Player inventory is not properly initialized:', player.inventory);
            player.inventory = [];
            return;
        }
        // Inventory is now canvas-rendered; the canvas re-lays out from the
        // current player.inventory each animation frame, so there is nothing
        // to push here. We still keep this method for backwards compatibility
        // with the many call sites that invoke it after an inventory mutation.
        if (this.canvasInventoryPanel)
            return;
        const content = this.inventoryPanel.querySelector('.inventory-content');
        if (!content)
            return;
        const rarities = ['apex', 'unique', 'super', 'ultra', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
        const invDict = (0, inventoryCodec_1.inventoryToDict)(player.inventory);
        // Build set of current item keys for removal detection
        const currentKeys = new Set();
        for (const rarity in invDict) {
            for (const type in invDict[rarity]) {
                if (invDict[rarity][type] > 0) {
                    currentKeys.add(`${rarity}:${type}`);
                }
            }
        }
        // If the grid container already exists, do an incremental update
        if (this.inventoryGridContainer && this.inventoryGridContainer.parentNode === content) {
            // Remove items that no longer exist
            for (const [key, entry] of this.renderedItems) {
                if (!currentKeys.has(key)) {
                    entry.element.remove();
                    this.renderedItems.delete(key);
                }
            }
            // Update existing items' counts or add new items
            rarities.forEach(rarity => {
                const items = invDict[rarity];
                const hasItems = items && Object.keys(items).length > 0;
                if (hasItems) {
                    // Ensure rarity row exists
                    let rarityEntry = this.renderedRarityRows.get(rarity);
                    if (!rarityEntry) {
                        rarityEntry = this.createRarityRow(rarity);
                        this.renderedRarityRows.set(rarity, rarityEntry);
                        // Insert in correct order
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
                        const existing = this.renderedItems.get(key);
                        if (existing) {
                            // Just update count text
                            if (existing.count !== count) {
                                const countLabel = existing.element.querySelector('.item-count');
                                if (countLabel)
                                    countLabel.textContent = count.toString();
                                existing.count = count;
                            }
                        }
                        else {
                            // Create new item element
                            const itemElement = this.createInventoryItemElement(rarity, type, count);
                            if (itemElement) {
                                rarityEntry.grid.appendChild(itemElement);
                                this.renderedItems.set(key, { element: itemElement, count });
                            }
                        }
                    });
                }
                else {
                    // Remove rarity row if empty
                    const rarityEntry = this.renderedRarityRows.get(rarity);
                    if (rarityEntry) {
                        rarityEntry.row.remove();
                        this.renderedRarityRows.delete(rarity);
                    }
                }
            });
            return;
        }
        // Full rebuild (first render or after invalidation)
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
    /** Invalidate cached inventory DOM so next updateInventoryDisplay does a full rebuild. */
    invalidateInventoryCache() {
        this.inventoryGridContainer = null;
        this.renderedItems.clear();
        this.renderedRarityRows.clear();
        this.petalDataUrlCache.clear();
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
    createInventoryItemElement(rarity, type, count) {
        const itemElement = document.createElement('div');
        itemElement.className = 'inventory-item';
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
          cursor: grab;
          transition: all 0.2s ease;
          user-select: none;
      `;
        itemElement.addEventListener('mouseover', () => {
            if (!this.isDragging) {
                itemElement.style.transform = 'scale(1.05)';
                itemElement.style.boxShadow = `0 0 10px ${this.ITEM_RARITY_COLORS[rarity]}`;
            }
        });
        itemElement.addEventListener('mouseout', () => {
            if (!this.isDragging) {
                itemElement.style.transform = 'scale(1)';
                itemElement.style.boxShadow = 'none';
            }
        });
        itemElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            e.preventDefault();
            this.startDrag(e, { type: 'inventory', rarity, itemType: type }, itemElement);
        });
        // Handle different item types for display
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
                const cached = this.petalDataUrlCache.get(cacheKey);
                if (cached) {
                    img.src = cached;
                }
                else {
                    const petalCanvas = this.game.getPetalCanvas?.(petalType, rarity, Date.now());
                    if (petalCanvas) {
                        const dataUrl = petalCanvas.toDataURL('image/png');
                        this.petalDataUrlCache.set(cacheKey, dataUrl);
                        img.src = dataUrl;
                    }
                    else {
                        return null;
                    }
                }
                itemElement.appendChild(img);
            }
            else {
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
        }
        else {
            const img = document.createElement('img');
            const dataUrl = this.game.getItemSpriteDataUrl?.(type);
            if (dataUrl) {
                img.src = dataUrl;
            }
            else {
                img.src = `./assets/${type}.png`;
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
    moveItemToInventory(loadoutSlot) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Safety check: ensure loadout exists and slot is within bounds
        if (!player.loadout || !Array.isArray(player.loadout) || loadoutSlot >= this.LOADOUT_SLOTS) {
            console.warn(`[INVENTORY] Invalid loadout access: slot ${loadoutSlot}, loadout:`, player.loadout);
            return;
        }
        const item = player.loadout[loadoutSlot];
        if (!item || !item.rarity)
            return;
        const itemKey = item.type === 'petal' ? `${item.type}_${item.petalType}` : item.type;
        this.addItem(item.rarity, itemKey, 1);
        // Pad to full loadout length so secondary-row removals are preserved
        const newLoadout = new Array(this.LOADOUT_SLOTS).fill(null);
        for (let i = 0; i < Math.min(player.loadout.length, this.LOADOUT_SLOTS); i++) {
            newLoadout[i] = player.loadout[i] || null;
        }
        newLoadout[loadoutSlot] = null;
        player.loadout = newLoadout;
        this.lastLocalLoadoutChange = Date.now();
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
        // Don't allow crafting while animation is playing
        if (this.canvasCraftingPanel?.isAnimating())
            return;
        const itemsToCraftCount = this.craftingItems.length;
        if (itemsToCraftCount < 5 || itemsToCraftCount % 5 !== 0) {
            return;
        }
        console.log('[CLIENT] Sending craftItems request:', { itemCount: this.craftingItems.length });
        // Start the spin animation with the first item info
        const firstItem = this.craftingItems[0];
        const animItem = {
            type: firstItem.type,
            rarity: firstItem.rarity || 'common',
            petalType: firstItem.petalType,
        };
        this.canvasCraftingPanel?.startCraftAnimation(animItem);
        // Send to server
        this.game.getSocket()?.emit('craftItems', { items: this.craftingItems });
        this.craftingItems = [];
        this.updateCraftingDisplay();
    }
    updateCraftingDisplay() {
        if (!this.canvasCraftingPanel)
            return;
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        // Clear success display when updating (e.g., when items change)
        if (this.craftingItems.length === 0) {
            this.clearCraftingSuccessDisplay();
        }
        // Convert craftingItems to CraftingItem[] for the canvas panel
        const craftingItemsForCanvas = this.craftingItems.map(item => ({
            type: item.type,
            rarity: item.rarity || 'common',
            petalType: item.petalType,
        }));
        this.canvasCraftingPanel.setCraftingItems(craftingItemsForCanvas);
        this.canvasCraftingPanel.setSuccessChance(this.calculateSuccessChance());
    }
    showCraftingSuccess(newItem, successCount, petalsReturned = 0) {
        console.log('[INVENTORY] showCraftingSuccess called:', { newItem, successCount, petalsReturned });
        if (!this.canvasCraftingPanel) {
            console.log('[INVENTORY] No crafting panel found');
            return;
        }
        this.successDisplayShownAt = Date.now();
        const rarity = newItem.rarity || 'common';
        if (successCount > 0) {
            this.canvasCraftingPanel.showCraftResult(true, {
                type: newItem.type,
                rarity,
                petalType: newItem.petalType,
                count: successCount,
            }, petalsReturned);
        }
        else {
            // All batches failed
            this.canvasCraftingPanel.showCraftResult(false, null, petalsReturned);
        }
    }
    clearCraftingSuccessDisplay() {
        if (!this.canvasCraftingPanel)
            return;
        // Don't clear if it hasn't been shown for at least 0.5 seconds
        const now = Date.now();
        if (this.successDisplayShownAt > 0 && (now - this.successDisplayShownAt) < 500) {
            const remainingTime = 500 - (now - this.successDisplayShownAt);
            setTimeout(() => {
                this.clearCraftingSuccessDisplay();
            }, remainingTime);
            return;
        }
        this.canvasCraftingPanel.setSuccessResult(null);
        this.successDisplayShownAt = 0;
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
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
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
        // Each equipped clover matching the crafted rarity adds +0.05%
        // success chance — must mirror the server roll in the craftItems
        // handler. Storage slots (10+) don't count.
        const craftRarity = rarities[highestRarityIndex];
        const loadout = this.game.getLocalPlayer()?.loadout ?? [];
        let cloverBonus = 0;
        for (let i = 0; i < Math.min(loadout.length, 10); i++) {
            const slot = loadout[i];
            if (slot && slot.type === 'petal' && slot.petalType === 'clover' && slot.rarity === craftRarity) {
                cloverBonus += 0.05;
            }
        }
        // Halve the chance for each rarity level above common.
        const chance = Math.min(100, baseChance / Math.pow(2, highestRarityIndex) + cloverBonus);
        // Round to 2 decimals so sub-1% chances (e.g. unique->apex 0.25%) and
        // the clover bonus stay visible, and the displayed chance matches the
        // server's actual success roll (server.ts uses the unrounded value).
        return Math.round(chance * 100) / 100;
    }
    cleanup() {
        this.inventoryPanel?.remove();
        this.canvasCraftingPanel?.destroy();
        this.craftingPanel?.remove();
        this.mobGalleryPanel?.remove();
        this.dragCanvas?.remove();
        this.tooltipElement?.remove();
        document.getElementById('loadoutBar')?.remove();
    }
    getItemCount(rarity, type) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return 0;
        return (0, inventoryCodec_1.getItemCount)(player.inventory, rarity, type);
    }
    addItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        (0, inventoryCodec_1.addItem)(player.inventory, rarity, type, count);
    }
    removeItem(rarity, type, count) {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        if (this.getItemCount(rarity, type) >= count) {
            (0, inventoryCodec_1.removeItem)(player.inventory, rarity, type, count);
        }
    }
}
exports.InventoryManager = InventoryManager;
