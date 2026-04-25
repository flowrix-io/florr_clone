"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthForm = void 0;
const render_utils_1 = require("./render_utils");
/**
 * Owns the canvas-based login/register form: state, hit-testing, rendering,
 * and keyboard handling. Network-side login/register/guest flows live on
 * TitleScreen and are notified via the `onAction` callback.
 */
class AuthForm {
    constructor(callbacks) {
        this.visible = false;
        this.connecting = true;
        this.loginMode = true;
        this.focusedField = null;
        this.hoveredButton = null;
        this.advancedSettingsVisible = false;
        this.username = '';
        this.password = '';
        this.confirmPassword = '';
        this.serverIP = window.location.origin;
        this.callbacks = callbacks;
    }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    hide() {
        this.visible = false;
        this.focusedField = null;
        this.hoveredButton = null;
    }
    isConnectingState() { return this.connecting; }
    setConnecting(b) { this.connecting = b; }
    isFormLogin() { return this.loginMode; }
    setLoginMode(login) {
        this.loginMode = login;
        this.focusedField = null;
    }
    getHoveredButton() { return this.hoveredButton; }
    clearHover() { this.hoveredButton = null; }
    render(ctx, centerX, centerY, pressedButton) {
        const formWidth = 400;
        const formHeight = this.loginMode ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        const inputRadius = 5;
        const buttonHeight = 40;
        const buttonSpacing = 10;
        let currentY = formY + 30;
        // Suppress "unused" for formX (kept for layout symmetry; future hit-test math)
        void formX;
        ctx.font = 'bold 28px Ubuntu, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const formTitle = this.loginMode ? 'Login' : 'Register';
        ctx.strokeText(formTitle, centerX, currentY);
        ctx.fillText(formTitle, centerX, currentY);
        currentY += 50;
        if (location.protocol === 'http:') {
            ctx.font = 'bold 14px Ubuntu, sans-serif';
            ctx.fillStyle = '#ff6b6b';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            const warningText = 'WARNING: Using HTTP (not secure)';
            ctx.strokeText(warningText, centerX, currentY);
            ctx.fillText(warningText, centerX, currentY);
            currentY += 30;
        }
        currentY += 10;
        this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'username', this.username, 'Username');
        currentY += inputHeight + 15;
        this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'password', this.password, 'Password', true);
        currentY += inputHeight + 15;
        if (!this.loginMode) {
            this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'confirmPassword', this.confirmPassword, 'Confirm Password', true);
            currentY += inputHeight + 15;
        }
        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        const advancedText = `Advanced Settings ${this.advancedSettingsVisible ? '▲' : '▼'}`;
        (0, render_utils_1.drawGardnButton)(ctx, inputX, advancedButtonY, inputWidth, advancedButtonHeight, '#7B2FA0', this.hoveredButton === 'toggleAdvanced', pressedButton === 'toggleAdvanced', advancedText, 14, 4, inputRadius);
        currentY += advancedButtonHeight + 10;
        if (this.advancedSettingsVisible) {
            this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius, 'serverIP', this.serverIP, 'Server IP');
            currentY += inputHeight + 15;
        }
        currentY += 10;
        if (this.loginMode) {
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'login', 'Login', '#8A2BE2', pressedButton);
            currentY += buttonHeight + buttonSpacing;
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'showRegister', 'Register', '#8A2BE2', pressedButton);
            currentY += buttonHeight + buttonSpacing;
            const guestButtonWidth = inputWidth * 0.5;
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2;
            this.drawButton(ctx, guestButtonX, currentY, guestButtonWidth, buttonHeight * 0.8, inputRadius, 'guest', 'Guest', '#6A1B9A', pressedButton);
            currentY += buttonHeight * 0.8 + 4;
            ctx.font = '11px Ubuntu, sans-serif';
            ctx.fillStyle = '#FF9800';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Guest accounts do not keep progress', centerX, currentY + 6);
        }
        else {
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'register', 'Register', '#8A2BE2', pressedButton);
            currentY += buttonHeight + buttonSpacing;
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'offline', 'Register Offline', '#6A1B9A', pressedButton);
            currentY += buttonHeight + buttonSpacing;
            ctx.font = '14px Ubuntu, sans-serif';
            ctx.fillStyle = this.hoveredButton === 'showLogin' ? '#ffffff' : '#E0B0FF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Already have an account? Login', centerX, currentY + 10);
        }
    }
    drawInput(ctx, x, y, width, height, _radius, fieldName, value, placeholder, isPassword = false) {
        const isFocused = this.focusedField === fieldName;
        ctx.fillStyle = 'rgb(24, 206, 24)';
        ctx.strokeStyle = (0, render_utils_1.hsvAdjust)('#18ce18', 0.8);
        ctx.lineWidth = isFocused ? 5 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        (0, render_utils_1.drawRoundedRect)(ctx, x, y, width, height, 3);
        ctx.fill();
        ctx.stroke();
        ctx.font = '18px Ubuntu, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const displayValue = isPassword ? '*'.repeat(value.length) : value;
        const displayText = displayValue || (isFocused ? '' : placeholder);
        ctx.strokeStyle = 'rgb(0, 0, 0)';
        ctx.lineWidth = 2;
        ctx.strokeText(displayText, x + 10, y + height / 2);
        ctx.lineWidth = 0;
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillText(displayText, x + 10, y + height / 2);
        if (isFocused) {
            const textWidth = ctx.measureText(displayText).width;
            const cursorX = x + 10 + textWidth;
            if (Math.floor(Date.now() / 500) % 2 === 0) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(cursorX, y + 10, 2, height - 20);
            }
        }
    }
    drawButton(ctx, x, y, width, height, radius, buttonId, text, color, pressedButton) {
        const isHovered = this.hoveredButton === buttonId;
        const isPressed = pressedButton === buttonId;
        (0, render_utils_1.drawGardnButton)(ctx, x, y, width, height, color, isHovered, isPressed, text, 18, 5, radius);
    }
    handleClick(x, y, centerX, centerY) {
        const formWidth = 400;
        const formHeight = this.loginMode ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30 + 50;
        if (location.protocol === 'http:')
            currentY += 30;
        currentY += 10;
        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.focusedField = 'username';
            return;
        }
        currentY += inputHeight + 15;
        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.focusedField = 'password';
            return;
        }
        currentY += inputHeight + 15;
        if (!this.loginMode) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
                this.focusedField = 'confirmPassword';
                return;
            }
            currentY += inputHeight + 15;
        }
        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        if (x >= inputX && x <= inputX + inputWidth && y >= advancedButtonY && y <= advancedButtonY + advancedButtonHeight) {
            this.advancedSettingsVisible = !this.advancedSettingsVisible;
            return;
        }
        currentY += advancedButtonHeight + 10;
        if (this.advancedSettingsVisible) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
                this.focusedField = 'serverIP';
                return;
            }
            currentY += inputHeight + 15;
        }
        currentY += 10;
        const buttonHeight = 40;
        const buttonSpacing = 10;
        if (this.loginMode) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.callbacks.onAction('login');
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.loginMode = false;
                this.focusedField = null;
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            const guestButtonWidth = inputWidth * 0.5;
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2;
            const guestButtonHeight = buttonHeight * 0.8;
            if (x >= guestButtonX && x <= guestButtonX + guestButtonWidth &&
                y >= currentY && y <= currentY + guestButtonHeight) {
                this.callbacks.onAction('guest');
                return;
            }
        }
        else {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.callbacks.onAction('register');
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.callbacks.onAction('offline');
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (y >= currentY && y <= currentY + 20) {
                this.loginMode = true;
                this.focusedField = null;
                return;
            }
        }
        this.focusedField = null;
    }
    handleHover(x, y, centerX, centerY) {
        const formWidth = 400;
        const formHeight = this.loginMode ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30 + 50;
        if (location.protocol === 'http:')
            currentY += 30;
        currentY += 10;
        currentY += inputHeight + 15;
        currentY += inputHeight + 15;
        if (!this.loginMode)
            currentY += inputHeight + 15;
        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        if (x >= inputX && x <= inputX + inputWidth && y >= advancedButtonY && y <= advancedButtonY + advancedButtonHeight) {
            this.hoveredButton = 'toggleAdvanced';
            return;
        }
        currentY += advancedButtonHeight + 10;
        if (this.advancedSettingsVisible)
            currentY += inputHeight + 15;
        currentY += 10;
        const buttonHeight = 40;
        const buttonSpacing = 10;
        if (this.loginMode) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredButton = 'login';
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredButton = 'showRegister';
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            const guestButtonWidth = inputWidth * 0.5;
            const guestButtonX = inputX + (inputWidth - guestButtonWidth) / 2;
            const guestButtonHeight = buttonHeight * 0.8;
            if (x >= guestButtonX && x <= guestButtonX + guestButtonWidth &&
                y >= currentY && y <= currentY + guestButtonHeight) {
                this.hoveredButton = 'guest';
                return;
            }
        }
        else {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredButton = 'register';
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + buttonHeight) {
                this.hoveredButton = 'offline';
                return;
            }
            currentY += buttonHeight + buttonSpacing;
            if (y >= currentY && y <= currentY + 20) {
                this.hoveredButton = 'showLogin';
                return;
            }
        }
        this.hoveredButton = null;
    }
    /** Returns true if event was consumed. */
    handleKeyDown(e) {
        if (!this.focusedField)
            return false;
        if (e.key === 'Backspace') {
            if (this.focusedField === 'username')
                this.username = this.username.slice(0, -1);
            else if (this.focusedField === 'password')
                this.password = this.password.slice(0, -1);
            else if (this.focusedField === 'confirmPassword')
                this.confirmPassword = this.confirmPassword.slice(0, -1);
            else if (this.focusedField === 'serverIP')
                this.serverIP = this.serverIP.slice(0, -1);
            e.preventDefault();
            return true;
        }
        if (e.key === 'Enter') {
            this.callbacks.onAction(this.loginMode ? 'login' : 'register');
            e.preventDefault();
            return true;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            if (this.loginMode) {
                if (this.focusedField === 'username') {
                    this.focusedField = 'password';
                }
                else if (this.focusedField === 'password') {
                    this.focusedField = this.advancedSettingsVisible ? 'serverIP' : 'username';
                }
                else {
                    this.focusedField = 'username';
                }
            }
            else {
                if (this.focusedField === 'username') {
                    this.focusedField = 'password';
                }
                else if (this.focusedField === 'password') {
                    this.focusedField = 'confirmPassword';
                }
                else if (this.focusedField === 'confirmPassword') {
                    this.focusedField = this.advancedSettingsVisible ? 'serverIP' : 'username';
                }
                else {
                    this.focusedField = 'username';
                }
            }
            return true;
        }
        if (e.key.length === 1) {
            if (this.focusedField === 'username' && this.username.length < 50)
                this.username += e.key;
            else if (this.focusedField === 'password' && this.password.length < 100)
                this.password += e.key;
            else if (this.focusedField === 'confirmPassword' && this.confirmPassword.length < 100)
                this.confirmPassword += e.key;
            else if (this.focusedField === 'serverIP')
                this.serverIP += e.key;
            e.preventDefault();
            return true;
        }
        return false;
    }
}
exports.AuthForm = AuthForm;
