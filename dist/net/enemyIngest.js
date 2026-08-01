"use strict";
/**
 * Ingestion of enemy state from the server, shared by the bulk-update handlers
 * in handlers/world.ts and the per-tick delta decoder in handlers/gameState.ts.
 *
 * Both paths must treat a mid-death-animation enemy identically — updating or
 * deleting one out from under the animation makes mobs blink out instead of
 * playing their death pop — so the logic lives in one place.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyEnemyUpdate = applyEnemyUpdate;
exports.forgetEnemy = forgetEnemy;
function applyEnemyUpdate(game, enemy, snapTimeMs) {
    // If enemy is already in death animation, don't update it (let animation complete)
    const existingEnemy = game.enemies.get(enemy.id);
    if (existingEnemy && existingEnemy.deathAnimationStartTime) {
        const DEATH_ANIMATION_DURATION = 200; // Must match duration in graphics.ts
        const elapsed = Date.now() - existingEnemy.deathAnimationStartTime;
        if (elapsed < DEATH_ANIMATION_DURATION) {
            // Enemy is still animating, don't update it
            return;
        }
    }
    if (existingEnemy) {
        // Update existing enemy: set interpolation targets instead of snapping
        existingEnemy.targetX = enemy.x;
        existingEnemy.targetY = enemy.y;
        existingEnemy.targetAngle = enemy.angle;
        const sNow = snapTimeMs ?? performance.now();
        if (!existingEnemy._snapshots)
            existingEnemy._snapshots = [];
        const buf = existingEnemy._snapshots;
        // Keep the buffer monotonic even across a clock-offset re-anchor.
        const t = buf.length > 0 && sNow <= buf[buf.length - 1].t ? buf[buf.length - 1].t + 1 : sNow;
        buf.push({ t, x: enemy.x, y: enemy.y, angle: enemy.angle });
        if (buf.length > 12)
            buf.shift();
        existingEnemy.health = enemy.health;
        existingEnemy.maxHealth = enemy.maxHealth;
        // Update other fields directly
        if (enemy.type)
            existingEnemy.type = enemy.type;
        if (enemy.tier)
            existingEnemy.tier = enemy.tier;
    }
    else {
        // New enemy: set position immediately (no interpolation on first appearance)
        enemy.targetX = enemy.x;
        enemy.targetY = enemy.y;
        enemy.targetAngle = enemy.angle;
        // The full `enemySpawned` payload identifies a pet by `ownerId`; the delta
        // stream sets `isPet` directly. Normalize so the renderer only reads one.
        if (enemy.ownerId)
            enemy.isPet = true;
        game.enemies.set(enemy.id, enemy);
    }
}
function forgetEnemy(game, enemyId) {
    const enemy = game.enemies.get(enemyId);
    // Don't remove enemies mid-death-animation - let the animation finish
    if (enemy?.deathAnimationStartTime)
        return;
    game.graphics.clearEnemyDamage(enemyId);
    game.enemies.delete(enemyId);
}
