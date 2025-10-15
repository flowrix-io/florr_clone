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
    private settingsMenu!: HTMLElement;

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
        const displayHTTPWarning = location.protocol === 'http:';
        const httpWarning = displayHTTPWarning ? '<h3>WARNING: You are using HTTP. This is not secure. Do not use a shared password with other accounts.</h3>' : '';
        this.loginForm.innerHTML = `
            <h2>Login</h2>
            <div class="register-warning">
                ${httpWarning}
            </div>
            <input type="text" id="loginUsername" placeholder="Username">
            <input type="password" id="loginPassword" placeholder="Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggle" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettings" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-connect">Server IP:</label>
                        <input type="text" id="serverIP-connect" placeholder="Server IP">
                    </div>
                </div>
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
            <div class="register-warning">
                ${httpWarning}
                <h3>Do not use your real name or any personal information as your username.</h3>
            </div>
            <input type="text" id="registerUsername" placeholder="Username">
            <input type="password" id="registerPassword" placeholder="Password">
            <input type="password" id="registerConfirmPassword" placeholder="Confirm Password">
            <div class="advanced-settings">
                <button type="button" id="advancedSettingsToggleRegister" class="advanced-toggle">Advanced Settings ▼</button>
                <div id="advancedSettingsRegister" class="advanced-settings-content hidden">
                    <div class="server-input">
                        <label for="serverIP-single">Server IP:</label>
                        <input type="text" id="serverIP-single" placeholder="Server IP">
                    </div>
                </div>
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
            <button id="settingsButton" class="buttons">Settings</button>
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
            <p class="title">florr.io clone</p>
            <!-- <p class="instructions">Use arrow keys to move. Hold space to extend petals.</p> -->
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
                <p>Arrow keys to move</p>
                <br/>
                <p>Hold space to extend petals</p>
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

        this.settingsMenu = this.createElement('div', 'settings-menu hidden');
        this.settingsMenu.id = 'settingsMenu';
        this.settingsMenu.innerHTML = `
            <div class="settings-menu-content">
                <div class="settings-menu-header">
                    <h2>Settings</h2>
                    <button id="closeSettingsButton">&times;</button>
                </div>
                <div class="settings-menu-tabs">
                    <button class="tab-button active" data-tab="controls">Controls</button>
                    <button class="tab-button" data-tab="graphics">Graphics</button>
                    <button class="tab-button" data-tab="advanced">Advanced</button>
                </div>
                <div class="settings-menu-body">
                    <div id="controls-tab" class="tab-content active">
                        <h3>Controls</h3>
                        <div class="controls-grid">
                            <!-- Controls will be dynamically added here -->
                        </div>
                        <button id="saveControlsButton">Save Controls</button>
                        <button id="resetControlsButton">Reset to Default</button>
                    </div>
                    <div id="graphics-tab" class="tab-content">
                        <h3>Graphics</h3>
                        <label>
                            <input type="checkbox" id="showHitboxesCheckbox">
                            Show Hitboxes
                        </label>
                        <br/><br/>
                        <h3>Tutorial</h3>
                        <button id="resetTutorialButton">Reset Tutorial</button>
                    </div>
                    <div id="advanced-tab" class="tab-content">
                        <h3>Advanced Settings</h3>
                        <div class="server-input">
                            <label for="serverIP-settings">Server IP:</label>
                            <input type="text" id="serverIP-settings" placeholder="Server IP">
                        </div>
                    </div>
                </div>
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

        // Name input persistence will be handled in setupEventListeners
        
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

        // Settings menu event listeners
        const settingsButton = this.gameMenu.querySelector('#settingsButton');
        const closeSettingsButton = this.settingsMenu.querySelector('#closeSettingsButton');

        if (settingsButton) {
            settingsButton.addEventListener('click', () => {
                this.settingsMenu.classList.remove('hidden');
            });
        }

        if (closeSettingsButton) {
            closeSettingsButton.addEventListener('click', () => {
                this.settingsMenu.classList.add('hidden');
            });
        }

        this.settingsMenu.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.getAttribute('data-tab');
                this.settingsMenu.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.settingsMenu.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === `${tab}-tab`) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
            });
        });

        // Controls settings
        this.populateControlsTab();
        const saveControlsButton = this.settingsMenu.querySelector('#saveControlsButton');
        if (saveControlsButton) {
            saveControlsButton.addEventListener('click', () => this.saveControls());
        }
        const resetControlsButton = this.settingsMenu.querySelector('#resetControlsButton');
        if (resetControlsButton) {
            resetControlsButton.addEventListener('click', () => this.resetControls());
        }


        // Settings change listeners
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.addEventListener('change', () => {
                localStorage.setItem('showHitboxes', showHitboxesCheckbox.checked.toString());
            });
        }

        // Reset tutorial button
        const resetTutorialButton = this.settingsMenu.querySelector('#resetTutorialButton');
        if (resetTutorialButton) {
            resetTutorialButton.addEventListener('click', () => {
                if (confirm('This will restart the tutorial on your next game. Continue?')) {
                    localStorage.removeItem('tutorial_completed');
                    localStorage.removeItem('tutorial_step');
                    alert('Tutorial will restart on your next game!');
                }
            });
        }

        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        if (serverIPInput) {
            serverIPInput.addEventListener('input', () => {
                localStorage.setItem('serverIP', serverIPInput.value);
            });
            serverIPInput.value = localStorage.getItem('serverIP') || window.location.origin;
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

        // Setup name input persistence
        this.setupNameInputPersistence();
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
        document.body.appendChild(this.settingsMenu);

        // Add CSS for advanced settings
        this.addAdvancedSettingsStyles();
        
        // Debug: Check if forms are in DOM
        console.log('Login form in DOM:', document.getElementById('loginForm'));
        console.log('Register form in DOM:', document.getElementById('registerForm'));
        console.log('Advanced settings toggle in DOM:', document.getElementById('advancedSettingsToggle'));
        console.log('Advanced settings toggle register in DOM:', document.getElementById('advancedSettingsToggleRegister'));
        console.log('Login form innerHTML:', this.loginForm.innerHTML);
        
        // Setup advanced settings toggle functionality
        this.setupAdvancedSettingsToggle();
        this.loadSettings();
    }

    private populateControlsTab(): void {
        const controlsGrid = this.settingsMenu.querySelector('.controls-grid');
        if (!controlsGrid) return;

        const controls = this.getControls();

        controlsGrid.innerHTML = '';
        for (const action in controls) {
            const controlRow = document.createElement('div');
            controlRow.className = 'control-row';
            controlRow.innerHTML = `
                <label>${action.replace(/_/g, ' ')}</label>
                <input type="text" class="control-input" data-action="${action}" value="${controls[action]}">
            `;
            controlsGrid.appendChild(controlRow);
        }

        controlsGrid.querySelectorAll('.control-input').forEach(input => {
            input.addEventListener('keydown', (e: any) => {
                e.preventDefault();
                (input as HTMLInputElement).value = e.key;
            });
        });
    }

    private getControls(): { [key: string]: string } {
        const savedControls = localStorage.getItem('controls');
        if (savedControls) {
            return { ...this.getDefaultControls(), ...JSON.parse(savedControls) };
        }
        return this.getDefaultControls();
    }

    private getDefaultControls(): { [key: string]: string } {
        return {
            move_up: 'w',
            move_down: 's',
            move_left: 'a',
            move_right: 'd',
            inventory: 'i',
            crafting: 'r',
            toggle_mouse_controls: 'c',
            toggle_hitboxes: 'h',
            zoom_in: '=',
            zoom_out: '-',
            chat: 'Enter',
            extend_petals: ' ',
            retract_petals: 'Shift',
        };
    }

    private saveControls(): void {
        const controls: { [key: string]: string } = {};
        this.settingsMenu.querySelectorAll('.control-input').forEach(input => {
            const action = input.getAttribute('data-action');
            if (action) {
                controls[action] = (input as HTMLInputElement).value;
            }
        });
        localStorage.setItem('controls', JSON.stringify(controls));
        alert('Controls saved!');
    }

    private resetControls(): void {
        localStorage.removeItem('controls');
        this.populateControlsTab();
        alert('Controls have been reset to default.');
    }

    private loadSettings(): void {
        const showHitboxes = localStorage.getItem('showHitboxes') === 'true';
        const showHitboxesCheckbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        if (showHitboxesCheckbox) {
            showHitboxesCheckbox.checked = showHitboxes;
        }

        const serverIP = localStorage.getItem('serverIP') || window.location.origin;
        const serverIPInput = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        if (serverIPInput) {
            serverIPInput.value = serverIP;
        }
    }

    private addAdvancedSettingsStyles(): void {
        const style = document.createElement('style');
        style.textContent = `
            .auth-form .advanced-settings {
                margin: 10px 0 !important;
            }
            
            .auth-form .advanced-toggle {
                background: rgba(255, 0, 0, 0.8) !important;
                border: 2px solid yellow !important;
                color: white !important;
                padding: 8px 12px !important;
                border-radius: 5px !important;
                cursor: pointer !important;
                font-size: 14px !important;
                transition: all 0.3s ease !important;
                width: 100% !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            
            .auth-form .advanced-toggle:hover {
                background: rgba(255, 255, 255, 0.2) !important;
                border-color: rgba(255, 255, 255, 0.5) !important;
            }
            
            .auth-form .advanced-settings-content {
                margin-top: 10px !important;
                padding: 10px !important;
                background: rgba(0, 0, 0, 0.3) !important;
                border-radius: 5px !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
            }
            
            .auth-form .advanced-settings-content.hidden {
                display: none !important;
            }
            
            .auth-form .server-input {
                display: flex !important;
                flex-direction: column !important;
                gap: 5px !important;
            }
            
            .auth-form .server-input label {
                color: white !important;
                font-size: 14px !important;
                font-weight: bold !important;
            }
            
            .auth-form .server-input input {
                padding: 8px !important;
                border: 1px solid rgba(255, 255, 255, 0.3) !important;
                border-radius: 4px !important;
                background: rgba(255, 255, 255, 0.1) !important;
                color: white !important;
                font-size: 14px !important;
            }
            
            .auth-form .server-input input::placeholder {
                color: rgba(255, 255, 255, 0.6) !important;
            }
            
            .auth-form .server-input input:focus {
                outline: none !important;
                border-color: rgba(255, 255, 255, 0.6) !important;
                background: rgba(255, 255, 255, 0.15) !important;
            }
        `;
        document.head.appendChild(style);
    }

    private setupAdvancedSettingsToggle(): void {
        // Get current origin for default values
        const currentOrigin = window.location.origin;
        
        console.log('Setting up advanced settings toggle...');
        console.log('Current origin:', currentOrigin);
        
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            console.log('Inside setTimeout - checking for elements...');
            
            // Setup login form advanced settings
            const loginToggle = document.getElementById('advancedSettingsToggle');
            const loginAdvancedSettings = document.getElementById('advancedSettings');
            const loginServerInput = document.getElementById('serverIP-connect') as HTMLInputElement;
            
            console.log('Login elements found:', { loginToggle, loginAdvancedSettings, loginServerInput });
            console.log('Login toggle element:', loginToggle);
            console.log('Login toggle innerHTML:', loginToggle?.innerHTML);
            console.log('Login toggle style:', loginToggle?.style.cssText);
            console.log('Login toggle computed style:', loginToggle ? window.getComputedStyle(loginToggle) : 'Element not found');
            
            if (loginToggle && loginAdvancedSettings && loginServerInput) {
                // Set default value to current origin
                loginServerInput.value = currentOrigin;
                
                loginToggle.addEventListener('click', () => {
                    const isHidden = loginAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        loginAdvancedSettings.classList.remove('hidden');
                        loginToggle.textContent = 'Advanced Settings ▲';
                    } else {
                        loginAdvancedSettings.classList.add('hidden');
                        loginToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        loginServerInput.value = currentOrigin;
                    }
                });
                }
            
            // Setup register form advanced settings
            const registerToggle = document.getElementById('advancedSettingsToggleRegister');
            const registerAdvancedSettings = document.getElementById('advancedSettingsRegister');
            const registerServerInput = document.getElementById('serverIP-single') as HTMLInputElement;
            
            console.log('Register elements found:', { registerToggle, registerAdvancedSettings, registerServerInput });
            console.log('Current origin for register:', currentOrigin);
            
            if (registerToggle && registerAdvancedSettings && registerServerInput) {
                // Set default value to current origin
                registerServerInput.value = currentOrigin;
                
                registerToggle.addEventListener('click', () => {
                    const isHidden = registerAdvancedSettings.classList.contains('hidden');
                    if (isHidden) {
                        registerAdvancedSettings.classList.remove('hidden');
                        registerToggle.textContent = 'Advanced Settings ▲';
                    } else {
                        registerAdvancedSettings.classList.add('hidden');
                        registerToggle.textContent = 'Advanced Settings ▼';
                        // Reset to default when collapsed
                        registerServerInput.value = currentOrigin;
                    }
                });
            }
        }, 100); // 100ms delay to ensure DOM is ready
    }

    private setupNameInputPersistence(): void {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            const nameInput = document.getElementById('nameInput') as HTMLInputElement;
            if (nameInput) {
                // Load saved name from localStorage
                const savedName = localStorage.getItem('playerName') || '';
                nameInput.value = savedName;
                
                // Save name to localStorage when it changes
                nameInput.addEventListener('input', () => {
                    localStorage.setItem('playerName', nameInput.value);
                });
                
                // Also save on blur (when user clicks away)
                nameInput.addEventListener('blur', () => {
                    localStorage.setItem('playerName', nameInput.value);
                });
            }
        }, 100); // 100ms delay to ensure DOM is ready
    }

    public showLoginForm(): void {
        // console.log('Showing login form');
        // this.loginForm.classList.remove('hidden');
        // this.registerForm.classList.add('hidden');
        // handled in auth_ui.ts
    }

    public showRegisterForm(): void {
        // console.log('Showing register form');
        // this.loginForm.classList.add('hidden');
        // this.registerForm.classList.remove('hidden');
        // handled in auth_ui.ts
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

    public getSettingsButton(): HTMLButtonElement | null {
        return this.gameMenu.querySelector('#settingsButton') as HTMLButtonElement;
    }

    public getShowHitboxes(): boolean {
        const checkbox = this.settingsMenu.querySelector('#showHitboxesCheckbox') as HTMLInputElement;
        return checkbox ? checkbox.checked : false;
    }

    public getServerIP(): string {
        const input = this.settingsMenu.querySelector('#serverIP-settings') as HTMLInputElement;
        return input ? input.value : window.location.origin;
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
        display: none !important;
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

    .settings-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 4000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .settings-menu-content {
        background: rgba(0, 0, 0, 0.8);
        padding: 20px;
        border-radius: 10px;
        color: white;
        width: 500px;
        max-width: 90%;
    }

    .settings-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #444;
        padding-bottom: 10px;
        margin-bottom: 10px;
    }

    #closeSettingsButton {
        background: transparent;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
    }

    .settings-menu-tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
    }

    .tab-button {
        padding: 10px;
        background: #333;
        border: 1px solid #555;
        color: white;
        cursor: pointer;
        border-radius: 5px;
    }

    .tab-button.active {
        background: #555;
        border-bottom: 1px solid #555;
    }

    .tab-content {
        display: none;
    }

    .tab-content.active {
        display: block;
    }

    .controls-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 10px;
    }

    .control-row {
        display: contents;
    }

    .control-row label {
        text-transform: capitalize;
    }

    .control-input {
        background: #555;
        border: 1px solid #777;
        color: white;
        padding: 5px;
        border-radius: 3px;
        text-align: center;
    }

    .register-warning {
        color: red;
    }
`;

// Function to inject styles
export function injectTitleScreenStyles(): void {
    const styleElement = document.createElement('style');
    styleElement.textContent = titleScreenStyles;
    document.head.appendChild(styleElement);
}
