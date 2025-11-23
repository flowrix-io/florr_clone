"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsManager = void 0;
const petals_1 = require("./petals");
const RARITY_COLORS = {
    common: '#7eef6d',
    uncommon: '#ffe65d',
    rare: '#4d52e3',
    epic: '#861fde',
    legendary: '#de1f1f',
    mythic: '#1fdbde',
    ultra: '#de1f65',
    super: '#2bffa4',
    unique: '#bf00ff'
};
const RARITY_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0
};
const RARITY_TP_COSTS = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 5,
    legendary: 8,
    mythic: 12,
    ultra: 18,
    super: 25,
    unique: 26
};
class SkillsManager {
    constructor(game) {
        this.skillsPanel = null;
        this.isOpen = false;
        this.game = game;
        this.createSkillsPanel();
    }
    createSkillsPanel() {
        this.skillsPanel = document.createElement('div');
        this.skillsPanel.className = 'skills-panel';
        this.skillsPanel.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 900px;
            max-height: 700px;
            background: #49c46f;
            border: 2px solid #4CAF50;
            border-radius: 10px;
            padding: 20px;
            z-index: 4000;
            display: none;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        const content = document.createElement('div');
        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h2 style="color: #FFFFFF; margin: 0; font-family: Arial, sans-serif; -webkit-text-stroke: 1px black; -webkit-font-smoothing: none;">Skills Tree</h2>
                <button id="closeSkillsButton" style="background: #ff4444; color: white; border: none; padding: 5px 15px; border-radius: 5px; cursor: pointer; font-size: 16px;">✕</button>
            </div>
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(255, 255, 255, 0.1); border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                <div style="color: #FFFFFF; font-size: 18px; -webkit-text-stroke: 0.5px black;">
                    Talent Points: <span id="tpDisplay">0</span>
                </div>
                <button id="resetSkillsButton" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;">Reset All Skills</button>
            </div>
            <div id="skillsContent" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;"></div>
        `;
        this.skillsPanel.appendChild(content);
        document.body.appendChild(this.skillsPanel);
        this.populateSkills();
        // Add close button listener
        const closeButton = this.skillsPanel.querySelector('#closeSkillsButton');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.hide());
        }
        // Add reset button listener
        const resetButton = this.skillsPanel.querySelector('#resetSkillsButton');
        if (resetButton) {
            resetButton.addEventListener('click', () => this.resetSkills());
        }
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
        // Add custom scrollbar styles
        const style = document.createElement('style');
        style.textContent = `
            .skills-panel::-webkit-scrollbar {
                width: 10px;
            }
            .skills-panel::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 5px;
            }
            .skills-panel::-webkit-scrollbar-thumb {
                background: #4CAF50;
                border-radius: 5px;
            }
            .skills-panel::-webkit-scrollbar-thumb:hover {
                background: #45a049;
            }
            .skill-tree {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 15px;
            }
            .skill-tree-title {
                font-size: 18px;
                font-weight: bold;
                color: #FFFFFF;
                -webkit-text-stroke: 0.5px black;
                margin-bottom: 10px;
                text-align: center;
            }
            .skill-tier {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
                position: relative;
            }
            .skill-tier::before {
                content: '';
                position: absolute;
                left: 20px;
                top: 50%;
                width: 2px;
                height: 8px;
                background: rgba(255, 255, 255, 0.3);
                transform: translateY(-50%);
            }
            .skill-tier:first-child::before {
                display: none;
            }
            .skill-tier-node {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                border: 3px solid;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-weight: bold;
                font-size: 12px;
                color: white;
                -webkit-text-stroke: 1px black;
                transition: all 0.2s;
                position: relative;
                z-index: 1;
            }
            .skill-tier-node.unlocked {
                box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
            }
            .skill-tier-node.locked {
                opacity: 0.4;
                cursor: not-allowed;
            }
            .skill-tier-node.available {
                cursor: pointer;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            .skill-tier-info {
                flex: 1;
                margin-left: 10px;
                font-size: 12px;
                color: #FFFFFF;
                -webkit-text-stroke: 0.5px black;
            }
            .skill-tier-name {
                font-weight: bold;
            }
            .skill-tier-multiplier {
                font-size: 10px;
                opacity: 0.8;
            }
        `;
        document.head.appendChild(style);
    }
    populateSkills() {
        const contentDiv = this.skillsPanel?.querySelector('#skillsContent');
        if (!contentDiv)
            return;
        const skills = [
            { id: 'damage', name: 'Damage', description: 'Multiplies player damage' },
            { id: 'petalHealth', name: 'Petal Health', description: 'Multiplies petal max health' },
            { id: 'playerHealth', name: 'Player Health', description: 'Multiplies player max health' },
            { id: 'healingMultiplier', name: 'Healing', description: 'Multiplies healing received' }
        ];
        contentDiv.innerHTML = skills.map(skill => `
            <div class="skill-tree" data-skill="${skill.id}">
                <div class="skill-tree-title">${skill.name}</div>
                ${petals_1.RARITY_LEVELS.map((rarity, index) => `
                    <div class="skill-tier">
                        <div class="skill-tier-node" 
                             id="skill-${skill.id}-${rarity}"
                             data-skill="${skill.id}"
                             data-rarity="${rarity}"
                             style="background-color: ${RARITY_COLORS[rarity]}; border-color: ${this.darkenColor(RARITY_COLORS[rarity])};">
                            ${index + 1}
                        </div>
                        <div class="skill-tier-info">
                            <div class="skill-tier-name">${rarity.charAt(0).toUpperCase() + rarity.slice(1)}</div>
                            <div class="skill-tier-multiplier">${(RARITY_MULTIPLIERS[rarity] * 100).toFixed(0)}%</div>
                            <div class="skill-tier-cost" style="font-size: 10px; opacity: 0.7;">${RARITY_TP_COSTS[rarity]} TP</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
        // Add event listeners to tier nodes
        skills.forEach(skill => {
            petals_1.RARITY_LEVELS.forEach(rarity => {
                const node = contentDiv.querySelector(`#skill-${skill.id}-${rarity}`);
                if (node) {
                    node.addEventListener('click', () => this.upgradeSkill(skill.id, rarity));
                }
            });
        });
    }
    darkenColor(hex, percent = 30) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const factor = 1 - (percent / 100);
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }
    upgradeSkill(skillId, rarity) {
        const socket = this.game.getSocket();
        if (!socket) {
            console.error('Socket not available');
            return;
        }
        socket.emit('upgradeSkill', { skillId, rarity });
    }
    resetSkills() {
        const socket = this.game.getSocket();
        if (!socket) {
            console.error('Socket not available');
            return;
        }
        // Confirm with user
        if (!confirm('Are you sure you want to reset all skills? All TP will be refunded.')) {
            return;
        }
        socket.emit('resetSkills');
    }
    getCurrentTier(skills, skillId) {
        if (!skills || !skills[skillId])
            return null;
        return skills[skillId];
    }
    isTierUnlocked(currentTier, targetRarity) {
        if (!currentTier)
            return targetRarity === 'common';
        const currentIndex = petals_1.RARITY_LEVELS.indexOf(currentTier);
        const targetIndex = petals_1.RARITY_LEVELS.indexOf(targetRarity);
        return targetIndex <= currentIndex;
    }
    getNextTier(currentTier) {
        if (!currentTier)
            return 'common';
        const currentIndex = petals_1.RARITY_LEVELS.indexOf(currentTier);
        if (currentIndex < petals_1.RARITY_LEVELS.length - 1) {
            return petals_1.RARITY_LEVELS[currentIndex + 1];
        }
        return null;
    }
    updateSkills(tp, skills) {
        if (!this.skillsPanel)
            return;
        // Update TP display
        const tpDisplay = this.skillsPanel.querySelector('#tpDisplay');
        if (tpDisplay) {
            tpDisplay.textContent = tp.toString();
        }
        // Update skill trees
        const skillIds = ['damage', 'petalHealth', 'playerHealth', 'healingMultiplier'];
        skillIds.forEach(skillId => {
            const currentTier = this.getCurrentTier(skills, skillId);
            const nextTier = this.getNextTier(currentTier);
            petals_1.RARITY_LEVELS.forEach(rarity => {
                const node = this.skillsPanel?.querySelector(`#skill-${skillId}-${rarity}`);
                if (!node)
                    return;
                const isUnlocked = this.isTierUnlocked(currentTier, rarity);
                const isAvailable = nextTier === rarity && tp >= RARITY_TP_COSTS[rarity];
                // Remove all classes
                node.classList.remove('unlocked', 'locked', 'available');
                if (isUnlocked) {
                    node.classList.add('unlocked');
                }
                else if (isAvailable) {
                    node.classList.add('available');
                }
                else {
                    node.classList.add('locked');
                }
            });
        });
    }
    toggle() {
        if (this.isOpen) {
            this.hide();
        }
        else {
            this.show();
        }
    }
    show() {
        if (this.skillsPanel) {
            this.skillsPanel.style.display = 'block';
            this.isOpen = true;
            this.refreshSkills();
        }
    }
    hide() {
        if (this.skillsPanel) {
            this.skillsPanel.style.display = 'none';
            this.isOpen = false;
        }
    }
    refreshSkills() {
        const player = this.game.getLocalPlayer();
        if (player) {
            this.updateSkills(player.tp || 0, player.skills || { damage: undefined, petalHealth: undefined, playerHealth: undefined, healingMultiplier: undefined });
        }
    }
    isSkillsOpen() {
        return this.isOpen;
    }
}
exports.SkillsManager = SkillsManager;
