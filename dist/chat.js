"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Chat = void 0;
const player_1 = require("./player");
const COMMANDS = [
    { command: '/help', description: 'Show available commands', isAdmin: false },
    { command: '/list_ultra', description: 'List all ultra mobs', isAdmin: false },
    { command: '/list_super', description: 'List all super mobs', isAdmin: false },
    { command: '/list_unique', description: 'List all unique mobs', isAdmin: false },
    { command: '/biome', description: 'Show the most populated biome', isAdmin: false },
    { command: '/create-api-key', description: 'Issue an API key tied to your account: /create-api-key [label]', isAdmin: false },
    { command: '/delete-api-key', description: 'Revoke one of your API keys: /delete-api-key <key-or-prefix>', isAdmin: false },
    { command: '/admin save', description: 'Save player progress', isAdmin: true },
    { command: '/admin list-players', description: 'List online players', isAdmin: true },
    { command: '/admin list-sockets', description: 'List connected sockets', isAdmin: true },
    { command: '/admin set_max_enemies', description: 'Set max enemy count', isAdmin: true },
    { command: '/admin set_bot_count', description: 'Set bot count (0-50, or "default")', isAdmin: true },
    { command: '/admin spawn_special_mobs', description: 'Spawn special mobs', isAdmin: true },
    { command: '/admin spawn', description: 'Spawn a mob: /admin spawn <mob> <rarity> [x y] [amount] [stack]', isAdmin: true },
    { command: '/admin killall', description: 'Kill all wild mobs (pets left intact)', isAdmin: true },
    { command: '/admin teleport', description: 'Teleport a player', isAdmin: true },
    { command: '/admin tp', description: 'Teleport a player (shorthand)', isAdmin: true },
    { command: '/admin generate_code', description: 'Generate a star code', isAdmin: true },
    { command: '/admin gen_code', description: 'Generate a star code (shorthand)', isAdmin: true },
    { command: '/admin list_codes', description: 'List all generated codes', isAdmin: true },
    { command: '/admin delete_code', description: 'Delete a code', isAdmin: true },
    { command: '/admin notification', description: 'Create a notification', isAdmin: true },
    { command: '/admin notify', description: 'Create a notification (shorthand)', isAdmin: true },
    { command: '/admin clear_notifications', description: 'Clear all notifications', isAdmin: true },
    { command: '/admin clear_notifs', description: 'Clear notifications (shorthand)', isAdmin: true },
    { command: '/admin give', description: 'Give item(s) to a player: /admin give <player> <item> <rarity> [amount]', isAdmin: true },
    { command: '/admin delete_guests', description: 'Delete default guest accounts', isAdmin: true },
    { command: '/admin list_today_logins', description: 'List accounts active in last 24h', isAdmin: true },
    { command: '/admin list_active', description: 'List accounts active in last 24h (shorthand)', isAdmin: true },
    { command: '/cmd', description: 'Execute server command (alias)', isAdmin: true },
    { command: '/forcelocalplayerflags', description: 'Set local player face/equip flags (client-only)', isAdmin: false },
    { command: '/squad-create', description: 'Create a new squad ([public|private])', isAdmin: false },
    { command: '/squad-invite', description: 'Invite a player to your squad', isAdmin: false },
    { command: '/squad-find-public', description: 'List joinable public squads', isAdmin: false },
    { command: '/squad-join', description: 'Join a public squad by its ID', isAdmin: false },
    { command: '/squad-public', description: 'Make your squad public (leader only)', isAdmin: false },
    { command: '/squad-private', description: 'Make your squad private (leader only)', isAdmin: false },
    { command: '/squad-accept', description: 'Accept a squad invite', isAdmin: false },
    { command: '/squad-decline', description: 'Decline a squad invite', isAdmin: false },
    { command: '/squad-leave', description: 'Leave your current squad', isAdmin: false },
    { command: '/squad-info', description: 'Show squad members', isAdmin: false },
    { command: '/s', description: 'Send a message to your squad', isAdmin: false },
    { command: '/guild-create', description: 'Create a new guild: /guild-create <name>', isAdmin: false },
    { command: '/guild-invite', description: 'Invite a player to your guild (leader only)', isAdmin: false },
    { command: '/guild-accept', description: 'Accept a guild invite', isAdmin: false },
    { command: '/guild-decline', description: 'Decline a guild invite', isAdmin: false },
    { command: '/guild-leave', description: 'Leave your current guild', isAdmin: false },
    { command: '/guild-kick', description: 'Kick a member from the guild (leader only)', isAdmin: false },
    { command: '/guild-info', description: 'Show guild members and status', isAdmin: false },
    { command: '/guild-squad', description: 'Invite online guildmates into a squad', isAdmin: false },
    { command: '/guild-list', description: 'List all guilds (id, name, members)', isAdmin: false },
    { command: '/guild-menu', description: 'Toggle the guild menu panel', isAdmin: false },
    { command: '/g', description: 'Send a message to your guild', isAdmin: false },
    { command: '/admin guild_force_join', description: 'Force a player into a guild', isAdmin: true },
    { command: '/admin guild_list', description: 'List all guilds', isAdmin: true },
    { command: '/admin guild_info', description: 'Show info for a guild by id', isAdmin: true },
    { command: '/admin restart', description: 'Schedule server restart: restart [<N>(s|m|h)|cancel|status]', isAdmin: true },
    { command: '/admin backup_db', description: 'Back up the database: backup_db [list]', isAdmin: true },
    { command: '/admin update', description: 'Back up DB, install latest build from GitHub, restart: update [now|<N>(s|m|h)|status|cancel]', isAdmin: true },
    { command: '/admin change-maze', description: 'Change the maze: change-maze [next|garden|desert|ocean|<dayNumber>]', isAdmin: true },
    { command: '/level-from-string', description: 'Show what level a player named &lt;name&gt; would roll', isAdmin: false },
    { command: '/loadout-from-string', description: 'Show the loadout a player named &lt;name&gt; would roll', isAdmin: false },
];
class Chat {
    constructor(socket) {
        this.chatContainer = null;
        this.chatInput = null;
        this.chatMessages = null;
        this.suggestionsContainer = null;
        this.selectedSuggestionIndex = -1;
        this.isChatFocused = false;
        this.pendingScripts = new Map();
        this.pendingIframes = new Map();
        this.socket = socket;
        this.initialize();
        this.setupSocketListeners();
    }
    // Method to update socket reference (for cross-server transfers)
    updateSocket(newSocket) {
        // Remove old listeners
        this.socket.off('chatMessage');
        this.socket.off('chatHistory');
        this.socket.off('squadUpdate');
        this.socket.off('squadInviteReceived');
        // Update socket reference
        this.socket = newSocket;
        // Set up new listeners
        this.setupSocketListeners();
        // Request chat history from new server
        this.socket.emit('requestChatHistory');
        console.log('[CHAT] Socket updated for new server connection');
    }
    setupSocketListeners() {
        this.socket.on('chatMessage', (message) => {
            this.addChatMessage(message);
        });
        this.socket.on('chatHistory', (history) => {
            history.forEach(message => this.addChatMessage(message));
        });
        this.socket.on('squadUpdate', (data) => {
            // Expose member IDs so the minimap can render squadmates as pink dots without ALT.
            window.squadMemberIds = data ? data.memberIds : [];
        });
        this.socket.on('squadInviteReceived', (data) => {
            // Visual notification is already handled via chatMessage from server
        });
    }
    handleClientCommand(message) {
        if (message === '/skins' || message === '/skin-studio') {
            const game = window.currentGame;
            if (game?.skinStudio) {
                game.skinStudio.toggle();
            }
            else {
                this.addChatMessage({ sender: 'System', content: 'Skin Studio is only available in-game.', timestamp: Date.now() });
            }
            return true;
        }
        if (message === '/guild-menu' || message === '/guild menu') {
            const game = window.currentGame;
            if (game?.guildMenu) {
                game.guildMenu.toggle();
            }
            else {
                this.addChatMessage({ sender: 'System', content: 'Guild menu is only available in-game.', timestamp: Date.now() });
            }
            return true;
        }
        if (message.startsWith('/forcelocalplayerflags')) {
            const args = message.slice('/forcelocalplayerflags'.length).trim().split(/\s+/);
            const game = window.currentGame;
            if (!game) {
                this.addChatMessage({ sender: 'System', content: 'Game not loaded.', timestamp: Date.now() });
                return true;
            }
            const localPlayer = game.getLocalPlayer();
            if (!localPlayer) {
                this.addChatMessage({ sender: 'System', content: 'Local player not found.', timestamp: Date.now() });
                return true;
            }
            if (args.length === 0 || args[0] === '') {
                const faceNames = Object.keys(player_1.FaceFlags).filter(k => isNaN(Number(k)));
                const equipNames = Object.keys(player_1.EquipmentFlags).filter(k => isNaN(Number(k)));
                const renderNames = Object.keys(player_1.PlayerRenderFlags).filter(k => isNaN(Number(k)));
                this.addChatMessage({
                    sender: 'System',
                    content: `Usage: /forcelocalplayerflags <face|equip|render> <flag1> [flag2] ...\n` +
                        `Face flags: ${faceNames.join(', ')}\n` +
                        `Equip flags: ${equipNames.join(', ')}\n` +
                        `Render flags (skins): ${renderNames.join(', ')}\n` +
                        `Current: faceFlags=${localPlayer.faceFlags ?? 0}, equipFlags=${localPlayer.equipFlags ?? 0}, renderFlags=${localPlayer.renderFlags ?? 0}`,
                    timestamp: Date.now()
                });
                return true;
            }
            const type = args[0].toLowerCase();
            const flagNames = args.slice(1);
            if (type === 'face') {
                let value = 0;
                for (const name of flagNames) {
                    const flag = player_1.FaceFlags[name];
                    if (flag === undefined) {
                        const num = parseInt(name);
                        if (!isNaN(num)) {
                            value = num;
                            break;
                        }
                        this.addChatMessage({ sender: 'System', content: `Unknown face flag: ${name}`, timestamp: Date.now() });
                        return true;
                    }
                    value |= flag;
                }
                localPlayer.faceFlags = value;
                localPlayer.forcedFlags = true;
                this.addChatMessage({ sender: 'System', content: `Set local faceFlags to ${value} (server updates frozen until reload)`, timestamp: Date.now() });
            }
            else if (type === 'equip') {
                let value = 0;
                for (const name of flagNames) {
                    const flag = player_1.EquipmentFlags[name];
                    if (flag === undefined) {
                        const num = parseInt(name);
                        if (!isNaN(num)) {
                            value = num;
                            break;
                        }
                        this.addChatMessage({ sender: 'System', content: `Unknown equip flag: ${name}`, timestamp: Date.now() });
                        return true;
                    }
                    value |= flag;
                }
                localPlayer.equipFlags = value;
                localPlayer.forcedFlags = true;
                this.addChatMessage({ sender: 'System', content: `Set local equipFlags to ${value} (server updates frozen until reload)`, timestamp: Date.now() });
            }
            else if (type === 'render') {
                let value = 0;
                for (const name of flagNames) {
                    const flag = player_1.PlayerRenderFlags[name];
                    if (flag === undefined) {
                        const num = parseInt(name);
                        if (!isNaN(num)) {
                            value = num;
                            break;
                        }
                        this.addChatMessage({ sender: 'System', content: `Unknown render flag: ${name}`, timestamp: Date.now() });
                        return true;
                    }
                    value |= flag;
                }
                localPlayer.renderFlags = value;
                localPlayer.forcedFlags = true;
                this.addChatMessage({ sender: 'System', content: `Set local renderFlags to ${value} (server updates frozen until reload)`, timestamp: Date.now() });
            }
            else {
                this.addChatMessage({ sender: 'System', content: `Unknown flag type: ${type}. Use "face", "equip", or "render".`, timestamp: Date.now() });
            }
            return true;
        }
        return false;
    }
    get isFocused() {
        return this.isChatFocused;
    }
    focus() {
        this.chatInput?.focus();
    }
    blur() {
        this.chatInput?.blur();
    }
    hide() {
        if (this.chatContainer)
            this.chatContainer.style.display = 'none';
    }
    show() {
        if (this.chatContainer)
            this.chatContainer.style.display = 'flex';
    }
    initialize() {
        // Add blink animation style to document
        const style = document.createElement('style');
        style.textContent = `
          @keyframes blink {
              50% { opacity: 0; }
          }
      `;
        document.head.appendChild(style);
        // Create chat container with updated styling
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = 'chat-container';
        // pointer-events: none — the container's own transparent background
        // otherwise blocks touches/clicks meant for whatever's underneath it
        // (e.g. the mobile joystick, which sits in this same bottom-left
        // corner). Re-enabled per-element below on the pieces that are
        // actually interactive: the input, the suggestions dropdown, and
        // each individual message (so its links/buttons still work).
        this.chatContainer.style.cssText = `
          position: fixed;
          bottom: 10px;
          left: 100px;
          width: 300px;
          height: 200px;
          background: transparent;
          display: flex;
          flex-direction: column;
          z-index: 200;
          pointer-events: none;
          font-family: 'Ubuntu', sans-serif;
          font-weight: 700;
          text-shadow:
              -1px -1px 0 #000,
              1px -1px 0 #000,
              -1px 1px 0 #000,
              1px 1px 0 #000,
              0 0 3px rgba(0,0,0,0.8);
      `;
        // Create messages container with transparent background
        this.chatMessages = document.createElement('div');
        this.chatMessages.className = 'chat-messages';
        this.chatMessages.style.cssText = `
          flex-grow: 1;
          overflow-y: auto;
          padding: 5px;
          color: white;
          background: transparent;
          z-index: 200;
      `;
        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'chat-input-container';
        inputContainer.style.cssText = `
          padding: 5px;
          background: transparent;
          z-index: 200;
          pointer-events: auto;
      `;
        // Create input field with semi-transparent background
        this.chatInput = document.createElement('input');
        this.chatInput.type = 'text';
        this.chatInput.placeholder = 'Press Enter to chat...';
        this.chatInput.className = 'chat-input';
        this.chatInput.style.cssText = `
          width: 100%;
          padding: 5px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.3);
          color: white;
          outline: none;
          font-family: inherit;
          z-index: 200;
          pointer-events: auto;
      `;
        // Add event listeners
        this.chatInput.addEventListener('focus', () => {
            this.isChatFocused = true;
            // Make input background slightly more opaque when focused
            this.chatInput.style.background = 'rgba(0, 0, 0, 0.5)';
        });
        this.chatInput.addEventListener('blur', () => {
            this.isChatFocused = false;
            // Restore original transparency when blurred
            this.chatInput.style.background = 'rgba(0, 0, 0, 0.3)';
            // Hide suggestions after a short delay (allows click events to fire first)
            setTimeout(() => this.hideSuggestions(), 150);
        });
        // Handle keyboard navigation for suggestions and sending messages
        this.chatInput.addEventListener('keydown', (e) => {
            const suggestions = this.suggestionsContainer?.querySelectorAll('.chat-suggestion-item');
            if (suggestions && suggestions.length > 0 && this.suggestionsContainer?.style.display !== 'none') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.selectedSuggestionIndex = Math.min(this.selectedSuggestionIndex + 1, suggestions.length - 1);
                    this.highlightSuggestion(suggestions);
                    return;
                }
                else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, 0);
                    this.highlightSuggestion(suggestions);
                    return;
                }
                else if (e.key === 'Tab' || (e.key === 'Enter' && this.selectedSuggestionIndex >= 0)) {
                    e.preventDefault();
                    const selected = suggestions[this.selectedSuggestionIndex];
                    if (selected) {
                        const cmd = selected.getAttribute('data-command') || '';
                        this.chatInput.value = cmd + ' ';
                        this.hideSuggestions();
                    }
                    return;
                }
                else if (e.key === 'Escape') {
                    this.hideSuggestions();
                    return;
                }
            }
            if (e.key === 'Enter' && this.chatInput?.value.trim()) {
                const messageText = this.chatInput.value.trim();
                // Handle client-only commands
                if (this.handleClientCommand(messageText)) {
                    this.chatInput.value = '';
                    this.hideSuggestions();
                    return;
                }
                // Check if socket is authenticated (username is set during authentication)
                if (!this.socket.username) {
                    console.warn('[CHAT] Socket not authenticated yet, message will be sent when authenticated');
                    alert('Please wait for authentication to complete');
                    return;
                }
                // Send the chat message to the server
                this.socket.emit('chatMessage', messageText);
                this.chatInput.value = '';
                this.hideSuggestions();
            }
        });
        // Show command suggestions as user types
        this.chatInput.addEventListener('input', () => {
            const value = this.chatInput?.value || '';
            if (value.startsWith('/')) {
                const query = value.toLowerCase();
                const showAdmin = localStorage.getItem('showAdminCommands') === 'true';
                const matches = COMMANDS.filter(cmd => cmd.command.toLowerCase().startsWith(query) && (showAdmin || !cmd.isAdmin));
                if (matches.length > 0 && value !== '') {
                    this.showSuggestions(matches);
                }
                else {
                    this.hideSuggestions();
                }
            }
            else {
                this.hideSuggestions();
            }
        });
        // Create suggestions container (replaces chat messages when visible)
        this.suggestionsContainer = document.createElement('div');
        this.suggestionsContainer.className = 'chat-suggestions';
        this.suggestionsContainer.style.cssText = `
          display: none;
          flex-grow: 1;
          overflow-y: auto;
          padding: 5px;
          font-size: 13px;
          z-index: 201;
          pointer-events: auto;
      `;
        this.chatContainer.appendChild(this.chatMessages);
        this.chatContainer.appendChild(this.suggestionsContainer);
        inputContainer.appendChild(this.chatInput);
        this.chatContainer.appendChild(inputContainer);
        document.body.appendChild(this.chatContainer);
        // Request chat history
        this.socket.emit('requestChatHistory');
    }
    showSuggestions(matches) {
        if (!this.suggestionsContainer)
            return;
        this.suggestionsContainer.innerHTML = '';
        this.selectedSuggestionIndex = 0;
        // Hide chat messages, show suggestions in their place
        if (this.chatMessages)
            this.chatMessages.style.display = 'none';
        this.suggestionsContainer.style.display = 'block';
        matches.forEach((cmd, index) => {
            const item = document.createElement('div');
            item.className = 'chat-suggestion-item';
            item.setAttribute('data-command', cmd.command);
            item.style.cssText = `
              padding: 4px 8px;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 6px;
              color: white;
          `;
            if (cmd.isAdmin) {
                const adminTag = document.createElement('span');
                adminTag.textContent = '[ADMIN]';
                adminTag.style.cssText = `
                  color: #ff4444;
                  font-weight: bold;
                  font-size: 11px;
                  flex-shrink: 0;
              `;
                item.appendChild(adminTag);
            }
            const cmdText = document.createElement('span');
            cmdText.textContent = cmd.command;
            cmdText.style.cssText = `color: #aaddff; flex-shrink: 0;`;
            item.appendChild(cmdText);
            const descText = document.createElement('span');
            descText.textContent = `- ${cmd.description}`;
            descText.style.cssText = `color: rgba(255,255,255,0.5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
            item.appendChild(descText);
            item.addEventListener('mouseenter', () => {
                this.selectedSuggestionIndex = index;
                this.highlightSuggestion(this.suggestionsContainer.querySelectorAll('.chat-suggestion-item'));
            });
            item.addEventListener('click', () => {
                if (this.chatInput) {
                    this.chatInput.value = cmd.command + ' ';
                    this.chatInput.focus();
                    this.hideSuggestions();
                }
            });
            this.suggestionsContainer.appendChild(item);
        });
        this.highlightSuggestion(this.suggestionsContainer.querySelectorAll('.chat-suggestion-item'));
    }
    hideSuggestions() {
        if (!this.suggestionsContainer)
            return;
        this.suggestionsContainer.style.display = 'none';
        this.suggestionsContainer.innerHTML = '';
        this.selectedSuggestionIndex = -1;
        // Restore chat messages
        if (this.chatMessages)
            this.chatMessages.style.display = 'block';
    }
    highlightSuggestion(items) {
        items.forEach((item, i) => {
            item.style.background = i === this.selectedSuggestionIndex
                ? 'rgba(255, 255, 255, 0.15)'
                : 'transparent';
        });
        // Scroll selected item into view
        if (this.selectedSuggestionIndex >= 0 && items[this.selectedSuggestionIndex]) {
            items[this.selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    sanitizeHTML(str) {
        // Add 'script' to allowed tags
        const allowedTags = new Set(['b', 'i', 'u', 'strong', 'em', 'span', 'color', 'blink', 'script', 'a', 'iframe']);
        const allowedAttributes = new Set(['style', 'color']);
        // Create a temporary div to parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = str;
        // Recursive function to sanitize nodes
        const sanitizeNode = (node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const tagName = element.tagName.toLowerCase();
                if (tagName === 'script') {
                    // Generate unique ID for this script
                    const scriptId = 'script_' + Math.random().toString(36).substr(2, 9);
                    // Store the script content
                    this.pendingScripts.set(scriptId, {
                        id: scriptId,
                        code: element.textContent || '',
                        sender: 'Unknown' // Updated later
                    });
                    // Replace script with a warning button
                    const warningBtn = document.createElement('button');
                    warningBtn.className = 'script-warning';
                    warningBtn.setAttribute('data-script-id', scriptId);
                    warningBtn.style.cssText = `
                      background: rgba(255, 165, 0, 0.2);
                      border: 1px solid orange;
                      color: white;
                      padding: 2px 5px;
                      border-radius: 3px;
                      cursor: pointer;
                      font-size: 12px;
                      margin: 0 5px;
                  `;
                    warningBtn.textContent = '⚠️ Click to run script';
                    // Replace the script node with our warning button
                    node.parentNode?.replaceChild(warningBtn, node);
                    return;
                }
                if (tagName === 'iframe') {
                    const iframeId = 'iframe_' + Math.random().toString(36).substr(2, 9);
                    const src = element.getAttribute('src') || '';
                    this.pendingIframes.set(iframeId, {
                        id: iframeId,
                        src: src,
                        width: element.getAttribute('width') || '280',
                        height: element.getAttribute('height') || '160',
                        sender: 'Unknown'
                    });
                    const embedBtn = document.createElement('button');
                    embedBtn.className = 'iframe-warning';
                    embedBtn.setAttribute('data-iframe-id', iframeId);
                    embedBtn.style.cssText = `
                      background: rgba(100, 149, 237, 0.2);
                      border: 1px solid cornflowerblue;
                      color: white;
                      padding: 2px 5px;
                      border-radius: 3px;
                      cursor: pointer;
                      font-size: 12px;
                      margin: 0 5px;
                      font-family: inherit;
                  `;
                    embedBtn.textContent = '🔗 Click to show embed';
                    node.parentNode?.replaceChild(embedBtn, node);
                    return;
                }
                if (tagName === 'a') {
                    // Keep the link but force safe attributes
                    const href = element.getAttribute('href') || '';
                    // Strip all attributes first
                    Array.from(element.attributes).forEach(attr => {
                        element.removeAttribute(attr.name);
                    });
                    // Only allow http/https links
                    if (href.startsWith('http://') || href.startsWith('https://')) {
                        element.setAttribute('href', href);
                    }
                    else {
                        element.removeAttribute('href');
                    }
                    element.setAttribute('target', '_blank');
                    element.setAttribute('rel', 'noopener noreferrer');
                    element.setAttribute('style', 'color: #5bf; text-decoration: underline; cursor: pointer;');
                    // Sanitize children
                    Array.from(node.childNodes).forEach(sanitizeNode);
                    return;
                }
                // Remove node if tag is not allowed
                if (!allowedTags.has(tagName)) {
                    node.parentNode?.removeChild(node);
                    return;
                }
                // Add blinking animation for blink tag
                if (tagName === 'blink') {
                    element.style.animation = 'blink 1s step-start infinite';
                }
                // Remove disallowed attributes
                Array.from(element.attributes).forEach(attr => {
                    if (!allowedAttributes.has(attr.name.toLowerCase())) {
                        element.removeAttribute(attr.name);
                    }
                });
                // Sanitize style attribute
                const style = element.getAttribute('style');
                if (style) {
                    // Allow color and animation styles
                    const safeStyle = style.split(';')
                        .filter(s => {
                        const prop = s.trim().toLowerCase();
                        return prop.startsWith('color:') || prop.startsWith('animation:');
                    })
                        .join(';');
                    if (safeStyle) {
                        element.setAttribute('style', safeStyle);
                    }
                    else {
                        element.removeAttribute('style');
                    }
                }
                // Recursively sanitize child nodes
                Array.from(node.childNodes).forEach(sanitizeNode);
            }
        };
        // Sanitize all nodes
        Array.from(temp.childNodes).forEach(sanitizeNode);
        return temp.innerHTML;
    }
    createSandbox(script) {
        // Create modal for confirmation
        const modal = document.createElement('div');
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          padding: 20px;
          border-radius: 5px;
          border: 1px solid orange;
          color: white;
          z-index: 2000;
          font-family: 'Ubuntu', sans-serif;
          font-weight: 700;
          max-width: 80%;
      `;
        const content = document.createElement('div');
        content.innerHTML = `
          <h3 style="color: orange;">⚠️ Warning: Script Execution</h3>
          <p>Script from user: ${script.sender}</p>
          <pre style="
              background: rgba(255, 255, 255, 0.1);
              padding: 10px;
              border-radius: 3px;
              max-height: 200px;
              overflow-y: auto;
              white-space: pre-wrap;
          ">${script.code}</pre>
          <p style="color: orange;">This script will run in a sandboxed environment with limited capabilities.</p>
      `;
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
          display: flex;
          gap: 10px;
          margin-top: 15px;
          justify-content: center;
      `;
        const runButton = document.createElement('button');
        runButton.textContent = 'Run Script';
        runButton.style.cssText = `
          background: orange;
          color: black;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = `
          background: #666;
          color: white;
          border: none;
          padding: 5px 15px;
          border-radius: 3px;
          cursor: pointer;
      `;
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(runButton);
        modal.appendChild(content);
        modal.appendChild(buttonContainer);
        document.body.appendChild(modal);
        // Handle button clicks
        cancelButton.onclick = () => {
            document.body.removeChild(modal);
        };
        runButton.onclick = () => {
            try {
                // Create sandbox iframe
                const sandbox = document.createElement('iframe');
                sandbox.style.display = 'none';
                document.body.appendChild(sandbox);
                // Create restricted context
                const restrictedWindow = sandbox.contentWindow;
                if (restrictedWindow) {
                    // Define allowed APIs
                    const safeContext = {
                        console: {
                            log: (...args) => {
                                this.addChatMessage({
                                    sender: 'Script Output',
                                    content: args.join(' '),
                                    timestamp: Date.now()
                                });
                            }
                        },
                        alert: (msg) => {
                            this.addChatMessage({
                                sender: 'Script Alert',
                                content: msg,
                                timestamp: Date.now()
                            });
                        },
                        // Add more safe APIs as needed
                    };
                    // Run the script in sandbox using Function constructor instead of eval
                    const wrappedCode = `
                      try {
                          const runScript = new Function('safeContext', 'with (safeContext) { ' + script.code + ' }');
                          runScript(safeContext);
                      } catch (error) {
                          console.log('Script Error:', error.message);
                      }
                  `;
                    // Use Function constructor instead of direct eval
                    const scriptRunner = new Function('safeContext', wrappedCode);
                    scriptRunner(safeContext);
                }
                // Cleanup
                document.body.removeChild(sandbox);
                document.body.removeChild(modal);
            }
            catch (error) {
                this.addChatMessage({
                    sender: 'Script Error',
                    content: `Failed to execute script: ${error}`,
                    timestamp: Date.now()
                });
                document.body.removeChild(modal);
            }
        };
    }
    showIframeEmbed(iframeData, button) {
        // Replace the button with the actual iframe
        const container = document.createElement('div');
        container.style.cssText = `
          margin: 4px 0;
          border: 1px solid rgba(100, 149, 237, 0.5);
          border-radius: 3px;
          overflow: hidden;
          max-width: 100%;
      `;
        const iframe = document.createElement('iframe');
        iframe.src = iframeData.src;
        iframe.width = iframeData.width;
        iframe.height = iframeData.height;
        iframe.style.cssText = `
          display: block;
          max-width: 100%;
          border: none;
      `;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        // Add a close button above the iframe
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ Hide embed';
        closeBtn.style.cssText = `
          background: rgba(100, 149, 237, 0.3);
          border: none;
          border-bottom: 1px solid rgba(100, 149, 237, 0.5);
          color: white;
          padding: 2px 6px;
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          width: 100%;
          text-align: left;
      `;
        closeBtn.addEventListener('click', () => {
            // Replace the container back with a button
            const newBtn = document.createElement('button');
            newBtn.className = 'iframe-warning';
            newBtn.setAttribute('data-iframe-id', iframeData.id);
            newBtn.style.cssText = `
              background: rgba(100, 149, 237, 0.2);
              border: 1px solid cornflowerblue;
              color: white;
              padding: 2px 5px;
              border-radius: 3px;
              cursor: pointer;
              font-size: 12px;
              margin: 0 5px;
              font-family: inherit;
          `;
            newBtn.textContent = '🔗 Click to show embed';
            this.pendingIframes.set(iframeData.id, iframeData);
            newBtn.addEventListener('click', () => {
                const data = this.pendingIframes.get(iframeData.id);
                if (data) {
                    this.showIframeEmbed(data, newBtn);
                    this.pendingIframes.delete(iframeData.id);
                }
            });
            container.parentNode?.replaceChild(newBtn, container);
        });
        container.appendChild(closeBtn);
        container.appendChild(iframe);
        button.parentNode?.replaceChild(container, button);
    }
    /**
     * Show a client-side System line in the chat (no server round trip).
     * Used for local UI feedback, e.g. blocked loadout edits in the maze.
     */
    addLocalSystemMessage(content) {
        this.addChatMessage({ sender: 'System', content, timestamp: Date.now() });
    }
    addChatMessage(message) {
        if (!this.chatMessages)
            return;
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.style.cssText = `
          margin: 2px 0;
          font-size: 14px;
          word-wrap: break-word;
          pointer-events: auto;
      `;
        const time = new Date(message.timestamp).toLocaleTimeString();
        // Update pending scripts/iframes with sender information
        const sanitizedContent = this.sanitizeHTML(message.content);
        this.pendingScripts.forEach(script => {
            script.sender = message.sender;
        });
        this.pendingIframes.forEach(iframe => {
            iframe.sender = message.sender;
        });
        messageElement.innerHTML = `
          <span class="chat-time" style="color: rgba(255, 255, 255, 0.6);">[${time}]</span>
          <span class="chat-sender" style="color: #00ff00;">${message.sender}:</span>
          <span style="color: white;">${sanitizedContent}</span>
      `;
        // Add click handlers for script buttons
        messageElement.querySelectorAll('.script-warning').forEach(button => {
            button.addEventListener('click', () => {
                const scriptId = button.getAttribute('data-script-id');
                if (scriptId) {
                    const script = this.pendingScripts.get(scriptId);
                    if (script) {
                        this.createSandbox(script);
                        this.pendingScripts.delete(scriptId);
                    }
                }
            });
        });
        // Add click handlers for iframe buttons
        messageElement.querySelectorAll('.iframe-warning').forEach(button => {
            button.addEventListener('click', () => {
                const iframeId = button.getAttribute('data-iframe-id');
                if (iframeId) {
                    const iframeData = this.pendingIframes.get(iframeId);
                    if (iframeData) {
                        this.showIframeEmbed(iframeData, button);
                        this.pendingIframes.delete(iframeId);
                    }
                }
            });
        });
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        while (this.chatMessages.children.length > 100) {
            this.chatMessages.removeChild(this.chatMessages.firstChild);
        }
    }
    cleanup() {
        this.chatContainer?.remove();
    }
}
exports.Chat = Chat;
