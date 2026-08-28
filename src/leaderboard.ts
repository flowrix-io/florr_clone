import {
    pointInRect,
    pointInScrollbar,
    scrollbarLayout,
    drawScrollbar,
    drawPanelBackground,
    drawPanelTitle,
    drawCloseButton,
    drawPillButton,
    headerButtonRect,
} from './graphics/overlay-panel';
import { BASE_XP_REQUIREMENT, XP_MULTIPLIER } from './constants';
import { getBaseDeviceScale } from './zoom-compensation';
import { authHeaders } from './auth_session';
import { drawText } from './graphics/text';
import { drawRoundedRect } from './graphics/shapes';
import { maxScrollFor, scrollFromThumbDrag } from './graphics/scroll-panel';

interface LeaderboardEntry {
    username: string;
    totalXP: number;
    level: number;
}

export class LeaderboardManager {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isOpen: boolean = false;
    private entries: LeaderboardEntry[] = [];
    private totalAccounts: number = 0;
    private dailyActiveUsers: number | null = null;
    private isLoading: boolean = false;
    private serverBaseUrl: string = '';
    private scrollY: number = 0;
    private closeButtonBounds: { x: number; y: number; width: number; height: number } | null = null;
    private refreshButtonBounds: { x: number; y: number; width: number; height: number } | null = null;
    private panelBounds: { x: number; y: number; width: number; height: number } | null = null;
    private contentHeight: number = 0;
    private readonly PANEL_X = 20;
    private readonly PANEL_Y = 72;
    private readonly PANEL_WIDTH = 500;
    private readonly PANEL_HEIGHT = 500;
    private readonly PADDING = 20;
    private readonly SCROLLBAR_WIDTH = 10;
    /** Chrome above the scrolling body. The draw code always used 50 while the
     *  scroll clamp and scrollbar hit-test used 40, so the list scrolled ten
     *  pixels past its own end and the scrollbar's grab zone started above the
     *  visible track. One constant now feeds all three. */
    private readonly HEADER_HEIGHT = 50;
    private readonly ROW_HEIGHT = 40;
    private isDragging: boolean = false;
    private dragStartY: number = 0;
    private dragStartScroll: number = 0;

    constructor() {
        this.detectServerUrl();

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

    private detectServerUrl(): void {
        if (typeof window !== 'undefined') {
            this.serverBaseUrl = window.location.origin;
        }
    }

    private calculateLevelFromTotalXP(totalXP: number): number {
        let level = 1;
        let xpNeeded = 0;
        while (xpNeeded + Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1)) <= totalXP) {
            xpNeeded += Math.floor(BASE_XP_REQUIREMENT * Math.pow(XP_MULTIPLIER, level - 1));
            level++;
        }
        return level;
    }

    private async loadLeaderboard(): Promise<void> {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const params = new URLSearchParams({ limit: '50' });
            if (typeof localStorage !== 'undefined' && localStorage.getItem('showAdminsOnLeaderboard') === 'true') {
                params.set('includeAdmins', 'true');
            }
            // Admin-only fields are unlocked by the session token in the
            // Authorization header — credentials must never ride in the query
            // string, where they end up in server access logs.
            const response = await fetch(`${this.serverBaseUrl}/api/leaderboard?${params.toString()}`, {
                headers: authHeaders()
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const rawEntries = data.leaderboard || [];
            this.totalAccounts = data.totalAccounts || 0;
            this.dailyActiveUsers = typeof data.dailyActiveUsers === 'number' ? data.dailyActiveUsers : null;

            this.entries = rawEntries.map((entry: { username: string; totalXP: number }) => ({
                username: entry.username,
                totalXP: entry.totalXP,
                level: this.calculateLevelFromTotalXP(entry.totalXP)
            }));
        } catch (error) {
            console.error('[LEADERBOARD] Error loading leaderboard:', error);
        } finally {
            this.isLoading = false;
        }
    }

    private setupMouseListeners(): void {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            const rect = this.canvas!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (pointInRect(this.closeButtonBounds, x, y)) {
                this.hide();
                return;
            }

            if (pointInRect(this.refreshButtonBounds, x, y)) {
                this.loadLeaderboard();
                return;
            }

            // Scrollbar drag
            if (this.panelBounds && this.contentHeight > this.PANEL_HEIGHT - this.HEADER_HEIGHT) {
                const layout = scrollbarLayout(
                    this.PANEL_X, this.PANEL_Y, this.PANEL_WIDTH, this.PANEL_HEIGHT,
                    this.HEADER_HEIGHT, this.SCROLLBAR_WIDTH,
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
            if (this.isDragging) {
                const rect = this.canvas!.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const deltaY = y - this.dragStartY;
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT, this.HEADER_HEIGHT);
                this.scrollY = scrollFromThumbDrag(this.dragStartScroll, deltaY, this.PANEL_HEIGHT, maxScroll);
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

            const offsetX = this.PANEL_X;
            const offsetY = this.PANEL_Y;
            if (x >= offsetX && x <= offsetX + this.PANEL_WIDTH &&
                y >= offsetY && y <= offsetY + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT, this.HEADER_HEIGHT);
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
            }
        });
    }

    public isLeaderboardOpen(): boolean {
        return this.isOpen;
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
        this.loadLeaderboard();
    }

    public hide(): void {
        this.isOpen = false;
    }

    public render(): void {
        if (!this.canvas || !this.isOpen) return;
        if (!this.ctx) {
            this.ctx = this.canvas.getContext('2d');
            if (!this.ctx) return;
        }
        const ctx = this.ctx;

        const offsetX = this.PANEL_X;
        const offsetY = this.PANEL_Y;

        ctx.save();
        ctx.setTransform(getBaseDeviceScale(), 0, 0, getBaseDeviceScale(), 0, 0);
        // Defensive: do not inherit textAlign from upstream renderers. The title
        // header below relies on left-aligned start positioning.
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        // Calculate content height
        const columnHeaderHeight = 30;
        if (this.entries.length === 0 && !this.isLoading) {
            this.contentHeight = 40;
        } else {
            this.contentHeight = columnHeaderHeight + this.entries.length * this.ROW_HEIGHT;
        }

        const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT, this.HEADER_HEIGHT);
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

        // Panel background
        drawPanelBackground(ctx, offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, '#e8a023', '#c4871a');

        // Header
        drawPanelTitle(ctx, 'Leaderboard', offsetX, offsetY, this.PADDING);

        // Total accounts count and daily active users (DAU only shown to admins)
        if (this.totalAccounts > 0) {
            const statsText = this.dailyActiveUsers !== null
                ? `${this.totalAccounts} accounts \u00B7 ${this.dailyActiveUsers} active today`
                : `${this.totalAccounts} accounts`;
            drawText(ctx, statsText, offsetX + this.PADDING + 140, offsetY + this.PADDING + 5, { size: 13, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 });
        }

        this.refreshButtonBounds = drawPillButton(
            ctx, headerButtonRect(offsetX, offsetY, this.PANEL_WIDTH, 140, 80), 'Refresh', '#c4871a',
        );

        this.closeButtonBounds = drawCloseButton(ctx, offsetX, offsetY, this.PANEL_WIDTH);

        // Clip content area
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, offsetX + 5, offsetY + this.HEADER_HEIGHT, this.PANEL_WIDTH - 10, this.PANEL_HEIGHT - this.HEADER_HEIGHT - 5, 8);
        ctx.clip();

        let contentY = offsetY + this.HEADER_HEIGHT - this.scrollY;

        if (this.isLoading && this.entries.length === 0) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            drawText(ctx, 'Loading...', offsetX + this.PANEL_WIDTH / 2, contentY + 20, { size: 14, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 });
            ctx.textAlign = 'left';
        } else if (this.entries.length === 0) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            drawText(ctx, 'No accounts found', offsetX + this.PANEL_WIDTH / 2, contentY + 20, { size: 14, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 });
            ctx.textAlign = 'left';
        } else {
            // Column headers
            const colRank = offsetX + 15;
            const colName = offsetX + 60;
            const colLevel = offsetX + this.PANEL_WIDTH - 170;
            const colXP = offsetX + this.PANEL_WIDTH - 80;

            ctx.textBaseline = 'top';
            drawText(ctx, '#', colRank, contentY + 8, { size: 14, weight: 'bold', fill: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0 });
            drawText(ctx, 'Player', colName, contentY + 8, { size: 14, weight: 'bold', fill: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0 });
            drawText(ctx, 'Level', colLevel, contentY + 8, { size: 14, weight: 'bold', fill: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0 });
            ctx.textAlign = 'right';
            drawText(ctx, 'XP', colXP + 50, contentY + 8, { size: 14, weight: 'bold', fill: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0 });
            ctx.textAlign = 'left';

            contentY += columnHeaderHeight;

            // Rows
            this.entries.forEach((entry, index) => {
                const rank = index + 1;
                const rowY = contentY;

                // Alternating row background
                if (rank % 2 === 0) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                } else {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                }
                ctx.fillRect(offsetX + 10, rowY, this.PANEL_WIDTH - 20, this.ROW_HEIGHT);

                // Medal colors for top 3
                let rankColor = '#FFFFFF';
                if (rank === 1) rankColor = '#FFD700';
                else if (rank === 2) rankColor = '#C0C0C0';
                else if (rank === 3) rankColor = '#CD7F32';

                ctx.textBaseline = 'middle';
                const rankText = `${rank}`;
                drawText(ctx, rankText, colRank, rowY + this.ROW_HEIGHT / 2, { size: 16, weight: 'bold', fill: rankColor, strokeWidth: 1 });

                // Username
                const displayName = entry.username.length > 20 ? entry.username.substring(0, 17) + '...' : entry.username;
                drawText(ctx, displayName, colName, rowY + this.ROW_HEIGHT / 2, { size: 14, fill: rankColor, strokeWidth: 0.5 });

                // Level
                drawText(ctx, `${entry.level}`, colLevel, rowY + this.ROW_HEIGHT / 2, { size: 14, weight: 'bold', fill: '#FFFFFF', strokeWidth: 0.5 });

                // XP
                ctx.textAlign = 'right';
                const xpText = this.formatXP(entry.totalXP);
                drawText(ctx, xpText, colXP + 50, rowY + this.ROW_HEIGHT / 2, { size: 13, fill: 'rgba(255, 255, 255, 0.8)', strokeWidth: 0.5 });
                ctx.textAlign = 'left';

                contentY += this.ROW_HEIGHT;
            });
        }

        ctx.restore();

        // Scrollbar
        if (this.contentHeight > this.PANEL_HEIGHT - this.HEADER_HEIGHT) {
            drawScrollbar(
                ctx,
                scrollbarLayout(offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, this.HEADER_HEIGHT, this.SCROLLBAR_WIDTH),
                {
                    contentHeight: this.contentHeight,
                    panelHeight: this.PANEL_HEIGHT,
                    headerHeight: this.HEADER_HEIGHT,
                    scrollY: this.scrollY,
                    maxScroll,
                    thumbColor: '#c4871a',
                },
            );
        }

        this.panelBounds = {
            x: offsetX,
            y: offsetY,
            width: this.PANEL_WIDTH,
            height: this.PANEL_HEIGHT
        };

        ctx.restore();
    }

    private formatXP(xp: number): string {
        if (xp >= 1000000) return `${(xp / 1000000).toFixed(1)}M`;
        if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
        return `${xp}`;
    }

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        drawRoundedRect(ctx, x, y, width, height, radius);
    }
}
