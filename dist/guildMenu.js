"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuildMenuManager = void 0;
const zoom_compensation_1 = require("./zoom-compensation");
const text_1 = require("./graphics/text");
/**
 * Canvas-based guild menu, drawn on the main game canvas (same lifecycle as
 * LeaderboardManager). Styling mirrors the inventory panel: a 4px inset border
 * with a lighter body, rounded corners, and a white title with a black stroke.
 * Accent color: #27dade.
 */
class GuildMenuManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.socket = null;
        this.isOpen = false;
        this.currentGuild = null;
        this.pendingInvite = null;
        this.scrollY = 0;
        this.contentHeight = 0;
        this.hitRegions = [];
        this.hoveredKey = null;
        this.isDragging = false;
        this.dragStartY = 0;
        this.dragStartScroll = 0;
        this.textInput = null; // shared input for create/invite/kick prompts
        this.promptMode = 'none';
        this.mouseDownHandler = null;
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;
        this.wheelHandler = null;
        this.keyHandler = null;
        // Layout constants (match leaderboard so HUD alignment stays consistent).
        this.PANEL_X = 20;
        this.PANEL_Y = 72;
        this.PANEL_WIDTH = 500;
        this.PANEL_HEIGHT = 500;
        this.HEADER_HEIGHT = 54;
        this.BORDER_W = 4;
        this.ROW_HEIGHT = 34;
        this.ACCENT = '#27dade';
        this.BORDER = '#1fb3b0';
        this.CLOSE_BG = '#dc7e92';
        this.CLOSE_BORDER = '#b56476';
        this.keyHandler = (e) => {
            if (!this.isOpen)
                return;
            if (e.key === 'Escape') {
                if (this.promptMode !== 'none') {
                    this.closePrompt();
                }
                else {
                    this.hide();
                }
            }
        };
        document.addEventListener('keydown', this.keyHandler);
    }
    setCanvas(canvas) {
        this.detachCanvas();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.attachCanvas();
    }
    setSocket(socket) {
        this.socket = socket;
    }
    /** Called by socket.ts when the server pushes a guildUpdate. */
    applyGuildUpdate(data) {
        this.currentGuild = data;
        if (data)
            this.pendingInvite = null;
    }
    /** Called by socket.ts when the server pushes a guildInviteReceived. */
    applyInviteReceived(data) {
        this.pendingInvite = data;
        if (!this.isOpen)
            this.show();
    }
    isGuildMenuOpen() { return this.isOpen; }
    toggle() { this.isOpen ? this.hide() : this.show(); }
    show() {
        this.isOpen = true;
        this.scrollY = 0;
    }
    hide() {
        this.isOpen = false;
        this.closePrompt();
    }
    cleanup() {
        this.detachCanvas();
        this.closePrompt();
        if (this.keyHandler)
            document.removeEventListener('keydown', this.keyHandler);
        this.keyHandler = null;
    }
    attachCanvas() {
        if (!this.canvas)
            return;
        this.mouseDownHandler = (e) => this.handleMouseDown(e);
        this.mouseMoveHandler = (e) => this.handleMouseMove(e);
        this.mouseUpHandler = () => { this.isDragging = false; };
        this.wheelHandler = (e) => this.handleWheel(e);
        this.canvas.addEventListener('mousedown', this.mouseDownHandler);
        this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
        this.canvas.addEventListener('mouseup', this.mouseUpHandler);
        this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }
    detachCanvas() {
        if (!this.canvas)
            return;
        if (this.mouseDownHandler)
            this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
        if (this.mouseMoveHandler)
            this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
        if (this.mouseUpHandler)
            this.canvas.removeEventListener('mouseup', this.mouseUpHandler);
        if (this.wheelHandler)
            this.canvas.removeEventListener('wheel', this.wheelHandler);
        this.mouseDownHandler = null;
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;
        this.wheelHandler = null;
    }
    currentUsername() {
        return this.socket?.username || '';
    }
    isLeader() {
        if (!this.currentGuild)
            return false;
        return this.currentGuild.leaderUsername.toLowerCase() === this.currentUsername().toLowerCase();
    }
    panelOffset() {
        // Canvas is always full-screen; panel is drawn at PANEL_X/PANEL_Y.
        return { x: this.PANEL_X, y: this.PANEL_Y };
    }
    hitTest(x, y) {
        for (const r of this.hitRegions) {
            if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
                return r;
        }
        return null;
    }
    regionKey(region) {
        if (!region)
            return null;
        if (region.kind.type === 'kick')
            return `kick:${region.kind.member}`;
        if (region.kind.type === 'squadOne')
            return `squadOne:${region.kind.member}`;
        return region.kind.type;
    }
    handleMouseDown(e) {
        if (!this.isOpen || !this.canvas)
            return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const region = this.hitTest(x, y);
        if (region) {
            e.preventDefault();
            this.handleAction(region.kind);
            return;
        }
        // Scrollbar drag.
        if (this.contentHeight > this.PANEL_HEIGHT - this.HEADER_HEIGHT) {
            const off = this.panelOffset();
            const scrollbarX = off.x + this.PANEL_WIDTH - 15;
            if (x >= scrollbarX && x <= scrollbarX + 10 &&
                y >= off.y + this.HEADER_HEIGHT && y <= off.y + this.PANEL_HEIGHT - 5) {
                this.isDragging = true;
                this.dragStartY = y;
                this.dragStartScroll = this.scrollY;
            }
        }
    }
    handleMouseMove(e) {
        if (!this.isOpen || !this.canvas)
            return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (this.isDragging) {
            const deltaY = y - this.dragStartY;
            const visible = this.PANEL_HEIGHT - this.HEADER_HEIGHT;
            const maxScroll = Math.max(0, this.contentHeight - visible);
            const ratio = deltaY / Math.max(1, visible - 5);
            this.scrollY = Math.max(0, Math.min(maxScroll, this.dragStartScroll + ratio * maxScroll));
            return;
        }
        const region = this.hitTest(x, y);
        this.hoveredKey = this.regionKey(region);
        if (this.canvas) {
            this.canvas.style.cursor = region ? 'pointer' : 'default';
        }
    }
    handleWheel(e) {
        if (!this.isOpen || !this.canvas)
            return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const off = this.panelOffset();
        if (x < off.x || x > off.x + this.PANEL_WIDTH || y < off.y || y > off.y + this.PANEL_HEIGHT)
            return;
        e.preventDefault();
        const visible = this.PANEL_HEIGHT - this.HEADER_HEIGHT;
        const maxScroll = Math.max(0, this.contentHeight - visible);
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY + e.deltaY));
    }
    handleAction(kind) {
        if (!this.socket) {
            this.toast('Not connected.');
            return;
        }
        switch (kind.type) {
            case 'close':
                this.hide();
                break;
            case 'create':
                this.openPrompt('create');
                break;
            case 'invite':
                this.openPrompt('invite');
                break;
            case 'leave':
                if (confirm('Leave this guild?'))
                    this.socket.emit('guildLeave');
                break;
            case 'squadAll':
                this.socket.emit('guildSquadAll');
                break;
            case 'acceptInvite':
                this.socket.emit('guildAccept');
                this.pendingInvite = null;
                break;
            case 'declineInvite':
                this.socket.emit('guildDecline');
                this.pendingInvite = null;
                break;
            case 'kick':
                if (confirm(`Kick ${kind.member} from the guild?`))
                    this.socket.emit('guildKick', kind.member);
                break;
            case 'squadOne':
                this.socket.emit('guildInviteToSquad', kind.member);
                break;
        }
    }
    openPrompt(mode, _memberHint) {
        if (this.textInput)
            this.closePrompt();
        this.promptMode = mode;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = mode === 'create' ? 32 : 24;
        input.placeholder = mode === 'create' ? 'Guild name' : mode === 'invite' ? 'Username to invite' : 'Username to kick';
        input.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 4000;
            padding: 8px 10px;
            width: 260px;
            border: 2px solid ${this.ACCENT};
            border-radius: 4px;
            background: #222;
            color: white;
            font-family: 'Ubuntu', sans-serif;
            outline: none;
        `;
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                this.submitPrompt(input.value.trim());
            }
            else if (e.key === 'Escape') {
                this.closePrompt();
            }
        });
        document.body.appendChild(input);
        this.textInput = input;
        setTimeout(() => input.focus(), 0);
    }
    submitPrompt(value) {
        if (!value || !this.socket) {
            this.closePrompt();
            return;
        }
        switch (this.promptMode) {
            case 'create':
                this.socket.emit('guildCreate', value);
                break;
            case 'invite':
                this.socket.emit('guildInvite', value);
                break;
            case 'kick':
                this.socket.emit('guildKick', value);
                break;
        }
        this.closePrompt();
    }
    closePrompt() {
        if (this.textInput) {
            this.textInput.remove();
            this.textInput = null;
        }
        this.promptMode = 'none';
    }
    toast(text) {
        // Lightweight fallback: we'd normally have a toast system, but the
        // chat already surfaces server errors, so this is just for local UI.
        console.warn('[GuildMenu]', text);
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
        const off = this.panelOffset();
        const x0 = off.x;
        const y0 = off.y;
        const w = this.PANEL_WIDTH;
        const h = this.PANEL_HEIGHT;
        this.hitRegions = [];
        ctx.save();
        ctx.setTransform((0, zoom_compensation_1.getBaseDeviceScale)(), 0, 0, (0, zoom_compensation_1.getBaseDeviceScale)(), 0, 0);
        // Panel border + body (inventory-style inset).
        ctx.fillStyle = this.BORDER;
        this.roundRect(ctx, x0, y0, w, h, 6);
        ctx.fill();
        ctx.fillStyle = this.ACCENT;
        this.roundRect(ctx, x0 + this.BORDER_W, y0 + this.BORDER_W, w - this.BORDER_W * 2, h - this.BORDER_W * 2, 4);
        ctx.fill();
        // Title.
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, 'Guild', x0 + 16, y0 + 14, { size: 22, weight: 'bold', fill: '#fff', strokeWidth: 4 });
        ctx.restore();
        // Close button (top-right, inventory-style).
        const closeSize = 30;
        const closeX = x0 + w - closeSize - 12;
        const closeY = y0 + 12;
        ctx.fillStyle = this.CLOSE_BORDER;
        this.roundRect(ctx, closeX, closeY, closeSize, closeSize, 4);
        ctx.fill();
        ctx.fillStyle = this.hoveredKey === 'close' ? '#e8a0b0' : this.CLOSE_BG;
        this.roundRect(ctx, closeX + 2, closeY + 2, closeSize - 4, closeSize - 4, 3);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        const pad = 8;
        ctx.beginPath();
        ctx.moveTo(closeX + pad, closeY + pad);
        ctx.lineTo(closeX + closeSize - pad, closeY + closeSize - pad);
        ctx.moveTo(closeX + closeSize - pad, closeY + pad);
        ctx.lineTo(closeX + pad, closeY + closeSize - pad);
        ctx.stroke();
        this.hitRegions.push({ x: closeX, y: closeY, width: closeSize, height: closeSize, kind: { type: 'close' } });
        // Pending invite banner (rendered above the main content area when no guild is set).
        const bodyTop = y0 + this.HEADER_HEIGHT;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + this.BORDER_W, bodyTop, w - this.BORDER_W * 2, h - this.HEADER_HEIGHT - this.BORDER_W);
        ctx.clip();
        let contentY = bodyTop + 6 - this.scrollY;
        let drawnY = 6; // virtual content height tracker
        if (this.pendingInvite && !this.currentGuild) {
            const bannerH = 70;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            this.roundRect(ctx, x0 + 12, contentY, w - 24, bannerH, 6);
            ctx.fill();
            ctx.textBaseline = 'top';
            (0, text_1.drawText)(ctx, `@${this.pendingInvite.fromUsername} invited you to`, x0 + 22, contentY + 8, { size: 14, weight: 'bold', fill: '#fff', strokeWidth: 0 });
            (0, text_1.drawText)(ctx, `${this.pendingInvite.guildName}`, x0 + 22, contentY + 26, { size: 16, weight: 'bold', fill: '#fff', strokeWidth: 0 });
            const btnW = 80, btnH = 26;
            const acceptX = x0 + w - 24 - btnW * 2 - 6;
            const acceptY = contentY + bannerH - btnH - 8;
            this.drawButton(ctx, acceptX, acceptY, btnW, btnH, 'Accept', '#4caf50', '#2e7d32', this.hoveredKey === 'acceptInvite');
            this.hitRegions.push({ x: acceptX, y: acceptY, width: btnW, height: btnH, kind: { type: 'acceptInvite' } });
            const declineX = acceptX + btnW + 6;
            this.drawButton(ctx, declineX, acceptY, btnW, btnH, 'Decline', '#ff5252', '#b71c1c', this.hoveredKey === 'declineInvite');
            this.hitRegions.push({ x: declineX, y: acceptY, width: btnW, height: btnH, kind: { type: 'declineInvite' } });
            contentY += bannerH + 10;
            drawnY += bannerH + 10;
        }
        if (!this.currentGuild) {
            // No guild — create view.
            ctx.textBaseline = 'top';
            (0, text_1.drawText)(ctx, 'You are not in a guild yet.', x0 + 16, contentY, { size: 14, weight: 'bold', fill: '#fff', strokeWidth: 0 });
            contentY += 20;
            (0, text_1.drawText)(ctx, 'Guilds hold up to 200 members and have a 5-character ID.', x0 + 16, contentY, { size: 13, fill: 'rgba(255,255,255,0.85)', strokeWidth: 0 });
            contentY += 18;
            (0, text_1.drawText)(ctx, 'The leader invites players; admins can force-join.', x0 + 16, contentY, { size: 13, fill: 'rgba(255,255,255,0.85)', strokeWidth: 0 });
            contentY += 26;
            const btnW = 160, btnH = 34;
            const btnX = x0 + 16;
            const btnY = contentY;
            this.drawButton(ctx, btnX, btnY, btnW, btnH, 'Create guild', '#fff', this.BORDER, this.hoveredKey === 'create');
            this.hitRegions.push({ x: btnX, y: btnY, width: btnW, height: btnH, kind: { type: 'create' } });
            drawnY += 100;
        }
        else {
            const guild = this.currentGuild;
            // Guild header line.
            ctx.save();
            ctx.textBaseline = 'top';
            ctx.lineJoin = 'round';
            const nameLine = `${guild.name}`;
            (0, text_1.drawText)(ctx, nameLine, x0 + 16, contentY, { size: 16, weight: 'bold', fill: '#fff', strokeWidth: 3 });
            contentY += 22;
            (0, text_1.drawText)(ctx, `Leader: @${guild.leaderUsername} — ${guild.memberUsernames.length}/200 members`, x0 + 16, contentY, { size: 13, fill: 'rgba(255,255,255,0.92)', strokeWidth: 0 });
            contentY += 22;
            ctx.restore();
            // Action buttons row.
            const actionsY = contentY;
            const smallW = 100, smallH = 28;
            let ax = x0 + 16;
            this.drawButton(ctx, ax, actionsY, smallW, smallH, 'Squad up', '#fff', this.BORDER, this.hoveredKey === 'squadAll');
            this.hitRegions.push({ x: ax, y: actionsY, width: smallW, height: smallH, kind: { type: 'squadAll' } });
            ax += smallW + 8;
            if (this.isLeader()) {
                this.drawButton(ctx, ax, actionsY, smallW, smallH, 'Invite...', '#fff', this.BORDER, this.hoveredKey === 'invite');
                this.hitRegions.push({ x: ax, y: actionsY, width: smallW, height: smallH, kind: { type: 'invite' } });
                ax += smallW + 8;
            }
            this.drawButton(ctx, ax, actionsY, smallW, smallH, 'Leave', '#fff', '#b71c1c', this.hoveredKey === 'leave');
            this.hitRegions.push({ x: ax, y: actionsY, width: smallW, height: smallH, kind: { type: 'leave' } });
            contentY += smallH + 14;
            drawnY += 22 + 22 + smallH + 14;
            // Members list.
            (0, text_1.drawText)(ctx, `Members (${guild.memberUsernames.length})`, x0 + 16, contentY, { size: 13, weight: 'bold', fill: 'rgba(255,255,255,0.95)', strokeWidth: 0 });
            contentY += 20;
            drawnY += 20;
            const onlineSet = new Set(guild.onlineUsernames.map(u => u.toLowerCase()));
            const me = this.currentUsername().toLowerCase();
            const sorted = guild.memberUsernames.slice().sort((a, b) => {
                const aOn = onlineSet.has(a.toLowerCase()) ? 0 : 1;
                const bOn = onlineSet.has(b.toLowerCase()) ? 0 : 1;
                if (aOn !== bOn)
                    return aOn - bOn;
                if (a.toLowerCase() === guild.leaderUsername.toLowerCase())
                    return -1;
                if (b.toLowerCase() === guild.leaderUsername.toLowerCase())
                    return 1;
                return a.localeCompare(b);
            });
            for (const member of sorted) {
                const rowY = contentY;
                const online = onlineSet.has(member.toLowerCase());
                const isMe = member.toLowerCase() === me;
                const isLeader = member.toLowerCase() === guild.leaderUsername.toLowerCase();
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                this.roundRect(ctx, x0 + 12, rowY, w - 24, this.ROW_HEIGHT - 4, 4);
                ctx.fill();
                // Online dot.
                ctx.fillStyle = online ? '#7dff7d' : '#888';
                ctx.beginPath();
                ctx.arc(x0 + 24, rowY + (this.ROW_HEIGHT - 4) / 2, 5, 0, Math.PI * 2);
                ctx.fill();
                // Name + badges.
                ctx.textBaseline = 'middle';
                let label = `@${member}`;
                if (isLeader)
                    label += '  ★';
                if (isMe)
                    label += '  (you)';
                (0, text_1.drawText)(ctx, label, x0 + 38, rowY + (this.ROW_HEIGHT - 4) / 2, { size: 13, weight: 'bold', fill: '#fff', strokeWidth: 0 });
                // Per-member action buttons on the right.
                const btnH = 22, btnW = 56;
                let bx = x0 + w - 16 - btnW;
                const by = rowY + (this.ROW_HEIGHT - 4 - btnH) / 2;
                if (this.isLeader() && !isMe) {
                    this.drawButton(ctx, bx, by, btnW, btnH, 'Kick', '#fff', '#b71c1c', this.hoveredKey === `kick:${member}`);
                    this.hitRegions.push({ x: bx, y: by, width: btnW, height: btnH, kind: { type: 'kick', member } });
                    bx -= btnW + 6;
                }
                if (!isMe && online) {
                    this.drawButton(ctx, bx, by, btnW, btnH, 'Squad', '#fff', this.BORDER, this.hoveredKey === `squadOne:${member}`);
                    this.hitRegions.push({ x: bx, y: by, width: btnW, height: btnH, kind: { type: 'squadOne', member } });
                }
                contentY += this.ROW_HEIGHT;
                drawnY += this.ROW_HEIGHT;
            }
        }
        this.contentHeight = drawnY;
        ctx.restore(); // unclip
        // Scrollbar.
        const visible = this.PANEL_HEIGHT - this.HEADER_HEIGHT;
        if (this.contentHeight > visible) {
            const trackX = x0 + w - 15;
            const trackY = bodyTop;
            const trackH = visible - 10;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            this.roundRect(ctx, trackX, trackY, 10, trackH, 5);
            ctx.fill();
            const thumbH = Math.max(24, (trackH * visible) / this.contentHeight);
            const maxScroll = Math.max(1, this.contentHeight - visible);
            const thumbY = trackY + (this.scrollY / maxScroll) * (trackH - thumbH);
            ctx.fillStyle = this.BORDER;
            this.roundRect(ctx, trackX, thumbY, 10, thumbH, 5);
            ctx.fill();
        }
        ctx.restore();
    }
    drawButton(ctx, x, y, w, h, label, labelColor, borderColor, hovered) {
        ctx.save();
        ctx.fillStyle = borderColor;
        this.roundRect(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.fillStyle = hovered ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.25)';
        this.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 3);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        (0, text_1.drawText)(ctx, label, x + w / 2, y + h / 2 + 1, { size: 13, weight: 'bold', fill: labelColor, strokeWidth: 3 });
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
}
exports.GuildMenuManager = GuildMenuManager;
