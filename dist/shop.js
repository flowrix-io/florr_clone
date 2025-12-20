"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopManager = void 0;
const petals_1 = require("./petals");
// Shop pricing configuration - single base price per petal type (applies to all rarities)
const SHOP_PRICES = {
    basic: 10,
    rose: 15,
    stinger: 20,
    light: 12,
    rock: 18,
    sand: 14,
    yggdrasil: 120,
    dandelion: 13,
    clover: 16,
    bone: 17,
    cactus: 19,
    poison_cactus: 22,
    iris: 18,
    lightning: 25,
    missile: 21,
    jelly: 20,
    yucca: 15,
    leaf: 14,
    cutter: 50,
    lightning_cutter: 60,
    wing: 23,
    square: 1000,
    golden_leaf: 18,
    blood_leaf: 24,
    target_dummy_egg: 100000000,
};
// Default price for petals not in the config
const DEFAULT_SHOP_PRICE = 10;
function getShopPrice(petalType, rarity) {
    const basePrice = SHOP_PRICES[petalType] || DEFAULT_SHOP_PRICE;
    const rarityIndex = petals_1.RARITY_LEVELS.indexOf(rarity);
    // Multiply by 3.5 for each rarity level and round down
    const multiplier = Math.pow(3.5, rarityIndex);
    return Math.floor(basePrice * multiplier);
}
class ShopManager {
    constructor(game) {
        this.shopPanel = null;
        this.isShopOpen = false;
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
        this.allPetalTypes = (0, petals_1.getAllPetalTypes)();
        this.initializeShop();
    }
    initializeShop() {
        // Create shop panel (matching mob gallery dimensions)
        this.shopPanel = document.createElement('div');
        this.shopPanel.id = 'shopPanel';
        this.shopPanel.className = 'shop-panel';
        this.shopPanel.style.display = 'none';
        const shopContent = document.createElement('div');
        shopContent.className = 'shop-content';
        shopContent.style.cssText = `
            height: 100%;
            overflow-y: auto;
            padding: 10px;
            box-sizing: border-box;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        `;
        const title = document.createElement('h2');
        title.textContent = 'Shop';
        title.style.cssText = 'margin: 0 0 20px 0; text-align: center; color: white; font-size: 24px;';
        shopContent.appendChild(title);
        const starsDisplay = document.createElement('div');
        starsDisplay.id = 'shopStarsDisplay';
        starsDisplay.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: #ffd700;
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 20px;
        `;
        starsDisplay.innerHTML = `
            <span style="font-size: 32px;">⭐</span>
            <span id="shopStarsCount">0</span>
        `;
        shopContent.appendChild(starsDisplay);
        // Code redemption section
        const codeSection = document.createElement('div');
        codeSection.style.cssText = `
            margin-bottom: 20px;
            padding: 15px;
            background: rgba(74, 144, 226, 0.1);
            border-radius: 10px;
            border: 2px solid #4a90e2;
        `;
        const codeTitle = document.createElement('h3');
        codeTitle.textContent = 'Redeem Code';
        codeTitle.style.cssText = 'margin: 0 0 10px 0; color: white; font-size: 18px;';
        codeSection.appendChild(codeTitle);
        const codeInputContainer = document.createElement('div');
        codeInputContainer.style.cssText = 'display: flex; gap: 10px;';
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.placeholder = 'Enter code...';
        codeInput.id = 'shopCodeInput';
        codeInput.style.cssText = `
            flex: 1;
            padding: 10px;
            border: 2px solid #4a90e2;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 16px;
        `;
        const redeemButton = document.createElement('button');
        redeemButton.textContent = 'Redeem';
        redeemButton.style.cssText = `
            padding: 10px 20px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
        `;
        redeemButton.addEventListener('click', () => this.redeemCode());
        codeInputContainer.appendChild(codeInput);
        codeInputContainer.appendChild(redeemButton);
        codeSection.appendChild(codeInputContainer);
        shopContent.appendChild(codeSection);
        // Shop items grid
        const itemsGrid = document.createElement('div');
        itemsGrid.id = 'shopItemsGrid';
        itemsGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, 32px);
            gap: 10px;
            overflow-y: auto;
            flex: 1;
            padding: 10px;
            justify-content: start;
        `;
        shopContent.appendChild(itemsGrid);
        this.shopPanel.appendChild(shopContent);
        document.body.appendChild(this.shopPanel);
        // Add styles
        this.addShopStyles();
    }
    addShopStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .shop-panel {
                position: fixed;
                top: 33.33vh;
                left: -700px;
                width: 700px;
                height: 66.67vh;
                background: #4CAF50;
                transition: transform 0.3s ease-out;
                z-index: 1000;
                padding: 20px;
                box-sizing: border-box;
                color: white;
                display: flex;
                flex-direction: column;
                border-right: 3px solid #388e3c;
            }
            .shop-panel.open {
                transform: translateX(700px);
            }
            .shop-content {
                color: white;
            }
            .shop-item-card {
                width: 32px;
                height: 32px;
                border: 2px solid rgba(0, 0, 0, 0.3);
                border-radius: 4px;
                padding: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            .shop-item-card:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
                border-color: #ffffff;
                z-index: 10;
            }
            .shop-item-card.disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .shop-item-image {
                width: 28px;
                height: 28px;
                border-radius: 0;
                background: rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                margin-top: 1px;
            }
            .shop-item-image canvas,
            .shop-item-image svg {
                width: 28px !important;
                height: 28px !important;
            }
            .shop-item-price {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                color: #ffd700;
                font-size: 8px;
                font-weight: bold;
                text-align: center;
                background: rgba(0, 0, 0, 0.8);
                padding: 1px 0;
                line-height: 1.2;
                height: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .shop-item-price.insufficient {
                color: #e74c3c;
            }
        `;
        document.head.appendChild(style);
    }
    openShop() {
        if (!this.shopPanel)
            return;
        const isOpen = this.shopPanel.style.display === 'block';
        if (!isOpen) {
            this.shopPanel.style.display = 'block';
            setTimeout(() => {
                this.shopPanel?.classList.add('open');
            }, 10);
            this.updateShopDisplay();
        }
        this.isShopOpen = true;
    }
    closeShop() {
        if (!this.shopPanel)
            return;
        this.shopPanel.classList.remove('open');
        setTimeout(() => {
            if (this.shopPanel) {
                this.shopPanel.style.display = 'none';
            }
        }, 300);
        this.isShopOpen = false;
    }
    isShopOpenState() {
        return this.isShopOpen;
    }
    toggleShop() {
        if (this.isShopOpen) {
            this.closeShop();
        }
        else {
            this.openShop();
        }
    }
    updateShopDisplay() {
        const player = this.game.getLocalPlayer();
        if (!player)
            return;
        const stars = player.stars || 0;
        const starsCountElement = document.getElementById('shopStarsCount');
        if (starsCountElement) {
            starsCountElement.textContent = stars.toString();
        }
        const itemsGrid = document.getElementById('shopItemsGrid');
        if (!itemsGrid)
            return;
        itemsGrid.innerHTML = '';
        // Generate shop items for all petal types and rarities
        for (const petalType of this.allPetalTypes) {
            // Skip admin petals
            const commonStats = (0, petals_1.getPetalStats)(petalType, 'common');
            if (commonStats?.isAdminPetal)
                continue;
            for (const rarity of petals_1.RARITY_LEVELS) {
                // Skip unique rarity - not purchasable
                if (rarity === 'unique')
                    continue;
                const price = getShopPrice(petalType, rarity);
                const stats = (0, petals_1.getPetalStats)(petalType, rarity);
                if (!stats)
                    continue;
                const itemCard = document.createElement('div');
                itemCard.className = 'shop-item-card';
                itemCard.title = `${stats.name} (${rarity})`;
                // Set background color to rarity color
                const rarityColor = this.ITEM_RARITY_COLORS[rarity] || '#ffffff';
                itemCard.style.backgroundColor = rarityColor;
                if (stars < price) {
                    itemCard.classList.add('disabled');
                }
                // Item image container (32x32)
                const itemImage = document.createElement('div');
                itemImage.className = 'shop-item-image';
                if (this.game.getPetalCanvas) {
                    const canvas = this.game.getPetalCanvas(petalType, rarity);
                    if (canvas) {
                        itemImage.appendChild(canvas);
                    }
                }
                else {
                    itemImage.style.background = stats.color || '#ffffff';
                }
                itemCard.appendChild(itemImage);
                // Price at bottom
                const priceDiv = document.createElement('div');
                priceDiv.className = `shop-item-price ${stars < price ? 'insufficient' : ''}`;
                priceDiv.textContent = price.toString();
                itemCard.appendChild(priceDiv);
                // Buy button
                if (stars >= price) {
                    itemCard.addEventListener('click', () => this.buyItem(petalType, rarity, price));
                }
                itemsGrid.appendChild(itemCard);
            }
        }
    }
    buyItem(petalType, rarity, price) {
        const socket = this.game.getSocket();
        if (!socket)
            return;
        const player = this.game.getLocalPlayer();
        if (!player || (player.stars || 0) < price) {
            return;
        }
        socket.emit('shopBuy', { petalType, rarity, price });
    }
    redeemCode() {
        const codeInput = document.getElementById('shopCodeInput');
        if (!codeInput)
            return;
        const code = codeInput.value.trim();
        if (!code) {
            alert('Please enter a code');
            return;
        }
        const socket = this.game.getSocket();
        if (!socket)
            return;
        socket.emit('redeemCode', { code });
        codeInput.value = '';
    }
    updateStarsDisplay() {
        if (!this.isShopOpen)
            return;
        this.updateShopDisplay();
    }
    handlePurchaseSuccess() {
        this.updateShopDisplay();
        if (this.game.showFloatingText) {
            this.game.showFloatingText(this.game.canvas.width / 2, this.game.canvas.height / 2, 'Purchase Successful!', '#4a90e2', 24);
        }
    }
    handlePurchaseError(message) {
        alert(`Purchase failed: ${message}`);
    }
    handleCodeRedeemSuccess(stars) {
        this.updateShopDisplay();
        if (this.game.showFloatingText) {
            this.game.showFloatingText(this.game.canvas.width / 2, this.game.canvas.height / 2, `+${stars} Stars!`, '#ffd700', 24);
        }
    }
    handleCodeRedeemError(message) {
        alert(`Code redemption failed: ${message}`);
    }
}
exports.ShopManager = ShopManager;
