/**
 * Title Screen Menu Management
 * Handles all menu-related DOM elements and interactions
 */

export class TitleScreen {
    private authContainer!: HTMLElement;
    private loginForm!: HTMLElement;
    private registerForm!: HTMLElement;
    private gameMenu!: HTMLElement;
    private centerText!: HTMLElement;
    private exitButtonContainer!: HTMLElement;
    private deathScreen!: HTMLElement;
    private loadingScreen!: HTMLElement;
    private landContainer!: HTMLElement;
    private axolotlContainer!: HTMLElement;

    constructor() {
        this.initializeElements();
        this.setupEventListeners();
    }

    private initializeElements(): void {
        // Create authentication container
        this.authContainer = this.createElement('div', 'auth-container');
        this.authContainer.id = 'authContainer';
        this.authContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2000;
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 10px;
            color: white;
            pointer-events: auto;
        `;
        document.body.style.cssText = `
            background: rgb(0, 216, 133);
        `;
        this.loadingScreen = document.getElementById('loadingScreen') as HTMLElement;
        if (this.loadingScreen) {
            this.loadingScreen.style.cssText = `
                display: none;
            `;
        }

        // Create login form
        this.loginForm = this.createElement('div', 'auth-form');
        this.loginForm.id = 'loginForm';
        this.loginForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
        `;
        this.loginForm.innerHTML = `
            <h2>Login</h2>
            <input type="text" id="loginUsername" placeholder="Username">
            <input type="password" id="loginPassword" placeholder="Password">
            <div class="server-input">
                <input type="text" id="serverIP-connect" placeholder="Server IP">
            </div>
            <button id="loginButton">Login</button>
            <p class="form-switch" id="showRegister">Need an account? Register</p>
        `;

        // Create register form
        this.registerForm = this.createElement('div', 'auth-form hidden');
        this.registerForm.id = 'registerForm';
        this.registerForm.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 15px;
            min-width: 300px;
        `;
        this.registerForm.innerHTML = `
            <h2>Register</h2>
            <br/>
            <h3>Do not use your real name or any personal information as your username.</h3>
            <input type="text" id="registerUsername" placeholder="Username">
            <input type="password" id="registerPassword" placeholder="Password">
            <input type="password" id="registerConfirmPassword" placeholder="Confirm Password">
            <div class="single-player">
                <input type="text" id="serverIP-single" placeholder="Server IP">
            </div>
            <button id="registerButton">Register</button>
            <button id="registerOfflineButton">Register Offline</button>
            <p class="form-switch" id="showLogin">Already have an account? Login</p>
        `;

        // Create game menu
        this.gameMenu = this.createElement('div', '');
        this.gameMenu.id = 'gameMenu';
        this.gameMenu.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3000;
            text-align: center;
            display: flex;
            gap: 10px;
            padding: 15px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.7);
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        `;
        this.gameMenu.innerHTML = `
            <button id="multiPlayerButton" class="buttons">Start Game</button>
        `;

        // Create center text
        this.centerText = this.createElement('div', 'center_text');
        this.centerText.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            text-align: center;
            color: white;
            padding: 20px;
            border-radius: 10px;
            background: transparent;
            box-shadow: none;
        `;
        this.centerText.innerHTML = `
            <p class="title">Axolotl Game</p>
            <p class="instructions">Use arrow keys to move. Touch enemies to attack.</p>
            <input type="text" id="nameInput" class="name-input" placeholder="This flower is called...">
            <div class="color-picker">
                <label for="hueSlider">Player Color:</label>
                <input type="range" id="hueSlider" min="0" max="360" value="0" class="hue-slider">
                <div id="colorPreview" class="color-preview"></div>
                <button id="updateColorButton" class="color-update-btn">Update Color</button>
            </div>
            <div class="controls">
                <p>Controls:</p>
                <br/>
                <p>Press I to open the inventory.</p>
                <br/>
                <p>Press number keys 1-9 to use items.</p>
                <br/>
                <p>Press C to switch between mouse and keyboard controls</p>
                <br/>
                <p>Press R to craft items</p>
            </div>
        `;

        // Create exit button container
        this.exitButtonContainer = this.createElement('div', '');
        this.exitButtonContainer.id = 'exitButtonContainer';
        this.exitButtonContainer.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 3000;
            display: none;
        `;
        this.exitButtonContainer.innerHTML = `
            <img id="exitButton" src="./assets/exit.png" style="width: 32px; height: 32px; cursor: pointer; background: rgba(0, 0, 0, 0.5); padding: 5px; border-radius: 5px;" alt="Exit">
        `;

        // Create death screen
        this.deathScreen = this.createElement('div', 'hidden');
        this.deathScreen.id = 'deathScreen';
        this.deathScreen.innerHTML = `<p>You died!</p>`;

        // Create loading screen
        this.loadingScreen = this.createElement('div', 'hidden');
        this.loadingScreen.id = 'loadingScreen';
        this.loadingScreen.innerHTML = `<p>Loading...</p>`;

        // Create land and axolotl containers
        this.landContainer = this.createElement('div', '');
        this.landContainer.id = 'land-container';

        this.axolotlContainer = this.createElement('div', '');
        this.axolotlContainer.id = 'axolotl-container';
    }

    private createElement(tagName: string, className: string): HTMLElement {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }

    private setupEventListeners(): void {
        // Exit button event listener
        const exitButton = this.exitButtonContainer.querySelector('#exitButton');
        if (exitButton) {
            exitButton.addEventListener('click', () => {
                window.location.reload();
            });
        }

        // Form switching
        const showRegister = this.loginForm.querySelector('#showRegister');
        const showLogin = this.registerForm.querySelector('#showLogin');
        
        if (showRegister) {
            showRegister.addEventListener('click', () => {
                this.showRegisterForm();
            });
        }
        
        if (showLogin) {
            showLogin.addEventListener('click', () => {
                this.showLoginForm();
            });
        }
    }

    public appendToBody(): void {
        document.body.appendChild(this.authContainer);
        this.authContainer.appendChild(this.loginForm);
        this.authContainer.appendChild(this.registerForm);
        document.body.appendChild(this.gameMenu);
        document.body.appendChild(this.centerText);
        document.body.appendChild(this.exitButtonContainer);
        document.body.appendChild(this.deathScreen);
        document.body.appendChild(this.loadingScreen);
        document.body.appendChild(this.landContainer);
        document.body.appendChild(this.axolotlContainer);
    }

    public showLoginForm(): void {
        this.loginForm.classList.remove('hidden');
        this.registerForm.classList.add('hidden');
    }

    public showRegisterForm(): void {
        this.loginForm.classList.add('hidden');
        this.registerForm.classList.remove('hidden');
    }

    public hideAuthContainer(): void {
        this.authContainer.style.display = 'none';
    }

    public showAuthContainer(): void {
        this.authContainer.style.display = 'block';
    }

    public hideGameMenu(): void {
        this.gameMenu.style.display = 'none';
    }

    public showGameMenu(): void {
        this.gameMenu.style.display = 'flex';
    }

    public hideCenterText(): void {
        this.centerText.style.display = 'none';
    }

    public showCenterText(): void {
        this.centerText.style.display = 'block';
    }

    public showExitButton(): void {
        this.exitButtonContainer.style.display = 'block';
    }

    public hideExitButton(): void {
        this.exitButtonContainer.style.display = 'none';
    }

    public showDeathScreen(): void {
        this.deathScreen.classList.remove('hidden');
    }

    public hideDeathScreen(): void {
        this.deathScreen.classList.add('hidden');
    }

    public showLoadingScreen(): void {
        this.loadingScreen.classList.remove('hidden');
    }

    public hideLoadingScreen(): void {
        this.loadingScreen.classList.add('hidden');
    }

    // Getters for accessing form elements
    public getLoginUsername(): HTMLInputElement | null {
        return this.loginForm.querySelector('#loginUsername') as HTMLInputElement;
    }

    public getLoginPassword(): HTMLInputElement | null {
        return this.loginForm.querySelector('#loginPassword') as HTMLInputElement;
    }

    public getServerIPConnect(): HTMLInputElement | null {
        return this.loginForm.querySelector('#serverIP-connect') as HTMLInputElement;
    }

    public getLoginButton(): HTMLButtonElement | null {
        return this.loginForm.querySelector('#loginButton') as HTMLButtonElement;
    }

    public getRegisterUsername(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerUsername') as HTMLInputElement;
    }

    public getRegisterPassword(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerPassword') as HTMLInputElement;
    }

    public getRegisterConfirmPassword(): HTMLInputElement | null {
        return this.registerForm.querySelector('#registerConfirmPassword') as HTMLInputElement;
    }

    public getServerIPSingle(): HTMLInputElement | null {
        return this.registerForm.querySelector('#serverIP-single') as HTMLInputElement;
    }

    public getRegisterButton(): HTMLButtonElement | null {
        return this.registerForm.querySelector('#registerButton') as HTMLButtonElement;
    }

    public getRegisterOfflineButton(): HTMLButtonElement | null {
        return this.registerForm.querySelector('#registerOfflineButton') as HTMLButtonElement;
    }

    public getMultiPlayerButton(): HTMLButtonElement | null {
        return this.gameMenu.querySelector('#multiPlayerButton') as HTMLButtonElement;
    }

    public getNameInput(): HTMLInputElement | null {
        return this.centerText.querySelector('#nameInput') as HTMLInputElement;
    }

    public getHueSlider(): HTMLInputElement | null {
        return this.centerText.querySelector('#hueSlider') as HTMLInputElement;
    }

    public getColorPreview(): HTMLElement | null {
        return this.centerText.querySelector('#colorPreview') as HTMLElement;
    }

    public getUpdateColorButton(): HTMLButtonElement | null {
        return this.centerText.querySelector('#updateColorButton') as HTMLButtonElement;
    }

    public getExitButtonContainer(): HTMLElement {
        return this.exitButtonContainer;
    }
}

// CSS styles that were in the HTML
export const titleScreenStyles = `
    .auth-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2000;
        background: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 10px;
        color: white;
        pointer-events: auto;
    }

    .auth-form {
        display: flex;
        flex-direction: column;
        gap: 15px;
        min-width: 300px;
    }

    .auth-form input {
        padding: 10px;
        border-radius: 5px;
        border: 1px solid #ccc;
    }

    .auth-form button {
        margin: 5px 0;
    }

    .hidden {
        display: none;
    }

    .buttons {
        opacity: 1;
        pointer-events: auto;
    }

    .auth-visible .buttons {
        opacity: 0.5;
    }

    .center_text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        text-align: center;
        color: white;
        padding: 20px;
        border-radius: 10px;
        background: transparent;
        box-shadow: none;
    }

    .title {
        font-size: 48px;
        margin-bottom: 20px;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .instructions {
        font-size: 24px;
        margin-bottom: 30px;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        color: #ffffff;
    }

    .name-input {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-size: 18px;
        padding: 10px;
        width: 300px;
        margin: 10px 0;
        border-radius: 5px;
    }

    .color-picker {
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
    }

    .color-picker label {
        color: white;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    }

    .hue-slider {
        width: 200px;
        margin: 10px 0;
    }

    .color-update-btn {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        padding: 8px 15px;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .color-update-btn:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    #gameMenu {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3000;
        text-align: center;
        display: flex;
        gap: 10px;
        padding: 15px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.7);
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }

    #gameMenu button {
        background: rgba(255, 255, 255, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: #000;
        font-weight: bold;
        transition: all 0.3s ease;
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        border-radius: 5px;
        cursor: pointer;
    }

    #gameMenu button:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
    }

    button {
        margin: 0 10px;
        padding: 10px 20px;
        font-size: 16px;
        background-color: rgba(255, 255, 255, 0.9);
        border: 2px solid #333;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    button:hover {
        background-color: rgba(255, 255, 255, 1);
        transform: scale(1.05);
    }
`;

// Function to inject styles
export function injectTitleScreenStyles(): void {
    const styleElement = document.createElement('style');
    styleElement.textContent = titleScreenStyles;
    document.head.appendChild(styleElement);
}
