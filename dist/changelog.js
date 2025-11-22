"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangelogManager = exports.CHANGELOG = void 0;
exports.CHANGELOG = [
    {
        date: 'October 18, 2025',
        changes: [
            'Added changelog'
        ]
    },
    {
        date: 'October 19, 2025',
        changes: [
            'Added 3 new biomes',
            'New admin petal: Sparkle',
            'New admin command: spawn_special_mobs',
        ]
    },
    {
        date: 'October 22, 2025',
        changes: [
            'New petal: Lightning',
            'New petal: Iris',
            'It is discovered that mobs have round hitboxes, so the setting is now more accurate'
        ]
    },
    {
        date: 'October 24, 2025',
        changes: [
            'Overhauled the settings menu',
            'Ultra+ petals now have particle effects',
            'Shaders are now available in the settings menu',
        ]
    },
    {
        date: 'November 20, 2025',
        changes: [
            'New biome: Jungle',
        ]
    },
    {
        date: 'November 21, 2025',
        changes: [
            'Some recolors and tweaks to the graphics',
            'fixes'
        ]
    }
];
class ChangelogManager {
    constructor() {
        this.changelogPanel = null;
        this.isOpen = false;
        this.createChangelogPanel();
    }
    createChangelogPanel() {
        this.changelogPanel = document.createElement('div');
        this.changelogPanel.className = 'changelog-panel';
        this.changelogPanel.style.cssText = `
            position: absolute;
            top: 72px;
            left: 20px;
            width: 600px;
            max-height: 500px;
            background: rgba(0, 0, 0, 0.95);
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
                <h2 style="color: #4CAF50; margin: 0; font-family: Arial, sans-serif;">Changelog</h2>
                <button id="closeChangelogButton" style="background: #ff4444; color: white; border: none; padding: 5px 15px; border-radius: 5px; cursor: pointer; font-size: 16px;">✕</button>
            </div>
            <div id="changelogContent"></div>
        `;
        this.changelogPanel.appendChild(content);
        document.body.appendChild(this.changelogPanel);
        this.populateChangelog();
        // Add close button listener
        const closeButton = this.changelogPanel.querySelector('#closeChangelogButton');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.hide());
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
            .changelog-panel::-webkit-scrollbar {
                width: 10px;
            }
            .changelog-panel::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 5px;
            }
            .changelog-panel::-webkit-scrollbar-thumb {
                background: #4CAF50;
                border-radius: 5px;
            }
            .changelog-panel::-webkit-scrollbar-thumb:hover {
                background: #45a049;
            }
            .changelog-entry {
                margin-bottom: 25px;
                padding: 15px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                border-left: 4px solid #4CAF50;
            }
            .changelog-date {
                font-size: 20px;
                font-weight: bold;
                color: #4CAF50;
                margin-bottom: 10px;
            }
            .changelog-change {
                margin: 8px 0;
                padding-left: 20px;
                position: relative;
                color: #ddd;
                line-height: 1.6;
            }
            .changelog-change::before {
                content: '•';
                position: absolute;
                left: 5px;
                font-size: 20px;
                color: #4CAF50;
            }
        `;
        document.head.appendChild(style);
    }
    populateChangelog() {
        const contentDiv = this.changelogPanel?.querySelector('#changelogContent');
        if (!contentDiv)
            return;
        contentDiv.innerHTML = exports.CHANGELOG.map(entry => `
            <div class="changelog-entry">
                <div class="changelog-date">${entry.date}</div>
                ${entry.changes.map(change => `
                    <div class="changelog-change">${change}</div>
                `).join('')}
            </div>
        `).join('');
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
        if (this.changelogPanel) {
            this.changelogPanel.style.display = 'block';
            this.isOpen = true;
        }
    }
    hide() {
        if (this.changelogPanel) {
            this.changelogPanel.style.display = 'none';
            this.isOpen = false;
        }
    }
    isChangelogOpen() {
        return this.isOpen;
    }
}
exports.ChangelogManager = ChangelogManager;
