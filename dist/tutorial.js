"use strict";
/**
 * Tutorial System for florr.io clone
 * Guides new players through basic game mechanics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tutorial = void 0;
class Tutorial {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.tutorialOverlay = null;
        this.tutorialBox = null;
        this.highlightOverlay = null;
        this.completedSteps = new Set();
        this.steps = [
            {
                id: 'welcome',
                title: 'Welcome to florr.io clone!',
                description: 'Let\'s learn the basics! You\'ll learn how to move, use petals, equip items, and craft upgrades.',
                position: 'center',
                skipButton: true
            },
            {
                id: 'movement',
                title: 'Movement',
                description: 'Use <strong>W/A/S/D</strong> or <strong>Arrow Keys</strong> to move your flower around the world. Try moving now!',
                position: 'center',
                condition: () => {
                    // Check if player has moved (any key pressed)
                    return this.completedSteps.has('movement_detected');
                }
            },
            {
                id: 'extend_petals',
                title: 'Extending Petals',
                description: 'Hold <strong>SPACE</strong> to extend your petals outward for maximum reach and damage. Try it now!<br><br>Your petals protect you and damage enemies that touch them.',
                position: 'center',
                condition: () => {
                    return this.completedSteps.has('petals_extended');
                }
            },
            {
                id: 'loadout_intro',
                title: 'Loadout Bar',
                description: 'This is your <strong>Loadout Bar</strong> at the bottom of the screen. Here you can equip petals and items to use in battle.<br><br>Each slot can be accessed using keys <strong>1-9 and 0</strong>.',
                highlightElement: '#loadoutBar',
                position: 'top',
                skipButton: false
            },
            {
                id: 'inventory',
                title: 'Inventory',
                description: 'Press <strong>Z</strong> to open your inventory. This is where all your collected petals and items are stored.<br><br>You can <strong>drag and drop</strong> items from your inventory to your loadout bar to equip them.',
                position: 'center',
                condition: () => {
                    return this.completedSteps.has('inventory_opened');
                }
            },
            {
                id: 'equip_petal',
                title: 'Equipping Petals',
                description: 'Try dragging a petal from your inventory to any slot in the loadout bar!<br><br><em>Tip: Different petals have different abilities. Experiment to find your favorite combination!</em>',
                highlightElement: '#loadoutBar',
                position: 'top',
                condition: () => {
                    return this.completedSteps.has('item_equipped');
                }
            },
            {
                id: 'crafting_intro',
                title: 'Crafting',
                description: 'Press <strong>C</strong> to open the crafting menu. Crafting allows you to combine 5 items of the same type and rarity to create 1 item of higher rarity!',
                position: 'center',
                condition: () => {
                    return this.completedSteps.has('crafting_opened');
                }
            },
            {
                id: 'crafting_process',
                title: 'How to Craft',
                description: 'To craft:<br>1. Click on an item in your inventory (that you have at least 5 of) to add 5 to the crafting circle<br>2. Click the <strong>Craft</strong> button<br>3. If successful, you\'ll get a higher rarity item!<br><br><em>Note: Success chance decreases with higher rarities. You can close this menu with C.</em>',
                highlightElement: '#craftingPanel',
                position: 'center',
                skipButton: false
            },
            {
                id: 'combat',
                title: 'Combat Tips',
                description: 'Your petals automatically damage enemies that touch them. More petals = more protection!<br><br>• <strong>Health</strong>: Each petal has health and will break when damaged<br>• <strong>Damage</strong>: Higher rarity petals deal more damage<br>• <strong>Strategy</strong>: Mix defensive and offensive petals for best results',
                position: 'center',
                skipButton: false
            },
            {
                id: 'controls',
                title: 'Additional Controls',
                description: '<strong>K</strong> - Toggle mouse/keyboard controls<br><strong>H</strong> - Toggle hitboxes<br><strong>+/-</strong> - Zoom in/out<br><strong>Enter</strong> - Open chat<br><strong>ESC</strong> - Exit to menu<br><br>You can customize controls in the Settings menu!',
                position: 'center',
                skipButton: false
            },
            {
                id: 'complete',
                title: 'Tutorial Complete!',
                description: 'You\'re ready to explore! Defeat enemies, collect petals, craft upgrades, and become the strongest flower in the garden!<br><br>Good luck!',
                position: 'center',
                skipButton: false
            }
        ];
        this.loadProgress();
    }
    start() {
        // Check if tutorial was already completed
        const completed = localStorage.getItem('tutorial_completed');
        if (completed === 'true') {
            return;
        }
        this.isActive = true;
        this.currentStep = 0;
        this.createTutorialUI();
        this.showStep(this.currentStep);
        this.setupEventListeners();
    }
    createTutorialUI() {
        // Create light overlay (less intrusive)
        // this.tutorialOverlay = document.createElement('div');
        // this.tutorialOverlay.id = 'tutorialOverlay';
        // this.tutorialOverlay.style.cssText = `
        //     position: fixed;
        //     top: 0;
        //     left: 0;
        //     width: 100%;
        //     height: 100%;
        //     background: rgba(0, 0, 0, 0.3);
        //     z-index: 9998;
        //     transition: opacity 0.3s ease;
        //     pointer-events: none;
        // `;
        // document.body.appendChild(this.tutorialOverlay);
        // Create tutorial box
        this.tutorialBox = document.createElement('div');
        this.tutorialBox.id = 'tutorialBox';
        this.tutorialBox.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(40, 40, 40, 0.85);
            color: white;
            padding: 20px 25px;
            border-radius: 12px;
            max-width: 500px;
            z-index: 9999;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            font-family: Ubuntu, sans-serif;
            animation: slideIn 0.3s ease-out;
            pointer-events: auto;
            backdrop-filter: blur(5px);
        `;
        document.body.appendChild(this.tutorialBox);
        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            @keyframes pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 0, 0.7); }
                50% { box-shadow: 0 0 0 15px rgba(255, 255, 0, 0); }
            }
            .tutorial-highlight {
                animation: pulse 2s infinite;
                pointer-events: auto !important;
                box-shadow: 0 0 20px rgba(255, 255, 0, 0.8) !important;
                z-index: 9997 !important;
            }
            .tutorial-button {
                background: rgba(255, 255, 255, 0.9);
                color: #333;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                font-size: 14px;
                transition: all 0.2s ease;
                margin: 5px;
            }
            .tutorial-button:hover {
                transform: scale(1.05);
                background: white;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            }
            .tutorial-button.skip {
                background: rgba(255, 255, 255, 0.2);
                color: rgba(255, 255, 255, 0.9);
            }
            .tutorial-button.skip:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            .tutorial-progress {
                display: flex;
                gap: 5px;
                margin-top: 15px;
                justify-content: center;
            }
            .tutorial-progress-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.3);
                transition: all 0.3s ease;
            }
            .tutorial-progress-dot.active {
                background: white;
                transform: scale(1.3);
            }
        `;
        document.head.appendChild(style);
    }
    showStep(stepIndex) {
        if (stepIndex >= this.steps.length) {
            this.complete();
            return;
        }
        if (!this.tutorialBox) {
            console.error('[Tutorial] Tutorial box element is missing!');
            return;
        }
        const step = this.steps[stepIndex];
        // Clear previous highlights
        this.clearHighlight();
        // Update tutorial box content
        this.tutorialBox.innerHTML = `
            <h2 style="margin: 0 0 15px 0; font-size: 24px;">${step.title}</h2>
            <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">${step.description}</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 10px;">
                    ${step.skipButton !== false ? '<button class="tutorial-button skip" id="tutorialSkip">Skip Tutorial</button>' : ''}
                    ${!step.condition ? '<button class="tutorial-button" id="tutorialNext">Next</button>' : ''}
                </div>
                <div style="color: rgba(255, 255, 255, 0.7); font-size: 14px;">
                    ${stepIndex + 1} / ${this.steps.length}
                </div>
            </div>
            <div class="tutorial-progress">
                ${this.steps.map((_, i) => `
                    <div class="tutorial-progress-dot ${i === stepIndex ? 'active' : ''}"></div>
                `).join('')}
            </div>
        `;
        // Position the tutorial box
        this.positionTutorialBox(step.position, step.highlightElement);
        // Highlight element if specified
        if (step.highlightElement) {
            this.highlightElement(step.highlightElement);
        }
        // Setup button handlers
        const nextButton = document.getElementById('tutorialNext');
        const skipButton = document.getElementById('tutorialSkip');
        if (nextButton) {
            nextButton.addEventListener('click', () => this.nextStep());
        }
        if (skipButton) {
            skipButton.addEventListener('click', () => this.skip());
        }
        // Check condition if exists
        if (step.condition) {
            this.checkStepCondition(step);
        }
    }
    positionTutorialBox(position, highlightElement) {
        if (!this.tutorialBox)
            return;
        // Reset positioning
        this.tutorialBox.style.top = '';
        this.tutorialBox.style.bottom = '';
        this.tutorialBox.style.left = '';
        this.tutorialBox.style.right = '';
        this.tutorialBox.style.transform = '';
        if (highlightElement) {
            const element = document.querySelector(highlightElement);
            if (element) {
                const rect = element.getBoundingClientRect();
                switch (position) {
                    case 'top':
                        this.tutorialBox.style.bottom = `${window.innerHeight - rect.top + 20}px`;
                        this.tutorialBox.style.left = '50%';
                        this.tutorialBox.style.transform = 'translateX(-50%)';
                        break;
                    case 'bottom':
                        this.tutorialBox.style.top = `${rect.bottom + 20}px`;
                        this.tutorialBox.style.left = '50%';
                        this.tutorialBox.style.transform = 'translateX(-50%)';
                        break;
                    case 'left':
                        this.tutorialBox.style.right = `${window.innerWidth - rect.left + 20}px`;
                        this.tutorialBox.style.top = '50%';
                        this.tutorialBox.style.transform = 'translateY(-50%)';
                        break;
                    case 'right':
                        this.tutorialBox.style.left = `${rect.right + 20}px`;
                        this.tutorialBox.style.top = '50%';
                        this.tutorialBox.style.transform = 'translateY(-50%)';
                        break;
                    default:
                        this.tutorialBox.style.top = '60px';
                        this.tutorialBox.style.left = '50%';
                        this.tutorialBox.style.transform = 'translateX(-50%)';
                }
                return;
            }
        }
        // Default top position (below bossbar)
        this.tutorialBox.style.top = '60px';
        this.tutorialBox.style.left = '50%';
        this.tutorialBox.style.transform = 'translateX(-50%)';
    }
    highlightElement(selector) {
        // Use setTimeout to ensure element is in DOM and rendered
        setTimeout(() => {
            const element = document.querySelector(selector);
            if (element) {
                element.classList.add('tutorial-highlight');
                // Don't modify position or z-index - just add the highlight class
                // This prevents breaking existing positioning (e.g., fixed loadout bar)
            }
            else {
                console.warn(`[Tutorial] Could not find element to highlight: ${selector}`);
            }
        }, 100);
    }
    clearHighlight() {
        const highlighted = document.querySelectorAll('.tutorial-highlight');
        highlighted.forEach(el => {
            el.classList.remove('tutorial-highlight');
        });
    }
    checkStepCondition(step) {
        const checkInterval = setInterval(() => {
            if (!this.isActive) {
                clearInterval(checkInterval);
                return;
            }
            if (step.condition && step.condition()) {
                clearInterval(checkInterval);
                setTimeout(() => {
                    this.nextStep();
                }, 500); // Small delay for better UX
            }
        }, 100);
    }
    setupEventListeners() {
        // Listen for movement
        const handleKeyDown = (e) => {
            // Check for WASD (case-insensitive) or Arrow keys
            const key = e.key.toLowerCase();
            const movementKeys = ['w', 'a', 's', 'd'];
            const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
            if (movementKeys.includes(key) || arrowKeys.includes(e.key)) {
                this.completedSteps.add('movement_detected');
            }
            if (e.key === ' ') {
                this.completedSteps.add('petals_extended');
            }
            if (key === 'z') {
                // Simply mark as complete when Z is pressed
                this.completedSteps.add('inventory_opened');
            }
            if (key === 'c') {
                // Simply mark as complete when C is pressed
                this.completedSteps.add('crafting_opened');
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        // Listen for item equipping via mutations
        const observer = new MutationObserver((mutations) => {
            if (!this.isActive)
                return; // Only observe while tutorial is active
            // Check if any item is equipped (loadout slot has content)
            const loadoutSlots = document.querySelectorAll('.loadout-slot');
            loadoutSlots.forEach(slot => {
                if (slot.querySelector('img') || slot.querySelector('div:not(.key-binding)')) {
                    this.completedSteps.add('item_equipped');
                }
            });
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
        // Store references for cleanup
        this.keyDownHandler = handleKeyDown;
        this.mutationObserver = observer;
    }
    nextStep() {
        this.currentStep++;
        this.saveProgress();
        this.showStep(this.currentStep);
    }
    skip() {
        if (confirm('Are you sure you want to skip the tutorial? You can always view controls in the Settings menu.')) {
            this.complete();
        }
    }
    complete() {
        this.isActive = false;
        this.clearHighlight();
        // Remove tutorial UI
        if (this.tutorialOverlay) {
            this.tutorialOverlay.remove();
            this.tutorialOverlay = null;
        }
        if (this.tutorialBox) {
            this.tutorialBox.remove();
            this.tutorialBox = null;
        }
        // Mark as completed
        localStorage.setItem('tutorial_completed', 'true');
        // Cleanup event listeners
        if (this.keyDownHandler) {
            document.removeEventListener('keydown', this.keyDownHandler);
        }
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
    }
    saveProgress() {
        localStorage.setItem('tutorial_step', this.currentStep.toString());
    }
    loadProgress() {
        const savedStep = localStorage.getItem('tutorial_step');
        if (savedStep) {
            this.currentStep = parseInt(savedStep);
        }
    }
    reset() {
        localStorage.removeItem('tutorial_completed');
        localStorage.removeItem('tutorial_step');
        this.currentStep = 0;
        this.completedSteps.clear();
    }
    isRunning() {
        return this.isActive;
    }
    // Method to manually trigger from settings
    restart() {
        this.reset();
        this.start();
    }
}
exports.Tutorial = Tutorial;
