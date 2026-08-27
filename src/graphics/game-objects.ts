import { Graphics, WorldItem, PLAYER_SIZE, getMobStats, getEnemySizeScale, mobHasRandomSize, getPetalStats } from './core';
import { ClientWorld } from '../client_world';
import { Entity } from '../ecs';
import { DEATH_ANIMATION_DURATION } from './enemy-drawing';

declare module './core' {
    interface Graphics {
        drawGameObjects(world: ClientWorld, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension?: number): void;
    }
}

/** Reused entity snapshots; see ClientWorld.collectMobs on why not chunks. */
const mobScratch: Entity[] = [];
const playerScratch: Entity[] = [];

Graphics.prototype.drawGameObjects = function(this: Graphics, world: ClientWorld, items: Map<string, WorldItem>, mobProjectiles: Map<string, any>, playerProjectiles: Map<string, any>, currentPlayerId: string, petalExtension: number = 1.0): void {
    const viewport = this.worldViewport();

    // Draw enemies first (including pets) - below players and petals
    const mobsT0 = performance.now();
    // Snapshot the camera transform once; drawEnemy composes each mob's
    // translate/rotate/flip into a single setTransform against this. Copied
    // to plain numbers — reading DOMMatrix accessors per mob is slow.
    const tf = this.ctx.getTransform();
    this._worldBaseTf = { a: tf.a, b: tf.b, c: tf.c, d: tf.d, e: tf.e, f: tf.f };
    // Smoothing ON once for the whole mob pass — the drawImage-based bits
    // (glow sprites, baked label overlays) need it, and per-mob toggles forced
    // a canvas pipeline flush per mob on the GPU path.
    this.ctx.imageSmoothingEnabled = true;
    for (const enemy of world.collectMobs(mobScratch)) {
        const ex = world.mobX(enemy);
        const ey = world.mobY(enemy);
        // Calculate actual enemy size for accurate culling. Must match drawEnemy's
        // own size math (pet scale included) — this value is also what the
        // health-bar pass below sizes bars against.
        const tier = world.mobTier(enemy);
        const mobType = world.mobType(enemy);
        const mobStats = getMobStats(mobType, tier);
        const baseSize = (mobStats ? mobStats.size * 40 : 40)
            * getEnemySizeScale(world.isPet(enemy), tier, mobType, mobHasRandomSize(mobType) ? world.mobId(enemy) : undefined);
        const visualScale = mobStats?.visual_scale ?? 1.0;
        const enemySize = baseSize * visualScale;

        // Add a buffer margin to ensure mobs are completely out before culling
        // This prevents culling when mobs are barely outside the viewport
        const cullingBuffer = Math.max(enemySize, 100); // At least 100px buffer, or enemy size if larger

        // Only cull if the mob is completely outside the viewport (with buffer)
        // A mob is completely outside if all of its edges are outside the viewport bounds
        if (ex + enemySize / 2 + cullingBuffer < viewport.left ||
            ex - enemySize / 2 - cullingBuffer > viewport.right ||
            ey + enemySize / 2 + cullingBuffer < viewport.top ||
            ey - enemySize / 2 - cullingBuffer > viewport.bottom) {
            continue;
        }

        this._hbEnemies.push(enemy);
        this._hbSizes.push(enemySize);
        try {
            this.drawEnemy(world, enemy);
        } catch (error) {
            console.error('[Graphics] Error drawing enemy:', error, world.mobId(enemy));
            // Draw a simple fallback circle if rendering fails
            try {
                // drawEnemy may have died mid-mob with its local frame active.
                const b = this._worldBaseTf!;
                this.ctx.setTransform(b.a, b.b, b.c, b.d, b.e, b.f);
                this.ctx.save();
                this.ctx.translate(ex, ey);
                this.ctx.fillStyle = '#ff0000';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
            } catch (fallbackError) {
                console.error('[Graphics] Fallback rendering also failed:', fallbackError);
            }
        }
    }

    // Health bars for every mob drawn above, in one world-frame pass.
    // drawEnemy leaves each mob's local transform active, so the camera
    // transform is restored once here instead of once per mob — the
    // per-mob save()/setTransform pairs were the top cost of this section
    // under CPU throttling. Side effect: bars now draw on top of all mob
    // bodies rather than interleaved with them.
    {
        const b = this._worldBaseTf!;
        this.ctx.setTransform(b.a, b.b, b.c, b.d, b.e, b.f);
        this.ctx.imageSmoothingEnabled = this.antialiasing;
        const hbEnemies = this._hbEnemies;
        const hbSizes = this._hbSizes;
        for (let i = 0; i < hbEnemies.length; i++) {
            const enemy = hbEnemies[i];
            // The mob may have been reaped between the body pass and here only
            // if something structural ran in between; nothing does, but the
            // handle test is free and a stale handle would throw.
            if (!world.world.isAlive(enemy)) continue;
            // Skip while the death animation runs (mirrors drawEnemy's isDying).
            const dyingAt = world.deathAnimationStart(enemy);
            if (this.mobDeathAnimation && dyingAt !== 0 &&
                this.frameTimestamp - dyingAt < DEATH_ANIMATION_DURATION) {
                continue;
            }
            this.drawEnemyHealthBar(world, enemy, hbSizes[i]);
        }
        hbEnemies.length = 0;
        hbSizes.length = 0;
    }

    // Draw players (with petals) - above enemies
    for (const entity of world.collectPlayers(playerScratch)) {
        const px = world.playerX(entity);
        const py = world.playerY(entity);
        if (px > viewport.left - PLAYER_SIZE && px < viewport.right + PLAYER_SIZE &&
            py > viewport.top - PLAYER_SIZE && py < viewport.bottom + PLAYER_SIZE) {
            const player = world.playerOf(entity);
            if (!player) continue;

            if (player.isDead) {
                // Draw corpse for dead players
                this.drawCorpse(px, py, world.playerAngle(entity), player);
            } else {
                // Use each player's own petal extension, or fallback to the passed value (for current player)
                const playerPetalExtension = player.id === currentPlayerId
                    ? petalExtension
                    : (player.petalExtension || 1.0);
                this.drawPlayer(world, entity, currentPlayerId, playerPetalExtension);
            }
        }
    }

    this.perfMobsMs = performance.now() - mobsT0;

    // Draw items (with viewport culling)
    const itemsT0 = performance.now();
    let itemsDrawn = 0;
    const ITEM_CULL_BUFFER = 50; // Item size ~50px + text
    for (const item of items.values()) {
        if (item.x + ITEM_CULL_BUFFER < viewport.left ||
            item.x - ITEM_CULL_BUFFER > viewport.right ||
            item.y + ITEM_CULL_BUFFER < viewport.top ||
            item.y - ITEM_CULL_BUFFER > viewport.bottom) {
            continue;
        }
        this.drawItem(item, world);
        itemsDrawn++;
    }
    this.perfItemsMs = performance.now() - itemsT0;
    this.perfItemsCount = itemsDrawn;
    const projT0 = performance.now();

    // Cache current time once per frame for animated projectiles
    const currentTime = Date.now();

    // Batch ALL gas projectiles (mob + player) for optimal performance
    const allGasProjectiles: Array<{ x: number; y: number; radius: number }> = [];
    const otherProjectiles: any[] = [];

    const MAX_GAS_PROJECTILES = 500; // Limit to prevent performance issues

    // Mob and player projectiles are sorted identically — only where the
    // drawn size comes from differs (mob projectiles carry their own scaled
    // size, player ones take it from the petal's stats).
    const collectProjectiles = (
        source: Map<string, any>,
        sizeOf: (projectile: any, petalStats: any) => number,
    ): void => {
        for (const projectile of source.values()) {
            const petalStats = getPetalStats(projectile.petalType, projectile.petalRarity);
            if (!petalStats) continue;

            const projectileSize = sizeOf(projectile, petalStats);
            const cullingBuffer = Math.max(projectileSize, 50);

            // Viewport culling
            if (projectile.x + projectileSize / 2 + cullingBuffer < viewport.left ||
                projectile.x - projectileSize / 2 - cullingBuffer > viewport.right ||
                projectile.y + projectileSize / 2 + cullingBuffer < viewport.top ||
                projectile.y - projectileSize / 2 - cullingBuffer > viewport.bottom) {
                continue;
            }

            if (projectile.petalType === 'gas' && projectile.petalRarity === 'common') {
                if (allGasProjectiles.length < MAX_GAS_PROJECTILES) {
                    allGasProjectiles.push({
                        x: projectile.x,
                        y: projectile.y,
                        radius: projectileSize / 2, // Already uses scaled size
                    });
                }
            } else {
                otherProjectiles.push({ projectile, petalStats });
            }
        }
    };

    collectProjectiles(mobProjectiles, (projectile) => projectile.size * 20);
    collectProjectiles(playerProjectiles, (_projectile, petalStats) => petalStats.size * 20);

    // Batch draw ALL gas projectiles in a single operation (much faster)
    if (allGasProjectiles.length > 0) {
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        this.ctx.beginPath();
        for (const gas of allGasProjectiles) {
            this.ctx.arc(gas.x, gas.y, gas.radius, 0, Math.PI * 2);
        }
        this.ctx.fill();
    }

    // Draw other projectiles normally
    for (const { projectile, petalStats } of otherProjectiles) {
        this.drawMobProjectile(projectile, currentTime, petalStats);
    }
    this.perfProjectilesMs = performance.now() - projT0;
};
