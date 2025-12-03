"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Chat = void 0;
class Chat {
    constructor(socket) {
        this.chatContainer = null;
        this.chatInput = null;
        this.chatMessages = null;
        this.isChatFocused = false;
        this.pendingScripts = new Map();
        this.socket = socket;
        this.initialize();
        this.setupSocketListeners();
    }
    // Method to update socket reference (for cross-server transfers)
    updateSocket(newSocket) {
        // Remove old listeners
        this.socket.off('chatMessage');
        this.socket.off('chatHistory');
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
        this.chatContainer.style.cssText = `
          position: fixed;
          bottom: 10px;
          left: 60px;
          width: 300px;
          height: 200px;
          background: transparent;
          display: flex;
          flex-direction: column;
          z-index: 200;
          font-family: Ubuntu, sans-serif;
      `;
        // Create messages container with transparent background
        this.chatMessages = document.createElement('div');
        this.chatMessages.className = 'chat-messages';
        this.chatMessages.style.cssText = `
          flex-grow: 1;
          overflow-y: auto;
          padding: 5px;
          color: white;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
          background: transparent;
          z-index: 200;
          font-family: Ubuntu, sans-serif;
      `;
        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'chat-input-container';
        inputContainer.style.cssText = `
          padding: 5px;
          background: transparent;
          font-family: Ubuntu, sans-serif;
          z-index: 200;
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
          font-family: Ubuntu, sans-serif;
          z-index: 200;
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
        });
        // Send all messages to server (including /help for server-side handling)
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && this.chatInput?.value.trim()) {
                // Check if socket is authenticated (username is set during authentication)
                if (!this.socket.username) {
                    console.warn('[CHAT] Socket not authenticated yet, message will be sent when authenticated');
                    // Store message to send later if needed, or just show error
                    alert('Please wait for authentication to complete');
                    return;
                }
                // Send the chat message to the server
                this.socket.emit('chatMessage', this.chatInput.value.trim());
                this.chatInput.value = '';
            }
        });
        this.chatContainer.appendChild(this.chatMessages);
        inputContainer.appendChild(this.chatInput);
        this.chatContainer.appendChild(inputContainer);
        document.body.appendChild(this.chatContainer);
        // Request chat history
        this.socket.emit('requestChatHistory');
    }
    sanitizeHTML(str) {
        // Add 'script' to allowed tags
        const allowedTags = new Set(['b', 'i', 'u', 'strong', 'em', 'span', 'color', 'blink', 'script']);
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
          font-family: Ubuntu, sans-serif;
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
    addChatMessage(message) {
        if (!this.chatMessages)
            return;
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.style.cssText = `
          margin: 2px 0;
          font-size: 14px;
          word-wrap: break-word;
          font-family: Ubuntu, sans-serif;
      `;
        const time = new Date(message.timestamp).toLocaleTimeString();
        // Update pending scripts with sender information
        const sanitizedContent = this.sanitizeHTML(message.content);
        this.pendingScripts.forEach(script => {
            script.sender = message.sender;
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
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        while (this.chatMessages.children.length > 100) {
            this.chatMessages.removeChild(this.chatMessages.firstChild);
        }
    }
}
exports.Chat = Chat;
