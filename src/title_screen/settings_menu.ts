import { invalidateSettingsCache } from '../constants';
import { drawRoundedRect, hsvAdjust, drawGardnButton } from './render_utils';
import { applyZoomCompensation } from '../zoom-compensation';
import { resolveMobileControlsEnabled } from '../graphics/mobile-controls';
import { getCurrentGame } from '../app_refs';
import { isMainCanvasCtxCommitted } from '../graphics/canvas_ctx_state';
import { clearSession, getAuthToken, getServerUrl } from '../auth_session';

/**
 * Push the persisted renderScale + antialiasing settings to the live game's
 * canvas so changes apply without a reload. Called on slider drag and
 * checkbox toggle.
 */
function applyRenderScaleToActiveGame(): void {
    const game = getCurrentGame();
    if (!game || !game.canvas) return;
    const renderScale = parseFloat(localStorage.getItem('renderScale') || '1');
    const antialiasing = localStorage.getItem('antialiasing') !== 'false';
    const safeScale = isNaN(renderScale) ? 1 : Math.max(0.25, Math.min(1, renderScale));
    // HiDPI: keep the main canvas at physical resolution.
    applyZoomCompensation(game.canvas, antialiasing, true);
    if (game.graphics) {
        game.graphics.renderScale = safeScale;
        game.graphics.antialiasing = antialiasing;
        // Recompute logical dims/device scale, then resize the low-res buffer.
        game.graphics.syncViewMetrics();
        game.graphics.syncWorldCanvasSize();
    }
    if (game.graphics?.ctx) {
        game.graphics.ctx.imageSmoothingEnabled = antialiasing;
    }
}

export const DEFAULT_CONTROLS: { [key: string]: string } = {
    move_up: 'w',
    move_down: 's',
    move_left: 'a',
    move_right: 'd',
    inventory: 'z',
    crafting: 'c',
    skills: 'x',
    toggle_mouse_controls: 'k',
    toggle_hitboxes: 'h',
    toggle_debug_menu: 'j',
    zoom_in: '=',
    zoom_out: '-',
    chat: 'Enter',
    extend_petals: ' ',
    retract_petals: 'Shift',
};

export function getControls(): { [key: string]: string } {
    const saved = localStorage.getItem('controls');
    if (saved) return { ...DEFAULT_CONTROLS, ...JSON.parse(saved) };
    return { ...DEFAULT_CONTROLS };
}

type SettingsTab = 'controls' | 'graphics' | 'advanced' | 'credits';

/**
 * Owns the canvas-based settings panel: state, rendering, hit-testing,
 * and keyboard handling. The host (TitleScreen / Game) routes input events
 * through `handle*` while open and renders via `render(ctx)`.
 */
export class SettingsMenu {
    private isOpen = false;
    private tab: SettingsTab = 'controls';
    private scrollY = 0;
    private hoveredItem: string | null = null;
    private editingControl: string | null = null;
    private pressedButton: string | null = null;
    private sliderDragging: string | null = null;
    private contentBottomY = 0;

    private showHitboxes = false;
    private showStats = false;
    private mobFramerate = 15;
    private highQualityMobs = false;
    private dynamicSkybox = false;
    private mobDeathAnimation = true;
    private interpolation = 0.15;
    private showConsoleLogs = false;
    private showAdminCommands = false;
    private showAdminsOnLeaderboard = false;
    private debugMenuEnabled = false;
    private numberKeysUseItems = false;
    private useMouseControls = false;
    private requestMobile = false;
    private antialiasing = true;
    private gpuAcceleration = true;
    private disableUltraParticles = false;
    private renderScale = 1.0;
    private serverIP = '';
    private serverIPFocused = false;

    constructor() {
        this.loadValues();
    }

    public isMenuOpen(): boolean { return this.isOpen; }

    public toggle(): void {
        this.isOpen = !this.isOpen;
        if (this.isOpen) this.loadValues();
    }

    public close(): void {
        this.isOpen = false;
        this.pressedButton = null;
        this.sliderDragging = null;
    }

    public getShowHitboxes(): boolean { return this.showHitboxes; }
    public getShowStats(): boolean { return this.showStats; }
    public getDynamicSkybox(): boolean { return this.dynamicSkybox; }
    public getServerIP(): string { return this.serverIP || window.location.origin; }

    private loadValues(): void {
        this.showHitboxes = localStorage.getItem('showHitboxes') === 'true';
        this.showStats = localStorage.getItem('showStats') === 'true';
        this.mobFramerate = parseInt(localStorage.getItem('mobAnimationFramerate') || '15', 10);
        this.highQualityMobs = localStorage.getItem('highQualityMobs') === 'true';
        this.dynamicSkybox = localStorage.getItem('dynamicSkybox') === 'true';
        this.mobDeathAnimation = localStorage.getItem('mobDeathAnimation') !== 'false';
        this.interpolation = parseFloat(localStorage.getItem('interpolationAmount') || '0.15');
        this.showConsoleLogs = localStorage.getItem('showConsoleLogs') === 'true';
        this.showAdminCommands = localStorage.getItem('showAdminCommands') === 'true';
        this.showAdminsOnLeaderboard = localStorage.getItem('showAdminsOnLeaderboard') === 'true';
        this.debugMenuEnabled = localStorage.getItem('debugMenuEnabled') === 'true';
        this.numberKeysUseItems = localStorage.getItem('numberKeysUseItems') === 'true';
        this.useMouseControls = localStorage.getItem('useMouseControls') === 'true';
        this.requestMobile = resolveMobileControlsEnabled();
        this.antialiasing = localStorage.getItem('antialiasing') !== 'false';
        this.gpuAcceleration = localStorage.getItem('gpuAcceleration') !== 'false';
        this.disableUltraParticles = localStorage.getItem('disableUltraParticles') === 'true';
        const savedScale = parseFloat(localStorage.getItem('renderScale') || '1');
        this.renderScale = isNaN(savedScale) ? 1 : Math.max(0.25, Math.min(1, savedScale));
        this.serverIP = localStorage.getItem('serverIP') || window.location.origin;
    }

    private getLayout() {
        const panelW = 420;
        const panelH = 500;
        const panelX = 20;
        const panelY = 70;
        const pad = 15;
        const tabH = 32;
        const headerH = 30;
        const contentX = panelX + pad;
        const contentW = panelW - 2 * pad;
        const contentTop = panelY + headerH + pad + tabH + 10;
        const contentBottom = panelY + panelH - pad;
        return { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom };
    }

    public render(ctx: CanvasRenderingContext2D): void {
        if (!this.isOpen) return;
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getLayout();

        ctx.save();

        ctx.fillStyle = hsvAdjust('#aaaaaa', 0.8);
        ctx.beginPath();
        drawRoundedRect(ctx, panelX, panelY, panelW, panelH, 5);
        ctx.fill();
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.rect(panelX + 4, panelY + 4, panelW - 8, panelH - 8);
        ctx.fill();

        ctx.font = 'bold 20px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('Settings', panelX + pad, panelY + pad + headerH / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Settings', panelX + pad, panelY + pad + headerH / 2);

        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        const closeBtnSize = 28;
        drawGardnButton(ctx, closeBtnX, closeBtnY, closeBtnSize, closeBtnSize,
            '#cc4444', this.hoveredItem === 'close', this.pressedButton === 'settings_close', 'X', 16, 3, 3);

        const tabs: Array<{ id: SettingsTab; label: string }> = [
            { id: 'controls', label: 'Controls' },
            { id: 'graphics', label: 'Graphics' },
            { id: 'advanced', label: 'Advanced' },
            { id: 'credits', label: 'Credits' },
        ];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        tabs.forEach((tab, i) => {
            const tx = contentX + i * (tabW + 5);
            const isActive = this.tab === tab.id;
            const hovered = this.hoveredItem === `tab_${tab.id}`;
            const baseColor = isActive ? '#8888bb' : '#a3a3a3';
            drawGardnButton(ctx, tx, tabY, tabW, tabH, baseColor, hovered && !isActive, this.pressedButton === `settings_tab_${tab.id}`, tab.label, 13, 3, 3);
        });

        ctx.save();
        ctx.beginPath();
        ctx.rect(panelX, contentTop, panelW, contentBottom - contentTop);
        ctx.clip();

        const rowH = 32;
        const checkboxSize = 22;
        const sliderH = 8;
        let cy = contentTop + this.scrollY;

        if (this.tab === 'graphics') {
            const checkboxes: Array<{ id: string; label: string; value: boolean }> = [
                { id: 'showHitboxes', label: 'Show Hitboxes', value: this.showHitboxes },
                { id: 'showStats', label: 'Show Performance Stats', value: this.showStats },
                { id: 'dynamicSkybox', label: 'Dynamic Skybox', value: this.dynamicSkybox },
                { id: 'mobDeathAnimation', label: 'Mob Death Animation', value: this.mobDeathAnimation },
                { id: 'antialiasing', label: 'Anti-aliasing', value: this.antialiasing },
                { id: 'gpuAcceleration', label: 'GPU Acceleration', value: this.gpuAcceleration },
                { id: 'disableUltraParticles', label: 'Disable Ultra+ Particles', value: this.disableUltraParticles },
                { id: 'showConsoleLogs', label: 'Show Console Logs', value: this.showConsoleLogs },
            ];

            for (const cb of checkboxes) {
                this.drawCheckbox(ctx, contentX, cy, checkboxSize, cb.value, cb.label, this.hoveredItem === `cb_${cb.id}`);
                cy += rowH;
            }

            cy += 5;
            ctx.font = 'bold 13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            const scalePct = Math.round(this.renderScale * 100);
            ctx.strokeText(`Render Resolution: ${scalePct}%`, contentX, cy + 8);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Render Resolution: ${scalePct}%`, contentX, cy + 8);
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.renderScale - 0.25) / 0.75, 'renderScale');
            cy += 25;

            ctx.strokeText(`Mob Animation FPS: ${this.mobFramerate}`, contentX, cy + 8);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Mob Animation FPS: ${this.mobFramerate}`, contentX, cy + 8);
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.mobFramerate - 5) / 55, 'mobFramerate');
            cy += 25;

            ctx.strokeText(`Interpolation: ${this.interpolation.toFixed(2)}`, contentX, cy + 8);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Interpolation: ${this.interpolation.toFixed(2)}`, contentX, cy + 8);
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.interpolation - 0.05) / 0.45, 'interpolation');
            cy += 30;

            const resetBtnW = 160;
            const resetBtnH = 30;
            drawGardnButton(ctx, contentX, cy, resetBtnW, resetBtnH, '#a3a3a3',
                this.hoveredItem === 'resetTutorial', this.pressedButton === 'settings_resetTutorial',
                'Reset Tutorial', 13, 3, 3);
            cy += resetBtnH + 10;

        } else if (this.tab === 'controls') {
            ctx.font = 'bold 15px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText('Controls', contentX, cy + 10);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Controls', contentX, cy + 10);
            cy += 28;

            const controls = getControls();
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;

            for (const action of Object.keys(controls)) {
                const displayName = action.replace(/_/g, ' ');
                ctx.font = 'bold 12px Ubuntu, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                const labelText = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                ctx.strokeText(labelText, contentX, cy + inputH / 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(labelText, contentX, cy + inputH / 2);

                const inputX = contentX + labelW;
                const isEditing = this.editingControl === action;
                const hovered = this.hoveredItem === `ctrl_${action}`;
                const boxColor = isEditing ? '#ffffff' : (hovered ? '#f0f0f0' : '#e6e6e6');
                ctx.fillStyle = hsvAdjust('#a3a3a3', 0.8);
                drawRoundedRect(ctx, inputX, cy, inputW, inputH, 3);
                ctx.fill();
                ctx.fillStyle = boxColor;
                ctx.fillRect(inputX + 3, cy + 3, inputW - 6, inputH - 6);

                ctx.font = 'bold 12px Ubuntu, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#000000';
                const keyText = isEditing ? '...' : (controls[action] === ' ' ? 'Space' : controls[action]);
                ctx.fillText(keyText, inputX + inputW / 2, cy + inputH / 2);

                cy += inputH + 6;
            }

            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            drawGardnButton(ctx, contentX, cy, btnW, btnH, '#5a9fdb',
                this.hoveredItem === 'saveControls', this.pressedButton === 'settings_saveControls',
                'Save Controls', 13, 3, 3);
            drawGardnButton(ctx, contentX + btnW + 10, cy, btnW, btnH, '#a3a3a3',
                this.hoveredItem === 'resetControls', this.pressedButton === 'settings_resetControls',
                'Reset to Default', 13, 3, 3);
            cy += btnH + 10;

            this.drawCheckbox(ctx, contentX, cy, 22, this.numberKeysUseItems, 'Number Keys Use Items (off = swap loadout)', this.hoveredItem === 'cb_numberKeysUseItems');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.useMouseControls, 'Use Mouse Controls (K toggles in-game)', this.hoveredItem === 'cb_useMouseControls');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.requestMobile, 'Request Mobile (touch joystick & attack/retract buttons)', this.hoveredItem === 'cb_requestMobile');
            cy += rowH;

        } else if (this.tab === 'advanced') {
            ctx.font = 'bold 13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText('Server IP:', contentX, cy + 10);
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Server IP:', contentX, cy + 10);
            cy += 25;

            const ipInputW = contentW;
            const ipInputH = 32;
            ctx.fillStyle = hsvAdjust('#a3a3a3', 0.8);
            drawRoundedRect(ctx, contentX, cy, ipInputW, ipInputH, 3);
            ctx.fill();
            ctx.fillStyle = this.serverIPFocused ? '#ffffff' : (this.hoveredItem === 'serverIP' ? '#f0f0f0' : '#e6e6e6');
            ctx.fillRect(contentX + 3, cy + 3, ipInputW - 6, ipInputH - 6);

            ctx.font = '13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#000000';
            const ipText = this.serverIP || window.location.origin;
            let displayIP = ipText;
            while (ctx.measureText(displayIP).width > ipInputW - 20 && displayIP.length > 0) {
                displayIP = displayIP.slice(1);
            }
            ctx.fillText(displayIP, contentX + 8, cy + ipInputH / 2);

            if (this.serverIPFocused && Math.floor(Date.now() / 500) % 2 === 0) {
                const cursorX = contentX + 8 + ctx.measureText(displayIP).width;
                ctx.fillStyle = '#000000';
                ctx.fillRect(cursorX, cy + 8, 2, ipInputH - 16);
            }
            cy += ipInputH + 15;

            this.drawCheckbox(ctx, contentX, cy, 22, this.showConsoleLogs, 'Show Console Logs on Screen', this.hoveredItem === 'cb_showConsoleLogs_adv');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.showAdminCommands, 'Show Admin Commands', this.hoveredItem === 'cb_showAdminCommands');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.showAdminsOnLeaderboard, 'Show Admins on Leaderboard', this.hoveredItem === 'cb_showAdminsOnLeaderboard');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.debugMenuEnabled, 'Enable Debug Menu button (J in-game)', this.hoveredItem === 'cb_debugMenuEnabled');
            cy += rowH;

            cy += 10;
            const logoutBtnW = 160;
            const logoutBtnH = 32;
            drawGardnButton(ctx, contentX, cy, logoutBtnW, logoutBtnH, '#cc4444',
                this.hoveredItem === 'logout', this.pressedButton === 'settings_logout',
                'Log Out', 14, 3, 3);
            cy += logoutBtnH + 10;
        } else if (this.tab === 'credits') {
            cy = this.renderCreditsTab(ctx, contentX, contentW, cy);
        }

        this.contentBottomY = cy;

        ctx.restore();
        ctx.restore();
    }

    private renderCreditsTab(ctx: CanvasRenderingContext2D, contentX: number, contentW: number, startY: number): number {
        let cy = startY;
        const drawText = (text: string, font: string, color: string, y: number, align: CanvasTextAlign = 'left') => {
            ctx.font = font;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            const drawX = align === 'center' ? contentX + contentW / 2 : contentX;
            ctx.strokeText(text, drawX, y);
            ctx.fillStyle = color;
            ctx.fillText(text, drawX, y);
        };

        drawText('Flowrix.pro', 'bold 18px Ubuntu, sans-serif', '#ffffff', cy + 10, 'center');
        cy += 30;
        drawText('Developers', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• sussybite8888', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• Cookery', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• Codelinkd203', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• NachoFrenchFry', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• Arras Guard YT', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('Inspired By', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• florr.io by M28', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawText('Assets & Libraries', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawText('• Icons from game-icons.net and svgrepo.com', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• Ubuntu font by Canonical', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawText('• Assets extracted by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('• UI style by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawText('Thanks for playing!', 'bold 13px Ubuntu, sans-serif', '#cccccc', cy + 8, 'center');
        return cy + 20;
    }

    private drawCheckbox(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, checked: boolean, label: string, hovered: boolean): void {
        ctx.fillStyle = hsvAdjust('#666666', 0.4);
        drawRoundedRect(ctx, x, y + 2, size, size, 4);
        ctx.fill();
        const innerColor = checked ? '#cfcfcf' : '#666666';
        ctx.fillStyle = hovered ? hsvAdjust(innerColor, 1.1) : innerColor;
        ctx.fillRect(x + 3, y + 5, size - 6, size - 6);

        ctx.font = 'bold 13px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeText(label, x + size + 8, y + 2 + size / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + size + 8, y + 2 + size / 2);
    }

    private drawSlider(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, ratio: number, id: string): void {
        const r = Math.max(0, Math.min(1, ratio));
        ctx.fillStyle = '#888888';
        drawRoundedRect(ctx, x, y, width, height, height / 2);
        ctx.fill();
        const fillW = Math.max(height, width * r);
        ctx.fillStyle = '#5a9fdb';
        drawRoundedRect(ctx, x, y, fillW, height, height / 2);
        ctx.fill();
        const thumbR = 10;
        const thumbX = x + width * r;
        const thumbY = y + height / 2;
        const thumbHovered = this.hoveredItem === `slider_${id}` || this.sliderDragging === id;
        ctx.fillStyle = thumbHovered ? '#ffffff' : '#dddddd';
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    /** Returns true if click was inside the panel (consumed). */
    public handleClick(x: number, y: number): boolean {
        if (!this.isOpen) return false;

        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getLayout();

        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
            this.isOpen = false;
            return true;
        }

        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.isOpen = false;
            return true;
        }

        const tabs: Array<SettingsTab> = ['controls', 'graphics', 'advanced', 'credits'];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        for (let i = 0; i < tabs.length; i++) {
            const tx = contentX + i * (tabW + 5);
            if (x >= tx && x <= tx + tabW && y >= tabY && y <= tabY + tabH) {
                this.tab = tabs[i];
                this.scrollY = 0;
                this.editingControl = null;
                this.serverIPFocused = false;
                return true;
            }
        }

        if (y < contentTop || y > contentBottom) return true;

        const rowH = 32;
        let cy = contentTop + this.scrollY;

        if (this.tab === 'graphics') {
            const checkboxIds = ['showHitboxes', 'showStats', 'dynamicSkybox', 'mobDeathAnimation', 'antialiasing', 'gpuAcceleration', 'disableUltraParticles', 'showConsoleLogs'];
            for (const id of checkboxIds) {
                if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                    this.toggleCheckbox(id);
                    return true;
                }
                cy += rowH;
            }
            cy += 5 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.sliderDragging = 'renderScale';
                this.applySliderDrag(x);
                return true;
            }
            cy += 25 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.sliderDragging = 'mobFramerate';
                this.applySliderDrag(x);
                return true;
            }
            cy += 25 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.sliderDragging = 'interpolation';
                this.applySliderDrag(x);
                return true;
            }
            cy += 30;
            if (y >= cy && y <= cy + 30 && x >= contentX && x <= contentX + 160) {
                if (confirm('This will restart the tutorial on your next game. Continue?')) {
                    localStorage.removeItem('tutorial_completed');
                    localStorage.removeItem('tutorial_step');
                    alert('Tutorial will restart on your next game!');
                }
                return true;
            }
        } else if (this.tab === 'controls') {
            cy += 28;
            const controls = getControls();
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;

            for (const action of Object.keys(controls)) {
                const inputX = contentX + labelW;
                if (x >= inputX && x <= inputX + inputW && y >= cy && y <= cy + inputH) {
                    this.editingControl = action;
                    return true;
                }
                cy += inputH + 6;
            }

            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            if (y >= cy && y <= cy + btnH) {
                if (x >= contentX && x <= contentX + btnW) {
                    alert('Controls saved!');
                    return true;
                }
                if (x >= contentX + btnW + 10 && x <= contentX + contentW) {
                    localStorage.removeItem('controls');
                    alert('Controls have been reset to default.');
                    return true;
                }
            }
            cy += btnH + 10;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('numberKeysUseItems');
                return true;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('useMouseControls');
                return true;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('requestMobile');
                return true;
            }
        } else if (this.tab === 'advanced') {
            cy += 25;
            const ipInputH = 32;
            if (x >= contentX && x <= contentX + contentW && y >= cy && y <= cy + ipInputH) {
                this.serverIPFocused = true;
                return true;
            }
            cy += ipInputH + 15;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('showConsoleLogs');
                return true;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('showAdminCommands');
                return true;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('showAdminsOnLeaderboard');
                return true;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.toggleCheckbox('debugMenuEnabled');
                return true;
            }
            cy += rowH;
            cy += 10;
            const logoutBtnW = 160;
            const logoutBtnH = 32;
            if (y >= cy && y <= cy + logoutBtnH && x >= contentX && x <= contentX + logoutBtnW) {
                if (confirm('Are you sure you want to log out?')) {
                    this.performLogout();
                }
                return true;
            }
        }

        this.serverIPFocused = false;
        this.editingControl = null;
        return true;
    }

    public handleHover(x: number, y: number): void {
        if (!this.isOpen) return;

        this.hoveredItem = null;
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getLayout();

        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) return;

        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.hoveredItem = 'close';
            return;
        }

        const tabs: Array<SettingsTab> = ['controls', 'graphics', 'advanced', 'credits'];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        for (let i = 0; i < tabs.length; i++) {
            const tx = contentX + i * (tabW + 5);
            if (x >= tx && x <= tx + tabW && y >= tabY && y <= tabY + tabH) {
                this.hoveredItem = `tab_${tabs[i]}`;
                return;
            }
        }

        if (y < contentTop || y > contentBottom) return;

        const rowH = 32;
        let cy = contentTop + this.scrollY;

        if (this.tab === 'graphics') {
            const checkboxIds = ['showHitboxes', 'showStats', 'dynamicSkybox', 'mobDeathAnimation', 'antialiasing', 'gpuAcceleration', 'disableUltraParticles', 'showConsoleLogs'];
            for (const id of checkboxIds) {
                if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                    this.hoveredItem = `cb_${id}`;
                    return;
                }
                cy += rowH;
            }
            cy += 5 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'slider_renderScale';
                return;
            }
            cy += 25 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'slider_mobFramerate';
                return;
            }
            cy += 25 + 22;
            if (y >= cy - 10 && y <= cy + 20 && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'slider_interpolation';
                return;
            }
            cy += 30;
            if (y >= cy && y <= cy + 30 && x >= contentX && x <= contentX + 160) {
                this.hoveredItem = 'resetTutorial';
                return;
            }
        } else if (this.tab === 'controls') {
            cy += 28;
            const controls = getControls();
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;

            for (const action of Object.keys(controls)) {
                const inputX = contentX + labelW;
                if (x >= inputX && x <= inputX + inputW && y >= cy && y <= cy + inputH) {
                    this.hoveredItem = `ctrl_${action}`;
                    return;
                }
                cy += inputH + 6;
            }
            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            if (y >= cy && y <= cy + btnH) {
                if (x >= contentX && x <= contentX + btnW) {
                    this.hoveredItem = 'saveControls';
                    return;
                }
                if (x >= contentX + btnW + 10 && x <= contentX + contentW) {
                    this.hoveredItem = 'resetControls';
                    return;
                }
            }
            cy += btnH + 10;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_numberKeysUseItems';
                return;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_useMouseControls';
                return;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_requestMobile';
                return;
            }
        } else if (this.tab === 'advanced') {
            cy += 25;
            if (y >= cy && y <= cy + 32 && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'serverIP';
                return;
            }
            cy += 32 + 15;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_showConsoleLogs_adv';
                return;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_showAdminCommands';
                return;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_showAdminsOnLeaderboard';
                return;
            }
            cy += rowH;
            if (y >= cy && y <= cy + rowH && x >= contentX && x <= contentX + contentW) {
                this.hoveredItem = 'cb_debugMenuEnabled';
                return;
            }
            cy += rowH;
            cy += 10;
            const logoutBtnW = 160;
            const logoutBtnH = 32;
            if (y >= cy && y <= cy + logoutBtnH && x >= contentX && x <= contentX + logoutBtnW) {
                this.hoveredItem = 'logout';
                return;
            }
        }
    }

    /**
     * Clear credentials and end the server session, then reload to the title screen.
     */
    private performLogout(): void {
        this.close();
        const serverUrl = getServerUrl();
        const token = getAuthToken();
        const wasOffline = !!sessionStorage.getItem('isOffline');

        // Revoke server-side first — clearSession() drops the token, and a
        // token that outlives the logout is exactly the leftover this is
        // meant to prevent.
        if (!wasOffline && token) {
            fetch(`${serverUrl}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({}),
                keepalive: true
            }).catch(() => {});
        }

        clearSession();
        window.location.reload();
    }

    /** Returns true if mousedown was inside the panel (consumed). */
    public handleMouseDown(x: number, y: number): boolean {
        if (!this.isOpen) return false;
        if (this.hoveredItem) {
            this.pressedButton = `settings_${this.hoveredItem}`;
            if (this.hoveredItem === 'slider_mobFramerate' || this.hoveredItem === 'slider_interpolation' || this.hoveredItem === 'slider_renderScale') {
                this.sliderDragging = this.hoveredItem.replace('slider_', '');
                this.applySliderDrag(x);
            }
            return true;
        }
        const { panelW, panelH, panelX, panelY } = this.getLayout();
        if (x >= panelX && x <= panelX + panelW && y >= panelY && y <= panelY + panelH) {
            return true;
        }
        return false;
    }

    public handleMouseMove(x: number): void {
        if (this.sliderDragging) this.applySliderDrag(x);
    }

    public handleMouseUp(): void {
        this.pressedButton = null;
        this.sliderDragging = null;
    }

    public handleWheel(deltaY: number): void {
        if (!this.isOpen) return;
        const { contentTop, contentBottom } = this.getLayout();
        const viewportH = contentBottom - contentTop;
        const contentH = this.contentBottomY - (contentTop + this.scrollY);
        const minScroll = Math.min(0, viewportH - contentH);
        this.scrollY -= deltaY;
        this.scrollY = Math.max(minScroll, Math.min(0, this.scrollY));
    }

    /** Returns true if event was consumed. */
    public handleKeyDown(e: KeyboardEvent): boolean {
        if (!this.isOpen) return false;

        if (this.editingControl) {
            e.preventDefault();
            const controls = getControls();
            controls[this.editingControl] = e.key;
            localStorage.setItem('controls', JSON.stringify(controls));
            this.editingControl = null;
            return true;
        }
        if (this.serverIPFocused) {
            if (e.key === 'Backspace') {
                this.serverIP = this.serverIP.slice(0, -1);
                localStorage.setItem('serverIP', this.serverIP);
                e.preventDefault();
            } else if (e.key === 'Escape' || e.key === 'Enter') {
                this.serverIPFocused = false;
                e.preventDefault();
            } else if (e.key.length === 1) {
                this.serverIP += e.key;
                localStorage.setItem('serverIP', this.serverIP);
                e.preventDefault();
            }
            return true;
        }
        if (e.key === 'Escape') {
            this.isOpen = false;
            e.preventDefault();
            return true;
        }
        return false;
    }

    public clearHover(): void {
        this.hoveredItem = null;
        this.sliderDragging = null;
    }

    public isInteractingWithSlider(): boolean {
        return this.sliderDragging !== null;
    }

    private applySliderDrag(mouseX: number): void {
        const { contentX, contentW } = this.getLayout();
        const ratio = Math.max(0, Math.min(1, (mouseX - contentX) / contentW));
        if (this.sliderDragging === 'mobFramerate') {
            this.mobFramerate = Math.round(5 + ratio * 55);
            localStorage.setItem('mobAnimationFramerate', this.mobFramerate.toString());
            invalidateSettingsCache();
        } else if (this.sliderDragging === 'interpolation') {
            this.interpolation = Math.round((0.05 + ratio * 0.45) * 100) / 100;
            localStorage.setItem('interpolationAmount', this.interpolation.toString());
            const game = getCurrentGame();
            if (game) game.interpolationAmount = this.interpolation;
        } else if (this.sliderDragging === 'renderScale') {
            // Snap to 5% increments so the slider lands on intuitive values.
            const raw = 0.25 + ratio * 0.75;
            this.renderScale = Math.round(raw * 20) / 20;
            localStorage.setItem('renderScale', this.renderScale.toString());
            applyRenderScaleToActiveGame();
        }
    }

    private toggleCheckbox(id: string): void {
        switch (id) {
            case 'showHitboxes':
                this.showHitboxes = !this.showHitboxes;
                localStorage.setItem('showHitboxes', this.showHitboxes.toString());
                break;
            case 'showStats':
                this.showStats = !this.showStats;
                localStorage.setItem('showStats', this.showStats.toString());
                break;
            case 'highQualityMobs':
                this.highQualityMobs = !this.highQualityMobs;
                localStorage.setItem('highQualityMobs', this.highQualityMobs.toString());
                invalidateSettingsCache();
                break;
            case 'dynamicSkybox':
                this.dynamicSkybox = !this.dynamicSkybox;
                localStorage.setItem('dynamicSkybox', this.dynamicSkybox.toString());
                const skyboxGame = getCurrentGame();
                if (skyboxGame?.graphics) skyboxGame.graphics.dynamicSkybox = this.dynamicSkybox;
                break;
            case 'mobDeathAnimation':
                this.mobDeathAnimation = !this.mobDeathAnimation;
                localStorage.setItem('mobDeathAnimation', this.mobDeathAnimation.toString());
                const deathAnimGame = getCurrentGame();
                if (deathAnimGame) deathAnimGame.mobDeathAnimation = this.mobDeathAnimation;
                break;
            case 'antialiasing':
                this.antialiasing = !this.antialiasing;
                localStorage.setItem('antialiasing', this.antialiasing.toString());
                applyRenderScaleToActiveGame();
                break;
            case 'gpuAcceleration':
                this.gpuAcceleration = !this.gpuAcceleration;
                localStorage.setItem('gpuAcceleration', this.gpuAcceleration.toString());
                invalidateSettingsCache();
                // The main canvas's GPU-vs-software backing is fixed at 2D
                // context creation and can't switch on a live canvas, so a
                // reload is required to apply. Only reload if a context has
                // already been committed (i.e. a game has run this session);
                // otherwise it applies cleanly on the first join.
                if (isMainCanvasCtxCommitted()) {
                    window.location.reload();
                }
                break;
            case 'disableUltraParticles':
                this.disableUltraParticles = !this.disableUltraParticles;
                localStorage.setItem('disableUltraParticles', this.disableUltraParticles.toString());
                invalidateSettingsCache();
                break;
            case 'showConsoleLogs':
                this.showConsoleLogs = !this.showConsoleLogs;
                localStorage.setItem('showConsoleLogs', this.showConsoleLogs.toString());
                const logsGame = getCurrentGame();
                if (logsGame?.graphics) logsGame.graphics.setShowConsoleLogs(this.showConsoleLogs);
                break;
            case 'showAdminCommands':
                this.showAdminCommands = !this.showAdminCommands;
                localStorage.setItem('showAdminCommands', this.showAdminCommands.toString());
                break;
            case 'showAdminsOnLeaderboard':
                this.showAdminsOnLeaderboard = !this.showAdminsOnLeaderboard;
                localStorage.setItem('showAdminsOnLeaderboard', this.showAdminsOnLeaderboard.toString());
                break;
            case 'debugMenuEnabled':
                this.debugMenuEnabled = !this.debugMenuEnabled;
                localStorage.setItem('debugMenuEnabled', this.debugMenuEnabled.toString());
                break;
            case 'numberKeysUseItems':
                this.numberKeysUseItems = !this.numberKeysUseItems;
                localStorage.setItem('numberKeysUseItems', this.numberKeysUseItems.toString());
                break;
            case 'useMouseControls':
                this.useMouseControls = !this.useMouseControls;
                localStorage.setItem('useMouseControls', this.useMouseControls.toString());
                break;
            case 'requestMobile':
                this.requestMobile = !this.requestMobile;
                localStorage.setItem('requestMobile', this.requestMobile.toString());
                getCurrentGame()?.setMobileControlsEnabled(this.requestMobile);
                break;
        }
    }
}
