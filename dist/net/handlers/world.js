"use strict";
/**
 * Enemies, obstacles, projectiles and ground fields.
 *
 * The bulk-update events here are coarse (full lists); the per-tick delta
 * stream that actually drives rendering is in gameState.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorldHandlers = registerWorldHandlers;
const enemyIngest_1 = require("../enemyIngest");
function registerWorldHandlers(game) {
    const cw = game.clientWorld;
    // Thin bindings over the shared ingestion helpers (see net/enemyIngest.ts),
    // so every call site below reads exactly as it did when they were local.
    const handleEnemyUpdate = (enemy, snapTimeMs) => (0, enemyIngest_1.applyEnemyUpdate)(game, enemy, snapTimeMs);
    const handleEnemyOutOfView = (enemyId) => (0, enemyIngest_1.forgetEnemy)(game, enemyId);
    game.socket.on('enemiesUpdate', (enemies) => {
        // Only used on initial connection - update all enemies
        const serverEnemyIds = new Set(enemies.map(e => e.id));
        // Remove enemies that left the viewport - no death animation
        for (const enemyId of cw.enemyIds()) {
            if (!serverEnemyIds.has(enemyId)) {
                handleEnemyOutOfView(enemyId);
            }
        }
        // Update or add enemies - uses same path as all enemy updates
        enemies.forEach(enemy => {
            handleEnemyUpdate(enemy);
        });
    });
    game.socket.on('enemySpawned', (enemy) => {
        // Add newly spawned enemy - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });
    // Delta projectile protocol — see src/ecs/net/projectileEncoder.ts for the wire format.
    // The client adds projectiles on mpSpawn / ppSpawn, removes them on mpRemove /
    // ppRemove, and dead-reckons positions each frame in Game.update() using the
    // angle/speed stored on the projectile. No periodic re-sync: straight-line motion
    // is deterministic, and sync packets only ever caused stutter under latency jitter.
    const expandSpawn = (s) => ({
        id: s.i,
        x: s.x,
        y: s.y,
        angle: s.a,
        speed: s.s,
        distance: 0,
        maxDistance: s.mD,
        petalType: s.pT,
        petalRarity: s.pR,
        size: s.sz,
        _lastClientTickMs: performance.now()
    });
    game.socket.on('mpSpawn', (spawned) => {
        const nowMs = performance.now();
        for (const s of spawned) {
            const proj = expandSpawn(s);
            proj._lastClientTickMs = nowMs;
            game.mobProjectiles.set(proj.id, proj);
        }
    });
    game.socket.on('mpRemove', (ids) => {
        for (const id of ids)
            game.mobProjectiles.delete(id);
    });
    game.socket.on('ppSpawn', (spawned) => {
        const nowMs = performance.now();
        for (const s of spawned) {
            const proj = expandSpawn(s);
            proj._lastClientTickMs = nowMs;
            game.playerProjectiles.set(proj.id, proj);
        }
    });
    game.socket.on('ppRemove', (ids) => {
        for (const id of ids)
            game.playerProjectiles.delete(id);
    });
    game.socket.on('groundPollenSpawned', (pollen) => {
        game.groundPollens.set(pollen.id, {
            ...pollen,
            spawnedAt: Date.now()
        });
    });
    game.socket.on('groundPollenRemoved', (id) => {
        game.groundPollens.delete(id);
    });
    game.socket.on('webSpawned', (web) => {
        game.webFields.set(web.id, {
            ...web,
            // A per-web random rotation, as gardn's alloc_web does, so stacked
            // webs don't line their spokes up.
            angle: Math.random() * Math.PI * 2,
            spawnedAt: Date.now()
        });
    });
    game.socket.on('webRemoved', (id) => {
        game.webFields.delete(id);
    });
    game.socket.on('enemyMoved', (enemy) => {
        // Enemy movement update - uses same path as all enemy updates
        handleEnemyUpdate(enemy);
    });
    game.socket.on('playerDamaged', (data) => {
        const player = cw.player(data.playerId);
        const entity = cw.playerEntity(data.playerId);
        if (player && entity !== undefined) {
            const oldHealth = player.health;
            player.health = data.health;
            player.maxHealth = data.maxHealth || player.maxHealth;
            // Update invulnerability status
            if (data.isInvulnerable !== undefined) {
                player.isInvulnerable = data.isInvulnerable;
                // Set a client-side backup timer in case server event is missed
                if (data.isInvulnerable) {
                    setTimeout(() => {
                        if (player && player.isInvulnerable) {
                            player.isInvulnerable = false;
                            console.log(`[CLIENT] Backup timer: Player ${data.playerId} invulnerability ended`);
                        }
                    }, 2000); // 2 seconds backup (longer than server 1 second)
                }
            }
            // Apply knockback if provided
            if (data.knockbackX !== undefined && data.knockbackY !== undefined) {
                player.knockbackX = data.knockbackX;
                player.knockbackY = data.knockbackY;
            }
            // Add visual feedback for damage taken
            // Use explicit damageDealt if provided, otherwise compute from health delta
            const damageTaken = data.damageDealt ?? (oldHealth - data.health);
            if (damageTaken > 0) {
                game.showFloatingText(cw.playerX(entity), cw.playerY(entity) - 20, `-${Math.round(damageTaken)}`, '#FF0000', 20);
            }
        }
    });
    // Unified handler for enemy damage - all damage goes through the same path
    function handleEnemyDamage(data) {
        const entity = cw.enemyEntity(data.enemyId);
        if (entity === undefined)
            return;
        const oldHealth = cw.setEnemyHealth(data.enemyId, data.health);
        if (oldHealth === undefined)
            return;
        // Calculate damage dealt and show floating damage number (throttled)
        if (oldHealth > data.health) {
            const damage = oldHealth - data.health;
            // Use throttled damage text to prevent spam when many enemies are damaged.
            // `p` marks a batch whose damage was all poison — shown in purple.
            game.graphics.showDamageText(data.enemyId, cw.mobX(entity), cw.mobY(entity), damage, data.p === 1);
        }
    }
    // Unified handler for enemy updates - all enemy updates go through the same path.
    // snapTimeMs is the de-jittered server-mapped timestamp for interpolation
    // snapshots (see gameStateUpdate); legacy callers omit it and get arrival time.
    // Handler for enemy killed - plays death animation
    function handleEnemyRemoval(enemyId) {
        // Show any accumulated damage before cleaning up
        const entity = cw.enemyEntity(enemyId);
        // Only start death animation if it hasn't already started
        if (entity !== undefined && cw.deathAnimationStart(entity) === 0) {
            const accumulated = game.graphics.getAccumulatedDamage(enemyId);
            if (accumulated > 0) {
                // Show final accumulated damage
                game.graphics.showFloatingText(cw.mobX(entity), cw.mobY(entity) - 20, `-${Math.round(accumulated)}`, '#ff0000', 16);
            }
            // Start death animation instead of immediately removing. Stamped on
            // the world clock (Date.now()), which is what the renderer compares
            // it against.
            cw.beginEnemyDeath(enemyId, (0, enemyIngest_1.worldNow)());
        }
        // Clean up accumulated damage for this enemy
        game.graphics.clearEnemyDamage(enemyId);
        // Don't delete immediately - let the animation complete first
    }
    // Handler for enemy leaving viewport - no death animation
    game.socket.on('enemyDamaged', (data) => {
        // Legacy handler for single enemy damage - uses same path as batched
        handleEnemyDamage(data);
    });
    game.socket.on('enemiesDamaged', (damagedEnemies) => {
        // Batch handler for multiple enemy damage updates - uses same path
        for (const data of damagedEnemies) {
            handleEnemyDamage(data);
        }
    });
    game.socket.on('targetDummyDPS', (data) => {
        const entity = cw.enemyEntity(data.enemyId);
        if (entity !== undefined && cw.mobType(entity) === 'target_dummy') {
            cw.setEnemyDps(data.enemyId, data.dps);
        }
    });
    game.socket.on('enemyDestroyed', (enemyId) => {
        // Enemy removal - uses same path as all enemy removals
        handleEnemyRemoval(enemyId);
    });
    game.socket.on('playerInvulnerabilityEnded', (data) => {
        const player = cw.player(data.playerId);
        if (player) {
            player.isInvulnerable = false;
            console.log(`[CLIENT] Player ${data.playerId} invulnerability ended`);
        }
    });
    game.socket.on('obstaclesUpdate', (obstacles) => {
        game.obstacles = obstacles;
    });
    game.socket.on('obstacleDamaged', (data) => {
        const obstacle = game.obstacles.find((o) => o.id === data.obstacleId);
        if (obstacle && obstacle.isEnemy) {
            obstacle.health = data.health;
        }
    });
    game.socket.on('obstacleDestroyed', (obstacleId) => {
        const index = game.obstacles.findIndex((o) => o.id === obstacleId);
        if (index !== -1) {
            game.obstacles.splice(index, 1);
        }
    });
}
