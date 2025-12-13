"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackDamage = trackDamage;
exports.calculateDPS = calculateDPS;
exports.getEligiblePlayers = getEligiblePlayers;
exports.sendBossMobDefeatedMessage = sendBossMobDefeatedMessage;
exports.cleanupEnemy = cleanupEnemy;
const constants_1 = require("../constants");
// Helper function to track damage dealt to an enemy
function trackDamage(enemy, playerId, damage) {
    if (!enemy.damageContributors) {
        enemy.damageContributors = new Map();
    }
    const currentDamage = enemy.damageContributors.get(playerId) || 0;
    enemy.damageContributors.set(playerId, currentDamage + damage);
    // Track DPS for target dummies
    if (enemy.type === 'target_dummy') {
        const now = Date.now();
        if (!enemy.dpsStartTime) {
            enemy.dpsStartTime = now;
            enemy.dpsHistory = [];
        }
        if (!enemy.dpsHistory) {
            enemy.dpsHistory = [];
        }
        enemy.dpsHistory.push({ time: now, damage: damage });
        // Keep only last 60 seconds of history
        const cutoffTime = now - 60000;
        enemy.dpsHistory = enemy.dpsHistory.filter(entry => entry.time > cutoffTime);
    }
}
// Calculate DPS for target dummies
function calculateDPS(enemy) {
    if (enemy.type !== 'target_dummy' || !enemy.dpsHistory || enemy.dpsHistory.length === 0) {
        return 0;
    }
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds window
    const cutoffTime = now - timeWindow;
    // Sum damage in the last 10 seconds
    const recentDamage = enemy.dpsHistory
        .filter(entry => entry.time > cutoffTime)
        .reduce((sum, entry) => sum + entry.damage, 0);
    // Calculate DPS (damage per second)
    const dps = recentDamage / (timeWindow / 1000);
    return dps;
}
// Helper function to get eligible players for a drop based on damage ranking
function getEligiblePlayers(enemy) {
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return [];
    }
    // Sort players by damage dealt (highest first)
    const sortedPlayers = Array.from(enemy.damageContributors.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    // Determine placement requirement based on mob rarity
    const isUltraOrAbove = ['ultra', 'super', 'unique'].includes(enemy.tier);
    const placementRequirement = isUltraOrAbove ? 15 : 4;
    // Return top N players who qualify
    return sortedPlayers.slice(0, placementRequirement);
}
// Helper function to send boss mob defeated message in chat
function sendBossMobDefeatedMessage(enemy, io, players) {
    // Check if this is a boss mob (ultra, super, or unique tier)
    const isBossMob = ['ultra', 'super', 'unique'].includes(enemy.tier);
    if (!isBossMob) {
        return;
    }
    // Get the top damage dealer
    if (!enemy.damageContributors || enemy.damageContributors.size === 0) {
        return;
    }
    // Sort players by damage dealt (highest first)
    const sortedPlayers = Array.from(enemy.damageContributors.entries())
        .sort((a, b) => b[1] - a[1]);
    if (sortedPlayers.length === 0) {
        return;
    }
    // Get the top damage dealer's player ID
    const topDamagerId = sortedPlayers[0][0];
    const topDamager = players[topDamagerId];
    if (!topDamager) {
        return;
    }
    // Capitalize the first letter of the rarity
    const rarity = enemy.tier.charAt(0).toUpperCase() + enemy.tier.slice(1);
    // Get the username from the socket
    const socket = io.sockets.sockets.get(topDamagerId);
    const username = socket?.username || 'Unknown';
    // Send chat message
    io.emit('chatMessage', {
        sender: '',
        content: `<b style="color: ${constants_1.ENEMY_TIERS[enemy.tier].color};">A ${rarity} ${enemy.type.replace('_', ' ')} has been defeated by <span style="color: #00ff00;">@${username}</span> [<span style="color: yellow;">${topDamager.name}</span>]</b>`,
        timestamp: Date.now()
    });
}
// Helper function to clean up enemy data structures before removal
// This helps prevent memory leaks by clearing Maps and arrays
function cleanupEnemy(enemy) {
    // Clear damage contributors Map
    if (enemy.damageContributors) {
        enemy.damageContributors.clear();
        delete enemy.damageContributors;
    }
    // Clear poison effects array
    if (enemy.poisonEffects) {
        enemy.poisonEffects.length = 0;
        delete enemy.poisonEffects;
    }
    // Clear DPS history for target dummies
    if (enemy.dpsHistory) {
        enemy.dpsHistory.length = 0;
        delete enemy.dpsHistory;
    }
    // Clear other optional properties
    delete enemy.dpsStartTime;
    delete enemy.currentDPS;
    delete enemy.wanderTarget;
    delete enemy.lastWanderTime;
    delete enemy.lastViewportCheck;
    delete enemy.lastProjectileTime;
    delete enemy.lastMeleeAttackTime;
}
// Collision detection functions have been moved to physics.ts
