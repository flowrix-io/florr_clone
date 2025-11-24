// This file should not be updated every time
// It should only be updated when there are major changes
export interface ChangelogEntry {
    date: string;
    changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
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
            'New petal: Jelly',
            'fixes'
        ]
    },
    {
        date: 'November 22, 2025',
        changes: [
            'New petal: Yucca',
            'New petal: Leaf',
            'Target dummy now shows DPS',
        ]
    },
    {
        date: 'November 23, 2025',
        changes: [
            'Added skills system',
        ]
    }
];

export class ChangelogManager {
    private changelogPanel: HTMLDivElement | null = null;
    private isOpen: boolean = false;

    constructor() {
        this.createChangelogPanel();
    }

    private createChangelogPanel(): void {
        this.changelogPanel = document.createElement('div');
        this.changelogPanel.className = 'changelog-panel';
        this.changelogPanel.style.cssText = `
            position: absolute;
            top: 72px;
            left: 20px;
            width: 600px;
            max-height: 500px;
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
                <h2 class="outlined-text" style="margin: 0; font-family: Arial, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-smooth: always;">Changelog</h2>
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
            }
            .changelog-date {
                font-size: 20px;
                font-weight: bold;
                font-family: Arial, sans-serif;
                color: #FFFFFF;
                -webkit-text-stroke: 1px #000000;
                text-stroke: 1px #000000;
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
                font-smooth: always;
                margin-bottom: 10px;
            }
            .changelog-change {
                margin: 8px 0;
                padding-left: 20px;
                position: relative;
                font-family: Arial, sans-serif;
                line-height: 1.6;
            }
            .changelog-change-bullet {
                position: absolute;
                left: 5px;
                font-size: 20px;
                font-family: Arial, sans-serif;
                color: #FFFFFF;
                -webkit-text-stroke: 1px #000000;
                text-stroke: 1px #000000;
                z-index: 2;
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
                font-smooth: always;
            }
            .changelog-change-text {
                position: relative;
                color: #FFFFFF;
                -webkit-text-stroke: 0.5px #000000;
                text-stroke: 0.5px #000000;
                -webkit-font-smoothing: antialiased;
                text-rendering: optimizeLegibility;
                font-smooth: always;
            }
            .outlined-text {
                color: #FFFFFF;
                -webkit-text-stroke: 1px #000000;
                text-stroke: 1px #000000;
            }
        `;
        document.head.appendChild(style);
    }

    private populateChangelog(): void {
        const contentDiv = this.changelogPanel?.querySelector('#changelogContent');
        if (!contentDiv) return;

        // Reverse the array to show most recent entries first
        contentDiv.innerHTML = [...CHANGELOG].reverse().map(entry => `
            <div class="changelog-entry">
                <div class="changelog-date">${entry.date}</div>
                ${entry.changes.map(change => `
                    <div class="changelog-change">
                        <span class="changelog-change-bullet">•</span>
                        <span class="changelog-change-text">${change}</span>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    public toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show(): void {
        if (this.changelogPanel) {
            this.changelogPanel.style.display = 'block';
            this.isOpen = true;
        }
    }

    public hide(): void {
        if (this.changelogPanel) {
            this.changelogPanel.style.display = 'none';
            this.isOpen = false;
        }
    }

    public isChangelogOpen(): boolean {
        return this.isOpen;
    }
}

