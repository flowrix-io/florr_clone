"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeaderboardManager = void 0;
const constants_1 = require("./constants");
class LeaderboardManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.isOpen = false;
        this.entries = [];
        this.totalAccounts = 0;
        this.dailyActiveUsers = 0;
        this.isLoading = false;
        this.serverBaseUrl = '';
        this.scrollY = 0;
        this.closeButtonBounds = null;
        this.refreshButtonBounds = null;
        this.panelBounds = null;
        this.contentHeight = 0;
        this.PANEL_X = 20;
        this.PANEL_Y = 72;
        this.PANEL_WIDTH = 500;
        this.PANEL_HEIGHT = 500;
        this.PADDING = 20;
        this.SCROLLBAR_WIDTH = 10;
        this.ROW_HEIGHT = 40;
        this.isDragging = false;
        this.dragStartY = 0;
        this.dragStartScroll = 0;
        this.detectServerUrl();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }
    setCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }
    detectServerUrl() {
        if (typeof window !== 'undefined') {
            this.serverBaseUrl = window.location.origin;
        }
    }
    calculateLevelFromTotalXP(totalXP) {
        let level = 1;
        let xpNeeded = 0;
        while (xpNeeded + Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1)) <= totalXP) {
            xpNeeded += Math.floor(constants_1.BASE_XP_REQUIREMENT * Math.pow(constants_1.XP_MULTIPLIER, level - 1));
            level++;
        }
        return level;
    }
    async loadLeaderboard() {
        if (this.isLoading)
            return;
        this.isLoading = true;
        try {
            const response = await fetch(`${this.serverBaseUrl}/api/leaderboard?limit=50`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const rawEntries = data.leaderboard || [];
            this.totalAccounts = data.totalAccounts || 0;
            this.dailyActiveUsers = data.dailyActiveUsers || 0;
            this.entries = rawEntries.map((entry) => ({
                username: entry.username,
                totalXP: entry.totalXP,
                level: this.calculateLevelFromTotalXP(entry.totalXP)
            }));
        }
        catch (error) {
            console.error('[LEADERBOARD] Error loading leaderboard:', error);
        }
        finally {
            this.isLoading = false;
        }
    }
    setupMouseListeners() {
        if (!this.canvas)
            return;
        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen)
                return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            if (this.closeButtonBounds &&
                x >= this.closeButtonBounds.x && x <= this.closeButtonBounds.x + this.closeButtonBounds.width &&
                y >= this.closeButtonBounds.y && y <= this.closeButtonBounds.y + this.closeButtonBounds.height) {
                this.hide();
                return;
            }
            if (this.refreshButtonBounds &&
                x >= this.refreshButtonBounds.x && x <= this.refreshButtonBounds.x + this.refreshButtonBounds.width &&
                y >= this.refreshButtonBounds.y && y <= this.refreshButtonBounds.y + this.refreshButtonBounds.height) {
                this.loadLeaderboard();
                return;
            }
            // Scrollbar drag
            if (this.panelBounds && this.contentHeight > this.PANEL_HEIGHT - 40) {
                const isInGame = !!window.currentGame;
                const offsetX = isInGame ? this.PANEL_X : 0;
                const offsetY = isInGame ? this.PANEL_Y : 0;
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
            if (this.isDragging) {
                const rect = this.canvas.getBoundingClientRect();
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
            if (!this.isOpen || !this.panelBounds)
                return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const isInGame = !!window.currentGame;
            const offsetX = isInGame ? this.PANEL_X : 0;
            const offsetY = isInGame ? this.PANEL_Y : 0;
            if (x >= offsetX && x <= offsetX + this.PANEL_WIDTH &&
                y >= offsetY && y <= offsetY + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
            }
        });
    }
    isLeaderboardOpen() {
        return this.isOpen;
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
        this.loadLeaderboard();
    }
    hide() {
        this.isOpen = false;
    }
    render() {
        if (!this.canvas || !this.isOpen)
            return;
        if (!this.ctx) {
            this.ctx = this.canvas.getContext('2d');
            if (!this.ctx)
                return;
        }
        const ctx = this.ctx;
        const isInGame = !!window.currentGame;
        const offsetX = isInGame ? this.PANEL_X : 0;
        const offsetY = isInGame ? this.PANEL_Y : 0;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // Calculate content height
        const headerHeight = 50;
        const columnHeaderHeight = 30;
        if (this.entries.length === 0 && !this.isLoading) {
            this.contentHeight = 40;
        }
        else {
            this.contentHeight = columnHeaderHeight + this.entries.length * this.ROW_HEIGHT;
        }
        const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - headerHeight));
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
        // Panel background
        ctx.fillStyle = '#e8a023';
        ctx.strokeStyle = '#c4871a';
        ctx.lineWidth = 2;
        this.roundRect(ctx, offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, 10);
        ctx.fill();
        ctx.stroke();
        // Header
        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText('Leaderboard', offsetX + this.PADDING, offsetY + this.PADDING);
        ctx.fillText('Leaderboard', offsetX + this.PADDING, offsetY + this.PADDING);
        // Total accounts count and daily active users
        if (this.totalAccounts > 0) {
            ctx.font = '13px Ubuntu, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 0;
            ctx.fillText(`${this.totalAccounts} accounts \u00B7 ${this.dailyActiveUsers} active today`, offsetX + this.PADDING + 140, offsetY + this.PADDING + 5);
        }
        // Refresh button
        const refreshButtonX = offsetX + this.PANEL_WIDTH - 140;
        const refreshButtonY = offsetY + 10;
        const refreshButtonWidth = 80;
        const refreshButtonHeight = 30;
        this.refreshButtonBounds = { x: refreshButtonX, y: refreshButtonY, width: refreshButtonWidth, height: refreshButtonHeight };
        ctx.fillStyle = '#c4871a';
        this.roundRect(ctx, refreshButtonX, refreshButtonY, refreshButtonWidth, refreshButtonHeight, 5);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '14px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Refresh', refreshButtonX + refreshButtonWidth / 2, refreshButtonY + refreshButtonHeight / 2);
        ctx.textAlign = 'left';
        // Close button
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
        ctx.fillText('\u2715', closeButtonX + closeButtonWidth / 2, closeButtonY + closeButtonHeight / 2);
        ctx.textAlign = 'left';
        // Clip content area
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, offsetX + 5, offsetY + headerHeight, this.PANEL_WIDTH - 10, this.PANEL_HEIGHT - headerHeight - 5, 8);
        ctx.clip();
        let contentY = offsetY + headerHeight - this.scrollY;
        if (this.isLoading && this.entries.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Loading...', offsetX + this.PANEL_WIDTH / 2, contentY + 20);
            ctx.textAlign = 'left';
        }
        else if (this.entries.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('No accounts found', offsetX + this.PANEL_WIDTH / 2, contentY + 20);
            ctx.textAlign = 'left';
        }
        else {
            // Column headers
            const colRank = offsetX + 15;
            const colName = offsetX + 60;
            const colLevel = offsetX + this.PANEL_WIDTH - 170;
            const colXP = offsetX + this.PANEL_WIDTH - 80;
            ctx.font = 'bold 14px Ubuntu, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.textBaseline = 'top';
            ctx.fillText('#', colRank, contentY + 8);
            ctx.fillText('Player', colName, contentY + 8);
            ctx.fillText('Level', colLevel, contentY + 8);
            ctx.textAlign = 'right';
            ctx.fillText('XP', colXP + 50, contentY + 8);
            ctx.textAlign = 'left';
            contentY += columnHeaderHeight;
            // Rows
            this.entries.forEach((entry, index) => {
                const rank = index + 1;
                const rowY = contentY;
                // Alternating row background
                if (rank % 2 === 0) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                }
                else {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                }
                ctx.fillRect(offsetX + 10, rowY, this.PANEL_WIDTH - 20, this.ROW_HEIGHT);
                // Medal colors for top 3
                let rankColor = '#FFFFFF';
                if (rank === 1)
                    rankColor = '#FFD700';
                else if (rank === 2)
                    rankColor = '#C0C0C0';
                else if (rank === 3)
                    rankColor = '#CD7F32';
                ctx.font = 'bold 16px Ubuntu, sans-serif';
                ctx.fillStyle = rankColor;
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.textBaseline = 'middle';
                const rankText = `${rank}`;
                ctx.strokeText(rankText, colRank, rowY + this.ROW_HEIGHT / 2);
                ctx.fillText(rankText, colRank, rowY + this.ROW_HEIGHT / 2);
                // Username
                ctx.font = '14px Ubuntu, sans-serif';
                ctx.fillStyle = rankColor;
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 0.5;
                const displayName = entry.username.length > 20 ? entry.username.substring(0, 17) + '...' : entry.username;
                ctx.strokeText(displayName, colName, rowY + this.ROW_HEIGHT / 2);
                ctx.fillText(displayName, colName, rowY + this.ROW_HEIGHT / 2);
                // Level
                ctx.font = 'bold 14px Ubuntu, sans-serif';
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeText(`${entry.level}`, colLevel, rowY + this.ROW_HEIGHT / 2);
                ctx.fillText(`${entry.level}`, colLevel, rowY + this.ROW_HEIGHT / 2);
                // XP
                ctx.font = '13px Ubuntu, sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.textAlign = 'right';
                const xpText = this.formatXP(entry.totalXP);
                ctx.strokeText(xpText, colXP + 50, rowY + this.ROW_HEIGHT / 2);
                ctx.fillText(xpText, colXP + 50, rowY + this.ROW_HEIGHT / 2);
                ctx.textAlign = 'left';
                contentY += this.ROW_HEIGHT;
            });
        }
        ctx.restore();
        // Scrollbar
        if (this.contentHeight > this.PANEL_HEIGHT - headerHeight) {
            const scrollbarX = offsetX + this.PANEL_WIDTH - this.SCROLLBAR_WIDTH - 5;
            const scrollbarTrackY = offsetY + headerHeight;
            const scrollbarTrackHeight = this.PANEL_HEIGHT - headerHeight - 5;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.roundRect(ctx, scrollbarX, scrollbarTrackY, this.SCROLLBAR_WIDTH, scrollbarTrackHeight, 5);
            ctx.fill();
            const thumbHeight = (this.PANEL_HEIGHT - headerHeight - 5) * (this.PANEL_HEIGHT - headerHeight) / this.contentHeight;
            const thumbY = scrollbarTrackY + (this.scrollY / maxScroll) * (scrollbarTrackHeight - thumbHeight);
            ctx.fillStyle = '#c4871a';
            this.roundRect(ctx, scrollbarX, thumbY, this.SCROLLBAR_WIDTH, thumbHeight, 5);
            ctx.fill();
        }
        this.panelBounds = {
            x: offsetX,
            y: offsetY,
            width: this.PANEL_WIDTH,
            height: this.PANEL_HEIGHT
        };
        ctx.restore();
    }
    formatXP(xp) {
        if (xp >= 1000000)
            return `${(xp / 1000000).toFixed(1)}M`;
        if (xp >= 1000)
            return `${(xp / 1000).toFixed(1)}K`;
        return `${xp}`;
    }
    roundRect(ctx, x, y, width, height, radius) {
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
}
exports.LeaderboardManager = LeaderboardManager;
