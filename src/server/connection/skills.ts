/**
 * The skill tree: spending TP on upgrades, and refunding it all.
 */

import { RARITY_LEVELS, Rarity, getPetalStats, getRarityIndex } from '../../petals';
import { getSessionPlayer } from '../gameState';
import { applyPetalHealthBonus, isMazeTrackLive, recalculatePlayerStats } from '../playerManager';
import { sanitizePlayerForClient } from '../playerWire';
import { ConnectionContext } from './context';
import { emitPetalRestored } from '../petalEvents';

export function registerSkillHandlers(ctx: ConnectionContext): void {
    const { io, socket } = ctx;
    const { RARITY_TP_COSTS, savePlayerProgress } = ctx.deps;

    socket.on('upgradeSkill', (data: { skillId: string; rarity: string }) => {
        // The talent tree is reachable from the title screen, so this resolves
        // a lobby player too — spending TP is account state, not world state.
        const player = getSessionPlayer(socket.id);
        if (!player) {
            socket.emit('skillUpgradeError', { message: 'Player not found' });
            return;
        }

        // Initialize skills and TP if not present
        if (!player.skills) {
            player.skills = {};
        }
        if (player.tp === undefined) {
            player.tp = 0;
        }

        // Check if player has enough TP
        if (player.tp < 1) {
            socket.emit('skillUpgradeError', { message: 'Not enough Talent Points' });
            return;
        }

        // Validate skill ID
        const validSkills = ['damage', 'petalHealth', 'playerHealth', 'healingMultiplier', 'secondChance', 'absorbing'];
        if (!validSkills.includes(data.skillId)) {
            socket.emit('skillUpgradeError', { message: 'Invalid skill ID' });
            return;
        }

        // Absorbing only ever pays out on the maze's Absorb tab but is read
        // from the outside tree (getAbsorbingTier), so buying it with maze TP
        // would spend points on a node that never applies.
        if (data.skillId === 'absorbing' && isMazeTrackLive(player)) {
            socket.emit('skillUpgradeError', { message: 'Absorption must be upgraded outside the maze' });
            return;
        }

        // Validate rarity
        if (!RARITY_LEVELS.includes(data.rarity as Rarity)) {
            socket.emit('skillUpgradeError', { message: 'Invalid rarity tier' });
            return;
        }

        // Get TP cost for this tier
        const tpCost = RARITY_TP_COSTS[data.rarity] || 1;

        // Check if player has enough TP
        if (player.tp < tpCost) {
            socket.emit('skillUpgradeError', { message: `Not enough Talent Points (need ${tpCost} TP)` });
            return;
        }

        // Get current tier for this skill
        const skillKey = data.skillId as keyof typeof player.skills;
        const currentTier = player.skills[skillKey];
        const currentIndex = currentTier ? getRarityIndex(currentTier) : -1;
        const targetIndex = getRarityIndex(data.rarity);

        // Check if this is the next tier in sequence
        if (targetIndex !== currentIndex + 1) {
            socket.emit('skillUpgradeError', { message: 'Must upgrade tiers in order' });
            return;
        }

        // Second Chance requires rare Flower Health (playerHealth) as prerequisite
        if (data.skillId === 'secondChance') {
            const playerHealthTier = player.skills.playerHealth;
            const playerHealthIdx = playerHealthTier ? getRarityIndex(playerHealthTier) : -1;
            const rareIdx = getRarityIndex('rare');
            if (playerHealthIdx < rareIdx) {
                socket.emit('skillUpgradeError', { message: 'Requires rare Flower Health' });
                return;
            }
        }

        // Upgrade the skill to the new tier
        player.skills[skillKey] = data.rarity;
        player.tp -= tpCost;

        // Recalculate player stats based on level, skills, and petal modifiers
        // This will automatically scale health proportionally if maxHealth changes
        recalculatePlayerStats(player, io);

        // Apply petal health bonuses to all equipped petals and respawn them
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal') {
                    applyPetalHealthBonus(petal, player);
                    // Respawn petal (restore health to max and remove cooldown)
                    if (petal.maxHealth !== undefined) {
                        petal.health = petal.maxHealth;
                        petal.onCooldown = false;

                        // Emit petal restored event for each petal
                        emitPetalRestored(player.id, {
                            playerId: player.id,
                            slotIndex: index,
                            petal: petal
                        });
                    }
                }
            });
        }

        // Save progress
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }

        // Emit skills update (only to this player)
        socket.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });

        // Emit player update to sync stats (only to this player)
        socket.emit('playerUpdated', sanitizePlayerForClient(player));
    });

    socket.on('resetSkills', () => {
        const player = getSessionPlayer(socket.id);
        if (!player) {
            socket.emit('skillResetError', { message: 'Player not found' });
            return;
        }

        // Reset all skills
        player.skills = {};

        // Refund all TP (player's level gives TP, so refund = level - current TP)
        player.tp = player.level;

        // Recalculate player stats (without skill multipliers, but with petal modifiers)
        // This will automatically scale health proportionally if maxHealth changes
        recalculatePlayerStats(player, io);

        // Reconstruct all petals without petal health bonuses
        if (player.loadout) {
            player.loadout.forEach((petal, index) => {
                if (petal && petal.type === 'petal' && petal.petalType) {
                    const petalStats = getPetalStats(petal.petalType, petal.rarity || 'common');
                    if (petalStats) {
                        petal.maxHealth = petalStats.health;
                        petal.health = petal.maxHealth;
                        petal.onCooldown = false;

                        // Emit petal restored event for each petal
                        emitPetalRestored(player.id, {
                            playerId: player.id,
                            slotIndex: index,
                            petal: petal
                        });
                    }
                }
            });
        }

        // Save progress
        if (socket.userId) {
            savePlayerProgress(player, socket.userId);
        }

        // Emit skills update (only to this player)
        socket.emit('skillsUpdated', {
            playerId: player.id,
            tp: player.tp,
            skills: player.skills
        });

        // Emit player update to sync stats (only to this player)
        socket.emit('playerUpdated', sanitizePlayerForClient(player));
    });
}
