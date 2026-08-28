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
import { getBaseDeviceScale } from './zoom-compensation';
import { drawText } from './graphics/text';
import { drawRoundedRect } from './graphics/shapes';
import { maxScrollFor, scrollFromThumbDrag } from './graphics/scroll-panel';

export interface Notification {
    id: string;
    type: 'super_craft' | 'unique_craft' | 'apex_craft' | 'star_code';
    message: string;
    timestamp: number;
    read?: boolean; // Optional for server notifications
}

const STORAGE_KEY = 'game_notifications_read';
const NOTIFICATIONS_PER_PAGE = 50;

export class NotificationsManager {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isOpen: boolean = false;
    private notifications: Notification[] = [];
    private unreadCount: number = 0;
    private notificationButton: HTMLElement | null = null;
    private readNotifications: Set<string> = new Set();
    private isLoading: boolean = false;
    private hasMore: boolean = true;
    private serverBaseUrl: string = '';
    private scrollY: number = 0;
    private closeButtonBounds: { x: number; y: number; width: number; height: number } | null = null;
    private markAllReadButtonBounds: { x: number; y: number; width: number; height: number } | null = null;
    private panelBounds: { x: number; y: number; width: number; height: number } | null = null;
    private contentHeight: number = 0;
    private notificationBounds: Map<string, { x: number; y: number; width: number; height: number }> = new Map();
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
        this.loadReadNotifications();
        this.detectServerUrl();
        this.loadNotifications();
        
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }

    public setCanvas(canvas: HTMLCanvasElement): void {
        // setupMouseListeners() has no matching teardown, so re-binding the
        // canvas it is already on would silently stack another set of pointer
        // listeners. Idempotent by contract.
        if (this.canvas === canvas) return;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }

    private detectServerUrl(): void {
        // Use window.location.origin which includes protocol, hostname, and port
        if (typeof window !== 'undefined') {
            this.serverBaseUrl = window.location.origin;
        }
    }

    private loadReadNotifications(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const readIds = JSON.parse(stored);
                this.readNotifications = new Set(readIds);
            }
        } catch (error) {
            console.error('[NOTIFICATIONS] Error loading read notifications:', error);
            this.readNotifications = new Set();
        }
    }

    private saveReadNotifications(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.readNotifications)));
            this.updateUnreadCount();
            this.updateNotificationBadge();
        } catch (error) {
            console.error('[NOTIFICATIONS] Error saving read notifications:', error);
        }
    }

    private async loadNotifications(beforeTimestamp?: number): Promise<void> {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const url = new URL('/api/notifications', this.serverBaseUrl);
            url.searchParams.set('limit', NOTIFICATIONS_PER_PAGE.toString());
            if (beforeTimestamp) {
                url.searchParams.set('before', beforeTimestamp.toString());
            }

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const newNotifications = data.notifications || [];

            if (beforeTimestamp) {
                // Append older notifications
                this.notifications = [...this.notifications, ...newNotifications];
            } else {
                // Replace with new notifications
                this.notifications = newNotifications;
            }

            // Mark read status
            this.notifications.forEach(n => {
                n.read = this.readNotifications.has(n.id);
            });

            this.hasMore = newNotifications.length === NOTIFICATIONS_PER_PAGE;
            this.updateUnreadCount();
        } catch (error) {
            console.error('[NOTIFICATIONS] Error loading notifications from server:', error);
        } finally {
            this.isLoading = false;
        }
    }

    private updateUnreadCount(): void {
        this.unreadCount = this.notifications.filter(n => !this.readNotifications.has(n.id)).length;
    }

    private updateNotificationBadge(): void {
        if (this.notificationButton) {
            // Remove existing badge if any
            const existingBadge = this.notificationButton.querySelector('.notification-badge');
            if (existingBadge) {
                existingBadge.remove();
            }

            // Add badge if there are unread notifications
            if (this.unreadCount > 0) {
                const badge = document.createElement('div');
                badge.className = 'notification-badge';
                badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount.toString();
                badge.style.cssText = `
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #ff4444;
                    color: white;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                    border: 2px solid #fff;
                    z-index: 10;
                `;
                this.notificationButton.style.position = 'relative';
                this.notificationButton.appendChild(badge);
            }
        }
    }

    public setNotificationButton(button: HTMLElement): void {
        this.notificationButton = button;
        this.updateNotificationBadge();
    }

    private setupMouseListeners(): void {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            const rect = this.canvas!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check close button
            if (pointInRect(this.closeButtonBounds, x, y)) {
                this.hide();
                return;
            }

            // Check mark all read button
            if (pointInRect(this.markAllReadButtonBounds, x, y)) {
                this.markAllAsRead();
                return;
            }

            // Check notification entries
            for (const [id, bounds] of this.notificationBounds.entries()) {
                if (x >= bounds.x && x <= bounds.x + bounds.width &&
                    y >= bounds.y && y <= bounds.y + bounds.height) {
                    this.markAsRead(id);
                    return;
                }
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
            if (this.isDragging) {
                const rect = this.canvas!.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const deltaY = y - this.dragStartY;
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
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

            // Check if mouse is over panel
            const offsetX = this.PANEL_X;
            const offsetY = this.PANEL_Y;
            if (x >= offsetX && x <= offsetX + this.PANEL_WIDTH &&
                y >= offsetY && y <= offsetY + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
                this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY - e.deltaY));
                
                // Load more when scrolled near bottom
                if (this.scrollY >= maxScroll - 100 && this.hasMore && !this.isLoading) {
                    const oldestNotification = this.notifications[this.notifications.length - 1];
                    if (oldestNotification) {
                        this.loadNotifications(oldestNotification.timestamp);
                    }
                }
            }
        });
    }

    public render(): void {
        if (!this.canvas || !this.isOpen) {
            return;
        }
        // Re-get context if it's null (might have been lost)
        if (!this.ctx) {
            this.ctx = this.canvas.getContext('2d');
            if (!this.ctx) {
                console.error('[NOTIFICATIONS] Failed to get context');
                return;
            }
        }
        const ctx = this.ctx;
        
        // The canvas is always full-screen now; the panel is drawn at PANEL_X/PANEL_Y.
        const offsetX = this.PANEL_X;
        const offsetY = this.PANEL_Y;

        // Save context state to restore after rendering
        ctx.save();

        // Reset any transformations that might affect text measurement
        // This ensures text measurement is accurate
        ctx.setTransform(getBaseDeviceScale(), 0, 0, getBaseDeviceScale(), 0, 0);
        // Defensive: do not inherit textAlign from upstream renderers. The title
        // header below relies on left-aligned start positioning.
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        // Calculate content height (accounting for text wrapping)
        // First pass: calculate without scrollbar to get approximate height
        let currentY = offsetY + 40 + this.PADDING;
        ctx.font = '14px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        
        if (this.notifications.length === 0 && !this.isLoading) {
            this.contentHeight = 40;
        } else {
            // Calculate max text width without scrollbar first (we'll recalculate if needed)
            const maxTextWidthNoScrollbar = this.PANEL_WIDTH - this.PADDING * 2 - 20; // 20px for left/right text padding
            
            this.notifications.forEach(notification => {
                // Calculate how many lines the message will take
                const wrappedText = this.wrapTextWithNewlines(ctx, notification.message, maxTextWidthNoScrollbar);
                const wrappedLines = wrappedText.split('\n');
                const messageHeight = wrappedLines.length * 18; // 18px per line (14px font + 4px spacing)
                const baseHeight = 50; // Base height for border, padding, and time
                const totalHeight = Math.max(70, baseHeight + messageHeight); // Minimum 70px, or base + message height
                currentY += totalHeight;
            });
            if (this.hasMore) {
                currentY += 40; // Loading indicator
            }
            this.contentHeight = currentY - (offsetY + 40 + this.PADDING);
            
            // If we need a scrollbar, recalculate with scrollbar width
            if (this.contentHeight > this.PANEL_HEIGHT - 40) {
                currentY = offsetY + 40 + this.PADDING;
                const maxTextWidthWithScrollbar = this.PANEL_WIDTH - this.PADDING * 2 - (this.SCROLLBAR_WIDTH + 5) - 20;
                
                this.notifications.forEach(notification => {
                    const wrappedText = this.wrapTextWithNewlines(ctx, notification.message, maxTextWidthWithScrollbar);
                    const wrappedLines = wrappedText.split('\n');
                    const messageHeight = wrappedLines.length * 18;
                    const baseHeight = 50;
                    const totalHeight = Math.max(70, baseHeight + messageHeight);
                    currentY += totalHeight;
                });
                if (this.hasMore) {
                    currentY += 40;
                }
                this.contentHeight = currentY - (offsetY + 40 + this.PADDING);
            }
        }
        
        const maxScroll = maxScrollFor(this.contentHeight, this.PANEL_HEIGHT);
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));

        // Draw panel background
        drawPanelBackground(ctx, offsetX, offsetY, this.PANEL_WIDTH, this.PANEL_HEIGHT, '#4a90e2', '#357abd');

        // Draw header (before clipping)
        drawPanelTitle(ctx, 'Notifications', offsetX, offsetY, this.PADDING);

        this.markAllReadButtonBounds = drawPillButton(
            ctx, headerButtonRect(offsetX, offsetY, this.PANEL_WIDTH, 180, 120), 'Mark All Read', '#357abd',
        );

        this.closeButtonBounds = drawCloseButton(ctx, offsetX, offsetY, this.PANEL_WIDTH);

        // Clip to panel content area (after header and buttons)
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, offsetX + this.PADDING, offsetY + 40, 
                      this.PANEL_WIDTH - this.PADDING * 2, this.PANEL_HEIGHT - 40 - this.PADDING, 8);
        ctx.clip();

        // Draw content
        let contentY = offsetY + 40 + this.PADDING - this.scrollY;
        this.notificationBounds.clear();

        if (this.notifications.length === 0 && !this.isLoading) {
            ctx.textAlign = 'center';
            drawText(ctx, 'No notifications yet',
                offsetX + this.PANEL_WIDTH / 2,
                contentY + 20, { size: 14, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 });
            ctx.textAlign = 'left';
        } else {
            this.notifications.forEach(notification => {
                const isRead = this.readNotifications.has(notification.id);
                const timeAgo = this.getTimeAgo(notification.timestamp);
                
                // Determine border color based on type
                let borderColor = '#357abd';
                if (!isRead) borderColor = '#ffd700';
                if (notification.type === 'super_craft') borderColor = '#2bffa4';
                if (notification.type === 'unique_craft') borderColor = '#bf00ff';
                if (notification.type === 'apex_craft') borderColor = '#ff00ff';
                if (notification.type === 'star_code') borderColor = '#ffd700';

                // Calculate text width for wrapping (must match calculation used for contentHeight)
                const entryX = offsetX + this.PADDING;
                const entryY = contentY;
                const hasScrollbar = this.contentHeight > this.PANEL_HEIGHT - 40;
                const scrollbarWidth = hasScrollbar ? this.SCROLLBAR_WIDTH + 5 : 0;
                const entryWidth = this.PANEL_WIDTH - this.PADDING * 2 - scrollbarWidth;
                // maxTextWidth: entry width minus left/right text padding (10px each = 20px total)
                // This is the maximum pixel width the text can be before wrapping
                const maxTextWidth = entryWidth - 20;
                
                // Set font before wrapping (must match font used in contentHeight calculation)
                ctx.font = '14px Ubuntu, sans-serif';
                
                // Debug: log the calculation
                if (notification.message.length > 50) {
                    console.log('[NOTIFICATIONS] Wrapping calculation:', {
                        messageLength: notification.message.length,
                        entryWidth: entryWidth,
                        maxTextWidth: maxTextWidth,
                        scrollbarWidth: scrollbarWidth,
                        hasScrollbar: hasScrollbar
                    });
                }
                
                // Wrap the message text and insert newlines
                const wrappedText = this.wrapTextWithNewlines(ctx, notification.message, maxTextWidth);
                const wrappedLines = wrappedText.split('\n');
                const messageHeight = wrappedLines.length * 18; // 18px per line
                const baseHeight = 50; // Base height for border, padding, and time
                const entryHeight = Math.max(70, baseHeight + messageHeight); // Minimum 70px
                
                ctx.fillStyle = isRead ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)';
                this.roundRect(ctx, entryX, entryY, entryWidth, entryHeight, 8);
                ctx.fill();

                // Draw left border
                ctx.fillStyle = borderColor;
                ctx.fillRect(entryX, entryY, 4, entryHeight);

                // Draw message (split by newlines)
                let lineY = entryY + 10;

                wrappedLines.forEach((line, index) => {
                    if (line && line.trim()) {
                        drawText(ctx, line, entryX + 10, lineY, { size: 14, fill: '#FFFFFF', strokeWidth: 0.5 });
                    }
                    lineY += 18; // Move to next line (14px font + 4px spacing)
                });

                // Draw time (positioned at bottom of entry)
                drawText(ctx, timeAgo, entryX + 10, entryY + entryHeight - 20, { size: 12, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 });

                this.notificationBounds.set(notification.id, {
                    x: entryX,
                    y: entryY,
                    width: entryWidth,
                    height: entryHeight
                });

                contentY += entryHeight + 10; // Add spacing between notifications
            });

            // Draw loading indicator
            if (this.hasMore) {
                ctx.textAlign = 'center';
                drawText(
                    ctx,
                    this.isLoading ? 'Loading...' : 'Scroll for more',
                    offsetX + this.PANEL_WIDTH / 2,
                    contentY + 10,
                    { size: 14, fill: 'rgba(255, 255, 255, 0.7)', strokeWidth: 0 }
                );
                ctx.textAlign = 'left';
            }
        }

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
                    thumbColor: '#357abd',
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

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        drawRoundedRect(ctx, x, y, width, height, radius);
    }

    private getTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        } else if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (minutes > 0) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else {
            return 'Just now';
        }
    }

    private wrapTextWithNewlines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
        if (!text || text.trim() === '') {
            return '';
        }
        
        // Save context state and reset transformations for accurate text measurement
        // This is critical because the context might be transformed (scaled/translated) in-game
        ctx.save();
        ctx.setTransform(getBaseDeviceScale(), 0, 0, getBaseDeviceScale(), 0, 0); // Reset to identity matrix
        
        // Ensure font is set before measuring - this is critical!
        ctx.font = '14px Ubuntu, sans-serif';
        
        // Verify maxWidth is reasonable (should be around 540px for 600px panel)
        if (maxWidth <= 0 || maxWidth > 1000) {
            console.error('[NOTIFICATIONS] Invalid maxWidth:', maxWidth);
            ctx.restore();
            return text;
        }
        
        // Measure the full text first to see if it needs wrapping
        const fullTextWidth = ctx.measureText(text).width;
        
        // Always log measurement for debugging
        console.log('[NOTIFICATIONS] wrapTextWithNewlines measurement:', {
            textLength: text.length,
            textPreview: text.substring(0, 60) + '...',
            fullTextWidth: fullTextWidth,
            maxWidth: maxWidth,
            needsWrapping: fullTextWidth > maxWidth,
            canvasWidth: ctx.canvas.width,
            canvasHeight: ctx.canvas.height
        });
        
        if (fullTextWidth <= maxWidth) {
            // Text fits on one line, no wrapping needed
            console.log('[NOTIFICATIONS] Text fits on one line, no wrapping needed');
            ctx.restore();
            return text;
        }
        
        console.log('[NOTIFICATIONS] Text needs wrapping, starting word-by-word wrapping...');
        
        const words = text.split(' ').filter(w => w.length > 0);
        const lines: string[] = [];
        
        console.log('[NOTIFICATIONS] Word count:', words.length, 'First few words:', words.slice(0, 5));
        
        if (words.length === 0) {
            console.warn('[NOTIFICATIONS] No words found after splitting');
            ctx.restore();
            return '';
        }
        
        // Check if even a single word is too long
        const firstWordWidth = ctx.measureText(words[0]).width;
        console.log('[NOTIFICATIONS] First word width:', firstWordWidth, 'maxWidth:', maxWidth);
        if (firstWordWidth > maxWidth) {
            // Single word is too long, return it anyway (will overflow)
            console.warn('[NOTIFICATIONS] First word too long, cannot wrap:', words[0].substring(0, 30));
            ctx.restore();
            return words[0];
        }
        
        let currentLine = words[0];
        let wrapCount = 0;

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + ' ' + word;
            const testWidth = ctx.measureText(testLine).width;
            
            if (testWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                // Current line is full, push it and start new line with this word
                if (currentLine.trim()) {
                    lines.push(currentLine);
                    wrapCount++;
                    console.log('[NOTIFICATIONS] Wrapped at word', i, '- line', wrapCount, ':', currentLine.substring(0, 40) + '...');
                }
                currentLine = word;
            }
        }
        
        // Push the last line
        if (currentLine.trim()) {
            lines.push(currentLine);
            console.log('[NOTIFICATIONS] Final line:', currentLine.substring(0, 40) + '...');
        }
        
        console.log('[NOTIFICATIONS] Total lines created:', lines.length, 'Total wraps:', wrapCount);
        
        // Restore context state
        ctx.restore();
        
        // Join lines with newlines
        const result = lines.length > 0 ? lines.join('\n') : text;
        
        if (lines.length > 1) {
            console.log('[NOTIFICATIONS] wrapTextWithNewlines SUCCESS - wrapped into', lines.length, 'lines');
            console.log('[NOTIFICATIONS] First line:', lines[0]?.substring(0, 50));
            console.log('[NOTIFICATIONS] Second line:', lines[1]?.substring(0, 50));
        } else {
            console.warn('[NOTIFICATIONS] wrapTextWithNewlines - text should have wrapped but only got', lines.length, 'line(s)');
        }
        
        return result;
    }


    public markAsRead(id: string): void {
        if (!this.readNotifications.has(id)) {
            this.readNotifications.add(id);
            this.saveReadNotifications();
        }
    }

    public markAllAsRead(): void {
        this.notifications.forEach(n => {
            this.readNotifications.add(n.id);
        });
        this.saveReadNotifications();
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
        // Reload notifications when opening
        this.loadNotifications();
    }

    public hide(): void {
        this.isOpen = false;
    }

    public isNotificationsOpen(): boolean {
        return this.isOpen;
    }

}

