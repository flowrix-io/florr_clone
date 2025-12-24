"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsManager = void 0;
const STORAGE_KEY = 'game_notifications_read';
const NOTIFICATIONS_PER_PAGE = 50;
class NotificationsManager {
    constructor() {
        this.notificationsPanel = null;
        this.isOpen = false;
        this.notifications = [];
        this.unreadCount = 0;
        this.notificationButton = null;
        this.readNotifications = new Set();
        this.isLoading = false;
        this.hasMore = true;
        this.serverBaseUrl = '';
        this.loadReadNotifications();
        this.detectServerUrl();
        this.createNotificationsPanel();
        this.loadNotifications();
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
            this.populateNotifications();
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
    createNotificationsPanel() {
        this.notificationsPanel = document.createElement('div');
        this.notificationsPanel.className = 'notifications-panel';
        this.notificationsPanel.style.cssText = `
            position: absolute;
            top: 72px;
            left: 20px;
            width: 600px;
            max-height: 500px;
            background: #4a90e2;
            border: 2px solid #357abd;
            border-radius: 10px;
            padding: 20px;
            z-index: 4000;
            display: none;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        const content = document.createElement('div');
        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h2 class="outlined-text" style="margin: 0; font-family: Arial, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-smooth: always;">Notifications</h2>
                <div style="display: flex; gap: 10px;">
                    <button id="markAllReadButton" style="background: #357abd; color: white; border: none; padding: 5px 15px; border-radius: 5px; cursor: pointer; font-size: 14px;">Mark All Read</button>
                    <button id="clearNotificationsButton" style="background: #ff4444; color: white; border: none; padding: 5px 15px; border-radius: 5px; cursor: pointer; font-size: 16px;">✕</button>
                </div>
            </div>
            <div id="notificationsContent"></div>
        `;
        this.notificationsPanel.appendChild(content);
        document.body.appendChild(this.notificationsPanel);
        this.populateNotifications();
        // Add scroll listener for infinite scroll
        if (this.notificationsPanel) {
            this.notificationsPanel.addEventListener('scroll', () => {
                if (!this.notificationsPanel)
                    return;
                const scrollTop = this.notificationsPanel.scrollTop;
                const scrollHeight = this.notificationsPanel.scrollHeight;
                const clientHeight = this.notificationsPanel.clientHeight;
                // Load more when scrolled near bottom (within 100px)
                if (scrollHeight - scrollTop - clientHeight < 100 && this.hasMore && !this.isLoading) {
                    const oldestNotification = this.notifications[this.notifications.length - 1];
                    if (oldestNotification) {
                        this.loadNotifications(oldestNotification.timestamp);
                    }
                }
            });
        }
        // Add close button listener
        const closeButton = this.notificationsPanel.querySelector('#clearNotificationsButton');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.hide());
        }
        // Add mark all read button listener
        const markAllReadButton = this.notificationsPanel.querySelector('#markAllReadButton');
        if (markAllReadButton) {
            markAllReadButton.addEventListener('click', () => this.markAllAsRead());
        }
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
        // Add custom scrollbar styles
        const style = document.createElement('style');
        style.textContent = `
            .notifications-panel::-webkit-scrollbar {
                width: 10px;
            }
            .notifications-panel::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 5px;
            }
            .notifications-panel::-webkit-scrollbar-thumb {
                background: #357abd;
                border-radius: 5px;
            }
            .notifications-panel::-webkit-scrollbar-thumb:hover {
                background: #2a5f8f;
            }
            .notification-entry {
                margin-bottom: 15px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                border-left: 4px solid #357abd;
                position: relative;
            }
            .notification-entry.unread {
                background: rgba(255, 255, 255, 0.15);
                border-left-color: #ffd700;
            }
            .notification-entry.super-craft {
                border-left-color: #2bffa4;
            }
            .notification-entry.unique-craft {
                border-left-color: #bf00ff;
            }
            .notification-entry.star-code {
                border-left-color: #ffd700;
            }
            .notification-time {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.7);
                font-family: Arial, sans-serif;
                margin-top: 5px;
            }
            .notification-message {
                color: #FFFFFF;
                -webkit-text-stroke: 0.5px #000000;
                text-stroke: 0.5px #000000;
                font-family: Arial, sans-serif;
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
                font-smooth: always;
                line-height: 1.5;
            }
            .outlined-text {
                color: #FFFFFF;
                -webkit-text-stroke: 1px #000000;
                text-stroke: 1px #000000;
            }
        `;
        document.head.appendChild(style);
    }
    populateNotifications() {
        const contentDiv = this.notificationsPanel?.querySelector('#notificationsContent');
        if (!contentDiv)
            return;
        if (this.notifications.length === 0 && !this.isLoading) {
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.7); font-family: Arial, sans-serif;">
                    No notifications yet
                </div>
            `;
            return;
        }
        // Show notifications (already sorted newest first from server)
        contentDiv.innerHTML = this.notifications.map(notification => {
            const timeAgo = this.getTimeAgo(notification.timestamp);
            const typeClass = notification.type.replace('_', '-');
            const isRead = this.readNotifications.has(notification.id);
            const unreadClass = isRead ? '' : 'unread';
            return `
                <div class="notification-entry ${typeClass} ${unreadClass}" data-id="${notification.id}">
                    <div class="notification-message">${notification.message}</div>
                    <div class="notification-time">${timeAgo}</div>
                </div>
            `;
        }).join('');
        // Add loading indicator if more available
        if (this.hasMore) {
            contentDiv.innerHTML += `
                <div id="loadingIndicator" style="text-align: center; padding: 20px; color: rgba(255, 255, 255, 0.7); font-family: Arial, sans-serif;">
                    ${this.isLoading ? 'Loading...' : 'Scroll for more'}
                </div>
            `;
        }
        // Add click listeners to mark as read
        contentDiv.querySelectorAll('.notification-entry').forEach(entry => {
            entry.addEventListener('click', () => {
                const id = entry.getAttribute('data-id');
                if (id) {
                    this.markAsRead(id);
                }
            });
        });
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
            this.populateNotifications();
        }
    }
    markAllAsRead() {
        this.notifications.forEach(n => {
            this.readNotifications.add(n.id);
        });
        this.saveReadNotifications();
        this.populateNotifications();
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
        if (this.notificationsPanel) {
            this.notificationsPanel.style.display = 'block';
            this.isOpen = true;
            // Reload notifications when opening
            this.loadNotifications();
        }
    }
    hide() {
        if (this.notificationsPanel) {
            this.notificationsPanel.style.display = 'none';
            this.isOpen = false;
        }
    }
    isNotificationsOpen() {
        return this.isOpen;
    }
}
exports.NotificationsManager = NotificationsManager;
