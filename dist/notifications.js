"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsManager = void 0;
const STORAGE_KEY = 'game_notifications_read';
const NOTIFICATIONS_PER_PAGE = 50;
class NotificationsManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.isOpen = false;
        this.notifications = [];
        this.unreadCount = 0;
        this.notificationButton = null;
        this.readNotifications = new Set();
        this.isLoading = false;
        this.hasMore = true;
        this.serverBaseUrl = '';
        this.scrollY = 0;
        this.closeButtonBounds = null;
        this.markAllReadButtonBounds = null;
        this.panelBounds = null;
        this.contentHeight = 0;
        this.notificationBounds = new Map();
        this.PANEL_X = 20;
        this.PANEL_Y = 72;
        this.PANEL_WIDTH = 600;
        this.PANEL_HEIGHT = 500;
        this.PADDING = 20;
        this.SCROLLBAR_WIDTH = 10;
        this.isDragging = false;
        this.dragStartY = 0;
        this.dragStartScroll = 0;
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
    setCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupMouseListeners();
    }
    detectServerUrl() {
        // Use window.location.origin which includes protocol, hostname, and port
        if (typeof window !== 'undefined') {
            this.serverBaseUrl = window.location.origin;
        }
    }
    loadReadNotifications() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const readIds = JSON.parse(stored);
                this.readNotifications = new Set(readIds);
            }
        }
        catch (error) {
            console.error('[NOTIFICATIONS] Error loading read notifications:', error);
            this.readNotifications = new Set();
        }
    }
    saveReadNotifications() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.readNotifications)));
            this.updateUnreadCount();
            this.updateNotificationBadge();
        }
        catch (error) {
            console.error('[NOTIFICATIONS] Error saving read notifications:', error);
        }
    }
    async loadNotifications(beforeTimestamp) {
        if (this.isLoading)
            return;
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
            }
            else {
                // Replace with new notifications
                this.notifications = newNotifications;
            }
            // Mark read status
            this.notifications.forEach(n => {
                n.read = this.readNotifications.has(n.id);
            });
            this.hasMore = newNotifications.length === NOTIFICATIONS_PER_PAGE;
            this.updateUnreadCount();
        }
        catch (error) {
            console.error('[NOTIFICATIONS] Error loading notifications from server:', error);
        }
        finally {
            this.isLoading = false;
        }
    }
    updateUnreadCount() {
        this.unreadCount = this.notifications.filter(n => !this.readNotifications.has(n.id)).length;
    }
    updateNotificationBadge() {
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
    setNotificationButton(button) {
        this.notificationButton = button;
        this.updateNotificationBadge();
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
            // Check close button
            if (this.closeButtonBounds &&
                x >= this.closeButtonBounds.x && x <= this.closeButtonBounds.x + this.closeButtonBounds.width &&
                y >= this.closeButtonBounds.y && y <= this.closeButtonBounds.y + this.closeButtonBounds.height) {
                this.hide();
                return;
            }
            // Check mark all read button
            if (this.markAllReadButtonBounds &&
                x >= this.markAllReadButtonBounds.x && x <= this.markAllReadButtonBounds.x + this.markAllReadButtonBounds.width &&
                y >= this.markAllReadButtonBounds.y && y <= this.markAllReadButtonBounds.y + this.markAllReadButtonBounds.height) {
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
            // Check if mouse is over panel
            if (x >= this.PANEL_X && x <= this.PANEL_X + this.PANEL_WIDTH &&
                y >= this.PANEL_Y && y <= this.PANEL_Y + this.PANEL_HEIGHT) {
                e.preventDefault();
                const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
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
    render() {
        if (!this.ctx || !this.canvas || !this.isOpen)
            return;
        const ctx = this.ctx;
        // Save context state to restore after rendering
        ctx.save();
        // Calculate content height
        let currentY = this.PANEL_Y + 40 + this.PADDING;
        ctx.font = '14px Ubuntu, sans-serif';
        ctx.textBaseline = 'top';
        if (this.notifications.length === 0 && !this.isLoading) {
            this.contentHeight = 40;
        }
        else {
            this.notifications.forEach(() => {
                currentY += 80; // Approximate height per notification
            });
            if (this.hasMore) {
                currentY += 40; // Loading indicator
            }
            this.contentHeight = currentY - (this.PANEL_Y + 40 + this.PADDING);
        }
        const maxScroll = Math.max(0, this.contentHeight - (this.PANEL_HEIGHT - 40));
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
        // Draw panel background
        ctx.fillStyle = '#4a90e2';
        ctx.strokeStyle = '#357abd';
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
        ctx.strokeText('Notifications', this.PANEL_X + this.PADDING, this.PANEL_Y + this.PADDING);
        ctx.fillText('Notifications', this.PANEL_X + this.PADDING, this.PANEL_Y + this.PADDING);
        // Draw mark all read button (before clipping)
        const markAllReadButtonX = this.PANEL_X + this.PANEL_WIDTH - 180;
        const markAllReadButtonY = this.PANEL_Y + 10;
        const markAllReadButtonWidth = 120;
        const markAllReadButtonHeight = 30;
        this.markAllReadButtonBounds = {
            x: markAllReadButtonX,
            y: markAllReadButtonY,
            width: markAllReadButtonWidth,
            height: markAllReadButtonHeight
        };
        ctx.fillStyle = '#357abd';
        this.roundRect(ctx, markAllReadButtonX, markAllReadButtonY, markAllReadButtonWidth, markAllReadButtonHeight, 5);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '14px Ubuntu, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Mark All Read', markAllReadButtonX + markAllReadButtonWidth / 2, markAllReadButtonY + markAllReadButtonHeight / 2);
        ctx.textAlign = 'left';
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
        ctx.fillText('✕', closeButtonX + closeButtonWidth / 2, closeButtonY + closeButtonHeight / 2);
        ctx.textAlign = 'left';
        // Clip to panel content area (after header and buttons)
        ctx.save();
        ctx.beginPath();
        this.roundRect(ctx, this.PANEL_X + this.PADDING, this.PANEL_Y + 40, this.PANEL_WIDTH - this.PADDING * 2, this.PANEL_HEIGHT - 40 - this.PADDING, 8);
        ctx.clip();
        // Draw content
        let contentY = this.PANEL_Y + 40 + this.PADDING - this.scrollY;
        this.notificationBounds.clear();
        if (this.notifications.length === 0 && !this.isLoading) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No notifications yet', this.PANEL_X + this.PANEL_WIDTH / 2, contentY + 20);
            ctx.textAlign = 'left';
        }
        else {
            this.notifications.forEach(notification => {
                const isRead = this.readNotifications.has(notification.id);
                const timeAgo = this.getTimeAgo(notification.timestamp);
                // Determine border color based on type
                let borderColor = '#357abd';
                if (!isRead)
                    borderColor = '#ffd700';
                if (notification.type === 'super_craft')
                    borderColor = '#2bffa4';
                if (notification.type === 'unique_craft')
                    borderColor = '#bf00ff';
                if (notification.type === 'star_code')
                    borderColor = '#ffd700';
                // Draw entry background
                const entryX = this.PANEL_X + this.PADDING;
                const entryY = contentY;
                const entryWidth = this.PANEL_WIDTH - this.PADDING * 2 - (this.contentHeight > this.PANEL_HEIGHT - 40 ? this.SCROLLBAR_WIDTH + 5 : 0);
                const entryHeight = 70;
                ctx.fillStyle = isRead ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)';
                this.roundRect(ctx, entryX, entryY, entryWidth, entryHeight, 8);
                ctx.fill();
                // Draw left border
                ctx.fillStyle = borderColor;
                ctx.fillRect(entryX, entryY, 4, entryHeight);
                // Draw message
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 0.5;
                ctx.font = '14px Ubuntu, sans-serif';
                ctx.strokeText(notification.message, entryX + 10, entryY + 10);
                ctx.fillText(notification.message, entryX + 10, entryY + 10);
                // Draw time
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '12px Ubuntu, sans-serif';
                ctx.fillText(timeAgo, entryX + 10, entryY + 35);
                this.notificationBounds.set(notification.id, {
                    x: entryX,
                    y: entryY,
                    width: entryWidth,
                    height: entryHeight
                });
                contentY += 80;
            });
            // Draw loading indicator
            if (this.hasMore) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '14px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this.isLoading ? 'Loading...' : 'Scroll for more', this.PANEL_X + this.PANEL_WIDTH / 2, contentY + 10);
                ctx.textAlign = 'left';
            }
        }
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
            ctx.fillStyle = '#357abd';
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
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        }
        else if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        }
        else if (minutes > 0) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }
        else {
            return 'Just now';
        }
    }
    markAsRead(id) {
        if (!this.readNotifications.has(id)) {
            this.readNotifications.add(id);
            this.saveReadNotifications();
        }
    }
    markAllAsRead() {
        this.notifications.forEach(n => {
            this.readNotifications.add(n.id);
        });
        this.saveReadNotifications();
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
        // Reload notifications when opening
        this.loadNotifications();
    }
    hide() {
        this.isOpen = false;
    }
    isNotificationsOpen() {
        return this.isOpen;
    }
}
exports.NotificationsManager = NotificationsManager;
