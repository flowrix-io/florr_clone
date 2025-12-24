// This file should not be updated every time
// It should only be updated when there are major changes
export interface ChangelogEntry {
    date: string;
    changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        date: 'October 18, 2025',
        changes: [
            'Added changelog'
        ]
    },
    {
        date: 'October 19, 2025',
        changes: [
            'Added 3 new biomes',
            'New admin petal: Sparkle',
            'New admin command: spawn_special_mobs',
        ]
    },
    {
        date: 'October 22, 2025',
        changes: [
            'New petal: Lightning',
            'New petal: Iris',
            'It is discovered that mobs have round hitboxes, so the setting is now more accurate'
        ]
    },
    {
        date: 'October 24, 2025',
        changes: [
            'Overhauled the settings menu',
            'Ultra+ petals now have particle effects',
            'Shaders are now available in the settings menu',
        ]
    },
    {
        date: 'November 20, 2025',
        changes: [
            'New biome: Jungle',
        ]
    },
    {
        date: 'November 21, 2025',
        changes: [
            'Some recolors and tweaks to the graphics',
            'New petal: Jelly',
            'fixes'
        ]
    },
    {
        date: 'November 22, 2025',
        changes: [
            'New petal: Yucca',
            'New petal: Leaf',
            'Target dummy now shows DPS',
        ]
    },
    {
        date: 'November 23, 2025',
        changes: [
            'Added skills system',
        ]
    },
    {
        date: 'November 29, 2025',
        changes: [
            'New mob: Item Spawner',
            'New petal: Cutter',
            'New petal: Lightning Cutter',
            'New petal: Wing',
            'New biome: Sewers',
        ]
    },
    {
        date: 'December 3, 2025',
        changes: [
            'Some UI changes',
            'Recolored some biomes',
            'New petal: Square',
            'A global notification is now shown when a rare petal is crafted',
        ]
    },
    {
        date: 'December 10, 2025',
        changes: [
            'New petal: Blood Leaf, it damages the player when exploding',
            'Healing and self-damage now scales by rarity',
            'Cactus and Poison Cactus now give max health to the player',
        ]
    },
    {
        date: 'December 11, 2025',
        changes: [
            'New petal: Ant Egg',
            'New petal: Fire Ant Egg',
            'Some rebalancing of mobs',
        ]
    },
    {
        date: 'December 15, 2025',
        changes: [
            'All mobs now have eggs',
            'Added mob gallery',
            'Some optimizations'
        ]
    },
    {
        date: 'December 18, 2025',
        changes: [
            'New ant hell map',
        ]
    },
    {
        date: 'December 20, 2025',
        changes: [
            'Added shop, note that you cannot buy petals with real money, only stars',
            'Stars are awarded for killing mobs or claiming codes',
            'New admin command: generate_code',
        ]
    },
    {
        date: 'December 23, 2025',
        changes: [
            'Added notifications system, check it to see when there might be an event',
            'Fixed a negative petal health bug',
            'New admin command: clear_notifications',
            'New admin command: notification',
        ]
    }
];

export class ChangelogManager {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isOpen: boolean = false;
    private scrollY: number = 0;
    private closeButtonBounds: { x: number; y: number; width: number; height: number } | null = null;
    private panelBounds: { x: number; y: number; width: number; height: number } | null = null;
    private contentHeight: number = 0;
    private readonly PANEL_X = 20;
    private readonly PANEL_Y = 72;
    private readonly PANEL_WIDTH = 600;
    private readonly PANEL_HEIGHT = 500;
    private readonly PADDING = 20;
    private readonly SCROLLBAR_WIDTH = 10;
    private isDragging: boolean = false;
    private dragStartY: number = 0;
    private dragStartScroll: number = 0;

    constructor() {
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }

    public setCanvas(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }

    private setupMouseListeners(): void {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            const rect = this.canvas!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check close button
            if (this.closeButtonBounds && 
                x >= this.closeButtonBounds.x && x <= this.closeButtonBounds.x + this.closeButtonBounds.width &&
                y >= this.closeButtonBounds.y && y <= this.closeButtonBounds.y + this.closeButtonBounds.height) {
                this.hide();
                return;
            }

            // Check scrollbar
            if (this.panelBounds && this.contentHeight > this.PANEL_HEIGHT - 40) {
                const scrollbarX = this.PANEL_X + this.PANEL_WIDTH - this.SCROLLBAR_WIDTH - 5;
                if (x >= scrollbarX && x <= scrollbarX + this.SCROLLBAR_WIDTH &&
                    y >= this.PANEL_Y + 40 && y <= this.PANEL_Y + this.PANEL_HEIGHT - 5) {
                    this.isDragging = true;
                    this.dragStartY = y;
                    this.dragStartScroll = this.scrollY;
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isOpen) return;
            if (this.isDragging) {
                const rect = this.canvas!.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const deltaY = y - this.dragStartY;
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
                const scrollRatio = deltaY / (this.PANEL_HEIGHT - 45);
                this.scrollY = Math.max(0, Math.min(maxScroll, this.dragStartScroll + scrollRatio * maxScroll));
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        this.canvas.addEventListener('wheel', (e) => {
            if (!this.isOpen || !this.panelBounds) return;
            const rect = this.canvas!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check if mouse is over panel
            if (x >= this.PANEL_X && x <= this.PANEL_X + this.PANEL_WIDTH &&
                y >= this.PANEL_Y && y <= this.PANEL_Y + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
            }
        });
    }

    public render(): void {
        if (!this.ctx || !this.canvas || !this.isOpen) return;
        const ctx = this.ctx;
        
        // Save context state to restore after rendering
        ctx.save();

        const entries = [...CHANGELOG].reverse();
        
        // Calculate content height
        let currentY = this.PANEL_Y + 40 + this.PADDING;
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        
        entries.forEach(entry => {
            currentY += 25; // Date spacing
            ctx.font = '14px Ubuntu, sans-serif';
            entry.changes.forEach(() => {
                currentY += 24; // Change spacing
            });
            currentY += 15; // Entry spacing
        });
        
        this.contentHeight = currentY - (this.PANEL_Y + 40 + this.PADDING);
        const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

        // Draw panel background
        ctx.fillStyle = '#49c46f';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        this.roundRect(ctx, this.PANEL_X, this.PANEL_Y, this.PANEL_WIDTH, this.PANEL_HEIGHT, 10);
        ctx.fill();
        ctx.stroke();

        // Draw header (before clipping)
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText('Changelog', this.PANEL_X + this.PADDING, this.PANEL_Y + this.PADDING);
        ctx.fillText('Changelog', this.PANEL_X + this.PADDING, this.PANEL_Y + this.PADDING);

        // Draw close button (before clipping)
        const closeButtonX = this.PANEL_X + this.PANEL_WIDTH - 50;
        const closeButtonY = this.PANEL_Y + 10;
        const closeButtonWidth = 30;
        const closeButtonHeight = 30;
        this.closeButtonBounds = { x: closeButtonX, y: closeButtonY, width: closeButtonWidth, height: closeButtonHeight };
        
        ctx.fillStyle = '#ff4444';
        this.roundRect(ctx, closeButtonX, closeButtonY, closeButtonWidth, closeButtonHeight, 5);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '16px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', closeButtonX + closeButtonWidth / 2, closeButtonY + closeButtonHeight / 2);
        ctx.textAlign = 'left';

        // Clip to panel content area (after header and buttons)
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, this.PANEL_X + this.PADDING, this.PANEL_Y + 40, 
                      this.PANEL_WIDTH - this.PADDING * 2, this.PANEL_HEIGHT - 40 - this.PADDING, 8);
        ctx.clip();

        // Draw content
        let contentY = this.PANEL_Y + 40 + this.PADDING - this.scrollY;
        
        entries.forEach(entry => {
            // Draw entry background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            this.roundRect(ctx, this.PANEL_X + this.PADDING, contentY - 5, 
                          this.PANEL_WIDTH - this.PADDING * 2 - (this.contentHeight > this.PANEL_HEIGHT - 40 ? this.SCROLLBAR_WIDTH + 5 : 0), 
                          10, 8);
            ctx.fill();

            // Draw date
            ctx.font = 'bold 20px Ubuntu, sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(entry.date, this.PANEL_X + this.PADDING, contentY);
            ctx.fillText(entry.date, this.PANEL_X + this.PADDING, contentY);
            contentY += 25;

            // Draw changes
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.lineWidth = 1;
            entry.changes.forEach(change => {
                // Draw bullet
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.fillText('•', this.PANEL_X + this.PADDING, contentY);
                ctx.strokeText('•', this.PANEL_X + this.PADDING, contentY);
                
                // Draw change text
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 0.5;
                const textX = this.PANEL_X + this.PADDING + 20;
                ctx.strokeText(change, textX, contentY);
                ctx.fillText(change, textX, contentY);
                contentY += 24;
            });
            contentY += 15;
        });

        ctx.restore();

        // Draw scrollbar if needed
        if (this.contentHeight > this.PANEL_HEIGHT - 40) {
            const scrollbarX = this.PANEL_X + this.PANEL_WIDTH - this.SCROLLBAR_WIDTH - 5;
            const scrollbarTrackY = this.PANEL_Y + 40;
            const scrollbarTrackHeight = this.PANEL_HEIGHT - 40 - 5;
            
            // Track
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.roundRect(ctx, scrollbarX, scrollbarTrackY, this.SCROLLBAR_WIDTH, scrollbarTrackHeight, 5);
            ctx.fill();

            // Thumb
            const thumbHeight = (this.PANEL_HEIGHT - 45) * (this.PANEL_HEIGHT - 40) / this.contentHeight;
            const thumbY = scrollbarTrackY + (this.scrollY / maxScroll) * (scrollbarTrackHeight - thumbHeight);
            ctx.fillStyle = '#4CAF50';
            this.roundRect(ctx, scrollbarX, thumbY, this.SCROLLBAR_WIDTH, thumbHeight, 5);
            ctx.fill();
        }

        this.panelBounds = {
            x: this.PANEL_X,
            y: this.PANEL_Y,
            width: this.PANEL_WIDTH,
            height: this.PANEL_HEIGHT
        };
        
        // Restore context state to prevent affecting other UI elements
        ctx.restore();
    }

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    public toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show(): void {
            this.isOpen = true;
        this.scrollY = 0;
    }

    public hide(): void {
            this.isOpen = false;
    }

    public isChangelogOpen(): boolean {
        return this.isOpen;
    }
}

