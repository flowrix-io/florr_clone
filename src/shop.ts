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

// Shop pricing configuration - single base price per petal type (applies to all rarities)
const SHOP_PRICES: { [petalType: string]: number } = {
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

function getShopPrice(petalType: string, rarity: Rarity): number {
    const basePrice = SHOP_PRICES[petalType] || DEFAULT_SHOP_PRICE;
    const rarityIndex = RARITY_LEVELS.indexOf(rarity);
    // Multiply by 3.5 for each rarity level and round down
    const multiplier = Math.pow(3.5, rarityIndex);
    return Math.floor(basePrice * multiplier);
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

        // Tabs
        const tabsContainer = document.createElement('div');
        tabsContainer.style.cssText = `
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 2px solid rgba(255, 255, 255, 0.3);
        `;

        const shopTab = document.createElement('button');
        shopTab.textContent = 'Shop';
        shopTab.className = 'shop-tab active';
        shopTab.style.cssText = `
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: none;
            border-bottom: 3px solid #ffffff;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            transition: all 0.3s ease;
        `;

        const challengesTab = document.createElement('button');
        challengesTab.textContent = 'Challenges';
        challengesTab.className = 'shop-tab';
        challengesTab.style.cssText = `
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-bottom: 3px solid transparent;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            transition: all 0.3s ease;
        `;

        tabsContainer.appendChild(shopTab);
        tabsContainer.appendChild(challengesTab);
        shopContent.appendChild(tabsContainer);

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

        // Challenges display
        const challengesContainer = document.createElement('div');
        challengesContainer.id = 'shopChallengesContainer';
        challengesContainer.style.cssText = `
            display: none;
            overflow-y: auto;
            flex: 1;
            padding: 10px;
        `;

        shopContent.appendChild(itemsGrid);
        shopContent.appendChild(challengesContainer);
        this.shopPanel.appendChild(shopContent);
        document.body.appendChild(this.shopPanel);

        // Tab switching
        shopTab.addEventListener('click', () => {
            shopTab.classList.add('active');
            shopTab.style.background = 'rgba(255, 255, 255, 0.2)';
            shopTab.style.color = 'white';
            shopTab.style.borderBottom = '3px solid #ffffff';
            challengesTab.classList.remove('active');
            challengesTab.style.background = 'rgba(255, 255, 255, 0.1)';
            challengesTab.style.color = 'rgba(255, 255, 255, 0.7)';
            challengesTab.style.borderBottom = '3px solid transparent';
            itemsGrid.style.display = 'grid';
            challengesContainer.style.display = 'none';
        });

        challengesTab.addEventListener('click', () => {
            challengesTab.classList.add('active');
            challengesTab.style.background = 'rgba(255, 255, 255, 0.2)';
            challengesTab.style.color = 'white';
            challengesTab.style.borderBottom = '3px solid #ffffff';
            shopTab.classList.remove('active');
            shopTab.style.background = 'rgba(255, 255, 255, 0.1)';
            shopTab.style.color = 'rgba(255, 255, 255, 0.7)';
            shopTab.style.borderBottom = '3px solid transparent';
            itemsGrid.style.display = 'none';
            challengesContainer.style.display = 'block';
            this.updateChallengesDisplay();
        });

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
                // Skip unique rarity - not purchasable
                if (rarity === 'unique') continue;
                
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

        // Get petal stats for display
        const stats = getPetalStats(petalType, rarity);
        const petalName = stats?.name || petalType;
        
        // Show confirmation prompt
        const confirmMessage = `Buy ${petalName} (${rarity}) for ${price.toLocaleString()} stars?`;
        if (!confirm(confirmMessage)) {
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

    private updateChallengesDisplay(): void {
        const challengesContainer = document.getElementById('shopChallengesContainer');
        if (!challengesContainer) return;

        const player = this.game.getLocalPlayer();
        const currentStars = player?.stars || 0;

        challengesContainer.innerHTML = '';

        const title = document.createElement('h3');
        title.textContent = 'Earn Stars by Defeating Mythic+ Mobs';
        title.style.cssText = `
            margin: 0 0 10px 0;
            color: white;
            font-size: 20px;
            text-align: center;
        `;
        challengesContainer.appendChild(title);

        const starsInfo = document.createElement('div');
        starsInfo.innerHTML = `<span style="font-size: 24px;">⭐</span> <span style="font-weight: bold; font-size: 18px;">${currentStars.toLocaleString()} Stars</span>`;
        starsInfo.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: #ffd700;
            margin-bottom: 20px;
            font-size: 18px;
        `;
        challengesContainer.appendChild(starsInfo);

        const challengeTiers = [
            { tier: 'mythic', stars: 1, color: '#1fdbde', description: 'Defeat any Mythic tier mob' },
            { tier: 'ultra', stars: 5, color: '#de1f65', description: 'Defeat any Ultra tier mob' },
            { tier: 'super', stars: 25, color: '#2bffa4', description: 'Defeat any Super tier mob' },
            { tier: 'unique', stars: 100, color: '#bf00ff', description: 'Defeat any Unique tier mob' }
        ];

        for (const challenge of challengeTiers) {
            const challengeCard = document.createElement('div');
            challengeCard.style.cssText = `
                background: ${challenge.color};
                border: 2px solid rgba(0, 0, 0, 0.3);
                border-radius: 10px;
                padding: 15px;
                margin-bottom: 15px;
                color: white;
            `;

            const tierName = document.createElement('div');
            tierName.textContent = challenge.tier.charAt(0).toUpperCase() + challenge.tier.slice(1) + ' Challenge';
            tierName.style.cssText = `
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 10px;
            `;
            challengeCard.appendChild(tierName);

            const description = document.createElement('div');
            description.textContent = challenge.description;
            description.style.cssText = `
                font-size: 14px;
                margin-bottom: 10px;
                opacity: 0.9;
            `;
            challengeCard.appendChild(description);

            const reward = document.createElement('div');
            reward.innerHTML = `<span style="font-size: 20px;">⭐</span> <span style="font-weight: bold; font-size: 16px;">${challenge.stars} Star${challenge.stars !== 1 ? 's' : ''}</span>`;
            reward.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                color: #ffd700;
            `;
            challengeCard.appendChild(reward);

            challengesContainer.appendChild(challengeCard);
        }
    }

    public updateStarsDisplay(): void {
        if (!this.isShopOpen) return;
        this.updateShopDisplay();
        // Also update challenges display if challenges tab is active
        const challengesContainer = document.getElementById('shopChallengesContainer');
        if (challengesContainer && challengesContainer.style.display !== 'none') {
            this.updateChallengesDisplay();
        }
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

