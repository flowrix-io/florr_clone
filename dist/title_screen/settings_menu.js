"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsMenu = exports.DEFAULT_CONTROLS = void 0;
exports.getControls = getControls;
const constants_1 = require("../constants");
const render_utils_1 = require("./render_utils");
const text_1 = require("../graphics/text");
const zoom_compensation_1 = require("../zoom-compensation");
const mobile_controls_1 = require("../graphics/mobile-controls");
const app_refs_1 = require("../app_refs");
const canvas_ctx_state_1 = require("../graphics/canvas_ctx_state");
const auth_session_1 = require("../auth_session");
/**
 * Push the persisted renderScale + antialiasing settings to the live game's
 * canvas so changes apply without a reload. Called on slider drag and
 * checkbox toggle.
 */
function applyRenderScaleToActiveGame() {
    const game = (0, app_refs_1.getCurrentGame)();
    if (!game || !game.canvas)
        return;
    const renderScale = parseFloat(localStorage.getItem('renderScale') || '1');
    const antialiasing = localStorage.getItem('antialiasing') !== 'false';
    const safeScale = isNaN(renderScale) ? 1 : Math.max(0.25, Math.min(1, renderScale));
    // HiDPI: keep the main canvas at physical resolution.
    (0, zoom_compensation_1.applyZoomCompensation)(game.canvas, antialiasing, true);
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
exports.DEFAULT_CONTROLS = {
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
function getControls() {
    const saved = localStorage.getItem('controls');
    if (saved)
        return { ...exports.DEFAULT_CONTROLS, ...JSON.parse(saved) };
    return { ...exports.DEFAULT_CONTROLS };
}
/**
 * Owns the canvas-based settings panel: state, rendering, hit-testing,
 * and keyboard handling. The host (TitleScreen / Game) routes input events
 * through `handle*` while open and renders via `render(ctx)`.
 */
class SettingsMenu {
    constructor() {
        this.isOpen = false;
        this.tab = 'controls';
        this.scrollY = 0;
        this.hoveredItem = null;
        this.editingControl = null;
        this.pressedButton = null;
        this.sliderDragging = null;
        this.contentBottomY = 0;
        this.showHitboxes = false;
        this.showStats = false;
        this.mobFramerate = 15;
        this.highQualityMobs = false;
        this.dynamicSkybox = false;
        this.mobDeathAnimation = true;
        this.interpolation = 0.15;
        this.showConsoleLogs = false;
        this.showAdminCommands = false;
        this.showAdminsOnLeaderboard = false;
        this.debugMenuEnabled = false;
        this.numberKeysUseItems = false;
        this.useMouseControls = false;
        this.requestMobile = false;
        this.antialiasing = true;
        this.gpuAcceleration = true;
        this.disableUltraParticles = false;
        this.renderScale = 1.0;
        this.serverIP = '';
        this.serverIPFocused = false;
        this.loadValues();
    }
    isMenuOpen() { return this.isOpen; }
    toggle() {
        this.isOpen = !this.isOpen;
        if (this.isOpen)
            this.loadValues();
    }
    close() {
        this.isOpen = false;
        this.pressedButton = null;
        this.sliderDragging = null;
    }
    getShowHitboxes() { return this.showHitboxes; }
    getShowStats() { return this.showStats; }
    getDynamicSkybox() { return this.dynamicSkybox; }
    getServerIP() { return this.serverIP || window.location.origin; }
    loadValues() {
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
        this.requestMobile = (0, mobile_controls_1.resolveMobileControlsEnabled)();
        this.antialiasing = localStorage.getItem('antialiasing') !== 'false';
        this.gpuAcceleration = localStorage.getItem('gpuAcceleration') !== 'false';
        this.disableUltraParticles = localStorage.getItem('disableUltraParticles') === 'true';
        const savedScale = parseFloat(localStorage.getItem('renderScale') || '1');
        this.renderScale = isNaN(savedScale) ? 1 : Math.max(0.25, Math.min(1, savedScale));
        this.serverIP = localStorage.getItem('serverIP') || window.location.origin;
    }
    getLayout() {
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
    render(ctx) {
        if (!this.isOpen)
            return;
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getLayout();
        ctx.save();
        ctx.fillStyle = (0, render_utils_1.hsvAdjust)('#aaaaaa', 0.8);
        ctx.beginPath();
        (0, render_utils_1.drawRoundedRect)(ctx, panelX, panelY, panelW, panelH, 5);
        ctx.fill();
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.rect(panelX + 4, panelY + 4, panelW - 8, panelH - 8);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        (0, text_1.drawText)(ctx, 'Settings', panelX + pad, panelY + pad + headerH / 2, { size: 20, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        const closeBtnSize = 28;
        (0, render_utils_1.drawGardnButton)(ctx, closeBtnX, closeBtnY, closeBtnSize, closeBtnSize, '#cc4444', this.hoveredItem === 'close', this.pressedButton === 'settings_close', 'X', 16, 3, 3);
        const tabs = [
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
            (0, render_utils_1.drawGardnButton)(ctx, tx, tabY, tabW, tabH, baseColor, hovered && !isActive, this.pressedButton === `settings_tab_${tab.id}`, tab.label, 13, 3, 3);
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
            const checkboxes = [
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
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const scalePct = Math.round(this.renderScale * 100);
            (0, text_1.drawText)(ctx, `Render Resolution: ${scalePct}%`, contentX, cy + 8, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.renderScale - 0.25) / 0.75, 'renderScale');
            cy += 25;
            // These two labels have always been outlined with the slider
            // thumb's leftover '#888888' stroke — kept for identical output.
            (0, text_1.drawText)(ctx, `Mob Animation FPS: ${this.mobFramerate}`, contentX, cy + 8, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#888888', strokeWidth: 2 });
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.mobFramerate - 5) / 55, 'mobFramerate');
            cy += 25;
            (0, text_1.drawText)(ctx, `Interpolation: ${this.interpolation.toFixed(2)}`, contentX, cy + 8, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#888888', strokeWidth: 2 });
            cy += 22;
            this.drawSlider(ctx, contentX, cy, contentW, sliderH, (this.interpolation - 0.05) / 0.45, 'interpolation');
            cy += 30;
            const resetBtnW = 160;
            const resetBtnH = 30;
            (0, render_utils_1.drawGardnButton)(ctx, contentX, cy, resetBtnW, resetBtnH, '#a3a3a3', this.hoveredItem === 'resetTutorial', this.pressedButton === 'settings_resetTutorial', 'Reset Tutorial', 13, 3, 3);
            cy += resetBtnH + 10;
        }
        else if (this.tab === 'controls') {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            (0, text_1.drawText)(ctx, 'Controls', contentX, cy + 10, { size: 15, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
            cy += 28;
            const controls = getControls();
            const labelW = contentW * 0.55;
            const inputW = contentW * 0.4;
            const inputH = 26;
            for (const action of Object.keys(controls)) {
                const displayName = action.replace(/_/g, ' ');
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const labelText = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                (0, text_1.drawText)(ctx, labelText, contentX, cy + inputH / 2, { size: 12, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
                const inputX = contentX + labelW;
                const isEditing = this.editingControl === action;
                const hovered = this.hoveredItem === `ctrl_${action}`;
                const boxColor = isEditing ? '#ffffff' : (hovered ? '#f0f0f0' : '#e6e6e6');
                ctx.fillStyle = (0, render_utils_1.hsvAdjust)('#a3a3a3', 0.8);
                (0, render_utils_1.drawRoundedRect)(ctx, inputX, cy, inputW, inputH, 3);
                ctx.fill();
                ctx.fillStyle = boxColor;
                ctx.fillRect(inputX + 3, cy + 3, inputW - 6, inputH - 6);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const keyText = isEditing ? '...' : (controls[action] === ' ' ? 'Space' : controls[action]);
                (0, text_1.drawText)(ctx, keyText, inputX + inputW / 2, cy + inputH / 2, { size: 12, weight: 'bold', fill: '#000000', strokeWidth: 0 });
                cy += inputH + 6;
            }
            cy += 10;
            const btnW = (contentW - 10) / 2;
            const btnH = 30;
            (0, render_utils_1.drawGardnButton)(ctx, contentX, cy, btnW, btnH, '#5a9fdb', this.hoveredItem === 'saveControls', this.pressedButton === 'settings_saveControls', 'Save Controls', 13, 3, 3);
            (0, render_utils_1.drawGardnButton)(ctx, contentX + btnW + 10, cy, btnW, btnH, '#a3a3a3', this.hoveredItem === 'resetControls', this.pressedButton === 'settings_resetControls', 'Reset to Default', 13, 3, 3);
            cy += btnH + 10;
            this.drawCheckbox(ctx, contentX, cy, 22, this.numberKeysUseItems, 'Number Keys Use Items (off = swap loadout)', this.hoveredItem === 'cb_numberKeysUseItems');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.useMouseControls, 'Use Mouse Controls (K toggles in-game)', this.hoveredItem === 'cb_useMouseControls');
            cy += rowH;
            this.drawCheckbox(ctx, contentX, cy, 22, this.requestMobile, 'Request Mobile (touch joystick & attack/retract buttons)', this.hoveredItem === 'cb_requestMobile');
            cy += rowH;
        }
        else if (this.tab === 'advanced') {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            (0, text_1.drawText)(ctx, 'Server IP:', contentX, cy + 10, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
            cy += 25;
            const ipInputW = contentW;
            const ipInputH = 32;
            ctx.fillStyle = (0, render_utils_1.hsvAdjust)('#a3a3a3', 0.8);
            (0, render_utils_1.drawRoundedRect)(ctx, contentX, cy, ipInputW, ipInputH, 3);
            ctx.fill();
            ctx.fillStyle = this.serverIPFocused ? '#ffffff' : (this.hoveredItem === 'serverIP' ? '#f0f0f0' : '#e6e6e6');
            ctx.fillRect(contentX + 3, cy + 3, ipInputW - 6, ipInputH - 6);
            ctx.font = '13px Ubuntu, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const ipText = this.serverIP || window.location.origin;
            let displayIP = ipText;
            while (ctx.measureText(displayIP).width > ipInputW - 20 && displayIP.length > 0) {
                displayIP = displayIP.slice(1);
            }
            (0, text_1.drawText)(ctx, displayIP, contentX + 8, cy + ipInputH / 2, { size: 13, fill: '#000000', strokeWidth: 0 });
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
            (0, render_utils_1.drawGardnButton)(ctx, contentX, cy, logoutBtnW, logoutBtnH, '#cc4444', this.hoveredItem === 'logout', this.pressedButton === 'settings_logout', 'Log Out', 14, 3, 3);
            cy += logoutBtnH + 10;
        }
        else if (this.tab === 'credits') {
            cy = this.renderCreditsTab(ctx, contentX, contentW, cy);
        }
        this.contentBottomY = cy;
        ctx.restore();
        ctx.restore();
    }
    renderCreditsTab(ctx, contentX, contentW, startY) {
        let cy = startY;
        const drawCredit = (text, font, color, y, align = 'left') => {
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            const drawX = align === 'center' ? contentX + contentW / 2 : contentX;
            (0, text_1.drawText)(ctx, text, drawX, y, { font, fill: color, stroke: '#000000', strokeWidth: 2 });
        };
        drawCredit('Flowrix.pro', 'bold 18px Ubuntu, sans-serif', '#ffffff', cy + 10, 'center');
        cy += 30;
        drawCredit('Developers', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawCredit('• sussybite8888', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• Cookery', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• Codelinkd203', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• NachoFrenchFry', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• Arras Guard YT', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('Inspired By', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawCredit('• florr.io by M28', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawCredit('Assets & Libraries', 'bold 14px Ubuntu, sans-serif', '#ffdd66', cy + 10);
        cy += 24;
        drawCredit('• Icons from game-icons.net and svgrepo.com', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• Ubuntu font by Canonical', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 28;
        drawCredit('• Assets extracted by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('• UI style by Bismuth(https://github.com/trigonal-bacon/gardn)', 'bold 12px Ubuntu, sans-serif', '#ffffff', cy + 8);
        cy += 20;
        drawCredit('Thanks for playing!', 'bold 13px Ubuntu, sans-serif', '#cccccc', cy + 8, 'center');
        return cy + 20;
    }
    drawCheckbox(ctx, x, y, size, checked, label, hovered) {
        ctx.fillStyle = (0, render_utils_1.hsvAdjust)('#666666', 0.4);
        (0, render_utils_1.drawRoundedRect)(ctx, x, y + 2, size, size, 4);
        ctx.fill();
        const innerColor = checked ? '#cfcfcf' : '#666666';
        ctx.fillStyle = hovered ? (0, render_utils_1.hsvAdjust)(innerColor, 1.1) : innerColor;
        ctx.fillRect(x + 3, y + 5, size - 6, size - 6);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        (0, text_1.drawText)(ctx, label, x + size + 8, y + 2 + size / 2, { size: 13, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 2 });
    }
    drawSlider(ctx, x, y, width, height, ratio, id) {
        const r = Math.max(0, Math.min(1, ratio));
        ctx.fillStyle = '#888888';
        (0, render_utils_1.drawRoundedRect)(ctx, x, y, width, height, height / 2);
        ctx.fill();
        const fillW = Math.max(height, width * r);
        ctx.fillStyle = '#5a9fdb';
        (0, render_utils_1.drawRoundedRect)(ctx, x, y, fillW, height, height / 2);
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
    handleClick(x, y) {
        if (!this.isOpen)
            return false;
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
        const tabs = ['controls', 'graphics', 'advanced', 'credits'];
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
        if (y < contentTop || y > contentBottom)
            return true;
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
        }
        else if (this.tab === 'controls') {
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
        }
        else if (this.tab === 'advanced') {
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
    handleHover(x, y) {
        if (!this.isOpen)
            return;
        this.hoveredItem = null;
        const { panelW, panelH, panelX, panelY, pad, tabH, headerH, contentX, contentW, contentTop, contentBottom } = this.getLayout();
        if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH)
            return;
        const closeBtnX = panelX + panelW - pad - 28;
        const closeBtnY = panelY + pad;
        if (x >= closeBtnX && x <= closeBtnX + 28 && y >= closeBtnY && y <= closeBtnY + 28) {
            this.hoveredItem = 'close';
            return;
        }
        const tabs = ['controls', 'graphics', 'advanced', 'credits'];
        const tabW = (contentW - (tabs.length - 1) * 5) / tabs.length;
        const tabY = panelY + headerH + pad + 5;
        for (let i = 0; i < tabs.length; i++) {
            const tx = contentX + i * (tabW + 5);
            if (x >= tx && x <= tx + tabW && y >= tabY && y <= tabY + tabH) {
                this.hoveredItem = `tab_${tabs[i]}`;
                return;
            }
        }
        if (y < contentTop || y > contentBottom)
            return;
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
        }
        else if (this.tab === 'controls') {
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
        }
        else if (this.tab === 'advanced') {
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
    performLogout() {
        this.close();
        const serverUrl = (0, auth_session_1.getServerUrl)();
        const token = (0, auth_session_1.getAuthToken)();
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
            }).catch(() => { });
        }
        (0, auth_session_1.clearSession)();
        window.location.reload();
    }
    /** Returns true if mousedown was inside the panel (consumed). */
    handleMouseDown(x, y) {
        if (!this.isOpen)
            return false;
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
    handleMouseMove(x) {
        if (this.sliderDragging)
            this.applySliderDrag(x);
    }
    handleMouseUp() {
        this.pressedButton = null;
        this.sliderDragging = null;
    }
    handleWheel(deltaY) {
        if (!this.isOpen)
            return;
        const { contentTop, contentBottom } = this.getLayout();
        const viewportH = contentBottom - contentTop;
        const contentH = this.contentBottomY - (contentTop + this.scrollY);
        const minScroll = Math.min(0, viewportH - contentH);
        this.scrollY -= deltaY;
        this.scrollY = Math.max(minScroll, Math.min(0, this.scrollY));
    }
    /** Returns true if event was consumed. */
    handleKeyDown(e) {
        if (!this.isOpen)
            return false;
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
            }
            else if (e.key === 'Escape' || e.key === 'Enter') {
                this.serverIPFocused = false;
                e.preventDefault();
            }
            else if (e.key.length === 1) {
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
    clearHover() {
        this.hoveredItem = null;
        this.sliderDragging = null;
    }
    isInteractingWithSlider() {
        return this.sliderDragging !== null;
    }
    applySliderDrag(mouseX) {
        const { contentX, contentW } = this.getLayout();
        const ratio = Math.max(0, Math.min(1, (mouseX - contentX) / contentW));
        if (this.sliderDragging === 'mobFramerate') {
            this.mobFramerate = Math.round(5 + ratio * 55);
            localStorage.setItem('mobAnimationFramerate', this.mobFramerate.toString());
            (0, constants_1.invalidateSettingsCache)();
        }
        else if (this.sliderDragging === 'interpolation') {
            this.interpolation = Math.round((0.05 + ratio * 0.45) * 100) / 100;
            localStorage.setItem('interpolationAmount', this.interpolation.toString());
            const game = (0, app_refs_1.getCurrentGame)();
            if (game)
                game.interpolationAmount = this.interpolation;
        }
        else if (this.sliderDragging === 'renderScale') {
            // Snap to 5% increments so the slider lands on intuitive values.
            const raw = 0.25 + ratio * 0.75;
            this.renderScale = Math.round(raw * 20) / 20;
            localStorage.setItem('renderScale', this.renderScale.toString());
            applyRenderScaleToActiveGame();
        }
    }
    toggleCheckbox(id) {
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
                (0, constants_1.invalidateSettingsCache)();
                break;
            case 'dynamicSkybox':
                this.dynamicSkybox = !this.dynamicSkybox;
                localStorage.setItem('dynamicSkybox', this.dynamicSkybox.toString());
                const skyboxGame = (0, app_refs_1.getCurrentGame)();
                if (skyboxGame?.graphics)
                    skyboxGame.graphics.dynamicSkybox = this.dynamicSkybox;
                break;
            case 'mobDeathAnimation':
                this.mobDeathAnimation = !this.mobDeathAnimation;
                localStorage.setItem('mobDeathAnimation', this.mobDeathAnimation.toString());
                const deathAnimGame = (0, app_refs_1.getCurrentGame)();
                if (deathAnimGame)
                    deathAnimGame.mobDeathAnimation = this.mobDeathAnimation;
                break;
            case 'antialiasing':
                this.antialiasing = !this.antialiasing;
                localStorage.setItem('antialiasing', this.antialiasing.toString());
                applyRenderScaleToActiveGame();
                break;
            case 'gpuAcceleration':
                this.gpuAcceleration = !this.gpuAcceleration;
                localStorage.setItem('gpuAcceleration', this.gpuAcceleration.toString());
                (0, constants_1.invalidateSettingsCache)();
                // The main canvas's GPU-vs-software backing is fixed at 2D
                // context creation and can't switch on a live canvas, so a
                // reload is required to apply. Only reload if a context has
                // already been committed (i.e. a game has run this session);
                // otherwise it applies cleanly on the first join.
                if ((0, canvas_ctx_state_1.isMainCanvasCtxCommitted)()) {
                    window.location.reload();
                }
                break;
            case 'disableUltraParticles':
                this.disableUltraParticles = !this.disableUltraParticles;
                localStorage.setItem('disableUltraParticles', this.disableUltraParticles.toString());
                (0, constants_1.invalidateSettingsCache)();
                break;
            case 'showConsoleLogs':
                this.showConsoleLogs = !this.showConsoleLogs;
                localStorage.setItem('showConsoleLogs', this.showConsoleLogs.toString());
                const logsGame = (0, app_refs_1.getCurrentGame)();
                if (logsGame?.graphics)
                    logsGame.graphics.setShowConsoleLogs(this.showConsoleLogs);
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
                (0, app_refs_1.getCurrentGame)()?.setMobileControlsEnabled(this.requestMobile);
                break;
        }
    }
}
exports.SettingsMenu = SettingsMenu;
