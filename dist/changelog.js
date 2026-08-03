"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangelogManager = exports.CHANGELOG = void 0;
// This file should not be updated every time
// It should only be updated when there are major changes
const zoom_compensation_1 = require("./zoom-compensation");
exports.CHANGELOG = [
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
    }
];
class ChangelogManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.isOpen = false;
        this.scrollY = 0;
        this.closeButtonBounds = null;
        this.panelBounds = null;
        this.contentHeight = 0;
        this.PANEL_X = 20;
        this.PANEL_Y = 72;
        this.PANEL_WIDTH = 600;
        this.PANEL_HEIGHT = 500;
        this.PADDING = 20;
        this.SCROLLBAR_WIDTH = 10;
        this.isDragging = false;
        this.dragStartY = 0;
        this.dragStartScroll = 0;
        this.linkBounds = [];
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }
    setCanvas(canvas) {
        // Idempotent: setupMouseListeners() has no teardown, so re-binding the
        // same canvas would stack a second set of pointer listeners.
        if (this.canvas === canvas)
            return;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }
    setupMouseListeners() {
        if (!this.canvas)
            return;
        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen)
                return;
            const { x, y } = this.getMousePosition(e);
            // Check close button
            if (this.closeButtonBounds &&
                x >= this.closeButtonBounds.x && x <= this.closeButtonBounds.x + this.closeButtonBounds.width &&
                y >= this.closeButtonBounds.y && y <= this.closeButtonBounds.y + this.closeButtonBounds.height) {
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
                const offsetX = this.PANEL_X;
                const offsetY = this.PANEL_Y;
                const scrollbarX = offsetX + this.PANEL_WIDTH - this.SCROLLBAR_WIDTH - 5;
                if (x >= scrollbarX && x <= scrollbarX + this.SCROLLBAR_WIDTH &&
                    y >= offsetY + 40 && y <= offsetY + this.PANEL_HEIGHT - 5) {
                    this.isDragging = true;
                    this.dragStartY = y;
                    this.dragStartScroll = this.scrollY;
                }
            }
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isOpen)
                return;
            const { x, y } = this.getMousePosition(e);
            if (this.isDragging) {
                const deltaY = y - this.dragStartY;
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
                const scrollRatio = deltaY / (this.PANEL_HEIGHT - 45);
                this.scrollY = Math.max(0, Math.min(maxScroll, this.dragStartScroll + scrollRatio * maxScroll));
                return;
            }
            this.canvas.style.cursor = this.getLinkAt(x, y) ? 'pointer' : '';
        });
        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.isOpen || !this.panelBounds)
                return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            // Check if mouse is over panel
            const offsetX = this.PANEL_X;
            const offsetY = this.PANEL_Y;
            if (x >= offsetX && x <= offsetX + this.PANEL_WIDTH &&
                y >= offsetY && y <= offsetY + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
            }
        });
    }
    render() {
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
        const entries = [...exports.CHANGELOG].reverse();
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
        const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
        // Draw panel background
        ctx.fillStyle = '#49c46f';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        this.roundRect(ctx, offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, 10);
        ctx.fill();
        ctx.stroke();
        // Draw header (before clipping)
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText('Changelog', offsetX + this.PADDING, offsetY + this.PADDING);
        ctx.fillText('Changelog', offsetX + this.PADDING, offsetY + this.PADDING);
        // Draw close button (before clipping)
        const closeButtonX = offsetX + this.PANEL_WIDTH - 50;
        const closeButtonY = offsetY + 10;
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
        this.roundRect(ctx, offsetX + this.PADDING, offsetY + 40, this.PANEL_WIDTH - this.PADDING * 2, this.PANEL_HEIGHT - 40 - this.PADDING, 8);
        ctx.clip();
        // Draw content
        let contentY = offsetY + 40 + this.PADDING - this.scrollY;
        entries.forEach(entry => {
            // Draw entry background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            this.roundRect(ctx, offsetX + this.PADDING, contentY - 5, this.PANEL_WIDTH - this.PADDING * 2 - (this.contentHeight > this.PANEL_HEIGHT - 40 ? this.SCROLLBAR_WIDTH + 5 : 0), 10, 8);
            ctx.fill();
            // Draw date
            ctx.font = 'bold 20px Ubuntu, sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(entry.date, offsetX + this.PADDING, contentY);
            ctx.fillText(entry.date, offsetX + this.PADDING, contentY);
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
            const scrollbarX = offsetX + this.PANEL_WIDTH - this.SCROLLBAR_WIDTH - 5;
            const scrollbarTrackY = offsetY + 40;
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
            x: offsetX,
            y: offsetY,
            width: this.PANEL_WIDTH,
            height: this.PANEL_HEIGHT
        };
        // Restore context state to prevent affecting other UI elements
        ctx.restore();
    }
    drawChangeText(ctx, change, x, y) {
        const segments = this.parseChangeText(change);
        let currentX = x;
        segments.forEach(segment => {
            if (!segment.text)
                return;
            const width = ctx.measureText(segment.text).width;
            if (segment.type === 'link') {
                ctx.fillStyle = '#d8f7ff';
                ctx.strokeStyle = '#000000';
                ctx.strokeText(segment.text, currentX, y);
                ctx.fillText(segment.text, currentX, y);
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
            }
            else {
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.strokeText(segment.text, currentX, y);
                ctx.fillText(segment.text, currentX, y);
            }
            currentX += width;
        });
    }
    parseChangeText(change) {
        const segments = [];
        const linkPattern = /link:(\S+)/g;
        let lastIndex = 0;
        let match;
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
    normalizeLinkUrl(rawUrl) {
        return /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    }
    getLinkDisplayText(rawUrl) {
        try {
            const url = new URL(this.normalizeLinkUrl(rawUrl));
            return url.host + url.pathname.replace(/\/$/, '');
        }
        catch {
            return rawUrl;
        }
    }
    getLinkAt(x, y) {
        const contentX = this.PANEL_X + this.PADDING;
        const contentY = this.PANEL_Y + 40;
        const contentWidth = this.PANEL_WIDTH - this.PADDING * 2;
        const contentHeight = this.PANEL_HEIGHT - 40 - this.PADDING;
        if (x < contentX || x > contentX + contentWidth || y < contentY || y > contentY + contentHeight) {
            return null;
        }
        return this.linkBounds.find(bounds => x >= bounds.x &&
            x <= bounds.x + bounds.width &&
            y >= bounds.y &&
            y <= bounds.y + bounds.height) || null;
    }
    getMousePosition(e) {
        return this.canvas ? (0, zoom_compensation_1.canvasCoords)(this.canvas, e, true) : { x: 0, y: 0 };
    }
    roundRect(ctx, x, y, width, height, radius) {
        if (!ctx)
            return;
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
    toggle() {
        if (this.isOpen) {
            this.hide();
        }
        else {
            this.show();
        }
    }
    show() {
        this.isOpen = true;
        this.scrollY = 0;
        // The canvas's z-index is owned by whoever created it (title screen or
        // in-game graphics) — don't override it here.
    }
    hide() {
        this.isOpen = false;
        this.linkBounds = [];
        if (this.canvas) {
            this.canvas.style.cursor = '';
        }
    }
    isChangelogOpen() {
        return this.isOpen;
    }
}
exports.ChangelogManager = ChangelogManager;
