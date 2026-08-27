"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRarityRow = createRarityRow;
exports.appendPetalNameLabel = appendPetalNameLabel;
exports.createCountLabel = createCountLabel;
/**
 * DOM builders shared by the in-game inventory and the title-screen inventory.
 *
 * InventoryManager (inventory.ts) and the title screen's own manager
 * (title_screen/inventory_manager.ts) were forked from one another. Their drag
 * handling genuinely differs — the in-game one drives a custom mouse drag, the
 * title screen uses HTML5 drag plus click-to-equip — but the markup they build
 * around it was identical, down to the CSS strings. That markup lives here.
 */
const petals_1 = require("../petals");
const petal_display_1 = require("./petal-display");
/** A rarity section: a labelled header above a wrapping item grid. */
function createRarityRow(rarity) {
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
          color: ${petals_1.ITEM_RARITY_COLORS[rarity]};
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
          border: 1px solid ${petals_1.ITEM_RARITY_COLORS[rarity]}40;
      `;
    rarityRow.appendChild(grid);
    return { row: rarityRow, grid };
}
/**
 * Appends the outlined petal-name caption to an item slot.
 *
 * No-op for non-petal items and for petal types that format to an empty name.
 */
function appendPetalNameLabel(itemElement, petalType) {
    const petalName = (0, petal_display_1.formatPetalName)(petalType);
    if (!petalName)
        return;
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
/** The stack-count badge in an item slot's top-right corner. */
function createCountLabel(count) {
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
    return countLabel;
}
