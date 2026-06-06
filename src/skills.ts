import { CanvasSkillsPanel } from './graphics/skills-panel';

interface GameInterface {
    getLocalPlayer(): any;
    getSocket(): any;
    showFloatingText(x: number, y: number, text: string, color: string, fontSize: number): void;
    /** The shared Graphics instance used to render the in-game flower; passed
     *  through to CanvasSkillsPanel so the talent tree center uses drawFlower(). */
    graphics?: any;
}

const SKILL_MULTIPLIERS: Record<string, number> = {
    common: 1.0,
    uncommon: 1.1,
    rare: 1.2,
    epic: 1.35,
    legendary: 1.6,
    mythic: 2.0,
    ultra: 2.6,
    super: 3.3,
    unique: 4.0,
    apex: 4.8
};

/** Format a number with k/m suffixes (e.g. 19725 → "19.7k"). */
function abbreviate(value: number): string {
    if (value < 1000) return value.toString();
    if (value < 1_000_000) {
        const k = value / 1000;
        return (k % 1 === 0 ? k.toString() : k.toFixed(1)) + 'k';
    }
    const m = value / 1_000_000;
    return (m % 1 === 0 ? m.toString() : m.toFixed(1)) + 'm';
}

export class SkillsManager {
    private skillsPanel: HTMLDivElement | null = null;
    private canvasSkillsPanel: CanvasSkillsPanel | null = null;
    private isOpen: boolean = false;
    private game: GameInterface;

    constructor(game: GameInterface) {
        this.game = game;
        this.createSkillsPanel();
    }

    private createSkillsPanel(): void {
        // Thin DOM container that just hosts the fully canvas-rendered talents UI.
        this.skillsPanel = document.createElement('div');
        this.skillsPanel.className = 'skills-panel';
        this.skillsPanel.style.cssText = `
            position: fixed;
            top: 33.33vh;
            left: 100px;
            width: 600px;
            height: 66.67vh;
            transform: translateY(100vh);
            transition: transform 0.3s ease-out;
            z-index: 3000;
            display: none;
            background: transparent;
            border: none;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            padding: 0;
            box-sizing: border-box;
            overflow: visible;
        `;
        document.body.appendChild(this.skillsPanel);

        const style = document.createElement('style');
        style.textContent = `
            .skills-panel.open {
                transform: translateY(0) !important;
            }
        `;
        document.head.appendChild(style);

        this.canvasSkillsPanel = new CanvasSkillsPanel(this.game as any);
        this.canvasSkillsPanel.attachTo(this.skillsPanel);
        this.canvasSkillsPanel.onUpgrade = (skillId, rarity) => this.upgradeSkill(skillId, rarity);
        this.canvasSkillsPanel.onReset = () => this.resetSkills();
        this.canvasSkillsPanel.onClose = () => this.hide();

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }

    private upgradeSkill(skillId: string, rarity: string): void {
        const socket = this.game.getSocket();
        if (!socket) {
            console.error('Socket not available');
            return;
        }

        // Check if socket is authenticated (username is set during authentication)
        if (!(socket as any).username) {
            console.warn('[SKILLS] Socket not authenticated yet');
            alert('Please wait for authentication to complete');
            return;
        }

        socket.emit('upgradeSkill', { skillId, rarity });
    }

    private resetSkills(): void {
        const socket = this.game.getSocket();
        if (!socket) {
            console.error('Socket not available');
            return;
        }

        if (!confirm('Are you sure you want to reset all skills? All TP will be refunded.')) {
            return;
        }

        socket.emit('resetSkills');
    }

    public updateSkills(tp: number, skills: { [key: string]: string }): void {
        if (!this.canvasSkillsPanel) return;

        const player = this.game.getLocalPlayer();
        const baseHealth = player?.maxHealth ?? 0;
        const healthMult = SKILL_MULTIPLIERS[skills?.playerHealth ?? ''] ?? 1.0;
        const flowerHealth = abbreviate(Math.round(baseHealth * healthMult));

        // Body damage isn't surfaced via player stats; show the damage skill
        // multiplier as the visible "Body Damage" rather than fabricating a value.
        const damageMult = SKILL_MULTIPLIERS[skills?.damage ?? ''] ?? 1.0;
        const baseBodyDamage = (player?.bodyDamage ?? 25);
        const bodyDamage = abbreviate(Math.round(baseBodyDamage * damageMult));

        this.canvasSkillsPanel.updateState(tp, skills || {}, flowerHealth, bodyDamage);
    }

    public toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show(): void {
        if (!this.skillsPanel || !this.canvasSkillsPanel) return;
        this.skillsPanel.style.display = 'block';
        this.isOpen = true;
        this.refreshSkills();
        this.canvasSkillsPanel.start();
        setTimeout(() => {
            this.skillsPanel?.classList.add('open');
        }, 10);
    }

    public hide(): void {
        if (!this.skillsPanel || !this.canvasSkillsPanel) return;
        this.skillsPanel.classList.remove('open');
        this.canvasSkillsPanel.stop();
        setTimeout(() => {
            if (this.skillsPanel) {
                this.skillsPanel.style.display = 'none';
            }
        }, 300);
        this.isOpen = false;
    }

    private refreshSkills(): void {
        const player = this.game.getLocalPlayer();
        if (player) {
            this.updateSkills(
                player.tp || 0,
                player.skills || {}
            );
        }
    }

    public isSkillsOpen(): boolean {
        return this.isOpen;
    }

    public cleanup(): void {
        this.canvasSkillsPanel?.destroy();
        this.canvasSkillsPanel = null;
        this.skillsPanel?.remove();
        this.skillsPanel = null;
    }
}
