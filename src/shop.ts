import { Item, ItemWithRarity } from './item';
import { Player, PlayerInventory } from './player';
import { Socket } from './socket';
import { getPetalStats, getAllPetalTypes, RARITY_LEVELS, Rarity } from './petals';
import { Game } from './game';

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

interface ShopItem {
    petalType: string;
    rarity: Rarity;
    price: number;
}

// Shop pricing configuration
const SHOP_PRICES: { [petalType: string]: { [rarity: string]: number } } = {
    basic: {
        common: 10,
        uncommon: 30,
        rare: 90,
        epic: 270,
        legendary: 810,
        mythic: 2430,
        ultra: 7290,
        super: 21870,
        unique: 65610
    },
    rose: {
        common: 15,
        uncommon: 45,
        rare: 135,
        epic: 405,
        legendary: 1215,
        mythic: 3645,
        ultra: 10935,
        super: 32805,
        unique: 98415
    },
    stinger: {
        common: 20,
        uncommon: 60,
        rare: 180,
        epic: 540,
        legendary: 1620,
        mythic: 4860,
        ultra: 14580,
        super: 43740,
        unique: 131220
    },
    light: {
        common: 12,
        uncommon: 36,
        rare: 108,
        epic: 324,
        legendary: 972,
        mythic: 2916,
        ultra: 8748,
        super: 26244,
        unique: 78732
    },
    rock: {
        common: 18,
        uncommon: 54,
        rare: 162,
        epic: 486,
        legendary: 1458,
        mythic: 4374,
        ultra: 13122,
        super: 39366,
        unique: 118098
    }
};

// Default prices for petals not in the config (3x multiplier per rarity)
function getDefaultPrice(petalType: string, rarity: Rarity): number {
    const rarityIndex = RARITY_LEVELS.indexOf(rarity);
    const basePrice = 10;
    return basePrice * Math.pow(3, rarityIndex);
}

function getShopPrice(petalType: string, rarity: Rarity): number {
    return SHOP_PRICES[petalType]?.[rarity] || getDefaultPrice(petalType, rarity);
}

export class ShopManager {
    private game: GameInterface;
    private shopPanel: HTMLDivElement | null = null;
    private isShopOpen: boolean = false;
    private readonly allPetalTypes: string[];
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

    constructor(game: GameInterface) {
        this.game = game;
        this.allPetalTypes = getAllPetalTypes();
        this.initializeShop();
    }

    private initializeShop(): void {
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

    private addShopStyles(): void {
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

    public openShop(): void {
        if (!this.shopPanel) return;
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

    public closeShop(): void {
        if (!this.shopPanel) return;
        this.shopPanel.classList.remove('open');
        setTimeout(() => {
            if (this.shopPanel) {
                this.shopPanel.style.display = 'none';
            }
        }, 300);
        this.isShopOpen = false;
    }

    public isShopOpenState(): boolean {
        return this.isShopOpen;
    }

    public toggleShop(): void {
        if (this.isShopOpen) {
            this.closeShop();
        } else {
            this.openShop();
        }
    }

    private updateShopDisplay(): void {
        const player = this.game.getLocalPlayer();
        if (!player) return;

        const stars = player.stars || 0;
        const starsCountElement = document.getElementById('shopStarsCount');
        if (starsCountElement) {
            starsCountElement.textContent = stars.toString();
        }

        const itemsGrid = document.getElementById('shopItemsGrid');
        if (!itemsGrid) return;

        itemsGrid.innerHTML = '';

        // Generate shop items for all petal types and rarities
        for (const petalType of this.allPetalTypes) {
            // Skip admin petals
            const commonStats = getPetalStats(petalType, 'common');
            if (commonStats?.isAdminPetal) continue;

            for (const rarity of RARITY_LEVELS) {
                const price = getShopPrice(petalType, rarity);
                const stats = getPetalStats(petalType, rarity);
                if (!stats) continue;

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
                } else {
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

    private buyItem(petalType: string, rarity: Rarity, price: number): void {
        const socket = this.game.getSocket();
        if (!socket) return;

        const player = this.game.getLocalPlayer();
        if (!player || (player.stars || 0) < price) {
            return;
        }

        socket.emit('shopBuy', { petalType, rarity, price });
    }

    private redeemCode(): void {
        const codeInput = document.getElementById('shopCodeInput') as HTMLInputElement;
        if (!codeInput) return;

        const code = codeInput.value.trim();
        if (!code) {
            alert('Please enter a code');
            return;
        }

        const socket = this.game.getSocket();
        if (!socket) return;

        socket.emit('redeemCode', { code });
        codeInput.value = '';
    }

    public updateStarsDisplay(): void {
        if (!this.isShopOpen) return;
        this.updateShopDisplay();
    }

    public handlePurchaseSuccess(): void {
        this.updateShopDisplay();
        if (this.game.showFloatingText) {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                this.game.canvas.height / 2,
                'Purchase Successful!',
                '#4a90e2',
                24
            );
        }
    }

    public handlePurchaseError(message: string): void {
        alert(`Purchase failed: ${message}`);
    }

    public handleCodeRedeemSuccess(stars: number): void {
        this.updateShopDisplay();
        if (this.game.showFloatingText) {
            this.game.showFloatingText(
                this.game.canvas.width / 2,
                this.game.canvas.height / 2,
                `+${stars} Stars!`,
                '#ffd700',
                24
            );
        }
    }

    public handleCodeRedeemError(message: string): void {
        alert(`Code redemption failed: ${message}`);
    }
}

