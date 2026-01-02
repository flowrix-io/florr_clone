interface StoredCredentials {
    username: string;
    password: string;
    isOffline?: boolean;  // Add flag to identify offline accounts
}

export class AuthUI {
    private authContainer: HTMLElement;
    private loginForm: HTMLElement;
    private registerForm: HTMLElement;
    private loginButton: HTMLElement;
    private registerButton: HTMLElement;
    private guestButton: HTMLElement;
    private showRegisterLink: HTMLElement;
    private showLoginLink: HTMLElement;
    private serverUrl: string;

    // Login form elements
    private loginUsername: HTMLInputElement;
    private loginPassword: HTMLInputElement;

    // Register form elements
    private registerUsername: HTMLInputElement;
    private registerPassword: HTMLInputElement;
    private registerConfirmPassword: HTMLInputElement;
    private serverIPInput: HTMLInputElement;
    private registerOfflineButton: HTMLElement;

    constructor() {
        // Get DOM elements - these should now exist from TitleScreen
        this.authContainer = document.getElementById('authContainer')!;
        this.loginForm = document.getElementById('loginForm')!;
        this.registerForm = document.getElementById('registerForm')!;
        
        // Login elements
        this.loginButton = document.getElementById('loginButton')!;
        this.guestButton = document.getElementById('guestButton')!;
        this.loginUsername = document.getElementById('loginUsername') as HTMLInputElement;
        this.loginPassword = document.getElementById('loginPassword') as HTMLInputElement;
        
        // Register elements
        this.registerButton = document.getElementById('registerButton')!;
        this.registerOfflineButton = document.getElementById('registerOfflineButton')!;
        this.registerUsername = document.getElementById('registerUsername') as HTMLInputElement;
        this.registerPassword = document.getElementById('registerPassword') as HTMLInputElement;
        this.registerConfirmPassword = document.getElementById('registerConfirmPassword') as HTMLInputElement;
        this.serverIPInput = document.getElementById('serverIP-connect') as HTMLInputElement;
        
        // Set default server URL to current origin
        const currentOrigin = window.location.origin;
        this.serverIPInput.value = currentOrigin;
        this.serverUrl = this.serverIPInput.value;
        
        // Form switch elements
        this.showRegisterLink = document.getElementById('showRegister')!;
        this.showLoginLink = document.getElementById('showLogin')!;

        // Bind event listeners
        this.loginButton.addEventListener('click', () => this.handleLogin());
        this.guestButton.addEventListener('click', () => this.handleGuestLogin());
        this.registerButton.addEventListener('click', () => this.handleRegister());
        this.registerOfflineButton.addEventListener('click', () => this.handleOfflineRegister());
        this.showRegisterLink.addEventListener('click', () => this.toggleForms());
        this.showLoginLink.addEventListener('click', () => this.toggleForms());

        // Add server IP change listener
        this.serverIPInput.addEventListener('change', () => {
            this.serverUrl = this.serverIPInput.value;
            // Store the server URL for future use
            localStorage.setItem('serverUrl', this.serverUrl);
        });

        // Load saved server URL if exists
        const savedServerUrl = localStorage.getItem('serverUrl');
        if (savedServerUrl) {
            this.serverUrl = savedServerUrl;
            this.serverIPInput.value = savedServerUrl;
        }

        // Check for stored credentials
        this.checkStoredCredentials();
    }

    private toggleForms() {
        this.loginForm.classList.toggle('hidden');
        this.registerForm.classList.toggle('hidden');
        
        // Update server URL when switching to login
        if (!this.loginForm.classList.contains('hidden')) {
            this.serverUrl = this.serverIPInput.value;
        }
    }

    private async handleLogin() {
        const username = this.loginUsername.value;
        const password = this.loginPassword.value;
        
        // Use the server URL from the input field even during login
        this.serverUrl = this.serverIPInput.value;
        const serverUrl = this.serverIPInput.value || this.serverUrl;

        try {
            // Try server authentication first
            const response = await fetch(`${serverUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            if (response.ok) {
                // Store credentials and server URL locally
                localStorage.setItem('username', username);
                localStorage.setItem('password', password);
                localStorage.setItem('currentUser', username);
                localStorage.setItem('serverUrl', serverUrl);
                sessionStorage.removeItem('isOffline'); // Clear any offline status
                this.hideAuthForm();
            } else {
                // Check offline credentials in sessionStorage
                const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
                if (offlineCredentials.username === username && 
                    offlineCredentials.password === password && 
                    offlineCredentials.isOffline) {
                    sessionStorage.setItem('currentUser', username);
                    sessionStorage.setItem('isOffline', 'true');
                    this.hideAuthForm();
                } else {
                    alert('Invalid username or password');
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            // Check offline credentials on server error
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            if (offlineCredentials.username === username && 
                offlineCredentials.password === password && 
                offlineCredentials.isOffline) {
                sessionStorage.setItem('currentUser', username);
                sessionStorage.setItem('isOffline', 'true');
                this.hideAuthForm();
            } else {
                alert('Invalid username or password');
            }
        }
    }

    private generateRandomDigits(length: number): string {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += Math.floor(Math.random() * 10);
        }
        return result;
    }

    private async handleGuestLogin() {
        // Generate random guest credentials
        const guestUsername = `User${this.generateRandomDigits(8)}`;
        const guestPassword = `password${this.generateRandomDigits(10)}`;
        
        const serverUrl = this.serverIPInput.value || this.serverUrl;

        try {
            // Try server registration first
            const response = await fetch(`${serverUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: guestUsername, password: guestPassword }),
                credentials: 'include'
            });

            if (response.ok) {
                // Store credentials locally
                localStorage.setItem('username', guestUsername);
                localStorage.setItem('password', guestPassword);
                localStorage.setItem('currentUser', guestUsername);
                localStorage.setItem('serverUrl', serverUrl);
                sessionStorage.removeItem('isOffline');
                this.hideAuthForm();
                alert(`Guest account created!\nUsername: ${guestUsername}\nPassword: ${guestPassword}\n\nSave these credentials if you want to log in again!`);
            } else {
                const errorData = await response.json();
                // If username collision, try again
                if (errorData.message && errorData.message.includes('already exists')) {
                    this.handleGuestLogin(); // Retry with new random credentials
                } else {
                    alert('Failed to create guest account: ' + (errorData.message || 'Unknown error'));
                }
            }
        } catch (error) {
            console.error('Guest registration error:', error);
            // Fallback to offline registration
            const offlineCredentials = {
                username: guestUsername,
                password: guestPassword,
                isOffline: true
            };
            
            sessionStorage.setItem('offlineCredentials', JSON.stringify(offlineCredentials));
            sessionStorage.setItem('currentUser', guestUsername);
            sessionStorage.setItem('isOffline', 'true');
            this.hideAuthForm();
            alert(`Guest account created (Offline Mode)!\nUsername: ${guestUsername}\nPassword: ${guestPassword}\n\nNote: This account is temporary and will be lost when you close the browser.`);
        }
    }

    private async handleRegister() {
        const username = this.registerUsername.value;
        const password = this.registerPassword.value;
        const confirmPassword = this.registerConfirmPassword.value;
        const serverIPSingle = document.getElementById('serverIP-single') as HTMLInputElement;
        const serverUrl = serverIPSingle.value;

        if (!serverUrl) {
            alert('Please enter a server IP address');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        try {
            // Try server registration first
            const response = await fetch(`${serverUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            if (response.ok) {
                // Store credentials locally as backup
                const storedCredentials = this.getStoredCredentials();
                storedCredentials.push({ username, password });
                localStorage.setItem('credentials', JSON.stringify(storedCredentials));
                localStorage.setItem('serverUrl', serverUrl);

                // Switch to login form
                this.toggleForms();
                alert('Registration successful! Please login.');
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Could not connect to server. Please check the server IP and try again.');
        }
    }

    private async handleOfflineRegister() {
        const username = this.registerUsername.value;
        const password = this.registerPassword.value;
        const confirmPassword = this.registerConfirmPassword.value;

        if (!username || !password) {
            alert('Username and password are required');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        // Check if username exists in temporary storage
        const storedCredentials = this.getStoredCredentials();
        if (storedCredentials.some(cred => cred.username === username)) {
            alert('Username already exists locally');
            return;
        }

        // Store credentials in sessionStorage (temporary)
        const offlineCredentials = {
            username,
            password,
            isOffline: true
        };
        
        // Store in sessionStorage (temporary) instead of localStorage
        sessionStorage.setItem('offlineCredentials', JSON.stringify(offlineCredentials));
        sessionStorage.setItem('currentUser', username);
        sessionStorage.setItem('isOffline', 'true');

        // Switch to login form
        this.toggleForms();
        alert('Offline registration successful! Note: This account is temporary and will be lost when you close the browser.');
    }

    private getStoredCredentials(): StoredCredentials[] {
        const stored = localStorage.getItem('credentials');
        return stored ? JSON.parse(stored) : [];
    }

    private checkStoredCredentials() {
        // Check if user is logged in offline
        const isOffline = sessionStorage.getItem('isOffline');
        if (isOffline) {
            const currentUser = sessionStorage.getItem('currentUser');
            const offlineCredentials = JSON.parse(sessionStorage.getItem('offlineCredentials') || '{}');
            
            if (currentUser && offlineCredentials.username === currentUser) {
                this.hideAuthForm();
                return;
            }
        }

        // Check online credentials
        const currentUser = localStorage.getItem('currentUser');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');

        if (currentUser && username && password) {
            this.verifyStoredCredentials(username, password).then(valid => {
                if (valid) {
                    this.hideAuthForm();
                } else {
                    this.logout();
                }
            });
        }
    }

    private async verifyStoredCredentials(username: string, password: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.serverUrl}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            return response.ok;
        } catch (error) {
            console.error('Verification error:', error);
            return false;
        }
    }

    private hideAuthForm() {
        // Keep DOM-based auth container hidden since we're using canvas-based form
        this.authContainer.classList.add('hidden');
        this.authContainer.style.display = 'none';
        // Also hide canvas-based auth form
        if ((window as any).titleScreen) {
            (window as any).titleScreen.hideAuthContainer();
        }
    }

    public showAuthForm() {
        // Keep DOM-based auth container hidden since we're using canvas-based form
        this.authContainer.classList.add('hidden');
        this.authContainer.style.display = 'none';
        // Also show canvas-based auth form
        if ((window as any).titleScreen) {
            (window as any).titleScreen.showAuthContainer();
        }
    }

    public logout() {
        // Clear both localStorage and sessionStorage
        localStorage.removeItem('currentUser');
        localStorage.removeItem('username');
        localStorage.removeItem('password');
        
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('offlineCredentials');
        sessionStorage.removeItem('isOffline');
        
        // Attempt server logout only if not offline
        if (!sessionStorage.getItem('isOffline')) {
            fetch(`${this.serverUrl}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            }).catch(error => {
                console.error('Logout error:', error);
            });
        }

        this.showAuthForm();
    }
} 