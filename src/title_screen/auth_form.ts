import { drawRoundedRect, hsvAdjust, drawGardnButton } from './render_utils';
import { drawText } from '../graphics/text';
import { HiddenTextInput } from './mobile_text_input';

export type AuthAction = 'login' | 'register' | 'guest' | 'offline';

export interface AuthFormCallbacks {
    onAction: (action: AuthAction) => void;
}

/**
 * Owns the canvas-based login/register form: state, hit-testing, rendering,
 * and keyboard handling. Network-side login/register/guest flows live on
 * TitleScreen and are notified via the `onAction` callback.
 */
export class AuthForm {
    private visible = false;
    private connecting = true;
    private loginMode = true;
    private focusedField: string | null = null;
    private hoveredButton: string | null = null;
    private advancedSettingsVisible = false;

    public username = '';
    public password = '';
    public confirmPassword = '';
    public serverIP: string = window.location.origin;

    private readonly callbacks: AuthFormCallbacks;
    // Real focusable <input> behind the canvas fields — without it, mobile
    // browsers never open the on-screen keyboard.
    private readonly textInput = new HiddenTextInput();
    private static readonly FIELD_MAX: Record<string, number> = {
        username: 50, password: 100, confirmPassword: 100,
    };

    constructor(callbacks: AuthFormCallbacks) {
        this.callbacks = callbacks;
    }

    public isVisible(): boolean { return this.visible; }
    public show(): void { this.visible = true; }
    public hide(): void {
        this.visible = false;
        this.setFocusedField(null);
        this.hoveredButton = null;
    }

    public isConnectingState(): boolean { return this.connecting; }
    public setConnecting(b: boolean): void { this.connecting = b; }
    public isFormLogin(): boolean { return this.loginMode; }
    public setLoginMode(login: boolean): void {
        this.loginMode = login;
        this.setFocusedField(null);
    }

    private getFieldValue(field: string): string {
        if (field === 'username') return this.username;
        if (field === 'password') return this.password;
        if (field === 'confirmPassword') return this.confirmPassword;
        if (field === 'serverIP') return this.serverIP;
        return '';
    }

    private setFieldValue(field: string, value: string): void {
        if (field === 'username') this.username = value;
        else if (field === 'password') this.password = value;
        else if (field === 'confirmPassword') this.confirmPassword = value;
        else if (field === 'serverIP') this.serverIP = value;
    }

    private nextField(field: string): string {
        if (this.loginMode) {
            if (field === 'username') return 'password';
            if (field === 'password') return this.advancedSettingsVisible ? 'serverIP' : 'username';
            return 'username';
        }
        if (field === 'username') return 'password';
        if (field === 'password') return 'confirmPassword';
        if (field === 'confirmPassword') return this.advancedSettingsVisible ? 'serverIP' : 'username';
        return 'username';
    }

    private setFocusedField(field: string | null): void {
        this.focusedField = field;
        if (!field) {
            this.textInput.blur();
            return;
        }
        this.textInput.focus({
            value: this.getFieldValue(field),
            password: field === 'password' || field === 'confirmPassword',
            maxLength: AuthForm.FIELD_MAX[field],
            onInput: (v) => this.setFieldValue(field, v),
            onEnter: () => this.callbacks.onAction(this.loginMode ? 'login' : 'register'),
            onTab: () => this.setFocusedField(this.nextField(field)),
            onBlur: () => {
                if (this.focusedField === field) this.focusedField = null;
            },
        });
    }
    public getHoveredButton(): string | null { return this.hoveredButton; }
    public clearHover(): void { this.hoveredButton = null; }

    public render(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, pressedButton: string | null): void {
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

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const formTitle = this.loginMode ? 'Login' : 'Register';
        drawText(ctx, formTitle, centerX, currentY,
            { size: 28, weight: 'bold', fill: '#ffffff', stroke: '#000000', strokeWidth: 3 });
        currentY += 50;

        if (location.protocol === 'http:') {
            const warningText = 'WARNING: Using HTTP (not secure)';
            drawText(ctx, warningText, centerX, currentY,
                { size: 14, weight: 'bold', fill: '#ff6b6b', stroke: '#000000', strokeWidth: 2 });
            currentY += 30;
        }

        currentY += 10;
        this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
            'username', this.username, 'Username');
        currentY += inputHeight + 15;

        this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
            'password', this.password, 'Password', true);
        currentY += inputHeight + 15;

        if (!this.loginMode) {
            this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
                'confirmPassword', this.confirmPassword, 'Confirm Password', true);
            currentY += inputHeight + 15;
        }

        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        const advancedText = `Advanced Settings ${this.advancedSettingsVisible ? '[^]' : '[v]'}`;
        drawGardnButton(ctx, inputX, advancedButtonY, inputWidth, advancedButtonHeight,
            '#7B2FA0', this.hoveredButton === 'toggleAdvanced', pressedButton === 'toggleAdvanced',
            advancedText, 14, 4, inputRadius);
        currentY += advancedButtonHeight + 10;

        if (this.advancedSettingsVisible) {
            this.drawInput(ctx, inputX, currentY, inputWidth, inputHeight, inputRadius,
                'serverIP', this.serverIP, 'Server IP');
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

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            drawText(ctx, 'Guest accounts do not keep progress', centerX, currentY + 6,
                { size: 11, fill: '#FF9800', strokeWidth: 0 });
        } else {
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'register', 'Register', '#8A2BE2', pressedButton);
            currentY += buttonHeight + buttonSpacing;
            this.drawButton(ctx, inputX, currentY, inputWidth, buttonHeight, inputRadius, 'offline', 'Register Offline', '#6A1B9A', pressedButton);
            currentY += buttonHeight + buttonSpacing;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            drawText(ctx, 'Already have an account? Login', centerX, currentY + 10,
                { size: 14, fill: this.hoveredButton === 'showLogin' ? '#ffffff' : '#E0B0FF', strokeWidth: 0 });
        }
    }

    private drawInput(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
                      _radius: number, fieldName: string, value: string, placeholder: string, isPassword: boolean = false): void {
        const isFocused = this.focusedField === fieldName;
        ctx.fillStyle = 'rgb(24, 206, 24)';
        ctx.strokeStyle = hsvAdjust('#18ce18', 0.8);
        ctx.lineWidth = isFocused ? 5 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        drawRoundedRect(ctx, x, y, width, height, 3);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const displayValue = isPassword ? '*'.repeat(value.length) : value;
        const displayText = displayValue || (isFocused ? '' : placeholder);
        drawText(ctx, displayText, x + 10, y + height / 2,
            { size: 18, fill: 'rgb(255, 255, 255)', stroke: 'rgb(0, 0, 0)', strokeWidth: 2 });

        if (isFocused) {
            const textWidth = ctx.measureText(displayText).width;
            const cursorX = x + 10 + textWidth;
            if (Math.floor(Date.now() / 500) % 2 === 0) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(cursorX, y + 10, 2, height - 20);
            }
        }
    }

    private drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
                       radius: number, buttonId: string, text: string, color: string, pressedButton: string | null): void {
        const isHovered = this.hoveredButton === buttonId;
        const isPressed = pressedButton === buttonId;
        drawGardnButton(ctx, x, y, width, height, color, isHovered, isPressed, text, 18, 5, radius);
    }

    public handleClick(x: number, y: number, centerX: number, centerY: number): void {
        const formWidth = 400;
        const formHeight = this.loginMode ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30 + 50;
        if (location.protocol === 'http:') currentY += 30;
        currentY += 10;

        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.setFocusedField('username');
            return;
        }
        currentY += inputHeight + 15;

        if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
            this.setFocusedField('password');
            return;
        }
        currentY += inputHeight + 15;

        if (!this.loginMode) {
            if (x >= inputX && x <= inputX + inputWidth && y >= currentY && y <= currentY + inputHeight) {
                this.setFocusedField('confirmPassword');
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
                this.setFocusedField('serverIP');
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
                this.setLoginMode(false);
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
        } else {
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
                this.setLoginMode(true);
                return;
            }
        }

        this.setFocusedField(null);
    }

    public handleHover(x: number, y: number, centerX: number, centerY: number): void {
        const formWidth = 400;
        const formHeight = this.loginMode ? 500 : 600;
        const formX = centerX - formWidth / 2;
        const formY = centerY - formHeight / 2;
        const inputWidth = formWidth - 40;
        const inputHeight = 40;
        const inputX = formX + 20;
        let currentY = formY + 30 + 50;
        if (location.protocol === 'http:') currentY += 30;
        currentY += 10;

        currentY += inputHeight + 15;
        currentY += inputHeight + 15;
        if (!this.loginMode) currentY += inputHeight + 15;

        const advancedButtonY = currentY;
        const advancedButtonHeight = 35;
        if (x >= inputX && x <= inputX + inputWidth && y >= advancedButtonY && y <= advancedButtonY + advancedButtonHeight) {
            this.hoveredButton = 'toggleAdvanced';
            return;
        }
        currentY += advancedButtonHeight + 10;
        if (this.advancedSettingsVisible) currentY += inputHeight + 15;

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
        } else {
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
    public handleKeyDown(e: KeyboardEvent): boolean {
        if (!this.focusedField) return false;

        if (e.key === 'Backspace') {
            if (this.focusedField === 'username') this.username = this.username.slice(0, -1);
            else if (this.focusedField === 'password') this.password = this.password.slice(0, -1);
            else if (this.focusedField === 'confirmPassword') this.confirmPassword = this.confirmPassword.slice(0, -1);
            else if (this.focusedField === 'serverIP') this.serverIP = this.serverIP.slice(0, -1);
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
            this.setFocusedField(this.nextField(this.focusedField));
            return true;
        }
        if (e.key.length === 1) {
            if (this.focusedField === 'username' && this.username.length < 50) this.username += e.key;
            else if (this.focusedField === 'password' && this.password.length < 100) this.password += e.key;
            else if (this.focusedField === 'confirmPassword' && this.confirmPassword.length < 100) this.confirmPassword += e.key;
            else if (this.focusedField === 'serverIP') this.serverIP += e.key;
            e.preventDefault();
            return true;
        }
        return false;
    }
}
