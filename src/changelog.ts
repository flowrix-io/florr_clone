// This file should not be updated every time
// It should only be updated when there are major changes
import {
    pointInRect,
    pointInScrollbar,
    scrollbarLayout,
    drawScrollbar,
    drawPanelBackground,
    drawPanelTitle,
    drawCloseButton,
} from './graphics/overlay-panel';
import { canvasCoords } from './zoom-compensation';
import { drawText } from './graphics/text';
import { drawRoundedRect } from './graphics/shapes';
import { maxScrollFor, scrollFromThumbDrag } from './graphics/scroll-panel';

export interface ChangelogEntry {
    date: string;
    changes: string[];
}

interface ChangelogLinkBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    url: string;
}

type ChangelogTextSegment =
    | { type: 'text'; text: string }
    | { type: 'link'; text: string; url: string };

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
    },
    {
        date: 'December 26, 2025',
        changes: [
            'Changed title screen UI',
            'New admin command: give'
        ]
    },
    {
        date: 'December 31, 2025',
        changes: [
            'New petal: Splitter',
            'New petal: Gas',
            'New petal: Bulb',
            'Petals now have physics and are attracted to mobs'
        ]
    },
    {
        date: 'January 19, 2026',
        changes: [
            'Changed the map of most biomes',
            'Some biomes are temporarily disabled for now',
        ]
    },
    {
        date: 'January 22, 2026',
        changes: [
            'Ocean is back!',
            'New petal: Starfish',
            'New petal: Sponge',
            'New mob: Starfish',
            'New mob: Sponge',
        ]
    },
    {
        date: 'January 31, 2026',
        changes: [
            'New biome: MATRIX',
            '˜´∑ µø∫Ú øßå',
            '˜ªº˜˚¬ˆçß••',
            'New petal: ∆å√åßç®ˆπ†'
        ]
    },
    {
        date: 'February 16, 2026',
        changes: [
            'New petal: Glass',
            'New petal: Third Eye',
            'New petal: Corn',
            'Commands are now suggested in the chat',
        ]
    },
    {
        date: 'February 20, 2026',
        changes: [
            'Buffed droprates of ultras by 20x',
            'Changed the UI of mobs',
        ]
    },
    {
        date: 'February 21, 2026',
        changes: [
            'Bugfix',
        ]
    },
    {
        date: 'February 22, 2026',
        changes: [
            'Fixed an animation loop bug',
        ]
    },
    {
        date: 'February 22-March 25, 2026',
        changes: [
            'Fixed performance issues',
            'Your settings now save',
            'Fixed teleporter system',
            'Backend changes',
            'FPS should be higher now, and ping should be lower',
        ]
    },
    {
        date: 'March 27, 2026',
        changes: [
            'New petal: Faster',
            'More bug fixes and UI improvements',
        ]
    },
    {
        date: 'April 2, 2026',
        changes: [
            'New mob: Sun',
            'New petal: Pollen',
            'Bulb now emits light',
            'Nerfed blood leaf',
            'Fixed some bugs',
        ]
    },
    {
        date: 'April 5, 2026',
        changes: [
            'You now have a second row of loadout slots',
        ]
    },
    {
        date: 'April 12, 2026',
        changes: [
            'Changed the UI of the skills panel',
            'Changed the UI of the inventory',
            'Changed the UI of the crafting panel',
            'Added second chance skill',
            'Fixed players getting damaged during invulnerability'
        ]
    },
    {
        date: 'April 13, 2026',
        changes: [
            'Added apex rarity',
            'Recolored unique and apex petals'
        ]
    },
    {
        date: 'April 17, 2026',
        changes: [
            'New petal: Powder',
            'New petal: Peas',
            'New mob: Desert Centipede',
            'New mob: Centipede',
        ]
    },
    {
        date: 'April 18, 2026',
        changes: [
            'Faster now stacks additively instead of multiplicatively',
            'Fixed players glitching into walls when going very fast',
            'Added squads',
            'Added guilds',
            'New mob: Worker Ant',
            'New mob: Baby Ant',
            'New mob: Worker Fire Ant',
            'New mob: Baby Fire Ant',
            'A new portal has opened in desert',
            'Ant hell background looks much nicer now'
        ]
    },
    {
        date: 'April 19, 2026',
        changes: [
            'Sun no longer drops eggs (to fix an exploit)',
            'Sun now drops glass, rock, sand, pollen, speed boost, and shield',
            'Added PVP mode',
            'Added Daily Streak',
            'Any obtained sun egg is now deleted'
        ]
    },
    {
        date: 'April 22, 2026',
        changes: [
            'New mob: Ant Hole',
            'New mob: Fire Ant Hole',
        ]
    },
    {
        date: 'April 23, 2026',
        changes: [
            'New petal: Magnet',
            'New petal: Air',
            'New petal: Soil',
            'Changed Ant Hole and Fire Ant Hole drops',
        ]
    },
    {
        date: 'April 24, 2026',
        changes: [
            'Optimize the game',
            'Added API keys(you can now create discord bot)',
            'Secured the server',
            'Roach now looks better',
            'Added ultra zones',
        ]
    },
    {
        date: 'April 26, 2026',
        changes: [
            'Changed keybinds for using items from 1-10 to U+1-10',
            'New petal: Yin Yang',
            'New petal: Lentil',
            'New petal: Bubble',
            'Clover now gives luck, and increases the rarity of mobs around you',
            'Changed petal attraction system',
            'Special petals no longer work in inactive loadout slots',
        ]
    },
    {
        date: 'April 30, 2026',
        changes: [
            'Server now restarts every 24 hours',
            'Optimizations and bug fixes',
            'The keybinds for using items can now be swapped between U+1-10 and 1-10 in the settings menu',
            'New setting: Show Admin Commands',
            'Fixed show hitboxes not working',
            'Fixed moth rendering bug',
            'Ant Hell can now spawn bosses',
            'Added a bridge to the Mythic zone in Garden',
            'Changed sewers wall textures'
        ]
    },
    {
        date: 'May 3, 2026',
        changes: [
            'New petal: Antennae',
            'New petal: Observer',
        ]
    },
    {
        date: 'May 4, 2026',
        changes: [
            'Pollen drops on the ground now',
            'Changed mob spawning algorithm',
            'Bee now drops pollen',
        ]
    },
    {
        date: 'May 20, 2026',
        changes: [
            'New petal: Bomb',
            'New petal: Flower',
            'New petal: Raindrop',
            'Optimize game',
        ]
    },
    {
        date: 'June 2, 2026',
        changes: [
            'Added discord link',
        ]
    },
    {
        date: 'June 19, 2026',
        changes: [
            'Server crashes should now be fixed(hopefully)',
            'Admin names are no longer shown on leaderboard',
            'Added skins menu',
        ]
    },
    {
        date: 'June 30, 2026',
        changes: [
            'Fixed unobtainable petals being in the shop',
            'Bugfix(from discord/youtube bug reports)',
            'New link: link:https://flowrix.sussybite.dev'
        ]
    },
    {
        date: 'July 7, 2026',
        changes: [
            'Patched exploits to get sun egg',
            'Changed bee AI',
            'Changed most mob speeds',
            'Clover now increases craft chance',
            'Added debug menu',
            'Added maze mode(testing phase, if you find exploits, please bug report in discord)',
            'Petals collected in maze increase in rarity by 1 outside of maze',
            'Petals collected outside of maze decrease by 1 in maze',
            'Only Mythic- petals are allowed in maze',
            'Maze changes each day',
            'Added absorbing(only for petals collected in maze)',
        ]
    },
    {
        date: 'July 8, 2026',
        changes: [
            'Maze now has a seperate leveling system than the main game',
            'Made maze larger',
            'Fixed some server bugs',
            'Added mobile support',
            'Added absorb talents'
        ]
    },
    {
        date: 'July 9, 2026',
        changes: [
            'New desert background',
            'Server and client optimizations'
        ]
    },
    {
        date: 'July 14, 2026',
        changes: [
            'Fix client FPS',
            'New setting: GPU Acceleration',
            'Patched some glitches where players could get into walls',
            'Admin give and spawn mob commands can now have amounts',
            'New admin command: killall',
        ]
    },
    {
        date: 'July 20, 2026',
        changes: [
            'Reworked Rose',
            'New petal: Dahlia',
            'New petal: Azalea',
            'Sandstorm now spins faster',
            'Fixed mobile login',
            'Fixed common mobs dropping better petals than uncommon mobs'
        ]
    },
    {
        date: 'July 26, 2026',
        changes: [
            'Fixed petals reloading instantly(there are no bugs)',
            'Fixed inventory getting corrupted'
        ]
    },
    {
        date: 'July 29, 2026',
        changes: [
            'New mob: Evil Centipede',
            'New mob: Queen Ant',
            'New mob: Digger',
            'New petal: Shell',
            'New petal: Uranium',
            'New petal: Pincer',
            'New petal: Web',
            'New petal: Guided Missile',
            'New petal: Blue Iris',
            'New petal: Stick',
            'New petal: Moon',
            'New petal: Lotus',
            'New petal: Heaviest',
            'New petal: Rice',
            'Poison damage numbers are purple now',
            'Added stalling mechanics to the game',
            'Honey slows, not a lure petal'
        ]
    },
    {
        date: 'August 1, 2026',
        changes: [
            'Target dummies now spawn less often at garden spawn',
            'Pets and target dummies no longer have bossbars'
        ]
    },
    {
        date: 'August 2, 2026',
        changes: [
            'Made pets smaller',
            'Nerf digger egg'
        ]
    },
    {
        date: 'August 3, 2026',
        changes: [
            'Patched duping exploit',
        ]
    },
    {
        date: 'August 4, 2026',
        changes: [
            'Removed some petals that were duped',
        ]
    },
    {
        date: 'August 6, 2026',
        changes: [
            'Patched a cheat',
            'Fixed apex mobs despawning',
            'Admins can now post images in chat',
            '/spawn command now announces boss mobs',
        ]
    },
    {
        date: 'August 7, 2026',
        changes: [
            'All players can post images in chat now(use <img src="Image Link">)',
            'Fix crafting bugs',
            'Added curves to skin editor',
        ]
    },
    {
        date: 'August 10, 2026',
        changes: [
            'New mob: Glitch Flower',
            'Reworked flower petal',
            'Added corruption',
            'New admin command: /corrupt',
        ]
    },
    {
        date: 'August 17, 2026',
        changes: [
            'Apex mobs now have 100x HP and XP',
            'Server optimizations'
        ]
    },
    {
        date: 'August 23, 2026',
        changes: [
            'Fix bugs',
            'Magnet no longer instantly attracts petals without playing animation',
            'Jungle coming soon',
            'Looting requirements changed'
        ]
    },
    {
        date: 'August 24, 2026',
        changes: [
            'Balanced all mob HP/damage',
            'Changed some mob sizes'
        ]
    },
    {
        date: 'August 26, 2026',
        changes: [
            'Fixed server crash bug'
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
    private linkBounds: ChangelogLinkBounds[] = [];

    constructor() {
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }

    public setCanvas(canvas: HTMLCanvasElement): void {
        // Idempotent: setupMouseListeners() has no teardown, so re-binding the
        // same canvas would stack a second set of pointer listeners.
        if (this.canvas === canvas) return;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }

    private setupMouseListeners(): void {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            const { x, y } = this.getMousePosition(e);

            // Check close button
            if (pointInRect(this.closeButtonBounds, x, y)) {
                this.hide();
                return;
            }

            const clickedLink = this.getLinkAt(x, y);
            if (clickedLink) {
                window.open(clickedLink.url, '_blank', 'noopener,noreferrer');
                return;
            }

            // Check scrollbar
            if (this.panelBounds && this.contentHeight > this.PANEL_HEIGHT - 40) {
                const layout = scrollbarLayout(
                    this.PANEL_X, this.PANEL_Y, this.PANEL_WIDTH, this.PANEL_HEIGHT,
                    40, this.SCROLLBAR_WIDTH,
                );
                if (pointInScrollbar(layout, this.PANEL_Y + this.PANEL_HEIGHT, x, y)) {
                    this.isDragging = true;
                    this.dragStartY = y;
                    this.dragStartScroll = this.scrollY;
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isOpen) return;
            const { x, y } = this.getMousePosition(e);

            if (this.isDragging) {
                const deltaY = y - this.dragStartY;
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
                this.scrollY = scrollFromThumbDrag(this.dragStartScroll, deltaY, this.PANEL_HEIGHT, maxScroll);
                return;
            }

            this.canvas!.style.cursor = this.getLinkAt(x, y) ? 'pointer' : '';
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
            const offsetX = this.PANEL_X;
            const offsetY = this.PANEL_Y;
            if (x >= offsetX && x <= offsetX + this.PANEL_WIDTH &&
                y >= offsetY && y <= offsetY + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
            }
        });
    }

    public render(): void {
        if (!this.canvas || !this.isOpen) {
            this.linkBounds = [];
            return;
        }
        // Re-get context if it's null (might have been lost)
        if (!this.ctx) {
            this.ctx = this.canvas.getContext('2d');
            if (!this.ctx) {
                console.error('[CHANGELOG] Failed to get context');
                return;
            }
        }
        const ctx = this.ctx;
        this.linkBounds = [];
        
        // The canvas is always full-screen now; the panel is drawn at PANEL_X/PANEL_Y.
        const offsetX = this.PANEL_X;
        const offsetY = this.PANEL_Y;

        // Save context state to restore after rendering
        ctx.save();
        // Defensive: do not inherit textAlign from upstream renderers. The title
        // header below relies on left-aligned start positioning.
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        const entries = [...CHANGELOG].reverse();
        
        // Calculate content height
        let currentY = offsetY + 40 + this.PADDING;
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
        
        this.contentHeight = currentY - (offsetY + 40 + this.PADDING);
        const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

        // Draw panel background
        drawPanelBackground(ctx, offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, '#49c46f', '#4CAF50');

        // Draw header (before clipping)
        drawPanelTitle(ctx, 'Changelog', offsetX, offsetY, this.PADDING);

        this.closeButtonBounds = drawCloseButton(ctx, offsetX, offsetY, this.PANEL_WIDTH);

        // Clip to panel content area (after header and buttons)
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, offsetX + this.PADDING, offsetY + 40, 
                      this.PANEL_WIDTH - this.PADDING * 2, this.PANEL_HEIGHT - 40 - this.PADDING, 8);
        ctx.clip();

        // Draw content
        let contentY = offsetY + 40 + this.PADDING - this.scrollY;
        
        entries.forEach(entry => {
            // Draw entry background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            this.roundRect(ctx, offsetX + this.PADDING, contentY - 5, 
                          this.PANEL_WIDTH - this.PADDING * 2 - (this.contentHeight > this.PANEL_HEIGHT - 40 ? this.SCROLLBAR_WIDTH + 5 : 0), 
                          10, 8);
            ctx.fill();

            // Draw date
            drawText(ctx, entry.date, offsetX + this.PADDING, contentY, { size: 20, weight: 'bold', fill: '#FFFFFF', strokeWidth: 2 });
            contentY += 25;

            // Draw changes
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.lineWidth = 1;
            entry.changes.forEach(change => {
                // Draw bullet
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.fillText('•', offsetX + this.PADDING, contentY);
                ctx.strokeText('•', offsetX + this.PADDING, contentY);
                
                // Draw change text
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 0.5;
                const textX = offsetX + this.PADDING + 20;
                this.drawChangeText(ctx, change, textX, contentY);
                contentY += 24;
            });
            contentY += 15;
        });

        ctx.restore();

        // Draw scrollbar if needed
        if (this.contentHeight > this.PANEL_HEIGHT - 40) {
            drawScrollbar(
                ctx,
                scrollbarLayout(offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, 40, this.SCROLLBAR_WIDTH),
                {
                    contentHeight: this.contentHeight,
                    panelHeight: this.PANEL_HEIGHT,
                    headerHeight: 40,
                    scrollY: this.scrollY,
                    maxScroll,
                    thumbColor: '#4CAF50',
                },
            );
        }

        this.panelBounds = {
            x: offsetX,
            y: offsetY,
            width: this.PANEL_WIDTH,
            height: this.PANEL_HEIGHT
        };
        
        // Restore context state to prevent affecting other UI elements
        ctx.restore();
    }

    private drawChangeText(ctx: CanvasRenderingContext2D, change: string, x: number, y: number): void {
        const segments = this.parseChangeText(change);
        let currentX = x;

        segments.forEach(segment => {
            if (!segment.text) return;

            const width = ctx.measureText(segment.text).width;
            if (segment.type === 'link') {
                // strokeWidth follows the ambient lineWidth on purpose: the
                // caller sets 0.5, but a link underline bumps it to 1 for the
                // segments after it — preserved as-is.
                drawText(ctx, segment.text, currentX, y, { size: 14, fill: '#d8f7ff', strokeWidth: ctx.lineWidth });

                ctx.beginPath();
                ctx.strokeStyle = '#d8f7ff';
                ctx.lineWidth = 1;
                ctx.moveTo(currentX, y + 17);
                ctx.lineTo(currentX + width, y + 17);
                ctx.stroke();

                this.linkBounds.push({
                    x: currentX,
                    y,
                    width,
                    height: 18,
                    url: segment.url
                });
            } else {
                drawText(ctx, segment.text, currentX, y, { size: 14, fill: '#FFFFFF', strokeWidth: ctx.lineWidth });
            }

            currentX += width;
        });
    }

    private parseChangeText(change: string): ChangelogTextSegment[] {
        const segments: ChangelogTextSegment[] = [];
        const linkPattern = /link:(\S+)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = linkPattern.exec(change)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ type: 'text', text: change.slice(lastIndex, match.index) });
            }

            const rawUrl = match[1];
            const url = this.normalizeLinkUrl(rawUrl);
            segments.push({
                type: 'link',
                text: this.getLinkDisplayText(rawUrl),
                url
            });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < change.length) {
            segments.push({ type: 'text', text: change.slice(lastIndex) });
        }

        return segments.length > 0 ? segments : [{ type: 'text', text: change }];
    }

    private normalizeLinkUrl(rawUrl: string): string {
        return /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    }

    private getLinkDisplayText(rawUrl: string): string {
        try {
            const url = new URL(this.normalizeLinkUrl(rawUrl));
            return url.host + url.pathname.replace(/\/$/, '');
        } catch {
            return rawUrl;
        }
    }

    private getLinkAt(x: number, y: number): ChangelogLinkBounds | null {
        const contentX = this.PANEL_X + this.PADDING;
        const contentY = this.PANEL_Y + 40;
        const contentWidth = this.PANEL_WIDTH - this.PADDING * 2;
        const contentHeight = this.PANEL_HEIGHT - 40 - this.PADDING;

        if (x < contentX || x > contentX + contentWidth || y < contentY || y > contentY + contentHeight) {
            return null;
        }

        return this.linkBounds.find(bounds =>
            x >= bounds.x &&
            x <= bounds.x + bounds.width &&
            y >= bounds.y &&
            y <= bounds.y + bounds.height
        ) || null;
    }

    private getMousePosition(e: MouseEvent): { x: number; y: number } {
        return this.canvas ? canvasCoords(this.canvas, e, true) : { x: 0, y: 0 };
    }

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        if (!ctx) return;
        drawRoundedRect(ctx, x, y, width, height, radius);
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
        // The canvas's z-index is owned by whoever created it (title screen or
        // in-game graphics) — don't override it here.
    }

    public hide(): void {
        this.isOpen = false;
        this.linkBounds = [];
        if (this.canvas) {
            this.canvas.style.cursor = '';
        }
    }

    public isChangelogOpen(): boolean {
        return this.isOpen;
    }
}
